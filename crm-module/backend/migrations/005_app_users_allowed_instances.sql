-- Danh sach cac workspace (instance) 1 tai khoan non-admin duoc PHEP truy cap
-- - thay the han che "chi dung duoc 1 site" (home_instance, migration 003)
-- bang danh sach NHIEU site do ADMIN chon trong "Quan ly thanh vien".
--
-- home_instance VAN GIU LAI (ghi nhan site dang ky lan dau, dung lam gia tri
-- mac dinh/fallback cho tai khoan tao TRUOC tinh nang nay, chua duoc admin
-- gan allowed_instances lan nao).
--
-- NULL/rong = KHONG gioi han (tai khoan tao truoc tinh nang nay ma chua duoc
-- gan, hoac admin chu dong go het gioi han) - dang nhap duoc moi site, giu
-- nguyen hanh vi cu, tranh khoa nham tai khoan dang dung that.
--
-- An toan chay lai nhieu lan.

ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS allowed_instances TEXT[];

-- Backfill: tai khoan da co home_instance (tu tinh nang khoa 1 site truoc do)
-- -> mac dinh allowed_instances = [home_instance], GIU NGUYEN muc do gioi han
-- hien co (truoc day ho chi vao duoc dung 1 site nay, gio van chi vao duoc
-- dung site do cho toi khi admin chu dong mo them).
UPDATE public.app_users
SET allowed_instances = ARRAY[home_instance]
WHERE home_instance IS NOT NULL AND allowed_instances IS NULL;

NOTIFY pgrst, 'reload schema';
