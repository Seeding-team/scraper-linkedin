-- "Tao phien ban bao gia moi": moi bao gia thuoc 1 "chuoi" (version_chain_id),
-- danh so V1/V2/V3 doc lap voi ngay thang. Quote CU (tao truoc migration nay)
-- tro thanh V1 cua chinh no (chain rieng, khong anh huong du lieu cu).

ALTER TABLE public.quotes
    ADD COLUMN IF NOT EXISTS version_chain_id UUID,
    ADD COLUMN IF NOT EXISTS version_number INT NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS parent_quote_id UUID REFERENCES public.quotes(id) ON DELETE SET NULL;

UPDATE public.quotes SET version_chain_id = id WHERE version_chain_id IS NULL;
ALTER TABLE public.quotes ALTER COLUMN version_chain_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_quotes_version_chain_id ON public.quotes(version_chain_id);

-- RPC tao phien ban moi - atomic, khoa CA CHUOI (khong chi 1 row) qua
-- "SELECT ... FOR UPDATE" tren moi row cung version_chain_id, dung y het
-- pattern quote_approve()/quote_update() (migration 059). 2 request dong thoi
-- cho cung 1 chain se serialize o day - request thu 2 doi request thu 1
-- commit/rollback xong moi doc duoc trang thai moi nhat.
--
-- Nguon copy LUON LA phien ban DA DUYET moi nhat trong chuoi (khong phai
-- p_clicked_quote_id nguoi dung vua bam) - tranh copy du lieu cu neu bam
-- nut o 1 the V cu hon trong khi chuoi da co ban duyet moi hon.
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
    v_source public.quotes;
    v_existing_draft public.quotes;
    v_next_version INT;
    v_new public.quotes;
    v_item RECORD;
    v_new_item_id UUID;
    v_mapped_parent_id UUID;
BEGIN
    SELECT version_chain_id INTO v_chain_id FROM public.quotes WHERE id = p_clicked_quote_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'quote_not_found';
    END IF;

    -- Khoa toan bo chuoi truoc khi doc/quyet dinh bat cu gi.
    PERFORM 1 FROM public.quotes WHERE version_chain_id = v_chain_id FOR UPDATE;

    -- Da co ban nhap trong chuoi -> tra ve luon ban do, KHONG tao them.
    SELECT * INTO v_existing_draft FROM public.quotes
        WHERE version_chain_id = v_chain_id AND status = 'draft'
        ORDER BY version_number DESC LIMIT 1;
    IF FOUND THEN
        RETURN QUERY SELECT v_existing_draft, false, v_existing_draft.parent_quote_id, v_existing_draft.version_number - 1;
        RETURN;
    END IF;

    -- Nguon THAT SU: ban DA DUYET moi nhat trong chuoi (khong phai ban vua bam).
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
        parent_quote_id, instance, issued_at
    ) VALUES (
        v_source.deal_id, v_source.quote_form_id, v_source.issuer_company_id,
        p_new_quote_number, 'draft', v_source.form_schema_version, v_source.form_snapshot,
        v_source.data, v_source.subtotal_amount, v_source.vat_amount, v_source.total_amount,
        v_source.currency, p_actor_id, v_chain_id, v_next_version, v_source.id, v_source.instance,
        NOW()
    ) RETURNING * INTO v_new;

    -- Copy hang muc: pass 1 = hang muc CHA (parent_item_id IS NULL), luu map
    -- id-cu -> id-moi; pass 2 = hang muc CON, remap parent_item_id theo map.
    CREATE TEMP TABLE IF NOT EXISTS tmp_quote_item_map (old_id UUID PRIMARY KEY, new_id UUID) ON COMMIT DROP;
    DELETE FROM tmp_quote_item_map;

    FOR v_item IN
        SELECT * FROM public.quote_items
        WHERE quote_id = v_source.id AND parent_item_id IS NULL
        ORDER BY sort_order
    LOOP
        INSERT INTO public.quote_items (
            quote_id, parent_item_id, description, service_description, unit, quantity,
            unit_price, discount_percent, discount_amount, amount_after_discount, vat_rate,
            subtotal_amount, vat_amount, total_amount, sort_order, catalog_item_id,
            bundle_snapshot, list_price_usd, unit_price_usd, exchange_rate, unit_price_vnd
        ) VALUES (
            v_new.id, NULL, v_item.description, v_item.service_description, v_item.unit,
            v_item.quantity, v_item.unit_price, v_item.discount_percent, v_item.discount_amount,
            v_item.amount_after_discount, v_item.vat_rate, v_item.subtotal_amount, v_item.vat_amount,
            v_item.total_amount, v_item.sort_order, v_item.catalog_item_id, v_item.bundle_snapshot,
            v_item.list_price_usd, v_item.unit_price_usd, v_item.exchange_rate, v_item.unit_price_vnd
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
            quote_id, parent_item_id, description, service_description, unit, quantity,
            unit_price, discount_percent, discount_amount, amount_after_discount, vat_rate,
            subtotal_amount, vat_amount, total_amount, sort_order, catalog_item_id,
            bundle_snapshot, list_price_usd, unit_price_usd, exchange_rate, unit_price_vnd
        ) VALUES (
            v_new.id, v_mapped_parent_id, v_item.description, v_item.service_description, v_item.unit,
            v_item.quantity, v_item.unit_price, v_item.discount_percent, v_item.discount_amount,
            v_item.amount_after_discount, v_item.vat_rate, v_item.subtotal_amount, v_item.vat_amount,
            v_item.total_amount, v_item.sort_order, v_item.catalog_item_id, v_item.bundle_snapshot,
            v_item.list_price_usd, v_item.unit_price_usd, v_item.exchange_rate, v_item.unit_price_vnd
        ) RETURNING id INTO v_new_item_id;
    END LOOP;

    INSERT INTO public.quote_activity_log (quote_id, actor_id, action, changes)
    VALUES (v_new.id, p_actor_id, 'version_created',
            jsonb_build_object('source_quote_id', v_source.id, 'source_version_number', v_source.version_number,
                                'clicked_quote_id', p_clicked_quote_id));

    RETURN QUERY SELECT v_new, true, v_source.id, v_source.version_number;
END;
$$;
