-- Cau hinh kenh gui bao gia (Phase "Phat hanh va gui khach that", muc B.2
-- trong yeu cau). Truoc mat CHI implement channel_type='email' (Gmail
-- SMTP/IMAP, theo yeu cau cu the cua nguoi dung) - Zalo de sau vi can
-- credentials/API rieng (dung nhu khuyen nghi "lam Email truoc").
--
-- BAO MAT: encrypted_app_password la Fernet token (xem
-- email_provider_service.py) - KHONG BAO GIO co cot luu password THO. Key
-- giai ma nam o env var QUOTE_EMAIL_PROVIDER_ENCRYPTION_KEY (khong commit
-- vao git, giong pattern ZCA_AUTH_ENCRYPTION_KEY da dung cho Zalo).
--
-- DA APPLY len DB that (xac nhan qua scratch/readonly_check_migration_090_092.py)
-- - KHONG sua file nay nua. Thay doi phat sinh SAU thoi diem apply (vd bang
-- audit log) phai nam trong migration moi (093), khong duoc them vao day.

CREATE TABLE IF NOT EXISTS public.quote_delivery_channels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_type TEXT NOT NULL,
    display_name TEXT NOT NULL,
    is_enabled BOOLEAN NOT NULL DEFAULT false,
    sender_name TEXT,
    -- Email/username dang nhap (Gmail address) - KHONG phai secret, luu ro.
    sender_address TEXT,
    -- Host/port co the sua sau nay (channel khac Gmail) nhung mac dinh dung
    -- dung theo yeu cau: IMAP imap.gmail.com:993 SSL/TLS, SMTP
    -- smtp.gmail.com:587 STARTTLS.
    imap_host TEXT,
    imap_port INT,
    imap_security TEXT,
    smtp_host TEXT,
    smtp_port INT,
    smtp_security TEXT,
    -- App Password ma hoa (Fernet) - KHONG BAO GIO tra ve qua API doc
    -- (GET chi tra credential_configured = (encrypted_app_password IS NOT NULL)).
    encrypted_app_password BYTEA,
    credential_updated_at TIMESTAMPTZ,
    credential_updated_by UUID REFERENCES public.app_users(id),
    -- Trang thai kiem tra gan nhat ("Trang thai kiem tra gan nhat" trong
    -- yeu cau) - rieng cho tung loai test, khong gop chung 1 co mo ho.
    -- 'unknown' | 'ok' | 'error'.
    imap_connection_status TEXT NOT NULL DEFAULT 'unknown',
    imap_last_tested_at TIMESTAMPTZ,
    smtp_connection_status TEXT NOT NULL DEFAULT 'unknown',
    smtp_last_tested_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by UUID REFERENCES public.app_users(id),
    CONSTRAINT quote_delivery_channels_type_check CHECK (channel_type IN ('email', 'zalo'))
);

-- Chi 1 kenh cho moi channel_type (1 cau hinh Gmail duy nhat, khong can
-- nhieu cau hinh email song song o giai doan nay).
CREATE UNIQUE INDEX IF NOT EXISTS quote_delivery_channels_type_unique
    ON public.quote_delivery_channels (channel_type);
