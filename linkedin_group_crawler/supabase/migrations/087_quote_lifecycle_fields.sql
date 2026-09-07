-- Phase 1/3 "workflow that con thieu": soft-delete, huy co ly do, va tach
-- publish/send/request-changes ra khoi approve (truoc gio approve tu dong
-- bat public link luon - gio tach rieng theo dung yeu cau xac nhan). Day la
-- MIGRATION MOI, KHONG sua bat ky migration cu nao da dung.
--
-- CHUA APPLY len production/dev luc viet file nay - chi chuan bi code, cho
-- TEST_SUPABASE_URL rieng de kiem chung truoc khi apply that.

ALTER TABLE public.quotes
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES public.app_users(id),
    ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
    ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES public.app_users(id),
    ADD COLUMN IF NOT EXISTS published_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS published_by UUID REFERENCES public.app_users(id),
    ADD COLUMN IF NOT EXISTS sent_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS sent_by UUID REFERENCES public.app_users(id),
    -- "Yeu cau chinh sua" (Phase 3.B) - luu ngay tren quotes vi CHI can trang
    -- thai request-changes GAN NHAT (khong phai lich su nhieu lan) de UI doc
    -- lai duoc "vi sao bi tra ve"; lich su DAY DU van nam trong
    -- quote_activity_log (action='changes_requested') qua RPC ben duoi.
    ADD COLUMN IF NOT EXISTS requested_changes_target_stage TEXT,
    ADD COLUMN IF NOT EXISTS requested_changes_reason TEXT,
    ADD COLUMN IF NOT EXISTS requested_changes_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS requested_changes_by UUID REFERENCES public.app_users(id);

CREATE INDEX IF NOT EXISTS idx_quotes_deleted_at ON public.quotes(deleted_at) WHERE deleted_at IS NOT NULL;

-- Mo rong processing_stage: them 'ready_to_publish' (ngay sau khi duyet,
-- TRUOC khi phat hanh that - thay cho cach lam cu la gan nhan FE
-- "San sang phat hanh" tren cung 1 gia tri DB 'review', bi chinh nguoi dung
-- yeu cau sua vi day la state gia) va 'published' (sau khi goi publish that).
ALTER TABLE public.quotes DROP CONSTRAINT IF EXISTS quotes_processing_stage_check;
ALTER TABLE public.quotes ADD CONSTRAINT quotes_processing_stage_check
    CHECK (processing_stage IN ('request', 'technical', 'pricing', 'review', 'ready_to_publish', 'published'));

ALTER TABLE public.quotes DROP CONSTRAINT IF EXISTS quotes_requested_changes_target_stage_check;
ALTER TABLE public.quotes ADD CONSTRAINT quotes_requested_changes_target_stage_check
    CHECK (requested_changes_target_stage IS NULL OR requested_changes_target_stage IN ('technical', 'pricing'));
