-- 184 (DE XUAT - CHUA CHAY): quy tac ma hop dong theo workspace.
-- Mac dinh (khi chua co dong) giu nguyen HD/{YYYY}/{SEQ}; token ho tro: {SHORT} ten viet tat cong ty phat hanh, {YYYY}, {SEQ}.
-- Khong doi ma hop dong da co. Code tuong thich ca truoc/sau khi ap (bang chua co => dung mac dinh, nut luu bao ro "can migration 184").
-- DRY-RUN: select to_regclass('public.workspace_contract_settings');   -- NULL = chua ap
-- ROLLBACK: drop table if exists public.workspace_contract_settings;
CREATE TABLE IF NOT EXISTS public.workspace_contract_settings (
    instance TEXT PRIMARY KEY,
    number_format TEXT NOT NULL DEFAULT 'HD/{YYYY}/{SEQ}' CHECK (position('{SEQ}' in number_format) > 0),
    short_name TEXT,
    updated_by UUID REFERENCES public.app_users(id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.workspace_contract_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow authenticated full access" ON public.workspace_contract_settings;
CREATE POLICY "Allow authenticated full access" ON public.workspace_contract_settings FOR ALL USING (true) WITH CHECK (true);
