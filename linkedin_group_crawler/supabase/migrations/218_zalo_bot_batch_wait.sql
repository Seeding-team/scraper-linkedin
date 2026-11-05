-- Migration 218: Gom tin khách nhắn liên tiếp trước khi chuyển cho Bot Zalo.
-- Bổ sung cho 215/216/217. Idempotent: chạy lại nhiều lần không lỗi.
--
--   batch_wait_seconds = N > 0 : khi khách nhắn, bot chờ N giây xem khách có gõ tiếp không; im lặng đủ N giây
--                               thì gộp mọi tin chưa xử lý của hội thoại đó thành 1 câu hỏi -> 1 câu trả lời.
--   batch_wait_seconds = 0     : tắt gom, bot trả lời từng tin như trước.

ALTER TABLE public.zalo_bot_configs
    ADD COLUMN IF NOT EXISTS batch_wait_seconds INTEGER NOT NULL DEFAULT 10;

ALTER TABLE public.zalo_bot_configs
    DROP CONSTRAINT IF EXISTS zalo_bot_configs_batch_wait_chk;
ALTER TABLE public.zalo_bot_configs
    ADD CONSTRAINT zalo_bot_configs_batch_wait_chk CHECK (batch_wait_seconds BETWEEN 0 AND 120);

-- Tra "tin này đã xử lý chưa" theo mã tin (chống chuyển trùng khi 1 hội thoại bị hoãn để gom tin)
CREATE INDEX IF NOT EXISTS idx_zalo_bot_logs_in_msg
    ON public.zalo_bot_logs (account_id, source_msg_id)
    WHERE direction = 'in';

-- Báo PostgREST (Supabase API) nạp lại schema để cột mới dùng được ngay.
NOTIFY pgrst, 'reload schema';
