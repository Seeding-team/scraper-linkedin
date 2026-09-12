"""Du an (Project) - migration 097. GET mo cho moi nguoi dang nhap (dung cho
picker chon Du an khi tao bao gia, DTO da la allowlist that qua
_row_to_project - khong lo field nhay cam thua). POST/PUT dung
can_manage_project() RIENG cho Project - KHONG dung has_full_crm_access()
(ham do gom ca "thanh vien team_type='sale'", qua rong cho quan tri Du an -
xem crm_permission_service.py de biet ro tai sao)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from app.modules.all_platform.auth_deps import get_current_user
from app.modules.all_platform.schemas import BaseResponse
from app.modules.all_platform.services import (
    list_projects,
    get_project,
    create_project,
    update_project,
)
from app.modules.all_platform.services.crm_permission_service import can_view_project, can_manage_project
from app.modules.all_platform.services.supabase_project_service import preview_project_code

router = APIRouter()


@router.get("")
def projects_list(customer_id: str | None = Query(None), user: dict = Depends(get_current_user)) -> BaseResponse:
    if not can_view_project(user):
        return BaseResponse(success=False, message="Không có quyền xem dự án")
    try:
        return BaseResponse(success=True, data=list_projects(customer_id))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


# Dat TRUOC "/{project_id}" - neu khong FastAPI se hieu "preview-code" la 1
# project_id (path param nuot truoc route co dinh khai sau no).
@router.get("/preview-code")
def projects_preview_code(customer_id: str = Query(...), user: dict = Depends(get_current_user)) -> BaseResponse:
    """Chi tinh de hien 'Du kien' tren form tao du an - KHONG insert/persist
    gi (xem preview_project_code()). Chi doc, dung lai quyen xem nhu GET ""/
    GET "/{id}"."""
    if not can_view_project(user):
        return BaseResponse(success=False, message="Không có quyền xem dự án")
    try:
        return BaseResponse(success=True, data=preview_project_code(customer_id))
    except ValueError as e:
        return BaseResponse(success=False, message=str(e))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.get("/{project_id}")
def projects_get(project_id: str, user: dict = Depends(get_current_user)) -> BaseResponse:
    if not can_view_project(user):
        return BaseResponse(success=False, message="Không có quyền xem dự án")
    try:
        return BaseResponse(success=True, data=get_project(project_id))
    except ValueError as e:
        return BaseResponse(success=False, message=str(e))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.post("")
def projects_create(payload: dict, user: dict = Depends(get_current_user)) -> BaseResponse:
    # Tao MOI: chua co project de tu nhan la "nguoi tao/manager" - CHI
    # Admin/Leader (can_manage_project(user, project=None) tu dong ap dung
    # dung nhanh nay).
    if not can_manage_project(user, None):
        return BaseResponse(success=False, message="Chỉ Admin hoặc Leader mới được tạo dự án")
    try:
        data = create_project(payload, user.get("id"))
        return BaseResponse(success=True, message="Đã tạo dự án", data=data)
    except ValueError as e:
        return BaseResponse(success=False, message=str(e))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.put("/{project_id}")
def projects_update(project_id: str, payload: dict, user: dict = Depends(get_current_user)) -> BaseResponse:
    try:
        existing = get_project(project_id)
    except ValueError as e:
        return BaseResponse(success=False, message=str(e))
    if not can_manage_project(user, existing):
        return BaseResponse(success=False, message="Không có quyền sửa dự án này")
    try:
        data = update_project(project_id, payload, user.get("id"))
        return BaseResponse(success=True, message="Đã lưu dự án", data=data)
    except ValueError as e:
        return BaseResponse(success=False, message=str(e))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))
