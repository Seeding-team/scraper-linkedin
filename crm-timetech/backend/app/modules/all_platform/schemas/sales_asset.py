"""Schemas for the shared Proposal / Portfolio / Sale Kit library."""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

SalesAssetType = Literal[
    "proposal",
    "sale_kit",
    "portfolio",
    "other",
]
SalesAssetStatus = Literal["active", "inactive", "archived"]
SalesAssetSendMode = Literal["link", "file"]
SalesAssetSourceType = Literal["canva", "google_docs", "google_drive", "external"]


def _validate_http_url(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    stripped = value.strip()
    if not stripped:
        return ""
    if not (stripped.startswith("http://") or stripped.startswith("https://")):
        raise ValueError("URL phai bat dau bang http:// hoac https://")
    return stripped


class SalesAssetCreateRequest(BaseModel):
    customer_lead_id: Optional[str] = None
    deal_id: Optional[str] = None
    project_name: Optional[str] = None
    type: SalesAssetType
    title: str
    version: str = "v1"
    source_type: SalesAssetSourceType = "external"
    source_url: str
    description: Optional[str] = None
    tags: list[str] = Field(default_factory=list)
    industry: Optional[str] = None
    service_package: Optional[str] = None
    file_url: Optional[str] = None
    public_url: Optional[str] = None
    thumbnail_url: Optional[str] = None
    status: SalesAssetStatus = "active"

    @field_validator("source_url")
    @classmethod
    def validate_source_url(cls, value: str) -> str:
        validated = _validate_http_url(value)
        if not validated:
            raise ValueError("source_url la bat buoc")
        return validated

    @field_validator("public_url", "file_url", "thumbnail_url")
    @classmethod
    def validate_optional_urls(cls, value: Optional[str]) -> Optional[str]:
        return _validate_http_url(value)


class SalesAssetUpdateRequest(BaseModel):
    customer_lead_id: Optional[str] = None
    deal_id: Optional[str] = None
    project_name: Optional[str] = None
    type: Optional[SalesAssetType] = None
    title: Optional[str] = None
    version: Optional[str] = None
    source_type: Optional[SalesAssetSourceType] = None
    source_url: Optional[str] = None
    description: Optional[str] = None
    tags: Optional[list[str]] = None
    industry: Optional[str] = None
    service_package: Optional[str] = None
    file_url: Optional[str] = None
    public_url: Optional[str] = None
    thumbnail_url: Optional[str] = None
    status: Optional[SalesAssetStatus] = None

    @field_validator("source_url", "public_url", "file_url", "thumbnail_url")
    @classmethod
    def validate_optional_urls(cls, value: Optional[str]) -> Optional[str]:
        return _validate_http_url(value)


class SalesAssetSendRequest(BaseModel):
    platform: Optional[str] = None
    conversation_id: Optional[str] = None
    deal_id: Optional[str] = None
    send_mode: SalesAssetSendMode = "link"
    note: Optional[str] = None
