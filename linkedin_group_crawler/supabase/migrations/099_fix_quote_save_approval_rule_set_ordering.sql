-- Fix bug THAT (migration 094 co loi thu tu thao tac): quote_save_approval_
-- rule_set() INSERT rule-set MOI voi is_active=true TRUOC KHI deactivate
-- rule-set CU (van dang is_active=true) - vi pham NGAY unique index
-- quote_approval_rule_sets_one_active ((1)) WHERE is_active (migration 091,
-- chi cho phep DUNG 1 dong is_active=true tai 1 thoi diem). Loi that nguoi
-- dung gap: "duplicate key value violates unique constraint
-- quote_approval_rule_sets_one_active ... Key (1)=(1) already exists".
--
-- Fix: INSERT rule-set moi voi is_active=FALSE truoc, insert du 4 rule,
-- RIENG SAU DO moi deactivate ban cu + activate ban moi (2 buoc lien tiep,
-- khong bao gio co 2 dong active cung luc). Toan bo van nam trong 1 ham
-- plpgsql = 1 transaction ngam dinh - loi o buoc nao (vd insert rule sai
-- kieu du lieu) van ROLLBACK HET, ban cu VAN giu nguyen is_active=true (an
-- toan nhu thiet ke goc, chi sai THU TU cac buoc).
--
-- CHUA apply migration nay len DB that cho toi khi duoc xac nhan rieng.

CREATE OR REPLACE FUNCTION public.quote_save_approval_rule_set(
    p_actor_id UUID,
    p_auto_approve_enabled BOOLEAN,
    p_rules JSONB,
    p_idempotency_key TEXT,
    p_name TEXT DEFAULT NULL
) RETURNS public.quote_approval_rule_sets
LANGUAGE plpgsql
AS $$
DECLARE
    v_existing_by_key public.quote_approval_rule_sets;
    v_current_active public.quote_approval_rule_sets;
    v_new public.quote_approval_rule_sets;
    v_next_version INT;
    v_rule JSONB;
    v_rule_count INT;
BEGIN
    IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
        RAISE EXCEPTION 'idempotency_key_required';
    END IF;

    SELECT * INTO v_existing_by_key FROM public.quote_approval_rule_sets
        WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
        RETURN v_existing_by_key;
    END IF;

    SELECT jsonb_array_length(p_rules) INTO v_rule_count;
    IF v_rule_count IS NULL OR v_rule_count <> 4 THEN
        RAISE EXCEPTION 'quote_approval_rules_must_have_exactly_4';
    END IF;

    -- Khoa dong active hien tai (neu co) - serialize 2 request "Luu" cung
    -- luc (double-click, 2 tab, 2 admin cung sua) de khong bao gio co 2
    -- dong active cung luc du chay dong thoi.
    SELECT * INTO v_current_active FROM public.quote_approval_rule_sets
        WHERE is_active = true FOR UPDATE;

    v_next_version := COALESCE(v_current_active.version, 0) + 1;

    -- BUOC 1 (FIX): insert ban MOI voi is_active=FALSE truoc - KHONG bao
    -- gio de 2 dong is_active=true ton tai dong thoi (vi pham unique index).
    INSERT INTO public.quote_approval_rule_sets (
        name, version, is_active, auto_approve_enabled, idempotency_key, created_by, updated_by
    ) VALUES (
        COALESCE(p_name, v_current_active.name, 'Bộ quy tắc duyệt báo giá mặc định'),
        v_next_version, false, p_auto_approve_enabled, p_idempotency_key,
        COALESCE(v_current_active.created_by, p_actor_id), p_actor_id
    ) RETURNING * INTO v_new;

    FOR v_rule IN SELECT * FROM jsonb_array_elements(p_rules) LOOP
        INSERT INTO public.quote_approval_rules (
            rule_set_id, rule_type, operator, threshold_value, unit, is_required, display_order, is_active
        ) VALUES (
            v_new.id,
            v_rule->>'rule_type',
            v_rule->>'operator',
            (v_rule->>'threshold_value')::numeric,
            v_rule->>'unit',
            COALESCE((v_rule->>'is_required')::boolean, true),
            COALESCE((v_rule->>'display_order')::int, 0),
            COALESCE((v_rule->>'is_active')::boolean, true)
        );
    END LOOP;

    -- BUOC 2 (FIX): CHI SAU KHI ban moi + du 4 rule da insert thanh cong
    -- (neu loi o tren, EXCEPTION rollback het, ban cu VAN active) - deactivate
    -- ban cu TRUOC, roi MOI activate ban moi. Thu tu nay dam bao KHONG BAO
    -- GIO co 2 dong is_active=true cung luc (khac ban 094 cu: insert moi
    -- active=true TRUOC roi moi deactivate cu - gay loi unique constraint).
    IF v_current_active.id IS NOT NULL THEN
        UPDATE public.quote_approval_rule_sets SET is_active = false WHERE id = v_current_active.id;
    END IF;
    UPDATE public.quote_approval_rule_sets SET is_active = true WHERE id = v_new.id
        RETURNING * INTO v_new;

    RETURN v_new;
END;
$$;
