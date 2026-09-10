'use client';

import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ConfirmModal } from '@/modules/crm/components/ConfirmModal';
import { ActionMenu } from '@/modules/crm/components/ActionMenu';
import { Eye, Pencil, PauseCircle, Trash2, X } from '@/modules/crm/components/icons';
import { serviceCatalogRepository } from './repositories/ServiceCatalogRepository';
import type { ServiceCatalogItem, ServiceCatalogItemInput, ServiceCatalogPricingInputMode } from './types';
import {
  emptyProductForm,
  itemToForm,
  formatVnd,
  formatVndOrMissing,
  formatMarkupOrMissing,
  computeCustomerFromMarkup,
  computeMarkupFromCustomer,
  parseNullableNumber,
  formatSkuName,
  type FlatProduct,
} from './catalog-form-utils';

type PriceFilter = '' | 'configured' | 'unconfigured';

/** Bang "Sản phẩm & dịch vụ" (danh sách + drawer thêm/sửa/xoá/bộ giá) - tach
 * rieng ra khoi ServiceCatalogPage.tsx cu (truoc day la 1 tab noi bo) de
 * DUNG CHUNG cho ca 2 noi: trang goc (chua dung nua sau khi tai cau truc
 * thanh danh sach Nhom) VA trang chi tiet 1 nhom cu the
 * (ServiceCatalogGroupDetailPage.tsx, moi) - khong hardcode ten nhom
 * VPS/Website, chi nhan `fixedGroupId` tuy chon de loc/khoa dung 1 nhom.
 *
 * `fixedGroupId` co gia tri (trang chi tiet nhom):
 * - An cot "Nhóm" + bo loc nhom (da biet ro dang xem nhom nao qua breadcrumb).
 * - San pham moi tao mac dinh thuoc dung nhom nay (khong can chon lai).
 * `fixedGroupId` undefined (dung o cho khac neu can sau nay): giu nguyen
 * hanh vi cu, hien du cot/bo loc nhom. */
/** Cho phep trang cha (vd ServiceCatalogGroupDetailPage) mo drawer "+ Sản
 * phẩm mới" tu 1 nut o HEADER RIENG cua trang (yeu cau "Nút '+ Sản phẩm
 * mới'" nam tren header 1 hang, khong con nam trong toolbar cua bang nay
 * nua o trang chi tiet nhom) - `openAdd()` van la state NOI BO cua component
 * nay (drawer/form), CHI expose 1 ham goi vao qua ref, khong lift toan bo
 * state ra ngoai. */
export type ServiceCatalogProductsTableHandle = { openAdd: () => void };

export const ServiceCatalogProductsTable = forwardRef<ServiceCatalogProductsTableHandle, {
  products: FlatProduct[];
  groups: ServiceCatalogItem[];
  createItem: (input: ServiceCatalogItemInput) => Promise<ServiceCatalogItem>;
  updateItem: (id: string, input: Partial<ServiceCatalogItemInput>) => Promise<unknown>;
  deleteItem: (id: string) => Promise<unknown>;
  refresh: () => Promise<void>;
  fixedGroupId?: string;
  /** An nut "+ Sản phẩm mới" noi bo cua toolbar bang nay - dung khi trang
   * cha da co nut rieng o header va goi qua ref (tranh 2 nut trung nhau). */
  hideAddButton?: boolean;
}>(function ServiceCatalogProductsTable({
  products,
  groups,
  createItem,
  updateItem,
  deleteItem,
  refresh,
  fixedGroupId,
  hideAddButton,
}, ref) {
  const [search, setSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [priceFilter, setPriceFilter] = useState<PriceFilter>('');
  const [editTarget, setEditTarget] = useState<{ mode: 'add' | 'edit'; id?: string } | null>(null);
  const [form, setForm] = useState<ServiceCatalogItemInput>(emptyProductForm(fixedGroupId));
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmDeleteTarget, setConfirmDeleteTarget] = useState<FlatProduct | null>(null);

  // Khoa cuon trang ben ngoai khi Drawer "Chi tiết sản phẩm" dang mo - dung
  // pattern da co san o QuoteWorkspaceModal (document.body.style.overflow),
  // tranh nguoi dung cuon nham danh sach ben duoi trong khi drawer dang mo.
  useEffect(() => {
    if (!editTarget) return;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [editTarget]);

  // Bo gia mac dinh (migration 107) - field CHI co mat trong response neu
  // nguoi dung hien tai co quyen quan tri gia (xem _resolve_catalog_pricing_visibility
  // o backend, xoa han key neu khong du quyen thay vi tra null gia). Suy
  // quyen tu SU HIEN DIEN cua key tren du lieu da tai, khong doan theo role
  // FE rieng - dong bo tuyet doi voi quyet dinh cua backend.
  const canViewPricing = products.length > 0 && products.some(p => p.defaultCostPriceVnd !== undefined);

  // Bo gia (Gia von/Markup/Gia khach) cua dong dang sua - tach rieng khoi
  // `form` (cac field con lai cua service_catalog_items) vi day la 1 bang
  // rieng (service_catalog_item_pricing), luu qua endpoint /pricing rieng,
  // CHI quan ly duoc dong "mac dinh chung" (issuerCompanyId=null) trong
  // drawer nay - dung mockup (khong co bo chon Don vi phat hanh o day).
  const [pricingCost, setPricingCost] = useState('');
  const [pricingMarkup, setPricingMarkup] = useState('');
  const [pricingCustomer, setPricingCustomer] = useState('');
  const [pricingMode, setPricingMode] = useState<ServiceCatalogPricingInputMode>('markup');
  const [pricingSaving, setPricingSaving] = useState(false);
  const [pricingError, setPricingError] = useState<string | null>(null);
  const [pricingSavedAt, setPricingSavedAt] = useState<number | null>(null);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return products.filter(product => {
      if (!fixedGroupId && groupFilter && product.parentId !== groupFilter) return false;
      if (statusFilter && product.status !== statusFilter) return false;
      if (priceFilter === 'configured' && product.defaultCostPriceVnd == null) return false;
      if (priceFilter === 'unconfigured' && product.defaultCostPriceVnd != null) return false;
      if (!term) return true;
      return (
        product.name.toLowerCase().includes(term) ||
        (product.sku || '').toLowerCase().includes(term) ||
        (product.description || '').toLowerCase().includes(term)
      );
    });
  }, [products, search, groupFilter, statusFilter, priceFilter, fixedGroupId]);

  function resetPricingFields(product?: FlatProduct) {
    setPricingCost(product?.defaultCostPriceVnd != null ? String(product.defaultCostPriceVnd) : '');
    setPricingMarkup(product?.defaultMarkupPercent != null ? String(product.defaultMarkupPercent) : '');
    setPricingCustomer(product?.defaultCustomerPriceVnd != null ? String(product.defaultCustomerPriceVnd) : '');
    setPricingMode('markup');
    setPricingError(null);
    setPricingSavedAt(null);
  }

  function openAdd() {
    setEditTarget({ mode: 'add' });
    setForm(emptyProductForm(fixedGroupId || groups[0]?.id));
    setFormError(null);
    resetPricingFields();
  }
  useImperativeHandle(ref, () => ({ openAdd }));
  function openEdit(product: FlatProduct) {
    setEditTarget({ mode: 'edit', id: product.id });
    setForm(itemToForm(product));
    setFormError(null);
    resetPricingFields(product);
  }
  function closeDrawer() {
    setEditTarget(null);
  }

  async function handleSave() {
    if (!form.name.trim()) {
      setFormError('Tên sản phẩm bắt buộc.');
      return;
    }
    if (!form.parentId) {
      setFormError('Vui lòng chọn nhóm sản phẩm.');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      if (editTarget?.mode === 'edit' && editTarget.id) {
        await updateItem(editTarget.id, form);
      } else {
        const created = await createItem(form);
        // Sau khi tao xong san pham MOI, chuyen drawer sang che do "edit" NGAY
        // (khong dong lai) de nguoi dung cau hinh Bo gia mac dinh tiep - bang
        // service_catalog_item_pricing can co item_id THAT (FK), chua the
        // luu gia luc con o che do "add" (item chua ton tai).
        setEditTarget({ mode: 'edit', id: created.id });
        resetPricingFields();
        return;
      }
      setEditTarget(null);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Không lưu được sản phẩm.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleStatus(product: ServiceCatalogItem) {
    const next = product.status === 'active' ? 'inactive' : 'active';
    try {
      await updateItem(product.id, { status: next });
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không cập nhật được trạng thái.');
    }
  }

  async function handleConfirmDelete() {
    if (!confirmDeleteTarget) return;
    try {
      await deleteItem(confirmDeleteTarget.id);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không xoá được sản phẩm.');
    } finally {
      setConfirmDeleteTarget(null);
    }
  }

  // Preview tuc thi phia FE - CHI de UX muot (nguoi dung thay ngay so du
  // kien khi go). Gia tri LUU THAT luon lay tu response backend sau khi goi
  // upsertPricing() (BE tinh lai bang Decimal, xem supabase_service_catalog_service.py)
  // - KHONG dua rieng vao so preview nay de dam bao tinh dung (yeu cau audit
  // review lan 2).
  const costPreview = parseNullableNumber(pricingCost);
  const markupPreview = parseNullableNumber(pricingMarkup);
  const customerPreview = parseNullableNumber(pricingCustomer);
  const previewCustomer = pricingMode === 'markup' ? computeCustomerFromMarkup(costPreview, markupPreview) : customerPreview;
  const previewMarkup = pricingMode === 'customer_price' ? computeMarkupFromCustomer(costPreview, customerPreview) : markupPreview;

  function handleCostChange(raw: string) {
    setPricingCost(raw);
  }
  function handleMarkupChange(raw: string) {
    setPricingMode('markup');
    setPricingMarkup(raw);
  }
  function handleCustomerChange(raw: string) {
    setPricingMode('customer_price');
    setPricingCustomer(raw);
  }

  async function handleSavePricing() {
    if (!editTarget?.id) return;
    setPricingSaving(true);
    setPricingError(null);
    try {
      const saved = await serviceCatalogRepository.upsertPricing(editTarget.id, {
        issuerCompanyId: null,
        defaultCostPriceVnd: costPreview,
        defaultMarkupPercent: pricingMode === 'markup' ? markupPreview : previewMarkup,
        defaultCustomerPriceVnd: pricingMode === 'customer_price' ? customerPreview : previewCustomer,
        pricingInputMode: pricingMode,
      });
      // Ghi de lai bang DUNG gia tri backend da tinh (co the khac so preview
      // FE neu lam tron khac nhau) - khong giu so preview cu.
      setPricingCost(saved.defaultCostPriceVnd != null ? String(saved.defaultCostPriceVnd) : '');
      setPricingMarkup(saved.defaultMarkupPercent != null ? String(saved.defaultMarkupPercent) : '');
      setPricingCustomer(saved.defaultCustomerPriceVnd != null ? String(saved.defaultCustomerPriceVnd) : '');
      setPricingSavedAt(Date.now());
      await refresh();
    } catch (err) {
      setPricingError(err instanceof Error ? err.message : 'Không lưu được bộ giá.');
    } finally {
      setPricingSaving(false);
    }
  }

  const colSpan = canViewPricing ? (fixedGroupId ? 8 : 9) : (fixedGroupId ? 6 : 7);

  return (
    <div className="sc-tab-panel">
      <div className="sc-toolbar">
        <input
          className="sc-search"
          placeholder="Tìm theo mã, tên, mô tả..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {fixedGroupId ? null : (
          <select value={groupFilter} onChange={e => setGroupFilter(e.target.value)}>
            <option value="">Tất cả nhóm</option>
            {groups.map(group => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        )}
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">Tất cả trạng thái</option>
          <option value="active">Đang kinh doanh</option>
          <option value="inactive">Ngừng kinh doanh</option>
        </select>
        {canViewPricing ? (
          <select value={priceFilter} onChange={e => setPriceFilter(e.target.value as PriceFilter)}>
            <option value="">Đã/chưa cấu hình giá</option>
            <option value="configured">Đã cấu hình giá</option>
            <option value="unconfigured">Chưa cấu hình giá</option>
          </select>
        ) : null}
        {hideAddButton ? null : (
          <button type="button" className="sc-btn sc-btn-primary" onClick={openAdd}>
            + Sản phẩm mới
          </button>
        )}
      </div>

      {editTarget ? createPortal(
        // BUG THAT DA GAP (test Playwright phat hien): render Drawer NGAY
        // TAI CHO (khong qua Portal) bi 1 to tien nao do cua layout trang
        // (sidebar wrapper) gioi han - `position:fixed` cua backdrop KHONG
        // con bam theo dung VIEWPORT THAT nua (chi phu vung noi dung chinh,
        // khong che duoc sidebar, va nut Dong bi day ra ngoai vung nhin
        // thay). Portal thang ra document.body - dung PATTERN da verify
        // dung cua SearchableSelect/ActionMenu - de position:fixed luon
        // tinh theo viewport that, bat ke component nay dang nam sau bao
        // nhieu lop layout nao.
        <div className="sc-drawer-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) closeDrawer(); }}>
          <div className="sc-drawer">
            <div className="sc-drawer-head">
              <div>
                <h2>{editTarget.mode === 'add' ? 'Thêm sản phẩm mới' : 'Chi tiết sản phẩm'}</h2>
                <p>Xem và chỉnh sửa thông tin sản phẩm</p>
              </div>
              <button type="button" className="sc-icon-btn" aria-label="Đóng" onClick={closeDrawer}>
                <X className="qc-inline-icon" />
              </button>
            </div>
            <div className="sc-drawer-body">
              <p className="sc-drawer-section-title">Thông tin sản phẩm</p>
              <div className="sc-panel-grid">
                <label className="sc-field">
                  <span>Mã sản phẩm (SKU)</span>
                  <input value={form.sku || ''} onChange={e => setForm({ ...form, sku: e.target.value })} />
                </label>
                <label className="sc-field">
                  <span>Tên sản phẩm *</span>
                  <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
                </label>
                {fixedGroupId ? null : (
                  <label className="sc-field">
                    <span>Nhóm sản phẩm *</span>
                    <select value={form.parentId || ''} onChange={e => setForm({ ...form, parentId: e.target.value })}>
                      <option value="">-- Chọn nhóm --</option>
                      {groups.map(group => (
                        <option key={group.id} value={group.id}>
                          {group.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="sc-field">
                  <span>Đơn vị tính (ĐVT) *</span>
                  <input value={form.unit || ''} onChange={e => setForm({ ...form, unit: e.target.value })} />
                </label>
                <label className="sc-field">
                  <span>VAT *</span>
                  <input
                    type="number"
                    value={form.defaultVatRate ?? 0}
                    onChange={e => setForm({ ...form, defaultVatRate: Number(e.target.value) })}
                  />
                </label>
                <label className="sc-field">
                  <span>Đơn giá Sale (VND)</span>
                  <input
                    type="number"
                    value={form.defaultUnitPriceVnd ?? 0}
                    onChange={e => setForm({ ...form, defaultUnitPriceVnd: Number(e.target.value) })}
                  />
                </label>
                <label className="sc-field">
                  <span>Giảm giá mặc định (%)</span>
                  <input
                    type="number"
                    value={form.defaultDiscountPercent ?? 0}
                    onChange={e => setForm({ ...form, defaultDiscountPercent: Number(e.target.value) })}
                  />
                </label>
                <label className="sc-field">
                  <span>List price USD</span>
                  <input
                    type="number"
                    value={form.listPriceUsd ?? ''}
                    onChange={e => setForm({ ...form, listPriceUsd: e.target.value === '' ? undefined : Number(e.target.value) })}
                  />
                </label>
                <label className="sc-field">
                  <span>Unit price USD</span>
                  <input
                    type="number"
                    value={form.unitPriceUsd ?? ''}
                    onChange={e => setForm({ ...form, unitPriceUsd: e.target.value === '' ? undefined : Number(e.target.value) })}
                  />
                </label>
                <label className="sc-field">
                  <span>Trạng thái</span>
                  <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value as 'active' | 'inactive' })}>
                    <option value="active">Đang kinh doanh</option>
                    <option value="inactive">Ngừng kinh doanh</option>
                  </select>
                </label>
                <label className="sc-field" style={{ gridColumn: '1 / -1' }}>
                  <span>Mô tả</span>
                  <textarea value={form.description || ''} onChange={e => setForm({ ...form, description: e.target.value })} />
                </label>
                <label className="sc-field" style={{ gridColumn: '1 / -1' }}>
                  <span>Ghi chú</span>
                  <textarea value={form.note || ''} onChange={e => setForm({ ...form, note: e.target.value })} />
                </label>
              </div>
              {formError ? <div className="sc-error">{formError}</div> : null}

              {editTarget.mode === 'add' ? (
                <p className="sc-drawer-section-hint">Lưu sản phẩm trước để cấu hình Bộ giá mặc định.</p>
              ) : canViewPricing ? (
                <>
                  <p className="sc-drawer-section-title">Giá mặc định</p>
                  <p className="sc-drawer-section-hint">
                    Bộ giá trị mặc định được lưu tại đây để tự động điền khi tạo báo giá.
                  </p>
                  <div className="sc-pricing-grid">
                    <label className="sc-field">
                      <span>Giá vốn/ĐV *</span>
                      <input type="number" value={pricingCost} onChange={e => handleCostChange(e.target.value)} />
                    </label>
                    <label className="sc-field">
                      <span>Markup mặc định *</span>
                      <input
                        type="number"
                        value={pricingMode === 'markup' ? pricingMarkup : (previewMarkup ?? '')}
                        onChange={e => handleMarkupChange(e.target.value)}
                      />
                    </label>
                    <label className="sc-field">
                      <span>Giá khách/ĐV *</span>
                      <input
                        type="number"
                        value={pricingMode === 'customer_price' ? pricingCustomer : (previewCustomer ?? '')}
                        onChange={e => handleCustomerChange(e.target.value)}
                      />
                    </label>
                  </div>
                  <p className="sc-drawer-section-hint">Thay đổi Markup sẽ tự tính lại Giá khách (và ngược lại).</p>
                  {pricingError ? <div className="sc-error">{pricingError}</div> : null}
                  {pricingSavedAt ? <div className="sc-notice">Đã lưu bộ giá.</div> : null}
                  <div className="sc-panel-actions">
                    <button type="button" className="sc-btn sc-btn-primary" disabled={pricingSaving} onClick={() => void handleSavePricing()}>
                      {pricingSaving ? 'Đang lưu...' : 'Lưu bộ giá'}
                    </button>
                  </div>

                  <p className="sc-drawer-section-title">Hiển thị khi chọn danh mục</p>
                  <div className="sc-pricing-preview">
                    <div className="sc-pricing-preview-card">
                      <strong>{form.name || 'Sản phẩm mới'}</strong>
                      <span className="sc-row-sub">
                        {[form.sku, form.unit].filter(Boolean).join(' · ') || undefined}
                      </span>
                      <div className="sc-pricing-preview-row">
                        <span>Giá vốn/ĐV</span>
                        <span>{formatVndOrMissing(costPreview)}</span>
                      </div>
                      <div className="sc-pricing-preview-row">
                        <span>Markup</span>
                        <span>{formatMarkupOrMissing(previewMarkup)}</span>
                      </div>
                      <div className="sc-pricing-preview-row">
                        <span>Giá khách/ĐV</span>
                        <span>{formatVndOrMissing(previewCustomer)}</span>
                      </div>
                    </div>
                  </div>
                </>
              ) : null}
            </div>
            <div className="sc-drawer-footer">
              <button type="button" className="sc-btn" onClick={closeDrawer}>
                Huỷ
              </button>
              <button type="button" className="sc-btn sc-btn-primary" disabled={saving} onClick={handleSave}>
                {saving ? 'Đang lưu...' : 'Lưu thay đổi'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      ) : null}

      <div className="sc-table-wrap">
        <table className="sc-table">
          <thead>
            <tr>
              <th>Mã/Sản phẩm</th>
              {fixedGroupId ? null : <th>Nhóm</th>}
              <th>ĐVT</th>
              {canViewPricing ? (
                <>
                  <th>Giá vốn/ĐV</th>
                  <th>Markup mặc định</th>
                  <th>Giá khách/ĐV</th>
                </>
              ) : (
                <th>Đơn giá Sale</th>
              )}
              <th>VAT</th>
              <th>Trạng thái</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={colSpan} className="sc-empty">
                  Không có sản phẩm phù hợp.
                </td>
              </tr>
            ) : (
              filtered.map(product => (
                  <tr key={product.id}>
                    <td>
                      <div className="sc-cell-title">
                        <div className="sc-cell-name-block">
                          <span className="sc-cell-title-text" title={formatSkuName(product.sku, product.name)}>
                            {formatSkuName(product.sku, product.name)}
                          </span>
                          {product.description ? (
                            <span className="sc-cell-name-desc" title={product.description}>{product.description}</span>
                          ) : null}
                        </div>
                        {product.itemType === 'bundle' ? <span className="sc-badge sc-badge-bundle">Gói</span> : null}
                      </div>
                    </td>
                    {fixedGroupId ? null : <td>{product.groupName}</td>}
                    <td>{product.unit || '—'}</td>
                    {canViewPricing ? (
                      <>
                        <td className={product.defaultCostPriceVnd == null ? 'sc-cell-price-missing' : undefined}>
                          {formatVndOrMissing(product.defaultCostPriceVnd)}
                        </td>
                        <td className={product.defaultMarkupPercent == null ? 'sc-cell-price-missing' : undefined}>
                          {formatMarkupOrMissing(product.defaultMarkupPercent)}
                        </td>
                        <td>{formatVndOrMissing(product.defaultCustomerPriceVnd)}</td>
                      </>
                    ) : (
                      <td>{formatVnd(product.defaultUnitPriceVnd)}</td>
                    )}
                    <td>{product.defaultVatRate ? `${product.defaultVatRate}%` : '—'}</td>
                    <td>
                      <span className={`sc-badge ${product.status === 'inactive' ? 'sc-badge-inactive' : 'sc-badge-active'}`}>
                        {product.status === 'inactive' ? 'Ngừng kinh doanh' : 'Đang kinh doanh'}
                      </span>
                    </td>
                    <td className="sc-row-actions">
                      <ActionMenu
                        items={[
                          { key: 'view', label: 'Xem chi tiết', icon: Eye, onSelect: () => openEdit(product) },
                          { key: 'edit', label: 'Sửa', icon: Pencil, onSelect: () => openEdit(product) },
                          {
                            key: 'toggle',
                            label: product.status === 'inactive' ? 'Kích hoạt lại' : 'Ngưng kinh doanh',
                            icon: PauseCircle,
                            onSelect: () => void toggleStatus(product),
                            group: 2,
                          },
                          {
                            key: 'delete',
                            label: 'Xoá',
                            icon: Trash2,
                            danger: true,
                            onSelect: () => setConfirmDeleteTarget(product),
                            group: 3,
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

      <div className="sc-product-cards">
        {filtered.map(product => (
          <div className="sc-product-card" key={product.id}>
            <div className="sc-cell-title">
              <span className="sc-product-card-title">{formatSkuName(product.sku, product.name)}</span>
              {product.itemType === 'bundle' ? <span className="sc-badge sc-badge-bundle">Gói</span> : null}
            </div>
            {product.description ? <div className="sc-product-card-desc">{product.description}</div> : null}
            <div className="sc-row-sub">{fixedGroupId ? (product.unit || '—') : `${product.groupName} · ${product.unit || '—'}`}</div>
            <div className="sc-product-card-prices">
              {canViewPricing ? (
                <>
                  <div className="sc-product-card-price-row"><span>Giá vốn/ĐV</span><span>{formatVndOrMissing(product.defaultCostPriceVnd)}</span></div>
                  <div className="sc-product-card-price-row"><span>Markup</span><span>{formatMarkupOrMissing(product.defaultMarkupPercent)}</span></div>
                  <div className="sc-product-card-price-row"><span>Giá khách/ĐV</span><span>{formatVndOrMissing(product.defaultCustomerPriceVnd)}</span></div>
                </>
              ) : (
                <div className="sc-product-card-price-row"><span>Đơn giá Sale</span><span>{formatVnd(product.defaultUnitPriceVnd)}</span></div>
              )}
            </div>
            <span className={`sc-badge ${product.status === 'inactive' ? 'sc-badge-inactive' : 'sc-badge-active'}`} style={{ alignSelf: 'flex-start' }}>
              {product.status === 'inactive' ? 'Ngừng kinh doanh' : 'Đang kinh doanh'}
            </span>
            <div className="sc-pb-card-actions">
              <button type="button" className="sc-btn" onClick={() => openEdit(product)}>Xem/Sửa</button>
              <button type="button" className="sc-btn" onClick={() => void toggleStatus(product)}>
                {product.status === 'inactive' ? 'Kích hoạt lại' : 'Ngưng kinh doanh'}
              </button>
              <button type="button" className="sc-btn-danger" onClick={() => setConfirmDeleteTarget(product)}>Xoá</button>
            </div>
          </div>
        ))}
      </div>

      <ConfirmModal
        open={Boolean(confirmDeleteTarget)}
        title="Xoá sản phẩm"
        message={confirmDeleteTarget ? `Xoá "${confirmDeleteTarget.name}"?` : ''}
        actions={[{ label: 'Xoá', variant: 'primary', onClick: () => void handleConfirmDelete() }]}
        onClose={() => setConfirmDeleteTarget(null)}
      />
    </div>
  );
});
