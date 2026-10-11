"""LinkedIn crawl service for all-platform module — saves results to Supabase."""

from __future__ import annotations

import uuid
from datetime import datetime, date
from typing import Optional

from app.core.logger import get_logger
from app.core.supabase_client import get_supabase_client

logger = get_logger(__name__)


import re

def _get_group_taxonomy(group_url: str) -> dict:
    """Look up group taxonomy metadata from linkedin_groups table."""
    supabase = get_supabase_client()
    
    # Try to extract the numeric group ID from the URL for robust matching
    match = re.search(r"/groups/(\d+)", group_url)
    if match:
        group_id = match.group(1)
        res = (
            supabase.table("linkedin_groups")
            .select("id, id_intent, id_industry, id_team, id_tier, id_icp")
            .ilike("group_url", f"%{group_id}%")
            .execute()
        )
        if res.data:
            return res.data[0]

    # Fallback to direct matching
    group_urls = [group_url]
    if group_url.endswith("/"):
        group_urls.append(group_url[:-1])
    else:
        group_urls.append(group_url + "/")

    res = (
        supabase.table("linkedin_groups")
        .select("id, id_intent, id_industry, id_team, id_tier, id_icp")
        .in_("group_url", group_urls)
        .execute()
    )
    return res.data[0] if res.data else {}


def delete_crawl_session_by_id(session_id: str) -> bool:
    """Delete a crawl session and its associated posts."""
    supabase = get_supabase_client()
    # Delete posts first to avoid FK constraint errors if ON DELETE CASCADE is not set
    supabase.table("linkedin_posts").delete().eq("session_id", session_id).execute()
    res = supabase.table("crawl_linkedin_session").delete().eq("id", session_id).execute()
    return bool(res.data)



def save_crawl_batch_to_supabase(
    *,
    email_crawl: str,
    target_date: str,
    groups_results: list[dict],
) -> dict:
    """
    Save a batch of crawl results (multiple groups) to Supabase.

    Each item in groups_results contains:
        - session_id: str
        - group_name: str
        - group_url: str
        - posts: list[dict]  — raw post dicts from Playwright crawler
        - total_posts_scraped: int
        - success: bool
        - error: str | None

    Returns a summary dict.
    """
    supabase = get_supabase_client()
    total_sessions = 0
    total_posts = 0
    errors = []

    # Fetch account metadata
    account_res = supabase.table("linkedin_account_crawl").select("id, id_member").eq("email_linkedin", email_crawl).execute()
    account_data = account_res.data[0] if account_res.data else {}
    id_account_crawl = account_data.get("id")
    id_member = account_data.get("id_member")

    for group_result in groups_results:
        if not group_result.get("success"):
            errors.append({
                "group_url": group_result.get("group_url", ""),
                "error": group_result.get("error", "Unknown error"),
            })
            continue

        # Generate a unique database session ID for this specific group crawl
        db_session_id = str(uuid.uuid4())
        
        group_url = group_result.get("group_url", "")
        group_name = group_result.get("group_name", "")
        posts = group_result.get("posts", [])
        total_posts_per_run = group_result.get("total_posts_scraped", len(posts))

        # Get taxonomy for this group
        group_taxonomy = _get_group_taxonomy(group_url)
        id_group = group_taxonomy.get("id")

        # Upsert crawl_linkedin_session
        try:
            session_record = {
                "id": db_session_id,
                "posts_count": len(posts),
                "status": "completed",
                "id_account_crawl": id_account_crawl,
                "id_member": id_member,
                "id_platform": 2  # LinkedIn
            }
            supabase.table("crawl_linkedin_session").insert(session_record).execute()
            total_sessions += 1
        except Exception:
            logger.exception("Failed to insert crawl_session for %s", group_url)

        # Upsert posts (Only the top post with most interaction per group)
        if posts:
            try:
                def safe_int(val):
                    if not val:
                        return 0
                    if isinstance(val, str):
                        import re
                        digits = re.sub(r'[^\d]', '', val)
                        return int(digits) if digits else 0
                    return int(val)

                # Sort posts by interaction (likes + comments + shares) descending
                sorted_posts = sorted(
                    posts, 
                    key=lambda p: safe_int(p.get("likes")) + safe_int(p.get("comments")) + safe_int(p.get("reposts") or p.get("shares")), 
                    reverse=True
                )
                top_post = sorted_posts[0]

                p = top_post
                posted_at_val = p.get("posted_at") or None
                rec = {
                    "session_id": db_session_id,
                    "crawl_date": target_date,
                    "post_url": p.get("post_url") or "",
                    "author": p.get("author") or "",
                    "content": p.get("content") or "",
                    "likes": p.get("likes") or 0,
                    "comments": p.get("comments") or 0,
                    "shares": p.get("reposts") or p.get("shares") or 0,
                    "score": p.get("score") or 0,
                    "posted_at": posted_at_val,
                    "total_posts_per_run": total_posts_per_run,
                    "id_group": id_group,
                    "id_account_crawl": id_account_crawl,
                    "id_member": id_member,
                }

                post_records = [rec]

                if post_records:
                    supabase.table("linkedin_posts").upsert(
                        post_records, on_conflict="post_url"
                    ).execute()
                    total_posts += len(post_records)
            except Exception:
                logger.exception("Failed to upsert linkedin_posts for %s", group_url)

    return {
        "total_sessions": total_sessions,
        "total_posts": total_posts,
        "errors": errors,
    }
