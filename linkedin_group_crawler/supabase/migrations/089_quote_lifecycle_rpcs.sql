-- RPC that cho toan bo phan Phase 1/2/3 con thieu: cancel/revoke-public/
-- soft-delete/restore/hard-delete (Phase 1), validate du lieu that khi
-- chuyen stage (Phase 2), request-changes/approve tach khoi publish/publish
-- rieng (Phase 3). MIGRATION MOI, khong sua RPC cu bang each - dinh nghia
-- lai bang CREATE OR REPLACE (dung pattern da lam o 084/085 khi can doi
-- logic 1 ham da co, KHONG xoa lich su).
--
-- CHUA APPLY len production/dev - chi chuan bi code, cho TEST_SUPABASE_URL.
--
-- LUU Y quan trong ve phan quyen: cac RPC nay kiem tra DU LIEU/TRANG THAI
-- (state machine that o tang DB, khong the bi bo qua du goi thang RPC).
-- Kiem tra QUYEN (actor co phai admin/technical_owner/quote_owner/co co
-- can_approve_quotes hay khong) VAN nam o tang Python
-- (crm_permission_service.py) truoc khi router goi RPC - giu dung kien truc
-- hien co (vd quote_approve tu truoc gio khong tu kiem tra quyen, Python
-- lam viec do qua can_approve_quote() roi moi goi RPC). Ly do: RPC khong co
-- khai niem "role/co quyen" cua HTTP request, chi co p_actor_id (chi la 1
-- UUID) - kiem tra quyen dua vao bang app_users can lam o Python de tai su
-- dung ho tro/cache da co (get_user_team_types, has_full_crm_access...).

-- ─────────────────────────────────────────────────────────────────────────
-- 1) HUY BAO GIA (khong hard-delete) - bat buoc ly do, tat public link.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.quote_cancel(
    p_quote_id UUID, p_actor_id UUID, p_reason TEXT
) RETURNS public.quotes
LANGUAGE plpgsql
AS $$
DECLARE
    v_quote public.quotes;
BEGIN
    IF p_reason IS NULL OR btrim(p_reason) = '' THEN
        RAISE EXCEPTION 'cancellation_reason_required';
    END IF;

    SELECT * INTO v_quote FROM public.quotes WHERE id = p_quote_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'quote_not_found';
    END IF;
    IF v_quote.status = 'cancelled' THEN
        RETURN v_quote; -- idempotent
    END IF;

    UPDATE public.quotes SET
        status = 'cancelled',
        cancellation_reason = p_reason,
        cancelled_at = NOW(),
        cancelled_by = p_actor_id,
        public_enabled = false,
        updated_by = p_actor_id
    WHERE id = p_quote_id
    RETURNING * INTO v_quote;

    INSERT INTO public.quote_activity_log (quote_id, actor_id, action, changes)
    VALUES (p_quote_id, p_actor_id, 'cancelled', jsonb_build_object('reason', p_reason));

    RETURN v_quote;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 2) HUY CONG KHAI (tat public link, KHONG xoa quote) - public API phai
--    tra ve khong truy cap duoc NGAY sau khi goi (get_public_quote da loc
--    .eq('public_enabled', True) tu truoc, nen chi can flip co la du).
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.quote_revoke_public(
    p_quote_id UUID, p_actor_id UUID
) RETURNS public.quotes
LANGUAGE plpgsql
AS $$
DECLARE
    v_quote public.quotes;
BEGIN
    SELECT * INTO v_quote FROM public.quotes WHERE id = p_quote_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'quote_not_found';
    END IF;
    IF NOT v_quote.public_enabled THEN
        RETURN v_quote; -- idempotent
    END IF;

    UPDATE public.quotes SET public_enabled = false, updated_by = p_actor_id
    WHERE id = p_quote_id
    RETURNING * INTO v_quote;

    INSERT INTO public.quote_activity_log (quote_id, actor_id, action, changes)
    VALUES (p_quote_id, p_actor_id, 'public_revoked', NULL);

    RETURN v_quote;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 3) SOFT DELETE + RESTORE - list/get/public/version/KPI deu phai loc
--    deleted_at IS NULL (thuc hien o tang Python, xem supabase_quote_service.py).
--    Mo lai duoc bang restore, quote_number KHONG bi tai su dung vi row van
--    con ton tai (chi an di), _next_quote_number() van thay no khi kiem tra
--    trung ma.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.quote_soft_delete(
    p_quote_id UUID, p_actor_id UUID, p_reason TEXT
) RETURNS public.quotes
LANGUAGE plpgsql
AS $$
DECLARE
    v_quote public.quotes;
BEGIN
    SELECT * INTO v_quote FROM public.quotes WHERE id = p_quote_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'quote_not_found';
    END IF;
    IF v_quote.deleted_at IS NOT NULL THEN
        RETURN v_quote; -- idempotent
    END IF;

    UPDATE public.quotes SET
        deleted_at = NOW(),
        deleted_by = p_actor_id
    WHERE id = p_quote_id
    RETURNING * INTO v_quote;

    INSERT INTO public.quote_activity_log (quote_id, actor_id, action, changes)
    VALUES (p_quote_id, p_actor_id, 'soft_deleted', jsonb_build_object('reason', p_reason));

    RETURN v_quote;
END;
$$;

CREATE OR REPLACE FUNCTION public.quote_restore(
    p_quote_id UUID, p_actor_id UUID
) RETURNS public.quotes
LANGUAGE plpgsql
AS $$
DECLARE
    v_quote public.quotes;
BEGIN
    SELECT * INTO v_quote FROM public.quotes WHERE id = p_quote_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'quote_not_found';
    END IF;
    IF v_quote.deleted_at IS NULL THEN
        RETURN v_quote; -- idempotent
    END IF;

    UPDATE public.quotes SET deleted_at = NULL, deleted_by = NULL
    WHERE id = p_quote_id
    RETURNING * INTO v_quote;

    INSERT INTO public.quote_activity_log (quote_id, actor_id, action, changes)
    VALUES (p_quote_id, p_actor_id, 'restored', NULL);

    RETURN v_quote;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 4) HARD DELETE that (chi admin, xem Python router) - doc lai + doi chieu
--    quote_number nguoi goi gui len, ghi quote_deletion_audit TRUOC (cung 1
--    transaction) roi moi DELETE that. quote_items tu xoa theo qua
--    ON DELETE CASCADE da co san tren quote_items.quote_id (migration 028).
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.quote_hard_delete(
    p_quote_id UUID, p_actor_id UUID, p_quote_number_confirm TEXT,
    p_reason TEXT, p_request_id TEXT
) RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_quote public.quotes;
    v_items JSONB;
    v_snapshot JSONB;
BEGIN
    IF p_reason IS NULL OR btrim(p_reason) = '' THEN
        RAISE EXCEPTION 'hard_delete_reason_required';
    END IF;

    SELECT * INTO v_quote FROM public.quotes WHERE id = p_quote_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'quote_not_found';
    END IF;
    IF v_quote.quote_number IS DISTINCT FROM p_quote_number_confirm THEN
        RAISE EXCEPTION 'quote_number_mismatch';
    END IF;

    SELECT COALESCE(jsonb_agg(to_jsonb(qi)), '[]'::jsonb) INTO v_items
    FROM public.quote_items qi WHERE qi.quote_id = p_quote_id;

    v_snapshot := jsonb_build_object('quote', to_jsonb(v_quote), 'items', v_items);

    INSERT INTO public.quote_deletion_audit (quote_id, quote_number, actor_id, reason, snapshot, request_id)
    VALUES (p_quote_id, v_quote.quote_number, p_actor_id, p_reason, v_snapshot, p_request_id);

    -- Xoa THAT - quote_items cascade tu dong, quote_activity_log cascade tu
    -- dong (co ti nh, bang chung chinh la quote_deletion_audit o tren, KHONG
    -- phai quote_activity_log vi bang do cascade theo quotes.id).
    DELETE FROM public.quotes WHERE id = p_quote_id;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 5) YEU CAU CHINH SUA (Phase 3.B) - chi tu buoc 'review' (chua duyet) lui
--    ve 'technical' hoac 'pricing'. Khong dung cho quote da approved (dung
--    Yeu cau chinh sua truoc khi duyet, KHONG phai sau khi da duyet).
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.quote_request_changes(
    p_quote_id UUID, p_actor_id UUID, p_target_stage TEXT, p_reason TEXT
) RETURNS public.quotes
LANGUAGE plpgsql
AS $$
DECLARE
    v_quote public.quotes;
BEGIN
    IF p_reason IS NULL OR btrim(p_reason) = '' THEN
        RAISE EXCEPTION 'request_changes_reason_required';
    END IF;
    IF p_target_stage NOT IN ('technical', 'pricing') THEN
        RAISE EXCEPTION 'invalid_request_changes_target_stage';
    END IF;

    SELECT * INTO v_quote FROM public.quotes WHERE id = p_quote_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'quote_not_found';
    END IF;
    IF v_quote.status <> 'draft' THEN
        RAISE EXCEPTION 'quote_already_approved';
    END IF;
    IF v_quote.processing_stage <> 'review' THEN
        RAISE EXCEPTION 'quote_not_in_review_stage';
    END IF;

    UPDATE public.quotes SET
        processing_stage = p_target_stage,
        requested_changes_target_stage = p_target_stage,
        requested_changes_reason = p_reason,
        requested_changes_at = NOW(),
        requested_changes_by = p_actor_id,
        updated_by = p_actor_id
    WHERE id = p_quote_id
    RETURNING * INTO v_quote;

    INSERT INTO public.quote_activity_log (quote_id, actor_id, action, changes)
    VALUES (p_quote_id, p_actor_id, 'changes_requested',
            jsonb_build_object('target_stage', p_target_stage, 'reason', p_reason));

    RETURN v_quote;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 6) APPROVE dinh nghia lai - KHONG con tu bat public link/token nua (tach
--    rieng khoi publish theo dung yeu cau). processing_stage ->
--    'ready_to_publish' (khong con dung 'review' + nhan FE gia nua).
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.quote_approve(
    p_quote_id UUID, p_actor_id UUID, p_public_token TEXT
) RETURNS public.quotes
LANGUAGE plpgsql
AS $$
DECLARE
    v_quote public.quotes;
    v_item_count INT;
BEGIN
    SELECT * INTO v_quote FROM public.quotes WHERE id = p_quote_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'quote_not_found';
    END IF;
    IF v_quote.status = 'approved' THEN
        RETURN v_quote; -- idempotent - khong tao them log/doi processing_stage neu da approved
    END IF;
    IF v_quote.status NOT IN ('draft', 'confirmed') THEN
        RAISE EXCEPTION 'quote_not_in_draft_status';
    END IF;

    SELECT count(*) INTO v_item_count FROM public.quote_items WHERE quote_id = p_quote_id;
    IF v_item_count = 0 OR v_quote.total_amount IS NULL OR v_quote.total_amount <= 0 THEN
        RAISE EXCEPTION 'quote_missing_required_fields';
    END IF;

    -- p_public_token nhan tham so de tuong thich chu ky cu (Python van truyen
    -- vao) nhung KHONG con dung de bat public_token/public_enabled nua - viec
    -- do chuyen sang quote_publish() rieng.
    UPDATE public.quotes SET
        status = 'approved',
        approved_by = p_actor_id,
        approved_at = NOW(),
        processing_stage = 'ready_to_publish'
    WHERE id = p_quote_id
    RETURNING * INTO v_quote;

    INSERT INTO public.quote_activity_log (quote_id, actor_id, action, changes)
    VALUES (p_quote_id, p_actor_id, 'approved', NULL);

    RETURN v_quote;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 7) PUBLISH rieng - chi tu approved (status='approved'), sinh/bat
--    public_token/public_enabled that su o day, processing_stage ->
--    'published'. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.quote_publish(
    p_quote_id UUID, p_actor_id UUID, p_public_token TEXT
) RETURNS public.quotes
LANGUAGE plpgsql
AS $$
DECLARE
    v_quote public.quotes;
BEGIN
    SELECT * INTO v_quote FROM public.quotes WHERE id = p_quote_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'quote_not_found';
    END IF;
    IF v_quote.status <> 'approved' THEN
        RAISE EXCEPTION 'quote_must_be_approved_before_publish';
    END IF;
    IF v_quote.processing_stage = 'published' THEN
        RETURN v_quote; -- idempotent
    END IF;

    UPDATE public.quotes SET
        public_token = COALESCE(public_token, p_public_token),
        public_enabled = true,
        processing_stage = 'published',
        published_at = NOW(),
        published_by = p_actor_id
    WHERE id = p_quote_id
    RETURNING * INTO v_quote;

    INSERT INTO public.quote_activity_log (quote_id, actor_id, action, changes)
    VALUES (p_quote_id, p_actor_id, 'published', NULL);

    RETURN v_quote;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 8) quote_set_processing_stage dinh nghia lai - THEM validate du lieu that
--    khi chuyen technical->pricing va pricing->review (khong chi kiem tra
--    thu tu stage nhu ban cu). "Actor dung quyen" van kiem o tang Python
--    truoc khi goi RPC nay (xem comment dau file).
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.quote_set_processing_stage(
    p_quote_id UUID, p_actor_id UUID, p_stage TEXT
) RETURNS public.quotes
LANGUAGE plpgsql
AS $$
DECLARE
    v_quote public.quotes;
    v_order TEXT[] := ARRAY['request', 'technical', 'pricing', 'review'];
    v_current_idx INT;
    v_target_idx INT;
    v_item_count INT;
    v_invalid_qty_count INT;
    v_invalid_cost_count INT;
    v_invalid_price_count INT;
    v_checklist public.quote_handoff_checklist;
    v_has_scope BOOLEAN;
    v_has_payment_terms BOOLEAN;
    v_recomputed_total NUMERIC;
BEGIN
    SELECT * INTO v_quote FROM public.quotes WHERE id = p_quote_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'quote_not_found';
    END IF;
    IF v_quote.status <> 'draft' THEN
        RAISE EXCEPTION 'quote_not_in_draft_status';
    END IF;

    v_current_idx := array_position(v_order, v_quote.processing_stage);
    v_target_idx := array_position(v_order, p_stage);
    IF v_target_idx IS NULL THEN
        RAISE EXCEPTION 'invalid_processing_stage';
    END IF;
    IF v_target_idx < v_current_idx THEN
        RAISE EXCEPTION 'processing_stage_cannot_go_backward';
    END IF;

    SELECT count(*) INTO v_item_count FROM public.quote_items WHERE quote_id = p_quote_id AND parent_item_id IS NULL;

    -- technical -> pricing: co scope, co item, quantity>0, cost hop le (>=0,
    -- da co CHECK o quote_items tu migration 086 nen chi can dam bao khong
    -- NULL het), checklist 4/4.
    IF p_stage = 'pricing' AND v_quote.processing_stage = 'technical' THEN
        v_has_scope := COALESCE(btrim(v_quote.data->>'requestSummary'), '') <> ''
            OR EXISTS (
                SELECT 1 FROM jsonb_array_elements(COALESCE(v_quote.data->'customBlocks', '[]'::jsonb)) b
                WHERE b->>'kind' = 'scope_of_work' AND btrim(COALESCE(b->>'content', '')) <> ''
            );
        IF NOT v_has_scope THEN
            RAISE EXCEPTION 'quote_missing_scope';
        END IF;
        IF v_item_count = 0 THEN
            RAISE EXCEPTION 'quote_missing_items';
        END IF;
        SELECT count(*) INTO v_invalid_qty_count FROM public.quote_items
            WHERE quote_id = p_quote_id AND parent_item_id IS NULL AND (quantity IS NULL OR quantity <= 0);
        IF v_invalid_qty_count > 0 THEN
            RAISE EXCEPTION 'quote_item_invalid_quantity';
        END IF;
        SELECT count(*) INTO v_invalid_cost_count FROM public.quote_items
            WHERE quote_id = p_quote_id AND parent_item_id IS NULL AND cost_price IS NOT NULL AND cost_price < 0;
        IF v_invalid_cost_count > 0 THEN
            RAISE EXCEPTION 'quote_item_invalid_cost_price';
        END IF;

        SELECT * INTO v_checklist FROM public.quote_handoff_checklist WHERE quote_id = p_quote_id;
        IF v_checklist IS NULL
           OR NOT (v_checklist.scope_confirmed AND v_checklist.cost_confirmed
                   AND v_checklist.timeline_confirmed AND v_checklist.assumption_confirmed) THEN
            RAISE EXCEPTION 'quote_handoff_checklist_incomplete';
        END IF;
    END IF;

    -- pricing -> review: co item, unit_price>0, markup hop le, payment terms
    -- hop le, tinh lai total server-side (khong tin gia tri dang luu neu lech).
    IF p_stage = 'review' AND v_quote.processing_stage = 'pricing' THEN
        IF v_item_count = 0 THEN
            RAISE EXCEPTION 'quote_missing_items';
        END IF;
        SELECT count(*) INTO v_invalid_price_count FROM public.quote_items
            WHERE quote_id = p_quote_id AND parent_item_id IS NULL AND (unit_price IS NULL OR unit_price <= 0);
        IF v_invalid_price_count > 0 THEN
            RAISE EXCEPTION 'quote_item_invalid_unit_price';
        END IF;
        SELECT count(*) INTO v_invalid_cost_count FROM public.quote_items
            WHERE quote_id = p_quote_id AND parent_item_id IS NULL
              AND markup_percent IS NOT NULL AND markup_percent < -100;
        IF v_invalid_cost_count > 0 THEN
            RAISE EXCEPTION 'quote_item_invalid_markup';
        END IF;

        v_has_payment_terms := EXISTS (
            SELECT 1 FROM jsonb_array_elements(COALESCE(v_quote.data->'customBlocks', '[]'::jsonb)) b
            WHERE b->>'kind' = 'payment_terms' AND btrim(COALESCE(b->>'content', '')) <> ''
        );
        IF NOT v_has_payment_terms THEN
            RAISE EXCEPTION 'quote_missing_payment_terms';
        END IF;

        SELECT COALESCE(SUM(total_amount), 0) INTO v_recomputed_total
            FROM public.quote_items WHERE quote_id = p_quote_id AND parent_item_id IS NULL;
        IF v_recomputed_total IS NULL OR v_recomputed_total <= 0 THEN
            RAISE EXCEPTION 'quote_invalid_total_amount';
        END IF;
        -- Ghi de bang so tinh lai TU SERVER (khong tin total_amount dang luu
        -- neu vi ly do nao do bi lech) - dung yeu cau "khong tin total tu client".
        UPDATE public.quotes SET subtotal_amount = (
                SELECT COALESCE(SUM(subtotal_amount), 0) FROM public.quote_items
                WHERE quote_id = p_quote_id AND parent_item_id IS NULL
            ), vat_amount = (
                SELECT COALESCE(SUM(vat_amount), 0) FROM public.quote_items
                WHERE quote_id = p_quote_id AND parent_item_id IS NULL
            ), total_amount = v_recomputed_total
        WHERE id = p_quote_id;
    END IF;

    UPDATE public.quotes SET
        processing_stage = p_stage,
        updated_by = p_actor_id,
        -- Chuyen stage tien = da xu ly xong yeu cau chinh sua truoc do (neu co).
        requested_changes_target_stage = NULL,
        requested_changes_reason = NULL
    WHERE id = p_quote_id
    RETURNING * INTO v_quote;

    INSERT INTO public.quote_activity_log (quote_id, actor_id, action, changes)
    VALUES (p_quote_id, p_actor_id, 'stage_changed', jsonb_build_object('stage', p_stage));

    RETURN v_quote;
END;
$$;
