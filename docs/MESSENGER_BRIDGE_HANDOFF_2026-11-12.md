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

## 4. Hướng dẫn deploy (làm đúng thứ tự)

> Không ghi IP / mật khẩu host vào repo. Thông tin truy cập host lấy từ người dùng ở phiên làm việc.
> Làm trên **dev** trước (`dev.seeding.markeeai.com`), chạy ổn 1–2 ngày rồi mới làm production.

**Bước 0 — Commit + merge.** Commit nhánh `claude/messenger-feature-testing-b43be2` (KHÔNG commit `.agy-tasks/`,
`messenger-bridge/cookies.txt`), merge vào `dev` (thử) rồi `main`. Chạy workflow "Deploy Dev"/"Deploy App" như mọi lần
→ frontend + backend mới lên. Lúc này bridge chưa chạy và khoá chưa đặt → backend giữ hành vi cũ, an toàn.

**Bước 1 — Áp migration 230** (idempotent) lên DB của môi trường đó, từ host:
```bash
docker run --rm -v "$PWD:/repo" postgres:alpine psql "$DB_URL" -v ON_ERROR_STOP=1   -f /repo/linkedin_group_crawler/supabase/migrations/230_fb_messenger_bridge.sql
```
(`$DB_URL` lấy giống chuỗi trong workflow). Kiểm tra: `GET {SUPABASE_URL}/rest/v1/fb_messenger_messages?select=fb_message_id&limit=1`
(header service role) trả **200**. Nếu không 200 thì DỪNG — đừng làm bước 2.
Lưu ý: các bước migration trong workflow có `|| true` (nuốt lỗi) nên đừng chỉ dựa vào workflow cho migration này.
Workflow Deploy Dev còn đồng bộ DB Main → Dev, nên sau mỗi lần chạy nó phải áp lại 230 lên Dev (hoặc thêm `-f .../230_...sql`
vào bước "Ap dung migration" của cả 2 workflow).

**Bước 2 — Khoá bridge** (≥ 32 ký tự ngẫu nhiên, mỗi môi trường 1 khoá, tạo bằng `openssl rand -hex 32`), thêm vào `.env`
cạnh file compose trên host (không commit): production `MESSENGER_BRIDGE_KEY=...`, dev `MESSENGER_BRIDGE_DEV_KEY=...`.

**Bước 3 — Build + chạy bridge** (service có `profiles`, `docker compose up` thường không tự chạy nó):
- production:
  `docker compose --profile messenger-bridge build messenger-bridge && docker compose --profile messenger-bridge up -d messenger-bridge`
- dev:
  `docker compose -f docker-compose.dev.yml --profile messenger-bridge build messenger-bridge-dev && docker compose -f docker-compose.dev.yml --profile messenger-bridge up -d messenger-bridge-dev`

Dev và production dùng service/volume/khoá **khác nhau** (cùng mạng `seeding-net`) — đừng gộp. Volume `/data` giữ
`accounts.json` (cookie), `e2ee.db` (thiết bị E2EE) và `outbox/` (tin chưa giao) — **không xoá volume** khi redeploy.

**Bước 4 — Recreate backend** để nạp khoá: `docker compose up -d --no-deps --force-recreate backend`
(dev: `docker compose -f docker-compose.dev.yml up -d --no-deps --force-recreate backend-dev`).

**Bước 5 — Kiểm tra:**
- `docker logs seeding-messenger-bridge` có `messenger-bridge started`.
- Từ host: `docker compose exec backend curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:8000/api/all-platform/messenger/webhook/bridge` → **401** (không khoá).
- Trên UI "Hộp thư Messenger": thêm nick **clone** (proxy dân cư VN cố định ở `proxy_url` — IP server là datacenter, dễ checkpoint)
  → trạng thái `connected`, log bridge có `E2EE socket connected`.
- Nhắn 2 chiều với nick chính; bảng `fb_messenger_messages` có `fb_message_id`, không dòng trùng.
- Sau khi kết nối nick: **không mở Facebook bằng trình duyệt với nick đó** (cookie đổi → bridge `expired`).

**Bước 6 — Đưa vào workflow (tuỳ chọn, sau khi chạy tay ổn):** thêm bước 3 vào `deploy-app.yml` / `deploy-dev.yml`
sau bước "Ap dung container moi" / "Khoi chay stack dev".

**Rollback:** `docker compose --profile messenger-bridge stop messenger-bridge` + xoá `MESSENGER_BRIDGE_KEY` khỏi `.env`
+ recreate backend → hành vi cũ. Migration 230 chỉ thêm cột, không cần gỡ. Tin còn trong `outbox/` sẽ được giao khi bật lại bridge (trong 24h).

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
