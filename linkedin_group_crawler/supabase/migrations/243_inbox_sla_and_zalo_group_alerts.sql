-- Migration 243: Omnichannel Inbox SLA Tracking & Zalo Group Alert Forwarding
-- Idempotent 100% — safe to run repeatedly on PostgreSQL / self-hosted Supabase.
-- Tables:
--   1. public.inbox_sla_configs            : Global, channel-level, and account-level SLA + business hours configs
--   2. public.inbox_sla_turns              : Customer inquiry -> staff reply SLA turn ledger
--   3. public.inbox_alert_forward_configs  : Rules forwarding new inbound messages & SLA alerts to shared Zalo Groups
--   4. public.inbox_alert_forward_logs     : Delivery audit trail (sent / dry_run / failed / skipped / rate_limited)
-- RPC:
--   public.get_inbox_sla_summary(p_start, p_end, p_channel) RETURNS JSONB

BEGIN;

-- ── 1. SLA Configs ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.inbox_sla_configs (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scope_key               TEXT NOT NULL UNIQUE,
    target_minutes          INT NOT NULL DEFAULT 5 CHECK (target_minutes BETWEEN 1 AND 1440),
    warning_pct             INT NOT NULL DEFAULT 70 CHECK (warning_pct BETWEEN 10 AND 99),
    business_hours_enabled  BOOLEAN NOT NULL DEFAULT true,
    timezone                TEXT NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
    work_days               INT[] NOT NULL DEFAULT ARRAY[1,2,3,4,5,6],
    shifts                  JSONB NOT NULL DEFAULT '[{"start":"08:00","end":"12:00"},{"start":"13:30","end":"17:30"}]'::jsonb,
    include_group_chats     BOOLEAN NOT NULL DEFAULT false,
    exclude_bot_replies     BOOLEAN NOT NULL DEFAULT true,
    updated_by              UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.inbox_sla_configs IS
    'Cấu hình SLA & giờ hành chính theo phân cấp scope_key: global -> channel:<ch> -> account:<ch>:<id>.';

INSERT INTO public.inbox_sla_configs (scope_key)
VALUES ('global')
ON CONFLICT (scope_key) DO NOTHING;

-- ── 2. SLA Turns ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.inbox_sla_turns (
    id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel                   TEXT NOT NULL CHECK (channel IN ('zalo','messenger','telegram','whatsapp','email')),
    account_id                TEXT NOT NULL,
    account_name              TEXT,
    conversation_id           TEXT NOT NULL,
    customer_name             TEXT,
    customer_phone            TEXT,
    thread_type               TEXT NOT NULL DEFAULT 'direct' CHECK (thread_type IN ('direct','group')),
    customer_msg_at           TIMESTAMPTZ NOT NULL,
    last_customer_msg_at      TIMESTAMPTZ NOT NULL,
    unanswered_msg_count      INT NOT NULL DEFAULT 1,
    first_msg_preview         TEXT,
    last_msg_preview          TEXT,
    staff_reply_at            TIMESTAMPTZ,
    deadline_at               TIMESTAMPTZ,
    raw_response_seconds      INT,
    business_response_seconds INT,
    target_seconds            INT NOT NULL DEFAULT 300,
    is_first_turn             BOOLEAN NOT NULL DEFAULT false,
    status                    TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','met','breached','dismissed')),
    assigned_user_id          UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
    responded_by_user_id      UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
    responded_by_email        TEXT,
    responded_by_name         TEXT,
    warning_notified_at       TIMESTAMPTZ,
    breach_notified_at        TIMESTAMPTZ,
    dismiss_reason            TEXT,
    dismissed_by              UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.inbox_sla_turns IS
    'Nhật ký từng lượt hỏi-đáp SLA đa kênh (mỗi hội thoại tối đa 1 lượt waiting tại một thời điểm).';

-- Partial unique index: guarantees at most one active waiting turn per (channel, account_id, conversation_id)
CREATE UNIQUE INDEX IF NOT EXISTS uq_inbox_sla_turns_active
    ON public.inbox_sla_turns (channel, account_id, conversation_id)
    WHERE status = 'waiting';

-- Dashboard & Watchdog indexes
CREATE INDEX IF NOT EXISTS idx_inbox_sla_turns_status_msg_at
    ON public.inbox_sla_turns (status, customer_msg_at DESC);

CREATE INDEX IF NOT EXISTS idx_inbox_sla_turns_channel_msg_at
    ON public.inbox_sla_turns (channel, customer_msg_at DESC);

CREATE INDEX IF NOT EXISTS idx_inbox_sla_turns_staff_reply
    ON public.inbox_sla_turns (responded_by_user_id, staff_reply_at DESC);

CREATE INDEX IF NOT EXISTS idx_inbox_sla_turns_conv_timeline
    ON public.inbox_sla_turns (channel, account_id, conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_inbox_sla_turns_dedup
    ON public.inbox_sla_turns (channel, account_id, conversation_id, customer_msg_at);

-- ── 3. Alert Forward Configs (Zalo Group Notifier) ────────────────────────────
CREATE TABLE IF NOT EXISTS public.inbox_alert_forward_configs (
    id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                       TEXT NOT NULL DEFAULT 'Thông báo tin mới & SLA chung',
    is_enabled                 BOOLEAN NOT NULL DEFAULT true,
    dry_run                    BOOLEAN NOT NULL DEFAULT false,
    notifier_zalo_account_id   TEXT NOT NULL,
    notifier_zalo_account_name TEXT,
    target_zalo_group_id       TEXT NOT NULL,
    target_zalo_group_name     TEXT,
    channels                   TEXT[] NOT NULL DEFAULT ARRAY['zalo']::text[],
    source_account_ids         TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
    include_group_chats        BOOLEAN NOT NULL DEFAULT false,
    excluded_conversation_ids  TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
    alert_mode                 TEXT NOT NULL DEFAULT 'new_turn_only' CHECK (alert_mode IN ('new_turn_only','every_batch')),
    debounce_seconds           INT NOT NULL DEFAULT 8 CHECK (debounce_seconds BETWEEN 0 AND 60),
    cooldown_minutes           INT NOT NULL DEFAULT 15 CHECK (cooldown_minutes BETWEEN 0 AND 1440),
    notify_new_message         BOOLEAN NOT NULL DEFAULT true,
    notify_sla_warning         BOOLEAN NOT NULL DEFAULT false,
    notify_sla_breach          BOOLEAN NOT NULL DEFAULT true,
    forward_images             BOOLEAN NOT NULL DEFAULT false,
    mention_all_on_breach      BOOLEAN NOT NULL DEFAULT false,
    mention_zalo_uids          JSONB NOT NULL DEFAULT '[]'::jsonb,
    new_message_template       TEXT,
    sla_breach_template        TEXT,
    created_by                 UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.inbox_alert_forward_configs IS
    'Cấu hình bắn thông báo tin nhắn mới & cảnh báo quá hạn SLA về Zalo Group chung.';

CREATE INDEX IF NOT EXISTS idx_inbox_alert_forward_configs_enabled
    ON public.inbox_alert_forward_configs (is_enabled, notifier_zalo_account_id);

-- ── 4. Alert Forward Logs ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.inbox_alert_forward_logs (
    id                      BIGSERIAL PRIMARY KEY,
    config_id               UUID REFERENCES public.inbox_alert_forward_configs(id) ON DELETE SET NULL,
    alert_type              TEXT NOT NULL CHECK (alert_type IN ('new_message','sla_warning','sla_breach','test')),
    channel                 TEXT NOT NULL DEFAULT 'zalo',
    source_account_id       TEXT,
    source_conversation_id  TEXT,
    sla_turn_id             UUID REFERENCES public.inbox_sla_turns(id) ON DELETE SET NULL,
    target_zalo_group_id    TEXT,
    rendered_text           TEXT,
    status                  TEXT NOT NULL CHECK (status IN ('sent','dry_run','failed','skipped','rate_limited')),
    via                     TEXT DEFAULT 'js_engine',
    latency_ms              INT,
    error                   TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.inbox_alert_forward_logs IS
    'Nhật ký giao vận thông báo tin mới & cảnh báo SLA qua Node.js Engine / Python Fallback.';

CREATE INDEX IF NOT EXISTS idx_inbox_alert_forward_logs_created
    ON public.inbox_alert_forward_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_inbox_alert_forward_logs_config
    ON public.inbox_alert_forward_logs (config_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_inbox_alert_forward_logs_turn
    ON public.inbox_alert_forward_logs (sla_turn_id)
    WHERE sla_turn_id IS NOT NULL;

-- ── 5. Row Level Security & Role Grants ───────────────────────────────────────
DO $$
DECLARE
    tbl TEXT;
BEGIN
    FOREACH tbl IN ARRAY ARRAY[
        'inbox_sla_configs',
        'inbox_sla_turns',
        'inbox_alert_forward_configs',
        'inbox_alert_forward_logs'
    ]
    LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_read_all', tbl);
        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated, anon USING (true)',
            tbl || '_read_all', tbl
        );
    END LOOP;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        GRANT ALL ON TABLE
            public.inbox_sla_configs,
            public.inbox_sla_turns,
            public.inbox_alert_forward_configs,
            public.inbox_alert_forward_logs
        TO service_role;
        GRANT USAGE, SELECT ON SEQUENCE public.inbox_alert_forward_logs_id_seq TO service_role;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
            public.inbox_sla_configs,
            public.inbox_sla_turns,
            public.inbox_alert_forward_configs,
            public.inbox_alert_forward_logs
        TO authenticated;
        GRANT USAGE, SELECT ON SEQUENCE public.inbox_alert_forward_logs_id_seq TO authenticated;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        GRANT SELECT ON TABLE
            public.inbox_sla_configs,
            public.inbox_sla_turns,
            public.inbox_alert_forward_configs,
            public.inbox_alert_forward_logs
        TO anon;
    END IF;
END $$;

-- ── 6. Summary RPC: public.get_inbox_sla_summary ──────────────────────────────
CREATE OR REPLACE FUNCTION public.get_inbox_sla_summary(
    p_start   TIMESTAMPTZ,
    p_end     TIMESTAMPTZ,
    p_channel TEXT DEFAULT 'all'
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_channel       TEXT := LOWER(COALESCE(NULLIF(TRIM(p_channel), ''), 'all'));
    v_kpis          JSONB;
    v_by_channel    JSONB;
    v_by_staff      JSONB;
    v_daily_trend   JSONB;
BEGIN
    WITH scoped AS (
        SELECT *
        FROM public.inbox_sla_turns
        WHERE status <> 'dismissed'
          AND customer_msg_at >= p_start
          AND customer_msg_at < p_end
          AND (v_channel = 'all' OR channel = v_channel)
    ),
    live_waiting AS (
        SELECT *
        FROM public.inbox_sla_turns
        WHERE status = 'waiting'
          AND (v_channel = 'all' OR channel = v_channel)
    ),
    kpi_agg AS (
        SELECT
            COUNT(*)::INT AS total_turns,
            COUNT(*) FILTER (WHERE status = 'met')::INT AS met_count,
            COUNT(*) FILTER (WHERE status = 'breached')::INT AS breached_count,
            COALESCE(
                ROUND(
                    AVG(business_response_seconds) FILTER (
                        WHERE is_first_turn = true
                          AND status IN ('met', 'breached')
                          AND business_response_seconds IS NOT NULL
                    )
                )::INT,
                0
            ) AS avg_frt_seconds,
            COALESCE(
                ROUND(
                    AVG(business_response_seconds) FILTER (
                        WHERE status IN ('met', 'breached')
                          AND business_response_seconds IS NOT NULL
                    )
                )::INT,
                0
            ) AS avg_response_seconds,
            COALESCE(
                ROUND(
                    (
                        percentile_cont(0.5) WITHIN GROUP (ORDER BY business_response_seconds) FILTER (
                            WHERE status IN ('met', 'breached')
                              AND business_response_seconds IS NOT NULL
                        )
                    )::NUMERIC
                )::INT,
                0
            ) AS p50_response_seconds,
            COALESCE(
                ROUND(
                    (
                        percentile_cont(0.9) WITHIN GROUP (ORDER BY business_response_seconds) FILTER (
                            WHERE status IN ('met', 'breached')
                              AND business_response_seconds IS NOT NULL
                        )
                    )::NUMERIC
                )::INT,
                0
            ) AS p90_response_seconds
        FROM scoped
    ),
    wait_agg AS (
        SELECT
            COUNT(*)::INT AS waiting_count,
            COUNT(*) FILTER (
                WHERE deadline_at IS NOT NULL AND NOW() >= deadline_at
            )::INT AS waiting_breached_count,
            COUNT(*) FILTER (
                WHERE (deadline_at IS NULL OR NOW() < deadline_at)
                  AND warning_notified_at IS NOT NULL
            )::INT AS waiting_warning_count
        FROM live_waiting
    )
    SELECT jsonb_build_object(
        'total_turns', k.total_turns,
        'met_count', k.met_count,
        'breached_count', k.breached_count,
        'waiting_count', w.waiting_count,
        'waiting_breached_count', w.waiting_breached_count,
        'waiting_warning_count', w.waiting_warning_count,
        'sla_compliance_pct', CASE
            WHEN (k.met_count + k.breached_count) > 0
                THEN ROUND((k.met_count::NUMERIC * 100.0) / (k.met_count + k.breached_count), 2)
            ELSE 0.0
        END,
        'avg_frt_seconds', k.avg_frt_seconds,
        'avg_response_seconds', k.avg_response_seconds,
        'p50_response_seconds', k.p50_response_seconds,
        'p90_response_seconds', k.p90_response_seconds
    )
    INTO v_kpis
    FROM kpi_agg k
    CROSS JOIN wait_agg w;

    WITH scoped AS (
        SELECT *
        FROM public.inbox_sla_turns
        WHERE status <> 'dismissed'
          AND customer_msg_at >= p_start
          AND customer_msg_at < p_end
          AND (v_channel = 'all' OR channel = v_channel)
    ),
    ch_agg AS (
        SELECT
            channel,
            COUNT(*)::INT AS total,
            COUNT(*) FILTER (WHERE status = 'met')::INT AS met,
            COUNT(*) FILTER (WHERE status = 'breached')::INT AS breached,
            COUNT(*) FILTER (WHERE status = 'waiting')::INT AS waiting,
            COALESCE(
                ROUND(
                    AVG(business_response_seconds) FILTER (
                        WHERE status IN ('met', 'breached')
                          AND business_response_seconds IS NOT NULL
                    )
                )::INT,
                0
            ) AS avg_response_seconds
        FROM scoped
        GROUP BY channel
        ORDER BY total DESC, channel ASC
    )
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'channel', channel,
                'total', total,
                'met', met,
                'breached', breached,
                'waiting', waiting,
                'compliance_pct', CASE
                    WHEN (met + breached) > 0
                        THEN ROUND((met::NUMERIC * 100.0) / (met + breached), 2)
                    ELSE 0.0
                END,
                'avg_response_seconds', avg_response_seconds
            )
        ),
        '[]'::jsonb
    )
    INTO v_by_channel
    FROM ch_agg;

    WITH scoped AS (
        SELECT *
        FROM public.inbox_sla_turns
        WHERE status IN ('met', 'breached')
          AND customer_msg_at >= p_start
          AND customer_msg_at < p_end
          AND (v_channel = 'all' OR channel = v_channel)
          AND (responded_by_user_id IS NOT NULL OR responded_by_email IS NOT NULL OR responded_by_name IS NOT NULL)
    ),
    staff_agg AS (
        SELECT
            responded_by_user_id AS user_id,
            COALESCE(NULLIF(LOWER(TRIM(responded_by_email)), ''), '') AS email,
            COALESCE(
                MAX(NULLIF(TRIM(responded_by_name), '')),
                COALESCE(NULLIF(LOWER(TRIM(responded_by_email)), ''), 'Không rõ')
            ) AS name,
            COUNT(*)::INT AS total,
            COUNT(*) FILTER (WHERE status = 'met')::INT AS met,
            COUNT(*) FILTER (WHERE status = 'breached')::INT AS breached,
            COALESCE(
                ROUND(AVG(business_response_seconds) FILTER (WHERE business_response_seconds IS NOT NULL))::INT,
                0
            ) AS avg_response_seconds,
            COALESCE(
                ROUND(
                    (
                        percentile_cont(0.9) WITHIN GROUP (ORDER BY business_response_seconds) FILTER (
                            WHERE business_response_seconds IS NOT NULL
                        )
                    )::NUMERIC
                )::INT,
                0
            ) AS p90_response_seconds
        FROM scoped
        GROUP BY responded_by_user_id, COALESCE(NULLIF(LOWER(TRIM(responded_by_email)), ''), '')
        ORDER BY
            CASE WHEN (COUNT(*) FILTER (WHERE status = 'met') + COUNT(*) FILTER (WHERE status = 'breached')) > 0
                 THEN (COUNT(*) FILTER (WHERE status = 'met')::NUMERIC / COUNT(*))
                 ELSE 0
            END DESC,
            COUNT(*) DESC
    )
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'user_id', user_id,
                'email', email,
                'name', name,
                'total', total,
                'met', met,
                'breached', breached,
                'compliance_pct', CASE
                    WHEN (met + breached) > 0
                        THEN ROUND((met::NUMERIC * 100.0) / (met + breached), 2)
                    ELSE 0.0
                END,
                'avg_response_seconds', avg_response_seconds,
                'p90_response_seconds', p90_response_seconds
            )
        ),
        '[]'::jsonb
    )
    INTO v_by_staff
    FROM staff_agg;

    WITH scoped AS (
        SELECT
            to_char((customer_msg_at AT TIME ZONE 'UTC') + INTERVAL '7 hours', 'YYYY-MM-DD') AS day,
            status,
            business_response_seconds
        FROM public.inbox_sla_turns
        WHERE status <> 'dismissed'
          AND customer_msg_at >= p_start
          AND customer_msg_at < p_end
          AND (v_channel = 'all' OR channel = v_channel)
    ),
    day_agg AS (
        SELECT
            day,
            COUNT(*)::INT AS total,
            COUNT(*) FILTER (WHERE status = 'met')::INT AS met,
            COUNT(*) FILTER (WHERE status = 'breached')::INT AS breached,
            COALESCE(
                ROUND(
                    AVG(business_response_seconds) FILTER (
                        WHERE status IN ('met', 'breached')
                          AND business_response_seconds IS NOT NULL
                    )
                )::INT,
                0
            ) AS avg_response_seconds
        FROM scoped
        GROUP BY day
        ORDER BY day ASC
    )
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'day', day,
                'total', total,
                'met', met,
                'breached', breached,
                'compliance_pct', CASE
                    WHEN (met + breached) > 0
                        THEN ROUND((met::NUMERIC * 100.0) / (met + breached), 2)
                    ELSE 0.0
                END,
                'avg_response_seconds', avg_response_seconds
            )
        ),
        '[]'::jsonb
    )
    INTO v_daily_trend
    FROM day_agg;

    RETURN jsonb_build_object(
        'kpis', v_kpis,
        'by_channel', v_by_channel,
        'by_staff', v_by_staff,
        'daily_trend', v_daily_trend
    );
END;
$$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        GRANT EXECUTE ON FUNCTION public.get_inbox_sla_summary(TIMESTAMPTZ, TIMESTAMPTZ, TEXT) TO service_role;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        GRANT EXECUTE ON FUNCTION public.get_inbox_sla_summary(TIMESTAMPTZ, TIMESTAMPTZ, TEXT) TO authenticated;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        GRANT EXECUTE ON FUNCTION public.get_inbox_sla_summary(TIMESTAMPTZ, TIMESTAMPTZ, TEXT) TO anon;
    END IF;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
