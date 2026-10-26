-- 176: Theo doi field san pham da bi nguoi dung CRM sua thu cong (manual edit),
-- de dong bo MSC khong ghi de len gia tri nguoi dung da chinh (xem task
-- "Extend existing MSC product synchronization" §7).
--
-- Nguyen tac:
-- - Chi tinh don gian, khong huy hoai du lieu cu (additive, non-destructive).
-- - Cac field nam trong scope dong bo: name, brand (Hang), part_number (Model),
--   parent_id (Nhom hang). Nguoi dung sua field nao THUC SU khac gia tri cu
--   qua PUT /service-catalog/update (edit form) thi field do duoc danh dau
--   trong sync_manual_fields → lan dong bo MSC sau do se GIU NGUYEN field do
--   (khong ghi de tu MSC). Field chua danh dau van tiep tuc dong bo binh thuong.
-- - Bang chua co RLS policy rieng cho cot nay; cot doc qua service role
--   (cach app tuong tac DB) nen khong anh huong quyen truy cap hien tai.

ALTER TABLE public.service_catalog_items
    ADD COLUMN IF NOT EXISTS sync_manual_fields TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.service_catalog_items.sync_manual_fields IS
    'Cac field dong bo (brand, part_number, parent_id) nguoi dung CRM da sua thu cong - MSC sync khong ghi de cac field nay';
