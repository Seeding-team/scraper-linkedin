-- Migration 138: Thả cảm xúc (reaction) cho tin nhắn Zalo, giống Zalo thật —
-- mỗi người chỉ có 1 reaction/tin (đổi thì thay icon cũ), lưu dạng map
-- {"<uid_người_react>": "<icon>"} trong 1 cột JSONB duy nhất trên zalo_messages.
--
-- KHÔNG viết RPC merge riêng cho ghi (fn_set_zalo_message_reaction) — backend
-- Python tự GET cột hiện tại, merge trong Python, rồi PATCH lại nguyên cột
-- (đơn giản hơn, không cần thêm hàm SQL mới; race condition khi 2 reaction tới
-- cùng lúc trên cùng 1 tin là chấp nhận được — tự "tự chữa" ở lần react tiếp
-- theo, không phải dữ liệu quan trọng cần ACID chặt).
--
-- fn_get_zalo_conversation_messages (từ migration 128) PHẢI thêm field này vào
-- SELECT thì API /messages mới trả về được — CREATE OR REPLACE lại đúng như cũ,
-- chỉ thêm 1 dòng 'reactions', pm.reactions.

ALTER TABLE public.zalo_messages
    ADD COLUMN IF NOT EXISTS reactions JSONB NOT NULL DEFAULT '{}'::jsonb;

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
                'reactions', COALESCE(pm.reactions, '{}'::jsonb),
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
