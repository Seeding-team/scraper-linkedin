BEGIN;
-- "VAT giá vốn" (2026-10-13) - rieng biet voi default_vat_rate (VAT ban ra,
-- ap cho Gia khach khi dong duoc them vao bao gia) - cot nay la VAT dau vao
-- (mua hang tu NCC), dung de Markup/Margin/Loi nhuan gop tinh TREN GIA VON DA
-- GOM VAT nay thay vi gia von thuan NCC. NULLABLE, mac dinh NULL - san pham cu
-- hoan toan khong bi anh huong (coi nhu 0%, gia von giu nguyen y het truoc gio).
-- Day la 1 COT DON GIAN tren chinh service_catalog_items, KHONG di qua bo may
-- tinh gia (service_catalog_item_pricing/upsert_service_catalog_item_pricing)
-- de tranh dung vao logic resolve 3 gia (cost/markup/customer) da co san -
-- VAT nay CHI duoc nhan vao luc 1 san pham duoc THEM VAO 1 bao gia cu the
-- (xem catalogItemToQuoteItem(), QuoteWorkspaceModal.tsx), gia von tren chinh
-- danh muc (default_cost_price_vnd) khong doi y nghia.
ALTER TABLE public.service_catalog_items ADD COLUMN IF NOT EXISTS default_cost_vat_rate NUMERIC DEFAULT NULL;
COMMENT ON COLUMN public.service_catalog_items.default_cost_vat_rate IS 'VAT dau vao (%) cho Gia von cua san pham - KHAC default_vat_rate (VAT dau ra ap cho Gia khach). NULL/0 = gia von khong gom VAT (hanh vi cu). Khi them san pham vao bao gia, Gia von cua dong bao gia = default_cost_price_vnd x (1 + default_cost_vat_rate/100).';
COMMIT;
NOTIFY pgrst, 'reload schema';
