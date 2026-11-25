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


def test_module1_zca_call_engine_crypto_and_signaling():
    import json
    import subprocess
    from pathlib import Path

    script_path = (
        Path(__file__).resolve().parents[1] / "scripts" / "zca_call_engine.js"
    ).as_posix()
    node_code = f"""
    const engine = require("{script_path}");
    (async () => {{
      const payload = {{ callId: 123456, codec: "opus", servers: [{{ host: "127.0.0.1", port: 9000 }}] }};
      const enc = engine.encryptZCallTransportFrame("49", payload);
      const dec = engine.decryptZCallTransportFrame(enc);
      const calls = [];
      const fakeApi = {{
        zpwServiceMap: {{ voice_call: ["https://voicecall-wpa.chat.zalo.me"] }},
        findUser: async (phone) => ({{ uid: "uid_from_phone_" + phone }}),
        custom: function(name, fn) {{
          this[name] = (props) => fn({{
            ctx: {{ imei: "imei_test_01" }},
            utils: {{
              makeURL: (base, params) => base + "?" + new URLSearchParams(params).toString(),
              encodeAES: (s) => "AES(" + s + ")",
              request: async (url, opts) => {{ calls.push({{ url, opts }}); return {{ ok: true }}; }},
              resolve: async () => ({{ callId: 778899, session: 778899, rtpAddress: "103.1.2.3:19302" }})
            }},
            props
          }});
        }}
      }};
      const res = await engine.startDirectZaloCall(fakeApi, {{
        phoneNumber: "0912345678",
        callType: 1
      }});
      console.log(JSON.stringify({{ enc, dec, res, callCount: calls.length }}));
    }})();
    """
    proc = subprocess.run(
        ["node", "-e", node_code],
        capture_output=True,
        text=True,
        check=True,
    )
    out = json.loads(proc.stdout.strip().splitlines()[-1])
    assert out["enc"].startswith("49$")
    assert out["dec"]["header"] == "49"
    assert out["dec"]["payload"]["callId"] == 123456
    assert out["res"]["ok"] is True
    assert out["res"]["callee_id"] == "uid_from_phone_0912345678"
    assert out["res"]["call_id"] == 778899
    # Two-phase dialer: 11300 (requestcall) + 11301 (request)
    assert out["callCount"] == 2

    # Case 2: Callee privacy blocked (status: 7) -> Step 2 must be skipped, status is privacy_blocked
    node_blocked_code = f"""
    const engine = require("{script_path}");
    (async () => {{
      const calls = [];
      const fakeBlockedApi = {{
        zpwServiceMap: {{ voice_call: ["https://voicecall-wpa.chat.zalo.me"] }},
        custom: function(name, fn) {{
          this[name] = (props) => fn({{
            ctx: {{ imei: "imei_test_01" }},
            utils: {{
              makeURL: (base, params) => base + "?" + new URLSearchParams(params).toString(),
              encodeAES: (s) => "AES(" + s + ")",
              request: async (url, opts) => {{ calls.push({{ url, opts }}); return {{ ok: true }}; }},
              resolve: async () => ({{
                status: 7,
                msg: "Xin lỗi. Hiện tại tôi không muốn nhận cuộc gọi.",
                id: 889900
              }})
            }},
            props
          }});
        }}
      }};
      const res = await engine.startDirectZaloCall(fakeBlockedApi, {{
        calleeId: "1234567890123456789",
        callType: 1
      }});
      console.log(JSON.stringify({{ res, callCount: calls.length }}));
    }})();
    """
    proc_b = subprocess.run(
        ["node", "-e", node_blocked_code],
        capture_output=True,
        text=True,
        check=True,
    )
    out_b = json.loads(proc_b.stdout.strip().splitlines()[-1])
    assert out_b["res"]["status"] == "privacy_blocked"
    assert out_b["res"].get("call_ok") is False
    assert (
        "không muốn nhận cuộc gọi" in out_b["res"]["request_warning"]
        or "chặn người lạ" in out_b["res"]["request_warning"]
    )
    # Step 2 was cleanly skipped (only 1 call to 11300)
    assert out_b["callCount"] == 1


def test_module2_3_4_voip_gateway_rtp_stun_websocket_and_auto_kpi():
    import struct
    from app.modules.all_platform.zalo.services import zalo_call_service

    # 1. RFC 3550 12-byte RTP packet builder & parser round-trip
    pcm_sample = b"\x10\x20" * 160
    rtp_bytes = zalo_call_service.build_rtp_packet(
        pcm_sample, seq=42, timestamp=960, ssrc=0x12345678, payload_type=111, marker=True
    )
    parsed = zalo_call_service.parse_rtp_packet(rtp_bytes)
    assert parsed is not None
    assert parsed["version"] == 2
    assert parsed["payload_type"] == 111
    assert parsed["marker"] is True
    assert parsed["seq"] == 42
    assert parsed["timestamp"] == 960
    assert parsed["ssrc"] == 0x12345678
    assert parsed["payload"] == pcm_sample

    # 2. RFC 5389 STUN Binding Response parser (MAPPED-ADDRESS 0x0001)
    tx_id = b"\x01" * 12
    attr_val = struct.pack("!BBH4s", 0, 0x01, 54321, bytes([203, 113, 148, 55]))
    attr = struct.pack("!HH", 0x0001, len(attr_val)) + attr_val
    stun_pkt = struct.pack("!HHI12s", 0x0101, len(attr), 0x2112A442, tx_id) + attr
    stun_res = zalo_call_service._parse_stun_binding_response(stun_pkt, tx_id)
    assert stun_res == ("203.113.148.55", 54321)

    # 3. Full E2E Call Start -> WebSocket Audio Frame -> Incoming VoIP Signal -> End Call (+1 KPI CALL)
    app = FastAPI()
    app.include_router(conv_routes.router, prefix="/api/all-platform/zalo")
    app.dependency_overrides[verify_zalo_api_key] = lambda: True
    app.dependency_overrides[get_authenticated_caller_email] = lambda: "member.dev@markeeai.com"
    app.dependency_overrides[get_authenticated_caller_user] = lambda: {
        "id": "11111111-2222-3333-4444-555555555555",
        "email": "member.dev@markeeai.com",
        "name": "Member Dev",
    }
    client = TestClient(app)

    with patch.object(
        conv_routes, "check_caller_conversation_access", new=AsyncMock(return_value=None)
    ), patch.object(
        zalo_call_service, "load_zca_auth", new=AsyncMock(return_value={"cookie": "ok"})
    ), patch.object(
        zalo_call_service,
        "_allocate_rtp_udp_endpoint",
        new=AsyncMock(return_value=("203.113.148.55:54321", "203.113.148.55:54322")),
    ), patch.object(
        zalo_call_service,
        "start_zca_voice_call",
        new=AsyncMock(
            return_value={
                "ok": True,
                "callee_id": "uid_cust_999",
                "call_id": 556677,
                "call_type": 1,
                "codec": "opus",
                "requestcall_result": {"rtpAddress": "127.0.0.1:49999"},
                "request_result": {"status": 0},
            }
        ),
    ), patch.object(
        zalo_call_service,
        "send_zca_call_signal",
        new=AsyncMock(return_value={"ok": True}),
    ) as mocked_signal, patch.object(
        zalo_call_service,
        "end_zca_voice_call",
        new=AsyncMock(return_value={"ok": True}),
    ) as mocked_end_call, patch(
        "app.modules.all_platform.services.post_call_result_service.update_call_result",
        return_value={"attempts": 1, "result_code": "called"},
    ) as mocked_kpi:
        # Step A: Start direct call
        start_resp = client.post(
            "/api/all-platform/zalo/conversations/call/start",
            json={
                "account_id": "zl_01",
                "conversation_id": "uid_cust_999",
                "callee_id": "uid_cust_999",
                "phone_number": "0912345678",
                "customer_name": "Khách VIP",
                "call_type": 1,
            },
        )
        assert start_resp.status_code == 200
        start_body = start_resp.json()
        assert start_body["ok"] is True
        session_id = start_body["session"]["session_id"]
        assert start_body["session"]["call_id"] == 556677
        assert start_body["session"]["status"] == "ringing"
        assert start_body["session"]["public_ip"] == "203.113.148.55"
        assert start_body["session"]["rtp_port"] == 54321

        # Step B: Stream audio over WebSocket /call-ws/{session_id}
        with client.websocket_connect(
            f"/api/all-platform/zalo/conversations/call-ws/{session_id}"
        ) as ws:
            init_frame = ws.receive_json()
            assert init_frame["type"] == "call_state"
            assert init_frame["session"]["call_id"] == 556677
            ws.send_bytes(b"\x01\x02" * 160)

        # Step C: Incoming VoIP events from Module 2 transition state ringing -> connected
        asyncio.run(
            zalo_call_service.handle_incoming_voip_signal(
                account_id="zl_01",
                act="answer",
                mapped_status="connected",
                call_id=556677,
                partner_id="uid_cust_999",
                data={"callId": 556677, "status": 0, "rtpAddress": "127.0.0.1:49999"},
            )
        )
        status_r2 = client.get(
            f"/api/all-platform/zalo/conversations/call/{session_id}/status"
        )
        assert status_r2.status_code == 200
        assert status_r2.json()["session"]["status"] == "connected"
        assert status_r2.json()["session"]["packets_sent"] >= 1
        mocked_signal.assert_called()

        # Step D: End call -> triggers 11306/11311 + auto +1 KPI CALL (Module 4)
        end_resp = client.post(
            f"/api/all-platform/zalo/conversations/call/{session_id}/action",
            json={"action": "end", "result_code": "called"},
        )
        assert end_resp.status_code == 200
        end_session = end_resp.json()["session"]
        assert end_session["status"] == "ended"
        assert end_session["kpi_recorded"] is True
        mocked_end_call.assert_awaited_once()
        mocked_kpi.assert_called_once()

