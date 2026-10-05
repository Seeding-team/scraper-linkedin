# Multi-currency cho Báo giá (VND | USD) — 2026-10-05

Trạng thái: **đã code + test, CHƯA commit/push, migration CHƯA áp lên DB thật** (chờ review).
Phạm vi: main (`linkedin-crawler-ui` + `linkedin_group_crawler`) và 3 clone `crm-module`, `crm-cloudgate`, `crm-securityzone`.

## Thiết kế (quyết định chính)

- **Tiền tệ thuộc cấp Quote**, không trộn VND/USD giữa các dòng. Quote cũ = `VND`, `exchange_rate = NULL`, render y như cũ.
- Mọi cột tiền của `quotes` / `quote_items` (đơn giá, giá vốn, thành tiền, VAT, tổng…) nằm **trong tiền tệ của quote**. RPC `quote_update` làm tròn theo currency (VND = 0 số lẻ, USD = 2).
- Giá gốc Service Catalog / Price Book **luôn VND và không bị sửa**. Quote USD: `giá USD = giá VND / quotes.exchange_rate` (exchange_rate = số VND cho 1 USD).
- Tỷ giá được **đóng băng** vào `quotes.exchange_rate` + `quotes.currency_snapshot` lúc tạo / chuyển currency. Reload, lưu, duyệt, public, PDF, tạo version, copy workspace đều dùng snapshot; đổi tỷ giá hệ thống không ảnh hưởng quote đã có.
- Gốc VND được giữ ở `quote_items.unit_price_vnd` (cột cũ) và `quote_items.cost_price_vnd` (cột mới) → đổi USD → VND không trôi do làm tròn 2 số lẻ. Dòng đã sửa tay thì quy đổi theo tỷ giá đã chốt.
- Markup = (giá khách − giá vốn) / giá vốn × 100 và Margin mục tiêu = giá vốn / (1 − m%) **không đổi công thức**, chỉ áp trên cùng 1 tiền tệ (giá vốn đã quy đổi trước).

## Tỷ giá tự động (migration 170 / clone 163)

- Luồng chính là **tự động**: `quote_exchange_rate_service` lấy USD **bán ra** từ Vietcombank (`portal.vietcombank.com.vn/.../pXML.aspx`), dự phòng ExchangeRate-API (`open.er-api.com`). Lưu `rate + source + updated_at + is_manual` vào `quote_exchange_rates`, nhật ký ở `quote_exchange_rate_history`.
- Rate tự động cũ > 6h được làm mới "lười" khi có người chọn USD / tạo quote USD (cooldown 5 phút vì Vietcombank chỉ cho 1 lần/5 phút; có khoá chống gọi trùng).
- Nút **Cập nhật tỷ giá** (Cài đặt báo giá → Tỷ giá USD/VND) = `POST /quotes/exchange-rate/refresh` (cooldown 60s) và đưa về chế độ tự động. **Ghi đè thủ công** (`PUT`) đặt `is_manual=true`: tự động không ghi đè cho tới khi bấm Cập nhật.
- Nguồn lỗi → **giữ rate gần nhất** (+ `lastError`, cờ `stale`); chưa từng có rate thì `rate=null` và UI cho nhập tay. Không có số tỷ giá nào trong code (có test quét mã nguồn).
- Quote mới lấy rate mới nhất; quote đã tạo giữ snapshot (`exchange_rate` + `currency_snapshot`).

## Nguồn tỷ giá (audit ban đầu)

Đã audit: trước đây chỉ có tỷ giá **riêng từng dòng** (`price_book_items.exchange_rate`, lô import NCC, `supplier_exchange_rate`), không có tỷ giá hệ thống.
→ Tạo bảng `quote_exchange_rates` (theo `instance`) + `quote_exchange_rate_service.py`; API `GET/PUT /api/all-platform/quotes/exchange-rate` (PUT cần quyền master-data). **Không seed số tỷ giá nào** — chưa cấu hình thì UI bắt nhập tay khi chuyển USD. Đã bỏ hard-code `25400` ở form Sản phẩm/Dịch vụ và Import NCC (giờ tự điền tỷ giá hệ thống).

## Migration

`linkedin_group_crawler/supabase/migrations/169_quote_multi_currency.sql` (clone: `backend/migrations/162_quote_multi_currency.sql`, nội dung giống hệt):
- `quotes.exchange_rate NUMERIC`, `quotes.currency_snapshot JSONB` (không tạo lại `quotes.currency` — đã có từ 028)
- `quote_items.cost_price_vnd NUMERIC`
- bảng `quote_exchange_rates`
- thay `quote_update` (làm tròn theo currency + lưu `cost_price_vnd`) và `quote_create_version` (mang theo currency/tỷ giá/gốc VND)
- idempotent (đã chạy 2 lần). Không backfill quote cũ.

## Backend

`services/quote_currency.py` (helper), `quote_exchange_rate_service.py`, `supabase_quote_service.py` (tạo / đổi currency / làm tròn / rollback nếu RPC lỗi), `schemas/quote.py`, `routers/quote.py` (endpoint tỷ giá), và các nơi cộng tiền quote phải quy về VND: ngân sách Deal (`link_quote_to_deal`), tiến độ (`progress_service`), tổng giá trị dự án, so sánh OCR hợp đồng, ngưỡng lợi nhuận của Rule Engine, caption Telegram.

## Frontend

- `lib/currency.ts`: `formatQuoteMoney(value, currency)` (VND `1.250.000 đ`, USD `$48.08`), quy đổi, `localizeCurrencyLabel`; `CurrencyInput` hỗ trợ `decimals`.
- `QuoteDocumentRenderer` đọc currency từ **quote** (prop `currency`), không từ template: tiền, tổng, VAT, chiết khấu, kế hoạch thanh toán, header `(VND)` → `(USD)`. Public / PDF (print) dùng chung renderer.
- Quote Workspace: control `Tiền tệ: VND | USD` (có confirm + ô tỷ giá khi có hạng mục), lưu nguyên tử currency + hạng mục đã quy đổi; Picker có toggle VND|USD, quy đổi hiển thị theo tỷ giá đã chốt.
- Picker `alreadyAdded`: badge "Đã có trong báo giá", checkbox khoá + không tick, không tính vào số chọn, có `Tăng SL` / `Thêm dòng mới`.
- Danh sách / tab khách hàng / Quote Center: số tiền từng quote theo currency của nó; KPI cộng nhiều quote quy về VND.
- Form SP/DV: đổi USD → VND nhân theo tỷ giá thật (27.5 USD × 26.000 = 715.000), thiếu tỷ giá thì không đổi (không gán nhãn sai).

## Giới hạn đã biết (cần quyết định)

1. Chỉ đổi currency được khi người dùng sửa được **cả** giá vốn và giá bán (hoặc quote chưa có giá). Presale ở Bước 1/2 với dòng đã có giá catalog thì chỉ thấy tiền tệ dạng text (backend field-level guard sẽ từ chối).
2. Luồng "Tạo báo giá nhanh" (`QuoteFormFiller`) vẫn **chỉ VND**; ô text "Đơn vị tiền tệ" gõ tay không còn là nguồn tiền tệ.
3. Snapshot Combo (`bundleSnapshot`) luôn VND; dòng cha của quote USD được quy đổi, dòng thành phần hiển thị quy đổi.
4. Hợp đồng luôn VND: tạo hợp đồng từ quote USD quy đổi theo tỷ giá đã chốt, `currency` hợp đồng = `VND`.

## Test

- `linkedin-crawler-ui/scripts/test-quote-multi-currency.ts` (logic thuần: format, quy đổi, tổng, đổi tiền tệ, form SP/DV) — `npx tsx scripts/test-quote-multi-currency.ts`
- `linkedin-crawler-ui/scripts/test-quote-multi-currency-render.tsx` (SSR: Renderer VND/USD, PaymentPlan, Picker alreadyAdded) — `npx tsx --require ./scripts/css-stub.cjs scripts/test-quote-multi-currency-render.tsx`
- `linkedin_group_crawler/tests/test_quote_currency.py` (unit) và `tests/test_quote_multi_currency_integration.py` (cần DB cục bộ: `MC_TEST_SUPABASE_URL=http://localhost:55433 MC_TEST_SUPABASE_KEY=<jwt>`; **từ chối chạy nếu URL không phải localhost**).
- **Cảnh báo:** `app.core.config` nạp `.env.local` với `override=True`, nên script/test chỉ set biến môi trường sẽ vẫn bị trỏ về DB thật. Test tích hợp đã ép lại env và assert base URL là localhost trước khi gọi.
