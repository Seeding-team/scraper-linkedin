"""Endpoints "Nhom quyen" (CRM permission group/template) - tab moi trong
`/all-platform/admin/quan-ly-thanh-vien`. Xem
schemas/crm_permission_group.py + services/crm_permission_group_service.py."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query

from app.modules.all_platform.auth_deps import get_current_user, require_admin
from app.modules.all_platform.schemas import (
    BaseResponse,
    CrmPermissionGroupCreateRequest,
    CrmPermissionGroupUpdateRequest,
)
from app.modules.all_platform.services import (
    list_permission_groups,
    get_permission_group,
    create_permission_group,
    update_permission_group,
    clone_permission_group,
    delete_permission_group,
    list_users_of_permission_group,
)

router = APIRouter()


@router.get("")
def permission_groups_list(status: str | None = Query(None), _: Any = Depends(get_current_user)) -> BaseResponse:
    """Ai dang nhap cung xem duoc danh sach (can cho dropdown chon Nhom quyen
    trong drawer "Chinh quyen user") - CHI viec them/sua/xoa moi can admin."""
    try:
        return BaseResponse(success=True, data=list_permission_groups(status))
    except Exception as exc:
        return BaseResponse(success=False, message=str(exc))


@router.get("/{group_id}")
def permission_group_get(group_id: str, _: Any = Depends(get_current_user)) -> BaseResponse:
    try:
        data = get_permission_group(group_id)
        if not data:
            return BaseResponse(success=False, message="Không tìm thấy nhóm quyền")
        return BaseResponse(success=True, data=data)
    except Exception as exc:
        return BaseResponse(success=False, message=str(exc))


@router.get("/{group_id}/users")
def permission_group_users(group_id: str, _: Any = Depends(get_current_user)) -> BaseResponse:
    try:
        return BaseResponse(success=True, data=list_users_of_permission_group(group_id))
    except Exception as exc:
        return BaseResponse(success=False, message=str(exc))


@router.post("")
def permission_group_create(
    payload: CrmPermissionGroupCreateRequest, user: Any = Depends(require_admin)
) -> BaseResponse:
    try:
        data = create_permission_group(payload.model_dump(), created_by=user.get("id"))
        return BaseResponse(success=True, message="Đã tạo nhóm quyền", data=data)
    except Exception as exc:
        return BaseResponse(success=False, message=str(exc))


@router.put("/{group_id}")
def permission_group_update(
    group_id: str, payload: CrmPermissionGroupUpdateRequest, _: Any = Depends(require_admin)
) -> BaseResponse:
    try:
        data = update_permission_group(group_id, payload.model_dump(exclude_none=True))
        return BaseResponse(success=True, message="Đã cập nhật nhóm quyền", data=data)
    except Exception as exc:
        return BaseResponse(success=False, message=str(exc))


@router.post("/{group_id}/clone")
def permission_group_clone(group_id: str, user: Any = Depends(require_admin)) -> BaseResponse:
    try:
        data = clone_permission_group(group_id, created_by=user.get("id"))
        return BaseResponse(success=True, message="Đã clone nhóm quyền", data=data)
    except Exception as exc:
        return BaseResponse(success=False, message=str(exc))


@router.delete("/{group_id}")
def permission_group_delete(group_id: str, _: Any = Depends(require_admin)) -> BaseResponse:
    try:
        data = delete_permission_group(group_id)
        return BaseResponse(success=True, message="Đã xoá nhóm quyền", data=data)
    except Exception as exc:
        return BaseResponse(success=False, message=str(exc))
