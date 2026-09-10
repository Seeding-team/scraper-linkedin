'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ConfirmModal } from '@/modules/crm/components/ConfirmModal';
import { ActionMenu } from '@/modules/crm/components/ActionMenu';
import { Eye, Pencil, PauseCircle, Trash2, LayoutGrid, TableIcon } from '@/modules/crm/components/icons';
import { useServiceCatalog } from './use-service-catalog';
import type { ServiceCatalogItem, ServiceCatalogItemInput } from './types';
import { emptyGroupForm, itemToForm } from './catalog-form-utils';
import './styles/service-catalog.css';
import '@/modules/crm/styles/quote-center.css';

const PAGE_SIZE = 6;

/** CHOT LAI CAU TRUC ("cấu trúc tab hiện tại đang bị ngược" - yeu cau tai
 * cau truc toan bo): trang goc "Sản phẩm & dịch vụ" GIO CHI con la danh
 * sach NHOM (truoc day la 1 trong 4 tab ngang, tron chung voi San pham/
 * Thuế & đơn vị tính/Bảng giá VPS Zone). Bam vao 1 nhom -> dieu huong that
 * sang route rieng /service-catalog/groups/[groupId]
 * (ServiceCatalogGroupDetailPage.tsx) thay vi loc tai cho nhu ProductsTab cu.
 * "Đơn vị tính & VAT" va "Bảng giá VPS Zone" gio la 2 trang RIENG, truy cap
 * qua nut o toolbar nay (menu phu), KHONG con la tab ngang hang voi danh
 * sach nhom nua.
 *
 * BUG THAT DA GAP ("trang này quá trống, bảng nhóm kéo ngang toàn màn
 * hình"): doi hien thi mac dinh tu <table> ngang sang CARD GRID (3/2/1 cot
 * theo desktop/tablet/mobile) - giu lai <table> lam che do "Xem dạng danh
 * sách" tuy chon (nut toggle canh o tim kiem), khong xoa han vi van con
 * dung tot khi can xem nhieu nhom cung luc o man rong.
 *
 * Component "Sản phẩm & dịch vụ" (bang san pham loc theo tung nhom) da
 * chuyen sang ServiceCatalogProductsTable.tsx (dung chung voi trang chi
 * tiet nhom) - file nay CHI con logic rieng cua danh sach Nhom. */
export function ServiceCatalogPage() {
  const router = useRouter();
  const { items, isLoaded, error, createItem, updateItem, deleteItem, refresh } = useServiceCatalog();
  const groups = useMemo(() => items.filter(item => item.itemType === 'group'), [items]);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [page, setPage] = useState(1);
  const [editTarget, setEditTarget] = useState<{ mode: 'add' | 'edit'; id?: string } | null>(null);
  const [form, setForm] = useState<ServiceCatalogItemInput>(emptyGroupForm());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmDeleteTarget, setConfirmDeleteTarget] = useState<ServiceCatalogItem | null>(null);

  const filteredGroups = useMemo(() => {
    const term = search.trim().toLowerCase();
    return groups.filter(group => {
      if (statusFilter && group.status !== statusFilter) return false;
      if (!term) return true;
      return group.name.toLowerCase().includes(term) || (group.description || '').toLowerCase().includes(term);
    });
  }, [groups, search, statusFilter]);

  // Pagination (yeu cau "Nếu sau này có nhiều nhóm thì grid tự xuống hàng
  // và có pagination hoặc load-more phù hợp") - reset ve trang 1 khi loc/tim
  // doi de khong bao gio "ket qua rong" do dang o trang cao hon so trang moi.
  const totalPages = Math.max(1, Math.ceil(filteredGroups.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedGroups = filteredGroups.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  function updateSearch(value: string) {
    setSearch(value);
    setPage(1);
  }
  function updateStatusFilter(value: string) {
    setStatusFilter(value);
    setPage(1);
  }

  function openAdd() {
    setEditTarget({ mode: 'add' });
    setForm(emptyGroupForm());
    setFormError(null);
  }
  function openEdit(group: ServiceCatalogItem) {
    setEditTarget({ mode: 'edit', id: group.id });
    setForm(itemToForm(group));
    setFormError(null);
  }

  async function handleSave() {
    if (!form.name.trim()) {
      setFormError('Tên nhóm bắt buộc.');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      if (editTarget?.mode === 'edit' && editTarget.id) {
        await updateItem(editTarget.id, form);
      } else {
        await createItem(form);
      }
      setEditTarget(null);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Không lưu được nhóm.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleStatus(group: ServiceCatalogItem) {
    const next = group.status === 'active' ? 'inactive' : 'active';
    try {
      await updateItem(group.id, { status: next });
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không cập nhật được trạng thái.');
    }
  }

  async function handleConfirmDelete() {
    if (!confirmDeleteTarget) return;
    try {
      await deleteItem(confirmDeleteTarget.id);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không xoá được nhóm.');
    } finally {
      setConfirmDeleteTarget(null);
    }
  }

  function groupActionItems(group: ServiceCatalogItem) {
    return [
      { key: 'view', label: 'Xem sản phẩm', icon: Eye, onSelect: () => router.push(`/all-platform/service-catalog/groups/${group.id}`) },
      { key: 'edit', label: 'Sửa', icon: Pencil, onSelect: () => openEdit(group) },
      {
        key: 'toggle',
        label: group.status === 'inactive' ? 'Kích hoạt lại' : 'Ngừng sử dụng',
        icon: PauseCircle,
        onSelect: () => void toggleStatus(group),
        group: 2,
      },
      {
        key: 'delete',
        label: 'Xoá',
        icon: Trash2,
        danger: true,
        onSelect: () => setConfirmDeleteTarget(group),
        group: 3,
      },
    ];
  }

  return (
    <div className="sc-page">
      <div className="sc-header">
        <div>
          <h1>Sản phẩm &amp; dịch vụ</h1>
          <p className="sc-header-desc">Quản lý sản phẩm theo từng nhóm dịch vụ</p>
        </div>
        <div className="sc-header-actions">
          <Link href="/all-platform/service-catalog/config" className="sc-btn">
            Cấu hình ĐVT &amp; VAT
          </Link>
          <Link href="/all-platform/service-catalog/price-book-zone" className="sc-btn">
            Bảng giá VPS Zone
          </Link>
          <button type="button" className="sc-btn sc-btn-primary" onClick={openAdd}>
            + Nhóm mới
          </button>
        </div>
      </div>

      {error ? (
        <div className="sc-error">
          {error}{' '}
          <button type="button" className="sc-mini-link-btn" onClick={() => void refresh()}>
            Thử lại
          </button>
        </div>
      ) : null}
      {!isLoaded ? (
        <div className="sc-groups-grid" aria-hidden="true">
          {[1, 2, 3].map(i => (
            <div className="sc-group-card sc-group-card--skeleton" key={i} />
          ))}
        </div>
      ) : null}

      {isLoaded ? (
        <div className="sc-tab-panel">
          <div className="sc-toolbar">
            <input
              className="sc-search"
              placeholder="Tìm theo tên nhóm, mô tả..."
              value={search}
              onChange={e => updateSearch(e.target.value)}
            />
            <select value={statusFilter} onChange={e => updateStatusFilter(e.target.value)}>
              <option value="">Tất cả trạng thái</option>
              <option value="active">Đang sử dụng</option>
              <option value="inactive">Ngừng sử dụng</option>
            </select>
            <div className="sc-view-toggle" role="group" aria-label="Chế độ xem">
              <button
                type="button"
                className={viewMode === 'grid' ? 'active' : ''}
                aria-label="Xem dạng lưới"
                title="Xem dạng lưới"
                onClick={() => setViewMode('grid')}
              >
                <LayoutGrid className="qc-inline-icon" />
              </button>
              <button
                type="button"
                className={viewMode === 'list' ? 'active' : ''}
                aria-label="Xem dạng danh sách"
                title="Xem dạng danh sách"
                onClick={() => setViewMode('list')}
              >
                <TableIcon className="qc-inline-icon" />
              </button>
            </div>
          </div>

          {editTarget ? (
            <div className="sc-panel">
              <strong>{editTarget.mode === 'add' ? 'Thêm nhóm sản phẩm' : `Sửa nhóm: ${form.name}`}</strong>
              <div className="sc-panel-grid">
                <label className="sc-field">
                  <span>Tên nhóm</span>
                  <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
                </label>
                <label className="sc-field">
                  <span>Trạng thái</span>
                  <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value as 'active' | 'inactive' })}>
                    <option value="active">Đang sử dụng</option>
                    <option value="inactive">Ngừng sử dụng</option>
                  </select>
                </label>
                <label className="sc-field" style={{ gridColumn: '1 / -1' }}>
                  <span>Mô tả</span>
                  <textarea value={form.description || ''} onChange={e => setForm({ ...form, description: e.target.value })} />
                </label>
              </div>
              {formError ? <div className="sc-error">{formError}</div> : null}
              <div className="sc-panel-actions">
                <button type="button" className="sc-btn" onClick={() => setEditTarget(null)}>
                  Huỷ
                </button>
                <button type="button" className="sc-btn sc-btn-primary" disabled={saving} onClick={handleSave}>
                  {saving ? 'Đang lưu...' : 'Lưu'}
                </button>
              </div>
            </div>
          ) : null}

          {filteredGroups.length === 0 ? (
            <div className="sc-empty">{groups.length === 0 ? 'Chưa có nhóm nào.' : 'Không có nhóm phù hợp.'}</div>
          ) : viewMode === 'grid' ? (
            <div className="sc-groups-grid">
              {pagedGroups.map(group => (
                <div className="sc-group-card" key={group.id}>
                  <Link href={`/all-platform/service-catalog/groups/${group.id}`} className="sc-group-card-link">
                    <div className="sc-group-card-icon">
                      <LayoutGrid className="qc-icon" />
                    </div>
                    <div className="sc-group-card-body">
                      <div className="sc-group-card-title-row">
                        <span className="sc-group-card-title">{group.name}</span>
                      </div>
                      {group.description ? <p className="sc-group-card-desc">{group.description}</p> : null}
                      <div className="sc-group-card-meta">
                        <span className="sc-group-card-count">{(group.children || []).length} sản phẩm</span>
                        <span className={`sc-badge ${group.status === 'inactive' ? 'sc-badge-inactive' : 'sc-badge-active'}`}>
                          {group.status === 'inactive' ? 'Ngừng sử dụng' : 'Đang sử dụng'}
                        </span>
                      </div>
                      {/* Khong co field updatedAt tren ServiceCatalogItem
                       * (chi co o 1 interface khac, KHONG phai cua nhom) -
                       * KHONG bia du lieu "Cập nhật X trước" gia, bo han
                       * dong nay thay vi hardcode 1 gia tri khong that. */}
                    </div>
                    <span className="sc-group-card-chevron" aria-hidden="true">›</span>
                  </Link>
                  <div className="sc-group-card-menu" onClick={e => e.stopPropagation()}>
                    <ActionMenu items={groupActionItems(group)} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="sc-table-wrap">
              <table className="sc-table">
                <thead>
                  <tr>
                    <th>Tên nhóm</th>
                    <th>Số sản phẩm</th>
                    <th>Trạng thái</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {pagedGroups.map(group => (
                    <tr key={group.id} className="sc-row-clickable">
                      <td>
                        <Link href={`/all-platform/service-catalog/groups/${group.id}`} className="sc-row-link">
                          <span className="sc-cell-title-text">{group.name}</span>
                          {group.description ? <span className="sc-cell-name-desc">{group.description}</span> : null}
                        </Link>
                      </td>
                      <td>
                        <Link href={`/all-platform/service-catalog/groups/${group.id}`} className="sc-row-link">
                          {(group.children || []).length} sản phẩm
                        </Link>
                      </td>
                      <td>
                        <Link href={`/all-platform/service-catalog/groups/${group.id}`} className="sc-row-link">
                          <span className={`sc-badge ${group.status === 'inactive' ? 'sc-badge-inactive' : 'sc-badge-active'}`}>
                            {group.status === 'inactive' ? 'Ngừng sử dụng' : 'Đang sử dụng'}
                          </span>
                        </Link>
                      </td>
                      <td className="sc-row-actions">
                        <ActionMenu items={groupActionItems(group)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {filteredGroups.length > 0 ? (
            <div className="qc-pagination">
              <span className="qc-pagination-summary">Hiển thị {filteredGroups.length} nhóm sản phẩm</span>
              {totalPages > 1 ? (
                <div className="qc-pagination-controls">
                  <button type="button" disabled={safePage <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>‹</button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map(n => (
                    <button type="button" key={n} className={n === safePage ? 'active' : ''} onClick={() => setPage(n)}>
                      {n}
                    </button>
                  ))}
                  <button type="button" disabled={safePage >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>›</button>
                </div>
              ) : null}
            </div>
          ) : null}

          <ConfirmModal
            open={Boolean(confirmDeleteTarget)}
            title="Xoá nhóm sản phẩm"
            message={confirmDeleteTarget ? `Xoá nhóm "${confirmDeleteTarget.name}"?` : ''}
            actions={[{ label: 'Xoá', variant: 'primary', onClick: () => void handleConfirmDelete() }]}
            onClose={() => setConfirmDeleteTarget(null)}
          />
        </div>
      ) : null}
    </div>
  );
}
