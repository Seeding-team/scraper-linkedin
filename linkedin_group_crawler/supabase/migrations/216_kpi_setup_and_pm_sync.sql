-- ==============================================================================
-- 216_kpi_setup_and_pm_sync.sql
-- Hệ thống Setup KPI theo tuần (template chung -> session theo team CRM -> tính điểm Review Nhanh -> snapshot -> sync PM Plane.so)
-- ==============================================================================

-- 1. Bảng kpi_templates: Mẫu KPI cấu hình các mốc chỉ số chung
CREATE TABLE IF NOT EXISTS public.kpi_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_by UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kpi_templates_active ON public.kpi_templates(is_active);

-- 2. Bảng kpi_template_levels: Mốc chỉ tiêu (Normal, High, Critical) và manday tương ứng
CREATE TABLE IF NOT EXISTS public.kpi_template_levels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id UUID NOT NULL REFERENCES public.kpi_templates(id) ON DELETE CASCADE,
    metric_code TEXT NOT NULL,
    level_normal NUMERIC NOT NULL DEFAULT 0,
    level_high NUMERIC NOT NULL DEFAULT 0,
    level_critical NUMERIC NOT NULL DEFAULT 0,
    manday_normal NUMERIC NOT NULL DEFAULT 0,
    manday_high NUMERIC NOT NULL DEFAULT 0,
    manday_critical NUMERIC NOT NULL DEFAULT 0,
    UNIQUE (template_id, metric_code)
);

CREATE INDEX IF NOT EXISTS idx_kpi_tpl_levels_tpl ON public.kpi_template_levels(template_id);

-- 3. Bảng kpi_template_bonus_rules: Quy tắc thưởng thêm manday khi vượt mốc
CREATE TABLE IF NOT EXISTS public.kpi_template_bonus_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id UUID NOT NULL REFERENCES public.kpi_templates(id) ON DELETE CASCADE,
    metric_code TEXT NOT NULL,
    min_count INTEGER NOT NULL,
    bonus_manday NUMERIC NOT NULL,
    requires_tier TEXT NOT NULL DEFAULT 'critical'
);

CREATE INDEX IF NOT EXISTS idx_kpi_tpl_bonus_tpl ON public.kpi_template_bonus_rules(template_id);

-- 4. Bảng kpi_sessions: Kỳ KPI tuần theo Team CRM
CREATE TABLE IF NOT EXISTS public.kpi_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    crm_team_id UUID NOT NULL REFERENCES public.crm_teams(id) ON DELETE CASCADE,
    source_template_id UUID REFERENCES public.kpi_templates(id) ON DELETE SET NULL,
    week_start DATE NOT NULL,
    week_end DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'locked', 'closed', 'completed')),
    skill_solution_id INTEGER,
    skill_vendor_id INTEGER,
    skill_solution_name TEXT,
    skill_vendor_name TEXT,
    created_by UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (crm_team_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_kpi_sessions_team_week ON public.kpi_sessions(crm_team_id, week_start);
CREATE INDEX IF NOT EXISTS idx_kpi_sessions_status ON public.kpi_sessions(status);

-- 5. Bảng kpi_session_allocations: Tỷ lệ phân bổ (weight_pct) và người hỗ trợ (support_user_id)
CREATE TABLE IF NOT EXISTS public.kpi_session_allocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES public.kpi_sessions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
    weight_pct NUMERIC NOT NULL DEFAULT 0,
    support_user_id UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
    UNIQUE (session_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_kpi_session_alloc_session ON public.kpi_session_allocations(session_id);
CREATE INDEX IF NOT EXISTS idx_kpi_session_alloc_user ON public.kpi_session_allocations(user_id);

-- 6. Bảng kpi_session_levels: Các mốc chỉ tiêu thực tế sao chép vào session
CREATE TABLE IF NOT EXISTS public.kpi_session_levels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES public.kpi_sessions(id) ON DELETE CASCADE,
    metric_code TEXT NOT NULL,
    level_normal NUMERIC NOT NULL DEFAULT 0,
    level_high NUMERIC NOT NULL DEFAULT 0,
    level_critical NUMERIC NOT NULL DEFAULT 0,
    manday_normal NUMERIC NOT NULL DEFAULT 0,
    manday_high NUMERIC NOT NULL DEFAULT 0,
    manday_critical NUMERIC NOT NULL DEFAULT 0,
    UNIQUE (session_id, metric_code)
);

CREATE INDEX IF NOT EXISTS idx_kpi_session_levels_session ON public.kpi_session_levels(session_id);

-- 7. Bảng kpi_session_member_overrides: Điều chỉnh mức critical riêng cho từng cá nhân
CREATE TABLE IF NOT EXISTS public.kpi_session_member_overrides (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES public.kpi_sessions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
    metric_code TEXT NOT NULL,
    level_critical_override NUMERIC,
    UNIQUE (session_id, user_id, metric_code)
);

CREATE INDEX IF NOT EXISTS idx_kpi_session_overrides_session ON public.kpi_session_member_overrides(session_id);

-- 8. Bảng kpi_snapshots: Snapshot kết quả tính toán cuối kỳ
CREATE TABLE IF NOT EXISTS public.kpi_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES public.kpi_sessions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
    metric_code TEXT NOT NULL,
    actual_count NUMERIC NOT NULL,
    tier_reached TEXT,
    base_manday NUMERIC NOT NULL DEFAULT 0,
    bonus_manday NUMERIC NOT NULL DEFAULT 0,
    snapshotted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kpi_snapshots_session ON public.kpi_snapshots(session_id);
CREATE INDEX IF NOT EXISTS idx_kpi_snapshots_user ON public.kpi_snapshots(user_id);

-- 9. Bảng kpi_session_pm_sync: Trạng thái đồng bộ PM Plane.so theo session
CREATE TABLE IF NOT EXISTS public.kpi_session_pm_sync (
    session_id UUID PRIMARY KEY REFERENCES public.kpi_sessions(id) ON DELETE CASCADE,
    auto_sync_enabled BOOLEAN NOT NULL DEFAULT false,
    last_synced_at TIMESTAMPTZ,
    last_sync_status TEXT
);

-- 10. Bảng kpi_session_pm_tasks: Chi tiết task đã sync sang PM theo externalKey
CREATE TABLE IF NOT EXISTS public.kpi_session_pm_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES public.kpi_sessions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
    metric_code TEXT NOT NULL,
    external_key TEXT NOT NULL UNIQUE,
    pm_task_id INTEGER,
    pm_task_code TEXT,
    pm_group_id INTEGER,
    last_synced_at TIMESTAMPTZ,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (session_id, user_id, metric_code)
);

CREATE INDEX IF NOT EXISTS idx_kpi_pm_tasks_session ON public.kpi_session_pm_tasks(session_id);
CREATE INDEX IF NOT EXISTS idx_kpi_pm_tasks_ext_key ON public.kpi_session_pm_tasks(external_key);

-- ==============================================================================
-- RLS & Grants
-- ==============================================================================

ALTER TABLE public.kpi_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kpi_templates_read_all ON public.kpi_templates;
CREATE POLICY kpi_templates_read_all ON public.kpi_templates FOR SELECT TO authenticated, anon USING (true);

ALTER TABLE public.kpi_template_levels ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kpi_template_levels_read_all ON public.kpi_template_levels;
CREATE POLICY kpi_template_levels_read_all ON public.kpi_template_levels FOR SELECT TO authenticated, anon USING (true);

ALTER TABLE public.kpi_template_bonus_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kpi_template_bonus_rules_read_all ON public.kpi_template_bonus_rules;
CREATE POLICY kpi_template_bonus_rules_read_all ON public.kpi_template_bonus_rules FOR SELECT TO authenticated, anon USING (true);

ALTER TABLE public.kpi_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kpi_sessions_read_all ON public.kpi_sessions;
CREATE POLICY kpi_sessions_read_all ON public.kpi_sessions FOR SELECT TO authenticated, anon USING (true);

ALTER TABLE public.kpi_session_allocations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kpi_session_allocations_read_all ON public.kpi_session_allocations;
CREATE POLICY kpi_session_allocations_read_all ON public.kpi_session_allocations FOR SELECT TO authenticated, anon USING (true);

ALTER TABLE public.kpi_session_levels ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kpi_session_levels_read_all ON public.kpi_session_levels;
CREATE POLICY kpi_session_levels_read_all ON public.kpi_session_levels FOR SELECT TO authenticated, anon USING (true);

ALTER TABLE public.kpi_session_member_overrides ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kpi_session_member_overrides_read_all ON public.kpi_session_member_overrides;
CREATE POLICY kpi_session_member_overrides_read_all ON public.kpi_session_member_overrides FOR SELECT TO authenticated, anon USING (true);

ALTER TABLE public.kpi_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kpi_snapshots_read_all ON public.kpi_snapshots;
CREATE POLICY kpi_snapshots_read_all ON public.kpi_snapshots FOR SELECT TO authenticated, anon USING (true);

ALTER TABLE public.kpi_session_pm_sync ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kpi_session_pm_sync_read_all ON public.kpi_session_pm_sync;
CREATE POLICY kpi_session_pm_sync_read_all ON public.kpi_session_pm_sync FOR SELECT TO authenticated, anon USING (true);

ALTER TABLE public.kpi_session_pm_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kpi_session_pm_tasks_read_all ON public.kpi_session_pm_tasks;
CREATE POLICY kpi_session_pm_tasks_read_all ON public.kpi_session_pm_tasks FOR SELECT TO authenticated, anon USING (true);

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        GRANT ALL ON public.kpi_templates TO service_role;
        GRANT ALL ON public.kpi_template_levels TO service_role;
        GRANT ALL ON public.kpi_template_bonus_rules TO service_role;
        GRANT ALL ON public.kpi_sessions TO service_role;
        GRANT ALL ON public.kpi_session_allocations TO service_role;
        GRANT ALL ON public.kpi_session_levels TO service_role;
        GRANT ALL ON public.kpi_session_member_overrides TO service_role;
        GRANT ALL ON public.kpi_snapshots TO service_role;
        GRANT ALL ON public.kpi_session_pm_sync TO service_role;
        GRANT ALL ON public.kpi_session_pm_tasks TO service_role;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        GRANT SELECT ON public.kpi_templates TO authenticated;
        GRANT SELECT ON public.kpi_template_levels TO authenticated;
        GRANT SELECT ON public.kpi_template_bonus_rules TO authenticated;
        GRANT SELECT ON public.kpi_sessions TO authenticated;
        GRANT SELECT ON public.kpi_session_allocations TO authenticated;
        GRANT SELECT ON public.kpi_session_levels TO authenticated;
        GRANT SELECT ON public.kpi_session_member_overrides TO authenticated;
        GRANT SELECT ON public.kpi_snapshots TO authenticated;
        GRANT SELECT ON public.kpi_session_pm_sync TO authenticated;
        GRANT SELECT ON public.kpi_session_pm_tasks TO authenticated;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        GRANT SELECT ON public.kpi_templates TO anon;
        GRANT SELECT ON public.kpi_template_levels TO anon;
        GRANT SELECT ON public.kpi_template_bonus_rules TO anon;
        GRANT SELECT ON public.kpi_sessions TO anon;
        GRANT SELECT ON public.kpi_session_allocations TO anon;
        GRANT SELECT ON public.kpi_session_levels TO anon;
        GRANT SELECT ON public.kpi_session_member_overrides TO anon;
        GRANT SELECT ON public.kpi_snapshots TO anon;
        GRANT SELECT ON public.kpi_session_pm_sync TO anon;
        GRANT SELECT ON public.kpi_session_pm_tasks TO anon;
    END IF;
END $$;

NOTIFY pgrst, 'reload schema';