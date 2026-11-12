# messenger-bridge

Dịch vụ cầu nối Facebook Messenger cá nhân viết bằng Go, duy trì kết nối 24/7 cho từng tài khoản Facebook (bao gồm cả hội thoại thường qua LightSpeed/MQTT và hội thoại mã hoá đầu cuối E2EE qua `go.mau.fi/mautrix-meta/pkg/messagix` + `go.mau.fi/whatsmeow`). Dịch vụ chạy độc lập trong mạng nội bộ Docker, nhận lệnh từ Backend FastAPI và đẩy tin nhắn/trạng thái mới về webhook của Backend.

---

## 1. Biến môi trường (Environment Variables)

| Biến | Bắt buộc | Mặc định | Mô tả |
|---|---|---|---|
| `BRIDGE_KEY` | **Có** | – | Khóa bí mật dùng chung với Backend (`MESSENGER_BRIDGE_KEY`). Dùng để xác thực 2 chiều qua header `X-Bridge-Key` (so sánh hằng thời gian). |
| `BRIDGE_LISTEN` | Không | `:8090` | Địa chỉ và cổng lắng nghe HTTP của dịch vụ. |
| `BACKEND_WEBHOOK_URL` | Khuyến nghị | `""` | URL webhook của Backend nhận sự kiện tin nhắn và trạng thái (`http://backend:8000/api/all-platform/messenger/webhook/bridge`). Nếu để trống, tin nhắn đến sẽ bị bỏ qua. |
| `BRIDGE_DATA_DIR` | Không | `/data` | Thư mục lưu trữ cơ sở dữ liệu thiết bị E2EE (`e2ee.db`) và danh sách phiên tài khoản (`accounts.json` với quyền `0600`). |

> **Bảo mật:** Dịch vụ tuyệt đối không ghi giá trị cookie hay `BRIDGE_KEY` ra log. Khi khởi động lại container, tất cả tài khoản trong `/data/accounts.json` sẽ được tự động kết nối lại.

---

## 2. Hợp đồng HTTP (HTTP Contract)

Mọi endpoint (trừ `GET /health`) đều yêu cầu header `X-Bridge-Key: <BRIDGE_KEY>`.

### Chiều Backend -> Bridge

| Method | Path | Body | Phản hồi |
|---|---|---|---|
| `GET` | `/health` | – | `{"ok":true,"accounts":N}` (không yêu cầu `X-Bridge-Key`) |
| `POST` | `/accounts/{account_id}/connect` | `{"fb_user_id":"...","cookie":"k=v; k2=v2","user_agent":"...","proxy_url":"..."}` | `{"ok":true,"status":"connected"}` hoặc `{"ok":false,"status":"checkpoint\|expired\|error","error":"..."}` |
| `DELETE` | `/accounts/{account_id}` | – | `{"ok":true}` |
| `GET` | `/accounts/{account_id}/status` | – | `{"ok":true,"status":"connected\|connecting\|disconnected\|checkpoint\|expired","e2ee":true\|false,"error":null}` |
| `POST` | `/accounts/{account_id}/send` | `{"recipient_id":"<fb uid số>","text":"...","client_msg_id":"..."}` | `{"ok":true,"message_id":"...","e2ee":true\|false}` hoặc `{"ok":false,"error":"..."}` |

> **Lưu ý về `client_msg_id`:** Trường `client_msg_id` trong body `/send` được cố ý bỏ qua (ID ngẫu nhiên 19 chữ số của backend có thể tràn số int64 và không phải là Facebook OTID hợp lệ); bridge tự sinh OTID chuẩn qua `methods.GenerateEpochID()`.

### Chiều Bridge -> Backend (`POST $BACKEND_WEBHOOK_URL`)

Bridge gửi kèm header `X-Bridge-Key: <BRIDGE_KEY>`. Mỗi sự kiện được ghi xuống đĩa trước (`$BRIDGE_DATA_DIR/outbox/*.json`) rồi gửi lần lượt theo thứ tự; gặp lỗi mạng hoặc HTTP 5xx thì thử lại mãi (backoff 1s → tối đa 60s), kể cả sau khi bridge khởi động lại, cho tới khi backend trả 2xx. Sự kiện bị backend trả 4xx hoặc quá 24 giờ thì bỏ (ghi log):

- **Sự kiện `message`:**
  ```json
  {
    "type": "message",
    "account_id": "...",
    "peer_id": "<fb uid đối phương>",
    "peer_name": "...|null",
    "message_id": "<id duy nhất của FB>",
    "text": "...",
    "is_self": false,
    "e2ee": true,
    "timestamp_ms": 1794000000000,
    "attachments": [{"kind": "image|file", "url": "...", "name": "..."}]
  }
  ```
- **Sự kiện `status`:**
  ```json
  {
    "type": "status",
    "account_id": "...",
    "status": "connected|disconnected|checkpoint|expired",
    "error": "...|null"
  }
  ```

---

## 3. Chạy PoC bằng Docker để kiểm chứng E2EE thật

Image của `messenger-bridge` đã biên dịch sẵn cả 2 binary trong `/usr/local/bin/`: `messenger-bridge` (server chính, mặc định ở `ENTRYPOINT`) và `poc` (công cụ CLI kiểm chứng độc lập không cần Backend).

Cú pháp của `poc` (từ `cmd/poc/main.go`):
```text
poc [--proxy URL] [--data-dir DIR] [--send-to UID --text TEXT] cookies.txt
```

### Bước 1: Chuẩn bị cookie của tài khoản clone
Tự xuất chuỗi cookie của tài khoản Facebook clone (định dạng `c_user=...; xs=...; datr=...`) và lưu vào file `messenger-bridge/cookies.txt` (file này đã nằm trong `.gitignore` và `.dockerignore`, không commit lên git).

### Bước 2: Build Docker image
Chạy từ thư mục gốc của repo:
```bash
docker build -t messenger-bridge ./messenger-bridge
```

### Bước 3: Chạy `poc` để lắng nghe tin nhắn đến (kể cả E2EE)
Sử dụng `--entrypoint poc`, gắn file `cookies.txt` ở chế độ chỉ đọc và gắn volume `messenger-poc-data:/data` để lưu trữ thiết bị E2EE (`e2ee.db` + `wa_device_id`) qua các lần chạy:

> **Lưu ý môi trường:**
> - **Windows Git Bash:** Cần đặt biến `MSYS_NO_PATHCONV=1` (hoặc `MSYS_NO_PATHCONV=1 docker run ...`) và dùng đường dẫn tuyệt đối dạng `D:/...` cho cờ `-v` (ví dụ `-v "D:/scraper-linkedin/messenger-bridge/cookies.txt:/cookies.txt:ro"`) để tránh bị Git Bash tự động biến đổi đường dẫn.
> - **Linux:** File `cookies.txt` phải có quyền đọc cho user container (uid `10001`), ví dụ `chmod 0644 cookies.txt` trên máy cá nhân, hoặc mount read-only (`:ro`).

```bash
docker run --rm -it --entrypoint poc \
  -v "$PWD/messenger-bridge/cookies.txt:/cookies.txt:ro" \
  -v messenger-poc-data:/data \
  messenger-bridge \
  --data-dir /data \
  --proxy "http://user:pass@ip:port" \
  /cookies.txt
```
*(Nếu không dùng proxy trong môi trường thử nghiệm tại máy cá nhân, có thể bỏ cờ `--proxy "http://user:pass@ip:port"`).*

Khi một tài khoản khác nhắn tin sang tài khoản clone, mỗi tin nhắn nhận được sẽ in ra `stdout` dưới dạng 1 dòng JSON (`type: "message"`), còn log kết nối in ra `stderr`.

### Bước 4: Gửi thử tin nhắn với `--send-to` và `--text`
Để vừa kết nối, gửi thử 1 tin nhắn tới UID số của người nhận, vừa tiếp tục lắng nghe phản hồi:

```bash
docker run --rm -it --entrypoint poc \
  -v "$PWD/messenger-bridge/cookies.txt:/cookies.txt:ro" \
  -v messenger-poc-data:/data \
  messenger-bridge \
  --data-dir /data \
  --proxy "http://user:pass@ip:port" \
  --send-to 1000123456789 \
  --text "Xin chào từ PoC E2EE" \
  /cookies.txt
```
Kết quả gửi sẽ được in ra `stdout` dưới dạng JSON `{"type":"send_result","ok":true,"message_id":"...","e2ee":true|false}`. Nhấn `Ctrl+C` để dừng.

---

## 4. Chạy trong Docker Compose

Khi chạy cùng hệ thống qua profile `messenger-bridge`:

```bash
docker compose --profile messenger-bridge up -d messenger-bridge
```

Dịch vụ chỉ lắng nghe trong mạng nội bộ Docker (`seeding-net`) ở cổng `8090`, lưu dữ liệu bền vững tại volume `/data` và có `HEALTHCHECK` tự động gọi `http://127.0.0.1:8090/health`.

---

## 5. Rủi ro vận hành & Lưu ý quan trọng

1. **Nguy cơ Checkpoint / Khóa phiên:** Đăng nhập và kết nối socket Messenger từ IP máy chủ (datacenter) rất dễ bị Facebook gắn cờ bất thường hoặc bắt xác minh (checkpoint). **Khuyến nghị bắt buộc:** mỗi tài khoản nên gắn cố định một proxy dân cư Việt Nam (`proxy_url`, hỗ trợ `http://` hoặc `socks5://`) để toàn bộ lưu lượng HTTP LightSpeed và WebSocket E2EE đều đi qua cùng một IP cố định.
2. **Thư viện không chính thức (Unofficial API):** `go.mau.fi/mautrix-meta/pkg/messagix` là thư viện nội bộ mô phỏng giao thức web/mobile của Meta, không phải API chính thức và không có cam kết ổn định từ Facebook. Khi Meta thay đổi giao thức LightSpeed hoặc cấu trúc bảng `LSTable`, cần cập nhật phiên bản thư viện tương ứng.
3. **Giấy phép AGPL-3.0:** `messenger-bridge` phụ thuộc trực tiếp vào `go.mau.fi/mautrix-meta` được cấp phép theo **GNU Affero General Public License v3.0 (AGPL-3.0)**. Do đó:
   - Dịch vụ này được tách thành một tiến trình/container riêng biệt (`messenger-bridge`), giao tiếp với Backend qua HTTP JSON và không liên kết tĩnh hay nhúng vào mã nguồn Backend.
   - Theo điều khoản AGPL-3.0, mã nguồn của dịch vụ `messenger-bridge` phải luôn được duy trì công khai/sẵn có cho người dùng tương tác với dịch vụ qua mạng.
