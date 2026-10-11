# AI Contract Copilot — pipeline mẫu DOCX → AI → DOCX/PDF (2026-10-09)

Trạng thái: code + test xong trên **main** (chưa port 3 clone, **chưa commit/push/deploy**, **không migration DB**). Việc còn lại: cài LibreOffice trên server (Dockerfile đã sửa, chưa build/deploy).

## 1. Nguyên nhân gốc (audit)
| # | Điểm làm mất form | Vị trí |
|---|---|---|
| 1 | Mẫu chỉ được lưu dạng **text trích xuất** (`contract_templates.extracted_text`); file gốc không được giữ | `contract_template_service.py` |
| 2 | AI **dựng lại 7 điều khoản cố định** (`_CANONICAL_CLAUSE_TITLES`, `_normalize_to_canonical`), mẫu chỉ là "tham chiếu văn phong" (cắt 8000 ký tự) → bố cục, bảng, quốc hiệu, chữ ký của mẫu không bao giờ được dùng | `contract_ai_service.py` |
| 3 | Ô "Tải mẫu" ở Copilot chỉ giữ `{name,size}` – file không được upload; "Giữ bố cục mẫu" là checkbox không nối đâu | `CopilotUiParts.tsx` |
| 4 | "Tải Word" = HTML đổi đuôi `.doc`; "Tải PDF" = PDF tự viết tay: 1 trang, font Helvetica, **xoá dấu tiếng Việt** (`normalize('NFD')` + bỏ ký tự ngoài ASCII), không ngắt dòng/bảng | `ContractAIWizard.tsx`, `ContractDetailPage.tsx` |
| 5 | Không có `window.print()`; không có thư viện PDF nào (không LibreOffice/weasyprint) | — |

## 2. Kiến trúc mới
```
mẫu .docx ──► contract_docx_engine (chỉnh trực tiếp trên bản sao, giữ run/style/section/bảng/header/footer/page break)
                ▲ placeholder {{khoa}} + bảng hạng mục: 100% từ CRM/báo giá (không qua AI)
                ▲ AI chỉ ĐỀ XUẤT {id đoạn → text mới}; validate_template_edits chặn: id lạ, xoá nội dung, số liệu
                  (%/tiền/ngày…) không có trong đoạn gốc / CRM / yêu cầu Sale
DOCX đã chỉnh (nguồn chuẩn) ──► LibreOffice headless ──► PDF (cùng nội dung, dùng làm xem trước)
                              └► lưu phiên bản vNNNN (Storage bucket riêng tư `contract-documents`, không ghi đè)
```
* File: `services/contract_docx_engine.py`, `contract_docx_pipeline.py`, `contract_document_store.py`, `routers/contract_docx.py` (prefix `/api/all-platform/contract-docs`), FE `modules/contracts/repositories/contractDocs.ts`, `crm/integrations/contracts/TemplatePreviewPanel.tsx`.
* Endpoint: `POST /render` (upload hoặc `template_id` thư viện), `POST /from-clauses` (không có mẫu → DOCX chuẩn A4/Times New Roman/quốc hiệu/chữ ký), `POST|GET /{contractId}/versions`, `GET /{contractId}/versions/{n}/docx|pdf`.
* Mẫu thư viện: khi upload mẫu, file gốc cũng được lưu `templates/<id>/original.<ext>` (mẫu cũ chưa có → báo "tải lại file DOCX").
* PDF: không có LibreOffice ⇒ trả `pdfError` rõ ràng, **không** dựng PDF khác. Font: báo font thiếu, chỉ chấp nhận thay thế tương thích số liệu (Times New Roman→Liberation Serif, Arial→Liberation Sans, Calibri→Carlito, Cambria→Caladea).
* Mẫu PDF: phân loại text / scan / form; **luôn `layoutPreserved=false`** + cảnh báo chuyển DOCX; lần bấm thứ 2 mới chạy bố cục chuẩn.
* Số hợp đồng chỉ có sau khi lưu: `{{contract_number}}` được điền khi lưu phiên bản (chỉ placeholder đó). Ngày ký `{{day}}/{{month}}/{{year}}` chỉ điền khi người dùng cung cấp (hiện lấy "Ngày bắt đầu"), hệ thống không tự lấy ngày hôm nay.
* Placeholder hỗ trợ: `customer_name, company_name, tax_code, address, email, phone, representative_position, contract_number, quote_number, contract_value, day, month, year`. Thiếu dữ liệu → giữ nguyên + cảnh báo.
* Bảng hạng mục tự nhận diện qua tiêu đề (STT/Hạng mục/Số lượng/Đơn giá/Thành tiền/VAT); nhân bản hàng mẫu đầu tiên; hàng "Tổng cộng" cập nhật từ `totalAmount`; hàng VAT/khác giữ nguyên + cảnh báo.

## 3. Kiểm thử
* `tests/test_contract_docx_engine.py` (17 test + 1 cần LibreOffice).
* E2E thật: `scripts/contract_docx_e2e_render.py` (host) rồi `scripts/contract_docx_e2e_pdf.py` trong container (`docker build` từ `python:3.12-slim` + `libreoffice-writer fonts-liberation poppler-utils`). Kết quả mẫu ở `scratch/contract_docx_e2e/` (original/edited .docx/.pdf + report).
* Chưa kiểm thử với DOCX do Word/Google Docs xuất ra từ mẫu thật của công ty (chỉ có mẫu dựng bằng python-docx) — nên đối chiếu thêm khi có mẫu thật.

## 4. Chưa làm / giới hạn
* Port 3 clone; build image có LibreOffice và deploy.
* Chỉ chỉnh thân tài liệu (đoạn + bảng). Header/footer, textbox, content control (SDT), ảnh, track-changes không bị sửa (giữ nguyên) nhưng cũng chưa điền placeholder trong đó.
* Chưa xử lý mẫu `.doc` cũ / `.txt`: báo lỗi rõ ràng.
* Hook Sales Stage 5 từ hợp đồng vẫn **tắt** (`CONTRACT_STAGE_SYNC_ENABLED=False`).

## 5. Giai đoạn 2 (đã làm trên main) — luồng nghiệp vụ hoàn chỉnh
| Hạng mục | Cách làm |
|---|---|
| Chọn Deal/báo giá | `contract_source_service.resolve_source`: khách có nhiều Deal bắt buộc chọn; báo giá phải thuộc đúng Deal + workspace, đã duyệt (approved/confirmed), không OUT, không xoá. Backend chặn ở `/contracts/precheck`, `/contracts/generate-draft`, `/contract-docs/render`, `POST /contracts` (khi `ai_generated`). FE chỉ khoá nút + giải thích. |
| Thông tin pháp lý | `legal_gaps`: blockers (tên Bên A) / required (MST, địa chỉ, người đại diện Bên A; tên-MST-địa chỉ Bên B) / optional (chức vụ, SĐT, email…). Required phải bổ sung hoặc tick xác nhận để trống (`acknowledge_missing`); backend kiểm tra lại. Dữ liệu Deal trống được điền từ Customer 360 + liên hệ chính (`enrich_deal`, chỉ điền ô trống). |
| Soạn mới bằng AI | Dùng nguyên `generate_contract_draft` của team (+ chọn loại HĐ, mức độ chi tiết); cảnh báo số liệu không có trong CRM/báo giá/yêu cầu. Xuất DOCX/PDF qua `/contract-docs/from-clauses`. |
| Mẫu PDF | `/contract-docs/extract-reference`: PDF text → trích nội dung làm tham chiếu (`reference_text`); PDF scan → báo chưa hỗ trợ OCR; PDF form → chỉ tham chiếu. Không giữ form PDF. |
| Chỉnh từng điều khoản | `/contract-docs/propose-edit` (AI chỉ sửa đoạn được chọn, trả trước/sau + cờ số liệu/chủ đề pháp lý, chặn số do AI tự thêm) → người dùng Chấp nhận/Từ chối → `/contract-docs/apply-paragraph` (chỉ đúng đoạn đó, giữ bố cục, PDF cập nhật). Lịch sử chỉnh sửa hiển thị; lưu phiên bản v1 (bản AI điền) + v2 (bản duyệt cuối). |
| Chống lưu trùng | Header `Idempotency-Key` (FE tạo 1 key/lần soạn) + khoá theo key trong tiến trình + khoá tự nhiên deal/báo giá/tiêu đề/người tạo trong 2 phút. CORS đã cho phép header này. Giới hạn: nhiều worker cần cột UNIQUE (cần migration, chưa chạy). |
| Đồng bộ không cần F5 | `notifyDealsChanged` (sự kiện cửa sổ + BroadcastChannel liên tab) → Customer 360 và trang Quản lý hợp đồng tự tải lại. |
| Hạ tầng | 4 Dockerfile có LibreOffice + font Việt (build kiểm tra); `docker-compose.yml` main thêm `init: true` (reap zombie của soffice); engine có timeout/diệt nhóm tiến trình/giới hạn đồng thời/xoá file tạm; `GET /contract-docs/health[?deep=true]`. |

E2E thật (backend Docker + LibreOffice + AI + DB thật, dữ liệu tạm `COPILOT-E2E` đã xoá theo ID): API 44/44, UI Playwright 25/25, lỗi AI/LibreOffice-timeout/thiếu LibreOffice/dữ liệu thiếu 5/5. Kết quả: `scratch/contract_docx_e2e/{final,ui}`.

## 6. Định dạng hợp đồng + đồng bộ hạng mục từ báo giá (2026-10-10, main)
* `services/contract_docx_builder.py` (AI soạn mới): A4, Times New Roman, header số hợp đồng + footer "Trang X / Y"; Điều 1 = hai nhóm Bên A/Bên B, mỗi trường một dòng (thiếu → `………` + cảnh báo, không bịa); Điều 2 = **bảng Word thật** (STT, Hạng mục, Tính năng/mô tả, ĐVT, SL, Đơn giá, VAT, Thành tiền gồm VAT) từ toàn bộ dòng báo giá đúng thứ tự (nhóm = dòng gộp ô), hàng tiêu đề lặp lại ở trang sau, hàng không bị cắt đôi, số tiền căn phải; Điều 3 = tổng trước thuế / VAT / thanh toán lấy từ báo giá + **lịch thanh toán** (tỷ lệ/thời hạn đọc từ nội dung Điều thanh toán đã duyệt; chỉ dựng khi tổng đúng 100%; số tiền = `Decimal` làm tròn VND, phần dư dồn vào đợt cuối nên tổng đợt = tổng hợp đồng); liệt kê `(i)(ii)(iii)`/`Đợt 1 … Đợt 2 …` tách từng dòng; chữ ký không tách trang; đoạn ngắn giữ khối, đoạn dài được phép tách trang.
* `/contract-docs/from-clauses` nhận `deal_id/quote_id/customer_id`: backend TỰ lấy hai bên + hạng mục + tổng (qua `resolve_source`, đúng workspace/Deal, đã duyệt, không OUT/xoá) — không tin số do client gửi. Báo giá lệch tổng ⇒ cảnh báo, không tự sửa số.
* Mẫu DOCX: `fill_items_table` điền đủ cột (STT/tên/mô tả/ĐVT/SL/đơn giá/VAT/thành tiền **gồm VAT**), hàng tổng nhận diện theo nhãn (trước thuế / VAT / tổng thanh toán); mẫu không có bảng nhận diện được ⇒ KHÔNG chèn, trả danh sách bảng ứng viên để người dùng chọn (`items_table_index`); placeholder mới `{{subtotal_amount}} {{vat_amount}} {{total_amount}} {{currency}}`.
* FE: nút **Xem trước bản PDF sẽ xuất** (chế độ điều khoản), chọn bảng hạng mục khi mẫu có nhiều bảng.
* Test: `tests/test_contract_docx_builder.py`, `test_contract_docx_engine.py`; E2E đối chiếu từng số liệu với DB trên báo giá thật `202610090150` (chỉ đọc): tổng 111.375.177, 3 dòng khớp, lịch 55.687.589 / 44.550.071 / 11.137.517.
