ALTER TABLE public.projects
    ADD COLUMN IF NOT EXISTS primary_contact_id UUID REFERENCES public.crm_contacts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS projects_primary_contact_id_idx ON public.projects(primary_contact_id);
