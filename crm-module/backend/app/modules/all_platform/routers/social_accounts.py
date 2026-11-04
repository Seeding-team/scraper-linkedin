"""Social accounts endpoints — CRUD for social media accounts."""

from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException, Request

from app.modules.all_platform.schemas import (
    SocialAccountCreateRequest,
    SocialAccountUpdateRequest,
    BaseResponse,
)
from app.modules.all_platform.services import (
    get_social_accounts,
    get_social_account_by_id,
    get_primary_account,
    create_social_account,
    update_social_account,
    delete_social_account,
    set_primary_account,
    get_social_account_summary,
    decode_token,
    get_user_by_id,
)

router = APIRouter()


def _get_user_from_header(authorization: str | None, request: Request | None = None) -> dict:
    """Extract and validate user from Bearer token."""
    if not authorization and request:
        cookie_token = request.cookies.get("crawlpro_access_token")
        if cookie_token:
            authorization = f"Bearer {cookie_token}"

    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid authorization header")
    token = authorization[7:]
    payload = decode_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")
    try:
        user = get_user_by_id(user_id)
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Auth service temporarily unavailable") from exc
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


@router.get("")
def sa_get_all(
    request: Request,
    platform: str | None = None,
    authorization: str | None = Header(None),
) -> BaseResponse:
    """Get all social accounts for current user."""
    try:
        user = _get_user_from_header(authorization, request)
        data = get_social_accounts(user["id"], platform=platform)
        return BaseResponse(success=True, data=data)
    except HTTPException as e:
        return BaseResponse(success=False, message=e.detail)


@router.get("/summary")
def sa_get_summary(request: Request, authorization: str | None = Header(None)) -> BaseResponse:
    """Get social accounts summary grouped by platform."""
    try:
        user = _get_user_from_header(authorization, request)
        data = get_social_account_summary(user["id"])
        return BaseResponse(success=True, data=data)
    except HTTPException as e:
        return BaseResponse(success=False, message=e.detail)


@router.get("/primary/{platform}")
def sa_get_primary(
    platform: str,
    request: Request,
    authorization: str | None = Header(None),
) -> BaseResponse:
    """Get primary social account for a platform."""
    try:
        user = _get_user_from_header(authorization, request)
        data = get_primary_account(user["id"], platform)
        return BaseResponse(success=True, data=data)
    except HTTPException as e:
        return BaseResponse(success=False, message=e.detail)


@router.post("")
def sa_create(
    payload: SocialAccountCreateRequest,
    request: Request,
    authorization: str | None = Header(None),
) -> BaseResponse:
    """Create a new social account."""
    try:
        user = _get_user_from_header(authorization, request)
        data = create_social_account(
            app_user_id=user["id"],
            platform=payload.platform,
            account_name=payload.account_name,
            account_email=payload.account_email,
            account_password=payload.account_password,
            account_profile_id=payload.account_profile_id,
            id_platform=payload.id_platform,
            is_primary=payload.is_primary,
            notes=payload.notes,
            is_banned=payload.is_banned,
            ban_reason=payload.ban_reason,
        )
        return BaseResponse(success=True, message="Social account created", data=data)
    except HTTPException as e:
        return BaseResponse(success=False, message=e.detail)
    except ValueError as e:
        return BaseResponse(success=False, message=str(e))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.put("")
def sa_update(
    payload: SocialAccountUpdateRequest,
    request: Request,
    authorization: str | None = Header(None),
) -> BaseResponse:
    """Update a social account."""
    try:
        user = _get_user_from_header(authorization, request)
        data = update_social_account(
            account_id=payload.id,
            app_user_id=user["id"],
            updates=payload.model_dump(exclude_unset=True),
        )
        return BaseResponse(success=True, message="Social account updated", data=data)
    except HTTPException as e:
        return BaseResponse(success=False, message=e.detail)
    except ValueError as e:
        return BaseResponse(success=False, message=str(e))


@router.delete("/{account_id}")
def sa_delete(
    account_id: str,
    request: Request,
    authorization: str | None = Header(None),
) -> BaseResponse:
    """Delete a social account."""
    try:
        user = _get_user_from_header(authorization, request)
        data = delete_social_account(account_id, user["id"])
        return BaseResponse(success=True, message="Social account deleted", data=data)
    except HTTPException as e:
        return BaseResponse(success=False, message=e.detail)


@router.post("/{account_id}/set-primary")
def sa_set_primary(
    account_id: str,
    request: Request,
    authorization: str | None = Header(None),
) -> BaseResponse:
    """Set an account as primary for its platform."""
    try:
        user = _get_user_from_header(authorization, request)
        data = set_primary_account(account_id, user["id"])
        return BaseResponse(success=True, message="Set as primary account", data=data)
    except HTTPException as e:
        return BaseResponse(success=False, message=e.detail)
    except ValueError as e:
        return BaseResponse(success=False, message=str(e))
