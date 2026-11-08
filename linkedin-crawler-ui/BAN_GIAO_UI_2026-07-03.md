# BÀN GIAO — Đồng nhất UI Seeding theo app.markee + fix Zalo/KPI (2026-07-03)

> Tài liệu này để Thanh quăng cho dev khác code tiếp. Đọc kèm **`DESIGN_SYSTEM.md`**
> (cùng thư mục) — đó là "luật" đồng nhất giao diện; file này là trạng thái + việc còn lại.
>
> **Toàn bộ thay đổi đang ở LOCAL, CHƯA commit/push.** Xem `git status` trong `scraper-linkedin/`.

---

## A. ĐÃ LÀM XONG trong phiên này

### 1. Khung design system (nền tảng đồng nhất) ✅
- Xác nhận app.markee dùng: **shadcn/ui (Radix) + Tailwind v4 + lucide-react + Inter + sonner + recharts**
  (đọc source thật trên VPS `hostserver@10.30.194.50:~/Work/Markee/webapp`, kéo bản tham chiếu về
  `seeding_markee/_markee_design_ref/`).
- Cài đủ Radix packages còn thiếu; copy 13 component shadcn chuẩn từ app.markee vào
  `components/ui/` (dialog, dropdown-menu, avatar, checkbox, label, popover, scroll-area, switch,
  tabs, progress, table, textarea, alert) — đã đổi hex cứng `#ba244a` → token `bg-primary`.
- Sửa `app/globals.css`: thêm bộ `--radius-*` chuẩn shadcn (trước bị ghi đè nhỏ bất thường).
- **Viết `DESIGN_SYSTEM.md`** — token màu, bảng quy đổi Material→shadcn, danh sách component,
  công thức convert 1 trang, bảng trạng thái từng trang. **Đây là tài liệu chính để bám theo.**

### 2. Ba trang đồng nhất trước (theo yêu cầu) ✅
Giữ nguyên 100% logic/chức năng, chỉ đổi lớp hiển thị sang token + component chuẩn:
- **Post Feed** (`components/features/dashboard/UnifiedDashboardHomeContent.tsx` + `post-card.tsx`
  + `post-detail-modal.tsx` + các component trong `all-platform/feed/`, `all-platform/components/`):
  đổi `slate-*`/`surface`/`outline-variant`/`on-surface` → `card/muted/border/foreground`, bỏ hex
  đỏ cứng ở modal kết quả.
- **Inbox Facebook** (`app/(all-platform)/all-platform/inbox/page.tsx` + `TeamAccountTree.tsx`):
  đổi token cũ, thay `MaterialIcon` → `lucide-react`.
- **Quản lý Teams** (`app/(all-platform)/all-platform/admin/teams-management/page.tsx` +
  `AdminTeamModal.tsx` + `AdminMemberKpiModal.tsx`): trước cố tình dùng hệ màu tách biệt (hex
  cứng), giờ đưa về token chung — brand/xám dùng token, màu trạng thái dùng palette Tailwind chuẩn.

### 3. Câu mẫu "Inbox ngay" tự chèn bài khách ✅
- File mới `components/all-platform/components/inbox-templates.ts`: mỗi mẫu có bản `contentWithPost`
  chèn nguyên văn bài khách qua `composeInboxMessage(template, post.content)` →
  *"Chào bạn mình bên Markee. Mình thấy bạn có đăng: «…nội dung khách…». …"*. Bài rỗng (thuần
  ảnh/video) tự fallback về bản gốc. Cắt 300 ký tự nếu bài quá dài.
- Đã nối vào cả `post-card.tsx` và `post-detail-modal.tsx`; preview trong dropdown hiển thị luôn
  bản đã ghép. Nhãn đổi thành "Tự chèn bài khách + Copy".

### 4. CRM Khách hàng — kanban + quick chat ✅
- `components/all-platform/customers/CrmCustomersPage.tsx` viết lại: 2 chế độ **Kanban** (mặc định,
  chia cột theo trạng thái Đang chờ/Đã chốt/Từ chối, **kéo-thả đổi cột** = gọi API update status,
  cập nhật lạc quan) và **Bảng** (như cũ). Toàn bộ dùng token chuẩn.
- File mới `components/all-platform/customers/QuickChatBox.tsx`: **box chat nổi góc phải** kiểu
  Messenger. Nút 💬 KHÔNG chuyển trang inbox nữa mà mở box này. Dùng đúng API Markee service
  (`/sessions`, `/inbox/thread`, `/inbox/reply`, `/inbox/reply_status`). Vì CRM chỉ lưu `conv_id`
  (không lưu acc FB sở hữu), box tự dò lần lượt các acc trong `/sessions` cho tới acc trả về được
  thread, rồi cache lại. Có nút "mở Inbox đầy đủ" và xử lý acc offline (chỉ xem).
- Luồng "Lưu vào CRM" từ Inbox FB → trang này giữ nguyên (không đụng).

### 5. Fix Zalo (nhánh Hoàng `fix/zalo-relogin-ui-loop`) ✅
- Nhánh này **đã nằm trong `restyle-form`** (là ancestor) → không cần merge lại. Audit log runtime
  thật trên VPS dashboard: listener Zalo khoẻ, đang lưu tin đều. Nhưng phát hiện **3 lỗi thật**
  trong log, đã fix ở `linkedin_group_crawler/`:
  1. `auth.py` — filter PostgREST `or` thiếu ngoặc → hiểu nhầm cột `orowner_id` (400). Fix: bọc
     `(owner_id.eq.…,id_member.eq.…)`.
  2. `auth.py` — extension gửi X-User-ID là email nhưng `owner_id`/`id_member` cột uuid → 400
     `invalid uuid`. Fix: thêm `_resolve_app_user_uuid()` resolve email→UUID app_users trước khi
     ghi; owner_id (cột text) giữ nguyên để auto-resolve tra lại được.
  3. `zca_api_server.js` — gọi sai `api.getFriendList()` (không tồn tại trong zca-js) → mỗi lần
     list-friends rơi về spawn-per-call (chậm). Fix: đổi thành `api.getAllFriends()` (khớp
     `zca_api_bridge.js`).
- Đã syntax-check: `node --check` JS OK, `py_compile` auth.py OK (chạy trên VPS).

### 6. KPI — bổ sung Zalo vào RPC teams ✅ (cần chạy SQL)
- Migration mới `linkedin_group_crawler/supabase/migrations/019_admin_teams_kpi_add_zalo.sql`:
  RPC `get_admin_teams_kpi_overview` (trang Teams) trước chỉ tính actual lead/inbox từ Facebook,
  thiếu Zalo. 019 thêm nhánh UNION đếm `zalo_conversation_permissions` đã verify (đúng điều kiện +
  mũi giờ VN như RPC leader migration 012), **và bao gồm luôn fix LATERAL+LIMIT 1 của 018** (chống
  đếm KPI 2 lần). Trọng số KPI giữ nguyên (Lead 45 / Inbox 40 / Comment 5 / Post 10 — trong
  `teams-management/page.tsx`, `computeWeightedPercentage`).

---

## B. VIỆC CÒN LẠI / CẦN QUYẾT ĐỊNH

### 🔴 B1. Thanh phải tự chạy 2 file SQL (mình không có quyền DDL từ xa)
Vào **Supabase Dashboard → SQL Editor → Run**, theo thứ tự:
1. `018_fix_admin_teams_kpi_dup.sql` (nếu chưa chạy — fix đếm KPI 2 lần)
2. `019_admin_teams_kpi_add_zalo.sql` (cộng thêm Zalo — file này đã gộp cả fix 018 nên **chạy 019
   là đủ cả 2**).

### 🟡 B2. Deploy fix Zalo backend (10.120.80.45 — service KHÔNG có git)
3 fix ở mục A5 nằm trong `linkedin_group_crawler/` (chạy trên VPS dashboard 10.30.50.29). Cần
build lại container backend + restart. Lưu ý theo memory: sau mỗi `docker compose build` phải
`docker image prune -f` (đĩa root VPS dashboard hay đầy).

### 🟡 B3. Chưa commit/push — chờ Thanh xem trực tiếp
Toàn bộ UI + fix đang ở local. Build sạch 36/36 route, 4 trang chính HTTP 200, console không lỗi.
Chưa verify được khi ĐĂNG NHẬP THẬT (backend local + CORS chưa dựng). Nếu duyệt: commit theo
prefix cũ (`style(<trang>):`, `fix(zalo):`, `feat(crm):`), push `origin/restyle-form`, rồi build
deploy trên VPS dashboard.

### ⬜ B4. Convert nốt các trang còn lại (theo DESIGN_SYSTEM.md mục 7)
Đăng bài, Quản lý nhóm/danh mục/tài khoản/VPS, Zalo inbox/crawl/chat, Dashboard admin/leader,
Login/Register. Mỗi trang theo checklist mục 6 của DESIGN_SYSTEM.md. **Đây là phần giao cho dev
khác dùng AI làm tiếp** — dán DESIGN_SYSTEM.md vào ngữ cảnh trước khi nhờ AI sửa từng trang.

### ⬜ B5. Extension inbox FB — tối ưu (việc lớn, CHƯA làm, chỉ phân tích)
**Hiện trạng (đã đọc bản live `markee-extension.zip` v2.1.3):** extension đọc inbox bằng **DOM
scraping** — `content.js` querySelector các thread `a[href*="/messages/t/"]` trên Messenger web,
`background.js` mở tab `/messages/t/<id>` (+ fallback `/messages/e2ee/t/<id>`) đọc DOM. Đây là gốc
của "chậm / lấy thiếu / mong manh khi FB đổi layout".

**Đề xuất tối ưu (ưu tiên giảm rủi ro):**
- **Cách tốt nhất — bắt API Messenger thay vì DOM:** dùng `chrome.webRequest`/`declarativeNetRequest`
  chặn request GraphQL của Messenger (doc_id các query `MWChatThreadList`/`MWMessengerThread…`),
  đọc thẳng JSON response thay vì cào DOM. Nhanh hơn nhiều, ổn định hơn, không phụ thuộc class CSS
  đổi liên tục. Rủi ro: e2ee (chat mã hoá đầu cuối) không có nội dung trong GraphQL — vẫn phải giữ
  đường DOM đọc trong tab đã mở làm fallback cho các thread e2ee (bản hiện tại đã có sẵn nhánh e2ee,
  giữ lại).
- **Trước mắt (rẻ):** giảm số lần điều hướng tab thừa, gom scan theo delta (bản page.tsx FE đã có
  `lastSeenPreviewRef` phát hiện tin mới — extension nên tận dụng thay vì scan mù).
- ⚠️ **CẢNH BÁO nghiêm trọng khi đụng extension** (theo memory dự án): source TS ở
  `seeding_markee/extension/` **STALE** so với bản live — bản live có `account_groups`/`scan_groups`
  mà source không có, và bản live hiện là **hand-patch** (không phải build sạch từ source nào). **Đừng
  build đè từ source cũ** — sẽ mất tính năng. Trước khi build+deploy phải diff build mới với zip live
  (grep `account_groups`, `scan_groups`, e2ee fallback) để chắc không mất gì.

### ⬜ B6. Bỏ chức năng đăng bài bằng extension (app đã có)
Bản live extension vẫn có `post_facebook`/`scan_groups` (đăng bài group). Yêu cầu: bỏ phần đăng
bài, chỉ giữ inbox + KPI check. **CHƯA làm** vì đụng đúng vùng hand-patch nhạy cảm (B5). Nên làm
CÙNG lúc với B5 (khi có source sạch), không tách lẻ. Gom 5 extension rời (`api-facebook-get`,
`comment`, `facebook-seeding`, `post-feed`, `zalo-login`) về 1 bộ inbox ổn định.

### ⬜ B7. Tách crawl data thành 3 service / 3 DB + Post Feed chia menu theo mảng
**Yêu cầu:** tách pipeline crawl làm 3 (CNTT riêng / lưu trú-hotel riêng / còn lại) để nhanh + giảm
treo; Post Feed chia 2-3 menu độc lập theo mảng dịch vụ.

**Đề xuất (design, CHƯA code):**
- Backend hiện crawl chung 1 pipeline → 1 bảng posts, phân loại bằng `industry`/`intent` (đã có cột).
  Tách vật lý 3 service + 3 DB là việc hạ tầng lớn; **bước 1 rẻ hơn & đủ hiệu quả:** tách theo
  *worker/queue* per-mảng (cùng code, khác hàng đợi + khác lịch) để không treo lẫn nhau, vẫn ghi
  chung DB nhưng gắn `service_group`. Chỉ khi tải thực sự lớn mới tách DB vật lý.
- **Post Feed chia menu:** thêm tab/menu lọc theo nhóm mảng ngay trên `UnifiedDashboardHomeContent`
  (đã có sẵn `FilterBar` theo `industry`) — gom industry thành 3 preset (CNTT / Lưu trú-Hotel / Khác)
  làm nút chuyển nhanh, không cần đổi backend. Đây là bước làm được ngay khi cần.

---

## C. Môi trường (cho phiên sau)
- Repo local sửa UI: `C:\Users\opc\code\seeding_markee\scraper-linkedin` (branch `restyle-form`,
  `gh` đã đăng nhập `thnkthuhigh`). Dev server qua `.claude/launch.json` → `dev-with-path.cmd`.
- Bản tham chiếu design app.markee: `seeding_markee/_markee_design_ref/`.
- SSH: build VPS `hostserver@10.30.194.50` (pw: xem `docs/INFRASTRUCTURE.md` local); dashboard `vmadmin@10.30.50.29`
  (pw: xem `docs/INFRASTRUCTURE.md` local); service `seeding@10.120.80.45` (pw: xem `docs/INFRASTRUCTURE.md` local). plink/pscp ở `~/bin/`.
