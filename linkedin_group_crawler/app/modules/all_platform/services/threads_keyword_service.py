"""Thư viện từ khoá/chủ đề Threads phục vụ Seeding Crawler (migration 160 & 233, bảng threads_keyword_registry).

Yêu cầu cập nhật mới nhất:
1. Người dùng (mở full quyền cho member, leader, admin) tự thêm từ khóa theo Chủ đề vào Thư viện.
2. Vòng cào Threads tự động lấy TOÀN BỘ từ khóa active trong thư viện để cào.
3. Cơ chế Nạp động: Khi có người thêm từ khóa/chủ đề mới, ngay sau khi vòng hiện tại kết thúc,
   vòng sau sẽ tự động reload lại toàn bộ và cào hết từ khóa mới.
4. Loại bỏ hoàn toàn AI đề xuất từ khóa & AI đánh giá từ khóa để tiết kiệm tối đa token AI.
   (Chỉ giữ lại AI chấm điểm bài viết ở post_evaluation_service).
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from app.core.config import settings
from app.core.logger import get_logger
from app.core.supabase_client import get_supabase_client

logger = get_logger(__name__)

TABLE = "threads_keyword_registry"
DEFAULT_TOPICS: tuple[str, ...] = (
    "Website",
    "Mobile App",
    "Phần mềm & CRM",
    "Marketing & Ads",
    "AI & Automation",
    "Chung",
)

DEFAULT_THREADS_FALLBACK_KEYWORDS: tuple[str, ...] = (
    "làm web",
    "thiết kế web",
    "thiết kế website",
    "landing page",
    "website",
    "phần mềm",
    "phần mềm quản lý",
    "outsource",
    "lập trình",
    "bán hàng",
    "freelancer",
    "erp",
    "crm",
    "chatbot",
    "tự động hóa",
    "n8n",
    "mini app",
    "ui ux",
    "wordpress",
    "shopify",
    "chạy ads",
    "web design",
    "mobile app",
    "automation",
    "saas",
    "ai agent",
    "ecommerce",
    "khởi nghiệp",
    "digital marketing",
    "kinh doanh",
)

# Persistent file cache for topic mappings (resilient fallback if migration 233 hasn't run yet)
_TOPICS_FILE_PATH = os.path.join(
    os.path.dirname(__file__),
    "..",
    "..",
    "..",
    "..",
    "linkedin_group_crawler",
    "data",
    "threads_keyword_topics.json",
)


def _load_topics_map() -> Dict[str, str]:
    try:
        if os.path.exists(_TOPICS_FILE_PATH):
            with open(_TOPICS_FILE_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, dict):
                    return data
    except Exception as exc:
        logger.debug(f"[threads_keyword] Không đọc được topics map file: {exc}")
    return {}


def _save_topics_map(topics_map: Dict[str, str]) -> None:
    try:
        os.makedirs(os.path.dirname(_TOPICS_FILE_PATH), exist_ok=True)
        with open(_TOPICS_FILE_PATH, "w", encoding="utf-8") as f:
            json.dump(topics_map, f, ensure_ascii=False, indent=2)
    except Exception as exc:
        logger.debug(f"[threads_keyword] Không lưu được topics map file: {exc}")


def _infer_topic(kw: str) -> str:
    k = (kw or "").lower().strip()
    if any(w in k for w in ("web", "landing page", "wordpress", "shopify", "ui ux", "thiết kế web", "html")):
        return "Website"
    if any(w in k for w in ("app", "mobile", "ios", "android", "flutter", "react native")):
        return "Mobile App"
    if any(w in k for w in ("phần mềm", "crm", "erp", "pos", "quản lý", "outsource", "lập trình", "code")):
        return "Phần mềm & CRM"
    if any(w in k for w in ("marketing", "ads", "seo", "bán hàng", "kinh doanh", "bất động sản", "freelancer")):
        return "Marketing & Ads"
    if any(w in k for w in ("ai", "agent", "bot", "n8n", "automation", "tự động hóa", "saas", "chatbot")):
        return "AI & Tự động hóa"
    return "Chung"


def is_configured() -> bool:
    return True


async def _generate_keywords(n: int, existing: list[str]) -> list[str]:
    """AI keyword suggestion is permanently disabled to save AI tokens per Master directive."""
    return []


def list_all_keywords() -> list[dict[str, Any]]:
    """Lấy danh sách toàn bộ từ khóa trong Thư viện (kèm thông tin Chủ đề và thống kê)."""
    supabase = get_supabase_client()
    try:
        query = supabase.table(TABLE).select("*")
        if hasattr(query, "order"):
            query = query.order("created_at", desc=False)
        res = query.execute()
        rows = res.data or []
    except Exception as exc:
        logger.warning(f"[threads_keyword] Lỗi query table {TABLE}: {exc}")
        rows = []

    topics_map = _load_topics_map()
    out: list[dict[str, Any]] = []
    for r in rows:
        kw = str(r.get("keyword") or "").strip()
        topic = str(r.get("topic") or "").strip()
        if not topic or topic == "None":
            topic = topics_map.get(kw) or _infer_topic(kw)

        item = {
            "id": str(r.get("id") or ""),
            "keyword": kw,
            "topic": topic,
            "is_active": bool(r.get("is_active", True)),
            "times_used": int(r.get("times_used") or 0),
            "total_posts_found": int(r.get("total_posts_found") or 0),
            "high_score_posts": int(r.get("high_score_posts") or 0),
            "last_used_at": r.get("last_used_at"),
            "created_at": r.get("created_at"),
            "created_by": r.get("created_by") or "Hệ thống",
        }
        out.append(item)
    return out


def get_active_keywords(limit: int = 500) -> list[dict[str, Any]]:
    """Lấy danh sách tất cả từ khóa đang Active trong thư viện để cào."""
    all_kws = list_all_keywords()
    active = [k for k in all_kws if k.get("is_active")]
    return active[:limit]


def add_keywords(
    topic: str,
    keywords: list[str],
    created_by: Optional[str] = None,
) -> dict[str, Any]:
    """Thêm một hoặc nhiều từ khóa vào Thư viện theo Chủ đề (mở cho cả member, leader, admin)."""
    clean_topic = (topic or "").strip() or "Chung"
    clean_kws = [str(k).strip() for k in keywords if str(k).strip()]
    if not clean_kws:
        return {"success": False, "message": "Không có từ khóa hợp lệ để thêm", "added": 0}

    supabase = get_supabase_client()
    existing_rows = list_all_keywords()
    existing_set = {r["keyword"].lower() for r in existing_rows}

    topics_map = _load_topics_map()
    to_insert: list[dict[str, Any]] = []
    new_names: list[str] = []

    for kw in clean_kws:
        if kw.lower() in existing_set:
            # Nếu đã tồn tại nhưng bị tắt -> bật lại và cập nhật chủ đề
            try:
                supabase.table(TABLE).update({"is_active": True}).eq("keyword", kw).execute()
            except Exception:
                pass
            topics_map[kw] = clean_topic
            continue

        item = {
            "keyword": kw,
            "is_active": True,
            "topic": clean_topic,
            "created_by": created_by or "Thành viên",
        }
        to_insert.append(item)
        new_names.append(kw)
        topics_map[kw] = clean_topic
        existing_set.add(kw.lower())

    if to_insert:
        try:
            # Thử insert với cả cột topic và created_by
            supabase.table(TABLE).insert(to_insert).execute()
        except Exception as exc:
            logger.warning(f"[threads_keyword] Insert có topic lỗi (chưa chạy migration 233?), fallback insert cơ bản: {exc}")
            try:
                # Fallback nếu DB chưa có cột topic
                fallback_insert = [{"keyword": it["keyword"], "is_active": True} for it in to_insert]
                supabase.table(TABLE).insert(fallback_insert).execute()
            except Exception as e2:
                logger.error(f"[threads_keyword] Fallback insert thất bại: {e2}")
                return {"success": False, "message": str(e2), "added": 0}

    _save_topics_map(topics_map)
    logger.info(f"[threads_keyword] Đã thêm {len(new_names)} từ khóa mới vào chủ đề '{clean_topic}'")
    return {
        "success": True,
        "message": f"Đã thêm {len(new_names)} từ khóa vào chủ đề '{clean_topic}'",
        "added_count": len(new_names),
        "new_keywords": new_names,
        "topic": clean_topic,
    }


def delete_keyword(keyword_id: str) -> bool:
    """Xóa một từ khóa khỏi thư viện."""
    if not keyword_id:
        return False
    supabase = get_supabase_client()
    try:
        # Xóa theo id hoặc keyword
        res = supabase.table(TABLE).delete().eq("id", keyword_id).execute()
        if not res.data:
            supabase.table(TABLE).delete().eq("keyword", keyword_id).execute()
        return True
    except Exception as exc:
        logger.error(f"[threads_keyword] Xóa từ khóa {keyword_id} lỗi: {exc}")
        return False


def toggle_keyword(keyword_id: str, is_active: Optional[bool] = None) -> bool:
    """Bật / Tắt trạng thái hoạt động của một từ khóa."""
    if not keyword_id:
        return False
    supabase = get_supabase_client()
    try:
        if is_active is None:
            # Lấy trạng thái hiện tại
            curr = supabase.table(TABLE).select("is_active").eq("id", keyword_id).limit(1).execute()
            if curr.data:
                is_active = not bool(curr.data[0].get("is_active", True))
            else:
                is_active = True
        supabase.table(TABLE).update({"is_active": is_active}).eq("id", keyword_id).execute()
        return True
    except Exception as exc:
        logger.error(f"[threads_keyword] Toggle từ khóa {keyword_id} lỗi: {exc}")
        return False


async def ensure_daily_expansion() -> None:
    """AI keyword expansion is disabled per Master directive."""
    return


def record_keyword_result(keyword: str, total_found: int, high_score_count: int) -> None:
    """Cập nhật hiệu quả 1 từ khoá sau khi cào xong (chỉ tăng bộ đếm, 0 token AI)."""
    if not keyword:
        return
    try:
        supabase = get_supabase_client()
        res = (
            supabase.table(TABLE)
            .select("times_used, total_posts_found, high_score_posts")
            .eq("keyword", keyword)
            .limit(1)
            .execute()
        )
        if not res.data:
            return
        row = res.data[0]
        supabase.table(TABLE).update({
            "times_used": (row.get("times_used") or 0) + 1,
            "total_posts_found": (row.get("total_posts_found") or 0) + total_found,
            "high_score_posts": (row.get("high_score_posts") or 0) + high_score_count,
            "last_used_at": datetime.now(timezone.utc).isoformat(),
        }).eq("keyword", keyword).execute()
    except Exception as exc:
        logger.warning(f"[threads_keyword] record_keyword_result lỗi cho '{keyword}': {exc}")


async def evolve_and_select_keywords(
    target_count: Optional[int] = None,
    rotate_replace_count: int = 0,
) -> dict[str, Any]:
    """Tự động nạp động TOÀN BỘ từ khóa active trong Thư viện để cào cho vòng Threads.

    - Không gọi AI đề xuất hay đánh giá -> Tiết kiệm 100% token AI.
    - Cào TOÀN BỘ từ khóa hiện có trong thư viện theo tất cả các chủ đề.
    - Luôn đọc mới từ cơ sở dữ liệu trước mỗi vòng -> Khi người dùng thêm từ khóa mới,
      vòng kế tiếp sẽ tự động nạp lại và cào đầy đủ ngay lập tức.
    """
    rows = list_all_keywords()
    active_rows = [r for r in rows if r.get("is_active")]

    # Nếu thư viện hoàn toàn trống, nạp bộ từ khóa nền tảng
    if not active_rows:
        logger.info("[threads_keyword] Thư viện từ khóa trống, nạp bộ từ khóa khởi điểm...")
        add_keywords("Website", ["làm web", "thiết kế web", "thiết kế website", "landing page", "wordpress", "shopify", "ui ux"])
        add_keywords("Mobile App", ["mobile app", "app bán hàng", "làm app", "flutter", "react native"])
        add_keywords("Phần mềm & CRM", ["phần mềm", "crm", "erp", "phần mềm quản lý", "pos", "outsource", "lập trình"])
        add_keywords("Marketing & Ads", ["chạy ads", "digital marketing", "bán hàng", "freelancer", "kinh doanh"])
        add_keywords("AI & Automation", ["tự động hóa", "n8n", "chatbot", "ai agent", "saas", "automation"])
        rows = list_all_keywords()
        active_rows = [r for r in rows if r.get("is_active")]

    keywords = [str(r["keyword"]).strip() for r in active_rows if str(r.get("keyword") or "").strip()]
    if target_count is not None and target_count > 0 and len(keywords) > target_count:
        keywords = keywords[:target_count]

    return {
        "keywords": keywords,
        "meta": {
            "total_active": len(keywords),
            "selected_count": len(keywords),
            "newly_generated": 0,
            "new_keywords": [],
            "deactivated": [],
            "ai_powered": False,
            "items": [
                {
                    "id": str(r.get("id") or ""),
                    "keyword": str(r.get("keyword") or ""),
                    "topic": str(r.get("topic") or "Chung"),
                    "times_used": int(r.get("times_used") or 0),
                    "total_posts_found": int(r.get("total_posts_found") or 0),
                    "high_score_posts": int(r.get("high_score_posts") or 0),
                    "is_active": bool(r.get("is_active", True)),
                    "created_by": str(r.get("created_by") or "Hệ thống"),
                }
                for r in active_rows
            ],
        },
    }
