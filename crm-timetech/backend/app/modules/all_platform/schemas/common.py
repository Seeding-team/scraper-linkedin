"""Shared response schemas for all-platform module."""

from __future__ import annotations

from pydantic import BaseModel
from typing import Any


class BaseResponse(BaseModel):
    success: bool = True
    message: str = ""
    data: Any = None
