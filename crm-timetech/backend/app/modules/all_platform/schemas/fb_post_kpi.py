"""FB Post KPI schemas."""

from __future__ import annotations

from datetime import datetime
from typing import Optional, List

from pydantic import BaseModel, Field


class FbPostKpiSaveRequest(BaseModel):
    """Schema để lưu KPI bài viết Facebook."""
    job_id: str = Field(..., description="Job ID từ seeder service")
    user_id: str = Field(..., description="Seeder service user_id (VD: fb_10001)")
    post_url: Optional[str] = Field(None, description="URL bài viết đã đăng")
    content: Optional[str] = Field(None, description="Nội dung bài viết (preview)")
    target_type: str = Field("profile", description="'profile' | 'group' | 'page'")
    target_id: Optional[str] = Field(None, description="Group/Page ID nếu có")
    platform: str = Field("facebook", description="Platform (mặc định facebook)")
    posted_at: Optional[str] = Field(None, description="Thời gian đăng bài (ISO format)")


class FbPostKpiSaveResponse(BaseModel):
    """Response cho việc lưu KPI bài viết."""
    id: str
    id_member: str
    id_leader: str
    job_id: str
    post_url: Optional[str] = None
    posted_at: str
    message: str = "Saved"


class FbPostKpiSummaryRequest(BaseModel):
    """Schema để lấy tổng hợp KPI bài viết."""
    email: str = Field(..., min_length=3, description="Email member")
    start_date: str = Field("", description="YYYY-MM-DD")
    end_date: str = Field("", description="YYYY-MM-DD")


class FbPostKpiSummaryResponse(BaseModel):
    """Response tổng hợp KPI bài viết."""
    post_count: int = 0
    profile_count: int = 0
    group_count: int = 0
    page_count: int = 0
    posts: List[dict] = []
    range: dict = {}


class FbPostKpiListRequest(BaseModel):
    """Schema để lấy danh sách bài viết KPI."""
    email: str = Field(..., min_length=3, description="Email member")
    start_date: str = Field("", description="YYYY-MM-DD")
    end_date: str = Field("", description="YYYY-MM-DD")
    target_type: Optional[str] = Field(None, description="'profile' | 'group' | 'page'")
    limit: int = Field(100, description="Số lượng bài viết tối đa")
