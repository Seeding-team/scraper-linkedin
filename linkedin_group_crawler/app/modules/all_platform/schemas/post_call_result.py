"""Pydantic schemas for Post Call Results."""

from __future__ import annotations

from typing import Optional
from pydantic import BaseModel, Field


class PostCallResultUpdate(BaseModel):
    result_code: str = Field(..., description="Mã kết quả liên hệ (từ categories call_result)")
    platform: Optional[str] = Field("facebook", description="Nền tảng (facebook, linkedin, threads)")

