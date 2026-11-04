"""Looks up a linked MarkeeAI login for one of our own app_users, so
Internal Engagement can fetch posts using THAT PERSON's own MarkeeAI
identity (and whatever campaigns they're really a member of there) instead
of always falling back to one shared service account."""

from __future__ import annotations

from typing import Optional

from supabase import Client

from app.core.logger import get_logger
from app.core.supabase_client import get_supabase_client
from app.modules.all_platform.services.markeeai_client import MarkeeCredentials

logger = get_logger(__name__)


def resolve_markeeai_credentials(email_member: str) -> Optional[MarkeeCredentials]:
    """Best-effort lookup — any failure (table not migrated yet, no app_users
    row, no link row) must fall back to the shared service account rather
    than break the whole posts list for everyone."""
    try:
        supabase: Client = get_supabase_client()

        user_res = supabase.table("app_users").select("id").eq("email", email_member).limit(1).execute()
        if not user_res.data:
            return None
        id_member = user_res.data[0]["id"]

        link_res = (
            supabase.table("markeeai_account_links")
            .select("markeeai_email, markeeai_password")
            .eq("id_member", id_member)
            .limit(1)
            .execute()
        )
        if not link_res.data:
            return None

        row = link_res.data[0]
        return MarkeeCredentials(row["markeeai_email"], row["markeeai_password"])
    except Exception as e:
        logger.warning(f"resolve_markeeai_credentials failed for {email_member}, falling back to shared account: {e}")
        return None
