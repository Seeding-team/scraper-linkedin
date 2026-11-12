"""Registry từ khoá/chủ đề Threads tự khám phá bằng LLM (migration 160, bảng
threads_keyword_registry) — yêu cầu 2026-10-02:

"trước khi cào tự động tới vòng thread thì trong lúc chờ chạy facebook linkedin thì call
llm để list ra tầm 10 chủ đề hoặc keyword có khả năng ra các bài tìm kiếm website (tầm 20
chủ đề + key) -> sau đó cào -> cào xong thì so sánh key/chủ đề nào có ra các bài điểm AI
cao thì lưu lại ... sử dụng hàng ngày thường xuyên, mỗi ngày list thêm ~5 chủ đề/từ khoá,
max 50, vượt max thì so sánh hiệu quả xoá bớt từ khoá kém, đề xuất cái mới vào".

Luồng: GET /extension/threads/keywords được bg/rotation-crawl.js gọi NGAY ĐẦU 1 vòng (song
song lúc đang cào Facebook/LinkedIn, không chờ) -> ensure_daily_expansion() tự mở rộng/dọn
registry nếu cần -> trả về danh sách từ khoá active hiện tại để dùng cho vòng Threads.
Sau khi cào xong 1 từ khoá, extension_crawl_threads.py AWAIT score_and_save_posts() trực
tiếp (không fire-and-forget như FB/LI) rồi gọi record_keyword_result() cập nhật hiệu quả.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx

from app.core.config import settings
from app.core.logger import get_logger
from app.core.supabase_client import get_supabase_client

logger = get_logger(__name__)

TABLE = "threads_keyword_registry"
MAX_KEYWORDS = 50
TARGET_ACTIVE_KEYWORDS = 30
INITIAL_GENERATE_COUNT = 30
DAILY_ADD_COUNT = 6

DEFAULT_THREADS_FALLBACK_KEYWORDS: tuple[str, ...] = (
    "thiết kế website",
    "làm website",
    "làm web",
    "cần làm web",
    "tìm người làm web",
    "báo giá website",
    "landing page",
    "làm landing page",
    "thiết kế landing page",
    "làm app",
    "thiết kế app",
    "cần làm app",
    "lập trình app",
    "outsource phần mềm",
    "gia công phần mềm",
    "phần mềm quản lý",
    "làm web bán hàng",
    "web bán hàng",
    "tìm dev freelance",
    "tuyển freelance dev",
    "code tool",
    "viết phần mềm",
    "nâng cấp website",
    "sửa website",
    "thiết kế ui ux",
    "làm web doanh nghiệp",
    "web giới thiệu",
    "làm hệ thống crm",
    "phần mềm bán hàng",
    "thuê code web",
    "công ty làm web",
    "cần tìm dev",
)

_KEYWORD_GEN_SYSTEM_PROMPT = (
    "Bạn là chuyên gia tìm kiếm khách hàng (sales/growth) cho 1 công ty thiết kế website, "
    "landing page, mobile app, phần mềm quản lý (CRM/ERP/POS) và outsource IT tại Việt Nam.\n"
    "Hãy đề xuất ĐÚNG {n} từ khoá tìm kiếm NGẮN GỌN bằng tiếng Việt (ƯU TIÊN 2 ĐẾN 4 TỪ mỗi từ khoá) "
    "để search trực tiếp trên Threads (threads.com/search).\n"
    "LƯU Ý THỰC NGHIỆM: Threads search KHÔNG trả kết quả với cụm dài 5-7 từ; các cụm 2-4 từ tự nhiên "
    "như \"thiết kế website\", \"cần làm app\", \"làm landing page\", \"thuê code web\", \"outsource phần mềm\", "
    "\"làm web bán hàng\", \"cần tìm dev\", \"sửa website\" lại trả về rất nhiều bài thật.\n"
    "Ưu tiên xen kẽ từ khoá ngách nhu cầu mới (AI chatbot, web bất động sản, web đặt lịch, mini app zalo, "
    "tối ưu tốc độ web, tự động hoá n8n, web học trực tuyến, app ios android...) nhưng phải GIỮ NGẮN 2-4 TỪ.\n"
    "TUYỆT ĐỐI KHÔNG đề xuất trùng hoặc gần giống các từ khoá đã có / vừa bị loại sau: {existing}.\n\n"
    'Chỉ trả về DUY NHẤT JSON: {{"keywords": ["...", ...]}} — đúng {n} phần tử, không giải thích, không markdown.'
)


def is_configured() -> bool:
    return bool(settings.openai_api_key)


async def _generate_keywords(n: int, existing: list[str]) -> list[str]:
    if not settings.openai_api_key:
        return []
    prompt = _KEYWORD_GEN_SYSTEM_PROMPT.format(n=n, existing=", ".join(existing) or "(chưa có)")
    url = f"{settings.openai_base_url}/chat/completions"
    headers = {"Authorization": f"Bearer {settings.openai_api_key}", "Content-Type": "application/json"}
    body = {
        "model": settings.ai_model,
        "messages": [{"role": "system", "content": prompt}, {"role": "user", "content": "Đề xuất từ khoá."}],
        "temperature": 0.8,
        "max_tokens": 500,
        "response_format": {"type": "json_object"},
    }
    try:
        async with httpx.AsyncClient(timeout=25.0) as client:
            resp = await client.post(url, json=body, headers=headers)
            resp.raise_for_status()
            data = resp.json()
        raw = data["choices"][0]["message"]["content"].strip()
        parsed = json.loads(raw)
        keywords = parsed.get("keywords") if isinstance(parsed, dict) else None
        if not isinstance(keywords, list):
            return []
        existing_lower = {k.lower().strip() for k in existing}
        out: list[str] = []
        for k in keywords:
            k = str(k).strip()
            if k and k.lower() not in existing_lower and k not in out:
                out.append(k)
        return out
    except Exception as exc:
        logger.warning(f"threads_keyword: tạo từ khoá mới thất bại: {exc}")
        return []


def get_active_keywords(limit: int = MAX_KEYWORDS) -> list[dict]:
    supabase = get_supabase_client()
    res = (
        supabase.table(TABLE)
        .select("*")
        .eq("is_active", True)
        .order("high_score_posts", desc=True)
        .order("total_posts_found", desc=True)
        .limit(limit)
        .execute()
    )
    return res.data or []


async def ensure_daily_expansion() -> None:
    """Gọi mỗi khi rotation-crawl chuẩn bị vào vòng Threads — tự sinh từ khoá mới nếu
    chưa làm hôm nay, và dọn bớt từ khoá kém hiệu quả nếu vượt MAX_KEYWORDS. Không raise
    (lỗi ở đây chỉ log — registry rỗng vẫn trả về được, rotation-crawl.js tự fallback)."""
    if not is_configured():
        return
    try:
        supabase = get_supabase_client()
        all_rows = supabase.table(TABLE).select("*").execute().data or []
        active_rows = [r for r in all_rows if r.get("is_active")]
        existing_keywords = [r["keyword"] for r in all_rows]

        if not all_rows:
            # Lan dau: sinh luon ~20 chu de/tu khoa khoi diem.
            new_keywords = await _generate_keywords(INITIAL_GENERATE_COUNT, existing_keywords)
            logger.info(f"threads_keyword: khởi tạo registry với {len(new_keywords)} từ khoá")
        else:
            now_utc = datetime.now(timezone.utc)
            today_start = now_utc.replace(hour=0, minute=0, second=0, microsecond=0)
            created_today = any(
                _parse_ts(r.get("created_at")) and _parse_ts(r.get("created_at")) >= today_start for r in all_rows
            )
            new_keywords = [] if created_today else await _generate_keywords(DAILY_ADD_COUNT, existing_keywords)
            if new_keywords:
                logger.info(f"threads_keyword: thêm {len(new_keywords)} từ khoá mới hôm nay")

        if new_keywords:
            supabase.table(TABLE).insert([{"keyword": k} for k in new_keywords]).execute()
            active_rows = active_rows + [{"keyword": k, "high_score_posts": 0, "total_posts_found": 0, "times_used": 0} for k in new_keywords]

        # Vuot MAX_KEYWORDS: tat (is_active=false) nhung tu khoa kem hieu qua nhat, GIU LAI
        # tu khoa chua tung dung (times_used=0, can co co hoi thu truoc khi bi loai).
        if len(active_rows) > MAX_KEYWORDS:
            tried = [r for r in active_rows if (r.get("times_used") or 0) > 0]
            tried.sort(key=lambda r: (r.get("high_score_posts") or 0, r.get("total_posts_found") or 0))
            excess = len(active_rows) - MAX_KEYWORDS
            to_disable = tried[:excess]
            for r in to_disable:
                kw = r.get("keyword")
                if kw:
                    supabase.table(TABLE).update({"is_active": False}).eq("keyword", kw).execute()
            if to_disable:
                logger.info(f"threads_keyword: tắt {len(to_disable)} từ khoá kém hiệu quả nhất (vượt {MAX_KEYWORDS})")
    except Exception as exc:
        logger.warning(f"threads_keyword: ensure_daily_expansion lỗi (bỏ qua): {exc}")


def _parse_ts(raw: Optional[str]):
    if not raw:
        return None
    try:
        return datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except ValueError:
        return None


def record_keyword_result(keyword: str, total_found: int, high_score_count: int) -> None:
    """Cập nhật hiệu quả 1 từ khoá sau khi cào xong (gọi từ extension_crawl_threads.py sau
    khi await score_and_save_posts() trực tiếp)."""
    if not keyword:
        return
    try:
        supabase = get_supabase_client()
        res = supabase.table(TABLE).select("times_used, total_posts_found, high_score_posts").eq("keyword", keyword).limit(1).execute()
        if not res.data:
            # Tu khoa nay khong nam trong registry (vd nguoi dung tu nhap tay) - bo qua,
            # khong tu them vao registry o day de tranh registry phinh to ngoai y muon.
            return
        row = res.data[0]
        supabase.table(TABLE).update({
            "times_used": (row.get("times_used") or 0) + 1,
            "total_posts_found": (row.get("total_posts_found") or 0) + total_found,
            "high_score_posts": (row.get("high_score_posts") or 0) + high_score_count,
            "last_used_at": "now()",
        }).eq("keyword", keyword).execute()
    except Exception as exc:
        logger.warning(f"threads_keyword: record_keyword_result lỗi cho '{keyword}': {exc}")


def _keyword_efficiency_key(row: dict) -> tuple[float, int, int]:
    """Score keyword effectiveness: high-score leads per run first, then total posts found."""
    used = max(0, int(row.get("times_used") or 0))
    high = max(0, int(row.get("high_score_posts") or 0))
    total = max(0, int(row.get("total_posts_found") or 0))
    high_rate = high / max(1, used)
    return (round(high_rate, 4), high, total)


async def evolve_and_select_keywords(
    target_count: int = TARGET_ACTIVE_KEYWORDS,
    rotate_replace_count: int = DAILY_ADD_COUNT,
) -> dict:
    """Self-evolving keyword selector executed before every Threads 4G phase.

    1. Guarantees ~30 active short Vietnamese intent queries (`2-4` words).
    2. Retires up to `rotate_replace_count` lowest-yield tried keywords (`times_used >= 2`,
       zero high-score leads) and generates fresh AI variations (or unused curated fallbacks)
       so Threads continuously probes new buyer niches without drifting stale.
    3. Interleaves untried/newly generated keywords with proven top performers so every round
       both exploits high-converting terms and explores new angles.
    """
    import random

    bounded_target = max(5, min(MAX_KEYWORDS, int(target_count or TARGET_ACTIVE_KEYWORDS)))
    replace_quota = max(0, min(12, int(rotate_replace_count or 0)))

    try:
        supabase = get_supabase_client()
        all_rows = supabase.table(TABLE).select("*").execute().data or []
    except Exception as exc:
        logger.warning(f"threads_keyword: không đọc được DB registry, dùng fallback pool: {exc}")
        fallback = list(DEFAULT_THREADS_FALLBACK_KEYWORDS)[:bounded_target]
        return {
            "keywords": fallback,
            "meta": {
                "total_active": len(fallback),
                "newly_generated": 0,
                "deactivated": [],
                "ai_powered": False,
                "used_fallback": True,
                "items": [{"keyword": kw, "times_used": 0, "total_posts_found": 0, "high_score_posts": 0} for kw in fallback],
            },
        }

    active_rows = [r for r in all_rows if r.get("is_active")]
    existing_lower = {str(r.get("keyword") or "").strip().lower() for r in all_rows if r.get("keyword")}
    existing_all = [str(r.get("keyword") or "").strip() for r in all_rows if r.get("keyword")]

    deactivated: list[str] = []
    newly_added: list[str] = []
    ai_powered = False

    # 1. Retire weakest tried keywords when we have enough tried history to rotate safely
    tried_rows = [r for r in active_rows if int(r.get("times_used") or 0) >= 2]
    zero_lead_tried = [
        r for r in tried_rows
        if int(r.get("high_score_posts") or 0) == 0
    ]
    zero_lead_tried.sort(
        key=lambda r: (
            int(r.get("total_posts_found") or 0),
            -int(r.get("times_used") or 0),
        )
    )
    retire_candidates: list[dict] = []
    if zero_lead_tried and replace_quota > 0 and len(active_rows) >= min(15, bounded_target):
        retire_candidates = zero_lead_tried[:replace_quota]
    elif replace_quota > 0 and is_configured() and len(active_rows) >= bounded_target:
        mature_low = [
            r for r in tried_rows
            if int(r.get("times_used") or 0) >= 4 and int(r.get("high_score_posts") or 0) < 3
        ]
        if len(mature_low) >= 8:
            mature_low.sort(key=_keyword_efficiency_key)
            retire_candidates = mature_low[: min(2, replace_quota)]

    if retire_candidates:
        retire_kws = [str(r["keyword"]) for r in retire_candidates if r.get("keyword")]
        for kw in retire_kws:
            try:
                supabase.table(TABLE).update({"is_active": False}).eq("keyword", kw).execute()
                deactivated.append(kw)
            except Exception as exc:
                logger.warning(f"threads_keyword: tắt từ khóa kém '{kw}' thất bại: {exc}")
        if deactivated:
            retired_set = set(deactivated)
            active_rows = [r for r in active_rows if r.get("keyword") not in retired_set]

    # 2. Compute deficit to reach bounded_target (~30) + optional fresh exploration swap
    deficit = max(0, bounded_target - len(active_rows))
    want_generate = deficit
    if want_generate > 0:
        if is_configured():
            ai_candidates = await _generate_keywords(want_generate, existing_all)
            if ai_candidates:
                ai_powered = True
            for kw in ai_candidates:
                clean = str(kw).strip()
                if clean and clean.lower() not in existing_lower:
                    newly_added.append(clean)
                    existing_lower.add(clean.lower())
                    existing_all.append(clean)

        # Backfill remaining gap from curated high-recall fallback list
        if len(newly_added) < want_generate:
            for fb_kw in DEFAULT_THREADS_FALLBACK_KEYWORDS:
                if len(newly_added) >= want_generate:
                    break
                if fb_kw.lower() not in existing_lower:
                    newly_added.append(fb_kw)
                    existing_lower.add(fb_kw.lower())
                    existing_all.append(fb_kw)

        if newly_added:
            try:
                supabase.table(TABLE).insert([{"keyword": k, "is_active": True} for k in newly_added]).execute()
            except Exception as exc:
                logger.warning(f"threads_keyword: lưu từ khóa mới thất bại: {exc}")
            for k in newly_added:
                active_rows.append({
                    "keyword": k,
                    "is_active": True,
                    "times_used": 0,
                    "total_posts_found": 0,
                    "high_score_posts": 0,
                })

    # 3. Safety cap at MAX_KEYWORDS
    if len(active_rows) > MAX_KEYWORDS:
        tried_extra = [r for r in active_rows if int(r.get("times_used") or 0) > 0]
        tried_extra.sort(key=_keyword_efficiency_key)
        excess = len(active_rows) - MAX_KEYWORDS
        for r in tried_extra[:excess]:
            kw = r.get("keyword")
            if kw:
                try:
                    supabase.table(TABLE).update({"is_active": False}).eq("keyword", kw).execute()
                    deactivated.append(str(kw))
                except Exception:
                    pass
        retired_set = set(deactivated)
        active_rows = [r for r in active_rows if r.get("keyword") not in retired_set]

    # 4. Build balanced round order: interleave untried/new explorations & top winners
    untried = [r for r in active_rows if int(r.get("times_used") or 0) == 0]
    tried = [r for r in active_rows if int(r.get("times_used") or 0) > 0]
    tried.sort(key=_keyword_efficiency_key, reverse=True)
    random.shuffle(untried)

    # Mildly shuffle within top/mid buckets so consecutive loops vary keyword sequence
    ordered_rows: list[dict] = []
    u_idx, t_idx = 0, 0
    while (u_idx < len(untried) or t_idx < len(tried)) and len(ordered_rows) < bounded_target:
        if t_idx < len(tried):
            ordered_rows.append(tried[t_idx])
            t_idx += 1
        if u_idx < len(untried) and len(ordered_rows) < bounded_target:
            ordered_rows.append(untried[u_idx])
            u_idx += 1

    keywords = [str(r["keyword"]).strip() for r in ordered_rows if r.get("keyword")]
    if not keywords:
        keywords = list(DEFAULT_THREADS_FALLBACK_KEYWORDS)[:bounded_target]

    return {
        "keywords": keywords,
        "meta": {
            "total_active": len(active_rows),
            "selected_count": len(keywords),
            "newly_generated": len(newly_added),
            "new_keywords": newly_added,
            "deactivated": deactivated,
            "ai_powered": ai_powered,
            "items": [
                {
                    "keyword": str(r.get("keyword") or ""),
                    "times_used": int(r.get("times_used") or 0),
                    "total_posts_found": int(r.get("total_posts_found") or 0),
                    "high_score_posts": int(r.get("high_score_posts") or 0),
                }
                for r in ordered_rows[:bounded_target]
            ],
        },
    }
