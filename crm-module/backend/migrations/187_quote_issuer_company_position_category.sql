-- ============================================================
-- Migration 187: "Chuc vu" (job position/title) cho nguoi lien he cua
-- Don vi phat hanh bao gia (quote_issuer_companies).
--
-- Tai su dung dung khuon migration 079 (crm_position_category): FK ->
-- categories.id (category_type='crm_position'), snapshot ten category vao
-- position_label_snapshot server-side (xem resolve_position_category()
-- trong crm_position_service.py, dung chung voi crm_customers/crm_leads/
-- crm_contacts/customer_leads). quote_issuer_companies KHONG co cot
-- "position" text cu nao can mirror - day la truong hoan toan moi, khong
-- anh huong du lieu/read-path hien co.
-- ============================================================

ALTER TABLE public.quote_issuer_companies
    ADD COLUMN IF NOT EXISTS position_category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS position_label_snapshot TEXT;

CREATE INDEX IF NOT EXISTS idx_quote_issuer_companies_position_category_id
    ON public.quote_issuer_companies(position_category_id) WHERE position_category_id IS NOT NULL;

COMMENT ON COLUMN public.quote_issuer_companies.position_category_id IS
    'FK -> categories.id (category_type=crm_position). Chuc vu cua "Nguoi lien he" (contact_name) cua don vi phat hanh - nguoi lien he CHUNG cua phap nhan, khac nguoi lien he tren tung bao gia.';
COMMENT ON COLUMN public.quote_issuer_companies.position_label_snapshot IS
    'Server-derived snapshot cua ten category tai thoi diem luu (khong tin gia tri client gui) - category bi doi ten/ngung dung sau do van hien dung tren ban ghi nay.';
