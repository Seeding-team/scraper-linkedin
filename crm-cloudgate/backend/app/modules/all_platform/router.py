"""Main all-platform router — mounts platform-specific and shared sub-routers.

crm-module la ban tach doc lap, CRM-only (xem commit a60c337b "tach module CRM
doc lap") - KHONG co cac tinh nang crawl FB/LinkedIn/YouTube/extension cua app
goc. File nay bi fix 2026-11-04: ban cu copy nguyen router.py cua app goc nen
import hang chuc router khong co file nguon trong crm-module, khien backend
crash ngay luc start (ImportError tu routers/__init__.py rong) - CHUA TUNG build
thanh cong tu source ke tu luc tach module (Sept 2026). Chi giu lai dung cac
router co file thuc te trong thu muc routers/ + zalo/telegram/email.
"""

from __future__ import annotations

from fastapi import APIRouter

from app.modules.all_platform.routers import (
    categories_router,
    members_router,
    users_router,
    teams_router,
    auth_router,
    social_accounts_router,
)
from app.modules.all_platform.routers.platforms import router as platforms_router
from app.modules.all_platform.routers.fb import router as fb_automation_router
from app.modules.all_platform.routers.fb_inbox_accounts import router as fb_inbox_accounts_router
from app.modules.all_platform.routers.customer_lead import router as customer_lead_router
from app.modules.all_platform.routers.project import router as project_router
from app.modules.all_platform.routers.vendor_imports import router as vendor_imports_router
from app.modules.all_platform.routers.vendors import router as vendors_router
from app.modules.all_platform.routers.crm_customer import router as crm_customer_router
from app.modules.all_platform.routers.crm_lead import router as crm_lead_router
from app.modules.all_platform.routers.crm_scope_items import router as crm_scope_items_router
from app.modules.all_platform.routers.crm_contact import detail_router as crm_contact_detail_router
from app.modules.all_platform.routers.crm_contact import router as crm_contact_router
from app.modules.all_platform.routers.crm_permission_group import router as crm_permission_group_router
from app.modules.all_platform.routers.crm_team import router as crm_team_router
from app.modules.all_platform.routers.quote import quote_forms_router, quotes_router, quote_email_provider_router, quote_approval_rules_router
from app.modules.all_platform.routers.price_book import price_book_router, price_book_admin_router
from app.modules.all_platform.routers.contract import contracts_router
from app.modules.all_platform.routers.contract_docx import contract_docx_router
from app.modules.all_platform.routers.contract_versions import contract_versions_router
from app.modules.all_platform.routers.contract_edit import contract_edit_router
from app.modules.all_platform.routers.progress import progress_router
from app.modules.all_platform.routers.contract_template import contract_templates_router
from app.modules.all_platform.routers.service_catalog import router as service_catalog_router
from app.modules.all_platform.routers.msc_sync import router as msc_sync_router
from app.modules.all_platform.routers.sales_asset import router as sales_asset_router
from app.modules.all_platform.routers.posts_delete import router as posts_delete_router

all_platform_router = APIRouter()

# ── Delete posts ────────────────────────────────────────────────────────────
all_platform_router.include_router(
    posts_delete_router,
    prefix="/unified",
    tags=["All-Platform Posts Delete"],
)

# ── Facebook (chi phan lien ket tai khoan, KHONG co crawl - app CRM khong
# crawl Facebook/LinkedIn/YouTube) ───────────────────────────────────────────
all_platform_router.include_router(
    fb_automation_router,
    prefix="/fb",
    tags=["All-Platform Facebook Automation"],
)

# ── Categories (platform-agnostic) ────────────────────────────────────────────
all_platform_router.include_router(
    categories_router,
    prefix="/categories",
    tags=["All-Platform Categories"],
)

# ── Members (HR roster, platform-agnostic) ────────────────────────────────────
all_platform_router.include_router(
    members_router,
    prefix="/members",
    tags=["All-Platform Members"],
)

# ── Users & Teams ──────────────────────────────────────────────────────────────
all_platform_router.include_router(
    users_router,
    prefix="/users",
    tags=["All-Platform Users"],
)
all_platform_router.include_router(
    teams_router,
    prefix="/teams",
    tags=["All-Platform Teams"],
)

# ── Auth ─────────────────────────────────────────────────────────────────────
all_platform_router.include_router(
    auth_router,
    prefix="/auth",
    tags=["All-Platform Auth"],
)

# ── Social Accounts ───────────────────────────────────────────────────────────
all_platform_router.include_router(
    social_accounts_router,
    prefix="/social-accounts",
    tags=["All-Platform Social Accounts"],
)

# ── FB Inbox Accounts ──────────────────────────────────────────────────────────
all_platform_router.include_router(
    fb_inbox_accounts_router,
    tags=["All-Platform FB Inbox Accounts"],
)

# ── Platforms ─────────────────────────────────────────────────────────────────
all_platform_router.include_router(
    platforms_router,
    prefix="/platforms",
    tags=["All-Platform Platforms"],
)

# ── Customer Leads ─────────────────────────────────────────────────────────────
all_platform_router.include_router(
    customer_lead_router,
    tags=["Customer Leads"]
)
all_platform_router.include_router(
    vendor_imports_router,
    prefix="/crm/vendor-imports",
    tags=["All-Platform CRM Vendor Imports"],
)
all_platform_router.include_router(
    vendors_router,
    prefix="/crm/vendors",
    tags=["All-Platform CRM Vendors"],
)
all_platform_router.include_router(
    crm_customer_router,
    prefix="/crm/customers",
    tags=["All-Platform CRM Customers"],
)
all_platform_router.include_router(
    crm_lead_router,
    prefix="/crm/leads",
    tags=["All-Platform CRM Leads"],
)
all_platform_router.include_router(crm_scope_items_router, prefix="/crm/scope-items", tags=["All-Platform CRM Scope Items"])
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
all_platform_router.include_router(
    crm_permission_group_router,
    prefix="/crm/permission-groups",
    tags=["All-Platform CRM Permission Groups"],
)
all_platform_router.include_router(
    crm_team_router,
    prefix="/crm/teams",
    tags=["All-Platform CRM Teams"],
)

# ── Quote Forms + Quotes ───────────────────────────────────────────────────────
all_platform_router.include_router(
    quote_forms_router,
    prefix="/quote-forms",
    tags=["All-Platform Quote Forms"],
)
all_platform_router.include_router(
    quotes_router,
    prefix="/quotes",
    tags=["All-Platform Quotes"],
)
all_platform_router.include_router(
    project_router,
    prefix="/projects",
    tags=["All-Platform Projects"],
)
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
all_platform_router.include_router(
    contracts_router,
    prefix="/contracts",
    tags=["All-Platform Contracts"],
)
all_platform_router.include_router(
    contract_docx_router,
    prefix="/contract-docs",
    tags=["All-Platform Contract Documents (DOCX engine)"],
)
all_platform_router.include_router(
    contract_versions_router,
    prefix="/contract-docs",
    tags=["All-Platform Contract Documents (versions, risk, readiness)"],
)
all_platform_router.include_router(
    contract_edit_router,
    prefix="/contracts",
    tags=["All-Platform Contract Word Editor (OnlyOffice, dev only)"],
)
all_platform_router.include_router(
    contract_templates_router,
    prefix="/contract-templates",
    tags=["All-Platform Contract Templates"],
)

# ── Quản lý tiến độ CRM (READ-only, không phải task management) ────────────────
all_platform_router.include_router(
    progress_router,
    prefix="/progress",
    tags=["All-Platform Progress Tracking"],
)

# ── Danh mục dịch vụ (Service Catalog) ─────────────────────────────────────────
all_platform_router.include_router(
    service_catalog_router,
    prefix="/service-catalog",
    tags=["All-Platform Service Catalog"],
)

# ── Dong bo Hang hoa MSC → CRM (manual + xem trang thai; scheduled o jobs) ────
all_platform_router.include_router(
    msc_sync_router,
    prefix="/msc-sync",
    tags=["All-Platform MSC Sync"],
)

all_platform_router.include_router(
    sales_asset_router,
    prefix="/sales-assets",
    tags=["All-Platform Sales Assets"],
)

# ── Zalo (2026-11-04: da them lai search_conversation_messages con thieu vao
# zalo/services/supabase_service.py de het ImportError, mount lai nhu cu;
# push.py/quick_replies.py van CHUA co file nguon trong crm-module nen KHONG
# mount) ──────────────────────────────────────────────────────────────────
from app.modules.all_platform.zalo.api.routes.auth import router as zalo_auth_router
from app.modules.all_platform.zalo.api.routes.broadcasts import router as zalo_broadcasts_router
from app.modules.all_platform.zalo.api.routes.maintenance import router as zalo_maintenance_router
from app.modules.all_platform.zalo.api.routes.listener import router as zalo_listener_router
from app.modules.all_platform.zalo.api.routes.accounts import router as zalo_accounts_router
from app.modules.all_platform.zalo.api.routes.conversations import router as zalo_conversations_router
from app.modules.all_platform.zalo.api.routes.events import router as zalo_events_router
from app.modules.all_platform.zalo.api.routes.inbox_share import router as zalo_inbox_share_router
from app.modules.all_platform.zalo.api.routes.forward_rules import router as zalo_forward_rules_router
from app.modules.all_platform.zalo.api.routes.bulk_jobs import router as zalo_bulk_jobs_router
from app.modules.all_platform.zalo.api.routes.campaigns import router as zalo_campaigns_router

all_platform_router.include_router(zalo_auth_router, prefix="/zalo", tags=["Zalo Auth"])
all_platform_router.include_router(zalo_broadcasts_router, prefix="/zalo", tags=["Zalo Broadcasts"])
all_platform_router.include_router(zalo_maintenance_router, prefix="/zalo", tags=["Zalo Maintenance"])
all_platform_router.include_router(zalo_listener_router, prefix="/zalo", tags=["Zalo Listener"])
all_platform_router.include_router(zalo_accounts_router, prefix="/zalo", tags=["Zalo Accounts"])
all_platform_router.include_router(zalo_conversations_router, prefix="/zalo", tags=["Zalo Conversations"])
all_platform_router.include_router(zalo_events_router, prefix="/zalo", tags=["Zalo Events"])
all_platform_router.include_router(zalo_inbox_share_router, prefix="/zalo", tags=["Zalo Inbox Share"])
all_platform_router.include_router(zalo_forward_rules_router, prefix="/zalo", tags=["Zalo Forward Rules"])
all_platform_router.include_router(zalo_bulk_jobs_router, prefix="/zalo", tags=["Zalo Bulk Jobs"])
all_platform_router.include_router(zalo_campaigns_router, prefix="/zalo", tags=["Zalo Campaigns"])

# ── Telegram Chat (Telethon) ────────────────────────────────────────────────────
from app.modules.all_platform.telegram.api.routes.auth import router as telegram_auth_router
from app.modules.all_platform.telegram.api.routes.accounts import router as telegram_accounts_router
from app.modules.all_platform.telegram.api.routes.conversations import router as telegram_conversations_router
from app.modules.all_platform.telegram.api.routes.messages import router as telegram_messages_router
from app.modules.all_platform.telegram.api.routes.events import router as telegram_events_router

all_platform_router.include_router(telegram_auth_router, prefix="/telegram", tags=["Telegram Auth"])
all_platform_router.include_router(telegram_accounts_router, prefix="/telegram", tags=["Telegram Accounts"])
all_platform_router.include_router(telegram_conversations_router, prefix="/telegram", tags=["Telegram Conversations"])
all_platform_router.include_router(telegram_messages_router, prefix="/telegram", tags=["Telegram Messages"])
all_platform_router.include_router(telegram_events_router, prefix="/telegram", tags=["Telegram Events"])

# ── Email Inbox (IMAP/SMTP & Google OAuth Omnichannel) ────────────────────────
from app.modules.all_platform.email.api.routes.email_inbox import router as email_inbox_router

all_platform_router.include_router(
    email_inbox_router,
    prefix="/email-inbox",
    tags=["All-Platform Email Inbox"],
)

# ── Post Evaluations (Đồng bộ đánh giá bài viết dùng chung cho tất cả các role) ──
from app.modules.all_platform.routers.post_evaluations import router as post_evaluations_router
all_platform_router.include_router(post_evaluations_router)
