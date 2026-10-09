# Chạy dự án local bằng Docker

Hướng dẫn này dành cho dev muốn kéo code về máy và chạy thử bằng Docker Compose.

## Vấn đề đã gặp trước đây

Nếu bạn từng chạy `docker compose up` và gặp "lỗi service" hoặc "không đăng
nhập được", nguyên nhân gần như chắc chắn là 1 trong 2:

1. `docker-compose.yml` gốc build frontend trỏ thẳng lên domain production
   (`https://seeding.markeeai.com`) — biến này bị đóng cứng vào bundle Next.js
   lúc build, nên dù chạy container ở máy bạn, frontend vẫn gọi lên production
   thay vì backend local của bạn → sai dữ liệu / bị chặn CORS / cookie đăng
   nhập không khớp domain.
2. File `.env` của backend thiếu các biến bắt buộc (Supabase, JWT...) —
   `.env.example` cũ không liệt kê đủ.

Cả 2 đã được sửa/bổ sung template bên dưới.

## Các bước

1. **Copy file cấu hình mẫu:**

   ```bash
   cp linkedin-crawler-ui/.env.example linkedin-crawler-ui/.env
   cp linkedin_group_crawler/.env.example linkedin_group_crawler/.env
   cp docker-compose.override.yml.example docker-compose.override.yml
   ```

   3 file vừa tạo (`.env`, `.env`, `docker-compose.override.yml`) đều đã nằm
   trong `.gitignore` — sửa/điền gì vào đó cũng không bị commit lên git,
   không ảnh hưởng tới ai khác hay tới host dev/app thật.

2. **Điền secret thật vào `linkedin_group_crawler/.env`** — hỏi admin/leader
   để lấy giá trị thật cho các biến sau (không có thì backend chạy lên
   nhưng gọi API sẽ lỗi hoặc không đăng nhập được):
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
   - `JWT_SECRET_KEY`
   - `MARKEE_FB_BASE_URL`, `MARKEE_FB_API_KEY`, `MARKEE_FB_EXTENSION_API_KEY`
   - `SEEDER_SERVICE_URL`, `SEEDER_SERVICE_API_KEY`
   - `ZALO_BROWSER_SERVICE_URL`

3. **Build và chạy:**

   ```bash
   docker compose up --build
   ```

   Docker Compose tự động gộp `docker-compose.override.yml` vào
   `docker-compose.yml` gốc (không cần thêm `-f`) — build frontend sẽ trỏ về
   `http://localhost:8080` thay vì production.

4. **Mở** `http://localhost:8080` — đây là router, tự route `/api/*` sang
   backend và phần còn lại sang frontend, cùng 1 domain nên đăng nhập lưu
   cookie đúng.

## Lưu ý

- Sửa code frontend xong phải build lại (`docker compose up --build`) vì
  biến `NEXT_PUBLIC_*` bị đóng cứng lúc build, sửa `.env` không có tác dụng
  tức thời như thường lệ.
- Không commit `docker-compose.override.yml` (không phải bản `.example`) —
  file này khác nhau giữa máy local / host dev / host app (domain build-arg
  khác nhau), commit nhầm sẽ làm hỏng deploy thật ở lần sau.

## AI Contract Copilot: xuất PDF cần LibreOffice trong Docker

Backend xuất DOCX -> PDF bằng **LibreOffice Writer (`soffice`) có sẵn trong Docker image backend** (đã kèm font tiếng Việt:
Liberation/Carlito/Caladea/DejaVu). Production và local dùng chung image này, nên **hãy chạy backend bằng Docker**
(`docker compose up -d --build backend`), KHÔNG chạy `uvicorn` trực tiếp trên Windows và KHÔNG cài LibreOffice lên máy cá nhân.
Chạy `uvicorn` trần trên Windows vẫn dùng được Copilot, nhưng PDF sẽ báo "chưa cài LibreOffice" (không có PDF thay thế).

Kiểm tra engine: `curl http://localhost:8080/api/all-platform/contract-docs/health` (nhanh) hoặc `...?deep=true` (chuyển thử 1 DOCX tiếng Việt, cache 5 phút).
HTTP 200 = dùng được, 503 = thiếu/hỏng. Biến tuỳ chọn: `CONTRACT_SOFFICE_TIMEOUT` (giây, mặc định 90), `CONTRACT_PDF_MAX_CONCURRENCY` (mặc định 2),
`CONTRACT_SOFFICE_PATH`. Chi tiết: `docs/CONTRACT_PDF_ENGINE_DEPLOY_2026-10-09.md`.
