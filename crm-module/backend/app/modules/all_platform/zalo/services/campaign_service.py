"""CRUD cho `zalo_campaigns` / `zalo_campaign_recipients` / `zalo_campaign_logs`
(Mục 7 guide, mục 2 item 8: "Chiến dịch nhắn tin tự động lặp lịch").

KHÁC với `zalo_broadcast_campaigns` cũ trong `supabase_service.py` (blast 1 lần
tới nhiều NHÓM) — đây là campaign MỚI: lặp lịch theo khung giờ/ngày trong tuần,
xoay vòng nhiều mẫu tin, giới hạn số lượng/ngày, gửi tới từng SĐT/UID cá nhân.
Tên hàm cố tình đặt khác (`create_recurring_campaign`, không phải
`create_campaign`) để tránh nhầm với hàm cũ.

Dùng lại `_rest()` dùng chung của `supabase_service.py`. Việc thực thi gửi tin
thật nằm ở `automation_worker.py`; module này thuần CRUD DB + gọi Gemini để gợi
ý nội dung (mục "ai-suggest").
"""

from __future__ import annotations

import asyncio
import json
import os
import random
from datetime import date, datetime, timezone
from typing import Any, Dict, List, Optional

from loguru import logger

from app.modules.all_platform.zalo.services.supabase_service import _rest


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


# ─────────────────────────────────────────────────────────────────────────
# CRUD campaign — dùng bởi api/routes/campaigns.py
# ─────────────────────────────────────────────────────────────────────────

async def create_recurring_campaign(
    *,
    account_id: str,
    name: str,
    is_enabled: bool = True,
    start_time: Optional[str] = None,
    end_time: Optional[str] = None,
    days_of_week: Optional[List[int]] = None,
    interval_seconds_min: int = 30,
    interval_seconds_max: int = 90,
    daily_limit: int = 100,
    message_templates: Optional[List[str]] = None,
    repeat_cycle_seconds: int = 86400,
    created_by: Optional[str] = None,
) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "account_id": account_id,
        "name": name,
        "is_enabled": is_enabled,
        "start_time": start_time,
        "end_time": end_time,
        "interval_seconds_min": interval_seconds_min,
        "interval_seconds_max": interval_seconds_max,
        "daily_limit": daily_limit,
        "message_templates": message_templates or [],
        "repeat_cycle_seconds": repeat_cycle_seconds,
        "created_by": created_by,
    }
    if days_of_week is not None:
        payload["days_of_week"] = days_of_week
    rows = await _rest("POST", "zalo_campaigns", json=[payload], prefer="return=representation")
    return (rows or [{}])[0]


async def list_recurring_campaigns(
    account_id: Optional[str] = None, *, limit: int = 200
) -> List[Dict[str, Any]]:
    params: Dict[str, Any] = {
        "select": "*",
        "order": "created_at.desc",
        "limit": str(max(1, min(limit, 1000))),
    }
    if account_id:
        params["account_id"] = f"eq.{account_id}"
    return await _rest("GET", "zalo_campaigns", params=params) or []


async def get_recurring_campaign(campaign_id: int) -> Optional[Dict[str, Any]]:
    rows = await _rest(
        "GET",
        "zalo_campaigns",
        params={"select": "*", "id": f"eq.{campaign_id}", "limit": "1"},
    )
    return rows[0] if rows else None


async def update_recurring_campaign(campaign_id: int, patch: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    body = dict(patch)
    body["updated_at"] = _now_iso()
    rows = await _rest(
        "PATCH",
        "zalo_campaigns",
        params={"id": f"eq.{campaign_id}"},
        json=body,
        prefer="return=representation",
    )
    return (rows or [None])[0]


async def delete_recurring_campaign(campaign_id: int) -> None:
    await _rest("DELETE", "zalo_campaigns", params={"id": f"eq.{campaign_id}"})


# ─────────────────────────────────────────────────────────────────────────
# Recipients
# ─────────────────────────────────────────────────────────────────────────

async def add_campaign_recipients(campaign_id: int, recipients: List[Dict[str, Any]]) -> int:
    """Thêm danh sách SĐT/UID. Idempotent theo `unique(campaign_id, phone)` khi
    có phone (merge-duplicates); recipient chỉ có uid (không phone) luôn insert
    mới vì unique constraint không áp dụng được cho NULL phone."""
    with_phone: List[Dict[str, Any]] = []
    without_phone: List[Dict[str, Any]] = []
    for r in recipients:
        phone = str(r.get("phone") or "").strip() or None
        uid = str(r.get("uid") or "").strip() or None
        if not phone and not uid:
            continue
        row = {
            "campaign_id": campaign_id,
            "phone": phone,
            "uid": uid,
            "display_name": str(r.get("display_name") or "").strip() or None,
            "status": "pending",
        }
        (with_phone if phone else without_phone).append(row)

    saved = 0
    if with_phone:
        rows = (
            await _rest(
                "POST",
                "zalo_campaign_recipients",
                json=with_phone,
                params={"on_conflict": "campaign_id,phone"},
                prefer="resolution=merge-duplicates,return=representation",
            )
            or []
        )
        saved += len(rows)
    if without_phone:
        rows = (
            await _rest(
                "POST",
                "zalo_campaign_recipients",
                json=without_phone,
                prefer="return=representation",
            )
            or []
        )
        saved += len(rows)
    return saved


async def list_campaign_recipients(campaign_id: int, *, limit: int = 2000) -> List[Dict[str, Any]]:
    return (
        await _rest(
            "GET",
            "zalo_campaign_recipients",
            params={
                "select": "*",
                "campaign_id": f"eq.{campaign_id}",
                "order": "created_at.desc",
                "limit": str(max(1, min(limit, 10000))),
            },
        )
        or []
    )


async def get_next_pending_recipient(campaign_id: int) -> Optional[Dict[str, Any]]:
    rows = (
        await _rest(
            "GET",
            "zalo_campaign_recipients",
            params={
                "select": "*",
                "campaign_id": f"eq.{campaign_id}",
                "status": "eq.pending",
                "order": "created_at.asc",
                "limit": "1",
            },
        )
        or []
    )
    return rows[0] if rows else None


async def update_campaign_recipient_status(
    recipient_id: int,
    status: str,
    *,
    error: Optional[str] = None,
    sent_at: Optional[str] = None,
) -> None:
    body: Dict[str, Any] = {"status": status}
    if error is not None:
        body["last_error"] = error
    if sent_at is not None:
        body["sent_at"] = sent_at
    await _rest(
        "PATCH",
        "zalo_campaign_recipients",
        params={"id": f"eq.{recipient_id}"},
        json=body,
    )


# ─────────────────────────────────────────────────────────────────────────
# Logs
# ─────────────────────────────────────────────────────────────────────────

async def add_campaign_log(
    campaign_id: int,
    *,
    recipient_id: Optional[int],
    phone: Optional[str],
    status: str,
    error: Optional[str] = None,
    message_sent: Optional[str] = None,
) -> None:
    await _rest(
        "POST",
        "zalo_campaign_logs",
        json=[
            {
                "campaign_id": campaign_id,
                "recipient_id": recipient_id,
                "phone": phone,
                "status": status,
                "error": error,
                "message_sent": message_sent,
            }
        ],
    )


async def list_campaign_logs(campaign_id: int, *, limit: int = 200) -> List[Dict[str, Any]]:
    return (
        await _rest(
            "GET",
            "zalo_campaign_logs",
            params={
                "select": "*",
                "campaign_id": f"eq.{campaign_id}",
                "order": "created_at.desc",
                "limit": str(max(1, min(limit, 2000))),
            },
        )
        or []
    )


# ─────────────────────────────────────────────────────────────────────────
# Dùng bởi automation_worker.py (tick loop toàn cục)
# ─────────────────────────────────────────────────────────────────────────

async def list_enabled_campaigns() -> List[Dict[str, Any]]:
    return (
        await _rest(
            "GET",
            "zalo_campaigns",
            params={"select": "*", "is_enabled": "eq.true", "limit": "500"},
        )
        or []
    )


async def reset_sent_today_if_new_day(campaign: Dict[str, Any], today: date) -> Dict[str, Any]:
    """Nếu `sent_today_date` khác hôm nay (giờ VN) thì reset `sent_today=0` trên
    DB và trả về bản campaign đã cập nhật để worker dùng số liệu mới nhất ngay
    trong cùng 1 tick (tránh phải đọc lại DB)."""
    today_str = today.isoformat()
    if campaign.get("sent_today_date") == today_str:
        return campaign
    updated = await update_recurring_campaign(
        int(campaign["id"]), {"sent_today": 0, "sent_today_date": today_str}
    )
    return updated or {**campaign, "sent_today": 0, "sent_today_date": today_str}


async def advance_campaign_after_send(
    campaign_id: int,
    *,
    next_template_index: int,
    sent_today: int,
    last_sent_at: str,
) -> None:
    await update_recurring_campaign(
        campaign_id,
        {
            "next_template_index": next_template_index,
            "sent_today": sent_today,
            "last_sent_at": last_sent_at,
        },
    )


# ─────────────────────────────────────────────────────────────────────────
# AI gợi ý nội dung (Gemini) — mục 2 item 8 "gợi ý nội dung bằng AI (Gemini)".
# Tái dùng đúng pattern env var + package của
# app/modules/all_platform/services/post_relevance_ai_service.py
# (GEMINI_API_KEY / GEMINI_API_KEY_2 / GEMINI_MODEL, google-generativeai đã có
# sẵn trong requirements.txt) — không dựng client Gemini kiểu khác.
# ─────────────────────────────────────────────────────────────────────────

class GeminiNotConfigured(RuntimeError):
    """GEMINI_API_KEY (và GEMINI_API_KEY_2) chưa được cấu hình trên server."""


_AI_SUGGEST_SYSTEM_PROMPT = (
    "Bạn là trợ lý viết tin nhắn Zalo ngắn gọn, tự nhiên, không spam, dùng cho "
    "chiến dịch nhắn tin seeding/bán hàng tới khách hàng cá nhân qua Zalo.\n\n"
    "Từ một mô tả ngắn (brief) về sản phẩm/dịch vụ/kịch bản tiếp cận, hãy viết "
    "1-3 mẫu tin nhắn khác nhau (đa dạng cách mở đầu, giọng văn lịch sự, tiếng "
    "Việt tự nhiên). Mỗi mẫu CÓ THỂ chứa biến {{ten}} (đúng 2 dấu ngoặc nhọn ở "
    "2 đầu) để cá nhân hoá tên người nhận khi gửi, không bắt buộc.\n\n"
    "Trả về ĐÚNG JSON (không kèm chữ khác), dạng:\n"
    '{"templates": ["mẫu 1", "mẫu 2", "mẫu 3"]}'
)


def _gemini_api_keys() -> List[str]:
    return [k for k in (os.getenv("GEMINI_API_KEY"), os.getenv("GEMINI_API_KEY_2")) if k]


def _clean_json_response(text: str) -> str:
    cleaned = (text or "").strip().replace("```json", "```").replace("```", "")
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start != -1 and end != -1 and end > start:
        return cleaned[start : end + 1]
    return cleaned


async def suggest_campaign_message_templates(brief: str) -> List[str]:
    """Gọi Gemini để gợi ý 1-3 mẫu tin nhắn từ 1 brief ngắn.

    Raises:
        GeminiNotConfigured: khi thiếu GEMINI_API_KEY trên server (4xx cho caller).
        RuntimeError: các lỗi gọi Gemini/parse JSON khác.
    """
    api_keys = _gemini_api_keys()
    if not api_keys:
        raise GeminiNotConfigured("GEMINI_API_KEY chưa được cấu hình trên server.")

    model_name = os.getenv("GEMINI_MODEL", "gemini-1.5-pro")

    def _call() -> str:
        import google.generativeai as genai

        genai.configure(api_key=random.choice(api_keys))
        model = genai.GenerativeModel(model_name)
        resp = model.generate_content(
            [
                {"role": "user", "parts": [{"text": _AI_SUGGEST_SYSTEM_PROMPT}]},
                {"role": "user", "parts": [{"text": brief}]},
            ],
            generation_config={"temperature": 0.6, "max_output_tokens": 500},
        )
        return getattr(resp, "text", None) or str(resp)

    try:
        text = await asyncio.wait_for(asyncio.to_thread(_call), timeout=30)
    except Exception as exc:
        logger.warning(f"campaigns/ai-suggest: Gemini call failed: {exc}")
        raise RuntimeError(f"Gemini gọi thất bại: {exc}") from exc

    cleaned = _clean_json_response(text)
    try:
        data = json.loads(cleaned)
    except Exception as exc:
        logger.warning(f"campaigns/ai-suggest: JSON parse failed: {cleaned[:300]!r}")
        raise RuntimeError(f"Gemini trả về JSON không hợp lệ: {exc}") from exc

    templates = data.get("templates") if isinstance(data, dict) else None
    if not isinstance(templates, list):
        raise RuntimeError("Gemini không trả về field 'templates' dạng list.")
    return [str(t).strip() for t in templates if str(t or "").strip()][:3]
