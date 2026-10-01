-- Yeu cau 2026-10-02: (1) them "need_category" vao ket qua cham diem LLM de chon dung mau
-- comment theo nhu cau (website/app/landing page...), (2) bang rieng cho comment seeding
-- TU DONG trigger sau khi acc he thong cao xoay vong Facebook ra bai diem cao (KHONG dung
-- chung scheduled_comments vi bang do co 1 job server-side rieng (scheduled_comment_job.py)
-- dung Playwright + stored password, cham giua voi flow extension moi va se FAIL do khong
-- co id_social_account hop le), (3) bang registry tu khoa/chu de Threads tu dong kham pha.

ALTER TABLE facebook_posts ADD COLUMN IF NOT EXISTS lead_need_category text;
ALTER TABLE linkedin_posts ADD COLUMN IF NOT EXISTS lead_need_category text;
ALTER TABLE threads_posts ADD COLUMN IF NOT EXISTS lead_need_category text;

-- Comment seeding TU DONG (chi Facebook, bai diem cao) - tach rieng khoi scheduled_comments
-- de khong bi job legacy (scheduled_comment_job.py, Playwright + stored password) claim nham.
CREATE TABLE IF NOT EXISTS auto_seeding_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    id_post_fb UUID REFERENCES facebook_posts(id) ON DELETE CASCADE,
    post_url TEXT NOT NULL,
    group_name TEXT,
    id_member UUID REFERENCES app_users(id),
    comment_content TEXT NOT NULL,
    lead_score INTEGER,
    need_category TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'posted', 'failed')),
    error_message TEXT,
    link_comment TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    posted_at TIMESTAMPTZ,
    UNIQUE (id_post_fb)
);
CREATE INDEX IF NOT EXISTS idx_asc_status ON auto_seeding_comments(status) WHERE status = 'pending';

-- Registry tu khoa/chu de Threads - tu kham pha + luu lai tu khoa/chu de nao ra nhieu bai
-- diem cao, dung lai hang ngay, moi ngay them ~5 cai moi, toi da 50, vuot thi loai bo tu
-- khoa/chu de kem hieu qua nhat.
CREATE TABLE IF NOT EXISTS threads_keyword_registry (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    keyword TEXT NOT NULL UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT true,
    times_used INTEGER NOT NULL DEFAULT 0,
    total_posts_found INTEGER NOT NULL DEFAULT 0,
    high_score_posts INTEGER NOT NULL DEFAULT 0,
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tkr_active ON threads_keyword_registry(is_active);
