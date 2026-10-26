-- Bang gia VPS Zone (SecurityZone) - schema moi hoan toan, KHONG mo rong
-- service_catalog_items (bang do khong co cost/vendor/issuer_company_id, va
-- yeu cau nghiep vu la mot bang gia CHUAN rieng, tach biet danh muc noi bo
-- hien co). Nguon du lieu: file "260623_v1_CPC[2026]_Goi Claude(1).xlsx",
-- xem plan/audit truoc khi apply migration nay.
--
-- Kien truc: price_books (1 "cuon" bang gia) -> price_book_versions
-- (Draft/Published/Archived, chi 1 Published dang hieu luc/price_book) ->
-- price_book_sections (muc cha, chi phan nhom khong tinh tien) ->
-- price_book_items (san pham that, gia IN/EU day du). Snapshot vao bao gia
-- qua quote_items.price_book_snapshot (JSONB dong cung) + 3 cot FK moi de
-- truy vet - KHONG bao gio doc nguoc price_book_items tu duong public.
--
-- Bao mat 2 lop: RLS enable + KHONG co policy cho anon/authenticated (chi
-- service_role duoc vao, tuc chi backend FastAPI - da xac nhan frontend
-- KHONG bao gio goi Supabase truc tiep) + permission/scope issuer_company_id
-- o tang Python (routers/price_book.py, crm_permission_service.py).
--
-- CHUA apply migration nay len DB dung chung cho toi khi duoc xac nhan rieng.

CREATE TABLE public.price_books (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    issuer_company_id UUID NOT NULL REFERENCES public.quote_issuer_companies(id),
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID
);

CREATE TABLE public.price_book_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    price_book_id UUID NOT NULL REFERENCES public.price_books(id),
    version INT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
    effective_date TIMESTAMPTZ,
    created_by UUID,
    published_by UUID,
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (price_book_id, version)
);
-- Chi 1 version published dang hieu luc moi price_book (tung issuer rieng
-- vi price_book_id da 1-1 voi issuer_company_id qua bang price_books).
CREATE UNIQUE INDEX price_book_versions_one_published
    ON public.price_book_versions ((price_book_id)) WHERE status = 'published';
-- Chi 1 version draft dang mo moi price_book (tranh tao nhieu Draft song song).
CREATE UNIQUE INDEX price_book_versions_one_draft
    ON public.price_book_versions ((price_book_id)) WHERE status = 'draft';

CREATE TABLE public.price_book_sections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    price_book_version_id UUID NOT NULL REFERENCES public.price_book_versions(id),
    source_sheet TEXT,
    source_group_label TEXT,          -- 'I' / 'II'
    display_label TEXT,               -- hien thi trong quote: 'I', 'II'...
    name TEXT NOT NULL,
    sort_order INT NOT NULL DEFAULT 0
);

CREATE TABLE public.price_book_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    price_book_version_id UUID NOT NULL REFERENCES public.price_book_versions(id),
    section_id UUID REFERENCES public.price_book_sections(id),
    source_sheet TEXT NOT NULL,
    source_stt TEXT NOT NULL,         -- truy vet + chong import trung
    sku TEXT NOT NULL,                -- tu sinh: ZONE-I-01, ZONE-II-201...
    name TEXT NOT NULL,
    description TEXT,                 -- mo ta dai nguyen van (khong rut gon)
    unit TEXT,
    default_quantity NUMERIC NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'discontinued')),
    product_image_url TEXT,           -- nullable, KHONG dung dot nay (ngoai pham vi)

    -- Gia dau vao (IN)
    cost_mode TEXT NOT NULL CHECK (cost_mode IN ('usd', 'vnd')),
    vendor_name TEXT,
    list_price_usd NUMERIC,
    unit_price_usd NUMERIC,
    unit_price_vnd_direct NUMERIC,    -- dung khi cost_mode = 'vnd'
    exchange_rate NUMERIC,            -- dung khi cost_mode = 'usd'
    import_duty_percent NUMERIC NOT NULL DEFAULT 0,
    vat_in_percent NUMERIC NOT NULL DEFAULT 0,
    quote_received_date DATE,
    quote_link TEXT,

    -- Gia dau ra (EU)
    default_rate_percent NUMERIC NOT NULL DEFAULT 0,
    vat_eu_percent NUMERIC NOT NULL DEFAULT 0,
    reference_price NUMERIC,
    reference_link TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (price_book_version_id, source_sheet, source_stt)
);

CREATE TABLE public.price_book_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    price_book_item_id UUID REFERENCES public.price_book_items(id),
    price_book_version_id UUID REFERENCES public.price_book_versions(id),
    actor_id UUID,
    actor_name TEXT,
    actor_role TEXT,
    action TEXT NOT NULL,   -- 'create_draft'|'update'|'publish'|'discontinue'|'hard_delete'
    changes JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS: bat + KHONG tao policy cho anon/authenticated = deny mac dinh cho moi
-- role tru service_role (bypass RLS mac dinh cua Supabase). Day la lop chan
-- DB-level, khong dua vao Python de che field.
ALTER TABLE public.price_books ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_book_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_book_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_book_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_book_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY price_books_service_role_only ON public.price_books
    FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY price_book_versions_service_role_only ON public.price_book_versions
    FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY price_book_sections_service_role_only ON public.price_book_sections
    FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY price_book_items_service_role_only ON public.price_book_items
    FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY price_book_audit_log_service_role_only ON public.price_book_audit_log
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Mo rong quote_items (nullable, khong pha du lieu cu). price_book_snapshot
-- luu toan bo IN/EU/VAT/gia tham chieu tai thoi diem chon - dong cung, KHONG
-- bao gio doc lai price_book_items sau khi da snapshot. 4 cot cost_override_*
-- phuc vu nut "Da dieu chinh" / "Khoi phuc theo cong thuc" o Quote Workspace.
ALTER TABLE public.quote_items
    ADD COLUMN IF NOT EXISTS price_book_item_id UUID REFERENCES public.price_book_items(id),
    ADD COLUMN IF NOT EXISTS price_book_version_id UUID REFERENCES public.price_book_versions(id),
    ADD COLUMN IF NOT EXISTS price_book_snapshot JSONB,
    ADD COLUMN IF NOT EXISTS cost_override_reason TEXT,
    ADD COLUMN IF NOT EXISTS cost_override_by UUID,
    ADD COLUMN IF NOT EXISTS cost_override_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS cost_price_original NUMERIC;

-- Giam gia tong cap quote - CHUA TUNG co field nao luu (da audit toan bo
-- QuoteCreateRequest/QuoteUpdateRequest, chi co discount per-item). NULL =
-- khong ap dung. Backend tinh lai "Gia sau giam"/"Margin sau giam" khi doc,
-- khong luu trung lap gia tri dan xuat.
ALTER TABLE public.quotes
    ADD COLUMN IF NOT EXISTS overall_discount_percent NUMERIC;

-- ============================================================================
-- price_book_create_or_reuse_draft(): lay Draft dang mo, hoac clone tu
-- Published thanh Draft moi (version+1), hoac tao Draft version=1 rong neu
-- chua tung publish. MOI thao tac Them/Sua/Xoa san pham deu goi ham nay
-- TRUOC de lay dung price_book_version_id can ghi vao - dam bao "sua san
-- pham Published tu tao/tiep tuc Draft moi, khong update thang record cu".
-- Advisory lock khoa theo tung price_book_id (2-int overload: 1 magic number
-- co dinh lam "namespace" + hashtext(price_book_id) lam khoa rieng tung
-- price book) de tranh 2 request tao trung 2 Draft cung luc.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.price_book_create_or_reuse_draft(
    p_price_book_id UUID, p_actor_id UUID
) RETURNS public.price_book_versions
LANGUAGE plpgsql
AS $$
DECLARE
    v_draft public.price_book_versions;
    v_published public.price_book_versions;
    v_new public.price_book_versions;
    v_next_version INT;
    v_section RECORD;
    v_new_section_id UUID;
BEGIN
    PERFORM pg_advisory_xact_lock(73092001, hashtext(p_price_book_id::text));

    SELECT * INTO v_draft FROM public.price_book_versions
        WHERE price_book_id = p_price_book_id AND status = 'draft' FOR UPDATE;
    IF FOUND THEN
        RETURN v_draft;
    END IF;

    SELECT * INTO v_published FROM public.price_book_versions
        WHERE price_book_id = p_price_book_id AND status = 'published';

    v_next_version := COALESCE(v_published.version, 0) + 1;

    INSERT INTO public.price_book_versions (price_book_id, version, status, created_by)
    VALUES (p_price_book_id, v_next_version, 'draft', p_actor_id)
    RETURNING * INTO v_new;

    IF v_published.id IS NOT NULL THEN
        CREATE TEMP TABLE IF NOT EXISTS tmp_price_book_section_map (old_id UUID PRIMARY KEY, new_id UUID) ON COMMIT DROP;

        FOR v_section IN
            SELECT * FROM public.price_book_sections WHERE price_book_version_id = v_published.id ORDER BY sort_order
        LOOP
            INSERT INTO public.price_book_sections (
                price_book_version_id, source_sheet, source_group_label, display_label, name, sort_order
            ) VALUES (
                v_new.id, v_section.source_sheet, v_section.source_group_label, v_section.display_label,
                v_section.name, v_section.sort_order
            ) RETURNING id INTO v_new_section_id;
            INSERT INTO tmp_price_book_section_map (old_id, new_id) VALUES (v_section.id, v_new_section_id);
        END LOOP;

        INSERT INTO public.price_book_items (
            price_book_version_id, section_id, source_sheet, source_stt, sku, name, description, unit,
            default_quantity, status, product_image_url, cost_mode, vendor_name, list_price_usd, unit_price_usd,
            unit_price_vnd_direct, exchange_rate, import_duty_percent, vat_in_percent, quote_received_date,
            quote_link, default_rate_percent, vat_eu_percent, reference_price, reference_link
        )
        SELECT
            v_new.id,
            (SELECT new_id FROM tmp_price_book_section_map WHERE old_id = i.section_id),
            i.source_sheet, i.source_stt, i.sku, i.name, i.description, i.unit,
            i.default_quantity, i.status, i.product_image_url, i.cost_mode, i.vendor_name, i.list_price_usd,
            i.unit_price_usd, i.unit_price_vnd_direct, i.exchange_rate, i.import_duty_percent, i.vat_in_percent,
            i.quote_received_date, i.quote_link, i.default_rate_percent, i.vat_eu_percent, i.reference_price,
            i.reference_link
        FROM public.price_book_items i
        WHERE i.price_book_version_id = v_published.id;
    END IF;

    INSERT INTO public.price_book_audit_log (price_book_version_id, actor_id, action, changes)
    VALUES (v_new.id, p_actor_id, 'create_draft',
            jsonb_build_object('cloned_from_version_id', v_published.id, 'cloned_from_version', v_published.version));

    RETURN v_new;
END;
$$;

-- ============================================================================
-- price_book_publish_version(): publish 1 Draft version - archive version
-- Published cu (neu co), activate version hien tai. Advisory lock theo
-- price_book_id (cung khoa voi ham tren) de khong dung do voi luc dang clone
-- Draft. Tu choi neu version khong o trang thai 'draft'.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.price_book_publish_version(
    p_version_id UUID, p_actor_id UUID
) RETURNS public.price_book_versions
LANGUAGE plpgsql
AS $$
DECLARE
    v_version public.price_book_versions;
    v_current_published public.price_book_versions;
    v_result public.price_book_versions;
BEGIN
    SELECT * INTO v_version FROM public.price_book_versions WHERE id = p_version_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'price_book_version_not_found';
    END IF;

    PERFORM pg_advisory_xact_lock(73092001, hashtext(v_version.price_book_id::text));

    IF v_version.status <> 'draft' THEN
        RAISE EXCEPTION 'price_book_version_not_draft';
    END IF;

    SELECT * INTO v_current_published FROM public.price_book_versions
        WHERE price_book_id = v_version.price_book_id AND status = 'published' FOR UPDATE;
    IF FOUND THEN
        UPDATE public.price_book_versions SET status = 'archived', updated_at = now()
            WHERE id = v_current_published.id;
    END IF;

    UPDATE public.price_book_versions
        SET status = 'published', published_by = p_actor_id, published_at = now(), updated_at = now()
        WHERE id = p_version_id
        RETURNING * INTO v_result;

    INSERT INTO public.price_book_audit_log (price_book_version_id, actor_id, action, changes)
    VALUES (p_version_id, p_actor_id, 'publish',
            jsonb_build_object('archived_version_id', v_current_published.id, 'archived_version', v_current_published.version));

    RETURN v_result;
END;
$$;

-- ============================================================================
-- Dinh nghia lai quote_update()/quote_create_version() (sau ban 105) - GIU
-- NGUYEN 100% logic hien co, CHI them doc/luu 7 cot Zone moi
-- (price_book_item_id/price_book_version_id/price_book_snapshot/
-- cost_override_reason/cost_override_by/cost_override_at/cost_price_original)
-- cho ca nhanh INSERT cha/con - dung theo dung khuon migration 105 da lam
-- voi cot `note`. Neu KHONG lam buoc nay, moi lan luu bao gia se lam MAT
-- toan bo du lieu snapshot Zone da chon (quote_update DELETE + re-INSERT
-- toan bo quote_items moi lan luu).
-- ============================================================================
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
            quote_id, parent_item_id, row_type, description, service_description, note, unit, quantity, unit_price,
            discount_percent, discount_amount, amount_after_discount, vat_rate,
            subtotal_amount, vat_amount, total_amount, sort_order,
            catalog_item_id, bundle_snapshot, list_price_usd, unit_price_usd, exchange_rate, unit_price_vnd,
            cost_price, markup_percent, cost_not_applicable,
            price_book_item_id, price_book_version_id, price_book_snapshot,
            cost_override_reason, cost_override_by, cost_override_at, cost_price_original
        ) VALUES (
            p_quote_id, NULL, v_row_type,
            COALESCE(v_item->>'description', ''),
            v_item->>'service_description',
            v_item->>'note',
            v_item->>'unit',
            v_qty, v_unit_price, v_discount_pct, v_item_discount, v_item_after_discount, v_vat_rate,
            v_item_subtotal, v_item_vat, v_item_total, v_parent_index,
            NULLIF(v_item->>'catalog_item_id', '')::uuid,
            v_item->'bundle_snapshot',
            (v_item->>'list_price_usd')::numeric,
            (v_item->>'unit_price_usd')::numeric,
            (v_item->>'exchange_rate')::numeric,
            (v_item->>'unit_price_vnd')::numeric,
            v_cost_price, v_markup_percent, v_cost_not_applicable,
            NULLIF(v_item->>'price_book_item_id', '')::uuid,
            NULLIF(v_item->>'price_book_version_id', '')::uuid,
            v_item->'price_book_snapshot',
            v_item->>'cost_override_reason',
            NULLIF(v_item->>'cost_override_by', '')::uuid,
            NULLIF(v_item->>'cost_override_at', '')::timestamptz,
            (v_item->>'cost_price_original')::numeric
        )
        RETURNING id INTO v_parent_id;

        v_subtotal := v_subtotal + v_item_subtotal;
        v_discount := v_discount + v_item_discount;
        v_vat := v_vat + v_item_vat;
        v_total := v_total + v_item_total;

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
                quote_id, parent_item_id, row_type, description, service_description, note, unit, quantity, unit_price,
                discount_percent, discount_amount, amount_after_discount, vat_rate,
                subtotal_amount, vat_amount, total_amount, sort_order,
                catalog_item_id, bundle_snapshot, list_price_usd, unit_price_usd, exchange_rate, unit_price_vnd,
                cost_price, markup_percent, cost_not_applicable,
                price_book_item_id, price_book_version_id, price_book_snapshot,
                cost_override_reason, cost_override_by, cost_override_at, cost_price_original
            ) VALUES (
                p_quote_id, v_parent_id, 'item',
                COALESCE(v_child->>'description', ''),
                v_child->>'service_description',
                v_child->>'note',
                v_child->>'unit',
                v_qty, v_unit_price, v_discount_pct, v_item_discount, v_item_after_discount, v_vat_rate,
                v_item_subtotal, v_item_vat, v_item_total, v_child_index,
                NULLIF(v_child->>'catalog_item_id', '')::uuid,
                v_child->'bundle_snapshot',
                (v_child->>'list_price_usd')::numeric,
                (v_child->>'unit_price_usd')::numeric,
                (v_child->>'exchange_rate')::numeric,
                (v_child->>'unit_price_vnd')::numeric,
                v_cost_price, v_markup_percent, v_cost_not_applicable,
                NULLIF(v_child->>'price_book_item_id', '')::uuid,
                NULLIF(v_child->>'price_book_version_id', '')::uuid,
                v_child->'price_book_snapshot',
                v_child->>'cost_override_reason',
                NULLIF(v_child->>'cost_override_by', '')::uuid,
                NULLIF(v_child->>'cost_override_at', '')::timestamptz,
                (v_child->>'cost_price_original')::numeric
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
        parent_quote_id, instance, issued_at, overall_discount_percent
    ) VALUES (
        v_source.deal_id, v_source.quote_form_id, v_source.issuer_company_id,
        p_new_quote_number, 'draft', v_source.form_schema_version, v_source.form_snapshot,
        v_source.data, v_source.subtotal_amount, v_source.vat_amount, v_source.total_amount,
        v_source.currency, p_actor_id, v_chain_id, v_next_version, v_source.id, v_source.instance,
        NOW(), v_source.overall_discount_percent
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
            cost_price, markup_percent, cost_not_applicable,
            price_book_item_id, price_book_version_id, price_book_snapshot,
            cost_override_reason, cost_override_by, cost_override_at, cost_price_original
        ) VALUES (
            v_new.id, NULL, v_item.row_type, v_item.description, v_item.service_description, v_item.note, v_item.unit,
            v_item.quantity, v_item.unit_price, v_item.discount_percent, v_item.discount_amount,
            v_item.amount_after_discount, v_item.vat_rate, v_item.subtotal_amount, v_item.vat_amount,
            v_item.total_amount, v_item.sort_order, v_item.catalog_item_id, v_item.bundle_snapshot,
            v_item.list_price_usd, v_item.unit_price_usd, v_item.exchange_rate, v_item.unit_price_vnd,
            v_item.cost_price, v_item.markup_percent, v_item.cost_not_applicable,
            v_item.price_book_item_id, v_item.price_book_version_id, v_item.price_book_snapshot,
            v_item.cost_override_reason, v_item.cost_override_by, v_item.cost_override_at, v_item.cost_price_original
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
            cost_price, markup_percent, cost_not_applicable,
            price_book_item_id, price_book_version_id, price_book_snapshot,
            cost_override_reason, cost_override_by, cost_override_at, cost_price_original
        ) VALUES (
            v_new.id, v_mapped_parent_id, v_item.row_type, v_item.description, v_item.service_description, v_item.note, v_item.unit,
            v_item.quantity, v_item.unit_price, v_item.discount_percent, v_item.discount_amount,
            v_item.amount_after_discount, v_item.vat_rate, v_item.subtotal_amount, v_item.vat_amount,
            v_item.total_amount, v_item.sort_order, v_item.catalog_item_id, v_item.bundle_snapshot,
            v_item.list_price_usd, v_item.unit_price_usd, v_item.exchange_rate, v_item.unit_price_vnd,
            v_item.cost_price, v_item.markup_percent, v_item.cost_not_applicable,
            v_item.price_book_item_id, v_item.price_book_version_id, v_item.price_book_snapshot,
            v_item.cost_override_reason, v_item.cost_override_by, v_item.cost_override_at, v_item.cost_price_original
        ) RETURNING id INTO v_new_item_id;
    END LOOP;

    INSERT INTO public.quote_activity_log (quote_id, actor_id, action, changes)
    VALUES (v_new.id, p_actor_id, 'version_created',
            jsonb_build_object('source_quote_id', v_source.id, 'source_version_number', v_source.version_number,
                                'clicked_quote_id', p_clicked_quote_id));

    RETURN QUERY SELECT v_new, true, v_source.id, v_source.version_number;
END;
$$;
