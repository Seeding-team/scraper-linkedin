-- ============================================================
-- Migration: 139_customer_leads_contract_links.sql
-- Port tu Main (linkedin_group_crawler/supabase/migrations/
-- 141_customer_leads_contract_links.sql) - Vấn đề 2 (Note vấn đề CRM cho
-- team dev, 2026-09): thay field đơn "Link báo giá / hợp đồng"
-- (last_attachment_url/name) bằng 2 khu vực riêng, mỗi khu vực cho phép
-- nhiều link (1 dự án có thể chia nhỏ nhiều hợp đồng):
--   purchase_contract_links : Hợp đồng báo giá MUA (Phase 1)
--   sale_contract_links     : Hợp đồng báo giá BÁN (Phase 2)
--
-- Mỗi cột là JSONB array of {"name": string, "url": string}.
-- KHÔNG xoá/đổi last_attachment_url/last_attachment_name — 2 cột này vẫn
-- được StageTransitionModal (upload khi kéo-thả qua requirement/
-- proposal_sent/contract_signed) và Kanban card / DealDetailDrawer dùng,
-- giữ nguyên để không phá luồng cũ.
--
-- LƯU Ý PORT: app này (crm-securityzone) dùng CHUNG 1 DB self-host với Main
-- (xem backend/.env.example) — cùng bảng public.customer_leads vật lý.
-- ADD COLUMN IF NOT EXISTS nên an toàn dù cột đã được tạo qua migration
-- 141 của Main (idempotent, không rerun DDL mù) — file này chủ yếu để giữ
-- parity lịch sử migration giữa Main và clone theo đúng rule port.
-- ============================================================

ALTER TABLE public.customer_leads
  ADD COLUMN IF NOT EXISTS purchase_contract_links JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS sale_contract_links     JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.customer_leads.purchase_contract_links IS
  'Hợp đồng báo giá MUA (Phase 1) — mảng JSON [{"name":"...","url":"..."}], nhiều link/hợp đồng cho 1 deal.';
COMMENT ON COLUMN public.customer_leads.sale_contract_links IS
  'Hợp đồng báo giá BÁN (Phase 2) — mảng JSON [{"name":"...","url":"..."}], nhiều link/hợp đồng cho 1 deal.';
