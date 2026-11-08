-- (I) "Điều khoản thanh toán" mặc định của Đơn vị phát hành báo giá
-- (quote_issuer_companies, gốc 069) — cho phép mỗi công ty (SecurityZone/
-- Cloudgate/Markee...) có 1 đoạn điều khoản thanh toán mặc định riêng, thay vì
-- luôn trống (trước giờ khối "Điều khoản thanh toán" trên báo giá là custom
-- block tự do, người tạo phải tự gõ tay mỗi lần — xem CustomBlocksEditor.tsx,
-- CustomBlockKind 'payment_terms').
--
-- CHỈ là 1 cột default text trên danh mục — KHÔNG tự đổi báo giá đã tạo trước
-- đó (snapshot 1 LẦN vào quotes.data lúc tạo báo giá mới, xem
-- apply_issuer_payment_terms_snapshot trong supabase_quote_service.py và
-- CreateQuoteModal.tsx/QuoteWorkspaceModal.tsx phía tạo mới) — đúng nguyên
-- tắc snapshot-tại-thời-điểm đã áp dụng cho toàn bộ issuer_company khác (xem
-- comment đầu file 069).

ALTER TABLE quote_issuer_companies
  ADD COLUMN payment_terms TEXT;
