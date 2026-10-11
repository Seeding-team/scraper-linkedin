"""Sales asset library endpoints."""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile

from app.modules.all_platform.auth_deps import get_current_user
from app.modules.all_platform.schemas import (
    BaseResponse,
    SalesAssetCreateRequest,
    SalesAssetSendRequest,
    SalesAssetUpdateRequest,
)
from app.modules.all_platform.services import (
    archive_sales_asset,
    create_sales_asset,
    delete_sales_asset,
    get_sales_asset,
    list_sales_assets,
    send_sales_asset,
    update_sales_asset,
)
from app.modules.all_platform.services.crm_attachment_service import (
    MAX_FILE_SIZE_BYTES,
    allowed_mime,
    upload_attachment,
)

router = APIRouter()


@router.get("")
def sales_assets_list(
    search: str | None = Query(None),
    type: str | None = Query(None),
    status: str | None = Query(None),
    customer_lead_id: str | None = Query(None),
    deal_id: str | None = Query(None),
    project_name: str | None = Query(None),
    include_archived: bool = Query(False),
    _user: dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    try:
        data = list_sales_assets(
            search=search,
            asset_type=type,
            status=status,
            customer_lead_id=customer_lead_id,
            deal_id=deal_id,
            project_name=project_name,
            include_archived=include_archived,
        )
        return BaseResponse(success=True, data=data)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.post("")
def sales_assets_create(
    payload: SalesAssetCreateRequest,
    user: dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    try:
        data = create_sales_asset(payload.model_dump(), user.get("id"))
        return BaseResponse(success=True, message="Da tao tai lieu ban hang", data=data)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.post("/upload")
async def sales_assets_upload(
    file: UploadFile = File(...),
    asset_id: Optional[str] = Form(None),
    _user: dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    try:
        content_type = (file.content_type or "").lower()
        if not allowed_mime(content_type):
            return BaseResponse(success=False, message=f"Dinh dang file khong duoc phep: {content_type}")

        raw = await file.read()
        if len(raw) > MAX_FILE_SIZE_BYTES:
            mb = MAX_FILE_SIZE_BYTES // (1024 * 1024)
            return BaseResponse(success=False, message=f"File qua lon (> {mb} MB).")

        filename = file.filename or "sales-asset"
        url, err = upload_attachment(
            prefix="sales-assets",
            customer_id=asset_id or None,
            filename=filename,
            content=raw,
            content_type=content_type,
        )
        if err:
            return BaseResponse(success=False, message=err)
        return BaseResponse(
            success=True,
            message="Uploaded",
            data={"url": url, "name": filename, "size": len(raw), "content_type": content_type},
        )
    except Exception as e:
        return BaseResponse(success=False, message=f"Upload that bai: {e}")


@router.get("/{asset_id}")
def sales_assets_get(asset_id: str, _user: dict[str, Any] = Depends(get_current_user)) -> BaseResponse:
    try:
        return BaseResponse(success=True, data=get_sales_asset(asset_id))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.patch("/{asset_id}")
def sales_assets_update(
    asset_id: str,
    payload: SalesAssetUpdateRequest,
    _user: dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    try:
        data = update_sales_asset(asset_id, payload.model_dump(exclude_none=True))
        return BaseResponse(success=True, message="Da luu tai lieu ban hang", data=data)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.post("/{asset_id}/archive")
def sales_assets_archive(asset_id: str, _user: dict[str, Any] = Depends(get_current_user)) -> BaseResponse:
    try:
        return BaseResponse(success=True, message="Da luu tru tai lieu", data=archive_sales_asset(asset_id))
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.delete("/{asset_id}")
def sales_assets_delete(asset_id: str, _user: dict[str, Any] = Depends(get_current_user)) -> BaseResponse:
    try:
        delete_sales_asset(asset_id)
        return BaseResponse(success=True, message="Da xoa tai lieu ban hang")
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.post("/{asset_id}/send")
def sales_assets_send(
    asset_id: str,
    payload: SalesAssetSendRequest,
    user: dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    try:
        data = send_sales_asset(asset_id, payload.model_dump(exclude_none=True), user)
        return BaseResponse(success=True, message="Da chuan bi tai lieu de gui", data=data)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))
