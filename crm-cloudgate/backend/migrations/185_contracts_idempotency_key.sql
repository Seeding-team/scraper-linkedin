-- 185 (DE XUAT - CHUA CHAY): chong tao trung hop dong dang tin cay khi nhieu worker/replica.
-- Hien tai: khoa Idempotency-Key trong bo nho 1 tien trinh + khoa tu nhien (deal+bao gia+tieu de+nguoi tao trong 2 phut). Cot UNIQUE nay la
-- lop bao ve cuoi cung o DB (INSERT trung key => backend tra lai hop dong da co).
-- DRY-RUN: select column_name from information_schema.columns where table_name='contracts' and column_name='idempotency_key';
-- ROLLBACK: drop index if exists contracts_idempotency_unique; alter table public.contracts drop column if exists idempotency_key;
ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS contracts_idempotency_unique ON public.contracts (instance, created_by, idempotency_key) WHERE idempotency_key IS NOT NULL;
