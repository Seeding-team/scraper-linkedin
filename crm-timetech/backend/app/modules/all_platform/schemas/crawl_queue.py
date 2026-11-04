"""Schemas cho hàng đợi job cào bài của các VPS worker (extension)."""

from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel


class EnqueueCrawlJobRequest(BaseModel):
    group_url: str
    group_name: Optional[str] = None
    group_id: Optional[str] = None
    id_member: Optional[str] = None
    keywords: Optional[List[str]] = None
    post_limit: Optional[int] = None
    platform: str = "facebook"


class HeartbeatRequest(BaseModel):
    worker_id: str
    worker_name: Optional[str] = None
    status: str = "idle"  # idle | busy


class JobResultRequest(BaseModel):
    job_id: str
    worker_id: str
    success: bool
    result_count: Optional[int] = None
    error_message: Optional[str] = None
