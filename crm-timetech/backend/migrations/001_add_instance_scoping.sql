-- Multi-tenant hoá dữ liệu CRM: thêm cột `instance` (text) vào mọi bảng dữ
-- liệu CRM, để 1 DB self-host chung có thể phục vụ nhiều module CRM độc lập
-- (Markee tại crm.markeeai.com hôm nay, CloudGate hoặc brand khác sau này),
-- mỗi module chỉ đọc/ghi đúng dữ liệu của mình qua filter `instance` ở tầng
-- backend (crm-module/backend) — bảng KHÔNG dùng RLS để enforce (RLS hiện
-- đang mở toàn bộ cho `authenticated`, backend dùng service-role key nên bỏ
-- qua RLS hoàn toàn), enforce 100% ở tầng code Python.
--
-- AN TOÀN CHẠY LẠI NHIỀU LẦN (idempotent): mọi ALTER đều có IF NOT EXISTS,
-- mọi thay đổi constraint đều tự dò tên constraint hiện có (không đoán mù)
-- trước khi DROP, nên chạy lại lần 2 không lỗi/không mất dữ liệu.
--
-- Mặc định 'markee' cho toàn bộ dữ liệu hiện có — ĐÚNG THỰC TẾ vì tới thời
-- điểm viết migration này chỉ có 1 khách hàng dùng chung (Markee). Việc thêm
-- cột NOT NULL kèm DEFAULT không-volatile trên Postgres 11+ chỉ là thay đổi
-- metadata (không rewrite toàn bảng), nên an toàn/nhanh kể cả bảng lớn.
--
-- KHÔNG đụng tới `app_users`/`teams`/`member_of_teams`/`members` (nhân sự
-- dùng chung mọi instance theo quyết định của user) và không đụng tới
-- `crm_customer_migration_batches`/`crm_customer_migration_map` (chỉ là log
-- nội bộ 1 lần của đợt migrate dữ liệu cũ, không phải dữ liệu sống).

-- ============================================================================
-- 1) Thêm cột instance (TEXT NOT NULL DEFAULT 'markee') + index cho từng bảng
-- ============================================================================

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'customer_leads',
    'customer_lead_activity_log',
    'quote_forms',
    'quotes',
    'quote_items',
    'quote_activity_log',
    'service_catalog_items',
    'service_catalog_bundle_items',
    'quote_form_catalog_links',
    'quote_issuer_companies',
    'quote_telegram_log',
    'sales_assets',
    'contracts',
    'contract_activity_log',
    'contract_templates',
    'crm_customers',
    'crm_leads',
    'crm_contacts',
    'crm_request_idempotency',
    'categories'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS instance TEXT NOT NULL DEFAULT ''markee''',
      t
    );
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS idx_%s_instance ON public.%I (instance)',
      t, t
    );
  END LOOP;
END $$;

-- ============================================================================
-- 2) Đổi 4 unique constraint "duy nhất toàn hệ thống" thành "duy nhất theo instance"
--    (tự dò tên constraint/index hiện có, không đoán mù tên do Postgres tự sinh)
-- ============================================================================

-- 2.1) quote_forms.code: UNIQUE(code) -> UNIQUE(instance, code)
DO $$
DECLARE con_name text;
BEGIN
  SELECT tc.constraint_name INTO con_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
  WHERE tc.table_schema = 'public' AND tc.table_name = 'quote_forms'
    AND tc.constraint_type = 'UNIQUE' AND kcu.column_name = 'code'
  LIMIT 1;
  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.quote_forms DROP CONSTRAINT %I', con_name);
  END IF;
END $$;

ALTER TABLE public.quote_forms
  ADD CONSTRAINT quote_forms_instance_code_key UNIQUE (instance, code);

-- 2.2) quote_forms: unique partial index trên (is_default_template) -> (instance, is_default_template)
DO $$
DECLARE idx_name text;
BEGIN
  SELECT indexname INTO idx_name
  FROM pg_indexes
  WHERE schemaname = 'public' AND tablename = 'quote_forms'
    AND indexdef ILIKE '%UNIQUE%' AND indexdef ILIKE '%is_default_template%'
  LIMIT 1;
  IF idx_name IS NOT NULL THEN
    EXECUTE format('DROP INDEX IF EXISTS public.%I', idx_name);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS quote_forms_one_default_template_per_instance
  ON public.quote_forms (instance, is_default_template)
  WHERE is_default_template = true;

-- 2.3) quotes.quote_number: UNIQUE(quote_number) -> UNIQUE(instance, quote_number)
DO $$
DECLARE con_name text;
BEGIN
  SELECT tc.constraint_name INTO con_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
  WHERE tc.table_schema = 'public' AND tc.table_name = 'quotes'
    AND tc.constraint_type = 'UNIQUE' AND kcu.column_name = 'quote_number'
  LIMIT 1;
  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.quotes DROP CONSTRAINT %I', con_name);
  END IF;
END $$;

ALTER TABLE public.quotes
  ADD CONSTRAINT quotes_instance_quote_number_key UNIQUE (instance, quote_number);

-- 2.4) quote_issuer_companies.code: UNIQUE(code) -> UNIQUE(instance, code)
DO $$
DECLARE con_name text;
BEGIN
  SELECT tc.constraint_name INTO con_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
  WHERE tc.table_schema = 'public' AND tc.table_name = 'quote_issuer_companies'
    AND tc.constraint_type = 'UNIQUE' AND kcu.column_name = 'code'
  LIMIT 1;
  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.quote_issuer_companies DROP CONSTRAINT %I', con_name);
  END IF;
END $$;

ALTER TABLE public.quote_issuer_companies
  ADD CONSTRAINT quote_issuer_companies_instance_code_key UNIQUE (instance, code);

-- 2.5) contracts.contract_number: UNIQUE(contract_number) -> UNIQUE(instance, contract_number)
DO $$
DECLARE con_name text;
BEGIN
  SELECT tc.constraint_name INTO con_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
  WHERE tc.table_schema = 'public' AND tc.table_name = 'contracts'
    AND tc.constraint_type = 'UNIQUE' AND kcu.column_name = 'contract_number'
  LIMIT 1;
  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.contracts DROP CONSTRAINT %I', con_name);
  END IF;
END $$;

ALTER TABLE public.contracts
  ADD CONSTRAINT contracts_instance_contract_number_key UNIQUE (instance, contract_number);

-- ============================================================================
-- 3) Việc CHƯA làm trong migration này (xem crm-module/README.md mục
--    "TODO bắt buộc trước khi thêm instance mới"): 2 hàm SECURITY DEFINER
--    crm_convert_lead() và crm_create_customer_with_deal() vẫn insert không
--    kèm instance — do cột mới có DEFAULT 'markee' nên với Markee (instance
--    duy nhất hiện tại) hành vi vẫn đúng, KHÔNG cần sửa 2 hàm này ngay bây
--    giờ. Phải sửa lại (thêm tham số p_instance) trước khi bật instance thứ 2.
-- ============================================================================
