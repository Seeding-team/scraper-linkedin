-- "Home instance" (site đã đăng ký) cho từng tài khoản app_users — phục vụ
-- yêu cầu: tài khoản non-admin đăng ký ở site nào, đăng nhập nhầm site khác
-- (domain khác trong INSTANCE_DOMAIN_MAP) sẽ tự động được chuyển hướng về
-- đúng site đã đăng ký thay vì đăng nhập được luôn (xem
-- app/modules/all_platform/services/auth_service.py — login_user/
-- login_with_google — và routers/auth.py).
--
-- Admin KHÔNG bị ràng buộc bởi cột này (luôn đăng nhập trực tiếp được ở cả
-- 3 site, ngoài cơ chế switcher riêng dành cho admin).
--
-- NULL = tài khoản tạo trước khi có tính năng này (hoặc admin) => KHÔNG bị
-- ràng buộc, đăng nhập ở site nào cũng được — giữ nguyên hành vi cũ, tránh
-- khoá nhầm tài khoản đang test/đang dùng thật.
--
-- An toàn chạy lại nhiều lần (IF NOT EXISTS).

ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS home_instance TEXT;
