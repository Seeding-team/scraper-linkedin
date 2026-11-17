"""Tests cho phần mở rộng của _attach_auto_seeding_comments (unified_posts_service.py):
khi 1 bài "ăn theo" (mượn badge zalo_status='sent' qua đồng bộ SĐT, không tự nó ghi dòng
auto_seeding_comments tương ứng) cũng phải được auto_promote_to_can_lien_he như bài gốc.

Tái dùng khuôn fake Supabase (_FakeQuery/_FakeSupabase) từ
test_post_evaluation_auto_promote.py để 2 service (post_evaluation_service gọi từ bên
trong unified_posts_service, và auto_seeding_zalo_service cho test regression bài gốc)
thấy chung 1 trạng thái DB."""

from __future__ import annotations

import asyncio
from typing import Any
from unittest import mock

import pytest

from app.modules.all_platform.services import post_evaluation_service
from app.modules.all_platform.services import auto_seeding_zalo_service
from app.modules.all_platform.services import unified_posts_service


# Khuôn fake Supabase tối giản — sao y từ tests/test_post_evaluation_auto_promote.py
# (không import chéo giữa 2 file test vì tests/ không có __init__.py nên không phải
# package dotted-import được qua pytest mặc định).
class _Result:
    def __init__(self, data):
        self.data = data


class _FakeQuery:
    def __init__(self, rows: list[dict], table: str):
        self.rows = rows
        self.table = table
        self.filters: list[tuple[str, Any]] = []
        self.single = False
        self.op: tuple[str, Any] | None = None
        self.on_conflict: str | None = None

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, key, value):
        self.filters.append((key, value))
        return self

    def in_(self, key, values):
        self.filters.append((key, set(values)))
        return self

    def maybe_single(self):
        self.single = True
        return self

    def insert(self, data):
        self.op = ("insert", data)
        return self

    def upsert(self, data, on_conflict: str | None = None):
        self.op = ("upsert", data)
        self.on_conflict = on_conflict
        return self

    def update(self, data):
        self.op = ("update", data)
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
            if kind == "insert":
                items = payload if isinstance(payload, list) else [payload]
                saved = []
                for item in items:
                    row = dict(item)
                    self.rows.append(row)
                    saved.append(dict(row))
                return _Result(saved)

            if kind == "upsert":
                items = payload if isinstance(payload, list) else [payload]
                conflict_keys = self.on_conflict.split(",") if self.on_conflict else []
                saved = []
                for item in items:
                    existing = None
                    if conflict_keys:
                        for row in self.rows:
                            if all(row.get(k) == item.get(k) for k in conflict_keys):
                                existing = row
                                break
                    if existing is not None:
                        existing.update(item)
                        saved.append(dict(existing))
                    else:
                        row = dict(item)
                        self.rows.append(row)
                        saved.append(dict(row))
                return _Result(saved)

            if kind == "update":
                matched = [r for r in self.rows if self._matches(r)]
                for r in matched:
                    r.update(payload)
                return _Result([dict(r) for r in matched])

        matched = [r for r in self.rows if self._matches(r)]
        if self.single:
            return _Result(dict(matched[0]) if matched else None)
        return _Result([dict(r) for r in matched])


class _FakeSupabase:
    def __init__(self):
        self.store: dict[str, list[dict]] = {}

    def table(self, name: str) -> _FakeQuery:
        return _FakeQuery(self.store.setdefault(name, []), name)


def _review_row(fake_db, post_id, platform="facebook"):
    rows = fake_db.store.get("post_quick_review", [])
    return next((r for r in rows if r.get("post_id") == post_id and r.get("platform") == platform), None)


def _history_rows(fake_db, post_id, platform="facebook"):
    rows = fake_db.store.get("post_evaluation_history", [])
    return [r for r in rows if r.get("post_id") == post_id and r.get("platform") == platform]


@pytest.fixture
def fake_db():
    return _FakeSupabase()


@pytest.fixture
def patched_clients(fake_db):
    """auto_promote_to_can_lien_he (gọi từ bên trong _attach_auto_seeding_comments) và
    hook thật ở auto_seeding_zalo_service đều phải trỏ cùng 1 fake_db với
    _attach_auto_seeding_comments (nhận `sb` trực tiếp làm tham số, không tự
    get_supabase_client())."""
    with mock.patch.object(post_evaluation_service, "get_supabase_client", return_value=fake_db), \
            mock.patch.object(auto_seeding_zalo_service, "get_supabase_client", return_value=fake_db):
        yield fake_db


PHONE = "0900000010"


def _seed_sent_row(fake_db, post_id: str, phone: str = PHONE):
    """Bài gốc A: có dòng auto_seeding_comments thật, zalo_status='sent'."""
    fake_db.store.setdefault("auto_seeding_comments", []).append(
        {
            "id_post_fb": post_id,
            "id_post_li": None,
            "platform": "facebook",
            "phone_number": phone,
            "zalo_status": "sent",
            "zalo_sent_at": "2026-11-17T00:00:00+00:00",
            "zalo_display_name": "Khach A",
        }
    )


# ---------------------------------------------------------------------------
# (a) Bài B mượn zalo_status='sent' qua đồng bộ SĐT từ bài A, B đang "chua-danh-gia"
#     (không có dòng post_quick_review) -> B tự chuyển can-lien-he, có đúng 1 history
#     auto_contact_signal.
# ---------------------------------------------------------------------------
def test_a_borrowed_badge_promotes_unevaluated_post(patched_clients):
    fake_db = patched_clients
    _seed_sent_row(fake_db, "post-a")

    posts = [
        {"id": "post-a", "phone_number": PHONE, "content": ""},
        {"id": "post-b", "phone_number": PHONE, "content": ""},  # tự nó không có dòng auto_seeding_comments
    ]
    unified_posts_service._attach_auto_seeding_comments(fake_db, posts, platform="facebook")

    post_b = next(p for p in posts if p["id"] == "post-b")
    assert post_b["zalo_status"] == "sent"  # badge hiển thị đúng như trước (mượn)

    review_b = _review_row(fake_db, "post-b")
    assert review_b is not None
    assert review_b["evaluation_code"] == "can-lien-he"

    history_b = _history_rows(fake_db, "post-b")
    assert len(history_b) == 1
    assert history_b[0]["action_type"] == "auto_contact_signal"


# ---------------------------------------------------------------------------
# (b) Bài B mượn badge tương tự nhưng ĐÃ được đánh giá thủ công (khong-phu-hop) ->
#     giữ nguyên, không ghi đè, không có history mới.
# ---------------------------------------------------------------------------
def test_b_borrowed_badge_does_not_override_manual_evaluation(patched_clients):
    fake_db = patched_clients
    _seed_sent_row(fake_db, "post-a2")
    fake_db.store.setdefault("post_quick_review", []).append(
        {"post_id": "post-b2", "platform": "facebook", "evaluation_code": "khong-phu-hop", "exclude_keyword_exempt": False}
    )

    posts = [
        {"id": "post-a2", "phone_number": PHONE, "content": ""},
        {"id": "post-b2", "phone_number": PHONE, "content": ""},
    ]
    unified_posts_service._attach_auto_seeding_comments(fake_db, posts, platform="facebook")

    review_b = _review_row(fake_db, "post-b2")
    assert review_b["evaluation_code"] == "khong-phu-hop"
    assert _history_rows(fake_db, "post-b2") == []


# ---------------------------------------------------------------------------
# (c) Gọi enrichment 2 lần liên tiếp cho cùng bài B (mô phỏng load feed 2 lần) ->
#     không tạo history thừa ở lần gọi thứ 2.
# ---------------------------------------------------------------------------
def test_c_calling_enrichment_twice_does_not_duplicate_history(patched_clients):
    fake_db = patched_clients
    _seed_sent_row(fake_db, "post-a3")

    def make_posts():
        return [
            {"id": "post-a3", "phone_number": PHONE, "content": ""},
            {"id": "post-b3", "phone_number": PHONE, "content": ""},
        ]

    unified_posts_service._attach_auto_seeding_comments(fake_db, make_posts(), platform="facebook")
    assert len(_history_rows(fake_db, "post-b3")) == 1

    # Load feed lần 2 (posts mới, cùng dữ liệu) -> review đã là can-lien-he, pre-filter
    # (get_reviews_by_post_ids) phải chặn không gọi lại auto_promote_to_can_lien_he nữa.
    unified_posts_service._attach_auto_seeding_comments(fake_db, make_posts(), platform="facebook")

    review_b = _review_row(fake_db, "post-b3")
    assert review_b["evaluation_code"] == "can-lien-he"
    assert len(_history_rows(fake_db, "post-b3")) == 1


# ---------------------------------------------------------------------------
# (d) Regression: bài gốc A (tự nó zalo_status='sent' thật qua hook đã có trong
#     auto_seeding_zalo_service.py) vẫn hoạt động như cũ, không bị ảnh hưởng bởi thay
#     đổi ở _attach_auto_seeding_comments.
# ---------------------------------------------------------------------------
def test_d_original_write_time_hook_still_works(patched_clients):
    fake_db = patched_clients
    fake_db.store.setdefault("auto_seeding_comments", []).append(
        {"id": "comment-d", "platform": "facebook", "id_post_fb": "post-d4", "id_post_li": None}
    )

    async def run():
        with mock.patch.object(auto_seeding_zalo_service, "load_zca_auth", new=mock.AsyncMock(return_value={"token": "x"})), \
                mock.patch.object(auto_seeding_zalo_service, "find_zca_user_by_phone", new=mock.AsyncMock(return_value={"uid": "zalo-uid-d4"})), \
                mock.patch.object(auto_seeding_zalo_service, "send_zca_message", new=mock.AsyncMock(return_value=None)), \
                mock.patch("app.modules.all_platform.zalo.services.supabase_service.upsert_group", new=mock.AsyncMock(return_value=None)), \
                mock.patch("app.modules.all_platform.services.zalo_inbox_kpi_service.record_post_feed_outbound", return_value=None):
            await auto_seeding_zalo_service.maybe_send_zalo_consult(
                comment_id="comment-d", contact_phone="+84900000099", need_category="website"
            )

    asyncio.run(run())

    review = _review_row(fake_db, "post-d4")
    assert review is not None
    assert review["evaluation_code"] == "can-lien-he"
    assert len(_history_rows(fake_db, "post-d4")) == 1
