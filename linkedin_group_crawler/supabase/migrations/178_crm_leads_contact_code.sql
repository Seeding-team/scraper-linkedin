-- Ma lien he (LHxxxxxx) sinh NGAY KHI TAO LEAD (DEFAULT tu sequence dung chung voi crm_contacts).
-- Khi Lead convert -> Contact tao moi GIU NGUYEN ma nay (backend crm_lead_service._apply_convert_codes).
-- KHONG sinh ma cho Lead cu chua convert (chua backfill); Lead da convert chi COPY ma tu Contact cua no.
ALTER TABLE public.crm_leads ADD COLUMN IF NOT EXISTS contact_code TEXT;

UPDATE public.crm_leads l
SET contact_code = c.contact_code
FROM public.crm_contacts c
WHERE l.converted_contact_id = c.id AND l.contact_code IS NULL AND c.contact_code IS NOT NULL;

ALTER TABLE public.crm_leads
  ALTER COLUMN contact_code SET DEFAULT ('LH' || lpad(nextval('public.crm_contact_code_seq')::text, 6, '0'));

CREATE UNIQUE INDEX IF NOT EXISTS crm_leads_contact_code_unique
  ON public.crm_leads (contact_code) WHERE contact_code IS NOT NULL;
