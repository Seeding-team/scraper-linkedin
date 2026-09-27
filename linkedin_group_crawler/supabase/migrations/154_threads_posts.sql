-- Bang luu bai viet Threads (threads.com) cao qua "Markee Seeding Extension"
-- (extensions/comment-extension, lenh MK_TH_CRAWL_*, bg/threads-crawl.js) — tinh nang
-- "Sieu Toc Cao Du Lieu" cho Threads o tab "Seeding ben ngoai", tuong tu
-- facebook_posts cua Facebook.
--
-- Khac Facebook/LinkedIn: Threads KHONG co khai niem "group" — bai duoc tim
-- bang tu khoa (trang tim kiem threads.com/search?q=...), nen bang nay KHONG
-- co group_id/taxonomy (intent/industry/team...), thay vao do luu `keyword`
-- (tu khoa da tim ra bai) + thong tin tac gia ngay tren dong.
--
-- Chi THEM bang moi, khong dung vao bang/du lieu cu nao — an toan de ap tren
-- DB dung chung dev + production.

CREATE TABLE IF NOT EXISTS public.threads_posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- URL chuan hoa https://www.threads.com/@<username>/post/<code> — dung de dedupe.
    post_url TEXT NOT NULL,
    -- Shortcode cua bai (phan <code> trong URL).
    post_code TEXT,
    -- Tu khoa tim kiem da tim ra bai nay (lan dau luu).
    keyword TEXT,
    author_username TEXT,
    author_name TEXT,
    author_url TEXT,
    content TEXT,
    post_time TIMESTAMPTZ,
    crawl_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    score INTEGER NOT NULL DEFAULT 0,
    -- reactions = like_count, comments = direct_reply_count,
    -- shares = repost_count + quote_count (cung ten cot voi facebook_posts
    -- de feed hop nhat hien thi chung 1 kieu).
    reactions INTEGER NOT NULL DEFAULT 0,
    comments INTEGER NOT NULL DEFAULT 0,
    shares INTEGER NOT NULL DEFAULT 0,
    media_url TEXT,
    image_urls TEXT[] NOT NULL DEFAULT '{}',
    -- Nguoi bam cao (app_users.id) — dung de phan quyen xem giong facebook_posts.id_member.
    id_member UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT threads_posts_post_url_key UNIQUE (post_url)
);

CREATE INDEX IF NOT EXISTS idx_threads_posts_crawl_date ON public.threads_posts (crawl_date DESC);
CREATE INDEX IF NOT EXISTS idx_threads_posts_id_member ON public.threads_posts (id_member);

-- RLS theo pattern cac bang moi gan day (vd migration 127): bat RLS, chi cho
-- doc; ghi chi qua backend (service_role bo qua RLS).
ALTER TABLE public.threads_posts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS threads_posts_read_all ON public.threads_posts;
CREATE POLICY threads_posts_read_all ON public.threads_posts
    FOR SELECT TO authenticated, anon USING (true);

-- DB self-host: dam bao role cua PostgREST co quyen tren bang moi (chi grant
-- khi role ton tai, tranh loi tren Postgres khong co cac role Supabase).
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        GRANT ALL ON public.threads_posts TO service_role;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        GRANT SELECT ON public.threads_posts TO authenticated;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        GRANT SELECT ON public.threads_posts TO anon;
    END IF;
END $$;

NOTIFY pgrst, 'reload schema';
