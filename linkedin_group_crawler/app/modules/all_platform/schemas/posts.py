"""Posts schemas for all-platform module."""

from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel


class GetAllPostsRequest(BaseModel):
    email: str
    date_from: Optional[str] = None
    date_to: Optional[str] = None
    time_range: Optional[str] = "all"
    intent: Optional[str] = None


class FilterPostsRequest(BaseModel):
    email: str
    date: Optional[str] = None
    date_from: Optional[str] = None
    date_to: Optional[str] = None
    time_range: Optional[str] = "all"
    intent: Optional[str] = None
    industry: Optional[str] = None
    team: Optional[str] = None
    tier: Optional[str] = None


class EvaluationStatusCountsRequest(BaseModel):
    """Đếm số bài theo evaluation_code cho dropdown "Trạng thái liên hệ" (Post Feed) — COUNT
    thật từ DB, không giới hạn page_size=50 (xem get_evaluation_status_counts).
    `service_area`: tên hiển thị team (khớp `post.team`/`matchesServiceArea` ở FE) — KHÁC
    `UnifiedPostsRequest.team` (id_team, dùng cho bộ lọc "Lĩnh vực" riêng).
    `date_from`/`date_to` (2026-11-27): lọc theo đúng kỳ của CallResultStatsWidget — None =
    toàn bộ lịch sử."""

    platform: str = "all"
    service_area: Optional[str] = None
    date_from: Optional[str] = None
    date_to: Optional[str] = None


class UnifiedPostsRequest(BaseModel):
    email: str
    platform: str = "all"
    date_from: Optional[str] = None
    date_to: Optional[str] = None
    time_range: Optional[str] = "all"
    intent: Optional[str] = None
    industry: Optional[str] = None
    team: Optional[str] = None
    tier: Optional[str] = None
    sort: str = "latest"
    page: int = 1
    page_size: int = 20


class UnifiedFilterRequest(BaseModel):
    email: str
    platform: str = "all"
    date: Optional[str] = None
    date_from: Optional[str] = None
    date_to: Optional[str] = None
    intent: Optional[str] = None
    industry: Optional[str] = None
    team: Optional[str] = None
    tier: Optional[str] = None
    icp: Optional[str] = None
    content_type: Optional[str] = None
    product_seeding: Optional[str] = None
    search: Optional[str] = None
    id_member: Optional[str] = None
    call_result_code: Optional[str] = None
    contact_member_id: Optional[str] = None
    # 'chua-danh-gia'/'can-lien-he'/'khong-phu-hop' — server-paginate đúng theo dropdown
    # "Trạng thái liên hệ" (2026-11-27), xem _resolve_post_ids_by_evaluation_status().
    evaluation_code: Optional[str] = None
    # Tên hiển thị team (khớp matchesServiceArea ở FE) — KHÁC `team` (id_team) ở trên.
    service_area: Optional[str] = None
    sort: str = "latest"
    page: int = 1
    page_size: int = 20


class SyncProgressRequest(BaseModel):
    email: str
    posts: list[dict[str, Any]]


class PostSeedingRosterRequest(BaseModel):
    email: str
    post_id: str
    platform: str


class MemberCrawlHistoryRequest(BaseModel):
    email: str
    id_member: str

class CrawlScheduleHistoryRequest(BaseModel):
    email: Optional[str] = None
    id_member: Optional[str] = None
    time_range: Optional[str] = "all"
    specific_date: Optional[str] = None
    date_from: Optional[str] = None
    date_to: Optional[str] = None
    limit: Optional[int] = 100


class RecordCrawlRoundRequest(BaseModel):
    schedule_id: Optional[str] = None
    schedule_label: Optional[str] = None
    round_number: Optional[int] = 1
    user_id: Optional[str] = None
    user_email: Optional[str] = None
    user_name: Optional[str] = None
    is_system: Optional[bool] = False
    started_at: Optional[str] = None
    finished_at: Optional[str] = None
    duration_seconds: Optional[int] = 0
    status: Optional[str] = "done"
    summary: Optional[dict[str, Any]] = None

