'use client';

/** "Kết quả báo giá" - KẾT QUẢ CỦA KHÁCH sau khi báo giá đã phát hành/gửi (KHÔNG phải bước 4 của workflow Presale → Sale → Duyệt).
 * Mặc định "Đang chờ phản hồi khách"; action "Không chốt" mở modal xác nhận (bắt buộc lý do, ghi chú tuỳ chọn).
 * Danh sách lý do lấy từ backend (GET /quotes/lost-reasons), không hard-code ở frontend. */

import { useEffect, useState } from 'react';
import { seedingQuoteRepository } from '@/modules/quotes';
import type { Quote } from '@/modules/quotes';

function fmt(value?: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function QuoteOutcomeSection({ quote, onUpdated }: { quote: Quote; onUpdated: (quote: Quote, dealMessage?: string) => void }) {
  // Da phat hanh/gui khach - chi dua tren published_at/sent_at/processing_stage (khong phu thuoc cot moi, quote cu van hien)
  const published = Boolean(quote.publishedAt || quote.sentAt || quote.processingStage === 'published');
  const [open, setOpen] = useState(false);
  const [reasons, setReasons] = useState<Array<{ code: string; label: string }>>([]);
  const [reason, setReason] = useState('');
  const [other, setOther] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!open || reasons.length) return;
    seedingQuoteRepository.getLostReasons().then(setReasons).catch(() => setError('Không tải được danh sách lý do.'));
  }, [open, reasons.length]);

  if (!published || quote.status === 'cancelled') return null;
  const lost = quote.customerOutcome === 'lost';
  const canSubmit = Boolean(reason) && (reason !== 'other' || other.trim().length > 0) && !busy;

  async function submit() {
    setBusy(true);
    setError('');
    try {
      const res = await seedingQuoteRepository.markQuoteLost(quote.id, { reason, reasonOther: reason === 'other' ? other.trim() : undefined, note: note.trim() || undefined });
      setOpen(false);
      setReason('');
      setOther('');
      setNote('');
      setNotice(res.dealOut?.message || '');
      onUpdated(res.quote, res.dealOut?.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không cập nhật được kết quả báo giá.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="qc-workspace-card qc-outcome-card"
      data-testid="quote-outcome-section"
      style={lost
        ? { background: '#fef2f2', border: '1px solid #fca5a5', borderLeft: '4px solid #dc2626' }
        : { background: '#eff6ff', border: '1px solid #93c5fd', borderLeft: '4px solid #2563eb' }}
    >
      <div className="qc-workspace-card-head">
        <h3>Kết quả báo giá</h3>
        {lost
          ? <span className="qc-badge qc-badge-danger" style={{ background: '#dc2626', color: '#fff', fontWeight: 700 }}>OUT — Không chốt</span>
          : <span className="qc-badge" style={{ background: '#dbeafe', color: '#1d4ed8', border: '1px solid #93c5fd', fontWeight: 700 }}>⏳ Đang chờ phản hồi khách</span>}
      </div>
      {lost ? (
        <div className="qc-summary-grid">
          <div><span className="qc-workspace-info-label">Lý do</span><strong>{quote.lostReasonLabel || quote.lostReason || '—'}{quote.lostReason === 'other' && quote.lostReasonOther ? `: ${quote.lostReasonOther}` : ''}</strong></div>
          <div><span className="qc-workspace-info-label">Ghi chú</span><strong>{quote.lostNote || '—'}</strong></div>
          <div><span className="qc-workspace-info-label">Người ghi nhận</span><strong>{quote.lostByName || '—'}</strong></div>
          <div><span className="qc-workspace-info-label">Thời gian</span><strong>{fmt(quote.lostAt)}</strong></div>
        </div>
      ) : (
        <div className="qc-outcome-actions" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span className="qc-row-sub">Khách chưa phản hồi. Nếu khách không chốt, ghi nhận kết quả tại đây.</span>
          <button
            type="button"
            className="qc-btn"
            data-testid="quote-mark-lost"
            style={{ background: '#dc2626', borderColor: '#dc2626', color: '#fff', fontWeight: 700 }}
            onClick={() => { setError(''); setOpen(true); }}
          >
            ✕ Không chốt
          </button>
        </div>
      )}
      {notice ? <p className="qc-workspace-note">{notice}</p> : null}

      {open ? (
        <div className="crm-modal-backdrop" style={{ zIndex: 100400 }} onClick={event => { if (event.target === event.currentTarget && !busy) setOpen(false); }}>
          <div className="crm-modal" role="dialog" aria-modal="true" aria-label="Xác nhận Không chốt" style={{ padding: 20, width: 'min(32rem, 94vw)' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Xác nhận Không chốt (OUT)</h3>
            <p className="qc-row-sub">Báo giá {quote.quoteNumber} · V{quote.versionNumber}. Cơ hội chỉ chuyển OUT khi không còn báo giá/nhánh bán hàng nào đang hoạt động.</p>
            <fieldset style={{ border: 0, padding: 0, margin: '12px 0' }}>
              <legend className="qc-workspace-info-label">Lý do <span className="qc-required-mark">*</span></legend>
              {reasons.map(r => (
                <label key={r.code} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                  <input type="radio" name="lost-reason" checked={reason === r.code} onChange={() => setReason(r.code)} />
                  <span>{r.label}</span>
                </label>
              ))}
              {reason === 'other' ? (
                <input className="qc-cell-input" style={{ width: '100%', marginTop: 6 }} placeholder="Nhập lý do cụ thể (bắt buộc)" value={other} onChange={e => setOther(e.target.value)} autoFocus />
              ) : null}
            </fieldset>
            <label>
              <span className="qc-workspace-info-label">Ghi chú (tuỳ chọn)</span>
              <textarea className="qc-workspace-handoff-note" rows={3} value={note} onChange={e => setNote(e.target.value)} />
            </label>
            {error ? <p className="crm-error">{error}</p> : null}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
              <button type="button" className="qc-btn" disabled={busy} onClick={() => setOpen(false)}>Huỷ</button>
              <button type="button" className="qc-btn qc-btn-primary" data-testid="quote-mark-lost-confirm" style={canSubmit ? { background: '#dc2626', borderColor: '#dc2626', color: '#fff' } : undefined} disabled={!canSubmit} onClick={() => void submit()}>{busy ? 'Đang lưu…' : 'Xác nhận Không chốt'}</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
