"""Web Push — VAPID public key + đăng ký/hủy subscription (Mục 4.3/11.10 guide).

VAPID public key PHẢI đọc qua API route này lúc RUNTIME (không dùng `NEXT_PUBLIC_*`
bake lúc build) — đúng bài học Mục 11.10 guide.
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.modules.all_platform.auth_deps import get_authenticated_caller_email
from app.modules.all_platform.zalo.api.security import verify_zalo_api_key
from app.modules.all_platform.zalo.config import settings
from app.modules.all_platform.zalo.services.supabase_service import get_app_user_id_by_email
from app.modules.all_platform.zalo.services import push_service

router = APIRouter(
    prefix="/push",
    tags=["zalo-push"],
    dependencies=[Depends(verify_zalo_api_key)],
)


@router.get("/vapid-public-key")
async def vapid_public_key():
    return {"public_key": settings.vapid_public_key}


class SubscriptionKeys(BaseModel):
    p256dh: str
    auth: str


class SubscribeBody(BaseModel):
    endpoint: str
    keys: SubscriptionKeys
    user_agent: Optional[str] = None


@router.post("/subscribe")
async def subscribe(
    body: SubscribeBody,
    caller_email: Optional[str] = Depends(get_authenticated_caller_email),
):
    if not caller_email:
        raise HTTPException(status_code=401, detail="Cần đăng nhập")
    app_user_id = await get_app_user_id_by_email(caller_email)
    if not app_user_id:
        raise HTTPException(status_code=403, detail="Không tìm thấy thông tin người dùng")
    await push_service.save_subscription(app_user_id, body.endpoint, body.keys.p256dh, body.keys.auth, body.user_agent)
    return {"subscribed": True}


class UnsubscribeBody(BaseModel):
    endpoint: str


@router.delete("/subscribe")
async def unsubscribe(
    body: UnsubscribeBody,
    caller_email: Optional[str] = Depends(get_authenticated_caller_email),
):
    if not caller_email:
        raise HTTPException(status_code=401, detail="Cần đăng nhập")
    app_user_id = await get_app_user_id_by_email(caller_email)
    if not app_user_id:
        raise HTTPException(status_code=403, detail="Không tìm thấy thông tin người dùng")
    await push_service.delete_subscription(app_user_id, body.endpoint)
    return {"subscribed": False}
