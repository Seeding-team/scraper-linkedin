-- BUG THAT DA GAP: crm_create_customer_with_deal (077) va crm_convert_lead
-- (078) hardcode INSERT INTO crm_customers / customer_leads ma KHONG co cot
-- `instance` trong danh sach cot -> Postgres tu dien DEFAULT cua cot (hien la
-- 'markee') cho MOI dong tao qua 2 RPC nay, bat ke request goi tu clone nao
-- (zone/cloud/module deu bi gan cung 'markee'). Hau qua: khach hang/deal tao
-- tu "+ Tao co hoi" tren cac clone bi AN hoan toan tren chinh clone do (list
-- da loc .eq("instance", settings.crm_instance) trong Python), va LOT sang
-- hien o main app (instance='markee') thay vi dung tenant that su tao ra no.
-- Da xac minh that: dong customer_leads.id=3b638390-... (customer_name='test',
-- tao 2026-09-11T11:32:53Z tu backend zone) nam trong DB voi instance='markee'.
--
-- Fix: them tham so p_instance cho ca 2 RPC, dua vao danh sach cot INSERT cua
-- ca crm_customers va customer_leads. Dung COALESCE(p_instance, 'markee') de
-- an toan nguoc (neu caller cu chua kip doi/chua truyen, hanh vi giu nguyen
-- nhu truoc - khong lam vo cac noi con dang goi RPC ma chua sua Python).

CREATE OR REPLACE FUNCTION public.crm_create_customer_with_deal(
    p_customer JSONB,
    p_deal JSONB,
    p_actor_id UUID,
    p_idempotency_key TEXT DEFAULT NULL,
    p_update_customer BOOLEAN DEFAULT false,
    p_instance TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_customer_id UUID;
    v_deal public.customer_leads;
    v_customer public.crm_customers;
    v_email TEXT;
    v_phone TEXT;
    v_response JSONB;
    v_existing_response JSONB;
    v_inserted_key UUID;
    v_instance TEXT := COALESCE(p_instance, 'markee');
BEGIN
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        INSERT INTO public.crm_request_idempotency (idempotency_key, actor_id, request_hash)
        VALUES (p_idempotency_key, p_actor_id, md5(COALESCE(p_customer::text, '') || '|' || COALESCE(p_deal::text, '')))
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING id INTO v_inserted_key;

        IF v_inserted_key IS NULL THEN
            SELECT response INTO v_existing_response
            FROM public.crm_request_idempotency
            WHERE idempotency_key = p_idempotency_key;

            IF v_existing_response IS NOT NULL THEN
                RETURN v_existing_response;
            END IF;

            RAISE EXCEPTION 'crm_request_in_progress';
        END IF;
    END IF;

    v_customer_id := NULLIF(p_deal->>'customer_id', '')::uuid;
    v_email := NULLIF(btrim(COALESCE(p_customer->>'email_normalized', '')), '');
    v_phone := NULLIF(btrim(COALESCE(p_customer->>'phone_normalized', '')), '');

    IF v_customer_id IS NULL AND (v_email IS NOT NULL OR v_phone IS NOT NULL) THEN
        PERFORM pg_advisory_xact_lock(
            hashtextextended('crm_customer|' || COALESCE(v_email, '') || '|' || COALESCE(v_phone, ''), 0)
        );

        SELECT id INTO v_customer_id
        FROM public.crm_customers
        WHERE (v_email IS NOT NULL AND email_normalized = v_email)
           OR (v_phone IS NOT NULL AND phone_normalized = v_phone)
        ORDER BY updated_at DESC
        LIMIT 1;
    END IF;

    IF v_customer_id IS NULL THEN
        INSERT INTO public.crm_customers (
            customer_name, company_name, position, phone, phone_normalized,
            email, email_normalized, zalo, facebook, telegram, website,
            tax_code, address, city, industry, source, status, owner_id,
            created_by, note, instance
        ) VALUES (
            COALESCE(NULLIF(p_customer->>'customer_name', ''), 'Khach hang chua ten'),
            NULLIF(p_customer->>'company_name', ''),
            NULLIF(p_customer->>'position', ''),
            NULLIF(p_customer->>'phone', ''),
            v_phone,
            NULLIF(p_customer->>'email', ''),
            v_email,
            NULLIF(p_customer->>'zalo', ''),
            NULLIF(p_customer->>'facebook', ''),
            NULLIF(p_customer->>'telegram', ''),
            NULLIF(p_customer->>'website', ''),
            NULLIF(p_customer->>'tax_code', ''),
            NULLIF(p_customer->>'address', ''),
            NULLIF(p_customer->>'city', ''),
            NULLIF(p_customer->>'industry', ''),
            NULLIF(p_customer->>'source', ''),
            COALESCE(NULLIF(p_customer->>'status', ''), 'new_lead'),
            COALESCE(NULLIF(p_customer->>'owner_id', '')::uuid, p_actor_id),
            COALESCE(NULLIF(p_customer->>'created_by', '')::uuid, p_actor_id),
            NULLIF(p_customer->>'note', ''),
            v_instance
        )
        RETURNING * INTO v_customer;
        v_customer_id := v_customer.id;
    ELSE
        SELECT * INTO v_customer FROM public.crm_customers WHERE id = v_customer_id FOR UPDATE;

        IF p_update_customer THEN
            UPDATE public.crm_customers
            SET
                customer_name = COALESCE(NULLIF(p_customer->>'customer_name', ''), customer_name),
                company_name = COALESCE(NULLIF(p_customer->>'company_name', ''), company_name),
                position = COALESCE(NULLIF(p_customer->>'position', ''), position),
                phone = COALESCE(NULLIF(p_customer->>'phone', ''), phone),
                phone_normalized = COALESCE(v_phone, phone_normalized),
                email = COALESCE(NULLIF(p_customer->>'email', ''), email),
                email_normalized = COALESCE(v_email, email_normalized),
                zalo = COALESCE(NULLIF(p_customer->>'zalo', ''), zalo),
                facebook = COALESCE(NULLIF(p_customer->>'facebook', ''), facebook),
                telegram = COALESCE(NULLIF(p_customer->>'telegram', ''), telegram),
                website = COALESCE(NULLIF(p_customer->>'website', ''), website),
                tax_code = COALESCE(NULLIF(p_customer->>'tax_code', ''), tax_code),
                address = COALESCE(NULLIF(p_customer->>'address', ''), address),
                city = COALESCE(NULLIF(p_customer->>'city', ''), city),
                industry = COALESCE(NULLIF(p_customer->>'industry', ''), industry),
                source = COALESCE(NULLIF(p_customer->>'source', ''), source),
                status = COALESCE(NULLIF(p_customer->>'status', ''), status),
                owner_id = COALESCE(NULLIF(p_customer->>'owner_id', '')::uuid, owner_id),
                note = COALESCE(NULLIF(p_customer->>'note', ''), note)
            WHERE id = v_customer_id
            RETURNING * INTO v_customer;
        END IF;
    END IF;

    INSERT INTO public.customer_leads (
        customer_id, customer_name, company_name, phone, email, address, city,
        website, industry, tax_code, source_platform, status, activity_status,
        deal_stage, follow_up_date, decision_maker, estimated_budget,
        service_package, crm_package, position, zalo, facebook, telegram,
        billing_type, contract_status, payment_status, note, next_step,
        pause_reason, leaded_by, sdr_id, team_id, has_budget, stage_entered_at,
        instance
    ) VALUES (
        v_customer_id,
        COALESCE(NULLIF(p_deal->>'customer_name', ''), NULLIF(p_customer->>'customer_name', ''), 'Khach hang chua ten'),
        NULLIF(p_deal->>'company_name', ''),
        NULLIF(p_deal->>'phone', ''),
        NULLIF(p_deal->>'email', ''),
        NULLIF(p_deal->>'address', ''),
        NULLIF(p_deal->>'city', ''),
        NULLIF(p_deal->>'website', ''),
        NULLIF(p_deal->>'industry', ''),
        NULLIF(p_deal->>'tax_code', ''),
        COALESCE(NULLIF(p_deal->>'source_platform', ''), 'Manual'),
        COALESCE(NULLIF(p_deal->>'status', ''), 'pending'),
        COALESCE(NULLIF(p_deal->>'activity_status', ''), 'active'),
        COALESCE(NULLIF(p_deal->>'deal_stage', ''), 'new_lead'),
        NULLIF(p_deal->>'follow_up_date', '')::timestamptz,
        NULLIF(p_deal->>'decision_maker', ''),
        COALESCE(NULLIF(p_deal->>'estimated_budget', '')::numeric, 0),
        NULLIF(p_deal->>'service_package', ''),
        NULLIF(p_deal->>'crm_package', ''),
        NULLIF(p_deal->>'position', ''),
        NULLIF(p_deal->>'zalo', ''),
        NULLIF(p_deal->>'facebook', ''),
        NULLIF(p_deal->>'telegram', ''),
        COALESCE(NULLIF(p_deal->>'billing_type', ''), 'one_time'),
        COALESCE(NULLIF(p_deal->>'contract_status', ''), 'active'),
        COALESCE(NULLIF(p_deal->>'payment_status', ''), 'unpaid'),
        NULLIF(p_deal->>'note', ''),
        NULLIF(p_deal->>'next_step', ''),
        NULLIF(p_deal->>'pause_reason', ''),
        COALESCE(NULLIF(p_deal->>'leaded_by', '')::uuid, p_actor_id),
        NULLIF(p_deal->>'sdr_id', '')::uuid,
        NULLIF(p_deal->>'team_id', '')::uuid,
        COALESCE(NULLIF(p_deal->>'has_budget', '')::boolean, false),
        now(),
        v_instance
    )
    RETURNING * INTO v_deal;

    INSERT INTO public.customer_lead_activity_log (
        customer_id, action, to_stage, actor_id, note
    ) VALUES (
        v_deal.id, 'created', v_deal.deal_stage, p_actor_id, v_deal.note
    );

    SELECT * INTO v_customer FROM public.crm_customers WHERE id = v_customer_id;

    v_response := jsonb_build_object(
        'customer', to_jsonb(v_customer),
        'deal', to_jsonb(v_deal),
        'partial', false
    );

    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        UPDATE public.crm_request_idempotency
        SET response = v_response
        WHERE idempotency_key = p_idempotency_key;
    END IF;

    RETURN v_response;
END;
$$;


CREATE OR REPLACE FUNCTION public.crm_convert_lead(
    p_lead_id UUID,
    p_customer JSONB DEFAULT NULL,
    p_customer_id UUID DEFAULT NULL,
    p_contact JSONB DEFAULT NULL,
    p_contact_id UUID DEFAULT NULL,
    p_deal JSONB DEFAULT NULL,
    p_actor_id UUID DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL,
    p_update_customer BOOLEAN DEFAULT false,
    p_instance TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_lead public.crm_leads;
    v_customer public.crm_customers;
    v_customer_id UUID;
    v_contact public.crm_contacts;
    v_contact_id UUID;
    v_deal public.customer_leads;
    v_email TEXT;
    v_phone TEXT;
    v_tax_code TEXT;
    v_website_domain TEXT;
    v_name TEXT;
    v_response JSONB;
    v_existing_response JSONB;
    v_inserted_key UUID;
    v_instance TEXT := COALESCE(p_instance, 'markee');
BEGIN
    -- 1) Idempotency: exact copy of the check/replay pattern from
    -- crm_create_customer_with_deal (migration 077).
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        INSERT INTO public.crm_request_idempotency (idempotency_key, actor_id, request_hash)
        VALUES (
            p_idempotency_key,
            p_actor_id,
            md5(COALESCE(p_lead_id::text, '') || '|' || COALESCE(p_customer::text, '') || '|' ||
                COALESCE(p_customer_id::text, '') || '|' || COALESCE(p_contact::text, '') || '|' ||
                COALESCE(p_contact_id::text, '') || '|' || COALESCE(p_deal::text, ''))
        )
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING id INTO v_inserted_key;

        IF v_inserted_key IS NULL THEN
            SELECT response INTO v_existing_response
            FROM public.crm_request_idempotency
            WHERE idempotency_key = p_idempotency_key;

            IF v_existing_response IS NOT NULL THEN
                RETURN v_existing_response;
            END IF;

            RAISE EXCEPTION 'crm_request_in_progress';
        END IF;
    END IF;

    -- 2) Lock the lead row; refuse double-convert.
    SELECT * INTO v_lead FROM public.crm_leads WHERE id = p_lead_id FOR UPDATE;
    IF v_lead.id IS NULL THEN
        RAISE EXCEPTION 'crm_lead_not_found';
    END IF;
    IF v_lead.status = 'converted' THEN
        RAISE EXCEPTION 'crm_lead_already_converted';
    END IF;

    -- 3) Customer resolution.
    v_customer_id := p_customer_id;
    IF v_customer_id IS NOT NULL THEN
        SELECT * INTO v_customer FROM public.crm_customers WHERE id = v_customer_id FOR UPDATE;
        IF v_customer.id IS NULL THEN
            RAISE EXCEPTION 'crm_customer_not_found';
        END IF;

        IF p_update_customer AND p_customer IS NOT NULL THEN
            UPDATE public.crm_customers
            SET
                customer_name = COALESCE(NULLIF(p_customer->>'customer_name', ''), customer_name),
                company_name = COALESCE(NULLIF(p_customer->>'company_name', ''), company_name),
                position = COALESCE(NULLIF(p_customer->>'position', ''), position),
                phone = COALESCE(NULLIF(p_customer->>'phone', ''), phone),
                phone_normalized = COALESCE(NULLIF(p_customer->>'phone_normalized', ''), phone_normalized),
                email = COALESCE(NULLIF(p_customer->>'email', ''), email),
                email_normalized = COALESCE(NULLIF(p_customer->>'email_normalized', ''), email_normalized),
                zalo = COALESCE(NULLIF(p_customer->>'zalo', ''), zalo),
                facebook = COALESCE(NULLIF(p_customer->>'facebook', ''), facebook),
                telegram = COALESCE(NULLIF(p_customer->>'telegram', ''), telegram),
                website = COALESCE(NULLIF(p_customer->>'website', ''), website),
                tax_code = COALESCE(NULLIF(p_customer->>'tax_code', ''), tax_code),
                address = COALESCE(NULLIF(p_customer->>'address', ''), address),
                city = COALESCE(NULLIF(p_customer->>'city', ''), city),
                industry = COALESCE(NULLIF(p_customer->>'industry', ''), industry),
                source = COALESCE(NULLIF(p_customer->>'source', ''), source),
                note = COALESCE(NULLIF(p_customer->>'note', ''), note)
            WHERE id = v_customer_id
            RETURNING * INTO v_customer;
        END IF;
    ELSIF p_customer IS NOT NULL THEN
        v_email := NULLIF(btrim(COALESCE(p_customer->>'email_normalized', '')), '');
        v_phone := NULLIF(btrim(COALESCE(p_customer->>'phone_normalized', '')), '');
        v_tax_code := NULLIF(btrim(COALESCE(p_customer->>'tax_code', '')), '');
        v_website_domain := NULLIF(btrim(lower(COALESCE(p_customer->>'website', ''))), '');
        v_name := NULLIF(btrim(COALESCE(p_customer->>'customer_name', '')), '');

        -- Mirror crm_create_customer_with_deal's advisory-lock find-or-create,
        -- extended with tax_code/website/name per the spec's company_match
        -- fields (same idea, one more few match keys).
        PERFORM pg_advisory_xact_lock(
            hashtextextended(
                'crm_customer|' || COALESCE(v_email, '') || '|' || COALESCE(v_phone, '') || '|' ||
                COALESCE(v_tax_code, '') || '|' || COALESCE(v_website_domain, ''),
                0
            )
        );

        SELECT id INTO v_customer_id
        FROM public.crm_customers
        WHERE (v_email IS NOT NULL AND email_normalized = v_email)
           OR (v_phone IS NOT NULL AND phone_normalized = v_phone)
           OR (v_tax_code IS NOT NULL AND tax_code = v_tax_code)
           OR (v_website_domain IS NOT NULL AND lower(website) = v_website_domain)
           OR (v_name IS NOT NULL AND lower(customer_name) = lower(v_name))
        ORDER BY updated_at DESC
        LIMIT 1;

        IF v_customer_id IS NOT NULL THEN
            SELECT * INTO v_customer FROM public.crm_customers WHERE id = v_customer_id FOR UPDATE;
        ELSE
            INSERT INTO public.crm_customers (
                customer_name, company_name, position, phone, phone_normalized,
                email, email_normalized, zalo, facebook, telegram, website,
                tax_code, address, city, industry, source, status, owner_id,
                created_by, note, instance
            ) VALUES (
                COALESCE(v_name, 'Khach hang chua ten'),
                NULLIF(p_customer->>'company_name', ''),
                NULLIF(p_customer->>'position', ''),
                NULLIF(p_customer->>'phone', ''),
                v_phone,
                NULLIF(p_customer->>'email', ''),
                v_email,
                NULLIF(p_customer->>'zalo', ''),
                NULLIF(p_customer->>'facebook', ''),
                NULLIF(p_customer->>'telegram', ''),
                NULLIF(p_customer->>'website', ''),
                v_tax_code,
                NULLIF(p_customer->>'address', ''),
                NULLIF(p_customer->>'city', ''),
                NULLIF(p_customer->>'industry', ''),
                NULLIF(p_customer->>'source', ''),
                COALESCE(NULLIF(p_customer->>'status', ''), 'new_lead'),
                p_actor_id,  -- never trust client owner_id/created_by
                p_actor_id,
                NULLIF(p_customer->>'note', ''),
                v_instance
            )
            RETURNING * INTO v_customer;
            v_customer_id := v_customer.id;
        END IF;
    ELSE
        RAISE EXCEPTION 'crm_convert_lead_missing_customer';
    END IF;

    -- 4) Contact resolution (optional).
    v_contact_id := p_contact_id;
    IF v_contact_id IS NOT NULL THEN
        SELECT * INTO v_contact FROM public.crm_contacts WHERE id = v_contact_id;
        IF v_contact.id IS NULL THEN
            RAISE EXCEPTION 'crm_contact_not_found';
        END IF;
    ELSIF p_contact IS NOT NULL AND p_contact <> 'null'::jsonb AND p_contact <> '{}'::jsonb THEN
        INSERT INTO public.crm_contacts (
            customer_id, name, position, phone, phone_normalized, email,
            email_normalized, zalo, facebook, is_primary, note, created_by
        ) VALUES (
            v_customer_id,
            COALESCE(NULLIF(p_contact->>'name', ''), v_lead.lead_name),
            NULLIF(p_contact->>'position', ''),
            NULLIF(p_contact->>'phone', ''),
            NULLIF(p_contact->>'phone_normalized', ''),
            NULLIF(p_contact->>'email', ''),
            NULLIF(p_contact->>'email_normalized', ''),
            NULLIF(p_contact->>'zalo', ''),
            NULLIF(p_contact->>'facebook', ''),
            COALESCE((p_contact->>'is_primary')::boolean, false),
            NULLIF(p_contact->>'note', ''),
            p_actor_id
        )
        RETURNING * INTO v_contact;
        v_contact_id := v_contact.id;
    END IF;

    -- 5) Deal creation — a row in customer_leads (Deal table), never in
    -- crm_leads. Mirrors crm_create_customer_with_deal's column set/defaults.
    INSERT INTO public.customer_leads (
        customer_id, customer_name, company_name, phone, email, address, city,
        website, industry, tax_code, source_platform, status, activity_status,
        deal_stage, follow_up_date, decision_maker, estimated_budget,
        service_package, crm_package, position, zalo, facebook, telegram,
        billing_type, contract_status, payment_status, note, next_step,
        pause_reason, leaded_by, sdr_id, team_id, has_budget, stage_entered_at,
        instance
    ) VALUES (
        v_customer_id,
        COALESCE(NULLIF(p_deal->>'customer_name', ''), v_customer.customer_name, v_lead.lead_name),
        COALESCE(NULLIF(p_deal->>'company_name', ''), v_customer.company_name, v_lead.company_name),
        COALESCE(NULLIF(p_deal->>'phone', ''), v_customer.phone, v_lead.phone),
        COALESCE(NULLIF(p_deal->>'email', ''), v_customer.email, v_lead.email),
        NULLIF(p_deal->>'address', ''),
        NULLIF(p_deal->>'city', ''),
        COALESCE(NULLIF(p_deal->>'website', ''), v_customer.website, v_lead.website),
        NULLIF(p_deal->>'industry', ''),
        NULLIF(p_deal->>'tax_code', ''),
        COALESCE(NULLIF(p_deal->>'source_platform', ''), NULLIF(v_lead.source, ''), 'Manual'),
        COALESCE(NULLIF(p_deal->>'status', ''), 'pending'),
        COALESCE(NULLIF(p_deal->>'activity_status', ''), 'active'),
        COALESCE(NULLIF(p_deal->>'deal_stage', ''), 'new_lead'),
        COALESCE(NULLIF(p_deal->>'follow_up_date', '')::timestamptz, v_lead.follow_up_date),
        COALESCE(NULLIF(p_deal->>'decision_maker', ''), v_lead.qualification_decision_maker),
        COALESCE(NULLIF(p_deal->>'estimated_budget', '')::numeric, v_lead.qualification_estimated_value, 0),
        NULLIF(p_deal->>'service_package', ''),
        NULLIF(p_deal->>'crm_package', ''),
        COALESCE(NULLIF(p_deal->>'position', ''), v_lead.position),
        COALESCE(NULLIF(p_deal->>'zalo', ''), v_lead.zalo),
        COALESCE(NULLIF(p_deal->>'facebook', ''), v_lead.facebook),
        COALESCE(NULLIF(p_deal->>'telegram', ''), v_lead.telegram),
        COALESCE(NULLIF(p_deal->>'billing_type', ''), 'one_time'),
        COALESCE(NULLIF(p_deal->>'contract_status', ''), 'active'),
        COALESCE(NULLIF(p_deal->>'payment_status', ''), 'unpaid'),
        NULLIF(p_deal->>'note', ''),
        COALESCE(NULLIF(p_deal->>'next_step', ''), v_lead.next_step),
        NULLIF(p_deal->>'pause_reason', ''),
        COALESCE(NULLIF(p_deal->>'leaded_by', '')::uuid, p_actor_id),
        COALESCE(NULLIF(p_deal->>'sdr_id', '')::uuid, v_lead.sdr_id, p_actor_id),
        NULLIF(p_deal->>'team_id', '')::uuid,
        COALESCE(NULLIF(p_deal->>'has_budget', '')::boolean, false),
        now(),
        v_instance
    )
    RETURNING * INTO v_deal;

    -- 6) Activity/audit log — reuse customer_lead_activity_log (021), do not
    -- invent a new table. customer_id column there actually stores the deal id.
    INSERT INTO public.customer_lead_activity_log (
        customer_id, action, to_stage, actor_id, note
    ) VALUES (
        v_deal.id, 'converted_from_lead', v_deal.deal_stage, p_actor_id,
        'Converted from crm_leads.id=' || p_lead_id::text
    );

    -- 7) Mark the lead converted with FK links.
    UPDATE public.crm_leads
    SET
        status = 'converted',
        converted_customer_id = v_customer_id,
        converted_contact_id = v_contact_id,
        converted_deal_id = v_deal.id,
        converted_by = p_actor_id,
        converted_at = now()
    WHERE id = p_lead_id
    RETURNING * INTO v_lead;

    SELECT * INTO v_customer FROM public.crm_customers WHERE id = v_customer_id;
    IF v_contact_id IS NOT NULL THEN
        SELECT * INTO v_contact FROM public.crm_contacts WHERE id = v_contact_id;
    END IF;

    v_response := jsonb_build_object(
        'lead', to_jsonb(v_lead),
        'customer', to_jsonb(v_customer),
        'contact', CASE WHEN v_contact_id IS NOT NULL THEN to_jsonb(v_contact) ELSE NULL END,
        'deal', to_jsonb(v_deal),
        'partial', false
    );

    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        UPDATE public.crm_request_idempotency
        SET response = v_response
        WHERE idempotency_key = p_idempotency_key;
    END IF;

    RETURN v_response;
END;
$$;
