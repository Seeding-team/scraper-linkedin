"""Zalo auth routes — Zalo tập trung (port ZALO_CENTRALIZED_MODULE_GUIDE.md).

Đăng nhập CHỈ còn 1 luồng duy nhất: import cookie qua Chrome extension
(`POST /import-session`) — đã bỏ hẳn luồng QR/Playwright cũ (không còn
`/init`, `/qr/refresh`, `/manual-login/*`, `/qr-image/{id}`) theo đúng kiến
trúc `zalo-bridge` trong guide (Mục 3.6: cookie-based là luồng chính, QR chỉ
là dự phòng — guide gốc còn chưa build UI QR nên bỏ luôn ở đây).

`POST /reconnect` (force-restart listener khi bị Zalo kick "Overlimit
connection", Mục 3.3.1 guide) đã tồn tại sẵn ở
`accounts.py::POST /{account_id}/listener/restart` (gọi thẳng
`zca_persistent_listener.restart_listener`) — không thêm endpoint trùng ở
đây, tránh 2 chỗ cùng lộ 1 hành động.
"""

from typing import Any, Dict, List, Optional
import asyncio
import re
import uuid
from datetime import datetime
import time

import json

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.responses import Response, StreamingResponse, JSONResponse
from loguru import logger

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
    load_zca_auth,
    save_zca_auth,
)
from app.modules.all_platform.zalo.services.zca_persistent_listener import (
    get_listener_status,
    start_listener,
    stop_listener,
    reset_listener_auth_expired,
)
from app.modules.all_platform.auth_deps import get_authenticated_caller_email
from app.modules.all_platform.zalo.api.routes.accounts import _require_admin_leader_or_self
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
        await upsert_zalo_account(
            account_id=user_id,
            owner_id=resolved_owner_id,
            id_member=resolved_member_id,
            label=existing.get("label") or user_id,
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


def _serialize_login_state(user_id: str, session: Optional[SessionData], status: str) -> dict:
    return {
        "user_id": user_id,
        "session_id": session.session_id if session else None,
        "status": status,
        "is_logged_in": status == "confirmed",
        "can_crawl": status == "confirmed",
        "session_expired": status == "session_expired",
    }


async def _build_current_status_payload(user_id: str) -> dict:
    """Trạng thái đăng nhập — CHỈ dựa vào zca auth (cookie import qua extension).

    Không còn nhánh Playwright/session.page nào — session chỉ tồn tại để giữ
    zca_auth + status, không còn mở browser thật.
    """
    session = await get_latest_session_for_user(user_id)
    if not session:
        auth = await load_zca_auth(user_id)
        if not auth:
            return _serialize_login_state(user_id, None, "not_logged_in")
        session = SessionData(
            session_id=_build_session_id(user_id),
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
        logger.info(f"Restored confirmed ZCA session from auth store for user={user_id}")

    if not await ensure_session_zca_auth(session):
        return _serialize_login_state(user_id, session, "not_logged_in")

    # Cookie vẫn còn nhưng listener báo phiên Zalo đã hết hạn (bị kick/logout
    # thật) — KHÔNG xóa auth ngay, chỉ đánh dấu session_expired để FE hiện nút
    # đăng nhập lại qua extension. Auth sẽ bị ghi đè khi import cookie mới.
    listener = get_listener_status(user_id)
    if listener.get("auth_expired"):
        if session.status != "session_expired":
            logger.warning(
                f"ZCA session expired for user={user_id} — keeping auth file but marking "
                f"session_expired; user must re-import cookie via extension to refresh"
            )
            session.status = "session_expired"
            session.last_used = datetime.utcnow()
            await save_session(session)
        return _serialize_login_state(user_id, session, "session_expired")

    if session.status != "confirmed":
        session.status = "confirmed"
        session.qr_base64 = None
        session.qr_signature = None
        session.last_used = datetime.utcnow()
        await save_session(session)
    return _serialize_login_state(user_id, session, "confirmed")


@router.get("/current-status")
async def get_current_status(
    x_user_id: str = Header("default", alias="X-User-ID"),
):
    user_id = _normalize_user_id(x_user_id)
    return await _build_current_status_payload(user_id)


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
                # Dọn dẹp auth và build payload "session_expired" để push ngay về FE.
                try:
                    session = await get_latest_session_for_user(normalized_user_id)
                    if session:
                        session.status = "session_expired"
                        session.zca_auth = None
                        await save_session(session)
                    await delete_zca_auth(normalized_user_id)
                except Exception as cleanup_exc:
                    logger.warning(f"Could not cleanup expired auth for user={normalized_user_id}: {cleanup_exc}")

                payload = {
                    "session_id": session.session_id if session else None,
                    "status": "session_expired",
                    "is_logged_in": False,
                    "can_crawl": False,
                    "session_expired": True,
                    "message": expired_event[1] or "Phiên Zalo đã hết hạn. Vui lòng đăng nhập lại qua extension.",
                }
                yield f"event: auth-status\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"
                logger.info(f"Pushed session_expired to SSE for user={normalized_user_id}")
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

    if await ensure_session_zca_auth(session):
        if session.status != "confirmed":
            session.status = "confirmed"
            session.qr_base64 = None
            session.qr_signature = None
            await save_session(session)
        await _remember_zalo_user(_normalize_user_id(x_user_id), "confirmed", x_zalo_worker_id)
        return {"user_id": _normalize_user_id(x_user_id), "session_id": session_id, "status": "confirmed"}

    await _remember_zalo_user(_normalize_user_id(x_user_id), session.status, x_zalo_worker_id)
    return {"user_id": _normalize_user_id(x_user_id), "session_id": session_id, "status": session.status}


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
            db_accounts = await _rest(
                "GET",
                "zalo_accounts",
                params={
                    "select": "account_id,phone,status",
                    # PostgREST bắt buộc bọc điều kiện or trong ngoặc đơn —
                    # thiếu ngoặc sẽ bị hiểu nhầm thành cột "orowner_id" (400)
                    "or": f"(owner_id.eq.{user_id},id_member.eq.{user_id})",
                    "order": "created_at.desc",
                }
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
    imei = (body.get("imei") or "").strip()
    if not imei:
        existing_auth = await load_zca_auth(user_id)
        imei = (existing_auth or {}).get("imei") or ""
    if not imei:
        imei = str(uuid.uuid4())

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
    reset_listener_auth_expired(user_id)

    # ── Background: first-time sync then start persistent listener ───
    async def _background_extension_sync(uid: str, uauth: dict):
        import time as _time
        t0 = _time.time()
        try:
            logger.info(f"Extension import: [1/2] starting first-time sync for user={uid}...")
            from app.modules.all_platform.zalo.services.zca_api_bridge import first_time_sync
            # Giảm messages_per_chat 50→20 và group_limit default 25→8 để
            # tránh Zalo rate-limit (429) ngay sau khi login. Listener vẫn
            # đảm bảo nhận message realtime qua socket; first-time sync chỉ
            # là backfill messages gần đây.
            result = await first_time_sync(
                auth=uauth,
                zalo_account_id=uid,
                messages_per_chat=50,
                group_limit=8,
                include_friends=True,
            )
            dt = _time.time() - t0
            logger.info(
                f"Extension import: [1/2] first-time sync done for {uid} in {dt:.1f}s"
            )
            # ── Persist groups + friends + messages to Supabase ──
            await _persist_first_time_sync_result(uid, result)
        except Exception as sync_exc:
            dt = _time.time() - t0
            logger.warning(
                f"Extension import: [1/2] first-time sync FAILED for {uid} after {dt:.1f}s: {sync_exc}. "
                f"Tiếp tục start listener để user có thể retry."
            )
        finally:
            t1 = _time.time()
            try:
                logger.info(f"Extension import: [2/2] starting persistent listener for user={uid}...")
                await start_listener(uid, uauth, force_restart=True)
                dt = _time.time() - t1
                logger.info(
                    f"Extension import: [2/2] persistent listener started for user={uid} in {dt:.1f}s. "
                    f"Total time: {_time.time() - t0:.1f}s."
                )
            except Exception as start_exc:
                dt = _time.time() - t1
                logger.warning(
                    f"Extension import: [2/2] could not start listener for user={uid} after {dt:.1f}s: {start_exc}"
                )

    asyncio.create_task(_background_extension_sync(user_id, auth))

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
