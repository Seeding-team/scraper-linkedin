from __future__ import annotations

import hashlib
import json
from typing import Any

from app.core.config import settings
from app.core.phone import vn_phone_to_e164
from app.core.supabase_client import execute_supabase_query, get_supabase_client
from app.modules.all_platform.services.customer_lead_service import BASE_COLUMNS, _normalize_row
from app.modules.all_platform.services.supabase_categories_service import get_categories_by_type
from app.modules.all_platform.services.crm_position_service import apply_position_category
from app.modules.all_platform.services.markee_cfo_customer_sync_service import (
    EXTERNAL_SYSTEM as MARKEE_CFO_EXTERNAL_SYSTEM,
    ensure_recent_markee_cfo_sync,
)

CUSTOMER_COLUMNS = (
    "id, customer_name, company_name, position, position_category_id, "
    "position_label_snapshot, phone, phone_normalized, "
    "email, email_normalized, zalo, facebook, telegram, website, tax_code, "
    "address, city, industry, source, status, owner_id, sale_manager_id, created_by, note, "
    "created_at, updated_at, external_system, external_id, external_updated_at, "
    "external_payload, external_active, synced_at"
)


class DuplicateCustomerError(ValueError):
    def __init__(self, matches: list[dict[str, Any]]) -> None:
        super().__init__("Khach hang da ton tai voi MST, email hoac so dien thoai nay.")
        self.matches = matches


class CustomerLinkedError(ValueError):
    """Chan xoa Khach hang con lien ket deal/contact - customer_leads.customer_id
    la ON DELETE SET NULL va crm_contacts.customer_id la ON DELETE CASCADE
    (078_crm_leads_contacts.sql), xoa thang se lam mat lien ket deal hoac xoa
    am tham toan bo contact. Doi voi tinh huong nay nen chuyen status sang
    'not_fit' (Ngung hoat dong) thay vi xoa han."""

    def __init__(self, deal_count: int, contact_count: int) -> None:
        super().__init__(
            f"Khach hang nay con {deal_count} deal va {contact_count} nguoi lien he "
            "lien ket - khong the xoa. Hay chuyen trang thai sang \"Ngung hoat dong\" "
            "thay vi xoa han."
        )
        self.deal_count = deal_count
        self.contact_count = contact_count


def _is_admin_or_leader(user: dict[str, Any] | None) -> bool:
    role = str((user or {}).get("role") or "").strip().lower()
    return role in {"admin", "leader"}


def _clean_text(value: Any) -> str | None:
    text = str(value or "").strip()
    return text or None


def normalize_email(value: Any) -> str | None:
    text = _clean_text(value)
    return text.lower() if text else None


def normalize_phone(value: Any) -> str | None:
    text = _clean_text(value)
    if not text:
        return None
    return vn_phone_to_e164(text)


def _normalize_payload(payload: dict[str, Any], actor_id: str | None = None) -> dict[str, Any]:
    out = {key: _clean_text(value) if isinstance(value, str) else value for key, value in payload.items()}
    out["email_normalized"] = normalize_email(out.get("email"))
    out["phone_normalized"] = normalize_phone(out.get("phone"))
    if actor_id:
        # created_by chi de audit (ai tao ho so lan dau) - khong bao gio tin
        # gia tri client gui len, luon ep ve actor that cua request.
        out["created_by"] = actor_id
    return out


def _validate_source(source: str | None) -> None:
    if not source:
        return
    try:
        rows = get_categories_by_type("crm_source")
    except Exception:
        rows = []
    if rows and source not in {row.get("code") for row in rows}:
        raise ValueError("Nguon khach hang khong nam trong danh muc crm_source.")


def _duplicate_query(
    email_normalized: str | None,
    phone_normalized: str | None,
    tax_code: str | None = None,
    exclude_id: str | None = None,
) -> list[dict[str, Any]]:
    supabase = get_supabase_client()
    matches: dict[str, dict[str, Any]] = {}
    if email_normalized:
        res = execute_supabase_query(
            lambda: supabase.table("crm_customers")
            .select(CUSTOMER_COLUMNS)
            .eq("email_normalized", email_normalized)
            .eq("instance", settings.crm_instance)
            .eq("external_active", True)
            .execute()
        )
        for row in res.data or []:
            matches[row["id"]] = row
    if phone_normalized:
        res = execute_supabase_query(
            lambda: supabase.table("crm_customers")
            .select(CUSTOMER_COLUMNS)
            .eq("phone_normalized", phone_normalized)
            .eq("instance", settings.crm_instance)
            .eq("external_active", True)
            .execute()
        )
        for row in res.data or []:
            matches[row["id"]] = row
    if tax_code:
        res = execute_supabase_query(
            lambda: supabase.table("crm_customers")
            .select(CUSTOMER_COLUMNS)
            .eq("tax_code", tax_code.strip())
            .eq("instance", settings.crm_instance)
            .eq("external_active", True)
            .execute()
        )
        for row in res.data or []:
            matches[row["id"]] = row
    if exclude_id:
        matches.pop(exclude_id, None)
    return list(matches.values())


def _customer_ids_visible_to(user: dict[str, Any]) -> set[str] | None:
    if _is_admin_or_leader(user):
        return None

    uid = str(user.get("id") or "")
    if not uid:
        return set()

    supabase = get_supabase_client()
    visible: set[str] = set()
    owned = execute_supabase_query(
        lambda: supabase.table("crm_customers")
        .select("id")
        .eq("owner_id", uid)
        .eq("instance", settings.crm_instance)
        .execute()
    )
    visible.update(row["id"] for row in owned.data or [] if row.get("id"))

    by_leaded = execute_supabase_query(
        lambda: supabase.table("customer_leads")
        .select("customer_id")
        .eq("leaded_by", uid)
        .eq("instance", settings.crm_instance)
        .execute()
    )
    by_sdr = execute_supabase_query(
        lambda: supabase.table("customer_leads")
        .select("customer_id")
        .eq("sdr_id", uid)
        .eq("instance", settings.crm_instance)
        .execute()
    )
    for row in (by_leaded.data or []) + (by_sdr.data or []):
        if row.get("customer_id"):
            visible.add(row["customer_id"])
    return visible


def can_edit_customer(user: dict[str, Any], customer: dict[str, Any] | None) -> bool:
    if not user or not customer:
        return False
    # CFO is the master for mirrored records. They are deliberately read-only
    # in CRM, including for admins; edit them in CFO and wait <= sync interval.
    if customer.get("external_system") == MARKEE_CFO_EXTERNAL_SYSTEM:
        return False
    if _is_admin_or_leader(user):
        return True
    return str(customer.get("owner_id") or "") == str(user.get("id") or "")


def can_view_customer(user: dict[str, Any], customer: dict[str, Any] | None) -> bool:
    if not user or not customer:
        return False
    if customer.get("external_system") == MARKEE_CFO_EXTERNAL_SYSTEM:
        return True
    if can_edit_customer(user, customer):
        return True
    visible = _customer_ids_visible_to(user)
    return visible is None or str(customer.get("id")) in visible


def _deal_visible_to(user: dict[str, Any], deal: dict[str, Any]) -> bool:
    if _is_admin_or_leader(user):
        return True
    uid = str(user.get("id") or "")
    return bool(uid) and (str(deal.get("leaded_by") or "") == uid or str(deal.get("sdr_id") or "") == uid)


def _attach_customer_metrics(customers: list[dict[str, Any]], user: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    """Gan deal_count/total_value/last_deal_at/contact_count cho tung khach hang.

    `user` (neu truyen vao) dung de LOC deal theo dung quyen xem da co san
    (_deal_visible_to - giong het related_records()) - tranh lo gia tri
    pipeline/so deal cua nguoi phu trach khac cho sale khong co quyen xem
    (task yeu cau "khong leak deal value cua owner/team khac"). user=None
    (vd goi tu noi chua co user, hoac muon giu hanh vi cu) = khong loc gi ca.
    """
    if not customers:
        return []
    supabase = get_supabase_client()
    ids = [row["id"] for row in customers]
    lead_res = execute_supabase_query(
        lambda: supabase.table("customer_leads")
        .select("id, customer_id, estimated_budget, lifetime_value, updated_at, created_at, leaded_by, sdr_id")
        .in_("customer_id", ids)
        .eq("instance", settings.crm_instance)
        .execute()
    )
    by_customer: dict[str, list[dict[str, Any]]] = {}
    for lead in lead_res.data or []:
        by_customer.setdefault(lead.get("customer_id"), []).append(lead)

    # So Contact that theo tung khach hang - 1 truy van gop cho ca trang, khong
    # phai N+1 (khop do phuc tap voi cach lam cua lead_res o tren).
    contact_res = execute_supabase_query(
        lambda: supabase.table("crm_contacts")
        .select("id, customer_id")
        .in_("customer_id", ids)
        .eq("instance", settings.crm_instance)
        .execute()
    )
    contact_counts: dict[str, int] = {}
    for contact in contact_res.data or []:
        cid = contact.get("customer_id")
        if cid:
            contact_counts[cid] = contact_counts.get(cid, 0) + 1

    for customer in customers:
        leads = by_customer.get(customer["id"], [])
        if user is not None:
            leads = [lead for lead in leads if _deal_visible_to(user, lead)]
        customer["deal_count"] = len(leads)
        customer["total_value"] = sum(float(lead.get("estimated_budget") or lead.get("lifetime_value") or 0) for lead in leads)
        customer["last_deal_at"] = max((lead.get("updated_at") or lead.get("created_at") for lead in leads), default=None)
        customer["contact_count"] = contact_counts.get(customer["id"], 0)
    return customers


def _kpi(customers: list[dict[str, Any]]) -> dict[str, int]:
    return {
        "total": len(customers),
        "new_lead": sum(1 for row in customers if row.get("status") == "new_lead"),
        "following": sum(1 for row in customers if row.get("status") == "following"),
        "current_customer": sum(1 for row in customers if row.get("status") == "current_customer"),
        "not_fit": sum(1 for row in customers if row.get("status") == "not_fit"),
    }


def list_customers(
    user: dict[str, Any],
    *,
    search: str | None = None,
    status: str | None = None,
    source: str | None = None,
    owner_id: str | None = None,
    sale_manager_id: str | None = None,
    scope: str = "all",
    page: int = 1,
    page_size: int = 50,
) -> dict[str, Any]:
    ensure_recent_markee_cfo_sync()
    supabase = get_supabase_client()

    if scope not in {"all", "local", "markee_cfo"}:
        raise ValueError("Pham vi khach hang khong hop le.")

    def base_query(*, include_status: bool = True):
        query = (
            supabase.table("crm_customers")
            .select(CUSTOMER_COLUMNS)
            .eq("instance", settings.crm_instance)
            .eq("external_active", True)
        )
        if scope == "local":
            query = query.is_("external_system", "null")
        elif scope == "markee_cfo":
            query = query.eq("external_system", MARKEE_CFO_EXTERNAL_SYSTEM)
        if include_status and status:
            query = query.eq("status", status)
        if source:
            query = query.eq("source", source)
        if owner_id:
            query = query.eq("owner_id", owner_id)
        if sale_manager_id:
            query = query.eq("sale_manager_id", sale_manager_id)
        return query

    query = base_query()
    if search:
        # Them tax_code vao cung 1 .or_() nhu cac cot cu (customer_name/
        # company_name/phone/email) - Supabase ho tro thang, khong can query
        # rieng.
        query = query.or_(
            f"customer_name.ilike.%{search}%,company_name.ilike.%{search}%,"
            f"phone.ilike.%{search}%,email.ilike.%{search}%,tax_code.ilike.%{search}%"
        )
    res = execute_supabase_query(lambda: query.order("updated_at", desc=True).execute())
    rows = res.data or []

    contact_customer_ids: set[str] = set()
    if search:
        # Tim theo ten Contact (crm_contacts.name) KHONG the gop vao 1 .or_()
        # cung bang crm_customers (khac bang) - chay query rieng lay
        # customer_id cua cac contact khop, roi gop nhung khach hang CHUA co
        # trong `rows` (tranh trung), ap lai dung cac filter status/source/
        # owner_id thu cong vi query nay bo qua chung. Cach nay khong "dep"
        # nhung dung, dung nhu huong dan task cho phep khi chua co pattern
        # OR-cross-table san co trong codebase.
        contact_res = execute_supabase_query(
            lambda: supabase.table("crm_contacts")
            .select("customer_id")
            .ilike("name", f"%{search}%")
            .eq("instance", settings.crm_instance)
            .execute()
        )
        contact_customer_ids = {row["customer_id"] for row in contact_res.data or [] if row.get("customer_id")}
        existing_ids = {row["id"] for row in rows}
        missing_ids = list(contact_customer_ids - existing_ids)
        if missing_ids:
            extra_res = execute_supabase_query(
                lambda: base_query().in_("id", missing_ids).execute()
            )
            rows = rows + (extra_res.data or [])

    visible = _customer_ids_visible_to(user)
    if visible is not None:
        rows = [
            row for row in rows
            if row.get("id") in visible or row.get("external_system") == MARKEE_CFO_EXTERNAL_SYSTEM
        ]

    # KPI (dem theo tung tab trang thai) phai luon tinh tren TOAN BO tap hop
    # khop search/source/owner_id, KHONG bi gioi han theo `status` dang chon -
    # neu khong, bam vao 1 tab se lam cac tab con lai hien 0 (bug thuc te nguoi
    # dung bao cao: chon "Ngung hoat dong" thi "Tiem nang/Dang ban/Da mua" deu
    # ve 0 du truoc do co du lieu that). Chi can query lai rieng khi `status`
    # dang duoc loc - neu khong loc thi `rows` da la dung tap can dem.
    if status:
        kpi_query = base_query(include_status=False)
        if search:
            kpi_query = kpi_query.or_(
                f"customer_name.ilike.%{search}%,company_name.ilike.%{search}%,"
                f"phone.ilike.%{search}%,email.ilike.%{search}%,tax_code.ilike.%{search}%"
            )
        kpi_res = execute_supabase_query(lambda: kpi_query.execute())
        kpi_rows = kpi_res.data or []
        if search:
            existing_kpi_ids = {row["id"] for row in kpi_rows}
            missing_kpi_ids = list(contact_customer_ids - existing_kpi_ids)
            if missing_kpi_ids:
                extra_kpi_res = execute_supabase_query(
                    lambda: base_query(include_status=False).in_("id", missing_kpi_ids).execute()
                )
                kpi_rows = kpi_rows + (extra_kpi_res.data or [])
        if visible is not None:
            kpi_rows = [
                row for row in kpi_rows
                if row.get("id") in visible or row.get("external_system") == MARKEE_CFO_EXTERNAL_SYSTEM
            ]
    else:
        kpi_rows = rows

    total = len(rows)
    start = (page - 1) * page_size
    page_rows = _attach_customer_metrics(rows[start:start + page_size], user=user)
    for customer in page_rows:
        customer["can_edit"] = can_edit_customer(user, customer)
    return {"items": page_rows, "total": total, "page": page, "page_size": page_size, "kpi": _kpi(kpi_rows)}


def quick_search_customers(user: dict[str, Any], q: str, limit: int = 8) -> list[dict[str, Any]]:
    result = list_customers(user, search=q, scope="all", page=1, page_size=limit)
    return result["items"]


def get_customer(customer_id: str, user: dict[str, Any]) -> dict[str, Any]:
    supabase = get_supabase_client()
    res = execute_supabase_query(
        lambda: supabase.table("crm_customers")
        .select(CUSTOMER_COLUMNS)
        .eq("id", customer_id)
        .eq("instance", settings.crm_instance)
        .single()
        .execute()
    )
    customer = res.data
    if not can_view_customer(user, customer):
        raise PermissionError("Khong co quyen xem ho so khach hang nay.")
    return _attach_customer_metrics([customer])[0]


def create_customer(payload: dict[str, Any], user: dict[str, Any]) -> dict[str, Any]:
    actor_id = str(user.get("id") or "")
    data = _normalize_payload(payload, actor_id=actor_id)
    _validate_source(data.get("source"))
    apply_position_category(data)
    matches = _duplicate_query(data.get("email_normalized"), data.get("phone_normalized"), data.get("tax_code"))
    if matches:
        raise DuplicateCustomerError(matches)
    # Khong tin owner_id client gui len - chi admin/leader duoc chi dinh chu
    # ho so khac minh luc tao; con lai luon la chinh nguoi tao (dung quy dinh
    # "owner_id duoc sua" - khong cho tu gan/gan ho quyen sua cho nguoi khac).
    if _is_admin_or_leader(user) and data.get("owner_id"):
        pass
    else:
        data["owner_id"] = actor_id or None
    data["instance"] = settings.crm_instance
    supabase = get_supabase_client()
    res = execute_supabase_query(lambda: supabase.table("crm_customers").insert(data).execute())
    return res.data[0]


def update_customer(customer_id: str, payload: dict[str, Any], user: dict[str, Any]) -> dict[str, Any]:
    current = get_customer(customer_id, user)
    if not can_edit_customer(user, current):
        raise PermissionError("Khong co quyen sua ho so khach hang nay.")
    data = _normalize_payload(payload)
    _validate_source(data.get("source"))
    apply_position_category(data, current_position_category_id=current.get("position_category_id"))
    matches = _duplicate_query(
        data.get("email_normalized"),
        data.get("phone_normalized"),
        data.get("tax_code"),
        exclude_id=customer_id,
    )
    if matches:
        raise DuplicateCustomerError(matches)
    supabase = get_supabase_client()
    res = execute_supabase_query(
        lambda: supabase.table("crm_customers")
        .update({key: value for key, value in data.items() if key not in {"id", "created_by"}})
        .eq("id", customer_id)
        .eq("instance", settings.crm_instance)
        .execute()
    )
    return res.data[0]


def delete_customer(customer_id: str, user: dict[str, Any]) -> dict[str, Any]:
    current = get_customer(customer_id, user)
    if not can_edit_customer(user, current):
        raise PermissionError("Khong co quyen xoa ho so khach hang nay.")
    supabase = get_supabase_client()
    deal_res = execute_supabase_query(
        lambda: supabase.table("customer_leads")
        .select("id", count="exact")
        .eq("customer_id", customer_id)
        .eq("instance", settings.crm_instance)
        .execute()
    )
    contact_res = execute_supabase_query(
        lambda: supabase.table("crm_contacts")
        .select("id", count="exact")
        .eq("customer_id", customer_id)
        .eq("instance", settings.crm_instance)
        .execute()
    )
    deal_count = deal_res.count or 0
    contact_count = contact_res.count or 0
    if deal_count or contact_count:
        raise CustomerLinkedError(deal_count, contact_count)
    execute_supabase_query(
        lambda: supabase.table("crm_customers")
        .delete()
        .eq("id", customer_id)
        .eq("instance", settings.crm_instance)
        .execute()
    )
    return {}


def related_records(customer_id: str, user: dict[str, Any]) -> dict[str, Any]:
    customer = get_customer(customer_id, user)
    supabase = get_supabase_client()
    lead_res = execute_supabase_query(
        lambda: supabase.table("customer_leads")
        .select(BASE_COLUMNS)
        .eq("customer_id", customer_id)
        .eq("instance", settings.crm_instance)
        .execute()
    )
    deals = [_normalize_row(row) for row in lead_res.data or []]
    deals = [deal for deal in deals if _deal_visible_to(user, deal)]
    deal_ids = [deal["id"] for deal in deals]

    quotes: list[dict[str, Any]] = []
    contracts: list[dict[str, Any]] = []
    if deal_ids:
        quote_res = execute_supabase_query(
            lambda: supabase.table("quotes")
            .select("*")
            .in_("deal_id", deal_ids)
            .eq("instance", settings.crm_instance)
            .execute()
        )
        quotes = quote_res.data or []
        try:
            contract_res = execute_supabase_query(
                lambda: supabase.table("contracts")
                .select("*")
                .in_("deal_id", deal_ids)
                .eq("instance", settings.crm_instance)
                .execute()
            )
            contracts = contract_res.data or []
        except Exception:
            contracts = []

    total_value = sum(float(deal.get("estimated_budget") or deal.get("lifetime_value") or 0) for deal in deals)
    return {
        "customer": customer,
        "deals": deals,
        "quotes": quotes,
        "contracts": contracts,
        "kpi": {"deal_count": len(deals), "quote_count": len(quotes), "contract_count": len(contracts), "total_value": total_value},
    }


def _request_hash(payload: dict[str, Any]) -> str:
    return hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode("utf-8")).hexdigest()


def _idempotent_replay(idempotency_key: str) -> dict[str, Any] | None:
    """Neu idempotency_key nay da co response luu san (request truoc da chay
    xong RPC thanh cong - xem UPDATE ... SET response cuoi ham SQL) thi tra ve
    NGUYEN response do, khong chay lai bat ky logic nao khac (bao gom ca
    duplicate-check ben duoi) - dung y nghia idempotent that: request lap lai
    (double-submit/network retry) phai tra ve KET QUA CU, khong bi hieu nham
    la "khach hang trung" chi vi lan truoc vua tao xong khach do."""
    supabase = get_supabase_client()
    res = execute_supabase_query(
        lambda: supabase.table("crm_request_idempotency")
        .select("response")
        .eq("idempotency_key", idempotency_key)
        .eq("instance", settings.crm_instance)
        .execute()
    )
    rows = res.data or []
    if rows and rows[0].get("response"):
        return rows[0]["response"]
    return None


def create_customer_with_deal(payload: dict[str, Any], user: dict[str, Any]) -> dict[str, Any]:
    actor_id = str(user.get("id") or "")
    customer = _normalize_payload(payload.get("customer") or {}, actor_id=actor_id)
    # Cung 1 quy tac voi create_customer(): khong tin owner_id client gui len
    # tru khi nguoi goi la admin/leader - RPC crm_create_customer_with_deal
    # (migration 077) uu tien p_customer->>'owner_id' neu co, nen phai chan
    # tu day, khong de lot xuong RPC.
    if not (_is_admin_or_leader(user) and customer.get("owner_id")):
        customer["owner_id"] = actor_id or None
    _validate_source(customer.get("source"))
    # migration 079 — resolve + mirror Chuc vu BEFORE the RPC call (both new
    # rows here, so always require an active category). The RPC's INSERT
    # statements (migration 077 SQL, not touched by this migration) only know
    # about the legacy `position` text column, which apply_position_category
    # already mirrors — the new position_category_id/position_label_snapshot
    # columns are stamped via an explicit follow-up UPDATE below once the RPC
    # has created the rows.
    apply_position_category(customer)
    deal = dict(payload.get("deal") or {})
    apply_position_category(deal)
    customer_id = _clean_text(payload.get("customer_id"))
    update_customer_profile = bool(payload.get("update_customer_profile"))
    partial = False
    partial_message = None

    if not deal.get("leaded_by"):
        deal["leaded_by"] = actor_id
    idempotency_key = _clean_text(payload.get("idempotency_key")) or _request_hash({"customer": customer, "deal": deal, "actor": actor_id})

    # Kiem tra replay TRUOC duplicate-check va truoc RPC - xem docstring
    # _idempotent_replay(). Phai dat truoc ca nhanh customer_id/duplicate o
    # duoi, khong thi lan retry se bi chinh du lieu lan tao truoc chan lai.
    replayed = _idempotent_replay(idempotency_key)
    if replayed is not None:
        return replayed

    if customer_id:
        existing = get_customer(customer_id, user)
        if update_customer_profile and not can_edit_customer(user, existing):
            update_customer_profile = False
            partial = True
            partial_message = "Deal da tao, nhung ho so khach hang khong duoc cap nhat vi ban khong co quyen sua."
        deal["customer_id"] = customer_id
    else:
        matches = _duplicate_query(
            customer.get("email_normalized"),
            customer.get("phone_normalized"),
            customer.get("tax_code"),
        )
        if matches:
            raise DuplicateCustomerError(matches)

    supabase = get_supabase_client()
    res = execute_supabase_query(
        lambda: supabase.rpc("crm_create_customer_with_deal", {
            "p_customer": customer,
            "p_deal": deal,
            "p_actor_id": actor_id,
            "p_idempotency_key": idempotency_key,
            "p_update_customer": update_customer_profile,
        }).execute()
    )
    data = res.data or {}
    data["partial"] = partial
    if partial_message:
        data["partial_message"] = partial_message

    # migration 079 — the RPC (migration 077 SQL, unmodified here) doesn't
    # know about position_category_id/position_label_snapshot yet, so stamp
    # them via explicit follow-up updates. Deal row is always brand new
    # (stamp unconditionally). Customer row is only stamped when it was
    # actually created/updated by this call — never when an existing
    # customer_id was picked without update_customer_profile, matching the
    # RPC's own "don't touch the profile" behavior in that case.
    new_deal_id = (data.get("deal") or {}).get("id")
    if new_deal_id and (deal.get("position_category_id") or "position_category_id" in deal):
        execute_supabase_query(
            lambda: supabase.table("customer_leads")
            .update({
                "position_category_id": deal.get("position_category_id"),
                "position_label_snapshot": deal.get("position_label_snapshot"),
            })
            .eq("id", new_deal_id)
            .eq("instance", settings.crm_instance)
            .execute()
        )
    new_customer_id = (data.get("customer") or {}).get("id")
    customer_was_written = not customer_id or update_customer_profile
    if new_customer_id and customer_was_written and (
        customer.get("position_category_id") or "position_category_id" in customer
    ):
        execute_supabase_query(
            lambda: supabase.table("crm_customers")
            .update({
                "position_category_id": customer.get("position_category_id"),
                "position_label_snapshot": customer.get("position_label_snapshot"),
            })
            .eq("id", new_customer_id)
            .eq("instance", settings.crm_instance)
            .execute()
        )
    return data
