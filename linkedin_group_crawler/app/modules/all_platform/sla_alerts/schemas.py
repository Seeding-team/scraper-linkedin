"""Pydantic v2 schemas for Omnichannel Inbox SLA Tracking & Zalo Group Alert Forwarding."""

from __future__ import annotations

import re
from typing import Any, List, Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

SUPPORTED_SLA_CHANNELS = ("zalo", "messenger", "telegram", "whatsapp", "email")
BACKFILL_CHANNELS = ("zalo", "messenger", "telegram", "whatsapp")

_HHMM_PATTERN = re.compile(r"^(\d{2}):(\d{2})$")


def _parse_hhmm(value: str) -> int:
    match = _HHMM_PATTERN.match(value.strip())
    if not match:
        raise ValueError("Giờ phải có định dạng HH:MM (ví dụ 08:00)")
    hour = int(match.group(1))
    minute = int(match.group(2))
    if hour == 24 and minute == 0:
        return 86400
    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        raise ValueError("Giá trị HH:MM không hợp lệ")
    return hour * 3600 + minute * 60


class SlaShift(BaseModel):
    start: str = Field(..., min_length=5, max_length=5, description="Giờ bắt đầu ca (HH:MM)")
    end: str = Field(..., min_length=5, max_length=5, description="Giờ kết thúc ca (HH:MM)")

    @field_validator("start", "end")
    @classmethod
    def _validate_hhmm(cls, v: str) -> str:
        clean = v.strip()
        _parse_hhmm(clean)
        return clean

    @model_validator(mode="after")
    def _validate_order(self) -> "SlaShift":
        if _parse_hhmm(self.end) <= _parse_hhmm(self.start):
            raise ValueError("Giờ kết thúc ca phải lớn hơn giờ bắt đầu")
        return self


class SlaConfigPayload(BaseModel):
    scope_key: str = Field(
        default="global",
        min_length=1,
        max_length=128,
        description="'global', 'channel:<channel>', hoặc 'account:<channel>:<id>'",
    )
    target_minutes: int = Field(default=5, ge=1, le=1440)
    warning_pct: int = Field(default=70, ge=10, le=99)
    business_hours_enabled: bool = Field(default=True)
    timezone: str = Field(default="Asia/Ho_Chi_Minh", min_length=1, max_length=64)
    work_days: List[int] = Field(default_factory=lambda: [1, 2, 3, 4, 5, 6])
    shifts: List[SlaShift] = Field(
        default_factory=lambda: [
            SlaShift(start="08:00", end="12:00"),
            SlaShift(start="13:30", end="17:30"),
        ]
    )
    include_group_chats: bool = Field(default=False)
    exclude_bot_replies: bool = Field(default=True)

    @field_validator("scope_key")
    @classmethod
    def _validate_scope_key(cls, v: str) -> str:
        clean = v.strip()
        if clean == "global":
            return clean
        if clean.startswith("channel:"):
            ch = clean.split(":", 1)[1].strip().lower()
            if ch not in SUPPORTED_SLA_CHANNELS:
                raise ValueError(f"Kênh không hợp lệ trong scope_key: {ch}")
            return f"channel:{ch}"
        if clean.startswith("account:"):
            parts = clean.split(":", 2)
            if len(parts) != 3 or parts[1].strip().lower() not in SUPPORTED_SLA_CHANNELS or not parts[2].strip():
                raise ValueError("scope_key dạng account phải là 'account:<channel>:<account_id>'")
            return f"account:{parts[1].strip().lower()}:{parts[2].strip()}"
        raise ValueError("scope_key phải là 'global', 'channel:<ch>' hoặc 'account:<ch>:<id>'")

    @field_validator("work_days")
    @classmethod
    def _validate_work_days(cls, v: List[int]) -> List[int]:
        deduped = sorted({int(d) for d in v if 1 <= int(d) <= 7})
        if not deduped:
            raise ValueError("work_days phải có ít nhất 1 ngày (ISO 1=Thứ 2 .. 7=Chủ nhật)")
        return deduped

    @field_validator("shifts")
    @classmethod
    def _validate_shifts(cls, v: List[SlaShift]) -> List[SlaShift]:
        if not v:
            raise ValueError("shifts phải có ít nhất 1 ca làm việc")
        return v


class SlaTurnDismissPayload(BaseModel):
    reason: Optional[str] = Field(default=None, max_length=500)


class SlaBackfillPayload(BaseModel):
    days: int = Field(default=7, ge=1, le=90)
    channels: Optional[List[str]] = Field(
        default=None,
        description="Danh sách kênh cần backfill (mặc định cả 4 kênh: zalo, messenger, telegram, whatsapp)",
    )

    @field_validator("channels")
    @classmethod
    def _validate_channels(cls, v: Optional[List[str]]) -> Optional[List[str]]:
        if v is None:
            return None
        cleaned: List[str] = []
        for item in v:
            ch = str(item or "").strip().lower()
            if ch in BACKFILL_CHANNELS and ch not in cleaned:
                cleaned.append(ch)
        return cleaned or list(BACKFILL_CHANNELS)


class AlertForwardConfigCreate(BaseModel):
    name: str = Field(default="Thông báo tin mới & SLA chung", min_length=1, max_length=200)
    is_enabled: bool = Field(default=True)
    dry_run: bool = Field(default=False)
    notifier_zalo_account_id: str = Field(..., min_length=1, max_length=128)
    notifier_zalo_account_name: Optional[str] = Field(default=None, max_length=200)
    target_zalo_group_id: str = Field(..., min_length=1, max_length=128)
    target_zalo_group_name: Optional[str] = Field(default=None, max_length=200)
    channels: List[str] = Field(default_factory=lambda: ["zalo"])
    source_account_ids: List[str] = Field(default_factory=list)
    include_group_chats: bool = Field(default=False)
    excluded_conversation_ids: List[str] = Field(default_factory=list)
    alert_mode: Literal["new_turn_only", "every_batch"] = Field(default="new_turn_only")
    debounce_seconds: int = Field(default=8, ge=0, le=60)
    cooldown_minutes: int = Field(default=15, ge=0, le=1440)
    notify_new_message: bool = Field(default=True)
    notify_sla_warning: bool = Field(default=False)
    notify_sla_breach: bool = Field(default=True)
    forward_images: bool = Field(default=False)
    mention_all_on_breach: bool = Field(default=False)
    mention_zalo_uids: List[Any] = Field(default_factory=list)
    new_message_template: Optional[str] = Field(default=None, max_length=4000)
    sla_breach_template: Optional[str] = Field(default=None, max_length=4000)

    @field_validator("channels")
    @classmethod
    def _validate_channels(cls, v: List[str]) -> List[str]:
        cleaned: List[str] = []
        for item in v:
            ch = str(item or "").strip().lower()
            if ch in SUPPORTED_SLA_CHANNELS and ch not in cleaned:
                cleaned.append(ch)
        if not cleaned:
            raise ValueError("Phải chọn ít nhất 1 kênh nguồn hợp lệ")
        return cleaned

    @field_validator("notifier_zalo_account_id", "target_zalo_group_id")
    @classmethod
    def _strip_required_ids(cls, v: str) -> str:
        clean = v.strip()
        if not clean:
            raise ValueError("Trường ID không được để trống")
        return clean


class AlertForwardConfigUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    is_enabled: Optional[bool] = None
    dry_run: Optional[bool] = None
    notifier_zalo_account_id: Optional[str] = Field(default=None, min_length=1, max_length=128)
    notifier_zalo_account_name: Optional[str] = Field(default=None, max_length=200)
    target_zalo_group_id: Optional[str] = Field(default=None, min_length=1, max_length=128)
    target_zalo_group_name: Optional[str] = Field(default=None, max_length=200)
    channels: Optional[List[str]] = None
    source_account_ids: Optional[List[str]] = None
    include_group_chats: Optional[bool] = None
    excluded_conversation_ids: Optional[List[str]] = None
    alert_mode: Optional[Literal["new_turn_only", "every_batch"]] = None
    debounce_seconds: Optional[int] = Field(default=None, ge=0, le=60)
    cooldown_minutes: Optional[int] = Field(default=None, ge=0, le=1440)
    notify_new_message: Optional[bool] = None
    notify_sla_warning: Optional[bool] = None
    notify_sla_breach: Optional[bool] = None
    forward_images: Optional[bool] = None
    mention_all_on_breach: Optional[bool] = None
    mention_zalo_uids: Optional[List[Any]] = None
    new_message_template: Optional[str] = Field(default=None, max_length=4000)
    sla_breach_template: Optional[str] = Field(default=None, max_length=4000)

    @field_validator("channels")
    @classmethod
    def _validate_channels(cls, v: Optional[List[str]]) -> Optional[List[str]]:
        if v is None:
            return None
        cleaned: List[str] = []
        for item in v:
            ch = str(item or "").strip().lower()
            if ch in SUPPORTED_SLA_CHANNELS and ch not in cleaned:
                cleaned.append(ch)
        if not cleaned:
            raise ValueError("Phải chọn ít nhất 1 kênh nguồn hợp lệ")
        return cleaned
