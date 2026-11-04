# CRM — Functional Spec (đầy đủ chức năng & nghiệp vụ)

## Omnichannel Email Inbox (Dev)

- Email là kênh thật: nhận bằng IMAP, gửi/reply bằng SMTP; không dùng fixture/store RAM hoặc fallback `delivered` giả.
- Hội thoại, message, attachment và IMAP cursor lưu database, khóa tenant bằng `instance`. Attachment nằm trong bucket private.
- Gmail OAuth dùng Google Identity Services auth-code popup với client riêng cho Email Inbox, scope
  `gmail.modify`, `openid`, `email`, `profile`; không dùng client Google Login/Drive và không dùng
  scope `https://mail.google.com/`.
- OAuth state được ký, ràng buộc `instance` + user + origin, lưu hash một lần trong DB. Access/refresh token được mã hóa
  trong `omnichannel_email_accounts`; một workspace được nối nhiều Gmail theo khóa `(instance, account_email)`.
- Seeding/Main và CRM Markee cùng `instance=markee`; lease đồng bộ trong DB bảo đảm chỉ một worker sync mỗi account,
  tránh tải trùng khi hai Docker stack cùng chạy.
- Toàn bộ `/api/all-platform/email-inbox/*` bắt buộc authentication và quyền module Customer. Sync thủ công và simulate
  yêu cầu admin/leader; simulate mặc định tắt và chỉ dành cho Dev.
- Threading ưu tiên `Message-ID`/`In-Reply-To`/`References`, sau đó mới fallback theo subject + địa chỉ ngoài hệ thống.
  Gmail reply đồng thời truyền `threadId` của Gmail API để thư nằm đúng thread phía nhà cung cấp.
- CRM 360 tiếp tục liên kết customer/deal/contract theo đúng workspace.
- Điều kiện nghiệm thu: phải kiểm thử với mailbox thật cho từng workspace, kiểm tra thư thực sự tới mailbox đích và
  dữ liệu còn sau restart Docker. Thiếu credential hoặc migration thì trạng thái là BLOCKED, không phải PASS.

**Trạng thái**: audit 2026-10-10, đọc source code thực tế (không suy đoán). Phạm vi: Main app
(`linkedin_group_crawler` + `linkedin-crawler-ui`) audit sâu; 3 clone (`crm-module`, `crm-cloudgate`,
`crm-securityzone`) kiểm tra nhẹ (đối chiếu cấu trúc file/line-count, KHÔNG diff nội dung đầy đủ trừ khi
ghi chú riêng). Xem `SHARED_COMPONENT_MAP.md` cho chi tiết entry point → code; `CRM_FLOW_MAP.md` cho
luồng liên kết dữ liệu; `REGRESSION_CHECKLIST.md` cho checklist kiểm thử.

5 module chính, theo đúng thứ tự vòng đời nghiệp vụ: **Lead → Khách hàng (Customer) → Cơ hội/Deal →
Báo giá (Quote) → Hợp đồng (Contract)**. Cộng với 1 lớp xuyên suốt: **Phân quyền & đa tenant**.

---

## 1. Lead (`crm_leads`)

Lead = đầu mối thô, CHƯA xác minh, bảng `crm_leads` (migration 078), tách biệt hoàn toàn với
`customer_leads` (bảng Deal, tên dễ nhầm — xem mục 3).

### 1.1 CRUD
- **Tạo**: `LeadFormDrawer` → `POST /crm/leads`. Validate trùng (phone/email), chặn tạo thẳng với
  `status ∈ {sql, qualified, converted}` (các trạng thái này CHỈ đạt được qua luồng xác minh/convert).
- **Danh sách/lọc**: `LeadsDirectory.tsx` — tìm theo tên/công ty/phone/email + `customer_code`/
  `contact_code`; lọc status/source/sdr_id/team; KPI luôn tính trên toàn bộ tập đã lọc (không riêng
  theo tab status đang chọn).
- **Chi tiết/sửa**: `LeadDetailDrawer.tsx` — sửa field thường; đổi field quan trọng (tên/phone/email/
  company) lan truyền xuống Customer/Contact/Deal/Quote đã sinh ra từ Lead này
  (`crm_cascade_sync_service.propagate_lead_change()`).
- **Xóa** (đơn + hàng loạt): KHÔNG có gate quyền (quyết định nghiệp vụ 2026-09-23: "ai muốn xóa thì
  xóa, hỏi xác nhận trước"), chỉ giới hạn tenant. Còn dữ liệu liên quan (đã convert) → hỏi xác nhận
  cascade.
- **Sao chép sang workspace khác**: admin-only, chỉ sao chép đúng 1 dòng `crm_leads` (không cascade),
  chặn copy về lại chính `origin_instance` (chống tạo trùng khi copy qua lại nhiều vòng), chặn copy
  Lead đã SQL/đã convert.

### 1.2 Phân loại/chấm điểm (MQL → Nuôi dưỡng → SQL)
- Engine rule-based cấu hình được (1 bảng config `crm_lead_classification_rules`, admin sửa được qua
  `LeadClassificationRuleSettings.tsx`), mirror y hệt giữa Python (`crm_lead_rule_service.py`) và JS
  (`utils/leadQualificationRules.ts`) để preview real-time phía client.
- Thứ tự ưu tiên: Không đạt chuẩn (OR) > Nuôi dưỡng (near-miss, chỉ fire khi mọi điều kiện SQL khác đã
  đạt) > SQL (AND toàn bộ điều kiện bật) > `pending` (chưa đủ dữ liệu).
- ICP fit tự tính CHỈ ở frontend (không duplicate logic Python).

### 1.3 Chuyển đổi Lead → Khách hàng (Convert)
- 1 giao dịch atomic (RPC `crm_convert_lead`) tạo: Khách hàng (tìm-hoặc-tạo trong đúng tenant) + Deal
  (`customer_leads`) + Người liên hệ (`crm_contacts`, luôn tạo) + ghi activity log + đánh dấu Lead
  `converted`.
- Trigger: "Xác minh Lead" → "Xác nhận tạo cơ hội" trong `LeadDetailDrawer.tsx`, bắt buộc đã qualify
  SQL + chọn Team Sale + chọn Sale nhận bàn giao trước khi mở bước xác nhận.
- Kèm theo: ghi nhận bàn giao (`crm_lead_handover_service`, có thể gửi email), điều hướng sang
  `/customers/{id}?tab=quotes` sau khi convert thành công.
- "Bàn giao Sale" là hành động RIÊNG (không nằm trong transaction convert) — dùng được cả trước và
  sau khi convert.

### 1.4 Quyền
- Sửa/xem: `can_write_lead`/`can_view_lead` (full-access role, hoặc chủ sở hữu `sdr_id`, hoặc theo
  scope Team CRM).
- Sao chép workspace: admin-only riêng (không dùng `can_write_lead`).
- Sửa rule phân loại: admin-only.

---

## 2. Khách hàng (Customer, `crm_customers`)

Entity chính/canonical cho 1 tổ chức/doanh nghiệp là khách hàng.

### 2.1 CRUD
- **Tạo**: `CustomerAddDrawer.tsx` (chỉ tạo hồ sơ, không tạo Deal) hoặc tạo kèm Deal luôn (xem mục 3).
  Tự sinh `short_name` cho khách doanh nghiệp, tự sinh `customer_code`.
- **Danh sách/lọc**: `CrmCustomersDirectory.tsx` — tìm xuyên cả bảng `crm_contacts` (để tìm ra đúng
  Khách hàng khi chỉ biết SĐT/email của 1 người liên hệ phụ).
- **Xem nhanh**: `CustomerQuickViewPanel.tsx` (slide-in panel).
- **Chi tiết đầy đủ**: `CrmCustomerDetailPage.tsx`, 8 tab: Tổng quan/Hoạt động/Người liên hệ/Dự án/
  Cơ hội/Báo giá/Hợp đồng/(tài liệu bàn giao).
- **Xóa** (đơn + hàng loạt): không gate quyền, hỏi xác nhận cascade nếu còn Deal/Lead/Contact/Project/
  Quote/Contract liên quan.
- **Sao chép sang workspace khác**: admin-only, y hệt Lead nhưng KHÔNG có cột `origin_instance` (chỉ
  `crm_leads` mới có — migration 128) nên chỉ chặn copy-về-chính-workspace-hiện-tại, không chặn được
  vòng lặp nhiều bước qua lại như Lead. Không cascade dữ liệu liên quan.

### 2.2 Nhóm trạng thái (status: `new_lead`/`following`/`current_customer`/`not_fit`)
- Sửa tay: qua form sửa hồ sơ, không gate riêng ngoài `can_edit_customer`.
- **Tự động tính** (tính năng mới, 2026-10-10): `crm_customer_progress_service.py` — suy ra từ Deal
  đang hoạt động nhất + Báo giá/Hợp đồng của Deal đó (KHÔNG hardcode cứng 3 loại việc tiếp theo).
  Thang ưu tiên: hợp đồng đã ký/active/hoàn tất → "Triển khai/chăm sóc" + nhóm `current_customer`; hợp
  đồng chờ ký → "Theo dõi ký kết"; có hợp đồng (bất kỳ trạng thái hợp lệ) → "Theo dõi hợp đồng"; báo
  giá đã duyệt → "Gửi/chốt báo giá"; có báo giá → "Theo dõi báo giá"; không có gì → nhãn mặc định theo
  status hiện tại. Nhóm CHỈ được tự nâng lên (never hạ xuống), `not_fit` không bao giờ bị tính lại.
- Hook tự động chạy sau: tạo/duyệt/hủy báo giá (`supabase_quote_service.py`), tạo/sửa/đổi trạng
  thái/xóa hợp đồng (`supabase_contract_service.py`) — độc lập với cờ `CONTRACT_STAGE_SYNC_ENABLED`.

### 2.3 "Việc tiếp theo" (next action)
- Backend tính 1 chỗ (`attach_next_action()`, gọi từ `_attach_customer_metrics()`), dùng chung cho cả
  danh sách VÀ chi tiết 1 khách hàng.
- **Hiển thị**: danh sách ✅, xem nhanh (quick-view) ✅, **trang chi tiết đầy đủ ❌ — KHÔNG hiển thị ở
  đâu cả dù backend đã trả field này** (gap đã xác nhận qua đọc code, xem `REGRESSION_CHECKLIST.md`).

### 2.4 Quyền & phạm vi nhìn thấy
- `can_edit_customer`: full-access, hoặc chủ sở hữu (`owner_id`), hoặc cùng Team CRM với chủ sở hữu.
- `can_view_customer`: superset của edit + danh sách id "nhìn thấy được" theo scope (Nhóm quyền opt-in
  qua `permission_group_id`, hoặc mặc định full nếu chưa gán nhóm quyền).
- admin/leader LUÔN thấy mọi Team trong bộ lọc Team (đọc thẳng cột `role`, không qua
  `has_full_crm_access` — cố ý, để không vô tình mở quyền này cho Sale thường).

### 2.5 Các tab liên quan (trang chi tiết)
Cơ hội (lọc theo quyền xem Deal), Người liên hệ, Dự án (có cả endpoint riêng cho tab + 1 bản tóm tắt
trong `/related` — hơi trùng lặp nhưng cả 2 đều lọc đúng tenant/customer), Báo giá (áp field-permission
đúng như mọi endpoint Quote khác — đã từng là 1 lỗ hổng lộ giá vốn, đã vá), Hợp đồng (gộp cả hợp đồng
qua Deal LẪN hợp đồng tạo thẳng trên Customer, lọc quyền riêng cho nhánh thứ 2), Hoạt động (**chỉ** là
hoạt động Deal/Sales — chưa phải timeline hợp nhất gồm Quote/Contract/sửa hồ sơ).

---

## 3. Cơ hội/Deal (Pipeline, bảng `customer_leads` — LƯU Ý: tên bảng dễ nhầm với "Lead")

### 3.1 Pipeline 10 bước
`dealing(1) → requirement(2) → proposal_sent(3) → negotiation(4) → contract_signed(5) →
payment_1(6) → implementation(7) → acceptance(8) → payment_final(9) → post_sale_care(10)`, cộng
`on_hold`/`lost` (terminal, trong `TERMINAL_STAGES`) và `won` (terminal theo hành vi backend nhưng
**không** nằm trong `TERMINAL_STAGES`/`DEAL_STAGES` ở frontend — xem flag trong
`REGRESSION_CHECKLIST.md`).

### 3.2 Tự động chuyển stage (CHỈ 1-5)
- `deal_stage_sync_service.py`: báo giá đã duyệt → `negotiation`(4); báo giá đang lập giá →
  `proposal_sent`(3); hợp đồng hợp lệ → `contract_signed`(5) **NHƯNG đang tắt**
  (`CONTRACT_STAGE_SYNC_ENABLED = False`). Luôn chỉ tiến lên, không bao giờ lùi; stage 6-10/
  on_hold/lost/won không bao giờ bị ghi đè tự động.
- Hook sau mọi hành động tạo/duyệt/hủy báo giá VÀ tạo/sửa/đổi trạng thái/xóa hợp đồng.

### 3.3 Chuyển stage thủ công
`StageModal.tsx` — field bắt buộc khác nhau theo từng stage (budget/note/lý do); stage `won`/`lost` có
form "outcome" đầy đủ (kết quả, độ tự tin, lý do, 5 điểm chấm theo chiều fit/sales/price/trust/speed,
bài học rút ra...) phục vụ AI Sales Coach/knowledge-base — không phải chỉ đổi 1 cột status.

### 3.4 Tạo/sửa Cơ hội — 4 code path khác nhau (chi tiết: `SHARED_COMPONENT_MAP.md` mục 1)
1. RPC `crm_create_customer_with_deal` (atomic, tạo kèm/liên kết Customer) — dùng bởi "Tạo cơ hội bán
   hàng" (`CreateOpportunityDrawer`) VÀ "Tạo cơ hội nhanh" (`DealFormModal`, mode tạo mới).
2. RPC `crm_convert_lead` (atomic, RIÊNG với path 1 dù cùng hình dạng nghiệp vụ) — dùng bởi convert
   Lead.
3. Insert thẳng `customer_leads`, KHÔNG qua RPC nào, KHÔNG bắt buộc liên kết `crm_customers` —
   `CrmCustomerModal.tsx` (dùng trong các màn hình inbox Zalo/Facebook để lưu nhanh 1 đầu mối từ hội
   thoại). Validate lỏng nhất trong 4 path (chỉ bắt buộc tên).
4. Update thuần (không phải tạo) — `update_customer_lead()`.

### 3.5 Board Kanban & Deal Workspace
- Kéo-thả đổi stage đi qua ĐÚNG endpoint `transition_stage` giống hệt nút "Chuyển giai đoạn" thủ công
  — không có code path riêng.
- `CustomerDealSplitTab.tsx` (Deal workspace nhúng trong Customer 360): tạo/xóa/sửa Deal, chuyển
  stage, thêm sản phẩm từ Catalog, tạo Báo giá — picker "Sale phụ trách" là **hybrid**: ưu tiên
  `quote_business_role`, fallback dò chuỗi text trên HR roster khi danh sách role rỗng.
- **LƯU Ý**: `CrmShell.tsx`/`DealCard.tsx`/`DetailDrawer.tsx` (1 bộ Kanban+drawer khác) đã **chết**
  (không còn route/component nào import) — đừng dùng làm nguồn tham chiếu hành vi board hiện tại.

---

## 4. Báo giá (Quote, bảng `quotes`)

### 4.1 Tạo báo giá — converge gần hết nhưng KHÔNG 100%
Toàn bộ đều ghi cuối cùng qua 1 endpoint `POST /quotes` → `create_quote()` (1 chỗ duy nhất ghi DB),
nhưng ở TẦNG COMPONENT có 2 UI khác nhau:
- **`QuoteWorkspaceModal.tsx`** (~8900 dòng): "Yêu cầu hỗ trợ báo giá" (Quote Center), "+ Tạo báo giá"
  (Customer Detail, cả 2 tab Báo giá lẫn từ 1 Deal cụ thể trong tab Cơ hội), "+ Tạo yêu cầu báo giá"
  (Lead 360).
- **`CreateQuoteModal.tsx`** (wizard, ~1060 dòng): "+ Tạo báo giá" trong Deal Workspace (Kanban board
  thật, `DealWorkspaceTabs.tsx`), "Tạo theo mẫu" (Quote Center), và là nơi "Lưu nháp" từ
  `QuoteWorkspaceModal` được chuyển tiếp sang để sửa tiếp (trừ Lead 360 — xem mục 4.2).

Chi tiết bảng so sánh prop/hành vi từng entry point: `SHARED_COMPONENT_MAP.md` mục 2.

### 4.2 Khác biệt hành vi theo entry point (đã xác nhận qua code, không phải giả định)
- `agents` (danh sách Presale/Sale cho dropdown) rỗng cứng khi mở từ Lead 360
  (`LeadQuoteWorkspaceHost.tsx` truyền `agents=[]`) — các entry point khác đều truyền danh sách thật.
- "Lưu nháp" chuyển tiếp sang `CreateQuoteModal` ở 3/4 entry point của `QuoteWorkspaceModal`, nhưng
  Lead 360 thì KHÔNG chuyển tiếp — ở lại ngay trong `QuoteWorkspaceModal`, chỉ đổi `activeQuoteId`.
- "+ Tạo báo giá" trong Project → tab Báo giá (`CustomerProjectsTab.tsx`) **thực ra mở form Tạo Cơ hội
  (`DealFormModal`), không mở form báo giá nào cả** — nút dán nhãn sai/chưa làm xong tính năng, không
  tạo ra `quotes` row nào.
- 3 cụm code đã **chết** (định nghĩa sẵn, không nút nào gọi tới): "Báo giá nhanh" qua
  `openQuickQuoteForProject`/`openQuickQuoteForCustomer` trong `CrmCustomerDetailPage.tsx`, và
  `openDealPicker()` trong `QuoteCenterPage.tsx`.

### 4.3 Validate bắt buộc ở backend (áp dụng mọi entry point, vì chỉ 1 endpoint)
`quote_form_id` phải tồn tại + đang `active`; `deal_id` phải tồn tại trong đúng tenant — nếu không có
sẵn Deal, mọi luồng tạo báo giá đều phải tự tạo/chọn Deal trước.

### 4.4 Side-effect sau tạo/duyệt/hủy báo giá
`_wrap_deal_stage_sync()`: đồng bộ stage Deal (mục 3.2) + tính lại tiến độ Khách hàng (mục 2.2), cả
2 đều best-effort (lỗi không làm hỏng thao tác báo giá). Frontend bắn sự kiện `notifyDealsChanged()`
sau mọi thao tác ghi để các tab/trang khác tự tải lại không cần F5.

### 4.5 Quyền
Tạo báo giá: KHÔNG gate role (chỉ cần đăng nhập + đủ `deal_id`/`quote_form_id`). Sửa: `can_edit_quote`.
Duyệt: `can_approve_quote` (role admin hoặc cờ `can_approve_quotes`). Field giá vốn/giá bán/lợi nhuận:
3 nhóm quyền xem/sửa riêng (`can_view_quote_cost`, `can_view_quote_pricing`,
`can_view_quote_profitability` + các hàm `can_edit_*` tương ứng), dựa trên full-access, nhóm quyền
được cấp, hoặc đúng vai trò `technical_owner`(presale)/`quote_owner`(sale) của chính báo giá đó.

---

## 5. Hợp đồng (Contract, bảng `contracts`)

### 5.1 Hai nguồn tạo hợp đồng
1. **AI Contract Copilot** (`source='crm'`) — `ContractAIWizard.tsx`, 3 bước (Yêu cầu & Kỹ thuật
   (Presale) → Hoàn thiện giá bán (Sale) → Xem trước & hoàn thiện (Duyệt)). Sinh file DOCX/PDF thật qua
   `contract_docx_engine.py`/`contract_docx_pipeline.py`, lưu nhiều phiên bản trong Storage
   (`contract_document_store.py`). Bước 3 tích hợp tab **Chỉnh sửa (Word)** trực tiếp qua OnlyOffice Document
   Server cho phép chỉnh sửa DOCX trực tiếp giữ nguyên layout, font, bảng biểu; hỗ trợ autosave, flush
   session cập nhật bản xem trước PDF & rà soát rủi ro, và nộp đúng bản Word đã sửa khi bấm "Gửi duyệt".
2. **Ghi nhận hợp đồng có sẵn** (`source='external'`) — `RegisterExternalContractModal.tsx`, cho hợp
   đồng KHÔNG soạn bằng AI (và cả loại "Mua vào/Bán ra" `deal_phase`). Có tính năng đối chiếu OCR với
   báo giá đã chọn.

### 5.2 Vòng đời trạng thái
`draft → pending_legal → pending_signature → signed → active → completed|terminated`, cộng
`expiring`/`expired` (tồn tại trong enum + KPI tính "sắp hết hạn" từ `end_date`, nhưng **KHÔNG có code
nào tự động ghi 2 trạng thái này** — chỉ đạt được qua thao tác tay).

**Cổng kiểm tra readiness** (chỉ áp dụng cho hợp đồng ĐÃ có file DOCX đã lưu, và chỉ khi chuyển vào
`pending_legal`/`pending_signature`): đủ tài liệu, báo giá liên kết còn hợp lệ, giá trị khớp báo giá,
thông tin pháp lý đủ 2 bên, đã chạy AI rà soát rủi ro trên đúng bản mới nhất.

**Quyền duyệt**: xác nhận qua code — **CHƯA có gate "chỉ admin/leader mới được duyệt"** như kế hoạch
từng đề ra. Mọi chuyển trạng thái (kể cả pending_legal→pending_signature) chỉ cần
`can_edit_contract` (người tạo, chủ Deal, hoặc theo scope) — giống như mọi sửa hợp đồng khác. Xem
`REGRESSION_CHECKLIST.md`.

### 5.3 Liên kết Deal/Báo giá/Khách hàng
`contracts.deal_id` (qua Deal) và/hoặc `contracts.customer_id` (tạo thẳng trên Khách hàng, không qua
Deal — migration 130). Khi cả 2 đều có, Deal luôn được ưu tiên giải quyết `customer_id` thật (tránh
dữ liệu client gửi lệch). `contracts.quote_id` liên kết báo giá gốc.

### 5.4 Side-effect
Đồng bộ stage Deal (mục 3.2, đang TẮT qua cờ) + tính lại tiến độ Khách hàng (mục 2.2, LUÔN chạy, độc
lập với cờ trên).

### 5.5 "Xem" khác "Sửa" tùy nguồn gốc hợp đồng
UI chi tiết (`ContractDetailPage.tsx`) hiện panel đầy đủ (DOCX/PDF/Legal-Check/Risk/Duyệt) khi hợp
đồng ĐÃ có phiên bản tài liệu lưu (`hasDocs`), bất kể `source`; nút "Sửa" (pencil icon) ở danh sách
trong Customer 360 thì rẽ nhánh thẳng theo `source`: `external` → mở form đơn giản
(`RegisterExternalContractModal`), còn lại → mở panel đầy đủ ở chế độ focus-edit. Trong panel đầy đủ
vẫn có nút phụ "Sửa thông tin ghi nhận" để quay lại form đơn giản khi cần.

---

## 6. Phân quyền & đa tenant (xuyên suốt mọi module trên)

- **Tenant**: mọi bảng CRM có cột `instance`, mọi truy vấn phải `.eq("instance", settings.crm_instance)`
  — đã kiểm tra rộng, chưa phát hiện lỗ hổng (trừ vài service chưa kịp mở để soát, xem
  `REGRESSION_CHECKLIST.md`). Ngoại lệ CÓ CHỦ Ý: tính năng "Sao chép sang workspace khác" (admin-only)
  — đúng bản chất là ghi CHÉO sang `instance` khác.
- **Role**: `admin`, `leader`, các vai trò khác qua `quote_business_role ∈ {presale, sale, both}` +
  cờ lẻ (`can_approve_quotes`, `can_send_quotes`...).
- **Nhóm quyền (permission_group, migration 155, opt-in per user)**: chưa gán nhóm quyền → giữ hành
  vi cũ (full-access theo role/owner); đã gán → áp scope `personal`/`team`/`deal_assigned`/
  `workspace`/`system` (2 mode cuối hiện tương đương "không giới hạn", app 1-instance chưa có khái
  niệm workspace riêng để lọc thêm).
- **Team CRM** (`crm_teams`/`crm_team_members`, migration 155) là khái niệm team ĐÚNG hiện tại
  (dùng cho scope "team" + filter Team ở danh sách Khách hàng/Lead), KHÁC với HR roster cũ
  (`useMembers()`, bảng `members`) và KHÁC với `teams.team_type='sale'` cũ hơn nữa (3 tầng lịch sử
  cùng tồn tại). Picker "Sale phụ trách"/"Presale" ĐÚNG phải dùng
  `usersService.getUsersByQuoteBusinessRole()`, KHÔNG dùng `useMembers()` trực tiếp — vẫn còn vài nơi
  sai pattern này, liệt kê trong `REGRESSION_CHECKLIST.md`.
