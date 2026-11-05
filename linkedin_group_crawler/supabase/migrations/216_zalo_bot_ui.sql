-- Migration 216: Giao diện quản lý Bot Zalo (bật/tắt, tiếp quản hội thoại, nhật ký).
-- Bổ sung cho 215_zalo_rag_bot.sql. Idempotent: chạy lại nhiều lần không lỗi.

-- 1. Tuỳ chọn tự tạm dừng bot khi nhân viên nhắn tay + đồng bộ Chatwoot
ALTER TABLE public.zalo_bot_configs
    ADD COLUMN IF NOT EXISTS auto_pause_on_staff_reply BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS pause_minutes             INTEGER NOT NULL DEFAULT 60,   -- 0 = tạm dừng đến khi bấm "Bật lại bot"
    ADD COLUMN IF NOT EXISTS chatwoot_sync             BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS updated_by                TEXT;

ALTER TABLE public.zalo_bot_configs
    DROP CONSTRAINT IF EXISTS zalo_bot_configs_pause_minutes_chk;
ALTER TABLE public.zalo_bot_configs
    ADD CONSTRAINT zalo_bot_configs_pause_minutes_chk CHECK (pause_minutes BETWEEN 0 AND 1440);

-- Cho phép lưu cấu hình bot khi chưa nhập Chatwoot ID (bot vẫn tắt)
ALTER TABLE public.zalo_bot_configs
    ALTER COLUMN chatwoot_account_id DROP NOT NULL,
    ALTER COLUMN chatwoot_inbox_id   DROP NOT NULL;

-- Nhật ký: ai gửi tin ra (bot hay nhân viên trả lời từ Chatwoot) -> chỉ tin 'bot' mới gắn nhãn Bot
ALTER TABLE public.zalo_bot_logs
    ADD COLUMN IF NOT EXISTS sent_by TEXT NOT NULL DEFAULT 'bot';

-- 2. Trạng thái tiếp quản theo từng hội thoại (nhân viên tiếp quản -> bot im lặng)
CREATE TABLE IF NOT EXISTS public.zalo_bot_threads (
    account_id        TEXT        NOT NULL,
    thread_id         TEXT        NOT NULL,
    paused            BOOLEAN     NOT NULL DEFAULT false,
    paused_until      TIMESTAMPTZ,                 -- NULL + paused=true => tạm dừng đến khi bấm "Bật lại bot"
    reason            TEXT,                        -- manual | staff_reply
    paused_by         TEXT,                        -- email nhân viên (hoặc 'auto')
    chatwoot_synced   BOOLEAN     NOT NULL DEFAULT false,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (account_id, thread_id)
);

CREATE INDEX IF NOT EXISTS idx_zalo_bot_threads_paused
    ON public.zalo_bot_threads (account_id) WHERE paused;

-- 3. Nhật ký: tra theo hội thoại / trạng thái nhanh hơn
CREATE INDEX IF NOT EXISTS idx_zalo_bot_logs_thread_created
    ON public.zalo_bot_logs (account_id, thread_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_zalo_bot_logs_status
    ON public.zalo_bot_logs (account_id, status, created_at DESC);
-- Khớp tin bot đã gửi với tin trong zalo_messages (nhãn "Bot")
CREATE INDEX IF NOT EXISTS idx_zalo_bot_logs_out_msg
    ON public.zalo_bot_logs (account_id, thread_id, source_msg_id)
    WHERE direction = 'out' AND status = 'sent';
