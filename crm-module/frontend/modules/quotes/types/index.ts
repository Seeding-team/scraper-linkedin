export type QuoteFormStatus = 'active' | 'inactive' | 'archived';
export type QuoteStatus = 'draft' | 'confirmed' | 'approved' | 'cancelled';
export type QuoteLayoutType =
  | 'cloudgate_standard_quote'
  | 'villa_solution_package'
  | 'blank_quote';

export type QuoteFieldType =
  | 'text'
  | 'textarea'
  | 'phone'
  | 'email'
  | 'date'
  | 'number'
  | 'select'
  | 'repeater-table'
  | 'auto-number'
  | 'currency'
  | 'calculated'
  | 'repeatable-textarea'
  | 'checkbox';

export interface QuoteField {
  key: string;
  label: string;
  type: QuoteFieldType;
  required?: boolean;
  visible?: boolean;
  editable?: boolean;
  placeholder?: string;
  helpText?: string;
  defaultValue?: unknown;
  options?: string[];
  config?: {
    allowAddRows?: boolean;
    allowDeleteRows?: boolean;
    allowReorderRows?: boolean;
    initialRows?: number;
    columns?: QuoteField[];
    [key: string]: unknown;
  };
}

export interface QuoteSection {
  key: string;
  title: string;
  fields: QuoteField[];
}

export interface QuoteSchema {
  version: number;
  layoutType: QuoteLayoutType;
  sections: QuoteSection[];
}

export interface QuoteForm {
  id: string;
  code: string;
  name: string;
  description: string;
  status: QuoteFormStatus;
  /** Mẫu dùng làm fallback khi công ty phát hành (IssuerCompany) chưa gán
   * defaultQuoteFormId riêng — chỉ đúng 1 mẫu active được set true (unique index
   * ở DB). Xem CreateQuoteModal bước "Khách hàng". */
  isDefaultTemplate?: boolean;
  /** Công ty sở hữu mẫu này — 1 công ty có thể có nhiều mẫu, nhưng 1 mẫu chỉ
   * thuộc đúng 1 công ty (không dùng chung giữa các công ty). undefined/null =
   * mẫu trung tính (vd "Mẫu báo giá chuẩn"), dùng chung cho công ty chưa có mẫu
   * riêng. Xem dropdown "Mẫu báo giá" ở Bước 1 wizard tạo báo giá. */
  issuerCompanyId?: string;
  schemaVersion: number;
  schemaJson: QuoteSchema;
  createdAt: string;
  updatedAt: string;
  sectionCount: number;
  fieldCount: number;
  shareToken?: string;
  shareEnabled?: boolean;
  shareUrl?: string;
}

export type TelegramSendStatus = 'pending' | 'success' | 'failed';

/** 1 lần gửi báo giá qua Telegram (group "Markee Team", topic "Báo giá" cố
 * định) — append-only, mỗi lần bấm gửi/gửi lại tạo 1 dòng mới. */
export interface QuoteTelegramLog {
  id: string;
  quoteId: string;
  chatId: string;
  messageThreadId?: string;
  telegramMessageId?: string;
  status: TelegramSendStatus;
  errorMessage?: string;
  sentById?: string;
  sentAt: string;
}

/** Đơn vị phát hành báo giá (bên bán) — vd SecurityZone/Cloudgate/Markee. Tách biệt
 * với khách hàng CRM (bên nhận). Chọn ở Bước 1 wizard tạo báo giá; thông tin được
 * SNAPSHOT thẳng vào QuoteData lúc chọn (xem quoteDraftFromForm) — sửa công ty ở
 * danh mục sau này không ảnh hưởng báo giá đã tạo. */
export interface IssuerCompany {
  id: string;
  code: string;
  legalName: string;
  brandName?: string;
  address?: string;
  contactName?: string;
  phone?: string;
  email?: string;
  website?: string;
  taxCode?: string;
  logoUrl?: string;
  defaultQuoteFormId?: string;
  status: 'active' | 'inactive';
}

export interface BundleSnapshotComponent {
  componentId: string;
  sku?: string;
  name?: string;
  description?: string;
  unit?: string;
  quantity: number;
  computedQuantity: number;
  displayText: string;
  unitPriceVnd: number;
  sortOrder?: number;
}

export interface QuoteItem {
  id?: string;
  quoteId?: string;
  parentItemId?: string;
  /** Muc cha (Section, "I/II/III..." kieu file Excel) khong tinh tien - server
   * (quote_update RPC, migration 104) tu ep quantity/unitPrice/costPrice ve
   * 0/null cho dong nay bat ke FE gui gi len. 'item' (mac dinh) = hang muc
   * that, tinh tien binh thuong. Neu thuoc 1 nhom, parentItemId tro toi id
   * cua dong section do. */
  rowType?: 'section' | 'item';
  description?: string;
  serviceDescription?: string;
  unit?: string;
  quantity: number;
  unitPrice: number;
  discountPercent?: number;
  discountAmount?: number;
  amountAfterDiscount?: number;
  vatRate: number;
  subtotalAmount?: number;
  vatAmount?: number;
  totalAmount?: number;
  sortOrder?: number;
  children?: QuoteItem[];
  /** Danh mục dịch vụ: truy vết + snapshot USD/VND/tỷ giá đông cứng lúc chọn dịch vụ. */
  catalogItemId?: string;
  bundleSnapshot?: BundleSnapshotComponent[];
  listPriceUsd?: number;
  unitPriceUsd?: number;
  exchangeRate?: number;
  unitPriceVnd?: number;
  /** Gia von/markup noi bo (migration 086) - null = chua nhap (bao gia cu
   * hoac chua ai dien), KHONG bia du lieu. costTotal = quantity*costPrice,
   * tinh o backend, null neu costPrice null. */
  costPrice?: number | null;
  markupPercent?: number | null;
  costTotal?: number | null;
  /** true = hạng mục này không có giá vốn để nhập (migration 090) - cho phép
   * bỏ qua yêu cầu "bắt buộc giá vốn" khi bàn giao sang xử lý giá, KHÁC với
   * costPrice=null mặc định (= "chưa nhập", vẫn bị chặn bàn giao). */
  costNotApplicable?: boolean;
  /** Bảng giá VPS Zone (migration 106) - snapshot đông cứng lúc chọn từ danh
   * mục, KHÔNG BAO GIỜ đọc lại price_book_items sau khi đã chọn. Sửa/override
   * trong quote chỉ ghi vào các field của CHÍNH dòng này, không gọi ngược lại
   * Bảng giá VPS Zone chuẩn. */
  priceBookItemId?: string | null;
  priceBookVersionId?: string | null;
  priceBookSnapshot?: Record<string, unknown> | null;
  costOverrideReason?: string | null;
  costOverrideBy?: string | null;
  costOverrideAt?: string | null;
  costPriceOriginal?: number | null;
  [key: string]: unknown;
}

export interface VillaSolutionItem {
  name: string;
  description?: string;
  originalPrice?: number;
  offerPrice: number;
  note?: string;
  /** Danh mục dịch vụ: truy vết nguồn gốc khi dòng này được chọn từ "+ Chọn từ
   * danh mục" (giống QuoteItem.catalogItemId) — undefined nếu dòng nhập tay
   * ("+ Thêm hạng mục ngoài danh mục"). Chỉ là truy vết, KHÔNG live-join lại
   * Danh mục dịch vụ - giá/tên đã snapshot thẳng vào name/description/offerPrice
   * lúc chọn, sửa danh mục sau này không ảnh hưởng báo giá đã lưu (data JSONB). */
  catalogItemId?: string;
}

/** 7 loại khối nội dung tự do Sale có thể thêm ngay lúc tạo báo giá (không đụng
 * mẫu gốc) — xem CustomBlocksEditor.tsx. Tất cả trừ 'custom_field' chỉ cho phép
 * tối đa 1 khối/báo giá (tránh trùng lặp). */
export type CustomBlockKind =
  | 'scope_of_work'
  | 'timeline'
  | 'handover'
  | 'payment_terms'
  | 'warranty'
  | 'note'
  | 'custom_field';

/** 1 khối nội dung tự do — chỉ lưu trong `QuoteData.customBlocks` của ĐÚNG báo
 * giá đang tạo/sửa, không ghi ngược vào mẫu (`quote_forms.schema_json`). Sống
 * sót qua sửa draft và tạo phiên bản mới vì đi kèm `data` (đã tự schema-less,
 * không cần đổi form_snapshot/backend). */
export interface CustomBlock {
  id: string;
  kind: CustomBlockKind;
  title: string;
  content: string;
}

export interface QuoteData {
  quoteTitle?: string;
  quoteNumber?: string;
  quoteDate?: string;
  validityDays?: number;
  currency?: string;
  solutionItems?: VillaSolutionItem[];
  /** Cột bảng dịch vụ hiện cho KHÁCH (public link/PDF) — không có nghĩa là
   * undefined = hiện hết. Nội bộ (preview/detail) luôn hiện đủ cột, không bị
   * ảnh hưởng bởi field này. Xem QuoteDocumentRenderer (mode==='public'). */
  visibleColumns?: string[];
  customBlocks?: CustomBlock[];
  [key: string]: unknown;
}

export interface Quote {
  id: string;
  accountId?: string;
  contactId?: string;
  dealId?: string;
  quoteFormId: string;
  /** Chỉ dùng để truy vết nguồn gốc — thông tin bên bán hiển thị luôn đọc từ `data`
   * (snapshot lúc tạo/sửa), KHÔNG bao giờ live-join lại quote_issuer_companies. */
  issuerCompanyId?: string;
  quoteNumber: string;
  status: QuoteStatus;
  formSchemaVersion: number;
  formSnapshot: QuoteSchema;
  data: QuoteData;
  items: QuoteItem[];
  subtotalAmount: number;
  vatAmount: number;
  totalAmount: number;
  currency: string;
  issuedAt: string;
  validUntil?: string;
  createdById?: string;
  createdAt: string;
  updatedAt: string;
  updatedById?: string;
  approvedById?: string;
  approvedAt?: string;
  publicToken?: string;
  publicUrl?: string;
  publicEnabled?: boolean;
  /** Chuỗi phiên bản (V1/V2/V3...) — cùng versionChainId là cùng 1 chuỗi báo
   * giá, versionNumber tăng độc lập theo thứ tự tạo (không suy theo ngày).
   * parentQuoteId trỏ bản ngay trước nó trong chuỗi (null nếu là V1 gốc). */
  versionChainId?: string;
  versionNumber?: number;
  parentQuoteId?: string;
  /** Phase 2 "Workspace xu ly bao gia" (migration 085) - buoc xu ly noi bo,
   * chi y nghia khi status='draft' (xem QuoteProcessingStage). Nguoi phu
   * trach ky thuat/bao gia co the khac createdById. */
  processingStage?: QuoteProcessingStage;
  technicalOwnerId?: string;
  quoteOwnerId?: string;
  /** Gia von/loi nhuan (migration 086) - tinh THAT o backend tu cost_price
   * tung dong (khong tin so tong tu FE). hasCostData=false khi CHUA co dong
   * nao nhap cost_price - UI phai hien "Chua co du lieu gia von", KHONG bia
   * so 0. netRevenue = totalAmount - vatAmount (doanh thu thuan, sau chiet
   * khau, TRUOC VAT - khac totalAmount da gom VAT). */
  hasCostData?: boolean;
  costTotal?: number | null;
  netRevenue?: number | null;
  grossProfit?: number | null;
  grossMarginPercent?: number | null;
  /** Quyen DOC (khac hoan toan hasCostData - "Không có quyền xem" != "Chưa
   * có dữ liệu", UI phai phan biet 2 truong hop nay). false = backend da CHU
   * DONG ha costTotal/hasCostData/item.costPrice ve null/false du gia tri
   * that co ton tai, vi user hien tai KHONG co quyen xem gia von (khong phai
   * technical_owner/quote_owner/admin cua quote nay). */
  costViewAllowed?: boolean;
  /** Tuong tu costViewAllowed nhung cho markupPercent (tung dong item) - chi
   * admin/quote_owner (Sale duoc gan) moi co, Presale (chi la technical_owner)
   * KHONG duoc xem markupPercent du co the xem duoc costPrice. */
  pricingViewAllowed?: boolean;
  /** Tuong tu costViewAllowed nhung cho grossProfit/grossMarginPercent -
   * false = khong co quyen xem loi nhuan (chi admin/quote_owner moi co). */
  profitabilityViewAllowed?: boolean;
  /** Phase 1/3 lifecycle that (migration 087) - soft-delete/cancel/publish/
   * send/request-changes. Tat ca deu co the null (chua xay ra). */
  deletedAt?: string | null;
  deletedById?: string | null;
  cancellationReason?: string | null;
  cancelledAt?: string | null;
  cancelledById?: string | null;
  publishedAt?: string | null;
  publishedById?: string | null;
  sentAt?: string | null;
  sentById?: string | null;
  requestedChangesTargetStage?: 'technical' | 'pricing' | null;
  requestedChangesReason?: string | null;
  requestedChangesAt?: string | null;
  requestedChangesById?: string | null;
  /** Du an that (migration 097) - null = bao gia doc lap, khong gan Du an
   * nao (hop le, tuong thich du lieu cu). */
  projectId?: string | null;
  /** SLA XU LY NOI BO that (migration 097) - KHAC HOAN TOAN validUntil
   * (hieu luc bao gia VOI KHACH HANG). slaStartedAt set 1 lan luc "Gui yeu
   * cau xu ly" (request->technical), slaDueAt nguoi tao chon, completedAt
   * CHI set khi gui email thanh cong that. */
  slaStartedAt?: string | null;
  slaDueAt?: string | null;
  completedAt?: string | null;
  /** Giam gia tong cap quote (migration 106, muc 6.9) - null = khong ap dung.
   * Chi anh huong hien thi Buoc 2 (Gia sau giam/Margin sau giam), KHONG dung
   * de tinh lai subtotalAmount/vatAmount/totalAmount o tren. */
  overallDiscountPercent?: number | null;
  /** Toan bo field duoi day CHI CO tren ket qua tu getQuotesByPhase()
   * (backend gom theo version_chain_id + join project/owner cung luc, xem
   * list_quotes_by_phase()) - khong co tren getQuote()/getQuotes() thuong. */
  phase?: QuotePhase;
  versionCount?: number;
  currentVersionNumber?: number;
  /** Gia khach TRUOC VAT, SAU chiet khau - alias cua netRevenue, dat ten
   * rieng cho dung wording cot "GIÁ KHÁCH" trong Quote Center. */
  customerPriceBeforeVat?: number | null;
  project?: { id: string; code: string | null; name: string | null; status: string | null } | null;
  technicalOwner?: { id: string; name: string | null } | null;
  quoteOwner?: { id: string; name: string | null } | null;
}

/** 5 bucket THAT cua Quote Center (Trung tam bao gia) - suy tu
 * processing_stage/status/sent_at THAT o backend (_derive_quote_phase),
 * KHONG phai enum rieng luu trong DB. 'admin_review' la buoc cho Admin duyet
 * (khong phai "CEO review" - he thong khong co role CEO rieng). */
export type QuotePhase = 'presale' | 'sale_markup' | 'admin_review' | 'ready_to_send' | 'sent';

export interface QuotePhaseCounts extends Record<QuotePhase, number> {
  all: number;
}

export interface QuotesByPhaseResult {
  items: Quote[];
  counts: QuotePhaseCounts;
  /** Section 7 - KPI SLA Quote Center. Dem TREN CA TAP DA LOC (bam theo
   * Customer/Project/Owner/Team/Mine/Period hien tai) TRUOC pagination -
   * KHONG phai dem tren `items` (chi 1 trang). */
  slaCounts: { overdue: number; dueSoon: number };
  page: number;
  pageSize: number;
  total: number;
}

export interface QuoteVersionResult {
  quote: Quote;
  created: boolean;
  sourceQuoteId?: string;
  sourceVersionNumber?: number;
  redirectedFromClickedQuote: boolean;
}

/** 4 buoc that (khong phai Presale/Sale/CEO gia) - xem quote_set_processing_stage
 * RPC (migration 085): chi tien, khong lui, chi doi duoc khi status='draft'. */
export type QuoteProcessingStage =
  | 'request'
  | 'technical'
  | 'pricing'
  | 'review'
  | 'ready_to_publish'
  | 'published';

export interface QuoteHandoffChecklist {
  quoteId: string;
  scopeConfirmed: boolean;
  scopeNote?: string | null;
  costConfirmed: boolean;
  costNote?: string | null;
  timelineConfirmed: boolean;
  timelineNote?: string | null;
  assumptionConfirmed: boolean;
  assumptionNote?: string | null;
  handoffNote?: string | null;
  handedOffAt?: string | null;
  handedOffById?: string | null;
  updatedAt?: string | null;
  updatedById?: string | null;
}

export type UpdateQuoteHandoffChecklistInput = Omit<QuoteHandoffChecklist, 'quoteId' | 'handedOffAt' | 'handedOffById' | 'updatedAt' | 'updatedById'>;

export interface QuoteActivityLogEntry {
  id: string;
  quoteId: string;
  actorId?: string;
  action: string;
  changes?: Record<string, unknown> | null;
  createdAt: string;
}

export interface QuoteReference {
  id?: string;
  number?: string;
  url?: string;
  totalAmount?: number;
  status?: QuoteStatus;
}

export interface CreateQuoteFormInput {
  name: string;
  description?: string;
  status: QuoteFormStatus;
  layoutType?: QuoteLayoutType;
  schemaVersion?: number;
  schemaJson: QuoteSchema;
  issuerCompanyId?: string;
}

export type UpdateQuoteFormInput = Partial<CreateQuoteFormInput>;

export interface CreateIssuerCompanyInput {
  code: string;
  legalName: string;
  brandName?: string;
  address?: string;
  contactName?: string;
  phone?: string;
  email?: string;
  website?: string;
  taxCode?: string;
  logoUrl?: string;
  defaultQuoteFormId?: string;
  status?: 'active' | 'inactive';
  sortOrder?: number;
}

export type UpdateIssuerCompanyInput = Partial<CreateIssuerCompanyInput>;

export interface CreateQuoteInput {
  quoteFormId: string;
  dealId?: string;
  issuerCompanyId?: string;
  status?: QuoteStatus;
  data: QuoteData;
  items?: QuoteItem[];
  projectId?: string | null;
  slaDueAt?: string | null;
}

export interface UpdateQuoteInput {
  data?: QuoteData;
  items?: QuoteItem[];
  issuerCompanyId?: string;
  projectId?: string | null;
  slaDueAt?: string | null;
  overallDiscountPercent?: number | null;
}
