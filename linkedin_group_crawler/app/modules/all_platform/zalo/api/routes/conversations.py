import asyncio
import json
import os
import posixpath
import tempfile
import shutil
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple
import re
from loguru import logger

from fastapi import APIRouter, Depends, Header, HTTPException, Query, UploadFile, File, Form, BackgroundTasks, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field

from app.modules.all_platform.auth_deps import get_authenticated_caller_email, get_authenticated_caller_user
from app.modules.all_platform.zalo.api.security import verify_zalo_api_key
from app.modules.all_platform.zalo.schemas.library import (
    ZaloConversationListResponse,
    ZaloConversationSummary,
    ZaloLibraryListResponse,
    ZaloLibraryMessage,
)
from app.modules.all_platform.zalo.schemas.message import Message, Mention
from app.modules.all_platform.zalo.services.supabase_service import (
    SupabaseNotConfigured,
    _normalize_raw_content,
    _rest,
    build_zalo_sticker_cdn_url,
    classify_message_kind,
    fetch_bankcard_preview,
    format_sidebar_last_message_preview,
    list_conversation_messages,
    list_conversations,
    save_listener_messages,
    save_global_listener_messages,
    upsert_groups,
    upsert_group,
    mark_conversation_as_read,
    resolve_thread_type,
    search_conversation_messages,
)
from app.modules.all_platform.zalo.services.zca_auth_store import load_zca_auth
from app.modules.all_platform.zalo.services.zalo_bot_service import annotate_bot_messages, note_staff_reply
from app.modules.all_platform.zalo.services.zca_api_bridge import (
    ZcaAuthExpiredError,
    find_zca_user_by_phone,
    get_zca_user_info,
    find_zca_user_by_username,
    get_zca_group_history,
    get_zca_user_history,
    list_zca_groups,
    list_zca_friends,
    send_zca_message,
    send_zca_images,
    sync_zca_group_old_messages,
    remove_zca_unread_mark,
    recall_zca_message,
    get_zca_friend_status,
    send_zca_friend_request,
    accept_zca_friend_request,
    get_zca_group_members_full,
    get_zca_stickers_detail,
    send_zca_sticker,
    send_zca_voice,
    add_zca_reaction,
    search_zca_stickers,
)
from app.modules.all_platform.zalo.services.zca_persistent_listener import (
    get_listener_status,
    restart_listener,
)
from app.core.phone import vn_phone_to_e164

router = APIRouter(
    prefix="/conversations",
    tags=["zalo-conversations"],
    dependencies=[Depends(verify_zalo_api_key)],
)

# Thông báo chuẩn khi phiên Zalo hết hạn — FE dựa vào status 401 + code này để hiện CTA login lại.
ZCA_SESSION_EXPIRED_DETAIL = {
    "code": "zca_session_expired",
    "message": "Phiên đăng nhập Zalo đã hết hạn hoặc bị đăng xuất (có thể do đăng nhập cùng lúc ở nơi khác). Vui lòng đăng nhập lại qua Chrome Extension.",
}


def _normalize_user_id(value: Optional[str]) -> str:
    raw = (value or "default").strip().lower()
    raw = re.sub(r"[^a-z0-9._-]+", "-", raw).strip("-._")
    return raw or "default"



# ==============================================================================
# ⚡ ACCELERATOR CACHE (Tối ưu hoá truy vấn & loại bỏ Supabase round-trip)
# ==============================================================================
_AUTH_USER_CACHE: Dict[str, Tuple[float, Optional[Dict[str, Any]]]] = {}
_ACCOUNT_META_CACHE: Dict[str, Tuple[float, Optional[Dict[str, Any]]]] = {}
_PERM_CACHE: Dict[Tuple[str, str, str], Tuple[float, Optional[set[str]]]] = {}
_MESSAGE_CACHE: Dict[Tuple[str, str, int, int], Tuple[float, Dict[str, Any]]] = {}
_CONV_PHONE_CACHE: Dict[str, Tuple[float, Optional[str]]] = {}

AUTH_CACHE_TTL = 60.0  # 60s cache cho app_user và zalo_account metadata
MESSAGE_CACHE_TTL = 30.0  # 30s RAM accelerator cache cho tin nhắn hội thoại Zalo (tự động invalidate khi có tin mới/gửi/thu hồi)
CONV_PHONE_CACHE_TTL = 60.0  # 60s cache SĐT hội thoại tránh query 7 bảng tuần tự mỗi lần click chat


def invalidate_conversation_phone_cache(conversation_id: Optional[str] = None) -> None:
    if not conversation_id:
        _CONV_PHONE_CACHE.clear()
        return
    c_id = conversation_id.strip()
    for k in [k for k in list(_CONV_PHONE_CACHE.keys()) if k.startswith(f"{c_id}:")]:
        _CONV_PHONE_CACHE.pop(k, None)

def invalidate_conversation_message_cache(user_id: str, conversation_id: Optional[str] = None) -> None:
    """Xoá cache tin nhắn khi có tin nhắn mới hoặc thao tác gửi/thu hồi."""
    u_id = user_id.strip().lower()
    c_id = conversation_id.strip() if conversation_id else None
    keys_to_del = [
        k for k in list(_MESSAGE_CACHE.keys())
        if k[0].strip().lower() == u_id and (c_id is None or k[1] == c_id)
    ]
    for k in keys_to_del:
        _MESSAGE_CACHE.pop(k, None)


async def check_caller_conversation_access(
    account_id: str,
    caller_email: Optional[str],
) -> Optional[set[str]]:
    """Kiểm tra quyền truy cập của người gọi đối với tài khoản zalo account_id (kèm TTL Cache 60s)."""
    if not caller_email:
        return None

    now = time.time()
    caller_email_clean = caller_email.strip().lower()

    # 1. Tìm thông tin app_user từ cache (TTL 60s)
    user_cached = _AUTH_USER_CACHE.get(caller_email_clean)
    if user_cached and (now - user_cached[0] < AUTH_CACHE_TTL):
        caller_user = user_cached[1]
    else:
        user_rows = await _rest(
            "GET",
            "app_users",
            params={
                "select": "id,role",
                "email": f"eq.{caller_email_clean}",
                "limit": "1",
            },
        )
        caller_user = user_rows[0] if user_rows else None
        _AUTH_USER_CACHE[caller_email_clean] = (now, caller_user)

    if not caller_user:
        raise HTTPException(status_code=403, detail="Không tìm thấy thông tin tài khoản người gọi.")
        
    caller_user_id = str(caller_user.get("id"))
    caller_role = str(caller_user.get("role") or "").strip().lower()

    # 2. Tìm chủ sở hữu của tài khoản Zalo từ cache (TTL 60s)
    acc_cached = _ACCOUNT_META_CACHE.get(account_id)
    if acc_cached and (now - acc_cached[0] < AUTH_CACHE_TTL):
        acc_data = acc_cached[1]
    else:
        account_rows = await _rest(
            "GET",
            "zalo_accounts",
            params={
                "select": "owner_id,is_shared_with_all",
                "account_id": f"eq.{account_id}",
                "limit": "1",
            },
        )
        acc_data = account_rows[0] if account_rows else None
        _ACCOUNT_META_CACHE[account_id] = (now, acc_data)

    owner_user_id = str(acc_data.get("owner_id") or "") if acc_data else None

    # 3. Nếu là chủ sở hữu, cho phép xem toàn bộ
    if owner_user_id and caller_user_id == owner_user_id:
        return None

    # 3b. Tài khoản đánh dấu "dùng chung toàn công ty" -> mọi nhân viên đều full quyền
    if acc_data and bool(acc_data.get("is_shared_with_all")):
        return None

    # 4. Nếu không phải chủ sở hữu, chỉ admin và leader được xem
    if caller_role not in ["admin", "superadmin", "leader"]:
        raise HTTPException(status_code=403, detail="Bạn không có quyền truy cập dữ liệu của tài khoản này.")

    # 5. Truy vấn danh sách cuộc hội thoại được share từ cache (TTL 60s)
    perm_cache_key = (account_id, caller_user_id, caller_role)
    perm_cached = _PERM_CACHE.get(perm_cache_key)
    if perm_cached and (now - perm_cached[0] < AUTH_CACHE_TTL):
        return perm_cached[1]

    perm_params = {
        "select": "conversation_id,id_leader",
        "account_id": f"eq.{account_id}",
        "is_active": "eq.true",
        "limit": "5000",
    }
    if caller_role == "leader":
        perm_params["or"] = f"(id_leader.eq.{caller_user_id},id_leader.is.null)"

    perm_rows = await _rest(
        "GET",
        "zalo_conversation_permissions",
        params=perm_params,
    ) or []

    allowed_ids = {str(row.get("conversation_id") or "").strip() for row in perm_rows if row.get("conversation_id")}
    _PERM_CACHE[perm_cache_key] = (now, allowed_ids)
    return allowed_ids


class SyncRecentRequest(BaseModel):
    account_id: Optional[str] = None
    limit: int = Field(default=50, ge=1, le=100)
    messages_per_conversation: int = Field(default=50, ge=1, le=200)


class SyncRecentGroupResult(BaseModel):
    group_id: str
    group_name: str
    messages_saved: int = 0
    status: str
    error: Optional[str] = None


class SyncRecentResponse(BaseModel):
    account_id: str
    scanned: int = 0
    groups_with_messages: int = 0
    messages_saved: int = 0
    errors: int = 0
    results: List[SyncRecentGroupResult] = Field(default_factory=list)

class SyncDomMessage(BaseModel):
    message_id: Optional[str] = None
    source_message_id: Optional[str] = None
    sender_id: Optional[str] = None
    sender_name: Optional[str] = None
    timestamp: Optional[str] = None
    timestamp_text: Optional[str] = None
    time_text: Optional[str] = None
    type: str = "webchat"
    content: Optional[str] = None
    image_urls: List[str] = Field(default_factory=list)
    is_sent: bool = False
    is_deleted: bool = False

class SyncDomConversation(BaseModel):
    group_id: str
    group_name: Optional[str] = None
    avatar_url: Optional[str] = None
    unread_count: Optional[int] = None
    messages: List[SyncDomMessage] = Field(default_factory=list)

class SyncDomRequest(BaseModel):
    account_id: Optional[str] = None
    conversations: List[SyncDomConversation] = Field(default_factory=list)

class SyncDomResponse(BaseModel):
    ok: bool = True
    account_id: str
    scanned: int = 0
    groups_with_messages: int = 0
    messages_saved: int = 0
    errors: int = 0
    results: List[SyncRecentGroupResult] = Field(default_factory=list)


async def list_conversations_for_caller(
    user_id: str,
    caller_email: Optional[str],
    limit: int = 500,
) -> List[Dict[str, Any]]:
    try:
        rows = await _rest(
            "POST",
            "rpc/fn_get_zalo_conversations",
            json={
                "p_account_id": user_id,
                "p_caller_email": caller_email or "",
                "p_limit": limit,
            }
        ) or []
        
        results = []
        for r in rows:
            last_msg_at = r.get("last_message_at")
            latest_message_at = str(last_msg_at) if last_msg_at else None
            c_name = (r.get("conversation_name") or r.get("group_name") or "").strip()
            l_sender = (r.get("last_sender_name") or "").strip()
            if (not c_name or c_name.lower() in ("markee", "zalo", "user", "dm", "me", "__me__") or c_name == str(r.get("conversation_id"))) and l_sender and l_sender.lower() not in ("markee", "__me__", "me", "bạn", "ban"):
                c_name = l_sender
            elif not c_name:
                c_name = r.get("conversation_id") or "Người dùng Zalo"

            clean_latest_content = format_sidebar_last_message_preview(
                r.get("last_message_content"),
                msg_type=r.get("last_message_type"),
            )
            results.append({
                "conversation_id": r.get("conversation_id"),
                "conversation_name": c_name,
                "account_id": user_id,
                "message_count": 0,
                "image_count": 0,
                "sent_count": 0,
                "received_count": 0,
                "latest_message_at": latest_message_at,
                "latest_content": clean_latest_content,
                "latest_sender_name": r.get("last_sender_name"),
                "has_messages": bool(latest_message_at),
                "sync_status": "has_messages" if latest_message_at else "no_messages",
                "avatar_url": r.get("avatar_url"),
                "unread_count": int(r.get("unread_count") or 0),
                "is_pinned": bool(r.get("is_pinned")),
                "is_friend": bool(r.get("is_friend")),
                "thread_type": r.get("thread_type") or ("user" if r.get("is_friend") else "group"),
                "tag": r.get("tag"),
            })
        try:
            from app.modules.all_platform.services.zalo_inbox_kpi_service import (
                get_zalo_kpi_status_by_conversations,
            )

            kpi_map = await asyncio.to_thread(
                get_zalo_kpi_status_by_conversations,
                user_id,
                [item["conversation_id"] for item in results if item.get("conversation_id")],
            )
            for item in results:
                meta = kpi_map.get(str(item.get("conversation_id") or ""))
                if not meta:
                    continue
                item["zalo_kpi_status"] = "confirmed" if meta.get("is_confirmed") else (
                    "inbound_pending" if meta.get("direction_status") == "inbound_pending" else "waiting_reply"
                )
                item["zalo_kpi_direction"] = meta.get("direction_status")
                item["zalo_kpi_source"] = meta.get("source_type")
                item["zalo_kpi_confirmed"] = bool(meta.get("is_confirmed"))
                item["zalo_kpi_is_lead"] = bool(meta.get("is_lead"))
                item["zalo_kpi_post_id"] = meta.get("source_post_id")
                item["zalo_kpi_post_url"] = meta.get("source_post_url")
                item["zalo_kpi_phone"] = meta.get("phone_number")
        except Exception as kpi_exc:
            logger.debug(f"Could not enrich conversations with zalo_kpi: {kpi_exc}")
        return results
    except Exception as exc:
        logger.info(f"fn_get_zalo_conversations RPC failed: {exc}. Falling back to manual queries...")
        allowed_conv_ids = await check_caller_conversation_access(user_id, caller_email)
        rows = await list_conversations(user_id, limit=limit)
        if allowed_conv_ids is not None:
            rows = [r for r in rows if str(r.get("group_id") or "").strip() in allowed_conv_ids]
        return rows


@router.get("", response_model=ZaloConversationListResponse)
async def get_conversations(
    account_id: Optional[str] = Query(None),
    x_user_id: str = Header("default", alias="X-User-ID"),
    # Trước đây trực tiếp tin header X-Caller-Email client tự gửi (lấy từ
    # localStorage — ai cũng sửa được bằng DevTools để mạo danh leader/admin
    # bất kỳ). Giờ lấy từ JWT đã xác thực (cookie crawlpro_access_token).
    x_caller_email: Optional[str] = Depends(get_authenticated_caller_email),
    caller_user: Optional[dict[str, Any]] = Depends(get_authenticated_caller_user),
    limit: int = Query(500, ge=1, le=2000),
):
    user_id = _normalize_user_id(account_id or x_user_id)
    try:
        rows = await list_conversations_for_caller(user_id, x_caller_email, limit=limit)
        return {
            "account_id": user_id,
            "conversations": [ZaloConversationSummary(**row) for row in rows],
            "total": len(rows),
        }
    except SupabaseNotConfigured as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Không thể tải danh sách hội thoại Zalo: {exc}")


@router.get("/call-health")
async def get_zalo_call_health(
    account_id: Optional[str] = Query(None),
    x_user_id: str = Header("default", alias="X-User-ID"),
):
    """Đo độ trễ đường truyền (RTT/Jitter) & kiểm tra trạng thái kết nối phiên Zalo trước khi gọi."""
    user_id = _normalize_user_id(account_id or x_user_id)
    has_auth = False
    try:
        auth = await load_zca_auth(user_id)
        has_auth = bool(auth)
    except Exception:
        has_auth = False

    listener_info: Dict[str, Any] = {}
    try:
        listener_info = get_listener_status(user_id) or {}
    except Exception:
        listener_info = {}

    from app.modules.all_platform.zalo.services.zalo_call_service import (
        is_zrtc_worker_connected,
    )

    return {
        "ok": True,
        "server_ts_ms": int(time.time() * 1000),
        "account_id": user_id,
        "has_auth": has_auth,
        "listener_running": bool(listener_info.get("running")),
        "listener_connected": bool(listener_info.get("connected")),
        "auth_expired": bool(listener_info.get("auth_expired")),
        "zrtc_worker_connected": is_zrtc_worker_connected(),
    }


class StartZaloDirectCallRequest(BaseModel):
    account_id: Optional[str] = None
    conversation_id: Optional[str] = None
    callee_id: Optional[str] = None
    phone_number: Optional[str] = None
    customer_name: Optional[str] = None
    call_type: int = Field(1, description="1 = Gọi thoại (Voice), 3 = Gọi video (Video)")
    source_post_id: Optional[str] = None
    source_platform: Optional[str] = None


class ZaloCallActionRequest(BaseModel):
    action: str = Field(..., description="cancel | end | mark_connected")
    result_code: Optional[str] = None


@router.post("/call/start")
async def start_zalo_direct_call_endpoint(
    body: StartZaloDirectCallRequest,
    account_id: Optional[str] = Query(None),
    x_user_id: str = Header("default", alias="X-User-ID"),
    x_caller_email: Optional[str] = Depends(get_authenticated_caller_email),
    caller_user: Optional[dict[str, Any]] = Depends(get_authenticated_caller_user),
):
    """Khởi tạo cuộc gọi trực tiếp qua Zalo VoIP Engine (Hướng 3: 11300 requestcall + 11301 request + UDP RTP)."""
    from app.modules.all_platform.zalo.services.zalo_call_service import start_call_session

    user_id = _normalize_user_id(body.account_id or account_id or x_user_id)
    try:
        session = await start_call_session(
            account_id=user_id,
            conversation_id=body.conversation_id,
            callee_id=body.callee_id,
            phone_number=body.phone_number,
            customer_name=body.customer_name,
            call_type=body.call_type,
            source_post_id=body.source_post_id,
            source_platform=body.source_platform,
            caller_email=x_caller_email,
            caller_user=caller_user,
        )
        return {"ok": True, "session": session.to_dict()}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Không thể khởi tạo cuộc gọi Zalo: {exc}")


@router.get("/call/{session_id}/status")
async def get_zalo_direct_call_status_endpoint(session_id: str):
    """Lấy trạng thái thời gian thực của phiên gọi Zalo."""
    from app.modules.all_platform.zalo.services.zalo_call_service import get_call_session

    session = get_call_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Không tìm thấy phiên gọi Zalo.")
    return {"ok": True, "session": session.to_dict()}


@router.post("/call/{session_id}/action")
async def control_zalo_direct_call_endpoint(
    session_id: str,
    body: ZaloCallActionRequest,
):
    """Điều khiển phiên gọi Zalo: hủy chuông (11305), kết thúc (11306+11311) & tự động cộng +1 KPI CALL."""
    from app.modules.all_platform.zalo.services.zalo_call_service import perform_call_action

    try:
        session = await perform_call_action(
            session_id,
            body.action,
            result_code=body.result_code,
        )
        return {"ok": True, "session": session.to_dict()}
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Lỗi điều khiển cuộc gọi Zalo: {exc}")


@router.websocket("/call-ws/{session_id}")
async def zalo_direct_call_audio_websocket(websocket: WebSocket, session_id: str):
    """Kênh WebSocket 2 chiều truyền khung âm thanh PCM/Opus và trạng thái cuộc gọi thời gian thực."""
    from app.modules.all_platform.zalo.services.zalo_call_service import (
        get_call_session,
        perform_call_action,
    )

    await websocket.accept()
    session = get_call_session(session_id)
    if not session:
        await websocket.send_text(json.dumps({"type": "error", "message": "Session not found"}))
        await websocket.close(code=1008)
        return

    session.ws_clients.add(websocket)
    try:
        await websocket.send_text(
            json.dumps({"type": "call_state", "session": session.to_dict(), **session.to_dict()})
        )
        while True:
            msg = await websocket.receive()
            if msg.get("type") == "websocket.disconnect":
                break
            if "bytes" in msg and msg["bytes"]:
                raw_bytes = msg["bytes"]
                if session.status == "connected":
                    if session.is_video_call and len(raw_bytes) > 4 and raw_bytes[:4] == b"VJPG":
                        session.send_video_from_browser(raw_bytes[4:])
                    else:
                        session.send_audio_from_browser(raw_bytes)
            elif "text" in msg and msg["text"]:
                try:
                    data = json.loads(msg["text"])
                except Exception:
                    continue
                cmd = str(data.get("type") or data.get("action") or "").lower()
                if cmd == "ping":
                    await websocket.send_text(
                        json.dumps({"type": "pong", "ts": int(time.time() * 1000)})
                    )
                elif cmd == "video_mute" and session.is_video_call:
                    session.set_video_camera_muted(bool(data.get("muted")))
                    await session.broadcast_json(
                        {"type": "call_state", "session": session.to_dict(), **session.to_dict()}
                    )
                elif cmd == "request_keyframe" and session.is_video_call:
                    session.request_remote_video_keyframe()
                elif cmd in ("cancel", "end", "hangup", "mark_connected"):
                    await perform_call_action(
                        session_id,
                        cmd,
                        result_code=data.get("result_code"),
                    )
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.debug(f"Call WebSocket closed for session={session_id}: {exc}")
    finally:
        session.ws_clients.discard(websocket)


@router.websocket("/zrtc-worker-ws")
async def zalo_zrtc_media_worker_websocket(websocket: WebSocket):
    """Kênh WebSocket chuyên dụng cho ZRTC Media Worker (Windows/Wine zcall_ia32.node)
    đăng ký nhận lệnh Signaling (start_call/update_caller_info/end_call) và pipe audio PCM16 2 chiều."""
    import os
    from app.core.config import settings
    from app.modules.all_platform.zalo.services.zalo_call_service import (
        handle_zrtc_worker_binary,
        handle_zrtc_worker_text,
        register_zrtc_worker,
        unregister_zrtc_worker,
    )

    expected_token = (
        os.getenv("ZRTC_WORKER_TOKEN")
        or os.getenv("JWT_SECRET_KEY")
        or getattr(settings, "JWT_SECRET_KEY", "")
        or ""
    ).strip()
    provided_token = (websocket.query_params.get("token") or "").strip()
    if expected_token and provided_token != expected_token:
        await websocket.close(code=1008)
        return

    worker_id = (websocket.query_params.get("worker_id") or f"zrtc_{int(time.time() * 1000)}").strip()
    await websocket.accept()
    register_zrtc_worker(worker_id, websocket)
    try:
        await websocket.send_text(json.dumps({"type": "worker_ready", "worker_id": worker_id}))
        while True:
            msg = await websocket.receive()
            if msg.get("type") == "websocket.disconnect":
                break
            if "bytes" in msg and msg["bytes"]:
                await handle_zrtc_worker_binary(worker_id, msg["bytes"])
            elif "text" in msg and msg["text"]:
                await handle_zrtc_worker_text(worker_id, msg["text"])
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.debug(f"[ZRTC-WORKER] WS closed for worker={worker_id}: {exc}")
    finally:
        unregister_zrtc_worker(worker_id)


# SU CO THAT (2026-10-04): frontend (ZaloInboxAdminShell.tsx, luong "Xu ly"
# tu CRM voi ?conv=) co bug - reload trang lien tuc lam component remount
# lien tuc, moi lan mount goi lai endpoint nay cho CUNG 1 conv_id, flood
# hang nghin request/phut, nghet CPU backend toi 86%+ lam MOI API (ke ca
# auth/me) bi xep hang/timeout. Da fix frontend (sessionStorage cooldown),
# nhung them 1 lop chan o day cho CHAC - cache ket qua ngan han theo
# (conv_id, caller) de du frontend/client nao sau nay co bug tuong tu cung
# khong lam qua tai Supabase/CPU. TTL ngan (20s) vi day chi la tra cuu
# "acc nao dang giu conv nay" - khong nhay cam ve thoi gian thuc.
_RESOLVE_ACCOUNT_CACHE: Dict[str, tuple[float, dict]] = {}
_RESOLVE_ACCOUNT_CACHE_TTL_S = 20.0


@router.get("/resolve-account")
async def resolve_conversation_account(
    conv_id: str = Query(...),
    # Trước đây trực tiếp tin header X-Caller-Email client tự gửi (lấy từ
    # localStorage — ai cũng sửa được bằng DevTools để mạo danh leader/admin
    # bất kỳ). Giờ lấy từ JWT đã xác thực (cookie crawlpro_access_token).
    x_caller_email: Optional[str] = Depends(get_authenticated_caller_email),
    caller_user: Optional[dict[str, Any]] = Depends(get_authenticated_caller_user),
):
    """Tim tai khoan Zalo dang giu 1 conv_id, dung cho luong 'Xu ly' tu trang
    Khach hang (CRM) - bam vao la tu dong chon dung acc + nhay thang toi hoi
    thoai, khong can biet truoc acc nao dang giu no."""
    cache_key = f"{conv_id}:{x_caller_email or ''}"
    now = time.monotonic()
    cached = _RESOLVE_ACCOUNT_CACHE.get(cache_key)
    if cached and now - cached[0] < _RESOLVE_ACCOUNT_CACHE_TTL_S:
        return cached[1]

    rows = await _rest(
        "GET",
        "zalo_groups",
        params={"select": "user_id", "group_id": f"eq.{conv_id}", "limit": "1"},
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Không tìm thấy hội thoại này.")
    account_id = str(rows[0].get("user_id") or "")
    if not account_id:
        raise HTTPException(status_code=404, detail="Không tìm thấy hội thoại này.")

    allowed_ids = await check_caller_conversation_access(account_id, x_caller_email)
    if allowed_ids is not None and conv_id not in allowed_ids:
        raise HTTPException(status_code=403, detail="Bạn không có quyền truy cập hội thoại này.")

    result = {"account_id": account_id, "conv_id": conv_id}
    # Don cache qua date tien loi (chi khi dict phinh to), khong can scheduler
    # rieng - endpoint nay goi it, du lieu nho, khong dang lo leak thuc te.
    if len(_RESOLVE_ACCOUNT_CACHE) > 500:
        expired = [k for k, (ts, _) in _RESOLVE_ACCOUNT_CACHE.items() if now - ts > _RESOLVE_ACCOUNT_CACHE_TTL_S]
        for k in expired:
            _RESOLVE_ACCOUNT_CACHE.pop(k, None)
    _RESOLVE_ACCOUNT_CACHE[cache_key] = (now, result)
    return result


@router.post("/sync-recent", response_model=SyncRecentResponse)
async def sync_recent_conversations(
    body: SyncRecentRequest,
    x_user_id: str = Header("default", alias="X-User-ID"),
):
    user_id = _normalize_user_id(body.account_id or x_user_id)
    auth = await load_zca_auth(user_id)
    if not auth:
        raise HTTPException(status_code=401, detail="No persisted ZCA auth found for this account")

    # Tải siêu dữ liệu các nhóm hiện tại từ DB để so sánh thời gian tin nhắn cuối
    # PHẢI tải trước khi gọi upsert_groups để lấy được last_message_at CŨ
    existing_meta = {}
    try:
        from app.modules.all_platform.zalo.services.supabase_service import _rest
        rows = await _rest(
            "GET",
            "zalo_groups",
            params={
                "select": "group_id,last_message_at,unread_count",
                "user_id": f"eq.{user_id}",
            }
        ) or []
        existing_meta = {
            r["group_id"]: {
                "last_message_at": r.get("last_message_at"),
                "unread_count": int(r.get("unread_count") or 0)
            }
            for r in rows
        }
    except Exception as exc:
        logger.warning(f"Could not load existing group metadata for sync check: {exc}")

    try:
        # 1. Fetch all groups and friends and upsert them to zalo_groups
        groups = await list_zca_groups(auth)
        friends = await list_zca_friends(auth)
        all_chats = groups + friends
        await upsert_groups(user_id, [chat.model_dump() for chat in all_chats])
    except ZcaAuthExpiredError:
        raise HTTPException(status_code=401, detail=ZCA_SESSION_EXPIRED_DETAIL)
    except SupabaseNotConfigured as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        err_msg = str(exc).lower()
        if "429" in err_msg or "too many" in err_msg or "rate limit" in err_msg:
            raise HTTPException(
                status_code=429,
                detail="Zalo đang giới hạn tốc độ yêu cầu (quá nhiều thao tác). Vui lòng đợi 1-2 phút rồi thử lại."
            )
        raise HTTPException(status_code=500, detail=f"Không thể tải danh sách hội thoại Zalo: {exc}")

    def _chat_sort_ms(chat: Any) -> int:
        from app.modules.all_platform.zalo.services.supabase_service import _parse_to_millis

        return _parse_to_millis(getattr(chat, "last_message_at", None))

    # Manual sync should fetch the latest page from Zalo for the visible recent chats.
    # Do not skip based on DB/API last_message_at metadata: that metadata can be stale
    # or already polluted by an older sync page, causing today's messages to be missed.
    recent_chats = sorted(
        all_chats,
        key=lambda chat: (
            1 if getattr(chat, "is_pinned", False) else 0,
            _chat_sort_ms(chat),
            int(getattr(chat, "unread_count", 0) or 0),
        ),
        #
        reverse=True,
    )[: body.limit]

    results: List[SyncRecentGroupResult] = []
    total_saved = 0
    groups_with_messages = 0
    errors = 0

    per_group_count = max(20, min(body.messages_per_conversation, 200))

    # Sequential processing with adaptive delay to avoid Zalo 429 rate limiting.
    # Burst concurrent calls (semaphore(4)) caused all groups to fail when Zalo
    # throttled the first burst — sequential + backoff is much more reliable.
    import random

    _sync_delay = 2.0       # base delay between groups (seconds)
    _sync_max_delay = 30.0  # cap delay after repeated 429s
    _consecutive_429 = 0

    async def _fetch_group_messages(group, retry: int = 0) -> List:
        """Fetch messages for one group with up to 2 retries on 429."""
        nonlocal _sync_delay, _consecutive_429
        thread_type = 0 if getattr(group, "is_friend", False) else 1
        try:
            if thread_type == 0:
                messages = await get_zca_user_history(auth, group.group_id, count=per_group_count)
            else:
                messages = await get_zca_group_history(auth, group.group_id, count=per_group_count)

            if not messages:
                messages = await sync_zca_group_old_messages(
                    auth, group.group_id, thread_type=thread_type, count=per_group_count,
                )
            if not messages and thread_type == 1:
                messages = await sync_zca_group_old_messages(
                    auth, group.group_id, thread_type=0, count=per_group_count,
                )
            _consecutive_429 = 0
            _sync_delay = max(2.0, _sync_delay * 0.9)  # slowly recover delay on success
            return messages or []
        except Exception as exc:
            err = str(exc).lower()
            is_429 = "429" in err or "too many" in err or "rate limit" in err
            if is_429:
                _consecutive_429 += 1
                _sync_delay = min(_sync_max_delay, _sync_delay * 2.0)
                cooldown = min(120.0, 30.0 * _consecutive_429)
                logger.warning(
                    f"sync-recent 429 for group={group.group_id} "
                    f"retry={retry} consecutive={_consecutive_429}, "
                    f"cooling down {cooldown:.0f}s"
                )
                if retry < 2:
                    await asyncio.sleep(cooldown)
                    return await _fetch_group_messages(group, retry=retry + 1)
            raise

    for idx, group in enumerate(recent_chats):
        # Adaptive jitter delay between groups (skip before the first one)
        if idx > 0:
            jitter = _sync_delay * (1.0 + random.uniform(-0.2, 0.2))
            await asyncio.sleep(jitter)

        try:
            messages = await _fetch_group_messages(group)
            if not messages:
                results.append(SyncRecentGroupResult(
                    group_id=group.group_id,
                    group_name=group.name,
                    messages_saved=0,
                    status="empty",
                ))
                continue
            saved = await save_listener_messages(
                user_id, group.group_id, group.name, messages, increment_unread=False,
            )
            results.append(SyncRecentGroupResult(
                group_id=group.group_id,
                group_name=group.name,
                messages_saved=saved,
                status="has_messages" if saved else "empty",
            ))
        except ZcaAuthExpiredError:
            raise HTTPException(status_code=401, detail=ZCA_SESSION_EXPIRED_DETAIL)
        except Exception as exc:
            logger.warning(f"sync-recent failed for group={group.group_id}: {exc}")
            results.append(SyncRecentGroupResult(
                group_id=group.group_id,
                group_name=group.name,
                messages_saved=0,
                status="error",
                error=str(exc),
            ))

    for item in results:
        total_saved += item.messages_saved
        if item.messages_saved > 0:
            groups_with_messages += 1
        if item.status == "error":
            errors += 1

    return SyncRecentResponse(
        account_id=user_id,
        scanned=len(recent_chats),
        groups_with_messages=groups_with_messages,
        messages_saved=total_saved,
        errors=errors,
        results=list(results),
    )



def _normalize_dom_conversation_id(value: str) -> str:
    raw = str(value or "").strip()
    if raw.startswith("g") and raw[1:].isdigit():
        return raw[1:]
    return raw

def _normalize_dom_message_id(message: SyncDomMessage, group_id: str) -> str:
    raw = str(message.source_message_id or message.message_id or "").strip()
    if raw:
        return raw
    seed = "|".join(
        [
            group_id,
            str(message.sender_id or message.sender_name or ""),
            str(message.timestamp_text or message.timestamp or message.time_text or ""),
            str(message.content or ""),
            "1" if message.is_sent else "0",
        ]
    )
    import hashlib
    return "dom-" + hashlib.sha1(seed.encode("utf-8", errors="ignore")).hexdigest()[:32]

@router.post("/sync-dom", response_model=SyncDomResponse)
async def sync_dom_messages(
    body: SyncDomRequest,
    x_user_id: str = Header("default", alias="X-User-ID"),
):
    """Persist messages scraped from the visible Zalo Web DOM.

    This route intentionally does not publish SSE events, send messages, or touch the
    persistent listener. It only upserts Supabase rows using the same conflict key as
    listener/crawl data: `(user_id, group_id, source_message_id)`.
    """
    user_id = _normalize_user_id(body.account_id or x_user_id)
    results: List[SyncRecentGroupResult] = []
    total_saved = 0
    groups_with_messages = 0
    errors = 0

    for conversation in body.conversations[:100]:
        group_id = _normalize_dom_conversation_id(conversation.group_id)
        if not group_id:
            continue
        group_name = (conversation.group_name or group_id).strip() or group_id

        messages: List[Message] = []
        for item in conversation.messages[:500]:
            content = (item.content or "").strip() or None
            image_urls = [str(url) for url in (item.image_urls or []) if str(url).strip()]
            if not content and not image_urls:
                continue
            source_id = _normalize_dom_message_id(item, group_id)
            timestamp_value = item.timestamp_text or item.timestamp
            messages.append(
                Message(
                    message_id=source_id,
                    sender_id=item.sender_id,
                    sender_name=item.sender_name,
                    timestamp=str(timestamp_value) if timestamp_value else None,
                    time_text=item.time_text,
                    type=item.type or ("image" if image_urls else "webchat"),
                    content=content,
                    image_urls=image_urls,
                    is_deleted=item.is_deleted,
                    is_sent=item.is_sent,
                    group_id=group_id,
                )
            )

        try:
            saved = 0
            if messages:
                saved = await save_listener_messages(
                    user_id,
                    group_id,
                    group_name,
                    messages,
                    increment_unread=False,
                )
            elif conversation.avatar_url or conversation.unread_count is not None:
                await upsert_group(
                    user_id=user_id,
                    group_id=group_id,
                    group_name=group_name,
                    avatar_url=conversation.avatar_url,
                    unread_count=conversation.unread_count,
                    is_friend=conversation.is_friend,
                )
            total_saved += saved
            if saved > 0:
                groups_with_messages += 1
            results.append(
                SyncRecentGroupResult(
                    group_id=group_id,
                    group_name=group_name,
                    messages_saved=saved,
                    status="has_messages" if saved else "empty",
                )
            )
        except SupabaseNotConfigured as exc:
            raise HTTPException(status_code=503, detail=str(exc))
        except Exception as exc:
            logger.warning(f"Failed saving DOM-scraped messages for group={group_id}: {exc}")
            errors += 1
            results.append(
                SyncRecentGroupResult(
                    group_id=group_id,
                    group_name=group_name,
                    messages_saved=0,
                    status="error",
                    error=str(exc),
                )
            )

    return SyncDomResponse(
        account_id=user_id,
        scanned=len(body.conversations),
        groups_with_messages=groups_with_messages,
        messages_saved=total_saved,
        errors=errors,
        results=results,
    )

async def _background_sync_conversation_messages(account_id: str, conversation_id: str):
    """Background sync: dùng group-history thay vì sync-old-messages để tránh lỗi getOwnId null."""
    from app.modules.all_platform.zalo.services.zca_auth_store import load_zca_auth
    from app.modules.all_platform.zalo.services.zca_api_bridge import get_zca_group_history
    from app.modules.all_platform.zalo.services.supabase_service import save_listener_messages, _rest
    try:
        auth = await load_zca_auth(account_id)
        if not auth: return

        # Resolve group_name từ Supabase trước khi dùng conversation_id.
        group_name = conversation_id
        try:
            rows = await _rest(
                "GET",
                "zalo_groups",
                params={
                    "select": "group_name",
                    "user_id": f"eq.{account_id}",
                    "group_id": f"eq.{conversation_id}",
                    "limit": "1",
                },
            ) or []
            if rows and rows[0].get("group_name"):
                resolved = str(rows[0]["group_name"]).strip()
                if resolved and not resolved.startswith("Conversation ") and resolved != conversation_id:
                    group_name = resolved
        except Exception:
            pass  # Fallback vẫn dùng conversation_id

        # Chạy sync_zca_group_old_messages để đồng bộ tin nhắn
        ttype = await resolve_thread_type(account_id, conversation_id)
        messages = await sync_zca_group_old_messages(
            auth, 
            conversation_id, 
            thread_type=ttype, 
            count=50
        )
        if not messages and ttype == 1:
            messages = await sync_zca_group_old_messages(
                auth, 
                conversation_id, 
                thread_type=0, 
                count=50
            )
        if messages:
            await save_listener_messages(
                user_id=account_id,
                group_id=conversation_id,
                group_name=group_name,
                messages=messages,
                increment_unread=False,
            )
    except Exception as exc:
        logger.warning(f"Could not background sync messages for {conversation_id}: {exc}")

def _propagate_cluster_staff_identity(rows: List[Dict[str, Any]]) -> None:
    """Gán định danh nhân viên cho các tin nhắn con trong cùng 1 chùm gửi đi (burst/batch send).

    Khi nhân viên gửi nhiều ảnh cùng lúc, Zalo tạo tin album chính kèm nhiều tin nhắn ảnh con riêng lẻ.
    Các tin ảnh con này do ZCA listener ghi nhận từ websocket nên không mang sẵn staff_name.
    Gom các tin gửi đi liên tiếp (cách nhau <= 30 giây, không có tin khách xen vào) thành 1 cụm,
    và phổ biến staff_name, staff_avatar, staff_email của nhân viên đã gửi cho toàn bộ cụm.
    """
    if not rows:
        return
    # Sắp xếp tạm thời theo thời gian tăng dần để gom cụm
    indexed = sorted(enumerate(rows), key=lambda x: int(x[1].get("ts") or 0))
    current_cluster: List[Dict[str, Any]] = []

    def apply_cluster(cluster: List[Dict[str, Any]]) -> None:
        if not cluster:
            return
        staff_name = None
        staff_avatar = None
        staff_email = None
        for r in cluster:
            if r.get("staff_name"):
                staff_name = r.get("staff_name")
                staff_avatar = r.get("staff_avatar")
                staff_email = r.get("staff_email")
                break
        if staff_name:
            for r in cluster:
                if not r.get("staff_name"):
                    r["staff_name"] = staff_name
                    r["staff_avatar"] = staff_avatar
                    r["staff_email"] = staff_email

    for _, r in indexed:
        is_sent = bool(r.get("is_sent"))
        if not is_sent:
            apply_cluster(current_cluster)
            current_cluster = []
            continue

        ts = int(r.get("ts") or 0)
        if not current_cluster:
            current_cluster.append(r)
        else:
            prev_ts = int(current_cluster[-1].get("ts") or 0)
            if abs(ts - prev_ts) <= 30000:
                current_cluster.append(r)
            else:
                apply_cluster(current_cluster)
                current_cluster = [r]

    apply_cluster(current_cluster)


@router.get("/{conversation_id}/messages", response_model=ZaloLibraryListResponse)
async def get_conversation_messages(
    conversation_id: str,
    background_tasks: BackgroundTasks,
    account_id: Optional[str] = Query(None),
    x_user_id: str = Header("default", alias="X-User-ID"),
    # Trước đây trực tiếp tin header X-Caller-Email client tự gửi (lấy từ
    # localStorage — ai cũng sửa được bằng DevTools để mạo danh leader/admin
    # bất kỳ). Giờ lấy từ JWT đã xác thực (cookie crawlpro_access_token).
    x_caller_email: Optional[str] = Depends(get_authenticated_caller_email),
    caller_user: Optional[dict[str, Any]] = Depends(get_authenticated_caller_user),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    user_id = _normalize_user_id(account_id or x_user_id)
    # Check access permission
    allowed_conv_ids = await check_caller_conversation_access(user_id, x_caller_email)
    if allowed_conv_ids is not None and conversation_id.strip() not in allowed_conv_ids:
        raise HTTPException(
            status_code=403,
            detail="Cuộc trò chuyện này ở chế độ riêng tư và chưa được chia sẻ với bạn."
        )
    
    # User requested to NOT auto-sync old messages on load. 
    # They will click the sync button manually if needed.
    # if offset == 0:
    #     background_tasks.add_task(_background_sync_conversation_messages, user_id, conversation_id)
        
    # ⚡ ACCELERATOR: In-memory short TTL cache (3s) cho việc xem/click tin nhắn
    now = time.time()
    cache_key = (user_id, conversation_id.strip(), limit, offset)
    cached_entry = _MESSAGE_CACHE.get(cache_key)
    if cached_entry and (now - cached_entry[0] < MESSAGE_CACHE_TTL):
        return cached_entry[1]

    try:
        rows, total = await list_conversation_messages(
            user_id,
            conversation_id,
            limit=limit,
            offset=offset,
        )
        # Nhãn "Bot": tin gửi đi do Bot AI trả lời (khớp nhật ký bot) -> sent_by="bot".
        await annotate_bot_messages(user_id, conversation_id.strip(), rows)
        # Bóc tách thông tin nhân sự gửi tin nhắn nội bộ & chuẩn hóa raw_content/msg_kind (G6)
        for row in rows:
            raw = _normalize_raw_content(row.get("raw_content"))
            row["raw_content"] = raw
            row["msg_kind"] = classify_message_kind(
                row.get("type"),
                row.get("content"),
                raw,
                existing_kind=row.get("msg_kind"),
            )
            if isinstance(raw, dict):
                if not row.get("staff_name") and raw.get("staff_name"):
                    row["staff_name"] = raw.get("staff_name")
                if not row.get("staff_avatar") and raw.get("staff_avatar"):
                    row["staff_avatar"] = raw.get("staff_avatar")
                if not row.get("staff_email") and raw.get("staff_email"):
                    row["staff_email"] = raw.get("staff_email")
                if isinstance(raw.get("sender_staff"), dict):
                    s = raw["sender_staff"]
                    if not row.get("staff_name") and s.get("name"):
                        row["staff_name"] = s.get("name")
                    if not row.get("staff_avatar") and s.get("avatar"):
                        row["staff_avatar"] = s.get("avatar")
                    if not row.get("staff_email") and s.get("email"):
                        row["staff_email"] = s.get("email")
                if not row.get("staff_name") and raw.get("sent_by_staff_name"):
                    row["staff_name"] = raw.get("sent_by_staff_name")
                if isinstance(raw.get("sender"), dict) and not row.get("staff_name") and raw["sender"].get("name"):
                    row["staff_name"] = raw["sender"].get("name")
        # Phổ biến định danh nhân viên cho các tin nhắn ảnh/tệp con trong cùng đợt gửi (batch/burst)
        _propagate_cluster_staff_identity(rows)
        response_payload = {
            "messages": [ZaloLibraryMessage(**row) for row in rows],
            "groups": [],
            "total": total,
            "limit": limit,
            "offset": offset,
            "has_more": offset + len(rows) < total,
        }
        _MESSAGE_CACHE[cache_key] = (now, response_payload)
        if len(_MESSAGE_CACHE) > 500:
            for ok in sorted(_MESSAGE_CACHE.keys(), key=lambda k: _MESSAGE_CACHE[k][0])[:100]:
                _MESSAGE_CACHE.pop(ok, None)
        return response_payload
    except SupabaseNotConfigured as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Không thể tải tin nhắn hội thoại Zalo: {exc}")


@router.get("/{conversation_id}/search-messages", response_model=ZaloLibraryListResponse)
async def search_conversation_messages_endpoint(
    conversation_id: str,
    q: str = Query(..., min_length=1, max_length=200),
    account_id: Optional[str] = Query(None),
    x_user_id: str = Header("default", alias="X-User-ID"),
    x_caller_email: Optional[str] = Depends(get_authenticated_caller_email),
    caller_user: Optional[dict[str, Any]] = Depends(get_authenticated_caller_user),
    limit: int = Query(50, ge=1, le=200),
):
    """Tìm tin nhắn cũ chứa từ khoá TRONG 1 hội thoại cụ thể (1 người hoặc 1
    nhóm) — vd tìm "Leo" trong nhóm KẾ TOÁN - VẬN HÀNH DENFOOD. Trả về danh
    sách khớp (mới nhất trước), KHÔNG phân trang lồng vào luồng tin chính —
    FE hiện như 1 panel kết quả riêng.
    """
    user_id = _normalize_user_id(account_id or x_user_id)
    allowed_conv_ids = await check_caller_conversation_access(user_id, x_caller_email)
    if allowed_conv_ids is not None and conversation_id.strip() not in allowed_conv_ids:
        raise HTTPException(
            status_code=403,
            detail="Cuộc trò chuyện này ở chế độ riêng tư và chưa được chia sẻ với bạn."
        )
    try:
        rows = await search_conversation_messages(user_id, conversation_id.strip(), q, limit=limit)
        return {
            "messages": [ZaloLibraryMessage(**row) for row in rows],
            "groups": [],
            "total": len(rows),
            "limit": limit,
            "offset": 0,
            "has_more": False,
        }
    except SupabaseNotConfigured as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Không thể tìm tin nhắn: {exc}")


@router.post("/{conversation_id}/sync")
async def sync_conversation_messages_manually(
    conversation_id: str,
    background_tasks: BackgroundTasks,
    account_id: Optional[str] = Query(None),
    x_user_id: str = Header("default", alias="X-User-ID"),
    # Trước đây trực tiếp tin header X-Caller-Email client tự gửi (lấy từ
    # localStorage — ai cũng sửa được bằng DevTools để mạo danh leader/admin
    # bất kỳ). Giờ lấy từ JWT đã xác thực (cookie crawlpro_access_token).
    x_caller_email: Optional[str] = Depends(get_authenticated_caller_email),
    caller_user: Optional[dict[str, Any]] = Depends(get_authenticated_caller_user),
):
    """Đồng bộ bù tin nhắn thủ công cho một cuộc hội thoại từ Zalo."""
    user_id = _normalize_user_id(account_id or x_user_id)
    # Check access permission
    allowed_conv_ids = await check_caller_conversation_access(user_id, x_caller_email)
    if allowed_conv_ids is not None and conversation_id.strip() not in allowed_conv_ids:
        raise HTTPException(
            status_code=403,
            detail="Cuộc trò chuyện này ở chế độ riêng tư và chưa được chia sẻ với bạn."
        )

    # Thêm background task để chạy đồng bộ tin nhắn
    background_tasks.add_task(_background_sync_conversation_messages, user_id, conversation_id)
    return {"ok": True, "message": "Đã thêm tác vụ đồng bộ lịch sử tin nhắn vào nền"}


class ReplyToPayload(BaseModel):
    """Tin nhắn đang được trả lời/trích dẫn — FE lấy nguyên các field này từ tin
    đã có sẵn trong state cục bộ (không cần BE tra lại DB), rồi gửi kèm khi tạo
    tin mới. Áp dụng được cho tin của CẢ đối phương lẫn của chính mình."""
    message_id: str = Field(..., min_length=1, description="source_message_id (msgId thật) của tin được trả lời")
    cli_msg_id: Optional[str] = Field(None, description="cli_msg_id của tin được trả lời (nếu có)")
    sender_id: Optional[str] = Field(None, description="uid người gửi tin được trả lời")
    content: Optional[str] = Field(None, description="Nội dung xem trước của tin được trả lời")
    ts: Optional[int] = Field(None, description="epoch ms của tin được trả lời")


class SendMessageRequest(BaseModel):
    text: str = Field(..., min_length=1, description="Nội dung tin nhắn văn bản")
    thread_type: Optional[int] = Field(
        None,
        description="0 = cá nhân, 1 = nhóm. Nếu để trống, tự suy ra từ conversation_id.",
    )
    # Zalo tập trung (Mục 3.3.5 + 4.6 mentionUtils guide) — @tag/@All trong tin nhắn nhóm.
    mentions: Optional[List[Mention]] = Field(
        None, description="[{pos,uid,len}] — vị trí/uid/độ dài mỗi mention trong `text`"
    )
    staff_name: Optional[str] = Field(None, description="Họ tên nhân viên gửi tin nhắn nội bộ")
    staff_avatar: Optional[str] = Field(None, description="Avatar nhân viên gửi tin nhắn nội bộ")
    staff_email: Optional[str] = Field(None, description="Email nhân viên gửi tin nhắn nội bộ")
    reply_to: Optional[ReplyToPayload] = Field(
        None, description="Trả lời/trích dẫn 1 tin nhắn cụ thể trong hội thoại"
    )


class SendMessageResponse(BaseModel):
    ok: bool
    conversation_id: str
    message: str = ""


async def _auto_track_zalo_conversation_sender(account_id: str, conversation_id: str, caller_email: Optional[str]) -> None:
    """Lưu vết quyền chia sẻ (sửa on_conflict đúng 4 cột) và ghi nhận KPI 2 chiều vào zalo_inbox_kpi.

    Chạy trong worker thread (asyncio.to_thread) để 4 câu lệnh Supabase sync không bao giờ
    block event loop chính của FastAPI khi nhân viên gửi tin nhắn/ghi âm/file liên tục.
    """
    if not caller_email:
        return

    def _sync_track() -> None:
        from app.modules.all_platform.services.supabase_kpi_service import get_supabase_client
        from app.modules.all_platform.services.zalo_inbox_kpi_service import on_staff_reply_message

        supabase = get_supabase_client()
        clean_email = caller_email.strip().lower()
        user_res = supabase.table("app_users").select("id").eq("email", clean_email).limit(1).execute()
        if not user_res.data:
            return
        member_id = str(user_res.data[0]["id"])

        # Ghi nhận & kiểm tra KPI 2 chiều trong zalo_inbox_kpi
        on_staff_reply_message(
            account_id=account_id,
            conversation_id=conversation_id,
            caller_email=clean_email,
            supabase=supabase,
        )

        # Cập nhật share permission cho tất cả leader của member (nếu chưa từng share, tạo is_verify=False)
        leader_ids: List[str] = []
        try:
            team_res = supabase.table("member_of_teams").select("teams(id_leader)").eq("id_member", member_id).execute()
            for row in (team_res.data or []):
                t = row.get("teams")
                if isinstance(t, dict) and t.get("id_leader"):
                    leader_ids.append(str(t["id_leader"]))
        except Exception:
            pass
        if not leader_ids:
            leader_ids = [member_id]

        now_iso = datetime.now(timezone.utc).isoformat()
        upsert_rows = [
            {
                "account_id": account_id,
                "conversation_id": conversation_id,
                "shared_role": "leader",
                "is_active": True,
                "id_member": member_id,
                "id_leader": lid,
                "updated_at": now_iso,
            }
            for lid in dict.fromkeys(leader_ids)
        ]
        supabase.table("zalo_conversation_permissions").upsert(
            upsert_rows,
            on_conflict="account_id,conversation_id,shared_role,id_leader",
        ).execute()

    try:
        await asyncio.to_thread(_sync_track)
    except Exception as exc:
        logger.warning(f"Could not auto-track zalo conversation sender ({caller_email}): {exc}")


async def _run_post_send_side_effects(
    user_id: str,
    conversation_id: str,
    caller_email: Optional[str],
) -> None:
    """Thực thi các tác vụ hậu kỳ sau khi gửi tin (tạm dừng bot, tính KPI 2 chiều, đánh thức listener)
    mà không chặn response HTTP về trình duyệt.
    """
    try:
        await note_staff_reply(user_id, conversation_id, caller_email)
    except Exception as exc:
        logger.debug(f"note_staff_reply failed for user={user_id}: {exc}")

    await _auto_track_zalo_conversation_sender(user_id, conversation_id, caller_email)

    try:
        listener_info = get_listener_status(user_id)
        if not listener_info.get("running") and not listener_info.get("auth_expired"):
            await restart_listener(user_id)
    except Exception:
        pass


def _schedule_post_send_side_effects(
    user_id: str,
    conversation_id: str,
    caller_email: Optional[str],
) -> None:
    asyncio.create_task(_run_post_send_side_effects(user_id, conversation_id, caller_email))


@router.post("/{conversation_id}/send", response_model=SendMessageResponse)
async def send_message_to_conversation(
    conversation_id: str,
    body: SendMessageRequest,
    account_id: Optional[str] = Query(None),
    x_user_id: str = Header("default", alias="X-User-ID"),
    # Trước đây trực tiếp tin header X-Caller-Email client tự gửi (lấy từ
    # localStorage — ai cũng sửa được bằng DevTools để mạo danh leader/admin
    # bất kỳ). Giờ lấy từ JWT đã xác thực (cookie crawlpro_access_token).
    x_caller_email: Optional[str] = Depends(get_authenticated_caller_email),
    caller_user: Optional[dict[str, Any]] = Depends(get_authenticated_caller_user),
):
    """Gửi tin nhắn văn bản trực tiếp vào một hội thoại Zalo qua ZCA API.

    - ``conversation_id`` là ID group hoặc thread cá nhân trong Supabase.
    - Nếu ``thread_type`` không được chỉ指定, endpoint tự suy ra:
      số nguyên thuần túy → nhóm (type=1), còn lại → cá nhân (type=0).
    - Sau khi Zalo xác nhận gửi thành công, message sẽ được lưu vào Supabase để
      hiển thị ngay trong lịch sử chat (kể cả khi listener chưa kịp echo về).
    """
    user_id = _normalize_user_id(account_id or x_user_id)
    # Check access permission
    allowed_conv_ids = await check_caller_conversation_access(user_id, x_caller_email)
    if allowed_conv_ids is not None and conversation_id.strip() not in allowed_conv_ids:
        raise HTTPException(
            status_code=403,
            detail="Cuộc trò chuyện này ở chế độ riêng tư và chưa được chia sẻ với bạn."
        )

    auth = await load_zca_auth(user_id)
    if not auth:
        raise HTTPException(
            status_code=401,
            detail="Chưa có phiên ZCA hợp lệ. Hãy đăng nhập Zalo qua Chrome Extension trước.",
        )

    # Infer thread_type from conversation_id when not explicitly provided
    if body.thread_type is not None:
        thread_type = body.thread_type
    else:
        thread_type = await resolve_thread_type(user_id, conversation_id.strip())

    mentions_payload = [m.model_dump() for m in body.mentions] if body.mentions else None
    quote_payload = None
    if body.reply_to:
        # Đúng shape SendMessageQuote của zca-js (node_modules/zca-js/dist/apis/sendMessage.d.ts):
        # {content, msgType, uidFrom, msgId, cliMsgId, ts, ttl} — cố tình bỏ propertyExt
        # (không bắt buộc ở runtime dù type khai là required) và ép content về string,
        # tránh đúng lỗi zca-js throw với content không phải string + msgType "webchat".
        quote_payload = {
            "msgId": body.reply_to.message_id.strip(),
            "cliMsgId": (body.reply_to.cli_msg_id or "").strip() or None,
            "uidFrom": (body.reply_to.sender_id or "").strip() or None,
            "ts": body.reply_to.ts,
            "content": str(body.reply_to.content or ""),
        }
    try:
        result = await send_zca_message(
            auth,
            conversation_id.strip(),
            body.text.strip(),
            thread_type=thread_type,
            mentions=mentions_payload,
            quote=quote_payload,
        )
    except ZcaAuthExpiredError:
        raise HTTPException(status_code=401, detail=ZCA_SESSION_EXPIRED_DETAIL)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Không thể gửi tin nhắn: {exc}")

    # Persist sent message vào Supabase — zca-js chỉ trả về msgId (không có sender/timestamp)
    # nên ta tạo Message tối thiểu với is_sent=True, listener sẽ tự merge khi echo về
    # (cli_msg_id cũng được listener điền bù lúc echo — zca-js.sendMessage() không trả
    # cliMsgId ngay, chỉ có msgId; xem zca_persistent_listener.js normalizeMessage()).
    # "response" là key chuẩn (zca_api_bridge.js + zca_api_server.js, đã đồng bộ
    # 2026-08-26); vẫn thử "result" phòng hộ nếu 1 worker cũ chưa restart kịp
    # còn trả key cũ — tránh lại rơi vào fallback ID tạm gây lặp tin.
    api_payload = result.get("response") or result.get("result") if isinstance(result, dict) else None
    staff_name = getattr(body, "staff_name", None)
    staff_avatar = getattr(body, "staff_avatar", None)
    resolved_staff_name = (
        staff_name
        or (caller_user.get("name") if caller_user else None)
        or (x_caller_email.split("@")[0] if x_caller_email else None)
    )
    resolved_staff_email = x_caller_email or (caller_user.get("email") if caller_user else None)
    resolved_staff_avatar = (
        staff_avatar
        or (caller_user.get("avatar_url") or caller_user.get("avatar") if caller_user else None)
    )
    raw_staff_override = {
        "staff_name": resolved_staff_name,
        "staff_email": resolved_staff_email,
        "staff_avatar": resolved_staff_avatar,
        "sender_staff": {
            "name": resolved_staff_name,
            "email": resolved_staff_email,
            "avatar": resolved_staff_avatar,
        },
    }
    await _persist_outgoing_message(
        user_id,
        conversation_id.strip(),
        api_payload,
        content=body.text.strip(),
        message_type="text",
        mentions=body.mentions,
        reply_to_id=body.reply_to.message_id.strip() if body.reply_to else None,
        raw_content_override=raw_staff_override,
    )
    # Chạy hậu kỳ (tạm dừng Bot + lưu vết KPI 2 chiều + đánh thức listener) bất đồng bộ để phản hồi tức thì
    _schedule_post_send_side_effects(user_id, conversation_id.strip(), x_caller_email)

    return SendMessageResponse(
        ok=True,
        conversation_id=conversation_id,
        message=result.get("message") or "Đã gửi tin nhắn thành công",
    )


@router.post("/{conversation_id}/send-media", response_model=SendMessageResponse)
async def send_media_to_conversation(
    conversation_id: str,
    text: Optional[str] = Form(None),
    thread_type: Optional[int] = Form(None),
    staff_name: Optional[str] = Form(None),
    staff_avatar: Optional[str] = Form(None),
    files: List[UploadFile] = File(...),
    account_id: Optional[str] = Query(None),
    x_user_id: str = Header("default", alias="X-User-ID"),
    # Trước đây trực tiếp tin header X-Caller-Email client tự gửi (lấy từ
    # localStorage — ai cũng sửa được bằng DevTools để mạo danh leader/admin
    # bất kỳ). Giờ lấy từ JWT đã xác thực (cookie crawlpro_access_token).
    x_caller_email: Optional[str] = Depends(get_authenticated_caller_email),
    caller_user: Optional[dict[str, Any]] = Depends(get_authenticated_caller_user),
):
    """Gửi hình ảnh hoặc tài liệu kèm chữ vào một hội thoại Zalo qua ZCA API."""
    user_id = _normalize_user_id(account_id or x_user_id)
    # Check access permission
    allowed_conv_ids = await check_caller_conversation_access(user_id, x_caller_email)
    if allowed_conv_ids is not None and conversation_id.strip() not in allowed_conv_ids:
        raise HTTPException(
            status_code=403,
            detail="Cuộc trò chuyện này ở chế độ riêng tư và chưa được chia sẻ với bạn."
        )

    auth = await load_zca_auth(user_id)
    if not auth:
        raise HTTPException(
            status_code=401,
            detail="Chưa có phiên ZCA hợp lệ. Hãy đăng nhập Zalo qua Chrome Extension trước.",
        )

    if thread_type is not None:
        ttype = thread_type
    else:
        ttype = await resolve_thread_type(user_id, conversation_id.strip())

    temp_paths: List[str] = []
    try:
        for file in files:
            orig_ext = os.path.splitext(file.filename or "")[1] or ".jpg"
            fd, path = tempfile.mkstemp(prefix="zalo-zca-upload-", suffix=orig_ext)
            content = await file.read()
            with os.fdopen(fd, "wb") as tmp:
                tmp.write(content)
            temp_paths.append(path)

        try:
            result = await send_zca_images(
                auth,
                conversation_id.strip(),
                temp_paths,
                text=text.strip() if text else "",
                thread_type=ttype,
            )
        except ZcaAuthExpiredError:
            raise HTTPException(status_code=401, detail=ZCA_SESSION_EXPIRED_DETAIL)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Không thể gửi file: {exc}")

        # Upload file/ảnh đã gửi lên Supabase storage để hiển thị trong lịch sử chat
        # (zca-js không trả URL persistent, chỉ trả msgId).
        uploaded_urls: List[str] = []
        uploaded_assets: List[Dict[str, str]] = []
        all_images = True
        _IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".svg"}
        try:
            import mimetypes

            from app.modules.all_platform.zalo.services.supabase_service import (
                _download_image,
                upload_asset_bytes,
            )
            for idx, path in enumerate(temp_paths):
                try:
                    with open(path, "rb") as f:
                        file_bytes = f.read()
                    # Lấy extension từ file gốc
                    orig_name = files[idx].filename if idx < len(files) else None
                    ext = os.path.splitext(orig_name or path)[1] or ".jpg"
                    if ext.lower() not in _IMAGE_EXTS:
                        all_images = False
                    # Trước đây hard-code content_type về "image/jpeg" cho MỌI phần mở
                    # rộng lạ (pdf, docx, zip...) — file lưu trong storage với
                    # Content-Type sai, và msg_kind bị ép thành "image" khiến FE vẽ
                    # <img> cho 1 file không phải ảnh -> hiện icon ảnh vỡ. Dùng
                    # mimetypes để suy ra đúng content-type theo tên file thật.
                    content_type = mimetypes.guess_type(orig_name or path)[0] or "application/octet-stream"
                    storage_path = posixpath.join(
                        user_id,
                        "outgoing",
                        f"{uuid.uuid4().hex}{ext}",
                    )
                    url = await upload_asset_bytes(storage_path, file_bytes, content_type)
                    uploaded_urls.append(url)
                    # Đã có sẵn URL + path trong storage của mình (vừa upload xong) —
                    # ghi thẳng vào zalo_message_assets bên dưới, KHÔNG để
                    # save_message_assets() tải lại CHÍNH url này về rồi upload lại
                    # lần 2 (lãng phí, và từng lỗi im lặng khi bucket zalo-assets
                    # chưa tồn tại — ảnh mình tự gửi không hiện ra được).
                    uploaded_assets.append({
                        "source_url": url,
                        "storage_path": storage_path,
                        "storage_url": url,
                    })
                except Exception as exc:
                    logger.warning(f"Could not persist outgoing Zalo image {path}: {exc}")
        except Exception as exc:
            logger.warning(f"Could not import supabase helpers for media upload: {exc}")

        # Lưu message đã gửi vào Supabase
        # "response" là key chuẩn (zca_api_bridge.js + zca_api_server.js, đã đồng bộ
        # 2026-08-26); vẫn thử "result" phòng hộ nếu 1 worker cũ chưa restart kịp
        # còn trả key cũ — tránh lại rơi vào fallback ID tạm gây lặp tin.
        api_payload = result.get("response") or result.get("result") if isinstance(result, dict) else None
        resolved_staff_name = (
            staff_name
            or (caller_user.get("name") if caller_user else None)
            or (x_caller_email.split("@")[0] if x_caller_email else None)
        )
        resolved_staff_email = x_caller_email or (caller_user.get("email") if caller_user else None)
        resolved_staff_avatar = (
            staff_avatar
            or (caller_user.get("avatar_url") or caller_user.get("avatar") if caller_user else None)
        )
        raw_staff_override = {
            "staff_name": resolved_staff_name,
            "staff_email": resolved_staff_email,
            "staff_avatar": resolved_staff_avatar,
            "sender_staff": {
                "name": resolved_staff_name,
                "email": resolved_staff_email,
                "avatar": resolved_staff_avatar,
            },
        }
        caption = text.strip() if text else ""
        if not caption and not all_images:
            # File thường không có chữ kèm — dùng tên file thật làm content, giống
            # đúng cách listener làm cho file NHẬN được (xem comment fileNameHint ở
            # zca_persistent_listener.js), để FE hiện đúng tên thay vì tên ngẫu
            # nhiên UUID của storage_path.
            orig_names = [f.filename for f in files if f.filename]
            caption = ", ".join(orig_names)[:150]
        await _persist_outgoing_message(
            user_id,
            conversation_id.strip(),
            api_payload,
            content=caption,
            # Chỉ ép "image" khi THẬT SỰ toàn ảnh — file thường (pdf/docx/zip...) phải
            # để "file" để FE hiện thẻ tên-file+tải-về thay vì <img> vỡ (xem comment
            # classifyAssetKind trong ZaloInboxAdminShell.tsx — URL không đúng đuôi
            # ảnh + msg_kind=image mới là tổ hợp gây vỡ ảnh).
            message_type="image" if all_images and uploaded_urls else "file",
            image_urls=uploaded_urls,
            uploaded_assets=uploaded_assets,
            raw_content_override=raw_staff_override,
        )
        _schedule_post_send_side_effects(user_id, conversation_id.strip(), x_caller_email)

        return SendMessageResponse(
            ok=True,
            conversation_id=conversation_id,
            message=result.get("message") or "Đã gửi file thành công",
        )
    finally:
        for path in temp_paths:
            try:
                os.remove(path)
            except OSError:
                pass


@router.post("/{conversation_id}/send-voice", response_model=SendMessageResponse)
async def send_voice_to_conversation(
    conversation_id: str,
    thread_type: Optional[int] = Form(None),
    staff_name: Optional[str] = Form(None),
    staff_avatar: Optional[str] = Form(None),
    duration_sec: Optional[float] = Form(None),
    file: UploadFile = File(...),
    account_id: Optional[str] = Query(None),
    x_user_id: str = Header("default", alias="X-User-ID"),
    x_caller_email: Optional[str] = Depends(get_authenticated_caller_email),
    caller_user: Optional[dict[str, Any]] = Depends(get_authenticated_caller_user),
):
    """Ghi âm và gửi tin nhắn thoại (Voice Note) chuẩn âm thanh trong trẻo trực tiếp vào hội thoại Zalo."""
    user_id = _normalize_user_id(account_id or x_user_id)
    allowed_conv_ids = await check_caller_conversation_access(user_id, x_caller_email)
    if allowed_conv_ids is not None and conversation_id.strip() not in allowed_conv_ids:
        raise HTTPException(
            status_code=403,
            detail="Cuộc trò chuyện này ở chế độ riêng tư và chưa được chia sẻ với bạn.",
        )

    auth = await load_zca_auth(user_id)
    if not auth:
        raise HTTPException(
            status_code=401,
            detail="Chưa có phiên ZCA hợp lệ. Hãy đăng nhập Zalo qua Chrome Extension trước.",
        )

    ttype = thread_type if thread_type is not None else await resolve_thread_type(user_id, conversation_id.strip())
    temp_paths: List[str] = []
    try:
        orig_ext = (os.path.splitext(file.filename or "")[1] or ".m4a").lower()
        if orig_ext not in {".m4a", ".mp4", ".aac", ".mp3", ".webm", ".ogg", ".wav"}:
            orig_ext = ".m4a"

        fd, raw_path = tempfile.mkstemp(prefix="zalo-voice-in-", suffix=orig_ext)
        raw_bytes = await file.read()
        if not raw_bytes:
            raise HTTPException(status_code=400, detail="File ghi âm trống.")
        with os.fdopen(fd, "wb") as tmp:
            tmp.write(raw_bytes)
        temp_paths.append(raw_path)

        send_path = raw_path
        send_ext = orig_ext
        # Chuẩn hóa sang AAC .m4a 48kHz mono nếu trình duyệt gửi .webm/.ogg/.wav và máy chủ có sẵn ffmpeg
        if orig_ext in {".webm", ".ogg", ".wav"} and shutil.which("ffmpeg"):
            fd_out, m4a_path = tempfile.mkstemp(prefix="zalo-voice-out-", suffix=".m4a")
            os.close(fd_out)
            temp_paths.append(m4a_path)
            try:
                proc = await asyncio.create_subprocess_exec(
                    "ffmpeg",
                    "-y",
                    "-i",
                    raw_path,
                    "-vn",
                    "-ac",
                    "1",
                    "-ar",
                    "48000",
                    "-c:a",
                    "aac",
                    "-b:a",
                    "96k",
                    "-movflags",
                    "+faststart",
                    m4a_path,
                    stdout=asyncio.subprocess.DEVNULL,
                    stderr=asyncio.subprocess.DEVNULL,
                )
                await asyncio.wait_for(proc.wait(), timeout=15.0)
                if proc.returncode == 0 and os.path.exists(m4a_path) and os.path.getsize(m4a_path) > 0:
                    send_path = m4a_path
                    send_ext = ".m4a"
            except Exception as trans_exc:
                logger.debug(f"ffmpeg voice transcode skipped ({trans_exc}); sending original audio")

        with open(send_path, "rb") as vf:
            final_bytes = vf.read()

        storage_url: Optional[str] = None
        uploaded_assets: List[Dict[str, str]] = []
        try:
            from app.modules.all_platform.zalo.services.supabase_service import upload_asset_bytes

            mime_map = {
                ".m4a": "audio/mp4",
                ".mp4": "audio/mp4",
                ".aac": "audio/aac",
                ".mp3": "audio/mpeg",
                ".ogg": "audio/ogg",
                ".wav": "audio/wav",
                ".webm": "audio/webm",
            }
            content_type = mime_map.get(send_ext, "audio/mp4")
            storage_path = posixpath.join(user_id, "outgoing", f"voice-{uuid.uuid4().hex}{send_ext}")
            storage_url = await upload_asset_bytes(storage_path, final_bytes, content_type)
            uploaded_assets.append({
                "source_url": storage_url,
                "storage_path": storage_path,
                "storage_url": storage_url,
            })
        except Exception as up_exc:
            logger.warning(f"Could not upload voice backup to Supabase storage: {up_exc}")

        try:
            result = await send_zca_voice(
                auth,
                conversation_id.strip(),
                send_path,
                voice_url=storage_url,
                thread_type=ttype,
            )
        except ZcaAuthExpiredError:
            raise HTTPException(status_code=401, detail=ZCA_SESSION_EXPIRED_DETAIL)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Không thể gửi ghi âm thoại Zalo: {exc}")

        api_payload = result.get("response") or result.get("result") if isinstance(result, dict) else None
        zca_voice_url = (result.get("voice_url") if isinstance(result, dict) else None) or storage_url
        playback_url = storage_url or zca_voice_url

        resolved_staff_name = (
            staff_name
            or (caller_user.get("name") if caller_user else None)
            or (x_caller_email.split("@")[0] if x_caller_email else None)
        )
        resolved_staff_email = x_caller_email or (caller_user.get("email") if caller_user else None)
        resolved_staff_avatar = (
            staff_avatar
            or (caller_user.get("avatar_url") or caller_user.get("avatar") if caller_user else None)
        )
        dur_label = f" ({int(round(duration_sec))}s)" if duration_sec and duration_sec > 0 else ""
        raw_staff_override: Dict[str, Any] = {
            "staff_name": resolved_staff_name,
            "staff_email": resolved_staff_email,
            "staff_avatar": resolved_staff_avatar,
            "sender_staff": {
                "name": resolved_staff_name,
                "email": resolved_staff_email,
                "avatar": resolved_staff_avatar,
            },
            "voiceUrl": playback_url,
            "m4aUrl": playback_url,
            "duration_sec": round(float(duration_sec), 1) if duration_sec else None,
        }

        await _persist_outgoing_message(
            user_id,
            conversation_id.strip(),
            api_payload,
            content=f"[Tin nhắn thoại{dur_label}]",
            message_type="chat.voice",
            image_urls=[playback_url] if playback_url else None,
            uploaded_assets=uploaded_assets if uploaded_assets else None,
            raw_content_override=raw_staff_override,
        )
        _schedule_post_send_side_effects(user_id, conversation_id.strip(), x_caller_email)

        return SendMessageResponse(
            ok=True,
            conversation_id=conversation_id,
            message="Đã gửi tin nhắn thoại thành công",
        )
    finally:
        for path in temp_paths:
            try:
                os.remove(path)
            except OSError:
                pass


class MarkReadResponse(BaseModel):
    ok: bool
    conversation_id: str
    message: str = ""


async def _background_remove_zca_unread(user_id: str, conversation_id: str, thread_type: int):
    auth = await load_zca_auth(user_id)
    if auth:
        try:
            await remove_zca_unread_mark(auth, conversation_id, thread_type=thread_type)
        except Exception as exc:
            logger.warning(f"Could not remove unread mark on Zalo for user={user_id} conversation={conversation_id}: {exc}")


@router.post("/{conversation_id}/read", response_model=MarkReadResponse)
async def mark_conversation_read(
    conversation_id: str,
    background_tasks: BackgroundTasks,
    account_id: Optional[str] = Query(None),
    x_user_id: str = Header("default", alias="X-User-ID"),
    # Trước đây trực tiếp tin header X-Caller-Email client tự gửi (lấy từ
    # localStorage — ai cũng sửa được bằng DevTools để mạo danh leader/admin
    # bất kỳ). Giờ lấy từ JWT đã xác thực (cookie crawlpro_access_token).
    x_caller_email: Optional[str] = Depends(get_authenticated_caller_email),
    caller_user: Optional[dict[str, Any]] = Depends(get_authenticated_caller_user),
):
    """Đánh dấu hội thoại là đã đọc. Cập nhật trong Supabase và thông báo ZCA (nếu đăng nhập)."""
    user_id = _normalize_user_id(account_id or x_user_id)
    # Check access permission
    allowed_conv_ids = await check_caller_conversation_access(user_id, x_caller_email)
    if allowed_conv_ids is not None and conversation_id.strip() not in allowed_conv_ids:
        raise HTTPException(
            status_code=403,
            detail="Cuộc trò chuyện này ở chế độ riêng tư và chưa được chia sẻ với bạn."
        )
    
    # 1. Update in Supabase
    try:
        await mark_conversation_as_read(user_id, conversation_id.strip())
    except Exception as exc:
        logger.warning(f"Could not update unread count in Supabase for user={user_id} conversation={conversation_id}: {exc}")

    # 2. Inform Zalo via ZCA if auth is available (trong background để tránh treo request)
    thread_type = await resolve_thread_type(user_id, conversation_id.strip())
    background_tasks.add_task(_background_remove_zca_unread, user_id, conversation_id.strip(), thread_type)

    return MarkReadResponse(
        ok=True,
        conversation_id=conversation_id,
        message="Hội thoại đã được đánh dấu là đã đọc"
    )


class SetConversationTagRequest(BaseModel):
    tag: Optional[str] = Field(None, max_length=50, description="Tên tag phân loại khách, null để xoá tag")


@router.patch("/{conversation_id}/tag")
async def set_conversation_tag(
    conversation_id: str,
    body: SetConversationTagRequest,
    account_id: Optional[str] = Query(None),
    x_user_id: str = Header("default", alias="X-User-ID"),
):
    """Gắn/đổi/bỏ tag phân loại khách cho 1 hội thoại — lưu server-side trên
    zalo_groups.tag (migration 139), thay cho localStorage cũ (chỉ 1 máy thấy
    được, không đồng bộ giữa các nhân viên cùng quản lý 1 tài khoản Zalo).
    """
    user_id = _normalize_user_id(account_id or x_user_id)
    tag = (body.tag or "").strip() or None
    try:
        await _rest(
            "PATCH",
            "zalo_groups",
            params={"user_id": f"eq.{user_id}", "group_id": f"eq.{conversation_id.strip()}"},
            json={"tag": tag},
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Không thể lưu tag: {exc}")
    return {"ok": True, "conversation_id": conversation_id, "tag": tag}


class ForwardMessageRequest(BaseModel):
    source_message_id: str = Field(..., min_length=1, description="zalo_messages.source_message_id của tin cần chuyển tiếp")
    target_conversation_ids: List[str] = Field(..., min_length=1, max_length=20, description="Danh sách hội thoại đích (tối đa 20)")


class ForwardMessageResult(BaseModel):
    conversation_id: str
    ok: bool
    error: Optional[str] = None


class ForwardMessageResponse(BaseModel):
    ok: bool
    results: List[ForwardMessageResult]


@router.post("/{conversation_id}/forward", response_model=ForwardMessageResponse)
async def forward_conversation_message(
    conversation_id: str,
    body: ForwardMessageRequest,
    account_id: Optional[str] = Query(None),
    x_user_id: str = Header("default", alias="X-User-ID"),
    x_caller_email: Optional[str] = Depends(get_authenticated_caller_email),
    caller_user: Optional[dict[str, Any]] = Depends(get_authenticated_caller_user),
):
    """Chuyển tiếp 1 tin nhắn (chữ hoặc ảnh) sang N hội thoại khác.

    KHÔNG dùng zca-js ``api.forwardMessage()`` thật (API này không mang được
    @mentions và cần đúng shape "message object" phức tạp của Zalo — xem ghi chú
    tham khảo trong PR) — thay vào đó GỬI LẠI content/ảnh như 1 tin nhắn MỚI ở
    từng đích, giống hệt cách nút "Chuyển tiếp" thủ công hoạt động trên các
    client Zalo khác. Đơn giản hơn, không phụ thuộc shape nội bộ hay bị Zalo
    đổi API, đánh đổi là tin đến nơi KHÔNG có tag "Đã chuyển tiếp" (chấp nhận
    được, đã ghi chú rõ đây là lựa chọn có chủ đích).
    """
    user_id = _normalize_user_id(account_id or x_user_id)
    allowed_conv_ids = await check_caller_conversation_access(user_id, x_caller_email)
    if allowed_conv_ids is not None and conversation_id.strip() not in allowed_conv_ids:
        raise HTTPException(status_code=403, detail="Cuộc trò chuyện này ở chế độ riêng tư và chưa được chia sẻ với bạn.")

    auth = await load_zca_auth(user_id)
    if not auth:
        raise HTTPException(status_code=401, detail="Chưa có phiên ZCA hợp lệ. Hãy đăng nhập lại qua extension.")

    rows = await _rest(
        "GET",
        "zalo_messages",
        params={
            "select": "content,type,msg_kind,is_deleted,assets:zalo_message_assets(storage_path,storage_url,status)",
            "user_id": f"eq.{user_id}",
            "group_id": f"eq.{conversation_id.strip()}",
            "source_message_id": f"eq.{body.source_message_id.strip()}",
            "limit": "1",
        },
    ) or []
    if not rows:
        raise HTTPException(status_code=404, detail="Không tìm thấy tin nhắn để chuyển tiếp.")
    row = rows[0]
    if row.get("is_deleted"):
        raise HTTPException(status_code=409, detail="Tin nhắn này đã bị thu hồi, không thể chuyển tiếp.")

    from app.modules.all_platform.zalo.services.zca_broadcast_sender import _asset_to_temp_file, _uploaded_assets

    content = (row.get("content") or "").strip()
    uploaded_assets = _uploaded_assets(row)
    msg_kind = row.get("msg_kind") or row.get("type") or "text"
    if not content and not uploaded_assets:
        raise HTTPException(
            status_code=400,
            detail=f"Loại tin nhắn này ({msg_kind}) chưa hỗ trợ chuyển tiếp — chỉ hỗ trợ tin nhắn có chữ hoặc ảnh.",
        )

    target_ids = [t.strip() for t in body.target_conversation_ids if t and t.strip()]
    if not target_ids:
        raise HTTPException(status_code=400, detail="Chưa chọn hội thoại đích.")

    results: List[ForwardMessageResult] = []
    for target_id in target_ids:
        temp_paths: List[str] = []
        try:
            target_thread_type = await resolve_thread_type(user_id, target_id)
            persisted_assets: Optional[List[Dict[str, str]]] = None
            if uploaded_assets:
                temp_paths = [await _asset_to_temp_file(asset) for asset in uploaded_assets]
                api_result = await send_zca_images(
                    auth, target_id, temp_paths, text=content, thread_type=target_thread_type,
                )
                image_urls = [a.get("storage_url") for a in uploaded_assets if a.get("storage_url")]
                message_type = "image"
                # Tái dùng storage_url gốc (đã có sẵn trong bucket của mình) cho tin
                # nhắn mới — tránh save_listener_messages() tải lại chính url này
                # qua save_message_assets() (cùng lỗi tự-tải-lại đã sửa ở gửi ảnh mới).
                persisted_assets = [
                    {"source_url": a["storage_url"], "storage_path": a.get("storage_path") or "", "storage_url": a["storage_url"]}
                    for a in uploaded_assets if a.get("storage_url")
                ]
            else:
                api_result = await send_zca_message(auth, target_id, content, thread_type=target_thread_type)
                image_urls = None
                message_type = "text"

            api_payload = (
                api_result.get("response") or api_result.get("result")
                if isinstance(api_result, dict) else None
            )
            await _persist_outgoing_message(
                user_id, target_id, api_payload,
                content=content, message_type=message_type, image_urls=image_urls,
                uploaded_assets=persisted_assets,
            )
            results.append(ForwardMessageResult(conversation_id=target_id, ok=True))
        except ZcaAuthExpiredError:
            raise HTTPException(status_code=401, detail=ZCA_SESSION_EXPIRED_DETAIL)
        except Exception as exc:
            logger.warning(f"Forward message failed for target={target_id}: {exc}")
            results.append(ForwardMessageResult(conversation_id=target_id, ok=False, error=str(exc)))
        finally:
            for p in temp_paths:
                try:
                    os.remove(p)
                except Exception:
                    pass

    return ForwardMessageResponse(ok=all(r.ok for r in results), results=results)


class RecallMessageRequest(BaseModel):
    source_message_id: str = Field(..., min_length=1, description="zalo_messages.source_message_id (= msgId thật)")
    thread_type: Optional[int] = Field(None, description="0 = cá nhân, 1 = nhóm. Nếu trống, tự suy ra.")


class RecallMessageResponse(BaseModel):
    ok: bool
    conversation_id: str
    source_message_id: str


@router.post("/{conversation_id}/recall", response_model=RecallMessageResponse)
async def recall_conversation_message(
    conversation_id: str,
    body: RecallMessageRequest,
    account_id: Optional[str] = Query(None),
    x_user_id: str = Header("default", alias="X-User-ID"),
    x_caller_email: Optional[str] = Depends(get_authenticated_caller_email),
    caller_user: Optional[dict[str, Any]] = Depends(get_authenticated_caller_user),
):
    """Thu hồi tin nhắn thật (api.undo — Mục 3.3.5 guide) — tin biến mất ở CẢ HAI phía.

    Chỉ cho phép thu hồi tin do CHÍNH tài khoản Zalo này gửi (is_sent=true) và
    còn `cli_msg_id` (được listener điền bù ngay sau khi gửi — xem
    `_persist_outgoing_message`/`zca_persistent_listener.js`); tin cũ gửi TRƯỚC
    khi có cột này, hoặc tin gửi rất gần đây mà listener chưa kịp echo về, sẽ
    trả 409 để user thử lại sau vài giây thay vì âm thầm gọi undo() với
    cli_msg_id rỗng (Zalo sẽ từ chối).
    """
    user_id = _normalize_user_id(account_id or x_user_id)
    allowed_conv_ids = await check_caller_conversation_access(user_id, x_caller_email)
    if allowed_conv_ids is not None and conversation_id.strip() not in allowed_conv_ids:
        raise HTTPException(status_code=403, detail="Cuộc trò chuyện này ở chế độ riêng tư và chưa được chia sẻ với bạn.")

    auth = await load_zca_auth(user_id)
    if not auth:
        raise HTTPException(status_code=401, detail="Chưa có phiên ZCA hợp lệ. Hãy đăng nhập lại qua extension.")

    rows = await _rest(
        "GET",
        "zalo_messages",
        params={
            "select": "source_message_id,cli_msg_id,is_sent,is_deleted",
            "user_id": f"eq.{user_id}",
            "group_id": f"eq.{conversation_id.strip()}",
            "source_message_id": f"eq.{body.source_message_id.strip()}",
            "limit": "1",
        },
    ) or []
    if not rows:
        raise HTTPException(status_code=404, detail="Không tìm thấy tin nhắn này.")
    row = rows[0]
    if not row.get("is_sent"):
        raise HTTPException(status_code=403, detail="Chỉ được thu hồi tin nhắn do chính tài khoản này gửi.")
    if row.get("is_deleted"):
        raise HTTPException(status_code=409, detail="Tin nhắn này đã bị thu hồi trước đó.")
    cli_msg_id = row.get("cli_msg_id")
    if not cli_msg_id:
        raise HTTPException(
            status_code=409,
            detail="Chưa xác định được cli_msg_id của tin nhắn (có thể vừa gửi, đợi vài giây rồi thử lại).",
        )

    thread_type = body.thread_type if body.thread_type is not None else await resolve_thread_type(user_id, conversation_id.strip())
    try:
        await recall_zca_message(
            auth,
            conversation_id.strip(),
            msg_id=body.source_message_id.strip(),
            cli_msg_id=str(cli_msg_id),
            thread_type=thread_type,
        )
    except ZcaAuthExpiredError:
        raise HTTPException(status_code=401, detail=ZCA_SESSION_EXPIRED_DETAIL)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Không thể thu hồi tin nhắn: {exc}")

    try:
        await _rest(
            "PATCH",
            "zalo_messages",
            params={
                "user_id": f"eq.{user_id}",
                "group_id": f"eq.{conversation_id.strip()}",
                "source_message_id": f"eq.{body.source_message_id.strip()}",
            },
            json={"is_deleted": True, "updated_at": datetime.utcnow().isoformat()},
        )
    except Exception as exc:
        logger.warning(f"Recalled on Zalo but could not mark is_deleted in DB: {exc}")

    invalidate_conversation_message_cache(user_id, conversation_id.strip())

    try:
        from app.modules.all_platform.zalo.services.message_events import publish_zalo_message_event
        await publish_zalo_message_event(
            user_id,
            {
                "type": "message_recalled",
                "account_id": user_id,
                "group_id": conversation_id.strip(),
                "source_message_id": body.source_message_id.strip(),
            },
        )
    except Exception as ev_exc:
        logger.warning(f"Could not publish recall event: {ev_exc}")

    return RecallMessageResponse(ok=True, conversation_id=conversation_id, source_message_id=body.source_message_id)


@router.delete("/{conversation_id}")
async def delete_conversation(
    conversation_id: str,
    account_id: Optional[str] = Query(None),
    x_user_id: str = Header("default", alias="X-User-ID"),
    x_caller_email: Optional[str] = Depends(get_authenticated_caller_email),
    caller_user: Optional[dict[str, Any]] = Depends(get_authenticated_caller_user),
):
    """Xóa cuộc trò chuyện khỏi sidebar và dọn dẹp tin nhắn trong DB."""
    user_id = _normalize_user_id(account_id or x_user_id)
    cid = conversation_id.strip()

    try:
        await _rest(
            "DELETE",
            "zalo_groups",
            params={
                "user_id": f"eq.{user_id}",
                "group_id": f"eq.{cid}",
            },
        )
        await _rest(
            "DELETE",
            "zalo_messages",
            params={
                "user_id": f"eq.{user_id}",
                "group_id": f"eq.{cid}",
            },
        )
    except Exception as exc:
        logger.warning(f"Error deleting conversation {cid} for user={user_id}: {exc}")
        raise HTTPException(status_code=500, detail=f"Không thể xóa cuộc trò chuyện: {exc}")

    invalidate_conversation_message_cache(user_id, cid)

    try:
        from app.modules.all_platform.zalo.services.message_events import publish_zalo_message_event
        await publish_zalo_message_event(
            user_id,
            {
                "type": "conversation_deleted",
                "account_id": user_id,
                "group_id": cid,
            },
        )
    except Exception as ev_exc:
        logger.warning(f"Could not publish conversation_deleted event: {ev_exc}")

    return {"ok": True, "conversation_id": cid}


@router.delete("/{conversation_id}/messages/{message_id}")
async def delete_conversation_message(
    conversation_id: str,
    message_id: str,
    recall: bool = Query(False, description="True = thu hồi cả hai phía, False = xóa ở phía tôi"),
    account_id: Optional[str] = Query(None),
    x_user_id: str = Header("default", alias="X-User-ID"),
    x_caller_email: Optional[str] = Depends(get_authenticated_caller_email),
    caller_user: Optional[dict[str, Any]] = Depends(get_authenticated_caller_user),
):
    """Xóa tin nhắn: Xóa ở phía tôi (local DB delete) hoặc Thu hồi (api.undo hai phía)."""
    user_id = _normalize_user_id(account_id or x_user_id)
    cid = conversation_id.strip()
    mid = message_id.strip()

    if recall:
        req = RecallMessageRequest(source_message_id=mid)
        return await recall_conversation_message(
            cid,
            req,
            account_id=user_id,
            x_user_id=x_user_id,
            x_caller_email=x_caller_email,
        )

    try:
        # Thử xóa theo source_message_id trước
        deleted = await _rest(
            "DELETE",
            "zalo_messages",
            params={
                "user_id": f"eq.{user_id}",
                "group_id": f"eq.{cid}",
                "source_message_id": f"eq.{mid}",
            },
        )
        if not deleted:
            await _rest(
                "DELETE",
                "zalo_messages",
                params={
                    "user_id": f"eq.{user_id}",
                    "group_id": f"eq.{cid}",
                    "id": f"eq.{mid}",
                },
            )
    except Exception as exc:
        logger.warning(f"Error deleting message {mid} for user={user_id}: {exc}")
        raise HTTPException(status_code=500, detail=f"Không thể xóa tin nhắn: {exc}")

    invalidate_conversation_message_cache(user_id, cid)

    try:
        from app.modules.all_platform.zalo.services.message_events import publish_zalo_message_event
        await publish_zalo_message_event(
            user_id,
            {
                "type": "message_deleted",
                "account_id": user_id,
                "group_id": cid,
                "source_message_id": mid,
            },
        )
    except Exception as ev_exc:
        logger.warning(f"Could not publish message_deleted event: {ev_exc}")

    return {"ok": True, "conversation_id": cid, "message_id": mid, "mode": "deleted_for_me"}


# 6 cảm xúc nhanh — đúng bộ Zalo thật hiện khi bấm giữ 1 tin nhắn (❤️👍😆😮😢😠).
# zca-js hỗ trợ ~50 icon (models/Reaction.js) nhưng chỉ dùng đúng 6 này để giữ
# UX giống Zalo, không làm rối menu. "NONE" = bỏ react (Reactions.NONE = ""
# trong zca-js — bấm lại đúng icon mình đã thả để huỷ, giống Zalo thật).
QUICK_REACTION_ICONS = ("HEART", "LIKE", "HAHA", "WOW", "CRY", "ANGRY")
_VALID_REACTION_ICONS = QUICK_REACTION_ICONS + ("NONE",)


class ReactMessageRequest(BaseModel):
    source_message_id: str = Field(..., min_length=1)
    icon: str = Field(..., description="Tên enum Reactions của zca-js, vd HEART/LIKE/HAHA/WOW/CRY/ANGRY")
    thread_type: Optional[int] = None


class ReactMessageResponse(BaseModel):
    ok: bool
    conversation_id: str
    source_message_id: str
    icon: str


@router.post("/{conversation_id}/react", response_model=ReactMessageResponse)
async def react_to_conversation_message(
    conversation_id: str,
    body: ReactMessageRequest,
    account_id: Optional[str] = Query(None),
    x_user_id: str = Header("default", alias="X-User-ID"),
    x_caller_email: Optional[str] = Depends(get_authenticated_caller_email),
    caller_user: Optional[dict[str, Any]] = Depends(get_authenticated_caller_user),
):
    """Thả cảm xúc cho 1 tin — giống bấm giữ tin nhắn trên app Zalo rồi chọn
    icon. KHÁC recall: cho phép react tin của BẤT KỲ AI (không chỉ tin mình
    gửi) — đúng hành vi Zalo thật.

    Lưu ý về persist: endpoint này CHỈ gửi reaction lên Zalo thật, KHÔNG tự
    ghi vào cột `reactions` — việc lưu (cho cả reaction của mình lẫn của đối
    phương) do listener xử lý khi nhận event "reaction" echo lại (zca-js bật
    selfListen=true nên tự mình react cũng được echo về, tránh 2 nguồn ghi
    tranh nhau gây trùng/lệch key định danh người react). FE tự hiện tạm
    (optimistic) rồi đồng bộ lại khi poll/SSE tới.
    """
    icon = body.icon.strip().upper()
    if icon not in _VALID_REACTION_ICONS:
        raise HTTPException(status_code=400, detail=f"Icon không hợp lệ. Chỉ hỗ trợ: {', '.join(_VALID_REACTION_ICONS)}")

    user_id = _normalize_user_id(account_id or x_user_id)
    allowed_conv_ids = await check_caller_conversation_access(user_id, x_caller_email)
    if allowed_conv_ids is not None and conversation_id.strip() not in allowed_conv_ids:
        raise HTTPException(status_code=403, detail="Cuộc trò chuyện này ở chế độ riêng tư và chưa được chia sẻ với bạn.")

    auth = await load_zca_auth(user_id)
    if not auth:
        raise HTTPException(status_code=401, detail="Chưa có phiên ZCA hợp lệ. Hãy đăng nhập lại qua extension.")

    rows = await _rest(
        "GET",
        "zalo_messages",
        params={
            "select": "source_message_id,cli_msg_id,is_deleted",
            "user_id": f"eq.{user_id}",
            "group_id": f"eq.{conversation_id.strip()}",
            "source_message_id": f"eq.{body.source_message_id.strip()}",
            "limit": "1",
        },
    ) or []
    if not rows:
        raise HTTPException(status_code=404, detail="Không tìm thấy tin nhắn này.")
    row = rows[0]
    if row.get("is_deleted"):
        raise HTTPException(status_code=409, detail="Không thể thả cảm xúc cho tin đã bị thu hồi.")
    cli_msg_id = row.get("cli_msg_id")
    if not cli_msg_id:
        raise HTTPException(
            status_code=409,
            detail="Chưa xác định được cli_msg_id của tin nhắn (có thể vừa nhận/gửi, đợi vài giây rồi thử lại).",
        )

    thread_type = body.thread_type if body.thread_type is not None else await resolve_thread_type(user_id, conversation_id.strip())
    try:
        await add_zca_reaction(
            auth,
            conversation_id.strip(),
            msg_id=body.source_message_id.strip(),
            cli_msg_id=str(cli_msg_id),
            icon=icon,
            thread_type=thread_type,
        )
    except ZcaAuthExpiredError:
        raise HTTPException(status_code=401, detail=ZCA_SESSION_EXPIRED_DETAIL)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Không thể thả cảm xúc: {exc}")

    return ReactMessageResponse(ok=True, conversation_id=conversation_id, source_message_id=body.source_message_id, icon=icon)


@router.get("/stickers/search")
async def search_conversation_stickers(
    q: str = Query(..., min_length=1, max_length=64),
    limit: int = Query(24, ge=1, le=48),
    account_id: Optional[str] = Query(None),
    x_user_id: str = Header("default", alias="X-User-ID"),
):
    """Tìm sticker Zalo thật theo từ khoá (giống thanh tìm sticker trong app
    Zalo) — thay cho UI cũ phải tự biết trước sticker id. Trả kèm URL ảnh
    (stickerUrl/stickerWebpUrl) để FE hiện thumbnail thật, không chỉ số ID.
    """
    user_id = _normalize_user_id(account_id or x_user_id)
    auth = await load_zca_auth(user_id)
    if not auth:
        raise HTTPException(status_code=401, detail="Chưa có phiên ZCA hợp lệ. Hãy đăng nhập Zalo qua Chrome Extension trước.")
    try:
        stickers = await search_zca_stickers(auth, q.strip(), limit)
    except ZcaAuthExpiredError:
        raise HTTPException(status_code=401, detail=ZCA_SESSION_EXPIRED_DETAIL)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Không thể tìm sticker: {exc}")
    return {"ok": True, "stickers": stickers}


# --------------------------------------------------------------------------------------
# Helpers: lưu tin nhắn gửi đi vào Supabase
# --------------------------------------------------------------------------------------

async def _resolve_group_name(user_id: str, group_id: str) -> str:
    """Lấy group_name từ bảng zalo_groups; fallback về group_id nếu chưa có."""
    try:
        rows = await _rest(
            "GET",
            "zalo_groups",
            params={
                "select": "group_name",
                "user_id": f"eq.{user_id}",
                "group_id": f"eq.{group_id}",
                "limit": "1",
            },
        ) or []
        if rows and rows[0].get("group_name"):
            return str(rows[0]["group_name"])
    except Exception as exc:
        logger.warning(f"Could not resolve group_name for group={group_id}: {exc}")
    return group_id


def _build_outgoing_message_id(api_response: Optional[Dict[str, Any]], conversation_id: str = "") -> str:
    """Tạo source_message_id ổn định từ response của zca-js.

    QUAN TRỌNG — DEDUP CONTRACT:
    - zca-js trả về `{ message: { msgId: number } | null, attachment: [{ msgId }, ...] }`.
    - Khi Zalo echo lại tin nhắn mình vừa gửi, ZCA persistent listener (Node.js)
      cũng sẽ emit event với cùng `msgId` thuần (xem scripts/zca_persistent_listener.js
      dòng 178-186: `data.msgId || data.cliMsgId || ...`).
    - Vì cả 2 path (gửi từ tool + echo từ listener) đều lưu vào bảng
      zalo_messages với unique key `(user_id, group_id, source_message_id)`,
      ta BẮT BUỘC dùng CÙNG format source_message_id để DB upsert theo conflict
      thay vì insert duplicate row. Sai format → hiển thị 2 bản sao trên UI.

    Format chuẩn: msgId thuần dạng số (vd: "1234567890123456789").
    Fallback khi ZCA không trả msgId: sinh UUID local để có primary key
    tạm thời; khi listener echo về (có msgId thật), DB sẽ tạo row mới với
    msgId làm key — 2 row tồn tại song song cho đến khi listener merge.
    Vì listener thường echo về < 1s, duplicate ở trường hợp fallback
    rất hiếm và tự hết khi user refresh.

    `conversation_id` KHÔNG đưa vào msgId nữa vì listener không thêm prefix —
    việc trùng msgId giữa 2 thread khác nhau là gần như không thể (ZCA's msgId
    là ID toàn cục, không phải per-thread).
    """
    if api_response and isinstance(api_response, dict):
        msg_obj = api_response.get("message")
        if isinstance(msg_obj, dict) and msg_obj.get("msgId") is not None:
            return str(int(msg_obj["msgId"]))
        attachments = api_response.get("attachment")
        if isinstance(attachments, list) and attachments:
            first = attachments[0]
            if isinstance(first, dict) and first.get("msgId") is not None:
                return str(int(first["msgId"]))
    safe_cid = re.sub(r"[^a-zA-Z0-9_-]+", "-", (conversation_id or "").strip())[:32] or "thread"
    return f"local-{safe_cid}-{uuid.uuid4().hex}"


async def _persist_outgoing_message(
    user_id: str,
    conversation_id: str,
    api_response: Optional[Dict[str, Any]],
    *,
    content: str,
    message_type: str = "text",
    image_urls: Optional[List[str]] = None,
    mentions: Optional[List[Mention]] = None,
    reply_to_id: Optional[str] = None,
    uploaded_assets: Optional[List[Dict[str, str]]] = None,
    raw_content_override: Optional[Dict[str, Any]] = None,
) -> None:
    """Lưu message gửi đi vào Supabase để hiển thị ngay trong chat history.

    - Nếu response chứa msgId → dùng làm source_message_id (khi Zalo echo về sẽ merge).
    - Nếu không có → tạo UUID local; listener sẽ thay thế bằng dữ liệu thật khi có.
    - Tự update last_message_* trên zalo_groups để sidebar preview tươi ngay.
    """
    source_id = _build_outgoing_message_id(api_response, conversation_id)
    # Lưu UTC (chuẩn industry). Frontend sẽ convert sang Asia/Ho_Chi_Minh khi hiển thị.
    # Dùng timezone.utc thay vì utcnow() vì:
    #   1) utcnow() bị deprecated từ Python 3.12
    #   2) now(timezone.utc) trả về datetime **aware** → tránh nhầm lẫn với local time
    now_utc = datetime.now(timezone.utc)
    now_ms = int(now_utc.timestamp() * 1000)
    now_iso = now_utc.isoformat().replace("+00:00", "Z")
    safe_content = (content or "").strip() or None
    safe_image_urls = [url for url in (image_urls or []) if url]
    # Trước đây luôn ép resolved_type="image" bất cứ khi nào có URL đính kèm, bất kể
    # caller truyền message_type gì — đúng lúc _persist_outgoing_message() CHỈ được
    # gọi cho ảnh, nhưng giờ cũng dùng cho file thường/sticker (caller đã tự tính
    # đúng message_type rồi), ép cứng về "image" ở đây sẽ làm 1 file .pdf/.docx bị
    # gắn msg_kind="image" và FE vẽ ra <img> vỡ thay vì thẻ file tải về. Tin caller.
    resolved_type = message_type

    message = Message(
        message_id=source_id,
        sender_id=None,
        sender_name="Bạn",
        timestamp=str(now_ms),
        time_text=now_iso,
        type=resolved_type,
        content=safe_content,
        # uploaded_assets đã có sẵn → ghi thẳng zalo_message_assets bên dưới sau khi
        # lưu xong, KHÔNG để save_listener_messages() lại tự tải/upload lại qua
        # save_message_assets() (xem call site ở send_media_to_conversation).
        image_urls=[] if uploaded_assets else safe_image_urls,
        is_sent=True,
        is_deleted=False,
        group_id=conversation_id,
        ts=now_ms,
        msg_kind=resolved_type,
        mentions=mentions or [],
        reply_to_id=reply_to_id,
        raw_content=raw_content_override,
    )

    group_name = await _resolve_group_name(user_id, conversation_id)

    try:
        # Cập nhật metadata group để sidebar hiển thị ngay tin mới nhất (G5: không ghi URL thô)
        sidebar_preview = format_sidebar_last_message_preview(
            safe_content,
            msg_type=resolved_type,
            msg_kind=resolved_type,
            raw_content=raw_content_override,
            is_sent=True,
        )
        await upsert_group(
            user_id=user_id,
            group_id=conversation_id,
            group_name=group_name,
            last_message_at=now_iso,
            last_message_content=sidebar_preview,
            last_sender_id=None,
            last_sender_name="Bạn",
            last_message_type=resolved_type,
        )
    except Exception as exc:
        logger.warning(f"Could not upsert group metadata after send for user={user_id} conv={conversation_id}: {exc}")

    try:
        await save_listener_messages(
            user_id,
            conversation_id,
            group_name,
            [message],
            increment_unread=False,
        )
    except Exception as exc:
        # Không làm fail cả request gửi — Zalo đã nhận, chỉ là lưu local lỗi.
        logger.warning(
            f"Could not persist outgoing message to Supabase for user={user_id} conv={conversation_id}: {exc}"
        )
        return

    if uploaded_assets:
        try:
            rows = await _rest(
                "GET",
                "zalo_messages",
                params={
                    "select": "id",
                    "user_id": f"eq.{user_id}",
                    "group_id": f"eq.{conversation_id}",
                    "source_message_id": f"eq.{source_id}",
                    "limit": "1",
                },
            ) or []
            message_uuid = rows[0]["id"] if rows else None
            if message_uuid:
                now_iso2 = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
                await _rest(
                    "POST",
                    "zalo_message_assets",
                    json=[
                        {
                            "message_id": message_uuid,
                            "source_url": asset["source_url"],
                            "storage_path": asset["storage_path"],
                            "storage_url": asset["storage_url"],
                            "status": "uploaded",
                            "updated_at": now_iso2,
                        }
                        for asset in uploaded_assets
                    ],
                )
        except Exception as exc:
            logger.warning(
                f"Could not persist outgoing message assets for user={user_id} conv={conversation_id}: {exc}"
            )
    invalidate_conversation_message_cache(user_id, conversation_id)

    try:
        from app.modules.all_platform.zalo.services.message_events import (
            publish_zalo_message_event,
        )
        from app.modules.all_platform.zalo.services.supabase_service import (
            list_shared_conversation_ids,
        )

        shared_ids = await list_shared_conversation_ids(user_id)
        sse_msg = message.model_dump()
        if safe_image_urls and not sse_msg.get("image_urls"):
            sse_msg["image_urls"] = safe_image_urls
        event = {
            "type": "new_messages",
            "account_id": user_id,
            "group_id": conversation_id,
            "group_name": group_name,
            "messages": [sse_msg],
        }
        await publish_zalo_message_event(
            user_id,
            event,
            shared_conversation_ids=shared_ids,
        )
    except Exception as exc:
        logger.warning(
            f"Realtime publish failed for outgoing message user={user_id} group={conversation_id}: {exc}"
        )


# ──────────────────────────────────────────────────────────────────────────────
# Tìm user lạ (chưa từng chat) bằng SĐT hoặc username Zalo.
# Sau khi tìm thấy, FE dùng endpoint POST /conversations/users để tạo thread
# (insert vào zalo_groups) rồi mở khung chat như thread bình thường.
# ──────────────────────────────────────────────────────────────────────────────


@router.get("/users/find")
async def find_zalo_user(
    q: str = Query(..., min_length=8, max_length=32, description="SĐT VN (08x/09x...) hoặc username Zalo"),
    by: str = Query("phone", pattern="^(phone|username)$", description="Loại tìm kiếm: phone | username"),
    account_id: Optional[str] = Query(None),
    x_user_id: str = Header("default", alias="X-User-ID"),
):
    """Tìm một user Zalo bằng SĐT (E.164) hoặc username.

    - Input ``q`` ở dạng SĐT VN bất kỳ (0839108906, +84939108906, 0084...) — backend tự
      chuẩn hoá về E.164 trước khi gọi ``zca-js.findUser``.
    - Input ``q`` ở dạng username Zalo thì truyền ``by=username``.

    Trả 404 nếu ZCA không tìm thấy (chưa đăng ký Zalo / không nhận tin từ người lạ).
    """
    user_id = _normalize_user_id(account_id or x_user_id)
    auth = await load_zca_auth(user_id)
    if not auth:
        raise HTTPException(
            status_code=401,
            detail="Chưa có phiên ZCA hợp lệ. Hãy đăng nhập Zalo qua Chrome Extension trước.",
        )

    raw = q.strip()
    if by == "phone":
        e164 = vn_phone_to_e164(raw)
        if not e164:
            raise HTTPException(
                status_code=400,
                detail="SĐT không hợp lệ. VD: 0839108906, +84939108906, 0084 939 108 906",
            )
        try:
            user = await find_zca_user_by_phone(auth, e164)
        except ZcaAuthExpiredError:
            raise HTTPException(status_code=401, detail=ZCA_SESSION_EXPIRED_DETAIL)
        except RuntimeError as exc:
            err = str(exc).lower()
            # ZCA thường trả lỗi -111 hoặc "user not found" khi SĐT không có Zalo.
            if "-111" in err or "not found" in err or "không tìm" in err:
                raise HTTPException(
                    status_code=404,
                    detail="SĐT này chưa đăng ký Zalo, hoặc user đã tắt nhận tin nhắn từ người lạ.",
                )
            if "rate" in err or "too many" in err or "limit" in err:
                raise HTTPException(status_code=429, detail="Zalo đang giới hạn tốc độ. Thử lại sau vài giây.")
            raise HTTPException(status_code=500, detail=f"findUser thất bại: {exc}")
    else:
        # by == 'username'
        if not raw or len(raw) < 2:
            raise HTTPException(status_code=400, detail="Username Zalo tối thiểu 2 ký tự.")
        try:
            user = await find_zca_user_by_username(auth, raw)
        except ZcaAuthExpiredError:
            raise HTTPException(status_code=401, detail=ZCA_SESSION_EXPIRED_DETAIL)
        except RuntimeError as exc:
            err = str(exc).lower()
            if "-111" in err or "not found" in err or "không tìm" in err:
                raise HTTPException(
                    status_code=404,
                    detail="Username Zalo không tồn tại, hoặc user đã tắt nhận tin nhắn từ người lạ.",
                )
            raise HTTPException(status_code=500, detail=f"findUserByUsername thất bại: {exc}")

    # QUAN TRỌNG (bug phát hiện 2026-10-02): raw response zca-js dùng field "uid" (vd
    # {"uid": "...", "zalo_name": "...", "display_name": "...", "avatar": "..."}), KHÔNG
    # PHẢI "userId"/"displayName"/"zaloName"/"avatarUrl" như code cũ ở đây check - khiến
    # MỌI lần tìm đều báo "không tìm thấy" dù ZCA trả về user thật hợp lệ. Giữ cả 2 tên để
    # phòng hờ response shape đổi (giống automation_worker.py đã làm đúng từ trước).
    user_id_zalo_raw = user.get("uid") or user.get("userId") or user.get("id")
    if not user or not user_id_zalo_raw:
        raise HTTPException(
            status_code=404,
            detail="Không tìm thấy user Zalo. Có thể user đã tắt nhận tin nhắn từ người lạ.",
        )

    user_id_zalo = str(user_id_zalo_raw)
    return {
        "user_id": user_id_zalo,
        "display_name": user.get("display_name") or user.get("displayName") or user.get("zalo_name") or user.get("zaloName") or user_id_zalo,
        "zalo_name": user.get("zalo_name") or user.get("zaloName") or None,
        "avatar_url": user.get("avatar") or user.get("avatarUrl") or user.get("avt") or user.get("fullAvt") or user.get("fullAvatar") or None,
        "phone_e164": e164 if by == "phone" else None,
        "raw": user,
    }


class CreateUserConversationRequest(BaseModel):
    user_id: str = Field(..., min_length=1, description="uid Zalo tìm được qua GET /users/find")
    display_name: str = Field(..., min_length=1)
    avatar_url: Optional[str] = None
    phone: Optional[str] = None


@router.post("/users")
async def create_conversation_with_user(
    body: CreateUserConversationRequest,
    account_id: Optional[str] = Query(None),
    x_user_id: str = Header("default", alias="X-User-ID"),
):
    """Tạo (hoặc lấy lại) 1 hội thoại cá nhân (DM) với user vừa tìm bằng SĐT/username
    qua GET /users/find — với DM, ``group_id`` của hội thoại CHÍNH LÀ uid Zalo của
    đối phương (giống cách các hội thoại DM khác trong hệ thống này được định danh).
    Idempotent: gọi lại nhiều lần với cùng user_id chỉ cập nhật metadata, không tạo
    trùng — ``upsert_group`` đã có on_conflict=(user_id, group_id).
    """
    user_id = _normalize_user_id(account_id or x_user_id)
    target_uid = body.user_id.strip()
    if not target_uid:
        raise HTTPException(status_code=400, detail="Thiếu user_id.")
    try:
        # Gán thread_type="direct" để resolve_thread_type xác định đúng là cá nhân (0)
        # khi gửi tin nhắn cho người lạ, không bị nhầm thành nhóm chat (1).
        await upsert_group(
            user_id=user_id,
            group_id=target_uid,
            group_name=body.display_name.strip(),
            avatar_url=body.avatar_url,
            is_friend=False,
            thread_type="direct",
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Không thể tạo hội thoại: {exc}")

    # Nếu có phone truyền từ card bài viết hoặc tìm kiếm, match ngay với customer_leads
    if body.phone:
        raw_phone = str(body.phone).strip()
        clean_digits = re.sub(r"\D", "", raw_phone)
        if clean_digits.startswith("84") and len(clean_digits) >= 10:
            clean_digits = "0" + clean_digits[2:]
        if clean_digits:
            try:
                existing_leads = await _rest(
                    "GET",
                    "customer_leads",
                    params={"conv_id": f"eq.{target_uid}", "limit": 1},
                )
                if existing_leads and isinstance(existing_leads, list) and len(existing_leads) > 0:
                    await _rest(
                        "PATCH",
                        "customer_leads",
                        params={"id": f"eq.{existing_leads[0]['id']}"},
                        json={"phone": clean_digits, "updated_at": datetime.now(timezone.utc).isoformat()},
                    )
                else:
                    await _rest(
                        "POST",
                        "customer_leads",
                        json={
                            "customer_name": body.display_name.strip() or f"Zalo User {clean_digits[-4:]}",
                            "phone": clean_digits,
                            "conv_id": target_uid,
                            "source_platform": "zalo",
                            "status": "new",
                            "created_at": datetime.now(timezone.utc).isoformat(),
                            "updated_at": datetime.now(timezone.utc).isoformat(),
                        },
                    )
            except Exception as link_err:
                logger.warning(f"Auto-link lead phone to conv_id {target_uid} failed: {link_err}")

    return {"ok": True, "conversation_id": target_uid, "group_name": body.display_name.strip()}


@router.get("/users/{uid}/friend-status")
async def get_friend_status(
    uid: str,
    account_id: Optional[str] = Query(None),
    x_user_id: str = Header("default", alias="X-User-ID"),
):
    """Trạng thái bạn bè với 1 uid Zalo (Mục 3.3.5 guide).

    CẢNH BÁO field ngược tên gọi trực giác (Mục 11.1 guide) — GIỮ NGUYÊN, không đảo:
    - is_requested=true  → MÌNH đã gửi lời mời kết bạn (đang chờ họ chấp nhận).
    - is_requesting=true → HỌ đang gửi lời mời kết bạn cho MÌNH (đang chờ mình chấp nhận).
    """
    user_id = _normalize_user_id(account_id or x_user_id)
    auth = await load_zca_auth(user_id)
    if not auth:
        raise HTTPException(status_code=401, detail="Chưa có phiên ZCA hợp lệ. Hãy đăng nhập lại qua extension.")
    try:
        status = await get_zca_friend_status(auth, uid.strip())
    except ZcaAuthExpiredError:
        raise HTTPException(status_code=401, detail=ZCA_SESSION_EXPIRED_DETAIL)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Không thể tra trạng thái bạn bè: {exc}")
    return {"uid": uid, **status}


class FriendRequestBody(BaseModel):
    message: str = Field("", description="Lời nhắn kèm lời mời kết bạn (có thể để trống)")


@router.post("/users/{uid}/friend-request")
async def send_friend_request(
    uid: str,
    body: FriendRequestBody,
    account_id: Optional[str] = Query(None),
    x_user_id: str = Header("default", alias="X-User-ID"),
):
    user_id = _normalize_user_id(account_id or x_user_id)
    auth = await load_zca_auth(user_id)
    if not auth:
        raise HTTPException(status_code=401, detail="Chưa có phiên ZCA hợp lệ. Hãy đăng nhập lại qua extension.")
    try:
        result = await send_zca_friend_request(auth, uid.strip(), message=body.message or "")
    except ZcaAuthExpiredError:
        raise HTTPException(status_code=401, detail=ZCA_SESSION_EXPIRED_DETAIL)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Không thể gửi lời mời kết bạn: {exc}")
    return {"ok": True, "uid": uid, "result": result}


@router.post("/users/{uid}/friend-request/accept")
async def accept_friend_request(
    uid: str,
    account_id: Optional[str] = Query(None),
    x_user_id: str = Header("default", alias="X-User-ID"),
):
    user_id = _normalize_user_id(account_id or x_user_id)
    auth = await load_zca_auth(user_id)
    if not auth:
        raise HTTPException(status_code=401, detail="Chưa có phiên ZCA hợp lệ. Hãy đăng nhập lại qua extension.")
    try:
        result = await accept_zca_friend_request(auth, uid.strip())
    except ZcaAuthExpiredError:
        raise HTTPException(status_code=401, detail=ZCA_SESSION_EXPIRED_DETAIL)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Không thể chấp nhận lời mời kết bạn: {exc}")
    return {"ok": True, "uid": uid, "result": result}


class CreateUserThreadRequest(BaseModel):
    user_id: str = Field(..., min_length=4, description="Zalo userId từ /users/find")
    display_name: str = Field(..., min_length=1, description="Tên hiển thị để show trong sidebar")
    avatar_url: Optional[str] = None


@router.post("/users/threads", response_model=Dict[str, Any])
async def create_user_thread(
    body: CreateUserThreadRequest,
    account_id: Optional[str] = Query(None),
    x_user_id: str = Header("default", alias="X-User-ID"),
):
    """Tạo (hoặc trả về) thread chat với một user lạ trong ``zalo_groups``.

    Idempotent: nếu thread đã tồn tại thì chỉ update ``group_name`` / ``avatar_url``.
    Sau khi gọi endpoint này, FE chỉ cần select conversation_id == user_id để mở khung chat
    rồi gọi ``POST /conversations/{id}/send`` như thread bình thường (backend tự suy
    ``thread_type=0`` vì userId Zalo không bắt đầu bằng 'g').
    """
    user_id = _normalize_user_id(account_id or x_user_id)
    target_user_id = body.user_id.strip()
    if not target_user_id or not target_user_id.isdigit():
        raise HTTPException(
            status_code=400,
            detail="user_id phải là chuỗi chữ số thuần (Zalo userId).",
        )

    try:
        await upsert_group(
            user_id=user_id,
            group_id=target_user_id,
            group_name=body.display_name.strip() or f"User {target_user_id}",
            avatar_url=body.avatar_url,
            is_friend=True,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Không thể tạo thread với user: {exc}",
        )

    return {
        "ok": True,
        "conversation_id": target_user_id,
        "user_id": user_id,
        "display_name": body.display_name.strip(),
        "thread_type": 0,
    }


@router.get("/{account_id}/groups/{group_id}/members")
async def get_group_members(
    account_id: str,
    group_id: str,
):
    """Quét ĐẦY ĐỦ thành viên 1 nhóm — dùng để tạo bulk-send job (Mục 3.3.5/8(i) guide)."""
    user_id = _normalize_user_id(account_id)
    auth = await load_zca_auth(user_id)
    if not auth:
        raise HTTPException(status_code=401, detail="Chưa có phiên ZCA hợp lệ. Hãy đăng nhập lại qua extension.")
    try:
        result = await get_zca_group_members_full(auth, group_id.strip())
    except ZcaAuthExpiredError:
        raise HTTPException(status_code=401, detail=ZCA_SESSION_EXPIRED_DETAIL)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Không thể quét thành viên nhóm: {exc}")
    return result


class SendStickerBody(BaseModel):
    id: int
    cate_id: int
    type: int = 1


@router.post("/{conversation_id}/send-sticker")
async def send_sticker_to_conversation(
    conversation_id: str,
    body: SendStickerBody,
    account_id: Optional[str] = Query(None),
    x_user_id: str = Header("default", alias="X-User-ID"),
    x_caller_email: Optional[str] = Depends(get_authenticated_caller_email),
    caller_user: Optional[dict[str, Any]] = Depends(get_authenticated_caller_user),
):
    user_id = _normalize_user_id(account_id or x_user_id)
    auth = await load_zca_auth(user_id)
    if not auth:
        raise HTTPException(status_code=401, detail="Chưa có phiên ZCA hợp lệ. Hãy đăng nhập lại qua extension.")
    thread_type = await resolve_thread_type(user_id, conversation_id)
    try:
        result = await send_zca_sticker(
            auth, conversation_id.strip(),
            sticker_id=body.id, cate_id=body.cate_id, sticker_type=body.type,
            thread_type=thread_type,
        )
    except ZcaAuthExpiredError:
        raise HTTPException(status_code=401, detail=ZCA_SESSION_EXPIRED_DETAIL)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Không thể gửi sticker: {exc}")

    # Trước đây KHÔNG lưu gì vào Supabase sau khi gửi — sticker chỉ hiện lại khi
    # listener echo về, và dữ liệu echo của Zalo cho sticker chỉ có id/cateId (không
    # có URL ảnh thật, phải tra riêng qua getStickersDetail), nên dù echo về cũng
    # không có ảnh để vẽ. Ở đây đã có sẵn id/cateId CHẮC CHẮN đúng (từ chính request)
    # nên tra ngay URL thật rồi lưu local, hiện ra tức thì — không cần chờ/đoán field
    # từ raw_content của listener.
    sticker_url: Optional[str] = None
    try:
        details = await get_zca_stickers_detail(auth, [body.id])
        detail = details[0] if details else {}
        sticker_url = detail.get("stickerWebpUrl") or detail.get("stickerUrl") or None
    except Exception as exc:
        logger.info(f"Could not resolve sticker detail for id={body.id}: {exc}")
    if not sticker_url:
        sticker_url = build_zalo_sticker_cdn_url(body.id)

    api_payload = result.get("response") or result.get("result") if isinstance(result, dict) else None
    staff_name = getattr(body, "staff_name", None)
    staff_avatar = getattr(body, "staff_avatar", None)
    resolved_staff_name = (
        staff_name
        or (caller_user.get("name") if caller_user else None)
        or (x_caller_email.split("@")[0] if x_caller_email else None)
    )
    resolved_staff_email = x_caller_email or (caller_user.get("email") if caller_user else None)
    resolved_staff_avatar = (
        staff_avatar
        or (caller_user.get("avatar_url") or caller_user.get("avatar") if caller_user else None)
    )
    raw_staff_override = {
        "staff_name": resolved_staff_name,
        "staff_email": resolved_staff_email,
        "staff_avatar": resolved_staff_avatar,
        "sender_staff": {
            "name": resolved_staff_name,
            "email": resolved_staff_email,
            "avatar": resolved_staff_avatar,
        },
        "id": body.id,
        "cateId": body.cate_id,
        "type": body.type,
    }
    await _persist_outgoing_message(
        user_id,
        conversation_id.strip(),
        api_payload,
        content="",
        message_type="chat.sticker",
        image_urls=[sticker_url] if sticker_url else None,
        raw_content_override=dict(
            raw_staff_override,
            **({"stickerUrl": sticker_url, "stickerWebpUrl": sticker_url} if sticker_url else {}),
        ),
    )
    _schedule_post_send_side_effects(user_id, conversation_id.strip(), x_caller_email)
    return {"ok": True, "result": result}


@router.get("/stickers")
async def get_stickers_detail(
    ids: str = Query(..., description="Danh sách sticker id, phân tách bằng dấu phẩy"),
    account_id: Optional[str] = Query(None),
    x_user_id: str = Header("default", alias="X-User-ID"),
):
    try:
        sticker_ids = [int(s.strip()) for s in ids.split(",") if s.strip()]
    except ValueError:
        raise HTTPException(status_code=400, detail="ids phải là danh sách số nguyên, phân tách bằng dấu phẩy")

    fallback_stickers = [
        {
            "id": sid,
            "stickerUrl": build_zalo_sticker_cdn_url(sid),
            "stickerWebpUrl": None,
            "fallback": True,
        }
        for sid in sticker_ids
        if sid > 0
    ]

    user_id = _normalize_user_id(account_id or x_user_id)
    auth = await load_zca_auth(user_id)
    if not auth:
        return {"stickers": fallback_stickers}

    try:
        stickers = await get_zca_stickers_detail(auth, sticker_ids)
    except Exception as exc:
        logger.warning(f"ZCA getStickersDetail failed for ids={sticker_ids}, using public CDN fallback: {exc}")
        return {"stickers": fallback_stickers}

    enriched: List[Dict[str, Any]] = []
    for item in stickers or []:
        if not isinstance(item, dict):
            continue
        copy_item = dict(item)
        if not copy_item.get("stickerWebpUrl") and not copy_item.get("stickerUrl"):
            cdn_url = build_zalo_sticker_cdn_url(copy_item.get("id"))
            if cdn_url:
                copy_item["stickerUrl"] = cdn_url
        enriched.append(copy_item)
    return {"stickers": enriched or fallback_stickers}


@router.get("/{conversation_id}/phone")
async def get_conversation_phone(
    conversation_id: str,
    name: Optional[str] = Query(None),
    account_id: Optional[str] = Query(None),
    x_user_id: str = Header("default", alias="X-User-ID"),
):
    """Tra cứu số điện thoại liên kết với hội thoại Zalo từ CRM hoặc Seeding Campaign,
    kèm cơ chế ZCA reverse lookup từ UID khách hàng."""
    conv_id = (conversation_id or "").strip()
    if not conv_id:
        return {"success": False, "phone": None}

    clean_name = (name or "").strip()
    cache_key = f"{conv_id}:{clean_name.lower()}"
    now_ts = time.time()
    cached_phone = _CONV_PHONE_CACHE.get(cache_key)
    if cached_phone and (now_ts - cached_phone[0] < CONV_PHONE_CACHE_TTL):
        return {"success": True, "phone": cached_phone[1]}

    phone: Optional[str] = None

    # 0. TẦNG ĐẦU TIÊN (ƯU TIÊN TUYỆT ĐỐI THEO CHỈ ĐẠO CỦA MASTER):
    # Kiểm tra xem có phải nhắn tin từ Card Post Feed không bằng cách bóc tách Link bài viết trong tin nhắn
    try:
        msgs = await _rest(
            "GET",
            "zalo_messages",
            params={
                "group_id": f"eq.{conv_id}",
                "select": "content",
                "order": "created_at.asc",
                "limit": 15,
            },
        )
        if msgs and isinstance(msgs, list):
            for m in msgs:
                content = str(m.get("content") or "")
                # Tìm link facebook / linkedin trong tin nhắn
                url_match = re.search(r"https?://(?:www\.)?(?:facebook\.com/[^\s]+|linkedin\.com/[^\s]+)", content)
                if url_match:
                    found_post_url = url_match.group(0).rstrip(".,)>\"'")
                    clean_post_url = found_post_url.split("?")[0].rstrip("/")
                    # 0.1 Tra cứu trong auto_seeding_comments theo post_url
                    seed_res = await _rest(
                        "GET",
                        "auto_seeding_comments",
                        params={"post_url": f"ilike.*{clean_post_url}*", "select": "phone_number,zalo_conversation_id", "limit": 1},
                    )
                    if seed_res and isinstance(seed_res, list) and len(seed_res) > 0:
                        cand_phone = seed_res[0].get("phone_number")
                        if cand_phone:
                            phone = cand_phone
                            # Tự động match và lưu luôn vào customer_leads để các lần sau lấy 0ms
                            try:
                                clean_digits = re.sub(r"\D", "", phone)
                                if clean_digits.startswith("84") and len(clean_digits) >= 10:
                                    clean_digits = "0" + clean_digits[2:]
                                await _rest("POST", "customer_leads", json={
                                    "customer_name": clean_name or "Khách từ Post Feed",
                                    "phone": clean_digits,
                                    "conv_id": conv_id,
                                    "source_platform": "zalo",
                                    "status": "new",
                                    "created_at": datetime.now(timezone.utc).isoformat(),
                                    "updated_at": datetime.now(timezone.utc).isoformat(),
                                })
                                # Đồng bộ luôn zalo_conversation_id vào auto_seeding_comments
                                await _rest("PATCH", "auto_seeding_comments", params={"post_url": f"eq.{found_post_url}"}, json={"zalo_conversation_id": conv_id})
                            except Exception as save_err:
                                logger.debug(f"Auto sync lead from post card failed: {save_err}")
                            break
                    
                    # 0.2 Nếu auto_seeding_comments chưa có phone, tra trong facebook_posts
                    if not phone:
                        clean_url = found_post_url.split("?")[0].rstrip("/")
                        fb_res = await _rest(
                            "GET",
                            "facebook_posts",
                            params={"post_url": f"ilike.*{clean_url}*", "select": "content", "limit": 1},
                        )
                        if fb_res and isinstance(fb_res, list) and len(fb_res) > 0:
                            content_str = fb_res[0].get("content") or ""
                            m_ph = re.search(r"(?:0|\+84)(?:3|5|7|8|9)\d{8}", content_str)
                            if m_ph:
                                phone = m_ph.group(0)
                                break
    except Exception as card_err:
        logger.debug(f"Check message from post feed card failed: {card_err}")

    # 1. Tra trong customer_leads theo conv_id
    try:
        lead_rows = await _rest(
            "GET",
            "customer_leads",
            params={
                "conv_id": f"eq.{conv_id}",
                "select": "phone,phone_normalized",
                "limit": 1,
            },
        )
        if lead_rows and isinstance(lead_rows, list) and len(lead_rows) > 0:
            phone = lead_rows[0].get("phone") or lead_rows[0].get("phone_normalized")
    except Exception as e:
        logger.debug(f"lookup phone in customer_leads by conv_id failed: {e}")

    # 2. Tra trong customer_leads theo customer_name
    if not phone and clean_name and len(clean_name) >= 2:
        try:
            name_lead_rows = await _rest(
                "GET",
                "customer_leads",
                params={
                    "customer_name": f"ilike.*{clean_name}*",
                    "phone": "not.is.null",
                    "select": "phone,phone_normalized",
                    "limit": 1,
                },
            )
            if name_lead_rows and isinstance(name_lead_rows, list) and len(name_lead_rows) > 0:
                phone = name_lead_rows[0].get("phone") or name_lead_rows[0].get("phone_normalized")
        except Exception as e:
            logger.debug(f"lookup phone in customer_leads by name failed: {e}")

    # 2.5 Tra trong crm_leads theo lead_name
    if not phone and clean_name and len(clean_name) >= 2:
        try:
            crm_lead_rows = await _rest(
                "GET",
                "crm_leads",
                params={
                    "lead_name": f"ilike.*{clean_name}*",
                    "phone": "not.is.null",
                    "select": "phone,phone_normalized",
                    "limit": 1,
                },
            )
            if crm_lead_rows and isinstance(crm_lead_rows, list) and len(crm_lead_rows) > 0:
                phone = crm_lead_rows[0].get("phone") or crm_lead_rows[0].get("phone_normalized")
        except Exception as e:
            logger.debug(f"lookup phone in crm_leads by lead_name failed: {e}")

    # 3. Tra trong crm_customers theo customer_name
    if not phone and clean_name and len(clean_name) >= 2:
        try:
            cust_rows = await _rest(
                "GET",
                "crm_customers",
                params={
                    "customer_name": f"ilike.*{clean_name}*",
                    "phone": "not.is.null",
                    "select": "phone,phone_normalized",
                    "limit": 1,
                },
            )
            if cust_rows and isinstance(cust_rows, list) and len(cust_rows) > 0:
                phone = cust_rows[0].get("phone") or cust_rows[0].get("phone_normalized")
        except Exception as e:
            logger.debug(f"lookup phone in crm_customers by name failed: {e}")

    # 4. Tra trong auto_seeding_comments theo zalo_conversation_id
    if not phone:
        try:
            seeding_rows = await _rest(
                "GET",
                "auto_seeding_comments",
                params={
                    "zalo_conversation_id": f"eq.{conv_id}",
                    "select": "phone_number",
                    "limit": 1,
                },
            )
            if seeding_rows and isinstance(seeding_rows, list) and len(seeding_rows) > 0:
                phone = seeding_rows[0].get("phone_number")
        except Exception as e:
            logger.debug(f"lookup phone in auto_seeding_comments failed: {e}")

    # 5. Tra trong zalo_messages của conversation xem có tin nhắn chứa SĐT
    if not phone:
        try:
            msgs = await _rest(
                "GET",
                "zalo_messages",
                params={
                    "group_id": f"eq.{conv_id}",
                    "content": "not.is.null",
                    "select": "content",
                    "order": "created_at.desc",
                    "limit": 20,
                },
            )
            if msgs and isinstance(msgs, list):
                phone_pattern = re.compile(r"(?:\+?84|0)[\s.\-]?[235789](?:[\s.\-]?\d){8,9}")
                for m in msgs:
                    text = m.get("content") or ""
                    match = phone_pattern.search(text)
                    if match:
                        phone = match.group(0)
                        break
        except Exception as e:
            logger.debug(f"lookup phone in zalo_messages failed: {e}")

    # 6. Nếu conv_id chính là số điện thoại
    if not phone:
        digits = re.sub(r"\D", "", conv_id)
        if (len(digits) == 10 and digits.startswith("0")) or (len(digits) == 11 and digits.startswith("84")):
            phone = digits

    # 7. Truy ngược số điện thoại từ ZCA bằng UID của khách nếu conv_id là UID
    if not phone:
        uid_digits = re.sub(r"\D", "", conv_id)
        # UID Zalo là chuỗi số dài (thường >= 8 chữ số)
        if len(uid_digits) >= 8:
            try:
                acc_id = _normalize_user_id(account_id or x_user_id)
                auth = await load_zca_auth(acc_id)
                if auth:
                    info_res = await get_zca_user_info(auth, conv_id)
                    info = (info_res or {}).get("info") or {}
                    changed = info.get("changed_profiles") or {}
                    profile = changed.get(conv_id) or changed.get(str(conv_id)) or info
                    raw_phone = profile.get("phoneNumber") or profile.get("phone")
                    if raw_phone:
                        clean_zca = re.sub(r"\D", "", str(raw_phone))
                        if clean_zca.startswith("84") and len(clean_zca) >= 10:
                            clean_zca = "0" + clean_zca[2:]
                        if len(clean_zca) >= 9:
                            phone = clean_zca
                            # Lưu vào customer_leads để cache vĩnh viễn
                            try:
                                await _rest(
                                    "POST",
                                    "customer_leads",
                                    json={
                                        "customer_name": clean_name or f"Zalo User {clean_zca[-4:]}",
                                        "phone": clean_zca,
                                        "conv_id": conv_id,
                                        "source_platform": "zalo",
                                        "status": "new",
                                        "created_at": datetime.now(timezone.utc).isoformat(),
                                        "updated_at": datetime.now(timezone.utc).isoformat(),
                                    },
                                )
                            except Exception:
                                pass
            except Exception as zca_err:
                logger.debug(f"reverse lookup phone via ZCA getUserInfo failed for conv_id {conv_id}: {zca_err}")

    # Chuẩn hóa về dạng 0...
    if phone:
        clean = re.sub(r"\D", "", str(phone))
        if clean.startswith("84") and len(clean) >= 10:
            clean = "0" + clean[2:]
        _CONV_PHONE_CACHE[cache_key] = (now_ts, clean)
        return {"success": True, "phone": clean}

    _CONV_PHONE_CACHE[cache_key] = (now_ts, None)
    return {"success": True, "phone": None}


class SaveConversationPhoneRequest(BaseModel):
    phone: str
    name: Optional[str] = None


@router.post("/{conversation_id}/phone")
async def save_conversation_phone(
    conversation_id: str,
    payload: SaveConversationPhoneRequest,
):
    """Lưu hoặc cập nhật số điện thoại cho hội thoại Zalo vào customer_leads."""
    conv_id = (conversation_id or "").strip()
    raw_phone = (payload.phone or "").strip()
    clean_digits = re.sub(r"\D", "", raw_phone)
    if clean_digits.startswith("84") and len(clean_digits) >= 10:
        clean_digits = "0" + clean_digits[2:]

    if not conv_id or not clean_digits:
        raise HTTPException(status_code=400, detail="Thiếu conversation_id hoặc phone")

    invalidate_conversation_phone_cache(conv_id)
    clean_name = (payload.name or "").strip() or f"Zalo User {clean_digits[-4:]}"

    # 1. Kiểm tra xem đã có lead với conv_id này chưa
    try:
        existing = await _rest(
            "GET",
            "customer_leads",
            params={
                "conv_id": f"eq.{conv_id}",
                "select": "id,customer_name,phone",
                "limit": 1,
            },
        )
        if existing and isinstance(existing, list) and len(existing) > 0:
            lead_id = existing[0]["id"]
            await _rest(
                "PATCH",
                "customer_leads",
                params={"id": f"eq.{lead_id}"},
                json={
                    "phone": clean_digits,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                },
            )
            return {"success": True, "phone": clean_digits, "lead_id": lead_id, "action": "updated"}
    except Exception as e:
        logger.error(f"update existing lead by conv_id failed: {e}")

    # 2. Tạo mới lead trong customer_leads
    try:
        new_lead = {
            "customer_name": clean_name,
            "phone": clean_digits,
            "conv_id": conv_id,
            "source_platform": "zalo",
            "status": "new",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        res = await _rest("POST", "customer_leads", json=new_lead)
        return {"success": True, "phone": clean_digits, "action": "created", "lead": res}
    except Exception as e:
        logger.error(f"create customer_leads for conv_id failed: {e}")
        # Vẫn trả về phone để UI hiển thị được ngay lập tức
        return {"success": True, "phone": clean_digits, "action": "fallback_local"}


# --------------------------------------------------------------------------------------
# G4: Safe Bankcard CDN Decoder Endpoint (SSRF-protected HTTPS *.zadn.vn allowlist)
# Exposed at BOTH:
#   - GET /api/all-platform/zalo/bankcard-preview?url=<encoded_data_url>
#   - GET /api/all-platform/zalo/conversations/bankcard-preview?url=<encoded_data_url>
# --------------------------------------------------------------------------------------

async def get_bankcard_preview(
    url: str = Query(..., min_length=12, max_length=2048, description="Zalo bankcard CDN URL (HTTPS *.zadn.vn only)"),
    x_caller_email: Optional[str] = Depends(get_authenticated_caller_email),
):
    """Giải mã an toàn thẻ ngân hàng Zalo (`zinstant.bankcard` / `templateId=11845`) từ CDN `*.zadn.vn`."""
    _ = x_caller_email
    try:
        return await fetch_bankcard_preview(url, timeout=5.0)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.warning(f"Bankcard preview decode failed for url={url[:120]}: {exc}")
        return {
            "ok": False,
            "bin": None,
            "bank_name": None,
            "bank_short_name": None,
            "account_no": None,
            "account_name": None,
            "logo_url": None,
            "qr_url": None,
        }


router.add_api_route(
    "/bankcard-preview",
    get_bankcard_preview,
    methods=["GET"],
    name="get_conversation_bankcard_preview",
)

# Wrap `/conversations` sub-router inside a prefix-less parent router so
# `all_platform_router.include_router(zalo_conversations_router, prefix="/zalo")`
# serves `/api/all-platform/zalo/bankcard-preview` alongside all existing
# `/api/all-platform/zalo/conversations/*` routes untouched.
_conversations_subrouter = router
_zalo_bankcard_root_router = APIRouter()
_zalo_bankcard_root_router.add_api_route(
    "/bankcard-preview",
    get_bankcard_preview,
    methods=["GET"],
    name="get_zalo_bankcard_preview",
    tags=["zalo-conversations"],
    dependencies=[Depends(verify_zalo_api_key)],
)
_zalo_bankcard_root_router.include_router(_conversations_subrouter)
router = _zalo_bankcard_root_router

