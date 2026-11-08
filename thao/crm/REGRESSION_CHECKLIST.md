# CRM — Regression Checklist

## Omnichannel Email bắt buộc

- [ ] Migration `201`, `202` và `203_omnichannel_email_oauth_hardening.sql` đã chạy trên Dev; bucket attachment là private.
- [ ] GIS popup chỉ chấp nhận đúng 5 HTTPS origins đã khai báo; raw HTTP IP/origin lạ bị chặn; OAuth state không dùng lại
  được và không dùng chéo user/workspace/origin.
- [ ] Gmail Email Inbox dùng client/env riêng, scope `gmail.modify`; không thay đổi Google Login/Drive.
- [ ] Kết nối được nhiều Gmail trong cùng workspace; token trong DB ở dạng mã hóa, không lộ trong API/log.
- [ ] Request không token bị 401; user thiếu quyền bị 403; không đọc/đánh dấu/gửi/download attachment chéo `instance`.
- [ ] Endpoint simulate trả 403 khi `EMAIL_ALLOW_SIMULATE_INCOMING` không bằng `1`.
- [ ] IMAP nhận được thư tiếng Việt, HTML/plain, attachment; reload/restart Docker vẫn còn thread/message/read state.
- [ ] Reply giữ `In-Reply-To`/`References`; attachment tới mailbox đích mở được.
- [ ] SMTP sai credential/network trả lỗi 502 và không tạo message `delivered` trong DB.
- [ ] Chạy tách biệt Markee, CloudGate, SecurityZone, Timetech; kiểm tra không lẫn account/thread/message/CRM 360.
- [ ] Chạy đồng thời Seeding/Main và CRM Markee: DB lease chỉ cho một worker sync cùng account, không nhân đôi message.
- [ ] Chỉ đánh dấu PASS sau khi xác minh thư thật ở mailbox đích. Thiếu credential/migration phải ghi BLOCKED.

**Trạng thái**: audit 2026-10-10. Dùng file này TRƯỚC KHI sửa 1 component/service dùng chung, và SAU
KHI sửa (tick lại những gì đã test). Tổ chức theo "sửa X → phải test Y" (lan theo
`SHARED_COMPONENT_MAP.md`/`CRM_FLOW_MAP.md`), cộng 1 danh sách "known gaps" (lỗ hổng đã phát hiện qua
audit, CHƯA fix, chỉ ghi nhận để không ai tưởng là bug mới).

---

## A. Sửa `DealFormFields.tsx` (dùng chung bởi `DealFormModal` VÀ `CreateOpportunityDrawer`)

☐ Test tạo Deal qua `DealFormModal` (Kanban "Tạo cơ hội", "+ Deal" từ Project card, "Tạo cơ hội" khóa
  Contact cụ thể) — field bắt buộc: dealName, email/phone, Team Sale, Sale phụ trách.
☐ Test tạo Deal qua `CreateOpportunityDrawer` ("Tạo cơ hội bán hàng", mọi entry point ở
  `SHARED_COMPONENT_MAP.md` mục 1 path A) — field bắt buộc KHÁC (chỉ customerId/nextStep/followUpDate,
  Team Sale chỉ chặn mềm).
☐ Test `CustomerProfileCombobox`/`ProjectPicker` (export, dùng chung 2 nơi) — đổi 1 trong 2 phải test
  CẢ 2 nơi dùng.
☐ `ContactPicker` (KHÔNG export) — chỉ `DealFormModal` dùng, sửa không ảnh hưởng `CreateOpportunityDrawer`.
☐ Nếu đổi picker "Người quản lý"/"Sale phụ trách" sang dùng `quote_business_role` thay vì `useMembers()`
  — test KỸ cả create lẫn edit mode, vì hiện tại hành vi 2 mode khác nhau (`roleUsers` chỉ tính khi
  `isCreate`).

## B. Sửa `QuoteWorkspaceModal.tsx`

☐ Test cả 4 entry point mở component này, KHÔNG chỉ 1: "Yêu cầu hỗ trợ báo giá" (Quote Center),
  "+ Tạo báo giá" (Customer Detail, tab Báo giá), "+ Tạo báo giá" (Customer Detail, tab Cơ hội, từ 1
  Deal cụ thể), "+ Tạo yêu cầu báo giá" (Lead 360).
☐ Test riêng Lead 360 — `agents=[]` hardcode, props khác hẳn 3 entry point kia, VÀ `onEditDraft` không
  chuyển tiếp sang `CreateQuoteModal` (ở lại ngay modal) — hành vi lưu nháp PHẢI test riêng ở đây.
☐ Test dropdown "Cơ hội CRM" → "+ Tạo cơ hội mới" (mở `CreateOpportunityDrawer` lồng bên trong, từ
  2026-10-10) — xác nhận Deal vừa tạo được tự chọn vào dropdown, modal báo giá KHÔNG mất dữ liệu đang
  nhập dở (do `suppressNavigation`).
☐ Test auto-chọn Deal khi khách hàng chỉ có đúng 1 Cơ hội — đặc biệt ngay SAU KHI chọn khách hàng (dễ
  dính race condition nếu sửa effect loading, xem `thao/CRM_KNOWN_BUGS_FIXED.md` mục 5).
☐ Test KHÔNG đóng nhầm modal/panel cha khi click option trong bất kỳ dropdown portal nào bên trong
  (xem `thao/CRM_KNOWN_BUGS_FIXED.md` mục 1) — đặc biệt nếu thêm dropdown/combobox mới.
☐ Với cột "Giảm giá (%)" từng dòng: test nhập một lần, xoá sạch một lần, nhập dấu phẩy/dấu chấm,
  Enter/blur không cuộn về đầu; preview/in/public và mở lại báo giá đã lưu đều chỉ hiện tối đa 2 số lẻ.
☐ Với "Giảm giá số tiền cố định (VNĐ)" (cả từng hạng mục, áp hàng loạt và toàn báo giá):
  xác nhận lấy số tiền VNĐ đã nhập làm giá trị tính toán chính, % chỉ để hiển thị;
  tổng sau giảm, lợi nhuận gộp/margin và số tiền lưu DB / xuất file phải chính xác tuyệt đối không bị lệch (vd giảm 4.971.200 đ từ 34.971.200 đ phải ra đúng 30.000.000 đ tròn).


## C. Sửa luồng tạo Deal (bất kỳ path nào trong 4 path ở `SHARED_COMPONENT_MAP.md` mục 1)

☐ Nếu sửa logic tìm-trùng/dedup Customer trong RPC `crm_create_customer_with_deal` — **PHẢI kiểm tra
  riêng** RPC `crm_convert_lead` có cần sửa tương tự không (2 RPC độc lập, không dùng chung code, dù
  cùng hình nghiệp vụ "tìm-hoặc-tạo Customer + tạo Deal").
☐ Test luôn cả path D (`CrmCustomerModal.tsx`, dùng trong inbox Zalo/Facebook) — dễ bị quên vì không
  nằm trong các trang CRM "chính", nhưng vẫn ghi `customer_leads` thật.
☐ Nếu thêm field bắt buộc mới cho Deal — xác nhận có áp dụng nhất quán ở CẢ 4 path, hoặc nếu cố ý chỉ
  áp 1 số path thì ghi rõ lý do (giống case `dealName` hiện chỉ bắt buộc ở path B).

## D. Sửa luồng tạo Báo giá / `create_quote()`

☐ Test cả 2 component (`QuoteWorkspaceModal` VÀ `CreateQuoteModal`) — không chỉ 1, vì KHÔNG converge ở
  tầng UI dù cùng 1 endpoint ghi DB.
☐ Test riêng "+ Tạo báo giá" trong Deal Workspace/Kanban thật (`DealWorkspaceTabs.tsx`→`QuoteTab`) —
  dùng `CreateQuoteModal` trực tiếp, KHÔNG qua `QuoteWorkspaceModal`.
☐ Test "Tạo theo mẫu" (Quote Center) — wizard nhảy thẳng bước 3, KHÔNG qua bước chọn mẫu bình thường.
☐ Test "Tạo phiên bản mới" (`create-version`) — cũng ghi 1 dòng `quotes`, dễ bị bỏ sót khi liệt kê "nơi
  tạo báo giá".
☐ Sau tạo/duyệt/hủy báo giá: xác nhận Deal-stage VÀ tiến độ Khách hàng đều cập nhật đúng (không cần
  F5) — cả 2 chạy qua `_wrap_deal_stage_sync()`.
☐ **KHÔNG** coi "+ Tạo báo giá" trong Project → tab Báo giá là đã hoạt động — nút này hiện mở nhầm form
  Tạo Cơ hội (xem mục "Known gaps" bên dưới), đừng viết test giả định nó tạo báo giá.

## E. Sửa luồng Hợp đồng (`supabase_contract_service.py`, `contract_approval_service.py`)

☐ Test cả 2 nguồn tạo (`ContractAIWizard` VÀ `RegisterExternalContractModal`) — cùng 1 endpoint
  `POST /contracts`, khác `source` trong payload.
☐ Test nút "Sửa" (pencil icon) trong `CustomerContractsTab.tsx` cho CẢ 2 loại: `source='external'`
  (phải mở `RegisterExternalContractModal`) và AI-drafted (`ContractDetailDrawer` focus-edit).
☐ Nếu đổi gate quyền chuyển trạng thái (`update_contract_status`) — hiện TẤT CẢ chuyển trạng thái chỉ
  cần `can_edit_contract`, CHƯA có gate role riêng cho bước duyệt pending_legal→pending_signature; nếu
  thêm gate này, test cả 2 chiều: Sale tự duyệt hợp đồng của chính mình phải BỊ CHẶN (nếu đó là mục
  tiêu), và luồng hiện tại (ai cũng duyệt được nếu có quyền sửa) không âm thầm vỡ ở nơi khác đang phụ
  thuộc hành vi cũ.
☐ Nếu bật lại `CONTRACT_STAGE_SYNC_ENABLED = True` — test kỹ: Deal có tự nhảy đúng `contract_signed`(5)
  không, VÀ xác nhận không nhảy NGƯỢC khi hợp đồng bị hủy/terminated (rule "chỉ tiến lên" phải giữ
  nguyên). Đồng thời test tiến độ Khách hàng (vốn độc lập cờ này) không bị ảnh hưởng theo hướng xấu.

## F. Sửa phân quyền (`crm_permission_service.py`)

☐ Test user có `permission_group_id` scope `'team'` — xác nhận `has_full_crm_access()` vẫn trả `False`
  cho họ kể cả khi role=admin/sale (hành vi CỐ Ý, không phải bug — nhưng dễ vỡ nếu sửa nhầm).
☐ Test user CHƯA được gán Nhóm quyền nào — phải giữ nguyên hành vi full-access cũ (hệ thống opt-in).
☐ Nếu sửa `_customer_ids_visible_to()` — test riêng admin/leader (đọc thẳng cột `role`, KHÔNG qua
  `has_full_crm_access`) để không vô tình mở rộng quyền này sang Sale thường.
☐ Test đủ 4 module (Lead/Customer/Deal/Quote/Contract) nếu sửa hàm quyền dùng chung
  (`can_access_by_scope`, `get_scope_visible_user_ids`) — các hàm này được tái dùng xuyên suốt.

## G. Sửa tenant isolation (`settings.crm_instance`)

☐ Mọi query/service mới PHẢI có `.eq("instance", settings.crm_instance)` — xem mục Known gaps bên
  dưới cho danh sách service CHƯA được soát kỹ trong audit này (`crm_delete_cascade_service.py`,
  `crm_contact_service.py`, `supabase_project_service.py`).
☐ Tính năng "Sao chép sang workspace khác" (Lead/Customer) là NGOẠI LỆ cố ý — đừng "sửa cho đúng tenant"
  nhầm chỗ này, bản chất của tính năng là ghi chéo sang `instance` khác.
☐ Nếu thêm "Sao chép sang workspace khác" cho entity mới (Deal/Quote/Contract) — cân nhắc có cascade
  dữ liệu liên quan không (khác Lead/Customer hiện tại — cả 2 đều KHÔNG cascade, nhưng Deal/Quote/
  Contract thường có nhiều dữ liệu phụ thuộc hơn).

## H. Sửa "Việc tiếp theo"/tiến độ Khách hàng (`crm_customer_progress_service.py`)

☐ Test cả 3 điểm hiển thị: danh sách Khách hàng, Quick-view panel — **VÀ xác nhận có bổ sung hiển thị
  ở trang chi tiết đầy đủ `CrmCustomerDetailPage.tsx` nếu task yêu cầu** (hiện ĐANG THIẾU ở đây, xem
  Known gaps).
☐ Test rule "chỉ nâng nhóm, không hạ" — tạo 1 báo giá draft cho khách `current_customer` sẵn, xác nhận
  KHÔNG bị hạ xuống `following`.
☐ Test `not_fit` không bao giờ bị tính lại dù có báo giá/hợp đồng mới phát sinh.
☐ Test khách hàng có NHIỀU Deal — xác nhận chọn đúng "Deal đang hoạt động nhất" (không phải Deal cũ
  nhất/mới nhất đơn thuần).

---

## I. AI Review / Word Editor / Amendment hợp đồng

☐ Chạy Hybrid Review trên DOCX và PDF; kiểm tra đúng hướng Bên A/Bên B, MST và
  trường không có trong tài liệu.
☐ Khi precheck nền chạy lại do window focus/visibilitychange, form "Bổ sung thông tin" đang nhập
  phải giữ mở và giữ nguyên Tên pháp lý/MST/Địa chỉ chưa lưu.
☐ Dòng "Tên công ty (Bên A - khách hàng)" verdict Khớp phải tô vàng đúng tên công ty trong bản
  AI Highlight; chạy lại review cũ phải cache-miss theo `RULES_VERSION` mới.
☐ Click annotation phải nhảy đúng vị trí ở cả PDF preview và OnlyOffice.
☐ Test đủ ba action annotation; xác nhận không phát sinh version mới.
☐ Với hợp đồng đã ký: lưu sửa đổi phải tạo amendment draft; chỉ bản approved mới
  trở thành nguồn hiệu lực cho viewer/AI Review/Drive.
☐ Test đóng drawer bằng ESC, click backdrop và click bên trong; trạng thái dirty phải
  mở hộp xác nhận thay vì đóng mất dữ liệu.
☐ Xác nhận activity badge cập nhật ngay sau mutation.
☐ Kiểm tra migration `194/195/197/198/199/200`, OnlyOffice JWT, plugin static route,
  Drive worker và forcesave worker trên từng instance.
☐ AI Contract Copilot Bước 1 Precheck: bổ sung Người đại diện và Chức vụ Bên B trong form inline
  (`IssuerInlineEditor`), xác nhận lưu thành công và cập nhật lại trạng thái precheck không còn báo thiếu.
☐ AI Contract Copilot Bước 3 Chỉnh sửa Word:
  - Tab `Chỉnh sửa (Word)` xuất hiện cạnh `Xem trước tài liệu` khi ở chế độ tạo theo mẫu.
  - Tự động lưu nháp hợp đồng nếu chưa có record DB trước khi mở phiên OnlyOffice.
  - Chỉnh sửa văn bản, kiểm tra badge `✓ Đã đồng bộ` / `● Có thay đổi chưa lưu`.
  - Bấm "Lưu & cập nhật xem trước": flush phiên Word sang version mới, cập nhật bản xem trước PDF và rà soát rủi ro.
  - Chuyển giữa các tab (Xem trước, Rà soát rủi ro, Phiên bản) tự động flush phiên Word đang mở.
  - Bấm "Gửi duyệt" gửi đúng phiên bản Word đã chỉnh sửa, giữ nguyên file mẫu gốc không bị ghi đè.
☐ AI Contract Copilot DOCX & PDF pipeline:
  - Trang 1 thông tin Bên A/Bên B bảng 3 cột không bị lặp chữ, không bị bóp 1 ký tự/dòng ở cột dấu hai chấm.
  - Bảng tổng hợp giá trị giữ nguyên các hàng mẫu (Phần A, Phần B...), không bị xóa nhầm thành bảng chi tiết.
  - Dòng "Không chịu thuế" không bị ghi đè số tiền VAT.
  - Bảng hợp đồng và hàng tổng cộng không bị ngắt ngang qua 2 trang bất thường (`cantSplit`/`keepNext`).

---

## Known gaps (đã phát hiện qua audit, CHƯA fix — không phải bug mới nếu bạn gặp lại)

1. ~~`CONTRACT_STAGE_SYNC_ENABLED = False`~~ — **ĐÃ FIX 2026-10-10** (bật lại `True`, main + 3 clone,
   theo xác nhận của mentor module Hợp đồng đã đủ ổn). Xem `thao/CRM_KNOWN_BUGS_FIXED.md`.
2. **`won` không nằm trong `TERMINAL_STAGES`/`DEAL_STAGES`** (`crmConfig.ts:94-95`) dù hành vi backend
   coi nó là terminal — `allowedNextStages()` không thể tự đề xuất `won`. Cần xác nhận UI hiện tại còn
   đường nào dẫn tới `toStage='won'` hay không trước khi coi đây là lỗi cần sửa.
3. **`DealFormFields.tsx` field "Người quản lý" (`leadedBy`) chỉ dùng `useMembers()`**, không ưu tiên
   `quote_business_role` như hầu hết picker khác trong CRM — CHƯA xác nhận là bug (có thể cố ý: "Người
   quản lý" là pool rộng hơn "Sale phụ trách"). Hỏi sản phẩm trước khi sửa.
4. **Chưa có gate role riêng cho bước duyệt hợp đồng** (pending_legal→pending_signature) — kế hoạch cũ
   có nhắc tới "chỉ admin/leader mới được duyệt" nhưng chưa implement; hiện tại dùng chung
   `can_edit_contract` cho mọi chuyển trạng thái.
5. **`expiring`/`expired` (trạng thái hợp đồng) không có cơ chế tự động nào ghi** — chỉ đạt được qua
   thao tác tay, dù tồn tại trong enum + được dùng để tính KPI "sắp hết hạn".
6. ~~Trang chi tiết Khách hàng (`CrmCustomerDetailPage.tsx`) không hiển thị "Việc tiếp theo"~~ —
   **ĐÃ FIX 2026-10-11** (backend đã trả sẵn `next_action` qua `get_customer()` dùng chung
   `_attach_customer_metrics()`, chỉ thiếu khai báo type + render ở FE — thêm vào header, dùng
   chung fallback theo status với `CrmCustomersDirectory.tsx`). Xem `thao/CRM_KNOWN_BUGS_FIXED.md`.
7. ~~"+ Tạo báo giá"/"Tạo hợp đồng" trong Project mở nhầm form Tạo Cơ hội~~ — **ĐÃ FIX 2026-10-10**
   (2 nút đó dùng chung `setDealModal` với "Tạo cơ hội" bên cạnh — cả báo giá LẪN hợp đồng đều bị dán
   nhầm, không chỉ báo giá như phát hiện ban đầu). Đã nối đúng `openQuoteRequestForProject()`
   (QuoteWorkspaceModal đã có sẵn, chỉ chưa wiring) + `openRegisterContractForProject()` (hàm mới,
   cùng pattern resolve-Deal với `openQuickQuoteForProject()`). Xem `thao/CRM_KNOWN_BUGS_FIXED.md`.
8. **3 cụm code chết đã xác nhận bằng grep toàn repo** — đừng mất thời gian debug/test chúng, và đừng
   coi chúng là "đã có tính năng" khi audit lại sau này:
   - `CrmShell.tsx` / `DealCard.tsx` / `modules/crm/components/DetailDrawer.tsx` (Kanban board + drawer
     cũ, không còn route/component nào import).
   - `openQuickQuoteForProject()` / `openQuickQuoteForCustomer()` + state `quickQuoteDeal` trong
     `CrmCustomerDetailPage.tsx` (định nghĩa sẵn, không ai gọi).
   - `openDealPicker()` / `pickDealAndOpen()` trong `QuoteCenterPage.tsx` (định nghĩa sẵn, không ai gọi).
9. **`crm_customers` không có cột `origin_instance`** (chỉ `crm_leads` có, migration 128) — tính năng
   "Sao chép Khách hàng sang workspace khác" chỉ chặn copy-về-workspace-hiện-tại, KHÔNG chặn được vòng
   lặp copy qua lại nhiều bước như Lead. Chấp nhận được ở quy mô hiện tại (2 clone), nhưng sẽ cần
   migration thêm cột nếu muốn chặn chặt như Lead.
10. **Chưa soát tenant-isolation sâu ở 3 service**: `crm_delete_cascade_service.py`,
    `crm_contact_service.py`, `supabase_project_service.py`, `crm_customer_progress_service.py` —
    pattern `.eq("instance", ...)` áp dụng nhất quán ở MỌI nơi đã soát, rủi ro thấp, nhưng 4 file này
    chưa được mở đọc trong audit 2026-10-10. Soát trước khi sửa bất kỳ file nào trong nhóm này.
11. ~~3 clone lệch frontend AI-Contract-Copilot + `crm_customer_service.py`/`customer_lead.py`
    (Web Intake) lệch nhẹ~~ — **ĐÃ PORT 2026-10-10** (`ContractAIWizard.tsx`, `ContractDetailPage.tsx`,
    `crm_customer_service.py`, `routers/customer_lead.py` copy nguyên từ main sang cả 3 clone — xác
    nhận an toàn vì clone chỉ thiếu tính năng, không có code riêng bị mất). Xem
    `thao/CRM_KNOWN_BUGS_FIXED.md`.
12. **Lead 360 (`LeadQuoteWorkspaceHost.tsx`) truyền `agents=[]` cho `QuoteWorkspaceModal`** — **ĐÃ
    FIX 2026-10-10**, fetch thật qua `seedingCrmRepository.getAgents()` giống `dealAgents` của
    `CrmCustomerDetailPage.tsx`. Xem `thao/CRM_KNOWN_BUGS_FIXED.md`.
13. **Pattern "dropdown portal đóng nhầm modal/panel" (mục 1 trong `thao/CRM_KNOWN_BUGS_FIXED.md`) có
    THÊM 1 biến thể chưa từng gặp**: backdrop dùng `onClick={namedFunction}` (tham chiếu hàm đặt tên,
    KHÔNG phải `onClick={onClose}` trực tiếp hay arrow rỗng) — lọt qua grep ban đầu vì pattern tìm
    kiếm chỉ khớp `onClick={onClose}`/`() => onClose()`. **ĐÃ quét lại TOÀN BỘ repo bằng regex rộng
    hơn (`backdrop.*onClick=`) ngày 2026-10-10, tìm thêm 15 chỗ** (DealFormModal, ManualContractModal,
    IssuerCompanyAdminPage, DealQuoteWizard, CreateQuoteModal (integrations/quotes), CrmCustomersDirectory
    (modal Xóa, khác với quickview đã fix trước), CrmContactsPanel, CustomerContactsTab, LeadImportDialog,
    ContractAIWizard, QuoteOutcomeSection, QuoteCenterPage (4 chỗ), CrmCustomerDetailPage (modal gán
    Contact), QuoteWorkspaceModal (2 chỗ: tạo Contact nhanh + đổi tiền tệ), QuoteFormFiller (2 chỗ)) —
    đã fix hết + port 3 clone. **Khi thêm modal/backdrop mới: LUÔN dùng pattern
    `onClick={event => { if (event.target === event.currentTarget) ...(); }}` ngay từ đầu, không viết
    `onClick={onClose}`/`onClick={closeFn}` trơn dù là tên hàm hay inline.**
