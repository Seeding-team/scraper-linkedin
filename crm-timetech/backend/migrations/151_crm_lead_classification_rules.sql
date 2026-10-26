-- Rule cau hinh phan loai Lead (SQL / Nuoi duong / Khong dat chuan) bang
-- checkbox - theo dung feedback WIP full-flow (markee_crm_v26_compact_
-- opportunity_name.html, man "Danh muc & cau hinh -> Dieu kien phan loai
-- Lead") + yeu cau rieng: chi Admin duoc sua (kiem o tang Python, xem
-- can_manage_lead_classification_rules() trong crm_permission_service.py).
--
-- Danh sach dieu kien la CO DINH (khong phai rule engine tuy y nhu quote
-- approval - migration 091), nen luu don gian bang 1 dong JSONB duy nhat
-- (singleton) thay vi tach bang con nhu quote_approval_rules - WIP cung
-- ghi ro "Chưa thiết kế chi tiết: versioning/audit log" nen KHONG lam rule
-- engine tong quat/luu lich su o day, tranh over-engineer thu chua ai yeu
-- cau.
--
-- KHONG apply migration nay len DB that (crm-cloudgate) cho toi khi duoc xac nhan rieng.

CREATE TABLE IF NOT EXISTS public.crm_lead_classification_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Singleton: chi 1 dong duy nhat ton tai (UNIQUE constraint tren 1 cot
    -- luon = true - pattern singleton-table pho bien cho Postgres).
    singleton BOOLEAN NOT NULL DEFAULT true,
    -- Object phang { "<condition_key>": true|false }. Danh sach key hop le
    -- do backend (crm_lead_rule_service.py) dinh nghia, khong check constraint
    -- o day de doi checkbox sau nay khong can migration moi.
    conditions JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_by UUID REFERENCES public.app_users(id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT crm_lead_classification_rules_singleton UNIQUE (singleton)
);

-- Seed dung 1 dong mac dinh, khop CHINH XAC voi default cua prototype V26
-- (tat ca checkbox SQL bat, 2/3 checkbox Nuoi duong bat, 1/2 checkbox Khong
-- dat chuan bat) - xem DEFAULT_CONDITIONS trong crm_lead_rule_service.py
-- (2 noi PHAI khop nhau, service co assert luc startup).
INSERT INTO public.crm_lead_classification_rules (singleton, conditions)
VALUES (
    true,
    '{
        "sql_product": true, "sql_interest": true, "sql_value": true,
        "sql_team": true, "sql_next": true, "sql_follow": true, "sql_fit": true,
        "nur_missing_value": true, "nur_missing_handoff": true, "nur_unknown_fit": false,
        "inv_fit": true, "inv_no_contact": false
    }'::jsonb
)
ON CONFLICT (singleton) DO NOTHING;
