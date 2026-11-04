"""KPI Metric Service.

Nguon su that duy nhat cho danh sach metric KPI trong he thong Seeding:
Lay dong tu bang `categories` WHERE category_type='post_evaluation'
AND is_active=true AND code != 'chua-danh-gia'.
KHONG hardcode ma hoac so luong metric o bat ky dau.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional
from app.core.supabase_client import get_supabase_client

logger = logging.getLogger(__name__)


def get_valid_metrics() -> List[Dict[str, Any]]:
    """Lay danh sach cac chi so KPI hop le tu bang categories.
    
    Loai tru ma 'chua-danh-gia', chi lay cac dong dang active.
    """
    supabase = get_supabase_client()
    try:
        resp = (
            supabase.table("categories")
            .select("id, code, name, description, sort_order")
            .eq("category_type", "post_evaluation")
            .eq("is_active", True)
            .neq("code", "chua-danh-gia")
            .order("sort_order", desc=False)
            .execute()
        )
        data = resp.data or []
        # Fallback neu DB chua co dong nao
        if not data:
            logger.warning("Khong tim thay categories post_evaluation active nao trong DB")
        return [
            {
                "code": row["code"],
                "name": row.get("name") or row["code"],
                "description": row.get("description") or "",
                "sort_order": row.get("sort_order") or 0,
            }
            for row in data
        ]
    except Exception as e:
        logger.error(f"Loi khi lay metrics tu categories: {e}")
        return []


def get_valid_metric_codes() -> List[str]:
    """Lay danh sach ma chi so hop le."""
    metrics = get_valid_metrics()
    return [m["code"] for m in metrics]


def validate_metric_code(code: str) -> bool:
    """Kiem tra ma chi so co hop le khong."""
    if not code:
        return False
    return code in get_valid_metric_codes()

