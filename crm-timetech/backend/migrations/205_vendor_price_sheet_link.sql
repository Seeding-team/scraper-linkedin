-- Link Google Sheet bang gia theo Vendor (dong bo gia lap lai)
ALTER TABLE public.crm_vendors
    ADD COLUMN IF NOT EXISTS price_sheet_url TEXT,
    ADD COLUMN IF NOT EXISTS price_sheet_last_synced_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS price_sheet_last_batch_id UUID;
