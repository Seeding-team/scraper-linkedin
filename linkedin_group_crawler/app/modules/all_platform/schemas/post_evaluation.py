"""Schemas for Post Evaluation / Quick Review feature."""

from __future__ import annotations

from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


class PostEvaluationUpdate(BaseModel):
    evaluation_code: str = Field(..., min_length=1, description="Mã đánh giá (phu-hop, khong-phu-hop, can-nhac, chua-danh-gia)")
    platform: Optional[str] = Field("facebook", description="Platform cua bai viet (facebook, linkedin, threads)")
    reason: Optional[str] = None
    summary: Optional[str] = None
    exclude_keyword_exempt: Optional[bool] = None


class BatchRejectRequest(BaseModel):
    post_ids: list[str] = Field(..., min_length=1, description="Danh sach post_id can danh gia khong-phu-hop")
    platform: Optional[str] = Field(None, description="Platform neu ap dung chung (facebook, linkedin, threads)")
    reason: Optional[str] = Field("Hoàn tất trang Review Nhanh", description="Ly do danh gia hang loat")


class UndoBatchRejectRequest(BaseModel):
    undo_token: str = Field(..., min_length=1, description="Token batch_id de hoan tac buoc Review Nhanh gan nhat")


class PostEvaluationResponse(BaseModel):
    id: Optional[str] = None
    post_id: str
    platform: str
    evaluation_code: str
    reason: Optional[str] = None
    summary: Optional[str] = None
    exclude_keyword_exempt: bool = False
    evaluated_by: Optional[str] = None
    evaluated_at: Optional[datetime] = None

