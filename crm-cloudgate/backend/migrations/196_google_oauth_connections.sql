-- Google OAuth per-nguoi-dung (2026-10-27, yeu cau sep "nhap hop dong Google Docs/Drive
-- rieng tu bang chinh quyen cua nguoi dung, khong ep tai file tu may"). Luu access/refresh
-- token cua Google OAuth (authorization-code flow, scope toi thieu drive.readonly) rieng
-- cho tung app_user - KHAC han service account markee-recruitment-bot@... (chi co quyen
-- trong Shared Drive, khong doc duoc file Google Docs/Drive RIENG TU cua nguoi khac).
--
-- Luong dung bang nay: nguoi dung bam "Ket noi Google" -> OAuth consent -> luu token o day
-- -> backend dung CHINH token nay de doc/export file rieng tu (thay mat nguoi dung that),
-- roi UPLOAD lai vao Shared Drive bang service account co san (contract_drive_service.py) -
-- KHONG bao gio cho nguoi dung ghi truc tiep vao Shared Drive bang OAuth token cua ho.

CREATE TABLE IF NOT EXISTS public.google_oauth_connections (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
    google_email      TEXT,
    access_token      TEXT NOT NULL,
    refresh_token     TEXT,
    scope             TEXT,
    token_expires_at  TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id)
);
CREATE INDEX IF NOT EXISTS idx_google_oauth_connections_user ON public.google_oauth_connections (user_id);

NOTIFY pgrst, 'reload schema';
