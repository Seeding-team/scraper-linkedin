-- Migration 132: vendor_import_batches/vendor_import_items thieu cot luu
-- "Nhom san pham" - audit xac nhan (migration 127/131 khong co) can thiet de
-- lam dung yeu cau: (1) "Nhom san pham mac dinh" chon o Step 1 ap dung cho
-- moi SKU MOI, (2) tung item duoc override rieng + phai ton tai qua F5
-- (khong the lam "chi frontend state" vi F5 = tai lai tu server that su).
-- Hien tai _resolve_vendor_import_group_id() trong vendor_imports.py luon
-- gan CUNG 1 nhom mac dinh cung/tu dong tao cho MOI SKU moi khi Approve
-- Product Catalog - khong theo y nguoi dung chon o Step 1/Step 3 (bug that,
-- se sua o buoc code tiep theo dung cot nay).
BEGIN;

ALTER TABLE public.vendor_import_batches
    ADD COLUMN IF NOT EXISTS default_group_id UUID REFERENCES public.service_catalog_items(id) ON DELETE SET NULL;

ALTER TABLE public.vendor_import_items
    ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES public.service_catalog_items(id) ON DELETE SET NULL;

COMMIT;
