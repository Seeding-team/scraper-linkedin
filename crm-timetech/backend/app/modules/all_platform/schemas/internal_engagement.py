"""Schemas for the Internal Engagement (Tương tác nội bộ) feature.

Posts come from the external MarkeeAI product (the company's own Facebook
Page publishing tool) — see services/markeeai_client.py.
"""

from __future__ import annotations

from typing import List

from pydantic import BaseModel


class InternalEngagementPost(BaseModel):
    id: str
    fanpage_id: str
    fanpage_name: str | None = None
    facebook_post_id: str | None = None
    content: str = ""
    media_urls: List[str] = []
    permalink_url: str | None = None
    status: str | None = None
    created_at: str | None = None


class MyMarksRequest(BaseModel):
    email_member: str
    link_posts: List[str]


ACTION_TYPES = (
    "comment",
    "like",
    "love",
    "care",
    "haha",
    "wow",
    "sad",
    "angry",
    "share",
)


class InternalEngagementActionRecordRequest(BaseModel):
    email_member: str
    link_post: str | None = ""
    fanpage_id: str | None = ""
    fanpage_name: str | None = None
    facebook_post_id: str | None = None
    action_type: str = "comment"
    content: str | None = None
    reaction_id: str | None = None
    id_social_account: str | None = None
    profile_id: str | None = None
    platform: str | None = None
    status: str | None = None
    error_message: str | None = None


class MarkActionRequest(BaseModel):
    action_type: str = "like"
    fb_uid: str | None = None
    post_url: str | None = None
    email_member: str | None = None
    content: str | None = None


class InternalEngagementSummaryRequest(BaseModel):
    email_member: str
    date_from: str | None = None
    date_to: str | None = None


class TeamScopedRequest(BaseModel):
    """Common params for the team-visibility endpoints — `email` is the
    calling user (used to resolve admin/leader/member scope server-side)."""
    email: str
    team_id: str | None = None  # admin only: filter to one team; ignored for leader/member


class PostInteractionsRequest(TeamScopedRequest):
    link_post: str


class TeamTrendRequest(TeamScopedRequest):
    days: int = 14


class TeamTotalsRequest(TeamScopedRequest):
    date_from: str | None = None
    date_to: str | None = None


class CreateSeedingCampaignRequest(BaseModel):
    name: str
    description: str | None = None
    color_code: str | None = "#fff1f2"
    start_date: str | None = None
    end_date: str | None = None
    created_by_email: str | None = None


class AddCustomPostRequest(BaseModel):
    email: str
    link_post: str | None = None
    url: str | None = None
    fanpage_name: str | None = None
    page_name: str | None = None
    content: str | None = None
    media_urls: List[str] | None = None
    cookie: str | None = None
    campaign_id: str | None = None
    campaign_name: str | None = None
    deadline: str | None = None
    target_comments: int | None = None
    assigned_team_ids: List[str] | None = None
    platform: str | None = None
    likes: int | None = None
    comments: int | None = None
    shares: int | None = None


class DebugFetchMetaRequest(BaseModel):
    url: str
    cookie: str | None = None


class UpdateCustomPostRequest(BaseModel):
    email: str
    content: str | None = None
    fanpage_name: str | None = None
    page_name: str | None = None
    media_urls: List[str] | None = None
    campaign_id: str | None = None
    campaign_name: str | None = None
    deadline: str | None = None
    target_comments: int | None = None
    assigned_team_ids: List[str] | None = None


class DeleteCustomPostRequest(BaseModel):
    email: str


class OverrideMarkeePostRequest(BaseModel):
    email: str
    is_hidden: bool | None = None
    fanpage_name: str | None = None
    page_name: str | None = None
    content: str | None = None
    media_urls: List[str] | None = None