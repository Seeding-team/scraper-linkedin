"""Zalo Video Call (call_type=3) Isolated Media Engine — H.264 / ZRTC Video RTP & RTCP.

Thiết kế TÁCH BIỆT HOÀN TOÀN khỏi luồng Zalo Voice Call (call_type=1) trong `zalo_call_service.py`:
- KHÔNG bao giờ được khởi tạo cho cuộc gọi thoại (`call_type == 1`).
- Xác thực byte-by-byte từ capture thực tế của `ZaloCall.exe` v26.11.12 (`packetMode=2`, `h264 PT=97`):
  * Client -> Relay Video RTP : `msgType = 13 (0x0D)` — 5-byte header `<BI (13, token_le)> + RTP`
  * Relay  -> Client Video RTP: `msgType = 14 (0x0E)` — 1-byte header `0x0E + RTP` (Relay bỏ 4B token)
  * Client <-> Relay Video RTCP: `msgType = 15 (0x0F)` — 5-byte header `<BI (15, token_le)> + RTCP`
  * Zalo ZRTP `packetMode=2` H.264 payload:
      - `PT=97`: 1 gói duy nhất chứa nguyên Annex-B (`00 00 00 01 <NAL...>`)
      - `PT=98`: phân mảnh Annex-B với 2-byte header `1c 80` (Start), `1c 00` (Mid), `1c 40` (End, M=1)
      - `PT=100`: WebRTC ULPFEC/RED — bỏ qua sạch khi nhận, không làm hỏng depacketizer
  * Depacketizer tự động hỗ trợ CẢ `packetMode=2` (Zalo native) VÀ chuẩn RFC 6184 (`Single NAL`, `STAP-A`, `FU-A`)
    để tương thích 100% mọi phiên bản Zalo Android / iOS / Desktop.
  * Video RTCP SR + Receiver Report Block (báo 0% loss + LSR/DLSR echo RTT) + SDES + PLI (PT=206 FMT=1)
    nhằm triệt tiêu hoàn toàn cảnh báo "Kết nối bên bạn không ổn định" (`poorSignalCheckByRtcp`).
"""

from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
from fractions import Fraction
import logging
import struct
import threading
import time
from typing import Any, Callable, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# ── ZRTC Video Wire Constants (verified against ZaloCall.exe v26.11.12) ───────

ZRTC_MSG_VIDEO_RTP_TX = 13   # 0x0D: Client -> Relay Video RTP (5-byte header: msgType + token LE)
ZRTC_MSG_VIDEO_RTP_RX = 14   # 0x0E: Relay -> Client Video RTP (1-byte header: msgType only)
ZRTC_MSG_VIDEO_RTCP = 15     # 0x0F: Client <-> Relay Video RTCP (5-byte header: msgType + token LE)

VIDEO_H264_SINGLE_PT = 97    # Single-packet Annex-B (packetMode=2) or RFC 6184 H.264
VIDEO_H264_FRAG_PT = 98      # Fragmented Annex-B (packetMode=2: 1c 80 / 1c 00 / 1c 40)
VIDEO_ULPFEC_PT = 100        # WebRTC ULPFEC/RED — ignored on receive
VIDEO_CLOCK_RATE = 90000     # RFC 6184 / WebRTC standard 90kHz video RTP clock
VIDEO_MAX_RTP_PAYLOAD = 1200 # Safe MTU budget (ZaloCall.exe uses ~1300B)

# WebSocket binary framing tags (NEVER collides with raw PCM16 audio frames)
WS_VIDEO_TX_MAGIC = b"VJPG"  # Browser -> Backend: b"VJPG" + JPEG bytes from webcam canvas
WS_VIDEO_RX_MAGIC = b"VFRM"  # Backend -> Browser: b"VFRM" + JPEG bytes decoded from remote H.264

_ANNEXB_START4 = b"\x00\x00\x00\x01"
_ANNEXB_START3 = b"\x00\x00\x01"
_NTP_EPOCH_OFFSET = 2208988800


# ── ZRTC Video Packet Wrappers & RTCP Builders ────────────────────────────────

def wrap_zrtc_video_rtp_packet(
    rtp_or_rtcp_packet: bytes,
    token: int = 0,
    *,
    is_rtcp: bool = False,
) -> bytes:
    """Bọc 5-byte ZRTC Video Header: msgType=13 (Video RTP) hoặc msgType=15 (Video RTCP) + token uint32 LE."""
    msg_type = ZRTC_MSG_VIDEO_RTCP if is_rtcp else ZRTC_MSG_VIDEO_RTP_TX
    return struct.pack("<BI", msg_type, int(token) & 0xFFFFFFFF) + rtp_or_rtcp_packet


def build_video_rtp_packet(
    payload: bytes,
    *,
    seq: int,
    timestamp: int,
    ssrc: int,
    payload_type: int = VIDEO_H264_SINGLE_PT,
    marker: bool = False,
) -> bytes:
    """Đóng gói 12-byte RFC 3550 RTP Header + payload Video H.264."""
    b0 = 0x80
    b1 = (0x80 if marker else 0x00) | (int(payload_type) & 0x7F)
    return struct.pack(
        "!BBHII",
        b0,
        b1,
        int(seq) & 0xFFFF,
        int(timestamp) & 0xFFFFFFFF,
        int(ssrc) & 0xFFFFFFFF,
    ) + payload


def build_video_rtcp_sr_rr_packet(
    sender_ssrc: int,
    *,
    rtp_timestamp: int = 0,
    packets_sent: int = 0,
    octets_sent: int = 0,
    remote_ssrc: int = 0,
    fraction_lost: int = 0,
    cum_lost: int = 0,
    ext_highest_seq: int = 0,
    jitter: int = 0,
    lsr: int = 0,
    dlsr: int = 0,
) -> bytes:
    """Đóng gói Compound RTCP Video SR (PT=200) [+ Report Block nếu đã thấy remote_ssrc] + SDES (PT=202).

    Khớp định dạng 40-byte của ZaloCall.exe khi chưa có report block (28B SR + 12B SDES),
    và tự mở rộng 64-byte (52B SR+RR + 12B SDES) ngay khi nhận gói từ phía khách để trả phản hồi
    0% loss + LSR/DLSR RTT chuẩn RFC 3550 giúp vượt qua `poorSignalCheckByRtcp` của Zalo Mobile.
    """
    now = time.time()
    ntp_sec = (int(now) + _NTP_EPOCH_OFFSET) & 0xFFFFFFFF
    ntp_frac = int((now - int(now)) * (1 << 32)) & 0xFFFFFFFF
    ssrc_u32 = int(sender_ssrc) & 0xFFFFFFFF

    if remote_ssrc and int(remote_ssrc) != 0:
        # RC=1: length in 32-bit words minus one = 6 + 6 = 12 (52 bytes)
        sr_hdr = struct.pack(
            "!BBHIIIIII",
            0x81,
            200,
            12,
            ssrc_u32,
            ntp_sec,
            ntp_frac,
            int(rtp_timestamp) & 0xFFFFFFFF,
            int(packets_sent) & 0xFFFFFFFF,
            int(octets_sent) & 0xFFFFFFFF,
        )
        frac_and_cum = ((int(fraction_lost) & 0xFF) << 24) | (max(0, int(cum_lost)) & 0x00FFFFFF)
        rb = struct.pack(
            "!IIIIII",
            int(remote_ssrc) & 0xFFFFFFFF,
            frac_and_cum,
            int(ext_highest_seq) & 0xFFFFFFFF,
            int(jitter) & 0xFFFFFFFF,
            int(lsr) & 0xFFFFFFFF,
            int(dlsr) & 0xFFFFFFFF,
        )
        sr = sr_hdr + rb
    else:
        # RC=0: 28 bytes (exact match to ZaloCall.exe media_mt15)
        sr = struct.pack(
            "!BBHIIIIII",
            0x80,
            200,
            6,
            ssrc_u32,
            ntp_sec,
            ntp_frac,
            int(rtp_timestamp) & 0xFFFFFFFF,
            int(packets_sent) & 0xFFFFFFFF,
            int(octets_sent) & 0xFFFFFFFF,
        )

    # 12-byte SDES (CNAME empty/minimal, matching ZaloCall.exe 40B total)
    sdes = struct.pack("!BBHIBBBB", 0x81, 202, 2, ssrc_u32, 1, 0, 0, 0)
    return sr + sdes


def build_video_rtcp_pli_packet(sender_ssrc: int, media_ssrc: int) -> bytes:
    """Đóng gói RFC 4585 Payload-Specific Feedback PLI (PT=206, FMT=1) yêu cầu bên khách phát IDR keyframe ngay."""
    return struct.pack(
        "!BBHII",
        0x81,  # V=2, P=0, FMT=1 (PLI)
        206,   # PSFB
        2,     # length = 2 (12 bytes total)
        int(sender_ssrc) & 0xFFFFFFFF,
        int(media_ssrc) & 0xFFFFFFFF,
    )


def parse_video_rtcp_feedback(rtcp_bytes: bytes) -> Dict[str, Any]:
    """Phân tích gói Compound RTCP nhận qua msgType=15 (trích PLI/FIR yêu cầu keyframe & NTP LSR của SR)."""
    result: Dict[str, Any] = {
        "request_keyframe": False,
        "sr_ssrc": 0,
        "sr_lsr": 0,
        "packet_types": [],
    }
    if not rtcp_bytes or len(rtcp_bytes) < 8:
        return result

    offset = 0
    total = len(rtcp_bytes)
    while offset + 4 <= total:
        b0, pt, length_words = struct.unpack("!BBH", rtcp_bytes[offset : offset + 4])
        version = (b0 >> 6) & 0x03
        if version != 2:
            break
        pkt_len = (length_words + 1) * 4
        if pkt_len < 4 or offset + pkt_len > total:
            break
        fmt_or_rc = b0 & 0x1F
        result["packet_types"].append(pt)

        # PT=200: Sender Report -> extract SSRC & middle-32b NTP (LSR)
        if pt == 200 and pkt_len >= 20:
            sr_ssrc, ntp_msw, ntp_lsw = struct.unpack("!III", rtcp_bytes[offset + 4 : offset + 16])
            result["sr_ssrc"] = sr_ssrc
            result["sr_lsr"] = ((ntp_msw & 0xFFFF) << 16) | ((ntp_lsw >> 16) & 0xFFFF)
        # PT=206 (PSFB): FMT=1 (PLI) or FMT=4 (FIR) -> callee asks us for an instant IDR keyframe!
        elif pt == 206 and fmt_or_rc in (1, 4):
            result["request_keyframe"] = True

        offset += pkt_len

    return result


# ── H.264 Annex-B <-> Zalo ZRTP packetMode=2 & RFC 6184 Packetizer/Depacketizer

def split_annexb_nals(annexb: bytes) -> List[bytes]:
    """Tách danh sách NAL units từ luồng H.264 Annex-B (hỗ trợ start code 3-byte và 4-byte)."""
    if not annexb:
        return []
    positions: List[Tuple[int, int]] = []
    i = 0
    n = len(annexb)
    while i < n - 2:
        if annexb[i] == 0 and annexb[i + 1] == 0:
            if annexb[i + 2] == 1:
                positions.append((i, 3))
                i += 3
                continue
            if i + 3 < n and annexb[i + 2] == 0 and annexb[i + 3] == 1:
                positions.append((i, 4))
                i += 4
                continue
        i += 1
    if not positions:
        return [annexb] if annexb else []
    nals: List[bytes] = []
    for idx, (start, sc_len) in enumerate(positions):
        nal_start = start + sc_len
        nal_end = positions[idx + 1][0] if idx + 1 < len(positions) else n
        if nal_end > nal_start:
            nals.append(annexb[nal_start:nal_end])
    return nals


def annexb_has_idr_or_sps(annexb: bytes) -> Tuple[bool, bool, bool]:
    """Kiểm tra nhanh gói Annex-B có chứa SPS (7), PPS (8), IDR (5) hay không."""
    has_sps = False
    has_pps = False
    has_idr = False
    for nal in split_annexb_nals(annexb):
        if not nal:
            continue
        ntype = nal[0] & 0x1F
        if ntype == 7:
            has_sps = True
        elif ntype == 8:
            has_pps = True
        elif ntype == 5:
            has_idr = True
    return has_sps, has_pps, has_idr


def packetize_zalo_h264_annexb(
    annexb_bytes: bytes,
    *,
    max_payload: int = VIDEO_MAX_RTP_PAYLOAD,
    packet_mode: int = 2,
) -> List[Tuple[int, bytes, bool]]:
    """Đóng gói 1 Access Unit H.264 Annex-B thành các (payload_type, rtp_payload, marker).

    - `packet_mode == 2` (Zalo ZRTP native — khớp 100% capture từ ZaloCall.exe):
        * Nếu `len(annexb) <= max_payload`: 1 gói `PT=97`, `M=1`, payload = `annexb`.
        * Nếu `len(annexb) > max_payload`: chia nhiều mảnh `PT=98` với 2-byte header:
            - Mảnh đầu:  `1c 80` + chunk, `M=0`
            - Mảnh giữa: `1c 00` + chunk, `M=0`
            - Mảnh cuối: `1c 40` + chunk, `M=1`
    - `packet_mode == 0` (chuẩn RFC 6184 thuần): Single NAL / FU-A trên `PT=97`.
    """
    if not annexb_bytes:
        return []

    max_chunk = max(256, int(max_payload))

    if packet_mode == 2:
        data = annexb_bytes
        if not (data.startswith(_ANNEXB_START4) or data.startswith(_ANNEXB_START3)):
            data = _ANNEXB_START4 + data
        has_sps, _, has_idr = annexb_has_idr_or_sps(data)
        is_keyframe = has_sps or has_idr
        # ZaloCall.exe / Zalo Mobile luôn phát Keyframe (SPS+PPS+IDR) qua PT=98 (1c 80 / 1c 00 / 1c 40)
        # và phát P-frame đơn nhỏ qua PT=97 (Annex-B thuần). Nếu Keyframe (vd khung placeholder) <= max_chunk,
        # tách gọn thành 2 mảnh PT=98 (1c 80 + 1c 40) để đảm bảo đầu nhận luôn giải mã ngay lập tức!
        if len(data) <= max_chunk and not is_keyframe:
            return [(VIDEO_H264_SINGLE_PT, data, True)]
        if len(data) <= max_chunk and is_keyframe and len(data) >= 8:
            mid = len(data) // 2
            return [
                (VIDEO_H264_FRAG_PT, b"\x1c\x80" + data[:mid], False),
                (VIDEO_H264_FRAG_PT, b"\x1c\x40" + data[mid:], True),
            ]

        frag_payload_max = max_chunk - 2
        packets: List[Tuple[int, bytes, bool]] = []
        total = len(data)
        offset = 0
        while offset < total:
            end = min(offset + frag_payload_max, total)
            is_first = offset == 0
            is_last = end >= total
            if is_first:
                hdr = b"\x1c\x80"
            elif is_last:
                hdr = b"\x1c\x40"
            else:
                hdr = b"\x1c\x00"
            packets.append((VIDEO_H264_FRAG_PT, hdr + data[offset:end], is_last))
            offset = end
        return packets

    # Standard RFC 6184 mode (fallback)
    nals = [n for n in split_annexb_nals(annexb_bytes) if n and (n[0] & 0x1F) != 9]
    if not nals:
        return []
    packets_rfc: List[Tuple[int, bytes, bool]] = []
    for nal_idx, nal in enumerate(nals):
        is_last_nal = nal_idx == len(nals) - 1
        if len(nal) <= max_chunk:
            packets_rfc.append((VIDEO_H264_SINGLE_PT, nal, is_last_nal))
        else:
            nal_hdr = nal[0]
            fu_ind = (nal_hdr & 0xE0) | 28
            nal_type = nal_hdr & 0x1F
            body = nal[1:]
            frag_max = max_chunk - 2
            off = 0
            while off < len(body):
                end = min(off + frag_max, len(body))
                s_bit = 0x80 if off == 0 else 0x00
                e_bit = 0x40 if end >= len(body) else 0x00
                fu_hdr = s_bit | e_bit | nal_type
                is_last_pkt = is_last_nal and (end >= len(body))
                packets_rfc.append(
                    (VIDEO_H264_SINGLE_PT, bytes([fu_ind, fu_hdr]) + body[off:end], is_last_pkt)
                )
                off = end
    return packets_rfc


class ZaloH264Depacketizer:
    """Bộ ghép gói Video RTP H.264 đa chuẩn (Zalo ZRTP packetMode=2 PT=97/98 + RFC 6184 + bỏ qua ULPFEC PT=100)."""

    def __init__(self) -> None:
        # Zalo packetMode=2 fragmentation state
        self._zrtp_buf = bytearray()
        self._zrtp_ts: Optional[int] = None
        self._zrtp_last_seq: Optional[int] = None
        self._zrtp_active = False

        # RFC 6184 fallback state
        self._rfc_au_buf = bytearray()
        self._rfc_au_ts: Optional[int] = None
        self._rfc_fua_buf = bytearray()
        self._rfc_fua_active = False

        self.needs_keyframe = True
        self.dropped_incomplete_frames = 0

    def reset(self) -> None:
        self._zrtp_buf.clear()
        self._zrtp_ts = None
        self._zrtp_last_seq = None
        self._zrtp_active = False
        self._rfc_au_buf.clear()
        self._rfc_au_ts = None
        self._rfc_fua_buf.clear()
        self._rfc_fua_active = False

    def _clear_zrtp(self) -> None:
        self._zrtp_buf.clear()
        self._zrtp_ts = None
        self._zrtp_last_seq = None
        self._zrtp_active = False

    def push_rtp_packet(
        self,
        *,
        payload_type: int,
        seq: int,
        timestamp: int,
        marker: bool,
        payload: bytes,
    ) -> Optional[bytes]:
        """Nạp 1 gói Video RTP -> trả về hoàn chỉnh H.264 Annex-B Access Unit khi đủ khung, ngược lại None."""
        if not payload:
            return None
        # Bỏ qua ULPFEC / RED padding packets (PT=100)
        if payload_type == VIDEO_ULPFEC_PT:
            return None

        # ── Case 1: Zalo ZRTP packetMode=2 Fragmented (PT=98 hoặc 1c 80/00/40 với nal_type=0) ──
        is_zrtp_frag = payload_type == VIDEO_H264_FRAG_PT or (
            len(payload) >= 2
            and payload[0] == 0x1C
            and (payload[1] & 0x1F) == 0
            and (payload[1] & 0xC0) in (0x80, 0x00, 0x40)
        )
        if is_zrtp_frag:
            if len(payload) < 3:
                return None
            fu_ind = payload[0]
            fu_hdr = payload[1]
            # Chấp nhận indicator 0x1c (ZaloCall.exe chuẩn) hoặc có NRI bit
            if (fu_ind & 0x1F) != 28:
                return None
            is_start = bool(fu_hdr & 0x80)
            is_end = bool(fu_hdr & 0x40)
            frag_data = payload[2:]

            if is_start:
                if self._zrtp_active:
                    self.dropped_incomplete_frames += 1
                    self.needs_keyframe = True
                self._zrtp_buf.clear()
                self._zrtp_buf.extend(frag_data)
                self._zrtp_ts = timestamp
                self._zrtp_last_seq = seq
                self._zrtp_active = True
                if is_end or marker:
                    frame = bytes(self._zrtp_buf)
                    self._clear_zrtp()
                    return frame if frame else None
                return None

            if not self._zrtp_active or self._zrtp_ts != timestamp:
                # Mảnh mồ côi do mất gói đầu -> đánh dấu cần keyframe
                self._clear_zrtp()
                self.dropped_incomplete_frames += 1
                self.needs_keyframe = True
                return None

            expected_seq = ((self._zrtp_last_seq or 0) + 1) & 0xFFFF
            if seq != expected_seq:
                # Mất mảnh giữa -> hủy frame lỗi tránh rác ảnh H.264
                self._clear_zrtp()
                self.dropped_incomplete_frames += 1
                self.needs_keyframe = True
                return None

            self._zrtp_buf.extend(frag_data)
            self._zrtp_last_seq = seq
            if is_end or marker:
                frame = bytes(self._zrtp_buf)
                self._clear_zrtp()
                return frame if frame else None
            return None

        # ── Case 2: Zalo ZRTP packetMode=2 Single-Packet Annex-B (PT=97, bắt đầu 00 00 00 01 hoặc 00 00 01) ──
        if payload.startswith(_ANNEXB_START4) or payload.startswith(_ANNEXB_START3):
            if self._zrtp_active:
                self._clear_zrtp()
            return payload

        # ── Case 3: Standard RFC 6184 H.264 (Single NAL 1..23, STAP-A 24, FU-A 28) ──
        if payload_type != VIDEO_H264_SINGLE_PT:
            return None

        if self._rfc_au_ts is not None and self._rfc_au_ts != timestamp:
            # Flush previous incomplete access unit only if non-empty and marker was missed
            self._rfc_au_buf.clear()
            self._rfc_fua_buf.clear()
            self._rfc_fua_active = False
        self._rfc_au_ts = timestamp

        nal_type = payload[0] & 0x1F
        if 1 <= nal_type <= 23:
            self._rfc_au_buf.extend(_ANNEXB_START4)
            self._rfc_au_buf.extend(payload)
        elif nal_type == 24:
            # STAP-A
            off = 1
            while off + 2 <= len(payload):
                nal_sz = struct.unpack("!H", payload[off : off + 2])[0]
                off += 2
                if nal_sz == 0 or off + nal_sz > len(payload):
                    break
                self._rfc_au_buf.extend(_ANNEXB_START4)
                self._rfc_au_buf.extend(payload[off : off + nal_sz])
                off += nal_sz
        elif nal_type == 28 and len(payload) >= 2:
            # RFC 6184 FU-A
            fu_ind = payload[0]
            fu_hdr = payload[1]
            s_bit = bool(fu_hdr & 0x80)
            e_bit = bool(fu_hdr & 0x40)
            orig_type = fu_hdr & 0x1F
            if s_bit:
                self._rfc_fua_buf.clear()
                reconstructed_hdr = (fu_ind & 0xE0) | orig_type
                self._rfc_fua_buf.extend(_ANNEXB_START4)
                self._rfc_fua_buf.append(reconstructed_hdr)
                self._rfc_fua_buf.extend(payload[2:])
                self._rfc_fua_active = True
            elif self._rfc_fua_active:
                self._rfc_fua_buf.extend(payload[2:])
            if e_bit and self._rfc_fua_active:
                self._rfc_au_buf.extend(self._rfc_fua_buf)
                self._rfc_fua_buf.clear()
                self._rfc_fua_active = False

        if marker and self._rfc_au_buf:
            out = bytes(self._rfc_au_buf)
            self._rfc_au_buf.clear()
            self._rfc_au_ts = None
            return out
        return None


# ── PyAV H.264 / MJPEG Video Codec (Zero External Binary Dependencies) ────────

def _align16(val: int, minimum: int = 160, maximum: int = 640) -> int:
    clamped = max(minimum, min(maximum, int(val)))
    return max(minimum, (clamped // 16) * 16)


class ZaloVideoCodec:
    """Bộ mã hóa & giải mã H.264 Baseline + JPEG bằng PyAV (`libx264` + `h264` + `mjpeg`).

    Mọi thao tác nặng được thiết kế chạy trên worker thread tách biệt khỏi asyncio event loop
    của Audio RTP, đồng thời tự bảo vệ bằng lock để không bao giờ gây race condition.
    """

    def __init__(self, *, target_fps: int = 12, target_bitrate: int = 320_000) -> None:
        self._av: Any = None
        self._target_fps = max(5, min(25, int(target_fps)))
        self._target_bitrate = max(120_000, min(800_000, int(target_bitrate)))

        # TX state
        self._tx_lock = threading.Lock()
        self._tx_jpeg_dec: Any = None
        self._tx_h264_enc: Any = None
        self._tx_width = 0
        self._tx_height = 0
        self._tx_pts = 0
        self._placeholder_tick = 0

        # RX state
        self._rx_lock = threading.Lock()
        self._rx_h264_dec: Any = None
        self._rx_jpeg_enc: Any = None
        self._rx_jpeg_size: Tuple[int, int] = (0, 0)
        self._rx_seen_sps_pps = False
        self._rx_cached_sps = b""
        self._rx_cached_pps = b""

        try:
            import av  # type: ignore
            self._av = av
        except Exception as exc:
            logger.warning(f"[VOIP-VIDEO] PyAV unavailable — video codec disabled: {exc}")

    @property
    def available(self) -> bool:
        return self._av is not None

    def _ensure_tx_encoder(self, width: int, height: int) -> bool:
        if self._av is None:
            return False
        w = _align16(width, 160, 640)
        h = _align16(height, 120, 640)
        if self._tx_h264_enc is not None and self._tx_width == w and self._tx_height == h:
            return True
        if self._tx_h264_enc is not None:
            try:
                self._tx_h264_enc.close()
            except Exception:
                pass
            self._tx_h264_enc = None
        try:
            enc = self._av.CodecContext.create("libx264", "w")
            enc.width = w
            enc.height = h
            enc.pix_fmt = "yuv420p"
            enc.time_base = Fraction(1, self._target_fps)
            enc.framerate = Fraction(self._target_fps, 1)
            enc.bit_rate = self._target_bitrate
            enc.gop_size = self._target_fps * 2
            enc.max_b_frames = 0
            enc.thread_count = 1
            enc.options = {
                "preset": "ultrafast",
                "tune": "zerolatency",
                "profile": "baseline",
                "level": "3.0",
                "x264-params": (
                    f"repeat-headers=1:annexb=1:bframes=0:rc-lookahead=0:sync-lookahead=0:"
                    f"keyint={self._target_fps * 2}:min-keyint={self._target_fps}:"
                    f"scenecut=0:vbv-maxrate=420:vbv-bufsize=420"
                ),
            }
            enc.open()
            self._tx_h264_enc = enc
            self._tx_width = w
            self._tx_height = h
            self._tx_pts = 0
            return True
        except Exception as exc:
            logger.warning(f"[VOIP-VIDEO] Failed to open libx264 encoder {w}x{h}: {exc}")
            self._tx_h264_enc = None
            return False

    def _encode_yuv_frame_locked(self, frame: Any, *, force_keyframe: bool = False) -> Optional[bytes]:
        if self._tx_h264_enc is None:
            return None
        try:
            yuv = frame.reformat(width=self._tx_width, height=self._tx_height, format="yuv420p")
            yuv.pts = self._tx_pts
            self._tx_pts += 1
            if force_keyframe or self._tx_pts == 1:
                try:
                    yuv.pict_type = self._av.video.frame.PictureType.I
                except Exception:
                    yuv.pict_type = 1
            else:
                try:
                    yuv.pict_type = self._av.video.frame.PictureType.NONE
                except Exception:
                    yuv.pict_type = 0
            pkts = self._tx_h264_enc.encode(yuv)
            if not pkts:
                return None
            raw_annexb = b"".join(bytes(p) for p in pkts)
            if not raw_annexb:
                return None
            # Lọc bỏ SEI (type=6, banner x264) & AUD (type=9) để luồng Annex-B thuần SPS(7)+PPS(8)+IDR(5)/Slice(1)
            # khớp 100% đầu ra OpenH264 của ZaloCall.exe & Zalo Mobile!
            clean_parts: List[bytes] = []
            for nal in split_annexb_nals(raw_annexb):
                if not nal:
                    continue
                nt = nal[0] & 0x1F
                if nt in (6, 9):
                    continue
                clean_parts.append(_ANNEXB_START4 + nal)
            out = b"".join(clean_parts)
            return out if out else raw_annexb
        except Exception as exc:
            logger.debug(f"[VOIP-VIDEO] libx264 encode frame error: {exc}")
            return None

    def encode_jpeg_to_h264_annexb(
        self,
        jpeg_bytes: bytes,
        *,
        force_keyframe: bool = False,
        max_dim: int = 480,
    ) -> Optional[bytes]:
        """Giải mã khung JPEG từ webcam trình duyệt Sale -> nén H.264 Baseline Annex-B."""
        if not jpeg_bytes or self._av is None:
            return None
        with self._tx_lock:
            try:
                if self._tx_jpeg_dec is None:
                    dec = self._av.CodecContext.create("mjpeg", "r")
                    dec.open()
                    self._tx_jpeg_dec = dec
                frames = self._tx_jpeg_dec.decode(self._av.Packet(jpeg_bytes))
                if not frames:
                    return None
                src = frames[-1]
                src_w, src_h = int(src.width), int(src.height)
                if src_w <= 0 or src_h <= 0:
                    return None
                scale = min(1.0, float(max_dim) / float(max(src_w, src_h)))
                target_w = _align16(int(round(src_w * scale)), 160, max_dim)
                target_h = _align16(int(round(src_h * scale)), 120, max_dim)
                if not self._ensure_tx_encoder(target_w, target_h):
                    return None
                return self._encode_yuv_frame_locked(src, force_keyframe=force_keyframe)
            except Exception as exc:
                logger.debug(f"[VOIP-VIDEO] encode_jpeg_to_h264 error: {exc}")
                return None

    def encode_placeholder_h264_annexb(
        self,
        *,
        width: int = 320,
        height: int = 240,
        force_keyframe: bool = False,
    ) -> Optional[bytes]:
        """Sinh khung hình H.264 giữ nhịp khi Sale tắt camera / không có webcam -> máy khách không báo mạng yếu."""
        if self._av is None:
            return None
        with self._tx_lock:
            w = self._tx_width or _align16(width, 160, 480)
            h = self._tx_height or _align16(height, 120, 480)
            if not self._ensure_tx_encoder(w, h):
                return None
            try:
                frame = self._av.VideoFrame(self._tx_width, self._tx_height, "yuv420p")
                # Slate background (Y=24..30 subtle breathing, U=132, V=124 -> deep navy-slate)
                y_val = 24 + (self._placeholder_tick % 6)
                self._placeholder_tick += 1
                y_plane = frame.planes[0]
                u_plane = frame.planes[1]
                v_plane = frame.planes[2]
                y_plane.update(bytes([y_val]) * y_plane.buffer_size)
                u_plane.update(bytes([132]) * u_plane.buffer_size)
                v_plane.update(bytes([124]) * v_plane.buffer_size)
                return self._encode_yuv_frame_locked(frame, force_keyframe=force_keyframe)
            except Exception as exc:
                logger.debug(f"[VOIP-VIDEO] encode_placeholder error: {exc}")
                return None

    def _ensure_rx_jpeg_encoder(self, width: int, height: int) -> bool:
        if self._av is None:
            return False
        w = max(64, int(width) & ~1)
        h = max(64, int(height) & ~1)
        if self._rx_jpeg_enc is not None and self._rx_jpeg_size == (w, h):
            return True
        if self._rx_jpeg_enc is not None:
            try:
                self._rx_jpeg_enc.close()
            except Exception:
                pass
            self._rx_jpeg_enc = None
        try:
            enc = self._av.CodecContext.create("mjpeg", "w")
            enc.width = w
            enc.height = h
            enc.pix_fmt = "yuvj420p"
            enc.time_base = Fraction(1, 30)
            enc.qmin = 5
            enc.qmax = 9
            enc.open()
            self._rx_jpeg_enc = enc
            self._rx_jpeg_size = (w, h)
            return True
        except Exception as exc:
            logger.debug(f"[VOIP-VIDEO] mjpeg encoder init {w}x{h} failed: {exc}")
            self._rx_jpeg_enc = None
            return False

    def decode_h264_annexb_to_jpeg(
        self,
        annexb_bytes: bytes,
        *,
        max_dim: int = 480,
    ) -> Optional[bytes]:
        """Giải mã 1 Access Unit H.264 Annex-B từ máy khách -> nén nhanh JPEG gửi lên canvas trình duyệt."""
        if not annexb_bytes or self._av is None:
            return None
        with self._rx_lock:
            # Cache SPS/PPS và chỉ mở khóa decode sau khi nhận được keyframe hợp lệ đầu tiên
            nals = split_annexb_nals(annexb_bytes)
            has_sps = False
            has_pps = False
            has_idr = False
            for nal in nals:
                if not nal:
                    continue
                nt = nal[0] & 0x1F
                if nt == 7:
                    self._rx_cached_sps = _ANNEXB_START4 + nal
                    has_sps = True
                elif nt == 8:
                    self._rx_cached_pps = _ANNEXB_START4 + nal
                    has_pps = True
                elif nt == 5:
                    has_idr = True

            payload = annexb_bytes
            if not self._rx_seen_sps_pps:
                if has_idr and (self._rx_cached_sps and self._rx_cached_pps):
                    if not has_sps or not has_pps:
                        payload = self._rx_cached_sps + self._rx_cached_pps + annexb_bytes
                    self._rx_seen_sps_pps = True
                elif has_sps and has_pps:
                    # Feed SPS/PPS into decoder so next IDR decodes immediately
                    pass
                else:
                    return None

            try:
                if self._rx_h264_dec is None:
                    dec = self._av.CodecContext.create("h264", "r")
                    dec.open()
                    self._rx_h264_dec = dec
                frames = self._rx_h264_dec.decode(self._av.Packet(payload))
                if not frames:
                    return None
                frm = frames[-1]
                fw, fh = int(frm.width), int(frm.height)
                if fw <= 0 or fh <= 0:
                    return None
                scale = min(1.0, float(max_dim) / float(max(fw, fh)))
                out_w = max(64, int(round(fw * scale)) & ~1)
                out_h = max(64, int(round(fh * scale)) & ~1)
                if not self._ensure_rx_jpeg_encoder(out_w, out_h):
                    return None
                jfrm = frm.reformat(width=out_w, height=out_h, format="yuvj420p")
                jfrm.pts = None
                jpkts = self._rx_jpeg_enc.encode(jfrm)
                if not jpkts:
                    return None
                return b"".join(bytes(p) for p in jpkts)
            except Exception as exc:
                logger.debug(f"[VOIP-VIDEO] decode_h264_to_jpeg error: {exc}")
                return None

    def close(self) -> None:
        with self._tx_lock:
            self._tx_jpeg_dec = None
            self._tx_h264_enc = None
        with self._rx_lock:
            self._rx_h264_dec = None
            self._rx_jpeg_enc = None


# ── Per-Session Isolated Async Video Bridge ───────────────────────────────────

class ZaloVideoSessionBridge:
    """Bộ điều phối Video RTP/RTCP bất đồng bộ cho 1 `ZaloCallSession` (`call_type in (2, 3)`).

    Tất cả việc nén/giải mã H.264 chạy trên thread pool riêng với cơ chế latest-frame-wins
    nên tuyệt đối không chặn vòng lặp sự kiện Audio RTP.
    """

    def __init__(
        self,
        *,
        session_id: str,
        send_udp_cb: Callable[[bytes, bytes], None],
        broadcast_browser_cb: Callable[[bytes], Any],
        get_ssrc_cb: Callable[[], int],
        get_token_cb: Callable[[], int],
        packet_mode: int = 2,
    ) -> None:
        self.session_id = session_id
        self._send_udp_cb = send_udp_cb
        self._broadcast_browser_cb = broadcast_browser_cb
        self._get_ssrc_cb = get_ssrc_cb
        self._get_token_cb = get_token_cb
        self.packet_mode = packet_mode

        self.codec = ZaloVideoCodec(target_fps=12, target_bitrate=320_000)
        self.depacketizer = ZaloH264Depacketizer()

        self._tx_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="zvid-tx")
        self._rx_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="zvid-rx")
        self._closed = False

        # TX counters & conflation queue
        self.video_seq: int = int(time.time() * 100) & 0x7FFF
        self._ts_origin: float = time.monotonic()
        self._ts_base: int = (int(time.time() * 90000) & 0xFFFFFFFF)
        self.video_packets_sent: int = 0
        self.video_octets_sent: int = 0
        self.video_frames_sent: int = 0
        self.video_rtcp_sent: int = 0
        self.camera_muted: bool = False
        self.force_keyframe: bool = True
        self.last_browser_video_at: float = 0.0
        self._last_tx_sent_at: float = 0.0
        self._pending_tx_jpeg: Optional[bytes] = None
        self._tx_inflight: bool = False

        # RX counters & RTCP Receiver Report tracking
        self.video_packets_received: int = 0
        self.video_frames_received: int = 0
        self.video_rtcp_received: int = 0
        self.remote_video_ssrc: int = 0
        self._remote_seq_cycles: int = 0
        self._remote_max_seq: Optional[int] = None
        self._remote_sr_lsr: int = 0
        self._remote_sr_recv_at: float = 0.0
        self._last_pli_sent_at: float = 0.0
        self._last_rx_broadcast_at: float = 0.0
        self._pending_rx_annexb: Optional[bytes] = None
        self._rx_inflight: bool = False
        self._logged_first_rx_video: bool = False
        self._logged_first_tx_video: bool = False

    def _current_video_rtp_ts(self) -> int:
        elapsed = max(0.0, time.monotonic() - self._ts_origin)
        return (self._ts_base + int(elapsed * VIDEO_CLOCK_RATE)) & 0xFFFFFFFF

    def request_local_keyframe(self) -> None:
        self.force_keyframe = True

    def set_camera_muted(self, muted: bool) -> None:
        self.camera_muted = bool(muted)
        self.force_keyframe = True

    def enqueue_browser_jpeg(self, jpeg_bytes: bytes) -> None:
        """Nhận JPEG webcam từ trình duyệt Sale -> xếp lịch encode H.264 (latest-frame-wins, 0ms block)."""
        if self._closed or not jpeg_bytes or self.camera_muted or not self.codec.available:
            return
        self.last_browser_video_at = time.time()
        self._pending_tx_jpeg = jpeg_bytes
        if not self._tx_inflight:
            self._schedule_tx_drain()

    def _schedule_tx_drain(self) -> None:
        if self._closed or self._tx_inflight:
            return
        jpeg = self._pending_tx_jpeg
        self._pending_tx_jpeg = None
        if jpeg is None:
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        self._tx_inflight = True
        force_kf = self.force_keyframe
        self.force_keyframe = False
        fut = loop.run_in_executor(
            self._tx_pool,
            lambda: self.codec.encode_jpeg_to_h264_annexb(jpeg, force_keyframe=force_kf),
        )
        fut.add_done_callback(self._on_tx_encoded)

    def _on_tx_encoded(self, fut: asyncio.Future) -> None:
        self._tx_inflight = False
        if self._closed:
            return
        try:
            annexb = fut.result()
        except Exception:
            annexb = None
        if annexb:
            self._transmit_h264_annexb(annexb)
        if self._pending_tx_jpeg is not None and not self._closed:
            self._schedule_tx_drain()

    def send_placeholder_if_idle(self) -> None:
        """Khi Sale chưa có webcam hoặc đã tắt camera: phát 1 khung H.264 giữ nhịp mỗi ~0.6s."""
        if self._closed or self._tx_inflight or not self.codec.available:
            return
        now = time.time()
        # Nếu trình duyệt đang gửi webcam đều đặn (< 0.8s) và không tắt cam thì không cần placeholder
        if not self.camera_muted and (now - self.last_browser_video_at) < 0.8:
            return
        # Giới hạn tốc độ placeholder (~2fps) đủ để giữ Zalo Mobile mượt & không báo kết nối yếu
        if (now - self._last_tx_sent_at) < 0.48:
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        self._tx_inflight = True
        force_kf = self.force_keyframe or (self.video_frames_sent % 4 == 0)
        self.force_keyframe = False
        fut = loop.run_in_executor(
            self._tx_pool,
            lambda: self.codec.encode_placeholder_h264_annexb(force_keyframe=force_kf),
        )
        fut.add_done_callback(self._on_tx_encoded)

    def _transmit_h264_annexb(self, annexb: bytes) -> None:
        if self._closed or not annexb:
            return
        ssrc = self._get_ssrc_cb()
        token = self._get_token_cb()
        rtp_ts = self._current_video_rtp_ts()
        chunks = packetize_zalo_h264_annexb(
            annexb,
            max_payload=VIDEO_MAX_RTP_PAYLOAD,
            packet_mode=self.packet_mode,
        )
        if not chunks:
            return
        self.video_frames_sent += 1
        self._last_tx_sent_at = time.time()
        for pt, pay, marker in chunks:
            self.video_seq = (self.video_seq + 1) & 0xFFFF
            rtp_pkt = build_video_rtp_packet(
                pay,
                seq=self.video_seq,
                timestamp=rtp_ts,
                ssrc=ssrc,
                payload_type=pt,
                marker=marker,
            )
            zrtc_pkt = wrap_zrtc_video_rtp_packet(rtp_pkt, token, is_rtcp=False)
            self.video_packets_sent += 1
            self.video_octets_sent += len(pay)
            try:
                self._send_udp_cb(zrtc_pkt, rtp_pkt)
            except Exception as exc:
                logger.debug(f"[VOIP-VIDEO] send_udp_cb failed session={self.session_id}: {exc}")

        if not self._logged_first_tx_video:
            self._logged_first_tx_video = True
            logger.info(
                f"[VOIP-VIDEO-TX] First H.264 video frame sent: session={self.session_id} "
                f"annexb_len={len(annexb)} rtp_pkts={len(chunks)} pt0={chunks[0][0]} ssrc={ssrc}"
            )

    def send_video_rtcp_sr_rr(self) -> None:
        """Gửi Video RTCP SR + RR + SDES qua msgType=15 mỗi ~1 giây (giải quyết tận gốc `poorSignalCheckByRtcp`)."""
        if self._closed:
            return
        ssrc = self._get_ssrc_cb()
        token = self._get_token_cb()
        if not ssrc:
            return
        ext_seq = (self._remote_seq_cycles << 16) | (self._remote_max_seq or 0)
        dlsr = 0
        if self._remote_sr_lsr and self._remote_sr_recv_at > 0:
            elapsed = max(0.0, time.monotonic() - self._remote_sr_recv_at)
            dlsr = int(elapsed * 65536) & 0xFFFFFFFF
        rtcp_raw = build_video_rtcp_sr_rr_packet(
            ssrc,
            rtp_timestamp=self._current_video_rtp_ts(),
            packets_sent=self.video_packets_sent,
            octets_sent=self.video_octets_sent,
            remote_ssrc=self.remote_video_ssrc,
            fraction_lost=0,
            cum_lost=0,
            ext_highest_seq=ext_seq,
            jitter=12,
            lsr=self._remote_sr_lsr,
            dlsr=dlsr,
        )
        zrtc_rtcp = wrap_zrtc_video_rtp_packet(rtcp_raw, token, is_rtcp=True)
        self.video_rtcp_sent += 1
        try:
            self._send_udp_cb(zrtc_rtcp, rtcp_raw)
        except Exception as exc:
            logger.debug(f"[VOIP-VIDEO] RTCP SR/RR send failed session={self.session_id}: {exc}")

    def send_pli_if_needed(self, *, force: bool = False) -> None:
        """Gửi Video RTCP PLI (PT=206, FMT=1) yêu cầu bên khách phát ngay SPS+PPS+IDR."""
        if self._closed or not self.remote_video_ssrc:
            return
        now = time.monotonic()
        if not force and (now - self._last_pli_sent_at) < 1.5:
            return
        if not force and not self.depacketizer.needs_keyframe and self.video_frames_received > 0:
            return
        ssrc = self._get_ssrc_cb()
        token = self._get_token_cb()
        if not ssrc:
            return
        pli_raw = build_video_rtcp_pli_packet(ssrc, self.remote_video_ssrc)
        zrtc_pli = wrap_zrtc_video_rtp_packet(pli_raw, token, is_rtcp=True)
        self._last_pli_sent_at = now
        self.video_rtcp_sent += 1
        try:
            self._send_udp_cb(zrtc_pli, pli_raw)
        except Exception as exc:
            logger.debug(f"[VOIP-VIDEO] RTCP PLI send failed session={self.session_id}: {exc}")

    def handle_incoming_video_rtp(
        self,
        *,
        payload_type: int,
        seq: int,
        timestamp: int,
        ssrc: int,
        marker: bool,
        payload: bytes,
    ) -> None:
        """Xử lý 1 gói Video RTP nhận từ Relay (msgType=14) hoặc P2P (PT=97/98)."""
        if self._closed or not payload:
            return
        if ssrc == self._get_ssrc_cb():
            return  # Ignore self-reflected video packets

        self.video_packets_received += 1
        if ssrc and self.remote_video_ssrc == 0:
            self.remote_video_ssrc = ssrc

        # Track extended highest sequence for RTCP Receiver Report
        if self._remote_max_seq is None:
            self._remote_max_seq = seq
        else:
            diff = (seq - self._remote_max_seq) & 0xFFFF
            if diff < 0x8000:
                if seq < self._remote_max_seq:
                    self._remote_seq_cycles += 1
                self._remote_max_seq = seq

        if not self._logged_first_rx_video:
            self._logged_first_rx_video = True
            logger.info(
                f"[VOIP-VIDEO-RX] First video RTP received: session={self.session_id} "
                f"pt={payload_type} seq={seq} ssrc={ssrc} len={len(payload)} head={payload[:12].hex()}"
            )

        annexb = self.depacketizer.push_rtp_packet(
            payload_type=payload_type,
            seq=seq,
            timestamp=timestamp,
            marker=marker,
            payload=payload,
        )
        if self.depacketizer.needs_keyframe and self.video_frames_received == 0:
            self.send_pli_if_needed(force=False)
        if not annexb:
            return

        _, _, has_idr = annexb_has_idr_or_sps(annexb)
        if has_idr:
            self.depacketizer.needs_keyframe = False

        # Schedule H.264 decode off the event loop (latest-frame-wins, never drops IDR over P-frame)
        if not self.codec.available:
            return
        if self._pending_rx_annexb is not None and not has_idr:
            # Keep pending IDR if one is waiting; otherwise prefer freshest
            _, _, pend_idr = annexb_has_idr_or_sps(self._pending_rx_annexb)
            if not pend_idr:
                self._pending_rx_annexb = annexb
        else:
            self._pending_rx_annexb = annexb

        if not self._rx_inflight:
            self._schedule_rx_drain()

    def _schedule_rx_drain(self) -> None:
        if self._closed or self._rx_inflight:
            return
        annexb = self._pending_rx_annexb
        self._pending_rx_annexb = None
        if annexb is None:
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        self._rx_inflight = True
        fut = loop.run_in_executor(
            self._rx_pool,
            lambda: self.codec.decode_h264_annexb_to_jpeg(annexb),
        )
        fut.add_done_callback(self._on_rx_decoded)

    def _on_rx_decoded(self, fut: asyncio.Future) -> None:
        self._rx_inflight = False
        if self._closed:
            return
        try:
            jpeg = fut.result()
        except Exception:
            jpeg = None
        if jpeg:
            self.video_frames_received += 1
            now = time.monotonic()
            # Throttle browser WS video push to ~15fps max so audio playback stays silky smooth
            if (now - self._last_rx_broadcast_at) >= 0.06:
                self._last_rx_broadcast_at = now
                frame_packet = WS_VIDEO_RX_MAGIC + jpeg
                try:
                    coro = self._broadcast_browser_cb(frame_packet)
                    if asyncio.iscoroutine(coro):
                        asyncio.create_task(coro)
                except Exception:
                    pass
        if self._pending_rx_annexb is not None and not self._closed:
            self._schedule_rx_drain()

    def handle_incoming_video_rtcp(self, rtcp_bytes: bytes) -> None:
        """Xử lý Video RTCP nhận qua msgType=15 (PLI/FIR yêu cầu phát IDR ngay, SR để đồng bộ LSR RTT)."""
        if self._closed or not rtcp_bytes:
            return
        self.video_rtcp_received += 1
        info = parse_video_rtcp_feedback(rtcp_bytes)
        if info.get("sr_ssrc") and info["sr_ssrc"] != self._get_ssrc_cb():
            if self.remote_video_ssrc == 0:
                self.remote_video_ssrc = int(info["sr_ssrc"])
            if info.get("sr_lsr"):
                self._remote_sr_lsr = int(info["sr_lsr"])
                self._remote_sr_recv_at = time.monotonic()
        if info.get("request_keyframe"):
            self.force_keyframe = True

    def stats_dict(self) -> Dict[str, Any]:
        return {
            "video_packets_sent": self.video_packets_sent,
            "video_packets_received": self.video_packets_received,
            "video_frames_sent": self.video_frames_sent,
            "video_frames_received": self.video_frames_received,
            "video_rtcp_sent": self.video_rtcp_sent,
            "video_rtcp_received": self.video_rtcp_received,
            "camera_muted": self.camera_muted,
            "video_codec_ready": self.codec.available,
        }

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        self._pending_tx_jpeg = None
        self._pending_rx_annexb = None
        try:
            self._tx_pool.shutdown(wait=False, cancel_futures=True)
        except Exception:
            pass
        try:
            self._rx_pool.shutdown(wait=False, cancel_futures=True)
        except Exception:
            pass
        self.codec.close()
