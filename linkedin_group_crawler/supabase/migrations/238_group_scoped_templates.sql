-- Migration 238: Mau binh luan / mau bai dang RIENG cho tung nhom (Viec 3, 2026-11-22).
--
-- BUOC 0 da xac nhan: quick_comment_templates (migration 024) la thu vien mau cau DUNG
-- CHUNG cho moi nhom (cot platform chi la 'all'/'facebook'/'linkedin', KHONG co cot group).
-- 2 bang moi duoi day DOC LAP HOAN TOAN voi quick_comment_templates - khong lien ket/ke
-- thua gi tu bang do, dung theo dung ket luan da chot.

BEGIN;

CREATE TABLE IF NOT EXISTS public.group_comment_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('facebook', 'linkedin')),
  content TEXT NOT NULL,
  created_by UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.group_post_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('facebook', 'linkedin')),
  content TEXT NOT NULL,
  created_by UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_group_comment_templates_group_platform
  ON public.group_comment_templates (group_id, platform);
CREATE INDEX IF NOT EXISTS idx_group_post_templates_group_platform
  ON public.group_post_templates (group_id, platform);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.group_comment_templates TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.group_post_templates TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
