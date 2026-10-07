-- =================================================================================
-- Migration 166: MSC → CRM Product Synchronization (external identity + audit)
-- =================================================================================
-- ADDITIVE ONLY — khong sua/cap nhat/xoa du lieu co, khong doi column hien co.
--
-- 1) service_catalog_items: 2 cot danh tinh NGUON NGOAI de dong bo MSC → CRM
--    an toan (upsert theo MSC item.id / group.id, khong dung name+brand+model
--    lam khoa vi MSC co the chua ban ghi trung nhau).
-- 2) msc_sync_runs: nhat ky moi lan dong bo (manual/scheduled) de truy vết
--    ket qua, so luong insert/update/skip/failed va thoi gian chay.
--
-- MSC (mua-sam-cong) KHONG bi anh huong: migration nay chi chay tren DB CRM.
-- =================================================================================

BEGIN;

-- 1. Danh tinh nguon ngoai tren service_catalog_items -----------------------------
ALTER TABLE public.service_catalog_items
    ADD COLUMN IF NOT EXISTS external_source TEXT,
    ADD COLUMN IF NOT EXISTS external_id TEXT;

-- Token chong trung lap: 1 dong CRM chi gan DUY NHAT 1 ban ghi MSC.
-- Partial index (chi ap dung cho row co external identity) de khong anh huong
-- cac row thuong khong co external_source/external_id.
CREATE UNIQUE INDEX IF NOT EXISTS uq_service_catalog_items_external_identity
    ON public.service_catalog_items (external_source, external_id)
    WHERE external_source IS NOT NULL AND external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_service_catalog_items_external_source
    ON public.service_catalog_items (external_source);

-- 2. Nhat ky chay dong bo MSC -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.msc_sync_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trigger_type TEXT NOT NULL CHECK (trigger_type IN ('manual', 'scheduled')),
    user_id UUID,
    dry_run BOOLEAN NOT NULL DEFAULT false,
    status TEXT NOT NULL CHECK (status IN ('running', 'success', 'partial', 'failed')),
    http_status INT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    duration_ms INT CHECK (duration_ms >= 0),
    fetched_groups INT CHECK (fetched_groups >= 0),
    fetched_items INT CHECK (fetched_items >= 0),
    groups_created INT CHECK (groups_created >= 0),
    groups_updated INT CHECK (groups_updated >= 0),
    inserted INT CHECK (inserted >= 0),
    updated INT CHECK (updated >= 0),
    skipped INT CHECK (skipped >= 0),
    failed INT CHECK (failed >= 0),
    duplicates INT CHECK (duplicates >= 0),
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_msc_sync_runs_started_at
    ON public.msc_sync_runs (started_at DESC);

ALTER TABLE public.msc_sync_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS msc_sync_runs_service_role_only ON public.msc_sync_runs;
CREATE POLICY msc_sync_runs_service_role_only
    ON public.msc_sync_runs
    FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMIT;
