"""Router tổng cho module CRM độc lập — chỉ mount đúng các sub-router thuộc
khu vực "Quản lý CRM" + phần phụ thuộc bắt buộc (auth, users/teams, members,
categories) để dropdown/gán việc hoạt động. KHÔNG import router.py gốc của
app seeding (bản đó import ~40 router gồm cả facebook/linkedin/zalo/kpi/
extension/websocket/admin/phone-bridge — sẽ kéo theo toàn bộ Playwright/
gspread/asyncssh không cần thiết cho 1 service chỉ-CRM).

Giữ nguyên prefix/tag y hệt app gốc để frontend không cần đổi 1 dòng path nào.
"""

from __future__ import annotations

from fastapi import APIRouter

from app.modules.all_platform.routers.auth import router as auth_router
from app.modules.all_platform.routers.categories import router as categories_router
from app.modules.all_platform.routers.members import router as members_router
from app.modules.all_platform.routers.users import router as users_router, teams_router
from app.modules.all_platform.routers.customer_lead import router as customer_lead_router
from app.modules.all_platform.routers.crm_customer import router as crm_customer_router
from app.modules.all_platform.routers.crm_lead import router as crm_lead_router
from app.modules.all_platform.routers.crm_contact import router as crm_contact_router
from app.modules.all_platform.routers.quote import (
    quote_forms_router,
    quotes_router,
    quote_email_provider_router,
    quote_approval_rules_router,
)
from app.modules.all_platform.routers.price_book import price_book_router, price_book_admin_router
from app.modules.all_platform.routers.project import router as project_router
from app.modules.all_platform.routers.contract import contracts_router
from app.modules.all_platform.routers.contract_template import contract_templates_router
from app.modules.all_platform.routers.service_catalog import router as service_catalog_router
from app.modules.all_platform.routers.sales_asset import router as sales_asset_router

all_platform_router = APIRouter()

# ── Categories (dropdown danh mục dùng chung, kể cả "Danh mục CRM") ───────────
all_platform_router.include_router(categories_router, prefix="/categories", tags=["All-Platform Categories"])

# ── Members (nguồn dữ liệu dropdown gán việc/SDR) ─────────────────────────────
all_platform_router.include_router(members_router, prefix="/members", tags=["All-Platform Members"])

# ── Users & Teams ──────────────────────────────────────────────────────────────
all_platform_router.include_router(users_router, prefix="/users", tags=["All-Platform Users"])
all_platform_router.include_router(teams_router, prefix="/teams", tags=["All-Platform Teams"])

# ── Auth ───────────────────────────────────────────────────────────────────────
all_platform_router.include_router(auth_router, prefix="/auth", tags=["All-Platform Auth"])

# ── Customer Leads (Deal / pipeline "Cơ hội") ─────────────────────────────────
all_platform_router.include_router(customer_lead_router, tags=["Customer Leads"])
all_platform_router.include_router(crm_customer_router, prefix="/crm/customers", tags=["All-Platform CRM Customers"])
all_platform_router.include_router(crm_lead_router, prefix="/crm/leads", tags=["All-Platform CRM Leads"])
all_platform_router.include_router(
    crm_contact_router,
    prefix="/crm/customers/{customer_id}/contacts",
    tags=["All-Platform CRM Contacts"],
)

# ── Quote Forms + Quotes ───────────────────────────────────────────────────────
all_platform_router.include_router(quote_forms_router, prefix="/quote-forms", tags=["All-Platform Quote Forms"])
all_platform_router.include_router(quotes_router, prefix="/quotes", tags=["All-Platform Quotes"])
all_platform_router.include_router(
    quote_email_provider_router,
    prefix="/quotes-email-provider",
    tags=["All-Platform Quotes Email Provider"],
)
all_platform_router.include_router(
    quote_approval_rules_router,
    prefix="/quote-approval-rules",
    tags=["All-Platform Quote Approval Rules"],
)
all_platform_router.include_router(
    price_book_router,
    prefix="/price-book-items",
    tags=["All-Platform Price Book (VPS Zone)"],
)
all_platform_router.include_router(
    price_book_admin_router,
    prefix="/price-book-admin",
    tags=["All-Platform Price Book Admin (VPS Zone)"],
)

# ── Dự án (Projects) ────────────────────────────────────────────────────────────
all_platform_router.include_router(project_router, prefix="/projects", tags=["All-Platform Projects"])

# ── Contracts (AI Contract Copilot) ────────────────────────────────────────────
all_platform_router.include_router(contracts_router, prefix="/contracts", tags=["All-Platform Contracts"])
all_platform_router.include_router(
    contract_templates_router,
    prefix="/contract-templates",
    tags=["All-Platform Contract Templates"],
)

# ── Danh mục dịch vụ (Service Catalog) ─────────────────────────────────────────
all_platform_router.include_router(service_catalog_router, prefix="/service-catalog", tags=["All-Platform Service Catalog"])

# ── Tài liệu bán hàng (Sales Assets) ───────────────────────────────────────────
all_platform_router.include_router(sales_asset_router, prefix="/sales-assets", tags=["All-Platform Sales Assets"])
