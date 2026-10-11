-- Yeu cau nguoi dung: "Dieu khoan thanh toan" (payment_terms custom block)
-- KHONG con bat buoc phai co truoc khi chuyen tu buoc "Hoan thien gia ban"
-- (pricing) sang "Cho duyet" (review). Neu co van luu/hien thi binh thuong;
-- neu khong co, preview/PDF tu an muc do (khong render block rong).
--
-- CREATE OR REPLACE toan bo ham quote_set_processing_stage() tu migration
-- 108 (ban gan nhat, DA APPLY THAT len DB dung chung), CHI XOA doan kiem tra
-- v_has_payment_terms/RAISE EXCEPTION 'quote_missing_payment_terms' o nhanh
-- pricing->review - MOI dieu kien khac (bao gom viec BO kiem tra scope da
-- lam o migration 108) GIU NGUYEN khong doi.
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

        -- BO KIEM TRA "quote_missing_payment_terms" theo yeu cau - Dieu khoan
        -- thanh toan khong con bat buoc phai co o buoc nay nua (co thi van
        -- luu/hien thi binh thuong, khong co thi preview/PDF tu an muc).

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
