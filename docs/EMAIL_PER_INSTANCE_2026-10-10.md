# Tách cấu hình email SMTP/IMAP theo workspace (instance) — 2026-10-09/10

Trạng thái: **code đã sửa ở main + 3 clone, test xong; migration `183` đã viết, CHƯA chạy; chưa commit/push/deploy; chưa đổi App Password nào.**

## 1. Nguyên nhân
* Bảng `quote_delivery_channels` (migration 092) chỉ có `unique(channel_type)` và KHÔNG có cột `instance`; mọi truy vấn trong `quote_email_provider_service.py` chỉ lọc `channel_type='email'`.
* Markee, Cloudgate và SecurityZone dùng chung 1 DB ⇒ cùng đọc/ghi/gửi bằng MỘT cấu hình. Dòng hiện có (đã xác minh chỉ-đọc): `admin@markee.vn`, tên `MARKEE`, SMTP/IMAP ok ⇒ thuộc **markee**.
* Mọi luồng gửi email đều đi qua 1 điểm: `get_active_email_channel_for_sending()` (báo giá PDF/link, email bàn giao/re-assign Lead) và `send_test_email/test_*` ⇒ sửa tại đây là đủ.
* Instance: backend 1-workspace (main, cloudgate, securityzone) đọc `CRM_INSTANCE` từ env; **crm-module là backend đa-workspace**: 1 process phục vụ cả 3 domain, instance suy ra theo `Host` qua `ContextVar` (`settings.crm_instance` là property). Cả hai dạng đều là nguồn tin cậy phía server — client không gửi `instance`.

## 2. Thay đổi
* `quote_email_provider_service.py`: mọi truy vấn/ghi bị giới hạn theo `settings.crm_instance` (giữ đúng hoa/thường, vd `SECURITYZONE`); tự phát hiện cột `instance` (cache, kiểm tra lại mỗi 30s).
  * **Trước migration** (cột chưa có): chỉ workspace chủ dòng cũ (`QUOTE_EMAIL_LEGACY_INSTANCE`, mặc định `markee`) dùng dòng đó ⇒ Markee chạy như cũ; Cloudgate/SecurityZone = "Chưa kết nối", KHÔNG fallback, KHÔNG ghi (báo cần migration).
  * **Sau migration**: mỗi workspace một dòng riêng `unique(instance, channel_type)`; audit log cũng theo instance.
  * Chưa cấu hình ⇒ `get_active_email_channel_for_sending` chặn gửi với thông báo nêu rõ workspace; không bao giờ dùng email workspace khác.
  * Không trả/ghi log App Password; mã hoá Fernet và key `QUOTE_EMAIL_PROVIDER_ENCRYPTION_KEY` giữ nguyên.
* UI `QuoteEmailProviderSettings.tsx` (giữ thiết kế): nêu rõ workspace, trạng thái "Chưa kết nối", cảnh báo khi hệ thống chưa áp migration; không tự điền email.
* Quyền: vẫn `can_manage_quote_email_settings` (admin/leader) ở mọi endpoint. Lưu ý: ứng dụng chưa có ràng buộc "user thuộc workspace nào" (không có cột/kiểm tra) — cách ly dựa trên instance của backend phục vụ request.

## 3. Migration `183_quote_delivery_channels_per_instance.sql` (CHƯA CHẠY)
* Thêm `instance` cho `quote_delivery_channels` và `quote_delivery_channel_audit_log`, gán `markee` cho dòng hiện có, thay unique index. Idempotent.
* **Dry-run** (đã ghi trong đầu file): xem dòng cấu hình + số audit sẽ gán `markee` + index hiện tại.
* **Rollback**: `drop index quote_delivery_channels_instance_type_unique; create unique index quote_delivery_channels_type_unique on quote_delivery_channels(channel_type);` (chỉ khi mỗi channel_type còn ≤ 1 dòng — nếu Cloudgate/Zone đã lưu cấu hình riêng thì phải xoá/di chuyển các dòng đó trước), sau đó (tuỳ chọn) `alter table ... drop column instance`. Code tương thích cả trước/sau migration nên có thể rollback schema mà không cần rollback code.
* Thứ tự triển khai an toàn: (1) áp migration; (2) deploy code (hoặc ngược lại — code chạy được ở cả hai trạng thái); (3) admin Cloudgate/SecurityZone nhập email + App Password riêng.

## 4. Test
`tests/test_email_instance_isolation.py` (8 test, đã copy vào 3 clone; không gửi email thật, SMTP/IMAP giả lập): 3 workspace độc lập; chưa cấu hình ⇒ không gửi/không fallback; trước migration Markee giữ dòng cũ + workspace khác không ghi được; mật khẩu mã hoá & không trả về; test/gửi thử/email Lead dùng đúng tài khoản; instance lấy từ backend (request không có trường `instance`); endpoint chỉ admin/leader; hoạt động với backend đa-workspace (ContextVar). Đối chiếu DB thật chỉ-đọc: markee → ok (`admin@markee.vn`), cloudgate → not_configured/chặn gửi.
