-- Migration 146: bang cho 5 cong cu Zalo nang cao (Chuyen tiep tu dong, Gui hang
-- loat, Chien dich tu dong, Gui nhieu nhom, Quet thanh vien nhom) - phan con lai
-- cua module "Quan ly kenh & CSKH" dang duoc gop dan vao crm-module (tiep noi
-- 145_zalo_module_schema.sql cua Phase 2).
--
-- Copy tu migration 127_zalo_centralized_module.sql cua app goc, NHUNG doi het
-- ten bang tu "zalo_*" sang "zalo_module_*" va FK tro ve zalo_module_accounts
-- thay vi zalo_accounts - vi crm-module dung CHUNG 1 DB self-host voi app goc
-- (xem 145_zalo_module_schema.sql), neu giu nguyen ten bang se doc/ghi NHAM
-- thang vao du lieu that cua app goc thay vi du lieu rieng cua crm-module.
-- "Gui nhieu nhom" (broadcasts.py) khong can bang moi - dung lai
-- zalo_module_groups/zalo_module_messages da co san.
--
-- Bo qua zalo_account_assignments + push_subscriptions/zalo_push_cursor cua
-- migration 127 goc - khong duoc 5 tinh nang nay dung toi (RBAC dang dung
-- _require_admin_leader_or_self co san, push notifier ngoai pham vi dot nay).
--
-- An toan du lieu: moi CREATE deu "if not exists", khong dung/xoa gi cu.

-- ─────────────────────────────────────────────────────────────────────────
-- Forward rules (chuyen tiep tu dong 1 nhom chinh sang N nhom dich)
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.zalo_module_forward_rules (
    id                  BIGSERIAL PRIMARY KEY,
    account_id          TEXT        NOT NULL REFERENCES public.zalo_module_accounts(account_id) ON DELETE CASCADE,
    name                TEXT,
    master_thread_id    TEXT        NOT NULL,
    master_thread_name  TEXT,
    is_enabled          BOOLEAN     NOT NULL DEFAULT true,
    created_by          UUID        REFERENCES public.app_users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT zalo_module_forward_rules_unique UNIQUE (account_id, master_thread_id)
);

CREATE TABLE IF NOT EXISTS public.zalo_module_forward_targets (
    id                  BIGSERIAL PRIMARY KEY,
    rule_id             BIGINT      NOT NULL REFERENCES public.zalo_module_forward_rules(id) ON DELETE CASCADE,
    target_thread_id    TEXT        NOT NULL,
    target_thread_name  TEXT,
    is_enabled          BOOLEAN     NOT NULL DEFAULT true,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT zalo_module_forward_targets_unique UNIQUE (rule_id, target_thread_id)
);

CREATE TABLE IF NOT EXISTS public.zalo_module_forward_logs (
    id                  BIGSERIAL PRIMARY KEY,
    rule_id             BIGINT      REFERENCES public.zalo_module_forward_rules(id) ON DELETE SET NULL,
    account_id          TEXT        NOT NULL,
    source_thread_id    TEXT        NOT NULL,
    source_msg_id       TEXT,
    target_thread_id    TEXT        NOT NULL,
    content_type        TEXT,
    status              TEXT        NOT NULL DEFAULT 'skipped'
                            CHECK (status IN ('success', 'failed', 'dry_run', 'skipped', 'rate_limited')),
    error               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.zalo_module_forward_cursor (
    account_id          TEXT        PRIMARY KEY REFERENCES public.zalo_module_accounts(account_id) ON DELETE CASCADE,
    last_message_ts     BIGINT      NOT NULL DEFAULT 0,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_zalo_module_forward_rules_account
    ON public.zalo_module_forward_rules (account_id, is_enabled);
CREATE INDEX IF NOT EXISTS idx_zalo_module_forward_targets_rule
    ON public.zalo_module_forward_targets (rule_id, is_enabled);
CREATE INDEX IF NOT EXISTS idx_zalo_module_forward_logs_rule
    ON public.zalo_module_forward_logs (rule_id, created_at DESC);

CREATE OR REPLACE VIEW public.v_zalo_module_forward_rules_active AS
SELECT
    r.id                    AS rule_id,
    r.account_id,
    r.name,
    r.master_thread_id,
    r.master_thread_name,
    t.id                    AS target_id,
    t.target_thread_id,
    t.target_thread_name
FROM public.zalo_module_forward_rules r
JOIN public.zalo_module_forward_targets t ON t.rule_id = r.id
WHERE r.is_enabled = true
  AND t.is_enabled = true;

COMMENT ON VIEW public.v_zalo_module_forward_rules_active IS
    'Join rules+targets da bat ca 2 phia - dung boi forward engine (services/forward_engine.py) de nap Map<master_thread_id, Rule[]>.';

-- ─────────────────────────────────────────────────────────────────────────
-- Bulk-send
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.zalo_module_bulk_jobs (
    id                  BIGSERIAL PRIMARY KEY,
    account_id          TEXT        NOT NULL REFERENCES public.zalo_module_accounts(account_id) ON DELETE CASCADE,
    job_type            TEXT        NOT NULL CHECK (job_type IN ('send_message', 'add_friend', 'invite_group')),
    actions             JSONB       NOT NULL DEFAULT '[]'::jsonb,
    status              TEXT        NOT NULL DEFAULT 'pending',
    message             TEXT,
    friend_message      TEXT,
    image_urls          JSONB       NOT NULL DEFAULT '[]'::jsonb,
    target_group_id     TEXT,
    target_group_name   TEXT,
    delay_seconds_min   INTEGER     NOT NULL DEFAULT 3,
    delay_seconds_max   INTEGER     NOT NULL DEFAULT 8,
    total_count         INTEGER     NOT NULL DEFAULT 0,
    sent_count          INTEGER     NOT NULL DEFAULT 0,
    success_count       INTEGER     NOT NULL DEFAULT 0,
    failed_count        INTEGER     NOT NULL DEFAULT 0,
    scheduled_at        TIMESTAMPTZ,
    created_by          UUID        REFERENCES public.app_users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.zalo_module_bulk_job_items (
    id                  BIGSERIAL PRIMARY KEY,
    job_id              BIGINT      NOT NULL REFERENCES public.zalo_module_bulk_jobs(id) ON DELETE CASCADE,
    phone               TEXT,
    uid                 TEXT,
    display_name        TEXT,
    status              TEXT        NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'sent', 'failed', 'not_found', 'skipped')),
    error               TEXT,
    processed_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_zalo_module_bulk_jobs_account
    ON public.zalo_module_bulk_jobs (account_id, status);
CREATE INDEX IF NOT EXISTS idx_zalo_module_bulk_job_items_job
    ON public.zalo_module_bulk_job_items (job_id, status);

-- ─────────────────────────────────────────────────────────────────────────
-- Campaigns (nhan tin tu dong lap lich)
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.zalo_module_campaigns (
    id                      BIGSERIAL PRIMARY KEY,
    account_id              TEXT        NOT NULL REFERENCES public.zalo_module_accounts(account_id) ON DELETE CASCADE,
    name                    TEXT        NOT NULL,
    is_enabled              BOOLEAN     NOT NULL DEFAULT true,
    start_time              TIME,
    end_time                TIME,
    days_of_week            INTEGER[]   NOT NULL DEFAULT '{1,2,3,4,5,6,0}',
    interval_seconds_min    INTEGER     NOT NULL DEFAULT 30,
    interval_seconds_max    INTEGER     NOT NULL DEFAULT 90,
    daily_limit             INTEGER     NOT NULL DEFAULT 100,
    message_templates       JSONB       NOT NULL DEFAULT '[]'::jsonb,
    next_template_index     INTEGER     NOT NULL DEFAULT 0,
    repeat_cycle_seconds    INTEGER     NOT NULL DEFAULT 86400,
    sent_today              INTEGER     NOT NULL DEFAULT 0,
    sent_today_date         DATE,
    last_sent_at            TIMESTAMPTZ,
    created_by              UUID        REFERENCES public.app_users(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.zalo_module_campaign_recipients (
    id                  BIGSERIAL PRIMARY KEY,
    campaign_id         BIGINT      NOT NULL REFERENCES public.zalo_module_campaigns(id) ON DELETE CASCADE,
    phone               TEXT,
    uid                 TEXT,
    display_name        TEXT,
    status              TEXT        NOT NULL DEFAULT 'pending',
    last_error          TEXT,
    sent_at             TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT zalo_module_campaign_recipients_unique UNIQUE (campaign_id, phone)
);

CREATE TABLE IF NOT EXISTS public.zalo_module_campaign_logs (
    id                  BIGSERIAL PRIMARY KEY,
    campaign_id         BIGINT      NOT NULL REFERENCES public.zalo_module_campaigns(id) ON DELETE CASCADE,
    recipient_id        BIGINT      REFERENCES public.zalo_module_campaign_recipients(id) ON DELETE SET NULL,
    phone               TEXT,
    status              TEXT        NOT NULL CHECK (status IN ('success', 'failed')),
    error               TEXT,
    message_sent        TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_zalo_module_campaigns_account
    ON public.zalo_module_campaigns (account_id, is_enabled);
CREATE INDEX IF NOT EXISTS idx_zalo_module_campaign_recipients_campaign
    ON public.zalo_module_campaign_recipients (campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_zalo_module_campaign_logs_campaign
    ON public.zalo_module_campaign_logs (campaign_id, created_at DESC);
