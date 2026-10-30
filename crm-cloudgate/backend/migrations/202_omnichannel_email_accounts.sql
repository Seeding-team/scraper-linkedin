-- 202: Multi-account Email & Google OAuth token storage for Omnichannel Email Inbox.
CREATE TABLE IF NOT EXISTS public.omnichannel_email_accounts (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    instance            TEXT NOT NULL,
    account_email       TEXT NOT NULL,
    account_name        TEXT,
    provider_type       TEXT NOT NULL DEFAULT 'google_oauth', -- 'google_oauth' | 'microsoft_oauth' | 'imap_smtp'
    encrypted_credentials TEXT, -- Fernet-encrypted JSON (tokens or app_password)
    imap_host           TEXT,
    imap_port           INTEGER DEFAULT 993,
    smtp_host           TEXT,
    smtp_port           INTEGER DEFAULT 587,
    status              TEXT NOT NULL DEFAULT 'connected', -- 'connected' | 'syncing' | 'expired' | 'error' | 'disconnected'
    is_default          BOOLEAN NOT NULL DEFAULT false,
    is_active           BOOLEAN NOT NULL DEFAULT true,
    last_synced_at      TIMESTAMPTZ,
    last_sync_error     TEXT,
    total_threads       INTEGER NOT NULL DEFAULT 0,
    unread_count        INTEGER NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (instance, account_email)
);

CREATE INDEX IF NOT EXISTS omnichannel_email_accounts_instance_idx 
    ON public.omnichannel_email_accounts (instance, is_active);

ALTER TABLE public.omnichannel_email_accounts ENABLE ROW LEVEL SECURITY;

-- Add idempotency_key to omnichannel_email_messages for safe optimistic sending & retry
ALTER TABLE public.omnichannel_email_messages 
    ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE INDEX IF NOT EXISTS omnichannel_email_messages_idempotency_idx 
    ON public.omnichannel_email_messages (instance, idempotency_key);
