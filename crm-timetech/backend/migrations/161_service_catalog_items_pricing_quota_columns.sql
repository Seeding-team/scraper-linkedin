-- Cac cot ma code service catalog (supabase_service_catalog_service.py, commit
-- e618f1c9 "unify add edit bundle flow") da doc/ghi tu truoc nhung KHONG co
-- migration nao trong repo them chung (chi ton tai tren DB production do chay
-- tay) -> DB moi/dev bao PGRST204 "Could not find the 'annual_commit_monthly_price_vnd'
-- column of 'service_catalog_items'". Migration nay bo sung, idempotent.
ALTER TABLE public.service_catalog_items
    ADD COLUMN IF NOT EXISTS customer_visible boolean NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS quote_display_name text,
    ADD COLUMN IF NOT EXISTS quote_description text,
    ADD COLUMN IF NOT EXISTS quote_cta text,
    ADD COLUMN IF NOT EXISTS monthly_price_vnd numeric,
    ADD COLUMN IF NOT EXISTS annual_commit_monthly_price_vnd numeric,
    ADD COLUMN IF NOT EXISTS annual_total_price_vnd numeric,
    ADD COLUMN IF NOT EXISTS max_sale_discount_percent numeric,
    ADD COLUMN IF NOT EXISTS target_gross_margin_percent numeric,
    ADD COLUMN IF NOT EXISTS cost_basis_rule text,
    ADD COLUMN IF NOT EXISTS pricing_policy_exceptions jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS quota_user_count numeric,
    ADD COLUMN IF NOT EXISTS quota_user_label text,
    ADD COLUMN IF NOT EXISTS quota_connected_channels numeric,
    ADD COLUMN IF NOT EXISTS quota_connected_channels_label text,
    ADD COLUMN IF NOT EXISTS quota_messages_per_month numeric,
    ADD COLUMN IF NOT EXISTS quota_messages_per_month_label text,
    ADD COLUMN IF NOT EXISTS quota_ai_data text,
    ADD COLUMN IF NOT EXISTS quota_highlights text,
    ADD COLUMN IF NOT EXISTS quota_extra jsonb NOT NULL DEFAULT '{}'::jsonb;

NOTIFY pgrst, 'reload schema';
