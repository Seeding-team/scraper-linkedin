from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # BẮT BUỘC lấy từ https://my.telegram.org/apps (đăng nhập bằng 1 số điện thoại bất kỳ,
    # tạo 1 "App" — mỗi tổ chức chỉ cần tạo 1 lần, dùng chung cho MỌI tài khoản Telegram
    # kết nối vào tool, không phải mỗi tài khoản 1 cặp riêng). Không có 2 giá trị này thì
    # KHÔNG thể mở bất kỳ kết nối Telegram nào (kể cả bot token) — Telethon dùng chúng để
    # định danh "ứng dụng" gọi MTProto API, tách biệt với bot_token (định danh account bot).
    telegram_api_id: int = Field(default=0, validation_alias=AliasChoices("TELEGRAM_API_ID"))
    telegram_api_hash: str = Field(default="", validation_alias=AliasChoices("TELEGRAM_API_HASH"))

    supabase_storage_bucket: str = Field(
        default="telegram-media",
        validation_alias=AliasChoices("TELEGRAM_SUPABASE_STORAGE_BUCKET"),
    )

    # Client "pending" (đang giữa luồng đăng nhập OTP, chưa xong) bị dọn sau bao lâu nếu
    # người dùng bỏ dở (đóng tab, không nhập mã) — tránh rò rỉ kết nối MTProto treo mãi.
    pending_login_ttl_seconds: int = Field(
        default=600,
        validation_alias=AliasChoices("TELEGRAM_PENDING_LOGIN_TTL_SECONDS"),
    )

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()


def is_configured() -> bool:
    return bool(settings.telegram_api_id and settings.telegram_api_hash.strip())
