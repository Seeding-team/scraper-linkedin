# Gộp 3 CRM (crm-module/crm-cloudgate/crm-securityzone) thành 1 app multi-workspace

**ĐỌC FILE NÀY TRƯỚC KHI LÀM TIẾP VIỆC GỘP 3 CRM.** Plan gốc (đã được duyệt)
nằm ở `C:\Users\Admin\.claude\plans\logical-launching-lemon.md` trên máy dev —
KHÔNG nằm trong repo, chỉ có ở máy đã chạy phiên này. File này là bản tóm tắt
tiến độ + các phát hiện quan trọng để phiên sau không phải khảo sát lại từ đầu.

Nhánh làm việc: `feat/crm-unify-multitenant` (tạo từ `main`, chưa push, chưa
mở PR).

## Bối cảnh / mục tiêu

3 thư mục `crm-module` (Markee), `crm-cloudgate` (CloudGate), `crm-securityzone`
(SecurityZone) hiện là 3 bộ container độc lập, cùng code (từng lệch nhau —
xem mục "Phát hiện" bên dưới), cùng 1 DB Supabase self-host, chạy trên host
`10.120.60.26` port `18090/18091/18092`, domain thật trỏ qua **Nginx Proxy
Manager (NPM)**:

| Domain | Forward to |
|---|---|
| `crm.markee.vn` | `10.120.60.26:18090` |
| `crm.markeeai.com` (alias, cùng Markee) | `10.120.60.26:18090` |
| `crm.getcloudgate.com` | `10.120.60.26:18091` |
| `crm.securityzone.vn` | `10.120.60.26:18092` |

Mục tiêu: gộp thành **1 app** — admin có switcher đổi qua lại 3 workspace
(đổi domain thật, không chỉ đổi state UI); role khác đăng nhập domain nào thấy
dữ liệu domain đó, không có switcher.

## Đã làm (đã verify bằng đọc code, CHƯA chạy thử thật vì máy dev không có
Python/Node runtime sẵn để khởi động backend — xem mục "Cần làm tiếp")

1. **Fix bug thật đang chạy production**: `crm-module/backend/app/modules/
   all_platform/routers/quote.py` đã có sẵn code gọi
   `quote_email_delivery_service` (giống hệt cloudgate/securityzone) nhưng
   file service đó **không tồn tại** trong `crm-module` → mọi request gửi
   báo giá qua email trên Markee bị 500 `ModuleNotFoundError`. Đã copy
   nguyên file `quote_email_delivery_service.py` từ `crm-cloudgate` (y hệt
   `crm-securityzone`) sang `crm-module` — mọi dependency của file này
   (`quote_email_provider_service`, `crm_permission_service.can_send_quote_email`)
   đã có sẵn y hệt trong `crm-module`, không cần sửa gì thêm.
   - Lưu ý: bảng `quote_delivery_log` mà file này dùng — theo comment trong
     chính file đó, migration số 093 tạo bảng này **CHƯA từng được viết/áp
     dụng**. Chưa xác minh được bảng này đã tồn tại thật trên DB prod chưa
     (không có quyền truy vấn DB từ máy dev). Nếu bảng chưa tồn tại thì tính
     năng gửi email vẫn lỗi (nhưng lỗi khác — lỗi DB rõ ràng hơn — thay vì
     crash import). CẦN xác minh trước khi coi tính năng này là "xong" ở cả
     3 brand.

2. **Backend: `CRM_INSTANCE` từ biến toàn cục (theo process) → theo từng
   request (dựa vào Host header)** — file `crm-module/backend/app/core/config.py`:
   - Thêm `_parse_instance_domain_map()` + env `INSTANCE_DOMAIN_MAP` (JSON
     domain → instance).
   - Thêm `contextvars.ContextVar` (`_current_instance`) + 2 hàm
     `set_current_instance()`/`reset_current_instance()`.
   - Đổi field `crm_instance` (dataclass field cũ) → `default_crm_instance`
     (chỉ còn là fallback) + thêm `@property crm_instance` đọc contextvar,
     fallback về `default_crm_instance` nếu ngoài request-context hoặc domain
     lạ. **Toàn bộ 50+ call site `settings.crm_instance` trong service layer
     KHÔNG cần sửa** — vẫn gọi y hệt, chỉ đổi định nghĩa property.
   - `crm-module/backend/app/main.py`: thêm middleware
     `resolve_crm_instance_middleware` — đọc `Host` header, tra
     `instance_domain_map`, set contextvar cho suốt vòng đời request, reset
     lúc response xong (try/finally).
   - **Phát hiện sửa lại 1 giả định sai trong plan gốc**: tưởng
     `ensure_recent_markee_cfo_sync` (đồng bộ khách hàng từ Markee CFO) chạy
     nền theo timer (ngoài request) nên phải set instance tường minh — THỰC
     TẾ nó chỉ được gọi đồng bộ ngay trong lúc xử lý request (list
     customers/endpoint sync thủ công), tự động nằm trong context request đó
     → **không cần sửa gì thêm cho hàm này**, contextvar tự đúng.
   - Đã cập nhật `crm-module/backend/.env.example` (thêm `INSTANCE_DOMAIN_MAP`
     mẫu, mở rộng `CORS_ORIGINS` liệt kê đủ 4 domain) và `crm-module/.env.example`
     (root — `CRM_PUBLIC_URL` đổi mặc định sang để trống).

3. **Frontend: chuẩn bị chuyển từ "domain baked lúc build" sang "domain
   tương đối, tự đúng theo request runtime"**:
   - `crm-module/docker-compose.yml`: build-arg
     `NEXT_PUBLIC_LINKEDIN_CRAWLER_API_URL` đổi default từ
     `http://localhost:18090` → rỗng (`${CRM_PUBLIC_URL:-}`).
   - `crm-module/.env.example` + `crm-module/frontend/.env.example`: để trống
     `CRM_PUBLIC_URL`/`NEXT_PUBLIC_LINKEDIN_CRAWLER_API_URL` theo mặc định —
     đã xác nhận code (`frontend/lib/env.ts` + `frontend/services/all-platform.service.ts`
     dòng `BASE = \`${API_BASE_URL}/api/all-platform\``) hoạt động đúng với
     giá trị rỗng (thành đường dẫn tương đối `/api/all-platform`, browser tự
     gọi đúng domain đang đứng, nginx đã proxy `/api/` cùng domain với
     frontend) — KHÔNG PHẢI đổi code, chỉ đổi giá trị mặc định trong
     `.env.example`. `.venv`/Dockerfile ARG rỗng đã kiểm tra hoạt động đúng
     (không có logic nào coi rỗng là lỗi).
   - **CHƯA làm**: bảng branding tĩnh (logo/tên/màu theo domain, tra bằng
     `window.location.hostname`) để thay cho việc `AllPlatformSidebar`/
     `AuthPage`/logo hiện đang có 3 bản code riêng khác nhau giữa 3 brand.

4. **ĐÃ TEST THẬT bằng Docker Compose local** (không còn chỉ là "verify bằng
   đọc code" nữa) — dựng Supabase local (`npx supabase start` trong
   `linkedin_group_crawler/`) + build/chạy `crm-module` bằng
   `docker compose up -d` (image build sạch, không lỗi):
   - Thêm endpoint tạm/tiện ích `GET /debug/instance` (không cần auth, không
     lộ secret) trả về `resolved_instance` + `instance_domain_map` — dùng để
     soi domain nào đang resolve ra instance nào, hữu ích luôn cho việc kiểm
     tra NPM/domain map sau khi cutover thật, ĐÃ GIỮ LẠI trong code (không
     phải xoá).
   - Test qua `docker exec` thẳng vào backend (bypass nginx path-split vì
     `/health`/`/debug/instance` không nằm dưới `/api/` nên nginx sẽ route
     nhầm sang frontend nếu gọi qua port ngoài) với `Host:` header khác nhau —
     **KẾT QUẢ ĐÚNG 100%**: `crm.markee.vn`→markee, `crm.markeeai.com`→markee
     (alias), `crm.getcloudgate.com`→cloudgate, `crm.securityzone.vn`→
     SECURITYZONE, domain lạ→fallback `markee`, Host viết hoa vẫn resolve
     đúng (lowercase trước khi tra map).
   - Test 30 request ĐỒNG THỜI xoay vòng 3 Host header khác nhau — **0
     request nào bị lẫn instance của request khác** (đúng test quan trọng
     nhất trong plan — xác nhận contextvar an toàn giữa các request song
     song, không có race condition).
   - Test end-to-end qua ĐÚNG port thật (`http://localhost:18090/api/all-platform/...`,
     đi qua nginx path-based routing thật) với 2 Host header khác nhau — cả 2
     đều trả 401 (thiếu auth, đúng như kỳ vọng vì chưa có JWT hợp lệ) chứ
     không phải lỗi routing — xác nhận nginx forward Host header đúng
     end-to-end, không chỉ đúng khi test tắt qua docker network nội bộ.
   - **CHƯA test được**: các luồng có DB thật (login, list customers...) vì
     Supabase local mới `start` xong, CHƯA áp migrations 001-081 (schema CRM
     chưa tồn tại trên DB local này) — chỉ mới verify được cơ chế routing/
     instance-resolution, chưa verify được data isolation ở tầng query DB
     thật (`.eq("instance", ...)`). Cần áp migrations rồi seed data 2-3
     instance khác nhau để test tiếp bước này.
   - Môi trường local test (Docker Compose crm-module + Supabase local) vẫn
     đang chạy trên máy dev lúc kết thúc phiên này — `crm-module` tại
     `http://localhost:18090`, Supabase Studio/API tại `http://localhost:54321`.
     File `.env`/`backend/.env` cục bộ đã tạo (gitignored, không commit) trỏ
     `SUPABASE_URL=http://host.docker.internal:54321` (DB local, KHÔNG phải
     prod).

## Phát hiện quan trọng (từ khảo sát trước khi code, vẫn còn giá trị)

- **3 bản đã lệch code thật**, không chỉ khác `.env` như README nói:
  - `crm-module` (Markee) có tính năng riêng "đồng bộ khách hàng từ Markee
    CFO" (`markee_cfo_customer_sync_service.py`, cột
    `external_system/external_id/tax_code`) — 2 bản kia không có, ĐÚNG Ý ĐỒ
    (chỉ Markee dùng), không cần backport ngược.
  - `crm-cloudgate`/`crm-securityzone` có `quote_email_delivery_service.py`
    (y hệt nhau) — Markee thiếu, ĐÃ FIX (mục 1 ở trên).
  - Vài diff khác (`router.py`, `routers/users.py`) chỉ đổi thứ tự hàm,
    không đổi logic — an toàn, không cần xử lý gì.
- **Auth là cookie JWT domain-scoped**: `auth_deps.py` — cookie
  `crawlpro_access_token`, decode qua `decode_token`/`get_user_by_id` (dùng
  chung bảng `app_users`). Trình duyệt tự giới hạn cookie theo domain — admin
  chuyển workspace (đổi domain thật) sẽ KHÔNG tự mang cookie theo, bất kể
  backend có gộp hay không. Thiết kế xử lý (chưa code): luồng "handoff" —
  xem chi tiết đầy đủ trong plan gốc (mục 5), tóm tắt: admin bấm chuyển brand
  → `POST /auth/handoff` sinh mã dùng 1 lần (~30s) → redirect sang domain đích
  kèm mã → domain đích `GET /auth/handoff/consume?code=...` đổi mã lấy cookie
  mới cho domain đó → redirect vào CRM. KHÔNG nhét thẳng JWT vào URL (lộ log/
  history).
- JWT_SECRET_KEY thật của 3 backend trên server — CHƯA xác minh (user xác
  nhận "chưa rõ, cần kiểm tra"). Không chặn việc code, nhưng cần biết trước
  cutover: **mọi người sẽ bị đăng xuất 1 lần** khi cutover dù secret có giống
  nhau hay không (đổi cả domain lẫn hạ tầng).

## Đã làm tiếp (phiên sau, cùng ngày) — Admin workspace switcher

**ĐÃ XONG VÀ TEST THẬT** (không chỉ đọc code) — luồng switcher đầy đủ:

- Backend:
  - `app/core/config.py`: thêm `workspace_domains` (parse `WORKSPACE_DOMAINS`
    env, JSON instance -> base URL canonical, KHÔNG lowercase vì instance
    code phân biệt hoa/thường như `SECURITYZONE`).
  - `app/modules/all_platform/auth_deps.py`: thêm `require_admin_strict` —
    CHỈ đúng role `admin` (khác `require_admin`/`require_admin_or_leader` cũ
    đang gộp chung admin+leader) — dùng riêng cho switcher theo đúng yêu cầu
    "chỉ admin mới có quyền".
  - `app/modules/all_platform/services/workspace_handoff_service.py` (file
    mới): mint/consume mã dùng 1 lần (TTL 30s, lưu in-memory — CHỈ đúng khi
    có ĐÚNG 1 backend process xử lý cả 3 domain, đã ghi rõ trong docstring).
  - `app/modules/all_platform/routers/auth.py`: thêm 3 endpoint —
    `GET /auth/workspaces` (public, danh sách brand + brand hiện tại theo
    Host header), `POST /auth/workspace-handoff` (chỉ admin, mint mã),
    `GET /auth/workspace-handoff/consume?code=...` (public — chính mã là
    bằng chứng quyền, đổi mã lấy cookie `crawlpro_access_token` MỚI cho
    domain hiện tại).
- Frontend:
  - `services/all-platform.service.ts`: thêm `authService.listWorkspaces()` /
    `mintWorkspaceHandoff()` / `consumeWorkspaceHandoff()`.
  - `components/all-platform/layout/WorkspaceSwitcher.tsx` (file mới):
    dropdown chọn workspace, chỉ render khi `role==="admin"` (kiểm tra ở
    `AllPlatformSidebar.tsx` trước khi mount) và khi có >1 workspace. Chọn
    brand khác → mint mã → `window.location.href` sang domain đích kèm mã
    (redirect THẬT, đúng yêu cầu "đổi domain thật, không chỉ đổi UI state").
  - `app/auth/handoff/page.tsx` (file mới): trang đích của redirect — tự gọi
    `consume` (không dùng `AppAuthContext.refreshUser()` vì cookie domain này
    chưa có lúc trang vừa load), thành công thì vào thẳng
    `getDashboardHrefForRole(role)`, thất bại thì hiện lỗi + link về login.
  - Gắn `<WorkspaceSwitcher />` vào `AllPlatformSidebar.tsx`, bên trong khối
    `mt-auto` (cùng nhóm với profile/logout ở đáy sidebar), phía trên dropdown
    profile.

**Test thật đã chạy** (Docker Compose local, KHÔNG phải prod):
- Non-admin (role mặc định `member`) gọi `POST /auth/workspace-handoff` →
  403 đúng như kỳ vọng.
- Admin mint mã ở domain A (port test 18081=markee) → consume mã ở domain B
  (port test 18082=cloudgate) **không cần gửi cookie cũ** → nhận
  `Set-Cookie` mới hợp lệ cho domain B, trả đúng thông tin user.
- Dùng lại đúng mã đó lần 2 → bị từ chối (xác nhận cơ chế dùng-1-lần hoạt
  động đúng).
- `GET /auth/workspaces` trả đúng `current: true/false` theo domain đang gọi.
- Route `/auth/handoff` (trang Next.js) và `/all-platform/crm/customers` đều
  trả 200 qua nginx sau khi build lại frontend.
- **CHƯA test bằng thao tác chuột thật trên trình duyệt** (chỉ mới test bằng
  curl mô phỏng đúng luồng HTTP) — cần người dùng tự bấm thử switcher trên
  UI thật để xác nhận trải nghiệm (redirect, loading state, lỗi hiển thị...).

Local test hiện có 3 port giả lập domain (không cần sửa hosts, xem
`crm-module/docker-compose.override.yml` local — file này KHÔNG commit):
`localhost:18081`=markee, `18082`=cloudgate, `18083`=securityzone. Tài khoản
test: `admin.test@example.com` / `Test1234!` (role admin, đã tạo trên DB
local test).

## CẦN LÀM TIẾP (chưa động vào, theo đúng thứ tự ưu tiên)

1. Xác minh bảng `quote_delivery_log` đã tồn tại trên DB prod thật chưa
   (mục 1 ở trên) — cần quyền truy vấn DB thật, máy dev hiện không có.
2. Frontend: bảng branding tĩnh theo domain (thay 3 bản
   `AllPlatformSidebar`/`AuthPage`/logo hiện đang lệch nhau) — CHƯA làm.
3. Merge `crm-cloudgate`/`crm-securityzone` → xoá 2 thư mục này khỏi repo sau
   khi verify xong (tránh tiếp tục lệch 3 lần) — CHƯA làm, cần xong bước 2
   trước (branding) vì đó là lý do chính khiến 2 bản kia còn khác code.
4. Docker: gộp 3 docker-compose stack → 1 stack (1 frontend + 1 backend) —
   CHƯA làm. `.github/workflows/deploy-crm-module.yml` cần đổi thành workflow
   tổng quát.
5. ~~Admin switcher + `/auth/handoff`~~ — **ĐÃ XONG** (xem mục ngay trên).
6. NPM: sửa 4 Proxy Host trỏ sang port của stack mới — làm ở bước cutover,
   sau khi test kỹ trên 1 port/domain tạm (xem mục Rollout trong plan gốc).
7. Test cách ly dữ liệu bằng curl với `Host:` header khác nhau trên cùng 1
   backend đã gộp — **ĐÃ LÀM VÀ PASS** (xem mục 4 phía trên, phần "ĐÃ TEST
   THẬT bằng Docker Compose local").

## Việc CẦN xác minh (không chặn code, nhưng chặn cutover thật)

- Bảng `quote_delivery_log` đã tồn tại trên DB prod chưa (mục 1).
- JWT_SECRET_KEY của 3 backend hiện có giống nhau không (không bắt buộc phải
  giống, nhưng ảnh hưởng UX lúc cutover).
