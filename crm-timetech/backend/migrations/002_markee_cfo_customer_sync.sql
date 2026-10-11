-- Mirror the Markee CFO customer/partner master into CRM customers.
-- Safe to run repeatedly. Existing CRM rows remain local and active.

ALTER TABLE public.crm_customers
  ADD COLUMN IF NOT EXISTS external_system TEXT,
  ADD COLUMN IF NOT EXISTS external_id TEXT,
  ADD COLUMN IF NOT EXISTS external_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS external_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS external_active BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS crm_customers_external_identity_uidx
  ON public.crm_customers (instance, external_system, external_id)
  WHERE external_system IS NOT NULL AND external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS crm_customers_external_scope_idx
  ON public.crm_customers (instance, external_system, external_active);

NOTIFY pgrst, 'reload schema';
