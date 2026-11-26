"""Test cho Việc A (2026-11-26): nối luồng cào 24h tự động (`save_facebook_crawl_to_supabase`,
`supabase_facebook_crawl_service.py`) vào AI lead-scoring (`lead_score_service.score_and_save_posts`),
đúng cơ chế Extension/Public4G đang dùng (`post_ingest_service.py`).

Trước fix này, luồng cào 24h KHÔNG BAO GIỜ gọi AI chấm điểm -> `lead_score` luôn NULL vĩnh
viễn cho mọi bài từ luồng này -> bị `.gte("lead_score", 40)` ở `unified_posts_service.py`
ẩn khỏi feed mặc định mãi mãi (NULL >= 40 = NULL/false trong Postgres), dù bài vẫn tính vào
"Tổng bài". Đây là nguyên nhân chính xác định được qua điều tra 2026-11-26.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest

from app.modules.all_platform.services import lead_score_service as lead_svc
from app.modules.all_platform.services import supabase_facebook_crawl_service as fb_crawl_service
from app.modules.facebook.src.modules.crawl_fb.models.GroupSummary import GroupSummary
from app.modules.facebook.src.modules.crawl_fb.models.post import Post


class _Result:
    def __init__(self, data):
        self.data = data


class _FakeQuery:
    """Fake query builder dùng chung cho cả 2 service (facebook_groups/facebook_posts) —
    hỗ trợ insert/upsert (ON CONFLICT DO NOTHING, giống Việc 2) + update + delete, vì
    `score_and_save_posts()` cần update (bài sống) hoặc delete (bài bị xoá vì điểm thấp)."""

    def __init__(self, rows: list[dict], table: str):
        self.rows = rows
        self.table = table
        self.filters: list[tuple[str, Any]] = []
        self.op: tuple[str, Any] | None = None
        self.on_conflict: str | None = None
        self.ignore_duplicates: bool = False

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, key, value):
        self.filters.append((key, value))
        return self

    def in_(self, key, values):
        self.filters.append((key, set(values)))
        return self

    def insert(self, data):
        self.op = ("insert", data)
        return self

    def update(self, data):
        self.op = ("update", data)
        return self

    def delete(self):
        self.op = ("delete", None)
        return self

    def upsert(self, data, on_conflict: str | None = None, ignore_duplicates: bool = False):
        self.op = ("upsert", data)
        self.on_conflict = on_conflict
        self.ignore_duplicates = ignore_duplicates
        return self

    def _matches(self, row: dict) -> bool:
        for key, value in self.filters:
            if isinstance(value, set):
                if row.get(key) not in value:
                    return False
            elif row.get(key) != value:
                return False
        return True

    def execute(self):
        if self.op:
            kind, payload = self.op

            if kind in ("insert", "upsert"):
                items = payload if isinstance(payload, list) else [payload]
                conflict_keys = self.on_conflict.split(",") if self.on_conflict else []
                saved = []
                for item in items:
                    existing = None
                    if kind == "upsert" and conflict_keys:
                        for row in self.rows:
                            if all(row.get(k) == item.get(k) for k in conflict_keys):
                                existing = row
                                break
                    if existing is not None:
                        if self.ignore_duplicates:
                            continue
                        existing.update(item)
                        saved.append(dict(existing))
                    else:
                        row = dict(item)
                        row.setdefault("id", str(uuid.uuid4()))
                        self.rows.append(row)
                        saved.append(dict(row))
                return _Result(saved)

            if kind == "update":
                matched = [r for r in self.rows if self._matches(r)]
                for r in matched:
                    r.update(payload)
                return _Result([dict(r) for r in matched])

            if kind == "delete":
                matched = [r for r in self.rows if self._matches(r)]
                for r in matched:
                    self.rows.remove(r)
                return _Result([dict(r) for r in matched])

        matched = [r for r in self.rows if self._matches(r)]
        return _Result([dict(r) for r in matched])


class _FakeSupabase:
    def __init__(self):
        self.store: dict[str, list[dict]] = {}

    def table(self, name: str) -> _FakeQuery:
        return _FakeQuery(self.store.setdefault(name, []), name)


@pytest.fixture
def fake_db():
    return _FakeSupabase()


@pytest.fixture
def patched_clients(fake_db, monkeypatch):
    monkeypatch.setattr(fb_crawl_service, "get_supabase_client", lambda: fake_db)
    monkeypatch.setattr(lead_svc, "get_supabase_client", lambda: fake_db)
    monkeypatch.setattr(lead_svc, "is_lead_scoring_configured", lambda: True)
    return fake_db


def _make_summary(post_url: str, content: str, group_url: str = "https://facebook.com/groups/abc") -> GroupSummary:
    post = Post(url=post_url, date="", reactions=1, comments=0, shares=0, score=1, content=content)
    return GroupSummary(
        group_name="Test Group",
        link_group=group_url,
        total_posts_24h=1,
        Intent="sales",
        id_member="member-1",
        hot_post=post,
        selected_posts=[post],
    )


def test_24h_flow_sets_lead_score_for_qualifying_post_and_deletes_low_score(patched_clients, monkeypatch):
    """Bài 'khách thật' phải được lưu lead_score; bài điểm thấp phải bị XOÁ hẳn khỏi DB —
    đúng y hệt hành vi Extension/Public4G (score_and_save_posts), không còn khác biệt."""
    fake_db = patched_clients
    fake_db.store.setdefault("facebook_groups", []).append(
        {"id": "group-1", "group_url": "https://facebook.com/groups/abc"}
    )

    async def _fake_score_text(content, keywords=None):
        if "khach that" in content:
            return {
                "score": 55,
                "is_competitor": False,
                "is_buyer": True,
                "reason": "Khach can lam web",
                "need_category": "website",
                "contact_phone": None,
            }
        return {
            "score": 10,
            "is_competitor": False,
            "is_buyer": False,
            "reason": "Khong lien quan",
            "need_category": None,
            "contact_phone": None,
        }

    monkeypatch.setattr(lead_svc, "score_text_for_lead", _fake_score_text)

    summary_high = _make_summary("https://facebook.com/posts/high-1", "toi la khach that can lam website")
    summary_low = _make_summary("https://facebook.com/posts/low-1", "bai khong lien quan gi ca")

    result = fb_crawl_service.save_facebook_crawl_to_supabase("cronjob", [summary_high, summary_low])

    # 1. Luc insert ban dau ca 2 bai deu duoc luu (truoc khi AI xu ly xong).
    assert result["total_posts"] == 2

    # 2. Sau khi AI cham diem xong (chay dong bo trong test vi khong co event loop dang
    #    chay trong thread test): bai thap bi xoa hoan toan, bai cao con lai + co lead_score.
    remaining = {r["post_url"]: r for r in fake_db.store["facebook_posts"]}
    assert "https://facebook.com/posts/high-1" in remaining
    assert "https://facebook.com/posts/low-1" not in remaining

    assert remaining["https://facebook.com/posts/high-1"]["lead_score"] == 55


def test_24h_flow_without_openai_configured_leaves_lead_score_null(patched_clients, monkeypatch):
    """Nếu AI chưa cấu hình (is_lead_scoring_configured=False) — bài vẫn được giữ nguyên
    trong DB với lead_score=NULL (không xoá nhầm, không set điểm bừa)."""
    fake_db = patched_clients
    fake_db.store.setdefault("facebook_groups", []).append(
        {"id": "group-1", "group_url": "https://facebook.com/groups/abc"}
    )
    monkeypatch.setattr(lead_svc, "is_lead_scoring_configured", lambda: False)

    summary = _make_summary("https://facebook.com/posts/unconfigured-1", "noi dung bat ky")
    fb_crawl_service.save_facebook_crawl_to_supabase("cronjob", [summary])

    row = next(r for r in fake_db.store["facebook_posts"] if r["post_url"] == "https://facebook.com/posts/unconfigured-1")
    assert row.get("lead_score") is None
