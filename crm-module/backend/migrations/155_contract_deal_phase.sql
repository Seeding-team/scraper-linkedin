-- "Hop dong bao gia mua (Phase 1)" / "Hop dong bao gia ban (Phase 2)" trong form
-- Sua Deal (CrmCustomerModal.tsx) truoc day luu vao 2 cot JSON rieng tren
-- customer_leads (purchase_contract_links/sale_contract_links) - shadow data,
-- KHONG phai contracts canonical, nen tab Hop dong cua Deal/Customer 360 khong
-- bao gio thay. Xac nhan voi user (2026-10-03): Phase 1/Phase 2 la hop dong
-- voi CUNG 1 khach hang (khong phai Vendor/NCC) - chi khac giai doan/loai bao
-- gia, nen KHONG can them vendor_id, chi can 1 the (tag) de phan biet khi
-- hien lai 2 khu vuc trong form sua.
--
-- deal_phase: 'purchase' (Phase 1) | 'sale' (Phase 2) | NULL (moi hop dong
-- khac - wizard CRM, Ghi nhan hop dong co san tu luong khac - khong co khai
-- niem Phase 1/2, giu NULL, khong anh huong gi).
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS deal_phase text
  CHECK (deal_phase IS NULL OR deal_phase IN ('purchase', 'sale'));

COMMENT ON COLUMN contracts.deal_phase IS
  'Tag rieng cho luong "Hop dong bao gia mua/ban" trong form sua Deal - purchase=Phase 1, sale=Phase 2, NULL cho moi luong tao hop dong khac.';
