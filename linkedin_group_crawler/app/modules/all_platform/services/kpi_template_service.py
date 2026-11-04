"""KPI Template Service: CRUD operations for KPI Templates, Levels and Bonus Rules."""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional
from app.core.supabase_client import get_supabase_client
from app.modules.all_platform.schemas.kpi_setup import (
    KpiTemplateBonusRuleSchema,
    KpiTemplateCreate,
    KpiTemplateLevelSchema,
    KpiTemplateUpdate,
)
from app.modules.all_platform.services.kpi_metric_service import validate_metric_code

logger = logging.getLogger(__name__)


def list_templates(active_only: bool = False) -> List[Dict[str, Any]]:
    """Lay danh sach cac mau KPI kem theo so luong level va bonus rule."""
    supabase = get_supabase_client()
    query = supabase.table("kpi_templates").select(
        "id, name, is_active, created_by, created_at, updated_at, "
        "kpi_template_levels(id, metric_code, level_normal, level_high, level_critical, manday_normal, manday_high, manday_critical), "
        "kpi_template_bonus_rules(id, metric_code, min_count, bonus_manday, requires_tier)"
    )
    if active_only:
        query = query.eq("is_active", True)
    
    resp = query.order("created_at", desc=True).execute()
    return resp.data or []


def get_template(template_id: str) -> Optional[Dict[str, Any]]:
    """Lay chi tiet 1 mau KPI kem day du levels va bonus_rules."""
    supabase = get_supabase_client()
    resp = (
        supabase.table("kpi_templates")
        .select(
            "id, name, is_active, created_by, created_at, updated_at, "
            "kpi_template_levels(id, metric_code, level_normal, level_high, level_critical, manday_normal, manday_high, manday_critical), "
            "kpi_template_bonus_rules(id, metric_code, min_count, bonus_manday, requires_tier)"
        )
        .eq("id", template_id)
        .limit(1)
        .execute()
    )
    data = resp.data or []
    return data[0] if data else None


def create_template(payload: KpiTemplateCreate, user_id: Optional[str] = None) -> Dict[str, Any]:
    """Tao moi 1 template KPI kem theo levels va bonus rules neu co."""
    supabase = get_supabase_client()
    insert_data = {
        "name": payload.name,
        "is_active": payload.is_active,
        "created_by": user_id,
    }
    res = supabase.table("kpi_templates").insert(insert_data).execute()
    if not res.data:
        raise ValueError("Khong the tao mau KPI moi")
    
    template = res.data[0]
    template_id = template["id"]

    # Them levels neu co
    if payload.levels:
        upsert_template_levels(template_id, payload.levels)

    # Them bonus rules neu co
    if payload.bonus_rules:
        upsert_template_bonus_rules(template_id, payload.bonus_rules)

    return get_template(template_id) or template


def update_template(template_id: str, payload: KpiTemplateUpdate) -> Dict[str, Any]:
    """Cap nhat template KPI, levels va bonus rules."""
    supabase = get_supabase_client()
    update_data: Dict[str, Any] = {"updated_at": "now()"}
    if payload.name is not None:
        update_data["name"] = payload.name
    if payload.is_active is not None:
        update_data["is_active"] = payload.is_active

    supabase.table("kpi_templates").update(update_data).eq("id", template_id).execute()

    if payload.levels is not None:
        upsert_template_levels(template_id, payload.levels)

    if payload.bonus_rules is not None:
        upsert_template_bonus_rules(template_id, payload.bonus_rules)

    return get_template(template_id) or {"id": template_id}


def delete_template(template_id: str) -> bool:
    """Xoa 1 template KPI (cac bang con se tu dong CASCADE theo foreign key)."""
    supabase = get_supabase_client()
    supabase.table("kpi_templates").delete().eq("id", template_id).execute()
    return True


def upsert_template_levels(template_id: str, levels: List[KpiTemplateLevelSchema]) -> List[Dict[str, Any]]:
    """Ghi de / cap nhat danh sach cac mốc chi tieu cho template."""
    supabase = get_supabase_client()
    # Xoa cac level cu cua template nay roi chen lai
    supabase.table("kpi_template_levels").delete().eq("template_id", template_id).execute()

    if not levels:
        return []

    rows = []
    for lvl in levels:
        if not validate_metric_code(lvl.metric_code):
            logger.warning(f"Metric code khong hop le khi luu level: {lvl.metric_code}")
        rows.append({
            "template_id": template_id,
            "metric_code": lvl.metric_code,
            "level_normal": lvl.level_normal,
            "level_high": lvl.level_high,
            "level_critical": lvl.level_critical,
            "manday_normal": lvl.manday_normal,
            "manday_high": lvl.manday_high,
            "manday_critical": lvl.manday_critical,
        })

    resp = supabase.table("kpi_template_levels").insert(rows).execute()
    return resp.data or []


def upsert_template_bonus_rules(template_id: str, rules: List[KpiTemplateBonusRuleSchema]) -> List[Dict[str, Any]]:
    """Ghi de / cap nhat danh sach bonus rules cho template."""
    supabase = get_supabase_client()
    supabase.table("kpi_template_bonus_rules").delete().eq("template_id", template_id).execute()

    if not rules:
        return []

    rows = []
    for r in rules:
        if not validate_metric_code(r.metric_code):
            logger.warning(f"Metric code khong hop le khi luu bonus rule: {r.metric_code}")
        rows.append({
            "template_id": template_id,
            "metric_code": r.metric_code,
            "min_count": r.min_count,
            "bonus_manday": r.bonus_manday,
            "requires_tier": r.requires_tier or "critical",
        })

    resp = supabase.table("kpi_template_bonus_rules").insert(rows).execute()
    return resp.data or []

