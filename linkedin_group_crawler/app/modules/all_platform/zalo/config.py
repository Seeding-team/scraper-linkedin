from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    cors_origins: str = Field(
        default="http://localhost:3000",
        validation_alias=AliasChoices("ZALO_CORS_ORIGINS", "CORS_ORIGINS"),
    )
    session_ttl_hours: int = Field(
        default=8,
        validation_alias=AliasChoices("ZALO_SESSION_TTL_HOURS", "SESSION_TTL_HOURS"),
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
        default="zalo-assets",
        validation_alias=AliasChoices("SUPABASE_STORAGE_BUCKET", "ZALO_SUPABASE_STORAGE_BUCKET"),
    )
    save_to_supabase: bool = Field(
        default=True,
        validation_alias=AliasChoices("ZALO_SAVE_TO_SUPABASE", "SAVE_TO_SUPABASE"),
    )
    supabase_ssl_verify: bool = Field(
        default=True,
        validation_alias=AliasChoices("ZALO_SUPABASE_SSL_VERIFY", "SUPABASE_SSL_VERIFY"),
    )
    broadcast_delay_seconds: float = Field(
        default=3.0,
        validation_alias=AliasChoices("ZALO_BROADCAST_DELAY_SECONDS", "BROADCAST_DELAY_SECONDS"),
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
        default=False,
        validation_alias=AliasChoices("ZALO_ZCA_STARTUP_SYNC_ENABLED", "ZCA_STARTUP_SYNC_ENABLED"),
    )

    # Web Push (ZALO_CENTRALIZED_MODULE_GUIDE.md Mục 4.7/11.10) — public key PHẢI
    # được đọc runtime qua API (routes/push.py), KHÔNG được bake vào NEXT_PUBLIC_*
    # lúc build frontend. Private key/subject chỉ backend dùng để ký VAPID JWT.
    vapid_public_key: str = Field(
        default="",
        validation_alias=AliasChoices("VAPID_PUBLIC_KEY", "ZALO_VAPID_PUBLIC_KEY"),
    )
    vapid_private_key: str = Field(
        default="",
        validation_alias=AliasChoices("VAPID_PRIVATE_KEY", "ZALO_VAPID_PRIVATE_KEY"),
    )
    vapid_subject: str = Field(
        default="mailto:admin@markeeai.com",
        validation_alias=AliasChoices("VAPID_SUBJECT", "ZALO_VAPID_SUBJECT"),
    )

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
