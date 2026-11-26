"""Business service layer for WhatsApp Chat & Call CRM.

Enforces exact RBAC scoping matching ``telegram_service.py`` (admin=all, leader=team,
member=own), orchestrates bridge RPC calls, persists state to Supabase, and publishes
realtime SSE events.
"""

from __future__ import annotations

import asyncio
import mimetypes
import re
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException
from loguru import logger

from app.core.supabase_client import get_supabase_client
from app.modules.all_platform.whatsapp.config import (
    encrypt_cloud_token,
    get_auth_dir,
    get_media_dir,
    sanitize_account,
    settings,
)
from app.modules.all_platform.whatsapp.schemas import (
    CreateQuickReplyRequest,
    UpdateAccountSettingsRequest,
    UpdateConversationRequest,
    UpdateQuickReplyRequest,
)
from app.modules.all_platform.whatsapp.services import (
    bridge_manager,
    message_events,
    whatsapp_repo,
)

_SAFE_FILENAME_RE = re.compile(r"[^A-Za-z0-9._-]+")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _digits_only(value: Optional[str]) -> str:
    if not value:
        return ""
    return "".join(ch for ch in str(value) if ch.isdigit())


def _safe_filename(name: Optional[str], fallback: str = "file") -> str:
    raw = Path(str(name or fallback)).name
    cleaned = _SAFE_FILENAME_RE.sub("_", raw).strip("._")
    return cleaned[:140] or fallback


def _enrich_account(row: Dict[str, Any]) -> Dict[str, Any]:
    clean = sanitize_account(row)
    aid = str(clean.get("id") or "")
    clean["bridge_running"] = bridge_manager.is_bridge_running(aid) if aid else False
    clean["bridge_status"] = bridge_manager.get_bridge_status(aid) if aid else "stopped"
    return clean


# ── RBAC Scoping (identical to telegram_service.py) ───────────────────────────

async def _resolve_member_scope(user: Dict[str, Any]) -> Optional[List[str]]:
    """``None`` = admin (all accounts). Otherwise list of authorized ``id_member`` strings."""
    role = (user.get("role") or "member").strip().lower()
    caller_id = str(user["id"])
    if role == "admin":
        return None
    if role != "leader":
        return [caller_id]

    sb = get_supabase_client()

    def _do():
        teams_res = sb.table("teams").select("id").eq("id_leader", caller_id).execute()
        team_ids = [t["id"] for t in (teams_res.data or [])]
        member_ids = {caller_id}
        if team_ids:
            mot_res = sb.table("member_of_teams").select("id_member").in_("id_teams", team_ids).execute()
            member_ids.update(str(m["id_member"]) for m in (mot_res.data or []) if m.get("id_member"))
        return list(member_ids)

    return await asyncio.to_thread(_do)


async def ensure_account_access(user: Dict[str, Any], account_id: str) -> Dict[str, Any]:
    acc = await whatsapp_repo.get_account(account_id)
    if not acc:
        raise HTTPException(404, "Không tìm thấy tài khoản WhatsApp.")
    member_ids = await _resolve_member_scope(user)
    if member_ids is None or str(acc.get("id_member") or "") in member_ids:
        return acc
    raise HTTPException(403, "Bạn không có quyền truy cập tài khoản WhatsApp này.")


async def resolve_stream_scope(
    user: Dict[str, Any],
    *,
    account_id: Optional[str] = None,
) -> Tuple[List[str], Optional[List[str]]]:
    """Return ``(authorized_account_ids, member_scope)`` for SSE streaming."""
    member_ids = await _resolve_member_scope(user)
    if account_id:
        await ensure_account_access(user, account_id)
        return [account_id], member_ids
    rows = await whatsapp_repo.list_accounts(member_ids)
    return [str(r["id"]) for r in rows], member_ids


# ── Accounts & Authentication ─────────────────────────────────────────────────

async def list_accounts_for_caller(user: Dict[str, Any]) -> List[Dict[str, Any]]:
    member_ids = await _resolve_member_scope(user)
    rows = await whatsapp_repo.list_accounts(member_ids)
    return [_enrich_account(r) for r in rows]


async def get_account_status(user: Dict[str, Any], account_id: str) -> Dict[str, Any]:
    acc = await ensure_account_access(user, account_id)
    enriched = _enrich_account(acc)
    if enriched["bridge_running"]:
        try:
            live = await bridge_manager.send_command(account_id, "get_status", timeout=4.0)
            enriched["bridge_live"] = live
        except Exception:
            enriched["bridge_live"] = None
    return enriched


async def _reset_stale_auth_dir(account_id: str, existing_auth_dir: Optional[str] = None) -> str:
    """Stop any existing bridge and wipe stale Baileys creds before fresh QR/Pairing re-link."""
    await bridge_manager.stop_bridge(account_id, logout=False)
    target = Path(existing_auth_dir) if existing_auth_dir else get_auth_dir(account_id)
    if target.exists():
        await asyncio.to_thread(shutil.rmtree, target, True)
    return str(get_auth_dir(account_id))


async def connect_qr(
    user: Dict[str, Any],
    *,
    label: Optional[str] = None,
    account_id: Optional[str] = None,
) -> Dict[str, Any]:
    if account_id:
        acc = await ensure_account_access(user, account_id)
        auth_dir = await _reset_stale_auth_dir(account_id, acc.get("auth_dir"))
        fields: Dict[str, Any] = {
            "auth_mode": "qr",
            "status": "connecting",
            "qr_data_url": None,
            "pairing_code": None,
            "auth_dir": auth_dir,
            "last_error": None,
        }
        if label is not None:
            fields["label"] = label.strip() or None
        acc = await whatsapp_repo.update_account(account_id, **fields)
    else:
        acc = await whatsapp_repo.create_account(
            str(user["id"]),
            auth_mode="qr",
            label=label,
            status="connecting",
        )
        auth_dir = str(get_auth_dir(acc["id"]))
        acc = await whatsapp_repo.update_account(acc["id"], auth_dir=auth_dir)

    aid = acc["id"]
    try:
        await bridge_manager.start_bridge(aid, id_member=acc.get("id_member"), force_restart=True)
    except Exception as exc:
        await whatsapp_repo.update_account(aid, status="error", last_error=str(exc)[:500])
        raise HTTPException(500, f"Không khởi chạy được tiến trình WhatsApp bridge: {exc}")

    # Give bridge a short window to emit the first QR frame synchronously
    await bridge_manager.wait_for_auth_artifact(aid, kind="qr", timeout=2.0)
    refreshed = await whatsapp_repo.get_account(aid) or acc
    return _enrich_account(refreshed)


async def connect_pairing(
    user: Dict[str, Any],
    *,
    phone_number: str,
    label: Optional[str] = None,
    account_id: Optional[str] = None,
) -> Dict[str, Any]:
    digits = _digits_only(phone_number)
    if len(digits) < 7 or len(digits) > 15:
        raise HTTPException(
            400,
            "Số điện thoại không hợp lệ — nhập mã quốc gia + số điện thoại (vd: 84901234567).",
        )

    if account_id:
        acc = await ensure_account_access(user, account_id)
        auth_dir = await _reset_stale_auth_dir(account_id, acc.get("auth_dir"))
        fields: Dict[str, Any] = {
            "auth_mode": "pairing",
            "phone_number": digits,
            "status": "connecting",
            "qr_data_url": None,
            "pairing_code": None,
            "auth_dir": auth_dir,
            "last_error": None,
        }
        if label is not None:
            fields["label"] = label.strip() or None
        acc = await whatsapp_repo.update_account(account_id, **fields)
    else:
        acc = await whatsapp_repo.create_account(
            str(user["id"]),
            auth_mode="pairing",
            label=label,
            phone_number=digits,
            status="connecting",
        )
        auth_dir = str(get_auth_dir(acc["id"]))
        acc = await whatsapp_repo.update_account(acc["id"], auth_dir=auth_dir)

    aid = acc["id"]
    try:
        await bridge_manager.start_bridge(
            aid,
            id_member=acc.get("id_member"),
            pairing_phone=digits,
            force_restart=True,
        )
    except Exception as exc:
        await whatsapp_repo.update_account(aid, status="error", last_error=str(exc)[:500])
        raise HTTPException(500, f"Không khởi chạy được tiến trình WhatsApp bridge: {exc}")

    await bridge_manager.wait_for_auth_artifact(aid, kind="pairing_code", timeout=3.0)
    refreshed = await whatsapp_repo.get_account(aid) or acc
    return _enrich_account(refreshed)


async def update_account_settings(
    user: Dict[str, Any],
    account_id: str,
    payload: UpdateAccountSettingsRequest,
) -> Dict[str, Any]:
    acc = await ensure_account_access(user, account_id)
    fields: Dict[str, Any] = {}
    if payload.label is not None:
        fields["label"] = payload.label.strip() or None
    if payload.auto_reject_calls is not None:
        fields["auto_reject_calls"] = bool(payload.auto_reject_calls)
    if payload.auto_reject_message is not None:
        fields["auto_reject_message"] = payload.auto_reject_message.strip() or None
    if payload.cloud_calling_enabled is not None:
        fields["cloud_calling_enabled"] = bool(payload.cloud_calling_enabled)
    if payload.cloud_phone_number_id is not None:
        fields["cloud_phone_number_id"] = payload.cloud_phone_number_id.strip() or None
    if payload.cloud_waba_id is not None:
        fields["cloud_waba_id"] = payload.cloud_waba_id.strip() or None
    if payload.cloud_webhook_verify_token is not None:
        fields["cloud_webhook_verify_token"] = payload.cloud_webhook_verify_token.strip() or None
    if payload.cloud_access_token is not None:
        raw_token = payload.cloud_access_token.strip()
        if not raw_token:
            fields["cloud_access_token_enc"] = None
        else:
            fields["cloud_access_token_enc"] = encrypt_cloud_token(raw_token)

    updated = await whatsapp_repo.update_account(account_id, **fields) if fields else acc
    enriched = _enrich_account(updated)
    await message_events.publish_whatsapp_event(
        account_id,
        "account_status",
        {"status": enriched.get("status"), "account": enriched},
        id_member=str(acc.get("id_member") or ""),
    )
    return enriched


async def reconnect_account(user: Dict[str, Any], account_id: str) -> Dict[str, Any]:
    acc = await ensure_account_access(user, account_id)
    await whatsapp_repo.update_account(account_id, status="connecting", last_error=None)
    try:
        await bridge_manager.start_bridge(account_id, id_member=acc.get("id_member"), force_restart=True)
    except Exception as exc:
        await whatsapp_repo.update_account(account_id, status="error", last_error=str(exc)[:500])
        raise HTTPException(500, f"Không thể kết nối lại WhatsApp: {exc}")
    refreshed = await whatsapp_repo.get_account(account_id) or acc
    enriched = _enrich_account(refreshed)
    await message_events.publish_whatsapp_event(
        account_id,
        "account_status",
        {"status": "connecting", "account": enriched},
        id_member=str(acc.get("id_member") or ""),
    )
    return enriched


async def disconnect_account(user: Dict[str, Any], account_id: str, *, logout: bool = False) -> None:
    acc = await ensure_account_access(user, account_id)
    await bridge_manager.stop_bridge(account_id, logout=logout)
    if logout:
        auth_dir = Path(acc.get("auth_dir") or get_auth_dir(account_id))
        if auth_dir.exists():
            await asyncio.to_thread(shutil.rmtree, auth_dir, True)
    await whatsapp_repo.delete_account(account_id)


# ── Conversations ─────────────────────────────────────────────────────────────

async def list_conversations(
    user: Dict[str, Any],
    account_id: str,
    *,
    search: Optional[str] = None,
    filter_mode: str = "all",
    limit: int = 100,
) -> List[Dict[str, Any]]:
    await ensure_account_access(user, account_id)
    return await whatsapp_repo.list_conversations(
        account_id, search=search, filter_mode=filter_mode, limit=limit
    )


async def sync_conversations(user: Dict[str, Any], account_id: str) -> List[Dict[str, Any]]:
    acc = await ensure_account_access(user, account_id)
    if bridge_manager.is_bridge_running(account_id):
        try:
            res = await bridge_manager.send_command(account_id, "sync_chats", timeout=20.0)
            raw_chats = res.get("chats") if isinstance(res.get("chats"), list) else []
            normalized = [
                c for item in raw_chats
                if isinstance(item, dict)
                and (c := bridge_manager.normalize_bridge_chat(account_id, item)) is not None
            ]
            if normalized:
                await whatsapp_repo.upsert_conversations(normalized)
        except Exception as exc:
            logger.warning(f"[WhatsApp {account_id}] sync_chats RPC warning: {exc}")
    rows = await whatsapp_repo.list_conversations(account_id, limit=200)
    await message_events.publish_whatsapp_event(
        account_id,
        "conversation_update",
        {"action": "sync", "count": len(rows)},
        id_member=str(acc.get("id_member") or ""),
    )
    return rows


async def start_chat(user: Dict[str, Any], account_id: str, phone_number: str) -> Dict[str, Any]:
    acc = await ensure_account_access(user, account_id)
    digits = _digits_only(phone_number)
    if len(digits) < 7 or len(digits) > 15:
        raise HTTPException(400, "Số điện thoại không hợp lệ (cần mã quốc gia, vd: 84901234567).")

    chat_jid = f"{digits}@s.whatsapp.net"
    avatar_url: Optional[str] = None
    if bridge_manager.is_bridge_running(account_id):
        try:
            checked = await bridge_manager.send_command(
                account_id, "check_number", {"phone_number": digits}, timeout=12.0
            )
            if checked.get("exists") is False:
                raise HTTPException(404, f"Số điện thoại +{digits} chưa đăng ký tài khoản WhatsApp.")
            if checked.get("jid"):
                chat_jid = str(checked["jid"])
        except HTTPException:
            raise
        except Exception as exc:
            logger.warning(f"[WhatsApp {account_id}] check_number fallback ({digits}): {exc}")

        try:
            av = await bridge_manager.send_command(
                account_id, "fetch_avatar", {"jid": chat_jid}, timeout=6.0
            )
            avatar_url = str(av.get("avatar_url") or av.get("url") or "").strip() or None
        except Exception:
            pass

    conv = await whatsapp_repo.touch_conversation(
        account_id,
        chat_jid,
        chat_type="direct",
        title=f"+{digits}",
        phone_number=digits,
        avatar_url=avatar_url,
        last_message_at=_now_iso(),
    )
    await message_events.publish_whatsapp_event(
        account_id,
        "conversation_update",
        {"action": "start_chat", "conversation": conv},
        id_member=str(acc.get("id_member") or ""),
    )
    return conv


async def mark_conversation_read(user: Dict[str, Any], account_id: str, chat_jid: str) -> Dict[str, Any]:
    acc = await ensure_account_access(user, account_id)
    await whatsapp_repo.clear_unread(account_id, chat_jid)
    if bridge_manager.is_bridge_running(account_id):
        try:
            recent = await whatsapp_repo.list_messages(account_id, chat_jid, limit=15)
            keys = [
                m["raw_key"]
                for m in recent
                if not m.get("is_outgoing") and isinstance(m.get("raw_key"), dict) and m["raw_key"].get("id")
            ]
            if keys:
                await bridge_manager.send_command(account_id, "mark_read", {"keys": keys}, timeout=8.0)
        except Exception as exc:
            logger.debug(f"[WhatsApp {account_id}] mark_read skipped: {exc}")
    conv = await whatsapp_repo.get_conversation(account_id, chat_jid) or {
        "account_id": account_id,
        "chat_jid": chat_jid,
        "unread_count": 0,
    }
    await message_events.publish_whatsapp_event(
        account_id,
        "conversation_update",
        {"action": "read", "conversation": conv},
        id_member=str(acc.get("id_member") or ""),
    )
    return conv


async def update_conversation(
    user: Dict[str, Any],
    account_id: str,
    chat_jid: str,
    payload: UpdateConversationRequest,
) -> Dict[str, Any]:
    acc = await ensure_account_access(user, account_id)
    fields = payload.model_dump(exclude_none=True)
    updated = await whatsapp_repo.update_conversation(account_id, chat_jid, fields)
    if not updated:
        raise HTTPException(404, "Không tìm thấy hội thoại WhatsApp.")
    await message_events.publish_whatsapp_event(
        account_id,
        "conversation_update",
        {"action": "update", "conversation": updated},
        id_member=str(acc.get("id_member") or ""),
    )
    return updated


async def send_typing(user: Dict[str, Any], account_id: str, chat_jid: str, state: str) -> Dict[str, Any]:
    await ensure_account_access(user, account_id)
    if bridge_manager.is_bridge_running(account_id):
        try:
            await bridge_manager.send_command(
                account_id, "send_presence", {"chat_jid": chat_jid, "state": state}, timeout=6.0
            )
        except Exception as exc:
            logger.debug(f"[WhatsApp {account_id}] send_presence failed: {exc}")
    return {"chat_jid": chat_jid, "state": state}


async def get_group_info(user: Dict[str, Any], account_id: str, chat_jid: str) -> Dict[str, Any]:
    await ensure_account_access(user, account_id)
    if not bridge_manager.is_bridge_running(account_id):
        conv = await whatsapp_repo.get_conversation(account_id, chat_jid)
        pcount = int((conv or {}).get("participant_count") or 0)
        return {
            "id": chat_jid,
            "chat_jid": chat_jid,
            "subject": (conv or {}).get("title"),
            "description": None,
            "owner": None,
            "owner_jid": None,
            "size": pcount,
            "participant_count": pcount,
            "participants": [],
            "offline": True,
        }
    try:
        meta = await bridge_manager.send_command(
            account_id, "group_metadata", {"chat_jid": chat_jid}, timeout=12.0
        )
    except Exception as exc:
        raise HTTPException(400, f"Không lấy được thông tin nhóm WhatsApp: {exc}")

    participants = meta.get("participants") if isinstance(meta.get("participants"), list) else []
    participant_count = (
        int(meta["participant_count"])
        if meta.get("participant_count") is not None
        else int(meta["size"])
        if meta.get("size") is not None
        else len(participants)
    )
    owner_jid = meta.get("owner_jid") or meta.get("owner")
    resolved_jid = str(meta.get("chat_jid") or meta.get("id") or chat_jid)

    update_fields: Dict[str, Any] = {}
    if meta.get("subject"):
        update_fields["title"] = str(meta["subject"])
    if participant_count:
        update_fields["participant_count"] = participant_count
    if update_fields:
        await whatsapp_repo.update_conversation(account_id, chat_jid, update_fields)

    return {
        **meta,
        "id": resolved_jid,
        "chat_jid": resolved_jid,
        "owner": owner_jid,
        "owner_jid": owner_jid,
        "size": participant_count,
        "participant_count": participant_count,
        "participants": participants,
    }


# ── Messages ──────────────────────────────────────────────────────────────────

async def list_messages(
    user: Dict[str, Any],
    account_id: str,
    chat_jid: str,
    *,
    limit: int = 60,
    before_ts: Optional[str] = None,
) -> List[Dict[str, Any]]:
    await ensure_account_access(user, account_id)
    return await whatsapp_repo.list_messages(
        account_id, chat_jid, limit=limit, before_ts=before_ts
    )


async def _persist_outgoing_message(
    account_id: str,
    *,
    id_member: Optional[str],
    chat_jid: str,
    msg_type: str,
    rpc_result: Dict[str, Any],
    text: Optional[str] = None,
    media_url: Optional[str] = None,
    media_local_path: Optional[str] = None,
    media_mime: Optional[str] = None,
    media_filename: Optional[str] = None,
    media_size: Optional[int] = None,
    media_duration_s: Optional[int] = None,
    reply_to_message_id: Optional[str] = None,
    quoted_text: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    raw_key = rpc_result.get("raw_key") or rpc_result.get("key") or {}
    if not isinstance(raw_key, dict):
        raw_key = {}
    canonical_chat_jid = str(rpc_result.get("chat_jid") or "").strip() or chat_jid
    message_id = str(
        rpc_result.get("message_id")
        or raw_key.get("id")
        or f"out_{uuid.uuid4().hex[:16]}"
    )
    if not raw_key:
        raw_key = {"remoteJid": canonical_chat_jid, "fromMe": True, "id": message_id}
    sent_at = str(rpc_result.get("sent_at") or _now_iso())

    row = {
        "account_id": account_id,
        "chat_jid": canonical_chat_jid,
        "message_id": message_id,
        "sender_jid": rpc_result.get("sender_jid"),
        "sender_phone": rpc_result.get("sender_phone"),
        "sender_name": rpc_result.get("sender_name") or "Bạn",
        "is_outgoing": True,
        "msg_type": msg_type,
        "text": text,
        "media_url": media_url,
        "media_local_path": media_local_path,
        "media_mime": media_mime,
        "media_filename": media_filename,
        "media_size": media_size,
        "media_duration_s": media_duration_s,
        "reply_to_message_id": reply_to_message_id,
        "quoted_text": quoted_text,
        "metadata": metadata or {},
        "reactions": [],
        "raw_key": raw_key,
        "ack_status": "sent",
        "is_edited": False,
        "is_deleted": False,
        "sent_at": sent_at,
    }
    saved = await whatsapp_repo.upsert_message(row)
    preview = bridge_manager._message_preview(msg_type, text, metadata)
    conv = await whatsapp_repo.touch_conversation(
        account_id,
        canonical_chat_jid,
        last_message_at=sent_at,
        last_message_preview=preview,
        increment_unread=False,
    )
    await message_events.publish_whatsapp_event(
        account_id,
        "message",
        {"chat_jid": canonical_chat_jid, "message": saved},
        id_member=id_member,
    )
    await message_events.publish_whatsapp_event(
        account_id,
        "conversation_update",
        {"action": "message", "conversation": conv},
        id_member=id_member,
    )
    return saved


async def send_text_internal(
    account_id: str,
    chat_jid: str,
    text: str,
    *,
    id_member: Optional[str] = None,
    reply_to_message_id: Optional[str] = None,
    quoted_text: Optional[str] = None,
    mentions: Optional[List[str]] = None,
) -> Dict[str, Any]:
    clean_text = (text or "").strip()
    if not clean_text:
        raise HTTPException(400, "Nội dung tin nhắn không được để trống.")

    reply_to_key: Optional[Dict[str, Any]] = None
    resolved_quote = quoted_text
    if reply_to_message_id:
        ref_msg = await whatsapp_repo.get_message(account_id, reply_to_message_id, chat_jid=chat_jid)
        if ref_msg:
            if isinstance(ref_msg.get("raw_key"), dict) and ref_msg["raw_key"].get("id"):
                reply_to_key = ref_msg["raw_key"]
            if not resolved_quote:
                resolved_quote = ref_msg.get("text") or bridge_manager._message_preview(
                    ref_msg.get("msg_type") or "text", ref_msg.get("text"), ref_msg.get("metadata")
                )

    try:
        rpc_res = await bridge_manager.send_command(
            account_id,
            "send_text",
            {
                "chat_jid": chat_jid,
                "text": clean_text,
                "reply_to_key": reply_to_key,
                "quoted_text": resolved_quote,
                "mentions": mentions or [],
            },
        )
    except Exception as exc:
        raise HTTPException(400, f"Không gửi được tin nhắn WhatsApp: {exc}")

    return await _persist_outgoing_message(
        account_id,
        id_member=id_member,
        chat_jid=chat_jid,
        msg_type="text",
        rpc_result=rpc_res,
        text=clean_text,
        reply_to_message_id=reply_to_message_id,
        quoted_text=resolved_quote,
    )


async def send_text(
    user: Dict[str, Any],
    account_id: str,
    chat_jid: str,
    text: str,
    *,
    reply_to_message_id: Optional[str] = None,
    quoted_text: Optional[str] = None,
    mentions: Optional[List[str]] = None,
) -> Dict[str, Any]:
    acc = await ensure_account_access(user, account_id)
    return await send_text_internal(
        account_id,
        chat_jid,
        text,
        id_member=str(acc.get("id_member") or ""),
        reply_to_message_id=reply_to_message_id,
        quoted_text=quoted_text,
        mentions=mentions,
    )


async def send_media(
    user: Dict[str, Any],
    account_id: str,
    chat_jid: str,
    *,
    filename: str,
    content_type: Optional[str],
    data: bytes,
    media_type: str,
    caption: Optional[str] = None,
    reply_to_message_id: Optional[str] = None,
) -> Dict[str, Any]:
    acc = await ensure_account_access(user, account_id)
    if not data:
        raise HTTPException(400, "File tải lên rỗng.")
    if len(data) > settings.max_media_upload_bytes:
        raise HTTPException(
            413,
            f"File vượt quá giới hạn tối đa {settings.max_media_upload_bytes // (1024 * 1024)}MB.",
        )

    norm_type = (media_type or "document").strip().lower()
    if norm_type == "photo":
        norm_type = "image"
    elif norm_type == "ptt":
        norm_type = "voice"
    if norm_type not in ("image", "video", "audio", "voice", "document", "sticker"):
        norm_type = "document"

    safe_name = _safe_filename(filename, fallback=f"{norm_type}.bin")
    mime = (content_type or "").strip() or mimetypes.guess_type(safe_name)[0] or "application/octet-stream"
    local_dir = get_media_dir(account_id)
    local_file = local_dir / f"{uuid.uuid4().hex[:12]}_{safe_name}"
    await asyncio.to_thread(local_file.write_bytes, data)

    reply_to_key: Optional[Dict[str, Any]] = None
    quoted_text: Optional[str] = None
    if reply_to_message_id:
        ref_msg = await whatsapp_repo.get_message(account_id, reply_to_message_id, chat_jid=chat_jid)
        if ref_msg:
            if isinstance(ref_msg.get("raw_key"), dict) and ref_msg["raw_key"].get("id"):
                reply_to_key = ref_msg["raw_key"]
            quoted_text = ref_msg.get("text")

    try:
        rpc_res = await bridge_manager.send_command(
            account_id,
            "send_media",
            {
                "chat_jid": chat_jid,
                "file_path": str(local_file),
                "media_type": norm_type,
                "mime_type": mime,
                "filename": safe_name,
                "caption": (caption or "").strip() or None,
                "ptt": norm_type == "voice",
                "reply_to_key": reply_to_key,
                "quoted_text": quoted_text,
            },
            timeout=60.0,
        )
    except Exception as exc:
        raise HTTPException(400, f"Không gửi được tệp đính kèm WhatsApp: {exc}")

    raw_key = rpc_res.get("raw_key") or rpc_res.get("key") or {}
    msg_id = str(rpc_res.get("message_id") or (raw_key.get("id") if isinstance(raw_key, dict) else None) or uuid.uuid4().hex[:16])
    rpc_res = {**rpc_res, "message_id": msg_id}
    media_url = await whatsapp_repo.upload_local_media_with_fallback(
        account_id, msg_id, str(local_file), mime
    )

    return await _persist_outgoing_message(
        account_id,
        id_member=str(acc.get("id_member") or ""),
        chat_jid=chat_jid,
        msg_type=norm_type,
        rpc_result=rpc_res,
        text=(caption or "").strip() or None,
        media_url=media_url,
        media_local_path=str(local_file),
        media_mime=mime,
        media_filename=safe_name,
        media_size=len(data),
        reply_to_message_id=reply_to_message_id,
        quoted_text=quoted_text,
        metadata={"filename": safe_name},
    )


async def resolve_media_file(
    user: Dict[str, Any],
    account_id: str,
    message_id: str,
) -> Tuple[Path, str, str]:
    await ensure_account_access(user, account_id)
    msg = await whatsapp_repo.get_message(account_id, message_id)
    if not msg or not msg.get("media_local_path"):
        raise HTTPException(404, "Không tìm thấy tệp media cục bộ cho tin nhắn này.")
    media_root = get_media_dir(account_id).resolve()
    file_path = Path(msg["media_local_path"]).resolve()
    if media_root not in file_path.parents and file_path != media_root:
        raise HTTPException(403, "Đường dẫn tệp media không hợp lệ.")
    if not file_path.is_file():
        raise HTTPException(404, "Tệp media đã bị xoá hoặc không tồn tại trên đĩa.")
    mime = msg.get("media_mime") or mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
    filename = msg.get("media_filename") or file_path.name
    return file_path, mime, filename


async def send_location(
    user: Dict[str, Any],
    account_id: str,
    chat_jid: str,
    *,
    latitude: float,
    longitude: float,
    name: Optional[str] = None,
    address: Optional[str] = None,
) -> Dict[str, Any]:
    acc = await ensure_account_access(user, account_id)
    try:
        rpc_res = await bridge_manager.send_command(
            account_id,
            "send_location",
            {
                "chat_jid": chat_jid,
                "latitude": latitude,
                "longitude": longitude,
                "name": name,
                "address": address,
            },
        )
    except Exception as exc:
        raise HTTPException(400, f"Không gửi được vị trí: {exc}")

    return await _persist_outgoing_message(
        account_id,
        id_member=str(acc.get("id_member") or ""),
        chat_jid=chat_jid,
        msg_type="location",
        rpc_result=rpc_res,
        text=name or address or f"{latitude:.5f}, {longitude:.5f}",
        metadata={
            "latitude": latitude,
            "longitude": longitude,
            "name": name,
            "address": address,
        },
    )


async def send_contact(
    user: Dict[str, Any],
    account_id: str,
    chat_jid: str,
    *,
    contact_name: str,
    contact_phone: str,
) -> Dict[str, Any]:
    acc = await ensure_account_access(user, account_id)
    try:
        rpc_res = await bridge_manager.send_command(
            account_id,
            "send_contact",
            {
                "chat_jid": chat_jid,
                "contact_name": contact_name.strip(),
                "contact_phone": contact_phone.strip(),
            },
        )
    except Exception as exc:
        raise HTTPException(400, f"Không gửi được danh thiếp: {exc}")

    clean_name = contact_name.strip()
    clean_phone = contact_phone.strip()
    return await _persist_outgoing_message(
        account_id,
        id_member=str(acc.get("id_member") or ""),
        chat_jid=chat_jid,
        msg_type="contact",
        rpc_result=rpc_res,
        text=f"{clean_name} ({clean_phone})",
        metadata={
            "contact_name": clean_name,
            "contact_phone": clean_phone,
            "display_name": clean_name,
            "phone": clean_phone,
        },
    )


async def send_poll(
    user: Dict[str, Any],
    account_id: str,
    chat_jid: str,
    *,
    question: str,
    options: List[str],
    selectable_count: int = 1,
) -> Dict[str, Any]:
    acc = await ensure_account_access(user, account_id)
    clean_opts = [o.strip() for o in options if o and o.strip()]
    if len(clean_opts) < 2:
        raise HTTPException(400, "Bình chọn cần ít nhất 2 lựa chọn.")
    sel = max(1, min(int(selectable_count), len(clean_opts)))
    try:
        rpc_res = await bridge_manager.send_command(
            account_id,
            "send_poll",
            {
                "chat_jid": chat_jid,
                "question": question.strip(),
                "options": clean_opts,
                "selectable_count": sel,
            },
        )
    except Exception as exc:
        raise HTTPException(400, f"Không tạo được bình chọn: {exc}")

    return await _persist_outgoing_message(
        account_id,
        id_member=str(acc.get("id_member") or ""),
        chat_jid=chat_jid,
        msg_type="poll",
        rpc_result=rpc_res,
        text=question.strip(),
        metadata={
            "question": question.strip(),
            "options": clean_opts,
            "selectable_count": sel,
        },
    )


async def react_message(
    user: Dict[str, Any],
    account_id: str,
    chat_jid: str,
    message_id: str,
    emoji: str,
) -> Dict[str, Any]:
    acc = await ensure_account_access(user, account_id)
    existing = await whatsapp_repo.get_message(account_id, message_id, chat_jid=chat_jid)
    raw_key = (
        existing.get("raw_key")
        if existing and isinstance(existing.get("raw_key"), dict) and existing["raw_key"].get("id")
        else {"remoteJid": chat_jid, "id": message_id, "fromMe": bool((existing or {}).get("is_outgoing"))}
    )
    try:
        await bridge_manager.send_command(
            account_id,
            "react",
            {"chat_jid": chat_jid, "key": raw_key, "emoji": emoji},
        )
    except Exception as exc:
        raise HTTPException(400, f"Không thể thả cảm xúc: {exc}")

    sender_jid = acc.get("jid") or "me"
    updated = await whatsapp_repo.apply_message_reaction(
        account_id, chat_jid, message_id, str(sender_jid), emoji
    )
    await message_events.publish_whatsapp_event(
        account_id,
        "message_update",
        {
            "chat_jid": chat_jid,
            "message_id": message_id,
            "reaction": {"sender_jid": sender_jid, "emoji": emoji},
            "reactions": (updated or {}).get("reactions") or [],
            "message": updated,
        },
        id_member=str(acc.get("id_member") or ""),
    )
    return updated or {"message_id": message_id, "emoji": emoji}


async def edit_message(
    user: Dict[str, Any],
    account_id: str,
    chat_jid: str,
    message_id: str,
    text: str,
) -> Dict[str, Any]:
    acc = await ensure_account_access(user, account_id)
    clean_text = (text or "").strip()
    if not clean_text:
        raise HTTPException(400, "Nội dung tin nhắn chỉnh sửa không được trống.")
    existing = await whatsapp_repo.get_message(account_id, message_id, chat_jid=chat_jid)
    raw_key = (
        existing.get("raw_key")
        if existing and isinstance(existing.get("raw_key"), dict) and existing["raw_key"].get("id")
        else {"remoteJid": chat_jid, "id": message_id, "fromMe": True}
    )
    try:
        await bridge_manager.send_command(
            account_id,
            "edit_message",
            {"chat_jid": chat_jid, "key": raw_key, "text": clean_text},
        )
    except Exception as exc:
        raise HTTPException(400, f"Không chỉnh sửa được tin nhắn: {exc}")

    updated = await whatsapp_repo.update_message_fields(
        account_id, chat_jid, message_id, {"text": clean_text, "is_edited": True}
    )
    await message_events.publish_whatsapp_event(
        account_id,
        "message_update",
        {
            "chat_jid": chat_jid,
            "message_id": message_id,
            "text": clean_text,
            "is_edited": True,
            "message": updated,
        },
        id_member=str(acc.get("id_member") or ""),
    )
    return updated or {"message_id": message_id, "text": clean_text, "is_edited": True}


async def delete_message(
    user: Dict[str, Any],
    account_id: str,
    chat_jid: str,
    message_id: str,
    *,
    for_everyone: bool = True,
) -> Dict[str, Any]:
    acc = await ensure_account_access(user, account_id)
    existing = await whatsapp_repo.get_message(account_id, message_id, chat_jid=chat_jid)
    raw_key = (
        existing.get("raw_key")
        if existing and isinstance(existing.get("raw_key"), dict) and existing["raw_key"].get("id")
        else {"remoteJid": chat_jid, "id": message_id, "fromMe": bool((existing or {}).get("is_outgoing", True))}
    )
    if for_everyone:
        try:
            await bridge_manager.send_command(
                account_id,
                "delete_message",
                {"chat_jid": chat_jid, "key": raw_key, "for_everyone": True},
            )
        except Exception as exc:
            raise HTTPException(400, f"Không thu hồi được tin nhắn: {exc}")

    updated = await whatsapp_repo.mark_message_deleted(
        account_id, chat_jid, message_id, revoked=for_everyone
    )
    await message_events.publish_whatsapp_event(
        account_id,
        "message_update",
        {
            "chat_jid": chat_jid,
            "message_id": message_id,
            "is_deleted": True,
            "msg_type": "revoked" if for_everyone else (existing or {}).get("msg_type"),
            "message": updated,
        },
        id_member=str(acc.get("id_member") or ""),
    )
    return updated or {"message_id": message_id, "is_deleted": True}


async def forward_message(
    user: Dict[str, Any],
    account_id: str,
    from_chat_jid: str,
    message_id: str,
    to_chat_jid: str,
) -> Dict[str, Any]:
    acc = await ensure_account_access(user, account_id)
    source = await whatsapp_repo.get_message(account_id, message_id, chat_jid=from_chat_jid)
    if not source:
        raise HTTPException(404, "Không tìm thấy tin nhắn nguồn để chuyển tiếp.")
    try:
        rpc_res = await bridge_manager.send_command(
            account_id,
            "forward_message",
            {
                "from_chat_jid": from_chat_jid,
                "to_chat_jid": to_chat_jid,
                "message_id": message_id,
                "key": source.get("raw_key") or {},
                "text": source.get("text"),
                "msg_type": source.get("msg_type") or "text",
                "media_type": source.get("msg_type") or "text",
                "media_local_path": source.get("media_local_path"),
                "media_mime": source.get("media_mime"),
                "media_filename": source.get("media_filename"),
            },
        )
    except Exception as exc:
        raise HTTPException(400, f"Không chuyển tiếp được tin nhắn: {exc}")

    return await _persist_outgoing_message(
        account_id,
        id_member=str(acc.get("id_member") or ""),
        chat_jid=to_chat_jid,
        msg_type=source.get("msg_type") or "text",
        rpc_result=rpc_res,
        text=source.get("text"),
        media_url=source.get("media_url"),
        media_local_path=source.get("media_local_path"),
        media_mime=source.get("media_mime"),
        media_filename=source.get("media_filename"),
        media_size=source.get("media_size"),
        metadata={**(source.get("metadata") or {}), "forwarded": True, "forwarded_from_chat_jid": from_chat_jid},
    )


# ── Quick Replies ─────────────────────────────────────────────────────────────

async def list_quick_replies(user: Dict[str, Any]) -> List[Dict[str, Any]]:
    member_ids = await _resolve_member_scope(user)
    return await whatsapp_repo.list_quick_replies(member_ids)


async def create_quick_reply(user: Dict[str, Any], payload: CreateQuickReplyRequest) -> Dict[str, Any]:
    return await whatsapp_repo.create_quick_reply(
        str(user["id"]),
        shortcut=payload.shortcut,
        title=payload.title,
        content=payload.content,
        category=payload.category,
    )


async def update_quick_reply(
    user: Dict[str, Any],
    reply_id: str,
    payload: UpdateQuickReplyRequest,
) -> Dict[str, Any]:
    existing = await whatsapp_repo.get_quick_reply(reply_id)
    if not existing:
        raise HTTPException(404, "Không tìm thấy mẫu tin nhắn nhanh.")
    member_ids = await _resolve_member_scope(user)
    if member_ids is not None and str(existing.get("id_member") or "") not in member_ids:
        raise HTTPException(403, "Bạn không có quyền sửa mẫu tin nhắn nhanh này.")
    fields = payload.model_dump(exclude_none=True)
    return await whatsapp_repo.update_quick_reply(reply_id, fields) if fields else existing


async def delete_quick_reply(user: Dict[str, Any], reply_id: str) -> None:
    existing = await whatsapp_repo.get_quick_reply(reply_id)
    if not existing:
        raise HTTPException(404, "Không tìm thấy mẫu tin nhắn nhanh.")
    member_ids = await _resolve_member_scope(user)
    if member_ids is not None and str(existing.get("id_member") or "") not in member_ids:
        raise HTTPException(403, "Bạn không có quyền xoá mẫu tin nhắn nhanh này.")
    await whatsapp_repo.delete_quick_reply(reply_id)
