-- Theo dõi thời gian online của thành viên (theo phút) — dùng cho widget "Thời gian
-- online" ở tab phụ "Dashboard leader" (Seeding bên ngoài): xem hôm nay/tuần này/tháng
-- này mỗi user đã online bao nhiêu phút, và có đang online ngay lúc này không.
--
-- Cơ chế: frontend (AppAuthContext) gửi 1 "heartbeat" mỗi ~45 giây trong lúc tab đang
-- HIỂN THỊ (Page Visibility API — không tính lúc tab ẩn/máy khoá màn hình) tới
-- POST /api/all-platform/presence/heartbeat. Mỗi heartbeat chỉ UPSERT đúng 1 dòng cho
-- PHÚT hiện tại (minute_bucket = date_trunc('minute', now())) — nhiều heartbeat trong
-- cùng 1 phút không tạo dòng trùng. "Số phút online" = COUNT DISTINCT minute_bucket
-- trong khoảng thời gian cần xem — đơn giản, không cần suy luận khoảng-nghỉ giữa 2 lần
-- ping, độ chính xác ngang mức phút (đủ dùng, không giả vờ chính xác tới giây).
CREATE TABLE IF NOT EXISTS public.member_online_minutes (
    id_member UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
    minute_bucket TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id_member, minute_bucket)
);

CREATE INDEX IF NOT EXISTS idx_member_online_minutes_bucket ON public.member_online_minutes (minute_bucket DESC);
CREATE INDEX IF NOT EXISTS idx_member_online_minutes_member_bucket ON public.member_online_minutes (id_member, minute_bucket DESC);

ALTER TABLE public.member_online_minutes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS member_online_minutes_read_all ON public.member_online_minutes;
CREATE POLICY member_online_minutes_read_all ON public.member_online_minutes
    FOR SELECT TO authenticated, anon USING (true);

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        GRANT ALL ON public.member_online_minutes TO service_role;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        GRANT SELECT ON public.member_online_minutes TO authenticated;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        GRANT SELECT ON public.member_online_minutes TO anon;
    END IF;
END $$;

NOTIFY pgrst, 'reload schema';
