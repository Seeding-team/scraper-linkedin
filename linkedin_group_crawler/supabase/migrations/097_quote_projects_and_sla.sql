-- Entity "Du an" THAT (khac 096 - 096 la fix bug cot BYTEA, khong lien
-- quan). Da audit truoc khi viet (khong doan): KHONG co bang
-- projects/project_id/project_code nao trong toan bo migrations/ tu truoc
-- toi gio (chi co duy nhat 1 cot khong lien quan: sales_assets.project_name,
-- text tu do, khong phai entity). An toan de tao bang moi, khong trung.
--
-- Phan cap that: Khach hang (crm_customers) -> Du an (projects, MOI) ->
-- Co hoi CRM (customer_leads, da co) -> Quote Case (quotes.version_chain_id)
-- -> Version (quotes row). 1 Du an co nhieu Co hoi; 1 Co hoi thuoc toi da 1
-- Du an; 1 Quote Case thuoc 1 Du an (qua quotes.project_id, co the NULL de
-- tuong thich du lieu cu).
--
-- Cung migration nay: them 3 field SLA that cho quotes (sla_started_at,
-- sla_due_at, completed_at) - TACH BIET hoan toan voi valid_until (hieu luc
-- bao gia voi KHACH HANG, khong phai han xu ly NOI BO).
--
-- CHUA apply migration nay len DB that cho toi khi duoc xac nhan rieng.

CREATE TABLE IF NOT EXISTS public.projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_code TEXT NOT NULL,
    name TEXT NOT NULL,
    -- Du an luon thuoc DUNG 1 khach hang - "Khong cho chon Project thuoc
    -- khach hang khac" o tang ung dung dua vao cot nay.
    customer_id UUID NOT NULL REFERENCES public.crm_customers(id) ON DELETE RESTRICT,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    manager_id UUID REFERENCES public.app_users(id),
    team_id UUID REFERENCES public.teams(id),
    created_by UUID REFERENCES public.app_users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT projects_status_check CHECK (status IN ('planning', 'active', 'completed', 'cancelled'))
);

CREATE UNIQUE INDEX IF NOT EXISTS projects_project_code_unique ON public.projects (project_code);
CREATE INDEX IF NOT EXISTS projects_customer_id_idx ON public.projects (customer_id);

-- 1 Co hoi CRM thuoc toi da 1 Du an (nullable = tuong thich Co hoi cu chua
-- gan Du an nao, KHONG bat buoc backfill).
ALTER TABLE public.customer_leads
    ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS customer_leads_project_id_idx ON public.customer_leads (project_id);

-- 1 Quote Case thuoc 1 Du an (nullable = tuong thich bao gia cu, hoac bao
-- gia doc lap khong gan Du an).
ALTER TABLE public.quotes
    ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS quotes_project_id_idx ON public.quotes (project_id);

-- SLA noi bo THAT - khac han valid_until (hieu luc bao gia VOI KHACH HANG,
-- da co tu 028_quote_forms_and_quotes.sql). 3 field nay mo ta han XU LY NOI
-- BO, tinh trang thai SLA (dung han/sap den han/qua han) suy realtime o
-- Python tu 3 field nay, KHONG luu text trang thai (tranh lech du lieu).
ALTER TABLE public.quotes
    ADD COLUMN IF NOT EXISTS sla_started_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS sla_due_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
