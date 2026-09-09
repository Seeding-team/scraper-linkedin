-- Bo gia MAC DINH (Gia von/Markup/Gia khach) rieng cho danh muc chung
-- (service_catalog_items) - KHONG them cot gia von/markup thang vao bang do
-- (RLS mo USING(true), doc truc tiep duoc qua PostgREST neu them field nhay
-- cam). Tao bang moi rieng, RLS chi cho service_role, dung DUNG pattern da
-- verify that (RLS chan anon) cho price_book_items (migration 106).
--
-- Scope theo issuer_company_id: issuer_company_id = NULL nghia la gia MAC
-- DINH dung chung cho moi cong ty phat hanh - dung DUNG quy uoc "Trung tinh
-- (moi cong ty)" da co san o quote_forms.issuer_company_id (migration 071).
--
-- CHUA apply migration nay len DB dung chung cho toi khi duoc xac nhan rieng.

CREATE TABLE public.service_catalog_item_pricing (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_catalog_item_id UUID NOT NULL REFERENCES public.service_catalog_items(id) ON DELETE CASCADE,
    issuer_company_id UUID REFERENCES public.quote_issuer_companies(id),
    default_cost_price_vnd NUMERIC,
    default_markup_percent NUMERIC,
    default_customer_price_vnd NUMERIC,
    updated_by UUID,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Postgres 15+ (self-host xac nhan dang dung PG15): NULLS NOT DISTINCT
    -- de chi co DUY NHAT 1 dong "mac dinh chung" (issuer_company_id IS
    -- NULL) cho moi san pham, van cho nhieu dong RIENG theo tung issuer.
    UNIQUE NULLS NOT DISTINCT (service_catalog_item_id, issuer_company_id)
);

CREATE INDEX service_catalog_item_pricing_item_id_idx
    ON public.service_catalog_item_pricing (service_catalog_item_id);

ALTER TABLE public.service_catalog_item_pricing ENABLE ROW LEVEL SECURITY;
-- Bat RLS + KHONG tao policy cho anon/authenticated = tu choi mac dinh cho
-- moi role tru service_role (backend FastAPI dung service-role key). Frontend
-- KHONG bao gio goi Supabase truc tiep (da xac nhan tu phien truoc, grep toan
-- bo linkedin-crawler-ui khong co createClient/@supabase/supabase-js).
CREATE POLICY service_catalog_item_pricing_service_role_only
    ON public.service_catalog_item_pricing
    FOR ALL TO service_role USING (true) WITH CHECK (true);
