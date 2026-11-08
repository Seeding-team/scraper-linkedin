"""Bulk-send — CRUD/tạo job gửi hàng loạt (Mục 4.3 guide). Thực thi thật nằm ở
`services/automation_worker.py` (chạy nền)."""

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.modules.all_platform.auth_deps import get_authenticated_caller_email
from app.modules.all_platform.zalo.api.security import verify_zalo_api_key
from app.modules.all_platform.zalo.api.routes.accounts import _require_admin_leader_or_self
from app.modules.all_platform.zalo.services.supabase_service import get_zalo_account_by_id, get_app_user_id_by_email
from app.modules.all_platform.zalo.services import bulk_send_service as bulk

router = APIRouter(
    prefix="/bulk-jobs",
    tags=["zalo-bulk-jobs"],
    dependencies=[Depends(verify_zalo_api_key)],
)


async def _require_account_perm(caller_email: Optional[str], account_id: str) -> None:
    account = await get_zalo_account_by_id(account_id)
    await _require_admin_leader_or_self(caller_email, (account or {}).get("id_member") or (account or {}).get("owner_id"))


class Recipient(BaseModel):
    phone: Optional[str] = None
    uid: Optional[str] = None
    display_name: Optional[str] = None


class BulkJobCreate(BaseModel):
    account_id: str
    job_type: str  # send_message | add_friend | invite_group
    recipients: List[Recipient]
    message: Optional[str] = None
    friend_message: Optional[str] = None
    image_urls: Optional[List[str]] = None
    target_group_id: Optional[str] = None
    target_group_name: Optional[str] = None
    delay_seconds_min: int = 3
    delay_seconds_max: int = 8
    scheduled_at: Optional[str] = None


@router.get("")
async def list_jobs(
    account_id: str,
    caller_email: Optional[str] = Depends(get_authenticated_caller_email),
):
    await _require_account_perm(caller_email, account_id)
    return {"jobs": await bulk.list_bulk_jobs(account_id)}


@router.post("")
async def create_job(
    body: BulkJobCreate,
    caller_email: Optional[str] = Depends(get_authenticated_caller_email),
):
    await _require_account_perm(caller_email, body.account_id)
    if body.job_type not in {"send_message", "add_friend", "invite_group"}:
        raise HTTPException(status_code=400, detail="job_type không hợp lệ")
    if not body.recipients:
        raise HTTPException(status_code=400, detail="Cần ít nhất 1 người nhận")
    created_by = await get_app_user_id_by_email(caller_email) if caller_email else None
    job = await bulk.create_bulk_job(
        account_id=body.account_id, job_type=body.job_type,
        recipients=[r.model_dump() for r in body.recipients],
        message=body.message, friend_message=body.friend_message,
        image_urls=body.image_urls, target_group_id=body.target_group_id,
        target_group_name=body.target_group_name,
        delay_seconds_min=body.delay_seconds_min, delay_seconds_max=body.delay_seconds_max,
        scheduled_at=body.scheduled_at, created_by=created_by,
    )
    return {"job": job}


@router.get("/{job_id}")
async def get_job(
    job_id: int,
    caller_email: Optional[str] = Depends(get_authenticated_caller_email),
):
    job = await bulk.get_bulk_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Không tìm thấy job")
    await _require_account_perm(caller_email, job["account_id"])
    items = await bulk.list_bulk_job_items(job_id)
    return {"job": job, "items": items}


class BulkJobStatusPatch(BaseModel):
    status: str  # paused | pending | cancelled


@router.patch("/{job_id}")
async def patch_job(
    job_id: int,
    body: BulkJobStatusPatch,
    caller_email: Optional[str] = Depends(get_authenticated_caller_email),
):
    job = await bulk.get_bulk_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Không tìm thấy job")
    await _require_account_perm(caller_email, job["account_id"])
    return {"job": await bulk.update_bulk_job_status(job_id, body.status)}


@router.delete("/{job_id}")
async def remove_job(
    job_id: int,
    caller_email: Optional[str] = Depends(get_authenticated_caller_email),
):
    job = await bulk.get_bulk_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Không tìm thấy job")
    await _require_account_perm(caller_email, job["account_id"])
    await bulk.delete_bulk_job(job_id)
    return {"deleted": True}
