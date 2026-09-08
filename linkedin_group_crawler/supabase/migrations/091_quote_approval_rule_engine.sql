-- Rule engine THAT cho duyet bao gia (thay the nguong tinh "margin >= 20%"
-- hard-code o frontend, xem comment cu o QuoteWorkspaceModal.tsx: "Chi 1
-- nguong tinh, chua phai rule engine tu dong chan/tu duyet that"). Rule set
-- cau hinh o DB theo account, khong hard-code rieng frontend - danh gia tinh
-- o backend (Python), luu lai KET QUA (khong luu lai boolean tinh tay o FE).
--
-- KHONG apply migration nay len DB that cho toi khi duoc xac nhan rieng
-- (giong toan bo migration 087-090 truoc do trong phien lam viec nay).

-- LUU Y: he thong nay KHONG co bang `accounts`/multi-tenant that (da grep
-- toan bo migrations/ - khong co bang nao ten accounts, cac cau hinh nhu
-- quote_issuer_companies (069) deu la 1 danh sach GLOBAL dung chung cho toan
-- cong ty). Vi vay rule-set o day CUNG la GLOBAL (khong co cot account_id) -
-- KHAC voi de xuat goc "account_id" vi field/bang do khong ton tai that
-- trong schema hien co, khong bia ra de tranh FK tro toi bang khong ton tai.
CREATE TABLE IF NOT EXISTS public.quote_approval_rule_sets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    version INT NOT NULL DEFAULT 1,
    is_active BOOLEAN NOT NULL DEFAULT true,
    -- Mac dinh AN TOAN: OFF. Chi Admin duoc bat (kiem o tang Python, khong
    -- kiem o day) - "dat du 4/4 rule" KHONG tu dong nghia la tu duyet neu co
    -- nay van false.
    auto_approve_enabled BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES public.app_users(id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by UUID REFERENCES public.app_users(id)
);

-- Chi 1 rule-set active tai 1 thoi diem (danh gia luon dung ro rang rule-set
-- nao, khong doan "rule-set active gan nhat"). Dung index tren 1 bieu thuc
-- hang so (thay vi tren 1 cot) de PostgreSQL cho phep UNIQUE INDEX ... WHERE
-- is_active hoat dong nhu 1 "chi 1 dong active" that su cho toan bang.
CREATE UNIQUE INDEX IF NOT EXISTS quote_approval_rule_sets_one_active
    ON public.quote_approval_rule_sets ((1)) WHERE is_active;

CREATE TABLE IF NOT EXISTS public.quote_approval_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_set_id UUID NOT NULL REFERENCES public.quote_approval_rule_sets(id) ON DELETE CASCADE,
    -- rule_type: 'gross_margin_percent' | 'gross_profit_amount' |
    -- 'discount_percent' | 'payment_terms_days' - danh sach dong, service
    -- Python chi biet tinh cho cac type da implement, type la nhung khong co
    -- evaluator tuong ung -> ket qua 'insufficient_data' (khong crash, khong
    -- gia dinh Pass).
    rule_type TEXT NOT NULL,
    -- operator: 'gte' | 'lte' | 'gt' | 'lt' | 'eq'
    operator TEXT NOT NULL,
    threshold_value NUMERIC NOT NULL,
    unit TEXT NOT NULL DEFAULT 'percent', -- 'percent' | 'vnd' | 'days'
    is_required BOOLEAN NOT NULL DEFAULT true,
    display_order INT NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT quote_approval_rules_operator_check
        CHECK (operator IN ('gte', 'lte', 'gt', 'lt', 'eq'))
);

CREATE TABLE IF NOT EXISTS public.quote_rule_evaluations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quote_id UUID NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
    quote_version INT,
    rule_set_id UUID NOT NULL REFERENCES public.quote_approval_rule_sets(id),
    rule_set_version INT NOT NULL,
    -- result: 'pass' | 'fail' | 'insufficient_data'
    result TEXT NOT NULL,
    -- evaluation_details: mang JSON, moi phan tu = 1 rule (ten, gia tri that,
    -- nguong, pass/fail, ly do) - xem rule_evaluation_service.py cho shape
    -- chinh xac. Luu lai DE CO AUDIT TRAIL that (khong chi tinh luot roi bo).
    evaluation_details JSONB NOT NULL,
    evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- NULL = danh gia tu dong boi he thong (vd truoc khi auto-approve), co
    -- gia tri = actor nguoi that (vd bam nut "Duyet" thu cong, van chay qua
    -- rule engine de hien thi ket qua ngay ca khi khong auto-approve).
    evaluated_by UUID REFERENCES public.app_users(id),
    is_system_actor BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS quote_rule_evaluations_quote_id_idx ON public.quote_rule_evaluations (quote_id, evaluated_at DESC);

-- Rule set mac dinh bam sat HTML mau (4 rule): gross margin >= 20%, loi
-- nhuan gop >= 5.000.000d, chiet khau <= 10%, thanh toan <= 45 ngay.
-- auto_approve_enabled=false mac dinh (dung yeu cau "khong tu bat auto
-- approve tren production").
--
-- INSERT INTO public.quote_approval_rule_sets (name, version, is_active, auto_approve_enabled)
--   VALUES ('Bo quy tac duyet bao gia mac dinh', 1, true, false)
--   RETURNING id; -- roi dung id nay cho 4 INSERT rule ben duoi
--
-- INSERT INTO public.quote_approval_rules (rule_set_id, rule_type, operator, threshold_value, unit, is_required, display_order) VALUES
--   ('<rule_set_id>', 'gross_margin_percent', 'gte', 20, 'percent', true, 1),
--   ('<rule_set_id>', 'gross_profit_amount', 'gte', 5000000, 'vnd', true, 2),
--   ('<rule_set_id>', 'discount_percent', 'lte', 10, 'percent', true, 3),
--   ('<rule_set_id>', 'payment_terms_days', 'lte', 45, 'days', true, 4);
