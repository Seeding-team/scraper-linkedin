"""FastAPI REST Router for Omnichannel Inbox SLA Monitor & Zalo Group Alert Forwarding.

Mounted under ``/api/all-platform`` via ``all_platform_router``, exposing 14 endpoints
under ``/api/all-platform/sla-alerts/*``:
  - GET  /config/sla
  - PUT  /config/sla                         (Admin/Leader)
  - GET  /dashboard
  - GET  /turns
  - POST /turns/{turn_id}/dismiss            (Admin/Leader)
  - POST /backfill                           (Admin/Leader)
  - GET  /live-badges
  - GET  /forward-configs
  - GET  /forward-configs/zalo-groups
  - POST /forward-configs                    (Admin/Leader)
  - PATCH /forward-configs/{config_id}       (Admin/Leader)
  - DELETE /forward-configs/{config_id}      (Admin/Leader)
  - POST /forward-configs/{config_id}/test   (Admin/Leader)
  - GET  /forward-logs
"""

from __future__ import annotations

import asyncio
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from loguru import logger

from app.modules.all_platform.auth_deps import (
    get_authenticated_caller_email,
    get_current_user,
    require_admin_or_leader,
)
from app.modules.all_platform.schemas import BaseResponse
from app.modules.all_platform.sla_alerts.js_alert_engine_bridge import get_engine_status
from app.modules.all_platform.sla_alerts.schemas import (
    AlertForwardConfigCreate,
    AlertForwardConfigUpdate,
    SlaBackfillPayload,
    SlaConfigPayload,
    SlaTurnDismissPayload,
)
from app.modules.all_platform.sla_alerts.sla_tracker_service import (
    backfill_sla_history,
    dismiss_sla_turn,
    get_live_sla_badges,
    get_sla_configs,
    get_sla_dashboard,
    list_sla_turns,
    upsert_sla_config,
)
from app.modules.all_platform.sla_alerts.zalo_group_alert_service import (
    create_forward_config,
    delete_forward_config,
    list_alert_logs,
    list_available_zalo_groups_for_account,
    list_forward_configs,
    send_test_alert,
    update_forward_config,
)

router = APIRouter(prefix="/sla-alerts", tags=["inbox-sla-alerts"])


def _caller_email(user: Optional[Dict[str, Any]], fallback_email: Optional[str] = None) -> Optional[str]:
    if isinstance(user, dict) and user.get("email"):
        return str(user["email"]).strip().lower()
    if fallback_email:
        return str(fallback_email).strip().lower()
    return None


# ── SLA Config ───────────────────────────────────────────────────────────────

@router.get("/config/sla", response_model=BaseResponse)
async def get_sla_config_endpoint(
    _user: Dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    """Lấy cấu hình SLA toàn cục và các override theo kênh/tài khoản."""
    try:
        data = await asyncio.to_thread(get_sla_configs)
        return BaseResponse(success=True, data=data)
    except Exception as exc:
        logger.exception(f"[sla-alerts] GET /config/sla failed: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@router.put("/config/sla", response_model=BaseResponse)
async def put_sla_config_endpoint(
    payload: SlaConfigPayload,
    user: Dict[str, Any] = Depends(require_admin_or_leader),
    auth_email: Optional[str] = Depends(get_authenticated_caller_email),
) -> BaseResponse:
    """Cập nhật hoặc tạo mới cấu hình SLA (Admin/Leader)."""
    try:
        email = _caller_email(user, auth_email)
        updated = await asyncio.to_thread(upsert_sla_config, payload, email)
        return BaseResponse(success=True, data=updated, message="Đã cập nhật cấu hình SLA")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.exception(f"[sla-alerts] PUT /config/sla failed: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


# ── SLA Dashboard, Turns, Dismiss & Backfill ─────────────────────────────────

@router.get("/dashboard", response_model=BaseResponse)
async def get_sla_dashboard_endpoint(
    start_date: Optional[str] = Query(default=None, description="YYYY-MM-DD"),
    end_date: Optional[str] = Query(default=None, description="YYYY-MM-DD"),
    channel: str = Query(default="all"),
    _user: Dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    """Tổng hợp KPI SLA, phân bổ theo kênh, xếp hạng nhân viên và xu hướng theo ngày."""
    try:
        data = await asyncio.to_thread(
            get_sla_dashboard,
            start_date=start_date,
            end_date=end_date,
            channel=channel,
        )
        return BaseResponse(success=True, data=data)
    except Exception as exc:
        logger.exception(f"[sla-alerts] GET /dashboard failed: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/turns", response_model=BaseResponse)
async def list_sla_turns_endpoint(
    status: str = Query(default="all"),
    channel: str = Query(default="all"),
    staff_email: Optional[str] = Query(default=None),
    start_date: Optional[str] = Query(default=None),
    end_date: Optional[str] = Query(default=None),
    search: Optional[str] = Query(default=None),
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    _user: Dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    """Danh sách chi tiết các lượt hỏi-đáp SLA (kèm live wait & open_url)."""
    try:
        data = await asyncio.to_thread(
            list_sla_turns,
            status=status,
            channel=channel,
            staff_email=staff_email,
            start_date=start_date,
            end_date=end_date,
            search=search,
            limit=limit,
            offset=offset,
        )
        return BaseResponse(success=True, data=data)
    except Exception as exc:
        logger.exception(f"[sla-alerts] GET /turns failed: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/turns/{turn_id}/dismiss", response_model=BaseResponse)
async def dismiss_sla_turn_endpoint(
    turn_id: str,
    payload: SlaTurnDismissPayload,
    user: Dict[str, Any] = Depends(require_admin_or_leader),
    auth_email: Optional[str] = Depends(get_authenticated_caller_email),
) -> BaseResponse:
    """Đánh dấu bỏ qua (spam/không cần trả lời) cho 1 lượt SLA (Admin/Leader)."""
    try:
        email = _caller_email(user, auth_email)
        updated = await asyncio.to_thread(dismiss_sla_turn, turn_id, payload.reason, email)
        if not updated:
            raise HTTPException(status_code=404, detail="Không tìm thấy lượt SLA")
        return BaseResponse(success=True, data=updated, message="Đã bỏ qua lượt SLA")
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(f"[sla-alerts] POST /turns/{turn_id}/dismiss failed: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/backfill", response_model=BaseResponse)
async def backfill_sla_history_endpoint(
    payload: SlaBackfillPayload,
    _user: Dict[str, Any] = Depends(require_admin_or_leader),
) -> BaseResponse:
    """Tái dựng dữ liệu lịch sử SLA từ các bảng tin nhắn 4 kênh (Admin/Leader)."""
    try:
        data = await asyncio.to_thread(
            backfill_sla_history,
            days=payload.days,
            channels=payload.channels,
        )
        return BaseResponse(success=True, data=data, message="Hoàn tất backfill dữ liệu SLA")
    except Exception as exc:
        logger.exception(f"[sla-alerts] POST /backfill failed: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


# ── Live SLA Badges ──────────────────────────────────────────────────────────

@router.get("/live-badges", response_model=BaseResponse)
async def get_live_badges_endpoint(
    channel: str = Query(default="all"),
    _user: Dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    """Trả danh sách lượt đang chờ kèm trạng thái xanh/vàng/đỏ cho Inbox + trạng thái JS Engine."""
    try:
        items_task = asyncio.to_thread(get_live_sla_badges, channel=channel)
        engine_task = get_engine_status(auto_start=True)
        items, engine_status = await asyncio.gather(items_task, engine_task)
        return BaseResponse(
            success=True,
            data={"items": items, "engine_status": engine_status},
        )
    except Exception as exc:
        logger.exception(f"[sla-alerts] GET /live-badges failed: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


# ── Zalo Group Alert Forward Configs & Logs ──────────────────────────────────

@router.get("/forward-configs/zalo-groups", response_model=BaseResponse)
async def get_forward_zalo_groups_endpoint(
    account_id: str = Query(..., min_length=1, description="ID tài khoản Zalo gửi thông báo"),
    _user: Dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    """Lấy danh sách các Zalo Group của tài khoản gửi thông báo để chọn làm nhóm đích."""
    try:
        groups = await asyncio.to_thread(list_available_zalo_groups_for_account, account_id)
        return BaseResponse(success=True, data={"groups": groups})
    except Exception as exc:
        logger.exception(f"[sla-alerts] GET /forward-configs/zalo-groups failed: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/forward-configs", response_model=BaseResponse)
async def list_forward_configs_endpoint(
    _user: Dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    """Danh sách cấu hình Forward thông báo về Zalo Group chung + trạng thái JS Engine."""
    try:
        items_task = asyncio.to_thread(list_forward_configs)
        engine_task = get_engine_status(auto_start=True)
        items, engine_status = await asyncio.gather(items_task, engine_task)
        return BaseResponse(
            success=True,
            data={"items": items, "engine_status": engine_status},
        )
    except Exception as exc:
        logger.exception(f"[sla-alerts] GET /forward-configs failed: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/forward-configs", response_model=BaseResponse)
async def create_forward_config_endpoint(
    payload: AlertForwardConfigCreate,
    user: Dict[str, Any] = Depends(require_admin_or_leader),
    auth_email: Optional[str] = Depends(get_authenticated_caller_email),
) -> BaseResponse:
    """Tạo cấu hình thông báo nhóm Zalo mới (Admin/Leader)."""
    try:
        email = _caller_email(user, auth_email)
        created = await asyncio.to_thread(create_forward_config, payload, email)
        return BaseResponse(
            success=True,
            data=created,
            message="Đã tạo cấu hình thông báo nhóm Zalo",
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.exception(f"[sla-alerts] POST /forward-configs failed: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@router.patch("/forward-configs/{config_id}", response_model=BaseResponse)
async def update_forward_config_endpoint(
    config_id: str,
    payload: AlertForwardConfigUpdate,
    _user: Dict[str, Any] = Depends(require_admin_or_leader),
) -> BaseResponse:
    """Cập nhật cấu hình thông báo nhóm Zalo (Admin/Leader)."""
    try:
        updated = await asyncio.to_thread(update_forward_config, config_id, payload)
        if not updated:
            raise HTTPException(status_code=404, detail="Không tìm thấy cấu hình thông báo")
        return BaseResponse(
            success=True,
            data=updated,
            message="Đã cập nhật cấu hình thông báo nhóm Zalo",
        )
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.exception(f"[sla-alerts] PATCH /forward-configs/{config_id} failed: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@router.delete("/forward-configs/{config_id}", response_model=BaseResponse)
async def delete_forward_config_endpoint(
    config_id: str,
    _user: Dict[str, Any] = Depends(require_admin_or_leader),
) -> BaseResponse:
    """Xóa cấu hình thông báo nhóm Zalo (Admin/Leader)."""
    try:
        deleted = await asyncio.to_thread(delete_forward_config, config_id)
        if not deleted:
            raise HTTPException(status_code=404, detail="Không tìm thấy cấu hình thông báo")
        return BaseResponse(
            success=True,
            data={"deleted": True, "id": config_id},
            message="Đã xóa cấu hình thông báo nhóm Zalo",
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(f"[sla-alerts] DELETE /forward-configs/{config_id} failed: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/forward-configs/{config_id}/test", response_model=BaseResponse)
async def test_forward_config_endpoint(
    config_id: str,
    user: Dict[str, Any] = Depends(require_admin_or_leader),
    auth_email: Optional[str] = Depends(get_authenticated_caller_email),
) -> BaseResponse:
    """Gửi tin test ngay qua Node.js Alert Forward Engine (hoặc dry-run) (Admin/Leader)."""
    try:
        email = _caller_email(user, auth_email)
        result = await send_test_alert(config_id, caller_email=email)
        return BaseResponse(
            success=True,
            data=result,
            message="Đã gửi tin kiểm tra" if result.get("sent") else (result.get("error") or "Gửi tin kiểm tra thất bại"),
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.exception(f"[sla-alerts] POST /forward-configs/{config_id}/test failed: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/forward-logs", response_model=BaseResponse)
async def list_forward_logs_endpoint(
    config_id: Optional[str] = Query(default=None),
    limit: int = Query(default=50, ge=1, le=500),
    _user: Dict[str, Any] = Depends(get_current_user),
) -> BaseResponse:
    """Nhật ký gửi thông báo nhóm Zalo gần nhất."""
    try:
        items = await asyncio.to_thread(list_alert_logs, config_id=config_id, limit=limit)
        return BaseResponse(success=True, data={"items": items})
    except Exception as exc:
        logger.exception(f"[sla-alerts] GET /forward-logs failed: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))
