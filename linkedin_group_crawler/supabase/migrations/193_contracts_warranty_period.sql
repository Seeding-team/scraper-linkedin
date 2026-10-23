-- 192: "Thoi gian bao hanh" tren hop dong (yeu cau sep 2026-10-23) - chu TU DO
-- (vd "12 thang", "24 thang theo hang"), giong het pattern warranty_scope tren
-- quote_items (migration 141) - khong ep so/ngay.
ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS warranty_period TEXT;
