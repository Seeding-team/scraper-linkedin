"""Scheduled comment schemas."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from datetime import timedelta

from pydantic import BaseModel, field_validator


class CreateScheduledCommentRequest(BaseModel):
    id_post_fb: Optional[str] = None
    id_post_li: Optional[str] = None
    platform: str
    post_url: str
    group_name: Optional[str] = None
    post_content: Optional[str] = None
    id_social_account: Optional[str] = None
    comment_content: Optional[str] = None
    ai_generated: bool = False
    scheduled_at: datetime

    @field_validator("platform")
    @classmethod
    def validate_platform(cls, v: str) -> str:
        if v not in ("facebook", "linkedin", "youtube"):
            raise ValueError("platform must be 'facebook', 'linkedin', or 'youtube'")
        return v

    @field_validator("scheduled_at")
    @classmethod
    def validate_future(cls, v: datetime) -> datetime:
        if v + timedelta(seconds=5) <= datetime.now(timezone.utc):
            raise ValueError("scheduled_at must be in the future")
        return v


class UpdateScheduledCommentRequest(BaseModel):
    comment_content: Optional[str] = None
    id_social_account: Optional[str] = None
    scheduled_at: Optional[datetime] = None


class AiPreviewRequest(BaseModel):
    post_content: str


class ScheduledCommentListQuery(BaseModel):
    status: Optional[str] = None
    platform: Optional[str] = None
    page: int = 1
    limit: int = 20
