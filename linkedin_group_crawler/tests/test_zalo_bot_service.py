"""Bot Zalo: cấu hình, tiếp quản hội thoại, nhãn Bot, nhật ký/thống kê, gửi tin ra."""
import asyncio
from datetime import datetime, timedelta, timezone
from unittest import mock

import pytest

from app.modules.all_platform.zalo.services import zalo_bot_service as svc
from app.modules.all_platform.zalo.services import zalo_chatwoot_bridge as bridge


def run(coro):
    return asyncio.run(coro)


NOW = datetime(2026, 11, 4, 3, 0, 0, tzinfo=timezone.utc)


# ── Tiện ích thuần ────────────────────────────────────────────────────────

def test_parse_ts_handles_z_offset_and_fraction():
    assert svc.parse_ts("2026-11-04T03:00:00Z") == NOW
    assert svc.parse_ts("2026-11-04T03:00:00+00:00") == NOW
    assert svc.parse_ts("2026-11-04T10:00:00+07:00") == NOW
    # PostgREST có thể trả số lẻ giây 5-6 chữ số
    assert svc.parse_ts("2026-11-04T03:00:00.12345+00:00") == NOW + timedelta(microseconds=123450)
    assert svc.parse_ts("") is None and svc.parse_ts(None) is None and svc.parse_ts("khong phai ngay") is None


def test_extract_zca_msg_id():
    assert svc.extract_zca_msg_id({"response": {"message": {"msgId": 123456789012345}}}) == "123456789012345"
    assert svc.extract_zca_msg_id({"result": {"attachment": [{"msgId": 77}]}}) == "77"
    assert svc.extract_zca_msg_id({"response": {"message": None}}) is None
    assert svc.extract_zca_msg_id(None) is None and svc.extract_zca_msg_id("x") is None


def test_effective_pause_states():
    assert svc.effective_pause(None, NOW)["paused"] is False
    assert svc.effective_pause({"paused": False}, NOW)["paused"] is False
    forever = svc.effective_pause({"paused": True, "paused_until": None, "reason": "manual", "paused_by": "a@x"}, NOW)
    assert forever["paused"] and forever["paused_until"] is None and forever["reason"] == "manual"
    future = svc.effective_pause({"paused": True, "paused_until": "2026-11-04T04:00:00Z", "reason": "staff_reply"}, NOW)
    assert future["paused"] and future["paused_until"] == "2026-11-04T04:00:00Z"
    expired = svc.effective_pause({"paused": True, "paused_until": "2026-11-04T02:00:00Z"}, NOW)
    assert expired["paused"] is False and expired["expired"] is True


def test_validate_config_patch():
    base = svc.normalize_config(None)
    assert base["is_enabled"] is False and base["dry_run"] is True and base["pause_minutes"] == 60

    ok = svc.validate_config_patch(base, {"chatwoot_account_id": 3, "chatwoot_inbox_id": 162, "is_enabled": True})
    assert ok["is_enabled"] and ok["dry_run"] is True

    with pytest.raises(ValueError, match="Chatwoot"):
        svc.validate_config_patch(base, {"is_enabled": True})  # bật khi thiếu ID
    with pytest.raises(ValueError):
        svc.validate_config_patch(base, {"chatwoot_account_id": 0})
    with pytest.raises(ValueError):
        svc.validate_config_patch(base, {"chatwoot_inbox_id": "162"})
    with pytest.raises(ValueError):
        svc.validate_config_patch(base, {"pause_minutes": 5000})
    # ID có thể xoá về None khi bot đang tắt
    cleared = svc.validate_config_patch({**base, "chatwoot_account_id": 3, "chatwoot_inbox_id": 1}, {"chatwoot_inbox_id": None})
    assert cleared["chatwoot_inbox_id"] is None
    # field lạ bị bỏ qua
    assert "hack" not in svc.validate_config_patch(base, {"hack": 1})


def test_apply_bot_labels_by_id_and_by_content():
    rows = [
        {"source_message_id": "111", "is_sent": True, "content": "Dạ chào anh", "ts": 1793760000000},
        {"source_message_id": "222", "is_sent": True, "content": "Nhân viên gõ tay", "ts": 1793760001000},
        {"source_message_id": "333", "is_sent": True, "content": "Câu không có msgId", "ts": 1793760100000},
        {"source_message_id": "444", "is_sent": False, "content": "Dạ chào anh", "ts": 1793760000000},  # tin của khách
    ]
    t = datetime.fromtimestamp(1793760100, tz=timezone.utc).isoformat()
    logs = [
        {"source_msg_id": "111", "content": "Dạ chào anh", "created_at": t},
        {"source_msg_id": None, "content": "Câu không có msgId", "created_at": t},
    ]
    assert svc.apply_bot_labels(rows, logs) == 2
    assert rows[0].get("sent_by") == "bot"
    assert "sent_by" not in rows[1]          # nhân viên
    assert rows[2].get("sent_by") == "bot"   # khớp theo nội dung + thời gian
    assert "sent_by" not in rows[3]          # không phải tin gửi đi


def test_apply_bot_labels_content_match_respects_time_window():
    old = datetime.fromtimestamp(1793700000, tz=timezone.utc).isoformat()
    rows = [{"source_message_id": "9", "is_sent": True, "content": "Xin chào", "ts": 1793760000000}]
    assert svc.apply_bot_labels(rows, [{"source_msg_id": None, "content": "Xin chào", "created_at": old}]) == 0


def test_aggregate_stats_counts_by_day_in_vn_timezone():
    rows = [
        {"direction": "in", "status": "forwarded", "thread_id": "a", "created_at": "2026-11-04T01:00:00Z"},
        {"direction": "in", "status": "forwarded", "thread_id": "b", "created_at": "2026-11-04T02:00:00Z"},
        {"direction": "out", "status": "sent", "thread_id": "a", "created_at": "2026-11-04T02:01:00Z"},
        {"direction": "out", "status": "error", "thread_id": "a", "created_at": "2026-11-03T20:00:00Z"},  # = 04/11 03:00 giờ VN
        {"direction": "in", "status": "dry_run", "thread_id": "a", "created_at": "2026-11-02T05:00:00Z"},
    ]
    out = svc.aggregate_stats(rows, 3, now=NOW)
    assert out["totals"]["forwarded"] == 2 and out["totals"]["sent"] == 1 and out["totals"]["error"] == 1
    assert out["totals"]["dry_run"] == 1 and out["threads_handled"] == 2
    days = {d["date"]: d for d in out["by_day"]}
    assert list(days) == ["2026-11-02", "2026-11-03", "2026-11-04"]
    assert days["2026-11-04"] == {"date": "2026-11-04", "in": 2, "out": 2, "error": 1}


# ── Có mock DB / Chatwoot ─────────────────────────────────────────────────

class FakeDB:
    """Giả lập _rest cho zalo_bot_configs/zalo_bot_threads/zalo_groups/zalo_bot_logs."""

    def __init__(self):
        self.tables = {"zalo_bot_configs": [], "zalo_bot_threads": [], "zalo_groups": [], "zalo_bot_logs": [], "zalo_bot_cursor": [], "zalo_bot_thread_rules": []}
        self.calls = []

    async def rest(self, method, path, *, params=None, json=None, prefer=None):
        self.calls.append((method, path, params, json))
        table = self.tables.setdefault(path, [])
        params = params or {}
        if method == "GET":
            rows = [r for r in table if all(self._match(r, k, v) for k, v in params.items() if k not in ("select", "limit", "order", "or"))]
            lim = int(params.get("limit", 1000))
            return rows[:lim]
        if method == "POST":
            for item in json:
                key = {"zalo_bot_configs": ("account_id",), "zalo_bot_threads": ("account_id", "thread_id"),
                       "zalo_bot_cursor": ("account_id",),
                       "zalo_bot_thread_rules": ("account_id", "thread_id")}.get(path)
                if key:
                    existing = next((r for r in table if all(r.get(k) == item.get(k) for k in key)), None)
                    if existing:
                        existing.update(item)
                        continue
                row = dict(item)
                if path == "zalo_bot_logs":
                    row["id"] = len(table) + 1
                    row.setdefault("created_at", "2026-11-04T03:00:00Z")
                table.append(row)
            return None
        if method == "DELETE":
            table[:] = [r for r in table if not all(self._match(r, k, v) for k, v in params.items())]
            return None
        raise AssertionError(method)

    @staticmethod
    def _match(row, key, cond):
        if not isinstance(cond, str) or "." not in cond:
            return True
        op, _, val = cond.partition(".")
        cur = row.get(key)
        if op == "eq":
            return str(cur).lower() == val.lower() if val in ("true", "false") else str(cur) == val
        if op == "in":
            return str(cur) in [x.strip('"') for x in val.strip("()").split(",")]
        if op == "neq":
            return str(cur) != val
        return True


@pytest.fixture()
def db():
    fake = FakeDB()
    fake.tables["zalo_groups"].append({"user_id": "acc1", "group_id": "u100", "thread_type": "user", "is_friend": False})
    fake.tables["zalo_groups"].append({"user_id": "acc1", "group_id": "g200", "thread_type": "group", "is_friend": False})
    with mock.patch.object(svc, "_rest", fake.rest), mock.patch.object(bridge, "_rest", fake.rest):
        yield fake


def _enable(db, **extra):
    row = {"account_id": "acc1", "is_enabled": True, "dry_run": False, "chatwoot_account_id": 3,
           "chatwoot_inbox_id": 162, "auto_pause_on_staff_reply": True, "pause_minutes": 60, "chatwoot_sync": True}
    row.update(extra)
    db.tables["zalo_bot_configs"].append(row)
    return {**svc.normalize_config(row), "account_id": "acc1"}


def test_upsert_config_enabling_resets_cursor_and_requires_ids(db):
    with pytest.raises(ValueError):
        run(svc.upsert_config("acc1", {"is_enabled": True}, "a@x"))
    with mock.patch.object(svc, "load_zca_auth", mock.AsyncMock(return_value={"k": 1})):
        view = run(svc.upsert_config("acc1", {"chatwoot_account_id": 3, "chatwoot_inbox_id": 162, "is_enabled": True}, "a@x"))
    assert view["is_enabled"] and view["dry_run"] is True and view["exists"]
    assert view["readiness"]["zca_logged_in"] and view["readiness"]["config_complete"]
    assert db.tables["zalo_bot_cursor"], "bật bot lần đầu phải đặt cursor = bây giờ"
    cursor_before = db.tables["zalo_bot_cursor"][0]["last_message_ts"]
    # cập nhật khác khi bot đã bật: KHÔNG reset cursor
    with mock.patch.object(svc, "load_zca_auth", mock.AsyncMock(return_value=None)):
        run(svc.upsert_config("acc1", {"dry_run": False}, "a@x"))
    assert db.tables["zalo_bot_cursor"][0]["last_message_ts"] == cursor_before
    assert db.tables["zalo_bot_configs"][0]["updated_by"] == "a@x"


def test_set_pause_manual_forever_and_resume(db):
    cfg = _enable(db)
    with mock.patch.object(svc, "chatwoot_ready", return_value=False):
        state = run(svc.set_pause(cfg, "u100", minutes=None, reason="manual", by="nv@x"))
        assert state["paused"] and state["paused_until"] is None and state["reason"] == "manual" and state["paused_by"] == "nv@x"
        assert run(svc.is_paused_or_expire(cfg, "u100")) is True
        assert run(svc.list_paused_thread_ids("acc1")) == ["u100"]
        cleared = run(svc.clear_pause(cfg, "u100", by="nv@x"))
    assert cleared["paused"] is False
    assert run(svc.list_paused_thread_ids("acc1")) == []


def test_expired_pause_auto_resumes_and_clears_chatwoot(db):
    cfg = _enable(db)
    db.tables["zalo_bot_threads"].append({"account_id": "acc1", "thread_id": "u100", "paused": True,
                                          "paused_until": "2026-11-04T01:00:00Z", "reason": "staff_reply"})
    handoff = mock.AsyncMock(return_value=True)
    with mock.patch.object(svc, "chatwoot_set_handoff", handoff), \
         mock.patch.object(svc, "_now", return_value=NOW):
        assert run(svc.is_paused_or_expire(cfg, "u100")) is False
    handoff.assert_awaited_once_with(cfg, "u100", False)
    assert db.tables["zalo_bot_threads"][0]["paused"] is False


def test_note_staff_reply_pauses_only_when_applicable(db):
    # bot tắt -> không làm gì
    run(svc.note_staff_reply("acc1", "u100", "nv@x"))
    assert db.tables["zalo_bot_threads"] == []
    _enable(db)
    with mock.patch.object(svc, "chatwoot_ready", return_value=False):
        run(svc.note_staff_reply("acc1", "g200", "nv@x"))      # nhóm -> bỏ qua
        assert db.tables["zalo_bot_threads"] == []
        run(svc.note_staff_reply("acc1", "u100", "nv@x"))      # 1-1 -> tạm dừng 60 phút
        row = db.tables["zalo_bot_threads"][0]
        assert row["paused"] and row["reason"] == "staff_reply" and row["paused_until"]
        # đã tạm dừng vô thời hạn (manual) -> không bị ghi đè bởi tạm dừng có hạn
        row.update({"paused_until": None, "reason": "manual"})
        run(svc.note_staff_reply("acc1", "u100", "nv@x"))
        assert row["paused_until"] is None and row["reason"] == "manual"


def test_note_staff_reply_respects_auto_pause_off_and_never_raises(db):
    _enable(db, auto_pause_on_staff_reply=False)
    run(svc.note_staff_reply("acc1", "u100", "nv@x"))
    assert db.tables["zalo_bot_threads"] == []
    with mock.patch.object(svc, "get_config_row", mock.AsyncMock(side_effect=RuntimeError("db sập"))):
        run(svc.note_staff_reply("acc1", "u100", "nv@x"))  # không ném lỗi


def test_thread_status_states(db):
    assert run(svc.thread_status("acc1", "u100"))["state"] == "off"            # chưa có cấu hình
    _enable(db)
    with mock.patch.object(svc, "chatwoot_ready", return_value=False):
        assert run(svc.thread_status("acc1", "u100"))["state"] == "active"
        assert run(svc.thread_status("acc1", "g200"))["state"] == "off"        # nhóm
        db.tables["zalo_bot_threads"].append({"account_id": "acc1", "thread_id": "u100", "paused": True,
                                              "paused_until": None, "reason": "manual", "paused_by": "nv@x"})
        st = run(svc.thread_status("acc1", "u100"))
    assert st["state"] == "paused" and st["reason"] == "manual" and st["paused_by"] == "nv@x"
    db.tables["zalo_bot_threads"].clear()
    with mock.patch.object(svc, "chatwoot_ready", return_value=True), \
         mock.patch.object(svc, "chatwoot_handed_off", mock.AsyncMock(return_value=True)):
        assert run(svc.thread_status("acc1", "u100"))["state"] == "handed_off"


# ── Bridge: gửi tin ra ────────────────────────────────────────────────────

def _patch_bridge(db, monkeypatch=None):
    return (
        mock.patch.object(bridge, "get_config_row", db_get_config(db)),
        mock.patch.object(bridge, "load_zca_auth", mock.AsyncMock(return_value={"auth": 1})),
        mock.patch.object(bridge, "REPLY_DELAY_MIN_S", 0),
        mock.patch.object(bridge, "REPLY_DELAY_MAX_S", 0),
    )


def db_get_config(db):
    async def _get(account_id):
        return next((r for r in db.tables["zalo_bot_configs"] if r["account_id"] == account_id), None)
    return _get


def test_send_outbound_bot_logs_msgid_and_blocks_when_paused(db):
    _enable(db)
    send = mock.AsyncMock(return_value={"response": {"message": {"msgId": 555}}})
    patches = _patch_bridge(db)
    with patches[0], patches[1], patches[2], patches[3], mock.patch.object(bridge, "send_zca_message", send), \
         mock.patch.object(svc, "chatwoot_ready", return_value=False):
        out = run(bridge.send_outbound_message("acc1", "u100", "Dạ chào anh", sender_type="agent_bot"))
        assert out == {"status": "sent", "sent_by": "bot"}
        log = db.tables["zalo_bot_logs"][-1]
        assert log["status"] == "sent" and log["source_msg_id"] == "555" and log["sent_by"] == "bot" and log["direction"] == "out"

        # nhân viên tiếp quản -> tin của bot bị chặn, không gọi zca
        db.tables["zalo_bot_threads"].append({"account_id": "acc1", "thread_id": "u100", "paused": True, "paused_until": None})
        send.reset_mock()
        out = run(bridge.send_outbound_message("acc1", "u100", "Bot nói tiếp", sender_type="agent_bot"))
        assert out == {"status": "skipped", "reason": "paused"}
        send.assert_not_awaited()

        # nhưng nhân viên trả lời từ Chatwoot (sender_type=user) vẫn được gửi, gắn nhãn staff
        out = run(bridge.send_outbound_message("acc1", "u100", "Em chào anh, em là nhân viên", sender_type="user"))
        assert out == {"status": "sent", "sent_by": "staff"}
        send.assert_awaited_once()
        assert db.tables["zalo_bot_logs"][-1]["sent_by"] == "staff"


def test_send_outbound_dry_run_and_disabled(db):
    send = mock.AsyncMock()
    patches = _patch_bridge(db)
    with patches[0], patches[1], patches[2], patches[3], mock.patch.object(bridge, "send_zca_message", send):
        assert run(bridge.send_outbound_message("acc1", "u100", "x"))["status"] == "skipped"   # chưa bật
        _enable(db, dry_run=True)
        assert run(bridge.send_outbound_message("acc1", "u100", "x"))["status"] == "dry_run"
    send.assert_not_awaited()
    assert db.tables["zalo_bot_logs"][-1]["status"] == "dry_run"


def test_bridge_tick_skips_paused_threads_and_missing_ids(db):
    cfg = _enable(db, dry_run=False)
    cfg_row = db.tables["zalo_bot_configs"][0]
    db.tables["zalo_bot_cursor"].append({"account_id": "acc1", "last_message_ts": 100})
    db.tables["zalo_messages"] = [
        {"user_id": "acc1", "group_id": "u100", "is_sent": False, "is_deleted": False, "ts": 200,
         "content": "Chào shop", "msg_kind": "text", "source_message_id": "m1", "sender_name": "Khách"},
    ]
    db.tables["zalo_bot_threads"].append({"account_id": "acc1", "thread_id": "u100", "paused": True, "paused_until": None})
    post = mock.AsyncMock()
    with mock.patch.object(bridge, "_post_to_n8n", post), mock.patch.object(bridge, "N8N_INCOMING_URL", "http://n8n/x"), \
         mock.patch.object(svc, "chatwoot_ready", return_value=False):
        run(bridge.run_bridge_tick_for_account(cfg_row))
    post.assert_not_awaited()
    assert db.tables["zalo_bot_logs"][-1]["status"] == "paused"
    assert db.tables["zalo_bot_cursor"][0]["last_message_ts"] == 200   # đã đi qua tin đó, không đẩy lại

    # thiếu Chatwoot ID -> không làm gì, không đụng cursor
    db.tables["zalo_bot_cursor"][0]["last_message_ts"] = 100
    cfg_row["chatwoot_inbox_id"] = None
    run(bridge.run_bridge_tick_for_account(cfg_row))
    assert db.tables["zalo_bot_cursor"][0]["last_message_ts"] == 100


def test_bridge_tick_forwards_webchat_text_but_skips_media(db):
    """Tin chữ thật của Zalo có msg_kind='webchat' (không phải 'text') -> phải được đẩy sang n8n; ảnh/sticker thì bỏ qua."""
    _enable(db, dry_run=False)
    cfg_row = db.tables["zalo_bot_configs"][0]
    db.tables["zalo_bot_cursor"].append({"account_id": "acc1", "last_message_ts": 100})
    base = {"user_id": "acc1", "group_id": "u100", "is_sent": False, "is_deleted": False, "sender_name": "Khách"}
    db.tables["zalo_messages"] = [
        {**base, "ts": 200, "content": "markee có dịch vụ gì", "msg_kind": "webchat", "type": "webchat", "source_message_id": "m1"},
        {**base, "ts": 300, "content": "[ảnh]", "msg_kind": "chat.photo", "type": "chat.photo", "source_message_id": "m2"},
        {**base, "ts": 400, "content": "hi", "msg_kind": None, "type": "webchat", "source_message_id": "m3"},
    ]
    post = mock.AsyncMock()
    with mock.patch.object(bridge, "_post_to_n8n", post), mock.patch.object(bridge, "N8N_INCOMING_URL", "http://n8n/x"), \
         mock.patch.object(svc, "chatwoot_ready", return_value=False):
        run(bridge.run_bridge_tick_for_account(cfg_row))
    # 2 tin chữ (m1, m3) bị ảnh m2 ngăn cách -> gộp thành 1 lượt chuyển (mã tin cuối m3); ảnh bị bỏ qua
    assert [c.args[1]["source_message_id"] for c in post.await_args_list] == ["m3"]
    assert post.await_args_list[0].args[1]["content"] == "markee có dịch vụ gì\nhi"
    assert db.tables["zalo_bot_cursor"][0]["last_message_ts"] == 400


def test_clean_search_strips_postgrest_specials():
    assert svc._clean_search("a,b(c)*d%e\"f'") == "a b c  d e f"
    assert len(svc._clean_search("x" * 500)) == 80


# ── Phạm vi bật bot theo người (migration 219) ────────────────────────────

def test_in_scope_truth_table():
    # 'all': trả lời tất cả, trừ người bị tắt
    assert svc.in_scope("all", None) is True
    assert svc.in_scope("all", True) is True
    assert svc.in_scope("all", False) is False
    # 'selected': chỉ người được bật tay
    assert svc.in_scope("selected", None) is False
    assert svc.in_scope("selected", True) is True
    assert svc.in_scope("selected", False) is False


def test_validate_scope_mode():
    base = svc.normalize_config(None)
    assert base["scope_mode"] == "all"
    assert svc.validate_config_patch(base, {"scope_mode": "selected"})["scope_mode"] == "selected"
    with pytest.raises(ValueError, match="Phạm vi"):
        svc.validate_config_patch(base, {"scope_mode": "everyone"})


def test_set_rules_on_off_reset_and_limits(db):
    assert run(svc.set_rules("acc1", ["u100", "u101", "u100"], True, "a@x")) == 2   # bỏ trùng
    assert run(svc.get_rules("acc1")) == {"u100": True, "u101": True}
    run(svc.set_rules("acc1", ["u101"], False, "a@x"))
    assert run(svc.get_rules("acc1")) == {"u100": True, "u101": False}
    assert run(svc.get_rule("acc1", "u101")) is False and run(svc.get_rule("acc1", "zzz")) is None
    run(svc.set_rules("acc1", ["u100"], None, "a@x"))                                 # None = bỏ rule
    assert run(svc.get_rules("acc1")) == {"u101": False}
    summary = run(svc.scope_summary("acc1", "all"))
    assert summary == {"scope_mode": "all", "on_count": 0, "off_count": 1}
    run(svc.clear_all_rules("acc1"))
    assert run(svc.get_rules("acc1")) == {}
    assert run(svc.set_rules("acc1", [], True, None)) == 0
    with pytest.raises(ValueError, match="tối đa"):
        run(svc.set_rules("acc1", [f"t{i}" for i in range(svc.MAX_RULE_BATCH + 1)], True, None))


def test_get_rules_survives_missing_table():
    async def boom(*a, **k):
        raise RuntimeError("relation does not exist")
    with mock.patch.object(svc, "_rest", boom):
        assert run(svc.get_rules("acc1")) == {}          # chưa chạy migration 219: bot không sập
        assert run(svc.get_rule("acc1", "u100")) is None


def _bridge_run(db, scope_mode, rules):
    _enable(db, scope_mode=scope_mode)
    cfg_row = db.tables["zalo_bot_configs"][0]
    db.tables["zalo_bot_cursor"].append({"account_id": "acc1", "last_message_ts": 100})
    for t, on in rules.items():
        db.tables["zalo_bot_thread_rules"].append({"account_id": "acc1", "thread_id": t, "bot_on": on})
    db.tables["zalo_groups"].append({"user_id": "acc1", "group_id": "u101", "thread_type": "user", "is_friend": False})
    base = {"user_id": "acc1", "is_sent": False, "is_deleted": False, "msg_kind": "webchat", "sender_name": "Khách"}
    db.tables["zalo_messages"] = [
        {**base, "group_id": "u100", "ts": 200, "content": "A hỏi", "source_message_id": "mA"},
        {**base, "group_id": "u101", "ts": 300, "content": "B hỏi", "source_message_id": "mB"},
    ]
    post = mock.AsyncMock()
    with mock.patch.object(bridge, "_post_to_n8n", post), mock.patch.object(bridge, "N8N_INCOMING_URL", "http://n8n/x"), \
         mock.patch.object(svc, "chatwoot_ready", return_value=False):
        run(bridge.run_bridge_tick_for_account(cfg_row))
    return [c.args[1]["source_message_id"] for c in post.await_args_list]


def test_bridge_scope_all_excludes_only_turned_off_people(db):
    assert _bridge_run(db, "all", {"u101": False}) == ["mA"]
    skipped = [l for l in db.tables["zalo_bot_logs"] if l["status"] == "skipped"]
    assert len(skipped) == 1 and skipped[0]["thread_id"] == "u101" and "Ngoài phạm vi" in skipped[0]["error"]
    assert db.tables["zalo_bot_cursor"][0]["last_message_ts"] == 300     # vẫn đi qua tin bị loại, không kẹt


def test_bridge_scope_all_default_answers_everyone(db):
    assert _bridge_run(db, "all", {}) == ["mA", "mB"]


def test_bridge_scope_selected_answers_only_chosen_people(db):
    assert _bridge_run(db, "selected", {"u100": True}) == ["mA"]


def test_bridge_scope_selected_with_nobody_chosen_answers_no_one(db):
    assert _bridge_run(db, "selected", {}) == []


def test_outbound_bot_reply_blocked_out_of_scope_but_staff_allowed(db):
    _enable(db, scope_mode="selected", dry_run=True)
    send = mock.AsyncMock(return_value={"response": {"message": {"msgId": 1}}})
    patches = _patch_bridge(db)
    with patches[0], patches[1], patches[2], patches[3], mock.patch.object(bridge, "send_zca_message", send):
        blocked = run(bridge.send_outbound_message("acc1", "u100", "chào", sender_type="agent_bot"))
        assert blocked == {"status": "skipped", "reason": "out_of_scope"}
        staff = run(bridge.send_outbound_message("acc1", "u100", "nhân viên nói", sender_type="user"))
        assert staff["status"] == "dry_run"                                  # nhân viên không bị chặn bởi phạm vi
        db.tables["zalo_bot_thread_rules"].append({"account_id": "acc1", "thread_id": "u100", "bot_on": True})
        allowed = run(bridge.send_outbound_message("acc1", "u100", "chào", sender_type="agent_bot"))
        assert allowed["status"] == "dry_run"


def test_thread_status_reports_scope(db):
    _enable(db, scope_mode="selected")
    with mock.patch.object(svc, "chatwoot_ready", return_value=False):
        st = run(svc.thread_status("acc1", "u100"))
        assert st["state"] == "out_of_scope" and st["in_scope"] is False and st["rule"] is None and st["scope_mode"] == "selected"
        run(svc.set_rules("acc1", ["u100"], True, "a@x"))
        st = run(svc.thread_status("acc1", "u100"))
        assert st["state"] == "active" and st["in_scope"] is True and st["rule"] is True


def test_list_scope_candidates_marks_rules(db):
    db.tables["zalo_groups"][0]["group_name"] = "Anh Hiếu"
    db.tables["zalo_groups"][0]["avatar_url"] = "https://img/x.jpg"
    run(svc.set_rules("acc1", ["u100"], False, "a@x"))
    items = run(svc.list_scope_candidates("acc1", None))
    assert {"thread_id": "u100", "name": "Anh Hiếu", "avatar_url": "https://img/x.jpg", "rule": False} in items


def test_missing_scope_table_gives_actionable_message(db):
    async def boom(method, path, **kw):
        raise RuntimeError('Supabase POST zalo_bot_thread_rules failed: 404 {"code":"PGRST205"}')
    with mock.patch.object(svc, "_rest", boom):
        with pytest.raises(ValueError, match="setup_test_db.py"):
            run(svc.set_rules("acc1", ["u100"], True, "a@x"))


# ── Gom tin khách nhắn liên tiếp (migration 220) ──────────────────────────
import time as _time


def _batch_env(db, wait=10, **cfg_extra):
    _enable(db, batch_wait_seconds=wait, dry_run=False, **cfg_extra)
    db.tables["zalo_bot_cursor"].append({"account_id": "acc1", "last_message_ts": 100})
    db.tables["zalo_groups"].append({"user_id": "acc1", "group_id": "u101", "thread_type": "user", "is_friend": False})
    db.tables["zalo_messages"] = []
    return db.tables["zalo_bot_configs"][0]


def _msg(thread, ts, content, mid):
    return {"user_id": "acc1", "group_id": thread, "is_sent": False, "is_deleted": False, "ts": ts,
            "content": content, "msg_kind": "webchat", "source_message_id": mid, "sender_name": "Khách"}


def _tick(cfg_row, post, at_ms=None):
    """Chạy 1 tick; at_ms = giả lập thời điểm hiện tại (ms)."""
    ctx = [mock.patch.object(bridge, "_post_to_n8n", post), mock.patch.object(bridge, "N8N_INCOMING_URL", "http://n8n/x"),
           mock.patch.object(svc, "chatwoot_ready", return_value=False)]
    if at_ms is not None:
        ctx.append(mock.patch.object(bridge.time, "time", return_value=at_ms / 1000))
    for c in ctx:
        c.start()
    try:
        run(bridge.run_bridge_tick_for_account(cfg_row))
    finally:
        for c in reversed(ctx):
            c.stop()


def _now():
    return int(_time.time() * 1000)


def test_batch_defers_until_customer_goes_quiet_then_sends_one_combined_message(db):
    cfg = _batch_env(db, wait=10)
    now = _now()
    db.tables["zalo_messages"] = [_msg("u100", now - 3000, "Marketing", "m1"), _msg("u100", now - 1000, "Marketing thì sao", "m2")]
    post = mock.AsyncMock()

    _tick(cfg, post, at_ms=now)                                   # khách vừa nhắn 1s trước -> chờ
    post.assert_not_awaited()
    assert db.tables["zalo_bot_cursor"][0]["last_message_ts"] == 100   # cursor đứng yên, chưa mất tin
    assert db.tables["zalo_bot_logs"] == []

    _tick(cfg, post, at_ms=now + 5000)                            # mới im lặng 6s -> vẫn chờ
    post.assert_not_awaited()

    _tick(cfg, post, at_ms=now + 12000)                           # im lặng 13s -> gộp 2 tin thành 1
    assert post.await_count == 1
    sent = post.await_args_list[0].args[1]
    assert sent["content"] == "Marketing\nMarketing thì sao" and sent["source_message_id"] == "m2"
    logs = db.tables["zalo_bot_logs"]
    assert [(l["source_msg_id"], l["status"]) for l in logs] == [("m1", "forwarded"), ("m2", "forwarded")]
    assert "Gộp 2 tin" in logs[0]["error"]
    assert db.tables["zalo_bot_cursor"][0]["last_message_ts"] == now - 1000

    _tick(cfg, post, at_ms=now + 20000)                           # tick sau: không chuyển lại
    assert post.await_count == 1


def test_batch_wait_zero_forwards_each_message_separately(db):
    cfg = _batch_env(db, wait=0)
    now = _now()
    db.tables["zalo_messages"] = [_msg("u100", now - 2000, "một", "m1"), _msg("u100", now - 1000, "hai", "m2")]
    post = mock.AsyncMock()
    _tick(cfg, post, at_ms=now)
    # wait=0 = tắt gom: không chờ, mỗi tin một lượt chuyển như trước
    assert [c.args[1]["content"] for c in post.await_args_list] == ["một", "hai"]


def test_batch_hard_cap_stops_waiting_for_endless_typing(db):
    cfg = _batch_env(db, wait=10)
    now = _now()
    db.tables["zalo_messages"] = [_msg("u100", now - 50_000, "a", "m1"), _msg("u100", now - 1_000, "b", "m2")]
    post = mock.AsyncMock()
    with mock.patch.object(bridge, "BATCH_HARD_CAP_S", 40):
        _tick(cfg, post, at_ms=now)                               # tin đầu đã chờ 50s > 40s -> gửi dù khách còn gõ
    assert post.await_count == 1 and post.await_args_list[0].args[1]["content"] == "a\nb"


def test_batch_other_threads_not_blocked_and_not_forwarded_twice(db):
    cfg = _batch_env(db, wait=10)
    now = _now()
    db.tables["zalo_messages"] = [
        _msg("u100", now - 30_000, "A1", "a1"), _msg("u100", now - 2_000, "A2", "a2"),   # đang gõ -> hoãn
        _msg("u101", now - 15_000, "B1", "b1"),                                            # đã im lặng 15s -> gửi ngay
    ]
    post = mock.AsyncMock()
    _tick(cfg, post, at_ms=now)
    assert [c.args[1]["source_message_id"] for c in post.await_args_list] == ["b1"]
    # cursor bị giữ lại trước tin của u100 (hoãn) nên tick sau đọc lại cả b1 -> phải bỏ qua b1
    assert db.tables["zalo_bot_cursor"][0]["last_message_ts"] == now - 30_001
    _tick(cfg, post, at_ms=now + 9000)                            # u100 đã im lặng 11s
    assert [c.args[1]["source_message_id"] for c in post.await_args_list] == ["b1", "a2"]
    assert post.await_args_list[1].args[1]["content"] == "A1\nA2"
    assert db.tables["zalo_bot_cursor"][0]["last_message_ts"] == now - 2_000


def test_batch_splits_into_chunks_of_max_messages(db):
    cfg = _batch_env(db, wait=10)
    now = _now()
    db.tables["zalo_messages"] = [_msg("u100", now - 60_000 + i, f"t{i}", f"m{i}") for i in range(12)]
    post = mock.AsyncMock()
    with mock.patch.object(bridge, "MAX_BATCH_MESSAGES", 10):
        _tick(cfg, post, at_ms=now)
    contents = [c.args[1]["content"].count("\n") + 1 for c in post.await_args_list]
    assert contents == [10, 2]


def test_batch_staff_takeover_during_wait_blocks_the_reply(db):
    cfg = _batch_env(db, wait=10)
    now = _now()
    db.tables["zalo_messages"] = [_msg("u100", now - 3000, "xin giá", "m1")]
    post = mock.AsyncMock()
    _tick(cfg, post, at_ms=now)
    post.assert_not_awaited()
    # nhân viên nhắn tay trong lúc bot đang chờ gom -> bot đã bị tạm dừng
    db.tables["zalo_bot_threads"].append({"account_id": "acc1", "thread_id": "u100", "paused": True, "paused_until": None})
    _tick(cfg, post, at_ms=now + 15000)
    post.assert_not_awaited()
    assert db.tables["zalo_bot_logs"][-1]["status"] == "paused"
    assert db.tables["zalo_bot_cursor"][0]["last_message_ts"] == now - 3000


def test_batch_n8n_failure_keeps_messages_and_retries_without_duplicates(db):
    cfg = _batch_env(db, wait=0)
    now = _now()
    db.tables["zalo_messages"] = [_msg("u100", now - 5000, "hello", "m1")]
    boom = mock.AsyncMock(side_effect=RuntimeError("n8n 502"))
    _tick(cfg, boom, at_ms=now)
    assert db.tables["zalo_bot_logs"][-1]["status"] == "error"
    assert db.tables["zalo_bot_cursor"][0]["last_message_ts"] == 100      # giữ lại để thử lại
    ok = mock.AsyncMock()
    _tick(cfg, ok, at_ms=now + 3000)
    assert ok.await_count == 1                                            # thử lại thành công đúng 1 lần
    _tick(cfg, ok, at_ms=now + 6000)
    assert ok.await_count == 1


def test_batch_wait_validation_and_default():
    base = svc.normalize_config(None)
    assert base["batch_wait_seconds"] == 10
    assert svc.validate_config_patch(base, {"batch_wait_seconds": 0})["batch_wait_seconds"] == 0
    assert svc.validate_config_patch(base, {"batch_wait_seconds": 120})["batch_wait_seconds"] == 120
    for bad in (-1, 121, "5", True, 2.5):
        with pytest.raises(ValueError, match="gom tin"):
            svc.validate_config_patch(base, {"batch_wait_seconds": bad})


def test_missing_batch_column_gives_actionable_message(db):
    async def boom(method, path, **kw):
        if method == "GET":
            return []
        raise RuntimeError("Supabase POST zalo_bot_configs failed: 400 Could not find the 'batch_wait_seconds' column")
    with mock.patch.object(svc, "_rest", boom):
        with pytest.raises(ValueError, match="220_zalo_bot_batch_wait"):
            run(svc.upsert_config("acc1", {"chatwoot_account_id": 3, "chatwoot_inbox_id": 1}, "a@x"))
