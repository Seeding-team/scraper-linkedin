'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { internalQuoteStatusClass, internalQuoteStatusLabel } from '../constants/quoteConfig';
import { seedingQuoteRepository } from '../repositories/SeedingQuoteRepository';
import type { Quote } from '../types';
import { QuoteDocumentRenderer } from './QuoteDocumentRenderer';
import { TelegramSendButton } from './TelegramSendButton';

interface Props {
  quoteId: string;
}

export function QuoteDetailPage({ quoteId }: Props) {
  const router = useRouter();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [versions, setVersions] = useState<Quote[]>([]);
  const [creatingVersion, setCreatingVersion] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Trang này thường mở từ nút "Mở báo giá" trong Drawer chi tiết deal (CRM) -
  // giữ dealId trên URL để "Quay lại" mở đúng lại drawer deal đó, thay vì về
  // trang danh sách báo giá chung chung (mất hết ngữ cảnh đang xem deal nào).
  const dealId = useSearchParams().get('dealId');
  const backHref = dealId ? `/all-platform/crm?openDeal=${encodeURIComponent(dealId)}` : '/all-platform/quotes';

  useEffect(() => {
    seedingQuoteRepository
      .getQuote(quoteId)
      .then(setQuote)
      .catch(err => setError(err instanceof Error ? err.message : 'Không tải được chi tiết báo giá.'))
      .finally(() => setLoading(false));
  }, [quoteId]);

  useEffect(() => {
    if (!quote) return;
    seedingQuoteRepository.getQuoteVersions(quote.id).then(setVersions).catch(() => undefined);
  }, [quote?.id]);

  async function createVersion() {
    if (!quote) return;
    setCreatingVersion(true);
    try {
      const result = await seedingQuoteRepository.createQuoteVersion(quote.id);
      if (result.redirectedFromClickedQuote) {
        window.alert(`Chuỗi báo giá đã có bản duyệt mới hơn (V${result.sourceVersionNumber}) — đã tạo phiên bản mới từ bản đó.`);
      } else if (!result.created) {
        window.alert('Chuỗi này đã có bản nháp sẵn — mở bản nháp đó.');
      }
      // Trang này chỉ xem/in báo giá, không có form sửa — mở phiên bản mới
      // (đang ở trạng thái nháp) qua Drawer deal CRM (đã có sẵn wizard mở
      // đúng Bước 3 cho editQuote), hoặc Trung tâm báo giá nếu chưa gắn deal.
      const newDealId = result.quote.dealId;
      router.push(newDealId ? `/all-platform/crm?openDeal=${encodeURIComponent(newDealId)}` : '/all-platform/quote-center');
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không tạo được phiên bản báo giá mới.');
    } finally {
      setCreatingVersion(false);
    }
  }

  async function copyLink() {
    if (!quote?.publicUrl) return;
    await navigator.clipboard.writeText(`${window.location.origin}${quote.publicUrl}`);
  }

  function downloadPDF() {
    if (quote?.publicUrl) {
      window.open(`${quote.publicUrl}?print=true`, '_blank', 'noopener');
      return;
    }
    window.print();
  }

  if (loading) return <main className="quote-page"><section className="quote-state">Đang tải...</section></main>;
  if (error || !quote) return <main className="quote-page"><section className="quote-state quote-state--error">{error || 'Không tìm thấy báo giá.'}</section></main>;

  return (
    <main className="quote-detail-page">
      <Link href={backHref} className="quote-back quote-back--breadcrumb no-print">← Quay lại</Link>
      <header className="quote-detail-header no-print">
        <div>
          <h1>{String(quote.data.quoteTitle || 'Chi tiết báo giá')}</h1>
          <p>
            {quote.quoteNumber}
            <span className={`quote-badge ${internalQuoteStatusClass(quote.status)}`}>{internalQuoteStatusLabel(quote.status)}</span>
            · {new Date(quote.createdAt).toLocaleString('vi-VN')}
          </p>
        </div>
        <div className="quote-head-actions">
          {quote.status === 'approved' || quote.status === 'confirmed' ? (
            <>
              <button type="button" className="quote-button quote-button--secondary" onClick={() => void copyLink()}>Copy Link</button>
              <button type="button" className="quote-button quote-button--primary" onClick={downloadPDF}>Tải PDF</button>
            </>
          ) : (
            <span className="quote-badge status-draft">Chưa có link công khai gửi khách</span>
          )}
          {quote.status === 'approved' ? (
            <button type="button" className="quote-button quote-button--secondary" disabled={creatingVersion} onClick={() => void createVersion()}>
              {creatingVersion ? 'Đang tạo...' : '+ Tạo phiên bản mới'}
            </button>
          ) : null}
          <TelegramSendButton quoteId={quote.id} status={quote.status} />
        </div>
      </header>
      {versions.length > 1 ? (
        <section className="quote-version-history no-print">
          <h2>Lịch sử phiên bản</h2>
          <ul>
            {versions.map(version => (
              <li key={version.id} className={version.id === quote.id ? 'quote-version-history__item--current' : undefined}>
                <span className="quote-badge quote-badge--version">V{version.versionNumber || 1}</span>
                {version.id === quote.id ? (
                  <b>{version.quoteNumber}</b>
                ) : (
                  <Link href={`/all-platform/quotes/${version.id}${dealId ? `?dealId=${encodeURIComponent(dealId)}` : ''}`}>
                    {version.quoteNumber}
                  </Link>
                )}
                <span className={`quote-badge ${internalQuoteStatusClass(version.status)}`}>{internalQuoteStatusLabel(version.status)}</span>
                <span className="quote-version-history__date">{new Date(version.createdAt).toLocaleDateString('vi-VN')}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <div className="quote-print-root">
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
          mode="detail"
        />
      </div>
    </main>
  );
}
