'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { FORM_STATUS_LABELS } from '../constants/quoteConfig';
import { seedingQuoteRepository } from '../repositories/SeedingQuoteRepository';
import type { IssuerCompany, QuoteForm } from '../types';
import { ActionMenu } from '../../crm/components/ActionMenu';

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date).replace(',', ' ·');
}

export function QuoteHomePage() {
  const [forms, setForms] = useState<QuoteForm[]>([]);
  const [companies, setCompanies] = useState<IssuerCompany[]>([]);
  const [companyFilter, setCompanyFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [formRows, companyRows] = await Promise.all([
        seedingQuoteRepository.getForms(),
        seedingQuoteRepository.getIssuerCompanies(true),
      ]);
      setForms(formRows);
      setCompanies(companyRows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không tải được dữ liệu báo giá.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const companyById = useMemo(() => new Map(companies.map(c => [c.id, c])), [companies]);
  const visibleForms = companyFilter ? forms.filter(f => f.issuerCompanyId === companyFilter) : forms;

  async function copyFormLink(form: QuoteForm) {
    const updated = await seedingQuoteRepository.shareForm(form.id, true);
    setForms(rows => rows.map(row => (row.id === updated.id ? updated : row)));
    await navigator.clipboard.writeText(`${window.location.origin}${updated.shareUrl}`);
  }

  async function toggleFormShare(form: QuoteForm) {
    const updated = await seedingQuoteRepository.shareForm(form.id, !form.shareEnabled);
    setForms(rows => rows.map(row => (row.id === updated.id ? updated : row)));
  }

  async function duplicateForm(form: QuoteForm) {
    await seedingQuoteRepository.duplicateForm(form.id);
    await load();
  }

  async function deleteForm(form: QuoteForm) {
    if (!window.confirm('Xóa mẫu báo giá này? Nếu đã có báo giá, mẫu sẽ được lưu trữ.')) return;
    await seedingQuoteRepository.deleteForm(form.id);
    await load();
  }

  return (
    <main className="quote-page">
      <header className="quote-head">
        <div>
          <p>Quản lý form, preview, public link, quote detail và renderer độc lập.</p>
        </div>
        <div className="quote-head-actions">
          <select className="quote-input" value={companyFilter} onChange={event => setCompanyFilter(event.target.value)}>
            <option value="">Tất cả công ty</option>
            {companies.map(company => (
              <option key={company.id} value={company.id}>
                {company.brandName || company.legalName}
              </option>
            ))}
          </select>
          <button type="button" className="quote-button quote-button--secondary" onClick={() => void load()}>
            Làm mới
          </button>
          <Link href="/all-platform/quotes/new" className="quote-button quote-button--primary">
            Tạo form mới
          </Link>
        </div>
      </header>

      {loading ? <section className="quote-state">Đang tải danh sách mẫu báo giá...</section> : null}
      {error ? <section className="quote-state quote-state--error">{error}</section> : null}

      {!loading && !error ? (
        <section className="quote-grid">
          {visibleForms.length === 0 ? (
            <div className="quote-state">Chưa có mẫu báo giá nào.</div>
          ) : (
            visibleForms.map(form => {
              const companyLabel = form.issuerCompanyId
                ? (companyById.get(form.issuerCompanyId)?.brandName) || companyById.get(form.issuerCompanyId)?.legalName || 'Công ty'
                : 'Trung tính (mọi công ty)';
              return (
                <article key={form.id} className="quote-card">
                  {/* Vung 1: tieu de - toi da 2 dong, khong ellipsis 1 dong nua de
                   * khong bi cat ten mau dai. */}
                  <h2 className="quote-card__title" title={form.name}>{form.name}</h2>
                  {/* Vung 2: badge trang thai + don vi phat hanh - wrap tu nhien,
                   * khong bao gio bi cat/de. */}
                  <div className="quote-card__badges">
                    <span className={`quote-badge ${form.status === 'active' ? 'quote-badge--active' : ''}`}>
                      {FORM_STATUS_LABELS[form.status]}
                    </span>
                    <span className={`quote-badge ${form.issuerCompanyId ? 'quote-badge--company' : ''}`} title={companyLabel}>
                      {companyLabel}
                    </span>
                  </div>
                  <p className="quote-card__desc">{form.description}</p>
                  {/* Vung 3: footer - ngay cap nhat ben trai, cum thao tac ben
                   * phai, CUNG mot hang trong normal flow (khong absolute, khong
                   * de len vung 1/2 o tren). Bo dong "Cau truc: X nhom Y truong" -
                   * thong tin ky thuat khong giup chon mau, chi gay chat card. */}
                  <div className="quote-card__footer">
                    <span className="quote-card__updated">Cập nhật {formatDate(form.updatedAt)}</span>
                    <div className="quote-actions">
                      <Link href={`/all-platform/quotes/${form.id}/edit`} className="quote-button quote-button--secondary" title="Chỉnh sửa">Chỉnh sửa</Link>
                      <Link href={`/all-platform/quotes/${form.id}/preview`} className="quote-button quote-button--secondary" title="Xem thử">Xem thử</Link>
                      <ActionMenu
                        items={[
                          { key: 'copy-link', label: 'Copy link', onSelect: () => void copyFormLink(form) },
                          {
                            key: 'toggle-share',
                            label: form.shareEnabled ? 'Tắt public' : 'Bật public',
                            onSelect: () => void toggleFormShare(form),
                          },
                          { key: 'duplicate', label: 'Nhân bản', onSelect: () => void duplicateForm(form) },
                          { key: 'delete', label: 'Xóa', danger: true, onSelect: () => void deleteForm(form) },
                        ]}
                      />
                    </div>
                  </div>
                </article>
              );
            })
          )}
        </section>
      ) : null}
    </main>
  );
}
