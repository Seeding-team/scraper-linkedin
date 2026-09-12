-- CRM Lead/Deal status architecture.
--
-- This migration is intentionally structural only:
-- - no UPDATE backfill of existing crm_leads/customer_leads rows;
-- - no delete of test or real records;
-- - legacy values stay accepted so old records remain readable while app/runtime
--   code maps them to the new business vocabulary.
--
-- New lead statuses:
--   mql, sql, nurturing, unqualified
-- Legacy read/write aliases kept during migration:
--   new_lead, qualifying -> mql
--   qualified, converted -> sql only when converted_deal_id exists
--   nurture -> nurturing
--   disqualified -> unqualified
--
-- New deal stages:
--   dealing, proposal_sent, negotiation, contract_signed, payment_1,
--   implementation, acceptance, payment_final, post_sale_care, lost, on_hold
-- Legacy aliases kept during migration:
--   new_lead, contacted, qualified, requirement -> dealing
--   contract_sent -> proposal_sent
--   won -> post_sale_care

CREATE TABLE IF NOT EXISTS public.crm_lead_activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES public.crm_leads(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  actor_id UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
  note TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crm_lead_activity_log_lead_created
  ON public.crm_lead_activity_log(lead_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.crm_normalize_lead_status_122()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.status := COALESCE(NULLIF(NEW.status, ''), 'mql');

  IF NEW.status IN ('new_lead', 'qualifying') THEN
    NEW.status := 'mql';
  ELSIF NEW.status = 'nurture' THEN
    NEW.status := 'nurturing';
  ELSIF NEW.status = 'disqualified' THEN
    NEW.status := 'unqualified';
  ELSIF NEW.status IN ('qualified', 'converted') THEN
    NEW.status := 'sql';
  END IF;

  IF NEW.status = 'sql' AND NEW.converted_deal_id IS NULL THEN
    RAISE EXCEPTION 'crm_lead_sql_requires_deal';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_crm_normalize_lead_status_122 ON public.crm_leads;
CREATE TRIGGER trg_crm_normalize_lead_status_122
BEFORE INSERT OR UPDATE OF status, converted_deal_id ON public.crm_leads
FOR EACH ROW
EXECUTE FUNCTION public.crm_normalize_lead_status_122();

CREATE OR REPLACE FUNCTION public.crm_log_lead_status_122()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.crm_lead_activity_log(lead_id, action, to_status, actor_id, note)
    VALUES (NEW.id, 'created', NEW.status, NEW.created_by, 'Lead created');
  ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.crm_lead_activity_log(lead_id, action, from_status, to_status, actor_id, note)
    VALUES (NEW.id, 'status_changed', OLD.status, NEW.status, COALESCE(NEW.converted_by, NEW.created_by), 'Lead status changed');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_crm_log_lead_status_122 ON public.crm_leads;
CREATE TRIGGER trg_crm_log_lead_status_122
AFTER INSERT OR UPDATE OF status ON public.crm_leads
FOR EACH ROW
EXECUTE FUNCTION public.crm_log_lead_status_122();

ALTER TABLE public.crm_leads
  DROP CONSTRAINT IF EXISTS crm_leads_status_check;

ALTER TABLE public.crm_leads
  ADD CONSTRAINT crm_leads_status_check
  CHECK (
    status IN (
      'mql', 'sql', 'nurturing', 'unqualified',
      'new_lead', 'qualifying', 'qualified', 'nurture', 'converted', 'disqualified'
    )
  ) NOT VALID;

CREATE OR REPLACE FUNCTION public.crm_normalize_deal_stage_122()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.deal_stage := COALESCE(NULLIF(NEW.deal_stage, ''), 'dealing');

  IF NEW.deal_stage IN ('new_lead', 'contacted', 'qualified', 'requirement') THEN
    NEW.deal_stage := 'dealing';
  ELSIF NEW.deal_stage = 'contract_sent' THEN
    NEW.deal_stage := 'proposal_sent';
  ELSIF NEW.deal_stage = 'won' THEN
    NEW.deal_stage := 'post_sale_care';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_crm_normalize_deal_stage_122 ON public.customer_leads;
CREATE TRIGGER trg_crm_normalize_deal_stage_122
BEFORE INSERT OR UPDATE OF deal_stage ON public.customer_leads
FOR EACH ROW
EXECUTE FUNCTION public.crm_normalize_deal_stage_122();

ALTER TABLE public.customer_leads
  DROP CONSTRAINT IF EXISTS customer_leads_deal_stage_check;

ALTER TABLE public.customer_leads
  ADD CONSTRAINT customer_leads_deal_stage_check
  CHECK (
    deal_stage IN (
      'dealing', 'proposal_sent', 'negotiation', 'contract_signed',
      'payment_1', 'implementation', 'acceptance', 'payment_final',
      'post_sale_care', 'lost', 'on_hold',
      'new_lead', 'contacted', 'qualified', 'requirement', 'contract_sent', 'won'
    )
  ) NOT VALID;

ALTER TABLE public.crm_lead_activity_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS crm_lead_activity_log_authenticated_read ON public.crm_lead_activity_log;
CREATE POLICY crm_lead_activity_log_authenticated_read
ON public.crm_lead_activity_log
FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS crm_lead_activity_log_service_write ON public.crm_lead_activity_log;
CREATE POLICY crm_lead_activity_log_service_write
ON public.crm_lead_activity_log
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

COMMENT ON TABLE public.crm_lead_activity_log IS
  'Audit trail for crm_leads status changes introduced by migration 122.';

COMMENT ON FUNCTION public.crm_normalize_lead_status_122 IS
  'Normalizes legacy lead statuses to MQL/SQL/Nurturing/Unqualified and enforces SQL only after a deal exists.';

COMMENT ON FUNCTION public.crm_normalize_deal_stage_122 IS
  'Normalizes legacy deal pipeline stages to the migration 122 sales pipeline.';
