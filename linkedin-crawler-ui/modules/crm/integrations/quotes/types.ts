import type { IssuerCompany, Quote, QuoteData, QuoteForm, QuoteItem, VillaSolutionItem } from '@/modules/quotes';
import { resolveToggleableColumns } from '@/modules/quotes/utils/quoteColumns';
import { resolveToggleableSummaryFields } from '@/modules/quotes/utils/quoteSummaryFields';
import type { DealFormState } from '../../components/DealFormFields';
import { loadVisibleColumnsDraft, loadVisibleSummaryFieldsDraft } from './quoteColumnsDraft';

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

export function quoteDraftFromForm(form: QuoteForm, dealDraft?: DealFormState, issuerCompany?: IssuerCompany): QuoteDraft {
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
    data.visibleColumns = draftColumns && draftColumns.length ? draftColumns : toggleableKeys;
  }
  if (!data.visibleSummaryFields) {
    // Seed mac dinh "Tong hop gia" - mirror y het cach visibleColumns dang seed
    // o tren (uu tien nhap dang do trong localStorage theo dung mau nay truoc
    // khi dung mac dinh cua schema).
    const toggleableSummaryKeys: string[] = resolveToggleableSummaryFields(form.schemaJson).map(field => field.key);
    const draftSummaryFields = loadVisibleSummaryFieldsDraft(form.id)?.filter(key => toggleableSummaryKeys.includes(key));
    data.visibleSummaryFields = draftSummaryFields && draftSummaryFields.length ? draftSummaryFields : toggleableSummaryKeys;
  }

  if (dealDraft) {
    Object.assign(data, {
      customerRecipient: dealDraft.customerName || dealDraft.companyName,
      customerCompanyName: dealDraft.companyName || dealDraft.customerName,
      customerContactName: dealDraft.customerName,
      customerAddress: dealDraft.address,
      customerPhone: dealDraft.phone,
      customerEmail: dealDraft.email,
      customerTaxCode: dealDraft.taxCode,
    });
  }

  if (issuerCompany) applyIssuerCompanySnapshot(data, issuerCompany);

  return { data, items: quoteItems, solutionItems };
}

/** Đơn vị phát hành báo giá (bên bán) - SNAPSHOT thẳng vào data (mutate in place),
 * không lưu tham chiếu sống. Sửa công ty trong danh mục sau này không ảnh hưởng
 * báo giá đã tạo/sửa từ snapshot này. Dùng cả lúc dựng QuoteDraft mới
 * (quoteDraftFromForm) lẫn khi đổi công ty phát hành ở chế độ sửa (Bước 1). */
export function applyIssuerCompanySnapshot(data: QuoteData, issuerCompany: IssuerCompany): void {
  Object.assign(data, {
    sellerCompanyName: issuerCompany.legalName,
    sellerTaxCode: issuerCompany.taxCode || '',
    sellerAddress: issuerCompany.address || '',
    sellerContactName: issuerCompany.contactName || '',
    sellerPhone: issuerCompany.phone || '',
    sellerEmail: issuerCompany.email || '',
    sellerWebsite: issuerCompany.website || '',
    sellerLogo: issuerCompany.logoUrl || '',
  });
}

/** Dựng lại QuoteDraft từ 1 báo giá đã tồn tại (chế độ sửa) - để prefill wizard
 * đúng dữ liệu đã lưu, không phải giá trị mặc định của mẫu. */
export function quoteDraftFromExistingQuote(quote: Quote): QuoteDraft {
  const { solutionItems, ...data } = quote.data || {};
  // Bao gia luu truoc khi co tinh nang "Cot hien thi" se khong co visibleColumns
  // trong data da luu - mac dinh hien du (khop hanh vi cu, khong bi rot cot),
  // tinh theo dung cot cua mau bao gia nay (khong phai danh sach co dinh).
  if (!data.visibleColumns) {
    data.visibleColumns = resolveToggleableColumns(quote.formSnapshot, quote.items || []).map(column => column.key);
  } else if (Array.isArray(data.visibleColumns) && !data.visibleColumns.includes('vatRate')) {
    // "vatRate" moi them vao danh sach toggle - bao gia da luu visibleColumns
    // TRUOC do khong biet field nay, phai tu bo sung de checkbox VAT hien dung
    // trang thai (truoc day VAT luon hien, khong toggle duoc).
    data.visibleColumns = [...data.visibleColumns, 'vatRate'];
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
