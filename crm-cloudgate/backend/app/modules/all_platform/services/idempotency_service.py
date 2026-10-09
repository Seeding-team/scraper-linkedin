"""Idempotency cho thao tác tạo (hợp đồng): cùng Idempotency-Key => chỉ thực hiện 1 lần, các yêu cầu trùng/đồng thời nhận lại đúng kết quả đó.

Lưu trong bộ nhớ tiến trình (backend chạy 1 worker uvicorn; TTL 15 phút) + khoá theo key để 2 request đồng thời không cùng chạy.
Lớp bảo vệ thứ hai ở tầng DB (khoá tự nhiên deal+báo giá+tiêu đề+người tạo trong 2 phút) xem find_recent_duplicate_contract().
Giới hạn: nhiều worker/nhiều replica cần cột UNIQUE idempotency_key trong DB (cần migration, chưa chạy)."""
from __future__ import annotations

import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

_TTL = 900
_lock = threading.Lock()
_entries: dict[str, dict[str, Any]] = {}


def _purge(now: float) -> None:
    for k in [k for k, v in _entries.items() if v.get("done_at") and now - v["done_at"] > _TTL]:
        _entries.pop(k, None)


def run_once(key: str | None, scope: str, fn: Callable[[], Any]) -> tuple[Any, bool]:
    """-> (kết quả, replayed). key rỗng => chạy bình thường. fn lỗi => không lưu, cho phép gửi lại."""
    if not key:
        return fn(), False
    full = f"{scope}:{key}"
    with _lock:
        _purge(time.time())
        entry = _entries.setdefault(full, {"lock": threading.Lock(), "result": None, "done_at": None})
    with entry["lock"]:
        if entry["done_at"]:
            return entry["result"], True
        try:
            result = fn()
        except Exception:
            with _lock:
                _entries.pop(full, None)
            raise
        entry["result"], entry["done_at"] = result, time.time()
        return result, False


def find_recent_duplicate_contract(sb: Any, instance: str, user_id: str | None, deal_id: str | None, quote_id: str | None, title: str, seconds: int = 120) -> dict | None:
    """Hợp đồng do cùng người tạo, cùng Deal/báo giá/tiêu đề trong N giây gần đây (chặn trùng khi mất key, vd tải lại trang rồi bấm lại)."""
    if not deal_id or not user_id:
        return None
    since = (datetime.now(timezone.utc) - timedelta(seconds=seconds)).isoformat()
    q = (sb.table("contracts").select("id").eq("instance", instance).eq("created_by", user_id).eq("deal_id", deal_id).eq("title", title).gte("created_at", since))
    q = q.eq("quote_id", quote_id) if quote_id else q.is_("quote_id", "null")
    rows = q.limit(1).execute().data or []
    return rows[0] if rows else None
