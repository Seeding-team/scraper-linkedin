-- Ma dung-1-lan cho "chuyen workspace" (admin switcher + redirect non-admin
-- nham site) chuyen tu luu RAM cua process (chi dung khi 1 process duy nhat
-- phuc vu ca 4 domain) sang luu bang nay trong DB DUNG CHUNG (crm-module/
-- crm-cloudgate/crm-securityzone von da cung 1 DB self-host tu truoc) - nho
-- vay 3 deploy TACH RIENG (3 container/host khac nhau) van dung duoc tinh
-- nang nay, KHONG can gop stack / doi NPM.
--
-- An toan chay lai nhieu lan. CHI CAN chay 1 LAN tren DB dung chung (khong
-- can chay rieng cho tung deploy vi ca 3 tro cung 1 DB).

CREATE TABLE IF NOT EXISTS public.workspace_handoff_codes (
  code TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workspace_handoff_codes_expires_at
  ON public.workspace_handoff_codes (expires_at);

NOTIFY pgrst, 'reload schema';
