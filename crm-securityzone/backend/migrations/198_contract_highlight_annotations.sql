-- "Word Editor trong AI Contract Review" (2026-10-27) - annotation TUONG MINH cho highlight
-- AI/Sale (ID/nguon/vi tri/version rieng trong DB, KHONG chi so text moi lan - xem plan muc 3).
-- 3 hanh dong tach rieng tren annotation AI: "Bo qua canh bao" (chi doi status),
-- "Xoa Highlight" (that su bo mau trong DOCX), "Xoa ghi chu" (chi xoa field note) - xem
-- contract_edit_service.py.

CREATE TABLE IF NOT EXISTS public.contract_highlight_annotations (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id         UUID NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
    version_id          TEXT,                     -- "v0003" (version hieu luc) hoac "draft:{session_id}" khi con dang nhap
    source              TEXT NOT NULL CHECK (source IN ('ai', 'sale')),
    category            TEXT,                     -- AI: ten field doi chieu/loai rui ro; Sale: NULL
    paragraph_anchor    TEXT,                     -- "p12" (global index, xem contract_docx_engine.describe_paragraphs) hoac so trang PDF ("page:3")
    char_start          INT,
    char_end            INT,
    excerpt             TEXT,                     -- snapshot text luc tao - tin hieu PHU de re-align, khong phai tieu chi duy nhat
    note                TEXT,
    status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'dismissed', 'removed')),
    created_by          UUID,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contract_highlight_annotations_contract_id
    ON public.contract_highlight_annotations (contract_id);
CREATE INDEX IF NOT EXISTS idx_contract_highlight_annotations_contract_status
    ON public.contract_highlight_annotations (contract_id, status);

NOTIFY pgrst, 'reload schema';
