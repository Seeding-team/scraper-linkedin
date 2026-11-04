'use client';

import { useEffect, useState } from 'react';
import { seedingQuoteRepository } from '@/modules/quotes';
import type { QuoteForm } from '@/modules/quotes';

export function SelectQuoteFormStep({
  selectedFormId,
  previewForm,
  onPreview,
  onSelect,
  onSkip,
  skipping,
  hideSkip,
}: {
  selectedFormId?: string;
  previewForm?: QuoteForm | null;
  onPreview: (form: QuoteForm) => void;
  onSelect: (form: QuoteForm) => void;
  onSkip?: () => void;
  skipping?: boolean;
  hideSkip?: boolean;
}) {
  const [forms, setForms] = useState<QuoteForm[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    seedingQuoteRepository
      .getForms()
      .then(rows => {
        if (!cancelled) setForms(rows.filter(form => form.status === 'active'));
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Không tải được danh sách mẫu báo giá.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="crm-wizard-form-section">
      <div className="crm-wizard-section-head">
        <div>
          <h3 className="crm-wizard-form-title">Chọn mẫu báo giá</h3>
          <p className="crm-wizard-form-description">Hãy chọn một mẫu thiết kế báo giá để áp dụng.</p>
        </div>
        {hideSkip ? null : (
          <button type="button" className="crm-secondary-inline" disabled={skipping} onClick={onSkip}>
            Bỏ qua báo giá và chỉ tạo deal
          </button>
        )}
      </div>

      {error ? <p className="crm-error">{error}</p> : null}
      {!loading && !error && forms.length === 0 ? (
        <div className="crm-wizard-empty-state">Chưa có mẫu báo giá active.</div>
      ) : (
        <div className="crm-wizard-form-card-grid">
          {forms.map(form => (
            <article
              key={form.id}
              className={`crm-wizard-form-card ${selectedFormId === form.id ? 'crm-wizard-form-card--selected' : ''}`}
            >
              <h4>{form.name}</h4>
              <p>{form.description || 'Không có mô tả.'}</p>
              <dl>
                <div>
                  <dt>Cập nhật</dt>
                  <dd>{new Date(form.updatedAt).toLocaleDateString('vi-VN')}</dd>
                </div>
                <div>
                  <dt>Nhóm</dt>
                  <dd>{form.sectionCount || 0}</dd>
                </div>
              </dl>
              <div className="crm-wizard-form-card-actions">
                <button type="button" className="crm-cancel-button" onClick={() => onPreview(form)}>
                  Xem trước
                </button>
                <button type="button" className="crm-save-button" disabled={loading} onClick={() => onSelect(form)}>
                  Chọn mẫu
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {previewForm ? (
        <div className="crm-wizard-template-preview">
          <h4>Xem trước mẫu</h4>
          <div className="crm-wizard-template-preview-grid">
            {(previewForm.schemaJson?.sections || []).map(section => (
              <span key={section.key}>
                {section.title}
                <b>{(section.fields || []).length} trường</b>
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
