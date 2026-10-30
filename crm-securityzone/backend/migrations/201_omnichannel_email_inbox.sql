-- 201: Persistent, workspace-isolated Omnichannel Email Inbox.
-- Credentials remain encrypted in quote_delivery_channels (migration 183).

CREATE TABLE IF NOT EXISTS public.omnichannel_email_threads (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    instance            TEXT NOT NULL,
    account_email       TEXT NOT NULL,
    thread_key          TEXT NOT NULL,
    subject             TEXT,
    customer_email      TEXT NOT NULL,
    customer_name       TEXT,
    last_message_text   TEXT NOT NULL DEFAULT '',
    last_message_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    unread_count        INTEGER NOT NULL DEFAULT 0 CHECK (unread_count >= 0),
    crm_customer_id     UUID,
    crm_deal_id         UUID,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (instance, account_email, thread_key)
);

CREATE INDEX IF NOT EXISTS omnichannel_email_threads_instance_last_idx
    ON public.omnichannel_email_threads (instance, last_message_at DESC);
CREATE INDEX IF NOT EXISTS omnichannel_email_threads_customer_idx
    ON public.omnichannel_email_threads (instance, lower(customer_email));

CREATE TABLE IF NOT EXISTS public.omnichannel_email_messages (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    instance            TEXT NOT NULL,
    thread_id           UUID NOT NULL REFERENCES public.omnichannel_email_threads(id) ON DELETE CASCADE,
    account_email       TEXT NOT NULL,
    imap_uid            BIGINT,
    message_id          TEXT NOT NULL,
    in_reply_to         TEXT,
    references_header   TEXT,
    direction           TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    sender_name         TEXT,
    sender_email        TEXT NOT NULL,
    recipient_emails    TEXT[] NOT NULL DEFAULT '{}',
    cc_emails           TEXT[] NOT NULL DEFAULT '{}',
    subject             TEXT,
    body_text           TEXT NOT NULL DEFAULT '',
    body_html           TEXT,
    status              TEXT NOT NULL CHECK (status IN ('received', 'sent', 'read', 'failed')),
    received_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    read_at             TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (instance, account_email, message_id),
    UNIQUE (instance, account_email, imap_uid)
);

CREATE INDEX IF NOT EXISTS omnichannel_email_messages_thread_idx
    ON public.omnichannel_email_messages (thread_id, received_at ASC);

CREATE TABLE IF NOT EXISTS public.omnichannel_email_attachments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    instance        TEXT NOT NULL,
    message_id      UUID NOT NULL REFERENCES public.omnichannel_email_messages(id) ON DELETE CASCADE,
    file_name       TEXT NOT NULL,
    content_type    TEXT NOT NULL DEFAULT 'application/octet-stream',
    size_bytes      BIGINT NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
    storage_path    TEXT NOT NULL,
    content_id      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS omnichannel_email_attachments_message_idx
    ON public.omnichannel_email_attachments (message_id);

CREATE TABLE IF NOT EXISTS public.omnichannel_email_sync_state (
    instance        TEXT NOT NULL,
    account_email   TEXT NOT NULL,
    mailbox         TEXT NOT NULL DEFAULT 'INBOX',
    uid_validity    BIGINT,
    last_uid        BIGINT NOT NULL DEFAULT 0,
    last_synced_at  TIMESTAMPTZ,
    last_error      TEXT,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (instance, account_email, mailbox)
);

-- Service-role backend is the only data path. Browser clients must use the
-- authenticated FastAPI endpoints, never PostgREST directly.
ALTER TABLE public.omnichannel_email_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.omnichannel_email_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.omnichannel_email_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.omnichannel_email_sync_state ENABLE ROW LEVEL SECURITY;

INSERT INTO storage.buckets (id, name, public)
VALUES ('omnichannel-email-attachments', 'omnichannel-email-attachments', false)
ON CONFLICT (id) DO UPDATE SET public = false;

NOTIFY pgrst, 'reload schema';
