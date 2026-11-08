-- Migration 145: Them cot reply_to_id + day 2 RPC (fn_bulk_save_zalo_messages,
-- fn_get_zalo_conversation_messages) ghi/doc cot nay - phuc vu tinh nang "tra loi/
-- trich dan 1 tin nhan cu the" (ap dung cho ca tin cua doi phuong lan tin cua minh).
--
-- Phat hien khi build tinh nang reply: cot Message.reply_to_id trong Pydantic schema
-- (app/modules/all_platform/zalo/schemas/message.py) VA logic parse tin nhan Zalo that
-- (data.quote?.msgId trong zca_persistent_listener.py/zca_api_server.js) DA CO SAN tu
-- truoc, nhung chua bao gio duoc luu xuong DB that (thieu ca cot, ca 2 RPC nay) - nen
-- FE khong the render lai preview tin duoc trich dan du data goc tu Zalo da nhan ve.
-- Copy nguyen ham tu migration 128, chi them reply_to_id, KHONG doi logic gi khac.

ALTER TABLE public.zalo_messages
    ADD COLUMN IF NOT EXISTS reply_to_id TEXT;

CREATE OR REPLACE FUNCTION public.fn_bulk_save_zalo_messages(
    p_user_id TEXT,
    p_groups JSONB,   -- JSON array of groups
    p_messages JSONB  -- JSON array of messages
) RETURNS INT AS $$
DECLARE
    v_saved_count INT := 0;
BEGIN
    -- 1. Bulk Upsert zalo_groups (khong doi so voi migration 015/128)
    IF p_groups IS NOT NULL AND jsonb_array_length(p_groups) > 0 THEN
        INSERT INTO public.zalo_groups (
            user_id, group_id, group_name, avatar_url, unread_count,
            last_message_at, last_message_content, last_sender_id,
            last_sender_name, last_message_type, is_pinned, is_friend, updated_at
        )
        SELECT
            p_user_id,
            (g->>'group_id')::TEXT,
            (g->>'group_name')::TEXT,
            (g->>'avatar_url')::TEXT,
            (g->>'unread_count')::INT,
            (g->>'last_message_at')::TIMESTAMPTZ,
            (g->>'last_message_content')::TEXT,
            (g->>'last_sender_id')::TEXT,
            (g->>'last_sender_name')::TEXT,
            (g->>'last_message_type')::TEXT,
            COALESCE((g->>'is_pinned')::BOOLEAN, FALSE),
            (g->>'is_friend')::BOOLEAN,
            NOW()
        FROM jsonb_array_elements(p_groups) AS g
        ON CONFLICT (user_id, group_id)
        DO UPDATE SET
            group_name = EXCLUDED.group_name,
            avatar_url = COALESCE(EXCLUDED.avatar_url, zalo_groups.avatar_url),
            unread_count = COALESCE(EXCLUDED.unread_count, zalo_groups.unread_count),
            last_message_at = COALESCE(EXCLUDED.last_message_at, zalo_groups.last_message_at),
            last_message_content = COALESCE(EXCLUDED.last_message_content, zalo_groups.last_message_content),
            last_sender_id = COALESCE(EXCLUDED.last_sender_id, zalo_groups.last_sender_id),
            last_sender_name = COALESCE(EXCLUDED.last_sender_name, zalo_groups.last_sender_name),
            last_message_type = COALESCE(EXCLUDED.last_message_type, zalo_groups.last_message_type),
            is_pinned = EXCLUDED.is_pinned,
            is_friend = COALESCE(EXCLUDED.is_friend, zalo_groups.is_friend),
            updated_at = NOW();
    END IF;

    -- 2. Bulk Upsert zalo_messages — THEM reply_to_id (canh ts/raw_content/mentions/
    -- cli_msg_id/msg_kind da co tu migration 128)
    IF p_messages IS NOT NULL AND jsonb_array_length(p_messages) > 0 THEN
        INSERT INTO public.zalo_messages (
            user_id, group_id, group_name, source_message_id,
            sender_id, sender_name, created_at, timestamp_text,
            time_text, type, content, is_sent, is_deleted,
            ts, raw_content, mentions, cli_msg_id, msg_kind, reply_to_id
        )
        SELECT
            p_user_id,
            (m->>'group_id')::TEXT,
            (m->>'group_name')::TEXT,
            COALESCE((m->>'message_id')::TEXT, (m->>'source_message_id')::TEXT),
            (m->>'sender_id')::TEXT,
            (m->>'sender_name')::TEXT,
            COALESCE((m->>'created_at')::TIMESTAMPTZ, NOW()),
            (m->>'timestamp_text')::TEXT,
            (m->>'time_text')::TEXT,
            COALESCE((m->>'type')::TEXT, 'text'),
            (m->>'content')::TEXT,
            COALESCE((m->>'is_sent')::BOOLEAN, FALSE),
            COALESCE((m->>'is_deleted')::BOOLEAN, FALSE),
            (m->>'ts')::BIGINT,
            (m->'raw_content'),
            COALESCE(m->'mentions', '[]'::jsonb),
            (m->>'cli_msg_id')::TEXT,
            (m->>'msg_kind')::TEXT,
            (m->>'reply_to_id')::TEXT
        FROM jsonb_array_elements(p_messages) AS m
        ON CONFLICT (user_id, group_id, source_message_id)
        DO UPDATE SET
            sender_name = EXCLUDED.sender_name,
            content = EXCLUDED.content,
            type = EXCLUDED.type,
            is_sent = EXCLUDED.is_sent,
            is_deleted = EXCLUDED.is_deleted,
            ts = COALESCE(EXCLUDED.ts, zalo_messages.ts),
            raw_content = COALESCE(EXCLUDED.raw_content, zalo_messages.raw_content),
            mentions = COALESCE(EXCLUDED.mentions, zalo_messages.mentions),
            cli_msg_id = COALESCE(EXCLUDED.cli_msg_id, zalo_messages.cli_msg_id),
            msg_kind = COALESCE(EXCLUDED.msg_kind, zalo_messages.msg_kind),
            reply_to_id = COALESCE(EXCLUDED.reply_to_id, zalo_messages.reply_to_id);

        GET DIAGNOSTICS v_saved_count = ROW_COUNT;
    END IF;

    RETURN v_saved_count;
END;
$$ LANGUAGE plpgsql;


CREATE OR REPLACE FUNCTION public.fn_get_zalo_conversation_messages(
    p_user_id TEXT,
    p_conversation_id TEXT,
    p_limit INT DEFAULT 100,
    p_offset INT DEFAULT 0
) RETURNS TABLE (
    messages_json JSONB,
    total_count INT
) AS $$
DECLARE
    v_resolved_group_id TEXT := NULL;
    v_resolved_group_name TEXT := NULL;
    v_total INT := 0;
BEGIN
    SELECT group_id, group_name INTO v_resolved_group_id, v_resolved_group_name
    FROM public.zalo_groups
    WHERE user_id = p_user_id
      AND (group_id = p_conversation_id OR group_name = p_conversation_id)
    LIMIT 1;

    IF v_resolved_group_id IS NULL THEN
        SELECT group_id, group_name INTO v_resolved_group_id, v_resolved_group_name
        FROM public.zalo_messages
        WHERE user_id = p_user_id
          AND (group_id = p_conversation_id OR group_name = p_conversation_id)
        LIMIT 1;
    END IF;

    IF v_resolved_group_id IS NULL THEN
        v_resolved_group_id := p_conversation_id;
    END IF;

    SELECT COUNT(*)::INT INTO v_total
    FROM public.zalo_messages zm
    WHERE zm.user_id = p_user_id
      AND zm.group_id = v_resolved_group_id
      AND zm.is_deleted = FALSE;

    RETURN QUERY
    WITH paginated_messages AS (
        SELECT zm.*
        FROM public.zalo_messages zm
        WHERE zm.user_id = p_user_id
          AND zm.group_id = v_resolved_group_id
          AND zm.is_deleted = FALSE
        ORDER BY zm.timestamp_text DESC, zm.created_at DESC
        LIMIT p_limit OFFSET p_offset
    )
    SELECT
        COALESCE(jsonb_agg(
            jsonb_build_object(
                'id', pm.id,
                'user_id', pm.user_id,
                'group_id', pm.group_id,
                'group_name', pm.group_name,
                'source_message_id', pm.source_message_id,
                'sender_id', pm.sender_id,
                'sender_name', pm.sender_name,
                'timestamp_text', pm.timestamp_text,
                'time_text', pm.time_text,
                'type', pm.type,
                'content', pm.content,
                'is_sent', pm.is_sent,
                'created_at', pm.created_at,
                'ts', pm.ts,
                'raw_content', pm.raw_content,
                'mentions', pm.mentions,
                'cli_msg_id', pm.cli_msg_id,
                'msg_kind', pm.msg_kind,
                'reply_to_id', pm.reply_to_id,
                'assets', COALESCE(
                    (SELECT jsonb_agg(
                        jsonb_build_object(
                            'id', zma.id,
                            'message_id', zma.message_id,
                            'source_url', zma.source_url,
                            'storage_path', zma.storage_path,
                            'storage_url', zma.storage_url,
                            'status', zma.status,
                            'error', zma.error,
                            'updated_at', zma.updated_at
                        )
                     )
                     FROM public.zalo_message_assets zma
                     WHERE zma.message_id = pm.id),
                    '[]'::jsonb
                )
            )
        ), '[]'::jsonb) AS messages_json,
        v_total AS total_count
    FROM paginated_messages pm;
END;
$$ LANGUAGE plpgsql;
