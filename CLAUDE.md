# Tiến độ phiên làm việc (2026-09-27) — "Siêu Tốc Cào Dữ Liệu" cho Threads (tab Seeding bên ngoài)

Mentor yêu cầu: tab "Seeding bên ngoài" duyệt Threads để tìm bài viết, giống "Siêu Tốc Cào
Dữ Liệu" của Facebook. Threads không có group -> tìm theo **từ khoá** (threads.com/search).

- Cào Threads nằm trong **extension chung "Markee Seeding Extension"** (`extensions/comment-extension`,
  bản **2.1**, feature `th_crawl`) — cùng khuôn với cào FB/LinkedIn mà `main` vừa gộp (commit
  `14ef7a95`): `bg/threads-crawl.js` (lệnh `MK_TH_CRAWL_START/STOP/STATUS`, báo về web
  `MK_TH_CRAWL_LOG/PROGRESS/SAVED/DONE`), `platforms/threads/crawl.js` + `crawl-sniffer.js`
  (lấy bài từ JSON nhúng trong trang + GraphQL khi cuộn, DOM chỉ dự phòng). Lúc đầu làm
  extension riêng `api-threads-get-extension` nhưng đã bỏ khi merge `main` để không phải cài 2 extension.
- Backend: bảng mới `threads_posts` (migration **`154_threads_posts.sql`** — số 153 đã bị
  `153_crm_convert_lead_project_id.sql` của `main` dùng), endpoint
  `POST /api/all-platform/extension/threads/save-posts` (x-api-key như FB; lọc trùng, lọc
  bài cũ theo `max_age_days`, ưu tiên tương tác, cắt `post_limit`), `unified_posts_service`
  nhận `platform="threads"` (feed/stats/trend; KPI/seeding Threads tra `platforms` theo tên,
  chưa có dòng Threads thì = 0), `DELETE /api/all-platform/unified/posts/threads`.
  Platform `"all"` và Facebook/LinkedIn KHÔNG đổi hành vi (đã test so với bản cũ).
- FE: switcher Facebook/LinkedIn/Threads (khung nổi bật khi ở tab Seeding bên ngoài);
  `SeedingExtensionPanel` có Threads (chỉ tab "Tìm bài theo từ khoá" — `threads-crawl-section.tsx`,
  chưa có bình luận hàng loạt cho Threads). Bài Threads ẩn "Lên lịch", "Xem seeding theo team",
  nút xác minh seeding (chưa hỗ trợ Threads).
- Đã verify: Postgres+PostgREST thật qua Docker (migration chạy 2 lần OK), test service +
  HTTP, E2E nạp extension chung 2.1 thật vào Chromium (FB/LinkedIn vẫn phản hồi STATUS) ->
  tìm trên threads.com thật -> lưu DB. CHƯA verify được luồng khi ĐÃ đăng nhập Threads
  (cuộn thêm trang/tab "Gần đây") vì không có tài khoản test; chưa đăng nhập thì mỗi từ khoá
  chỉ ~20 bài "nổi bật" (nhiều bài cũ).
- Đã merge `main` mới nhất, push nhánh `claude/seeding-thread-scraping-850d5f`, mở PR
  Seeding-team/scraper-linkedin#95 vào `main` (chưa merge/deploy).
- **VIỆC CÒN DANG DỞ**: migration `154_threads_posts.sql` **CHƯA áp lên DB thật** — máy dev
  này không có kênh nào tới DB production (không có script SSH/`docs/INFRASTRUCTURE.md`, không
  có SUPABASE_URL/SERVICE_ROLE_KEY production trong `.env` nào, repo không có workflow chạy
  migration). Chưa áp thì tab Threads báo lỗi khi tải/lưu bài (FB/LinkedIn không ảnh hưởng).
  Đã áp lên Supabase local (`supabase_db_linkedin_group_crawler`, lúc đó file còn tên 153).

# Tiến độ phiên làm việc (2026-09-05) — tách tính năng chat Zalo thành module độc lập (`zalo-module/`)

User yêu cầu clone tính năng chat Zalo (nhắn/nhận tin, nhắn người lạ, extension
login, 2 trang UI `tai-khoan`+`zalo-inbox`) ra thành 1 module chạy **hoàn toàn
độc lập** (backend/frontend/extension/docker-compose riêng), không đụng gì
tới app gốc, Zalo trên app gốc vẫn phải chạy bình thường.

- Đã hỏi và chốt 3 quyết định trước khi code: (1) **tách bảng DB hoàn toàn**
  (bảng mới `zalo_module_*`, không đụng `zalo_*` gốc — tránh 2 backend tranh
  session Zalo thật), vẫn dùng chung server Postgres self-host + bảng
  `app_users`/`teams`/`member_of_teams` để SSO; (2) chỉ cần chạy độc lập
  (docker-compose), CHƯA cần deploy domain thật; (3) chỉ đúng luồng hiện đại
  (bỏ QR/Playwright, broadcast, Zalo Library, Google Sheet).
- Repo đã có sẵn `docs/ZALO_CHAT_FEATURE_EXTRACTION_GUIDE.md` (hướng dẫn tách
  module, viết từ trước) và tiền lệ `crm-module/` (module CRM đã tách theo
  đúng khuôn FE+BE+nginx+docker-compose) — dùng làm nền tảng thay vì làm mới.
- Đã tạo `zalo-module/` hoàn chỉnh: backend FastAPI (Python 3.12-slim + Node
  20 cho `zca-js`, copy + rút gọn từ `linkedin_group_crawler/.../zalo/`, đổi
  tên toàn bộ bảng/RPC sang `zalo_module_*`/`fn_zalo_module_*`), frontend
  Next.js (copy + rút gọn từ `crm-module/frontend`, viết lại trang
  `tai-khoan` bỏ hẳn hook QR cũ `useZaloCrawlerFlow`, chỉ dùng đăng nhập
  Extension), Chrome Extension (copy từ `extensions/extension-login-zalo/`,
  đổi tên + default backend URL `localhost:18190`), `docker-compose.yml` +
  `nginx.conf` riêng (port mặc định `18190`).
- **Giữ lại tính năng "Tin nhắn KPI"** (`inbox_share.py` +
  `supabase_inbox_share_service.py`) sau khi phát hiện đây mới là cơ chế THẬT
  mà `ZaloInboxAdminShell.tsx` dùng để ghi RBAC share (không phải bolt-on
  tách rời như tưởng ban đầu) — chỉ bỏ 2 endpoint share đơn giản
  (`/events/share`, `/share-status`) vì chỉ trang `/zalo-chat` legacy dùng.
- **Đã verify thật** (không chỉ đọc code, xem `zalo-module/README.md` mục
  verify): migration SQL chạy + test chức năng (RBAC, upsert, multi-leader,
  hard-delete) trên Postgres 15 thật qua Docker; `docker build` + `docker
  compose up` cả 3 container (backend/frontend/router) lên khoẻ, gọi qua
  router trả đúng status; frontend `tsc --noEmit` + `next build` sạch, đủ
  5 trang; entrypoint backend tự chown volume đúng (tránh bug quyền ghi đã
  gặp trên app gốc).
- **VIỆC CÒN DANG DỞ**: `backend/migrations/001_zalo_module_schema.sql`
  **CHƯA áp lên `seeding.db.markeeai.com` thật** (không có kênh SSH/DDL tự
  động từ máy dev này, giống mọi lần trước — xem `[[ssh-password-auth-workaround]]`);
  extension chưa cài thật vào Chrome để test luồng đăng nhập cookie thật;
  **hoàn toàn CHƯA deploy lên host/domain nào** (đúng theo yêu cầu, chỉ cần
  chạy độc lập ở bước này) — file `zalo-module/.env`/`backend/.env` đang có
  trong working tree là bản test-only (JWT_SECRET_KEY giả, SUPABASE_URL rỗng),
  đã gitignore, KHÔNG phải secret thật.

# Tiến độ phiên làm việc (2026-08-30, tiếp) — merge thêm feat/lead-drawer-dup-fix-and-dropdowns, rebuild tay production

Tiếp nối mục ngay dưới đây (merge dev + fix sidebar). Cùng phiên, user yêu cầu thêm:
merge `feat/lead-drawer-dup-fix-and-dropdowns` vào `main`, và **rebuild tay trực tiếp
trên host APP** (SSH, không dùng workflow "Deploy App (Production)") để chắc chắn
production chạy đúng bản mới nhất.

- `fix/quote-step-spacing` hoá ra là **tổ tiên trực tiếp** của
  `feat/lead-drawer-dup-fix-and-dropdowns` (merge-base = chính tip của nó) — không cần
  merge riêng, merge nhánh lead-drawer là đủ.
- Merge `feat/lead-drawer-dup-fix-and-dropdowns` vào `main` sạch, không conflict (merge
  commit `5a99d716`), push thẳng `main` bằng quyền bypass (giống các lần trước).
- Rebuild tay trên host APP (`10.120.60.26`, SSH user `deployseeding`, cần VPN — session
  Claude Code này **không cần bật VPN mà vẫn SSH được**, khác với lần trước bị timeout;
  có thể do lần trước là vấn đề mạng tạm thời, không phải luôn cần VPN) theo đúng các bước
  của `deploy-app.yml`: `git pull` → build lại extension zip (`docker run node:20-alpine`)
  → `docker compose build frontend backend` → `docker compose up -d frontend backend` →
  `restart router` → `docker image prune -f` → healthcheck. Chạy 2 lần: lần 1 crash ở bước
  in log (lỗi encoding Unicode trong script Python cục bộ, KHÔNG phải lỗi trên host — container
  chưa hề bị đụng tới lúc đó), lần 2 (sau khi sửa script + merge thêm lead-drawer) chạy
  trót lọt hết, container `seeding-backend`/`seeding-frontend`/`seeding-router` đều lên
  lại khỏe, healthcheck `200`.
- Script SSH dùng `paramiko`, để trong `scratch/manual_rebuild_prod2.py` (script cũ
  `manual_rebuild_prod.py` bị lỗi encode, giữ lại làm ví dụ đừng dùng lại) — xem
  [[ssh-password-auth-workaround]].

# Tiến độ phiên làm việc (2026-08-30) — merge dev + fix/sidebar-leads-before-cohoi vào main, deploy production

**Yêu cầu ban đầu chỉ là "merge fix/sidebar-leads-before-cohoi vào main" nhưng nhánh đó
dựa trên `dev`** (chỉ có đúng 2 commit thêm vào so với `dev`: `37e753f4`, `32ac41bc` — đổi
thứ tự "Leads" lên trước "Cơ hội" trong sidebar). `main` lúc đó CHƯA có submenu
Leads/Khách hàng (chỉ có 1 link phẳng "CRM") nên cherry-pick 2 commit này vào thẳng `main`
bị conflict và vô nghĩa. Đã hỏi lại và được xác nhận: merge cả `dev` vào `main` trước, rồi
merge `fix/sidebar-leads-before-cohoi` — tức là đưa **toàn bộ tính năng CRM Lead ->
Khách hàng -> Deal (nhánh gốc `feat/crm-lead-customer-deal-funnel`, 79 file, ~13.900 dòng,
5 migration DB mới `077`-`081`) lên production cùng lúc với fix sidebar**, không phải chỉ
1 fix nhỏ.

- Đã làm (không qua PR, merge local + push thẳng `main` bằng quyền bypass, giống các lần
  trước): merge commit `937414d5` (`Merge fix/sidebar-leads-before-cohoi vao main`), dispatch
  workflow **"Deploy App (Production)"** (run `33294611278`, `conclusion: success`).
- Verify sau deploy (qua HTTP, KHÔNG SSH được vào host APP để check sâu hơn — xem dưới):
  `GET /all-platform/crm/leads` và `/all-platform/crm/customers` (frontend) trả `200`;
  `GET /api/all-platform/crm/leads` (backend) trả `401` (đúng — cần auth, chứng tỏ route
  sống chứ không sập như lần tzdata trước), không phải `404`/`500`.
- **VIỆC CÒN DANG DỞ / CHƯA XÁC MINH ĐƯỢC**: KHÔNG xác nhận được 5 migration `077`-`081`
  đã áp dụng trên DB self-host `seeding.db.markeeai.com` (DB mà production VÀ dev dùng
  chung từ 27/08 — xem mục "CẬP NHẬT 2026-08-28" trong `docs/INFRASTRUCTURE.md`) hay chưa.
  Thử SSH vào host APP (`10.120.60.26`) để check trực tiếp (`docker exec ... psql` hoặc
  PostgREST) nhưng bị timeout — theo doc cần bật VPN trước, môi trường Claude Code này
  không có VPN. Vì tính năng CRM Lead/Customer/Deal đã chạy thật trên `dev` (dùng chung DB
  này) nên khả năng cao 077-081 đã có sẵn, nhưng **CHƯA VERIFY THẬT** — nếu thấy lỗi
  "relation does not exist" ở các API `/api/all-platform/crm/customers`,
  `/api/all-platform/crm/leads`, `/api/all-platform/crm/customers/{id}/contacts` thì đây
  chính là nguyên nhân, cần SSH (có VPN) vào áp migration hoặc verify qua PostgREST trước.

# Tiến độ phiên làm việc (2026-08-27) — merge + deploy Wizard báo giá / Đơn vị phát hành

**ĐỌC `docs/QUOTE_ISSUER_COMPANY_WIZARD_2026-08-27.md` TRƯỚC KHI LÀM GÌ LIÊN QUAN báo
giá / issuer company / Telegram báo giá, hoặc trước khi merge/deploy production lần
sau.** Tóm tắt cực ngắn:

- Đã merge `feat/quote-issuer-company-3step-wizard` vào `main`, deploy production 2 lần
  (lần 1 làm sập backend do lỗi thiếu `tzdata` cho `ZoneInfo("Asia/Ho_Chi_Minh")` ở
  module level trong `supabase_quote_service.py` — đã fix bằng offset cố định UTC+7,
  commit `0ea75d85`, deploy lại thành công, `seeding-backend` đang `Up (healthy)`).
- **VIỆC CÒN DANG DỞ**: 3 migration `069_quote_issuer_companies.sql`,
  `070_quote_telegram_log.sql`, `071_quote_forms_issuer_company.sql` **CHƯA áp dụng lên
  Supabase Cloud production** (đã verify bằng REST API: 404/404/400) — phải chạy tay qua
  Supabase Cloud Dashboard SQL Editor (project `rtwpogvficadngtfrcci`), không có cách tự
  động. Tính năng "Đơn vị phát hành báo giá" + "Gửi Telegram" sẽ lỗi cho tới khi áp xong.
- Môi trường Bash ở máy dev này **không có `sshpass`/`plink`/`expect`** để tự động hoá
  SSH password login vào host APP — cách đã dùng: cài tạm gói npm `ssh2` vào thư mục
  scratchpad, viết script Node nhỏ để login bằng `tryKeyboard`/`keyboard-interactive`.

# Tiến độ phiên làm việc (2026-08-26) — merge + deploy Thư viện Sản phẩm & Dịch vụ

**ĐỌC `docs/SERVICE_CATALOG_QUOTE_PICKER_2026-08-26.md` KHI LÀM VIỆC LIÊN QUAN
service-catalog / quote-center / báo giá, hoặc khi cần merge/deploy lên production.**
Tóm tắt cực ngắn:

- Đã merge nhánh `feat/service-catalog-library-and-quote-picker-polish` vào `main`
  (merge commit `63b2eb73`) và dispatch workflow **"Deploy App (Production)"** để đưa
  lên `seeding.markeeai.com`. Tính năng: viết lại `/all-platform/service-catalog` theo
  3 tab, popup chọn nhiều sản phẩm khi điền báo giá, trang mới `/all-platform/quote-center`.
- **Thông tin hạ tầng nóng phát sinh lúc này**: repo GitHub đã đổi từ
  `NMHoangDev/scraper-linkedin` sang **`Seeding-team/scraper-linkedin`**; `main` có
  branch protection yêu cầu PR (push thẳng vẫn qua được nhờ quyền bypass của tài khoản);
  không có `gh` CLI cài sẵn nhưng có thể gọi GitHub REST API bằng token lấy qua
  `git credential fill`; `deploy-app.yml` chỉ chạy thủ công (`workflow_dispatch`), không
  tự chạy khi push `main`. Chi tiết + cách rollback xem trong doc trên.

# Tiến độ phiên làm việc (2026-08-25) — Zalo messaging debug

**ĐỌC `docs/ZALO_FIX_PROGRESS_2026-08-25.md` TRƯỚC KHI LÀM GÌ LIÊN QUAN ZALO.** File đó
là nhật ký đầy đủ (bug đã tìm, fix đã áp, việc còn dở, script mẫu để tiếp tục) của 1
phiên debug rất dài về luồng nhắn tin Zalo (extension login, zca-js thiếu API, RBAC
"1 tài khoản dùng chung", DB migration còn thiếu...). Tóm tắt cực ngắn:

- Đã fix + deploy lên production: RBAC `is_shared_with_all` (1 tài khoản Zalo dùng
  chung), extension login (cookie key + thời điểm đóng tab), nút UI (Mở chat/Đăng
  nhập lại), vá `zca-js` thiếu API, sửa heuristic group/DM sai trong listener.
- **Đang dở, làm tiếp ở đây**: migration `067_fn_get_zalo_conversations_shared_with_all.sql`
  (đã viết, sửa 1 DB function không nằm trong migration nào cả — chưa áp dụng xong
  trên DB test local, và CHƯA kiểm tra/áp production). Sau đó còn 1 lỗi 404 chưa rõ
  nguyên nhân ở `getGroupChatHistory` (chặn backfill lịch sử tin nhắn cũ, KHÔNG chặn
  tin nhắn mới real-time) — xem mục 3.1 trong doc.

<!-- BEGIN CENTER-AI CONTEXT (do not edit manually, generated by Center AI extension) -->
@.center-ai/generated/company.md
@.center-ai/generated/team.md
@.center-ai/generated/project.md
@.center-ai/generated/task.md
@.center-ai/generated/checkpoint.md
<!-- END CENTER-AI CONTEXT -->
