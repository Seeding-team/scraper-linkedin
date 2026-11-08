"""Pool tài khoản Facebook seeding cho VPS worker (claim/lock atomic, cùng mô hình
với crawl_workers/crawl_jobs) — thay cho việc RDP tay đăng nhập từng VM."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from app.core.supabase_client import execute_supabase_query, get_supabase_client

logger = logging.getLogger(__name__)

_SAME_SITE_MAP = {"Strict": "strict", "Lax": "lax", "None": "no_restriction"}


def _playwright_cookies_to_chrome(state: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Convert cookie Playwright storage_state() -> format chrome.cookies.set() cần.

    Khác biệt chính:
    - Playwright: expires (epoch giây, -1 = session cookie), sameSite "Strict/Lax/None".
    - Chrome ext: cần thêm "url", "expirationDate" (BỎ nếu là session cookie),
      sameSite viết thường "strict/lax/no_restriction/unspecified".
    """
    chrome_cookies: List[Dict[str, Any]] = []
    for c in (state or {}).get("cookies") or []:
        domain = c.get("domain") or ""
        if "facebook.com" not in domain:
            continue  # bỏ cookie của origin khác (nếu storage_state có lẫn)

        host = domain.lstrip(".")
        item = {
            "url": f"https://{host}/",
            "name": c.get("name"),
            "value": c.get("value"),
            "domain": domain,
            "path": c.get("path") or "/",
            "secure": bool(c.get("secure", True)),
            "httpOnly": bool(c.get("httpOnly", False)),
            "sameSite": _SAME_SITE_MAP.get(c.get("sameSite"), "unspecified"),
        }
        expires = c.get("expires")
        if expires and expires != -1:
            item["expirationDate"] = expires
        chrome_cookies.append(item)
    return chrome_cookies


def upsert_account_cookie(email: str, cookie_state: Dict[str, Any], id_member: Optional[str] = None) -> None:
    """Gọi ngay sau khi Playwright login/re-login thành công (facebook_auth.py).
    Ghi đè cookie mới nhất + reset về 'available' (nhả khỏi trạng thái invalid cũ nếu có).

    `id_member`: chủ sở hữu (nhân viên) của acc này -- chỉ đưa vào dict upsert khi có giá
    trị. Bỏ hẳn key này khi None (không set "id_member": None), để 1 lần refresh cookie
    sau đó không kèm id_member không vô tình xoá mất chủ sở hữu đã gán trước đó (Postgrest
    upsert chỉ đụng tới cột có mặt trong payload).
    """
    now_iso = datetime.now(timezone.utc).isoformat()
    row: Dict[str, Any] = {
        "email": email,
        "cookie_playwright": cookie_state,
        "status": "available",
        "assigned_worker_id": None,
        "assigned_at": None,
        "error_message": None,
        "fail_count": 0,
        "updated_at": now_iso,
    }
    if id_member:
        row["id_member"] = id_member

    execute_supabase_query(
        lambda: get_supabase_client()
        .table("crawl_fb_accounts")
        .upsert(row, on_conflict="email")
        .execute()
    )
    logger.info(f"[FB-ACCOUNT-POOL] Đã nạp/refresh cookie cho {email} (status=available).")


def claim_next_account(worker_id: str, id_member: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Worker gọi khi chưa có cookie login hợp lệ (hoặc cần đổi acc cho đúng chủ của job
    kế tiếp). Idempotent: nếu worker đang giữ sẵn 1 acc 'assigned' ĐÚNG CHỦ `id_member`
    rồi thì trả lại chính acc đó, không claim thêm. Khi `id_member` là None (job không
    yêu cầu chủ cụ thể), chỉ cần đang giữ acc bất kỳ là đủ, không cần đổi.
    """
    def _held():
        q = (
            get_supabase_client()
            .table("crawl_fb_accounts")
            .select("*")
            .eq("assigned_worker_id", worker_id)
            .eq("status", "assigned")
        )
        if id_member is not None:
            q = q.eq("id_member", id_member)
        return q.limit(1).execute()

    held = execute_supabase_query(_held)
    account = (held.data or [None])[0]

    if not account:
        res = execute_supabase_query(
            lambda: get_supabase_client()
            .rpc("claim_next_fb_account", {"p_worker_id": worker_id, "p_id_member": id_member})
            .execute()
        )
        account = (res.data or [None])[0]

    if not account:
        return None

    return {
        "id": account["id"],
        "email": account["email"],
        "id_member": account.get("id_member"),
        "cookies": _playwright_cookies_to_chrome(account["cookie_playwright"]),
    }


def list_accounts_for_member(id_member: str) -> List[Dict[str, Any]]:
    """Danh sách acc FB trong pool thuộc về 1 nhân viên -- dùng cho trang dashboard
    "Kết nối tài khoản Facebook" (mỗi nhân viên chỉ xem được acc của chính mình)."""
    res = execute_supabase_query(
        lambda: get_supabase_client()
        .table("crawl_fb_accounts")
        .select("id, email, status, last_used_at, error_message, updated_at")
        .eq("id_member", id_member)
        .order("updated_at", desc=True)
        .execute()
    )
    return res.data or []


def get_account_status_counts() -> Dict[str, int]:
    """Đếm số acc trong pool theo từng status -- dùng cho trang giám sát hàng đợi."""
    res = execute_supabase_query(
        lambda: get_supabase_client().table("crawl_fb_accounts").select("status").execute()
    )
    counts: Dict[str, int] = {"available": 0, "assigned": 0, "invalid": 0}
    for row in res.data or []:
        status = row.get("status")
        counts[status] = counts.get(status, 0) + 1
    return counts


def disconnect_account(account_id: str, id_member: str) -> bool:
    """Nhân viên tự ngắt kết nối 1 acc của chính mình (đánh 'invalid', loại khỏi pool).
    Guard theo `id_member` để nhân viên A không thể ngắt acc của nhân viên B.
    Trả về True nếu có đúng 1 dòng khớp bị cập nhật."""
    now_iso = datetime.now(timezone.utc).isoformat()
    res = execute_supabase_query(
        lambda: get_supabase_client()
        .table("crawl_fb_accounts")
        .update({"status": "invalid", "error_message": "Ngắt kết nối thủ công từ dashboard.", "updated_at": now_iso})
        .eq("id", account_id)
        .eq("id_member", id_member)
        .execute()
    )
    return bool(res.data)


def mark_account_invalid(account_id: str, worker_id: str, error_message: Optional[str] = None) -> None:
    """Worker báo acc đang dùng bị logout/khoá -> loại khỏi pool (không tự requeue,
    chỉ 'available' lại khi ops đăng nhập tay/API lại và upsert_account_cookie ghi đè)."""
    now_iso = datetime.now(timezone.utc).isoformat()
    execute_supabase_query(
        lambda: get_supabase_client()
        .table("crawl_fb_accounts")
        .update({"status": "invalid", "error_message": error_message, "updated_at": now_iso})
        .eq("id", account_id)
        .eq("assigned_worker_id", worker_id)
        .execute()
    )
    logger.warning(f"[FB-ACCOUNT-POOL] Worker {worker_id} báo acc {account_id} hỏng: {error_message}")


def release_stale_account_claims() -> int:
    """Acc 'assigned' cho worker đã mất heartbeat quá lâu (dùng chung WORKER_STALE_SECONDS
    của crawl_workers) -> thả về 'available'. Tương tự requeue_stale_jobs."""
    from app.modules.all_platform.services.supabase_crawl_queue_service import WORKER_STALE_SECONDS

    cutoff = (datetime.now(timezone.utc) - timedelta(seconds=WORKER_STALE_SECONDS)).isoformat()

    stale_res = execute_supabase_query(
        lambda: get_supabase_client()
        .table("crawl_workers")
        .select("worker_id")
        .lt("last_heartbeat", cutoff)
        .execute()
    )
    stale_worker_ids = [w["worker_id"] for w in (stale_res.data or [])]
    if not stale_worker_ids:
        return 0

    released = execute_supabase_query(
        lambda: get_supabase_client()
        .table("crawl_fb_accounts")
        .update({"status": "available", "assigned_worker_id": None, "assigned_at": None})
        .in_("assigned_worker_id", stale_worker_ids)
        .eq("status", "assigned")
        .execute()
    )
    count = len(released.data or [])
    if count:
        logger.warning(f"[FB-ACCOUNT-POOL] Đã thả {count} acc về 'available' do worker mất heartbeat: {stale_worker_ids}")
    return count
