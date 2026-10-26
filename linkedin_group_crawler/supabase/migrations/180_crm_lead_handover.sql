-- GD3: Ban giao xu ly / Assign / Re-assign Lead + email ban giao (audit day du, chong gui trung).
-- crm_leads: link tai lieu hang muc bao gia hien hanh (nhieu link Doc/Sheet) + nguoi/thoi diem ban giao gan nhat.
ALTER TABLE public.crm_leads
  ADD COLUMN IF NOT EXISTS handover_links JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS handover_by UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS handover_at TIMESTAMPTZ;

-- Lich su moi lan giao/nhan/re-assign (audit nguoi giao, nguoi nhan, thoi gian, link, email).
CREATE TABLE IF NOT EXISTS public.crm_lead_handovers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    instance TEXT NOT NULL DEFAULT 'markee',
    lead_id UUID NOT NULL REFERENCES public.crm_leads(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('handover', 'reassign', 'assign_qualified')),
    from_user_id UUID REFERENCES public.app_users(id) ON DELETE SET NULL,   -- nguoi thao tac (giao)
    prev_assignee_id UUID REFERENCES public.app_users(id) ON DELETE SET NULL, -- nguoi phu trach truoc do
    to_user_id UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
    crm_team_id UUID,
    doc_links JSONB NOT NULL DEFAULT '[]'::jsonb,
    missing_items JSONB NOT NULL DEFAULT '[]'::jsonb,
    note TEXT,
    send_email BOOLEAN NOT NULL DEFAULT FALSE,
    email_status TEXT NOT NULL DEFAULT 'skipped' CHECK (email_status IN ('skipped', 'pending', 'sent', 'failed', 'dry_run')),
    email_to TEXT,
    email_error TEXT,
    email_sent_at TIMESTAMPTZ,
    idempotency_key TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_lead_handovers_lead ON public.crm_lead_handovers (lead_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS crm_lead_handovers_idem_unique
  ON public.crm_lead_handovers (instance, idempotency_key) WHERE idempotency_key IS NOT NULL;
