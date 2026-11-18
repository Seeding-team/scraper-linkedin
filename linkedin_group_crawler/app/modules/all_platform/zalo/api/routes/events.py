"""SSE endpoint cho Zalo realtime messages.

GET ``/api/zalo/events/stream``
    * ``user_id`` (query, bắt buộc) — id người gọi (Supabase user id hoặc tự sinh).
    * ``email``   (query, khuyến nghị) — email để tra role từ ``public.app_users``.
    * ``role``    (query, tuỳ chọn) — ghi đè role (hữu ích cho test). Mặc định
      sẽ lookup từ ``app_users``.

    Response: ``text/event-stream`` với event ``zalo-message`` (data là JSON) và
    event ``heartbeat`` mỗi 20s.

    Vì EventSource của browser không cho phép custom header, ta truyền identity
    qua query string. Backend vẫn require ``verify_zalo_api_key`` (qua header /
    query ``api_key`` / ``x-api-key``) để đảm bảo không public.
"""

from __future__ import annotations

import asyncio
import json
import re
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from loguru import logger
from pydantic import BaseModel

from app.modules.all_platform.auth_deps import get_authenticated_caller_email
from app.modules.all_platform.zalo.api.security import verify_zalo_api_key
from app.modules.all_platform.zalo.services.message_events import (
    register_account_owner,
    register_shared_with_all,
    subscribe_zalo_events,
)
from app.modules.all_platform.zalo.services.supabase_service import (
    get_app_user_id_by_email,
    get_team_member_ids,
    get_user_role,
    list_shared_conversation_ids,
    list_zalo_accounts,
)


router = APIRouter(
    prefix="/events",
    tags=["zalo-events"],
    dependencies=[Depends(verify_zalo_api_key)],
)


def _normalize_user_id(value: Optional[str]) -> str:
    raw = (value or "default").strip().lower()
    raw = re.sub(r"[^a-z0-9._-]+", "-", raw).strip("-._")
    return raw or "default"


def _normalize_email(value: Optional[str]) -> str:
    return (value or "").strip().lower()


async def _resolve_accounts_for_caller(
    caller_user_id: str,
    caller_email: str,
    role: str,
) -> List[Dict[str, Any]]:
    """Trả về list account mà caller được subscribe realtime.

    Rules:
        * ``admin``        → tất cả accounts.
        * ``leader``       → accounts của các member trong team leader quản lý.
        * còn lại (member) → chỉ accounts do caller sở hữu (match ``owner_id``).
    """
    role = (role or "").strip().lower() or "member"
    if role == "admin":
        return await list_zalo_accounts()

    if role == "leader":
        leader_id = await get_app_user_id_by_email(caller_email)
        if not leader_id:
            return []
        member_ids = await get_team_member_ids(leader_id)
        # Leader thấy accounts do chính mình, các member trong team sở hữu (cả id_member lẫn owner_id),
        # VÀ các account is_shared_with_all=true.
        owner_ids = list({leader_id, *(member_ids or [])})
        accounts: List[Dict[str, Any]] = []
        accounts.extend(await list_zalo_accounts(id_member=owner_ids))
        for oid in owner_ids:
            accounts.extend(await list_zalo_accounts(owner_id=oid))
        # Dedup theo account_id.
        seen: set[str] = set()
        unique: List[Dict[str, Any]] = []
        for acc in accounts:
            aid = str(acc.get("account_id") or "").strip()
            if aid and aid not in seen:
                seen.add(aid)
                unique.append(acc)
        return unique

    # Member/staff: accounts do chính caller sở hữu + tài khoản dùng chung is_shared_with_all=true.
    resolved_uuid: Optional[str] = None
    if caller_email:
        resolved_uuid = await get_app_user_id_by_email(caller_email)
    elif caller_user_id and not caller_user_id.startswith("zl_"):
        resolved_uuid = await get_app_user_id_by_email(caller_user_id)

    member_uuid = resolved_uuid or caller_user_id
    accounts_list: List[Dict[str, Any]] = []
    if member_uuid and not member_uuid.startswith("zl_"):
        accounts_list.extend(await list_zalo_accounts(id_member=member_uuid))
        accounts_list.extend(await list_zalo_accounts(owner_id=member_uuid))
    elif caller_user_id and caller_user_id.startswith("zl_"):
        from app.modules.all_platform.zalo.services.supabase_service import get_zalo_account_by_id
        acc = await get_zalo_account_by_id(caller_user_id)
        if acc:
            acc_owner = str(acc.get("id_member") or acc.get("owner_id") or "").strip()
            if bool(acc.get("is_shared_with_all")) or (resolved_uuid and acc_owner == resolved_uuid) or not caller_email:
                accounts_list.append(acc)

    seen_member: set[str] = set()
    unique_member: List[Dict[str, Any]] = []
    for acc in accounts_list:
        aid = str(acc.get("account_id") or "").strip()
        if aid and aid not in seen_member:
            seen_member.add(aid)
            unique_member.append(acc)
    return unique_member


@router.get("/stream")
async def stream_zalo_events(
    request: Request,
    user_id: Optional[str] = Query(None, description="Caller user_id (fallback nếu không có email)"),
    authenticated_email: Optional[str] = Depends(get_authenticated_caller_email),
):
    """SSE stream các Zalo message mới mà caller có quyền xem.

    Cleanup: khi client disconnect (đóng tab / mất mạng), generator dừng
    và tự gỡ queue khỏi event bus.

    Trước đây `email`/`role` là query param client tự truyền — `?role=admin`
    là tự phong admin ngay trên URL (comment cũ ghi "chỉ dùng cho test nội bộ"
    nhưng không hề bị chặn trên production). EventSource của browser không set
    được custom header, nhưng VẪN tự gửi cookie như request HTTP thường, nên
    lấy identity từ JWT cookie qua get_authenticated_caller_email() hoạt động
    bình thường mà không cần đổi gì phía FE.
    """
    caller_id = _normalize_user_id(user_id)
    caller_email = _normalize_email(authenticated_email)

    # Role LUÔN tra từ DB theo email đã xác thực — không còn override từ client.
    caller_role = await get_user_role(caller_email) if caller_email else "member"

    accounts = await _resolve_accounts_for_caller(caller_id, caller_email, caller_role)
    account_ids: List[str] = [
        str(acc.get("account_id") or "").strip()
        for acc in accounts
        if str(acc.get("account_id") or "").strip()
    ]

    # Cache ownership & cờ dùng chung toàn công ty để can_view_account() filter nhanh (0 DB query).
    for acc in accounts:
        owner_id = str(acc.get("id_member") or acc.get("owner_id") or "").strip()
        aid = str(acc.get("account_id") or "").strip()
        if aid:
            register_shared_with_all(aid, bool(acc.get("is_shared_with_all")))
            if owner_id:
                register_account_owner(aid, owner_id)

    # Preload share set cho từng account (chỉ leader mới cần lọc share; admin xem toàn bộ).
    shared_by_account: Dict[str, set[str]] = {}
    if caller_role == "leader":
        shared_results = await asyncio.gather(
            *(list_shared_conversation_ids(aid) for aid in account_ids),
            return_exceptions=True,
        )
        for aid, sres in zip(account_ids, shared_results):
            shared_by_account[aid] = sres if isinstance(sres, set) else set()
    else:
        for aid in account_ids:
            shared_by_account[aid] = set()

    logger.info(
        f"SSE stream open caller_id={caller_id} role={caller_role} "
        f"accounts={len(account_ids)} email={caller_email or '-'}"
    )

    # Trả về metadata cho FE biết đã subscribe những account nào + share map.
    initial_meta = {
        "type": "stream_ready",
        "caller_id": caller_id,
        "role": caller_role,
        "email": caller_email,
        "account_ids": account_ids,
        "shared": {aid: sorted(list(sids)) for aid, sids in shared_by_account.items()},
    }

    async def event_gen():
        yield f"event: ready\ndata: {json.dumps(initial_meta, ensure_ascii=False)}\n\n"
        try:
            caller_app_id = (
                await get_app_user_id_by_email(caller_email) if caller_email else None
            )
            # Pre-compute owned/team/shared-all account_id set để filter nhanh cho leader.
            owned_or_team_ids: set[str] = set()
            if caller_role == "admin":
                owned_or_team_ids = set(account_ids)
            elif caller_role == "leader":
                owner_set: set[str] = set()
                if caller_app_id:
                    team_ids = await get_team_member_ids(caller_app_id) or []
                    owner_set = {caller_app_id, *team_ids}
                for acc in accounts:
                    aid = str(acc.get("account_id") or "").strip()
                    if not aid:
                        continue
                    acc_owner = str(acc.get("owner_id") or "").strip()
                    acc_member = str(acc.get("id_member") or "").strip()
                    if (
                        bool(acc.get("is_shared_with_all"))
                        or (acc_owner and acc_owner in owner_set)
                        or (acc_member and acc_member in owner_set)
                    ):
                        owned_or_team_ids.add(aid)
            else:
                owned_or_team_ids = set(account_ids)

            async for event in subscribe_zalo_events(
                account_ids,
                role=caller_role,
                email=caller_email,
                caller_id=caller_app_id or caller_id,
            ):
                if await request.is_disconnected():
                    break
                # Admin và Member/staff: pass through ngay (admin toàn quyền, member đã lọc ở subscribe).
                if caller_role != "leader":
                    yield event
                    continue
                # Leader: nhận nếu thuộc account team/của mình/shared_with_all hoặc hội thoại đã share.
                try:
                    payload = json.loads(event.split("data: ", 1)[1].rstrip("\n"))
                except Exception:
                    yield event
                    continue
                group_id = str(payload.get("group_id") or "").strip()
                account_id = str(payload.get("account_id") or "").strip()
                if not group_id or not account_id:
                    yield event
                    continue
                if account_id in owned_or_team_ids:
                    yield event
                    continue
                allowed = shared_by_account.get(account_id) or set()
                if group_id in allowed:
                    yield event
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning(f"SSE stream error for caller={caller_id}: {exc}")
            yield f"event: error\ndata: {json.dumps({'detail': str(exc)})}\n\n"

    response = StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # tắt buffering của nginx proxy
        },
    )
    return response


# ----------------------------------------------------------------------------
# REST: bật/tắt share conversation (UI gọi)
# ----------------------------------------------------------------------------

class ShareConversationRequest(BaseModel):  # type: ignore[misc]
    account_id: str
    conversation_id: str
    shared: bool
    shared_role: str = "admin"


@router.post("/share")
async def set_share_conversation(body: ShareConversationRequest):
    """Bật/tắt share conversation với admin/leader. Body JSON.

    Chỉ owner của account mới có quyền gọi (xác thực qua ``X-User-ID`` /
    ``?user_id=``). Endpoint không cần auth role — chính staff tự quyết định.
    """
    from app.modules.all_platform.zalo.services.supabase_service import set_conversation_share

    account_id = (body.account_id or "").strip()
    conversation_id = (body.conversation_id or "").strip()
    if not account_id or not conversation_id:
        raise HTTPException(400, "account_id and conversation_id are required")

    role = (body.shared_role or "admin").strip().lower() or "admin"
    if role not in ("admin", "leader"):
        raise HTTPException(400, "shared_role must be 'admin' or 'leader'")

    await set_conversation_share(
        account_id,
        conversation_id,
        shared=bool(body.shared),
        shared_role=role,
    )
    return {
        "ok": True,
        "account_id": account_id,
        "conversation_id": conversation_id,
        "shared_role": role,
        "shared": bool(body.shared),
    }


@router.get("/share-status")
async def get_share_status(
    account_id: str = Query(...),
    conversation_id: str = Query(...),
):
    """Trả về dict ``{admin: bool, leader: bool}`` cho 1 conversation."""
    from app.modules.all_platform.zalo.services.supabase_service import (
        get_conversation_share_status,
    )

    return await get_conversation_share_status(account_id, conversation_id)


@router.post("/test-publish")
async def test_publish_event(
    account_id: str = Query(...),
    sender_name: str = Query("Test Sender"),
    message_text: str = Query("Hello from test"),
    conversation_id: str = Query("test-conv-001"),
):
    """Debug-only endpoint to publish a fake Zalo message event for SSE latency testing."""
    from app.modules.all_platform.zalo.services.message_events import (
        publish_zalo_message_event,
        register_account_owner,
    )

    # Auto-register owner for permission filter if not yet registered
    register_account_owner(account_id, "test-caller")

    event = {
        "type": "new_messages",
        "account_id": account_id,
        "group_id": conversation_id,
        "group_name": "Test Conversation",
        "messages": [
            {
                "message_id": f"test-{int(__import__('time').time() * 1000)}",
                "sender_id": "test-sender-id",
                "sender_name": sender_name,
                "timestamp": int(__import__('time').time() * 1000),
                "content": message_text,
                "type": "text",
                "is_sent": False,
                "group_id": conversation_id,
            }
        ],
    }
    delivered = await publish_zalo_message_event(account_id, event)
    return {"ok": True, "delivered": delivered, "event_size_bytes": len(__import__('json').dumps(event))}
