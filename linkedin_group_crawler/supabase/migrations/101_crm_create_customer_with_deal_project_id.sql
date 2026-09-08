-- Migration 101: crm_create_customer_with_deal() phai luu duoc project_id
-- khi tao Co hoi tu Du an (Block 1, Customer Profile -> Project -> Co hoi).
--
-- Boi canh: migration 097 them cot customer_leads.project_id, nhung ham RPC
-- crm_create_customer_with_deal() (migration 077) dung 1 danh sach cot CO
-- DINH cho INSERT INTO customer_leads (khong dung jsonb_populate_record) -
-- nen du frontend/Python co gui project_id trong p_deal, RPC van AM THAM
-- BO QUA no (khong loi, chi khong luu) - dung dung bug "chi navigate voi
-- query param roi bo qua" ma yeu cau moi nhat canh bao phai tranh, nhung o
-- tang RPC thay vi tang UI.
--
-- Kem theo: neu p_deal->>'project_id' co gia tri, RPC tu xac minh Project do
-- THUOC DUNG v_customer_id (chan "Cross-customer Project" ngay tai DB, khong
-- chi dua vao dropdown UI da loc dung).
CREATE OR REPLACE FUNCTION public.crm_create_customer_with_deal(
    p_customer JSONB,
    p_deal JSONB,
    p_actor_id UUID,
    p_idempotency_key TEXT DEFAULT NULL,
    p_update_customer BOOLEAN DEFAULT false
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_customer_id UUID;
    v_project_id UUID;
    v_deal public.customer_leads;
    v_customer public.crm_customers;
    v_email TEXT;
    v_phone TEXT;
    v_response JSONB;
    v_existing_response JSONB;
    v_inserted_key UUID;
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
            created_by, note
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
            NULLIF(p_customer->>'note', '')
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

    -- project_id (migration 097) - neu co gui len, PHAI thuoc dung khach
    -- hang v_customer_id vua xac dinh o tren (chan Cross-customer Project
    -- ngay tai DB, khong chi dua vao UI da loc dung).
    v_project_id := NULLIF(p_deal->>'project_id', '')::uuid;
    IF v_project_id IS NOT NULL THEN
        PERFORM 1 FROM public.projects WHERE id = v_project_id AND customer_id = v_customer_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'project_customer_mismatch' USING MESSAGE = 'Dự án đã chọn không thuộc đúng khách hàng này.';
        END IF;
    END IF;

    INSERT INTO public.customer_leads (
        customer_id, project_id, customer_name, company_name, phone, email, address, city,
        website, industry, tax_code, source_platform, status, activity_status,
        deal_stage, follow_up_date, decision_maker, estimated_budget,
        service_package, crm_package, position, zalo, facebook, telegram,
        billing_type, contract_status, payment_status, note, next_step,
        pause_reason, leaded_by, sdr_id, team_id, has_budget, stage_entered_at
    ) VALUES (
        v_customer_id,
        v_project_id,
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
        now()
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
