-- Tích hợp Viber Chat vào "Quản lý kênh & CSKH" — cùng khuôn Telegram Chat (157) nhưng
-- dùng Viber Bot API chính thức (REST + webhook), vì Viber KHÔNG có API cho tài khoản
-- cá nhân. Mỗi "tài khoản Viber" kết nối vào tool = 1 Viber Bot (auth token lấy ở
-- https://partners.viber.com). Khách nhắn tin cho bot -> Viber gọi webhook của backend ->
-- lưu DB + đẩy SSE; nhân viên trả lời trong tool -> gọi send_message -> hiện trên Viber.
--
-- viber_accounts: 1 bot đã kết nối. auth_token chỉ backend đọc (không trả về FE).
-- viber_dialogs: 1 hội thoại = 1 người dùng Viber (viber_user_id do Viber cấp, dạng
--   base64 có thể chứa '/', '+', '=' -> KHÔNG dùng làm path param).
-- viber_messages: lịch sử tin nhắn. message_token là int64 của Viber, lưu TEXT để FE
--   (JS number) không bị mất chính xác.
CREATE TABLE IF NOT EXISTS public.viber_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    id_member UUID REFERENCES public.app_users(id) ON DELETE CASCADE,
    label TEXT,
    auth_token TEXT NOT NULL,
    bot_id TEXT,
    bot_uri TEXT,
    display_name TEXT,
    avatar_url TEXT,
    subscribers_count INT,
    webhook_url TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'connected', 'disconnected', 'error')),
    last_error TEXT,
    connected_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.viber_dialogs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES public.viber_accounts(id) ON DELETE CASCADE,
    viber_user_id TEXT NOT NULL,
    name TEXT,
    avatar_url TEXT,
    language TEXT,
    country TEXT,
    is_subscribed BOOLEAN NOT NULL DEFAULT TRUE,
    unread_count INT NOT NULL DEFAULT 0,
    last_message_at TIMESTAMPTZ,
    last_message_preview TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (account_id, viber_user_id)
);

CREATE TABLE IF NOT EXISTS public.viber_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES public.viber_accounts(id) ON DELETE CASCADE,
    viber_user_id TEXT NOT NULL,
    message_token TEXT NOT NULL,
    is_outgoing BOOLEAN NOT NULL DEFAULT FALSE,
    sender_name TEXT,
    sent_by_member UUID,
    text TEXT,
    media_type TEXT,
    media_url TEXT,
    file_name TEXT,
    file_size BIGINT,
    status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('received', 'sent', 'delivered', 'seen', 'failed')),
    error TEXT,
    sent_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (account_id, message_token)
);

CREATE INDEX IF NOT EXISTS idx_viber_accounts_member ON public.viber_accounts (id_member);
CREATE INDEX IF NOT EXISTS idx_viber_dialogs_account ON public.viber_dialogs (account_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_viber_messages_account_user ON public.viber_messages (account_id, viber_user_id, sent_at DESC);

ALTER TABLE public.viber_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.viber_dialogs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.viber_messages ENABLE ROW LEVEL SECURITY;

-- viber_accounts chứa auth_token -> KHÔNG mở SELECT cho anon/authenticated (khác Telegram
-- 157); chỉ service_role (backend) đọc. Dialogs/messages giữ giống Telegram.
DROP POLICY IF EXISTS viber_dialogs_read_all ON public.viber_dialogs;
CREATE POLICY viber_dialogs_read_all ON public.viber_dialogs FOR SELECT TO authenticated, anon USING (true);
DROP POLICY IF EXISTS viber_messages_read_all ON public.viber_messages;
CREATE POLICY viber_messages_read_all ON public.viber_messages FOR SELECT TO authenticated, anon USING (true);

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        GRANT ALL ON public.viber_accounts TO service_role;
        GRANT ALL ON public.viber_dialogs TO service_role;
        GRANT ALL ON public.viber_messages TO service_role;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        GRANT SELECT ON public.viber_dialogs TO authenticated;
        GRANT SELECT ON public.viber_messages TO authenticated;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        GRANT SELECT ON public.viber_dialogs TO anon;
        GRANT SELECT ON public.viber_messages TO anon;
    END IF;
END $$;

NOTIFY pgrst, 'reload schema';
