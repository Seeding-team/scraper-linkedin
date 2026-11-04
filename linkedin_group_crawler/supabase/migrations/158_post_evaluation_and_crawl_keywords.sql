-- Tinh nang "Review nhanh" (danh gia bai cao) va "Quet/loai tru tu khoa" cho bai cao
-- tren cac nen tang Facebook, LinkedIn, Threads.
--
-- 1. categories (category_type = 'post_evaluation'): tai dung bang categories da co
--    de luu danh muc trang thai danh gia (phu-hop, khong-phu-hop, can-nhac, chua-danh-gia),
--    tuong thich voi API GET /categories?category_type=post_evaluation va UI hien co.
-- 2. post_quick_review: luu danh gia hien tai cua tung bai viet (1 dong duy nhat tren
--    cap post_id + platform). Cho phep bat co exclude_keyword_exempt de bo qua tu khoa loai tru.
-- 3. post_evaluation_history: bang append-only luu lich su moi lan danh gia / thay doi,
--    kem batch_id de phuc vu thao tac Review Nhanh (batch reject) va Hoan tac (undo).
-- 4. crawl_exclude_keywords: danh sach tu khoa loai tru (active/inactive), ap dung cho
--    1 platform cu the hoac toan bo (platform IS NULL).
-- 5. crawl_keyword_proposals: danh sach de xuat tu khoa tu thanh vien (pending/approved/rejected),
--    giu nguyen ban ghi sau khi duyet hoac tu choi kem audit nguoi duyet va thoi diem duyet.
--
-- Chi THEM bang moi va seed category moi, khong sua xoa bang/du lieu cu — an toan de ap
-- tren DB dung chung dev + production.

-- 1. Seed danh muc trang thai danh gia vao bang categories da co
DO $$
DECLARE
    v_rows CONSTANT jsonb := '[
        {"code": "phu-hop", "name": "Phù hợp", "sort_order": 1, "description": "Bài viết có tiềm năng seeding cao"},
        {"code": "khong-phu-hop", "name": "Không phù hợp", "sort_order": 2, "description": "Bài viết không phù hợp hoặc vi phạm từ khóa"},
        {"code": "can-nhac", "name": "Cân nhắc", "sort_order": 3, "description": "Cần xem xét thêm trước khi quyết định"},
        {"code": "chua-danh-gia", "name": "Chưa đánh giá", "sort_order": 4, "description": "Bài mới cào, chưa được đánh giá"}
    ]'::jsonb;
    v_row jsonb;
BEGIN
    FOR v_row IN SELECT * FROM jsonb_array_elements(v_rows)
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM public.categories
            WHERE category_type = 'post_evaluation' AND code = v_row->>'code'
        ) THEN
            INSERT INTO public.categories (category_type, code, name, description, platform, is_active, sort_order)
            VALUES (
                'post_evaluation',
                v_row->>'code',
                v_row->>'name',
                v_row->>'description',
                'all',
                true,
                (v_row->>'sort_order')::int
            );
        END IF;
    END LOOP;
END $$;

-- 2. Bang post_quick_review
CREATE TABLE IF NOT EXISTS public.post_quick_review (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    evaluation_code TEXT NOT NULL,
    reason TEXT,
    summary TEXT,
    exclude_keyword_exempt BOOLEAN NOT NULL DEFAULT false,
    evaluated_by UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
    evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT post_quick_review_post_platform_key UNIQUE (post_id, platform)
);

CREATE INDEX IF NOT EXISTS idx_post_quick_review_post_platform ON public.post_quick_review (post_id, platform);
CREATE INDEX IF NOT EXISTS idx_post_quick_review_eval_code ON public.post_quick_review (evaluation_code);
CREATE INDEX IF NOT EXISTS idx_post_quick_review_evaluated_by ON public.post_quick_review (evaluated_by);

-- 3. Bang post_evaluation_history (append-only)
CREATE TABLE IF NOT EXISTS public.post_evaluation_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    previous_evaluation_code TEXT,
    evaluation_code TEXT NOT NULL,
    reason TEXT,
    batch_id TEXT,
    action_type TEXT NOT NULL DEFAULT 'manual' CHECK (action_type IN ('manual', 'batch_reject', 'undo')),
    evaluated_by UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_post_eval_hist_post_platform ON public.post_evaluation_history (post_id, platform, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_post_eval_hist_batch_id ON public.post_evaluation_history (batch_id);

-- 4. Bang crawl_exclude_keywords
CREATE TABLE IF NOT EXISTS public.crawl_exclude_keywords (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    keyword TEXT NOT NULL,
    platform TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    created_by UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crawl_exclude_keywords_status ON public.crawl_exclude_keywords (status);
CREATE INDEX IF NOT EXISTS idx_crawl_exclude_keywords_platform ON public.crawl_exclude_keywords (platform);

-- 5. Bang crawl_keyword_proposals
CREATE TABLE IF NOT EXISTS public.crawl_keyword_proposals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    keyword TEXT NOT NULL,
    reason TEXT,
    source_post_id TEXT,
    platform TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    proposed_by UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
    reviewed_by UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crawl_keyword_proposals_status ON public.crawl_keyword_proposals (status);
CREATE INDEX IF NOT EXISTS idx_crawl_keyword_proposals_proposed_by ON public.crawl_keyword_proposals (proposed_by);

-- Row Level Security (RLS)
ALTER TABLE public.post_quick_review ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS post_quick_review_read_all ON public.post_quick_review;
CREATE POLICY post_quick_review_read_all ON public.post_quick_review
    FOR SELECT TO authenticated, anon USING (true);

ALTER TABLE public.post_evaluation_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS post_eval_hist_read_all ON public.post_evaluation_history;
CREATE POLICY post_eval_hist_read_all ON public.post_evaluation_history
    FOR SELECT TO authenticated, anon USING (true);

ALTER TABLE public.crawl_exclude_keywords ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS crawl_exclude_keywords_read_all ON public.crawl_exclude_keywords;
CREATE POLICY crawl_exclude_keywords_read_all ON public.crawl_exclude_keywords
    FOR SELECT TO authenticated, anon USING (true);

ALTER TABLE public.crawl_keyword_proposals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS crawl_keyword_proposals_read_all ON public.crawl_keyword_proposals;
CREATE POLICY crawl_keyword_proposals_read_all ON public.crawl_keyword_proposals
    FOR SELECT TO authenticated, anon USING (true);

-- DB self-host grants
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        GRANT ALL ON public.post_quick_review TO service_role;
        GRANT ALL ON public.post_evaluation_history TO service_role;
        GRANT ALL ON public.crawl_exclude_keywords TO service_role;
        GRANT ALL ON public.crawl_keyword_proposals TO service_role;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        GRANT SELECT ON public.post_quick_review TO authenticated;
        GRANT SELECT ON public.post_evaluation_history TO authenticated;
        GRANT SELECT ON public.crawl_exclude_keywords TO authenticated;
        GRANT SELECT ON public.crawl_keyword_proposals TO authenticated;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        GRANT SELECT ON public.post_quick_review TO anon;
        GRANT SELECT ON public.post_evaluation_history TO anon;
        GRANT SELECT ON public.crawl_exclude_keywords TO anon;
        GRANT SELECT ON public.crawl_keyword_proposals TO anon;
    END IF;
END $$;

NOTIFY pgrst, 'reload schema';

