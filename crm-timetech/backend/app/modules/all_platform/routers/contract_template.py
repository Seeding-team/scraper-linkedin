"""Thư viện Mẫu hợp đồng — upload file tham chiếu cho AI Contract Copilot."""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, UploadFile

from app.modules.all_platform.auth_deps import get_current_user
from app.modules.all_platform.schemas import BaseResponse
from app.modules.all_platform.services import (
    list_contract_templates,
    get_contract_template,
    create_contract_template,
    delete_contract_template,
)

contract_templates_router = APIRouter()

_MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10MB — mẫu hợp đồng là văn bản, không cần lớn hơn


@contract_templates_router.get("")
def contract_templates_list(_user: dict = Depends(get_current_user)) -> BaseResponse:
    try:
        return BaseResponse(success=True, data=list_contract_templates())
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@contract_templates_router.get("/{template_id}")
def contract_templates_get(template_id: str, _user: dict = Depends(get_current_user)) -> BaseResponse:
    try:
        return BaseResponse(success=True, data=get_contract_template(template_id))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@contract_templates_router.post("")
async def contract_templates_upload(
    name: str = Form(...),
    description: str = Form(""),
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
) -> BaseResponse:
    try:
        content = await file.read()
        if len(content) > _MAX_UPLOAD_BYTES:
            return BaseResponse(success=False, message="File quá lớn — tối đa 10MB.")
        data = create_contract_template(name, description, file.filename or "template", content, user.get("id"))
        return BaseResponse(success=True, message="Đã tải lên mẫu hợp đồng", data=data)
    except ValueError as e:
        return BaseResponse(success=False, message=str(e))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@contract_templates_router.delete("/{template_id}")
def contract_templates_delete(template_id: str, _user: dict = Depends(get_current_user)) -> BaseResponse:
    try:
        delete_contract_template(template_id)
        return BaseResponse(success=True)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))
