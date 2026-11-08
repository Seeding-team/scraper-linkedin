-- Drop the trigger that normalizes legacy deal stages to "dealing"
-- to preserve the 8-column CRM layout used by the frontend.
-- This does NOT touch the lead_status normalization (mql, sql, etc).

DROP TRIGGER IF EXISTS trg_crm_normalize_deal_stage_122 ON public.customer_leads;
