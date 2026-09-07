-- RPC transactional cho "danh dau gui email THANH CONG" - gop 3 buoc dang
-- roi rac trong Python (update quote_delivery_log.status='sent' -> update
-- quotes.sent_at/sent_by/completed_at -> insert quote_activity_log) thanh 1
-- transaction. SMTP la external side effect KHONG THE rollback (email da
-- roi khoi backend ra ngoai internet that su), nhung PHAN GHI NHAN vao DB
-- sau khi SMTP thanh cong PHAI atomic - tranh dung trang thai "da gui
-- email that nhung DB chua kip ghi sent_at" hoac "sent_at da ghi nhung
-- delivery log van con 'failed'/'sending'".
--
-- Idempotent: neu delivery_log da o status='sent' tu truoc (retry/double-
-- processing voi cung idempotency_key - da duoc chan o tang Python truoc
-- khi goi RPC nay, nhung kiem tra lai o day cho chac chan), KHONG ghi de
-- lai (completed_at/sent_at giu nguyen gia tri LAN DAU, khong nhay theo lan
-- goi sau).
--
-- CHUA apply migration nay len DB that cho toi khi duoc xac nhan rieng.

CREATE OR REPLACE FUNCTION public.quote_mark_email_sent(
    p_delivery_log_id UUID,
    p_quote_id UUID,
    p_actor_id UUID,
    p_provider_message_id TEXT,
    p_sent_at TIMESTAMPTZ,
    p_pdf_error TEXT DEFAULT NULL
) RETURNS public.quotes
LANGUAGE plpgsql
AS $$
DECLARE
    v_quote public.quotes;
    v_log public.quote_delivery_log;
BEGIN
    SELECT * INTO v_log FROM public.quote_delivery_log WHERE id = p_delivery_log_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'quote_delivery_log_not_found';
    END IF;

    IF v_log.status = 'sent' THEN
        SELECT * INTO v_quote FROM public.quotes WHERE id = p_quote_id;
        RETURN v_quote;
    END IF;

    UPDATE public.quote_delivery_log SET
        status = 'sent',
        provider_message_id = p_provider_message_id,
        error_message = p_pdf_error
    WHERE id = p_delivery_log_id;

    UPDATE public.quotes SET
        sent_at = p_sent_at,
        sent_by = p_actor_id,
        completed_at = p_sent_at
    WHERE id = p_quote_id
    RETURNING * INTO v_quote;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'quote_not_found';
    END IF;

    INSERT INTO public.quote_activity_log (quote_id, actor_id, action, changes)
    VALUES (p_quote_id, p_actor_id, 'sent_email', jsonb_build_object('delivery_log_id', p_delivery_log_id));

    RETURN v_quote;
END;
$$;
