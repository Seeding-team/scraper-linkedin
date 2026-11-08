-- =============================================================================
-- CẤU HÌNH QUYỀN SUPABASE ROLES & BẢO VỆ CÔ LẬP ZALO TRÊN MÔI TRƯỜNG DEV
-- =============================================================================

-- 1. Safeguard: Xóa trắng toàn bộ dữ liệu bảng Zalo (nếu có) trên DEV DB
-- Đảm bảo DEV không chứa bất kỳ session, cookie, hay tin nhắn Zalo nào của Production.
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT tablename 
        FROM pg_tables 
        WHERE schemaname = 'public' AND tablename LIKE '%zalo%'
    ) LOOP
        EXECUTE 'TRUNCATE TABLE public.' || quote_ident(r.tablename) || ' CASCADE;';
    END LOOP;
END $$;

-- 2. Cấp quyền chuẩn mực cho các roles Supabase (PostgREST, Auth, API)
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON SCHEMA public TO postgres;

GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON ROUTINES TO anon, authenticated, service_role;

-- 3. Làm mới cache của PostgREST ngay lập tức
NOTIFY pgrst, 'reload schema';
