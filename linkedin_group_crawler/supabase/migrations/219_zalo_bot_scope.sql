-- Migration 219: Phạm vi bật Bot Zalo theo từng người (hội thoại 1-1).
-- Bổ sung cho 217/218. Idempotent: chạy lại nhiều lần không lỗi.
--
--   scope_mode = 'all'      : bot trả lời MỌI người, trừ những hội thoại bị đặt bot_on = false ("loại trừ")
--   scope_mode = 'selected' : bot CHỈ trả lời những hội thoại được đặt bot_on = true ("chỉ những người đã chọn")

ALTER TABLE public.zalo_bot_configs
    ADD COLUMN IF NOT EXISTS scope_mode TEXT NOT NULL DEFAULT 'all';

ALTER TABLE public.zalo_bot_configs
    DROP CONSTRAINT IF EXISTS zalo_bot_configs_scope_mode_chk;
ALTER TABLE public.zalo_bot_configs
    ADD CONSTRAINT zalo_bot_configs_scope_mode_chk CHECK (scope_mode IN ('all', 'selected'));

CREATE TABLE IF NOT EXISTS public.zalo_bot_thread_rules (
    account_id  TEXT        NOT NULL,
    thread_id   TEXT        NOT NULL,
    bot_on      BOOLEAN     NOT NULL,
    updated_by  TEXT,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (account_id, thread_id)
);

CREATE INDEX IF NOT EXISTS idx_zalo_bot_thread_rules_account_on
    ON public.zalo_bot_thread_rules (account_id, bot_on);

-- Báo PostgREST (Supabase API) nạp lại schema để bảng/cột mới dùng được ngay, khỏi phải đợi hoặc restart.
NOTIFY pgrst, 'reload schema';
