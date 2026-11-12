-- Migration 230: Facebook Messenger Bridge message deduplication column & index

ALTER TABLE public.fb_messenger_messages
    ADD COLUMN IF NOT EXISTS fb_message_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_fb_msg_messages_fb_message_id
    ON public.fb_messenger_messages(account_id, fb_message_id)
    WHERE fb_message_id IS NOT NULL;
