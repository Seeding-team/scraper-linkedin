# CRM — Flow Map (Lead ↔ Khách hàng ↔ Deal ↔ Báo giá ↔ Hợp đồng)

**Trạng thái**: audit 2026-10-10, đọc source thực tế. Main app audit sâu; 3 clone kiểm tra nhẹ (xem
`SHARED_COMPONENT_MAP.md` cho chi tiết parity từng file). Đọc cùng với `CRM_FUNCTIONAL_SPEC.md` (mô tả
nghiệp vụ) và `SHARED_COMPONENT_MAP.md` (mô tả entry point → code).

---

## 1. Sơ đồ liên kết bảng (FK thật, đã xác nhận qua migration + code)

```
crm_leads  (Lead thô, CHƯA xác minh)
   │  RPC crm_convert_lead (migration 078) — 1 transaction atomic
   ▼
crm_customers  ◄───────────────────────────────┐  find-or-create theo email/phone/tax_code/
   │  id                                        │  website/name, trong ĐÚNG instance
   │                                             │
   │  customer_leads.customer_id ──────────────► RPC crm_create_customer_with_deal (077)
   ▼                                                cũng find-or-create Customer y hệt
customer_leads  ("Deal"/"Cơ hội" — KHÔNG phải crm_leads, tên hay gây nhầm)
   │  id
   │
   ├── quotes.deal_id ──► quotes  (Báo giá)
   │                         │  quotes.id
   │                         ▼
   ├── contracts.deal_id ──► contracts  (Hợp đồng) ◄── contracts.quote_id (liên kết báo giá gốc)
   │                         ▲
   └── contracts.customer_id ┘  (hợp đồng tạo THẲNG trên Customer, bỏ qua Deal — migration 130;
                                  khi có cả deal_id lẫn customer_id, Deal luôn thắng khi resolve
                                  customer_id thật — _resolve_customer_id(), ưu tiên tránh lệch)

crm_contacts.customer_id ──► crm_customers   (Người liên hệ, tạo kèm lúc convert Lead hoặc tạo riêng)
projects.customer_id ──► crm_customers       (Dự án, không qua Deal — 1 Dự án có nhiều Deal)
customer_leads.project_id ──► projects       (Deal gắn với ĐÚNG 1 Dự án, tùy chọn)
```

**Điểm dễ nhầm nhất trong toàn bộ schema**: `customer_leads` = bảng "Deal"/"Cơ hội" trong UI, KHÔNG
phải Lead. `crm_leads` mới là Lead thô. Hai bảng độc lập, chỉ nối nhau qua RPC `crm_convert_lead` lúc
chuyển đổi — sau khi convert, `crm_leads` row vẫn còn (đánh dấu `status='converted'` +
`converted_customer_id`/`converted_contact_id`/`converted_deal_id`), không bị xóa.

---

## 2. Luồng tạo mới từ đầu (Lead-first)

```
1. Khách để lại thông tin (form web/inbox Zalo-FB/nhập tay)
      → crm_leads row (status mặc định new_lead/mql tùy entry point)
2. Presale/Sale làm việc với Lead → cập nhật field → engine chấm điểm
   (crm_lead_rule_service, chạy cả Python lẫn JS mirror) → status tự chuyển
   mql → nurture/disqualified/sql (KHÔNG commit DB, chỉ hiển thị preview
   cho tới khi user bấm Lưu)
3. Khi đạt SQL + chọn Team Sale + chọn Sale nhận bàn giao
      → "Xác nhận tạo cơ hội" → RPC crm_convert_lead (1 transaction):
         - crm_customers (tìm-hoặc-tạo)
         - crm_contacts  (luôn tạo 1 dòng)
         - customer_leads (Deal mới, stage mặc định 'dealing')
         - customer_lead_activity_log (action=converted_from_lead)
         - UPDATE crm_leads SET status='converted', converted_*_id=...
4. (song song, KHÔNG nằm trong transaction) ghi nhận bàn giao
   (crm_lead_handover_service.record_convert_handover, có thể gửi email)
5. Điều hướng → /customers/{id}?tab=quotes
```

## 2b. Luồng tạo mới KHÔNG qua Lead (Customer-first / Deal-first)

```
"Tạo cơ hội bán hàng" (CreateOpportunityDrawer) hoặc "Tạo cơ hội nhanh" (DealFormModal)
      → RPC crm_create_customer_with_deal (1 transaction):
         - crm_customers (tìm-hoặc-tạo theo email/phone/tax_code/website/name)
         - customer_leads (Deal mới)
         - customer_lead_activity_log
      → (ngoài RPC, follow-up) tạo Project mới nếu user gõ tên dự án chưa có sẵn
```

Cả 2 luồng (2 và 2b) đều dùng pattern "atomic RPC tìm-hoặc-tạo Customer + tạo Deal", nhưng là **2 RPC
hoàn toàn khác nhau** (`crm_convert_lead` vs `crm_create_customer_with_deal`) — sửa logic tìm-trùng/
dedup ở 1 RPC KHÔNG tự động áp dụng cho RPC kia.

**Luồng thứ 4, tách biệt hoàn toàn khỏi cả 2 RPC trên** (xem `SHARED_COMPONENT_MAP.md` mục 1, path D):
`CrmCustomerModal.tsx` (dùng trong inbox Zalo/Facebook) ghi thẳng `customer_leads`, KHÔNG tạo/liên kết
`crm_customers`, KHÔNG dùng RPC nào. 1 Deal tạo qua đường này có thể "mồ côi" (không có Customer liên
kết) cho tới khi ai đó thủ công gán `customer_id`.

---

## 3. Luồng Deal → Báo giá → Hợp đồng (vòng đời bán hàng)

```
customer_leads (Deal, stage 'dealing')
   │
   │  tạo Báo giá (bất kỳ entry point nào, xem SHARED_COMPONENT_MAP.md mục 2)
   ▼
quotes (status='draft', processing_stage='request'/'technical'/'pricing'/'review'/
        'ready_to_publish'/'published')
   │
   │  _wrap_deal_stage_sync() chạy SAU MỌI thao tác tạo/duyệt/hủy/version:
   │    - processing_stage ∈ {pricing,review,ready_to_publish,published}
   │        → deal_stage tự chuyển 'proposal_sent' (3), nếu đang thấp hơn
   │    - status ∈ {approved,confirmed}
   │        → deal_stage tự chuyển 'negotiation' (4), nếu đang thấp hơn
   │    - (song song) recompute_customer_progress(customer_id):
   │        → quote draft → next_action="Theo dõi báo giá", status khách→following
   │        → quote approved/confirmed → next_action="Gửi/chốt báo giá", status→following
   ▼
(Sale chốt được báo giá) → tạo Hợp đồng (AI Copilot hoặc Ghi nhận ngoài)
   │
   ▼
contracts (status='draft' → 'pending_legal' → 'pending_signature' → 'signed' → 'active' → ...)
   │
   │  _sync_contract_deal() chạy SAU MỌI thao tác tạo/sửa/đổi trạng thái/xóa hợp đồng:
   │    - deal_stage → 'contract_signed' (5) NẾU CONTRACT_STAGE_SYNC_ENABLED=True
   │        (HIỆN ĐANG = False — bước này đang bị TẮT, xem REGRESSION_CHECKLIST.md)
   │    - (LUÔN chạy, độc lập cờ trên) recompute_customer_progress(customer_id):
   │        → contract pending_signature → next_action="Theo dõi ký kết", status→following
   │        → contract signed/active/completed
   │              → next_action="Triển khai/chăm sóc", status khách→current_customer
   ▼
(Deal vẫn ở stage 3 hoặc 4 cho tới khi ai đó CHUYỂN TAY sang 5-10, vì bước tự động
 5 đang tắt — đây là lệch hành vi thật giữa "tiến độ Khách hàng" (đã tự nâng lên
 current_customer) và "stage Deal hiển thị trên Kanban" (vẫn kẹt ở negotiation/
 proposal_sent) cho tới khi có người chuyển tay)
```

**Hệ quả thực tế của việc `CONTRACT_STAGE_SYNC_ENABLED=False`**: sau khi ký hợp đồng, nhóm Khách hàng
("Đang bán"→"Đã mua") VÀ "Việc tiếp theo" ĐÃ tự cập nhật đúng, nhưng Deal trên bảng Kanban/pipeline
VẪN hiển thị sai stage (còn ở `negotiation`/`proposal_sent`) cho tới khi có người bấm chuyển tay sang
`contract_signed`(5) hoặc xa hơn. 2 nguồn "tiến độ" (Customer-level vs Deal-stage-level) có thể lệch
nhau tạm thời — không phải lỗi dữ liệu, mà do tính năng Deal-stage-sync-từ-hợp-đồng bị tắt có chủ đích
trong lúc module Hợp đồng đang xây lại.

---

## 4. Luồng "Việc tiếp theo" / tiến độ Khách hàng — chi tiết tính toán

```
compute_customer_progress(customer, deals[], quotes[], contracts[])
  (crm_customer_progress_service.py — hàm thuần, không đọc/ghi DB)

  1. Nếu customer.status == 'not_fit' → trả nhãn cố định "Không còn theo dõi", KHÔNG tính gì thêm.
  2. Chọn "Deal đang hoạt động nhất" trong các deals của customer:
       - loại deal đang ở stage on_hold/lost
       - trong các deal còn lại, ưu tiên theo "tín hiệu cao nhất" (có hợp đồng > có báo giá
         duyệt > có báo giá > không có gì), hòa thì ưu tiên updated_at mới nhất
  3. Từ Deal đã chọn, soi quotes/contracts của ĐÚNG Deal đó (không phải toàn bộ Customer)
       theo thang ưu tiên:
       contract signed/active/completed  → "Triển khai/chăm sóc"  (nhóm → current_customer)
       contract pending_signature        → "Theo dõi ký kết"      (nhóm → following)
       contract draft/pending_legal      → "Theo dõi hợp đồng"    (nhóm → following)
       quote approved/confirmed          → "Gửi/chốt báo giá"     (nhóm → following)
       quote draft (bất kỳ trạng thái sống) → "Theo dõi báo giá"  (nhóm → following)
       không có gì                       → nhãn mặc định theo status hiện tại
  4. Nhóm đề xuất CHỈ áp dụng nếu CAO HƠN nhóm hiện tại (never hạ) — STATUS_ORDER:
       new_lead(0) < following(1) < current_customer(2)
```

Gọi lại (recompute) ghi DB với `.eq("status", current_status)` (update điều kiện) — tránh ghi đè nếu
ai đó vừa đổi status thủ công đúng lúc; thất bại thì chỉ log, không raise.

---

## 5. Luồng phân quyền/tenant áp dụng trên MỌI luồng trên

```
Mọi query CRM (Lead/Customer/Deal/Quote/Contract)
   └─► .eq("instance", settings.crm_instance)   [bắt buộc, đã audit rộng — xem REGRESSION_CHECKLIST.md
                                                   cho các service CHƯA kịp soát]

Mọi hành động ghi (tạo/sửa/xóa/chuyển trạng thái)
   └─► can_write_lead / can_edit_customer / can_write_deal / can_edit_quote / can_edit_contract
         └─► has_full_crm_access(user)?
               ├─ admin/leader                                → true (trừ khi scope='team', xem dưới)
               ├─ quote_business_role ∈ {sale,presale,both}   → true
               ├─ is_sale_member (teams.team_type cũ)         → true
               └─ HR roster Member, team="Sale"                → true
         └─► HOẶC chủ sở hữu trực tiếp (owner_id/sdr_id/leaded_by/created_by)
         └─► HOẶC can_access_by_scope() — user đã được gán 1 "Nhóm quyền" (permission_group,
               opt-in qua permission_group_id) với scope 'team'/'personal'/'deal_assigned'
               khớp Team CRM/chính user đó

Ngoại lệ ĐẶC BIỆT: nếu scope hiệu lực của user = 'team', has_full_crm_access() LUÔN trả False
  cho user đó — kể cả khi user đó đồng thời là admin/leader/sale theo role. Gán Nhóm quyền
  phạm vi "team" cho 1 user full-access trước đó sẽ ÂM THẦM hạ quyền của họ xuống scope hẹp hơn.
```

---

## 6. Luồng "cập nhật không cần F5" (event bus)

```
Bất kỳ repository method nào ghi Deal/Quote/Contract thành công
   (SeedingCrmRepository.createDeal/updateDeal, SeedingQuoteRepository.createQuote/approveQuote/...,
    SeedingContractRepository.createContract/updateContract/updateStatus/...)
      └─► notifyDealsChanged()  (modules/crm/utils/dealSync.ts)
             ├─► window.dispatchEvent(CustomEvent('crm:deals-changed'))   [cùng tab]
             └─► BroadcastChannel('crm-deals-changed').postMessage(...)  [tab khác cùng trình duyệt]

Mọi trang/panel đang mở, có gọi useDealsChanged(callback)
      └─► tự fetch lại dữ liệu THẬT từ server (KHÔNG patch lạc quan state cũ)
```

Nếu thêm 1 action ghi mới (tạo/sửa Deal/Quote/Contract) mà QUÊN gọi `notifyDealsChanged()` (hoặc quên
gọi callback `onCreated`/tương đương ở MỌI nhánh thành công, không chỉ nhánh "ở lại trang") → UI khác
sẽ không tự cập nhật, y hệt bug đã gặp và fix ở `CreateOpportunityDrawer`/`SeedingCrmRepository` phiên
2026-10-10 (xem `thao/CRM_KNOWN_BUGS_FIXED.md` mục 7).
