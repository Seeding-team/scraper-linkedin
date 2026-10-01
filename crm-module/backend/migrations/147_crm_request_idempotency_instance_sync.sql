-- Port từ MAIN (linkedin_group_crawler/supabase/migrations/147_crm_request_idempotency_instance_sync.sql) — giữ cùng số để lịch sử migration khớp (clone đang dừng ở 144).
-- Đồng bộ cột tenant `instance` cho bảng crm_request_idempotency.
--
-- Code Main (crm_customer_service._idempotent_replay, commit 6ce87b0c
-- 2026-09-12) đã lọc `.eq("instance", settings.crm_instance)` trên bảng này,
-- nhưng cột chỉ được thêm ở migration của clone
-- (crm-module/backend/migrations/001_add_instance_scoping.sql, áp lên DB
-- self-host dùng chung) — lịch sử migration Main CHƯA có. DB chưa áp file
-- đó (vd DB local/dev) sẽ lỗi 42703 "column crm_request_idempotency.instance
-- does not exist" khi bấm "Tạo khách hàng & tạo Deal" (POST
-- /crm/customers/with-deal) → không tạo được khách hàng ở trạng thái Đang bán.
--
-- Giống hệt định nghĩa của migration clone 001 (TEXT NOT NULL DEFAULT
-- 'markee' + index) — DB đã có cột chạy file này không đổi gì. Không phá huỷ
-- dữ liệu; Postgres 11+ thêm cột NOT NULL DEFAULT hằng chỉ đổi metadata.

ALTER TABLE public.crm_request_idempotency
  ADD COLUMN IF NOT EXISTS instance TEXT NOT NULL DEFAULT 'markee';

CREATE INDEX IF NOT EXISTS idx_crm_request_idempotency_instance
  ON public.crm_request_idempotency (instance);

-- PostgREST (Supabase) cần reload schema cache để API thấy cột mới ngay.
NOTIFY pgrst, 'reload schema';
