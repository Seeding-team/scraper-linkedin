-- ============================================================
-- Migration 146: them cot `level` cho bang `members` (migration 043) - khop
-- cot "LEVEL" that su cua pm-new (Intern LV1/LV2/LV3/Fresher/Core Team/
-- Presales/Sales/Leader), lay tu `currentLevel` trong RECRUITMENT_META
-- (admin_notes cua ung vien ben he tuyen dung), qua LEVEL_MAP giong het
-- pm-new. Truoc migration nay he thong CO CHU DICH khong lam cot Level vi
-- khong co khai niem tuong ung - nay them lai theo yeu cau doi chieu dung
-- anh giao dien that cua pm-new.
--
-- Bang `members` dung chung toan bo 4 stack (Main + 3 clone CRM) - copy file
-- nay sang ca 3 thu muc migrations rieng cua clone giong quy uoc migration
-- 139.
-- ============================================================

ALTER TABLE members
    ADD COLUMN IF NOT EXISTS level TEXT;

COMMENT ON COLUMN members.level IS
    'Cap do noi bo (Intern LV1/LV2/LV3/Fresher/Core Team/Presales/Sales/Leader) - lay tu currentLevel trong RECRUITMENT_META cua he tuyen dung qua LEVEL_MAP, KHONG lien quan Team (vi tri/phong ban).';

NOTIFY pgrst, 'reload schema';
