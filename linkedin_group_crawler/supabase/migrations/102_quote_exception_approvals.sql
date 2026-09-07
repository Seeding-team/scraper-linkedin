-- "Admin duyet ngoai le theo tung version" (Section 5, HTML parity round 3).
-- Truoc migration nay: endpoint POST /quotes/{id}/approve duyet VO DIEU KIEN
-- - khong he kiem tra ket qua quote_rule_evaluations (bang da co tu migration
-- 091), Admin bam Duyet ngay ca khi Rule Engine bao 'fail', KHONG bat buoc ly
-- do, KHONG ghi lai audit rieng cho quyet dinh "duyet du rule khong dat" (chi
-- co 1 dong 'approved' thuong nhu moi lan duyet khac - khong phan biet duoc
-- voi duyet binh thuong luc xem lai lich su).
--
-- Bang nay CHI ghi 1 dong MOI lan Admin duyet ngoai le THAT SU (rule fail/
-- insufficient_data ma van duyet) - duyet binh thuong (rule pass, hoac chua
-- cau hinh rule engine) KHONG ghi gi vao day. quote_id o day CHINH LA id cua
-- dung phien ban (version) dang duyet (kien truc version-chain hien co: moi
-- version la 1 dong `quotes` rieng, KHONG dung chung 1 id) - nen "version moi
-- khong ke thua ngoai le version truoc" tu dong dung, KHONG can logic rieng:
-- version moi la 1 quote_id khac, chua tung co dong nao trong bang nay.
--
-- KHONG apply migration nay len DB that cho toi khi duoc xac nhan rieng
-- (giong quy uoc 087-091 truoc do trong cung phien lam viec).

CREATE TABLE IF NOT EXISTS public.quote_exception_approvals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quote_id UUID NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
    -- Luu lai TUONG MINH version_number (thay vi chi suy tu quotes.version_number
    -- hien tai) - phong truong hop sau nay quote bi sua version_number (khong
    -- nen xay ra, nhung day la snapshot audit, khong phai tham chieu song).
    version_number INT NOT NULL,
    -- Evaluation THAT da khien Admin phai duyet ngoai le (result != 'pass') -
    -- bat buoc co, khong duoc duyet ngoai le neu chua tung danh gia rule nao.
    rule_evaluation_id UUID NOT NULL REFERENCES public.quote_rule_evaluations(id) ON DELETE CASCADE,
    exception_reason TEXT NOT NULL,
    approved_by UUID REFERENCES public.app_users(id),
    approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT quote_exception_approvals_reason_not_blank
        CHECK (length(trim(exception_reason)) > 0)
);

CREATE INDEX IF NOT EXISTS quote_exception_approvals_quote_id_idx
    ON public.quote_exception_approvals (quote_id, approved_at DESC);
