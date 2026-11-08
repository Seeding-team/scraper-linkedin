"""Posts delete endpoints (All-Platform).

Currently used to remove a post from local crawl results so FE can
cào lại/loại bỏ bài không phù hợp.

DELETE /unified/posts/facebook
  - delete all matching facebook_posts rows (by post_url) OR single by id
DELETE /unified/posts/threads
  - delete all matching threads_posts rows
DELETE /unified/posts/youtube
  - delete all matching youtube_posts rows
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Request

from app.modules.all_platform.schemas import BaseResponse
from app.core.supabase_client import get_supabase_client
from app.modules.all_platform.services import decode_token, get_user_by_id
from pydantic import BaseModel


router = APIRouter()


def _get_user_from_header(authorization: str | None, request: Request | None = None) -> dict | None:
    # FE gửi token qua cookie (credentials: "include") hoặc header Authorization.
    if not authorization and request is not None:
        cookie_token = request.cookies.get("crawlpro_access_token")
        if cookie_token:
            authorization = f"Bearer {cookie_token}"
    if not authorization or not authorization.startswith("Bearer "):
        return None
    token = authorization.split(" ", 1)[1]
    payload = decode_token(token)
    if not payload:
        return None
    user_id = payload.get("sub")
    if not user_id:
        return None
    try:
        return get_user_by_id(user_id)
    except Exception:
        return None


class DeleteFacebookPostRequest(BaseModel):
    id: Optional[str] = None
    post_url: Optional[str] = None


@router.delete("/posts/facebook")
def delete_facebook_post(
    payload: DeleteFacebookPostRequest,
    request: Request,
    authorization: str | None = Header(None),
):
    """Delete a Facebook post from Supabase (crawl result).
    Tất cả các role (Admin, Leader, Member) đều có quyền xóa bài viết theo ID hoặc URL.
    """
    try:
        if not payload.id and not payload.post_url:
            raise HTTPException(status_code=400, detail="Missing id or post_url")

        sb = get_supabase_client()
        q = sb.table("facebook_posts")

        # Cho phép mọi role xóa bài viết theo yêu cầu Master
        if payload.id:
            q = q.delete().eq("id", payload.id).execute()
        else:
            q = q.delete().eq("post_url", payload.post_url).execute()

        return BaseResponse(success=True, data={"deleted": True})
    except HTTPException as e:
        return BaseResponse(success=False, message=e.detail)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.delete("/posts/threads")
def delete_threads_post(
    payload: DeleteFacebookPostRequest,
    request: Request,
    authorization: str | None = Header(None),
):
    """Xoá bài Threads (bảng threads_posts) — cho phép tất cả các role xóa theo yêu cầu Master."""
    try:
        if not payload.id and not payload.post_url:
            raise HTTPException(status_code=400, detail="Missing id or post_url")

        q = get_supabase_client().table("threads_posts").delete()

        if payload.id:
            q.eq("id", payload.id).execute()
        else:
            q.eq("post_url", payload.post_url).execute()

        return BaseResponse(success=True, data={"deleted": True})
    except HTTPException as e:
        return BaseResponse(success=False, message=e.detail)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.delete("/posts/youtube")
def delete_youtube_post(
    payload: DeleteFacebookPostRequest,
    request: Request,
    authorization: str | None = Header(None),
):
    """Xoá video YouTube (bảng youtube_posts) — cho phép tất cả các role xóa theo yêu cầu Master."""
    try:
        if not payload.id and not payload.post_url:
            raise HTTPException(status_code=400, detail="Missing id or post_url")

        q = get_supabase_client().table("youtube_posts").delete()

        if payload.id:
            q.eq("id", payload.id).execute()
        else:
            q.eq("post_url", payload.post_url).execute()

        return BaseResponse(success=True, data={"deleted": True})
    except HTTPException as e:
        return BaseResponse(success=False, message=e.detail)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))
