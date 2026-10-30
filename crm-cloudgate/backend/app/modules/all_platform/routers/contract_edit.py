"""Word Editor trong AI Contract Review (2026-10-27, OnlyOffice self-host, CHỈ dev - xem
C:\\Users\\Asus\\.claude\\plans\\proud-stargazing-pixel.md). Mọi endpoint người dùng đi qua
`get_current_user` + `can_edit_contract()` re-check MỖI LẦN gọi (contract_edit_service tự làm việc
này) - trừ `/callback` (OnlyOffice gọi server-to-server, xác thực bằng JWT riêng, KHÔNG phải JWT
phiên đăng nhập người dùng) và `/draft-file` (OnlyOffice tải file bằng token ký ngắn hạn)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response
from jose.exceptions import JWTError
from pydantic import BaseModel

from app.core.logger import get_logger
from app.modules.all_platform.auth_deps import get_current_user
from app.modules.all_platform.schemas import BaseResponse
from app.modules.all_platform.services import contract_edit_service as svc
from app.modules.all_platform.services.contract_document_store import DOCX_MIME

logger = get_logger(__name__)
contract_edit_router = APIRouter()


def _deny(exc: Exception) -> BaseResponse:
    return BaseResponse(success=False, message=str(exc))


@contract_edit_router.post("/{contract_id}/edit/start")
def start_edit(contract_id: str, user: dict = Depends(get_current_user)) -> BaseResponse:
    try:
        return BaseResponse(success=True, data=svc.start_edit_session(contract_id, user))
    except (PermissionError, LookupError, ValueError, RuntimeError) as exc:
        return _deny(exc)


@contract_edit_router.get("/{contract_id}/edit/draft-file")
@contract_edit_router.head("/{contract_id}/edit/draft-file")
def draft_file(contract_id: str, token: str) -> Response:
    """OnlyOffice (server-to-server) tải bản nháp qua token ký ngắn hạn - KHÔNG qua auth phiên
    người dùng (OnlyOffice không có cookie/JWT đăng nhập của Sale)."""
    try:
        content = svc.get_draft_bytes_for_download(contract_id, token)
        logger.info("[WORD-EDITOR] draft-file tải thành công cho contract %s (%d bytes)", contract_id, len(content))
        return Response(content=content, media_type=DOCX_MIME)
    except JWTError as exc:
        logger.warning("[WORD-EDITOR] draft-file JWTError cho contract %s: %s", contract_id, exc)
        return Response(content=f"Token không hợp lệ: {exc}".encode(), status_code=401)
    except LookupError as exc:
        logger.warning("[WORD-EDITOR] draft-file LookupError cho contract %s: %s", contract_id, exc)
        return Response(content=str(exc).encode(), status_code=404)
    except Exception as exc:
        logger.exception("[WORD-EDITOR] draft-file Exception cho contract %s: %s", contract_id, exc)
        return Response(content=f"Lỗi tải file nháp: {exc}".encode(), status_code=500)


@contract_edit_router.post("/{contract_id}/edit/callback")
async def edit_callback(contract_id: str, request: Request) -> dict:
    """OnlyOffice gọi khi autosave/đóng phiên - xem docstring đầu file + contract_edit_service.
    handle_callback(). LUÔN trả JSON {"error": 0|1} theo đúng giao thức OnlyOffice (KHÔNG dùng
    BaseResponse - OnlyOffice không hiểu shape đó)."""
    body = await request.json()
    return svc.handle_callback(body, request.headers.get("authorization"))


@contract_edit_router.post("/{contract_id}/edit/forcesave")
def request_forcesave(contract_id: str, user: dict = Depends(get_current_user)) -> BaseResponse:
    """FE gọi best-effort lúc đóng panel/đổi tab/beforeunload."""
    try:
        return BaseResponse(success=True, data=svc.request_forcesave(contract_id, user))
    except (PermissionError, LookupError) as exc:
        return _deny(exc)


@contract_edit_router.get("/{contract_id}/edit/status")
def edit_status(contract_id: str, user: dict = Depends(get_current_user)) -> BaseResponse:
    try:
        return BaseResponse(success=True, data=svc.get_status(contract_id, user))
    except (PermissionError, LookupError) as exc:
        return _deny(exc)


class PromoteRequest(BaseModel):
    confirm_amendment: bool = False
    note: str = ""


@contract_edit_router.post("/{contract_id}/edit/save-version")
def save_version(contract_id: str, payload: PromoteRequest, user: dict = Depends(get_current_user)) -> BaseResponse:
    try:
        return BaseResponse(success=True, data=svc.promote_to_version(
            contract_id, user, confirm_amendment=payload.confirm_amendment, note=payload.note,
        ))
    except TimeoutError as exc:
        return BaseResponse(success=False, message=str(exc))
    except (PermissionError, LookupError, ValueError) as exc:
        return _deny(exc)


@contract_edit_router.post("/{contract_id}/edit/discard")
def discard(contract_id: str, user: dict = Depends(get_current_user)) -> BaseResponse:
    try:
        return BaseResponse(success=True, data=svc.discard_session(contract_id, user))
    except (PermissionError, LookupError) as exc:
        return _deny(exc)


@contract_edit_router.get("/{contract_id}/edit/annotations")
def list_annotations(contract_id: str, user: dict = Depends(get_current_user)) -> BaseResponse:
    try:
        return BaseResponse(success=True, data=svc.list_annotations(contract_id, user))
    except (PermissionError, LookupError) as exc:
        return _deny(exc)


class AnnotationActionRequest(BaseModel):
    action: str  # dismiss_warning | remove_highlight | clear_note
    already_applied_live: bool = False


@contract_edit_router.patch("/{contract_id}/edit/annotations/{annotation_id}")
def patch_annotation(contract_id: str, annotation_id: str, payload: AnnotationActionRequest, user: dict = Depends(get_current_user)) -> BaseResponse:
    try:
        return BaseResponse(success=True, data=svc.patch_annotation(
            contract_id, annotation_id, action=payload.action,
            already_applied_live=payload.already_applied_live, user=user,
        ))
    except (PermissionError, LookupError, ValueError, RuntimeError) as exc:
        return _deny(exc)


@contract_edit_router.post("/{contract_id}/edit/amendments/{amendment_id}/submit")
def submit_amendment(contract_id: str, amendment_id: str, user: dict = Depends(get_current_user)) -> BaseResponse:
    try:
        return BaseResponse(success=True, data=svc.submit_amendment(contract_id, amendment_id, user))
    except (PermissionError, LookupError, ValueError) as exc:
        return _deny(exc)


@contract_edit_router.post("/{contract_id}/edit/amendments/{amendment_id}/approve")
def approve_amendment(contract_id: str, amendment_id: str, user: dict = Depends(get_current_user)) -> BaseResponse:
    try:
        return BaseResponse(success=True, data=svc.approve_amendment(contract_id, amendment_id, user))
    except (PermissionError, LookupError, ValueError) as exc:
        return _deny(exc)


@contract_edit_router.post("/{contract_id}/edit/amendments/{amendment_id}/reject")
def reject_amendment(contract_id: str, amendment_id: str, user: dict = Depends(get_current_user)) -> BaseResponse:
    try:
        return BaseResponse(success=True, data=svc.reject_amendment(contract_id, amendment_id, user))
    except (PermissionError, LookupError, ValueError) as exc:
        return _deny(exc)
