"""Copy SÂU / Di chuyển 1 Khách hàng sang workspace khác (2026-10-23, yêu cầu
sếp - mở rộng từ `copy_customer_to_instance()` ở crm_customer_service.py vốn
chỉ copy nông đúng 1 dòng `crm_customers`).

Khác với Quote (`cross_workspace_quote_service.py`, Copy tạo bản mới gắn vào
Customer/Deal ĐÃ CÓ SẴN ở đích), ở đây Copy tạo TOÀN BỘ cây dữ liệu MỚI của
đúng 1 Khách hàng (Deal/Báo giá/Liên hệ/Hợp đồng/Dự án) - không cần resolve
vào thực thể có sẵn ở đích vì đích chưa có gì liên quan tới khách hàng này.

Move thì NGƯỢC LẠI đơn giản hơn Copy nhiều: vì object ID không đổi khi move
(không tạo bản sao), chỉ cần UPDATE cột `instance` tại chỗ trên mọi bảng con -
không cần remap FK nào cả.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any

from supabase import Client

from app.core.config import settings
from app.core.supabase_client import get_supabase_client
from app.modules.all_platform.services import contract_document_store
from app.modules.all_platform.services.crm_customer_service import CUSTOMER_COLUMNS, normalize_city_fields
from app.modules.all_platform.services.cross_workspace_quote_service import (
    VALID_TARGET_INSTANCES,
    _copy_items_to_quote,
    _next_quote_number_for_instance,
    _resolve_target_quote_form,
)
from app.modules.all_platform.services.supabase_project_service import _is_unique_violation

CUSTOMERS_TABLE = "crm_customers"
DEALS_TABLE = "customer_leads"
QUOTES_TABLE = "quotes"
CONTACTS_TABLE = "crm_contacts"
CONTRACTS_TABLE = "contracts"
PROJECTS_TABLE = "projects"
LOG_TABLE = "crm_customer_cross_workspace_copy_log"


class CustomerCrossWorkspaceError(ValueError):
    """Lỗi nghiệp vụ (không phải lỗi hệ thống) - router trả message này thẳng cho FE."""


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _require_admin(user: dict[str, Any] | None) -> None:
    role = str((user or {}).get("role") or "").strip().lower()
    if role != "admin":
        raise PermissionError("Chỉ Admin mới được sao chép/di chuyển khách hàng sang workspace khác.")


def _validate_target_instance(target_instance: str | None) -> str:
    inst = (target_instance or "").strip()
    if inst not in VALID_TARGET_INSTANCES:
        raise CustomerCrossWorkspaceError(f"Workspace đích '{target_instance}' không hợp lệ.")
    return inst


def _log(action_type: str, source_instance: str, source_customer_id: str, target_instance: str, target_customer_id: str, actor_id: str | None) -> None:
    supabase: Client = get_supabase_client()
    try:
        supabase.table(LOG_TABLE).insert({
            "action_type": action_type,
            "source_instance": source_instance,
            "source_customer_id": source_customer_id,
            "target_instance": target_instance,
            "target_customer_id": target_customer_id,
            "performed_by": actor_id,
            "created_at": _now_iso(),
        }).execute()
    except Exception:  # noqa: BLE001 - log that bai khong duoc chan thao tac chinh
        pass


def _resolve_customer_code_for_instance(customer_id: str, instance: str) -> str:
    """Ban song song-an toan cua `_resolve_customer_code()`
    (supabase_project_service.py) - ham goc dung `_crm_instance()` NGAM DINH
    (instance dang chay cua chinh container), khong dung duoc o day vi
    customer MOI nam o `target_instance`, co the KHAC instance dang chay (vd
    dang chay o markee nhung target la cloudgate). Viet lai tuong tu nhung
    truyen instance tuong minh."""
    supabase = get_supabase_client()
    row = (
        supabase.table("crm_customers").select("customer_code, customer_name").eq("id", customer_id).eq("instance", instance).single().execute().data
    )
    if not row:
        raise ValueError("Không tìm thấy khách hàng vừa tạo ở workspace đích.")
    if row.get("customer_code"):
        return row["customer_code"]
    import re

    base = re.sub(r"[^A-Z0-9]", "", (row.get("customer_name") or "CUST").upper())[:10] or "CUST"
    for n in range(1, 20):
        candidate = base if n == 1 else f"{base}{n:02d}"
        try:
            updated = (
                supabase.table("crm_customers")
                .update({"customer_code": candidate})
                .eq("id", customer_id)
                .eq("instance", instance)
                .is_("customer_code", "null")
                .execute()
                .data
            )
            if updated:
                return candidate
        except Exception as exc:  # noqa: BLE001
            if _is_unique_violation(exc, "customer_code"):
                continue
            raise
    return base


def _next_project_seq_for_instance(prefix: str, instance: str) -> int:
    """Ban song song-an toan cua `_next_project_seq()` - ly do giong het ham
    tren, can truyen instance tuong minh thay vi dung instance ngam dinh."""
    supabase = get_supabase_client()
    rows = (
        supabase.table(PROJECTS_TABLE).select("project_code").eq("instance", instance).like("project_code", f"{prefix}%").execute().data or []
    )
    max_seq = 0
    for r in rows:
        suffix = (r.get("project_code") or "")[len(prefix):]
        if suffix.isdigit():
            max_seq = max(max_seq, int(suffix))
    return max_seq + 1


def _copy_contract_documents(old_contract_id: str, new_contract_id: str) -> int:
    """Copy toàn bộ phiên bản DOCX thật (+ metadata .json) trong bucket Storage
    `contract-documents` từ hợp đồng nguồn sang hợp đồng đích - giữ nguyên số
    phiên bản (v0001, v0002...). Trả số phiên bản đã copy được (best-effort,
    lỗi từng phiên bản không chặn các phiên bản khác)."""
    versions = contract_document_store.list_versions(old_contract_id)
    copied = 0
    for v in versions:
        version_no = v.get("version")
        if not version_no:
            continue
        docx_bytes = contract_document_store.load_version(old_contract_id, version_no)
        if not docx_bytes:
            continue
        try:
            contract_document_store._put(  # noqa: SLF001 - module noi bo, can giu dung ten/so phien ban khi copy
                f"contracts/{new_contract_id}/v{version_no:04d}.docx", docx_bytes, contract_document_store.DOCX_MIME,
            )
            meta = contract_document_store.load_meta(old_contract_id, version_no)
            if meta:
                contract_document_store._put(  # noqa: SLF001
                    f"contracts/{new_contract_id}/v{version_no:04d}.json",
                    json.dumps(meta, ensure_ascii=False).encode("utf-8"),
                    "application/json",
                )
            copied += 1
        except Exception:  # noqa: BLE001 - 1 phien ban loi khong duoc chan cac phien ban khac
            continue
    return copied


def copy_customer_deep_to_instance(customer_id: str, target_instance: str, user: dict[str, Any]) -> dict[str, Any]:
    """Admin-only: copy TOÀN BỘ cây dữ liệu của 1 Khách hàng (Cơ hội, Báo giá +
    hạng mục, Người liên hệ, Hợp đồng kể cả file DOCX thật, Dự án) sang 1
    workspace khác. Khách hàng gốc giữ nguyên hoàn toàn. Best-effort tuần tự -
    lỗi giữa chừng KHÔNG tự rollback, trả rõ đã copy tới đâu."""
    _require_admin(user)
    target_instance = _validate_target_instance(target_instance)
    source_instance = settings.crm_instance
    if target_instance == source_instance:
        raise CustomerCrossWorkspaceError("Không thể sao chép khách hàng về đúng workspace hiện tại.")

    supabase: Client = get_supabase_client()
    counts = {"deals": 0, "quotes": 0, "quote_items": 0, "contacts": 0, "contracts": 0, "contract_documents": 0, "projects": 0}

    customer_res = (
        supabase.table(CUSTOMERS_TABLE).select(CUSTOMER_COLUMNS).eq("id", customer_id).eq("instance", source_instance).execute()
    )
    if not customer_res.data:
        raise CustomerCrossWorkspaceError("Không tìm thấy khách hàng ở workspace hiện tại.")
    source_customer = customer_res.data[0]

    new_customer_id = str(uuid.uuid4())
    customer_copy = {k: v for k, v in source_customer.items() if k not in ("id", "created_at", "updated_at", "customer_code")}
    customer_copy["id"] = new_customer_id
    customer_copy["instance"] = target_instance
    try:
        res = supabase.table(CUSTOMERS_TABLE).insert(customer_copy).execute()
        new_customer = res.data[0]
        try:
            new_customer["customer_code"] = _resolve_customer_code_for_instance(new_customer["id"], target_instance)
        except Exception:  # noqa: BLE001
            pass
    except Exception as exc:  # noqa: BLE001
        return {"customer_id": None, "copied": counts, "error": f"Lỗi tạo khách hàng ở đích: {exc}"}

    try:
        # --- Du an (map truoc vi Deal/Quote co the tham chieu project_id) ---
        project_id_map: dict[str, str] = {}
        projects_res = supabase.table(PROJECTS_TABLE).select("*").eq("instance", source_instance).eq("customer_id", customer_id).execute()
        for row in projects_res.data or []:
            new_project_id = str(uuid.uuid4())
            # project_code co unique index toan bang (khong theo instance) -
            # KHONG duoc mang nguyen ma nguon sang (dung bi trung) - sinh ma
            # moi that theo dung co che create_project() (prefix theo
            # customer_code CUA KHACH HANG MOI + so thu tu, retry khi dung).
            copy_row = {k: v for k, v in row.items() if k not in ("id", "created_at", "updated_at", "project_code")}
            copy_row["id"] = new_project_id
            copy_row["instance"] = target_instance
            copy_row["customer_id"] = new_customer_id
            new_customer_code = _resolve_customer_code_for_instance(new_customer_id, target_instance)
            prefix = f"{datetime.now(timezone.utc).strftime('%Y-%m')}-{new_customer_code}"
            last_exc: Exception | None = None
            for attempt in range(5):
                seq = _next_project_seq_for_instance(f"{prefix}-", target_instance)
                candidate = f"{prefix}-{seq:03d}"
                try:
                    supabase.table(PROJECTS_TABLE).insert({**copy_row, "project_code": candidate}).execute()
                    last_exc = None
                    break
                except Exception as exc:  # noqa: BLE001
                    last_exc = exc
                    if _is_unique_violation(exc, "project_code") and attempt < 4:
                        continue
                    raise
            if last_exc:
                raise last_exc
            project_id_map[row["id"]] = new_project_id
            counts["projects"] += 1

        # --- Co hoi (Deal) ---
        deal_id_map: dict[str, str] = {}
        deals_res = supabase.table(DEALS_TABLE).select("*").eq("instance", source_instance).eq("customer_id", customer_id).execute()
        for row in deals_res.data or []:
            new_deal_id = str(uuid.uuid4())
            copy_row = {k: v for k, v in row.items() if k not in ("id", "created_at", "updated_at")}
            copy_row["id"] = new_deal_id
            copy_row["instance"] = target_instance
            copy_row["customer_id"] = new_customer_id
            if copy_row.get("project_id"):
                copy_row["project_id"] = project_id_map.get(copy_row["project_id"])
            if copy_row.get("primary_contact_id"):
                copy_row["primary_contact_id"] = None  # resolve lai sau khi copy Contact xong
            supabase.table(DEALS_TABLE).insert(copy_row).execute()
            deal_id_map[row["id"]] = new_deal_id
            counts["deals"] += 1

        # --- Nguoi lien he ---
        contact_id_map: dict[str, str] = {}
        contacts_res = supabase.table(CONTACTS_TABLE).select("*").eq("instance", source_instance).eq("customer_id", customer_id).execute()
        for row in contacts_res.data or []:
            new_contact_id = str(uuid.uuid4())
            # contact_code co unique index toan bang (sinh tu sequence DB,
            # vd "LH000264") - KHONG mang nguyen ma nguon sang, de DB tu sinh
            # ma moi khi insert (bo field nay khoi payload).
            copy_row = {k: v for k, v in row.items() if k not in ("id", "created_at", "updated_at", "contact_code")}
            copy_row["id"] = new_contact_id
            copy_row["instance"] = target_instance
            copy_row["customer_id"] = new_customer_id
            supabase.table(CONTACTS_TABLE).insert(copy_row).execute()
            contact_id_map[row["id"]] = new_contact_id
            counts["contacts"] += 1

        # Resolve lai primary_contact_id cho Deal sau khi co map Contact.
        for old_deal_id, new_deal_id in deal_id_map.items():
            old_deal = next((r for r in (deals_res.data or []) if r["id"] == old_deal_id), None)
            old_primary_contact = (old_deal or {}).get("primary_contact_id")
            if old_primary_contact and contact_id_map.get(old_primary_contact):
                supabase.table(DEALS_TABLE).update({"primary_contact_id": contact_id_map[old_primary_contact]}).eq("id", new_deal_id).execute()

        # --- Bao gia + hang muc ---
        old_deal_ids = list(deal_id_map.keys())
        if old_deal_ids:
            quotes_res = supabase.table(QUOTES_TABLE).select("*").eq("instance", source_instance).in_("deal_id", old_deal_ids).execute()
            for row in quotes_res.data or []:
                new_quote_id = str(uuid.uuid4())
                try:
                    new_quote_form_id = _resolve_target_quote_form(row["quote_form_id"], target_instance)
                except Exception as exc:  # noqa: BLE001 - 1 bao gia loi khong duoc chan cac bao gia khac
                    continue
                copy_row = {k: v for k, v in row.items() if k not in ("id", "created_at", "updated_at", "quote_number")}
                copy_row["id"] = new_quote_id
                copy_row["instance"] = target_instance
                copy_row["deal_id"] = deal_id_map[row["deal_id"]]
                copy_row["quote_form_id"] = new_quote_form_id
                copy_row["quote_number"] = _next_quote_number_for_instance(target_instance)
                copy_row["status"] = "draft"
                copy_row["public_token"] = None
                copy_row["public_enabled"] = False
                copy_row["public_access_mode"] = "none"
                copy_row["public_allowed_emails"] = []
                copy_row["public_allowed_phones"] = []
                copy_row["version_chain_id"] = new_quote_id
                copy_row["version_number"] = 1
                copy_row["parent_quote_id"] = None
                if copy_row.get("project_id"):
                    copy_row["project_id"] = project_id_map.get(copy_row["project_id"])
                supabase.table(QUOTES_TABLE).insert(copy_row).execute()
                _copy_items_to_quote(row["id"], new_quote_id)
                counts["quotes"] += 1

        # --- Hop dong (ke ca file that) ---
        or_filters = [f"customer_id.eq.{customer_id}"]
        if old_deal_ids:
            deal_ids_sql = ",".join(old_deal_ids)
            or_filters.append(f"deal_id.in.({deal_ids_sql})")
        contracts_res = (
            supabase.table(CONTRACTS_TABLE).select("*").eq("instance", source_instance).or_(",".join(or_filters)).execute()
        )
        for row in contracts_res.data or []:
            new_contract_id = str(uuid.uuid4())
            copy_row = {k: v for k, v in row.items() if k not in ("id", "created_at", "updated_at")}
            copy_row["id"] = new_contract_id
            copy_row["instance"] = target_instance
            copy_row["customer_id"] = new_customer_id
            if copy_row.get("deal_id"):
                copy_row["deal_id"] = deal_id_map.get(copy_row["deal_id"])
            # contract_number unique THEO INSTANCE (khac project_code/contact_code
            # la unique toan bang) - trung instance dich chi la truong hop hiem
            # (2 khach hang khac nguon cung danh so giong nhau) nhung van them
            # hau to de phong, tranh insert loi lam mat ca hop dong nay.
            try:
                supabase.table(CONTRACTS_TABLE).insert(copy_row).execute()
            except Exception as exc:  # noqa: BLE001
                if _is_unique_violation(exc, "contract_number"):
                    copy_row["contract_number"] = f"{copy_row.get('contract_number') or ''}-COPY-{new_contract_id[:6]}"
                    supabase.table(CONTRACTS_TABLE).insert(copy_row).execute()
                else:
                    raise
            counts["contracts"] += 1
            counts["contract_documents"] += _copy_contract_documents(row["id"], new_contract_id)
    except Exception as exc:  # noqa: BLE001 - tra ro da copy toi dau, khong rollback
        _log("copy", source_instance, customer_id, target_instance, new_customer_id, (user or {}).get("id"))
        return {"customer_id": new_customer_id, "copied": counts, "error": f"Lỗi giữa chừng khi copy dữ liệu con: {exc}"}

    _log("copy", source_instance, customer_id, target_instance, new_customer_id, (user or {}).get("id"))
    return {"customer_id": new_customer_id, "customer": normalize_city_fields(new_customer), "copied": counts, "error": None}


def move_customer_to_instance(customer_id: str, target_instance: str, user: dict[str, Any]) -> dict[str, Any]:
    """Admin-only: CHUYỂN HẲN 1 Khách hàng (và toàn bộ Cơ hội/Báo giá/Liên hệ/
    Hợp đồng/Dự án) sang workspace khác - KHÔNG tạo bản sao, chỉ đổi cột
    `instance` tại chỗ trên mọi bảng con (ID giữ nguyên, không remap FK gì
    cả). Workspace nguồn mất hẳn dữ liệu này sau khi move."""
    _require_admin(user)
    target_instance = _validate_target_instance(target_instance)
    source_instance = settings.crm_instance
    if target_instance == source_instance:
        raise CustomerCrossWorkspaceError("Không thể di chuyển khách hàng về đúng workspace hiện tại.")

    supabase: Client = get_supabase_client()
    customer_res = supabase.table(CUSTOMERS_TABLE).select("id").eq("id", customer_id).eq("instance", source_instance).execute()
    if not customer_res.data:
        raise CustomerCrossWorkspaceError("Không tìm thấy khách hàng ở workspace hiện tại.")

    deals_res = supabase.table(DEALS_TABLE).select("id").eq("instance", source_instance).eq("customer_id", customer_id).execute()
    deal_ids = [r["id"] for r in (deals_res.data or [])]

    quote_ids: list[str] = []
    if deal_ids:
        quotes_res = supabase.table(QUOTES_TABLE).select("id, quote_number").eq("instance", source_instance).in_("deal_id", deal_ids).execute()
        for row in quotes_res.data or []:
            quote_ids.append(row["id"])
            existing = (
                supabase.table(QUOTES_TABLE).select("id").eq("instance", target_instance).eq("quote_number", row["quote_number"]).execute()
            )
            if existing.data:
                new_number = _next_quote_number_for_instance(target_instance)
                supabase.table(QUOTES_TABLE).update({"quote_number": new_number}).eq("id", row["id"]).execute()

    supabase.table(CUSTOMERS_TABLE).update({"instance": target_instance}).eq("id", customer_id).execute()
    if deal_ids:
        supabase.table(DEALS_TABLE).update({"instance": target_instance}).eq("customer_id", customer_id).execute()
        supabase.table(QUOTES_TABLE).update({"instance": target_instance}).in_("deal_id", deal_ids).execute()
    supabase.table(CONTACTS_TABLE).update({"instance": target_instance}).eq("customer_id", customer_id).execute()

    or_filters = [f"customer_id.eq.{customer_id}"]
    if deal_ids:
        deal_ids_sql = ",".join(deal_ids)
        or_filters.append(f"deal_id.in.({deal_ids_sql})")
    supabase.table(CONTRACTS_TABLE).update({"instance": target_instance}).or_(",".join(or_filters)).execute()
    supabase.table(PROJECTS_TABLE).update({"instance": target_instance}).eq("customer_id", customer_id).execute()

    _log("move", source_instance, customer_id, target_instance, customer_id, (user or {}).get("id"))
    return {
        "customer_id": customer_id,
        "moved": {"deals": len(deal_ids), "quotes": len(quote_ids)},
    }


def copy_customers_deep_to_instance(assignments: list[dict[str, Any]], user: dict[str, Any]) -> dict[str, Any]:
    """Ban nhieu (bulk) cua copy_customer_deep_to_instance() - moi Khach hang
    duoc chon 1 workspace dich RIENG, dung y het copy_customers_to_instance()
    (shallow, crm_customer_service.py) nhung goi ham copy SAU."""
    copied: list[dict[str, Any]] = []
    failed: list[dict[str, Any]] = []
    for item in assignments:
        customer_id = str(item.get("customer_id") or "")
        target_instance = str(item.get("target_instance") or "")
        try:
            if not customer_id or not target_instance:
                raise ValueError("Thiếu customer_id hoặc target_instance.")
            result = copy_customer_deep_to_instance(customer_id, target_instance, user)
            if result.get("error"):
                raise ValueError(result["error"])
            copied.append(result)
        except Exception as exc:  # noqa: BLE001 - tra loi tung dong cho FE
            failed.append({"customer_id": customer_id, "message": str(exc)})
    return {"copied": copied, "failed": failed}


def move_customers_to_instance(assignments: list[dict[str, Any]], user: dict[str, Any]) -> dict[str, Any]:
    """Ban nhieu (bulk) cua move_customer_to_instance()."""
    moved: list[dict[str, Any]] = []
    failed: list[dict[str, Any]] = []
    for item in assignments:
        customer_id = str(item.get("customer_id") or "")
        target_instance = str(item.get("target_instance") or "")
        try:
            if not customer_id or not target_instance:
                raise ValueError("Thiếu customer_id hoặc target_instance.")
            moved.append(move_customer_to_instance(customer_id, target_instance, user))
        except Exception as exc:  # noqa: BLE001 - tra loi tung dong cho FE
            failed.append({"customer_id": customer_id, "message": str(exc)})
    return {"moved": moved, "failed": failed}
