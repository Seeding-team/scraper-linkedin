"""Tests cho get_call_result_stats — cột "Comment" mới (đếm seeding_content_kpi trong kỳ +
kỳ trước để tính xu hướng), thay cho "Khách đã phản hồi" cũ đã bị xoá khỏi widget (xem
CallResultStatsWidget, phiên 2026-11-17). Tests tự chứa (tests/ không có conftest.py), harness
fake Supabase tối giản chỉ đủ cho get_call_result_stats (không tái dùng harness ở file khác)."""

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


class _RaisingSupabase(_FakeSupabase):
    """Mô phỏng bảng seeding_content_kpi chưa tồn tại / lỗi quyền (vd DB dev chưa áp migration) —
    get_call_result_stats phải nuốt lỗi và trả comment_count=0 thay vì sập cả API."""

    def table(self, name: str) -> _FakeQuery:
        if name == "seeding_content_kpi":
            raise RuntimeError("relation \"seeding_content_kpi\" does not exist")
        return super().table(name)


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


def test_comment_count_current_and_prev_period(patched):
    fake_db = patched
    cur_start, _ = _vn_week_range_to_utc("2026-11-10", "2026-11-10")
    prev_start, _ = _vn_week_range_to_utc("2026-11-09", "2026-11-09")

    rows = fake_db.store.setdefault("seeding_content_kpi", [])
    rows.extend([
        {"id_member": "mem-a", "created_at": _inside(cur_start, 1)},
        {"id_member": "mem-a", "created_at": _inside(cur_start, 2)},
        {"id_member": "mem-b", "created_at": _inside(cur_start, 3)},
        {"id_member": "mem-a", "created_at": _inside(prev_start, 1)},
        {"id_member": "mem-b", "created_at": _inside(prev_start, 2)},
        {"id_member": "mem-a", "created_at": "2026-11-05T00:00:00+00:00"},  # ngoài cả 2 kỳ
    ])

    data = svc.get_call_result_stats(ADMIN_USER, date_from="2026-11-10", date_to="2026-11-10")
    assert data["comment_count"] == 3
    assert data["comment_count_prev"] == 2


def test_comment_count_scoped_by_member_id(patched):
    fake_db = patched
    cur_start, _ = _vn_week_range_to_utc("2026-11-10", "2026-11-10")
    rows = fake_db.store.setdefault("seeding_content_kpi", [])
    rows.extend([
        {"id_member": "mem-a", "created_at": _inside(cur_start, 1)},
        {"id_member": "mem-b", "created_at": _inside(cur_start, 1)},
        {"id_member": "mem-b", "created_at": _inside(cur_start, 2)},
    ])

    data = svc.get_call_result_stats(
        ADMIN_USER, date_from="2026-11-10", date_to="2026-11-10", member_id="mem-b"
    )
    assert data["comment_count"] == 2


def test_comment_count_resilient_when_table_missing():
    """Bảng seeding_content_kpi lỗi (vd chưa áp migration ở DB dev) không được làm sập toàn bộ
    /call-results/stats — comment_count phải rơi về 0, các field khác (total/by_type) vẫn trả về."""
    raising_db = _RaisingSupabase()
    with mock.patch.object(svc, "get_supabase_client", return_value=raising_db), \
            mock.patch.object(svc, "get_categories_by_type", return_value=[]):
        data = svc.get_call_result_stats(ADMIN_USER, date_from="2026-11-10", date_to="2026-11-10")

    assert data["comment_count"] == 0
    assert data["comment_count_prev"] == 0
    assert data["total"] == 0
    assert data["by_type"] == []
