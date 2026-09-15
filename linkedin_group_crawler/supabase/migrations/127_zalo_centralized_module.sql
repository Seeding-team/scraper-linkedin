-- Migration 127: Port tính năng "Zalo tập trung" (từ InvoiceFlowManager
-- ZALO_CENTRALIZED_MODULE_GUIDE.md) vào app chính, thay thế tại chỗ luồng
-- Zalo cũ (Playwright/QR/crawl-job/broadcast cũ) — KHÔNG tạo bảng mới trùng
-- vai trò zalo_accounts/zalo_messages/zalo_groups, chỉ bổ sung cột còn thiếu
-- + thêm bảng mới cho forward-rules / bulk-send / campaigns / web push /
-- RBAC theo tài khoản (thay cho "staff_zalo_assignments" của guide gốc,
-- ở đây khoá theo app_users vì dùng chung SSO app chính).
--
-- An toàn dữ liệu: mọi ALTER đều "add column if not exists", mọi CREATE đều
-- "if not exists" — không đụng/xoá dữ liệu cũ, không đổi tên bảng cũ.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Bổ sung cột còn thiếu cho zalo_messages (theo Mục 7.1 guide)
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public.zalo_messages
    ADD COLUMN IF NOT EXISTS ts             BIGINT,       -- epoch ms, dùng cho watermark cursor của forward engine
    ADD COLUMN IF NOT EXISTS raw_content    JSONB,        -- payload gốc từ zca-js (sticker id/cateId, system notice...)
    ADD COLUMN IF NOT EXISTS mentions       JSONB,        -- [{pos,uid,len}] cho @tag/@All
    ADD COLUMN IF NOT EXISTS cli_msg_id     TEXT,         -- id phía client, bắt buộc để thu hồi (api.undo)
    ADD COLUMN IF NOT EXISTS msg_kind       TEXT;         -- text|image|gif|video|sticker|file|voice|link|system_notice

CREATE INDEX IF NOT EXISTS idx_zalo_messages_ts
    ON public.zalo_messages (user_id, group_id, ts);

CREATE INDEX IF NOT EXISTS idx_zalo_messages_cli_msg_id
    ON public.zalo_messages (user_id, cli_msg_id)
    WHERE cli_msg_id IS NOT NULL;

COMMENT ON COLUMN public.zalo_messages.ts IS
    'Epoch ms của tin nhắn (nguồn zca-js) — dùng cho watermark cursor (zalo_forward_cursor/zalo_push_cursor), KHÁC timestamp_text/time_text (chỉ để hiển thị).';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Bổ sung cột còn thiếu cho zalo_groups (đóng vai trò "zalo_conversations_ui"
--    của guide — KHÔNG đổi tên bảng, code mới đọc/ghi thẳng zalo_groups)
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public.zalo_groups
    ADD COLUMN IF NOT EXISTS thread_type    TEXT NOT NULL DEFAULT 'group', -- 'user' | 'group'
    ADD COLUMN IF NOT EXISTS message_count  INTEGER NOT NULL DEFAULT 0;

-- Backfill best-effort: is_friend=true trước đây chỉ dùng cho hội thoại 1-1 → suy ra thread_type='user'.
UPDATE public.zalo_groups
   SET thread_type = 'user'
 WHERE is_friend IS TRUE
   AND thread_type = 'group';

COMMENT ON COLUMN public.zalo_groups.thread_type IS
    'Phân biệt group vs 1-1 (zca-js ThreadType) — forward-rules CHỈ áp dụng cho thread_type=group (theo Mục 5.2 guide).';

-- ─────────────────────────────────────────────────────────────────────────
-- 3. RBAC theo tài khoản Zalo cho từng nhân viên (thay "staff_zalo_assignments"
--    của guide gốc — khoá theo app_users.id vì dùng chung SSO app chính,
--    KHÔNG dựng bảng staff riêng)
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.zalo_account_assignments (
    id              BIGSERIAL PRIMARY KEY,
    app_user_id     UUID        NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
    account_id      TEXT        NOT NULL REFERENCES public.zalo_accounts(account_id) ON DELETE CASCADE,
    can_view        BOOLEAN     NOT NULL DEFAULT true,
    can_send        BOOLEAN     NOT NULL DEFAULT false,
    can_broadcast   BOOLEAN     NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT zalo_account_assignments_unique UNIQUE (app_user_id, account_id)
);

CREATE INDEX IF NOT EXISTS idx_zalo_account_assignments_account
    ON public.zalo_account_assignments (account_id);
CREATE INDEX IF NOT EXISTS idx_zalo_account_assignments_user
    ON public.zalo_account_assignments (app_user_id);

COMMENT ON TABLE public.zalo_account_assignments IS
    'RBAC theo tài khoản Zalo cho từng nhân viên (view/send/broadcast) — tương đương staff_zalo_assignments trong guide gốc, khoá theo app_users vì dùng chung SSO app chính. admin/leader/owner được full quyền qua kiểm tra ở tầng API, không qua trigger DB.';

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Forward rules (Mục 7.2 guide) — chuyển tiếp tin nhắn tự động 1 nhóm
--    chính sang N nhóm đích
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.zalo_forward_rules (
    id                  BIGSERIAL PRIMARY KEY,
    account_id          TEXT        NOT NULL REFERENCES public.zalo_accounts(account_id) ON DELETE CASCADE,
    name                TEXT,
    master_thread_id    TEXT        NOT NULL,
    master_thread_name  TEXT,
    is_enabled          BOOLEAN     NOT NULL DEFAULT true,
    created_by          UUID        REFERENCES public.app_users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT zalo_forward_rules_unique UNIQUE (account_id, master_thread_id)
);

CREATE TABLE IF NOT EXISTS public.zalo_forward_targets (
    id                  BIGSERIAL PRIMARY KEY,
    rule_id             BIGINT      NOT NULL REFERENCES public.zalo_forward_rules(id) ON DELETE CASCADE,
    target_thread_id    TEXT        NOT NULL,
    target_thread_name  TEXT,
    is_enabled          BOOLEAN     NOT NULL DEFAULT true,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT zalo_forward_targets_unique UNIQUE (rule_id, target_thread_id)
);

CREATE TABLE IF NOT EXISTS public.zalo_forward_logs (
    id                  BIGSERIAL PRIMARY KEY,
    rule_id             BIGINT      REFERENCES public.zalo_forward_rules(id) ON DELETE SET NULL,
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

CREATE TABLE IF NOT EXISTS public.zalo_forward_cursor (
    account_id          TEXT        PRIMARY KEY REFERENCES public.zalo_accounts(account_id) ON DELETE CASCADE,
    last_message_ts     BIGINT      NOT NULL DEFAULT 0,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_zalo_forward_rules_account
    ON public.zalo_forward_rules (account_id, is_enabled);
CREATE INDEX IF NOT EXISTS idx_zalo_forward_targets_rule
    ON public.zalo_forward_targets (rule_id, is_enabled);
CREATE INDEX IF NOT EXISTS idx_zalo_forward_logs_rule
    ON public.zalo_forward_logs (rule_id, created_at DESC);

CREATE OR REPLACE VIEW public.v_zalo_forward_rules_active AS
SELECT
    r.id                    AS rule_id,
    r.account_id,
    r.name,
    r.master_thread_id,
    r.master_thread_name,
    t.id                    AS target_id,
    t.target_thread_id,
    t.target_thread_name
FROM public.zalo_forward_rules r
JOIN public.zalo_forward_targets t ON t.rule_id = r.id
WHERE r.is_enabled = true
  AND t.is_enabled = true;

COMMENT ON VIEW public.v_zalo_forward_rules_active IS
    'Join rules+targets đã bật cả 2 phía — dùng bởi forward engine (services/forward_engine.py) để nạp Map<master_thread_id, Rule[]>.';

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Bulk-send (Mục 7.3 guide)
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.zalo_bulk_jobs (
    id                  BIGSERIAL PRIMARY KEY,
    account_id          TEXT        NOT NULL REFERENCES public.zalo_accounts(account_id) ON DELETE CASCADE,
    job_type            TEXT        NOT NULL CHECK (job_type IN ('send_message', 'add_friend', 'invite_group')),
    actions             JSONB       NOT NULL DEFAULT '[]'::jsonb, -- kết hợp nhiều hành động 1 lượt
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

CREATE TABLE IF NOT EXISTS public.zalo_bulk_job_items (
    id                  BIGSERIAL PRIMARY KEY,
    job_id              BIGINT      NOT NULL REFERENCES public.zalo_bulk_jobs(id) ON DELETE CASCADE,
    phone               TEXT,
    uid                 TEXT,
    display_name        TEXT,
    status              TEXT        NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'sent', 'failed', 'not_found', 'skipped')),
    error               TEXT,
    processed_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_zalo_bulk_jobs_account
    ON public.zalo_bulk_jobs (account_id, status);
CREATE INDEX IF NOT EXISTS idx_zalo_bulk_job_items_job
    ON public.zalo_bulk_job_items (job_id, status);

-- ─────────────────────────────────────────────────────────────────────────
-- 6. Campaigns (Mục 7.3 guide) — nhắn tin tự động lặp lịch
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.zalo_campaigns (
    id                      BIGSERIAL PRIMARY KEY,
    account_id              TEXT        NOT NULL REFERENCES public.zalo_accounts(account_id) ON DELETE CASCADE,
    name                    TEXT        NOT NULL,
    is_enabled              BOOLEAN     NOT NULL DEFAULT true,
    start_time              TIME,
    end_time                TIME,
    days_of_week            INTEGER[]   NOT NULL DEFAULT '{1,2,3,4,5,6,0}',
    interval_seconds_min    INTEGER     NOT NULL DEFAULT 30,
    interval_seconds_max    INTEGER     NOT NULL DEFAULT 90,
    daily_limit             INTEGER     NOT NULL DEFAULT 100,
    message_templates       JSONB       NOT NULL DEFAULT '[]'::jsonb, -- round-robin, hỗ trợ biến {{ten}}
    next_template_index     INTEGER     NOT NULL DEFAULT 0,
    repeat_cycle_seconds    INTEGER     NOT NULL DEFAULT 86400,
    sent_today              INTEGER     NOT NULL DEFAULT 0,
    sent_today_date         DATE,
    last_sent_at            TIMESTAMPTZ,
    created_by              UUID        REFERENCES public.app_users(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.zalo_campaign_recipients (
    id                  BIGSERIAL PRIMARY KEY,
    campaign_id         BIGINT      NOT NULL REFERENCES public.zalo_campaigns(id) ON DELETE CASCADE,
    phone               TEXT,
    uid                 TEXT,
    display_name        TEXT,
    status              TEXT        NOT NULL DEFAULT 'pending',
    last_error          TEXT,
    sent_at             TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT zalo_campaign_recipients_unique UNIQUE (campaign_id, phone)
);

CREATE TABLE IF NOT EXISTS public.zalo_campaign_logs (
    id                  BIGSERIAL PRIMARY KEY,
    campaign_id         BIGINT      NOT NULL REFERENCES public.zalo_campaigns(id) ON DELETE CASCADE,
    recipient_id        BIGINT      REFERENCES public.zalo_campaign_recipients(id) ON DELETE SET NULL,
    phone               TEXT,
    status              TEXT        NOT NULL CHECK (status IN ('success', 'failed')),
    error               TEXT,
    message_sent        TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_zalo_campaigns_account
    ON public.zalo_campaigns (account_id, is_enabled);
CREATE INDEX IF NOT EXISTS idx_zalo_campaign_recipients_campaign
    ON public.zalo_campaign_recipients (campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_zalo_campaign_logs_campaign
    ON public.zalo_campaign_logs (campaign_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────
-- 7. Web Push (Mục 7.4 guide) — khoá theo app_users vì dùng chung SSO
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
    id                  BIGSERIAL PRIMARY KEY,
    app_user_id         UUID        NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
    endpoint            TEXT        NOT NULL,
    p256dh              TEXT        NOT NULL,
    auth                TEXT        NOT NULL,
    user_agent          TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT push_subscriptions_unique UNIQUE (app_user_id, endpoint)
);

CREATE TABLE IF NOT EXISTS public.zalo_push_cursor (
    account_id          TEXT        PRIMARY KEY REFERENCES public.zalo_accounts(account_id) ON DELETE CASCADE,
    last_message_ts     BIGINT      NOT NULL DEFAULT 0,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user
    ON public.push_subscriptions (app_user_id);

-- ─────────────────────────────────────────────────────────────────────────
-- 8. RLS — theo đúng pattern các bảng zalo_* hiện có (migration 003):
--    bật RLS, cho phép authenticated+anon SELECT (backend tự lọc theo quyền),
--    KHÔNG tạo policy insert/update/delete — chỉ service_role (backend) mới
--    ghi được, PostgREST tự deny ghi khi thiếu policy tương ứng.
-- ─────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'zalo_account_assignments',
        'zalo_forward_rules', 'zalo_forward_targets', 'zalo_forward_logs', 'zalo_forward_cursor',
        'zalo_bulk_jobs', 'zalo_bulk_job_items',
        'zalo_campaigns', 'zalo_campaign_recipients', 'zalo_campaign_logs',
        'push_subscriptions', 'zalo_push_cursor'
    ]
    LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format(
            'DROP POLICY IF EXISTS %I ON public.%I',
            t || '_read_all', t
        );
        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated, anon USING (true)',
            t || '_read_all', t
        );
    END LOOP;
END $$;
