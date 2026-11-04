-- "Gia da gom VAT" toggle cho Quote (cap QUOTE, giong pattern currency 169/162):
--  * quotes.price_mode: 'exclusive' (mac dinh, HANH VI CU - unitPrice la gia
--    CHUA gom VAT) | 'inclusive' (unitPrice la gia DA gom VAT, VAT duoc tach
--    nguoc ra tu gia do). Bao gia cu / khong gui -> 'exclusive', render y het
--    truoc khi co tinh nang nay, khong backfill gi ca.
--  * KHONG them cot tren quote_items - vat_rate moi dong van la field doc lap,
--    chi THAY DOI CACH DIEN GIAI unitPrice cua ca quote, khong doi cau truc dong.
ALTER TABLE public.quotes
    ADD COLUMN IF NOT EXISTS price_mode TEXT NOT NULL DEFAULT 'exclusive';

ALTER TABLE public.quotes
    DROP CONSTRAINT IF EXISTS quotes_price_mode_check;
ALTER TABLE public.quotes
    ADD CONSTRAINT quotes_price_mode_check CHECK (price_mode IN ('exclusive', 'inclusive'));

-- quote_create_version (RPC that su dung khi "Tạo phiên bản mới") phai copy
-- price_mode sang ban draft moi, giong currency - CREATE OR REPLACE lai dung
-- NGUYEN definition hien tai (migration 189_quote_item_billing_cycle.sql),
-- CHI them price_mode vao cot INSERT quotes + gia tri tu v_source. KHONG doi
-- bat ky logic/cot nao khac cua ham nay.
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
        total_amount, currency, price_mode, created_by, version_chain_id, version_number,
        parent_quote_id, instance, issued_at, quote_type_codes,
        technical_owner_id, quote_owner_id, project_id, sla_started_at,
        sla_due_at, overall_discount_percent, valid_until
    ) VALUES (
        v_source.deal_id, v_source.quote_form_id, v_source.issuer_company_id,
        p_new_quote_number, 'draft', v_source.form_schema_version, v_source.form_snapshot,
        v_source.data, v_source.subtotal_amount, v_source.vat_amount, v_source.total_amount,
        v_source.currency, v_source.price_mode, p_actor_id, v_chain_id, v_next_version, v_source.id, v_source.instance,
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
            cost_price, markup_percent, cost_not_applicable,
            billing_cycle, billing_term_months, catalog_monthly_price_vnd, catalog_annual_commit_monthly_price_vnd
        ) VALUES (
            v_new.id, NULL, v_item.row_type, v_item.description, v_item.service_description, v_item.note, v_item.warranty_scope, v_item.unit,
            v_item.quantity, v_item.unit_price, v_item.discount_percent, v_item.discount_amount,
            v_item.amount_after_discount, v_item.vat_rate, v_item.subtotal_amount, v_item.vat_amount,
            v_item.total_amount, v_item.sort_order, v_item.catalog_item_id, v_item.bundle_snapshot,
            v_item.list_price_usd, v_item.unit_price_usd, v_item.exchange_rate, v_item.unit_price_vnd,
            v_item.cost_price, v_item.markup_percent, v_item.cost_not_applicable,
            v_item.billing_cycle, v_item.billing_term_months, v_item.catalog_monthly_price_vnd, v_item.catalog_annual_commit_monthly_price_vnd
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
            cost_price, markup_percent, cost_not_applicable,
            billing_cycle, billing_term_months, catalog_monthly_price_vnd, catalog_annual_commit_monthly_price_vnd
        ) VALUES (
            v_new.id, v_mapped_parent_id, v_item.row_type, v_item.description, v_item.service_description, v_item.note, v_item.warranty_scope, v_item.unit,
            v_item.quantity, v_item.unit_price, v_item.discount_percent, v_item.discount_amount,
            v_item.amount_after_discount, v_item.vat_rate, v_item.subtotal_amount, v_item.vat_amount,
            v_item.total_amount, v_item.sort_order, v_item.catalog_item_id, v_item.bundle_snapshot,
            v_item.list_price_usd, v_item.unit_price_usd, v_item.exchange_rate, v_item.unit_price_vnd,
            v_item.cost_price, v_item.markup_percent, v_item.cost_not_applicable,
            v_item.billing_cycle, v_item.billing_term_months, v_item.catalog_monthly_price_vnd, v_item.catalog_annual_commit_monthly_price_vnd
        ) RETURNING id INTO v_new_item_id;
    END LOOP;

    INSERT INTO public.quote_activity_log (quote_id, actor_id, action, changes)
    VALUES (v_new.id, p_actor_id, 'version_created',
            jsonb_build_object('source_quote_id', v_source.id, 'source_version_number', v_source.version_number,
                                'clicked_quote_id', p_clicked_quote_id));

    RETURN QUERY SELECT v_new, true, v_source.id, v_source.version_number;
END;
$$;

NOTIFY pgrst, 'reload schema';
