-- 172: PVCC (phạm vi cung cấp) từ Mua Sắm Công gắn với Lead / Cơ hội CRM.
-- Presale nhập PVCC ở MSC (Presale Review); khi gói Tham gia / Trúng thầu, MSC đồng bộ sang đây để CRM dùng lại (không gõ lại).
CREATE TABLE IF NOT EXISTS public.crm_scope_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    instance TEXT NOT NULL DEFAULT 'markee',
    lead_id UUID REFERENCES public.crm_leads(id) ON DELETE CASCADE,
    deal_id UUID REFERENCES public.customer_leads(id) ON DELETE CASCADE,
    project_id UUID,
    source TEXT NOT NULL DEFAULT 'msc',
    source_ref TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    group_name TEXT,
    brand_name TEXT,
    product TEXT,
    sku TEXT,
    requirement TEXT,
    scope TEXT,
    unit TEXT,
    quantity NUMERIC NOT NULL DEFAULT 1,
    license TEXT,
    brand_requirement TEXT,
    status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('defined', 'clarify', 'new')),
    note TEXT,
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT crm_scope_items_target_chk CHECK (lead_id IS NOT NULL OR deal_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_crm_scope_items_lead ON public.crm_scope_items (instance, lead_id);
CREATE INDEX IF NOT EXISTS idx_crm_scope_items_deal ON public.crm_scope_items (instance, deal_id);
CREATE INDEX IF NOT EXISTS idx_crm_scope_items_ref ON public.crm_scope_items (instance, source, source_ref);
ALTER TABLE public.crm_scope_items ENABLE ROW LEVEL SECURITY;
NOTIFY pgrst, 'reload schema';
