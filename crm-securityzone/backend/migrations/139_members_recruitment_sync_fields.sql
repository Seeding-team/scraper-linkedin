-- ============================================================
-- Migration 139: mo rong bang `members` (migration 043) de dong bo DAY DU
-- nhu pm-new (https://kpi.markeeai.com/accounts, tab Quan ly thanh vien):
-- theo doi trang thai lam viec (ON/OFF, ca resigned), leader phu trach,
-- link CV, va co che tu xoa Member khong con trong he tuyen dung (chi
-- xoa Member da tung duoc chinh dong bo nay tao/cham - is_recruitment_synced).
--
-- Bang `members` dung chung toan bo 4 stack (Main + 3 clone CRM), khong
-- tenant-scoped, nhung van copy file nay sang ca 3 thu muc migrations rieng
-- cua clone (crm-module|cloudgate|securityzone/backend/migrations/) giong
-- quy uoc cac migration CRM/shared khac (vd 138_crm_lead_import_tenant_scope)
-- - moi clone chay migration runner rieng cua no du chung 1 Postgres.
-- ============================================================

ALTER TABLE members
    ADD COLUMN IF NOT EXISTS employment_status TEXT NOT NULL DEFAULT 'ON',
    ADD COLUMN IF NOT EXISTS off_effective_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS leader_name TEXT,
    ADD COLUMN IF NOT EXISTS leader_email TEXT,
    ADD COLUMN IF NOT EXISTS cv_link TEXT,
    ADD COLUMN IF NOT EXISTS is_recruitment_synced BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN members.employment_status IS
    'ON = dang lam viec, OFF = da nghi (ung vien resigned tren he tuyen dung). Dieu khien tu dong khoa/mo tai khoan dang nhap lien ket khi dong bo.';
COMMENT ON COLUMN members.off_effective_at IS
    'Thoi diem chuyen sang OFF gan nhat - phuc vu bao cao/loc theo giai doan, khong bi ghi de khi sync lai lien tuc.';
COMMENT ON COLUMN members.is_recruitment_synced IS
    'True neu Member nay duoc tao/cham boi dong bo tuyen dung - chi Member co co nay moi bi tu dong xoa khi khong con trong he tuyen dung nua, Member tao tay khong bao gio bi dong bo xoa.';

NOTIFY pgrst, 'reload schema';
