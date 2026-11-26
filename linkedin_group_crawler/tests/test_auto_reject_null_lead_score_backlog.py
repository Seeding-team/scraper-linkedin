"""Test cho `auto_reject_null_lead_score_backlog()` (2026-11-26) — quyết định kinh doanh đã
xác nhận: đẩy TOÀN BỘ bài lead_score IS NULL (facebook_posts/linkedin_posts/threads_posts)
vào 'khong-phu-hop', CHỈ áp dụng bài đang 'chua-danh-gia', không ghi đè đánh giá thủ công đã
có, không đụng youtube_posts (bảng này không có cột lead_score)."""

from __future__ import annotations

from typing import Any

import pytest

from app.modules.all_platform.services import crawl_exclude_service as exc_svc
from app.modules.all_platform.services import post_evaluation_service as review_svc


class _Result:
    def __init__(self, data=None):
        self.data = data or []


class _FakeQuery:
    def __init__(self, rows: list[dict], table: str):
        self.rows = rows
        self.table = table
        self.filters: list[tuple[str, Any, str]] = []
        self.op: tuple[str, Any] | None = None
        self.single = False

    def select(self, *_a, **_kw):
        return self

    def eq(self, key, value):
        self.filters.append((key, value, "eq"))
        return self

    def is_(self, key, value):
        self.filters.append((key, value, "is_"))
        return self

    def maybe_single(self):
        self.single = True
        return self

    def upsert(self, data, on_conflict=None):
        self.op = ("upsert", data, on_conflict)
        return self

    def insert(self, data):
        self.op = ("insert", data)
        return self

    def _matches(self, row: dict) -> bool:
        for key, value, kind in self.filters:
            cur = row.get(key)
            if kind == "eq" and cur != value:
                return False
            if kind == "is_" and value == "null" and cur is not None:
                return False
        return True

    def execute(self):
        if self.op:
            kind, payload = self.op[0], self.op[1]
            if kind == "upsert":
                on_conflict = self.op[2]
                conflict_keys = on_conflict.split(",") if on_conflict else []
                existing = None
                if conflict_keys:
                    for row in self.rows:
                        if all(row.get(k) == payload.get(k) for k in conflict_keys):
                            existing = row
                            break
                if existing is not None:
                    existing.update(payload)
                    return _Result([dict(existing)])
                self.rows.append(dict(payload))
                return _Result([dict(payload)])
            if kind == "insert":
                self.rows.append(dict(payload))
                return _Result([dict(payload)])

        matched = [r for r in self.rows if self._matches(r)]
        if self.single:
            return _Result(dict(matched[0])) if matched else _Result(None)
        return _Result([dict(r) for r in matched])


class _FakeSupabase:
    def __init__(self):
        self.store: dict[str, list[dict]] = {}

    def table(self, name: str) -> _FakeQuery:
        return _FakeQuery(self.store.setdefault(name, []), name)


@pytest.fixture
def fake_db(monkeypatch):
    db = _FakeSupabase()
    monkeypatch.setattr(exc_svc, "get_supabase_client", lambda: db)
    monkeypatch.setattr(review_svc, "get_supabase_client", lambda: db)
    return db


def test_marks_only_null_lead_score_posts_across_3_tables(fake_db):
    fake_db.store["facebook_posts"] = [
        {"id": "fb-null-1", "lead_score": None},
        {"id": "fb-scored-1", "lead_score": 55},  # KHONG dung toi (co diem)
    ]
    fake_db.store["linkedin_posts"] = [
        {"id": "li-null-1", "lead_score": None},
    ]
    fake_db.store["threads_posts"] = [
        {"id": "th-null-1", "lead_score": None},
        {"id": "th-null-2", "lead_score": None},
    ]
    fake_db.store["post_quick_review"] = []

    summary = exc_svc.auto_reject_null_lead_score_backlog()

    review_by_id = {r["post_id"]: r for r in fake_db.store.get("post_quick_review", [])}
    assert review_by_id["fb-null-1"]["evaluation_code"] == "khong-phu-hop"
    assert review_by_id["li-null-1"]["evaluation_code"] == "khong-phu-hop"
    assert review_by_id["th-null-1"]["evaluation_code"] == "khong-phu-hop"
    assert review_by_id["th-null-2"]["evaluation_code"] == "khong-phu-hop"
    assert "fb-scored-1" not in review_by_id  # co diem, khong bi dung toi

    assert summary["scanned"] == 4  # 1 fb-null + 1 li-null + 2 th-null (fb-scored-1 khong khop filter)
    assert summary["marked"] == 4
    assert summary["skipped_already_reviewed"] == 0

    history_action_types = {h["action_type"] for h in fake_db.store.get("post_evaluation_history", [])}
    assert history_action_types == {"auto_exclude_null_score_backlog"}


def test_does_not_overwrite_existing_manual_evaluation(fake_db):
    fake_db.store["facebook_posts"] = [{"id": "fb-null-reviewed", "lead_score": None}]
    fake_db.store["post_quick_review"] = [
        {
            "post_id": "fb-null-reviewed",
            "platform": "facebook",
            "evaluation_code": "can-lien-he",  # da duoc 1 Admin danh gia thu cong truoc do
            "exclude_keyword_exempt": False,
        }
    ]

    summary = exc_svc.auto_reject_null_lead_score_backlog()

    review = next(r for r in fake_db.store["post_quick_review"] if r["post_id"] == "fb-null-reviewed")
    assert review["evaluation_code"] == "can-lien-he"  # giu nguyen, KHONG bi ghi de
    assert summary["marked"] == 0
    assert summary["skipped_already_reviewed"] == 1
    assert fake_db.store.get("post_evaluation_history", []) == []  # khong tao history thua


def test_idempotent_second_run_has_no_side_effect(fake_db):
    fake_db.store["facebook_posts"] = [{"id": "fb-null-2", "lead_score": None}]

    first = exc_svc.auto_reject_null_lead_score_backlog()
    assert first["marked"] == 1
    history_len_after_first = len(fake_db.store.get("post_evaluation_history", []))

    second = exc_svc.auto_reject_null_lead_score_backlog()

    assert second["marked"] == 0
    assert second["skipped_already_reviewed"] == 1
    assert len(fake_db.store.get("post_evaluation_history", [])) == history_len_after_first

    review = next(r for r in fake_db.store["post_quick_review"] if r["post_id"] == "fb-null-2")
    assert review["evaluation_code"] == "khong-phu-hop"


def test_youtube_posts_table_not_touched():
    """youtube_posts khong co cot lead_score - ham nay KHONG duoc dung toi bang nay."""
    assert "youtube_posts" not in exc_svc._NULL_LEAD_SCORE_BACKLOG_TABLES
