BEGIN;

ALTER TABLE public.service_catalog_item_pricing
    ADD COLUMN IF NOT EXISTS supplier_quote_source TEXT;

COMMIT;
