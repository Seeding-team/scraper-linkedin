-- Bo sung transaction-level advisory lock cho quote_save_approval_rule_set()
-- (migration 099 da fix THU TU thao tac insert/deactivate/activate, nhung
-- 099 CHI dung `SELECT ... FOR UPDATE` tren dong is_active=true HIEN CO de
-- serialize 2 request "Luu" cung luc - dieu nay chi hoat dong NEU da co san
-- 1 dong active. Neu chua tung co rule-set nao (lan luu DAU TIEN, bang
-- rong), `FOR UPDATE` khong khoa duoc gi ca (khong co dong nao de khoa) -
-- 2 request "luu lan dau" chay dong thoi van co the cung insert 2 dong
-- is_active=false roi cung activate, dan toi vi pham unique index
-- quote_approval_rule_sets_one_active o buoc UPDATE cuoi. Truong hop nay
-- HIEM (thuong da co san 1 active tu truoc) nhung van la 1 khe ho that.
--
-- Fix: giu NGUYEN toan bo logic/thu tu cua 099 (khong sua file 099 da
-- apply), CHI THEM 1 dong pg_advisory_xact_lock() voi 1 key CO DINH ngay
-- dau ham - khoa nay LUON serialize moi lan goi ham nay (bat ke bang co
-- dong nao hay khong), tu dong nha khi transaction ket thuc (commit hoac
-- rollback), khong can unlock thu cong.
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
    -- Key co dinh tuy chon cho "cau hinh Rule Engine global" - 2 so bat ky,
    -- chi can DUY NHAT trong toan bo cac loi goi pg_advisory_xact_lock cua
    -- he thong (chua dung o dau khac trong cac migration hien co, da grep
    -- xac nhan). Khoa nay serialize MOI lan goi ham nay tuyet doi, ke ca khi
    -- bang dang rong (khac FOR UPDATE ben duoi, chi khoa duoc dong DA TON
    -- TAI).
    PERFORM pg_advisory_xact_lock(72091001, 1);

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

    -- FOR UPDATE giu lai de tuong thich - nay la lop khoa THU 2 (row-level),
    -- advisory lock o tren la lop khoa CHINH dam bao serialize ke ca khi
    -- chua co dong active nao.
    SELECT * INTO v_current_active FROM public.quote_approval_rule_sets
        WHERE is_active = true FOR UPDATE;

    v_next_version := COALESCE(v_current_active.version, 0) + 1;

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

    IF v_current_active.id IS NOT NULL THEN
        UPDATE public.quote_approval_rule_sets SET is_active = false WHERE id = v_current_active.id;
    END IF;
    UPDATE public.quote_approval_rule_sets SET is_active = true WHERE id = v_new.id
        RETURNING * INTO v_new;

    RETURN v_new;
END;
$$;
