'use client';

import { useEffect, useState } from 'react';
import { QUOTE_STATUS_LABELS } from '../constants/quoteConfig';
import { seedingQuoteRepository } from '../repositories/SeedingQuoteRepository';
import type { Quote } from '../types';
import { QuoteDocumentRenderer } from './QuoteDocumentRenderer';

interface Props {
  token: string;
}

async function waitForPrintReady() {
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  if (document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {}
  }
  const pendingImages = Array.from(document.images || []).filter(image => !image.complete);
  if (pendingImages.length) {
    await Promise.allSettled(
      pendingImages.map(
        image =>
          new Promise(resolve => {
            image.addEventListener('load', resolve, { once: true });
            image.addEventListener('error', resolve, { once: true });
          })
      )
    );
  }
  await new Promise(resolve => window.setTimeout(resolve, 300));
}

export function PublicQuotePage({ token }: Props) {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function downloadPDF() {
    await waitForPrintReady();
    window.print();
  }

  useEffect(() => {
    seedingQuoteRepository
      .getPublicQuote(token)
      .then(row => {
        setQuote(row);
        document.title = row.quoteNumber ? `Bao-gia-${row.quoteNumber}` : 'Báo giá';
      })
      .catch(err => setError(err instanceof Error ? err.message : 'Không tải được báo giá.'))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    if (!quote) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('print') !== 'true') return;
    const timer = window.setTimeout(() => void downloadPDF(), 900);
    return () => window.clearTimeout(timer);
  }, [quote]);

  if (loading) return <main className="quote-public-page"><section className="quote-state">Đang tải báo giá...</section></main>;
  if (error || !quote) return <main className="quote-public-page"><section className="quote-state quote-state--error">{error || 'Không thể truy cập báo giá.'}</section></main>;

  return (
    <main className="quote-public-page">
      <header className="quote-public-toolbar no-print">
        <h1>Báo giá Khách hàng</h1>
        <div className="quote-head-actions">
          <span className={`quote-badge status-${quote.status}`}>{QUOTE_STATUS_LABELS[quote.status]}</span>
          <button type="button" className="quote-button quote-button--primary" onClick={() => void downloadPDF()}>Tải PDF</button>
        </div>
      </header>
      {/* Trinh duyet tu them URL/ngay gio/tieu de vao dau-cuoi moi trang in
          qua tuy chon rieng cua no ("Headers and footers") - CSS khong the
          tat tuy chon nay tu trang, chi co the goi y nguoi dung tu tat. */}
      <p className="quote-print-hint no-print">
        Mẹo: trong hộp thoại in, bấm "Xem thêm cài đặt" và tắt "Tiêu đề và chân trang"
        (Headers and footers) để bản PDF không hiện URL/ngày giờ của trình duyệt.
      </p>
      <div className="quote-document-wrapper">
        <QuoteDocumentRenderer
          schemaSnapshot={quote.formSnapshot}
          quoteData={quote.data}
          quoteItems={quote.items}
          solutionItems={quote.data.solutionItems}
          totals={{
            subtotalAmount: quote.subtotalAmount,
            totalVatAmount: quote.vatAmount,
            totalAmount: quote.totalAmount,
          }}
          mode="public"
          isPublished={quote.processingStage ? quote.processingStage === 'published' : true}
          quoteNumber={quote.quoteNumber}
        />
      </div>
    </main>
  );
}
