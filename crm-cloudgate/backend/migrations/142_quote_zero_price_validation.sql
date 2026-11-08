-- Gia ban 0 la gia tri hop le. Chỉ blank/null/âm mới là thiếu hoặc không hợp lệ.

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
        RETURN v_quote;
    END IF;
    IF v_quote.status NOT IN ('draft', 'confirmed') THEN
        RAISE EXCEPTION 'quote_not_in_draft_status';
    END IF;

    SELECT count(*) INTO v_item_count FROM public.quote_items WHERE quote_id = p_quote_id;
    IF v_item_count = 0 OR v_quote.total_amount IS NULL OR v_quote.total_amount < 0 THEN
        RAISE EXCEPTION 'quote_missing_required_fields';
    END IF;

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
    v_invalid_gm_count INT;
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
    END IF;

    IF p_stage = 'review' AND v_quote.processing_stage = 'pricing' THEN
        IF v_item_count = 0 THEN
            RAISE EXCEPTION 'quote_missing_items';
        END IF;
        SELECT count(*) INTO v_invalid_price_count FROM public.quote_items
            WHERE quote_id = p_quote_id AND row_type = 'item' AND (unit_price IS NULL OR unit_price < 0);
        IF v_invalid_price_count > 0 THEN
            RAISE EXCEPTION 'quote_item_invalid_unit_price';
        END IF;
        SELECT count(*) INTO v_invalid_gm_count FROM public.quote_items
            WHERE quote_id = p_quote_id AND row_type = 'item'
              AND markup_percent IS NOT NULL AND markup_percent < -100;
        IF v_invalid_gm_count > 0 THEN
            RAISE EXCEPTION 'quote_item_invalid_markup';
        END IF;

        SELECT COALESCE(SUM(total_amount), 0) INTO v_recomputed_total
            FROM public.quote_items WHERE quote_id = p_quote_id AND row_type = 'item';
        IF v_recomputed_total IS NULL OR v_recomputed_total < 0 THEN
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
