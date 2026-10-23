# TỔNG QUAN HỆ THỐNG — SCRAPER-LINKEDIN (DỰ ÁN SEEDING / CRM / OMNICHANNEL / BÁO GIÁ)

> **Tài liệu Context Chuẩn Hóa Cốt Lõi Hệ Thống**  
> **Cập nhật:** 2026-10-22  
> **Thẩm định:** Biệt đội Aevum (Anh Ba Gà, Anh Trường Con, Kael, Vidus, An, Luna, Độ Mixi, Pew Pew, Khang Rồng)

---

## 1. MỤC TIÊU & TỔNG QUAN DỰ ÁN
`scraper-linkedin` là nền tảng Monorepo tập trung phục vụ toàn bộ chuỗi vận hành Seeding, Bán hàng và Quản trị khách hàng:
1. **Automation & Seeding Đa Kênh**: Cào bài viết, quản lý tài khoản, tương tác và lên lịch bình luận tự động trên **Facebook, LinkedIn, Threads, YouTube**.
2. **Omnichannel Inbox & Chat Ops**: Hệ thống chat và tự động hóa tập trung cho **Zalo** (persistent ZCA listener, Forward Engine, Campaign Worker) và **Telegram** (Telethon async client).
3. **CRM Quản Lý Khách Hàng (Pipeline & Kanban)**: Quản lý vòng đời khách hàng từ Lead -> Tiếp cận -> Đề xuất -> Ký hợp đồng.
4. **Hệ Thống Báo Giá Đa Tiền Tệ (Quotes VND / USD)**: Đóng băng tỷ giá (`currency_snapshot`), tự động chuyển đổi tiền tệ, xuất bản báo giá Online và render file PDF khổ A4 ngang/dọc linh hoạt.
5. **Quản Lý Hợp Đồng (Contracts Engine)**: Đổ dữ liệu vào template file Word DOCX, AI Copilot bóc tách và đánh giá rủi ro điều khoản, theo dõi phiên bản thay đổi (Version Diff).
6. **Đo Lường KPI (KPI Reward Engine)**: Tự động ghi nhận số lượng comment seeding, số lượt trả lời inbox và chuyển đổi lead để tính thưởng theo KPI rules.

---

## 2. KIẾN TRÚC HẠ TẦNG & PORT MAPPING CHI TIẾT

### 2.1. Bản Đồ Port Dịch Vụ
| Dịch vụ | Ngăn xếp (Stack) | Port nội bộ / Container | Port Public / Host | Máy chủ triển khai | Ghi chú |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Main Web UI** | Next.js 16 (App Router) | `3000` | — | 10.30.50.29 (Dev) / 10.120.60.26 (Prod) | `linkedin-crawler-ui` |
| **Main Backend API** | FastAPI (Python 3.10) | `8000` | — | 10.30.50.29 (Dev) / 10.120.60.26 (Prod) | `linkedin_group_crawler` |
| **Nginx Reverse Proxy** | Nginx Alpine | `8080` | **`8080`** | `seeding.markeeai.com` | Proxy `/` -> FE, `/api/*` -> BE |
| **CRM Module (Core)** | Next.js + FastAPI | `3000` + `8000` | **`18090`** | 10.120.60.26 (Prod) | Deploy độc lập |
| **CRM Cloudgate** | Next.js + FastAPI | `3000` + `8000` | **`18091`** | 10.120.60.26 (Prod) | Tenant Cloudgate |
| **CRM SecurityZone** | Next.js + FastAPI | `3000` + `8000` | **`18092`** | 10.120.60.26 (Prod) | Tenant SecurityZone |
| **CRM TimeTech** | Next.js + FastAPI | `3000` + `8000` | **`18093`** | 10.120.60.26 (Prod) | Tenant TimeTech |
| **Zalo Standalone Module** | Next.js + FastAPI | `3000` + `8000` | **`18190`** | Local / Staging | Bản sao tách riêng Zalo Chat |

### 2.2. Đường Đi Triển Khai CI/CD (`.github/workflows`)
1. **`deploy-dev.yml`**: Tự động kích hoạt khi push vào nhánh `dev`. Chạy trên self-hosted runner máy Dev (`10.30.50.29`). Tự động build extensions zip vào `public/*.zip`, sau đó `docker compose build frontend backend`.
2. **`deploy-app.yml`**: Kích hoạt thủ công qua giao diện GitHub Actions (`workflow_dispatch`). Chạy trên self-hosted runner máy Prod (`10.120.60.26`). Tự động dọn dẹp Docker cache nếu dung lượng ổ đĩa < 8GB để chống nghẽn bộ nhớ đĩa.
3. **`deploy-crm-*.yml`**: Tự động rsync mã nguồn sang `/opt/apps/crm-*/`, build và restart container độc lập theo từng tenant.

---

## 3. CƠ SỞ DỮ LIỆU & SCHEMA HIGHLIGHTS (SUPABASE POSTGRES)
- **Tổng số migration đã áp dụng**: 211 file (từ `001_...` tới `192_timetech_issuer_company.sql`).
- **Tổng số bảng cốt lõi**: 58 bảng, phân thành 6 nhóm nghiệp vụ chính:
  1. **Tài khoản & Phân quyền**: `app_users`, `teams`, `member_of_teams`, `leader_codes`.
  2. **Cào dữ liệu & Tương tác**: `facebook_groups`, `facebook_posts`, `linkedin_groups`, `linkedin_posts`, `crawl_jobs`, `crawl_workers`, `vps`, `Vps_cookies`.
  3. **Hệ thống Đo lường KPI**: `kpi_tracker`, `kpi_reward_rules`, `kpi_reward_rule_logs`, `fb_inbox_kpi`, `fb_post_kpi`, `seeding_content_kpi`.
  4. **Khách hàng CRM**: `customer_leads`, `customer_lead_activity_log`.
  5. **Báo giá & Hợp đồng**: `quotes`, `quote_items`, `quote_forms`, `quote_issuer_companies`, `contracts`, `contract_activity_log`, `service_catalog_items`.
  6. **Zalo & Hội thoại**: `zalo_accounts`, `zalo_users`, `zalo_groups`, `zalo_messages`, `zalo_conversation_permissions`, `zalo_broadcast_campaigns`, `conversations`.

---

## 4. BẢNG ĐO LƯỜNG NỢ KỸ THUẬT & DANH SÁCH FILE "KHỔNG LỒ"

### 4.1. Top 10 Component Frontend Lớn Nhất Cần Chia Nhỏ
| STT | Đường dẫn Component UI | Số dòng | Vấn đề trọng tâm |
| :---: | :--- | :---: | :--- |
| 1 | `app/(all-platform)/all-platform/internal-engagement/page.tsx` | **3,180** | Trang tương tác nội bộ quá dài, chứa cả logic kéo post, modal và filter. |
| 2 | `components/all-platform/zalo/dashboard/ZaloChatView.tsx` | **3,007** | Nhồi nhét toàn bộ rendering tin nhắn, media, gửi audio, mention vào 1 file. |
| 3 | `components/all-platform/zalo/admin-inbox/ZaloInboxAdminShell.tsx` | **2,812** | Shell quản trị Zalo inbox quá nhiều quyền hạn và logic phân quyền. |
| 4 | `components/all-platform/group-management.tsx` | **2,237** | Bảng quản lý nhóm đa nền tảng chứa hàng tá sub-components inline. |
| 5 | `components/features/dashboard/CategoryManagementContent.tsx` | **1,657** | Quản lý danh mục cào trộn lẫn state form và danh sách bảng. |
| 6 | `components/all-platform/kpi-rewards/KpiRewardSections.tsx` | **1,478** | Logic tính thưởng và bảng quy tắc KPI viết dính liền. |
| 7 | `components/all-platform/inbox/InboxModernLayout.tsx` | **1,417** | Layout chat đa kênh chứa state chuyển tab và danh sách hội thoại. |
| 8 | `app/(all-platform)/all-platform/inbox/page.tsx` | **1,350** | Trang inbox chính chứa nhiều modal phụ trợ chưa tách. |
| 9 | `components/all-platform/admin/MemberManagementContent.tsx` | **1,339** | Quản lý thành viên, gán team, cấp quyền dồn vào một file. |
| 10 | `components/facebook-crawler/.../dashboard-post.tsx` | **1,167** | Bảng bài viết Facebook chứa inline modal duyệt và chấm điểm. |

### 4.2. Top 10 Service & Router Backend Lớn Nhất Cần Tách Lớp
| STT | Đường dẫn File Backend | Số dòng | Vấn đề trọng tâm |
| :---: | :--- | :---: | :--- |
| 1 | `app/modules/linkedin/router.py` | **3,114** | Router LinkedIn chứa cả logic crawling, session, reaction, filter bài viết. |
| 2 | `app/modules/all_platform/services/supabase_quote_service.py` | **2,939** | Service báo giá ôm toàn bộ tính toán chiết khấu, tỷ giá, render snapshot. |
| 3 | `app/modules/all_platform/zalo/services/supabase_service.py` | **2,214** | Service Zalo thao tác DB ôm tất cả các bảng hội thoại, tin nhắn, broadcast. |
| 4 | `app/modules/all_platform/services/supabase_kpi_service.py` | **2,127** | Gom mọi loại tính điểm KPI (Inbox, Seeding, Lead) vào một service. |
| 5 | `app/modules/all_platform/services/supabase_internal_engagement_kpi_service.py` | **1,865** | Xử lý KPI tương tác chéo nội bộ. |
| 6 | `app/modules/linkedin/schemas/request_models.py` | **1,836** | File schema khổng lồ cho LinkedIn. |
| 7 | `app/modules/all_platform/zalo/api/routes/conversations.py` | **1,834** | Router hội thoại Zalo chứa cả xử lý media và websocket push. |
| 8 | `app/modules/all_platform/routers/quote.py` | **1,555** | Router báo giá ôm từ quản trị biểu mẫu, phê duyệt tới public token. |
| 9 | `app/modules/all_platform/services/unified_posts_service.py` | **1,363** | Service gom bài viết thống nhất 4 nền tảng. |
| 10 | `app/modules/all_platform/zalo/services/zca_persistent_listener.py` | **1,169** | Quản lý tiến trình daemon Node `zca-js` và bắt sự kiện socket. |

---

## 5. DANH MỤC CÁC VÙNG CẦN DỌN DẸP & TÁI CẤU TRÚC

### 5.1. Thư mục Rác / Thừa Cần Xóa Ngay
1. **`linkedin-crawler-ui/_deprecated/`**: 21 file trang và component cũ từ thời trước đợt nâng cấp `all-platform`. Đã kiểm tra 100% không còn file nào trong dự án import tới.
2. **`prototype-studio/`**: Thư mục clone độc lập của repo ngoài (`github.com/thnkthuhigh/prototype-studio.git`), có chứa thư mục `.git` riêng, bị clone nhầm vào root làm bẩn `git status`. Cần đưa vào `.gitignore` hoặc di chuyển ra ngoài workspace.
3. **Các script rác tại Root**: Hơn 30 script debug (`debug_routes*.py`, `find_*.py`, `save_*.py`, `rebuild.py`, `full_deploy.py`, `resolve_conflicts.sh`, `resolve_zca.sh`).
4. **File rác backend**: File gõ nhầm lệnh `-w`, các file dump `data_export.json`, `output.json`, và các script test ad-hoc ở root backend (`test_cron.py`, `test_db.py`, `test_post.py`...).

### 5.2. Hợp Nhất Kiến Trúc CRM (Phá bỏ 4 Bản Sao Clone)
Hiện tại `crm-module/`, `crm-cloudgate/`, `crm-securityzone/`, `crm-timetech/` là 4 thư mục copy riêng rẽ mã nguồn CRM. Định hướng kiến trúc chuẩn là:
- Duy trì **duy nhất một thư mục CRM chuẩn** (`crm-module`).
- Mỗi tenant (Cloudgate, SecurityZone, TimeTech) chỉ là cấu hình môi trường `CRM_INSTANCE` và port khác nhau khi deploy Docker, không được nhân bản code.

---

## 6. QUY TẮC AN TOÀN PHÁT TRIỂN (AEVUM RULES)
1. **Zero-Leak**: Tuyệt đối không commit `.aevum/`, `.agents/`, `GEMINI.md`, `AGENTS.md`. Luôn kiểm tra `.gitignore`.
2. **Zero-Rush Deploy**: Chỉ kết luận thành công khi đã verify HTTP 200/401 thực tế qua endpoint và có log xác thực.
3. **Zero-Silent Calls**: Mọi thao tác phải được Anh Ba Gà giải trình rõ ràng cho Master trước khi thực thi.
4. **Watchdog**: Giám sát tiến trình ngầm, kill task rác kịp thời để không làm kẹt hàng đợi chat.
5. **Mandatory Test Matrix**: Mọi tính năng nghiệm thu đều phải có bảng ma trận test case xác thực.
6. **Continuous Context & Lessons Learned**: Cuối mỗi task, Anh Trường Con bắt buộc cập nhật `TONGQUAN.md` để lưu lại tiến độ hiện tại, cấu hình mới và danh mục các lỗi cần tránh kèm cách fix cụ thể.

---

## 7. TIẾN ĐỘ HIỆN TẠI & BÀI HỌC KINH NGHIỆM CẦN TRÁNH (LESSONS LEARNED & GOTCHAS)

### 7.1. Tiến Độ Hiện Tại Của Repo `D:\CrawlDataLinkedin`
- **Trạng thái môi trường**:
  - Đã kích hoạt 6 Điều Lệ Vận Hành Tối Cao và Bảng phân vai Biệt đội Aevum trong `GEMINI.md`.
  - Đã đồng bộ đầy đủ **20 Nhân sự số Aevum** trong thư mục `.aevum/global/personas/`.
  - Đã nạp đầy đủ **9 bộ Native Skills** trong `.agents/skills/` (đặc biệt là cẩm nang kiểm thử mới `testing-playbook`, `deploy-debug-playbook`, `artemis-mobile-automation`).
  - Đã kiểm tra kép và đưa khối bảo vệ Zero-Leak Brain lên đầu file `.gitignore`.
  - **Sẵn sàng**: Master chuẩn bị bắt tay vào code các tính năng mới trên repo này.

### 7.2. Các Lỗi Kỹ Thuật Hay Gặp & Cách Khắc Phục Triệt Để (Phòng Tránh Lặp Lại)
Dưới đây là các bài học xương máu được tổng hợp từ thực tế vận hành để toàn bộ Biệt đội Aevum và Master nắm rõ:

1. **Bẫy Biến Môi Trường Next.js `NEXT_PUBLIC_*` (Build-Time vs Runtime)**:
   - *Triệu chứng*: Biến môi trường khai báo trong `.env` trên host nhưng giao diện client không nhận được, giá trị bị rỗng khiến tính năng bị ẩn (như nút Google Sign-In bị bay màu).
   - *Nguyên nhân*: Next.js nướng tĩnh (inlined) các biến `NEXT_PUBLIC_*` vào bundle JavaScript **ngay tại thời điểm chạy `npm run build`** trong Docker. File `.env` lúc runtime không thể thay đổi giá trị đã build.
   - *Cách fix chuẩn*:
     + Luôn bổ sung `ARG BUILD_NEXT_PUBLIC_...` trong Dockerfile và truyền qua `docker-compose.yml`.
     + **Thiết kế cơ chế Runtime Fallback**: Frontend luôn có hook fetch về API server (ví dụ `GET /api/auth/google`) để lấy cấu hình runtime từ server nếu biến client bị rỗng.

2. **Bẫy Trôi Lạc Docker Volume Khi Đổi Thư Mục Chạy CI/CD**:
   - *Triệu chứng*: Sau khi deploy qua pipeline CI/CD mới, tài khoản đã đăng nhập (như Mabuu) bỗng dưng biến mất khỏi danh sách.
   - *Nguyên nhân*: Docker Compose tự động đặt tiền tố (prefix) cho volume theo tên thư mục hiện tại (ví dụ: chuyển từ thư mục `mabu-inventory-management` sang `chat-timetech` làm sinh ra volume mới `chat-timetech_zalo-sessions`), khiến dữ liệu session cũ nằm kẹt ở volume cũ.
   - *Cách fix chuẩn*: Dùng `docker inspect <container>` để kiểm tra đúng tên volume đang mount; khi đổi cấu trúc deploy, phải có bước kiểm tra và migrate các file session (`*.json`, `accounts.json`) từ volume cũ sang volume mới.

3. **Bẫy Chặn Nhầm Thư Mục `dist/` Trong `.gitignore` Gây Crash Container**:
   - *Triệu chứng*: Container Node.js/Python liên tục restart báo lỗi `ERR_MODULE_NOT_FOUND: Cannot find module '.../dist/index.js'`.
   - *Nguyên nhân*: Quy tắc `.gitignore` có dòng `dist/` chung chung đã vô tình chặn cả code build sẵn của thư viện nội bộ (như `zalo-bridge/zca-js/dist/`) khiến git push thiếu file compiled lên server.
   - *Cách fix chuẩn*: Phải luôn loại trừ rõ ràng bằng negation rule: `!zalo-bridge/zca-js/dist/` và `!zalo-bridge/zca-js/dist/**`.

4. **Bẫy Ghi Đè Local `docker-compose.override.yml` Lên Server**:
   - *Triệu chứng*: Deploy lên server nhưng app vẫn cố kết nối về `localhost:8080`, gãy toàn bộ API và CORS.
   - *Nguyên nhân*: File `docker-compose.override.yml` dùng để chạy dev local bị commit lên repo.
   - *Cách fix chuẩn*: Luôn để file này trong `.gitignore`, không bao giờ được commit lên Git.

5. **Bẫy Nuốt Lỗi Câm (Silent Error Catching) Khi Đồng Bộ Dữ Liệu**:
   - *Triệu chứng*: Bridge báo thao tác thành công nhưng cơ sở dữ liệu Supabase không có bản ghi, UI không hiện dữ liệu mà không có cảnh báo nào.
   - *Nguyên nhân*: Các khối `catch (e) {}` không log thông điệp lỗi hoặc schema hai bên lệch tên cột (ví dụ: code gọi `zalo_user_id` nhưng DB là `zalo_id` khiến PostgREST trả mã 400).
   - *Cách fix chuẩn*: Luôn in chi tiết `res.status` và response text khi gọi API PostgREST; đối chiếu schema bảng cẩn thận trước khi map dữ liệu.

---

## 7. TI?N �? TH?C HI?N & NH?T K� V?N H�NH (2026-10-22)

### 7.1. K?t Qu? Nghi?m Thu �?t 1 (D?n R�c Tri?t �? - COMPLETED)
- **Frontend**: �� git rm -r th�nh c�ng 21 file dead code trong linkedin-crawler-ui/_deprecated/. K?t qu? 
px tsc --noEmit d?t **Exit Code 0 (0 l?i)**.
- **Root Repository**: �� git rm -f hon 30 file script debug ad-hoc (debug_routes*.py, ind_*.py, save_*.py, esolve_*.sh, supabase_logs.json, i_output.html...).
- **Extension Artifacts**: �� x�a __tmp_markee_extension/, __tmp_markee_extension_local/ v� file l? acebook-seeding-extension/content-script.js.
- **Backend Root**: �� lo?i b? file typo -w, _dup_links.json, c�c file test/dump ad-hoc ? root linkedin_group_crawler/. B? Pytest don v? d?t **100% PASS (8/8 passed)**.
- **Git Hygiene**: �� ch?n to�n di?n scratch/**, pi-sniffer-*.json, prototype-studio/ trong .gitignore. Gi? s?ch working tree.

### 7.2. K? Ho?ch �?t 2 & �?t 3 (Pending Ch? �?o Ti?p Theo C?a Master)
- **�?t 2**: T�ch nh? c�c God Components ? Frontend (internal-engagement/page.tsx: 3,180 d�ng, ZaloChatView.tsx: 3,007 d�ng...).
- **�?t 3**: Ph�n chia Domain-Driven Design cho Router Backend (linkedin/router.py: 3,114 d�ng, ll_platform/router.py: 522 d�ng...).
