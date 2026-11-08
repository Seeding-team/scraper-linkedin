-- ============================================================================
-- 190_service_catalog_item_workspaces.sql — Many-to-many Workspace assignment
-- cho danh muc dich vu (CRM Seeding Workspace refactor).
--
-- Quyet dinh da dong y (task "Refactor CRM Seeding Workspace Management"):
--  - 1 nhom san pham co the thuoc NHIEU workspace, KHONG tao ban ghi trung.
--  - Cap nhat quyen "replace-all": set moi THAY TOAN BO set cu.
--  - Sua 1 nhom => TAT CA con truc tiep (parent_id = nhom do; cay 2 cap)
--    nhan dung set moi (service_catalog_bundle_items la ghep compose, KHONG
--    la quan he chu so huu nen KHONG duoc dung de phan qua workspace).
--  - Cot cu `service_catalog_items.instance` (TEXT NOT NULL DEFAULT 'markee')
--    GIU NGUYEN lam "primary" (gia tri dai dien duy nhat) de 100% ma cu doc
--    van dung dung; be-service dieu phoi ca bang moi + cot cu.
--  - Toan bo assign CHAY TRONG 1 TRANSACTION duy nhat; khong them audit table.
--
-- An toan chay lai: IF NOT EXISTS / CREATE OR REPLACE / ON CONFLICT DO NOTHING.
-- Backfill: moi item nhan 1 dong giao di = gia tri legacy instance hien co
--   (KHONG sinh them, KHONG mat du lieu).
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.service_catalog_item_workspaces (
    item_id  UUID NOT NULL
        REFERENCES public.service_catalog_items(id) ON DELETE CASCADE,
    instance TEXT NOT NULL,
    PRIMARY KEY (item_id, instance)
);

-- Index truy van nhanh theo instance (tuong tu idx_%s_instance cua cac bang cu).
CREATE INDEX IF NOT EXISTS idx_service_catalog_item_workspaces_instance
    ON public.service_catalog_item_workspaces (instance);

-- RLS: convention cua repo (app chi dung service-role client) — tham khao
-- migration 175 `msc_sync_runs_service_role_only`.
DROP POLICY IF EXISTS service_catalog_item_workspaces_service_role_only
    ON public.service_catalog_item_workspaces;
CREATE POLICY service_catalog_item_workspaces_service_role_only
    ON public.service_catalog_item_workspaces
    FOR ALL TO service_role
    USING (true)
    WITH CHECK (true);

-- Backfill: 1 dong junction cho TAT CA item cu (group + product) — ban ghi
-- da ton tai theo legacy instance; chay lai khong bi trung nho PK composite.
INSERT INTO public.service_catalog_item_workspaces (item_id, instance)
SELECT i.id, i.instance
FROM public.service_catalog_items i
ON CONFLICT (item_id, instance) DO NOTHING;

-- ---------------------------------------------------------------------------
-- RPC: service_catalog_ws_assign(group_ids uuid[], instances text[],
--                                actor_id uuid DEFAULT NULL)
-- Chuc nang REPLACE-ALL (quyet dinh duoc phe duyet):
--   1. Chuan hoa instance: trim/lower/distinct; bo null/empty.
--   2. Set rong => RAISE => giao di rollback lam hang, KHONG the co "keep it if it's empty only" duoc.
--   3. Khoa (FOR UPDATE) cac NHOM duoc chon de 2 bulk-assign chay dong thoi
--      tren cung nhom khong ganh giao ngang (children khong can lock rieng:
--      chung do truyen sang theo nhom cha trong cung giao dich).
--   4. Targets = cac NHOM + TAT CA con truc tiep (parent_id = nhom do).
--   5. DELETE set cu + INSERT set moi cho moi target (REPLACE-ALL).
--   6. Mirror: cot cu `instance` = gia tri hien tai neu no van con trong set
--      moi, neu khong thi lay phan tu DAU TIEN cua set (xet den head theo
--      thu tu app truyen).
--   7. Stamp updated_at/updated_by (lan chinh sua moi nhat cho cac item
--      duoc gan de UI doc lai se thay ngay).
-- Loi (vd set rong) -> RAISE EXCEPTION -> giao dich rollback hoan toan.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.service_catalog_ws_assign(
    p_group_ids uuid[],
    p_instances text[],
    p_actor_id uuid DEFAULT NULL
)
RETURNS TABLE (item_id uuid, instance text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_normalized text[];
BEGIN
    SELECT coalesce(array_agg(DISTINCT trim(lower(x))), ARRAY[]::text[])
      INTO v_normalized
      FROM unnest(p_instances) AS x
     WHERE x IS NOT NULL AND trim(x) <> '';

    IF coalesce(array_length(v_normalized, 1), 0) = 0 THEN
        RAISE EXCEPTION 'ws_assign_empty_instances';
    END IF;

    -- Khoa cac NHOM duoc chon (FOR UPDATE) — serialize bulk-assign chong giao ngang.
    PERFORM 1
      FROM public.service_catalog_items g
     WHERE g.id = ANY (p_group_ids)
       FOR UPDATE;

    -- Targets: nhom chon + TAT CA con truc tiep (cay hai cap).
    -- DROP IF EXISTS: cho phep goi RPC nhieu lan trong CUNG mot giao dich
    -- (idempotent / retry) — tranh "ws_targets already exists" (phat hien
    -- khi test local ngay trong buong test co chua ROLLBACK).
    DROP TABLE IF EXISTS ws_targets;
    CREATE TEMP TABLE ws_targets ON COMMIT DROP AS
    SELECT DISTINCT i.id AS id
      FROM public.service_catalog_items i
     WHERE i.id = ANY (p_group_ids) OR i.parent_id = ANY (p_group_ids);

    DELETE FROM public.service_catalog_item_workspaces w
     USING ws_targets t
     WHERE w.item_id = t.id;

    INSERT INTO public.service_catalog_item_workspaces (item_id, instance)
    SELECT t.id, i
      FROM ws_targets t
      CROSS JOIN unnest(v_normalized) AS i;

    UPDATE public.service_catalog_items s
       SET instance =
               CASE WHEN s.instance = ANY (v_normalized) THEN s.instance
                    ELSE v_normalized[1] END,
           updated_at = now(),
           updated_by = p_actor_id
     WHERE s.id IN (SELECT id FROM ws_targets);

    RETURN QUERY
    SELECT w.item_id, w.instance
      FROM public.service_catalog_item_workspaces w
     WHERE w.item_id = ANY (p_group_ids)
     ORDER BY 1, 2;
END;
$$;

-- Chinh quyen: service_role full; bao ve (khong mo cho anon/authenticated bang
-- RPC nhung tat ca BE dang dung token service-role).
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        EXECUTE 'GRANT ALL ON FUNCTION public.service_catalog_ws_assign(uuid[], text[], uuid) TO service_role';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE 'REVOKE ALL ON FUNCTION public.service_catalog_ws_assign(uuid[], text[], uuid) FROM anon';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        EXECUTE 'REVOKE ALL ON FUNCTION public.service_catalog_ws_assign(uuid[], text[], uuid) FROM authenticated';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        REVOKE ALL ON public.service_catalog_item_workspaces FROM anon;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        REVOKE ALL ON public.service_catalog_item_workspaces FROM authenticated;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        GRANT ALL ON public.service_catalog_item_workspaces TO service_role;
    END IF;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
