"""Application settings and environment loading (bản rút gọn cho module CRM
độc lập — chỉ giữ lại các biến mà router/service CRM thực sự dùng tới).
"""

from __future__ import annotations

import contextvars
import json
import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv


BASE_DIR = Path(__file__).resolve().parent.parent.parent
load_dotenv(BASE_DIR / ".env")
# .env.local ghi đè .env — dùng cho dev local, không commit (giống app seeding gốc).
load_dotenv(BASE_DIR / ".env.local", override=True)


def _parse_csv(value: str | None, default: tuple[str, ...]) -> list[str]:
    if value is None:
        return list(default)
    items = [item.strip() for item in value.split(",")]
    return [item for item in items if item]


def _parse_workspace_domains(value: str | None) -> dict[str, str]:
    """`WORKSPACE_DOMAINS` — JSON object instance -> base URL public (co scheme,
    KHONG lowercase key vi instance code phan biet hoa/thuong, vd
    "SECURITYZONE" khac "securityzone")."""
    if not value:
        return {}
    try:
        data = json.loads(value)
    except ValueError:
        return {}
    if not isinstance(data, dict):
        return {}
    return {
        str(instance).strip(): str(url).strip().rstrip("/")
        for instance, url in data.items()
        if str(instance).strip() and str(url).strip()
    }


def _parse_instance_domain_map(value: str | None) -> dict[str, str]:
    """`INSTANCE_DOMAIN_MAP` — JSON object domain (khong port) -> instance,
    vd `{"crm.markee.vn":"markee","crm.markeeai.com":"markee"}`. 1 process
    duy nhất giờ phục vụ nhiều domain (nhiều brand), tra bang nay theo Host
    header cua tung request de biet dang phuc vu instance nao — xem
    `_current_instance` + middleware trong `app/main.py`."""
    if not value:
        return {}
    try:
        data = json.loads(value)
    except ValueError:
        return {}
    if not isinstance(data, dict):
        return {}
    return {
        str(domain).strip().lower(): str(instance).strip()
        for domain, instance in data.items()
        if str(domain).strip() and str(instance).strip()
    }


# Instance dang phuc vu request HIEN TAI (set boi middleware theo Host header
# — xem app/main.py). Contextvar (khong phai bien global thuong) de an toan
# giua cac request chay dong thoi trong cung 1 process (mỗi request co
# context rieng, khong bi request khac ghi de).
_current_instance: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "crm_current_instance", default=None
)


def set_current_instance(value: str) -> contextvars.Token:
    return _current_instance.set(value)


def reset_current_instance(token: contextvars.Token) -> None:
    _current_instance.reset(token)


@dataclass
class Settings:
    """Typed settings loaded from environment variables."""

    host: str = os.getenv("HOST", "0.0.0.0")
    port: int = int(os.getenv("PORT", "8000"))
    cors_origins: list[str] | None = None

    # Multi-tenant: DB self-host này dùng chung cho nhiều brand (Markee,
    # CloudGate, SecurityZone...), 1 process backend DUY NHẤT phục vụ cả 3
    # domain — instance thật sự phục vụ được xác định THEO TỪNG REQUEST dựa
    # vào Host header (xem `crm_instance` property bên dưới + middleware ở
    # app/main.py), không còn cố định theo process như trước. `CRM_INSTANCE`
    # (env) giờ chỉ còn là giá trị FALLBACK khi domain gọi vào không khớp
    # `instance_domain_map` nào (vd gọi thẳng bằng IP, health-check nội bộ).
    default_crm_instance: str = (os.getenv("CRM_INSTANCE") or "markee").strip()

    # domain (khong port, chu thuong) -> instance. Xem _parse_instance_domain_map.
    instance_domain_map: dict[str, str] = field(
        default_factory=lambda: _parse_instance_domain_map(os.getenv("INSTANCE_DOMAIN_MAP"))
    )

    # instance -> base URL CANONICAL cong khai cua brand do (co scheme, KHONG
    # duong dan cuoi), dung de admin switcher redirect sang. VD:
    # {"markee":"https://crm.markee.vn","cloudgate":"https://crm.getcloudgate.com"}.
    # Khac INSTANCE_DOMAIN_MAP (domain->instance, dung de RESOLVE request vao) —
    # cai nay la chieu NGUOC LAI (instance->domain, dung de REDIRECT ra).
    workspace_domains: dict[str, str] = field(
        default_factory=lambda: _parse_workspace_domains(os.getenv("WORKSPACE_DOMAINS"))
    )

    # One-way customer master sync: Markee CFO -> CRM. Only the Markee CRM
    # instance enables this; other CRM instances remain fully isolated.
    cfo_supabase_url: str = (os.getenv("CFO_SUPABASE_URL") or "").rstrip("/")
    cfo_supabase_service_role_key: str = os.getenv("CFO_SUPABASE_SERVICE_ROLE_KEY", "")
    cfo_workspace_id: str = (os.getenv("CFO_WORKSPACE_ID") or "default").strip()
    cfo_customer_sync_enabled: bool = (os.getenv("CFO_CUSTOMER_SYNC_ENABLED") or "0").strip().lower() in {
        "1", "true", "yes", "on",
    }
    cfo_customer_sync_interval_seconds: int = max(
        10,
        int(os.getenv("CFO_CUSTOMER_SYNC_INTERVAL_SECONDS", "30")),
    )

    jwt_secret_key: str = os.getenv("JWT_SECRET_KEY", "crawlpro-default-secret-change-me")
    jwt_algorithm: str = os.getenv("JWT_ALGORITHM", "HS256")
    jwt_access_token_expire_minutes: int = int(
        os.getenv("JWT_ACCESS_TOKEN_EXPIRE_MINUTES", "10080"),
    )
    google_oauth_client_id: str = os.getenv("GOOGLE_CLIENT_ID", "")
    leader_code: str = (os.getenv("LEADER_CODE") or "8888").strip()

    # AI Contract Copilot (soạn/thẩm định/tinh chỉnh hợp đồng bằng AI).
    openai_api_key: str = os.getenv("OPENAI_API_KEY", "")
    openai_base_url: str = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/")
    ai_model: str = os.getenv("AI_MODEL", "gpt-4o")

    # Không dùng tới trong module CRM (không mount router KPI/MarkeeAI nào),
    # nhưng vài service dùng chung (supabase_kpi_service.py, markeeai_client.py)
    # vẫn còn nằm trong cây service đã copy nên field vẫn cần tồn tại để
    # tránh AttributeError nếu lỡ có code đường dẫn nào đó chạm tới — để trống,
    # KHÔNG hard-code secret thật vào đây.
    markeeai_base_url: str = os.getenv("MARKEEAI_BASE_URL", "")
    markeeai_service_email: str = os.getenv("MARKEEAI_SERVICE_EMAIL", "")
    markeeai_service_password: str = os.getenv("MARKEEAI_SERVICE_PASSWORD", "")
    markeeai_campaign_ids: list[str] = field(default_factory=lambda: _parse_csv(os.getenv("MARKEEAI_CAMPAIGN_IDS"), default=()))
    seeder_service_url: str = os.getenv("SEEDER_SERVICE_URL", "")
    seeder_service_api_key: str = os.getenv("SEEDER_SERVICE_API_KEY", "")

    def __post_init__(self) -> None:
        if self.cors_origins is None:
            self.cors_origins = _parse_csv(
                os.getenv("CORS_ORIGINS"),
                default=(
                    "http://localhost:3000",
                    "http://127.0.0.1:3000",
                ),
            )

    @property
    def crm_instance(self) -> str:
        """Instance CRM đang phục vụ REQUEST HIỆN TẠI. Đọc contextvar do
        middleware set theo Host header (app/main.py) — KHÔNG phải giá trị cố
        định lúc khởi động nữa. Mọi service vẫn gọi `settings.crm_instance`
        y hệt trước, không cần sửa call site nào ngoài chỗ này."""
        return _current_instance.get() or self.default_crm_instance


settings = Settings()
