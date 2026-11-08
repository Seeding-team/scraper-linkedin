"""Members (HR roster) endpoints — platform-agnostic."""

from __future__ import annotations

import io

from fastapi import APIRouter, Depends, File, Query, UploadFile

from app.modules.all_platform.auth_deps import get_current_user, require_admin, require_admin_or_leader
from app.modules.all_platform.schemas import (
    BaseResponse,
    MemberCreateRequest,
    MemberUpdateRequest,
)
from app.modules.all_platform.services import (
    get_all_members,
    create_member,
    update_member,
    delete_member,
    get_all_skills,
    create_skill,
    update_skill,
    delete_skill,
    parse_excel_rows,
    import_members_from_rows,
    sync_members_from_recruitment,
)

router = APIRouter()


@router.get("")
def members_get_all(
    search: str | None = Query(None),
    team: str | None = Query(None),
    position: str | None = Query(None),
    department: str | None = Query(None),
    skill_id: str | None = Query(None),
    user: dict = Depends(get_current_user),
) -> BaseResponse:
    """Get all members, optionally filtered. Nguồn dữ liệu DUY NHẤT cho mọi dropdown
    liên quan tới nhân sự trong app — không hard-code / không tự tạo danh sách riêng."""
    try:
        data = get_all_members(search=search, team=team, position=position, department=department, skill_id=skill_id)
        return BaseResponse(success=True, data=data)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.post("/add")
def members_add(payload: MemberCreateRequest, _admin=Depends(require_admin_or_leader)) -> BaseResponse:
    try:
        data = create_member(payload.model_dump(exclude_none=False))
        return BaseResponse(success=True, message="Đã thêm thành viên", data=data)
    except ValueError as e:
        return BaseResponse(success=False, message=str(e))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.put("/update")
def members_update(payload: MemberUpdateRequest, _admin=Depends(require_admin_or_leader)) -> BaseResponse:
    try:
        data = update_member(payload.id, payload.model_dump(exclude={"id"}))
        return BaseResponse(success=True, message="Đã cập nhật thành viên", data=data)
    except ValueError as e:
        return BaseResponse(success=False, message=str(e))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.delete("/delete")
def members_delete(id: str = Query(...), _admin=Depends(require_admin_or_leader)) -> BaseResponse:
    try:
        data = delete_member(id)
        return BaseResponse(success=True, message="Đã xóa thành viên", data=data)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.post("/sync-from-recruitment")
def members_sync_from_recruitment(_admin=Depends(require_admin)) -> BaseResponse:
    """Đồng bộ ứng viên status=accepted từ hệ thống tuyển dụng (cv.markeeai.com)
    vào danh bạ `members` — upsert theo email/display_name, KHÔNG ghi đè
    team/department đã có sẵn. Trả summary created/updated/skipped."""
    try:
        data = sync_members_from_recruitment()
        return BaseResponse(success=True, message="Đã đồng bộ từ hệ thống tuyển dụng", data=data)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.post("/import-excel")
async def members_import_excel(file: UploadFile = File(...), _admin=Depends(require_admin)) -> BaseResponse:
    """Import hàng loạt từ file Excel (.xlsx). Upsert theo email (nếu có) hoặc
    display_name. Trả về summary created/updated/skipped — không import "im lặng"."""
    try:
        import openpyxl

        raw = await file.read()
        workbook = openpyxl.load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
        sheet = workbook.worksheets[0]
        rows = [list(row) for row in sheet.iter_rows(values_only=True)]

        parsed_rows = parse_excel_rows(rows)
        summary = import_members_from_rows(parsed_rows)
        return BaseResponse(success=True, message="Đã import xong", data=summary)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


# ── Skills (nhóm theo category cho form checkbox kỹ năng) ────────────────────

@router.get("/skills")
def skills_get_all(user: dict = Depends(get_current_user)) -> BaseResponse:
    try:
        data = get_all_skills()
        return BaseResponse(success=True, data=data)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.post("/skills/add")
def skills_add(payload: dict, _admin=Depends(require_admin)) -> BaseResponse:
    try:
        data = create_skill(payload.get("name", ""), payload.get("category"))
        return BaseResponse(success=True, message="Đã thêm kỹ năng", data=data)
    except ValueError as e:
        return BaseResponse(success=False, message=str(e))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.put("/skills/update")
def skills_update(payload: dict, _admin=Depends(require_admin)) -> BaseResponse:
    try:
        skill_id = payload.get("id")
        if not skill_id:
            return BaseResponse(success=False, message="Thiếu id")
        data = update_skill(skill_id, payload.get("name"), payload.get("category"))
        return BaseResponse(success=True, message="Đã cập nhật kỹ năng", data=data)
    except ValueError as e:
        return BaseResponse(success=False, message=str(e))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.delete("/skills/delete")
def skills_delete(id: str = Query(...), _admin=Depends(require_admin)) -> BaseResponse:
    try:
        data = delete_skill(id)
        return BaseResponse(success=True, message="Đã xóa kỹ năng", data=data)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))
