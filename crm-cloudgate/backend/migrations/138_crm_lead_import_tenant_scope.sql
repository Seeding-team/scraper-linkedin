-- Main-only schema guard for Lead Excel import.
--
-- Existing Main CRM services already read/write `instance` on crm_leads,
-- but the Main migration history did not create that column
-- (the clone repositories have a separate migration 001).  Keep this change
-- additive/idempotent and backfill historical Main data to its canonical
-- tenant before enforcing NOT NULL.

ALTER TABLE public.crm_leads
    ADD COLUMN IF NOT EXISTS instance TEXT;

UPDATE public.crm_leads
SET instance = 'markee'
WHERE instance IS NULL OR btrim(instance) = '';

ALTER TABLE public.crm_leads
    ALTER COLUMN instance SET DEFAULT 'markee',
    ALTER COLUMN instance SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_crm_leads_instance
    ON public.crm_leads(instance);

CREATE INDEX IF NOT EXISTS idx_crm_leads_instance_phone_normalized
    ON public.crm_leads(instance, phone_normalized)
    WHERE phone_normalized IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_crm_leads_instance_email_normalized
    ON public.crm_leads(instance, email_normalized)
    WHERE email_normalized IS NOT NULL;

-- categories is shared master data across Main/Module/Zone/Cloud (124).
-- Do not add/backfill/enforce a tenant column for shared dropdown options.
-- If an earlier local draft was applied, leave its additive columns untouched;
-- no destructive rollback or production DDL is authorized by this correction.
