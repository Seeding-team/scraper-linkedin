-- 125 - Tenant-scope projects.
--
-- projects is business data. It must follow the same tenant mapping as
-- Lead / Deal / Customer / Quote:
--   Main + crm-module: markee
--   crm-securityzone: securityzone
--   crm-cloudgate: cloudgate
--
-- Existing projects are backfilled from their owning customer. The migration
-- intentionally does not delete, merge, or guess unresolved rows.

BEGIN;

ALTER TABLE public.projects
    ADD COLUMN IF NOT EXISTS instance TEXT;

UPDATE public.projects p
SET instance = c.instance
FROM public.crm_customers c
WHERE p.customer_id = c.id
  AND p.instance IS NULL
  AND c.instance IS NOT NULL;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.projects
        WHERE instance IS NULL
    ) THEN
        RAISE EXCEPTION 'projects.instance still has NULL rows after customer-based backfill. Audit public.projects.customer_id before continuing.';
    END IF;
END $$;

ALTER TABLE public.projects
    ALTER COLUMN instance SET DEFAULT 'markee',
    ALTER COLUMN instance SET NOT NULL;

CREATE INDEX IF NOT EXISTS projects_instance_created_at_idx
    ON public.projects (instance, created_at DESC);

CREATE INDEX IF NOT EXISTS projects_instance_customer_id_idx
    ON public.projects (instance, customer_id);

COMMIT;
