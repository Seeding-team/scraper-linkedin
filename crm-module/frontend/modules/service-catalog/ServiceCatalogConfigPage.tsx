'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useServiceCatalog } from './use-service-catalog';
import { serviceCatalogRepository } from './repositories/ServiceCatalogRepository';
import type { ServiceCatalogUnit, ServiceCatalogVatRate } from './types';
import type { FlatProduct } from './catalog-form-utils';
import { ActionMenu } from '@/modules/crm/components/ActionMenu';
import { ConfirmModal } from '@/modules/crm/components/ConfirmModal';
import { Pencil, PauseCircle } from '@/modules/crm/components/icons';
import './styles/service-catalog.css';

/** Trang "Cấu hình" (Đơn vị tính & VAT) - CRUD THẬT (migration 117), thay
 * cho ban bao cao tinh thuan tuy truoc day. Van giu lai so luong san pham
 * dang dung tung gia tri (tham chieu cheo tu du lieu san pham da tai qua
 * useServiceCatalog(), thong tin nay van huu ich de biet 1 gia tri co dang
 * "duoc dung" truoc khi ngung su dung no). */
export function ServiceCatalogConfigPage() {
  const { items } = useServiceCatalog();

  const products = useMemo<FlatProduct[]>(() => {
    const result: FlatProduct[] = [];
    for (const group of items) {
      for (const child of group.children || []) {
        result.push({ ...child, groupName: group.name });
      }
    }
    return result;
  }, [items]);

  const unitUsageCount = useMemo(() => {
    const map = new Map<string, number>();
    for (const product of products) {
      const key = product.unit?.trim();
      if (!key) continue;
      map.set(key, (map.get(key) || 0) + 1);
    }
    return map;
  }, [products]);

  const vatUsageCount = useMemo(() => {
    const map = new Map<number, number>();
    for (const product of products) {
      const key = product.defaultVatRate || 0;
      map.set(key, (map.get(key) || 0) + 1);
    }
    return map;
  }, [products]);

  const [units, setUnits] = useState<ServiceCatalogUnit[] | null>(null);
  const [vatRates, setVatRates] = useState<ServiceCatalogVatRate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [unitList, vatList] = await Promise.all([
        serviceCatalogRepository.listUnits(),
        serviceCatalogRepository.listVatRates(),
      ]);
      setUnits(unitList);
      setVatRates(vatList);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không tải được Đơn vị tính & VAT.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Them moi
  const [newUnitName, setNewUnitName] = useState('');
  const [newUnitError, setNewUnitError] = useState<string | null>(null);
  const [savingUnit, setSavingUnit] = useState(false);
  async function handleAddUnit() {
    if (!newUnitName.trim()) {
      setNewUnitError('Tên đơn vị tính bắt buộc.');
      return;
    }
    setSavingUnit(true);
    setNewUnitError(null);
    try {
      await serviceCatalogRepository.createUnit(newUnitName.trim());
      setNewUnitName('');
      await refresh();
    } catch (err) {
      setNewUnitError(err instanceof Error ? err.message : 'Không thêm được đơn vị tính.');
    } finally {
      setSavingUnit(false);
    }
  }
  // "Nếu đang được sản phẩm sử dụng thì phải cảnh báo số sản phẩm bị ảnh
  // hưởng trước khi xác nhận" - chi hoi xac nhan khi THAT SU dang NGUNG su
  // dung (active -> inactive) VA co san pham dang dung gia tri nay; kich
  // hoat lai thi khong can canh bao (khong anh huong gi ca).
  const [pendingDeactivate, setPendingDeactivate] = useState<
    { kind: 'unit'; target: ServiceCatalogUnit } | { kind: 'vat'; target: ServiceCatalogVatRate } | null
  >(null);

  async function applyUnitStatus(unit: ServiceCatalogUnit, nextStatus: 'active' | 'inactive') {
    try {
      await serviceCatalogRepository.updateUnit(unit.id, { status: nextStatus });
      await refresh();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không cập nhật được trạng thái.');
    }
  }
  function toggleUnitStatus(unit: ServiceCatalogUnit) {
    if (unit.status === 'active' && (unitUsageCount.get(unit.name) || 0) > 0) {
      setPendingDeactivate({ kind: 'unit', target: unit });
      return;
    }
    void applyUnitStatus(unit, unit.status === 'active' ? 'inactive' : 'active');
  }
  const [editUnit, setEditUnit] = useState<ServiceCatalogUnit | null>(null);
  const [editUnitName, setEditUnitName] = useState('');
  const [editUnitError, setEditUnitError] = useState<string | null>(null);
  async function handleSaveUnitEdit() {
    if (!editUnit) return;
    if (!editUnitName.trim()) {
      setEditUnitError('Tên đơn vị tính bắt buộc.');
      return;
    }
    try {
      await serviceCatalogRepository.updateUnit(editUnit.id, { name: editUnitName.trim() });
      setEditUnit(null);
      await refresh();
    } catch (err) {
      setEditUnitError(err instanceof Error ? err.message : 'Không lưu được đơn vị tính.');
    }
  }

  const [newVatRate, setNewVatRate] = useState('');
  const [newVatError, setNewVatError] = useState<string | null>(null);
  const [savingVat, setSavingVat] = useState(false);
  async function handleAddVatRate() {
    const parsed = Number(newVatRate);
    if (newVatRate.trim() === '' || !Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
      setNewVatError('Mức VAT phải là số từ 0 đến 100.');
      return;
    }
    setSavingVat(true);
    setNewVatError(null);
    try {
      await serviceCatalogRepository.createVatRate(parsed);
      setNewVatRate('');
      await refresh();
    } catch (err) {
      setNewVatError(err instanceof Error ? err.message : 'Không thêm được mức VAT.');
    } finally {
      setSavingVat(false);
    }
  }
  async function applyVatStatus(vat: ServiceCatalogVatRate, nextStatus: 'active' | 'inactive') {
    try {
      await serviceCatalogRepository.updateVatRate(vat.id, { status: nextStatus });
      await refresh();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không cập nhật được trạng thái.');
    }
  }
  function toggleVatStatus(vat: ServiceCatalogVatRate) {
    if (vat.status === 'active' && (vatUsageCount.get(vat.rate) || 0) > 0) {
      setPendingDeactivate({ kind: 'vat', target: vat });
      return;
    }
    void applyVatStatus(vat, vat.status === 'active' ? 'inactive' : 'active');
  }
  async function handleConfirmDeactivate() {
    if (!pendingDeactivate) return;
    if (pendingDeactivate.kind === 'unit') await applyUnitStatus(pendingDeactivate.target, 'inactive');
    else await applyVatStatus(pendingDeactivate.target, 'inactive');
    setPendingDeactivate(null);
  }

  return (
    <div className="sc-page">
      <nav className="sc-breadcrumb" aria-label="Breadcrumb">
        <Link href="/all-platform/service-catalog">Sản phẩm & dịch vụ</Link>
        <span className="sc-breadcrumb-sep">/</span>
        <span className="sc-breadcrumb-current">Cấu hình (Đơn vị tính &amp; VAT)</span>
      </nav>

      <div className="sc-header">
        <h1>Đơn vị tính &amp; VAT</h1>
      </div>

      {error ? (
        <div className="sc-error">
          {error}{' '}
          <button type="button" className="sc-mini-link-btn" onClick={() => void refresh()}>
            Thử lại
          </button>
        </div>
      ) : null}
      {loading ? <div className="sc-loading">Đang tải...</div> : null}

      {!loading && !error ? (
        <div className="sc-summary-grid sc-summary-grid--config">
          <div className="sc-summary-card">
            <h3>Đơn vị tính</h3>
            <div className="sc-toolbar">
              <input
                className="sc-search"
                placeholder="Thêm đơn vị tính mới (vd: Gói/tháng)"
                value={newUnitName}
                onChange={e => setNewUnitName(e.target.value)}
              />
              <button type="button" className="sc-btn sc-btn-primary" disabled={savingUnit} onClick={() => void handleAddUnit()}>
                {savingUnit ? 'Đang thêm...' : '+ Thêm'}
              </button>
            </div>
            {newUnitError ? <div className="sc-error">{newUnitError}</div> : null}
            {editUnit ? (
              <div className="sc-panel">
                <strong>Sửa đơn vị tính</strong>
                <div className="sc-panel-grid">
                  <label className="sc-field">
                    <span>Tên đơn vị tính</span>
                    <input value={editUnitName} onChange={e => setEditUnitName(e.target.value)} />
                  </label>
                </div>
                {editUnitError ? <div className="sc-error">{editUnitError}</div> : null}
                <div className="sc-panel-actions">
                  <button type="button" className="sc-btn" onClick={() => setEditUnit(null)}>Huỷ</button>
                  <button type="button" className="sc-btn sc-btn-primary" onClick={() => void handleSaveUnitEdit()}>Lưu</button>
                </div>
              </div>
            ) : null}
            <table className="sc-table">
              <thead>
                <tr>
                  <th>Đơn vị tính</th>
                  <th>Số sản phẩm</th>
                  <th>Trạng thái</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {(units || []).length === 0 ? (
                  <tr>
                    <td colSpan={4} className="sc-empty">Chưa có đơn vị tính nào.</td>
                  </tr>
                ) : (
                  (units || []).map(unit => (
                    <tr key={unit.id}>
                      <td>{unit.name}</td>
                      <td>{unitUsageCount.get(unit.name) || 0}</td>
                      <td>
                        <span className={`sc-badge ${unit.status === 'inactive' ? 'sc-badge-inactive' : 'sc-badge-active'}`}>
                          {unit.status === 'inactive' ? 'Ngừng sử dụng' : 'Đang sử dụng'}
                        </span>
                      </td>
                      <td className="sc-row-actions">
                        <ActionMenu
                          items={[
                            {
                              key: 'edit',
                              label: 'Sửa',
                              icon: Pencil,
                              onSelect: () => { setEditUnit(unit); setEditUnitName(unit.name); setEditUnitError(null); },
                            },
                            {
                              key: 'toggle',
                              label: unit.status === 'inactive' ? 'Kích hoạt lại' : 'Ngừng sử dụng',
                              icon: PauseCircle,
                              onSelect: () => toggleUnitStatus(unit),
                              group: 2,
                            },
                          ]}
                        />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="sc-summary-card">
            <h3>Mức VAT</h3>
            <div className="sc-toolbar">
              <input
                className="sc-search"
                type="number"
                placeholder="Thêm mức VAT mới (vd: 8)"
                value={newVatRate}
                onChange={e => setNewVatRate(e.target.value)}
              />
              <button type="button" className="sc-btn sc-btn-primary" disabled={savingVat} onClick={() => void handleAddVatRate()}>
                {savingVat ? 'Đang thêm...' : '+ Thêm'}
              </button>
            </div>
            {newVatError ? <div className="sc-error">{newVatError}</div> : null}
            <table className="sc-table">
              <thead>
                <tr>
                  <th>VAT</th>
                  <th>Số sản phẩm</th>
                  <th>Trạng thái</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {(vatRates || []).length === 0 ? (
                  <tr>
                    <td colSpan={4} className="sc-empty">Chưa có mức VAT nào.</td>
                  </tr>
                ) : (
                  (vatRates || []).map(vat => (
                    <tr key={vat.id}>
                      <td>{vat.rate}%</td>
                      <td>{vatUsageCount.get(vat.rate) || 0}</td>
                      <td>
                        <span className={`sc-badge ${vat.status === 'inactive' ? 'sc-badge-inactive' : 'sc-badge-active'}`}>
                          {vat.status === 'inactive' ? 'Ngừng sử dụng' : 'Đang sử dụng'}
                        </span>
                      </td>
                      <td className="sc-row-actions">
                        <ActionMenu
                          items={[
                            {
                              key: 'toggle',
                              label: vat.status === 'inactive' ? 'Kích hoạt lại' : 'Ngừng sử dụng',
                              icon: PauseCircle,
                              onSelect: () => toggleVatStatus(vat),
                            },
                          ]}
                        />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <ConfirmModal
        open={pendingDeactivate != null}
        title="Ngừng sử dụng"
        message={(() => {
          if (!pendingDeactivate) return '';
          if (pendingDeactivate.kind === 'unit') {
            const count = unitUsageCount.get(pendingDeactivate.target.name) || 0;
            return `Đơn vị tính "${pendingDeactivate.target.name}" đang được ${count} sản phẩm sử dụng. Ngừng sử dụng KHÔNG ảnh hưởng báo giá cũ, chỉ không cho chọn khi tạo sản phẩm mới. Tiếp tục?`;
          }
          const count = vatUsageCount.get(pendingDeactivate.target.rate) || 0;
          return `Mức VAT ${pendingDeactivate.target.rate}% đang được ${count} sản phẩm sử dụng. Ngừng sử dụng KHÔNG ảnh hưởng báo giá cũ, chỉ không cho chọn khi tạo sản phẩm mới. Tiếp tục?`;
        })()}
        actions={[{ label: 'Ngừng sử dụng', variant: 'primary', onClick: () => void handleConfirmDeactivate() }]}
        onClose={() => setPendingDeactivate(null)}
      />
    </div>
  );
}
