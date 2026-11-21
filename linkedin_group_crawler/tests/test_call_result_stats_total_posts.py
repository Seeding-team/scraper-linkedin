"""Tests cho get_call_result_stats — card "Tổng bài" mới (Việc 1, 2026-11-21): đếm bài crawl
(crawl_date) trong kỳ + kỳ trước liền kề, qua `facebook_posts`/`linkedin_posts`/`threads_posts`/
`youtube_posts`, KHÔNG lọc theo member. Tests tự chứa (tests/ không có conftest.py), harness fake
Supabase tối giản hỗ trợ thêm `count="exact"` (không tái dùng harness ở file khác)."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any
from unittest import mock

import pytest

from app.modules.all_platform.services import post_call_result_service as svc
from app.modules.all_platform.services.supabase_kpi_service import _vn_week_range_to_utc


class _Result:
    def __init__(self, data, count=None):
        self.data = data
        self.count = count


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
        self._count_mode: str | None = None
        self.not_ = _NotProxy(self)

    def select(self, *_args, count=None, **_kwargs):
        self._count_mode = count
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
        matched = [dict(r) for r in self.rows if self._matches(r)]
        count = len(matched) if self._count_mode == "exact" else None
        return _Result(matched, count=count)


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


def test_total_posts_count_sums_all_platforms_when_unfiltered(patched):
    fake_db = patched
    cur_start, _ = _vn_week_range_to_utc("2026-11-10", "2026-11-10")
    prev_start, _ = _vn_week_range_to_utc("2026-11-09", "2026-11-09")

    fake_db.store.setdefault("facebook_posts", []).extend([
        {"id": "fb-1", "crawl_date": _inside(cur_start, 1)},
        {"id": "fb-2", "crawl_date": _inside(cur_start, 2)},
    ])
    fake_db.store.setdefault("linkedin_posts", []).extend([
        {"id": "li-1", "crawl_date": _inside(cur_start, 1)},
    ])
    fake_db.store.setdefault("threads_posts", []).extend([
        {"id": "th-1", "crawl_date": _inside(prev_start, 1)},
    ])
    fake_db.store.setdefault("youtube_posts", []).extend([
        {"id": "yt-1", "crawl_date": _inside(prev_start, 1)},
        {"id": "yt-2", "crawl_date": _inside(prev_start, 2)},
    ])

    data = svc.get_call_result_stats(ADMIN_USER, date_from="2026-11-10", date_to="2026-11-10")
    assert data["total_posts_count"] == 3
    assert data["total_posts_count_prev"] == 3


def test_total_posts_count_scoped_to_single_platform(patched):
    fake_db = patched
    cur_start, _ = _vn_week_range_to_utc("2026-11-10", "2026-11-10")

    fake_db.store.setdefault("facebook_posts", []).extend([
        {"id": "fb-1", "crawl_date": _inside(cur_start, 1)},
    ])
    fake_db.store.setdefault("linkedin_posts", []).extend([
        {"id": "li-1", "crawl_date": _inside(cur_start, 1)},
        {"id": "li-2", "crawl_date": _inside(cur_start, 2)},
    ])

    data = svc.get_call_result_stats(
        ADMIN_USER, date_from="2026-11-10", date_to="2026-11-10", platform="linkedin"
    )
    assert data["total_posts_count"] == 2


def test_total_posts_count_not_scoped_by_member(patched):
    """Khác với comment_count — đếm bài crawl KHÔNG được lọc theo member_id (bài dùng chung)."""
    fake_db = patched
    cur_start, _ = _vn_week_range_to_utc("2026-11-10", "2026-11-10")
    fake_db.store.setdefault("facebook_posts", []).extend([
        {"id": "fb-1", "crawl_date": _inside(cur_start, 1)},
        {"id": "fb-2", "crawl_date": _inside(cur_start, 2)},
    ])

    data = svc.get_call_result_stats(
        ADMIN_USER, date_from="2026-11-10", date_to="2026-11-10", member_id="mem-a"
    )
    assert data["total_posts_count"] == 2


def test_total_posts_count_resilient_when_table_missing():
    class _RaisingSupabase(_FakeSupabase):
        def table(self, name: str) -> _FakeQuery:
            if name == "facebook_posts":
                raise RuntimeError("relation \"facebook_posts\" does not exist")
            return super().table(name)

    raising_db = _RaisingSupabase()
    with mock.patch.object(svc, "get_supabase_client", return_value=raising_db), \
            mock.patch.object(svc, "get_categories_by_type", return_value=[]):
        data = svc.get_call_result_stats(ADMIN_USER, date_from="2026-11-10", date_to="2026-11-10")

    # facebook_posts loi -> bo qua rieng bang do, cac bang platform khac (rong trong test nay)
    # van duoc cong binh thuong, total_posts_count ve 0 thay vi sap ca API.
    assert data["total_posts_count"] == 0
    assert data["total_posts_count_prev"] == 0
    assert data["total"] == 0
