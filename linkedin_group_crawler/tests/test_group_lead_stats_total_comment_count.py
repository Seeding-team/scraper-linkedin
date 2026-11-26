"""Test cho cột mới "Tổng lượt bình luận" (2026-11-26, bảng Quản lý nhóm) —
`_attach_group_lead_stats()` trong `supabase_groups_service.py` nay đếm thêm
`total_comment_count` từ `seeding_content_kpi.id_post`, tái dùng ĐÚNG `post_group_map`
(post_id -> group_id) đã dựng sẵn từ bước quét `posts_table` hiện có — không quét lại
posts_table, không tái dùng `get_seeding_group_coverage()` (hàm đó nhóm theo group_name text).
"""

from __future__ import annotations

from typing import Any

import pytest

from app.modules.all_platform.services import supabase_groups_service as svc


class _Result:
    def __init__(self, data):
        self.data = data


class _FakeQuery:
    def __init__(self, rows: list[dict]):
        self.rows = rows
        self.filters: list[tuple[str, Any]] = []
        self.raise_on_execute = False

    def select(self, *_a, **_kw):
        return self

    def eq(self, key, value):
        self.filters.append((key, value))
        return self

    def in_(self, key, values):
        self.filters.append((key, set(values)))
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
        if self.raise_on_execute:
            raise RuntimeError("simulated DB error")
        matched = [r for r in self.rows if self._matches(r)]
        return _Result([dict(r) for r in matched])


class _FakeSupabase:
    def __init__(self):
        self.store: dict[str, list[dict]] = {}
        self._fail_tables: set[str] = set()

    def fail_table(self, name: str) -> None:
        self._fail_tables.add(name)

    def table(self, name: str) -> _FakeQuery:
        q = _FakeQuery(self.store.setdefault(name, []))
        if name in self._fail_tables:
            q.raise_on_execute = True
        return q


@pytest.fixture
def fake_db():
    db = _FakeSupabase()
    db.store["facebook_posts"] = [
        {"id": "p1", "group_id": "g1", "lead_score": 80},
        {"id": "p2", "group_id": "g1", "lead_score": 20},
        {"id": "p3", "group_id": "g2", "lead_score": 90},
    ]
    db.store["post_quick_review"] = []
    db.store["seeding_content_kpi"] = [
        {"id_post": "p1"},
        {"id_post": "p1"},
        {"id_post": "p3"},
        {"id_post": "post-not-in-this-table"},  # khong khop post_group_map -> bi bo qua
    ]
    return db


def test_total_comment_count_grouped_by_group_id_via_post_group_map(fake_db):
    rows = [{"id": "g1"}, {"id": "g2"}, {"id": "g3"}]

    result = svc._attach_group_lead_stats(fake_db, rows, "facebook_posts", "group_id")

    by_id = {r["id"]: r for r in result}
    assert by_id["g1"]["total_comment_count"] == 2  # p1 x2
    assert by_id["g2"]["total_comment_count"] == 1  # p3 x1
    assert by_id["g3"]["total_comment_count"] == 0  # khong co bai nao
    assert "total_comment_stats_error" not in by_id["g1"]


def test_total_comment_count_error_flag_does_not_affect_other_stats(fake_db):
    fake_db.fail_table("seeding_content_kpi")
    rows = [{"id": "g1"}, {"id": "g2"}]

    result = svc._attach_group_lead_stats(fake_db, rows, "facebook_posts", "group_id")

    by_id = {r["id"]: r for r in result}
    assert by_id["g1"]["total_comment_stats_error"] is True
    assert by_id["g1"]["total_comment_count"] == 0
    # Thong ke diem AI / can-lien-he khac KHONG bi anh huong boi loi cua seeding_content_kpi.
    assert by_id["g1"]["high_lead_post_count"] == 1
    assert "lead_stats_error" not in by_id["g1"]
    assert "can_lien_he_stats_error" not in by_id["g1"]


def test_total_comment_count_regression_can_lien_he_still_works(fake_db):
    fake_db.store["post_quick_review"] = [
        {"post_id": "p1", "platform": "facebook", "evaluation_code": "can-lien-he"},
        {"post_id": "p3", "platform": "facebook", "evaluation_code": "can-lien-he"},
        {"post_id": "p2", "platform": "facebook", "evaluation_code": "chua-danh-gia"},
    ]
    rows = [{"id": "g1"}, {"id": "g2"}]

    result = svc._attach_group_lead_stats(fake_db, rows, "facebook_posts", "group_id")

    by_id = {r["id"]: r for r in result}
    assert by_id["g1"]["can_lien_he_post_count"] == 1  # p1
    assert by_id["g2"]["can_lien_he_post_count"] == 1  # p3
    assert by_id["g1"]["total_comment_count"] == 2
    assert by_id["g2"]["total_comment_count"] == 1
