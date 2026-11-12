-- Migration 228: Continuous Zero-Wait 24/24 Public 4G Loop & Proxy Expiry Guard
-- Switches singleton config default to enabled=true, cycle_interval_min=0 (continuous loop)
-- and tracks auto_pause_reason / proxy_expired_error cleanly across restarts.

BEGIN;

ALTER TABLE IF EXISTS public.public_crawl_config
  ALTER COLUMN enabled SET DEFAULT true,
  ALTER COLUMN cycle_interval_min SET DEFAULT 0;

ALTER TABLE IF EXISTS public.public_crawl_config
  ADD COLUMN IF NOT EXISTS auto_pause_reason TEXT,
  ADD COLUMN IF NOT EXISTS proxy_expired_error TEXT;

UPDATE public.public_crawl_config
SET
  enabled = true,
  cycle_interval_min = 0,
  concurrent_sims = LEAST(
    GREATEST(1, COALESCE(concurrent_sims, 1)),
    GREATEST(1, COALESCE(jsonb_array_length(proxy_urls), 1))
  ),
  auto_pause_reason = NULL,
  proxy_expired_error = NULL,
  updated_at = NOW()
WHERE id = 'default'
  AND COALESCE(auto_pause_reason, '') <> 'proxy_expired';

NOTIFY pgrst, 'reload schema';

COMMIT;
