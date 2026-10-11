# Module CRM độc lập — deploy cho TimeTech (`instance=timetech`)

> Đây là bản clone thứ 4 (sau `crm-module`=Markee, `crm-cloudgate`, `crm-securityzone`)
> — CÙNG code, chỉ khác `backend/.env`'s `CRM_INSTANCE=timetech` (đọc/ghi riêng
> dữ liệu TimeTech trên cùng 1 DB self-host dùng chung với 3 deploy kia). Xem
> mục "Multi-tenant" bên dưới để hiểu cơ chế, và mục "Deploy thêm 1 instance
> mới" nếu cần tạo thêm brand khác sau này.
>
> **Tạo ngày 2026-10-11, CHƯA deploy lên host nào, CHƯA commit/push.** Logo
> (`frontend/public/timetech_logo.png`) và domain công khai (`timetech.vn`
> trong `publicQuoteUrl.ts` + `WORKSPACE_DOMAINS`) đang là **placeholder** —
> xem mục "Việc còn dang dở" ở cuối file trước khi deploy thật.

Tách từ app "seeding" chính (`linkedin-crawler-ui` + `linkedin_group_crawler`)
ra thành 1 module chạy **độc lập hoàn toàn** — backend riêng, frontend riêng,
màn đăng nhập đầy đủ riêng — nhưng vẫn dùng **chung 1 DB self-host Supabase**
với app seeding (cả prod lẫn dev của app seeding hiện đang share DB này), nên
tài khoản đăng nhập (kể cả đăng nhập Google) dùng ở app nào cũng đăng nhập
được ở module này.

Bao gồm đúng khu vực "Quản lý CRM" của app gốc: **Leads, Khách hàng, Cơ hội
(pipeline/kanban), Phân tích CRM, Báo giá, Lịch sử báo giá, Hợp đồng, Tài liệu
bán hàng, Sản phẩm & dịch vụ, Mẫu báo giá, Đơn vị phát hành, Danh mục CRM** —
giao diện giữ nguyên y hệt app gốc, không redesign.

## Cấu trúc

```
crm-timetech/
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
   # (lấy đúng giá trị app seeding đang dùng — CÙNG 1 DB) và set CORS_ORIGINS=http://localhost:3103
   .venv/Scripts/python -m uvicorn app.main:app --host 0.0.0.0 --port 8103
   ```
2. **Frontend** (terminal khác):
   ```bash
   cd frontend
   npm install
   cp .env.example .env.local
   # .env.local: NEXT_PUBLIC_LINKEDIN_CRAWLER_API_URL=http://localhost:8103
   npm run dev -- -p 3103
   ```
3. Mở `http://localhost:3103` — đăng nhập bằng tài khoản đã có trên app seeding
   (cùng DB). Sửa code frontend thì `next dev` tự hot-reload, không cần build lại.

### Chạy bằng Docker Compose (giống production sẽ deploy)

```bash
cp .env.example .env                              # build-arg + port router
cp backend/.env.example backend/.env               # secret backend thật
cp docker-compose.override.yml.example docker-compose.override.yml   # nếu test local
docker compose up --build
```
Mở `http://localhost:18093` (hoặc port đặt trong `CRM_ROUTER_PORT`).

## Deploy lên host riêng

1. Copy nguyên thư mục `crm-timetech/` sang host mới (không cần mang theo phần
   còn lại của repo) — hoặc để CI tự rsync nếu dùng workflow
   `deploy-crm-timetech.yml` (xem `[[crm-clone-modules-deploy-path]]`: 3 module
   kia rsync code mới sang `/opt/apps/crm-<tên>/` rồi chạy container ở đó,
   **không chạy trực tiếp từ thư mục git checkout**).
2. Điền `backend/.env` bằng secret thật (Supabase self-host + JWT + OpenAI/
   Telegram nếu dùng tính năng AI Contract Copilot / gửi báo giá Telegram).
3. Điền `.env` (root) — `CRM_PUBLIC_URL` = domain thật sẽ trỏ tới module này.
4. `docker compose up --build -d`.
5. Trỏ DNS/reverse-proxy ngoài (nếu có) vào port router (`CRM_ROUTER_PORT`,
   mặc định `18093` — đổi nếu host đã dùng port này cho stack khác).
6. Muốn nút "Đăng nhập bằng Google" hoạt động trên domain mới: vào Google
   Cloud Console (dự án đang dùng cho app seeding), thêm domain mới vào
   "Authorized JavaScript origins". Đăng nhập email/password không cần bước
   này.

## Vì sao dùng chung DB lại cần chú ý

- `backend/.env`'s `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` phải trỏ đúng DB
  self-host mà app seeding đang dùng (`seeding.db.markeeai.com` tại thời điểm
  tách module này — xác nhận lại nếu giá trị này đã đổi) — sai giá trị này thì
  module vẫn khởi động được (không crash) nhưng KHÔNG đăng nhập được / không
  thấy dữ liệu thật.
- `JWT_SECRET_KEY` không bắt buộc phải trùng với app seeding (mỗi service tự
  ký/verify token của chính nó, độc lập) — nhưng nếu dùng cùng giá trị thì
  token đăng nhập ở app này dùng được luôn ở app kia (tiện nếu muốn SSO nhẹ).

## Multi-tenant: `CRM_INSTANCE` (Markee / CloudGate / SecurityZone / TimeTech, dùng chung 1 DB)

DB self-host này phục vụ **4 deploy độc lập** (`crm-module`=markee,
`crm-cloudgate`, `crm-securityzone`, `crm-timetech`) — mỗi deploy chỉ được
thấy/ghi đúng dữ liệu của mình. Cơ chế: mọi bảng dữ liệu CRM có cột `instance`
(text), và biến env `CRM_INSTANCE=timetech` (trong `backend/.env`) quyết định
deploy này lọc/ghi theo giá trị nào.

Migration `001_add_instance_scoping.sql` (thêm cột `instance`) và các migration
sửa RPC `SECURITY DEFINER` nhận tham số instance (`120_crm_customer_deal_rpc_instance.sql`,
`121_crm_customer_deal_rpc_drop_old_overload.sql`, `133_crm_convert_lead_tenant_fix.sql`,
`135_crm_create_customer_with_deal_contact.sql`...) **đã áp dụng sẵn trên DB
self-host dùng chung** (áp khi bật `crm-cloudgate`/`crm-securityzone` trước
đây) — `timetech` dùng chung schema này, KHÔNG cần chạy lại migration nào chỉ
vì thêm instance mới, miễn `CRM_INSTANCE` là 1 slug mới không trùng
(`markee`/`cloudgate`/`SECURITYZONE` đã dùng).

## Deploy thêm 1 instance mới (vd brand khác sau TimeTech)

Không fork code thủ công qua sửa tay — **clone nguyên thư mục
`crm-cloudgate/` (bản base sạch nhất, không kèm tính năng riêng của
securityzone) thành thư mục mới cùng cấp**, rồi đổi:
- `backend/.env`: `CRM_INSTANCE=<slug mới>`, `SUPABASE_URL`/
  `SUPABASE_SERVICE_ROLE_KEY` **giữ nguyên** (vẫn cùng 1 DB self-host),
  `CORS_ORIGINS` đổi sang domain thật của instance mới,
  `WORKSPACE_DOMAINS`/`ZALO_SUPABASE_STORAGE_BUCKET` đổi tên theo instance mới.
- `docker-compose.yml`: đổi tên image/container + port (`CRM_ROUTER_PORT`,
  lấy port kế tiếp chưa dùng — `crm-module`=18090, `crm-cloudgate`=18091,
  `crm-securityzone`=18092, `crm-timetech`=18093).
- Branding frontend (title, logo, text đăng nhập Google, copyright — xem danh
  sách file đã sửa khi tạo `crm-timetech` so với `crm-cloudgate` qua
  `git log`/`git diff` nếu cần đối chiếu).
- Thêm `.github/workflows/deploy-crm-<tên>.yml` (mirror
  `deploy-crm-timetech.yml`) nếu muốn CI tự deploy khi push `main`.

2 deploy hoàn toàn độc lập (khác host, khác container, khác domain) nhưng cùng
đọc/ghi 1 DB, mỗi bên chỉ thấy dữ liệu `instance` của mình.

## Việc còn dang dở (tạo clone 2026-10-11, chưa deploy)

- **Logo placeholder**: `frontend/public/timetech_logo.png` là ảnh chữ "TT"
  dựng tạm bằng script (không phải logo thật của TimeTech) — thay file này
  (giữ nguyên tên hoặc đổi tên + cập nhật các chỗ reference trong
  `app/layout.tsx`, `AuthPage.tsx`, `DashboardHeader.tsx`, `DashboardSidebar.tsx`)
  bằng logo thật trước khi đưa cho khách dùng.
- **Domain công khai placeholder**: `https://timetech.vn` trong
  `frontend/modules/quotes/utils/publicQuoteUrl.ts` (`INSTANCE_PUBLIC_DOMAIN`)
  và `https://crm.timetech.vn` trong `backend/.env.example`'s
  `WORKSPACE_DOMAINS` **chưa được xác nhận bởi người phụ trách hạ tầng** —
  đổi sang domain thật trước khi dùng tính năng "Sao chép link"/"In PDF" báo
  giá hoặc admin workspace switcher trên production thật.
- **CHƯA wiring cross-workspace với 3 module kia** (theo đúng yêu cầu "dữ liệu
  riêng" khi tạo clone này): `WORKSPACE_DOMAINS` trên `crm-module`/
  `crm-cloudgate`/`crm-securityzone` (host thật) **chưa** được thêm dòng
  `"timetech":"<domain>"`, nên admin đang có quyền ở 3 module kia sẽ KHÔNG
  thấy TimeTech trong workspace switcher của họ (và ngược lại), và tính năng
  "Sao chép Lead/Báo giá sang workspace khác" ở Main (`_MAIN_COPY_TARGET_INSTANCES`
  trong `crm_lead_service.py`, `VALID_TARGET_INSTANCES` trong
  `cross_workspace_quote_service.py`) chưa liệt kê `timetech`. Đây là lựa chọn
  CÓ CHỦ ĐÍCH (cô lập dữ liệu hoàn toàn) — chỉ làm thêm nếu sau này có yêu cầu
  cho phép chuyển dữ liệu qua lại giữa TimeTech và 3 brand kia (lúc đó phải
  sửa thêm cả 3 module kia, kéo theo CI tự redeploy chúng).
- **CHƯA commit/push, CHƯA deploy lên host nào** — thư mục này mới chỉ tồn tại
  trong working tree. Trước khi deploy thật cần: tạo `backend/.env`/`.env`
  thật (xem mục "Deploy lên host riêng"), quyết định domain/port thật, thêm
  workflow CI `deploy-crm-timetech.yml` nếu muốn tự động hoá, và theo
  `[[crm-clone-modules-deploy-path]]` — lần deploy ĐẦU TIÊN của 1 module mới
  cần ai đó tạo sẵn `/opt/apps/crm-timetech/backend/.env` thật trên host
  TRƯỚC khi chạy CI (CI chỉ rsync code, không tự sinh secret).
