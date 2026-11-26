-- Migration 242: WhatsApp Per-Account Sticky Proxy (Fernet Encrypted)
-- Adds nullable proxy_url_enc to public.whatsapp_accounts so deployments can
-- route individual WhatsApp Multi-Device sessions through dedicated HTTP/HTTPS/SOCKS5 proxies.

BEGIN;

ALTER TABLE public.whatsapp_accounts
  ADD COLUMN IF NOT EXISTS proxy_url_enc TEXT;

GRANT ALL ON TABLE public.whatsapp_accounts
  TO postgres, anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
