-- Tinh nang "Review nhanh" (danh gia bai cao), "Ket qua lien he" (call result)
-- va "Quet/loai tru tu khoa" cho bai cao tren cac nen tang Facebook, LinkedIn, Threads.
--
-- 1. categories (category_type = 'post_evaluation'):
--    Chi dung 3 ma: chua-danh-gia ("Chua danh gia"), can-lien-he ("Can lien he"),
--    khong-phu-hop ("Chua phu hop (Bo qua)"). Deactivate cac ma can-nhac/can-xem-xet/phu-hop neu da co.
-- 2. categories (category_type = 'call_result'):
--    Seed 8 ma ket qua lien he tuong ung CALL_RESULT_OPTIONS:
--    noanswer, callback, consulting, waiting, interested, refused, nointerest, invalid.
-- 3. post_quick_review: luu danh gia hien tai cua tung bai viet (1 dong duy nhat tren
--    cap post_id + platform). Cho phep bat co exclude_keyword_exempt de bo qua tu khoa loai tru.
-- 4. post_evaluation_history: bang append-only luu lich su moi lan danh gia / thay doi,
--    kem batch_id de phuc vu thao tac Review Nhanh (batch reject) va Hoan tac (undo).
-- 5. post_call_results: luu ket qua lien he, so lan goi va thoi diem goi gan nhat cho tung bai viet.
-- 6. crawl_exclude_keywords: danh sach tu khoa loai tru (active/inactive), ap dung cho
--    1 platform cu the hoac toan bo (platform IS NULL).
-- 7. crawl_keyword_proposals: danh sach de xuat tu khoa tu thanh vien (pending/approved/rejected),
--    giu nguyen ban ghi sau khi duyet hoac tu choi kem audit nguoi duyet va thoi diem duyet.

-- 1. Seed danh muc post_evaluation (dung 3 ma chuan) vao bang categories
DO $$
DECLARE
    v_rows CONSTANT jsonb := '[
        {"code": "chua-danh-gia", "name": "Chưa đánh giá", "sort_order": 1, "description": "Bài mới cào, chưa được đánh giá"},
        {"code": "can-lien-he", "name": "Cần liên hệ", "sort_order": 2, "description": "Bài viết có tiềm năng cao, cần liên hệ ngay"},
        {"code": "khong-phu-hop", "name": "Chưa phù hợp (Bỏ qua)", "sort_order": 3, "description": "Bài viết không phù hợp hoặc vi phạm từ khóa loại trừ"}
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
        ELSE
            -- Neu da ton tai thi dam bao bat active va cap nhat ten chuan
            UPDATE public.categories
            SET name = v_row->>'name',
                description = v_row->>'description',
                is_active = true,
                sort_order = (v_row->>'sort_order')::int
            WHERE category_type = 'post_evaluation' AND code = v_row->>'code';
        END IF;
    END LOOP;

    -- Deactivate cac ma cu/khong con dung (can-nhac, can-xem-xet, phu-hop)
    UPDATE public.categories
    SET is_active = false
    WHERE category_type = 'post_evaluation'
      AND code IN ('can-nhac', 'can-xem-xet', 'can_xem_xet', 'phu-hop', 'phu_hop');
END $$;

-- 2. Seed danh muc call_result (8 ma chuan tuong ung CALL_RESULT_OPTIONS)
DO $$
DECLARE
    v_call_rows CONSTANT jsonb := '[
        {"code": "noanswer", "name": "Đã gọi – không nghe máy", "sort_order": 1, "description": "Đã gọi điện nhưng khách hàng không nghe máy"},
        {"code": "callback", "name": "Hẹn gọi lại", "sort_order": 2, "description": "Khách hàng bận, hẹn gọi lại sau"},
        {"code": "consulting", "name": "Đang tư vấn", "sort_order": 3, "description": "Đang trong quá trình trao đổi và tư vấn giải pháp"},
        {"code": "waiting", "name": "Chờ phản hồi", "sort_order": 4, "description": "Đã gửi thông tin/báo giá, đang chờ phản hồi"},
        {"code": "interested", "name": "Có nhu cầu", "sort_order": 5, "description": "Khách hàng có nhu cầu sử dụng dịch vụ"},
        {"code": "refused", "name": "Đã từ chối", "sort_order": 6, "description": "Khách hàng đã trực tiếp từ chối"},
        {"code": "nointerest", "name": "Không có nhu cầu", "sort_order": 7, "description": "Khách hàng xác nhận không có nhu cầu"},
        {"code": "invalid", "name": "Không phù hợp", "sort_order": 8, "description": "Thông tin sai lệch hoặc không phù hợp đối tượng"}
    ]'::jsonb;
    v_row jsonb;
BEGIN
    FOR v_row IN SELECT * FROM jsonb_array_elements(v_call_rows)
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM public.categories
            WHERE category_type = 'call_result' AND code = v_row->>'code'
        ) THEN
            INSERT INTO public.categories (category_type, code, name, description, platform, is_active, sort_order)
            VALUES (
                'call_result',
                v_row->>'code',
                v_row->>'name',
                v_row->>'description',
                'all',
                true,
                (v_row->>'sort_order')::int
            );
        ELSE
            UPDATE public.categories
            SET name = v_row->>'name',
                description = v_row->>'description',
                is_active = true,
                sort_order = (v_row->>'sort_order')::int
            WHERE category_type = 'call_result' AND code = v_row->>'code';
        END IF;
    END LOOP;
END $$;

-- 3. Bang post_quick_review
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

-- 4. Bang post_evaluation_history (append-only)
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

-- 5. Bang post_call_results (luu ket qua lien he, attempts, last_call_at)
CREATE TABLE IF NOT EXISTS public.post_call_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    result_code TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_call_at TIMESTAMPTZ,
    updated_by UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT post_call_results_post_platform_key UNIQUE (post_id, platform)
);

CREATE INDEX IF NOT EXISTS idx_post_call_results_post_platform ON public.post_call_results (post_id, platform);
CREATE INDEX IF NOT EXISTS idx_post_call_results_result_code ON public.post_call_results (result_code);
CREATE INDEX IF NOT EXISTS idx_post_call_results_updated_by ON public.post_call_results (updated_by);

-- 6. Bang crawl_exclude_keywords
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

-- 7. Bang crawl_keyword_proposals
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

ALTER TABLE public.post_call_results ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS post_call_results_read_all ON public.post_call_results;
CREATE POLICY post_call_results_read_all ON public.post_call_results
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
        GRANT ALL ON public.post_call_results TO service_role;
        GRANT ALL ON public.crawl_exclude_keywords TO service_role;
        GRANT ALL ON public.crawl_keyword_proposals TO service_role;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        GRANT SELECT ON public.post_quick_review TO authenticated;
        GRANT SELECT ON public.post_evaluation_history TO authenticated;
        GRANT SELECT ON public.post_call_results TO authenticated;
        GRANT SELECT ON public.crawl_exclude_keywords TO authenticated;
        GRANT SELECT ON public.crawl_keyword_proposals TO authenticated;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        GRANT SELECT ON public.post_quick_review TO anon;
        GRANT SELECT ON public.post_evaluation_history TO anon;
        GRANT SELECT ON public.post_call_results TO anon;
        GRANT SELECT ON public.crawl_exclude_keywords TO anon;
        GRANT SELECT ON public.crawl_keyword_proposals TO anon;
    END IF;
END $$;

NOTIFY pgrst, 'reload schema';
