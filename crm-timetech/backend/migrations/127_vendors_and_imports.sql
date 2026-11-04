-- =================================================================================
-- Migration 127: Vendors, Import Batches, and Service Catalog Pricing
-- Phase 1 of End-to-End Vendor Import implementation (FINAL).
-- =================================================================================
-- REUSE:
--  - `price_books` (Migration 106) for "Cost Price Book" target scope.
--  - `crm-attachments` bucket (storage) for uploaded vendor files.
--
-- NEW TABLES:
--  - `crm_vendors` (Master data, NO tenant isolation, shared across instances)
--  - `vendor_import_batches` (Tenant-isolated via `instance` column)
--  - `vendor_import_items` (Tenant-isolated implicitly via `batch_id`)
--
-- ALTER TABLES:
--  - `service_catalog_items` (Add master fields)
--  - `service_catalog_item_pricing` (Add detailed supplier costing fields)
--
-- TENANT STRATEGY NOTE (CRITICAL):
--  RLS uses `service_role USING (true)` for all new tables.
--  The backend API MUST enforce tenant isolation manually for all endpoints
--  by appending `.eq("instance", settings.crm_instance)` for batches and
--  joining with batches for items. Never query by ID blindly.
-- =================================================================================

BEGIN;

-- 1. Vendors Master Data (Global, No Tenant Scope)
CREATE TABLE IF NOT EXISTS public.crm_vendors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT,
    name TEXT NOT NULL,
    short_name TEXT,
    tax_code TEXT,
    email TEXT,
    phone TEXT,
    address TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID,
    updated_by UUID
);

-- Unique index for Vendor Code (case-insensitive)
CREATE UNIQUE INDEX IF NOT EXISTS crm_vendors_code_idx
    ON public.crm_vendors (lower(code)) WHERE code IS NOT NULL;
CREATE INDEX IF NOT EXISTS crm_vendors_status_idx ON public.crm_vendors (status);

ALTER TABLE public.crm_vendors ENABLE ROW LEVEL SECURITY;
CREATE POLICY crm_vendors_service_role_only
    ON public.crm_vendors
    FOR ALL TO service_role USING (true) WITH CHECK (true);


-- 2. Enhance Service Catalog Items and Pricing (Non-Destructive)
ALTER TABLE public.service_catalog_items
    ADD COLUMN IF NOT EXISTS brand TEXT,
    ADD COLUMN IF NOT EXISTS part_number TEXT,
    ADD COLUMN IF NOT EXISTS product_type TEXT,
    ADD COLUMN IF NOT EXISTS internal_note TEXT;

ALTER TABLE public.service_catalog_item_pricing
    ADD COLUMN IF NOT EXISTS supplier_currency TEXT DEFAULT 'VND' CHECK (supplier_currency = upper(supplier_currency)),
    ADD COLUMN IF NOT EXISTS supplier_list_price NUMERIC CHECK (supplier_list_price >= 0),
    ADD COLUMN IF NOT EXISTS supplier_discount_percent NUMERIC CHECK (supplier_discount_percent >= 0 AND supplier_discount_percent <= 100),
    ADD COLUMN IF NOT EXISTS supplier_net_price NUMERIC CHECK (supplier_net_price >= 0),
    ADD COLUMN IF NOT EXISTS supplier_exchange_rate NUMERIC CHECK (supplier_exchange_rate > 0),
    ADD COLUMN IF NOT EXISTS supplier_converted_price NUMERIC CHECK (supplier_converted_price >= 0),
    ADD COLUMN IF NOT EXISTS supplier_vendor_id UUID REFERENCES public.crm_vendors(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS supplier_quote_ref TEXT,
    ADD COLUMN IF NOT EXISTS supplier_quote_date DATE,
    ADD COLUMN IF NOT EXISTS supplier_valid_until DATE,
    ADD COLUMN IF NOT EXISTS shipping_cost NUMERIC CHECK (shipping_cost >= 0),
    ADD COLUMN IF NOT EXISTS import_fee NUMERIC CHECK (import_fee >= 0),
    ADD COLUMN IF NOT EXISTS other_cost NUMERIC CHECK (other_cost >= 0),
    ADD COLUMN IF NOT EXISTS pricing_input_mode TEXT,
    ADD COLUMN IF NOT EXISTS pricing_policy TEXT;


-- 3. Vendor Import Batches (Tenant-Scoped)
CREATE TABLE IF NOT EXISTS public.vendor_import_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    instance TEXT NOT NULL, -- Backend API MUST filter by settings.crm_instance
    vendor_id UUID NOT NULL REFERENCES public.crm_vendors(id),
    project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
    exchange_rate NUMERIC NOT NULL DEFAULT 1 CHECK (exchange_rate > 0),
    target_scope TEXT NOT NULL CHECK (target_scope IN ('project_only', 'cost_price_book', 'product_catalog')),
    source_file_path TEXT NOT NULL,
    source_file_name TEXT NOT NULL,
    source_file_size BIGINT CHECK (source_file_size >= 0),
    source_file_type TEXT,
    source_file_pages INT CHECK (source_file_pages >= 0),
    status TEXT NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'extracting', 'review', 'approved', 'failed')),
    error_message TEXT,
    extraction_started_at TIMESTAMPTZ,
    extraction_completed_at TIMESTAMPTZ,
    extraction_meta JSONB,
    created_by UUID,
    approved_by UUID,
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vendor_import_batches_instance_created_idx
    ON public.vendor_import_batches(instance, created_at DESC);
CREATE INDEX IF NOT EXISTS vendor_import_batches_vendor_id_idx
    ON public.vendor_import_batches(vendor_id);

ALTER TABLE public.vendor_import_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY vendor_import_batches_service_role_only
    ON public.vendor_import_batches
    FOR ALL TO service_role USING (true) WITH CHECK (true);


-- 4. Vendor Import Items (Review Rows)
CREATE TABLE IF NOT EXISTS public.vendor_import_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NOT NULL REFERENCES public.vendor_import_batches(id) ON DELETE CASCADE,
    matched_catalog_item_id UUID REFERENCES public.service_catalog_items(id) ON DELETE SET NULL,
    sku TEXT,
    name TEXT NOT NULL,
    description TEXT,
    quantity NUMERIC,
    uom TEXT,
    brand TEXT,
    currency TEXT DEFAULT 'VND' CHECK (currency = upper(currency)),
    list_price NUMERIC CHECK (list_price >= 0),
    discount_percent NUMERIC CHECK (discount_percent >= 0 AND discount_percent <= 100),
    net_price NUMERIC CHECK (net_price >= 0),
    vat_rate NUMERIC CHECK (vat_rate >= 0 AND vat_rate <= 100),
    confidence NUMERIC CHECK (confidence >= 0),
    warnings JSONB,
    raw_extraction JSONB,
    normalized_json JSONB,
    review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending', 'mapped', 'new', 'ignored')),
    mapping_action TEXT CHECK (mapping_action IN ('existing', 'new', 'ignored')),
    reviewed_by UUID,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vendor_import_items_batch_idx ON public.vendor_import_items(batch_id);

ALTER TABLE public.vendor_import_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY vendor_import_items_service_role_only
    ON public.vendor_import_items
    FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMIT;
