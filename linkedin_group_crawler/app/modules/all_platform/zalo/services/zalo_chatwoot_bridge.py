"""Cầu nối Zalo -> Chatwoot/n8n bot (dùng bot Markee Chat trả lời tự động).

Chiều vào: listener lưu tin vào `zalo_messages` -> tick này đọc tin MỚI (watermark
`zalo_bot_cursor`) của hội thoại 1-1 -> POST sang webhook n8n `seeding-zalo-incoming`
(tạo contact/conversation/message trong Chatwoot) -> bot n8n + LightRAG trả lời.
Chiều ra: n8n gọi `POST /api/all-platform/zalo/zalo-bot/send-message` (route
`zalo_bot_bridge.py`) -> `send_outbound_message` ở đây gửi qua zca.

An toàn: cấu hình theo từng tài khoản trong `zalo_bot_configs` (mặc định tắt +
dry_run), chỉ hội thoại 1-1, cursor seed = now() nên không đẩy lịch sử cũ,
rate limit/phút, hội thoại nhân viên đã tiếp quản (`zalo_bot_threads`) thì bot không nhận/không gửi.
Tin do chính tài khoản gửi (is_sent=true, gồm cả tin bot) bị bỏ qua nên không có vòng lặp.
"""

from __future__ import annotations

import asyncio
import os
import random
import time
from typing import Any, Dict, List, Optional

import httpx
from loguru import logger

from app.modules.all_platform.zalo.services.supabase_service import _rest
from app.modules.all_platform.zalo.services.zalo_bot_service import (
    _iso,
    _now,
    direct_thread_ids,
    extract_zca_msg_id,
    get_config_row,
    is_paused_or_expire,
    get_rules,
    in_scope,
    log_event,
    note_staff_reply,
)
from app.modules.all_platform.zalo.services.zca_auth_store import load_zca_auth
from app.modules.all_platform.zalo.services.zca_api_bridge import send_zca_message

N8N_INCOMING_URL = os.getenv("ZALO_BOT_N8N_INCOMING_URL", "").strip()
SHARED_SECRET = os.getenv("ZALO_BOT_SHARED_SECRET", "").strip()
MAX_PER_MIN = int(os.getenv("ZALO_BOT_MAX_PER_MIN", "20"))
MESSAGES_PER_TICK = int(os.getenv("ZALO_BOT_MESSAGES_PER_TICK", "100"))
BATCH_HARD_CAP_S = int(os.getenv("ZALO_BOT_BATCH_MAX_S", "40"))   # chờ gom tối đa (khách gõ mãi cũng không chờ vô hạn)
MAX_BATCH_MESSAGES = int(os.getenv("ZALO_BOT_BATCH_MAX_MESSAGES", "10"))  # gộp tối đa bấy nhiêu tin / lượt
REPLY_DELAY_MIN_S = float(os.getenv("ZALO_BOT_REPLY_DELAY_MIN_S", "2"))
REPLY_DELAY_MAX_S = float(os.getenv("ZALO_BOT_REPLY_DELAY_MAX_S", "6"))

_account_locks: Dict[str, asyncio.Lock] = {}
_rate_windows: Dict[str, List[float]] = {}


def _lock_for(account_id: str) -> asyncio.Lock:
    return _account_locks.setdefault(account_id, asyncio.Lock())


# Zalo đặt tên tin văn bản thường là "webchat" (DB thật lưu msg_kind="webchat"); "text" giữ cho tương thích.
# Ảnh/sticker/file/thoại (chat.photo, chat.sticker, share.file, chat.voice...) KHÔNG nằm trong tập này nên bị bỏ qua.
TEXT_MSG_KINDS = frozenset({"text", "webchat"})


def _consume_rate_budget(account_id: str) -> bool:
    now = time.time()
    window = _rate_windows.setdefault(account_id, [])
    window[:] = [t for t in window if now - t < 60]
    if len(window) >= MAX_PER_MIN:
        return False
    window.append(now)
    return True


async def _read_cursor(account_id: str) -> int:
    rows = await _rest("GET", "zalo_bot_cursor", params={"select": "last_message_ts", "account_id": f"eq.{account_id}", "limit": "1"}) or []
    if rows:
        return int(rows[0].get("last_message_ts") or 0)
    seed = int(time.time() * 1000)
    await _write_cursor(account_id, seed)
    return seed


async def _write_cursor(account_id: str, ts: int) -> None:
    await _rest(
        "POST", "zalo_bot_cursor",
        json=[{"account_id": account_id, "last_message_ts": ts, "updated_at": _iso(_now())}],
        params={"on_conflict": "account_id"}, prefer="resolution=merge-duplicates",
    )


async def get_bot_config(account_id: str) -> Optional[Dict[str, Any]]:
    return await get_config_row(account_id)


async def _post_to_n8n(cfg: Dict[str, Any], row: Dict[str, Any]) -> bool:
    """True = đã nhận (hoặc lỗi 4xx không thể retry -> bỏ qua); ném lỗi nếu tạm thời (5xx/mạng) để thử lại tick sau."""
    headers = {"x-api-key": SHARED_SECRET} if SHARED_SECRET else {}
    payload = {
        "chatwootAccountId": cfg["chatwoot_account_id"],
        "inboxId": cfg["chatwoot_inbox_id"],
        "zaloAccountId": cfg["account_id"],
        "zaloUserId": row["group_id"],
        "displayName": row.get("sender_name") or row.get("group_name") or "",
        "content": row.get("content") or "",
        "threadType": "user",
        "messageId": row.get("source_message_id"),
        "ts": row.get("ts"),
    }
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(N8N_INCOMING_URL, headers=headers, json=payload)
    if resp.status_code >= 500:
        raise RuntimeError(f"n8n {resp.status_code}: {resp.text[:200]}")
    if resp.status_code >= 400:
        logger.warning(f"[zalo-bot] n8n từ chối {resp.status_code}: {resp.text[:200]}")
        return True
    return True


def _msg_key(row: Dict[str, Any]) -> str:
    """Mã định danh ổn định của 1 tin (dùng để chống xử lý trùng)."""
    return str(row.get("source_message_id") or f"ts:{int(row.get('ts') or 0)}")


async def _handled_keys(account_id: str, keys: List[str]) -> set:
    """Các mã tin ĐÃ được ghi log xử lý (trừ lỗi gửi n8n, cần thử lại). Cần khi 1 hội thoại bị hoãn để gom tin:
    cursor đứng yên nên tick sau đọc lại cả những tin của hội thoại khác đã xử lý xong."""
    uniq = [k for k in dict.fromkeys(keys) if k]
    if not uniq:
        return set()
    quoted = ",".join('"' + k.replace('"', "") + '"' for k in uniq)
    try:
        rows = await _rest(
            "GET", "zalo_bot_logs",
            params={
                "select": "source_msg_id", "account_id": f"eq.{account_id}", "direction": "eq.in",
                "status": "neq.error", "source_msg_id": f"in.({quoted})", "limit": str(len(uniq) * 2),
            },
        ) or []
    except Exception:
        logger.exception("[zalo-bot] tra log đã xử lý lỗi")
        return set()
    return {r["source_msg_id"] for r in rows if r.get("source_msg_id")}


def _batch_ready(batch: List[Dict[str, Any]], is_last_chunk: bool, wait_s: int, now_ms: int) -> bool:
    """Mẻ tin đã đủ điều kiện chuyển cho bot chưa: khách im lặng đủ `wait_s` giây, hoặc đã chờ quá lâu / mẻ đã đầy."""
    if wait_s <= 0 or not is_last_chunk:
        return True
    first_ts = int(batch[0].get("ts") or 0)
    last_ts = int(batch[-1].get("ts") or 0)
    if now_ms - last_ts >= wait_s * 1000:
        return True
    return now_ms - first_ts >= max(BATCH_HARD_CAP_S, wait_s) * 1000


def _combine_batch(batch: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Gộp nhiều tin liên tiếp thành 1 tin duy nhất (mỗi tin 1 dòng) để bot trả lời 1 lần."""
    if len(batch) == 1:
        return batch[0]
    last = batch[-1]
    texts = [(r.get("content") or "").strip() for r in batch]
    return {**last, "content": "\n".join(t for t in texts if t)}


def _chunks(items: List[Dict[str, Any]], size: int) -> List[List[Dict[str, Any]]]:
    return [items[i:i + size] for i in range(0, len(items), size)]


async def run_bridge_tick_for_account(cfg: Dict[str, Any]) -> None:
    account_id = cfg["account_id"]
    if not cfg.get("chatwoot_account_id") or not cfg.get("chatwoot_inbox_id"):
        return  # chưa nhập Chatwoot ID: không làm gì
    cursor = await _read_cursor(account_id)
    rows = await _rest(
        "GET", "zalo_messages",
        params={
            "select": "*", "user_id": f"eq.{account_id}", "is_sent": "eq.false", "is_deleted": "eq.false",
            "ts": f"gt.{cursor}", "order": "ts.asc", "limit": str(MESSAGES_PER_TICK),
        },
    ) or []
    if not rows:
        return

    direct = await direct_thread_ids(account_id, sorted({r["group_id"] for r in rows if r.get("group_id")}))
    scope_mode = cfg.get("scope_mode") or "all"
    rules = await get_rules(account_id)
    wait_raw = cfg.get("batch_wait_seconds")
    wait_s = int(wait_raw) if isinstance(wait_raw, int) and not isinstance(wait_raw, bool) else 10
    handled = await _handled_keys(account_id, [_msg_key(r) for r in rows])
    now_ms = int(time.time() * 1000)

    # Bước 1: loại tin không áp dụng; các tin còn lại gom theo hội thoại (giữ thứ tự thời gian).
    max_done_ts = cursor            # tin mới nhất đã xử lý xong (không còn cần đọc lại)
    pending_first_ts: List[int] = []  # mốc tin chờ xử lý -> cursor không được vượt qua
    by_thread: Dict[str, List[Dict[str, Any]]] = {}
    for row in rows:
        row_ts = int(row.get("ts") or 0)
        thread_id = row.get("group_id")
        text = (row.get("content") or "").strip()
        is_text = (row.get("msg_kind") or row.get("type") or "text") in TEXT_MSG_KINDS
        key = _msg_key(row)
        if key in handled or thread_id not in direct or not text or not is_text:
            max_done_ts = max(max_done_ts, row_ts)
            continue
        if not in_scope(scope_mode, rules.get(thread_id)):
            await log_event(
                account_id, thread_id, "in", key, text, "skipped",
                "Ngoài phạm vi bot (đã tắt cho người này)" if scope_mode == "all"
                else "Ngoài phạm vi bot (người này chưa được bật)",
            )
            max_done_ts = max(max_done_ts, row_ts)
            continue
        by_thread.setdefault(thread_id, []).append(row)

    # Bước 2: mỗi hội thoại chia mẻ; mẻ đủ điều kiện thì xử lý, chưa đủ thì hoãn (giữ cursor lại).
    stop = False
    for thread_id, thread_rows in by_thread.items():
        if stop:
            pending_first_ts.append(int(thread_rows[0].get("ts") or 0))
            continue
        paused = await is_paused_or_expire(cfg, thread_id)
        chunks = _chunks(thread_rows, MAX_BATCH_MESSAGES if wait_s > 0 else 1)   # wait=0: tắt gom, từng tin một
        for idx, batch in enumerate(chunks):
            first_ts = int(batch[0].get("ts") or 0)
            last_ts = int(batch[-1].get("ts") or 0)
            if stop or not _batch_ready(batch, idx == len(chunks) - 1, wait_s, now_ms):
                pending_first_ts.append(first_ts)
                continue

            keys = [_msg_key(r) for r in batch]
            texts = [(r.get("content") or "").strip() for r in batch]
            if paused:
                for k, t in zip(keys, texts):
                    await log_event(account_id, thread_id, "in", k, t, "paused", "Nhân viên đang tiếp quản hội thoại")
                max_done_ts = max(max_done_ts, last_ts)
                continue
            if cfg.get("dry_run", True):
                note = f"Gộp {len(batch)} tin thành 1 câu hỏi" if len(batch) > 1 else None
                for k, t in zip(keys, texts):
                    await log_event(account_id, thread_id, "in", k, t, "dry_run", note)
                max_done_ts = max(max_done_ts, last_ts)
                continue
            if not N8N_INCOMING_URL:
                logger.warning("[zalo-bot] thiếu ZALO_BOT_N8N_INCOMING_URL -> không đẩy được tin sang n8n")
                pending_first_ts.append(first_ts)
                stop = True
                continue
            if not _consume_rate_budget(account_id):
                logger.info(f"[zalo-bot] rate_limited account={account_id} — dừng tick, thử lại sau")
                pending_first_ts.append(first_ts)
                stop = True
                continue

            try:
                await _post_to_n8n(cfg, _combine_batch(batch))
            except Exception as exc:
                logger.warning(f"[zalo-bot] đẩy sang n8n lỗi, thử lại tick sau: {exc}")
                await log_event(account_id, thread_id, "in", keys[-1], "\n".join(t for t in texts if t), "error", str(exc)[:500])
                pending_first_ts.append(first_ts)
                stop = True
                continue
            note = f"Gộp {len(batch)} tin thành 1 câu hỏi" if len(batch) > 1 else None
            for k, t in zip(keys, texts):
                await log_event(account_id, thread_id, "in", k, t, "forwarded", note)
            max_done_ts = max(max_done_ts, last_ts)

    # Bước 3: cursor đi tới tin đã xong, nhưng không vượt qua tin còn chờ (sẽ đọc lại ở tick sau; _handled_keys chống trùng).
    new_cursor = max_done_ts
    if pending_first_ts:
        new_cursor = min(new_cursor, min(pending_first_ts) - 1)
    if new_cursor > cursor:
        await _write_cursor(account_id, new_cursor)


async def run_bridge_tick() -> None:
    """1 tick toàn cục — gọi định kỳ từ main.py lifespan."""
    try:
        configs = await _rest("GET", "zalo_bot_configs", params={"select": "*", "is_enabled": "eq.true"}) or []
    except Exception:
        logger.exception("[zalo-bot] không tải được config")
        return
    for cfg in configs:
        async with _lock_for(cfg["account_id"]):
            try:
                await run_bridge_tick_for_account(cfg)
            except Exception:
                logger.exception(f"[zalo-bot] tick lỗi account={cfg['account_id']}")


async def send_outbound_message(
    account_id: str, thread_id: str, text: str, *, sender_type: Optional[str] = None,
) -> Dict[str, Any]:
    """Chiều ra: n8n gọi vào để gửi câu trả lời ra Zalo (chỉ chat 1-1).

    `sender_type='user'` = nhân viên trả lời từ giao diện Chatwoot (không phải bot): vẫn gửi dù bot đang
    bị tạm dừng, không gắn nhãn Bot, và tự tạm dừng bot ở hội thoại như khi nhân viên nhắn tay.
    """
    row = await get_config_row(account_id)
    if not row or not row.get("is_enabled"):
        return {"status": "skipped", "reason": "bot chưa bật cho tài khoản này"}
    is_staff = (sender_type or "").strip().lower() == "user"
    sent_by = "staff" if is_staff else "bot"
    cfg = {**row}

    if not is_staff and not in_scope(cfg.get("scope_mode") or "all", (await get_rules(account_id)).get(thread_id)):
        await log_event(account_id, thread_id, "out", None, text, "skipped", "Ngoài phạm vi bot")
        return {"status": "skipped", "reason": "out_of_scope"}
    if not is_staff and await is_paused_or_expire(cfg, thread_id):
        await log_event(account_id, thread_id, "out", None, text, "skipped", "Nhân viên đang tiếp quản hội thoại")
        return {"status": "skipped", "reason": "paused"}
    if row.get("dry_run", True):
        await log_event(account_id, thread_id, "out", None, text, "dry_run", sent_by=sent_by)
        return {"status": "dry_run"}
    if not _consume_rate_budget(account_id):
        await log_event(account_id, thread_id, "out", None, text, "skipped", "rate_limited", sent_by=sent_by)
        return {"status": "skipped", "reason": "rate_limited"}
    auth = await load_zca_auth(account_id)
    if not auth:
        await log_event(account_id, thread_id, "out", None, text, "error", "chưa có zca auth", sent_by=sent_by)
        raise RuntimeError("Tài khoản Zalo chưa đăng nhập (không có zca auth)")
    if not is_staff:
        await asyncio.sleep(random.uniform(REPLY_DELAY_MIN_S, REPLY_DELAY_MAX_S))  # giống người gõ
    try:
        result = await send_zca_message(auth, thread_id, text, thread_type=0)
    except Exception as exc:
        await log_event(account_id, thread_id, "out", None, text, "error", str(exc)[:500], sent_by=sent_by)
        raise
    await log_event(account_id, thread_id, "out", extract_zca_msg_id(result), text, "sent", sent_by=sent_by)
    if is_staff:
        await note_staff_reply(account_id, thread_id, "chatwoot-staff")
    return {"status": "sent", "sent_by": sent_by}
