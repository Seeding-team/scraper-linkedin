"""Dual-Mode WhatsApp Call Engine.

Supports all three real-world WhatsApp calling paths cleanly and honestly:
- **Mode A (Baileys Call Signaling)**: Persists inbound ``call`` events emitted by
  ``wa_persistent_bridge.mjs``, writes native ``call_log`` cards into ``whatsapp_messages``,
  broadcasts realtime SSE ``call_event``, supports ``rejectCall`` + custom auto-reply,
  and automatically enforces per-account ``auto_reject_calls`` rules.
- **Mode B (Meta Official WhatsApp Business Calling API — WebRTC Opus)**:
  * Outbound call: ``POST /{cloud_phone_number_id}/calls`` with ``action="connect"`` + SDP Offer.
  * Inbound call webhook: processes ``session.sdp`` offer -> SSE ``call_event`` -> FE accepts ->
    ``pre_accept`` + ``accept`` with SDP Answer.
  * Terminate call: ``action="terminate"``.
- **Mode C (Personal Account Outbound Handoff)**: When an account uses personal QR/Pairing
  without Meta Cloud Calling credentials, logs the outbound call intent and returns a
  ``whatsapp://call?phone=...`` deep link + honest protocol note.
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx
from fastapi import HTTPException
from loguru import logger

from app.modules.all_platform.whatsapp.config import (
    decrypt_cloud_token,
    get_meta_graph_api_base,
    get_webhook_verify_token,
)
from app.modules.all_platform.whatsapp.services import (
    bridge_manager,
    message_events,
    whatsapp_repo,
)

_BAILEYS_STATUS_MAP: Dict[str, str] = {
    "offer": "ringing",
    "ringing": "ringing",
    "preaccept": "pre_accepted",
    "accept": "connected",
    "reject": "rejected",
    "timeout": "missed",
    "terminate": "ended",
}

# Non-lifecycle WebRTC/relay telemetry statuses emitted by Baileys v7 ev.on('call')
_BAILEYS_IGNORED_STATUSES = frozenset({"transport", "relaylatency"})

_CALL_STATUS_LABELS: Dict[str, str] = {
    "ringing": "Đang đổ chuông",
    "pre_accepted": "Đang kết nối",
    "connected": "Đã kết nối",
    "rejected": "Đã từ chối",
    "missed": "Cuộc gọi nhỡ",
    "ended": "Cuộc gọi kết thúc",
    "failed": "Cuộc gọi thất bại",
}

PERSONAL_HANDOFF_PROTOCOL_NOTE = (
    "Tài khoản WhatsApp cá nhân (kết nối QR/Pairing) dùng giao thức VoIP C++ riêng trên thiết bị gốc; "
    "bấm 'Mở gọi trên WhatsApp PC' để quay số nhanh, hoặc bật Meta WhatsApp Business Calling API "
    "trong Cài đặt tài khoản để gọi WebRTC 2 chiều trực tiếp ngay trên trình duyệt."
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _digits_only(value: Optional[str]) -> str:
    if not value:
        return ""
    return "".join(ch for ch in str(value) if ch.isdigit())


def _parse_iso(ts: Optional[str]) -> Optional[datetime]:
    if not ts:
        return None
    try:
        raw = str(ts).replace("Z", "+00:00")
        return datetime.fromisoformat(raw)
    except Exception:
        return None


def _compute_duration_seconds(started_at: Optional[str], ended_at: Optional[str]) -> int:
    start_dt = _parse_iso(started_at)
    end_dt = _parse_iso(ended_at)
    if not start_dt or not end_dt:
        return 0
    return max(0, int((end_dt - start_dt).total_seconds()))


def _build_call_card_text(direction: str, call_type: str, status: str, duration_seconds: int = 0) -> str:
    kind_vi = "Cuộc gọi video" if call_type == "video" else "Cuộc gọi thoại"
    dir_vi = "đi" if direction == "outbound" else "đến"
    label = _CALL_STATUS_LABELS.get(status, status)
    if duration_seconds > 0 and status == "ended":
        mins, secs = divmod(duration_seconds, 60)
        dur = f"{mins:02d}:{secs:02d}"
        return f"{kind_vi} {dir_vi} • {label} ({dur})"
    return f"{kind_vi} {dir_vi} • {label}"


async def _upsert_call_message_card(
    account_id: str,
    *,
    id_member: Optional[str],
    call_log: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    """Mirror a call log entry as a native ``call_log`` bubble inside ``whatsapp_messages``."""
    chat_jid = str(call_log.get("chat_jid") or call_log.get("peer_jid") or "").strip()
    if not chat_jid:
        peer_phone = _digits_only(call_log.get("peer_phone"))
        if peer_phone:
            chat_jid = f"{peer_phone}@s.whatsapp.net"
    if not chat_jid:
        return None

    call_id = str(call_log.get("call_id") or "")
    direction = str(call_log.get("direction") or "inbound")
    call_type = str(call_log.get("call_type") or "audio")
    status = str(call_log.get("status") or "ringing")
    duration_seconds = int(call_log.get("duration_seconds") or 0)
    card_text = _build_call_card_text(direction, call_type, status, duration_seconds)

    msg_row = {
        "account_id": account_id,
        "chat_jid": chat_jid,
        "message_id": f"call_{call_id}",
        "sender_jid": call_log.get("peer_jid"),
        "sender_phone": call_log.get("peer_phone"),
        "sender_name": call_log.get("peer_name"),
        "is_outgoing": direction == "outbound",
        "msg_type": "call_log",
        "text": card_text,
        "metadata": {
            "call_id": call_id,
            "direction": direction,
            "call_type": call_type,
            "call_mode": call_log.get("call_mode") or "baileys_signal",
            "call_status": status,
            "duration_seconds": duration_seconds,
            "peer_phone": call_log.get("peer_phone"),
            "peer_name": call_log.get("peer_name"),
            **(call_log.get("metadata") or {}),
        },
        "reactions": [],
        "raw_key": {},
        "ack_status": "read" if status in ("ended", "connected") else "sent",
        "is_edited": False,
        "is_deleted": False,
        "sent_at": call_log.get("started_at") or _now_iso(),
    }
    saved_msg = await whatsapp_repo.upsert_message(msg_row)
    conv = await whatsapp_repo.touch_conversation(
        account_id,
        chat_jid,
        title=call_log.get("peer_name") or call_log.get("peer_phone"),
        phone_number=call_log.get("peer_phone"),
        last_message_at=msg_row["sent_at"],
        last_message_preview=card_text,
        increment_unread=(direction == "inbound" and status in ("missed", "ringing")),
    )
    await message_events.publish_whatsapp_event(
        account_id,
        "message",
        {"chat_jid": chat_jid, "message": saved_msg},
        id_member=id_member,
    )
    await message_events.publish_whatsapp_event(
        account_id,
        "conversation_update",
        {"action": "call_log", "conversation": conv},
        id_member=id_member,
    )
    return saved_msg


# ── Mode A: Baileys Call Signaling ────────────────────────────────────────────

async def handle_baileys_call_event(account_id: str, event: Dict[str, Any]) -> Dict[str, Any]:
    """Handle an inbound ``call`` event from ``wa_persistent_bridge.mjs``."""
    call_id = str(event.get("call_id") or uuid.uuid4().hex).strip()
    caller_jid = str(event.get("caller_jid") or event.get("from") or "").strip()
    caller_pn = _digits_only(event.get("caller_pn") or caller_jid)
    chat_jid = str(event.get("chat_jid") or caller_jid or (f"{caller_pn}@s.whatsapp.net" if caller_pn else "")).strip()
    raw_status = str(event.get("status") or "offer").strip().lower()
    if raw_status in _BAILEYS_IGNORED_STATUSES:
        existing_ignored = await whatsapp_repo.get_call_log(account_id, call_id)
        return existing_ignored or {"account_id": account_id, "call_id": call_id, "status": "ignored"}
    mapped_status = _BAILEYS_STATUS_MAP.get(raw_status, "ringing")
    call_type = "video" if event.get("is_video") else "audio"
    peer_name = (
        str(event.get("caller_name") or "").strip()
        or bridge_manager.lookup_contact_name(account_id, caller_jid)
        or caller_pn
        or caller_jid
    )

    account = await whatsapp_repo.get_account(account_id)
    id_member = str(account.get("id_member")) if account and account.get("id_member") else None
    existing = await whatsapp_repo.get_call_log(account_id, call_id)

    now = _now_iso()
    started_at = (existing or {}).get("started_at") or str(event.get("timestamp") or now)
    ended_at = now if mapped_status in ("rejected", "missed", "ended", "failed") else None
    duration_seconds = (
        _compute_duration_seconds(started_at, ended_at)
        if ended_at and (existing or {}).get("status") == "connected"
        else int((existing or {}).get("duration_seconds") or 0)
    )

    row: Dict[str, Any] = {
        "account_id": account_id,
        "call_id": call_id,
        "chat_jid": chat_jid or None,
        "peer_jid": caller_jid or None,
        "peer_phone": caller_pn or None,
        "peer_name": peer_name or None,
        "direction": "inbound",
        "call_type": call_type,
        "call_mode": "baileys_signal",
        "status": mapped_status,
        "duration_seconds": duration_seconds,
        "started_at": started_at,
        "ended_at": ended_at,
        "metadata": {
            "raw_status": raw_status,
            "is_group": bool(event.get("is_group", False)),
        },
    }
    saved = await whatsapp_repo.upsert_call_log(row)
    await _upsert_call_message_card(account_id, id_member=id_member, call_log=saved)

    await message_events.publish_whatsapp_event(
        account_id,
        "call_event",
        {
            "sub_event": "incoming_call" if (mapped_status == "ringing" and not bool(event.get("offline"))) else "call_status",
            "call": saved,
            "call_id": call_id,
            "caller_jid": caller_jid,
            "caller_phone": caller_pn,
            "caller_name": peer_name,
            "chat_jid": chat_jid,
            "call_type": call_type,
            "call_mode": "baileys_signal",
            "status": mapped_status,
            "offline": bool(event.get("offline", False)),
            "can_webrtc_answer": False,
        },
        id_member=id_member,
    )

    # Automatic call rejection rule configured on account settings (skip historical offline call sync)
    if mapped_status == "ringing" and not bool(event.get("offline")) and account and account.get("auto_reject_calls"):
        auto_msg = (account.get("auto_reject_message") or "").strip() or None
        try:
            await reject_call(
                None,
                account_id,
                call_id,
                caller_jid or chat_jid,
                auto_reply_text=auto_msg,
                _bypass_auth=True,
            )
        except Exception:
            logger.exception(f"[WhatsApp {account_id}] Tự động từ chối cuộc gọi {call_id} thất bại")

    return saved


async def reject_call(
    user: Optional[Dict[str, Any]],
    account_id: str,
    call_id: str,
    caller_jid: str,
    *,
    auto_reply_text: Optional[str] = None,
    _bypass_auth: bool = False,
) -> Dict[str, Any]:
    """Reject an incoming call (Baileys ``rejectCall`` or Meta Cloud ``terminate``) + optional auto-reply."""
    from app.modules.all_platform.whatsapp.services import whatsapp_service

    if not _bypass_auth:
        account = await whatsapp_service.ensure_account_access(user or {}, account_id)
    else:
        account = await whatsapp_repo.get_account(account_id)
        if not account:
            raise HTTPException(404, "Không tìm thấy tài khoản WhatsApp.")

    id_member = str(account.get("id_member")) if account.get("id_member") else None
    existing = await whatsapp_repo.get_call_log(account_id, call_id)
    call_mode = (existing or {}).get("call_mode") or "baileys_signal"

    bridge_rejected = False
    cloud_terminated = False
    if call_mode == "cloud_webrtc" and account.get("cloud_calling_enabled"):
        try:
            await _call_meta_calling_api(
                account,
                {
                    "messaging_product": "whatsapp",
                    "call_id": call_id,
                    "action": "terminate",
                },
            )
            cloud_terminated = True
        except Exception as exc:
            logger.warning(f"[WhatsApp {account_id}] Meta Cloud reject/terminate call {call_id} failed: {exc}")
    else:
        if bridge_manager.is_bridge_running(account_id):
            await bridge_manager.send_command(
                account_id,
                "reject_call",
                {"call_id": call_id, "caller_jid": caller_jid},
            )
            bridge_rejected = True

    now = _now_iso()
    chat_jid = (existing or {}).get("chat_jid") or caller_jid
    peer_phone = (existing or {}).get("peer_phone") or _digits_only(caller_jid)
    row = {
        "account_id": account_id,
        "call_id": call_id,
        "chat_jid": chat_jid or None,
        "peer_jid": caller_jid or (existing or {}).get("peer_jid"),
        "peer_phone": peer_phone or None,
        "peer_name": (existing or {}).get("peer_name") or peer_phone,
        "direction": (existing or {}).get("direction") or "inbound",
        "call_type": (existing or {}).get("call_type") or "audio",
        "call_mode": call_mode,
        "status": "rejected",
        "duration_seconds": 0,
        "started_at": (existing or {}).get("started_at") or now,
        "ended_at": now,
        "metadata": {
            **((existing or {}).get("metadata") or {}),
            "rejected_via_bridge": bridge_rejected,
            "rejected_via_cloud": cloud_terminated,
            "auto_reply_sent": bool((auto_reply_text or "").strip()),
        },
    }
    saved = await whatsapp_repo.upsert_call_log(row)
    await _upsert_call_message_card(account_id, id_member=id_member, call_log=saved)

    auto_reply_message: Optional[Dict[str, Any]] = None
    reply_text = (auto_reply_text or "").strip()
    if reply_text and chat_jid and bridge_manager.is_bridge_running(account_id):
        try:
            auto_reply_message = await whatsapp_service.send_text_internal(
                account_id,
                chat_jid,
                reply_text,
                id_member=id_member,
            )
        except Exception:
            logger.exception(f"[WhatsApp {account_id}] Gửi tin nhắn tự động sau khi từ chối cuộc gọi thất bại")

    await message_events.publish_whatsapp_event(
        account_id,
        "call_event",
        {
            "sub_event": "call_status",
            "call": saved,
            "call_id": call_id,
            "chat_jid": chat_jid,
            "status": "rejected",
            "call_mode": call_mode,
            "auto_reply_message": auto_reply_message,
        },
        id_member=id_member,
    )
    return {
        "call": saved,
        "rejected": True,
        "bridge_rejected": bridge_rejected,
        "cloud_terminated": cloud_terminated,
        "auto_reply_message": auto_reply_message,
    }


# ── Mode B: Meta Official WhatsApp Business Calling API (WebRTC) ──────────────

async def _call_meta_calling_api(
    account: Dict[str, Any],
    payload: Dict[str, Any],
) -> Dict[str, Any]:
    phone_number_id = (account.get("cloud_phone_number_id") or "").strip()
    enc_token = (account.get("cloud_access_token_enc") or "").strip()
    if not phone_number_id or not enc_token:
        raise HTTPException(
            400,
            "Tài khoản chưa cấu hình đầy đủ Meta Cloud Calling API (Phone Number ID & Access Token).",
        )
    try:
        access_token = decrypt_cloud_token(enc_token)
    except ValueError as exc:
        raise HTTPException(400, str(exc))

    url = f"{get_meta_graph_api_base()}/{phone_number_id}/calls"
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.post(url, json=payload, headers=headers)
    try:
        body = resp.json()
    except Exception:
        body = {"raw_text": resp.text}
    if resp.status_code >= 400:
        err_msg = (
            (body.get("error") or {}).get("message")
            if isinstance(body, dict) and isinstance(body.get("error"), dict)
            else str(body)[:400]
        )
        raise HTTPException(
            502,
            f"Meta WhatsApp Cloud Calling API trả lỗi ({resp.status_code}): {err_msg}",
        )
    return body if isinstance(body, dict) else {"result": body}


def _has_cloud_calling_ready(account: Dict[str, Any]) -> bool:
    return bool(
        account.get("cloud_calling_enabled")
        and (account.get("cloud_phone_number_id") or "").strip()
        and (account.get("cloud_access_token_enc") or "").strip()
    )


async def initiate_outbound_call(
    user: Dict[str, Any],
    account_id: str,
    *,
    chat_jid: Optional[str],
    target_phone: str,
    is_video: bool = False,
    sdp_offer: Optional[str] = None,
) -> Dict[str, Any]:
    """Initiate an outbound call: Mode B (Meta Cloud WebRTC) when configured, else Mode C (Handoff)."""
    from app.modules.all_platform.whatsapp.services import whatsapp_service

    account = await whatsapp_service.ensure_account_access(user, account_id)
    id_member = str(account.get("id_member")) if account.get("id_member") else None
    digits = _digits_only(target_phone) or _digits_only(chat_jid)
    if not digits:
        raise HTTPException(400, "Số điện thoại người nhận không hợp lệ.")
    resolved_chat_jid = (chat_jid or "").strip() or f"{digits}@s.whatsapp.net"
    call_type = "video" if is_video else "audio"
    peer_name = bridge_manager.lookup_contact_name(account_id, resolved_chat_jid) or digits

    # Mode B: Meta Official WhatsApp Business Calling API (WebRTC Opus)
    if _has_cloud_calling_ready(account) and (sdp_offer or "").strip():
        meta_payload = {
            "messaging_product": "whatsapp",
            "to": digits,
            "action": "connect",
            "session": {
                "sdp_type": "offer",
                "sdp": sdp_offer,
            },
        }
        meta_resp = await _call_meta_calling_api(account, meta_payload)
        calls_arr = meta_resp.get("calls") if isinstance(meta_resp.get("calls"), list) else []
        call_id = (
            str((calls_arr[0] or {}).get("id") or "").strip()
            if calls_arr and isinstance(calls_arr[0], dict)
            else str(meta_resp.get("id") or f"cloud_{uuid.uuid4().hex[:16]}")
        )
        now = _now_iso()
        call_row = {
            "account_id": account_id,
            "call_id": call_id,
            "chat_jid": resolved_chat_jid,
            "peer_jid": resolved_chat_jid,
            "peer_phone": digits,
            "peer_name": peer_name,
            "direction": "outbound",
            "call_type": call_type,
            "call_mode": "cloud_webrtc",
            "status": "ringing",
            "duration_seconds": 0,
            "sdp_offer": sdp_offer,
            "started_at": now,
            "metadata": {"meta_response": meta_resp},
        }
        saved = await whatsapp_repo.upsert_call_log(call_row)
        await _upsert_call_message_card(account_id, id_member=id_member, call_log=saved)
        await message_events.publish_whatsapp_event(
            account_id,
            "call_event",
            {
                "sub_event": "outbound_ringing",
                "call": saved,
                "call_id": call_id,
                "chat_jid": resolved_chat_jid,
                "peer_phone": digits,
                "peer_name": peer_name,
                "call_type": call_type,
                "call_mode": "cloud_webrtc",
                "status": "ringing",
            },
            id_member=id_member,
        )
        return {
            "mode": "cloud_webrtc",
            "call_id": call_id,
            "status": "ringing",
            "call": saved,
            "meta_response": meta_resp,
        }

    # Mode C: Personal Account Outbound Handoff (honest linked-device fallback)
    call_id = f"handoff_{uuid.uuid4().hex[:16]}"
    now = _now_iso()
    wa_deep_link = f"whatsapp://send?phone={digits}"
    wa_call_deep_link = f"whatsapp://call?phone={digits}"
    wa_web_link = f"https://wa.me/{digits}"
    call_row = {
        "account_id": account_id,
        "call_id": call_id,
        "chat_jid": resolved_chat_jid,
        "peer_jid": resolved_chat_jid,
        "peer_phone": digits,
        "peer_name": peer_name,
        "direction": "outbound",
        "call_type": call_type,
        "call_mode": "linked_device_handoff",
        "status": "ended",
        "duration_seconds": 0,
        "started_at": now,
        "ended_at": now,
        "metadata": {
            "handoff": True,
            "wa_deep_link": wa_deep_link,
            "wa_call_deep_link": wa_call_deep_link,
            "wa_web_link": wa_web_link,
            "protocol_note": PERSONAL_HANDOFF_PROTOCOL_NOTE,
        },
    }
    saved = await whatsapp_repo.upsert_call_log(call_row)
    await _upsert_call_message_card(account_id, id_member=id_member, call_log=saved)
    await message_events.publish_whatsapp_event(
        account_id,
        "call_event",
        {
            "sub_event": "linked_device_handoff",
            "call": saved,
            "call_id": call_id,
            "chat_jid": resolved_chat_jid,
            "peer_phone": digits,
            "peer_name": peer_name,
            "call_type": call_type,
            "call_mode": "linked_device_handoff",
            "status": "ended",
            "wa_deep_link": wa_deep_link,
            "wa_call_deep_link": wa_call_deep_link,
        },
        id_member=id_member,
    )
    return {
        "mode": "linked_device_handoff",
        "call_id": call_id,
        "status": "ended",
        "wa_deep_link": wa_deep_link,
        "wa_call_deep_link": wa_call_deep_link,
        "wa_web_link": wa_web_link,
        "protocol_note": PERSONAL_HANDOFF_PROTOCOL_NOTE,
        "call": saved,
    }


async def accept_inbound_call(
    user: Dict[str, Any],
    account_id: str,
    call_id: str,
    sdp_answer: str,
) -> Dict[str, Any]:
    """Accept an inbound Meta Cloud WebRTC call (``pre_accept`` -> ``accept`` with SDP Answer)."""
    from app.modules.all_platform.whatsapp.services import whatsapp_service

    account = await whatsapp_service.ensure_account_access(user, account_id)
    id_member = str(account.get("id_member")) if account.get("id_member") else None
    if not _has_cloud_calling_ready(account):
        raise HTTPException(
            400,
            "Chức năng nghe máy WebRTC trực tiếp yêu cầu bật Meta WhatsApp Business Calling API trong Cài đặt.",
        )

    pre_resp = await _call_meta_calling_api(
        account,
        {
            "messaging_product": "whatsapp",
            "call_id": call_id,
            "action": "pre_accept",
            "session": {"sdp_type": "answer", "sdp": sdp_answer},
        },
    )
    await whatsapp_repo.update_call_log(
        account_id,
        call_id,
        {"status": "pre_accepted", "sdp_answer": sdp_answer},
    )

    accept_resp = await _call_meta_calling_api(
        account,
        {
            "messaging_product": "whatsapp",
            "call_id": call_id,
            "action": "accept",
            "session": {"sdp_type": "answer", "sdp": sdp_answer},
        },
    )
    updated = await whatsapp_repo.update_call_log(
        account_id,
        call_id,
        {"status": "connected", "sdp_answer": sdp_answer},
    )
    if updated:
        await _upsert_call_message_card(account_id, id_member=id_member, call_log=updated)

    await message_events.publish_whatsapp_event(
        account_id,
        "call_event",
        {
            "sub_event": "call_connected",
            "call": updated,
            "call_id": call_id,
            "chat_jid": (updated or {}).get("chat_jid"),
            "status": "connected",
            "call_mode": "cloud_webrtc",
        },
        id_member=id_member,
    )
    return {
        "call": updated,
        "status": "connected",
        "pre_accept_response": pre_resp,
        "accept_response": accept_resp,
    }


async def terminate_call(
    user: Dict[str, Any],
    account_id: str,
    call_id: str,
) -> Dict[str, Any]:
    """Terminate an active WebRTC or signaling call and finalize call duration."""
    from app.modules.all_platform.whatsapp.services import whatsapp_service

    account = await whatsapp_service.ensure_account_access(user, account_id)
    id_member = str(account.get("id_member")) if account.get("id_member") else None
    existing = await whatsapp_repo.get_call_log(account_id, call_id)
    call_mode = (existing or {}).get("call_mode") or "cloud_webrtc"

    meta_resp: Optional[Dict[str, Any]] = None
    if call_mode == "cloud_webrtc" and _has_cloud_calling_ready(account):
        meta_resp = await _call_meta_calling_api(
            account,
            {
                "messaging_product": "whatsapp",
                "call_id": call_id,
                "action": "terminate",
            },
        )
    elif call_mode == "baileys_signal" and existing and existing.get("status") == "ringing":
        if bridge_manager.is_bridge_running(account_id):
            await bridge_manager.send_command(
                account_id,
                "reject_call",
                {"call_id": call_id, "caller_jid": existing.get("peer_jid") or ""},
            )

    now = _now_iso()
    duration = _compute_duration_seconds((existing or {}).get("started_at"), now)
    updated = await whatsapp_repo.update_call_log(
        account_id,
        call_id,
        {"status": "ended", "ended_at": now, "duration_seconds": duration},
    )
    if updated:
        await _upsert_call_message_card(account_id, id_member=id_member, call_log=updated)

    await message_events.publish_whatsapp_event(
        account_id,
        "call_event",
        {
            "sub_event": "call_ended",
            "call": updated,
            "call_id": call_id,
            "chat_jid": (updated or {}).get("chat_jid"),
            "status": "ended",
            "duration_seconds": duration,
            "call_mode": call_mode,
        },
        id_member=id_member,
    )
    return {
        "call": updated,
        "status": "ended",
        "duration_seconds": duration,
        "meta_response": meta_resp,
    }


async def list_call_logs(
    user: Dict[str, Any],
    account_id: str,
    *,
    limit: int = 50,
) -> List[Dict[str, Any]]:
    from app.modules.all_platform.whatsapp.services import whatsapp_service

    await whatsapp_service.ensure_account_access(user, account_id)
    return await whatsapp_repo.list_call_logs(account_id, limit=limit)


# ── Meta Cloud Webhook Verification & Ingestion ───────────────────────────────

async def verify_meta_webhook(
    mode: Optional[str],
    verify_token: Optional[str],
    challenge: Optional[str],
) -> str:
    if (mode or "").strip() != "subscribe" or not (verify_token or "").strip():
        raise HTTPException(403, "Meta webhook verification failed: invalid mode or token.")
    sent = verify_token.strip()
    global_token = get_webhook_verify_token()
    matched = bool(global_token and sent == global_token)
    if not matched:
        matched = await whatsapp_repo.has_matching_webhook_verify_token(sent)
    if not matched:
        raise HTTPException(403, "Meta webhook verification failed: token mismatch.")
    return str(challenge or "")


async def handle_meta_webhook(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Process Meta WhatsApp Business Calling API webhooks (inbound SDP offer, outbound SDP answer, statuses)."""
    processed = 0
    entries = payload.get("entry") if isinstance(payload.get("entry"), list) else []
    for entry in entries:
        changes = entry.get("changes") if isinstance(entry, dict) and isinstance(entry.get("changes"), list) else []
        for change in changes:
            value = change.get("value") if isinstance(change, dict) and isinstance(change.get("value"), dict) else {}
            metadata = value.get("metadata") if isinstance(value.get("metadata"), dict) else {}
            phone_number_id = str(metadata.get("phone_number_id") or "").strip()
            account = (
                await whatsapp_repo.find_account_by_cloud_phone_number_id(phone_number_id)
                if phone_number_id
                else None
            )

            # 1. Calling events (`value.calls[]`)
            calls = value.get("calls") if isinstance(value.get("calls"), list) else []
            for call_evt in calls:
                if not isinstance(call_evt, dict):
                    continue
                call_id = str(call_evt.get("id") or "").strip()
                if not call_id:
                    continue
                resolved_account = account
                existing = await whatsapp_repo.get_call_log_by_call_id(call_id)
                if not resolved_account and existing:
                    resolved_account = await whatsapp_repo.get_account(existing["account_id"])
                if not resolved_account:
                    logger.warning(f"[WhatsApp Cloud Webhook] Không tìm thấy account cho phone_number_id={phone_number_id}, call_id={call_id}")
                    continue

                account_id = resolved_account["id"]
                id_member = str(resolved_account.get("id_member")) if resolved_account.get("id_member") else None
                evt_name = str(call_evt.get("event") or "").strip().lower()
                session = call_evt.get("session") if isinstance(call_evt.get("session"), dict) else {}
                sdp_type = str(session.get("sdp_type") or "").strip().lower()
                raw_sdp = str(session.get("sdp") or "")
                sdp_text = raw_sdp if raw_sdp.strip() else None
                caller_phone = _digits_only(call_evt.get("from"))
                callee_phone = _digits_only(call_evt.get("to"))
                direction = str(call_evt.get("direction") or "").strip().lower()
                if direction in ("user_initiated", "inbound"):
                    direction = "inbound"
                elif direction in ("business_initiated", "outbound"):
                    direction = "outbound"
                else:
                    direction = (existing or {}).get("direction") or ("outbound" if sdp_type == "answer" else "inbound")

                peer_phone = caller_phone if direction == "inbound" else (callee_phone or (existing or {}).get("peer_phone"))
                chat_jid = (existing or {}).get("chat_jid") or (f"{peer_phone}@s.whatsapp.net" if peer_phone else None)
                contacts = value.get("contacts") if isinstance(value.get("contacts"), list) else []
                peer_name = (existing or {}).get("peer_name")
                if not peer_name and contacts and isinstance(contacts[0], dict):
                    profile = contacts[0].get("profile") if isinstance(contacts[0].get("profile"), dict) else {}
                    peer_name = profile.get("name")
                peer_name = peer_name or peer_phone

                now = _now_iso()
                if evt_name == "connect" and sdp_type == "offer" and sdp_text:
                    # Inbound WebRTC call SDP Offer from WhatsApp user
                    row = {
                        "account_id": account_id,
                        "call_id": call_id,
                        "chat_jid": chat_jid,
                        "peer_jid": chat_jid,
                        "peer_phone": peer_phone,
                        "peer_name": peer_name,
                        "direction": "inbound",
                        "call_type": "audio",
                        "call_mode": "cloud_webrtc",
                        "status": "ringing",
                        "duration_seconds": 0,
                        "sdp_offer": sdp_text,
                        "started_at": now,
                        "metadata": {"webhook_event": call_evt},
                    }
                    saved = await whatsapp_repo.upsert_call_log(row)
                    await _upsert_call_message_card(account_id, id_member=id_member, call_log=saved)
                    await message_events.publish_whatsapp_event(
                        account_id,
                        "call_event",
                        {
                            "sub_event": "incoming_call",
                            "call": saved,
                            "call_id": call_id,
                            "chat_jid": chat_jid,
                            "caller_jid": chat_jid,
                            "caller_phone": peer_phone,
                            "caller_name": peer_name,
                            "call_type": "audio",
                            "call_mode": "cloud_webrtc",
                            "status": "ringing",
                            "sdp_offer": sdp_text,
                            "can_webrtc_answer": True,
                        },
                        id_member=id_member,
                    )
                    processed += 1
                elif sdp_type == "answer" and sdp_text:
                    # Outbound WebRTC call answered by peer -> deliver SDP Answer to browser
                    updated = await whatsapp_repo.upsert_call_log({
                        "account_id": account_id,
                        "call_id": call_id,
                        "chat_jid": chat_jid,
                        "peer_jid": chat_jid,
                        "peer_phone": peer_phone,
                        "peer_name": peer_name,
                        "direction": "outbound",
                        "call_type": (existing or {}).get("call_type") or "audio",
                        "call_mode": "cloud_webrtc",
                        "status": "connected",
                        "duration_seconds": 0,
                        "sdp_offer": (existing or {}).get("sdp_offer"),
                        "sdp_answer": sdp_text,
                        "started_at": (existing or {}).get("started_at") or now,
                        "metadata": {"webhook_event": call_evt},
                    })
                    answer_payload = {
                        "sub_event": "call_answer_sdp",
                        "call": updated,
                        "call_id": call_id,
                        "chat_jid": chat_jid,
                        "status": "connected",
                        "call_mode": "cloud_webrtc",
                        "sdp_answer": sdp_text,
                    }
                    await message_events.publish_whatsapp_event(
                        account_id,
                        "call_event",
                        answer_payload,
                        id_member=id_member,
                    )
                    await message_events.publish_whatsapp_event(
                        account_id,
                        "call_answer_sdp",
                        answer_payload,
                        id_member=id_member,
                    )
                    processed += 1
                elif evt_name == "terminate":
                    raw_status = str(call_evt.get("status") or "ended").strip().lower()
                    final_status = raw_status if raw_status in ("rejected", "missed", "ended", "failed") else "ended"
                    dur = int(call_evt.get("duration") or 0) or _compute_duration_seconds(
                        (existing or {}).get("started_at"), now
                    )
                    updated = await whatsapp_repo.upsert_call_log({
                        "account_id": account_id,
                        "call_id": call_id,
                        "chat_jid": chat_jid,
                        "peer_jid": chat_jid,
                        "peer_phone": peer_phone,
                        "peer_name": peer_name,
                        "direction": direction,
                        "call_type": (existing or {}).get("call_type") or "audio",
                        "call_mode": "cloud_webrtc",
                        "status": final_status,
                        "duration_seconds": dur,
                        "sdp_offer": (existing or {}).get("sdp_offer"),
                        "sdp_answer": (existing or {}).get("sdp_answer"),
                        "started_at": (existing or {}).get("started_at") or now,
                        "ended_at": now,
                        "metadata": {"webhook_event": call_evt},
                    })
                    await _upsert_call_message_card(account_id, id_member=id_member, call_log=updated)
                    await message_events.publish_whatsapp_event(
                        account_id,
                        "call_event",
                        {
                            "sub_event": "call_ended",
                            "call": updated,
                            "call_id": call_id,
                            "chat_jid": chat_jid,
                            "status": final_status,
                            "duration_seconds": dur,
                            "call_mode": "cloud_webrtc",
                        },
                        id_member=id_member,
                    )
                    processed += 1

            # 2. Call status webhooks (`value.statuses[]` where type == "call")
            statuses = value.get("statuses") if isinstance(value.get("statuses"), list) else []
            for st in statuses:
                if not isinstance(st, dict) or st.get("type") != "call":
                    continue
                call_id = str(st.get("id") or "").strip()
                if not call_id:
                    continue
                existing = await whatsapp_repo.get_call_log_by_call_id(call_id)
                if not existing:
                    continue
                raw_st = str(st.get("status") or "").strip().upper()
                st_map = {
                    "RINGING": "ringing",
                    "ACCEPTED": "connected",
                    "REJECTED": "rejected",
                    "MISSED": "missed",
                    "ENDED": "ended",
                    "FAILED": "failed",
                }
                mapped = st_map.get(raw_st)
                if not mapped:
                    continue
                acct_id = existing["account_id"]
                acct_row = account or await whatsapp_repo.get_account(acct_id)
                id_member = str(acct_row.get("id_member")) if acct_row and acct_row.get("id_member") else None
                fields: Dict[str, Any] = {"status": mapped}
                if mapped in ("rejected", "missed", "ended", "failed"):
                    now = _now_iso()
                    fields["ended_at"] = now
                    fields["duration_seconds"] = _compute_duration_seconds(existing.get("started_at"), now)
                updated = await whatsapp_repo.update_call_log(acct_id, call_id, fields)
                if updated:
                    await _upsert_call_message_card(acct_id, id_member=id_member, call_log=updated)
                    await message_events.publish_whatsapp_event(
                        acct_id,
                        "call_event",
                        {
                            "sub_event": "call_status",
                            "call": updated,
                            "call_id": call_id,
                            "chat_jid": updated.get("chat_jid"),
                            "status": mapped,
                            "call_mode": updated.get("call_mode") or "cloud_webrtc",
                        },
                        id_member=id_member,
                    )
                processed += 1

    return {"processed": processed}
