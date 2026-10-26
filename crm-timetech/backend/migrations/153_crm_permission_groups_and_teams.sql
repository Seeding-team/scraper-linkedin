-- "Nhom quyen" (permission group/template) + "Team CRM" (KHAC bang teams/team_type
-- dang dung cho KPI/seeding noi bo - xem docstring crm_permission_service.py) +
-- override quyen rieng theo user - theo prototype
-- markee_crm_account_permission_prototype_v4_full_flow.html (Account & Permission
-- Center) + ghi chu thiet ke ban moi hon (Team dat ten theo Leader, co thuoc tinh
-- mo ta segment/khoi/nganh/khu vuc).
--
-- QUAN TRONG - enforcement la OPT-IN theo tung user: app_users.permission_group_id
-- mac dinh NULL cho toan bo user hien co (khong backfill hang loat). Code enforcement
-- (them o service layer, khong trong migration nay) CHI ap dung khi user co
-- permission_group_id - user chua duoc admin gan gi qua UI moi thi tiep tuc dung dung
-- rule has_full_crm_access() cu, KHONG doi hanh vi dang chay that (Deal/Bao gia van
-- xem duoc het cua moi nguoi nhu tai lieu da chot truoc day).

-- ── 1. NHOM QUYEN (permission group template) ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crm_permission_groups (
    id                          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
    name                        TEXT        NOT NULL,
    status                      TEXT        NOT NULL DEFAULT 'active',
    default_system_role         TEXT        NOT NULL DEFAULT 'member',
    default_scope               TEXT        NOT NULL DEFAULT 'personal',
    description                 TEXT,
    default_quote_business_role TEXT,
    default_can_approve_quotes  BOOLEAN     NOT NULL DEFAULT false,
    quote_cost_permission       TEXT        NOT NULL DEFAULT 'none',
    quote_sell_permission       TEXT        NOT NULL DEFAULT 'none',
    quote_release_permission    TEXT        NOT NULL DEFAULT 'none',
    modules                     TEXT[]      NOT NULL DEFAULT '{}',
    created_by                  UUID        REFERENCES public.app_users(id) ON DELETE SET NULL,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.crm_permission_groups
    DROP CONSTRAINT IF EXISTS crm_permission_groups_status_check;
ALTER TABLE public.crm_permission_groups
    ADD CONSTRAINT crm_permission_groups_status_check
    CHECK (status IN ('active', 'draft'));

ALTER TABLE public.crm_permission_groups
    DROP CONSTRAINT IF EXISTS crm_permission_groups_system_role_check;
ALTER TABLE public.crm_permission_groups
    ADD CONSTRAINT crm_permission_groups_system_role_check
    CHECK (default_system_role IN ('member', 'leader', 'admin'));

ALTER TABLE public.crm_permission_groups
    DROP CONSTRAINT IF EXISTS crm_permission_groups_scope_check;
ALTER TABLE public.crm_permission_groups
    ADD CONSTRAINT crm_permission_groups_scope_check
    CHECK (default_scope IN ('personal', 'team', 'deal_assigned', 'workspace', 'system'));

ALTER TABLE public.crm_permission_groups
    DROP CONSTRAINT IF EXISTS crm_permission_groups_quote_role_check;
ALTER TABLE public.crm_permission_groups
    ADD CONSTRAINT crm_permission_groups_quote_role_check
    CHECK (default_quote_business_role IS NULL OR default_quote_business_role IN ('presale', 'sale', 'both'));

ALTER TABLE public.crm_permission_groups
    DROP CONSTRAINT IF EXISTS crm_permission_groups_quote_cost_check;
ALTER TABLE public.crm_permission_groups
    ADD CONSTRAINT crm_permission_groups_quote_cost_check
    CHECK (quote_cost_permission IN ('none', 'read_only', 'assigned', 'all'));

ALTER TABLE public.crm_permission_groups
    DROP CONSTRAINT IF EXISTS crm_permission_groups_quote_sell_check;
ALTER TABLE public.crm_permission_groups
    ADD CONSTRAINT crm_permission_groups_quote_sell_check
    CHECK (quote_sell_permission IN ('none', 'read_only', 'assigned', 'all'));

ALTER TABLE public.crm_permission_groups
    DROP CONSTRAINT IF EXISTS crm_permission_groups_quote_release_check;
ALTER TABLE public.crm_permission_groups
    ADD CONSTRAINT crm_permission_groups_quote_release_check
    CHECK (quote_release_permission IN ('none', 'assigned', 'all'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_permission_groups_name ON public.crm_permission_groups (lower(name));

-- Seed 5 nhom mau giong het prototype de admin dung ngay, khong bat dau tu rong.
-- ON CONFLICT theo ten (case-insensitive qua index tren) - chay lai an toan.
INSERT INTO public.crm_permission_groups
    (name, status, default_system_role, default_scope, description,
     default_quote_business_role, default_can_approve_quotes,
     quote_cost_permission, quote_sell_permission, quote_release_permission, modules)
VALUES
    ('Admin CRM', 'active', 'admin', 'system',
     'Toan quyen CRM va quan tri he thong',
     'both', true, 'all', 'all', 'all',
     ARRAY['Lead','Customer','Deal','Quote','Product','Report','Account','Setting']),
    ('Leader Sales', 'active', 'leader', 'team',
     'Quan ly team Sales, pipeline va duyet bao gia',
     'sale', true, 'read_only', 'assigned', 'assigned',
     ARRAY['Lead','Customer','Deal','Quote','Report']),
    ('Sales Executive', 'active', 'member', 'personal',
     'Sale member xu ly lead, khach hang, deal va bao gia',
     'sale', false, 'read_only', 'assigned', 'assigned',
     ARRAY['Lead','Customer','Deal','Quote']),
    ('Presale Engineer', 'active', 'member', 'deal_assigned',
     'Presale phu trach giai phap, BOM va gia von',
     'presale', false, 'assigned', 'read_only', 'none',
     ARRAY['Deal','Quote','Product']),
    ('Marketing', 'active', 'member', 'personal',
     'Marketing quan ly lead va campaign',
     NULL, false, 'none', 'none', 'none',
     ARRAY['Lead','Report'])
ON CONFLICT (lower(name)) DO NOTHING;

-- ── 2. TEAM CRM (khac han bang teams/team_type dang dung cho KPI/seeding) ────
CREATE TABLE IF NOT EXISTS public.crm_teams (
    id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
    name            TEXT        NOT NULL,
    code            TEXT        UNIQUE,
    leader_user_id  UUID        REFERENCES public.app_users(id) ON DELETE SET NULL,
    status          TEXT        NOT NULL DEFAULT 'active',
    segment         TEXT,
    function_area   TEXT,
    industry        TEXT,
    region          TEXT,
    description     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.crm_teams DROP CONSTRAINT IF EXISTS crm_teams_status_check;
ALTER TABLE public.crm_teams ADD CONSTRAINT crm_teams_status_check
    CHECK (status IN ('active', 'inactive'));

ALTER TABLE public.crm_teams DROP CONSTRAINT IF EXISTS crm_teams_segment_check;
ALTER TABLE public.crm_teams ADD CONSTRAINT crm_teams_segment_check
    CHECK (segment IS NULL OR segment IN ('enterprise', 'smb', 'mid_market', 'government', 'mixed'));

ALTER TABLE public.crm_teams DROP CONSTRAINT IF EXISTS crm_teams_function_area_check;
ALTER TABLE public.crm_teams ADD CONSTRAINT crm_teams_function_area_check
    CHECK (function_area IS NULL OR function_area IN
        ('sales', 'marketing', 'presale', 'infrastructure', 'software', 'security', 'finance', 'operations'));

CREATE INDEX IF NOT EXISTS idx_crm_teams_leader_user_id ON public.crm_teams (leader_user_id);

-- 1 user chi thuoc dung 1 Team CRM (unique user_id) - dung yeu cau thiet ke.
CREATE TABLE IF NOT EXISTS public.crm_team_members (
    id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
    crm_team_id UUID        NOT NULL REFERENCES public.crm_teams(id) ON DELETE CASCADE,
    user_id     UUID        NOT NULL UNIQUE REFERENCES public.app_users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_team_members_team_id ON public.crm_team_members (crm_team_id);

-- ── 3. Gan quyen tren app_users - tat ca nullable/default an toan, khong doi
--      hanh vi user hien co cho toi khi admin chu dong gan qua UI moi.
ALTER TABLE public.app_users
    ADD COLUMN IF NOT EXISTS permission_group_id UUID REFERENCES public.crm_permission_groups(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS data_scope TEXT,
    ADD COLUMN IF NOT EXISTS permission_override BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS permission_overrides TEXT[],
    ADD COLUMN IF NOT EXISTS crm_status TEXT NOT NULL DEFAULT 'active',
    ADD COLUMN IF NOT EXISTS crm_note TEXT;

ALTER TABLE public.app_users DROP CONSTRAINT IF EXISTS app_users_data_scope_check;
ALTER TABLE public.app_users ADD CONSTRAINT app_users_data_scope_check
    CHECK (data_scope IS NULL OR data_scope IN ('personal', 'team', 'deal_assigned', 'workspace', 'system'));

ALTER TABLE public.app_users DROP CONSTRAINT IF EXISTS app_users_crm_status_check;
ALTER TABLE public.app_users ADD CONSTRAINT app_users_crm_status_check
    CHECK (crm_status IN ('active', 'pending_review', 'locked'));

CREATE INDEX IF NOT EXISTS idx_app_users_permission_group_id ON public.app_users (permission_group_id) WHERE permission_group_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
