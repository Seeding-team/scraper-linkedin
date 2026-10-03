-- Persist "Dự án" (free-text draft) typed during Lead verification/nurturing
-- before the Lead is converted to a Deal. Mirrors 164_crm_leads_team_id.sql:
-- without this column the value typed into the "Dự án" field on a
-- not-yet-converted Lead (SQL chưa chốt hoặc đang Nuôi dưỡng) has nowhere to
-- persist, so it is silently dropped on save and lost on reload.
ALTER TABLE public.crm_leads
    ADD COLUMN IF NOT EXISTS project_name TEXT;

COMMENT ON COLUMN public.crm_leads.project_name IS
    'Du an (nhap tay, nhap) luu truoc khi Lead convert thanh Co hoi. Khi convert, gia tri nay duoc dung de tao Project that (xem convert_lead()); khi Lead da convert san, duoc dong bo tiep sang Deal/Project qua update_customer_lead().';
