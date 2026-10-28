-- "Word Editor trong AI Contract Review" (2026-10-27) - vong doi duyet RIENG cho ban sua
-- doi/phu luc cua hop dong DA KY (xem plan muc 4). 1 version gan voi 1 amendment dang
-- 'draft'/'pending_approval' KHONG duoc coi la "nguon hieu luc" (contract_drive_service.
-- _resolve_contract_source_file, contract_ai_review_service) - AI Review/viewer mac dinh van
-- dung ban hieu luc TRUOC DO cho toi khi amendment 'approved'.

CREATE TABLE IF NOT EXISTS public.contract_amendments (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id    UUID NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
    version_id     TEXT NOT NULL,     -- "v0004" - version DOCX moi tao gan voi ban sua doi nay
    status         TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_approval', 'approved', 'rejected')),
    note           TEXT NOT NULL,     -- bat buoc khong rong (confirm_amendment luc promote)
    created_by     UUID,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    approved_by    UUID,
    approved_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_contract_amendments_contract_id
    ON public.contract_amendments (contract_id);
CREATE INDEX IF NOT EXISTS idx_contract_amendments_contract_status
    ON public.contract_amendments (contract_id, status);

NOTIFY pgrst, 'reload schema';
