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
5. Admin switcher + `/auth/handoff` (endpoint mint + consume mã dùng 1 lần) —
   CHƯA làm, phần phức tạp nhất, làm sau cùng khi phần nền (bước 1-4) đã ổn.
6. NPM: sửa 4 Proxy Host trỏ sang port của stack mới — làm ở bước cutover,
   sau khi test kỹ trên 1 port/domain tạm (xem mục Rollout trong plan gốc).
7. Test cách ly dữ liệu bằng curl với `Host:` header khác nhau trên cùng 1
   backend đã gộp (xem mục Verification trong plan gốc) — BẮT BUỘC làm trước
   khi cutover thật, chưa làm được ở phiên này vì thiếu Python runtime trên
   máy dev để khởi động backend thử.

## Việc CẦN xác minh (không chặn code, nhưng chặn cutover thật)

- Bảng `quote_delivery_log` đã tồn tại trên DB prod chưa (mục 1).
- JWT_SECRET_KEY của 3 backend hiện có giống nhau không (không bắt buộc phải
  giống, nhưng ảnh hưởng UX lúc cutover).
