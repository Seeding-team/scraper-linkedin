'use client';

/**
 * Thu vien mau hop dong: tim kiem + danh sach tai lieu (row) + modal tai mau moi.
 * Dung API co san (list/get/upload/delete). Backend CHI luu noi dung text da trich xuat (khong luu file goc) nen:
 *  - "Xem" = xem noi dung da trich xuat (that); "Tai file goc" = tai DUNG file DOCX/PDF da upload (mau cu chua luu file goc se bao ro); ".txt" = noi dung trich xuat.
 * Che do chon (onSelect): hien nut "Chon mau" de quay lai AI Contract Copilot.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Eye, FileText, Search, Trash2, Upload, X } from 'lucide-react';
import { seedingContractTemplateRepository } from '../repositories/SeedingContractTemplateRepository';
import type { ContractTemplate } from '../types';
import { downloadTemplateOriginal, fetchTemplatePreviewPdf } from '@/modules/contracts/repositories/contractDocs';

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = ['docx', 'pdf', 'txt'];

function fold(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase();
}

function formatDate(value?: string) {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
}

function formatSize(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

const clamp = (lines: number): React.CSSProperties => ({ display: '-webkit-box', WebkitLineClamp: lines, WebkitBoxOrient: 'vertical', overflow: 'hidden', overflowWrap: 'anywhere' });

const btn = (primary = false): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: 6, height: 34, padding: '0 12px', borderRadius: 999, fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
  border: primary ? '1px solid #c2185b' : '1px solid #e2e8f0', background: primary ? '#c2185b' : '#fff', color: primary ? '#fff' : '#334155',
});

function UploadDialog({ onClose, onUploaded }: { onClose: () => void; onUploaded: (t: ContractTemplate) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) { event.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [busy, onClose]);

  function pick(next: File | null) {
    setError('');
    if (!next) { setFile(null); return; }
    const ext = next.name.split('.').pop()?.toLowerCase() || '';
    if (!ALLOWED.includes(ext)) { setFile(null); setError('Định dạng không được hỗ trợ — chỉ nhận DOCX, PDF hoặc TXT.'); return; }
    if (next.size > MAX_BYTES) { setFile(null); setError('File quá lớn — tối đa 10 MB.'); return; }
    setFile(next);
    if (!name.trim()) setName(next.name.replace(/\.[^.]+$/, ''));
    window.setTimeout(() => nameRef.current?.focus(), 0);
  }

  async function submit() {
    if (!file) { setError('Vui lòng chọn file mẫu.'); return; }
    setBusy(true); setError('');
    try {
      onUploaded(await seedingContractTemplateRepository.uploadTemplate(name.trim() || file.name, description.trim(), file));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Tải mẫu hợp đồng thất bại.');
    } finally { setBusy(false); }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Tải mẫu hợp đồng mới" data-testid="template-upload-dialog"
      onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 100400, background: 'rgba(15,23,42,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
      <div style={{ width: 'min(460px, 100%)', maxHeight: '92vh', overflow: 'auto', background: '#fff', borderRadius: 14, boxShadow: '0 24px 70px rgba(15,23,42,.35)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.9rem 1.1rem', borderBottom: '1px solid #eef2f7' }}>
          <b style={{ fontSize: '1rem' }}>Tải mẫu mới</b>
          <button type="button" aria-label="Đóng" onClick={onClose} disabled={busy} style={{ border: 0, background: 'transparent', cursor: 'pointer' }}><X size={18} /></button>
        </div>
        <div style={{ padding: '1rem 1.1rem', display: 'grid', gap: '0.75rem' }}>
          <input ref={inputRef} type="file" hidden accept=".docx,.pdf,.txt" onChange={event => pick(event.target.files?.[0] || null)} />
          <div
            data-testid="template-dropzone"
            onClick={() => inputRef.current?.click()}
            onDragOver={event => { event.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={event => { event.preventDefault(); setDrag(false); pick(event.dataTransfer.files?.[0] || null); }}
            style={{ border: `2px dashed ${drag ? '#c2185b' : '#cbd5e1'}`, background: drag ? '#fff5f8' : '#f8fafc', borderRadius: 12, padding: '1.1rem', textAlign: 'center', cursor: 'pointer' }}>
            {file ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center', minWidth: 0 }}>
                <FileText size={22} color="#c2185b" />
                <div style={{ minWidth: 0, textAlign: 'left' }}>
                  <b style={{ ...clamp(1), fontSize: '0.85rem' }} title={file.name}>{file.name}</b>
                  <small style={{ color: '#64748b' }}>{formatSize(file.size)} · bấm để đổi file</small>
                </div>
              </div>
            ) : (
              <>
                <Upload size={22} color="#64748b" />
                <div style={{ fontSize: '0.84rem', fontWeight: 700, marginTop: 4 }}>Kéo thả file vào đây hoặc bấm để chọn</div>
                <small style={{ color: '#64748b' }}>DOCX, PDF hoặc TXT · tối đa 10 MB</small>
              </>
            )}
          </div>
          <label style={{ display: 'grid', gap: 4, fontSize: '0.76rem', color: '#64748b', fontWeight: 600 }}>Tên mẫu
            <input ref={nameRef} value={name} onChange={event => setName(event.target.value)} placeholder="VD: Hợp đồng dịch vụ CNTT chuẩn 2026" style={{ height: 38, border: '1px solid #cbd5e1', borderRadius: 8, padding: '0 0.7rem', fontSize: '0.86rem', color: '#0f172a' }} />
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: '0.76rem', color: '#64748b', fontWeight: 600 }}>Ghi chú (tùy chọn)
            <textarea value={description} onChange={event => setDescription(event.target.value)} placeholder="Dùng cho loại hợp đồng nào, lưu ý gì…" rows={2} style={{ border: '1px solid #cbd5e1', borderRadius: 8, padding: '0.5rem 0.7rem', fontSize: '0.84rem', color: '#0f172a', resize: 'vertical' }} />
          </label>
          {error ? <p role="alert" data-testid="template-upload-error" style={{ margin: 0, color: '#b91c1c', fontSize: '0.78rem' }}>{error}</p> : null}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '0.8rem 1.1rem', borderTop: '1px solid #eef2f7' }}>
          <button type="button" style={btn()} onClick={onClose} disabled={busy}>Hủy</button>
          <button type="button" style={{ ...btn(true), opacity: !file || busy ? 0.55 : 1 }} disabled={!file || busy} onClick={() => void submit()} data-testid="template-upload-submit">
            {busy ? 'Đang tải lên…' : 'Tải lên'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ContractTemplateLibrary({
  onSelect, selectedId, onChanged,
}: {
  /** Co => che do chon mau (mo tu AI Contract Copilot): hien nut "Chon mau". */
  onSelect?: (template: ContractTemplate) => void;
  selectedId?: string;
  /** Goi sau khi tai len / xoa mau de noi goi lam moi danh sach cua minh. */
  onChanged?: () => void;
}) {
  const [templates, setTemplates] = useState<ContractTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [openId, setOpenId] = useState('');
  const [previews, setPreviews] = useState<Record<string, { loading: boolean; text?: string; error?: string }>>({});
  const [fresh, setFresh] = useState('');
  const [viewer, setViewer] = useState<{ template: ContractTemplate; url: string | null; loading: boolean; error: string } | null>(null);
  const viewerUrlRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setTemplates(await seedingContractTemplateRepository.getTemplates()); }
    catch (err) { setError(err instanceof Error ? err.message : 'Không tải được danh sách mẫu hợp đồng.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => {
    const q = fold(query.trim());
    if (!q) return templates;
    return templates.filter(t => fold(`${t.name} ${t.fileName} ${t.description || ''}`).includes(q));
  }, [templates, query]);

  useEffect(() => () => { if (viewerUrlRef.current) URL.revokeObjectURL(viewerUrlRef.current); }, []);

  /** "Xem" = mở ĐÚNG tài liệu gốc (DOCX chuyển PDF giữ bố cục / PDF xem thẳng) trong viewer thật - không phải text trích xuất. */
  async function openViewer(template: ContractTemplate) {
    if (viewerUrlRef.current) { URL.revokeObjectURL(viewerUrlRef.current); viewerUrlRef.current = null; }
    setViewer({ template, url: null, loading: true, error: '' });
    try {
      const blob = await fetchTemplatePreviewPdf(template.id);
      const url = URL.createObjectURL(blob);
      viewerUrlRef.current = url;
      setViewer({ template, url, loading: false, error: '' });
    } catch (err) {
      setViewer({ template, url: null, loading: false, error: err instanceof Error ? err.message : 'Không xem trước được mẫu này.' });
    }
  }
  function closeViewer() {
    if (viewerUrlRef.current) { URL.revokeObjectURL(viewerUrlRef.current); viewerUrlRef.current = null; }
    setViewer(null);
  }

  async function togglePreview(template: ContractTemplate) {
    if (openId === template.id) { setOpenId(''); return; }
    setOpenId(template.id);
    if (previews[template.id]?.text !== undefined) return;
    setPreviews(prev => ({ ...prev, [template.id]: { loading: true } }));
    try {
      const full = await seedingContractTemplateRepository.getTemplate(template.id);
      setPreviews(prev => ({ ...prev, [template.id]: { loading: false, text: full.extractedText || '' } }));
    } catch (err) {
      setPreviews(prev => ({ ...prev, [template.id]: { loading: false, error: err instanceof Error ? err.message : 'Không xem được nội dung.' } }));
    }
  }

  async function downloadOriginal(template: ContractTemplate) {
    try {
      await downloadTemplateOriginal(template.id, template.fileName || `${template.name}.${template.fileType}`);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không tải được file gốc.');
    }
  }

  async function downloadText(template: ContractTemplate) {
    try {
      const full = await seedingContractTemplateRepository.getTemplate(template.id);
      const blob = new Blob([full.extractedText || ''], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${template.name.replace(/[\\/:*?"<>|]+/g, '_')}.txt`; a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không tải được nội dung.');
    }
  }

  async function remove(template: ContractTemplate) {
    if (!window.confirm(`Xoá mẫu “${template.name}”?`)) return;
    try {
      await seedingContractTemplateRepository.deleteTemplate(template.id);
      await load(); onChanged?.();
    } catch (err) { window.alert(err instanceof Error ? err.message : 'Không xoá được.'); }
  }

  return (
    <section data-testid="template-library" style={{ minWidth: 0, maxWidth: '100%', paddingTop: '0.4rem' }}>
      <header style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: '1rem' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
          <Search size={15} style={{ position: 'absolute', left: 12, top: 11, color: '#94a3b8' }} />
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Tìm theo tên mẫu hoặc tên file…" aria-label="Tìm mẫu hợp đồng" data-testid="template-search"
            style={{ width: '100%', height: 38, border: '1px solid #e2e8f0', borderRadius: 999, padding: '0 14px 0 34px', fontSize: '0.84rem' }} />
        </div>
        <button type="button" style={btn(true)} onClick={() => setUploadOpen(true)} data-testid="template-upload-open"><Upload size={15} /> Tải mẫu mới</button>
      </header>

      {error ? <p role="alert" style={{ color: '#b91c1c', fontSize: '0.8rem' }}>{error}</p> : null}
      {loading ? <p style={{ fontSize: '0.8rem', color: '#64748b' }}>Đang tải danh sách…</p> : null}
      {!loading && visible.length === 0 ? (
        <div style={{ border: '1px dashed #cbd5e1', borderRadius: 12, padding: '1.4rem', textAlign: 'center', color: '#64748b', fontSize: '0.84rem' }}>
          {templates.length === 0 ? 'Chưa có mẫu hợp đồng nào. Bấm “Tải mẫu mới” để thêm.' : 'Không tìm thấy mẫu phù hợp.'}
        </div>
      ) : null}

      <ul style={{ listStyle: 'none', margin: 0, padding: 0, border: visible.length ? '1px solid #e2e8f0' : 0, borderRadius: 12, overflow: 'hidden', background: '#fff' }}>
        {visible.map((t, index) => {
          const preview = previews[t.id];
          const chosen = selectedId === t.id;
          return (
            <li key={t.id} data-testid="template-row" style={{ borderTop: index ? '1px solid #eef2f7' : 0, background: chosen ? '#fff5f8' : (fresh === t.id ? '#f0fdf4' : '#fff') }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '0.75rem 0.9rem', flexWrap: 'wrap' }}>
                <FileText size={20} color="#475569" style={{ flex: 'none', marginTop: 2 }} />
                <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                  <b style={{ ...clamp(2), fontSize: '0.92rem', lineHeight: 1.3 }} title={t.name}>{t.name}</b>
                  <div style={{ ...clamp(1), fontSize: '0.74rem', color: '#64748b', marginTop: 2 }} title={t.fileName}>
                    {t.fileType.toUpperCase()} · {t.fileName}{t.createdAt ? ` · ${formatDate(t.createdAt)}` : ''}
                  </div>
                  {t.description ? <div style={{ ...clamp(2), fontSize: '0.76rem', color: '#94a3b8', marginTop: 2 }} title={t.description}>{t.description}</div> : null}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginLeft: 'auto' }}>
                  <button type="button" style={btn()} onClick={() => void openViewer(t)} data-testid="template-view"><Eye size={14} /> Xem</button>
                  <button type="button" style={btn()} onClick={() => void togglePreview(t)} aria-expanded={openId === t.id} data-testid="template-view-text" title="Xem nội dung văn bản đã trích xuất (không giữ định dạng gốc)">
                    <FileText size={14} /> {openId === t.id ? 'Ẩn nội dung' : 'Xem nội dung'}
                  </button>
                  <button type="button" style={btn()} onClick={() => void downloadOriginal(t)} title="Tải đúng file gốc đã upload (DOCX/PDF)" data-testid="template-download-original"><Download size={14} /> File gốc</button>
                  <button type="button" style={btn()} onClick={() => void downloadText(t)} title="Tải nội dung text đã trích xuất"><Download size={14} /> .txt</button>
                  <button type="button" style={{ ...btn(), padding: '0 9px' }} onClick={() => void remove(t)} aria-label={`Xoá mẫu ${t.name}`} title="Xoá mẫu"><Trash2 size={14} color="#b91c1c" /></button>
                  {onSelect ? (
                    <button type="button" style={btn(true)} onClick={() => onSelect(t)} data-testid="template-choose">{chosen ? '✓ Đang chọn' : 'Chọn mẫu'}</button>
                  ) : null}
                </div>
              </div>
              {openId === t.id ? (
                <div data-testid="template-preview-text" style={{ margin: '0 0.9rem 0.8rem', border: '1px solid #e2e8f0', borderRadius: 8, background: '#f8fafc', padding: '0.6rem 0.75rem' }}>
                  <small style={{ color: '#64748b' }}>Nội dung văn bản đã trích xuất ({t.textLength.toLocaleString('vi-VN')} ký tự) — chức năng phụ, dùng "Xem" để xem đúng bố cục gốc.</small>
                  {preview?.loading ? <p style={{ margin: '0.4rem 0 0', fontSize: '0.78rem' }}>Đang tải…</p> : preview?.error ? <p style={{ margin: '0.4rem 0 0', color: '#b91c1c', fontSize: '0.78rem' }}>{preview.error}</p> : (
                    <pre style={{ margin: '0.4rem 0 0', maxHeight: 220, overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontFamily: 'inherit', fontSize: '0.78rem', lineHeight: 1.5 }}>{preview?.text || '(Mẫu không có nội dung văn bản)'}</pre>
                  )}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {uploadOpen ? (
        <UploadDialog
          onClose={() => setUploadOpen(false)}
          onUploaded={async created => { setUploadOpen(false); setFresh(created.id); await load(); onChanged?.(); }}
        />
      ) : null}

      {viewer ? (
        <div role="dialog" aria-modal="true" aria-label={`Xem mẫu ${viewer.template.name}`} data-testid="template-preview-modal"
          style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2vh 2vw' }}
          onClick={e => { if (e.target === e.currentTarget) closeViewer(); }}>
          <div style={{ background: '#fff', borderRadius: 12, width: 'min(980px, 96vw)', height: '94vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0.7rem 1rem', borderBottom: '1px solid #e2e8f0' }}>
              <FileText size={18} color="#475569" style={{ flex: 'none' }} />
              <b style={{ fontSize: '0.9rem', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={viewer.template.name}>{viewer.template.name}</b>
              <button type="button" style={btn()} onClick={() => void downloadOriginal(viewer.template)} data-testid="template-preview-download"><Download size={14} /> Tải file gốc</button>
              <button type="button" style={{ ...btn(), padding: '0 9px' }} onClick={closeViewer} aria-label="Đóng xem trước" data-testid="template-preview-close"><X size={16} /></button>
            </div>
            <div style={{ flex: 1, minHeight: 0, background: '#525659' }}>
              {viewer.loading ? (
                <p style={{ color: '#fff', fontSize: '0.85rem', padding: '1.2rem' }}>Đang chuyển đổi để xem trước…</p>
              ) : viewer.error ? (
                <div style={{ padding: '1.2rem' }}>
                  <p style={{ color: '#fecaca', fontSize: '0.85rem' }} data-testid="template-preview-error">{viewer.error}</p>
                  <button type="button" style={btn(true)} onClick={() => void downloadOriginal(viewer.template)}><Download size={14} /> Tải file gốc để xem</button>
                </div>
              ) : viewer.url ? (
                <iframe title={`Xem mẫu ${viewer.template.name}`} src={viewer.url} data-testid="template-preview-frame" style={{ width: '100%', height: '100%', border: 0 }} />
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
