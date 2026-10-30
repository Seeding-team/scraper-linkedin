# CRM — Shared Component Map (Entry point → Component → API → Service → DB)

## Omnichannel Email

| Entry point | Frontend | API | Backend/service | Storage |
|---|---|---|---|---|
| `/all-platform/omnichannel-inbox` → Email | `OmnichannelInboxView` → `OmnichannelRepository` | `/api/all-platform/email-inbox/*` | `email/api/routes/email_inbox.py` → `email/services/email_inbox_service.py` | `omnichannel_email_*` + private bucket `omnichannel-email-attachments` |
| Kết nối Google Workspace/Gmail | `EmailConnectModal` → GIS auth-code popup | `GET /email-inbox/oauth/google/state` → `POST /email-inbox/oauth/google/callback` | state HMAC + one-time DB consume → Google token exchange | `omnichannel_email_oauth_states`, `omnichannel_email_accounts` (token mã hóa) |
| Email Provider Admin | cấu hình kênh gửi hiện có | Email provider endpoints | `quote_email_provider_service.py` | `quote_delivery_channels` (credential mã hóa, khóa theo `instance`) |

Scheduler IMAP nằm ở `jobs/email_imap_sync_job.py`; `app/main.py` chỉ khởi động khi
`EMAIL_IMAP_SYNC_ENABLED=1`. Khi sửa contract response của Email API phải port đồng thời Main và cả 4 clone
(`crm-module`, `crm-cloudgate`, `crm-securityzone`, `crm-timetech`).
Composer attachment đi qua `MessageComposer` → `OmnichannelInboxView` → `OmnichannelRepository.sendMessage`
và chỉ hiển thị message đã gửi sau khi API SMTP trả thành công.
Gmail OAuth dùng riêng `NEXT_PUBLIC_GMAIL_OAUTH_CLIENT_ID` ở frontend và `GMAIL_OAUTH_*` ở backend. Không fallback
sang `NEXT_PUBLIC_GOOGLE_CLIENT_ID`/Google Login/Drive. Migration `203_omnichannel_email_oauth_hardening.sql` bổ sung
state một lần, Gmail `provider_thread_id` và sync lease dùng chung cho hai stack có cùng `instance=markee`.

**Trạng thái**: audit 2026-10-10, đọc source thực tế. Main app audit sâu (file:line chính xác); 3
clone (`crm-module`/`crm-cloudgate`/`crm-securityzone`) **chỉ kiểm tra nhẹ** (đối chiếu tồn tại file +
line-count, KHÔNG diff nội dung đầy đủ ở đa số trường hợp — xem ghi chú "Clone parity" cuối mỗi mục).
Dùng file này TRƯỚC KHI sửa bất kỳ component nào xuất hiện ở đây — rất nhiều component được DÙNG
CHUNG bởi nhiều entry point mang tên khác nhau.

---

## 1. "Tạo Cơ hội/Deal" — 4 code path khác nhau (KHÔNG converge hoàn toàn)

| # | Tên nút (UI) | File trigger | Component | Frontend repo | Backend endpoint | Service | DB |
|---|---|---|---|---|---|---|---|
| A | "Tạo cơ hội" (Chi tiết KH, 2 chỗ: Tổng quan + tab Cơ hội), "+ Deal"/"+ Upsell" (danh sách KH), "+ Tạo cơ hội mới" (trong dropdown "Cơ hội CRM" của `QuoteWorkspaceModal`, đổi sang path A ngày 2026-10-10) | `CrmCustomerDetailPage.tsx:1234,1283`; `CrmCustomersDirectory.tsx:870-883`; `QuoteWorkspaceModal.tsx:5037,3842-3846` | `CreateOpportunityDrawer.tsx` | `seedingCrmRepository.createDeal()` (`SeedingCrmRepository.ts:705-720`) | `POST /crm/customers/with-deal` | `create_customer_with_deal()` (`crm_customer_service.py:857`) | RPC `crm_create_customer_with_deal` (migration 077, sửa lại ở 101/120/121/135) |
| B | "Tạo cơ hội" (header Kanban board — nhãn thật là "Tạo cơ hội", KHÔNG phải "+ Thêm deal"), "+ Deal"/"+ Tạo deal mới" (từ 1 Project card), "Tạo cơ hội" khóa sẵn 1 Contact cụ thể | `CrmShell.tsx:464-466,553-554`; `CrmCustomerDetailPage.tsx` (Project card, Contact-locked variant `:1246`) | `DealFormModal.tsx` (mode tạo) + `DealFormFields.tsx` (dùng chung với A qua `CustomerProfileCombobox`/`ProjectPicker`, KHÔNG dùng chung `ContactPicker` — xem ghi chú) | `seedingCrmRepository.createDeal()` (y hệt A) | `POST /crm/customers/with-deal` (y hệt A) | `create_customer_with_deal()` (y hệt A) | RPC `crm_create_customer_with_deal` (y hệt A) |
| C | "Xác nhận tạo cơ hội" (bước xác nhận cuối của "Xác minh Lead") | `LeadDetailDrawer.tsx:1379-1381` | `LeadDetailDrawer.tsx` (`handleConvert()` nội bộ, không phải modal riêng) | `fetch()` trực tiếp (không qua class repository) | `POST /crm/leads/{id}/convert` | `convert_lead()` (`crm_lead_service.py:850`) | RPC **`crm_convert_lead`** (migration 078) — **RPC KHÁC** với A/B dù hình dạng nghiệp vụ giống nhau |
| D | "Tìm khách hàng"/"Lưu khách hàng (Lead) này"/"+ Thêm tag" trong các màn hình inbox Zalo/Facebook | `ZaloInboxAdminShell.tsx:2861-2867`; `LeaderInboxView.tsx:951-957`; `InboxModernLayout.tsx:1523-1529,911-913` | `CrmCustomerModal.tsx` (`components/all-platform/components/`) | `customerLeadService.create()` (`services/customer-lead.service.ts:639-644`) | `POST /customer-leads` | `create_customer_lead()` (`customer_lead_service.py:425-494`) | **Insert thẳng** `customer_leads`, KHÔNG qua RPC nào, KHÔNG tạo/liên kết `crm_customers` trừ khi caller tự truyền `customer_id` sẵn (form này không có customer-picker) |

**Validate bắt buộc khác nhau theo path** (đây chính là chỗ hay phát sinh "sao chỗ kia bắt buộc mà
chỗ này không"):
- A (`CreateOpportunityDrawer`): chỉ bắt buộc `customerId` + `nextStep` + `followUpDate`. Team
  Sale/Sale phụ trách chỉ chặn MỀM (nút bị disable, không phải validate cứng).
- B (`DealFormModal` tạo mới): bắt buộc thêm `dealName` (tên dự án/cơ hội), `email` HOẶC `phone`, và
  CỨNG `crmTeamId`+`sdrId` (window.alert chặn hẳn, không chỉ disable nút).
- C (convert Lead): bắt buộc `isReady` (đã qualify SQL) + `teamId` + `aeId` trước khi MỞ ĐƯỢC bước xác
  nhận — chặt nhất trong 4 path.
- D (`CrmCustomerModal`): CHỈ bắt buộc `customer_name` non-empty. Không Team Sale, không Sale phụ
  trách, không next-step, không follow-up date, không bắt phone/email. **Lỏng nhất trong 4 path.**

**Ghi chú riêng**:
- `ContactPicker` trong `DealFormFields.tsx` **không được export** — chỉ path B (qua `DealFormModal`)
  dùng được; `CreateOpportunityDrawer.tsx` (path A) không import `ContactPicker`, xử lý liên hệ theo
  cách khác (field "Liên hệ" tự do, xem `CRM_FUNCTIONAL_SPEC.md` nếu cần chi tiết).
- Path D hoạt động HOÀN TOÀN độc lập, không ai review nó khi audit "tạo cơ hội" trước đây — rất dễ bị
  bỏ sót khi regression-test 1 thay đổi chung cho "tạo Deal".
- **Dead code liên quan**: `CrmShell.tsx`/`DealCard.tsx`/`modules/crm/components/DetailDrawer.tsx`
  (Kanban board + drawer cũ) không còn được import ở bất kỳ route nào — đừng lấy làm nguồn tham chiếu.

**Clone parity**: path A/B/C kiểm tra nhẹ ở `crm-module` — file tồn tại đúng path, line-count khớp
gần như tuyệt đối (lệch nhỏ 4-26 dòng ở vài service do clone đang thiếu tính năng "Web Intake" mới
nhất, không phải lỗi cấu trúc). `crm-cloudgate`/`crm-securityzone` CHƯA kiểm tra (giả định parity theo
cấu trúc file).

---

## 2. "Tạo Báo giá" — converge gần hết ở tầng DB, KHÔNG converge ở tầng component

Endpoint ghi DB chỉ có 1: `POST /quotes` → `create_quote()` (`supabase_quote_service.py:1990`). Nhưng
2 component khác nhau mở ra tùy entry point:

### 2a. Entry point dùng `QuoteWorkspaceModal.tsx` (~8900 dòng)

**Giảm giá từng hạng mục & giảm giá cố định VNĐ (2026-10-28, 2026-10-29)**: cả báo giá mới lẫn báo giá đã lưu dùng chung
`QuoteWorkspaceModal.tsx` để sửa trực tiếp và `QuoteDocumentRenderer.tsx` để xem/in/public.
`DiscountPercentInput`/`DiscountPercentDraftInput` trong cả workspace lẫn `QuoteFormFiller` giữ
chuỗi nhập tạm (kể cả rỗng/dấu thập phân đang gõ), commit khi blur;
`clampDiscountPercent()` và backend `_flatten_computed_items()` chuẩn hoá tối đa 2 chữ số lẻ.
**Số tiền giảm cố định VNĐ (2026-10-29)**: `overallDiscountAmount` (toàn báo giá) và `discountAmount` (từng hạng mục)
được giữ nguyên làm giá trị gốc tính toán thương mại; `%` chỉ để hiển thị. Khi phân bổ giảm giá cố định VNĐ xuống
nhiều hạng mục, hệ thống phân bổ theo tỷ trọng và bù phần dư vào hạng mục cuối, đảm bảo tổng tiền giảm và giá khách
sau chiết khấu chính xác tuyệt đối không bị lệch do làm tròn `%`. Backend lưu và trừ trực tiếp `discount_amount`.

| Nút | File trigger | Props khác biệt | onEditDraft |
|---|---|---|---|
| "Yêu cầu hỗ trợ báo giá" | `QuoteCenterPage.tsx:1524-1528,1680-1682` → `openRequestWorkspace()` | `deals`/`agents` toàn cục (`useCrm()`); `lockCustomer` false trừ khi có deep-link | chuyển sang `CreateQuoteModal` |
| "+ Tạo báo giá" (Customer Detail, tab Báo giá, tự do) | `CustomerQuotesTab.tsx:377-384` | `deals` chỉ của khách hàng này; `agents` fetch riêng (`dealAgents`); `initialCustomerId` luôn set; `lockCustomer=true` | chuyển sang `CreateQuoteModal` |
| "+ Tạo báo giá"/"Tạo báo giá đầu tiên" (Customer Detail, tab Cơ hội, từ 1 Deal cụ thể) | `CustomerDealSplitTab.tsx:1156,1946` → `onCreateQuote` | như trên + `initialDealId` set sẵn | chuyển sang `CreateQuoteModal` |
| "+ Tạo yêu cầu báo giá" (Lead 360) | `Lead360Drawer.tsx:460` → `LeadQuoteWorkspaceHost.tsx` | `deals`=1 Deal duy nhất; **`agents=[]` hardcode rỗng** (đã fix 1 chỗ y hệt ở Customer Detail trước đây, Lead 360 vẫn còn rỗng — xem `REGRESSION_CHECKLIST.md`); `lockCustomer=true` luôn | **KHÔNG** chuyển tiếp — ở lại trong chính `QuoteWorkspaceModal`, chỉ đổi `activeQuoteId` |

### 2b. Entry point dùng `CreateQuoteModal.tsx` (wizard, ~1060 dòng)

| Nút | File trigger | Props khác biệt |
|---|---|---|
| "+ Tạo báo giá" (Deal Workspace/Kanban board thật, route `/all-platform/crm`) | `DealWorkspaceTabs.tsx:208-214` (`QuoteTab`) | `deals`=1 Deal tổng hợp từ customer; KHÔNG truyền `agents` (mặc định `[]` bên trong modal) |
| "Tạo theo mẫu" (Quote Center) | `QuoteCenterPage.tsx:1727` → `openTemplateModal()` | `deals`/`agents` toàn cục; `initialQuoteFormId` set sẵn → wizard nhảy thẳng bước 3 |
| (Lưu nháp từ QuoteWorkspaceModal, trừ Lead 360) | xem bảng 2a | kế thừa props từ nơi gọi |

**Nút "trông giống" nhưng KHÔNG tạo báo giá**: "+ Tạo báo giá" trong Project → tab Báo giá
(`CustomerProjectsTab.tsx:399-405`) dùng CHUNG handler với nút "Tạo cơ hội" bên cạnh
(`onClick={() => setDealModal({ open: true, project: selectedProject })}`) → mở `DealFormModal`
(form Cơ hội), KHÔNG mở form báo giá nào. Đây là bug/tính năng chưa hoàn thiện, không phải by-design
— báo cho sản phẩm/eng xác nhận trước khi coi là "đã có tính năng" này.

**Dead code đã xác nhận** (định nghĩa sẵn, KHÔNG nút nào gọi tới, xác nhận bằng grep toàn repo):
- `openQuickQuoteForProject()`/`openQuickQuoteForCustomer()` + state `quickQuoteDeal` trong
  `CrmCustomerDetailPage.tsx:881-925,1497-1507` — truyền xuống `CustomerQuotesTab`/
  `CustomerProjectsTab` nhưng không component nào gọi.
- `openDealPicker()`/`pickDealAndOpen()`/`dealPickerOpen` trong `QuoteCenterPage.tsx:712-725`.

**Side-effect sau tạo/duyệt/hủy/version** (áp dụng mọi entry point vì cùng chạy qua `create_quote()`):
`_wrap_deal_stage_sync()` (`supabase_quote_service.py:3064-3102`) bọc `create_quote`, `approve_quote`,
`cancel_quote`, `soft_delete_quote`, `restore_quote`, `create_quote_version` — gọi `sync_deal_stage()`
rồi `recompute_customer_progress()`, cả 2 best-effort. Frontend (`SeedingQuoteRepository.ts:775-784`)
bắn `notifyDealsChanged()` sau mọi thao tác ghi tương ứng.

**Tạo phiên bản mới** (`POST /quotes/{id}/create-version`) cũng ghi 1 dòng `quotes` mới (cùng
`version_chain_id`) — 1 cách "tạo báo giá" nữa hay bị quên khi liệt kê, gọi được từ `QuoteCenterPage`
VÀ từ bên trong `QuoteWorkspaceModal`.

**Clone parity**: file lớn nhất (`QuoteWorkspaceModal.tsx`, `routers/quote.py`) có **line-count giống
hệt tuyệt đối** ở cả 4 app — tín hiệu mạnh là đang đồng bộ, nhưng CHƯA diff nội dung để xác nhận 100%.

---

## 3. "Tạo/Ghi nhận Hợp đồng" — 2 nguồn, cùng 1 endpoint ghi

| Nguồn | Nút | File | Component | Endpoint | Service |
|---|---|---|---|---|---|
| AI Copilot (`source='crm'`) | "Soạn hợp đồng AI" | `CustomerContractsTab.tsx:228-236`; `ContractHomePage.tsx:288` | `ContractAIWizard.tsx` | `POST /contracts` (+ `/precheck`, `/generate-draft` không ghi DB) | `create_contract()` (`supabase_contract_service.py`) |
| Ghi nhận ngoài (`source='external'`) | "Thêm hợp đồng"/"Ghi nhận hợp đồng có sẵn" | `CustomerContractsTab.tsx:218-227` | `RegisterExternalContractModal.tsx` | `POST /contracts` (cùng endpoint, khác `source` trong payload) | `create_contract()` (y hệt) |

**Sửa hợp đồng — rẽ nhánh theo `source` CHỈ ở đúng 1 chỗ** (nút "Sửa"/pencil icon trong
`CustomerContractsTab.tsx:126-141,138`): `source==='external'` → mở thẳng
`RegisterExternalContractModal`; còn lại → mở `ContractDetailDrawer` (panel đầy đủ) ở chế độ
focus-edit. **UI panel đầy đủ (DOCX/PDF/Legal-Check) hiện theo `hasDocs` (đã có phiên bản tài liệu lưu
chưa), KHÔNG hiện trực tiếp theo `source`** — 2 khái niệm trùng nhau trong đa số trường hợp thực tế
nhưng về logic là độc lập.

OCR đối chiếu hợp đồng-báo giá: `POST /contracts/ocr-reconcile` (`contract_ocr_service.py`), hỗ trợ
PDF/ảnh/`.docx` (thêm `.docx` ngày 2026-10-10).

Chuyển trạng thái: `POST /contracts/{id}/status` → `update_contract_status()`, cổng readiness chỉ áp
dụng hợp đồng đã có tài liệu (`contract_approval_service.py`). **Chưa có gate role riêng cho bước
duyệt** — xem `CRM_FUNCTIONAL_SPEC.md` mục 5.2 và `REGRESSION_CHECKLIST.md`.

**Clone parity**: backend (`routers/contract.py`, `supabase_contract_service.py`,
`deal_stage_sync_service.py`, `RegisterExternalContractModal.tsx`) **giống hệt byte-for-byte** ở cả 3
clone. Frontend AI-Copilot mới nhất (`ContractAIWizard.tsx`, `ContractDetailPage.tsx`) **CHƯA port**
sang 3 clone (lệch ~25-160 dòng mỗi file) — xác nhận khớp với `docs/CONTRACT_DOCX_PIPELINE_2026-10-09.md`.

---

### Cập nhật 2026-10-28 — AI Review, Word Editor và phụ lục hợp đồng

- Entry point dùng chung: `ContractDetailPage.tsx` → `ContractAiReviewPanel.tsx`.
- Hybrid Regex/AI + Highlight: `/contracts/{id}/ai-review-full`, `/ai-review/latest`,
  `/ai-review/{review_id}/highlight-preview-pdf`, `/ai-review/confirm` →
  `contract_ai_review_service.py`, `contract_ocr_service.py`,
  `contract_highlight_service.py`.
- Word Editor: tab "Chỉnh sửa (Word)" → `/contracts/{id}/edit/*` →
  `contract_edit.py` → `contract_edit_service.py` → OnlyOffice self-host.
- Annotation: `/contracts/{id}/edit/annotations*` →
  `contract_highlight_annotations.py`; ba thao tác bỏ qua cảnh báo/xóa ghi chú/xóa
  highlight không tạo document version ngoài ý muốn.
- Hợp đồng đã ký khi lưu bản sửa tạo `contract_amendments`; luồng
  draft → pending_approval → approved mới thay nguồn tài liệu hiệu lực.
- Migration phụ thuộc: `194`, `195`, `197`, `198`, `199`, `200`.
- Đã port vào app chính (`linkedin_group_crawler` + `linkedin-crawler-ui`) và đồng bộ
  với `crm-module`, `crm-cloudgate`, `crm-securityzone`, `crm-timetech`. Các file core
  của tính năng giống nhau sau khi chuẩn hóa CRLF/LF; Docker/config giữ giá trị riêng
  theo từng instance.
- Precheck pháp lý trong `ContractAIWizard` render `PrecheckPanel` → `LegalInfoEditor`;
  refresh nền khi focus chỉ được thay dữ liệu sau khi xong, không được unmount panel đang nhập.
- Highlight tên công ty Bên A lấy neo ngắn bằng đúng `party_a_name`/`company_name` đã trích xuất;
  không dùng cả block Bên A dài có thể bắc qua nhiều paragraph/cell. `RULES_VERSION` phải bump
  khi đổi neo để cache review cũ được tạo lại.
- **Cập nhật 2026-10-29 — AI Contract Copilot Word Direct Editing & Format Fixes**:
  - `ContractAIWizard.tsx` Bước 3 ("Xem trước & hoàn thiện"): thêm tab `Chỉnh sửa (Word)` bên cạnh
    `Xem trước tài liệu` khi `mode === 'template'`. Nhúng OnlyOffice qua `#copilot-word-...`, auto-save nháp
    lên DB nếu chưa có ID, flush session trước khi chuyển tab hoặc gửi duyệt.
  - `ContractCopilotParts.tsx`: `PrecheckPanel` / `IssuerInlineEditor` bổ sung Người đại diện (`contactName`)
    và danh mục Chức vụ (`positionCategoryId` qua `PositionSelect`) cho Bên B khi precheck phát hiện thiếu.
  - `contract_docx_engine.py`: xử lý bảng party 3 cột `[Nhãn | : | Giá trị]` tránh nhét text vào cột `:`
    gây xuống dòng 1 ký tự; ưu tiên bảng chi tiết hàng hóa có đơn giá/số lượng thay vì xóa nhầm bảng tổng hợp;
    không ghi VAT vào dòng "Không chịu thuế"; tự động thêm `<w:cantSplit/>` và `<w:keepNext/>` chống vỡ trang PDF.

---

## 4. "Sao chép sang workspace khác" — pattern dùng chung giữa Lead và Customer

2 implementation SONG SONG gần như giống hệt nhau (viết riêng, không dùng chung helper):

| | Lead | Customer |
|---|---|---|
| Service | `copy_lead_to_instance()`/`copy_leads_to_instance()` (`crm_lead_service.py:702,766`) | `copy_customer_to_instance()`/`copy_customers_to_instance()` (`crm_customer_service.py:624,666`) |
| Router | `POST /crm/leads/copy-instance`, `/{id}/copy-instance` (admin-only, `crm_lead.py:171-189,290-304`) | `POST /crm/customers/copy-instance`, `/{id}/copy-instance` (admin-only, `crm_customer.py:157,178`) |
| Target hợp lệ | `cloudgate`/`SECURITYZONE` (hardcode) | y hệt |
| Chặn vòng lặp | có `origin_instance` (migration 128) → chặn copy về ĐÚNG workspace gốc dù đã qua nhiều vòng | KHÔNG có `origin_instance` → chỉ chặn copy về workspace HIỆN TẠI, không chặn được vòng lặp nhiều bước |
| Cascade dữ liệu liên quan | không (Lead chưa convert vốn chưa có gì để cascade) | không (dù Customer thật thường CÓ Deal/Quote/Contract liên quan bị bỏ lại) |

---

## 5. Picker "Presale/Sale" — pattern đúng vs pattern cũ còn sót

Pattern ĐÚNG: `usersService.getUsersByQuoteBusinessRole('sale'|'presale')`. Pattern CŨ (không nên dùng
cho picker gán việc): `useMembers()` (HR roster, không phân biệt vai trò nghiệp vụ báo giá).

| File | Dùng pattern đúng? | Ghi chú |
|---|---|---|
| `CustomerAddDrawer.tsx` | ✅ | |
| `LeadEditDrawer.tsx` | ✅ | |
| `CrmCustomersDirectory.tsx` | ✅ (picker), còn `useMembers()` cho hiển thị tên | |
| `QuoteWorkspaceModal.tsx` | ✅ | |
| `LeadFormDrawer.tsx` | ✅ (picker), còn `useMembers()` cho hiển thị tên | |
| `CustomerFormModal.tsx` | ✅ | |
| `LeadDetailDrawer.tsx` | ✅ | |
| `QuoteCenterPage.tsx` | ✅ | |
| `CreateOpportunityDrawer.tsx` | ✅ (picker), còn `useMembers()` song song | |
| `LeadsDirectory.tsx` | ✅ (picker), còn `useMembers()` cho hiển thị tên | |
| `CustomerDealSplitTab.tsx` | **hybrid** — ưu tiên role-user, fallback fuzzy-match tên trên `useMembers()` khi role-list rỗng | |
| **`DealFormFields.tsx`** | **❌ — field "Người quản lý" (`leadedBy`) CHỈ dùng `useMembers()`, cả ở create lẫn edit** (`:936,1725-1728`); field "Sale phụ trách" (`sdrId`) cũng fallback về `useMembers()` khi `roleUsers` rỗng (luôn đúng ở nhánh edit vì `roleUsers` chỉ tính khi `isCreate`) | Component NÀY được dùng chung bởi path A+B ở mục 1 — sửa 1 chỗ ảnh hưởng cả 2 entry point tạo Deal |

`DealFormFields.tsx` là ứng viên sửa có giá trị cao nhất nếu muốn "mọi picker Presale/Sale đều ưu
tiên `quote_business_role`" — nhưng CHƯA XÁC NHẬN đây là bug (có thể `leadedBy`="Người quản lý" cố ý
là pool rộng hơn `sdrId`="Sale phụ trách"). Hỏi lại trước khi coi là lỗi.

---

## 6. Component dùng chung khác (tổng hợp nhanh)

- `LeadDealQualificationPanel.tsx` + `hooks/useLeadQualificationEngine.ts` +
  `utils/leadQualificationRules.ts` — dùng chung NGUYÊN VĂN giữa `LeadDetailDrawer.tsx` (Xác minh
  Lead) và `CreateOpportunityDrawer.tsx` (Tạo cơ hội trực tiếp) — "1 form 1 luồng" theo yêu cầu leader.
- `crm_delete_cascade_service.py` — 1 module chung cho cascade-delete của cả Lead/Customer/Deal
  (`delete_lead_cascade`/`delete_customer_cascade`/`delete_deal_cascade`).
- `crm_permission_service.py` — nguồn chân lý duy nhất cho mọi hàm quyền; `crm_lead_service.py` import
  trực tiếp từ `crm_customer_service.py` (Customer service là tầng THẤP HƠN mà Lead service phụ thuộc
  vào, không phải chiều ngược lại).
- `crm_customer_progress_service.py` — đọc bởi `crm_customer_service._attach_customer_metrics`
  (đường đọc), ghi bởi hook trong `supabase_quote_service.py`/`supabase_contract_service.py` (đường
  ghi) — kiến trúc giống hệt `deal_stage_sync_service.py` (tiền lệ đã có sẵn, không phải pattern mới).
- Trùng lặp nhỏ chưa gộp: `_request_hash()`/idempotency-key pattern lặp lại y hệt giữa
  `crm_lead_service.py:789` và `crm_customer_service.py:832`.
