"""Đăng nhập Zalo qua Chrome Extension (cookie chat.zalo.me) — bản rút gọn cho
zalo-module, chỉ giữ luồng hiện đại (Extension + zca-js). Bản gốc
(`linkedin_group_crawler/.../zalo/api/routes/auth.py`) còn có thêm luồng QR
code + đăng nhập thủ công qua trình duyệt Playwright (`/init`, `/qr/refresh`,
`/manual-login/*`, `/qr-image/{id}`, `/status/{id}`, `/current-status`,
`/events` SSE, `/session/{id}` DELETE, `/sessions` DELETE) — KHÔNG copy sang
đây vì zalo-module không có Playwright (xem
docs/ZALO_CHAT_FEATURE_EXTRACTION_GUIDE.md mục 2.1)."""

from typing import Any, Dict, List, Optional
import asyncio
import json
import re
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import Response, JSONResponse
from loguru import logger

from app.modules.all_platform.zalo.schemas.session import SessionData
from app.modules.all_platform.zalo.schemas.message import Message
from app.modules.all_platform.zalo.services.session_store import (
    delete_sessions_for_user,
    get_profile_lock,
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
from app.modules.all_platform.zalo.services.zca_auth_store import (
    delete_zca_auth,
    load_zca_auth,
    save_zca_auth,
)
from app.modules.all_platform.zalo.services.zca_persistent_listener import (
    start_listener,
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
    # id_member là cột UUID (app_users.id) ở cả zalo_module_users lẫn zalo_module_accounts —
    # extension gửi email nên phải resolve về UUID thật (hoặc bỏ qua), tránh 22P02.
    # owner_id của zalo_module_accounts là cột TEXT (giữ nguyên email normalize để
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
        all_chats = list(result.get("groups") or []) + list(result.get("friends") or [])
        if all_chats:
            await upsert_groups(user_id, all_chats)
            logger.info(
                f"Persisted {len(all_chats)} groups/friends for user={user_id}"
            )
    except Exception as exc:
        logger.warning(f"Could not persist groups/friends for user={user_id}: {exc}")

    try:
        raw_messages = result.get("messages") or []
        if raw_messages:
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

    The extension captures cookies from ``chat.zalo.me`` after the user has
    already logged in there in their own real browser. Those cookies are sent
    here so the backend can create a confirmed ``SessionData`` and start the
    ZCA persistent listener.

    Expected JSON body::

        {
            "user_id": "agent-zalo-1",   // optional, falls back to X-User-ID header
            "cookies": [
                {"key": "zppsid",  "value": "...", "domain": "chat.zalo.me", ...},
                ...
            ],
            "imei":         "optional — zca-js requires a truthy IMEI (auto-generated if missing)",
            "user_agent":   "Mozilla/5.0 ...",
            "owner_id":     "optional — defaults to X-User-ID"
        }
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

    # Nếu user_id không bắt đầu bằng "zl_" (ví dụ là email), tự động tìm kiếm
    # zalo_account tương ứng — chặn ngay từ đầu nếu không resolve được, thay vì
    # âm thầm tạo 1 "account" ảo keyed bằng email (mất RBAC/ownership).
    if not user_id.startswith("zl_"):
        resolved_account_id: Optional[str] = None
        try:
            from app.modules.all_platform.zalo.services.supabase_service import _rest
            db_accounts = await _rest(
                "GET",
                "zalo_module_accounts",
                params={
                    "select": "account_id,phone,status",
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
    #   2. JSON string of list
    #   3. JSON string of object (e.g. '{"cookies":[{...}]}')
    #   4. Plain "k=v; k=v" string (legacy, not recommended)
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
            logger.warning(
                f"import-session: received legacy 'k=v; k=v' cookie string format for user={user_id}. "
                "This format is deprecated and lacks httpOnly/secure/domain metadata."
            )
            for part in stripped.split(";"):
                part = part.strip()
                if "=" in part:
                    k, v = part.split("=", 1)
                    parsed_cookies.append({
                        "key": k.strip(),
                        "value": v.strip(),
                        "domain": ".zalo.me",
                        "path": "/",
                        "httpOnly": True,
                        "secure": True,
                    })

    if not parsed_cookies:
        raise HTTPException(
            status_code=400,
            detail="Could not parse any cookies. Expected Chrome-cookie array (key/value/domain) or 'k=v; k=v' string.",
        )

    # ── Validate user_agent (phải là Chrome thật, không dùng default) ─
    user_agent = (body.get("user_agent") or "").strip()
    if not user_agent or "Mozilla" not in user_agent:
        raise HTTPException(
            status_code=400,
            detail="user_agent bắt buộc và phải là Chrome thật (có 'Mozilla'). Hãy gửi navigator.userAgent của trình duyệt.",
        )

    # ── IMEI: PHẢI ổn định qua nhiều lần import cho cùng 1 account ────
    imei = (body.get("imei") or "").strip()
    if not imei:
        existing_auth = await load_zca_auth(user_id)
        imei = (existing_auth or {}).get("imei") or ""
    if not imei:
        imei = str(uuid.uuid4())

    auth = {
        "cookies": parsed_cookies,
        "imei": imei,
        "userAgent": user_agent,
        "zaloId": user_id,
        "ownerId": owner_id,
        "idMember": id_member,
        "source": "extension",
    }

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
    """Xoá HOÀN TOÀN một tài khoản Zalo (file auth local + toàn bộ bảng
    `zalo_module_*` liên quan + dừng listener + xoá session in-memory).

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
            "zalo_module_accounts": 0,
            "zalo_module_groups": 0,
            "zalo_module_messages": 0,
        },
        "in_memory_sessions_cleared": 0,
    }

    try:
        from app.modules.all_platform.zalo.services.zca_persistent_listener import (
            stop_listener as _stop_listener,
        )
        await _stop_listener(account_id)
        result["listener_stopped"] = True
    except Exception as exc:
        result["listener_stop_error"] = str(exc)

    try:
        result["auth_file_deleted"] = bool(await delete_zca_auth(account_id))
    except Exception as exc:
        result["auth_file_error"] = str(exc)

    try:
        result["in_memory_sessions_cleared"] = int(await delete_sessions_for_user(account_id))
    except Exception as exc:
        result["in_memory_sessions_error"] = str(exc)

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
    """Dọn các account Zalo trong Supabase mà KHÔNG có auth file local tương ứng."""
    from app.modules.all_platform.zalo.services.zca_persistent_listener import (
        get_listener_status,
    )
    from app.modules.all_platform.zalo.services.supabase_service import (
        _rest,
        hard_delete_zalo_account_data,
    )

    accounts_resp = await _rest(
        "GET",
        "zalo_module_accounts",
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
        auth_present = False
        try:
            auth_data = await load_zca_auth(aid)
            auth_present = bool(auth_data)
        except Exception:
            auth_present = False
        if auth_present:
            kept.append({"account_id": aid, "reason": "has_auth_file"})
            continue
        try:
            st = get_listener_status(aid)
            if st.get("running") or st.get("connected"):
                kept.append({"account_id": aid, "reason": "listener_running"})
                continue
        except Exception:
            pass
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
