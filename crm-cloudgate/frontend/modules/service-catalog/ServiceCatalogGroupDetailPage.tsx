'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useServiceCatalog } from './use-service-catalog';
import { ServiceCatalogProductsTable, type ServiceCatalogProductsTableHandle } from './ServiceCatalogProductsTable';
import type { FlatProduct } from './catalog-form-utils';
import { Pencil } from '@/modules/crm/components/icons';
import './styles/service-catalog.css';

/** Trang chi tiet 1 NHOM san pham cu the (vd VPS Hosting, Website...) - moi,
 * thay the cho hanh vi cu ("bam vao 1 nhom" khong ton tai, ProductsTab tron
 * chung san pham cua MOI nhom vao 1 bang duy nhat). Route:
 * /all-platform/service-catalog/groups/[groupId] (xem page.tsx tuong ung).
 *
 * KHONG hardcode ten/logic rieng cho VPS/Website - hoan toan generic theo
 * `groupId` truyen vao, dung LAI y het bang san pham + drawer them/sua/xoa
 * (ServiceCatalogProductsTable.tsx, dung chung voi truoc day) qua prop
 * `fixedGroupId`.
 *
 * BUG THAT DA GAP ("header rời rạc, thiếu Sửa nhóm/+ Sản phẩm mới"): header
 * gio gon thanh 1 hang (breadcrumb + ten + badge + so san pham + Sua nhom +
 * "+ Sản phẩm mới") - nut "+ Sản phẩm mới" goi vao DUNG state noi bo cua
 * ServiceCatalogProductsTable qua ref (khong lift toan bo logic drawer ra
 * ngoai), hideAddButton de khong con 2 nut trung nhau. */
export function ServiceCatalogGroupDetailPage({ groupId }: { groupId: string }) {
  const { items, isLoaded, error, createItem, updateItem, deleteItem, refresh } = useServiceCatalog();
  const tableRef = useRef<ServiceCatalogProductsTableHandle>(null);

  const group = useMemo(
    () => items.find(item => item.itemType === 'group' && item.id === groupId),
    [items, groupId]
  );

  const products = useMemo<FlatProduct[]>(() => {
    if (!group) return [];
    return (group.children || []).map(child => ({ ...child, groupName: group.name }));
  }, [group]);

  const priceConfigCounts = useMemo(() => {
    const configured = products.filter(p => p.defaultCostPriceVnd != null).length;
    return { total: products.length, configured, unconfigured: products.length - configured };
  }, [products]);

  const [editingGroup, setEditingGroup] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editStatus, setEditStatus] = useState<'active' | 'inactive'>('active');
  const [savingGroup, setSavingGroup] = useState(false);
  const [groupError, setGroupError] = useState<string | null>(null);

  function openEditGroup() {
    if (!group) return;
    setEditName(group.name);
    setEditDescription(group.description || '');
    setEditStatus(group.status === 'inactive' ? 'inactive' : 'active');
    setGroupError(null);
    setEditingGroup(true);
  }

  async function saveGroupEdit() {
    if (!group) return;
    if (!editName.trim()) {
      setGroupError('Tên nhóm bắt buộc.');
      return;
    }
    setSavingGroup(true);
    setGroupError(null);
    try {
      await updateItem(group.id, { name: editName.trim(), description: editDescription.trim() || undefined, status: editStatus });
      setEditingGroup(false);
    } catch (err) {
      setGroupError(err instanceof Error ? err.message : 'Không lưu được thông tin nhóm.');
    } finally {
      setSavingGroup(false);
    }
  }

  return (
    <div className="sc-page">
      {error ? (
        <div className="sc-error">
          {error}{' '}
          <button type="button" className="sc-mini-link-btn" onClick={() => void refresh()}>
            Thử lại
          </button>
        </div>
      ) : null}
      {!isLoaded ? <div className="sc-loading">Đang tải...</div> : null}

      {isLoaded && !error && !group ? (
        <div className="sc-error">
          Không tìm thấy nhóm sản phẩm này (có thể đã bị xoá).{' '}
          <Link href="/all-platform/service-catalog">Quay lại danh sách nhóm</Link>
        </div>
      ) : null}

      {isLoaded && group ? (
        <>
          <div className="sc-group-header-line">
            <nav className="sc-breadcrumb" aria-label="Breadcrumb">
              <Link href="/all-platform/service-catalog">Sản phẩm & dịch vụ</Link>
              <span className="sc-breadcrumb-sep">/</span>
              <span className="sc-breadcrumb-current">{group.name}</span>
            </nav>
            <h1 className="sc-group-header-title">{group.name}</h1>
            <span className={`sc-badge ${group.status === 'inactive' ? 'sc-badge-inactive' : 'sc-badge-active'}`}>
              {group.status === 'inactive' ? 'Ngừng sử dụng' : 'Đang sử dụng'}
            </span>
            <span className="sc-group-count">{products.length} sản phẩm</span>
            <div className="sc-group-header-actions">
              <button type="button" className="sc-btn" onClick={openEditGroup}>
                <Pencil className="qc-inline-icon" /> Sửa thông tin nhóm
              </button>
              <button type="button" className="sc-btn sc-btn-primary" onClick={() => tableRef.current?.openAdd()}>
                + Sản phẩm mới
              </button>
            </div>
          </div>
          {group.description ? <p className="sc-group-desc">{group.description}</p> : null}

          {editingGroup ? (
            <div className="sc-panel">
              <strong>Sửa nhóm: {group.name}</strong>
              <div className="sc-panel-grid">
                <label className="sc-field">
                  <span>Tên nhóm</span>
                  <input value={editName} onChange={e => setEditName(e.target.value)} />
                </label>
                <label className="sc-field">
                  <span>Trạng thái</span>
                  <select value={editStatus} onChange={e => setEditStatus(e.target.value as 'active' | 'inactive')}>
                    <option value="active">Đang sử dụng</option>
                    <option value="inactive">Ngừng sử dụng</option>
                  </select>
                </label>
                <label className="sc-field" style={{ gridColumn: '1 / -1' }}>
                  <span>Mô tả</span>
                  <textarea value={editDescription} onChange={e => setEditDescription(e.target.value)} />
                </label>
              </div>
              {groupError ? <div className="sc-error">{groupError}</div> : null}
              <div className="sc-panel-actions">
                <button type="button" className="sc-btn" onClick={() => setEditingGroup(false)}>Huỷ</button>
                <button type="button" className="sc-btn sc-btn-primary" disabled={savingGroup} onClick={() => void saveGroupEdit()}>
                  {savingGroup ? 'Đang lưu...' : 'Lưu'}
                </button>
              </div>
            </div>
          ) : null}

          {/* Bo dem nho (yeu cau "Có thể thêm bộ đếm nhỏ: Tổng sản phẩm/Đã
           * cấu hình giá/Chưa cấu hình giá") - chi hien khi co du lieu gia
           * (canViewPricing suy trong chinh bang, o day suy don gian qua
           * defaultCostPriceVnd co mat tren it nhat 1 san pham). */}
          {products.some(p => p.defaultCostPriceVnd !== undefined) ? (
            <div className="sc-group-price-counters">
              <span>Tổng <strong>{priceConfigCounts.total}</strong> sản phẩm</span>
              <span>Đã cấu hình giá <strong className="sc-cell-price-ok">{priceConfigCounts.configured}</strong></span>
              <span>Chưa cấu hình giá <strong className="sc-cell-price-missing">{priceConfigCounts.unconfigured}</strong></span>
            </div>
          ) : null}

          <ServiceCatalogProductsTable
            ref={tableRef}
            products={products}
            groups={[group]}
            createItem={createItem}
            updateItem={updateItem}
            deleteItem={deleteItem}
            refresh={refresh}
            fixedGroupId={group.id}
            hideAddButton
          />
        </>
      ) : null}
    </div>
  );
}
