-- 203: Gmail OAuth state replay protection and cross-container sync lease.
-- Safe to run repeatedly. Browser clients have no direct policies; service-role
-- FastAPI remains the only data path.

CREATE TABLE IF NOT EXISTS public.omnichannel_email_oauth_states (
    state_hash  TEXT PRIMARY KEY,
    instance    TEXT NOT NULL,
    user_key    TEXT NOT NULL,
    origin      TEXT NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS omnichannel_email_oauth_states_lookup_idx
    ON public.omnichannel_email_oauth_states (instance, user_key, expires_at DESC);

ALTER TABLE public.omnichannel_email_oauth_states ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.omnichannel_email_sync_state
    ADD COLUMN IF NOT EXISTS sync_owner TEXT,
    ADD COLUMN IF NOT EXISTS sync_lease_until TIMESTAMPTZ;

ALTER TABLE public.omnichannel_email_threads
    ADD COLUMN IF NOT EXISTS provider_thread_id TEXT;

ALTER TABLE public.omnichannel_email_messages
    ADD COLUMN IF NOT EXISTS provider_thread_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS omnichannel_email_threads_provider_thread_idx
    ON public.omnichannel_email_threads (instance, account_email, provider_thread_id)
    WHERE provider_thread_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.claim_omnichannel_email_sync(
    p_instance TEXT,
    p_account_email TEXT,
    p_owner TEXT,
    p_lease_seconds INTEGER DEFAULT 180
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    affected INTEGER := 0;
BEGIN
    INSERT INTO public.omnichannel_email_sync_state (instance, account_email, mailbox)
    VALUES (p_instance, lower(p_account_email), 'INBOX')
    ON CONFLICT (instance, account_email, mailbox) DO NOTHING;

    UPDATE public.omnichannel_email_sync_state
       SET sync_owner = p_owner,
           sync_lease_until = now() + make_interval(secs => GREATEST(30, LEAST(p_lease_seconds, 900))),
           updated_at = now()
     WHERE instance = p_instance
       AND account_email = lower(p_account_email)
       AND mailbox = 'INBOX'
       AND (sync_lease_until IS NULL OR sync_lease_until < now());

    GET DIAGNOSTICS affected = ROW_COUNT;
    RETURN affected = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_omnichannel_email_sync(
    p_instance TEXT,
    p_account_email TEXT,
    p_owner TEXT
) RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    UPDATE public.omnichannel_email_sync_state
       SET sync_owner = NULL,
           sync_lease_until = NULL,
           updated_at = now()
     WHERE instance = p_instance
       AND account_email = lower(p_account_email)
       AND mailbox = 'INBOX'
       AND sync_owner = p_owner;
$$;

REVOKE ALL ON FUNCTION public.claim_omnichannel_email_sync(TEXT, TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_omnichannel_email_sync(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_omnichannel_email_sync(TEXT, TEXT, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_omnichannel_email_sync(TEXT, TEXT, TEXT) TO service_role;

DELETE FROM public.omnichannel_email_oauth_states
 WHERE expires_at < now() - interval '1 day';

NOTIFY pgrst, 'reload schema';
