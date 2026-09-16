-- Cho phep Admin gan 1 tai khoan (app_users) truy cap NHIEU workspace/clone
-- CRM (markee/cloudgate/SECURITYZONE) thay vi chi 1 site co dinh. Cot nay da
-- duoc tao truoc do tren cung 1 Postgres self-host dung chung giua Main va 3
-- clone (xem migration 005_app_users_allowed_instances.sql trong tung clone
-- crm-module/crm-cloudgate/crm-securityzone) - migration nay chi de dong bo
-- lai vao lich su migration cua Main (source of truth), IF NOT EXISTS nen
-- chay lai an toan, khong doi du lieu da co.
--
-- Main KHONG dung cot nay de tu switch workspace (Main la CRM markee co
-- dinh, khong co workspace switcher) - chi dung o man "Quan ly thanh vien"
-- de Admin cap quyen cho tai khoan duoc dang nhap vao cac clone khac.

ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS allowed_instances TEXT[];

NOTIFY pgrst, 'reload schema';
