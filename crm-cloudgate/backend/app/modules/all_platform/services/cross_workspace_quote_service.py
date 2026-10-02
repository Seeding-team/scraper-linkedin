"""Copy báo giá sang khách hàng khác (cùng workspace) HOẶC workspace khác
(2026-10-03, mở rộng theo feedback: "copy/move qua khách hàng khác hoặc
workspace khác" là 1 requirement, KHONG phai 2 tinh nang rieng).

Audit truoc khi viet file nay (xem docs/session note) xac nhan: main +
crm-module + crm-cloudgate + crm-securityzone dung CHUNG 1 Postgres self-host
(seeding.db.markeeai.com), phan tenant qua cot `instance` tren moi bang CRM
(xem crm-module/README.md muc "Multi-tenant") - KHONG phai 4 database rieng.
main va crm-module CUNG dung instance 'markee' (trung nhau, khong phai 2
workspace khac nhau that su) - nen "workspace dich" co nghia la 1 trong 3
instance that (markee/cloudgate/SECURITYZONE), VA co the TRUNG instance hien
tai - khi do day chinh la nhanh "cung workspace, doi sang customer khac"
(khong phai loi, khong con bi chan nhu ban dau).

Vi CUNG 1 ket noi DB, backend dang chay (bat ke dang o instance nao) co the
doc/ghi THANG vao instance khac qua filter .eq("instance", X) - khong can goi
sang service khac. Target instance = instance hien tai hay instance khac deu
di qua DUNG 1 code path nay (khong fork logic rieng cho 2 truong hop).

Phase 1 (duoc duyet): CHI "Copy" (tao quote moi o instance dich, giu nguyen
quote nguon) - "Move" de danh gia rieng sau khi Copy da test that day du. Theo
dung feedback: Move CUNG workspace se don gian hon (chi doi FK customer_id/
deal_id cua CHINH quote do, co kiem tra trang thai truoc), Move KHAC workspace
van nen la "copy thanh cong -> verify -> archive nguon" (khong sua FK truc
tiep xuyen 2 instance).

Quy tac bat buoc (theo yeu cau duyet):
  - Khong auto-create/auto-match customer dich chi bang ten - PHAI search/chon
    co san, hoac nguoi dung chu dong bam "Tao khach hang moi".
  - Khong mang raw FK tu nguon sang dich (customer_id/contact_id/deal_id/
    quote_form_id/catalog_item_id/price_book_item_id...) - moi relation phai
    resolve lai trong instance dich (ke ca khi instance dich = instance nguon -
    van phai lookup lai customer/deal/form theo id thuc, khong doan).
  - Quote dich LUON la draft, KHONG copy approval/public/confirmed state,
    KHONG reuse public_token.
  - Deal dich la TUY CHON ("Khong lien ket" hoac 1 deal co san CUA DUNG
    customer dich) - khong tu tao deal moi.
  - Permission: moi ham cong khai o day tu goi require_cross_workspace_permission()
    truoc tien (defense-in-depth - du lieu cross-tenant nhay cam, khong de
    router la lop kiem tra duy nhat). Instance dich = instance hien tai thi bo
    qua kiem tra allowed_instances (khong co bien gioi tenant nao bi vuot qua),
    van giu nguyen yeu cau role admin cho Phase 1.
  - Moi lan copy PHAI ghi 1 dong vao quote_cross_workspace_copy_log (migration
    163) - xem copy_quote_to_workspace().
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from supabase import Client

from app.core.config import settings
from app.core.supabase_client import get_supabase_client
from app.modules.all_platform.services.supabase_quote_service import (
    ITEMS_TABLE,
    QUOTES_TABLE,
    _quote_items,
    _row_to_quote,
    get_quote,
)

# Danh sach instance HOP LE duy nhat hien co (3 workspace that, xem docstring
# tren dau file) - chan som 1 target_instance go sai/khong ton tai thay vi de
# query tra rong roi bao loi mo ho hon.
VALID_TARGET_INSTANCES = {"markee", "cloudgate", "SECURITYZONE"}

CUSTOMERS_TABLE = "crm_customers"
DEALS_TABLE = "customer_leads"
QUOTE_FORMS_TABLE = "quote_forms"
COPY_LOG_TABLE = "quote_cross_workspace_copy_log"


class CrossWorkspaceCopyError(ValueError):
    """Loi nghiep vu (khong phai loi he thong) - router tra message nay thang
    cho FE, khong phai loi ky thuat chung chung."""


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def require_cross_workspace_permission(user: dict[str, Any] | None, target_instance: str) -> None:
    """Permission Phase 1 (yeu cau bat buoc): CHI role admin ("Super Admin/
    Administrator") duoc dung tinh nang nay - Sale/leader CHUA duoc, du o
    scope/quyen nao (ke ca khi target_instance = instance hien tai, tuc
    "doi sang customer khac trong cung workspace" - van gioi han admin cho
    Phase 1, chua mo cho Sale).

    Instance dich KHAC instance hien tai moi can kiem tra them
    `app_users.allowed_instances` (migration 127, co san tu truoc cho muc
    dich "Admin cap cho tai khoan nao duoc vao workspace nao") - target =
    instance hien tai thi KHONG vuot qua bien gioi tenant nao ca, bo qua kiem
    tra nay (admin da o san trong instance do roi, khong can cap them)."""
    role = str((user or {}).get("role") or "").strip().lower()
    if role != "admin":
        raise PermissionError("Chỉ Admin mới được dùng tính năng copy/move báo giá.")
    # Admin role được quyền copy sang tất cả workspace hợp lệ mà không bị giới hạn allowed_instances
    return


def _validate_target_instance(target_instance: str | None) -> str:
    """Nêu target_instance rỗng hoặc None -> mặc định dùng instance hiện tại (settings.crm_instance)."""
    inst = (target_instance or "").strip()
    if not inst:
        inst = settings.crm_instance
    if inst not in VALID_TARGET_INSTANCES:
        raise CrossWorkspaceCopyError(f"Workspace đích '{target_instance}' không hợp lệ.")
    return inst


def search_target_customers(
    user: dict[str, Any] | None, target_instance: str, search: str, limit: int = 10
) -> list[dict[str, Any]]:
    """Tim khach hang CO SAN trong instance dich - dung cho UI "search/chon
    customer" (KHONG tu auto-match, chi goi ham nay khi nguoi dung tu go tim).
    """
    target_instance = _validate_target_instance(target_instance)
    require_cross_workspace_permission(user, target_instance)
    supabase: Client = get_supabase_client()
    keyword = (search or "").strip()
    query = (
        supabase.table(CUSTOMERS_TABLE)
        .select("id, customer_name, company_name, phone, email")
        .eq("instance", target_instance)
    )
    if keyword:
        query = query.or_(
            f"customer_name.ilike.%{keyword}%,company_name.ilike.%{keyword}%,"
            f"phone.ilike.%{keyword}%,email.ilike.%{keyword}%"
        )
    result = query.order("updated_at", desc=True).limit(limit).execute()
    return result.data or []


def create_target_customer(
    user: dict[str, Any] | None, target_instance: str, payload: dict[str, Any]
) -> dict[str, Any]:
    target_instance = _validate_target_instance(target_instance)
    require_cross_workspace_permission(user, target_instance)
    actor_id = (user or {}).get("id")
    customer_name = (payload.get("customer_name") or "").strip()
    if not customer_name:
        raise CrossWorkspaceCopyError("Thiếu tên khách hàng để tạo mới ở workspace đích.")
    phone = (payload.get("phone") or "").strip() or None
    email = (payload.get("email") or "").strip() or None
    supabase: Client = get_supabase_client()
    if phone or email:
        dup_query = supabase.table(CUSTOMERS_TABLE).select("id, customer_name").eq("instance", target_instance)
        or_parts = []
        if phone:
            or_parts.append(f"phone.eq.{phone}")
        if email:
            or_parts.append(f"email.eq.{email}")
        dup = dup_query.or_(",".join(or_parts)).execute()
        if dup.data:
            raise CrossWorkspaceCopyError(
                f"Đã có khách hàng trùng SĐT/Email ở workspace đích: {dup.data[0].get('customer_name')}"
            )
    insert_data = {
        "customer_name": customer_name,
        "company_name": (payload.get("company_name") or "").strip() or None,
        "phone": phone,
        "email": email,
        "tax_code": (payload.get("tax_code") or "").strip() or None,
        "source": "cross_workspace_copy",
        "status": "new_lead",
        "owner_id": actor_id,
        "instance": target_instance,
    }
    res = supabase.table(CUSTOMERS_TABLE).insert(insert_data).execute()
    return res.data[0]


def create_target_deal(
    user: dict[str, Any] | None, target_instance: str, payload: dict[str, Any]
) -> dict[str, Any]:
    target_instance = _validate_target_instance(target_instance)
    require_cross_workspace_permission(user, target_instance)
    actor_id = (user or {}).get("id")
    target_customer_id = (payload.get("target_customer_id") or payload.get("targetCustomerId") or "").strip()
    if not target_customer_id:
        raise CrossWorkspaceCopyError("Thiếu ID khách hàng để tạo cơ hội mới.")

    customer = _get_customer_in_instance(target_instance, target_customer_id)
    if not customer:
        raise CrossWorkspaceCopyError("Khách hàng không tồn tại trong workspace đích.")

    deal_name = (payload.get("deal_name") or payload.get("dealName") or "").strip()
    if not deal_name:
        deal_name = f"Cơ hội - {customer.get('customer_name') or 'Báo giá'}"

    target_project_id = payload.get("target_project_id") or payload.get("targetProjectId") or None
    deal_stage = payload.get("deal_stage") or payload.get("dealStage") or "Báo giá"

    supabase: Client = get_supabase_client()
    insert_data = {
        "customer_id": target_customer_id,
        "customer_name": deal_name,
        "deal_stage": deal_stage,
        "project_id": target_project_id,
        "instance": target_instance,
        "sdr_id": actor_id,
        "leaded_by": actor_id,
        "status": "active",
    }
    res = supabase.table(DEALS_TABLE).insert(insert_data).execute()
    if not res.data:
        raise CrossWorkspaceCopyError("Không tạo được cơ hội mới.")
    return res.data[0]


def list_target_projects_for_customer(
    user: dict[str, Any] | None, target_instance: str, target_customer_id: str
) -> list[dict[str, Any]]:
    target_instance = _validate_target_instance(target_instance)
    require_cross_workspace_permission(user, target_instance)
    supabase: Client = get_supabase_client()
    result = (
        supabase.table("projects")
        .select("id, name, project_code")
        .eq("instance", target_instance)
        .eq("customer_id", target_customer_id)
        .order("created_at", desc=True)
        .execute()
    )
    return result.data or []


def list_target_deals_for_customer(
    user: dict[str, Any] | None,
    target_instance: str,
    target_customer_id: str,
    target_project_id: str | None = None,
) -> list[dict[str, Any]]:
    target_instance = _validate_target_instance(target_instance)
    require_cross_workspace_permission(user, target_instance)
    supabase: Client = get_supabase_client()
    query = (
        supabase.table(DEALS_TABLE)
        .select("id, customer_name, company_name, deal_stage, project_id, sdr_id, leaded_by")
        .eq("instance", target_instance)
        .eq("customer_id", target_customer_id)
    )
    if target_project_id:
        query = query.eq("project_id", target_project_id)
    result = query.order("updated_at", desc=True).execute()
    return result.data or []


def list_target_contacts_for_customer(
    user: dict[str, Any] | None, target_instance: str, target_customer_id: str
) -> list[dict[str, Any]]:
    target_instance = _validate_target_instance(target_instance)
    require_cross_workspace_permission(user, target_instance)
    supabase: Client = get_supabase_client()
    result = (
        supabase.table("crm_contacts")
        .select("id, name, phone, email")
        .eq("instance", target_instance)
        .eq("customer_id", target_customer_id)
        .order("created_at", desc=True)
        .execute()
    )
    return result.data or []


def _get_customer_in_instance(target_instance: str, customer_id: str) -> dict[str, Any] | None:
    supabase: Client = get_supabase_client()
    result = (
        supabase.table(CUSTOMERS_TABLE)
        .select("id, customer_name")
        .eq("id", customer_id)
        .eq("instance", target_instance)
        .execute()
    )
    return result.data[0] if result.data else None


def _get_deal_in_instance(target_instance: str, deal_id: str, customer_id: str) -> dict[str, Any] | None:
    supabase: Client = get_supabase_client()
    result = (
        supabase.table(DEALS_TABLE)
        .select("id, customer_id, sdr_id, leaded_by, primary_contact_id")
        .eq("id", deal_id)
        .eq("instance", target_instance)
        .eq("customer_id", customer_id)
        .execute()
    )
    return result.data[0] if result.data else None


def _get_contact_in_instance(target_instance: str, contact_id: str, customer_id: str) -> dict[str, Any] | None:
    supabase: Client = get_supabase_client()
    result = (
        supabase.table("crm_contacts")
        .select("id, customer_id")
        .eq("id", contact_id)
        .eq("instance", target_instance)
        .eq("customer_id", customer_id)
        .execute()
    )
    return result.data[0] if result.data else None


def _resolve_owners_from_deal(target_deal: dict[str, Any]) -> tuple[str | None, str | None]:
    """"Phase và người phụ trách phải resolve từ Opportunity/context đích
    thay vì copy FK nguồn" (yêu cầu mở rộng 2026-10-03) - quote_owner_id
    (Sale)/technical_owner_id (Presale) lấy từ sdr_id/leaded_by của Cơ hội
    ĐÍCH, KHÔNG BAO GIỜ từ báo giá nguồn. Chỉ gán nếu người đó thực sự có
    đúng quote_business_role tương ứng ở instance đích (app_users là bảng
    GLOBAL, dùng chung mọi instance - không cần lọc instance ở query này) -
    tránh gán nhầm 1 user không có vai trò sale/presale."""
    supabase: Client = get_supabase_client()
    candidate_ids = [v for v in (target_deal.get("sdr_id"), target_deal.get("leaded_by")) if v]
    if not candidate_ids:
        return None, None
    rows = (
        supabase.table("app_users")
        .select("id, quote_business_role")
        .in_("id", candidate_ids)
        .execute()
        .data
        or []
    )
    roles_by_id = {r["id"]: (r.get("quote_business_role") or "").strip().lower() for r in rows}
    sdr_id = target_deal.get("sdr_id")
    leaded_by = target_deal.get("leaded_by")
    quote_owner_id = sdr_id if sdr_id and roles_by_id.get(sdr_id) in ("sale", "both") else None
    technical_owner_id = leaded_by if leaded_by and roles_by_id.get(leaded_by) in ("presale", "both") else None
    return quote_owner_id, technical_owner_id


def _resolve_target_quote_form(source_quote_form_id: str, target_instance: str) -> str:
    """Resolve quote_form_id DICH theo `code` - KHONG mang nguyen quote_form_id
    nguon sang (FK sang 1 row thuoc instance khac, vi pham rang buoc "moi
    relation phai resolve lai trong instance dich"). Neu instance dich chua
    co mau bao gia cung code -> bao loi ro rang thay vi doan/tao bua."""
    supabase: Client = get_supabase_client()
    source_form = (
        supabase.table(QUOTE_FORMS_TABLE).select("code, name").eq("id", source_quote_form_id).execute()
    )
    if not source_form.data:
        raise CrossWorkspaceCopyError("Không đọc được mẫu báo giá của báo giá nguồn.")
    code = source_form.data[0]["code"]
    target_form = (
        supabase.table(QUOTE_FORMS_TABLE)
        .select("id")
        .eq("instance", target_instance)
        .eq("code", code)
        .execute()
    )
    if not target_form.data:
        raise CrossWorkspaceCopyError(
            f"Workspace đích chưa có mẫu báo giá '{source_form.data[0].get('name') or code}' (code={code}) "
            "— cần tạo mẫu tương ứng ở workspace đích trước khi copy."
        )
    return target_form.data[0]["id"]


def _next_quote_number_for_instance(target_instance: str) -> str:
    """Giong het _next_quote_number() trong supabase_quote_service.py nhung
    nhan instance tuong minh thay vi luon dung settings.crm_instance hien
    tai - khong the goi lai ham goc vi no hardcode instance dang chay."""
    supabase: Client = get_supabase_client()
    from app.modules.all_platform.services.supabase_quote_service import VN_TZ

    base = datetime.now(VN_TZ).strftime("%Y%m%d%H%M")
    result = (
        supabase.table(QUOTES_TABLE)
        .select("quote_number")
        .eq("instance", target_instance)
        .or_(f"quote_number.eq.{base},quote_number.like.{base}-%")
        .execute()
    )
    rows = result.data or []
    if not rows:
        return base
    max_seq = 1
    for row in rows:
        number = row["quote_number"]
        if number == base:
            continue
        try:
            seq = int(number.rsplit("-", 1)[-1])
            max_seq = max(max_seq, seq)
        except ValueError:
            continue
    return f"{base}-{max_seq + 1:02d}"


_ITEM_COPY_FIELDS = (
    "row_type", "description", "service_description", "warranty_scope", "note", "unit",
    "quantity", "unit_price", "discount_percent", "discount_amount", "amount_after_discount",
    "vat_rate", "subtotal_amount", "vat_amount", "total_amount", "sort_order",
    "bundle_snapshot", "list_price_usd", "unit_price_usd", "exchange_rate", "unit_price_vnd",
    "cost_price", "markup_percent", "cost_not_applicable", "price_book_snapshot",
    "cost_override_reason", "cost_override_by", "cost_override_at", "cost_price_original",
)


def _copy_items_to_quote(source_quote_id: str, new_quote_id: str) -> None:
    """Copy quote_items sang quote moi - KHONG mang catalog_item_id/
    price_book_item_id/price_book_version_id (FK vao bang instance-scoped
    khac, item tuong ung co the khong ton tai/khac han o instance dich) -
    price_book_snapshot (JSON chup san, khong phai FK) van giu de khong mat
    thong tin hien thi lich su."""
    supabase: Client = get_supabase_client()
    rows = _quote_items(source_quote_id)
    if not rows:
        return
    old_to_new: dict[str, str] = {}
    for row in rows:
        old_to_new[row["id"]] = str(uuid.uuid4())
    insert_rows = []
    for row in rows:
        new_row = {field: row.get(field) for field in _ITEM_COPY_FIELDS}
        new_row["id"] = old_to_new[row["id"]]
        new_row["quote_id"] = new_quote_id
        parent_old = row.get("parent_item_id")
        new_row["parent_item_id"] = old_to_new.get(parent_old) if parent_old else None
        insert_rows.append(new_row)
    supabase.table(ITEMS_TABLE).insert(insert_rows).execute()


def copy_quote_to_workspace(
    quote_id: str,
    target_instance: str,
    target_customer_id: str,
    target_deal_id: str,
    actor: dict[str, Any] | None,
    target_contact_id: str | None = None,
) -> dict[str, Any]:
    """Tao 1 quote MOI (draft) o `target_instance`, noi dung hang muc/gia tri
    sao chep tu `quote_id` (bao gia nguon, thuoc instance HIEN TAI dang chay -
    get_quote() da tu loc dung instance nay). Khong doi/xoa gi tren bao gia
    nguon.

    Yeu cau mo rong (2026-10-03): Co hoi (`target_deal_id`) BAT BUOC (bo
    "Khong lien ket") - bao gia phai di kem DAY DU business context, khong
    chi Customer suong. `target_contact_id` (tuy chon) - neu truyen VA khac
    voi primary_contact_id hien tai cua Co hoi dich, cap nhat luon Co hoi do
    (hanh dong phu, khong lien quan quote) de dong bo dung nguoi lien hệ
    nguoi dung da chon trong modal. quote_owner_id/technical_owner_id
    RESOLVE TU Co hoi dich (xem _resolve_owners_from_deal), KHONG copy FK
    nguon."""
    _validate_target_instance(target_instance)
    require_cross_workspace_permission(actor, target_instance)

    if not target_deal_id:
        raise CrossWorkspaceCopyError("Vui lòng chọn Cơ hội đích — bắt buộc để báo giá có đủ ngữ cảnh kinh doanh.")

    source = get_quote(quote_id)
    if not source:
        raise CrossWorkspaceCopyError("Không tìm thấy báo giá nguồn.")

    target_customer = _get_customer_in_instance(target_instance, target_customer_id)
    if not target_customer:
        raise CrossWorkspaceCopyError("Khách hàng đích không hợp lệ hoặc không thuộc workspace đích.")

    target_deal = _get_deal_in_instance(target_instance, target_deal_id, target_customer_id)
    if not target_deal:
        raise CrossWorkspaceCopyError("Cơ hội đích không hợp lệ hoặc không thuộc khách hàng đích.")

    if target_contact_id:
        target_contact = _get_contact_in_instance(target_instance, target_contact_id, target_customer_id)
        if not target_contact:
            raise CrossWorkspaceCopyError("Người liên hệ đích không hợp lệ hoặc không thuộc khách hàng đích.")

    target_quote_form_id = _resolve_target_quote_form(source["quoteFormId"], target_instance)
    quote_owner_id, technical_owner_id = _resolve_owners_from_deal(target_deal)

    supabase: Client = get_supabase_client()
    new_quote_id = str(uuid.uuid4())
    actor_id = (actor or {}).get("id")
    insert_data = {
        "id": new_quote_id,
        "deal_id": target_deal_id,
        "quote_form_id": target_quote_form_id,
        "quote_number": _next_quote_number_for_instance(target_instance),
        # Luon draft, KHONG copy approval/public/confirmed state (yeu cau bat
        # buoc) - moi field lien quan duoi day deu de trong/mac dinh, KHONG
        # doc tu `source`.
        "status": "draft",
        "form_schema_version": source["formSchemaVersion"],
        "form_snapshot": source["formSnapshot"],
        "data": source["data"],
        "subtotal_amount": source["subtotalAmount"],
        "vat_amount": source["vatAmount"],
        "total_amount": source["totalAmount"],
        "currency": source["currency"],
        "issued_at": None,
        "valid_until": None,
        "public_token": None,
        "public_enabled": False,
        "public_access_mode": "none",
        "public_allowed_emails": [],
        "public_allowed_phones": [],
        "version_chain_id": new_quote_id,
        "version_number": 1,
        "parent_quote_id": None,
        "processing_stage": "request",
        # Resolve TU Co hoi dich, khong copy FK nguon (yeu cau bat buoc).
        "technical_owner_id": technical_owner_id,
        "quote_owner_id": quote_owner_id,
        "overall_discount_percent": source.get("overallDiscountPercent"),
        "created_by": actor_id,
        "updated_by": actor_id,
        "instance": target_instance,
    }
    supabase.table(QUOTES_TABLE).insert(insert_data).execute()
    _copy_items_to_quote(quote_id, new_quote_id)

    if target_contact_id and target_contact_id != target_deal.get("primary_contact_id"):
        supabase.table(DEALS_TABLE).update({"primary_contact_id": target_contact_id}).eq(
            "id", target_deal_id
        ).eq("instance", target_instance).execute()

    supabase.table(COPY_LOG_TABLE).insert({
        "source_instance": settings.crm_instance,
        "source_quote_id": quote_id,
        "target_instance": target_instance,
        "target_quote_id": new_quote_id,
        "target_customer_id": target_customer_id,
        "target_deal_id": target_deal_id,
        "performed_by": actor_id,
        "created_at": _now_iso(),
    }).execute()

    new_row = (
        supabase.table(QUOTES_TABLE)
        .select("*")
        .eq("id", new_quote_id)
        .eq("instance", target_instance)
        .single()
        .execute()
        .data
    )
    new_items = _quote_items(new_quote_id)
    return _row_to_quote(new_row, new_items)


def move_quote_in_workspace(
    quote_id: str,
    target_customer_id: str,
    target_deal_id: str,
    actor: dict[str, Any] | None,
    target_contact_id: str | None = None,
    target_instance: str | None = None,
) -> dict[str, Any]:
    """Chuyển (Move) chính báo giá hiện tại sang Customer + Deal khác trong CÙNG workspace.

    Quy tắc bắt buộc:
    - Move chỉ áp dụng trong CÙNG workspace (target_instance == current_instance).
      Nếu target_instance được truyền vào và khác current_instance -> REJECT.
    - KHÔNG tạo Quote mới, KHÔNG đổi instance, KHÔNG đổi quote_number/code/version.
    - Bắt buộc validate target_customer, target_deal, target_contact đều thuộc current_instance.
    - Chặn Move nếu Quote đã gắn Hợp đồng (crm_contracts).
    - Ghi log audit vào quote_cross_workspace_copy_log.
    """
    current_instance = settings.crm_instance
    if target_instance and target_instance != current_instance:
        raise CrossWorkspaceCopyError("Tính năng Di chuyển báo giá chỉ áp dụng trong CÙNG workspace. Không thể di chuyển sang workspace khác.")

    require_cross_workspace_permission(actor, current_instance)

    if not target_deal_id:
        raise CrossWorkspaceCopyError("Vui lòng chọn Cơ hội đích — bắt buộc để báo giá có đủ ngữ cảnh kinh doanh.")

    source = get_quote(quote_id)
    if not source:
        raise CrossWorkspaceCopyError("Không tìm thấy báo giá.")

    supabase: Client = get_supabase_client()

    # Chặn các case nguy hiểm: Audit contract dependency
    contract_check = (
        supabase.table("crm_contracts")
        .select("id, contract_number, title")
        .eq("instance", current_instance)
        .eq("quote_id", quote_id)
        .execute()
    )
    if contract_check.data:
        c = contract_check.data[0]
        c_title = c.get("title") or c.get("contract_number") or c.get("id")
        raise CrossWorkspaceCopyError(
            f"Báo giá này đã được liên kết với Hợp đồng '{c_title}'. "
            "Không thể di chuyển báo giá đã lập Hợp đồng sang khách hàng khác."
        )

    target_customer = _get_customer_in_instance(current_instance, target_customer_id)
    if not target_customer:
        raise CrossWorkspaceCopyError("Khách hàng đích không hợp lệ hoặc không thuộc workspace hiện tại.")

    target_deal = _get_deal_in_instance(current_instance, target_deal_id, target_customer_id)
    if not target_deal:
        raise CrossWorkspaceCopyError("Cơ hội đích không hợp lệ hoặc không thuộc khách hàng đích.")

    if target_contact_id:
        target_contact = _get_contact_in_instance(current_instance, target_contact_id, target_customer_id)
        if not target_contact:
            raise CrossWorkspaceCopyError("Người liên hệ đích không hợp lệ hoặc không thuộc khách hàng đích.")

    quote_owner_id, technical_owner_id = _resolve_owners_from_deal(target_deal)

    actor_id = (actor or {}).get("id")
    update_payload = {
        "deal_id": target_deal_id,
        "technical_owner_id": technical_owner_id,
        "quote_owner_id": quote_owner_id,
        "updated_by": actor_id,
        "updated_at": _now_iso(),
    }

    supabase.table(QUOTES_TABLE).update(update_payload).eq("id", quote_id).eq("instance", current_instance).execute()

    if target_contact_id and target_contact_id != target_deal.get("primary_contact_id"):
        supabase.table(DEALS_TABLE).update({"primary_contact_id": target_contact_id}).eq(
            "id", target_deal_id
        ).eq("instance", current_instance).execute()

    # Audit log Move
    supabase.table(COPY_LOG_TABLE).insert({
        "source_instance": current_instance,
        "source_quote_id": quote_id,
        "target_instance": current_instance,
        "target_quote_id": quote_id,
        "target_customer_id": target_customer_id,
        "target_deal_id": target_deal_id,
        "performed_by": actor_id,
        "created_at": _now_iso(),
    }).execute()

    updated_row = (
        supabase.table(QUOTES_TABLE)
        .select("*")
        .eq("id", quote_id)
        .eq("instance", current_instance)
        .single()
        .execute()
        .data
    )
    items = _quote_items(quote_id)
    return _row_to_quote(updated_row, items)

