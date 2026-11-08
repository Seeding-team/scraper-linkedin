"""Categories endpoints for shared platform/CRM master data."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from app.modules.all_platform.auth_deps import get_current_user
from app.modules.all_platform.schemas import (
    BaseResponse,
    CategoryAddRequest,
    CategoryUpdateRequest,
)
from app.modules.all_platform.services import (
    add_category,
    delete_category,
    get_all_categories,
    get_categories_by_type,
    update_category,
)
from app.modules.all_platform.services.crm_permission_service import can_manage_shared_master_data

router = APIRouter()


def _require_master_data_manager(user: dict[str, Any]) -> None:
    if not can_manage_shared_master_data(user):
        raise HTTPException(status_code=403, detail="Forbidden: CRM master data manager role required")


@router.get("")
def categories_get_all(
    category_type: str | None = Query(None),
    active_only: bool = Query(False),
    _: Any = Depends(get_current_user),
) -> BaseResponse:
    """Every authenticated user can read shared category master data."""
    try:
        data = (
            get_categories_by_type(category_type, active_only=active_only)
            if category_type
            else get_all_categories()
        )
        return BaseResponse(success=True, data=data)
    except Exception as exc:
        return BaseResponse(success=False, message=str(exc))


@router.post("/add")
def categories_add(payload: CategoryAddRequest, user: Any = Depends(get_current_user)) -> BaseResponse:
    _require_master_data_manager(user)
    try:
        data = add_category(payload.model_dump(exclude_none=True))
        return BaseResponse(success=True, message="Category added", data=data)
    except Exception as exc:
        return BaseResponse(success=False, message=str(exc))


@router.put("/update")
def categories_update(payload: CategoryUpdateRequest, user: Any = Depends(get_current_user)) -> BaseResponse:
    _require_master_data_manager(user)
    try:
        data = update_category(payload.id, payload.model_dump(exclude_none=True))
        return BaseResponse(success=True, message="Category updated", data=data)
    except Exception as exc:
        return BaseResponse(success=False, message=str(exc))


@router.delete("/delete")
def categories_delete(id: str = Query(...), user: Any = Depends(get_current_user)) -> BaseResponse:
    _require_master_data_manager(user)
    try:
        data = delete_category(id)
        return BaseResponse(success=True, message="Category deleted", data=data)
    except Exception as exc:
        return BaseResponse(success=False, message=str(exc))
