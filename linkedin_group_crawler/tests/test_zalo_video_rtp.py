"""Unit & integration tests for Zalo Video Call (call_type=3) isolated H.264 RTP/RTCP engine.

Verifies:
1. Zalo ZRTP packetMode=2 H.264 framing (PT=97 single Annex-B, PT=98 1c 80/00/40 fragmented Annex-B, PT=100 ULPFEC ignored).
2. RFC 6184 depacketizer fallback (Single NAL, STAP-A, FU-A).
3. Video RTCP SR+RR+SDES (40B & 64B) + PLI (PT=206 FMT=1) + incoming PLI/FIR/SR feedback parsing.
4. Full PyAV JPEG -> libx264 (zero-latency frame 0, SEI stripped) -> ZRTC msgType=13 -> Relay msgType=14 -> h264 decode -> JPEG roundtrip.
5. Camera-off / no-webcam placeholder H.264 keyframe generation & PT=98 fragmentation.
6. STRICT AUDIO CALL ISOLATION: call_type=1 NEVER initializes _video_bridge, NEVER emits msgType=13/15, and NEVER increments audio packets_received on video packets.
7. Full async bidirectional Video + Audio session multiplexing over /call-ws binary framing (VJPG / VFRM vs raw PCM16).
"""

from __future__ import annotations

import asyncio
from fractions import Fraction
import struct

import av
import pytest

from app.modules.all_platform.zalo.services import zalo_call_service as zcs
from app.modules.all_platform.zalo.services import zalo_video_codec as zvc


def _make_sample_jpeg(width: int = 480, height: int = 360, seed: int = 0) -> bytes:
    enc = av.CodecContext.create("mjpeg", "w")
    enc.width = width
    enc.height = height
    enc.pix_fmt = "yuvj420p"
    enc.time_base = Fraction(1, 15)
    enc.qmin = 5
    enc.qmax = 8
    enc.open()
    vf = av.VideoFrame(width, height, "yuvj420p")
    y_rows = bytearray()
    for r in range(height):
        base = (r * 2 + seed * 30) % 200 + 20
        y_rows.extend(bytes(((base + (c // 4) + ((c ^ r) & 31)) % 230 + 16) for c in range(width)))
    vf.planes[0].update(bytes(y_rows))
    vf.planes[1].update(bytes([110 + (seed * 7) % 40]) * vf.planes[1].buffer_size)
    vf.planes[2].update(bytes([140 - (seed * 5) % 40]) * vf.planes[2].buffer_size)
    return b"".join(bytes(p) for p in enc.encode(vf))


def test_packetize_and_depacketize_zalo_packet_mode_2_keyframe_and_pframe():
    # 1. Small P-frame -> single PT=97 Annex-B packet, marker=True
    pframe = b"\x00\x00\x00\x01\x41\x9a\x20" + (b"\x55" * 120)
    pkts_p = zvc.packetize_zalo_h264_annexb(pframe, max_payload=1200, packet_mode=2)
    assert len(pkts_p) == 1
    assert pkts_p[0] == (97, pframe, True)

    # 2. Large IDR keyframe (> 2500B) -> PT=98 with 1c 80 / 1c 00 / 1c 40, marker=True only on last
    keyframe = (
        b"\x00\x00\x00\x01\x67\x42\xc0\x1e\xda\x05"
        + b"\x00\x00\x00\x01\x68\xce\x3c\x80"
        + b"\x00\x00\x00\x01\x65\x88\x84"
        + bytes(i % 251 for i in range(2800))
    )
    pkts_k = zvc.packetize_zalo_h264_annexb(keyframe, max_payload=1200, packet_mode=2)
    assert len(pkts_k) >= 3
    assert all(pt == 98 for pt, _, _ in pkts_k)
    assert pkts_k[0][1][:2] == b"\x1c\x80" and pkts_k[0][2] is False
    assert pkts_k[1][1][:2] == b"\x1c\x00" and pkts_k[1][2] is False
    assert pkts_k[-1][1][:2] == b"\x1c\x40" and pkts_k[-1][2] is True

    # 3. Small IDR keyframe (<= 1200B, e.g. placeholder) -> STILL uses PT=98 (1c 80 + 1c 40)
    small_idr = b"\x00\x00\x00\x01\x67\x42\xc0\x1e\x00\x00\x00\x01\x68\xce\x00\x00\x00\x01\x65\x88" + b"\xaa" * 100
    pkts_sk = zvc.packetize_zalo_h264_annexb(small_idr, max_payload=1200, packet_mode=2)
    assert len(pkts_sk) == 2
    assert pkts_sk[0][0] == 98 and pkts_sk[0][1][:2] == b"\x1c\x80" and pkts_sk[0][2] is False
    assert pkts_sk[1][0] == 98 and pkts_sk[1][1][:2] == b"\x1c\x40" and pkts_sk[1][2] is True

    # 4. Depacketizer reconstructs large IDR, ignores ULPFEC PT=100, and reconstructs P-frame
    dep = zvc.ZaloH264Depacketizer()
    seq = 100
    assembled = None
    for pt, pay, m in pkts_k:
        out = dep.push_rtp_packet(payload_type=pt, seq=seq, timestamp=90000, marker=m, payload=pay)
        seq += 1
        if out is not None:
            assembled = out
    assert assembled == keyframe

    # ULPFEC PT=100 must be ignored cleanly
    assert dep.push_rtp_packet(payload_type=100, seq=seq, timestamp=90000, marker=False, payload=b"\x29" * 1000) is None
    seq += 1

    # Single-packet P-frame PT=97
    out_p = dep.push_rtp_packet(payload_type=97, seq=seq, timestamp=93000, marker=True, payload=pframe)
    assert out_p == pframe


def test_depacketizer_supports_rfc6184_fallback_single_stapa_fua():
    dep = zvc.ZaloH264Depacketizer()
    sps = b"\x67\x42\xc0\x1e\xda"
    pps = b"\x68\xce\x3c\x80"
    idr = b"\x65" + bytes(i % 200 for i in range(1500))

    # STAP-A containing SPS + PPS (marker=False)
    stap_a = b"\x78" + struct.pack("!H", len(sps)) + sps + struct.pack("!H", len(pps)) + pps
    assert dep.push_rtp_packet(payload_type=97, seq=1, timestamp=180000, marker=False, payload=stap_a) is None

    # RFC 6184 FU-A fragments of IDR
    fu_ind = (idr[0] & 0xE0) | 28
    nal_type = idr[0] & 0x1F
    p1 = bytes([fu_ind, 0x80 | nal_type]) + idr[1:750]
    p2 = bytes([fu_ind, 0x40 | nal_type]) + idr[750:]
    assert dep.push_rtp_packet(payload_type=97, seq=2, timestamp=180000, marker=False, payload=p1) is None
    out = dep.push_rtp_packet(payload_type=97, seq=3, timestamp=180000, marker=True, payload=p2)
    assert out == b"\x00\x00\x00\x01" + sps + b"\x00\x00\x00\x01" + pps + b"\x00\x00\x00\x01" + idr


def test_video_rtcp_sr_rr_and_pli_feedback():
    # Without remote SSRC: exact 40-byte SR + SDES matching ZaloCall.exe media_mt15
    sr40 = zvc.build_video_rtcp_sr_rr_packet(462884481, rtp_timestamp=123456, packets_sent=12, octets_sent=9600)
    assert len(sr40) == 40
    assert sr40[0] == 0x80 and sr40[1] == 200
    assert sr40[28] == 0x81 and sr40[29] == 202

    # With remote SSRC: 64-byte SR+RR (RC=1) + SDES
    sr64 = zvc.build_video_rtcp_sr_rr_packet(
        462884481,
        rtp_timestamp=123456,
        packets_sent=12,
        octets_sent=9600,
        remote_ssrc=327635537,
        ext_highest_seq=42,
        lsr=0x11223344,
        dlsr=6553,
    )
    assert len(sr64) == 64
    assert sr64[0] == 0x81 and sr64[1] == 200
    assert struct.unpack("!I", sr64[28:32])[0] == 327635537

    # PLI (PT=206 FMT=1)
    pli = zvc.build_video_rtcp_pli_packet(462884481, 327635537)
    assert len(pli) == 12
    assert pli[0] == 0x81 and pli[1] == 206

    # Feedback parser detects both SR LSR and PLI keyframe request
    fb = zvc.parse_video_rtcp_feedback(sr40 + pli)
    assert fb["request_keyframe"] is True
    assert fb["sr_ssrc"] == 462884481
    assert fb["sr_lsr"] != 0

    # parse_zrtc_packet accepts compact 12-byte Video RTCP PLI wrapped in 5-byte msgType=15 (17B total)
    zrtc_pli = zvc.wrap_zrtc_video_rtp_packet(pli, 0x5A10C411, is_rtcp=True)
    parsed = zcs.parse_zrtc_packet(zrtc_pli)
    assert parsed is not None
    assert parsed["msg_type"] == 15
    assert parsed["token"] == 0x5A10C411
    assert parsed["rtp_payload"] == pli


def test_pyav_jpeg_to_h264_to_rtp_to_jpeg_roundtrip():
    codec_tx = zvc.ZaloVideoCodec(target_fps=12, target_bitrate=320_000)
    codec_rx = zvc.ZaloVideoCodec(target_fps=12, target_bitrate=320_000)
    dep = zvc.ZaloH264Depacketizer()
    assert codec_tx.available

    try:
        jpeg_in = _make_sample_jpeg(480, 360, seed=1)
        annexb = codec_tx.encode_jpeg_to_h264_annexb(jpeg_in, force_keyframe=True)
        assert annexb is not None and len(annexb) > 500
        has_sps, has_pps, has_idr = zvc.annexb_has_idr_or_sps(annexb)
        assert has_sps and has_pps and has_idr
        # Verify SEI (type=6) was stripped cleanly
        assert all((n[0] & 0x1F) not in (6, 9) for n in zvc.split_annexb_nals(annexb))

        # Packetize -> ZRTC msgType=13 -> Relay strips to msgType=14 -> parse -> Depacketize -> Decode JPEG
        chunks = zvc.packetize_zalo_h264_annexb(annexb, packet_mode=2)
        assert len(chunks) >= 2
        seq = 1
        reassembled = None
        for pt, pay, m in chunks:
            rtp = zvc.build_video_rtp_packet(pay, seq=seq, timestamp=90000, ssrc=327635537, payload_type=pt, marker=m)
            tx_wire = zvc.wrap_zrtc_video_rtp_packet(rtp, 0x12345678, is_rtcp=False)
            assert tx_wire[0] == 13
            # Relay strips 4B token and forwards 1B msgType=14
            rx_wire = b"\x0e" + tx_wire[5:]
            zrtc = zcs.parse_zrtc_packet(rx_wire)
            assert zrtc is not None and zrtc["msg_type"] == 14
            prtp = zcs.parse_rtp_packet(zrtc["rtp_payload"])
            assert prtp is not None
            out = dep.push_rtp_packet(
                payload_type=prtp["payload_type"],
                seq=prtp["seq"],
                timestamp=prtp["timestamp"],
                marker=prtp["marker"],
                payload=prtp["payload"],
            )
            seq += 1
            if out is not None:
                reassembled = out

        assert reassembled == annexb
        jpeg_out = codec_rx.decode_h264_annexb_to_jpeg(reassembled)
        assert jpeg_out is not None and len(jpeg_out) > 500
        assert jpeg_out[:2] == b"\xff\xd8"  # Valid JPEG SOI marker
    finally:
        codec_tx.close()
        codec_rx.close()


def test_placeholder_h264_keyframe_when_camera_muted_or_absent():
    codec_tx = zvc.ZaloVideoCodec()
    codec_rx = zvc.ZaloVideoCodec()
    try:
        annexb = codec_tx.encode_placeholder_h264_annexb(force_keyframe=True)
        assert annexb is not None and len(annexb) > 50
        has_sps, has_pps, has_idr = zvc.annexb_has_idr_or_sps(annexb)
        assert has_sps and has_pps and has_idr
        chunks = zvc.packetize_zalo_h264_annexb(annexb, packet_mode=2)
        assert all(pt == 98 for pt, _, _ in chunks)
        jpeg_out = codec_rx.decode_h264_annexb_to_jpeg(annexb)
        assert jpeg_out is not None and jpeg_out[:2] == b"\xff\xd8"
    finally:
        codec_tx.close()
        codec_rx.close()


class _CaptureUdpTransport:
    def __init__(self) -> None:
        self.sent: list[tuple[bytes, tuple[str, int]]] = []
        self.closed = False

    def sendto(self, data: bytes, addr: tuple[str, int]) -> None:
        self.sent.append((data, addr))

    def close(self) -> None:
        self.closed = True


class _CaptureWs:
    def __init__(self) -> None:
        self.binary: list[bytes] = []
        self.texts: list[str] = []

    async def send_bytes(self, data: bytes) -> None:
        self.binary.append(data)

    async def send_text(self, text: str) -> None:
        self.texts.append(text)


def test_audio_call_strictly_isolated_zero_video_packets_or_bridge():
    """Voice Call (call_type=1) MUST NEVER instantiate _video_bridge or send msgType=13/15."""
    udp = _CaptureUdpTransport()
    sess = zcs.ZaloCallSession(
        session_id="voice_iso_1",
        account_id="acc1",
        call_id=90001,
        callee_id="u2",
        call_type=1,
        status="connected",
        ssrc=462884481,
        zalo_from_id=462884481,
        zrtc_token=0x5A10C411,
        remote_rtp_addr=("127.0.0.1", 4200),
        udp_transport=udp,  # type: ignore[arg-type]
    )
    assert sess.is_video_call is False
    sess.send_video_from_browser(_make_sample_jpeg(320, 240))
    sess.tick_video_keepalive(0)
    zcs._send_udp_keepalive_tick(sess, tick_idx=0, send_rtp=True)

    proto = zcs._ZaloRtpDatagramProtocol(sess)
    # Feed incoming video RTP (msgType=14) and video RTCP (msgType=15)
    vid_rtp = zvc.build_video_rtp_packet(b"\x00\x00\x00\x01\x41\x9a", seq=1, timestamp=90000, ssrc=327635537, payload_type=97, marker=True)
    proto.datagram_received(b"\x0e" + vid_rtp, ("127.0.0.1", 4200))
    proto.datagram_received(zvc.wrap_zrtc_video_rtp_packet(zvc.build_video_rtcp_pli_packet(327635537, 462884481), 0x5A10C411, is_rtcp=True), ("127.0.0.1", 4200))

    assert sess._video_bridge is None
    assert sess.packets_received == 0
    assert sess.to_dict()["codec"] == "Opus/PCM16"
    assert sess.to_dict()["video_packets_sent"] == 0
    assert all(pkt[0] not in (13, 15) for pkt, _ in udp.sent)


def test_video_call_session_full_bidirectional_rtp_rtcp_with_mock_relay():
    async def _run() -> None:
        udp = _CaptureUdpTransport()
        ws = _CaptureWs()
        sess = zcs.ZaloCallSession(
            session_id="vid_e2e_1",
            account_id="acc1",
            call_id=90002,
            callee_id="u2",
            call_type=3,
            status="connected",
            ssrc=462884481,
            zalo_from_id=462884481,
            zrtc_token=0x5A10C411,
            remote_rtp_addr=("127.0.0.1", 4200),
            udp_transport=udp,  # type: ignore[arg-type]
        )
        sess.ws_clients.add(ws)  # type: ignore[arg-type]
        assert sess.is_video_call is True
        assert sess.to_dict()["codec"] == "Opus/H264"

        try:
            # 1. Browser sends webcam JPEG -> Backend encodes H.264 -> sends msgType=13 to Relay
            sample_jpg = _make_sample_jpeg(480, 360, seed=2)
            sess.send_video_from_browser(sample_jpg)
            sess.tick_video_keepalive(0)
            await asyncio.sleep(0.25)

            mt13_pkts = [pkt for pkt, _ in udp.sent if pkt[0] == 13]
            mt15_pkts = [pkt for pkt, _ in udp.sent if pkt[0] == 15]
            assert len(mt13_pkts) >= 2, f"Expected >=2 Video RTP msgType=13 packets, got {len(mt13_pkts)}"
            assert len(mt15_pkts) >= 1, f"Expected >=1 Video RTCP msgType=15 packets, got {len(mt15_pkts)}"

            # 2. Simulate Callee sending PLI on msgType=15 -> must arm force_keyframe
            proto = zcs._ZaloRtpDatagramProtocol(sess)
            pli = zvc.build_video_rtcp_pli_packet(327635537, 462884481)
            proto.datagram_received(zvc.wrap_zrtc_video_rtp_packet(pli, 0x5A10C411, is_rtcp=True), ("127.0.0.1", 4200))
            assert sess._video_bridge is not None
            assert sess._video_bridge.force_keyframe is True

            # 3. Simulate Callee sending Video RTP (msgType=14) + ULPFEC (PT=100) + 1 Audio Opus (msgType=4)
            # Reuse our own valid H.264 keyframe packets rewritten with callee SSRC=327635537!
            for pkt in mt13_pkts:
                rtp_ba = bytearray(pkt[5:])
                struct.pack_into("!I", rtp_ba, 8, 327635537)
                proto.datagram_received(b"\x0e" + bytes(rtp_ba), ("127.0.0.1", 4200))

            # Noise ULPFEC PT=100
            fec_rtp = zvc.build_video_rtp_packet(b"\x29" * 400, seq=999, timestamp=90000, ssrc=327635537, payload_type=100, marker=False)
            proto.datagram_received(b"\x0e" + fec_rtp, ("127.0.0.1", 4200))

            # 1 Audio Opus packet (msgType=4) -> MUST increment audio packets_received to EXACTLY 1!
            opus_pay = sess._opus_codec.encode_pcm16_frame(b"\x00" * 640)
            aud_rtp = zcs.build_rtp_packet(opus_pay, seq=1, timestamp=320, ssrc=327635537, payload_type=112)
            proto.datagram_received(b"\x04" + aud_rtp, ("127.0.0.1", 4200))

            await asyncio.sleep(0.25)

            # Verify Audio counter untouched by video packets!
            assert sess.packets_received == 1
            d = sess.to_dict()
            assert d["video_packets_sent"] >= 2
            assert d["video_packets_received"] >= 2
            assert d["video_frames_sent"] >= 1
            assert d["video_frames_received"] >= 1

            # Verify Browser WS received BOTH VFRM JPEG AND raw Audio PCM16!
            vfrm_chunks = [b for b in ws.binary if b.startswith(zvc.WS_VIDEO_RX_MAGIC)]
            audio_chunks = [b for b in ws.binary if not b.startswith(zvc.WS_VIDEO_RX_MAGIC)]
            assert len(vfrm_chunks) >= 1 and vfrm_chunks[0][4:6] == b"\xff\xd8"
            assert len(audio_chunks) == 1 and len(audio_chunks[0]) > 0
        finally:
            sess.close_media(send_zrtc_end=False)
            assert sess._video_bridge is None

    asyncio.run(_run())
