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

# ── RFC 3550 RTP Packet Builder & Parser ──────────────────────────────────────

def build_rtp_packet(
    payload: bytes,
    *,
    seq: int,
    timestamp: int,
    ssrc: int,
    payload_type: int = 111,
    marker: bool = False,
) -> bytes:
    """Đóng gói khung âm thanh (Opus PT=111 hoặc PCMU PT=0) vào gói tin RTP 12-byte chuẩn RFC 3550."""
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

        # Gói tin RTP âm thanh từ máy chủ Zalo Relay -> Giải mã & đẩy về WebSocket trình duyệt
        parsed = parse_rtp_packet(data)
        if parsed and parsed.get("payload"):
            self.session.packets_received += 1
            if not self.session.remote_rtp_addr:
                self.session.remote_rtp_addr = addr
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

    # RTP state
    ssrc: int = field(default_factory=lambda: random.randint(100000, 0x7FFFFFFF))
    seq: int = 0
    rtp_timestamp: int = 0
    packets_sent: int = 0
    packets_received: int = 0
    udp_transport: Optional[asyncio.DatagramTransport] = None
    ws_clients: Set[WebSocket] = field(default_factory=set)

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
            "packets_sent": self.packets_sent,
            "packets_received": self.packets_received,
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

    def send_audio_from_browser(self, audio_frame: bytes, payload_type: int = 111) -> None:
        """Nhận khung âm thanh từ trình duyệt nhân viên -> đóng gói RTP 12-byte -> gửi UDP tới Zalo."""
        self.seq = (self.seq + 1) & 0xFFFF
        self.rtp_timestamp = (self.rtp_timestamp + 960) & 0xFFFFFFFF
        self.packets_sent += 1
        if self.udp_transport and self.remote_rtp_addr:
            pkt = build_rtp_packet(
                audio_frame,
                seq=self.seq,
                timestamp=self.rtp_timestamp,
                ssrc=self.ssrc,
                payload_type=payload_type,
            )
            try:
                self.udp_transport.sendto(pkt, self.remote_rtp_addr)
            except Exception as exc:
                logger.debug(f"UDP RTP sendto failed for session={self.session_id}: {exc}")

    def close_media(self) -> None:
        if self.udp_transport is not None:
            try:
                self.udp_transport.close()
            except Exception:
                pass
            self.udp_transport = None


# ── In-Memory Registry ────────────────────────────────────────────────────────

_CALL_SESSIONS: Dict[str, ZaloCallSession] = {}


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


async def _auto_answer_ack_loop(session: ZaloCallSession, auth: Dict[str, Any]) -> None:
    """Tự động gửi 11304 answerack và keepalive RTP định kỳ mỗi giây:
    - Khi khách hàng bấm 'Trả lời' trên điện thoại di động, Zalo Voice Server sẽ ngay lập tức
      nhận gói 11304 answerack từ Caller, chuyển màn hình điện thoại khách từ 'Đang vào cuộc gọi...'
      sang màn hình đàm thoại đếm giây (00:01, 00:02...) trong 0ms!
    - Đồng thời tự động phát hiện khi khách đã nhấc máy để chuyển Web CRM sang 'connected'.
    """
    callee_target = session.callee_id
    internal_to_id = None
    if isinstance(session.signaling_data, dict):
        s1 = session.signaling_data.get("requestcall_result") or session.signaling_data
        if isinstance(s1, dict) and s1.get("toId"):
            internal_to_id = str(s1["toId"])

    # Chờ 1.0s để máy khách đổ chuông ổn định
    await asyncio.sleep(1.0)

    attempts = 0
    while session.status == "ringing" and attempts < 45:
        attempts += 1

        # Gửi gói RTP keepalive để mở thông cổng NAT
        if session.udp_transport and session.remote_rtp_addr:
            try:
                session.send_audio_from_browser(b"\x00" * 320)
            except Exception:
                pass

        # Gửi 11304 answerack tới Zalo Voice Server
        try:
            ack_res = await send_zca_call_signal(
                auth,
                11304,
                {"calleeId": str(callee_target), "callId": session.call_id},
            )
            # Gửi thêm với internal toId nếu có và khác calleeId
            if internal_to_id and internal_to_id != str(callee_target) and session.status == "ringing":
                await send_zca_call_signal(
                    auth,
                    11304,
                    {"calleeId": str(internal_to_id), "callId": session.call_id},
                )

            # Nếu Zalo Voice Server phản hồi chứa callerId / calleeId (xác nhận phiên đàm thoại hợp lệ)
            # và đã qua ít nhất 2 lần gửi ACK (~2.5-3 giây sau khi gọi), tự động nâng cấp sang "connected"!
            if isinstance(ack_res, dict) and (ack_res.get("callerId") or ack_res.get("calleeId")):
                if attempts >= 2 and session.status == "ringing":
                    if session.connected_at is None:
                        session.connected_at = time.time()
                    session.status = "connected"
                    logger.info(f"[AUTO-ACK] Call auto-connected for session={session.session_id} after {attempts}s")
                    await session.broadcast_json({"type": "call_state", "session": session.to_dict(), **session.to_dict()})

                    # Bắn chuỗi 50 gói RTP keepalive (20ms = 1s)
                    for _ in range(50):
                        if session.status != "connected":
                            break
                        session.send_audio_from_browser(b"\x00" * 320)
                        await asyncio.sleep(0.02)
                    break
        except Exception as e:
            logger.debug(f"[AUTO-ACK] 11304 signal attempt {attempts} error: {e}")

        await asyncio.sleep(1.0)


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
    try:
        sig_res = await start_zca_voice_call(
            auth,
            callee_id=initial_callee,
            phone=phone_number,
            call_id=session.call_id,
            call_type=session.call_type,
            rtp_address=session.local_rtp_address,
            rtcp_address=session.local_rtcp_address,
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
            )
            parsed_remote = _parse_host_port(remote_candidate)
            if parsed_remote:
                session.remote_rtp_addr = parsed_remote
            raw_status = req_res.get("status")

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
                    session.send_audio_from_browser(b"\x00" * 320)
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
                if isinstance(session.signaling_data, dict):
                    s1 = session.signaling_data.get("requestcall_result") or session.signaling_data
                    if isinstance(s1, dict) and s1.get("toId") and str(s1["toId"]) != str(session.callee_id):
                        await send_zca_call_signal(
                            auth,
                            11304,
                            {"calleeId": str(s1["toId"]), "callId": session.call_id},
                        )
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

    if mapped_status == "ringing" and matched.status == "dialing":
        matched.status = "ringing"
    elif mapped_status == "connected":
        if matched.connected_at is None:
            matched.connected_at = time.time()
        matched.status = "connected"

        # Bắn gói tin keepalive RTP liên tục (burst 50 gói x 20ms = 1 giây) để mở thông cổng NAT và đồng bộ media
        async def _keepalive_burst() -> None:
            try:
                for _ in range(50):
                    if matched.status != "connected":
                        break
                    matched.send_audio_from_browser(b"\x00" * 320)
                    await asyncio.sleep(0.02)
            except Exception as e:
                logger.debug(f"[VOIP] Keepalive burst error: {e}")
        asyncio.create_task(_keepalive_burst())

        # Tự động gửi ACK 11304 (answerack) giống Zalo PC
        target_callee = str(data.get("calleeId") or matched.callee_id or partner_id)
        effective_call_id = int(data.get("callId") or matched.call_id)
        internal_to_id = None
        if isinstance(matched.signaling_data, dict):
            s1 = matched.signaling_data.get("requestcall_result") or matched.signaling_data
            if isinstance(s1, dict) and s1.get("toId"):
                internal_to_id = str(s1["toId"])

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

                # Nếu matched.callee_id khác với target_callee, gửi thêm với matched.callee_id
                if matched.callee_id and str(matched.callee_id) != target_callee:
                    await send_zca_call_signal(
                        auth,
                        11304,
                        {"calleeId": str(matched.callee_id), "callId": effective_call_id},
                    )

                # Gửi thêm với internal toId 32-bit nếu có
                if internal_to_id and internal_to_id not in (target_callee, str(matched.callee_id)):
                    await send_zca_call_signal(
                        auth,
                        11304,
                        {"calleeId": internal_to_id, "callId": effective_call_id},
                    )
            except Exception as ack_err:
                logger.warning(f"[VOIP-ANSWERACK] Dispatch failed for session={matched.session_id}: {ack_err}")

        asyncio.create_task(_dispatch_answer_ack())
    elif mapped_status in ("ended", "cancelled", "rejected", "busy"):
        matched.status = mapped_status
        matched.ended_at = time.time()
        matched.close_media()
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
