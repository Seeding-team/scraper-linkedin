"""Forward rules — CRUD API (Mục 4.3/5.3 guide: gộp CHỈ 1 UI quản lý rule vào
app chính, engine chạy nền — xem `services/forward_engine.py`)."""

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.modules.all_platform.auth_deps import get_authenticated_caller_email
from app.modules.all_platform.zalo.api.security import verify_zalo_api_key
from app.modules.all_platform.zalo.api.routes.accounts import _require_admin_leader_or_self
from app.modules.all_platform.zalo.services.supabase_service import get_zalo_account_by_id
from app.modules.all_platform.zalo.services.forward_engine import (
    create_forward_rule,
    delete_forward_rule,
    get_forward_rule,
    list_forward_logs,
    list_forward_rules,
    update_forward_rule,
    validate_no_loop,
)

router = APIRouter(
    prefix="/forward-rules",
    tags=["zalo-forward-rules"],
    dependencies=[Depends(verify_zalo_api_key)],
)


async def _require_account_perm(caller_email: Optional[str], account_id: str) -> None:
    account = await get_zalo_account_by_id(account_id)
    await _require_admin_leader_or_self(caller_email, (account or {}).get("id_member") or (account or {}).get("owner_id"))


class ForwardRuleCreate(BaseModel):
    account_id: str
    name: Optional[str] = None
    master_thread_id: str
    master_thread_name: Optional[str] = None
    target_thread_ids: List[str]
    target_thread_names: Optional[Dict[str, str]] = None


class ForwardRuleUpdate(BaseModel):
    name: Optional[str] = None
    is_enabled: Optional[bool] = None


@router.get("")
async def list_rules(
    account_id: str,
    caller_email: Optional[str] = Depends(get_authenticated_caller_email),
):
    await _require_account_perm(caller_email, account_id)
    return {"account_id": account_id, "rules": await list_forward_rules(account_id)}


@router.post("")
async def create_rule(
    body: ForwardRuleCreate,
    caller_email: Optional[str] = Depends(get_authenticated_caller_email),
):
    await _require_account_perm(caller_email, body.account_id)
    if not body.target_thread_ids:
        raise HTTPException(status_code=400, detail="Cần ít nhất 1 nhóm đích")
    try:
        rule = await create_forward_rule(
            account_id=body.account_id, name=body.name,
            master_thread_id=body.master_thread_id, master_thread_name=body.master_thread_name,
            target_thread_ids=body.target_thread_ids, target_thread_names=body.target_thread_names,
            created_by=caller_email,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"rule": rule}


@router.patch("/{rule_id}")
async def update_rule(
    rule_id: int,
    body: ForwardRuleUpdate,
    caller_email: Optional[str] = Depends(get_authenticated_caller_email),
):
    existing = await get_forward_rule(rule_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Không tìm thấy rule")
    await _require_account_perm(caller_email, existing["account_id"])
    patch = {k: v for k, v in body.model_dump(exclude_unset=True).items()}
    return {"rule": await update_forward_rule(rule_id, patch)}


@router.delete("/{rule_id}")
async def remove_rule(
    rule_id: int,
    caller_email: Optional[str] = Depends(get_authenticated_caller_email),
):
    existing = await get_forward_rule(rule_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Không tìm thấy rule")
    await _require_account_perm(caller_email, existing["account_id"])
    await delete_forward_rule(rule_id)
    return {"deleted": True}


@router.get("/{rule_id}/logs")
async def rule_logs(
    rule_id: int,
    caller_email: Optional[str] = Depends(get_authenticated_caller_email),
):
    existing = await get_forward_rule(rule_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Không tìm thấy rule")
    await _require_account_perm(caller_email, existing["account_id"])
    return {"logs": await list_forward_logs(rule_id)}
