"""FB Inbox Account schemas."""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class FbInboxAccountBase(BaseModel):
    """Base schema for FB inbox account."""
    user_id: str = Field(..., description="Seeder service user_id (VD: fb_10001)")
    fb_user_id: Optional[str] = Field(None, description="Facebook UID thật (VD: 100000123456)")
    account_label: Optional[str] = Field(None, description="Tên hiển thị do member đặt")


class FbInboxAccountCreate(FbInboxAccountBase):
    """Schema để tạo FB inbox account mới."""
    pass


class FbInboxAccountUpdate(BaseModel):
    """Schema để cập nhật FB inbox account."""
    fb_user_id: Optional[str] = None
    account_label: Optional[str] = None
    is_active: Optional[bool] = None


class FbInboxAccountResponse(FbInboxAccountBase):
    """Schema response cho FB inbox account."""
    id: str
    id_member: str
    is_active: bool
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class FbInboxAccountListResponse(BaseModel):
    """Schema response cho danh sách FB inbox accounts."""
    accounts: list[FbInboxAccountResponse]
    total: int


class ResolveMemberRequest(BaseModel):
    """Schema để resolve user_id -> id_member."""
    user_id: str = Field(..., description="Seeder service user_id")


class ResolveMemberResponse(BaseModel):
    """Response cho việc resolve user_id -> id_member."""
    user_id: str
    id_member: Optional[str] = None
    found: bool = False
    message: str = "Not found"
