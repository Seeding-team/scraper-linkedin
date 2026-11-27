"""Tests cho post_contact_activity_service (who-bar + activity log), zalo_inbox_kpi_service
.get_post_feed_message_stats, và unified_posts_service._resolve_post_ids_by_contact_member —
phần "Kết quả liên hệ đầy đủ" (gộp seeding/call/zalo) dựng theo prototype."""

from __future__ import annotations

from typing import Any
from unittest import mock

import pytest

from app.modules.all_platform.services import post_contact_activity_service as svc
from app.modules.all_platform.services import post_call_result_service
from app.modules.all_platform.services import zalo_inbox_kpi_service
from app.modules.all_platform.services import unified_posts_service
from app.modules.all_platform.services.zalo_inbox_kpi_service import _vn_range_to_utc_bounds


class _Result:
    def __init__(self, data, count=None):
        self.data = data
        self.count = count


class _NotProxy:
    def __init__(self, query: "_FakeQuery"):
        self._query = query

    def is_(self, key, _value):
        # Chỉ dùng cho "not_.is_(col, 'null')" -> IS NOT NULL
        self._query.filters.append(("is_not_null", key, None))
        return self._query


class _FakeQuery:
    def __init__(self, rows: list[dict]):
        self.rows = rows
        self.filters: list[tuple] = []
        self.order_col: str | None = None
        self.order_desc = False
        self.limit_n: int | None = None
        self.count_mode: str | None = None
        self.not_ = _NotProxy(self)

    def select(self, *_args, **_kwargs):
        if _kwargs.get("count") == "exact":
            self.count_mode = "exact"
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

    def lt(self, key, value):
        self.filters.append(("lt", key, value))
        return self

    def is_(self, key, value):
        # Plain (khong qua not_) -> "IS NULL" khi value == 'null'
        self.filters.append(("is_null", key, None))
        return self

    def order(self, col, desc=False):
        self.order_col = col
        self.order_desc = desc
        return self

    def limit(self, n):
        self.limit_n = n
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
            elif op == "lt":
                if v is None or str(v) >= str(value):
                    return False
            elif op == "is_not_null":
                if v is None:
                    return False
            elif op == "is_null":
                if v is not None:
                    return False
        return True

    def execute(self):
        matched = [dict(r) for r in self.rows if self._matches(r)]
        count = len(matched) if self.count_mode == "exact" else None
        if self.order_col:
            matched.sort(key=lambda r: str(r.get(self.order_col) or ""), reverse=self.order_desc)
        if self.limit_n is not None:
            matched = matched[: self.limit_n]
        return _Result(matched, count=count)


class _FakeSupabase:
    def __init__(self):
        self.store: dict[str, list[dict]] = {}

    def table(self, name: str) -> _FakeQuery:
        return _FakeQuery(self.store.setdefault(name, []))


ADMIN_USER: dict[str, Any] = {"id": "admin-1", "role": "admin"}
MEMBER_A = {"id": "mem-a", "name": "Nguyễn A", "email": "a@x.com"}
MEMBER_B = {"id": "mem-b", "name": "Trần B", "email": "b@x.com"}


@pytest.fixture
def fake_db():
    return _FakeSupabase()


@pytest.fixture
def patched_clients(fake_db):
    with mock.patch.object(svc, "get_supabase_client", return_value=fake_db), \
            mock.patch.object(zalo_inbox_kpi_service, "get_supabase_client", return_value=fake_db), \
            mock.patch.object(post_call_result_service, "get_supabase_client", return_value=fake_db):
        yield fake_db


def _bounds(date_from="2026-11-10", date_to="2026-11-10"):
    _, _, start_utc, end_utc = _vn_range_to_utc_bounds(date_from, date_to)
    return start_utc, end_utc


def _inside(start_utc: str) -> str:
    # 1 gio sau moc bat dau ky - chac chan nam trong khoang [start, end)
    import datetime
    dt = datetime.datetime.fromisoformat(start_utc) + datetime.timedelta(hours=1)
    return dt.isoformat()


def _outside_before(start_utc: str) -> str:
    import datetime
    dt = datetime.datetime.fromisoformat(start_utc) - datetime.timedelta(hours=1)
    return dt.isoformat()


def test_who_did_what_merges_3_sources_and_sorts_desc(patched_clients):
    fake_db = patched_clients
    start_utc, _ = _bounds()
    ts_in = _inside(start_utc)
    ts_out = _outside_before(start_utc)

    fake_db.store["seeding_content_kpi"] = [
        {"id_member": "mem-a", "created_at": ts_in, "member": MEMBER_A},
        {"id_member": "mem-a", "created_at": ts_out, "member": MEMBER_A},  # ngoai ky, khong tinh
    ]
    fake_db.store["post_call_results"] = [
        {"updated_by": "mem-a", "last_call_at": ts_in, "platform": "facebook", "updated_by_user": MEMBER_A},
        {"updated_by": "mem-b", "last_call_at": ts_in, "platform": "facebook", "updated_by_user": MEMBER_B},
    ]
    fake_db.store["zalo_inbox_kpi"] = [
        {
            "id_member": "mem-b", "first_outbound_at": ts_in, "source_type": "post_feed_outbound",
            "source_platform": "facebook", "member": MEMBER_B,
        },
    ]

    result = svc.get_who_did_what(ADMIN_USER, platform="facebook", date_from="2026-11-10", date_to="2026-11-10")

    by_id = {r["member_id"]: r for r in result}
    assert by_id["mem-a"]["seed"] == 1  # dong ngoai ky bi loai
    assert by_id["mem-a"]["call"] == 1
    assert by_id["mem-a"]["total"] == 2
    assert by_id["mem-b"]["call"] == 1
    assert by_id["mem-b"]["zalo"] == 1
    assert by_id["mem-b"]["total"] == 2
    # mem-b dung truoc vi tong bang nhau -> list chi can dam bao co du 2 member, khong gay loi thu tu
    assert {r["member_id"] for r in result} == {"mem-a", "mem-b"}


def test_who_did_what_splits_call_ok_bad(patched_clients):
    fake_db = patched_clients
    start_utc, _ = _bounds()
    ts_in = _inside(start_utc)
    fake_db.store["seeding_content_kpi"] = []
    fake_db.store["post_call_results"] = [
        {"updated_by": "mem-a", "result_code": "interested", "last_call_at": ts_in, "platform": "facebook", "updated_by_user": MEMBER_A},
        {"updated_by": "mem-a", "result_code": "noanswer", "last_call_at": ts_in, "platform": "facebook", "updated_by_user": MEMBER_A},
        {"updated_by": "mem-a", "result_code": "refused", "last_call_at": ts_in, "platform": "facebook", "updated_by_user": MEMBER_A},
    ]
    fake_db.store["zalo_inbox_kpi"] = []

    result = svc.get_who_did_what(ADMIN_USER, platform="facebook", date_from="2026-11-10", date_to="2026-11-10")
    assert len(result) == 1
    row = result[0]
    assert row["call"] == 3
    assert row["call_ok"] == 1
    assert row["call_bad"] == 2


def test_day_breakdown_fills_every_day_including_zero_activity(patched_clients):
    fake_db = patched_clients
    _, _, start_utc, _ = _vn_range_to_utc_bounds("2026-11-10", "2026-11-12")
    ts_in = _inside(start_utc)  # roi vao ngay 10/11

    fake_db.store["seeding_content_kpi"] = [
        {"id_member": "mem-a", "created_at": ts_in},
    ]
    fake_db.store["post_call_results"] = [
        {"updated_by": "mem-a", "result_code": "interested", "last_call_at": ts_in, "platform": "facebook"},
        {"updated_by": "mem-a", "result_code": "noanswer", "last_call_at": ts_in, "platform": "facebook"},
    ]
    fake_db.store["zalo_inbox_kpi"] = [
        {
            "id_member": "mem-a", "first_outbound_at": ts_in, "first_customer_msg_at": ts_in,
            "source_type": "post_feed_outbound", "source_platform": "facebook",
        },
    ]

    result = svc.get_day_breakdown(ADMIN_USER, platform="facebook", date_from="2026-11-10", date_to="2026-11-12")
    assert [r["day"] for r in result] == ["2026-11-10", "2026-11-11", "2026-11-12"]
    day0 = result[0]
    assert day0["seed"] == 1
    assert day0["call"] == 2
    assert day0["call_ok"] == 1
    assert day0["call_bad"] == 1
    assert day0["zalo_sent"] == 1
    assert day0["zalo_replied"] == 1
    # 2 ngay con lai khong co hoat dong nao nhung van phai xuat hien, toan 0
    assert result[1] == {
        "day": "2026-11-11", "seed": 0, "seed_verified": 0, "call": 0, "call_ok": 0, "call_bad": 0,
        "zalo_sent": 0, "zalo_replied": 0, "total": 0, "by_member": [],
    }
    assert result[2]["day"] == "2026-11-12"
    # total theo hang = seed + call + zalo_sent (cung cong thuc voi get_who_did_what)
    assert day0["total"] == 1 + 2 + 1
    # by_member: mem-a lam ca 3 viec trong ngay 10/11 -> 1 dong, total = seed+call+zalo_sent
    assert day0["by_member"] == [{"member_id": "mem-a", "member_name": "mem-a", "seed": 1, "zalo_sent": 1, "total": 4}]
    assert result[1]["by_member"] == []


def test_who_did_what_excludes_zero_total_members(patched_clients):
    fake_db = patched_clients
    start_utc, _ = _bounds()
    fake_db.store["seeding_content_kpi"] = []
    fake_db.store["post_call_results"] = []
    fake_db.store["zalo_inbox_kpi"] = []
    result = svc.get_who_did_what(ADMIN_USER, date_from="2026-11-10", date_to="2026-11-10")
    assert result == []


def test_activity_log_merges_and_sorts_by_time_desc(patched_clients):
    fake_db = patched_clients
    start_utc, _ = _bounds()
    import datetime
    t0 = datetime.datetime.fromisoformat(start_utc) + datetime.timedelta(hours=1)
    t1 = t0 + datetime.timedelta(hours=1)
    t2 = t1 + datetime.timedelta(hours=1)

    fake_db.store["seeding_content_kpi"] = [
        {"id_member": "mem-a", "created_at": t0.isoformat(), "link_post": "url-1", "verify": True, "member": MEMBER_A},
    ]
    fake_db.store["post_call_results"] = [
        {
            "post_id": "p1", "platform": "facebook", "result_code": "interested",
            "updated_by": "mem-a", "updated_at": t2.isoformat(), "updated_by_user": MEMBER_A,
            "note": "Khách hẹn gọi lại tuần sau",
        },
    ]
    fake_db.store["zalo_inbox_kpi"] = [
        {
            "id_member": "mem-b", "source_post_id": "p2", "source_post_url": "url-2",
            "direction_status": "two_way", "phone_number": "0900000000",
            "first_outbound_at": t1.isoformat(), "source_type": "post_feed_outbound",
            "source_platform": "facebook", "member": MEMBER_B,
        },
    ]

    with mock.patch.object(
        svc, "get_categories_by_type", return_value=[{"code": "interested", "name": "Có nhu cầu"}]
    ):
        res = svc.get_activity_log(ADMIN_USER, date_from="2026-11-10", date_to="2026-11-10", page=1, page_size=10)

    assert res["total"] == 3
    types_in_order = [e["action_type"] for e in res["items"]]
    assert types_in_order == ["call", "zalo", "seed"]  # t2 > t1 > t0
    call_event = res["items"][0]
    assert call_event["result_label"] == "Có nhu cầu"
    # Việc 4 (2026-11-21): note chỉ có ở sự kiện "call" — lấy từ post_call_results (luôn là
    # ghi chú của LẦN GỌI GẦN NHẤT, không phải lịch sử).
    assert call_event["note"] == "Khách hẹn gọi lại tuần sau"
    zalo_event = res["items"][1]
    assert zalo_event["post_label"] == "url-2"
    assert "note" not in zalo_event
    seed_event = res["items"][2]
    assert "note" not in seed_event


def test_activity_log_action_type_filter_and_pagination(patched_clients):
    fake_db = patched_clients
    start_utc, _ = _bounds()
    import datetime
    t0 = datetime.datetime.fromisoformat(start_utc) + datetime.timedelta(hours=1)
    t1 = t0 + datetime.timedelta(hours=1)

    fake_db.store["seeding_content_kpi"] = [
        {"id_member": "mem-a", "created_at": t0.isoformat(), "link_post": "url-1", "verify": False, "member": MEMBER_A},
        {"id_member": "mem-a", "created_at": t1.isoformat(), "link_post": "url-2", "verify": True, "member": MEMBER_A},
    ]
    fake_db.store["post_call_results"] = []
    fake_db.store["zalo_inbox_kpi"] = []

    res_page1 = svc.get_activity_log(
        ADMIN_USER, date_from="2026-11-10", date_to="2026-11-10", action_type="seed", page=1, page_size=1
    )
    assert res_page1["total"] == 2
    assert len(res_page1["items"]) == 1
    assert res_page1["items"][0]["post_label"] == "url-2"  # moi nhat truoc

    res_page2 = svc.get_activity_log(
        ADMIN_USER, date_from="2026-11-10", date_to="2026-11-10", action_type="seed", page=2, page_size=1
    )
    assert len(res_page2["items"]) == 1
    assert res_page2["items"][0]["post_label"] == "url-1"

    res_call_only = svc.get_activity_log(
        ADMIN_USER, date_from="2026-11-10", date_to="2026-11-10", action_type="call", page=1, page_size=10
    )
    assert res_call_only["total"] == 0
    # counts khong doi theo action_type dang chon (giong badge chip o prototype)
    assert res_page1["counts"] == {"all": 2, "seed": 2, "call": 0, "zalo": 0}
    assert res_call_only["counts"] == {"all": 2, "seed": 2, "call": 0, "zalo": 0}


def test_zalo_message_stats_sent_replied_and_prev_period(patched_clients):
    fake_db = patched_clients
    start_utc, end_utc = _bounds()
    import datetime
    t_sent = datetime.datetime.fromisoformat(start_utc) + datetime.timedelta(hours=1)
    t_replied = t_sent + datetime.timedelta(hours=1)
    t_prev = datetime.datetime.fromisoformat(start_utc) - datetime.timedelta(hours=1)  # ky truoc

    fake_db.store["zalo_inbox_kpi"] = [
        {
            "id_member": "mem-a", "first_outbound_at": t_sent.isoformat(), "first_customer_msg_at": None,
            "source_type": "post_feed_outbound", "source_platform": "facebook", "member": MEMBER_A,
        },
        {
            "id_member": "mem-b", "first_outbound_at": t_sent.isoformat(), "first_customer_msg_at": t_replied.isoformat(),
            "source_type": "post_feed_inbound", "source_platform": "facebook", "member": MEMBER_B,
        },
        {
            "id_member": "mem-a", "first_outbound_at": t_prev.isoformat(), "first_customer_msg_at": None,
            "source_type": "post_feed_outbound", "source_platform": "facebook", "member": MEMBER_A,
        },
        # nguon khong phai post feed -> phai bi loai
        {
            "id_member": "mem-a", "first_outbound_at": t_sent.isoformat(), "first_customer_msg_at": None,
            "source_type": "direct_inbox", "source_platform": "facebook", "member": MEMBER_A,
        },
    ]

    result = zalo_inbox_kpi_service.get_post_feed_message_stats(
        ADMIN_USER, platform="facebook", date_from="2026-11-10", date_to="2026-11-10"
    )

    assert result["sent"] == 2
    assert result["replied"] == 1
    assert result["prev_sent"] == 1
    by_member = {m["member_id"]: m for m in result["by_member"]}
    assert by_member["mem-a"]["sent"] == 1
    assert by_member["mem-b"]["sent"] == 1
    assert by_member["mem-b"]["replied"] == 1


def test_resolve_post_ids_by_contact_member_unions_3_sources():
    fake_db = _FakeSupabase()
    fake_db.store["post_call_results"] = [
        {"post_id": "post-1", "platform": "facebook", "updated_by": "mem-a"},
        {"post_id": "post-2", "platform": "facebook", "updated_by": "mem-x"},
    ]
    fake_db.store["zalo_inbox_kpi"] = [
        {
            "source_post_id": "post-3", "source_platform": "facebook", "id_member": "mem-a",
            "source_type": "post_feed_outbound",
        },
    ]
    fake_db.store["seeding_content_kpi"] = [
        {"id_post": "post-4", "id_member": "mem-a"},
        {"id_post": "post-5", "id_member": "mem-x"},
    ]

    ids = unified_posts_service._resolve_post_ids_by_contact_member(fake_db, "facebook_posts", "mem-a")
    assert set(ids) == {"post-1", "post-3", "post-4"}


# ---- Dashboard Leader: team_id filter + cac so lieu/filter moi ----

LEADER_USER: dict[str, Any] = {"id": "leader-1", "role": "leader"}


def test_who_did_what_filters_by_team_id_admin(patched_clients):
    fake_db = patched_clients
    start_utc, _ = _bounds()
    ts_in = _inside(start_utc)

    fake_db.store["member_of_teams"] = [{"id_member": "mem-a", "id_teams": "team-1"}]
    fake_db.store["seeding_content_kpi"] = [
        {"id_member": "mem-a", "created_at": ts_in, "member": MEMBER_A},
        {"id_member": "mem-b", "created_at": ts_in, "member": MEMBER_B},
    ]
    fake_db.store["post_call_results"] = []
    fake_db.store["zalo_inbox_kpi"] = []

    result = svc.get_who_did_what(ADMIN_USER, date_from="2026-11-10", date_to="2026-11-10", team_id="team-1")
    assert {r["member_id"] for r in result} == {"mem-a"}  # mem-b bi loai vi khong thuoc team-1


def test_who_did_what_leader_team_filter_restricts_to_own_team_only(patched_clients):
    fake_db = patched_clients
    start_utc, _ = _bounds()
    ts_in = _inside(start_utc)

    fake_db.store["teams"] = [{"id": "team-1", "id_leader": "leader-1"}]
    fake_db.store["member_of_teams"] = [{"id_member": "mem-a", "id_teams": "team-1"}]
    fake_db.store["seeding_content_kpi"] = [
        {"id_member": "mem-a", "created_at": ts_in, "member": MEMBER_A},
    ]
    fake_db.store["post_call_results"] = []
    fake_db.store["zalo_inbox_kpi"] = []

    ok = svc.get_who_did_what(LEADER_USER, date_from="2026-11-10", date_to="2026-11-10", team_id="team-1")
    assert {r["member_id"] for r in ok} == {"mem-a"}

    # Leader chon 1 team KHONG phai cua minh -> rong, khong loi (an toan).
    other = svc.get_who_did_what(LEADER_USER, date_from="2026-11-10", date_to="2026-11-10", team_id="team-2")
    assert other == []


def test_activity_log_result_code_and_overdue_only_filters(patched_clients):
    fake_db = patched_clients
    start_utc, _ = _bounds()
    ts_in = _inside(start_utc)
    import datetime
    now = datetime.datetime.now(datetime.timezone.utc)
    old_ts = (now - datetime.timedelta(days=5)).isoformat()
    recent_ts = (now - datetime.timedelta(hours=2)).isoformat()

    fake_db.store["seeding_content_kpi"] = []
    fake_db.store["post_call_results"] = [
        {"post_id": "p1", "platform": "facebook", "result_code": "callback", "updated_by": "mem-a",
         "updated_at": ts_in, "last_call_at": old_ts, "updated_by_user": MEMBER_A},
        {"post_id": "p2", "platform": "facebook", "result_code": "callback", "updated_by": "mem-a",
         "updated_at": ts_in, "last_call_at": recent_ts, "updated_by_user": MEMBER_A},
        {"post_id": "p3", "platform": "facebook", "result_code": "interested", "updated_by": "mem-a",
         "updated_at": ts_in, "last_call_at": recent_ts, "updated_by_user": MEMBER_A},
    ]
    fake_db.store["zalo_inbox_kpi"] = []

    with mock.patch.object(
        svc, "get_categories_by_type",
        return_value=[{"code": "callback", "name": "Hẹn gọi lại"}, {"code": "interested", "name": "Có nhu cầu"}],
    ):
        only_callback = svc.get_activity_log(
            ADMIN_USER, date_from="2026-11-10", date_to="2026-11-10", action_type="call",
            result_code="callback", page=1, page_size=10,
        )
        assert only_callback["total"] == 2  # p1 + p2, khong tinh p3 (interested)

        overdue = svc.get_activity_log(
            ADMIN_USER, date_from="2026-11-10", date_to="2026-11-10", action_type="call",
            result_code="callback", overdue_only=True, page=1, page_size=10,
        )
    assert overdue["total"] == 1
    assert overdue["items"][0]["post_label"] == "p1"
    # counts tong quan khong bi anh huong boi result_code/overdue_only
    assert overdue["counts"]["call"] == 3


def test_activity_log_needs_followup_only_filters_zalo(patched_clients):
    fake_db = patched_clients
    import datetime
    today = datetime.date.today()
    date_from = (today - datetime.timedelta(days=11)).isoformat()
    date_to = today.isoformat()
    now = datetime.datetime.now(datetime.timezone.utc)
    recent_unreplied = (now - datetime.timedelta(hours=5)).isoformat()
    old_unreplied = (now - datetime.timedelta(days=10)).isoformat()

    fake_db.store["seeding_content_kpi"] = []
    fake_db.store["post_call_results"] = []
    fake_db.store["zalo_inbox_kpi"] = [
        {"id_member": "mem-a", "source_post_id": "p1", "source_post_url": None, "phone_number": "0900",
         "direction_status": "outbound_sent", "first_outbound_at": recent_unreplied, "first_customer_msg_at": None,
         "source_type": "post_feed_outbound", "source_platform": "facebook", "member": MEMBER_A},
        {"id_member": "mem-a", "source_post_id": "p2", "source_post_url": None, "phone_number": "0900",
         "direction_status": "outbound_sent", "first_outbound_at": old_unreplied, "first_customer_msg_at": None,
         "source_type": "post_feed_outbound", "source_platform": "facebook", "member": MEMBER_A},
    ]

    res = svc.get_activity_log(
        ADMIN_USER, date_from=date_from, date_to=date_to, action_type="zalo",
        needs_followup_only=True, page=1, page_size=10,
    )
    assert res["total"] == 1
    assert res["items"][0]["post_label"] == "p1"


def test_activity_log_search_filters_by_member_name_or_post_label(patched_clients):
    fake_db = patched_clients
    start_utc, _ = _bounds()
    ts_in = _inside(start_utc)
    fake_db.store["seeding_content_kpi"] = [
        {"id_member": "mem-a", "created_at": ts_in, "link_post": "https://group-xyz.com/post/1",
         "verify": True, "member": MEMBER_A},
        {"id_member": "mem-b", "created_at": ts_in, "link_post": "https://other.com/post/2",
         "verify": True, "member": MEMBER_B},
    ]
    fake_db.store["post_call_results"] = []
    fake_db.store["zalo_inbox_kpi"] = []

    by_member_name = svc.get_activity_log(
        ADMIN_USER, date_from="2026-11-10", date_to="2026-11-10", search="Nguyễn A", page=1, page_size=10,
    )
    assert by_member_name["total"] == 1
    assert by_member_name["items"][0]["member_name"] == "Nguyễn A"

    by_post_label = svc.get_activity_log(
        ADMIN_USER, date_from="2026-11-10", date_to="2026-11-10", search="group-xyz", page=1, page_size=10,
    )
    assert by_post_label["total"] == 1


def test_seeding_group_coverage_resolves_group_name_per_platform(patched_clients):
    fake_db = patched_clients
    start_utc, _ = _bounds()
    ts_in = _inside(start_utc)
    fake_db.store["seeding_content_kpi"] = [
        {"id_member": "mem-a", "id_post": "fb-post-1", "created_at": ts_in},
        {"id_member": "mem-a", "id_post": "fb-post-1", "created_at": ts_in},  # cung 1 bai, 2 lan seeding
        {"id_member": "mem-a", "id_post": "li-post-1", "created_at": ts_in},
        {"id_member": "mem-a", "id_post": "unknown-post", "created_at": ts_in},
    ]
    fake_db.store["facebook_posts"] = [
        {"id": "fb-post-1", "facebook_groups": {"group_name": "Nhóm Facebook A"}},
    ]
    fake_db.store["linkedin_posts"] = [
        {"id": "li-post-1", "linkedin_groups": {"group_name": "Nhóm LinkedIn B"}},
    ]
    fake_db.store["threads_posts"] = []
    fake_db.store["youtube_posts"] = []

    result = svc.get_seeding_group_coverage(ADMIN_USER, date_from="2026-11-10", date_to="2026-11-10")
    by_name = {r["group_name"]: r["count"] for r in result}
    assert by_name["Nhóm Facebook A"] == 2
    assert by_name["Nhóm LinkedIn B"] == 1
    assert by_name["Không rõ nhóm"] == 1


def test_overdue_callbacks_count_uses_last_call_at_age(patched_clients):
    fake_db = patched_clients
    import datetime
    now = datetime.datetime.now(datetime.timezone.utc)
    old_ts = (now - datetime.timedelta(days=3)).isoformat()
    recent_ts = (now - datetime.timedelta(hours=2)).isoformat()
    fake_db.store["post_call_results"] = [
        {"id": "r1", "result_code": "callback", "last_call_at": old_ts, "platform": "facebook", "updated_by": "mem-a"},
        {"id": "r2", "result_code": "callback", "last_call_at": recent_ts, "platform": "facebook", "updated_by": "mem-a"},
        {"id": "r3", "result_code": "interested", "last_call_at": old_ts, "platform": "facebook", "updated_by": "mem-a"},
    ]
    count = post_call_result_service.get_overdue_callbacks_count(ADMIN_USER, platform="facebook")
    assert count == 1


def test_zalo_followup_count_only_recent_unreplied(patched_clients):
    fake_db = patched_clients
    import datetime
    now = datetime.datetime.now(datetime.timezone.utc)
    recent = (now - datetime.timedelta(hours=10)).isoformat()
    old = (now - datetime.timedelta(days=5)).isoformat()
    fake_db.store["zalo_inbox_kpi"] = [
        {"id": "z1", "id_member": "mem-a", "first_outbound_at": recent, "first_customer_msg_at": None,
         "source_type": "post_feed_outbound", "source_platform": "facebook"},
        {"id": "z2", "id_member": "mem-a", "first_outbound_at": old, "first_customer_msg_at": None,
         "source_type": "post_feed_outbound", "source_platform": "facebook"},
        {"id": "z3", "id_member": "mem-a", "first_outbound_at": recent, "first_customer_msg_at": recent,
         "source_type": "post_feed_outbound", "source_platform": "facebook"},
    ]
    count = zalo_inbox_kpi_service.get_zalo_followup_count(ADMIN_USER, platform="facebook")
    assert count == 1


# ---- _to_vn_day_str: phan le giay khong phai 3/6 chu so (lech tab "Theo thanh vien" vs "Theo ngay") ----

import datetime as _dt
import logging
import re as _re


class _StrictPy310Datetime(_dt.datetime):
    """Gia lap ``datetime.fromisoformat`` cua Python 3.10 (image backend playwright/python:*-jammy):
    chi nhan phan le giay dung 3 hoac 6 chu so. Python 3.11+ (may dev) nhan moi do dai nen neu
    khong gia lap thi test 5 chu so van pass ca khi chua fix."""

    @classmethod
    def fromisoformat(cls, value):
        m = _re.search(r"\.(\d+)", value)
        if m and len(m.group(1)) not in (3, 6):
            raise ValueError(f"Invalid isoformat string: {value!r}")
        return super().fromisoformat(value)


@pytest.fixture
def strict_datetime():
    with mock.patch.object(post_call_result_service, "datetime", _StrictPy310Datetime):
        yield


def test_strict_datetime_reproduces_py310_bug():
    # Bao dam gia lap dung: chuoi 5 chu so phai loi khi KHONG chuan hoa.
    with pytest.raises(ValueError):
        _StrictPy310Datetime.fromisoformat("2026-11-10T03:04:05.12345+00:00")


@pytest.mark.parametrize(
    "value",
    [
        "2026-11-10T03:04:05.12345+00:00",  # 5 chu so (Postgres cat so 0 cuoi)
        "2026-11-10T03:04:05.1+00:00",
        "2026-11-10T03:04:05.1234567+00:00",  # dai hon 6 -> cat
        "2026-11-10T03:04:05.12345Z",
    ],
)
def test_to_vn_day_str_odd_fraction_lengths_parse(strict_datetime, value):
    # (a) 03:04 UTC = 10:04 gio VN cung ngay
    assert post_call_result_service._to_vn_day_str(value) == "2026-11-10"


@pytest.mark.parametrize(
    "value",
    ["2026-11-10T03:04:05.123+00:00", "2026-11-10T03:04:05.123456+00:00", "2026-11-10T03:04:05+00:00"],
)
def test_to_vn_day_str_3_and_6_digits_still_work(strict_datetime, value):
    # (b) case cu
    assert post_call_result_service._to_vn_day_str(value) == "2026-11-10"


def test_to_vn_day_str_crosses_midnight_vn(strict_datetime):
    # 18:30 UTC = 01:30 sang hom sau gio VN
    assert post_call_result_service._to_vn_day_str("2026-11-10T18:30:00.5+00:00") == "2026-11-11"


def test_to_vn_day_str_malformed_logs_warning_and_returns_none(strict_datetime, caplog):
    # (c) chuoi rac -> None + warning (kem gia tri goc + context), khong crash
    with caplog.at_level(logging.WARNING, logger=post_call_result_service.logger.name):
        assert post_call_result_service._to_vn_day_str("khong-phai-ngay", context="zalo_inbox_kpi id=z9") is None
    assert any("khong-phai-ngay" in r.getMessage() and "z9" in r.getMessage() for r in caplog.records)


def _seed_mixed_fraction_dataset(fake_db, start_utc: str) -> None:
    base = _dt.datetime.fromisoformat(start_utc) + _dt.timedelta(hours=1)

    def ts(minutes: int, fraction: str) -> str:
        return (base + _dt.timedelta(minutes=minutes)).strftime("%Y-%m-%dT%H:%M:%S") + f".{fraction}+00:00"

    fake_db.store["seeding_content_kpi"] = [
        {"id_member": "mem-a", "id_post": "s1", "created_at": ts(1, "12345"), "member": MEMBER_A},
        {"id_member": "mem-b", "id_post": "s2", "created_at": ts(2, "123456"), "member": MEMBER_B},
    ]
    fake_db.store["post_call_results"] = [
        {"post_id": "c1", "updated_by": "mem-a", "result_code": "interested", "last_call_at": ts(3, "1"),
         "platform": "facebook", "updated_by_user": MEMBER_A},
        {"post_id": "c2", "updated_by": "mem-b", "result_code": "noanswer", "last_call_at": ts(4, "123"),
         "platform": "facebook", "updated_by_user": MEMBER_B},
    ]
    # Dung kich ban bao loi: 3 tin Zalo, 1 tin co phan le giay 5 chu so.
    fake_db.store["zalo_inbox_kpi"] = [
        {"id_member": "mem-a", "source_post_id": "z1", "first_outbound_at": ts(5, "12345"),
         "first_customer_msg_at": None, "source_type": "post_feed_outbound", "source_platform": "facebook",
         "member": MEMBER_A},
        {"id_member": "mem-a", "source_post_id": "z2", "first_outbound_at": ts(6, "123456"),
         "first_customer_msg_at": None, "source_type": "post_feed_outbound", "source_platform": "facebook",
         "member": MEMBER_A},
        {"id_member": "mem-b", "source_post_id": "z3", "first_outbound_at": ts(7, "123"),
         "first_customer_msg_at": None, "source_type": "post_feed_inbound", "source_platform": "facebook",
         "member": MEMBER_B},
    ]


@pytest.mark.parametrize("member_id", [None, "mem-a", "mem-b"])
def test_member_tab_and_day_tab_totals_match(patched_clients, strict_datetime, member_id):
    # (d) cung ky, cung bo loc (ke ca loc 1 member) -> tong 2 tab phai khop nhau.
    fake_db = patched_clients
    start_utc, _ = _bounds()
    _seed_mixed_fraction_dataset(fake_db, start_utc)
    kwargs = dict(platform="facebook", date_from="2026-11-10", date_to="2026-11-10")

    who = svc.get_who_did_what(ADMIN_USER, **kwargs)
    # FE loc bang "Theo thanh vien" theo contactMemberId (who khong truyen member_id len API)
    if member_id:
        who = [m for m in who if m["member_id"] == member_id]
    days = svc.get_day_breakdown(ADMIN_USER, member_id=member_id, **kwargs)

    def total(rows, key):
        return sum(r[key] for r in rows)

    assert total(who, "seed") == total(days, "seed")
    assert total(who, "call_ok") == total(days, "call_ok")
    assert total(who, "call_bad") == total(days, "call_bad")
    assert total(who, "zalo") == total(days, "zalo_sent")
    assert total(who, "total") == total(days, "total")

    # Va loc FE == loc server (get_who_did_what nhan member_id qua query string)
    if member_id:
        server_filtered = svc.get_who_did_what(ADMIN_USER, member_id=member_id, **kwargs)
        assert [(m["member_id"], m["total"]) for m in server_filtered] == [(m["member_id"], m["total"]) for m in who]
    else:
        assert total(days, "zalo_sent") == 3  # khong con rot tin 5 chu so (truoc fix = 2)


# ---- Viec 1: get_day_breakdown phai BO QUA id_member/updated_by NULL, giong get_who_did_what ----

def test_day_breakdown_ignores_null_id_member_rows(patched_clients):
    # (a) dong id_member NULL trong ngay X -> khong tinh vao total/seed/call/zalo cua ngay X.
    fake_db = patched_clients
    start_utc, _ = _bounds()
    ts_in = _inside(start_utc)

    fake_db.store["seeding_content_kpi"] = [
        {"id_member": "mem-a", "id_post": "s1", "created_at": ts_in, "member": MEMBER_A},
        {"id_member": None, "id_post": "s2", "created_at": ts_in},  # rac, phai bi bo qua
    ]
    fake_db.store["post_call_results"] = [
        {"post_id": "c1", "updated_by": "mem-a", "result_code": "interested", "last_call_at": ts_in,
         "platform": "facebook", "updated_by_user": MEMBER_A},
        {"post_id": "c2", "updated_by": None, "result_code": "interested", "last_call_at": ts_in,
         "platform": "facebook"},  # rac, phai bi bo qua
    ]
    fake_db.store["zalo_inbox_kpi"] = [
        {"id_member": "mem-a", "source_post_id": "z1", "first_outbound_at": ts_in,
         "first_customer_msg_at": None, "source_type": "post_feed_outbound", "source_platform": "facebook",
         "member": MEMBER_A},
        {"id_member": None, "source_post_id": "z2", "first_outbound_at": ts_in,
         "first_customer_msg_at": None, "source_type": "post_feed_outbound", "source_platform": "facebook"},
    ]

    days = svc.get_day_breakdown(ADMIN_USER, platform="facebook", date_from="2026-11-10", date_to="2026-11-10")
    day0 = days[0]
    assert day0["seed"] == 1
    assert day0["call"] == 1
    assert day0["call_ok"] == 1
    assert day0["zalo_sent"] == 1
    assert day0["total"] == 1 + 1 + 1
    # dong NULL cung khong lot vao by_member
    assert day0["by_member"] == [{"member_id": "mem-a", "member_name": "Nguyễn A", "seed": 1, "zalo_sent": 1, "total": 3}]


def test_who_and_day_breakdown_totals_match_with_null_id_member_rows(patched_clients):
    # (b) tong cua get_day_breakdown va get_who_did_what cung ky, cung bo loc, co lan id_member
    # NULL -> khop nhau tuyet doi.
    fake_db = patched_clients
    start_utc, _ = _bounds()
    ts_in = _inside(start_utc)

    fake_db.store["seeding_content_kpi"] = [
        {"id_member": "mem-a", "id_post": "s1", "created_at": ts_in, "member": MEMBER_A},
        {"id_member": None, "id_post": "s2", "created_at": ts_in},
        {"id_member": "mem-b", "id_post": "s3", "created_at": ts_in, "member": MEMBER_B},
    ]
    fake_db.store["post_call_results"] = [
        {"post_id": "c1", "updated_by": "mem-a", "result_code": "interested", "last_call_at": ts_in,
         "platform": "facebook", "updated_by_user": MEMBER_A},
        {"post_id": "c2", "updated_by": None, "result_code": "noanswer", "last_call_at": ts_in,
         "platform": "facebook"},
        {"post_id": "c3", "updated_by": "mem-b", "result_code": "refused", "last_call_at": ts_in,
         "platform": "facebook", "updated_by_user": MEMBER_B},
    ]
    fake_db.store["zalo_inbox_kpi"] = [
        {"id_member": "mem-a", "source_post_id": "z1", "first_outbound_at": ts_in,
         "first_customer_msg_at": None, "source_type": "post_feed_outbound", "source_platform": "facebook",
         "member": MEMBER_A},
        {"id_member": None, "source_post_id": "z2", "first_outbound_at": ts_in,
         "first_customer_msg_at": None, "source_type": "post_feed_outbound", "source_platform": "facebook"},
    ]

    kwargs = dict(platform="facebook", date_from="2026-11-10", date_to="2026-11-10")
    who = svc.get_who_did_what(ADMIN_USER, **kwargs)
    days = svc.get_day_breakdown(ADMIN_USER, **kwargs)

    def total(rows, key):
        return sum(r[key] for r in rows)

    assert total(who, "seed") == total(days, "seed") == 2
    assert total(who, "call") == total(days, "call") == 2
    assert total(who, "call_ok") == total(days, "call_ok") == 1
    assert total(who, "call_bad") == total(days, "call_bad") == 1
    assert total(who, "zalo") == total(days, "zalo_sent") == 1
    assert total(who, "total") == total(days, "total") == 5


# ---- Viec 3: get_day_breakdown.by_member ----

def test_day_breakdown_by_member_multiple_members_sorted_desc(patched_clients):
    fake_db = patched_clients
    start_utc, _ = _bounds()
    ts_in = _inside(start_utc)

    fake_db.store["seeding_content_kpi"] = [
        {"id_member": "mem-a", "id_post": "s1", "created_at": ts_in, "member": MEMBER_A},
    ]
    fake_db.store["post_call_results"] = [
        {"post_id": "c1", "updated_by": "mem-b", "result_code": "interested", "last_call_at": ts_in,
         "platform": "facebook", "updated_by_user": MEMBER_B},
        {"post_id": "c2", "updated_by": "mem-b", "result_code": "noanswer", "last_call_at": ts_in,
         "platform": "facebook", "updated_by_user": MEMBER_B},
    ]
    fake_db.store["zalo_inbox_kpi"] = [
        {"id_member": "mem-a", "source_post_id": "z1", "first_outbound_at": ts_in,
         "first_customer_msg_at": None, "source_type": "post_feed_outbound", "source_platform": "facebook",
         "member": MEMBER_A},
    ]

    days = svc.get_day_breakdown(ADMIN_USER, platform="facebook", date_from="2026-11-10", date_to="2026-11-10")
    day0 = days[0]
    assert day0["total"] == 1 + 2 + 1  # seed(mem-a) + call(mem-b x2) + zalo_sent(mem-a)
    # mem-b (total=2) dung truoc mem-a (total=2) hoac nguoc lai neu bang nhau - o day mem-b=2, mem-a=2 (1 seed+1 zalo)
    by_id = {m["member_id"]: m for m in day0["by_member"]}
    assert by_id["mem-a"] == {"member_id": "mem-a", "member_name": "Nguyễn A", "seed": 1, "zalo_sent": 1, "total": 2}
    assert by_id["mem-b"] == {"member_id": "mem-b", "member_name": "Trần B", "seed": 0, "zalo_sent": 0, "total": 2}
    assert len(day0["by_member"]) == 2


def test_day_breakdown_by_member_empty_when_day_has_no_activity(patched_clients):
    fake_db = patched_clients
    fake_db.store["seeding_content_kpi"] = []
    fake_db.store["post_call_results"] = []
    fake_db.store["zalo_inbox_kpi"] = []
    days = svc.get_day_breakdown(ADMIN_USER, date_from="2026-11-10", date_to="2026-11-10")
    assert days[0]["by_member"] == []


def test_day_breakdown_by_member_falls_back_to_email_then_id(patched_clients):
    fake_db = patched_clients
    start_utc, _ = _bounds()
    ts_in = _inside(start_utc)
    fake_db.store["seeding_content_kpi"] = [
        {"id_member": "mem-c", "id_post": "s1", "created_at": ts_in, "member": {"id": "mem-c", "name": None, "email": "c@x.com"}},
        {"id_member": "mem-d", "id_post": "s2", "created_at": ts_in, "member": None},
    ]
    fake_db.store["post_call_results"] = []
    fake_db.store["zalo_inbox_kpi"] = []
    days = svc.get_day_breakdown(ADMIN_USER, date_from="2026-11-10", date_to="2026-11-10")
    by_id = {m["member_id"]: m["member_name"] for m in days[0]["by_member"]}
    assert by_id["mem-c"] == "c@x.com"
    assert by_id["mem-d"] == "mem-d"


# ---- ignore_role_scope (2026-11-27): widget "Kết quả liên hệ" trên Dashboard chính cho MỌI
# role thấy bản dữ liệu chung, không bị ép về đúng mình (member) hay đúng team (leader) nữa. ----

MEMBER_USER: dict[str, Any] = {"id": "mem-a", "role": "member"}


def test_who_did_what_member_sees_only_self_by_default(patched_clients):
    fake_db = patched_clients
    start_utc, _ = _bounds()
    ts_in = _inside(start_utc)
    fake_db.store["seeding_content_kpi"] = [
        {"id_member": "mem-a", "created_at": ts_in, "member": MEMBER_A},
        {"id_member": "mem-b", "created_at": ts_in, "member": MEMBER_B},
    ]
    fake_db.store["post_call_results"] = []
    fake_db.store["zalo_inbox_kpi"] = []

    result = svc.get_who_did_what(MEMBER_USER, date_from="2026-11-10", date_to="2026-11-10")
    assert {r["member_id"] for r in result} == {"mem-a"}


def test_who_did_what_ignore_role_scope_lets_member_see_everyone(patched_clients):
    fake_db = patched_clients
    start_utc, _ = _bounds()
    ts_in = _inside(start_utc)
    fake_db.store["seeding_content_kpi"] = [
        {"id_member": "mem-a", "created_at": ts_in, "member": MEMBER_A},
        {"id_member": "mem-b", "created_at": ts_in, "member": MEMBER_B},
    ]
    fake_db.store["post_call_results"] = []
    fake_db.store["zalo_inbox_kpi"] = []

    result = svc.get_who_did_what(
        MEMBER_USER, date_from="2026-11-10", date_to="2026-11-10", ignore_role_scope=True
    )
    assert {r["member_id"] for r in result} == {"mem-a", "mem-b"}


def test_who_did_what_ignore_role_scope_lets_leader_see_outside_own_team(patched_clients):
    fake_db = patched_clients
    start_utc, _ = _bounds()
    ts_in = _inside(start_utc)
    fake_db.store["teams"] = [{"id": "team-1", "id_leader": "leader-1"}]
    fake_db.store["member_of_teams"] = [{"id_member": "mem-a", "id_teams": "team-1"}]
    fake_db.store["seeding_content_kpi"] = [
        {"id_member": "mem-a", "created_at": ts_in, "member": MEMBER_A},
        {"id_member": "mem-b", "created_at": ts_in, "member": MEMBER_B},  # khong thuoc team-1
    ]
    fake_db.store["post_call_results"] = []
    fake_db.store["zalo_inbox_kpi"] = []

    scoped = svc.get_who_did_what(LEADER_USER, date_from="2026-11-10", date_to="2026-11-10")
    assert {r["member_id"] for r in scoped} == {"mem-a"}

    unscoped = svc.get_who_did_what(
        LEADER_USER, date_from="2026-11-10", date_to="2026-11-10", ignore_role_scope=True
    )
    assert {r["member_id"] for r in unscoped} == {"mem-a", "mem-b"}


def test_day_breakdown_and_activity_log_accept_ignore_role_scope(patched_clients):
    fake_db = patched_clients
    start_utc, _ = _bounds()
    ts_in = _inside(start_utc)
    fake_db.store["seeding_content_kpi"] = [
        {"id_member": "mem-a", "id_post": "s1", "created_at": ts_in, "verify": False, "member": MEMBER_A},
        {"id_member": "mem-b", "id_post": "s2", "created_at": ts_in, "verify": False, "member": MEMBER_B},
    ]
    fake_db.store["post_call_results"] = []
    fake_db.store["zalo_inbox_kpi"] = []

    days = svc.get_day_breakdown(
        MEMBER_USER, date_from="2026-11-10", date_to="2026-11-10", ignore_role_scope=True
    )
    assert days[0]["seed"] == 2  # ca mem-a lan mem-b, khong chi mem-a

    log = svc.get_activity_log(
        MEMBER_USER, date_from="2026-11-10", date_to="2026-11-10", page=1, page_size=10,
        ignore_role_scope=True,
    )
    assert log["total"] == 2
