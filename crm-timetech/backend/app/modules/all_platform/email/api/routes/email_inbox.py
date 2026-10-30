"""Authenticated Email Inbox API for Omnichannel."""
from __future__ import annotations

from urllib.parse import quote

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response, status

from app.modules.all_platform.auth_deps import get_current_user, require_admin_or_leader
from app.modules.all_platform.email.schemas.email_inbox import (
    EmailAccountResponse, EmailConversationResponse, EmailMessageResponse,
    EmailSendRequest, EmailSimulateIncomingRequest, EmailComposeRequest,
    EmailAccountConnectImapRequest, EmailAccountDisconnectRequest,
    GoogleOAuthUrlResponse, GoogleOAuthStateResponse, GoogleOAuthCallbackRequest,
)
from app.modules.all_platform.email.services import email_inbox_service as service
from app.modules.all_platform.services.crm_permission_service import has_module_access

router = APIRouter()


def _oauth_user_key(user: dict) -> str:
    for key in ("id", "user_id", "sub", "email"):
        value = user.get(key)
        if value:
            return str(value)
    raise HTTPException(status_code=401, detail="Phiên đăng nhập không có định danh người dùng.")


def _require_email_access(user: dict = Depends(get_current_user)) -> dict:
    if not has_module_access(user, "Customer"):
        raise HTTPException(status_code=403, detail="Không có quyền truy cập Hộp thư đa kênh.")
    return user


def _service_error(exc: Exception) -> HTTPException:
    if isinstance(exc, service.EmailInboxSchemaError):
        return HTTPException(status_code=503, detail=str(exc))
    if isinstance(exc, service.EmailSendError):
        return HTTPException(status_code=502, detail=str(exc))
    if isinstance(exc, KeyError):
        return HTTPException(status_code=404, detail="Không tìm thấy dữ liệu email trong workspace hiện tại.")
    if isinstance(exc, PermissionError):
        return HTTPException(status_code=403, detail=str(exc))
    return HTTPException(status_code=503, detail=f"Dịch vụ email: {str(exc)[:160]}")


@router.get("/accounts", response_model=list[EmailAccountResponse])
def get_email_accounts(_: dict = Depends(_require_email_access)):
    try:
        return service.list_email_accounts()
    except Exception as exc:
        raise _service_error(exc) from exc


@router.get("/oauth/google/state", response_model=GoogleOAuthStateResponse)
def get_google_oauth_state(
    origin: str = Query(..., description="Exact browser origin initiating the popup"),
    user: dict = Depends(_require_email_access),
):
    try:
        normalized = service.validate_google_oauth_origin(origin)
        return GoogleOAuthStateResponse(
            state=service.create_google_oauth_state(normalized, _oauth_user_key(user)),
            origin=normalized,
        )
    except Exception as exc:
        raise _service_error(exc) from exc


@router.get("/oauth/google/auth-url", response_model=GoogleOAuthUrlResponse)
def get_google_oauth_url(
    redirect_uri: str = Query(..., description="Exact HTTPS origin of the requesting CRM page"),
    user: dict = Depends(_require_email_access),
):
    try:
        state = service.create_google_oauth_state(redirect_uri, _oauth_user_key(user))
        url, client_id = service.get_google_auth_url(redirect_uri, state)
        return GoogleOAuthUrlResponse(
            auth_url=url,
            client_id=client_id,
            redirect_uri=redirect_uri,
        )
    except Exception as exc:
        raise _service_error(exc) from exc


@router.post("/oauth/google/callback", response_model=EmailAccountResponse)
def exchange_google_oauth(
    payload: GoogleOAuthCallbackRequest,
    x_requested_with: str | None = Header(None, alias="X-Requested-With"),
    user: dict = Depends(_require_email_access),
):
    try:
        if x_requested_with != "XmlHttpRequest":
            raise PermissionError("OAuth callback thiếu xác nhận same-origin.")
        return service.exchange_google_oauth_code(
            payload.code,
            payload.redirect_uri,
            payload.state,
            _oauth_user_key(user),
        )
    except Exception as exc:
        raise _service_error(exc) from exc


@router.post("/accounts/connect-imap", response_model=EmailAccountResponse)
def connect_imap_account(
    payload: EmailAccountConnectImapRequest,
    _: dict = Depends(_require_email_access),
):
    try:
        return service.connect_imap_account(payload)
    except Exception as exc:
        raise _service_error(exc) from exc


@router.post("/accounts/{account_id}/disconnect")
def disconnect_email_account(
    account_id: str,
    _: dict = Depends(_require_email_access),
):
    try:
        ok = service.disconnect_email_account(account_id)
        return {"ok": ok, "account_id": account_id}
    except Exception as exc:
        raise _service_error(exc) from exc


@router.get("/conversations", response_model=list[EmailConversationResponse])
def get_email_conversations(
    filter_tab: str = Query("all", pattern="^(all|unread|crm)$"),
    search: str | None = Query(None, max_length=200),
    account_email: str | None = Query(None, description="Filter conversations by connected account email"),
    _: dict = Depends(_require_email_access),
):
    try:
        return service.list_email_conversations(filter_tab, search, account_email)
    except Exception as exc:
        raise _service_error(exc) from exc


@router.get("/conversations/{conversation_id}/messages", response_model=list[EmailMessageResponse])
def get_email_messages(conversation_id: str, _: dict = Depends(_require_email_access)):
    try:
        return service.get_email_messages(conversation_id)
    except Exception as exc:
        raise _service_error(exc) from exc


@router.post("/conversations/{conversation_id}/send", response_model=EmailMessageResponse)
def send_email_reply(
    conversation_id: str, payload: EmailSendRequest,
    _: dict = Depends(_require_email_access),
):
    try:
        return service.send_email_reply(conversation_id, payload)
    except Exception as exc:
        raise _service_error(exc) from exc


@router.post("/compose", response_model=EmailConversationResponse)
def compose_new_email(
    payload: EmailComposeRequest,
    _: dict = Depends(_require_email_access),
):
    try:
        return service.compose_new_email(payload)
    except Exception as exc:
        raise _service_error(exc) from exc


@router.post("/conversations/{conversation_id}/read")
def mark_email_read(conversation_id: str, _: dict = Depends(_require_email_access)):
    try:
        if not service.mark_email_read(conversation_id):
            raise KeyError(conversation_id)
        return {"ok": True, "conversation_id": conversation_id}
    except Exception as exc:
        raise _service_error(exc) from exc


@router.get("/attachments/{attachment_id}")
def download_attachment(attachment_id: str, _: dict = Depends(_require_email_access)):
    try:
        data, content_type, filename = service.download_attachment(attachment_id)
        encoded = quote(filename, safe="")
        return Response(
            content=data,
            media_type=content_type or "application/octet-stream",
            headers={"Content-Disposition": f"attachment; filename*=UTF-8''{encoded}"},
        )
    except Exception as exc:
        raise _service_error(exc) from exc


@router.post("/sync")
def sync_email_mailbox(
    account_email: str | None = Query(None, description="Specific email account to sync, or all if omitted"),
    max_messages: int = Query(100, ge=1, le=500),
    _: dict = Depends(_require_email_access),
):
    try:
        return service.sync_mailbox(account_email=account_email, max_messages=max_messages)
    except Exception as exc:
        raise _service_error(exc) from exc


@router.post("/simulate-incoming", response_model=EmailConversationResponse)
def simulate_incoming_email(
    payload: EmailSimulateIncomingRequest,
    _: dict = Depends(require_admin_or_leader),
):
    try:
        return service.simulate_incoming_email(payload)
    except Exception as exc:
        raise _service_error(exc) from exc
