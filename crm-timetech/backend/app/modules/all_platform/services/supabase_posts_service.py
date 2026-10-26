"""Supabase-based posts service for all-platform module."""

from __future__ import annotations

from typing import Optional

from supabase import Client

from app.core.supabase_client import get_supabase_client


def get_all_facebook_posts(
    email: str,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    intent: Optional[str] = None,
) -> list[dict]:
    """Get all Facebook posts, optionally filtered."""
    supabase: Client = get_supabase_client()

    query = supabase.table("facebook_posts").select("*, author_post(*)")

    if email:
        user_res = supabase.table("app_users").select("id").eq("email", email.strip().lower()).limit(1).execute()
        user_id = user_res.data[0]["id"] if user_res.data else None
        if user_id:
            query = query.eq("id_member", user_id)
        else:
            query = query.eq("id_member", "00000000-0000-0000-0000-000000000000")

    if date_from:
        query = query.gte("crawl_date", date_from)
    if date_to:
        query = query.lte("crawl_date", date_to)
    if intent:
        query = query.eq("intent", intent)

    result = query.order("crawl_date", desc=True).execute()
    return result.data or []


def build_crawl_sessions_from_supabase_posts(posts: list[dict]) -> list[dict]:
    # Group posts by session_id
    buckets = {}
    for p in posts:
        sid = p.get("session_id") or "unknown"
        if sid not in buckets:
            buckets[sid] = []
        buckets[sid].append(p)
    
    sessions = []
    for sid, plist in buckets.items():
        # Find group details from the posts in this session
        gu = ""
        gn = ""
        ec = ""
        for p in plist:
            if not gu:
                gu = p.get("group_url") or ""
            if not gn:
                gn = p.get("group_name") or ""
            if not ec:
                ec = p.get("email_crawl") or ""
        
        mapped_posts = []
        for p in plist:
            mapped_p = dict(p)
            mapped_p["id"] = str(p.get("id") or "")
            mapped_p["post_url"] = p.get("post_url") or ""
            mapped_p["author"] = p.get("author") or ""
            mapped_p["content"] = p.get("content") or ""
            mapped_p["score"] = p.get("score") or 0
            mapped_p["reactions"] = p.get("likes") or 0
            mapped_p["likes"] = p.get("likes") or 0
            mapped_p["comments"] = p.get("comments") or 0
            mapped_p["shares"] = p.get("shares") or 0
            mapped_p["posted_at"] = p.get("posted_at") or ""
            mapped_p["crawl_date"] = str(p.get("crawl_date") or "")
            mapped_p["intent"] = p.get("intent") or ""
            mapped_p["industry"] = p.get("industry") or ""
            mapped_p["team"] = p.get("team") or ""
            mapped_p["tier"] = p.get("tier") or 0
            mapped_p["icp"] = p.get("icp") or ""
            mapped_p["icp_desc"] = p.get("icp_desc") or ""
            
            # Map author_url from author_post relationship
            mapped_p["author_url"] = ""
            if p.get("author_post") and isinstance(p.get("author_post"), dict):
                mapped_p["author_url"] = p.get("author_post").get("url_profile") or ""
                
            mapped_posts.append(mapped_p)

        sessions.append({
            "id_session_crawl": sid,
            "group_name": gn,
            "group_url": gu,
            "email_crawl": ec,
            "posts_count": len(mapped_posts),
            "posts": mapped_posts
        })
    
    def get_latest_post_date(s):
        dates = [p.get("crawl_date", "") for p in s["posts"] if p.get("crawl_date")]
        return max(dates) if dates else ""

    sessions.sort(key=get_latest_post_date, reverse=True)
    return sessions


def get_all_linkedin_posts(
    email: str,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    intent: Optional[str] = None,
) -> list[dict]:
    """Get all LinkedIn posts for the given email_crawl only."""
    supabase: Client = get_supabase_client()

    query = supabase.table("linkedin_posts").select("*, author_post(*)")

    # Always scope to the requesting user's crawl email
    if email:
        user_res = supabase.table("app_users").select("id").eq("email", email.strip().lower()).limit(1).execute()
        user_id = user_res.data[0]["id"] if user_res.data else None
        if user_id:
            query = query.eq("id_member", user_id)
        else:
            query = query.eq("id_member", "00000000-0000-0000-0000-000000000000")
    if date_from:
        query = query.gte("crawl_date", date_from)
    if date_to:
        query = query.lte("crawl_date", date_to)
    if intent:
        query = query.eq("intent", intent)

    result = query.order("crawl_date", desc=True).execute()
    return build_crawl_sessions_from_supabase_posts(result.data or [])


def filter_facebook_posts(
    email: str,
    date: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    intent: Optional[str] = None,
    industry: Optional[str] = None,
    team: Optional[str] = None,
    tier: Optional[int] = None,
) -> list[dict]:
    """Filter Facebook posts with multiple criteria."""
    supabase: Client = get_supabase_client()

    query = supabase.table("facebook_posts").select("*, author_post(*)")

    if email:
        user_res = supabase.table("app_users").select("id").eq("email", email.strip().lower()).limit(1).execute()
        user_id = user_res.data[0]["id"] if user_res.data else None
        if user_id:
            query = query.eq("id_member", user_id)
        else:
            query = query.eq("id_member", "00000000-0000-0000-0000-000000000000")

    if date:
        query = query.eq("crawl_date", date)
    if date_from:
        query = query.gte("crawl_date", date_from)
    if date_to:
        query = query.lte("crawl_date", date_to)
    if intent:
        query = query.eq("intent", intent)
    if industry:
        query = query.eq("industry", industry)
    if team:
        query = query.eq("team", team)
    if tier is not None:
        query = query.eq("tier", tier)

    result = query.order("crawl_date", desc=True).execute()
    return result.data or []


def filter_linkedin_posts(
    email: str,
    date: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    intent: Optional[str] = None,
    industry: Optional[str] = None,
    team: Optional[str] = None,
    tier: Optional[int] = None,
) -> list[dict]:
    """Filter LinkedIn posts for the given email_crawl only."""
    supabase: Client = get_supabase_client()

    query = supabase.table("linkedin_posts").select("*, author_post(*)")

    # Always scope to the requesting user's crawl email
    if email:
        user_res = supabase.table("app_users").select("id").eq("email", email.strip().lower()).limit(1).execute()
        user_id = user_res.data[0]["id"] if user_res.data else None
        if user_id:
            query = query.eq("id_member", user_id)
        else:
            query = query.eq("id_member", "00000000-0000-0000-0000-000000000000")
    if date:
        query = query.eq("crawl_date", date)
    if date_from:
        query = query.gte("crawl_date", date_from)
    if date_to:
        query = query.lte("crawl_date", date_to)
    if intent:
        query = query.eq("intent", intent)
    if industry:
        query = query.eq("industry", industry)
    if team:
        query = query.eq("team", team)
    if tier is not None:
        query = query.eq("tier", tier)

    result = query.order("crawl_date", desc=True).execute()
    return build_crawl_sessions_from_supabase_posts(result.data or [])


def sync_facebook_post_progress(email: str, posts: list[dict]) -> dict:
    """Sync engagement counts for Facebook posts."""
    supabase: Client = get_supabase_client()

    updated = 0
    for post in posts:
        post_url = post.get("post_url")
        if not post_url:
            continue
        update_data = {}
        if "reactions" in post:
            update_data["reactions"] = post["reactions"]
        if "comments" in post:
            update_data["comments"] = post["comments"]
        if "shares" in post:
            update_data["shares"] = post["shares"]

        if update_data:
            user_res = supabase.table("app_users").select("id").eq("email", email.strip().lower()).limit(1).execute()
            user_id = user_res.data[0]["id"] if user_res.data else None
            
            if user_id:
                result = (
                    supabase.table("facebook_posts")
                    .update(update_data)
                    .eq("post_url", post_url)
                    .eq("id_member", user_id)
                    .execute()
                )
                updated += len(result.data) if result.data else 0

    return {"updated": updated}
