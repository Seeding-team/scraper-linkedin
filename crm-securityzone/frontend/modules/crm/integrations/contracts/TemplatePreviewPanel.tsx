'use client';

import { useState } from 'react';
import type { TemplateRenderResult } from '@/modules/contracts/repositories/contractDocs';

type Tab = 'edited' | 'original' | 'compare';

const box: React.CSSProperties = { border: '1px solid #e2e8f0', borderRadius: 10, background: '#fff' };
const small: React.CSSProperties = { fontSize: '0.76rem', color: '#475569' };

function Viewer({ url, title, emptyText, height = 560 }: { url: string | null; title: string; emptyText: string; height?: number }) {
  return url ? (
    <iframe title={title} src={url} style={{ width: '100%', height, border: '1px solid #cbd5e1', borderRadius: 8, background: '#f8fafc' }} />
  ) : (
    <div style={{ ...box, padding: '1.2rem', color: '#b45309', fontSize: '0.82rem' }}>{emptyText}</div>
  );
}

/** Xem trước = CHÍNH file PDF sẽ xuất (chuyển từ DOCX đã chỉnh), kèm đối chiếu với mẫu gốc và danh sách thay đổi. */
export function TemplatePreviewPanel({ result, editedUrl, originalUrl, onChooseItemsTable }: {
  result: TemplateRenderResult; editedUrl: string | null; originalUrl: string | null; onChooseItemsTable?: (index: number) => void;
}) {
  const [tableChoice, setTableChoice] = useState<number | ''>('');
  const candidates = result.itemsTable.candidates || [];
  const [tab, setTab] = useState<Tab>('edited');
  const noPdf = result.pdfError || 'Server chưa tạo được PDF xem trước. Bạn vẫn tải được DOCX đã chỉnh sửa.';
  return (
    <div data-testid="template-preview" style={{ display: 'grid', gap: '0.8rem', maxWidth: tab === 'compare' ? 1600 : 980, margin: '0 auto', width: '100%' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <span data-testid="template-layout-badge" style={{ padding: '3px 10px', borderRadius: 999, fontSize: '0.76rem', fontWeight: 700, background: result.layoutPreserved ? '#e7f8f0' : '#fff7ed', color: result.layoutPreserved ? '#16845d' : '#9a3412' }}>
          {result.layoutPreserved ? '✓ Giữ nguyên bố cục mẫu' : '! Bố cục khác mẫu — cần kiểm tra'}
        </span>
        <span style={small}>
          {result.originalPages != null ? `Mẫu gốc ${result.originalPages} trang → ` : ''}
          {result.pages != null ? `bản chỉnh sửa ${result.pages} trang` : 'chưa có PDF'}
          {result.itemsTable.filled ? ` · ${result.itemsTable.rows} hạng mục báo giá đã điền` : ''}
          {result.partyTables && result.partyTables.filled.length > 0 ? ` · ${result.partyTables.filled.length} trường Bên A/B đã cập nhật đúng dữ liệu hợp đồng này` : ''}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {([['edited', 'Bản đã chỉnh'], ['original', 'Mẫu gốc'], ['compare', 'So sánh']] as Array<[Tab, string]>).map(([id, label]) => (
            <button key={id} type="button" data-testid={`template-tab-${id}`} onClick={() => setTab(id)} className="contract-button contract-button--secondary"
              style={{ height: 32, fontWeight: tab === id ? 800 : 500, borderColor: tab === id ? '#c2185b' : undefined }}>{label}</button>
          ))}
        </div>
      </div>

      {tab === 'edited' ? <Viewer url={editedUrl} title="Bản đã chỉnh sửa" emptyText={noPdf} /> : null}
      {tab === 'original' ? <Viewer url={originalUrl} title="Mẫu gốc" emptyText={noPdf} /> : null}
      {tab === 'compare' ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div><b style={small}>Mẫu gốc</b><Viewer url={originalUrl} title="Mẫu gốc" emptyText={noPdf} height={780} /></div>
          <div><b style={small}>Bản đã chỉnh</b><Viewer url={editedUrl} title="Bản đã chỉnh sửa" emptyText={noPdf} height={780} /></div>
        </div>
      ) : null}

      {!result.itemsTable.filled && candidates.length > 0 && onChooseItemsTable ? (
        <div data-testid="items-table-chooser" style={{ ...box, background: '#fff7ed', borderColor: '#fed7aa', padding: '0.7rem 0.9rem', fontSize: '0.8rem', color: '#9a3412', display: 'grid', gap: 6 }}>
          <b>Chọn bảng để điền hạng mục báo giá (hệ thống không tự chèn vào bảng chưa xác định):</b>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select value={tableChoice} onChange={event => setTableChoice(event.target.value === '' ? '' : Number(event.target.value))} style={{ height: 34, border: '1px solid #cbd5e1', borderRadius: 8, padding: '0 0.5rem', maxWidth: 520 }}>
              <option value="">-- Chọn bảng --</option>
              {candidates.map(c => <option key={c.index} value={c.index}>Bảng {c.index + 1} ({c.rows} dòng): {c.preview}</option>)}
            </select>
            <button type="button" className="contract-button contract-button--primary" disabled={tableChoice === ''} onClick={() => tableChoice !== '' && onChooseItemsTable(tableChoice)}>Điền hạng mục vào bảng này</button>
          </div>
        </div>
      ) : null}

      {result.warnings.length > 0 ? (
        <ul data-testid="template-warnings" style={{ ...box, margin: 0, padding: '0.7rem 1.2rem', background: '#fff7ed', borderColor: '#fed7aa', color: '#9a3412', fontSize: '0.78rem' }}>
          {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
        </ul>
      ) : null}

      <details open style={{ ...box, padding: '0.6rem 0.9rem' }}>
        <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: '0.84rem' }}>Thay đổi đã áp vào tài liệu ({result.edits.length})</summary>
        {result.edits.length === 0 ? <p style={small}>AI không đề xuất sửa đoạn nào; chỉ điền dữ liệu CRM/báo giá vào mẫu.</p> : result.edits.map(e => (
          <div key={e.id} style={{ borderTop: '1px solid #eef2f7', padding: '0.5rem 0', fontSize: '0.78rem' }}>
            <div style={{ color: '#94a3b8', textDecoration: 'line-through' }}>{e.before}</div>
            <div style={{ color: '#0f172a' }}>{e.after}</div>
            {e.reason ? <small style={{ color: '#64748b' }}>Lý do: {e.reason}</small> : null}
          </div>
        ))}
      </details>

      {result.rejectedEdits.length > 0 ? (
        <details style={{ ...box, padding: '0.6rem 0.9rem' }}>
          <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: '0.84rem', color: '#b45309' }}>Đề xuất của AI bị chặn ({result.rejectedEdits.length}) — không được áp</summary>
          {result.rejectedEdits.map((r, i) => <div key={i} style={{ ...small, padding: '0.3rem 0' }}>{r.id}: {r.reason}</div>)}
        </details>
      ) : null}
    </div>
  );
}
