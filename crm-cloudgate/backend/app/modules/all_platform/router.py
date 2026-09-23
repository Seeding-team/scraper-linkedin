"""Router tổng cho module CRM độc lập — chỉ mount đúng các sub-router thuộc
khu vực "Quản lý CRM" + phần phụ thuộc bắt buộc (auth, users/teams, members,
categories) để dropdown/gán việc hoạt động. KHÔNG import router.py gốc của
app seeding (bản đó import ~40 router gồm cả facebook/linkedin/zalo/kpi/
extension/websocket/admin/phone-bridge — sẽ kéo theo toàn bộ Playwright/
gspread/asyncssh không cần thiết cho 1 service chỉ-CRM).

Giữ nguyên prefix/tag y hệt app gốc để frontend không cần đổi 1 dòng path nào.

2026-09-23: thêm `fb`/`fb_inbox_accounts` (Inbox FB) + Zalo Chat/Inbox Zalo
Admin CORE (đồng bộ từ crm-module) — CHỈ mount auth/accounts/conversations/
events/listener/inbox_share/maintenance, KHÔNG mount forward_rules/bulk_jobs/
campaigns/broadcasts (5 công cụ Zalo nâng cao, chưa cần cho module này).
`fb.py` chỉ là proxy httpx sang service Markee ngoài (MARKEE_FB_BASE_URL),
không tự crawl / không cần Playwright.
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
from app.modules.all_platform.routers.crm_contact import detail_router as crm_contact_detail_router
from app.modules.all_platform.routers.quote import quote_forms_router, quotes_router, quote_email_provider_router, quote_approval_rules_router
from app.modules.all_platform.routers.price_book import price_book_router, price_book_admin_router
from app.modules.all_platform.routers.project import router as project_router
from app.modules.all_platform.routers.contract import contracts_router
from app.modules.all_platform.routers.progress import progress_router
from app.modules.all_platform.routers.contract_template import contract_templates_router
from app.modules.all_platform.routers.service_catalog import router as service_catalog_router
from app.modules.all_platform.routers.sales_asset import router as sales_asset_router
from app.modules.all_platform.routers.vendor_imports import router as vendor_imports_router
from app.modules.all_platform.routers.vendors import router as vendors_router
from app.modules.all_platform.routers.fb import router as fb_automation_router
from app.modules.all_platform.routers.fb_inbox_accounts import router as fb_inbox_accounts_router
from app.modules.all_platform.zalo.api.routes.auth import router as zalo_auth_router
from app.modules.all_platform.zalo.api.routes.accounts import router as zalo_accounts_router
from app.modules.all_platform.zalo.api.routes.conversations import router as zalo_conversations_router
from app.modules.all_platform.zalo.api.routes.events import router as zalo_events_router
from app.modules.all_platform.zalo.api.routes.listener import router as zalo_listener_router
from app.modules.all_platform.zalo.api.routes.inbox_share import router as zalo_inbox_share_router
from app.modules.all_platform.zalo.api.routes.maintenance import router as zalo_maintenance_router

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
all_platform_router.include_router(
    crm_contact_detail_router,
    prefix="/crm/contacts",
    tags=["All-Platform CRM Contacts"],
)

# ── Quote Forms + Quotes ───────────────────────────────────────────────────────
all_platform_router.include_router(quote_forms_router, prefix="/quote-forms", tags=["All-Platform Quote Forms"])
all_platform_router.include_router(quotes_router, prefix="/quotes", tags=["All-Platform Quotes"])
all_platform_router.include_router(project_router, prefix="/projects", tags=["All-Platform Projects"])
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

# ── Contracts (AI Contract Copilot) ────────────────────────────────────────────
all_platform_router.include_router(contracts_router, prefix="/contracts", tags=["All-Platform Contracts"])
all_platform_router.include_router(
    contract_templates_router,
    prefix="/contract-templates",
    tags=["All-Platform Contract Templates"],
)
all_platform_router.include_router(progress_router, prefix="/progress", tags=["All-Platform Progress Tracking"])

# ── Danh mục dịch vụ (Service Catalog) ─────────────────────────────────────────
all_platform_router.include_router(service_catalog_router, prefix="/service-catalog", tags=["All-Platform Service Catalog"])
all_platform_router.include_router(vendor_imports_router, prefix="/crm/vendor-imports", tags=["All-Platform CRM Vendor Imports"])
all_platform_router.include_router(vendors_router, prefix="/crm/vendors", tags=["All-Platform CRM Vendors"])

# ── Tài liệu bán hàng (Sales Assets) ───────────────────────────────────────────
all_platform_router.include_router(sales_asset_router, prefix="/sales-assets", tags=["All-Platform Sales Assets"])

# ── Inbox FB (proxy httpx sang Markee ngoài, không Playwright) ─────────────────
all_platform_router.include_router(fb_automation_router, prefix="/fb", tags=["All-Platform Facebook Automation"])
all_platform_router.include_router(fb_inbox_accounts_router, tags=["All-Platform FB Inbox Accounts"])

# ── Zalo Chat + Inbox Zalo Admin (core - khong gom 5 cong cu nang cao) ─────────
all_platform_router.include_router(zalo_auth_router, prefix="/zalo", tags=["Zalo Auth"])
all_platform_router.include_router(zalo_accounts_router, prefix="/zalo", tags=["Zalo Accounts"])
all_platform_router.include_router(zalo_conversations_router, prefix="/zalo", tags=["Zalo Conversations"])
all_platform_router.include_router(zalo_events_router, prefix="/zalo", tags=["Zalo Events"])
all_platform_router.include_router(zalo_listener_router, prefix="/zalo", tags=["Zalo Listener"])
all_platform_router.include_router(zalo_inbox_share_router, prefix="/zalo", tags=["Zalo Inbox Share"])
all_platform_router.include_router(zalo_maintenance_router, prefix="/zalo", tags=["Zalo Maintenance"])
