"""Contracts schemas — hợp đồng gắn với customer_leads (CRM deal) + quotes đã chốt."""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


class ContractClauseInput(BaseModel):
    id: Optional[str] = None
    title: str
    body: str = ""


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


class ContractUpdateRequest(BaseModel):
    title: Optional[str] = None
    manual_customer_name: Optional[str] = None
    template_type: Optional[str] = None
    contract_value: Optional[float] = None
    currency: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    payment_terms: Optional[str] = None
    progress_percent: Optional[int] = Field(default=None, ge=0, le=100)
    payment_collected_percent: Optional[int] = Field(default=None, ge=0, le=100)
    owner_id: Optional[str] = None
    clauses: Optional[list[ContractClauseInput]] = None
    ai_risk_score: Optional[int] = Field(default=None, ge=0, le=100)
    ai_review: Optional[list[dict]] = None


class ContractStatusUpdateRequest(BaseModel):
    status: str
    signed_at: Optional[str] = None


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


class ContractReviewRequest(BaseModel):
    clauses: list[ContractClauseInput]
    quote_id: Optional[str] = None
    contract_value: Optional[float] = None
    payment_terms: Optional[str] = None


class ContractRefineRequest(BaseModel):
    clauses: list[ContractClauseInput]
    findings: list[dict] = Field(default_factory=list)
