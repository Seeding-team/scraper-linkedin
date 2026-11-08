"""Settings riêng cho module Zalo — bản rút gọn cho zalo-module, chỉ giữ biến
mà luồng hiện đại (Extension + zca-js) thực sự dùng tới. Bản gốc còn có thêm
biến cho Playwright/QR login (`ZALO_BROWSER_*`, `ZALO_QR_LOGIN_MODE`),
broadcast hàng loạt, và Google Sheet — không cần vì đã bỏ các tính năng đó
(xem docs/ZALO_CHAT_FEATURE_EXTRACTION_GUIDE.md)."""

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    cors_origins: str = Field(
        default="http://localhost:3000",
        validation_alias=AliasChoices("ZALO_CORS_ORIGINS", "CORS_ORIGINS"),
    )
    debug_artifacts_dir: str = Field(
        default="artifacts/debug",
        validation_alias=AliasChoices("ZALO_DEBUG_ARTIFACTS_DIR", "DEBUG_ARTIFACTS_DIR"),
    )
    zca_auth_store_dir: str = Field(
        default="artifacts/zca-auth",
        validation_alias=AliasChoices("ZALO_ZCA_AUTH_STORE_DIR", "ZCA_AUTH_STORE_DIR"),
    )
    supabase_url: str = Field(
        default="",
        validation_alias=AliasChoices("SUPABASE_URL", "ZALO_SUPABASE_URL"),
    )
    supabase_service_role_key: str = Field(
        default="",
        validation_alias=AliasChoices("SUPABASE_SERVICE_ROLE_KEY", "ZALO_SUPABASE_SERVICE_ROLE_KEY"),
    )
    supabase_storage_bucket: str = Field(
        # Bucket RIÊNG cho zalo-module (khác "zalo-assets" của app gốc) — object
        # storage cũng tách biệt hoàn toàn, không chỉ bảng DB. Phải tạo bucket
        # này trên Supabase Storage trước khi dùng tính năng gửi/nhận media.
        default="zalo-module-assets",
        validation_alias=AliasChoices("SUPABASE_STORAGE_BUCKET", "ZALO_SUPABASE_STORAGE_BUCKET"),
    )
    supabase_ssl_verify: bool = Field(
        default=True,
        validation_alias=AliasChoices("ZALO_SUPABASE_SSL_VERIFY", "SUPABASE_SSL_VERIFY"),
    )
    asset_retention_days: int = Field(
        default=7,
        validation_alias=AliasChoices("ZALO_ASSET_RETENTION_DAYS", "ASSET_RETENTION_DAYS"),
    )
    asset_cleanup_batch_size: int = Field(
        default=200,
        validation_alias=AliasChoices("ZALO_ASSET_CLEANUP_BATCH_SIZE", "ASSET_CLEANUP_BATCH_SIZE"),
    )
    zca_old_message_interval_ms: int = Field(
        default=0,
        validation_alias=AliasChoices("ZALO_ZCA_OLD_MESSAGE_INTERVAL_MS", "ZCA_OLD_MESSAGE_INTERVAL_MS"),
    )
    zca_startup_sync_enabled: bool = Field(
        # Để False — luồng backfill lịch sử cũ dùng endpoint Zalo đã ngừng phục
        # vụ (xem guide mục 2.3), bật lên chỉ tốn tài nguyên vô ích.
        default=False,
        validation_alias=AliasChoices("ZALO_ZCA_STARTUP_SYNC_ENABLED", "ZCA_STARTUP_SYNC_ENABLED"),
    )

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
