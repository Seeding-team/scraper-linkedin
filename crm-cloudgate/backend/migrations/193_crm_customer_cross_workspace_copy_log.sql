-- "Copy sau / Di chuyen Khach hang cross-workspace" (2026-10-23, yeu cau sep)
-- - audit cho ca 2 hanh dong moi: copy_customer_deep_to_instance() (tao ban
-- sao TOAN BO cay du lieu Khach hang - Co hoi/Bao gia/Lien he/Hop dong/Du an -
-- sang workspace khac, nguon giu nguyen) va move_customer_to_instance()
-- (chuyen han, doi cot `instance` tai cho, khong tao ban sao). Dung chung 1
-- bang, phan biet bang cot action_type - giong tinh than
-- quote_cross_workspace_copy_log (migration 156) nhung gop ca copy/move vi
-- cung 1 pham vi nghiep vu "Khach hang sang workspace khac".
CREATE TABLE IF NOT EXISTS crm_customer_cross_workspace_copy_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type text NOT NULL CHECK (action_type IN ('copy', 'move')),
  source_instance text NOT NULL,
  source_customer_id uuid NOT NULL,
  target_instance text NOT NULL,
  target_customer_id uuid NOT NULL,
  performed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_customer_cross_workspace_copy_log_source
  ON crm_customer_cross_workspace_copy_log (source_customer_id);
CREATE INDEX IF NOT EXISTS idx_crm_customer_cross_workspace_copy_log_target
  ON crm_customer_cross_workspace_copy_log (target_customer_id);

NOTIFY pgrst, 'reload schema';
