-- Migration 213: Tối ưu hoá truy vấn tin nhắn Zalo (Zalo Messages Query Accelerator)
-- Bổ sung composite index chuyên biệt cho việc load và phân trang tin nhắn theo cuộc hội thoại:
-- (user_id, group_id, is_deleted, created_at DESC)
-- Giúp triệt tiêu Sequential Scan và In-memory Sort khi hiển thị tin nhắn trên giao diện.

CREATE INDEX IF NOT EXISTS idx_zalo_messages_perf_query 
ON public.zalo_messages (user_id, group_id, is_deleted, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_zalo_messages_ts_desc
ON public.zalo_messages (user_id, group_id, ts DESC)
WHERE is_deleted = FALSE;

