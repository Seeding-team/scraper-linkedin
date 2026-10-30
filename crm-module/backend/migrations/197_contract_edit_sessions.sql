-- "Word Editor trong AI Contract Review" (2026-10-27, OnlyOffice self-host, xem
-- C:\Users\Asus\.claude\plans\proud-stargazing-pixel.md) - phien chinh sua DOCX song voi
-- OnlyOffice. Moi hop dong CHI 1 phien dang 'editing' tai 1 thoi diem (unique partial index
-- duoi) - tranh 2 Sale cung sua de nhau mot ban nhap.

CREATE TABLE IF NOT EXISTS public.contract_edit_sessions (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id                 UUID NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
    source_version_id           TEXT,                 -- "v0003" hoac tuong tu - phien ban DOCX hieu luc luc bat dau sua
    document_key                TEXT NOT NULL UNIQUE,  -- OnlyOffice document key (duy nhat theo noi dung + phien)
    draft_storage_key           TEXT NOT NULL,          -- key trong bucket contract-documents (contracts/{id}/_draft_{session}.docx)
    status                      TEXT NOT NULL DEFAULT 'editing' CHECK (status IN ('editing', 'promoted', 'discarded')),
    owner_user_id               UUID,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_autosaved_at           TIMESTAMPTZ,
    last_autosave_request_id    TEXT,                  -- nonce dang cho khi promote_to_version forcesave dong bo
    annotations_sync_status     TEXT NOT NULL DEFAULT 'idle' CHECK (annotations_sync_status IN ('idle', 'syncing', 'synced', 'error')),
    converted_from_pdf          BOOLEAN NOT NULL DEFAULT false
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_contract_edit_sessions_editing
    ON public.contract_edit_sessions (contract_id)
    WHERE status = 'editing';

CREATE INDEX IF NOT EXISTS idx_contract_edit_sessions_contract_id
    ON public.contract_edit_sessions (contract_id);

NOTIFY pgrst, 'reload schema';
