# AI Contract Copilot v2 — bàn giao (main, 2026-10-10)

Trạng thái: **code + test xong trên main. Chưa commit/push/deploy, chưa chạy migration, chưa port clone, hook Sales Stage 5 vẫn tắt, không đụng cấu hình email.**

## 1. Audit trước → sau
| Hạng mục | Trước | Sau |
|---|---|---|
| Copilot | 1 màn hình dồn input + cảnh báo; dropdown 3 loại HĐ cố định | 3 bước (Thông tin & nguồn → Yêu cầu AI → Xem trước & hoàn thiện), responsive; loại HĐ = combobox nhập tự do + AI đề xuất |
| Loại HĐ | `service/principle/marketing` | Nhãn tự do lưu ở `contracts.template_type` (TEXT, không CHECK) + map về khoá cũ (`legacy_key`); AI + luật từ khoá, không chắc → bắt người dùng chọn |
| Mã HĐ | `HD/{YYYY}/{SEQ}` tính max rồi insert (race) | Giữ nguyên định dạng mặc định; cấp số có **retry khi trùng UNIQUE** (6 request đồng thời → 6 mã khác nhau); quy tắc theo workspace `{SHORT}/{YYYY}/{SEQ}` chờ migration 184 |
| Bên A/B | Bên A luôn là khách | Vai trò theo loại HĐ (Bên mua/bán, thuê/cho thuê, tư vấn…) + hướng giao dịch (bán ra / mua vào) |
| Chi tiết HĐ | 7 điều khoản text cũ, sửa trực tiếp, PDF dựng lại | 5 tab: Tổng quan / Tài liệu (phiên bản, PDF đúng phiên bản, sửa → phiên bản mới) / AI rủi ro (theo phiên bản) / Phê duyệt & ký / Lịch sử; legacy hiển thị nhãn rõ, không giả lập |
| AI rủi ro | 1 điểm gắn với hợp đồng | Gắn với **từng phiên bản** (sha256, model, thời điểm); phiên bản mới → điểm cũ không dùng |
| Phê duyệt | Đổi trạng thái tự do | Backend chặn gửi duyệt/ký khi chưa đủ: có tài liệu, báo giá hợp lệ, giá trị khớp báo giá, pháp lý đủ, AI rủi ro cho phiên bản mới nhất; ghi người/thời điểm/phiên bản được duyệt. Hợp đồng thủ công/legacy giữ luồng cũ |
| Thư viện mẫu | Chỉ tải `.txt` | Tải **đúng file gốc** DOCX/PDF (mẫu cũ chưa lưu file gốc → báo rõ) |
| Phân quyền tài liệu | Endpoint phiên bản chỉ cần đăng nhập | Mọi endpoint phiên bản/tải/rủi ro/readiness kiểm tra `can_edit_contract` + workspace |

## 2. File chính
Backend (`linkedin_group_crawler/app/modules/all_platform/`): `services/contract_type_service.py`, `contract_number_service.py`, `contract_roles.py`, `contract_approval_service.py`, `contract_document_store.py` (metadata phiên bản), `contract_docx_engine.py` (`docx_to_clauses`), `contract_docx_builder.py` (vai trò), `contract_source_service.py` (`money_tokens_text`), `contract_ai_service.py`, `supabase_contract_service.py` (cấp số an toàn, loại tự do, tên người trong lịch sử); `routers/contract.py` (`/suggest-type`, `/types`, `/number-settings`, chặn trạng thái), `routers/contract_versions.py` (mới), `routers/contract_docx.py` (`/analyze-draft`, vai trò), `routers/contract_template.py` (`/{id}/file`); `schemas/contract.py`.
Frontend (`linkedin-crawler-ui/modules/`): `crm/integrations/contracts/ContractAIWizard.tsx` (viết lại 3 bước), `ContractCopilotParts.tsx`, `crm/styles/copilot.css`, `contracts/components/ContractDetailPage.tsx` (viết lại 5 tab), `contracts/repositories/contractDocs.ts`, `SeedingContractRepository.ts`, `ContractRepository.ts`, `types/index.ts`, `contract-templates/components/ContractTemplateLibrary.tsx`.
Không đổi: drawer "+ Thêm hợp đồng" (`ManualContractModal`), 3 nút ở Customer 360.

## 3. API (đã chạy thật qua E2E)
`POST /contracts/precheck` · `POST /contracts/suggest-type` · `GET /contracts/types` · `GET|PUT /contracts/number-settings` · `POST /contracts/generate-draft` · `POST /contracts` (Idempotency-Key) · `POST /contracts/{id}/status` (version) · `GET /contracts/{id}/activity-log` ·
`POST /contract-docs/render|from-clauses|propose-edit|apply-paragraph|extract-reference|analyze-draft` · `GET /contract-docs/health[?deep=true]` ·
`POST|GET /contract-docs/{id}/versions` · `GET /contract-docs/{id}/versions/{n}/docx|pdf|paragraphs|risk` · `POST /contract-docs/{id}/versions/{n}/risk` · `GET /contract-docs/{id}/readiness` · `GET /contract-templates/{id}/file`.

## 4. Migration cần duyệt (CHƯA CHẠY)
* `184_workspace_contract_settings.sql` — quy tắc mã HĐ theo workspace (chưa áp: dùng mặc định `HD/{YYYY}/{SEQ}`, nút lưu báo rõ).
* `185_contracts_idempotency_key.sql` — UNIQUE `(instance, created_by, idempotency_key)` cho chống trùng đa worker (hiện: khoá bộ nhớ + khoá tự nhiên deal/báo giá/tiêu đề/người tạo trong 2 phút ở DB).
* (từ trước) `183_quote_delivery_channels_per_instance.sql` — email theo workspace.

## 5. Chạy local & test thủ công
1. Build image backend có LibreOffice: `docker build -t main-backend-lo-test ./linkedin_group_crawler`
2. Chạy backend (dùng `.env` thật, code mount để sửa nóng):
   ```
   docker run -d --name copilot-backend -p 8000:8000 --init -e DISABLE_ZCA_LISTENERS=1 \
     -v "$PWD/linkedin_group_crawler/app:/app/app:ro" -v "$PWD/linkedin_group_crawler/.env:/app/.env:ro" \
     -v "$PWD/linkedin_group_crawler/.env.local:/app/.env.local:ro" main-backend-lo-test
   ```
   Kiểm tra: `curl localhost:8000/api/all-platform/contract-docs/health?deep=true` → `"ok": true`.
   (Chạy `uvicorn` trần trên Windows vẫn được nhưng PDF báo "chưa cài LibreOffice".)
3. Frontend: `cd linkedin-crawler-ui && npm run dev` → http://localhost:3000
4. Thử: Khách hàng → mở 1 khách có Deal + báo giá đã duyệt → tab Hợp đồng → **Soạn hợp đồng AI** → chọn Deal → xem AI đề xuất loại HĐ (hoặc gõ loại mới) → Tiếp theo → nhập yêu cầu/bấm chip → **Tạo bản nháp AI** → xem PDF, tab Chỉnh sửa điều khoản (✦ AI chỉnh điều khoản này → Chấp nhận → Cập nhật bản xem trước) → **Lưu bản nháp** → **Gửi duyệt** → **Mở hợp đồng** → các tab Tài liệu / AI rủi ro / Phê duyệt & ký / Lịch sử; thử "Sửa nội dung → tạo phiên bản mới".
5. Test tự động: `cd linkedin_group_crawler && python -m pytest tests -q` (trong image Docker để chạy cả test LibreOffice). E2E: các script `copilot_e2e_*.py` (tạo dữ liệu tạm `COPILOT-E2E`, dọn đúng ID).

## 6. Chưa nghiệm thu / giới hạn
* **CHƯA NGHIỆM THU giữ form với mẫu DOCX thực tế của công ty** — chưa có file; mới test mẫu dựng bằng code.
* Mã theo workspace và chống trùng đa worker ở DB: cần migration 184/185.
* Preview PDF trong Chromium headless hiện trắng (không có trình xem PDF) — đã kiểm tra bằng file tải về; trình duyệt thật hiển thị bình thường (chưa tự nhìn được).
* Không có trạng thái "Đã duyệt" riêng trong schema: duyệt = `pending_legal → pending_signature`, có ghi phiên bản. Không ký số.
* Quyền "duyệt" dùng chung `can_edit_contract` (chưa có vai trò Pháp chế riêng) — cần quyết định nghiệp vụ nếu muốn tách.
* Thư viện mẫu: chưa chặn xoá mẫu đang được tham chiếu (hợp đồng chỉ lưu bản sao DOCX của chính nó nên xoá mẫu không làm hỏng phiên bản đã lưu).
