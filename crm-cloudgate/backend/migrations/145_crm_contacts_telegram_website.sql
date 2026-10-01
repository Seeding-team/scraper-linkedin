-- Port từ MAIN (linkedin_group_crawler/supabase/migrations/145_crm_contacts_telegram_website.sql) — giữ cùng số để lịch sử migration khớp (clone đang dừng ở 144).
-- Feedback 2026-09-23: form "Thêm Contact" (CrmContactsPanel.tsx) phải lấy
-- thông tin giống form Lead (LeadFormDrawer.tsx) — Lead có Zalo/Facebook/
-- Telegram/Website/Ghi chú, Contact trước đây chỉ có Zalo/Facebook.
-- Thêm 2 cột optional, không đổi hành vi cũ (NULL mặc định, không backfill).
--
-- IF NOT EXISTS: DB dev (Supabase oxxkxbhcyjocewjmxbgu) đã có sẵn 2 cột này
-- (được thêm tay trước đó, không có file migration) — file này đồng bộ lại
-- lịch sử migration, chạy lại an toàn, không phải DDL phá huỷ.

ALTER TABLE public.crm_contacts
  ADD COLUMN IF NOT EXISTS telegram TEXT,
  ADD COLUMN IF NOT EXISTS website TEXT;
