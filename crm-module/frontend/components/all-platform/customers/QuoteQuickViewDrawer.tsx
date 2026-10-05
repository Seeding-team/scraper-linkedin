"use client";

/**
 * "Xem nhanh báo giá" — panel read-only mo NGAY trong Deal Workspace (khong
 * redirect sang Quote Center, khong mo wizard sua). Tai su dung CHINH
 * QuoteDocumentRenderer (mode="detail") - cung 1 component da dung o trang
 * chi tiet bao gia full-page (QuoteDetailPage.tsx) - khong tao 1 engine
 * render/data source thu hai. Header rieng cua drawer nay chi hien them cac
 * field ngu canh (khach hang/co hoi/don vi phat hanh/ngay/hieu luc) ma
 * QuoteDocumentRenderer (dinh dang tai lieu in) khong the hien.
 */

import { X, ExternalLink, Pencil } from "lucide-react";
import { QuoteDocumentRenderer } from "@/modules/quotes/components/QuoteDocumentRenderer";
import type { Quote, QuoteItem } from "@/modules/quotes";
import { internalQuoteStatusClass, internalQuoteStatusLabel } from "@/modules/quotes/constants/quoteConfig";
import { formatQuoteAmountOr, quoteCurrencyToVnd } from '@/lib/currency';

/** Items tra ve tu backend la 1 CAY (section chua children long nhau, xem
 * _quote_item_tree() o supabase_quote_service.py) - bang tom tat o day chi
 * can danh sach PHANG cac dong hang muc THAT (rowType !== "section"), bat ke
 * nam truc tiep o root hay long trong 1 section, nen phai de quy qua
 * children thay vi chi loc top-level (loc top-level se mat trang het item
 * nao duoc nhom duoi 1 Section - dung bug thuc te da gap). */
function flattenQuoteLineItems(items: QuoteItem[] | undefined): QuoteItem[] {
  const result: QuoteItem[] = [];
  function walk(list: QuoteItem[] | undefined) {
    for (const item of list || []) {
      if (item.rowType === "section") {
        walk(item.children);
      } else {
        result.push(item);
        if (item.children && item.children.length) walk(item.children);
      }
    }
  }
  walk(items);
  return result;
}

function formatDeltaVND(value: number | null | undefined): string {
  if (value == null) return "—";
  if (value === 0) return "0đ";
  const sign = value > 0 ? "+" : "-";
  return `${sign}${Math.abs(value).toLocaleString("vi-VN")}đ`;
}

function formatDeltaPercentPoint(value: number | null | undefined): string {
  if (value == null) return "—";
  if (value === 0) return "0 điểm %";
  const sign = value > 0 ? "+" : "-";
  return `${sign}${Math.abs(value).toFixed(1).replace(".", ",")} điểm %`;
}

function deltaColorClass(value: number | null | undefined): string {
  if (value == null || value === 0) return "text-slate-700";
  return value > 0 ? "text-emerald-600" : "text-red-600";
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("vi-VN");
}

/** Doc tu snapshot `data` cua bao gia (khong live-join lai bang khac) - dung
 * y het quy uoc quoteIssuerName()/quoteCustomerName() da co trong
 * QuoteHistoryPage.tsx, khong fork logic thu hai. */
function issuerName(quote: Quote): string {
  const data = quote.data || {};
  return String((data as any).sellerCompanyName || (data as any).sellerBrandName || "—");
}

/** Quote con sua duoc = dung y het rule server da enforce (status='draft').
 * Day chi la UI gating - server van la nguoi quyet dinh cuoi cung khi luu. */
function isEditable(quote: Quote): boolean {
  return quote.status === "draft";
}

function hasRealPublicLink(quote: Quote): boolean {
  return Boolean(quote.publicUrl) && Boolean(quote.publicEnabled) && (quote.status === "approved" || quote.status === "confirmed");
}

function formatVNDShort(value?: number | null) {
  if (value == null) return "—";
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 }).format(value);
}

/** "Lịch sử phiên bản" - dung chung cho ca vi tri tren dau (overlay, hien
 * chua co caller nao thuc su truyen versions) VA vi tri duoi cung (embedded,
 * mockup 2026-10-01). "Xem phiên bản này" goi thang `onSelectVersion` (=
 * setSelectedVersionId cua form cha) - khong tao state/nguon du lieu song
 * song thu hai. */
function VersionHistoryList({
  versions,
  selectedVersionId,
  onSelectVersion,
}: {
  versions: Quote[];
  selectedVersionId?: string;
  onSelectVersion?: (id: string) => void;
}) {
  return (
    <div>
      <div className="mb-2 text-xs font-semibold text-slate-500">Lịch sử phiên bản</div>
      <div className="space-y-1.5">
        {versions.map((v, idx) => {
          const isSelected = v.id === selectedVersionId;
          return (
            <div
              key={v.id}
              className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md border px-2.5 py-1.5 text-xs ${
                isSelected ? "border-primary/40 bg-primary/5" : "border-slate-200"
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-slate-700">V{v.versionNumber || 1}{idx === 0 ? " · mới nhất" : ""}</span>
                <span className="text-slate-400">{formatDate(v.updatedAt)}</span>
                <span className={`quote-badge ${internalQuoteStatusClass(v.status)}`}>{internalQuoteStatusLabel(v.status)}</span>
                <span className="text-slate-500">{formatQuoteAmountOr(v.customerPriceBeforeVat ?? v.totalAmount ?? null, v.currency, formatVNDShort)}</span>
              </div>
              {!isSelected && onSelectVersion ? (
                <button
                  type="button"
                  onClick={() => onSelectVersion(v.id)}
                  className="shrink-0 font-semibold text-primary hover:underline"
                >
                  Xem phiên bản này →
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface Props {
  quote: Quote | null;
  open: boolean;
  customerName?: string | null;
  dealName?: string | null;
  onClose: () => void;
  onEdit?: (quote: Quote) => void;
  /** "embedded" (redesign 2026-10-01, RegisterExternalContractModal): render
   * nhu 1 panel NAM TRONG cha (khong backdrop, khong fixed/overlay full man
   * hinh) de hien SONG SONG voi form thay vi che het. Mac dinh "overlay" giu
   * NGUYEN y het hanh vi/giao dien cu cho DealWorkspaceTabs (caller kia KHONG
   * truyen prop nay nen KHONG doi gi ca). */
  mode?: "overlay" | "embedded";
  /** Danh sach phien ban (V1/V2/...) de hien "Lịch sử phiên bản" + cho chuyen
   * dang xem ngay trong panel nay. Chi dung khi mode="embedded" - overlay
   * (DealWorkspaceTabs) khong truyen nen khong hien gi them. */
  versions?: Quote[] | null;
  selectedVersionId?: string;
  onSelectVersion?: (id: string) => void;
  /** Ten Nguoi lien he chinh DA RESOLVE san boi cha (RegisterExternalContractModal
   * dung 1 chuoi fallback rieng: contactId cua bao gia -> contact cua Deal ->
   * Khach hang chi co 1 Lien he -> "—") - chi dung khi mode="embedded", KHONG
   * fork lai logic resolve o day. overlay (DealWorkspaceTabs) khong truyen. */
  primaryContactName?: string | null;
}

export function QuoteQuickViewDrawer({ quote, open, customerName, dealName, onClose, onEdit, mode = "overlay", versions, selectedVersionId, onSelectVersion, primaryContactName }: Props) {
  const embedded = mode === "embedded";

  // "So với phiên bản trước" (feedback 2026-10-02) - `versions` da duoc cha
  // sap xep moi nhat truoc (xem list_quote_versions(), order version_number
  // desc), nen "phien ban truoc" chinh la phan tu NGAY SAU quote hien tai
  // trong mang - khong tu doan version_number - 1 (co the co khoang trong
  // neu 1 phien ban bi xoa).
  const previousVersion = (() => {
    if (!embedded || !quote || !versions || versions.length < 2) return null;
    const idx = versions.findIndex(v => v.id === quote.id);
    return idx >= 0 && idx + 1 < versions.length ? versions[idx + 1] : null;
  })();
  const customerPriceDelta = previousVersion
    ? (quote!.customerPriceBeforeVat ?? quote!.totalAmount ?? 0) - (previousVersion.customerPriceBeforeVat ?? previousVersion.totalAmount ?? 0)
    : null;
  // Giá vốn/lợi nhuận/margin: gate bang DUNG 2 co (costViewAllowed rieng cho
  // gia von, profitabilityViewAllowed rieng cho loi nhuan/margin - khac
  // nhau, xem comment tren Quote.profitabilityViewAllowed) - cung quy uoc
  // "!== false" (undefined = chua biet quyen, van cho hien, false moi la
  // CHU DONG bi chan) da dung o CustomerQuotesTab.tsx, KHONG tu suy tu
  // hasCostData (hasCostData=false ban than no da bi backend ha xuong khi
  // khong co quyen, nhung gate truc tiep theo *_ViewAllowed van ro rang
  // hon, dung dung cung 1 nguon that voi cho khac).
  const costAllowed = quote?.costViewAllowed !== false && previousVersion?.costViewAllowed !== false;
  const profitAllowed = quote?.profitabilityViewAllowed !== false && previousVersion?.profitabilityViewAllowed !== false;
  const costTotalDelta = previousVersion && costAllowed && quote!.hasCostData && previousVersion.hasCostData
    ? (quote!.costTotal ?? 0) - (previousVersion.costTotal ?? 0)
    : null;
  const grossProfitDelta = previousVersion && profitAllowed && quote!.hasCostData && previousVersion.hasCostData
    ? (quote!.grossProfit ?? 0) - (previousVersion.grossProfit ?? 0)
    : null;
  const marginDelta = previousVersion && profitAllowed && quote!.hasCostData && previousVersion.hasCostData
    ? (quote!.grossMarginPercent ?? 0) - (previousVersion.grossMarginPercent ?? 0)
    : null;

  const panel = (
      <aside
        className={
          embedded
            ? "flex h-full w-full flex-col bg-white"
            : `fixed right-0 top-0 z-[99986] flex h-screen w-full max-w-[52rem] flex-col border-l border-slate-200 bg-white shadow-2xl transition-transform duration-300 ${
                open ? "translate-x-0" : "translate-x-full"
              }`
        }
      >
        <header className="flex shrink-0 items-start justify-between border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wider text-slate-400">Xem nhanh báo giá</div>
            {quote ? (
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-bold text-slate-800">{quote.quoteNumber}</h2>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                  Phiên bản: V{quote.versionNumber || 1}
                </span>
                <span className={`quote-badge ${internalQuoteStatusClass(quote.status)}`}>{internalQuoteStatusLabel(quote.status)}</span>
              </div>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {quote && hasRealPublicLink(quote) ? (
              <a
                href={quote.publicUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-100"
              >
                <ExternalLink className="size-3.5" /> Mở link báo giá
              </a>
            ) : null}
            {quote && onEdit && isEditable(quote) ? (
              <button
                type="button"
                onClick={() => onEdit(quote)}
                className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-2.5 py-1.5 text-xs font-semibold text-primary transition hover:bg-primary/20"
              >
                <Pencil className="size-3.5" /> Chỉnh sửa
              </button>
            ) : null}
            <button onClick={onClose} className="rounded p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600">
              <X className="size-4" />
            </button>
          </div>
        </header>

        {/* "Lịch sử phiên bản" - CHI hien o day (ngay duoi header) cho mode
         * overlay (DealWorkspaceTabs, hien tai khong truyen versions nen
         * block nay khong bao gio render o overlay - giu cho tuong lai).
         * Voi mode="embedded" (RegisterExternalContractModal), khoi nay
         * duoc chuyen xuong DUOI CUNG (sau bang Hạng mục báo giá) de khop
         * dung thu tu mockup "Xem nhanh báo giá" (feedback 2026-10-01: "chỗ
         * xem nhanh báo giá UI như v nè chứ k phải hiện báo giá như pdf"). */}
        {!embedded && versions && versions.length > 1 ? (
          <div className="shrink-0 border-b border-slate-100 px-5 py-3">
            <VersionHistoryList versions={versions} selectedVersionId={selectedVersionId} onSelectVersion={onSelectVersion} />
          </div>
        ) : null}

        {quote ? (
          embedded ? (
            // Panel tom tat DON GIAN (mockup 2026-10-01) - KHONG dung
            // QuoteDocumentRenderer (dinh dang tai lieu PDF gui khach, qua
            // rom ra cho 1 luot "xem nhanh de chon dung bao gia") - chi hien
            // dung 4 chi so + 1 bang hang muc THO, giong het cach ScreenShot
            // mau the hien, KHONG tao 1 engine render bao gia thu hai (van
            // doc thang tu `quote.items`/`quote.data`, khong bia them field
            // moi nao khong co that tren Quote).
            <div className="crm-scroll-hidden flex-1 overflow-y-auto px-5 py-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-lg border border-slate-200 p-3">
                  <div className="text-xs text-slate-400">Giá khách</div>
                  <div className="mt-0.5 text-lg font-bold text-slate-800">
                    {formatQuoteAmountOr(quote.customerPriceBeforeVat ?? quote.totalAmount ?? null, quote.currency, formatVNDShort)}
                  </div>
                </div>
                {quote.costViewAllowed !== false ? (
                  <div className="rounded-lg border border-slate-200 p-3">
                    <div className="text-xs text-slate-400">Giá vốn</div>
                    <div className="mt-0.5 text-lg font-bold text-slate-800">
                      {quote.hasCostData && quote.costTotal != null ? formatVNDShort(quote.costTotal) : "—"}
                    </div>
                  </div>
                ) : null}
                {quote.profitabilityViewAllowed !== false ? (
                  <div className="rounded-lg border border-slate-200 p-3">
                    <div className="text-xs text-slate-400">Lợi nhuận gộp</div>
                    <div className="mt-0.5 text-lg font-bold text-emerald-600">
                      {quote.hasCostData && quote.grossProfit != null ? formatVNDShort(quote.grossProfit) : "—"}
                    </div>
                  </div>
                ) : null}
                {quote.profitabilityViewAllowed !== false ? (
                  <div className="rounded-lg border border-slate-200 p-3">
                    <div className="text-xs text-slate-400">Margin</div>
                    <div className="mt-0.5 text-lg font-bold text-sky-600">
                      {quote.hasCostData && quote.grossMarginPercent != null ? `${quote.grossMarginPercent.toFixed(1)}%` : "—"}
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-xs text-slate-400">Liên hệ chính</div>
                  <div className="font-medium text-slate-700">{primaryContactName || "—"}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-400">Phụ trách</div>
                  <div className="font-medium text-slate-700">{quote.quoteOwner?.name || quote.technicalOwner?.name || "—"}</div>
                </div>
              </div>

              <div className="mt-4">
                <div className="mb-2 text-sm font-bold text-slate-700">Hạng mục báo giá</div>
                {(() => {
                  const lineItems = flattenQuoteLineItems(quote.items);
                  const showCost = quote.costViewAllowed !== false;
                  const showProfit = quote.profitabilityViewAllowed !== false;
                  // Moi dong: giaKhach = amountAfterDiscount (gia sau chiet
                  // khau - DUNG field tai lieu bao gia that dang dung, khong
                  // bia them "don gia truoc chiet khau" rieng); giaVon =
                  // quantity*costPrice (null neu costPrice chua nhap, KHONG
                  // bia 0); loiNhuan/margin tinh THANG tu 2 so nay - khong
                  // doc lai item.markupPercent (field khac muc dich, gac
                  // quyen rieng - xem comment tren QuoteItem).
                  const rows = lineItems.map(item => {
                    const giaKhach = item.amountAfterDiscount ?? null;
                    const giaVon = item.costPrice != null ? (item.quantity || 0) * item.costPrice : null;
                    const loiNhuan = giaKhach != null && giaVon != null ? giaKhach - giaVon : null;
                    const margin = loiNhuan != null && giaKhach ? (loiNhuan / giaKhach) * 100 : null;
                    return { item, giaKhach, giaVon, loiNhuan, margin };
                  });
                  const tong = rows.reduce(
                    (acc, r) => ({
                      giaKhach: acc.giaKhach + (r.giaKhach || 0),
                      giaVon: r.giaVon != null ? acc.giaVon + r.giaVon : acc.giaVon,
                      hasGiaVon: acc.hasGiaVon || r.giaVon != null,
                      loiNhuan: r.loiNhuan != null ? acc.loiNhuan + r.loiNhuan : acc.loiNhuan,
                      hasLoiNhuan: acc.hasLoiNhuan || r.loiNhuan != null,
                    }),
                    { giaKhach: 0, giaVon: 0, hasGiaVon: false, loiNhuan: 0, hasLoiNhuan: false }
                  );
                  const tongMargin = tong.hasLoiNhuan && tong.giaKhach ? (tong.loiNhuan / tong.giaKhach) * 100 : null;
                  return (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[32rem] text-xs">
                        <thead>
                          <tr className="border-b border-slate-200 text-left text-slate-400">
                            <th className="py-1.5 pr-2 font-semibold">Hạng mục</th>
                            <th className="py-1.5 pr-2 text-right font-semibold">SL</th>
                            {showCost ? <th className="py-1.5 pr-2 text-right font-semibold">Giá vốn</th> : null}
                            <th className="py-1.5 pr-2 text-right font-semibold">Giá khách</th>
                            {showProfit ? <th className="py-1.5 pr-2 text-right font-semibold">Lợi nhuận</th> : null}
                            {showProfit ? <th className="py-1.5 text-right font-semibold">Margin</th> : null}
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map(({ item, giaKhach, giaVon, loiNhuan, margin }, idx) => (
                            <tr key={item.id || idx} className="border-b border-slate-100">
                              <td className="py-1.5 pr-2 text-slate-700">{item.serviceDescription || item.description || "—"}</td>
                              <td className="py-1.5 pr-2 text-right text-slate-600">{item.quantity ?? "—"}</td>
                              {showCost ? (
                                <td className="py-1.5 pr-2 text-right text-slate-600">{giaVon != null ? formatVNDShort(giaVon) : "—"}</td>
                              ) : null}
                              <td className="py-1.5 pr-2 text-right font-medium text-slate-700">{formatVNDShort(giaKhach)}</td>
                              {showProfit ? (
                                <td className="py-1.5 pr-2 text-right text-slate-600">{loiNhuan != null ? formatVNDShort(loiNhuan) : "—"}</td>
                              ) : null}
                              {showProfit ? (
                                <td className="py-1.5 text-right text-slate-600">{margin != null ? `${margin.toFixed(1)}%` : "—"}</td>
                              ) : null}
                            </tr>
                          ))}
                          <tr className="font-bold text-slate-800">
                            <td className="py-1.5 pr-2">Tổng</td>
                            <td className="py-1.5 pr-2" />
                            {showCost ? (
                              <td className="py-1.5 pr-2 text-right">{tong.hasGiaVon ? formatVNDShort(tong.giaVon) : "—"}</td>
                            ) : null}
                            <td className="py-1.5 pr-2 text-right">{formatVNDShort(tong.giaKhach)}</td>
                            {showProfit ? (
                              <td className="py-1.5 pr-2 text-right">{tong.hasLoiNhuan ? formatVNDShort(tong.loiNhuan) : "—"}</td>
                            ) : null}
                            {showProfit ? (
                              <td className="py-1.5 text-right">{tongMargin != null ? `${tongMargin.toFixed(1)}%` : "—"}</td>
                            ) : null}
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  );
                })()}
                <p className="mt-1.5 text-[11px] text-slate-400">
                  Giá vốn, lợi nhuận và margin chỉ hiển thị cho user có quyền xem profitability.
                </p>
              </div>

              {previousVersion ? (
                <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="mb-2 text-xs font-semibold text-slate-600">So với phiên bản trước</div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div>
                      <div className="text-[11px] text-slate-400">Giá khách</div>
                      <div className={`text-sm font-semibold ${deltaColorClass(customerPriceDelta)}`}>{formatDeltaVND(customerPriceDelta)}</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-400">Giá vốn</div>
                      <div className={`text-sm font-semibold ${deltaColorClass(costTotalDelta)}`}>{formatDeltaVND(costTotalDelta)}</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-400">Lợi nhuận</div>
                      <div className={`text-sm font-semibold ${deltaColorClass(grossProfitDelta)}`}>{formatDeltaVND(grossProfitDelta)}</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-400">Margin</div>
                      <div className={`text-sm font-semibold ${deltaColorClass(marginDelta)}`}>{formatDeltaPercentPoint(marginDelta)}</div>
                    </div>
                  </div>
                </div>
              ) : null}

              {versions && versions.length > 1 ? (
                <div className="mt-4">
                  <VersionHistoryList versions={versions} selectedVersionId={selectedVersionId} onSelectVersion={onSelectVersion} />
                </div>
              ) : null}
            </div>
          ) : (
            <>
              <div className="grid shrink-0 grid-cols-2 gap-x-6 gap-y-2 border-b border-slate-100 bg-slate-50 px-5 py-3 text-xs sm:grid-cols-4">
                <div>
                  <div className="text-slate-400">Khách hàng</div>
                  <div className="truncate font-medium text-slate-700">{customerName || "—"}</div>
                </div>
                <div>
                  <div className="text-slate-400">Cơ hội</div>
                  <div className="truncate font-medium text-slate-700">{dealName || "—"}</div>
                </div>
                <div>
                  <div className="text-slate-400">Đơn vị phát hành</div>
                  <div className="truncate font-medium text-slate-700">{issuerName(quote)}</div>
                </div>
                <div>
                  <div className="text-slate-400">Ngày báo giá</div>
                  <div className="font-medium text-slate-700">{formatDate(quote.issuedAt)}</div>
                </div>
                <div>
                  <div className="text-slate-400">Hiệu lực</div>
                  <div className="font-medium text-slate-700">{formatDate(quote.validUntil)}</div>
                </div>
                <div>
                  <div className="text-slate-400">Tiền tệ</div>
                  <div className="font-medium text-slate-700">{quote.currency || "VND"}</div>
                </div>
              </div>
              <div className="crm-scroll-hidden flex-1 overflow-y-auto bg-slate-100 px-4 py-4">
                <div className="mx-auto max-w-[46rem] rounded-lg bg-white p-4 shadow-sm">
                  <QuoteDocumentRenderer
                    schemaSnapshot={quote.formSnapshot}
                    quoteData={quote.data}
                    quoteItems={quote.items}
                    solutionItems={quote.data?.solutionItems}
                    totals={{
                      subtotalAmount: quote.subtotalAmount,
                      totalVatAmount: quote.vatAmount,
                      totalAmount: quote.totalAmount,
                    }}
                    mode="detail"
                    isPublished={quote.processingStage === "published"}
                    quoteNumber={quote.quoteNumber}
                    currency={quote.currency}
                    overallDiscountPercent={quote.overallDiscountPercent}
                  />
                </div>
              </div>
            </>
          )
        ) : null}
      </aside>
  );

  if (embedded) return panel;

  return (
    <>
      <div
        onClick={onClose}
        className={`fixed inset-0 z-[99985] bg-black/40 backdrop-blur-sm transition-opacity ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      {panel}
    </>
  );
}
