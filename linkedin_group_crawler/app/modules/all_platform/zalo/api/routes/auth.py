"""Zalo auth routes — Zalo tập trung (Server-Side QR + Extension 1-chạm dự phòng).

Hỗ trợ 2 luồng đăng nhập an toàn (không dùng Playwright):
1. Server-Side QR Login (`POST /qr/start`, `GET /qr/status/{qr_session_id}`,
   `POST /qr/cancel/{qr_session_id}`) qua `scripts/zca_qr_login.js` + Sticky VN Proxy
   và tái dùng `imei`/`proxy_url` khi re-link.
2. Chrome Extension 1-chạm (`POST /import-session`) — dự phòng khi Zalo yêu cầu
   xác minh tương tác; extension tự đóng tab `chat.zalo.me` sau khi đồng bộ.

`POST /reconnect` (force-restart listener khi bị Zalo kick "Overlimit
connection") nằm ở `accounts.py::POST /{account_id}/listener/restart`.
"""

from typing import Any, Dict, List, Optional
import asyncio
import re
import secrets
import uuid
from datetime import datetime
import time

import json

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.responses import Response, StreamingResponse, JSONResponse
from loguru import logger
from pydantic import BaseModel

from app.modules.all_platform.zalo.schemas.session import SessionData
from app.modules.all_platform.zalo.services.session_store import (
    delete_sessions_for_user,
    get_profile_lock,
    get_session,
    get_latest_session_for_user,
    save_session,
)
from app.modules.all_platform.zalo.services.supabase_service import (
    get_app_user_id_by_email,
    get_zalo_account_by_id,
    save_listener_messages,
    upsert_groups,
    upsert_zalo_account,
    upsert_zalo_user,
)
from app.modules.all_platform.zalo.schemas.message import Message
from app.modules.all_platform.zalo.services.zca_auth_store import (
    delete_zca_auth,
    ensure_session_zca_auth,
    inspect_zca_auth_health,
    load_zca_auth,
    save_zca_auth,
    validate_proxy_url,
)
from app.modules.all_platform.zalo.services.zca_persistent_listener import (
    WEB_SLOT_CONFLICT_MESSAGE,
    get_listener_status,
    start_listener,
    stop_listener,
    reset_listener_auth_expired,
)
from app.modules.all_platform.zalo.services.zca_qr_service import (
    ZaloQrSession,
    get_qr_manager,
)
from app.modules.all_platform.auth_deps import get_authenticated_caller_email
from app.modules.all_platform.zalo.api.routes.accounts import (
    _require_admin_leader_or_self,
    invalidate_zalo_accounts_cache,
)
from app.modules.all_platform.zalo.api.security import verify_zalo_api_key

router = APIRouter(
    prefix="/auth",
    tags=["zalo-auth"],
    dependencies=[Depends(verify_zalo_api_key)],
)


def _normalize_user_id(x_user_id: Optional[str]) -> str:
    raw = (x_user_id or "default").strip().lower()
    raw = re.sub(r"[^a-z0-9._-]+", "-", raw).strip("-._")
    return raw or "default"


def _build_session_id(user_id: str) -> str:
    return f"{user_id}--{uuid.uuid4().hex}"


_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE
)


async def _resolve_app_user_uuid(raw: Optional[str]) -> Optional[str]:
    """Đưa owner_id/id_member về đúng UUID app_users.id trước khi ghi Supabase.

    Extension gửi X-User-ID là EMAIL (đã bị _normalize_user_id đổi '@' thành '-',
    vd 'ngminhhoang0934-gmail.com') trong khi cột owner_id/id_member là uuid —
    insert thẳng sẽ 400 (22P02 invalid uuid). Thứ tự xử lý:
      1. Đã là UUID → dùng luôn.
      2. Còn '@' (email thô) → tra app_users theo email.
      3. Dạng đã normalize 'ten-domain.tld' → thử khôi phục '@' ở dấu '-' cuối
         trước phần domain rồi tra app_users.
      4. Không ra → None (bỏ qua field, KHÔNG nhét chuỗi email vào cột uuid).
    """
    value = (raw or "").strip()
    if not value or value == "default":
        return None
    if _UUID_RE.match(value):
        return value
    if "@" in value:
        try:
            return await get_app_user_id_by_email(value)
        except Exception:
            return None
    m = re.match(r"^(.+)-([a-z0-9-]+\.[a-z0-9.]+)$", value, re.IGNORECASE)
    if m:
        try:
            return await get_app_user_id_by_email(f"{m.group(1)}@{m.group(2)}")
        except Exception:
            return None
    return None


async def _remember_zalo_user(
    user_id: str,
    status: str,
    worker_id: Optional[str] = None,
    cookie: Optional[str] = None,
    owner_id: Optional[str] = None,
    id_member: Optional[str] = None,
    label: Optional[str] = None,
) -> None:
    # id_member là cột UUID (app_users.id) ở cả zalo_users lẫn zalo_accounts —
    # extension gửi email nên phải resolve về UUID thật (hoặc bỏ qua), tránh 22P02.
    # owner_id của zalo_accounts là cột TEXT (giữ nguyên email normalize để
    # auto-resolve `or=(owner_id.eq...,id_member.eq...)` tra lại được) — KHÔNG đổi.
    safe_member_id = await _resolve_app_user_uuid(id_member)
    try:
        await upsert_zalo_user(
            user_id,
            status=status,
            assigned_worker_id=worker_id,
            cookie=cookie,
            id_member=safe_member_id,
        )
    except Exception as exc:
        logger.warning(f"Could not upsert Zalo user metadata for user={user_id}: {exc}")
    try:
        existing = await get_zalo_account_by_id(user_id) or {}
        resolved_owner_id = owner_id or existing.get("owner_id") or user_id
        resolved_member_id = safe_member_id or existing.get("id_member")
        resolved_label = (label or "").strip() or existing.get("label") or user_id
        await upsert_zalo_account(
            account_id=user_id,
            owner_id=resolved_owner_id,
            id_member=resolved_member_id,
            label=resolved_label,
            phone=existing.get("phone"),
            status=status,
        )
    except Exception as exc:
        logger.warning(f"Could not upsert Zalo account metadata for account={user_id}: {exc}")


async def _persist_first_time_sync_result(user_id: str, result: Dict[str, Any]) -> None:
    """Lưu groups + friends + messages trả về từ first_time_sync vào Supabase."""
    try:
        # 1. Upsert groups + friends vào zalo_groups
        all_chats = list(result.get("groups") or []) + list(result.get("friends") or [])
        if all_chats:
            await upsert_groups(user_id, all_chats)
            logger.info(
                f"Persisted {len(all_chats)} groups/friends for user={user_id}"
            )
    except Exception as exc:
        logger.warning(f"Could not persist groups/friends for user={user_id}: {exc}")

    try:
        # 2. Save messages vào zalo_messages, grouped by thread_id
        raw_messages = result.get("messages") or []
        if raw_messages:
            # Group messages by thread_id (= group_id / friend_id)
            threads: Dict[str, list] = {}
            for m in raw_messages:
                tid = str(m.get("thread_id") or m.get("group_id") or "").strip()
                if tid:
                    threads.setdefault(tid, []).append(m)

            total_saved = 0
            for thread_id, msgs in threads.items():
                messages = [
                    Message(
                        message_id=str(m.get("message_id") or ""),
                        sender_id=m.get("sender_id"),
                        sender_name=m.get("sender_name"),
                        timestamp=m.get("timestamp"),
                        time_text=m.get("time_text"),
                        type=str(m.get("type") or "text"),
                        content=m.get("content"),
                        image_urls=[str(u) for u in (m.get("image_urls") or []) if u],
                        reply_to_id=m.get("reply_to_id"),
                        is_deleted=bool(m.get("is_deleted")),
                        is_sent=bool(m.get("is_sent")),
                        group_id=thread_id,
                    )
                    for m in msgs
                    if m.get("message_id")
                ]
                if messages:
                    saved = await save_listener_messages(
                        user_id, thread_id, thread_id, messages,
                        increment_unread=False,
                    )
                    total_saved += saved
            logger.info(
                f"Persisted {total_saved} messages across {len(threads)} threads "
                f"for user={user_id}"
            )
    except Exception as exc:
        logger.warning(f"Could not persist first-time-sync messages for user={user_id}: {exc}")


def _serialize_login_state(
    user_id: str,
    session: Optional[SessionData],
    status: str,
    *,
    health: Optional[Dict[str, Any]] = None,
    conflict_type: Optional[str] = None,
    message: Optional[str] = None,
) -> dict:
    safe_health = health or {
        "cookie_expires_at": None,
        "cookie_expiring_soon": False,
        "has_proxy": False,
        "proxy_masked": None,
    }
    payload = {
        "user_id": user_id,
        "session_id": session.session_id if session else None,
        "status": status,
        "is_logged_in": status == "confirmed",
        "can_crawl": status == "confirmed",
        "session_expired": status == "session_expired",
        "cookie_expires_at": safe_health.get("cookie_expires_at"),
        "cookie_expiring_soon": bool(safe_health.get("cookie_expiring_soon", False)),
        "conflict_type": conflict_type,
        "has_proxy": bool(safe_health.get("has_proxy", False)),
        "proxy_masked": safe_health.get("proxy_masked"),
    }
    if message:
        payload["message"] = message
    return payload


async def _build_current_status_payload(user_id: str) -> dict:
    """Trạng thái đăng nhập + sức khỏe phiên (cookie expiry, sticky proxy, conflict_type)."""
    session = await get_latest_session_for_user(user_id)
    persisted_auth = await load_zca_auth(user_id)
    listener = get_listener_status(user_id)
    effective_auth = (session.zca_auth if session and session.zca_auth else None) or persisted_auth
    health = inspect_zca_auth_health(effective_auth)

    if not session:
        if not persisted_auth:
            return _serialize_login_state(user_id, None, "not_logged_in", health=health)
        session = SessionData(
            session_id=_build_session_id(user_id),
            user_id=user_id,
            browser=None,
            context=None,
            page=None,
            status="confirmed",
            qr_base64=None,
            qr_signature=None,
            zca_auth=persisted_auth,
            created_at=datetime.utcnow(),
            last_used=datetime.utcnow(),
        )
        await save_session(session)
        logger.info(f"Restored confirmed ZCA session from auth store for user={user_id}")

    # Kiểm tra xung đột 1-Web-Slot hoặc auth_expired TRƯỚC ensure_session_zca_auth
    # để phiên đang bị đánh dấu session_expired không bị tụt thành not_logged_in,
    # đồng thời giữ nguyên file zca-auth (imei + proxy_url) cho lần kết nối lại.
    listener_conflict = listener.get("conflict_type")
    if listener_conflict == "web_slot_conflict" and not listener.get("connected"):
        return _serialize_login_state(
            user_id,
            session,
            "session_expired",
            health=health,
            conflict_type="web_slot_conflict",
            message=WEB_SLOT_CONFLICT_MESSAGE,
        )

    if listener.get("auth_expired") and not listener.get("connected"):
        if session.status != "session_expired":
            logger.warning(
                f"ZCA session expired for user={user_id} — keeping auth file (imei + proxy_url) "
                f"and marking session_expired"
            )
            session.status = "session_expired"
            session.last_used = datetime.utcnow()
            await save_session(session)
        return _serialize_login_state(
            user_id,
            session,
            "session_expired",
            health=health,
            conflict_type=listener_conflict or "logged_out",
        )

    if session.status == "session_expired" and not listener.get("connected"):
        return _serialize_login_state(
            user_id,
            session,
            "session_expired",
            health=health,
            conflict_type=listener_conflict or "logged_out",
        )

    if not await ensure_session_zca_auth(session):
        return _serialize_login_state(user_id, session, "not_logged_in", health=health)

    if session.status != "confirmed":
        session.status = "confirmed"
        session.qr_base64 = None
        session.qr_signature = None
        session.last_used = datetime.utcnow()
        await save_session(session)
    return _serialize_login_state(user_id, session, "confirmed", health=health, conflict_type=None)


@router.get("/current-status")
async def get_current_status(
    x_user_id: str = Header("default", alias="X-User-ID"),
):
    user_id = _normalize_user_id(x_user_id)
    return await _build_current_status_payload(user_id)


@router.get("/status")
async def get_auth_status_health(
    account_id: Optional[str] = Query(None),
    user_id: Optional[str] = Query(None),
    x_user_id: str = Header("default", alias="X-User-ID"),
):
    """Status + session health endpoint (cookie_expires_at, cookie_expiring_soon, conflict_type, proxy_masked)."""
    resolved = _normalize_user_id(account_id or user_id or x_user_id)
    return await _build_current_status_payload(resolved)


async def _start_listener_and_first_sync(uid: str, uauth: dict, source_label: str = "extension") -> None:
    import time as _time

    t0 = _time.time()
    try:
        logger.info(f"{source_label}: [1/2] starting persistent listener for user={uid}...")
        await start_listener(uid, uauth, force_restart=True)
        logger.info(f"{source_label}: [1/2] persistent listener started for {uid} in {_time.time() - t0:.1f}s")
    except Exception as start_exc:
        logger.warning(f"{source_label}: [1/2] could not start listener for user={uid}: {start_exc}")

    t1 = _time.time()
    try:
        logger.info(f"{source_label}: [2/2] starting first-time sync for user={uid}...")
        from app.modules.all_platform.zalo.services.zca_api_bridge import first_time_sync

        result = await first_time_sync(
            auth=uauth,
            zalo_account_id=uid,
            messages_per_chat=50,
            group_limit=8,
            include_friends=True,
        )
        logger.info(f"{source_label}: [2/2] first-time sync done for {uid} in {_time.time() - t1:.1f}s")
        await _persist_first_time_sync_result(uid, result)
    except Exception as sync_exc:
        logger.warning(f"{source_label}: [2/2] first-time sync non-fatal error for {uid}: {sync_exc}")


class ZaloQrStartRequest(BaseModel):
    account_id: Optional[str] = None
    label: Optional[str] = None
    proxy_url: Optional[str] = None


async def _allocate_unique_zalo_account_id() -> str:
    for _ in range(10):
        candidate = f"zl_{secrets.token_hex(4)}"
        try:
            existing = await get_zalo_account_by_id(candidate)
            if not existing:
                return candidate
        except Exception:
            return candidate
    return f"zl_{secrets.token_hex(6)}"


async def _persist_confirmed_qr_session(qr_session: ZaloQrSession, auth: Dict[str, Any]) -> str:
    account_id = qr_session.account_id or await _allocate_unique_zalo_account_id()
    auth_to_save = dict(auth)
    if not auth_to_save.get("zaloId"):
        auth_to_save["zaloId"] = account_id

    profile_lock = await get_profile_lock(account_id)
    async with profile_lock:
        await delete_sessions_for_user(account_id)

    session_id = _build_session_id(account_id)
    session = SessionData(
        session_id=session_id,
        user_id=account_id,
        browser=None,
        context=None,
        page=None,
        status="confirmed",
        qr_base64=None,
        qr_signature=None,
        zca_auth=auth_to_save,
        created_at=datetime.utcnow(),
        last_used=datetime.utcnow(),
    )
    await save_session(session)
    await save_zca_auth(account_id, auth_to_save)

    parsed_cookies = auth_to_save.get("cookies") or []
    cookie_str = "; ".join(
        f"{c.get('key')}={c.get('value')}"
        for c in (parsed_cookies if isinstance(parsed_cookies, list) else [])
        if isinstance(c, dict) and c.get("key") and c.get("value") is not None
    )
    resolved_label = (qr_session.label or qr_session.display_name or "").strip() or None
    await _remember_zalo_user(
        account_id,
        "confirmed",
        None,
        cookie=cookie_str or None,
        owner_id=qr_session.owner_id,
        id_member=qr_session.id_member or qr_session.owner_id,
        label=resolved_label,
    )
    invalidate_zalo_accounts_cache()
    reset_listener_auth_expired(account_id)
    asyncio.create_task(_start_listener_and_first_sync(account_id, auth_to_save, source_label="Server QR"))
    logger.info(
        f"Persisted server-side QR login for account={account_id} qr_session={qr_session.qr_session_id} "
        f"has_proxy={bool(auth_to_save.get('proxy_url'))}"
    )
    return account_id


async def _authorize_qr_session_access(caller_email: Optional[str], qr_session: ZaloQrSession) -> None:
    if not caller_email:
        raise HTTPException(status_code=401, detail="Cần đăng nhập để thao tác phiên QR Zalo")
    if qr_session.owner_email and qr_session.owner_email.lower() == caller_email.strip().lower():
        return
    await _require_admin_leader_or_self(caller_email, qr_session.id_member or qr_session.owner_id)


@router.post("/qr/start")
async def start_zalo_qr_login(
    body: Optional[ZaloQrStartRequest] = None,
    x_user_id: str = Header("default", alias="X-User-ID"),
    caller_email: Optional[str] = Depends(get_authenticated_caller_email),
):
    """Khởi tạo phiên quét mã QR Zalo trực tiếp phía server (tái dùng imei & proxy_url nếu re-link)."""
    if not caller_email:
        raise HTTPException(status_code=401, detail="Cần đăng nhập để tạo mã QR Zalo")

    req = body or ZaloQrStartRequest()
    target_account_id = _normalize_user_id(req.account_id) if (req.account_id and req.account_id.strip()) else None

    target_id_member: Optional[str] = None
    if target_account_id:
        target_account = None
        try:
            target_account = await get_zalo_account_by_id(target_account_id)
        except Exception:
            target_account = None
        existing_auth = await load_zca_auth(target_account_id)
        target_owner = (
            (target_account.get("id_member") or target_account.get("owner_id"))
            if target_account
            else ((existing_auth or {}).get("idMember") or (existing_auth or {}).get("ownerId"))
        )
        await _require_admin_leader_or_self(caller_email, target_owner)
        target_id_member = (target_account or {}).get("id_member") or (existing_auth or {}).get("idMember")
    else:
        try:
            target_id_member = await get_app_user_id_by_email(caller_email)
        except Exception:
            target_id_member = None

    proxy_explicitly_cleared = req.proxy_url is not None and req.proxy_url.strip() == ""
    raw_proxy: Optional[str] = None
    if req.proxy_url is not None and not proxy_explicitly_cleared:
        try:
            raw_proxy = validate_proxy_url(req.proxy_url)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))

    owner_id = _normalize_user_id(caller_email or x_user_id)
    try:
        qr_session = await get_qr_manager().start_session(
            account_id=target_account_id,
            label=req.label,
            proxy_url=raw_proxy,
            proxy_explicitly_cleared=proxy_explicitly_cleared,
            owner_id=owner_id,
            owner_email=caller_email,
            id_member=target_id_member,
            on_confirmed=_persist_confirmed_qr_session,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=429 if "quá nhiều" in str(exc).lower() else 500, detail=str(exc))

    return qr_session.to_start_response()


@router.get("/qr/status/{qr_session_id}")
async def get_zalo_qr_status(
    qr_session_id: str,
    caller_email: Optional[str] = Depends(get_authenticated_caller_email),
):
    """Kiểm tra trạng thái phiên quét mã QR Zalo (starting/qr_ready/scanned/confirmed/expired/declined/cancelled/error)."""
    qr_session = get_qr_manager().get_session(qr_session_id)
    if not qr_session:
        raise HTTPException(status_code=404, detail="Không tìm thấy phiên mã QR Zalo")
    await _authorize_qr_session_access(caller_email, qr_session)
    return qr_session.to_status_response()


@router.post("/qr/cancel/{qr_session_id}")
async def cancel_zalo_qr_login(
    qr_session_id: str,
    caller_email: Optional[str] = Depends(get_authenticated_caller_email),
):
    """Huỷ phiên quét mã QR Zalo và kết thúc tiến trình con ngay lập tức."""
    if not caller_email:
        raise HTTPException(status_code=401, detail="Cần đăng nhập để huỷ phiên QR Zalo")
    qr_session = get_qr_manager().get_session(qr_session_id)
    if qr_session is not None:
        await _authorize_qr_session_access(caller_email, qr_session)
    return await get_qr_manager().cancel_session(qr_session_id)


@router.get("/events")
async def auth_status_events(
    request: Request,
    user_id: str = Query("default"),
):
    from app.modules.all_platform.zalo.services.message_events import (
        publish_auth_expired,
        wait_for_auth_expired_user,
    )

    normalized_user_id = _normalize_user_id(user_id)
    # FIX H-2: Đặt deadline 10 phút để tránh SSE stream chạy vĩnh viễn
    # sau khi client ngắt kết nối hoặc sau khi đã xác nhận đăng nhập.
    _SSE_MAX_SECONDS = 600
    _POLL_INTERVAL = 2.0  # giây giữa mỗi lần poll status

    async def _event_stream():
        last_payload = ""
        deadline = asyncio.get_event_loop().time() + _SSE_MAX_SECONDS
        confirmed_and_streaming = False

        while asyncio.get_event_loop().time() < deadline:
            if await request.is_disconnected():
                logger.info(f"SSE client disconnected for user={normalized_user_id}")
                break

            # 1. Kiểm tra auth_expired event từ ZCA listener (chờ tối đa _POLL_INTERVAL giây).
            # Dùng per-user queue để tránh race condition khi nhiều user cùng online:
            # wait_for_auth_expired_user chỉ đọc queue của normalized_user_id này.
            expired_event = await wait_for_auth_expired_user(normalized_user_id, timeout=_POLL_INTERVAL)
            if expired_event is not None:
                # KHÔNG gọi delete_zca_auth() khi auth_expired/web_slot_conflict!
                # Giữ nguyên file zca-auth (imei + proxy_url) để lần kết nối lại
                # tái sử dụng đúng định danh thiết bị & Sticky VN Proxy.
                session = None
                try:
                    session = await get_latest_session_for_user(normalized_user_id)
                    if session:
                        session.status = "session_expired"
                        await save_session(session)
                except Exception as cleanup_exc:
                    logger.warning(f"Could not mark expired session for user={normalized_user_id}: {cleanup_exc}")

                persisted_auth = await load_zca_auth(normalized_user_id)
                health = inspect_zca_auth_health(persisted_auth)
                listener_st = get_listener_status(normalized_user_id)
                conflict_type = listener_st.get("conflict_type") or (
                    "web_slot_conflict"
                    if expired_event[1] == WEB_SLOT_CONFLICT_MESSAGE
                    else "logged_out"
                )
                payload = {
                    "user_id": normalized_user_id,
                    "session_id": session.session_id if session else None,
                    "status": "session_expired",
                    "is_logged_in": False,
                    "can_crawl": False,
                    "session_expired": True,
                    "conflict_type": conflict_type,
                    "cookie_expires_at": health.get("cookie_expires_at"),
                    "cookie_expiring_soon": bool(health.get("cookie_expiring_soon", False)),
                    "has_proxy": bool(health.get("has_proxy", False)),
                    "proxy_masked": health.get("proxy_masked"),
                    "message": expired_event[1] or "Phiên Zalo đã hết hạn. Vui lòng đăng nhập lại bằng mã QR hoặc Extension.",
                }
                yield f"event: auth-status\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"
                logger.info(
                    f"Pushed session_expired (conflict_type={conflict_type}) to SSE for user={normalized_user_id}"
                )
                continue

            # 2. Không có auth_expired → poll status bình thường.
            try:
                payload = await _build_current_status_payload(normalized_user_id)
                payload_json = json.dumps(payload, ensure_ascii=False)
                if payload_json != last_payload:
                    last_payload = payload_json
                    yield f"event: auth-status\ndata: {payload_json}\n\n"
                    if payload.get("is_logged_in") and not confirmed_and_streaming:
                        confirmed_and_streaming = True
                        # Đã xác nhận: chờ thêm một chu kỳ rồi mới đóng
                        # để FE kịp nhận event cuối cùng.
                        await asyncio.sleep(_POLL_INTERVAL)
                        logger.info(f"SSE stream closing — user={normalized_user_id} confirmed login")
                        yield "event: close\ndata: {}\n\n"
                        return
                else:
                    yield f"event: heartbeat\ndata: {{\"ts\":{int(time.time())}}}\n\n"
            except Exception as exc:
                logger.warning(f"SSE auth status stream error for user={normalized_user_id}: {exc}")
                yield "event: error\ndata: {\"message\":\"status_stream_error\"}\n\n"
            await asyncio.sleep(_POLL_INTERVAL)
        # Hết deadline hoặc thoát vòng lặp
        yield "event: close\ndata: {\"reason\":\"timeout\"}\n\n"

    return StreamingResponse(
        _event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/status/{session_id}")
async def get_status(
    session_id: str,
    x_user_id: str = Header("default", alias="X-User-ID"),
    x_zalo_worker_id: Optional[str] = Header(None, alias="X-Zalo-Worker-ID"),
):
    session = await get_session(session_id)
    if not session:
        raise HTTPException(status_code=401, detail="Session not found, please login")
    if session.user_id != _normalize_user_id(x_user_id):
        raise HTTPException(status_code=403, detail="Session does not belong to current user")

    normalized_uid = _normalize_user_id(x_user_id)
    persisted_auth = await load_zca_auth(normalized_uid)
    health = inspect_zca_auth_health(session.zca_auth or persisted_auth)
    listener_st = get_listener_status(normalized_uid)

    if await ensure_session_zca_auth(session):
        if session.status != "confirmed":
            session.status = "confirmed"
            session.qr_base64 = None
            session.qr_signature = None
            await save_session(session)
        await _remember_zalo_user(normalized_uid, "confirmed", x_zalo_worker_id)
        return {
            "user_id": normalized_uid,
            "session_id": session_id,
            "status": "confirmed",
            "conflict_type": listener_st.get("conflict_type"),
            **health,
        }

    await _remember_zalo_user(normalized_uid, session.status, x_zalo_worker_id)
    return {
        "user_id": normalized_uid,
        "session_id": session_id,
        "status": session.status,
        "conflict_type": listener_st.get("conflict_type"),
        **health,
    }


@router.delete("/session/{session_id}")
async def logout(session_id: str, x_user_id: str = Header("default", alias="X-User-ID")):
    session = await get_session(session_id)
    if not session:
        raise HTTPException(status_code=401, detail="Session not found")
    if session.user_id != _normalize_user_id(x_user_id):
        raise HTTPException(status_code=403, detail="Session does not belong to current user")

    user_id = _normalize_user_id(x_user_id)
    await stop_listener(user_id)
    removed = await delete_sessions_for_user(user_id)
    zca_auth_removed = await delete_zca_auth(user_id)

    return {
        "user_id": user_id,
        "message": "Logged out and cleared login data",
        "removed": removed,
        "zca_auth_removed": zca_auth_removed,
    }


@router.delete("/sessions")
async def logout_all_sessions(x_user_id: str = Header("default", alias="X-User-ID")):
    user_id = _normalize_user_id(x_user_id)
    await stop_listener(user_id)
    removed = await delete_sessions_for_user(user_id)
    zca_auth_removed = await delete_zca_auth(user_id)

    return {
        "user_id": user_id,
        "message": f"Closed {removed} session(s) and cleared login data",
        "removed": removed,
        "zca_auth_removed": zca_auth_removed,
    }


@router.options("/import-session")
async def import_session_options():
    return Response(
        status_code=200,
        headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "*",
        },
    )


@router.post("/import-session")
async def import_session_from_extension(
    request: Request,
    x_user_id: str = Header("default", alias="X-User-ID"),
    x_zalo_worker_id: Optional[str] = Header(None, alias="X-Zalo-Worker-ID"),
):
    """Import Zalo session cookies from Chrome Extension.

    The extension captures cookies from ``chat.zalo.me`` after a successful QR
    scan in the user's real browser.  Those cookies are sent here so the
    backend can create a confirmed ``SessionData`` and start the ZCA persistent
    listener — đây LÀ luồng đăng nhập duy nhất (Zalo tập trung).

    Expected JSON body::

        {
            "user_id": "agent-zalo-1",   // optional, falls back to X-User-ID header
            "cookies": [
                {"key": "zppsid",  "value": "...", "domain": "chat.zalo.me", ...},
                {"key": "zppwsid", "value": "...", "domain": "chat.zalo.me", ...},
                {"key": "zpsid",   "value": "...", "domain": "chat.zalo.me", ...},
                {"key": "zphpsid", "value": "...", "domain": "chat.zalo.me", ...},
                {"key": "_ga",     "value": "...", "domain": ".zalo.me",      ...}
            ],
            "imei":         "optional — zca-js requires a truthy IMEI (auto-generated if missing)",
            "user_agent":   "Mozilla/5.0 ...",
            "owner_id":     "optional — defaults to X-User-ID"
        }

    Validation:
        * Cookies: lấy được bao nhiêu dùng bấy nhiêu, không yêu cầu specific keys
        * Mỗi cookie phải có key + value
        * user_agent bắt buộc (Chrome thật), không chấp nhận default
    """
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    if not isinstance(body, dict):
        raise HTTPException(
            status_code=400,
            detail=(
                "Body must be a JSON object. Send cookies inside the 'cookies' field, "
                "not as the top-level body."
            ),
        )

    raw_user_id = body.get("account_id") or body.get("user_id") or x_user_id
    user_id = _normalize_user_id(raw_user_id)
    owner_id = _normalize_user_id(body.get("owner_id") or x_user_id)
    id_member = _normalize_user_id(body.get("id_member") or owner_id)

    # Nếu user_id không bắt đầu bằng "zl_" (ví dụ là email), tự động tìm kiếm zalo_account tương ứng.
    # QUAN TRỌNG: nếu KHÔNG resolve được (DB lỗi hoặc không có account nào gắn
    # với email này), PHẢI raise lỗi rõ ràng — trước đây code chỉ log warning
    # rồi tiếp tục với user_id = email gốc, khiến hệ thống lưu 1 "account" ảo
    # keyed bằng chuỗi email (vd "admin123-gmail.com") — vẫn chạy được (listener
    # + zalo_groups/zalo_messages chỉ khoá theo user_id text, không cần row
    # trong zalo_accounts) NHƯNG không có RBAC/ownership/hiển thị đúng trong
    # trang quản lý tài khoản. Chặn ngay từ đầu thay vì để lặp lại tình trạng
    # này với người dùng khác — ai gặp lỗi này cần tạo tài khoản Zalo thật
    # trước (Thêm tài khoản mới) rồi mới đăng nhập qua Extension.
    if not user_id.startswith("zl_"):
        resolved_account_id: Optional[str] = None
        try:
            from app.modules.all_platform.zalo.services.supabase_service import _rest
            params = {
                "select": "account_id,phone,status",
                "order": "created_at.desc",
            }
            safe_member_id = await _resolve_app_user_uuid(user_id)
            if safe_member_id:
                params["or"] = f"(owner_id.eq.{user_id},id_member.eq.{safe_member_id})"
            else:
                params["owner_id"] = f"eq.{user_id}"

            db_accounts = await _rest(
                "GET",
                "zalo_accounts",
                params=params,
            ) or []
            zl_accounts = [a for a in db_accounts if a.get("account_id", "").startswith("zl_")]
            if zl_accounts:
                target_account = None
                for a in zl_accounts:
                    if a.get("status") == "not_logged_in":
                        target_account = a
                        break
                if not target_account:
                    target_account = zl_accounts[0]
                resolved_account_id = target_account["account_id"]
        except Exception as resolve_exc:
            logger.warning(f"Could not auto-resolve email user_id={user_id} to account_id: {resolve_exc}")
            raise HTTPException(
                status_code=503,
                detail=f"Không thể tra cứu tài khoản Zalo cho '{user_id}' lúc này (lỗi DB). Thử lại sau.",
            )

        if not resolved_account_id:
            raise HTTPException(
                status_code=404,
                detail=(
                    f"Không tìm thấy tài khoản Zalo nào gắn với '{user_id}'. "
                    "Hãy vào trang Tài khoản Zalo, bấm 'Thêm tài khoản mới' trước, "
                    "rồi mới đăng nhập qua Extension."
                ),
            )
        logger.info(f"Auto-resolved email user_id={user_id} to Zalo account_id={resolved_account_id}")
        user_id = resolved_account_id

    # ── Parse cookies: accept 4 formats ────────────────────────────────
    #   1. List of {key, value, domain, ...}  (Chrome extension native format)
    #   2. JSON string of list  (e.g. '[{"key":"...","value":"..."}]')
    #   3. JSON string of object  (e.g. '{"cookies":[{...}]}')  ← extension v1.0.x
    #   4. Plain "k=v; k=v" string             (legacy, NOT recommended)
    cookies_raw = body.get("cookies")
    if not cookies_raw:
        raise HTTPException(status_code=400, detail="Missing 'cookies' field")

    parsed_cookies: List[Dict[str, Any]] = []
    if isinstance(cookies_raw, list):
        for c in cookies_raw:
            if isinstance(c, dict) and c.get("key") and c.get("value") is not None:
                parsed_cookies.append(c)
    elif isinstance(cookies_raw, str):
        stripped = cookies_raw.strip()
        if stripped.startswith("["):
            # JSON string of array
            try:
                arr = json.loads(stripped)
                for c in arr:
                    if isinstance(c, dict) and c.get("key") and c.get("value") is not None:
                        parsed_cookies.append(c)
            except Exception as exc:
                raise HTTPException(
                    status_code=400,
                    detail=f"cookies is JSON string but invalid: {exc}",
                )
        elif stripped.startswith("{"):
            # JSON string of object: try to extract "cookies" field
            try:
                obj = json.loads(stripped)
                inner = obj.get("cookies") if isinstance(obj, dict) else None
                if isinstance(inner, list):
                    for c in inner:
                        if isinstance(c, dict) and c.get("key") and c.get("value") is not None:
                            parsed_cookies.append(c)
                elif isinstance(inner, str) and inner.strip().startswith("["):
                    arr = json.loads(inner)
                    for c in arr:
                        if isinstance(c, dict) and c.get("key") and c.get("value") is not None:
                            parsed_cookies.append(c)
            except Exception as exc:
                logger.warning(f"Failed to parse cookies JSON object: {exc}")
        else:
            # Plain "k=v; k=v" format — LEGACY, không được khuyến nghị.
            # Format này không cung cấp httpOnly/secure/domain → không đủ thông tin
            # để import cookie an toàn. Cảnh báo để caller chuyển sang structured format.
            # Vẫn hỗ trợ để không break backward compatibility nhưng log warning rõ ràng.
            logger.warning(
                f"import-session: received legacy 'k=v; k=v' cookie string format for user={user_id}. "
                "This format is deprecated and lacks httpOnly/secure/domain metadata. "
                "Please upgrade to structured Chrome-cookie array format."
            )
            for part in stripped.split(";"):
                part = part.strip()
                if "=" in part:
                    k, v = part.split("=", 1)
                    parsed_cookies.append({
                        "key": k.strip(),
                        "value": v.strip(),
                        "domain": ".zalo.me",  # Dùng .zalo.me thay vì chat.zalo.me để rộng hơn
                        "path": "/",
                        "httpOnly": True,
                        "secure": True,
                    })

    if not parsed_cookies:
        raise HTTPException(
            status_code=400,
            detail="Could not parse any cookies. Expected Chrome-cookie array (key/value/domain) or 'k=v; k=v' string.",
        )

    # ── Cookie validation: bypassed ─────────────────────────────────────
    # Lấy được bao nhiêu dùng bấy nhiêu, không yêu cầu specific keys.
    # ZCA-JS chỉ cần imei + cookies + userAgent, không check tên cookie cụ thể.

    # ── Validate user_agent (phải là Chrome thật, không dùng default) ─
    user_agent = (body.get("user_agent") or "").strip()
    if not user_agent or "Mozilla" not in user_agent:
        raise HTTPException(
            status_code=400,
            detail="user_agent bắt buộc và phải là Chrome thật (có 'Mozilla'). Hãy gửi navigator.userAgent của trình duyệt.",
        )

    # ── IMEI: PHẢI ổn định qua nhiều lần import cho cùng 1 account ────
    # Zalo coi cookie zpsid/zpw_sek là "session key" gắn với đúng 1 imei lúc
    # phát hành — nếu mỗi lần import sinh uuid.uuid4() MỚI (như code cũ) thì
    # imei gửi lên không bao giờ khớp với imei mà Zalo thực sự gắn cho phiên
    # đó, khiến loginCookie() luôn bị Zalo trả error_code 102 "session key
    # improperly submitted" dù cookie lấy đúng 100%. Ưu tiên imei extension
    # gửi lên (đã tự cache ổn định phía extension từ 2026-08-25); nếu không
    # có, tái dùng đúng imei đã lưu từ lần import trước cho account này —
    # CHỈ sinh UUID mới khi account này chưa từng có imei nào được lưu.
    existing_auth = await load_zca_auth(user_id)
    imei = (body.get("imei") or "").strip()
    if not imei:
        imei = (existing_auth or {}).get("imei") or ""
    if not imei:
        imei = str(uuid.uuid4())

    # Giữ lại proxy_url đã lưu khi re-import qua extension (hoặc cập nhật nếu body có gửi)
    resolved_proxy_url: Optional[str] = None
    if "proxy_url" in body:
        raw_proxy = body.get("proxy_url")
        if raw_proxy is not None and str(raw_proxy).strip() != "":
            try:
                resolved_proxy_url = validate_proxy_url(str(raw_proxy))
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc))
        else:
            resolved_proxy_url = None
    else:
        resolved_proxy_url = str((existing_auth or {}).get("proxy_url") or "").strip() or None

    # ── Build a ZCA-compatible auth dict from extension cookies ──────
    # ZCA expects cookies as either array or {cookies: [...]} object.
    # Dùng array trực tiếp (chuẩn nhất cho zca-js hiện tại).
    auth = {
        "cookies": parsed_cookies,
        "imei": imei,
        "userAgent": user_agent,
        "zaloId": user_id,
        "ownerId": owner_id,
        "idMember": id_member,
        "source": "extension",
    }
    if resolved_proxy_url:
        auth["proxy_url"] = resolved_proxy_url

    # ── Delete any stale sessions and create a fresh confirmed one ───
    profile_lock = await get_profile_lock(user_id)
    async with profile_lock:
        await delete_sessions_for_user(user_id)

    session_id = _build_session_id(user_id)
    session = SessionData(
        session_id=session_id,
        user_id=user_id,
        browser=None,
        context=None,
        page=None,
        status="confirmed",
        qr_base64=None,
        qr_signature=None,
        zca_auth=auth,
        created_at=datetime.utcnow(),
        last_used=datetime.utcnow(),
    )
    await save_session(session)
    await save_zca_auth(user_id, auth)

    cookie_str = "; ".join(f"{c.get('key')}={c.get('value')}" for c in parsed_cookies if c.get("key") and c.get("value") is not None)
    await _remember_zalo_user(
        user_id,
        "confirmed",
        x_zalo_worker_id,
        cookie=cookie_str,
        owner_id=owner_id,
        id_member=id_member,
    )

    cookie_keys_str = ", ".join(sorted({c.get("key", "").strip().lower() for c in parsed_cookies})) or "(none)"
    logger.info(
        f"Imported extension session for user={user_id}, "
        f"session={session_id}, cookies={len(parsed_cookies)} keys=[{cookie_keys_str}]"
    )
    invalidate_zalo_accounts_cache()
    reset_listener_auth_expired(user_id)

    # ── Background: start persistent listener FIRST, then sync in background ───
    asyncio.create_task(_start_listener_and_first_sync(user_id, auth, source_label="Extension import"))

    return JSONResponse(
        content={
            "user_id": user_id,
            "session_id": session_id,
            "status": "confirmed",
            "source": "extension",
            "cookies_count": len(parsed_cookies),
            "cookies_keys": sorted({c.get("key", "").strip().lower() for c in parsed_cookies}),
            "imei": bool(body.get("imei")),
            "message": f"Imported {len(parsed_cookies)} cookies, keys=[{cookie_keys_str}]. Listener sẽ khởi động nền.",
        },
        headers={
            "Access-Control-Allow-Origin": "*",
        },
    )


@router.post("/delete-account-full")
async def delete_account_full(
    request: Request,
    x_user_id: str = Header("default", alias="X-User-ID"),
    caller_email: Optional[str] = Depends(get_authenticated_caller_email),
):
    """Xoá HOÀN TOÀN một tài khoản Zalo:
    * File auth local: ``artifacts/zca-auth/{user_id}.json``
    * Supabase: ``zalo_accounts``, ``zalo_sessions``, ``zalo_users``,
      ``zalo_groups``, ``zalo_messages`` (xoá theo user_id / account_id)
    * Dừng listener process
    * Xoá sessions in-memory

    Body JSON::
        {
            "account_id": "h-nguvbhj"      // bắt buộc
            "owner_id":   "owner@x.com"    // optional
        }
    """
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    raw_account_id = (body.get("account_id") or x_user_id or "").strip()
    if not raw_account_id:
        raise HTTPException(status_code=400, detail="Missing 'account_id'")
    account_id = _normalize_user_id(raw_account_id)
    owner_id = _normalize_user_id(body.get("owner_id") or x_user_id)

    # Truoc day khong check gi ca -> ai cung xoa sach duoc du lieu 1 tai khoan
    # Zalo bat ky (accounts/sessions/users/groups/messages) chi can biet
    # account_id. Gio bat buoc phai la admin/leader hoac chinh chu.
    target_account = await get_zalo_account_by_id(account_id)
    target_owner = (
        (target_account.get("id_member") or target_account.get("owner_id"))
        if target_account
        else None
    )
    await _require_admin_leader_or_self(caller_email, target_owner)

    result: Dict[str, Any] = {
        "account_id": account_id,
        "owner_id": owner_id,
        "auth_file_deleted": False,
        "listener_stopped": False,
        "supabase": {
            "zalo_accounts": 0,
            "zalo_sessions": 0,
            "zalo_users": 0,
            "zalo_groups": 0,
            "zalo_messages": 0,
        },
        "in_memory_sessions_cleared": 0,
    }

    # 1. Stop listener (nếu đang chạy)
    try:
        await stop_listener(account_id)
        result["listener_stopped"] = True
    except Exception as exc:
        result["listener_stop_error"] = str(exc)

    # 2. Xoá file auth local
    try:
        result["auth_file_deleted"] = bool(await delete_zca_auth(account_id))
    except Exception as exc:
        result["auth_file_error"] = str(exc)

    # 3. Xoá sessions in-memory của user
    try:
        result["in_memory_sessions_cleared"] = int(await delete_sessions_for_user(account_id))
    except Exception as exc:
        result["in_memory_sessions_error"] = str(exc)

    # 4. Xoá Supabase: zalo_accounts, zalo_sessions, zalo_users, zalo_groups, zalo_messages
    try:
        from app.modules.all_platform.zalo.services.supabase_service import (
            hard_delete_zalo_account_data,
        )
        deleted = await hard_delete_zalo_account_data(account_id)
        for k, v in deleted.items():
            if k in result["supabase"]:
                result["supabase"][k] = v
        if deleted.get("_errors", 0) > 0:
            result["supabase"]["_errors"] = deleted["_errors"]
    except Exception as exc:
        result["supabase_error"] = str(exc)

    logger.info(
        f"delete_account_full: account={account_id} owner={owner_id} "
        f"auth_file={result['auth_file_deleted']} listener={result['listener_stopped']} "
        f"db_deleted={result['supabase']}"
    )
    return {"success": True, "data": result}


@router.post("/cleanup-orphan-accounts")
async def cleanup_orphan_accounts(x_user_id: str = Header("default", alias="X-User-ID")):
    """Dọn các account Zalo trong Supabase mà KHÔNG có auth file local tương ứng.

    Mục đích: sau khi user xoá auth trên máy local, DB vẫn còn account rác.
    Endpoint này xoá các rows trong ``zalo_accounts`` mà file auth tương ứng không tồn tại.
    Cẩn thận: chỉ xoá các account KHÔNG có auth và KHÔNG có listener đang chạy.
    """
    from app.modules.all_platform.zalo.services.supabase_service import (
        _rest,
        hard_delete_zalo_account_data,
    )

    accounts_resp = await _rest(
        "GET",
        "zalo_accounts",
        params={"select": "account_id,owner_id,is_active", "is_active": "eq.true"},
    )
    items = []
    if isinstance(accounts_resp, list):
        items = accounts_resp
    elif isinstance(accounts_resp, dict):
        items = accounts_resp.get("data") or []

    deleted: List[Dict[str, Any]] = []
    kept: List[Dict[str, Any]] = []
    for acc in items:
        if not isinstance(acc, dict):
            continue
        aid = str(acc.get("account_id") or "").strip()
        if not aid:
            continue
        # Nếu có auth file local → keep
        auth_present = False
        try:
            auth_data = await load_zca_auth(aid)
            auth_present = bool(auth_data)
        except Exception:
            auth_present = False
        if auth_present:
            kept.append({"account_id": aid, "reason": "has_auth_file"})
            continue
        # Nếu listener đang chạy → keep
        try:
            st = get_listener_status(aid)
            if st.get("running") or st.get("connected"):
                kept.append({"account_id": aid, "reason": "listener_running"})
                continue
        except Exception:
            pass
        # Xoá tất cả dữ liệu liên quan (5 bảng)
        try:
            del_info = await hard_delete_zalo_account_data(aid)
            deleted.append({"account_id": aid, "reason": "no_auth_no_listener", "deleted": del_info})
        except Exception as exc:
            kept.append({"account_id": aid, "reason": f"delete_error: {exc}"})

    return {
        "success": True,
        "deleted": deleted,
        "deleted_count": len(deleted),
        "kept": kept,
        "kept_count": len(kept),
    }
