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
from app.modules.all_platform.services import contract_docx_engine as eng
from app.modules.all_platform.services import contract_document_store as store

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


@contract_templates_router.get("/{template_id}/file")
def contract_templates_file(template_id: str, _user: dict = Depends(get_current_user)):
    """Tải ĐÚNG file gốc đã upload (DOCX/PDF) - không phải bản text trích xuất. Mẫu cũ chưa lưu file gốc => báo rõ."""
    from urllib.parse import quote
    from fastapi.responses import Response
    from app.modules.all_platform.services import contract_document_store as store

    try:
        meta = get_contract_template(template_id)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))
    loaded = store.load_template_original(template_id)
    if not loaded:
        return BaseResponse(success=False, message="Mẫu này được tải lên trước khi hệ thống lưu file gốc - hãy tải lại file mẫu để có thể tải về.")
    ext, content = loaded
    mime = store.DOCX_MIME if ext == "docx" else "application/pdf"
    name = (meta.get("fileName") or f"mau.{ext}").replace('"', "")
    return Response(content, media_type=mime, headers={"Content-Disposition": "attachment; filename*=UTF-8''" + quote(name)})


@contract_templates_router.get("/{template_id}/preview-pdf")
def contract_templates_preview_pdf(template_id: str, _user: dict = Depends(get_current_user)):
    """Xem trước ĐÚNG form mẫu gốc: PDF mẫu thì trả thẳng; DOCX thì chuyển bằng LibreOffice (engine chuyển đổi hiện có, không dựng engine
    riêng) và cache theo hash nội dung file gốc (đổi mẫu mới -> hash khác -> chuyển lại, không phải convert lại mỗi lần xem). Không chỉnh/ghi
    đè file mẫu gốc - chỉ đọc. Không trả URL Storage trực tiếp - luôn proxy qua backend để không lộ bucket riêng tư."""
    import hashlib

    from fastapi.responses import Response

    try:
        get_contract_template(template_id)  # 404 rõ ràng nếu mẫu không tồn tại / không xem được, trước khi đụng Storage
    except Exception as e:
        return BaseResponse(success=False, message=str(e))
    loaded = store.load_template_original(template_id)
    if not loaded:
        return BaseResponse(success=False, message="Mẫu này chưa lưu file gốc (tải lên trước khi có tính năng lưu file gốc) - không xem trước được, chỉ xem nội dung trích xuất.")
    ext, content = loaded
    if ext == "pdf":
        return Response(content, media_type="application/pdf")
    content_sha = hashlib.sha256(content).hexdigest()
    cached = store.load_template_preview_pdf(template_id, content_sha)
    if cached:
        return Response(cached, media_type="application/pdf")
    try:
        pdf = eng.convert_docx_to_pdf(content)
    except eng.PdfEngineUnavailable as exc:
        return BaseResponse(success=False, message=f"Chưa thể chuyển đổi xem trước (thiếu LibreOffice): {exc}. Vẫn tải được file gốc.")
    except Exception as exc:  # noqa: BLE001
        return BaseResponse(success=False, message=f"Không chuyển đổi được mẫu sang PDF xem trước: {exc}")
    store.save_template_preview_pdf(template_id, content_sha, pdf)
    return Response(pdf, media_type="application/pdf")


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
        # Giữ FILE GỐC (không chỉ text) để chỉnh trực tiếp trên bản sao khi dùng mẫu; best-effort, không làm hỏng việc tải mẫu.
        from app.modules.all_platform.services import contract_document_store
        data["originalStored"] = bool(contract_document_store.save_template_original(data["id"], file.filename or "template", content))
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
