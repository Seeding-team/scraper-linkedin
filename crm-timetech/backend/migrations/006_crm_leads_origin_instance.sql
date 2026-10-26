-- Track workspace GOC (noi Lead duoc TAO RA lan dau, khong bao gio doi) -
-- can thiet cho tinh nang "Sao chep Lead sang workspace khac": neu khong co
-- cot nay, 1 Lead tao o Markee -> copy sang CloudGate -> tu CloudGate copy
-- NGUOC LAI Markee se tao ra 1 ban trung lap o dung noi da tao ra no ban
-- dau (bug thuc te nguoi dung bao cao). `instance` hien tai (co san) chi
-- phan anh Lead DANG nam o dau, khong phan biet duoc "vua tao" vs "vua
-- duoc copy toi".
--
-- Backfill: gia dinh moi Lead hien co duoc TAO ngay tai instance no dang
-- nam (dung 100% voi du lieu that vi tinh nang copy chua ton tai truoc
-- migration nay).

ALTER TABLE public.crm_leads ADD COLUMN IF NOT EXISTS origin_instance TEXT;

UPDATE public.crm_leads
SET origin_instance = instance
WHERE origin_instance IS NULL;

NOTIFY pgrst, 'reload schema';
