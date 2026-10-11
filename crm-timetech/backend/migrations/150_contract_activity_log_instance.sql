-- 150 - Tenant-scope contract_activity_log (+ defensive backfill cho contracts).
--
-- Bug that da gap (2026-09-25, test local "Ghi nhận hợp đồng có sẵn"): tao
-- hop dong xong, backend ghi tiep 1 dong vao contract_activity_log
-- (_log_activity() trong supabase_contract_service.py) VOI field "instance"
-- (settings.crm_instance) - nhung bang contract_activity_log (migration 072)
-- CHUA TUNG duoc them cot nay, khac voi bang contracts o cung file da duoc
-- them instance qua 1 lan sua tay/migration khac khong con dau vet ro rang.
-- Loi PostgREST tra ve: "Could not find the 'instance' column of
-- 'contract_activity_log' in the schema cache" (PGRST204) - hop dong VAN
-- duoc tao thanh cong (bang contracts), chi log hoat dong bi loi va hien
-- nham thanh loi cho nguoi dung.
--
-- Migration nay: (1) dam bao contracts.instance ton tai (IF NOT EXISTS,
-- phong truong hop DB nao chua co) backfill tu deal (customer_leads) hoac
-- quote lien ket; (2) them contract_activity_log.instance, backfill tu
-- contracts.instance qua contract_id.

BEGIN;

ALTER TABLE public.contracts
    ADD COLUMN IF NOT EXISTS instance TEXT;

UPDATE public.contracts c
SET instance = cl.instance
FROM public.customer_leads cl
WHERE c.deal_id = cl.id
  AND c.instance IS NULL
  AND cl.instance IS NOT NULL;

UPDATE public.contracts c
SET instance = q.instance
FROM public.quotes q
WHERE c.quote_id = q.id
  AND c.instance IS NULL
  AND q.instance IS NOT NULL;

-- Hop dong con lai khong resolve duoc tu deal/quote (hiem, vd du lieu test
-- rac) - fallback ve tenant mac dinh thay vi chan migration bang exception,
-- vi day la bang log/nghiep vu phu, khong phai bang tenant-critical nhu
-- projects (125) can audit chat.
UPDATE public.contracts
SET instance = 'markee'
WHERE instance IS NULL;

ALTER TABLE public.contracts
    ALTER COLUMN instance SET DEFAULT 'markee',
    ALTER COLUMN instance SET NOT NULL;

CREATE INDEX IF NOT EXISTS contracts_instance_created_at_idx
    ON public.contracts (instance, created_at DESC);

ALTER TABLE public.contract_activity_log
    ADD COLUMN IF NOT EXISTS instance TEXT;

UPDATE public.contract_activity_log l
SET instance = c.instance
FROM public.contracts c
WHERE l.contract_id = c.id
  AND l.instance IS NULL;

UPDATE public.contract_activity_log
SET instance = 'markee'
WHERE instance IS NULL;

ALTER TABLE public.contract_activity_log
    ALTER COLUMN instance SET DEFAULT 'markee',
    ALTER COLUMN instance SET NOT NULL;

CREATE INDEX IF NOT EXISTS contract_activity_log_instance_contract_id_idx
    ON public.contract_activity_log (instance, contract_id);

COMMIT;
