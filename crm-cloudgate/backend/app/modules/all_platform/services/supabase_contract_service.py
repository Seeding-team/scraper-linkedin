"""Supabase-based Contracts service — hợp đồng gắn với customer_leads (CRM deal) +
quotes đã chốt. Bảng riêng (khác `customer_leads.contract_status` cũ, giữ nguyên không
đụng), theo đúng convention của `supabase_quote_service.py`: response dict camelCase
khớp thẳng type TS phía frontend (modules/contracts)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from supabase import Client

from app.core.config import settings
from app.core.supabase_client import get_supabase_client
from app.modules.all_platform.services.customer_lead_service import get_customer_lead_by_id

CONTRACTS_TABLE = "contracts"
ACTIVITY_LOG_TABLE = "contract_activity_log"

# Select kèm PostgREST embed để lấy tên khách hàng (qua deal_id) + tên người phụ
# trách (qua owner_id) trong CÙNG 1 query - khớp cột "KHÁCH HÀNG"/"PHỤ TRÁCH"
# trong bảng danh sách hợp đồng của mockup UI, tránh phải query N+1 lần.
LIST_SELECT = (
    "*, deal:deal_id(customer_name, company_name), owner:owner_id(name)"
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row_to_contract(row: dict) -> dict:
    deal = row.get("deal") or {}
    owner = row.get("owner") or {}
    return {
        "id": row["id"],
        "contractNumber": row["contract_number"],
        "dealId": row.get("deal_id"),
        "dealCustomerName": deal.get("customer_name"),
        "dealCompanyName": deal.get("company_name"),
        "customerId": row.get("customer_id"),
        "manualCustomerName": row.get("manual_customer_name"),
        "quoteId": row.get("quote_id"),
        "title": row["title"],
        "templateType": row.get("template_type") or "service",
        "status": row["status"],
        "contractValue": float(row.get("contract_value") or 0),
        "currency": row.get("currency") or "VND",
        "startDate": row.get("start_date"),
        "endDate": row.get("end_date"),
        "signedAt": row.get("signed_at"),
        "paymentTerms": row.get("payment_terms") or "",
        "progressPercent": row.get("progress_percent") or 0,
        "paymentCollectedPercent": row.get("payment_collected_percent") or 0,
        "ownerId": row.get("owner_id"),
        "ownerName": owner.get("name"),
        "clauses": row.get("clauses") or [],
        "aiGenerated": bool(row.get("ai_generated")),
        "aiRiskScore": row.get("ai_risk_score"),
        "aiReview": row.get("ai_review") or [],
        "aiPrompt": row.get("ai_prompt"),
        "version": row.get("version") or 1,
        "createdById": row.get("created_by"),
        "updatedById": row.get("updated_by"),
        "createdAt": row.get("created_at"),
        "updatedAt": row.get("updated_at"),
        # Migration 136 — "Ghi nhận hợp đồng có sẵn".
        "source": row.get("source") or "crm",
        "fileUrl": row.get("file_url"),
        "note": row.get("note"),
    }


def _next_contract_number() -> str:
    supabase: Client = get_supabase_client()
    year = datetime.now(timezone.utc).year
    prefix = f"HD/{year}/"
    result = (
        supabase.table(CONTRACTS_TABLE)
        .select("contract_number")
        .like("contract_number", f"{prefix}%")
        .execute()
    )
    max_seq = 0
    for row in result.data or []:
        try:
            seq = int(row["contract_number"].split("/")[-1])
            max_seq = max(max_seq, seq)
        except (ValueError, IndexError):
            continue
    return f"{prefix}{max_seq + 1:04d}"


def _log_activity(contract_id: str, actor_id: str | None, action: str, changes: dict | None = None) -> None:
    supabase: Client = get_supabase_client()
    supabase.table(ACTIVITY_LOG_TABLE).insert({
        "contract_id": contract_id, "actor_id": actor_id, "action": action, "changes": changes,
        "instance": settings.crm_instance,
    }).execute()


def _row_to_activity(row: dict) -> dict:
    return {
        "id": row["id"],
        "contractId": row.get("contract_id"),
        "actorId": row.get("actor_id"),
        "action": row.get("action"),
        "changes": row.get("changes"),
        "createdAt": row.get("created_at"),
    }


def list_contract_activity_log(contract_id: str) -> list[dict]:
    """Lich su hoat dong THAT cua 1 hop dong (created/updated/status_changed:<status>) -
    mirror y het list_quote_activity_log() (supabase_quote_service.py) - bang
    da co san, chi truoc day khong co route GET nao doc lai. Actor chi tra id,
    FE tu resolve ten (giong quote), khong join o backend."""
    supabase: Client = get_supabase_client()
    result = (
        supabase.table(ACTIVITY_LOG_TABLE)
        .select("*")
        .eq("contract_id", contract_id)
        .order("created_at", desc=True)
        .execute()
    )
    return [_row_to_activity(row) for row in (result.data or [])]


def _serialize_clauses(clauses: list[Any] | None) -> list[dict]:
    if not clauses:
        return []
    out = []
    for c in clauses:
        item = c.model_dump() if hasattr(c, "model_dump") else dict(c)
        out.append({"id": item.get("id") or "", "title": item.get("title") or "", "body": item.get("body") or ""})
    return out


# ── Contracts CRUD ───────────────────────────────────────────────────────────

def list_contracts(deal_id: str | None = None, status: str | None = None) -> list[dict]:
    supabase: Client = get_supabase_client()
    query = supabase.table(CONTRACTS_TABLE).select(LIST_SELECT).eq("instance", settings.crm_instance)
    if deal_id:
        query = query.eq("deal_id", deal_id)
    if status:
        query = query.eq("status", status)
    result = query.order("created_at", desc=True).execute()
    return [_row_to_contract(row) for row in (result.data or [])]


def get_contract(contract_id: str) -> dict:
    supabase: Client = get_supabase_client()
    row = (
        supabase.table(CONTRACTS_TABLE)
        .select(LIST_SELECT)
        .eq("id", contract_id)
        .eq("instance", settings.crm_instance)
        .single()
        .execute()
        .data
    )
    return _row_to_contract(row)


def _resolve_customer_id(deal_id: str | None, customer_id: str | None) -> str | None:
    """Deal thang khi co ca 2 - khong tin customer_id client gui neu no lech
    voi customer that su cua deal (vd deal doi khach hang gan deal_id cu)."""
    if deal_id:
        deal = get_customer_lead_by_id(deal_id)
        return (deal or {}).get("customer_id")
    return customer_id


def create_contract(payload: dict, created_by: str | None) -> dict:
    supabase: Client = get_supabase_client()
    insert_data = {
        "contract_number": payload.get("contract_number") or _next_contract_number(),
        "deal_id": payload.get("deal_id"),
        "customer_id": _resolve_customer_id(payload.get("deal_id"), payload.get("customer_id")),
        "manual_customer_name": payload.get("manual_customer_name"),
        "quote_id": payload.get("quote_id"),
        "title": payload["title"],
        "template_type": payload.get("template_type") or "service",
        # Hop dong ngoai (External) thuong duoc ghi lai SAU khi da ky ngoai doi
        # thuc - cho phep chon trang thai/ngay ky ban dau thay vi luon ep
        # 'draft', dung lai CHINH enum da co san tren cot `status` (khong them
        # gia tri moi). Mac dinh van la 'draft' neu khong truyen.
        "status": payload.get("status") or "draft",
        "signed_at": payload.get("signed_at"),
        "contract_value": float(payload.get("contract_value") or 0),
        "currency": payload.get("currency") or "VND",
        "start_date": payload.get("start_date"),
        "end_date": payload.get("end_date"),
        "payment_terms": payload.get("payment_terms"),
        "progress_percent": int(payload.get("progress_percent") or 0),
        "payment_collected_percent": int(payload.get("payment_collected_percent") or 0),
        "owner_id": payload.get("owner_id") or created_by,
        "clauses": _serialize_clauses(payload.get("clauses")),
        "ai_generated": bool(payload.get("ai_generated")),
        "ai_risk_score": payload.get("ai_risk_score"),
        "ai_review": payload.get("ai_review"),
        "ai_prompt": payload.get("ai_prompt"),
        "source": payload.get("source") or "crm",
        "file_url": payload.get("file_url"),
        "note": payload.get("note"),
        "created_by": created_by,
        "updated_by": created_by,
        "instance": settings.crm_instance,
    }
    row = supabase.table(CONTRACTS_TABLE).insert(insert_data).execute().data[0]
    _log_activity(row["id"], created_by, "created")
    return get_contract(row["id"])


def update_contract(contract_id: str, payload: dict, actor_id: str | None) -> dict:
    supabase: Client = get_supabase_client()
    update_data: dict[str, Any] = {}
    for key in (
        "title", "template_type", "contract_value", "currency", "start_date", "end_date",
        "payment_terms", "progress_percent", "payment_collected_percent", "owner_id",
        "manual_customer_name",
    ):
        if payload.get(key) is not None:
            update_data[key] = payload[key]
    if payload.get("clauses") is not None:
        update_data["clauses"] = _serialize_clauses(payload.get("clauses"))
    if payload.get("ai_risk_score") is not None:
        update_data["ai_risk_score"] = payload["ai_risk_score"]
    if payload.get("ai_review") is not None:
        update_data["ai_review"] = payload["ai_review"]
    if not update_data:
        return get_contract(contract_id)
    update_data["updated_by"] = actor_id
    update_data["updated_at"] = _now_iso()
    current_version = (
        supabase.table(CONTRACTS_TABLE)
        .select("version")
        .eq("id", contract_id)
        .eq("instance", settings.crm_instance)
        .single()
        .execute()
        .data
    )
    update_data["version"] = current_version.get("version", 1) + 1
    supabase.table(CONTRACTS_TABLE).update(update_data).eq("id", contract_id).eq("instance", settings.crm_instance).execute()
    _log_activity(contract_id, actor_id, "updated", {"fields": list(update_data.keys())})
    return get_contract(contract_id)


def update_contract_status(contract_id: str, status: str, signed_at: str | None, actor_id: str | None) -> dict:
    supabase: Client = get_supabase_client()
    update_data: dict[str, Any] = {"status": status, "updated_by": actor_id, "updated_at": _now_iso()}
    if status == "signed" and not signed_at:
        signed_at = _now_iso()
    if signed_at:
        update_data["signed_at"] = signed_at
    supabase.table(CONTRACTS_TABLE).update(update_data).eq("id", contract_id).eq("instance", settings.crm_instance).execute()
    _log_activity(contract_id, actor_id, f"status_changed:{status}")
    return get_contract(contract_id)


def delete_contract(contract_id: str) -> None:
    supabase: Client = get_supabase_client()
    current = (
        supabase.table(CONTRACTS_TABLE)
        .select("status")
        .eq("id", contract_id)
        .eq("instance", settings.crm_instance)
        .single()
        .execute()
        .data
    )
    if current and current.get("status") not in ("draft", "pending_legal"):
        raise ValueError("Hợp đồng đã ký/đang thực hiện, không thể xoá.")
    supabase.table(CONTRACTS_TABLE).delete().eq("id", contract_id).eq("instance", settings.crm_instance).execute()


def get_contracts_dashboard_stats() -> dict:
    """4 KPI đầu trang, khớp đúng 4 ô trong mockup UI (Hợp đồng hiệu lực / Chờ ký /
    Sắp hết hạn / Công nợ đến hạn). "Công nợ đến hạn" không có bảng lịch thanh toán
    riêng (out of scope, xem kế hoạch) nên tính xấp xỉ = phần GIÁ TRỊ CHƯA THU của
    các hợp đồng đang hiệu lực (contract_value * (100 - payment_collected_percent)/100),
    "kỳ thanh toán" = số hợp đồng đang hiệu lực mà chưa thu đủ 100%."""
    supabase: Client = get_supabase_client()
    rows = (
        supabase.table(CONTRACTS_TABLE)
        .select("status, contract_value, end_date, payment_collected_percent")
        .eq("instance", settings.crm_instance)
        .execute()
        .data
        or []
    )
    active_statuses = {"signed", "active"}
    active = [r for r in rows if r["status"] in active_statuses]
    pending_signature = [r for r in rows if r["status"] == "pending_signature"]

    today = datetime.now(timezone.utc).date()
    expiring = []
    for r in active:
        end_date = r.get("end_date")
        if not end_date:
            continue
        try:
            end = datetime.fromisoformat(end_date).date()
        except ValueError:
            continue
        if 0 <= (end - today).days <= 30:
            expiring.append(r)

    unpaid = [r for r in active if (r.get("payment_collected_percent") or 0) < 100]
    outstanding_value = sum(
        float(r.get("contract_value") or 0) * (100 - (r.get("payment_collected_percent") or 0)) / 100
        for r in unpaid
    )

    return {
        "activeCount": len(active),
        "activeValue": sum(float(r.get("contract_value") or 0) for r in active),
        "pendingSignatureCount": len(pending_signature),
        "expiringCount": len(expiring),
        "expiringValue": sum(float(r.get("contract_value") or 0) for r in expiring),
        "outstandingValue": outstanding_value,
        "outstandingCount": len(unpaid),
    }
