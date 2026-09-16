"""Forward rules — CRUD + engine tự động chuyển tiếp tin nhắn (Mục 5.2 guide,
port sang 1 asyncio background task thay vì Next.js service `zalo-forward-module`
riêng — xem Kiến trúc quy đổi trong plan).

CRUD dùng bởi `api/routes/forward_rules.py`. Engine (`run_forward_tick_for_account`)
được `main.py` lifespan gọi định kỳ (`FORWARD_POLL_INTERVAL_MS`, mặc định 3000ms).

Cơ chế bám sát guide:
    * Watermark cursor (`zalo_forward_cursor.last_message_ts`) — chỉ xử lý tin
      MỚI hơn cursor, seed = now() khi mới bật rule (không xử lý lịch sử cũ).
    * Rate limit cửa sổ trượt 60s/account (`ZALO_FORWARD_MAX_PER_MIN`).
    * Batch gộp ảnh cùng album (key = account:thread:sender), flush sau
      IMAGE_BATCH_MS hoặc khi có dòng MỚI HƠN đang chờ xử lý (chống lộn thứ tự —
      Mục 11.5 guide).
    * `FORWARD_DRY_RUN` mặc định true — chỉ log, không gửi thật.
    * Đặt tên biến RÕ RÀNG (không trùng ZALO_FORWARD_DELAY_MS như guide gốc,
      xem cảnh báo Mục 11.4): ZALO_FORWARD_INTER_SOURCE_DELAY_MS (giữa các lượt
      nguồn khác nhau) vs ZALO_FORWARD_INTER_TARGET_DELAY_MS (giữa các target
      trong 1 lượt gửi — áp dụng bên trong send_zca_message/send_zca_images khi
      gửi tuần tự nhiều target, xem `_send_to_targets_sequential`).
"""

from __future__ import annotations

import asyncio
import os
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from loguru import logger

from app.modules.all_platform.zalo.services.supabase_service import _rest
from app.modules.all_platform.zalo.services.zca_auth_store import load_zca_auth
from app.modules.all_platform.zalo.services.zca_api_bridge import (
    send_zca_message,
    send_zca_images,
)

FORWARD_DRY_RUN = os.getenv("FORWARD_DRY_RUN", "true").strip().lower() not in {"false", "0", "no"}
INTER_SOURCE_DELAY_MS = int(os.getenv("ZALO_FORWARD_INTER_SOURCE_DELAY_MS", "10000"))
INTER_TARGET_DELAY_MS = int(os.getenv("ZALO_FORWARD_INTER_TARGET_DELAY_MS", "20000"))
MAX_PER_MIN = int(os.getenv("ZALO_FORWARD_MAX_PER_MIN", "60"))
IMAGE_BATCH_MS = int(os.getenv("ZALO_FORWARD_IMAGE_BATCH_MS", "3000"))
IMAGE_BATCH_MAX_MS = int(os.getenv("ZALO_FORWARD_IMAGE_BATCH_MAX_MS", "8000"))
MESSAGES_PER_TICK = int(os.getenv("FORWARD_MESSAGES_PER_TICK", "200"))


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


# ─────────────────────────────────────────────────────────────────────────
# CRUD — dùng bởi api/routes/forward_rules.py
# ─────────────────────────────────────────────────────────────────────────

async def list_forward_rules(account_id: str) -> List[Dict[str, Any]]:
    rules = await _rest(
        "GET", "zalo_forward_rules",
        params={"select": "*,zalo_forward_targets(*)", "account_id": f"eq.{account_id}", "order": "created_at.desc"},
    ) or []
    return rules


async def validate_no_loop(account_id: str, master_thread_id: str, target_thread_ids: List[str]) -> Optional[str]:
    """Chặn vòng lặp vô hạn: nhóm đích không được là master của rule khác, và
    master không được là target của rule khác (đúng `validateNoLoop()` Mục 5.3 guide).

    Returns: chuỗi lỗi (nếu vi phạm) hoặc None (hợp lệ).
    """
    other_rules = await _rest(
        "GET", "zalo_forward_rules",
        params={"select": "id,master_thread_id,zalo_forward_targets(target_thread_id)", "account_id": f"eq.{account_id}"},
    ) or []

    for target_id in target_thread_ids:
        for rule in other_rules:
            if rule.get("master_thread_id") == target_id:
                return f"Nhóm đích {target_id} đang là nhóm chính của 1 rule khác — sẽ tạo vòng lặp."
    for rule in other_rules:
        for t in rule.get("zalo_forward_targets") or []:
            if t.get("target_thread_id") == master_thread_id:
                return f"Nhóm chính {master_thread_id} đang là nhóm đích của 1 rule khác — sẽ tạo vòng lặp."
    return None


async def create_forward_rule(
    *, account_id: str, name: Optional[str], master_thread_id: str, master_thread_name: Optional[str],
    target_thread_ids: List[str], target_thread_names: Optional[Dict[str, str]] = None,
    created_by: Optional[str] = None,
) -> Dict[str, Any]:
    error = await validate_no_loop(account_id, master_thread_id, target_thread_ids)
    if error:
        raise ValueError(error)

    rows = await _rest(
        "POST", "zalo_forward_rules",
        json=[{
            "account_id": account_id, "name": name or master_thread_name or master_thread_id,
            "master_thread_id": master_thread_id, "master_thread_name": master_thread_name,
            "created_by": created_by,
        }],
        prefer="return=representation",
    )
    rule = (rows or [{}])[0]
    rule_id = rule.get("id")
    if rule_id and target_thread_ids:
        names = target_thread_names or {}
        await _rest(
            "POST", "zalo_forward_targets",
            json=[
                {"rule_id": rule_id, "target_thread_id": tid, "target_thread_name": names.get(tid)}
                for tid in target_thread_ids
            ],
        )
    # Seed cursor = now() để KHÔNG xử lý lịch sử cũ (đúng Mục 5.2 guide bước 3).
    await _rest(
        "POST", "zalo_forward_cursor",
        json=[{"account_id": account_id, "last_message_ts": int(time.time() * 1000), "updated_at": _now_iso()}],
        params={"on_conflict": "account_id"}, prefer="resolution=ignore-duplicates",
    )
    return rule


async def get_forward_rule(rule_id: int) -> Optional[Dict[str, Any]]:
    rows = await _rest("GET", "zalo_forward_rules", params={"select": "*", "id": f"eq.{rule_id}", "limit": "1"}) or []
    return rows[0] if rows else None


async def update_forward_rule(rule_id: int, patch: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    body = dict(patch)
    body["updated_at"] = _now_iso()
    rows = await _rest("PATCH", "zalo_forward_rules", params={"id": f"eq.{rule_id}"}, json=body, prefer="return=representation")
    return (rows or [None])[0]


async def delete_forward_rule(rule_id: int) -> None:
    await _rest("DELETE", "zalo_forward_rules", params={"id": f"eq.{rule_id}"})


async def list_forward_logs(rule_id: int, *, limit: int = 30) -> List[Dict[str, Any]]:
    return await _rest(
        "GET", "zalo_forward_logs",
        params={"select": "*", "rule_id": f"eq.{rule_id}", "order": "created_at.desc", "limit": str(max(1, min(limit, 500)))},
    ) or []


# ─────────────────────────────────────────────────────────────────────────
# Engine — poller tick (gọi định kỳ từ main.py lifespan, 1 lần / account có
# rule bật) — dịch nguyên logic poller.js Mục 5.2 guide sang Python.
# ─────────────────────────────────────────────────────────────────────────

# In-memory: gom ảnh cùng album trước khi flush (per account:thread:sender).
_image_batches: Dict[str, Dict[str, Any]] = {}
# In-memory: rate limit cửa sổ trượt 60s per account.
_rate_windows: Dict[str, List[float]] = {}
# In-memory: hàng đợi tuần tự 1 lượt gửi / account (Promise-chain equivalent).
_account_locks: Dict[str, asyncio.Lock] = {}


def _get_account_lock(account_id: str) -> asyncio.Lock:
    if account_id not in _account_locks:
        _account_locks[account_id] = asyncio.Lock()
    return _account_locks[account_id]


def _consume_rate_budget(account_id: str) -> bool:
    now = time.time()
    window = _rate_windows.setdefault(account_id, [])
    window[:] = [t for t in window if now - t < 60]
    if len(window) >= MAX_PER_MIN:
        return False
    window.append(now)
    return True


async def _get_active_account_ids() -> List[str]:
    rows = await _rest("GET", "zalo_forward_rules", params={"select": "account_id", "is_enabled": "eq.true"}) or []
    return sorted({r["account_id"] for r in rows if r.get("account_id")})


async def _load_rules_by_master(account_id: str) -> Dict[str, List[Dict[str, Any]]]:
    rows = await _rest(
        "GET", "v_zalo_forward_rules_active",
        params={"select": "*", "account_id": f"eq.{account_id}"},
    ) or []
    grouped: Dict[str, List[Dict[str, Any]]] = {}
    for row in rows:
        grouped.setdefault(row["master_thread_id"], []).append(row)
    return grouped


async def _read_cursor(account_id: str) -> int:
    rows = await _rest("GET", "zalo_forward_cursor", params={"select": "last_message_ts", "account_id": f"eq.{account_id}", "limit": "1"}) or []
    if rows:
        return int(rows[0].get("last_message_ts") or 0)
    seed = int(time.time() * 1000)
    await _rest("POST", "zalo_forward_cursor", json=[{"account_id": account_id, "last_message_ts": seed}])
    return seed


async def _write_cursor(account_id: str, ts: int) -> None:
    await _rest(
        "POST", "zalo_forward_cursor",
        json=[{"account_id": account_id, "last_message_ts": ts, "updated_at": _now_iso()}],
        params={"on_conflict": "account_id"}, prefer="resolution=merge-duplicates",
    )


async def _log_forward(rule_id: Optional[int], account_id: str, source_thread_id: str, source_msg_id: Optional[str],
                        target_thread_id: str, content_type: str, status: str, error: Optional[str] = None) -> None:
    await _rest(
        "POST", "zalo_forward_logs",
        json=[{
            "rule_id": rule_id, "account_id": account_id, "source_thread_id": source_thread_id,
            "source_msg_id": source_msg_id, "target_thread_id": target_thread_id,
            "content_type": content_type, "status": status, "error": error,
        }],
    )


async def _send_to_targets_sequential(
    account_id: str, rule: Dict[str, Any], targets: List[Dict[str, Any]],
    *, text: Optional[str] = None, image_urls: Optional[List[str]] = None,
    source_thread_id: str, source_msg_id: Optional[str],
) -> None:
    """Gửi TUẦN TỰ tới từng target, delay ZALO_FORWARD_INTER_TARGET_DELAY_MS giữa các lần."""
    lock = _get_account_lock(account_id)
    async with lock:
        auth = await load_zca_auth(account_id)
        content_type = "image" if image_urls else "text"
        for i, target in enumerate(targets):
            target_id = target["target_thread_id"]
            if FORWARD_DRY_RUN:
                await _log_forward(rule.get("rule_id"), account_id, source_thread_id, source_msg_id, target_id, content_type, "dry_run")
                logger.info(f"[forward][dry-run] account={account_id} {source_thread_id} -> {target_id} ({content_type})")
            else:
                try:
                    if not auth:
                        raise RuntimeError("Không tìm thấy ZCA auth cho account này")
                    if image_urls:
                        await send_zca_images(auth, target_id, image_urls, text=text or "")
                    else:
                        await send_zca_message(auth, target_id, text or "")
                    await _log_forward(rule.get("rule_id"), account_id, source_thread_id, source_msg_id, target_id, content_type, "success")
                except Exception as exc:
                    logger.warning(f"[forward] send failed account={account_id} target={target_id}: {exc}")
                    await _log_forward(rule.get("rule_id"), account_id, source_thread_id, source_msg_id, target_id, content_type, "failed", str(exc))
            if i < len(targets) - 1:
                await asyncio.sleep(INTER_TARGET_DELAY_MS / 1000)


async def _flush_image_batch(batch_key: str) -> None:
    batch = _image_batches.pop(batch_key, None)
    if not batch:
        return
    await _send_to_targets_sequential(
        batch["account_id"], batch["rule"], batch["targets"],
        image_urls=batch["image_urls"], source_thread_id=batch["source_thread_id"], source_msg_id=batch["source_msg_id"],
    )


async def _flush_stale_image_batches(account_id: str, before_ts: int, own_batch_key: Optional[str]) -> None:
    """Mục 11.5 guide: trước khi xử lý 1 dòng, flush mọi batch ảnh CŨ HƠN dòng đó
    (kể cả chưa hết timer riêng) — tránh lộn thứ tự text/ảnh khi tin sau tới nhanh hơn."""
    stale_keys = [
        key for key, batch in _image_batches.items()
        if batch["account_id"] == account_id and key != own_batch_key and batch["first_ts"] < before_ts
    ]
    for key in stale_keys:
        await _flush_image_batch(key)


async def _queue_image_for_batch(
    account_id: str, rule: Dict[str, Any], targets: List[Dict[str, Any]], *,
    thread_id: str, sender_id: str, image_url: str, ts: int, source_msg_id: Optional[str],
) -> None:
    batch_key = f"{account_id}:{thread_id}:{sender_id}:{rule.get('rule_id')}"
    batch = _image_batches.get(batch_key)
    if batch is None:
        batch = {
            "account_id": account_id, "rule": rule, "targets": targets,
            "image_urls": [], "source_thread_id": thread_id, "source_msg_id": source_msg_id,
            "first_ts": ts, "created_at": time.time(),
        }
        _image_batches[batch_key] = batch
    batch["image_urls"].append(image_url)
    batch["source_msg_id"] = source_msg_id

    async def _delayed_flush(key: str, deadline: float) -> None:
        await asyncio.sleep(max(0.0, deadline - time.time()))
        await _flush_image_batch(key)

    elapsed_ms = (time.time() - batch["created_at"]) * 1000
    wait_ms = IMAGE_BATCH_MS if elapsed_ms < IMAGE_BATCH_MAX_MS - IMAGE_BATCH_MS else max(0, IMAGE_BATCH_MAX_MS - elapsed_ms)
    asyncio.create_task(_delayed_flush(batch_key, time.time() + wait_ms / 1000))


async def run_forward_tick_for_account(account_id: str) -> None:
    rules_by_master = await _load_rules_by_master(account_id)
    if not rules_by_master:
        return
    cursor = await _read_cursor(account_id)

    rows = await _rest(
        "GET", "zalo_messages",
        params={
            "select": "*", "user_id": f"eq.{account_id}",
            "group_id": f"in.({','.join(rules_by_master.keys())})" if rules_by_master else "eq.__none__",
            "ts": f"gt.{cursor}", "order": "ts.asc", "limit": str(MESSAGES_PER_TICK),
        },
    ) or []
    # Chỉ forward từ nhóm (group) — không forward tin 1-1 (đúng Mục 5.2 guide).
    if not rows:
        return

    max_ts = cursor
    for row in rows:
        row_ts = int(row.get("ts") or 0)
        if row_ts <= 0:
            continue
        group_id = row.get("group_id")
        rules_for_group = rules_by_master.get(group_id) or []
        if not rules_for_group:
            max_ts = max(max_ts, row_ts)
            continue

        own_batch_key_prefix = f"{account_id}:{group_id}:"
        await _flush_stale_image_batches(account_id, row_ts, None)

        if not _consume_rate_budget(account_id):
            logger.info(f"[forward] rate_limited account={account_id} — dừng tick, thử lại tick sau")
            break  # KHÔNG advance cursor qua dòng này — đúng Mục 5.2 guide bước 5

        # Gom rule theo rule_id để mỗi rule gửi riêng tới đúng targets của nó.
        by_rule: Dict[Any, Dict[str, Any]] = {}
        for r in rules_for_group:
            by_rule.setdefault(r["rule_id"], {"rule": r, "targets": []})["targets"].append(
                {"target_thread_id": r["target_thread_id"], "target_thread_name": r["target_thread_name"]}
            )

        content = row.get("content")
        image_urls = row.get("image_urls") or []
        for rule_id, bucket in by_rule.items():
            rule, targets = bucket["rule"], bucket["targets"]
            if content:
                await _send_to_targets_sequential(
                    account_id, rule, targets, text=content,
                    source_thread_id=group_id, source_msg_id=row.get("source_message_id"),
                )
            elif image_urls:
                for url in image_urls:
                    await _queue_image_for_batch(
                        account_id, rule, targets, thread_id=group_id,
                        sender_id=row.get("sender_id") or "unknown", image_url=url,
                        ts=row_ts, source_msg_id=row.get("source_message_id"),
                    )
            else:
                await _log_forward(rule_id, account_id, group_id, row.get("source_message_id"), "-", "unsupported", "skipped")

        max_ts = max(max_ts, row_ts)

    if max_ts > cursor:
        await _write_cursor(account_id, max_ts)


async def run_forward_tick() -> None:
    """1 tick toàn cục — gọi định kỳ từ main.py lifespan."""
    try:
        account_ids = await _get_active_account_ids()
    except Exception:
        logger.exception("[forward] failed to load active account ids")
        return
    for account_id in account_ids:
        try:
            await run_forward_tick_for_account(account_id)
        except Exception:
            logger.exception(f"[forward] tick failed for account={account_id}")


async def flush_all_pending_image_batches() -> None:
    """Gọi lúc graceful shutdown — gửi ngay mọi batch ảnh dở dang (Mục 5.2 guide bước 11)."""
    for key in list(_image_batches.keys()):
        try:
            await _flush_image_batch(key)
        except Exception:
            logger.exception(f"[forward] flush pending batch failed key={key}")
