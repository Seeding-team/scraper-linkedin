"""Schemas for KPI Setup and PM Sync."""

from __future__ import annotations

from datetime import date
from typing import Any, Dict, List, Optional, Union
from pydantic import BaseModel, Field, model_validator


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
    normal_count: Optional[float] = None
    high_count: Optional[float] = None
    critical_count: Optional[float] = None
    manday_normal: float = 0
    manday_high: float = 0
    manday_critical: float = 0

    @model_validator(mode="before")
    @classmethod
    def resolve_aliases(cls, data: Any) -> Any:
        if isinstance(data, dict):
            # Tuong thich giua cac ten field normal_count / level_normal
            if "normal_count" in data and ("level_normal" not in data or data.get("level_normal") in (0, 0.0, None)):
                data["level_normal"] = data["normal_count"]
            elif "level_normal" in data and ("normal_count" not in data or data.get("normal_count") in (0, 0.0, None)):
                data["normal_count"] = data["level_normal"]

            if "high_count" in data and ("level_high" not in data or data.get("level_high") in (0, 0.0, None)):
                data["level_high"] = data["high_count"]
            elif "level_high" in data and ("high_count" not in data or data.get("high_count") in (0, 0.0, None)):
                data["high_count"] = data["level_high"]

            if "critical_count" in data and ("level_critical" not in data or data.get("level_critical") in (0, 0.0, None)):
                data["level_critical"] = data["critical_count"]
            elif "level_critical" in data and ("critical_count" not in data or data.get("critical_count") in (0, 0.0, None)):
                data["critical_count"] = data["level_critical"]
        return data


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
    week_start: Union[str, date]  # YYYY-MM-DD
    week_end: Optional[Union[str, date]] = None  # YYYY-MM-DD, tu tinh neu khong gui
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

