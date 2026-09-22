import type { CustomBlock, IssuerCompany, Quote, QuoteData, QuoteForm, QuoteItem, VillaSolutionItem } from '@/modules/quotes';
import { resolveDefaultVisibleColumnKeys, resolveToggleableColumns } from '@/modules/quotes/utils/quoteColumns';
import { resolveVisibleCustomerFieldKeys } from '@/modules/quotes/utils/quoteCustomerFields';
import { resolveToggleableSummaryFields } from '@/modules/quotes/utils/quoteSummaryFields';
import type { DealFormState } from '../../components/DealFormFields';
import { loadVisibleColumnsDraft, loadVisibleCustomerFieldsDraft, loadVisibleSummaryFieldsDraft } from './quoteColumnsDraft';

export type WizardStep = 1 | 2 | 3 | 4;

export interface QuoteDraft {
  data: QuoteData;
  items: QuoteItem[];
  solutionItems: VillaSolutionItem[];
  /** Chiet khau tong (quote.overallDiscountPercent) - CHI passthrough (khong
   * co UI nhap moi o luong "Tao bao gia" cu, xem ReviewQuoteStep.tsx) de khoi
   * tong tien hien dung khi sua 1 quote da co san gia tri nay tu luong
   * Workspace. Mau MOI tao qua luong cu se khong co gia tri (undefined - dong
   * Giam gia tong tu an, dung hanh vi cu 100%). */
  overallDiscountPercent?: number | null;
}

export function emptyQuoteDraft(): QuoteDraft {
  return { data: {}, items: [], solutionItems: [] };
}

export function quoteDraftFromForm(form: QuoteForm, dealDraft?: DealFormState, issuerCompany?: IssuerCompany, creatorName?: string): QuoteDraft {
  const fields = form.schemaJson.sections.flatMap(section => section.fields);
  const data: QuoteData = {};
  fields.forEach(field => {
    if (field.type === 'repeater-table') return;
    if (field.defaultValue !== undefined) data[field.key] = field.defaultValue;
  });
  const solutionField = fields.find(field => field.key === 'solutionItems');
  const solutionItems = Array.isArray(solutionField?.defaultValue)
    ? (solutionField?.defaultValue as VillaSolutionItem[])
    : [];
  const quoteItemsField = fields.find(field => field.key === 'quoteItems');
  const quoteItems = Array.isArray(quoteItemsField?.defaultValue)
    ? (JSON.parse(JSON.stringify(quoteItemsField.defaultValue)) as QuoteItem[])
    : [];

  if (fields.some(field => field.key === 'quoteDate') && !data.quoteDate) {
    data.quoteDate = new Date().toISOString().slice(0, 10);
  }
  if (!data.visibleColumns) {
    const toggleableKeys = resolveToggleableColumns(form.schemaJson, quoteItems).map(column => column.key);
    // Uu tien khoi phuc nhap "Cot hien thi" da luu (localStorage, theo dung
    // mau nay - xem quoteColumnsDraft.ts) TRUOC KHI dung mac dinh "hien tat
    // ca" - vd nguoi dung tung tao bao gia dung mau nay, tick/bo tick vai cot,
    // roi refresh trang/dong modal giua chung chua kip luu - lan tao bao gia
    // MOI cung mau nay se tu khoi phuc dung lua chon cu thay vi luon reset ve
    // hien het. Loc lai theo dung tap cot THAT SU cua mau (phong khi mau doi
    // schema sau khi luu nhap), rong thi coi nhu khong co nhap hop le, dung
    // mac dinh hien tat ca.
    const draftColumns = loadVisibleColumnsDraft(form.id)?.filter(key => toggleableKeys.includes(key));
    data.visibleColumns = draftColumns && draftColumns.length ? draftColumns : resolveDefaultVisibleColumnKeys(form.schemaJson, quoteItems);
  }
  if (!data.visibleSummaryFields) {
    // Seed mac dinh "Tong hop gia" - mirror y het cach visibleColumns dang seed
    // o tren (uu tien nhap dang do trong localStorage theo dung mau nay truoc
    // khi dung mac dinh cua schema).
    const toggleableSummaryKeys: string[] = resolveToggleableSummaryFields(form.schemaJson).map(field => field.key);
    const draftSummaryFields = loadVisibleSummaryFieldsDraft(form.id)?.filter(key => toggleableSummaryKeys.includes(key));
    data.visibleSummaryFields = draftSummaryFields && draftSummaryFields.length ? draftSummaryFields : toggleableSummaryKeys;
  }
  if (!data.visibleCustomerFields) {
    const draftCustomerFields = loadVisibleCustomerFieldsDraft(form.id);
    data.visibleCustomerFields = draftCustomerFields && draftCustomerFields.length
      ? resolveVisibleCustomerFieldKeys(form.schemaJson, draftCustomerFields)
      : resolveVisibleCustomerFieldKeys(form.schemaJson, null);
  }

  if (dealDraft) {
    // BUG THAT DA GAP (D, xem CLAUDE.md fact #5): TRUOC DAY 2 dong duoi hardcode
    // ve dealDraft.customerName (ten tren HO SO Customer, khong phai Contact
    // THAT dang lien he) cho ca "Kính gửi" lan "Người liên hệ" - khach hang
    // nhieu Contact/da doi nguoi lien he van bi in nham ten cu. Uu tien
    // dealDraft.contactName (Contact THAT chon o Buoc 1 qua danh sach
    // crm_contacts, xem SelectCustomerStep.tsx) - dealDraft.customerName van
    // giu lam fallback CUOI CUNG (khong phai companyName) vi 2 field nay luon
    // duoc SelectCustomerStep dong bo gia tri voi nhau (xem comment o do), chi
    // khac nhau khi dealDraft đến tu 1 nguon CU chua qua flow Contact moi
    // (vd lockedDealForStep1 fallback trong CreateQuoteModal.tsx) - KHONG bao
    // gio fallback ve companyName/ten cong ty (yeu cau ro "không fallback về
    // customerName [cua Customer/cong ty]" - de trong con hon in nham ten).
    const recipientName = dealDraft.contactName || dealDraft.customerName || '';
    Object.assign(data, {
      customerRecipient: recipientName,
      customerCompanyName: dealDraft.companyName || dealDraft.customerName,
      customerContactName: recipientName,
      customerAddress: dealDraft.address,
      customerPhone: dealDraft.phone,
      customerEmail: dealDraft.email,
      customerTaxCode: dealDraft.taxCode,
      // (D) Snapshot id Contact THAT (crm_contacts.id) da chon luc tao bao gia
      // nay - CHI de tham chieu/debug (vd sau nay muon biet bao gia nay gan
      // voi Contact nao), KHONG dung de doc lai song (moi gia tri hien thi
      // van la 3 field snapshot phia tren, dung nguyen tac "data la JSON diem-
      // thoi-gian" chung cua ca file nay).
      customerContactId: dealDraft.primaryContactId || undefined,
    });
  }

  if (issuerCompany) {
    applyIssuerCompanySnapshot(data, issuerCompany);
    applyIssuerPaymentTermsSnapshot(data, issuerCompany);
  }

  // "Người liên hệ" (sellerContactName, hien tren PDF o khoi "Người phụ
  // trách") PHAI la nguoi THAT SU dang tao bao gia nay, KHONG phai contact
  // mac dinh cua cong ty phat hanh (issuerCompany.contactName, truoc day de
  // "Lan Anh") - de sau khi applyIssuerCompanySnapshot() (co the vua ghi de
  // bang contact cua cong ty) de luon uu tien ten nguoi tao neu co.
  if (creatorName) data.sellerContactName = creatorName;

  return { data, items: quoteItems, solutionItems };
}

/** Đơn vị phát hành báo giá (bên bán) - SNAPSHOT thẳng vào data (mutate in place),
 * không lưu tham chiếu sống. Sửa công ty trong danh mục sau này không ảnh hưởng
 * báo giá đã tạo/sửa từ snapshot này. Dùng cả lúc dựng QuoteDraft mới
 * (quoteDraftFromForm) lẫn khi đổi công ty phát hành ở chế độ sửa (Bước 1).
 * KHONG dong den sellerContactName - field do la "Nguoi lien he"/nguoi tao
 * bao gia (xem quoteDraftFromForm), khong phai contact cua cong ty, doi cong
 * ty phat hanh khong duoc phep ghi de mat ten nguoi tao da dien. */
export function applyIssuerCompanySnapshot(data: QuoteData, issuerCompany: IssuerCompany): void {
  Object.assign(data, {
    sellerCompanyName: issuerCompany.legalName,
    sellerTaxCode: issuerCompany.taxCode || '',
    sellerAddress: issuerCompany.address || '',
    sellerPhone: issuerCompany.phone || '',
    sellerEmail: issuerCompany.email || '',
    sellerWebsite: issuerCompany.website || '',
    sellerLogo: issuerCompany.logoUrl || '',
  });
}

// BUG THAT DA GAP (fix 2026-09-22): QuoteWorkspaceModal.createRequest() (va
// draftPreviewData) LUON tu seed san 1 block 'payment_terms' voi noi dung
// dang "Thanh toán trong {N} ngày kể từ ngày duyệt báo giá." (N tu dropdown
// "Thanh toán" 15/30/45/60, mac dinh '30') NGAY LUC TAO quote, KE CA khi
// Sale chua he dung toi dropdown do - tuc MOI quote tao qua Workspace deu co
// san 1 block "co noi dung" truoc khi applyIssuerPaymentTermsSnapshot() duoc
// goi. Guard cu `if (existing && existing.content.trim()) return;` vi vay
// LUON đúng => Điều khoản thanh toán mặc định của Đơn vị phát hành KHONG BAO
// GIO duoc ap dung duoc trong thuc te (nguoi dung bao "thêm đk thanh toán
// rồi mà trong báo giá chưa hiện" - day chinh la nguyen nhan, khong phai do
// timing tao quote truoc/sau khi set payment_terms). Sua: chi coi la "Sale
// da tu go/tuy chinh that" (KHONG duoc ghi de) neu noi dung KHONG khop dung
// mau tu-dong-sinh boi dropdown o tren - mau boilerplate nay khong phai
// "noi dung nguoi dung nhap", nen an toan de ghi de bang Dieu khoan mac dinh
// that su cua issuer.
const AUTO_GENERATED_PAYMENT_TERMS_PATTERN = /^Thanh toán trong \d+ ngày kể từ ngày duyệt báo giá\.$/;

/** (I) "Điều khoản thanh toán" mặc định của Đơn vị phát hành - SNAPSHOT vào
 * custom block 'payment_terms' của báo giá. Goi khi: (1) tao quote MOI
 * (quoteDraftFromForm, QuoteWorkspaceModal.createRequest), (2) Sale
 * chon/doi Đơn vị phát hành cho 1 quote DA TON TAI (updateQuoteIssuerCompany
 * trong QuoteWorkspaceModal.tsx) - CA 2 truong hop deu an toan nho guard
 * ben duoi: KHONG lam gi neu issuer khong co payment_terms, hoac quote đã có
 * sẵn 1 block 'payment_terms' co noi dung THAT SU do Sale tu go (khac mau
 * tu-dong-sinh o tren) - tôn trọng nội dung Sale đã tự nhập/snapshot cũ của
 * báo giá đã duyệt trước đó, dù đến từ đâu). */
export function applyIssuerPaymentTermsSnapshot(data: QuoteData, issuerCompany: IssuerCompany): void {
  const defaultTerms = issuerCompany.paymentTerms?.trim();
  if (!defaultTerms) return;
  const blocks = Array.isArray(data.customBlocks) ? data.customBlocks : [];
  const existing = blocks.find(block => block.kind === 'payment_terms');
  const existingContent = existing?.content.trim() || '';
  if (existingContent && !AUTO_GENERATED_PAYMENT_TERMS_PATTERN.test(existingContent)) return;
  const seededBlock: CustomBlock = {
    id: existing?.id || `custom-${Date.now()}-payment_terms`,
    kind: 'payment_terms',
    title: existing?.title || 'Điều khoản thanh toán',
    content: defaultTerms,
  };
  data.customBlocks = existing
    ? blocks.map(block => (block.kind === 'payment_terms' ? seededBlock : block))
    : [...blocks, seededBlock];
}

/** Dựng lại QuoteDraft từ 1 báo giá đã tồn tại (chế độ sửa) - để prefill wizard
 * đúng dữ liệu đã lưu, không phải giá trị mặc định của mẫu. */
export function quoteDraftFromExistingQuote(quote: Quote): QuoteDraft {
  const { solutionItems, ...data } = quote.data || {};
  // Bao gia luu truoc khi co tinh nang "Cot hien thi" se khong co visibleColumns
  // trong data da luu - mac dinh hien du (khop hanh vi cu, khong bi rot cot),
  // tinh theo dung cot cua mau bao gia nay (khong phai danh sach co dinh).
  if (!data.visibleColumns) {
    data.visibleColumns = resolveDefaultVisibleColumnKeys(quote.formSnapshot, quote.items || []);
  } else if (Array.isArray(data.visibleColumns) && !data.visibleColumns.includes('vatRate')) {
    // "vatRate" moi them vao danh sach toggle - bao gia da luu visibleColumns
    // TRUOC do khong biet field nay, phai tu bo sung de checkbox VAT hien dung
    // trang thai (truoc day VAT luon hien, khong toggle duoc).
    data.visibleColumns = [...data.visibleColumns, 'vatRate'];
  }
  if (!data.visibleCustomerFields) {
    data.visibleCustomerFields = resolveVisibleCustomerFieldKeys(quote.formSnapshot, null);
  }
  return {
    data,
    items: quote.items || [],
    solutionItems: Array.isArray(solutionItems) ? solutionItems : [],
    // Passthrough thuan tuy (khong co UI nhap moi o day) - quote.overallDiscountPercent
    // truoc day bi BO SOT hoan toan khoi QuoteDraft, khien khoi tong tien luon
    // hien nhu chua co chiet khau du quote da co gia tri that (vd sua qua luong
    // Workspace roi mo lai o luong cu).
    overallDiscountPercent: quote.overallDiscountPercent ?? null,
  };
}
