from __future__ import annotations

from typing import Any, List, Optional
from pydantic import BaseModel, Field


class EmailAttachment(BaseModel):
    id: Optional[str] = None
    name: str
    size: str
    type: str = "file"  # "pdf" | "image" | "file"
    url: Optional[str] = None
    content_type: Optional[str] = None
    size_bytes: Optional[int] = None
    # Send-only. Never populated in read responses.
    content_base64: Optional[str] = None


class EmailAccountResponse(BaseModel):
    id: str
    name: str
    email: str
    channel: str = "email"
    provider_type: str = "google_oauth"  # "google_oauth" | "imap_smtp" | "microsoft_oauth"
    status: str = "online"  # "online" | "offline" | "error" | "syncing" | "expired"
    unread_count: int = 0
    workspace: str
    last_synced_at: Optional[str] = None
    last_sync_error: Optional[str] = None
    total_threads: int = 0
    is_default: bool = False
    is_active: bool = True
    reconnect_required: bool = False


class EmailMessageResponse(BaseModel):
    id: str
    conversation_id: str
    message_id: str
    in_reply_to: Optional[str] = None
    references_header: Optional[str] = None
    sender: str = "them"  # "me" | "them" | "system"
    sender_name: Optional[str] = None
    sender_email: str
    recipient_emails: List[str] = Field(default_factory=list)
    cc_emails: List[str] = Field(default_factory=list)
    subject: Optional[str] = None
    text: str = ""
    html: Optional[str] = None
    time: str = ""
    status: Optional[str] = "delivered"
    attachments: List[EmailAttachment] = Field(default_factory=list)
    idempotency_key: Optional[str] = None


class CrmContractItem(BaseModel):
    id: str
    code: str
    title: str
    status: str
    amount: str
    signed_at: Optional[str] = None
    effective_date: Optional[str] = None


class EmailConversationResponse(BaseModel):
    id: str
    channel: str = "email"
    account_id: str
    account_label: str
    customer_name: str
    customer_avatar: str
    customer_email: str
    subject: Optional[str] = None
    unread_count: int = 0
    last_message_text: str = ""
    last_message_time: str = ""
    tags: List[str] = Field(default_factory=list)
    is_crm_matched: bool = False
    crm_data: dict[str, Any] = Field(default_factory=dict)
    opportunity: Optional[dict[str, Any]] = None
    quote: Optional[dict[str, Any]] = None
    contracts: List[CrmContractItem] = Field(default_factory=list)
    messages: List[EmailMessageResponse] = Field(default_factory=list)


class EmailSendRequest(BaseModel):
    text: str
    subject: Optional[str] = None
    html: Optional[str] = None
    attachments: Optional[List[EmailAttachment]] = None
    recipient_email: Optional[str] = None
    cc_emails: Optional[List[str]] = None
    reply_to_message_id: Optional[str] = None
    mode: Optional[str] = "reply"  # "reply" | "reply_all" | "forward"
    idempotency_key: Optional[str] = None
    from_email: Optional[str] = None


class EmailComposeRequest(BaseModel):
    recipient_email: str
    cc_emails: Optional[List[str]] = None
    subject: str
    text: str
    html: Optional[str] = None
    attachments: Optional[List[EmailAttachment]] = None
    idempotency_key: Optional[str] = None
    from_email: Optional[str] = None


class GoogleOAuthUrlResponse(BaseModel):
    auth_url: str
    client_id: str
    redirect_uri: str


class GoogleOAuthStateResponse(BaseModel):
    state: str
    origin: str
    expires_in: int = 600


class GoogleOAuthCallbackRequest(BaseModel):
    code: str
    redirect_uri: str
    state: str


class EmailAccountConnectImapRequest(BaseModel):
    email: str
    name: Optional[str] = None
    app_password: str
    imap_host: str = "imap.gmail.com"
    imap_port: int = 993
    smtp_host: str = "smtp.gmail.com"
    smtp_port: int = 587


class EmailAccountDisconnectRequest(BaseModel):
    account_id: str


class EmailSimulateIncomingRequest(BaseModel):
    sender_email: str
    sender_name: Optional[str] = None
    subject: str
    text: str
    attachments: Optional[List[EmailAttachment]] = None

