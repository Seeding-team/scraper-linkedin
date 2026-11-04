-- Persist Team Sale selected during Lead verification before a Lead is converted.
-- Sale owner already lives on crm_leads.qualification_ae_id; this column stores
-- the selected CRM team so SQL leads without a Deal can round-trip through
-- PUT /crm/leads/{id} and subsequent GET/list reads.
ALTER TABLE public.crm_leads
    ADD COLUMN IF NOT EXISTS team_id UUID;

CREATE INDEX IF NOT EXISTS idx_crm_leads_team_id
    ON public.crm_leads(team_id)
    WHERE team_id IS NOT NULL;

COMMENT ON COLUMN public.crm_leads.team_id IS
    'CRM Team Sale selected during Lead qualification before conversion to a Deal.';
