-- Tiep theo 090-092 (DA APPLY, khong sua lai) - migration nay CHI them moi,
-- khong doi gi da co. Gom 2 phan:
--   1) quote_delivery_channel_audit_log - bang audit da viet nham vao 092
--      truoc khi biet 090-092 da len DB that (xac nhan qua
--      scratch/readonly_check_migration_090_092.py: bang nay KHONG ton tai
--      that, phai tach ra day).
--   2) quote_delivery_log - luu vet MOI LAN gui bao gia qua email (Phase
--      "Gui bao gia that", endpoint POST /quotes/{id}/send).
--
-- Idempotent an toan: CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT
-- EXISTS, khong DROP gi, khong backfill/doan du lieu cu.
--
-- CHUA apply migration nay len DB that cho toi khi duoc xac nhan rieng.

-- ── 1) Audit cau hinh kenh gui (chuyen tu 092 sang day) ─────────────────
CREATE TABLE IF NOT EXISTS public.quote_delivery_channel_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_type TEXT NOT NULL,
    actor_id UUID REFERENCES public.app_users(id),
    actor_name TEXT,
    actor_role TEXT,
    -- action: 'save_config' | 'clear_credentials' | 'enable_channel' |
    -- 'disable_channel' | 'test_imap' | 'test_smtp' | 'send_test_email'
    action TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS quote_delivery_channel_audit_log_created_at_idx
    ON public.quote_delivery_channel_audit_log (created_at DESC);

-- ── 2) Lich su gui bao gia qua email (delivery log THAT) ─────────────────
-- KHONG luu bat ky secret nao (khong co cot password/token o day).
CREATE TABLE IF NOT EXISTS public.quote_delivery_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quote_id UUID NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
    quote_version INT,
    channel TEXT NOT NULL DEFAULT 'email',
    recipient_name TEXT,
    recipient_email TEXT NOT NULL,
    -- 'deal_contact' | 'crm_customer' | 'manual' - dung hien "Nguon email"
    -- tren popup, KHONG doan neu khong ro.
    recipient_source TEXT,
    subject TEXT NOT NULL,
    message TEXT,
    public_url TEXT,
    attach_pdf BOOLEAN NOT NULL DEFAULT false,
    -- Message-ID header THAT cua email da gui (RFC 5322, vd
    -- "<abc123@domain>") - chuan bi truoc cho IMAP worker doi chieu
    -- In-Reply-To/References khi doc phan hoi (chua lam worker o migration
    -- nay, chi de dung cot).
    provider_message_id TEXT,
    -- status: 'queued' | 'sending' | 'sent' | 'failed'
    status TEXT NOT NULL DEFAULT 'queued',
    attempt_count INT NOT NULL DEFAULT 1,
    error_code TEXT,
    error_message TEXT,
    -- Chong double-submit (double-click / retry request trung) - 1
    -- idempotency_key CHI duoc xu ly 1 lan, xem UNIQUE INDEX ben duoi.
    idempotency_key TEXT NOT NULL,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    requested_by UUID REFERENCES public.app_users(id),
    -- CHI set khi provider xac nhan gui thanh cong THAT (khong set truoc,
    -- khong set neu that bai - dung yeu cau "Thanh cong moi set sent_at").
    sent_at TIMESTAMPTZ,
    CONSTRAINT quote_delivery_log_status_check CHECK (status IN ('queued', 'sending', 'sent', 'failed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS quote_delivery_log_idempotency_key_unique
    ON public.quote_delivery_log (idempotency_key);

CREATE INDEX IF NOT EXISTS quote_delivery_log_quote_id_idx
    ON public.quote_delivery_log (quote_id, requested_at DESC);
