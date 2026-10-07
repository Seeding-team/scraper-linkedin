-- Ma nguoi lien he tu sinh (LH000001...): cot + sequence + DEFAULT de moi INSERT (ke ca import/convert) tu co ma,
-- backfill lien he cu theo thu tu tao. Idempotent. (Da duoc ap tren DB dung chung; file nay de dong bo repo.)
CREATE SEQUENCE IF NOT EXISTS public.crm_contact_code_seq;

ALTER TABLE public.crm_contacts ADD COLUMN IF NOT EXISTS contact_code TEXT;

UPDATE public.crm_contacts c
SET contact_code = 'LH' || lpad(n.rn::text, 6, '0')
FROM (SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn FROM public.crm_contacts WHERE contact_code IS NULL) n
WHERE c.id = n.id;

ALTER TABLE public.crm_contacts
  ALTER COLUMN contact_code SET DEFAULT ('LH' || lpad(nextval('public.crm_contact_code_seq')::text, 6, '0'));

CREATE UNIQUE INDEX IF NOT EXISTS crm_contacts_contact_code_unique
  ON public.crm_contacts (contact_code) WHERE contact_code IS NOT NULL;
