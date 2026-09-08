# Hướng dẫn sử dụng CRM — Luồng Khách hàng → Cơ hội → Báo giá

Tài liệu này hướng dẫn đầy đủ 1 luồng nghiệp vụ CRM chuẩn: từ tạo khách hàng, tạo
cơ hội (deal), tới tạo báo giá theo 2 cách (Yêu cầu hỗ trợ báo giá — luồng đầy đủ có
duyệt/SLA, hoặc Tạo báo giá nhanh — wizard 1 lần).

## 1. Tạo Khách hàng

- Vào **CRM → Khách hàng**.
- Bấm **"+ Thêm khách hàng"**, điền: Tên khách hàng, Công ty, Mã số thuế, Ngành,
  Nguồn (bắt buộc nằm trong danh mục `crm_source`), thông tin liên hệ (SĐT/Email —
  hệ thống tự chuẩn hoá để chống trùng).
- Nếu khách đã có trong hệ thống (trùng SĐT/Email), hệ thống sẽ báo trùng và gợi ý
  hồ sơ cũ thay vì tạo bản mới.
- Sau khi tạo, hồ sơ khách hàng có các tab: **Dự án**, **Cơ hội**, **Báo giá**.

> Ghi chú: 1 khách hàng có thể có nhiều Cơ hội (deal) khác nhau — mỗi Cơ hội là 1
> nhu cầu/thương vụ riêng, không dùng chung 1 Cơ hội cho nhiều nhu cầu khác nhau.

## 2. Tạo Cơ hội (Deal)

Có 2 cách:

**Cách A — từ hồ sơ khách hàng:** vào tab **Cơ hội** của khách hàng đó → **"+ Tạo
cơ hội"** → điền Tên cơ hội, Giai đoạn ban đầu (mặc định **"Khách mới"**), Người
quản lý (leaded_by), Người phụ trách (sdr_id), Giá trị dự kiến, Next step.

**Cách B — từ Lead có sẵn:** nếu khách đến từ Lead (marketing/inbound), vào **CRM →
Leads**, chuyển đổi Lead thành Khách hàng + Cơ hội cùng lúc.

Cơ hội đi qua các giai đoạn (kéo-thả hoặc bấm nút chuyển giai đoạn trên thẻ):

```
Khách mới → Đã liên hệ → Đủ điều kiện → Lấy yêu cầu → Đã báo giá → Đàm phán → (Đã chốt / Đã huỷ)
```

Giai đoạn cơ hội **độc lập** với giai đoạn xử lý nội bộ của báo giá (xem mục 4) —
đừng nhầm 2 khái niệm này.

## 3. Từ Cơ hội → tạo Báo giá: chọn 1 trong 2 luồng

Trên thẻ/màn hình chi tiết Cơ hội có 2 lối vào tạo báo giá, dùng cho 2 tình huống
khác nhau — **không phải luồng nào cũng đúng cho mọi trường hợp**:

| | Yêu cầu hỗ trợ báo giá | Tạo báo giá nhanh |
|---|---|---|
| Khi nào dùng | Cần Presale ước lượng kỹ thuật + giá vốn trước, có kiểm soát/duyệt, có SLA nội bộ | Đã biết rõ hạng mục/giá, muốn ra báo giá ngay không qua bước duyệt nội bộ |
| Ai điền | Presale điền hạng mục + giá vốn, Sale điền markup/giá khách sau | 1 người điền hết 1 lượt |
| Có SLA/duyệt nội bộ | Có (bắt buộc) | Không |
| Vào từ đâu | Trung tâm báo giá → "Yêu cầu hỗ trợ báo giá" | Trung tâm báo giá → "Tạo báo giá nhanh", hoặc trực tiếp từ Cơ hội |

Cả 2 đều là lối vào **hợp lệ, độc lập** — không bắt buộc phải qua "Tạo báo giá
nhanh" trước rồi mới "Yêu cầu hỗ trợ báo giá".

## 4. Luồng "Yêu cầu hỗ trợ báo giá" (đầy đủ, có duyệt)

Đây là luồng chính, có 3 bước xử lý nội bộ (hiển thị dạng thanh tiến trình):

```
Bước 1: Yêu cầu & Kỹ thuật  →  Bước 2: Hoàn thiện giá bán  →  Bước 3: Chờ duyệt
```

### Bước 1 — Yêu cầu & Kỹ thuật (Presale)
1. Chọn **Khách hàng → Dự án (tuỳ chọn) → Cơ hội CRM → Mẫu báo giá**.
2. Gán **Presale** (người ước lượng kỹ thuật) và **Sale** (người chốt giá sau).
3. Đặt **SLA / Hạn hoàn tất nội bộ** (bắt buộc trước khi bàn giao).
4. Điền **Tóm tắt nhu cầu khách** + **Mô tả scope**.
5. Thêm **Hạng mục** — 3 cách: gõ tay, chọn từ Danh mục Sản phẩm & Dịch vụ, hoặc
   "Nạp từ báo giá gần nhất" (nếu Cơ hội này đã từng có báo giá trước).
6. Với mỗi hạng mục: nhập **Số lượng + Giá vốn** (Presale phụ trách) — **Markup/Giá
   khách để trống**, Sale sẽ điền ở Bước 2 (khoá cứng theo bước, không điền được
   markup ở Bước 1).
7. Tick đủ 4 mục **Checklist bàn giao** (Phạm vi, Giá vốn, Tiến độ, Giả định).
8. Có 2 nút:
   - **"Lưu / Chỉnh sửa"** (góc trên) — chỉ lưu bản nháp, không chuyển bước.
   - **"Bàn giao"** (góc dưới) — lưu **và** tự động chuyển thẳng sang Bước 2 trong
     1 lần bấm (nếu đủ điều kiện: có scope, có hạng mục hợp lệ, checklist đủ 4/4).
     Thiếu điều kiện nào sẽ báo rõ, không cần đoán.

### Bước 2 — Hoàn thiện giá bán (Sale)
- Xem giá vốn Presale đã nhập (khoá, không sửa được).
- Nhập **Markup** hoặc **Giá khách** trực tiếp cho từng hạng mục, xem ngay Margin.
- Chỉnh **Chiết khấu tổng**, **Điều khoản thanh toán**, **Hiệu lực báo giá**.
- Bấm **"Hoàn tất phần giá bán"** để gửi sang Bước 3 (yêu cầu ≥1 hạng mục và tổng
  tiền > 0).

### Bước 3 — Chờ duyệt (Admin/người có quyền duyệt)
- Xem lại toàn bộ: hạng mục, giá vốn, giá khách, margin, kết quả Rule Engine, SLA.
- 3 lựa chọn:
  - **Duyệt báo giá** — nếu Rule Engine không đạt, phải nhập lý do duyệt ngoại lệ.
  - **Yêu cầu chỉnh sửa → Yêu cầu & Kỹ thuật** — trả về Bước 1 (Presale sửa lại).
  - **Yêu cầu chỉnh sửa → Hoàn thiện giá bán** — trả về Bước 2 (Sale sửa markup),
    không đi qua lại Bước 1.
- Sau khi **Duyệt**, bấm **Phát hành** để sinh public link thật + set Ngày báo giá.
- Sau khi phát hành: **Gửi khách hàng** (email có thể đính kèm PDF) hoặc **Sao chép
  link báo giá** để gửi thủ công.

## 5. Luồng "Tạo báo giá nhanh" (wizard 1 lần)

4 bước trong 1 popup:
1. **Khách hàng** — chọn khách hàng có sẵn hoặc tạo nhanh.
2. **Đơn vị phát hành** — chọn công ty đứng tên báo giá (tự điền logo/thông tin
   pháp lý + mẫu mặc định của công ty đó).
3. **Hạng mục báo giá** — điền trực tiếp bảng dịch vụ/sản phẩm theo đúng mẫu đã
   chọn (mỗi mẫu có thể có cột khác nhau, xem mục 6).
4. **Xác nhận** — xem lại, lưu (và duyệt luôn nếu có quyền).

Luồng này **không có SLA/checklist bàn giao nội bộ** — phù hợp khi không cần
kiểm soát chặt giữa Presale/Sale/Admin.

## 6. Mẫu báo giá (Quote Form)

- Mỗi **Công ty phát hành** (Issuer Company) có thể có nhiều **Mẫu báo giá** riêng,
  mỗi mẫu định nghĩa: các trường hiển thị (STT/Hạng mục/Tính năng/Đơn giá/SL/Đơn
  vị/Giảm giá/VAT/Thành tiền/...), logo, thông tin liên hệ mặc định.
- Quản lý tại **CRM → Mẫu báo giá** (xem/sửa/xoá/xem thử từng mẫu).
- Dữ liệu hạng mục thật vẫn lưu theo 1 cấu trúc chuẩn (Hạng mục=tên gọn, Mô tả=chi
  tiết/tính năng, SL, Đơn vị, Giá vốn, Markup, Giá khách, VAT, Giảm giá) — mẫu báo
  giá chỉ quyết định **hiển thị cột nào, tên cột gì** trên bản gửi khách, không đổi
  cách Presale/Sale nhập liệu.

## 7. Một vài quy tắc cần nhớ

- **Giá vốn** luôn là việc của Presale, chỉ nhập được ở Bước 1 (hoặc bất cứ lúc nào
  nếu dùng "Tạo báo giá nhanh"). **Markup/Giá khách** là việc của Sale, chỉ mở khoá
  từ Bước 2 trở đi trong luồng đầy đủ — không có ngoại lệ cho Admin/Leader.
- Báo giá có thể tạo **nhiều phiên bản (V1, V2...)** từ 1 bản đã duyệt — bản cũ bị
  khoá vĩnh viễn, không sửa lại được, chỉ tạo bản mới.
- Xoá báo giá là **soft delete** mặc định (không mất dữ liệu) — hard delete thật sự
  chỉ dành cho Admin, yêu cầu nhập đúng số báo giá + lý do.
- Không tự đổi được Khách hàng/Cơ hội/Mẫu báo giá của 1 báo giá **sau khi đã tạo** —
  cần tạo báo giá mới nếu chọn nhầm ngay từ đầu.
