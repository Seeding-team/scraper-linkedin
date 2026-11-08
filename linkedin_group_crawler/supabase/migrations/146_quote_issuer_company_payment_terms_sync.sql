-- Đồng bộ cột "Điều khoản thanh toán" mặc định của Đơn vị phát hành
-- (quote_issuer_companies.payment_terms) cho các DB chưa áp
-- 144_quote_issuer_company_payment_terms.sql (vd DB local/dev: REST báo
-- "column quote_issuer_companies.payment_terms does not exist").
--
-- Feedback 2026-09-23 mục 3: đổi Đơn vị phát hành thì điều khoản thanh toán
-- trên báo giá phải đổi theo (applyIssuerPaymentTermsSnapshot, FE) — cần cột
-- này để mỗi đơn vị có điều khoản riêng.
--
-- Số mới (146) thay vì chạy lại 144: không tái sử dụng số migration đã tồn tại.
-- IF NOT EXISTS: DB đã áp 144 chạy file này không đổi gì; không phá huỷ dữ liệu.

ALTER TABLE public.quote_issuer_companies
  ADD COLUMN IF NOT EXISTS payment_terms TEXT;

-- PostgREST (Supabase) cần reload schema cache để API thấy cột mới ngay.
NOTIFY pgrst, 'reload schema';
