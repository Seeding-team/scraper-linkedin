-- 164: Lead có MST (mã số thuế) — Lead từ Mua Sắm Công điền MST của chủ đầu tư; khi Convert thì chuyển sang Khách hàng.
ALTER TABLE public.crm_leads ADD COLUMN IF NOT EXISTS tax_code TEXT;
COMMENT ON COLUMN public.crm_leads.tax_code IS 'MST (mã số thuế) của công ty/tổ chức của Lead';
NOTIFY pgrst, 'reload schema';
