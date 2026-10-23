# Viber Chat — hướng dẫn setup (2026-10-07)

Viber Chat dùng **Viber Bot API** (Viber không có API cho tài khoản cá nhân). Mỗi "tài khoản Viber"
trong tool = 1 Viber Bot. Khách nhắn bot -> Viber gọi webhook backend -> hiện trong tool; nhân viên trả
lời trong tool -> khách nhận trên Viber.

## 1. Tạo Viber Bot (lấy auth token)

1. Vào https://partners.viber.com, đăng nhập bằng số điện thoại có Viber (quét QR bằng app Viber).
2. **Create Bot Account**: điền tên, ảnh đại diện, mô tả, category... -> tạo.
3. Mở bot vừa tạo -> sao chép **Token** (dạng `4453b6ac12345678-e02c5f12174805f9-...`).
   Token là bí mật — chỉ dán vào tool, không gửi lên nhóm chat.
4. Lưu ý chi phí: Viber đã chuyển bot sang điều khoản thương mại (có phí duy trì hằng tháng cho bot
   doanh nghiệp) — công ty cần kiểm tra/đăng ký với Viber trước khi dùng thật.

## 2. Áp migration DB

Chạy toàn bộ file `linkedin_group_crawler/supabase/migrations/177_viber_module.sql` lên DB thật
(`seeding.db.markeeai.com` — prod và dev dùng chung). File chạy lại nhiều lần vẫn an toàn
(`IF NOT EXISTS`). Ví dụ trên host có DB:

```bash
docker exec -i <container-postgres> psql -U postgres -v ON_ERROR_STOP=1 < 177_viber_module.sql
```

Hoặc dán nội dung file vào SQL Editor của Supabase Studio.

Bucket lưu ảnh/tệp `viber-media` (public) — backend tự tạo lần đầu gửi/nhận media; muốn tạo tay:

```sql
INSERT INTO storage.buckets (id, name, public)
VALUES ('viber-media', 'viber-media', true)
ON CONFLICT (id) DO UPDATE SET public = true;
```

Kiểm tra sau khi áp:

```sql
SELECT to_regclass('public.viber_accounts'), to_regclass('public.viber_dialogs'), to_regclass('public.viber_messages');
SELECT id, public FROM storage.buckets WHERE id = 'viber-media';
```

## 3. Biến môi trường backend (`linkedin_group_crawler/.env`)

```env
# URL HTTPS công khai của app (nginx proxy /api -> backend). Bắt buộc https://, Viber không gọi http/localhost.
VIBER_WEBHOOK_BASE_URL=https://seeding.markeeai.com
# (tuỳ chọn) đổi tên bucket media, mặc định viber-media
# VIBER_SUPABASE_STORAGE_BUCKET=viber-media
```

Nếu đã có `PUBLIC_APP_BASE_URL=https://seeding.markeeai.com` thì có thể bỏ qua `VIBER_WEBHOOK_BASE_URL`.

Yêu cầu thêm: `SUPABASE_URL` của backend phải là URL **HTTPS truy cập được từ Internet** (vd
`https://seeding.db.markeeai.com`) — Viber tải ảnh/tệp nhân viên gửi qua link public của Storage. Nếu
`SUPABASE_URL` là địa chỉ nội bộ (http://10.x / tên container) thì gửi text vẫn được nhưng gửi ảnh/tệp lỗi.

Nginx (`nginx-router/nginx.conf`) không cần sửa: `/api/` đã proxy sang backend, `client_max_body_size 50M`.

## 4. Deploy

Merge nhánh `feat/viber-chat` vào `main` -> chạy workflow **"Deploy App (Production)"** (hoặc rebuild tay
`docker compose build frontend backend && docker compose up -d frontend backend`). Nhớ cập nhật `.env` (bước 3)
trước khi `up`.

## 5. Kết nối & test

1. Vào **Quản lý kênh & CSKH -> Viber Chat -> Kết nối Viber Bot mới**, dán token -> **Kết nối**.
   Thành công: thẻ bot hiện "Đã kết nối". Lỗi "Webhook URL không hợp lệ" = bước 3 chưa đúng / domain chưa HTTPS.
2. Trên điện thoại mở bot: `viber://pa?chatURI=<bot_uri>` (bot_uri hiện dưới tên bot, dạng `@...`), hoặc tìm tên bot
   trong Viber -> nhắn "xin chào".
3. Trong tool hội thoại xuất hiện ngay -> trả lời text, dán link, gửi ảnh, gửi tệp PDF -> kiểm tra trên điện thoại.
   Dấu ✓ đổi sang "đã nhận/đã xem" khi khách nhận/đọc.

## 6. Test ở máy local (tuỳ chọn)

Viber cần HTTPS công khai -> mở tunnel tới backend (port 8000):

```bash
ngrok http 8000
```

Đặt `VIBER_WEBHOOK_BASE_URL=https://<id>.ngrok-free.app` trong `.env` backend, khởi động lại backend, rồi kết
nối bot. Lưu ý: 1 bot chỉ có 1 webhook — kết nối bot ở local sẽ "giật" webhook khỏi production; test xong bấm
**Kết nối lại** trên production (hoặc dùng bot riêng để test).

## Giới hạn của Viber Bot API

- Không đọc được lịch sử cũ; hội thoại chỉ xuất hiện khi khách nhắn/mở chat với bot sau khi kết nối.
- Chỉ gửi được cho người đã nhắn hoặc theo dõi bot; không sửa/xoá/ghim tin.
- Ảnh > 1MB gửi dạng tệp; video mp4 tối đa 26MB; tệp tối đa 50MB; text tối đa 7000 ký tự/tin (tool tự chia).
