-- Contact 360 - buoc 2: "Tạo cơ hội" TRUC TIEP (khong qua Lead convert) -
-- crm_create_customer_with_deal (migration 120) can 2 fix cung mau voi
-- crm_convert_lead (migration 133/134):
--
-- 1) Cung bi bug dedup khong loc theo instance (dong 68-73 cua ban 120,
--    SELECT id FROM crm_customers WHERE email/phone match, KHONG co dieu
--    kien instance) - da xac minh that day la nguyen mau CHINH XAC cua bug
--    da fix o crm_convert_lead migration 133. Fix tuong tu: AND instance =
--    v_instance.
--
-- 2) Deal tao qua duong nay (nut "+ Tạo cơ hội" tren Customer 360/Contact
--    360/menu Cơ hội toan cuc) chua biet gan primary_contact_id - them
--    p_deal->>'primary_contact_id' vao danh sach cot INSERT customer_leads,
--    dung y het cach crm_convert_lead da lam o migration 134. NULL neu
--    khong truyen (Deal khong bat buoc phai co Contact chinh).

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
            hashtextextended('crm_customer|' || v_instance || '|' || COALESCE(v_email, '') || '|' || COALESCE(v_phone, ''), 0)
        );

        -- FIX (dedup phai loc theo instance - xem chu thich dau file):
        SELECT id INTO v_customer_id
        FROM public.crm_customers
        WHERE instance = v_instance
          AND (
               (v_email IS NOT NULL AND email_normalized = v_email)
            OR (v_phone IS NOT NULL AND phone_normalized = v_phone)
          )
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

    -- FIX (Contact 360): them primary_contact_id vao Deal khi duoc truyen len
    -- (tao truc tiep tu Customer 360/Contact 360/menu Cơ hội toan cuc) - xem
    -- chu thich dau file. FE da validate Contact thuoc dung Customer nay o
    -- dropdown, BE (customer_lead_service.validate_contact_belongs_to_customer,
    -- goi tu router truoc khi toi RPC nay khi can) van la lop kiem tra chinh.
    INSERT INTO public.customer_leads (
        customer_id, primary_contact_id, customer_name, company_name, phone, email, address, city,
        website, industry, tax_code, source_platform, status, activity_status,
        deal_stage, follow_up_date, decision_maker, estimated_budget,
        service_package, crm_package, position, zalo, facebook, telegram,
        billing_type, contract_status, payment_status, note, next_step,
        pause_reason, leaded_by, sdr_id, team_id, has_budget, stage_entered_at,
        instance
    ) VALUES (
        v_customer_id,
        NULLIF(p_deal->>'primary_contact_id', '')::uuid,
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
