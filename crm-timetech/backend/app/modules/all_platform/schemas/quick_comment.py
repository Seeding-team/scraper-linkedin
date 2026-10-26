"""Quick Comment template library schemas — platform-agnostic."""

from __future__ import annotations

from pydantic import BaseModel
from typing import Optional


class QuickCommentAddRequest(BaseModel):
    title: str
    label: str = "Khác"
    content: str
    platform: str = "all"  # all | facebook | linkedin | youtube
    id_member: Optional[str] = None


class QuickCommentUpdateRequest(BaseModel):
    id: str
    title: Optional[str] = None
    label: Optional[str] = None
    content: Optional[str] = None
    platform: Optional[str] = None


class QuickCommentReorderRequest(BaseModel):
    id: str
    direction: str  # up | down
