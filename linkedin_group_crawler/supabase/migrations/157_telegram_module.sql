-- Tích hợp Telegram Chat (Telethon) vào "Quản lý kênh & CSKH" — cùng tinh thần luồng
-- Zalo (kết nối tài khoản, nhận/gửi tin nhắn realtime, gửi ảnh/media) nhưng gọn hơn:
-- không có campaign/broadcast/forward-rules, chỉ inbox 1-1/nhóm/kênh.
--
-- telegram_accounts: 1 tài khoản Telegram đã kết nối (đăng nhập số điện thoại+OTP,
--   hoặc bot token). session_string là Telethon StringSession — thay thế cho việc lưu
--   file .session trên đĩa, để hoạt động được trên môi trường container/nhiều instance.
-- telegram_dialogs: cache danh sách hội thoại (user/group/channel/bot) của mỗi account,
--   làm mới định kỳ + khi có tin nhắn mới, để hiển thị sidebar hội thoại nhanh không
--   phải gọi Telethon mỗi lần load trang.
-- telegram_messages: cache lịch sử tin nhắn (để hiển thị + biết tin đã sửa/xoá/ghim).
CREATE TABLE IF NOT EXISTS public.telegram_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    id_member UUID REFERENCES public.app_users(id) ON DELETE CASCADE,
    label TEXT,
    auth_type TEXT NOT NULL DEFAULT 'user' CHECK (auth_type IN ('user', 'bot')),
    phone TEXT,
    telegram_user_id BIGINT,
    username TEXT,
    display_name TEXT,
    session_string TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'awaiting_code', 'awaiting_password', 'connected', 'disconnected', 'error')),
    last_error TEXT,
    connected_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.telegram_dialogs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES public.telegram_accounts(id) ON DELETE CASCADE,
    dialog_id BIGINT NOT NULL,
    dialog_type TEXT NOT NULL DEFAULT 'user' CHECK (dialog_type IN ('user', 'group', 'channel', 'bot')),
    title TEXT,
    username TEXT,
    photo_url TEXT,
    unread_count INT NOT NULL DEFAULT 0,
    last_message_at TIMESTAMPTZ,
    last_message_preview TEXT,
    is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (account_id, dialog_id)
);

CREATE TABLE IF NOT EXISTS public.telegram_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES public.telegram_accounts(id) ON DELETE CASCADE,
    dialog_id BIGINT NOT NULL,
    message_id BIGINT NOT NULL,
    sender_id BIGINT,
    sender_name TEXT,
    is_outgoing BOOLEAN NOT NULL DEFAULT FALSE,
    text TEXT,
    media_type TEXT,
    media_url TEXT,
    reply_to_message_id BIGINT,
    is_edited BOOLEAN NOT NULL DEFAULT FALSE,
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
    sent_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (account_id, dialog_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_telegram_accounts_member ON public.telegram_accounts (id_member);
CREATE INDEX IF NOT EXISTS idx_telegram_dialogs_account ON public.telegram_dialogs (account_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_telegram_messages_account_dialog ON public.telegram_messages (account_id, dialog_id, sent_at DESC);

ALTER TABLE public.telegram_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_dialogs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS telegram_accounts_read_all ON public.telegram_accounts;
CREATE POLICY telegram_accounts_read_all ON public.telegram_accounts FOR SELECT TO authenticated, anon USING (true);
DROP POLICY IF EXISTS telegram_dialogs_read_all ON public.telegram_dialogs;
CREATE POLICY telegram_dialogs_read_all ON public.telegram_dialogs FOR SELECT TO authenticated, anon USING (true);
DROP POLICY IF EXISTS telegram_messages_read_all ON public.telegram_messages;
CREATE POLICY telegram_messages_read_all ON public.telegram_messages FOR SELECT TO authenticated, anon USING (true);

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        GRANT ALL ON public.telegram_accounts TO service_role;
        GRANT ALL ON public.telegram_dialogs TO service_role;
        GRANT ALL ON public.telegram_messages TO service_role;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        GRANT SELECT ON public.telegram_accounts TO authenticated;
        GRANT SELECT ON public.telegram_dialogs TO authenticated;
        GRANT SELECT ON public.telegram_messages TO authenticated;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        GRANT SELECT ON public.telegram_accounts TO anon;
        GRANT SELECT ON public.telegram_dialogs TO anon;
        GRANT SELECT ON public.telegram_messages TO anon;
    END IF;
END $$;

NOTIFY pgrst, 'reload schema';
