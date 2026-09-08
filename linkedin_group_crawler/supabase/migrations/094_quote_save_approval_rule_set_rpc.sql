-- RPC transactional cho "Luu quy tac phe duyet" (thay the cach cu goi
-- nhieu request PostgREST roi rac tu Python: update is_active=false ->
-- insert rule_set -> insert 4 rule, khong atomic - neu crash giua chung co
-- the de lai rule_set active nhung thieu rule, hoac 2 rule_set active cung
-- luc). Toan bo logic gop vao 1 function Postgres - PostgreSQL tu bao dam 1
-- loi goi ham = 1 transaction ngam dinh, loi o buoc nao thi ROLLBACK HET,
-- khong con trang thai do dang nua.
--
-- Idempotency: idempotency_key duy nhat tren toan bang - cung key goi lai
-- (double-click/network retry) tra ve DUNG rule_set da tao lan dau, KHONG
-- tao them version moi.
--
-- CHUA apply migration nay len DB that cho toi khi duoc xac nhan rieng.

ALTER TABLE public.quote_approval_rule_sets
    ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS quote_approval_rule_sets_idempotency_key_unique
    ON public.quote_approval_rule_sets (idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.quote_save_approval_rule_set(
    p_actor_id UUID,
    p_auto_approve_enabled BOOLEAN,
    p_rules JSONB, -- mang 4 phan tu: [{"rule_type","operator","threshold_value","unit","is_required","display_order","is_active"}, ...]
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

    -- Idempotency: cung key da xu ly roi -> tra ve DUNG ban da tao, khong
    -- tao them gi ca (an toan voi double-click/network retry).
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
    -- luc (vd double-click voi 2 idempotency_key khac nhau do bug FE) de
    -- khong bao gio co 2 dong active cung luc.
    SELECT * INTO v_current_active FROM public.quote_approval_rule_sets
        WHERE is_active = true FOR UPDATE;

    v_next_version := COALESCE(v_current_active.version, 0) + 1;

    INSERT INTO public.quote_approval_rule_sets (
        name, version, is_active, auto_approve_enabled, idempotency_key, created_by, updated_by
    ) VALUES (
        COALESCE(p_name, v_current_active.name, 'Bộ quy tắc duyệt báo giá mặc định'),
        v_next_version, true, p_auto_approve_enabled, p_idempotency_key,
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

    -- CHI deactivate ban cu SAU KHI ban moi + du 4 rule con da insert thanh
    -- cong (neu insert o tren loi, EXCEPTION se rollback het, ban cu VAN
    -- con active - khong bao gio roi vao trang thai "khong con ai active").
    IF v_current_active.id IS NOT NULL THEN
        UPDATE public.quote_approval_rule_sets SET is_active = false WHERE id = v_current_active.id;
    END IF;

    RETURN v_new;
END;
$$;
