from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime


# ---------------------------------------------------------------------------
# Bảng stage hợp lệ — dùng để validate input từ client lẫn output ra view.
# ---------------------------------------------------------------------------
DEAL_STAGES = [
    "dealing", "proposal_sent", "negotiation", "contract_signed",
    "payment_1", "implementation", "acceptance", "payment_final",
    "post_sale_care", "lost", "on_hold",
    # Legacy values kept during migration/backfill audit.
    "new_lead", "contacted", "qualified", "requirement", "contract_sent", "won",
]
TERMINAL_STAGES = ["post_sale_care", "lost"]

# Trạng thái thanh toán — dùng để lọc nhanh "khách nào còn nợ tiền".
PAYMENT_STATUSES = ["unpaid", "partial", "paid"]

# ---------------------------------------------------------------------------
# Transition graph — không ép thứ tự pipeline nữa, cho chuyển tới bất kỳ stage
# nào khác (mirror 1:1 allowedNextStages() trong
# linkedin-crawler-ui/modules/crm/constants/crmConfig.ts). Deal ở won/lost vẫn
# bị chặn "from" ngay ở transition_stage() (terminal, xem check phía dưới) nên
# không cần liệt kê gì ở đây cho 2 stage đó. Backend có API riêng gọi trực tiếp
# được (bypass UI) nên phải enforce lại ở đây, không chỉ ở client.
# ---------------------------------------------------------------------------
DEAL_STAGE_TRANSITIONS: dict[str, list[str]] = {
    stage: [s for s in DEAL_STAGES if s != stage] for stage in DEAL_STAGES
}


def is_transition_allowed(from_stage: str, to_stage: str) -> bool:
    """True nếu được phép chuyển from_stage -> to_stage (hoặc giữ nguyên)."""
    if from_stage == to_stage:
        return True
    return to_stage in DEAL_STAGE_TRANSITIONS.get(from_stage, [])

# Required fields theo stage — server-side enforcement, mirror với client.
# Khi client POST transition, server check lại để chặn hack.
STAGE_REQUIRED_FIELDS: dict[str, dict[str, list[str]]] = {
    "dealing":        {},
    "proposal_sent":  {"required": ["attachment_url"]},
    "negotiation":    {"required": ["note"]},
    "contract_signed": {"required": ["attachment_url"]},
    "payment_1":      {"required": ["estimated_budget", "follow_up_date", "attachment_url"]},
    "implementation": {"required": ["sdr_id", "follow_up_date"]},
    "acceptance":     {"required": ["follow_up_date", "attachment_url"]},
    "payment_final":  {"required": ["estimated_budget", "follow_up_date", "attachment_url"]},
    "post_sale_care": {},
    "lost":           {"required": ["reject_reason_type", "note"]},
    "on_hold":        {"required": ["follow_up_date", "note"]},
    # Legacy rules kept until old data/UI paths are fully removed.
    "new_lead":       {},
    "contacted":      {"required": ["note"]},
    "qualified":      {"required": ["decision_maker", "estimated_budget", "note"]},
    "requirement":    {"required": ["note", "attachment_url"]},
    "contract_sent":  {"required": ["attachment_url"]},
    "won":            {},
}


# ---------------------------------------------------------------------------
# Base customer schemas (giữ từ schema cũ + thêm pipeline fields)
# ---------------------------------------------------------------------------
class CustomerLeadCreate(BaseModel):
    customer_name: str
    customer_id: Optional[str] = None
    # Du an that (migration 097) - null = Co hoi chua gan Du an.
    project_id: Optional[str] = None

    company_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    website: Optional[str] = None
    industry: Optional[str] = None
    tax_code: Optional[str] = None

    leaded_by: Optional[str] = None
    leaded_by_name_hint: Optional[str] = None
    conv_id: Optional[str] = None
    source_platform: Optional[str] = "FB_Inbox"

    is_assigned: bool = False
    sdr_id: Optional[str] = None
    sdr_name_hint: Optional[str] = None

    # Legacy status + activity
    status: str = "pending"
    activity_status: str = "active"

    # CRM pipeline (mới)
    deal_stage: Optional[str] = "dealing"  # nếu None sẽ fall back về dealing
    prev_stage: Optional[str] = None
    follow_up_date: Optional[datetime] = None
    decision_maker: Optional[str] = None
    estimated_budget: Optional[float] = 0
    stage_entered_at: Optional[datetime] = None

    customer_since: Optional[datetime] = None
    service_package: Optional[str] = None
    lifetime_value: Optional[float] = 0
    billing_type: str = "one_time"  # migration 052: don 1 lan / theo thang / theo nam
    contract_signed_at: Optional[datetime] = None
    contract_status: str = "active"

    warranty_expires_at: Optional[datetime] = None
    care_note: Optional[str] = None
    last_care_at: Optional[datetime] = None

    # Thanh toán — hạn trả tiền + trạng thái (chưa/một phần/đã thanh toán)
    payment_due_date: Optional[datetime] = None
    payment_status: Optional[str] = "unpaid"

    tags: Optional[List[str]] = []
    has_budget: bool = False
    note: Optional[str] = None

    reject_reason: Optional[str] = None
    reject_reason_type: Optional[str] = None

    review_result: Optional[str] = None

    last_attachment_url: Optional[str] = None
    last_attachment_name: Optional[str] = None
    closed_reason: Optional[str] = None

    # crm-next fields (migration 041)
    position: Optional[str] = None
    crm_package: Optional[str] = None
    zalo: Optional[str] = None
    facebook: Optional[str] = None
    telegram: Optional[str] = None
    pause_reason: Optional[str] = None
    next_step: Optional[str] = None
    closed_at: Optional[datetime] = None
    outcome_detail: Optional[dict] = None
    quote_id: Optional[str] = None

    # migration 079 — Chuc vu category-driven select (category_type=crm_position).
    # position_label_snapshot is NEVER trusted from client — service layer
    # always re-derives it server-side from the resolved category.
    position_category_id: Optional[str] = None

    # migration 050 — Team gan cho deal nay (chon tay trong form deal)
    team_id: Optional[str] = None


class CustomerLeadUpdate(BaseModel):
    customer_id: Optional[str] = None
    # Du an that (migration 097) - None/khong gui = giu nguyen; gui project_id=null
    # RO RANG (khong phai bo qua key) = bo gan Du an that su (xem router
    # update_customer_lead() - PHAI dung exclude_unset de phan biet 2 truong hop nay).
    project_id: Optional[str] = None
    company_name: Optional[str] = None
    customer_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    website: Optional[str] = None
    industry: Optional[str] = None
    tax_code: Optional[str] = None

    leaded_by: Optional[str] = None
    leaded_by_name_hint: Optional[str] = None
    conv_id: Optional[str] = None
    source_platform: Optional[str] = None

    is_assigned: Optional[bool] = None
    sdr_id: Optional[str] = None
    sdr_name_hint: Optional[str] = None

    status: Optional[str] = None
    activity_status: Optional[str] = None

    # CRM pipeline
    deal_stage: Optional[str] = None
    prev_stage: Optional[str] = None
    follow_up_date: Optional[datetime] = None
    decision_maker: Optional[str] = None
    estimated_budget: Optional[float] = None
    stage_entered_at: Optional[datetime] = None

    customer_since: Optional[datetime] = None
    service_package: Optional[str] = None
    lifetime_value: Optional[float] = None
    billing_type: Optional[str] = None
    contract_signed_at: Optional[datetime] = None
    contract_status: Optional[str] = None

    warranty_expires_at: Optional[datetime] = None
    care_note: Optional[str] = None
    last_care_at: Optional[datetime] = None

    payment_due_date: Optional[datetime] = None
    payment_status: Optional[str] = None

    tags: Optional[List[str]] = None
    has_budget: Optional[bool] = None
    note: Optional[str] = None

    reject_reason: Optional[str] = None
    reject_reason_type: Optional[str] = None

    review_result: Optional[str] = None

    last_attachment_url: Optional[str] = None
    last_attachment_name: Optional[str] = None
    closed_reason: Optional[str] = None

    # crm-next fields (migration 041)
    position: Optional[str] = None
    crm_package: Optional[str] = None
    zalo: Optional[str] = None
    facebook: Optional[str] = None
    telegram: Optional[str] = None
    pause_reason: Optional[str] = None
    next_step: Optional[str] = None
    closed_at: Optional[datetime] = None
    outcome_detail: Optional[dict] = None
    quote_id: Optional[str] = None

    # migration 079
    position_category_id: Optional[str] = None

    # migration 050
    team_id: Optional[str] = None


class CustomerLeadResponse(BaseModel):
    id: str
    customer_id: Optional[str] = None
    customer_name: str
    company_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    website: Optional[str] = None
    industry: Optional[str] = None
    tax_code: Optional[str] = None
    leaded_by: Optional[str] = None
    leaded_by_name_hint: Optional[str] = None
    conv_id: Optional[str] = None
    source_platform: Optional[str] = None
    is_assigned: bool = False
    sdr_id: Optional[str] = None
    sdr_name_hint: Optional[str] = None

    # legacy
    status: str = "pending"
    activity_status: str = "active"

    # CRM pipeline
    deal_stage: Optional[str] = "dealing"
    prev_stage: Optional[str] = None
    follow_up_date: Optional[datetime] = None
    decision_maker: Optional[str] = None
    estimated_budget: Optional[float] = 0
    stage_entered_at: Optional[datetime] = None
    days_in_stage: Optional[int] = 0  # computed field
    last_attachment_url: Optional[str] = None
    last_attachment_name: Optional[str] = None
    closed_reason: Optional[str] = None

    customer_since: Optional[datetime] = None
    service_package: Optional[str] = None
    lifetime_value: Optional[float] = 0
    billing_type: str = "one_time"
    contract_signed_at: Optional[datetime] = None
    contract_status: str = "active"
    warranty_expires_at: Optional[datetime] = None
    care_note: Optional[str] = None
    last_care_at: Optional[datetime] = None
    payment_due_date: Optional[datetime] = None
    payment_status: str = "unpaid"
    tags: Optional[List[str]] = []
    has_budget: bool = False
    note: Optional[str] = None
    reject_reason: Optional[str] = None
    reject_reason_type: Optional[str] = None
    review_result: Optional[str] = None

    # crm-next fields (migration 041)
    position: Optional[str] = None
    crm_package: Optional[str] = None
    zalo: Optional[str] = None
    facebook: Optional[str] = None
    telegram: Optional[str] = None
    pause_reason: Optional[str] = None
    next_step: Optional[str] = None
    closed_at: Optional[datetime] = None
    outcome_detail: Optional[dict] = None
    quote_id: Optional[str] = None

    # migration 079
    position_category_id: Optional[str] = None
    position_label_snapshot: Optional[str] = None

    created_at: datetime
    updated_at: datetime
    leader_name: Optional[str] = None
    sdr_name: Optional[str] = None

    # migration 050
    team_id: Optional[str] = None
    team_name: Optional[str] = None
    team_type: Optional[str] = None


# ---------------------------------------------------------------------------
# Pipeline-specific schemas
# ---------------------------------------------------------------------------
class StageTransitionRequest(BaseModel):
    """Body gửi kèm khi client kéo-thả sang stage mới."""
    to_stage: str = Field(..., description="Stage đích, phải nằm trong DEAL_STAGES")
    note: Optional[str] = None
    attachment_url: Optional[str] = None
    attachment_name: Optional[str] = None
    reject_reason_type: Optional[str] = None
    reject_reason_text: Optional[str] = None
    prev_stage: Optional[str] = None
    follow_up_date: Optional[datetime] = None
    decision_maker: Optional[str] = None
    estimated_budget: Optional[float] = None
    closed_reason: Optional[str] = None
    pause_reason: Optional[str] = None
    closed_at: Optional[datetime] = None
    outcome_detail: Optional[dict] = None


class ActivityLogEntry(BaseModel):
    id: str
    customer_id: str
    action: str
    from_stage: Optional[str] = None
    to_stage: Optional[str] = None
    field: Optional[str] = None
    old_value: Optional[str] = None
    new_value: Optional[str] = None
    actor_id: Optional[str] = None
    actor_name: Optional[str] = None
    note: Optional[str] = None
    attachment_url: Optional[str] = None
    attachment_name: Optional[str] = None
    created_at: datetime


class ActivityLogResponse(BaseModel):
    items: List[ActivityLogEntry]
    total: int
