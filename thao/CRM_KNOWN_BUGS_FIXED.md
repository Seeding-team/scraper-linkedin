# CRM — Lỗi đã xử lý (đọc trước khi sửa, note tiếp vào đây khi gặp lỗi mới)

File này là **nhật ký lỗi đã fix**, không phải tiến độ tính năng (xem `docs/*_2026-*.md` khác cho
việc đó). Mục đích: trước khi sửa 1 bug mới trong CRM, lướt qua đây xem có phải **cùng 1 pattern**
với lỗi cũ không — tránh sửa lại từ đầu hoặc tái tạo đúng bug đã fix ở chỗ khác chưa kịp port.

Mỗi mục ghi: **Triệu chứng** (nhìn thấy gì) → **Nguyên nhân gốc** (code sai ở đâu) → **Cách fix** →
**File liên quan**. Khi gặp lỗi mới đã sửa xong, thêm 1 mục mới vào cuối file theo đúng format này.

---

## 1. Dropdown/menu portal ra `document.body` bị hiểu nhầm là "click ra ngoài"

**Đây là pattern lỗi gặp LẶP LẠI NHIỀU LẦN NHẤT trong CRM — luôn kiểm tra đầu tiên.**

`SearchableSelect`/`MemberSearchSelect` (`modules/crm/components/SearchableSelect.tsx`) render menu
dropdown qua `createPortal(..., document.body)` — để tránh bị cắt bởi `overflow` của container cha.
Hệ quả: menu này **không nằm trong DOM con** của modal/drawer/panel đang mở nó, dù về mặt React tree
nó vẫn là con. Bất kỳ modal/panel nào có logic "click ra ngoài thì đóng" mà implement sai cách đều
dính lỗi: chọn 1 item trong dropdown → modal/panel cha bị đóng nhầm trước khi kịp ghi nhận lựa chọn.

Có **2 kiểu implement sai** đã gặp, cách fix khác nhau:

### 1a. Backdrop `onClick={onClose}` không kiểm tra target

```tsx
// SAI — bubble từ bất kỳ đâu (kể cả portal) cũng trigger onClose
<div className="crm-modal-backdrop" onClick={onClose}>

// ĐÚNG — chỉ đóng khi click THẬT SỰ vào chính backdrop
<div className="crm-modal-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
```

Lý do kỹ thuật: React Portal vẫn bubble synthetic event theo **cây React** (không phải cây DOM), nên
click bên trong menu portal vẫn bubble lên tới backdrop của modal cha trong React tree, dù node vật
lý nằm ở `document.body`.

Đã fix (2026-10-10, đợt 1) ở **9 modal** dùng chung pattern này — main + 3 clone (crm-module/
crm-cloudgate/crm-securityzone):
- `modules/crm/components/CustomerFormModal.tsx`
- `modules/crm/components/ContractDetailModal.tsx`
- `modules/crm/components/ConfirmModal.tsx`
- `modules/crm/components/CustomerAddDrawer.tsx`
- `modules/crm/components/lead360/LeadQuoteWorkspaceHost.tsx`
- `modules/crm/components/StageModal.tsx`
- `modules/crm/components/ProjectFormModal.tsx`
- `modules/quotes/components/MoveQuoteModal.tsx`
- `modules/quotes/components/CopyQuoteCrossWorkspaceModal.tsx`

**Đợt 1 chỉ grep đúng pattern `onClick={onClose}`/`onClick={() => onClose()}` — BỎ SÓT biến thể
`onClick={namedFunction}` (tham chiếu 1 hàm đặt tên khác, vd `closeForm`/`closeDialog`/`resetAndClose`)
và biến thể `onClick={e => { e.stopPropagation(); onClose(); }}` (stopPropagation KHÔNG hề fix được
bug này — chỉ chặn bubble lên TRÊN backdrop, không chặn được chính backdrop nhận event). Quét lại
bằng regex rộng hơn (`backdrop.*onClick=`, không ràng buộc hình dạng giá trị) ngày 2026-10-10 (đợt 2)
tìm thêm **15 chỗ nữa**, đã fix + port 3 clone:
- `modules/crm/components/DealFormModal.tsx` (nhánh "Sửa deal", nhánh "Tạo cơ hội nhanh" là sibling
  div tự đóng, KHÔNG dính bug này, không cần fix)
- `modules/contracts/components/ManualContractModal.tsx`
- `modules/quotes/components/IssuerCompanyAdminPage.tsx`
- `modules/crm/integrations/quotes/DealQuoteWizard.tsx`
- `modules/crm/integrations/quotes/CreateQuoteModal.tsx` (KHÁC file `modules/quotes/components/
  CreateQuoteModal.tsx` — 2 file trùng tên, khác thư mục, cả 2 đều đã fix riêng)
- `modules/crm/components/CrmCustomersDirectory.tsx` (modal xác nhận Xóa — khác backdrop quickview đã
  fix ở mục 1b bên dưới)
- `modules/crm/components/CrmContactsPanel.tsx`
- `modules/crm/components/CustomerContactsTab.tsx`
- `modules/crm/components/LeadImportDialog.tsx`
- `modules/crm/integrations/contracts/ContractAIWizard.tsx`
- `modules/crm/components/QuoteOutcomeSection.tsx`
- `modules/crm/components/QuoteCenterPage.tsx` (4 chỗ: deal-picker, lịch sử phiên bản, huỷ báo giá,
  huỷ công khai)
- `modules/crm/components/CrmCustomerDetailPage.tsx` (modal gán Contact)
- `modules/crm/components/QuoteWorkspaceModal.tsx` (2 chỗ: tạo Contact nhanh, đổi tiền tệ)
- `modules/quotes/components/QuoteFormFiller.tsx` (2 chỗ: chi tiết hạng mục, catalog picker — class
  `quote-catalog-picker-backdrop` khác tên nhưng cùng pattern lỗi)

**Nếu thêm modal mới có backdrop + chứa SearchableSelect/MemberSearchSelect bên trong, PHẢI dùng
pattern `event.target === event.currentTarget` ngay từ đầu, bất kể gọi `onClose` trực tiếp, gọi 1 hàm
đặt tên khác, hay có thêm điều kiện (`!busy && ...`) — đừng copy `onClick={onClose}`/`onClick={closeFn}`
trơn, và đừng tưởng `stopPropagation()` tự fix được bug này.**

### 1b. `document.addEventListener('pointerdown'/'mousedown', ...)` với exemption-list thiếu

Một số panel không dùng backdrop (vd slide-in side panel) mà tự lắng nghe `pointerdown`/`mousedown`
trên `document`, rồi `target.closest(...)` với 1 danh sách selector được coi là "bên trong, đừng
đóng". Nếu danh sách đó **thiếu class của menu portal** (`.crm-searchable-select-menu`), hoặc thiếu
`button` nói chung, thì click vào option trong dropdown vẫn bị coi là "ra ngoài" → đóng panel.

Đã fix (2026-10-10): `modules/crm/components/CrmCustomersDirectory.tsx` — `handleDocumentPointerDown`
(đóng Quick View/panel "Sửa khách hàng") thiếu `.crm-searchable-select-menu` trong exemption list.
Thêm vào: `'[role="dialog"],.crm-modal,.crm-modal-backdrop,.crm-verify-drawer,.crm-action-menu,.crm-searchable-select-menu'`.

**Các chỗ khác đã kiểm tra, KHÔNG dính lỗi này** (exemption list đã có `button` chung nên tự động
cover các `<button>` option của SearchableSelect — không cần class riêng):
- `LeadsDirectory.tsx` (`onPointerDown` cho drawer Lead)
- `CustomerDealSplitTab.tsx` (`handleDocumentPointerDown` cho Deal workspace)

**Khi thêm 1 handler kiểu này mới**: hoặc thêm `button` chung vào exemption list (an toàn nhất, cover
mọi dropdown dùng `<button>` option — SearchableSelect, ActionMenu...), hoặc nếu dùng whitelist theo
class cụ thể thì nhớ thêm `.crm-searchable-select-menu` và `.crm-action-menu`.

---

## 2. Global keyboard shortcut bắt sự kiện dù đang gõ trong input/dropdown

**Triệu chứng**: gõ chữ trong 1 ô tìm kiếm/input bất kỳ trong trang → sidebar trái (menu điều hướng
chính) tự đóng/mở.

**Nguyên nhân gốc**: `components/ui/sidebar.tsx` có `window.addEventListener('keydown', ...)` toàn
cục cho phím tắt Ctrl/Cmd+B (toggle sidebar) — không kiểm tra `event.target` đang là ô nhập liệu hay
không, nên gõ chữ "b" trong khi giữ Ctrl (hoặc trùng tổ hợp phím khác) ở BẤT KỲ input nào trong toàn
app đều bị bắt.

**Cách fix**: thêm guard kiểm tra tag của `event.target` trước khi xử lý:
```tsx
const target = event.target as HTMLElement | null;
const tag = target?.tagName;
if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) return;
```

File: `components/ui/sidebar.tsx`. Đã fix main + 3 clone.

**Lưu ý phân biệt với mục 1**: đây là lỗi do **phím tắt toàn cục**, không liên quan gì tới dropdown
portal. Nếu gặp báo cáo "bấm vào dropdown rồi sidebar/panel bị tắt" → **kiểm tra mục 1 trước** (khả
năng cao hơn nhiều, đã gặp lặp lại); chỉ nghi ngờ mục 2 nếu triệu chứng xảy ra lúc đang GÕ PHÍM, không
phải lúc CLICK chuột.

---

## 3. "Người phụ trách"/owner-picker lấy sai nguồn danh sách thành viên

**Triệu chứng**: dropdown "Người phụ trách" hiện cả người không phải Sale/Presale (vd Dev, Marketing),
hoặc thiếu người lẽ ra phải có trong danh sách.

**Nguyên nhân gốc**: 1 số nơi tự chế danh sách thành viên từ `useMembers()` (HR roster chung, không
phân biệt vai trò nghiệp vụ báo giá), thay vì dùng đúng nguồn đã có sẵn
`usersService.getUsersByQuoteBusinessRole('presale' | 'sale')` (field `app_users.quote_business_role`).

**Cách fix chuẩn**: luôn gọi `usersService.getUsersByQuoteBusinessRole(...)`, gộp cả `presale` và
`sale`, khử trùng theo `id`. Đã áp dụng cho: `CustomerFormModal.tsx`, `CreateOpportunityDrawer.tsx`.

**Khi thêm 1 owner-picker mới**: luôn dùng pattern này, đừng tự chế lại từ `useMembers()`.

---

## 4. `agents`/data phụ không được truyền đủ giữa 2 entry point dùng chung 1 component

**Triệu chứng**: cùng 1 modal/form nhưng mở từ 2 nút khác nhau lại thiếu dữ liệu (dropdown rỗng, tên
không hiện) ở 1 trong 2 đường — dù code modal y hệt nhau.

**Nguyên nhân gốc**: component dùng chung (vd `QuoteWorkspaceModal`) nhận data qua props từ component
cha — nếu 1 trong 2 cha quên truyền đủ prop (vd `agents={[]}` thay vì `agents={dealAgents}`), chức
năng bên trong modal âm thầm thiếu dữ liệu dù logic hiển thị hoàn toàn đúng.

**Case đã gặp**: `CrmCustomerDetailPage.tsx` mở `QuoteWorkspaceModal` với `agents={[]}` (hardcode rỗng)
trong khi `QuoteCenterPage.tsx` mở cùng modal với `agents={agents}` (danh sách thật từ `useCrm()`) —
khiến tên Presale/Sale đã gán không hiện được khi mở báo giá từ Chi tiết khách hàng.

**Cách fix**: trang đã có sẵn state tương đương (`dealAgents`, load qua
`seedingCrmRepository.getAgents()`) — chỉ cần truyền đúng, không cần fetch thêm.

**Khi audit "2 nút mở cùng 1 tính năng nhưng khác nhau"**: so sánh **từng prop** truyền vào component
dùng chung giữa 2 entry point, không chỉ xác nhận "dùng chung component là xong".

---

## 5. Race condition: tính năng auto-chọn chạy TRƯỚC khi data phụ thuộc tải xong

**Triệu chứng**: tính năng "tự động chọn khi chỉ có 1 lựa chọn" không chạy ở lần đầu, nhưng mở lại
dropdown thủ công thì vẫn thấy đúng 1 lựa chọn đó (tức data đúng, chỉ là tới trễ).

**Nguyên nhân gốc**: effect tính "có đúng 1 candidate không" chạy ngay khi 1 điều kiện đổi (vd chọn
khách hàng), nhưng danh sách candidate (`effectiveDeals`) có thể đang lấy từ **2 nguồn async khác
nhau** (prop từ cha đã tải sẵn/chưa, + fetch riêng theo id vừa chọn) — nếu effect chạy đúng lúc cả 2
nguồn đều chưa kịp trả dữ liệu, nó đếm ra 0 candidate, bỏ qua vĩnh viễn (không tự thử lại khi data tới
sau, vì ref "đã auto-chọn 1 lần" không được set khi không khớp 1 candidate — nhưng effect cũng không
tái kích hoạt đúng cách nếu thiếu dependency).

**Case đã gặp**: `QuoteWorkspaceModal.tsx` — auto-chọn "Cơ hội CRM" khi khách hàng chỉ có đúng 1 Deal,
bị miss khi mở từ "Yêu cầu hỗ trợ báo giá" (trang cha `useCrm()` có thể chưa tải xong `deals` lúc vừa
chọn khách hàng).

**Cách fix**: thêm 1 state "đã tải xong cho đúng id hiện tại chưa" (`fetchedCustomerDealsReadyFor`),
chỉ cho effect auto-chọn chạy SAU KHI nguồn fetch riêng (đáng tin cậy nhất, luôn fetch lại đúng theo
id) đã resolve — không dựa vào `deals` prop (có thể cũ/chưa tải) để quyết định "đã đủ data chưa".

**Khi thêm tính năng "tự động chọn nếu chỉ có 1"**: luôn gate theo 1 loading-flag rõ ràng của nguồn dữ
liệu đáng tin cậy nhất, đừng chỉ dựa vào `effectiveDeals.length` đổi — độ dài mảng rỗng không phân
biệt được "chưa tải xong" với "tải xong và thật sự rỗng".

---

## 6. Component dùng chung render khác nhau theo context nhưng không có cách override sạch

**Triệu chứng**: 1 field dùng ĐÚNG data đã khóa sẵn (vd Customer đã biết trước) nhưng UI vẫn hiện
input tìm kiếm/combobox tự xây riêng (dễ lệch tính năng so với bản component "thật"), hoặc tệ hơn là
**ẩn hẳn field đi** không còn dấu vết gì cho người dùng biết.

**Case đã gặp**:
- `LeadDealQualificationPanel.tsx` có field "Dự án" tự implement riêng (`ProjectComboField`) thay vì
  dùng lại `ProjectPicker` thật của `DealFormFields.tsx` — 2 bản dễ lệch tính năng. Fix: export
  `ProjectPicker`, thêm prop `projectField?: ReactNode` cho panel dùng chung để override hẳn bằng
  component thật khi cha muốn, thay vì duy trì 2 bản song song.
- `DealFormFields.tsx` nhánh "Tạo cơ hội nhanh": khi `form.customerLocked = true`, field
  "Customer / Công ty" bị ẩn HẲN (JSX `: null`) — không còn gì hiện tên khách hàng đang tạo Cơ hội
  cho ai, trông như quên auto-điền. Fix: hiện lại 1 ô input readonly với tên khách đã khóa, thay vì ẩn
  trắng.

**Nguyên tắc rút ra**: khi 1 field bị khóa/đã biết trước giá trị, **vẫn phải hiện** giá trị đó (dù
readonly), không được ẩn hẳn — người dùng cần thấy xác nhận hệ thống đã hiểu đúng ngữ cảnh.

---

## 7. Action tạo xong không tự cập nhật UI (thiếu sự kiện refresh / thiếu gọi callback)

**Triệu chứng**: tạo/sửa xong 1 bản ghi (Deal, báo giá, hợp đồng...) nhưng danh sách/trang liên quan
không tự cập nhật — phải F5 mới thấy.

**Nguyên nhân gốc 2 dạng đã gặp**:
1. Repository method tạo/sửa bản ghi **quên gọi** `notifyDealsChanged()` (event bus
   `modules/crm/utils/dealSync.ts`, các trang khác lắng nghe qua `useDealsChanged()` để tự tải lại).
   Case: `SeedingCrmRepository.ts` → `createDeal()`/`updateDeal()` không gọi, trong khi
   `SeedingQuoteRepository`/`SeedingContractRepository` đã gọi đúng.
2. Component cha có callback `onCreated()` nhưng chỉ gọi nó ở **1 nhánh** hành động (vd nút "Lưu
   nháp"), còn nhánh chính (vd nút xác nhận tạo, kèm `router.push` sang route khác) lại quên gọi —
   vì `router.push` đổi URL/tab query nhưng KHÔNG tự trigger refetch nếu id không đổi.

**Cách fix**: (1) thêm `notifyDealsChanged()` vào repository method ngay sau khi tạo/sửa thành công;
(2) gọi `onCreated()`/callback refresh ở **MỌI nhánh** dẫn tới thành công, không chỉ nhánh "ở lại
trang". File: `SeedingCrmRepository.ts`, `CreateOpportunityDrawer.tsx`.

**Khi thêm 1 action tạo/sửa mới**: luôn tự hỏi — (a) repository có gọi `notifyDealsChanged()` không?
(b) MỌI nhánh thành công (kể cả nhánh có `router.push`/đóng modal) có gọi callback refresh không?

---

## 8. Tính năng mới bị giới hạn ngầm theo định dạng file, không honest với người dùng

**Triệu chứng**: upload file đúng định dạng phổ biến trong hệ thống (vd `.docx` cho hợp đồng) nhưng
tính năng liên quan (OCR đối chiếu) báo "không đọc được" — không phải lỗi, mà do định dạng đó đơn
giản là CHƯA được code xử lý, dù UI hiện honest message thay vì bịa số liệu (đúng thiết kế an toàn)
nhưng gây hiểu nhầm là bug.

**Case đã gặp**: `contract_ocr_service.py` chỉ xử lý PDF/ảnh, `.docx` (định dạng hợp đồng phổ biến
nhất trong hệ thống này) rơi thẳng vào `return _empty_result("heuristic", False)`.

**Cách fix**: thêm trích xuất thật cho `.docx` bằng `python-docx` (đã là dependency sẵn có qua
`contract_docx_engine.py`), đi qua ĐÚNG pipeline AI/heuristic đã có cho text thật (không viết lại
logic AI riêng cho từng định dạng).

**Khi nhận báo cáo "tính năng X báo lỗi với file Y"**: luôn kiểm tra xem có phải code chỉ support 1
tập định dạng cố định (`if ext in (...)" / "if ext == ...`) và định dạng người dùng dùng đơn giản
chưa nằm trong đó — rất dễ nhầm với bug thật.

---

## 9. 2 entry point cho "cùng 1 tính năng" tưởng độc lập nhưng thực ra dùng chung code

**Bài học audit**: khi nhận yêu cầu "đồng bộ 2 nút/2 luồng làm cùng 1 việc", đừng giả định chúng là
2 implementation riêng biệt cần merge — rất có thể chúng ĐÃ dùng chung 1 component, và khác biệt thật
sự chỉ nằm ở (a) prop nào được truyền khác nhau giữa 2 nơi gọi (xem mục 4), hoặc (b) 1 bug chỉ lộ ra
ở 1 trong 2 đường do race condition/thiếu data (xem mục 5) — KHÔNG phải do thiếu tính năng thật sự.

Case: "Yêu cầu hỗ trợ báo giá" (QuoteCenterPage) vs "+ Tạo báo giá" (CrmCustomerDetailPage) — audit
đầy đủ (props, API, quyền, post-save) xác nhận cả 2 dùng chung 100% `QuoteWorkspaceModal`, chung API
`POST /quotes`, chung quyền backend, chung chuỗi refresh — khác biệt duy nhất là mục 4 + mục 5 ở trên.

**Quy trình audit chuẩn khi gặp yêu cầu này**: (1) xác nhận có dùng chung component không (grep import
+ nơi render); (2) nếu có, so sánh prop-by-prop giữa 2 nơi gọi; (3) trace nguồn dữ liệu async nào mỗi
bên tự fetch khác nhau; (4) KHÔNG viết lại/hợp nhất code nếu chưa xác nhận bước 1-3 thật sự có khác
biệt chức năng, chỉ fix đúng chỗ lệch tìm được.

---

## 10. Nhóm khách hàng (status) / "Việc tiếp theo" trước đây hardcode, không phản ánh dữ liệu thật

Không phải bug, nhưng ghi lại vì cùng tinh thần "kiểm tra trước khi tưởng đã có sẵn": trước
2026-10-10, cột "Việc tiếp theo" ở danh sách Khách hàng hoàn toàn là 1 switch cứng theo `status`
(`new_lead` → "Xác minh nhu cầu"...), **không hề đọc** báo giá/hợp đồng/deal thật — dù nhìn qua tưởng
đã là tính năng động. Đã thay bằng `crm_customer_progress_service.py` (backend tính dựa trên Deal/Báo
giá/Hợp đồng đang hoạt động, đọc tại `_attach_customer_metrics()`). Xem
`linkedin_group_crawler/app/modules/all_platform/services/crm_customer_progress_service.py`.

**Bài học**: đừng giả định 1 cột/label "trông có vẻ động" là thật sự tính từ dữ liệu — luôn grep tới
tận nơi gán giá trị trước khi kết luận.

---

---

## 11. "+ Tạo cơ hội mới" nhanh trong dropdown lại dùng form đơn giản hơn, dù đã biết sẵn Khách hàng

**Triệu chứng**: bấm "+ Tạo cơ hội mới..." từ 1 dropdown "Cơ hội CRM" (vd trong `QuoteWorkspaceModal`)
mở ra form "Tạo cơ hội nhanh" (`DealFormModal`) — thiếu nhiều field/ngữ cảnh so với form "Tạo cơ hội
bán hàng" (`CreateOpportunityDrawer`, dùng ở Chi tiết khách hàng/"+Deal upsell"), dù khách hàng đã
chọn sẵn từ trước (đủ ngữ cảnh để dùng form đầy đủ).

**Cách fix (2026-10-10)**: swap `<DealFormModal>` → `<CreateOpportunityDrawer>` ngay tại điểm
"+ Tạo cơ hội mới" trong `QuoteWorkspaceModal.tsx`. 2 việc cần làm khi nhúng `CreateOpportunityDrawer`
vào 1 modal khác:
1. **`customer` prop chỉ cần tối thiểu** (`id` + `customerName`, các field còn lại optional) —
   component tự fetch lại `dealCount`/`ownerId`/`canEdit` thật ngay khi mở (xem effect "Khi doi sang
   khach hang khac"), không cần dựng đủ `CrmCustomerRow` đầy đủ trước.
2. **`onCreated` cần nhận được Deal vừa tạo** để cha dùng ngay (vd tự chọn vào dropdông) — đã đổi
   signature từ `() => void` thành `(deal?: Deal) => void` (tham số optional, các nơi gọi cũ không
   cần đổi gì). **`suppressNavigation` prop mới** (mặc định `false`) — khi nhúng trong 1 modal/workspace
   khác đang dở dang (vd đang điền báo giá), PHẢI truyền `suppressNavigation` để tắt hẳn
   `router.push(...)` ở nhánh "Tạo cơ hội" (navigate đi nơi khác sẽ làm mất dữ liệu đang nhập dở) —
   chỉ đóng drawer + gọi `onCreated`, giống hệt hành vi "Lưu nháp".

File: `modules/crm/components/CreateOpportunityDrawer.tsx`, `modules/crm/components/QuoteWorkspaceModal.tsx`.

**Khi thêm 1 chỗ "tạo nhanh" mới mà ngữ cảnh đã biết sẵn Khách hàng**: ưu tiên dùng
`CreateOpportunityDrawer` (form đầy đủ, đã chuẩn hoá) thay vì `DealFormModal` (bản rút gọn, chỉ nên
dùng khi THẬT SỰ chưa biết khách hàng trước, vd từ board Kanban "+ Thêm deal"). Nếu nhúng vào 1
modal/workspace khác đang có dữ liệu dở dang, nhớ `suppressNavigation`.

---

## 12. Lead 360 mở báo giá với danh sách Presale/Sale rỗng cứng

**Triệu chứng**: mở "+ Tạo yêu cầu báo giá" từ Lead 360, dropdown gán Presale/Sale trong
`QuoteWorkspaceModal` không có ai để chọn, trong khi mở từ Quote Center/Customer Detail thì bình
thường.

**Nguyên nhân gốc**: `LeadQuoteWorkspaceHost.tsx` truyền `agents={[]}` hardcode cho
`QuoteWorkspaceModal` — 3 entry point khác của cùng modal đều fetch danh sách thật.

**Cách fix**: fetch `seedingCrmRepository.getAgents()` song song với deal/forms/issuers (y hệt
`dealAgents` của `CrmCustomerDetailPage.tsx`), truyền vào thay vì mảng rỗng.

**File**: `modules/crm/components/lead360/LeadQuoteWorkspaceHost.tsx`. Main + 3 clone.

---

## 13. Nút "Tạo báo giá"/"Tạo hợp đồng" trên Project card mở nhầm form Tạo Cơ hội

**Triệu chứng**: trong Chi tiết khách hàng → tab Dự án → 1 Project cụ thể, nút "+ Tạo báo giá" (sub-tab
Báo giá) và "+ Tạo hợp đồng" (sub-tab Hợp đồng) đều mở form "Tạo cơ hội nhanh" (`DealFormModal`),
không tạo báo giá/hợp đồng nào.

**Nguyên nhân gốc**: cả 2 nút dùng CHUNG handler `onClick={() => setDealModal({ open: true, project:
selectedProject })}` với nút "Tạo cơ hội" bên cạnh (copy-paste 3 nút giống nhau, chỉ đổi label, quên
đổi handler cho 2 nút sau). `CrmCustomerDetailPage.tsx` đã CÓ SẴN hàm đúng cho báo giá
(`openQuoteRequestForProject()`, mở `QuoteWorkspaceModal` khóa sẵn Dự án) nhưng chưa từng được nối vào
nút nào (dead code) — còn hàm cho hợp đồng thì chưa tồn tại.

**Cách fix**: thêm 2 prop mới (`onCreateQuote`, `onCreateContract`) cho `CustomerProjectsTab.tsx`, nối
đúng `openQuoteRequestForProject()` (đã có) + hàm mới `openRegisterContractForProject()` (viết theo
đúng pattern resolve-Deal của `openQuickQuoteForProject()` đã có: ưu tiên Deal thuộc dự án, fallback
`activeDeal`, báo lỗi rõ nếu dự án chưa có Deal nào).

**File**: `modules/crm/components/CrmCustomerDetailPage.tsx`, `modules/crm/components/
CustomerProjectsTab.tsx`. Main + 3 clone.

---

## 14. `CONTRACT_STAGE_SYNC_ENABLED` bật lại sau khi tạm tắt

Không phải bug — ghi lại vì đổi hành vi production thật. `deal_stage_sync_service.py` từng tắt cờ này
(`False`) tạm thời trong lúc module Hợp đồng "xây lại", khiến ký hợp đồng không tự đẩy Deal lên stage
5 "Lên hợp đồng". Mentor xác nhận module Hợp đồng đã đủ ổn ngày 2026-10-10 → bật lại (`True`). Test
`test_contract_stage_sync_is_disabled_by_default` đổi tên thành
`test_contract_stage_sync_is_enabled_by_default` + đảo ngược assertion; thêm test riêng
`test_contract_stage_sync_can_be_disabled_via_monkeypatch` để vẫn giữ khả năng test với cờ tắt khi
cần. **Nếu cần tắt lại cờ này trong tương lai (vd phát hiện bug ở module Hợp đồng)**: chỉ sửa 1 dòng
`CONTRACT_STAGE_SYNC_ENABLED = False` + chạy lại `test_deal_stage_sync.py`, không cần sửa logic nào
khác — toàn bộ hook điểm đã có sẵn, cờ chỉ bật/tắt 1 nhánh trong `compute_target_stage()`.

**File**: `app/modules/all_platform/services/deal_stage_sync_service.py`,
`tests/test_deal_stage_sync.py`. Main + 3 clone.

---

## 15. Re-check sau "fix hết" (2026-10-10) — soát lại toàn bộ, chỉ còn 1 docstring lệch cờ

Sau khi fix xong 5 điểm + 15 backdrop ở trên, soát lại lần nữa (mentor yêu cầu "check kĩ lại"):

- Quét lại pattern backdrop bằng regex khác (class `overlay`/`scrim`, rồi liệt kê MỌI file có chữ
  `backdrop` trong `linkedin-crawler-ui/modules` để không sót module ngoài `crm`/`quotes`/`contracts` —
  gồm cả `omnichannel`, `service-catalog`). Không tìm thêm bug thật nào; 3 chỗ khớp regex rộng hơn
  (`CustomerContractsTab.tsx:289`, `DealFormModal.tsx:195`, `IssuerCompanyAdminPage.tsx:476`) đều là
  overlay **sibling tự đóng** (render cạnh `<aside>` trong `<>...</>`, không bọc làm cha) — đúng pattern
  miễn nhiễm đã ghi ở mục 1 (so dòng DOM, không so cây React khi không phải cha-con).
- Diff lại 3 clone vs main cho 4 file đã "wholesale copy" (`crm_customer_service.py`,
  `routers/customer_lead.py`, `ContractAIWizard.tsx`, `ContractDetailPage.tsx`) — cả 3 clone giống
  main 100% (diff rỗng), không bị rớt code riêng của clone nào.
- **Tìm được 1 lỗi nhỏ thật**: dòng docstring đầu `deal_stage_sync_service.py` (dòng 10, mô tả quy
  tắc tu dong) còn ghi chú chết `[TAM TAT - CONTRACT_STAGE_SYNC_ENABLED=False]` dù cờ đã bật lại
  `True` ở mục 14 — dễ gây hiểu nhầm cho người đọc sau. Đã xoá tiền tố đó. Main + 3 clone.
- `tsc --noEmit` 4 app + `pytest tests -q` trong container chạy lại sau các fix trên: 356 passed,
  15 skipped, 1 fail cũ không liên quan (`test_items_table_rows_cloned_with_prototype_formatting`) —
  đúng baseline từ đầu phiên, không có regression mới.

**File**: `app/modules/all_platform/services/deal_stage_sync_service.py` (docstring). Main + 3 clone.

---

## 16. Push main làm SẬP backend cả 3 clone (502) — "wholesale copy" bỏ sót dependency chỉ có ở main

**Triệu chứng**: ngay sau khi push lên `main`, cả 4 domain production (`crm.markee.vn`,
`crm.markeeai.com`, `crm.getcloudgate.com`, `crm.securityzone.vn`) đăng nhập Google báo
"Lỗi máy chủ (502)". Frontend vẫn load bình thường (router/frontend là container riêng),
chỉ API bị 502.

**Nguyên nhân gốc**: 2 lỗi cộng dồn.
1. **Hạ tầng dễ quên**: khác `deploy-app.yml` (chỉ `workflow_dispatch`, chạy tay),
   `.github/workflows/deploy-crm-module.yml` / `deploy-crm-cloudgate.yml` /
   `deploy-crm-securityzone.yml` có `on: push: branches: [main]` — **tự động deploy production
   mỗi lần push main có đổi file trong `crm-*/`**, không cần dispatch tay.
2. **Bug thật**: `routers/customer_lead.py` được "wholesale copy" nguyên bản từ main sang cả
   3 clone (coi là an toàn vì diff y hệt main) — nhưng file này `import resolve_web_intake_user`
   từ `auth_deps.py`. Hàm đó CHỈ có ở main (tính năng Web Intake), 3 clone **cố tình không có**
   (file `auth_deps.py` của clone có sẵn comment "CRM clones do not include Web Intake"). Diff
   đúng là khớp main 100% cho FILE ĐÍCH, nhưng không kiểm tra liệu các symbol nó IMPORT có tồn
   tại ở nơi khác trong clone hay không → `ImportError` lúc backend khởi động → crash → router
   502 mọi request.
3. **Lỗ hổng kiểm thử**: container `copilot-e2e-backend` dùng để chạy `pytest` sau mỗi đợt sửa
   chỉ mount code của `linkedin_group_crawler` (main) — KHÔNG BAO GIỜ thực sự import/chạy code
   Python của 3 clone, nên lỗi `ImportError` này không bị bắt trước khi push.

**Cách fix**: thêm `resolve_web_intake_user` dạng no-op (luôn `None`, đúng tinh thần "clone
không có Web Intake") vào `auth_deps.py` cả 3 clone. Verify bằng cách thật sự `docker run
python:3.12-slim` cài `requirements.txt` rồi `python -c "import app.main"` cho cả 3 clone (not
just diff/tsc) — không còn traceback. Push hotfix, cả 3 workflow tự deploy lại, test thật
(`POST /api/all-platform/auth/google`) trả `422` (đúng, không còn `502`).

**Quy tắc rút ra cho lần sau — BẮT BUỘC đọc trước khi "wholesale copy" file backend Python từ
main sang clone**:
- Diff file ĐÍCH giống main KHÔNG đủ để kết luận an toàn — phải tự `import` thật (hoặc ít nhất
  grep từng symbol được import) để chắc mọi dependency file đó cần cũng đã có ở clone, đặc biệt
  với các tính năng main có mà clone cố tình không có (vd Web Intake).
- Push lên `main` có thay đổi file trong `crm-module/`, `crm-cloudgate/`, hoặc
  `crm-securityzone/` sẽ **TỰ ĐỘNG DEPLOY PRODUCTION** qua `deploy-crm-*.yml` — không phải "push
  xong rồi tính sau", phải coi push vào các thư mục này như bấm nút deploy thật.
- `copilot-e2e-backend` / `pytest` ở máy dev chỉ test được code của main — đổi file backend
  Python ở clone (nhất là file "wholesale copy") nên tự `docker run` cài deps + `import app.main`
  thật trước khi push, không chỉ tin tưởng diff rỗng.

**File**: `auth_deps.py` cả 3 clone. Liên quan đến mục 11 (3-clone AI Copilot + Web Intake lag)
ở trên — hoá ra việc port Web Intake chưa trọn vẹn (thiếu `resolve_web_intake_user`).

---

## 17. `quote["items"]` là CÂY lồng nhau (Section → children) — 5 nơi đọc thẳng mảng gốc, mất sạch hạng mục nằm trong children

**Triệu chứng**: báo giá có dùng "Nhóm hạng mục" (Section, vd nhóm "test" gom 3 dòng con) thì:
(a) Bước 1 Copilot AI soạn hợp đồng ("Tóm tắt báo giá") hiện bảng TRỐNG hoàn toàn ("mấy hạng mục
đâu hết r"); (b) hợp đồng AI soạn ra chỉ điền ĐÚNG 1 dòng là tên Section, Phí dịch vụ để trống,
mất hết 2+ hạng mục thật bên trong ("nó k fill đủ nè").

**Nguyên nhân gốc**: `get_quote()` (`supabase_quote_service.py`) trả `items` dạng **cây lồng nhau**
qua `_quote_item_tree()` — hạng mục thật nằm trong `item["children"]` của Section, KHÔNG phải mảng
phẳng. Ít nhất **5 nơi** đọc thẳng `quote.get("items") or []`/`quote["items"]` mà không flatten,
coi nhầm là mảng phẳng:
1. `ContractAIWizard.tsx` (FE) dòng 638 — bảng "Tóm tắt báo giá" Bước 1: `.filter(i => i.rowType
   !== 'section')` trên mảng CÂY → nếu quote chỉ có 1 Section ở gốc, lọc xong còn `[]` → bảng trống.
2. `contract_ai_service.py` `_format_quote_context()` — context đưa cho AI chỉ thấy dòng Section
   rỗng (không giá/số lượng) → AI chỉ điền đúng 1 dòng rỗng vào hợp đồng.
3. `contract_docx_builder.py` `_items_table()` (Điều 2 hợp đồng AI soạn) + `check_quote_consistency()`
   — cùng lỗi, bảng Word hạng mục và cảnh báo lệch tổng đều bỏ sót hạng mục trong children.
4. `quote_rule_evaluation_service.py` (rule engine duyệt bao giá) — tính `discount_percent` từ
   subtotal/discount của mảng cây → quote gom nhóm luôn ra `discount_percent≈0` dù thực tế có giảm
   giá, có thể làm sai kết quả rule tự động duyệt.
5. `routers/quote.py` `_items_touch_fields()`/`_items_touch_pricing_fields()` (quyền sửa theo
   field) — so sánh `existing_items` (cây, từ `quote.get("items")`) với `new_items` (payload FE,
   MẢNG PHẲNG từ `itemsDraft`) theo INDEX → lệch độ dài/thứ tự ngay cả khi không đổi gì thật, với
   quote có Section luôn bị coi là "có đổi field kỹ thuật/giá" dù không ai sửa gì.

**Cách fix**: thêm hàm dùng chung `flatten_quote_items()` — Python: định nghĩa CHÍNH trong
`supabase_quote_service.py` (cạnh `_quote_item_tree()` - hàm nghịch đảo), các service khác import
từ đó (không định nghĩa trùng lặp); TS: đã CÓ SẴN `flattenQuoteItems()` trong
`modules/quotes/utils/quoteCalculations.ts` — chỉ cần `ContractAIWizard.tsx` gọi nó trước khi lọc
`rowType`, trước đây quên dùng. Flatten giữ nguyên thứ tự (mỗi item rồi tới children của nó) nên áp
được cho cả so sánh theo index.

**File**: `supabase_quote_service.py` (hàm mới `flatten_quote_items`), `contract_ai_service.py`,
`contract_docx_builder.py`, `contract_source_service.py`, `quote_rule_evaluation_service.py`,
`routers/quote.py` (backend), `modules/crm/integrations/contracts/ContractAIWizard.tsx` (frontend).
Main + 3 clone. **Các nơi KHÁC cũng đọc `quote.items`/`itemsDraft` cho PDF/Public/
QuoteDocumentRenderer/QuoteWorkspaceModal đã tự flatten đúng từ trước (dùng `item.children` trực
tiếp hoặc tự quản `itemsDraft` phẳng) — không phải sửa, chỉ 5 nơi liệt kê trên bị sót.**

## 18. Thêm sản phẩm mới từ dấu "+" cạnh 1 dòng báo giá trống — mô tả gõ trong modal không chuyển vào dòng

**Triệu chứng**: ở dòng báo giá còn trống, bấm "+" mở modal "Thông tin chính" tạo sản phẩm mới, gõ
"Mô tả chi tiết" (vd "tr") rồi lưu — dòng báo giá vẫn trống cột "MÔ TẢ".

**Nguyên nhân gốc**: `QuoteWorkspaceModal.tsx`, hàm `handleQuickAddProductCreated` (~dòng 2999-3041)
— sau khi tạo sản phẩm, patch các field giá/đơn vị/VAT vào dòng đã có nhưng **cố ý loại `description`
khỏi danh sách field patch**, với lý do "giữ nguyên mô tả Sale đã gõ trên bảng". Logic đúng khi dòng
ĐÃ có mô tả Sale tự gõ trước đó, nhưng SAI khi dòng đang trống và mô tả chỉ vừa được gõ bên TRONG
modal tạo sản phẩm — bị bỏ qua luôn, không bao giờ chuyển vào dòng.

**Cách fix**: chỉ giữ nguyên mô tả cũ nếu dòng ĐÃ có mô tả (`row.description?.trim()`), còn dòng
trống thì lấy mô tả vừa tạo (`priced.description`, tức `catalogItemToQuoteItem(hydrated).description`).

**File**: `modules/crm/components/QuoteWorkspaceModal.tsx`. Main + 3 clone.

---

## 19. Audit toàn bộ CRM main vs 3 clone (soát lệch code thật, loại nhiễu CRLF/LF)

Soát lại `diff --strip-trailing-cr` (lần trước dùng `diff` thường khiến số dòng lệch bị thổi phồng
do main dùng CRLF, clone dùng LF - sai lệch gần hết là nhiễu xuống dòng, không phải code thật khác
nhau) cho toàn bộ `modules/crm`, `modules/quotes`, `modules/contracts`, `modules/contract-templates`,
`modules/service-catalog` + backend `routers`/`services`/`schemas` liên quan + Next.js pages + tests.
Tìm được các chỗ THẬT SỰ lệch (không phải nhiễu dòng), đã fix:

- `ContractCopilotParts.tsx`, `CustomerQuotesTab.tsx` (nút "Di chuyển báo giá" hàng loạt),
  `quote-center.css`, `ContractTemplateLibrary.tsx` ("Thư viện mẫu hợp đồng") — main có bản UI đã
  polish, 3 clone còn bản cũ → wholesale-copy main sang 3 clone (đã verify lock-step 3 clone giống
  nhau + không mất code riêng trước khi copy).
- **Phát hiện NGƯỢC quan trọng**: `quoteColumns.ts` + `QuoteDocumentRenderer.tsx` — 3 CLONE đã có
  sẵn 1 fix crash thật từ 2026-09-22 (trang `/baogia/{token}` trắng trang "This page couldn't load"
  khi backend trả `items: null` thay vì `[]`, do default param `= []` chỉ áp dụng cho `undefined`
  không áp dụng cho `null`) mà **MAIN LẠI THIẾU** — tức lần sửa đó chỉ làm trên 1 clone rồi port
  sang 2 clone kia, quên port ngược lại main. Đã port từ clone về main.
- `crm-cloudgate/backend/.../routers/contract_docx.py` (CHỈ riêng cloudgate, 2 clone kia đã đúng):
  thiếu field `contact_id`/`representative` trên `FromClausesRequest` + wiring
  `resolve_representative()`/`build_parties(..., representative)` — hợp đồng AI soạn trên cloudgate
  luôn tự suy ra người đại diện ký mặc định, bỏ qua người Sale đã chọn ở Copilot.

Các chỗ còn lệch khác đã rà và xác nhận KHÔNG phải thiếu code: `services/all-platform.service.ts`,
`material-to-lucide-icon.tsx`, `env.ts` (domain Seeding/branding/config, clone cố tình không có);
`routers/project.py` wiring `is_web_intake_user` (stub luôn `return False` ở clone nên có/không
code này hành vi giống hệt nhau, không ảnh hưởng); migration-number trong comment
`crm_lead_rule_service.py` (151 vs 152 - mỗi app có chuỗi migration riêng, không phải lỗi).

**File**: xem chi tiết từng mục. Main + 3 clone (trừ mục `contract_docx.py` chỉ cloudgate).

## 20. Mở Lead khác giữ lại dữ liệu form của Lead cũ (drawer "Xác minh Lead")

**Triệu chứng**: xem/điền 1 Lead, đóng lại, mở 1 Lead KHÁC — các field "THÔNG TIN THEN CHỐT"/"BÀN
GIAO SALE" (giá trị dự kiến, mức độ quan tâm, bước tiếp theo, ghi chú, giai đoạn, dự án...) vẫn hiện
dữ liệu của Lead TRƯỚC ĐÓ dù Lead mới chưa hề có dữ liệu này.

**Nguyên nhân gốc**: `LeadDetailDrawer.tsx` có 2 effect chạy khi `lead` đổi: (1) "Master Hydration
Effect" gọi `setForm(prev => ({...prev, estimatedValue: ... ?? prev.estimatedValue, nextStep: ...
|| prev.nextStep || '', ...}))` — mọi field Lead mới KHÔNG có giá trị sẽ fallback về `prev` (tức dữ
liệu Lead CŨ còn sót trong state); (2) effect "reset khi đổi Lead" (so `initializedLeadRef.current`
với `lead.id`) reset rất nhiều state (`freshLead`, `contact`, `nurtureReason`...) nhưng **không hề
reset `form`** — nên `prev` trong hydration effect không bao giờ thực sự về rỗng khi chuyển Lead.

**Cách fix**: thêm `setForm({...mặc định rỗng giống state khởi tạo...})` vào ngay đầu effect reset
khi đổi Lead (trước khi hydration effect chạy lại cho Lead mới), đưa `prev` về đúng rỗng trước khi
merge dữ liệu Lead mới.

**File**: `modules/crm/components/LeadDetailDrawer.tsx`. Main + 3 clone.

---

## 21. "+ Thêm deal và báo giá" (DealQuoteWizard) không bao giờ snapshot Đơn vị phát hành — báo giá thiếu logo dù Đơn vị phát hành đã có logo

**Triệu chứng**: tạo báo giá qua nút "+ Thêm deal và báo giá" (wizard nhanh 4 bước: Khách hàng →
Chọn mẫu → Báo giá → Xác nhận) — báo giá ra đúng tên/email/SĐT công ty phát hành nhưng **không có
logo**, dù Đơn vị phát hành ĐÃ upload logo từ trước (xác nhận: báo giá test tạo SAU khi logo đã có
sẵn, vẫn trống).

**Nguyên nhân gốc**: `DealQuoteWizard.tsx` gọi `quoteDraftFromForm(form, dealDraft, undefined,
currentUser?.name)` — tham số `issuerCompany` LUÔN truyền `undefined` (wizard này không có bước
chọn Đơn vị phát hành như `CreateQuoteModal.tsx`). Do đó hàm `applyIssuerCompanySnapshot()` không
bao giờ chạy cho luồng này — các field `seller*` (đặc biệt `sellerLogo`) không được snapshot từ
Đơn vị phát hành thật, mà rơi về `defaultValue` TĨNH của MẪU báo giá (`QuoteDocumentRenderer.tsx`
`fieldValue()`, chỉ áp dụng khi KHÔNG có `issuerSnapshotCompanyId`). Tên công ty/email/SĐT vẫn
đúng vì admin đã gõ tay các giá trị đó làm default trong mẫu — riêng Logo cần URL thực tế (phải
upload file trước) nên admin thường không set sẵn trong defaultValue của mẫu, dẫn đến trống.

**Cách fix**: `DealQuoteWizard.tsx` fetch `issuerCompanies` lúc mở (giống `CreateQuoteModal`), ở
`handleSelectForm()` resolve đúng công ty theo `form.issuerCompanyId` (mẫu luôn gắn đúng 1 công ty)
rồi truyền vào `quoteDraftFromForm()` thay vì `undefined` — đúng pattern Bước 1 của
`CreateQuoteModal.tsx`. Đã audit: chỉ có 2 nơi gọi `quoteDraftFromForm()` trong toàn repo
(`CreateQuoteModal.tsx` đã đúng từ đầu, `DealQuoteWizard.tsx` là chỗ duy nhất bị thiếu) — không
còn entry point nào khác bị bug tương tự.

**File**: `modules/crm/integrations/quotes/DealQuoteWizard.tsx`. Main + 3 clone.

## 22. "Mô tả chi tiết" để trống khi tạo sản phẩm mới → tự động bị điền bằng Tên sản phẩm

**Triệu chứng**: tạo sản phẩm mới trong catalog (modal "Thông tin chính"), cố ý để trống "Mô tả chi
tiết", chỉ điền "Tên sản phẩm" — dòng báo giá tương ứng lại hiện cột "MÔ TẢ" trùng y hệt Tên sản
phẩm, khiến Sale tưởng nhầm là dữ liệu đã lưu đúng.

**Nguyên nhân gốc**: `catalogItemToQuoteItem()` (`QuoteWorkspaceModal.tsx`) có
`description: item.quoteDescription || item.description || item.name` — khi cả `quoteDescription`
lẫn `description` đều rỗng (Sale cố tình để trống), code tự fallback dùng `item.name` làm mô tả.
Mentor xác nhận đây là hành vi KHÔNG mong muốn (không phải chủ đích).

**Cách fix**: bỏ fallback `|| item.name` — để trống đúng như Sale đã để trống
(`item.quoteDescription || item.description || ''`).

**File**: `modules/crm/components/QuoteWorkspaceModal.tsx`. Main + 3 clone. Lưu ý: đây là fallback
DÙNG CHUNG cho mọi nơi gọi `catalogItemToQuoteItem()` (thêm từ dấu "+" cạnh dòng, thêm từ Catalog
Picker "+ Thêm vào báo giá"...) — fix áp dụng nhất quán cho tất cả, không chỉ riêng 1 luồng.

---

## 23. "Việc tiếp theo" không hiện ở trang Chi tiết khách hàng (Known gaps #6)

**Triệu chứng**: `CrmCustomersDirectory.tsx`/`LeadsDirectory.tsx`/`Lead360Drawer.tsx` đều hiện
"Việc tiếp theo" (tự tính từ Deal/Báo giá/Hợp đồng đang hoạt động), riêng trang Chi tiết khách
hàng (`CrmCustomerDetailPage.tsx`) thì không có.

**Nguyên nhân gốc**: backend ĐÃ tính và trả field này đúng cho endpoint chi tiết — `related_records()`
(phục vụ `GET /customers/{id}/related`, nguồn data chính của trang) gọi `get_customer()` bên trong,
mà `get_customer()` đã `return _attach_customer_metrics([customer])[0]` (hàm tính `next_action` dùng
chung với danh sách). Tức dữ liệu đã có sẵn trong response — chỉ là type `RelatedPayload.customer`
ở FE chưa khai báo field `next_action`, và không nơi nào trong trang render nó ra.

**Cách fix**: thêm `next_action?: string | null` vào type, tính `nextActionText` (ưu tiên
`next_action`, fallback theo `status` — dùng CHUNG logic với `nextActionOf()` của
`CrmCustomersDirectory.tsx` để không lệch giữa 2 nơi), hiện trong header trang (cạnh "Owner:").

**File**: `modules/crm/components/CrmCustomerDetailPage.tsx`. Main + 3 clone. Không cần sửa backend
(dữ liệu đã có sẵn từ trước).

---

## 24. Owner dự án luôn hiện "Chưa gán" dù đã chọn đúng người lúc tạo

**Triệu chứng**: Tạo dự án mới qua `ProjectFormModal.tsx`, chọn đúng "Người phụ trách dự án" (vd
"Ngọc Thảo Vũ"), bấm "Tạo dự án" → API `POST /projects` trả 200 thành công, nhưng danh sách Dự án
(tab "Dự án" của Khách hàng, và card Dự án trong tab "Tổng quan") vẫn hiện Owner = "Chưa gán". Đã
verify bằng network payload thật (`manager_id` CÓ được gửi đúng lên backend) và reload lại trang
(không phải cache UI) — xác nhận đây là bug hiển thị thật, không phải do dữ liệu sai.

**Nguyên nhân gốc**: field owner thật của bảng `projects` là `manager_id` (backend trả về camelCase
`managerId` qua `_row_to_project()` trong `supabase_project_service.py`). Nhưng 2 nơi hiển thị danh
sách/card Dự án lại đọc nhầm field `owner_id`/`ownerId` — field này KHÔNG tồn tại trên object Project
(nó là tên field dùng cho Customer/Deal/Quote, bị copy nhầm khi viết component Dự án) — nên luôn rơi
vào `undefined`, `memberName()` luôn trả "Chưa gán".

**Cách fix**: đổi `memberName(p.owner_id || p.ownerId)` → `memberName(p.managerId || p.manager_id)`
ở cả 2 nơi.

**File**: `modules/crm/components/CustomerProjectsTab.tsx` (dòng hiện tên Owner trong panel chi tiết
+ trong card danh sách), `modules/crm/components/CustomerOverviewTab.tsx` (card Dự án trong tab Tổng
quan). Main + 3 clone.

---

## 25. Khoảng trắng lớn đầu trang 1 + thừa 1 trang trắng khi "Xem trước / In PDF" từ popup bản xem khách hàng

**Triệu chứng**: Mở báo giá → "Xem bản khách hàng" (popup preview trong `QuoteWorkspaceModal`) →
bấm "Xem trước / In PDF" → bản in/PDF có 1 khoảng trắng lớn phía trên logo công ty, nội dung bị
boc trong 1 "thẻ" nền xám bo tròn thu nhỏ lại (thay vì full trang A4 trắng), và thừa 1 trang 2
trắng tinh dù báo giá chỉ có vài dòng hạng mục.

**Đây là bug GỘP TỪ NHIỀU NGUYÊN NHÂN CỘNG DỒN** (gỡ từng lớp một, xem lịch sử đầy đủ ngay trong
comment tại `quotes.css` gần dòng ~3036 — LAN 1 đến LAN 7), vì mỗi lần sửa dùng
`page.emulate_media(media="print")` + chụp ảnh để verify đều PASS nhưng khi bro in bản PDF THẬT thì
vẫn còn lỗi — do `emulate_media` chạy ở chiều RỘNG màn hình desktop (không phải khổ A4 hẹp hơn), và
chỉ chụp màn hình liên tục chứ không thật sự phân trang, nên 2 trong 3 nguyên nhân dưới đây HOÀN
TOÀN không lộ ra qua cách test đó:

1. **(LAN 3/4, đã lộ qua emulate_media)** `.qc-workspace` (modal sửa báo giá, sibling của modal
   preview, cùng con của `.qc-modal-backdrop` ngoài) còn `max-height:92vh+overflow:hidden` — sau khi
   mở overflow/height nó phình to theo nội dung thật (vì `visibility:hidden` giữ nguyên layout), kéo
   sibling (modal preview) "xuống giữa" khoảng trống đó. Fix: `display:none` hẳn cho `.qc-workspace`
   khi in (an toàn vì nó không chứa `.quote-print-root`).
2. **(LAN 5, CHỈ lộ qua PDF in thật)** `.quote-print-root` dùng CHUNG 1 node DOM với khung trang trí
   của modal preview trên màn hình (`qc-workspace-preview-modal-body--doc`: nền xám, padding 16px,
   border-radius 10px — xem `quote-center.css`). Khi in, các style trang trí này VẪN được vẽ vì
   chính node đó được set `visibility:visible`. Fix: reset riêng `background/padding/border-radius/
   box-shadow` cho `.quote-print-root` + modal cha khi in.
3. **(LAN 7, CHỈ lộ qua PDF in thật)** `.qc-modal-backdrop`/`--nested` ép `position:static` (để tránh
   bug lặp-letterhead của `position:fixed`, xem bug gốc) khiến chúng RƠI VỀ DÒNG CHẢY BÌNH THƯỜNG
   của trang CRM phía sau (`visibility:hidden` giữ nguyên layout, có khi cao hàng nghìn px) → bị đẩy
   xuống dưới cùng. Thử đổi sang `position:absolute;inset:0` (LAN 4) hoặc `absolute;top/left:0` (LAN
   6) đều SAI — containing block của 1 phần tử absolute không tổ tiên positioned là initial
   containing block, mà ICB này cao bằng CẢ trang CRM ẩn phía sau, khiến backdrop tự dãn ra
   hàng nghìn px (dù không vẽ gì) → Chromium vẫn tính vào tổng chiều cao khi phân trang → sinh thừa
   1 trang trắng. **Fix đúng**: GIỮ `position:static` cho backdrop (tránh bug lặp-trang) nhưng dùng
   CSS `:has()` để `display:none` MỌI con trực tiếp khác của `.crm-shell` (trang CRM phía sau) KHÔNG
   chứa `.quote-print-root` — `.crm-shell > *:not(:has(.quote-print-root)) { display:none !important }`.
   Đồng thời `.crm-shell` tự nó có `min-height:100vh + padding` riêng (crm.css) — phải reset
   `min-height:auto;padding:0` luôn cho chính `.crm-shell`, không chỉ các con của nó.
5. **(LAN 8, phát hiện SAU KHI mục 1-4 đã fix xong, qua đo tọa độ text thật trong PDF bằng
   `pymupdf` — khoảng cách từ mép trang tới dòng chữ đầu tiên vẫn ~20-39mm thay vì ~15-21mm mong
   đợi)** 2 nguồn thừa khoảng trắng CÒN SÓT, cả hai đều nằm NGOÀI `.crm-shell` nên không bị ảnh
   hưởng bởi fix LAN 7: (a) `AllPlatformShell.tsx` có 1 `<header>` (thanh trên cùng "sticky top-0
   h-12", chứa tiêu đề trang/nút sidebar mobile) là ANH EM (không phải con cháu) của div bao
   `.crm-shell` — không nằm trong phạm vi `[data-slot=sidebar-*]` đã ẩn sẵn, cũng không bị quy tắc
   `body * {visibility:hidden}` xoá khỏi LAYOUT (chỉ ẩn thị giác, không xoá khoảng trống 48px nó
   chiếm); (b) chính div bao `.crm-shell` (class Tailwind "flex-1 ... p-3 sm:p-5 lg:p-8", không có
   class/data-slot riêng để nhắm) tự nó có padding riêng (20-32px tuỳ breakpoint), tách biệt với
   padding của CHÍNH `.crm-shell` đã reset ở ý 4. Fix: `main > header { display:none !important }`
   (cấu trúc `AllPlatformShell.tsx` cố định, `SidebarInset` luôn render `<main>` bao header+nội
   dung) + `*:has(> .crm-shell) { padding:0 !important }` (chọn đúng thẻ cha TRỰC TIẾP của
   `.crm-shell` bất kể class Tailwind cụ thể là gì, không phụ thuộc tên class dễ vỡ liên đới sau
   này nếu style Tailwind của layout đổi).

**Bài học quan trọng nhất rút ra sau 8 lần sửa**: khi debug 1 bug "khoảng trắng/dư trang khi in"
dạng này, đừng dừng lại ngay khi PDF đã về đúng SỐ TRANG — vẫn phải đo khoảng cách từ mép trang tới
nội dung thật (`pymupdf`, `page.get_text('dict')`, so bbox.y0 với margin đã khai báo ở `@page`) để
chắc chắn không còn khoảng trắng dư nằm "an toàn" trong cùng 1 trang. Số trang đúng không đồng nghĩa
layout đã đúng hoàn toàn.
4. Bonus (cùng họ LAN 5): class dùng chung `.quote-page/.quote-public-page/...` có base rule (đầu
   file, ngoài `@media print`) `min-height:100vh` — khi `.quote-print-root` mang 1 trong các class
   này (vd trang public), `100vh` tính theo viewport trình duyệt (không phải khổ A4), tự ép nội dung
   cao hơn cần thiết → cũng có thể sinh trang thừa. Reset `min-height:auto` khi in.

**Cách test ĐÚNG để không lặp lại sai lầm trên**: `page.emulate_media(media="print")` CHỈ ĐỦ để bắt
lỗi vị trí/overflow rõ ràng (LAN 1-4), KHÔNG ĐỦ để bắt lỗi phân trang/kích thước khổ A4 thật (LAN
5, 7). Phải verify bằng **PDF thật** qua CDP `Page.printToPDF` (hoạt động cả ở Chrome headed, không
cần mở dialog `window.print()` — tránh hẳn rủi ro treo dialog cấp hệ điều hành), rồi dùng `pymupdf`
(`python -m pip install pymupdf`, hoặc kiểm tra đã cài: `import fitz`) để đếm số trang + render ảnh
từng trang (`page.get_pixmap(dpi=100).save(...)`) và xem bằng mắt — đây là cách DUY NHẤT phát hiện
đúng bug LAN 5/7 trong phiên sửa này.

**Nếu hộp thoại in thật (`chrome://print/`, do lỡ bấm nút in thật `window.print()` thay vì
emulate_media) bị KẸT không đóng được**: `Target.closeTarget`/`Input.dispatchKeyEvent` qua CDP đều
KHÔNG đóng được dialog cấp OS này một cách đáng tin cậy. Cách an toàn: tìm đúng PID tiến trình Chrome
TEST riêng (khác hẳn Chrome cá nhân — ví dụ bản Playwright launch có tên "Chrome for Testing", kiểm
qua `Get-Process | Where MainWindowTitle` trong PowerShell để phân biệt với "Google Chrome" thường),
`taskkill //PID <đúng pid đó> //T //F` — TUYỆT ĐỐI KHÔNG `taskkill //IM chrome.exe //F` (giết theo
TÊN sẽ đóng luôn Chrome cá nhân của người dùng, đã từng xảy ra ở phiên trước).

**Sau khi sửa CSS xong PHẢI rebuild Docker** (`docker compose build --no-cache frontend`) — từng
tốn nhiều bước debug vì sửa đúng `main` (`linkedin-crawler-ui`) nhưng test nhầm trên container
`crm-module` (có `frontend/` RIÊNG, build cũ chưa có fix) nên tưởng fix không có tác dụng; `grep`
lại CSS đã bundle trong container (`docker compose exec frontend sh -c "grep ... /app/.next/static/
chunks/*.css"`) để xác nhận rule mới thực sự nằm trong build trước khi test lại.

**File**: `modules/quotes/styles/quotes.css`. Main + 3 clone.

---

## 26. Khoảng trắng lớn phía trên trong popup "Xem bản khách hàng" — chỉ xảy ra khi cửa sổ trình duyệt không đủ rộng (KHÔNG liên quan bug in PDF ở mục 25)

**Triệu chứng**: mở popup "Xem bản khách hàng" (preview trên MÀN HÌNH, chưa bấm in) — letterhead
(logo + tên công ty) tách riêng 1 hàng, khối "BÁO GIÁ / số báo giá / ngày" rớt xuống hàng dưới thay
vì nằm cùng hàng bên phải letterhead, sinh khoảng trắng lớn ở giữa. Dễ nhầm với bug mục 25 (cùng
triệu chứng "khoảng trắng lớn phía trên") nhưng đây là lỗi RIÊNG — xảy ra khi XEM (không in), và chỉ
tái hiện được khi cửa sổ trình duyệt hẹp hơn 900px (vd chia đôi màn hình, laptop nhỏ, popup DevTools
chiếm chỗ) — reload lại không tự hết vì nguyên nhân là CSS theo bề rộng cửa sổ, không phải cache.

**Nguyên nhân gốc**: rule `@media (max-width: 900px) { .sheet-company, .sheet-parties, ... {
flex-direction: column } }` (quotes.css, viết cho mobile/tablet thật sự hẹp) dùng breakpoint theo
BỀ RỘNG CỬA SỔ TRÌNH DUYỆT (không phải bề rộng modal/tài liệu) — popup preview bị "hiểu lầm" là màn
hình hẹp bất cứ khi nào cửa sổ trình duyệt của Sale < 900px, dù bản thân khung tài liệu bên trong
modal vẫn đủ rộng để hiện 1 hàng ngang bình thường. Bug này đã có sẵn 1 fix tương tự dành RIÊNG cho
lúc in (`.sheet-company`/`.sheet-parties` trong `@media print`, ép `flex-direction:row` — xem mục
25) nhưng CHƯA có bản tương đương cho lúc XEM TRÊN MÀN HÌNH trong popup preview, khiến bản xem trước
không khớp với bản in thật (WYSIWYG sai, Sale thấy 1 kiểu nhưng in ra 1 kiểu khác).

**Cách fix**: thêm rule mới (NGOÀI `@media print`, áp dụng mọi lúc) ép `flex-direction:row` cho
`.sheet-company`/`.sheet-parties` nhưng CHỈ trong phạm vi popup preview
(`.qc-workspace-preview-modal-body--doc .sheet-company`, `.qc-workspace-preview-modal-body--doc
.sheet-parties`) — không đụng tới hành vi stack-dọc-khi-màn-hình-hẹp ở các trang báo giá KHÁC (trang
chi tiết nội bộ, trang công khai) nơi đó vẫn là hành vi đúng ý (responsive thật cho màn hình di
động). Verify bằng Playwright `set_viewport_size({width:800, height:900})` (giả lập cửa sổ hẹp) +
screenshot — xác nhận header về đúng 1 hàng ngang, không còn khoảng trắng.

**File**: `modules/quotes/styles/quotes.css`. Main + 3 clone.

<!-- Thêm mục mới vào CUỐI file theo đúng format: Triệu chứng / Nguyên nhân gốc / Cách fix / File liên quan -->

---

## 27. Giảm giá từng hạng mục phải nhập/xoá hai lần, đôi lúc cuộn lên đầu và in ra số thập phân dài

**Triệu chứng**: ô "Giảm giá (%)" từng dòng không nhận thao tác xoá/nhập đầu tiên ổn định; Enter có
thể làm workspace cuộn lên đầu. Giá trị quy đổi từ số tiền giảm hiển thị kiểu
`14.578299120234602%` trên bản xem/in.

**Nguyên nhân gốc**: input number controlled ép chuỗi rỗng thành `0` ở mỗi `onChange`, tranh chấp
với trạng thái gõ tạm của trình duyệt; Enter không bị chặn khỏi form cha. Phép chia số tiền → phần
trăm giữ nguyên float và renderer nối thẳng số vào `%`.

**Cách fix**: thêm `DiscountPercentInput` giữ draft string riêng, cho phép rỗng/dấu thập phân đang
gõ, commit một lần khi blur và chặn Enter submit. Chuẩn hoá tối đa 2 số lẻ ở utility FE, backend
trước khi lưu, và formatter tài liệu.

**File liên quan**: `QuoteWorkspaceModal.tsx`, `QuoteFormFiller.tsx`, `quoteCalculations.ts`,
`QuoteDocumentRenderer.tsx`, `supabase_quote_service.py`. Main + 4 clone.

## 28. Đang điền Tên pháp lý rồi chuyển sang MST thì form "Bổ sung thông tin" tự đóng

**Triệu chứng**: trong AI Contract Copilot, Sale mở bảng bổ sung pháp lý và đang điền nhiều field;
khi cửa sổ nhận focus/precheck chạy lại, bảng biến mất như vừa bấm đóng.

**Nguyên nhân gốc**: `PrecheckPanel` trả placeholder mỗi khi `loading=true`, kể cả đã có kết quả cũ,
làm unmount toàn bộ `LegalInfoEditor` và mất state `open`/draft. Item còn dùng key theo index.

**Cách fix**: chỉ render placeholder ở lần tải đầu khi chưa có `precheck`; refresh nền giữ nguyên
panel cũ cho tới khi dữ liệu mới về. Dùng key ổn định theo `side-field` cho từng gap.

**File liên quan**: `ContractCopilotParts.tsx`. Main + 4 clone.

## 29. AI Review báo Khớp tên công ty Bên A nhưng bản AI Highlight không tô tên công ty

**Triệu chứng**: comparison nhận diện đúng và trả verdict `match`, nhưng tên công ty khách hàng
không có vùng tô vàng trong DOCX/PDF Highlight.

**Nguyên nhân gốc**: `sourceExcerpt` dùng cả block từ nhãn Bên A tới tên công ty; block có thể bắc
qua paragraph/cell hoặc khác separator so với đơn vị tìm kiếm của highlighter, nên exact match thất
bại dù `party_a_name` đã đúng.

**Cách fix**: dùng chính tên công ty đã trích xuất làm excerpt/neo ngắn, đúng vùng người dùng cần
tô; bump `RULES_VERSION` để review cache cũ được sinh lại. Có test tạo DOCX hai paragraph và xác
nhận field `company_name` nằm trong `meta.located`.

**File liên quan**: `contract_ocr_service.py`, `test_contract_ocr_docx.py`. Main + 4 clone.

## 30. Bấm "Chỉnh sửa (Word)" chạy rồi trở lại như cũ nhưng không hiện lỗi

**Triệu chứng**: trong tab Đối chiếu báo giá (AI), bấm "Chỉnh sửa (Word)" thì nút đổi sang
"Đang mở…" trong chốc lát rồi trở lại trạng thái cũ; người dùng không thấy thông báo nào và tưởng
nút không hoạt động. Lỗi `_rsc` 404 của route menu có thể xuất hiện cùng lúc nhưng không liên quan.

**Nguyên nhân gốc**: `startEditor()` đã bắt lỗi khởi tạo phiên Word và lưu vào `editorError`, nhưng khi
đã có dữ liệu AI Review, thông báo này chỉ được render bên trong `.word-editor-shell`. Shell đó dùng
`display:none` khi khởi tạo thất bại vì `view` vẫn là `original`/`highlight`, nên lỗi backend hoặc cấu
hình OnlyOffice bị che hoàn toàn.

**Cách fix**: render thêm alert lỗi ngay dưới thanh tab khi `view !== 'editor'`, kèm nút "Thử lại".
Thông báo trong editor vẫn được giữ nguyên cho các lỗi xảy ra sau khi editor đã mở. Không đổi API,
session hay luồng lưu tài liệu.

**File liên quan**: `modules/contracts/components/ContractAiReviewPanel.tsx`. Main + 3 clone.

## 31. Word Editor chạy ở dev nhưng production không mở được

**Triệu chứng**: bấm "Chỉnh sửa (Word)" trên `crm.markee.vn` không mở editor; API khởi tạo phiên
thất bại hoặc trình duyệt không tải được `api.js`. Có lúc iframe Word đã tải lại thành công nhưng
cảnh báo lỗi của lần tải trước vẫn còn trên màn hình.

**Nguyên nhân gốc**: production chưa có container OnlyOffice, thiếu `ONLYOFFICE_JWT_SECRET`, và
`ONLYOFFICE_PUBLIC_URL` mặc định trỏ `localhost` nên sai với trình duyệt người dùng. Document Server
cũng chưa được reverse proxy qua HTTPS. Sau khi một lần tải lỗi rồi hồi phục, `onError` đã set lỗi
nhưng `onDocumentReady` không xoá cảnh báo cũ.

**Cách fix**: tạo JWT riêng và dùng cùng giá trị cho backend/Document Server; cấu hình URL nội bộ
`http://onlyoffice:80`, URL công khai `https://crm.markee.vn/onlyoffice-ds`; chạy OnlyOffice trong
cùng Docker network với stack `crm-markee`; reverse proxy virtual path với `X-Forwarded-Host` và
WebSocket headers. Frontend xoá riêng cảnh báo OnlyOffice cũ khi nhận `onDocumentReady`, không xoá
cảnh báo chuyển đổi PDF. Production đã được kiểm tra: health/API script/plugin config đều HTTP 200,
backend và OnlyOffice healthy, draft DOCX tải 200 và callback status 1 nhận thành công.

**File liên quan**: `nginx-router/nginx.conf`, `crm-module/nginx/nginx.conf`,
`crm-cloudgate/nginx/nginx.conf`, `crm-securityzone/nginx/nginx.conf`,
`modules/contracts/components/ContractAiReviewPanel.tsx`. Main + 3 clone.

## 32. Lệch tiền khi nhập giảm giá báo giá bằng số tiền cố định (VNĐ)

**Triệu chứng**: khi nhập giảm giá báo giá bằng số tiền VNĐ cố định (ví dụ giảm 4.971.200 đ từ tổng
34.971.200 đ), giá khách sau chiết khấu hiển thị `29.999.420 đ` thay vì con số chẵn tròn `30.000.000 đ`.

**Nguyên nhân gốc**: hệ thống quy đổi số tiền giảm VNĐ sang tỷ lệ `%` làm tròn 2 chữ số lẻ (14.22%),
sau đó lấy giá bán nhân ngược lại với `%` đã làm tròn (`subtotal * discountPercent / 100`) để trừ ra số
tiền giảm thực tế. Sai số làm tròn của phép chia và nhân ngược làm mất đi số tiền chính xác đã nhập.

**Cách fix**:
- Frontend (`QuoteWorkspaceModal.tsx`, `quoteCalculations.ts`, `quoteCurrency.ts`, `QuoteDocumentRenderer.tsx`,
  `QuoteFormFiller.tsx`, `InternalQuoteWorkspacePage.tsx`): giữ nguyên số tiền giảm cố định VNĐ
  (`discountAmount` / `overallDiscountAmount`) làm giá trị tính toán thương mại chính; `%` chỉ dùng làm
  nhãn hiển thị tham chiếu. Khi phân bổ giảm giá cố định xuống từng hạng mục, phân bổ chính xác theo tỷ trọng
  giá bán và bù chênh lệch phần dư (penny remainder) vào dòng cuối để đảm bảo tổng số tiền giảm bằng đúng số VNĐ đã nhập.
- Backend (`schemas/quote.py`, `routers/quote.py`, `supabase_quote_service.py`): bổ sung field `discount_amount`
  vào schema `QuoteItemPayload` / `QuoteItemCreate` và model tính toán; helper `_sync_computed_item_discounts_and_totals`
  và `_flatten_computed_items` ưu tiên trừ trực tiếp `discount_amount` nếu có, đảm bảo tổng sau giảm, lợi nhuận và
  dữ liệu lưu vào database khớp chính xác tuyệt đối.

**File liên quan**: `modules/quotes/types/index.ts`, `modules/quotes/utils/quoteCalculations.ts`,
`modules/quotes/utils/quoteCurrency.ts`, `modules/quotes/components/QuoteDocumentRenderer.tsx`,
`modules/quotes/components/QuoteFormFiller.tsx`, `modules/crm/components/QuoteWorkspaceModal.tsx`,
`modules/quotes/repositories/SeedingQuoteRepository.ts`, `app/modules/all_platform/schemas/quote.py`,
`app/modules/all_platform/routers/quote.py`, `app/modules/all_platform/services/supabase_quote_service.py`,
`tests/test_quote_discount_precision.py`. Main + 3 clone.

## 33. Precheck hợp đồng báo thiếu Người đại diện Bên B nhưng form inline không có ô nhập

**Triệu chứng**: trong bước 1 Precheck của AI Contract Copilot, hệ thống cảnh báo thiếu "Người đại diện Bên B"
và "Chức vụ người đại diện Bên B", nhưng khi bấm "Bổ sung thông tin ↗", modal/inline editor chỉ hiển thị
các ô: Tên pháp lý, Mã số thuế, Địa chỉ, Điện thoại, Email, hoàn toàn không có chỗ điền Người đại diện và Chức vụ.

**Nguyên nhân gốc**:
- Backend endpoint `/contracts/precheck-issuer` trả về thông tin đơn vị phát hành (`issuer_out`) nhưng
  bỏ sót trường `contactName` (hoặc `contact_name`), `positionCategoryId` và `positionLabel`.
- Type `PrecheckIssuer` trên frontend thiếu định nghĩa các trường này.
- Component `IssuerInlineEditor` và `LegalInfoEditor` trong `ContractCopilotParts.tsx` chỉ bind 5 trường
  cơ bản mà không tích hợp input Người đại diện và `PositionSelect` (danh mục chức vụ) cho đơn vị phát hành.

**Cách fix**:
- Backend (`routers/contract.py`): bổ sung `contactName`, `positionCategoryId`, `positionLabel` vào payload
  trả về của `_issuer_to_dict`.
- Frontend (`contractDocs.ts`, `ContractCopilotParts.tsx`): mở rộng `PrecheckIssuer`, cập nhật `LegalInfoEditor`
  hỗ trợ hiển thị và cập nhật `contactName` cùng `PositionSelect` khi sửa Bên B (hoặc `onlySection="rep"`),
  đồng thời bổ sung input Người đại diện và chọn Chức vụ vào `IssuerInlineEditor`.

**File liên quan**: `app/modules/all_platform/routers/contract.py`,
`modules/contracts/repositories/contractDocs.ts`,
`modules/crm/integrations/contracts/ContractCopilotParts.tsx`. Main + 3 clone.

## 34. AI Contract Copilot DOCX vỡ format: lặp text 1 ký tự/dòng trang 1 & bảng tổng hợp vỡ trang/co cột

**Triệu chứng**: hợp đồng mẫu gốc 9 trang sau khi AI Copilot điền dữ liệu và xuất PDF nở thành 14 trang:
1. Trang 1: Bên A lặp lại Mã số thuế và Địa chỉ 2 lần; lần 2 bị bóp nghẹt thành cột thẳng đứng 1 ký tự/dòng.
2. Trang 6–7: Bảng 1.2 "Bảng tổng hợp giá trị Hợp đồng" bị co cột, phát sinh dòng trống ở đầu, xóa mất các dòng
   Phần B, ghi số tiền VAT vào dòng "Không chịu thuế", và bị chia cắt giữa trang 6 và trang 7.

**Nguyên nhân gốc**:
1. Lỗi lặp text trang 1: Bảng thông tin các bên trong mẫu DOCX (CloudGate) có cấu trúc 3 cột `[Nhãn | : | Giá trị]`,
   trong đó cột 2 chứa dấu hai chấm rộng chỉ 142 dxa (~2.5mm). Hàm `_find_party_target_cell` trước đây coi bảng
   nhiều hơn 1 cột là `[Nhãn | Giá trị]` nên gán ô target là `tcs[1]` (cột dấu hai chấm) thay vì `tcs[2]`. Toàn bộ
   chuỗi MST và Địa chỉ bị nhồi vào ô 2.5mm gây xuống dòng từng ký tự; đồng thời ô nhãn `tcs[0]` vẫn chứa nhãn gốc
   khiến thông tin hiển thị lặp đôi.
2. Lỗi bảng tổng hợp giá trị:
   - `find_items_table` quét bảng đầu tiên có từ khóa "stt", "mô tả", "thành tiền", vô tình chọn nhầm Bảng 1.2
     (bảng tổng hợp 3 cột `[STT | Khoản mục | Thành tiền]`) làm bảng chi tiết hạng mục, xóa các hàng mẫu
     (Phần A, Phần B, VAT) để điền chi tiết sản phẩm.
   - Hàm `totals_kind` nhận diện nhãn "Thuế GTGT: Không chịu thuế" là dòng `vat` nên ghi đè tiền thuế 79.200 đ vào đó;
     đồng thời regex subtotal nhận diện `"trọn gói 01 tháng"` thành subtotal phần.
   - DOCX chưa cấu hình cấm chia cắt dòng bảng qua trang (`<w:cantSplit/>`) và giữ dòng tiêu đề/tổng cộng đi liền
     khối (`<w:keepNext/>`).

**Cách fix**:
- `_find_party_target_cell`: phân biệt chính xác bảng 3 cột (target = `tcs[2]`) và bảng 2 cột inline (`tcs[0]` chứa
  cả `Nhãn : Giá trị`, chỉ thay thế phần text sau dấu `:` mà không chạm `tcs[1]`).
- `find_items_table`: ưu tiên chọn bảng chi tiết hàng hóa dịch vụ (có các cột đặc thù như đơn giá `unit_price`,
  số lượng `qty`, đơn vị tính `unit`). Nếu có bảng tổng hợp riêng, để nguyên cấu trúc hàng của nó và chỉ cập nhật
  giá trị vào các ô tương ứng qua `_fill_other_summary_tables`.
- `totals_kind`: loại trừ rõ ràng các nhãn "không chịu thuế", "miễn thuế"; neo chặt regex phân biệt subtotal phần
  `^\s*(?:cong|tong)\s+(?:phan|muc|nhom|goi)\s+[a-z0-9]` với dòng tổng cộng toàn hợp đồng.
- Bơm thuộc tính WordprocessingML `<w:cantSplit/>` vào mọi hàng bảng và `<w:keepNext/>` vào các hàng tổng cộng để
  chống ngắt trang tách dòng khi convert sang PDF.

**File liên quan**: `app/modules/all_platform/services/contract_docx_engine.py`,
`tests/test_contract_docx_engine.py`, `tests/test_contract_docx_format_fixes.py`. Main + 3 clone.

## 35. Tích hợp chỉnh sửa Word trực tiếp (OnlyOffice) vào bước 3 AI Contract Copilot

**Triệu chứng**: người dùng soạn hợp đồng bằng AI Copilot cần sửa đổi trực tiếp trên định dạng Word (DOCX)
giữ nguyên định dạng, bảng biểu, font chữ mà không cần tải về máy sửa offline rồi upload lại.

**Giải pháp**:
- Bổ sung tab **Chỉnh sửa (Word)** trực tiếp trong Bước 3 ("Xem trước & hoàn thiện") của `ContractAIWizard.tsx`,
  nằm ngay cạnh tab **Xem trước tài liệu** khi ở chế độ tạo theo mẫu (`mode === 'template'`).
- Tái sử dụng bridge OnlyOffice Document Server đã hoàn thiện ở module AI Contract Review (`startEditSession`,
  `saveEditVersion`, `checkEditSession`, `forceSaveEditSession` qua route `/contracts/{id}/edit/*`).
- Tự động lưu nháp hợp đồng lên DB nếu đang ở trạng thái soạn thảo tạm trước khi mở phiên chỉnh sửa Word.
- Hỗ trợ lưu nháp, autosave tự động với badge trạng thái đồng bộ (`✓ Đã đồng bộ` / `● Có thay đổi chưa lưu`),
  nút "Lưu & cập nhật xem trước" và tự động flush phiên Word khi chuyển sang tab xem trước hoặc rà soát rủi ro.
- Khi người dùng bấm **Gửi duyệt**, tự động flush phiên Word hiện tại thành phiên bản hợp đồng chính thức mới nhất
  để gửi phê duyệt pháp lý. Không ghi đè lên file mẫu gốc của hệ thống.

**File liên quan**: `modules/crm/integrations/contracts/ContractAIWizard.tsx`,
`modules/crm/integrations/contracts/copilot.css`,
`modules/contracts/components/useWordEditorBridge.ts`,
`app/modules/all_platform/routers/contract_edit.py`. Main + 3 clone.

## 36. Email Omnichannel hiển thị dữ liệu mẫu, mất sau restart và báo gửi thành công giả

**Triệu chứng**: tab Email trong Hộp thư đa kênh lấy hội thoại mẫu từ bộ nhớ tiến trình; reload/restart có thể
mất dữ liệu. API Email chưa bắt buộc đăng nhập và chưa cách ly workspace đầy đủ. Khi SMTP lỗi, luồng cũ có thể
rơi về chế độ giả lập nhưng vẫn trả trạng thái `delivered`, khiến giao diện báo gửi thành công dù thư không rời hệ thống.

**Nguyên nhân gốc**:
- Email inbox dùng store trong RAM và fixture thay vì bảng dữ liệu bền vững.
- Chưa có IMAP cursor/UIDVALIDITY để đồng bộ thư đến, chưa lưu attachment và threading vào database.
- Route Email không áp dụng đồng nhất dependency xác thực/quyền; endpoint simulate chưa được khóa theo môi trường.
- SMTP fallback nuốt lỗi kết nối/xác thực và tạo lịch sử gửi giả.

**Cách fix**:
- Thay store trong RAM bằng các bảng `omnichannel_email_threads`, `omnichannel_email_messages`,
  `omnichannel_email_attachments`, `omnichannel_email_sync_state`; mọi truy vấn đều bắt buộc lọc `instance`.
- Đồng bộ IMAP theo UID cursor, parse MIME/UTF-8, lưu attachment vào bucket private; gửi/reply SMTP thật với
  `Message-ID`, `In-Reply-To`, `References` và attachment. Chỉ ghi message outbound sau khi SMTP chấp nhận.
- Tất cả Email API dùng authentication + quyền module Customer; sync/simulate chỉ admin/leader, và simulate chỉ
  hoạt động khi Dev đặt `EMAIL_ALLOW_SIMULATE_INCOMING=1`.
- Tách scheduler IMAP bằng `EMAIL_IMAP_SYNC_ENABLED`; credential lấy từ cấu hình Email Provider đã mã hóa,
  không đưa secret vào response hoặc source.
- Nút đính kèm trên composer gửi nội dung file thật (base64, giới hạn 20 MB/file và 25 MB/email) sang SMTP;
  UI chỉ thêm message và xóa nội dung soạn sau khi SMTP trả thành công, không optimistic `sent` khi request lỗi.

**File liên quan**: `app/modules/all_platform/email/`,
`app/modules/all_platform/jobs/email_imap_sync_job.py`, `app/modules/all_platform/services/quote_email_provider_service.py`,
`app/main.py`, `supabase/migrations/201_omnichannel_email_inbox.sql`,
`modules/omnichannel/repositories/OmnichannelRepository.ts`, `tests/test_email_inbox_real.py`. Main + 4 clone,
bao gồm `crm-timetech` (port và build Dev ngày 2026-10-29).

**Trạng thái kiểm thử thực tế**: code/unit/typecheck/build Docker đạt; E2E nhận → đọc → reply → xác minh mailbox
đích → restart vẫn còn dữ liệu đang **BLOCKED** cho tới khi migration Dev được chạy và cung cấp credential IMAP/SMTP
riêng cho Markee, CloudGate, SecurityZone, Timetech. Không được đổi trạng thái mục này thành PASS chỉ bằng mock/simulate.

## 37. Đồng bộ giảm giá VNĐ/% trên báo giá CRM và Hoàn thiện kết nối Email Inbox Omnichannel

**Triệu chứng**:
1. Khi chọn giảm giá VNĐ và nhập số tiền giảm trên báo giá, chip hiển thị trên dòng hạng mục bị quy đổi ngược ra % (ví dụ: "Giảm 14.58%") thay vì hiển thị "Giảm X đ". Khi lưu và mở lại hoặc xuất bản khách hàng / PDF, số tiền có thể bị làm tròn sai lệch do chuyển đổi qua lại giữa % và số tiền.
2. Modal "+ Kết nối tài khoản" trong Omnichannel Inbox thiếu kênh Email Inbox, dù sidebar đã có tab Email Inbox. Chưa hỗ trợ luồng chọn kết nối qua OAuth (Google Workspace / Microsoft 365) và IMAP/SMTP phân tách theo workspace (Markee: `admin@markee.vn`, CloudGate: `sale@getcloudgate.com`).

**Nguyên nhân gốc**:
1. `QuoteItem` và `QuoteData` trong types và state trước đây chủ yếu lưu `discountPercent` và tính ngược `discountAmount = amount * (discountPercent / 100)`. Khi người dùng nhập số tiền VNĐ, code quy đổi sang % rồi lưu `discountPercent`. Bảng tóm tắt, xuất PDF (`QuoteDocumentRenderer.tsx`), `InternalQuoteWorkspacePage.tsx` và backend `supabase_quote_service.py` thiếu trường `discountType` ('percent' | 'amount') cho từng hạng mục và `overallDiscountType` cho toàn bộ báo giá, khiến số tiền giảm bị làm tròn trôi nổi và chip hiển thị ép theo `%`.
2. Modal kết nối tài khoản (`ConnectAccountMockModal` trong `OmnichannelMockModals.tsx`) chỉ có Facebook, Zalo, WhatsApp, chưa cấu hình kênh `email` trong `activeChannels`. Thiếu component modal chuyên biệt xử lý các bước kết nối Email Inbox (chọn loại nhà cung cấp, OAuth theo workspace, cấu hình IMAP/SMTP).

**Cách fix**:
1. Cập nhật `modules/quotes/types/index.ts` bổ sung `discountType?: 'percent' | 'amount'` cho `QuoteItem`, `overallDiscountType?: 'percent' | 'amount'` và `itemDiscountTypes` cho `QuoteData` & `Quote`.
2. Bổ sung `resolveItemDiscountMode(item, currency)` trong `QuoteWorkspaceModal.tsx` để nhận diện chính xác kiểu giảm giá không đoán mò trên dữ liệu cũ. Cập nhật `commitRowDiscount` và `commitRowDiscountAmount` ghi nhận tường minh `discountType`.
3. Cập nhật chip giảm giá hiển thị "Giảm X đ" khi ở chế độ tiền mặt VNĐ và "Giảm Y%" khi ở chế độ %. Cập nhật `QuoteDocumentRenderer.tsx` (bản xem khách hàng & PDF) hiển thị đúng số tiền `-${formatVnd(discountAmt)}` và nhãn `Giảm giá tổng` không kèm `%` khi giảm theo VNĐ.
4. Cập nhật `supabase_quote_service.py` trên backend hỗ trợ `discount_type == "amount"`, giữ chính xác số tiền giảm trong DB và phục hồi `itemDiscountTypes` / `overallDiscountType`.
5. Xây dựng component `EmailConnectModal.tsx` (`modules/omnichannel/components/EmailConnectModal.tsx`) tích hợp vào Omnichannel Inbox: hỗ trợ chọn nhà cung cấp (Google Workspace, Microsoft 365, IMAP/SMTP), xác thực OAuth với tài khoản chuẩn theo workspace (`admin@markee.vn` cho Markee, `sale@getcloudgate.com` cho CloudGate), và form cấu hình IMAP/SMTP thủ công. Thêm Email vào danh sách kết nối trong `ConnectAccountMockModal` và hiển thị trạng thái tài khoản kết nối trực tiếp dưới nhánh Email Inbox trên `ChannelScopePane`.

**File liên quan**:
`modules/quotes/types/index.ts`, `modules/quotes/utils/quoteCalculations.ts`, `modules/crm/components/QuoteWorkspaceModal.tsx`, `modules/quotes/components/QuoteDocumentRenderer.tsx`, `modules/quotes/components/InternalQuoteWorkspacePage.tsx`, `linkedin_group_crawler/app/modules/all_platform/services/supabase_quote_service.py`, `modules/omnichannel/components/EmailConnectModal.tsx`, `modules/omnichannel/components/OmnichannelMockModals.tsx`, `modules/omnichannel/components/OmnichannelInboxView.tsx`, `modules/omnichannel/components/ChannelScopePane.tsx`, `modules/omnichannel/constants/channelCapabilities.ts`, `modules/omnichannel/mockOmnichannelData.ts`. Đã port sang main + 4 clone (`crm-module`, `crm-cloudgate`, `crm-securityzone`, `crm-timetech`).

## 38. Nhân bản hạng mục đổi SL không đổi giá, ô Giảm giá toàn báo giá VNĐ bị load lại khi gõ, thiếu ô fill Thuế GTGT và sai tiền giảm trên PDF

**Triệu chứng**:
1. Nhân bản một hạng mục xuống dòng dưới, sau đó sửa số lượng (SL) từ 5 xuống 4 thì cột Thành tiền / Cost tổng không đổi (vẫn giữ nguyên 2.750.000 đ của 5 cái thay vì 2.200.000 đ của 4 cái).
2. Khi bật "Giảm giá toàn báo giá" sang chế độ VNĐ, người dùng vừa gõ chữ số đầu tiên (ví dụ gõ '4') thì ô nhập bị giật / load lại và reset về %, mất con trỏ và không gõ tiếp được.
3. Báo giá chưa có công cụ để fill nhanh Thuế GTGT (VAT %) cho tất cả hoặc các hạng mục đã chọn (phải bấm sửa từng dòng thủ công).
4. Nhập giảm giá tổng báo giá là 4.971.200 VNĐ nhưng khi xem bản in / xuất PDF lại hiển thị "-4.518.514 đ (12.95%)" và in trùng lặp 2 dòng giảm giá.

**Nguyên nhân gốc**:
1. `resolveQuoteItemCostTotal` trong `QuoteWorkspaceModal.tsx` ưu tiên đọc `item.costTotal` trước `item.costPrice`. Khi nhân bản (`duplicateItemRow`), `source.costTotal` bị sao chép sang dòng mới. Khi người dùng đổi `quantity`, dòng mới vẫn giữ `costTotal` cũ nên hàm trả về giá trị cũ thay vì tính `costPrice * quantity`. Đồng thời `duplicateItemRow` và `updateRow` khi đổi SL không xóa các trường cached `costTotal`, `totalAmount`.
2. Khi người dùng bấm nút đổi chế độ sang VNĐ, chỉ cập nhật state tạm `overallDiscountInputMode` mà không cập nhật `quote.data.overallDiscountType`. Khi gõ phím đầu tiên, `CurrencyInput.onChange` kích hoạt `setQuote`, làm `useEffect` (vốn phụ thuộc `quote?.data?.overallDiscountAmount`) chạy lại. Do `quote.data.overallDiscountType` vẫn là `percent`, hook tự động ép `overallDiscountInputMode` quay ngược lại `percent`, làm component `CurrencyInput` bị unmount và thay bằng input number, tạo cảm giác bị "load lại" và mất dữ liệu vừa gõ.
3. Thanh công cụ thương mại (commercial quickbar) chỉ có khối "Giảm giá hạng mục" và "Giảm giá toàn báo giá", hoàn toàn thiếu ô nhập và nút áp dụng cho Thuế GTGT (VAT %).
4. Trong `QuoteWorkspaceModal.tsx`, `persistQuote` sử dụng `baseData?.overallDiscountType ?? overallDiscountInputMode`, do đó nếu dữ liệu cũ có `overallDiscountType = 'percent'` thì luôn ghi đè thành `percent`. Khi sang `QuoteDocumentRenderer.tsx` và `quoteCalculations.ts`, do `overallDiscountType === 'percent'`, hệ thống lấy `overallDiscountPercent` (12.95% - vốn là kết quả quy đổi làm tròn từ 4.971.200 / 34.892.000) nhân ngược lại với tổng tiền, ra 4.518.514 đ thay vì giữ đúng 4.971.200 đ. Đồng thời, cả `overallDiscount` và `totalDiscount` đều được render dù có cùng giá trị, dẫn tới in 2 dòng giảm giá trùng lặp.

**Cách fix**:
1. Trong `QuoteWorkspaceModal.tsx`:
   - `resolveQuoteItemCostTotal`: Ưu tiên tính động `Math.max(0, costPrice) * quantity * multiplier` khi `costPrice != null`; chỉ fallback về `costTotal` khi không có `costPrice`.
   - `duplicateItemRow`: Xóa sạch `id`, `costTotal`, `totalAmount`, `amountAfterDiscount`, `vatAmount` khi nhân bản để đảm bảo dòng mới luôn tính lại tươi mới.
   - `updateRow`: Khi sửa SL (`quantity`), xóa `costTotal` và `totalAmount` cached.
2. Ổn định ô nhập giảm giá toàn báo giá:
   - Sửa `useEffect` khởi tạo chế độ giảm giá chỉ chạy khi `quote?.id` đổi, không chạy lại theo từng phím gõ. Tự động nhận diện `amount` nếu có `overallDiscountAmount > 0` và percent có số thập phân lẻ.
   - Nút toggle chế độ (VNĐ / %) cập nhật đồng thời cả `overallDiscountInputMode` và `quote.data.overallDiscountType`.
   - `CurrencyInput.onChange` luôn kèm `overallDiscountType: 'amount'`, input % luôn kèm `overallDiscountType: 'percent'`.
   - `persistQuote` lưu `overallDiscountType: overallDiscountInputMode` một cách nhất quán.
3. Thêm công cụ fill nhanh Thuế GTGT:
   - Thêm ô "Thuế GTGT (%) [ 10 ]" cùng 2 nút "Áp mục đã chọn" và "Áp tất cả mục" trên quickbar thương mại.
   - Hàm `applyBulkVat(scope)` áp dụng tỷ lệ VAT đã nhập cho phạm vi được chọn, tự động tính lại tổng thuế và lưu báo giá.
4. Sửa bản in PDF & xem trước khớp đúng 100% Ảnh 5:
   - `quoteCalculations.ts` (`calculateOverallDiscountSummary`): Khi có `overallDiscountAmountInput > 0` và chế độ là `amount` (hoặc percent có phần thập phân lẻ `pct % 1 !== 0`), luôn giữ chính xác số tiền giảm cố định (4.971.200 đ), không nhân ngược từ % làm tròn.
   - `QuoteDocumentRenderer.tsx`: Bổ sung nhận diện `isOverallDiscountAmount` tự động khi `overallDiscountAmount > 0` và percent lẻ. Hiển thị "Giá gốc trước giảm" khi có giảm giá, chỉ hiện 1 dòng "Tổng tiền giảm: -4.971.200 đ" khi không có chiết khấu riêng từng dòng (tránh in trùng 2 dòng giảm giá), dòng "Tổng sau giảm giá", dòng "Thuế GTGT: 79.200 đ" và "Tổng thanh toán: 30.000.000 đ" giống hệt Ảnh 5.
   - Backend `supabase_quote_service.py` (`_row_to_quote`): Tự động nhận diện `overallDiscountType = 'amount'` khi có `overallDiscountAmount > 0` và percent lẻ.

**File liên quan**:
- `modules/crm/components/QuoteWorkspaceModal.tsx`
- `modules/quotes/components/QuoteDocumentRenderer.tsx`
- `modules/quotes/utils/quoteCalculations.ts`
- `linkedin_group_crawler/app/modules/all_platform/services/supabase_quote_service.py`
- `linkedin_group_crawler/tests/test_quote_discount_precision.py`
- Đã đồng bộ sang toàn bộ 4 clone repo (`crm-module`, `crm-cloudgate`, `crm-securityzone`, `crm-timetech`).

## 39. Quickbar báo giá bị đè/chèn UI, Thuế GTGT cho nhập VNĐ và tùy chọn kết nối Gmail cá nhân bị chìm

**Triệu chứng**:
1. Trên thanh công cụ thương mại (commercial quickbar) của `QuoteWorkspaceModal`, các nút "Áp mục đã chọn" và "Áp tất cả mục" của Thuế GTGT bị chèn ép, đè lấn sang ô "Giảm giá toàn báo giá" (các nút bị dính vào nhau).
2. Thuế GTGT chỉ cho nhập % mà chưa hỗ trợ nhập số tiền VNĐ và quy đổi phân bổ đều cho các hạng mục như ô Giảm giá hạng mục.
3. Người dùng vào modal "+ Kết nối tài khoản" (Email Inbox) ở Bước 1 chỉ thấy Google Workspace (OAuth), Microsoft 365 và "IMAP/SMTP (Dành cho email hosting riêng)", không thấy chỗ kết nối Gmail cá nhân của mình để test gửi/nhận riêng ("có thấy đâu bro").

**Nguyên nhân gốc**:
1. `.qc-workspace-commercial-row` trong `quote-center.css` chỉ bật `flex-wrap: wrap` ở media query mobile `@media (max-width: 767px)`, trên desktop/laptop dùng `nowrap` mặc định. Khi thêm cụm công cụ Thuế GTGT, tổng chiều rộng vượt quá container khiến các phần tử flex bị co rút (shrink) và text của nút này đè lên input của ô kia.
2. `bulkVatInput` trong `QuoteWorkspaceModal.tsx` chỉ có 1 state kiểu chuỗi cho %, hàm `applyBulkVat` chỉ gán trực tiếp `vatRate` từ số % mà chưa có chế độ `amount` (VNĐ) và nút toggle `% / VNĐ`. Đồng thời `calculateItemVat` trong `quoteCalculations.ts` chỉ tính từ `subtotal * vatRate / 100` mà chưa ưu tiên giá trị `vatAmount` đã lưu.
3. Trong `EmailConnectModal.tsx`, tùy chọn "Sử dụng tài khoản khác" trước đây bị giấu ở Bước 2/Bước 4 của luồng Google Workspace OAuth thay vì hiển thị trực tiếp ngay Bước 1 (chọn provider). Do đó người dùng mở modal lên không biết bấm vào đâu để kết nối Gmail cá nhân với Mật khẩu ứng dụng (App Password).

**Cách fix**:
1. Sửa CSS layout quickbar (`quote-center.css`):
   - Đặt `flex-wrap: wrap; row-gap: 12px; column-gap: 14px;` cho `.qc-workspace-commercial-row` trên mọi màn hình.
   - Định nghĩa `.qc-item-discount-tools`, `.qc-item-vat-tools`, `.qc-overall-discount-tools` với `display: inline-flex; flex-wrap: wrap; gap: 8px; flex-shrink: 0;`.
   - Đặt `flex-shrink: 0; white-space: nowrap;` cho `.qc-workspace-quickbar-field` và `.qc-mini-btn`, đảm bảo các nút và nhãn không bao giờ bị co rúm hay đè lên nhau.
2. Thêm chế độ nhập VNĐ cho Thuế GTGT:
   - Thêm state `bulkVatInputMode` (`'percent' | 'amount'`).
   - Trên quickbar: Render `CurrencyInput` khi ở mode `amount` và input number khi ở mode `percent`, kèm nút bấm toggle `qc-price-mode-toggle` (`% / VNĐ`) giống hệt Giảm giá hạng mục.
   - Cập nhật `applyBulkVat(scope)`: Khi ở mode `amount`, tính tổng tiền sau chiết khấu của các dòng trong phạm vi, phân bổ số tiền VAT chính xác xuống từng dòng theo tỷ trọng (dòng dương cuối cùng nhận phần dư làm tròn để tổng VAT khớp tuyệt đối với số tiền đã nhập), gán cả `vatRate` và `vatAmount`. Khi sửa VAT tay trên bảng thì xóa `vatAmount` để ưu tiên `vatRate`.
   - Cập nhật `calculateItemVat` (`quoteCalculations.ts`): Ưu tiên `item.vatAmount` nếu có giá trị số hợp lệ, đồng bộ chuẩn xác với `calculateItemDiscount`.
3. Đưa kết nối Gmail cá nhân lên vị trí số 1 tại Bước 1 (`EmailConnectModal.tsx`):
   - Bổ sung ngay thẻ đầu tiên: "Gmail / Email cá nhân bất kỳ (Test riêng)" - "Kết nối Gmail bằng App Password để test gửi & nhận riêng".
   - Bấm vào mở thẳng form IMAP/SMTP với thông số chuẩn Gmail (`imap.gmail.com:993`, `smtp.gmail.com:587`), xóa trắng trường người dùng và có sẵn link tới Google App Passwords.
   - Đổi tên thẻ IMAP thành "Email máy chủ khác (IMAP / SMTP)" để phân biệt rõ ràng.

**File liên quan**:
- `modules/omnichannel/components/EmailConnectModal.tsx`
- `modules/crm/components/QuoteWorkspaceModal.tsx`
- `modules/crm/styles/quote-center.css`
- `modules/quotes/utils/quoteCalculations.ts`
- `thao/CRM_KNOWN_BUGS_FIXED.md`

## 40. Thuế GTGT nhập VNĐ bị trừ giảm giá lần 2 (68.818 thay vì 79.200 VNĐ) khi có giảm giá toàn báo giá

**Triệu chứng**:
Nhập Thuế GTGT 79.200 VNĐ, bấm "Áp tất cả mục". Báo giá có giảm giá toàn báo giá 4.971.200 VNĐ (~14.25%).
Ở khối tổng kết dưới cùng:
- "Tổng sau giảm giá: 29.920.800"
- "THUẾ GTGT: 68.818" (bị trừ lệch mất 10.382 VNĐ!)
- "Tổng thanh toán: 29.989.618" (thay vì tròn 30.000.000 VNĐ).

**Nguyên nhân gốc**:
1. Trong `calculateOverallDiscountSummary` (`quoteCalculations.ts`), công thức tính VAT sau chiết khấu là:
   `vatAfterDiscount = roundFor(totals.totalVatAmount * (1 - effectiveRatio), currency)`.
   Khi nhập % thuế VAT, công thức này đúng vì chiết khấu tổng làm giảm doanh thu trước VAT. Tuy nhiên, khi người dùng nhập số tiền VAT cố định bằng VNĐ (e.g. 79.200 VNĐ), số tiền đó chính là số tiền VAT thực tế cuối cùng mong muốn. Việc nhân tiếp với `(1 - effectiveRatio)` đã áp chiết khấu tổng vào thuế VAT lần thứ 2!
2. Trong `applyBulkVat` (`QuoteWorkspaceModal.tsx`): 79.200 chia 34.892.000 ra 0.22698%, `clampDiscountPercent` làm tròn thành 0.23% (tương đương 80.252 VNĐ). Sau đó bị nhân tiếp với `(1 - 0.142474)` ra đúng `68.818 VNĐ`.
3. Backend RPC `quote_update` và hàm `_sync_computed_item_discounts_and_totals` trong `supabase_quote_service.py` chỉ đồng bộ fixed discount mà chưa kiểm tra fixed `vat_amount` của từng dòng và `quote.data.vatAmount`, dẫn đến `vat_amount` bị DB recalculate lại theo tỷ lệ % làm tròn.

**Cách fix**:
1. `modules/quotes/utils/quoteCalculations.ts`:
   - Mở rộng `calculateOverallDiscountSummary` nhận thêm `vatAmountInput` và `vatType`.
   - Khi ở chế độ VAT tiền cố định (`vatType === 'amount'` hoặc `vatAmountInput >= 0`), giữ nguyên chính xác `vatAfterDiscount = vatAmountInput ?? totals.totalVatAmount`, không nhân qua `(1 - effectiveRatio)`.
2. `modules/quotes/components/QuoteDocumentRenderer.tsx`:
   - Truyền `quoteData.vatAmount` và `quoteData.vatType` vào `calculateOverallDiscountSummary`.
3. `modules/crm/components/QuoteWorkspaceModal.tsx`:
   - Trong `applyBulkVat`: Khi `bulkVatInputMode === 'amount'`, lưu đồng thời `vatAmount: totalVatTarget` và `vatType: 'amount'` vào `quote.data`, persist lên backend và gán `vatAmount` cho từng dòng item.
   - Cập nhật `paymentPlanFinalPayable` và `liveCommercialSummary` truyền `effectiveVatAmount` và `effectiveVatType` vào `calculateOverallDiscountSummary`.
   - Thêm `bulkVatInput` và `bulkVatInputMode` vào dependencies của `liveCommercialSummary`.
   - Khôi phục `bulkVatInputMode` và `bulkVatInput` từ `quote.data.vatAmount` / `quote.data.vatType` khi tải báo giá.
4. `modules/quotes/types/index.ts`:
   - Thêm trường `vatAmount?: number | null;` và `vatType?: 'percent' | 'amount' | null;` vào `QuoteData` interface.
5. `linkedin_group_crawler/app/modules/all_platform/services/supabase_quote_service.py`:
   - `_calculate_item`: Nhận `vat_amount`, ưu tiên `_to_decimal(vat_amount)` khi `>= 0`.
   - `_flatten_computed_items`: Trích xuất `vat_amount` / `vatAmount` từ raw item.
   - `_sync_computed_item_discounts_and_totals`: Nhận `quote_data`, kiểm tra `vat_amount` của item hoặc `quote_data.vatAmount` để override chính xác `quotes.vat_amount` và `quotes.total_amount` trong DB.
   - `create_quote`: Giữ chính xác `vat` và `total` khi `data.vatType === 'amount'`.
6. Unit tests & đồng bộ:
   - Thêm test `test_fixed_vat_amount_preserves_exact_vat_and_total` trong `tests/test_quote_discount_precision.py` (5/5 test pass).
   - Đã đồng bộ sang toàn bộ 4 clone repo (`crm-module`, `crm-cloudgate`, `crm-securityzone`, `crm-timetech`).

**File liên quan**:
- `modules/quotes/utils/quoteCalculations.ts`
- `modules/quotes/components/QuoteDocumentRenderer.tsx`
- `modules/crm/components/QuoteWorkspaceModal.tsx`
- `modules/quotes/types/index.ts`
- `linkedin_group_crawler/app/modules/all_platform/services/supabase_quote_service.py`
- `linkedin_group_crawler/tests/test_quote_discount_precision.py`
- `thao/CRM_KNOWN_BUGS_FIXED.md`

---

## 41. Luồng Reply Email trong Omnichannel CRM giống Gmail & chống trùng Thread

**Triệu chứng**:
1. Trong Omnichannel CRM, khi kết nối email xong hội thoại hiển thị rời rạc như chat bubble thông thường thay vì chuỗi email (thread) theo dòng thời gian chuẩn Gmail.
2. Không có các nút Trả lời (Reply), Trả lời tất cả (Reply All), Chuyển tiếp (Forward) trên từng thư hoặc ở cuối chuỗi.
3. Khi gửi phản hồi email, tiêu đề không tự động thêm hoặc giữ `Re:`, không gắn các header `In-Reply-To` và `References` của thư gốc, dẫn đến các email client (Gmail, Outlook) xem đó là một thư mới rời rạc thay vì gộp chung vào thread.
4. Chưa phân biệt rõ ràng giữa thao tác "Soạn thư mới" (tạo thread mới gửi tới người nhận bất kỳ) và "Trả lời thư cũ" (gắn chặt vào chuỗi hội thoại hiện tại).
5. Khi tiến trình IMAP đồng bộ thư về hệ thống, các thư gửi đi (outbound) hoặc thư reply bị đồng bộ lặp lại thành các thread riêng biệt (do không khớp Message-ID / References hoặc gán nhầm người gửi chính là khách hàng).

**Nguyên nhân gốc**:
1. `MessageThread.tsx` trước đó hiển thị email dạng bong bóng chat tròn (như Zalo/Telegram), không có cấu trúc thẻ thư (email card) có thể gập/mở, không có header Người gửi/Người nhận/Cc/Ngày/Giờ chuẩn email, và thiếu thanh nút Trả lời / Trả lời tất cả / Chuyển tiếp.
2. Backend `send_email_reply` chỉ lấy tin nhắn cuối cùng và không nhận tham số `mode` ("reply" | "reply_all" | "forward") cũng như `reply_to_message_id`. Khi reply all, backend không tự tổng hợp danh sách người nhận trong `To` và `Cc` của thư gốc.
3. Thiếu endpoint `POST /api/all-platform/email/compose` và modal `EmailComposeModal.tsx` để người dùng có thể chủ động bấm "Soạn thư mới" độc lập với luồng trả lời thư cũ.
4. Trong `_persist_inbound`, khi thư được gửi bởi chính chủ mailbox (`sender_email == account`), hệ thống vẫn mặc định xem người gửi là khách hàng và gán `direction = "inbound"`, sinh ra thread trùng có khách hàng là chính email của mình. `_get_or_create_thread` chưa có cơ chế fallback tìm theo clean subject (`Re:`, `Fwd:` stripped) + email đối tác khi chuỗi `References` bị khuyết.

**Cách fix**:
1. **Backend (`email_inbox_service.py` & schemas)**:
   - Mở rộng `EmailSendRequest` hỗ trợ `reply_to_message_id` và `mode` (`"reply" | "reply_all" | "forward"`).
   - Thêm `EmailComposeRequest` và hàm `compose_new_email` tạo thread mới gửi thư qua SMTP.
   - Hàm `send_email_reply`:
     - Tự động nhận diện thư mục tiêu (theo `reply_to_message_id` hoặc tin nhắn cuối).
     - Với `reply`: Tự điền người nhận là người gửi thư gốc, giữ tiêu đề `Re: <clean subject>`, gắn header `In-Reply-To` = `target.message_id` và `References` = chuỗi tham chiếu.
     - Với `reply_all`: Tự động gom toàn bộ người nhận trong `To` và `Cc` của thư gốc (loại trừ chính mình và người nhận chính), gán vào `Cc`.
     - Với `forward`: Đặt tiêu đề `Fwd: <clean subject>`, giữ chuỗi references.
     - Hàm `_send_smtp`: Hỗ trợ cả cổng 465 (SSL) và cổng 587 (STARTTLS).
   - Hàm `_persist_inbound` & `_get_or_create_thread`:
     - Nhận diện `is_outbound = sender_email == account.lower()`, gán `direction = "outbound"` và đối tác ngoài là người nhận trong `To`.
     - Tìm kiếm thread theo `References`, sau đó theo `thread_key`, sau đó theo `customer_email` + clean subject, ngăn ngừa 100% việc tạo thread trùng khi IMAP đồng bộ lại.
2. **Frontend UI**:
   - `MessageThread.tsx`: Thiết kế lại hoàn toàn giao diện xem email theo chuẩn Gmail:
     - Header tiêu đề lớn + số lượng thư trong chuỗi.
     - Chuỗi thư xếp chồng theo thứ tự thời gian: các thư cũ tự động thu gọn (collapsed) hiển thị tóm tắt một dòng, bấm vào để mở rộng; thư mới nhất luôn được mở rộng mặc định.
     - Mỗi thư có đầy đủ: Avatar, Tên người gửi, `<email>`, nút "Chi tiết" xem Từ/Đến/Cc/Ngày, nội dung HTML/text, danh sách file đính kèm với nút tải xuống.
     - Bộ 3 nút thao tác trên từng thẻ và ở cuối chuỗi: `[ ↩️ Trả lời ]`, `[ ↩️↩️ Trả lời tất cả ]`, `[ ↪️ Chuyển tiếp ]`.
   - `MessageComposer.tsx`:
     - Khi ở kênh email, hiển thị banner chế độ trả lời rõ ràng (↩️ Đang trả lời / ↩️↩️ Đang trả lời tất cả / ↪️ Chuyển tiếp tới...).
     - Tự điền `To:`, hỗ trợ thêm/sửa `Cc:`, giữ tiêu đề `Re:` / `Fwd:`.
     - Nút "Đặt lại" cho phép quay về trạng thái soạn thảo ban đầu.
     - Hỗ trợ đính kèm nhiều file với bộ đếm kích thước và giới hạn 20MB/file, 25MB/email.
   - `EmailComposeModal.tsx`:
     - Modal chuyên biệt cho việc "+ Soạn thư mới", phân biệt rành mạch với trả lời thư cũ.
   - `ConversationList.tsx` & `OmnichannelInboxView.tsx`:
     - Bổ sung nút "+ Soạn thư" nổi bật trên thanh tiêu đề danh sách hội thoại.
     - Empty state hiển thị nút "+ Soạn thư mới" và "Đồng bộ thư ngay".
     - Sau khi gửi reply hoặc soạn thư mới, thư lập tức xuất hiện trong chuỗi hội thoại mà không cần F5.
3. **Đồng bộ**:
   - Đã cập nhật và test thành công (5/5 unit tests pass).
   - Đã đồng bộ sang toàn bộ 4 clone (`crm-module`, `crm-cloudgate`, `crm-securityzone`, `crm-timetech`).
   - Rebuild và verify hoạt động trên container `crm-module` (port 18090).

**File liên quan**:
- `linkedin-crawler-ui/modules/omnichannel/types.ts`
- `linkedin-crawler-ui/modules/omnichannel/repositories/OmnichannelRepository.ts`
- `linkedin-crawler-ui/modules/omnichannel/components/MessageThread.tsx`
- `linkedin-crawler-ui/modules/omnichannel/components/MessageComposer.tsx`
- `linkedin-crawler-ui/modules/omnichannel/components/EmailComposeModal.tsx`
- `linkedin-crawler-ui/modules/omnichannel/components/ConversationList.tsx`
- `linkedin-crawler-ui/modules/omnichannel/components/OmnichannelInboxView.tsx`
- `linkedin_group_crawler/app/modules/all_platform/email/schemas/email_inbox.py`
- `linkedin_group_crawler/app/modules/all_platform/email/services/email_inbox_service.py`
- `linkedin_group_crawler/app/modules/all_platform/email/api/routes/email_inbox.py`
- `linkedin_group_crawler/tests/test_email_inbox_real.py`
- `thao/CRM_KNOWN_BUGS_FIXED.md`

---

## 42. Kết nối Gmail bằng Google OAuth, Hỗ trợ Nhiều Tài khoản Email & Tối ưu Tốc độ Realtime

**Triệu chứng**:
1. Nút "Google Workspace (OAuth)" trong modal kết nối email trước đó chỉ là nút giả lập, chưa kích hoạt luồng OAuth thật; người dùng buộc phải tạo App Password thủ công qua IMAP.
2. Mỗi workspace chỉ hỗ trợ 1 cấu hình email duy nhất trong `quote_delivery_channels`; khi kết nối email thứ hai sẽ ghi đè lên tài khoản cũ, không thể quản lý nhiều hộp thư song song (Gmail cá nhân, Google Workspace công ty).
3. Khi tải trang / F5 hoặc chuyển sang Email Inbox, người dùng phải chờ rất lâu hoặc phải bấm nút "Đồng bộ thư ngay" mới thấy thư; quá trình kết nối IMAP/SMTP chặn render giao diện (blocking UX).
4. Khi bấm "Gửi email", phản hồi mạng chậm và nút gửi không bị khoá / không có trạng thái loading rõ rệt, dẫn đến người dùng bấm liên tiếp 2–3 lần làm phát sinh nhiều email trùng lặp.
5. Danh sách hội thoại, nội dung thread, unread count và thời gian thư mới nhất không tự động cập nhật ngay lập tức sau khi gửi hoặc khi có thư mới đến.

**Nguyên nhân gốc**:
1. Thiếu các API endpoint khởi tạo URL Google OAuth 2.0 (`GET /oauth/google/auth-url`) và xử lý mã xác thực (`POST /oauth/google/callback`) với các scope chuẩn (`https://mail.google.com/`, `openid`, `email`, `profile`).
2. Bảng `quote_delivery_channels` có check constraint `channel_type IN ('email', 'zalo')` và unique index trên `(instance, channel_type)`, không hỗ trợ lưu nhiều tài khoản email cùng lúc.
3. Luồng nạp dữ liệu cũ gọi đồng bộ mailbox IMAP trực tiếp trên request thread trước khi trả dữ liệu về client, khiến thời gian load ban đầu tăng từ 5–15 giây tuỳ dung lượng hộp thư.
4. Nút Gửi trong `MessageComposer.tsx` không được truyền prop `isSending` từ component cha (`OmnichannelInboxView`), và thiếu khóa chống gửi trùng (`idempotency_key`) trên cả frontend lẫn backend.

**Cách fix**:
1. **Google OAuth 2.0 & Quản lý Multi-Account Backend**:
   - Sử dụng Google Client ID cấu hình sẵn trong môi trường (`674669134021-dk8gikthiul7hnvqinoob6p59mirhtd9.apps.googleusercontent.com`).
   - Xây dựng luồng `get_google_auth_url` (offline access, prompt consent, force refresh_token) và `exchange_google_oauth_code`: trao đổi mã code lấy access_token + refresh_token, trích xuất email/tên hồ sơ Google.
   - Kho lưu trữ tài khoản đa kênh mã hoá `omnichannel_email_accounts_vault.json` (Fernet symmetric encryption) bảo vệ token tuyệt đối theo từng workspace instance.
   - Tự động làm mới access token (`refresh_google_oauth_token_if_needed`) khi token hết hạn; trường hợp refresh token bị thu hồi thì đánh dấu `reconnect_required = True`.
   - Gửi thư trực tiếp qua Gmail REST API (`https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send`) cho tài khoản OAuth, và qua SMTP (SSL 465 / STARTTLS 587) cho tài khoản IMAP/SMTP.
   - Thêm bộ lọc `account_email` độc lập trong DB Supabase (`omnichannel_email_threads`, `omnichannel_email_messages`, `omnichannel_email_sync_state`) đảm bảo dữ liệu các tài khoản và workspace không bao giờ bị lẫn lộn.
2. **Chống gửi trùng (Idempotency Guard)**:
   - Thêm `idempotency_key` (UUID v4) trong `EmailSendRequest` và `EmailComposeRequest`.
   - Backend kiểm tra trùng lặp: nếu cùng một `idempotency_key` đã được xử lý thành công, backend lập tức trả về tin nhắn đã lưu trước đó thay vì gửi lại thư ra ngoài.
3. **Tối ưu Tốc độ & Giao diện Realtime (Frontend)**:
   - **Fast-path Load**: Khi mở trang hoặc chuyển kênh Email, frontend đọc ngay lập tức các hội thoại đã lưu từ DB (thời gian phản hồi < 150ms).
   - **Non-blocking Background Sync**: Sau khi render xong dữ liệu DB, frontend tự động kích hoạt tiến trình đồng bộ ngầm IMAP/Gmail API mà không làm đứng giao diện. Định kỳ 20–30s kiểm tra thư mới và hiển thị toast thông báo.
   - **Optimistic Send UI**:
     - Khi bấm Gửi, lập tức gắn tin nhắn vào danh sách với trạng thái `"sending"` và biểu tượng spinner đang gửi.
     - Khóa ngay lập tức nút Gửi (`isSending={true}` và `disabled`), xóa nội dung ô soạn thảo để người dùng yên tâm thư đã được đưa vào hàng đợi gửi.
     - Cập nhật tức thì `lastMessageText` và `lastMessageTime = "vừa xong"` trên danh sách hội thoại.
     - Chỉ khi backend/SMTP xác nhận thành công mới chuyển sang `"sent"`. Nếu thất bại, chuyển sang `"failed"` kèm cảnh báo lỗi rõ ràng.
   - **Multi-Account Sidebar & Compose**:
     - `ChannelScopePane.tsx`: Hiển thị danh sách từng tài khoản email bên dưới "Email Inbox" kèm chấm trạng thái (Xanh = Online, Cam nhấp nháy = Hết quyền/Cần kết nối lại, Xanh dương nhấp nháy = Đang đồng bộ). Có nút chọn xem "Tất cả hộp thư" và nút `+ Thêm email khác`.
     - `EmailComposeModal.tsx`: Tự động bổ sung dropdown "Từ (From):" khi có từ 2 tài khoản trở lên để người dùng chọn hộp thư gửi đi.
     - `EmailConnectModal.tsx`: Popup kết nối Google OAuth 2.0 tiện lợi, kèm quản lý danh sách tài khoản đã kết nối, nút Đồng bộ và Ngắt kết nối từng tài khoản độc lập.
4. **Kiểm thử & Đồng bộ**:
   - Toàn bộ 7/7 backend unit tests đạt 100% (`test_email_inbox_real.py`).
   - Frontend `npm run type-check` đạt 0 lỗi.
   - Đồng bộ đầy đủ sang cả 4 clone repository (`crm-module`, `crm-cloudgate`, `crm-securityzone`, `crm-timetech`).
   - Build và xác minh thành công trên Docker containers (`crm-module-backend`, `crm-module-frontend`, `crm-module-router` tại port 18090).

**File liên quan**:
- `linkedin-crawler-ui/modules/omnichannel/types.ts`
- `linkedin-crawler-ui/modules/omnichannel/repositories/OmnichannelRepository.ts`
- `linkedin-crawler-ui/modules/omnichannel/components/ChannelScopePane.tsx`
- `linkedin-crawler-ui/modules/omnichannel/components/EmailConnectModal.tsx`
- `linkedin-crawler-ui/modules/omnichannel/components/EmailComposeModal.tsx`
- `linkedin-crawler-ui/modules/omnichannel/components/MessageThread.tsx`
- `linkedin-crawler-ui/modules/omnichannel/components/OmnichannelInboxView.tsx`
- `linkedin_group_crawler/app/modules/all_platform/email/schemas/email_inbox.py`
- `linkedin_group_crawler/app/modules/all_platform/email/services/email_inbox_service.py`
- `linkedin_group_crawler/app/modules/all_platform/email/api/routes/email_inbox.py`
- `linkedin_group_crawler/app/modules/all_platform/router.py`
- `linkedin_group_crawler/supabase/migrations/202_omnichannel_email_accounts.sql`
- `linkedin_group_crawler/tests/test_email_inbox_real.py`
- `crm-module/backend/app/modules/all_platform/router.py`
- `thao/CRM_KNOWN_BUGS_FIXED.md`

---

## 43. Omnichannel frontend gọi endpoint cũ gây 404 cho Email và Facebook

**Triệu chứng**: mở `http://localhost:18090/all-platform/omnichannel-inbox` phát sinh lặp lại HTTP 404 tại
`/api/all-platform/email/accounts`, `/api/all-platform/email/conversations` và `/facebook/api/v1/sessions`;
Email/FB không tải được dù backend vẫn healthy.

**Nguyên nhân gốc**: sau khi backend multi-account Email đổi prefix thành
`/api/all-platform/email-inbox/*` và Facebook module độc lập mount ở `/api/all-platform/fb/*`,
`OmnichannelRepository.ts` vẫn giữ URL contract cũ. URL attachment backend cũng còn trả prefix `/email/*`.

**Cách fix**:
- Chuyển toàn bộ Email repository calls sang `/api/all-platform/email-inbox/*`.
- Chuyển Facebook sessions sang `/api/all-platform/fb/sessions`.
- Chuyển attachment URL backend sang `/api/all-platform/email-inbox/attachments/{id}`.
- Port Main + 4 clone; rebuild/recreate `crm-module` từ source. Xác minh runtime các endpoint mới trả `401`
  khi chưa đăng nhập (route tồn tại và auth hoạt động), UI trả `200`, frontend image chứa đúng URL mới.

**File liên quan**: `modules/omnichannel/repositories/OmnichannelRepository.ts`,
`app/modules/all_platform/email/services/email_inbox_service.py`, tài liệu CRM. Main + 4 clone.

---

## 44. Google OAuth không bật cửa sổ chọn tài khoản và Facebook optional spam 503

**Triệu chứng**:
- Bấm `Google Workspace / Gmail (OAuth)` trong modal kết nối Email nhưng popup có thể bị trình duyệt chặn,
  không tới màn hình Google chọn tài khoản.
- Omnichannel liên tục gọi `/api/all-platform/fb/sessions` và nhận 503 khi local chưa cấu hình Facebook bridge.
- Tiêu đề `+ Thêm tài khoản email mới` thừa trong modal multi-account.

**Nguyên nhân gốc**:
- `window.open()` chỉ chạy sau một lần `await` lấy OAuth URL nên mất user gesture trực tiếp và bị popup blocker.
- Callback `http://localhost:18090/all-platform/omnichannel-inbox` chưa được OAuth client whitelist, Google trả
  `redirect_uri_mismatch`; OAuth URL cũ cũng không bắt buộc account chooser khi trình duyệt đã đăng nhập.
- Frontend standalone build với `NEXT_PUBLIC_GOOGLE_CLIENT_ID` rỗng dù backend đã có OAuth client.
- Facebook sessions coi provider optional chưa cấu hình là lỗi toàn dịch vụ.

**Cách fix**:
- Dùng Google Identity Services `auth-code` popup (`useGoogleLogin`) với `select_account=true`; code được trả trực tiếp
  bằng popup và backend đổi token với `redirect_uri=postmessage`, không phụ thuộc callback localhost.
- Bổ sung public OAuth Client ID fallback cho standalone Dev; Client Secret vẫn chỉ ở backend.
- Bỏ tiêu đề thêm tài khoản dư thừa; giữ trực tiếp hai lựa chọn Google OAuth và IMAP/SMTP.
- Khi Facebook bridge chưa cấu hình, endpoint sessions trả `200` với `sessions=[]`, `configured=false`.
- Unit test Email/FB đạt 8/8; frontend typecheck/build Docker đạt; port Main + 4 clone.

**File liên quan**: `modules/omnichannel/components/EmailConnectModal.tsx`,
`app/modules/all_platform/email/services/email_inbox_service.py`,
`app/modules/all_platform/routers/fb.py`, `tests/test_email_inbox_real.py`.

---

## 45. Báo giá sắp xếp mới nhất + nhãn phiên bản v1/v2 và dàn ngang form Bổ sung hồ sơ Bên B (Contract Copilot)

**Triệu chứng**:
1. Trong modal Tạo hợp đồng / Contract AI Wizard, dropdown "Báo giá đã duyệt" không tự động chọn báo giá mới nhất, danh sách hiển thị không có phân biệt rõ các phiên bản (chỉ hiện mã số thuần tuý) khiến người dùng khó nhận biết bản báo giá nào là mới nhất vừa duyệt.
2. Khi mở form "Bổ sung thông tin" cho Bên B / Đơn vị phát hành, form bị ép vào 1 cột dọc hẹp nằm lệch hẳn về mép phải, để lại khoảng trống mênh mông bên trái; các ô nhập xếp chồng lên nhau quá dài, không cân đối và không đồng bộ với box ngang rộng rãi của Bên A.

**Nguyên nhân gốc**:
1. `ContractAIWizard.tsx` trước đó chỉ tự chọn `quoteId` khi danh sách có đúng 1 phần tử (`ok.length === 1`), nếu có từ 2 báo giá trở lên sẽ để trống (`-- Chọn báo giá --`). Đồng thời các options chỉ render chuỗi văn bản thuần túy gồm số báo giá và số tiền, không tính toán version number hoặc gắn nhãn phiên bản.
2. Trong `ContractCopilotParts.tsx`, `IssuerInlineEditor` được bọc bên trong `<div style={{ flexShrink: 0 }}>` thuộc phần tử `<li>` có `display: flex; justifyContent: space-between; flexWrap: wrap`. Bản thân `IssuerInlineEditor` dùng layout `display: grid; gap: 6` theo cột đơn (1 column), không có `gridTemplateColumns` đa cột và không phá vỡ flex row hẹp khi mở.

**Cách fix**:
1. **Sắp xếp, Nhãn phiên bản & Tuân thủ React Rules of Hooks (`ContractAIWizard.tsx`)**:
   - Sắp xếp mảng quotes theo thứ tự giảm dần: (1) thời gian tạo `createdAt`/`issuedAt` mới nhất, (2) `versionNumber` giảm dần, (3) `quoteNumber` chuỗi.
   - Tự động gán `quoteId` bằng báo giá mới nhất trên đầu (`sorted[0]?.id`).
   - Xây dựng `quoteVersionMap` bằng `useMemo` tính toán số thứ tự phiên bản `v1`, `v2`, ... tăng dần theo trình tự thời gian khởi tạo.
   - **Lưu ý Rules of Hooks**: `quoteVersionMap = useMemo(...)` phải đặt ở đầu component TRƯỚC `if (!open) return null;` — nếu đặt sau early return sẽ làm vi phạm Rules of Hooks khi modal đóng (`open = false`), kích hoạt Next.js error boundary "This page couldn't load" trên tab contracts.
   - Nâng cấp `quoteOptions` với `richLabel` hiển thị huy hiệu phiên bản `v1`, `v2` (xanh dương nhạt) và tag `Mới nhất` (xanh lá) bên cạnh số báo giá.
2. **Dàn ngang form Bổ sung hồ sơ Bên B (`ContractCopilotParts.tsx`)**:
   - Thêm callback `onOpenChange` cho `IssuerInlineEditor` để thông báo trạng thái mở/đóng lên `PrecheckPanel`.
   - Khi mở, div bao ngoài tự động mở rộng `width: '100%'`, `flex: '1 1 100%'` để chiếm trọn chiều ngang card.
   - Tái cấu trúc form theo các khối ngang với lưới tự co giãn:
     - Nhóm "Doanh nghiệp": Tên pháp lý, Mã số thuế, Địa chỉ chia theo hàng ngang (`repeat(auto-fit, minmax(180px, 1fr))`).
     - Nhóm "Liên hệ & Đại diện ký": Điện thoại, Email, Người đại diện, Chức vụ người đại diện sắp xếp theo hàng ngang 4 cột.
3. **Đồng bộ & Kiểm thử**:
   - Chạy `npm run check` (type-check 0 lỗi).
   - Đồng bộ sang cả 4 clone (`crm-module`, `crm-cloudgate`, `crm-securityzone`, `crm-timetech`).
   - Rebuild và khởi động lại container `crm-module-frontend`, xác minh runtime HTTP 200 tại `http://localhost:18090`, Playwright test kiểm tra tab hợp đồng không còn gặp màn hình lỗi (`This page couldn't load: False`, 0 console errors).

**File liên quan**:
- `linkedin-crawler-ui/modules/crm/integrations/contracts/ContractAIWizard.tsx`
- `linkedin-crawler-ui/modules/crm/integrations/contracts/ContractCopilotParts.tsx`
- Các file tương ứng trong `crm-module`, `crm-cloudgate`, `crm-securityzone`, `crm-timetech`.
- `thao/CRM_KNOWN_BUGS_FIXED.md`

---

## 46. Menu dropdown bị che chữ "Mới nhất", Form Bên B tràn mép phải & Bộ sinh Heuristic Regex cho Local Dev (Contract AI Copilot)

**Triệu chứng**:
1. Trong menu chọn báo giá của `ContractAIWizard`, chữ `Mới nhất` bị cắt ngắn thành `Mới nhá...`.
2. Khi bấm "Bổ sung thông tin" cho Bên B / Đơn vị phát hành, form nhập liệu bị tràn ra ngoài viền phải của card.
3. Trên môi trường Local Dev khi chưa cấu hình `CONTRACT_AI_API_KEY`/`OPENAI_API_KEY`, bấm "Tạo bản nháp AI" bị báo lỗi đỏ: `Chưa cấu hình CONTRACT_AI_API_KEY/OPENAI_API_KEY — không thể dùng AI Contract Copilot`, khiến người dùng không thể trải nghiệm tiếp luồng tạo hợp đồng.

**Nguyên nhân gốc**:
1. Menu portal của `SearchableSelect.tsx` bị giới hạn cứng bề ngang tối đa 320px (`Math.min(Math.max(rect.width, 260), 320)`), cộng với việc option wrapper có `overflow: hidden` làm nhãn `Mới nhất` bị cắt xén.
2. Card của `IssuerInlineEditor` và các trường input con thiếu thuộc tính `box-sizing: border-box`. Khi padding `0.7rem 0.9rem` cộng với viền 1px, chiều rộng thực tế vượt quá 100% của phần tử cha `<li>`. Ngoài ra, CSS grid dùng `repeat(auto-fit, minmax(180px, 1fr))` ép 4 cột trên 1 hàng quá chật.
3. Hàm `_require_api_key()` trong `contract_ai_service.py` luôn ném `RuntimeError` khi không có API key. Chưa có cơ chế fallback giả lập thông minh trên môi trường Local Dev.

**Cách fix**:
1. **Mở rộng dropdown menu (`SearchableSelect.tsx` & `ContractAIWizard.tsx`)**:
   - Nâng giới hạn menu width trong `SearchableSelect.tsx` lên `Math.min(Math.max(rect.width, 320), Math.min(420, window.innerWidth - 16))`.
   - Trong `ContractAIWizard.tsx`, đặt `flexShrink: 0`, `whiteSpace: 'nowrap'` cho badge `v1/v2` và tag `Mới nhất`, đồng thời gỡ bỏ `overflow: hidden` gây che khuất.
2. **Khắc phục tràn viền Form Bên B (`ContractCopilotParts.tsx`)**:
   - Thêm `boxSizing: 'border-box'`, `maxWidth: '100%'` vào card container và toàn bộ `inputStyle`, `labelStyle`.
   - Cơ cấu lại form thành 2 cột tự co giãn: Nhóm Doanh nghiệp (Tên pháp lý + MST chung hàng 1, Địa chỉ full width hàng 2); Nhóm Liên hệ & Đại diện (SĐT + Email hàng 1, Đại diện + Chức vụ hàng 2). Form nằm gọn 100% trong card, không còn tràn mép.
3. **Bộ máy Heuristic Regex cho Local Dev (`contract_ai_service.py` & `contract.py`)**:
   - Viết hàm `_generate_contract_draft_heuristic()` bóc tách tự động các điều khoản thanh toán, tiến độ, bảo hành, nghiệm thu, trách nhiệm và điều khoản thêm từ `extra_prompt` của Sale bằng Regex, kết hợp với dữ liệu báo giá CRM để sinh đủ 7 điều khoản hợp đồng chuẩn mực.
   - Viết hàm `_review_contract_risk_heuristic()` kiểm tra số học giá trị hợp đồng bằng Decimal và cho điểm đánh giá rủi ro (95 điểm).
   - Trong `contract.py`, bổ sung cảnh báo rõ ràng khi chạy Local: `Chế độ Local Dev: Chưa cấu hình CONTRACT_AI_API_KEY — Hợp đồng được sinh bằng bộ máy Heuristic/Regex tự động từ dữ liệu CRM & Báo giá.`
   - Khi có API key thật trên production, hệ thống vẫn ưu tiên gọi OpenAI/Claude như bình thường.
4. **Đồng bộ & Kiểm thử**:
   - Đồng bộ toàn bộ thay đổi sang 4 clone repo (`crm-module`, `crm-cloudgate`, `crm-securityzone`, `crm-timetech`).
   - Chạy `py_compile` xác nhận cú pháp Python sạch trên tất cả các repo.
   - Rebuild và khởi động container `crm-module-frontend` và `crm-module-backend`.
   - Kiểm thử thực tế bằng Playwright: menu báo giá hiển thị nguyên vẹn `Mới nhất`, form Bên B không tràn, bấm "Tạo bản nháp AI" sinh thành công 7 điều khoản hợp đồng hoàn chỉnh.

**File liên quan**:
- `linkedin-crawler-ui/modules/crm/components/SearchableSelect.tsx`
- `linkedin-crawler-ui/modules/crm/integrations/contracts/ContractAIWizard.tsx`
- `linkedin-crawler-ui/modules/crm/integrations/contracts/ContractCopilotParts.tsx`
- `linkedin_group_crawler/app/modules/all_platform/services/contract_ai_service.py`
- `linkedin_group_crawler/app/modules/all_platform/routers/contract.py`
- Các file tương ứng trong `crm-module`, `crm-cloudgate`, `crm-securityzone`, `crm-timetech`.
- `thao/CRM_KNOWN_BUGS_FIXED.md`

---

## 47. Gmail OAuth Email Inbox dùng client riêng, state an toàn và chống đồng bộ trùng giữa hai stack Markee

**Triệu chứng**:
1. Luồng Google Workspace/Gmail trước đây dùng URL OAuth tự dựng và mô tả `redirect_uri=postmessage`; popup không có
   state một lần ràng buộc user/workspace/origin, nên chưa đủ điều kiện triển khai an toàn trên 5 HTTPS Dev origins.
2. Credential OAuth từng có fallback sang Google client dùng cho Login/Drive; thay đổi Email Inbox có nguy cơ ảnh hưởng
   luồng Google hiện hữu và không tách được secret theo chức năng.
3. Tài khoản/token Gmail có thể còn nằm ở JSON local; Seeding/Main và CRM Markee cùng `instance=markee` nhưng hai worker
   có thể đồng bộ cùng mailbox, tạo tải và dữ liệu trùng.
4. Gmail reply chỉ dựa vào RFC headers, chưa truyền `threadId` của Gmail API; reply có thể không nằm đúng provider thread.

**Nguyên nhân gốc**:
- Chưa có bảng OAuth state dùng một lần và chưa validate đồng thời HMAC, TTL, origin, authenticated user, instance.
- Chưa có biến môi trường Gmail riêng và chưa ép exact HTTPS origin allowlist.
- Chưa có DB lease atomic theo `(instance, account_email)` cho scheduler/sync nền dùng chung database.
- Schema thread/message chưa lưu `provider_thread_id`.

**Cách fix**:
- Dùng Google Identity Services auth-code popup với `NEXT_PUBLIC_GMAIL_OAUTH_CLIENT_ID` và backend
  `GMAIL_OAUTH_CLIENT_ID`, `GMAIL_OAUTH_CLIENT_SECRET`, `GMAIL_OAUTH_STATE_SECRET`,
  `GMAIL_OAUTH_ALLOWED_ORIGINS`; không fallback sang client Google Login/Drive.
- Dùng scope `gmail.modify`, `openid`, `email`, `profile`; không dùng `https://mail.google.com/`.
- Endpoint state tạo nonce ký HMAC, lưu hash trong `omnichannel_email_oauth_states`; callback yêu cầu auth, quyền Customer,
  exact origin và header XHR, sau đó consume state đúng một lần trước khi đổi token.
- Lưu access/refresh token mã hóa trong `omnichannel_email_accounts`, khóa theo `(instance, account_email)`, hỗ trợ nhiều
  Gmail/workspace; JSON vault cũ chỉ còn đường import một lần, không còn là nơi ghi chính.
- Migration 203 bổ sung state table, `provider_thread_id` và RPC claim/release lease; Gmail send/reply truyền `threadId`.
- Port byte-for-byte các file lõi sang `crm-module`, `crm-cloudgate`, `crm-securityzone`, `crm-timetech`.

**Kiểm thử hiện tại**:
- Unit backend Main, CloudGate, SecurityZone, Timetech: 12/12 pass; Main frontend typecheck/build pass; Python compile
  pass trên cả 5 source tree. CRM Module test bị guard bởi `.env.local` hiện hữu nên không xóa/đổi file người dùng.
- **Dev E2E vẫn BLOCKED, chưa được ghi PASS**: 5 backend chưa có `GMAIL_OAUTH_*`, frontend chưa có build-time client ID,
  database Dev chưa có migration 203 và chưa có mailbox Test User để xác minh nhận/gửi/reply/restart thực tế.

**File liên quan**:
- `app/modules/all_platform/email/services/email_inbox_service.py`
- `app/modules/all_platform/email/api/routes/email_inbox.py`
- `app/modules/all_platform/email/schemas/email_inbox.py`
- `modules/omnichannel/components/EmailConnectModal.tsx`
- `modules/omnichannel/repositories/OmnichannelRepository.ts`
- `supabase/migrations/203_omnichannel_email_oauth_hardening.sql`
- `tests/test_email_inbox_real.py`
---

## 47. Fix VAT báo giá CRM: Thuế tính theo từng hạng mục, không phân bổ toàn bộ báo giá

**Triệu chứng**:
- Báo giá (như Unifarm `29a17b22-9738-46db-a25c-dcf4a9d598bf`): chỉ có 1 hạng mục chịu thuế VAT 10% (dòng 31 VM: 12 × 66.000đ = 792.000đ, VAT 79.200đ, Thành tiền gồm VAT = 871.200đ), các dòng khác không có VAT (0%).
- Nhưng giao diện web/PDF lại phân bổ VAT thành mức thuế ~0,23% trên tất cả các dòng, khiến dòng VM chỉ hiển thị thành tiền 793.822đ (thay vì 871.200đ), các dòng còn lại bị gán thêm thuế lẻ 0,23%.

**Nguyên nhân gốc**:
1. Chức năng Quickbar "Thuế GTGT" mới thêm trước đó có ô nhập VNĐ/% và nút "Áp mục đã chọn", "Áp tất cả mục" (`applyBulkVat`). Khi áp dụng số tiền 79.200đ cho tất cả mục, hàm này tự tính tỷ lệ phân bổ `(79.200 / 34.892.000) * 100 ≈ 0.23%` và gán ngược `vatRate = 0.23%` vào toàn bộ 30+ dòng trong báo giá.
2. Hàm `calculateOverallDiscountSummary` trong `quoteCalculations.ts` trước đây tự nhân tỷ lệ giảm giá toàn báo giá vào tổng VAT: `vatAfterDiscount = totals.totalVatAmount * (1 - effectiveRatio)`, làm suy giảm tiền thuế VAT của các dòng chịu thuế khi có giảm giá toàn báo giá.
3. Cột VAT (%) khi `vatRate === 0` hiển thị `0%` thay vì dấu gạch ngang `–`.
4. Khối tổng hợp giá trong `QuoteDocumentRenderer.tsx` có điều kiện `&& (totals.discountAmount || 0) > 0` khiến dòng "Giảm giá toàn báo giá" bị ẩn khi báo giá chỉ có giảm giá tổng mà không có giảm giá từng dòng.

**Cách fix**:
1. Gỡ hoàn toàn công cụ "Thuế GTGT" toàn báo giá trong Quickbar (`qc-item-vat-tools`), bao gồm các state `bulkVatInput`, `bulkVatInputMode`, và hàm `applyBulkVat`.
2. Khôi phục tính VAT thuần túy theo từng hạng mục: mỗi dòng lưu và giữ nguyên `vatRate` (0% hoặc 10%), tổng VAT của báo giá là tổng VAT của các dòng (`totals.totalVatAmount`), không phân bổ hay chia đều.
3. Trong `calculateOverallDiscountSummary`: `vatAfterDiscount` giữ nguyên bằng tổng VAT của các hạng mục `totals.totalVatAmount`, không bị giảm trừ theo tỷ lệ giảm giá toàn báo giá.
4. Cột VAT (%) hiển thị `10%` cho dòng chịu thuế và `–` cho các dòng không chịu thuế (`vatRate === 0` hoặc trống).
5. Sửa `QuoteDocumentRenderer.tsx` hiển thị đúng:
   - Giá gốc trước giảm: 34.892.000đ
   - Giảm giá toàn báo giá: -4.971.200đ
   - Tổng sau giảm giá: 29.920.800đ
   - Thuế GTGT: 79.200đ
   - Tổng thanh toán: 30.000.000đ
6. Cập nhật backend `supabase_quote_service.py`: `_sync_computed_item_discounts_and_totals` và `create_quote` tính đúng `total_amount = subtotal - overall_discount + vat`, đồng bộ chính xác dữ liệu từng dòng và báo giá vào Supabase.
7. Đã cập nhật phục hồi dữ liệu báo giá Unifarm trên DB Dev (`29a17b22-9738-46db-a25c-dcf4a9d598bf`): dòng VM có VAT 10% = 79.200đ, tổng 871.200đ; các dòng khác VAT 0%; tổng thanh toán đúng 30.000.000đ.
8. Đã thêm unit test `test_unifarm_item_level_vat_and_overall_discount` trong `test_quote_discount_precision.py` (6/6 tests pass).
9. Port đồng bộ sang cả 4 clone: `crm-module`, `crm-cloudgate`, `crm-securityzone`, `crm-timetech`.

**File liên quan**:
- `linkedin-crawler-ui/modules/crm/components/QuoteWorkspaceModal.tsx`
- `linkedin-crawler-ui/modules/crm/styles/quote-center.css`
- `linkedin-crawler-ui/modules/quotes/components/QuoteDocumentRenderer.tsx`
- `linkedin-crawler-ui/modules/quotes/utils/quoteCalculations.ts`
- `linkedin_group_crawler/app/modules/all_platform/services/supabase_quote_service.py`
- `linkedin_group_crawler/tests/test_quote_discount_precision.py`
- Main + 4 clones.



---

## 48. OnlyOffice Word Editor: Lỗi "Tải về không thành công" (Download failed)

**Triệu chứng**:
- Trong màn hình Xem trước & hoàn thiện hợp đồng (tab "Chỉnh sửa (Word)"), OnlyOffice Document Server tải giao diện xong thì hiện popup lỗi: "Lỗi: Tải về không thành công." (Download failed).
- Thanh cảnh báo trên giao diện hiện: "OnlyOffice báo lỗi trong lúc chỉnh sửa — thử tải lại."

**Nguyên nhân gốc**:
1. OnlyOffice Document Server (từ phiên bản 7.4 trở lên) có cơ chế bảo mật SSRF mặc định chặn mọi kết nối tải tài liệu tới địa chỉ IP nội bộ/riêng tư (`10.x.x.x`, `172.x.x.x`, `192.168.x.x`, `127.0.0.1`, DNS nội bộ Docker).
2. Khi OnlyOffice chạy trong Docker kết nối tới backend nội bộ qua `http://backend:8000/...`, `backend` phân giải ra dải IP riêng tư của Docker bridge network (`172.x.x.x`).
3. File `local-production-linux.json` được mount đè vào `/etc/onlyoffice/documentserver/local-production-linux.json` (có độ ưu tiên cao hơn `local.json` trong `node-config`) nhưng lại thiếu khai báo cấu hình `request-filtering-agent`. Do đó cấu hình chặn IP riêng tư vẫn giữ mặc định là `false`.
4. URL tải bản nháp `document_url` trong `_editor_config_for_session` bị hardcode cứng `http://backend:8000/api/all-platform` mà không cho phép cấu hình linh hoạt qua biến môi trường `BACKEND_INTERNAL_URL`.

**Cách fix**:
1. Bổ sung `request-filtering-agent` với `allowPrivateIPAddress: true` và `allowMetaIPAddress: true` vào file `local-production-linux.json` ở cả main và 4 clone (`onlyoffice/local-production-linux.json`, `crm-module/`, `crm-cloudgate/`, `crm-securityzone/`, `crm-timetech/`).
2. Cập nhật `Dockerfile` của OnlyOffice để patch thêm `request-filtering-agent` vào `local.json` ngay lúc build image, đảm bảo không phụ thuộc vào volume mount.
3. Cập nhật `contract_edit_service.py` và `app/core/config.py`: hỗ trợ biến môi trường `BACKEND_INTERNAL_URL` (mặc định fallback `http://backend:8000/api/all-platform`).
4. Nâng cấp xử lý lỗi và logging tại endpoint `GET /{contract_id}/edit/draft-file`: ghi log rõ ràng khi tải thành công hoặc lỗi JWT/Lookup/Exception, trả về HTTP status chuẩn.
5. Thêm nút "Thử tải lại" trực tiếp trên banner lỗi của tab `Chỉnh sửa (Word)` trong `ContractAIWizard.tsx`.
6. Thêm unit test `tests/test_onlyoffice_draft_config.py` kiểm thử token ký, sinh cấu hình editor và override `BACKEND_INTERNAL_URL`.
7. Port đồng bộ sang toàn bộ 4 clone repos.

**File liên quan**:
- `onlyoffice/local-production-linux.json`
- `onlyoffice/Dockerfile`
- `linkedin_group_crawler/app/core/config.py`
- `linkedin_group_crawler/app/modules/all_platform/services/contract_edit_service.py`
- `linkedin_group_crawler/app/modules/all_platform/routers/contract_edit.py`
- `linkedin_group_crawler/tests/test_onlyoffice_draft_config.py`
- `linkedin-crawler-ui/modules/crm/integrations/contracts/ContractAIWizard.tsx`
- Main + 4 clones.

---

## 49. Báo giá CRM: Lỗi thuế GTGT sai lệch khi có giảm giá toàn báo giá và phân bổ thuế sai

**Triệu chứng**:
- Trong báo giá Unifarm (`202610291754`), chỉ có dòng #31 "VM cơ bản cho website Nextjs" chịu thuế GTGT 10% (12 x 66.000đ = 792.000đ, thuế VAT = 79.200đ, thành tiền gồm thuế = 871.200đ). Các dòng khác không chịu thuế (VAT = 0, hiển thị "–").
- Giá gốc trước giảm: 34.892.000 VNĐ.
- Giảm giá toàn báo giá: 4.971.200 VNĐ.
- Giá sau giảm: 29.920.800 VNĐ.
- Thuế GTGT hiển thị sai thành `67.916 VNĐ` thay vì đúng `79.200 VNĐ`.
- Tổng thanh toán hiển thị sai thành `29.988.716 VNĐ` thay vì đúng `30.000.000 VNĐ`.
- Ở cuối bảng sản phẩm xuất hiện thanh điều khiển "Thuế GTGT" (ô nhập số, nút %, VNĐ, "Áp mục đã chọn", "Áp tất cả mục") gây nhầm lẫn và phân bổ thuế VAT toàn báo giá ra các dòng không chịu thuế (khoảng 0.23%).

**Nguyên nhân gốc**:
1. **Nguồn gốc số tiền 67.916 VNĐ**:
   Trong hàm `calculateOverallDiscountSummary` (`quoteCalculations.ts`), khi có giảm giá toàn báo giá (ví dụ 4.971.200đ trên tổng trước giảm 34.892.000đ), hệ thống tính tỷ lệ giảm giá hiệu dụng:
   $$\text{effectiveRatio} = \frac{4.971.200}{34.892.000} \approx 0{,}14247392$$
   $$\text{Tỷ lệ còn lại} = 1 - \text{effectiveRatio} \approx 0{,}85752608$$
   Code cũ đã nhân tỷ lệ còn lại này vào tổng thuế VAT:
   $$\text{vatAfterDiscount} = 79.200 \times 0{,}85752608 = 67.916{,}065 \approx \mathbf{67.916\text{ VNĐ}}$$
   $$\text{grandTotal} = 29.920.800 + 67.916 = \mathbf{29.988.716\text{ VNĐ}}$$
   Đây là sai sót nghiệp vụ: thuế VAT được cấu hình cụ thể trên từng hạng mục sản phẩm/dịch vụ (dòng VM chịu 10% trên doanh thu của riêng nó), giảm giá toàn bộ báo giá không được tự ý giảm trừ tiền thuế VAT của dòng chịu thuế cố định.
2. **Thanh Quickbar Thuế GTGT tổng**:
   Giao diện thanh điều khiển hàng loạt ở chân bảng sản phẩm tự động áp thuế cho tất cả các dòng, làm mất tính độc lập thuế suất của từng dòng sản phẩm/dịch vụ.
3. **Độ lệch giữa các màn hình Detail/Public/Workspace**:
   `QuoteDetailPage` và `PublicQuotePage` từng tự tính `totals.discountAmount` từ chênh lệch tổng tiền thay vì gọi `calculateQuoteTotals(quote.items, ...)`, gây nguy cơ lệch tổng tiền khi đọc từ DB.

**Cách fix**:
1. **Gỡ bỏ hoàn toàn thanh điều khiển Thuế GTGT tổng**:
   - Xóa khối JSX/HTML Quickbar (`qc-item-vat-tools`), state `bulkVatInput`, `bulkVatInputMode`, và handler `applyBulkVat` khỏi `QuoteWorkspaceModal.tsx`.
   - Xóa CSS `.qc-item-vat-tools` trong `quote-center.css`.
2. **Khôi phục logic tính VAT chuẩn**:
   - Trong `quoteCalculations.ts` (`calculateOverallDiscountSummary`): gỡ bỏ phép nhân giảm trừ `(1 - effectiveRatio)` trên tổng VAT. Thuế VAT giữ nguyên bằng tổng VAT của các hạng mục `roundFor(totals.totalVatAmount, currency)`.
   - `grandTotal = subtotalAfterDiscount + vatAfterDiscount` (chính xác $29.920.800 + 79.200 = 30.000.000$ VNĐ).
3. **Đồng bộ màn hình Detail, Public và QuickView**:
   - Trong `QuoteDetailPage.tsx`, `PublicQuotePage.tsx`, `QuoteQuickViewDrawer.tsx`: truyền `totals` tính từ `calculateQuoteTotals(quote.items, 0, quote.currency)` sang `QuoteDocumentRenderer` để đảm bảo 100% đồng nhất giữa màn hình tạo/sửa, chi tiết, bản public khách hàng và xuất in PDF.
4. **Backend & DB**:
   - Cập nhật `supabase_quote_service.py` (`_sync_computed_item_discounts_and_totals` và `create_quote`): tính `total_amount = (subtotal_amount - overall_discount) + vat_amount`.
   - Cập nhật bản ghi DB báo giá Unifarm: `subtotal_amount = 34892000.0`, `vat_amount = 79200.0`, `total_amount = 30000000.0`, dòng VM có `vat_rate = 10.0`, `vat_amount = 79200.0`, `total_amount = 871200.0`.
5. **Đồng bộ toàn bộ sang 4 repo CRM clone** (`crm-module`, `crm-cloudgate`, `crm-securityzone`, `crm-timetech`).

**File liên quan**:
- `linkedin-crawler-ui/modules/quotes/utils/quoteCalculations.ts`
- `linkedin-crawler-ui/modules/crm/components/QuoteWorkspaceModal.tsx`
- `linkedin-crawler-ui/modules/crm/styles/quote-center.css`
- `linkedin-crawler-ui/modules/quotes/components/QuoteDetailPage.tsx`
- `linkedin-crawler-ui/modules/quotes/components/PublicQuotePage.tsx`
- `linkedin-crawler-ui/components/all-platform/customers/QuoteQuickViewDrawer.tsx`
- `linkedin_group_crawler/app/modules/all_platform/services/supabase_quote_service.py`
- `linkedin_group_crawler/tests/test_quote_discount_precision.py`
- Main + 4 clones.

## 50. OnlyOffice hiển thị popup "Lỗi: Tải về không thành công." khi mở chỉnh sửa Word hợp đồng

**Triệu chứng**:
Khi vào tab "Chỉnh sửa (Word)" trên wizard chỉnh sửa hợp đồng (ví dụ `HD/2026/0011.docx`), editor OnlyOffice xuất hiện nhưng lập tức bị chặn bởi popup:
- "Lỗi: Tải về không thành công." kèm nút OK.
- Thanh cảnh báo màu đỏ ở trên: "OnlyOffice báo lỗi trong lúc chỉnh sửa — thử tải lại."

**Nguyên nhân gốc**:
1. **Dấu gạch chéo `/` trong `document.title`**:
   `_editor_config_for_session` dùng trực tiếp `f"{contract.get('contract_number') or contract_id}.docx"`. Khi số hợp đồng có định dạng `HD/2026/0011`, tên tài liệu trở thành `HD/2026/0011.docx`.
   Theo tài liệu chính thức OnlyOffice Document Server: *"The title must not contain restricted characters (\ / : * ? " < > |)"*. Trong Linux filesystem, dấu `/` được hiểu là phân cách thư mục, khiến DocService không thể ghi cache file và kích hoạt lỗi nội bộ `Asc.c_oAscError.ID.DownloadError` (-81).
2. **`document_key` cũ bị giữ nguyên khi resume phiên**:
   Khi mở lại phiên đang chỉnh sửa (`existing`), backend trả lại đúng `document_key` cũ. Document Server OnlyOffice đã ghi nhớ trạng thái lỗi của key đó trong bộ nhớ cache, nên bấm "Thử tải lại" hay reload trang vẫn gặp lại lỗi cũ.
3. **Hardcode `X-Forwarded-Proto https` trong nginx**:
   Tại `location /onlyoffice-ds/` của `nginx.conf`, header `X-Forwarded-Proto` bị gán cứng thành `https`. Trên môi trường Dev local (`http://localhost:18090`), OnlyOffice hiểu nhầm client đang chạy HTTPS nên sinh ra các URL tải và WebSocket dưới dạng `https://` và `wss://`, dẫn tới lỗi kết nối.
4. **Endpoint `/draft-file` thiếu method `HEAD`**:
   Một số probe request kiểm tra metadata file gửi method `HEAD` nhận phản hồi `405 Method Not Allowed`.

**Cách fix**:
1. **Khử trùng tiêu đề tài liệu (`contract_edit_service.py`)**:
   Thay thế toàn bộ ký tự cấm `[\\/*?:"<>|]` bằng dấu gạch ngang `-` (`safe_title = re.sub(r'[\\/*?:"<>|]', "-", raw_num).strip() + ".docx"`), tiêu đề trở thành `HD-2026-0011.docx`.
2. **Làm mới `document_key` khi nạp lại phiên**:
   Cập nhật `new_doc_key = f"mk_{existing['id']}_{int(time.time())}"` và lưu vào DB mỗi khi `start_edit_session` gặp phiên đang mở, đảm bảo OnlyOffice nạp file nháp sạch từ storage.
3. **Linh hoạt `X-Forwarded-Proto` trong `nginx.conf`**:
   Bổ sung `map $http_x_forwarded_proto $forwarded_proto` để tôn trọng HTTPS khi có proxy trước đó (production), và dùng `$scheme` (HTTP) cho môi trường local dev.
4. **Hỗ trợ `HEAD` trên endpoint `/draft-file`**:
   Gắn `@contract_edit_router.head("/{contract_id}/edit/draft-file")` trên router FastAPI.
5. Recreate container `crm-module-onlyoffice` với mount `local-production-linux.json` (`allowPrivateIPAddress: true`).
6. Cập nhật test case `test_editor_config_generation` trong `test_onlyoffice_draft_config.py` kiểm tra tiêu đề an toàn.
7. Đồng bộ sang toàn bộ 4 repo CRM clone (`crm-module`, `crm-cloudgate`, `crm-securityzone`, `crm-timetech`).

**File liên quan**:
- `linkedin_group_crawler/app/modules/all_platform/services/contract_edit_service.py`
- `linkedin_group_crawler/app/modules/all_platform/routers/contract_edit.py`
- `linkedin_group_crawler/tests/test_onlyoffice_draft_config.py`
- `nginx-router/nginx.conf`
- `crm-module/nginx/nginx.conf`
- `crm-module/onlyoffice/local-production-linux.json`
- Đồng bộ toàn bộ sang 4 repo CRM clone.

