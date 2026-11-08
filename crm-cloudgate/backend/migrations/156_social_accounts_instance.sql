-- Port "Quản lý tài khoản / Tài khoản mạng xã hội" sang clone (feedback mentor
-- 2026-10-03). Bảng `social_accounts`/`platforms` đã tồn tại SẴN trên DB self-
-- host dùng chung (do app seeding gốc + crm-module tạo từ trước, 2 bên đó
-- CHIA SẺ cùng tenant "markee" nên dùng thẳng, không cần cột instance) —
-- nhưng crm-cloudgate/crm-securityzone là tenant RIÊNG, phải cô lập dữ liệu
-- (không được thấy tài khoản mạng xã hội của brand khác).
--
-- An toàn chạy lại nhiều lần (IF NOT EXISTS / DEFAULT). Backfill tự động:
-- các row cũ (của app seeding gốc/crm-module) sẽ nhận instance='markee' qua
-- DEFAULT của ALTER TABLE — đúng vì chúng thực sự thuộc tenant markee.

ALTER TABLE public.social_accounts
    ADD COLUMN IF NOT EXISTS instance text NOT NULL DEFAULT 'markee';

CREATE INDEX IF NOT EXISTS idx_social_accounts_instance
    ON public.social_accounts (instance);

COMMENT ON COLUMN public.social_accounts.instance IS
    'Brand sở hữu tài khoản mạng xã hội này (markee/cloudgate/SECURITYZONE...) — lọc theo settings.crm_instance ở mọi get/list/update/delete, stamp lúc create. Bảng platforms KHÔNG cần cột này (danh mục dùng chung mọi brand).';
