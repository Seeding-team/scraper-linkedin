-- Migration 131: vendor_import_items thieu 3 cot ma Step 3 Review UI can de
-- luu that "Phi van chuyen"/"Chi phi khac"/"Ngay bao gia" cho tung dong trich
-- xuat (audit xac nhan migration 127 chua co - workflow truoc day chi tinh
-- tam trong pricing hook o frontend roi khong luu duoc gi ca). Confidence da
-- co san (cot `confidence`), vendor/file da co san o batch (vendor_import_batches)
-- nen KHONG lap lai o day.
BEGIN;

ALTER TABLE public.vendor_import_items
    ADD COLUMN IF NOT EXISTS shipping_cost NUMERIC CHECK (shipping_cost >= 0),
    ADD COLUMN IF NOT EXISTS other_cost NUMERIC CHECK (other_cost >= 0),
    ADD COLUMN IF NOT EXISTS quote_date DATE;

COMMIT;
