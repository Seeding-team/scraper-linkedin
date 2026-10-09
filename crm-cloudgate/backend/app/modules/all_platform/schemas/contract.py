"""Contracts schemas — hợp đồng gắn với customer_leads (CRM deal) + quotes đã chốt."""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


class ContractClauseInput(BaseModel):
    id: Optional[str] = None
    title: str
    body: str = ""


class RepresentativeOverrideInput(BaseModel):
    """Người đại diện ký Bên A đã được Sale CHỌN/XÁC NHẬN ở AI Copilot - vai trò nghiệp vụ riêng,
    không mặc nhiên = Người liên hệ của Deal (xem contract_ai_service.resolve_representative())."""
    name: str
    position: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    contact_id: Optional[str] = None


class LegalOverrideInput(BaseModel):
    """Bổ sung tại chỗ trong Copilot (không rời luồng soạn hợp đồng): chỉ các trường THẬT SỰ thiếu.
    Phân 2 nhóm rõ ràng - company_* ghi vào Customer (doanh nghiệp), contact_* ghi vào Contact (người liên hệ)."""
    company_name: Optional[str] = None
    tax_code: Optional[str] = None
    address: Optional[str] = None
    contact_name: Optional[str] = None
    contact_position: Optional[str] = None
    contact_phone: Optional[str] = None
    contact_email: Optional[str] = None


class ContractCreateRequest(BaseModel):
    deal_id: Optional[str] = None
    # "Ghi nhận hợp đồng có sẵn": hợp đồng bên ngoài đã có SỐ HỢP ĐỒNG riêng
    # (theo hệ thống đánh số của bên ký ngoài đời) - client được truyền số
    # này thay vì luôn bị ép nhận số tự sinh của CRM. None/rỗng (mọi luồng
    # tạo khác) vẫn tự sinh như cũ (_next_contract_number()).
    contract_number: Optional[str] = None
    # Khach hang CRM that (crm_customers.id) - dung khi khong chon deal_id
    # nhung van chon duoc 1 khach hang co san, de hop dong resolve duoc ve
    # Customer 360 (xem related_records()). Neu co deal_id, customer_id se bi
    # bo qua o service layer va tu suy ra tu deal (deal thang).
    customer_id: Optional[str] = None
    # Ten khach hang nhap tay - fallback khi khach hang chua ton tai trong CRM
    # (khong chon duoc customer_id). Neu co deal_id thi FE nen bo trong,
    # dealCustomerName tu deal se duoc uu tien hien thi.
    manual_customer_name: Optional[str] = None
    quote_id: Optional[str] = None
    title: str
    # Tên viết tắt công ty dùng cho mã hợp đồng ({SHORT}) - chỉ để sinh số, không lưu thành cột riêng
    number_short: Optional[str] = None
    template_type: str = "service"
    # Hop dong ngoai thuong duoc ghi lai SAU khi da ky that ngoai doi - cho
    # phep chon trang thai/ngay ky ngay luc tao thay vi luon ep 'draft'. Dung
    # lai dung enum status da co san tren contracts (khong them gia tri moi).
    status: Optional[str] = None
    signed_at: Optional[str] = None
    contract_value: float = 0
    currency: str = "VND"
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    payment_terms: Optional[str] = None
    progress_percent: int = Field(default=0, ge=0, le=100)
    payment_collected_percent: int = Field(default=0, ge=0, le=100)
    owner_id: Optional[str] = None
    clauses: list[ContractClauseInput] = Field(default_factory=list)
    ai_generated: bool = False
    ai_risk_score: Optional[int] = Field(default=None, ge=0, le=100)
    ai_review: Optional[list[dict]] = None
    ai_prompt: Optional[str] = None
    # Migration 136 — "Ghi nhận hợp đồng có sẵn" (hợp đồng ký/tạo bên ngoài
    # CRM). source mặc định 'crm' (giữ nguyên hành vi cũ cho mọi luồng tạo
    # khác) - CHỈ router "register-external" mới gửi source='external'.
    source: Optional[str] = None
    file_url: Optional[str] = None
    note: Optional[str] = None
    # "Ghi nhận hợp đồng có sẵn" (feedback mentor 2026-10-03): phan biet ro
    # hop dong Mua vao (Phase 1) / Ban ra (Phase 2) - cung 1 cot deal_phase
    # da co san tren contracts (migration contract_deal_phase.sql), truoc day
    # CHI duoc ghi qua luong Phase1/Phase2 rieng trong CrmCustomerModal.tsx.
    deal_phase: Optional[str] = None
    contact_id: Optional[str] = None
    # Migration 186 — người đại diện ký đã xác nhận (checkbox thật, không phải "Tôi đã hiểu" vượt qua) + ảnh chụp pháp lý 2 bên
    # dùng khi Sale chọn "Chỉ dùng cho hợp đồng này" ở Copilot (xem IssuerInlineEditor/LegalInfoEditor phía frontend).
    representative_confirmed: bool = False
    legal_snapshot: Optional[dict] = None


class ContractUpdateRequest(BaseModel):
    title: Optional[str] = None
    manual_customer_name: Optional[str] = None
    template_type: Optional[str] = None
    status: Optional[str] = None
    contract_value: Optional[float] = None
    currency: Optional[str] = None
    signed_at: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    payment_terms: Optional[str] = None
    progress_percent: Optional[int] = Field(default=None, ge=0, le=100)
    payment_collected_percent: Optional[int] = Field(default=None, ge=0, le=100)
    owner_id: Optional[str] = None
    clauses: Optional[list[ContractClauseInput]] = None
    ai_risk_score: Optional[int] = Field(default=None, ge=0, le=100)
    ai_review: Optional[list[dict]] = None
    source: Optional[str] = None
    file_url: Optional[str] = None
    # Sửa hợp đồng bằng form đầy đủ (giống form Thêm hợp đồng).
    note: Optional[str] = None
    quote_id: Optional[str] = None
    deal_id: Optional[str] = None
    contact_id: Optional[str] = None
    deal_phase: Optional[str] = None
    contract_number: Optional[str] = None
    representative_confirmed: Optional[bool] = None
    legal_snapshot: Optional[dict] = None


class ContractStatusUpdateRequest(BaseModel):
    status: str
    signed_at: Optional[str] = None
    # Phiên bản tài liệu được gửi duyệt/duyệt/ký (ghi vào lịch sử)
    version: Optional[int] = None


class ContractGenerateRequest(BaseModel):
    # Optional — hop dong khong bat buoc gan CRM (yeu cau tu Mylife: "hop dong
    # thi ko lien quan crm lam"). AI van soan duoc chi voi mau tham chieu +
    # yeu cau them, khong can chon khach hang/bao gia.
    deal_id: Optional[str] = None
    manual_customer_name: Optional[str] = None
    quote_id: Optional[str] = None
    template_type: str = "service"
    detail_level: str = "standard"
    extra_prompt: Optional[str] = None
    reference_template_id: Optional[str] = None
    # Tuỳ chọn nâng cao ở bước Yêu cầu AI (chỉ ảnh hưởng văn phong; không được đổi số liệu)
    language: Optional[str] = None
    style: Optional[str] = None
    # Customer 360 truyền customer_id => backend BẮT BUỘC có deal_id hợp lệ (không chỉ chặn ở frontend)
    customer_id: Optional[str] = None
    # Đã xác nhận để trống (………) các trường pháp lý còn thiếu
    acknowledge_missing: bool = False
    # Text trích từ PDF mẫu người dùng vừa tải lên (chỉ để tham chiếu văn phong; không dùng làm nguồn số liệu)
    reference_text: Optional[str] = None
    # Khách có nhiều Contact: Sale chọn tường minh người liên hệ cho hợp đồng này (thắng liên hệ chính mặc định của Deal).
    contact_id: Optional[str] = None
    # Người đại diện ký đã chọn/nhập + XÁC NHẬN ở Copilot (không mặc nhiên = Người liên hệ).
    representative: Optional[RepresentativeOverrideInput] = None
    # "Bổ sung tại chỗ": chỉ áp dụng cho PHIÊN SOẠN THẢO này (không ghi CRM) khi save_overrides_to_crm=False.
    legal_overrides: Optional[LegalOverrideInput] = None
    save_overrides_to_crm: bool = False


class ContractReviewRequest(BaseModel):
    clauses: list[ContractClauseInput]
    quote_id: Optional[str] = None
    contract_value: Optional[float] = None
    payment_terms: Optional[str] = None


class ContractRefineRequest(BaseModel):
    clauses: list[ContractClauseInput]
    findings: list[dict] = Field(default_factory=list)


class ContractPrecheckRequest(BaseModel):
    customer_id: Optional[str] = None
    deal_id: Optional[str] = None
    quote_id: Optional[str] = None
    contact_id: Optional[str] = None
    representative: Optional[RepresentativeOverrideInput] = None
    legal_overrides: Optional[LegalOverrideInput] = None
    save_overrides_to_crm: bool = False


class ContractSuggestTypeRequest(BaseModel):
    customer_id: Optional[str] = None
    deal_id: Optional[str] = None
    quote_id: Optional[str] = None
    extra_prompt: Optional[str] = None
    template_name: Optional[str] = None


class ContractNumberSettingsRequest(BaseModel):
    number_format: str
    short_name: Optional[str] = None
