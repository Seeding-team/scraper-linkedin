-- Migration 221: Facebook Messenger API & Realtime 2-Way Sync Tables
-- Idempotent: chạy nhiều lần không lỗi.

CREATE TABLE IF NOT EXISTS public.fb_messenger_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fb_user_id VARCHAR(100) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    avatar_url TEXT,
    cookie TEXT NOT NULL,
    fb_dtsg VARCHAR(255),
    jazoest VARCHAR(50),
    lsd VARCHAR(50),
    proxy_url TEXT,
    user_agent TEXT,
    status VARCHAR(50) DEFAULT 'connected' CHECK (status IN ('connected', 'checkpoint', 'frozen', 'expired', 'disconnected')),
    warm_up_tier INT DEFAULT 1,
    daily_sent_count INT DEFAULT 0,
    daily_sent_limit INT DEFAULT 8,
    last_sent_at TIMESTAMPTZ,
    frozen_until TIMESTAMPTZ,
    checkpoint_reason TEXT,
    id_member UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
    is_active BOOLEAN DEFAULT TRUE,
    is_shared_with_all BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.fb_messenger_threads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id VARCHAR(100) NOT NULL,
    account_id UUID NOT NULL REFERENCES public.fb_messenger_accounts(id) ON DELETE CASCADE,
    recipient_id VARCHAR(100) NOT NULL,
    recipient_name VARCHAR(255),
    recipient_avatar TEXT,
    last_message TEXT,
    last_message_at TIMESTAMPTZ DEFAULT NOW(),
    unread_count INT DEFAULT 0,
    is_pinned BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_fb_messenger_thread UNIQUE (account_id, thread_id)
);

CREATE TABLE IF NOT EXISTS public.fb_messenger_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id VARCHAR(100) NOT NULL,
    account_id UUID NOT NULL REFERENCES public.fb_messenger_accounts(id) ON DELETE CASCADE,
    sender_id VARCHAR(100) NOT NULL,
    sender_name VARCHAR(255),
    recipient_id VARCHAR(100) NOT NULL,
    content TEXT,
    attachments JSONB DEFAULT '[]'::jsonb,
    is_self BOOLEAN DEFAULT FALSE,
    is_echo BOOLEAN DEFAULT FALSE,
    status VARCHAR(50) DEFAULT 'sent' CHECK (status IN ('sending', 'sent', 'failed')),
    offline_threading_id VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Chỉ mục tối ưu hóa truy vấn
CREATE INDEX IF NOT EXISTS idx_fb_msg_accs_user_id ON public.fb_messenger_accounts(fb_user_id);
CREATE INDEX IF NOT EXISTS idx_fb_msg_accs_status ON public.fb_messenger_accounts(status);
CREATE INDEX IF NOT EXISTS idx_fb_msg_threads_acc_id ON public.fb_messenger_threads(account_id);
CREATE INDEX IF NOT EXISTS idx_fb_msg_threads_thread_id ON public.fb_messenger_threads(thread_id);
CREATE INDEX IF NOT EXISTS idx_fb_msg_threads_last_msg ON public.fb_messenger_threads(last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_fb_msg_messages_thread_time ON public.fb_messenger_messages(thread_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fb_msg_messages_acc_id ON public.fb_messenger_messages(account_id);

-- Phân quyền truy cập cho PostgREST / anon / authenticated / service_role
GRANT ALL ON public.fb_messenger_accounts TO service_role;
GRANT ALL ON public.fb_messenger_threads TO service_role;
GRANT ALL ON public.fb_messenger_messages TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.fb_messenger_accounts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fb_messenger_threads TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fb_messenger_messages TO authenticated;

GRANT SELECT ON public.fb_messenger_accounts TO anon;
GRANT SELECT ON public.fb_messenger_threads TO anon;
GRANT SELECT ON public.fb_messenger_messages TO anon;

-- Báo PostgREST nạp lại schema cache
NOTIFY pgrst, 'reload schema';
