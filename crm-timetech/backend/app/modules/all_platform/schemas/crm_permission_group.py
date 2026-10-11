"""Schemas cho "Nhom quyen" (CRM permission group/template) - tab moi trong
`/all-platform/admin/quan-ly-thanh-vien` (Account & Permission Center), theo
prototype markee_crm_account_permission_prototype_v4_full_flow.html."""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel


class CrmPermissionGroupCreateRequest(BaseModel):
    name: str
    status: str = "active"  # 'active' | 'draft'
    default_system_role: str = "member"  # 'member' | 'leader' | 'admin'
    default_scope: str = "personal"  # 'personal' | 'team' | 'deal_assigned' | 'workspace' | 'system'
    description: Optional[str] = None
    default_quote_business_role: Optional[str] = None  # 'presale' | 'sale' | 'both' | None
    default_can_approve_quotes: bool = False
    quote_cost_permission: str = "none"  # 'none' | 'read_only' | 'assigned' | 'all'
    quote_sell_permission: str = "none"
    quote_release_permission: str = "none"  # 'none' | 'assigned' | 'all'
    modules: list[str] = []


class CrmPermissionGroupUpdateRequest(BaseModel):
    name: Optional[str] = None
    status: Optional[str] = None
    default_system_role: Optional[str] = None
    default_scope: Optional[str] = None
    description: Optional[str] = None
    default_quote_business_role: Optional[str] = None
    default_can_approve_quotes: Optional[bool] = None
    quote_cost_permission: Optional[str] = None
    quote_sell_permission: Optional[str] = None
    quote_release_permission: Optional[str] = None
    modules: Optional[list[str]] = None
