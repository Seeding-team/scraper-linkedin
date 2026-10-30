-- "AI Contract Review" (2026-10-26, yeu cau sep) - Phan B: cache ket qua doi chieu
-- bao gia theo DUNG phien ban tai lieu + bao gia + bo quy tac phan tich (nguyen tac
-- #3 trong plan, mo rong theo gop y: khong chi hash hop dong, phai tinh ca hash
-- bao gia lien ket - bao gia doi thi phai chay lai, du hop dong khong doi gi).

CREATE TABLE IF NOT EXISTS public.contract_ai_reviews (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id           UUID NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
    contract_content_hash TEXT NOT NULL,
    quote_content_hash    TEXT NOT NULL,
    rules_version         TEXT NOT NULL,
    extracted_fields      JSONB NOT NULL DEFAULT '{}'::jsonb,
    quote_comparison      JSONB NOT NULL DEFAULT '[]'::jsonb,
    highlight_source_bucket TEXT,
    highlight_source_key   TEXT,
    highlight_file_name    TEXT,
    confirmed_by          UUID,
    confirmed_at          TIMESTAMPTZ,
    drive_file_id         TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contract_ai_reviews_lookup
    ON public.contract_ai_reviews (contract_id, contract_content_hash, quote_content_hash, rules_version);

NOTIFY pgrst, 'reload schema';
