-- "Đơn vị tính & VAT" - tach thanh master-data THAT (co status/CRUD rieng),
-- thay vi chi la 1 bao cao tong hop tinh tu du lieu san pham nhu truoc
-- (yeu cau ro rang: "tạo một trang quản lý riêng để tìm kiếm, thêm, sửa và
-- ngừng sử dụng. Không chỉ làm trang thống kê số lượng như hiện tại").
--
-- AUDIT THAT DA XAC NHAN TRUOC KHI VIET MIGRATION NAY (khong tu suy dien):
-- service_catalog_items.unit la 1 CHUOI TU DO (khong FK toi bang nao), va
-- default_vat_rate la 1 SO TU DO - CHUA CO bang danh muc dung chung nao ca.
-- Migration nay CHI THEM 2 bang MOI (khong doi/xoa cot nao tren
-- service_catalog_items - "giu nguyen du lieu, API... logic gia dang co"),
-- roi SEED san 2 bang nay bang cac gia tri DANG THAT SU duoc dung tren san
-- pham hien co (khong bia du lieu) de khong lam mat lua chon nao dang co
-- that. service_catalog_items.unit/default_vat_rate VAN la chuoi/so tu do
-- nhu cu (khong doi thanh FK trong lan nay) - 2 bang nay dung de QUAN LY
-- "danh sach goi y chuan" (co the them/sua/ngung su dung tu trang Cau hinh
-- rieng), FE se doi dropdown chon tu danh sach nay thay vi go tu do.

CREATE TABLE IF NOT EXISTS public.service_catalog_units (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.service_catalog_vat_rates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rate NUMERIC NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed tu CHINH cac gia tri dang duoc san pham hien co su dung that (doc tu
-- service_catalog_items) - khong bia them gia tri nao khac. sort_order xep
-- theo tan suat dung (nhieu nhat truoc) cho de nhin luc moi mo trang.
INSERT INTO public.service_catalog_units (name, sort_order)
SELECT trim(unit), ROW_NUMBER() OVER (ORDER BY COUNT(*) DESC) - 1
FROM public.service_catalog_items
WHERE unit IS NOT NULL AND trim(unit) <> ''
GROUP BY trim(unit)
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.service_catalog_vat_rates (rate, sort_order)
SELECT default_vat_rate, ROW_NUMBER() OVER (ORDER BY default_vat_rate) - 1
FROM public.service_catalog_items
WHERE default_vat_rate IS NOT NULL
GROUP BY default_vat_rate
ON CONFLICT (rate) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_service_catalog_units_status ON public.service_catalog_units (status);
CREATE INDEX IF NOT EXISTS idx_service_catalog_vat_rates_status ON public.service_catalog_vat_rates (status);
