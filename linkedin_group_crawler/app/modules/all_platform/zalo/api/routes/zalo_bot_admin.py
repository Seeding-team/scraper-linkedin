"""API cho giao diện quản lý Bot Zalo: cấu hình, tiếp quản/bật lại bot theo hội thoại, nhật ký, thống kê.

Khác `zalo_bot_bridge.py` (endpoint cho n8n, bảo vệ bằng secret dùng chung), router này dành cho người
dùng đăng nhập trong app (JWT) + `verify_zalo_api_key` như các route Zalo khác.

Phân quyền (hai tầng, khớp quy tắc chung của module Zalo):
  * Quản lý bot của CẢ tài khoản — sửa cấu hình, phạm vi theo người, thống kê tổng: admin, leader hoặc
    chủ tài khoản (`_require_manage` -> `_require_admin_leader_or_self`, như sửa/xoá tài khoản Zalo).
  * Theo hội thoại — xem cấu hình (chỉ đọc, kèm cờ `can_manage`), trạng thái/tiếp quản/bật lại bot,
    nhật ký: người có quyền truy cập hội thoại đó (`_require_view` -> `check_caller_conversation_access`,
    cùng quy tắc xem/gửi tin). Nhật ký chỉ trả các hội thoại người gọi được xem.
"""

from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.modules.all_platform.auth_deps import get_authenticated_caller_email
from app.modules.all_platform.zalo.api.routes.accounts import _require_admin_leader_or_self
from app.modules.all_platform.zalo.api.routes.conversations import check_caller_conversation_access
from app.modules.all_platform.zalo.api.security import verify_zalo_api_key
from app.modules.all_platform.zalo.services import zalo_bot_service as bot
from app.modules.all_platform.zalo.services.supabase_service import SupabaseNotConfigured, get_zalo_account_by_id

router = APIRouter(
    prefix="/zalo-bot",
    tags=["zalo-bot-admin"],
    dependencies=[Depends(verify_zalo_api_key)],
)


class BotConfigPatch(BaseModel):
    is_enabled: Optional[bool] = None
    dry_run: Optional[bool] = None
    chatwoot_account_id: Optional[int] = Field(default=None, ge=1)
    chatwoot_inbox_id: Optional[int] = Field(default=None, ge=1)
    auto_pause_on_staff_reply: Optional[bool] = None
    pause_minutes: Optional[int] = Field(default=None, ge=0, le=1440)
    chatwoot_sync: Optional[bool] = None
    scope_mode: Optional[Literal["all", "selected"]] = None
    batch_wait_seconds: Optional[int] = Field(default=None, ge=0, le=bot.MAX_BATCH_WAIT_S)


class RulesBody(BaseModel):
    """bot_on: True = bật bot cho những người này, False = tắt, null = bỏ rule (về mặc định của phạm vi)."""
    thread_ids: List[str] = Field(min_length=1, max_length=bot.MAX_RULE_BATCH)
    bot_on: Optional[bool] = None


class ThreadRuleBody(BaseModel):
    bot_on: Optional[bool] = None


class TakeoverBody(BaseModel):
    minutes: Optional[int] = Field(default=None, ge=0, le=1440)


def _require_login(caller_email: Optional[str]) -> str:
    if not caller_email:
        raise HTTPException(status_code=401, detail="Cần đăng nhập để dùng tính năng Bot Zalo")
    return caller_email


async def _account_or_404(account_id: str) -> Dict[str, Any]:
    account = await get_zalo_account_by_id(account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Không tìm thấy tài khoản Zalo")
    return account


MANAGE_DENIED_DETAIL = (
    "Chỉ admin, leader hoặc chủ tài khoản Zalo mới được quản lý Bot AI của tài khoản này."
)


async def _can_manage(caller_email: Optional[str], account: Dict[str, Any]) -> bool:
    """True nếu người gọi là admin/leader/chủ tài khoản (không ném lỗi — dùng để báo cho giao diện)."""
    try:
        await _require_admin_leader_or_self(caller_email, account.get("id_member") or account.get("owner_id"))
        return True
    except HTTPException as exc:
        if exc.status_code in (401, 403):
            return False
        raise


async def _require_manage(caller_email: Optional[str], account_id: str) -> None:
    """Quyền quản lý bot của CẢ tài khoản (cấu hình, phạm vi, thống kê tổng): cùng quy tắc sửa tài khoản Zalo."""
    account = await _account_or_404(account_id)
    if not await _can_manage(caller_email, account):
        raise HTTPException(status_code=403, detail=MANAGE_DENIED_DETAIL)


async def _require_view(
    caller_email: Optional[str], account_id: str, thread_id: Optional[str] = None,
) -> Optional[set]:
    """Quyền theo hội thoại (cùng quy tắc xem/gửi tin).

    Trả về None nếu được xem toàn bộ hội thoại của tài khoản, hoặc tập thread_id được chia sẻ cho người gọi.
    """
    _require_login(caller_email)
    await _account_or_404(account_id)
    allowed = await check_caller_conversation_access(account_id, caller_email)
    if thread_id is not None and allowed is not None and thread_id.strip() not in allowed:
        raise HTTPException(
            status_code=403,
            detail="Cuộc trò chuyện này ở chế độ riêng tư và chưa được chia sẻ với bạn.",
        )
    return allowed


def _db_error(exc: Exception) -> HTTPException:
    if isinstance(exc, SupabaseNotConfigured):
        return HTTPException(status_code=503, detail=str(exc))
    return HTTPException(status_code=500, detail=f"Lỗi Bot Zalo: {exc}")


@router.get("/runtime")
async def get_runtime(caller_email: Optional[str] = Depends(get_authenticated_caller_email)):
    _require_login(caller_email)
    return bot.runtime_flags()


@router.get("/configs")
async def get_configs(
    account_ids: str = Query("", description="Danh sách account_id, ngăn cách bằng dấu phẩy"),
    caller_email: Optional[str] = Depends(get_authenticated_caller_email),
):
    _require_login(caller_email)
    try:
        ids: List[str] = [a for a in account_ids.split(",") if a.strip()]
        return {"configs": await bot.get_configs_brief(ids)}
    except Exception as exc:
        raise _db_error(exc)


@router.get("/config/{account_id}")
async def get_config(account_id: str, caller_email: Optional[str] = Depends(get_authenticated_caller_email)):
    await _require_view(caller_email, account_id)
    try:
        view = await bot.build_config_view(account_id)
        # Giao diện dựa vào cờ này để khoá các ô sửa + ẩn thống kê cho người chỉ có quyền xem.
        view["can_manage"] = await _can_manage(caller_email, await _account_or_404(account_id))
        return view
    except HTTPException:
        raise
    except Exception as exc:
        raise _db_error(exc)


@router.put("/config/{account_id}")
async def put_config(
    account_id: str,
    body: BotConfigPatch,
    caller_email: Optional[str] = Depends(get_authenticated_caller_email),
):
    await _require_manage(caller_email, account_id)
    patch = body.model_dump(exclude_unset=True)
    try:
        return await bot.upsert_config(account_id, patch, caller_email)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except HTTPException:
        raise
    except Exception as exc:
        raise _db_error(exc)


# ── Phạm vi bật bot theo người ─────────────────────────────────────────────

@router.get("/scope/{account_id}")
async def get_scope(account_id: str, caller_email: Optional[str] = Depends(get_authenticated_caller_email)):
    """Chế độ phạm vi + danh sách người đã đặt rule (kèm tên)."""
    await _require_manage(caller_email, account_id)
    try:
        cfg = bot.normalize_config(await bot.get_config_row(account_id))
        rules = await bot.get_rules(account_id)
        names = await bot._thread_names(account_id, list(rules.keys())[:500])
        items = [
            {"thread_id": t, "name": names.get(t) or t, "bot_on": on}
            for t, on in rules.items()
        ]
        items.sort(key=lambda x: (not x["bot_on"], x["name"].lower()))
        return {
            "scope_mode": cfg["scope_mode"],
            "on_count": sum(1 for i in items if i["bot_on"]),
            "off_count": sum(1 for i in items if not i["bot_on"]),
            "rules": items,
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise _db_error(exc)


@router.get("/scope/{account_id}/candidates")
async def get_scope_candidates(
    account_id: str,
    q: Optional[str] = Query(None, max_length=80),
    limit: int = Query(50, ge=1, le=200),
    caller_email: Optional[str] = Depends(get_authenticated_caller_email),
):
    """Hội thoại 1-1 của tài khoản (tìm theo tên) để chọn bật/tắt bot."""
    await _require_manage(caller_email, account_id)
    try:
        return {"items": await bot.list_scope_candidates(account_id, q, limit)}
    except HTTPException:
        raise
    except Exception as exc:
        raise _db_error(exc)


@router.post("/scope/{account_id}/rules")
async def post_scope_rules(
    account_id: str, body: RulesBody, caller_email: Optional[str] = Depends(get_authenticated_caller_email),
):
    await _require_manage(caller_email, account_id)
    try:
        # chỉ nhận hội thoại 1-1 thật, tránh ghi rule rác cho nhóm/ID lạ
        valid = await bot.direct_thread_ids(account_id, [t.strip() for t in body.thread_ids])
        ids = [t.strip() for t in body.thread_ids if t.strip() in valid]
        skipped = len(set(t.strip() for t in body.thread_ids if t.strip())) - len(set(ids))
        changed = await bot.set_rules(account_id, ids, body.bot_on, caller_email)
        return {"changed": changed, "skipped_not_direct": skipped}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except HTTPException:
        raise
    except Exception as exc:
        raise _db_error(exc)


@router.post("/scope/{account_id}/clear")
async def post_scope_clear(account_id: str, caller_email: Optional[str] = Depends(get_authenticated_caller_email)):
    """Xoá toàn bộ rule theo người (về đúng mặc định của chế độ phạm vi hiện tại)."""
    await _require_manage(caller_email, account_id)
    try:
        try:
            await bot.clear_all_rules(account_id)
        except RuntimeError as exc:
            bot._raise_if_scope_table_missing(exc)
            raise
        return {"ok": True}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except HTTPException:
        raise
    except Exception as exc:
        raise _db_error(exc)


@router.post("/threads/{account_id}/{thread_id}/rule")
async def post_thread_rule(
    account_id: str, thread_id: str, body: ThreadRuleBody,
    caller_email: Optional[str] = Depends(get_authenticated_caller_email),
):
    """Bật/tắt bot cho riêng một hội thoại (người có quyền truy cập hội thoại đó)."""
    await _require_view(caller_email, account_id, thread_id)
    thread_id = thread_id.strip()
    try:
        if not await bot.direct_thread_ids(account_id, [thread_id]):
            raise HTTPException(status_code=409, detail="Bot chỉ áp dụng cho hội thoại 1-1")
        await bot.set_rules(account_id, [thread_id], body.bot_on, caller_email)
        return await bot.thread_status(account_id, thread_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except HTTPException:
        raise
    except Exception as exc:
        raise _db_error(exc)


@router.get("/threads/{account_id}/paused")
async def get_paused_threads(account_id: str, caller_email: Optional[str] = Depends(get_authenticated_caller_email)):
    await _require_view(caller_email, account_id)
    try:
        return {"paused_thread_ids": await bot.list_paused_thread_ids(account_id)}
    except Exception as exc:
        raise _db_error(exc)


@router.get("/threads/{account_id}/{thread_id}/status")
async def get_thread_status(
    account_id: str, thread_id: str, caller_email: Optional[str] = Depends(get_authenticated_caller_email),
):
    await _require_view(caller_email, account_id, thread_id)
    try:
        return await bot.thread_status(account_id, thread_id.strip())
    except Exception as exc:
        raise _db_error(exc)


async def _enabled_config_or_409(account_id: str, thread_id: str) -> Dict[str, Any]:
    row = await bot.get_config_row(account_id)
    if not row or not row.get("is_enabled"):
        raise HTTPException(status_code=409, detail="Bot chưa được bật cho tài khoản này")
    if not await bot.direct_thread_ids(account_id, [thread_id]):
        raise HTTPException(status_code=409, detail="Bot chỉ áp dụng cho hội thoại 1-1")
    return {**bot.normalize_config(row), "account_id": account_id}


@router.post("/threads/{account_id}/{thread_id}/takeover")
async def takeover_thread(
    account_id: str, thread_id: str, body: Optional[TakeoverBody] = None,
    caller_email: Optional[str] = Depends(get_authenticated_caller_email),
):
    await _require_view(caller_email, account_id, thread_id)
    thread_id = thread_id.strip()
    try:
        cfg = await _enabled_config_or_409(account_id, thread_id)
        minutes = (body.minutes if body else None) or None  # None/0 = đến khi bấm "Bật lại bot"
        await bot.set_pause(cfg, thread_id, minutes=minutes, reason="manual", by=caller_email)
        return await bot.thread_status(account_id, thread_id)
    except HTTPException:
        raise
    except Exception as exc:
        raise _db_error(exc)


@router.post("/threads/{account_id}/{thread_id}/resume")
async def resume_thread(
    account_id: str, thread_id: str, caller_email: Optional[str] = Depends(get_authenticated_caller_email),
):
    await _require_view(caller_email, account_id, thread_id)
    thread_id = thread_id.strip()
    try:
        cfg = await _enabled_config_or_409(account_id, thread_id)
        await bot.clear_pause(cfg, thread_id, by=caller_email)
        return await bot.thread_status(account_id, thread_id)
    except HTTPException:
        raise
    except Exception as exc:
        raise _db_error(exc)


@router.get("/logs")
async def get_logs(
    account_id: str = Query(...),
    thread_id: Optional[str] = Query(None),
    direction: Optional[str] = Query(None, pattern="^(in|out)$"),
    status: Optional[str] = Query(None),
    q: Optional[str] = Query(None, max_length=80),
    limit: int = Query(50, ge=1, le=200),
    before_id: Optional[int] = Query(None, ge=1),
    caller_email: Optional[str] = Depends(get_authenticated_caller_email),
):
    # Nhật ký chứa nội dung tin của khách -> theo quyền xem hội thoại, không cần quyền quản lý:
    # người được xem toàn bộ thấy tất cả; người chỉ được chia sẻ một số hội thoại chỉ thấy các hội thoại đó.
    allowed = await _require_view(caller_email, account_id, thread_id)
    try:
        return await bot.list_logs(
            account_id, thread_id=thread_id, direction=direction, status=status, q=q,
            limit=limit, before_id=before_id, allowed_thread_ids=allowed,
        )
    except Exception as exc:
        raise _db_error(exc)


@router.get("/stats")
async def get_stats(
    account_id: str = Query(...),
    days: int = Query(7, ge=1, le=90),
    caller_email: Optional[str] = Depends(get_authenticated_caller_email),
):
    await _require_manage(caller_email, account_id)
    try:
        return await bot.get_stats(account_id, days)
    except Exception as exc:
        raise _db_error(exc)
