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
}

export interface QuoteVersionResult {
  quote: Quote;
  created: boolean;
  sourceQuoteId?: string;
  sourceVersionNumber?: number;
  redirectedFromClickedQuote: boolean;
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
}

export interface UpdateQuoteInput {
  data?: QuoteData;
  items?: QuoteItem[];
  issuerCompanyId?: string;
}
