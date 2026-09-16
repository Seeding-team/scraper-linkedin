"""Mẫu nhắn nhanh tự soạn (migration 139) — trước đây chỉ có 6 mẫu HARDCODE
trong code FE (QUICK_REPLIES ở ZaloChatView.tsx), không ai lưu thêm được.
Yêu cầu 2026-09-17: "giữ tin nhắn mời mua hàng lại" — cho lưu tin đang soạn
thành mẫu dùng lại nhiều lần, theo TÀI KHOẢN Zalo (dùng chung giữa các nhân
viên cùng quản lý 1 tài khoản, giống mọi tính năng khác của module này).
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field

from app.modules.all_platform.auth_deps import get_authenticated_caller_email
from app.modules.all_platform.zalo.api.security import verify_zalo_api_key
from app.modules.all_platform.zalo.services.supabase_service import (
    _rest,
    get_app_user_id_by_email,
)

router = APIRouter(
    prefix="/quick-replies",
    tags=["zalo-quick-replies"],
    dependencies=[Depends(verify_zalo_api_key)],
)


class QuickReply(BaseModel):
    id: int
    account_id: str
    label: str
    text: str
    shortcut: Optional[str] = None
    created_at: Optional[str] = None


class CreateQuickReplyRequest(BaseModel):
    label: str = Field(..., min_length=1, max_length=100)
    text: str = Field(..., min_length=1, max_length=4000)
    shortcut: Optional[str] = Field(None, max_length=50)


@router.get("", response_model=List[QuickReply])
async def list_quick_replies(
    account_id: str = Query(...),
    x_user_id: str = Header("default", alias="X-User-ID"),
):
    rows = await _rest(
        "GET",
        "zalo_quick_replies",
        params={
            "select": "id,account_id,label,text,shortcut,created_at",
            "account_id": f"eq.{account_id}",
            "order": "created_at.desc",
            "limit": "200",
        },
    ) or []
    return rows


@router.post("", response_model=QuickReply)
async def create_quick_reply(
    body: CreateQuickReplyRequest,
    account_id: str = Query(...),
    caller_email: Optional[str] = Depends(get_authenticated_caller_email),
):
    created_by = await get_app_user_id_by_email(caller_email) if caller_email else None
    shortcut = (body.shortcut or "").strip() or None
    if shortcut and not shortcut.startswith("/"):
        shortcut = f"/{shortcut}"
    rows = await _rest(
        "POST",
        "zalo_quick_replies",
        json={
            "account_id": account_id,
            "label": body.label.strip(),
            "text": body.text.strip(),
            "shortcut": shortcut,
            "created_by": created_by,
        },
        prefer="return=representation",
    ) or []
    if not rows:
        raise HTTPException(status_code=500, detail="Không thể lưu mẫu nhắn nhanh.")
    return rows[0]


@router.delete("/{reply_id}")
async def delete_quick_reply(
    reply_id: int,
    account_id: str = Query(...),
):
    await _rest(
        "DELETE",
        "zalo_quick_replies",
        params={"id": f"eq.{reply_id}", "account_id": f"eq.{account_id}"},
    )
    return {"ok": True}
