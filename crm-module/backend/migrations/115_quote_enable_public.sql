-- "Mở lại link báo giá" - yeu cau rieng ("khóa link rồi cái chỗ ... k thấy
-- nút mở link nha bro"): tu truoc gio chi co "Khoá link" (quote_revoke_public,
-- migration 089), KHONG co chieu nguoc lai - sau khi khoa, nguoi dung KHONG
-- co cach nao tu mo lai link cu (public_token con nguyen, chi public_enabled
-- bi tat) ma phai... khong co cach nao ca (bug/thieu tinh nang thuc su).
-- Mirror dung pattern cua quote_revoke_public: chi lat lai co `public_enabled`,
-- GIU NGUYEN public_token (khong sinh token moi - link cu hoat dong lai y
-- het truoc khi khoa, khong can gui lai link moi cho khach).
CREATE OR REPLACE FUNCTION public.quote_enable_public(
    p_quote_id UUID, p_actor_id UUID
) RETURNS public.quotes
LANGUAGE plpgsql
AS $$
DECLARE
    v_quote public.quotes;
BEGIN
    SELECT * INTO v_quote FROM public.quotes WHERE id = p_quote_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'quote_not_found';
    END IF;
    IF v_quote.public_token IS NULL THEN
        -- Chua tung phat hanh (chua co token nao) - phai "Phát hành" that
        -- (quote_publish) truoc, khong the "mo lai" 1 thu chua tung ton tai.
        RAISE EXCEPTION 'quote_not_published';
    END IF;
    IF v_quote.public_enabled THEN
        RETURN v_quote; -- idempotent
    END IF;

    UPDATE public.quotes SET public_enabled = true, updated_by = p_actor_id
    WHERE id = p_quote_id
    RETURNING * INTO v_quote;

    INSERT INTO public.quote_activity_log (quote_id, actor_id, action, changes)
    VALUES (p_quote_id, p_actor_id, 'public_enabled', NULL);

    RETURN v_quote;
END;
$$;
