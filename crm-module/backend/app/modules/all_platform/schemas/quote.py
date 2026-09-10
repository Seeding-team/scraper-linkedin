"""Quote Forms + Quotes schemas — real báo giá module gắn với customer_leads (CRM deal)."""

from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, Field


class QuoteFormCreateRequest(BaseModel):
    name: str
    description: Optional[str] = None
    status: str = "active"
    layout_type: str = "cloudgate_standard_quote"
    schema_version: int = 1
    schema_json: dict[str, Any]
    issuer_company_id: Optional[str] = None


class QuoteFormUpdateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    layout_type: Optional[str] = None
    schema_version: Optional[int] = None
    schema_json: Optional[dict[str, Any]] = None
    issuer_company_id: Optional[str] = None


class IssuerCompanyCreateRequest(BaseModel):
    code: str
    legal_name: str
    brand_name: Optional[str] = None
    address: Optional[str] = None
    contact_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    website: Optional[str] = None
    tax_code: Optional[str] = None
    logo_url: Optional[str] = None
    default_quote_form_id: Optional[str] = None
    status: str = "active"
    sort_order: int = 0


class IssuerCompanyUpdateRequest(BaseModel):
    code: Optional[str] = None
    legal_name: Optional[str] = None
    brand_name: Optional[str] = None
    address: Optional[str] = None
    contact_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    website: Optional[str] = None
    tax_code: Optional[str] = None
    logo_url: Optional[str] = None
    default_quote_form_id: Optional[str] = None
    status: Optional[str] = None
    sort_order: Optional[int] = None


class QuoteItemInput(BaseModel):
    # BUG THAT DA GAP (Muc cha/Section mat rowType sau save): truoc day model
    # nay KHONG co field row_type - FE (SeedingQuoteRepository.toQuoteItemPayload)
    # LUON gui dung `row_type: 'section'|'item'` trong JSON, nhung Pydantic
    # AM THAM bo qua key la (extra field khong khai bao) khi parse request,
    # nen moi lan luu (PUT /quotes/{id} hoac POST /quotes) deu xoa mat
    # row_type truoc khi toi RPC quote_update/create_quote - RPC (migration
    # 104) doc `v_item->>'row_type'` ra NULL, mac dinh coi la 'item' thuong.
    # Them field nay de model_dump() giu dung gia tri FE da gui.
    row_type: Optional[str] = None
    description: str = ""
    service_description: Optional[str] = None
    unit: Optional[str] = None
    quantity: float = 0
    unit_price: float = 0
    discount_percent: float = Field(default=0, ge=0, le=100)
    vat_rate: float = Field(default=0, ge=0, le=100)
    children: list["QuoteItemInput"] = Field(default_factory=list)
    # Danh mục dịch vụ: truy vết + snapshot USD/VND/tỷ giá tại thời điểm chọn dịch vụ.
    # Đông cứng ngay khi tạo/sửa báo giá - sửa catalog sau này không ảnh hưởng số liệu cũ.
    catalog_item_id: Optional[str] = None
    bundle_snapshot: Optional[list[dict[str, Any]]] = None
    list_price_usd: Optional[float] = None
    unit_price_usd: Optional[float] = None
    exchange_rate: Optional[float] = None
    unit_price_vnd: Optional[float] = None
    # Gia von/markup noi bo (migration 086) - None = chua nhap (bao gia cu
    # hoac chua ai dien), KHONG bia du lieu. RPC tu ep markup_percent=NULL neu
    # cost_price rong (xem quote_update, migration 086).
    cost_price: Optional[float] = Field(default=None, ge=0)
    markup_percent: Optional[float] = None
    # true = hang muc nay khong co gia von de nhap (vd phi ho tro, dich vu
    # thu ho) - cho phep bo qua yeu cau "bat buoc gia von" khi ban giao sang
    # xu ly gia (migration 090), KHAC voi cost_price=None mac dinh (= "chua
    # nhap", VAN bi chan ban giao).
    cost_not_applicable: bool = False
    # BUG THAT DA GAP (phat hien khi test snapshot USD Bang gia VPS Zone,
    # migration 106): 3 field nay da co san tren DB (quote_items) va da duoc
    # FE gui dung trong toQuoteItemPayload() (SeedingQuoteRepository.ts) tu
    # luong tao moi (POST /quotes), nhung model nay (dung CHUNG cho ca POST
    # LAN PUT/update) chua khai bao - Pydantic AM THAM bo qua (extra field
    # khong khai bao) moi lan sua bao gia qua Quote Workspace (PUT), khien
    # MOI hang muc them tu "Bảng giá VPS Zone" mat het lien ket toi
    # price_book_items goc lan toan bo snapshot audit-trail (costMode/
    # unitPriceUsd/exchangeRate/costUsd/customerPriceUsd...) ngay khi Luu -
    # giong het bug row_type da sua o tren.
    price_book_item_id: Optional[str] = None
    price_book_version_id: Optional[str] = None
    price_book_snapshot: Optional[dict[str, Any]] = None


class QuoteCreateRequest(BaseModel):
    deal_id: Optional[str] = None
    quote_form_id: str
    issuer_company_id: Optional[str] = None
    data: dict[str, Any] = {}
    items: list[QuoteItemInput] = []
    # Du an + SLA that (migration 097) - ca 2 deu tuy chon luc tao.
    project_id: Optional[str] = None
    sla_due_at: Optional[str] = None
    # "Loai bao gia" (migration 112) - multi-select code cua
    # category_type='crm_quote_type', chon duoc tu Buoc 1 luc tao.
    quote_type_codes: Optional[list[str]] = None


class QuoteUpdateRequest(BaseModel):
    """status/public_token/public_enabled KHÔNG còn client-settable qua đây -
    chỉ đổi được qua endpoint /approve (xem quote.py) sau khi qua kiểm tra
    quyền duyệt riêng."""

    data: Optional[dict[str, Any]] = None
    items: Optional[list[QuoteItemInput]] = None
    issuer_company_id: Optional[str] = None
    project_id: Optional[str] = None
    sla_due_at: Optional[str] = None
    # Giam gia tong cap quote (migration 106, muc 6.9) - None co y nghia THAT
    # su ("khong ap dung giam gia", khac voi "khong gui gi"), nen phai dung
    # model_fields_set o router (giong het project_id/sla_due_at) de phan
    # biet 2 truong hop nay.
    overall_discount_percent: Optional[float] = None
    # "Loai bao gia" (migration 112) - multi-select, cung dung model_fields_set
    # o router (list rong [] la gia tri that su hop le "bo chon het", khac
    # "khong gui gi").
    quote_type_codes: Optional[list[str]] = None


class QuoteStageUpdateRequest(BaseModel):
    """Phase 2 workspace - chuyen buoc xu ly noi bo (chi tien, xem
    quote_set_processing_stage RPC, migration 085)."""

    stage: str


class QuoteOwnersUpdateRequest(BaseModel):
    """Gan nguoi phu trach ky thuat/bao gia - field khong duoc gui (None +
    khong nam trong model_fields_set) nghia la "khong doi", con gui null that
    su nghia la "bo gan" (xem router: dung model_fields_set de phan biet)."""

    technical_owner_id: Optional[str] = None
    quote_owner_id: Optional[str] = None


class QuoteVersionReasonRequest(BaseModel):
    reason: str


class QuoteCancelRequest(BaseModel):
    reason: str


class QuoteSoftDeleteRequest(BaseModel):
    reason: Optional[str] = None


class QuotePublicAccessRestrictionUpdateRequest(BaseModel):
    """"Giới hạn xem link báo giá bằng Email hoặc Số điện thoại" (migration
    118, thay the QuotePublicEmailGateUpdateRequest cu chi ho tro email).
    `mode`: 'none' | 'email' | 'phone' - CHI 1 che do co hieu luc, tranh bug
    "tat gioi han nhung van hoi Email" do truoc day dung 1 boolean rieng
    song song voi danh sach email."""

    mode: str
    allowed_emails: list[str] = []
    allowed_phones: list[str] = []


class QuoteHardDeleteRequest(BaseModel):
    """Xac nhan hard-delete - client PHAI gui lai quote_number that (backend
    doi chieu voi ban ghi that truoc khi xoa, khong chi tin ID)."""

    quote_number: str
    reason: str
    request_id: Optional[str] = None


class QuoteRequestChangesRequest(BaseModel):
    target_stage: str
    reason: str


class QuoteApproveRequest(BaseModel):
    """Section 5 - Admin duyet ngoai le theo version. `exception_reason` CHI
    bat buoc (backend tu kiem tra, khong tin FE) khi evaluation ruleset gan
    nhat cua quote nay result != 'pass' (fail/insufficient_data/chua danh
    gia). Duyet binh thuong (rule pass, hoac chua cau hinh rule engine) thi
    field nay bo qua du co gui hay khong."""

    exception_reason: Optional[str] = None


class QuoteHandoffChecklistUpdateRequest(BaseModel):
    scope_confirmed: bool = False
    scope_note: Optional[str] = None
    cost_confirmed: bool = False
    cost_note: Optional[str] = None
    timeline_confirmed: bool = False
    timeline_note: Optional[str] = None
    assumption_confirmed: bool = False
    assumption_note: Optional[str] = None
    handoff_note: Optional[str] = None
