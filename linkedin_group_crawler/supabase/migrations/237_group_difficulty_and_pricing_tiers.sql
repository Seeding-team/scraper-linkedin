-- Migration 237: Do kho rieng cho Binh luan/Bai dang (difficulty_comment/difficulty_post)
-- + bang gia nhieu dong (group_pricing_tiers) cho modal "Them nhom" (Viec 2, 2026-11-22).
--
-- BUOC 0 da xac nhan: facebook_groups/linkedin_groups KHONG co cot nao ten
-- difficulty_comment/difficulty_post truoc migration nay. Cot health_score cu (diem suc
-- khoe chung, legacy) GIU NGUYEN khong doi/khong xoa - day la 2 khai niem doc lap, khong
-- thay the cho nhau.

BEGIN;

ALTER TABLE public.facebook_groups
  ADD COLUMN IF NOT EXISTS difficulty_comment TEXT CHECK (difficulty_comment IN ('easy', 'hard')),
  ADD COLUMN IF NOT EXISTS difficulty_post TEXT CHECK (difficulty_post IN ('easy', 'hard'));

ALTER TABLE public.linkedin_groups
  ADD COLUMN IF NOT EXISTS difficulty_comment TEXT CHECK (difficulty_comment IN ('easy', 'hard')),
  ADD COLUMN IF NOT EXISTS difficulty_post TEXT CHECK (difficulty_post IN ('easy', 'hard'));

CREATE TABLE IF NOT EXISTS public.group_pricing_tiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('facebook', 'linkedin')),
  posts_count INT NOT NULL CHECK (posts_count > 0),
  period TEXT NOT NULL CHECK (period IN ('week', 'month')),
  unit_price NUMERIC NOT NULL CHECK (unit_price >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_group_pricing_tiers_group_platform
  ON public.group_pricing_tiers (group_id, platform);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.group_pricing_tiers TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
