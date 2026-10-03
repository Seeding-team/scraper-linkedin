"""Platforms endpoint — read-only list for dropdowns."""

from __future__ import annotations

from fastapi import APIRouter

from app.modules.all_platform.schemas import BaseResponse
from app.modules.all_platform.services import get_all_platforms

router = APIRouter()


@router.get("")
def platforms_get_all() -> BaseResponse:
    """Get all active platforms."""
    try:
        data = get_all_platforms()
        return BaseResponse(success=True, data=data)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))
