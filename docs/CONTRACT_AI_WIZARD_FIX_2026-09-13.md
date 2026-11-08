# Fix 2 lỗ hổng nghiệp vụ ở AI Contract Copilot — 2026-09-13

## Bối cảnh

Trong lúc kiểm tra tính năng "Hợp đồng" (module CRM), phát hiện 2 lỗ hổng
nghiệp vụ thật trong luồng soạn hợp đồng bằng AI (`ContractAIWizard.tsx`) và
trang chi tiết hợp đồng (`ContractDetailPage.tsx`).

## Lỗi 1 — Hợp đồng không gắn báo giá thì giá trị = 0đ vĩnh viễn

**Trước khi fix**: `contractValue: selectedQuote?.totalAmount || 0` — Wizard
cho phép chọn `"-- Không đính kèm báo giá --"`, nhưng khi đó không có ô nhập
nào (cả trong Wizard lẫn trang chi tiết sau này) để sửa lại giá trị hợp đồng.
Hệ quả: cột "Giá trị" và "Thanh toán" (= giá trị × %) luôn hiển thị 0đ, không
ai sửa được trừ khi vào thẳng DB. Chỉ `ManualContractModal.tsx` (luồng tạo
thủ công, không qua AI) mới có ô "Giá trị hợp đồng (VND)".

**Đã fix**:
- `ContractAIWizard.tsx`: thêm ô `CurrencyInput` "Giá trị hợp đồng (VND)" —
  mặc định đồng bộ theo báo giá đã chọn (`selectedQuote.totalAmount`), nhưng
  **luôn sửa tay được**, có cảnh báo rõ khi không đính kèm báo giá.
- `ContractDetailPage.tsx`: thêm thẻ thống kê "Giá trị hợp đồng" (ô sửa được,
  lưu qua nút "Lưu thay đổi" có sẵn) — trước đây là read-only tuyệt đối.

## Lỗi 2 — `payment_terms` lưu sai nguồn (lệch với hợp đồng thật)

**Trước khi fix**: `paymentTerms: extraPrompt` — cột `payment_terms` trong DB
luôn được gán = nguyên văn ô "Yêu cầu thêm cho AI" (gợi ý đầu vào cho AI),
KHÔNG phải nội dung thật của "ĐIỀU 3. GIÁ TRỊ & THANH TOÁN" mà AI soạn ra. Nếu
sale sửa tay điều khoản ở bước duyệt nhưng quên sửa lại ô gợi ý, `payment_terms`
lưu DB lệch với hợp đồng đã ký — và `runAiReview()` (nút "AI rà soát rủi ro" ở
trang chi tiết) vẫn dùng giá trị lệch này để đối chiếu.

**Đã fix**: thêm hàm `extractPaymentTermsFromClauses()`
(`contractConfig.ts`) — trích đúng `body` của điều khoản có `title ===
"ĐIỀU 3. GIÁ TRỊ & THANH TOÁN"` (vị trí cố định thứ 3/7, theo đúng
`_CANONICAL_CLAUSE_TITLES` mà AI backend luôn tuân theo — xem
`contract_ai_service.py`), fallback về `clauses[2]` nếu không khớp title.
Áp dụng ở mọi nơi trước đây dùng `extraPrompt`/`contract.paymentTerms`:
lúc soạn AI, lúc refine, lúc lưu hợp đồng, và lúc `runAiReview()` — kể cả
`saveClauses()` ở trang chi tiết giờ cũng ghi đè lại `payment_terms` trong DB
mỗi lần lưu, để tự "chữa lành" dữ liệu cũ bị lệch.

## Phạm vi áp dụng

Áp dụng giống hệt nhau ở cả 4 nơi (bản gốc + 3 module CRM tách riêng, đều có
copy y hệt tính năng này):
- `linkedin-crawler-ui` / `linkedin_group_crawler` (app gốc)
- `crm-module`
- `crm-cloudgate`
- `crm-securityzone`

File đổi ở mỗi nơi: `modules/contracts/constants/contractConfig.ts`,
`modules/crm/integrations/contracts/ContractAIWizard.tsx`,
`modules/contracts/components/ContractDetailPage.tsx`. Không đổi gì ở
backend — `update_contract`/`review_risk` đã sẵn nhận `contract_value`/
`payment_terms` qua payload từ trước, chỉ frontend trước đây không gửi đúng.

## Việc CẦN làm tiếp / chưa verify

- Chưa chạy thử bằng thao tác chuột thật trên trình duyệt (mới sửa code +
  đang chờ rebuild Docker để xác nhận TypeScript compile sạch).
- Chưa test lại cả `crm-cloudgate`/`crm-securityzone` bằng build thật (chỉ
  `crm-module` được rebuild+test trực tiếp trong phiên này) — do 3 module là
  code y hệt nhau (đã xác nhận bằng diff trước khi sửa), rủi ro thấp nhưng
  chưa phải "đã verify thật" cho 2 module còn lại.
