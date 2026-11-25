"""Offline regressions for premature AnswerAck and stale VoIP events."""
import asyncio
import json
from unittest.mock import AsyncMock, MagicMock, patch

from app.modules.all_platform.zalo.services import zalo_call_service as calls


def make_session():
    session = calls.ZaloCallSession(session_id="ring-test", account_id="test-account",
                                    call_id=123, callee_id="customer", status="ringing")
    session.remote_rtp_addr = ("127.0.0.1", 4200)
    session.broadcast_json = AsyncMock()
    session.broadcast_audio_to_browsers = AsyncMock()
    return session


def test_control_packets_do_not_acknowledge_answer():
    async def run():
        session = make_session()
        protocol = calls._ZaloRtpDatagramProtocol(session)
        audio = calls.build_rtp_packet(b"\xf8\xff\xfe", seq=1, timestamp=960, ssrc=77)
        invalid_packets = [b"49$handshake$", b"ping", bytes(24),
                           calls.build_rtp_packet(b"control", seq=1, timestamp=0, ssrc=77, payload_type=72),
                           calls.build_rtp_packet(b"", seq=1, timestamp=0, ssrc=77),
                           calls.build_rtp_packet(b"echo", seq=1, timestamp=0, ssrc=session.ssrc)]
        with patch.object(calls, "_promote_connected_from_media", new_callable=AsyncMock) as promote:
            for packet in invalid_packets:
                protocol.datagram_received(packet, session.remote_rtp_addr)
            protocol.datagram_received(audio, ("127.0.0.2", 4200))
            await asyncio.sleep(0)
            assert session.status == "ringing"
            assert session.packets_received == 0
            promote.assert_not_called()
            session.broadcast_audio_to_browsers.assert_not_called()
            protocol.datagram_received(audio, session.remote_rtp_addr)
            await asyncio.sleep(0)
            assert session.packets_received == 1
            promote.assert_awaited_once()
    asyncio.run(run())


def test_stale_call_and_nested_negotiation_cannot_connect_or_end_current_call():
    async def run():
        session = make_session()
        with patch.dict(calls._CALL_SESSIONS, {session.session_id: session}, clear=True), \
             patch.object(calls, "send_zca_call_signal", new_callable=AsyncMock) as signal:
            for act, status, call_id, data in [
                ("endcall", "ended", 122, {}),
                ("endcall", "ended", None, {"params": '{"callId":122}'}),
                ("answer", "connected", 123, {"status":7}),
                ("answer", "connected", 123, {}),
            ]:
                await calls.handle_incoming_voip_signal(account_id=session.account_id,
                    act=act, mapped_status=status, call_id=call_id, partner_id=session.callee_id, data=data)
                assert session.status == "ringing"
            await asyncio.sleep(0)
            signal.assert_not_called()
            session.status = "connected"
            await calls.handle_incoming_voip_signal(account_id=session.account_id,
                act="ring_ring", mapped_status="ringing", call_id=123, partner_id="", data={})
            assert session.status == "connected"
            session.status = "ended"
            await calls.handle_incoming_voip_signal(account_id=session.account_id,
                act="answer", mapped_status="connected", call_id=123, partner_id="", data={"status":0})
            assert session.status == "ended"
    asyncio.run(run())


def test_rtp_padding_is_validated_and_removed():
    packet = bytearray(calls.build_rtp_packet(b"audio", seq=1, timestamp=960, ssrc=77))
    packet[0] |= 0x20
    assert calls.parse_rtp_packet(bytes(packet) + b"\x00\x02")["payload"] == b"audio"
    assert calls.parse_rtp_packet(bytes(packet) + b"\x00") is None
    assert calls.parse_rtp_packet(bytes(packet) + b"\xff") is None


def test_confirmed_answer_sends_one_ack_even_if_repeated():
    async def run():
        session = make_session()
        with patch.dict(calls._CALL_SESSIONS, {session.session_id: session}, clear=True), \
             patch.object(calls, "load_zca_auth", new_callable=AsyncMock, return_value={"test":True}), \
             patch.object(calls, "send_zca_call_signal", new_callable=AsyncMock) as signal, \
             patch.object(calls, "_media_watchdog_loop", new_callable=AsyncMock):
            for _ in range(2):
                await calls.handle_incoming_voip_signal(account_id=session.account_id,
                    act="answer", mapped_status="connected", call_id=123, partner_id="",
                    data={"status":0})
                await asyncio.sleep(0)
            assert session.status == "connected"
            signal.assert_awaited_once_with({"test":True}, 11304, {"calleeId":"customer", "callId":123})
            session.status = "ended"
    asyncio.run(run())


def test_send_audio_from_browser_strictly_gated_to_connected_state():
    session = calls.ZaloCallSession(
        session_id="test_gate",
        account_id="acc",
        call_id=456,
        callee_id="callee",
        status="ringing",
        remote_rtp_addr=("127.0.0.1", 4200),
    )
    mock_transport = MagicMock()
    session.udp_transport = mock_transport

    # Khi đang ringing -> tuyệt đối không gửi
    session.send_audio_from_browser(b"dummy_pcm16_data")
    assert session.packets_sent == 0
    mock_transport.sendto.assert_not_called()

    # Chỉ khi chuyển sang connected -> mới gửi
    session.status = "connected"
    session.send_audio_from_browser(b"dummy_pcm16_data")
    assert session.packets_sent == 1
    mock_transport.sendto.assert_called_once()
    session.status = "ended"


def test_answerack_and_negotiation_status_5_cannot_prematurely_promote_ringing():
    async def run():
        session = calls.ZaloCallSession(
            session_id="test_nego",
            account_id="acc",
            call_id=789,
            callee_id="callee",
            status="ringing",
            remote_rtp_addr=("127.0.0.1", 4200),
        )
        calls._CALL_SESSIONS["test_nego"] = session

        with patch("app.modules.all_platform.zalo.services.zalo_call_service.send_zca_call_signal", new_callable=AsyncMock) as signal, \
             patch("app.modules.all_platform.zalo.services.zalo_call_service.load_zca_auth", new_callable=AsyncMock, return_value={"test": True}):
            
            # Case 1: act=answerack và act=answer_ack khi đang ringing -> phải giữ ringing
            for ack_act in ("answerack", "answer_ack"):
                await calls.handle_incoming_voip_signal(
                    account_id="acc",
                    act=ack_act,
                    mapped_status="connected",
                    call_id=789,
                    partner_id="callee",
                    data={"status": 0},
                )
                assert session.status == "ringing"
            signal.assert_not_called()

            # Case 2: act=answer với status=5 (callee_init_zrtp_fail) -> chuyển sang failed,
            # tự động gửi 11305 cancel để tránh treo máy khách, tuyệt đối không chuyển connected hay gửi 11304
            with patch("app.modules.all_platform.zalo.services.zalo_call_service.cancel_zca_voice_call", new_callable=AsyncMock) as cancel_fn, \
                 patch("app.modules.all_platform.zalo.services.zalo_call_service.load_zca_auth", new_callable=AsyncMock, return_value={"imei": "test-imei"}):
                await calls.handle_incoming_voip_signal(
                    account_id="acc",
                    act="answer",
                    mapped_status="connected",
                    call_id=789,
                    partner_id="callee",
                    data={"params": json.dumps({"status": 5, "callId": 789})},
                )
                await asyncio.sleep(0)
                assert session.status == "failed"
                signal.assert_not_called()
                cancel_fn.assert_awaited_once_with(
                    {"imei": "test-imei"},
                    to_id="callee",
                    call_id=789,
                    call_type=1,
                )

            session.status = "ended"

    asyncio.run(run())

