"""Pydantic v2 request and response schemas for WhatsApp Chat & Call module."""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


# ── Auth & Accounts ───────────────────────────────────────────────────────────

class ConnectQRRequest(BaseModel):
    label: Optional[str] = Field(default=None, max_length=120)
    account_id: Optional[str] = None
    proxy_url: Optional[str] = Field(default=None, max_length=512)


class ConnectPairingRequest(BaseModel):
    phone_number: str = Field(..., min_length=6, max_length=32)
    label: Optional[str] = Field(default=None, max_length=120)
    account_id: Optional[str] = None
    proxy_url: Optional[str] = Field(default=None, max_length=512)


class UpdateAccountSettingsRequest(BaseModel):
    label: Optional[str] = Field(default=None, max_length=120)
    auto_reject_calls: Optional[bool] = None
    auto_reject_message: Optional[str] = Field(default=None, max_length=1000)
    cloud_calling_enabled: Optional[bool] = None
    cloud_phone_number_id: Optional[str] = Field(default=None, max_length=128)
    cloud_waba_id: Optional[str] = Field(default=None, max_length=128)
    cloud_access_token: Optional[str] = None
    cloud_webhook_verify_token: Optional[str] = Field(default=None, max_length=256)
    proxy_url: Optional[str] = Field(default=None, max_length=512)


# ── Conversations ─────────────────────────────────────────────────────────────

class StartChatRequest(BaseModel):
    phone_number: str = Field(..., min_length=6, max_length=32)


class UpdateConversationRequest(BaseModel):
    is_pinned: Optional[bool] = None
    is_muted: Optional[bool] = None
    is_archived: Optional[bool] = None
    custom_label: Optional[str] = Field(default=None, max_length=120)


class TypingPresenceRequest(BaseModel):
    state: Literal["composing", "paused", "recording", "available", "unavailable"] = "composing"


# ── Messages ──────────────────────────────────────────────────────────────────

class SendTextRequest(BaseModel):
    account_id: str
    chat_jid: str
    text: str = Field(..., min_length=1, max_length=16000)
    reply_to_message_id: Optional[str] = None
    quoted_text: Optional[str] = None
    mentions: Optional[List[str]] = None


class SendLocationRequest(BaseModel):
    account_id: str
    chat_jid: str
    latitude: float = Field(..., ge=-90.0, le=90.0)
    longitude: float = Field(..., ge=-180.0, le=180.0)
    name: Optional[str] = Field(default=None, max_length=200)
    address: Optional[str] = Field(default=None, max_length=500)


class SendContactRequest(BaseModel):
    account_id: str
    chat_jid: str
    contact_name: str = Field(..., min_length=1, max_length=200)
    contact_phone: str = Field(..., min_length=5, max_length=40)


class SendPollRequest(BaseModel):
    account_id: str
    chat_jid: str
    question: str = Field(..., min_length=1, max_length=500)
    options: List[str] = Field(..., min_length=2, max_length=12)
    selectable_count: int = Field(default=1, ge=1, le=12)


class ReactMessageRequest(BaseModel):
    account_id: str
    chat_jid: str
    message_id: str
    emoji: str = Field(default="", max_length=32)


class EditMessageRequest(BaseModel):
    account_id: str
    chat_jid: str
    message_id: str
    text: str = Field(..., min_length=1, max_length=16000)


class DeleteMessageRequest(BaseModel):
    account_id: str
    chat_jid: str
    message_id: str
    for_everyone: bool = True


class ForwardMessageRequest(BaseModel):
    account_id: str
    from_chat_jid: str
    message_id: str
    to_chat_jid: str


# ── Quick Replies ─────────────────────────────────────────────────────────────

class CreateQuickReplyRequest(BaseModel):
    shortcut: str = Field(..., min_length=1, max_length=64)
    title: str = Field(..., min_length=1, max_length=160)
    content: str = Field(..., min_length=1, max_length=8000)
    category: str = Field(default="general", max_length=64)


class UpdateQuickReplyRequest(BaseModel):
    shortcut: Optional[str] = Field(default=None, min_length=1, max_length=64)
    title: Optional[str] = Field(default=None, min_length=1, max_length=160)
    content: Optional[str] = Field(default=None, min_length=1, max_length=8000)
    category: Optional[str] = Field(default=None, max_length=64)


# ── Calls (Dual-Mode: Baileys Signaling + Meta Cloud WebRTC + Handoff) ────────

class RejectCallRequest(BaseModel):
    account_id: str
    call_id: str
    caller_jid: str = ""
    auto_reply_text: Optional[str] = Field(default=None, max_length=2000)


class OutboundCallRequest(BaseModel):
    account_id: str
    chat_jid: Optional[str] = None
    target_phone: str = Field(..., min_length=5, max_length=40)
    is_video: bool = False
    sdp_offer: Optional[str] = None


class AcceptCallRequest(BaseModel):
    account_id: str
    sdp_answer: str = Field(..., min_length=10)


class TerminateCallRequest(BaseModel):
    account_id: str


class WhatsAppEnvelope(BaseModel):
    success: bool = True
    message: str = ""
    data: Any = None
    extra: Optional[Dict[str, Any]] = None
