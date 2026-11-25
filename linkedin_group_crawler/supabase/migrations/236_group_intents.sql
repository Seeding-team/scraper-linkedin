-- Migration 236: group_intents - nhieu linh vuc (intent) cho 1 group Facebook/LinkedIn
-- (Viec 1, 2026-11-22). Chuyen "Linh vuc" trong modal Them/Sua nhom tu quan he 1-1 (cot
-- id_intent) sang N-N qua bang join moi nay.
--
-- QUYET DINH DA XAC NHAN VOI NGUOI DUNG: cot id_intent CU tren facebook_groups/
-- linkedin_groups KHONG bi xoa va VAN TIEP TUC duoc ghi = linh vuc DAU TIEN trong danh
-- sach da chon moi lan luu (xem add_facebook_group/update_facebook_group,
-- add_linkedin_group/update_linkedin_group trong supabase_groups_service.py) - de 3 noi
-- con doc truc tiep id_intent khong bi "mu" voi group moi them/sua theo giao dien moi:
--   1. Bo loc "Linh vuc" o post-feed (unified_posts_service.py, dong ~210/236)
--   2. Bo loc "Linh vuc" ngay trong bang Quan ly nhom (group-management.tsx, intentFilter)
--   3. Daily crawl job 24h (daily_crawl_job.py, dong ~75, gan Intent=id_intent cho scraper)
-- Day la lua chon co y thuc (khong phai bo sot): day du cac linh vuc nam o group_intents,
-- cot id_intent chi la 1 gia tri DAI DIEN de tuong thich nguoc.

BEGIN;

CREATE TABLE IF NOT EXISTS public.group_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('facebook', 'linkedin')),
  id_intent UUID NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Khong co FK cung tren group_id: facebook_groups/linkedin_groups la 2 bang tach rieng,
-- group_id + platform cung phan biet group nam o bang nao (giong pattern post_quick_review/
-- post_call_results da dung platform-scoped key khong FK cung).
CREATE UNIQUE INDEX IF NOT EXISTS uq_group_intents_group_platform_intent
  ON public.group_intents (group_id, platform, id_intent);

CREATE INDEX IF NOT EXISTS idx_group_intents_group_platform
  ON public.group_intents (group_id, platform);

-- Migrate du lieu cu: moi group dang co id_intent -> tao 1 dong tuong ung trong group_intents.
INSERT INTO public.group_intents (group_id, platform, id_intent)
SELECT id, 'facebook', id_intent FROM public.facebook_groups WHERE id_intent IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO public.group_intents (group_id, platform, id_intent)
SELECT id, 'linkedin', id_intent FROM public.linkedin_groups WHERE id_intent IS NOT NULL
ON CONFLICT DO NOTHING;

COMMENT ON COLUMN public.facebook_groups.id_intent IS
  'DEPRECATED (migration 236): chi con la 1 linh vuc DAI DIEN (linh vuc dau tien da chon) '
  'de tuong thich nguoc voi noi con doc truc tiep cot nay (post-feed filter, group-management '
  'filter, daily_crawl_job). Danh sach day du nam o bang group_intents.';
COMMENT ON COLUMN public.linkedin_groups.id_intent IS
  'DEPRECATED (migration 236): xem comment facebook_groups.id_intent.';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.group_intents TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
