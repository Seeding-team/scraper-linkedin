import type {
  CreateIssuerCompanyInput,
  CreateQuoteFormInput,
  CreateQuoteInput,
  IssuerCompany,
  Quote,
  QuoteForm,
  QuoteTelegramLog,
  QuoteVersionResult,
  UpdateIssuerCompanyInput,
  UpdateQuoteFormInput,
  UpdateQuoteInput,
} from '../types';
import type { ServiceCatalogOptions } from '../../service-catalog/types';

export interface QuoteRepository {
  getForms(): Promise<QuoteForm[]>;
  getForm(id: string): Promise<QuoteForm>;
  getPublicForm(token: string): Promise<QuoteForm>;
  createForm(input: CreateQuoteFormInput): Promise<QuoteForm>;
  updateForm(id: string, input: UpdateQuoteFormInput): Promise<QuoteForm>;
  deleteForm(id: string): Promise<{ deleted: boolean; archived: boolean; form?: QuoteForm }>;
  duplicateForm(id: string): Promise<QuoteForm>;
  shareForm(id: string, enabled?: boolean): Promise<QuoteForm>;

  getQuotes(): Promise<Quote[]>;
  getQuote(id: string): Promise<Quote>;
  getPublicQuote(token: string): Promise<Quote>;
  createQuote(input: CreateQuoteInput): Promise<Quote>;
  updateQuote(id: string, input: UpdateQuoteInput): Promise<Quote>;
  deleteQuote(id: string): Promise<void>;
  /** Duyệt báo giá — khoá chỉnh sửa vĩnh viễn, sinh public link. */
  approveQuote(id: string): Promise<Quote>;
  /** Lưu thay đổi cuối + duyệt atomic (dùng khi bấm "Duyệt báo giá" trong modal đang sửa). */
  updateAndApproveQuote(id: string, input: UpdateQuoteInput): Promise<Quote>;
  /** Tạo phiên bản mới (V2/V3...) từ bản ĐÃ DUYỆT mới nhất trong chuỗi của
   * id được truyền vào — có thể redirect (created=false, trả về bản nháp có
   * sẵn) hoặc nguồn copy thật khác id được bấm (redirectedFromClickedQuote). */
  createQuoteVersion(id: string): Promise<QuoteVersionResult>;
  /** Toàn bộ phiên bản (V1..Vn) cùng chuỗi với id này, mới nhất trước. */
  getQuoteVersions(id: string): Promise<Quote[]>;

  /** Danh mục dịch vụ liên kết với 1 mẫu báo giá (danh sách id nhóm). */
  getFormCatalogLinks(formId: string): Promise<string[]>;
  setFormCatalogLinks(formId: string, catalogItemIds: string[]): Promise<string[]>;
  /** Gói bán + dịch vụ thành phần khả dụng cho 1 mẫu báo giá, dùng dựng dropdown khi điền báo giá. */
  getServiceCatalogOptions(formId: string): Promise<ServiceCatalogOptions>;

  /** Danh sách công ty phát hành báo giá (bên bán) — dropdown "Đơn vị phát hành
   * báo giá" ở Bước 1 wizard tạo báo giá. includeInactive=true dùng cho trang
   * quản trị danh mục công ty. */
  getIssuerCompanies(includeInactive?: boolean): Promise<IssuerCompany[]>;
  createIssuerCompany(input: CreateIssuerCompanyInput): Promise<IssuerCompany>;
  updateIssuerCompany(id: string, input: UpdateIssuerCompanyInput): Promise<IssuerCompany>;

  /** Gửi 1 báo giá ĐÃ DUYỆT qua Telegram (group/topic cố định, cấu hình ở backend). */
  sendQuoteTelegram(quoteId: string): Promise<QuoteTelegramLog>;
  /** Lịch sử gửi Telegram của 1 báo giá, mới nhất trước. */
  getQuoteTelegramLog(quoteId: string): Promise<QuoteTelegramLog[]>;
}
