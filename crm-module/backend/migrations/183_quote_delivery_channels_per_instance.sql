-- 183: Tach cau hinh kenh gui email (SMTP/IMAP) THEO WORKSPACE (instance).
--
-- NGUYEN NHAN: 092 tao unique(channel_type) (khong co instance) va code chi loc channel_type => markee / cloudgate / securityzone
-- (dung chung 1 DB) cung doc-ghi-gui bang MOT cau hinh email duy nhat.
--
-- XAC MINH TRUOC KHI AP (doc-chi, 2026-10-09): bang co dung 1 dong, sender_address=admin@markee.vn, sender_name=MARKEE, SMTP/IMAP ok
-- => dong nay thuoc workspace 'markee'. Cloudgate/SecurityZone CHUA co cau hinh rieng => sau migration o trang thai "Chua ket noi".
-- KHONG sao chep App Password sang workspace khac. KHONG doi encrypted_app_password / key ma hoa hien co.
--
-- DRY-RUN (chay truoc, khong ghi gi):
--   select id, channel_type, sender_address, sender_name, is_enabled from public.quote_delivery_channels;      -- ky vong 1 dong markee
--   select count(*) from public.quote_delivery_channel_audit_log;                                              -- so dong audit se gan 'markee'
--   select indexname from pg_indexes where tablename = 'quote_delivery_channels';                              -- ky vong co quote_delivery_channels_type_unique
-- ROLLBACK (docs/EMAIL_PER_INSTANCE_2026-10-10.md): drop unique(instance, channel_type), tao lai unique(channel_type) (chi khi con <= 1 dong/channel_type),
--   roi (tuy chon) drop cot instance. Code tuong thich ca truoc/sau migration.
-- Idempotent: chay lai khong gay loi.

ALTER TABLE public.quote_delivery_channels ADD COLUMN IF NOT EXISTS instance TEXT;
UPDATE public.quote_delivery_channels SET instance = 'markee' WHERE instance IS NULL;   -- dong hien co = Markee (da xac minh o tren)

DROP INDEX IF EXISTS public.quote_delivery_channels_type_unique;
CREATE UNIQUE INDEX IF NOT EXISTS quote_delivery_channels_instance_type_unique
    ON public.quote_delivery_channels (instance, channel_type);

ALTER TABLE public.quote_delivery_channel_audit_log ADD COLUMN IF NOT EXISTS instance TEXT;
UPDATE public.quote_delivery_channel_audit_log SET instance = 'markee' WHERE instance IS NULL;
CREATE INDEX IF NOT EXISTS quote_delivery_channel_audit_instance_idx
    ON public.quote_delivery_channel_audit_log (instance, channel_type, created_at DESC);
