"""Posts delete endpoints (All-Platform).

Currently used to remove a post from local crawl results so FE can
cào lại/loại bỏ bài không phù hợp.

DELETE /unified/posts/facebook
  - delete all matching facebook_posts rows (by post_url) OR single by id

Note: keep endpoint narrow; FE will pass id/post_url.
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Header, HTTPException

from app.modules.all_platform.schemas import BaseResponse
from app.core.supabase_client import get_supabase_client
from app.modules.all_platform.services import decode_token, get_user_by_id
from pydantic import BaseModel


router = APIRouter()


def _get_user_from_header(authorization: str | None, request=None) -> dict:
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing authorization header")
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid authorization header")
    token = authorization.split(" ", 1)[1]
    payload = decode_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")
    try:
        user = get_user_by_id(user_id)
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Auth service temporarily unavailable") from exc
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


class DeleteFacebookPostRequest(BaseModel):
    id: Optional[str] = None
    post_url: Optional[str] = None


@router.delete("/posts/facebook")
def delete_facebook_post(
    payload: DeleteFacebookPostRequest,
    authorization: str | None = Header(None),
):
    """Delete a Facebook post from Supabase (crawl result).

    FE can pass either:
      - id: uuid in facebook_posts
      - post_url: string URL
    """
    try:
        if not payload.id and not payload.post_url:
            raise HTTPException(status_code=400, detail="Missing id or post_url")

        user = _get_user_from_header(authorization, None)
        user_id = user.get("id")
        role = user.get("role")

        sb = get_supabase_client()
        q = sb.table("facebook_posts")

        # Scope by member unless admin/leader
        if role not in ("admin", "leader"):
            # keep consistent with other services: member can only delete own member posts
            q = q.eq("id_member", user_id)

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
    authorization: str | None = Header(None),
):
    """Xoá bài Threads (bảng threads_posts) — cùng quy tắc phân quyền với bài Facebook ở trên."""
    try:
        if not payload.id and not payload.post_url:
            raise HTTPException(status_code=400, detail="Missing id or post_url")

        user = _get_user_from_header(authorization, None)
        user_id = user.get("id")
        role = user.get("role")

        q = get_supabase_client().table("threads_posts").delete()
        if role not in ("admin", "leader"):
            q = q.eq("id_member", user_id)

        if payload.id:
            q.eq("id", payload.id).execute()
        else:
            q.eq("post_url", payload.post_url).execute()

        return BaseResponse(success=True, data={"deleted": True})
    except HTTPException as e:
        return BaseResponse(success=False, message=e.detail)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))
