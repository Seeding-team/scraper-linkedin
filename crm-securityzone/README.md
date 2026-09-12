# Module CRM độc lập — deploy cho SecurityZone (`instance=SECURITYZONE`)

> Đây là bản clone của `crm-module/` (deploy cho Markee) — CÙNG code, chỉ khác
> `backend/.env`'s `CRM_INSTANCE=securityzone` (đọc/ghi riêng dữ liệu
> SecurityZone trên cùng 1 DB self-host). Deploy chung host với app seeding
> (`10.120.60.26`), port riêng `18092` (khác `18090` của crm-module và
> `18091` của crm-cloudgate). Xem mục "Multi-tenant" bên dưới để hiểu cơ chế.

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

**BẮT BUỘC — chạy 1 lần trước khi dùng thật** (đã viết sẵn, CHƯA tự chạy
được vì DB `seeding.db.markeeai.com` không có kênh SSH/DDL nào từ máy dev này
— xem "Cách áp migration" bên dưới):
`backend/migrations/001_add_instance_scoping.sql` — thêm cột `instance TEXT
NOT NULL DEFAULT 'markee'` vào toàn bộ bảng CRM + đổi 4 unique constraint
(`quote_forms.code`, `quote_forms` default-template, `quotes.quote_number`,
`quote_issuer_companies.code`, `contracts.contract_number`) từ "duy nhất toàn
hệ thống" thành "duy nhất theo instance". An toàn chạy lại nhiều lần, mặc định
`'markee'` cho dữ liệu hiện có (đúng thực tế vì tới nay chỉ có Markee).

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

## Deploy thêm 1 instance mới (vd CloudGate)

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
