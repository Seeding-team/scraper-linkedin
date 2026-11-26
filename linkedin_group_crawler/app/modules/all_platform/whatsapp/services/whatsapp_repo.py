"""Supabase repository layer for WhatsApp Chat & Call CRM.

Uses shared ``get_supabase_client()`` wrapped in ``asyncio.to_thread()`` to avoid
blocking the FastAPI / subprocess event loop (same convention as ``telegram_repo.py``).
"""

from __future__ import annotations

import asyncio
import mimetypes
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from loguru import logger
from supabase import Client

from app.core.supabase_client import get_supabase_client
from app.modules.all_platform.whatsapp.config import settings

_bucket_ready = False
_bucket_lock = asyncio.Lock()


async def _run(fn):
    return await asyncio.to_thread(fn)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _digits_only(value: Optional[str]) -> str:
    if not value:
        return ""
    return "".join(ch for ch in str(value) if ch.isdigit())


# ── Accounts ──────────────────────────────────────────────────────────────────

async def create_account(
    id_member: str,
    *,
    auth_mode: str = "qr",
    label: Optional[str] = None,
    phone_number: Optional[str] = None,
    auth_dir: Optional[str] = None,
    status: str = "pending",
) -> Dict[str, Any]:
    sb: Client = get_supabase_client()
    row: Dict[str, Any] = {
        "id_member": str(id_member),
        "auth_mode": auth_mode,
        "label": (label or "").strip() or None,
        "phone_number": _digits_only(phone_number) or None,
        "auth_dir": auth_dir,
        "status": status,
    }
    res = await _run(lambda: sb.table("whatsapp_accounts").insert(row).execute())
    return res.data[0]


async def update_account(account_id: str, **fields: Any) -> Dict[str, Any]:
    sb: Client = get_supabase_client()
    payload = dict(fields)
    payload["updated_at"] = _now_iso()
    res = await _run(
        lambda: sb.table("whatsapp_accounts").update(payload).eq("id", account_id).execute()
    )
    return res.data[0] if res.data else {}


async def get_account(account_id: str) -> Optional[Dict[str, Any]]:
    sb: Client = get_supabase_client()
    res = await _run(
        lambda: sb.table("whatsapp_accounts").select("*").eq("id", account_id).limit(1).execute()
    )
    return res.data[0] if res.data else None


async def delete_account(account_id: str) -> None:
    sb: Client = get_supabase_client()
    await _run(lambda: sb.table("whatsapp_accounts").delete().eq("id", account_id).execute())


async def list_accounts(member_ids: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    """``member_ids=None`` means admin scope (returns all accounts)."""
    sb: Client = get_supabase_client()
    if member_ids is None:
        res = await _run(
            lambda: sb.table("whatsapp_accounts").select("*").order("created_at", desc=True).execute()
        )
        return res.data or []
    if not member_ids:
        return []
    res = await _run(
        lambda: sb.table("whatsapp_accounts")
        .select("*")
        .in_("id_member", member_ids)
        .order("created_at", desc=True)
        .execute()
    )
    return res.data or []


async def list_persisted_accounts() -> List[Dict[str, Any]]:
    """Accounts whose bridge should auto-resume on backend startup."""
    sb: Client = get_supabase_client()
    res = await _run(
        lambda: sb.table("whatsapp_accounts")
        .select("*")
        .in_("status", ["connected", "connecting", "reconnecting"])
        .execute()
    )
    return res.data or []


async def find_account_by_cloud_phone_number_id(phone_number_id: str) -> Optional[Dict[str, Any]]:
    pid = (phone_number_id or "").strip()
    if not pid:
        return None
    sb: Client = get_supabase_client()
    res = await _run(
        lambda: sb.table("whatsapp_accounts")
        .select("*")
        .eq("cloud_phone_number_id", pid)
        .limit(1)
        .execute()
    )
    return res.data[0] if res.data else None


async def has_matching_webhook_verify_token(verify_token: str) -> bool:
    tok = (verify_token or "").strip()
    if not tok:
        return False
    sb: Client = get_supabase_client()
    res = await _run(
        lambda: sb.table("whatsapp_accounts")
        .select("id")
        .eq("cloud_webhook_verify_token", tok)
        .limit(1)
        .execute()
    )
    return bool(res.data)


# ── Conversations ─────────────────────────────────────────────────────────────

async def upsert_conversations(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if not rows:
        return []
    sb: Client = get_supabase_client()
    now = _now_iso()
    deduped: Dict[tuple[str, str], Dict[str, Any]] = {}
    for raw in rows:
        acct = str(raw.get("account_id") or "")
        jid = str(raw.get("chat_jid") or "").strip()
        if not acct or not jid:
            continue
        item = {k: v for k, v in raw.items() if v is not None}
        item["account_id"] = acct
        item["chat_jid"] = jid
        item["updated_at"] = now
        deduped[(acct, jid)] = item
    payload = list(deduped.values())
    if not payload:
        return []

    # Group by identical key set to prevent PostgREST HTTP 400 PGRST102
    # ("All object keys must match") on mixed direct/group batches.
    grouped: Dict[tuple[str, ...], List[Dict[str, Any]]] = {}
    for item in payload:
        sig = tuple(sorted(item.keys()))
        grouped.setdefault(sig, []).append(item)

    results: List[Dict[str, Any]] = []
    for batch in grouped.values():
        res = await _run(
            lambda b=batch: sb.table("whatsapp_conversations")
            .upsert(b, on_conflict="account_id,chat_jid")
            .execute()
        )
        results.extend(res.data or [])
    return results


async def update_existing_conversations_from_contacts(
    account_id: str,
    updates: List[Dict[str, Any]],
) -> int:
    """Enrich ONLY already-existing conversations with contact names/avatars/alt-JIDs.

    Never inserts brand-new empty conversations for phonebook contacts with zero messages.
    """
    if not updates:
        return 0
    by_jid: Dict[str, Dict[str, Any]] = {}
    for u in updates:
        jid = str(u.get("chat_jid") or "").strip()
        if jid:
            by_jid[jid] = u
    if not by_jid:
        return 0

    sb: Client = get_supabase_client()
    candidate_jids = list(by_jid.keys())
    existing_res = await _run(
        lambda: sb.table("whatsapp_conversations")
        .select("chat_jid")
        .eq("account_id", account_id)
        .in_("chat_jid", candidate_jids)
        .execute()
    )
    existing_jids = {str(r["chat_jid"]) for r in (existing_res.data or []) if r.get("chat_jid")}
    if not existing_jids:
        return 0

    now = _now_iso()
    updated_count = 0
    for jid in existing_jids:
        src = by_jid[jid]
        patch_fields: Dict[str, Any] = {"updated_at": now}
        if src.get("title"):
            patch_fields["title"] = str(src["title"])
        if src.get("avatar_url"):
            patch_fields["avatar_url"] = str(src["avatar_url"])
        if src.get("chat_alt_jid"):
            patch_fields["chat_alt_jid"] = str(src["chat_alt_jid"])
        if src.get("phone_number"):
            patch_fields["phone_number"] = str(src["phone_number"])
        if len(patch_fields) > 1:
            await _run(
                lambda j=jid, pf=patch_fields: sb.table("whatsapp_conversations")
                .update(pf)
                .eq("account_id", account_id)
                .eq("chat_jid", j)
                .execute()
            )
            updated_count += 1
    return updated_count


async def get_conversation(account_id: str, chat_jid: str) -> Optional[Dict[str, Any]]:
    sb: Client = get_supabase_client()
    res = await _run(
        lambda: sb.table("whatsapp_conversations")
        .select("*")
        .eq("account_id", account_id)
        .eq("chat_jid", chat_jid)
        .limit(1)
        .execute()
    )
    return res.data[0] if res.data else None


async def touch_conversation(
    account_id: str,
    chat_jid: str,
    *,
    chat_alt_jid: Optional[str] = None,
    chat_type: Optional[str] = None,
    title: Optional[str] = None,
    phone_number: Optional[str] = None,
    avatar_url: Optional[str] = None,
    last_message_at: Optional[str] = None,
    last_message_preview: Optional[str] = None,
    increment_unread: bool = False,
    participant_count: Optional[int] = None,
) -> Dict[str, Any]:
    sb: Client = get_supabase_client()

    def _do():
        existing_res = (
            sb.table("whatsapp_conversations")
            .select("*")
            .eq("account_id", account_id)
            .eq("chat_jid", chat_jid)
            .limit(1)
            .execute()
        )
        existing = existing_res.data[0] if existing_res.data else None
        row: Dict[str, Any] = {
            "account_id": account_id,
            "chat_jid": chat_jid,
            "updated_at": _now_iso(),
        }
        if chat_alt_jid:
            row["chat_alt_jid"] = chat_alt_jid
        if chat_type:
            row["chat_type"] = chat_type
        elif not existing:
            if chat_jid.endswith("@g.us"):
                row["chat_type"] = "group"
            elif chat_jid.endswith("@broadcast") or chat_jid == "status@broadcast":
                row["chat_type"] = "broadcast"
            else:
                row["chat_type"] = "direct"
        if title:
            row["title"] = title
        elif not existing and phone_number:
            row["title"] = phone_number
        if phone_number:
            row["phone_number"] = phone_number
        if avatar_url:
            row["avatar_url"] = avatar_url
        if last_message_at:
            row["last_message_at"] = last_message_at
        if last_message_preview is not None:
            row["last_message_preview"] = last_message_preview[:300]
        if participant_count is not None:
            row["participant_count"] = int(participant_count)
        if increment_unread:
            prev = int((existing or {}).get("unread_count") or 0)
            row["unread_count"] = prev + 1
        return (
            sb.table("whatsapp_conversations")
            .upsert(row, on_conflict="account_id,chat_jid")
            .execute()
        )

    res = await _run(_do)
    return res.data[0] if res.data else {"account_id": account_id, "chat_jid": chat_jid}


async def list_conversations(
    account_id: str,
    *,
    search: Optional[str] = None,
    filter_mode: str = "all",
    limit: int = 100,
) -> List[Dict[str, Any]]:
    sb: Client = get_supabase_client()
    mode = (filter_mode or "all").strip().lower()
    q_text = (search or "").strip().lower()

    def _do():
        q = (
            sb.table("whatsapp_conversations")
            .select("*")
            .eq("account_id", account_id)
        )
        if mode == "archived":
            q = q.eq("is_archived", True)
        else:
            q = q.eq("is_archived", False)
            if mode == "unread":
                q = q.gt("unread_count", 0)
            elif mode == "groups":
                q = q.eq("chat_type", "group")
            elif mode == "direct":
                q = q.eq("chat_type", "direct")
            elif mode == "pinned":
                q = q.eq("is_pinned", True)
        q = (
            q.order("is_pinned", desc=True)
            .order("last_message_at", desc=True)
            .limit(max(1, min(int(limit), 500)))
        )
        return q.execute()

    res = await _run(_do)
    rows = res.data or []
    if q_text:
        rows = [
            r
            for r in rows
            if q_text in str(r.get("title") or "").lower()
            or q_text in str(r.get("phone_number") or "").lower()
            or q_text in str(r.get("chat_jid") or "").lower()
            or q_text in str(r.get("custom_label") or "").lower()
            or q_text in str(r.get("last_message_preview") or "").lower()
        ]
    return rows


async def update_conversation(
    account_id: str,
    chat_jid: str,
    fields: Dict[str, Any],
) -> Dict[str, Any]:
    sb: Client = get_supabase_client()
    payload = {k: v for k, v in fields.items() if v is not None}
    payload["updated_at"] = _now_iso()
    res = await _run(
        lambda: sb.table("whatsapp_conversations")
        .update(payload)
        .eq("account_id", account_id)
        .eq("chat_jid", chat_jid)
        .execute()
    )
    return res.data[0] if res.data else {}


async def clear_unread(account_id: str, chat_jid: str) -> None:
    sb: Client = get_supabase_client()
    await _run(
        lambda: sb.table("whatsapp_conversations")
        .update({"unread_count": 0, "updated_at": _now_iso()})
        .eq("account_id", account_id)
        .eq("chat_jid", chat_jid)
        .execute()
    )


# ── Messages ──────────────────────────────────────────────────────────────────

async def upsert_message(row: Dict[str, Any]) -> Dict[str, Any]:
    sb: Client = get_supabase_client()
    res = await _run(
        lambda: sb.table("whatsapp_messages")
        .upsert(row, on_conflict="account_id,chat_jid,message_id")
        .execute()
    )
    return res.data[0] if res.data else row


async def upsert_messages_batch(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if not rows:
        return []
    sb: Client = get_supabase_client()
    deduped: Dict[tuple[str, str, str], Dict[str, Any]] = {}
    for r in rows:
        key = (str(r.get("account_id") or ""), str(r.get("chat_jid") or ""), str(r.get("message_id") or ""))
        if all(key):
            deduped[key] = r
    payload = list(deduped.values())
    if not payload:
        return []
    grouped: Dict[tuple[str, ...], List[Dict[str, Any]]] = {}
    for item in payload:
        sig = tuple(sorted(item.keys()))
        grouped.setdefault(sig, []).append(item)
    results: List[Dict[str, Any]] = []
    for batch in grouped.values():
        res = await _run(
            lambda b=batch: sb.table("whatsapp_messages")
            .upsert(b, on_conflict="account_id,chat_jid,message_id")
            .execute()
        )
        results.extend(res.data or [])
    return results


async def get_message(
    account_id: str,
    message_id: str,
    chat_jid: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    sb: Client = get_supabase_client()

    def _do():
        q = (
            sb.table("whatsapp_messages")
            .select("*")
            .eq("account_id", account_id)
            .eq("message_id", message_id)
        )
        if chat_jid:
            q = q.eq("chat_jid", chat_jid)
        return q.limit(1).execute()

    res = await _run(_do)
    return res.data[0] if res.data else None


async def list_messages(
    account_id: str,
    chat_jid: str,
    *,
    limit: int = 60,
    before_ts: Optional[str] = None,
) -> List[Dict[str, Any]]:
    sb: Client = get_supabase_client()

    def _do():
        q = (
            sb.table("whatsapp_messages")
            .select("*")
            .eq("account_id", account_id)
            .eq("chat_jid", chat_jid)
            .order("sent_at", desc=True)
            .limit(max(1, min(int(limit), 200)))
        )
        if before_ts:
            q = q.lt("sent_at", before_ts)
        return q.execute()

    res = await _run(_do)
    rows = res.data or []
    rows.reverse()  # Oldest -> newest for chat timeline rendering
    return rows


async def update_message_fields(
    account_id: str,
    chat_jid: str,
    message_id: str,
    fields: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    if not fields:
        return await get_message(account_id, message_id, chat_jid=chat_jid)
    sb: Client = get_supabase_client()

    def _do():
        q = (
            sb.table("whatsapp_messages")
            .update(fields)
            .eq("account_id", account_id)
            .eq("message_id", message_id)
        )
        if chat_jid:
            q = q.eq("chat_jid", chat_jid)
        return q.execute()

    res = await _run(_do)
    return res.data[0] if res.data else None


async def apply_message_reaction(
    account_id: str,
    chat_jid: str,
    message_id: str,
    sender_jid: str,
    emoji: str,
) -> Optional[Dict[str, Any]]:
    existing = await get_message(account_id, message_id, chat_jid=chat_jid)
    if not existing:
        return None
    reactions = list(existing.get("reactions") or [])
    normalized_sender = str(sender_jid or "me")
    reactions = [
        r for r in reactions
        if isinstance(r, dict) and str(r.get("sender_jid") or "") != normalized_sender
    ]
    cleaned_emoji = (emoji or "").strip()
    if cleaned_emoji:
        reactions.append({
            "sender_jid": normalized_sender,
            "emoji": cleaned_emoji,
            "ts": _now_iso(),
        })
    return await update_message_fields(
        account_id,
        existing.get("chat_jid") or chat_jid,
        message_id,
        {"reactions": reactions},
    )


async def mark_message_deleted(
    account_id: str,
    chat_jid: str,
    message_id: str,
    *,
    revoked: bool = True,
) -> Optional[Dict[str, Any]]:
    fields: Dict[str, Any] = {"is_deleted": True}
    if revoked:
        fields["msg_type"] = "revoked"
        fields["text"] = None
    return await update_message_fields(account_id, chat_jid, message_id, fields)


# ── Call Logs ─────────────────────────────────────────────────────────────────

async def upsert_call_log(row: Dict[str, Any]) -> Dict[str, Any]:
    sb: Client = get_supabase_client()
    res = await _run(
        lambda: sb.table("whatsapp_call_logs")
        .upsert(row, on_conflict="account_id,call_id")
        .execute()
    )
    return res.data[0] if res.data else row


async def get_call_log(account_id: str, call_id: str) -> Optional[Dict[str, Any]]:
    sb: Client = get_supabase_client()
    res = await _run(
        lambda: sb.table("whatsapp_call_logs")
        .select("*")
        .eq("account_id", account_id)
        .eq("call_id", call_id)
        .limit(1)
        .execute()
    )
    return res.data[0] if res.data else None


async def get_call_log_by_call_id(call_id: str) -> Optional[Dict[str, Any]]:
    sb: Client = get_supabase_client()
    res = await _run(
        lambda: sb.table("whatsapp_call_logs")
        .select("*")
        .eq("call_id", call_id)
        .limit(1)
        .execute()
    )
    return res.data[0] if res.data else None


async def update_call_log(
    account_id: str,
    call_id: str,
    fields: Dict[str, Any],
) -> Dict[str, Any]:
    sb: Client = get_supabase_client()
    res = await _run(
        lambda: sb.table("whatsapp_call_logs")
        .update(fields)
        .eq("account_id", account_id)
        .eq("call_id", call_id)
        .execute()
    )
    return res.data[0] if res.data else {}


async def list_call_logs(account_id: str, *, limit: int = 50) -> List[Dict[str, Any]]:
    sb: Client = get_supabase_client()
    res = await _run(
        lambda: sb.table("whatsapp_call_logs")
        .select("*")
        .eq("account_id", account_id)
        .order("started_at", desc=True)
        .limit(max(1, min(int(limit), 200)))
        .execute()
    )
    return res.data or []


# ── Quick Replies ─────────────────────────────────────────────────────────────

async def list_quick_replies(member_ids: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    sb: Client = get_supabase_client()
    if member_ids is None:
        res = await _run(
            lambda: sb.table("whatsapp_quick_replies")
            .select("*")
            .order("created_at", desc=True)
            .execute()
        )
        return res.data or []
    if not member_ids:
        return []
    res = await _run(
        lambda: sb.table("whatsapp_quick_replies")
        .select("*")
        .in_("id_member", member_ids)
        .order("created_at", desc=True)
        .execute()
    )
    return res.data or []


async def get_quick_reply(reply_id: str) -> Optional[Dict[str, Any]]:
    sb: Client = get_supabase_client()
    res = await _run(
        lambda: sb.table("whatsapp_quick_replies")
        .select("*")
        .eq("id", reply_id)
        .limit(1)
        .execute()
    )
    return res.data[0] if res.data else None


async def create_quick_reply(
    id_member: str,
    *,
    shortcut: str,
    title: str,
    content: str,
    category: str = "general",
) -> Dict[str, Any]:
    sb: Client = get_supabase_client()
    sc = shortcut.strip()
    if sc and not sc.startswith("/"):
        sc = f"/{sc}"
    row = {
        "id_member": str(id_member),
        "shortcut": sc,
        "title": title.strip(),
        "content": content.strip(),
        "category": (category or "general").strip() or "general",
    }
    res = await _run(lambda: sb.table("whatsapp_quick_replies").insert(row).execute())
    return res.data[0]


async def update_quick_reply(reply_id: str, fields: Dict[str, Any]) -> Dict[str, Any]:
    sb: Client = get_supabase_client()
    payload = dict(fields)
    if "shortcut" in payload and payload["shortcut"]:
        sc = str(payload["shortcut"]).strip()
        payload["shortcut"] = sc if sc.startswith("/") else f"/{sc}"
    payload["updated_at"] = _now_iso()
    res = await _run(
        lambda: sb.table("whatsapp_quick_replies").update(payload).eq("id", reply_id).execute()
    )
    return res.data[0] if res.data else {}


async def delete_quick_reply(reply_id: str) -> None:
    sb: Client = get_supabase_client()
    await _run(lambda: sb.table("whatsapp_quick_replies").delete().eq("id", reply_id).execute())


# ── Supabase Storage Media Upload (with Safe Local Fallback) ──────────────────

async def _ensure_bucket() -> None:
    global _bucket_ready
    if _bucket_ready:
        return
    async with _bucket_lock:
        if _bucket_ready:
            return
        sb: Client = get_supabase_client()

        def _do():
            try:
                sb.storage.create_bucket(settings.supabase_storage_bucket, options={"public": True})
            except Exception as exc:
                msg = str(exc).lower()
                if "already exists" not in msg and "duplicate" not in msg:
                    raise

        try:
            await _run(_do)
        except Exception:
            logger.warning(
                f"[WhatsApp] Không tạo được bucket '{settings.supabase_storage_bucket}' — sẽ fallback về endpoint media cục bộ nếu upload lỗi."
            )
        _bucket_ready = True


async def upload_media(path: str, data: bytes, content_type: Optional[str] = None) -> Optional[str]:
    await _ensure_bucket()
    sb: Client = get_supabase_client()
    bucket = settings.supabase_storage_bucket
    mime = content_type or "application/octet-stream"

    def _do():
        sb.storage.from_(bucket).upload(
            path,
            data,
            file_options={"content-type": mime, "upsert": "true"},
        )
        return sb.storage.from_(bucket).get_public_url(path)

    try:
        return await _run(_do)
    except Exception:
        logger.warning(f"[WhatsApp] Upload media lên Supabase Storage thất bại ({path}), fallback về local media URL.")
        return None


def local_media_fallback_url(account_id: str, message_id: str) -> str:
    return f"/api/all-platform/whatsapp/messages/media/{account_id}/{message_id}"


async def upload_local_media_with_fallback(
    account_id: str,
    message_id: str,
    local_path: Optional[str],
    content_type: Optional[str] = None,
) -> Optional[str]:
    """Upload a local media file to Supabase Storage; fall back to local API route if unavailable."""
    if not local_path:
        return None
    p = Path(local_path)
    if not p.is_file():
        return local_media_fallback_url(account_id, message_id)
    try:
        data = await asyncio.to_thread(p.read_bytes)
    except Exception:
        return local_media_fallback_url(account_id, message_id)
    mime = content_type or mimetypes.guess_type(p.name)[0] or "application/octet-stream"
    ext = p.suffix or (mimetypes.guess_extension(mime) or "")
    storage_key = f"{account_id}/{message_id}{ext}"
    public_url = await upload_media(storage_key, data, mime)
    return public_url or local_media_fallback_url(account_id, message_id)
