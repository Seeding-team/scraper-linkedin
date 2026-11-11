"""Unit tests cho Zalo Inbox KPI 2 chiều, auto-match Post Feed & khóa chống trùng 30 ngày."""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from typing import Any, Dict, List, Optional

from app.modules.all_platform.services import zalo_inbox_kpi_service as svc


class _FakeQuery:
    def __init__(self, db: "_FakeSupabase", table_name: str):
        self._db = db
        self._table = table_name
        self._op = "select"
        self._payload: Any = None
        self._filters: List[Any] = []
        self._order_col: Optional[str] = None
        self._order_desc: bool = False
        self._limit: Optional[int] = None

    def select(self, _cols: str = "*"):
        self._op = "select"
        return self

    def insert(self, payload: Any):
        self._op = "insert"
        self._payload = payload
        return self

    def update(self, payload: Dict[str, Any]):
        self._op = "update"
        self._payload = payload
        return self

    def eq(self, col: str, val: Any):
        self._filters.append(lambda r: r.get(col) == val)
        return self

    def in_(self, col: str, vals: List[Any]):
        val_set = set(vals)
        self._filters.append(lambda r: r.get(col) in val_set)
        return self

    def gte(self, col: str, val: Any):
        self._filters.append(lambda r: (r.get(col) or "") >= val)
        return self

    def lt(self, col: str, val: Any):
        self._filters.append(lambda r: (r.get(col) or "") < val)
        return self

    def lte(self, col: str, val: Any):
        self._filters.append(lambda r: (r.get(col) or "") <= val)
        return self

    def ilike(self, col: str, pattern: str):
        needle = pattern.strip("%").lower()
        self._filters.append(lambda r: needle in str(r.get(col) or "").lower())
        return self

    def order(self, col: str, desc: bool = False):
        self._order_col = col
        self._order_desc = desc
        return self

    def limit(self, n: int):
        self._limit = n
        return self

    def _matches(self, row: Dict[str, Any]) -> bool:
        return all(fn(row) for fn in self._filters)

    def execute(self):
        rows = self._db.tables.setdefault(self._table, [])

        if self._op == "insert":
            items = self._payload if isinstance(self._payload, list) else [self._payload]
            inserted = []
            for item in items:
                new_row = deepcopy(item)
                if "id" not in new_row:
                    self._db._seq += 1
                    new_row["id"] = self._db._seq
                rows.append(new_row)
                inserted.append(deepcopy(new_row))
            return SimpleNamespace(data=inserted)

        if self._op == "update":
            updated = []
            for row in rows:
                if self._matches(row):
                    row.update(deepcopy(self._payload))
                    updated.append(deepcopy(row))
            return SimpleNamespace(data=updated)

        matched = [deepcopy(r) for r in rows if self._matches(r)]
        if self._order_col:
            matched.sort(key=lambda r: r.get(self._order_col) or "", reverse=self._order_desc)
        if self._limit is not None:
            matched = matched[: self._limit]
        return SimpleNamespace(data=matched)


class _FakeSupabase:
    def __init__(self):
        self._seq = 100
        self.tables: Dict[str, List[Dict[str, Any]]] = {
            "app_users": [
                {"id": "11111111-1111-1111-1111-111111111111", "email": "sale1@example.com"},
                {"id": "22222222-2222-2222-2222-222222222222", "email": "sale2@example.com"},
                {"id": "99999999-9999-9999-9999-999999999999", "email": "leader@example.com"},
            ],
            "member_of_teams": [
                {
                    "id_member": "11111111-1111-1111-1111-111111111111",
                    "teams": {"id_leader": "99999999-9999-9999-9999-999999999999"},
                },
                {
                    "id_member": "22222222-2222-2222-2222-222222222222",
                    "teams": {"id_leader": "99999999-9999-9999-9999-999999999999"},
                },
            ],
            "zalo_groups": [],
            "zalo_messages": [],
            "auto_seeding_comments": [],
            "facebook_posts": [],
            "zalo_inbox_kpi": [],
        }

    def table(self, name: str) -> _FakeQuery:
        return _FakeQuery(self, name)


def test_outbound_waiting_then_customer_reply_confirms_two_way():
    sb = _FakeSupabase()
    now_iso = datetime.now(timezone.utc).isoformat()

    # 1. Sale1 nhắn khách từ card Post Feed -> tạo trạng thái chờ khách rep (chưa tính KPI)
    out_res = svc.record_post_feed_outbound(
        account_id="acc_zalo_1",
        conversation_id="cust_uid_001",
        phone_number="+84901234567",
        sender_email="sale1@example.com",
        source_platform="facebook",
        source_post_id="fb_post_100",
        sent_at=now_iso,
        supabase=sb,
    )
    assert out_res["status"] == "outbound_waiting"
    assert out_res["is_confirmed"] is False

    # Kiểm tra count trước khi khách rep
    today = datetime.now(svc.VN_TZ).date().isoformat()
    counts_before = svc.compute_zalo_kpi_counts(
        ["11111111-1111-1111-1111-111111111111"],
        start_date=today,
        end_date=today,
        supabase=sb,
    )
    assert counts_before["11111111-1111-1111-1111-111111111111"]["inbox"] == 0
    assert counts_before["11111111-1111-1111-1111-111111111111"]["waiting"] == 1

    # 2. Khách trả lời qua ZCA listener -> tự động nâng cấp 2 chiều và +1 KPI
    in_res = svc.on_customer_inbound_message(
        account_id="acc_zalo_1",
        conversation_id="cust_uid_001",
        content="Dạ em cần báo giá gói web ạ",
        received_at=now_iso,
        supabase=sb,
    )
    assert in_res["status"] == "auto_confirmed_two_way"
    assert in_res["is_confirmed"] is True

    counts_after = svc.compute_zalo_kpi_counts(
        ["11111111-1111-1111-1111-111111111111"],
        start_date=today,
        end_date=today,
        supabase=sb,
    )
    assert counts_after["11111111-1111-1111-1111-111111111111"]["inbox"] == 1
    assert counts_after["11111111-1111-1111-1111-111111111111"]["waiting"] == 0


def test_inbound_post_feed_link_match_and_staff_reply_attribution():
    sb = _FakeSupabase()
    sb.tables["facebook_posts"].append({
        "id": "fb_post_777",
        "post_url": "https://www.facebook.com/groups/tech/posts/99887766",
    })
    now_iso = datetime.now(timezone.utc).isoformat()

    # Khách chủ động nhắn Zalo kèm link bài viết Post Feed -> inbound_pending
    in_res = svc.on_customer_inbound_message(
        account_id="acc_zalo_1",
        conversation_id="cust_uid_inbound",
        content="Mình thấy bài https://www.facebook.com/groups/tech/posts/99887766/ nhờ tư vấn",
        received_at=now_iso,
        supabase=sb,
    )
    assert in_res["status"] == "inbound_pending"
    assert in_res["source_type"] == "post_feed_inbound"
    assert in_res["is_confirmed"] is False
    assert in_res["row"]["source_post_id"] == "fb_post_777"

    # Sale2 trả lời khách -> confirm KPI gán đúng cho Sale2
    rep_res = svc.on_staff_reply_message(
        account_id="acc_zalo_1",
        conversation_id="cust_uid_inbound",
        caller_email="sale2@example.com",
        replied_at=now_iso,
        supabase=sb,
    )
    assert rep_res["is_confirmed"] is True
    assert rep_res["row"]["id_member"] == "22222222-2222-2222-2222-222222222222"


def test_30_day_lock_blocks_duplicate_phone_and_protects_confirmed_at():
    sb = _FakeSupabase()
    first_ts = (datetime.now(timezone.utc) - timedelta(days=5)).isoformat()
    later_ts = datetime.now(timezone.utc).isoformat()

    # Sale1 đã confirm với SĐT 0988777666 5 ngày trước
    sb.tables["zalo_inbox_kpi"].append({
        "id": 1,
        "id_member": "11111111-1111-1111-1111-111111111111",
        "id_leader": "99999999-9999-9999-9999-999999999999",
        "account_id": "acc_zalo_1",
        "conversation_id": "cust_uid_988",
        "phone_number": "0988777666",
        "source_type": "post_feed_outbound",
        "direction_status": "two_way",
        "is_confirmed": True,
        "is_lead": False,
        "confirmed_at": first_ts,
        "created_at": first_ts,
        "updated_at": first_ts,
    })

    # Sale2 nhắn lại cùng SĐT trên bài viết khác / tài khoản khác trong vòng 30 ngày -> khóa chống trùng
    res_dup_phone = svc.record_post_feed_outbound(
        account_id="acc_zalo_2",
        conversation_id="cust_uid_other",
        phone_number="0988777666",
        sender_email="sale2@example.com",
        source_platform="facebook",
        source_post_id="fb_post_202",
        sent_at=later_ts,
        supabase=sb,
    )
    assert res_dup_phone["status"] == "locked_30d"
    assert res_dup_phone["is_confirmed"] is False

    # Sale2 nhắn tiếp vào đúng hội thoại cũ -> confirmed_at & id_member lịch sử giữ nguyên bất biến
    res_repeat_reply = svc.on_staff_reply_message(
        account_id="acc_zalo_1",
        conversation_id="cust_uid_988",
        caller_email="sale2@example.com",
        replied_at=later_ts,
        supabase=sb,
    )
    assert res_repeat_reply["status"] == "locked_30d"
    assert sb.tables["zalo_inbox_kpi"][0]["confirmed_at"] == first_ts
    assert sb.tables["zalo_inbox_kpi"][0]["id_member"] == "11111111-1111-1111-1111-111111111111"


def test_group_conversation_and_system_auto_seeding_rules():
    sb = _FakeSupabase()
    sb.tables["zalo_groups"].append({
        "user_id": "acc_zalo_1",
        "group_id": "group_chat_999",
        "thread_type": "group",
        "is_friend": False,
    })
    now_iso = datetime.now(timezone.utc).isoformat()

    # Nhóm chat bị loại trừ khỏi KPI inbox 1-1
    grp_res = svc.on_customer_inbound_message(
        account_id="acc_zalo_1",
        conversation_id="group_chat_999",
        content="Mọi người ơi",
        received_at=now_iso,
        supabase=sb,
    )
    assert grp_res["status"] == "ignored_group"

    # Hệ thống auto-seeding gửi opener DM -> id_member=None, chưa tính cho ai
    sys_res = svc.record_post_feed_outbound(
        account_id="acc_zalo_1",
        conversation_id="cust_sys_1",
        phone_number="0911222333",
        is_system_auto=True,
        sent_at=now_iso,
        supabase=sb,
    )
    assert sys_res["status"] == "outbound_waiting"
    assert sys_res["row"]["id_member"] is None

    # Khách trả lời tin tự động của hệ thống -> chuyển inbound_pending đợi nhân viên thật vào rep
    in_sys = svc.on_customer_inbound_message(
        account_id="acc_zalo_1",
        conversation_id="cust_sys_1",
        content="Ok gửi bảng giá nhé",
        received_at=now_iso,
        supabase=sb,
    )
    assert in_sys["status"] == "inbound_pending"
    assert in_sys["is_confirmed"] is False

    # Nhân viên Sale1 vào phản hồi -> gán Sale1 & xác nhận +1 KPI
    rep_sys = svc.on_staff_reply_message(
        account_id="acc_zalo_1",
        conversation_id="cust_sys_1",
        caller_email="sale1@example.com",
        replied_at=now_iso,
        supabase=sb,
    )
    assert rep_sys["is_confirmed"] is True
    assert rep_sys["row"]["id_member"] == "11111111-1111-1111-1111-111111111111"


def test_manual_verify_and_enrich_posts_status():
    sb = _FakeSupabase()
    now_iso = datetime.now(timezone.utc).isoformat()

    # Nhắn từ Post A đang chờ rep
    svc.record_post_feed_outbound(
        account_id="acc_zalo_1",
        conversation_id="cust_uid_manual",
        phone_number="0933444555",
        sender_email="sale1@example.com",
        source_platform="facebook",
        source_post_id="fb_post_A",
        sent_at=now_iso,
        supabase=sb,
    )
    # Leader duyệt tay + đánh dấu Lead (vd khách gọi điện lại sau khi nhận Zalo)
    man_res = svc.manual_verify_conversation(
        account_id="acc_zalo_1",
        conversation_id="cust_uid_manual",
        verifier_email="leader@example.com",
        member_email="sale1@example.com",
        is_confirmed=True,
        is_lead=True,
        note="Khách gọi hotline xác nhận",
        supabase=sb,
    )
    assert man_res["ok"] is True
    assert man_res["row"]["is_confirmed"] is True
    assert man_res["row"]["is_lead"] is True

    # Enrich lên 2 bài post cùng SĐT: Bài A confirmed, Bài B locked_30d
    posts = [
        {"id": "fb_post_A", "auto_seeding_comment": {"phone_number": "+84933444555"}},
        {"id": "fb_post_B", "auto_seeding_comment": {"phone_number": "0933444555"}},
    ]
    svc.enrich_posts_with_zalo_kpi(sb, posts)
    assert posts[0]["zalo_kpi_status"] == "confirmed"
    assert posts[1]["zalo_kpi_status"] == "locked_30d"
