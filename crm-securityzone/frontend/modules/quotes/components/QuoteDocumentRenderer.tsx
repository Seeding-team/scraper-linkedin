'use client';

import { useRef, useState } from 'react';
import { paymentPlanAmount, paymentPlanPercent, visiblePaymentPlan } from '../utils/paymentPlan';
import type {
  CustomBlock,
  BundleSnapshotComponent,
  QuoteData,
  QuoteField,
  QuoteItem,
  QuoteSchema,
  VillaSolutionItem,
} from '../types';
import {
  calculateItemAfterDiscount,
  calculateItemDiscount,
  calculateItemSubtotal,
  calculateItemTotal,
  calculateItemVat,
  calculateOverallDiscountSummary,
  calculateSectionTotal,
  formatVnd as formatVndRaw,
} from '../utils/quoteCalculations';

// Yeu cau rieng "bỏ 'đ' trong các mẫu báo giá đi" - moi tien te da ghi ro 1
// LAN duy nhat o dau tai lieu ("TIỀN TỆ VND") + header cot ("(VNĐ)"), lap
// lai "đ" tren TUNG so trong bang la du thua. Shadow lai formatVnd CHI
// trong file nay (formatVnd goc o quoteCalculations.ts van giu nguyen "đ"
// cho moi noi khac dang dung, khong doi hanh vi chung).
function formatVnd(value: unknown): string {
  return formatVndRaw(value).replace(/\s*đ$/, '');
}
import { filterRedundantAmountAfterDiscountColumn, normalizeQuoteColumnLabel, resolveDefaultVisibleColumnKeys, resolveQuoteItemColumns, resolveToggleableColumns } from '../utils/quoteColumns';
import {
  getCustomerDisplayFields,
  resolveVisibleCustomerFieldKeys,
} from '../utils/quoteCustomerFields';
import { resolveVisibleSummaryFieldKeys } from '../utils/quoteSummaryFields';

export interface Totals {
  subtotalAmount: number;
  /** Tiền giảm giá (đã tính sẵn = subtotalAmount * discountPercent / 100) - optional
   * để không phá các nơi gọi cũ (villa layout, quote đã lưu trước khi có tính năng
   * giảm giá) chưa truyền field này. */
  discountAmount?: number;
  totalVatAmount: number;
  totalAmount: number;
}

interface Props {
  schemaSnapshot: QuoteSchema;
  quoteData?: QuoteData;
  quoteItems?: QuoteItem[];
  solutionItems?: VillaSolutionItem[];
  totals: Totals;
  mode?: 'preview' | 'detail' | 'public' | 'print';
  /** Bắt preview (mode='preview') tôn trọng quoteData.visibleColumns giống hệt
   * bản khách sẽ nhận - dùng ở bước "Xem trước & gửi" khi tạo báo giá để người
   * tạo thấy đúng bản thật, không phải bản nội bộ đầy đủ cột. Không ảnh hưởng
   * mode='detail' (trang chi tiết nội bộ luôn hiện đủ cột). */
  respectVisibleColumns?: boolean;
  /** "Ngày báo giá chỉ hiển thị khi bấm phát hành" (yeu cau rieng) - truoc
   * khi Admin duyet + phat hanh (processingStage === 'published'), ngay nay
   * CHUA duoc coi la chinh thuc (co the doi lien tuc trong luc con dang
   * chinh sua Bước 1/2/3) nen KHONG hien tren tai lieu, tranh khach hieu
   * nham day la ngay bao gia "chot". Mac dinh false (an) - phai truyen ro
   * true tu noi goi biet chac quote da published. */
  isPublished?: boolean;
  /** BUG THAT DA GAP ("phát hành rồi sao k có số báo giá"): "Số báo giá"
   * hien thi luon doc tu quoteData.quoteNumber (schema-driven field) nhung
   * ma bao gia THAT (vd "202609071410") la 1 cot he thong rieng cua Quote
   * (quote.quoteNumber, tu dong sinh, KHONG BAO GIO duoc dong bo vao
   * data JSONB o bat ky noi nao trong code) - fieldValue('quoteNumber') vi
   * vay LUON rong, hien mai placeholder "[Số báo giá]" du da phat hanh.
   * Truyen thang gia tri THAT tu quote.quoteNumber qua day. */
  quoteNumber?: string;
  /** Chiet khau tong (quote.overallDiscountPercent, migration 106) - null/undefined
   * = khong ap dung (an dong Giam gia tong/Tong sau giam gia). Dung de tinh khoi
   * "Tong hop gia" moi (xem calculateOverallDiscountSummary) - KHONG anh huong
   * totals truyen vao (totals van la so goc, phep tinh chiet khau chi xay ra o
   * tang hien thi trong component nay). */
  overallDiscountPercent?: number | null;
  /** Bật khi renderer đang hiển thị với toolbar "chỉnh xoay ngang/dọc, căn
   * chỉnh cột" luôn hiện sẵn (PublicQuotePage/QuoteDetailPage/QuoteWorkspaceModal)
   * - cho phép kéo giãn cột NGAY CẢ ở mode 'public' (khách/PDF), không chỉ
   * 'preview'/'detail' như mặc định (xem allowColumnResize), VÀ mang độ rộng đã
   * kéo vào bản in thật (mặc định resize chỉ là tiện ích xem màn hình, xem
   * resizedColumnWidths + rule --col-print-w trong quotes.css). */
  printPreviewMode?: boolean;
  /** Hướng giấy khi in - mặc định 'portrait' (giữ nguyên yêu cầu cũ "luôn A4
   * dọc, không tự đổi hướng"). Người dùng chọn 'landscape' ở màn Xem trước khi
   * in (xem usesLandscapePrint bên dưới - trước đây luôn hardcode false). */
  printOrientation?: 'portrait' | 'landscape';
  /** Do rong cot da LUU truoc do (quoteData.printLayoutPrefs.columnWidths,
   * nut "Lưu" tren QuoteDetailPage) - dung lam gia tri KHOI TAO cho
   * resizedColumnWidths thay vi luon bat dau lai tu null (mac dinh %) moi
   * lan mo trang. Chi doc 1 LAN luc mount (component nay khong tu dong
   * "nhay" lai theo prop thay doi sau do - doi voi cha muon reset ve gia tri
   * moi thi remount qua `key`, giong het co che printResetKey da co). */
  initialColumnWidths?: Record<string, number> | null;
  /** Bao cho noi goi biet resizedColumnWidths vua doi (moi lan keo xong 1
   * cot, tren mouseup) - dung de cha giu ban nhap moi nhat, phuc vu nut
   * "Lưu" (persist xuong DB) tren QuoteDetailPage. KHONG tu goi luc mount
   * neu chua ai resize. */
  onColumnWidthsChange?: (widths: Record<string, number>) => void;
  /** "Người liên hệ" trong khối "Người phụ trách" PHẢI là Sale đang được gán
   * (quote.quoteOwnerId), KHÔNG dùng field tự do sellerContactName nữa (field
   * đó có defaultValue cứng "Lan Anh" - đúng bug "tên mặc định" người dùng
   * báo). Truyền tên Sale ĐÃ RESOLVE (display name thật) từ nơi gọi - canonical
   * renderer này không tự query user, chỉ hiển thị đúng theo props để mọi nơi
   * gọi (preview draft/detail/public/PDF) đều đi qua CÙNG 1 cơ chế, không tự
   * suy luận riêng. undefined/null = quote thật sự chưa có Sale -> fallback
   * về fieldValue('sellerContactName') cũ (field tự do/default). */
  contactPersonName?: string | null;
}

function emptySchema(): QuoteSchema {
  return { version: 1, layoutType: 'cloudgate_standard_quote', sections: [] };
}

/** Ngày lưu dạng "YYYY-MM-DD" (hoặc ISO datetime) — hiện cho khách theo dd/mm/yyyy
 * quen thuộc thay vì để nguyên định dạng máy đọc được. Parse thủ công phần
 * YYYY-MM-DD thay vì qua `Date` để tránh lệch múi giờ (Date coi "YYYY-MM-DD" là UTC
 * midnight, đọc lại bằng getDate() theo giờ local có thể lùi/tới 1 ngày). */
/** So La Ma cho Muc cha (Section, migration 104) - vd 1 -> I, 4 -> IV. Ban
 * sao doc lap voi ham cung ten trong QuoteWorkspaceModal.tsx (khac module,
 * khong chia se import qua lai giua modules/quotes va modules/crm). */
function toRomanNumeral(num: number): string {
  const table: Array<[number, string]> = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
    [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ];
  let n = num;
  let out = '';
  for (const [value, symbol] of table) {
    while (n >= value) {
      out += symbol;
      n -= value;
    }
  }
  return out || String(num);
}

/** Bug that da gap ("I. I. Phan mem" tren ban xem truoc/PDF khach hang): mot so
 * Muc cha (Section) co san du lieu da tu go san so La Ma vao dau ten (vd "I.
 * Phần mềm"), trong khi renderer LUON tu dong ghep them so La Ma tinh theo vi
 * tri (`toRomanNumeral(sectionCounter)`) truoc ten - ghep 2 cai lai thanh lap.
 * Ban sao doc lap voi ham cung ten trong QuoteWorkspaceModal.tsx (khac module).
 * CHI strip dung so La Ma KHOP VOI vi tri hien tai cua chinh no + dau cham
 * theo sau - KHONG dung regex chung cho moi chuoi bat dau bang chu hoa (se cat
 * nham ten that su bat dau bang chu "I"/"V"/"X"..., vd "Video call"). */
function stripLeadingRomanPrefix(text: string, expectedRoman: string): string {
  const pattern = new RegExp(`^${expectedRoman}\\.\\s*`, 'i');
  return text.replace(pattern, '');
}

function formatDateVN(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return `${day}/${month}/${year}`;
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}/${date.getFullYear()}`;
}

function textValue(value: unknown): string {
  return String(value ?? '').trim();
}

function splitLines(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(item => textValue(item)).filter(Boolean);
  return textValue(value)
    .split('\n')
    .map(item => item.trim())
    .filter(Boolean);
}

function cleanDocumentText(value: unknown): string {
  return textValue(value)
    .replace(/[✅⭐★☆✔✓☑️]/g, '')
    .replace(/^\s*\d+\.\s*/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Dữ liệu cũ (trước khi có cột riêng cho "Tên dịch vụ") chỉ lưu 1 chuỗi
 * "• Tên ngắn — mô tả dài..." vào field description, không có serviceDescription
 * riêng. Tách theo dấu gạch ngang "—"/"–" đầu tiên (đúng quy ước đã dùng khi
 * soạn nội dung) để hiển thị đúng 2 cột thay vì Tên dịch vụ trống/lặp Mô tả. */
function splitLegacyServiceText(raw: unknown): { name: string; rest: string } {
  const text = textValue(raw).replace(/^"+|"+$/g, '').trim();
  const match = text.match(/^•?\s*([^—–]+?)\s*[—–]\s*([\s\S]+)$/);
  if (!match) return { name: '', rest: text };
  return { name: match[1].trim(), rest: match[2].trim() };
}

/** Field nhan dien ben ban duoc snapshot tu Don vi phat hanh (xem
 * applyIssuerCompanySnapshot trong crm/integrations/quotes/types.ts). */
const ISSUER_SNAPSHOT_FIELD_KEYS = new Set([
  'sellerCompanyName',
  'sellerBrandName',
  'sellerTaxCode',
  'sellerAddress',
  'sellerPhone',
  'sellerEmail',
  'sellerWebsite',
  'sellerLogo',
]);

const COMPACT_BLOCK_CHAR_LIMIT = 500; // uoc luong noi dung con vua 1 trang A4
const COMPACT_BLOCK_LINE_LIMIT = 8;   // 500 ky tu nhung xuong dong nhieu van co the rat dai

/** Khối nội dung tự do Sale thêm ngay lúc tạo báo giá (xem CustomBlocksEditor.tsx) -
 * KHÔNG nằm trong schema, chỉ sống trong quoteData.customBlocks, nên render riêng
 * ở đây thay vì đi qua findSection/findField (2 hàm đó chỉ đọc schema thật).
 * Array.isArray guard bắt buộc - báo giá cũ không có field này (hoặc dữ liệu lỗi)
 * không được làm crash renderer. */
function renderCustomBlocks(blocks: unknown) {
  if (!Array.isArray(blocks) || !blocks.length) return null;
  return blocks.map((block: CustomBlock, blockIndex: number) => {
    const lines = splitLines(block.content);
    // Chi coi la "compact" (an toan de page-break-inside:avoid) khi CA HAI dieu
    // kien dung: it ky tu VA it dong. Khong chac chan thi coi la khoi dai, uu tien
    // khong mat noi dung hon giu nguyen 1 trang - trong codebase nay
    // page-break-inside:avoid tren 1 khoi dai da tung khien Chromium AM THAM CAT
    // MAT noi dung thay vi chi ngat trang xau (xem quotes.css canh .sheet-note--compact).
    const content = textValue(block.content);
    const isCompact = content.length <= COMPACT_BLOCK_CHAR_LIMIT && lines.length <= COMPACT_BLOCK_LINE_LIMIT;
    return (
      <section className={`sheet-note${isCompact ? ' sheet-note--compact' : ''}`} key={block.id || `${block.kind || 'block'}-${blockIndex}`}>
        <h3>{block.title}</h3>
        {lines.map((line, i) => <p key={i}>{line}</p>)}
      </section>
    );
  });
}

/** Mô tả nhiều gạch đầu dòng ("• Ý 1. • Ý 2. ...") đang bị dồn thành 1 đoạn
 * dính liền, khó đọc. Tách mỗi "•" thành 1 dòng riêng, bỏ dấu chấm cuối câu
 * thừa (đã có xuống dòng phân tách rồi, không cần chấm câu nữa). Không có
 * "•" thì tách theo xuống dòng thật ("\n") — đúng định dạng Description Items
 * tự sinh từ Danh mục dịch vụ (mỗi thành phần gói là 1 dòng, xem
 * render_bundle_description phía backend). Không có cả hai thì giữ 1 dòng. */
function formatDescriptionLines(raw: unknown): string[] {
  const text = textValue(raw).replace(/^"+|"+$/g, '').trim();
  if (!text) return [];
  const parts = text.includes('•') ? text.split('•') : text.split('\n');
  return parts
    .map(part => part.trim().replace(/\.+\s*$/, ''))
    .filter(Boolean);
}

const MONEY_COLUMN_KEYS = [
  'unitPrice',
  'subtotal',
  'vatAmount',
  'total',
  'amountAfterDiscount',
  'listPriceUsd',
  'unitPriceUsd',
  'unitPriceVnd',
  // "Giảm giá/Tiết kiệm" (Mẫu ưu đãi combo Markee, xem quoteConfig.ts
  // promoBundleColumns) - BUG THAT DA GAP: thieu key nay trong danh sach nen
  // khong duoc white-space:nowrap, chu bi be doc tung ky tu khi cot qua hep
  // (bang nhieu cot, xem them fix o minWidth ben duoi).
  'discountAmount',
];

/** Cot so NGAN (SL/VAT%/Giam gia%) - yeu cau rieng "chữ Số lượng bị rớt chữ
 * g xuống" (kem anh chup ban in that): cac cot nay TRUOC DAY khong co class
 * rieng, roi vao nhom "con lai chia deu" cung voi 2 cot tien it hon ~5-7%,
 * qua hep cho tieu de "SỐ LƯỢNG"/"THUẾ VAT" nen bi ngat GIUA tu (vd
 * "LƯỢN"+"G" tach roi 2 dong) thay vi ngat dung o khoang trang. Dat rieng
 * class de co the danh mot % vua du (xem .num-cell trong quotes.css). */
const SHORT_NUMBER_COLUMN_KEYS = ['quantity', 'vatRate', 'discountPercent'];

function bundleSnapshotComponents(item: QuoteItem): BundleSnapshotComponent[] {
  const snapshot = item.bundleSnapshot as unknown;
  if (Array.isArray(snapshot)) return snapshot as BundleSnapshotComponent[];
  if (snapshot && typeof snapshot === 'object' && Array.isArray((snapshot as { components?: unknown }).components)) {
    return (snapshot as { components: BundleSnapshotComponent[] }).components;
  }
  return [];
}

function appendQuota(label: string, quota?: string | null): string {
  const cleanQuota = String(quota || '').trim();
  if (!cleanQuota) return label;
  if (label.toLowerCase().includes(cleanQuota.toLowerCase())) return label;
  return `${label} — ${cleanQuota}`;
}

function bundleComponentToDisplayItem(component: BundleSnapshotComponent, suffix: string): QuoteItem {
  const label = component.customerDisplayName || component.name || component.displayText || 'Hạng mục';
  const serviceDescription = appendQuota(label, component.quota);
  return {
    id: `bundle-component-${component.componentId}-${suffix}`,
    rowType: 'item',
    serviceDescription,
    description: component.description || '',
    unit: component.unit || '',
    quantity: component.computedQuantity || component.quantity || 1,
    unitPrice: component.unitPriceVnd || 0,
    discountPercent: 0,
    vatRate: 0,
    __bundleComponent: true,
  };
}

function bundleComponentsToDisplayItems(item: QuoteItem): QuoteItem[] {
  const components = bundleSnapshotComponents(item)
    .filter(component => component.showOnQuote !== false)
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  const renderedPoolKeys = new Set<string>();
  const rows: QuoteItem[] = [];

  components.forEach((component, index) => {
    const poolKey = component.quotaPoolKey?.trim();
    if (poolKey) {
      if (renderedPoolKeys.has(poolKey)) return;
      renderedPoolKeys.add(poolKey);
      const technicalPoolName = component.quotaPoolName || '';
      const name = component.customerDisplayName || (technicalPoolName.toLowerCase() === 'channel quota' ? 'Kênh kết nối' : technicalPoolName) || component.name || 'Kênh kết nối';
      rows.push({
        id: `bundle-pool-${poolKey}-${index}`,
        rowType: 'item',
        serviceDescription: appendQuota(name, component.quotaPoolQuota || component.quota),
        description: '',
        unit: '',
        quantity: 1,
        unitPrice: component.unitPriceVnd || 0,
        discountPercent: 0,
        vatRate: 0,
        __bundleComponent: true,
      });
      return;
    }
    rows.push(bundleComponentToDisplayItem(component, String(index)));
  });

  return rows;
}

export function QuoteDocumentRenderer({
  schemaSnapshot,
  quoteData = {},
  quoteItems = [],
  solutionItems = [],
  totals,
  mode = 'preview',
  respectVisibleColumns = false,
  isPublished = false,
  quoteNumber,
  overallDiscountPercent = null,
  printPreviewMode = false,
  printOrientation = 'portrait',
  initialColumnWidths = null,
  onColumnWidthsChange,
  contactPersonName,
}: Props) {
  // BUG THAT DA GAP (2026-09-22): trang /baogia/{token} crash trang ("This
  // page couldn't load") khi backend tra ve quoteItems/solutionItems la
  // `null` THAT SU (khong phai []) - default param `= []` o tren CHI ap
  // dung khi gia tri la `undefined`, KHONG ap dung cho `null` (dac diem cua
  // JS/TS default parameter). Nhieu cho ben duoi (quoteItems.flatMap,
  // filterRedundantAmountAfterDiscountColumn -> .some, v.v.) doc thang
  // quoteItems ma khong tu guard rieng - chan 1 lan duy nhat o day thay vi
  // sua tung noi goi rai rac, tranh sot.
  quoteItems = quoteItems || [];
  solutionItems = solutionItems || [];
  // Resize cot bang hang muc kieu Excel - CHI cho man hinh xem truoc/chi tiet
  // noi bo (mode 'preview'/'detail', xem allowColumnResize ben duoi), KHONG
  // anh huong ban in/PDF (@media print da ep width qua !important nen inline
  // style o day luon bi ghi de luc in, xem quotes.css) va KHONG hien cho
  // khach (mode 'public'). null = chua ai resize, dung CSS mac dinh (%) - tru
  // khi da co initialColumnWidths luu tu truoc (nut "Lưu").
  const [resizedColumnWidths, setResizedColumnWidths] = useState<Record<string, number> | null>(
    initialColumnWidths && Object.keys(initialColumnWidths).length ? initialColumnWidths : null
  );
  const headerRowRef = useRef<HTMLTableRowElement | null>(null);
  const resizeDragRef = useRef<{ key: string; startX: number; startWidth: number } | null>(null);
  // BUG THAT DA GAP (React canh bao "Cannot update a component while
  // rendering a different component"): handleMouseUp truoc day goi
  // onColumnWidthsChange(current) (cap nhat STATE CUA COMPONENT CHA -
  // PublicQuotePage/QuoteDetailPage) NGAY BEN TRONG callback updater cua
  // chinh setResizedColumnWidths o day - vi pham nguyen tac updater phai
  // THUAN (khong side-effect/khong goi setState khac). Sua: giu 1 ref luon
  // dong bo VOI GIA TRI MOI NHAT cua resizedColumnWidths (cap nhat cung luc
  // voi moi lan setResizedColumnWidths, khong doi re-render), roi
  // handleMouseUp chi DOC thang tu ref nay va goi onColumnWidthsChange BEN
  // NGOAI moi updater - khong con setState long nhau.
  const latestWidthsRef = useRef<Record<string, number> | null>(resizedColumnWidths);

  const beginColumnResize = (columnKey: string, columns: QuoteField[]) => (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    let widths = resizedColumnWidths;
    // Lan resize DAU TIEN: do luon do rong hien tai (tu DOM that, dang chia
    // theo % mac dinh) cua TAT CA cot lam moc, tranh cac cot chua tung resize
    // bi nhay layout ve gia tri mac dinh cung (vd 120px) khi 1 cot doi sang px.
    if (!widths && headerRowRef.current) {
      const ths = Array.from(headerRowRef.current.querySelectorAll('th'));
      widths = {};
      columns.forEach((column, index) => {
        const th = ths[index] as HTMLElement | undefined;
        widths![column.key] = th ? Math.round(th.getBoundingClientRect().width) : 120;
      });
      latestWidthsRef.current = widths;
      setResizedColumnWidths(widths);
    }
    resizeDragRef.current = {
      key: columnKey,
      startX: event.clientX,
      startWidth: widths?.[columnKey] ?? 120,
    };
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const drag = resizeDragRef.current;
      if (!drag) return;
      const nextWidth = Math.max(40, drag.startWidth + (moveEvent.clientX - drag.startX));
      const next = { ...(latestWidthsRef.current || {}), [drag.key]: nextWidth };
      latestWidthsRef.current = next;
      setResizedColumnWidths(next);
    };
    const handleMouseUp = () => {
      resizeDragRef.current = null;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      // Bao cho cha biet ban nhap moi nhat NGAY khi tha chuot - doc thang tu
      // ref (luon la gia tri MOI NHAT, khong bi closure cu) THAY VI long ben
      // trong updater cua setResizedColumnWidths nhu truoc.
      if (onColumnWidthsChange && latestWidthsRef.current) {
        onColumnWidthsChange(latestWidthsRef.current);
      }
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const schema = schemaSnapshot || emptySchema();
  const layoutType = schema.layoutType || 'cloudgate_standard_quote';
  const sections = schema.sections || [];
  const findSection = (key: string) =>
    sections.find(section => section.key === key) || { key, title: '', fields: [] };
  const findField = (key: string): QuoteField =>
    sections
      .flatMap(section => section.fields || [])
      .flatMap(field => [field, ...(field.config?.columns || [])])
      .find(field => field.key === key) || {
      key,
      label: key,
      type: 'text',
      visible: true,
      editable: true,
    };
  // Email cong ty cu "hello@markeeai.com" (default field cu trong
  // seed_quote_forms.py, da doi thanh admin@markee.vn - xem comment o script
  // do) van con "ket cung" trong 2 noi KHONG the sua bang cach doi 1 dong
  // script: (1) data.sellerEmail cua CAC BAO GIA DA TAO TRUOC DAY (snapshot
  // luc tao, khong duoc ghi de hang loat theo nguyen tac K), (2) defaultValue
  // luu san trong CAC quote_form_schema DA TON TAI (script seed chi anh huong
  // lan seed MOI, khong tu doi row schema cu trong DB). Loc o dung 1 diem
  // fieldValue() (moi cho goi qua header/footer/villa deu di qua day) de AN
  // gia tri legacy nay khoi hien thi cho MOI bao gia (cu lan moi), khong xoa/
  // ghi de du lieu that nao ca - thuan tuy derived/display filter, dung tinh
  // than "K" (thay doi trinh bay ap dung tu dong cho bao gia cu).
  const LEGACY_HIDDEN_FIELD_VALUES: Record<string, string[]> = {
    sellerEmail: ['hello@markeeai.com'],
  };
  // Bao gia da snapshot Don vi phat hanh (issuerSnapshotCompanyId) - cac field
  // nhan dien ben ban CHI lay dung snapshot cua issuer do, KHONG roi ve
  // defaultValue cua mau bao gia khi issuer de trong (feedback 2026-09-23:
  // doi issuer nhung logo/dia chi van cua issuer cu, vi mau luu default cua
  // 1 cong ty khac). Moi version giu snapshot rieng trong data cua chinh no.
  const hasIssuerSnapshot = Boolean(quoteData.issuerSnapshotCompanyId);
  const fieldValue = (key: string) => {
    const value = quoteData[key];
    if (hasIssuerSnapshot && ISSUER_SNAPSHOT_FIELD_KEYS.has(key)) {
      return value !== undefined && value !== null ? value : '';
    }
    const resolved = value !== undefined && value !== null && value !== '' ? value : findField(key).defaultValue || '';
    const hiddenValues = LEGACY_HIDDEN_FIELD_VALUES[key];
    if (hiddenValues && typeof resolved === 'string' && hiddenValues.some(hidden => hidden.toLowerCase() === resolved.trim().toLowerCase())) {
      return '';
    }
    return resolved;
  };
  const renderCell = (item: QuoteItem, column: QuoteField, index: number) => {
    if (item.__bundleComponent && column.key === 'discountPercent') return '';
    if (item.__bundleComponent && column.key === 'vatRate') return '';
    if (column.type === 'auto-number' || column.key === 'order') return String(index + 1);
    if (column.key === 'subtotal') return formatVnd(calculateItemSubtotal(item));
    if (column.key === 'vatAmount') return formatVnd(calculateItemVat(item));
    // "ô nào null thì không hiện" (yeu cau rieng, cung nguyen tac voi Thong
    // tin khach hang) - tra chuoi rong thay vi dau "—" khi khong co du lieu.
    if (column.key === 'listPriceUsd') return item.listPriceUsd != null ? `$${item.listPriceUsd.toLocaleString('en-US')}` : '';
    if (column.key === 'unitPriceUsd') return item.unitPriceUsd != null ? `$${item.unitPriceUsd.toLocaleString('en-US')}` : '';
    if (column.key === 'unitPriceVnd') return item.unitPriceVnd != null ? formatVnd(item.unitPriceVnd) : '';
    if (column.key === 'total') {
      const discount = calculateItemDiscount(item);
      return discount ? (
        <span className="quote-price-stack">
          <s>{formatVnd(calculateItemSubtotal(item) + calculateItemVat({ ...item, discountPercent: 0 }))}</s>
          <b>{formatVnd(calculateItemTotal(item))}</b>
        </span>
      ) : formatVnd(calculateItemTotal(item));
    }
    if (column.key === 'unitPrice') return formatVnd(item.unitPrice);
    if (column.key === 'quantity') return String(item.quantity || '');
    if (column.key === 'discountPercent') return item.discountPercent ? `${item.discountPercent}%` : '';
    if (column.key === 'amountAfterDiscount') return formatVnd(calculateItemAfterDiscount(item));
    // "Giảm giá/Tiết kiệm" (so tien, KHAC voi 'discountPercent' o tren chi
    // hien %) - dung cho mau "Mẫu ưu đãi combo (Markee)" (xem promoBundleColumns
    // trong quoteConfig.ts).
    if (column.key === 'discountAmount') {
      const discount = calculateItemDiscount(item);
      return discount ? `-${formatVnd(discount)}` : formatVnd(0);
    }
    if (column.key === 'vatRate') return item.vatRate ? `${item.vatRate}%` : '';
    // "Mô tả" luôn qua tách dòng theo "•" (kể cả du lieu moi da co serviceDescription
    // rieng) - phai xu ly TRUOC fallback chung ben duoi, khong thi item.description
    // (luon co gia tri) se bi return thang o do, khien nhanh tach dong o day
    // thanh dead code khong bao gio chay toi.
    if (column.key === 'description') {
      const raw = !item.serviceDescription ? splitLegacyServiceText(item.description).rest : item.description || '';
      const lines = formatDescriptionLines(raw);
      if (lines.length <= 1) return lines[0] || '';
      return (
        <>
          {lines.map((line, lineIndex) => (
            <div key={lineIndex} className="quote-desc-line">{line}</div>
          ))}
        </>
      );
    }
    let value = item[column.key];
    if (column.key === 'serviceDescription' && !value && ('name' in item) && item.name) {
      value = String(item.name);
    }
    if (value !== undefined && value !== null && value !== '') {
      return String(value);
    }
    // item.serviceDescription trống (du lieu cu) -> thu tach tu description
    // theo quy uoc "Ten — Mo ta" thay vi de trong/lap noi dung.
    if (column.key === 'serviceDescription' && item.description) {
      return splitLegacyServiceText(item.description).name;
    }
    return '';
  };

  // "Chiết khấu tổng" (Tổng hợp giá) - thay hẳn cho khối "Giảm giá" (dòng đơn,
  // suy từ discountAmount/discountPercent legacy) đã có trước đây. Công thức
  // chỉ chạy Ở TẦNG HIỂN THỊ (không đổi totals/DB) - xem calculateOverallDiscountSummary.
  // subtotalBeforeVat lấy từ totals.totalAmount - totals.totalVatAmount (LUÔN có ở
  // mọi call site đã audit) thay vì subtotalAmount/discountAmount (không phải nơi
  // gọi nào cũng truyền discountAmount) nên tự động net đúng phần giảm giá TỪNG
  // DÒNG (nếu có) đã có sẵn trong totals, không cần đọc lại quoteItems/discountPercent
  // legacy ở đây nữa.
  const discountSummary = calculateOverallDiscountSummary(totals, overallDiscountPercent);
  // "Giảm giá tổng"/"Tổng sau giảm giá" chỉ hiện khi > 0, BẤT KỂ đang bật trong
  // cấu hình "Tổng hợp giá" hay không (auto-hide đè lên cấu hình - yêu cầu rõ
  // "trùng với tạm tính thì ẩn").
  const hasOverallDiscount = discountSummary.overallDiscountAmount > 0;
  // Trường "Tổng hợp giá" hiện cho khách - áp dụng ở MỌI mode (preview/detail/
  // public/print), KHÁC với cột bảng hạng mục (applyCustomerColumnFilter chỉ áp ở
  // public/print/preview) - yêu cầu rõ "Chi tiết báo giá đã duyệt phải đồng nhất
  // với preview" cho riêng khối tổng tiền này.
  const visibleSummaryKeys = new Set(
    resolveVisibleSummaryFieldKeys(schema, quoteData.visibleSummaryFields)
  );
  const notesValue = fieldValue('notes');
  const notesRows = splitLines(notesValue).map(cleanDocumentText).filter(Boolean);
  const commitments = fieldValue('commitments');
  const commitmentRows = splitLines(commitments).map(cleanDocumentText).filter(Boolean);
  const activeSolutionItems =
    solutionItems.length > 0
      ? solutionItems
      : Array.isArray(quoteData.solutionItems)
        ? quoteData.solutionItems
        : [];

  const renderSolutionCell = (item: VillaSolutionItem, column: QuoteField, index: number) => {
    if (column.type === 'auto-number') return String(index + 1);
    const value = (item as unknown as Record<string, unknown>)[column.key];
    if (column.type === 'currency') return formatVnd(Number(value || 0));
    return String(value ?? '');
  };

  const customerDisplayFields = getCustomerDisplayFields(schema);
  const visibleCustomerFieldKeys = new Set(resolveVisibleCustomerFieldKeys(schema, quoteData.visibleCustomerFields));
  const customerRows = customerDisplayFields
    .filter(field => visibleCustomerFieldKeys.has(field.key))
    .map(field => ({
      key: field.key,
      label: field.label,
      value: textValue(
        field.key === 'customerRecipient'
          ? fieldValue('customerRecipient') || fieldValue('customerContactName') || fieldValue('customerCompanyName')
          : fieldValue(field.key)
      ),
    }));
  const insightRows = [
    ['customerNeed', 'Nhu cầu khách hàng'],
    ['customerRequirement', 'Yêu cầu chính'],
    ['proposedSolution', 'Giải pháp đề xuất'],
    ['solutionOverview', 'Tóm tắt giải pháp'],
    ['projectScope', 'Phạm vi triển khai'],
  ]
    .map(([key, label]) => ({ key, label, value: textValue(fieldValue(key)) }))
    .filter(row => row.value);
  // Cot bang hang muc THAT cua mau nay (doc tu schema, tu dong tim dung field
  // quoteItems/solutionItems/... - xem findItemTableField trong quoteColumns.ts),
  // khong phai danh sach co dinh - dung chung logic voi checkbox "Cot hien thi"
  // o ReviewQuoteStep (xem utils/quoteColumns.ts) de 2 noi luon khop nhau, tu
  // dong doi theo tung mau bao gia (VD Villa dung bang solutionItems rieng,
  // cot khac han standard/quoteItems). Ten bien giu "standardColumns" vi ly do
  // lich su nhung tu gio dung chung cho CA layout villa (xem doan render villa
  // ben duoi, dung finalColumns thay vi 1 bien solutionColumns rieng truoc day).
  const standardColumns = resolveQuoteItemColumns(schema, quoteItems);
  // "Cột hiển thị" nguoi tao chon o buoc Xem truoc & gui (quoteData.visibleColumns) -
  // chi anh huong ban KHACH nhan (public/print, hoac preview khi respectVisibleColumns
  // duoc bat tuong minh) - KHONG bao gio anh huong mode='detail' (trang noi bo).
  const TOGGLEABLE_COLUMN_KEYS = resolveToggleableColumns(schema, quoteItems).map(column => column.key);
  const applyCustomerColumnFilter =
    mode === 'public' || mode === 'print' || (mode === 'preview' && respectVisibleColumns);
  // "vatRate" moi duoc them vao danh sach toggle - bao gia CU (luu truoc khi co
  // toggle nay) co the co san mang visibleColumns nhung khong biet gi ve
  // 'vatRate' -> phai tu bo sung vao de KHONG lam VAT bi an mat khoi bao gia cu
  // (truoc day VAT luon hien, khong toggle duoc). Bao gia MOI tu gio deu di qua
  // resolveToggleableColumns() (da co san 'vatRate') nen khong bi anh huong.
  // BUG THAT DA GAP ("tick ẩn Giảm giá rồi mà nó không ẩn trên bản xem
  // trước"): AUTO_INCLUDE_LEGACY_COLUMN_KEYS (['vatRate','discountPercent'])
  // TRUOC DAY luon tu CHEN LAI 2 key nay vao customerVisibleColumns BAT KE
  // nguoi dung co chu dong tat hay khong - y dinh ban dau la "tuong thich
  // nguoc" cho bao gia CU luu visibleColumns TRUOC KHI 2 cot nay la toggle
  // option (mang cu khong biet gi ve 2 key nay = khong phai nguoi dung
  // "chu dong tat"). Nhung logic nay KHONG PHAN BIET DUOC "mang cu chua
  // tung biet key nay" voi "nguoi dung MOI VUA TAT key nay that su" - ca 2
  // truong hop deu la "key vang mat trong mang da luu", nen MOI LAN nguoi
  // dung tat 'vatRate'/'discountPercent' deu bi ghi de lai thanh BAT ngay
  // lap tuc, dung nguyen chinh 2 cot nay khong bao gio tat duoc. Xoa han co
  // che "tu suy doan" nay - ton trong CHINH XAC gia tri da luu
  // (quoteData.visibleColumns), khong tu chen them bat ky key nao vao.
  const customerVisibleColumns = Array.isArray(quoteData.visibleColumns) ? quoteData.visibleColumns : null;
  // BUG THAT DA GAP ("Bản xem trước cho khách hàng vẫn có horizontal
  // scrollbar", "Không hiển thị đồng thời List price USD, Unit price USD,
  // Unit price VND"): khi quote CHUA TUNG duoc admin tuy chinh "Cột hiển
  // thị" (quoteData.visibleColumns null - dung cho HAU HET bao gia thuc te,
  // vi day la 1 buoc tuy chon it ai bam toi), applyCustomerColumnFilter bi
  // BO QUA HOAN TOAN (finalColumns = standardColumns, hien nguyen tat ca) -
  // bao gom ca 3 cot gia tham khao noi bo (listPriceUsd/unitPriceUsd/
  // unitPriceVnd, tu dong chen khi item co catalogItemId, xem
  // resolveQuoteItemColumns) khien bang qua rong, tran ngang. Mac dinh HOP
  // LY khi CHUA tuy chinh gi ca la AN 3 cot tham khao nay khoi ban khach (day
  // von la du lieu ho tro Sale chon gia luc dang tao, khong phai thu khach
  // hang can thay) - chi hien khi admin CHU DONG tick chung vao "Cột hiển
  // thị" (customerVisibleColumns thuc su chua key do).
  const DEFAULT_HIDDEN_FROM_CUSTOMER_KEYS = ['listPriceUsd', 'unitPriceUsd', 'unitPriceVnd'];
  // "Thành tiền trước VAT" (`subtotal`) - cot TRUNG LAP THAT SU voi cap
  // "Thành tiền (Chưa VAT)" (amountAfterDiscount) + "Thành tiền (gồm VAT)"
  // (total) da dung o ban khach. `subtotal` co type 'calculated' nen KHONG
  // nam trong TOGGLEABLE_COLUMN_KEYS (xem resolveToggleableColumns loc bo
  // type 'calculated') - dieu nay khien dieu kien loc customer o duoi
  // (`!TOGGLEABLE_COLUMN_KEYS.includes(...)`) LUON danh gia true cho no, tuc
  // no bi coi la cot "khong the tat", hien BAT KE quoteData.visibleColumns da
  // luu gi. Loai HAN khoi ban khach o day (khac DEFAULT_HIDDEN_FROM_CUSTOMER_KEYS
  // - key do CHI an khi CHUA tuy chinh gi, con day phai an TUYET DOI, ke ca
  // bao gia cu lo luu 'subtotal' trong visibleColumns tu truoc). Van tinh
  // toan noi bo (calculateItemSubtotal) binh thuong, chi bo o tang hien thi
  // khach hang - khong dung mode='detail' (noi bo van thay du neu mau khai).
  const ALWAYS_HIDDEN_FROM_CUSTOMER_KEYS = ['subtotal'];
  const defaultVisibleCustomerColumnKeys = resolveDefaultVisibleColumnKeys(schema, quoteItems);
  const finalColumns = filterRedundantAmountAfterDiscountColumn(
    applyCustomerColumnFilter
      ? (customerVisibleColumns
          ? standardColumns.filter(
              column => !TOGGLEABLE_COLUMN_KEYS.includes(column.key) || customerVisibleColumns.includes(column.key)
            )
          : standardColumns.filter(
              column =>
                (!TOGGLEABLE_COLUMN_KEYS.includes(column.key) || defaultVisibleCustomerColumnKeys.includes(column.key)) &&
                !DEFAULT_HIDDEN_FROM_CUSTOMER_KEYS.includes(column.key)
            )
        ).filter(column => !ALWAYS_HIDDEN_FROM_CUSTOMER_KEYS.includes(column.key))
      : standardColumns,
    quoteItems
  );
  // Resize cot kieu Excel: mac dinh chi bat o man hinh noi bo (nguoi TAO/xem
  // chi tiet bao gia), khong bat cho 'public' (khach nhan bao gia khong
  // can/khong nen co UI keo cot) va khong lien quan ban in (ban in doc theo
  // @media print, khong doc prop mode nay) - TRU KHI toolbar chinh in dang
  // hien san (printPreviewMode=true, xem PublicQuotePage/QuoteDetailPage/
  // QuoteWorkspaceModal.tsx), noi nguoi dung CHU DONG can keo cot va IN LUON tu do (ke ca ban 'public' gui
  // khach), nen bat resize bat ke mode.
  const allowColumnResize = printPreviewMode || mode === 'preview' || mode === 'detail';
  // Kho giay khi in: mac dinh 'portrait' (A4 doc) theo yeu cau cu ("Khổ A4
  // portrait... Không cố nhồi nhiều sản phẩm bằng cách làm chữ nhỏ... Nếu báo
  // giá dài → tự động sang trang 2, 3" - tuc KHONG tu dong doi ngang/thu nho
  // chu de nen). Yeu cau moi hon ("Xem truoc khi in" co the chon doc/ngang)
  // cho phep NGUOI DUNG tu chon qua prop printOrientation thay vi component
  // tu quyet dinh - portrait van la mac dinh khi khong truyen gi (giu dung
  // hanh vi cu cho moi noi goi chua cap nhat).
  const usesLandscapePrint = printOrientation === 'landscape';
  // Muc cha (Section)/hang muc con - migration 104. 1 dong goc rowType=
  // 'section' la TIEU DE NHOM thuan tuy (khong tinh tien) - hien rieng 1 hang
  // noi bat chiem het cac cot, DUNG so La Ma (I, II, III...) rieng, KHONG
  // dung STT nhu hang muc that. Hang muc that (goc HOAC nam trong 1 nhom qua
  // `children`) danh so 01/02/03... LIEN TUC xuyen suot ca bang, KHONG reset
  // lai moi nhom - khop dung cach danh so 01-21 lien tuc qua ca 3 "GIAI
  // DOAN" trong file Excel mau (khac han quy uoc "1.1/1.2" cu cua tinh nang
  // bundle cha/con truoc day, gio chi con dung cho section).
  let sectionCounter = 0;
  let itemCounter = 0;
  const displayedQuoteRows = quoteItems.flatMap(item => {
    if (item.rowType === 'section') {
      sectionCounter += 1;
      const sectionRow = {
        item,
        number: toRomanNumeral(sectionCounter),
        isChild: false,
        isSection: true as const,
        // Tong tien section (B) - CHI cong truc tiep cac hang muc con (khong
        // de quy sau hon), dung chung 1 ham voi Workspace - xem
        // calculateSectionTotal trong quoteCalculations.ts.
        sectionTotal: calculateSectionTotal(item.children || []),
      };
      const childRows = (item.children || []).flatMap(child => {
        itemCounter += 1;
        const childRow = { item: child, number: String(itemCounter).padStart(2, '0'), isChild: true, isSection: false as const };
        const bundleRows = bundleComponentsToDisplayItems(child).map(componentItem => ({
          item: componentItem,
          number: '',
          isChild: true,
          isSection: false as const,
        }));
        return [childRow, ...bundleRows];
      });
      return [sectionRow, ...childRows];
    }
    itemCounter += 1;
    const parentRow = { item, number: String(itemCounter).padStart(2, '0'), isChild: false, isSection: false as const };
    const bundleRows = bundleComponentsToDisplayItems(item).map(componentItem => ({
      item: componentItem,
      number: '',
      isChild: true,
      isSection: false as const,
    }));
    return [parentRow, ...bundleRows];
  });

  if (layoutType === 'villa_solution_package') {
    const setupTotal = activeSolutionItems.reduce(
      (sum, item) => sum + Number(item.offerPrice || 0),
      0
    );
    const phaseOnePercent = Number(fieldValue('paymentPhaseOnePercent') || 0);
    const phaseTwoPercent = Number(fieldValue('paymentPhaseTwoPercent') || 0);
    return (
      <div className="quote-document-renderer" data-mode={mode}>
        <section className="quote-sheet villa-sheet">
          <header className="villa-header">
            <div className="villa-brand">{String(fieldValue('sellerBrandName') || 'MARKEE')}</div>
            <div className="villa-meta">
              <p>Ngày: {formatDateVN(fieldValue('quoteDate')) || '[Ngày]'}</p>
              <p>Số báo giá: {quoteNumber || String(fieldValue('quoteNumber') || '[Số]')}</p>
            </div>
          </header>

          <section className="villa-hero">
            <p className="villa-to">Kính gửi: {String(fieldValue('customerRecipient') || '[Tên khách hàng]')}</p>
            <h1 className="villa-title">{String(fieldValue('quoteTitle'))}</h1>
            <p className="villa-subtitle">{cleanDocumentText(fieldValue('quoteSubtitle'))}</p>
            {cleanDocumentText(fieldValue('quoteBenefitLine')) ? (
              <div className="villa-benefit">{cleanDocumentText(fieldValue('quoteBenefitLine'))}</div>
            ) : null}
          </section>

          <section className="villa-table-wrap">
            <table className="villa-table">
              <thead>
                <tr>
                  {finalColumns.map(column => (
                    <th key={column.key}>{normalizeQuoteColumnLabel(column)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {activeSolutionItems.map((item, index) => (
                  <tr key={index}>
                    {finalColumns.map(column => (
                      <td
                        key={column.key}
                        className={
                          column.key === 'originalPrice'
                            ? 'villa-price-original'
                            : column.key === 'offerPrice'
                              ? 'villa-price-offer'
                              : undefined
                        }
                      >
                        {column.key === 'offerPrice' ? (
                          <strong>{renderSolutionCell(item, column, index)}</strong>
                        ) : column.key === 'originalPrice' ? (
                          <span>{renderSolutionCell(item, column, index)}</span>
                        ) : (
                          renderSolutionCell(item, column, index)
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <div className="villa-split">
            <section className="villa-commitments">
              <h3>Cam kết triển khai</h3>
              <ul className="villa-list">
                {commitmentRows.map((item, index) => (
                  <li key={`${item}-${index}`}>{item}</li>
                ))}
              </ul>
            </section>
            <section className="villa-totals">
              <h3>Tổng đầu tư</h3>
              {visibleSummaryKeys.has('subtotalBeforeVat') ? (
                <div className="villa-total-row">
                  <span>Phí triển khai</span>
                  <strong>{formatVnd(discountSummary.subtotalBeforeVat || setupTotal || totals.totalAmount)}</strong>
                </div>
              ) : null}
              {visibleSummaryKeys.has('overallDiscount') && hasOverallDiscount ? (
                <div className="villa-total-row villa-total-row--discount">
                  <span>Giảm giá tổng ({overallDiscountPercent}%)</span>
                  <strong>-{formatVnd(discountSummary.overallDiscountAmount)}</strong>
                </div>
              ) : null}
              {visibleSummaryKeys.has('subtotalAfterDiscount') && hasOverallDiscount ? (
                <div className="villa-total-row">
                  <span>Tổng sau giảm giá</span>
                  <strong>{formatVnd(discountSummary.subtotalAfterDiscount)}</strong>
                </div>
              ) : null}
              {/* Villa khong co khai niem VAT that (calculateVillaTotals() luon
                  tra totalVatAmount:0) nhung van hien dong nay theo dung yeu
                  cau "ca 5 truong ap dung dong nhat moi mau, khong loai tru
                  theo layout" - gia tri se luon la 0d, khong phai bug. */}
              {visibleSummaryKeys.has('vatTotal') ? (
                <div className="villa-total-row">
                  <span>Thuế GTGT</span>
                  <strong>{formatVnd(discountSummary.vatAfterDiscount)}</strong>
                </div>
              ) : null}
              <div className="villa-total-row">
                <span>Phí duy trì hàng tháng</span>
                <strong>{formatVnd(fieldValue('monthlyAmount'))}</strong>
              </div>
              {visibleSummaryKeys.has('grandTotal') ? (
                <div className="villa-total-row villa-total-row--grand">
                  <span>Tổng thanh toán</span>
                  <strong>{formatVnd(discountSummary.grandTotal)}</strong>
                </div>
              ) : null}
              {/* Sua base tinh 2 dong "Thanh toan dot 1/2": TRUOC DAY nhan thang
                  vao setupTotal (truoc chiet khau) - neu Chiet khau tong > 0 thi
                  tong 2 dot se KHONG con khop voi "Tong thanh toan" da tru giam
                  gia o tren, gay mau thuan 2 con so tren cung 1 to bao gia. Doi
                  sang discountSummary.grandTotal (phan phi trien khai SAU chiet
                  khau - Chiet khau tong KHONG ap dung cho "Phi duy tri hang
                  thang", xem audit trong ke hoach) de dot1+dot2 = Tong thanh toan
                  luon dung tuyet doi (gia dinh phaseOnePercent+phaseTwoPercent=100,
                  dung nhu thiet ke san co cua 2 field nay). */}
              <div className="villa-total-sub">
                Thanh toán đợt 1 ({phaseOnePercent}%):{' '}
                {formatVnd((discountSummary.grandTotal * phaseOnePercent) / 100)}
              </div>
              <div className="villa-total-sub">
                Thanh toán đợt 2 ({phaseTwoPercent}%):{' '}
                {formatVnd((discountSummary.grandTotal * phaseTwoPercent) / 100)}
              </div>
            </section>
          </div>

          {renderCustomBlocks(quoteData?.customBlocks)}

          <section className="villa-footer">
            <div className="villa-footer-col">
              <h4>Lộ trình</h4>
              <p>1. {String(fieldValue('implementationStepOne'))}</p>
              <p>2. {String(fieldValue('implementationStepTwo'))}</p>
            </div>
            <div className="villa-footer-col">
              <h4>Liên hệ</h4>
              <p>Zalo: {String(fieldValue('sellerZalo'))}</p>
              {fieldValue('sellerEmail') ? <p>Email: {String(fieldValue('sellerEmail'))}</p> : null}
            </div>
            <div className="villa-footer-col">
              <h4>Hiệu lực</h4>
              <p>{String(fieldValue('offerExpiryText'))}</p>
              <strong>{formatDateVN(fieldValue('offerExpiryDate')) || '[Ngày]'}</strong>
            </div>
          </section>
        </section>
      </div>
    );
  }

  return (
    <div
      className={`quote-document-renderer${usesLandscapePrint ? ' quote-document-renderer--print-landscape' : ''}`}
      data-mode={mode}
    >
      {/* Doi huong giay qua 1 the <style> chen dong thay vi CSS "named page"
          (thuoc tinh `page` + nhieu @page dat ten) - da thu named page truoc
          va xac nhan Chromium bi mot loi that: noi dung cuoi tai lieu (khoi
          tong tien/ghi chu) bi CAT MAT thay vi sang trang khi doi named page
          giua chung, lap lai y het du sua nhieu huong CSS khac nhau. Chi 1
          @page DUY NHAT (khong dat ten) hoat dong moi luc in - an toan, da
          test that khong con mat noi dung. */}
      {usesLandscapePrint ? (
        <style>{'@media print { @page { size: A4 landscape; margin: 7mm 12mm; } }'}</style>
      ) : null}
      <section className={`quote-sheet quote-sheet--standard${usesLandscapePrint ? ' quote-sheet--print-landscape' : ''}`}>
        {/* Banner marketing (anh tinh, URL dan san qua field "bannerImageUrl") -
         * chi dung cho "Mẫu ưu đãi combo (Markee)" (xem quoteConfig.ts), CO
         * DIEU KIEN nen KHONG anh huong mau standard/villa cu (field nay
         * khong ton tai/rong o cac schema khac). */}
        {fieldValue('bannerImageUrl') ? (
          <img className="sheet-marketing-banner" src={String(fieldValue('bannerImageUrl'))} alt="" />
        ) : null}
        <header className="sheet-company sheet-company--standard">
          {/* Logo nam NGANG song song voi thong tin cong ty (yeu cau rieng
           * "thông tin nằm ngang song song logo") - truoc day logo/ten/dia
           * chi/sdt xep CHONG doc trong cung 1 div, gio logo la 1 flex item
           * rieng, phan text ben canh (xem .sheet-brand-block trong
           * quotes.css). */}
          <div className="sheet-brand-block">
            {fieldValue('sellerLogo') ? (
              <img className="sheet-brand-logo" src={String(fieldValue('sellerLogo'))} alt={String(fieldValue('sellerCompanyName') || '')} />
            ) : null}
            <div className="sheet-brand-text">
              <div className="sheet-brand-mark">{String(fieldValue('sellerCompanyName') || 'MARKEE')}</div>
              <p>{String(fieldValue('sellerAddress'))}</p>
              <p>
                {/* Chi noi bang " · " cac gia tri CO that - issuer thieu SDT khong
                    con dau " · " thua dau dong. */}
                {[fieldValue('sellerPhone'), fieldValue('sellerEmail'), fieldValue('sellerWebsite')]
                  .map(value => String(value || '').trim())
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              {fieldValue('sellerTaxCode') ? <p>MST: {String(fieldValue('sellerTaxCode'))}</p> : null}
            </div>
          </div>
          <div className="sheet-doc-code">
            <span>BÁO GIÁ</span>
            <strong>{quoteNumber || String(fieldValue('quoteNumber') || '[Số báo giá]')}</strong>
            {/* Ngay bao gia chuyen LEN NGANG voi Ma bao gia (yeu cau rieng
             * "bỏ ngày báo giá lên trang ngang mã báo giá") - Hiệu lực/Tiền
             * tệ bo hoan toan (khong con hien o dau tai lieu nua). Van giu
             * dung rule cu "chỉ hiển thị khi bấm phát hành". */}
            {isPublished ? <em>{formatDateVN(fieldValue('quoteDate')) || ''}</em> : null}
          </div>
        </header>

        <section className="sheet-title-block sheet-title-block--standard">
          <h1>{String(fieldValue('quoteTitle') || 'Bảng báo giá')}</h1>
        </section>

        {/* CHOT LAI ("field không có dữ liệu thì ẩn hoàn toàn cả nhãn lẫn
         * giá trị, không hiện placeholder [Label]; nếu cả khối không có dữ
         * liệu thì bỏ khối đó"): truoc day LUON render du dong (dung
         * row.value || row.placeholder) - khach hang thay nguyen van
         * "[Địa chỉ]"/"[Mã số thuế]" tren PDF/preview that neu Sale chua
         * dien. Loc bo dong rong TRUOC khi render, an ca 2 nua neu tuong
         * ung rong het. */}
        {(() => {
          const filledCustomerRows = customerRows.filter(row => row.value);
          // "Người liên hệ" = Sale dang duoc gan (quote_owner_id), KHONG con
          // dung field tu do/default cu - chi fallback ve fieldValue khi quote
          // THAT SU chua co Sale (contactPersonName undefined/null/rong).
          const resolvedContactName = contactPersonName || String(fieldValue('sellerContactName') || '');
          // Rieng khoi "Người liên hệ" nay (KHONG phai header cong ty ben tren,
          // chi o day) - fallback ve admin@markee.vn khi email rong/da bi an
          // (legacy hello@markeeai.com) de khong bo trong 1 dong lien he quan
          // trong; header/villa footer KHONG doi (van dung nguyen fieldValue()
          // goc, tiep tuc an hoan toan neu rong - yeu cau rieng "khong muon
          // hien o do"). Khong ghi de sellerEmail THAT (khac rong) cua bao gia.
          const sellerContactEmail = String(fieldValue('sellerEmail') || '') || 'admin@markee.vn';
          const sellerContactRows = [
            { key: 'sellerContactName', label: findField('sellerContactName').label, value: resolvedContactName },
            { key: 'sellerPhone', label: findField('sellerPhone').label, value: String(fieldValue('sellerPhone') || '') },
            { key: 'sellerEmail', label: findField('sellerEmail').label, value: sellerContactEmail },
          ].filter(row => row.value);
          if (!filledCustomerRows.length && !sellerContactRows.length) return null;
          return (
            <section className="sheet-parties sheet-parties--standard">
              {filledCustomerRows.length ? (
                <div>
                  <h3>{findSection('customer').title || 'Thông tin khách hàng'}</h3>
                  {filledCustomerRows.map(row => (
                    <p key={row.key}><strong>{row.label}:</strong> {row.value}</p>
                  ))}
                </div>
              ) : null}
              {sellerContactRows.length ? (
                <div>
                  <h3>Người liên hệ</h3>
                  {sellerContactRows.map(row => (
                    <p key={row.key}><strong>{row.label}:</strong> {row.value}</p>
                  ))}
                </div>
              ) : null}
            </section>
          );
        })()}

        {insightRows.length ? (
          <section className="sheet-insights">
            <h3>Nhu cầu & giải pháp đề xuất</h3>
            <div className="sheet-insight-grid">
              {insightRows.map(row => (
                <div key={row.key} className="sheet-insight-item">
                  <span>{row.label}</span>
                  <p>{row.value}</p>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section className="sheet-items">
          <div className="sheet-section-heading">
            <span>Chi phí đề xuất</span>
            <h3>{findSection('quoteItems').title || 'Bảng dịch vụ'}</h3>
          </div>
          <div className="sheet-items-table-wrap">
            {/* minWidth chi la nguong TOI THIEU de cot con doc duoc tren man
                hinh hep (wrapper .sheet-items-table-wrap tu cuon ngang rieng,
                khong lam vo layout modal/trang) - KHONG con nhan tuyen tinh
                theo so cot nhu truoc (115px/cot khien bang phinh to vo can khi
                hien nhieu cot, luon can cuon ngang du man hinh du rong). Trong
                nguong nay, table-layout:fixed + width:100% da tu chia deu cot
                theo khong gian thuc te co san (cot con lai tu gian ra khi an
                bot cot khac), header duoc phep xuong dong (xem quotes.css) nen
                khong can cot rong toi thieu lon nhu truoc. */}
            <table
              className={`sheet-items-table${usesLandscapePrint ? ' sheet-items-table--print-landscape' : ''}${allowColumnResize ? ' sheet-items-table--resizable' : ''}${printPreviewMode && resizedColumnWidths ? ' sheet-items-table--custom-print-widths' : ''}`}
              style={
                // Da resize it nhat 1 cot: dat width = TONG cac cot (co the
                // vuot 100% wrapper) de bang tu gian rong ra that su thay vi
                // bi table-layout:fixed ep co lai vua khung - .sheet-items-
                // table-wrap co san overflow-x:auto se tu hien thanh cuon
                // ngang, dung hanh vi Excel (rong 1 cot khong lam hep cot
                // khac). Chua resize: giu nguyen minWidth mac dinh nhu cu.
                allowColumnResize && resizedColumnWidths
                  ? { width: Object.values(resizedColumnWidths).reduce((sum, w) => sum + w, 0) }
                  // BUG THAT DA GAP ("Mẫu ưu đãi combo Markee" 12 cot, chu bi
                  // be/chong nhau): tran 760px cu THAP HON ca gia tri tinh ra
                  // (12*70=840) cho bang nhieu cot - vo tinh EP bang HEP HON
                  // muc can thiet du cong thuc tren da tinh dung. Nang tran
                  // len 1400 (chi anh huong bang >10 cot, <=10 cot van y het
                  // truoc gio vi 10*70=700 <760, khong bao gio cham tran).
                  : { minWidth: Math.min(1400, Math.max(420, finalColumns.length * 70)) }
              }
            >
              <thead>
                <tr ref={headerRowRef}>
                  {finalColumns.map(column => (
                    <th
                      key={column.key}
                      className={
                        column.type === 'currency' || MONEY_COLUMN_KEYS.includes(column.key)
                          ? 'money-cell'
                          : column.key === 'unit'
                            ? 'unit-cell'
                            : SHORT_NUMBER_COLUMN_KEYS.includes(column.key)
                              ? 'num-cell'
                              : undefined
                      }
                      style={
                        allowColumnResize && resizedColumnWidths?.[column.key]
                          ? ({
                              width: resizedColumnWidths[column.key],
                              minWidth: resizedColumnWidths[column.key],
                              // Doc lai o quotes.css (".sheet-items-table--custom-print-widths th")
                              // KHI printPreviewMode - cho phep do rong da keo tay
                              // "song" qua luc in that (@media print binh thuong ep
                              // width:auto/% qua !important, xem comment o quotes.css).
                              ...(printPreviewMode ? { '--col-print-w': `${resizedColumnWidths[column.key]}px` } : {}),
                            } as React.CSSProperties)
                          : undefined
                      }
                    >
                      {normalizeQuoteColumnLabel(column)}
                      {allowColumnResize ? (
                        <span
                          className="quote-col-resize-handle"
                          onMouseDown={beginColumnResize(column.key, finalColumns)}
                        />
                      ) : null}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayedQuoteRows.length === 0 ? (
                  <tr>
                    <td colSpan={Math.max(finalColumns.length, 1)} className="empty-row">
                      Chưa có hạng mục báo giá.
                    </td>
                  </tr>
                ) : (
                  displayedQuoteRows.map((row, index) => {
                    if (row.isSection) {
                      // Tong tien section (B) - hien BOLD, can PHAI, thang
                      // hang duoi dung cot "Thành tiền" (`total`) - neu mau
                      // KHONG khai bao cot `total` (hiem, vd solutionItems)
                      // thi khong co cot nao de can theo, gop chung vao 1 o
                      // ten section nhu cu (khong hien so).
                      const totalColIndex = finalColumns.findIndex(column => column.key === 'total');
                      if (totalColIndex < 0) {
                        return (
                          <tr key={row.item.id || `section-${row.number}-${index}`} className="quote-item-row quote-item-row--section">
                            <td colSpan={Math.max(finalColumns.length, 1)}>
                              <strong>{row.number} — {stripLeadingRomanPrefix(String(row.item.description || row.item.serviceDescription || ''), row.number)}</strong>
                            </td>
                          </tr>
                        );
                      }
                      const trailingColSpan = finalColumns.length - totalColIndex - 1;
                      return (
                        <tr key={row.item.id || `section-${row.number}-${index}`} className="quote-item-row quote-item-row--section">
                          <td colSpan={Math.max(totalColIndex, 1)}>
                            <strong>{row.number} — {stripLeadingRomanPrefix(String(row.item.description || row.item.serviceDescription || ''), row.number)}</strong>
                          </td>
                          <td className="money-cell quote-section-total-cell">
                            <strong>{formatVnd(row.sectionTotal)}</strong>
                          </td>
                          {trailingColSpan > 0 ? <td colSpan={trailingColSpan} /> : null}
                        </tr>
                      );
                    }
                    return (
                      <tr key={`${row.item.id || row.number}-${index}`} className={row.isChild ? 'quote-item-row quote-item-row--child' : 'quote-item-row quote-item-row--parent'}>
                        {finalColumns.map(column => (
                          <td
                            key={column.key}
                            data-label={normalizeQuoteColumnLabel(column)}
                            className={
                              column.type === 'currency' ||
                              // BUG THAT DA GAP ("Thành tiền chưa VAT bị rớt
                              // chữ giữa số tiền, vd 6.500.00 / 0"): cot nay
                              // co key "amountAfterDiscount", type "calculated"
                              // (khong phai "currency") nen truoc day KHONG
                              // duoc gan .money-cell (white-space:nowrap) -
                              // roi vao rule chung overflow-wrap:anywhere, cat
                              // giua so tien. Bo sung du cac key tien te khac
                              // (calculated) vao danh sach.
                              MONEY_COLUMN_KEYS.includes(column.key)
                                ? 'money-cell'
                                : column.key === 'unit'
                                  ? 'unit-cell'
                                  : SHORT_NUMBER_COLUMN_KEYS.includes(column.key)
                                    ? 'num-cell'
                                    : undefined
                            }
                          >
                            {column.type === 'auto-number' || column.key === 'order'
                              ? row.number
                              : renderCell(row.item, column, index)}
                            {column.key === (finalColumns.find(c => c.key === 'serviceDescription') || finalColumns.find(c => c.key === 'description') || finalColumns[0])?.key && row.item.warrantyScope?.trim() ? (
                              <div className="quote-item-warranty"><strong>Phạm vi bảo hành:</strong>
                                {formatDescriptionLines(row.item.warrantyScope).map((line, i) => <div key={i}>{line}</div>)}
                              </div>
                            ) : null}
                          </td>
                        ))}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="sheet-total-block sheet-total-block--standard">
          {visibleSummaryKeys.has('subtotalBeforeVat') ? (
            <div className="sheet-total-row">
              <span>{findField('subtotalAmount').label || 'Tổng cộng chưa bao gồm thuế GTGT'}</span>
              <strong>{formatVnd(discountSummary.subtotalBeforeVat)}</strong>
            </div>
          ) : null}
          {visibleSummaryKeys.has('overallDiscount') && hasOverallDiscount ? (
            <div className="sheet-total-row sheet-total-row--discount">
              <span>Giảm giá tổng ({overallDiscountPercent}%)</span>
              <strong>-{formatVnd(discountSummary.overallDiscountAmount)}</strong>
            </div>
          ) : null}
          {visibleSummaryKeys.has('subtotalAfterDiscount') && hasOverallDiscount ? (
            <div className="sheet-total-row">
              <span>Tổng sau giảm giá</span>
              <strong>{formatVnd(discountSummary.subtotalAfterDiscount)}</strong>
            </div>
          ) : null}
          {visibleSummaryKeys.has('vatTotal') ? (
            <div className="sheet-total-row">
              <span>{findField('totalVatAmount').label || 'Thuế GTGT'}</span>
              <strong>{formatVnd(discountSummary.vatAfterDiscount)}</strong>
            </div>
          ) : null}
          {visibleSummaryKeys.has('grandTotal') ? (
            <div className="sheet-total-row sheet-total-row--grand">
              <span>{findField('totalAmount').label || 'Tổng thanh toán'}</span>
              <strong>{formatVnd(discountSummary.grandTotal)}</strong>
            </div>
          ) : null}
        </section>

        {schema.enableDynamicPaymentPlan && visiblePaymentPlan(quoteData.paymentPlan).length > 0 ? (
          <section className="sheet-note sheet-payment-plan">
            <h3>Kế hoạch thanh toán</h3>
            <table className="quote-table">
              <thead><tr><th>Đợt</th><th>Tỷ lệ (%)</th><th>Số tiền</th><th>Điều kiện thanh toán</th><th>Ghi chú</th></tr></thead>
              <tbody>{visiblePaymentPlan(quoteData.paymentPlan).map((row, i) => <tr key={row.id || i}>
                <td>{row.phase}</td><td>{row.percent}%</td><td className="money-cell">{formatVnd(paymentPlanAmount(discountSummary.grandTotal, row.percent))}</td><td>{row.condition}</td><td>{row.note}</td>
              </tr>)}</tbody>
              <tfoot><tr><th>Tổng</th><th>{paymentPlanPercent(visiblePaymentPlan(quoteData.paymentPlan))}%</th><th>{formatVnd(visiblePaymentPlan(quoteData.paymentPlan).reduce((sum, row) => sum + paymentPlanAmount(discountSummary.grandTotal, row.percent), 0))}</th><td colSpan={2} /></tr></tfoot>
            </table>
          </section>
        ) : null}

        {/* "Cam kết & bảo hành" - dung DUNG field "commitments" + bien
         * commitmentRows da tinh san (xem dong 476, villa dang dung chung bien
         * nay) - CO DIEU KIEN nen KHONG anh huong cac mau khac (field nay
         * trong/khong ton tai o schema standard/villa cu). */}
        {commitmentRows.length ? (
          <section className="sheet-note sheet-commitments">
            <h3>Cam kết & bảo hành</h3>
            <ul>
              {commitmentRows.map((item, index) => (
                <li key={`${item}-${index}`}>{item}</li>
              ))}
            </ul>
          </section>
        ) : null}

        {notesRows.length ? (
          <section className="sheet-note sheet-note--terms">
            <h3>Điều khoản & ghi chú</h3>
            <ul>
              {notesRows.map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ul>
          </section>
        ) : null}

        {renderCustomBlocks(quoteData?.customBlocks)}

        <footer className="sheet-signatures">
          <div>
            <strong>{findField('companyRepresentative').label || 'Đại diện công ty'}</strong>
            {/* Khong con hien placeholder "[Đại diện công ty]" khi trong -
             * day la dong DE KY THAT, de trong (khong chu) van hop ly hon
             * hien 1 chuoi ngoac vuong khong phai chu ky ai ca. */}
            <span>{String(fieldValue('companyRepresentative') || '')}</span>
          </div>
          <div>
            <strong>{findField('customerRepresentative').label || 'Đại diện khách hàng'}</strong>
            <span>{String(fieldValue('customerRepresentative') || '')}</span>
          </div>
        </footer>
      </section>
    </div>
  );
}
