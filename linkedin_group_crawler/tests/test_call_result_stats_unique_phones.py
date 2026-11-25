"""Tests cho get_call_result_stats — "Tổng số điện thoại" (total_unique_phones_count, 2026-11-25):
COUNT(DISTINCT SĐT) trích bằng regex từ `content` của tập bài "phù hợp" trong kỳ, dùng CHUNG cho
cả card "Cuộc gọi" và "Zalo", LUÔN toàn cục (không lọc theo thành viên). Tests tự chứa (tests/
không có conftest.py), tái dùng đúng harness fake Supabase tối giản như
test_call_result_stats_comment_count.py (không import chéo file test khác)."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any
from unittest import mock

import pytest

from app.modules.all_platform.services import post_call_result_service as svc
from app.modules.all_platform.services.supabase_kpi_service import _vn_week_range_to_utc


class _Result:
    def __init__(self, data):
        self.data = data


class _NotProxy:
    def __init__(self, query: "_FakeQuery"):
        self._query = query

    def is_(self, key, _value):
        self._query.filters.append(("is_not_null", key, None))
        return self._query


class _FakeQuery:
    def __init__(self, rows: list[dict]):
        self.rows = rows
        self.filters: list[tuple] = []
        self.not_ = _NotProxy(self)

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, key, value):
        self.filters.append(("eq", key, value))
        return self

    def in_(self, key, values):
        self.filters.append(("in", key, set(values)))
        return self

    def gte(self, key, value):
        self.filters.append(("gte", key, value))
        return self

    def lte(self, key, value):
        self.filters.append(("lte", key, value))
        return self

    def _matches(self, row: dict) -> bool:
        for op, key, value in self.filters:
            v = row.get(key)
            if op == "eq":
                if v != value:
                    return False
            elif op == "in":
                if v not in value:
                    return False
            elif op == "gte":
                if v is None or str(v) < str(value):
                    return False
            elif op == "lte":
                if v is None or str(v) > str(value):
                    return False
            elif op == "is_not_null":
                if v is None:
                    return False
        return True

    def execute(self):
        return _Result([dict(r) for r in self.rows if self._matches(r)])


class _FakeSupabase:
    def __init__(self):
        self.store: dict[str, list[dict]] = {}

    def table(self, name: str) -> _FakeQuery:
        return _FakeQuery(self.store.setdefault(name, []))


ADMIN_USER: dict[str, Any] = {"id": "admin-1", "role": "admin"}


@pytest.fixture
def fake_db():
    return _FakeSupabase()


@pytest.fixture
def patched(fake_db):
    with mock.patch.object(svc, "get_supabase_client", return_value=fake_db), \
            mock.patch.object(svc, "get_categories_by_type", return_value=[]):
        yield fake_db


def _inside(start_iso: str, hours: int = 1) -> str:
    dt = datetime.fromisoformat(start_iso) + timedelta(hours=hours)
    return dt.isoformat()


def test_dedupes_same_phone_across_multiple_posts(patched):
    fake_db = patched
    cur_start, _ = _vn_week_range_to_utc("2026-11-10", "2026-11-10")

    fake_db.store.setdefault("facebook_posts", []).extend([
        {"id": "fb-1", "crawl_date": _inside(cur_start, 1), "content": "Liên hệ 0901234567 nhé"},
        {"id": "fb-2", "crawl_date": _inside(cur_start, 2), "content": "SĐT: 0901234567"},
        {"id": "fb-3", "crawl_date": _inside(cur_start, 3), "content": "Gọi mình 0987654321"},
    ])

    data = svc.get_call_result_stats(ADMIN_USER, date_from="2026-11-10", date_to="2026-11-10")

    # fb-1/fb-2 cùng 1 SĐT -> chỉ tính 1 lần; fb-3 là SĐT khác -> tổng 2 SĐT duy nhất.
    assert data["total_unique_phones_count"] == 2


def test_excludes_khong_phu_hop_posts(patched):
    fake_db = patched
    cur_start, _ = _vn_week_range_to_utc("2026-11-10", "2026-11-10")

    fake_db.store.setdefault("facebook_posts", []).extend([
        {"id": "fb-1", "crawl_date": _inside(cur_start, 1), "content": "0901234567"},
        {"id": "fb-2", "crawl_date": _inside(cur_start, 2), "content": "0987654321"},
    ])
    fake_db.store.setdefault("post_quick_review", []).extend([
        {"post_id": "fb-2", "platform": "facebook", "evaluation_code": "khong-phu-hop"},
    ])

    data = svc.get_call_result_stats(ADMIN_USER, date_from="2026-11-10", date_to="2026-11-10")

    # fb-2 bị đánh giá "Không phù hợp" -> SĐT của nó không được tính.
    assert data["total_unique_phones_count"] == 1


def test_ignores_posts_without_extractable_phone(patched):
    fake_db = patched
    cur_start, _ = _vn_week_range_to_utc("2026-11-10", "2026-11-10")

    fake_db.store.setdefault("facebook_posts", []).extend([
        {"id": "fb-1", "crawl_date": _inside(cur_start, 1), "content": "Bài này không có SĐT nào cả"},
        {"id": "fb-2", "crawl_date": _inside(cur_start, 2), "content": None},
    ])

    data = svc.get_call_result_stats(ADMIN_USER, date_from="2026-11-10", date_to="2026-11-10")

    assert data["total_unique_phones_count"] == 0


def test_counts_across_multiple_platforms(patched):
    fake_db = patched
    cur_start, _ = _vn_week_range_to_utc("2026-11-10", "2026-11-10")

    fake_db.store.setdefault("facebook_posts", []).extend([
        {"id": "fb-1", "crawl_date": _inside(cur_start, 1), "content": "0901234567"},
    ])
    fake_db.store.setdefault("linkedin_posts", []).extend([
        {"id": "li-1", "crawl_date": _inside(cur_start, 1), "content": "0987654321"},
    ])
    fake_db.store.setdefault("threads_posts", []).extend([
        {"id": "th-1", "crawl_date": _inside(cur_start, 1), "content": "0901234567"},  # trùng fb-1
    ])

    data = svc.get_call_result_stats(ADMIN_USER, date_from="2026-11-10", date_to="2026-11-10")

    # 0901234567 trùng giữa facebook + threads -> chỉ tính 1 lần; cộng 0987654321 (linkedin) -> 2.
    assert data["total_unique_phones_count"] == 2


def test_not_scoped_by_member_id_even_when_filtering(patched):
    """Xác nhận 2026-11-25: total_unique_phones_count LUÔN toàn cục, KHÔNG thu hẹp theo
    member_id dù dropdown "Tất cả thành viên" đang lọc 1 người cụ thể — khác hẳn
    comment_post_pool_count (có thu hẹp theo scope_member_id)."""
    fake_db = patched
    cur_start, _ = _vn_week_range_to_utc("2026-11-10", "2026-11-10")

    fake_db.store.setdefault("facebook_posts", []).extend([
        {"id": "fb-1", "crawl_date": _inside(cur_start, 1), "content": "0901234567", "id_member": "mem-a"},
        {"id": "fb-2", "crawl_date": _inside(cur_start, 2), "content": "0987654321", "id_member": "mem-b"},
    ])

    data_all = svc.get_call_result_stats(ADMIN_USER, date_from="2026-11-10", date_to="2026-11-10")
    data_scoped = svc.get_call_result_stats(
        ADMIN_USER, date_from="2026-11-10", date_to="2026-11-10", member_id="mem-a"
    )

    assert data_all["total_unique_phones_count"] == 2
    assert data_scoped["total_unique_phones_count"] == 2


def test_resilient_when_post_quick_review_missing(patched):
    """Lỗi đọc post_quick_review (vd chưa áp migration) không được làm sập cả API — bỏ qua
    loại trừ "không phù hợp" thay vì raise, giống hành vi của _get_suitable_post_ids."""
    fake_db = patched
    cur_start, _ = _vn_week_range_to_utc("2026-11-10", "2026-11-10")

    fake_db.store.setdefault("facebook_posts", []).extend([
        {"id": "fb-1", "crawl_date": _inside(cur_start, 1), "content": "0901234567"},
    ])

    class _RaisingPostQuickReviewQuery(_FakeQuery):
        def execute(self):
            raise RuntimeError('relation "post_quick_review" does not exist')

    orig_table = fake_db.table

    def _table(name: str):
        if name == "post_quick_review":
            return _RaisingPostQuickReviewQuery(fake_db.store.setdefault(name, []))
        return orig_table(name)

    with mock.patch.object(fake_db, "table", side_effect=_table):
        data = svc.get_call_result_stats(ADMIN_USER, date_from="2026-11-10", date_to="2026-11-10")

    assert data["total_unique_phones_count"] == 1
