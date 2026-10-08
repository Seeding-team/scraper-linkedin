-- Ten viet tat cua khach hang doanh nghiep (hien thi o danh sach; tim kiem duoc). customer_name/company_name GIU NGUYEN (ten day du / phap ly).
-- short_name_manual = true khi nguoi dung tu nhap/sua tay -> he thong KHONG BAO GIO tu ghi de.
-- Backfill gia tri cu: chay script rieng linkedin_group_crawler/scripts/backfill_customer_short_names.py (khong ghi de gia tri da co).
ALTER TABLE public.crm_customers
  ADD COLUMN IF NOT EXISTS short_name TEXT,
  ADD COLUMN IF NOT EXISTS short_name_manual BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_crm_customers_short_name ON public.crm_customers (lower(short_name));
