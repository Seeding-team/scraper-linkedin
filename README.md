# Chạy dự án local bằng Docker Desktop

Hướng dẫn để 1 người MỚI dựng lại đúng bộ 4 stack đang chạy local hiện tại
trên máy dev này, dùng chung 1 DB Postgres (Supabase CLI). Không phải hướng
dẫn deploy production — xem `crm-module/README.md` mục "Deploy lên host riêng"
cho việc đó.

## Kiến trúc tổng quan

```
                ┌───────────────────────────────┐
                │  Supabase CLI (local Postgres) │  <- 1 DB DUY NHẤT, dùng chung
                │  linkedin_group_crawler/supabase │     bởi cả 4 stack dưới đây
                └───────────────────────────────┘
                     ▲        ▲        ▲        ▲
   ┌─────────────┐  │  ┌───────────┐  │  ┌──────────────┐ │ ┌───────────────┐
   │ Main (repo  │──┘  │ crm-module│──┘  │ crm-cloudgate│─┘ │crm-securityzone│
   │ gốc, port   │     │ (Markee)  │     │  port 18091  │   │  port 18092    │
   │ 8080)       │     │ port 18090│     │              │   │                │
   └─────────────┘     └───────────┘     └──────────────┘   └───────────────┘
```

- **Main** (`linkedin-crawler-ui` + `linkedin_group_crawler`, docker-compose ở
  repo root) — app gốc đầy đủ tính năng, coi như site "Markee" gốc.
- **crm-module / crm-cloudgate / crm-securityzone** — 3 module CRM tách rời,
  mỗi thư mục là 1 container stack độc lập (`docker-compose.yml` riêng), cùng
  code gốc từ `crm-module` nhưng khác `.env` (khác `CRM_INSTANCE`, JWT secret,
  port).
- Cả 4 stack **cùng đọc/ghi 1 DB Postgres local** (chạy bằng Supabase CLI, không
  phải container riêng trong docker-compose của app nào) — chỉ cần start DB
  này **1 lần**, không phải mỗi stack tự có DB riêng.

## Yêu cầu cài trước

- Docker Desktop (đã bật, đủ RAM cấp cho Docker — build 4 stack cùng lúc khá
  nặng, nên đóng bớt app khác nếu máy ít RAM).
- [Supabase CLI](https://supabase.com/docs/guides/cli) (`npm install -g
  supabase` hoặc `scoop install supabase` trên Windows).
- Node.js + Python chỉ cần nếu muốn chạy tay ngoài Docker (không bắt buộc cho
  hướng dẫn Docker này).

## Bước 1 — Start DB dùng chung (Supabase CLI)

```bash
cd linkedin_group_crawler
supabase start
```

Lần đầu sẽ pull image + tự áp toàn bộ migration có sẵn trong
`linkedin_group_crawler/supabase/migrations/` (đây là các migration Main tự
track). Chạy xong sẽ in ra `API URL`, `DB URL`, `anon key`, `service_role
key`... — đây chính là bộ Supabase local demo, **giống hệt trên mọi máy** (không
phải secret riêng của dự án này), port mặc định:

| Service        | Port  |
|----------------|-------|
| API (PostgREST)| 54321 |
| Postgres DB    | 54322 |
| Studio (UI)    | 54323 |
| Inbucket (mail)| 54324 |

Muốn xem DB bằng UI: mở `http://localhost:54323`.

`supabase stop` để tắt (thêm `--no-backup` nếu muốn xoá sạch data test), `supabase status` để xem lại URL/key bất kỳ lúc nào.

## Bước 2 — Áp migration riêng của CRM module (chạy 1 lần)

`crm-module/backend/migrations/*.sql` KHÔNG nằm trong
`linkedin_group_crawler/supabase/migrations/` nên Supabase CLI **không tự
chạy** — phải áp tay 1 lần vào DB vừa start ở Bước 1. `crm-cloudgate` và
`crm-securityzone` có bản copy y hệt của các file này nên **chỉ cần chạy từ
`crm-module`, không cần lặp lại cho 2 thư mục kia**.

Tìm tên container Postgres local trước:

```bash
docker ps --filter "name=supabase_db" --format "{{.Names}}"
# thường là: supabase_db_linkedin_group_crawler
```

Áp lần lượt TẤT CẢ file `.sql` trong `crm-module/backend/migrations/` theo thứ
tự số (001, 002, 003... rồi 106, 107...). Toàn bộ đều viết idempotent (`IF NOT
EXISTS`), nên chạy lại nhiều lần / chạy dù DB đã có sẵn 1 phần schema đều an
toàn. Ví dụ PowerShell:

```powershell
$container = "supabase_db_linkedin_group_crawler"
Get-ChildItem "crm-module\backend\migrations\*.sql" | Sort-Object {
    [int]([regex]::Match($_.Name, '^\d+').Value)
} | ForEach-Object {
    Write-Host "== $($_.Name) =="
    Get-Content $_.FullName -Raw | docker exec -i $container psql -U postgres -d postgres -v ON_ERROR_STOP=1
}
```

Bash tương đương:

```bash
container=supabase_db_linkedin_group_crawler
for f in $(ls crm-module/backend/migrations/*.sql | sort -t_ -k1 -n); do
  echo "== $f =="
  docker exec -i "$container" psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$f"
done
```

Một vài file (liên quan `projects`, `vendor_import_*`, `service_catalog_item_pricing` —
tính năng ngoài phạm vi CRM Lead/Customer/Deal cơ bản) có thể báo lỗi `relation
does not exist` nếu DB chưa có bảng phụ thuộc — bỏ qua các lỗi đúng dạng này và
chạy tiếp file kế tiếp, không phải lỗi chặn được tính năng CRM chính.

## Bước 3 — Cấu hình `.env` cho từng stack

`.env` đã nằm trong `.gitignore` (không commit) — copy từ `.env.example` rồi
điền. Vì cả 4 stack dùng chung DB local ở Bước 1, `SUPABASE_URL`/
`SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY` của **cả 4 stack đều giống
nhau** — dùng đúng bộ demo key Supabase CLI in ra ở Bước 1 (hoặc bộ chuẩn dưới
đây, luôn giống nhau cho mọi máy chạy Supabase CLI local, không phải secret
thật):

```
SUPABASE_URL=http://host.docker.internal:54321
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzgzNTMxNjUyLCJleHAiOjIwOTg4OTE2NTJ9.rfvKDHihgyYJATv_qsl8rcGU9sih-4-EGvygpmDYunc
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU
```

(`host.docker.internal` để container backend gọi ra được Postgres đang chạy
ngoài Docker Desktop qua Supabase CLI.)

Các secret thật khác (`OPENAI_API_KEY`, `TELEGRAM_TOKEN`, `GOOGLE_CLIENT_ID`,
`MARKEE_FB_API_KEY`...) — để trống nếu không cần test tính năng tương ứng
(AI Copilot, gửi Telegram, đăng nhập Google...); service vẫn chạy bình
thường, chỉ đúng các nút liên quan sẽ báo lỗi thay vì crash cả service.

### `crm-module` (Markee, port 18090)

```bash
cd crm-module
cp .env.example .env
cp backend/.env.example backend/.env
```

Điền `backend/.env`: 3 dòng Supabase ở trên + `JWT_SECRET_KEY=` (bất kỳ chuỗi
nào, vd `local-test-secret`) + giữ nguyên `CRM_INSTANCE=markee` +
`INSTANCE_DOMAIN_MAP`/`WORKSPACE_DOMAINS` đã có sẵn ví dụ trong
`.env.example` — với setup local test 3 port giả lập, dùng:

```
WORKSPACE_DOMAINS={"markee":"http://localhost:18090","cloudgate":"http://localhost:18091","SECURITYZONE":"http://localhost:18092"}
```

### `crm-cloudgate` (port 18091) / `crm-securityzone` (port 18092)

Y hệt `crm-module` nhưng đổi:
- `CRM_INSTANCE=cloudgate` (hoặc `SECURITYZONE`)
- `JWT_SECRET_KEY` khác với 2 stack kia (vd thêm hậu tố `-cloudgate`)
- `WORKSPACE_DOMAINS` giữ **giống hệt cả 3 stack** (đủ cả 3 port 18090/18091/18092)

### Main (repo root, port 8080)

```bash
cp linkedin_group_crawler/.env.example linkedin_group_crawler/.env   # nếu chưa có
```

Điền 3 dòng Supabase ở trên vào `linkedin_group_crawler/.env`, và thêm 3 dòng
an toàn cục bộ (tránh vô tình đụng cron/crawler thật):

```
DISABLE_SCHEDULER=1
DISABLE_ZCA_LISTENERS=1
DISABLE_ALL_PLATFORM_CRAWL_24H=1
```

`linkedin-crawler-ui/.env` — docker-compose ở root yêu cầu file này TỒN TẠI
(dù không cần biến nào, vì mọi cấu hình frontend là build-arg, không phải env
runtime) — nếu chưa có, tạo file rỗng:

```bash
type nul > linkedin-crawler-ui\.env     # Windows (PowerShell/cmd)
touch linkedin-crawler-ui/.env          # macOS/Linux
```

**Bắt buộc** copy override để frontend build trỏ về `localhost:8080` (router
của chính Main) thay vì domain production `seeding.markeeai.com` (mặc định
trong `docker-compose.yml` gốc):

```bash
cp docker-compose.override.yml.example docker-compose.override.yml
```

## Bước 4 — Build & chạy từng stack

Chạy độc lập từng thư mục (không phụ thuộc thứ tự lẫn nhau, chỉ cần DB ở Bước
1+2 đã sẵn sàng trước):

```bash
# crm-module
cd crm-module && docker compose up --build -d && docker compose restart router && cd ..

# crm-cloudgate
cd crm-cloudgate && docker compose up --build -d && docker compose restart router && cd ..

# crm-securityzone
cd crm-securityzone && docker compose up --build -d && docker compose restart router && cd ..

# Main (repo root)
docker compose up --build -d && docker compose restart router
```

**Lưu ý quan trọng**: luôn `docker compose restart router` SAU KHI build lại
`backend`/`frontend` — nginx cache IP nội bộ của container lúc khởi động,
không restart sẽ bị `502 Bad Gateway` dù backend/frontend đã lên khỏe.

## Truy cập

| Stack           | URL                     |
|-----------------|-------------------------|
| Main (Markee gốc)| http://localhost:8080  |
| crm-module (Markee)| http://localhost:18090 |
| crm-cloudgate   | http://localhost:18091 |
| crm-securityzone| http://localhost:18092 |
| Supabase Studio | http://localhost:54323 |

## Tài khoản đăng nhập

Chưa có seed data tài khoản mẫu — tự đăng ký 1 tài khoản mới ở bất kỳ stack
nào (`/auth/register`), mặc định role `member`. Muốn có quyền admin (xem hết
dữ liệu mọi workspace, dùng workspace switcher...), nâng role trực tiếp trong
DB:

```bash
docker exec -it supabase_db_linkedin_group_crawler psql -U postgres -d postgres \
  -c "UPDATE app_users SET role='admin' WHERE email='ban@vidu.com';"
```

## Xử lý sự cố thường gặp

- **502 sau khi rebuild**: chưa `docker compose restart router` (xem Bước 4).
- **Đăng nhập được nhưng không thấy dữ liệu / báo "chưa cấu hình domain"**:
  `WORKSPACE_DOMAINS` giữa 3 stack CRM không khớp nhau — phải giống hệt cả 3.
- **Migration báo lỗi `relation does not exist`** ở vài file liên quan
  `projects`/`vendor_import_*`: bỏ qua nếu không test tính năng đó, không ảnh
  hưởng CRM Lead/Customer/Deal cơ bản.
- **Build chậm / máy đơ**: Docker Desktop cấp RAM thấp sẽ khiến `npm install`/
  `pip install` rất chậm (có thể vài phút) chứ không phải bị treo — chờ thêm
  trước khi huỷ build.
