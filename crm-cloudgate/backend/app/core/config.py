"""Application settings and environment loading (bản rút gọn cho module CRM
độc lập — chỉ giữ lại các biến mà router/service CRM thực sự dùng tới).
"""

from __future__ import annotations

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
    """`WORKSPACE_DOMAINS` — JSON object instance -> base URL public (có scheme,
    KHÔNG lowercase key vì instance code phân biệt hoa/thường, vd
    "SECURITYZONE" khác "securityzone"). Dùng cho admin switcher + redirect
    non-admin nhập nhầm site — xem workspace_handoff_service.py. Giống hệt
    biến cùng tên trong crm-module (3 deploy TÁCH RIÊNG, không cần
    INSTANCE_DOMAIN_MAP/contextvar vì mỗi deploy đã có CRM_INSTANCE cố định
    riêng qua NPM/domain thật)."""
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


@dataclass
class Settings:
    """Typed settings loaded from environment variables."""

    host: str = os.getenv("HOST", "0.0.0.0")
    port: int = int(os.getenv("PORT", "8000"))
    cors_origins: list[str] | None = None

    # Multi-tenant: DB self-host này dùng chung cho nhiều deploy của
    # crm-module (Markee tại crm.markeeai.com, brand khác sau này) — mỗi
    # deploy chỉ set instance của riêng mình qua env CRM_INSTANCE, mọi
    # query CRM đều lọc/gắn theo giá trị này (xem migrations/001_add_instance_scoping.sql).
    crm_instance: str = (os.getenv("CRM_INSTANCE") or "markee").strip()

    # instance -> base URL CANONICAL công khai của brand đó (có scheme, KHÔNG
    # đường dẫn cuối), dùng để admin switcher / redirect non-admin nhập nhầm
    # site biết chuyển sang đâu. Giá trị PHẢI GIỐNG HỆT nhau trên cả 3 deploy
    # (crm-module/crm-cloudgate/crm-securityzone) vì đều dùng chung 1 DB —
    # xem migrations/004_workspace_handoff_codes.sql.
    workspace_domains: dict[str, str] = field(
        default_factory=lambda: _parse_workspace_domains(os.getenv("WORKSPACE_DOMAINS"))
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


settings = Settings()
