"""Tests cho auto_promote_to_can_lien_he (tự nâng đánh giá bài khi có tín hiệu đã liên
hệ) và 2 hook gọi nó: post_call_result_service.update_call_result và
auto_seeding_zalo_service.maybe_send_zalo_consult (nhánh zalo_status='sent')."""

from __future__ import annotations

import asyncio
from typing import Any
from unittest import mock

import pytest

from app.modules.all_platform.services import post_evaluation_service
from app.modules.all_platform.services import post_call_result_service
from app.modules.all_platform.services import auto_seeding_zalo_service


class _Result:
    def __init__(self, data):
        self.data = data


class _FakeQuery:
    """Query builder tối giản, đủ cho .select/.eq/.in_/.maybe_single/.insert/.upsert/.update."""

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


@pytest.fixture
def fake_db():
    return _FakeSupabase()


@pytest.fixture
def patched_clients(fake_db):
    """auto_promote_to_can_lien_he được gọi từ 3 service khác nhau — tất cả phải trỏ
    cùng 1 fake_db để thấy chung 1 trạng thái DB trong mỗi test."""
    with mock.patch.object(post_evaluation_service, "get_supabase_client", return_value=fake_db), \
            mock.patch.object(post_call_result_service, "get_supabase_client", return_value=fake_db), \
            mock.patch.object(auto_seeding_zalo_service, "get_supabase_client", return_value=fake_db):
        yield fake_db


def _review_row(fake_db, post_id, platform="facebook"):
    rows = fake_db.store.get("post_quick_review", [])
    return next((r for r in rows if r.get("post_id") == post_id and r.get("platform") == platform), None)


def _history_rows(fake_db, post_id, platform="facebook"):
    rows = fake_db.store.get("post_evaluation_history", [])
    return [r for r in rows if r.get("post_id") == post_id and r.get("platform") == platform]


# ---------------------------------------------------------------------------
# (a) Post chưa đánh giá + call_result (bất kỳ code nào) -> can-lien-he + 1 history.
# ---------------------------------------------------------------------------
def test_a_call_result_promotes_unevaluated_post(patched_clients):
    fake_db = patched_clients
    post_call_result_service.update_call_result(
        "post-a", {"platform": "facebook", "result_code": "noanswer"}, {"id": "u1"}
    )

    review = _review_row(fake_db, "post-a")
    assert review is not None
    assert review["evaluation_code"] == "can-lien-he"

    history = _history_rows(fake_db, "post-a")
    assert len(history) == 1
    assert history[0]["action_type"] == "auto_contact_signal"
    assert history[0]["evaluated_by"] is None


# ---------------------------------------------------------------------------
# (b) Post đã 'khong-phu-hop' + call_result -> giữ nguyên, không history mới.
# ---------------------------------------------------------------------------
def test_b_call_result_does_not_override_manual_rejection(patched_clients):
    fake_db = patched_clients
    fake_db.store.setdefault("post_quick_review", []).append(
        {"post_id": "post-b", "platform": "facebook", "evaluation_code": "khong-phu-hop", "exclude_keyword_exempt": False}
    )

    post_call_result_service.update_call_result(
        "post-b", {"platform": "facebook", "result_code": "interested"}, {"id": "u1"}
    )

    review = _review_row(fake_db, "post-b")
    assert review["evaluation_code"] == "khong-phu-hop"
    assert _history_rows(fake_db, "post-b") == []


# ---------------------------------------------------------------------------
# (c) Post chưa đánh giá + zalo_status=sent -> can-lien-he.
# ---------------------------------------------------------------------------
def test_c_zalo_sent_promotes_unevaluated_post(patched_clients):
    fake_db = patched_clients
    fake_db.store.setdefault("auto_seeding_comments", []).append(
        {"id": "comment-c", "platform": "facebook", "id_post_fb": "post-c", "id_post_li": None}
    )

    async def run():
        with mock.patch.object(auto_seeding_zalo_service, "load_zca_auth", new=mock.AsyncMock(return_value={"token": "x"})), \
                mock.patch.object(auto_seeding_zalo_service, "find_zca_user_by_phone", new=mock.AsyncMock(return_value={"uid": "zalo-uid-1"})), \
                mock.patch.object(auto_seeding_zalo_service, "send_zca_message", new=mock.AsyncMock(return_value=None)), \
                mock.patch("app.modules.all_platform.zalo.services.supabase_service.upsert_group", new=mock.AsyncMock(return_value=None)), \
                mock.patch("app.modules.all_platform.services.zalo_inbox_kpi_service.record_post_feed_outbound", return_value=None):
            await auto_seeding_zalo_service.maybe_send_zalo_consult(
                comment_id="comment-c", contact_phone="+84900000000", need_category="website"
            )

    asyncio.run(run())

    review = _review_row(fake_db, "post-c")
    assert review is not None
    assert review["evaluation_code"] == "can-lien-he"

    history = _history_rows(fake_db, "post-c")
    assert len(history) == 1
    assert history[0]["action_type"] == "auto_contact_signal"


# ---------------------------------------------------------------------------
# (d) Post chưa đánh giá + zalo_status=failed -> evaluation không đổi (không có dòng).
# ---------------------------------------------------------------------------
def test_d_zalo_failed_does_not_promote(patched_clients):
    fake_db = patched_clients
    fake_db.store.setdefault("auto_seeding_comments", []).append(
        {"id": "comment-d", "platform": "facebook", "id_post_fb": "post-d", "id_post_li": None}
    )

    async def run():
        # load_zca_auth trả None -> rơi vào nhánh zalo_status='failed' sớm nhất (dòng ~98),
        # auto_promote_to_can_lien_he không được gọi (chỉ hook ở nhánh 'sent').
        with mock.patch.object(auto_seeding_zalo_service, "load_zca_auth", new=mock.AsyncMock(return_value=None)):
            await auto_seeding_zalo_service.maybe_send_zalo_consult(
                comment_id="comment-d", contact_phone="+84900000001", need_category="website"
            )

    asyncio.run(run())

    assert _review_row(fake_db, "post-d") is None
    assert _history_rows(fake_db, "post-d") == []


# ---------------------------------------------------------------------------
# (e) Post đã là can-lien-he + thêm 1 call_result nữa -> vẫn can-lien-he, không history mới.
# ---------------------------------------------------------------------------
def test_e_call_result_on_already_promoted_post_is_noop(patched_clients):
    fake_db = patched_clients
    fake_db.store.setdefault("post_quick_review", []).append(
        {"post_id": "post-e", "platform": "facebook", "evaluation_code": "can-lien-he", "exclude_keyword_exempt": False}
    )
    fake_db.store.setdefault("post_evaluation_history", []).append(
        {"post_id": "post-e", "platform": "facebook", "evaluation_code": "can-lien-he", "action_type": "auto_contact_signal"}
    )

    post_call_result_service.update_call_result(
        "post-e", {"platform": "facebook", "result_code": "callback"}, {"id": "u1"}
    )

    review = _review_row(fake_db, "post-e")
    assert review["evaluation_code"] == "can-lien-he"
    assert len(_history_rows(fake_db, "post-e")) == 1  # không tăng thêm


# ---------------------------------------------------------------------------
# (f) Gọi auto_promote_to_can_lien_he 2 lần liên tiếp -> tối đa 1 dòng history.
# ---------------------------------------------------------------------------
def test_f_auto_promote_is_idempotent_across_repeated_calls(patched_clients):
    fake_db = patched_clients

    post_evaluation_service.auto_promote_to_can_lien_he("post-f", "facebook")
    post_evaluation_service.auto_promote_to_can_lien_he("post-f", "facebook")

    review = _review_row(fake_db, "post-f")
    assert review["evaluation_code"] == "can-lien-he"
    assert len(_history_rows(fake_db, "post-f")) == 1
