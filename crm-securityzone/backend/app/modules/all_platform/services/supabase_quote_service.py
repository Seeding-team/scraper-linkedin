"""Supabase-based Quote Forms + Quotes service — real báo giá gắn với customer_leads.

Response dicts dùng camelCase để khớp thẳng với các TS type QuoteForm/Quote/QuoteItem/
QuoteReference phía frontend (modules/quotes) — tránh phải map lại 2 lần.
"""

from __future__ import annotations

import logging
import re
import secrets
from datetime import datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Any

from postgrest.exceptions import APIError
from supabase import Client

from app.core.config import settings
from app.core.supabase_client import get_supabase_client
from app.modules.all_platform.services.supabase_categories_service import get_categories_by_type

logger = logging.getLogger(__name__)


class QuoteNotFoundError(ValueError):
    """Bao gia khong ton tai (hoac da soft-delete va bi loc boi include_deleted=False).
    Subclass ValueError de moi `except ValueError` cu (khap noi trong
    routers/quote.py) TU DONG bat duoc va tra ve message than thien nay thay
    vi loi PGRST116 tho - khong can sua tung endpoint cu. Rieng 5 endpoint
    moi (cancel/revoke-public/soft-delete/restore/hard-delete) can HTTP 404
    that su thi router bat rieng exception nay TRUOC ValueError chung."""


def _is_zero_rows_error(exc: Exception) -> bool:
    return isinstance(exc, APIError) and exc.code == "PGRST116"

FORMS_TABLE = "quote_forms"
QUOTES_TABLE = "quotes"
ITEMS_TABLE = "quote_items"
ISSUER_COMPANIES_TABLE = "quote_issuer_companies"
# Việt Nam không có giờ mùa hè (DST) nên offset cố định +7 tương đương
# "Asia/Ho_Chi_Minh" và không cần dữ liệu tzdata của hệ điều hành (image
# production thiếu tzdata -> ZoneInfo() crash toàn bộ backend khi import).
VN_TZ = timezone(timedelta(hours=7))


def _crm_instance() -> str:
    instance = (settings.crm_instance or "").strip()
    if not instance:
        raise RuntimeError("CRM_INSTANCE is required for quote tenant scoping.")
    return instance


def _ensure_quote_in_instance(quote_id: str, include_deleted: bool = False) -> dict:
    return get_quote(quote_id, include_deleted=include_deleted)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _count_fields(sections: list[dict]) -> int:
    total = 0
    for section in sections or []:
        for f in section.get("fields", []):
            if f.get("type") == "repeater-table":
                total += len(f.get("config", {}).get("columns", []) or []) or 1
            else:
                total += 1
    return total


def _row_to_form(row: dict) -> dict:
    schema_json = row.get("schema_json") or {}
    sections = schema_json.get("sections") or []
    return {
        "id": row["id"],
        "code": row["code"],
        "name": row["name"],
        "description": row.get("description") or "",
        "status": row["status"],
        "isDefaultTemplate": row.get("is_default_template") or False,
        "issuerCompanyId": row.get("issuer_company_id"),
        "schemaVersion": row["schema_version"],
        "schemaJson": schema_json,
        "createdAt": row.get("created_at"),
        "updatedAt": row.get("updated_at"),
        "sectionCount": len(sections),
        "fieldCount": _count_fields(sections),
        "shareToken": row.get("share_token"),
        "shareEnabled": row.get("share_enabled") or False,
        "shareUrl": f"/public/quote-forms/{row['share_token']}" if row.get("share_token") else None,
    }


def _row_to_item(row: dict) -> dict:
    return {
        "id": row["id"],
        "quoteId": row["quote_id"],
        "parentItemId": row.get("parent_item_id"),
        # Muc cha (Section, migration 104) / hang muc that (Item, mac dinh) -
        # section KHONG tinh tien (server da ep qty/gia ve 0/NULL o
        # quote_update), FE dung field nay de render tieu de nhom + AN het
        # cac o nhap SL/gia von/markup/gia khach cho dong nay.
        "rowType": row.get("row_type") or "item",
        "description": row.get("description") or "",
        "serviceDescription": row.get("service_description") or "",
        # Ghi chu RIENG cho tung hang muc (migration 105, vd "Giảm giá 15%
        # theo chính sách ưu đãi khách hàng đầu tiên") - khac han
        # internalRequestNote/customBlocks (ghi chu CHUNG ca bao gia) - CONG
        # KHAI (co trong _PUBLIC_ITEM_KEYS ben duoi), khong phai du lieu noi
        # bo nhu cost_price/markup_percent.
        "note": row.get("note") or "",
        "unit": row.get("unit"),
        "quantity": float(row.get("quantity") or 0),
        "unitPrice": float(row.get("unit_price") or 0),
        "discountPercent": float(row.get("discount_percent") or 0),
        "discountAmount": float(row.get("discount_amount") or 0),
        "amountAfterDiscount": float(row.get("amount_after_discount") or 0),
        "vatRate": float(row.get("vat_rate") or 0),
        "subtotalAmount": float(row.get("subtotal_amount") or 0),
        "vatAmount": float(row.get("vat_amount") or 0),
        "totalAmount": float(row.get("total_amount") or 0),
        "sortOrder": row.get("sort_order") or 0,
        "catalogItemId": row.get("catalog_item_id"),
        "bundleSnapshot": row.get("bundle_snapshot"),
        "listPriceUsd": row.get("list_price_usd"),
        "unitPriceUsd": row.get("unit_price_usd"),
        "exchangeRate": row.get("exchange_rate"),
        "unitPriceVnd": row.get("unit_price_vnd"),
        # Gia von/markup (migration 086) - CHI dung noi bo (authenticated).
        # _row_to_item() KHONG BAO GIO duoc goi cho duong public (xem
        # _row_to_public_item() rieng o tren, dung allowlist tu dau, khong ke
        # thua ham nay) nen an toan them truc tiep o day.
        "costPrice": (float(row["cost_price"]) if row.get("cost_price") is not None else None),
        "markupPercent": (float(row["markup_percent"]) if row.get("markup_percent") is not None else None),
        "costNotApplicable": bool(row.get("cost_not_applicable") or False),
        "costTotal": (
            float(row["cost_price"]) * float(row.get("quantity") or 0)
            if row.get("cost_price") is not None
            else None
        ),
        # Bang gia VPS Zone (migration 106) - CHI dung noi bo (authenticated),
        # giong het cost_price/markup_percent o tren. price_book_snapshot la
        # ban dong cung IN/EU/VAT/gia tham chieu luc chon - KHONG BAO GIO doc
        # lai price_book_items sau khi da co snapshot nay.
        "priceBookItemId": row.get("price_book_item_id"),
        "priceBookVersionId": row.get("price_book_version_id"),
        "priceBookSnapshot": row.get("price_book_snapshot"),
        "costOverrideReason": row.get("cost_override_reason"),
        "costOverrideBy": row.get("cost_override_by"),
        "costOverrideAt": row.get("cost_override_at"),
        "costPriceOriginal": (
            float(row["cost_price_original"]) if row.get("cost_price_original") is not None else None
        ),
        "children": [],
    }


def _quote_cost_summary(row: dict, raw_items: list[dict] | None) -> dict:
    """Tinh Tong gia von / Doanh thu thuan / Loi nhuan gop / Gross margin THAT
    su o backend (khong luu DB, luon tinh lai tu cost_price/quantity that cua
    tung dong + quotes.total_amount/vat_amount that) - CHI dung noi bo,
    KHONG BAO GIO goi cho duong public. Doanh thu thuan = total_amount -
    vat_amount (= SUM(amount_after_discount) that su - da xac minh dung cong
    thuc quote_update, KHONG phai total_amount vi so do DA GOM VAT)."""
    # hasCostData PHAI la "DA GIAI QUYET DU MOI hang muc" (co cost_price HOAC
    # duoc danh dau cost_not_applicable=true), KHONG PHAI "co IT NHAT 1 hang
    # muc co cost_price" - bug that da tim thay: logic cu (any(...)) khien
    # quote co 1/14 hang muc da nhap cost van bao hasCostData=true va tinh
    # costTotal/margin CHI tren 1 dong do, AM THAM bo qua 13 dong con lai
    # (hieu la cost=0 cho chung) - lam SAI LECH margin theo huong lac quan
    # gia (cost bi hieu thap hon that, margin bi hien cao hon that). Item
    # cost_not_applicable=true (Presale danh dau "khong ap dung", vd hang muc
    # mien phi/da bao gom o dong khac) tinh la DA GIAI QUYET, dong gop 0 vao
    # cost_total - KHONG lam quote bi coi la "thieu cost".
    raw_items = raw_items or []
    # BUG THAT DA GAP: raw_items goi vao day gom CA dong "Muc cha" (Section,
    # row_type='section') - Section chi la 1 nhom LY THUYET de gom hang muc
    # con lai gan nhau, KHONG bao gio co cost_price/cost_not_applicable rieng
    # (server ep 0/NULL cho Section trong append_item() o tren). Truoc day
    # check has_cost_data goi thang tren raw_items (chua loc) nen CHI CAN co 1
    # Section la all(...) luon False -> hasCostData/Tong gia von/Loi nhuan gop
    # bien mat het du MOI hang muc that (row_type='item') da nhap du cost -
    # "thêm mục cha vô thì k thấy tổng giá vốn nữa" la dung bug nay. Loc chi
    # con hang muc THAT (row_type='item') truoc khi tinh.
    real_items = [item for item in raw_items if (item.get("row_type") or "item") == "item"]
    # netRevenue (Doanh thu thuan = gia KHACH truoc VAT sau chiet khau) chi phu
    # thuoc total_amount/vat_amount cua CHINH quote nay - KHONG lien quan gi
    # toi viec Presale da nhap cost_price hay chua. Bug that da tim thay: ban
    # truoc GOP netRevenue vao chung 1 nhanh voi hasCostData (return None het
    # neu chua co cost) => "Gia khach" tren UI (alias tu netRevenue) bi hien
    # rong/"—" trong luc cho Presale nhap gia von, dung ra No PHAI luon hien
    # ngay khi Sale da nhap gia ban xong (total_amount > 0), khong doi trang
    # thai Presale. netRevenue tach rieng khoi has_cost_data tu day.
    net_revenue = float(row.get("total_amount") or 0) - float(row.get("vat_amount") or 0)
    has_cost_data = bool(real_items) and all(
        item.get("cost_price") is not None or bool(item.get("cost_not_applicable")) for item in real_items
    )
    if not has_cost_data:
        return {"hasCostData": False, "costTotal": None, "netRevenue": net_revenue, "grossProfit": None, "grossMarginPercent": None}
    cost_total = sum(
        float(item["cost_price"]) * float(item.get("quantity") or 0)
        for item in real_items
        if item.get("cost_price") is not None
    )
    gross_profit = net_revenue - cost_total
    gross_margin_percent = (gross_profit / net_revenue * 100) if net_revenue > 0 else None
    return {
        "hasCostData": True,
        "costTotal": cost_total,
        "netRevenue": net_revenue,
        "grossProfit": gross_profit,
        "grossMarginPercent": gross_margin_percent,
    }


def _row_to_quote(row: dict, items: list[dict] | None = None) -> dict:
    return {
        "id": row["id"],
        "dealId": row.get("deal_id"),
        "quoteFormId": row["quote_form_id"],
        "issuerCompanyId": row.get("issuer_company_id"),
        "quoteNumber": row["quote_number"],
        "status": row["status"],
        "formSchemaVersion": row["form_schema_version"],
        "formSnapshot": row.get("form_snapshot") or {},
        "data": row.get("data") or {},
        "items": _quote_item_tree(items or []),
        "subtotalAmount": float(row.get("subtotal_amount") or 0),
        "vatAmount": float(row.get("vat_amount") or 0),
        "totalAmount": float(row.get("total_amount") or 0),
        "currency": row.get("currency") or "VND",
        "issuedAt": row.get("issued_at"),
        "validUntil": row.get("valid_until"),
        "createdById": row.get("created_by"),
        "createdAt": row.get("created_at"),
        "updatedAt": row.get("updated_at"),
        "updatedById": row.get("updated_by"),
        "approvedById": row.get("approved_by"),
        "approvedAt": row.get("approved_at"),
        "publicToken": row.get("public_token"),
        "publicUrl": f"/public/quotes/{row['public_token']}" if row.get("public_token") else None,
        "publicEnabled": row.get("public_enabled") if row.get("public_enabled") is not None else True,
        # "Giới hạn xem link theo email" (migration 116) - NOI BO, khong bao
        # gio lo qua _row_to_public_quote (danh sach email khong phai du lieu
        # cho khach xem link cong khai thay).
        "publicAccessMode": row.get("public_access_mode") or "none",
        "publicAllowedEmails": row.get("public_allowed_emails") or [],
        "publicAllowedPhones": row.get("public_allowed_phones") or [],
        "versionChainId": row.get("version_chain_id"),
        "versionNumber": row.get("version_number") or 1,
        "parentQuoteId": row.get("parent_quote_id"),
        # Phase 2 "Workspace xu ly bao gia" (migration 085) - buoc xu ly noi bo
        # (chi y nghia khi status='draft', xem quote_set_processing_stage) +
        # nguoi phu trach ky thuat/bao gia (co the khac created_by).
        "processingStage": row.get("processing_stage") or "request",
        "technicalOwnerId": row.get("technical_owner_id"),
        "quoteOwnerId": row.get("quote_owner_id"),
        # Phase 1/3 lifecycle that (migration 087) - noi bo, khong bao gio
        # loi qua _row_to_public_quote.
        "deletedAt": row.get("deleted_at"),
        "cancellationReason": row.get("cancellation_reason"),
        "cancelledAt": row.get("cancelled_at"),
        "cancelledById": row.get("cancelled_by"),
        "publishedAt": row.get("published_at"),
        "publishedById": row.get("published_by"),
        "sentAt": row.get("sent_at"),
        "sentById": row.get("sent_by"),
        "requestedChangesTargetStage": row.get("requested_changes_target_stage"),
        "requestedChangesReason": row.get("requested_changes_reason"),
        "requestedChangesAt": row.get("requested_changes_at"),
        "requestedChangesById": row.get("requested_changes_by"),
        # Du an + SLA that (migration 097) - projectId noi bo, KHONG bao gio
        # loi qua _row_to_public_quote (allowlist rieng, xem duoi). SLA la
        # han XU LY NOI BO, KHAC HOAN TOAN validUntil (hieu luc bao gia VOI
        # KHACH HANG, da co tu 028).
        "projectId": row.get("project_id"),
        "slaStartedAt": row.get("sla_started_at"),
        "slaDueAt": row.get("sla_due_at"),
        "completedAt": row.get("completed_at"),
        # Giam gia tong cap quote (migration 106, muc 6.9) - None = khong ap
        # dung. CHI dung noi bo (chua co yeu cau hien thi tren public/PDF -
        # xem _row_to_public_quote() rieng o tren, KHONG them field nay vao do
        # tru khi co yeu cau ro rang).
        "overallDiscountPercent": (
            float(row["overall_discount_percent"]) if row.get("overall_discount_percent") is not None else None
        ),
        # "Loai bao gia" (migration 112) - multi-select, luu CODE cua
        # category_type='crm_quote_type'. Doc/sua ngay tren cot phang cua
        # quotes (khong phai RPC), giong y het pattern overall_discount_percent
        # o tren - xem update_quote() phia duoi (direct_fields).
        "quoteTypeCodes": row.get("quote_type_codes") or [],
        # Gia von/loi nhuan (migration 086) - tinh THAT o backend, khong tin
        # so tong tu frontend. CHI dung noi bo (_row_to_quote khong bao gio
        # duoc goi cho duong public - xem _row_to_public_quote rieng o tren).
        **_quote_cost_summary(row, items),
    }


# 4 NHOM RIENG BIET (sua lai LAN 2 sau khi bi bac bo - lan 1 gop chung 1 ham
# strip_cost_fields_for_user() xoa lan gia von/gia ban/loi nhuan; lan 2 mo qua
# rong nhom "gia ban" khien Presale (chi la technical_owner) van xem duoc
# markupPercent - SAI vi markupPercent la chien luoc noi bo cua Sale):
#   A. Cost noi bo (costPrice/costTotal(item)/costNotApplicable/quote.costTotal/
#      quote.hasCostData) - gac boi can_view_quote_cost() (admin/technical_
#      owner/quote_owner duoc XEM read-only, chi technical_owner duoc SUA).
#   B. Pricing noi bo (markupPercent - chien luoc markup cua Sale, KHONG phai
#      so hien thi cho khach) - gac boi can_view_quote_pricing() (CHI admin/
#      quote_owner, Presale chi la technical_owner KHONG duoc xem).
#   C. Customer commercial (unitPrice/discountPercent/discountAmount/
#      amountAfterDiscount/vatRate/totalAmount/netRevenue/
#      customerPriceBeforeVat/payment terms trong quote.data) - KHONG gac
#      field-level o day, day la so THAT SU xuat hien tren ban bao gia gui
#      khach, ai xem duoc quote (da chan o tang endpoint/can_edit_quote) deu
#      xem duoc nhom nay binh thuong.
#   D. Profitability (grossProfit/grossMarginPercent) - gac boi
#      can_view_quote_profitability() (CHI admin/quote_owner).
_QUOTE_COST_KEYS = ("costTotal", "hasCostData")
_QUOTE_PRICING_KEYS: tuple[str, ...] = ()  # markupPercent chi o item-level, khong co field quote-level rieng
_QUOTE_PROFIT_KEYS = ("grossProfit", "grossMarginPercent")
_ITEM_COST_KEYS = ("costPrice", "costNotApplicable", "costTotal")
_ITEM_PRICING_KEYS = ("markupPercent",)


def _strip_item_fields(item: dict, strip_cost: bool, strip_pricing: bool) -> dict:
    # Giu nguyen KEY (dat None) thay vi xoa han - FE/TS type dinh nghia san
    # cac field nay luon co mat tren Quote/QuoteItem, xoa han key se lam FE
    # doc `item.costPrice` ra `undefined` thay vi `null` (khac hanh vi ky
    # vong, co the gay loi runtime o cac cho dang assume key ton tai).
    stripped = dict(item)
    if strip_cost:
        for key in _ITEM_COST_KEYS:
            if key in stripped:
                stripped[key] = None if key != "costNotApplicable" else False
    if strip_pricing:
        for key in _ITEM_PRICING_KEYS:
            if key in stripped:
                stripped[key] = None
    stripped["children"] = [
        _strip_item_fields(child, strip_cost, strip_pricing) for child in (item.get("children") or [])
    ]
    return stripped


def apply_quote_field_permissions(quote: dict, user: dict | None) -> dict:
    """Ap dung 3 lop quyen doc DOC LAP (KHONG dung chung 1 boolean cho nhieu
    nhom field): can_view_quote_cost (nhom A), can_view_quote_pricing (nhom
    B - markupPercent), can_view_quote_profitability (nhom D). Nhom C
    (customer commercial: unitPrice/discount/VAT/totalAmount/netRevenue/
    customerPriceBeforeVat/payment terms) KHONG bi dong o day - day la so
    THAT SU tren ban bao gia gui khach, ai xem duoc quote deu xem duoc nhom
    C binh thuong (quyen SUA nhom C van gac rieng o can_edit_quote_pricing,
    khong lien quan ham nay).

    3 co the DOC duoc tu response ("Khong co quyen xem" != "Chua co du lieu"
    - 2 y nghia khac nhau, UI PHAI phan biet):
      - costViewAllowed: False => FE hien "Không có quyền xem" (khong phai
        "Chưa có") bat ke hasCostData/costTotal la gi.
      - pricingViewAllowed: False => FE an markupPercent tung dong, hien
        "Không có quyền xem" thay vi so that.
      - profitabilityViewAllowed: False => FE hien "Không có quyền xem" cho
        Margin, khac voi "Chưa tính" (chua du du lieu de tinh)."""
    from app.modules.all_platform.services.crm_permission_service import (
        can_view_quote_cost,
        can_view_quote_pricing,
        can_view_quote_profitability,
    )

    cost_allowed = can_view_quote_cost(user, quote)
    pricing_allowed = can_view_quote_pricing(user, quote)
    profit_allowed = can_view_quote_profitability(user, quote)
    result = dict(quote)
    result["costViewAllowed"] = cost_allowed
    result["pricingViewAllowed"] = pricing_allowed
    result["profitabilityViewAllowed"] = profit_allowed
    if not cost_allowed:
        for key in _QUOTE_COST_KEYS:
            if key in result:
                result[key] = False if key == "hasCostData" else None
    if not profit_allowed:
        for key in _QUOTE_PROFIT_KEYS:
            if key in result:
                result[key] = None
    if (not cost_allowed or not pricing_allowed) and "items" in result:
        result["items"] = [
            _strip_item_fields(item, strip_cost=not cost_allowed, strip_pricing=not pricing_allowed)
            for item in (result.get("items") or [])
        ]
    return result


# ── Public DTO (get_public_quote - link cong khai + PDF khach hang) ────────
#
# ALLOWLIST THAT SU - moi ham duoi day dung tu RAW DB row (khong phai dict da
# map cho noi bo qua _row_to_quote/_row_to_item), TU DUNG lai tung field bang
# ten cu the. KHONG bao gio "lay het roi xoa bot" (deny-list) - field DB/noi
# bo moi trong tuong lai (vd cost_price/markup_percent o migration 086, hay
# bat ky cot noi bo nao sau nay) MAC DINH KHONG xuat hien tren API cong khai,
# tru khi co ai do CHU DONG them dung ten vao dict duoi day.
_PUBLIC_ITEM_KEYS = (
    "id", "parentItemId", "rowType", "description", "serviceDescription", "note", "unit", "quantity",
    "unitPrice", "discountPercent", "discountAmount", "amountAfterDiscount", "vatRate",
    "subtotalAmount", "vatAmount", "totalAmount", "sortOrder",
    "catalogItemId", "bundleSnapshot", "listPriceUsd", "unitPriceUsd", "exchangeRate", "unitPriceVnd",
)


def _row_to_public_item(row: dict) -> dict:
    """Dung RIENG cho public/PDF - doc truc tiep tu RAW quote_items row (KHONG
    qua _row_to_item noi bo), dung explicit field list o tren. Tuyet doi
    KHONG co cost_price/markup_percent (migration 086) o day."""
    return {
        "id": row.get("id"),
        "parentItemId": row.get("parent_item_id"),
        "rowType": row.get("row_type") or "item",
        "description": row.get("description") or "",
        "serviceDescription": row.get("service_description") or "",
        # Ghi chu RIENG cho tung hang muc (migration 105, vd "Giảm giá 15%
        # theo chính sách ưu đãi khách hàng đầu tiên") - khac han
        # internalRequestNote/customBlocks (ghi chu CHUNG ca bao gia) - CONG
        # KHAI (co trong _PUBLIC_ITEM_KEYS ben duoi), khong phai du lieu noi
        # bo nhu cost_price/markup_percent.
        "note": row.get("note") or "",
        "unit": row.get("unit"),
        "quantity": float(row.get("quantity") or 0),
        "unitPrice": float(row.get("unit_price") or 0),
        "discountPercent": float(row.get("discount_percent") or 0),
        "discountAmount": float(row.get("discount_amount") or 0),
        "amountAfterDiscount": float(row.get("amount_after_discount") or 0),
        "vatRate": float(row.get("vat_rate") or 0),
        "subtotalAmount": float(row.get("subtotal_amount") or 0),
        "vatAmount": float(row.get("vat_amount") or 0),
        "totalAmount": float(row.get("total_amount") or 0),
        "sortOrder": row.get("sort_order") or 0,
        "catalogItemId": row.get("catalog_item_id"),
        "bundleSnapshot": row.get("bundle_snapshot"),
        "listPriceUsd": row.get("list_price_usd"),
        "unitPriceUsd": row.get("unit_price_usd"),
        "exchangeRate": row.get("exchange_rate"),
        "unitPriceVnd": row.get("unit_price_vnd"),
        "children": [],
    }


def _public_item_tree(rows: list[dict]) -> list[dict]:
    """Ban sao doc lap cua _quote_item_tree() nhung dung _row_to_public_item -
    co the trung lap logic voi ham noi bo, CHU Y: co tinh, de nhanh public
    khong bao gio phu thuoc vao nhanh noi bo (sua/them field o _row_to_item
    khong the vo tinh lam lo field moi qua duong nay)."""
    mapped = [_row_to_public_item(row) for row in rows]
    by_id = {item["id"]: item for item in mapped if item.get("id")}
    roots: list[dict] = []
    for item in mapped:
        parent_id = item.get("parentItemId")
        if parent_id and parent_id in by_id:
            by_id[parent_id].setdefault("children", []).append(item)
        else:
            roots.append(item)
    for item in mapped:
        item["children"] = sorted(item.get("children") or [], key=lambda child: child.get("sortOrder") or 0)
    return sorted(roots, key=lambda item: item.get("sortOrder") or 0)


def _public_data_allowlist(data: dict, form_snapshot: dict) -> dict:
    """`quotes.data` la JSONB schema-less (dung cho ca field khach hang THAT
    (vd quoteTitle, customerRecipient...) LAN field noi bo them sau nay
    (internalRequestNote, requestSummary...) - KHONG the liet ke tay het field
    khach hang vi no phu thuoc SCHEMA CUA TUNG MAU BAO GIA (form_snapshot,
    khac nhau giua cac mau). Allowlist THAT: chi cho qua nhung key nam trong
    CHINH form_snapshot.sections[].fields[].key cua mau nay (tuc la field ma
    NGUOI TAO MAU da khai bao la thuoc ve to bao gia - allowlist tu nguon
    du lieu, khong phai danh sach tay co the thieu sot) + 'customBlocks' (khoi
    noi dung Sale chu dong them CHO KHACH xem, da xac nhan khong chua cost/
    markup/margin). Bat ky key nao KHAC (vd internalRequestNote,
    secretFutureField...) deu bi loai vi khong nam trong 2 nhom nay."""
    schema_keys: set[str] = set()
    for section in (form_snapshot or {}).get("sections") or []:
        for field in section.get("fields") or []:
            key = field.get("key")
            if key:
                schema_keys.add(key)
    allowed = schema_keys | {"customBlocks"}
    return {key: value for key, value in (data or {}).items() if key in allowed}


def _row_to_public_quote(row: dict, raw_items: list[dict] | None = None) -> dict:
    """Dung RIENG cho get_public_quote() (link cong khai/PDF khach hang) - dung
    TU DAU tu RAW DB row (khong qua _row_to_quote noi bo), chi lay dung cac
    field da duyet ben duoi. KHONG bao gio goi _row_to_quote() o day - lam
    vay se vo tinh ke thua moi field noi bo _row_to_quote co the them trong
    tuong lai (processingStage/technicalOwnerId/quoteOwnerId da la vi du
    thuc te)."""
    form_snapshot = row.get("form_snapshot") or {}
    return {
        "id": row.get("id"),
        "dealId": row.get("deal_id"),
        "quoteFormId": row.get("quote_form_id"),
        "issuerCompanyId": row.get("issuer_company_id"),
        "quoteNumber": row.get("quote_number"),
        "status": row.get("status"),
        "formSchemaVersion": row.get("form_schema_version"),
        "formSnapshot": form_snapshot,
        "data": _public_data_allowlist(row.get("data") or {}, form_snapshot),
        "items": _public_item_tree(raw_items or []),
        "subtotalAmount": float(row.get("subtotal_amount") or 0),
        "vatAmount": float(row.get("vat_amount") or 0),
        "totalAmount": float(row.get("total_amount") or 0),
        "currency": row.get("currency") or "VND",
        "issuedAt": row.get("issued_at"),
        "validUntil": row.get("valid_until"),
        "createdAt": row.get("created_at"),
        "updatedAt": row.get("updated_at"),
        "approvedAt": row.get("approved_at"),
        "publicToken": row.get("public_token"),
        "publicUrl": f"/public/quotes/{row['public_token']}" if row.get("public_token") else None,
        "publicEnabled": row.get("public_enabled") if row.get("public_enabled") is not None else True,
        "versionChainId": row.get("version_chain_id"),
        "versionNumber": row.get("version_number") or 1,
        "parentQuoteId": row.get("parent_quote_id"),
    }


def _row_to_issuer_company(row: dict) -> dict:
    return {
        "id": row["id"],
        "code": row["code"],
        "legalName": row["legal_name"],
        "brandName": row.get("brand_name"),
        "address": row.get("address"),
        "contactName": row.get("contact_name"),
        "phone": row.get("phone"),
        "email": row.get("email"),
        "website": row.get("website"),
        "taxCode": row.get("tax_code"),
        "logoUrl": row.get("logo_url"),
        "defaultQuoteFormId": row.get("default_quote_form_id"),
        "status": row.get("status") or "active",
    }


def list_issuer_companies(include_inactive: bool = False) -> list[dict]:
    """Danh sách công ty phát hành báo giá (bên bán). Mặc định chỉ trả company
    active (dùng cho dropdown Bước 1 wizard) - trang quản trị mới cần cả
    inactive nên truyền include_inactive=True."""
    supabase: Client = get_supabase_client()
    query = supabase.table(ISSUER_COMPANIES_TABLE).select("*")
    if not include_inactive:
        query = query.eq("status", "active")
    result = query.order("sort_order").execute()
    return [_row_to_issuer_company(row) for row in (result.data or [])]


def create_issuer_company(payload: dict) -> dict:
    supabase: Client = get_supabase_client()
    insert_data = {
        "code": payload["code"],
        "legal_name": payload["legal_name"],
        "brand_name": payload.get("brand_name"),
        "address": payload.get("address"),
        "contact_name": payload.get("contact_name"),
        "phone": payload.get("phone"),
        "email": payload.get("email"),
        "website": payload.get("website"),
        "tax_code": payload.get("tax_code"),
        "logo_url": payload.get("logo_url"),
        "default_quote_form_id": payload.get("default_quote_form_id"),
        "status": payload.get("status") or "active",
        "sort_order": payload.get("sort_order") or 0,
    }
    result = supabase.table(ISSUER_COMPANIES_TABLE).insert(insert_data).execute()
    return _row_to_issuer_company(result.data[0])


def update_issuer_company(company_id: str, payload: dict) -> dict:
    supabase: Client = get_supabase_client()
    field_map = {
        "code": "code", "legal_name": "legal_name", "brand_name": "brand_name",
        "address": "address", "contact_name": "contact_name", "phone": "phone",
        "email": "email", "website": "website", "tax_code": "tax_code",
        "logo_url": "logo_url", "default_quote_form_id": "default_quote_form_id",
        "status": "status", "sort_order": "sort_order",
    }
    update_data = {field_map[k]: v for k, v in payload.items() if k in field_map and v is not None}
    # logo_url/website/... rong "" (xoa logo/field) van phai ap dung duoc - chi
    # loai None (khong gui field do len), khong loai chuoi rong.
    result = supabase.table(ISSUER_COMPANIES_TABLE).update(update_data).eq("id", company_id).execute()
    return _row_to_issuer_company(result.data[0])


def _quote_items(quote_id: str) -> list[dict]:
    supabase: Client = get_supabase_client()
    result = (
        supabase.table(ITEMS_TABLE)
        .select("*")
        .eq("quote_id", quote_id)
        .order("sort_order")
        .execute()
    )
    return result.data or []


def _quote_item_tree(rows: list[dict]) -> list[dict]:
    mapped = [_row_to_item(row) for row in rows]
    by_id = {item["id"]: item for item in mapped if item.get("id")}
    roots: list[dict] = []
    for item in mapped:
        parent_id = item.get("parentItemId")
        if parent_id and parent_id in by_id:
            by_id[parent_id].setdefault("children", []).append(item)
        else:
            roots.append(item)
    for item in mapped:
        item["children"] = sorted(item.get("children") or [], key=lambda child: child.get("sortOrder") or 0)
    return sorted(roots, key=lambda item: item.get("sortOrder") or 0)


def _slug_code(name: str) -> str:
    import re
    import unicodedata

    normalized = unicodedata.normalize("NFD", name)
    ascii_name = "".join(c for c in normalized if unicodedata.category(c) != "Mn")
    ascii_name = ascii_name.replace("đ", "d").replace("Đ", "D")
    slug = re.sub(r"[^a-zA-Z0-9]+", "_", ascii_name).strip("_").upper()
    return slug or "QUOTE_FORM"


def _unique_code(base_name: str, ignore_id: str | None = None) -> str:
    supabase: Client = get_supabase_client()
    base = _slug_code(base_name)
    candidate = base
    suffix = 2
    while True:
        query = supabase.table(FORMS_TABLE).select("id").eq("code", candidate)
        existing = query.execute().data or []
        existing = [row for row in existing if row["id"] != ignore_id]
        if not existing:
            return candidate
        candidate = f"{base}_{suffix}"
        suffix += 1


def _next_quote_number() -> str:
    """Số báo giá = giờ tạo (giờ Việt Nam) dạng YYYYMMDDHHMM, vd "202608262135".
    Không có hậu tố nếu là báo giá đầu tiên tạo trong phút đó; nếu trùng phút với
    báo giá khác thì mới thêm hậu tố "-02", "-03"... (đếm từ 2, không phải từ 1 -
    báo giá đầu tiên trong phút luôn hiện số trần, không có "-01")."""
    supabase: Client = get_supabase_client()
    base = datetime.now(VN_TZ).strftime("%Y%m%d%H%M")
    result = (
        supabase.table(QUOTES_TABLE)
        .select("quote_number")
        .eq("instance", _crm_instance())
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
        except (ValueError, IndexError):
            continue
    return f"{base}-{max_seq + 1:02d}"


def _validate_percent(value: Any, field_name: str) -> float:
    try:
        pct = float(value or 0)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field_name} must be between 0 and 100.") from exc
    if pct < 0 or pct > 100:
        raise ValueError(f"{field_name} must be between 0 and 100.")
    return pct


def _to_decimal(value: Any) -> Decimal:
    try:
        return Decimal(str(value if value is not None else 0))
    except (InvalidOperation, ValueError):
        return Decimal(0)


def _round_vnd(value: Decimal) -> float:
    """VNĐ khong co phan thap phan - lam tron ve DONG NGUYEN (ROUND_HALF_UP)
    truoc khi tra ra float de luu DB. Sua bug that phat hien qua UI (VD:
    unitPrice tinh nguoc tu Margin muc tieu ra so co qua nhieu chu so thap
    phan nhu 1428571.4285714286 - dung Decimal + quantize o day de moi so
    tien server luu/tra ve LUON la dong nguyen, khong chi lam tron o tang
    hien thi FE roi van luu so sai xuong DB)."""
    return float(value.quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def _calculate_item(quantity: float, unit_price: float, vat_rate: float, discount_percent: float = 0) -> tuple[float, float, float, float, float]:
    q = _to_decimal(quantity)
    u = _to_decimal(unit_price)
    d_pct = _to_decimal(discount_percent)
    v_pct = _to_decimal(vat_rate)
    subtotal = q * u
    discount = subtotal * d_pct / 100
    after_discount = subtotal - discount
    vat = after_discount * v_pct / 100
    total = after_discount + vat
    return (
        _round_vnd(subtotal),
        _round_vnd(discount),
        _round_vnd(after_discount),
        _round_vnd(vat),
        _round_vnd(total),
    )


def _calculate_totals(items: list[dict]) -> tuple[float, float, float]:
    subtotal = sum(i["subtotal"] for i in items)
    vat = sum(i["vat"] for i in items)
    return subtotal, vat, subtotal + vat


def _flatten_computed_items(raw_items: list[dict]) -> tuple[list[dict], float, float, float]:
    flattened: list[dict] = []
    subtotal = 0.0
    vat = 0.0
    total = 0.0

    def append_item(item: dict, parent_temp_index: int | None, sort_order: int) -> int:
        nonlocal subtotal, vat, total
        row_type = "section" if item.get("row_type") == "section" else "item"
        if row_type == "section":
            # Muc cha (Section) KHONG tinh tien - ep ve 0/NULL o SERVER, giong
            # het logic da ap dung trong RPC quote_update() (migration 104),
            # khong tin gia tri client gui len cho dong nay.
            item = {
                **item,
                "quantity": 0, "unit_price": 0, "discount_percent": 0, "vat_rate": 0,
                "cost_price": None, "markup_percent": None, "cost_not_applicable": False,
            }
        discount_percent = _validate_percent(item.get("discount_percent"), "discount_percent")
        vat_rate = _validate_percent(item.get("vat_rate"), "vat_rate")
        item_subtotal, item_discount, item_after_discount, item_vat, item_total = _calculate_item(
            float(item.get("quantity") or 0),
            float(item.get("unit_price") or 0),
            vat_rate,
            discount_percent,
        )
        row = {
            **item,
            "row_type": row_type,
            "parent_temp_index": parent_temp_index,
            "sort_order": sort_order,
            "discount_percent": discount_percent,
            "vat_rate": vat_rate,
            "subtotal": item_subtotal,
            "discount": item_discount,
            "after_discount": item_after_discount,
            "vat": item_vat,
            "total": item_total,
        }
        flattened.append(row)
        subtotal += item_subtotal
        vat += item_vat
        total += item_total
        return len(flattened) - 1

    for parent_index, item in enumerate(raw_items):
        parent_flat_index = append_item(item, None, parent_index)
        for child_index, child in enumerate(item.get("children") or []):
            append_item(child, parent_flat_index, child_index)

    return flattened, subtotal, vat, total


def _clamp_discount_percent(value: Any) -> float:
    """Kẹp % giảm giá về [0, 100] - phòng payload gửi số âm/quá lớn làm tổng
    tiền ra số vô lý. Khớp clampDiscountPercent() phía frontend."""
    try:
        pct = float(value or 0)
    except (TypeError, ValueError):
        return 0.0
    return max(0.0, min(100.0, pct))


def _apply_discount(subtotal: float, gross_vat: float, discount_percent: Any) -> tuple[float, float, float]:
    """Giảm giá % trên TỔNG TRƯỚC THUẾ (subtotal), VAT tính lại trên phần đã
    giảm. Vì giảm giá nhân đều lên mọi dòng và VAT mỗi dòng tuyến tính theo
    subtotal dòng đó, tổng VAT sau giảm = tổng VAT gốc × (1 - %/100) - đúng
    cho cả trường hợp các dòng có VAT % khác nhau (xem chứng minh trong
    quoteCalculations.ts phía frontend, cùng công thức).

    Trả về (discount_amount, vat_amount, total_amount)."""
    pct = _clamp_discount_percent(discount_percent)
    discount_amount = subtotal * pct / 100
    vat_amount = gross_vat * (100 - pct) / 100
    total_amount = subtotal - discount_amount + vat_amount
    return discount_amount, vat_amount, total_amount


def _calculate_villa_totals(solution_items: list[dict]) -> tuple[float, float, float]:
    total = sum(float(item.get("offerPrice") or 0) for item in solution_items)
    return total, 0, total


# ── Quote Forms ────────────────────────────────────────────────────────────

# 3 mau "chuan bao gia" duoc chon lam mac dinh cho khu vuc "Mẫu dùng nhanh"
# (FE lay 3 dong dau tien - TEMPLATE_ROW_LIMIT trong QuoteCenterPage.tsx).
# Truoc day sap xep thuan tuy theo updated_at desc nen bat on dinh: hom nao
# admin sua mau nao thi mau do nhay len dau, day 1 trong 3 mau chuan (vd VPS)
# ra ngoai, lo mau khac (vd "MARKEE V2" cu) vao thay - day chinh la bug that
# nguoi dung gap ("mẫu dùng nhanh ... để mẫu markee (chuẩn báo giá) thay cho
# markee v2 đi, 3 mẫu đó mặc định hiển thị nha"). Gan 3 code nay LEN DAU,
# dung thu tu, KHONG phu thuoc updated_at nua; cac mau con lai van sap theo
# updated_at desc nhu cu o phia sau.
FEATURED_FORM_CODES = ["STANDARD_QUOTE_FORM", "MAU_BAO_GIA_VPS", "MARKEE"]


def list_quote_forms(status: str | None = None) -> list[dict]:
    supabase: Client = get_supabase_client()
    query = supabase.table(FORMS_TABLE).select("*").neq("status", "archived")
    if status:
        query = query.eq("status", status)
    result = query.order("updated_at", desc=True).execute()
    rows = list(result.data or [])

    def sort_key(row: dict) -> tuple[int, int]:
        code = row.get("code") or ""
        if code in FEATURED_FORM_CODES:
            return (0, FEATURED_FORM_CODES.index(code))
        return (1, 0)

    rows.sort(key=sort_key)
    return [_row_to_form(row) for row in rows]


def get_quote_form(form_id: str) -> dict:
    supabase: Client = get_supabase_client()
    result = supabase.table(FORMS_TABLE).select("*").eq("id", form_id).single().execute()
    return _row_to_form(result.data)


def get_public_quote_form(token: str) -> dict:
    supabase: Client = get_supabase_client()
    result = (
        supabase.table(FORMS_TABLE)
        .select("*")
        .eq("share_token", token)
        .eq("share_enabled", True)
        .single()
        .execute()
    )
    if not result.data:
        raise ValueError("Mẫu báo giá không tồn tại hoặc đã bị khóa.")
    return _row_to_form(result.data)


def create_quote_form(payload: dict) -> dict:
    supabase: Client = get_supabase_client()
    insert_data = {
        "code": _unique_code(payload["name"]),
        "name": payload["name"],
        "description": payload.get("description") or "",
        "status": payload.get("status") or "active",
        "layout_type": payload.get("layout_type") or "cloudgate_standard_quote",
        "schema_version": payload.get("schema_version") or 1,
        "schema_json": payload["schema_json"],
        "issuer_company_id": payload.get("issuer_company_id"),
    }
    result = supabase.table(FORMS_TABLE).insert(insert_data).execute()
    return _row_to_form(result.data[0])


def update_quote_form(form_id: str, payload: dict) -> dict:
    supabase: Client = get_supabase_client()
    update_data = {k: v for k, v in payload.items() if v is not None}
    if "layout_type" in update_data and not update_data["layout_type"]:
        update_data.pop("layout_type")
    update_data["updated_at"] = _now_iso()
    result = supabase.table(FORMS_TABLE).update(update_data).eq("id", form_id).execute()
    return _row_to_form(result.data[0])


def delete_quote_form(form_id: str) -> dict:
    supabase: Client = get_supabase_client()
    has_quotes = (
        supabase.table(QUOTES_TABLE)
        .select("id")
        .eq("quote_form_id", form_id)
        .limit(1)
        .execute()
    )
    if has_quotes.data:
        result = (
            supabase.table(FORMS_TABLE)
            .update({"status": "archived", "updated_at": _now_iso()})
            .eq("id", form_id)
            .execute()
        )
        return {"deleted": False, "archived": True, "form": _row_to_form(result.data[0])}
    supabase.table(FORMS_TABLE).delete().eq("id", form_id).execute()
    return {"deleted": True, "archived": False}


def duplicate_quote_form(form_id: str) -> dict:
    supabase: Client = get_supabase_client()
    source = supabase.table(FORMS_TABLE).select("*").eq("id", form_id).single().execute().data
    insert_data = {
        "code": _unique_code(f"{source['name']}_COPY", ignore_id=form_id),
        "name": f"{source['name']} - Bản sao",
        "description": source.get("description") or "",
        "status": source["status"],
        "layout_type": source["layout_type"],
        "schema_version": source["schema_version"],
        "schema_json": source["schema_json"],
        "issuer_company_id": source.get("issuer_company_id"),
    }
    result = supabase.table(FORMS_TABLE).insert(insert_data).execute()
    return _row_to_form(result.data[0])


def share_quote_form(form_id: str, enabled: bool = True) -> dict:
    supabase: Client = get_supabase_client()
    current = supabase.table(FORMS_TABLE).select("share_token").eq("id", form_id).single().execute().data
    token = current.get("share_token") or secrets.token_urlsafe(16)
    result = (
        supabase.table(FORMS_TABLE)
        .update({"share_token": token, "share_enabled": enabled, "updated_at": _now_iso()})
        .eq("id", form_id)
        .execute()
    )
    return _row_to_form(result.data[0])


# ── Quotes ─────────────────────────────────────────────────────────────────

def list_quotes(deal_id: str | None = None, include_deleted: bool = False) -> list[dict]:
    supabase: Client = get_supabase_client()
    query = supabase.table(QUOTES_TABLE).select("*").eq("instance", _crm_instance())
    if deal_id:
        query = query.eq("deal_id", deal_id)
    if not include_deleted:
        query = query.is_("deleted_at", "null")
    result = query.order("created_at", desc=True).execute()
    quotes = result.data or []
    return [_row_to_quote(row, _quote_items(row["id"])) for row in quotes]


# 5 phase bucket thuc su hien thi tren Quote Center (khong tinh "Tat ca" -
# do la tong 5 bucket). Suy tu DUNG processing_stage/status/sent_at that,
# KHONG luu rieng 1 cot "phase" (tranh 2 nguon du lieu lech nhau - dung yeu
# cau "phase phai la du lieu that, suy tu canonical state, khong hard-code").
_PHASE_KEYS = ("presale", "sale_markup", "admin_review", "ready_to_send", "sent")

# Section 7 (KPI SLA Quote Center) - mirror CHINH XAC logic thuan
# computeQuoteSla() o modules/crm/utils/quoteSla.ts (KHONG duoc lech nguong/
# dieu kien voi FE - cung 1 nguon su that "sap den han"/"qua han"). Nguong
# "sap den han" <= 4 gio, dung nguong da chot QUOTE_SLA_DUE_SOON_THRESHOLD_MS.
_QUOTE_SLA_DUE_SOON_THRESHOLD_SECONDS = 4 * 60 * 60


def _quote_sla_bucket(row: dict, now: datetime) -> str:
    """Tra ve 'overdue' | 'due_soon' | 'other' cho 1 dong quote (dung slim
    row: sla_due_at/completed_at/sent_at) - CHI dung de DEM KPI, khong lam
    lai toan bo QuoteSlaPresentation (FE van la nguon hien thi badge tung
    dong). 'other' gom: chua dat SLA, con nhieu hon 4h, DA HOAN THANH (dung
    khong dung thoi han hay tre - "khong tinh completed la qua han", dung
    yeu cau)."""
    sla_due_at = row.get("sla_due_at")
    if not sla_due_at:
        return "other"
    try:
        due_dt = datetime.fromisoformat(str(sla_due_at).replace("Z", "+00:00"))
    except ValueError:
        return "other"
    completed_at = row.get("completed_at") or row.get("sent_at")
    if completed_at:
        return "other"
    diff_seconds = (due_dt - now).total_seconds()
    if diff_seconds < 0:
        return "overdue"
    if diff_seconds <= _QUOTE_SLA_DUE_SOON_THRESHOLD_SECONDS:
        return "due_soon"
    return "other"


def _derive_quote_phase(row: dict) -> str | None:
    """None = khong thuoc bucket nao (da xoa mem/da huy) - loai hoan toan
    khoi moi dem (ca "Tat ca").

    THU TU UU TIEN CO Y (khong doi thu tu tuy tien - moi buoc la 1 tin hieu
    "khong the nao sai" manh hon buoc sau, dung yeu cau da chot):
      1) deleted_at/status='cancelled' -> loai hoan toan (None).
      2) sent_at co gia tri -> 'sent' - email THAT SU da gui, tin hieu manh
         nhat, khong gi lat nguoc duoc trang thai nay.
      3) published_at co gia tri HOAC processing_stage='published' -> tra
         'ready_to_send' TRU KHI (2) da khop truoc do - da phat hanh nhung
         chua gui van la "san sang gui".
      4) status='approved' HOAC approved_at co gia tri (nhung CHUA qua (2)/
         (3)) -> 'ready_to_send' voi nhan "Đã duyệt · Chờ phát hành" - day
         la nhanh xu ly du lieu cu (4 quote that: RPC quote_approve() TRUOC
         migration 089 khong dong bo processing_stage cung luc voi status).
      5) processing_stage='review' -> 'admin_review'.
      6) processing_stage='pricing' -> 'sale_markup'.
      7) request/technical (hoac None, quote cu) -> 'presale'.

    QUAN TRONG: status='approved' KHONG BAO GIO duoc dung de GHI DE (2)/(3)
    - 1 quote da gui/da phat hanh PHAI giu dung nhanh do du status co la gi
    (test rieng cho tinh huong nay: approved+sent_at, approved+published_at
    phai uu tien dung sent/ready_to_send tu tin hieu THAT, khong roi ve
    nhanh "chi vi approved" o buoc 4)."""
    if row.get("deleted_at") or row.get("status") == "cancelled":
        return None
    if row.get("sent_at"):
        return "sent"
    if row.get("published_at") or row.get("processing_stage") == "published":
        return "ready_to_send"
    if row.get("status") == "approved" or row.get("approved_at"):
        return "ready_to_send"
    stage = row.get("processing_stage") or "request"
    if stage == "review":
        return "admin_review"
    if stage == "pricing":
        return "sale_markup"
    if stage == "ready_to_publish":
        return "ready_to_send"
    return "presale"


def _quote_row_date_key(row: dict) -> str:
    return row.get("issued_at") or row.get("created_at") or ""


def list_quotes_by_phase(
    phase: str | None = None,
    search: str | None = None,
    customer_id: str | None = None,
    project_id: str | None = None,
    technical_owner_id: str | None = None,
    quote_owner_id: str | None = None,
    owner_id: str | None = None,
    mine_user_id: str | None = None,
    team_id: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    sla: str | None = None,
    quote_types: list[str] | None = None,
    page: int = 1,
    page_size: int = 10,
) -> dict:
    """Danh sach bao gia cho Quote Center - GOM THEO version_chain_id (1
    dong = 1 Quote Case/chuoi version, KHONG phai 1 dong DB tho). TOAN BO
    filter (customer/project/owner/team/mine/thoi gian/tim kiem) ap dung o
    BACKEND, TRUOC pagination - khong con filter tren du lieu 1 trang da tra
    ve (bug thuc te da bi bao: khach hang o trang 2 se "khong tim thay" neu
    loc tren trang 1).

    `counts` tinh tren tap da ap TOAN BO filter TRU `phase` (dung hanh vi
    dashboard chuyen nghiep: doi Customer thi 5 badge tab doi theo, khong giu
    so dem toan he thong) - `phase` chi loc rieng cho `items`/`total` cua
    LAN GOI NAY.

    Buoc 1 - chi SELECT cot nhe (khong keo items) de gom chuoi + loc + dem
    cho TOAN BO bang; buoc 2 - chi load full chi tiet (item, cost summary,
    project, owner...) cho DUNG cac dong cua TRANG dang tra ve (tranh N+1
    tren toan bang)."""
    if phase is not None and phase not in _PHASE_KEYS:
        raise ValueError(f"phase không hợp lệ: {phase!r}")
    if sla is not None and sla not in ("overdue", "due_soon"):
        raise ValueError(f"sla không hợp lệ: {sla!r}")

    supabase: Client = get_supabase_client()
    slim_result = (
        supabase.table(QUOTES_TABLE)
        .select(
            "id, deal_id, project_id, technical_owner_id, quote_owner_id, created_by, "
            "quote_number, version_chain_id, version_number, processing_stage, status, "
            "sent_at, published_at, approved_at, issued_at, created_at, updated_at, "
            "sla_due_at, completed_at, quote_type_codes"
        )
        .eq("instance", _crm_instance())
        .is_("deleted_at", "null")
        .execute()
    )
    rows = slim_result.data or []

    # Gom theo chuoi - "current" = version_number lon nhat trong chuoi.
    chains: dict[str, dict] = {}
    chain_version_counts: dict[str, int] = {}
    for row in rows:
        key = row.get("version_chain_id") or row["id"]
        chain_version_counts[key] = chain_version_counts.get(key, 0) + 1
        existing = chains.get(key)
        if existing is None or (row.get("version_number") or 1) > (existing.get("version_number") or 1):
            chains[key] = row
    current_rows = list(chains.values())

    # Deal slim (chi field can cho FILTER, khong phai hien thi - hien thi
    # Khach hang/Co hoi van lay tu du lieu Deal da co san o frontend qua
    # useCrm(), tranh 2 nguon du lieu Deal lech nhau) - chi fetch khi that su
    # co filter can toi (customer_id/team_id/mine_user_id), tranh 1 query
    # thua khi khong loc gi ca. (Da REVERT viec fetch luon de sap xep theo
    # customerId - xem ghi chu o sort ben duoi.)
    deals_by_id: dict[str, dict] = {}
    if customer_id or team_id or mine_user_id:
        deal_ids = list({r["deal_id"] for r in current_rows if r.get("deal_id")})
        if deal_ids:
            deal_result = (
                supabase.table("customer_leads")
                .select("id, customer_id, team_id, sdr_id, leaded_by")
                .eq("instance", _crm_instance())
                .in_("id", deal_ids)
                .execute()
            )
            deals_by_id = {d["id"]: d for d in (deal_result.data or [])}

    # "Loai bao gia" (migration 112) - can nhan LABEL (khong chi CODE) de
    # search chung "tim duoc theo ten Loai bao gia" (yeu cau ro rang) - chi
    # fetch 1 lan cho ca trang khi that su can (co quote_types filter HOAC co
    # search) de tranh 1 query thua khi khong dung toi.
    quote_type_label_by_code: dict[str, str] = {}
    if quote_types or (search and search.strip()):
        try:
            quote_type_label_by_code = {
                c["code"]: (c.get("name") or c["code"]) for c in get_categories_by_type("crm_quote_type")
            }
        except Exception:
            quote_type_label_by_code = {}

    def _matches_non_phase_filters(row: dict) -> bool:
        row_quote_type_codes: list[str] = row.get("quote_type_codes") or []
        if search and search.strip():
            needle = search.strip().lower()
            haystacks = [row.get("quote_number") or ""] + [
                quote_type_label_by_code.get(code, code) for code in row_quote_type_codes
            ]
            if not any(needle in h.lower() for h in haystacks):
                return False
        if quote_types:
            wants_unclassified = "__unclassified__" in quote_types
            matches_unclassified = wants_unclassified and not row_quote_type_codes
            matches_selected = any(code in row_quote_type_codes for code in quote_types if code != "__unclassified__")
            if not (matches_unclassified or matches_selected):
                return False
        if project_id and row.get("project_id") != project_id:
            return False
        if technical_owner_id and row.get("technical_owner_id") != technical_owner_id:
            return False
        if quote_owner_id and row.get("quote_owner_id") != quote_owner_id:
            return False
        # owner_id = filter chung "Tat ca owner" tren UI (1 dropdown, khong
        # tach rieng Presale/Sale) - khop NEU nguoi nay dang la technical
        # HOAC quote owner cua bao gia (OR, khong phai bat buoc ca 2).
        if owner_id and row.get("technical_owner_id") != owner_id and row.get("quote_owner_id") != owner_id:
            return False
        deal = deals_by_id.get(row.get("deal_id")) if row.get("deal_id") else None
        if customer_id:
            if not deal or deal.get("customer_id") != customer_id:
                return False
        if team_id:
            if not deal or deal.get("team_id") != team_id:
                return False
        if mine_user_id:
            if deal:
                if deal.get("sdr_id") != mine_user_id and deal.get("leaded_by") != mine_user_id:
                    return False
            elif row.get("created_by") != mine_user_id:
                return False
        date_key = _quote_row_date_key(row)
        if date_from and (not date_key or date_key < date_from):
            return False
        if date_to and (not date_key or date_key > date_to):
            return False
        return True

    bucketed_all: list[tuple[str, dict]] = []
    for row in current_rows:
        row_phase = _derive_quote_phase(row)
        if row_phase is None:
            continue
        bucketed_all.append((row_phase, row))

    # counts: ap TOAN BO filter TRU phase - dung yeu cau "doi Customer thi 5
    # badge doi theo, KHONG giu so dem toan he thong".
    filtered_for_counts = [(p, r) for p, r in bucketed_all if _matches_non_phase_filters(r)]
    counts = {key: 0 for key in _PHASE_KEYS}
    for p, _r in filtered_for_counts:
        counts[p] += 1

    # KPI SLA (Section 7) - dem TREN CA TAP DA LOC (giong counts phase o tren:
    # bam theo Customer/Project/Owner/Team/Mine/Period hien tai) TRUOC
    # pagination, KHONG dem tren 10 dong cua trang dang tra ve. Da loai
    # cancelled/deleted qua _derive_quote_phase (row nao co phase=None da bi
    # loai o bucketed_all roi, khong con trong filtered_for_counts).
    sla_now = datetime.now(timezone.utc)
    sla_counts = {"overdue": 0, "dueSoon": 0}
    for _p, r in filtered_for_counts:
        bucket = _quote_sla_bucket(r, sla_now)
        if bucket == "overdue":
            sla_counts["overdue"] += 1
        elif bucket == "due_soon":
            sla_counts["dueSoon"] += 1

    bucketed = [(p, r) for p, r in filtered_for_counts if (phase is None or p == phase)]
    if sla is not None:
        # Loc THEO SLA sau khi da tinh sla_counts (giong het cach `phase` bi
        # loai khoi counts nhung van loc duoc items) - bam KPI "Quá hạn"/"Sắp
        # đến hạn" phai loc dung tap DA qua moi filter khac, KHONG chi loc
        # tren 10 dong cua trang hien tai.
        bucketed = [(p, r) for p, r in bucketed if _quote_sla_bucket(r, sla_now) == sla]
    # REVERT (yeu cau nguoi dung): KHONG tu y uu tien bao gia co customerId len
    # dau - day la thay doi quy tac sap xep ma nghiep vu chua chot. Giu DUNG 1
    # tieu chi updated_at DESC cho TOAN BO danh sach, khong phan biet co/khong
    # Khach hang. Neu can giup nhan biet du lieu thieu lien ket thi dung
    # badge/filter rieng ("Chưa gắn khách hàng") o FE, khong doi sort ngam.
    bucketed.sort(key=lambda pr: pr[1].get("updated_at") or pr[1].get("created_at") or "", reverse=True)

    total = len(bucketed)
    page = max(1, page)
    page_size = max(1, min(page_size, 100))
    start = (page - 1) * page_size
    page_slice = bucketed[start:start + page_size]

    # Chi load full chi tiet (item, cost summary, project, owner...) cho
    # DUNG cac id trong TRANG nay (khong phai toan bo tap da loc).
    page_ids = [r["id"] for _, r in page_slice]
    items: list[dict] = []
    if page_ids:
        full_result = (
            supabase.table(QUOTES_TABLE)
            .select("*")
            .eq("instance", _crm_instance())
            .in_("id", page_ids)
            .execute()
        )
        full_by_id = {r["id"]: r for r in (full_result.data or [])}

        page_project_ids = list({r.get("project_id") for _, r in page_slice if r.get("project_id")})
        projects_by_id: dict[str, dict] = {}
        if page_project_ids:
            proj_result = (
                supabase.table("projects")
                .select("id, project_code, name, status")
                .in_("id", page_project_ids)
                .execute()
            )
            projects_by_id = {p["id"]: p for p in (proj_result.data or [])}

        page_owner_ids = list(
            {r.get("technical_owner_id") for _, r in page_slice if r.get("technical_owner_id")}
            | {r.get("quote_owner_id") for _, r in page_slice if r.get("quote_owner_id")}
        )
        owners_by_id: dict[str, dict] = {}
        if page_owner_ids:
            owner_result = supabase.table("app_users").select("id, name").in_("id", page_owner_ids).execute()
            owners_by_id = {u["id"]: u for u in (owner_result.data or [])}

        for phase_key, row in page_slice:
            full_row = full_by_id.get(row["id"])
            if full_row is None:
                continue
            quote = _row_to_quote(full_row, _quote_items(row["id"]))
            quote["phase"] = phase_key
            quote["versionCount"] = chain_version_counts.get(row.get("version_chain_id") or row["id"], 1)
            quote["currentVersionNumber"] = quote["versionNumber"]
            # Alias ten dung theo spec Checkpoint C - gia khach TRUOC VAT sau
            # chiet khau, CHINH LA netRevenue da tinh o _quote_cost_summary
            # (total_amount - vat_amount), khong phai 1 phep tinh moi.
            quote["customerPriceBeforeVat"] = quote.get("netRevenue")
            project_row = projects_by_id.get(row.get("project_id")) if row.get("project_id") else None
            quote["project"] = (
                {"id": project_row["id"], "code": project_row.get("project_code"), "name": project_row.get("name"), "status": project_row.get("status")}
                if project_row
                else None
            )
            tech_owner = owners_by_id.get(row.get("technical_owner_id")) if row.get("technical_owner_id") else None
            quote["technicalOwner"] = {"id": tech_owner["id"], "name": tech_owner.get("name")} if tech_owner else None
            quote_owner = owners_by_id.get(row.get("quote_owner_id")) if row.get("quote_owner_id") else None
            quote["quoteOwner"] = {"id": quote_owner["id"], "name": quote_owner.get("name")} if quote_owner else None
            items.append(quote)

    return {
        "items": items,
        "counts": {**counts, "all": sum(counts.values())},
        "slaCounts": sla_counts,
        "page": page,
        "pageSize": page_size,
        "total": total,
    }


def get_quote(quote_id: str, include_deleted: bool = False) -> dict:
    """Xoa mem (deleted_at khong NULL) mac dinh KHONG duoc coi la quote dang
    hoat dong - endpoint thuong (khong truyen include_deleted=True) se nhan
    QuoteNotFoundError giong het truong hop ID khong ton tai, dung yeu cau
    "deleted quote khong duoc endpoint thong thuong coi la active quote".
    CHI loi zero-rows (PGRST116) moi duoc map sang QuoteNotFoundError - loi
    ket noi/permission/DB khac deu duoc RE-RAISE nguyen ven, khong nuot."""
    supabase: Client = get_supabase_client()
    query = supabase.table(QUOTES_TABLE).select("*").eq("id", quote_id).eq("instance", _crm_instance())
    if not include_deleted:
        query = query.is_("deleted_at", "null")
    try:
        row = query.single().execute().data
    except APIError as exc:
        if _is_zero_rows_error(exc):
            raise QuoteNotFoundError("Không tìm thấy báo giá.") from exc
        raise
    return _row_to_quote(row, _quote_items(quote_id))


class PublicQuoteVerificationRequiredError(Exception):
    """"Giới hạn xem link báo giá bằng Email hoặc Số điện thoại" (migration
    118, thay the PublicQuoteEmailRequiredError cu chi ho tro email). Nem loi
    nay (KHONG phai ValueError thuong) de router phan biet duoc voi loi "chua
    phat hanh"/"khong tim thay" thong thuong, tra ve them `method` +
    `invalid` cho FE biet CHINH XAC dang can xac minh gi (dung DUNG 1
    phuong thuc dang duoc chon, khong bao gio hoi ca 2)."""

    def __init__(self, method: str, invalid: bool = False):
        self.method = method
        self.invalid = invalid
        super().__init__(f"quote_public_{method}_required" if not invalid else f"quote_public_{method}_not_allowed")


def normalize_public_access_email(raw: str) -> str:
    return raw.strip().lower()


def normalize_public_access_phone(raw: str) -> str:
    """Chuan hoa SDT truoc khi so sanh/luu: bo khoang trang/dau gach ngang,
    quy ve dang +84xxxxxxxxx (VN) neu nhap dang 0xxxxxxxxx trong nuoc - KHONG
    doan quoc gia khac neu da co dau + san (giu nguyen, chi bo ky tu thua)."""
    digits_and_plus = re.sub(r"[^0-9+]", "", raw.strip())
    if digits_and_plus.startswith("0"):
        return "+84" + digits_and_plus[1:]
    if digits_and_plus and not digits_and_plus.startswith("+"):
        # Nhap thieu ma vung, khong co so 0 dau (vd "912345678") - gia dinh
        # VN, day la truong hop pho bien nhat cua he thong nay.
        return "+84" + digits_and_plus
    return digits_and_plus


def get_public_quote(token: str, email: str | None = None, phone: str | None = None) -> dict:
    """BUG THAT DA GAP ("khóa link rồi mà vào lại link thì hiển thị tbao
    nha"): ban truoc loc thang `.eq("public_enabled", True)` NGAY TRONG cau
    truy van - khi link da bi KHOA (Khoá link, revoke_public_quote), token
    van dung nhung row khong khop dieu kien nay nen tra ve y het TRUONG HOP
    token sai/khong ton tai, ca 2 deu roi vao chung 1 thong bao chung chung
    "Báo giá chưa được phát hành." - sai nghia thuc te (bao gia NAY that ra
    DA tung phat hanh, chi la bi khoa lai) va khong ro rang cho khach hang.
    Tach lam 2 buoc: (1) tim row CHI theo token/deleted_at (khong loc
    public_enabled) de biet CHINH XAC ly do - khong tim thay token nao vs
    tim thay nhung dang bi khoa; (2) tra thong bao rieng cho tung truong hop."""
    supabase: Client = get_supabase_client()
    result = (
        supabase.table(QUOTES_TABLE)
        .select("*")
        .eq("public_token", token)
        .eq("instance", _crm_instance())
        .is_("deleted_at", "null")
        .maybe_single()
        .execute()
    )
    row = result.data if result else None
    if not row:
        raise ValueError("Không tìm thấy báo giá — link không hợp lệ hoặc đã bị xoá.")
    if not row.get("public_enabled"):
        raise ValueError("Link báo giá này đã bị khoá.")
    # 'confirmed' = quote tao truoc migration 053 (luon duoc coi la da chot/cong khai
    # nhu cu, khong hoi to) - 'draft'/'cancelled' thi CHUA duoc xem cong khai, phai
    # qua approve_quote() truoc.
    if row.get("status") not in ("approved", "confirmed"):
        raise ValueError("Báo giá chưa được phát hành.")

    access_mode = row.get("public_access_mode") or "none"
    if access_mode == "email":
        allowed = {normalize_public_access_email(e) for e in (row.get("public_allowed_emails") or []) if e}
        normalized_email = normalize_public_access_email(email or "")
        if not normalized_email:
            raise PublicQuoteVerificationRequiredError(method="email", invalid=False)
        if normalized_email not in allowed:
            raise PublicQuoteVerificationRequiredError(method="email", invalid=True)
    elif access_mode == "phone":
        allowed_phones = {normalize_public_access_phone(p) for p in (row.get("public_allowed_phones") or []) if p}
        normalized_phone = normalize_public_access_phone(phone or "") if phone else ""
        if not normalized_phone:
            raise PublicQuoteVerificationRequiredError(method="phone", invalid=False)
        if normalized_phone not in allowed_phones:
            raise PublicQuoteVerificationRequiredError(method="phone", invalid=True)
    # access_mode == "none" -> khong kiem tra gi ca, khach mo link la xem duoc
    # ngay (BUG THAT DA GAP: ban cu dung 1 cot boolean rieng
    # `public_email_gate_enabled` song song voi danh sach email - khi "tat
    # gioi han" chi xoa/false cot boolean nhung code khac lo doc nham hoac
    # quen cap nhat se van hoi Email. Gio CHI CON 1 cot enum duy nhat quyet
    # dinh toan bo nhanh re, khong con truong hop "tat roi ma van hoi").

    return _row_to_public_quote(row, _quote_items(row["id"]))


def set_public_access_restriction(
    quote_id: str,
    actor_id: str | None,
    mode: str,
    emails: list[str] | None = None,
    phones: list[str] | None = None,
) -> dict:
    """Doi che do gioi han xem link cong khai cua 1 quote: 'none' / 'email' /
    'phone' (migration 118, thay the set_public_email_gate cu). CHI 1 cot
    enum duy nhat quyet dinh - khong con boolean rieng de tranh bug "tat roi
    ma van hoi Email" da gap truoc do. KHONG qua RPC (UPDATE metadata don
    gian, khong dung logic nghiep vu phuc tap nhu cac RPC vong doi khac)."""
    _ensure_quote_in_instance(quote_id)
    if mode not in ("none", "email", "phone"):
        raise ValueError("Che do gioi han khong hop le (phai la none/email/phone).")
    supabase: Client = get_supabase_client()
    normalized_emails = sorted({normalize_public_access_email(e) for e in (emails or []) if e and e.strip()})
    normalized_phones = sorted({normalize_public_access_phone(p) for p in (phones or []) if p and p.strip()})
    update_payload: dict = {"public_access_mode": mode, "updated_by": actor_id}
    if mode == "email":
        update_payload["public_allowed_emails"] = normalized_emails
    elif mode == "phone":
        update_payload["public_allowed_phones"] = normalized_phones
    # mode == "none": giu nguyen danh sach email/phone da luu truoc do (chi
    # doi cot mode) de neu bat lai cung che do thi khong mat du lieu da nhap.
    supabase.table(QUOTES_TABLE).update(update_payload).eq("id", quote_id).eq("instance", _crm_instance()).is_("deleted_at", "null").execute()
    supabase.table("quote_activity_log").insert({
        "quote_id": quote_id,
        "actor_id": actor_id,
        "action": "public_access_restriction_updated",
        "changes": {"mode": mode, "allowed_emails": normalized_emails, "allowed_phones": normalized_phones},
    }).execute()
    return get_quote(quote_id)


def create_quote(payload: dict, created_by: str | None) -> dict:
    supabase: Client = get_supabase_client()
    form = supabase.table(FORMS_TABLE).select("*").eq("id", payload["quote_form_id"]).single().execute().data
    if not form or form["status"] != "active":
        raise ValueError("Mẫu báo giá không còn hoạt động.")

    _validate_deal_project_consistency(payload.get("deal_id"), payload.get("project_id"))

    is_villa = form["layout_type"] == "villa_solution_package"
    data = dict(payload.get("data") or {})
    raw_items = payload.get("items") or []

    if is_villa:
        subtotal, vat, total = _calculate_villa_totals(data.get("solutionItems") or [])
        items_to_insert: list[dict] = []
    else:
        items_to_insert, subtotal, vat, total = _flatten_computed_items(raw_items)

    quote_number = _next_quote_number()
    now = _now_iso()
    insert_data = {
        "instance": _crm_instance(),
        "deal_id": payload.get("deal_id"),
        "quote_form_id": form["id"],
        "issuer_company_id": payload.get("issuer_company_id"),
        "quote_number": quote_number,
        "status": "draft",
        "form_schema_version": form["schema_version"],
        "form_snapshot": form["schema_json"],
        # BUG THAT DA GAP: template hien "Ngay bao gia" doc data.quoteDate (field
        # schema rieng, KHONG phai issued_at cua quote) - luong "Yeu cau ho tro
        # bao gia" (QuoteWorkspaceModal) khong bao gio dien field nay nen ban
        # khach hien literal "[Ngày báo giá]" thay vi ngay that. Mac dinh
        # quoteDate = ngay tao (giong het issued_at) neu caller chua tu dien -
        # dat TRUOC **data de caller van tu ghi de duoc neu can chinh tay.
        "data": {"quoteDate": now, **data, "quoteNumber": quote_number},
        "subtotal_amount": subtotal,
        "vat_amount": vat,
        "total_amount": total,
        "currency": str(data.get("currency") or "VND"),
        "issued_at": now,
        "public_token": None,
        "public_enabled": False,
        "created_by": created_by,
        # Du an + SLA that (migration 097) - ca 2 deu nullable (tuong thich
        # bao gia doc lap khong gan Du an, hoac chua dat SLA luc tao - SLA
        # se duoc bat buoc kiem tra o buoc "Gui yeu cau xu ly"
        # (set_quote_processing_stage), khong phai luc tao nay).
        "project_id": payload.get("project_id"),
        "sla_due_at": payload.get("sla_due_at"),
        # "Loai bao gia" (migration 112) - phai chon duoc TU BUOC 1 (yeu cau
        # ro rang "phải chọn được ngay từ Bước 1"), nen nhan luon o create_quote,
        # khong doi update_quote() duy nhat.
        "quote_type_codes": payload.get("quote_type_codes") or [],
    }
    logger.info(
        "tenant_write table=quotes operation=insert settings.crm_instance=%s resolved_instance=%s",
        _crm_instance(),
        insert_data["instance"],
    )
    quote_row = supabase.table(QUOTES_TABLE).insert(insert_data).execute().data[0]

    inserted_items = []
    inserted_ids_by_flat_index: dict[int, str] = {}
    for index, item in enumerate(items_to_insert):
        parent_temp_index = item.get("parent_temp_index")
        row = {
            "quote_id": quote_row["id"],
            "parent_item_id": inserted_ids_by_flat_index.get(parent_temp_index) if parent_temp_index is not None else None,
            "row_type": item.get("row_type") or "item",
            "description": item.get("description") or "",
            "service_description": item.get("service_description") or None,
            "unit": item.get("unit"),
            "quantity": float(item.get("quantity") or 0),
            "unit_price": float(item.get("unit_price") or 0),
            "discount_percent": item["discount_percent"],
            "discount_amount": item["discount"],
            "amount_after_discount": item["after_discount"],
            "vat_rate": float(item.get("vat_rate") or 0),
            "subtotal_amount": item["subtotal"],
            "vat_amount": item["vat"],
            "total_amount": item["total"],
            "sort_order": item["sort_order"],
            "catalog_item_id": item.get("catalog_item_id") or None,
            "bundle_snapshot": item.get("bundle_snapshot"),
            "list_price_usd": item.get("list_price_usd"),
            "unit_price_usd": item.get("unit_price_usd"),
            "exchange_rate": item.get("exchange_rate"),
            "unit_price_vnd": item.get("unit_price_vnd"),
        }
        # Chi them cost_price/markup_percent (migration 086) vao payload INSERT
        # khi THAT SU co gia tri - neu luon them ca key voi gia tri None,
        # PostgREST se bao loi "column does not exist" tren DB CHUA chay
        # migration 086 (da phat hien qua test that, khong phai gia dinh).
        if item.get("cost_price") is not None:
            row["cost_price"] = item["cost_price"]
            row["markup_percent"] = item.get("markup_percent")
        inserted = supabase.table(ITEMS_TABLE).insert(row).execute().data[0]
        inserted_items.append(inserted)
        inserted_ids_by_flat_index[index] = inserted["id"]

    supabase.table("quote_activity_log").insert({
        "quote_id": quote_row["id"], "actor_id": created_by, "action": "created", "changes": None,
    }).execute()

    if quote_row.get("deal_id"):
        # Chua duyet -> chi gan FK quote_id de Deal card thay ngay bao gia "Chua
        # duyet", KHONG ghi last_attachment_url/estimated_budget (chua co public
        # url that, chua chac chan gia da chot).
        supabase.table("customer_leads").update({"quote_id": quote_row["id"]}).eq("id", quote_row["deal_id"]).eq("instance", _crm_instance()).execute()

    return _row_to_quote(quote_row, inserted_items)


_RPC_ERROR_MESSAGES = {
    "quote_not_found": "Không tìm thấy báo giá.",
    "quote_already_approved": "Báo giá đã được duyệt, không thể chỉnh sửa.",
    "quote_not_in_draft_status": "Báo giá không ở trạng thái chờ duyệt.",
    "quote_missing_required_fields": "Báo giá thiếu thông tin bắt buộc (chưa có hạng mục hoặc tổng tiền = 0).",
    "quote_item_invalid_percent": "Giảm giá/VAT phải nằm trong khoảng 0-100.",
    "cancellation_reason_required": "Vui lòng nhập lý do huỷ báo giá.",
    "hard_delete_reason_required": "Vui lòng nhập lý do xoá vĩnh viễn.",
    "quote_number_mismatch": "Mã báo giá xác nhận không khớp — huỷ thao tác để an toàn.",
    "request_changes_reason_required": "Vui lòng nhập lý do yêu cầu chỉnh sửa.",
    "invalid_request_changes_target_stage": "Chỉ được yêu cầu chỉnh sửa về Thông tin kỹ thuật hoặc Giá bán.",
    "quote_not_in_review_stage": "Chỉ báo giá đang ở bước Chờ duyệt mới yêu cầu chỉnh sửa được.",
    "quote_must_be_approved_before_publish": "Báo giá phải được duyệt trước khi phát hành.",
    "quote_missing_scope": "Chưa mô tả phạm vi công việc (scope).",
    "quote_missing_items": "Cần ít nhất 1 hạng mục hợp lệ.",
    "quote_item_invalid_quantity": "Có hạng mục với số lượng không hợp lệ (phải > 0).",
    "quote_item_invalid_cost_price": "Có hạng mục với giá vốn không hợp lệ (không được âm).",
    "quote_item_missing_cost_price": "Có hạng mục chưa nhập giá vốn — nhập giá vốn hoặc đánh dấu \"Không áp dụng giá vốn\" trước khi bàn giao.",
    "quote_handoff_checklist_incomplete": "Checklist bàn giao (Scope/Cost/Timeline/Assumption) chưa đủ 4 mục.",
    "quote_item_invalid_unit_price": "Có hạng mục với giá bán không hợp lệ (phải > 0).",
    "quote_item_invalid_markup": "Có hạng mục với markup không hợp lệ (thấp hơn -100%).",
    "quote_missing_payment_terms": "Chưa chọn Điều khoản thanh toán — vào mục \"Thanh toán\" (dropdown số ngày) để chọn, không phải \"+ Ghi chú bổ sung\".",
    "quote_invalid_total_amount": "Tổng tiền tính lại không hợp lệ.",
    "quote_not_published": "Báo giá chưa từng được phát hành, không thể mở lại link — hãy Phát hành trước.",
}


def _raise_friendly_rpc_error(exc: Exception) -> None:
    message = str(exc)
    for code, friendly in _RPC_ERROR_MESSAGES.items():
        if code in message:
            raise ValueError(friendly) from exc
    raise


def _validate_deal_project_consistency(deal_id: str | None, project_id: str | None) -> None:
    """Validate quan he THAT trong schema (quotes KHONG co customer_id rieng -
    khach hang chi suy ra qua quotes.deal_id -> customer_leads.customer_id):
    (1) Du an (neu co) phai thuoc DUNG khach hang cua Co hoi dang gan; (2) neu
    Co hoi do da tu thuoc san 1 Du an KHAC (customer_leads.project_id) thi
    Du an dang chon phai TRUNG voi Du an do, khong duoc chon lech.
    Neu co deal_id thi deal phai nam trong dung instance hien tai; project_id
    (neu co) phai khop customer cua deal."""
    if not deal_id:
        return
    supabase = get_supabase_client()
    deal_row = (
        supabase.table("customer_leads")
        .select("customer_id, project_id")
        .eq("id", deal_id)
        .eq("instance", _crm_instance())
        .maybe_single()
        .execute()
    )
    deal_data = deal_row.data if deal_row else None
    if not deal_data:
        raise ValueError("Không tìm thấy cơ hội CRM trong instance hiện tại.")
    if not project_id:
        return
    deal_customer_id = deal_data.get("customer_id")
    if deal_customer_id:
        project_row = (
            supabase.table("projects")
            .select("customer_id")
            .eq("id", project_id)
            .maybe_single()
            .execute()
        )
        if not project_row or not project_row.data:
            raise ValueError("Không tìm thấy dự án.")
        if project_row.data.get("customer_id") != deal_customer_id:
            raise ValueError("Dự án đã chọn không thuộc khách hàng của cơ hội này.")
    deal_project_id = deal_data.get("project_id")
    if deal_project_id and deal_project_id != project_id:
        raise ValueError("Cơ hội đã chọn không thuộc dự án đã chọn.")


def _validate_project_matches_quote_customer(quote_id: str, project_id: str) -> None:
    """Ban update - quote da ton tai, lay deal_id THAT cua quote roi giao lai
    cho _validate_deal_project_consistency() (dung 1 nguon logic voi
    create_quote, tranh lech quy tac giua tao moi/cap nhat)."""
    supabase = get_supabase_client()
    quote_row = (
        supabase.table(QUOTES_TABLE)
        .select("deal_id")
        .eq("id", quote_id)
        .eq("instance", _crm_instance())
        .maybe_single()
        .execute()
    )
    deal_id = quote_row.data.get("deal_id") if quote_row else None
    _validate_deal_project_consistency(deal_id, project_id)


def _raw_items_for_rpc(raw_items: list[dict]) -> list[dict]:
    """Chuyen flat raw rows (tu _quote_items(), snake_case, dung DUNG ten cot
    that) thanh JSON dang cay (root + 'children' long nhau) dung dinh dang RPC
    quote_update can cho p_items - dung khi PHAI GIU NGUYEN items hien co (xem
    ly do o update_quote())."""
    by_id: dict[str, dict] = {row["id"]: dict(row) for row in raw_items}
    for row in by_id.values():
        row["children"] = []
    roots: list[dict] = []
    for row in sorted(raw_items, key=lambda r: r.get("sort_order") or 0):
        node = by_id[row["id"]]
        parent_id = row.get("parent_item_id")
        if parent_id and parent_id in by_id:
            by_id[parent_id]["children"].append(node)
        else:
            roots.append(node)
    return roots


def update_quote(quote_id: str, payload: dict, actor_id: str | None) -> dict:
    """CHU Y AN TOAN (bug that da gay MAT TOAN BO hang muc + tong tien mot
    quote that trong phien nay, phat hien qua "GIA KHACH ve 0"): RPC
    quote_update() LUON XOA+CHEN LAI toan bo quote_items tu p_items (khong co
    che do "khong dong toi items" o tang RPC - xem migration 090). Truoc day
    ham nay truyen `p_items=[]` moi khi caller khong gui "items" trong payload
    (vd chi doi `data`/`issuer_company_id`) - VO TINH xoa sach hang muc that
    su cua quote. Gio PHAI truy lai items HIEN CO va truyen nguyen ven cho
    RPC trong truong hop nay, KHONG duoc mac dinh ve []."""
    _ensure_quote_in_instance(quote_id)
    supabase: Client = get_supabase_client()
    items = payload.get("items")
    items_changed = items is not None
    if items_changed:
        rpc_items = [item for item in items]
    else:
        rpc_items = _raw_items_for_rpc(_quote_items(quote_id))
    changes = {"data_changed": payload.get("data") is not None, "items_changed": items_changed}
    try:
        supabase.rpc("quote_update", {
            "p_quote_id": quote_id,
            "p_actor_id": actor_id,
            "p_data": payload.get("data"),
            "p_items": rpc_items,
            "p_changes": changes,
            "p_issuer_company_id": payload.get("issuer_company_id"),
        }).execute()
    except Exception as exc:
        _raise_friendly_rpc_error(exc)

    # Du an + SLA due date (migration 097) - CHUA nam trong RPC quote_update
    # (chi la metadata, khong can recompute gia/VAT nhu cac RPC khac) - update
    # THANG, rieng, CHI khi client that su gui field nay (key co mat trong
    # dict - ke ca gia tri None co y "bo gan" - xem router quotes_update() da
    # dung model_fields_set de phan biet "khong gui" voi "gui null co y").
    direct_fields: dict[str, Any] = {}
    if "project_id" in payload:
        new_project_id = payload.get("project_id")
        if new_project_id:
            _validate_project_matches_quote_customer(quote_id, new_project_id)
        direct_fields["project_id"] = new_project_id
    if "sla_due_at" in payload:
        direct_fields["sla_due_at"] = payload.get("sla_due_at")
    if "overall_discount_percent" in payload:
        direct_fields["overall_discount_percent"] = payload.get("overall_discount_percent")
    quote_type_changed = False
    old_quote_type_codes: list[str] = []
    if "quote_type_codes" in payload:
        new_quote_type_codes = payload.get("quote_type_codes") or []
        # "Loai bao gia" (migration 112) - yeu cau rieng "Mọi thay đổi phải
        # ghi Activity/Audit: ai đổi, thời gian, giá trị trước và sau" - phai
        # doc gia tri CU truoc khi ghi de (update() thang khong qua RPC nen
        # khong tu dong co "before" nhu cac thay doi hang muc qua quote_update()).
        current_row = (
            supabase.table(QUOTES_TABLE)
            .select("quote_type_codes")
            .eq("id", quote_id)
            .eq("instance", _crm_instance())
            .maybe_single()
            .execute()
        )
        old_quote_type_codes = (current_row.data or {}).get("quote_type_codes") or [] if current_row else []
        quote_type_changed = sorted(old_quote_type_codes) != sorted(new_quote_type_codes)
        direct_fields["quote_type_codes"] = new_quote_type_codes
    if direct_fields:
        supabase.table(QUOTES_TABLE).update(direct_fields).eq("id", quote_id).eq("instance", _crm_instance()).execute()
    if quote_type_changed:
        supabase.table("quote_activity_log").insert({
            "quote_id": quote_id,
            "actor_id": actor_id,
            "action": "quote_type_changed",
            "changes": {"before": old_quote_type_codes, "after": direct_fields["quote_type_codes"]},
        }).execute()

    return get_quote(quote_id)


_READY_OR_LATER_STAGES = ("ready_to_publish", "published")


def approve_quote(quote_id: str, actor_id: str | None) -> dict:
    """Duyệt báo giá: khoá chỉnh sửa vĩnh viễn, ghi approved_by/approved_at,
    processing_stage -> 'ready_to_publish'. KHÔNG còn tự bật public link nữa
    (tách riêng khỏi quote_publish() - xem migration 089) - Deal chỉ được
    link khi PUBLISH thật (có publicUrl thật), không phải lúc duyệt.

    Buoc "dam bao" o duoi (sau RPC) la CO CHU DICH - phat hien that: 1 phien
    ban RPC quote_approve() TRUOC migration 089 (059/060/085) tung set
    status='approved' nhung KHONG dong bo processing_stage sang
    'ready_to_publish' (co ban con set nham lai 'review'), khien du lieu ket
    dinh sai trang thai vinh vien (list Quote Center hien nham "Cho Admin
    duyet" cho quote DA duoc duyet roi). Du RPC hien tai (migration 089) da
    dung, van tu ep processing_stage o Python NGAY SAU RPC de: (1) an toan
    du DB dang chay ban RPC nao, (2) khong bao gio de 1 quote 'approved' ket
    dinh o processing_stage cu - CHI set khi processing_stage CHUA o
    ready_to_publish/published (khong bao gio LUI lai tu 'published')."""
    _ensure_quote_in_instance(quote_id)
    supabase: Client = get_supabase_client()
    try:
        supabase.rpc("quote_approve", {
            "p_quote_id": quote_id,
            "p_actor_id": actor_id,
            "p_public_token": secrets.token_urlsafe(16),
        }).execute()
    except Exception as exc:
        _raise_friendly_rpc_error(exc)

    quote = get_quote(quote_id)
    if quote.get("status") == "approved" and quote.get("processingStage") not in _READY_OR_LATER_STAGES:
        supabase.table(QUOTES_TABLE).update({"processing_stage": "ready_to_publish"}).eq("id", quote_id).eq("instance", _crm_instance()).execute()
        quote = get_quote(quote_id)
    return quote


def publish_quote(quote_id: str, actor_id: str | None) -> dict:
    """Phát hành báo giá đã duyệt: sinh/bật public_token/public_enabled THẬT
    ở đây (không còn ở approve), processing_stage -> 'published'. Chỉ sau
    bước này Deal mới được link với public URL thật."""
    _ensure_quote_in_instance(quote_id)
    supabase: Client = get_supabase_client()
    try:
        supabase.rpc("quote_publish", {
            "p_quote_id": quote_id,
            "p_actor_id": actor_id,
            "p_public_token": secrets.token_urlsafe(16),
        }).execute()
    except Exception as exc:
        _raise_friendly_rpc_error(exc)
    quote = get_quote(quote_id)
    if quote.get("dealId"):
        link_quote_to_deal(quote_id, quote["dealId"], {
            "id": quote["id"], "number": quote["quoteNumber"],
            "url": quote["publicUrl"], "totalAmount": quote["totalAmount"],
        })
    # BUG THAT DA GAP: bao gia tao truoc khi co fix mac dinh quoteDate luc tao
    # (hoac bat ky ly do nao khac thieu field nay) van hien literal
    # "[Ngày báo giá]" tren ban khach du DA PHAT HANH. Phat hanh la moc THAT
    # su gan nhat voi "ngay bao gia" that (ngay gui cho khach) - luon ghi de
    # data.quoteDate = ngay phat hanh o day, KHONG doi qua update_quote()
    # (ham do XOA+CHEN LAI quote_items, khong can va khong nen dung chi de
    # sua 1 field trong `data`) - update thang cot `data` qua supabase client.
    quote_data = dict(quote.get("data") or {})
    quote_data["quoteDate"] = _now_iso()
    supabase.table(QUOTES_TABLE).update({"data": quote_data}).eq("id", quote_id).eq("instance", _crm_instance()).execute()
    quote["data"] = quote_data
    return quote


def cancel_quote(quote_id: str, actor_id: str | None, reason: str) -> dict:
    _ensure_quote_in_instance(quote_id)
    supabase: Client = get_supabase_client()
    try:
        supabase.rpc("quote_cancel", {
            "p_quote_id": quote_id, "p_actor_id": actor_id, "p_reason": reason,
        }).execute()
    except Exception as exc:
        _raise_friendly_rpc_error(exc)
    return get_quote(quote_id)


def revoke_public_quote(quote_id: str, actor_id: str | None) -> dict:
    _ensure_quote_in_instance(quote_id)
    supabase: Client = get_supabase_client()
    try:
        supabase.rpc("quote_revoke_public", {
            "p_quote_id": quote_id, "p_actor_id": actor_id,
        }).execute()
    except Exception as exc:
        _raise_friendly_rpc_error(exc)
    return get_quote(quote_id)


def enable_public_quote(quote_id: str, actor_id: str | None) -> dict:
    """"Mở lại link báo giá" - chieu nguoc cua revoke_public_quote() (truoc
    day CHUA co, chi co "Khoá link" ma khong the mo lai). Giu nguyen
    public_token cu (khong sinh token moi) - xem migration 115."""
    _ensure_quote_in_instance(quote_id)
    supabase: Client = get_supabase_client()
    try:
        supabase.rpc("quote_enable_public", {
            "p_quote_id": quote_id, "p_actor_id": actor_id,
        }).execute()
    except Exception as exc:
        _raise_friendly_rpc_error(exc)
    return get_quote(quote_id)


def soft_delete_quote(quote_id: str, actor_id: str | None, reason: str | None) -> dict:
    _ensure_quote_in_instance(quote_id)
    supabase: Client = get_supabase_client()
    try:
        supabase.rpc("quote_soft_delete", {
            "p_quote_id": quote_id, "p_actor_id": actor_id, "p_reason": reason,
        }).execute()
    except Exception as exc:
        _raise_friendly_rpc_error(exc)
    return get_quote(quote_id, include_deleted=True)


def restore_quote(quote_id: str, actor_id: str | None) -> dict:
    _ensure_quote_in_instance(quote_id, include_deleted=True)
    supabase: Client = get_supabase_client()
    try:
        supabase.rpc("quote_restore", {
            "p_quote_id": quote_id, "p_actor_id": actor_id,
        }).execute()
    except Exception as exc:
        _raise_friendly_rpc_error(exc)
    return get_quote(quote_id)


def hard_delete_quote(quote_id: str, actor_id: str | None, quote_number_confirm: str, reason: str, request_id: str | None) -> None:
    """Xoá VĨNH VIỄN - CHỈ gọi sau khi router đã xác nhận actor là
    admin/superadmin thật. Backend tự đọc lại quote_number và đối chiếu với
    quote_number_confirm client gửi (double-check) trước khi RPC ghi
    quote_deletion_audit rồi mới DELETE thật, cùng 1 transaction Postgres."""
    _ensure_quote_in_instance(quote_id, include_deleted=True)
    supabase: Client = get_supabase_client()
    try:
        supabase.rpc("quote_hard_delete", {
            "p_quote_id": quote_id,
            "p_actor_id": actor_id,
            "p_quote_number_confirm": quote_number_confirm,
            "p_reason": reason,
            "p_request_id": request_id,
        }).execute()
    except Exception as exc:
        _raise_friendly_rpc_error(exc)


def request_quote_changes(quote_id: str, actor_id: str | None, target_stage: str, reason: str) -> dict:
    _ensure_quote_in_instance(quote_id)
    supabase: Client = get_supabase_client()
    try:
        supabase.rpc("quote_request_changes", {
            "p_quote_id": quote_id, "p_actor_id": actor_id,
            "p_target_stage": target_stage, "p_reason": reason,
        }).execute()
    except Exception as exc:
        _raise_friendly_rpc_error(exc)
    return get_quote(quote_id)


def update_and_approve_quote(quote_id: str, payload: dict, actor_id: str | None) -> dict:
    """Dùng cho nút "Duyệt báo giá" khi đang sửa trong modal - lưu thay đổi cuối
    + duyệt trong CÙNG 1 transaction Postgres (không tách 2 lệnh riêng, tránh
    nửa vời khi 1 trong 2 bước lỗi).

    CHU Y AN TOAN (cung 1 bug da gay mat du lieu that o update_quote() - xem
    comment day du o do): RPC quote_update_and_approve() goi thang vao
    quote_update() ben trong, tuc cung co che XOA+CHEN LAI toan bo quote_items
    tu p_items. Neu caller khong gui "items" (vd chi doi data/issuer_company_id
    roi bam Duyet), PHAI truyen lai items HIEN CO thay vi [] - khong thi bam
    Duyet se xoa sach hang muc."""
    _ensure_quote_in_instance(quote_id)
    supabase: Client = get_supabase_client()
    items = payload.get("items")
    items_changed = items is not None
    if items_changed:
        rpc_items = [item for item in items]
    else:
        rpc_items = _raw_items_for_rpc(_quote_items(quote_id))
    changes = {"data_changed": payload.get("data") is not None, "items_changed": items_changed}
    try:
        supabase.rpc("quote_update_and_approve", {
            "p_quote_id": quote_id,
            "p_actor_id": actor_id,
            "p_data": payload.get("data"),
            "p_items": rpc_items,
            "p_changes": changes,
            "p_public_token": secrets.token_urlsafe(16),
            "p_issuer_company_id": payload.get("issuer_company_id"),
        }).execute()
    except Exception as exc:
        _raise_friendly_rpc_error(exc)
    quote = get_quote(quote_id)
    if quote.get("dealId"):
        link_quote_to_deal(quote_id, quote["dealId"], {
            "id": quote["id"], "number": quote["quoteNumber"],
            "url": quote["publicUrl"], "totalAmount": quote["totalAmount"],
        })
    return quote


_RPC_ERROR_MESSAGES.update({
    "quote_not_found": "Không tìm thấy báo giá.",
    "quote_not_approved": "Chuỗi báo giá này chưa có phiên bản nào được duyệt, không thể tạo phiên bản mới.",
    "quote_is_draft": "Báo giá này đang là bản nháp (chưa duyệt), không thể tạo phiên bản mới từ đây.",
})


def create_quote_version(clicked_quote_id: str, actor_id: str | None) -> dict:
    """Tạo phiên bản mới trong chuỗi (V1/V2/V3...) từ bản ĐÃ DUYỆT mới nhất -
    xem chi tiết logic (khoá chuỗi, nguồn copy thật sự, redirect bản nháp có
    sẵn) trong migration 082_quote_versioning.sql (RPC quote_create_version).
    Trả thêm 'created' (False nếu chỉ redirect tới bản nháp có sẵn, không tạo
    mới) và thông tin bản nguồn thật sự đã copy (để FE cảnh báo nếu khác
    clicked_quote_id, vd bấm ở V1 nhưng nguồn thật là V2)."""
    _ensure_quote_in_instance(clicked_quote_id)
    supabase: Client = get_supabase_client()
    try:
        result = supabase.rpc("quote_create_version", {
            "p_clicked_quote_id": clicked_quote_id,
            "p_actor_id": actor_id,
            "p_new_quote_number": _next_quote_number(),
        }).execute()
    except Exception as exc:
        _raise_friendly_rpc_error(exc)
    row = (result.data or [None])[0]
    if not row:
        raise ValueError("Không tạo được phiên bản báo giá mới.")
    new_quote = get_quote(row["quote"]["id"])
    return {
        "quote": new_quote,
        "created": bool(row.get("created")),
        "sourceQuoteId": row.get("source_quote_id"),
        "sourceVersionNumber": row.get("source_version_number"),
        "redirectedFromClickedQuote": row.get("source_quote_id") != clicked_quote_id,
    }


def list_quote_versions(chain_id: str) -> list[dict]:
    """Toàn bộ phiên bản (V1..Vn) của 1 chuỗi báo giá, mới nhất trước - dùng cho
    khối "Lịch sử phiên bản" (QuoteDetailPage) và mini-card Deal drawer."""
    supabase: Client = get_supabase_client()
    result = (
        supabase.table(QUOTES_TABLE)
        .select("*")
        .eq("version_chain_id", chain_id)
        .eq("instance", _crm_instance())
        .is_("deleted_at", "null")
        .order("version_number", desc=True)
        .execute()
    )
    return [_row_to_quote(row, []) for row in (result.data or [])]


HANDOFF_TABLE = "quote_handoff_checklist"
ACTIVITY_LOG_TABLE = "quote_activity_log"

_RPC_ERROR_MESSAGES.update({
    "invalid_processing_stage": "Bước xử lý không hợp lệ.",
    "processing_stage_cannot_go_backward": "Không thể lùi về bước xử lý trước đó.",
})


def set_quote_processing_stage(quote_id: str, actor_id: str | None, stage: str) -> dict:
    """Chuyen buoc xu ly noi bo (Yeu cau bao gia/Thong tin ky thuat/Hoan thien
    gia ban/Cho duyet) - chi tien, khong lui (xem quote_set_processing_stage,
    migration 085). Chi ap dung khi bao gia con la draft.

    SLA that (migration 097, KHONG qua RPC - xu ly o Python vi chi lien quan
    dung 1 canh chuyen request->technical, tranh phai sua them RPC): khi Sale
    "Gui yeu cau xu ly" (request->technical) LAN DAU, bat buoc da co
    sla_due_at va phai la thoi diem TUONG LAI, roi set sla_started_at=now()
    NEU dang NULL (khong ghi de neu da co tu truoc - khong reset khi retry/
    idempotent hoac neu logic sau nay cho quay lai stage nay)."""
    supabase: Client = get_supabase_client()
    current = get_quote(quote_id)
    is_first_technical_handoff = stage == "technical" and current.get("processingStage") == "request"
    if is_first_technical_handoff:
        deal_id = current.get("dealId")
        if not deal_id:
            raise ValueError("Cần chọn cơ hội CRM trước khi bàn giao báo giá.")
        deal_result = (
            supabase.table("customer_leads")
            .select("customer_id")
            .eq("id", deal_id)
            .eq("instance", _crm_instance())
            .maybe_single()
            .execute()
        )
        if not deal_result or not deal_result.data or not deal_result.data.get("customer_id"):
            raise ValueError("Cơ hội CRM phải được liên kết với khách hàng trước khi bàn giao báo giá.")
        if not current.get("quoteFormId"):
            raise ValueError("Cần chọn mẫu báo giá trước khi bàn giao.")
        if not current.get("technicalOwnerId"):
            raise ValueError("Cần chọn Presale trước khi bàn giao báo giá.")
        if not current.get("quoteOwnerId"):
            raise ValueError("Cần chọn Sale trước khi bàn giao báo giá.")

        def has_priced_item(rows: list[dict]) -> bool:
            return any(
                row.get("rowType") != "section" or has_priced_item(row.get("children") or [])
                for row in rows
            )

        if not has_priced_item(current.get("items") or []):
            raise ValueError("Cần thêm ít nhất một hạng mục trước khi bàn giao báo giá.")

        sla_due_at = current.get("slaDueAt")
        if not sla_due_at:
            raise ValueError("Cần đặt SLA / hạn hoàn tất nội bộ trước khi gửi yêu cầu xử lý.")
        try:
            due_dt = datetime.fromisoformat(str(sla_due_at).replace("Z", "+00:00"))
        except ValueError as exc:
            raise ValueError("SLA / hạn hoàn tất nội bộ không hợp lệ.") from exc
        if due_dt.tzinfo is None:
            due_dt = due_dt.replace(tzinfo=timezone.utc)
        if due_dt <= datetime.now(timezone.utc):
            raise ValueError("SLA / hạn hoàn tất nội bộ phải là thời điểm trong tương lai.")

    try:
        supabase.rpc("quote_set_processing_stage", {
            "p_quote_id": quote_id,
            "p_actor_id": actor_id,
            "p_stage": stage,
        }).execute()
    except Exception as exc:
        _raise_friendly_rpc_error(exc)

    if is_first_technical_handoff and not current.get("slaStartedAt"):
        supabase.table(QUOTES_TABLE).update({"sla_started_at": "now()"}).eq("id", quote_id).eq("instance", _crm_instance()).is_("sla_started_at", "null").execute()

    return get_quote(quote_id)


def assign_quote_owner(
    quote_id: str, actor_id: str | None,
    technical_owner_id: str | None = None, quote_owner_id: str | None = None,
    assign_technical: bool = False, assign_quote_owner_field: bool = False,
) -> dict:
    """Gan nguoi phu trach ky thuat / nguoi phu trach bao gia - update truc
    tiep (khong qua RPC quote_update vi khong dung toi items/gia, khong can
    atomic voi tinh lai tong tien). `assign_technical`/`assign_quote_owner_field`
    phan biet "khong gui field nay" voi "gui gia tri None de bo gan" (giong
    han che cua issuer company nullable field truoc do)."""
    _ensure_quote_in_instance(quote_id)
    supabase: Client = get_supabase_client()
    update_data: dict = {"updated_by": actor_id}
    if assign_technical:
        update_data["technical_owner_id"] = technical_owner_id or None
    if assign_quote_owner_field:
        update_data["quote_owner_id"] = quote_owner_id or None
    if len(update_data) > 1:
        supabase.table(QUOTES_TABLE).update(update_data).eq("id", quote_id).eq("instance", _crm_instance()).execute()
        supabase.table(ACTIVITY_LOG_TABLE).insert({
            "quote_id": quote_id, "actor_id": actor_id, "action": "owner_assigned",
            "changes": {"technicalOwnerId": technical_owner_id, "quoteOwnerId": quote_owner_id},
        }).execute()
    return get_quote(quote_id)


def pin_quote(quote_id: str, actor_id: str | None) -> dict:
    """"Ghim báo giá lên đầu" (Quote Center) - update TRUC TIEP CHI 3 cot
    is_pinned/pinned_at/pinned_by (khong dong toi bat ky cot nao khac, dac
    biet KHONG set updated_by) - trigger DB (migration 103) da duoc sua de
    KHONG bump updated_at khi UPDATE chi doi dung 3 cot nay, dung yeu cau
    "không sửa giả updated_at/created_at". Quyen CHI Admin da chan o router
    (can_pin_quote) - ham nay khong tu kiem tra lai quyen."""
    _ensure_quote_in_instance(quote_id)
    supabase: Client = get_supabase_client()
    supabase.table(QUOTES_TABLE).update({
        "is_pinned": True,
        "pinned_at": _now_iso(),
        "pinned_by": actor_id,
    }).eq("id", quote_id).eq("instance", _crm_instance()).execute()
    supabase.table(ACTIVITY_LOG_TABLE).insert({
        "quote_id": quote_id, "actor_id": actor_id, "action": "pinned",
        "changes": {},
    }).execute()
    return get_quote(quote_id)


def unpin_quote(quote_id: str, actor_id: str | None) -> dict:
    """Bo ghim - dua ca 3 cot ve trang thai "chua tung ghim" (is_pinned=false,
    pinned_at/pinned_by=NULL) dung constraint quotes_pin_consistency_check
    (migration 103) - khong de lai dau vet pinned_at cu."""
    _ensure_quote_in_instance(quote_id)
    supabase: Client = get_supabase_client()
    supabase.table(QUOTES_TABLE).update({
        "is_pinned": False,
        "pinned_at": None,
        "pinned_by": None,
    }).eq("id", quote_id).eq("instance", _crm_instance()).execute()
    supabase.table(ACTIVITY_LOG_TABLE).insert({
        "quote_id": quote_id, "actor_id": actor_id, "action": "unpinned",
        "changes": {},
    }).execute()
    return get_quote(quote_id)


def _row_to_handoff(quote_id: str, row: dict | None) -> dict:
    if not row:
        return {
            "quoteId": quote_id,
            "scopeConfirmed": False, "scopeNote": None,
            "costConfirmed": False, "costNote": None,
            "timelineConfirmed": False, "timelineNote": None,
            "assumptionConfirmed": False, "assumptionNote": None,
            "handoffNote": None, "handedOffAt": None, "handedOffById": None,
            "updatedAt": None, "updatedById": None,
        }
    return {
        "quoteId": row.get("quote_id", quote_id),
        "scopeConfirmed": bool(row.get("scope_confirmed")),
        "scopeNote": row.get("scope_note"),
        "costConfirmed": bool(row.get("cost_confirmed")),
        "costNote": row.get("cost_note"),
        "timelineConfirmed": bool(row.get("timeline_confirmed")),
        "timelineNote": row.get("timeline_note"),
        "assumptionConfirmed": bool(row.get("assumption_confirmed")),
        "assumptionNote": row.get("assumption_note"),
        "handoffNote": row.get("handoff_note"),
        "handedOffAt": row.get("handed_off_at"),
        "handedOffById": row.get("handed_off_by"),
        "updatedAt": row.get("updated_at"),
        "updatedById": row.get("updated_by"),
    }


def get_quote_handoff_checklist(quote_id: str) -> dict:
    _ensure_quote_in_instance(quote_id)
    supabase: Client = get_supabase_client()
    result = supabase.table(HANDOFF_TABLE).select("*").eq("quote_id", quote_id).limit(1).execute()
    row = (result.data or [None])[0]
    return _row_to_handoff(quote_id, row)


def save_quote_handoff_checklist(quote_id: str, actor_id: str | None, payload: dict) -> dict:
    """Luu checklist ban giao (Scope/Cost/Timeline/Assumption) - upsert qua RPC
    (tu tinh handed_off_at/handed_off_by khi ca 4 muc deu da xac nhan, xem
    quote_save_handoff_checklist migration 085)."""
    _ensure_quote_in_instance(quote_id)
    supabase: Client = get_supabase_client()
    try:
        result = supabase.rpc("quote_save_handoff_checklist", {
            "p_quote_id": quote_id,
            "p_actor_id": actor_id,
            "p_scope_confirmed": bool(payload.get("scope_confirmed")),
            "p_scope_note": payload.get("scope_note"),
            "p_cost_confirmed": bool(payload.get("cost_confirmed")),
            "p_cost_note": payload.get("cost_note"),
            "p_timeline_confirmed": bool(payload.get("timeline_confirmed")),
            "p_timeline_note": payload.get("timeline_note"),
            "p_assumption_confirmed": bool(payload.get("assumption_confirmed")),
            "p_assumption_note": payload.get("assumption_note"),
            "p_handoff_note": payload.get("handoff_note"),
        }).execute()
    except Exception as exc:
        _raise_friendly_rpc_error(exc)
    data = result.data
    row = data[0] if isinstance(data, list) else data
    return _row_to_handoff(quote_id, row)


def _row_to_activity(row: dict) -> dict:
    return {
        "id": row["id"],
        "quoteId": row.get("quote_id"),
        "actorId": row.get("actor_id"),
        "action": row.get("action"),
        "changes": row.get("changes"),
        "createdAt": row.get("created_at"),
    }


def list_quote_activity_log(quote_id: str) -> list[dict]:
    """Lich su hoat dong THAT cua 1 bao gia (created/updated/approved/
    cancelled/version_created/stage_changed/handoff_updated/owner_assigned) -
    dung cho khoi "Activity & handoff" trong workspace. Actor chi tra id, FE tu
    resolve ten qua danh sach agents da co (khong join ten o backend)."""
    _ensure_quote_in_instance(quote_id, include_deleted=True)
    supabase: Client = get_supabase_client()
    result = (
        supabase.table(ACTIVITY_LOG_TABLE)
        .select("*")
        .eq("quote_id", quote_id)
        .order("created_at", desc=True)
        .execute()
    )
    return [_row_to_activity(row) for row in (result.data or [])]


_VALID_VERSION_REASONS = {"scope_change", "price_change", "add_items", "other"}


def log_quote_version_reason(quote_id: str, actor_id: str | None, reason: str) -> None:
    """Ghi THAT ly do tao version (chon o popup "Tao phien ban moi") vao
    quote_activity_log - RPC quote_create_version (migration 082/084) khong
    nhan tham so ly do nen ghi bang 1 dong INSERT rieng ngay sau khi version
    moi tao xong thanh cong (khong doi lai RPC versioning da on dinh qua nhieu
    migration). Chi chap nhan gia tri that trong danh sach ly do co dinh."""
    _ensure_quote_in_instance(quote_id)
    if reason not in _VALID_VERSION_REASONS:
        raise ValueError("Lý do tạo phiên bản không hợp lệ.")
    supabase: Client = get_supabase_client()
    supabase.table(ACTIVITY_LOG_TABLE).insert({
        "quote_id": quote_id, "actor_id": actor_id, "action": "version_reason",
        "changes": {"reason": reason},
    }).execute()


def delete_quote(quote_id: str) -> None:
    current = get_quote(quote_id)
    supabase: Client = get_supabase_client()
    if current and current.get("status") == "approved":
        raise ValueError("Báo giá đã duyệt, không thể xoá.")
    supabase.table(QUOTES_TABLE).delete().eq("id", quote_id).eq("instance", _crm_instance()).execute()


def link_quote_to_deal(quote_id: str, deal_id: str, reference: dict | None = None) -> dict:
    """Gắn quote_id (FK thật) + đồng bộ last_attachment_url/name + estimated_budget
    trên customer_leads — Deal Card/Drawer đọc y hệt như tham chiếu thủ công cũ
    (rowToDeal() phía frontend không cần sửa gì), chỉ khác nguồn dữ liệu giờ là
    quote thật thay vì user tự gõ tay."""
    _ensure_quote_in_instance(quote_id)
    supabase: Client = get_supabase_client()
    supabase.table(QUOTES_TABLE).update({"deal_id": deal_id, "updated_at": _now_iso()}).eq("id", quote_id).eq("instance", _crm_instance()).execute()

    update_data: dict[str, Any] = {"quote_id": quote_id}
    if reference:
        if reference.get("url"):
            update_data["last_attachment_url"] = reference["url"]
        if reference.get("number"):
            update_data["last_attachment_name"] = reference["number"]
        if reference.get("totalAmount"):
            current = (
                supabase.table("customer_leads")
                .select("estimated_budget")
                .eq("id", deal_id)
                .eq("instance", _crm_instance())
                .single()
                .execute()
                .data
            )
            if not (current or {}).get("estimated_budget"):
                update_data["estimated_budget"] = reference["totalAmount"]
    supabase.table("customer_leads").update(update_data).eq("id", deal_id).eq("instance", _crm_instance()).execute()
    return get_quote(quote_id)
