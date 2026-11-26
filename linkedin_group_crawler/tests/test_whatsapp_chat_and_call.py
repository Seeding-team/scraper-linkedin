"""Unit & contract tests for WhatsApp Multi-Device Chat & Dual-Mode VoIP Call backend."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any, Dict, List
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.modules.all_platform.auth_deps import get_current_user
from app.modules.all_platform.whatsapp import whatsapp_router
from app.modules.all_platform.whatsapp.config import (
    BACKEND_ROOT,
    decrypt_cloud_token,
    decrypt_proxy_url,
    encrypt_cloud_token,
    encrypt_proxy_url,
    mask_proxy_url,
    normalize_whatsapp_phone,
    resolve_effective_proxy_url,
    sanitize_account,
)
from app.modules.all_platform.whatsapp.services import (
    bridge_manager,
    message_events,
    whatsapp_call_service,
    whatsapp_repo,
    whatsapp_service,
)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _run(coro):
    return asyncio.run(coro)


def _sample_account(**overrides: Any) -> Dict[str, Any]:
    base = {
        "id": "11111111-1111-1111-1111-111111111111",
        "id_member": "member-001",
        "phone_number": "84901234567",
        "jid": "84901234567@s.whatsapp.net",
        "lid": "12345678901234@lid",
        "display_name": "Sale Markee",
        "label": "Hotline WA",
        "status": "connected",
        "auth_mode": "qr",
        "qr_data_url": None,
        "pairing_code": None,
        "auth_dir": "storage/whatsapp_auth/11111111-1111-1111-1111-111111111111",
        "cloud_calling_enabled": False,
        "cloud_phone_number_id": None,
        "cloud_waba_id": None,
        "cloud_access_token_enc": None,
        "cloud_webhook_verify_token": None,
        "auto_reject_calls": False,
        "auto_reject_message": None,
        "last_error": None,
    }
    base.update(overrides)
    return base


def _sample_user(role: str = "admin", user_id: str = "member-001") -> Dict[str, Any]:
    return {
        "id": user_id,
        "email": "tester@markee.vn",
        "role": role,
        "is_active": True,
    }


# ── 1. Migration 241 SQL Integrity ────────────────────────────────────────────

def test_migration_241_sql_contains_all_tables_grants_and_reload():
    sql_path = BACKEND_ROOT / "supabase" / "migrations" / "241_whatsapp_chat_crm.sql"
    assert sql_path.is_file(), f"Missing migration file: {sql_path}"
    sql = sql_path.read_text(encoding="utf-8")

    required_tables = [
        "whatsapp_accounts",
        "whatsapp_conversations",
        "whatsapp_messages",
        "whatsapp_call_logs",
        "whatsapp_quick_replies",
    ]
    for tbl in required_tables:
        assert f"CREATE TABLE IF NOT EXISTS public.{tbl}" in sql, f"Missing CREATE TABLE for {tbl}"
        assert f"public.{tbl}" in sql

    for col in (
        "cloud_access_token_enc",
        "cloud_phone_number_id",
        "cloud_calling_enabled",
        "auto_reject_calls",
        "chat_alt_jid",
        "raw_key",
        "reactions",
        "sdp_offer",
        "sdp_answer",
        "call_mode",
        "shortcut",
    ):
        assert col in sql, f"Missing expected column '{col}' in migration 241"

    assert "GRANT ALL ON TABLE" in sql
    assert "TO postgres, anon, authenticated, service_role;" in sql
    assert "NOTIFY pgrst, 'reload schema';" in sql


# ── 2. Fernet Encryption & Account Sanitization ───────────────────────────────

def test_fernet_cloud_token_roundtrip_and_sanitization():
    raw_secret = "EAAJ9_TEST_WHATSAPP_CLOUD_SECRET_TOKEN_987654321"
    enc_1 = encrypt_cloud_token(raw_secret)
    enc_2 = encrypt_cloud_token(raw_secret)

    assert enc_1 != raw_secret
    assert enc_1 != enc_2  # Fernet includes random IV/timestamp per encryption
    assert decrypt_cloud_token(enc_1) == raw_secret
    assert decrypt_cloud_token(enc_2) == raw_secret

    with pytest.raises(ValueError):
        decrypt_cloud_token("not-a-valid-fernet-ciphertext")

    raw_row = _sample_account(cloud_access_token_enc=enc_1, cloud_calling_enabled=True)
    clean = sanitize_account(raw_row)
    assert "cloud_access_token_enc" not in clean
    assert clean["has_cloud_token"] is True
    assert clean["cloud_calling_enabled"] is True

    clean_no_tok = sanitize_account(_sample_account(cloud_access_token_enc=None))
    assert "cloud_access_token_enc" not in clean_no_tok
    assert clean_no_tok["has_cloud_token"] is False


# ── 3. NDJSON Bridge Event Normalization & Dispatch ───────────────────────────

def test_normalize_bridge_messages_for_all_rich_types():
    acct_id = "11111111-1111-1111-1111-111111111111"
    chat_jid = "84988777666@s.whatsapp.net"

    cases = [
        {
            "chat_jid": chat_jid,
            "chat_alt_jid": "998877665544@lid",
            "message_id": "m_text",
            "msg_type": "text",
            "text": "Xin chào Markee!",
            "is_outgoing": False,
            "sender_jid": chat_jid,
            "sender_phone": "84988777666",
            "sender_name": "Khách hàng A",
            "raw_key": {"remoteJid": chat_jid, "fromMe": False, "id": "m_text"},
        },
        {
            "chat_jid": chat_jid,
            "message_id": "m_image",
            "msg_type": "image",
            "text": "Báo giá ảnh",
            "media_local_path": "storage/whatsapp_media/111/m_image.jpg",
            "media_mime": "image/jpeg",
            "media_size": 102400,
        },
        {
            "chat_jid": chat_jid,
            "message_id": "m_voice",
            "msg_type": "ptt",
            "media_local_path": "storage/whatsapp_media/111/m_voice.ogg",
            "media_mime": "audio/ogg; codecs=opus",
            "media_duration_s": 14,
        },
        {
            "chat_jid": chat_jid,
            "message_id": "m_doc",
            "msg_type": "document",
            "media_local_path": "storage/whatsapp_media/111/m_doc.pdf",
            "media_mime": "application/pdf",
            "media_filename": "HopDong_2026.pdf",
            "media_size": 524288,
        },
        {
            "chat_jid": chat_jid,
            "message_id": "m_sticker",
            "msg_type": "sticker",
            "media_local_path": "storage/whatsapp_media/111/m_sticker.webp",
            "media_mime": "image/webp",
        },
        {
            "chat_jid": chat_jid,
            "message_id": "m_loc",
            "msg_type": "location",
            "latitude": 10.7769,
            "longitude": 106.7009,
            "name": "Landmark 81",
            "address": "Bình Thạnh, TP.HCM",
        },
        {
            "chat_jid": chat_jid,
            "message_id": "m_contact",
            "msg_type": "contact",
            "contact_name": "Anh Tuấn",
            "contact_phone": "+84909111222",
            "vcard": "BEGIN:VCARD\nFN:Anh Tuan\nEND:VCARD",
        },
        {
            "chat_jid": chat_jid,
            "message_id": "m_poll",
            "msg_type": "poll",
            "question": "Chốt lịch họp?",
            "options": ["Thứ 2", "Thứ 3"],
            "selectable_count": 1,
        },
    ]

    normalized = [bridge_manager.normalize_bridge_message(acct_id, c) for c in cases]
    by_id = {m["message_id"]: m for m in normalized if m}

    assert by_id["m_text"]["msg_type"] == "text"
    assert by_id["m_text"]["metadata"]["chat_alt_jid"] == "998877665544@lid"
    assert by_id["m_image"]["msg_type"] == "image"
    assert by_id["m_image"]["media_url"].endswith(f"/{acct_id}/m_image")
    assert by_id["m_voice"]["msg_type"] == "voice"
    assert by_id["m_voice"]["media_duration_s"] == 14
    assert by_id["m_doc"]["msg_type"] == "document"
    assert by_id["m_doc"]["media_filename"] == "HopDong_2026.pdf"
    assert by_id["m_sticker"]["msg_type"] == "sticker"
    assert by_id["m_loc"]["msg_type"] == "location"
    assert by_id["m_loc"]["metadata"]["latitude"] == pytest.approx(10.7769)
    assert by_id["m_contact"]["msg_type"] == "contact"
    assert by_id["m_contact"]["metadata"]["contact_phone"] == "+84909111222"
    assert by_id["m_poll"]["msg_type"] == "poll"
    assert by_id["m_poll"]["metadata"]["options"] == ["Thứ 2", "Thứ 3"]


def test_bridge_qr_pairing_reaction_and_call_auto_reject_events():
    acct_id = "11111111-1111-1111-1111-111111111111"
    acct_auto_reject = _sample_account(
        id=acct_id,
        auto_reject_calls=True,
        auto_reject_message="Xin lỗi, tôi đang bận họp và sẽ gọi lại ngay!",
    )
    published: List[tuple[str, str, Dict[str, Any]]] = []

    async def fake_publish(aid, evt_name, payload, *, id_member=None):
        published.append((aid, evt_name, payload))
        return 1

    async def _scenario():
        with (
            patch.object(whatsapp_repo, "get_account", new=AsyncMock(return_value=acct_auto_reject)),
            patch.object(whatsapp_repo, "update_account", new=AsyncMock(side_effect=lambda aid, **kw: {**acct_auto_reject, **kw})),
            patch.object(whatsapp_repo, "apply_message_reaction", new=AsyncMock(return_value={"message_id": "m1", "reactions": [{"sender_jid": "u@s.whatsapp.net", "emoji": "❤️"}]})),
            patch.object(whatsapp_repo, "get_call_log", new=AsyncMock(return_value=None)),
            patch.object(whatsapp_repo, "upsert_call_log", new=AsyncMock(side_effect=lambda row: row)),
            patch.object(whatsapp_repo, "upsert_message", new=AsyncMock(side_effect=lambda row: row)),
            patch.object(whatsapp_repo, "touch_conversation", new=AsyncMock(side_effect=lambda aid, jid, **kw: {"account_id": aid, "chat_jid": jid})),
            patch.object(bridge_manager, "is_bridge_running", return_value=True),
            patch.object(bridge_manager, "send_command", new=AsyncMock(return_value={"message_id": "auto_reply_1", "raw_key": {"id": "auto_reply_1"}})) as mock_cmd,
            patch.object(message_events, "publish_whatsapp_event", new=AsyncMock(side_effect=fake_publish)),
        ):
            # 1) QR event
            await bridge_manager.handle_bridge_event(
                acct_id,
                {"event": "qr", "qr": "2@abc", "qr_data_url": "data:image/png;base64,AAA"},
            )
            assert any(e == "account_status" and p.get("status") == "qr_ready" for _, e, p in published)

            # 2) Pairing code event
            await bridge_manager.handle_bridge_event(
                acct_id,
                {"event": "pairing_code", "pairing_code": "ABCD-1234", "phone_number": "84901234567"},
            )
            assert any(e == "account_status" and p.get("pairing_code") == "ABCD-1234" for _, e, p in published)

            # 3) Reaction event
            await bridge_manager.handle_bridge_event(
                acct_id,
                {"event": "reaction", "chat_jid": "84988@s.whatsapp.net", "message_id": "m1", "sender_jid": "u@s.whatsapp.net", "emoji": "❤️"},
            )
            assert any(e == "message_update" and p.get("message_id") == "m1" for _, e, p in published)

            # 4) Call offer with auto_reject_calls=True -> auto rejects AND sends auto-reply!
            await bridge_manager.handle_bridge_event(
                acct_id,
                {
                    "event": "call",
                    "call_id": "CALL_BAILEYS_999",
                    "caller_jid": "84912345678@s.whatsapp.net",
                    "caller_pn": "84912345678",
                    "chat_jid": "84912345678@s.whatsapp.net",
                    "status": "offer",
                    "is_video": True,
                    "is_group": False,
                },
            )
            cmds = [call.args[1] for call in mock_cmd.await_args_list]
            assert "reject_call" in cmds
            assert "send_text" in cmds
            assert any(
                e == "call_event" and p.get("call_id") == "CALL_BAILEYS_999" and p.get("status") == "ringing"
                for _, e, p in published
            )
            assert any(
                e == "call_event" and p.get("call_id") == "CALL_BAILEYS_999" and p.get("status") == "rejected"
                for _, e, p in published
            )

            # 5) Non-lifecycle transport status should be ignored cleanly
            prev_len = len(published)
            res_ign = await whatsapp_call_service.handle_baileys_call_event(
                acct_id,
                {"event": "call", "call_id": "CALL_BAILEYS_999", "status": "transport"},
            )
            assert res_ign["status"] == "ignored"
            assert len(published) == prev_len

    _run(_scenario())


# ── 4. Dual-Mode Call Engine (Cloud WebRTC + Webhook + Baileys + Handoff) ─────

def test_dual_mode_call_engine_cloud_webrtc_outbound_inbound_accept_and_handoff():
    acct_id = "22222222-2222-2222-2222-222222222222"
    raw_cloud_token = "EAAG_CLOUD_CALLING_LIVE_TOKEN_XYZ"
    cloud_account = _sample_account(
        id=acct_id,
        cloud_calling_enabled=True,
        cloud_phone_number_id="10555999888777",
        cloud_waba_id="20555999888777",
        cloud_access_token_enc=encrypt_cloud_token(raw_cloud_token),
        cloud_webhook_verify_token="verify_markee_2026",
    )
    personal_account = _sample_account(
        id="33333333-3333-3333-3333-333333333333",
        cloud_calling_enabled=False,
        cloud_access_token_enc=None,
    )
    user = _sample_user(role="admin")
    published: List[tuple[str, str, Dict[str, Any]]] = []
    meta_posts: List[Dict[str, Any]] = []

    class FakeHttpResponse:
        def __init__(self, status_code: int, body: Dict[str, Any]):
            self.status_code = status_code
            self._body = body
            self.text = json.dumps(body)

        def json(self):
            return self._body

    class FakeAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def post(self, url: str, *, json: Dict[str, Any], headers: Dict[str, Any]):
            meta_posts.append({"url": url, "json": json, "headers": headers})
            if json.get("action") == "connect":
                return FakeHttpResponse(200, {"messaging_product": "whatsapp", "calls": [{"id": "wacid.OUTBOUND_001"}]})
            return FakeHttpResponse(200, {"messaging_product": "whatsapp", "success": True})

    async def fake_publish(aid, evt_name, payload, *, id_member=None):
        published.append((aid, evt_name, payload))
        return 1

    async def _scenario():
        with (
            patch("httpx.AsyncClient", FakeAsyncClient),
            patch.object(whatsapp_repo, "upsert_call_log", new=AsyncMock(side_effect=lambda row: row)),
            patch.object(whatsapp_repo, "update_call_log", new=AsyncMock(side_effect=lambda aid, cid, f: {"account_id": aid, "call_id": cid, "chat_jid": "84909998888@s.whatsapp.net", "direction": "inbound", "call_type": "audio", "call_mode": "cloud_webrtc", **f})),
            patch.object(whatsapp_repo, "upsert_message", new=AsyncMock(side_effect=lambda row: row)),
            patch.object(whatsapp_repo, "touch_conversation", new=AsyncMock(side_effect=lambda aid, jid, **kw: {"account_id": aid, "chat_jid": jid})),
            patch.object(message_events, "publish_whatsapp_event", new=AsyncMock(side_effect=fake_publish)),
        ):
            # A) Cloud WebRTC Outbound SDP Offer
            with patch.object(whatsapp_repo, "get_account", new=AsyncMock(return_value=cloud_account)):
                out = await whatsapp_call_service.initiate_outbound_call(
                    user,
                    acct_id,
                    chat_jid="84909998888@s.whatsapp.net",
                    target_phone="+84 909 998 888",
                    is_video=False,
                    sdp_offer="v=0\r\no=- 123 2 IN IP4 127.0.0.1\r\ns=-\r\n",
                )
            assert out["mode"] == "cloud_webrtc"
            assert out["call_id"] == "wacid.OUTBOUND_001"
            assert len(meta_posts) == 1
            assert meta_posts[0]["url"].endswith("/10555999888777/calls")
            assert meta_posts[0]["headers"]["Authorization"] == f"Bearer {raw_cloud_token}"
            assert meta_posts[0]["json"]["action"] == "connect"
            assert meta_posts[0]["json"]["session"]["sdp_type"] == "offer"

            # B) Cloud Webhook Inbound SDP Offer -> SSE call_event with sdp_offer
            webhook_inbound = {
                "entry": [
                    {
                        "changes": [
                            {
                                "value": {
                                    "metadata": {"phone_number_id": "10555999888777"},
                                    "contacts": [{"profile": {"name": "Khách VIP"}}],
                                    "calls": [
                                        {
                                            "id": "wacid.INBOUND_002",
                                            "from": "84909998888",
                                            "to": "842899998888",
                                            "event": "connect",
                                            "direction": "USER_INITIATED",
                                            "session": {
                                                "sdp_type": "offer",
                                                "sdp": "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n",
                                            },
                                        }
                                    ],
                                }
                            }
                        ]
                    }
                ]
            }
            with (
                patch.object(whatsapp_repo, "find_account_by_cloud_phone_number_id", new=AsyncMock(return_value=cloud_account)),
                patch.object(whatsapp_repo, "get_call_log_by_call_id", new=AsyncMock(return_value=None)),
            ):
                wh_res = await whatsapp_call_service.handle_meta_webhook(webhook_inbound)
            assert wh_res["processed"] == 1
            assert any(
                e == "call_event"
                and p.get("call_id") == "wacid.INBOUND_002"
                and p.get("can_webrtc_answer") is True
                and "m=audio" in str(p.get("sdp_offer") or "")
                for _, e, p in published
            )

            # C) Accept Inbound Cloud Call -> pre_accept THEN accept with SDP Answer
            meta_posts.clear()
            with patch.object(whatsapp_repo, "get_account", new=AsyncMock(return_value=cloud_account)):
                acc_res = await whatsapp_call_service.accept_inbound_call(
                    user,
                    acct_id,
                    "wacid.INBOUND_002",
                    "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=sendrecv\r\n",
                )
            assert acc_res["status"] == "connected"
            assert [p["json"]["action"] for p in meta_posts] == ["pre_accept", "accept"]

            # D) Outbound SDP Answer Webhook -> emits BOTH call_event & call_answer_sdp
            webhook_answer = {
                "entry": [
                    {
                        "changes": [
                            {
                                "value": {
                                    "metadata": {"phone_number_id": "10555999888777"},
                                    "calls": [
                                        {
                                            "id": "wacid.OUTBOUND_001",
                                            "event": "connect",
                                            "direction": "BUSINESS_INITIATED",
                                            "session": {
                                                "sdp_type": "answer",
                                                "sdp": "v=0\r\na=answer-sdp\r\n",
                                            },
                                        }
                                    ],
                                }
                            }
                        ]
                    }
                ]
            }
            with (
                patch.object(whatsapp_repo, "find_account_by_cloud_phone_number_id", new=AsyncMock(return_value=cloud_account)),
                patch.object(whatsapp_repo, "get_call_log_by_call_id", new=AsyncMock(return_value={"account_id": acct_id, "call_id": "wacid.OUTBOUND_001", "direction": "outbound"})),
            ):
                await whatsapp_call_service.handle_meta_webhook(webhook_answer)
            assert any(e == "call_answer_sdp" and p.get("sdp_answer") == "v=0\r\na=answer-sdp\r\n" for _, e, p in published)

            # E) Personal Account Outbound Handoff Fallback (Mode C)
            with patch.object(whatsapp_repo, "get_account", new=AsyncMock(return_value=personal_account)):
                handoff = await whatsapp_call_service.initiate_outbound_call(
                    user,
                    personal_account["id"],
                    chat_jid="84909998888@s.whatsapp.net",
                    target_phone="+84909998888",
                    is_video=True,
                )
            assert handoff["mode"] == "linked_device_handoff"
            assert handoff["wa_deep_link"] == "whatsapp://send?phone=84909998888"
            assert handoff["wa_call_deep_link"] == "whatsapp://call?phone=84909998888"
            assert "WhatsApp" in handoff["protocol_note"]

    _run(_scenario())


# ── 5. FastAPI Route Registration, OpenAPI Integrity & TestClient Smoke ───────

def _build_test_app() -> FastAPI:
    app = FastAPI()
    app.include_router(whatsapp_router, prefix="/api/all-platform/whatsapp")
    app.dependency_overrides[get_current_user] = lambda: _sample_user(role="admin")
    return app


def test_fastapi_openapi_schema_and_all_routes_registered():
    app = _build_test_app()
    schema = app.openapi()
    paths = set(schema["paths"].keys())

    expected_paths = {
        "/api/all-platform/whatsapp/auth/connect-qr",
        "/api/all-platform/whatsapp/auth/connect-pairing",
        "/api/all-platform/whatsapp/accounts",
        "/api/all-platform/whatsapp/accounts/{account_id}/status",
        "/api/all-platform/whatsapp/accounts/{account_id}/settings",
        "/api/all-platform/whatsapp/accounts/{account_id}/reconnect",
        "/api/all-platform/whatsapp/accounts/{account_id}",
        "/api/all-platform/whatsapp/accounts/{account_id}/conversations",
        "/api/all-platform/whatsapp/accounts/{account_id}/conversations/sync",
        "/api/all-platform/whatsapp/accounts/{account_id}/conversations/start-chat",
        "/api/all-platform/whatsapp/accounts/{account_id}/conversations/{chat_jid}/read",
        "/api/all-platform/whatsapp/accounts/{account_id}/conversations/{chat_jid}",
        "/api/all-platform/whatsapp/accounts/{account_id}/conversations/{chat_jid}/typing",
        "/api/all-platform/whatsapp/accounts/{account_id}/conversations/{chat_jid}/group-info",
        "/api/all-platform/whatsapp/accounts/{account_id}/conversations/{chat_jid}/messages",
        "/api/all-platform/whatsapp/messages/send",
        "/api/all-platform/whatsapp/messages/send-media",
        "/api/all-platform/whatsapp/messages/media/{account_id}/{message_id}",
        "/api/all-platform/whatsapp/messages/send-location",
        "/api/all-platform/whatsapp/messages/send-contact",
        "/api/all-platform/whatsapp/messages/send-poll",
        "/api/all-platform/whatsapp/messages/react",
        "/api/all-platform/whatsapp/messages/edit",
        "/api/all-platform/whatsapp/messages/delete",
        "/api/all-platform/whatsapp/messages/forward",
        "/api/all-platform/whatsapp/quick-replies",
        "/api/all-platform/whatsapp/quick-replies/{reply_id}",
        "/api/all-platform/whatsapp/accounts/{account_id}/calls",
        "/api/all-platform/whatsapp/calls/reject",
        "/api/all-platform/whatsapp/calls/outbound",
        "/api/all-platform/whatsapp/calls/{call_id}/accept",
        "/api/all-platform/whatsapp/calls/{call_id}/terminate",
        "/api/all-platform/whatsapp/calls/webhook",
        "/api/all-platform/whatsapp/events/stream",
    }
    missing = expected_paths - paths
    assert not missing, f"Missing expected WhatsApp routes: {sorted(missing)}"


def test_http_endpoints_settings_jid_paths_and_meta_webhook_challenge():
    app = _build_test_app()
    client = TestClient(app)
    acct = _sample_account()

    with (
        patch.object(whatsapp_repo, "get_account", new=AsyncMock(return_value=acct)),
        patch.object(whatsapp_repo, "update_account", new=AsyncMock(side_effect=lambda aid, **kw: {**acct, **kw})),
        patch.object(whatsapp_repo, "list_messages", new=AsyncMock(return_value=[{"message_id": "m1", "text": "hello"}])),
        patch.object(whatsapp_repo, "has_matching_webhook_verify_token", new=AsyncMock(side_effect=lambda tok: tok == "my-secret-verify-token")),
    ):
        # 1) Settings PATCH encrypts token and never leaks ciphertext
        res_patch = client.patch(
            f"/api/all-platform/whatsapp/accounts/{acct['id']}/settings",
            json={
                "auto_reject_calls": True,
                "auto_reject_message": "Đang bận",
                "cloud_calling_enabled": True,
                "cloud_phone_number_id": "10999888",
                "cloud_access_token": "EAA_PLAIN_SECRET_TOKEN",
            },
        )
        assert res_patch.status_code == 200
        body = res_patch.json()
        assert body["success"] is True
        assert body["data"]["has_cloud_token"] is True
        assert "cloud_access_token_enc" not in body["data"]
        assert "EAA_PLAIN_SECRET_TOKEN" not in res_patch.text

        # 2) JID path parameter with '@' works cleanly
        res_msgs = client.get(
            f"/api/all-platform/whatsapp/accounts/{acct['id']}/conversations/84901234567@s.whatsapp.net/messages?limit=30"
        )
        assert res_msgs.status_code == 200
        assert res_msgs.json()["data"][0]["message_id"] == "m1"

        # 3) Meta Webhook GET verification returns raw challenge string (200) or 403
        res_ok = client.get(
            "/api/all-platform/whatsapp/calls/webhook",
            params={
                "hub.mode": "subscribe",
                "hub.verify_token": "my-secret-verify-token",
                "hub.challenge": "CHALLENGE_998877",
            },
        )
        assert res_ok.status_code == 200
        assert res_ok.text == "CHALLENGE_998877"

        res_bad = client.get(
            "/api/all-platform/whatsapp/calls/webhook",
            params={
                "hub.mode": "subscribe",
                "hub.verify_token": "wrong-token",
                "hub.challenge": "CHALLENGE_998877",
            },
        )
        assert res_bad.status_code == 403


def test_rbac_member_isolation_blocks_unauthorized_account_access():
    other_member_acct = _sample_account(id="44444444-4444-4444-4444-444444444444", id_member="member-999")
    caller = _sample_user(role="member", user_id="member-001")

    async def _scenario():
        with patch.object(whatsapp_repo, "get_account", new=AsyncMock(return_value=other_member_acct)):
            with pytest.raises(Exception) as exc_info:
                await whatsapp_service.ensure_account_access(caller, other_member_acct["id"])
            assert getattr(exc_info.value, "status_code", None) == 403

    _run(_scenario())


def test_sse_pub_sub_delivers_typed_frames_to_authorized_member():
    acct_id = "55555555-5555-5555-5555-555555555555"

    async def _scenario():
        gen = message_events.subscribe_whatsapp_events([], member_ids=["member-abc"])
        ready_frame = await anext(gen)
        assert ready_frame.startswith("event: ready\n")

        delivered = await message_events.publish_whatsapp_event(
            acct_id,
            "account_status",
            {"status": "qr_ready", "qr_data_url": "data:image/png;base64,XYZ"},
            id_member="member-abc",
        )
        assert delivered >= 1

        ev_frame = await anext(gen)
        assert ev_frame.startswith("event: account_status\n")
        assert '"qr_ready"' in ev_frame
        assert acct_id in ev_frame
        await gen.aclose()

    _run(_scenario())


def test_live_python_node_ndjson_bridge_dry_run_ping():
    """Verify real Python <-> Node.js wa_persistent_bridge.mjs NDJSON RPC round-trip."""
    script_path = BACKEND_ROOT / "scripts" / "wa_persistent_bridge.mjs"
    if not script_path.is_file():
        pytest.skip("wa_persistent_bridge.mjs not present")

    async def _scenario():
        proc = await bridge_manager._spawn_process(
            [
                "node",
                str(script_path),
                "--account-id",
                "smoke-test-acc",
                "--auth-dir",
                str(BACKEND_ROOT / "storage" / "whatsapp_auth" / "smoke-test-acc"),
                "--media-dir",
                str(BACKEND_ROOT / "storage" / "whatsapp_media" / "smoke-test-acc"),
                "--dry-run",
            ],
            cwd=str(BACKEND_ROOT),
            env={"PATH": str(__import__("os").environ.get("PATH", ""))},
        )
        try:
            ready_raw = await asyncio.wait_for(proc.stdout.readline(), timeout=10.0)
            ready_evt = json.loads(ready_raw.decode("utf-8"))
            assert ready_evt["event"] == "ready"
            assert ready_evt["dry_run"] is True

            req = json.dumps({"req_id": "py-ping-1", "cmd": "ping", "payload": {}}) + "\n"
            proc.stdin.write(req.encode("utf-8"))
            await proc.stdin.drain()

            reply_raw = await asyncio.wait_for(proc.stdout.readline(), timeout=10.0)
            reply = json.loads(reply_raw.decode("utf-8"))
            assert reply["req_id"] == "py-ping-1"
            assert reply["ok"] is True

            shutdown_req = json.dumps({"req_id": "py-bye", "cmd": "shutdown", "payload": {}}) + "\n"
            proc.stdin.write(shutdown_req.encode("utf-8"))
            await proc.stdin.drain()
            await asyncio.wait_for(proc.wait(), timeout=5.0)
        finally:
            if proc.returncode is None:
                proc.terminate()

    _run(_scenario())


# ── 6. 3-Way Audit (#55) Regression Tests ─────────────────────────────────────

def test_upsert_conversations_groups_heterogeneous_keys_and_contacts_sync_no_phantom_chats():
    acct_id = "66666666-6666-6666-6666-666666666666"
    captured_batches: List[List[Dict[str, Any]]] = []

    class FakeTable:
        def upsert(self, batch, on_conflict=None):
            captured_batches.append(batch)
            return self

        def execute(self):
            return MagicMock(data=captured_batches[-1] if captured_batches else [])

    class FakeSupabase:
        def table(self, name):
            return FakeTable()

    async def _scenario():
        with patch.object(whatsapp_repo, "get_supabase_client", return_value=FakeSupabase()):
            rows = [
                {
                    "account_id": acct_id,
                    "chat_jid": "84901234567@s.whatsapp.net",
                    "chat_type": "direct",
                    "title": "Alice",
                    "phone_number": "84901234567",
                },
                {
                    "account_id": acct_id,
                    "chat_jid": "120363012345@g.us",
                    "chat_type": "group",
                    "title": "Sales Team",
                    "participant_count": 12,
                },
            ]
            await whatsapp_repo.upsert_conversations(rows)

        assert len(captured_batches) == 2
        for batch in captured_batches:
            key_sets = {tuple(sorted(item.keys())) for item in batch}
            assert len(key_sets) == 1, f"Heterogeneous keys in single PostgREST batch: {key_sets}"

        # contacts_sync MUST only update existing conversations, NEVER bulk-insert phantom chats
        with (
            patch.object(whatsapp_repo, "upsert_conversations", new=AsyncMock()) as mock_upsert,
            patch.object(whatsapp_repo, "update_existing_conversations_from_contacts", new=AsyncMock(return_value=1)) as mock_update_existing,
            patch.object(whatsapp_repo, "get_account", new=AsyncMock(return_value=_sample_account(id=acct_id))),
        ):
            await bridge_manager.handle_bridge_event(
                acct_id,
                {
                    "event": "contacts_sync",
                    "contacts": [
                        {"jid": "84909991111@s.whatsapp.net", "display_name": "Phonebook Only Contact"},
                    ],
                },
            )
            mock_upsert.assert_not_awaited()
            mock_update_existing.assert_awaited_once()

    _run(_scenario())


def test_relink_clears_stale_auth_dir_and_outgoing_uses_canonical_chat_jid(tmp_path: Path):
    acct_id = "77777777-7777-7777-7777-777777777777"
    stale_dir = tmp_path / "wa_auth_stale"
    stale_dir.mkdir(parents=True)
    stale_creds = stale_dir / "creds.json"
    stale_creds.write_text('{"me":{"id":"old"}}', encoding="utf-8")

    acct = _sample_account(id=acct_id, status="logged_out", auth_dir=str(stale_dir))
    user = _sample_user(role="admin")
    creds_existed_at_start = []

    async def fake_start_bridge(aid, **kwargs):
        creds_existed_at_start.append(stale_creds.exists())
        return MagicMock()

    async def _scenario():
        with (
            patch.object(whatsapp_repo, "get_account", new=AsyncMock(return_value=acct)),
            patch.object(whatsapp_repo, "update_account", new=AsyncMock(side_effect=lambda aid, **kw: {**acct, **kw})),
            patch.object(bridge_manager, "stop_bridge", new=AsyncMock()),
            patch.object(bridge_manager, "start_bridge", new=AsyncMock(side_effect=fake_start_bridge)),
            patch.object(bridge_manager, "wait_for_auth_artifact", new=AsyncMock(return_value=None)),
            patch.object(whatsapp_service, "get_auth_dir", return_value=stale_dir),
        ):
            await whatsapp_service.connect_qr(user, account_id=acct_id)
        assert creds_existed_at_start == [False], "Stale creds.json must be removed before re-link bridge start"

        # Canonical chat_jid on outgoing send
        persisted_rows: List[Dict[str, Any]] = []
        touched_jids: List[str] = []
        with (
            patch.object(whatsapp_repo, "get_account", new=AsyncMock(return_value=acct)),
            patch.object(
                bridge_manager,
                "send_command",
                new=AsyncMock(
                    return_value={
                        "message_id": "out_canon_1",
                        "chat_jid": "84901234567@s.whatsapp.net",
                        "raw_key": {"remoteJid": "84901234567@s.whatsapp.net", "fromMe": True, "id": "out_canon_1"},
                    }
                ),
            ),
            patch.object(whatsapp_repo, "upsert_message", new=AsyncMock(side_effect=lambda r: (persisted_rows.append(r), r)[1])),
            patch.object(whatsapp_repo, "touch_conversation", new=AsyncMock(side_effect=lambda aid, jid, **kw: (touched_jids.append(jid), {"account_id": aid, "chat_jid": jid})[1])),
            patch.object(message_events, "publish_whatsapp_event", new=AsyncMock(return_value=1)),
        ):
            saved = await whatsapp_service.send_text(user, acct_id, "99887766@lid", "Hello canonical")
        assert saved["chat_jid"] == "84901234567@s.whatsapp.net"
        assert persisted_rows[0]["chat_jid"] == "84901234567@s.whatsapp.net"
        assert touched_jids == ["84901234567@s.whatsapp.net"]

    _run(_scenario())


def test_group_info_normalization_contact_metadata_reactions_sse_and_call_stub_dedup():
    acct_id = "88888888-8888-8888-8888-888888888888"
    acct = _sample_account(id=acct_id)
    user = _sample_user(role="admin")
    published: List[tuple[str, str, Dict[str, Any]]] = []

    async def fake_publish(aid, evt_name, payload, *, id_member=None):
        published.append((aid, evt_name, payload))
        return 1

    async def _scenario():
        # 1) get_group_info returns normalized chat_jid, owner_jid, participant_count alongside id/owner/size
        with (
            patch.object(whatsapp_repo, "get_account", new=AsyncMock(return_value=acct)),
            patch.object(whatsapp_repo, "update_conversation", new=AsyncMock(return_value={})),
            patch.object(bridge_manager, "is_bridge_running", return_value=True),
            patch.object(
                bridge_manager,
                "send_command",
                new=AsyncMock(
                    return_value={
                        "id": "120363999@g.us",
                        "subject": "VIP Group",
                        "owner": "84901234567@s.whatsapp.net",
                        "size": 5,
                        "participants": [{"id": "84901234567@s.whatsapp.net", "admin": "superadmin"}],
                    }
                ),
            ),
        ):
            info = await whatsapp_service.get_group_info(user, acct_id, "120363999@g.us")
        assert info["chat_jid"] == "120363999@g.us"
        assert info["owner_jid"] == "84901234567@s.whatsapp.net"
        assert info["participant_count"] == 5

        # 2) send_contact stores both contact_name/contact_phone and display_name/phone
        with (
            patch.object(whatsapp_repo, "get_account", new=AsyncMock(return_value=acct)),
            patch.object(bridge_manager, "send_command", new=AsyncMock(return_value={"message_id": "c_1"})),
            patch.object(whatsapp_repo, "upsert_message", new=AsyncMock(side_effect=lambda r: r)),
            patch.object(whatsapp_repo, "touch_conversation", new=AsyncMock(return_value={})),
            patch.object(message_events, "publish_whatsapp_event", new=AsyncMock(side_effect=fake_publish)),
        ):
            contact_msg = await whatsapp_service.send_contact(
                user, acct_id, "84988@s.whatsapp.net", contact_name="Anh Nam", contact_phone="+84909123456"
            )
        assert contact_msg["metadata"]["contact_name"] == "Anh Nam"
        assert contact_msg["metadata"]["display_name"] == "Anh Nam"
        assert contact_msg["metadata"]["contact_phone"] == "+84909123456"
        assert contact_msg["metadata"]["phone"] == "+84909123456"

        # 3) react_message emits top-level `reactions` array in SSE message_update
        with (
            patch.object(whatsapp_repo, "get_account", new=AsyncMock(return_value=acct)),
            patch.object(whatsapp_repo, "get_message", new=AsyncMock(return_value={"message_id": "m1", "raw_key": {"id": "m1", "remoteJid": "84988@s.whatsapp.net", "fromMe": False}})),
            patch.object(bridge_manager, "send_command", new=AsyncMock(return_value={})),
            patch.object(whatsapp_repo, "apply_message_reaction", new=AsyncMock(return_value={"message_id": "m1", "reactions": [{"sender_jid": acct["jid"], "emoji": "👍"}]})),
            patch.object(message_events, "publish_whatsapp_event", new=AsyncMock(side_effect=fake_publish)),
        ):
            await whatsapp_service.react_message(user, acct_id, "84988@s.whatsapp.net", "m1", "👍")
        assert any(
            e == "message_update" and isinstance(p.get("reactions"), list) and len(p["reactions"]) == 1
            for _, e, p in published
        )

        # 4) Historical missed call stub normalizes call_status='missed' & call_type='video',
        #    while live notify stub (40/41/45/46 without call_id) is skipped to avoid doubling.
        hist_stub = bridge_manager.normalize_bridge_message(
            acct_id,
            {
                "chat_jid": "84988@s.whatsapp.net",
                "message_id": "stub_41",
                "msg_type": "call_log",
                "metadata": {"stub_type": 41, "missed": True, "is_video": True},
            },
        )
        assert hist_stub is not None
        assert hist_stub["metadata"]["call_status"] == "missed"
        assert hist_stub["metadata"]["call_type"] == "video"

        with (
            patch.object(whatsapp_repo, "get_account", new=AsyncMock(return_value=acct)),
            patch.object(whatsapp_repo, "upsert_message", new=AsyncMock()) as mock_upsert_msg,
        ):
            await bridge_manager.handle_bridge_event(
                acct_id,
                {
                    "event": "message",
                    "upsert_type": "notify",
                    "chat_jid": "84988@s.whatsapp.net",
                    "message_id": "stub_live_40",
                    "msg_type": "call_log",
                    "metadata": {"stub_type": 40, "missed": True, "is_video": False},
                },
            )
            mock_upsert_msg.assert_not_awaited()

    _run(_scenario())


# ── 7. P0 + P1 Session, Proxy, Pairing & Lifecycle Hardening Tests ────────────

def test_migration_242_sql_adds_proxy_url_enc_grants_and_reload():
    sql_path = BACKEND_ROOT / "supabase" / "migrations" / "242_whatsapp_session_proxy.sql"
    assert sql_path.is_file(), f"Missing migration 242 file: {sql_path}"
    sql = sql_path.read_text(encoding="utf-8")
    assert "ALTER TABLE public.whatsapp_accounts" in sql
    assert "ADD COLUMN IF NOT EXISTS proxy_url_enc TEXT;" in sql
    assert "GRANT ALL ON TABLE public.whatsapp_accounts" in sql
    assert "TO postgres, anon, authenticated, service_role;" in sql
    assert "NOTIFY pgrst, 'reload schema';" in sql


def test_proxy_fernet_masking_sanitization_and_default_env(monkeypatch):
    socks_raw = "socks5://alice:SuperSecret123@1.2.3.4:1080"
    http_raw = "http://bob:HiddenPass@5.6.7.8:8080"

    enc_socks = encrypt_proxy_url(socks_raw)
    assert enc_socks != socks_raw
    assert decrypt_proxy_url(enc_socks) == socks_raw

    assert mask_proxy_url(socks_raw) == "socks5://***@1.2.3.4:1080"
    assert mask_proxy_url(http_raw) == "http://***@5.6.7.8:8080"
    assert mask_proxy_url("http://10.0.0.1:3128") == "http://10.0.0.1:3128"

    with pytest.raises(ValueError):
        encrypt_proxy_url("ftp://1.2.3.4:21")
    with pytest.raises(ValueError):
        encrypt_proxy_url("not-a-valid-proxy")

    sanitized = sanitize_account(_sample_account(proxy_url_enc=enc_socks))
    assert sanitized["has_proxy"] is True
    assert sanitized["proxy_masked"] == "socks5://***@1.2.3.4:1080"
    assert "proxy_url_enc" not in sanitized
    assert "proxy_url" not in sanitized
    assert "SuperSecret123" not in json.dumps(sanitized)

    sanitized_none = sanitize_account(_sample_account(proxy_url_enc=None))
    assert sanitized_none["has_proxy"] is False
    assert sanitized_none["proxy_masked"] is None

    # WHATSAPP_DEFAULT_PROXY_URL used ONLY when account has no proxy_url_enc
    monkeypatch.setenv("WHATSAPP_DEFAULT_PROXY_URL", http_raw)
    assert resolve_effective_proxy_url({"proxy_url_enc": enc_socks}) == socks_raw
    assert resolve_effective_proxy_url({"proxy_url_enc": None}) == http_raw
    monkeypatch.delenv("WHATSAPP_DEFAULT_PROXY_URL", raising=False)
    assert resolve_effective_proxy_url({"proxy_url_enc": None}) is None


def test_vn_phone_normalization_and_proxy_http_routes():
    assert normalize_whatsapp_phone("0901234567") == "84901234567"
    assert normalize_whatsapp_phone("0901 234 567") == "84901234567"
    assert normalize_whatsapp_phone("+84 901-234-567") == "84901234567"
    assert normalize_whatsapp_phone("0084901234567") == "84901234567"
    assert normalize_whatsapp_phone("001 (415) 555-2671") == "14155552671"
    assert normalize_whatsapp_phone("+1 415 555 2671") == "14155552671"

    app = _build_test_app()
    client = TestClient(app)
    existing_enc = encrypt_proxy_url("http://olduser:oldpass@9.9.9.9:8080")
    acct = _sample_account(status="connected", proxy_url_enc=existing_enc)
    saved_state: Dict[str, Any] = dict(acct)
    start_calls: List[Dict[str, Any]] = []

    async def fake_update(aid, **kw):
        saved_state.update(kw)
        return dict(saved_state)

    async def fake_start_bridge(aid, **kw):
        start_calls.append({"aid": aid, **kw})
        return MagicMock()

    with (
        patch.object(whatsapp_repo, "get_account", new=AsyncMock(side_effect=lambda aid: dict(saved_state))),
        patch.object(whatsapp_repo, "update_account", new=AsyncMock(side_effect=fake_update)),
        patch.object(bridge_manager, "stop_bridge", new=AsyncMock()),
        patch.object(bridge_manager, "start_bridge", new=AsyncMock(side_effect=fake_start_bridge)),
        patch.object(bridge_manager, "wait_for_auth_artifact", new=AsyncMock(return_value=None)),
        patch.object(bridge_manager, "is_bridge_running", return_value=True),
        patch.object(message_events, "publish_whatsapp_event", new=AsyncMock(return_value=1)),
    ):
        # 1) connect-pairing normalizes VN 0901 234 567 -> 84901234567 & sets socks5 proxy
        res_pair = client.post(
            "/api/all-platform/whatsapp/auth/connect-pairing",
            json={
                "account_id": acct["id"],
                "phone_number": "0901 234 567",
                "proxy_url": "socks5://u1:secretP@1.2.3.4:1080",
            },
        )
        assert res_pair.status_code == 200
        body = res_pair.json()["data"]
        assert body["phone_number"] == "84901234567"
        assert body["has_proxy"] is True
        assert body["proxy_masked"] == "socks5://***@1.2.3.4:1080"
        assert "secretP" not in res_pair.text
        assert start_calls[-1]["pairing_phone"] == "84901234567"
        assert start_calls[-1]["proxy_url"] == "socks5://u1:secretP@1.2.3.4:1080"

        # 2) connect-qr with omitted proxy_url keeps existing proxy
        res_qr_keep = client.post(
            "/api/all-platform/whatsapp/auth/connect-qr",
            json={"account_id": acct["id"]},
        )
        assert res_qr_keep.status_code == 200
        assert res_qr_keep.json()["data"]["has_proxy"] is True
        assert start_calls[-1]["proxy_url"] == "socks5://u1:secretP@1.2.3.4:1080"

        # 3) connect-qr with empty "" clears proxy
        res_qr_clear = client.post(
            "/api/all-platform/whatsapp/auth/connect-qr",
            json={"account_id": acct["id"], "proxy_url": ""},
        )
        assert res_qr_clear.status_code == 200
        assert res_qr_clear.json()["data"]["has_proxy"] is False
        assert res_qr_clear.json()["data"]["proxy_masked"] is None
        assert start_calls[-1]["proxy_url"] is None

        # 4) PATCH settings with new proxy while connected/active restarts bridge with new proxy
        saved_state["status"] = "connected"
        prev_starts = len(start_calls)
        res_patch = client.patch(
            f"/api/all-platform/whatsapp/accounts/{acct['id']}/settings",
            json={"proxy_url": "http://newuser:newpass@4.5.6.7:8888"},
        )
        assert res_patch.status_code == 200
        assert res_patch.json()["data"]["has_proxy"] is True
        assert res_patch.json()["data"]["proxy_masked"] == "http://***@4.5.6.7:8888"
        assert "newpass" not in res_patch.text
        assert len(start_calls) == prev_starts + 1
        assert start_calls[-1]["force_restart"] is True
        assert start_calls[-1]["proxy_url"] == "http://newuser:newpass@4.5.6.7:8888"


def test_qr_expired_early_wakeup_crash_sync_and_stderr_promotion():
    acct_id = "99999999-1111-1111-1111-111111111111"
    acct = _sample_account(id=acct_id, status="qr_ready")
    published: List[tuple[str, str, Dict[str, Any]]] = []
    db_updates: List[Dict[str, Any]] = []

    async def fake_publish(aid, evt_name, payload, *, id_member=None):
        published.append((aid, evt_name, payload))
        return 1

    async def fake_update(aid, **kw):
        db_updates.append(kw)
        return {**acct, **kw}

    class FakeProc:
        def __init__(self, rc=None):
            self.returncode = rc
            self.stdout = AsyncMock()
            self.stdout.readline = AsyncMock(return_value=b"")

    async def _scenario():
        proc = FakeProc(rc=None)
        handle = bridge_manager.BridgeHandle(
            account_id=acct_id,
            id_member="member-001",
            process=proc,
            auth_dir="/tmp/a",
            media_dir="/tmp/m",
            status="connecting",
        )
        bridge_manager._bridges[acct_id] = handle
        try:
            with (
                patch.object(whatsapp_repo, "get_account", new=AsyncMock(return_value=acct)),
                patch.object(whatsapp_repo, "update_account", new=AsyncMock(side_effect=fake_update)),
                patch.object(message_events, "publish_whatsapp_event", new=AsyncMock(side_effect=fake_publish)),
            ):
                # Trigger qr_expired shortly after wait_for_auth_artifact(timeout=8.0) starts -> must wake early!
                async def emit_expired():
                    await asyncio.sleep(0.05)
                    await bridge_manager.handle_bridge_event(
                        acct_id,
                        {
                            "event": "connection",
                            "status": "qr_expired",
                            "error": "Mã QR đã hết hạn — bấm Làm mới QR để tạo mã mới.",
                        },
                    )

                t0 = asyncio.get_running_loop().time()
                task = asyncio.create_task(emit_expired())
                res = await bridge_manager.wait_for_auth_artifact(acct_id, kind="qr", timeout=8.0)
                await task
                elapsed = asyncio.get_running_loop().time() - t0
                assert res is None
                assert elapsed < 1.5, f"wait_for_auth_artifact did not wake early on qr_expired ({elapsed:.2f}s)"
                assert db_updates[-1]["status"] == "qr_expired"
                assert db_updates[-1]["qr_data_url"] is None
                assert any(e == "account_status" and p.get("status") == "qr_expired" for _, e, p in published)

                # Unexpected Node crash in _stdout_loop must sync DB + SSE to error!
                db_updates.clear()
                published.clear()
                crash_proc = FakeProc(rc=1)
                crash_handle = bridge_manager.BridgeHandle(
                    account_id=acct_id,
                    id_member="member-001",
                    process=crash_proc,
                    auth_dir="/tmp/a",
                    media_dir="/tmp/m",
                    status="connected",
                )
                bridge_manager._bridges[acct_id] = crash_handle
                await bridge_manager._stdout_loop(crash_handle)
                assert db_updates and db_updates[-1]["status"] == "error"
                assert any(e == "account_status" and p.get("status") == "error" for _, e, p in published)
                assert acct_id not in bridge_manager._bridges
        finally:
            bridge_manager._bridges.pop(acct_id, None)

        # Stderr level promotion check
        with (
            patch.object(bridge_manager.logger, "error") as mock_err,
            patch.object(bridge_manager.logger, "warning") as mock_warn,
            patch.object(bridge_manager.logger, "debug") as mock_dbg,
        ):
            bridge_manager._log_bridge_stderr_line(acct_id, "[wa-bridge][error] boom 405")
            bridge_manager._log_bridge_stderr_line(acct_id, "[wa-bridge][warn] slow version fetch")
            bridge_manager._log_bridge_stderr_line(acct_id, "[wa-bridge][info] connected")
            mock_err.assert_called_once()
            mock_warn.assert_called_once()
            mock_dbg.assert_called_once()

    _run(_scenario())


def test_per_account_lock_env_proxy_parallel_shutdown_and_registered_resume(tmp_path: Path):
    acct_id = "aaaaaaaa-2222-3333-4444-555555555555"

    class FakeProc:
        def __init__(self, pid: int):
            self.pid = pid
            self.returncode = None
            self.stdin = MagicMock()
            self.stdin.write = MagicMock()
            self.stdin.drain = AsyncMock()
            self.stdout = MagicMock()
            self.stdout.readline = AsyncMock(return_value=b"")
            self.stderr = MagicMock()
            self.stderr.readline = AsyncMock(return_value=b"")

        async def wait(self):
            self.returncode = 0
            return 0

        def terminate(self):
            self.returncode = 0

        def kill(self):
            self.returncode = -9

    async def _scenario():
        active_spawns = 0
        max_concurrent_spawns = 0
        spawn_records: List[Dict[str, Any]] = []

        async def fake_spawn(cmd, *, cwd, env):
            nonlocal active_spawns, max_concurrent_spawns
            active_spawns += 1
            max_concurrent_spawns = max(max_concurrent_spawns, active_spawns)
            spawn_records.append({"cmd": list(cmd), "env": dict(env)})
            await asyncio.sleep(0.06)
            active_spawns -= 1
            return FakeProc(pid=1000 + len(spawn_records))

        # 1) Concurrent start_bridge for same account_id serializes via per-account lock & passes proxy in env ONLY
        with (
            patch.object(bridge_manager, "_spawn_process", side_effect=fake_spawn),
            patch.object(bridge_manager, "_stdout_loop", new=AsyncMock()),
            patch.object(bridge_manager, "_stderr_loop", new=AsyncMock()),
            patch.object(bridge_manager, "get_auth_dir", return_value=tmp_path / "auth1"),
            patch.object(bridge_manager, "get_media_dir", return_value=tmp_path / "media1"),
        ):
            proxy = "socks5://u:p@1.2.3.4:1080"
            h1, h2 = await asyncio.gather(
                bridge_manager.start_bridge(acct_id, proxy_url=proxy, force_restart=False),
                bridge_manager.start_bridge(acct_id, proxy_url=proxy, force_restart=False),
            )
            assert max_concurrent_spawns == 1, "Per-account lock must serialize concurrent start_bridge calls"
            assert h1 is h2, "Second concurrent call with force_restart=False should reuse first handle"
            assert len(spawn_records) == 1
            assert spawn_records[0]["env"].get("WA_PROXY_URL") == proxy
            assert all(proxy not in arg and "u:p" not in arg for arg in spawn_records[0]["cmd"])
            await bridge_manager.stop_bridge(acct_id, logout=False)

        # 2) Parallel shutdown_all_bridges() runs concurrently via asyncio.gather
        bridge_manager._bridges.clear()
        for idx in range(3):
            aid = f"par-acc-{idx}"
            bridge_manager._bridges[aid] = bridge_manager.BridgeHandle(
                account_id=aid, id_member="m1", process=FakeProc(2000 + idx), auth_dir="/tmp", media_dir="/tmp"
            )

        async def slow_stop(aid, *, logout=False):
            await asyncio.sleep(0.15)
            bridge_manager._bridges.pop(aid, None)

        with patch.object(bridge_manager, "stop_bridge", side_effect=slow_stop):
            t0 = asyncio.get_running_loop().time()
            await bridge_manager.shutdown_all_bridges()
            elapsed = asyncio.get_running_loop().time() - t0
            assert elapsed < 0.35, f"shutdown_all_bridges should run in parallel, took {elapsed:.2f}s"

        # 3) start_persisted_bridges ONLY resumes accounts whose get_auth_dir(id)/creds.json has registered === true
        auth_root = tmp_path / "persisted_auth"
        acc_reg = auth_root / "acc-registered"
        acc_unreg = auth_root / "acc-unregistered"
        acc_missing = auth_root / "acc-missing"
        acc_reg.mkdir(parents=True)
        acc_unreg.mkdir(parents=True)
        acc_missing.mkdir(parents=True)
        (acc_reg / "creds.json").write_text(json.dumps({"registered": True, "me": {"id": "8490@s.whatsapp.net"}}), encoding="utf-8")
        (acc_unreg / "creds.json").write_text(json.dumps({"registered": False, "me": {"id": "8490@s.whatsapp.net"}}), encoding="utf-8")

        resumed_ids: List[str] = []

        async def record_start(aid, **kw):
            resumed_ids.append(aid)
            return MagicMock()

        persisted_rows = [
            {"id": "acc-registered", "id_member": "m1", "status": "connected", "auth_dir": "/stale/ignored/path"},
            {"id": "acc-unregistered", "id_member": "m1", "status": "connecting", "auth_dir": str(acc_unreg)},
            {"id": "acc-missing", "id_member": "m1", "status": "connected", "auth_dir": str(acc_missing)},
        ]
        with (
            patch.object(whatsapp_repo, "list_persisted_accounts", new=AsyncMock(return_value=persisted_rows)),
            patch.object(bridge_manager, "get_auth_dir", side_effect=lambda aid: auth_root / aid),
            patch.object(bridge_manager, "start_bridge", new=AsyncMock(side_effect=record_start)),
        ):
            await bridge_manager.start_persisted_bridges()
        assert resumed_ids == ["acc-registered"]

    _run(_scenario())



