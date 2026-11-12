-- Migration 226: Standalone Auto-Rotating Proxy Pool for Public Crawler
-- Decouples Public Crawler from Mobile Phone Bridge (phone console) and stores proxy URLs in DB.

BEGIN;

ALTER TABLE IF EXISTS public.public_crawl_config
  ADD COLUMN IF NOT EXISTS proxy_urls JSONB NOT NULL DEFAULT '[]'::JSONB;

NOTIFY pgrst, 'reload schema';

COMMIT;

