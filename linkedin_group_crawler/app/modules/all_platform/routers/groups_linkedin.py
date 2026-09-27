"""Groups endpoints — platform-specific LinkedIn."""

from __future__ import annotations

from fastapi import APIRouter, Query, Header, Request, HTTPException

from app.core.supabase_client import get_supabase_client
from app.modules.all_platform.schemas import BaseResponse
from app.modules.all_platform.services import (
    get_linkedin_groups,
    add_linkedin_group,
    update_linkedin_group,
    delete_linkedin_group,
    decode_token,
    get_user_by_id,
)

def _get_user_from_header(authorization: str | None, request: Request | None = None) -> dict:
    """Extract and validate user from Bearer token or cookie."""
    if not authorization and request:
        cookie_token = request.cookies.get("crawlpro_access_token")
        if cookie_token:
            authorization = f"Bearer {cookie_token}"

    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid authorization header")
    token = authorization.split(" ")[1]
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

router = APIRouter()


@router.get("/groups")
def li_groups_get_all(
    request: Request,
    status: str | None = Query(None),
    for_extension: bool = Query(False),
    authorization: str | None = Header(None),
) -> BaseResponse:
    """Get all LinkedIn groups."""
    try:
        user = _get_user_from_header(authorization, request)
        # for_extension: giống /facebook/groups — extension chỉ cào nhóm của CHÍNH người dùng
        # (bài lưu về gắn id_member của họ), kể cả admin/leader.
        if for_extension:
            id_member = user["id"]
        else:
            id_member = None if user.get("role") in ("admin", "leader") else user["id"]
        data = get_linkedin_groups(status=status, id_member=id_member)
        return BaseResponse(success=True, data=data)
    except HTTPException as e:
        return BaseResponse(success=False, message=e.detail)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.post("/groups/add")
def li_groups_add(
    payload: dict,
    request: Request,
    authorization: str | None = Header(None),
) -> BaseResponse:
    """Add a new LinkedIn group."""
    try:
        import traceback
        print(f"li_groups_add received payload: {payload}")
        user = _get_user_from_header(authorization, request)
        if user.get("role") != "admin":
            payload["id_member"] = user["id"]
        elif "id_member" not in payload or not payload["id_member"]:
            payload["id_member"] = user["id"]
        print(f"li_groups_add enriched payload: {payload}")
        data = add_linkedin_group(payload)
        print(f"li_groups_add success, data: {data}")
        return BaseResponse(success=True, message="Group added", data=data)
    except HTTPException as e:
        print(f"li_groups_add HTTPException: {e.detail}")
        return BaseResponse(success=False, message=e.detail)
    except Exception as e:
        print(f"li_groups_add Exception: {e}")
        traceback.print_exc()
        return BaseResponse(success=False, message=str(e))


@router.put("/groups/update")
def li_groups_update(
    payload: dict,
    request: Request,
    authorization: str | None = Header(None),
) -> BaseResponse:
    """Update an existing LinkedIn group."""
    try:
        user = _get_user_from_header(authorization, request)
        group_id = payload.get("id")
        if not group_id:
            return BaseResponse(success=False, message="id is required")
        if user.get("role") not in ("admin", "leader"):
            # Verify ownership
            supabase = get_supabase_client()
            group_res = supabase.table("linkedin_groups").select("id_member").eq("id", group_id).execute()
            if not group_res.data or group_res.data[0].get("id_member") != user["id"]:
                return BaseResponse(success=False, message="You do not have permission to update this group.")
            payload["id_member"] = user["id"]
        data = update_linkedin_group(group_id, payload)
        return BaseResponse(success=True, message="Group updated", data=data)
    except HTTPException as e:
        return BaseResponse(success=False, message=e.detail)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


@router.delete("/groups/delete")
def li_groups_delete(
    request: Request,
    id: str = Query(...),
    authorization: str | None = Header(None),
) -> BaseResponse:
    """Delete a LinkedIn group."""
    try:
        user = _get_user_from_header(authorization, request)
        if user.get("role") not in ("admin", "leader"):
            # Verify ownership
            supabase = get_supabase_client()
            group_res = supabase.table("linkedin_groups").select("id_member").eq("id", id).execute()
            if not group_res.data or group_res.data[0].get("id_member") != user["id"]:
                return BaseResponse(success=False, message="You do not have permission to delete this group.")
        data = delete_linkedin_group(id)
        return BaseResponse(success=True, message="Group deleted", data=data)
    except HTTPException as e:
        return BaseResponse(success=False, message=e.detail)
    except Exception as e:
        return BaseResponse(success=False, message=str(e))


# Alias for import
linkedin_groups_router = router
