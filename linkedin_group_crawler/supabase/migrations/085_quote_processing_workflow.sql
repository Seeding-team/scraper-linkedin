-- Phase 2 "Workspace xu ly bao gia": them du lieu THAT cho 4 buoc xu ly noi
-- bo (Yeu cau bao gia -> Thong tin ky thuat -> Hoan thien gia ban -> Cho
-- duyet/Phat hanh) va checklist ban giao ky thuat -> nguoi phu trach bao gia.
-- Truoc migration nay, DB chi co status draft/approved/cancelled(+confirmed
-- cu) - KHONG du de ve 1 workflow 4 buoc that (da khao sat va bao lai nguoi
-- dung truoc khi code, duoc xac nhan them migration that thay vi hard-code
-- FE). Khong tao role/team gia - van dung app_users/teams hien co.

-- 1) Buoc xu ly noi bo (doc lap voi `status` - status van la nguon THAT cho
--    quyen xem/duyet/tao version, processing_stage chi la "dang o buoc nao
--    trong luc con la draft"). Mac dinh 'request' cho quote moi tao.
ALTER TABLE public.quotes
    ADD COLUMN IF NOT EXISTS processing_stage TEXT NOT NULL DEFAULT 'request'
        CHECK (processing_stage IN ('request', 'technical', 'pricing', 'review'));

-- 2) Nguoi phu trach ky thuat / nguoi phu trach bao gia - tach rieng vi 1
--    quote co the duoc tao boi 1 nguoi (created_by) nhung phan cong ky thuat/
--    gia ban cho nguoi khac. NULL = "Chua gan" (khong bia du lieu).
ALTER TABLE public.quotes
    ADD COLUMN IF NOT EXISTS technical_owner_id UUID REFERENCES public.app_users(id),
    ADD COLUMN IF NOT EXISTS quote_owner_id UUID REFERENCES public.app_users(id);

-- 3) Checklist ban giao ky thuat -> bao gia (Scope/Cost/Timeline/Assumption)
--    - 1 dong / quote, cap nhat tai cho (upsert qua RPC ben duoi).
CREATE TABLE IF NOT EXISTS public.quote_handoff_checklist (
    quote_id            UUID PRIMARY KEY REFERENCES public.quotes(id) ON DELETE CASCADE,
    scope_confirmed      BOOLEAN NOT NULL DEFAULT false,
    scope_note           TEXT,
    cost_confirmed        BOOLEAN NOT NULL DEFAULT false,
    cost_note            TEXT,
    timeline_confirmed    BOOLEAN NOT NULL DEFAULT false,
    timeline_note        TEXT,
    assumption_confirmed  BOOLEAN NOT NULL DEFAULT false,
    assumption_note      TEXT,
    handoff_note         TEXT,
    handed_off_at        TIMESTAMP WITH TIME ZONE,
    handed_off_by        UUID REFERENCES public.app_users(id),
    updated_at           TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_by           UUID REFERENCES public.app_users(id)
);

ALTER TABLE public.quote_handoff_checklist ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow authenticated full access to quote_handoff_checklist"
ON public.quote_handoff_checklist
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- 4) Chuyen buoc xu ly - CHI cho phep tien (request -> technical -> pricing ->
--    review), khong cho nhay buoc/lui buoc qua API nay (tranh trang thai gia
--    tao qua click nham) - RPC tu chan that su, khong chi dua vao FE an nut.
--    Quote da approved/confirmed/cancelled thi khoa cung, khong doi buoc nua.
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
BEGIN
    SELECT * INTO v_quote FROM public.quotes WHERE id = p_quote_id FOR UPDATE;
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

    UPDATE public.quotes SET processing_stage = p_stage, updated_by = p_actor_id
    WHERE id = p_quote_id
    RETURNING * INTO v_quote;

    INSERT INTO public.quote_activity_log (quote_id, actor_id, action, changes)
    VALUES (p_quote_id, p_actor_id, 'stage_changed', jsonb_build_object('stage', p_stage));

    RETURN v_quote;
END;
$$;

-- 5) Luu checklist ban giao (upsert) - tu tinh handed_off_at/handed_off_by
--    ngay khi ca 4 muc (scope/cost/timeline/assumption) deu da xac nhan (chi
--    set 1 lan, khong ghi de neu da co - giu dung nguoi/thoi diem ban giao
--    THAT dau tien).
CREATE OR REPLACE FUNCTION public.quote_save_handoff_checklist(
    p_quote_id UUID, p_actor_id UUID,
    p_scope_confirmed BOOLEAN, p_scope_note TEXT,
    p_cost_confirmed BOOLEAN, p_cost_note TEXT,
    p_timeline_confirmed BOOLEAN, p_timeline_note TEXT,
    p_assumption_confirmed BOOLEAN, p_assumption_note TEXT,
    p_handoff_note TEXT
) RETURNS public.quote_handoff_checklist
LANGUAGE plpgsql
AS $$
DECLARE
    v_row public.quote_handoff_checklist;
    v_all_confirmed BOOLEAN;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.quotes WHERE id = p_quote_id) THEN
        RAISE EXCEPTION 'quote_not_found';
    END IF;

    v_all_confirmed := p_scope_confirmed AND p_cost_confirmed AND p_timeline_confirmed AND p_assumption_confirmed;

    INSERT INTO public.quote_handoff_checklist (
        quote_id, scope_confirmed, scope_note, cost_confirmed, cost_note,
        timeline_confirmed, timeline_note, assumption_confirmed, assumption_note,
        handoff_note, handed_off_at, handed_off_by, updated_by
    ) VALUES (
        p_quote_id, p_scope_confirmed, p_scope_note, p_cost_confirmed, p_cost_note,
        p_timeline_confirmed, p_timeline_note, p_assumption_confirmed, p_assumption_note,
        p_handoff_note, CASE WHEN v_all_confirmed THEN NOW() ELSE NULL END,
        CASE WHEN v_all_confirmed THEN p_actor_id ELSE NULL END, p_actor_id
    )
    ON CONFLICT (quote_id) DO UPDATE SET
        scope_confirmed = EXCLUDED.scope_confirmed,
        scope_note = EXCLUDED.scope_note,
        cost_confirmed = EXCLUDED.cost_confirmed,
        cost_note = EXCLUDED.cost_note,
        timeline_confirmed = EXCLUDED.timeline_confirmed,
        timeline_note = EXCLUDED.timeline_note,
        assumption_confirmed = EXCLUDED.assumption_confirmed,
        assumption_note = EXCLUDED.assumption_note,
        handoff_note = EXCLUDED.handoff_note,
        handed_off_at = COALESCE(public.quote_handoff_checklist.handed_off_at,
                                  CASE WHEN v_all_confirmed THEN NOW() ELSE NULL END),
        handed_off_by = COALESCE(public.quote_handoff_checklist.handed_off_by,
                                  CASE WHEN v_all_confirmed THEN p_actor_id ELSE NULL END),
        updated_at = NOW(),
        updated_by = p_actor_id
    RETURNING * INTO v_row;

    INSERT INTO public.quote_activity_log (quote_id, actor_id, action, changes)
    VALUES (p_quote_id, p_actor_id, 'handoff_updated',
            jsonb_build_object('all_confirmed', v_all_confirmed));

    RETURN v_row;
END;
$$;

-- 6) quote_approve() dinh nghia lai (giong cach 084 da lam voi
--    quote_create_version) - chi them 1 dong set processing_stage='review' khi
--    duyet, logic con lai giu NGUYEN 100% nhu ban MOI NHAT (migration 060, cho
--    duyet ca tu 'confirmed' - KHONG phai ban goc 059, tranh regression).
CREATE OR REPLACE FUNCTION public.quote_approve(
    p_quote_id UUID, p_actor_id UUID, p_public_token TEXT
) RETURNS public.quotes
LANGUAGE plpgsql
AS $$
DECLARE
    v_quote public.quotes;
    v_item_count INT;
BEGIN
    SELECT * INTO v_quote FROM public.quotes WHERE id = p_quote_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'quote_not_found';
    END IF;
    IF v_quote.status = 'approved' THEN
        RETURN v_quote;
    END IF;
    IF v_quote.status NOT IN ('draft', 'confirmed') THEN
        RAISE EXCEPTION 'quote_not_in_draft_status';
    END IF;

    SELECT count(*) INTO v_item_count FROM public.quote_items WHERE quote_id = p_quote_id;
    IF v_item_count = 0 OR v_quote.total_amount IS NULL OR v_quote.total_amount <= 0 THEN
        RAISE EXCEPTION 'quote_missing_required_fields';
    END IF;

    UPDATE public.quotes SET
        status = 'approved',
        approved_by = p_actor_id,
        approved_at = NOW(),
        public_token = COALESCE(public_token, p_public_token),
        public_enabled = true,
        processing_stage = 'review'
    WHERE id = p_quote_id
    RETURNING * INTO v_quote;

    INSERT INTO public.quote_activity_log (quote_id, actor_id, action, changes)
    VALUES (p_quote_id, p_actor_id, 'approved', NULL);

    RETURN v_quote;
END;
$$;
