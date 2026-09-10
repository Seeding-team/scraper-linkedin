'use client';

import { useState } from 'react';
import { X } from '@/modules/crm/components/icons';
import { serviceCatalogRepository } from './repositories/ServiceCatalogRepository';
import type { ServiceCatalogItem } from './types';
import './styles/service-catalog.css';
import '@/modules/crm/styles/quote-center.css';

/** "+ Nhóm sản phẩm" ngay trong popup Chọn từ danh mục (yeu cau muc 2) -
 * dung DUNG serviceCatalogRepository.create() (API/schema/quyen giong het
 * trang quan ly "Sản phẩm & dịch vụ"), khong tao nguon du lieu rieng. */
export function QuickAddGroupModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (created: ServiceCatalogItem) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!name.trim()) {
      setError('Tên nhóm bắt buộc.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const created = await serviceCatalogRepository.create({
        itemType: 'group',
        name: name.trim(),
        description: description.trim() || undefined,
        status: 'active',
      });
      onCreated(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không tạo được nhóm sản phẩm.');
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div className="qc-modal-backdrop qc-modal-backdrop--nested" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      {/* BUG THAT DA GAP ("form chỉ có 2 field nhưng mở drawer cao toàn màn
       * hình") - dung .sc-drawer--modal--sm (modal GIUA man hinh, cao theo
       * noi dung, xem service-catalog.css) thay vi .sc-drawer goc + style
       * width inline cu (van la 100vh du chi rong 420px). */}
      <div className="sc-drawer sc-drawer--modal sc-drawer--modal-sm" onMouseDown={event => event.stopPropagation()}>
        <div className="sc-drawer-head">
          <div>
            <h2>Thêm nhóm sản phẩm</h2>
            <p>Lưu trực tiếp vào "Sản phẩm & dịch vụ"</p>
          </div>
          <button type="button" className="sc-icon-btn" aria-label="Đóng" onClick={onClose}>
            <X className="qc-inline-icon" />
          </button>
        </div>
        <div className="sc-drawer-body">
          <div className="sc-panel-grid">
            <label className="sc-field">
              <span>Tên nhóm *</span>
              <input value={name} onChange={e => setName(e.target.value)} />
            </label>
            <label className="sc-field" style={{ gridColumn: '1 / -1' }}>
              <span>Mô tả</span>
              <textarea value={description} onChange={e => setDescription(e.target.value)} />
            </label>
          </div>
          {error ? <div className="sc-error">{error}</div> : null}
        </div>
        <div className="sc-drawer-footer">
          <button type="button" className="sc-btn" onClick={onClose}>Huỷ</button>
          <button type="button" className="sc-btn sc-btn-primary" disabled={saving} onClick={() => void handleSave()}>
            {saving ? 'Đang lưu...' : 'Lưu nhóm'}
          </button>
        </div>
      </div>
    </div>
  );
}
