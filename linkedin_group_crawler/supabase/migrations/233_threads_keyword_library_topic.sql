-- Migration 233: Threads Keyword Library with Topics & User Seeding Support
-- Adds topic and created_by to threads_keyword_registry
-- Ensures open access for all users (member, leader, admin) to manage Threads keyword seeding library

BEGIN;

ALTER TABLE IF EXISTS public.threads_keyword_registry
  ADD COLUMN IF NOT EXISTS topic TEXT NOT NULL DEFAULT 'Chung',
  ADD COLUMN IF NOT EXISTS created_by TEXT;

CREATE INDEX IF NOT EXISTS idx_tkr_topic ON public.threads_keyword_registry(topic);

-- Assign default topics to existing keywords
UPDATE public.threads_keyword_registry
SET topic = CASE
  WHEN keyword ILIKE '%web%' OR keyword ILIKE '%landing page%' OR keyword ILIKE '%wordpress%' OR keyword ILIKE '%shopify%' OR keyword ILIKE '%ui ux%' THEN 'Website'
  WHEN keyword ILIKE '%app%' OR keyword ILIKE '%mobile%' OR keyword ILIKE '%ios%' OR keyword ILIKE '%android%' THEN 'Mobile App'
  WHEN keyword ILIKE '%phần mềm%' OR keyword ILIKE '%crm%' OR keyword ILIKE '%erp%' OR keyword ILIKE '%pos%' OR keyword ILIKE '%outsource%' OR keyword ILIKE '%lập trình%' THEN 'Phần mềm & CRM'
  WHEN keyword ILIKE '%marketing%' OR keyword ILIKE '%ads%' OR keyword ILIKE '%seo%' OR keyword ILIKE '%bán hàng%' OR keyword ILIKE '%kinh doanh%' THEN 'Marketing & Ads'
  WHEN keyword ILIKE '%ai%' OR keyword ILIKE '%bot%' OR keyword ILIKE '%automation%' OR keyword ILIKE '%n8n%' OR keyword ILIKE '%tự động hóa%' OR keyword ILIKE '%saas%' THEN 'AI & Tự động hóa'
  ELSE 'Chung'
END
WHERE topic = 'Chung';

NOTIFY pgrst, 'reload schema';

COMMIT;
