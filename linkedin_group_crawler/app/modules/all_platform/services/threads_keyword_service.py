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
INITIAL_GENERATE_COUNT = 20
DAILY_ADD_COUNT = 5

_KEYWORD_GEN_SYSTEM_PROMPT = (
    "Bạn là chuyên gia tìm kiếm khách hàng (sales/SEO) cho 1 đơn vị làm website/app/landing "
    "page. Đề xuất ĐÚNG {n} từ khoá/chủ đề NGẮN GỌN bằng tiếng Việt (2-6 từ mỗi cái) để tìm "
    "kiếm trên Threads (threads.com/search), có khả năng cao ra các bài đăng của người ĐANG "
    "CẦN THUÊ đơn vị làm website, app di động, landing page, hoặc outsource phần mềm. Ví dụ "
    "hướng đúng: \"tìm đơn vị làm web\", \"cần làm app\", \"báo giá thiết kế website\", "
    "\"outsource lập trình\". TUYỆT ĐỐI KHÔNG đề xuất trùng hoặc gần giống các từ khoá đã có "
    "sẵn sau: {existing}.\n\n"
    'Chỉ trả về DUY NHẤT JSON: {{"keywords": ["...", ...]}} — đúng {n} phần tử, không thêm '
    "giải thích, không markdown."
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
