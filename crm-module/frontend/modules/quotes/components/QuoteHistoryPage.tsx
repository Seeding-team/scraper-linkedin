'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { seedingQuoteRepository } from '../repositories/SeedingQuoteRepository';
import { internalQuoteStatusClass, internalQuoteStatusLabel } from '../constants/quoteConfig';
import { formatVnd } from '../utils/quoteCalculations';
import { buildPublicQuoteUrl } from '../utils/publicQuoteUrl';
import type { Quote } from '../types';
import { ActionMenu } from '../../crm/components/ActionMenu';

function formatDate(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
}

/** Tên khách hàng / bên phát hành đọc từ snapshot `data` của báo giá (không
 * live-join lại bảng khác) — `customerCompanyName`/`sellerCompanyName` là
 * field dùng chung (fieldLibrary) nên có mặt ở hầu hết mẫu báo giá, kể cả VPS. */
function quoteCustomerName(quote: Quote): string {
  const data = quote.data || {};
  return String(data.customerCompanyName || data.customerContactName || '—');
}

function quoteIssuerName(quote: Quote): string {
  const data = quote.data || {};
  return String(data.sellerCompanyName || data.sellerBrandName || '—');
}

export function QuoteHistoryPage() {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [allQuotes, forms] = await Promise.all([
        seedingQuoteRepository.getQuotes(),
        seedingQuoteRepository.getForms(),
      ]);
      // Trang này chỉ dùng cho luồng VPS (bảng Tb_in) - lọc theo mẫu báo giá có
      // tên chứa "VPS", không hiện báo giá của các mẫu khác (Douyin, Villa...).
      const vpsFormIds = new Set(
        forms.filter(form => form.name.toLowerCase().includes('vps')).map(form => form.id)
      );
      setQuotes(allQuotes.filter(quote => vpsFormIds.has(quote.quoteFormId)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không tải được lịch sử báo giá.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function copyLink(quote: Quote) {
    const link = buildPublicQuoteUrl(quote.publicUrl) || `${window.location.origin}/all-platform/quotes/${quote.id}`;
    await navigator.clipboard.writeText(link);
  }

  return (
    <main className="quote-page">
      <header className="quote-head">
        <div>
          <p>Báo giá VPS đã tạo cho khách hàng, kèm ngày báo giá và link báo giá.</p>
        </div>
        <div className="quote-head-actions">
          <button type="button" className="quote-button quote-button--secondary" onClick={() => void load()}>
            Làm mới
          </button>
        </div>
      </header>

      {loading ? <section className="quote-state">Đang tải lịch sử báo giá...</section> : null}
      {error ? <section className="quote-state quote-state--error">{error}</section> : null}

      {!loading && !error ? (
        <div className="quote-table-wrap">
          <table className="quote-table quote-history-table">
            <thead>
              <tr>
                <th className="qh-col-number">Số báo giá</th>
                <th className="qh-col-customer">Khách hàng</th>
                <th className="qh-col-issuer">Đơn vị phát hành</th>
                <th className="qh-col-amount">Tổng tiền</th>
                <th className="qh-col-date">Ngày tạo</th>
                <th className="qh-col-status">Trạng thái</th>
                <th className="qh-col-actions">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {quotes.length === 0 ? (
                <tr>
                  <td colSpan={7} className="empty-row">Chưa có báo giá nào.</td>
                </tr>
              ) : (
                quotes.map(quote => {
                  const issuerName = quoteIssuerName(quote);
                  const customerName = quoteCustomerName(quote);
                  return (
                    <tr key={quote.id}>
                      <td className="qh-col-number" data-label="Số báo giá" title={quote.quoteNumber}>{quote.quoteNumber}</td>
                      <td className="qh-col-customer" data-label="Khách hàng" title={customerName}>{customerName}</td>
                      <td className="qh-col-issuer" data-label="Đơn vị phát hành" title={issuerName}>{issuerName}</td>
                      <td className="qh-col-amount money-cell" data-label="Tổng tiền">{formatVnd(quote.totalAmount)}</td>
                      <td className="qh-col-date" data-label="Ngày tạo">{formatDate(quote.issuedAt || quote.createdAt)}</td>
                      <td className="qh-col-status" data-label="Trạng thái">
                        <span className={`quote-badge ${internalQuoteStatusClass(quote.status)}`}>
                          {internalQuoteStatusLabel(quote.status)}
                        </span>
                      </td>
                      <td className="qh-col-actions" data-label="">
                        <div className="quote-history-link-cell">
                          <Link href={`/all-platform/quotes/${quote.id}`} className="quote-button quote-button--secondary">
                            Mở
                          </Link>
                          <ActionMenu
                            items={[
                              { key: 'copy-link', label: 'Copy link', onSelect: () => void copyLink(quote) },
                            ]}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      ) : null}
    </main>
  );
}
