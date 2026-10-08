'use client';

/** GD3 - Phan "Phu trach & ban giao" trong Xac minh Lead: nguoi xu ly, link Doc/Sheet hang muc bao gia, gui email, dieu kien con thieu.
 * Chi la UI trinh bay + thu thap du lieu; moi quyet dinh (CTA, validate) nam o LeadDetailDrawer, moi quyen/email o backend. */

import type { ReactNode } from 'react';

export type HandoverMode = 'self' | 'handover' | 'reassign' | 'verify_assign';

const MODE_BADGE: Record<HandoverMode, { text: string; tone: string }> = {
  self: { text: 'Tự xử lý', tone: 'is-self' },
  handover: { text: 'Bàn giao xử lý', tone: 'is-handover' },
  reassign: { text: 'Re-assign', tone: 'is-reassign' },
  verify_assign: { text: 'Xác minh đạt chuẩn · giao người nhận', tone: 'is-verify' },
};

/** Tach link tu o nhap nhieu dong -> {hop le, khong hop le}. */
export function parseDocLinks(text: string): { valid: string[]; invalid: string[] } {
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const part of text.split(/[\s,]+/).map(p => p.trim()).filter(Boolean)) {
    try {
      const url = new URL(part);
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        if (!valid.includes(part)) valid.push(part);
        continue;
      }
    } catch { /* khong phai URL */ }
    invalid.push(part);
  }
  return { valid, invalid };
}

export function LeadHandoverSection({
  mode,
  recipientName,
  actorName,
  teamName,
  docLinksText,
  onDocLinksChange,
  sendEmail,
  onSendEmailChange,
  missing,
  readOnly,
  history,
  onResend,
  converted = false,
  children,
}: {
  mode: HandoverMode;
  recipientName: string | null;
  actorName: string;
  teamName?: string | null;
  docLinksText: string;
  onDocLinksChange: (value: string) => void;
  sendEmail: boolean;
  onSendEmailChange: (value: boolean) => void;
  /** Dieu kien con thieu de Xac minh (rong = du SQL). */
  missing: string[];
  readOnly?: boolean;
  history?: Array<{ id: string; kind: string; at: string; from: string | null; to: string | null; emailStatus?: string | null }>;
  /** Gui lai email cho dong lich su co emailStatus 'failed'. */
  onResend?: (handoverId: string) => void;
  /** Lead da convert: chi con Re-assign + tai lieu (an phan dieu kien SQL). */
  converted?: boolean;
  children?: ReactNode;
}) {
  const badge = MODE_BADGE[mode];
  const { valid, invalid } = parseDocLinks(docLinksText);
  const needsEmail = mode !== 'self';
  return (
    <section className="crm-form-section crm-handover" data-testid="lead-handover-section">
      <div className="crm-handover-who">
        <span className={`crm-handover-badge ${badge.tone}`} data-testid="handover-mode-badge">{badge.text}</span>
      </div>
      {mode === 'self' ? (
        <p className="crm-handover-hint">Bạn tự xử lý Lead này — không bàn giao, không gửi email.</p>
      ) : null}

      <label className="crm-field crm-field--full">
        <span>Link Doc/Sheet/tài liệu hạng mục báo giá <small className="crm-verify-hint">(mỗi dòng 1 link, có thể dán nhiều)</small></span>
        <textarea
          className="crm-handover-links"
          data-testid="handover-doc-links"
          rows={2}
          disabled={readOnly}
          value={docLinksText}
          placeholder={'https://docs.google.com/spreadsheets/d/...\nhttps://docs.google.com/document/d/...'}
          onChange={event => onDocLinksChange(event.target.value)}
        />
      </label>
      {invalid.length ? (
        <p className="crm-error crm-handover-invalid" data-testid="handover-invalid-links">Link không hợp lệ (cần http:// hoặc https://): {invalid.join(', ')}</p>
      ) : valid.length ? (
        <p className="crm-handover-hint">{valid.length} link sẽ được lưu và gửi kèm cho người nhận.</p>
      ) : null}

      {needsEmail ? (
        <label className="crm-handover-email">
          <input type="checkbox" data-testid="handover-send-email" checked={sendEmail} disabled={readOnly} onChange={event => onSendEmailChange(event.target.checked)} />
          <span>Gửi email thông báo cho {recipientName || 'người nhận'}</span>
        </label>
      ) : null}

      {history && history.length ? (
        <details className="crm-handover-history">
          <summary>Lịch sử bàn giao ({history.length})</summary>
          <ul>
            {history.map(item => (
              <li key={item.id}>
                {new Date(item.at).toLocaleString('vi-VN')} · {item.from || '—'} → <b>{item.to || '—'}</b> · {item.kind === 'reassign' ? 'Re-assign' : item.kind === 'assign_qualified' ? 'Xác minh đạt chuẩn' : 'Bàn giao'}
                {item.emailStatus ? ` · email: ${({ sent: 'đã gửi', failed: 'chưa gửi được', skipped: 'không gửi', pending: 'đang gửi', dry_run: 'thử nghiệm' } as Record<string, string>)[item.emailStatus] || item.emailStatus}` : ''}
                {item.emailStatus === 'failed' && onResend ? (
                  <button type="button" className="crm-short-regen-btn" style={{ marginLeft: 8 }} data-testid="handover-resend" onClick={() => onResend(item.id)}>Gửi lại email</button>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {children}
    </section>
  );
}
