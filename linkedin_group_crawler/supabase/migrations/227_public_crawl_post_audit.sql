-- Migration 227: Persistent Audit Trail for Public 4G Crawled Posts & AI Lead Checks
-- Keeps full visibility of posts ingested via Rotating Proxy 4G and AI decisions
-- (including competitor / low-score posts deleted from facebook_posts immediately after AI check).

BEGIN;

CREATE TABLE IF NOT EXISTS public.crawled_post_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT NOT NULL DEFAULT 'facebook',
  crawl_source TEXT NOT NULL DEFAULT 'public_4g',
  run_id UUID REFERENCES public.public_crawl_runs(id) ON DELETE SET NULL,
  proxy_node TEXT,
  group_id UUID REFERENCES public.facebook_groups(id) ON DELETE SET NULL,
  group_name TEXT,
  group_url TEXT,
  post_id TEXT,
  post_url TEXT NOT NULL,
  author_name TEXT,
  content TEXT NOT NULL DEFAULT '',
  post_time TIMESTAMPTZ,
  reactions INT NOT NULL DEFAULT 0,
  comments INT NOT NULL DEFAULT 0,
  shares INT NOT NULL DEFAULT 0,
  ai_status TEXT NOT NULL DEFAULT 'pending',
  lead_score INT,
  is_competitor BOOLEAN,
  is_buyer BOOLEAN,
  lead_need_category TEXT,
  lead_score_reason TEXT,
  contact_phone TEXT,
  auto_seeding_created BOOLEAN NOT NULL DEFAULT false,
  zalo_triggered BOOLEAN NOT NULL DEFAULT false,
  crawled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ai_checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_crawled_post_audit_platform_url
  ON public.crawled_post_audit_logs (platform, post_url);

CREATE INDEX IF NOT EXISTS idx_crawled_post_audit_source_time
  ON public.crawled_post_audit_logs (crawl_source, crawled_at DESC);

CREATE INDEX IF NOT EXISTS idx_crawled_post_audit_ai_checked
  ON public.crawled_post_audit_logs (ai_checked_at DESC, ai_status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.crawled_post_audit_logs TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
