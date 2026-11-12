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

## 3. Việc cần sửa — trạng thái sau phiên 2 (2026-11-12 tối)

1. ~~Mất tin khi backend tắt > ~7s~~ **ĐÃ SỬA**: hàng đợi bền vững `/data/outbox/*.json` (`manager.go`, kiểu
   `Webhook`). Mỗi sự kiện được ghi + fsync xuống đĩa trước, gửi lần lượt theo thứ tự, lỗi mạng/5xx thì thử lại mãi
   (backoff 1s → 60s) kể cả sau khi bridge restart; chỉ xoá khi backend trả 2xx, 4xx, hoặc tin quá 24h.
   Đã thử thật: tắt backend → bridge phát sự kiện → file nằm trong outbox, log "will retry" → bật backend → giao 200, DB cập nhật, outbox rỗng.
   Unit test: `TestWebhookOutbox`, `TestWebhookDropsExpiredAndRejected`.
2. ~~2 lỗi nhỏ ở `session.go`~~ **ĐÃ SỬA**: nhánh 415 tham gia cờ `e2eeConnecting`; 400/`CATRefreshError` từ client E2EE
   cũ bị bỏ qua (`dropCurrentE2EE`); LoggedOut 403/406 đặt `e2eeDisabled` (không đăng ký thiết bị mới nữa cho tới khi
   kết nối lại nick bằng cookie mới).
3. **Tuyến gửi cho người mới**: vẫn CHƯA thử với người chưa từng nhắn / chat cũ không mã hoá.
4. ~~Lỗi nhỏ backend/UI~~ **ĐÃ SỬA**: toast `loadThreads` cũ, `loadingMessages` kẹt, bong bóng lạc khung khi đổi thread
   lúc đang gửi (`MessengerInboxShell.tsx`, dùng request-id); gộp logic `_mark_sent` thành `_mark_sent_if_exists`.
5. **Giao diện web**: ĐÃ thử UI local (Next dev → backend local → bridge thật): danh sách nick, hội thoại, tin cũ,
   gửi tin từ UI tới nick chính (OK, khử trùng echo OK), tiếng Việt có dấu hiển thị đúng. Lưu ý: mở Facebook bằng
   trình duyệt với cùng nick sẽ làm cookie đổi → bridge báo `expired` (đúng) → phải kết nối lại nick bằng cookie mới.
6. **Gửi file/ảnh qua bridge**: chưa làm (hợp đồng chỉ có text).
7. Dọn: `.agy-tasks/` (không commit); 2 cơ chế cũ chỉ bỏ sau khi bridge chạy ổn trên production.

## 4. Hướng dẫn deploy

**Làm theo `docs/MESSENGER_BRIDGE_DEPLOY_PROD.md`** (từng bước, từ SSH tới kiểm tra sau deploy). Điểm chính:
- Merge vào `main` tự deploy production; migration 230 đã có trong bước migration của `deploy-app.yml`/`deploy-dev.yml`.
- Khoá `MESSENGER_BRIDGE_KEY` đặt trong `linkedin_group_crawler/.env` trên host (backend đọc qua `env_file`, bridge cũng
  đọc file này). KHÔNG đặt ở `.env` gốc: file đó được git theo dõi và bị `git checkout -- .env` mỗi lần deploy.
- Bridge build/chạy tay bằng `--profile messenger-bridge`; workflow không đụng tới nó.
- KHÔNG bật bridge trên host Dev: DB Dev chép đè từ production mỗi lần deploy → bridge Dev sẽ đăng nhập trùng nick thật.
- Bật khoá = server đăng nhập 24/7 vào MỌI nick `is_active` → xem danh sách trước (Phần 4 của tài liệu deploy).

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
