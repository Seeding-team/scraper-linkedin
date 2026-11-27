"""Test cho `get_evaluation_status_counts()` (2026-11-27) — COUNT thật từ DB cho dropdown
"Trạng thái liên hệ" (Post Feed), thay cho cách đếm tay cũ ở client (`seedingMetrics`, useMemo
trên mảng `posts` đã tải, bị giới hạn cứng `page_size=50` nên luôn ra số thấp hơn thực tế).

Test trọng tâm: (1) đếm đúng > 50 bài (chứng minh không còn bị giới hạn page_size cũ); (2) lọc
đúng theo `service_area` (tên hiển thị team) cho cả facebook/linkedin (qua group.id_team) và
threads/youtube (qua member_of_teams); (3) bucket đúng evaluation_code, bỏ qua mã lạ; (4) khu
vực không khớp team nào -> trả về 0 ngay, không quét bảng post nào (tối ưu, không phải chỉ đúng).
"""

from __future__ import annotations

from typing import Any

import pytest

from app.modules.all_platform.services import unified_posts_service as svc


class _Result:
    def __init__(self, data=None):
        self.data = data or []


class _FakeQuery:
    def __init__(self, rows: list[dict], table: str, poison: bool = False):
        self.rows = rows
        self.table = table
        self.poison = poison
        self.filters: list[tuple[str, Any, str]] = []

    def select(self, *_a, **_kw):
        return self

    def eq(self, key, value):
        self.filters.append((key, value, "eq"))
        return self

    def in_(self, key, values):
        self.filters.append((key, set(values), "in_"))
        return self

    def gte(self, key, value):
        self.filters.append((key, value, "gte"))
        return self

    def lte(self, key, value):
        self.filters.append((key, value, "lte"))
        return self

    def _matches(self, row: dict) -> bool:
        for key, value, kind in self.filters:
            cur = row.get(key)
            if kind == "eq" and cur != value:
                return False
            if kind == "in_" and cur not in value:
                return False
            if kind == "gte" and (cur is None or cur < value):
                return False
            if kind == "lte" and (cur is None or cur > value):
                return False
        return True

    def execute(self):
        if self.poison:
            raise AssertionError(f"KHONG duoc quet bang '{self.table}' khi service_area khong khop team nao")
        matched = [r for r in self.rows if self._matches(r)]
        return _Result([dict(r) for r in matched])


class _FakeSupabase:
    def __init__(self):
        self.store: dict[str, list[dict]] = {}
        self._poison_tables: set[str] = set()

    def poison_table(self, name: str) -> None:
        """Bang nay se raise neu bi query toi - dung de chung minh early-return khong quet."""
        self._poison_tables.add(name)

    def table(self, name: str) -> _FakeQuery:
        return _FakeQuery(self.store.setdefault(name, []), name, poison=(name in self._poison_tables))


@pytest.fixture
def fake_db(monkeypatch):
    db = _FakeSupabase()
    monkeypatch.setattr(svc, "_supabase", lambda: db)
    return db


def test_counts_beyond_50_posts_not_capped(fake_db):
    """Chung minh KHONG con bi gioi han page_size=50 kieu cu: 60 bai facebook, khong bai nao
    co review -> phai ra dung 60 'chua-danh-gia', khong phai toi da 50."""
    fake_db.store["facebook_posts"] = [{"id": f"fb-{i}", "group_id": None} for i in range(60)]
    fake_db.store["post_quick_review"] = []

    counts = svc.get_evaluation_status_counts(platform="facebook")

    assert counts["all"] == 60
    assert counts["chua-danh-gia"] == 60
    assert counts["can-lien-he"] == 0
    assert counts["khong-phu-hop"] == 0


def test_buckets_evaluation_codes_correctly_and_ignores_unknown_code(fake_db):
    fake_db.store["facebook_posts"] = [
        {"id": "fb-1", "group_id": None},
        {"id": "fb-2", "group_id": None},
        {"id": "fb-3", "group_id": None},
        {"id": "fb-4", "group_id": None},
    ]
    fake_db.store["post_quick_review"] = [
        {"post_id": "fb-1", "platform": "facebook", "evaluation_code": "can-lien-he"},
        {"post_id": "fb-2", "platform": "facebook", "evaluation_code": "khong-phu-hop"},
        {"post_id": "fb-3", "platform": "facebook", "evaluation_code": "can-xem-xet"},  # ma la, bo qua
        # fb-4: khong co review -> chua-danh-gia
    ]

    counts = svc.get_evaluation_status_counts(platform="facebook")

    assert counts["all"] == 4
    assert counts["can-lien-he"] == 1
    assert counts["khong-phu-hop"] == 1
    assert counts["chua-danh-gia"] == 1  # chi fb-4 - fb-3 (ma la) KHONG duoc tinh vao day


def test_service_area_filters_facebook_posts_via_group_id_team(fake_db):
    fake_db.store["teams"] = [
        {"id": "team-a", "name_team": "Team Dev"},
        {"id": "team-b", "name_team": "Team Sale"},
    ]
    fake_db.store["facebook_groups"] = [
        {"id": "grp-dev", "id_team": "team-a"},
        {"id": "grp-sale", "id_team": "team-b"},
    ]
    fake_db.store["facebook_posts"] = [
        {"id": "fb-dev-1", "group_id": "grp-dev"},
        {"id": "fb-dev-2", "group_id": "grp-dev"},
        {"id": "fb-sale-1", "group_id": "grp-sale"},
    ]
    fake_db.store["post_quick_review"] = []

    counts = svc.get_evaluation_status_counts(platform="facebook", service_area="Team Dev")

    assert counts["all"] == 2
    assert counts["chua-danh-gia"] == 2


def test_service_area_filters_threads_posts_via_member_of_teams(fake_db):
    fake_db.store["teams"] = [{"id": "team-a", "name_team": "Team Dev"}]
    fake_db.store["member_of_teams"] = [
        {"id_member": "mem-1", "id_teams": "team-a"},
        {"id_member": "mem-2", "id_teams": "team-b"},
    ]
    fake_db.store["threads_posts"] = [
        {"id": "th-1", "id_member": "mem-1"},
        {"id": "th-2", "id_member": "mem-2"},
    ]
    fake_db.store["post_quick_review"] = []

    counts = svc.get_evaluation_status_counts(platform="threads", service_area="Team Dev")

    assert counts["all"] == 1
    assert counts["chua-danh-gia"] == 1


def test_service_area_not_matching_any_team_returns_zero_without_scanning_posts(fake_db):
    fake_db.store["teams"] = [{"id": "team-a", "name_team": "Team Dev"}]
    fake_db.poison_table("facebook_posts")  # phai KHONG bi query toi

    counts = svc.get_evaluation_status_counts(platform="facebook", service_area="Khu Vuc Khong Ton Tai")

    assert counts == {"all": 0, "chua-danh-gia": 0, "can-lien-he": 0, "khong-phu-hop": 0}


def test_date_range_filters_counts_to_only_posts_crawled_in_period(fake_db):
    """2026-11-27: doi theo yeu cau - badge gio phai dung theo KY dang chon o
    CallResultStatsWidget, khong con la "toan bo lich su" mac dinh nua."""
    fake_db.store["facebook_posts"] = [
        {"id": "fb-in-range", "group_id": None, "crawl_date": "2026-11-15T10:00:00+00:00"},
        {"id": "fb-before-range", "group_id": None, "crawl_date": "2026-10-01T10:00:00+00:00"},
        {"id": "fb-after-range", "group_id": None, "crawl_date": "2026-12-01T10:00:00+00:00"},
    ]
    fake_db.store["post_quick_review"] = []

    counts = svc.get_evaluation_status_counts(
        platform="facebook", date_from="2026-11-01", date_to="2026-11-30"
    )

    assert counts["all"] == 1
    assert counts["chua-danh-gia"] == 1


def test_no_date_range_means_counts_all_history_like_before(fake_db):
    fake_db.store["facebook_posts"] = [
        {"id": "fb-1", "group_id": None, "crawl_date": "2020-01-01T00:00:00+00:00"},
        {"id": "fb-2", "group_id": None, "crawl_date": "2026-11-15T00:00:00+00:00"},
    ]
    fake_db.store["post_quick_review"] = []

    counts = svc.get_evaluation_status_counts(platform="facebook")

    assert counts["all"] == 2
