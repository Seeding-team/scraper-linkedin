-- "Mã dự án tự sinh backend theo YYYY-MM-MÃKH-STT" - MÃKH lấy từ customer_code
-- THẬT nếu khách hàng đã có, chuẩn hóa từ tên nếu chưa (xem
-- supabase_project_service.py _resolve_customer_code()). crm_customers hiện
-- KHÔNG có cột nào phục vụ việc này (đã audit đầy đủ CUSTOMER_COLUMNS trước
-- khi viết migration) - thêm cột mới, nullable (khách hàng cũ/chưa từng tạo
-- dự án không cần có giá trị), backend tự sinh + lưu 1 lần duy nhất khi cần.
ALTER TABLE public.crm_customers ADD COLUMN IF NOT EXISTS customer_code TEXT;

-- Unique KHÔNG PHÂN BIỆT HOA/THƯỜNG - trên UPPER(customer_code), không phải
-- trên customer_code thô, tránh "LETHIANH" và "lethianh" bị coi là 2 mã khác
-- nhau. Backend luôn ghi customer_code dạng đã uppercase (xem
-- _slugify_customer_name()) nên index này khớp đúng dữ liệu backend tạo ra;
-- partial WHERE customer_code IS NOT NULL để nhiều khách hàng cùng NULL
-- không vi phạm unique.
CREATE UNIQUE INDEX IF NOT EXISTS crm_customers_customer_code_unique
  ON public.crm_customers (UPPER(customer_code))
  WHERE customer_code IS NOT NULL;
