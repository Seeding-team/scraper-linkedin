-- "Nguoi dai dien ky" hop dong la vai tro nghiep vu RIENG, khong mac nhien la
-- Nguoi lien he cua Deal (xem contract_ai_service.resolve_representative()).
-- representative_confirmed: Sale da xac nhan ro (khong phai checkbox "toi da
-- hieu" vuot qua) - dung lam dieu kien chan gui duyet/ky trong
-- contract_approval_service.compute_readiness().
--
-- legal_snapshot: anh chup du lieu phap ly 2 ben (ten/MST/dia chi/dai dien/
-- chuc vu/SDT/email) tai thoi diem tao/xac nhan hop dong - dung khi Sale chon
-- "Chi dung cho hop dong nay" (khong ghi de ho so CRM goc); cung la nguon that
-- cho DOCX/PDF cua CHINH hop dong nay de tranh lech neu CRM bi sua sau.
ALTER TABLE public.contracts
    ADD COLUMN IF NOT EXISTS representative_confirmed BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS legal_snapshot JSONB;

COMMENT ON COLUMN public.contracts.representative_confirmed IS
    'Sale da xac nhan ro nguoi dai dien ky (khong suy doan tu Nguoi lien he) - dieu kien gui duyet/ky.';
COMMENT ON COLUMN public.contracts.legal_snapshot IS
    'Anh chup Ben A/Ben B (tu build_parties) luc tao/xac nhan hop dong - NULL = chua co, dung lai CRM truc tiep.';
