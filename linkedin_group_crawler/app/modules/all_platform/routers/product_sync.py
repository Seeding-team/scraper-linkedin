"""Read-only product catalog snapshot for external systems (Tech Support).

Endpoint nay CHI DOC danh muc `service_catalog_items` va tra ve dung cay
group -> children ma he thong Tech Support dang dung. Khong loc workspace
(instances=None): Tech Support can toan bo danh muc dung chung cua CRM.

Auth: static `X-Sync-Api-Key` (PRODUCT_SYNC_API_KEY), TACH BIET voi JWT
nhan vien va voi web-intake key. Khong doc/ghi du lieu khach hang.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends

from app.modules.all_platform.auth_deps import require_product_sync_api_key
from app.modules.all_platform.schemas.common import BaseResponse
from app.modules.all_platform.services.supabase_service_catalog_service import (
    list_service_catalog_items_scoped,
)

router = APIRouter()


@router.get("/products")
def sync_products(_caller: str = Depends(require_product_sync_api_key)) -> BaseResponse:
    """Tra ve TOAN BO cay danh muc san pham/dich vu (moi workspace).

    Giu nguyen shape cua `GET /api/all-platform/service-catalog` de phia
    Tech Support khong phai doi parser/display.
    """
    try:
        tree = list_service_catalog_items_scoped(None)
    except Exception as exc:  # noqa: BLE001 — theo convention BaseResponse
        return BaseResponse(success=False, message=str(exc))
    return BaseResponse(success=True, data=tree)
