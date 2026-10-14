-- 192_timetech_issuer_company.sql
-- Đăng ký TimeTech làm một Workspace (issuer) để thẻ "TimeTech" xuất hiện trên
-- trang Product & Services của MAIN (linkedin-crawler-ui), bên cạnh Markee /
-- CloudGate / SecurityZone.
--
-- Bối cảnh (xem Reports/MAIN_WORKSPACE_DISCOVERY_TIMETECH_INTEGRATION_READ_ONLY_2026-10-15.md):
-- 3 thẻ hiện có tồn tại vì migration 069 seed issuer rows MK/CG/SZ. Chưa từng
-- có row TT nào — vì vậy thẻ TimeTech không hiển thị. list_available_workspaces()
-- sinh thẻ động từ issuer row ACTIVE (không cần catalog group nào), nên chỉ cần
-- seed đúng 1 row là đủ. KHÔNG thêm bảng/cột, KHÔNG gán catalog, KHÔNG đổi
-- ownership dữ liệu nào khác.
--
-- Quy ước theo 069: ON CONFLICT idempotent, chỉ dùng cột đã tồn tại trong schema.
--
-- Lưu ý thứ tự áp migration (đã kiểm chứng trong local-db/apply-migrations.sh):
-- lượt MAIN chạy TRƯỚC lượt crm-module, mà cột instance của bảng này do
-- crm-module/migrations/001_add_instance_scoping.sql thêm vào (DEFAULT 'markee').
-- Trên DB CŨ (production + dev hiện tại) cột đã tồn tại -> INSERT bình thường.
-- Trên DB MỚI tinh (chưa chạy 001) -> block dưới self-skip an toàn (NOTICE),
-- chạy lại script lượt 2 sẽ seed. Nhờ đó migration không bao giờ INSERT thiếu
-- instance (nếu INSERT mà không có cột, 001 sau đó sẽ backfill 'markee' và TT
-- bị gộp nhầm vào Markee — trap đã được audit).
--
-- UNIQUE constraint hiện hành là (instance, code) — 001 mục 2.4 đã đổi từ
-- UNIQUE(code); vì thế ON CONFLICT target là (instance, code).
--
-- instance PHẢI được set tường minh 'timetech' (slug chuẩn theo README
-- crm-timetech §Multi-tenant); KHÔNG dựa vào DEFAULT 'markee'.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'quote_issuer_companies'
      AND column_name  = 'instance'
  ) THEN
    RAISE NOTICE '192: quote_issuer_companies.instance chưa tồn tại (instance-scoping 001 chưa áp) — bỏ qua an toàn; chạy lại apply-migrations.sh lần 2 để seed.';
    RETURN;
  END IF;

  -- legal_name/brand_name: placeholder theo nhãn hiệu trong repo (chưa có pháp
  -- nhân danh chính thức nào được chứng thực trong mã nguồn). Operator xác nhận
  -- tên đăng ký thật trước khi áp production (xem handoff doc).
  INSERT INTO public.quote_issuer_companies
    (code, legal_name, brand_name, instance, status, sort_order)
  VALUES
    ('TT', 'TimeTech', 'TimeTech', 'timetech', 'active', 3)
  ON CONFLICT (instance, code) DO NOTHING;
END $$;

-- KHÔNG tự sửa (repair) các row TT 'markee' cũ: under UNIQUE(instance, code)
-- row stray không chặn row đúng, và đổi instance của row đã được quotes/forms
-- tham chiếu là thay đổi ownership ngoài phạm vi approved. Handoff doc cung cấp
-- pre-check đọc để operator phát hiện tình huống này.
