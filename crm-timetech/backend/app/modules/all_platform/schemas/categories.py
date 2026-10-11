"""Categories schemas for all-platform module."""

from __future__ import annotations

from pydantic import BaseModel
from typing import Optional


class CategoryAddRequest(BaseModel):
    category_type: str  # intent | industry | tier | team | icp | crm_position | ...
    code: str
    name: Optional[str] = None
    description: Optional[str] = None
    platform: str = "general"
    is_active: bool = True
    sort_order: Optional[int] = None


class CategoryUpdateRequest(BaseModel):
    id: str
    category_type: Optional[str] = None
    code: Optional[str] = None
    name: Optional[str] = None
    description: Optional[str] = None
    # migration 079 — soft-deactivate toggle (currently only exposed in the
    # admin UI for category_type='crm_position'; see CrmCategorySections).
    is_active: Optional[bool] = None
    sort_order: Optional[int] = None

class CategoryDeleteRequest(BaseModel):
    id: str
