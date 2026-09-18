BEGIN;
ALTER TABLE public.quote_items ADD COLUMN IF NOT EXISTS warranty_scope TEXT DEFAULT NULL;
COMMENT ON COLUMN public.quote_items.warranty_scope IS 'Item-specific warranty scope; independent of project warranty blocks.';

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
        -- VND khong co phan thap phan - lam tron ve DONG NGUYEN ngay khi doc
        -- vao (khong doi cong thuc, chi khong con luu duoc so co qua nhieu
        -- chu so thap phan nhu bug da gap).
        v_unit_price := ROUND(COALESCE((v_item->>'unit_price')::numeric, 0), 0);
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
        IF v_qty < 0 OR v_unit_price < 0 THEN
            RAISE EXCEPTION 'quote_item_invalid_amount';
        END IF;
        IF v_cost_price IS NOT NULL AND v_cost_price < 0 THEN
            RAISE EXCEPTION 'quote_item_invalid_cost_price';
        END IF;
        IF v_cost_price IS NULL THEN
            v_markup_percent := NULL;
        END IF;
        IF v_cost_not_applicable THEN
            v_cost_price := NULL;
            v_markup_percent := NULL;
        END IF;

        v_item_subtotal := ROUND(v_qty * v_unit_price, 0);
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
            v_unit_price := ROUND(COALESCE((v_child->>'unit_price')::numeric, 0), 0);
            v_vat_rate := COALESCE((v_child->>'vat_rate')::numeric, 0);
            v_discount_pct := COALESCE((v_child->>'discount_percent')::numeric, 0);
            v_cost_price := NULLIF(v_child->>'cost_price', '')::numeric;
            v_markup_percent := ROUND(NULLIF(v_child->>'markup_percent', '')::numeric, 2);
            v_cost_not_applicable := COALESCE((v_child->>'cost_not_applicable')::boolean, false);
            IF v_discount_pct < 0 OR v_discount_pct > 100 OR v_vat_rate < 0 OR v_vat_rate > 100 THEN
                RAISE EXCEPTION 'quote_item_invalid_percent';
            END IF;
            IF v_qty < 0 OR v_unit_price < 0 THEN
                RAISE EXCEPTION 'quote_item_invalid_amount';
            END IF;
            IF v_cost_price IS NOT NULL AND v_cost_price < 0 THEN
                RAISE EXCEPTION 'quote_item_invalid_cost_price';
            END IF;
            IF v_cost_price IS NULL THEN
                v_markup_percent := NULL;
            END IF;
            IF v_cost_not_applicable THEN
                v_cost_price := NULL;
                v_markup_percent := NULL;
            END IF;

            v_item_subtotal := ROUND(v_qty * v_unit_price, 0);
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


CREATE OR REPLACE FUNCTION public.quote_create_version(
    p_clicked_quote_id UUID, p_actor_id UUID, p_new_quote_number TEXT
) RETURNS TABLE (
    quote public.quotes,
    created BOOLEAN,
    source_quote_id UUID,
    source_version_number INT
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_chain_id UUID;
    v_clicked_status TEXT;
    v_source public.quotes;
    v_existing_draft public.quotes;
    v_next_version INT;
    v_new public.quotes;
    v_item RECORD;
    v_new_item_id UUID;
    v_mapped_parent_id UUID;
BEGIN
    SELECT version_chain_id, status INTO v_chain_id, v_clicked_status
        FROM public.quotes WHERE id = p_clicked_quote_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'quote_not_found';
    END IF;

    PERFORM 1 FROM public.quotes WHERE version_chain_id = v_chain_id FOR UPDATE;

    IF v_clicked_status = 'draft' THEN
        RAISE EXCEPTION 'quote_is_draft';
    END IF;

    SELECT * INTO v_existing_draft FROM public.quotes
        WHERE version_chain_id = v_chain_id AND status = 'draft' AND deleted_at IS NULL
        ORDER BY version_number DESC LIMIT 1;
    IF FOUND THEN
        RETURN QUERY SELECT v_existing_draft, false, v_existing_draft.parent_quote_id, v_existing_draft.version_number - 1;
        RETURN;
    END IF;

    SELECT * INTO v_source FROM public.quotes
        WHERE version_chain_id = v_chain_id AND status = 'approved' AND deleted_at IS NULL
        ORDER BY version_number DESC LIMIT 1;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'quote_not_approved';
    END IF;

    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_next_version
        FROM public.quotes WHERE version_chain_id = v_chain_id;

    INSERT INTO public.quotes (
        deal_id, quote_form_id, issuer_company_id, quote_number, status,
        form_schema_version, form_snapshot, data, subtotal_amount, vat_amount,
        total_amount, currency, created_by, version_chain_id, version_number,
        parent_quote_id, instance, issued_at, quote_type_codes,
        technical_owner_id, quote_owner_id, project_id, sla_started_at,
        sla_due_at, overall_discount_percent, valid_until
    ) VALUES (
        v_source.deal_id, v_source.quote_form_id, v_source.issuer_company_id,
        p_new_quote_number, 'draft', v_source.form_schema_version, v_source.form_snapshot,
        v_source.data, v_source.subtotal_amount, v_source.vat_amount, v_source.total_amount,
        v_source.currency, p_actor_id, v_chain_id, v_next_version, v_source.id, v_source.instance,
        NOW(), v_source.quote_type_codes,
        v_source.technical_owner_id, v_source.quote_owner_id, v_source.project_id, v_source.sla_started_at,
        v_source.sla_due_at, v_source.overall_discount_percent, v_source.valid_until
    ) RETURNING * INTO v_new;

    CREATE TEMP TABLE IF NOT EXISTS tmp_quote_item_map (old_id UUID PRIMARY KEY, new_id UUID) ON COMMIT DROP;

    FOR v_item IN
        SELECT * FROM public.quote_items
        WHERE quote_id = v_source.id AND parent_item_id IS NULL
        ORDER BY sort_order
    LOOP
        INSERT INTO public.quote_items (
            quote_id, parent_item_id, row_type, description, service_description, note, warranty_scope, unit, quantity,
            unit_price, discount_percent, discount_amount, amount_after_discount, vat_rate,
            subtotal_amount, vat_amount, total_amount, sort_order, catalog_item_id,
            bundle_snapshot, list_price_usd, unit_price_usd, exchange_rate, unit_price_vnd,
            cost_price, markup_percent, cost_not_applicable
        ) VALUES (
            v_new.id, NULL, v_item.row_type, v_item.description, v_item.service_description, v_item.note, v_item.warranty_scope, v_item.unit,
            v_item.quantity, v_item.unit_price, v_item.discount_percent, v_item.discount_amount,
            v_item.amount_after_discount, v_item.vat_rate, v_item.subtotal_amount, v_item.vat_amount,
            v_item.total_amount, v_item.sort_order, v_item.catalog_item_id, v_item.bundle_snapshot,
            v_item.list_price_usd, v_item.unit_price_usd, v_item.exchange_rate, v_item.unit_price_vnd,
            v_item.cost_price, v_item.markup_percent, v_item.cost_not_applicable
        ) RETURNING id INTO v_new_item_id;
        INSERT INTO tmp_quote_item_map (old_id, new_id) VALUES (v_item.id, v_new_item_id);
    END LOOP;

    FOR v_item IN
        SELECT * FROM public.quote_items
        WHERE quote_id = v_source.id AND parent_item_id IS NOT NULL
        ORDER BY sort_order
    LOOP
        SELECT new_id INTO v_mapped_parent_id FROM tmp_quote_item_map WHERE old_id = v_item.parent_item_id;
        INSERT INTO public.quote_items (
            quote_id, parent_item_id, row_type, description, service_description, note, warranty_scope, unit, quantity,
            unit_price, discount_percent, discount_amount, amount_after_discount, vat_rate,
            subtotal_amount, vat_amount, total_amount, sort_order, catalog_item_id,
            bundle_snapshot, list_price_usd, unit_price_usd, exchange_rate, unit_price_vnd,
            cost_price, markup_percent, cost_not_applicable
        ) VALUES (
            v_new.id, v_mapped_parent_id, v_item.row_type, v_item.description, v_item.service_description, v_item.note, v_item.warranty_scope, v_item.unit,
            v_item.quantity, v_item.unit_price, v_item.discount_percent, v_item.discount_amount,
            v_item.amount_after_discount, v_item.vat_rate, v_item.subtotal_amount, v_item.vat_amount,
            v_item.total_amount, v_item.sort_order, v_item.catalog_item_id, v_item.bundle_snapshot,
            v_item.list_price_usd, v_item.unit_price_usd, v_item.exchange_rate, v_item.unit_price_vnd,
            v_item.cost_price, v_item.markup_percent, v_item.cost_not_applicable
        ) RETURNING id INTO v_new_item_id;
    END LOOP;

    INSERT INTO public.quote_activity_log (quote_id, actor_id, action, changes)
    VALUES (v_new.id, p_actor_id, 'version_created',
            jsonb_build_object('source_quote_id', v_source.id, 'source_version_number', v_source.version_number,
                                'clicked_quote_id', p_clicked_quote_id));

    RETURN QUERY SELECT v_new, true, v_source.id, v_source.version_number;
END;
$$;


UPDATE public.quote_forms SET schema_json = schema_json || '{"enableDynamicPaymentPlan":true}'::jsonb WHERE code = 'STANDARD_DEFAULT_QUOTE_FORM';
-- Enable existing editable standard quotes without mutating approved snapshots.
UPDATE public.quotes q SET form_snapshot = q.form_snapshot || '{"enableDynamicPaymentPlan":true}'::jsonb
FROM public.quote_forms f WHERE q.quote_form_id = f.id AND f.code = 'STANDARD_DEFAULT_QUOTE_FORM' AND q.status = 'draft';
COMMIT;
NOTIFY pgrst, 'reload schema';
