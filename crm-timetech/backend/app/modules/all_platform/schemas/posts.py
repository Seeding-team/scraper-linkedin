"""Posts schemas for all-platform module."""

from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel


class GetAllPostsRequest(BaseModel):
    email: str
    date_from: Optional[str] = None
    date_to: Optional[str] = None
    intent: Optional[str] = None


class FilterPostsRequest(BaseModel):
    email: str
    date: Optional[str] = None
    date_from: Optional[str] = None
    date_to: Optional[str] = None
    intent: Optional[str] = None
    industry: Optional[str] = None
    team: Optional[str] = None
    tier: Optional[str] = None


class UnifiedPostsRequest(BaseModel):
    email: str
    platform: str = "all"
    date_from: Optional[str] = None
    date_to: Optional[str] = None
    intent: Optional[str] = None
    industry: Optional[str] = None
    team: Optional[str] = None
    tier: Optional[str] = None
    sort: str = "latest"
    page: int = 1
    page_size: int = 20


class UnifiedFilterRequest(BaseModel):
    email: str
    platform: str = "all"
    date: Optional[str] = None
    date_from: Optional[str] = None
    date_to: Optional[str] = None
    intent: Optional[str] = None
    industry: Optional[str] = None
    team: Optional[str] = None
    tier: Optional[str] = None
    icp: Optional[str] = None
    content_type: Optional[str] = None
    product_seeding: Optional[str] = None
    search: Optional[str] = None
    id_member: Optional[str] = None
    sort: str = "latest"
    page: int = 1
    page_size: int = 20


class SyncProgressRequest(BaseModel):
    email: str
    posts: list[dict[str, Any]]
