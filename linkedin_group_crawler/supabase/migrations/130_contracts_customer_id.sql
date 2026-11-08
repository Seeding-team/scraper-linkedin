-- Contracts can be created directly from a Customer without a Deal
-- (ManualContractModal already allows deal_id = null + manual_customer_name
-- free text). manual_customer_name is not a foreign key, so such contracts
-- were never resolvable back to a canonical crm_customers row — Customer 360
-- could never surface them. This adds the missing canonical relation.
--
-- quotes.customer_id is intentionally NOT added: every Quote creation path in
-- the frontend guarantees a deal_id (auto-creates a Deal if none is linked
-- yet), so Quote -> Customer is already uniquely resolvable via
-- quotes.deal_id -> customer_leads.customer_id.

ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES public.crm_customers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_contracts_customer_id ON public.contracts(customer_id);

-- Backfill only what's derivable from an existing real relation (deal -> customer).
-- Rows with manual_customer_name and no deal_id are NOT backfilled/guessed —
-- there is no reliable way to match free text to a crm_customers row, and
-- guessing would create incorrect canonical links.
UPDATE public.contracts c
SET customer_id = cl.customer_id
FROM public.customer_leads cl
WHERE c.deal_id = cl.id AND c.customer_id IS NULL AND cl.customer_id IS NOT NULL;
