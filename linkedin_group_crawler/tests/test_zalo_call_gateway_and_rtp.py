import pytest
import base64
import json
import struct
from app.modules.all_platform.zalo.services.zalo_call_service import (
    OPUS_PAYLOAD_TYPE,
    OPUS_TIMESTAMP_STEP,
    OPUS_SILENCE_FRAME,
    CALL_V2_TRANSPORT_AES_KEY,
    encrypt_zcall_transport_frame,
    build_rtp_packet,
    parse_rtp_packet,
    ZaloCallSession,
)


def test_opus_rtp_constants_and_silence_frame():
    assert OPUS_PAYLOAD_TYPE == 113
    assert OPUS_TIMESTAMP_STEP == 960
    assert OPUS_SILENCE_FRAME == bytes([0xF8, 0xFF, 0xFE])


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
        timestamp=9600,
        ssrc=54321,
    )
    assert len(pkt) == 12 + 3
    parsed = parse_rtp_packet(pkt)
    assert parsed is not None
    assert parsed["payload_type"] == 113
    assert parsed["seq"] == 101
    assert parsed["timestamp"] == 9600
    assert parsed["ssrc"] == 54321
    assert parsed["payload"] == OPUS_SILENCE_FRAME


def test_session_audio_increment_and_payload_type():
    session = ZaloCallSession(
        session_id="test_sess_01",
        account_id="acc_01",
        call_id=99999,
        callee_id="callee_01",
    )
    initial_ts = session.rtp_timestamp
    session.send_audio_from_browser(b"")
    assert session.rtp_timestamp == (initial_ts + 960) & 0xFFFFFFFF
    assert session.packets_sent == 1
