# Checklist đưa admin switcher + khoá tài khoản theo site lên production — 2026-09-09

**ĐỌC CÙNG VỚI** `docs/CRM_UNIFY_MULTITENANT_2026-09-08.md` (bối cảnh gốc) —
file này là bản **rút gọn, đã bỏ hẳn phần gộp hạ tầng/đổi NPM** so với bản
viết ban đầu, sau khi đổi cơ chế lưu mã chuyển workspace từ RAM sang DB dùng
chung. **Giữ nguyên 3 deploy tách rời hiện tại** (`crm-module` @ Markee,
`crm-cloudgate` @ CloudGate, `crm-securityzone` @ SecurityZone, mỗi cái 1
host/container/CRM_INSTANCE cố định, không đụng NPM).

## Tóm tắt thay đổi kiến trúc (vì sao không cần gộp stack nữa)

Bản đầu tiên yêu cầu gộp 3 stack thành 1 process vì mã dùng-1-lần của
switcher lưu trong RAM (mint ở process A, consume ở process B khác sẽ không
tìm thấy mã). Đã đổi sang lưu mã trong bảng `workspace_handoff_codes` của
**DB self-host DÙNG CHUNG** (migration `004_workspace_handoff_codes.sql`) — cả
3 deploy vốn đã đọc/ghi chung 1 DB này từ trước (theo README gốc của module),
nên mint ở deploy A, consume ở deploy B đọc được ngay qua DB, không cần chung
process.

**Đã verify thật** (không chỉ đọc code): dựng 2 stack Docker Compose độc lập
hoàn toàn (`crm-module` port 18090 + `crm-cloudgate` port 18091 trên máy dev,
2 container riêng, 2 `JWT_SECRET_KEY` khác nhau, cùng trỏ 1 DB Supabase local
test) — test cả 2 chiều:
- Tài khoản đăng ký ở "markee" (18090), đăng nhập nhầm ở "cloudgate" (18091)
  → nhận đúng `redirect_url` về 18090, consume thành công ở container 18090.
- Admin mint mã ở 18090, consume ở container 18091 (switcher) → thành công.
- Dùng lại mã lần 2 → bị từ chối đúng (dùng-1-lần).
- Log cả 2 container sạch, không lỗi.

## Bước 0 — Kiểm tra an toàn TRƯỚC KHI chạy migration 001 (bắt buộc, đọc kỹ)

Migration `001_add_instance_scoping.sql` mặc định gán `instance='markee'` cho
MỌI dòng dữ liệu hiện có trong DB chung — chỉ an toàn nếu tới giờ CloudGate/
SecurityZone chưa có dữ liệu thật nào (ghi nhận lúc viết migration: đúng vậy).
**Chạy query sau trên DB prod thật để xác nhận lại trước khi chạy migration
001** (nếu 001 đã áp dụng rồi từ trước thì bỏ qua bước này):

```sql
SELECT customer_name, company_name, email, created_at
FROM crm_customers ORDER BY created_at ASC LIMIT 30;
SELECT lead_name, company_name, email, created_at
FROM crm_leads ORDER BY created_at ASC LIMIT 30;
```

Nếu thấy dòng nào rõ ràng không phải Markee → dừng lại, báo lại để sửa
migration thành backfill đúng brand theo dữ liệu thật.

## Bước 1 — Áp 4 migration lên DB self-host prod thật (CHỈ 1 LẦN, DB dùng chung)

Theo thứ tự, file nằm ở `<mỗi thư mục>/backend/migrations/` (nội dung giống
hệt nhau ở cả 3 thư mục `crm-module`/`crm-cloudgate`/`crm-securityzone` — chỉ
cần chạy 1 lần vì DB chung):

1. `001_add_instance_scoping.sql`
2. `002_markee_cfo_customer_sync.sql`
3. `003_app_users_home_instance.sql`
4. `004_workspace_handoff_codes.sql`

Cả 4 đều idempotent (an toàn chạy lại nhiều lần). Cách chạy: Supabase Studio
SQL Editor (dán nội dung từng file, chạy đúng thứ tự), hoặc SSH vào host chạy
container DB:
```bash
docker exec -i -u postgres <ten-container-supabase-db> psql -d postgres < 001_add_instance_scoping.sql
docker exec -i -u postgres <ten-container-supabase-db> psql -d postgres < 002_markee_cfo_customer_sync.sql
docker exec -i -u postgres <ten-container-supabase-db> psql -d postgres < 003_app_users_home_instance.sql
docker exec -i -u postgres <ten-container-supabase-db> psql -d postgres < 004_workspace_handoff_codes.sql
```

Verify:
```sql
\d app_users               -- phải thấy cột home_instance
\d workspace_handoff_codes  -- phải thấy bảng mới
```

## Bước 2 — Set `WORKSPACE_DOMAINS` GIỐNG HỆT NHAU ở cả 3 `backend/.env`

Không cần `INSTANCE_DOMAIN_MAP` (chỉ dùng cho mô hình gộp 1 process, không
áp dụng ở đây). Mỗi deploy vẫn giữ nguyên `CRM_INSTANCE` cố định như hiện tại
(`markee`/`cloudgate`/`SECURITYZONE`), chỉ cần thêm biến này (giá trị PHẢI
giống nhau ở cả 3 nơi):

```
WORKSPACE_DOMAINS={"markee":"https://crm.markee.vn","cloudgate":"https://crm.getcloudgate.com","SECURITYZONE":"https://crm.securityzone.vn"}
```

Sai/thiếu 1 chỗ → switcher/redirect sang đúng brand đó báo lỗi rõ ràng
("chưa cấu hình được domain"), KHÔNG crash, KHÔNG mất dữ liệu.

## Bước 3 — Deploy code như quy trình bình thường (KHÔNG cần đổi NPM)

Mỗi trong 3 thư mục (`crm-module`, `crm-cloudgate`, `crm-securityzone`) đã có
đủ code tính năng này (`auth.py`, `auth_service.py`,
`workspace_handoff_service.py`, `auth_deps.py`, `config.py`) — `git pull` +
rebuild + restart đúng như quy trình deploy đang dùng cho từng host, không
cần thêm bước hạ tầng nào khác. NPM giữ nguyên 4 Proxy Host trỏ đúng 3 port
như hiện tại.

## Bước 4 — Test trên domain thật sau khi deploy cả 3

1. Đăng nhập admin thật trên 1 domain → dùng switcher đổi qua 2 domain còn
   lại → phải vào được, không báo "mã không hợp lệ".
2. Đăng ký 1 tài khoản test mới trên 1 domain → đăng nhập nhầm domain khác →
   phải tự động chuyển hướng về đúng domain đã đăng ký.
3. Tài khoản cũ (tạo trước khi có tính năng này, `home_instance` = NULL) →
   vẫn đăng nhập được ở domain nào cũng được như trước (không bị khoá nhầm).

## Rollback nếu có sự cố

Không cần rollback migration (4 file đều chỉ thêm cột/bảng mới, không đổi gì
code cũ). Nếu code mới gây lỗi ở 1 domain cụ thể — rollback riêng code của
đúng thư mục đó (`git revert`/deploy lại bản trước), 2 domain còn lại không bị
ảnh hưởng vì là 3 deploy độc lập.
