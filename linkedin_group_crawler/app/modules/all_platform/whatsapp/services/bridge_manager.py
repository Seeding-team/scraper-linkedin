"""Persistent Node.js Baileys Bridge Manager (1 subprocess per WhatsApp account).

Handles:
- Cross-platform process spawning (Windows ``CREATE_NO_WINDOW`` + ``asyncio.create_subprocess_exec``
  with transparent fallback to ``subprocess.Popen`` + ``asyncio.to_thread`` if a Windows
  SelectorEventLoop is active).
- Bidirectional NDJSON protocol:
  * Stdin RPC: ``{"req_id": "...", "cmd": "...", "payload": {...}}`` -> ``asyncio.Future``
  * Stdout Event Pump: ``qr``, ``pairing_code``, ``connection``, ``chats_sync``,
    ``contacts_sync``, ``messages_batch``, ``message``, ``message_update``,
    ``reaction``, ``presence``, ``call`` -> persisted to Supabase & broadcast via SSE.
- Startup recovery (``start_persisted_bridges``) and graceful teardown (``shutdown_all_bridges``)
  for ``app/main.py`` lifespan integration.
"""

from __future__ import annotations

import asyncio
import json
import os
import subprocess
import sys
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
from weakref import WeakKeyDictionary

from loguru import logger

from app.modules.all_platform.whatsapp.config import (
    BACKEND_ROOT,
    get_auth_dir,
    get_bridge_script_path,
    get_default_proxy_url,
    get_media_dir,
    normalize_whatsapp_phone,
    resolve_effective_proxy_url,
    sanitize_account,
    settings,
)
from app.modules.all_platform.whatsapp.services import message_events, whatsapp_repo

VALID_MSG_TYPES = frozenset({
    "text", "image", "video", "audio", "voice", "document", "sticker",
    "contact", "location", "poll", "call_log", "revoked", "system",
})

_MSG_PREVIEW_LABELS: Dict[str, str] = {
    "image": "[Hình ảnh]",
    "video": "[Video]",
    "audio": "[Âm thanh]",
    "voice": "[Tin nhắn thoại]",
    "document": "[Tài liệu]",
    "sticker": "[Nhãn dán]",
    "contact": "[Danh thiếp]",
    "location": "[Vị trí]",
    "poll": "[Bình chọn]",
    "call_log": "[Cuộc gọi]",
    "revoked": "Tin nhắn đã được thu hồi",
    "system": "[Thông báo hệ thống]",
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _digits_from_jid(jid: Optional[str]) -> Optional[str]:
    if not jid:
        return None
    local = str(jid).split("@", 1)[0].split(":", 1)[0]
    digits = "".join(ch for ch in local if ch.isdigit())
    return digits or None


def _chat_type_from_jid(chat_jid: str, explicit: Optional[str] = None) -> str:
    if explicit in ("direct", "group", "broadcast"):
        return explicit
    if chat_jid.endswith("@g.us"):
        return "group"
    if chat_jid.endswith("@broadcast") or chat_jid == "status@broadcast":
        return "broadcast"
    return "direct"


def _message_preview(msg_type: str, text: Optional[str], metadata: Optional[Dict[str, Any]] = None) -> str:
    clean_text = (text or "").strip()
    if clean_text:
        return clean_text[:280]
    if msg_type == "document":
        fname = (metadata or {}).get("filename") or (metadata or {}).get("media_filename")
        return f"[Tài liệu] {fname}" if fname else "[Tài liệu]"
    if msg_type == "contact":
        cname = (metadata or {}).get("contact_name") or (metadata or {}).get("display_name")
        return f"[Danh thiếp] {cname}" if cname else "[Danh thiếp]"
    if msg_type == "poll":
        q = (metadata or {}).get("question")
        return f"[Bình chọn] {q}" if q else "[Bình chọn]"
    if msg_type == "location":
        name = (metadata or {}).get("name") or (metadata or {}).get("address")
        return f"[Vị trí] {name}" if name else "[Vị trí]"
    return _MSG_PREVIEW_LABELS.get(msg_type, "[Tin nhắn]")


# ── Threaded Subprocess Fallback (Windows SelectorEventLoop Compatibility) ────

class _ThreadedReader:
    def __init__(self, stream):
        self._stream = stream

    async def readline(self) -> bytes:
        if not self._stream:
            return b""
        try:
            return await asyncio.to_thread(self._stream.readline)
        except Exception:
            return b""


class _ThreadedWriter:
    def __init__(self, stream):
        self._stream = stream

    def write(self, data: bytes) -> None:
        if self._stream:
            self._stream.write(data)

    async def drain(self) -> None:
        if self._stream:
            await asyncio.to_thread(self._stream.flush)

    def close(self) -> None:
        if self._stream:
            try:
                self._stream.close()
            except Exception:
                pass


class _ThreadedSubprocess:
    """Drop-in async subprocess facade when ``asyncio.create_subprocess_exec`` is unavailable."""

    def __init__(self, cmd: List[str], *, cwd: str, env: Dict[str, str], creationflags: int = 0):
        kwargs: Dict[str, Any] = {
            "cwd": cwd,
            "env": env,
            "stdin": subprocess.PIPE,
            "stdout": subprocess.PIPE,
            "stderr": subprocess.PIPE,
        }
        if sys.platform == "win32" and creationflags:
            kwargs["creationflags"] = creationflags
        self._proc = subprocess.Popen(cmd, **kwargs)
        self.stdin = _ThreadedWriter(self._proc.stdin)
        self.stdout = _ThreadedReader(self._proc.stdout)
        self.stderr = _ThreadedReader(self._proc.stderr)

    @property
    def pid(self) -> Optional[int]:
        return self._proc.pid

    @property
    def returncode(self) -> Optional[int]:
        self._proc.poll()
        return self._proc.returncode

    async def wait(self) -> int:
        return await asyncio.to_thread(self._proc.wait)

    def terminate(self) -> None:
        try:
            self._proc.terminate()
        except Exception:
            pass

    def kill(self) -> None:
        try:
            self._proc.kill()
        except Exception:
            pass


@dataclass
class BridgeHandle:
    account_id: str
    id_member: Optional[str]
    process: Any
    auth_dir: str
    media_dir: str
    pending_rpcs: Dict[str, asyncio.Future] = field(default_factory=dict)
    stdout_task: Optional[asyncio.Task] = None
    stderr_task: Optional[asyncio.Task] = None
    write_lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    qr_event: asyncio.Event = field(default_factory=asyncio.Event)
    pairing_event: asyncio.Event = field(default_factory=asyncio.Event)
    auth_signal_event: asyncio.Event = field(default_factory=asyncio.Event)
    latest_qr_data_url: Optional[str] = None
    latest_pairing_code: Optional[str] = None
    last_error: Optional[str] = None
    status: str = "connecting"
    contacts_cache: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    stopping: bool = False


_bridges: Dict[str, BridgeHandle] = {}
_member_cache: Dict[str, str] = {}
_account_locks_by_loop: WeakKeyDictionary[asyncio.AbstractEventLoop, Dict[str, asyncio.Lock]] = WeakKeyDictionary()
_PROXY_UNSET = object()


def _get_account_lock(account_id: str) -> asyncio.Lock:
    """Return a per-account asyncio.Lock bound cleanly to the current running event loop."""
    loop = asyncio.get_running_loop()
    locks = _account_locks_by_loop.get(loop)
    if locks is None:
        locks = {}
        _account_locks_by_loop[loop] = locks
    lock = locks.get(account_id)
    if lock is None:
        lock = asyncio.Lock()
        locks[account_id] = lock
    return lock


def is_bridge_running(account_id: str) -> bool:
    handle = _bridges.get(account_id)
    return bool(handle and handle.process and handle.process.returncode is None and not handle.stopping)


def get_bridge_status(account_id: str) -> str:
    handle = _bridges.get(account_id)
    if not handle or handle.process.returncode is not None:
        return "stopped"
    return handle.status


def lookup_contact_name(account_id: str, jid_or_phone: Optional[str]) -> Optional[str]:
    if not jid_or_phone:
        return None
    handle = _bridges.get(account_id)
    if not handle:
        return None
    direct = handle.contacts_cache.get(str(jid_or_phone))
    if direct:
        return (
            direct.get("display_name")
            or direct.get("saved_name")
            or direct.get("push_name")
            or direct.get("name")
            or direct.get("notify")
            or direct.get("verified_name")
        )
    digits = _digits_from_jid(jid_or_phone)
    if digits:
        for entry in handle.contacts_cache.values():
            if entry.get("phone_number") == digits:
                return (
                    entry.get("display_name")
                    or entry.get("saved_name")
                    or entry.get("push_name")
                    or entry.get("name")
                    or entry.get("notify")
                )
    return None


async def _resolve_account_member(account_id: str) -> Optional[str]:
    if account_id in _member_cache:
        return _member_cache[account_id]
    handle = _bridges.get(account_id)
    if handle and handle.id_member:
        _member_cache[account_id] = handle.id_member
        return handle.id_member
    try:
        acc = await whatsapp_repo.get_account(account_id)
        if acc and acc.get("id_member"):
            _member_cache[account_id] = str(acc["id_member"])
            return _member_cache[account_id]
    except Exception:
        pass
    return None


# ── Pure Normalizers (Shared by Runtime & Unit Tests) ─────────────────────────

def normalize_bridge_chat(account_id: str, raw: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    chat_jid = str(raw.get("chat_jid") or raw.get("jid") or raw.get("id") or "").strip()
    if not chat_jid or chat_jid == "status@broadcast":
        return None
    chat_alt_jid = str(raw.get("chat_alt_jid") or raw.get("alt_jid") or "").strip() or None
    phone_number = (
        str(raw.get("phone_number") or "").strip()
        or _digits_from_jid(chat_alt_jid if chat_alt_jid and "@s.whatsapp.net" in chat_alt_jid else None)
        or (_digits_from_jid(chat_jid) if "@s.whatsapp.net" in chat_jid else None)
    )
    chat_type = _chat_type_from_jid(chat_jid, raw.get("chat_type"))
    title = (
        str(raw.get("title") or raw.get("name") or raw.get("subject") or "").strip()
        or phone_number
        or chat_jid.split("@", 1)[0]
    )
    row: Dict[str, Any] = {
        "account_id": account_id,
        "chat_jid": chat_jid,
        "chat_type": chat_type,
        "title": title,
    }
    if chat_alt_jid:
        row["chat_alt_jid"] = chat_alt_jid
    if phone_number:
        row["phone_number"] = phone_number
    if raw.get("avatar_url"):
        row["avatar_url"] = str(raw["avatar_url"])
    if raw.get("last_message_at"):
        row["last_message_at"] = str(raw["last_message_at"])
    if raw.get("last_message_preview") is not None:
        row["last_message_preview"] = str(raw["last_message_preview"])[:300]
    if raw.get("unread_count") is not None:
        row["unread_count"] = max(0, int(raw["unread_count"]))
    if raw.get("is_pinned") is not None:
        row["is_pinned"] = bool(raw["is_pinned"])
    if raw.get("is_muted") is not None:
        row["is_muted"] = bool(raw["is_muted"])
    if raw.get("is_archived") is not None:
        row["is_archived"] = bool(raw["is_archived"])
    if raw.get("participant_count") is not None:
        row["participant_count"] = max(0, int(raw["participant_count"]))
    return row


def normalize_bridge_message(account_id: str, raw: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Normalize a bridge ``message`` event into a ``whatsapp_messages`` row dict."""
    # Support both flat { event: "message", chat_jid, message_id, ... }
    # and nested { event: "message", message: { chat_jid, message_id, ... } }
    msg = raw.get("message") if isinstance(raw.get("message"), dict) else raw
    raw_key = msg.get("raw_key") if isinstance(msg.get("raw_key"), dict) else {}

    chat_jid = str(
        msg.get("chat_jid") or raw_key.get("remoteJid") or msg.get("remote_jid") or ""
    ).strip()
    message_id = str(
        msg.get("message_id") or raw_key.get("id") or msg.get("id") or ""
    ).strip()
    if not chat_jid or not message_id or chat_jid == "status@broadcast":
        return None

    raw_type = str(msg.get("msg_type") or msg.get("type") or "text").strip().lower()
    if raw_type == "ptt":
        raw_type = "voice"
    elif raw_type == "photo":
        raw_type = "image"
    elif raw_type == "unknown":
        raw_type = "text"
    msg_type = raw_type if raw_type in VALID_MSG_TYPES else "text"

    is_outgoing = bool(msg.get("is_outgoing", raw_key.get("fromMe", False)))
    sender_jid = str(
        msg.get("sender_jid")
        or raw_key.get("participant")
        or (chat_jid if not is_outgoing and "@g.us" not in chat_jid else "")
    ).strip() or None
    sender_phone = (
        str(msg.get("sender_phone") or "").strip()
        or _digits_from_jid(msg.get("sender_alt_jid"))
        or (_digits_from_jid(sender_jid) if sender_jid and "@s.whatsapp.net" in sender_jid else None)
    )
    sender_name = (
        str(msg.get("sender_name") or msg.get("push_name") or "").strip()
        or lookup_contact_name(account_id, sender_jid)
        or sender_phone
    )

    metadata: Dict[str, Any] = dict(msg.get("metadata") or {}) if isinstance(msg.get("metadata"), dict) else {}
    # Preserve rich type-specific payloads cleanly inside metadata
    for extra_key in (
        "latitude", "longitude", "location_name", "address",
        "contact_name", "contact_phone", "vcard",
        "question", "options", "selectable_count", "votes",
        "call_id", "call_type", "call_status", "direction", "duration_seconds",
        "chat_alt_jid", "sender_alt_jid",
    ):
        if msg.get(extra_key) is not None and extra_key not in metadata:
            metadata[extra_key] = msg[extra_key]
    if msg.get("name") and msg_type == "location" and "name" not in metadata:
        metadata["name"] = msg["name"]

    media_local_path = str(msg.get("media_local_path") or "").strip() or None
    media_url = str(msg.get("media_url") or "").strip() or None
    if not media_url and media_local_path:
        media_url = whatsapp_repo.local_media_fallback_url(account_id, message_id)

    text_val = msg.get("text")
    if text_val is None and msg.get("caption") is not None:
        text_val = msg.get("caption")

    # Deduplicate Baileys internal stub call_log messages against ev.on('call') cards
    if msg_type == "call_log":
        if metadata.get("missed"):
            metadata.setdefault("call_status", "missed")
        metadata.setdefault("call_type", "video" if metadata.get("is_video") else "audio")
        metadata.setdefault("direction", "outbound" if is_outgoing else "inbound")
        meta_call_id = str(metadata.get("call_id") or "").strip()
        if meta_call_id and not message_id.startswith("call_"):
            message_id = f"call_{meta_call_id}"

    sent_at = str(msg.get("sent_at") or "").strip() or _now_iso()
    ack_status = str(msg.get("ack_status") or ("sent" if is_outgoing else "delivered")).strip()

    return {
        "account_id": account_id,
        "chat_jid": chat_jid,
        "message_id": message_id,
        "sender_jid": sender_jid,
        "sender_phone": sender_phone,
        "sender_name": sender_name,
        "is_outgoing": is_outgoing,
        "msg_type": msg_type,
        "text": str(text_val) if text_val is not None else None,
        "media_url": media_url,
        "media_local_path": media_local_path,
        "media_mime": str(msg.get("media_mime") or "").strip() or None,
        "media_filename": str(msg.get("media_filename") or "").strip() or None,
        "media_size": int(msg["media_size"]) if msg.get("media_size") is not None else None,
        "media_duration_s": int(msg["media_duration_s"]) if msg.get("media_duration_s") is not None else None,
        "reply_to_message_id": str(msg.get("reply_to_message_id") or "").strip() or None,
        "quoted_text": str(msg.get("quoted_text") or "").strip() or None,
        "metadata": metadata,
        "reactions": msg.get("reactions") if isinstance(msg.get("reactions"), list) else [],
        "raw_key": raw_key,
        "ack_status": ack_status,
        "is_edited": bool(msg.get("is_edited", False)),
        "is_deleted": bool(msg.get("is_deleted", False) or msg_type == "revoked"),
        "sent_at": sent_at,
    }


# ── Event Dispatcher ──────────────────────────────────────────────────────────

async def handle_bridge_event(account_id: str, event: Dict[str, Any]) -> None:
    """Process one normalized NDJSON stdout event emitted by ``wa_persistent_bridge.mjs``."""
    evt_type = str(event.get("event") or "").strip().lower()
    if not evt_type:
        return

    handle = _bridges.get(account_id)
    id_member = await _resolve_account_member(account_id)

    if evt_type == "qr":
        qr_data_url = str(event.get("qr_data_url") or "").strip() or None
        if handle:
            handle.status = "qr_ready"
            handle.latest_qr_data_url = qr_data_url
            handle.last_error = None
            handle.qr_event.set()
            handle.auth_signal_event.set()
        updated = await whatsapp_repo.update_account(
            account_id,
            status="qr_ready",
            qr_data_url=qr_data_url,
            pairing_code=None,
            last_error=None,
        )
        await message_events.publish_whatsapp_event(
            account_id,
            "account_status",
            {
                "status": "qr_ready",
                "qr_data_url": qr_data_url,
                "qr": event.get("qr"),
                "account": sanitize_account(updated),
            },
            id_member=id_member,
        )
        return

    if evt_type == "pairing_code":
        code = str(event.get("pairing_code") or "").strip() or None
        phone = str(event.get("phone_number") or "").strip() or None
        if handle:
            handle.status = "pairing_ready"
            handle.latest_pairing_code = code
            handle.last_error = None
            handle.pairing_event.set()
            handle.auth_signal_event.set()
        fields: Dict[str, Any] = {
            "status": "pairing_ready",
            "pairing_code": code,
            "qr_data_url": None,
            "last_error": None,
        }
        if phone:
            fields["phone_number"] = phone
        updated = await whatsapp_repo.update_account(account_id, **fields)
        await message_events.publish_whatsapp_event(
            account_id,
            "account_status",
            {
                "status": "pairing_ready",
                "pairing_code": code,
                "formatted_code": event.get("formatted_code") or code,
                "phone_number": phone,
                "account": sanitize_account(updated),
            },
            id_member=id_member,
        )
        return

    if evt_type == "connection":
        raw_status = str(event.get("status") or "").strip().lower()
        status_map = {
            "open": "connected",
            "connecting": "connecting",
            "close": "disconnected",
            "reconnecting": "reconnecting",
            "logged_out": "logged_out",
            "qr_expired": "qr_expired",
            "error": "error",
        }
        mapped_status = status_map.get(raw_status, raw_status or "disconnected")
        if handle:
            handle.status = mapped_status
        fields = {"status": mapped_status}
        me = event.get("me") if isinstance(event.get("me"), dict) else {}
        if mapped_status == "connected":
            fields["qr_data_url"] = None
            fields["pairing_code"] = None
            fields["last_error"] = None
            fields["last_connected_at"] = _now_iso()
            if me.get("jid"):
                fields["jid"] = str(me["jid"])
            if me.get("lid"):
                fields["lid"] = str(me["lid"])
            if me.get("phone_number"):
                fields["phone_number"] = str(me["phone_number"])
            if me.get("display_name"):
                fields["display_name"] = str(me["display_name"])
            if handle:
                handle.last_error = None
                handle.auth_signal_event.set()
        elif mapped_status in ("qr_expired", "error", "logged_out"):
            fields["qr_data_url"] = None
            fields["pairing_code"] = None
            err_text = str(event.get("error") or "").strip()
            if not err_text and mapped_status == "qr_expired":
                err_text = "Mã QR đã hết hạn — bấm Làm mới QR để tạo mã mới."
            if err_text:
                fields["last_error"] = err_text[:500]
            if handle:
                handle.last_error = fields.get("last_error")
                handle.latest_qr_data_url = None
                handle.latest_pairing_code = None
                handle.auth_signal_event.set()
        elif event.get("error"):
            fields["last_error"] = str(event["error"])[:500]
            if handle:
                handle.last_error = fields["last_error"]
        updated = await whatsapp_repo.update_account(account_id, **fields)
        await message_events.publish_whatsapp_event(
            account_id,
            "account_status",
            {
                "status": mapped_status,
                "me": me or None,
                "error": fields.get("last_error") or event.get("error"),
                "account": sanitize_account(updated),
            },
            id_member=id_member,
        )
        return

    if evt_type == "contacts_sync":
        contacts = event.get("contacts") or []
        if handle and isinstance(contacts, list):
            for c in contacts:
                if not isinstance(c, dict):
                    continue
                cid = str(c.get("jid") or c.get("id") or "").strip()
                if cid:
                    handle.contacts_cache[cid] = c
                lid = str(c.get("lid") or "").strip()
                if lid:
                    handle.contacts_cache[lid] = c
        # Update matching conversation titles/avatars if contact carries display name
        updates = []
        for c in (contacts if isinstance(contacts, list) else []):
            if not isinstance(c, dict):
                continue
            cid = str(c.get("jid") or c.get("id") or "").strip()
            name = str(
                c.get("display_name")
                or c.get("saved_name")
                or c.get("push_name")
                or c.get("name")
                or c.get("notify")
                or c.get("verified_name")
                or ""
            ).strip()
            if cid and name and cid != "status@broadcast":
                updates.append({
                    "account_id": account_id,
                    "chat_jid": cid,
                    "chat_alt_jid": str(c.get("lid") or "").strip() or None,
                    "title": name,
                    "phone_number": str(c.get("phone_number") or "").strip() or _digits_from_jid(cid),
                    "avatar_url": str(c.get("avatar_url") or "").strip() or None,
                })
        if updates:
            await whatsapp_repo.update_existing_conversations_from_contacts(
                account_id, updates[:250]
            )
        return

    if evt_type == "chats_sync":
        raw_chats = event.get("chats") or []
        normalized_chats = [
            c for item in raw_chats
            if isinstance(item, dict) and (c := normalize_bridge_chat(account_id, item)) is not None
        ]
        if normalized_chats:
            await whatsapp_repo.upsert_conversations(normalized_chats)
            await message_events.publish_whatsapp_event(
                account_id,
                "conversation_update",
                {"action": "sync", "count": len(normalized_chats)},
                id_member=id_member,
            )
        return

    if evt_type == "messages_batch":
        raw_msgs = event.get("messages") or []
        normalized_msgs: List[Dict[str, Any]] = []
        for item in raw_msgs:
            if not isinstance(item, dict):
                continue
            row = normalize_bridge_message(account_id, item)
            if row:
                normalized_msgs.append(row)
        if normalized_msgs:
            await whatsapp_repo.upsert_messages_batch(normalized_msgs)
            await message_events.publish_whatsapp_event(
                account_id,
                "conversation_update",
                {"action": "messages_batch", "count": len(normalized_msgs)},
                id_member=id_member,
            )
        return

    if evt_type == "message":
        raw_inner = event.get("message") if isinstance(event.get("message"), dict) else event
        # Special case: reaction emitted inside messages.upsert
        if str(raw_inner.get("msg_type") or "").lower() == "reaction":
            target_id = str(raw_inner.get("target_message_id") or raw_inner.get("reply_to_message_id") or "").strip()
            chat_jid = str(raw_inner.get("chat_jid") or "").strip()
            if target_id and chat_jid:
                updated_msg = await whatsapp_repo.apply_message_reaction(
                    account_id,
                    chat_jid,
                    target_id,
                    str(raw_inner.get("sender_jid") or ""),
                    str(raw_inner.get("emoji") or raw_inner.get("text") or ""),
                )
                if updated_msg:
                    await message_events.publish_whatsapp_event(
                        account_id,
                        "message_update",
                        {
                            "chat_jid": chat_jid,
                            "message_id": target_id,
                            "reactions": updated_msg.get("reactions") or [],
                            "message": updated_msg,
                        },
                        id_member=id_member,
                    )
            return

        # Skip live Baileys synthetic call stub (40/41/45/46 without call_id) so missed calls
        # do not double-render alongside ev.on('call')'s canonical call_<id> card.
        if str(raw_inner.get("msg_type") or "").lower() == "call_log":
            upsert_type = str(event.get("upsert_type") or raw_inner.get("upsert_type") or "").lower()
            raw_meta = raw_inner.get("metadata") if isinstance(raw_inner.get("metadata"), dict) else {}
            stub_type = raw_meta.get("stub_type")
            has_call_id = bool(str(raw_inner.get("call_id") or raw_meta.get("call_id") or "").strip())
            if upsert_type == "notify" and stub_type in (40, 41, 45, 46) and not has_call_id:
                return

        row = normalize_bridge_message(account_id, event)
        if not row:
            return
        if row.get("media_local_path"):
            row["media_url"] = await whatsapp_repo.upload_local_media_with_fallback(
                account_id,
                row["message_id"],
                row["media_local_path"],
                row.get("media_mime"),
            )
        saved = await whatsapp_repo.upsert_message(row)

        chat_alt_jid = str(raw_inner.get("chat_alt_jid") or "").strip() or None
        chat_title = None
        if not row["is_outgoing"] and not row["chat_jid"].endswith("@g.us"):
            chat_title = row.get("sender_name") or row.get("sender_phone")
        preview = _message_preview(row["msg_type"], row.get("text"), row.get("metadata"))
        conv = await whatsapp_repo.touch_conversation(
            account_id,
            row["chat_jid"],
            chat_alt_jid=chat_alt_jid,
            chat_type=_chat_type_from_jid(row["chat_jid"]),
            title=chat_title,
            phone_number=(
                row.get("sender_phone")
                if not row["is_outgoing"] and not row["chat_jid"].endswith("@g.us")
                else _digits_from_jid(chat_alt_jid or row["chat_jid"])
            ),
            last_message_at=row["sent_at"],
            last_message_preview=preview,
            increment_unread=(not row["is_outgoing"] and row["msg_type"] != "revoked"),
        )
        await message_events.publish_whatsapp_event(
            account_id,
            "message",
            {"chat_jid": row["chat_jid"], "message": saved},
            id_member=id_member,
        )
        await message_events.publish_whatsapp_event(
            account_id,
            "conversation_update",
            {"action": "message", "conversation": conv},
            id_member=id_member,
        )
        return

    if evt_type == "message_update":
        chat_jid = str(event.get("chat_jid") or "").strip()
        message_id = str(event.get("message_id") or "").strip()
        if not message_id:
            return
        fields: Dict[str, Any] = {}
        if event.get("ack_status"):
            fields["ack_status"] = str(event["ack_status"])
        if event.get("is_deleted"):
            fields["is_deleted"] = True
            fields["msg_type"] = "revoked"
            fields["text"] = None
        if event.get("is_edited"):
            fields["is_edited"] = True
        if event.get("msg_type") and str(event["msg_type"]) in VALID_MSG_TYPES:
            fields["msg_type"] = str(event["msg_type"])
        if event.get("text") is not None and not event.get("is_deleted"):
            fields["text"] = str(event["text"])
        updated_msg = await whatsapp_repo.update_message_fields(account_id, chat_jid, message_id, fields)
        await message_events.publish_whatsapp_event(
            account_id,
            "message_update",
            {
                "chat_jid": chat_jid,
                "message_id": message_id,
                **fields,
                "message": updated_msg,
            },
            id_member=id_member,
        )
        return

    if evt_type == "reaction":
        chat_jid = str(event.get("chat_jid") or "").strip()
        message_id = str(event.get("message_id") or "").strip()
        sender_jid = str(event.get("sender_jid") or "").strip()
        emoji = str(event.get("emoji") or "")
        if not message_id:
            return
        updated_msg = await whatsapp_repo.apply_message_reaction(
            account_id, chat_jid, message_id, sender_jid, emoji
        )
        await message_events.publish_whatsapp_event(
            account_id,
            "message_update",
            {
                "chat_jid": chat_jid,
                "message_id": message_id,
                "reaction": {"sender_jid": sender_jid, "emoji": emoji},
                "reactions": (updated_msg or {}).get("reactions") or [],
                "message": updated_msg,
            },
            id_member=id_member,
        )
        return

    if evt_type == "presence":
        await message_events.publish_whatsapp_event(
            account_id,
            "presence",
            {
                "chat_jid": event.get("chat_jid"),
                "participant_jid": event.get("participant_jid"),
                "state": event.get("state") or "available",
            },
            id_member=id_member,
        )
        return

    if evt_type == "call":
        from app.modules.all_platform.whatsapp.services import whatsapp_call_service
        await whatsapp_call_service.handle_baileys_call_event(account_id, event)
        return


# ── Subprocess Lifecycle & RPC ────────────────────────────────────────────────

async def _stdout_loop(handle: BridgeHandle) -> None:
    account_id = handle.account_id
    try:
        while True:
            raw_line = await handle.process.stdout.readline()
            if not raw_line:
                break
            line = raw_line.decode("utf-8", errors="replace").strip()
            if not line:
                continue
            try:
                payload = json.loads(line)
            except json.JSONDecodeError:
                logger.warning(f"[WhatsApp {account_id}] Bỏ qua dòng stdout không phải JSON: {line[:200]}")
                continue
            if not isinstance(payload, dict):
                continue

            req_id = payload.get("req_id")
            if req_id is not None and str(req_id) in handle.pending_rpcs:
                fut = handle.pending_rpcs.pop(str(req_id))
                if not fut.done():
                    fut.set_result(payload)
                continue

            try:
                await handle_bridge_event(account_id, payload)
            except Exception:
                logger.exception(f"[WhatsApp {account_id}] Lỗi xử lý sự kiện bridge: {payload.get('event')}")
    except asyncio.CancelledError:
        pass
    except Exception:
        logger.exception(f"[WhatsApp {account_id}] Lỗi vòng đọc stdout bridge")
    finally:
        # Fail any in-flight RPCs cleanly
        for req_id, fut in list(handle.pending_rpcs.items()):
            if not fut.done():
                fut.set_exception(RuntimeError("Tiến trình WhatsApp bridge đã dừng trước khi phản hồi."))
        handle.pending_rpcs.clear()

        if _bridges.get(account_id) is handle:
            _bridges.pop(account_id, None)

        if not handle.stopping:
            rc = handle.process.returncode
            logger.warning(f"[WhatsApp {account_id}] Tiến trình Node.js bridge kết thúc bất ngờ (rc={rc})")
            already_terminal = handle.status in ("logged_out", "qr_expired", "error")
            if not already_terminal:
                exit_status = "error" if rc not in (0, None) else "disconnected"
                err_msg = handle.last_error or (
                    f"Tiến trình WhatsApp bridge dừng bất ngờ (mã thoát {rc})."
                    if exit_status == "error"
                    else "Tiến trình WhatsApp bridge đã ngắt kết nối."
                )
                handle.status = exit_status
                handle.last_error = err_msg
                try:
                    id_member = await _resolve_account_member(account_id)
                    updated = await whatsapp_repo.update_account(
                        account_id,
                        status=exit_status,
                        qr_data_url=None,
                        pairing_code=None,
                        last_error=err_msg[:500],
                    )
                    await message_events.publish_whatsapp_event(
                        account_id,
                        "account_status",
                        {
                            "status": exit_status,
                            "error": err_msg,
                            "account": sanitize_account(updated),
                        },
                        id_member=id_member,
                    )
                except Exception:
                    logger.exception(f"[WhatsApp {account_id}] Không thể đồng bộ trạng thái thoát bridge lên DB/SSE")

        handle.auth_signal_event.set()


def _log_bridge_stderr_line(account_id: str, text: str) -> None:
    """Route Node bridge stderr lines to appropriate Loguru severity levels."""
    lower = text.lower()
    if (
        "[error]" in lower
        or '"level":50' in text
        or '"level":60' in text
        or "uncaughtexception" in lower
        or "unhandledrejection" in lower
    ):
        logger.error(f"[WhatsApp Bridge {account_id}] {text[:500]}")
    elif "[warn]" in lower or '"level":40' in text:
        logger.warning(f"[WhatsApp Bridge {account_id}] {text[:500]}")
    else:
        logger.debug(f"[WhatsApp Bridge {account_id}] {text[:500]}")


async def _stderr_loop(handle: BridgeHandle) -> None:
    account_id = handle.account_id
    try:
        while True:
            raw_line = await handle.process.stderr.readline()
            if not raw_line:
                break
            text = raw_line.decode("utf-8", errors="replace").rstrip()
            if text:
                _log_bridge_stderr_line(account_id, text)
    except asyncio.CancelledError:
        pass
    except Exception:
        pass


async def _spawn_process(cmd: List[str], *, cwd: str, env: Dict[str, str]) -> Any:
    creationflags = (
        getattr(subprocess, "CREATE_NO_WINDOW", 0) if sys.platform == "win32" else 0
    )
    try:
        kwargs: Dict[str, Any] = {
            "cwd": cwd,
            "env": env,
            "stdin": asyncio.subprocess.PIPE,
            "stdout": asyncio.subprocess.PIPE,
            "stderr": asyncio.subprocess.PIPE,
        }
        if sys.platform == "win32" and creationflags:
            kwargs["creationflags"] = creationflags
        return await asyncio.create_subprocess_exec(*cmd, **kwargs)
    except NotImplementedError:
        return _ThreadedSubprocess(cmd, cwd=cwd, env=env, creationflags=creationflags)


async def start_bridge(
    account_id: str,
    *,
    id_member: Optional[str] = None,
    pairing_phone: Optional[str] = None,
    proxy_url: Any = _PROXY_UNSET,
    force_restart: bool = False,
) -> BridgeHandle:
    """Spawn (or reuse) the persistent Node.js Baileys bridge process for ``account_id``."""
    async with _get_account_lock(account_id):
        existing = _bridges.get(account_id)
        if existing and existing.process.returncode is None and not existing.stopping:
            if not force_restart:
                return existing
            await _stop_bridge_unlocked(account_id, logout=False)

        script_path = get_bridge_script_path()
        if not script_path.is_file():
            raise RuntimeError(
                f"Không tìm thấy script WhatsApp bridge tại '{script_path}'. "
                "Hãy kiểm tra scripts/wa_persistent_bridge.mjs và cài đặt npm."
            )

        effective_proxy: Optional[str] = None
        if proxy_url is _PROXY_UNSET:
            try:
                acc = await whatsapp_repo.get_account(account_id)
            except Exception:
                acc = None
            effective_proxy = resolve_effective_proxy_url(acc)
        elif isinstance(proxy_url, str) and proxy_url.strip():
            effective_proxy = proxy_url.strip()
        else:
            effective_proxy = resolve_effective_proxy_url(None)

        auth_dir = str(get_auth_dir(account_id))
        media_dir = str(get_media_dir(account_id))
        cmd = [
            settings.node_binary,
            str(script_path),
            "--account-id",
            str(account_id),
            "--auth-dir",
            auth_dir,
            "--media-dir",
            media_dir,
            "--browser-name",
            settings.browser_name,
        ]
        if pairing_phone:
            digits = normalize_whatsapp_phone(pairing_phone)
            if digits:
                cmd.extend(["--pairing-phone", digits])

        env = dict(os.environ)
        env.setdefault("NODE_ENV", "production")
        if effective_proxy:
            env["WA_PROXY_URL"] = effective_proxy
        else:
            env.pop("WA_PROXY_URL", None)

        proc = await _spawn_process(cmd, cwd=str(BACKEND_ROOT), env=env)

        if id_member:
            _member_cache[account_id] = str(id_member)

        handle = BridgeHandle(
            account_id=account_id,
            id_member=str(id_member) if id_member else _member_cache.get(account_id),
            process=proc,
            auth_dir=auth_dir,
            media_dir=media_dir,
            status="connecting",
        )
        _bridges[account_id] = handle
        handle.stdout_task = asyncio.create_task(_stdout_loop(handle))
        handle.stderr_task = asyncio.create_task(_stderr_loop(handle))
        logger.info(
            f"[WhatsApp {account_id}] Đã khởi chạy bridge PID={proc.pid} "
            f"(proxy={'on' if effective_proxy else 'off'})"
        )
        return handle


async def send_command(
    account_id: str,
    cmd: str,
    payload: Optional[Dict[str, Any]] = None,
    *,
    timeout: Optional[float] = None,
) -> Dict[str, Any]:
    """Send an NDJSON RPC command to the account's bridge stdin and await its reply."""
    handle = _bridges.get(account_id)
    if not handle or handle.process.returncode is not None or handle.stopping:
        raise RuntimeError("Tài khoản WhatsApp chưa kết nối bridge realtime — vui lòng bấm Kết nối lại.")

    req_id = uuid.uuid4().hex
    loop = asyncio.get_running_loop()
    fut: asyncio.Future = loop.create_future()
    handle.pending_rpcs[req_id] = fut

    frame = json.dumps(
        {"req_id": req_id, "cmd": cmd, "payload": payload or {}},
        ensure_ascii=False,
    ) + "\n"

    try:
        async with handle.write_lock:
            handle.process.stdin.write(frame.encode("utf-8"))
            await handle.process.stdin.drain()
        reply = await asyncio.wait_for(fut, timeout=timeout or settings.rpc_timeout_seconds)
    except asyncio.TimeoutError:
        handle.pending_rpcs.pop(req_id, None)
        raise TimeoutError(f"Lệnh WhatsApp '{cmd}' quá thời gian phản hồi ({timeout or settings.rpc_timeout_seconds}s).")
    except Exception:
        handle.pending_rpcs.pop(req_id, None)
        raise

    if not reply.get("ok"):
        raise RuntimeError(str(reply.get("error") or f"Lệnh '{cmd}' thất bại."))
    return reply.get("data") if isinstance(reply.get("data"), dict) else {"result": reply.get("data")}


async def wait_for_auth_artifact(
    account_id: str,
    *,
    kind: str = "qr",
    timeout: float = 8.0,
) -> Optional[str]:
    """Wait up to ``timeout`` seconds for initial QR/pairing code, waking early on terminal/ready status."""
    handle = _bridges.get(account_id)
    if not handle:
        return None
    loop = asyncio.get_running_loop()
    deadline = loop.time() + max(0.0, float(timeout))
    early_stop_statuses = ("connected", "error", "qr_expired", "logged_out", "disconnected")

    while True:
        if kind == "pairing_code" and handle.latest_pairing_code:
            return handle.latest_pairing_code
        if kind != "pairing_code" and handle.latest_qr_data_url:
            return handle.latest_qr_data_url
        if handle.status in early_stop_statuses or handle.process.returncode is not None:
            return None
        remaining = deadline - loop.time()
        if remaining <= 0:
            return None
        handle.auth_signal_event.clear()
        # Re-check immediately after clearing to avoid lost-wakeup race
        if kind == "pairing_code" and handle.latest_pairing_code:
            return handle.latest_pairing_code
        if kind != "pairing_code" and handle.latest_qr_data_url:
            return handle.latest_qr_data_url
        if handle.status in early_stop_statuses or handle.process.returncode is not None:
            return None
        try:
            await asyncio.wait_for(handle.auth_signal_event.wait(), timeout=remaining)
        except asyncio.TimeoutError:
            return None


async def _stop_bridge_unlocked(account_id: str, *, logout: bool = False) -> None:
    handle = _bridges.pop(account_id, None)
    if not handle:
        return
    handle.stopping = True
    handle.auth_signal_event.set()
    try:
        if handle.process.returncode is None:
            try:
                cmd = "logout" if logout else "shutdown"
                req_id = uuid.uuid4().hex
                payload = {"clear_auth": True} if logout else {}
                frame = json.dumps({"req_id": req_id, "cmd": cmd, "payload": payload}) + "\n"
                async with handle.write_lock:
                    handle.process.stdin.write(frame.encode("utf-8"))
                    await handle.process.stdin.drain()
                await asyncio.wait_for(handle.process.wait(), timeout=4.0)
            except Exception:
                handle.process.terminate()
                try:
                    await asyncio.wait_for(handle.process.wait(), timeout=3.0)
                except Exception:
                    handle.process.kill()
    finally:
        for task in (handle.stdout_task, handle.stderr_task):
            if task and not task.done():
                task.cancel()
        for fut in list(handle.pending_rpcs.values()):
            if not fut.done():
                fut.set_exception(RuntimeError("Bridge stopped"))
        handle.pending_rpcs.clear()


async def stop_bridge(account_id: str, *, logout: bool = False) -> None:
    async with _get_account_lock(account_id):
        await _stop_bridge_unlocked(account_id, logout=logout)


def _has_registered_creds(auth_dir: Path) -> bool:
    """Return True iff ``auth_dir/creds.json`` exists and has ``registered === true``."""
    creds_path = auth_dir / "creds.json"
    if not creds_path.is_file():
        return False
    try:
        data = json.loads(creds_path.read_text(encoding="utf-8"))
        return isinstance(data, dict) and data.get("registered") is True
    except Exception:
        return False


async def start_persisted_bridges() -> None:
    """Auto-resume registered WhatsApp bridges on FastAPI startup (called by ``app/main.py`` lifespan)."""
    if os.getenv("DISABLE_WHATSAPP_BRIDGES", "").strip().lower() in ("1", "true", "yes"):
        logger.warning("DISABLE_WHATSAPP_BRIDGES enabled -> skipping WhatsApp bridge auto-start.")
        return
    script_path = get_bridge_script_path()
    if not script_path.is_file():
        logger.warning(f"[WhatsApp] Bỏ qua auto-start vì chưa có bridge script: {script_path}")
        return
    try:
        accounts = await whatsapp_repo.list_persisted_accounts()
    except Exception:
        logger.exception("[WhatsApp] Không đọc được danh sách tài khoản WhatsApp khi khởi động.")
        return

    for acc in accounts:
        account_id = acc["id"]
        auth_dir = get_auth_dir(account_id)
        if not _has_registered_creds(auth_dir):
            logger.debug(
                f"[WhatsApp] Bỏ qua auto-resume cho {account_id} vì chưa có creds.json đã đăng ký (registered=true)."
            )
            continue
        try:
            await start_bridge(
                account_id,
                id_member=acc.get("id_member"),
                proxy_url=resolve_effective_proxy_url(acc),
            )
            logger.info(f"[WhatsApp] Đã khôi phục bridge cho tài khoản {account_id} ({acc.get('phone_number') or acc.get('label')})")
        except Exception as exc:
            logger.exception(f"[WhatsApp] Không thể khôi phục bridge cho tài khoản {account_id}")
            try:
                await whatsapp_repo.update_account(account_id, status="error", last_error=str(exc)[:500])
            except Exception:
                pass


async def shutdown_all_bridges() -> None:
    """Gracefully terminate all active WhatsApp bridge subprocesses in parallel on FastAPI shutdown."""
    account_ids = list(_bridges.keys())
    if not account_ids:
        return
    results = await asyncio.gather(
        *(stop_bridge(account_id, logout=False) for account_id in account_ids),
        return_exceptions=True,
    )
    for account_id, res in zip(account_ids, results):
        if isinstance(res, Exception):
            logger.error(f"[WhatsApp] Lỗi khi tắt bridge {account_id}: {res}")
