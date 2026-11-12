# Messenger nick cá nhân — nhận & gửi tin 24/7 qua `messenger-bridge` (bàn giao 2026-11-12)

Mục tiêu: nick Facebook **cá nhân** đã kết nối trên trang "Hộp thư Messenger" nhận được tin (kể cả chat
mã hoá đầu-cuối E2EE, mặc định của Messenger 1-1) và gửi được tin từ Seeding, **không cần bật máy/trình
duyệt** của chủ nick. Ngoài phạm vi: KPI, gửi hàng loạt, bot, lịch sử tin cũ.

Nhánh: `claude/messenger-feature-testing-b43be2`. Chưa merge, chưa deploy, migration chưa áp DB thật.

## 1. Kiến trúc

```
Extension (lấy cookie)        Web (Hộp thư Messenger, SSE)
        |                               ^
        v                               |
Backend FastAPI  -- POST connect/send -->  messenger-bridge (Go, messagix + whatsmeow) <--> Facebook
        ^                                        |
        +------ POST /api/all-platform/messenger/webhook/bridge (X-Bridge-Key) ----------+
                      lưu fb_messenger_accounts / threads / messages
```

- `messenger-bridge/` là service Go riêng (giấy phép AGPL-3.0 của mautrix-meta → chạy **tiến trình riêng**,
  không nhúng vào backend). Mỗi nick 1 phiên messagix (LightSpeed) + 1 client whatsmeow (E2EE).
  Lưu `/data/accounts.json` (cookie, 0600) + `/data/e2ee.db` (thiết bị E2EE). Hợp đồng HTTP: `messenger-bridge/README.md`.
- Backend: `bridge_client.py` (gọi bridge), `POST /accounts` → connect, `POST /send` → bridge, webhook
  `/webhook/bridge` (router riêng, không cần đăng nhập, xác thực `X-Bridge-Key` bằng `hmac.compare_digest`),
  khởi động lại backend → tự gửi connect lại cho mọi nick `is_active`. Bridge tắt (biến môi trường rỗng) → giữ hành vi cũ.
- Frontend: nút "Tin nhắn mới" theo UID/link, nhãn trạng thái nick.
- Mọi API Messenger khác giờ **bắt đăng nhập** (trước đó hở hoàn toàn).
- Migration **`230_fb_messenger_bridge.sql`**: cột `fb_message_id` + unique index chống trùng.

## 2. Đã kiểm chứng (thật, không chỉ test giả)

Môi trường: máy dev, DB thử riêng (Postgres + PostgREST trong Docker, đã áp 221 + 230), backend uvicorn,
bridge container, nick clone thật + nick chính thật.

| Hạng mục | Kết quả |
|---|---|
| Đăng nhập bằng cookie (c_user, xs, datr) từ IP nhà | OK, không checkpoint, không đòi PIN |
| Đăng ký thiết bị E2EE mới, dùng lại sau khi restart container | OK |
| Nhận tin E2EE → giải mã → webhook → lưu DB → phát SSE | OK |
| Gửi tin qua `/send` → bridge → Facebook (nick chính nhận được) | OK |
| Echo tin vừa gửi không tạo dòng trùng | OK |
| Tên khách / tên cuộc chat | OK (sau khi sửa) |
| Unit test: Go `build/vet/test -race`, pytest `tests/test_messenger_bridge.py` | 13 passed |

**Bài học quan trọng:** `go.mau.fi/libsignal` phải ≥ commit `7735375` (2026-11-04, "Use raw received bytes
for SignalMessage MAC verification"). Bản cũ v0.2.2 làm **mọi** tin E2EE đến lỗi "mismatching MAC" vì Messenger
gửi thêm trường protobuf mới. Đã ghi chú trong `messenger-bridge/go.mod` — đừng hạ version khi cập nhật mautrix-meta.

## 3. Việc cần sửa (theo thứ tự ưu tiên)

1. **Mất tin khi backend tắt > ~7s**: bridge chỉ retry webhook 3 lần (1s/2s/4s) rồi bỏ. Đã thấy thật khi restart
   backend local. Sửa: hàng đợi bền vững trên đĩa (`/data/outbox/*.json`) + retry đến khi backend trả 2xx (giới hạn
   tuổi tin, ví dụ 24h); hoặc `SynchronousAck` trả về kết quả giao webhook để whatsmeow tự nhận lại.
2. **2 lỗi nhỏ ở `session.go`** (review Opus vòng cuối):
   - Nhánh xử lý lỗi 415 chưa tham gia cờ `e2eeConnecting` → có thể đăng ký E2EE trùng khi trùng thời điểm reconnect.
     Sửa: `retry := !s.e2eeRetry && s.e2ee == e2ee && !s.e2eeConnecting && s.cli != nil`; khi reset đặt luôn
     `s.e2eeConnecting = true`.
   - 400 / `CATRefreshError` từ client E2EE cũ (đã bị thay) vẫn kích hoạt reconnect toàn phần. Sửa: chỉ xử lý khi
     `s.e2ee == e2ee`, ngược lại bỏ qua.
   - (tuỳ chọn) Sau LoggedOut 403/406 (nick bị khoá/cấm) đặt `e2eeDisabled` để không đăng ký thiết bị mới mỗi lần reconnect.
3. **Tuyến gửi cho người mới** (`session.go`, comment `shortcut:`): bridge đoán E2EE cho peer chưa biết, lỗi thì
   fallback LightSpeed. Đã chạy với nick chính (chat E2EE), **chưa thử** với người chưa từng nhắn / chat cũ không mã hoá.
4. **Lỗi nhỏ backend/UI chưa làm** (NIT từ review): toast lỗi của `loadThreads` cũ vẫn hiện sau khi đổi nick;
   `loadingMessages` có thể kẹt true khi chuyển sang nick không có hội thoại; bong bóng tin lạc khung khi đổi thread
   lúc đang upload ảnh; gộp hàm `_mark_sent` bị lặp trong `fb_messenger_service.py`.
5. **Chưa thử giao diện web** với toàn luồng (mới thử qua API). Cần: chạy frontend local trỏ backend local, đăng nhập,
   xem tin hiện realtime, gửi tin từ UI (kiểm tra dấu tiếng Việt — lần thử bằng curl trên Git Bash bị mất dấu do
   lệnh thử, không phải do app).
6. **Gửi file/ảnh qua bridge**: hợp đồng hiện chỉ gửi text; nhận đính kèm chỉ ghi "(Tệp đính kèm)".
7. Dọn: `.agy-tasks/` (đặc tả giao việc cho agent, không commit); 2 cơ chế cũ có thể bỏ khi bridge chạy ổn:
   đồng bộ qua extension (`extensions/api-facebook-get-extension/messenger-sync.js`) và gửi cookie trực tiếp
   (`send_message_human_like` nhánh legacy).

## 4. Chuẩn bị deploy (CHƯA làm — làm ở phiên sau, theo đúng thứ tự)

> Không ghi IP / mật khẩu host vào repo. Thông tin truy cập host lấy từ người dùng ở phiên làm việc.

1. **Merge** nhánh vào `main` (hoặc `dev` trước để thử trên `dev.seeding.markeeai.com`).
2. **Áp migration `230_fb_messenger_bridge.sql`** lên DB dev rồi DB production (idempotent, chạy lại an toàn).
   Có thể thêm `-f /repo/linkedin_group_crawler/supabase/migrations/230_fb_messenger_bridge.sql` vào bước
   "Ap dung migration database 221..229" của `.github/workflows/deploy-app.yml` (và bước tương ứng của `deploy-dev.yml`).
   Kiểm tra sau khi áp: `GET {SUPABASE_URL}/rest/v1/fb_messenger_messages?select=fb_message_id&limit=1` trả 200.
3. **Sinh khoá bridge** riêng cho từng môi trường (≥ 32 ký tự ngẫu nhiên), đặt trong `.env` của host
   (không commit): production `MESSENGER_BRIDGE_KEY`, dev `MESSENGER_BRIDGE_DEV_KEY`.
   **Chỉ đặt khoá SAU khi migration 230 đã áp** — đặt trước thì webhook lỗi 500 và mất tin.
4. **Build + chạy bridge** trên host (service có `profiles: ["messenger-bridge"]` nên `docker compose up` thường
   KHÔNG tự chạy nó):
   - production: `docker compose --profile messenger-bridge build messenger-bridge && docker compose --profile messenger-bridge up -d messenger-bridge`
   - dev: `docker compose -f docker-compose.dev.yml --profile messenger-bridge build messenger-bridge-dev && docker compose -f docker-compose.dev.yml --profile messenger-bridge up -d messenger-bridge-dev`
   - Thêm 2 bước này vào `deploy-app.yml` / `deploy-dev.yml` (sau bước build frontend/backend).
   Dev và production dùng service/volume/khoá **khác nhau** (dev: `messenger-bridge-dev`, volume
   `scraper-linkedin_messenger-bridge-dev-data`) vì 2 file compose cùng mạng `seeding-net` — đừng gộp lại.
5. **Recreate backend** để nạp `MESSENGER_BRIDGE_URL`/`MESSENGER_BRIDGE_KEY`.
6. **Proxy**: IP server là IP datacenter → rủi ro checkpoint. Mỗi nick nên có 1 proxy dân cư VN cố định
   (`proxy_url` khi kết nối nick). Thử trước với nick clone.
7. **Kiểm tra sau deploy**: `docker logs` bridge thấy `messenger-bridge started` + `E2EE socket connected`;
   `/webhook/bridge` không khoá → 401; kết nối nick clone qua UI → status `connected`; nhắn 2 chiều; xem bảng
   `fb_messenger_messages` có `fb_message_id`.
8. Rollback: tắt bridge (`docker compose --profile messenger-bridge stop messenger-bridge`) + xoá
   `MESSENGER_BRIDGE_KEY` khỏi `.env` backend → backend quay về hành vi cũ. Migration 230 chỉ thêm cột, không cần gỡ.

## 5. Chạy thử lại trên máy (để kiểm tra trước khi deploy)

- Build: `docker build -t messenger-bridge:poc messenger-bridge`
- PoC độc lập (không cần backend): xem `messenger-bridge/README.md` mục 3 (cookie đặt ở
  `messenger-bridge/cookies.txt`, đã gitignore; người dùng tự đặt).
- Toàn luồng: DB thử Postgres + PostgREST (gateway `/rest/v1/` → PostgREST, init: roles anon/authenticated/
  service_role + bảng `app_users` tối thiểu + migration 221 + 230), bridge container
  (`BRIDGE_KEY`, `BACKEND_WEBHOOK_URL=http://host.docker.internal:8000/api/all-platform/messenger/webhook/bridge`),
  backend uvicorn với `SUPABASE_URL` trỏ DB thử, `MESSENGER_BRIDGE_URL=http://127.0.0.1:8090`, tắt mọi worker
  (`DISABLE_*=1`). Trên Git Bash nhớ `MSYS_NO_PATHCONV=1` cho `docker run -v ...:/data`.

## 6. File chính

- `messenger-bridge/` (main.go, cmd/poc, internal/bridge/{session,manager,http,payload,cookies}.go, Dockerfile, README.md)
- `linkedin_group_crawler/app/modules/facebook/src/modules/messenger/{router/index.py, services/bridge_client.py, services/fb_messenger_service.py, services/fb_realtime_listener.py}`
- `linkedin_group_crawler/app/main.py` (tự kết nối lại khi khởi động), `app/core/config.py`, `app/modules/all_platform/router.py`, `.../api_router/index.py`
- `linkedin_group_crawler/supabase/migrations/230_fb_messenger_bridge.sql`, `linkedin_group_crawler/tests/test_messenger_bridge.py`
- `linkedin-crawler-ui/components/all-platform/messenger/MessengerInboxShell.tsx`, `linkedin-crawler-ui/services/facebook-messenger.service.ts`
- `docker-compose.yml`, `docker-compose.dev.yml`, `linkedin_group_crawler/.env.example`
- Dự phòng cũ: `extensions/api-facebook-get-extension/{messenger-sync.js, background.js, manifest.json}` (đồng bộ qua DOM, bản 2.2)
