"""Rotation Schedules endpoints with RBAC & Creator Identity for All-Platform."""

from __future__ import annotations

from typing import Any
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.modules.all_platform.auth_deps import get_current_user
from app.modules.all_platform.schemas import BaseResponse
from app.modules.all_platform.services.supabase_rotation_schedules_service import (
    get_rotation_schedules,
    save_or_update_rotation_schedule,
    batch_sync_rotation_schedules,
    toggle_rotation_schedule,
    delete_rotation_schedule,
)

router = APIRouter()


class SyncSchedulesRequest(BaseModel):
    schedules: list[dict[str, Any]] = Field(default_factory=list)


class SaveScheduleRequest(BaseModel):
    schedule: dict[str, Any]


class ToggleScheduleRequest(BaseModel):
    enabled: bool


@router.get("")
def list_schedules(current_user: dict[str, Any] = Depends(get_current_user)) -> BaseResponse:
    """Get rotation schedules filtered by RBAC:
    - Admin: Full schedules of all users + system accounts.
    - Leader: Schedules of members in leader's team(s) + leader's own.
    - Member: Only own created schedules.
    """
    try:
        data = get_rotation_schedules(current_user)
        return BaseResponse(success=True, data=data)
    except Exception as exc:
        return BaseResponse(success=False, message=str(exc))


@router.post("/sync")
def sync_schedules(
    payload: SyncSchedulesRequest,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    """Sync rotation schedules from browser extension to central backend database."""
    try:
        data = batch_sync_rotation_schedules(payload.schedules, current_user)
        return BaseResponse(success=True, message=f"Đã đồng bộ {data.get('synced_count', 0)} lịch cào", data=data)
    except Exception as exc:
        return BaseResponse(success=False, message=str(exc))


@router.post("")
def create_or_update_schedule(
    payload: SaveScheduleRequest,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    """Create or update a rotation schedule."""
    try:
        data = save_or_update_rotation_schedule(payload.schedule, current_user)
        return BaseResponse(success=True, message="Đã lưu lịch cào thành công", data=data)
    except HTTPException:
        raise
    except Exception as exc:
        return BaseResponse(success=False, message=str(exc))


@router.put("/{schedule_id}/toggle")
def toggle_schedule(
    schedule_id: str,
    payload: ToggleScheduleRequest,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    """Toggle enabled status of a rotation schedule."""
    try:
        data = toggle_rotation_schedule(schedule_id, payload.enabled, current_user)
        return BaseResponse(success=True, message="Đã cập nhật trạng thái lịch cào", data=data)
    except HTTPException:
        raise
    except Exception as exc:
        return BaseResponse(success=False, message=str(exc))


@router.delete("/{schedule_id}")
def remove_schedule(
    schedule_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    """Delete a rotation schedule."""
    try:
        data = delete_rotation_schedule(schedule_id, current_user)
        return BaseResponse(success=True, message="Đã xóa lịch cào", data=data)
    except HTTPException:
        raise
    except Exception as exc:
        return BaseResponse(success=False, message=str(exc))

