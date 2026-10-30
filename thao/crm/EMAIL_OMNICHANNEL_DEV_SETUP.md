# Email Omnichannel — cấu hình và nghiệm thu Dev

## Cấu hình bắt buộc

1. Chạy theo thứ tự migrations `201_omnichannel_email_inbox.sql`, `202_omnichannel_email_accounts.sql` và
   `203_omnichannel_email_oauth_hardening.sql` trên Supabase Dev.
2. Đặt cùng `QUOTE_EMAIL_PROVIDER_ENCRYPTION_KEY` đã dùng để mã hóa credential trong `quote_delivery_channels`.
3. Cấu hình riêng từng workspace trong Email Provider Admin:
   - địa chỉ account/sender;
   - IMAP host, port, SSL/TLS, username, password hoặc app password;
   - SMTP host, port, STARTTLS/SSL, username, password hoặc app password;
   - trạng thái enabled và health check IMAP/SMTP đạt.
4. Dev backend:
   - `EMAIL_IMAP_SYNC_ENABLED=1`;
   - `EMAIL_IMAP_SYNC_INTERVAL_SECONDS=60` (hoặc giá trị phù hợp);
   - `EMAIL_IMAP_SYNC_BATCH_SIZE=100`;
   - `EMAIL_ALLOW_SIMULATE_INCOMING=0` khi nghiệm thu email thật.
5. Gmail OAuth backend (secret store/env, không đưa vào image hoặc git):
   - `GMAIL_OAUTH_CLIENT_ID`;
   - `GMAIL_OAUTH_CLIENT_SECRET`;
   - `GMAIL_OAUTH_STATE_SECRET` (random secret riêng, đủ mạnh);
   - `GMAIL_OAUTH_ALLOWED_ORIGINS` chỉ chứa origin của chính stack: Seeding/Main =
     `https://seeding.markeeai.com`, CRM Markee = `https://crm.markee.vn`, CloudGate =
     `https://crm.getcloudgate.com`, SecurityZone = `https://crm.securityzone.vn`, Timetech =
     `https://crm.timetech.vn`.
6. Frontend build arg/env trên cả 5 Docker stack: `NEXT_PUBLIC_GMAIL_OAUTH_CLIENT_ID` bằng đúng client ID Gmail.
   Đây là biến build-time nên phải rebuild frontend từ source sau khi cấu hình.
7. Google Cloud Web application:
   - Authorized JavaScript origins: đúng 5 HTTPS origins ở mục 5, không có dấu `/` cuối;
   - OAuth popup không cần Authorized redirect URI;
   - bật Gmail API, dùng scope `gmail.modify`, `openid`, `email`, `profile`;
   - thêm mailbox Dev vào OAuth Test Users khi consent screen còn ở chế độ Testing.
8. Cung cấp một mailbox đích độc lập để xác nhận thư reply thực sự được nhận và attachment mở được.

Không ghi credential vào git, tài liệu hoặc Docker image. Dùng env/secret của từng clone và cấu hình mã hóa trong DB.
`QUOTE_EMAIL_PROVIDER_ENCRYPTION_KEY` phải nhất quán giữa các stack cùng đọc một database; nếu đổi khóa, token cũ sẽ
không giải mã được. Seeding/Main và CRM Markee cùng `CRM_INSTANCE=markee`, vì vậy giữ cùng dữ liệu và dùng sync lease
trong migration 203; không bật hai cơ chế scheduler khác nhau ngoài lease.
`GMAIL_OAUTH_STATE_SECRET` chỉ ở backend, không đưa sang frontend. Dùng một secret ngẫu nhiên riêng cho mỗi stack
(các replica của cùng một stack phải dùng cùng secret); không tái sử dụng Client Secret làm State Secret.

## Ma trận nghiệm thu

Thực hiện riêng cho `markee`, `cloudgate`, `securityzone`, `timetech`: gửi mail thật vào account → chờ IMAP sync → mở/đánh dấu
đã đọc → reply kèm attachment → xác minh thư tại mailbox đích → restart backend/frontend → kiểm tra thread, message,
attachment và read state vẫn còn. Đồng thời thử truy cập thread của workspace khác và phải nhận 404/không có dữ liệu.

Nếu thiếu bất kỳ credential, migration hoặc mailbox xác minh nào, kết quả phải là **BLOCKED**, không dùng simulate/mock
để thay thế bằng chứng E2E.
