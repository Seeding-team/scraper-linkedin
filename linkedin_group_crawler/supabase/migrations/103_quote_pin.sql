-- "Ghim báo giá lên đầu" (Quote Center) - CHI Admin duoc ghim/bo ghim 1 Quote
-- Case (version hien tai cua 1 chuoi) len dau danh sach, khong doi phase/
-- status/version-chain/updated_at/noi dung bao gia. Dung 3 cot truc tiep tren
-- `quotes` (khong tach bang rieng) vi day la 1 thuoc tinh HIEN THI/sap xep
-- cua 1 QUOTE CU THE (dung version dang la "current" trong chuoi tai thoi
-- diem ghim), khong phai 1 quan he nhieu-nhieu can bang rieng - giong dung
-- cach `deleted_at`/`cancelled_at`/`published_at` da lam (lifecycle field
-- truc tiep tren quotes, migration 087).
--
-- KHONG apply migration nay len DB that cho toi khi duoc xac nhan rieng
-- (giong quy uoc 087-102 truoc do).

ALTER TABLE public.quotes
    ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS pinned_by UUID REFERENCES public.app_users(id);

-- Dam bao trang thai nhat quan: is_pinned=false thi pinned_at/pinned_by PHAI
-- la NULL (khong con lai dau vet ghim cu sau khi bo ghim) - tranh 1 dong
-- "da bo ghim" nhung van con pinned_at cu (vd bug logic tuong lai quen xoa).
ALTER TABLE public.quotes
    ADD CONSTRAINT quotes_pin_consistency_check
    CHECK (
        (is_pinned = false AND pinned_at IS NULL AND pinned_by IS NULL)
        OR (is_pinned = true AND pinned_at IS NOT NULL)
    );

-- Ho tro sort "ghim truoc, trong nhom ghim thi pinned_at moi nhat truoc" hieu
-- qua tren danh sach lon - CHI can 1 index rieng cho tap is_pinned=true (nho
-- hon nhieu so voi toan bang), sap theo pinned_at DESC dung thu tu sort that
-- can.
CREATE INDEX IF NOT EXISTS quotes_pinned_order_idx
    ON public.quotes (pinned_at DESC)
    WHERE is_pinned = true;

-- QUAN TRONG: migration 028 (quote_forms_and_quotes.sql) da tao 1 trigger
-- CHUNG BEFORE UPDATE tren public.quotes luon set NEW.updated_at = NOW() cho
-- MOI UPDATE, bat ke cot nao doi. Neu giu nguyen, hanh dong ghim/bo ghim (chi
-- doi is_pinned/pinned_at/pinned_by) se VO TINH lam updated_at nhay - vi pham
-- truc tiep yeu cau "không sửa giả updated_at/created_at" cua tinh nang ghim.
-- Sua lai ham trigger (KHONG sua migration 028 da apply - chi CREATE OR
-- REPLACE lai chinh ham do trong migration MOI nay, dung quy uoc da dung o
-- 099 sua loi 094): neu 1 UPDATE CHI doi 3 cot pin (moi cot khac giu nguyen
-- y het OLD), bo qua viec bump updated_at - moi truong hop UPDATE khac (RPC
-- quote_update, assign_quote_owner, doi status...) van bump updated_at nhu
-- cu, khong doi hanh vi da co.
CREATE OR REPLACE FUNCTION update_quotes_updated_at()
RETURNS TRIGGER AS $$
DECLARE
    v_new_without_pin public.quotes;
BEGIN
    v_new_without_pin := NEW;
    v_new_without_pin.is_pinned := OLD.is_pinned;
    v_new_without_pin.pinned_at := OLD.pinned_at;
    v_new_without_pin.pinned_by := OLD.pinned_by;
    v_new_without_pin.updated_at := OLD.updated_at;
    IF v_new_without_pin IS NOT DISTINCT FROM OLD THEN
        -- Chi cot ghim (hoac khong gi) thay doi - giu nguyen updated_at cu,
        -- KHONG bump - dung yeu cau rieng cua tinh nang ghim.
        NEW.updated_at := OLD.updated_at;
    ELSE
        NEW.updated_at := NOW();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
