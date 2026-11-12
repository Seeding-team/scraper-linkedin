"""Audit log & overview query service for Public 4G crawled posts and AI Lead checks.

Ensures posts crawled via Rotating Proxy 4G and their AI evaluation outcomes remain
visible to operators even after `lead_score_service.py` deletes competitor or low-score
rows from `facebook_posts`.
"""

from __future__ import annotations

from collections import OrderedDict
from datetime import datetime, timedelta, timezone
import threading
from typing import Any, Optional

from app.core.logger import get_logger
from app.core.supabase_client import get_supabase_client

logger = get_logger(__name__)

_VIETNAM_TZ = timezone(timedelta(hours=7))
_MAX_MEMORY_ENTRIES = 600
_memory_lock = threading.Lock()
_memory_audit_rows: OrderedDict[tuple[str, str], dict[str, Any]] = OrderedDict()

_VALID_AI_FILTERS = frozenset({"all", "lead_high", "kept", "deleted", "pending"})
_VALID_TIME_RANGES = frozenset({"today", "7d", "all"})
_VALID_SOURCE_FILTERS = frozenset({"all", "public_4g", "extension"})


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_dt(raw: Any) -> datetime | None:
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(str(raw).strip().replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except ValueError:
        return None


def _is_today_vn(raw: Any, today_vn_str: str) -> bool:
    dt = _parse_dt(raw)
    if not dt:
        return False
    return dt.astimezone(_VIETNAM_TZ).strftime("%Y-%m-%d") == today_vn_str


def _is_missing_table_error(exc: Exception) -> bool:
    msg = str(exc).lower()
    return (
        "crawled_post_audit_logs" in msg
        and ("does not exist" in msg or "pgrst205" in msg or "42p01" in msg or "could not find the table" in msg)
    )


def detect_crawl_source(worker_id: str | None = None, extra_fields: dict[str, Any] | None = None) -> str:
    """Resolve standardized crawl_source tag ('public_4g' | 'vps_queue' | 'extension')."""
    if extra_fields and str(extra_fields.get("source") or "").strip() == "public_4g":
        return "public_4g"
    wid = str(worker_id or "").strip()
    if wid.startswith("public-4g:"):
        return "public_4g"
    if wid:
        return "vps_queue"
    return "extension"


def _put_memory_row(row: dict[str, Any], *, preserve_source_metadata: bool = False) -> dict[str, Any]:
    platform = str(row.get("platform") or "facebook").strip() or "facebook"
    post_url = str(row.get("post_url") or "").strip()
    if not post_url:
        return dict(row)
    key = (platform, post_url)
    with _memory_lock:
        existing = _memory_audit_rows.get(key)
        merged = dict(existing or {})
        for field, val in row.items():
            if preserve_source_metadata and field in {"crawl_source", "proxy_node", "run_id", "group_id", "group_name", "group_url", "author_name", "post_time", "reactions", "comments", "shares", "crawled_at"}:
                if merged.get(field) not in (None, "", 0) and (val in (None, "", 0) or field in {"crawl_source", "proxy_node", "run_id", "crawled_at"}):
                    continue
            if val is not None or field not in merged:
                merged[field] = val
        merged["platform"] = platform
        merged["post_url"] = post_url
        _memory_audit_rows[key] = merged
        _memory_audit_rows.move_to_end(key)
        while len(_memory_audit_rows) > _MAX_MEMORY_ENTRIES:
            _memory_audit_rows.popitem(last=False)
        return dict(merged)


def _snapshot_memory_rows() -> list[dict[str, Any]]:
    with _memory_lock:
        return [dict(v) for v in reversed(_memory_audit_rows.values())]


def clear_memory_audit_for_tests() -> None:
    """Clear in-memory ring buffer between isolated unit tests."""
    with _memory_lock:
        _memory_audit_rows.clear()


def record_crawled_posts_audit_sync(entries: list[dict[str, Any]]) -> int:
    """Record newly ingested posts in audit memory + Supabase (pending AI check)."""
    if not entries:
        return 0
    now_iso = _utc_now_iso()
    rows_to_upsert: list[dict[str, Any]] = []
    for entry in entries:
        post_url = str(entry.get("post_url") or "").strip()
        if not post_url:
            continue
        platform = str(entry.get("platform") or "facebook").strip() or "facebook"
        payload = {
            "platform": platform,
            "crawl_source": str(entry.get("crawl_source") or "public_4g"),
            "run_id": entry.get("run_id") or None,
            "proxy_node": entry.get("proxy_node") or None,
            "group_id": entry.get("group_id") or None,
            "group_name": entry.get("group_name") or None,
            "group_url": entry.get("group_url") or None,
            "post_id": str(entry.get("post_id")) if entry.get("post_id") else None,
            "post_url": post_url,
            "author_name": entry.get("author_name") or None,
            "content": str(entry.get("content") or "")[:4000],
            "post_time": entry.get("post_time") or None,
            "reactions": int(entry.get("reactions") or 0),
            "comments": int(entry.get("comments") or 0),
            "shares": int(entry.get("shares") or 0),
            "ai_status": str(entry.get("ai_status") or "pending"),
            "crawled_at": entry.get("crawled_at") or now_iso,
            "updated_at": now_iso,
        }
        _put_memory_row(payload)
        rows_to_upsert.append(payload)

    if not rows_to_upsert:
        return 0

    try:
        supabase = get_supabase_client()
        supabase.table("crawled_post_audit_logs").upsert(
            rows_to_upsert,
            on_conflict="platform,post_url",
        ).execute()
    except Exception as exc:
        if _is_missing_table_error(exc):
            logger.debug("[AUDIT] crawled_post_audit_logs chưa migrate — giữ trong memory ring buffer")
        else:
            logger.warning("[AUDIT] Could not upsert crawled audit rows: %s", exc)
    return len(rows_to_upsert)


def update_ai_check_audit_sync(entries: list[dict[str, Any]]) -> int:
    """Persist AI check classification & action outcome without overwriting original crawl metadata."""
    if not entries:
        return 0
    now_iso = _utc_now_iso()
    urls = [str(e.get("post_url") or "").strip() for e in entries if str(e.get("post_url") or "").strip()]
    existing_by_key: dict[tuple[str, str], dict[str, Any]] = {}

    supabase = None
    try:
        supabase = get_supabase_client()
        if urls:
            res = (
                supabase.table("crawled_post_audit_logs")
                .select("*")
                .in_("post_url", urls[:150])
                .execute()
            )
            for row in res.data or []:
                existing_by_key[(str(row.get("platform") or "facebook"), str(row.get("post_url") or ""))] = row
    except Exception as exc:
        if not _is_missing_table_error(exc):
            logger.warning("[AUDIT] Could not read existing audit rows before AI update: %s", exc)
        supabase = None if _is_missing_table_error(exc) else supabase

    rows_to_upsert: list[dict[str, Any]] = []
    for entry in entries:
        post_url = str(entry.get("post_url") or "").strip()
        if not post_url:
            continue
        platform = str(entry.get("platform") or "facebook").strip() or "facebook"
        existing = existing_by_key.get((platform, post_url)) or {}

        merged: dict[str, Any] = {
            "platform": platform,
            "crawl_source": existing.get("crawl_source") or entry.get("crawl_source") or "extension",
            "run_id": existing.get("run_id") or entry.get("run_id") or None,
            "proxy_node": existing.get("proxy_node") or entry.get("proxy_node") or None,
            "group_id": existing.get("group_id") or entry.get("group_id") or None,
            "group_name": existing.get("group_name") or entry.get("group_name") or None,
            "group_url": existing.get("group_url") or entry.get("group_url") or None,
            "post_id": str(existing.get("post_id") or entry.get("post_id") or "") or None,
            "post_url": post_url,
            "author_name": existing.get("author_name") or entry.get("author_name") or None,
            "content": existing.get("content") or str(entry.get("content") or "")[:4000],
            "post_time": existing.get("post_time") or entry.get("post_time") or None,
            "reactions": int(existing.get("reactions") or entry.get("reactions") or 0),
            "comments": int(existing.get("comments") or entry.get("comments") or 0),
            "shares": int(existing.get("shares") or entry.get("shares") or 0),
            "crawled_at": existing.get("crawled_at") or entry.get("crawled_at") or now_iso,
            "ai_status": str(entry.get("ai_status") or "kept"),
            "lead_score": entry.get("lead_score"),
            "is_competitor": entry.get("is_competitor"),
            "is_buyer": entry.get("is_buyer"),
            "lead_need_category": entry.get("lead_need_category"),
            "lead_score_reason": str(entry.get("lead_score_reason") or "")[:400] or None,
            "contact_phone": entry.get("contact_phone") or None,
            "auto_seeding_created": bool(entry.get("auto_seeding_created", False)),
            "zalo_triggered": bool(entry.get("zalo_triggered", False)),
            "ai_checked_at": entry.get("ai_checked_at") or now_iso,
            "updated_at": now_iso,
        }
        mem_merged = _put_memory_row(merged, preserve_source_metadata=True)
        rows_to_upsert.append(mem_merged)

    if rows_to_upsert and supabase is not None:
        try:
            supabase.table("crawled_post_audit_logs").upsert(
                rows_to_upsert,
                on_conflict="platform,post_url",
            ).execute()
        except Exception as exc:
            if _is_missing_table_error(exc):
                logger.debug("[AUDIT] crawled_post_audit_logs chưa migrate — giữ AI audit trong memory")
            else:
                logger.warning("[AUDIT] Could not upsert AI audit rows: %s", exc)
    return len(rows_to_upsert)


def _fetch_historical_ai_rows_sync(limit: int = 80) -> list[dict[str, Any]]:
    """Fallback to existing `facebook_posts` rows with AI `lead_score` before migration 227 rollout."""
    try:
        supabase = get_supabase_client()
        post_res = (
            supabase.table("facebook_posts")
            .select(
                "id, group_id, post_url, content, post_time, crawl_date, created_at, updated_at, "
                "reactions, comments, shares, lead_score, lead_score_reason, lead_need_category"
            )
            .not_.is_("lead_score", "null")
            .order("updated_at", desc=True)
            .limit(max(10, min(limit, 150)))
            .execute()
        )
        rows = post_res.data or []
        if not rows:
            return []

        group_ids = list({str(r.get("group_id")) for r in rows if r.get("group_id")})
        group_map: dict[str, dict[str, Any]] = {}
        if group_ids:
            g_res = (
                supabase.table("facebook_groups")
                .select("id, group_name, group_url")
                .in_("id", group_ids)
                .execute()
            )
            group_map = {str(g["id"]): g for g in (g_res.data or []) if g.get("id")}

        out: list[dict[str, Any]] = []
        for r in rows:
            url = str(r.get("post_url") or "").strip()
            if not url:
                continue
            gid = str(r.get("group_id") or "")
            g_info = group_map.get(gid) or {}
            score = r.get("lead_score")
            out.append(
                {
                    "id": f"hist:{r.get('id')}",
                    "platform": "facebook",
                    "crawl_source": "historical",
                    "run_id": None,
                    "proxy_node": None,
                    "group_id": gid or None,
                    "group_name": g_info.get("group_name") or "Facebook Group",
                    "group_url": g_info.get("group_url"),
                    "post_id": str(r.get("id") or ""),
                    "post_url": url,
                    "author_name": None,
                    "content": r.get("content") or "",
                    "post_time": r.get("post_time"),
                    "reactions": int(r.get("reactions") or 0),
                    "comments": int(r.get("comments") or 0),
                    "shares": int(r.get("shares") or 0),
                    "ai_status": "kept",
                    "lead_score": int(score) if score is not None else None,
                    "is_competitor": False,
                    "is_buyer": bool(score is not None and int(score) >= 70),
                    "lead_need_category": r.get("lead_need_category"),
                    "lead_score_reason": r.get("lead_score_reason"),
                    "contact_phone": None,
                    "auto_seeding_created": False,
                    "zalo_triggered": False,
                    "crawled_at": r.get("created_at") or r.get("crawl_date"),
                    "ai_checked_at": r.get("updated_at") or r.get("created_at"),
                }
            )
        return out
    except Exception as exc:
        logger.debug("[AUDIT] Historical fallback query skipped: %s", exc)
        return []


def _matches_time_range(raw_ts: Any, time_range: str, now_utc: datetime, today_vn_str: str) -> bool:
    if time_range == "all":
        return True
    dt = _parse_dt(raw_ts)
    if not dt:
        return True
    if time_range == "today":
        return dt.astimezone(_VIETNAM_TZ).strftime("%Y-%m-%d") == today_vn_str
    if time_range == "7d":
        return dt >= (now_utc - timedelta(days=7))
    return True


def _matches_search(row: dict[str, Any], q_lower: str) -> bool:
    if not q_lower:
        return True
    haystack = " ".join(
        str(row.get(k) or "")
        for k in ("group_name", "author_name", "content", "lead_score_reason", "contact_phone", "proxy_node", "post_url")
    ).lower()
    return q_lower in haystack


def _matches_ai_filter(row: dict[str, Any], ai_filter: str) -> bool:
    if ai_filter == "all":
        return True
    st = str(row.get("ai_status") or "pending")
    score = row.get("lead_score")
    if ai_filter == "lead_high":
        return st == "kept" and score is not None and int(score) >= 70
    if ai_filter == "kept":
        return st == "kept"
    if ai_filter == "deleted":
        return st in {"deleted_competitor", "deleted_low_score"}
    if ai_filter == "pending":
        return st == "pending"
    return True


def list_crawled_posts_overview_sync(
    *,
    time_range: str = "all",
    search: Optional[str] = None,
    ai_filter: str = "all",
    source_filter: str = "all",
    limit: int = 100,
) -> dict[str, Any]:
    """Return synchronized data for both UI tables (`public_4g_posts` & `ai_checked_posts`)."""
    safe_time = time_range if time_range in _VALID_TIME_RANGES else "all"
    safe_ai = ai_filter if ai_filter in _VALID_AI_FILTERS else "all"
    safe_source = source_filter if source_filter in _VALID_SOURCE_FILTERS else "all"
    safe_limit = max(1, min(int(limit or 100), 300))
    q_lower = (search or "").strip().lower()

    merged_by_key: dict[tuple[str, str], dict[str, Any]] = {}

    # 1. Load persisted audit rows from DB
    db_ok = False
    try:
        supabase = get_supabase_client()
        res = (
            supabase.table("crawled_post_audit_logs")
            .select("*")
            .order("crawled_at", desc=True)
            .limit(400)
            .execute()
        )
        for row in res.data or []:
            key = (str(row.get("platform") or "facebook"), str(row.get("post_url") or ""))
            if key[1]:
                merged_by_key[key] = dict(row)
        db_ok = True
    except Exception as exc:
        if not _is_missing_table_error(exc):
            logger.warning("[AUDIT] Could not query crawled_post_audit_logs: %s", exc)

    # 2. Merge fresher in-memory audit items (e.g., if table missing or immediate update)
    for mem_row in _snapshot_memory_rows():
        key = (str(mem_row.get("platform") or "facebook"), str(mem_row.get("post_url") or ""))
        if not key[1]:
            continue
        existing = merged_by_key.get(key)
        if not existing:
            merged_by_key[key] = mem_row
        elif mem_row.get("ai_status") != "pending" and existing.get("ai_status") == "pending":
            merged_by_key[key] = {**existing, **mem_row}

    # 3. Cold-start historical AI check rows from facebook_posts
    if len(merged_by_key) < safe_limit and (db_ok or not merged_by_key):
        for hist in _fetch_historical_ai_rows_sync(limit=80):
            key = (str(hist.get("platform") or "facebook"), str(hist.get("post_url") or ""))
            if key[1] and key not in merged_by_key:
                merged_by_key[key] = hist

    all_rows = list(merged_by_key.values())
    now_utc = datetime.now(timezone.utc)
    today_vn_str = now_utc.astimezone(_VIETNAM_TZ).strftime("%Y-%m-%d")

    # Summary KPIs computed on time-filtered rows
    in_window = [
        r for r in all_rows
        if _matches_time_range(r.get("crawled_at") or r.get("ai_checked_at"), safe_time, now_utc, today_vn_str)
    ]
    rows_4g_window = [r for r in in_window if r.get("crawl_source") == "public_4g"]
    rows_4g_all = [r for r in all_rows if r.get("crawl_source") == "public_4g"]
    rows_ai_window = [
        r for r in in_window
        if str(r.get("ai_status") or "pending") != "pending" or r.get("ai_checked_at") is not None
    ]

    summary = {
        "total_4g_posts": len(rows_4g_window),
        "today_4g_posts": sum(1 for r in rows_4g_all if _is_today_vn(r.get("crawled_at"), today_vn_str)),
        "pending_ai_count": sum(1 for r in rows_4g_window if str(r.get("ai_status") or "pending") == "pending"),
        "ai_checked_total": len(rows_ai_window),
        "ai_lead_high_count": sum(
            1
            for r in rows_ai_window
            if r.get("ai_status") == "kept" and r.get("lead_score") is not None and int(r["lead_score"]) >= 70
        ),
        "ai_kept_mid_count": sum(
            1
            for r in rows_ai_window
            if r.get("ai_status") == "kept" and (r.get("lead_score") is None or int(r["lead_score"]) < 70)
        ),
        "ai_deleted_count": sum(
            1 for r in rows_ai_window if r.get("ai_status") in {"deleted_competitor", "deleted_low_score"}
        ),
        "auto_seeding_count": sum(1 for r in rows_ai_window if r.get("auto_seeding_created")),
    }

    # Table 1: Posts crawled from Rotating Proxy 4G
    public_4g_filtered = [
        r
        for r in rows_4g_window
        if _matches_search(r, q_lower) and _matches_ai_filter(r, safe_ai)
    ]
    public_4g_filtered.sort(
        key=lambda r: str(r.get("crawled_at") or ""),
        reverse=True,
    )

    # Table 2: Posts evaluated by AI Check
    def _matches_source_tab2(r: dict[str, Any]) -> bool:
        src = str(r.get("crawl_source") or "")
        if safe_source == "public_4g":
            return src == "public_4g"
        if safe_source == "extension":
            return src != "public_4g"
        return True

    ai_checked_filtered = [
        r
        for r in rows_ai_window
        if _matches_source_tab2(r)
        and _matches_search(r, q_lower)
        and (safe_ai == "all" or _matches_ai_filter(r, safe_ai))
    ]
    ai_checked_filtered.sort(
        key=lambda r: str(r.get("ai_checked_at") or r.get("crawled_at") or ""),
        reverse=True,
    )

    return {
        "summary": summary,
        "public_4g_posts": public_4g_filtered[:safe_limit],
        "ai_checked_posts": ai_checked_filtered[:safe_limit],
    }
