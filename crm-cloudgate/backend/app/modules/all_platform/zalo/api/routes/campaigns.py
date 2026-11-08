"""Campaigns — CRUD chiến dịch nhắn tin tự động lặp lịch + AI gợi ý nội dung
(Mục 4.3 guide). Thực thi thật nằm ở `services/automation_worker.py`."""

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.modules.all_platform.auth_deps import get_authenticated_caller_email
from app.modules.all_platform.zalo.api.security import verify_zalo_api_key
from app.modules.all_platform.zalo.api.routes.accounts import _require_admin_leader_or_self
from app.modules.all_platform.zalo.services.supabase_service import get_zalo_account_by_id, get_app_user_id_by_email
from app.modules.all_platform.zalo.services import campaign_service as campaigns

router = APIRouter(
    prefix="/campaigns",
    tags=["zalo-campaigns"],
    dependencies=[Depends(verify_zalo_api_key)],
)


async def _require_account_perm(caller_email: Optional[str], account_id: str) -> None:
    account = await get_zalo_account_by_id(account_id)
    await _require_admin_leader_or_self(caller_email, (account or {}).get("id_member") or (account or {}).get("owner_id"))


class Recipient(BaseModel):
    phone: Optional[str] = None
    uid: Optional[str] = None
    display_name: Optional[str] = None


class CampaignCreate(BaseModel):
    account_id: str
    name: str
    is_enabled: bool = True
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    days_of_week: Optional[List[int]] = None
    interval_seconds_min: int = 30
    interval_seconds_max: int = 90
    daily_limit: int = 100
    message_templates: List[str] = []
    repeat_cycle_seconds: int = 86400
    recipients: List[Recipient] = []


@router.get("")
async def list_campaigns(
    account_id: str,
    caller_email: Optional[str] = Depends(get_authenticated_caller_email),
):
    await _require_account_perm(caller_email, account_id)
    return {"campaigns": await campaigns.list_recurring_campaigns(account_id)}


@router.post("")
async def create_campaign(
    body: CampaignCreate,
    caller_email: Optional[str] = Depends(get_authenticated_caller_email),
):
    await _require_account_perm(caller_email, body.account_id)
    created_by = await get_app_user_id_by_email(caller_email) if caller_email else None
    campaign = await campaigns.create_recurring_campaign(
        account_id=body.account_id, name=body.name, is_enabled=body.is_enabled,
        start_time=body.start_time, end_time=body.end_time, days_of_week=body.days_of_week,
        interval_seconds_min=body.interval_seconds_min, interval_seconds_max=body.interval_seconds_max,
        daily_limit=body.daily_limit, message_templates=body.message_templates,
        repeat_cycle_seconds=body.repeat_cycle_seconds, created_by=created_by,
    )
    if body.recipients and campaign.get("id"):
        await campaigns.add_campaign_recipients(campaign["id"], [r.model_dump() for r in body.recipients])
    return {"campaign": campaign}


@router.get("/{campaign_id}")
async def get_campaign(
    campaign_id: int,
    caller_email: Optional[str] = Depends(get_authenticated_caller_email),
):
    campaign = await campaigns.get_recurring_campaign(campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Không tìm thấy chiến dịch")
    await _require_account_perm(caller_email, campaign["account_id"])
    return {"campaign": campaign}


@router.patch("/{campaign_id}")
async def patch_campaign(
    campaign_id: int,
    patch: Dict[str, Any],
    caller_email: Optional[str] = Depends(get_authenticated_caller_email),
):
    campaign = await campaigns.get_recurring_campaign(campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Không tìm thấy chiến dịch")
    await _require_account_perm(caller_email, campaign["account_id"])
    allowed = {
        "name", "is_enabled", "start_time", "end_time", "days_of_week",
        "interval_seconds_min", "interval_seconds_max", "daily_limit",
        "message_templates", "repeat_cycle_seconds",
    }
    safe_patch = {k: v for k, v in patch.items() if k in allowed}
    return {"campaign": await campaigns.update_recurring_campaign(campaign_id, safe_patch)}


@router.delete("/{campaign_id}")
async def remove_campaign(
    campaign_id: int,
    caller_email: Optional[str] = Depends(get_authenticated_caller_email),
):
    campaign = await campaigns.get_recurring_campaign(campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Không tìm thấy chiến dịch")
    await _require_account_perm(caller_email, campaign["account_id"])
    await campaigns.delete_recurring_campaign(campaign_id)
    return {"deleted": True}


@router.get("/{campaign_id}/logs")
async def campaign_logs(
    campaign_id: int,
    caller_email: Optional[str] = Depends(get_authenticated_caller_email),
):
    campaign = await campaigns.get_recurring_campaign(campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Không tìm thấy chiến dịch")
    await _require_account_perm(caller_email, campaign["account_id"])
    return {"logs": await campaigns.list_campaign_logs(campaign_id)}


@router.get("/{campaign_id}/recipients")
async def get_recipients(
    campaign_id: int,
    caller_email: Optional[str] = Depends(get_authenticated_caller_email),
):
    campaign = await campaigns.get_recurring_campaign(campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Không tìm thấy chiến dịch")
    await _require_account_perm(caller_email, campaign["account_id"])
    return {"recipients": await campaigns.list_campaign_recipients(campaign_id)}


@router.post("/{campaign_id}/recipients")
async def add_recipients(
    campaign_id: int,
    recipients: List[Recipient],
    caller_email: Optional[str] = Depends(get_authenticated_caller_email),
):
    campaign = await campaigns.get_recurring_campaign(campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Không tìm thấy chiến dịch")
    await _require_account_perm(caller_email, campaign["account_id"])
    saved = await campaigns.add_campaign_recipients(campaign_id, [r.model_dump() for r in recipients])
    return {"added": saved}


class AiSuggestBody(BaseModel):
    brief: str


@router.post("/ai-suggest")
async def ai_suggest(
    body: AiSuggestBody,
    caller_email: Optional[str] = Depends(get_authenticated_caller_email),
):
    if not caller_email:
        raise HTTPException(status_code=401, detail="Cần đăng nhập")
    try:
        templates = await campaigns.suggest_campaign_message_templates(body.brief)
    except campaigns.GeminiNotConfigured as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    return {"templates": templates}
