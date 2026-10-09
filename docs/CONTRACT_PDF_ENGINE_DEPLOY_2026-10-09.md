# Engine PDF cho AI Contract Copilot — LibreOffice trong Docker (2026-10-09)

Trạng thái: **đã sửa Dockerfile + engine + test, CHƯA deploy, CHƯA commit/push.** Cần duyệt trước khi build/deploy production.

## 1. Backend production được deploy thế nào (đã audit)
| App | Image backend | Cách deploy |
|---|---|---|
| Main (`seeding.markeeai.com`) | `linkedin_group_crawler/Dockerfile` — base `mcr.microsoft.com/playwright/python:v1.58.0-jammy` (Ubuntu 22.04), user `pwuser` | workflow thủ công `deploy-app.yml` → SSH host APP → `docker compose build/up backend` |
| CRM Markee / Cloudgate / Securityzone | `crm-*/backend/Dockerfile` — base `python:3.12-slim` (hiện là Debian 13), Node 20 + Chromium (Playwright), user `appuser` qua `docker-entrypoint.sh` | `deploy-crm-*.yml` — **tự chạy khi push `main` có đổi `crm-*/**`** → `docker compose -p <proj> build frontend backend` + `up -d` + restart router |

⇒ Cả 4 image đều phải có LibreOffice, nếu không PDF trả `pdfError` rõ ràng (không có PDF thay thế).

## 2. Thay đổi
* 4 Dockerfile: cài `libreoffice-writer` + `fonts-liberation fonts-crosextra-carlito fonts-crosextra-caladea fonts-dejavu-core fontconfig`; **bước build tự kiểm tra** `soffice --headless --version` và có font Việt (Liberation Serif) — thiếu thì build fail, không thể deploy image thiếu engine.
* Engine (`contract_docx_engine.py`):
  * Giới hạn đầu vào: DOCX ≤ 10MB, ≤ 5000 thành phần zip, ≤ 120MB sau giải nén (chống zip-bomb), phải có `word/document.xml` — kiểm trước khi đưa vào python-docx/LibreOffice.
  * Timeout (`CONTRACT_SOFFICE_TIMEOUT`, mặc định 90s) + **diệt cả nhóm tiến trình** (`soffice` sinh `soffice.bin`; không để mồ côi). Giới hạn CPU/kích thước file (`prlimit`) trên Linux.
  * Giới hạn đồng thời (`CONTRACT_PDF_MAX_CONCURRENCY`, mặc định 2; mỗi tiến trình ~300–500MB RAM); quá tải → báo "thử lại sau", không chồng chất.
  * File tạm: `mkdtemp` (quyền 0700) riêng mỗi yêu cầu, **profile LibreOffice riêng** (không tranh khoá, không rò dữ liệu giữa các yêu cầu), `HOME/TMPDIR` trỏ vào thư mục tạm, luôn xoá kể cả khi lỗi/timeout. Không ghi gì ra volume.
  * Router: chuyển PDF chạy trong thread (`asyncio.to_thread`) — không chặn event loop backend.
* Health check: `GET /api/all-platform/contract-docs/health` (nhanh, không cần đăng nhập: `soffice --version` + font Việt) và `?deep=true` (chuyển thử DOCX tiếng Việt → PDF, đọc lại text, cache 5 phút). 200 = OK, 503 = hỏng.
  * Docker `HEALTHCHECK` hiện có vẫn gọi `/health` nhẹ (không đổi, tránh chạy LibreOffice mỗi 30s). Dùng `?deep=true` làm smoke test sau mỗi lần deploy.

## 3. Local
Chạy backend bằng Docker (`docker compose up -d --build backend`); không cài LibreOffice trên Windows. Xem `LOCAL_DEV.md`.

## 4. Khuyến nghị trước khi deploy (không tự đổi compose production)
* Image to hơn ~600–700MB do LibreOffice; lần build đầu lâu.
* Cân nhắc `mem_limit` cho backend khi concurrency > 2, và `shm_size` nếu thấy lỗi bộ nhớ chia sẻ.
* Clone production tự deploy khi push `main` — chỉ push sau khi đã duyệt và build image thử trên host.
* Chưa có engine DOCX/router trong 3 clone (mới port Dockerfile); port code engine trước khi mong đợi PDF trên Cloudgate/Securityzone/Markee.
