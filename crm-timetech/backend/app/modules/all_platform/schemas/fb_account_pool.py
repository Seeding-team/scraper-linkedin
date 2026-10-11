"""Schemas cho API pool tài khoản Facebook seeding dùng cho VPS worker."""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel


class ReportAccountInvalidRequest(BaseModel):
    worker_id: str
    account_id: str
    error_message: Optional[str] = None
