"""Seeding KPI schemas for all-platform module."""

from __future__ import annotations

from pydantic import BaseModel
from typing import Optional, List


class SeedingMarkSaveRequest(BaseModel):
    email_member: str
    link_post: str
    name: Optional[str] = None
    link_comment: Optional[str] = None
    name_profile: Optional[str] = None
    platform: str = "Facebook"
    content: Optional[str] = None
    profile_id: Optional[str] = None
    facebook_name: Optional[str] = None
    current_day: Optional[str] = None  # YYYY-MM-DD
    id_social_account: Optional[str] = None
    id_platform: Optional[int] = None


class SeedingMarkVerifyRequest(BaseModel):
    email_member: str
    link_post: str
    name: Optional[str] = None
    link_comment: Optional[str] = None
    name_profile: Optional[str] = None
    platform: str = "Facebook"
    content: Optional[str] = None
    profile_id: Optional[str] = None
    facebook_name: Optional[str] = None
    id_social_account: Optional[str] = None
    id_platform: Optional[int] = None
    id_post: Optional[str] = None


class SeedingMarkGetAllRequest(BaseModel):
    email_member: str


class SeedingCountRequest(BaseModel):
    email_member: str
    profile_id: Optional[str] = None
    facebook_name: Optional[str] = None
    date_from: Optional[str] = None
    date_to: Optional[str] = None


class SeedingCountResponse(BaseModel):
    verified_count: int
    total_count: int
    kpi_target: int
    items: List[dict]


class SeedingKpiSaveRequest(BaseModel):
    email_member: str
    name: Optional[str] = None
    link_post: str
    link_comment: Optional[str] = None
    platform: str = "Facebook"
    content: Optional[str] = None
    profile_id: Optional[str] = None
    facebook_name: Optional[str] = None
    current_day: Optional[str] = None


class KpiTargetRequest(BaseModel):
    email_member: str
    date_from: Optional[str] = None
    date_to: Optional[str] = None
    id_team: Optional[str] = None
