-- "Google Drive quan ly hop dong" (2026-10-26, yeu cau sep) - Phan A: dong bo file
-- goc len 1 Shared Drive dung chung. KHONG BAO GIO ghi de file da luu (nguyen tac
-- #2 trong plan) - 1 hop dong co the co NHIEU file Drive theo thoi gian (goc +
-- cac ban AI Highlight sau nay), nen tach bang rieng thay vi 1 cot drive_file_id
-- duy nhat tren contracts.

ALTER TABLE public.contracts
    ADD COLUMN IF NOT EXISTS drive_folder_id TEXT;

-- 1 hop dong -> nhieu file Drive (goc, AI Highlight v1/v2/...). content_hash (SHA256)
-- dung de chong tao trung THAT SU theo noi dung, khong chi theo ten file.
CREATE TABLE IF NOT EXISTS public.contract_drive_files (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id     UUID NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
    drive_file_id   TEXT NOT NULL,
    file_name       TEXT NOT NULL,
    file_type       TEXT NOT NULL CHECK (file_type IN ('original', 'ai_highlight')),
    content_hash    TEXT NOT NULL,
    source_bucket   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contract_drive_files_contract_id ON public.contract_drive_files (contract_id);
CREATE INDEX IF NOT EXISTS idx_contract_drive_files_content_hash ON public.contract_drive_files (contract_id, content_hash);

-- Job BEN VUNG (song qua restart backend) - worker APScheduler poll bang nay thay vi
-- chi dung FastAPI BackgroundTasks (mat job neu backend restart giua chung).
CREATE TABLE IF NOT EXISTS public.contract_drive_sync_jobs (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id      UUID NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
    status           TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'error')),
    attempts         INT NOT NULL DEFAULT 0,
    next_attempt_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_error       TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contract_drive_sync_jobs_pending
    ON public.contract_drive_sync_jobs (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_contract_drive_sync_jobs_contract_id
    ON public.contract_drive_sync_jobs (contract_id);

NOTIFY pgrst, 'reload schema';
