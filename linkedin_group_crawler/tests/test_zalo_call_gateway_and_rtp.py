from unittest.mock import MagicMock
import pytest
import base64
import json
import math
import struct
from app.modules.all_platform.zalo.services.zalo_call_service import (
    OPUS_PAYLOAD_TYPE,
    OPUS_TIMESTAMP_STEP,
    OPUS_SILENCE_FRAME,
    CALL_V2_TRANSPORT_AES_KEY,
    _ZaloOpusCodec,
    _ZaloRtpDatagramProtocol,
    _build_stun_binding_request,
    _build_zrtc_extend_data,
    _parse_stun_binding_response,
    build_rtcp_sr_packet,
    build_zrtc_init_zrtp_packet,
    build_zrtc_echo_packet,
    wrap_zrtc_audio_rtp_packet,
    parse_zrtc_packet,
    encrypt_zcall_transport_frame,
    build_rtp_packet,
    parse_rtp_packet,
    ZaloCallSession,
)


def test_opus_rtp_constants_and_silence_frame():
    assert OPUS_PAYLOAD_TYPE == 112
    assert OPUS_TIMESTAMP_STEP == 320
    assert OPUS_SILENCE_FRAME == bytes([0xF8, 0xFF, 0xFE])


def test_build_and_parse_zrtc_packets():
    init_pkt = build_zrtc_init_zrtp_packet(
        call_id=132236795,
        from_id=462884481,
        to_id=327635537,
        sess_id="132236795_1763627222845_401",
        is_caller=True,
        sub_cmd=1,
    )
    assert len(init_pkt) == 58
    assert init_pkt[0] == 1
    assert init_pkt[1] == 0x7E

    # Simulate 35+ byte InitZRTP success response (msgType=2, magic=0x7E, cmd=11, res=0, token=0x12345678)
    addr_bytes = b"118.69.70.174:54321"
    resp_pkt = (
        struct.pack("<BBIIIIHB", 2, 0x7E, 0, 0, 462884481, 0, 11, 1)
        + struct.pack("<iIIH", 0, 132236795, 0x12345678, len(addr_bytes))
        + addr_bytes
    )
    parsed_resp = parse_zrtc_packet(resp_pkt)
    assert parsed_resp is not None
    assert parsed_resp["msg_type"] == 2
    assert parsed_resp["cmd"] == 11
    assert parsed_resp["res"] == 0
    assert parsed_resp["token"] == 0x12345678
    assert parsed_resp["public_addr"] == "118.69.70.174:54321"

    echo_pkt = build_zrtc_echo_packet(132236795, 462884481, token=0x12345678, seq=3)
    assert len(echo_pkt) == 25
    assert echo_pkt[0] == 1
    assert echo_pkt[1] == 0x7E

    raw_rtp = build_rtp_packet(OPUS_SILENCE_FRAME, seq=10, timestamp=3200, ssrc=999)
    wrapped = wrap_zrtc_audio_rtp_packet(raw_rtp, token=0x12345678)
    assert len(wrapped) == 5 + len(raw_rtp)
    parsed_media = parse_zrtc_packet(wrapped)
    assert parsed_media is not None
    assert parsed_media["msg_type"] == 3  # Verified from ZaloCall.exe wire capture: msgType=3 is Audio RTP
    assert parsed_media["token"] == 0x12345678
    assert parsed_media["rtp_payload"] == raw_rtp

    rtcp_raw = build_rtcp_sr_packet(ssrc=999, packets_sent=5)
    wrapped_rtcp = wrap_zrtc_audio_rtp_packet(rtcp_raw, token=0x12345678, is_rtcp=True)
    parsed_rtcp = parse_zrtc_packet(wrapped_rtcp)
    assert parsed_rtcp is not None
    assert parsed_rtcp["msg_type"] == 5  # Verified from ZaloCall.exe wire capture: msgType=5 is Audio RTCP


def test_build_zrtc_extend_data_and_stun_responder():
    ext_raw = _build_zrtc_extend_data(
        call_type=1,
        p2p_addrs=[("118.69.70.174", 54321), ("127.0.0.1", 5000)],
        server_items=[{"rtpaddr": "171.244.25.89:4200", "rtcpaddr": "171.244.25.89:4200"}],
    )
    ext = json.loads(ext_raw)
    assert ext["newZrtc"] == 1
    assert ext["packetMode"] == 2
    assert ext["srtpMode"] == 0
    assert ext["sP2P"] == 0
    assert ext["p2p"] == [{"ip": "118.69.70.174", "port": 54321, "type": 0}]
    assert ext["serverAddr"][0]["rtp"] == "171.244.25.89:4200"

    session = ZaloCallSession(session_id="stun_test", account_id="acc", call_id=101, callee_id="202", status="ringing")
    protocol = _ZaloRtpDatagramProtocol(session)
    mock_transport = MagicMock()
    protocol.connection_made(mock_transport)
    req, tx_id = _build_stun_binding_request()
    protocol.datagram_received(req, ("203.113.10.5", 45000))
    mock_transport.sendto.assert_called_once()
    resp_bytes, target_addr = mock_transport.sendto.call_args[0]
    assert target_addr == ("203.113.10.5", 45000)
    assert _parse_stun_binding_response(resp_bytes, tx_id) == ("203.113.10.5", 45000)
    assert session.p2p_target == ("203.113.10.5", 45000)
    assert session.packets_received == 0


def test_pyav_opus_16khz_roundtrip_and_zalocall_packet():
    codec = _ZaloOpusCodec()
    pcm_in = struct.pack("<320h", *[int(9000 * math.sin(2 * math.pi * 440 * i / 16000)) for i in range(320)])
    opus_out = codec.encode_pcm16_frame(pcm_in)
    assert isinstance(opus_out, (bytes, bytearray)) and len(opus_out) > 3
    pcm_back = codec.decode_opus_to_pcm16(opus_out)
    assert len(pcm_back) > 0 and len(pcm_back) % 2 == 0
    # Real Opus payload captured live from ZaloCall.exe PT=112
    zalo_wire = bytes.fromhex("480a7ae6398d501054a57f0b0979833caf2780c79dc4842cac1661047fc5f5")
    decoded_wire = codec.decode_opus_to_pcm16(zalo_wire)
    assert len(decoded_wire) > 0 and len(decoded_wire) % 2 == 0


def test_encrypt_zcall_transport_frame():
    payload = {"callId": 12345}
    frame = encrypt_zcall_transport_frame("49", payload)
    assert frame.startswith(b"49$")
    assert frame.endswith(b"$")
    # Verify exact match with Node.js zca_call_engine
    assert frame == b"49$a1ffbb912bc6669e9a001a6ec8d1f30b287084bf7b79dbb8f5b5025bd5b7c25d$"


def test_build_and_parse_rtp_packet_opus():
    pkt = build_rtp_packet(
        OPUS_SILENCE_FRAME,
        seq=101,
        timestamp=3200,
        ssrc=54321,
    )
    assert len(pkt) == 12 + 3
    parsed = parse_rtp_packet(pkt)
    assert parsed is not None
    assert parsed["payload_type"] == 112
    assert parsed["seq"] == 101
    assert parsed["timestamp"] == 3200
    assert parsed["ssrc"] == 54321
    assert parsed["payload"] == OPUS_SILENCE_FRAME


def test_session_audio_increment_and_payload_type():
    session = ZaloCallSession(
        session_id="test_sess_01",
        account_id="acc_01",
        call_id=99999,
        callee_id="callee_01",
        status="connected",
    )
    initial_ts = session.rtp_timestamp
    session.send_audio_from_browser(b"")
    assert session.rtp_timestamp == (initial_ts + 320) & 0xFFFFFFFF
    assert session.packets_sent == 1


def test_start_call_session_runs_python_init_zrtp_and_sends_extend_data():
    import asyncio
    from unittest.mock import AsyncMock, patch
    from app.modules.all_platform.zalo.services import zalo_call_service as calls

    sent_signals = []

    async def fake_send_signal(_auth, code, payload):
        sent_signals.append((code, payload))
        if code == 11300:
            return {
                "ok": True,
                "response": {
                    "id": 778899,
                    "fromId": 462884481,
                    "toId": 327635537,
                    "sessId": "778899_1763_401",
                    "rtpIP": "171.244.25.89:4200",
                    "rtcpIP": "171.244.25.89:4200",
                    "status": 0,
                    "servers": [{"rtpaddr": "171.244.25.89:4200", "rtcpaddr": "171.244.25.89:4200"}],
                },
            }
        return {"ok": True, "response": {"status": 0}}

    async def run():
        created_sessions = []

        async def fake_alloc(sess):
            created_sessions.append(sess)
            mock_tr = MagicMock()

            def _on_sendto(pkt, addr):
                parsed = calls.parse_zrtc_packet(pkt)
                if parsed and parsed.get("msg_type") == 1 and parsed.get("cmd") == 11:
                    sess.zrtc_token = 0x5A10C411
                    sess.zrtc_public_addr = "118.69.70.174:51111"
                    sess.notify_init_zrtp()

            mock_tr.sendto.side_effect = _on_sendto
            sess.udp_transport = mock_tr
            return ("118.69.70.174:51111", "118.69.70.174:51111")

        with patch.dict(calls._CALL_SESSIONS, {}, clear=True), \
             patch.object(calls, "load_zca_auth", new_callable=AsyncMock, return_value={"imei": "i1"}), \
             patch.object(calls, "_allocate_rtp_udp_endpoint", side_effect=fake_alloc), \
             patch.object(calls, "send_zca_call_signal", side_effect=fake_send_signal), \
             patch.object(calls, "_auto_answer_ack_loop", new_callable=AsyncMock):
            sess = await calls.start_call_session(
                account_id="acc_zrtp",
                callee_id="327635537",
                call_type=1,
            )
            assert sess.status == "ringing"
            assert sess.zrtc_token == 0x5A10C411
            assert [c for c, _ in sent_signals] == [11300, 11301]
            ext = json.loads(sent_signals[1][1]["extendData"])
            assert ext["newZrtc"] == 1
            assert ext["srtpMode"] == 0
            assert ext["sP2P"] == 0
            assert ext["p2p"][0] == {"ip": "118.69.70.174", "port": 51111, "type": 0}
            assert ext["serverAddr"][0]["rtp"] == "171.244.25.89:4200"

    asyncio.run(run())
