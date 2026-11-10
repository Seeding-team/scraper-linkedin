-- ==============================================================================
-- 222_kpi_call_replacement.sql
-- Thay the KPI Post bang KPI Call, chuan hoa 4 tru cot (CMT, INBOX, CALL, LEAD),
-- tao View tong hop cuoc goi va toi uu hoa toc do query cho Admin & Leader Dashboard.
-- ==============================================================================

-- 1. Bo sung cot kpi_call vao bang kpi_tracker
ALTER TABLE public.kpi_tracker 
ADD COLUMN IF NOT EXISTS kpi_call INTEGER NOT NULL DEFAULT 0;

-- Backfill kpi_call tu kpi_post neu co du lieu cu
UPDATE public.kpi_tracker 
SET kpi_call = kpi_post 
WHERE kpi_call = 0 AND kpi_post > 0;

-- 2. Tao View tong hop so luong cuoc goi thuc te theo member x ngay VN
CREATE OR REPLACE VIEW public.v_member_daily_calls AS
SELECT 
    updated_by AS id_member,
    (last_call_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS day_vn,
    COUNT(*)::int AS call_count,
    COALESCE(SUM(GREATEST(attempts, 1)), COUNT(*))::int AS call_attempts
FROM public.post_call_results
WHERE last_call_at IS NOT NULL AND updated_by IS NOT NULL
GROUP BY updated_by, (last_call_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;

COMMENT ON VIEW public.v_member_daily_calls IS
    'Aggregated customer calls per member per VN-day from post_call_results';

-- 3. Composite Indexes toi uu hoa toc do truy van (chong full table scan)
CREATE INDEX IF NOT EXISTS idx_post_call_results_user_time 
    ON public.post_call_results (updated_by, last_call_at DESC) 
    WHERE updated_by IS NOT NULL AND last_call_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_post_call_results_day_vn 
    ON public.post_call_results (updated_by, ((last_call_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)) 
    WHERE updated_by IS NOT NULL AND last_call_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_kpi_tracker_member_period 
    ON public.kpi_tracker (id_member, start_date, end_date) 
    WHERE status = 'active';

-- 4. Nang cap RPC get_team_kpi_overview ho tro day du 4 tru cot
CREATE OR REPLACE FUNCTION public.get_team_kpi_overview(
    p_leader_email TEXT DEFAULT NULL,
    p_id_team      TEXT DEFAULT NULL,
    p_start        TEXT DEFAULT NULL,
    p_end          TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
    v_leader_id UUID;
    v_start DATE := COALESCE(p_start::date, (CURRENT_DATE - EXTRACT(DOW FROM CURRENT_DATE)::int));
    v_end   DATE := COALESCE(p_end::date,   v_start + 6);
    v_team_ids UUID[];
    v_member_ids UUID[];
    v_result JSONB;
BEGIN
    -- 1. Resolve leader
    IF p_leader_email IS NOT NULL AND p_leader_email <> '' THEN
        SELECT id INTO v_leader_id FROM public.app_users
        WHERE LOWER(email) = LOWER(TRIM(p_leader_email))
        LIMIT 1;
    END IF;

    -- 2. Resolve teams
    IF p_id_team IS NOT NULL AND p_id_team <> '' THEN
        v_team_ids := ARRAY[p_id_team::uuid];
    ELSIF v_leader_id IS NOT NULL THEN
        SELECT COALESCE(ARRAY_AGG(id), ARRAY[]::uuid[])
        INTO v_team_ids
        FROM public.teams
        WHERE id_leader = v_leader_id;
    ELSE
        SELECT COALESCE(ARRAY_AGG(id), ARRAY[]::uuid[])
        INTO v_team_ids
        FROM public.teams;
    END IF;

    IF v_team_ids IS NULL OR array_length(v_team_ids, 1) IS NULL THEN
        RETURN jsonb_build_object('totals', '{}'::jsonb, 'members', '[]'::jsonb);
    END IF;

    -- 3. Resolve member IDs
    SELECT COALESCE(ARRAY_AGG(DISTINCT id_member), ARRAY[]::uuid[])
    INTO v_member_ids
    FROM public.member_of_teams
    WHERE id_teams = ANY(v_team_ids);

    -- Include leader as member of own team
    IF v_leader_id IS NOT NULL AND NOT (v_leader_id = ANY(v_member_ids)) THEN
        v_member_ids := array_append(v_member_ids, v_leader_id);
    END IF;

    IF array_length(v_member_ids, 1) IS NULL THEN
        RETURN jsonb_build_object('totals', '{}'::jsonb, 'members', '[]'::jsonb);
    END IF;

    -- 4. Aggregate via VIEWs (server-side)
    SELECT jsonb_build_object(
        'totals', (
            WITH kpi_agg AS (
                SELECT
                    COALESCE(SUM(kpi_inbox)::numeric,   0) AS inbox_target,
                    COALESCE(SUM(kpi_lead)::numeric,    0) AS lead_target,
                    COALESCE(SUM(COALESCE(kpi_call, kpi_post))::numeric,    0) AS call_target,
                    COALESCE(SUM(kpi_post)::numeric,    0) AS post_target,
                    COALESCE(SUM(kpi_comment)::numeric, 0) AS comment_target
                FROM public.kpi_tracker
                WHERE id_member = ANY(v_member_ids)
                  AND status = 'active'
                  AND start_date::date = v_start
                  AND end_date::date   = v_end
            ),
            seed_agg AS (
                SELECT COALESCE(SUM(verified_count)::numeric, 0) AS comment_actual
                FROM public.v_member_daily_seeding
                WHERE id_member = ANY(v_member_ids)
                  AND day BETWEEN v_start AND v_end
            ),
            fb_inbox_agg AS (
                SELECT
                    COALESCE(SUM(inbox_count)::numeric, 0) AS inbox_actual_fb,
                    COALESCE(SUM(lead_count)::numeric,  0) AS lead_actual_fb
                FROM public.v_member_daily_fb_inbox
                WHERE id_member = ANY(v_member_ids)
                  AND day_vn BETWEEN v_start AND v_end
            ),
            call_agg AS (
                SELECT 
                    COALESCE(SUM(call_count)::numeric, 0) AS call_actual,
                    COALESCE(SUM(call_attempts)::numeric, 0) AS call_attempts_actual
                FROM public.v_member_daily_calls
                WHERE id_member = ANY(v_member_ids)
                  AND day_vn BETWEEN v_start AND v_end
            ),
            zalo_agg AS (
                SELECT
                    COUNT(*)::numeric AS inbox_actual_zalo,
                    COUNT(*) FILTER (WHERE z.is_lead)::numeric AS lead_actual_zalo
                FROM public.zalo_conversation_permissions z
                WHERE z.id_member = ANY(v_member_ids)
                  AND z.shared_role = 'leader'
                  AND z.is_active = true
                  AND z.is_verify = true
                  AND z.verified_at IS NOT NULL
                  AND z.verified_at >= (v_start::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
                  AND z.verified_at <  ((v_end + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
            )
            SELECT jsonb_build_object(
                'member_count',      array_length(v_member_ids, 1),
                'inbox_target',      kpi_agg.inbox_target,
                'lead_target',       kpi_agg.lead_target,
                'call_target',       kpi_agg.call_target,
                'post_target',       kpi_agg.call_target, -- fallback compatibility
                'comment_target',    kpi_agg.comment_target,
                'inbox_actual_zalo', zalo_agg.inbox_actual_zalo,
                'lead_actual_zalo',  zalo_agg.lead_actual_zalo,
                'inbox_actual_fb',   fb_inbox_agg.inbox_actual_fb,
                'lead_actual_fb',    fb_inbox_agg.lead_actual_fb,
                'call_actual',       call_agg.call_actual,
                'call_attempts',     call_agg.call_attempts_actual,
                'post_actual',       call_agg.call_actual, -- fallback compatibility
                'comment_actual',    seed_agg.comment_actual
            )
            FROM kpi_agg, seed_agg, fb_inbox_agg, call_agg, zalo_agg
        ),
        'members', COALESCE((
            SELECT jsonb_agg(row_to_json(t))
            FROM (
                SELECT
                    u.id::text AS id,
                    LOWER(u.email) AS email,
                    u.name,
                    COALESCE(u.role, 'member') AS role,
                    jsonb_build_object(
                        'kpi_call',    COALESCE(kt.kpi_call, kt.kpi_post, 0),
                        'kpi_post',    COALESCE(kt.kpi_call, kt.kpi_post, 0),
                        'kpi_lead',    COALESCE(kt.kpi_lead,    0),
                        'kpi_inbox',   COALESCE(kt.kpi_inbox,   0),
                        'kpi_comment', COALESCE(kt.kpi_comment, 0),
                        'start_date',  kt.start_date,
                        'end_date',    kt.end_date
                    ) AS kpi,
                    jsonb_build_object(
                        'comment',          COALESCE(s.verified_count, 0),
                        'call',             COALESCE(c.call_count, 0),
                        'call_attempts',    COALESCE(c.call_attempts, 0),
                        'post',             COALESCE(c.call_count, 0), -- fallback compatibility
                        'inbox_zalo',       COALESCE(z.inbox_count, 0),
                        'lead_zalo',        COALESCE(z.lead_count, 0),
                        'inbox_fb_kpi',     COALESCE(f.inbox_count, 0),
                        'lead_fb_kpi',      COALESCE(f.lead_count, 0)
                    ) AS actuals
                FROM public.app_users u
                LEFT JOIN public.kpi_tracker kt
                       ON kt.id_member = u.id AND kt.status = 'active'
                      AND kt.start_date::date = v_start
                      AND kt.end_date::date   = v_end
                LEFT JOIN (
                    SELECT id_member, SUM(verified_count)::int AS verified_count
                    FROM public.v_member_daily_seeding
                    WHERE id_member = ANY(v_member_ids)
                      AND day BETWEEN v_start AND v_end
                    GROUP BY id_member
                ) s ON s.id_member = u.id
                LEFT JOIN (
                    SELECT id_member, SUM(inbox_count)::int AS inbox_count,
                                     SUM(lead_count)::int AS lead_count
                    FROM public.v_member_daily_fb_inbox
                    WHERE id_member = ANY(v_member_ids)
                      AND day_vn BETWEEN v_start AND v_end
                    GROUP BY id_member
                ) f ON f.id_member = u.id
                LEFT JOIN (
                    SELECT id_member, 
                           SUM(call_count)::int AS call_count,
                           SUM(call_attempts)::int AS call_attempts
                    FROM public.v_member_daily_calls
                    WHERE id_member = ANY(v_member_ids)
                      AND day_vn BETWEEN v_start AND v_end
                    GROUP BY id_member
                ) c ON c.id_member = u.id
                LEFT JOIN (
                    SELECT z.id_member,
                           COUNT(*)::int AS inbox_count,
                           COUNT(*) FILTER (WHERE z.is_lead)::int AS lead_count
                    FROM public.zalo_conversation_permissions z
                    WHERE z.id_member = ANY(v_member_ids)
                      AND z.shared_role = 'leader'
                      AND z.is_active = true
                      AND z.is_verify = true
                      AND z.verified_at IS NOT NULL
                      AND z.verified_at >= (v_start::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
                      AND z.verified_at <  ((v_end + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
                    GROUP BY z.id_member
                ) z ON z.id_member = u.id
                WHERE u.id = ANY(v_member_ids)
                ORDER BY u.email NULLS LAST
            ) t
        ), '[]'::jsonb),
        'range', jsonb_build_object('start', v_start, 'end', v_end)
    )
    INTO v_result;

    RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_team_kpi_overview IS
    'Trả JSON tổng hợp KPI của team theo 4 trụ cột: CMT, INBOX, CALL, LEAD. Tối ưu index và aggregated view.';

-- 5. Nang cap RPC get_admin_teams_kpi_overview cho trang Admin Quan ly Team
CREATE OR REPLACE FUNCTION public.get_admin_teams_kpi_overview(
    p_start DATE DEFAULT NULL,
    p_end   DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
    v_start DATE := COALESCE(
        p_start,
        (CURRENT_DATE - EXTRACT(DOW FROM CURRENT_DATE)::int)
    );
    v_end DATE := COALESCE(p_end, v_start + 6);
BEGIN
    RETURN jsonb_build_object(
        'teams', COALESCE((
            SELECT jsonb_agg(row_to_json(t) ORDER BY t.name_team)
            FROM (
                SELECT
                    tm.id::text                       AS id,
                    tm.name_team,
                    tm.team_type,
                    tm.id_leader::text                AS id_leader,
                    tm.leader_member_id::text          AS leader_member_id,
                    COALESCE(lu.email, '')            AS leader_email,
                    COALESCE(lu.name, lm.display_name, lm.full_name, '') AS leader_name,
                    (tm.id_leader IS NOT NULL)        AS leader_linked,
                    COALESCE((
                        SELECT jsonb_agg(jsonb_build_object(
                            'id',    mu.id::text,
                            'email', mu.email,
                            'name',  COALESCE(mu.name, '')
                        ) ORDER BY mu.email)
                        FROM public.member_of_teams mot2
                        JOIN public.app_users mu ON mu.id = mot2.id_member
                        WHERE mot2.id_teams = tm.id
                    ), '[]'::jsonb)                   AS members,
                    COALESCE((
                        SELECT COUNT(*)
                        FROM public.member_of_teams mot3
                        WHERE mot3.id_teams = tm.id
                    ), 0)                             AS number_of_member
                FROM public.teams tm
                LEFT JOIN public.app_users lu ON lu.id = tm.id_leader
                LEFT JOIN public.members lm ON lm.id = tm.leader_member_id
            ) t
        ), '[]'::jsonb),

        'kpi_data', COALESCE((
            SELECT jsonb_agg(row_to_json(t) ORDER BY t.team_name, t.is_leader DESC, t.member_email)
            FROM (
                SELECT
                    p.team_id                                         AS team_id,
                    p.team_name                                       AS team_name,
                    p.leader_email                                    AS leader_email,
                    p.person_id::text                                 AS member_id,
                    p.person_email                                    AS member_email,
                    p.person_name                                     AS member_name,
                    p.is_leader                                       AS is_leader,
                    COALESCE(kt.kpi_call, kt.kpi_post, 0)             AS kpi_call,
                    COALESCE(kt.kpi_call, kt.kpi_post, 0)             AS kpi_post,
                    COALESCE(kt.kpi_lead, 0)                          AS kpi_lead,
                    COALESCE(kt.kpi_inbox, 0)                         AS kpi_inbox,
                    COALESCE(kt.kpi_comment, 0)                       AS kpi_comment,
                    -- Actuals (FB + Zalo + Calls)
                    COALESCE(s.verified_count, 0)                     AS verified_count,
                    COALESCE(cl.call_count, 0)                        AS call_count,
                    COALESCE(cl.call_count, 0)                        AS post_count,
                    COALESCE(fb.inbox_count, 0)                       AS inbox_count,
                    COALESCE(fb.lead_count, 0)                        AS lead_count,
                    -- Computed convenience (alias de tuong thich FE cu)
                    COALESCE(cl.call_count, 0)                        AS kpi_call_current,
                    COALESCE(cl.call_count, 0)                        AS kpi_post_current,
                    COALESCE(fb.inbox_count, 0)                       AS kpi_inbox_current,
                    COALESCE(fb.lead_count, 0)                        AS kpi_lead_current,
                    jsonb_build_object(
                        'start', v_start,
                        'end',   v_end
                    )                                                 AS kpi_inbox_range
                FROM (
                    SELECT
                        tm.id                              AS team_id_raw,
                        tm.id::text                         AS team_id,
                        tm.name_team                        AS team_name,
                        COALESCE(leader.email, '')          AS leader_email,
                        mu.id                                AS person_id,
                        mu.email                             AS person_email,
                        COALESCE(mu.name, mu.email)          AS person_name,
                        false                                AS is_leader
                    FROM public.teams tm
                    LEFT JOIN public.app_users leader ON leader.id = tm.id_leader
                    JOIN public.member_of_teams mot ON mot.id_teams = tm.id
                    JOIN public.app_users mu ON mu.id = mot.id_member

                    UNION ALL

                    SELECT
                        tm.id                              AS team_id_raw,
                        tm.id::text                         AS team_id,
                        tm.name_team                        AS team_name,
                        leader.email                         AS leader_email,
                        leader.id                            AS person_id,
                        leader.email                         AS person_email,
                        COALESCE(leader.name, leader.email)  AS person_name,
                        true                                 AS is_leader
                    FROM public.teams tm
                    JOIN public.app_users leader ON leader.id = tm.id_leader
                ) p
                LEFT JOIN LATERAL (
                    SELECT kt2.kpi_call, kt2.kpi_post, kt2.kpi_lead, kt2.kpi_inbox, kt2.kpi_comment
                    FROM public.kpi_tracker kt2
                    WHERE kt2.id_member = p.person_id
                      AND kt2.status = 'active'
                      AND kt2.start_date::date <= v_end
                      AND kt2.end_date::date   >= v_start
                    ORDER BY
                        (kt2.id_team = p.team_id_raw) DESC NULLS LAST,
                        kt2.updated_at DESC
                    LIMIT 1
                ) kt ON TRUE
                LEFT JOIN (
                    SELECT id_member, SUM(verified_count)::int AS verified_count
                    FROM public.v_member_daily_seeding
                    WHERE day BETWEEN v_start AND v_end
                    GROUP BY id_member
                ) s ON s.id_member = p.person_id
                LEFT JOIN (
                    SELECT id_member, SUM(call_count)::int AS call_count
                    FROM public.v_member_daily_calls
                    WHERE day_vn BETWEEN v_start AND v_end
                    GROUP BY id_member
                ) cl ON cl.id_member = p.person_id
                LEFT JOIN (
                    SELECT id_member,
                           SUM(inbox_count)::int AS inbox_count,
                           SUM(lead_count)::int  AS lead_count
                    FROM (
                        SELECT id_member, inbox_count, 0 AS lead_count
                        FROM public.v_member_daily_fb_inbox
                        WHERE day_vn BETWEEN v_start AND v_end
                        UNION ALL
                        SELECT id_member, 0 AS inbox_count, lead_count
                        FROM public.v_member_daily_fb_lead
                        WHERE day_vn BETWEEN v_start AND v_end
                        UNION ALL
                        SELECT z.id_member,
                               1                                        AS inbox_count,
                               CASE WHEN z.is_lead THEN 1 ELSE 0 END    AS lead_count
                        FROM public.zalo_conversation_permissions z
                        WHERE z.shared_role = 'leader'
                          AND z.is_active = true
                          AND z.is_verify = true
                          AND z.verified_at IS NOT NULL
                          AND z.verified_at >= (v_start::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
                          AND z.verified_at <  ((v_end + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
                    ) x
                    GROUP BY id_member
                ) fb ON fb.id_member = p.person_id
            ) t
        ), '[]'::jsonb),

        'range', jsonb_build_object('start', v_start, 'end', v_end)
    );
END;
$$;

COMMENT ON FUNCTION public.get_admin_teams_kpi_overview IS
    'Admin teams-management RPC hỗ trợ KPI Call thay Post và gom dữ liệu 4 trụ cột.';

NOTIFY pgrst, 'reload schema';
