"""total_interacted tren card Seeding noi bo: dem moi nguoi comment thanh cong, khong loc theo team duoc giao, khong phu thuoc role nguoi xem."""
from unittest import mock

from app.modules.all_platform.services import supabase_internal_engagement_kpi_service as svc

LINK = "https://www.facebook.com/share/p/1Bf3LFJ8iQ/"


class _Query:
    def __init__(self, rows):
        self._rows = rows
        self._filters = []

    def select(self, *_a, **_kw):
        return self

    def eq(self, col, val):
        self._filters.append((col, val))
        return self

    def execute(self):
        rows = [r for r in self._rows if all(r.get(c) == v for c, v in self._filters)]
        return mock.Mock(data=rows)


class _FakeSupabase:
    def __init__(self, tables):
        self._tables = tables

    def table(self, name):
        return _Query(self._tables.get(name, []))


def _kpi(member, status="success", link=LINK):
    return {"id_member": member, "status": status, "link_post": link}


def _counts(tables, role="member", teams=None):
    with mock.patch.object(svc, "get_supabase_client", return_value=_FakeSupabase(tables)), \
         mock.patch.object(svc, "resolve_team_scope", return_value=(teams or [], role)):
        return svc.get_post_team_counts(LINK, "x@example.com")


def test_commenter_outside_assigned_team_is_counted():
    # Bai giao cho team T1 (thanh vien a, b) — nguoi comment "leader" khong nam trong team van duoc tinh.
    tables = {
        "internal_engagement_custom_posts": [{"link_post": LINK, "assigned_team_ids": ["T1"]}],
        "internal_engagement_kpi": [_kpi("leader")],
    }
    assert _counts(tables)["total_interacted"] == 1


def test_distinct_members_success_only_and_same_post_only():
    tables = {
        "internal_engagement_custom_posts": [{"link_post": LINK, "assigned_team_ids": ["T1"]}],
        "internal_engagement_kpi": [
            _kpi("a"), _kpi("a"),            # 2 lan cung 1 nguoi -> 1
            _kpi("b"),
            _kpi("c", status="failed"),      # that bai -> khong tinh
            _kpi("d", link="https://other"), # bai khac -> khong tinh
            {"id_member": None, "status": "success", "link_post": LINK},
        ],
    }
    assert _counts(tables)["total_interacted"] == 2


def test_post_without_assignment_and_no_comments():
    assert _counts({"internal_engagement_kpi": [_kpi("a")]})["total_interacted"] == 1
    assert _counts({})["total_interacted"] == 0


def test_total_independent_of_viewer_role():
    tables = {"internal_engagement_kpi": [_kpi("a"), _kpi("b")]}
    for role in ("member", "leader", "admin"):
        assert _counts(tables, role=role)["total_interacted"] == 2
