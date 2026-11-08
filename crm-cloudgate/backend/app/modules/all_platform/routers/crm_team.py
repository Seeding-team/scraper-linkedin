"""Endpoints "Team CRM" (KHAC HAN bang `teams`/`team_type` KPI noi bo) - trang
`/all-platform/crm/sale-teams`. Xem schemas/crm_team.py +
services/crm_team_service.py."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query

from app.modules.all_platform.auth_deps import get_current_user, require_admin_or_leader
from app.modules.all_platform.schemas import (
    BaseResponse,
    CrmTeamCreateRequest,
    CrmTeamMemberAddRequest,
    CrmTeamUpdateRequest,
)
from app.modules.all_platform.services import (
    list_teams,
    get_team,
    get_crm_team_id_for_user_lookup,
    create_crm_team,
    update_crm_team,
    delete_crm_team,
    add_crm_team_member,
    remove_crm_team_member,
    suggest_team_code,
)

router = APIRouter()


@router.get("")
def crm_teams_list(
    segment: str | None = Query(None),
    function_area: str | None = Query(None),
    search: str | None = Query(None),
    _: Any = Depends(get_current_user),
) -> BaseResponse:
    try:
        return BaseResponse(success=True, data=list_teams(segment=segment, function_area=function_area, search=search))
    except Exception as exc:
        return BaseResponse(success=False, message=str(exc))


@router.get("/suggest-code")
def crm_teams_suggest_code(leader_name: str = Query(...), _: Any = Depends(get_current_user)) -> BaseResponse:
    try:
        return BaseResponse(success=True, data={"code": suggest_team_code(leader_name)})
    except Exception as exc:
        return BaseResponse(success=False, message=str(exc))


@router.get("/member-of/{user_id}")
def crm_team_of_user(user_id: str, _: Any = Depends(get_current_user)) -> BaseResponse:
    """Team CRM hien tai cua 1 user (null neu chua thuoc Team nao) - dung cho
    drawer "Chinh quyen user" hien thi dung Team dang chon."""
    try:
        return BaseResponse(success=True, data={"crm_team_id": get_crm_team_id_for_user_lookup(user_id)})
    except Exception as exc:
        return BaseResponse(success=False, message=str(exc))


@router.get("/{team_id}")
def crm_team_get(team_id: str, _: Any = Depends(get_current_user)) -> BaseResponse:
    try:
        data = get_team(team_id)
        if not data:
            return BaseResponse(success=False, message="Không tìm thấy Team CRM")
        return BaseResponse(success=True, data=data)
    except Exception as exc:
        return BaseResponse(success=False, message=str(exc))


@router.post("")
def crm_team_create(payload: CrmTeamCreateRequest, _: Any = Depends(require_admin_or_leader)) -> BaseResponse:
    try:
        data = create_crm_team(payload.model_dump())
        return BaseResponse(success=True, message="Đã tạo Team CRM", data=data)
    except Exception as exc:
        return BaseResponse(success=False, message=str(exc))


@router.put("/{team_id}")
def crm_team_update(
    team_id: str, payload: CrmTeamUpdateRequest, _: Any = Depends(require_admin_or_leader)
) -> BaseResponse:
    try:
        data = update_crm_team(team_id, payload.model_dump(exclude_none=True))
        return BaseResponse(success=True, message="Đã cập nhật Team CRM", data=data)
    except Exception as exc:
        return BaseResponse(success=False, message=str(exc))


@router.delete("/{team_id}")
def crm_team_delete(team_id: str, _: Any = Depends(require_admin_or_leader)) -> BaseResponse:
    try:
        data = delete_crm_team(team_id)
        return BaseResponse(success=True, message="Đã xoá Team CRM", data=data)
    except Exception as exc:
        return BaseResponse(success=False, message=str(exc))


@router.post("/{team_id}/members")
def crm_team_add_member(
    team_id: str, payload: CrmTeamMemberAddRequest, _: Any = Depends(require_admin_or_leader)
) -> BaseResponse:
    try:
        data = add_crm_team_member(team_id, payload.user_id)
        return BaseResponse(success=True, message="Đã thêm thành viên", data=data)
    except Exception as exc:
        return BaseResponse(success=False, message=str(exc))


@router.delete("/{team_id}/members/{user_id}")
def crm_team_remove_member(team_id: str, user_id: str, _: Any = Depends(require_admin_or_leader)) -> BaseResponse:
    try:
        data = remove_crm_team_member(team_id, user_id)
        return BaseResponse(success=True, message="Đã gỡ thành viên", data=data)
    except Exception as exc:
        return BaseResponse(success=False, message=str(exc))
