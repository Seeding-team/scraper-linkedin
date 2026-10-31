"""Keywords Library endpoints for All-Platform module."""

from __future__ import annotations

from typing import Any
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.modules.all_platform.auth_deps import get_current_user
from app.modules.all_platform.schemas import BaseResponse
from app.modules.all_platform.services.supabase_keywords_library_service import (
    get_keyword_topics,
    get_keywords_by_topic,
    create_keyword_topic,
    add_keywords_to_topic,
    delete_keyword,
    delete_topic,
)

router = APIRouter()


class CreateTopicRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=150)
    description: str | None = Field(default="", max_length=500)
    initial_keywords: list[str] = Field(default_factory=list)


class AddKeywordsRequest(BaseModel):
    keywords: list[str] = Field(..., min_length=1)


@router.get("/topics")
def list_topics(_user: dict[str, Any] = Depends(get_current_user)) -> BaseResponse:
    """Get all keyword topics with creator info and item count."""
    try:
        data = get_keyword_topics()
        return BaseResponse(success=True, data=data)
    except Exception as exc:
        return BaseResponse(success=False, message=str(exc))


@router.post("/topics")
def create_topic(
    payload: CreateTopicRequest,
    user: dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    """Create a new keyword topic."""
    try:
        user_id = str(user.get("id") or "")
        data = create_keyword_topic(
            name=payload.name,
            description=payload.description,
            user_id=user_id,
            initial_keywords=payload.initial_keywords,
        )
        return BaseResponse(success=True, message="Đã tạo chủ đề từ khóa thành công", data=data)
    except HTTPException:
        raise
    except Exception as exc:
        return BaseResponse(success=False, message=str(exc))


@router.delete("/topics/{topic_id}")
def remove_topic(
    topic_id: str,
    user: dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    """Delete a keyword topic and all its keywords."""
    try:
        user_id = str(user.get("id") or "")
        is_admin = user.get("role") in ["admin", "superadmin", "leader"]
        data = delete_topic(topic_id, user_id=user_id, is_admin=is_admin)
        return BaseResponse(success=True, message="Đã xóa chủ đề từ khóa", data=data)
    except HTTPException:
        raise
    except Exception as exc:
        return BaseResponse(success=False, message=str(exc))


@router.get("/topics/{topic_id}/keywords")
def list_keywords_in_topic(
    topic_id: str,
    _user: dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    """Get all keywords in a topic."""
    try:
        data = get_keywords_by_topic(topic_id)
        return BaseResponse(success=True, data=data)
    except Exception as exc:
        return BaseResponse(success=False, message=str(exc))


@router.post("/topics/{topic_id}/keywords")
def add_keywords(
    topic_id: str,
    payload: AddKeywordsRequest,
    user: dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    """Add or contribute keywords to a topic."""
    try:
        user_id = str(user.get("id") or "")
        data = add_keywords_to_topic(topic_id, payload.keywords, user_id=user_id)
        return BaseResponse(
            success=True,
            message=f"Đã thêm thành công {data.get('added_count', 0)} từ khóa vào chủ đề",
            data=data,
        )
    except HTTPException:
        raise
    except Exception as exc:
        return BaseResponse(success=False, message=str(exc))


@router.delete("/keywords/{keyword_id}")
def remove_keyword(
    keyword_id: str,
    user: dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    """Delete a keyword item."""
    try:
        user_id = str(user.get("id") or "")
        is_admin = user.get("role") in ["admin", "superadmin", "leader"]
        data = delete_keyword(keyword_id, user_id=user_id, is_admin=is_admin)
        return BaseResponse(success=True, message="Đã xóa từ khóa", data=data)
    except HTTPException:
        raise
    except Exception as exc:
        return BaseResponse(success=False, message=str(exc))
