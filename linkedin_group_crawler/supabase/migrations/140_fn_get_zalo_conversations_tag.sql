-- Migration 140: fn_get_zalo_conversations() la duong dan CHINH (khong phai
-- fallback) cua GET /conversations (xem list_conversations_for_caller trong
-- conversations.py — chi fallback sang ham Python list_conversations() khi
-- RPC nay lỗi) — nhung thieu cot "tag" (migration 139) trong RETURNS TABLE,
-- nen tag da luu van khong hien duoc len UI du da PATCH /tag thanh cong.
-- Postgres khong cho CREATE OR REPLACE doi RETURNS TABLE (them cot) -> phai
-- DROP truoc, giong da lam o migration 129. Chi copy nguyen than ham 129,
-- chi them 1 cot.
DROP FUNCTION IF EXISTS public.fn_get_zalo_conversations(text, text, integer);

CREATE OR REPLACE FUNCTION public.fn_get_zalo_conversations(
    p_account_id text,
    p_caller_email text,
    p_limit integer DEFAULT 500
)
RETURNS TABLE(
    conversation_id text,
    conversation_name text,
    unread_count integer,
    last_message_at timestamp with time zone,
    last_message_content text,
    last_sender_id text,
    last_sender_name text,
    last_message_type text,
    avatar_url text,
    is_pinned boolean,
    updated_at timestamp with time zone,
    is_friend boolean,
    thread_type text,
    tag text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
    v_caller_id UUID;
    v_caller_role TEXT;
    v_owner_id TEXT;
    v_is_owner BOOLEAN := FALSE;
    v_is_shared_with_all BOOLEAN := FALSE;
BEGIN
    IF p_caller_email IS NOT NULL AND p_caller_email <> '' THEN
        SELECT id, role INTO v_caller_id, v_caller_role
        FROM public.app_users
        WHERE email = LOWER(TRIM(p_caller_email)) LIMIT 1;
    END IF;

    SELECT owner_id, COALESCE(is_shared_with_all, FALSE)
      INTO v_owner_id, v_is_shared_with_all
    FROM public.zalo_accounts
    WHERE account_id = p_account_id LIMIT 1;

    IF v_owner_id IS NOT NULL AND v_caller_id IS NOT NULL AND v_caller_id::TEXT = v_owner_id THEN
        v_is_owner := TRUE;
    END IF;

    RETURN QUERY
    SELECT
        zg.group_id AS conversation_id,
        zg.group_name AS conversation_name,
        zg.unread_count,
        zg.last_message_at,
        zg.last_message_content,
        zg.last_sender_id,
        zg.last_sender_name,
        zg.last_message_type,
        zg.avatar_url,
        zg.is_pinned,
        zg.updated_at,
        COALESCE(zg.is_friend, FALSE) AS is_friend,
        COALESCE(zg.thread_type, CASE WHEN zg.is_friend THEN 'user' ELSE 'group' END) AS thread_type,
        zg.tag
    FROM public.zalo_groups zg
    WHERE zg.user_id = p_account_id
      AND (
          v_is_owner
          OR v_is_shared_with_all
          OR p_caller_email IS NULL
          OR p_caller_email = ''
          OR (v_caller_role IN ('admin', 'superadmin') AND zg.group_id IN (
              SELECT zcp.conversation_id FROM public.zalo_conversation_permissions zcp
              WHERE zcp.account_id = p_account_id AND zcp.is_active = TRUE
          ))
          OR (v_caller_role = 'leader' AND zg.group_id IN (
              SELECT zcp.conversation_id FROM public.zalo_conversation_permissions zcp
              WHERE zcp.account_id = p_account_id AND zcp.is_active = TRUE
                AND (zcp.id_leader = v_caller_id OR zcp.id_leader IS NULL)
          ))
      )
    ORDER BY zg.is_pinned DESC, zg.last_message_at DESC NULLS LAST, zg.updated_at DESC NULLS LAST
    LIMIT p_limit;
END;
$function$;
