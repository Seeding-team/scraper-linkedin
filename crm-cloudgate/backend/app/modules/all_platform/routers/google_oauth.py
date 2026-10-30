"""Google OAuth (authorization-code flow) - nhap tai lieu Google Docs/Drive RIENG TU bang
chinh quyen nguoi dung (2026-10-27). Xem chi tiet kien truc trong google_oauth_service.py.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from fastapi.responses import RedirectResponse

from app.core.config import settings
from app.core.logger import get_logger
from app.modules.all_platform.auth_deps import get_current_user
from app.modules.all_platform.schemas import BaseResponse
from app.modules.all_platform.services import google_oauth_service as svc

logger = get_logger(__name__)
google_oauth_router = APIRouter()


@google_oauth_router.get("/status")
def oauth_status(user: dict = Depends(get_current_user)) -> BaseResponse:
    try:
        status = svc.get_status(user.get("id"))
        return BaseResponse(success=True, data={"connected": bool(status), **(status or {})})
    except Exception as e:  # noqa: BLE001 - vd migration 196 chua ap dung tren DB (table chua ton tai)
        return BaseResponse(success=False, message=str(e))


@google_oauth_router.get("/start")
def oauth_start(return_to: str = Query("/all-platform/contracts"), user: dict = Depends(get_current_user)) -> BaseResponse:
    """FE goi co auth (Bearer token), nhan ve {url} roi tu `window.location.href = url` -
    KHONG the redirect 302 thang o day vi request nay co header Authorization (fetch),
    khong phai dieu huong trinh duyet that (header do se khong duoc gui lai khi Google
    dieu huong nguoi dung)."""
    try:
        return BaseResponse(success=True, data={"url": svc.build_authorization_url(user.get("id"), return_to)})
    except svc.GoogleOAuthNotConfigured as e:
        return BaseResponse(success=False, message=str(e))


@google_oauth_router.get("/callback")
def oauth_callback(code: str | None = Query(None), state: str | None = Query(None), error: str | None = Query(None)):
    """Trinh duyet duoc Google dieu huong THANG toi day (khong co header auth) - danh tinh
    nguoi dung lay tu `state` da ky (xem google_oauth_service._verify_state), KHONG tu
    get_current_user. Luon ket thuc bang 302 ve dung trang hop dong da mo luc bam ket noi."""
    # BUG THAT DA GAP (2026-10-27): truoc day loi luon redirect ve "/all-platform/contracts"
    # (trang danh sach chung, KHONG doc query `googleOauth`) nen bam "Ket noi Google" that bai
    # NHUNG nhin giong nhu khong co gi xay ra - chi "nhay ve danh sach hop dong". Gio luon co
    # gang lay lai dung trang hop dong dang mo (tu `state`, van con doc duoc ke ca buoc sau that
    # bai) de loi THAT SU hien ra dung cho nguoi dung dang dung.
    return_to = svc.peek_return_to(state)
    if error:
        return RedirectResponse(f"{settings.crm_public_url}{return_to}?googleOauth=error&message={error}")
    if not code or not state:
        return RedirectResponse(f"{settings.crm_public_url}{return_to}?googleOauth=error&message=missing_code")
    try:
        result = svc.handle_callback(code, state)
        email = result.get("email") or ""
        return RedirectResponse(f"{settings.crm_public_url}{result['returnTo']}?googleOauth=connected&email={email}")
    except ValueError as e:
        return RedirectResponse(f"{settings.crm_public_url}{return_to}?googleOauth=error&message={e}")
    except Exception as e:  # noqa: BLE001
        logger.warning("Google OAuth callback thất bại ngoài dự kiến: %s", e)
        return RedirectResponse(f"{settings.crm_public_url}{return_to}?googleOauth=error&message=unexpected:{type(e).__name__}")


@google_oauth_router.post("/disconnect")
def oauth_disconnect(user: dict = Depends(get_current_user)) -> BaseResponse:
    try:
        svc.disconnect(user.get("id"))
        return BaseResponse(success=True, message="Đã ngắt kết nối Google.")
    except Exception as e:  # noqa: BLE001
        return BaseResponse(success=False, message=str(e))
