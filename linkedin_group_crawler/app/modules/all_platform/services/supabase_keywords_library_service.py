"""Supabase-based Keywords Library service for All-Platform module."""

from __future__ import annotations

import re
import unicodedata
from typing import Any
from fastapi import HTTPException
from supabase import Client

from app.core.supabase_client import get_supabase_client

TABLE_CATEGORIES = "categories"
TABLE_USERS = "app_users"


def _slugify(text: str) -> str:
    """Convert unicode text to slug format."""
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("utf-8")
    text = re.sub(r"[^\w\s-]", "", text).strip().lower()
    return re.sub(r"[-\s]+", "-", text) or "topic"


def _get_user_map(supabase: Client, user_ids: list[str]) -> dict[str, dict[str, Any]]:
    """Fetch user profiles for given user_ids."""
    if not user_ids:
        return {}
    clean_ids = [uid for uid in set(user_ids) if uid]
    if not clean_ids:
        return {}
    
    try:
        res = (
            supabase.table(TABLE_USERS)
            .select("id, name, email, avatar_url, role")
            .in_("id", clean_ids)
            .execute()
        )
        return {u["id"]: u for u in (res.data or [])}
    except Exception:
        return {}


def get_keyword_topics() -> list[dict[str, Any]]:
    """Get all keyword topics with creator info and keywords count."""
    supabase: Client = get_supabase_client()

    topics_res = (
        supabase.table(TABLE_CATEGORIES)
        .select("*")
        .eq("category_type", "keyword_topic")
        .order("created_at", desc=True)
        .execute()
    )
    topics = topics_res.data or []
    if not topics:
        return []

    # Get keyword items to count per topic
    items_res = (
        supabase.table(TABLE_CATEGORIES)
        .select("id, code")
        .eq("category_type", "keyword_item")
        .execute()
    )
    items = items_res.data or []
    counts_by_topic: dict[str, int] = {}
    for item in items:
        topic_id = str(item.get("code") or "")
        counts_by_topic[topic_id] = counts_by_topic.get(topic_id, 0) + 1

    # Map creator profiles
    user_ids = [t.get("app_user_id") for t in topics if t.get("app_user_id")]
    user_map = _get_user_map(supabase, user_ids)

    result = []
    for t in topics:
        tid = str(t["id"])
        uid = t.get("app_user_id")
        user_info = user_map.get(uid, {}) if uid else {}
        result.append({
            "id": tid,
            "name": t.get("name") or "Chủ đề chưa đặt tên",
            "code": t.get("code") or "",
            "description": t.get("description") or "",
            "app_user_id": uid,
            "creator_name": user_info.get("name") or "Thành viên hệ thống",
            "creator_email": user_info.get("email") or "",
            "creator_avatar": user_info.get("avatar_url") or "",
            "keywords_count": counts_by_topic.get(tid, 0),
            "created_at": t.get("created_at") or "",
            "updated_at": t.get("updated_at") or "",
        })
    return result


def get_keywords_by_topic(topic_id: str) -> list[dict[str, Any]]:
    """Get all keywords inside a topic, with contributor info."""
    supabase: Client = get_supabase_client()

    items_res = (
        supabase.table(TABLE_CATEGORIES)
        .select("*")
        .eq("category_type", "keyword_item")
        .eq("code", topic_id)
        .order("created_at", desc=False)
        .execute()
    )
    items = items_res.data or []
    if not items:
        return []

    user_ids = [it.get("app_user_id") for it in items if it.get("app_user_id")]
    user_map = _get_user_map(supabase, user_ids)

    result = []
    for it in items:
        uid = it.get("app_user_id")
        user_info = user_map.get(uid, {}) if uid else {}
        result.append({
            "id": str(it["id"]),
            "topic_id": topic_id,
            "keyword": it.get("name") or "",
            "description": it.get("description") or "",
            "app_user_id": uid,
            "contributor_name": user_info.get("name") or "Thành viên hệ thống",
            "contributor_email": user_info.get("email") or "",
            "created_at": it.get("created_at") or "",
        })
    return result


def create_keyword_topic(
    name: str,
    description: str | None,
    user_id: str | None,
    initial_keywords: list[str] | None = None,
) -> dict[str, Any]:
    """Create a new keyword topic and optionally insert initial keywords."""
    supabase: Client = get_supabase_client()

    clean_name = name.strip()
    if not clean_name:
        raise HTTPException(status_code=400, detail="Tên chủ đề không được để trống")

    code = _slugify(clean_name)

    topic_insert = {
        "category_type": "keyword_topic",
        "name": clean_name,
        "code": code,
        "description": (description or "").strip(),
        "app_user_id": user_id,
        "is_active": True,
    }

    res = supabase.table(TABLE_CATEGORIES).insert(topic_insert).execute()
    if not res.data:
        raise HTTPException(status_code=500, detail="Không thể tạo chủ đề từ khóa")
    created_topic = res.data[0]
    topic_id = str(created_topic["id"])

    # Insert initial keywords if present
    added_count = 0
    if initial_keywords:
        seen = set()
        to_insert = []
        for kw in initial_keywords:
            kw_clean = kw.strip()
            if kw_clean and kw_clean.lower() not in seen:
                seen.add(kw_clean.lower())
                to_insert.append({
                    "category_type": "keyword_item",
                    "code": topic_id,
                    "name": kw_clean,
                    "description": "",
                    "app_user_id": user_id,
                    "is_active": True,
                })
        if to_insert:
            kw_res = supabase.table(TABLE_CATEGORIES).insert(to_insert).execute()
            added_count = len(kw_res.data or [])

    created_topic["keywords_count"] = added_count
    return created_topic


def add_keywords_to_topic(
    topic_id: str,
    keywords: list[str],
    user_id: str | None,
) -> dict[str, Any]:
    """Add or contribute keywords to a topic."""
    supabase: Client = get_supabase_client()

    # Check topic exists
    topic_res = (
        supabase.table(TABLE_CATEGORIES)
        .select("id, name, app_user_id")
        .eq("category_type", "keyword_topic")
        .eq("id", topic_id)
        .execute()
    )
    if not topic_res.data:
        raise HTTPException(status_code=404, detail="Chủ đề từ khóa không tồn tại")

    # Get existing keywords in this topic to avoid duplicates
    existing_res = (
        supabase.table(TABLE_CATEGORIES)
        .select("name")
        .eq("category_type", "keyword_item")
        .eq("code", topic_id)
        .execute()
    )
    existing_kws = {it.get("name", "").strip().lower() for it in (existing_res.data or [])}

    seen = set()
    to_insert = []
    for kw in keywords:
        kw_clean = kw.strip()
        if kw_clean and kw_clean.lower() not in existing_kws and kw_clean.lower() not in seen:
            seen.add(kw_clean.lower())
            to_insert.append({
                "category_type": "keyword_item",
                "code": topic_id,
                "name": kw_clean,
                "description": "",
                "app_user_id": user_id,
                "is_active": True,
            })

    if not to_insert:
        return {"added_count": 0, "message": "Tất cả từ khóa đã tồn tại trong chủ đề này"}

    res = supabase.table(TABLE_CATEGORIES).insert(to_insert).execute()
    added_count = len(res.data or [])
    return {"added_count": added_count, "total_attempted": len(keywords)}


def delete_keyword(keyword_id: str, user_id: str | None, is_admin: bool = False) -> dict[str, Any]:
    """Delete a keyword item."""
    supabase: Client = get_supabase_client()

    kw_res = (
        supabase.table(TABLE_CATEGORIES)
        .select("id, code, app_user_id")
        .eq("category_type", "keyword_item")
        .eq("id", keyword_id)
        .execute()
    )
    if not kw_res.data:
        raise HTTPException(status_code=404, detail="Từ khóa không tồn tại")
    kw = kw_res.data[0]

    # Permission check: admin, creator of keyword, or creator of topic
    if not is_admin and str(kw.get("app_user_id")) != str(user_id):
        # check topic creator
        topic_id = kw.get("code")
        topic_res = (
            supabase.table(TABLE_CATEGORIES)
            .select("app_user_id")
            .eq("id", topic_id)
            .execute()
        )
        if not topic_res.data or str(topic_res.data[0].get("app_user_id")) != str(user_id):
            raise HTTPException(status_code=403, detail="Bạn không có quyền xóa từ khóa này")

    supabase.table(TABLE_CATEGORIES).delete().eq("id", keyword_id).execute()
    return {"deleted": True, "id": keyword_id}


def delete_topic(topic_id: str, user_id: str | None, is_admin: bool = False) -> dict[str, Any]:
    """Delete a keyword topic and all its keywords."""
    supabase: Client = get_supabase_client()

    topic_res = (
        supabase.table(TABLE_CATEGORIES)
        .select("id, app_user_id")
        .eq("category_type", "keyword_topic")
        .eq("id", topic_id)
        .execute()
    )
    if not topic_res.data:
        raise HTTPException(status_code=404, detail="Chủ đề từ khóa không tồn tại")
    topic = topic_res.data[0]

    if not is_admin and str(topic.get("app_user_id")) != str(user_id):
        raise HTTPException(status_code=403, detail="Chỉ người tạo chủ đề hoặc Admin mới có quyền xóa chủ đề này")

    # Delete all items in topic
    supabase.table(TABLE_CATEGORIES).delete().eq("category_type", "keyword_item").eq("code", topic_id).execute()
    # Delete topic
    supabase.table(TABLE_CATEGORIES).delete().eq("id", topic_id).execute()
    return {"deleted": True, "id": topic_id}
