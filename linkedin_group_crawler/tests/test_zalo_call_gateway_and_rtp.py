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
    _parse_host_port,
    _parse_stun_binding_response,
    _send_udp_keepalive_tick,
    build_rtcp_sr_packet,
    build_zrtc_init_zrtp_packet,
    build_zrtc_ping_packet,
    build_zrtc_echo_packet,
    build_zrtc_end_call_packet,
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

    # Real Zalo Relay returns public_addr with pipe '|' separator ('1.52.116.41|44811')
    assert _parse_host_port("1.52.116.41|44811") == ("1.52.116.41", 44811)
    assert _parse_host_port("42.119.138.116:4200") == ("42.119.138.116", 4200)

    # cmd=2 (magic=0x01, subCmd=1) là ZRTPPing thật (0x00894eb3)
    ping_pkt = build_zrtc_ping_packet(462884481, token=0x12345678, sess_id="abc_sess")
    parsed_ping = parse_zrtc_packet(ping_pkt)
    assert parsed_ping is not None
    assert parsed_ping["msg_type"] == 1
    assert parsed_ping["magic"] == 0x01
    assert parsed_ping["cmd"] == 2
    assert parsed_ping["sub_cmd"] == 1
    assert parsed_ping["token"] == 0x12345678

    # cmd=5 (magic=0x01, subCmd=0) là Echo thật (0x00894b2e) — khớp 27B byte-by-byte với ZaloCall.exe
    echo_pkt = build_zrtc_echo_packet(seq=0, data=b"4130")
    assert len(echo_pkt) == 27
    assert echo_pkt.hex() == "0101000000000000000065973e003c832f01050000040034313330"

    # cmd=3 (magic=0x7E) là ZRTPEndCall thật (0x00894b8e) — CHỈ gửi khi gác máy
    end_pkt = build_zrtc_end_call_packet(132236795, 462884481, token=0x12345678, sub_cmd=0)
    assert len(end_pkt) == 25
    assert end_pkt[0] == 1
    assert end_pkt[1] == 0x7E
    assert struct.unpack("<H", end_pkt[18:20])[0] == 3

    # REGRESSION GUARD: _send_udp_keepalive_tick trong ringing/connected TUYỆT ĐỐI KHÔNG gửi cmd=3 (ZRTPEndCall)!
    ka_session = ZaloCallSession(
        session_id="ka_guard",
        account_id="acc",
        call_id=132236795,
        callee_id="202",
        status="ringing",
        remote_rtp_addr=("42.119.138.116", 4200),
        zalo_from_id=462884481,
        zrtc_token=0x3D86374E,
    )
    ka_tr = MagicMock()
    ka_session.udp_transport = ka_tr
    for tick in range(31):
        _send_udp_keepalive_tick(ka_session, tick_idx=tick, send_rtp=False)
    sent_pkts = [call.args[0] for call in ka_tr.sendto.call_args_list]
    assert len(sent_pkts) == 2  # tick 15 & tick 30 (mỗi 3s), KHÔNG bắn ở tick 0!
    for pkt in sent_pkts:
        p = parse_zrtc_packet(pkt)
        assert p is not None and p["cmd"] == 2 and p["magic"] == 0x01
        assert p["cmd"] != 3  # NEVER ZRTPEndCall during ringing!

    # Khi close_media -> mới gửi đúng 1 gói ZRTPEndCall (cmd=3, magic=0x7E) rồi đóng socket
    ka_tr.reset_mock()
    ka_session.close_media()
    ka_tr.sendto.assert_called_once()
    close_pkt = ka_tr.sendto.call_args[0][0]
    p_close = parse_zrtc_packet(close_pkt)
    assert p_close is not None and p_close["cmd"] == 3 and p_close["magic"] == 0x7E
    ka_tr.close.assert_called_once()

    raw_rtp = build_rtp_packet(OPUS_SILENCE_FRAME, seq=10, timestamp=3200, ssrc=999)
    wrapped = wrap_zrtc_audio_rtp_packet(raw_rtp, token=0x12345678)
    assert len(wrapped) == 5 + len(raw_rtp)
    parsed_media = parse_zrtc_packet(wrapped)
    assert parsed_media is not None
    assert parsed_media["msg_type"] == 3  # Client -> Relay Audio RTP: 5-byte header (0x03 + token_4B + RTP)
    assert parsed_media["token"] == 0x12345678
    assert parsed_media["rtp_payload"] == raw_rtp

    # Relay -> Client Audio RTP (ZrtcPacket::deserialize 0x0089419a): 1-byte header (0x04 + raw RTP, NO token!)
    relay_rx_audio = b"\x04" + raw_rtp
    parsed_rx_audio = parse_zrtc_packet(relay_rx_audio)
    assert parsed_rx_audio is not None
    assert parsed_rx_audio["msg_type"] == 4
    assert parsed_rx_audio["rtp_payload"] == raw_rtp

    # Relay -> Client Video RTP (msgType=14, 1-byte header) must be parsed and ignored by audio RX
    relay_rx_video = b"\x0e" + build_rtp_packet(b"\x01\x02\x03\x04", seq=1, timestamp=9000, ssrc=888, payload_type=97)
    parsed_rx_video = parse_zrtc_packet(relay_rx_video)
    assert parsed_rx_video is not None and parsed_rx_video["msg_type"] == 14

    rtcp_raw = build_rtcp_sr_packet(ssrc=999, packets_sent=5)
    wrapped_rtcp = wrap_zrtc_audio_rtp_packet(rtcp_raw, token=0x12345678, is_rtcp=True)
    parsed_rtcp = parse_zrtc_packet(wrapped_rtcp)
    assert parsed_rtcp is not None
    assert parsed_rtcp["msg_type"] == 5  # Verified from ZaloCall.exe wire capture: msgType=5 is Audio RTCP


def test_datagram_received_decodes_relay_msgtype_4_audio_rtp():
    """Đảm bảo gói Audio RTP thật Relay đẩy về (1-byte header 0x04 + RTP) được đếm packets_received và giải mã PCM16."""
    import asyncio
    from unittest.mock import AsyncMock

    async def run():
        sess = ZaloCallSession(
            session_id="rx_mt4_test",
            account_id="acc",
            call_id=405699309,
            callee_id="6363678867120121443",
            status="connected",
            remote_rtp_addr=("203.12.252.6", 4200),
            ssrc=462884481,
            warning="Chưa nhận được tín hiệu âm thanh từ máy khách qua Relay Zalo. Đang tiếp tục giữ thông luồng UDP RTP.",
        )
        sess.broadcast_audio_to_browsers = AsyncMock()
        sess.broadcast_json = AsyncMock()
        proto = _ZaloRtpDatagramProtocol(sess)

        # Real Zalo Opus PT=112 frame wrapped in Relay -> Client 1-byte header 0x04
        zalo_opus = bytes.fromhex("480a7ae6398d501054a57f0b0979833caf2780c79dc4842cac1661047fc5f5")
        rtp = build_rtp_packet(zalo_opus, seq=1, timestamp=320, ssrc=327635537, payload_type=112)
        proto.datagram_received(b"\x04" + rtp, ("203.12.252.6", 4200))
        # Video RTP (msgType=14) and RTCP (msgType=5) must NOT increment packets_received
        proto.datagram_received(b"\x0e" + build_rtp_packet(b"\x65\x88\x84", seq=2, timestamp=9000, ssrc=327635537, payload_type=97), ("203.12.252.6", 4200))
        proto.datagram_received(wrap_zrtc_audio_rtp_packet(build_rtcp_sr_packet(327635537, 1), token=123, is_rtcp=True), ("203.12.252.6", 4200))
        await asyncio.sleep(0.05)

        assert sess.packets_received == 1
        assert sess.warning is None  # Watchdog warning cleared automatically once RX audio flows!
        sess.broadcast_audio_to_browsers.assert_awaited_once()
        pcm_sent = sess.broadcast_audio_to_browsers.await_args.args[0]
        assert len(pcm_sent) > 0 and len(pcm_sent) % 2 == 0

    asyncio.run(run())


def test_build_zrtc_extend_data_and_stun_responder():
    ext_raw = _build_zrtc_extend_data(
        call_type=1,
        p2p_addrs=[("118.69.70.174", 54321), ("127.0.0.1", 5000), ("fd7a:115c::1", 54321)],
        server_items=[{"rtpaddr": "171.244.25.89:4200", "rtcpaddr": "171.244.25.89:4200"}],
    )
    ext = json.loads(ext_raw)
    assert ext["newZrtc"] == 1
    assert ext["packetMode"] == 2
    assert ext["srtpMode"] == 0
    assert ext["sP2P"] == 0
    assert ext["p2p"] == [{"ip": "118.69.70.174", "port": 54321, "type": 1}]
    assert ext["supportHevcDecode"] == 0
    assert ext["serverAddr"][0]["rtp"] == "171.244.25.89:4200"
    assert ext["serverAddr"][0]["rtpIPv6"] == "::FFFF:171.244.25.89:4200"
    assert ext["serverAddr"][0]["rtcpIPv6"] == "::FFFF:171.244.25.89:4200"
    assert ext["video"] == {"codec": [{"name": "h264", "payload": 97}]}

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


def test_start_call_session_unwraps_nested_zca_response_and_runs_init_zrtp():
    """Khớp đúng hình dạng trả về thật của zca_api_server.js: {ok, signal_code, response: {callId, data: {...}}}."""
    import asyncio
    from unittest.mock import AsyncMock, patch
    from app.modules.all_platform.zalo.services import zalo_call_service as calls

    sent_signals = []
    sent_udp_subcmds = []

    async def fake_send_signal(_auth, code, payload):
        sent_signals.append((code, payload))
        if code == 11300:
            return {
                "ok": True,
                "signal_code": 11300,
                "response": {
                    "callId": 778899,
                    "data": {
                        "id": 778899,
                        "fromId": 462884481,
                        "toId": 327635537,
                        "sessId": "778899_1763_401",
                        "rtpIP": "171.244.25.89:4200",
                        "rtcpIP": "171.244.25.89:4200",
                        "status": 0,
                        "servers": [
                            {"rtpaddr": "171.244.25.89:4200", "rtcpaddr": "171.244.25.89:4200"},
                            {"rtpaddr": "222.255.179.228:4200", "rtcpaddr": "222.255.179.228:4200"},
                        ],
                    },
                },
            }
        return {"ok": True, "signal_code": code, "response": {"callId": 778899, "data": {"status": 0}}}

    async def run():
        async def fake_alloc(sess):
            protocol = calls._ZaloRtpDatagramProtocol(sess)
            mock_tr = MagicMock()
            protocol.connection_made(mock_tr)

            def _on_sendto(pkt, addr):
                parsed = calls.parse_zrtc_packet(pkt)
                if parsed and parsed.get("msg_type") == 1 and parsed.get("cmd") == 11:
                    sent_udp_subcmds.append((addr, parsed["sub_cmd"]))
                    if addr == ("222.255.179.228", 4200):
                        pub_b = b"1.52.116.41|51111"
                        resp_pkt = (
                            struct.pack("<BBIIIIHB", 2, 0x7E, 0, 0, 462884481, 0x5A10C411, 11, 2)
                            + struct.pack("<iIIH", 0, 778899, 0x5A10C411, len(pub_b))
                            + pub_b
                        )
                        protocol.datagram_received(resp_pkt, addr)

            mock_tr.sendto.side_effect = _on_sendto
            sess.udp_transport = mock_tr
            return ("1.52.116.41:51111", "1.52.116.41:51111")

        with patch.dict(calls._CALL_SESSIONS, {}, clear=True), \
             patch.object(calls, "load_zca_auth", new_callable=AsyncMock, return_value={"imei": "i1"}), \
             patch.object(calls, "_allocate_rtp_udp_endpoint", side_effect=fake_alloc), \
             patch.object(calls, "send_zca_call_signal", side_effect=fake_send_signal), \
             patch.object(calls, "_auto_answer_ack_loop", new_callable=AsyncMock):
            sess = await calls.start_call_session(
                account_id="acc_zrtp",
                callee_id="7198431234567890123",
                call_type=3,
            )
            assert sess.status == "ringing"
            assert sess.zalo_from_id == 462884481
            assert sess.zalo_to_id == 327635537
            assert sess.ssrc == 462884481
            assert sess.zalo_sess_id == "778899_1763_401"
            assert sess.zrtc_token == 0x5A10C411
            assert sess.zrtc_selected_server == ("222.255.179.228", 4200)
            assert sess.remote_rtp_addr == ("222.255.179.228", 4200)
            assert sent_udp_subcmds and all(sc == 2 for _, sc in sent_udp_subcmds)
            assert [c for c, _ in sent_signals] == [11300, 11301]
            # 11301 phải trỏ đúng vào server đã bắt tay InitZRTP thành công + mang đầy đủ video codec & IPv6
            s2_payload = sent_signals[1][1]
            assert s2_payload["rtpAddress"] == "222.255.179.228:4200"
            assert s2_payload["rtcpAddress"] == "222.255.179.228:4200"
            assert s2_payload["session"] == "778899_1763_401"
            ext = json.loads(s2_payload["extendData"])
            assert ext["callType"] == 1
            assert ext["newZrtc"] == 1
            assert ext["srtpMode"] == 0
            assert ext["sP2P"] == 0
            assert ext["video"] == {"codec": [{"name": "h264", "payload": 97}]}
            assert ext["p2p"][0] == {"ip": "1.52.116.41", "port": 51111, "type": 1}
            assert len(ext["serverAddr"]) == 1
            assert ext["serverAddr"][0]["rtp"] == "222.255.179.228:4200"
            assert ext["serverAddr"][0]["rtpIPv6"] == "::FFFF:222.255.179.228:4200"

            # Verify answer: không bị ghi đè remote_rtp_addr bởi IP LAN, bỏ qua IPv6 p2p, ưu tiên matched.callee_id cho 11304
            callee_ext = json.dumps({
                "p2p": [
                    {"ip": "fd7a:115c:a1e0::1", "port": 50700, "type": 0},
                    {"ip": "192.168.1.9", "port": 50700, "type": 0},
                    {"ip": "113.160.1.2", "port": 50700, "type": 1},
                ],
                "serverAddr": [{"rtp": "222.255.179.228:4200", "rtcp": "222.255.179.228:4200", "tpType": 0}],
            })
            await calls.handle_incoming_voip_signal(
                account_id="acc_zrtp",
                act="answer",
                mapped_status="connected",
                call_id=778899,
                partner_id="327635537",
                data={
                    "callId": 778899,
                    "calleeId": "327635537",
                    "rtpAddress": "192.168.1.9:50700",
                    "params": json.dumps({"callId": 778899, "status": 0, "extendData": callee_ext}),
                },
            )
            await asyncio.sleep(0.05)
            assert sess.status == "connected"
            assert sess.remote_rtp_addr == ("222.255.179.228", 4200)
            assert sess.p2p_target == ("113.160.1.2", 50700)
            ack_calls = [p for c, p in sent_signals if c == 11304]
            assert len(ack_calls) == 1
            assert ack_calls[0]["calleeId"] == "7198431234567890123"
            assert ack_calls[0]["callId"] == 778899

    asyncio.run(run())


def test_start_call_session_detects_nested_privacy_blocked_status_7():
    """Đảm bảo status=7 nằm trong response.data được nhận diện đúng thành privacy_blocked (không gọi 11301)."""
    import asyncio
    from unittest.mock import AsyncMock, patch
    from app.modules.all_platform.zalo.services import zalo_call_service as calls

    sent_codes = []

    async def fake_send_signal(_auth, code, _payload):
        sent_codes.append(code)
        return {
            "ok": True,
            "signal_code": 11300,
            "response": {
                "callId": 889900,
                "data": {"id": 889900, "status": 7, "msg": "Người này chặn cuộc gọi từ người lạ"},
            },
        }

    async def run():
        with patch.dict(calls._CALL_SESSIONS, {}, clear=True), \
             patch.object(calls, "load_zca_auth", new_callable=AsyncMock, return_value={"imei": "i1"}), \
             patch.object(calls, "_allocate_rtp_udp_endpoint", new_callable=AsyncMock, return_value=("1.2.3.4:5000", "1.2.3.4:5000")), \
             patch.object(calls, "send_zca_call_signal", side_effect=fake_send_signal):
            sess = await calls.start_call_session(account_id="acc_priv", callee_id="7198431234567890123", call_type=1)
            assert sess.status == "privacy_blocked"
            assert sent_codes == [11300]

    asyncio.run(run())
