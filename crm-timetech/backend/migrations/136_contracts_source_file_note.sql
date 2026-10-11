-- Contract tab redesign (mockup "Ghi nhận hợp đồng có sẵn") - AUDIT truoc khi
-- code (gate yeu cau ro trong task): `contracts` HIEN KHONG co cot nao cho:
-- - source (Tao trong CRM / Ben ngoai)
-- - file/attachment URL
-- - note
-- Xac minh that qua live schema (select * tren 1 dong that): id,
-- contract_number, deal_id, quote_id, title, template_type, status,
-- contract_value, currency, start_date, end_date, signed_at, payment_terms,
-- clauses (jsonb), ai_*, version, created_by, updated_by, created_at,
-- updated_at, owner_id, progress_percent, payment_collected_percent,
-- manual_customer_name, instance, customer_id - KHONG co source/file_url/
-- note. Day la migration toi thieu duoc bao truoc khi implement UI can no.
--
-- `source` mac dinh 'crm' cho MOI hang cu (backward-safe: cac Contract da
-- tao qua wizard/manual truoc gio deu coi la "Tạo trong CRM", dung voi thuc
-- te - chua tung co luong "ghi nhan ben ngoai" nao ton tai truoc day).

ALTER TABLE public.contracts
    ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'crm' CHECK (source IN ('crm', 'external')),
    ADD COLUMN IF NOT EXISTS file_url TEXT,
    ADD COLUMN IF NOT EXISTS note TEXT;
