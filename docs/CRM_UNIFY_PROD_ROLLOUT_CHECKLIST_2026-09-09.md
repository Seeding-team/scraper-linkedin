# Checklist đưa `crm-module` (gộp 3 brand) lên production — 2026-09-09

**ĐỌC CÙNG VỚI** `docs/CRM_UNIFY_MULTITENANT_2026-09-08.md` (bối cảnh, kiến
trúc, phát hiện) — file này chỉ là **checklist thao tác thật trên host prod**,
viết ra vì user tự SSH/sửa NPM (Claude không có VPN/quyền vào host prod từ máy
dev), Claude chỉ chuẩn bị file + hướng dẫn.

Đã build + test xong ở local (Docker Compose, DB Supabase local test) 2 việc:
1. Backend đọc `instance` theo Host header từng request (không còn cố định
   theo process) + admin workspace switcher (đổi domain thật).
2. **Mới nhất**: tài khoản non-admin có `home_instance` (site đã đăng ký) —
   đăng nhập nhầm site khác sẽ tự động redirect về đúng site (migration
   `003_app_users_home_instance.sql`).

## Vì sao PHẢI gộp 3 stack thành 1 trước khi 2 tính năng trên chạy đúng

Switcher (admin) và redirect (non-admin, tính năng mới) đều dùng chung 1 cơ
chế: mint 1 mã dùng-1-lần ở process đang xử lý request hiện tại, rồi domain
đích tự đổi mã lấy cookie mới. Mã này lưu **trong RAM của process** (xem
`backend/app/modules/all_platform/services/workspace_handoff_service.py`) —
chỉ đúng khi **1 process DUY NHẤT xử lý cả 4 domain**. Hiện production đang
chạy **3 stack riêng biệt** (`crm-module`@18090, `crm-cloudgate`@18091,
`crm-securityzone`@18092 trên host `10.120.60.26`, NPM trỏ 4 domain vào 3 port
này) — mint ở process A, consume ở process B khác → luôn thất bại. Deploy code
nhánh này lên nguyên trạng 3 stack cũ sẽ KHÔNG test được đầy đủ 2 tính năng
trên, dù mọi thứ khác (CRUD CRM từng brand) vẫn chạy bình thường.

## Bước 0 — Kiểm tra an toàn TRƯỚC KHI chạy migration (bắt buộc, đọc kỹ)

3 stack hiện tại cùng đọc/ghi **1 DB self-host** nhưng KHÔNG có cột phân biệt
brand nào cả (`instance` là cột migration này thêm mới). Migration
`001_add_instance_scoping.sql` mặc định gán `instance='markee'` cho MỌI dòng
dữ liệu hiện có — chỉ an toàn nếu tới giờ CloudGate/SecurityZone chưa có dữ
liệu thật nào (theo ghi nhận lúc viết migration: "chỉ có 1 khách hàng dùng
chung — Markee"). **Chạy query sau trên DB prod thật để xác nhận lại trước
khi chạy migration 001**:

```sql
SELECT count(*) FROM crm_customers;
SELECT customer_name, company_name, email, created_at
FROM crm_customers ORDER BY created_at ASC LIMIT 30;

SELECT count(*) FROM crm_leads;
SELECT lead_name, company_name, email, created_at
FROM crm_leads ORDER BY created_at ASC LIMIT 30;

SELECT count(*) FROM quotes;
SELECT quote_number, created_at FROM quotes ORDER BY created_at ASC LIMIT 30;
```

Nếu thấy bất kỳ dòng nào rõ ràng **không phải Markee** (tên công ty/email của
CloudGate hoặc SecurityZone) → **DỪNG LẠI**, đừng chạy migration 001 ngay —
báo lại để sửa migration thành backfill đúng brand theo dữ liệu thật thay vì
mặc định toàn bộ `'markee'`. Nếu toàn bộ dữ liệu đều là Markee (đúng như ghi
nhận) → an toàn, tiếp tục Bước 1.

## Bước 1 — Áp 3 migration lên DB self-host prod thật

Theo thứ tự, file nằm ở `crm-module/backend/migrations/`:

1. `001_add_instance_scoping.sql`
2. `002_markee_cfo_customer_sync.sql`
3. `003_app_users_home_instance.sql` (mới nhất — cột `home_instance` cho
   `app_users`, phục vụ tính năng redirect)

Cả 3 đều **idempotent** (an toàn chạy lại nhiều lần, dùng `IF NOT EXISTS`).
Cách chạy (chọn 1, tuỳ hạ tầng thật đang có — xem thêm
`crm-module/README.md` mục "Cách áp migration"):

- **Supabase Studio** (nếu DB self-host có UI này) → SQL Editor → dán nguyên
  nội dung từng file → Run, theo đúng thứ tự 001 → 002 → 003.
- **SSH vào host chạy container DB** (đúng pattern đã dùng trước đây):
  ```bash
  docker exec -i -u postgres <ten-container-supabase-db> psql -d postgres < backend/migrations/001_add_instance_scoping.sql
  docker exec -i -u postgres <ten-container-supabase-db> psql -d postgres < backend/migrations/002_markee_cfo_customer_sync.sql
  docker exec -i -u postgres <ten-container-supabase-db> psql -d postgres < backend/migrations/003_app_users_home_instance.sql
  ```

**Verify ngay sau khi chạy** (không thấy lỗi, và các cột đã có):
```sql
\d app_users        -- phải thấy cột home_instance
\d crm_customers     -- phải thấy cột instance, default 'markee'
SELECT instance, count(*) FROM crm_customers GROUP BY instance;  -- toàn bộ phải là 'markee'
```

## Bước 2 — Chuẩn bị `.env` cho stack `crm-module` gộp

`crm-module/.env.example` (root) và `crm-module/backend/.env.example` **đã
sẵn sàng cho việc gộp** (đã sửa trong nhánh này) — copy thành `.env` thật rồi
điền:

- `backend/.env`: điền `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` (DB self-host
  dùng chung — LẤY ĐÚNG giá trị 3 backend hiện tại đang dùng, phải giống hệt
  nhau vì đây là 1 process gộp), `JWT_SECRET_KEY` (chọn 1 trong 3 secret hiện
  có, hoặc secret mới — nếu đổi thì **mọi người đang đăng nhập ở cả 3 brand sẽ
  bị đăng xuất 1 lần**, báo trước cho user). `INSTANCE_DOMAIN_MAP` và
  `WORKSPACE_DOMAINS` trong file mẫu đã điền sẵn đúng 4 domain thật — không
  cần sửa trừ khi domain đổi khác lúc viết migration.
- `.env` (root): để `CRM_PUBLIC_URL` TRỐNG (mặc định — frontend gọi API bằng
  đường dẫn tương đối, tự đúng domain nào đang đứng — xem comment trong file
  mẫu), chỉ cần set `CRM_ROUTER_PORT` (chọn port trống trên host, TẠM THỜI
  khác 18090/18091/18092 để chạy song song test trước khi cutover NPM — xem
  Bước 3).

## Bước 3 — Build + chạy stack mới, test qua port tạm TRƯỚC khi đổi NPM

```bash
cd crm-module
docker compose up --build -d
```

Test qua `curl` với `Host:` header giả (giống cách đã verify ở local, xem
script mẫu cuối file) để xác nhận routing/instance/redirect đúng **TRƯỚC KHI**
đổi NPM — tránh nếu có bug thì domain thật đã bị trỏ sai.

## Bước 4 — Đổi NPM (rủi ro cao nhất, làm cẩn thận từng domain một)

Đổi từng Proxy Host một, verify ngay sau mỗi domain trước khi làm domain tiếp
theo:

1. `crm.markee.vn` → port mới → mở thử ngay, đăng nhập thật thử 1 tài khoản
   biết trước → OK mới sang domain tiếp theo.
2. `crm.markeeai.com` (alias Markee) → tương tự.
3. `crm.getcloudgate.com` → tương tự.
4. `crm.securityzone.vn` → tương tự.

Sau khi cả 4 domain đã trỏ sang stack mới và chạy ổn định 1 thời gian (gợi ý
vài ngày) mới `docker compose down` 2 stack cũ `crm-cloudgate`/
`crm-securityzone` (KHÔNG xoá ngay — giữ lại phòng cần rollback nhanh).

**Rollback nếu có sự cố**: đổi NPM trỏ lại đúng port cũ (18091/18092) cho
từng domain bị lỗi — 2 stack cũ vẫn đang chạy song song nên rollback tức thì.
KHÔNG cần rollback migration (cột `instance`/`home_instance` mới, có default,
không phá code cũ nếu lỡ phải quay lại chạy code cũ 1 thời gian).

## Script test nhanh sau khi build (chạy trên host, thay `<port>` bằng
`CRM_ROUTER_PORT` đã chọn ở Bước 2, thay `<domain>` bằng domain thật cần test)

```bash
# 1) Test routing/instance qua Host header gia (chua can NPM that)
curl -s -H "Host: crm.markee.vn" http://localhost:<port>/api/all-platform/auth/workspaces
curl -s -H "Host: crm.getcloudgate.com" http://localhost:<port>/api/all-platform/auth/workspaces
curl -s -H "Host: crm.securityzone.vn" http://localhost:<port>/api/all-platform/auth/workspaces
# moi lenh phai tra current_instance dung (markee/cloudgate/SECURITYZONE)

# 2) Sau khi NPM da tro that, test qua domain that (HTTPS):
# - Dang nhap 1 tai khoan admin that -> dung switcher trong app doi qua lai 3 brand, xem data doi dung.
# - Dang ky 1 tai khoan test moi tren dung 1 domain -> kiem tra cot home_instance trong app_users dung domain do.
# - Dang nhap tai khoan test do tren domain KHAC -> phai bi redirect tu dong ve dung domain da dang ky.
```
