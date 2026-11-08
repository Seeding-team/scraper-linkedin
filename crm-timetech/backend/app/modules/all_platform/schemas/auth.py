"""Auth request/response schemas for all-platform module."""

from __future__ import annotations

from pydantic import BaseModel, EmailStr, Field


class RegisterRequest(BaseModel):
    email: str = Field(..., min_length=5, max_length=255)
    password: str = Field(..., min_length=6, max_length=128)
    name: str | None = Field(None, max_length=255)


class LoginRequest(BaseModel):
    email: str = Field(..., min_length=5, max_length=255)
    password: str = Field(..., max_length=128)


class GoogleLoginRequest(BaseModel):
    credential: str = Field(..., min_length=10, description="Google ID token (JWT) from Google Identity Services")


class RefreshTokenRequest(BaseModel):
    token: str


class CheckEmailRequest(BaseModel):
    email: str


class ResetPasswordRequest(BaseModel):
    email: str
    new_password: str = Field(..., min_length=6, max_length=128)


class UpdateProfileRequest(BaseModel):
    name: str | None = Field(None, max_length=255)


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(..., min_length=6, max_length=128)
    new_password: str = Field(..., min_length=6, max_length=128)


class DeactivateAccountRequest(BaseModel):
    password: str = Field(..., min_length=6, max_length=128)


class PromoteToLeaderRequest(BaseModel):
    leader_code: str = Field(..., min_length=1, max_length=64)


class SocialAccountCreateRequest(BaseModel):
    platform: str = Field(..., description="facebook | linkedin | youtube")
    account_name: str = Field(..., min_length=1, max_length=255)
    account_email: str | None = Field(None, max_length=255)
    account_password: str | None = Field(None, max_length=255)
    account_profile_id: str | None = Field(None, max_length=255, description="Profile ID on the social platform")
    id_platform: int | None = Field(None, description="FK to platforms table (optional)")
    is_primary: bool = False
    notes: str | None = Field(None, max_length=1000)
    is_banned: bool = False
    ban_reason: str | None = Field(None, max_length=1000)


class SocialAccountUpdateRequest(BaseModel):
    id: str
    account_name: str | None = Field(None, min_length=1, max_length=255)
    account_email: str | None = Field(None, max_length=255)
    account_password: str | None = Field(None, max_length=255)
    account_profile_id: str | None = Field(None, max_length=255)
    id_platform: int | None = Field(None)
    is_active: bool | None = None
    is_primary: bool | None = None
    notes: str | None = Field(None, max_length=1000)
    is_banned: bool | None = None
    ban_reason: str | None = Field(None, max_length=1000)