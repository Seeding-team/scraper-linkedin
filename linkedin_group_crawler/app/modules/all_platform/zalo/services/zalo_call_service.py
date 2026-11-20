from __future__ import annotations

import asyncio
import json
import os
import random
import socket
import struct
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set, Tuple

from fastapi import WebSocket
from loguru import logger

from app.modules.all_platform.zalo.services.zca_api_bridge import (
    cancel_zca_voice_call,
    end_zca_voice_call,
    send_zca_call_signal,
    start_zca_voice_call,
)
from app.modules.all_platform.zalo.services.zca_auth_store import load_zca_auth

import base64
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives import padding

CALL_V2_TRANSPORT_AES_KEY = "yjAF9oqMWl6XfXYJn9mA7w=="
CALL_V2_ZERO_IV = b"\x00" * 16

# Chuẩn Opus ZRTC 48kHz Stereo 20ms
OPUS_PAYLOAD_TYPE = 113
OPUS_TIMESTAMP_STEP = 960  # 48000 Hz * 0.02s
OPUS_SILENCE_FRAME = bytes([0xF8, 0xFF, 0xFE])


def encrypt_zcall_transport_frame(header: str, payload: dict) -> bytes:
    """Mã hóa AES-128-CBC ZCall Transport Frame gửi tới máy chủ Relay :4200."""
    key_bytes = base64.b64decode(CALL_V2_TRANSPORT_AES_KEY)
    json_bytes = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    padder = padding.PKCS7(128).padder()
    padded_data = padder.update(json_bytes) + padder.finalize()
    cipher = Cipher(algorithms.AES(key_bytes), modes.CBC(CALL_V2_ZERO_IV))
    encryptor = cipher.encryptor()
    ct = encryptor.update(padded_data) + encryptor.finalize()
    return f"{header}${ct.hex()}$".encode("utf-8")


# ── RFC 3550 RTP Packet Builder & Parser ──────────────────────────────────────

def build_rtp_packet(
    payload: bytes,
    *,
    seq: int,
    timestamp: int,
    ssrc: int,
    payload_type: int = OPUS_PAYLOAD_TYPE,
    marker: bool = False,
) -> bytes:
    """Đóng gói khung âm thanh Opus PT=113 vào gói tin RTP 12-byte chuẩn RFC 3550."""
    b0 = 0x80  # Version 2, P=0, X=0, CC=0
    b1 = (0x80 if marker else 0x00) | (payload_type & 0x7F)
    header = struct.pack(
        "!BBHII",
        b0,
        b1,
        seq & 0xFFFF,
        timestamp & 0xFFFFFFFF,
        ssrc & 0xFFFFFFFF,
    )
    return header + payload


def parse_rtp_packet(packet: bytes) -> Optional[Dict[str, Any]]:
    """Bóc tách gói tin RTP 12-byte nhận từ máy chủ Zalo Relay."""
    if not packet or len(packet) < 12:
        return None
    b0, b1, seq, ts, ssrc = struct.unpack("!BBHII", packet[:12])
    version = (b0 >> 6) & 0x03
    if version != 2:
        return None
    cc = b0 & 0x0F
    extension = bool((b0 >> 4) & 0x01)
    marker = bool((b1 >> 7) & 0x01)
    payload_type = b1 & 0x7F

    offset = 12 + (cc * 4)
    if len(packet) < offset:
        return None
    if extension:
        if len(packet) < offset + 4:
            return None
        _, ext_len_words = struct.unpack("!HH", packet[offset : offset + 4])
        offset += 4 + (ext_len_words * 4)
        if len(packet) < offset:
            return None

    return {
        "version": version,
        "marker": marker,
        "payload_type": payload_type,
        "seq": seq,
        "timestamp": ts,
        "ssrc": ssrc,
        "payload": packet[offset:],
    }


# ── RFC 5389 STUN Binding Discovery (0-dependency) ───────────────────────────

_STUN_MAGIC_COOKIE = 0x2112A442


def _build_stun_binding_request() -> Tuple[bytes, bytes]:
    tx_id = os.urandom(12)
    header = struct.pack("!HHI12s", 0x0001, 0, _STUN_MAGIC_COOKIE, tx_id)
    return header, tx_id


def _parse_stun_binding_response(data: bytes, expected_tx_id: bytes) -> Optional[Tuple[str, int]]:
    if not data or len(data) < 20:
        return None
    msg_type, msg_len, cookie, tx_id = struct.unpack("!HHI12s", data[:20])
    if msg_type != 0x0101 or cookie != _STUN_MAGIC_COOKIE or tx_id != expected_tx_id:
        return None
    pos = 20
    end = min(len(data), 20 + msg_len)
    while pos + 4 <= end:
        attr_type, attr_len = struct.unpack("!HH", data[pos : pos + 4])
        val = data[pos + 4 : pos + 4 + attr_len]
        # 0x0020: XOR-MAPPED-ADDRESS, 0x0001: MAPPED-ADDRESS
        if attr_type == 0x0020 and len(val) >= 8:
            family = val[1]
            if family == 0x01:  # IPv4
                xport = struct.unpack("!H", val[2:4])[0] ^ (_STUN_MAGIC_COOKIE >> 16)
                xip = struct.unpack("!I", val[4:8])[0] ^ _STUN_MAGIC_COOKIE
                ip_str = socket.inet_ntoa(struct.pack("!I", xip))
                return ip_str, int(xport)
        elif attr_type == 0x0001 and len(val) >= 8:
            family = val[1]
            if family == 0x01:
                port = struct.unpack("!H", val[2:4])[0]
                ip_str = socket.inet_ntoa(val[4:8])
                return ip_str, int(port)
        padded_len = (attr_len + 3) & ~3
        pos += 4 + padded_len
    return None


class _ZaloRtpDatagramProtocol(asyncio.DatagramProtocol):
    def __init__(self, session: "ZaloCallSession") -> None:
        self.session = session
        self.transport: Optional[asyncio.DatagramTransport] = None
        self.stun_waiter: Optional[Tuple[bytes, asyncio.Future]] = None

    def connection_made(self, transport: asyncio.BaseTransport) -> None:
        self.transport = transport  # type: ignore[assignment]

    def datagram_received(self, data: bytes, addr: Tuple[str, int]) -> None:
        # Kiểm tra nếu là gói phản hồi STUN
        if self.stun_waiter is not None:
            tx_id, fut = self.stun_waiter
            if not fut.done():
                parsed_stun = _parse_stun_binding_response(data, tx_id)
                if parsed_stun:
                    fut.set_result(parsed_stun)
                    return

        # Mọi gói tin UDP hợp lệ (không phải STUN) từ Zalo Relay khi đang gọi
        if self.session.status in ("dialing", "ringing", "connected") and len(data) >= 4:
            self.session.packets_received += 1
            if not self.session.remote_rtp_addr:
                self.session.remote_rtp_addr = addr
            if self.session.status == "ringing":
                asyncio.create_task(_promote_connected_from_media(self.session))

            parsed = parse_rtp_packet(data)
            if parsed and parsed.get("payload"):
                asyncio.create_task(self.session.broadcast_audio_to_browsers(parsed["payload"]))


# ── Active Call Session Model ─────────────────────────────────────────────────

@dataclass
class ZaloCallSession:
    session_id: str
    account_id: str
    call_id: int
    callee_id: str
    conversation_id: str = ""
    customer_name: str = ""
    phone_number: str = ""
    call_type: int = 1
    status: str = "dialing"  # dialing | ringing | connected | ended | cancelled | rejected | busy | failed
    started_at: float = field(default_factory=time.time)
    connected_at: Optional[float] = None
    ended_at: Optional[float] = None
    local_rtp_address: str = "0.0.0.0:0"
    local_rtcp_address: str = "0.0.0.0:0"
    remote_rtp_addr: Optional[Tuple[str, int]] = None
    relay_servers: List[Tuple[str, int]] = field(default_factory=list)
    signaling_data: Dict[str, Any] = field(default_factory=dict)
    warning: Optional[str] = None
    source_post_id: Optional[str] = None
    source_platform: str = "zalo"
    caller_email: Optional[str] = None
    caller_user_id: Optional[str] = None
    caller_name: Optional[str] = None
    kpi_recorded: bool = False
    kpi_attempts: int = 0
    kpi_result_code: Optional[str] = None

    # RTP / ZRTC Worker state
    ssrc: int = field(default_factory=lambda: random.randint(100000, 0x7FFFFFFF))
    seq: int = 0
    rtp_timestamp: int = 0
    packets_sent: int = 0
    packets_received: int = 0
    zrtc_worker_id: Optional[str] = None
    udp_transport: Optional[asyncio.DatagramTransport] = None
    ws_clients: Set[WebSocket] = field(default_factory=set)
    p2p_target: Optional[Tuple[str, int]] = None

    @property
    def zalo_sess_id(self) -> str:
        req_res = self.signaling_data.get("requestcall_result") or {}
        if isinstance(req_res, dict):
            s = req_res.get("sessId") or req_res.get("session")
            if s:
                return str(s)
        s2 = self.signaling_data.get("session")
        if s2:
            return str(s2)
        return str(self.call_id)

    @property
    def duration_sec(self) -> int:
        if self.connected_at is None:
            return 0
        end_ref = self.ended_at or time.time()
        return max(0, int(round(end_ref - self.connected_at)))

    def to_dict(self) -> Dict[str, Any]:
        parsed_local = _parse_host_port(self.local_rtp_address)
        public_ip = parsed_local[0] if parsed_local else None
        rtp_port = parsed_local[1] if parsed_local else 0
        return {
            "session_id": self.session_id,
            "account_id": self.account_id,
            "call_id": self.call_id,
            "callee_id": self.callee_id,
            "conversation_id": self.conversation_id or self.callee_id,
            "customer_name": self.customer_name,
            "phone_number": self.phone_number,
            "call_type": self.call_type,
            "status": self.status,
            "codec": "Opus/PCM16",
            "rtp_port": rtp_port,
            "public_ip": public_ip,
            "public_port": rtp_port or None,
            "relay_host": self.remote_rtp_addr[0] if self.remote_rtp_addr else None,
            "relay_port": self.remote_rtp_addr[1] if self.remote_rtp_addr else None,
            "created_at_ms": int(self.started_at * 1000),
            "started_at": int(self.started_at * 1000),
            "connected_at": int(self.connected_at * 1000) if self.connected_at else None,
            "connected_at_ms": int(self.connected_at * 1000) if self.connected_at else None,
            "ended_at": int(self.ended_at * 1000) if self.ended_at else None,
            "ended_at_ms": int(self.ended_at * 1000) if self.ended_at else None,
            "duration_sec": self.duration_sec,
            "local_rtp_address": self.local_rtp_address,
            "remote_rtp_address": (
                f"{self.remote_rtp_addr[0]}:{self.remote_rtp_addr[1]}"
                if self.remote_rtp_addr
                else None
            ),
            "p2p_target": (
                f"{self.p2p_target[0]}:{self.p2p_target[1]}"
                if self.p2p_target
                else None
            ),
            "packets_sent": self.packets_sent,
            "packets_received": self.packets_received,
            "zrtc_worker_id": self.zrtc_worker_id,
            "zrtc_worker_connected": bool(self.zrtc_worker_id and self.zrtc_worker_id in _ZRTC_WORKERS) or is_zrtc_worker_connected(),
            "kpi_recorded": self.kpi_recorded,
            "kpi_attempts": self.kpi_attempts,
            "kpi_result_code": self.kpi_result_code,
            "warning": self.warning,
            "error": self.warning,
        }

    async def broadcast_json(self, event: Dict[str, Any]) -> None:
        dead: List[WebSocket] = []
        text = json.dumps(event, ensure_ascii=False)
        for ws in list(self.ws_clients):
            try:
                await ws.send_text(text)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.ws_clients.discard(ws)

    async def broadcast_audio_to_browsers(self, pcm_or_opus_bytes: bytes) -> None:
        dead: List[WebSocket] = []
        for ws in list(self.ws_clients):
            try:
                await ws.send_bytes(pcm_or_opus_bytes)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.ws_clients.discard(ws)

    def send_audio_from_browser(self, audio_frame: bytes, payload_type: int = OPUS_PAYLOAD_TYPE) -> None:
        """Nhận khung âm thanh PCM16/Opus từ trình duyệt Sale -> đẩy qua ZRTC Media Worker (nếu kết nối) hoặc UDP RTP."""
        self.seq = (self.seq + 1) & 0xFFFF
        self.rtp_timestamp = (self.rtp_timestamp + OPUS_TIMESTAMP_STEP) & 0xFFFFFFFF
        self.packets_sent += 1
        if self.zrtc_worker_id and self.zrtc_worker_id in _ZRTC_WORKERS and audio_frame:
            _schedule_zrtc_worker_audio(self.zrtc_worker_id, self.session_id, audio_frame)
            return
        if self.udp_transport and (self.remote_rtp_addr or self.p2p_target):
            pkt = build_rtp_packet(
                audio_frame or OPUS_SILENCE_FRAME,
                seq=self.seq,
                timestamp=self.rtp_timestamp,
                ssrc=self.ssrc,
                payload_type=payload_type,
            )
            if self.remote_rtp_addr:
                try:
                    self.udp_transport.sendto(pkt, self.remote_rtp_addr)
                except Exception as exc:
                    logger.debug(f"UDP RTP sendto failed for session={self.session_id}: {exc}")
            if self.p2p_target:
                try:
                    self.udp_transport.sendto(pkt, self.p2p_target)
                except Exception as exc:
                    logger.debug(f"UDP RTP sendto P2P failed for session={self.session_id}: {exc}")

    def close_media(self) -> None:
        if self.udp_transport is not None:
            try:
                self.udp_transport.close()
            except Exception:
                pass
            self.udp_transport = None


# ── In-Memory Registry ────────────────────────────────────────────────────────

_CALL_SESSIONS: Dict[str, ZaloCallSession] = {}


# ── ZRTC Media Worker Hub (Hướng A: Server-Side Native ZRTC Bridge) ──────────

@dataclass
class _ZrtcWorkerConn:
    worker_id: str
    ws: WebSocket
    connected_at: float = field(default_factory=time.time)
    last_seen_at: float = field(default_factory=time.time)
    capabilities: Dict[str, Any] = field(default_factory=dict)
    pending_rpcs: Dict[str, asyncio.Future] = field(default_factory=dict)


_ZRTC_WORKERS: Dict[str, _ZrtcWorkerConn] = {}


def is_zrtc_worker_connected() -> bool:
    return len(_ZRTC_WORKERS) > 0


def get_active_zrtc_worker() -> Optional[_ZrtcWorkerConn]:
    if not _ZRTC_WORKERS:
        return None
    # Chọn worker hoạt động gần nhất
    return max(_ZRTC_WORKERS.values(), key=lambda w: w.last_seen_at)


def register_zrtc_worker(worker_id: str, ws: WebSocket, capabilities: Optional[Dict[str, Any]] = None) -> _ZrtcWorkerConn:
    conn = _ZrtcWorkerConn(
        worker_id=worker_id,
        ws=ws,
        capabilities=capabilities or {},
    )
    _ZRTC_WORKERS[worker_id] = conn
    logger.info(f"[ZRTC-WORKER] Registered worker={worker_id} total={len(_ZRTC_WORKERS)}")
    return conn


def unregister_zrtc_worker(worker_id: str) -> None:
    conn = _ZRTC_WORKERS.pop(worker_id, None)
    if conn:
        for fut in conn.pending_rpcs.values():
            if not fut.done():
                fut.set_exception(RuntimeError("ZRTC worker disconnected"))
        conn.pending_rpcs.clear()
        logger.info(f"[ZRTC-WORKER] Unregistered worker={worker_id} remaining={len(_ZRTC_WORKERS)}")


def _schedule_zrtc_worker_audio(worker_id: str, session_id: str, pcm_bytes: bytes) -> None:
    conn = _ZRTC_WORKERS.get(worker_id)
    if not conn:
        return
    sid_b = session_id.encode("utf-8")[:255]
    frame = b"ZPCM" + bytes([len(sid_b)]) + sid_b + pcm_bytes

    async def _send() -> None:
        try:
            await conn.ws.send_bytes(frame)
        except Exception:
            pass

    try:
        asyncio.get_running_loop().create_task(_send())
    except RuntimeError:
        pass


async def dispatch_zrtc_worker_rpc(
    worker_id: str,
    msg_type: str,
    payload: Dict[str, Any],
    timeout_sec: float = 6.0,
) -> Dict[str, Any]:
    conn = _ZRTC_WORKERS.get(worker_id)
    if not conn:
        raise RuntimeError(f"ZRTC worker {worker_id} is not connected")
    req_id = f"rpc_{uuid.uuid4().hex[:12]}"
    loop = asyncio.get_running_loop()
    fut: asyncio.Future = loop.create_future()
    conn.pending_rpcs[req_id] = fut
    try:
        await conn.ws.send_text(json.dumps({"type": msg_type, "req_id": req_id, **payload}, ensure_ascii=False))
        return await asyncio.wait_for(fut, timeout=timeout_sec)
    finally:
        conn.pending_rpcs.pop(req_id, None)


async def notify_zrtc_worker_event(worker_id: Optional[str], msg_type: str, payload: Dict[str, Any]) -> None:
    if not worker_id:
        return
    conn = _ZRTC_WORKERS.get(worker_id)
    if not conn:
        return
    try:
        await conn.ws.send_text(json.dumps({"type": msg_type, **payload}, ensure_ascii=False))
    except Exception as exc:
        logger.debug(f"[ZRTC-WORKER] Failed to send {msg_type} to worker={worker_id}: {exc}")


async def handle_zrtc_worker_text(worker_id: str, text: str) -> None:
    conn = _ZRTC_WORKERS.get(worker_id)
    if not conn:
        return
    conn.last_seen_at = time.time()
    try:
        data = json.loads(text)
    except Exception:
        return
    msg_type = str(data.get("type") or "").lower()
    if msg_type == "ping":
        try:
            await conn.ws.send_text(json.dumps({"type": "pong", "ts": int(time.time() * 1000)}))
        except Exception:
            pass
        return
    if msg_type == "rpc_result":
        req_id = str(data.get("req_id") or "")
        fut = conn.pending_rpcs.get(req_id)
        if fut and not fut.done():
            fut.set_result(data)
        return
    if msg_type == "worker_call_event":
        sid = str(data.get("session_id") or "")
        session = _CALL_SESSIONS.get(sid)
        if not session:
            return
        ev = str(data.get("event") or "").lower()
        detail = data.get("detail")
        if detail:
            session.warning = str(detail)
        if ev in ("ended", "failed", "rejected") and session.status in ("dialing", "ringing", "connected"):
            session.status = ev
            session.ended_at = time.time()
            session.close_media()
            await _record_session_kpi_and_history(session)
        await session.broadcast_json({"type": "call_state", "session": session.to_dict(), **session.to_dict()})


async def handle_zrtc_worker_binary(worker_id: str, frame: bytes) -> None:
    conn = _ZRTC_WORKERS.get(worker_id)
    if conn:
        conn.last_seen_at = time.time()
    if not frame or len(frame) < 6 or frame[:4] != b"ZPCM":
        return
    sid_len = frame[4]
    if len(frame) < 5 + sid_len:
        return
    sid = frame[5 : 5 + sid_len].decode("utf-8", errors="ignore")
    pcm = frame[5 + sid_len :]
    session = _CALL_SESSIONS.get(sid)
    if not session or not pcm or session.status not in ("ringing", "connected"):
        return
    session.packets_received += 1
    await session.broadcast_audio_to_browsers(pcm)


async def _media_watchdog_loop(session: ZaloCallSession) -> None:
    """Kiểm tra sau 5 giây kể từ khi connected: nếu 0 gói audio nhận về, cập nhật cảnh báo nhẹ."""
    await asyncio.sleep(5.0)
    if session.status != "connected":
        return
    if session.packets_received == 0 and not (session.zrtc_worker_id and session.zrtc_worker_id in _ZRTC_WORKERS):
        session.warning = (
            "Chưa nhận được tín hiệu âm thanh từ máy khách qua Relay Zalo. "
            "Đang tiếp tục giữ thông luồng UDP RTP."
        )
        await session.broadcast_json({"type": "call_state", "session": session.to_dict(), **session.to_dict()})


def get_call_session(session_id: str) -> Optional[ZaloCallSession]:
    return _CALL_SESSIONS.get(session_id)


def _parse_host_port(addr_str: Any) -> Optional[Tuple[str, int]]:
    if not addr_str or not isinstance(addr_str, str) or ":" not in addr_str:
        return None
    host, _, port_s = addr_str.rpartition(":")
    host = host.strip()
    if not host or host == "0.0.0.0":
        return None
    try:
        port = int(port_s.strip())
        if 1 <= port <= 65535:
            return host, port
    except ValueError:
        pass
    return None


async def _allocate_rtp_udp_endpoint(session: ZaloCallSession) -> Tuple[str, str]:
    """Mở cổng UDP cho RTP và tự động khám phá IP:Port public qua STUN."""
    loop = asyncio.get_running_loop()
    protocol = _ZaloRtpDatagramProtocol(session)
    transport, _ = await loop.create_datagram_endpoint(
        lambda: protocol,
        local_addr=("0.0.0.0", 0),
    )
    session.udp_transport = transport  # type: ignore[assignment]
    sock = transport.get_extra_info("socket")
    local_port = sock.getsockname()[1] if sock else 50000

    public_ip = "127.0.0.1"
    public_port = local_port
    try:
        stun_req, tx_id = _build_stun_binding_request()
        fut: asyncio.Future = loop.create_future()
        protocol.stun_waiter = (tx_id, fut)
        stun_addr = await loop.run_in_executor(
            None, lambda: socket.gethostbyname("stun.l.google.com")
        )
        transport.sendto(stun_req, (stun_addr, 19302))
        ip_res, port_res = await asyncio.wait_for(fut, timeout=1.0)
        public_ip, public_port = ip_res, port_res
    except Exception:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
                s.connect(("8.8.8.8", 80))
                public_ip = s.getsockname()[0]
        except Exception:
            public_ip = "127.0.0.1"
    finally:
        protocol.stun_waiter = None

    rtp_addr = f"{public_ip}:{public_port}"
    rtcp_addr = f"{public_ip}:{public_port + 1}"
    return rtp_addr, rtcp_addr


async def _record_session_kpi_and_history(
    session: ZaloCallSession,
    *,
    result_code: Optional[str] = None,
) -> None:
    """Module 4: Tự động cộng +1 KPI CALL vào post_call_results và lưu lịch sử cuộc gọi."""
    if session.kpi_recorded:
        return
    session.kpi_recorded = True

    resolved_code = result_code or (
        "consulting" if session.duration_sec >= 5 else "noanswer"
    )
    session.kpi_result_code = resolved_code

    target_post_id = (
        (session.source_post_id or "").strip()
        or f"zalo:{session.account_id}:{session.conversation_id or session.callee_id or session.phone_number or 'direct'}"
    )
    target_platform = (
        session.source_platform
        if (session.source_post_id and session.source_platform)
        else "zalo"
    )

    def _sync_upsert_kpi() -> Optional[Dict[str, Any]]:
        from app.modules.all_platform.services.post_call_result_service import (
            update_call_result,
        )
        from app.core.supabase_client import get_supabase_client

        user_id = session.caller_user_id
        if not user_id and session.caller_email:
            try:
                sb = get_supabase_client()
                u_res = (
                    sb.table("app_users")
                    .select("id,name,email")
                    .eq("email", session.caller_email.strip().lower())
                    .limit(1)
                    .execute()
                )
                if u_res.data:
                    user_id = str(u_res.data[0]["id"])
            except Exception:
                pass
        if not user_id:
            return None
        return update_call_result(
            target_post_id,
            {"result_code": resolved_code, "platform": target_platform},
            {"id": user_id, "email": session.caller_email, "name": session.caller_name},
        )

    try:
        kpi_row = await asyncio.to_thread(_sync_upsert_kpi)
        if isinstance(kpi_row, dict):
            session.kpi_attempts = int(kpi_row.get("attempts") or 1)
    except Exception as exc:
        logger.warning(f"Auto KPI call recording failed for session={session.session_id}: {exc}")


_DEFAULT_ZRTC_CODECS_JSON = json.dumps(
    [{"dynamicFptime": 0, "frmPtime": 20, "name": "opus/48000/2", "payload": 113}],
    separators=(",", ":"),
)


async def _promote_connected_from_media(session: ZaloCallSession) -> None:
    """Chuyển phiên gọi sang connected khi thực sự nhận được gói UDP từ Relay (hoặc tín hiệu answer)."""
    if session.status != "ringing":
        return
    if session.connected_at is None:
        session.connected_at = time.time()
    session.status = "connected"
    logger.info(
        f"[VOIP-MEDIA] Call connected via Relay UDP packets for session={session.session_id} "
        f"packets_received={session.packets_received}"
    )
    # Gửi 11304 AnswerAck tới Zalo Voice Server để xác nhận khớp kết nối
    try:
        auth = await load_zca_auth(session.account_id)
        if auth and session.callee_id:
            await send_zca_call_signal(
                auth,
                11304,
                {"calleeId": session.callee_id, "callId": session.call_id},
            )
            logger.info(f"[VOIP-MEDIA] 11304 AnswerAck dispatched on media receive for session={session.session_id}")
    except Exception as ack_err:
        logger.debug(f"[VOIP-MEDIA] AnswerAck on media error: {ack_err}")

    await session.broadcast_json({"type": "call_state", "session": session.to_dict(), **session.to_dict()})


def _send_udp_keepalive_tick(session: ZaloCallSession) -> None:
    """Bắn gói UDP keepalive tới Relay chính, P2P target và các Relay dự phòng để giữ thông lỗ NAT."""
    if not session.udp_transport:
        return
    targets: List[Tuple[str, int]] = []
    if session.remote_rtp_addr:
        targets.append(session.remote_rtp_addr)
    if session.p2p_target and session.p2p_target not in targets:
        targets.append(session.p2p_target)
    for srv in session.relay_servers[:2]:
        if srv not in targets:
            targets.append(srv)
    if not targets:
        return

    # Gói tin bắt tay AES Transport Frame 49$ gửi mỗi 5 gói để Relay :4200 và P2P duy trì route
    if session.packets_sent % 5 == 0:
        try:
            handshake = encrypt_zcall_transport_frame(
                "49",
                {
                    "callId": session.call_id,
                    "sessId": session.zalo_sess_id,
                    "userId": session.account_id,
                    "toId": session.callee_id,
                    "status": 0,
                    "ts": int(time.time() * 1000),
                },
            )
            for addr in targets:
                session.udp_transport.sendto(handshake, addr)
        except Exception as hs_exc:
            logger.debug(f"[VOIP-HANDSHAKE] Transport frame error: {hs_exc}")

    session.seq = (session.seq + 1) & 0xFFFF
    session.rtp_timestamp = (session.rtp_timestamp + OPUS_TIMESTAMP_STEP) & 0xFFFFFFFF
    session.packets_sent += 1
    pkt = build_rtp_packet(
        OPUS_SILENCE_FRAME,
        seq=session.seq,
        timestamp=session.rtp_timestamp,
        ssrc=session.ssrc,
        payload_type=OPUS_PAYLOAD_TYPE,
    )
    for addr in targets:
        try:
            session.udp_transport.sendto(pkt, addr)
        except Exception:
            pass


async def _auto_answer_ack_loop(session: ZaloCallSession, auth: Dict[str, Any]) -> None:
    """Duy trì lỗ thông NAT UDP định kỳ trong suốt thời gian đổ chuông:
    - Bắn nhịp UDP keepalive (Opus silence + 49$ AES transport frame) tới Relay để giữ thông NAT.
    - TUYỆT ĐỐI KHÔNG gửi 11304 answerack khi chuông chưa nhấc máy để tránh làm điện thoại khách văng lỗi ngắt cuộc gọi nhỡ.
    - Chỉ dừng vòng lặp khi cuộc gọi thực sự chuyển sang connected/ended/cancelled/rejected.
    """
    await asyncio.sleep(0.5)

    attempts = 0
    while session.status == "ringing" and attempts < 45:
        attempts += 1

        # Bắn 4 nhịp UDP keepalive (mỗi 250ms = 1s) để giữ thông NAT & kích hoạt nhận gói Relay
        for _ in range(4):
            if session.status != "ringing":
                break
            _send_udp_keepalive_tick(session)
            await asyncio.sleep(0.25)

        if session.status != "ringing":
            break

    logger.info(f"[NAT-KEEPALIVE] Loop exited for session={session.session_id} status={session.status} attempts={attempts}")


async def start_call_session(
    *,
    account_id: str,
    conversation_id: Optional[str] = None,
    callee_id: Optional[str] = None,
    phone_number: Optional[str] = None,
    customer_name: Optional[str] = None,
    call_type: int = 1,
    source_post_id: Optional[str] = None,
    source_platform: Optional[str] = None,
    caller_email: Optional[str] = None,
    caller_user: Optional[Dict[str, Any]] = None,
) -> ZaloCallSession:
    """Khởi tạo phiên gọi Zalo trực tiếp (Hướng 3: 11300 requestcall + 11301 request + UDP RTP)."""
    auth = await load_zca_auth(account_id)
    if not auth:
        raise RuntimeError("Chưa có phiên ZCA hợp lệ. Hãy đăng nhập Zalo qua Chrome Extension trước.")

    logger.info(f"[CALL-START] Initiating direct call: account={account_id} callee={callee_id or conversation_id} phone={phone_number}")

    # Dọn dẹp/hủy các phiên gọi cũ còn treo của cùng tài khoản để tránh Zalo server báo bận / In-Call
    for existing_id, existing_s in list(_CALL_SESSIONS.items()):
        if existing_s.account_id == account_id and existing_s.status in ("dialing", "ringing", "connected"):
            try:
                await cancel_zca_voice_call(
                    auth,
                    to_id=existing_s.callee_id,
                    call_id=existing_s.call_id,
                    call_type=existing_s.call_type,
                )
            except Exception:
                pass
            existing_s.status = "cancelled"
            existing_s.ended_at = time.time()
            existing_s.close_media()

    session_id = f"zcall_{uuid.uuid4().hex[:16]}"
    initial_callee = (callee_id or conversation_id or "").strip()
    session = ZaloCallSession(
        session_id=session_id,
        account_id=account_id,
        call_id=random.randint(10000000, 0x7FFFFFFF),
        callee_id=initial_callee,
        conversation_id=(conversation_id or initial_callee).strip(),
        customer_name=(customer_name or "").strip(),
        phone_number=(phone_number or "").strip(),
        call_type=int(call_type or 1),
        status="dialing",
        source_post_id=source_post_id,
        source_platform=source_platform or "zalo",
        caller_email=caller_email,
        caller_user_id=str(caller_user.get("id")) if isinstance(caller_user, dict) and caller_user.get("id") else None,
        caller_name=str(caller_user.get("name") or "") if isinstance(caller_user, dict) else None,
    )

    if len(_CALL_SESSIONS) > 200:
        oldest = sorted(_CALL_SESSIONS.keys(), key=lambda k: _CALL_SESSIONS[k].started_at)[:50]
        for ok in oldest:
            old_s = _CALL_SESSIONS.pop(ok, None)
            if old_s:
                old_s.close_media()

    _CALL_SESSIONS[session_id] = session

    # Bước 1: Mở UDP RTP/RTCP socket + khám phá IP:Port qua STUN
    try:
        rtp_addr, rtcp_addr = await _allocate_rtp_udp_endpoint(session)
        session.local_rtp_address = rtp_addr
        session.local_rtcp_address = rtcp_addr
    except Exception as udp_exc:
        logger.warning(f"Could not allocate UDP RTP socket ({udp_exc}); continuing with signaling")

    # Bước 2: Phát lệnh 11300 (/api/voicecall/requestcall) + 11301 (/api/voicecall/request)
    # Nếu có ZRTC Media Worker đang online -> lấy extendData ZRTC thật từ Worker trước khi phát 11301!
    try:
        worker_extend_data = ""
        active_worker = get_active_zrtc_worker()
        pre_s1_data: Optional[Dict[str, Any]] = None
        if active_worker and initial_callee and len(initial_callee) >= 5:
            try:
                s1_resp = await send_zca_call_signal(
                    auth,
                    11300,
                    {
                        "calleeId": initial_callee,
                        "callId": session.call_id,
                        "codec": _DEFAULT_ZRTC_CODECS_JSON,
                        "typeRequest": session.call_type,
                    },
                )
                if isinstance(s1_resp, dict) and isinstance(s1_resp.get("response"), dict):
                    pre_s1_data = s1_resp["response"]
                    if pre_s1_data.get("status") in (None, 0):
                        rpc_res = await dispatch_zrtc_worker_rpc(
                            active_worker.worker_id,
                            "start_call",
                            {
                                "session_id": session.session_id,
                                "call_id": session.call_id,
                                "callee_id": initial_callee,
                                "call_type": session.call_type,
                                "s1_data": pre_s1_data,
                            },
                            timeout_sec=6.0,
                        )
                        if rpc_res.get("ok") and rpc_res.get("extend_data"):
                            worker_extend_data = str(rpc_res["extend_data"])
                            session.zrtc_worker_id = active_worker.worker_id
                            logger.info(
                                f"[ZRTC-WORKER] Attached worker={active_worker.worker_id} "
                                f"to session={session.session_id} extendData_len={len(worker_extend_data)}"
                            )
            except Exception as w_exc:
                logger.warning(f"[ZRTC-WORKER] Pre-call attach failed, falling back to signaling-only: {w_exc}")

        if pre_s1_data is not None and worker_extend_data:
            # Đã chạy 11300 và lấy extendData từ ZRTC Worker -> gửi thẳng 11301
            relay_rtp = (
                pre_s1_data.get("rtpIP")
                or pre_s1_data.get("rtpAddress")
                or pre_s1_data.get("rtp_address")
                or pre_s1_data.get("relayAddress")
                or "171.244.25.121:4200"
            )
            relay_rtcp = pre_s1_data.get("rtcpIP") or pre_s1_data.get("rtcpAddress") or relay_rtp
            server_sess = pre_s1_data.get("sessId") or pre_s1_data.get("session") or session.call_id
            s2_resp = await send_zca_call_signal(
                auth,
                11301,
                {
                    "calleeId": initial_callee,
                    "rtcpAddress": relay_rtcp,
                    "rtpAddress": relay_rtp,
                    "codec": _DEFAULT_ZRTC_CODECS_JSON,
                    "extendData": worker_extend_data,
                    "session": server_sess,
                    "callId": int(pre_s1_data.get("id") or pre_s1_data.get("callId") or session.call_id),
                },
            )
            sig_res = {
                "ok": True,
                "call_ok": True,
                "call_id": int(pre_s1_data.get("id") or pre_s1_data.get("callId") or session.call_id),
                "callee_id": initial_callee,
                "session": server_sess,
                "call_type": session.call_type,
                "status": "ringing",
                "rtp_address": relay_rtp,
                "rtcp_address": relay_rtcp,
                "relay_servers": pre_s1_data.get("servers") or [],
                "requestcall_result": pre_s1_data,
                "request_result": s2_resp.get("response") if isinstance(s2_resp, dict) else s2_resp,
                "request_warning": None,
            }
        else:
            sig_res = await start_zca_voice_call(
                auth,
                callee_id=initial_callee,
                phone=phone_number,
                call_id=session.call_id,
                call_type=session.call_type,
                rtp_address=session.local_rtp_address,
                rtcp_address=session.local_rtcp_address,
                codec=_DEFAULT_ZRTC_CODECS_JSON,
                extend_data=worker_extend_data,
            )
        session.signaling_data = sig_res or {}
        if sig_res.get("call_id"):
            session.call_id = int(sig_res["call_id"])
        if sig_res.get("callee_id"):
            session.callee_id = str(sig_res["callee_id"])
            if not session.conversation_id:
                session.conversation_id = session.callee_id
        profile = sig_res.get("profile")
        if isinstance(profile, dict) and profile.get("display_name") and not session.customer_name:
            session.customer_name = str(profile["display_name"])

        req_res = sig_res.get("requestcall_result")
        sig_status = sig_res.get("status")
        raw_status = None
        if isinstance(req_res, dict):
            remote_candidate = (
                req_res.get("rtpIP")
                or req_res.get("rtpAddress")
                or req_res.get("rtp_address")
                or req_res.get("relayAddress")
                or sig_res.get("rtp_address")
            )
            parsed_remote = _parse_host_port(remote_candidate)
            if parsed_remote:
                session.remote_rtp_addr = parsed_remote
            for srv_item in req_res.get("servers") or sig_res.get("relay_servers") or []:
                if isinstance(srv_item, dict):
                    srv_addr = _parse_host_port(srv_item.get("rtpaddr") or srv_item.get("rtcpaddr"))
                    if srv_addr and srv_addr not in session.relay_servers:
                        session.relay_servers.append(srv_addr)
            raw_status = req_res.get("status")
        elif sig_res.get("rtp_address"):
            parsed_remote = _parse_host_port(sig_res.get("rtp_address"))
            if parsed_remote:
                session.remote_rtp_addr = parsed_remote

        logger.info(
            f"[CALL-START] Signaling result: session={session.session_id} call_id={session.call_id} "
            f"status={sig_status} raw_status={raw_status} remote_rtp={session.remote_rtp_addr} "
            f"relays={len(session.relay_servers)} warning={sig_res.get('request_warning')}"
        )

        if sig_status == "privacy_blocked" or (raw_status is not None and int(raw_status) == 7):
            session.status = "privacy_blocked"
            session.warning = str(
                sig_res.get("request_warning")
                or (req_res and req_res.get("msg"))
                or "Đối phương hiện không nhận cuộc gọi từ người lạ (hoặc chưa kết bạn trên Zalo)."
            )
            session.ended_at = time.time()
            session.close_media()
        elif sig_status == "rejected" or (raw_status is not None and int(raw_status) != 0):
            session.status = "rejected"
            session.warning = str(
                sig_res.get("request_warning")
                or (req_res and req_res.get("msg"))
                or f"Cuộc gọi bị từ chối từ Zalo (status: {raw_status})."
            )
            session.ended_at = time.time()
            session.close_media()
        elif sig_res.get("ok") is False or sig_res.get("call_ok") is False:
            session.status = "failed"
            session.warning = str(sig_res.get("request_warning") or "Không thể khởi tạo cuộc gọi.")
            session.ended_at = time.time()
            session.close_media()
        else:
            session.status = "ringing"
            if sig_res.get("request_warning"):
                session.warning = str(sig_res["request_warning"])

            # Gửi gói bắt tay AES Transport Frame 49$ đầu tiên tới Relay :4200
            if session.udp_transport and session.remote_rtp_addr:
                try:
                    initial_handshake = encrypt_zcall_transport_frame(
                        "49",
                        {
                            "callId": session.call_id,
                            "sessId": session.zalo_sess_id,
                            "userId": session.account_id,
                            "toId": session.callee_id,
                            "status": 0,
                            "ts": int(time.time() * 1000),
                        },
                    )
                    session.udp_transport.sendto(initial_handshake, session.remote_rtp_addr)
                    for srv in session.relay_servers[:2]:
                        session.udp_transport.sendto(initial_handshake, srv)
                    logger.info(f"[VOIP-HANDSHAKE] Initial AES frame sent to relay {session.remote_rtp_addr}")
                except Exception as hs_err:
                    logger.debug(f"[VOIP-HANDSHAKE] Initial frame error: {hs_err}")
            
            # Tự động gửi 11304 answerack và keepalive RTP định kỳ mỗi giây:
            # Khi khách hàng bấm 'Trả lời' trên điện thoại di động, Zalo Voice Server sẽ ngay lập tức
            # khớp gói 11304 từ Caller, chuyển màn hình điện thoại khách từ 'Đang vào cuộc gọi...'
            # sang màn hình đàm thoại đếm giây (00:01, 00:02...) trong 0ms!
            asyncio.create_task(_auto_answer_ack_loop(session, auth))
    except Exception as sig_exc:
        session.warning = str(sig_exc)
        session.status = "failed"
        session.ended_at = time.time()
        session.close_media()

    await session.broadcast_json({"type": "call_state", **session.to_dict()})
    return session


async def perform_call_action(
    session_id: str,
    action: str,
    *,
    result_code: Optional[str] = None,
) -> ZaloCallSession:
    """Thực thi hành động trên phiên gọi đang mở: cancel (11305), end (11306+11311), answer_ack."""
    session = _CALL_SESSIONS.get(session_id)
    if not session:
        raise KeyError(f"Không tìm thấy phiên gọi: {session_id}")

    act = (action or "").strip().lower()
    auth = await load_zca_auth(session.account_id)

    if act == "cancel":
        session.status = "cancelled"
        session.ended_at = time.time()
        session.close_media()
        asyncio.create_task(notify_zrtc_worker_event(session.zrtc_worker_id, "end_call", {"session_id": session.session_id}))
        if auth and session.callee_id:
            try:
                await cancel_zca_voice_call(
                    auth,
                    to_id=session.callee_id,
                    call_id=session.call_id,
                    call_type=session.call_type,
                )
            except Exception as exc:
                session.warning = str(exc)
        await _record_session_kpi_and_history(session, result_code=result_code or "noanswer")

    elif act in ("end", "hangup"):
        session.status = "ended"
        session.ended_at = time.time()
        dur = session.duration_sec
        session.close_media()
        asyncio.create_task(notify_zrtc_worker_event(session.zrtc_worker_id, "end_call", {"session_id": session.session_id}))
        if auth and session.callee_id:
            try:
                await end_zca_voice_call(
                    auth,
                    uid_to=session.callee_id,
                    call_id=session.call_id,
                    duration=dur,
                    status=3,
                    role=1,
                    log_end=True,
                )
            except Exception as exc:
                session.warning = str(exc)
        await _record_session_kpi_and_history(session, result_code=result_code)

    elif act in ("mark_connected", "answer_ack", "answer"):
        if session.connected_at is None:
            session.connected_at = time.time()
        session.status = "connected"
        
        # Bắn gói tin keepalive RTP liên tục (burst 50 gói x 20ms = 1 giây) để mở thông cổng NAT
        async def _manual_burst() -> None:
            try:
                for _ in range(50):
                    if session.status != "connected":
                        break
                    session.send_audio_from_browser(OPUS_SILENCE_FRAME, payload_type=OPUS_PAYLOAD_TYPE)
                    await asyncio.sleep(0.02)
            except Exception:
                pass
        asyncio.create_task(_manual_burst())

        if auth and session.callee_id:
            try:
                await send_zca_call_signal(
                    auth,
                    11304,
                    {"calleeId": session.callee_id, "callId": session.call_id},
                )
                logger.info(f"[VOIP] Manual 11304 answerack sent for session={session.session_id}")
            except Exception as exc:
                logger.warning(f"Manual answer_ack signal failed: {exc}")

    await session.broadcast_json({"type": "call_state", "session": session.to_dict(), **session.to_dict()})
    return session


async def handle_incoming_voip_signal(
    *,
    account_id: str,
    act: str,
    mapped_status: str,
    call_id: Any,
    partner_id: str,
    data: Dict[str, Any],
) -> Optional[ZaloCallSession]:
    """Đồng bộ tín hiệu VoIP từ WebSocket listener vào phiên gọi đang mở (Module 2 -> Module 3/4)."""
    acc = (account_id or "").strip().lower()
    matched: Optional[ZaloCallSession] = None

    for s in reversed(list(_CALL_SESSIONS.values())):
        if s.account_id.strip().lower() != acc:
            continue
        if call_id is not None and str(s.call_id) == str(call_id):
            matched = s
            break
        if partner_id and s.callee_id == partner_id and s.status in ("dialing", "ringing", "connected"):
            matched = s
            break

    # Fallback: nếu ID đối tác lệch giữa 32-bit toId và 64-bit UID, ghép nối ngay với phiên active duy nhất của tài khoản
    if not matched:
        for s in reversed(list(_CALL_SESSIONS.values())):
            if s.account_id.strip().lower() == acc and s.status in ("dialing", "ringing", "connected"):
                matched = s
                break

    if not matched:
        logger.info(f"[VOIP] No active session matched for user={account_id} act={act} call_id={call_id} partner_id={partner_id}")
        return None

    remote_rtp = (
        data.get("rtpAddress")
        or data.get("rtp_address")
        or data.get("relayAddress")
        or data.get("rtpIP")
    )
    parsed_addr = _parse_host_port(remote_rtp)
    if parsed_addr:
        matched.remote_rtp_addr = parsed_addr

    raw_status = str(data.get("status") if isinstance(data, dict) else "").strip()
    is_early_negotiation = (act == "answer" and raw_status == "5")

    # Bóc tách và cập nhật candidate P2P từ Callee nếu có
    params_obj: Dict[str, Any] = {}
    raw_params = data.get("params")
    if isinstance(raw_params, str) and raw_params.strip():
        try:
            params_obj = json.loads(raw_params)
        except Exception:
            params_obj = {}
    elif isinstance(raw_params, dict):
        params_obj = raw_params
    callee_extend = data.get("extendData") or params_obj.get("extendData") or ""
    if isinstance(callee_extend, str) and callee_extend.strip():
        try:
            ext_json = json.loads(callee_extend)
            p2p_list = ext_json.get("p2p") or []
            if isinstance(p2p_list, list) and len(p2p_list) > 0:
                p2p_first = p2p_list[0]
                if isinstance(p2p_first, dict) and p2p_first.get("ip") and p2p_first.get("port"):
                    p2p_addr = (str(p2p_first["ip"]), int(p2p_first["port"]))
                    matched.p2p_target = p2p_addr
                    if matched.udp_transport:
                        try:
                            hs = encrypt_zcall_transport_frame(
                                "49",
                                {
                                    "callId": matched.call_id,
                                    "sessId": matched.zalo_sess_id,
                                    "userId": matched.account_id,
                                    "toId": matched.callee_id,
                                    "status": 0,
                                    "ts": int(time.time() * 1000),
                                },
                            )
                            matched.udp_transport.sendto(hs, p2p_addr)
                            logger.info(f"[VOIP-P2P] Sent 49$ handshake to callee P2P: {p2p_addr}")
                        except Exception as p2p_err:
                            logger.debug(f"[VOIP-P2P] Pinhole error: {p2p_err}")
        except Exception:
            pass

    # Nếu có ZRTC Media Worker, chuyển ngay codec & extendData của máy khách vào Worker
    if matched.zrtc_worker_id and (data.get("codec") or callee_extend):
        callee_codec = data.get("codec") or params_obj.get("codec") or _DEFAULT_ZRTC_CODECS_JSON
        asyncio.create_task(
            notify_zrtc_worker_event(
                matched.zrtc_worker_id,
                "update_caller_info",
                {
                    "session_id": matched.session_id,
                    "codec": callee_codec if isinstance(callee_codec, str) else json.dumps(callee_codec),
                    "extend_data": callee_extend if isinstance(callee_extend, str) else json.dumps(callee_extend),
                },
            )
        )

    if is_early_negotiation:
        # Gói đàm phán sớm P2P khi máy khách bắt đầu đổ chuông, TUYỆT ĐỐI KHÔNG chuyển connected và KHÔNG gửi 11304 sớm!
        matched.status = "ringing"
        logger.info(
            f"[VOIP-NEGOTIATE] Callee P2P/SDP negotiation received (status=5) for session={matched.session_id}. "
            f"Keeping ringing, NOT dispatching premature 11304 AnswerAck."
        )
        await matched.broadcast_json({"type": "call_state", "session": matched.to_dict(), **matched.to_dict()})
        return matched

    if mapped_status in ("ringing", "ring_ring"):
        matched.status = "ringing"
    elif mapped_status == "connected":
        if matched.connected_at is None:
            matched.connected_at = time.time()
        matched.status = "connected"

        if not matched.zrtc_worker_id:
            asyncio.create_task(_media_watchdog_loop(matched))

        # Bắn gói tin keepalive RTP liên tục (burst 50 gói x 20ms = 1 giây) để mở thông cổng NAT và đồng bộ media
        async def _keepalive_burst() -> None:
            try:
                for _ in range(50):
                    if matched.status != "connected":
                        break
                    matched.send_audio_from_browser(OPUS_SILENCE_FRAME, payload_type=OPUS_PAYLOAD_TYPE)
                    await asyncio.sleep(0.02)
            except Exception as e:
                logger.debug(f"[VOIP] Keepalive burst error: {e}")
        asyncio.create_task(_keepalive_burst())

        # Tự động gửi ACK 11304 (answerack) giống Zalo PC
        target_callee = str(data.get("calleeId") or matched.callee_id or partner_id)
        effective_call_id = int(data.get("callId") or matched.call_id)

        async def _dispatch_answer_ack() -> None:
            try:
                auth = await load_zca_auth(matched.account_id)
                if not auth:
                    return
                logger.info(
                    f"[VOIP-ANSWERACK] Sending 11304 for session={matched.session_id} "
                    f"calleeId={target_callee} callId={effective_call_id}"
                )
                ack_res = await send_zca_call_signal(
                    auth,
                    11304,
                    {"calleeId": target_callee, "callId": effective_call_id},
                )
                logger.info(f"[VOIP-ANSWERACK] Result: {ack_res}")

                if matched.callee_id and str(matched.callee_id) != target_callee:
                    await send_zca_call_signal(
                        auth,
                        11304,
                        {"calleeId": str(matched.callee_id), "callId": effective_call_id},
                    )
            except Exception as ack_err:
                logger.warning(f"[VOIP-ANSWERACK] Dispatch failed for session={matched.session_id}: {ack_err}")

        asyncio.create_task(_dispatch_answer_ack())
    elif mapped_status in ("ended", "cancelled", "rejected", "busy"):
        matched.status = mapped_status
        matched.ended_at = time.time()
        matched.close_media()
        asyncio.create_task(notify_zrtc_worker_event(matched.zrtc_worker_id, "end_call", {"session_id": matched.session_id}))
        await _record_session_kpi_and_history(matched)

    await matched.broadcast_json(
        {
            "type": "call_state",
            "voip_act": act,
            "session": matched.to_dict(),
            **matched.to_dict(),
        }
    )
    return matched
