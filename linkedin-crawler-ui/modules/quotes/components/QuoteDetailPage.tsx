'use client';

import { Columns3, Printer, RectangleHorizontal, RectangleVertical, RotateCcw } from 'lucide-react';
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
  // "chỉnh xoay ngang, xoay dọc, căn chỉnh cột ở đây luôn" - toolbar LUON hien
  // san ngay tren trang (khong con modal "Xem trước khi in" rieng), dieu
  // khien TRUC TIEP renderer duy nhat ben duoi (xem PublicQuotePage.tsx -
  // dung y het co che).
  const [printOrientation, setPrintOrientation] = useState<'portrait' | 'landscape'>('portrait');
  const [printResetKey, setPrintResetKey] = useState(0);
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

  function openPublicLink() {
    if (!quote?.publicUrl) return;
    window.open(quote.publicUrl, '_blank', 'noopener');
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
              <button type="button" className="quote-button quote-button--secondary" onClick={openPublicLink}>Mở bản khách hàng</button>
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
      {/* "chỉnh xoay ngang, xoay dọc, căn chỉnh cột ở đây luôn" - toolbar LUON
       * hien san (xem giai thich day du trong PublicQuotePage.tsx). */}
      <div className="quote-print-preview-toolbar quote-print-preview-toolbar--inline no-print">
        <div className="quote-print-preview-orientation-group" role="group" aria-label="Hướng giấy">
          <button
            type="button"
            className={`quote-print-preview-btn${printOrientation === 'portrait' ? ' is-active' : ''}`}
            onClick={() => setPrintOrientation('portrait')}
          >
            <RectangleVertical className="quote-print-preview-icon" /> Dọc
          </button>
          <button
            type="button"
            className={`quote-print-preview-btn${printOrientation === 'landscape' ? ' is-active' : ''}`}
            onClick={() => setPrintOrientation('landscape')}
          >
            <RectangleHorizontal className="quote-print-preview-icon" /> Ngang
          </button>
        </div>
        <button
          type="button"
          className="quote-print-preview-btn"
          title="Kéo viền phải mỗi cột trong bảng để chỉnh độ rộng, sau đó bấm In"
          onClick={() => setPrintResetKey(key => key + 1)}
        >
          <RotateCcw className="quote-print-preview-icon" /> Đặt lại độ rộng cột
        </button>
        <button type="button" className="quote-print-preview-btn quote-print-preview-btn--primary" onClick={() => window.print()}>
          <Printer className="quote-print-preview-icon" /> In / Tải PDF
        </button>
      </div>
      <p className="quote-print-preview-hint no-print">
        <Columns3 className="quote-print-preview-icon" /> Rê chuột tới viền phải tiêu đề cột rồi kéo để chỉnh độ rộng — độ rộng này sẽ
        được giữ nguyên khi in/tải PDF (căn như nào thì in ra như thế).
      </p>
      {quote.status === 'approved' || quote.status === 'confirmed' ? (
        <p className="quote-print-hint no-print">
          Mẹo: trong hộp thoại in, bấm "Xem thêm cài đặt" và tắt "Tiêu đề và chân trang"
          (Headers and footers) để bản PDF không hiện URL/ngày giờ của trình duyệt.
        </p>
      ) : null}
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
          key={printResetKey}
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
          isPublished={quote.processingStage === 'published'}
          quoteNumber={quote.quoteNumber}
          overallDiscountPercent={quote.overallDiscountPercent}
          printPreviewMode
          printOrientation={printOrientation}
          contactPersonName={quote.quoteOwnerName}
        />
      </div>
    </main>
  );
}
