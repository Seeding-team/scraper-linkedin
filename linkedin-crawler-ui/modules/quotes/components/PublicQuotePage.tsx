'use client';

import { useEffect, useState } from 'react';
import { QUOTE_STATUS_LABELS } from '../constants/quoteConfig';
import { QuotePublicEmailRequiredError, seedingQuoteRepository } from '../repositories/SeedingQuoteRepository';
import type { Quote } from '../types';
import { QuoteDocumentRenderer } from './QuoteDocumentRenderer';

/** "Giới hạn xem link theo email" (migration 116) - email đã nhập đúng được
 * nhớ theo TỪNG token (mỗi báo giá 1 link riêng) qua localStorage, khỏi phải
 * nhập lại mỗi lần mở lại đúng link đó trên cùng trình duyệt. Server vẫn là
 * nguồn xác thực thật (mọi lần gọi getPublicQuote đều gửi kèm email lên lại
 * để backend tự đối chiếu, KHÔNG tin tưởng mù client). */
function emailGateStorageKey(token: string): string {
  return `quote-public-email:${token}`;
}
function readCachedEmail(token: string): string {
  try {
    return window.localStorage.getItem(emailGateStorageKey(token)) || '';
  } catch {
    return '';
  }
}
function writeCachedEmail(token: string, email: string) {
  try {
    window.localStorage.setItem(emailGateStorageKey(token), email);
  } catch {}
}

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
  // "Giới hạn xem link theo email" (migration 116) - null = gate không áp
  // dụng (link mở bình thường, hành vi cũ) hoặc chưa xác định xong; object =
  // đang cần nhập/nhập sai email, hiện form thay vì nội dung báo giá.
  const [emailGate, setEmailGate] = useState<{ invalid: boolean } | null>(null);
  const [emailInput, setEmailInput] = useState('');
  const [emailSubmitting, setEmailSubmitting] = useState(false);

  async function downloadPDF() {
    await waitForPrintReady();
    window.print();
  }

  function loadQuote(emailToTry?: string) {
    setLoading(true);
    seedingQuoteRepository
      .getPublicQuote(token, emailToTry)
      .then(row => {
        setQuote(row);
        setEmailGate(null);
        setError('');
        if (emailToTry) writeCachedEmail(token, emailToTry);
        document.title = row.quoteNumber ? `Bao-gia-${row.quoteNumber}` : 'Báo giá';
      })
      .catch(err => {
        if (err instanceof QuotePublicEmailRequiredError) {
          setEmailGate({ invalid: err.invalidEmail });
          return;
        }
        setError(err instanceof Error ? err.message : 'Không tải được báo giá.');
      })
      .finally(() => {
        setLoading(false);
        setEmailSubmitting(false);
      });
  }

  useEffect(() => {
    loadQuote(readCachedEmail(token) || undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (!quote) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('print') !== 'true') return;
    const timer = window.setTimeout(() => void downloadPDF(), 900);
    return () => window.clearTimeout(timer);
  }, [quote]);

  function submitEmailGate() {
    const trimmed = emailInput.trim();
    if (!trimmed) return;
    setEmailSubmitting(true);
    loadQuote(trimmed);
  }

  if (loading) return <main className="quote-public-page"><section className="quote-state">Đang tải báo giá...</section></main>;

  if (emailGate) {
    return (
      <main className="quote-public-page">
        <section className="quote-state quote-email-gate">
          <h2>Xác nhận email để xem báo giá</h2>
          <p>Báo giá này chỉ hiển thị cho email được chỉ định. Vui lòng nhập email của bạn để tiếp tục.</p>
          <form
            onSubmit={e => {
              e.preventDefault();
              submitEmailGate();
            }}
          >
            <input
              type="email"
              required
              autoFocus
              placeholder="ban@congty.com"
              value={emailInput}
              onChange={e => setEmailInput(e.target.value)}
              className="quote-input"
            />
            <button type="submit" className="quote-button quote-button--primary" disabled={emailSubmitting}>
              {emailSubmitting ? 'Đang kiểm tra...' : 'Xem báo giá'}
            </button>
          </form>
          {emailGate.invalid ? (
            <p className="quote-email-gate-error">Email này không có quyền xem báo giá. Vui lòng liên hệ người gửi báo giá.</p>
          ) : null}
        </section>
      </main>
    );
  }

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
