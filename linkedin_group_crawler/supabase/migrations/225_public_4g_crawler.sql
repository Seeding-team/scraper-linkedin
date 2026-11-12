-- Migration 224: Zero-Account Fast Public Group Crawler + 4G Mobile Proxy Auto-Rotation
-- Idempotent migration for both DEV and Production PostgreSQL databases.

BEGIN;

-- 1. Bo sung metadata cao Public 4G tren bang facebook_groups
ALTER TABLE IF EXISTS public.facebook_groups
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'public',
  ADD COLUMN IF NOT EXISTS public_crawl_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS public_crawl_interval_min INT NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS last_public_crawled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_public_crawl_status TEXT,
  ADD COLUMN IF NOT EXISTS last_public_crawl_error TEXT,
  ADD COLUMN IF NOT EXISTS last_public_posts_count INT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_facebook_groups_public_crawl_due
  ON public.facebook_groups (visibility, public_crawl_enabled, last_public_crawled_at);

-- 2. Cau hinh singleton cho bo may cao Public 4G (APScheduler + Orchestrator)
CREATE TABLE IF NOT EXISTS public.public_crawl_config (
  id TEXT PRIMARY KEY DEFAULT 'default',
  enabled BOOLEAN NOT NULL DEFAULT false,
  cycle_interval_min INT NOT NULL DEFAULT 15,
  groups_per_ip_rotate INT NOT NULL DEFAULT 6,
  max_posts_per_group INT NOT NULL DEFAULT 25,
  max_scrolls_per_group INT NOT NULL DEFAULT 2,
  concurrent_sims INT NOT NULL DEFAULT 2,
  auto_skip_private BOOLEAN NOT NULL DEFAULT true,
  headless BOOLEAN NOT NULL DEFAULT true,
  updated_by UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.public_crawl_config (
  id, enabled, cycle_interval_min, groups_per_ip_rotate,
  max_posts_per_group, max_scrolls_per_group, concurrent_sims,
  auto_skip_private, headless
)
VALUES ('default', false, 15, 6, 25, 2, 2, true, true)
ON CONFLICT (id) DO NOTHING;

-- 3. Lich su cac vong chay Public 4G
CREATE TABLE IF NOT EXISTS public.public_crawl_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger_source TEXT NOT NULL DEFAULT 'manual',
  triggered_by UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'running',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  duration_ms INT,
  total_groups INT NOT NULL DEFAULT 0,
  groups_ok INT NOT NULL DEFAULT 0,
  groups_failed INT NOT NULL DEFAULT 0,
  groups_private INT NOT NULL DEFAULT 0,
  posts_saved INT NOT NULL DEFAULT 0,
  ip_rotations INT NOT NULL DEFAULT 0,
  avg_ms_per_group INT NOT NULL DEFAULT 0,
  sim_nodes TEXT[] DEFAULT '{}'::TEXT[],
  error_summary TEXT,
  details JSONB DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_public_crawl_runs_started_at
  ON public.public_crawl_runs (started_at DESC);

-- 4. Cap quyen PostgREST cho service_role / authenticated / anon
GRANT SELECT, INSERT, UPDATE, DELETE ON public.public_crawl_config TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.public_crawl_runs TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
