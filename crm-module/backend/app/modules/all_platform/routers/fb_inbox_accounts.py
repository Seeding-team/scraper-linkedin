"""FB Inbox Account router.

API endpoints để quản lý FB inbox accounts của member.
Member tự thêm FB account vào app, hệ thống dùng bảng này
để resolve id_member khi Admin/Leader bấm "Xác nhận Inbox".
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Request

from app.modules.all_platform.schemas import BaseResponse
from app.modules.all_platform.schemas.fb_inbox_account import (
    FbInboxAccountCreate,
    FbInboxAccountUpdate,
    FbInboxAccountResponse,
    FbInboxAccountListResponse,
    ResolveMemberResponse,
)
from app.modules.all_platform.services import decode_token, get_user_by_id
from app.modules.all_platform.services.fb_inbox_account_service import (
    link_user_account,
    get_accounts_by_member,
    resolve_id_member,
    delete_account,
    update_account,
    get_account_by_user_id,
)


router = APIRouter()


def _get_user_from_header(authorization: str | None, request: Request | None = None) -> dict:
    """Extract and validate user from Bearer token or cookie."""
    if not authorization:
        if request:
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


@router.post("/inbox-accounts", response_model=BaseResponse)
def create_inbox_account(
    payload: FbInboxAccountCreate,
    request: Request,
    authorization: str | None = Header(None),
) -> BaseResponse:
    """Link FB inbox account với tài khoản của member.

    Member gọi API này để thêm FB account vào app.
    Backend sẽ decode JWT để lấy id_member và lưu vào bảng fb_inbox_accounts.
    """
    user = _get_user_from_header(authorization, request)
    id_member = user["id"]

    try:
        result = link_user_account(
            id_member=id_member,
            user_id=payload.user_id,
            fb_user_id=payload.fb_user_id,
            account_label=payload.account_label,
        )
        return BaseResponse(
            success=True,
            message="Đã liên kết FB inbox account thành công",
            data=result,
        )
    except ValueError as e:
        return BaseResponse(success=False, message=str(e))
    except Exception as e:
        return BaseResponse(success=False, message=f"Lỗi khi liên kết account: {e}")


@router.get("/inbox-accounts", response_model=BaseResponse)
def list_inbox_accounts(
    request: Request,
    authorization: str | None = Header(None),
) -> BaseResponse:
    """Lấy danh sách FB inbox accounts của member hiện tại."""
    user = _get_user_from_header(authorization, request)
    id_member = user["id"]

    try:
        accounts = get_accounts_by_member(id_member)
        return BaseResponse(
            success=True,
            message="Success",
            data=FbInboxAccountListResponse(
                accounts=accounts,
                total=len(accounts),
            ).model_dump(),
        )
    except Exception as e:
        return BaseResponse(success=False, message=f"Lỗi khi lấy danh sách account: {e}")


@router.get("/inbox-accounts/{user_id}", response_model=BaseResponse)
def get_inbox_account(
    user_id: str,
    request: Request,
    authorization: str | None = Header(None),
) -> BaseResponse:
    """Lấy thông tin 1 FB inbox account theo seeder user_id."""
    # Validate auth nhưng không giới hạn quyền truy cập
    _get_user_from_header(authorization, request)

    try:
        account = get_account_by_user_id(user_id)
        if not account:
            return BaseResponse(
                success=False,
                message=f"Không tìm thấy account với user_id: {user_id}",
            )
        return BaseResponse(
            success=True,
            message="Success",
            data=account,
        )
    except Exception as e:
        return BaseResponse(success=False, message=f"Lỗi khi lấy thông tin account: {e}")


@router.get("/inbox-accounts/resolve/{seeder_user_id}", response_model=BaseResponse)
def resolve_member_from_user_id(
    seeder_user_id: str,
    request: Request,
    authorization: str | None = Header(None),
) -> BaseResponse:
    """Resolve seeder user_id -> id_member (app_users.id).

    Dùng để kiểm tra xem 1 seeder user_id thuộc về member nào.
    Endpoint này không yêu cầu auth nghiêm ngặt vì chỉ đọc.
    """
    try:
        id_member = resolve_id_member(seeder_user_id)
        if id_member:
            return BaseResponse(
                success=True,
                message="Found",
                data=ResolveMemberResponse(
                    user_id=seeder_user_id,
                    id_member=id_member,
                    found=True,
                    message="Tìm thấy member",
                ).model_dump(),
            )
        else:
            return BaseResponse(
                success=True,
                message="Not found",
                data=ResolveMemberResponse(
                    user_id=seeder_user_id,
                    id_member=None,
                    found=False,
                    message="Không tìm thấy member cho user_id này. Hãy đảm bảo member đã thêm FB account vào app.",
                ).model_dump(),
            )
    except Exception as e:
        return BaseResponse(success=False, message=f"Lỗi khi resolve: {e}")


@router.put("/inbox-accounts/{account_id}", response_model=BaseResponse)
def update_inbox_account(
    account_id: str,
    payload: FbInboxAccountUpdate,
    request: Request,
    authorization: str | None = Header(None),
) -> BaseResponse:
    """Cập nhật FB inbox account."""
    user = _get_user_from_header(authorization, request)
    id_member = user["id"]

    try:
        result = update_account(
            account_id=account_id,
            id_member=id_member,
            fb_user_id=payload.fb_user_id,
            account_label=payload.account_label,
            is_active=payload.is_active,
        )
        return BaseResponse(
            success=True,
            message="Đã cập nhật account thành công",
            data=result,
        )
    except ValueError as e:
        return BaseResponse(success=False, message=str(e))
    except Exception as e:
        return BaseResponse(success=False, message=f"Lỗi khi cập nhật account: {e}")


@router.delete("/inbox-accounts/{account_id}", response_model=BaseResponse)
def delete_inbox_account(
    account_id: str,
    request: Request,
    authorization: str | None = Header(None),
) -> BaseResponse:
    """Xóa FB inbox account."""
    user = _get_user_from_header(authorization, request)
    id_member = user["id"]

    try:
        success = delete_account(account_id, id_member)
        if success:
            return BaseResponse(
                success=True,
                message="Đã xóa account thành công",
            )
        else:
            return BaseResponse(
                success=False,
                message="Không tìm thấy account để xóa",
            )
    except ValueError as e:
        return BaseResponse(success=False, message=str(e))
    except Exception as e:
        return BaseResponse(success=False, message=f"Lỗi khi xóa account: {e}")
