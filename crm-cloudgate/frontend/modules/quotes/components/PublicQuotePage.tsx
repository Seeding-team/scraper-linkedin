'use client';

import { useEffect, useState } from 'react';
import { QUOTE_STATUS_LABELS } from '../constants/quoteConfig';
import { QuotePublicVerificationRequiredError, seedingQuoteRepository } from '../repositories/SeedingQuoteRepository';
import type { Quote } from '../types';
import { QuoteDocumentRenderer } from './QuoteDocumentRenderer';

/** "Giới hạn xem link báo giá bằng Email hoặc Số điện thoại" (migration 118) -
 * giá trị xác minh đúng được nhớ theo TỪNG token + method (mỗi báo giá 1 link
 * riêng, và đổi method thì không dùng nhầm cache của method cũ) qua
 * localStorage, khỏi phải nhập lại mỗi lần mở lại đúng link đó trên cùng
 * trình duyệt. Server vẫn là nguồn xác thực thật (mọi lần gọi getPublicQuote
 * đều gửi kèm giá trị lên lại để backend tự đối chiếu, KHÔNG tin tưởng mù
 * client). BUG THAT DA GAP (da fix): khi doi tu Email sang SDT (hoac tat gioi
 * han), key cache PHAI phan biet theo method - khong con dung 1 key chung
 * chung khien gia tri cu cua method truoc con "sot lai". */
function verificationStorageKey(token: string, method: 'email' | 'phone'): string {
  return `quote-public-verify:${method}:${token}`;
}
function readCachedVerification(token: string, method: 'email' | 'phone'): string {
  try {
    return window.localStorage.getItem(verificationStorageKey(token, method)) || '';
  } catch {
    return '';
  }
}
function writeCachedVerification(token: string, method: 'email' | 'phone', value: string) {
  try {
    window.localStorage.setItem(verificationStorageKey(token, method), value);
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
  // "Giới hạn xem link báo giá bằng Email hoặc Số điện thoại" (migration 118)
  // - null = gate không áp dụng (link mở bình thường, tắt giới hạn hoặc chưa
  // xác định xong) hoặc gate đã qua; object = đang cần nhập/nhập sai theo
  // ĐÚNG method backend báo về, hiện form tương ứng (email HOẶC phone, không
  // bao giờ cả 2 cùng lúc).
  const [verifyGate, setVerifyGate] = useState<{ method: 'email' | 'phone'; invalid: boolean } | null>(null);
  const [verifyInput, setVerifyInput] = useState('');
  const [verifySubmitting, setVerifySubmitting] = useState(false);
  const [autoRetried, setAutoRetried] = useState(false);

  async function downloadPDF() {
    await waitForPrintReady();
    window.print();
  }

  // KHONG con doan "doc cache truoc, gui len ngay" nhu ban cu (chi ho tro
  // email) - vi luc dau trang KHONG biet quote dang bat che do nao (co the
  // da chuyen tu email sang phone, hoac tat han) nen KHONG the doan dung
  // tham so nao de gui truoc. Luon goi KHONG kem tham so truoc; neu backend
  // tra ve "can xac minh theo method X" thi moi thu lai 1 LAN DUY NHAT bang
  // gia tri da cache DUNG cho method X (khong bao gio dung nham cache cua
  // method khac) - dung y het nguyen tac "API public phai doc cau hinh moi
  // nhat, khong dua vao trang thai cache cu tren client".
  function loadQuote(explicit?: { method: 'email' | 'phone'; value: string }) {
    setLoading(true);
    const emailArg = explicit?.method === 'email' ? explicit.value : undefined;
    const phoneArg = explicit?.method === 'phone' ? explicit.value : undefined;
    seedingQuoteRepository
      .getPublicQuote(token, emailArg, phoneArg)
      .then(row => {
        setQuote(row);
        setVerifyGate(null);
        setError('');
        if (explicit) writeCachedVerification(token, explicit.method, explicit.value);
        document.title = row.quoteNumber ? `Bao-gia-${row.quoteNumber}` : 'Báo giá';
      })
      .catch(err => {
        if (err instanceof QuotePublicVerificationRequiredError) {
          if (!explicit && !autoRetried) {
            const cached = readCachedVerification(token, err.method);
            if (cached) {
              setAutoRetried(true);
              loadQuote({ method: err.method, value: cached });
              return;
            }
          }
          setVerifyGate({ method: err.method, invalid: err.invalid });
          return;
        }
        setError(err instanceof Error ? err.message : 'Không tải được báo giá.');
      })
      .finally(() => {
        setLoading(false);
        setVerifySubmitting(false);
      });
  }

  useEffect(() => {
    loadQuote();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (!quote) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('print') !== 'true') return;
    const timer = window.setTimeout(() => void downloadPDF(), 900);
    return () => window.clearTimeout(timer);
  }, [quote]);

  function submitVerifyGate() {
    if (!verifyGate) return;
    const trimmed = verifyInput.trim();
    if (!trimmed) return;
    setVerifySubmitting(true);
    loadQuote({ method: verifyGate.method, value: trimmed });
  }

  if (loading) return <main className="quote-public-page"><section className="quote-state">Đang tải báo giá...</section></main>;

  if (verifyGate) {
    const isEmail = verifyGate.method === 'email';
    return (
      <main className="quote-public-page">
        <section className="quote-state quote-email-gate">
          <h2>{isEmail ? 'Xác nhận email để xem báo giá' : 'Xác nhận số điện thoại để xem báo giá'}</h2>
          <p>
            {isEmail
              ? 'Báo giá này chỉ hiển thị cho email được chỉ định. Vui lòng nhập email của bạn để tiếp tục.'
              : 'Báo giá này chỉ hiển thị cho số điện thoại được chỉ định. Vui lòng nhập số điện thoại của bạn để tiếp tục.'}
          </p>
          <form
            onSubmit={e => {
              e.preventDefault();
              submitVerifyGate();
            }}
          >
            <input
              type={isEmail ? 'email' : 'tel'}
              required
              autoFocus
              placeholder={isEmail ? 'ban@congty.com' : '0901234567'}
              value={verifyInput}
              onChange={e => setVerifyInput(e.target.value)}
              className="quote-input"
            />
            <button type="submit" className="quote-button quote-button--primary" disabled={verifySubmitting}>
              {verifySubmitting ? 'Đang kiểm tra...' : 'Xem báo giá'}
            </button>
          </form>
          {verifyGate.invalid ? (
            <p className="quote-email-gate-error">
              {isEmail ? 'Email này' : 'Số điện thoại này'} không có quyền xem báo giá. Vui lòng liên hệ người gửi báo giá.
            </p>
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
