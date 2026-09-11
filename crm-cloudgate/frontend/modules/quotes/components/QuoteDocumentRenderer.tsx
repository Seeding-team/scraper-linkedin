'use client';

import { useRef, useState } from 'react';
import type {
  CustomBlock,
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
  formatVnd as formatVndRaw,
  flattenQuoteItems,
} from '../utils/quoteCalculations';

// Yeu cau rieng "bỏ 'đ' trong các mẫu báo giá đi" - moi tien te da ghi ro 1
// LAN duy nhat o dau tai lieu ("TIỀN TỆ VND") + header cot ("(VNĐ)"), lap
// lai "đ" tren TUNG so trong bang la du thua. Shadow lai formatVnd CHI
// trong file nay (formatVnd goc o quoteCalculations.ts van giu nguyen "đ"
// cho moi noi khac dang dung, khong doi hanh vi chung).
function formatVnd(value: unknown): string {
  return formatVndRaw(value).replace(/\s*đ$/, '');
}
import { resolveQuoteItemColumns, resolveToggleableColumns } from '../utils/quoteColumns';

interface Totals {
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
}: Props) {
  // Resize cot bang hang muc kieu Excel - CHI cho man hinh xem truoc/chi tiet
  // noi bo (mode 'preview'/'detail', xem allowColumnResize ben duoi), KHONG
  // anh huong ban in/PDF (@media print da ep width qua !important nen inline
  // style o day luon bi ghi de luc in, xem quotes.css) va KHONG hien cho
  // khach (mode 'public'). null = chua ai resize, dung CSS mac dinh (%).
  const [resizedColumnWidths, setResizedColumnWidths] = useState<Record<string, number> | null>(null);
  const headerRowRef = useRef<HTMLTableRowElement | null>(null);
  const resizeDragRef = useRef<{ key: string; startX: number; startWidth: number } | null>(null);

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
      setResizedColumnWidths(prev => ({ ...(prev || {}), [drag.key]: nextWidth }));
    };
    const handleMouseUp = () => {
      resizeDragRef.current = null;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
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
  const fieldValue = (key: string) => {
    const value = quoteData[key];
    if (value !== undefined && value !== null && value !== '') return value;
    return findField(key).defaultValue || '';
  };
  const renderCell = (item: QuoteItem, column: QuoteField, index: number) => {
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

  const lineDiscountAmount = flattenQuoteItems(quoteItems).reduce(
    (sum, item) => sum + calculateItemDiscount(item),
    0
  );
  const discountPercentValue = textValue(quoteData.discountPercent);
  // Quote mới dùng giảm giá theo từng dòng cha/con. Giữ fallback discountPercent
  // tổng cho quote cũ đã lưu trước khi có cấu trúc line-level discount.
  const resolvedDiscountAmount =
    totals.discountAmount ??
    (lineDiscountAmount ||
      (discountPercentValue ? (totals.subtotalAmount * Number(discountPercentValue)) / 100 : 0));
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

  const customerRows = findSection('customer')
    .fields.filter(field => field.visible !== false)
    .map(field => ({
      key: field.key,
      label: field.label,
      value: textValue(fieldValue(field.key)),
      placeholder: `[${field.label}]`,
    }));
  const validUntil = textValue(fieldValue('offerExpiryDate'))
    ? formatDateVN(fieldValue('offerExpiryDate'))
    : textValue(fieldValue('validityDays'))
      ? `${textValue(fieldValue('validityDays'))} ngày kể từ ngày báo giá`
      : '';
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
  const finalColumns = applyCustomerColumnFilter
    ? customerVisibleColumns
      ? standardColumns.filter(
          column => !TOGGLEABLE_COLUMN_KEYS.includes(column.key) || customerVisibleColumns.includes(column.key)
        )
      : standardColumns.filter(column => !DEFAULT_HIDDEN_FROM_CUSTOMER_KEYS.includes(column.key))
    : standardColumns;
  // Resize cot kieu Excel chi bat o man hinh noi bo (nguoi TAO/xem chi tiet
  // bao gia) - khong bat cho 'public' (khach nhan bao gia khong can/khong nen
  // co UI keo cot) va khong lien quan ban in (ban in doc theo @media print,
  // khong doc prop mode nay).
  const allowColumnResize = mode === 'preview' || mode === 'detail';
  // Bang qua nhieu cot (vd mau "chuan" 9 cot: STT/Ten dich vu/Mo ta/DVT/So
  // luong/Don gia/Giam gia/VAT/Thanh tien) khong the nen vua khong gian A4 du
  // da nong cot Mo ta/Ten dich vu - cac cot so con lai bi ep qua hep gay
  // chong chit/tran mep (QA thuc te + nguoi dung bao cao qua screenshot man
  // hinh XEM, khong chi ban in). Tu 7 cot tro len, chuyen sang A4 NGANG cho
  // CA man hinh xem (class .quote-sheet--print-landscape trong quotes.css)
  // LAN ban in/PDF (the <style> chen duoi day, KHONG dung CSS "named page" -
  // xem giai thich trong quotes.css, muc @page - da xac nhan Chromium bi 1
  // loi that lam mat noi dung cuoi tai lieu voi named page). Bang van la
  // <table> that, chi chia lai % cot rong rai hon, khong doi sang dang the
  // xep doc/thu nho.
  const LANDSCAPE_PRINT_COLUMN_THRESHOLD = 7;
  const usesLandscapePrint = finalColumns.length >= LANDSCAPE_PRINT_COLUMN_THRESHOLD;
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
      const sectionRow = { item, number: toRomanNumeral(sectionCounter), isChild: false, isSection: true as const };
      const childRows = (item.children || []).map(child => {
        itemCounter += 1;
        return { item: child, number: String(itemCounter).padStart(2, '0'), isChild: true, isSection: false as const };
      });
      return [sectionRow, ...childRows];
    }
    itemCounter += 1;
    return [{ item, number: String(itemCounter).padStart(2, '0'), isChild: false, isSection: false as const }];
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
                    <th key={column.key}>{column.label}</th>
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
              <div className="villa-total-row">
                <span>Phí triển khai</span>
                <strong>{formatVnd(setupTotal || totals.totalAmount)}</strong>
              </div>
              <div className="villa-total-row">
                <span>Phí duy trì hàng tháng</span>
                <strong>{formatVnd(fieldValue('monthlyAmount'))}</strong>
              </div>
              <div className="villa-total-sub">
                Thanh toán đợt 1 ({phaseOnePercent}%):{' '}
                {formatVnd((setupTotal * phaseOnePercent) / 100)}
              </div>
              <div className="villa-total-sub">
                Thanh toán đợt 2 ({phaseTwoPercent}%):{' '}
                {formatVnd((setupTotal * phaseTwoPercent) / 100)}
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
              <p>Email: {String(fieldValue('sellerEmail'))}</p>
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
        <style>{'@media print { @page { size: A4 landscape; margin: 10mm 12mm; } }'}</style>
      ) : null}
      <section className={`quote-sheet quote-sheet--standard${usesLandscapePrint ? ' quote-sheet--print-landscape' : ''}`}>
        <header className="sheet-company sheet-company--standard">
          <div className="sheet-brand-block">
            {fieldValue('sellerLogo') ? (
              <img className="sheet-brand-logo" src={String(fieldValue('sellerLogo'))} alt={String(fieldValue('sellerCompanyName') || '')} />
            ) : null}
            <div className="sheet-brand-mark">{String(fieldValue('sellerCompanyName') || 'MARKEE')}</div>
            <p>{String(fieldValue('sellerAddress'))}</p>
            <p>
              {String(fieldValue('sellerPhone'))}
              {fieldValue('sellerEmail') ? ` · ${String(fieldValue('sellerEmail'))}` : ''}
              {fieldValue('sellerWebsite') ? ` · ${String(fieldValue('sellerWebsite'))}` : ''}
            </p>
          </div>
          <div className="sheet-doc-code">
            <span>BÁO GIÁ</span>
            <strong>{quoteNumber || String(fieldValue('quoteNumber') || '[Số báo giá]')}</strong>
          </div>
        </header>

        <section className="sheet-title-block sheet-title-block--standard">
          <p className="sheet-eyebrow">Đề xuất thương mại</p>
          <h1>{String(fieldValue('quoteTitle') || 'Bảng báo giá')}</h1>
          <div className="sheet-quote-meta sheet-quote-meta--cards">
            {/* "Ngày báo giá chỉ hiển thị khi bấm phát hành" - truoc khi
             * published, ngay nay chua chinh thuc/co the con doi, an han
             * ca nhan lan gia tri (khong hien placeholder "[Ngày báo giá]"). */}
            {isPublished ? (
              <span><b>Ngày báo giá</b>{formatDateVN(fieldValue('quoteDate')) || ''}</span>
            ) : null}
            <span><b>Hiệu lực</b>{validUntil || '[Thời hạn hiệu lực]'}</span>
            <span><b>Tiền tệ</b>{String(fieldValue('currency') || 'VND')}</span>
          </div>
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
          const sellerContactRows = [
            { key: 'sellerContactName', label: findField('sellerContactName').label, value: String(fieldValue('sellerContactName') || '') },
            { key: 'sellerPhone', label: findField('sellerPhone').label, value: String(fieldValue('sellerPhone') || '') },
            { key: 'sellerEmail', label: findField('sellerEmail').label, value: String(fieldValue('sellerEmail') || '') },
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
                  <h3>Người phụ trách</h3>
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
              className={`sheet-items-table${usesLandscapePrint ? ' sheet-items-table--print-landscape' : ''}${allowColumnResize ? ' sheet-items-table--resizable' : ''}`}
              style={
                // Da resize it nhat 1 cot: dat width = TONG cac cot (co the
                // vuot 100% wrapper) de bang tu gian rong ra that su thay vi
                // bi table-layout:fixed ep co lai vua khung - .sheet-items-
                // table-wrap co san overflow-x:auto se tu hien thanh cuon
                // ngang, dung hanh vi Excel (rong 1 cot khong lam hep cot
                // khac). Chua resize: giu nguyen minWidth mac dinh nhu cu.
                allowColumnResize && resizedColumnWidths
                  ? { width: Object.values(resizedColumnWidths).reduce((sum, w) => sum + w, 0) }
                  : { minWidth: Math.min(760, Math.max(420, finalColumns.length * 70)) }
              }
            >
              <thead>
                <tr ref={headerRowRef}>
                  {finalColumns.map(column => (
                    <th
                      key={column.key}
                      className={column.key === 'unit' ? 'unit-cell' : undefined}
                      style={
                        allowColumnResize && resizedColumnWidths?.[column.key]
                          ? { width: resizedColumnWidths[column.key], minWidth: resizedColumnWidths[column.key] }
                          : undefined
                      }
                    >
                      {column.label}
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
                  displayedQuoteRows.map((row, index) =>
                    row.isSection ? (
                      <tr key={row.item.id || `section-${row.number}-${index}`} className="quote-item-row quote-item-row--section">
                        <td colSpan={Math.max(finalColumns.length, 1)}>
                          <strong>{row.number} — {stripLeadingRomanPrefix(String(row.item.description || row.item.serviceDescription || ''), row.number)}</strong>
                        </td>
                      </tr>
                    ) : (
                      <tr key={row.item.id || `${row.number}-${index}`} className={row.isChild ? 'quote-item-row quote-item-row--child' : 'quote-item-row quote-item-row--parent'}>
                        {finalColumns.map(column => (
                          <td
                            key={column.key}
                            data-label={column.label}
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
                              ['unitPrice', 'subtotal', 'vatAmount', 'total', 'amountAfterDiscount', 'listPriceUsd', 'unitPriceUsd', 'unitPriceVnd'].includes(column.key)
                                ? 'money-cell'
                                : column.key === 'unit'
                                  ? 'unit-cell'
                                  : undefined
                            }
                          >
                            {column.type === 'auto-number' || column.key === 'order'
                              ? row.number
                              : renderCell(row.item, column, index)}
                          </td>
                        ))}
                      </tr>
                    )
                  )
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="sheet-total-block sheet-total-block--standard">
          <div className="sheet-total-row">
            <span>{findField('subtotalAmount').label || 'Tổng trước VAT'}</span>
            <strong>{formatVnd(totals.subtotalAmount)}</strong>
          </div>
          {resolvedDiscountAmount ? (
            <div className="sheet-total-row sheet-total-row--discount">
              <span>Giảm giá</span>
              <strong>-{formatVnd(resolvedDiscountAmount)}</strong>
            </div>
          ) : null}
          <div className="sheet-total-row">
            <span>{findField('totalVatAmount').label || 'VAT'}</span>
            <strong>{formatVnd(totals.totalVatAmount)}</strong>
          </div>
          <div className="sheet-total-row sheet-total-row--grand">
            <span>{findField('totalAmount').label || 'Tổng cộng'}</span>
            <strong>{formatVnd(totals.totalAmount)}</strong>
          </div>
        </section>

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
