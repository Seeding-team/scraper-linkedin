"""Schemas for KPI Setup and PM Sync."""

from __future__ import annotations

from datetime import date
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class MetricItem(BaseModel):
    code: str
    name: str
    description: Optional[str] = None
    sort_order: Optional[int] = 0


class KpiTemplateLevelSchema(BaseModel):
    metric_code: str
    level_normal: float = 0
    level_high: float = 0
    level_critical: float = 0
    manday_normal: float = 0
    manday_high: float = 0
    manday_critical: float = 0


class KpiTemplateBonusRuleSchema(BaseModel):
    metric_code: str
    min_count: int
    bonus_manday: float
    requires_tier: str = "critical"


class KpiTemplateCreate(BaseModel):
    name: str
    is_active: bool = True
    levels: Optional[List[KpiTemplateLevelSchema]] = None
    bonus_rules: Optional[List[KpiTemplateBonusRuleSchema]] = None


class KpiTemplateUpdate(BaseModel):
    name: Optional[str] = None
    is_active: Optional[bool] = None
    levels: Optional[List[KpiTemplateLevelSchema]] = None
    bonus_rules: Optional[List[KpiTemplateBonusRuleSchema]] = None


class ApplyTemplateRequest(BaseModel):
    crm_team_id: str
    template_id: str
    week_start: str  # YYYY-MM-DD
    week_end: str    # YYYY-MM-DD
    skill_solution_id: Optional[int] = None
    skill_vendor_id: Optional[int] = None
    skill_solution_name: Optional[str] = None
    skill_vendor_name: Optional[str] = None


class AllocationUpdateItem(BaseModel):
    user_id: str
    weight_pct: float
    support_user_id: Optional[str] = None


class UpdateAllocationsRequest(BaseModel):
    allocations: List[AllocationUpdateItem]


class OverrideUpdateItem(BaseModel):
    user_id: str
    metric_code: str
    level_critical_override: Optional[float] = None


class UpdateOverridesRequest(BaseModel):
    overrides: List[OverrideUpdateItem]


class UpdateSessionSkillsRequest(BaseModel):
    skill_solution_id: int
    skill_vendor_id: int
    skill_solution_name: Optional[str] = None
    skill_vendor_name: Optional[str] = None


class KpiMemberPreview(BaseModel):
    user_id: str
    user_name: Optional[str] = None
    user_email: Optional[str] = None
    weight_pct: float
    support_user_id: Optional[str] = None
    support_user_name: Optional[str] = None
    support_user_email: Optional[str] = None
    metrics: Dict[str, Any]
    total_base_manday: float
    total_bonus_manday: float
    total_manday: float


class KpiSessionPreviewResponse(BaseModel):
    session_id: str
    team_id: str
    team_name: str
    week_start: str
    week_end: str
    status: str
    members: List[KpiMemberPreview]
    summary_by_metric: Dict[str, Any]

