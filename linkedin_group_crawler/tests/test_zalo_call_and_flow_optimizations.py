import asyncio
import io
import time
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.modules.all_platform.zalo.api.routes import conversations as conv_routes
from app.modules.all_platform.zalo.api.security import verify_zalo_api_key
from app.modules.all_platform.auth_deps import (
    get_authenticated_caller_email,
    get_authenticated_caller_user,
)
from app.modules.all_platform.zalo.services import message_events, supabase_service


def test_pooled_http_client_reuses_connection_in_same_loop():
    async def _run():
        c1 = supabase_service._get_pooled_http_client(follow_redirects=False)
        c2 = supabase_service._get_pooled_http_client(follow_redirects=False)
        c_redir = supabase_service._get_pooled_http_client(follow_redirects=True)

        assert c1 is c2
        assert c1 is not c_redir
        assert not c1.is_closed

        await c1.aclose()
        c3 = supabase_service._get_pooled_http_client(follow_redirects=False)
        assert c3 is not c1
        assert not c3.is_closed
        await c3.aclose()
        await c_redir.aclose()

    asyncio.run(_run())


def test_sse_owner_guard_and_shared_with_all_delivery():
    async def _run():
        acc_id = "zl_test_shared_01"
        real_owner = "11111111-2222-3333-4444-555555555555"

        message_events.register_account_owner(acc_id, real_owner)
        # Self-referential zl_ id must NOT overwrite real owner UUID
        message_events.register_account_owner(acc_id, acc_id)
        assert message_events.get_account_owner(acc_id) == real_owner

        # Shared-with-all account allows member/leader view & delivers unshared conversations to leader
        message_events.register_shared_with_all(acc_id, True)
        assert message_events.is_account_shared_with_all(acc_id) is True
        assert message_events.can_view_account("99999999-0000-0000-0000-000000000001", "member", "m@test.com", acc_id)
        assert message_events.can_view_account("88888888-0000-0000-0000-000000000002", "leader", "l@test.com", acc_id, is_shared=False)

        gen = message_events.subscribe_zalo_events(
            [acc_id],
            role="leader",
            email="leader.other@markeeai.com",
            caller_id="88888888-0000-0000-0000-000000000002",
        )
        next_task = asyncio.create_task(gen.__anext__())
        await asyncio.sleep(0.02)

        delivered = await message_events.publish_zalo_message_event(
            acc_id,
            {"type": "new_messages", "account_id": acc_id, "group_id": "conv_unshared_99", "messages": []},
            shared_conversation_ids=set(),  # empty share set, yet shared_with_all=True must deliver!
        )
        assert delivered >= 1
        chunk = await asyncio.wait_for(next_task, timeout=2.0)
        assert "conv_unshared_99" in chunk
        await gen.aclose()
        message_events.register_shared_with_all(acc_id, False)

    asyncio.run(_run())


def test_message_cache_invalidation_clears_account_conversation_entries():
    conv_routes._MESSAGE_CACHE[("zl_acc_1", "conv_100", 50, 0)] = (time.time(), {"messages": ["stale"]})
    conv_routes._MESSAGE_CACHE[("zl_acc_1", "conv_200", 50, 0)] = (time.time(), {"messages": ["keep"]})

    conv_routes.invalidate_conversation_message_cache("zl_acc_1", "conv_100")

    assert ("zl_acc_1", "conv_100", 50, 0) not in conv_routes._MESSAGE_CACHE
    assert ("zl_acc_1", "conv_200", 50, 0) in conv_routes._MESSAGE_CACHE
    conv_routes._MESSAGE_CACHE.pop(("zl_acc_1", "conv_200", 50, 0), None)


def _build_test_client() -> TestClient:
    app = FastAPI()
    app.include_router(conv_routes.router, prefix="/api/all-platform/zalo")
    app.dependency_overrides[verify_zalo_api_key] = lambda: True
    app.dependency_overrides[get_authenticated_caller_email] = lambda: "member.dev@markeeai.com"
    app.dependency_overrides[get_authenticated_caller_user] = lambda: {
        "email": "member.dev@markeeai.com",
        "name": "Member Dev",
    }
    return TestClient(app)


def test_call_health_and_phone_regex_and_send_voice_endpoints():
    client = _build_test_client()

    # 1. /call-health must match static route (not /{conversation_id}) and return session diagnostics
    with patch.object(conv_routes, "load_zca_auth", new=AsyncMock(return_value={"cookie": "ok"})), patch.object(
        conv_routes,
        "get_listener_status",
        return_value={"running": True, "connected": True, "auth_expired": False},
    ):
        res = client.get("/api/all-platform/zalo/conversations/call-health?account_id=zl_01")
        assert res.status_code == 200
        body = res.json()
        assert body["ok"] is True
        assert body["account_id"] == "zl_01"
        assert body["has_auth"] is True
        assert body["listener_connected"] is True
        assert body["auth_expired"] is False

    # 2. /{conversation_id}/phone regex extracts formatted phone from zalo_messages & caches it
    conv_routes.invalidate_conversation_phone_cache("uid_cust_888")

    async def fake_rest(method: str, path: str, **kwargs):
        params = kwargs.get("params") or {}
        if path == "zalo_messages" and params.get("order") == "created_at.desc":
            return [{"content": "Gọi giúp anh số +84 912.345.678 nhé em"}]
        return []

    with patch.object(conv_routes, "_rest", side_effect=fake_rest) as mocked_rest:
        r1 = client.get("/api/all-platform/zalo/conversations/uid_cust_888/phone?name=Anh+Minh")
        assert r1.status_code == 200
        assert r1.json() == {"success": True, "phone": "0912345678"}
        calls_after_first = mocked_rest.call_count

        # Second call within 60s must hit _CONV_PHONE_CACHE (0 extra DB queries!)
        r2 = client.get("/api/all-platform/zalo/conversations/uid_cust_888/phone?name=Anh+Minh")
        assert r2.status_code == 200
        assert r2.json() == {"success": True, "phone": "0912345678"}
        assert mocked_rest.call_count == calls_after_first

    # 3. /{conversation_id}/send-voice sends voice via ZCA bridge and persists chat.voice
    with patch.object(conv_routes, "check_caller_conversation_access", new=AsyncMock(return_value=None)), patch.object(
        conv_routes, "load_zca_auth", new=AsyncMock(return_value={"cookie": "ok"})
    ), patch.object(conv_routes, "resolve_thread_type", new=AsyncMock(return_value=0)), patch(
        "app.modules.all_platform.zalo.services.supabase_service.upload_asset_bytes",
        new=AsyncMock(return_value="https://cdn.example.com/zalo-assets/voice-test.m4a"),
    ), patch.object(
        conv_routes,
        "send_zca_voice",
        new=AsyncMock(return_value={"ok": True, "response": {"msgId": "998877"}, "voice_url": "https://zadn.vn/voice.m4a"}),
    ) as mocked_send_voice, patch.object(
        conv_routes, "_persist_outgoing_message", new=AsyncMock(return_value=None)
    ) as mocked_persist, patch.object(
        conv_routes, "_schedule_post_send_side_effects", return_value=None
    ):
        fake_audio = io.BytesIO(b"\x00\x00\x00\x18ftypM4A \x00\x00\x02\x00")
        resp = client.post(
            "/api/all-platform/zalo/conversations/uid_cust_888/send-voice?account_id=zl_01",
            data={"duration_sec": "6.5", "staff_name": "Member Dev"},
            files={"file": ("voice-note.m4a", fake_audio, "audio/mp4")},
        )
        assert resp.status_code == 200
        assert resp.json()["ok"] is True
        mocked_send_voice.assert_awaited_once()
        mocked_persist.assert_awaited_once()
        persist_kwargs = mocked_persist.await_args.kwargs
        assert persist_kwargs["message_type"] == "chat.voice"
        assert "6s" in persist_kwargs["content"] or "7s" in persist_kwargs["content"]
