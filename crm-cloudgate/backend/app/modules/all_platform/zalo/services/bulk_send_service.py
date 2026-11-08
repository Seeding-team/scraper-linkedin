"""CRUD cho `zalo_module_bulk_jobs` / `zalo_module_bulk_job_items` (Mục 7 guide, mục 2 item 7:
"Gửi tin nhắn hàng loạt" theo danh sách SĐT/UID).

Dùng lại các REST helper dùng chung của `supabase_service.py` (`_rest`) — KHÔNG
tự viết lại boilerplate `httpx`/headers. Đây là module DB thuần, không gọi ZCA/
Zalo trực tiếp — việc thực thi (gửi tin/kết bạn/mời nhóm) nằm ở
`automation_worker.py`.

LƯU Ý PHÂN BIỆT TÊN: đây là "bulk job" MỚI (1 lượt gửi hàng loạt, chạy 1 lần),
KHÔNG liên quan tới `zalo_broadcast_campaigns`/`create_broadcast_campaign` cũ
trong `supabase_service.py` (đó là tính năng blast nhiều NHÓM khác, sắp bị thay
bằng bước sau của dự án này).
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from app.modules.all_platform.zalo.services.supabase_service import _rest


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


# ─────────────────────────────────────────────────────────────────────────
# CRUD cơ bản — dùng bởi api/routes/bulk_jobs.py
# ─────────────────────────────────────────────────────────────────────────

async def create_bulk_job(
    *,
    account_id: str,
    job_type: str,
    recipients: List[Dict[str, Any]],
    message: Optional[str] = None,
    friend_message: Optional[str] = None,
    image_urls: Optional[List[str]] = None,
    target_group_id: Optional[str] = None,
    target_group_name: Optional[str] = None,
    delay_seconds_min: int = 3,
    delay_seconds_max: int = 8,
    scheduled_at: Optional[str] = None,
    created_by: Optional[str] = None,
) -> Dict[str, Any]:
    """Tạo 1 bulk job + toàn bộ item (mỗi SĐT/UID hợp lệ = 1 item `pending`)."""
    valid_recipients: List[Dict[str, Any]] = []
    for r in recipients:
        phone = str(r.get("phone") or "").strip() or None
        uid = str(r.get("uid") or "").strip() or None
        if not phone and not uid:
            continue
        valid_recipients.append(
            {
                "phone": phone,
                "uid": uid,
                "display_name": str(r.get("display_name") or "").strip() or None,
            }
        )

    payload = {
        "account_id": account_id,
        "job_type": job_type,
        "status": "pending",
        "message": message,
        "friend_message": friend_message,
        "image_urls": image_urls or [],
        "target_group_id": target_group_id,
        "target_group_name": target_group_name,
        "delay_seconds_min": delay_seconds_min,
        "delay_seconds_max": delay_seconds_max,
        "total_count": len(valid_recipients),
        "scheduled_at": scheduled_at,
        "created_by": created_by,
    }
    rows = await _rest("POST", "zalo_module_bulk_jobs", json=[payload], prefer="return=representation")
    job = (rows or [{}])[0]
    job_id = job.get("id")

    if job_id and valid_recipients:
        item_payloads = [
            {
                "job_id": job_id,
                "phone": r["phone"],
                "uid": r["uid"],
                "display_name": r["display_name"],
                "status": "pending",
            }
            for r in valid_recipients
        ]
        await _rest("POST", "zalo_module_bulk_job_items", json=item_payloads)

    return job


async def list_bulk_jobs(account_id: str, *, limit: int = 200) -> List[Dict[str, Any]]:
    return (
        await _rest(
            "GET",
            "zalo_module_bulk_jobs",
            params={
                "select": "*",
                "account_id": f"eq.{account_id}",
                "order": "created_at.desc",
                "limit": str(max(1, min(limit, 1000))),
            },
        )
        or []
    )


async def get_bulk_job(job_id: int) -> Optional[Dict[str, Any]]:
    rows = await _rest(
        "GET",
        "zalo_module_bulk_jobs",
        params={"select": "*", "id": f"eq.{job_id}", "limit": "1"},
    )
    return rows[0] if rows else None


async def list_bulk_job_items(job_id: int, *, limit: int = 5000) -> List[Dict[str, Any]]:
    return (
        await _rest(
            "GET",
            "zalo_module_bulk_job_items",
            params={
                "select": "*",
                "job_id": f"eq.{job_id}",
                "order": "created_at.asc",
                "limit": str(max(1, min(limit, 20000))),
            },
        )
        or []
    )


async def update_bulk_job_status(job_id: int, status: str) -> Optional[Dict[str, Any]]:
    """Pause/resume/cancel — chỉ đổi `status`, worker tự đọc lại ở tick sau."""
    rows = await _rest(
        "PATCH",
        "zalo_module_bulk_jobs",
        params={"id": f"eq.{job_id}"},
        json={"status": status, "updated_at": _now_iso()},
        prefer="return=representation",
    )
    return (rows or [None])[0]


async def delete_bulk_job(job_id: int) -> None:
    await _rest("DELETE", "zalo_module_bulk_jobs", params={"id": f"eq.{job_id}"})


# ─────────────────────────────────────────────────────────────────────────
# Dùng bởi automation_worker.py (tick loop toàn cục)
# ─────────────────────────────────────────────────────────────────────────

async def list_active_jobs(*, limit: int = 50) -> List[Dict[str, Any]]:
    """Job `pending`/`running`, `scheduled_at` null hoặc đã tới giờ."""
    now_iso = _now_iso()
    return (
        await _rest(
            "GET",
            "zalo_module_bulk_jobs",
            params={
                "select": "*",
                "status": "in.(pending,running)",
                "or": f"(scheduled_at.is.null,scheduled_at.lte.{now_iso})",
                "order": "created_at.asc",
                "limit": str(max(1, min(limit, 200))),
            },
        )
        or []
    )


async def list_pending_items(job_id: int, *, limit: int = 5) -> List[Dict[str, Any]]:
    return (
        await _rest(
            "GET",
            "zalo_module_bulk_job_items",
            params={
                "select": "*",
                "job_id": f"eq.{job_id}",
                "status": "eq.pending",
                "order": "created_at.asc",
                "limit": str(max(1, min(limit, 100))),
            },
        )
        or []
    )


async def count_pending_items(job_id: int) -> int:
    rows = (
        await _rest(
            "GET",
            "zalo_module_bulk_job_items",
            params={
                "select": "id",
                "job_id": f"eq.{job_id}",
                "status": "eq.pending",
                "limit": "1",
            },
        )
        or []
    )
    return len(rows)


async def update_job_item_status(item_id: int, status: str, *, error: Optional[str] = None) -> None:
    await _rest(
        "PATCH",
        "zalo_module_bulk_job_items",
        params={"id": f"eq.{item_id}"},
        json={"status": status, "error": error, "processed_at": _now_iso()},
    )


async def mark_job_running_if_pending(job_id: int) -> None:
    """Chuyển `pending` -> `running` khi worker bắt đầu xử lý item đầu tiên."""
    await _rest(
        "PATCH",
        "zalo_module_bulk_jobs",
        params={"id": f"eq.{job_id}", "status": "eq.pending"},
        json={"status": "running", "updated_at": _now_iso()},
    )


async def bump_job_counters(job_id: int, *, sent: int = 0, success: int = 0, failed: int = 0) -> None:
    """Cộng dồn counters. Đọc job hiện tại rồi PATCH — vòng lặp automation worker
    là 1 tiến trình global duy nhất (không có nhiều worker chạy song song tranh
    ghi cùng job) nên không cần atomic increment ở tầng SQL."""
    job = await get_bulk_job(job_id)
    if not job:
        return
    await _rest(
        "PATCH",
        "zalo_module_bulk_jobs",
        params={"id": f"eq.{job_id}"},
        json={
            "sent_count": int(job.get("sent_count") or 0) + sent,
            "success_count": int(job.get("success_count") or 0) + success,
            "failed_count": int(job.get("failed_count") or 0) + failed,
            "updated_at": _now_iso(),
        },
    )


async def mark_job_completed_if_done(job_id: int) -> None:
    """Đánh dấu `completed` khi không còn item nào `pending`."""
    remaining = await count_pending_items(job_id)
    if remaining == 0:
        await _rest(
            "PATCH",
            "zalo_module_bulk_jobs",
            params={"id": f"eq.{job_id}", "status": "in.(pending,running)"},
            json={"status": "completed", "updated_at": _now_iso()},
        )
