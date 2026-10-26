-- "Copy báo giá cross-workspace" (2026-10-03) - audit bat buoc moi lan copy 1
-- quote tu workspace nay (instance nguon) sang workspace khac (instance
-- dich). KHONG dung chung voi contract_activity_log/quote_activity_log vi 2
-- hang do la hoat dong NOI BO trong 1 instance - bang nay rieng vi no can ghi
-- CA 2 instance (nguon/dich) tren CUNG 1 dong, khac hoan toan ngu nghia.
--
-- source_instance/target_instance: gia tri `instance` that (markee/cloudgate/
-- SECURITYZONE), KHONG phai FK - day la boundary da duoc thiet lap tu truoc
-- (migration 001_add_instance_scoping.sql o moi clone), khong co bang
-- "workspaces" rieng de FK toi.
CREATE TABLE IF NOT EXISTS quote_cross_workspace_copy_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_instance text NOT NULL,
  source_quote_id uuid NOT NULL,
  target_instance text NOT NULL,
  target_quote_id uuid NOT NULL,
  target_customer_id uuid,
  target_deal_id uuid,
  performed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quote_cross_workspace_copy_log_source_quote
  ON quote_cross_workspace_copy_log (source_quote_id);
CREATE INDEX IF NOT EXISTS idx_quote_cross_workspace_copy_log_target_quote
  ON quote_cross_workspace_copy_log (target_quote_id);

NOTIFY pgrst, 'reload schema';
