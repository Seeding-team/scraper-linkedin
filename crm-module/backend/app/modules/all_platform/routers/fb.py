"""Facebook automation proxy with product-auth role gates.

The browser must never call the Markee automation service with the admin API
key. This router keeps that key server-side, validates the current product
user's scope, then forwards allowed calls to Markee.
"""

from __future__ import annotations

import os
import time
import asyncio
import copy
from typing import Any

import httpx
from fastapi import APIRouter, BackgroundTasks, Header, HTTPException, Request
from fastapi import APIRouter, BackgroundTasks, Header, HTTPException, Request
from fastapi.responses import JSONResponse, Response
from fastapi.concurrency import run_in_threadpool
from loguru import logger

from app.modules.all_platform.services import decode_token, get_team_members, get_user_by_id
from app.modules.all_platform.services.supabase_kpi_service import auto_count_fb_inbox_reply, mark_fb_inbox_lead
from app.core.supabase_client import get_supabase_client


router = APIRouter()

MARKEE_BASE_URL = (os.getenv("MARKEE_FB_BASE_URL") or "https://auto-fb.zenithglobal.dev").rstrip("/")
MARKEE_ADMIN_API_KEY = (os.getenv("MARKEE_FB_API_KEY") or "").strip()
MARKEE_EXTENSION_API_KEY = (os.getenv("MARKEE_FB_EXTENSION_API_KEY") or "").strip()
_TIMEOUT = httpx.Timeout(45.0, connect=10.0)
_RECENT_INBOX_SCAN: dict[str, float] = {}
_OWNED_USER_IDS_CACHE: dict[str, tuple[float, set[str]]] = {}
_OWNED_USER_IDS_CACHE_TTL = 60.0
_MARKEE_RESPONSE_CACHE: dict[str, tuple[float, int, Any]] = {}
_MARKEE_INFLIGHT: dict[str, asyncio.Task[tuple[int, Any]]] = {}
_MARKEE_CACHE_LIMIT = 1000
_THREAD_LOAD_RECENT: dict[str, tuple[float, dict[str, Any]]] = {}
_THREAD_LOAD_RECENT_TTL = 12.0


def _current_user(request: Request, authorization: str | None = None) -> dict[str, Any]:
    if not authorization:
        cookie_token = request.cookies.get("crawlpro_access_token")
        if cookie_token:
            authorization = f"Bearer {cookie_token}"

    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid authorization header")

    payload = decode_token(authorization[7:])
    if not payload or not payload.get("sub"):
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    try:
        user = get_user_by_id(str(payload["sub"]))
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Auth service temporarily unavailable") from exc
    if not user or not user.get("is_active", True):
        raise HTTPException(status_code=401, detail="User not found or inactive")
    return user


def _role(user: dict[str, Any]) -> str:
    return str(user.get("role") or "member").strip().lower()


def _allowed_owners(user: dict[str, Any]) -> set[str] | None:
    """Phạm vi tài khoản FB mỗi user được xem:
      - admin  -> None (xem HẾT)
      - leader -> chính mình + toàn bộ thành viên team mình quản lý
      - member -> CHỈ tài khoản của chính mình
    """
    user_id = str(user.get("id") or "")
    role = _role(user)
    if role == "admin":
        return None
    if role == "leader":
        ids = {user_id}
        try:
            for m in get_team_members(user_id) or []:
                mid = m.get("id")
                if mid:
                    ids.add(str(mid))
        except Exception:
            pass
        return ids
    return {user_id}


def _scope_query(user: dict[str, Any]) -> dict[str, str]:
    owners = _allowed_owners(user)
    if owners is None:
        return {}
    if len(owners) == 1:
        return {"owner": next(iter(owners))}
    return {"owners": ",".join(sorted(owners))}


def _auth_headers(*, json_body: bool = False, content_type: str | None = None) -> dict[str, str]:
    if not MARKEE_ADMIN_API_KEY:
        raise HTTPException(status_code=503, detail="MARKEE_FB_API_KEY is not configured on product backend")
    headers = {"X-API-Key": MARKEE_ADMIN_API_KEY}
    if json_body:
        headers["Content-Type"] = "application/json"
    if content_type:
        headers["Content-Type"] = content_type
    return headers


def _clear_markee_cache(*path_fragments: str) -> None:
    if not path_fragments:
        _MARKEE_RESPONSE_CACHE.clear()
        return
    for key in list(_MARKEE_RESPONSE_CACHE.keys()):
        if any(fragment in key for fragment in path_fragments):
            _MARKEE_RESPONSE_CACHE.pop(key, None)


async def _markee_json(
    method: str,
    path: str,
    *,
    params: dict[str, Any] | None = None,
    json_body: Any | None = None,
    cache_ttl: float = 0.0,
) -> tuple[int, Any]:
    cache_key = ""
    if cache_ttl > 0 and method.upper() == "GET" and json_body is None:
        param_key = tuple(sorted((str(k), str(v)) for k, v in (params or {}).items()))
        cache_key = repr((method.upper(), path, param_key))
        cached = _MARKEE_RESPONSE_CACHE.get(cache_key)
        now = time.monotonic()
        if cached and cached[0] > now:
            return cached[1], copy.deepcopy(cached[2])
        if cached:
            _MARKEE_RESPONSE_CACHE.pop(cache_key, None)
        inflight = _MARKEE_INFLIGHT.get(cache_key)
        if inflight and not inflight.done():
            status_code, payload = await inflight
            return status_code, copy.deepcopy(payload)

    async def _request() -> tuple[int, Any]:
        url = f"{MARKEE_BASE_URL}{path}"
        last_exc: httpx.HTTPError | None = None
        for attempt in range(3):
            async with httpx.AsyncClient(timeout=_TIMEOUT, follow_redirects=True) as client:
                try:
                    resp = await client.request(
                        method,
                        url,
                        params=params,
                        json=json_body,
                        headers=_auth_headers(json_body=json_body is not None),
                    )
                    break
                except httpx.HTTPError as exc:
                    last_exc = exc
                    if attempt >= 2:
                        raise HTTPException(status_code=502, detail=f"Markee service unavailable: {exc}") from exc
                    await asyncio.sleep(0.2 * (attempt + 1))
        else:
            raise HTTPException(status_code=502, detail=f"Markee service unavailable: {last_exc}")
        try:
            payload = resp.json()
        except ValueError:
            payload = {"detail": resp.text}
        return resp.status_code, payload

    if cache_key:
        task = _MARKEE_INFLIGHT.get(cache_key)
        owner = False
        if not task or task.done():
            task = asyncio.create_task(_request())
            _MARKEE_INFLIGHT[cache_key] = task
            owner = True
        try:
            status_code, payload = await task
        finally:
            if owner:
                _MARKEE_INFLIGHT.pop(cache_key, None)
        if status_code < 500:
            _MARKEE_RESPONSE_CACHE[cache_key] = (
                time.monotonic() + cache_ttl,
                status_code,
                copy.deepcopy(payload),
            )
            if len(_MARKEE_RESPONSE_CACHE) > _MARKEE_CACHE_LIMIT:
                for old_key in list(_MARKEE_RESPONSE_CACHE.keys())[:-_MARKEE_CACHE_LIMIT]:
                    _MARKEE_RESPONSE_CACHE.pop(old_key, None)
        return status_code, copy.deepcopy(payload)

    return await _request()

def _json_response(status_code: int, payload: Any) -> JSONResponse:
    return JSONResponse(status_code=status_code, content=payload)


async def _owned_user_ids(user: dict[str, Any]) -> set[str] | None:
    """Known FB account ids in the caller's allowed owner scope.

    Admin returns None because every account is allowed.
    """
    if _allowed_owners(user) is None:
        return None

    params = _scope_query(user)
    cache_key = f"{user.get('id') or ''}:{'&'.join(f'{k}={v}' for k, v in sorted(params.items()))}"
    cached = _OWNED_USER_IDS_CACHE.get(cache_key)
    now = time.monotonic()
    if cached and cached[0] > now:
        return set(cached[1])

    ids: set[str] = set()
    for path, key in (("/sessions", "sessions"), ("/extensions", "extensions")):
        status, payload = await _markee_json(
            "GET",
            path,
            params=params,
            cache_ttl=5.0 if path == "/sessions" else 10.0,
        )
        if status >= 400:
            continue
        for item in payload.get(key, []) if isinstance(payload, dict) else []:
            uid = item.get("user_id")
            if uid:
                ids.add(str(uid))
    _OWNED_USER_IDS_CACHE[cache_key] = (now + _OWNED_USER_IDS_CACHE_TTL, set(ids))
    if len(_OWNED_USER_IDS_CACHE) > 500:
        for old_key in list(_OWNED_USER_IDS_CACHE.keys())[:-500]:
            _OWNED_USER_IDS_CACHE.pop(old_key, None)
    return ids


async def _require_fb_account_scope(user: dict[str, Any], user_id: str) -> None:
    if not user_id:
        raise HTTPException(status_code=400, detail="Missing user_id")
    allowed = await _owned_user_ids(user)
    if allowed is not None and user_id not in allowed:
        raise HTTPException(status_code=403, detail="Facebook account is outside your team scope")


async def _require_fb_accounts_scope(user: dict[str, Any], user_ids: list[str]) -> None:
    allowed = await _owned_user_ids(user)
    if allowed is None:
        return
    outside = [uid for uid in user_ids if uid and uid not in allowed]
    if outside:
        raise HTTPException(status_code=403, detail="One or more Facebook accounts are outside your team scope")


@router.get("/config")
async def fb_config(request: Request, authorization: str | None = Header(None)) -> dict[str, Any]:
    """Config safe for extension provisioning.

    This intentionally does not expose MARKEE_FB_API_KEY. In production set
    MARKEE_FB_EXTENSION_API_KEY to a limited key accepted only by extension
    endpoints on Markee.
    """
    user = _current_user(request, authorization)
    return {
        "success": True,
        "serverUrl": MARKEE_BASE_URL,
        "extensionApiKey": MARKEE_EXTENSION_API_KEY,
        "extensionKeyConfigured": bool(MARKEE_EXTENSION_API_KEY),
        "owner": user.get("id"),
    }


@router.get("/health")
async def fb_health(request: Request, authorization: str | None = Header(None)) -> JSONResponse:
    _current_user(request, authorization)
    status, payload = await _markee_json("GET", "/health", cache_ttl=5.0)
    return _json_response(status, payload)


@router.get("/sessions")
async def fb_sessions(request: Request, authorization: str | None = Header(None)) -> JSONResponse:
    user = _current_user(request, authorization)
    status, payload = await _markee_json("GET", "/sessions", params=_scope_query(user), cache_ttl=5.0)
    return _json_response(status, payload)


@router.get("/session/owner/{user_id}")
async def fb_session_owner(user_id: str, request: Request, authorization: str | None = Header(None)) -> JSONResponse:
    user = _current_user(request, authorization)
    await _require_fb_account_scope(user, user_id)
    status, payload = await _markee_json("GET", f"/session/owner/{user_id}")
    return _json_response(status, payload)


@router.get("/extensions")
async def fb_extensions(request: Request, authorization: str | None = Header(None)) -> JSONResponse:
    user = _current_user(request, authorization)
    status, payload = await _markee_json("GET", "/extensions", params=_scope_query(user), cache_ttl=10.0)
    return _json_response(status, payload)


@router.get("/groups")
async def fb_groups(request: Request, authorization: str | None = Header(None)) -> JSONResponse:
    _current_user(request, authorization)
    status, payload = await _markee_json("GET", "/groups")
    return _json_response(status, payload)


@router.get("/account-groups")
async def fb_account_groups(request: Request, authorization: str | None = Header(None)) -> JSONResponse:
    user = _current_user(request, authorization)
    uid = str(request.query_params.get("user_id") or "")
    await _require_fb_account_scope(user, uid)
    params = dict(request.query_params)
    status, payload = await _markee_json("GET", "/account-groups", params=params, cache_ttl=3.0)
    return _json_response(status, payload)


@router.get("/account-groups/summary")
async def fb_account_groups_summary(request: Request, authorization: str | None = Header(None)) -> JSONResponse:
    user = _current_user(request, authorization)
    user_ids = [
        uid.strip()
        for uid in str(request.query_params.get("user_ids") or "").split(",")
        if uid.strip()
    ]
    await _require_fb_accounts_scope(user, user_ids)
    params = dict(request.query_params)
    status, payload = await _markee_json("GET", "/account-groups/summary", params=params, cache_ttl=3.0)
    return _json_response(status, payload)


@router.post("/account-groups/scan")
async def fb_account_groups_scan(data: dict, request: Request, authorization: str | None = Header(None)) -> JSONResponse:
    user = _current_user(request, authorization)
    uid = str(data.get("user_id") or "")
    await _require_fb_account_scope(user, uid)
    status, payload = await _markee_json("POST", "/account-groups/scan", json_body=data)
    _clear_markee_cache("/account-groups")
    return _json_response(status, payload)


@router.post("/account-groups/sync")
async def fb_account_groups_sync(data: dict, request: Request, authorization: str | None = Header(None)) -> JSONResponse:
    user = _current_user(request, authorization)
    uid = str(data.get("user_id") or "")
    await _require_fb_account_scope(user, uid)
    status, payload = await _markee_json("POST", "/account-groups/sync", json_body=data)
    _clear_markee_cache("/account-groups")
    return _json_response(status, payload)


@router.delete("/account-groups")
async def fb_account_group_delete(request: Request, authorization: str | None = Header(None)) -> JSONResponse:
    user = _current_user(request, authorization)
    uid = str(request.query_params.get("user_id") or "")
    await _require_fb_account_scope(user, uid)
    params = dict(request.query_params)
    status, payload = await _markee_json("DELETE", "/account-groups", params=params)
    _clear_markee_cache("/account-groups")
    return _json_response(status, payload)


@router.get("/jobs")
async def fb_jobs(request: Request, authorization: str | None = Header(None)) -> JSONResponse:
    user = _current_user(request, authorization)
    status, payload = await _markee_json("GET", "/jobs")
    if status < 400 and isinstance(payload, dict) and _allowed_owners(user) is not None:
        allowed = await _owned_user_ids(user) or set()
        payload["jobs"] = [j for j in payload.get("jobs", []) if j.get("user_id") in allowed]
    return _json_response(status, payload)


@router.get("/jobs/{job_id}")
async def fb_job_status(job_id: str, request: Request, authorization: str | None = Header(None)) -> JSONResponse:
    user = _current_user(request, authorization)
    status, payload = await _markee_json("GET", f"/jobs/{job_id}")
    if status < 400 and isinstance(payload, dict):
        await _require_fb_account_scope(user, str(payload.get("user_id") or ""))
    return _json_response(status, payload)


@router.post("/upload")
async def fb_upload(request: Request, authorization: str | None = Header(None)) -> Response:
    _current_user(request, authorization)
    body = await request.body()
    content_type = request.headers.get("content-type")
    async with httpx.AsyncClient(timeout=_TIMEOUT, follow_redirects=True) as client:
        try:
            resp = await client.post(
                f"{MARKEE_BASE_URL}/upload",
                content=body,
                headers=_auth_headers(content_type=content_type),
            )
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=502, detail=f"Markee service unavailable: {exc}") from exc
    return Response(content=resp.content, status_code=resp.status_code, media_type=resp.headers.get("content-type"))


@router.post("/post")
async def fb_post(data: dict, request: Request, authorization: str | None = Header(None)) -> JSONResponse:
    user = _current_user(request, authorization)
    uid = str(data.get("user_id") or "")
    await _require_fb_account_scope(user, uid)
    status, payload = await _markee_json("POST", "/post", json_body=data)
    return _json_response(status, payload)


@router.post("/extensions/{user_id}/label")
async def fb_extension_label(user_id: str, data: dict, request: Request, authorization: str | None = Header(None)) -> JSONResponse:
    user = _current_user(request, authorization)
    await _require_fb_account_scope(user, user_id)
    status, payload = await _markee_json("POST", f"/extensions/{user_id}/label", json_body=data)
    _clear_markee_cache("/extensions", "/sessions")
    return _json_response(status, payload)


@router.delete("/session/cookie/{user_id}")
async def fb_delete_session(user_id: str, request: Request, authorization: str | None = Header(None)) -> JSONResponse:
    user = _current_user(request, authorization)
    await _require_fb_account_scope(user, user_id)
    status, payload = await _markee_json("DELETE", f"/session/cookie/{user_id}")
    _clear_markee_cache("/sessions", "/extensions", "/inbox/conversations", "/inbox/thread")
    return _json_response(status, payload)


@router.delete("/accounts/{user_id}/full")
async def fb_delete_account_full(user_id: str, request: Request, authorization: str | None = Header(None)) -> JSONResponse:
    """Xoá HOÀN TOÀN 1 tài khoản FB: file cookie session trên VPS service +
    toàn bộ dòng liên quan trong Supabase (fb_inbox_accounts, fb_post_kpi,
    fb_inbox_kpi) - tránh tình trạng chỉ xoá cookie mà dữ liệu KPI/đăng ký
    account vẫn còn rác trong DB (hoặc ngược lại)."""
    user = _current_user(request, authorization)
    await _require_fb_account_scope(user, user_id)

    result: dict[str, object] = {"user_id": user_id, "cookie_deleted": False, "db": {}}

    try:
        status, _payload = await _markee_json("DELETE", f"/session/cookie/{user_id}")
        result["cookie_deleted"] = status < 400
    except Exception as exc:
        result["cookie_error"] = str(exc)

    supabase = get_supabase_client()
    for table in ("fb_inbox_accounts", "fb_post_kpi", "fb_inbox_kpi"):
        try:
            res = supabase.table(table).delete().eq("user_id", user_id).execute()
            result["db"][table] = len(res.data or [])
        except Exception as exc:
            result["db"][f"{table}_error"] = str(exc)

    _clear_markee_cache("/sessions", "/extensions", "/inbox/conversations", "/inbox/thread")
    return _json_response(200, result)


@router.post("/session/meta")
async def fb_session_meta(data: dict, request: Request, authorization: str | None = Header(None)) -> JSONResponse:
    user = _current_user(request, authorization)
    uid = str(data.get("user_id") or "")
    await _require_fb_account_scope(user, uid)
    status, payload = await _markee_json("POST", "/session/meta", json_body=data)
    _clear_markee_cache("/sessions", "/extensions")
    return _json_response(status, payload)



# Cac cum tu quen thuoc cua tin phishing/spam tu dong tren Messenger (gia mao
# canh bao "mat tai khoan", "thieu tin nhan"...) - danh sach thu cong, chi
# chan duoc mau da biet, khong bat duoc spam kieu moi. Cap nhat khi thay mau
# spam moi lap lai nhieu lan trong inbox thuc te.
_SPAM_PREVIEW_PATTERNS = (
    "thiếu tin nhắn",
    "khôi phục ngay",
    "tài khoản của bạn sẽ bị",
    "tài khoản của bạn đã bị",
    "xác minh tài khoản",
    "vi phạm tiêu chuẩn cộng đồng",
    "vi phạm điều khoản",
)


def _looks_like_spam_preview(preview: Any) -> bool:
    p = str(preview or "").strip().lower()
    if not p:
        return False
    return any(pat in p for pat in _SPAM_PREVIEW_PATTERNS)


@router.get("/inbox/conversations")
async def fb_inbox_conversations(
    request: Request,
    background_tasks: BackgroundTasks,
    authorization: str | None = Header(None),
) -> JSONResponse:
    user = _current_user(request, authorization)
    uid = str(request.query_params.get("user_id") or "")
    await _require_fb_account_scope(user, uid)
    params = dict(request.query_params)
    status, payload = await _markee_json("GET", "/inbox/conversations", params=params, cache_ttl=3.0)
    # Tinh KPI Inbox tu dong ngay khi TAI DANH SACH hoi thoai - khong can nguoi
    # dung mo tung cai (theo yeu cau: "load ds ve la tinh luon, khong can mo").
    # Loc bot hoi thoai co preview khop mau spam/phishing quen thuoc de tranh
    # tinh rac (xem _SPAM_PREVIEW_PATTERNS) - khong loc theo is_customer vi
    # hoi thoai moi/chua gan nhan van can duoc tinh. idempotent theo conv_id
    # (khoa 30 ngay trong auto_count_fb_inbox_reply) nen goi lai moi lan load
    # la an toan.
    if status < 400 and uid and isinstance(payload, dict):
        conv_ids = {
            str(c.get("conv_id"))
            for c in (payload.get("conversations") or [])
            if isinstance(c, dict) and c.get("conv_id") and not _looks_like_spam_preview(c.get("preview"))
        }
        for conv_id in list(conv_ids)[:200]:
            background_tasks.add_task(auto_count_fb_inbox_reply, uid, conv_id)
    return _json_response(status, payload)


@router.post("/inbox/scan")
async def fb_inbox_scan(data: dict, request: Request, authorization: str | None = Header(None)) -> JSONResponse:
    user = _current_user(request, authorization)
    uid = str(data.get("user_id") or "")
    await _require_fb_account_scope(user, uid)
    now = time.monotonic()
    last = _RECENT_INBOX_SCAN.get(uid, 0.0)
    if now - last < 25.0:
        return _json_response(200, {"success": True, "user_id": uid, "scanning": True, "throttled": True})
    _RECENT_INBOX_SCAN[uid] = now
    if len(_RECENT_INBOX_SCAN) > 500:
        for key in list(_RECENT_INBOX_SCAN.keys())[:-500]:
            _RECENT_INBOX_SCAN.pop(key, None)
    status, payload = await _markee_json("POST", "/inbox/scan", json_body=data)
    _clear_markee_cache("/inbox/conversations")
    return _json_response(status, payload)


@router.post("/inbox/scan_deep")
async def fb_inbox_scan_deep(data: dict, request: Request, authorization: str | None = Header(None)) -> JSONResponse:
    user = _current_user(request, authorization)
    uid = str(data.get("user_id") or "")
    await _require_fb_account_scope(user, uid)
    status, payload = await _markee_json("POST", "/inbox/scan_deep", json_body=data)
    _clear_markee_cache("/inbox/conversations", "/inbox/thread")
    return _json_response(status, payload)


@router.post("/inbox/mark")
async def fb_inbox_mark(data: dict, request: Request, authorization: str | None = Header(None)) -> JSONResponse:
    user = _current_user(request, authorization)
    uid = str(data.get("user_id") or "")
    await _require_fb_account_scope(user, uid)
    data = {
        **data,
        "actor_id": user.get("id") or "",
        "actor_name": user.get("name") or user.get("email") or user.get("id") or "",
    }
    status, payload = await _markee_json("POST", "/inbox/mark", json_body=data)
    _clear_markee_cache("/inbox/conversations", "/inbox/thread", "/inbox/archive")
    return _json_response(status, payload)


@router.get("/inbox/archive")
async def fb_inbox_archive_list(request: Request, authorization: str | None = Header(None)) -> JSONResponse:
    user = _current_user(request, authorization)
    uid = str(request.query_params.get("user_id") or "")
    await _require_fb_account_scope(user, uid)
    params = dict(request.query_params)
    status, payload = await _markee_json("GET", "/inbox/archive", params=params)
    return _json_response(status, payload)


@router.post("/inbox/archive")
async def fb_inbox_archive_save(data: dict, request: Request, authorization: str | None = Header(None)) -> JSONResponse:
    user = _current_user(request, authorization)
    uid = str(data.get("user_id") or "")
    await _require_fb_account_scope(user, uid)
    data = {
        **data,
        "actor_id": user.get("id") or "",
        "actor_name": user.get("name") or user.get("email") or user.get("id") or "",
    }
    status, payload = await _markee_json("POST", "/inbox/archive", json_body=data)
    _clear_markee_cache("/inbox/conversations", "/inbox/archive", "/inbox/thread")
    return _json_response(status, payload)


@router.get("/inbox/archive/thread")
async def fb_inbox_archive_thread_get(request: Request, authorization: str | None = Header(None)) -> JSONResponse:
    user = _current_user(request, authorization)
    uid = str(request.query_params.get("user_id") or "")
    await _require_fb_account_scope(user, uid)
    params = dict(request.query_params)
    status, payload = await _markee_json("GET", "/inbox/archive/thread", params=params)
    return _json_response(status, payload)


@router.post("/inbox/thread")
async def fb_inbox_thread_load(
    data: dict,
    request: Request,
    background_tasks: BackgroundTasks,
    authorization: str | None = Header(None),
) -> JSONResponse:
    user = _current_user(request, authorization)
    uid = str(data.get("user_id") or "")
    conv_id = str(data.get("conv_id") or "")
    await _require_fb_account_scope(user, uid)
    # Hoi thoai duoc tai (mo xem / quet ve) -> tinh KPI Inbox tu dong, khong can
    # nhan vien phai tra loi hay bam "La khach". auto_count_fb_inbox_reply tu no
    # da idempotent theo conv_id (khoa 30 ngay) nen goi lai nhieu lan la an toan.
    if uid and conv_id:
        background_tasks.add_task(auto_count_fb_inbox_reply, uid, conv_id)
    recent_key = f"{uid}:{conv_id}"
    now = time.monotonic()
    cached = _THREAD_LOAD_RECENT.get(recent_key)
    if cached and cached[0] > now:
        payload = dict(cached[1])
        payload["deduped"] = True
        return _json_response(200, payload)
    if cached:
        _THREAD_LOAD_RECENT.pop(recent_key, None)
    status, payload = await _markee_json("POST", "/inbox/thread", json_body=data)
    if status < 500 and isinstance(payload, dict):
        _THREAD_LOAD_RECENT[recent_key] = (time.monotonic() + _THREAD_LOAD_RECENT_TTL, dict(payload))
        if len(_THREAD_LOAD_RECENT) > 1000:
            for key in list(_THREAD_LOAD_RECENT.keys())[:-1000]:
                _THREAD_LOAD_RECENT.pop(key, None)
    _clear_markee_cache("/inbox/conversations", "/inbox/thread")
    return _json_response(status, payload)


@router.get("/inbox/thread")
async def fb_inbox_thread_get(request: Request, authorization: str | None = Header(None)) -> JSONResponse:
    # KHONG tu tinh KPI o day - endpoint nay con duoc goi ngam de preload/cache
    # preview cho CA danh sach hoi thoai (kha nang tinh nham nhung hoi thoai
    # nguoi dung chua he mo xem), va gay ngap threadpool khi list dai. Auto-count
    # chi gan o POST /inbox/thread ben duoi, noi chi chay khi thuc su mo/tai 1
    # hoi thoai cu the (openChat o frontend).
    user = _current_user(request, authorization)
    uid = str(request.query_params.get("user_id") or "")
    await _require_fb_account_scope(user, uid)
    params = dict(request.query_params)
    status, payload = await _markee_json("GET", "/inbox/thread", params=params, cache_ttl=2.0)
    return _json_response(status, payload)


@router.post("/inbox/reply")
async def fb_inbox_reply(
    data: dict,
    request: Request,
    background_tasks: BackgroundTasks,
    authorization: str | None = Header(None),
) -> JSONResponse:
    user = _current_user(request, authorization)
    uid = str(data.get("user_id") or "")
    conv_id = str(data.get("conv_id") or "")
    await _require_fb_account_scope(user, uid)
    status, payload = await _markee_json("POST", "/inbox/reply", json_body=data)
    _clear_markee_cache("/inbox/conversations", "/inbox/thread", "/inbox/reply_status")
    # Nhân viên đã nhắn cho khách qua nút Trả lời trong tool → tự động tính +1
    # KPI inbox cho hội thoại này (không cần leader xác nhận thủ công). Chạy nền
    # để không làm chậm phản hồi gửi tin; idempotent theo conv_id (30-day lock
    # trong auto_count_fb_inbox_reply). Tính năng này từng bị merge "khôi phục
    # code cũ" (nhánh library, 2026-07-09) vô tình xoá mất — xem CLAUDE.md.
    if status < 400 and uid and conv_id:
        background_tasks.add_task(auto_count_fb_inbox_reply, uid, conv_id)
    return _json_response(status, payload)


@router.post("/inbox/mark-opened")
async def fb_inbox_mark_opened(
    data: dict,
    request: Request,
    background_tasks: BackgroundTasks,
    authorization: str | None = Header(None),
) -> JSONResponse:
    """FE gọi mỗi khi người dùng MỞ 1 hội thoại (openChat), không phụ thuộc việc
    hội thoại đó có cần tải lại từ Markee hay không (khac voi /inbox/thread -
    cai do co the bi skip vi da co cache/da doc, khien auto-count bi bo lo dù
    user vừa thực sự bấm mở). Idempotent theo conv_id (khoa 30 ngay trong
    auto_count_fb_inbox_reply) nen goi lai nhieu lan la an toan."""
    user = _current_user(request, authorization)
    uid = str(data.get("user_id") or "")
    conv_id = str(data.get("conv_id") or "")
    await _require_fb_account_scope(user, uid)
    if uid and conv_id:
        background_tasks.add_task(auto_count_fb_inbox_reply, uid, conv_id)
    return _json_response(200, {"success": True})


@router.post("/inbox/reply-detected")
async def fb_inbox_reply_detected(data: dict) -> JSONResponse:
    """Nội bộ: service gọi khi quét Inbox phát hiện nhân viên đã trả lời khách
    TRỰC TIẾP trên Facebook (không qua nút Trả lời trong tool). Cho phép tính KPI
    cả 2 đường (qua tool + trả lời thẳng trên FB), không yêu cầu user token vì đây
    là gọi server-to-server (giống pattern /fb/post-kpi/save).

    QUAN TRỌNG: chạy ĐỒNG BỘ (không dùng BackgroundTasks) và trả về đúng kết quả
    thật (success=False nếu ghi Supabase lỗi, vd mất kết nối tạm thời) — để
    service biết CHẮC là đã ghi được rồi mới đánh dấu kpi_notified, tránh mất
    KPI vĩnh viễn khi Supabase disconnect thoáng qua (service sẽ tự thử lại ở
    lần quét sau nếu response này báo fail)."""
    uid = str(data.get("user_id") or "")
    conv_id = str(data.get("conv_id") or "")
    if not uid or not conv_id:
        return _json_response(200, {"success": False, "message": "Thiếu user_id/conv_id"})
    try:
        result = await run_in_threadpool(auto_count_fb_inbox_reply, uid, conv_id, True)
        return _json_response(200, {"success": True, "data": result})
    except Exception as e:
        logger.warning(f"auto_count_fb_inbox_reply (reply-detected) that bai user_id={uid} conv_id={conv_id}: {e}")
        return _json_response(200, {"success": False, "message": str(e)})


@router.post("/inbox/mark-lead")
async def fb_inbox_mark_lead(data: dict) -> JSONResponse:
    """Nội bộ: service gọi khi nhân viên bấm "Đánh dấu là khách" trong tab Inbox
    (field=is_customer, value=true). Set is_lead=True cho hội thoại đó trong
    fb_inbox_kpi — nếu chưa có dòng KPI (chưa từng tính reply) thì tạo mới luôn.
    Không yêu cầu user token, gọi server-to-server giống /fb/post-kpi/save.
    Chạy đồng bộ, trả kết quả thật (không dùng BackgroundTasks) — cùng lý do với
    /inbox/reply-detected, tránh mất lead khi Supabase disconnect thoáng qua."""
    uid = str(data.get("user_id") or "")
    conv_id = str(data.get("conv_id") or "")
    if not uid or not conv_id:
        return _json_response(200, {"success": False, "message": "Thiếu user_id/conv_id"})
    try:
        result = await run_in_threadpool(mark_fb_inbox_lead, uid, conv_id, True)
        return _json_response(200, {"success": True, "data": result})
    except Exception as e:
        logger.warning(f"mark_fb_inbox_lead that bai user_id={uid} conv_id={conv_id}: {e}")
        return _json_response(200, {"success": False, "message": str(e)})


@router.get("/inbox/reply_status")
async def fb_inbox_reply_status(request: Request, authorization: str | None = Header(None)) -> JSONResponse:
    user = _current_user(request, authorization)
    uid = str(request.query_params.get("user_id") or "")
    if uid:
        await _require_fb_account_scope(user, uid)
    params = dict(request.query_params)
    status, payload = await _markee_json("GET", "/inbox/reply_status", params=params)
    return _json_response(status, payload)
