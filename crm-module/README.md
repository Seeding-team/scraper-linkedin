# Module CRM độc lập

Tách từ app "seeding" chính (`linkedin-crawler-ui` + `linkedin_group_crawler`)
ra thành 1 module chạy **độc lập hoàn toàn** — backend riêng, frontend riêng,
màn đăng nhập đầy đủ riêng — nhưng vẫn dùng **chung 1 DB self-host Supabase**
với app seeding (cả prod lẫn dev của app seeding hiện đang share DB này), nên
tài khoản đăng nhập (kể cả đăng nhập Google) dùng ở app nào cũng đăng nhập
được ở module này. Mục đích: deploy module này lên 1 host riêng, tách biệt hạ
tầng với app seeding chính.

Bao gồm đúng khu vực "Quản lý CRM" của app gốc: **Leads, Khách hàng, Cơ hội
(pipeline/kanban), Phân tích CRM, Báo giá, Lịch sử báo giá, Hợp đồng, Tài liệu
bán hàng, Sản phẩm & dịch vụ, Mẫu báo giá, Đơn vị phát hành, Danh mục CRM** —
giao diện giữ nguyên y hệt app gốc, không redesign.

Có 1 nỗ lực khác đã lên kế hoạch từ trước
(`../docs/CRM_NEXT_INTEGRATION_MAPPING.md`, ở repo chính) để thay UI
`/all-platform/crm` bằng 1 module `crm-next` lấy từ repo khác — không liên
quan tới module này (module này tách UI **hiện tại**), nhưng nếu nỗ lực đó
triển khai sau, module này cũng cần đổi UI tương ứng để 2 bên không lệch nhau.

## Cấu trúc

```
crm-module/
├── backend/    FastAPI (Python), KHÔNG có Playwright/crawler — chỉ CRUD CRM qua Supabase
├── frontend/   Next.js (copy + rút gọn từ linkedin-crawler-ui)
├── nginx/      nginx.conf — router: /api/ -> backend, / -> frontend
├── docker-compose.yml
└── docker-compose.override.yml.example
```

## Chạy local để xem thử

### Cách nhanh nhất (không cần Docker) — chạy tay 2 tiến trình

1. **Backend**:
   ```bash
   cd backend
   py -3 -m venv .venv          # hoặc python3 -m venv .venv trên máy có sẵn python
   .venv/Scripts/pip install -r requirements.txt      # Windows
   # .venv/bin/pip install -r requirements.txt        # macOS/Linux
   cp .env.example .env
   # Điền SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / JWT_SECRET_KEY thật vào .env
   # (lấy đúng giá trị app seeding đang dùng — CÙNG 1 DB) và set CORS_ORIGINS=http://localhost:3100
   .venv/Scripts/python -m uvicorn app.main:app --host 0.0.0.0 --port 8100
   ```
2. **Frontend** (terminal khác):
   ```bash
   cd frontend
   npm install
   cp .env.example .env.local
   # .env.local: NEXT_PUBLIC_LINKEDIN_CRAWLER_API_URL=http://localhost:8100
   npm run dev -- -p 3100
   ```
3. Mở `http://localhost:3100` — đăng nhập bằng tài khoản đã có trên app seeding
   (cùng DB). Sửa code frontend thì `next dev` tự hot-reload, không cần build lại.

### Chạy bằng Docker Compose (giống production sẽ deploy)

```bash
cp .env.example .env                              # build-arg + port router
cp backend/.env.example backend/.env               # secret backend thật
cp docker-compose.override.yml.example docker-compose.override.yml   # nếu test local
docker compose up --build
```
Mở `http://localhost:18090` (hoặc port đặt trong `CRM_ROUTER_PORT`).

### Test đa brand (switcher + khoá site) trên local

**Cách khớp thật với production (3 deploy tách rời)**: dựng thêm 1 stack
`crm-cloudgate/` (hoặc `crm-securityzone/`) như 1 container HOÀN TOÀN riêng
(`docker compose up --build -d` trong chính thư mục đó, `backend/.env` trỏ
CÙNG `SUPABASE_URL` với `crm-module` nhưng `JWT_SECRET_KEY` và `CRM_INSTANCE`
khác), rồi test mint mã ở stack này, consume ở stack kia (và ngược lại) qua
đúng port thật của từng stack (`18090` cho `crm-module`, `18091` cho
`crm-cloudgate`) — đây là cách ĐÃ verify thật (xem mục "Đăng nhập đa brand" ở
trên).

**Cách khác (giả lập 3 domain qua 1 process)** — không còn bắt buộc cho
switcher/redirect nữa (đã bỏ yêu cầu 1 process), nhưng vẫn hữu ích để demo
riêng phần cách ly dữ liệu theo `instance`/Host header: không cần sửa file
`hosts` / không cần domain thật — mở thêm 3 port giả lập
bằng cách ép cứng `Host` header, dùng file có sẵn `nginx/nginx.local-test.conf`
(`8081`→`crm.markee.vn`, `8082`→`crm.getcloudgate.com`,
`8083`→`crm.securityzone.vn`). Tạo `docker-compose.override.yml` (không
commit) với nội dung:

```yaml
services:
  router:
    ports:
      - "18081:8081"
      - "18082:8082"
      - "18083:8083"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./nginx/nginx.local-test.conf:/etc/nginx/nginx.local-test.conf:ro
    entrypoint: ["nginx", "-c", "/etc/nginx/nginx.local-test.conf", "-g", "daemon off;"]
```

`backend/.env` cần có `INSTANCE_DOMAIN_MAP` + `WORKSPACE_DOMAINS` trỏ đúng 3
port này (xem `.env.example`, đã điền sẵn ví dụ `localhost:1808{1,2,3}`).
`docker compose up --build -d` rồi test:

1. Đăng ký 1 tài khoản trên 1 port (vd `18081`) → `home_instance` tự ghi
   đúng site đó.
2. Đăng nhập tài khoản đó trên port KHÁC (vd `18082`) → phải nhận
   `redirect_url` về đúng `18081` (không login thẳng được).
3. Đăng nhập admin (role `admin`) trên bất kỳ port nào → luôn vào thẳng được
   + dùng switcher trong sidebar đổi qua lại 3 port, xem data (khách hàng/lead)
   đổi đúng theo từng site.

**Lưu ý restart router sau khi rebuild backend/frontend**: nginx cache DNS
nội bộ của Docker lúc khởi động — `docker compose up --build -d backend
frontend` xong mà không restart `router` sẽ bị `502` (router vẫn trỏ IP cũ),
chạy thêm `docker compose restart router`.

## Deploy lên host riêng

1. Copy nguyên thư mục `crm-module/` sang host mới (không cần mang theo phần
   còn lại của repo).
2. Điền `backend/.env` bằng secret thật (Supabase self-host + JWT + OpenAI/
   Telegram nếu dùng tính năng AI Contract Copilot / gửi báo giá Telegram).
3. Điền `.env` (root) — `CRM_PUBLIC_URL` = domain thật sẽ trỏ tới module này.
4. `docker compose up --build -d`.
5. Trỏ DNS/reverse-proxy ngoài (nếu có) vào port router (`CRM_ROUTER_PORT`,
   mặc định `18090` — đổi nếu host đã dùng port này cho stack khác).
6. Muốn nút "Đăng nhập bằng Google" hoạt động trên domain mới: vào Google
   Cloud Console (dự án đang dùng cho app seeding), thêm domain mới vào
   "Authorized JavaScript origins". Đăng nhập email/password không cần bước
   này.

## Vì sao dùng chung DB lại cần chú ý

- `backend/.env`'s `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` phải trỏ đúng DB
  self-host mà app seeding đang dùng (`seeding.db.markeeai.com` tại thời điểm
  tách module này — xác nhận lại nếu giá trị này đã đổi, hạ tầng từng đổi qua
  lại vài lần) — sai giá trị này thì module vẫn khởi động được (không crash)
  nhưng KHÔNG đăng nhập được / không thấy dữ liệu thật.
- `JWT_SECRET_KEY` không bắt buộc phải trùng với app seeding (mỗi service tự
  ký/verify token của chính nó, độc lập) — nhưng nếu dùng cùng giá trị thì
  token đăng nhập ở app này dùng được luôn ở app kia (tiện nếu muốn SSO nhẹ).

## Multi-tenant: `CRM_INSTANCE` (Markee / CloudGate / brand khác, dùng chung 1 DB)

DB self-host này sẽ phục vụ **nhiều deploy độc lập** của `crm-module` (Markee
tại `crm.markeeai.com` hôm nay, CloudGate hoặc brand khác sau này tại domain
riêng) — mỗi deploy chỉ được thấy/ghi đúng dữ liệu của mình. Cơ chế: mọi bảng
dữ liệu CRM có thêm cột `instance` (text), và biến env `CRM_INSTANCE` (trong
`backend/.env`) quyết định deploy này lọc/ghi theo giá trị nào.

**BẮT BUỘC — chạy 1 lần trên DB DÙNG CHUNG trước khi dùng thật** (đã viết sẵn,
CHƯA tự chạy được vì DB `seeding.db.markeeai.com` không có kênh SSH/DDL nào từ
máy dev này — xem "Cách áp migration" bên dưới). Cả 4 file đều an toàn chạy
lại nhiều lần (idempotent, dùng `IF NOT EXISTS`), **chỉ cần chạy 1 LẦN DUY
NHẤT** dù có 3 deploy (vì cả 3 cùng đọc/ghi 1 DB), chạy đúng thứ tự:

1. `backend/migrations/001_add_instance_scoping.sql` — thêm cột `instance TEXT
   NOT NULL DEFAULT 'markee'` vào toàn bộ bảng CRM + đổi 4 unique constraint
   (`quote_forms.code`, `quote_forms` default-template, `quotes.quote_number`,
   `quote_issuer_companies.code`, `contracts.contract_number`) từ "duy nhất
   toàn hệ thống" thành "duy nhất theo instance". Mặc định `'markee'` cho dữ
   liệu hiện có (đúng thực tế vì tới nay chỉ có Markee) — **kiểm tra lại thật
   trước khi chạy trên prod**, xem Bước 0 trong
   `../docs/CRM_UNIFY_PROD_ROLLOUT_CHECKLIST_2026-09-09.md`.
2. `backend/migrations/002_markee_cfo_customer_sync.sql` — thêm cột đồng bộ
   một chiều từ Markee CFO (`external_system`/`external_id`/`external_payload`/
   `external_active`/`synced_at`) vào `crm_customers`.
3. `backend/migrations/003_app_users_home_instance.sql` — thêm cột
   `home_instance` (site đã đăng ký) vào `app_users`, phục vụ tính năng "khoá
   tài khoản theo site" ở mục ngay dưới đây.
4. `backend/migrations/004_workspace_handoff_codes.sql` — bảng
   `workspace_handoff_codes` (mã dùng-1-lần cho switcher + redirect, lưu DB
   thay vì RAM để chạy đúng với 3 deploy tách rời — xem mục "Đăng nhập đa
   brand" ở trên).

**Checklist đầy đủ để đưa lên production (migration + `.env` + test)**: xem
`../docs/CRM_UNIFY_PROD_ROLLOUT_CHECKLIST_2026-09-09.md` — **KHÔNG còn bước
gộp hạ tầng / đổi NPM** như bản trước, giữ nguyên 3 deploy tách rời.

**Cách áp migration lên `seeding.db.markeeai.com`**: chưa xác định được kênh
chạy DDL cho DB này (không có SSH tới host DB, PostgREST không chạy được
DDL — 2 điểm đã kiểm tra trong phiên tách module này). Cần 1 trong các cách
sau, tuỳ hạ tầng thực tế đang có:
- Nếu có Supabase Studio / pg-meta UI cho instance self-host này → dán nguyên
  nội dung file vào SQL Editor rồi chạy.
- Nếu có SSH vào máy chủ chạy container `supabase-db` của
  `seeding.db.markeeai.com` → `docker exec -i -u postgres supabase-db psql -d
  postgres < backend/migrations/001_add_instance_scoping.sql` (đúng pattern
  đã dùng cho DB test local `10.30.194.82`, xem `docs/INFRASTRUCTURE.md` ở
  repo chính).
- Nếu không có cách nào ở trên → cần hỏi người/đội đang quản lý hạ tầng DB
  self-host này.

**TODO bắt buộc TRƯỚC KHI bật instance thứ 2 (CloudGate...)**: các hàm
Postgres `SECURITY DEFINER` gọi qua RPC (`crm_convert_lead`,
`crm_create_customer_with_deal`, `quote_update`, `quote_approve`,
`quote_update_and_approve`) hiện **không nhận tham số instance** — với Markee
(instance duy nhất hiện tại) vẫn đúng vì cột mới có `DEFAULT 'markee'`, nhưng
1 khi có instance thứ 2 gọi các RPC này thì:
- `crm_convert_lead`/`crm_create_customer_with_deal` sẽ tạo ra row **bị gắn
  nhầm `instance='markee'`** thay vì instance thật đang gọi.
- `quote_update`/`quote_approve`/`quote_update_and_approve` chỉ update theo
  `quote_id` mà KHÔNG kiểm tra instance khớp — 1 instance có `quote_id` của
  instance khác (rất khó xảy ra vì id là UUID ngẫu nhiên, nhưng không phải
  KHÔNG THỂ) vẫn sửa/duyệt được báo giá đó.
Phải sửa cả 5 hàm này (thêm `p_instance`, thêm điều kiện instance trong mọi
INSERT/SELECT/UPDATE nội bộ) trước khi instance thứ 2 đi vào hoạt động thật.

## Đăng nhập đa brand: admin switcher + khoá tài khoản theo site

**Chạy đúng với mô hình 3 deploy TÁCH RIÊNG hiện tại** (`crm-module`/
`crm-cloudgate`/`crm-securityzone`, mỗi cái 1 host/container/CRM_INSTANCE cố
định) — KHÔNG cần gộp thành 1 process, KHÔNG cần đổi NPM. Mã dùng-1-lần của
cả 2 luồng dưới đây lưu trong bảng `workspace_handoff_codes` của **DB self-host
DÙNG CHUNG** (migration `004_workspace_handoff_codes.sql`, cả 3 deploy vốn đã
share 1 DB từ trước) thay vì RAM của process — mint ở deploy A, consume ở
deploy B (2 container/2 JWT secret hoàn toàn khác nhau) vẫn hoạt động đúng vì
cả 2 cùng đọc/ghi 1 bảng trong DB chung. **Đã verify thật** bằng 2 stack Docker
Compose độc lập (`crm-module` port 18090 + `crm-cloudgate` port 18091, JWT
secret khác nhau) — cả 2 chiều mint/consume qua lại đều thành công, dùng lại
mã lần 2 bị từ chối đúng, log sạch không lỗi.

**Điều kiện bắt buộc duy nhất**: cả 3 deploy phải trỏ **cùng 1 DB self-host**
(vốn đã đúng từ trước) và biến `WORKSPACE_DOMAINS` trong `backend/.env` của
**cả 3 deploy phải giống hệt nhau** (liệt kê đủ cả 3 brand, xem
`.env.example`) — sai/thiếu 1 chỗ thì switcher/redirect sang đúng brand đó sẽ
báo lỗi "chưa cấu hình được domain" (không crash, không mất dữ liệu).

- **Admin workspace switcher**: admin (role `admin`, không tính `leader`)
  thấy dropdown đổi brand ở sidebar (`WorkspaceSwitcherShadcn.tsx`) — chọn
  brand khác sẽ redirect domain THẬT sang brand đó (không chỉ đổi UI state),
  tự đăng nhập lại qua trang `/auth/handoff`. Endpoint: `GET /auth/workspaces`
  (public), `POST /auth/workspace-handoff` (chỉ admin, mint mã), `GET
  /auth/workspace-handoff/consume` (public, đổi mã lấy cookie).

- **Khoá tài khoản non-admin theo site đã đăng ký** (`home_instance`, migration
  `003_app_users_home_instance.sql`): mỗi tài khoản `app_users` ghi lại
  `home_instance` = domain lúc `/auth/register` (hoặc lúc admin tạo tài khoản
  Google — giá trị mặc định NULL, không bị ràng buộc). Khi tài khoản non-admin
  (`member`/`leader`) đăng nhập (email/password hoặc Google) trên domain
  KHÁC `home_instance`, backend KHÔNG set cookie cho domain đó — trả về
  `redirect_url` (dùng lại cơ chế mã dùng-1-lần như switcher), frontend tự
  `window.location.href` sang đúng domain rồi tự đăng nhập tiếp qua
  `/auth/handoff`. Admin luôn được bỏ qua ràng buộc này (đăng nhập trực tiếp
  được ở mọi domain, ngoài switcher). Tài khoản tạo trước migration này có
  `home_instance = NULL` → không bị ràng buộc (giữ hành vi cũ).

Code: `auth_service.py` (`_check_home_instance_redirect`, `register_user`,
`login_user`, `login_with_google`) + `routers/auth.py`
(`_redirect_response`) + frontend `contexts/AppAuthContext.tsx` (`login`,
`loginWithGoogle`).

## Deploy thêm 1 instance mới (vd CloudGate) — mô hình CŨ, tách rời

**Lưu ý**: mục này mô tả mô hình deploy TÁCH RỜI (mỗi brand 1 host/container
riêng, `CRM_INSTANCE` cố định theo process) — dùng được cho CRUD CRM bình
thường, nhưng **admin switcher và tính năng khoá tài khoản theo site ở mục
trên KHÔNG hoạt động** với mô hình này (cần đúng 1 process chung, xem mục
"Đăng nhập đa brand" ở trên). `crm-cloudgate`/`crm-securityzone` trong repo
hiện là ví dụ của mô hình cũ này, đang chờ gộp vào 1 stack chung (xem
`../docs/CRM_UNIFY_MULTITENANT_2026-09-08.md`, mục TODO số 3).

Không fork code thủ công qua sửa tay — **clone nguyên thư mục
`crm-module/` thành thư mục mới cùng cấp** (vd `crm-cloudgate/`, đã có sẵn
trong repo này làm ví dụ), rồi chỉ đổi đúng 3 chỗ trong
`<thư-mục-mới>/backend/.env`:
- `CRM_INSTANCE=cloudgate` (hoặc slug riêng của brand đó — KHÔNG trùng
  instance nào đã dùng)
- `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` **giữ nguyên** — vẫn cùng 1 DB
  self-host (đúng yêu cầu "dùng chung DB, chia theo domain")
- `CORS_ORIGINS` đổi sang domain thật của instance mới

Deploy `<thư-mục-mới>/` lên host riêng của brand đó (xem mục "Deploy lên host
riêng" ở trên), publish qua domain riêng của brand đó. 2 deploy hoàn toàn độc
lập (khác host, khác container, khác domain) nhưng cùng đọc/ghi 1 DB, mỗi bên
chỉ thấy dữ liệu `instance` của mình.
