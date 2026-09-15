"""Automation worker — tick loop xử lý `zalo_bulk_jobs` + `zalo_campaigns`
(Mục 4.7 guide `automationWorker.js`, port sang 1 asyncio background task thay vì
worker Node.js riêng — xem Kiến trúc quy đổi trong plan).

CRUD nằm ở `bulk_send_service.py` / `campaign_service.py` — module này CHỈ chứa
logic tick (đọc job/campaign đang active, gọi zca_api_bridge để gửi thật, cập
nhật counters). Gọi định kỳ từ `main.py` lifespan (`AUTOMATION_TICK_INTERVAL_MS`,
mặc định 5000ms).
"""

from __future__ import annotations

import asyncio
import os
import random
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from loguru import logger

from app.modules.all_platform.zalo.services import bulk_send_service as bulk
from app.modules.all_platform.zalo.services import campaign_service as campaigns
from app.modules.all_platform.zalo.services.zca_auth_store import load_zca_auth
from app.modules.all_platform.zalo.services.zca_api_bridge import (
    send_zca_message,
    send_zca_images,
    find_zca_user_by_phone,
    send_zca_friend_request,
)


# ZoneInfo("Asia/Ho_Chi_Minh") crash o production: container thieu goi he thong
# `tzdata`, ZoneInfoNotFoundError ngay tu module level -> ca backend crash-loop.
# Da gap + fix dung offset co dinh nay 1 lan truoc o supabase_quote_service.py,
# lam lai dung y het pattern do thay vi ZoneInfo.
VN_TZ = timezone(timedelta(hours=7))


def _account_lock_registry() -> Dict[str, asyncio.Lock]:
    global _LOCKS
    try:
        return _LOCKS
    except NameError:
        _LOCKS = {}
        return _LOCKS


def _lock_for(account_id: str) -> asyncio.Lock:
    registry = _account_lock_registry()
    if account_id not in registry:
        registry[account_id] = asyncio.Lock()
    return registry[account_id]


# ─────────────────────────────────────────────────────────────────────────
# Bulk jobs
# ─────────────────────────────────────────────────────────────────────────

async def _process_bulk_item(account_id: str, job: Dict[str, Any], item: Dict[str, Any]) -> None:
    auth = await load_zca_auth(account_id)
    if not auth:
        await bulk.update_job_item_status(item["id"], "failed", error="Tài khoản Zalo chưa đăng nhập")
        await bulk.bump_job_counters(job["id"], sent=1, failed=1)
        return

    job_type = job.get("job_type")
    phone, uid = item.get("phone"), item.get("uid")
    try:
        # Nếu chỉ có phone, tra uid trước (dùng chung cho mọi job_type).
        if not uid and phone:
            found = await find_zca_user_by_phone(auth, phone)
            uid = found.get("uid") or found.get("userId") or found.get("id")
            if not uid:
                await bulk.update_job_item_status(item["id"], "not_found", error="Không tìm thấy user theo SĐT")
                await bulk.bump_job_counters(job["id"], sent=1, failed=1)
                return

        if job_type == "send_message":
            image_urls = job.get("image_urls") or []
            if image_urls:
                await send_zca_images(auth, uid, list(image_urls), text=job.get("message") or "", thread_type=0)
            else:
                await send_zca_message(auth, uid, job.get("message") or "", thread_type=0)
        elif job_type == "add_friend":
            await send_zca_friend_request(auth, uid, message=job.get("friend_message") or job.get("message") or "")
        elif job_type == "invite_group":
            # Mời vào nhóm dùng chung logic add-friend trước (nếu chưa bạn bè) rồi
            # mời — đơn giản hoá: gửi lời mời kết bạn kèm link nhóm trong tin nhắn,
            # tương đương fallback "gửi link nếu người lạ" ở Mục 3.3.5 guide.
            group_link = job.get("target_group_name") or job.get("target_group_id") or ""
            await send_zca_message(auth, uid, f"{job.get('message') or ''}\n{group_link}".strip(), thread_type=0)
        else:
            raise ValueError(f"Unknown job_type: {job_type}")

        await bulk.update_job_item_status(item["id"], "sent")
        await bulk.bump_job_counters(job["id"], sent=1, success=1)
    except Exception as exc:
        logger.warning(f"[bulk-send] item failed job={job['id']} item={item['id']}: {exc}")
        await bulk.update_job_item_status(item["id"], "failed", error=str(exc)[:500])
        await bulk.bump_job_counters(job["id"], sent=1, failed=1)


async def _tick_bulk_jobs() -> None:
    jobs = await bulk.list_active_jobs()
    for job in jobs:
        account_id = job["account_id"]
        lock = _lock_for(f"bulk:{account_id}")
        if lock.locked():
            continue  # đang xử lý job khác của account này — bỏ qua tick này
        async with lock:
            await bulk.mark_job_running_if_pending(job["id"])
            items = await bulk.list_pending_items(job["id"], limit=1)
            if not items:
                await bulk.mark_job_completed_if_done(job["id"])
                continue
            await _process_bulk_item(account_id, job, items[0])
            delay = random.uniform(job.get("delay_seconds_min", 3), job.get("delay_seconds_max", 8))
            await asyncio.sleep(delay)


# ─────────────────────────────────────────────────────────────────────────
# Campaigns
# ─────────────────────────────────────────────────────────────────────────

def _campaign_in_active_window(campaign: Dict[str, Any], now_vn: datetime) -> bool:
    days = campaign.get("days_of_week")
    if days and now_vn.isoweekday() % 7 not in [d % 7 for d in days]:
        return False
    start_s, end_s = campaign.get("start_time"), campaign.get("end_time")
    if not start_s or not end_s:
        return True
    now_t = now_vn.time()
    try:
        from datetime import time as dtime
        def _parse(s: str) -> "dtime":
            parts = [int(p) for p in str(s).split(":")]
            return dtime(parts[0], parts[1] if len(parts) > 1 else 0)
        start_t, end_t = _parse(start_s), _parse(end_s)
    except Exception:
        return True
    if start_t <= end_t:
        return start_t <= now_t <= end_t
    return now_t >= start_t or now_t <= end_t  # khung giờ qua nửa đêm


async def _tick_one_campaign(campaign: Dict[str, Any], now_vn: datetime) -> None:
    account_id = campaign["account_id"]
    if not campaign.get("is_enabled"):
        return
    campaign = await campaigns.reset_sent_today_if_new_day(campaign, now_vn.date())
    if int(campaign.get("sent_today") or 0) >= int(campaign.get("daily_limit") or 100):
        return
    if not _campaign_in_active_window(campaign, now_vn):
        return

    last_sent_at = campaign.get("last_sent_at")
    interval_min = float(campaign.get("interval_seconds_min") or 30)
    if last_sent_at:
        try:
            last_dt = datetime.fromisoformat(str(last_sent_at).replace("Z", "+00:00"))
            if (datetime.now(timezone.utc) - last_dt).total_seconds() < interval_min:
                return
        except Exception:
            pass

    recipient = await campaigns.get_next_pending_recipient(campaign["id"])
    if not recipient:
        return

    lock = _lock_for(f"campaign:{account_id}")
    if lock.locked():
        return
    async with lock:
        auth = await load_zca_auth(account_id)
        templates = campaign.get("message_templates") or []
        if not auth or not templates:
            return
        idx = int(campaign.get("next_template_index") or 0) % len(templates)
        template = str(templates[idx])
        name = recipient.get("display_name") or ""
        message = template.replace("{{ten}}", name)

        uid = recipient.get("uid")
        try:
            if not uid and recipient.get("phone"):
                found = await find_zca_user_by_phone(auth, recipient["phone"])
                uid = found.get("uid") or found.get("userId") or found.get("id")
            if not uid:
                raise RuntimeError("Không tìm thấy user theo SĐT")
            await send_zca_message(auth, uid, message, thread_type=0)
            await campaigns.update_campaign_recipient_status(recipient["id"], "success", sent_at=datetime.now(timezone.utc).isoformat())
            await campaigns.add_campaign_log(campaign["id"], recipient_id=recipient["id"], phone=recipient.get("phone"), status="success", message_sent=message)
        except Exception as exc:
            logger.warning(f"[campaign] send failed campaign={campaign['id']} recipient={recipient['id']}: {exc}")
            await campaigns.update_campaign_recipient_status(recipient["id"], "failed", error=str(exc)[:500])
            await campaigns.add_campaign_log(campaign["id"], recipient_id=recipient["id"], phone=recipient.get("phone"), status="failed", error=str(exc)[:500])
            return

        await campaigns.advance_campaign_after_send(
            campaign["id"],
            next_template_index=(idx + 1) % len(templates),
            sent_today=int(campaign.get("sent_today") or 0) + 1,
            last_sent_at=datetime.now(timezone.utc).isoformat(),
        )


async def _tick_campaigns() -> None:
    now_vn = datetime.now(VN_TZ)
    active = await campaigns.list_enabled_campaigns()
    for campaign in active:
        try:
            await _tick_one_campaign(campaign, now_vn)
        except Exception:
            logger.exception(f"[campaign] tick failed campaign={campaign.get('id')}")


async def run_automation_tick() -> None:
    """1 tick toàn cục — gọi định kỳ từ main.py lifespan."""
    try:
        await _tick_bulk_jobs()
    except Exception:
        logger.exception("[bulk-send] tick failed")
    try:
        await _tick_campaigns()
    except Exception:
        logger.exception("[campaign] tick failed")
