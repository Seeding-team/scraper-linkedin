"""Pydantic schemas for Post Call Results."""

from __future__ import annotations

from typing import Optional
from pydantic import BaseModel, Field


class PostCallResultUpdate(BaseModel):
    result_code: str = Field(..., description="Mã kết quả liên hệ (từ categories call_result)")
    platform: Optional[str] = Field("facebook", description="Nền tảng (facebook, linkedin, threads)")


class PostCallResultNoteUpdate(BaseModel):
    """Việc 3: cập nhật riêng cột `note` — KHÔNG đổi result_code, KHÔNG tạo bản ghi mới (yêu
    cầu bài viết đã có kết quả liên hệ từ trước)."""

    note: str = Field("", description="Ghi chú lý do — rỗng nghĩa là xoá ghi chú hiện có")
    platform: Optional[str] = Field("facebook", description="Nền tảng (facebook, linkedin, threads)")

