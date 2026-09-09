"""Bảng giá VPS Zone — endpoint nội bộ (auth), KHÔNG có endpoint public riêng
(public/PDF tiếp tục dùng đúng allowlist hiện có của quotes_router, đọc từ
quote_items đã snapshot - xem supabase_quote_service._row_to_public_item()).

2 nhóm endpoint:
  - `/price-book-items` (picker trong Quote Workspace): CHỈ đọc version
    'published', dùng CHUNG cho MỌI issuer_company_id (không lọc theo issuer -
    catalog VPS Zone dùng chung mọi công ty phát hành, giống "Sản phẩm & dịch
    vụ" nội bộ; trước đây có lọc theo issuer_company_id của quote nhưng gây
    bug thật: quote thuộc issuer khác issuer đã tạo price book thì luôn thấy
    0 sản phẩm dù đã publish). Ẩn field cost nếu người gọi không qua được
    can_view_price_book_cost().
  - `/price-book-admin/*` (tab "Bảng giá VPS Zone" trong Sản phẩm & dịch vụ):
    CRUD Draft + publish, CHỈ admin (can_manage_price_book).
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.core.supabase_client import get_supabase_client
from app.modules.all_platform.auth_deps import get_current_user
from app.modules.all_platform.schemas import BaseResponse
from app.modules.all_platform.services import price_book_service as pbs
from app.modules.all_platform.services.crm_permission_service import (
    can_manage_price_book,
    can_view_price_book_cost,
)
from app.modules.all_platform.services.supabase_quote_service import QuoteNotFoundError, get_quote

price_book_router = APIRouter()
price_book_admin_router = APIRouter()


def _safe_error_message(exc: Exception) -> str:
    return str(exc)


# ─────────────────────────────────────────────────────────────────────────
# Picker (Quote Workspace) - CHI doc version published, luon qua quote_id.
# ─────────────────────────────────────────────────────────────────────────

@price_book_router.get("")
def price_book_items_list(quote_id: Optional[str] = Query(None), user: dict = Depends(get_current_user)) -> BaseResponse:
    # BUG THAT DA GAP ("SAO ĐANG TẠO CÁI MỚI MÀ BÊN VPS ZONE K HIỂN DANH MỤC
    # TA"): quote_id truoc day BAT BUOC (Query(...)) - luc dang TAO MOI 1
    # quote (chua bam Bàn giao lan nao, chua co quote.id THAT), FE khong co
    # quote_id nao de goi, nen tab "Bảng giá VPS Zone" luon thay 0 san pham,
    # ke ca khi danh muc noi bo ("Danh mục nội bộ") van xem binh thuong o che
    # do tao moi. Mirror dung pattern cua service_catalog_get_all(): quote_id
    # optional - thieu quote_id (dang tao moi) VAN tra danh sach san pham
    # day du, CHI AN gia von/markup (an toan tuyet doi, khong suy doan
    # "nguoi goi se la owner" - giong dung nguyen tac da ap dung cho
    # service-catalog).
    quote: Optional[dict] = None
    if quote_id:
        try:
            quote = get_quote(quote_id)
        except QuoteNotFoundError:
            quote = None

    # BUG THAT DA GAP: truoc day loc price_books THEO DUNG issuer_company_id
    # cua quote (chong IDOR/ro ri gia von giua cac issuer) - nhung thuc te
    # "Bang gia VPS Zone" la 1 catalog DUNG CHUNG cho moi cong ty phat hanh
    # (giong "San pham & dich vu" noi bo, khong rieng cho tung issuer), va
    # trong DB chi co DUNG 1 dong price_books (code=VPS_ZONE) gan issuer cu
    # the - khien MOI quote thuoc issuer KHAC (vd Markee) tra ve 0 san pham
    # du price book da publish that. Tra ve theo CODE thoi (bo dieu kien
    # issuer_company_id) - quyen xem GIA VON van gate rieng qua
    # can_view_price_book_cost() ben duoi, KHONG lien quan gi den buoc tim
    # price_books nay ca nen bo loc issuer khong lam lo them thong tin gi.
    client = get_supabase_client()
    pb = (
        client.table("price_books")
        .select("id")
        .eq("code", pbs.PRICE_BOOK_CODE)
        .limit(1)
        .execute()
    )
    if not pb.data:
        return BaseResponse(success=True, data=[])

    items = pbs.get_published_items(pb.data[0]["id"])
    # Lop XEM QUY DOI USD (tham khao, KHONG phai bao gia chinh thuc) - tinh
    # THAT o backend bang Decimal (costUsd/customerPriceUsd), merge TRUOC khi
    # strip de costUsd cung duoc an dung nhu costUnit/costTotal khi khong du
    # quyen xem gia von.
    items = pbs.attach_usd_conversion(items)
    if not can_view_price_book_cost(user, quote):
        items = [pbs.strip_cost_fields(i) for i in items]
    return BaseResponse(success=True, data=items)


# ─────────────────────────────────────────────────────────────────────────
# Admin CRUD (tab "Bảng giá VPS Zone")
# ─────────────────────────────────────────────────────────────────────────

class PriceBookItemUpsertRequest(BaseModel):
    sourceSheet: str
    sourceStt: str
    sourceGroupLabel: str
    sku: str
    name: str
    description: Optional[str] = None
    unit: Optional[str] = None
    defaultQuantity: float = 1
    productImageUrl: Optional[str] = None
    costMode: str
    vendorName: Optional[str] = None
    listPriceUsd: Optional[float] = None
    unitPriceUsd: Optional[float] = None
    unitPriceVndDirect: Optional[float] = None
    exchangeRate: Optional[float] = None
    importDutyPercent: float = 0
    vatInPercent: float = 0
    quoteReceivedDate: Optional[str] = None
    quoteLink: Optional[str] = None
    defaultRatePercent: float = 0
    vatEuPercent: float = 0
    referencePrice: Optional[float] = None
    referenceLink: Optional[str] = None


@price_book_admin_router.get("/items")
def price_book_admin_list_items(
    status: str = Query("draft", pattern="^(draft|published)$"), user: dict = Depends(get_current_user)
) -> BaseResponse:
    if not can_manage_price_book(user):
        raise HTTPException(status_code=403, detail="Chỉ Admin mới được quản lý Bảng giá VPS Zone")
    try:

        client = get_supabase_client()
        pb = client.table("price_books").select("id").eq("code", pbs.PRICE_BOOK_CODE).limit(1).execute()
        if not pb.data:
            return BaseResponse(success=True, data={"version": None, "items": []})
        version = (
            client.table("price_book_versions")
            .select("*")
            .eq("price_book_id", pb.data[0]["id"])
            .eq("status", status)
            .limit(1)
            .execute()
        )
        if not version.data:
            return BaseResponse(success=True, data={"version": None, "items": []})
        items = pbs.list_items_for_version(version.data[0]["id"])
        # Admin da qua gate can_manage_price_book() o tren - luon du quyen
        # xem gia von, khong can strip, chi can merge lop quy doi USD.
        items = pbs.attach_usd_conversion(items)
        return BaseResponse(success=True, data={"version": version.data[0], "items": items})
    except Exception as e:
        return BaseResponse(success=False, message=_safe_error_message(e))


@price_book_admin_router.post("/items")
def price_book_admin_create_item(payload: PriceBookItemUpsertRequest, user: dict = Depends(get_current_user)) -> BaseResponse:
    if not can_manage_price_book(user):
        raise HTTPException(status_code=403, detail="Chỉ Admin mới được quản lý Bảng giá VPS Zone")
    try:

        client = get_supabase_client()
        pb = client.table("price_books").select("id, issuer_company_id").eq("code", pbs.PRICE_BOOK_CODE).limit(1).execute()
        if not pb.data:
            return BaseResponse(success=False, message="Chưa khởi tạo Bảng giá VPS Zone (thiếu issuer_company_id) - liên hệ dev.")
        item = pbs.create_item(pb.data[0]["id"], user.get("id"), payload.model_dump())
        return BaseResponse(success=True, message="Đã thêm sản phẩm", data=item)
    except pbs.PriceBookError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        return BaseResponse(success=False, message=_safe_error_message(e))


@price_book_admin_router.put("/items/{item_id}")
def price_book_admin_update_item(item_id: str, payload: PriceBookItemUpsertRequest, user: dict = Depends(get_current_user)) -> BaseResponse:
    if not can_manage_price_book(user):
        raise HTTPException(status_code=403, detail="Chỉ Admin mới được quản lý Bảng giá VPS Zone")
    try:
        item = pbs.update_item(item_id, user.get("id"), payload.model_dump())
        return BaseResponse(success=True, message="Đã lưu (bản nháp)", data=item)
    except pbs.PriceBookError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        return BaseResponse(success=False, message=_safe_error_message(e))


@price_book_admin_router.post("/items/{item_id}/discontinue")
def price_book_admin_discontinue_item(item_id: str, user: dict = Depends(get_current_user)) -> BaseResponse:
    if not can_manage_price_book(user):
        raise HTTPException(status_code=403, detail="Chỉ Admin mới được quản lý Bảng giá VPS Zone")
    try:
        item = pbs.discontinue_item(item_id, user.get("id"))
        return BaseResponse(success=True, message="Đã ngừng kinh doanh", data=item)
    except pbs.PriceBookError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        return BaseResponse(success=False, message=_safe_error_message(e))


@price_book_admin_router.delete("/items/{item_id}")
def price_book_admin_delete_item(item_id: str, user: dict = Depends(get_current_user)) -> BaseResponse:
    if not can_manage_price_book(user):
        raise HTTPException(status_code=403, detail="Chỉ Admin mới được quản lý Bảng giá VPS Zone")
    try:
        result = pbs.delete_item(item_id, user.get("id"))
        message = "Đã xoá sản phẩm" if result["deleted"] else "Sản phẩm đã từng dùng trong báo giá - chuyển sang Ngừng kinh doanh"
        return BaseResponse(success=True, message=message, data=result)
    except pbs.PriceBookError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        return BaseResponse(success=False, message=_safe_error_message(e))


@price_book_admin_router.post("/publish")
def price_book_admin_publish(user: dict = Depends(get_current_user)) -> BaseResponse:
    if not can_manage_price_book(user):
        raise HTTPException(status_code=403, detail="Chỉ Admin mới được quản lý Bảng giá VPS Zone")
    try:

        client = get_supabase_client()
        pb = client.table("price_books").select("id").eq("code", pbs.PRICE_BOOK_CODE).limit(1).execute()
        if not pb.data:
            return BaseResponse(success=False, message="Chưa có Bảng giá VPS Zone nào để phát hành")
        draft = (
            client.table("price_book_versions")
            .select("id")
            .eq("price_book_id", pb.data[0]["id"])
            .eq("status", "draft")
            .limit(1)
            .execute()
        )
        if not draft.data:
            return BaseResponse(success=False, message="Không có bản nháp nào đang mở để phát hành")
        result = pbs.publish_version(draft.data[0]["id"], user.get("id"))
        return BaseResponse(success=True, message="Đã phát hành phiên bản mới", data=result)
    except Exception as e:
        return BaseResponse(success=False, message=_safe_error_message(e))


@price_book_admin_router.get("/audit-log")
def price_book_admin_audit_log(user: dict = Depends(get_current_user)) -> BaseResponse:
    if not can_manage_price_book(user):
        raise HTTPException(status_code=403, detail="Chỉ Admin mới được quản lý Bảng giá VPS Zone")
    try:

        client = get_supabase_client()
        pb = client.table("price_books").select("id").eq("code", pbs.PRICE_BOOK_CODE).limit(1).execute()
        if not pb.data:
            return BaseResponse(success=True, data=[])
        return BaseResponse(success=True, data=pbs.get_audit_log(pb.data[0]["id"]))
    except Exception as e:
        return BaseResponse(success=False, message=_safe_error_message(e))
