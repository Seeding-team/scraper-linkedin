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

    # Dong bo ung vien "accepted" tu he thong tuyen dung (cv.markeeai.com) vao
    # danh ba noi bo `members` (nut "Dong bo tu tuyen dung" o tab Quan ly thanh
    # vien) - dung CHUNG 1 project Supabase voi pm-new (PM tool noi bo), hardcode
    # default de moi deploy/instance chay duoc ngay, .env van override duoc.
    recruitment_supabase_url: str = os.getenv(
        "RECRUITMENT_SUPABASE_URL", "https://cv.db.markeeai.com",
    ).rstrip("/")
    recruitment_supabase_service_role_key: str = os.getenv(
        "RECRUITMENT_SUPABASE_SERVICE_ROLE_KEY",
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoic3VwYWJhc2UiLCJpYXQiOjE3ODc3Njc3ODIsImV4cCI6MjEwMzEyNzc4Mn0.sTHQs9H3tzdnk3y9oLhWZx_4CBWwYXd3RAPiZiG44wg",
    )

    jwt_secret_key: str = os.getenv("JWT_SECRET_KEY", "crawlpro-default-secret-change-me")
    jwt_algorithm: str = os.getenv("JWT_ALGORITHM", "HS256")
    jwt_access_token_expire_minutes: int = int(
        os.getenv("JWT_ACCESS_TOKEN_EXPIRE_MINUTES", "10080"),
    )
    google_oauth_client_id: str = os.getenv("GOOGLE_CLIENT_ID", "")
    # (2026-10-27) Authorization-code flow rieng cho "nhap Google Docs/Drive rieng tu bang
    # quyen nguoi dung" - KHAC voi GOOGLE_CLIENT_ID dung cho nut "Dang nhap Google" (ID-token/
    # GSI, khong can secret). HIEN DA TAT (khong mount router google_oauth, xem router.py) theo
    # yeu cau sep sau khi gap loi InsecureTransportError luc test dev - giu nguyen field de bat
    # lai de dang neu can sau (chi can them redirect URI + lay Client secret tren Google Cloud
    # Console cho CHINH Client o tren, KHONG bat buoc tao Client moi).
    google_oauth_client_secret: str = os.getenv("GOOGLE_CLIENT_SECRET", "")
    # URL cong khai (qua router nginx) de dung lam redirect_uri OAuth - PHAI khop CHINH XAC
    # voi 1 Authorized redirect URI da dang ky tren Google Cloud Console cho OAuth Client o
    # tren. Mac dinh khop voi CRM_ROUTER_PORT trong docker-compose.yml (18090) o dev.
    crm_public_url: str = os.getenv("CRM_PUBLIC_URL", "http://localhost:18090").rstrip("/")

    # Google Drive - luu file hop dong (2026-10-26, yeu cau sep). Service account
    # rieng (markee-recruitment-bot) da duoc them lam Content Manager cua 1
    # Shared Drive co san - KHONG dung My Drive ca nhan (service account khong co
    # dung luong rieng tren My Drive thuong). Private key KHONG duoc in ra log/
    # response o bat ky dau dung field nay.
    google_service_account_email: str = os.getenv("GOOGLE_SERVICE_ACCOUNT_EMAIL", "")
    google_private_key: str = os.getenv("GOOGLE_PRIVATE_KEY", "").replace("\\n", "\n")
    google_drive_contracts_shared_drive_id: str = os.getenv("GOOGLE_DRIVE_CONTRACTS_SHARED_DRIVE_ID", "")
    leader_code: str = (os.getenv("LEADER_CODE") or "8888").strip()

    # BUG THAT DA GAP: thieu field nay (co san o main - linkedin_group_crawler)
    # khien verify_zalo_api_key() (zalo/api/security.py) bi AttributeError
    # 'Settings' object has no attribute 'api_key' tren MOI route Zalo (vd
    # "Thêm tài khoản Zalo mới" bao API 500). Rong = tat kiem tra (giong
    # hanh vi main khi khong cau hinh API_KEY).
    api_key: str = os.getenv("API_KEY", "")
    web_intake_api_key: str = os.getenv("WEB_INTAKE_API_KEY", "")
    web_intake_user_id: str = os.getenv("WEB_INTAKE_USER_ID", "")

    # AI Contract Copilot (soạn/thẩm định/tinh chỉnh hợp đồng bằng AI).
    openai_api_key: str = os.getenv("OPENAI_API_KEY", "")
    openai_base_url: str = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/")
    ai_model: str = os.getenv("AI_MODEL", "gpt-4o")
    gemini_api_key: str = os.getenv("GEMINI_API_KEY", "")

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

    # ── MSC → CRM Product Sync (migration 175) ──────────────────────────────
    # Base URL he thong MSC (source of truth, chi GET /api/v1/goods boil dau /).
    # De trong = tat tinh nang dong bo (job se khong chay, endpoint bao loi).
    msc_api_base_url: str = os.getenv("MSC_API_BASE_URL", "").rstrip("/")
    # Token neu MSC tuong lai bang auth (hien tai /goods khong can). Khong hardcode.
    msc_api_token: str = os.getenv("MSC_API_TOKEN", "")
    # Gio (0-23) va phut chay dong bo tu dong 1 lan/ngay (timezone CO DINH UTC+7
    # trong jobs/msc_sync_job.py — container co the khong co tzdata).
    msc_sync_hour: int = max(0, min(23, int(os.getenv("MSC_SYNC_HOUR", "2"))))
    msc_sync_minute: int = max(0, min(59, int(os.getenv("MSC_SYNC_MINUTE", "30"))))
    # 1 = chi tinh toan dem insert/update, KHONG ghi CRM (kiem tra mapping an toan).
    msc_sync_dry_run: bool = os.getenv("MSC_SYNC_DRY_RUN", "").strip().lower() in ("1", "true", "yes")
    # Timeout cho GET /api/v1/goods (giay).
    msc_sync_timeout_sec: float = float(os.getenv("MSC_SYNC_TIMEOUT_SEC", "60"))

    # ── Service Catalog Workspace isolation (isolation task 2026-10-14) ─────
    # 1 = bat/enforce "workspace floor" cho Service Catalog: deploy doc/ghi
    # CHI trong workspace cua chinh no (settings.crm_instance), khong cho
    # client tu chon instance khac. Flag OFF = giu nguyen 100% hanh vi cu
    # (filter theo client instances, khong co floor). Phai bat CUNG VOI
    # CRM_INSTANCE; neu CRM_INSTANCE rong/thieu khi flag ON thi process
    # FAIL SAU KHI BOOT (RuntimeError) thay vi silently expose data unscoped.
    catalog_scope_enforced: bool = (os.getenv("CATALOG_SCOPE_ENFORCED") or "").strip().lower() in ("1", "true", "yes")

    def __post_init__(self) -> None:
        if self.cors_origins is None:
            self.cors_origins = _parse_csv(
                os.getenv("CORS_ORIGINS"),
                default=(
                    "http://localhost:3000",
                    "http://127.0.0.1:3000",
                ),
            )


def _validate_catalog_scope_enforcement(cfg: "Settings") -> None:
    """Fail-fast khi bat enforcement ma thieu CRM_INSTANCE (isolation task).

    Flag ON + CRM_INSTANCE rong/thieu => RuntimeError ngay tai import config
    (kill boot) — KHONG BAO GIO silently fallback sang 'markee' hay tra
    catalog unscoped. Flag OFF => khong kiem tra gi (hanh vi cu, MAIN-
    compatible). Log 1 dong warning liet ke floor da resolve de DEP sai
    ten workspace (vd 'foo') de fail CLOSED (giao rong → cay rong) nhin
    thay doi trong log thay vi im lang."""

    if not cfg.catalog_scope_enforced:
        return
    import logging

    instance = (os.getenv("CRM_INSTANCE") or "").strip()
    if not instance:
        raise RuntimeError(
            "CRM_INSTANCE must be set when CATALOG_SCOPE_ENFORCED is enabled "
            "(service catalog isolation: empty workspace floor is not allowed)"
        )
    logging.getLogger(__name__).warning(
        "Service Catalog scope enforcement ON — workspace floor: %s", instance
    )


settings = Settings()
_validate_catalog_scope_enforcement(settings)
