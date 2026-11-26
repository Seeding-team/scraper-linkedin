-- Migration 241: WhatsApp Multi-Device Chat & Dual-Mode VoIP Call CRM
-- Tables:
--   1. whatsapp_accounts      : Linked WhatsApp sessions (Baileys QR/Pairing) + optional Meta Cloud Calling API credentials (Fernet encrypted)
--   2. whatsapp_conversations : Direct, group, and broadcast chats with LID <-> Phone alt JID support
--   3. whatsapp_messages      : Rich message history (text, media, voice, sticker, contact, location, poll, call_log, revoked, reactions)
--   4. whatsapp_call_logs     : Dual-mode call telemetry (Baileys signaling, Meta Cloud WebRTC SDP, linked-device handoff)
--   5. whatsapp_quick_replies : Reusable slash-command reply templates scoped by member

BEGIN;

-- ── 1. WhatsApp Accounts ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.whatsapp_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_member TEXT NOT NULL,
  phone_number TEXT,
  jid TEXT,
  lid TEXT,
  display_name TEXT,
  avatar_url TEXT,
  label TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  auth_mode TEXT NOT NULL DEFAULT 'qr',
  qr_data_url TEXT,
  pairing_code TEXT,
  auth_dir TEXT,
  cloud_calling_enabled BOOLEAN NOT NULL DEFAULT false,
  cloud_phone_number_id TEXT,
  cloud_waba_id TEXT,
  cloud_access_token_enc TEXT,
  cloud_webhook_verify_token TEXT,
  auto_reject_calls BOOLEAN NOT NULL DEFAULT false,
  auto_reject_message TEXT,
  last_error TEXT,
  last_connected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_accounts_member
  ON public.whatsapp_accounts (id_member, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_whatsapp_accounts_status
  ON public.whatsapp_accounts (status);

CREATE INDEX IF NOT EXISTS idx_whatsapp_accounts_cloud_phone
  ON public.whatsapp_accounts (cloud_phone_number_id)
  WHERE cloud_phone_number_id IS NOT NULL;

-- ── 2. WhatsApp Conversations ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.whatsapp_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.whatsapp_accounts(id) ON DELETE CASCADE,
  chat_jid TEXT NOT NULL,
  chat_alt_jid TEXT,
  chat_type TEXT NOT NULL DEFAULT 'direct' CHECK (chat_type IN ('direct', 'group', 'broadcast')),
  title TEXT,
  phone_number TEXT,
  avatar_url TEXT,
  last_message_at TIMESTAMPTZ,
  last_message_preview TEXT,
  unread_count INT NOT NULL DEFAULT 0,
  is_pinned BOOLEAN NOT NULL DEFAULT false,
  is_muted BOOLEAN NOT NULL DEFAULT false,
  is_archived BOOLEAN NOT NULL DEFAULT false,
  custom_label TEXT,
  participant_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_whatsapp_conversations_account_chat UNIQUE (account_id, chat_jid)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_conversations_account_recent
  ON public.whatsapp_conversations (account_id, is_pinned DESC, last_message_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_whatsapp_conversations_alt_jid
  ON public.whatsapp_conversations (account_id, chat_alt_jid)
  WHERE chat_alt_jid IS NOT NULL;

-- ── 3. WhatsApp Messages ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.whatsapp_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.whatsapp_accounts(id) ON DELETE CASCADE,
  chat_jid TEXT NOT NULL,
  message_id TEXT NOT NULL,
  sender_jid TEXT,
  sender_phone TEXT,
  sender_name TEXT,
  is_outgoing BOOLEAN NOT NULL DEFAULT false,
  msg_type TEXT NOT NULL DEFAULT 'text' CHECK (
    msg_type IN (
      'text', 'image', 'video', 'audio', 'voice', 'document', 'sticker',
      'contact', 'location', 'poll', 'call_log', 'revoked', 'system'
    )
  ),
  text TEXT,
  media_url TEXT,
  media_local_path TEXT,
  media_mime TEXT,
  media_filename TEXT,
  media_size BIGINT,
  media_duration_s INT,
  reply_to_message_id TEXT,
  quoted_text TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  reactions JSONB NOT NULL DEFAULT '[]'::jsonb,
  raw_key JSONB NOT NULL DEFAULT '{}'::jsonb,
  ack_status TEXT NOT NULL DEFAULT 'sent',
  is_edited BOOLEAN NOT NULL DEFAULT false,
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_whatsapp_messages_account_chat_msg UNIQUE (account_id, chat_jid, message_id)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_timeline
  ON public.whatsapp_messages (account_id, chat_jid, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_lookup
  ON public.whatsapp_messages (account_id, message_id);

-- ── 4. WhatsApp Call Logs ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.whatsapp_call_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.whatsapp_accounts(id) ON DELETE CASCADE,
  call_id TEXT NOT NULL,
  chat_jid TEXT,
  peer_jid TEXT,
  peer_phone TEXT,
  peer_name TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  call_type TEXT NOT NULL DEFAULT 'audio' CHECK (call_type IN ('audio', 'video')),
  call_mode TEXT NOT NULL DEFAULT 'baileys_signal' CHECK (
    call_mode IN ('baileys_signal', 'cloud_webrtc', 'linked_device_handoff')
  ),
  status TEXT NOT NULL DEFAULT 'ringing' CHECK (
    status IN ('ringing', 'pre_accepted', 'connected', 'rejected', 'missed', 'ended', 'failed')
  ),
  duration_seconds INT NOT NULL DEFAULT 0,
  sdp_offer TEXT,
  sdp_answer TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_whatsapp_call_logs_account_call UNIQUE (account_id, call_id)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_call_logs_account_started
  ON public.whatsapp_call_logs (account_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_whatsapp_call_logs_call_id
  ON public.whatsapp_call_logs (call_id);

-- ── 5. WhatsApp Quick Replies ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.whatsapp_quick_replies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_member TEXT NOT NULL,
  shortcut TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_quick_replies_member
  ON public.whatsapp_quick_replies (id_member, created_at DESC);

-- ── Grants & PostgREST Schema Cache Reload ────────────────────────────────────
GRANT ALL ON TABLE
  public.whatsapp_accounts,
  public.whatsapp_conversations,
  public.whatsapp_messages,
  public.whatsapp_call_logs,
  public.whatsapp_quick_replies
  TO postgres, anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
