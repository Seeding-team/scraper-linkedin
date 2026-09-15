import asyncio
import os
import posixpath
import tempfile
import shutil
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
import re
from loguru import logger

from fastapi import APIRouter, Depends, Header, HTTPException, Query, UploadFile, File, Form, BackgroundTasks
from pydantic import BaseModel, Field

from app.modules.all_platform.auth_deps import get_authenticated_caller_email
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
    _rest,
    list_conversation_messages,
    list_conversations,
    save_listener_messages,
    save_global_listener_messages,
    upsert_groups,
    upsert_group,
    mark_conversation_as_read,
    resolve_thread_type,
)
from app.modules.all_platform.zalo.services.zca_auth_store import load_zca_auth
from app.modules.all_platform.zalo.services.zca_api_bridge import (
    ZcaAuthExpiredError,
    find_zca_user_by_phone,
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


async def check_caller_conversation_access(
    account_id: str,
    caller_email: Optional[str],
) -> Optional[set[str]]:
    """Kiểm tra quyền truy cập của người gọi đối với tài khoản zalo account_id.
    
    Trả về:
        - None: Nếu người gọi là chủ sở hữu tài khoản (full quyền).
        - set[str]: Danh sách conversation_id được phép truy cập (được share).
        - Ném HTTPException(403) nếu không có quyền.
    """
    if not caller_email:
        # Nếu không có caller_email, cho phép truy cập full để tương thích ngược
        return None

    # 1. Tìm thông tin app_user của người gọi
    caller_email_clean = caller_email.strip().lower()
    user_rows = await _rest(
        "GET",
        "app_users",
        params={
            "select": "id,role",
            "email": f"eq.{caller_email_clean}",
            "limit": "1",
        },
    )
    if not user_rows:
        raise HTTPException(status_code=403, detail="Không tìm thấy thông tin tài khoản người gọi.")
        
    caller_user = user_rows[0]
    caller_user_id = str(caller_user.get("id"))
    caller_role = str(caller_user.get("role") or "").strip().lower()

    # 2. Tìm chủ sở hữu của tài khoản Zalo (owner_id trong zalo_accounts)
    account_rows = await _rest(
        "GET",
        "zalo_accounts",
        params={
            "select": "owner_id,is_shared_with_all",
            "account_id": f"eq.{account_id}",
            "limit": "1",
        },
    )
    owner_user_id = None
    if account_rows:
        owner_user_id = str(account_rows[0].get("owner_id") or "")

    # 3. Nếu là chủ sở hữu, cho phép xem toàn bộ
    if owner_user_id and caller_user_id == owner_user_id:
        return None

    # 3b. Tài khoản đánh dấu "dùng chung toàn công ty" -> mọi nhân viên đều full quyền,
    # không cần là owner/admin/leader hay được share riêng từng hội thoại.
    if account_rows and bool(account_rows[0].get("is_shared_with_all")):
        return None

    # 4. Nếu không phải chủ sở hữu, chỉ admin và leader được xem (nhưng bị giới hạn bởi các chat được share)
    if caller_role not in ["admin", "superadmin", "leader"]:
        raise HTTPException(status_code=403, detail="Bạn không có quyền truy cập dữ liệu của tài khoản này.")

    # 5. Truy vấn danh sách cuộc hội thoại được share
    perm_params = {
        "select": "conversation_id,id_leader",
        "account_id": f"eq.{account_id}",
        "is_active": "eq.true",
        "limit": "5000",
    }
    if caller_role == "leader":
        # Leader chỉ được xem nếu id_leader khớp hoặc là NULL (share chung)
        perm_params["or"] = f"(id_leader.eq.{caller_user_id},id_leader.is.null)"

    perm_rows = await _rest(
        "GET",
        "zalo_conversation_permissions",
        params=perm_params,
    ) or []

    allowed_ids = {str(row.get("conversation_id") or "").strip() for row in perm_rows if row.get("conversation_id")}
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
            results.append({
                "conversation_id": r.get("conversation_id"),
                "conversation_name": r.get("conversation_name") or r.get("conversation_id"),
                "account_id": user_id,
                "message_count": 0,
                "image_count": 0,
                "sent_count": 0,
                "received_count": 0,
                "latest_message_at": latest_message_at,
                "latest_content": r.get("last_message_content"),
                "latest_sender_name": r.get("last_sender_name"),
                "has_messages": bool(latest_message_at),
                "sync_status": "has_messages" if latest_message_at else "no_messages",
                "avatar_url": r.get("avatar_url"),
                "unread_count": int(r.get("unread_count") or 0),
                "is_pinned": bool(r.get("is_pinned")),
                "is_friend": bool(r.get("is_friend")),
                "thread_type": r.get("thread_type") or ("user" if r.get("is_friend") else "group"),
            })
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


@router.get("/resolve-account")
async def resolve_conversation_account(
    conv_id: str = Query(...),
    # Trước đây trực tiếp tin header X-Caller-Email client tự gửi (lấy từ
    # localStorage — ai cũng sửa được bằng DevTools để mạo danh leader/admin
    # bất kỳ). Giờ lấy từ JWT đã xác thực (cookie crawlpro_access_token).
    x_caller_email: Optional[str] = Depends(get_authenticated_caller_email),
):
    """Tim tai khoan Zalo dang giu 1 conv_id, dung cho luong 'Xu ly' tu trang
    Khach hang (CRM) - bam vao la tu dong chon dung acc + nhay thang toi hoi
    thoai, khong can biet truoc acc nao dang giu no."""
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

    return {"account_id": account_id, "conv_id": conv_id}


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
        
    try:
        rows, total = await list_conversation_messages(
            user_id,
            conversation_id,
            limit=limit,
            offset=offset,
        )
        return {
            "messages": [ZaloLibraryMessage(**row) for row in rows],
            "groups": [],
            "total": total,
            "limit": limit,
            "offset": offset,
            "has_more": offset + len(rows) < total,
        }
    except SupabaseNotConfigured as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Không thể tải tin nhắn hội thoại Zalo: {exc}")


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


class SendMessageResponse(BaseModel):
    ok: bool
    conversation_id: str
    message: str = ""


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
            detail="Chưa có phiên ZCA hợp lệ. Hãy đăng nhập Zalo bằng QR trước.",
        )

    # Infer thread_type from conversation_id when not explicitly provided
    if body.thread_type is not None:
        thread_type = body.thread_type
    else:
        thread_type = await resolve_thread_type(user_id, conversation_id.strip())

    mentions_payload = [m.model_dump() for m in body.mentions] if body.mentions else None
    try:
        result = await send_zca_message(
            auth,
            conversation_id.strip(),
            body.text.strip(),
            thread_type=thread_type,
            mentions=mentions_payload,
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
    await _persist_outgoing_message(
        user_id,
        conversation_id.strip(),
        api_payload,
        content=body.text.strip(),
        message_type="text",
        mentions=body.mentions,
    )

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
    files: List[UploadFile] = File(...),
    account_id: Optional[str] = Query(None),
    x_user_id: str = Header("default", alias="X-User-ID"),
    # Trước đây trực tiếp tin header X-Caller-Email client tự gửi (lấy từ
    # localStorage — ai cũng sửa được bằng DevTools để mạo danh leader/admin
    # bất kỳ). Giờ lấy từ JWT đã xác thực (cookie crawlpro_access_token).
    x_caller_email: Optional[str] = Depends(get_authenticated_caller_email),
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
            detail="Chưa có phiên ZCA hợp lệ. Hãy đăng nhập Zalo bằng QR trước.",
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

        # Upload ảnh đã gửi lên Supabase storage để hiển thị trong lịch sử chat
        # (zca-js không trả URL persistent, chỉ trả msgId).
        uploaded_urls: List[str] = []
        try:
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
                    content_type = "image/jpeg"
                    if ext.lower() in {".png"}:
                        content_type = "image/png"
                    elif ext.lower() in {".webp"}:
                        content_type = "image/webp"
                    elif ext.lower() in {".gif"}:
                        content_type = "image/gif"
                    storage_path = posixpath.join(
                        user_id,
                        "outgoing",
                        f"{uuid.uuid4().hex}{ext}",
                    )
                    url = await upload_asset_bytes(storage_path, file_bytes, content_type)
                    uploaded_urls.append(url)
                except Exception as exc:
                    logger.warning(f"Could not persist outgoing Zalo image {path}: {exc}")
        except Exception as exc:
            logger.warning(f"Could not import supabase helpers for media upload: {exc}")

        # Lưu message đã gửi vào Supabase
        # "response" là key chuẩn (zca_api_bridge.js + zca_api_server.js, đã đồng bộ
        # 2026-08-26); vẫn thử "result" phòng hộ nếu 1 worker cũ chưa restart kịp
        # còn trả key cũ — tránh lại rơi vào fallback ID tạm gây lặp tin.
        api_payload = result.get("response") or result.get("result") if isinstance(result, dict) else None
        await _persist_outgoing_message(
            user_id,
            conversation_id.strip(),
            api_payload,
            content=text.strip() if text else "",
            message_type="image",
            image_urls=uploaded_urls,
        )

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

    return RecallMessageResponse(ok=True, conversation_id=conversation_id, source_message_id=body.source_message_id)


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
    resolved_type = "image" if safe_image_urls and not safe_content else message_type
    if safe_image_urls and safe_content:
        resolved_type = "image"  # type đính kèm chữ vẫn là image
    elif safe_image_urls:
        resolved_type = "image"

    message = Message(
        message_id=source_id,
        sender_id=None,
        sender_name="Bạn",
        timestamp=str(now_ms),
        time_text=now_iso,
        type=resolved_type,
        content=safe_content,
        image_urls=safe_image_urls,
        is_sent=True,
        is_deleted=False,
        group_id=conversation_id,
        ts=now_ms,
        msg_kind=resolved_type,
        mentions=mentions or [],
    )

    group_name = await _resolve_group_name(user_id, conversation_id)

    try:
        # Cập nhật metadata group để sidebar hiển thị ngay tin mới nhất
        await upsert_group(
            user_id=user_id,
            group_id=conversation_id,
            group_name=group_name,
            last_message_at=now_iso,
            last_message_content=safe_content or (safe_image_urls[0] if safe_image_urls else None),
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
            detail="Chưa có phiên ZCA hợp lệ. Hãy đăng nhập Zalo bằng QR trước.",
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

    if not user or not user.get("userId"):
        raise HTTPException(
            status_code=404,
            detail="Không tìm thấy user Zalo. Có thể user đã tắt nhận tin nhắn từ người lạ.",
        )

    user_id_zalo = str(user.get("userId"))
    return {
        "user_id": user_id_zalo,
        "display_name": user.get("displayName") or user.get("zaloName") or user_id_zalo,
        "zalo_name": user.get("zaloName") or None,
        "avatar_url": user.get("avatar") or user.get("avatarUrl") or None,
        "phone_e164": e164 if by == "phone" else None,
        "raw": user,
    }


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
    return {"ok": True, "result": result}


@router.get("/stickers")
async def get_stickers_detail(
    ids: str = Query(..., description="Danh sách sticker id, phân tách bằng dấu phẩy"),
    account_id: Optional[str] = Query(None),
    x_user_id: str = Header("default", alias="X-User-ID"),
):
    user_id = _normalize_user_id(account_id or x_user_id)
    auth = await load_zca_auth(user_id)
    if not auth:
        raise HTTPException(status_code=401, detail="Chưa có phiên ZCA hợp lệ. Hãy đăng nhập lại qua extension.")
    try:
        sticker_ids = [int(s.strip()) for s in ids.split(",") if s.strip()]
    except ValueError:
        raise HTTPException(status_code=400, detail="ids phải là danh sách số nguyên, phân tách bằng dấu phẩy")
    try:
        stickers = await get_zca_stickers_detail(auth, sticker_ids)
    except ZcaAuthExpiredError:
        raise HTTPException(status_code=401, detail=ZCA_SESSION_EXPIRED_DETAIL)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Không thể tra sticker: {exc}")
    return {"stickers": stickers}
