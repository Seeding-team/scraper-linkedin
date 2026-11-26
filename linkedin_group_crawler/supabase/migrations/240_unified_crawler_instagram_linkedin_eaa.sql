-- Migration 240: Unified Multi-Platform Crawler Upgrade
-- Covers:
--   Phase 1: Core 4G TLS impersonation toggle + dynamic GraphQL doc_id persistence
--   Phase 2: Instagram No-Acc Crawler (instagram_targets + instagram_posts)
--   Phase 3: LinkedIn No-Acc Crawler (linkedin_no_acc_targets + linkedin_posts.post_kind)
--   Phase 4: Facebook EAA Token Fast-Lane Pool (fb_eaa_tokens with Fernet encryption + Smart Private Router)

BEGIN;

-- ── Phase 1 + Multi-Platform Orchestrator Config Extensions ───────────────────
ALTER TABLE IF EXISTS public.public_crawl_config
  ADD COLUMN IF NOT EXISTS gql_pagination_doc_id TEXT,
  ADD COLUMN IF NOT EXISTS gql_doc_id_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS use_curl_cffi BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS alternating_instagram_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS instagram_max_posts_per_target INT NOT NULL DEFAULT 12,
  ADD COLUMN IF NOT EXISTS alternating_linkedin_no_acc_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS linkedin_no_acc_location TEXT NOT NULL DEFAULT 'Vietnam',
  ADD COLUMN IF NOT EXISTS linkedin_no_acc_max_jobs_per_keyword INT NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS use_eaa_for_private_groups BOOLEAN NOT NULL DEFAULT false;

-- ── Phase 2: Instagram No-Acc Tables ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.instagram_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type TEXT NOT NULL DEFAULT 'keyword' CHECK (target_type IN ('keyword', 'profile')),
  target_value TEXT NOT NULL,
  topic TEXT NOT NULL DEFAULT 'Chung',
  is_active BOOLEAN NOT NULL DEFAULT true,
  times_used INT NOT NULL DEFAULT 0,
  total_posts_found INT NOT NULL DEFAULT 0,
  high_score_posts INT NOT NULL DEFAULT 0,
  last_crawled_at TIMESTAMPTZ,
  last_error TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_instagram_targets_type_value UNIQUE (target_type, target_value)
);

CREATE INDEX IF NOT EXISTS idx_instagram_targets_active
  ON public.instagram_targets (is_active, last_crawled_at NULLS FIRST);

CREATE TABLE IF NOT EXISTS public.instagram_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_url TEXT NOT NULL UNIQUE,
  shortcode TEXT,
  author_username TEXT,
  author_name TEXT,
  content TEXT NOT NULL DEFAULT '',
  post_time TIMESTAMPTZ,
  crawl_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reactions INT NOT NULL DEFAULT 0,
  comments INT NOT NULL DEFAULT 0,
  shares INT NOT NULL DEFAULT 0,
  media_url TEXT,
  image_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  keyword TEXT,
  target_type TEXT NOT NULL DEFAULT 'keyword',
  id_member UUID,
  score INT NOT NULL DEFAULT 0,
  lead_score INT,
  lead_score_reason TEXT,
  lead_need_category TEXT,
  contact_phone TEXT,
  is_competitor BOOLEAN,
  is_buyer BOOLEAN,
  crawl_source TEXT NOT NULL DEFAULT 'public_4g'
);

CREATE INDEX IF NOT EXISTS idx_instagram_posts_crawl_date ON public.instagram_posts (crawl_date DESC);
CREATE INDEX IF NOT EXISTS idx_instagram_posts_post_time ON public.instagram_posts (post_time DESC);
CREATE INDEX IF NOT EXISTS idx_instagram_posts_lead_score ON public.instagram_posts (lead_score DESC);
CREATE INDEX IF NOT EXISTS idx_instagram_posts_shortcode ON public.instagram_posts (shortcode);

-- ── Phase 3: LinkedIn No-Acc Targets & linkedin_posts Extensions ──────────────
ALTER TABLE IF EXISTS public.linkedin_posts
  ADD COLUMN IF NOT EXISTS post_kind TEXT NOT NULL DEFAULT 'group_post',
  ADD COLUMN IF NOT EXISTS company_name TEXT,
  ADD COLUMN IF NOT EXISTS job_location TEXT,
  ADD COLUMN IF NOT EXISTS crawl_source TEXT DEFAULT 'group_crawler';

CREATE INDEX IF NOT EXISTS idx_linkedin_posts_post_kind ON public.linkedin_posts (post_kind);

CREATE TABLE IF NOT EXISTS public.linkedin_no_acc_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword TEXT NOT NULL UNIQUE,
  location TEXT NOT NULL DEFAULT 'Vietnam',
  channel TEXT NOT NULL DEFAULT 'both' CHECK (channel IN ('jobs_guest', 'search_index', 'both')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  times_used INT NOT NULL DEFAULT 0,
  total_posts_found INT NOT NULL DEFAULT 0,
  high_score_posts INT NOT NULL DEFAULT 0,
  last_crawled_at TIMESTAMPTZ,
  last_error TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_linkedin_no_acc_targets_active
  ON public.linkedin_no_acc_targets (is_active, last_crawled_at NULLS FIRST);

-- ── Phase 4: Facebook EAA Token Fast-Lane Pool (Fernet Encrypted) ─────────────
CREATE TABLE IF NOT EXISTS public.fb_eaa_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label TEXT NOT NULL,
  token_encrypted TEXT NOT NULL,
  token_masked TEXT NOT NULL,
  token_type TEXT NOT NULL DEFAULT 'EAAD6V7',
  fb_user_id TEXT,
  fb_user_name TEXT,
  sticky_proxy_url TEXT,
  sticky_proxy_masked TEXT,
  hourly_quota INT NOT NULL DEFAULT 80,
  requests_this_hour INT NOT NULL DEFAULT 0,
  hour_window_started_at TIMESTAMPTZ,
  total_requests INT NOT NULL DEFAULT 0,
  total_posts_saved INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cooldown', 'quarantined', 'expired', 'disabled')),
  cooldown_until TIMESTAMPTZ,
  last_app_usage_pct NUMERIC(5, 2) NOT NULL DEFAULT 0,
  last_error_code INT,
  last_error_message TEXT,
  last_used_at TIMESTAMPTZ,
  last_tested_at TIMESTAMPTZ,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fb_eaa_tokens_status
  ON public.fb_eaa_tokens (status, last_used_at NULLS FIRST);

GRANT ALL ON TABLE
  public.instagram_targets,
  public.instagram_posts,
  public.linkedin_no_acc_targets,
  public.fb_eaa_tokens
  TO postgres, anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
