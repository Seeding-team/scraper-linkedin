-- Migration 217: Cầu nối Zalo -> Chatwoot/n8n bot (dùng bot Markee Chat trả lời tự động).
-- Engine: app/modules/all_platform/zalo/services/zalo_chatwoot_bridge.py
-- Seeding chỉ làm "kênh": đẩy tin khách vào n8n (workflow "Seeding Zalo - Incoming"),
-- bot (n8n + LightRAG) trả lời qua Chatwoot rồi n8n gọi lại Seeding để gửi tin ra Zalo.
-- Chỉ xử lý hội thoại 1-1; mặc định TẮT + dry_run để an toàn.

CREATE TABLE IF NOT EXISTS public.zalo_bot_configs (
    account_id           TEXT PRIMARY KEY,                -- = zalo_messages.user_id (tài khoản Zalo trong Seeding)
    is_enabled           BOOLEAN     NOT NULL DEFAULT false,
    dry_run              BOOLEAN     NOT NULL DEFAULT true, -- true: chỉ log, không đẩy sang n8n / không gửi Zalo
    chatwoot_account_id  INTEGER     NOT NULL,            -- Chatwoot account id (bot "markee" nằm ở account 3)
    chatwoot_inbox_id    INTEGER     NOT NULL,            -- id inbox kiểu API đã gán bot trong Chatwoot
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.zalo_bot_cursor (
    account_id       TEXT PRIMARY KEY,
    last_message_ts  BIGINT      NOT NULL,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.zalo_bot_logs (
    id             BIGSERIAL PRIMARY KEY,
    account_id     TEXT        NOT NULL,
    thread_id      TEXT        NOT NULL,
    direction      TEXT        NOT NULL DEFAULT 'in',  -- in: Zalo -> n8n | out: n8n -> Zalo
    source_msg_id  TEXT,
    content        TEXT,
    status         TEXT        NOT NULL,   -- forwarded | sent | dry_run | skipped | error
    error          TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_zalo_bot_logs_account_created
    ON public.zalo_bot_logs (account_id, created_at DESC);
