import pytest
import base64
import json
import struct
from app.modules.all_platform.zalo.services.zalo_call_service import (
    OPUS_PAYLOAD_TYPE,
    OPUS_TIMESTAMP_STEP,
    OPUS_SILENCE_FRAME,
    CALL_V2_TRANSPORT_AES_KEY,
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
    assert parsed_media["msg_type"] == 5
    assert parsed_media["token"] == 0x12345678
    assert parsed_media["rtp_payload"] == raw_rtp


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
