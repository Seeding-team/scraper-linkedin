"""Thư viện từ khoá/chủ đề Threads phục vụ Seeding Crawler (migration 160, 233 và categories table).

Hệ thống thống nhất kết nối trực tiếp với giao diện Quản lý nhóm (tab Threads: /all-platform/quan-ly-nhom?tab=threads):
1. Đọc TOÀN BỘ từ khóa active từ bảng `categories` (category_type = 'keyword_item' và 'keyword_topic').
2. Nạp động 100%: Khi người dùng thêm, sửa hoặc xóa bất kỳ từ khóa/chủ đề nào trên UI quan-ly-nhom?tab=threads,
   vòng cào Threads kế tiếp của tiến trình Public 4G sẽ tự động lấy danh sách mới nhất và cào chính xác.
3. Đồng bộ chỉ số thống kê (times_used, total_posts_found, high_score_posts, last_used_at) với bảng threads_keyword_registry.
4. Loại bỏ hoàn toàn AI đề xuất từ khóa & AI đánh giá từ khóa để tiết kiệm tối đa token AI.
"""

from __future__ import annotations

import json
import os
import re
import unicodedata
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from app.core.config import settings
from app.core.logger import get_logger
from app.core.supabase_client import get_supabase_client

logger = get_logger(__name__)

TABLE_CATEGORIES = "categories"
TABLE_REGISTRY = "threads_keyword_registry"

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


def _slugify(text: str) -> str:
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("utf-8")
    text = re.sub(r"[^\w\s-]", "", text).strip().lower()
    return re.sub(r"[-\s]+", "-", text) or "topic"


def is_configured() -> bool:
    return True


async def _generate_keywords(n: int, existing: list[str]) -> list[str]:
    """AI keyword suggestion is permanently disabled to save AI tokens per Master directive."""
    return []


def list_all_keywords() -> list[dict[str, Any]]:
    """Lấy danh sách toàn bộ từ khóa trong Thư viện Threads từ bảng categories (nơi UI quan-ly-nhom?tab=threads quản lý)."""
    supabase = get_supabase_client()

    # 1. Lấy danh sách chủ đề (keyword_topic) từ categories
    topic_map: dict[str, str] = {}
    try:
        topics_res = (
            supabase.table(TABLE_CATEGORIES)
            .select("id, name")
            .eq("category_type", "keyword_topic")
            .execute()
        )
        for t in (topics_res.data or []):
            topic_map[str(t.get("id"))] = str(t.get("name") or "Chung")
    except Exception as exc:
        logger.warning(f"[threads_keyword] Lỗi query keyword_topic từ {TABLE_CATEGORIES}: {exc}")

    # 2. Lấy danh sách từ khóa (keyword_item) từ categories
    items_rows: list[dict[str, Any]] = []
    try:
        items_res = (
            supabase.table(TABLE_CATEGORIES)
            .select("id, name, code, description, created_at, app_user_id, is_active")
            .eq("category_type", "keyword_item")
            .order("created_at", desc=True)
            .execute()
        )
        items_rows = items_res.data or []
    except Exception as exc:
        logger.warning(f"[threads_keyword] Lỗi query keyword_item từ {TABLE_CATEGORIES}: {exc}")

    # 3. Lấy thông tin thống kê cào từ threads_keyword_registry (nếu có)
    stats_map: dict[str, dict[str, Any]] = {}
    try:
        reg_res = supabase.table(TABLE_REGISTRY).select("*").execute()
        for r in (reg_res.data or []):
            kw_key = str(r.get("keyword") or "").lower().strip()
            if kw_key:
                stats_map[kw_key] = r
    except Exception as exc:
        logger.debug(f"[threads_keyword] Lỗi query {TABLE_REGISTRY}: {exc}")

    out: list[dict[str, Any]] = []
    seen_kws = set()

    for it in items_rows:
        kw = str(it.get("name") or "").strip()
        if not kw:
            continue
        topic_id = str(it.get("code") or "")
        topic_name = topic_map.get(topic_id) or "Chung"

        stat = stats_map.get(kw.lower(), {})
        is_active = it.get("is_active")
        if is_active is None:
            is_active = stat.get("is_active", True)
        else:
            is_active = bool(is_active)

        seen_kws.add(kw.lower())
        out.append({
            "id": str(it.get("id") or ""),
            "keyword": kw,
            "topic": topic_name,
            "topic_id": topic_id,
            "is_active": is_active,
            "times_used": int(stat.get("times_used") or 0),
            "total_posts_found": int(stat.get("total_posts_found") or 0),
            "high_score_posts": int(stat.get("high_score_posts") or 0),
            "last_used_at": stat.get("last_used_at"),
            "created_at": it.get("created_at"),
            "created_by": it.get("app_user_id") or "Người dùng",
        })

    # Nếu categories chưa có từ khóa nào, fallback lấy từ threads_keyword_registry
    if not out and stats_map:
        for kw_key, stat in stats_map.items():
            kw = str(stat.get("keyword") or "").strip()
            if kw and kw.lower() not in seen_kws:
                seen_kws.add(kw.lower())
                out.append({
                    "id": str(stat.get("id") or ""),
                    "keyword": kw,
                    "topic": str(stat.get("topic") or "Chung"),
                    "is_active": bool(stat.get("is_active", True)),
                    "times_used": int(stat.get("times_used") or 0),
                    "total_posts_found": int(stat.get("total_posts_found") or 0),
                    "high_score_posts": int(stat.get("high_score_posts") or 0),
                    "last_used_at": stat.get("last_used_at"),
                    "created_at": stat.get("created_at"),
                    "created_by": str(stat.get("created_by") or "Hệ thống"),
                })

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
    """Thêm một hoặc nhiều từ khóa vào Thư viện theo Chủ đề (ghi vào categories và threads_keyword_registry)."""
    clean_topic = (topic or "").strip() or "Chung"
    clean_kws = [str(k).strip() for k in keywords if str(k).strip()]
    if not clean_kws:
        return {"success": False, "message": "Không có từ khóa hợp lệ để thêm", "added": 0}

    supabase = get_supabase_client()

    # 1. Tìm hoặc tạo topic trong categories
    topic_id = ""
    try:
        t_res = (
            supabase.table(TABLE_CATEGORIES)
            .select("id")
            .eq("category_type", "keyword_topic")
            .ilike("name", clean_topic)
            .limit(1)
            .execute()
        )
        if t_res.data:
            topic_id = str(t_res.data[0]["id"])
        else:
            code = _slugify(clean_topic)
            new_t = (
                supabase.table(TABLE_CATEGORIES)
                .insert({
                    "category_type": "keyword_topic",
                    "name": clean_topic,
                    "code": code,
                    "description": "",
                    "is_active": True,
                })
                .execute()
            )
            if new_t.data:
                topic_id = str(new_t.data[0]["id"])
    except Exception as exc:
        logger.warning(f"[threads_keyword] Lỗi resolve topic {clean_topic} trong categories: {exc}")

    # 2. Thêm vào categories (nếu có topic_id)
    if topic_id:
        try:
            existing_res = (
                supabase.table(TABLE_CATEGORIES)
                .select("name")
                .eq("category_type", "keyword_item")
                .eq("code", topic_id)
                .execute()
            )
            existing_kws = {str(it.get("name") or "").strip().lower() for it in (existing_res.data or [])}

            to_insert_cat = []
            for kw in clean_kws:
                if kw.lower() not in existing_kws:
                    existing_kws.add(kw.lower())
                    to_insert_cat.append({
                        "category_type": "keyword_item",
                        "code": topic_id,
                        "name": kw,
                        "description": "",
                        "is_active": True,
                    })
            if to_insert_cat:
                supabase.table(TABLE_CATEGORIES).insert(to_insert_cat).execute()
        except Exception as exc:
            logger.warning(f"[threads_keyword] Lỗi insert categories keyword_item: {exc}")

    # 3. Đồng bộ thêm vào threads_keyword_registry
    try:
        to_insert_reg = []
        for kw in clean_kws:
            to_insert_reg.append({
                "keyword": kw,
                "is_active": True,
                "topic": clean_topic,
                "created_by": created_by or "Thành viên",
            })
        if to_insert_reg:
            supabase.table(TABLE_REGISTRY).upsert(to_insert_reg, on_conflict="keyword").execute()
    except Exception as exc:
        logger.debug(f"[threads_keyword] Upsert threads_keyword_registry: {exc}")

    return {
        "success": True,
        "message": f"Đã thêm {len(clean_kws)} từ khóa vào chủ đề '{clean_topic}'",
        "added_count": len(clean_kws),
        "new_keywords": clean_kws,
        "topic": clean_topic,
    }


def delete_keyword(keyword_id: str) -> bool:
    """Xóa một từ khóa khỏi thư viện (xóa ở cả categories và threads_keyword_registry)."""
    if not keyword_id:
        return False
    supabase = get_supabase_client()
    try:
        # Xóa từ categories theo id hoặc theo name
        supabase.table(TABLE_CATEGORIES).delete().eq("id", keyword_id).eq("category_type", "keyword_item").execute()
        supabase.table(TABLE_CATEGORIES).delete().eq("name", keyword_id).eq("category_type", "keyword_item").execute()

        # Xóa từ threads_keyword_registry
        supabase.table(TABLE_REGISTRY).delete().eq("id", keyword_id).execute()
        supabase.table(TABLE_REGISTRY).delete().eq("keyword", keyword_id).execute()
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
            curr = supabase.table(TABLE_CATEGORIES).select("is_active").eq("id", keyword_id).limit(1).execute()
            if curr.data:
                is_active = not bool(curr.data[0].get("is_active", True))
            else:
                is_active = True
        supabase.table(TABLE_CATEGORIES).update({"is_active": is_active}).eq("id", keyword_id).execute()
        try:
            supabase.table(TABLE_REGISTRY).update({"is_active": is_active}).eq("id", keyword_id).execute()
        except Exception:
            pass
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
    clean_kw = keyword.strip()
    if not clean_kw:
        return
    try:
        supabase = get_supabase_client()
        res = (
            supabase.table(TABLE_REGISTRY)
            .select("times_used, total_posts_found, high_score_posts")
            .ilike("keyword", clean_kw)
            .limit(1)
            .execute()
        )
        if not res.data:
            supabase.table(TABLE_REGISTRY).insert({
                "keyword": clean_kw,
                "times_used": 1,
                "total_posts_found": total_found,
                "high_score_posts": high_score_count,
                "last_used_at": datetime.now(timezone.utc).isoformat(),
                "is_active": True,
            }).execute()
            return
        row = res.data[0]
        supabase.table(TABLE_REGISTRY).update({
            "times_used": (row.get("times_used") or 0) + 1,
            "total_posts_found": (row.get("total_posts_found") or 0) + total_found,
            "high_score_posts": (row.get("high_score_posts") or 0) + high_score_count,
            "last_used_at": datetime.now(timezone.utc).isoformat(),
        }).ilike("keyword", clean_kw).execute()
    except Exception as exc:
        logger.warning(f"[threads_keyword] record_keyword_result lỗi cho '{clean_kw}': {exc}")


async def evolve_and_select_keywords(
    target_count: Optional[int] = None,
    rotate_replace_count: int = 0,
) -> dict[str, Any]:
    """Tự động nạp động TOÀN BỘ từ khóa active từ Thư viện Threads (quan-ly-nhom?tab=threads) trước mỗi vòng cào.

    - Đọc trực tiếp từ cơ sở dữ liệu categories ở MỖI vòng chạy -> Người dùng thêm hay xóa từ khóa trên UI
      quan-ly-nhom?tab=threads thì vòng sau sẽ tự động cập nhật khớp 100%.
    - Deduplicate case-insensitive các từ khóa trùng lặp giữa các chủ đề để tối ưu băng thông proxy 4G.
    - Không gọi AI đề xuất hay đánh giá -> Tiết kiệm 100% token AI.
    """
    rows = list_all_keywords()
    active_rows = [r for r in rows if r.get("is_active")]

    # Nếu cả categories và registry đều hoàn toàn trống, nạp fallback mặc định
    if not active_rows:
        logger.info("[threads_keyword] Thư viện từ khóa trống, nạp bộ từ khóa khởi điểm...")
        add_keywords("Website", ["làm web", "thiết kế web", "thiết kế website", "landing page", "wordpress", "shopify", "ui ux"])
        add_keywords("Mobile App", ["mobile app", "app bán hàng", "làm app", "flutter", "react native"])
        add_keywords("Phần mềm & CRM", ["phần mềm", "crm", "erp", "phần mềm quản lý", "pos", "outsource", "lập trình"])
        add_keywords("Marketing & Ads", ["chạy ads", "digital marketing", "bán hàng", "freelancer", "kinh doanh"])
        add_keywords("AI & Automation", ["tự động hóa", "n8n", "chatbot", "ai agent", "saas", "automation"])
        rows = list_all_keywords()
        active_rows = [r for r in rows if r.get("is_active")]

    # Sắp xếp ưu tiên:
    # 1. Từ khóa mới thêm trên quan-ly-nhom?tab=threads hoặc chưa cào bao giờ (times_used == 0) lên ĐẦU TIÊN
    # 2. Từ khóa cào lâu nhất (last_used_at cũ nhất) lên kế tiếp
    sorted_active = sorted(
        active_rows,
        key=lambda r: (
            1 if (r.get("times_used") or 0) > 0 else 0,
            r.get("last_used_at") or "",
        ),
    )

    # Deduplicate theo text (case-insensitive) nhưng giữ nguyên display casing
    seen_lower = set()
    deduped_items = []
    keywords = []
    for r in sorted_active:
        kw = str(r.get("keyword") or "").strip()
        if not kw:
            continue
        lowered = kw.lower()
        if lowered not in seen_lower:
            seen_lower.add(lowered)
            deduped_items.append(r)
            keywords.append(kw)

    # Nếu người dùng có cấu hình target_count cụ thể nhỏ hơn tổng số từ khóa
    if target_count is not None and target_count > 0 and len(keywords) > target_count:
        keywords = keywords[:target_count]
        deduped_items = deduped_items[:target_count]

    logger.info(f"[threads_keyword] Đã nạp động {len(keywords)} từ khóa từ Thư viện Threads (quan-ly-nhom)")
    return {
        "keywords": keywords,
        "meta": {
            "total_active": len(keywords),
            "selected_count": len(keywords),
            "newly_generated": 0,
            "new_keywords": [],
            "deactivated": [],
            "ai_powered": False,
            "items": deduped_items,
        },
    }
