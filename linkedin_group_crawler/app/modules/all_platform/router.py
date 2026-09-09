"""Main all-platform router — mounts platform-specific and shared sub-routers."""

from __future__ import annotations

from fastapi import APIRouter

from app.modules.all_platform.routers import (
    seeding_router,
    kpi_router,
    categories_router,
    members_router,
    quick_comment_router,
    quick_inbox_router,
    users_router,
    teams_router,
    auth_router,
    social_accounts_router,
)
from app.modules.all_platform.routers.platforms import router as platforms_router
from app.modules.all_platform.routers.linkedin_auth import router as linkedin_auth_router
from app.modules.all_platform.routers.posts import facebook_posts_router
from app.modules.all_platform.routers.posts_linkedin import linkedin_posts_router
from app.modules.all_platform.routers.posts_unified import router as unified_posts_router
from app.modules.all_platform.routers.groups import facebook_groups_router
from app.modules.all_platform.routers.groups_linkedin import linkedin_groups_router
from app.modules.all_platform.routers.crawl_linkedin import crawl_linkedin_router
from app.modules.all_platform.routers.linkedin_legacy import router as linkedin_legacy_router
from app.modules.all_platform.routers.crawl_facebook import crawl_facebook_router
from app.modules.all_platform.routers.extension_crawl import router as extension_crawl_router
from app.modules.all_platform.routers.extension_crawl_linkedin import router as extension_crawl_linkedin_router
from app.modules.all_platform.routers.crawl_queue import router as crawl_queue_router
from app.modules.all_platform.routers.fb_account_pool import router as fb_account_pool_router
from app.modules.all_platform.routers.fb import router as fb_automation_router
from app.modules.all_platform.routers.websocket import router as websocket_router
from app.modules.all_platform.routers.fb_inbox_accounts import router as fb_inbox_accounts_router
from app.modules.all_platform.routers.crawl_fb_dashboard import router as crawl_fb_dashboard_router
from app.modules.all_platform.routers.customer_lead import router as customer_lead_router
from app.modules.all_platform.routers.project import router as project_router
from app.modules.all_platform.routers.crm_customer import router as crm_customer_router
from app.modules.all_platform.routers.crm_lead import router as crm_lead_router
from app.modules.all_platform.routers.crm_contact import router as crm_contact_router
from app.modules.all_platform.routers.quote import quote_forms_router, quotes_router, quote_email_provider_router, quote_approval_rules_router
from app.modules.all_platform.routers.price_book import price_book_router, price_book_admin_router
from app.modules.all_platform.routers.contract import contracts_router
from app.modules.all_platform.routers.contract_template import contract_templates_router
from app.modules.all_platform.routers.service_catalog import router as service_catalog_router
from app.modules.all_platform.routers.sales_asset import router as sales_asset_router
from app.modules.all_platform.routers.kpi_reward import router as kpi_reward_router
from app.modules.all_platform.routers.scheduled_comments import router as scheduled_comments_router
from app.modules.all_platform.routers.posts_delete import router as posts_delete_router
from app.modules.all_platform.routers.internal_engagement import router as internal_engagement_router
from app.modules.all_platform.phone_bridge.router import router as phone_bridge_router

all_platform_router = APIRouter()

# ── Delete posts ────────────────────────────────────────────────────────────
all_platform_router.include_router(
    posts_delete_router,
    prefix="/unified",
    tags=["All-Platform Posts Delete"],
)



# ── Facebook ────────────────────────────────────────────────────────────────────
all_platform_router.include_router(
    seeding_router,
    prefix="/facebook",
    tags=["All-Platform Facebook Seeding"],
)
all_platform_router.include_router(
    facebook_posts_router,
    prefix="/facebook",
    tags=["All-Platform Facebook Posts"],
)
all_platform_router.include_router(
    facebook_groups_router,
    prefix="/facebook",
    tags=["All-Platform Facebook Groups"],
)
all_platform_router.include_router(
    crawl_facebook_router,
    prefix="/facebook",
    tags=["All-Platform Facebook Crawl"],
)
all_platform_router.include_router(
    crawl_fb_dashboard_router,
    prefix="/facebook",
    tags=["All-Platform Facebook Crawl Queue Dashboard"],
)
all_platform_router.include_router(
    extension_crawl_router,
    prefix="/extension",
    tags=["All-Platform Extension Crawl"],
)
all_platform_router.include_router(
    extension_crawl_linkedin_router,
    prefix="/extension/linkedin",
    tags=["All-Platform Extension LinkedIn Crawl"],
)
all_platform_router.include_router(
    crawl_queue_router,
    prefix="/extension/queue",
    tags=["All-Platform Extension Crawl Queue"],
)
all_platform_router.include_router(
    fb_account_pool_router,
    prefix="/extension/accounts",
    tags=["All-Platform Extension FB Account Pool"],
)
all_platform_router.include_router(
    fb_automation_router,
    prefix="/fb",
    tags=["All-Platform Facebook Automation"],
)
from app.modules.facebook.src.modules.crawl_fb.router.vps_router import router as vps_fb_router
all_platform_router.include_router(
    vps_fb_router,
    tags=["All-Platform Facebook VPS"],
)

from app.modules.facebook.src.modules.crawl_fb.router.vps import router as vps_vnc_router
all_platform_router.include_router(
    vps_vnc_router,
    tags=["All-Platform Facebook VPS VNC"],
)

# ── LinkedIn ───────────────────────────────────────────────────────────────────
all_platform_router.include_router(
    seeding_router,
    prefix="/linkedin",
    tags=["All-Platform LinkedIn Seeding"],
)
all_platform_router.include_router(
    linkedin_posts_router,
    prefix="/linkedin",
    tags=["All-Platform LinkedIn Posts"],
)
all_platform_router.include_router(
    linkedin_groups_router,
    prefix="/linkedin",
    tags=["All-Platform LinkedIn Groups"],
)
all_platform_router.include_router(
    crawl_linkedin_router,
    prefix="/linkedin",
    tags=["All-Platform LinkedIn Crawl"],
)
all_platform_router.include_router(
    linkedin_auth_router,
    prefix="/linkedin",
    tags=["All-Platform LinkedIn Auth"],
)
all_platform_router.include_router(
    linkedin_legacy_router,
    prefix="/linkedin",
)

# ── Unified Posts (Tong-hop page — no cache, all filters server-side) ──────────
all_platform_router.include_router(
    unified_posts_router,
    prefix="/unified",
    tags=["All-Platform Unified Posts"],
)

# ── KPI (platform-agnostic) ───────────────────────────────────────────────────
all_platform_router.include_router(
    kpi_router,
    prefix="/kpi",
    tags=["All-Platform KPI"],
)
all_platform_router.include_router(
    kpi_reward_router,
    prefix="/kpi-rewards",
    tags=["All-Platform KPI Rewards"],
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

# ── Quick Comment Library (platform-agnostic) ─────────────────────────────────
all_platform_router.include_router(
    quick_comment_router,
    prefix="/quick-comments",
    tags=["All-Platform Quick Comments"],
)

# ── Quick Inbox Library (platform-agnostic) ───────────────────────────────────
all_platform_router.include_router(
    quick_inbox_router,
    prefix="/quick-inbox",
    tags=["All-Platform Quick Inbox"],
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

# ── Internal Engagement (Tương tác nội bộ — MarkeeAI FB Page posts) ────────────
all_platform_router.include_router(
    internal_engagement_router,
    prefix="/internal-engagement",
    tags=["All-Platform Internal Engagement"],
)

# ── Account Online Summary (Facebook + Zalo online/total, cross-platform) ──────
from app.modules.all_platform.routers.account_online_summary import router as account_online_summary_router
all_platform_router.include_router(
    account_online_summary_router,
    prefix="/accounts",
    tags=["All-Platform Account Online Summary"],
)

# ── FB Post KPI ────────────────────────────────────────────────────────────────
from app.modules.all_platform.routers.fb_post_kpi import router as fb_post_kpi_router
all_platform_router.include_router(
    fb_post_kpi_router,
    prefix="/fb/post-kpi",
    tags=["All-Platform FB Post KPI"],
)

# ── Platforms ─────────────────────────────────────────────────────────────────
all_platform_router.include_router(
    platforms_router,
    prefix="/platforms",
    tags=["All-Platform Platforms"],
)

# ── Admin Dashboard ────────────────────────────────────────────────────────────
from app.modules.all_platform.routers.admin_dashboard import router as admin_dashboard_router
all_platform_router.include_router(
    admin_dashboard_router,
    prefix="/admin/dashboard",
    tags=["All-Platform Admin Dashboard"],
)
all_platform_router.include_router(
    phone_bridge_router,
    prefix="/admin/phone-bridge",
    tags=["All-Platform Admin Phone Bridge"],
)

# ── Customer Leads ─────────────────────────────────────────────────────────────
all_platform_router.include_router(
    customer_lead_router,
    tags=["Customer Leads"]
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
all_platform_router.include_router(
    crm_contact_router,
    prefix="/crm/customers/{customer_id}/contacts",
    tags=["All-Platform CRM Contacts"],
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
    contract_templates_router,
    prefix="/contract-templates",
    tags=["All-Platform Contract Templates"],
)

# ── Danh mục dịch vụ (Service Catalog) ─────────────────────────────────────────
all_platform_router.include_router(
    service_catalog_router,
    prefix="/service-catalog",
    tags=["All-Platform Service Catalog"],
)

all_platform_router.include_router(
    sales_asset_router,
    prefix="/sales-assets",
    tags=["All-Platform Sales Assets"],
)

# ── WebSocket ────────────────────────────────────────────────────────────────
all_platform_router.include_router(
    websocket_router,
    tags=["All-Platform WebSockets"]
)

# ── Zalo ───────────────────────────────────────────────────────────────────────
from app.modules.all_platform.zalo.api.routes.auth import router as zalo_auth_router
from app.modules.all_platform.zalo.api.routes.crawler import router as zalo_crawl_router
from app.modules.all_platform.zalo.api.routes.groups import router as zalo_groups_router
from app.modules.all_platform.zalo.api.routes.jobs import router as zalo_jobs_router
from app.modules.all_platform.zalo.api.routes.library import router as zalo_library_router
from app.modules.all_platform.zalo.api.routes.broadcasts import router as zalo_broadcasts_router
from app.modules.all_platform.zalo.api.routes.maintenance import router as zalo_maintenance_router
from app.modules.all_platform.zalo.api.routes.listener import router as zalo_listener_router
from app.modules.all_platform.zalo.api.routes.accounts import router as zalo_accounts_router
from app.modules.all_platform.zalo.api.routes.conversations import router as zalo_conversations_router
from app.modules.all_platform.zalo.api.routes.events import router as zalo_events_router
from app.modules.all_platform.zalo.api.routes.inbox_share import router as zalo_inbox_share_router
from app.modules.all_platform.zalo.api.proxy import router as zalo_proxy_router

all_platform_router.include_router(zalo_auth_router, prefix="/zalo", tags=["Zalo Auth"])
all_platform_router.include_router(zalo_crawl_router, prefix="/zalo", tags=["Zalo Crawl"])
all_platform_router.include_router(zalo_groups_router, prefix="/zalo", tags=["Zalo Groups"])
all_platform_router.include_router(zalo_jobs_router, prefix="/zalo", tags=["Zalo Jobs"])
all_platform_router.include_router(zalo_library_router, prefix="/zalo", tags=["Zalo Library"])
all_platform_router.include_router(zalo_broadcasts_router, prefix="/zalo", tags=["Zalo Broadcasts"])
all_platform_router.include_router(zalo_maintenance_router, prefix="/zalo", tags=["Zalo Maintenance"])
all_platform_router.include_router(zalo_listener_router, prefix="/zalo", tags=["Zalo Listener"])
all_platform_router.include_router(zalo_accounts_router, prefix="/zalo", tags=["Zalo Accounts"])
all_platform_router.include_router(zalo_conversations_router, prefix="/zalo", tags=["Zalo Conversations"])
all_platform_router.include_router(zalo_events_router, prefix="/zalo", tags=["Zalo Events"])
all_platform_router.include_router(zalo_inbox_share_router, prefix="/zalo", tags=["Zalo Inbox Share"])
all_platform_router.include_router(zalo_proxy_router, prefix="/zalo", tags=["Zalo Proxy"])

# ── Scheduled Comments ─────────────────────────────────────────────────────────
all_platform_router.include_router(
    scheduled_comments_router,
    prefix="/scheduled-comments",
    tags=["All-Platform Scheduled Comments"],
)

