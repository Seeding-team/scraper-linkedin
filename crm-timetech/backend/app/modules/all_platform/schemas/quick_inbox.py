"""Quick Inbox template library schemas — platform-agnostic."""

from __future__ import annotations

from pydantic import BaseModel
from typing import Optional


class QuickInboxAddRequest(BaseModel):
    title: str
    label: str = "Khác"
    content: str
    content_with_post: Optional[str] = None
    id_member: Optional[str] = None


class QuickInboxUpdateRequest(BaseModel):
    id: str
    title: Optional[str] = None
    label: Optional[str] = None
    content: Optional[str] = None
    content_with_post: Optional[str] = None


class QuickInboxReorderRequest(BaseModel):
    id: str
    direction: str  # up | down
