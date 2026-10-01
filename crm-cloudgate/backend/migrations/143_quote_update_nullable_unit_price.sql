-- Preserve blank selling price as NULL. Price 0 remains valid and distinct.

ALTER TABLE public.quote_items ALTER COLUMN unit_price DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.quote_update(
    p_quote_id UUID, p_actor_id UUID, p_data JSONB, p_items JSONB, p_changes JSONB,
    p_issuer_company_id UUID DEFAULT NULL
) RETURNS public.quotes
LANGUAGE plpgsql
AS $$
DECLARE
    v_quote public.quotes;
    v_subtotal NUMERIC := 0;
    v_discount NUMERIC := 0;
    v_vat NUMERIC := 0;
    v_total NUMERIC := 0;
    v_item JSONB;
    v_child JSONB;
    v_parent_id UUID;
    v_parent_index INT := 0;
    v_child_index INT;
    v_qty NUMERIC;
    v_unit_price NUMERIC;
    v_vat_rate NUMERIC;
    v_discount_pct NUMERIC;
    v_cost_price NUMERIC;
    v_markup_percent NUMERIC;
    v_cost_not_applicable BOOLEAN;
    v_row_type TEXT;
    v_item_subtotal NUMERIC;
    v_item_discount NUMERIC;
    v_item_after_discount NUMERIC;
    v_item_vat NUMERIC;
    v_item_total NUMERIC;
BEGIN
    SELECT * INTO v_quote FROM public.quotes WHERE id = p_quote_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'quote_not_found';
    END IF;
    IF v_quote.status = 'approved' THEN
        RAISE EXCEPTION 'quote_already_approved';
    END IF;

    DELETE FROM public.quote_items WHERE quote_id = p_quote_id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) LOOP
        v_row_type := CASE WHEN v_item->>'row_type' = 'section' THEN 'section' ELSE 'item' END;
        v_qty := COALESCE((v_item->>'quantity')::numeric, 0);
        v_unit_price := CASE
            WHEN v_item ? 'unit_price' AND NULLIF(v_item->>'unit_price', '') IS NOT NULL
                THEN ROUND((v_item->>'unit_price')::numeric, 0)
            ELSE NULL
        END;
        v_vat_rate := COALESCE((v_item->>'vat_rate')::numeric, 0);
        v_discount_pct := COALESCE((v_item->>'discount_percent')::numeric, 0);
        v_cost_price := NULLIF(v_item->>'cost_price', '')::numeric;
        v_markup_percent := ROUND(NULLIF(v_item->>'markup_percent', '')::numeric, 2);
        v_cost_not_applicable := COALESCE((v_item->>'cost_not_applicable')::boolean, false);

        IF v_row_type = 'section' THEN
            v_qty := 0;
            v_unit_price := 0;
            v_vat_rate := 0;
            v_discount_pct := 0;
            v_cost_price := NULL;
            v_markup_percent := NULL;
            v_cost_not_applicable := false;
        END IF;

        IF v_discount_pct < 0 OR v_discount_pct > 100 OR v_vat_rate < 0 OR v_vat_rate > 100 THEN
            RAISE EXCEPTION 'quote_item_invalid_percent';
        END IF;
        IF v_qty < 0 OR (v_unit_price IS NOT NULL AND v_unit_price < 0) THEN
            RAISE EXCEPTION 'quote_item_invalid_amount';
        END IF;
        IF v_cost_price IS NOT NULL AND v_cost_price < 0 THEN
            RAISE EXCEPTION 'quote_item_invalid_cost_price';
        END IF;
        IF v_markup_percent IS NOT NULL AND v_markup_percent < -100 THEN
            RAISE EXCEPTION 'quote_item_invalid_markup';
        END IF;
        IF v_cost_price IS NULL THEN
            v_markup_percent := NULL;
        END IF;
        IF v_cost_not_applicable THEN
            v_cost_price := NULL;
            v_markup_percent := NULL;
        END IF;

        v_item_subtotal := ROUND(v_qty * COALESCE(v_unit_price, 0), 0);
        v_item_discount := ROUND(v_item_subtotal * v_discount_pct / 100, 0);
        v_item_after_discount := v_item_subtotal - v_item_discount;
        v_item_vat := ROUND(v_item_after_discount * v_vat_rate / 100, 0);
        v_item_total := v_item_after_discount + v_item_vat;

        INSERT INTO public.quote_items (
            quote_id, parent_item_id, row_type, description, service_description, note, warranty_scope, unit, quantity, unit_price,
            discount_percent, discount_amount, amount_after_discount, vat_rate,
            subtotal_amount, vat_amount, total_amount, sort_order,
            catalog_item_id, bundle_snapshot, list_price_usd, unit_price_usd, exchange_rate, unit_price_vnd,
            cost_price, markup_percent, cost_not_applicable
        ) VALUES (
            p_quote_id, NULL, v_row_type,
            COALESCE(v_item->>'description', ''),
            v_item->>'service_description',
            v_item->>'note', NULLIF(BTRIM(v_item->>'warranty_scope'), ''),
            v_item->>'unit',
            v_qty, v_unit_price, v_discount_pct, v_item_discount, v_item_after_discount, v_vat_rate,
            v_item_subtotal, v_item_vat, v_item_total, v_parent_index,
            NULLIF(v_item->>'catalog_item_id', '')::uuid,
            v_item->'bundle_snapshot',
            (v_item->>'list_price_usd')::numeric,
            (v_item->>'unit_price_usd')::numeric,
            (v_item->>'exchange_rate')::numeric,
            (v_item->>'unit_price_vnd')::numeric,
            v_cost_price, v_markup_percent, v_cost_not_applicable
        )
        RETURNING id INTO v_parent_id;

        v_subtotal := v_subtotal + v_item_subtotal;
        v_discount := v_discount + v_item_discount;
        v_vat := v_vat + v_item_vat;
        v_total := v_total + v_item_total;

        v_child_index := 0;
        FOR v_child IN SELECT * FROM jsonb_array_elements(COALESCE(v_item->'children', '[]'::jsonb)) LOOP
            v_qty := COALESCE((v_child->>'quantity')::numeric, 0);
            v_unit_price := CASE
                WHEN v_child ? 'unit_price' AND NULLIF(v_child->>'unit_price', '') IS NOT NULL
                    THEN ROUND((v_child->>'unit_price')::numeric, 0)
                ELSE NULL
            END;
            v_vat_rate := COALESCE((v_child->>'vat_rate')::numeric, 0);
            v_discount_pct := COALESCE((v_child->>'discount_percent')::numeric, 0);
            v_cost_price := NULLIF(v_child->>'cost_price', '')::numeric;
            v_markup_percent := ROUND(NULLIF(v_child->>'markup_percent', '')::numeric, 2);
            v_cost_not_applicable := COALESCE((v_child->>'cost_not_applicable')::boolean, false);
            IF v_discount_pct < 0 OR v_discount_pct > 100 OR v_vat_rate < 0 OR v_vat_rate > 100 THEN
                RAISE EXCEPTION 'quote_item_invalid_percent';
            END IF;
            IF v_qty < 0 OR (v_unit_price IS NOT NULL AND v_unit_price < 0) THEN
                RAISE EXCEPTION 'quote_item_invalid_amount';
            END IF;
            IF v_cost_price IS NOT NULL AND v_cost_price < 0 THEN
                RAISE EXCEPTION 'quote_item_invalid_cost_price';
            END IF;
            IF v_markup_percent IS NOT NULL AND v_markup_percent < -100 THEN
                RAISE EXCEPTION 'quote_item_invalid_markup';
            END IF;
            IF v_cost_price IS NULL THEN
                v_markup_percent := NULL;
            END IF;
            IF v_cost_not_applicable THEN
                v_cost_price := NULL;
                v_markup_percent := NULL;
            END IF;

            v_item_subtotal := ROUND(v_qty * COALESCE(v_unit_price, 0), 0);
            v_item_discount := ROUND(v_item_subtotal * v_discount_pct / 100, 0);
            v_item_after_discount := v_item_subtotal - v_item_discount;
            v_item_vat := ROUND(v_item_after_discount * v_vat_rate / 100, 0);
            v_item_total := v_item_after_discount + v_item_vat;

            INSERT INTO public.quote_items (
                quote_id, parent_item_id, row_type, description, service_description, note, warranty_scope, unit, quantity, unit_price,
                discount_percent, discount_amount, amount_after_discount, vat_rate,
                subtotal_amount, vat_amount, total_amount, sort_order,
                catalog_item_id, bundle_snapshot, list_price_usd, unit_price_usd, exchange_rate, unit_price_vnd,
                cost_price, markup_percent, cost_not_applicable
            ) VALUES (
                p_quote_id, v_parent_id, 'item',
                COALESCE(v_child->>'description', ''),
                v_child->>'service_description',
                v_child->>'note', NULLIF(BTRIM(v_child->>'warranty_scope'), ''),
                v_child->>'unit',
                v_qty, v_unit_price, v_discount_pct, v_item_discount, v_item_after_discount, v_vat_rate,
                v_item_subtotal, v_item_vat, v_item_total, v_child_index,
                NULLIF(v_child->>'catalog_item_id', '')::uuid,
                v_child->'bundle_snapshot',
                (v_child->>'list_price_usd')::numeric,
                (v_child->>'unit_price_usd')::numeric,
                (v_child->>'exchange_rate')::numeric,
                (v_child->>'unit_price_vnd')::numeric,
                v_cost_price, v_markup_percent, v_cost_not_applicable
            );

            v_subtotal := v_subtotal + v_item_subtotal;
            v_discount := v_discount + v_item_discount;
            v_vat := v_vat + v_item_vat;
            v_total := v_total + v_item_total;
            v_child_index := v_child_index + 1;
        END LOOP;

        v_parent_index := v_parent_index + 1;
    END LOOP;

    UPDATE public.quotes SET
        data = COALESCE(p_data, data),
        subtotal_amount = v_subtotal,
        vat_amount = v_vat,
        total_amount = v_total,
        issuer_company_id = COALESCE(p_issuer_company_id, issuer_company_id),
        updated_by = p_actor_id
    WHERE id = p_quote_id
    RETURNING * INTO v_quote;

    INSERT INTO public.quote_activity_log (quote_id, actor_id, action, changes)
    VALUES (p_quote_id, p_actor_id, 'updated', p_changes);

    RETURN v_quote;
END;
$$;
