"""Quản lý tiến độ CRM — API READ-ONLY, không phải task management.

Permission chốt riêng cho module này (KHÔNG đổi permission CRM ở nơi khác):
  - admin: toàn workspace.
  - leader: chỉ team mà `teams.id_leader = user.id` (progress_scope()).
  - member: 403 ngay ở tầng auth (`require_admin_or_leader`), chưa cả tới
    tầng service.
`ProgressPermissionError` (leader gọi team/thành viên NGOÀI phạm vi mình quản
lý) cũng map ra 403 — 2 lớp chặn riêng: role (auth dependency) + scope
(service), không gộp chung 1 chỗ.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from app.modules.all_platform.auth_deps import require_admin_or_leader
from app.modules.all_platform.schemas import BaseResponse
from app.modules.all_platform.services.progress_service import (
    ProgressPermissionError,
    get_management_alerts,
    get_member_summary,
    get_progress_overview,
    get_progress_team_detail,
    list_member_contracts,
    list_member_customers,
    list_member_deals,
    list_member_leads,
    list_member_projects,
    list_member_quotes,
    list_progress_quotes,
    list_progress_records,
    list_progress_teams,
    search_progress,
)

progress_router = APIRouter()


@progress_router.get("/overview")
def progress_overview(user: dict = Depends(require_admin_or_leader)) -> BaseResponse:
    try:
        return BaseResponse(success=True, data=get_progress_overview(user))
    except ProgressPermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@progress_router.get("/teams")
def progress_teams(user: dict = Depends(require_admin_or_leader)) -> BaseResponse:
    try:
        return BaseResponse(success=True, data=list_progress_teams(user))
    except ProgressPermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@progress_router.get("/teams/{team_id}")
def progress_team_detail(team_id: str, user: dict = Depends(require_admin_or_leader)) -> BaseResponse:
    try:
        return BaseResponse(success=True, data=get_progress_team_detail(user, team_id))
    except ProgressPermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except ValueError as e:
        return BaseResponse(success=False, message=str(e))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@progress_router.get("/members/{user_id}")
def progress_member_summary(user_id: str, user: dict = Depends(require_admin_or_leader)) -> BaseResponse:
    try:
        return BaseResponse(success=True, data=get_member_summary(user, user_id))
    except ProgressPermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@progress_router.get("/members/{user_id}/leads")
def progress_member_leads(user_id: str, user: dict = Depends(require_admin_or_leader)) -> BaseResponse:
    try:
        return BaseResponse(success=True, data=list_member_leads(user, user_id))
    except ProgressPermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@progress_router.get("/members/{user_id}/customers")
def progress_member_customers(user_id: str, user: dict = Depends(require_admin_or_leader)) -> BaseResponse:
    try:
        return BaseResponse(success=True, data=list_member_customers(user, user_id))
    except ProgressPermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@progress_router.get("/members/{user_id}/deals")
def progress_member_deals(user_id: str, user: dict = Depends(require_admin_or_leader)) -> BaseResponse:
    try:
        return BaseResponse(success=True, data=list_member_deals(user, user_id))
    except ProgressPermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@progress_router.get("/members/{user_id}/projects")
def progress_member_projects(user_id: str, user: dict = Depends(require_admin_or_leader)) -> BaseResponse:
    try:
        return BaseResponse(success=True, data=list_member_projects(user, user_id))
    except ProgressPermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@progress_router.get("/members/{user_id}/quotes")
def progress_member_quotes(user_id: str, user: dict = Depends(require_admin_or_leader)) -> BaseResponse:
    try:
        return BaseResponse(success=True, data=list_member_quotes(user, user_id))
    except ProgressPermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@progress_router.get("/members/{user_id}/contracts")
def progress_member_contracts(user_id: str, user: dict = Depends(require_admin_or_leader)) -> BaseResponse:
    try:
        return BaseResponse(success=True, data=list_member_contracts(user, user_id))
    except ProgressPermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@progress_router.get("/quotes")
def progress_quotes(
    team_id: str | None = Query(None),
    owner_id: str | None = Query(None),
    sla_status: str | None = Query(None),
    user: dict = Depends(require_admin_or_leader),
) -> BaseResponse:
    try:
        return BaseResponse(success=True, data=list_progress_quotes(user, team_id=team_id, owner_id=owner_id, sla_status=sla_status))
    except ProgressPermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@progress_router.get("/records")
def progress_records(user: dict = Depends(require_admin_or_leader)) -> BaseResponse:
    try:
        return BaseResponse(success=True, data=list_progress_records(user))
    except ProgressPermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@progress_router.get("/alerts")
def progress_alerts(user: dict = Depends(require_admin_or_leader)) -> BaseResponse:
    try:
        return BaseResponse(success=True, data=get_management_alerts(user))
    except ProgressPermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@progress_router.get("/search")
def progress_search(q: str = Query(""), user: dict = Depends(require_admin_or_leader)) -> BaseResponse:
    try:
        return BaseResponse(success=True, data=search_progress(user, q))
    except ProgressPermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))
