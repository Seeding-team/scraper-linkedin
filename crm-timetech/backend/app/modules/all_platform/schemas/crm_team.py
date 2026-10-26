"""Schemas cho "Team CRM" - KHAC HAN bang `teams`/`team_type` dang dung cho
KPI/seeding noi bo (xem docstring crm_permission_service.py). Team CRM dat
ten theo Leader, co thuoc tinh mo ta (segment/khoi chuyen mon/nganh/khu vuc) -
theo ghi chu thiet ke phien ban moi hon prototype
markee_crm_account_permission_prototype_v4_full_flow.html."""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel


class CrmTeamCreateRequest(BaseModel):
    name: Optional[str] = None  # None -> tu sinh "Team {ten Leader}" o service
    code: Optional[str] = None
    leader_user_id: Optional[str] = None
    status: str = "active"  # 'active' | 'inactive'
    segment: Optional[str] = None  # 'enterprise'|'smb'|'mid_market'|'government'|'mixed'
    function_area: Optional[str] = None  # 'sales'|'marketing'|'presale'|'infrastructure'|'software'|'security'|'finance'|'operations'
    industry: Optional[str] = None
    region: Optional[str] = None
    description: Optional[str] = None


class CrmTeamUpdateRequest(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    leader_user_id: Optional[str] = None
    status: Optional[str] = None
    segment: Optional[str] = None
    function_area: Optional[str] = None
    industry: Optional[str] = None
    region: Optional[str] = None
    description: Optional[str] = None


class CrmTeamMemberAddRequest(BaseModel):
    user_id: str
