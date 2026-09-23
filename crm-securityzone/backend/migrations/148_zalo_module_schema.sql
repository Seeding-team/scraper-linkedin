-- zalo-module — schema RIÊNG, độc lập hoàn toàn với bảng zalo_* của app
-- seeding gốc (cùng chạy trên 1 server Postgres self-host cho tiện, nhưng
-- KHÔNG chia sẻ dữ liệu/tài khoản Zalo/session nào với app gốc — xem
-- README.md mục "Vì sao tách bảng riêng").
--
-- Viết SẠCH ngay từ đầu (không lặp lại lịch sử migration 003→068 của app
-- gốc), áp dụng luôn các fix bug đã biết (xem
-- docs/ZALO_CHAT_FEATURE_EXTRACTION_GUIDE.md mục 4 + 7):
--   * is_shared_with_all mặc định TRUE ngay từ đầu (không cần 066→068).
--   * fn_zalo_module_get_conversations tôn trọng is_shared_with_all từ bản
--     đầu tiên (không cần vá lại như migration 067).
--   * zalo_module_message_assets.message_id dùng ON DELETE CASCADE (bản gốc
--     dùng SET NULL trên cột NOT NULL → crash khi xoá message có asset).
--   * 2 unique index bắt buộc (groups, messages) tạo NGAY, KHÔNG lồng trong
--     body RPC (bug "trứng gà" ở migration 013/015 gốc — index không bao giờ
--     được tạo trên DB tinh vì ON CONFLICT ở câu INSERT phía trên chạy trước).
--
-- KHÔNG tạo bảng `app_users`, `teams`, `member_of_teams` — 3 bảng đó đã tồn
-- tại sẵn trên server (dùng chung với app seeding để SSO + role leader/admin
-- hoạt động đúng ngay, xem services/supabase_user_service.py +
-- zalo/services/supabase_service.py::get_team_member_ids).
--
-- Cách áp: dán nguyên file này vào Supabase Studio SQL Editor của server
-- self-host, hoặc `psql -d postgres -f 001_zalo_module_schema.sql` nếu có
-- kênh SSH/psql trực tiếp. An toàn chạy lại nhiều lần (mọi lệnh đều
-- IF NOT EXISTS / CREATE OR REPLACE).

-- ============================================================================
-- 1. Bảng
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.zalo_module_accounts (
    account_id          text PRIMARY KEY,
    owner_id            text NOT NULL DEFAULT 'default',
    id_member           uuid REFERENCES public.app_users (id) ON DELETE SET NULL,
    label               text,
    phone               text,
    zalo_id             text,
    avatar_url          text,
    status              text NOT NULL DEFAULT 'unknown',
    is_active           boolean NOT NULL DEFAULT true,
    is_shared_with_all  boolean NOT NULL DEFAULT true,
    last_seen_at        timestamptz,
    last_login_at       timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.zalo_module_accounts.is_shared_with_all IS
    'true = mọi nhân viên đều xem/gửi được tài khoản Zalo này (bỏ qua kiểm tra owner/leader/share theo hội thoại). Default true (khác app gốc, nơi lịch sử default đổi false→true qua 2 migration riêng).';

CREATE TABLE IF NOT EXISTS public.zalo_module_users (
    user_id             text PRIMARY KEY,
    id_member           uuid REFERENCES public.app_users (id) ON DELETE SET NULL,
    zalo_status         text,
    assigned_worker_id  text,
    display_name        text,
    cookie              text,
    last_seen_at        timestamptz,
    last_login_at       timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

-- Giữ tương thích với hard_delete_zalo_account_data (dọn theo user_id) — không
-- bắt buộc cho luồng chat hiện đại (extension không tạo session kiểu QR),
-- nhưng để trống bảng vẫn an toàn hơn là thiếu bảng (tránh lỗi "relation does
-- not exist" nếu code nào đó lỡ query tới).
CREATE TABLE IF NOT EXISTS public.zalo_module_sessions (
    user_id             text PRIMARY KEY,
    status              text,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.zalo_module_groups (
    user_id               text NOT NULL,
    group_id              text NOT NULL,
    group_name            text,
    avatar_url            text,
    -- unread_count/is_friend KHÔNG NOT NULL (khác is_pinned) — cố ý: RPC
    -- fn_zalo_module_bulk_save_messages ghi thẳng giá trị NULL cho 2 cột này
    -- khi payload không có key tương ứng (chỉ COALESCE ở nhánh UPDATE, không
    -- COALESCE ở nhánh INSERT ban đầu, y hệt hành vi migration 015 gốc) —
    -- NOT NULL sẽ làm INSERT đầu tiên của 1 group mới lỗi (đã test thấy lỗi
    -- thật khi thêm NOT NULL, xem lịch sử tạo file này).
    unread_count          integer DEFAULT 0,
    is_pinned             boolean NOT NULL DEFAULT false,
    is_friend             boolean DEFAULT false,
    last_message_at       timestamptz,
    last_message_content  text,
    last_sender_id        text,
    last_sender_name      text,
    last_message_type     text,
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, group_id)
);

CREATE TABLE IF NOT EXISTS public.zalo_module_messages (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             text NOT NULL,
    job_id              text,
    group_id            text,
    group_name          text,
    source_message_id   text,
    sender_id           text,
    sender_name         text,
    timestamp_text      text,
    time_text           text,
    type                text NOT NULL DEFAULT 'text',
    content             text,
    is_sent             boolean NOT NULL DEFAULT false,
    is_deleted          boolean NOT NULL DEFAULT false,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.zalo_module_message_assets (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id   uuid NOT NULL REFERENCES public.zalo_module_messages (id) ON DELETE CASCADE,
    source_url   text,
    storage_path text,
    storage_url  text,
    status       text NOT NULL DEFAULT 'pending',
    error        text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Dùng cho: (a) check_caller_conversation_access() trong conversations.py —
-- RBAC gate thật của luồng chat; (b) "Tin nhắn KPI" (member tick chia sẻ 1
-- conversation để leader verify) qua api/routes/inbox_share.py +
-- services/supabase_inbox_share_service.py — ĐÂY MỚI LÀ cơ chế ghi dữ liệu
-- thật vào bảng này trong bản hiện đại (endpoint "share" đơn giản kiểu cũ
-- trong events.py đã bỏ vì chỉ trang /zalo-chat legacy dùng, không copy
-- sang). unique constraint có id_leader (giống migration 005 gốc) để 1
-- member thuộc nhiều leader vẫn tạo được nhiều row (mỗi leader 1 row).
CREATE TABLE IF NOT EXISTS public.zalo_module_conversation_permissions (
    id              bigserial PRIMARY KEY,
    account_id      text NOT NULL,
    conversation_id text NOT NULL,
    shared_role     text NOT NULL DEFAULT 'admin',
    id_member       uuid REFERENCES public.app_users (id) ON DELETE SET NULL,
    id_leader       uuid REFERENCES public.app_users (id) ON DELETE SET NULL,
    note            text,
    is_verify       boolean NOT NULL DEFAULT false,
    is_lead         boolean NOT NULL DEFAULT false,
    verified_at     timestamptz,
    verified_by     uuid REFERENCES public.app_users (id) ON DELETE SET NULL,
    is_active       boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT zalo_module_conv_perm_unique UNIQUE (account_id, conversation_id, shared_role, id_leader),
    CONSTRAINT fk_zalo_conv_perm_account FOREIGN KEY (account_id)
        REFERENCES public.zalo_module_accounts (account_id)
        ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_zalo_module_conv_perm_member
    ON public.zalo_module_conversation_permissions (id_member, is_active);
CREATE INDEX IF NOT EXISTS idx_zalo_module_conv_perm_leader_role_active
    ON public.zalo_module_conversation_permissions (id_leader, shared_role, is_active)
    WHERE id_leader IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_zalo_module_conv_perm_account
    ON public.zalo_module_conversation_permissions (account_id, is_active);
CREATE INDEX IF NOT EXISTS idx_zalo_module_conv_perm_conversation
    ON public.zalo_module_conversation_permissions (conversation_id, is_active);

-- ============================================================================
-- 2. Index bắt buộc cho ON CONFLICT / upsert (tạo TRƯỚC khi định nghĩa RPC —
--    tránh bug "trứng gà" đã gặp thật trên app gốc, xem mục 4.4 guide)
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_zalo_module_groups_uniq
    ON public.zalo_module_groups (user_id, group_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_zalo_module_messages_uniq
    ON public.zalo_module_messages (user_id, group_id, source_message_id);

-- ============================================================================
-- 3. RPC: fn_zalo_module_get_conversations
--    (tương đương fn_get_zalo_conversations sau khi vá bởi migration 067 gốc
--    — tôn trọng is_shared_with_all ngay từ bản đầu tiên)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_zalo_module_get_conversations(
    p_account_id text,
    p_caller_email text,
    p_limit integer DEFAULT 500
)
RETURNS TABLE(
    conversation_id text,
    conversation_name text,
    unread_count integer,
    last_message_at timestamptz,
    last_message_content text,
    last_sender_id text,
    last_sender_name text,
    last_message_type text,
    avatar_url text,
    is_pinned boolean,
    updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
    FROM public.zalo_module_accounts
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
        zg.updated_at
    FROM public.zalo_module_groups zg
    WHERE zg.user_id = p_account_id
      AND (
          v_is_owner
          OR v_is_shared_with_all
          OR p_caller_email IS NULL
          OR p_caller_email = ''
          OR (v_caller_role IN ('admin', 'superadmin') AND zg.group_id IN (
              SELECT zcp.conversation_id FROM public.zalo_module_conversation_permissions zcp
              WHERE zcp.account_id = p_account_id AND zcp.is_active = TRUE
          ))
          OR (v_caller_role = 'leader' AND zg.group_id IN (
              SELECT zcp.conversation_id FROM public.zalo_module_conversation_permissions zcp
              WHERE zcp.account_id = p_account_id AND zcp.is_active = TRUE
                AND (zcp.id_leader = v_caller_id OR zcp.id_leader IS NULL)
          ))
      )
    ORDER BY zg.is_pinned DESC, zg.last_message_at DESC NULLS LAST, zg.updated_at DESC NULLS LAST
    LIMIT p_limit;
END;
$function$;

-- ============================================================================
-- 4. RPC: fn_zalo_module_get_conversation_messages
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_zalo_module_get_conversation_messages(
    p_user_id TEXT,
    p_conversation_id TEXT,
    p_limit INT DEFAULT 100,
    p_offset INT DEFAULT 0
) RETURNS TABLE (
    messages_json JSONB,
    total_count INT
)
LANGUAGE plpgsql
AS $function$
DECLARE
    v_resolved_group_id TEXT := NULL;
    v_resolved_group_name TEXT := NULL;
    v_total INT := 0;
BEGIN
    SELECT group_id, group_name INTO v_resolved_group_id, v_resolved_group_name
    FROM public.zalo_module_groups
    WHERE user_id = p_user_id
      AND (group_id = p_conversation_id OR group_name = p_conversation_id)
    LIMIT 1;

    IF v_resolved_group_id IS NULL THEN
        SELECT group_id, group_name INTO v_resolved_group_id, v_resolved_group_name
        FROM public.zalo_module_messages
        WHERE user_id = p_user_id
          AND (group_id = p_conversation_id OR group_name = p_conversation_id)
        LIMIT 1;
    END IF;

    IF v_resolved_group_id IS NULL THEN
        v_resolved_group_id := p_conversation_id;
    END IF;

    SELECT COUNT(*)::INT INTO v_total
    FROM public.zalo_module_messages zm
    WHERE zm.user_id = p_user_id
      AND zm.group_id = v_resolved_group_id
      AND zm.is_deleted = FALSE;

    RETURN QUERY
    WITH paginated_messages AS (
        SELECT zm.*
        FROM public.zalo_module_messages zm
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
                     FROM public.zalo_module_message_assets zma
                     WHERE zma.message_id = pm.id),
                    '[]'::jsonb
                )
            )
        ), '[]'::jsonb) AS messages_json,
        v_total AS total_count
    FROM paginated_messages pm;
END;
$function$;

-- ============================================================================
-- 5. RPC: fn_zalo_module_bulk_save_messages
--    (KHÔNG tạo index trong body — đã tạo ở mục 2, tránh bug "trứng gà")
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_zalo_module_bulk_save_messages(
    p_user_id TEXT,
    p_groups JSONB,
    p_messages JSONB
) RETURNS INT
LANGUAGE plpgsql
AS $function$
DECLARE
    v_saved_count INT := 0;
BEGIN
    IF p_groups IS NOT NULL AND jsonb_array_length(p_groups) > 0 THEN
        INSERT INTO public.zalo_module_groups (
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
            avatar_url = COALESCE(EXCLUDED.avatar_url, zalo_module_groups.avatar_url),
            unread_count = COALESCE(EXCLUDED.unread_count, zalo_module_groups.unread_count),
            last_message_at = COALESCE(EXCLUDED.last_message_at, zalo_module_groups.last_message_at),
            last_message_content = COALESCE(EXCLUDED.last_message_content, zalo_module_groups.last_message_content),
            last_sender_id = COALESCE(EXCLUDED.last_sender_id, zalo_module_groups.last_sender_id),
            last_sender_name = COALESCE(EXCLUDED.last_sender_name, zalo_module_groups.last_sender_name),
            last_message_type = COALESCE(EXCLUDED.last_message_type, zalo_module_groups.last_message_type),
            is_pinned = EXCLUDED.is_pinned,
            is_friend = COALESCE(EXCLUDED.is_friend, zalo_module_groups.is_friend),
            updated_at = NOW();
    END IF;

    IF p_messages IS NOT NULL AND jsonb_array_length(p_messages) > 0 THEN
        INSERT INTO public.zalo_module_messages (
            user_id, group_id, group_name, source_message_id,
            sender_id, sender_name, created_at, timestamp_text,
            time_text, type, content, is_sent, is_deleted
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
            COALESCE((m->>'is_deleted')::BOOLEAN, FALSE)
        FROM jsonb_array_elements(p_messages) AS m
        ON CONFLICT (user_id, group_id, source_message_id)
        DO UPDATE SET
            sender_name = EXCLUDED.sender_name,
            content = EXCLUDED.content,
            type = EXCLUDED.type,
            is_sent = EXCLUDED.is_sent,
            is_deleted = EXCLUDED.is_deleted;

        GET DIAGNOSTICS v_saved_count = ROW_COUNT;
    END IF;

    RETURN v_saved_count;
END;
$function$;

-- ============================================================================
-- 6. RPC: fn_zalo_module_hard_delete_account
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_zalo_module_hard_delete_account(
    p_account_id TEXT
) RETURNS JSONB
LANGUAGE plpgsql
AS $function$
DECLARE
    v_sessions_deleted INT := 0;
    v_users_deleted INT := 0;
    v_accounts_deleted INT := 0;
    v_groups_deleted INT := 0;
    v_messages_deleted INT := 0;
    v_permissions_deleted INT := 0;
BEGIN
    DELETE FROM public.zalo_module_sessions WHERE user_id = p_account_id;
    GET DIAGNOSTICS v_sessions_deleted = ROW_COUNT;

    DELETE FROM public.zalo_module_users WHERE user_id = p_account_id;
    GET DIAGNOSTICS v_users_deleted = ROW_COUNT;

    DELETE FROM public.zalo_module_accounts WHERE account_id = p_account_id;
    GET DIAGNOSTICS v_accounts_deleted = ROW_COUNT;

    DELETE FROM public.zalo_module_groups WHERE user_id = p_account_id;
    GET DIAGNOSTICS v_groups_deleted = ROW_COUNT;

    DELETE FROM public.zalo_module_messages WHERE user_id = p_account_id;
    GET DIAGNOSTICS v_messages_deleted = ROW_COUNT;

    DELETE FROM public.zalo_module_conversation_permissions WHERE account_id = p_account_id;
    GET DIAGNOSTICS v_permissions_deleted = ROW_COUNT;

    RETURN jsonb_build_object(
        'zalo_module_sessions', v_sessions_deleted,
        'zalo_module_users', v_users_deleted,
        'zalo_module_accounts', v_accounts_deleted,
        'zalo_module_groups', v_groups_deleted,
        'zalo_module_messages', v_messages_deleted,
        'zalo_module_conversation_permissions', v_permissions_deleted
    );
END;
$function$;

-- ============================================================================
-- 7. RPC cho "Tin nhắn KPI" (services/supabase_inbox_share_service.py) —
--    KHÔNG đổi tên (không phải hàm zalo_*, tham chiếu member_of_teams/teams
--    của app gốc, đã tồn tại sẵn trên server dùng chung). Cả 2 hàm đều có
--    fallback ở phía Python nếu RPC lỗi/chưa tồn tại — tạo ở đây chỉ để tối
--    ưu (1 round-trip thay vì 2-3).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_list_leader_ids_for_member(
    p_member_id uuid
)
RETURNS TABLE(id_leader uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
    SELECT DISTINCT t.id_leader
      FROM public.member_of_teams mot
      JOIN public.teams t ON t.id = mot.id_teams
     WHERE mot.id_member = p_member_id
       AND t.id_leader IS NOT NULL;
$function$;

CREATE OR REPLACE FUNCTION public.fn_deactivate_orphan_inbox_shares(
    p_account_id text,
    p_conversation_id text,
    p_member_id uuid,
    p_active_leader_ids uuid[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
    v_count int;
BEGIN
    UPDATE public.zalo_module_conversation_permissions
       SET is_active = false,
           updated_at = now()
     WHERE account_id      = p_account_id
       AND conversation_id = p_conversation_id
       AND shared_role     = 'leader'
       AND id_member       = p_member_id
       AND is_active       = true
       AND id_leader IS NOT NULL
       AND (id_leader <> ALL (p_active_leader_ids));

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$function$;
