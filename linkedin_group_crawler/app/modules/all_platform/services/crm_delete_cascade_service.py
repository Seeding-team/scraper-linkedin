"""Xoa Khach hang / Deal KEM du lieu lien quan - co HOI XAC NHAN truoc.

Feedback (2026-09-23): "Nếu xóa Customer mà Customer đang có dữ liệu liên quan
thì phải hỏi rõ trước khi xóa luôn các dữ liệu liên quan, đặc biệt Lead/Deal/
Báo giá và các relation khác; không cascade âm thầm."

Quy uoc 2 buoc (dung chung cho Customer va Deal):
  1. Goi lan dau confirm_cascade=False: neu CO du lieu lien quan -> KHONG xoa
     gi ca, raise CascadeConfirmRequired kem `summary` (so dem tung loai) de
     FE dung popup liet ke ro se mat gi.
  2. Nguoi dung xac nhan -> goi lai confirm_cascade=True -> xoa that.

Gate bat buoc truoc khi xoa that (backend, khong dua vao FE):
  - Hop dong da ky/dang thuc hien (status ngoai draft/pending_legal) KHONG
    duoc xoa - dung guard san co cua supabase_contract_service.delete_contract
    (rule: khong force-delete vuot guard). Co hop dong nhu vay -> dung lai,
    bao ro hop dong nao.
  - Moi ban ghi con (Deal/Bao gia/Hop dong/Du an/Lead) phai qua DUNG helper
    quyen san co cua loai do (can_write_deal/can_edit_quote/can_edit_contract/
    can_manage_project/can_write_lead). Thieu quyen tren bat ky ban ghi nao ->
    PermissionError, khong xoa gi.

Thu tu xoa: Bao gia soft-delete -> Du an (projects.customer_id la ON DELETE
RESTRICT, phai xoa truoc Customer; buoc de loi nhat nen lam som, loi thi khoi
phuc lai bao gia vua xoa mem va dung - chua mat gi vinh vien) -> Hop dong nhap
-> Lead da convert -> Nguoi lien he -> Deal -> Customer. Moi query deu loc
`instance` (tenant)."""

from __future__ import annotations

import logging
from typing import Any

from app.core.config import settings
from app.core.supabase_client import execute_supabase_query, get_supabase_client
from app.modules.all_platform.services.crm_permission_service import (
    can_edit_contract,
    can_edit_quote,
    can_manage_project,
    can_write_deal,
    can_write_lead,
)
from app.modules.all_platform.services.supabase_quote_service import restore_quote, soft_delete_quote

logger = logging.getLogger(__name__)

# Dung dung tap trang thai ma delete_contract() cho phep xoa.
DELETABLE_CONTRACT_STATUSES = ("draft", "pending_legal")


class CascadeConfirmRequired(ValueError):
    """Con du lieu lien quan - can nguoi dung xac nhan truoc khi xoa toan bo."""

    def __init__(self, entity_label: str, summary: dict[str, Any]) -> None:
        parts = []
        for key, label in (
            ("deal_count", "cơ hội"),
            ("lead_count", "lead"),
            ("contact_count", "người liên hệ"),
            ("project_count", "dự án"),
            ("quote_count", "báo giá"),
            ("contract_count", "hợp đồng"),
        ):
            if summary.get(key):
                parts.append(f"{summary[key]} {label}")
        super().__init__(
            f"{entity_label} còn {', '.join(parts)} liên quan — cần xác nhận trước khi xoá toàn bộ."
        )
        self.summary = summary


def _in_chunks(values: list[str], size: int = 100) -> list[list[str]]:
    return [values[i:i + size] for i in range(0, len(values), size)]


def _select_in(table: str, columns: str, field: str, values: list[str], extra=None) -> list[dict[str, Any]]:
    if not values:
        return []
    supabase = get_supabase_client()
    rows: list[dict[str, Any]] = []
    for chunk in _in_chunks(values):
        def run(chunk=chunk):
            query = supabase.table(table).select(columns).eq("instance", settings.crm_instance).in_(field, chunk)
            if extra:
                query = extra(query)
            return query.execute()
        rows.extend(execute_supabase_query(run).data or [])
    return rows


def _dedupe(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: dict[str, dict[str, Any]] = {}
    for row in rows:
        if row.get("id"):
            seen[str(row["id"])] = row
    return list(seen.values())


def _collect(deals: list[dict[str, Any]], customer_id: str | None) -> dict[str, Any]:
    """Gom toan bo ban ghi lien quan (tenant hien tai) cua 1 tap Deal va (neu
    co) 1 Customer."""
    supabase = get_supabase_client()
    deal_ids = [str(d["id"]) for d in deals if d.get("id")]

    projects: list[dict[str, Any]] = []
    contacts: list[dict[str, Any]] = []
    leads: list[dict[str, Any]] = []
    direct_contracts: list[dict[str, Any]] = []
    if customer_id:
        projects = execute_supabase_query(
            lambda: supabase.table("projects").select("id, name, created_by, manager_id")
            .eq("instance", settings.crm_instance).eq("customer_id", customer_id).execute()
        ).data or []
        contacts = execute_supabase_query(
            lambda: supabase.table("crm_contacts").select("id")
            .eq("instance", settings.crm_instance).eq("customer_id", customer_id).execute()
        ).data or []
        leads = execute_supabase_query(
            lambda: supabase.table("crm_leads").select("id, sdr_id")
            .eq("instance", settings.crm_instance).eq("converted_customer_id", customer_id).execute()
        ).data or []
        direct_contracts = execute_supabase_query(
            lambda: supabase.table("contracts").select("id, contract_number, title, status, created_by, deal_id")
            .eq("instance", settings.crm_instance).eq("customer_id", customer_id).execute()
        ).data or []

    project_ids = [str(p["id"]) for p in projects]
    active_quote = lambda q: q.is_("deleted_at", "null")  # noqa: E731
    quotes = _dedupe(
        _select_in("quotes", "id, quote_number, created_by, deal_id", "deal_id", deal_ids, active_quote)
        + _select_in("quotes", "id, quote_number, created_by, deal_id", "project_id", project_ids, active_quote)
    )
    contracts = _dedupe(
        _select_in("contracts", "id, contract_number, title, status, created_by, deal_id", "deal_id", deal_ids)
        + direct_contracts
    )
    return {
        "deals": deals,
        "projects": projects,
        "contacts": contacts,
        "leads": leads,
        "quotes": quotes,
        "contracts": contracts,
    }


def _summary(related: dict[str, Any], deals_counted: bool = True) -> dict[str, Any]:
    blocked = [
        {
            "id": c["id"],
            "contract_number": c.get("contract_number"),
            "title": c.get("title"),
            "status": c.get("status"),
        }
        for c in related["contracts"]
        if c.get("status") not in DELETABLE_CONTRACT_STATUSES
    ]
    return {
        "deal_count": len(related["deals"]) if deals_counted else 0,
        "lead_count": len(related["leads"]),
        "contact_count": len(related["contacts"]),
        "project_count": len(related["projects"]),
        "quote_count": len(related["quotes"]),
        "contract_count": len(related["contracts"]),
        "blocked_contracts": blocked,
    }


def _has_related(summary: dict[str, Any]) -> bool:
    return any(
        summary.get(key)
        for key in ("deal_count", "lead_count", "contact_count", "project_count", "quote_count", "contract_count")
    )


def _check_permissions(user: dict[str, Any], related: dict[str, Any]) -> None:
    deals_by_id = {str(d["id"]): d for d in related["deals"]}
    denied: list[str] = []
    n = sum(1 for d in related["deals"] if not can_write_deal(user, d))
    if n:
        denied.append(f"{n} cơ hội")
    n = sum(
        1 for q in related["quotes"]
        if not can_edit_quote(user, q, deals_by_id.get(str(q.get("deal_id") or "")))
    )
    if n:
        denied.append(f"{n} báo giá")
    n = sum(
        1 for c in related["contracts"]
        if not can_edit_contract(user, {**c, "createdById": c.get("created_by")}, deals_by_id.get(str(c.get("deal_id") or "")))
    )
    if n:
        denied.append(f"{n} hợp đồng")
    n = sum(1 for p in related["projects"] if not can_manage_project(user, p))
    if n:
        denied.append(f"{n} dự án")
    n = sum(1 for lead in related["leads"] if not can_write_lead(user, lead))
    if n:
        denied.append(f"{n} lead")
    if denied:
        raise PermissionError(
            "Bạn không có quyền xoá " + ", ".join(denied)
            + " thuộc người khác phụ trách — cần Admin/Leader thực hiện thao tác xoá này."
        )


def _ensure_no_blocked_contracts(summary: dict[str, Any]) -> None:
    blocked = summary.get("blocked_contracts") or []
    if blocked:
        names = ", ".join(str(c.get("contract_number") or c.get("title") or c["id"]) for c in blocked[:5])
        raise ValueError(
            f"Không thể xoá: còn {len(blocked)} hợp đồng đã ký/đang thực hiện ({names}). "
            "Hợp đồng ở trạng thái này không được xoá — hãy xử lý hợp đồng trước."
        )


def _execute(user: dict[str, Any], related: dict[str, Any], customer_id: str | None, reason: str) -> None:
    supabase = get_supabase_client()
    instance = settings.crm_instance
    actor_id = user.get("id")

    # 1) Bao gia: soft-delete (khoi phuc duoc).
    soft_deleted: list[str] = []
    try:
        for quote in related["quotes"]:
            soft_delete_quote(str(quote["id"]), actor_id, reason)
            soft_deleted.append(str(quote["id"]))

        # 2) Du an TRUOC cac buoc xoa cung khac: day la buoc de loi nhat (Du an
        # chua co luong hard-delete rieng, co the con FK ngoai migration tro
        # toi). Loi o day -> khoi phuc lai cac bao gia vua xoa mem roi dung,
        # chua co ban ghi nao bi xoa vinh vien.
        project_ids = [str(p["id"]) for p in related["projects"]]
        for chunk in _in_chunks(project_ids):
            execute_supabase_query(
                lambda chunk=chunk: supabase.table("projects").delete().eq("instance", instance).in_("id", chunk).execute()
            )
    except Exception:
        for quote_id in soft_deleted:
            try:
                restore_quote(quote_id, actor_id)
            except Exception:  # noqa: BLE001 - da log, van nem loi goc
                logger.exception("cascade rollback: khong khoi phuc duoc quote %s", quote_id)
        raise

    contract_ids = [str(c["id"]) for c in related["contracts"]]
    for chunk in _in_chunks(contract_ids):
        execute_supabase_query(
            lambda chunk=chunk: supabase.table("contracts").delete().eq("instance", instance)
            .in_("id", chunk).in_("status", list(DELETABLE_CONTRACT_STATUSES)).execute()
        )
    lead_ids = [str(lead["id"]) for lead in related["leads"]]
    for chunk in _in_chunks(lead_ids):
        execute_supabase_query(
            lambda chunk=chunk: supabase.table("crm_leads").delete().eq("instance", instance).in_("id", chunk).execute()
        )
    if customer_id:
        execute_supabase_query(
            lambda: supabase.table("crm_contacts").delete().eq("instance", instance).eq("customer_id", customer_id).execute()
        )
    deal_ids = [str(d["id"]) for d in related["deals"]]
    for chunk in _in_chunks(deal_ids):
        execute_supabase_query(
            lambda chunk=chunk: supabase.table("customer_leads").delete().eq("instance", instance).in_("id", chunk).execute()
        )
    if customer_id:
        execute_supabase_query(
            lambda: supabase.table("crm_customers").delete().eq("instance", instance).eq("id", customer_id).execute()
        )


def delete_customer_cascade(customer: dict[str, Any], user: dict[str, Any], confirm_cascade: bool) -> dict[str, Any]:
    """Nguoi goi da kiem tra can_edit_customer(). Tra ve summary da xoa."""
    supabase = get_supabase_client()
    customer_id = str(customer["id"])
    deals = execute_supabase_query(
        lambda: supabase.table("customer_leads").select("id, leaded_by, sdr_id, customer_name")
        .eq("instance", settings.crm_instance).eq("customer_id", customer_id).execute()
    ).data or []
    related = _collect(deals, customer_id)
    summary = _summary(related)
    if _has_related(summary) and not confirm_cascade:
        raise CascadeConfirmRequired("Khách hàng này", summary)
    _ensure_no_blocked_contracts(summary)
    _check_permissions(user, related)
    _execute(user, related, customer_id, f"Xoá cùng Khách hàng {customer.get('customer_name') or customer_id} (đã xác nhận xoá toàn bộ dữ liệu liên quan)")
    return summary


def delete_deal_cascade(deal: dict[str, Any], user: dict[str, Any], confirm_cascade: bool) -> dict[str, Any]:
    """Nguoi goi da kiem tra can_write_deal(). Deal chi keo theo Bao gia/Hop
    dong cua chinh no (Customer/Contact/Project thuoc Customer, khong xoa)."""
    related = _collect([deal], None)
    related["deals"] = [deal]
    summary = _summary(related, deals_counted=False)
    if _has_related(summary) and not confirm_cascade:
        raise CascadeConfirmRequired("Cơ hội này", summary)
    _ensure_no_blocked_contracts(summary)
    _check_permissions(user, related)
    _execute(user, related, None, f"Xoá cùng Cơ hội {deal.get('customer_name') or deal.get('id')} (đã xác nhận xoá toàn bộ dữ liệu liên quan)")
    return summary
