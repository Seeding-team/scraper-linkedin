"""Members (HR roster) schemas for all-platform module."""

from __future__ import annotations

from pydantic import BaseModel
from typing import List, Optional


class MemberCreateRequest(BaseModel):
    display_name: str
    full_name: str
    email: Optional[str] = None
    telegram_username: Optional[str] = None
    phone: Optional[str] = None
    birth_date: Optional[str] = None
    gender: Optional[str] = None
    team: Optional[str] = None
    position: Optional[str] = None
    department: Optional[str] = None
    experience_year: Optional[int] = 0
    linked_user_id: Optional[str] = None
    linked_user_id_2: Optional[str] = None
    skill_ids: Optional[List[str]] = None
    leader_name: Optional[str] = None
    leader_email: Optional[str] = None
    cv_link: Optional[str] = None
    employment_status: Optional[str] = None


class MemberUpdateRequest(BaseModel):
    id: str
    display_name: Optional[str] = None
    full_name: Optional[str] = None
    email: Optional[str] = None
    telegram_username: Optional[str] = None
    phone: Optional[str] = None
    birth_date: Optional[str] = None
    gender: Optional[str] = None
    team: Optional[str] = None
    position: Optional[str] = None
    department: Optional[str] = None
    experience_year: Optional[int] = None
    linked_user_id: Optional[str] = None
    linked_user_id_2: Optional[str] = None
    skill_ids: Optional[List[str]] = None
    leader_name: Optional[str] = None
    leader_email: Optional[str] = None
    cv_link: Optional[str] = None
    employment_status: Optional[str] = None


class MemberDeleteRequest(BaseModel):
    id: str
