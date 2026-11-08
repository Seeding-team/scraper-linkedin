"""Phan quyen theo CRM Team: admin full, Sale (scope system) full, Team Sale member chi du lieu team (union nhieu team)."""
from unittest import mock

from app.modules.all_platform.services import crm_permission_service as perm


def _user(role="member", scope="team", qbr="sale", uid="u1"):
    return {"id": uid, "role": role, "quote_business_role": qbr, "permission_group_id": "g", "data_scope": scope}


def _patch(scope, team_ids, members):
    return (
        mock.patch.object(perm, "get_effective_permissions", return_value={"modules": None, "scope": scope, "group": {}}),
        mock.patch.object(perm, "get_crm_team_ids_for_user", return_value=set(team_ids)),
        mock.patch.object(perm, "get_crm_team_member_ids", side_effect=lambda t: set(members.get(t, set()))),
        mock.patch.object(perm, "is_sale_member", return_value=False),
        mock.patch.object(perm, "get_linked_member_team", return_value=None),
    )


def _run(scope, team_ids, members, fn):
    patches = _patch(scope, team_ids, members)
    for p in patches:
        p.start()
    try:
        return fn()
    finally:
        for p in patches:
            p.stop()


def test_team_member_is_not_full_access_even_with_sale_role():
    assert _run("team", {"T1"}, {"T1": {"u1", "u2"}}, lambda: perm.has_full_crm_access(_user())) is False


def test_system_scope_sale_is_full_and_admin_always_full():
    assert _run("system", set(), {}, lambda: perm.has_full_crm_access(_user(scope="system"))) is True
    assert _run("team", {"T1"}, {}, lambda: perm.has_full_crm_access(_user(role="admin"))) is True


def test_union_of_multiple_teams():
    members = {"T1": {"u1", "a"}, "T2": {"u1", "b"}}
    ids = _run("team", {"T1", "T2"}, members, lambda: perm.get_scope_visible_user_ids(_user()))
    assert ids == {"u1", "a", "b"}


def test_access_only_to_team_data():
    members = {"T1": {"u1", "a"}}
    can = lambda *owners, **kw: _run("team", {"T1"}, members, lambda: perm.can_access_by_scope(_user(), *owners, **kw))
    assert can("a") is True
    assert can("stranger") is False
    assert can(None, "stranger", team_id="T1") is True      # lead gan truc tiep CRM Team cua minh
    assert can(None, team_id="T9") is False                 # team khac
    assert can() is False


def test_filter_rows_by_scope_keeps_only_team_rows():
    rows = [{"id": 1, "ownerId": "a"}, {"id": 2, "ownerId": "x"}, {"id": 3, "createdById": "u1"}]
    members = {"T1": {"u1", "a"}}
    kept = _run("team", {"T1"}, members, lambda: perm.filter_rows_by_scope(_user(), rows, ("ownerId", "createdById")))
    assert [r["id"] for r in kept] == [1, 3]
    # user khong bi gioi han -> giu nguyen
    assert _run("system", set(), {}, lambda: perm.filter_rows_by_scope(_user(scope="system"), rows, ("ownerId",))) == rows
