"""Schemas for Crawl Exclude Keywords & Proposals feature."""

from __future__ import annotations

from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


class ExcludeKeywordCreate(BaseModel):
    keyword: str = Field(..., min_length=1, description="Từ khóa loại trừ")
    platform: Optional[str] = Field(None, description="Nền tảng áp dụng (facebook, linkedin, threads) hoặc None cho tất cả")
    status: str = Field("active", description="active hoặc inactive")


class ExcludeKeywordUpdate(BaseModel):
    keyword: Optional[str] = None
    platform: Optional[str] = None
    status: Optional[str] = None


class ExcludeKeywordResponse(BaseModel):
    id: str
    keyword: str
    platform: Optional[str] = None
    status: str
    created_by: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class KeywordProposalCreate(BaseModel):
    keyword: str = Field(..., min_length=1, description="Từ khóa đề xuất loại trừ")
    reason: Optional[str] = Field(None, description="Lý do đề xuất")
    source_post_id: Optional[str] = Field(None, description="ID bài viết nguồn phát hiện từ khóa")
    platform: Optional[str] = Field(None, description="Nền tảng của bài viết nguồn")


class KeywordProposalReject(BaseModel):
    reason: Optional[str] = Field(None, description="Lý do từ chối đề xuất")


class BulkApproveProposalRequest(BaseModel):
    proposal_ids: list[str] = Field(..., min_length=1, description="Danh sách ID đề xuất cần duyệt hàng loạt")


class KeywordProposalResponse(BaseModel):
    id: str
    keyword: str
    reason: Optional[str] = None
    source_post_id: Optional[str] = None
    platform: Optional[str] = None
    status: str
    proposed_by: Optional[str] = None
    reviewed_by: Optional[str] = None
    reviewed_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

