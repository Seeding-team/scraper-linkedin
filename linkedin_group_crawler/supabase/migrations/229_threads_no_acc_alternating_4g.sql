-- Migration 229: Threads No-Acc Rotating 4G & Continuous FB <-> Threads Alternation
-- Stores Threads No-Acc settings (~30 dynamic AI keywords) and last completed platform phase
-- so 1 rotating proxy alternates cleanly: Facebook full groups -> Threads ~30 AI keywords -> Facebook -> ...

BEGIN;

ALTER TABLE IF EXISTS public.public_crawl_config
  ADD COLUMN IF NOT EXISTS alternating_threads_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS threads_keyword_target INT NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS threads_max_posts_per_keyword INT NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS threads_max_age_days INT NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS last_completed_platform TEXT;

ALTER TABLE IF EXISTS public.public_crawl_runs
  ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT 'facebook';

UPDATE public.public_crawl_config
SET
  alternating_threads_enabled = COALESCE(alternating_threads_enabled, true),
  threads_keyword_target = LEAST(50, GREATEST(5, COALESCE(threads_keyword_target, 30))),
  threads_max_posts_per_keyword = LEAST(30, GREATEST(5, COALESCE(threads_max_posts_per_keyword, 20))),
  threads_max_age_days = LEAST(30, GREATEST(1, COALESCE(threads_max_age_days, 7))),
  updated_at = NOW()
WHERE id = 'default';

NOTIFY pgrst, 'reload schema';

COMMIT;
