-- Muc cha (Section) / Hang muc con (Item) cho bang hang muc bao gia - yeu cau
-- nghiep vu: 1 quote co the co nhieu "nhom" (I, II, III... kieu file Excel
-- goc), moi nhom la 1 TIEU DE THUAN TUY (khong tinh tien, khong bat SL/gia
-- von/markup), cac hang muc that (co tinh tien) nam BEN DUOI 1 nhom.
--
-- KHONG tai su dung `parent_item_id` cho y nghia "bundle cha/con" cu (migration
-- 063_quote_items_parent_child_discount.sql) - co che cu do CA cha LAN con deu
-- tinh tien that ("Totals are calculated per row"), ban chat khac hoan toan
-- voi "Muc cha KHONG tinh tien" o day. Co che cu nay xac nhan qua audit THAT
-- (query DB that) dang co 0 dong nao dung toi, an toan de doi y nghia filter
-- validate ma khong pha du lieu that dang chay (moi dong hien tai deu la
-- row_type='item' mac dinh sau migration nay, parent_item_id deu dang NULL).
--
-- Thiet ke:
--   - row_type='section': dong tieu de nhom (vd "I - GIAI DOAN 1..."). Luon ep
--     quantity/unit_price/cost_price/discount/vat ve 0/NULL o server (KHONG
--     tin client) - dam bao KHONG tinh tien du client gui gi len, khong can
--     sua lai logic SUM tong da co san trong quote_update()/quote_create_
--     version() (cong 0 vao tong la tu nhien dung, khong can rieng 1 nhanh
--     "bo qua section" trong vong lap).
--   - row_type='item' (mac dinh, GIU NGUYEN moi quote cu): hang muc that,
--     tinh tien binh thuong. Neu thuoc 1 nhom, `parent_item_id` = id cua dong
--     section do (dung LAI dung cot da co, KHONG them cot moi - dung de xuat
--     "migration toi thieu" cua yeu cau).
--   - Hang muc KHONG thuoc nhom nao (bao gia cu, hoac nguoi dung khong dung
--     nhom) van hop le: row_type='item', parent_item_id=NULL - giong het
--     hanh vi truoc migration nay.
--
-- Anh huong cac RPC dang dung `parent_item_id IS NULL` de dem "hang muc that"
-- (quote_set_processing_stage - kiem tra du dieu kien chuyen buoc): filter do
-- PHAI doi sang `row_type = 'item'`, vi gio hang muc that hop le van co the
-- co parent_item_id KHAC NULL (thuoc 1 nhom) - neu giu nguyen filter cu se
-- lam MOI hang muc trong nhom bi loai khoi kiem tra (bao gia dung nhom se
-- luon bao "chua co hang muc" sai). quote_create_version() thi KHONG can doi
-- cau truc 2-pass copy hien co (da dung dung theo group id qua parent_item_id)
-- - chi can them cot row_type vao 2 cau INSERT copy hang muc.

ALTER TABLE public.quote_items
    ADD COLUMN IF NOT EXISTS row_type TEXT NOT NULL DEFAULT 'item'
        CHECK (row_type IN ('section', 'item'));

CREATE INDEX IF NOT EXISTS idx_quote_items_quote_row_type ON public.quote_items(quote_id, row_type);

-- quote_update() (dinh nghia lai lan nua, sau ban 090) - GIU NGUYEN 100% logic
-- tinh tien/luu hien co, CHI them:
--   1) doc + luu row_type cho ca 2 nhanh INSERT (cha/con);
--   2) ep qty/gia/cost/discount/vat ve 0/NULL khi row_type='section' TRUOC
--      khi tinh toan - dam bao section khong bao gio tinh tien du client gui
--      gi len (phong client loi/co y gui sai).
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
        v_unit_price := COALESCE((v_item->>'unit_price')::numeric, 0);
        v_vat_rate := COALESCE((v_item->>'vat_rate')::numeric, 0);
        v_discount_pct := COALESCE((v_item->>'discount_percent')::numeric, 0);
        v_cost_price := NULLIF(v_item->>'cost_price', '')::numeric;
        v_markup_percent := NULLIF(v_item->>'markup_percent', '')::numeric;
        v_cost_not_applicable := COALESCE((v_item->>'cost_not_applicable')::boolean, false);

        IF v_row_type = 'section' THEN
            -- Muc cha KHONG tinh tien - ep ve 0/NULL bat ke client gui gi.
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

        v_item_subtotal := v_qty * v_unit_price;
        v_item_discount := v_item_subtotal * v_discount_pct / 100;
        v_item_after_discount := v_item_subtotal - v_item_discount;
        v_item_vat := v_item_after_discount * v_vat_rate / 100;
        v_item_total := v_item_after_discount + v_item_vat;

        INSERT INTO public.quote_items (
            quote_id, parent_item_id, row_type, description, service_description, unit, quantity, unit_price,
            discount_percent, discount_amount, amount_after_discount, vat_rate,
            subtotal_amount, vat_amount, total_amount, sort_order,
            catalog_item_id, bundle_snapshot, list_price_usd, unit_price_usd, exchange_rate, unit_price_vnd,
            cost_price, markup_percent, cost_not_applicable
        ) VALUES (
            p_quote_id, NULL, v_row_type,
            COALESCE(v_item->>'description', ''),
            v_item->>'service_description',
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

        -- Hang muc con thuoc 1 nhom (row_type='item', cha la 1 dong
        -- row_type='section' vua tao o tren) - FE gui qua `v_item->'children'`
        -- dung CAU TRUC LONG DA CO SAN (bundle cu), tai su dung nguyen ven,
        -- CHI khac o cho nay LUON la row_type='item' (khong co section long
        -- trong section).
        v_child_index := 0;
        FOR v_child IN SELECT * FROM jsonb_array_elements(COALESCE(v_item->'children', '[]'::jsonb)) LOOP
            v_qty := COALESCE((v_child->>'quantity')::numeric, 0);
            v_unit_price := COALESCE((v_child->>'unit_price')::numeric, 0);
            v_vat_rate := COALESCE((v_child->>'vat_rate')::numeric, 0);
            v_discount_pct := COALESCE((v_child->>'discount_percent')::numeric, 0);
            v_cost_price := NULLIF(v_child->>'cost_price', '')::numeric;
            v_markup_percent := NULLIF(v_child->>'markup_percent', '')::numeric;
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

            v_item_subtotal := v_qty * v_unit_price;
            v_item_discount := v_item_subtotal * v_discount_pct / 100;
            v_item_after_discount := v_item_subtotal - v_item_discount;
            v_item_vat := v_item_after_discount * v_vat_rate / 100;
            v_item_total := v_item_after_discount + v_item_vat;

            INSERT INTO public.quote_items (
                quote_id, parent_item_id, row_type, description, service_description, unit, quantity, unit_price,
                discount_percent, discount_amount, amount_after_discount, vat_rate,
                subtotal_amount, vat_amount, total_amount, sort_order,
                catalog_item_id, bundle_snapshot, list_price_usd, unit_price_usd, exchange_rate, unit_price_vnd,
                cost_price, markup_percent, cost_not_applicable
            ) VALUES (
                p_quote_id, v_parent_id, 'item',
                COALESCE(v_child->>'description', ''),
                v_child->>'service_description',
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

-- quote_create_version() (dinh nghia lai lan nua, sau ban 090) - GIU NGUYEN
-- 100% logic khoa chuoi/tim nguon/redirect ban nhap VA cau truc copy 2-pass
-- hien co (da dung DUNG theo nhom qua parent_item_id, khong can doi) - CHI
-- them cot row_type vao ca 2 cau INSERT copy hang muc, dam bao version moi
-- giu dung section/item giong ban nguon.
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
        parent_quote_id, instance, issued_at
    ) VALUES (
        v_source.deal_id, v_source.quote_form_id, v_source.issuer_company_id,
        p_new_quote_number, 'draft', v_source.form_schema_version, v_source.form_snapshot,
        v_source.data, v_source.subtotal_amount, v_source.vat_amount, v_source.total_amount,
        v_source.currency, p_actor_id, v_chain_id, v_next_version, v_source.id, v_source.instance,
        NOW()
    ) RETURNING * INTO v_new;

    CREATE TEMP TABLE IF NOT EXISTS tmp_quote_item_map (old_id UUID PRIMARY KEY, new_id UUID) ON COMMIT DROP;

    FOR v_item IN
        SELECT * FROM public.quote_items
        WHERE quote_id = v_source.id AND parent_item_id IS NULL
        ORDER BY sort_order
    LOOP
        INSERT INTO public.quote_items (
            quote_id, parent_item_id, row_type, description, service_description, unit, quantity,
            unit_price, discount_percent, discount_amount, amount_after_discount, vat_rate,
            subtotal_amount, vat_amount, total_amount, sort_order, catalog_item_id,
            bundle_snapshot, list_price_usd, unit_price_usd, exchange_rate, unit_price_vnd,
            cost_price, markup_percent, cost_not_applicable
        ) VALUES (
            v_new.id, NULL, v_item.row_type, v_item.description, v_item.service_description, v_item.unit,
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
            quote_id, parent_item_id, row_type, description, service_description, unit, quantity,
            unit_price, discount_percent, discount_amount, amount_after_discount, vat_rate,
            subtotal_amount, vat_amount, total_amount, sort_order, catalog_item_id,
            bundle_snapshot, list_price_usd, unit_price_usd, exchange_rate, unit_price_vnd,
            cost_price, markup_percent, cost_not_applicable
        ) VALUES (
            v_new.id, v_mapped_parent_id, v_item.row_type, v_item.description, v_item.service_description, v_item.unit,
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

-- quote_set_processing_stage (dinh nghia lai lan nua, sau ban 090) - GIU
-- NGUYEN 100% logic validate hien co, CHI doi filter dem "hang muc that" tu
-- `parent_item_id IS NULL` sang `row_type = 'item'`. LY DO: gio hang muc that
-- hop le CO THE co parent_item_id KHAC NULL (thuoc 1 nhom/section) - filter
-- cu se lam MOI hang muc trong nhom bi loai khoi dem/validate (bao gia dung
-- nhom se luon bao sai "chua co hang muc"/"chua nhap gia von" du da nhap du).
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

    SELECT count(*) INTO v_item_count FROM public.quote_items WHERE quote_id = p_quote_id AND row_type = 'item';

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
