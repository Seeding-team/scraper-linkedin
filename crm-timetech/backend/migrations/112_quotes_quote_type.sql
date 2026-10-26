-- "Loai bao gia" (yeu cau rieng "CHỐT TRIỂN KHAI PHÂN LOẠI BÁO GIÁ") - phan
-- loai GIAI PHAP/DICH VU dang chao trong 1 bao gia (vd "Thiet ke website",
-- "Ha tang/VPS/Cloud"...), multi-select, DOC LAP hoan toan voi "Linh vuc"
-- (nganh nghe khach hang, category_type=crm_industry co san tren
-- customer_leads/crm_customers). Danh muc dung LAI co che categories chung
-- (category_type='crm_quote_type' - KHONG can migration rieng cho phia
-- categories, da xac nhan THAT qua REST: cot categories.category_type
-- KHONG co CHECK constraint, chap nhan gia tri moi ngay lap tuc).
--
-- Luu tren quotes (khong phai quote_items - day la thuoc tinh cua CA bao
-- gia, khong phai tung dong hang muc) - mang TEXT[] luu CODE (khop dung
-- pattern "code la nguon that" da dung cho quotes.source/crm_customers.source
-- - "Nguon", 1 gia tri code duy nhat; o day cho phep NHIEU code vi la
-- multi-select).
ALTER TABLE public.quotes
    ADD COLUMN IF NOT EXISTS quote_type_codes TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_quotes_quote_type_codes
    ON public.quotes USING GIN (quote_type_codes);

-- quote_create_version() (dinh nghia lai lan nua, sau ban 105) - GIU NGUYEN
-- 100% logic hien co, CHI them cot `quote_type_codes` vao INSERT copy tu
-- v_source, dam bao "Tạo phiên bản mới" GIU NGUYEN Loai bao gia da chon o
-- ban goc (yeu cau "Phải lưu qua... tạo version").
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
        WHERE version_chain_id = v_chain_id AND status = 'draft'
        ORDER BY version_number DESC LIMIT 1;
    IF FOUND THEN
        RETURN QUERY SELECT v_existing_draft, false, v_existing_draft.parent_quote_id, v_existing_draft.version_number - 1;
        RETURN;
    END IF;

    SELECT * INTO v_source FROM public.quotes
        WHERE version_chain_id = v_chain_id AND status = 'approved'
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
        parent_quote_id, instance, issued_at, quote_type_codes
    ) VALUES (
        v_source.deal_id, v_source.quote_form_id, v_source.issuer_company_id,
        p_new_quote_number, 'draft', v_source.form_schema_version, v_source.form_snapshot,
        v_source.data, v_source.subtotal_amount, v_source.vat_amount, v_source.total_amount,
        v_source.currency, p_actor_id, v_chain_id, v_next_version, v_source.id, v_source.instance,
        NOW(), v_source.quote_type_codes
    ) RETURNING * INTO v_new;

    CREATE TEMP TABLE IF NOT EXISTS tmp_quote_item_map (old_id UUID PRIMARY KEY, new_id UUID) ON COMMIT DROP;

    FOR v_item IN
        SELECT * FROM public.quote_items
        WHERE quote_id = v_source.id AND parent_item_id IS NULL
        ORDER BY sort_order
    LOOP
        INSERT INTO public.quote_items (
            quote_id, parent_item_id, row_type, description, service_description, note, unit, quantity,
            unit_price, discount_percent, discount_amount, amount_after_discount, vat_rate,
            subtotal_amount, vat_amount, total_amount, sort_order, catalog_item_id,
            bundle_snapshot, list_price_usd, unit_price_usd, exchange_rate, unit_price_vnd,
            cost_price, markup_percent, cost_not_applicable
        ) VALUES (
            v_new.id, NULL, v_item.row_type, v_item.description, v_item.service_description, v_item.note, v_item.unit,
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
            quote_id, parent_item_id, row_type, description, service_description, note, unit, quantity,
            unit_price, discount_percent, discount_amount, amount_after_discount, vat_rate,
            subtotal_amount, vat_amount, total_amount, sort_order, catalog_item_id,
            bundle_snapshot, list_price_usd, unit_price_usd, exchange_rate, unit_price_vnd,
            cost_price, markup_percent, cost_not_applicable
        ) VALUES (
            v_new.id, v_mapped_parent_id, v_item.row_type, v_item.description, v_item.service_description, v_item.note, v_item.unit,
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
