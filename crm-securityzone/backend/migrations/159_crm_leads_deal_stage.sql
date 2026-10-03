-- Persist "Giai đoạn" (deal stage draft) selected during Lead verification
-- before the Lead is converted to a Deal. Same gap as team_id/project_name
-- (164/165): the dropdown is editable for any Lead regardless of conversion
-- status, but the value is silently dropped on save when the Lead has not
-- been converted yet (saveVerification only sent deal_stage when
-- convertedDealId existed).
ALTER TABLE public.crm_leads
    ADD COLUMN IF NOT EXISTS deal_stage TEXT;

COMMENT ON COLUMN public.crm_leads.deal_stage IS
    'Giai doan (nhap truoc) luu truoc khi Lead convert thanh Co hoi; dong bo tiep sang Deal.deal_stage khi Lead da convert san.';
