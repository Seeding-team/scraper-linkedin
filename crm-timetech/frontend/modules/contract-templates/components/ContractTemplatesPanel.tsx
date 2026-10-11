'use client';

import { useEffect, useRef, useState } from 'react';
import { seedingContractTemplateRepository } from '../repositories/SeedingContractTemplateRepository';
import type { ContractTemplate } from '../types';

function formatDate(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}

/** Nội dung "Mẫu hợp đồng" (upload + danh sách) — tách riêng khỏi ContractTemplatesPage
 * để dùng lại được dưới dạng tab ngay trong ContractHomePage (không cần chuyển trang). */
export function ContractTemplatesPanel() {
  const [templates, setTemplates] = useState<ContractTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function load() {
    setLoading(true);
    setError('');
    try {
      setTemplates(await seedingContractTemplateRepository.getTemplates());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không tải được danh sách mẫu hợp đồng.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleUpload(event: React.FormEvent) {
    event.preventDefault();
    if (!file) {
      setError('Vui lòng chọn file mẫu hợp đồng (.docx, .pdf hoặc .txt).');
      return;
    }
    setUploading(true);
    setError('');
    try {
      await seedingContractTemplateRepository.uploadTemplate(name || file.name, description, file);
      setName('');
      setDescription('');
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Tải mẫu hợp đồng thất bại.');
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm('Xoá mẫu hợp đồng này?')) return;
    try {
      await seedingContractTemplateRepository.deleteTemplate(id);
      await load();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không xoá được.');
    }
  }

  return (
    <div>
      <section className="contract-card" style={{ marginTop: '1.25rem' }}>
        <h3>Tải lên mẫu mới</h3>
        <p>AI sẽ tự trích xuất nội dung text từ file — không cần chuyển đổi thủ công.</p>
        <form className="contract-form" onSubmit={handleUpload}>
          <div className="two">
            <label>
              Tên mẫu
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Ví dụ: Hợp đồng dịch vụ CNTT chuẩn 2026" />
            </label>
            <label>
              File (.docx, .pdf, .txt) *
              <input
                ref={fileInputRef}
                type="file"
                accept=".docx,.pdf,.txt"
                onChange={e => setFile(e.target.files?.[0] || null)}
              />
            </label>
          </div>
          <label>
            Ghi chú
            <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Dùng cho loại hợp đồng nào, lưu ý gì..." />
          </label>
          {error ? <p style={{ color: '#dc2626', fontSize: '0.78rem', margin: 0 }}>{error}</p> : null}
          <button type="submit" className="contract-button contract-button--primary" disabled={uploading} style={{ width: 'max-content' }}>
            {uploading ? 'Đang tải lên...' : '↑ Tải lên mẫu'}
          </button>
        </form>
      </section>

      {loading ? <section className="contract-state">Đang tải danh sách...</section> : null}

      {!loading ? (
        <div className="contract-table-wrap">
          <table className="contract-table">
            <thead>
              <tr>
                <th>Tên mẫu</th>
                <th>File</th>
                <th>Ghi chú</th>
                <th>Độ dài nội dung</th>
                <th>Ngày tải lên</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {templates.length === 0 ? (
                <tr><td colSpan={6} className="empty-row">Chưa có mẫu hợp đồng nào.</td></tr>
              ) : (
                templates.map(t => (
                  <tr key={t.id}>
                    <td><strong>{t.name}</strong></td>
                    <td>{t.fileName} <span className="contract-badge status-neutral">{t.fileType}</span></td>
                    <td style={{ color: '#94a3b8', fontSize: '0.78rem' }}>{t.description || '—'}</td>
                    <td>{t.textLength.toLocaleString('vi-VN')} ký tự</td>
                    <td>{formatDate(t.createdAt)}</td>
                    <td>
                      <button type="button" className="contract-button contract-button--danger" onClick={() => void handleDelete(t.id)}>
                        Xoá
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
