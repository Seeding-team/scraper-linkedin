-- Seeding YouTube o tab "Seeding ben ngoai" (cung khuon Threads, migration 154):
--   1. Bang youtube_posts luu video cao qua "Markee Seeding Extension" (lenh
--      MK_YT_CRAWL_*, bg/youtube-crawl.js) — tim theo TU KHOA (trang
--      youtube.com/results) hoac nguoi dung dan thang LINK video.
--   2. Them dong "youtube" vao bang platforms de seeding_content_kpi.id_platform /
--      social_accounts.id_platform co FK hop le cho YouTube (truoc day extension
--      gan nham YouTube = 2 = LinkedIn vi DB chua co dong nay).
--   3. Cot social_accounts.account_handle (@handle cua kenh YouTube da lien ket).
--
-- Chi THEM bang/dong moi, khong dung vao du lieu cu — chay lai nhieu lan van an toan,
-- an toan de ap tren DB dung chung dev + production.

CREATE TABLE IF NOT EXISTS public.youtube_posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- ID 11 ky tu cua video — khoa dedupe (1 video chi co 1 dong du dan link dang nao).
    video_id TEXT NOT NULL,
    -- URL chuan hoa: https://www.youtube.com/watch?v=<id> hoac https://www.youtube.com/shorts/<id>.
    post_url TEXT NOT NULL,
    is_short BOOLEAN NOT NULL DEFAULT FALSE,
    -- Tu khoa da tim ra video (NULL neu nguoi dung dan thang link).
    keyword TEXT,
    -- 'keyword' | 'link'
    source TEXT NOT NULL DEFAULT 'keyword',
    title TEXT,
    -- Tieu de + mo ta ngan (feed hop nhat hien thi cot content).
    content TEXT,
    author_name TEXT,
    channel_id TEXT,
    channel_handle TEXT,
    author_url TEXT,
    -- Thoi diem dang: chinh xac khi co publishDate, uoc luong tu "2 ngay truoc" khi chi co trang tim kiem.
    post_time TIMESTAMPTZ,
    published_text TEXT,
    duration_text TEXT,
    view_count BIGINT NOT NULL DEFAULT 0,
    -- Cung ten cot voi facebook_posts/threads_posts de feed hop nhat hien thi chung 1 kieu.
    reactions INTEGER NOT NULL DEFAULT 0,
    comments INTEGER NOT NULL DEFAULT 0,
    shares INTEGER NOT NULL DEFAULT 0,
    score INTEGER NOT NULL DEFAULT 0,
    image_urls TEXT[] NOT NULL DEFAULT '{}',
    crawl_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Nguoi bam cao (app_users.id) — phan quyen xem giong threads_posts.id_member.
    id_member UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT youtube_posts_video_id_key UNIQUE (video_id)
);

CREATE INDEX IF NOT EXISTS idx_youtube_posts_crawl_date ON public.youtube_posts (crawl_date DESC);
CREATE INDEX IF NOT EXISTS idx_youtube_posts_id_member ON public.youtube_posts (id_member);
CREATE INDEX IF NOT EXISTS idx_youtube_posts_post_url ON public.youtube_posts (post_url);

ALTER TABLE public.youtube_posts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS youtube_posts_read_all ON public.youtube_posts;
CREATE POLICY youtube_posts_read_all ON public.youtube_posts
    FOR SELECT TO authenticated, anon USING (true);

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        GRANT ALL ON public.youtube_posts TO service_role;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        GRANT SELECT ON public.youtube_posts TO authenticated;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        GRANT SELECT ON public.youtube_posts TO anon;
    END IF;
END $$;

-- Kenh YouTube lien ket: account_profile_id = channel_id (UC..., khong doi), account_handle =
-- @handle (doi duoc) — khop kenh dang dang nhap theo 1 trong 2 (luc comment co khi chi doc
-- duoc handle cua tac gia comment). Chi them cot nullable, khong anh huong Facebook/LinkedIn.
ALTER TABLE public.social_accounts ADD COLUMN IF NOT EXISTS account_handle TEXT;

-- Ten "youtube" (chu thuong): social_accounts_service so khop name.strip().lower() == platform.
INSERT INTO public.platforms (name)
SELECT 'youtube'
WHERE NOT EXISTS (SELECT 1 FROM public.platforms WHERE lower(trim(name)) = 'youtube');

NOTIFY pgrst, 'reload schema';
