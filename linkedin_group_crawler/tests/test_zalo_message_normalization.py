"""Comprehensive unit & integration test suite for Zalo Phase 2A Message Normalization (G1–G7).

Covers:
- G1: zca_persistent_listener.js friend_event / group_event / undo normalizers & Python dispatch
- G2: All 28 wire msgTypes & 22 content actions + bankcard + share.file auto-ext/folder + legacy group unwrap + call preservation
- G3: supabase_service._message_payload (crawl path) persists raw_content, msg_kind, cli_msg_id, reply_to_id, mentions, ts
- G4: SSRF-safe bankcard CDN decoder + all 57 Vietnamese Bank BINs + GET /api/all-platform/zalo/bankcard-preview
- G5: Clean Vietnamese sidebar previews (all 31 native [...] labels + [Thẻ ngân hàng] + zero ugly fallbacks)
- G6: Safe raw_content dict normalization + msg_kind returned cleanly across list_conversations / inbox report / messages
- G7: chat.undo & undo event marks is_deleted=True in DB & broadcasts SSE message_recalled

All tests are 100% offline / mocked — ZERO Production Supabase mutations!
"""
from __future__ import annotations

import asyncio
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.modules.all_platform.zalo.api.routes.conversations import router as zalo_conversations_router
from app.modules.all_platform.zalo.schemas.job import JobData
from app.modules.all_platform.zalo.schemas.library import ZaloLibraryMessage
from app.modules.all_platform.zalo.schemas.message import Mention, Message
from app.modules.all_platform.zalo.services import supabase_service
from app.modules.all_platform.zalo.services.supabase_service import (
    SIDEBAR_BRACKET_LABELS,
    VIETNAM_BANK_BINS,
    _message_from_row,
    _message_payload,
    _normalize_message_row,
    _normalize_raw_content,
    classify_message_kind,
    fetch_bankcard_preview,
    format_sidebar_last_message_preview,
    get_zalo_inbox_report,
    list_conversations,
    mark_zalo_message_recalled,
    parse_bankcard_cdn_payload,
    persist_zalo_system_event,
    validate_bankcard_cdn_url,
)
from app.modules.all_platform.zalo.services.zca_persistent_listener import (
    ListenerState,
    ZcaPersistentListenerManager,
)

REPO_BACKEND_ROOT = Path(__file__).resolve().parents[1]
LISTENER_JS_PATH = REPO_BACKEND_ROOT / "scripts" / "zca_persistent_listener.js"


def _run_node_helper(fn_name: str, args: List[Any]) -> Any:
    """Invoke an exported pure helper from zca_persistent_listener.js via Node."""
    script = (
        f"const mod = require({json.dumps(str(LISTENER_JS_PATH))});"
        f"const args = JSON.parse(process.argv[1]);"
        f"const res = mod[{json.dumps(fn_name)}](...args);"
        f"process.stdout.write(JSON.stringify(res === undefined ? null : res));"
    )
    proc = subprocess.run(
        ["node", "-e", script, json.dumps(args, ensure_ascii=False)],
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=True,
        timeout=15,
    )
    return json.loads(proc.stdout)


def _run_node_batch(calls: List[Dict[str, Any]]) -> List[Any]:
    """Batch-invoke multiple exported functions from zca_persistent_listener.js in a single fast Node call."""
    script = (
        f"const mod = require({json.dumps(str(LISTENER_JS_PATH))});"
        "const calls = JSON.parse(process.argv[1]);"
        "const out = calls.map(c => mod[c.fn](...(c.args || [])));"
        "process.stdout.write(JSON.stringify(out));"
    )
    proc = subprocess.run(
        ["node", "-e", script, json.dumps(calls, ensure_ascii=False)],
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=True,
        timeout=20,
    )
    return json.loads(proc.stdout)


# ──────────────────────────────────────────────────────────────────────────────
# G2: All 28 wire msgTypes & 22 actions in JS normalizeMessage + Python classifier
# ──────────────────────────────────────────────────────────────────────────────

ALL_28_WIRE_MSG_TYPES = [
    ("webchat", "Xin chào", "text"),
    ("chat.photo", {"href": "https://f10-zpg-r.zdn.vn/p.jpg", "title": ""}, "image"),
    ("chat.gif", {"href": "https://zalo-gif.zadn.vn/g.gif", "action": "recommend.gif"}, "gif"),
    ("chat.video.msg", {"href": "https://video.zdn.vn/v.mp4", "title": "clip"}, "video"),
    ("chat.voice", {"href": "https://voice.zdn.vn/a.m4a", "params": '{"duration":5000}'}, "voice"),
    ("share.file", {"href": "https://file.zdn.vn/doc", "title": "baocao", "params": '{"fileExt":"pdf","fileSize":2048}'}, "file"),
    ("chat.sticker", {"id": 101213, "catId": 12832, "type": 7}, "sticker"),
    ("chat.doodle", {"href": "https://f10.zdn.vn/doodle.png"}, "doodle"),
    ("chat.location.new", {"title": "Quận 1, TP.HCM", "lat": 10.77, "lo": 106.7}, "location"),
    ("chat.recommended", {"action": "recommened.link", "title": "Markee", "href": "https://markee.vn"}, "link"),
    ("chat.link", {"title": "Docs", "href": "https://example.com"}, "link"),
    ("chat.ecard", {"action": "show.profile", "type": "2", "thumb": "https://s160-ava-talk.zadn.vn/a.jpg", "description": "Lê Thị Sen đã đồng ý kết bạn"}, "system_notice"),
    ("chat.webcontent", {"zinstantdata_id": "templateId=11845", "data_url": "https://zinst-stc.zadn.vn/card/1"}, "bankcard"),
    ("chat.webcontent.v2", {"zinstantdata_id": "templateId=11845", "data_url": "https://zinst-stc.zadn.vn/card/2"}, "bankcard"),
    ("chat.undo", "", "undo"),
    ("chat.delete", "", "system_notice"),
    ("chat.delete.everyone", "", "system_notice"),
    ("chat.vanish", "", "system_notice"),
    ("chat.list.action", {"message": [{"type": "l.a.header.full", "title": "Thông báo OA"}]}, "system_notice"),
    ("group.poll", {"title": "Ăn trưa gì?", "params": '{"question":"Ăn trưa gì?"}'}, "system_notice"),
    ("chat.todo", {"message": {"message": "Gửi hợp đồng"}}, "system_notice"),
    ("chat.reaction", {"rType": 5}, "system_notice"),
    ("chat.zalo.me", {"href": "https://zalo.me/0909123456"}, "link"),
    ("chat.e2ee.replace", "", "system_notice"),
    ("group.leave", "Minh đã rời khỏi nhóm", "system_notice"),
    ("group.event", "Đã thêm thành viên", "system_notice"),
    ("group", json.dumps({"action": "recommened.user", "title": "Tdhgiang", "description": json.dumps({"phone": "0909123456"})}), "contact"),
    ("chat._jumpToMessage", "", "system_notice"),
]

ALL_22_CONTENT_ACTIONS = [
    ("chat.recommended", "recommened.link", "link"),
    ("chat.recommended", "recommened.user", "contact"),
    ("chat.recommended", "recommened.vip", "contact"),
    ("chat.recommended", "recommend.gif", "gif"),
    ("chat.recommended", "recommened.stickerset", "sticker"),
    ("chat.recommended", "recommened.calling", "call"),
    ("chat.recommended", "recommened.receivecall", "call"),
    ("chat.recommended", "recommened.calltime", "call"),
    ("chat.recommended", "recommened.misscall", "call"),
    ("webchat", "msginfo.actionlist", "system_notice"),
    ("webchat", "rtf", "text"),
    ("chat.recommended", "show.profile", "contact"),
    ("chat.todo", "todo.remind", "system_notice"),
    ("group.event", "todo.remind2", "system_notice"),
    ("chat.recommended", "recommened.friend", "system_notice"),
    ("chat.recommended", "recommened.oa", "link"),
    ("chat.recommended", "recommened.miniapp", "link"),
    ("chat.recommended", "recommened.minisite", "link"),
    ("chat.recommended", "recommened.article", "link"),
    ("chat.recommended", "recommened.post", "link"),
    ("chat.recommended", "recommened.location", "location"),
    ("chat.recommended", "recommened.zvideo", "link"),
]


def test_g2_all_28_wire_msg_types_js_and_python():
    assert len(ALL_28_WIRE_MSG_TYPES) == 28
    calls = []
    for idx, (msg_type, content, _expected) in enumerate(ALL_28_WIRE_MSG_TYPES):
        raw = {
            "threadId": "9001",
            "isSelf": False,
            "data": {
                "msgId": str(10000 + idx),
                "cliMsgId": str(20000 + idx),
                "uidFrom": "5001",
                "idTo": "9001",
                "dName": "Khách Hàng",
                "ts": "1763627222845",
                "msgType": msg_type,
                "content": content,
            },
        }
        calls.append({"fn": "normalizeMessage", "args": [raw, idx, "9999"]})

    js_results = _run_node_batch(calls)
    for (msg_type, content, expected_kind), js_res in zip(ALL_28_WIRE_MSG_TYPES, js_results):
        assert js_res["msg_kind"] == expected_kind, f"JS mismatch for {msg_type}: got {js_res['msg_kind']}"
        py_kind = classify_message_kind(js_res["type"], js_res["content"], js_res["raw"])
        assert py_kind == expected_kind, f"PY mismatch for {msg_type}: got {py_kind}"


def test_g2_all_22_content_actions_js_and_python():
    assert len(ALL_22_CONTENT_ACTIONS) == 22
    calls = []
    for idx, (parent_type, action, _expected) in enumerate(ALL_22_CONTENT_ACTIONS):
        content: Dict[str, Any] = {
            "action": action,
            "title": "sendBubbleMessage" if "call" in action else f"Item {idx}",
            "href": "https://example.com/item",
            "thumb": "https://s160-ava-talk.zadn.vn/thumb.jpg",
            "params": '{"calltype":0,"isCaller":false,"reason":0,"duration":0}',
        }
        raw = {
            "threadId": "9002",
            "isSelf": False,
            "data": {
                "msgId": str(30000 + idx),
                "cliMsgId": str(40000 + idx),
                "uidFrom": "5002",
                "idTo": "9002",
                "ts": "1763627222845",
                "msgType": parent_type,
                "content": content,
            },
        }
        calls.append({"fn": "normalizeMessage", "args": [raw, idx, "9999"]})

    js_results = _run_node_batch(calls)
    for (parent_type, action, expected_kind), js_res in zip(ALL_22_CONTENT_ACTIONS, js_results):
        assert js_res["msg_kind"] == expected_kind, f"JS mismatch for {parent_type}/{action}: got {js_res['msg_kind']}"
        py_kind = classify_message_kind(js_res["type"], js_res["content"], js_res["raw"])
        assert py_kind == expected_kind, f"PY mismatch for {parent_type}/{action}: got {py_kind}"
        if expected_kind == "call":
            # CRITICAL: preserve chat.recommended type for parseZaloCallMessage & never keep "sendBubbleMessage"
            assert js_res["type"] == "chat.recommended"
            assert js_res["content"] != "sendBubbleMessage"


def test_g2_special_edge_cases_bankcard_file_folder_contact_ecard_msginfo():
    # 1. zinstant.bankcard action + nested data_url
    bankcard_raw = {
        "threadId": "8001",
        "data": {
            "msgId": "7001",
            "msgType": "chat.webcontent.v2",
            "ts": "1763627222845",
            "content": {
                "action": "zinstant.bankcard",
                "title": "Thẻ ngân hàng — mở Zalo để xem",
                "params": json.dumps({"item": {"data_url": "https://zinst-stc.zadn.vn/card/vcb.html", "templateId": 11845}}),
            },
        },
    }
    # 2. share.file missing extension auto-appended
    file_raw = {
        "threadId": "8001",
        "data": {
            "msgId": "7002",
            "msgType": "share.file",
            "ts": "1763627222845",
            "content": {
                "title": "HopDong_2026",
                "href": "https://f10.zdn.vn/file/123",
                "params": json.dumps({"fileExt": "docx", "fileSize": 153600}),
            },
        },
    }
    # 3. share.file folder (FILE_FTYPE.FOLDER === 2)
    folder_raw = {
        "threadId": "8001",
        "data": {
            "msgId": "7003",
            "msgType": "share.file",
            "ts": "1763627222845",
            "content": {
                "title": "TaiLieuDuAn",
                "href": "https://f10.zdn.vn/folder/999",
                "params": json.dumps({"fdata": {"fType": 2}, "totalSize": 999999}),
            },
        },
    }
    # 4. Legacy type === "group" with JSON-string content containing contact card
    legacy_group_contact = {
        "threadId": "8001",
        "data": {
            "msgId": "7004",
            "msgType": "group",
            "ts": "1763627222845",
            "content": json.dumps({
                "action": "recommened.user",
                "title": "Nguyễn Văn An",
                "thumb": "https://s160-ava-talk.zadn.vn/ava.jpg",
                "description": json.dumps({"phone": "0988777666"}),
            }),
        },
    }
    # 5. webchat + msginfo.actionlist with %1$s placeholder & avatar URL in raw
    actionlist_raw = {
        "threadId": "8001",
        "data": {
            "msgId": "7005",
            "msgType": "webchat",
            "ts": "1763627222845",
            "avatar": "https://s160-ava-talk.zadn.vn/avatar.jpg",
            "content": {
                "action": "msginfo.actionlist",
                "title": "Fallback title",
                "params": json.dumps({
                    "msg": {"vi": "%1$s đã ghim 1 tin nhắn hình ảnh."},
                    "highLightsV2": [{"content": "Mylife"}],
                }),
            },
        },
    }

    res_bank, res_file, res_folder, res_contact, res_actionlist = _run_node_batch([
        {"fn": "normalizeMessage", "args": [bankcard_raw, 0, "9999"]},
        {"fn": "normalizeMessage", "args": [file_raw, 1, "9999"]},
        {"fn": "normalizeMessage", "args": [folder_raw, 2, "9999"]},
        {"fn": "normalizeMessage", "args": [legacy_group_contact, 3, "9999"]},
        {"fn": "normalizeMessage", "args": [actionlist_raw, 4, "9999"]},
    ])

    assert res_bank["msg_kind"] == "bankcard"
    assert res_bank["bankcard_data_url"] == "https://zinst-stc.zadn.vn/card/vcb.html"
    assert "mở Zalo để xem" not in (res_bank["content"] or "")

    assert res_file["msg_kind"] == "file"
    assert res_file["content"] == "HopDong_2026.docx"
    assert res_file["file_meta"] == {"fileName": "HopDong_2026.docx", "fileExt": "docx", "fileSize": 153600, "isFolder": False}

    assert res_folder["msg_kind"] == "file"
    assert res_folder["file_meta"]["isFolder"] is True
    assert res_folder["content"] == "TaiLieuDuAn"

    assert res_contact["msg_kind"] == "contact"
    assert "Nguyễn Văn An" in res_contact["content"]
    assert "0988777666" in res_contact["content"]

    assert res_actionlist["msg_kind"] == "system_notice"
    assert res_actionlist["type"] == "webchat"
    assert res_actionlist["content"] == "Mylife đã ghim 1 tin nhắn hình ảnh."


# ──────────────────────────────────────────────────────────────────────────────
# G1 & G7: JS friend_event / group_event / undo normalizers & Python dispatch
# ──────────────────────────────────────────────────────────────────────────────

def test_g1_g7_js_friend_group_undo_normalizers():
    own_id = "111111"
    events = [
        # Friend request RECEIVED from 222222 (anti-self collapse: zca-js sets threadId = toUid = own_id!)
        {"fn": "normalizeFriendEvent", "args": [{"type": 2, "threadId": own_id, "isSelf": False, "data": {"fromUid": "222222", "toUid": own_id, "message": "Chào shop"}}, own_id]},
        # Friend request SENT to 333333
        {"fn": "normalizeFriendEvent", "args": [{"type": 2, "threadId": "333333", "isSelf": True, "data": {"fromUid": own_id, "toUid": "333333", "message": ""}}, own_id]},
        # Friend ADD (accepted)
        {"fn": "normalizeFriendEvent", "args": [{"type": 0, "threadId": "222222", "isSelf": False, "data": "222222"}, own_id]},
        # Friend UNDO_REQUEST, REJECT, REMOVE, BLOCK, UNBLOCK, SEEN (skipped)
        {"fn": "normalizeFriendEvent", "args": [{"type": 3, "threadId": "333333", "isSelf": True, "data": {"fromUid": own_id, "toUid": "333333"}}, own_id]},
        {"fn": "normalizeFriendEvent", "args": [{"type": 4, "threadId": "333333", "isSelf": False, "data": {"fromUid": "333333", "toUid": own_id}}, own_id]},
        {"fn": "normalizeFriendEvent", "args": [{"type": 1, "threadId": "222222", "isSelf": False, "data": "222222"}, own_id]},
        {"fn": "normalizeFriendEvent", "args": [{"type": 6, "threadId": "222222", "isSelf": True, "data": "222222"}, own_id]},
        {"fn": "normalizeFriendEvent", "args": [{"type": 7, "threadId": "222222", "isSelf": True, "data": "222222"}, own_id]},
        {"fn": "normalizeFriendEvent", "args": [{"type": 5, "threadId": own_id, "isSelf": True, "data": ["222222"]}, own_id]},
        # Group events: join, leave, remove_member, update (rename), update_avatar, add_admin, remove_admin, new_pin_topic, unpin_topic
        {"fn": "normalizeGroupEvent", "args": [{"type": "join", "act": "join", "threadId": "g555", "isSelf": False, "data": {"groupId": "g555", "sourceId": "999", "updateMembers": [{"id": "444", "dName": "Tuấn"}], "time": "1763627222845"}}, own_id]},
        {"fn": "normalizeGroupEvent", "args": [{"type": "leave", "act": "leave", "threadId": "g555", "isSelf": False, "data": {"groupId": "g555", "updateMembers": [{"id": "444", "dName": "Tuấn"}], "time": "1763627222846"}}, own_id]},
        {"fn": "normalizeGroupEvent", "args": [{"type": "update", "act": "update", "threadId": "g555", "isSelf": False, "data": {"groupId": "g555", "groupName": "Nhóm VIP 2026", "time": "1763627222847"}}, own_id]},
        {"fn": "normalizeGroupEvent", "args": [{"type": "update_avatar", "act": "update_avatar", "threadId": "g555", "isSelf": False, "data": {"groupId": "g555", "time": "1763627222848"}}, own_id]},
        {"fn": "normalizeGroupEvent", "args": [{"type": "add_admin", "act": "add_admin", "threadId": "g555", "isSelf": False, "data": {"groupId": "g555", "updateMembers": [{"id": "444", "dName": "Tuấn"}], "time": "1763627222849"}}, own_id]},
        {"fn": "normalizeGroupEvent", "args": [{"type": "new_pin_topic", "act": "new_pin_topic", "threadId": "g555", "isSelf": False, "data": {"groupId": "g555", "topic": {"params": {"title": "Lịch họp"}}, "time": "1763627222850"}}, own_id]},
        # Undo event
        {"fn": "normalizeUndoEvent", "args": [{"threadId": "222222", "isSelf": False, "isGroup": False, "data": {"msgId": "undo_pkt_1", "cliMsgId": "cli_pkt_1", "uidFrom": "222222", "idTo": own_id, "ts": "1763627222900", "content": {"globalMsgId": 888888, "cliMsgId": 777777, "deleteMsg": 1}}}, own_id]},
    ]
    res = _run_node_batch(events)
    req_in, req_out, f_add, f_undo, f_rej, f_rem, f_blk, f_unblk, f_seen = res[:9]
    g_join, g_leave, g_rename, g_avt, g_admin, g_pin = res[9:15]
    undo_ev = res[15]

    # Anti-self collapse on incoming friend request!
    assert req_in["thread_id"] == "222222"
    assert req_in["type"] == "friend.event"
    assert req_in["msg_kind"] == "system_notice"
    assert "Chào shop" in req_in["content"]

    assert req_out["thread_id"] == "333333"
    assert "Đã gửi lời mời kết bạn" in req_out["content"]
    assert f_add["content"] == "Hai bạn đã trở thành bạn bè"
    assert "thu hồi" in f_undo["content"].lower()
    assert "từ chối" in f_rej["content"].lower()
    assert "xóa kết bạn" in f_rem["content"].lower()
    assert "chặn" in f_blk["content"].lower()
    assert "bỏ chặn" in f_unblk["content"].lower()
    assert f_seen is None

    assert g_join["type"] == "group.event" and g_join["msg_kind"] == "system_notice" and "Tuấn" in g_join["content"]
    assert "rời khỏi nhóm" in g_leave["content"]
    assert 'Nhóm VIP 2026' in g_rename["content"]
    assert "Ảnh đại diện nhóm" in g_avt["content"]
    assert "phó nhóm" in g_admin["content"]
    assert "Lịch họp" in g_pin["content"]

    assert undo_ev["thread_id"] == "222222"
    assert undo_ev["message_id"] == "888888"
    assert undo_ev["cli_msg_id"] == "777777"


def test_g1_g7_python_listener_dispatches_friend_group_undo_and_sse():
    async def _run():
        mgr = ZcaPersistentListenerManager()
        state = ListenerState(user_id="acc_test")

        friend_line = json.dumps({
            "event": "friend_event",
            "user_id": "acc_test",
            "message": {
                "thread_id": "222222",
                "message_id": "friend-event-add-222222-1763627222845",
                "sender_id": "222222",
                "type": "friend.event",
                "msg_kind": "system_notice",
                "content": "Hai bạn đã trở thành bạn bè",
                "timestamp": "1763627222845",
                "ts": 1763627222845,
                "is_sent": False,
                "is_deleted": False,
                "raw": {"event_kind": "friend_event", "act": "add"},
            },
        })
        group_line = json.dumps({
            "event": "group_event",
            "user_id": "acc_test",
            "message": {
                "thread_id": "g555",
                "group_name": "Nhóm VIP 2026",
                "message_id": "group-event-update-g555-1763627222847",
                "sender_id": "999",
                "type": "group.event",
                "msg_kind": "system_notice",
                "content": 'Tên nhóm đã đổi thành "Nhóm VIP 2026"',
                "timestamp": "1763627222847",
                "ts": 1763627222847,
                "is_sent": False,
                "is_deleted": False,
                "raw": {"event_kind": "group_event", "act": "update", "data": {"groupName": "Nhóm VIP 2026"}},
            },
        })
        undo_line = json.dumps({
            "event": "undo",
            "user_id": "acc_test",
            "undo": {
                "thread_id": "222222",
                "message_id": "888888",
                "cli_msg_id": "777777",
            },
        })

        mock_persist = AsyncMock(return_value=1)
        mock_recall = AsyncMock(return_value={"group_id": "222222", "source_message_id": "888888", "cli_msg_id": "777777"})
        mock_sse = AsyncMock(return_value=1)
        mock_shared = AsyncMock(return_value=set())

        with (
            patch("app.modules.all_platform.zalo.services.zca_persistent_listener.is_supabase_configured", return_value=True),
            patch("app.modules.all_platform.zalo.services.supabase_service.persist_zalo_system_event", mock_persist),
            patch("app.modules.all_platform.zalo.services.supabase_service.mark_zalo_message_recalled", mock_recall),
            patch("app.modules.all_platform.zalo.services.supabase_service.list_shared_conversation_ids", mock_shared),
            patch("app.modules.all_platform.zalo.services.message_events.publish_zalo_message_event", mock_sse),
        ):
            await mgr._handle_event(state, friend_line)
            await mgr._handle_event(state, group_line)
            await mgr._handle_event(state, undo_line)

        assert mock_persist.await_count == 2
        first_msg = mock_persist.await_args_list[0].args[3]
        second_msg = mock_persist.await_args_list[1].args[3]
        assert first_msg.type == "friend.event" and first_msg.msg_kind == "system_notice"
        assert second_msg.type == "group.event" and second_msg.msg_kind == "system_notice"

        mock_recall.assert_awaited_once_with(
            "acc_test",
            "222222",
            source_message_id="888888",
            cli_msg_id="777777",
        )
        assert mock_sse.await_count == 3
        sse_events = [call.args[1] for call in mock_sse.await_args_list]
        assert sse_events[0]["event_subtype"] == "friend_event"
        assert sse_events[1]["event_subtype"] == "group_event"
        assert sse_events[2]["type"] == "message_recalled"
        assert sse_events[2]["source_message_id"] == "888888"

    asyncio.run(_run())


def test_g1_persist_zalo_system_event_syncs_friend_and_group_metadata():
    async def _run():
        mock_save = AsyncMock(return_value=1)
        mock_upsert = AsyncMock(return_value=None)
        friend_msg = Message(
            message_id="friend-event-add-222-1",
            type="friend.event",
            msg_kind="system_notice",
            content="Hai bạn đã trở thành bạn bè",
            raw_content={"event_kind": "friend_event", "act": "add"},
        )
        group_msg = Message(
            message_id="group-event-update-g1-2",
            type="group.event",
            msg_kind="system_notice",
            content='Tên nhóm đã đổi thành "Team Sales"',
            raw_content={"event_kind": "group_event", "act": "update", "data": {"groupName": "Team Sales"}},
        )
        with (
            patch("app.modules.all_platform.zalo.services.supabase_service.is_supabase_configured", return_value=True),
            patch("app.modules.all_platform.zalo.services.supabase_service.save_listener_messages", mock_save),
            patch("app.modules.all_platform.zalo.services.supabase_service.upsert_group", mock_upsert),
        ):
            assert await persist_zalo_system_event("acc-1", "222", "Khách B", friend_msg) == 1
            assert await persist_zalo_system_event("acc-1", "g1", "Nhóm cũ", group_msg) == 1

        assert mock_save.await_count == 2
        assert mock_upsert.await_count == 2
        assert mock_upsert.await_args_list[0].kwargs["is_friend"] is True
        assert mock_upsert.await_args_list[1].kwargs["group_name"] == "Team Sales"

    asyncio.run(_run())


# ──────────────────────────────────────────────────────────────────────────────
# G3: Crawl _message_payload persists raw_content, msg_kind, cli_msg_id, etc.
# ──────────────────────────────────────────────────────────────────────────────

def test_g3_crawl_message_payload_persists_full_normalization_fields():
    job = JobData(
        job_id="job-1",
        group_id="g1",
        group_name="Nhóm Test",
        started_at=datetime.now(timezone.utc),
    )
    msg = Message(
        message_id="m-123",
        sender_id="u-1",
        sender_name="An",
        timestamp="1763627222845",
        time_text="2026-11-20T00:00:00Z",
        type="chat.webcontent.v2",
        content="[Thẻ ngân hàng]",
        cli_msg_id="cli-999",
        reply_to_id="m-100",
        mentions=[Mention(pos=0, uid="u-2", len=3)],
        ts=1763627222845,
        raw_content={"data": {"msgType": "chat.webcontent.v2", "content": {"zinstantdata_id": "templateId=11845"}}},
    )
    payload = _message_payload("acc-1", job, "g1", "Nhóm Test", msg)
    assert payload["msg_kind"] == "bankcard"
    assert payload["cli_msg_id"] == "cli-999"
    assert payload["reply_to_id"] == "m-100"
    assert payload["ts"] == 1763627222845
    assert payload["mentions"] == [{"pos": 0, "uid": "u-2", "len": 3}]
    assert isinstance(payload["raw_content"], dict)

    # Also verify safe JSON-string unwrapping for legacy group rows
    legacy_str = json.dumps({"action": "recommened.user", "title": "Bình", "description": json.dumps({"phone": "0912345678"})})
    unwrapped = _normalize_raw_content(legacy_str)
    assert isinstance(unwrapped, dict)
    assert unwrapped["action"] == "recommened.user"
    assert classify_message_kind("group", None, legacy_str) == "contact"


# ──────────────────────────────────────────────────────────────────────────────
# G4: 57 Vietnamese Bank BINs, SSRF validation, CDN decoder, & FastAPI endpoint
# ──────────────────────────────────────────────────────────────────────────────

def test_g4_all_57_vietnamese_bank_bins_present():
    assert len(VIETNAM_BANK_BINS) == 57
    assert VIETNAM_BANK_BINS["970436"]["short_name"] == "Vietcombank"
    assert VIETNAM_BANK_BINS["970422"]["short_name"] == "MB Bank"
    assert VIETNAM_BANK_BINS["970407"]["short_name"] == "Techcombank"
    assert VIETNAM_BANK_BINS["9704261"]["short_name"] == "TNEX"
    assert VIETNAM_BANK_BINS["546034"]["short_name"] == "CAKE"
    assert VIETNAM_BANK_BINS["963388"]["short_name"] == "Timo"


@pytest.mark.parametrize(
    "bad_url",
    [
        "",
        "http://zinst-stc.zadn.vn/card/1.html",
        "https://evil.com/card/1.html",
        "https://zinst-stc.zadn.vn.evil.com/card/1.html",
        "https://evil-zadn.vn/card/1.html",
        "https://zadn.vn/card/1.html",
        "https://zinst-stc.zadn.vn@evil.com/card/1.html",
        "https://127.0.0.1/card",
        "https://169.254.169.254/latest/meta-data/",
        "https://localhost/card",
        "https://[::1]/card",
        "https://zinst-stc.zadn.vn:8443/card",
        "file:///etc/passwd",
        "javascript:alert(1)",
    ],
)
def test_g4_ssrf_blocks_disallowed_urls(bad_url: str):
    with pytest.raises(ValueError):
        validate_bankcard_cdn_url(bad_url)


def test_g4_allows_valid_zadn_cdn_urls_and_decodes_html_and_json():
    assert validate_bankcard_cdn_url("https://zinst-stc.zadn.vn/abc/11845.html").startswith("https://")
    assert validate_bankcard_cdn_url("https://stc-zinstant.zadn.vn/data.json").startswith("https://")

    sample_html = """
    <html><body>
      <img src="https://res-zalo.zadn.vn/bank-logo/vcb.png" />
      <script>
        window.__DATA__ = {"binBank":"970436","numAccBank":"0071001234567","nameAccBank":"NGUYEN VAN A"};
      </script>
    </body></html>
    """
    decoded_html = parse_bankcard_cdn_payload(sample_html)
    assert decoded_html["ok"] is True
    assert decoded_html["bin"] == "970436"
    assert decoded_html["bank_short_name"] == "Vietcombank"
    assert "Vietcombank" in decoded_html["bank_name"]
    assert decoded_html["account_no"] == "0071001234567"
    assert decoded_html["account_name"] == "NGUYEN VAN A"
    assert decoded_html["logo_url"] == "https://res-zalo.zadn.vn/bank-logo/vcb.png"
    assert decoded_html["qr_url"] == "https://img.vietqr.io/image/970436-0071001234567-compact2.png"

    sample_json = json.dumps({
        "bin": "970422",
        "accountNo": "0909123456",
        "accountName": "TRAN THI B",
        "logoUrl": "https://res-zalo.zadn.vn/bank-logo/mb.png",
    })
    decoded_json = parse_bankcard_cdn_payload(sample_json)
    assert decoded_json["ok"] is True
    assert decoded_json["bin"] == "970422"
    assert decoded_json["bank_short_name"] == "MB Bank"
    assert decoded_json["qr_url"] == "https://img.vietqr.io/image/970422-0909123456-compact2.png"


def test_g4_fastapi_bankcard_preview_endpoint_and_existing_call_routes_intact():
    app = FastAPI()
    app.include_router(zalo_conversations_router, prefix="/api/all-platform/zalo")

    # Verify existing VoIP/call routes are completely untouched at their exact paths
    route_paths = {getattr(r, "path", "") for r in app.routes}
    assert "/api/all-platform/zalo/bankcard-preview" in route_paths
    assert "/api/all-platform/zalo/conversations/call-health" in route_paths
    assert "/api/all-platform/zalo/conversations/call/start" in route_paths
    assert "/api/all-platform/zalo/conversations/call/{session_id}/status" in route_paths
    assert "/api/all-platform/zalo/conversations/call/{session_id}/action" in route_paths
    assert "/api/all-platform/zalo/conversations/call-ws/{session_id}" in route_paths
    assert "/api/all-platform/zalo/conversations/zrtc-worker-ws" in route_paths

    client = TestClient(app)

    # 1. SSRF attempt must be rejected with HTTP 400
    r_bad = client.get("/api/all-platform/zalo/bankcard-preview", params={"url": "http://169.254.169.254/latest/meta-data/"})
    assert r_bad.status_code == 400

    # 2. Valid *.zadn.vn URL returns decoded bankcard + VietQR
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.text = json.dumps({"binBank": "970407", "numAccBank": "190366668888", "nameAccBank": "LE VAN C"})

    mock_client_instance = AsyncMock()
    mock_client_instance.get = AsyncMock(return_value=mock_resp)
    mock_client_cm = AsyncMock()
    mock_client_cm.__aenter__.return_value = mock_client_instance
    mock_client_cm.__aexit__.return_value = False

    supabase_service._BANKCARD_PREVIEW_CACHE.clear()
    with patch("app.modules.all_platform.zalo.services.supabase_service.httpx.AsyncClient", return_value=mock_client_cm):
        r_ok = client.get(
            "/api/all-platform/zalo/bankcard-preview",
            params={"url": "https://zinst-stc.zadn.vn/transfer/11845/sample.json"},
        )
    assert r_ok.status_code == 200
    body = r_ok.json()
    assert body["ok"] is True
    assert body["bin"] == "970407"
    assert body["bank_short_name"] == "Techcombank"
    assert body["account_no"] == "190366668888"
    assert body["account_name"] == "LE VAN C"
    assert body["qr_url"] == "https://img.vietqr.io/image/970407-190366668888-compact2.png"

    # 3. Verify API key auth enforcement when settings.api_key is configured
    with patch("app.modules.all_platform.zalo.api.security.settings.api_key", "secret-test-key"):
        r_unauth = client.get(
            "/api/all-platform/zalo/bankcard-preview",
            params={"url": "https://zinst-stc.zadn.vn/transfer/11845/sample.json"},
        )
        assert r_unauth.status_code == 401
        r_auth_bad_url = client.get(
            "/api/all-platform/zalo/bankcard-preview",
            params={"url": "https://evil.com/x"},
            headers={"X-API-Key": "secret-test-key"},
        )
        assert r_auth_bad_url.status_code == 400


# ──────────────────────────────────────────────────────────────────────────────
# G5: Clean Vietnamese sidebar previews (31 native labels + [Thẻ ngân hàng])
# ──────────────────────────────────────────────────────────────────────────────

def test_g5_sidebar_preview_labels_and_no_ugly_fallbacks():
    # All 31 native bracket labels + BANKCARD extension = 32
    assert len(SIDEBAR_BRACKET_LABELS) == 32
    assert SIDEBAR_BRACKET_LABELS["BANKCARD"] == "[Thẻ ngân hàng]"
    assert SIDEBAR_BRACKET_LABELS["STR_PHOTO_MSG"] == "[Hình ảnh]"
    assert SIDEBAR_BRACKET_LABELS["STR_FILE_MSG"] == "[File]"
    assert SIDEBAR_BRACKET_LABELS["STR_FOLDER_MSG"] == "[Thư mục]"
    assert SIDEBAR_BRACKET_LABELS["STR_CONTACT_MSG"] == "[Danh thiếp]"
    assert SIDEBAR_BRACKET_LABELS["STR_RECALL_MSG_2"] == "[Tin nhắn đã thu hồi]"

    # Never returns sendBubbleMessage
    assert format_sidebar_last_message_preview(
        "sendBubbleMessage",
        msg_type="chat.recommended",
        raw_content={"data": {"content": {"action": "recommened.misscall", "params": '{"calltype":0,"isCaller":false,"reason":0}'}}},
    ) == "[Cuộc gọi thoại nhỡ]"

    assert format_sidebar_last_message_preview(
        "sendBubbleMessage",
        msg_type="chat.recommended",
        raw_content={"data": {"content": {"action": "recommened.calltime", "params": '{"calltype":1,"isCaller":true,"duration":45}'}}},
    ) == "[Cuộc gọi video đi]"

    # Never returns raw JSON or "— mở Zalo để xem"
    assert format_sidebar_last_message_preview(
        '{"phone":"0909"}',
        msg_type="chat.recommended",
        raw_content={"data": {"content": {"action": "recommened.user", "title": "Lan"}}},
    ) == "[Danh thiếp] Lan"

    assert format_sidebar_last_message_preview(
        "Thẻ ngân hàng — mở Zalo để xem",
        msg_type="chat.webcontent.v2",
        raw_content={"data": {"content": {"zinstantdata_id": "templateId=11845"}}},
    ) == "[Thẻ ngân hàng]"

    assert format_sidebar_last_message_preview("Xin chào — mở Zalo để xem", msg_type="webchat") == "Xin chào"
    assert format_sidebar_last_message_preview("https://storage.example/abc.jpg", msg_type="image") == "[Hình ảnh]"
    assert format_sidebar_last_message_preview("HopDong.pdf", msg_type="share.file") == "[File] HopDong.pdf"
    assert format_sidebar_last_message_preview("TaiLieu", msg_type="share.file", raw_content={"_file_meta": {"isFolder": True}}) == "[Thư mục] TaiLieu"
    assert format_sidebar_last_message_preview(None, msg_type="chat.voice") == "[Tin nhắn thoại]"
    assert format_sidebar_last_message_preview(None, msg_type="chat.video.msg") == "[Video]"
    assert format_sidebar_last_message_preview(None, msg_type="chat.sticker") == "[Sticker]"
    assert format_sidebar_last_message_preview(None, msg_type="chat.gif") == "[GIF]"
    assert format_sidebar_last_message_preview(None, msg_type="chat.doodle") == "[Vẽ hình]"
    assert format_sidebar_last_message_preview(None, msg_type="chat.undo") == "[Tin nhắn đã thu hồi]"


# ──────────────────────────────────────────────────────────────────────────────
# G6 & G7: Row normalization, list_conversations, inbox report & recall DB patch
# ──────────────────────────────────────────────────────────────────────────────

def test_g6_row_normalization_handles_string_raw_content_and_validates_pydantic():
    raw_row = {
        "id": "uuid-1",
        "user_id": "acc-1",
        "group_id": "g1",
        "source_message_id": "m-501",
        "type": "group",
        "content": None,
        "msg_kind": None,
        "raw_content": json.dumps({
            "action": "recommened.user",
            "title": "Tdhgiang",
            "description": json.dumps({"phone": "0901234567"}),
        }),
        "mentions": None,
        "reactions": None,
    }
    norm = _normalize_message_row(raw_row)
    assert isinstance(norm["raw_content"], dict)
    assert norm["msg_kind"] == "contact"
    # Must validate cleanly into ZaloLibraryMessage (previously crashed when raw_content was str!)
    model = ZaloLibraryMessage(**norm)
    assert model.msg_kind == "contact"
    assert model.raw_content["action"] == "recommened.user"

    msg_obj = _message_from_row(raw_row)
    assert msg_obj.msg_kind == "contact"
    assert isinstance(msg_obj.raw_content, dict)


def test_g6_list_conversations_and_inbox_report_sanitize_previews_and_include_msg_kind():
    async def _run():
        async def fake_rest(method: str, path: str, *, params=None, json=None, prefer=None):
            if path == "zalo_groups":
                return [{
                    "group_id": "222",
                    "group_name": "Khách A",
                    "last_message_at": "2026-11-25T10:00:00Z",
                    "last_message_content": "sendBubbleMessage",
                    "last_message_type": "chat.recommended",
                    "unread_count": 1,
                }]
            if path == "zalo_messages":
                assert "msg_kind" in (params or {}).get("select", "")
                assert "raw_content" in (params or {}).get("select", "")
                return [{
                    "id": "uuid-2",
                    "user_id": "acc-1",
                    "group_id": "222",
                    "group_name": "Khách A",
                    "sender_name": "Khách A",
                    "created_at": "2026-11-25T10:00:00Z",
                    "type": "chat.recommended",
                    "content": "sendBubbleMessage",
                    "msg_kind": "chat.recommended",
                    "raw_content": {"data": {"content": {"action": "recommened.misscall", "params": '{"calltype":0,"isCaller":false,"reason":0}'}}},
                    "is_sent": False,
                }]
            if path == "zalo_accounts":
                return [{"account_id": "acc-1", "label": "Acc 1", "owner_id": "o-1"}]
            return []

        with (
            patch("app.modules.all_platform.zalo.services.supabase_service.is_supabase_configured", return_value=True),
            patch("app.modules.all_platform.zalo.services.supabase_service._rest", side_effect=fake_rest),
        ):
            convs = await list_conversations("acc-1")
            report = await get_zalo_inbox_report(["acc-1"])

        assert len(convs) == 1
        assert convs[0]["latest_msg_kind"] == "call"
        assert convs[0]["latest_content"] != "sendBubbleMessage"

        assert len(report["customers"]) == 1
        assert report["customers"][0]["latest_msg_kind"] == "call"
        assert report["customers"][0]["latest_content"] == "[Cuộc gọi thoại nhỡ]"

    asyncio.run(_run())


def test_g7_mark_zalo_message_recalled_matches_source_or_cli_msg_id():
    async def _run():
        calls: List[Dict[str, Any]] = []

        async def fake_rest(method: str, path: str, *, params=None, json=None, prefer=None):
            calls.append({"method": method, "path": path, "params": params, "json": json})
            # Simulate first lookup by source_message_id returns empty, second by cli_msg_id matches!
            if "cli_msg_id" in (params or {}):
                return [{"id": "row-1", "group_id": "222", "source_message_id": "src-1", "cli_msg_id": "cli-777"}]
            return []

        with (
            patch("app.modules.all_platform.zalo.services.supabase_service.is_supabase_configured", return_value=True),
            patch("app.modules.all_platform.zalo.services.supabase_service._rest", side_effect=fake_rest),
        ):
            result = await mark_zalo_message_recalled(
                "acc-1",
                "222",
                source_message_id="missing-src",
                cli_msg_id="cli-777",
            )

        assert result is not None
        assert result["source_message_id"] == "src-1"
        assert result["cli_msg_id"] == "cli-777"
        assert len(calls) == 2
        assert calls[1]["json"]["is_deleted"] is True
        assert calls[1]["json"]["msg_kind"] == "undo"

    asyncio.run(_run())
