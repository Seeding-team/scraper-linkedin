"""Routes for selective inbox sharing — KPI verification.

Member tick cho phép leader xem 1 conversation Zalo cụ thể. Leader có thể
truy vấn danh sách conversation được share để verify "Tin nhắn KPI".
Sau khi leader verify, share mới được tính vào kpi_inbox_current.

Endpoints:
    POST /api/all-platform/zalo/inbox-share/toggle
        Body: {account_id, conversation_id, is_active, member_email, note?}
        → Upsert 1 row.

    POST /api/all-platform/zalo/inbox-share/list
        Body: {member_email, is_active?}
        → List conversations mà member đã share.

    POST /api/all-platform/zalo/inbox-share/leader-view
        Body: {leader_email, member_email?}
        → List conversations mà leader có quyền xem (đã join account label).
        Trả thêm trường verified_at / verified_by.

    POST /api/all-platform/zalo/inbox-share/verify
        Body: {row_id, leader_email, note?}
        → Leader xác minh 1 share conversation (mới được tính KPI).

    POST /api/all-platform/zalo/inbox-share/unverify
        Body: {row_id}
        → Leader thu hồi verify.

    POST /api/all-platform/zalo/inbox-share/count-verified
        Body: {member_email, start_date, end_date}
        → Đếm số share đã verify trong khoảng (dùng cho dashboard).

    POST /api/all-platform/zalo/inbox-share/bulk-sync
        Body: {member_email, shares: [{account_id, conversation_id, is_active, note?}, ...]}
        → Sync hàng loạt (idempotent).
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, BackgroundTasks, HTTPException
from pydantic import BaseModel, Field

from app.modules.all_platform.auth_deps import get_authenticated_caller_email
from app.modules.all_platform.zalo.api.security import verify_zalo_api_key
from app.modules.all_platform.zalo.services.supabase_service import get_user_role
from app.modules.all_platform.zalo.services.supabase_inbox_share_service import (
    bulk_sync_shares,
    count_verified_inbox_shares,
    list_shared_conversations_by_member,
    list_shared_conversations_for_leader,
    toggle_inbox_share,
    unverify_inbox_share,
    verify_inbox_share,
    toggle_lead_inbox_share,
    revoke_all_shares,
)


router = APIRouter(
    prefix="/inbox-share",
    tags=["zalo-inbox-share"],
    dependencies=[Depends(verify_zalo_api_key)],
)


class ToggleShareRequest(BaseModel):
    account_id: str = Field(..., min_length=1, description="Zalo account_id")
    conversation_id: str = Field(..., min_length=1, description="Zalo conversation_id (group/thread)")
    member_email: str = Field(..., min_length=3, description="Email member (app_users.email)")
    is_active: bool = Field(True, description="True = bật share, False = tắt")
    shared_role: str = Field("leader", description="Mặc định 'leader' cho luồng KPI")
    note: Optional[str] = Field(None, max_length=500, description="Ghi chú tuỳ chọn")


class ListMineRequest(BaseModel):
    member_email: str = Field(..., min_length=3)
    is_active: Optional[bool] = Field(True)


class LeaderViewRequest(BaseModel):
    leader_email: str = Field(..., min_length=3)
    member_email: Optional[str] = Field(None, description="Lọc theo member cụ thể (optional)")


class BulkSyncRequest(BaseModel):
    member_email: str = Field(..., min_length=3)
    shares: List[Dict[str, Any]] = Field(default_factory=list, description="List share items")
    shared_role: str = Field("leader")


class VerifyRequest(BaseModel):
    row_id: int = Field(..., ge=1, description="ID của zalo_conversation_permissions")
    leader_email: str = Field(..., min_length=3)
    note: Optional[str] = Field(None, max_length=500)


class UnverifyRequest(BaseModel):
    row_id: int = Field(..., ge=1)


class ToggleLeadRequest(BaseModel):
    row_id: int = Field(..., ge=1)
    leader_email: str = Field(..., min_length=3)
    is_lead: bool = Field(..., description="True = có tiềm năng, False = không có tiềm năng")


class CountVerifiedRequest(BaseModel):
    member_email: str = Field(..., min_length=3)
    start_date: str = Field(..., description="ISO date hoặc ISO datetime (bao gồm)")
    end_date: str = Field(..., description="ISO date hoặc ISO datetime (bao gồm)")


async def _require_leader_or_admin(caller_email: Optional[str]) -> str:
    """403 nếu người gọi không phải leader/admin THẬT (tra role từ DB theo email
    đã xác thực bằng JWT) — trước đây verify()/toggle-lead không check gì cả,
    `leader_email` chỉ là 1 field trong body do client tự điền. Một member tự
    điền leader_email = email của chính mình là tự duyệt KPI Inbox cho bản thân
    được, không cần là leader thật."""
    if not caller_email:
        raise HTTPException(status_code=401, detail="Cần đăng nhập")
    role = await get_user_role(caller_email)
    if role not in ("admin", "leader"):
        raise HTTPException(status_code=403, detail="Chỉ leader/admin được xác minh KPI Inbox")
    return caller_email


async def _background_fetch_20_messages(account_id: str, conversation_id: str):
    from app.modules.all_platform.zalo.services.zca_auth_store import load_zca_auth
    from app.modules.all_platform.zalo.services.zca_api_bridge import sync_zca_group_old_messages
    from app.modules.all_platform.zalo.services.supabase_service import save_listener_messages, resolve_thread_type
    from loguru import logger
    
    try:
        auth = await load_zca_auth(account_id)
        if not auth:
            return
        ttype = await resolve_thread_type(account_id, conversation_id)
        messages = await sync_zca_group_old_messages(auth, conversation_id, thread_type=ttype, count=50)
        if not messages and ttype == 1:
            messages = await sync_zca_group_old_messages(auth, conversation_id, thread_type=0, count=50)
        if messages:
            await save_listener_messages(
                user_id=account_id,
                group_id=conversation_id,
                group_name=conversation_id,
                messages=messages,
                increment_unread=False,
            )
    except Exception as exc:
        logger.warning(f"Could not background fetch 20 messages for {conversation_id}: {exc}")


@router.post("/toggle")
def share_toggle(payload: ToggleShareRequest, background_tasks: BackgroundTasks) -> Dict[str, Any]:
    try:
        result = toggle_inbox_share(
            account_id=payload.account_id,
            conversation_id=payload.conversation_id,
            member_email=payload.member_email,
            shared_role=payload.shared_role,
            is_active=payload.is_active,
            note=payload.note,
        )
        if not result.get("ok"):
            return {
                "success": False,
                "message": result.get("error", "Unknown error"),
                "leader_ids": result.get("leader_ids", []),
            }
            
        if payload.is_active:
            background_tasks.add_task(_background_fetch_20_messages, payload.account_id, payload.conversation_id)
            
        return {
            "success": True,
            "is_active": result.get("is_active"),
            "row": result.get("row"),
            "data": {"is_active": result.get("is_active"), "row": result.get("row")},
        }
    except Exception as exc:
        return {"success": False, "message": str(exc)}


@router.post("/list")
def share_list_mine(payload: ListMineRequest) -> Dict[str, Any]:
    try:
        items = list_shared_conversations_by_member(
            member_email=payload.member_email,
            is_active=payload.is_active,
        )
        # Trả CẢ items (flat) và data.items (bọc) để tương thích ngược với FE
        # đang đọc 2 kiểu khác nhau.
        return {
            "success": True,
            "items": items,
            "total": len(items),
            "data": {"items": items, "total": len(items)},
        }
    except Exception as exc:
        return {"success": False, "message": str(exc), "items": [], "total": 0}


@router.post("/leader-view")
def share_leader_view(payload: LeaderViewRequest) -> Dict[str, Any]:
    try:
        items = list_shared_conversations_for_leader(
            leader_email=payload.leader_email,
            member_email=payload.member_email,
        )
        return {
            "success": True,
            "items": items,
            "total": len(items),
            "data": {"items": items, "total": len(items)},
        }
    except Exception as exc:
        return {"success": False, "message": str(exc), "items": [], "total": 0}


@router.post("/bulk-sync")
def share_bulk_sync(payload: BulkSyncRequest, background_tasks: BackgroundTasks) -> Dict[str, Any]:
    try:
        result = bulk_sync_shares(
            member_email=payload.member_email,
            shares=payload.shares,
            shared_role=payload.shared_role,
        )
        
        if result.get("ok"):
            for share in payload.shares:
                if share.get("is_active"):
                    acc_id = share.get("account_id")
                    conv_id = share.get("conversation_id")
                    if acc_id and conv_id:
                        background_tasks.add_task(_background_fetch_20_messages, acc_id, conv_id)
                        
        return {"success": result.get("ok", False), **result}
    except Exception as exc:
        return {"success": False, "message": str(exc)}


@router.post("/verify")
async def share_verify(
    payload: VerifyRequest,
    caller_email: Optional[str] = Depends(get_authenticated_caller_email),
) -> Dict[str, Any]:
    """Leader xác minh 1 share conversation.

    Sau khi verify, conversation này mới được tính vào kpi_inbox_current
    (chỉ trong khoảng kpi_tracker.start_date..end_date).
    """
    try:
        verified_email = await _require_leader_or_admin(caller_email)
        result = verify_inbox_share(
            row_id=payload.row_id,
            # Dùng email đã xác thực (KHÔNG dùng payload.leader_email) — tránh
            # trường hợp caller là leader thật nhưng ghi "verified_by" thành
            # email người khác.
            leader_email=verified_email,
            note=payload.note,
        )
        resp = {"success": result.get("ok", False), **result}
        if result.get("ok") and "row" in result:
            resp["data"] = {"row": result["row"]}
        return resp
    except HTTPException:
        # Không nuốt 401/403 của _require_leader_or_admin thành 200 giả — phải
        # để FastAPI trả đúng status code, không phải {success:false} lẫn vào
        # lỗi nghiệp vụ bình thường.
        raise
    except Exception as exc:
        return {"success": False, "message": str(exc)}


@router.post("/unverify")
def share_unverify(payload: UnverifyRequest) -> Dict[str, Any]:
    """Leader thu hồi verify (set verified_at = NULL)."""
    try:
        result = unverify_inbox_share(row_id=payload.row_id)
        resp = {"success": result.get("ok", False), **result}
        if result.get("ok") and "row" in result:
            resp["data"] = {"row": result["row"]}
        return resp
    except Exception as exc:
        return {"success": False, "message": str(exc)}


@router.post("/toggle-lead")
async def share_toggle_lead(
    payload: ToggleLeadRequest,
    caller_email: Optional[str] = Depends(get_authenticated_caller_email),
) -> Dict[str, Any]:
    """Leader đánh dấu conversation có tiềm năng hay không."""
    try:
        verified_email = await _require_leader_or_admin(caller_email)
        result = toggle_lead_inbox_share(
            row_id=payload.row_id,
            leader_email=verified_email,
            is_lead=payload.is_lead,
        )
        resp = {"success": result.get("ok", False), **result}
        if result.get("ok") and "row" in result:
            resp["data"] = {"row": result["row"]}
        return resp
    except HTTPException:
        raise
    except Exception as exc:
        return {"success": False, "message": str(exc)}


@router.post("/count-verified")
def share_count_verified(payload: CountVerifiedRequest) -> Dict[str, Any]:
    """Đếm số share conversation đã verify cho 1 member trong khoảng.

    Hàm này KHÔNG tự lọc theo kpi_tracker — caller (FE) truyền start_date/end_date
    đã được lookup từ kpi_tracker tương ứng.
    """
    try:
        result = count_verified_inbox_shares(
            member_email=payload.member_email,
            start_dt=payload.start_date,
            end_dt=payload.end_date,
        )
        return {"success": result.get("ok", False), **result}
    except Exception as exc:
        return {"success": False, "message": str(exc)}


class RevokeAllRequest(BaseModel):
    account_id: str = Field(..., min_length=1, description="Zalo account_id")
    member_email: str = Field(..., min_length=3, description="Email member")


@router.post("/revoke-all")
def share_revoke_all(payload: RevokeAllRequest) -> Dict[str, Any]:
    """Hủy chia sẻ tất cả các cuộc hội thoại chưa được duyệt KPI."""
    try:
        result = revoke_all_shares(
            account_id=payload.account_id,
            member_email=payload.member_email,
        )
        return {
            "success": result.get("ok", False),
            "count": result.get("count", 0),
            "message": result.get("error"),
        }
    except Exception as exc:
        return {"success": False, "message": str(exc)}

