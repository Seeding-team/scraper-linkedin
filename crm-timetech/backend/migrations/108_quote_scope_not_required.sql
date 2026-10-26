-- Yeu cau nguoi dung: "Yeu cau & pham vi cong viec" (Tom tat nhu cau /
-- Mo ta scope) KHONG con bat buoc phai nhap truoc khi chuyen tu buoc
-- "Thong tin ky thuat" (technical) sang "Hoan thien gia ban" (pricing).
--
-- CREATE OR REPLACE toan bo ham quote_set_processing_stage() tu migration
-- 104 (ban gan nhat), CHI XOA doan kiem tra v_has_scope/RAISE EXCEPTION
-- 'quote_missing_scope' - MOI dieu kien khac (so luong hang muc, SL/gia
-- von hop le, checklist ban giao, dieu khoan thanh toan, tong tien...) GIU
-- NGUYEN khong doi.
--
-- CHUA apply migration nay len DB dung chung cho toi khi duoc xac nhan rieng.

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
    v_missing_cost_count INT;
    v_checklist public.quote_handoff_checklist;
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

    SELECT count(*) INTO v_item_count FROM public.quote_items WHERE quote_id = p_quote_id AND row_type = 'item';

    IF p_stage = 'pricing' AND v_quote.processing_stage = 'technical' THEN
        -- BO KIEM TRA "quote_missing_scope" theo yeu cau - Yeu cau & pham vi
        -- cong viec khong con bat buoc phai nhap o buoc nay nua.
        IF v_item_count = 0 THEN
            RAISE EXCEPTION 'quote_missing_items';
        END IF;
        SELECT count(*) INTO v_invalid_qty_count FROM public.quote_items
            WHERE quote_id = p_quote_id AND row_type = 'item' AND (quantity IS NULL OR quantity <= 0);
        IF v_invalid_qty_count > 0 THEN
            RAISE EXCEPTION 'quote_item_invalid_quantity';
        END IF;
        SELECT count(*) INTO v_invalid_cost_count FROM public.quote_items
            WHERE quote_id = p_quote_id AND row_type = 'item' AND cost_price IS NOT NULL AND cost_price < 0;
        IF v_invalid_cost_count > 0 THEN
            RAISE EXCEPTION 'quote_item_invalid_cost_price';
        END IF;
        SELECT count(*) INTO v_missing_cost_count FROM public.quote_items
            WHERE quote_id = p_quote_id AND row_type = 'item'
              AND cost_not_applicable = false AND cost_price IS NULL;
        IF v_missing_cost_count > 0 THEN
            RAISE EXCEPTION 'quote_item_missing_cost_price';
        END IF;

        SELECT * INTO v_checklist FROM public.quote_handoff_checklist WHERE quote_id = p_quote_id;
        IF v_checklist IS NULL
           OR NOT (v_checklist.scope_confirmed AND v_checklist.cost_confirmed
                   AND v_checklist.timeline_confirmed AND v_checklist.assumption_confirmed) THEN
            RAISE EXCEPTION 'quote_handoff_checklist_incomplete';
        END IF;
    END IF;

    IF p_stage = 'review' AND v_quote.processing_stage = 'pricing' THEN
        IF v_item_count = 0 THEN
            RAISE EXCEPTION 'quote_missing_items';
        END IF;
        SELECT count(*) INTO v_invalid_price_count FROM public.quote_items
            WHERE quote_id = p_quote_id AND row_type = 'item' AND (unit_price IS NULL OR unit_price <= 0);
        IF v_invalid_price_count > 0 THEN
            RAISE EXCEPTION 'quote_item_invalid_unit_price';
        END IF;
        SELECT count(*) INTO v_invalid_cost_count FROM public.quote_items
            WHERE quote_id = p_quote_id AND row_type = 'item'
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
            FROM public.quote_items WHERE quote_id = p_quote_id AND row_type = 'item';
        IF v_recomputed_total IS NULL OR v_recomputed_total <= 0 THEN
            RAISE EXCEPTION 'quote_invalid_total_amount';
        END IF;
        UPDATE public.quotes SET subtotal_amount = (
                SELECT COALESCE(SUM(subtotal_amount), 0) FROM public.quote_items
                WHERE quote_id = p_quote_id AND row_type = 'item'
            ), vat_amount = (
                SELECT COALESCE(SUM(vat_amount), 0) FROM public.quote_items
                WHERE quote_id = p_quote_id AND row_type = 'item'
            ), total_amount = v_recomputed_total
        WHERE id = p_quote_id;
    END IF;

    UPDATE public.quotes SET
        processing_stage = p_stage,
        updated_by = p_actor_id,
        requested_changes_target_stage = NULL,
        requested_changes_reason = NULL
    WHERE id = p_quote_id
    RETURNING * INTO v_quote;

    INSERT INTO public.quote_activity_log (quote_id, actor_id, action, changes)
    VALUES (p_quote_id, p_actor_id, 'stage_changed', jsonb_build_object('stage', p_stage));

    RETURN v_quote;
END;
$$;
