"""Broadcast — gửi 1 tin tới nhiều nhóm (Mục 3.3.5/8(h) guide "broadcasts").

Zalo tập trung: bỏ hẳn nhánh Playwright cũ (`crawler/broadcast_sender.py`,
`session_browser.py`, `browser_operation_lock.py`) — chỉ còn 1 đường gửi duy
nhất qua zca-js (`zca_broadcast_sender.py`), dùng `zca_auth_store.load_zca_auth`
thay cho session Playwright cũ, đúng pattern các route mới khác đã dùng.

Nội dung gửi có thể đến từ 1 trong 2 nguồn (xem `ZaloBroadcastRequest`):
  - message_ids: tin đã lưu Library (luồng cũ — Library hiện không còn mount).
  - text/image_urls: gõ trực tiếp, không cần lưu Library trước (luồng mới).
"""

from typing import Any, Dict, List, Optional
import asyncio
import re
import uuid

from fastapi import APIRouter, Depends, Header, HTTPException
from loguru import logger

from app.modules.all_platform.auth_deps import get_authenticated_caller_email
from app.modules.all_platform.zalo.api.routes.accounts import _require_admin_leader_or_self
from app.modules.all_platform.zalo.api.security import verify_zalo_api_key
from app.modules.all_platform.zalo.config import settings
from app.modules.all_platform.zalo.schemas.broadcast import (
    ZaloBroadcastPreviewItem,
    ZaloBroadcastPreviewResponse,
    ZaloBroadcastRequest,
    ZaloBroadcastResponse,
    ZaloBroadcastStatusResponse,
)
from app.modules.all_platform.zalo.services.zca_auth_store import load_zca_auth
from app.modules.all_platform.zalo.services.zca_broadcast_sender import send_zca_broadcast_to_targets
from app.modules.all_platform.zalo.services.supabase_service import (
    SupabaseNotConfigured,
    add_broadcast_log,
    create_broadcast_campaign,
    fetch_messages_by_ids,
    get_broadcast_status,
    get_zalo_account_by_id,
    update_campaign_status,
)

router = APIRouter(
    prefix="/broadcasts",
    tags=["zalo-broadcasts"],
    dependencies=[Depends(verify_zalo_api_key)],
)


def _normalize_user_id(value: Optional[str]) -> str:
    raw = (value or "default").strip().lower()
    raw = re.sub(r"[^a-z0-9._-]+", "-", raw).strip("-._")
    return raw or "default"


async def _resolve_messages(body: ZaloBroadcastRequest, user_id: str) -> List[Dict[str, Any]]:
    """Trả về list message dict (shape {id, content, assets}) từ message_ids
    (Library, nếu có) hoặc synthesize 1 "virtual message" từ text/image_urls."""
    if body.message_ids:
        return await fetch_messages_by_ids(user_id, body.message_ids)
    if (body.text or "").strip() or body.image_urls:
        return [{
            "id": f"direct-{uuid.uuid4()}",
            "content": body.text,
            "assets": [
                {"status": "uploaded", "storage_url": url} for url in body.image_urls
            ],
        }]
    return []


def _asset_count(message: dict) -> int:
    return sum(
        1
        for asset in message.get("assets") or []
        if asset.get("status") == "uploaded" and (asset.get("storage_url") or asset.get("storage_path"))
    )


def _failed_asset_count(message: dict) -> int:
    return sum(1 for asset in message.get("assets") or [] if asset.get("status") == "failed")


def _asset_preview_urls(message: dict) -> List[str]:
    urls: List[str] = []
    for asset in message.get("assets") or []:
        if asset.get("status") != "uploaded":
            continue
        storage_url = asset.get("storage_url")
        if storage_url:
            urls.append(storage_url)
    return urls


def _build_preview(messages: List[dict], target_count: int, content_mode: str) -> ZaloBroadcastPreviewResponse:
    items: List[ZaloBroadcastPreviewItem] = []
    warnings: List[str] = []
    sendable_item_count = 0
    for message in messages:
        image_count = _asset_count(message)
        failed_image_count = _failed_asset_count(message)
        image_urls = _asset_preview_urls(message)
        send_text = content_mode in {"text", "both"} and bool((message.get("content") or "").strip())
        send_images = content_mode in {"image", "both"} and image_count > 0
        if send_text or send_images:
            sendable_item_count += 1
        item_warnings: List[str] = []
        if content_mode == "image" and image_count == 0:
            item_warnings.append("Tin này không có ảnh")
        if content_mode == "text" and not send_text:
            item_warnings.append("Tin này không có nội dung text")
        if content_mode == "both" and not (send_text or send_images):
            item_warnings.append("Tin này không có text hoặc ảnh để gửi")
        if failed_image_count > 0:
            item_warnings.append(f"{failed_image_count} ảnh upload thất bại, sẽ không gửi các ảnh này")
        items.append(
            ZaloBroadcastPreviewItem(
                message_id=message["id"],
                content=message.get("content"),
                image_count=image_count,
                image_urls=image_urls,
                send_text=send_text,
                send_images=send_images,
                warnings=item_warnings,
            )
        )
    if target_count == 0:
        warnings.append("Chưa chọn group đích")
    if not messages:
        warnings.append("Chưa có nội dung để gửi")
    if messages and sendable_item_count == 0:
        warnings.append("Không có tin nào đủ điều kiện gửi với chế độ hiện tại")
    return ZaloBroadcastPreviewResponse(
        target_count=target_count,
        message_count=len(messages),
        items=items,
        warnings=warnings,
    )


@router.post("/preview", response_model=ZaloBroadcastPreviewResponse)
async def preview_broadcast(
    body: ZaloBroadcastRequest,
    x_user_id: str = Header("default", alias="X-User-ID"),
):
    user_id = _normalize_user_id(body.user_id or x_user_id)
    try:
        messages = await _resolve_messages(body, user_id)
        if body.text_overrides:
            for msg in messages:
                override_val = body.text_overrides.get(msg.get("id")) or body.text_overrides.get(msg.get("source_message_id"))
                if override_val is not None:
                    msg["content"] = override_val
        return _build_preview(messages, len(body.targets), body.content_mode)
    except SupabaseNotConfigured as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to build broadcast preview: {exc}")


@router.post("", response_model=ZaloBroadcastResponse)
async def create_broadcast(
    body: ZaloBroadcastRequest,
    x_user_id: str = Header("default", alias="X-User-ID"),
    caller_email: Optional[str] = Depends(get_authenticated_caller_email),
):
    user_id = _normalize_user_id(body.user_id or x_user_id)
    if not body.message_ids and not (body.text or "").strip() and not body.image_urls:
        raise HTTPException(status_code=400, detail="Cần message_ids hoặc text/image_urls")
    if not body.targets:
        raise HTTPException(status_code=400, detail="targets is required")

    target_account = await get_zalo_account_by_id(user_id)
    target_owner = (
        (target_account.get("id_member") or target_account.get("owner_id"))
        if target_account
        else None
    )
    await _require_admin_leader_or_self(caller_email, target_owner)

    auth = await load_zca_auth(user_id)
    if not auth:
        raise HTTPException(status_code=401, detail="Chưa có phiên ZCA hợp lệ. Hãy đăng nhập lại qua extension.")

    try:
        messages = await _resolve_messages(body, user_id)
        if body.message_ids and len(messages) != len(set(body.message_ids)):
            raise HTTPException(status_code=400, detail="Some selected messages were not found")
        if body.text_overrides:
            for msg in messages:
                override_val = body.text_overrides.get(msg.get("id")) or body.text_overrides.get(msg.get("source_message_id"))
                if override_val is not None:
                    msg["content"] = override_val
        preview = _build_preview(messages, len(body.targets), body.content_mode)
        if preview.warnings:
            raise HTTPException(status_code=400, detail="; ".join(preview.warnings))

        message_ids_for_campaign = [m["id"] for m in messages]
        campaign_id = await create_broadcast_campaign(
            user_id,
            body.content_mode,
            message_ids_for_campaign,
            [target.model_dump() for target in body.targets],
        )
        asyncio.create_task(
            _run_broadcast(campaign_id, user_id, auth, messages, [target.model_dump() for target in body.targets], body.content_mode)
        )
        return ZaloBroadcastResponse(campaign_id=campaign_id, status="queued")
    except HTTPException:
        raise
    except SupabaseNotConfigured as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to create broadcast: {exc}")


@router.get("/{campaign_id}", response_model=ZaloBroadcastStatusResponse)
async def get_broadcast(campaign_id: str):
    try:
        return await get_broadcast_status(campaign_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Broadcast {campaign_id} not found")
    except SupabaseNotConfigured as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to get broadcast: {exc}")


async def _run_broadcast(
    campaign_id: str,
    user_id: str,
    auth: Dict[str, Any],
    messages: List[dict],
    targets: List[dict],
    content_mode: str,
) -> None:
    try:
        await update_campaign_status(campaign_id, "running")
        await send_zca_broadcast_to_targets(
            auth, user_id, campaign_id, messages, targets, content_mode,
            settings.broadcast_delay_seconds, add_broadcast_log,
        )
        await update_campaign_status(campaign_id, "completed")
    except Exception as exc:
        logger.error(f"Broadcast campaign {campaign_id} failed: {exc}")
        try:
            await add_broadcast_log(campaign_id, "", "failed", str(exc))
            await update_campaign_status(campaign_id, "failed", str(exc))
        except Exception:
            logger.exception(f"Could not mark broadcast campaign {campaign_id} as failed")
