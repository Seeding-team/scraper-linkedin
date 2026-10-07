from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Viber chỉ gọi webhook qua HTTPS công khai (không nhận localhost/http). Webhook của
    # mỗi bot = ``{base}/api/all-platform/viber/webhook/{account_id}``. Để trống thì dùng
    # PUBLIC_APP_BASE_URL (domain app, nginx đã proxy /api -> backend). Chạy local muốn
    # test thật thì trỏ biến này vào 1 tunnel HTTPS (ngrok/cloudflared) tới backend.
    viber_webhook_base_url: str = Field(
        default="",
        validation_alias=AliasChoices("VIBER_WEBHOOK_BASE_URL", "PUBLIC_APP_BASE_URL"),
    )

    viber_api_base: str = Field(
        default="https://chatapi.viber.com/pa",
        validation_alias=AliasChoices("VIBER_API_BASE"),
    )

    supabase_storage_bucket: str = Field(
        default="viber-media",
        validation_alias=AliasChoices("VIBER_SUPABASE_STORAGE_BUCKET"),
    )

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()


def webhook_url_for(account_id: str) -> str:
    base = (settings.viber_webhook_base_url or "").strip().rstrip("/")
    return f"{base}/api/all-platform/viber/webhook/{account_id}" if base else ""
