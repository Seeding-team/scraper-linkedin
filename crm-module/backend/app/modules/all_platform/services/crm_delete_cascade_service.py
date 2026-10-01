"""Xoa Khach hang / Co hoi / Lead KEM du lieu lien quan - HOI XAC NHAN truoc.

Feedback 2026-09-23 (chot voi user): "hỏi chấp nhận mất [dữ liệu] thì mới ok,
không cần chặn quyền xóa", "ai muốn xóa thì xóa", "khi bấm xóa khách hàng, nếu
khách hàng có báo giá cơ hội thì cũng cho hỏi rồi xóa tất cả liên quan [...]
tương tự lead và cái nào nó liên quan nữa", "mấy cái xóa đang chặn quyền đó cho
mở hết đi, nhớ hỏi trước khi xóa là được".

=> KHONG chan quyen, KHONG chan theo trang thai (bao gia da duyet, hop dong da
ky deu xoa duoc). Gate DUY NHAT la xac nhan 2 buoc:
  1. confirm_cascade=False: con du lieu lien quan -> KHONG xoa gi, raise
     CascadeConfirmRequired kem `summary` (so dem tung loai) de FE liet ke ro
     se mat gi.
  2. Nguoi dung xac nhan -> confirm_cascade=True -> xoa that.
Tenant (`instance`) van loc o MOI query - khong bao gio cham du lieu tenant khac.

Thu tu xoa: Bao gia soft-delete (khoi phuc duoc) -> Du an (projects.customer_id
ON DELETE RESTRICT, phai xoa truoc Customer; buoc de loi nhat nen lam som, loi
thi khoi phuc lai bao gia vua xoa mem roi dung - chua mat gi vinh vien) -> Hop
dong -> Lead -> Nguoi lien he -> Co hoi -> Khach hang."""

from __future__ import annotations

import logging
from typing import Any

from app.core.config import settings
from app.core.supabase_client import execute_supabase_query, get_supabase_client
from app.modules.all_platform.services.supabase_quote_service import restore_quote, soft_delete_quote

logger = logging.getLogger(__name__)

# Hop dong o trang thai nay la "chua ky" - con lai (da ky/dang thuc hien...)
# chi dung de CANH BAO ro trong popup, KHONG con chan xoa.
UNSIGNED_CONTRACT_STATUSES = ("draft", "pending_legal")

_COUNT_LABELS = (
    ("customer_count", "khách hàng"),
    ("deal_count", "cơ hội"),
    ("lead_count", "lead"),
    ("contact_count", "người liên hệ"),
    ("project_count", "dự án"),
    ("quote_count", "báo giá"),
    ("contract_count", "hợp đồng"),
)


class CascadeConfirmRequired(ValueError):
    """Con du lieu lien quan - can nguoi dung xac nhan truoc khi xoa toan bo."""

    def __init__(self, entity_label: str, summary: dict[str, Any]) -> None:
        parts = [f"{summary[key]} {label}" for key, label in _COUNT_LABELS if summary.get(key)]
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


def _select_eq(table: str, columns: str, field: str, value: str) -> list[dict[str, Any]]:
    supabase = get_supabase_client()
    return execute_supabase_query(
        lambda: supabase.table(table).select(columns).eq("instance", settings.crm_instance).eq(field, value).execute()
    ).data or []


def _dedupe(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: dict[str, dict[str, Any]] = {}
    for row in rows:
        if row.get("id"):
            seen[str(row["id"])] = row
    return list(seen.values())


def _active_quote(query):
    return query.is_("deleted_at", "null")


_QUOTE_COLS = "id, quote_number, deal_id"
_CONTRACT_COLS = "id, contract_number, title, status, deal_id"


def _empty_related() -> dict[str, list[dict[str, Any]]]:
    return {"customers": [], "deals": [], "projects": [], "contacts": [], "leads": [], "quotes": [], "contracts": []}


def _collect_customer(customer_id: str) -> dict[str, Any]:
    """Toan bo ban ghi lien quan (tenant hien tai) cua 1 Khach hang."""
    deals = _select_eq("customer_leads", "id, customer_name", "customer_id", customer_id)
    deal_ids = [str(d["id"]) for d in deals]
    projects = _select_eq("projects", "id, name", "customer_id", customer_id)
    project_ids = [str(p["id"]) for p in projects]
    related = _empty_related()
    related.update({
        "deals": deals,
        "projects": projects,
        "contacts": _select_eq("crm_contacts", "id", "customer_id", customer_id),
        "leads": _select_eq("crm_leads", "id", "converted_customer_id", customer_id),
        "quotes": _dedupe(
            _select_in("quotes", _QUOTE_COLS, "deal_id", deal_ids, _active_quote)
            + _select_in("quotes", _QUOTE_COLS, "project_id", project_ids, _active_quote)
        ),
        "contracts": _dedupe(
            _select_in("contracts", _CONTRACT_COLS, "deal_id", deal_ids)
            + _select_eq("contracts", _CONTRACT_COLS, "customer_id", customer_id)
        ),
    })
    return related


def _collect_deals(deal_ids: list[str]) -> dict[str, Any]:
    related = _empty_related()
    related["quotes"] = _select_in("quotes", _QUOTE_COLS, "deal_id", deal_ids, _active_quote)
    related["contracts"] = _select_in("contracts", _CONTRACT_COLS, "deal_id", deal_ids)
    return related


def _summary(related: dict[str, Any], *, count_deals: bool = True) -> dict[str, Any]:
    signed = [
        {"id": c["id"], "contract_number": c.get("contract_number"), "title": c.get("title"), "status": c.get("status")}
        for c in related["contracts"]
        if c.get("status") not in UNSIGNED_CONTRACT_STATUSES
    ]
    return {
        "customer_count": len(related["customers"]),
        "deal_count": len(related["deals"]) if count_deals else 0,
        "lead_count": len(related["leads"]),
        "contact_count": len(related["contacts"]),
        "project_count": len(related["projects"]),
        "quote_count": len(related["quotes"]),
        "contract_count": len(related["contracts"]),
        # Chi de popup canh bao ro "trong do N hop dong da ky" - KHONG chan.
        "signed_contracts": signed,
    }


def _has_related(summary: dict[str, Any]) -> bool:
    return any(summary.get(key) for key, _ in _COUNT_LABELS)


def _delete_ids(table: str, ids: list[str]) -> None:
    supabase = get_supabase_client()
    for chunk in _in_chunks(ids):
        execute_supabase_query(
            lambda chunk=chunk: supabase.table(table).delete().eq("instance", settings.crm_instance).in_("id", chunk).execute()
        )


def _execute(actor_id: str | None, related: dict[str, Any], reason: str) -> None:
    ids = {key: [str(row["id"]) for row in rows] for key, rows in related.items()}

    # 1) Bao gia: soft-delete (khoi phuc duoc qua Admin).
    soft_deleted: list[str] = []
    try:
        for quote_id in ids["quotes"]:
            soft_delete_quote(quote_id, actor_id, reason)
            soft_deleted.append(quote_id)
        # 2) Du an truoc moi buoc xoa cung (de loi nhat: chua co luong
        # hard-delete rieng, co the con FK ngoai migration). Loi -> khoi phuc
        # lai bao gia vua xoa mem roi dung, chua mat gi vinh vien.
        _delete_ids("projects", ids["projects"])
    except Exception:
        for quote_id in soft_deleted:
            try:
                restore_quote(quote_id, actor_id)
            except Exception:  # noqa: BLE001 - da log, van nem loi goc
                logger.exception("cascade rollback: khong khoi phuc duoc quote %s", quote_id)
        raise

    _delete_ids("contracts", ids["contracts"])
    _delete_ids("crm_leads", ids["leads"])
    _delete_ids("crm_contacts", ids["contacts"])
    _delete_ids("customer_leads", ids["deals"])
    _delete_ids("crm_customers", ids["customers"])


def delete_customer_cascade(customer: dict[str, Any], actor_id: str | None, confirm_cascade: bool) -> dict[str, Any]:
    customer_id = str(customer["id"])
    related = _collect_customer(customer_id)
    summary = _summary(related)
    if _has_related(summary) and not confirm_cascade:
        raise CascadeConfirmRequired("Khách hàng này", summary)
    related["customers"] = [customer]
    _execute(actor_id, related, f"Xoá cùng Khách hàng {customer.get('customer_name') or customer_id} (đã xác nhận xoá toàn bộ dữ liệu liên quan)")
    return summary


def delete_deal_cascade(deal: dict[str, Any], actor_id: str | None, confirm_cascade: bool) -> dict[str, Any]:
    """Co hoi keo theo Bao gia/Hop dong cua chinh no (Khach hang/Contact/Du an
    thuoc Khach hang, khong xoa)."""
    related = _collect_deals([str(deal["id"])])
    summary = _summary(related)
    if _has_related(summary) and not confirm_cascade:
        raise CascadeConfirmRequired("Cơ hội này", summary)
    related["deals"] = [deal]
    _execute(actor_id, related, f"Xoá cùng Cơ hội {deal.get('customer_name') or deal.get('id')} (đã xác nhận xoá toàn bộ dữ liệu liên quan)")
    return summary


def _lead_related(lead: dict[str, Any]) -> dict[str, Any]:
    """Du lieu sinh ra tu 1 Lead da convert: Co hoi (converted_deal_id) + Bao
    gia/Hop dong cua Co hoi do + Nguoi lien he (converted_contact_id). Khach
    hang (converted_customer_id) CHI bi xoa theo neu sau khi xoa cac ban ghi
    tren no khong con du lieu nao khac (tuc KH chi sinh ra tu chinh Lead nay)
    - khach hang dang co co hoi/lien he/du an/bao gia/hop dong/lead khac thi
    GIU NGUYEN, khong xoa lan du lieu khong lien quan toi Lead."""
    related = _empty_related()
    deal_id = str(lead.get("converted_deal_id") or "")
    contact_id = str(lead.get("converted_contact_id") or "")
    customer_id = str(lead.get("converted_customer_id") or "")
    if deal_id:
        related["deals"] = _select_eq("customer_leads", "id, customer_name", "id", deal_id)
        if related["deals"]:
            deal_related = _collect_deals([deal_id])
            related["quotes"] = deal_related["quotes"]
            related["contracts"] = deal_related["contracts"]
    if contact_id:
        related["contacts"] = _select_eq("crm_contacts", "id", "id", contact_id)
    if customer_id:
        customer_rows = _select_eq("crm_customers", "id, customer_name", "id", customer_id)
        if customer_rows:
            cust_related = _collect_customer(customer_id)
            removing = {key: {str(r["id"]) for r in rows} for key, rows in related.items()}
            removing["leads"] = {str(lead["id"])}
            leftover = any(
                str(row["id"]) not in removing.get(key, set())
                for key, rows in cust_related.items()
                for row in rows
            )
            if not leftover:
                related["customers"] = customer_rows
    return related


def delete_lead_cascade(lead: dict[str, Any], actor_id: str | None, confirm_cascade: bool) -> dict[str, Any]:
    related = _lead_related(lead)
    summary = _summary(related)
    if _has_related(summary) and not confirm_cascade:
        raise CascadeConfirmRequired("Lead này", summary)
    related["leads"] = [lead]
    _execute(actor_id, related, f"Xoá cùng Lead {lead.get('lead_name') or lead.get('id')} (đã xác nhận xoá toàn bộ dữ liệu liên quan)")
    return summary


def get_in_tenant(table: str, record_id: str, columns: str = "*") -> dict[str, Any] | None:
    """Doc 1 ban ghi theo id, CHI trong tenant hien tai (khong kiem tra quyen -
    xoa khong con chan quyen, nhung KHONG BAO GIO cham tenant khac)."""
    rows = _select_eq(table, columns, "id", record_id)
    return rows[0] if rows else None
