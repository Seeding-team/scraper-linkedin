'use client';

/** Xuất báo giá ra file Excel (.xlsx) thật — có format/merge ô/màu, không
 * phải CSV trá hình (yêu cầu "anh muốn convert từ form hiện tại sang excel
 * luôn được hong", Thảo/CloudGate, 2026-11-20). Dùng `exceljs` (không phải
 * `xlsx`/SheetJS đã có sẵn trong repo cho KpiLeaderboardContent.tsx — bản
 * Community Edition của `xlsx` KHÔNG hỗ trợ style/merge/màu ô). Nội dung bám
 * theo đúng bố cục bản in/PDF hiện có (QuoteDocumentRenderer.tsx) ở layout
 * tiêu chuẩn (header công ty, Thông tin khách hàng/Liên hệ, bảng dịch vụ có
 * Mục cha I/II/III, khối Tổng tiền) — KHÔNG đi theo toàn bộ hệ thống
 * schema/field động (quoteSummaryFields.ts/quoteCustomerFields.ts) để giữ
 * phạm vi gọn, vì 2 mẫu báo giá thật đã xem (Markee + CloudGate) đều dùng
 * đúng bố cục chuẩn này. */

import type ExcelJS from 'exceljs';
import type { QuoteData, QuoteItem } from '../types';
import {
  calculateItemDiscount,
  calculateItemTotal,
  calculateItemVat,
  calculateOverallDiscountSummary,
  calculateSectionTotal,
  type QuotePriceMode,
} from './quoteCalculations';

/** Ban sao doc lap voi toRomanNumeral trong QuoteWorkspaceModal.tsx/
 * QuoteDocumentRenderer.tsx/QuoteFormFiller.tsx - dung tien le co san cua
 * repo (moi module tu giu 1 ban, khong chia se qua lai). */
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

export interface ExportQuoteToExcelInput {
  quoteNumber?: string | null;
  quoteTitle?: string | null;
  quoteData?: QuoteData | null;
  quoteItems: QuoteItem[];
  totals: { subtotalAmount: number; totalVatAmount: number; totalAmount: number };
  currency?: string | null;
  priceMode?: QuotePriceMode;
  overallDiscountPercent?: number | null;
  contactPersonName?: string | null;
}

const BRAND_PINK = 'FFC2185B';
const HEADER_GREY = 'FFF3F4F6';
const SECTION_PINK = 'FFFDE2EB';
const BORDER_GREY: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
  bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
  left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
  right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
};

const COLUMN_COUNT = 9; // STT, Hạng mục, Mô tả, ĐVT, SL, Đơn giá, Giảm giá(%), VAT(%), Thành tiền
const COLUMN_WIDTHS = [6, 26, 40, 10, 8, 16, 12, 10, 18];

function fieldValue(data: QuoteData | null | undefined, key: string): string {
  const value = data?.[key];
  return value === null || value === undefined ? '' : String(value);
}

export async function exportQuoteToExcel(input: ExportQuoteToExcelInput): Promise<void> {
  const ExcelJS = (await import('exceljs')).default;
  const data = input.quoteData || null;
  const currency = input.currency || 'VND';
  const priceMode = input.priceMode;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'MarkeeAI CRM';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('Báo giá', {
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1 },
  });
  sheet.columns = COLUMN_WIDTHS.map(width => ({ width }));

  let row = 1;
  const merge = (r: number, c1: number, c2: number) => sheet.mergeCells(r, c1, r, c2);

  // ── Header công ty (logo bên trái, cột A-B dành riêng cho ảnh, chữ bắt
  // đầu từ cột C — khớp bố cục PDF: icon vuông bên trái tên công ty) ─────
  const sellerName = fieldValue(data, 'sellerCompanyName') || 'MARKEE';
  const sellerAddress = fieldValue(data, 'sellerAddress');
  const sellerContactLine = [fieldValue(data, 'sellerPhone'), fieldValue(data, 'sellerEmail'), fieldValue(data, 'sellerWebsite')]
    .filter(Boolean)
    .join('  ·  ');
  const sellerTaxCode = fieldValue(data, 'sellerTaxCode');
  const sellerLogoUrl = fieldValue(data, 'sellerLogo');

  const headerTextStartRow = row;
  sheet.getCell(row, 3).value = sellerName;
  sheet.getCell(row, 3).font = { bold: true, size: 16, color: { argb: BRAND_PINK } };
  merge(row, 3, 6);
  const quoteNumberCell = sheet.getCell(row, 7);
  quoteNumberCell.value = 'BÁO GIÁ';
  quoteNumberCell.font = { bold: true, size: 9, color: { argb: 'FF64748B' } };
  quoteNumberCell.alignment = { horizontal: 'right' };
  merge(row, 7, COLUMN_COUNT);
  row += 1;
  if (sellerAddress) {
    sheet.getCell(row, 3).value = sellerAddress;
    merge(row, 3, 6);
    const numCell = sheet.getCell(row, 7);
    numCell.value = input.quoteNumber || '';
    numCell.font = { bold: true };
    numCell.alignment = { horizontal: 'right' };
    merge(row, 7, COLUMN_COUNT);
    row += 1;
  }
  if (sellerContactLine) {
    sheet.getCell(row, 3).value = sellerContactLine;
    merge(row, 3, COLUMN_COUNT);
    row += 1;
  }
  if (sellerTaxCode) {
    sheet.getCell(row, 3).value = `MST: ${sellerTaxCode}`;
    merge(row, 3, COLUMN_COUNT);
    row += 1;
  }
  const headerTextEndRow = row - 1;
  // Anh logo chi THU duoc khi fetch duoc that (vd URL noi bo/CDN cho phep
  // CORS) - loi (404/CORS/khong co logo) thi BO QUA lang le, KHONG chan
  // ca file xuat (yeu cau "excel chưa có logo" la THEM, khong phai BAT
  // BUOC - thieu logo van phai ra duoc file).
  if (sellerLogoUrl) {
    try {
      const res = await fetch(sellerLogoUrl);
      if (res.ok) {
        const contentType = res.headers.get('content-type') || '';
        const buffer = await res.arrayBuffer();
        const extension = contentType.includes('png')
          ? 'png'
          : contentType.includes('gif')
            ? 'gif'
            : /\.png(\?|$)/i.test(sellerLogoUrl)
              ? 'png'
              : 'jpeg';
        const imageId = workbook.addImage({ buffer, extension });
        sheet.addImage(imageId, {
          tl: { col: 0.1, row: headerTextStartRow - 1 + 0.1 },
          ext: { width: 56, height: 56 },
          editAs: 'oneCell',
        });
      }
    } catch {
      // Khong co mang/CORS/URL hong - bo qua, van xuat file binh thuong.
    }
  }
  row = Math.max(row, headerTextEndRow) + 1;

  // ── Tiêu đề báo giá ─────────────────────────────────────────────────
  sheet.getCell(row, 1).value = (input.quoteTitle || fieldValue(data, 'quoteTitle') || 'BÁO GIÁ').toUpperCase();
  sheet.getCell(row, 1).font = { bold: true, size: 13 };
  sheet.getCell(row, 1).alignment = { horizontal: 'center' };
  merge(row, 1, COLUMN_COUNT);
  row += 2;

  // ── Thông tin khách hàng / Liên hệ ──────────────────────────────────
  const customerRecipient = fieldValue(data, 'customerRecipient') || fieldValue(data, 'customerContactName') || fieldValue(data, 'customerCompanyName');
  const customerContactName = fieldValue(data, 'customerContactName');
  const contactName = fieldValue(data, 'sellerContactNameOverride') || input.contactPersonName || fieldValue(data, 'sellerContactName');
  const contactPhone = fieldValue(data, 'sellerPhone');
  const contactEmail = fieldValue(data, 'sellerEmail') || 'admin@markee.vn';

  const infoStartRow = row;
  sheet.getCell(row, 1).value = 'THÔNG TIN KHÁCH HÀNG';
  sheet.getCell(row, 1).font = { bold: true, size: 10, color: { argb: BRAND_PINK } };
  merge(row, 1, 4);
  sheet.getCell(row, 5).value = 'THÔNG TIN LIÊN HỆ';
  sheet.getCell(row, 5).font = { bold: true, size: 10, color: { argb: BRAND_PINK } };
  merge(row, 5, COLUMN_COUNT);
  row += 1;

  const leftRows: Array<[string, string]> = [];
  if (customerRecipient) leftRows.push(['Kính gửi:', customerRecipient]);
  if (customerContactName) leftRows.push(['Người liên hệ khách hàng:', customerContactName]);
  const rightRows: Array<[string, string]> = [];
  if (contactName) rightRows.push(['Người liên hệ:', contactName]);
  if (contactPhone) rightRows.push(['SĐT:', contactPhone]);
  if (contactEmail) rightRows.push(['Email:', contactEmail]);

  const infoRowCount = Math.max(leftRows.length, rightRows.length, 1);
  for (let i = 0; i < infoRowCount; i += 1) {
    const left = leftRows[i];
    const right = rightRows[i];
    if (left) {
      sheet.getCell(row, 1).value = left[0];
      sheet.getCell(row, 1).font = { bold: true };
      sheet.getCell(row, 2).value = left[1];
      merge(row, 2, 4);
    }
    if (right) {
      sheet.getCell(row, 5).value = right[0];
      sheet.getCell(row, 5).font = { bold: true };
      sheet.getCell(row, 6).value = right[1];
      merge(row, 6, COLUMN_COUNT);
    }
    row += 1;
  }
  row = Math.max(row, infoStartRow + infoRowCount + 1) + 1;

  // ── Bảng dịch vụ / sản phẩm ─────────────────────────────────────────
  sheet.getCell(row, 1).value = 'BẢNG DỊCH VỤ / SẢN PHẨM';
  sheet.getCell(row, 1).font = { bold: true, size: 10, color: { argb: BRAND_PINK } };
  merge(row, 1, COLUMN_COUNT);
  row += 1;

  const headerRow = row;
  const headers = ['STT', 'Hạng mục', 'Tính năng bao gồm', 'ĐVT', 'SL', 'Đơn giá (VNĐ)', 'Giảm giá (%)', 'VAT (%)', 'Thành tiền (gồm VAT)'];
  headers.forEach((label, index) => {
    const cell = sheet.getCell(headerRow, index + 1);
    cell.value = label;
    cell.font = { bold: true, size: 10 };
    cell.alignment = { horizontal: index >= 3 ? 'center' : 'left', vertical: 'middle', wrapText: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_GREY } };
    cell.border = BORDER_GREY;
  });
  row += 1;

  let sectionCounter = 0;
  let itemCounter = 0;

  function writeDataRow(values: Array<string | number | null>, options: { bold?: boolean; fillArgb?: string; align?: Array<'left' | 'center' | 'right'> } = {}) {
    values.forEach((value, index) => {
      const cell = sheet.getCell(row, index + 1);
      cell.value = value === null ? '' : value;
      cell.border = BORDER_GREY;
      cell.font = { bold: Boolean(options.bold) };
      cell.alignment = { vertical: 'middle', horizontal: options.align?.[index] || (index >= 3 ? 'center' : 'left'), wrapText: index === 2 };
      if (options.fillArgb) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: options.fillArgb } };
      if (index === 5 || index === 8) cell.numFmt = '#,##0';
    });
  }

  function writeItemRow(child: QuoteItem) {
    itemCounter += 1;
    const discountPercent = child.discountType === 'amount'
      ? 0
      : Number(child.discountPercent || 0);
    const discountLabel = calculateItemDiscount(child, currency, priceMode) > 0 ? discountPercent : '–';
    const vatLabel = child.vatRate ? child.vatRate : '–';
    writeDataRow([
      String(itemCounter).padStart(2, '0'),
      child.serviceDescription || '',
      child.description || '',
      child.unit || '',
      child.quantity ?? '',
      child.unitPrice ?? 0,
      discountLabel,
      vatLabel,
      calculateItemTotal(child, currency, priceMode),
    ]);
    row += 1;
  }

  // BUG THAT DA GAP (feedback CloudGate 2026-11-21, "tải excel về k thấy tt
  // hạng mục sp"): vong lap truoc day CHI xu ly node.rowType==='section',
  // bo qua hoan toan hang muc nam THANG O GOC (khong co Muc cha bao quanh) -
  // bao gia Markee test truoc do tinh co MOI hang muc deu nam trong 1 trong
  // 3 Section nen khong lo ra. Them nhanh else de ghi hang muc goc binh
  // thuong (khong Muc cha, khong roman numeral).
  for (const node of input.quoteItems) {
    if (node.rowType === 'section') {
      sectionCounter += 1;
      const roman = toRomanNumeral(sectionCounter);
      const sectionTotal = calculateSectionTotal(node.children || [], currency, priceMode);
      sheet.getCell(row, 1).value = roman;
      merge(row, 1, 7);
      sheet.getCell(row, 1).value = `${roman} — ${(node.description || 'Mục mới').replace(new RegExp(`^${roman}[.\\s—-]*`), '')}`;
      sheet.getCell(row, 8).value = '';
      merge(row, 8, 8);
      sheet.getCell(row, 9).value = sectionTotal;
      sheet.getCell(row, 9).numFmt = '#,##0';
      for (let c = 1; c <= COLUMN_COUNT; c += 1) {
        const cell = sheet.getCell(row, c);
        cell.font = { bold: true };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SECTION_PINK } };
        cell.border = BORDER_GREY;
        if (c === 9) cell.alignment = { horizontal: 'right' };
      }
      row += 1;
      for (const child of node.children || []) {
        writeItemRow(child);
      }
    } else {
      writeItemRow(node);
    }
  }

  row += 1;

  // ── Khối tổng tiền ───────────────────────────────────────────────────
  const summary = calculateOverallDiscountSummary(
    { totalAmount: input.totals.totalAmount, totalVatAmount: input.totals.totalVatAmount },
    input.overallDiscountPercent ?? null,
    currency,
    data?.overallDiscountAmount ?? null,
    (data?.overallDiscountType as 'percent' | 'amount' | null) ?? null,
  );

  function writeTotalRow(label: string, value: number, bold = false) {
    sheet.getCell(row, 1).value = label;
    sheet.getCell(row, 1).font = { bold };
    merge(row, 1, 7);
    const cell = sheet.getCell(row, 8);
    cell.value = value;
    cell.numFmt = '#,##0';
    cell.font = { bold };
    cell.alignment = { horizontal: 'right' };
    merge(row, 8, COLUMN_COUNT);
    row += 1;
  }

  writeTotalRow('Tổng cộng chưa bao gồm thuế GTGT', summary.subtotalBeforeVat);
  if (summary.overallDiscountAmount > 0) {
    writeTotalRow('Giảm giá toàn báo giá', -summary.overallDiscountAmount);
  }
  writeTotalRow('Thuế GTGT', summary.vatAfterDiscount);
  writeTotalRow('TỔNG THANH TOÁN', summary.grandTotal, true);
  sheet.getCell(row - 1, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SECTION_PINK } };
  sheet.getCell(row - 1, 8).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SECTION_PINK } };
  row += 1;

  // ── Điều khoản thanh toán / ghi chú khác (data.customBlocks) ─────────
  // Dung CHUNG nguon voi renderCustomBlocks() trong QuoteDocumentRenderer.tsx
  // (block.title + block.content tach dong theo "\n") - khong gioi han
  // kind='payment_terms', hien HET cac custom block (Sale co the tu them
  // qua "+ Thêm nội dung"), giong y het ban in.
  const customBlocks = Array.isArray(data?.customBlocks) ? data.customBlocks : [];
  for (const block of customBlocks as Array<{ title?: string; content?: string }>) {
    const lines = String(block?.content || '')
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean);
    if (!block?.title && !lines.length) continue;
    const boxStartRow = row;
    if (block.title) {
      sheet.getCell(row, 1).value = block.title;
      sheet.getCell(row, 1).font = { bold: true };
      merge(row, 1, COLUMN_COUNT);
      row += 1;
    }
    for (const line of lines) {
      sheet.getCell(row, 1).value = line;
      merge(row, 1, COLUMN_COUNT);
      row += 1;
    }
    for (let r = boxStartRow; r < row; r += 1) {
      sheet.getCell(r, 1).border = BORDER_GREY;
      sheet.getCell(r, COLUMN_COUNT).border = BORDER_GREY;
    }
    row += 1;
  }

  // ── Chữ ký (ĐẠI DIỆN CÔNG TY / KHÁCH HÀNG) ────────────────────────────
  row += 2;
  sheet.getCell(row, 1).value = 'ĐẠI DIỆN CÔNG TY';
  sheet.getCell(row, 1).font = { bold: true };
  sheet.getCell(row, 1).alignment = { horizontal: 'center' };
  merge(row, 1, 4);
  sheet.getCell(row, 6).value = 'KHÁCH HÀNG';
  sheet.getCell(row, 6).font = { bold: true };
  sheet.getCell(row, 6).alignment = { horizontal: 'center' };
  merge(row, 6, COLUMN_COUNT);
  row += 4; // khoang trong de ky tay

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `bao-gia-${input.quoteNumber || Date.now()}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
