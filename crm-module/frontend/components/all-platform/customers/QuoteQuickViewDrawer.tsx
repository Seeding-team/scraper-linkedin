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
import type { Quote } from "@/modules/quotes";
import { internalQuoteStatusClass, internalQuoteStatusLabel } from "@/modules/quotes/constants/quoteConfig";

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

interface Props {
  quote: Quote | null;
  open: boolean;
  customerName?: string | null;
  dealName?: string | null;
  onClose: () => void;
  onEdit?: (quote: Quote) => void;
}

export function QuoteQuickViewDrawer({ quote, open, customerName, dealName, onClose, onEdit }: Props) {
  return (
    <>
      <div
        onClick={onClose}
        className={`fixed inset-0 z-[99985] bg-black/40 backdrop-blur-sm transition-opacity ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      <aside
        className={`fixed right-0 top-0 z-[99986] flex h-screen w-full max-w-[52rem] flex-col border-l border-slate-200 bg-white shadow-2xl transition-transform duration-300 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
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

        {quote ? (
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
                  overallDiscountPercent={quote.overallDiscountPercent}
                />
              </div>
            </div>
          </>
        ) : null}
      </aside>
    </>
  );
}
