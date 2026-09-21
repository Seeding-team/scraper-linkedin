'use client';

import { Fragment, forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import { ConfirmModal } from '@/modules/crm/components/ConfirmModal';
import { Pencil, PauseCircle, RotateCcw, Trash2 } from '@/modules/crm/components/icons';
import { QuickAddProductModal } from './QuickAddProductModal';
import type { BundleComponentLine, ServiceCatalogItem, ServiceCatalogItemInput } from './types';
import {
  formatVnd,
  formatVndOrMissing,
  formatSkuName,
  type FlatProduct,
} from './catalog-form-utils';
import { customerPriceFromTargetGrossMargin } from './pricing-math';

type PriceFilter = '' | 'configured' | 'unconfigured';

type BundleComponentPresentation =
  | { type: 'component'; component: BundleComponentLine }
  | { type: 'pool'; key: string; name: string; quota: string; components: BundleComponentLine[] };

function formatQuotaPoolName(poolKey?: string | null, poolName?: string | null): string {
  const normalizedKey = (poolKey || '').toLowerCase();
  const normalizedName = (poolName || '').toLowerCase();
  if (normalizedKey.includes('channel') || normalizedName.includes('channel')) {
    return 'Kênh kết nối';
  }
  return poolName || 'Nhóm quota';
}

function firstPositiveNumber(...values: Array<number | null | undefined>): number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

function resolvedCustomerPrice(product: FlatProduct): number | null {
  const configured = firstPositiveNumber(
    product.defaultCustomerPriceVnd,
    product.monthlyPriceVnd,
    product.annualCommitMonthlyPriceVnd,
    product.defaultUnitPriceVnd
  );
  if (configured != null) return configured;
  if (
    product.defaultCostPriceVnd != null &&
    product.defaultMarkupPercent != null &&
    Number.isFinite(product.defaultCostPriceVnd) &&
    Number.isFinite(product.defaultMarkupPercent)
  ) {
    return customerPriceFromTargetGrossMargin(product.defaultCostPriceVnd, product.defaultMarkupPercent);
  }
  return product.defaultCustomerPriceVnd ?? null;
}

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
export type ServiceCatalogProductsTableHandle = { openAdd: () => void; openEditById: (id: string) => void };

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
  updateItem,
  deleteItem,
  refresh,
  fixedGroupId,
  hideAddButton,
}, ref) {
  const [search, setSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');
  const [priceFilter, setPriceFilter] = useState<PriceFilter>('');
  const [confirmDeleteTarget, setConfirmDeleteTarget] = useState<FlatProduct | null>(null);
  const [activeCatalogTab, setActiveCatalogTab] = useState<'standalone' | 'bundle'>('standalone');
  const [expandedBundles, setExpandedBundles] = useState<Set<string>>(new Set());
  const [expandedQuotaPools, setExpandedQuotaPools] = useState<Set<string>>(new Set());
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddEditingItem, setQuickAddEditingItem] = useState<FlatProduct | null>(null);

  // Khoa cuon trang ben ngoai khi QuickAddProductModal dang mo - dung
  // pattern da co san o QuoteWorkspaceModal (document.body.style.overflow),
  // tranh nguoi dung cuon nham danh sach ben duoi trong khi drawer dang mo.
  useEffect(() => {
    if (!quickAddOpen) return;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [quickAddOpen]);

  // Bo gia mac dinh (migration 107) - field CHI co mat trong response neu
  // nguoi dung hien tai co quyen quan tri gia (xem _resolve_catalog_pricing_visibility
  // o backend, xoa han key neu khong du quyen thay vi tra null gia). Suy
  // quyen tu SU HIEN DIEN cua key tren du lieu da tai, khong doan theo role
  // FE rieng - dong bo tuyet doi voi quyet dinh cua backend.
  const canViewPricing = products.length > 0 && products.some(p => p.defaultCostPriceVnd !== undefined);

  const standaloneProducts = useMemo(() => products.filter(product => product.itemType !== 'bundle'), [products]);
  const bundleProducts = useMemo(() => products.filter(product => product.itemType === 'bundle'), [products]);
  const productsById = useMemo(() => new Map(products.map(product => [product.id, product])), [products]);
  const hasBundles = bundleProducts.length > 0;

  useEffect(() => {
    if (activeCatalogTab === 'bundle' && !hasBundles) setActiveCatalogTab('standalone');
    if (activeCatalogTab === 'standalone' && standaloneProducts.length === 0 && hasBundles) setActiveCatalogTab('bundle');
  }, [activeCatalogTab, hasBundles, standaloneProducts.length]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const sourceProducts = activeCatalogTab === 'bundle' ? bundleProducts : standaloneProducts;
    return sourceProducts.filter(product => {
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
  }, [activeCatalogTab, bundleProducts, standaloneProducts, search, groupFilter, statusFilter, priceFilter, fixedGroupId]);

  // Create/Edit deu di qua QuickAddProductModal de giu 1 source of truth cho
  // product form, bundle mode va nested-create component.
  const openAdd = useCallback(() => {
    setQuickAddEditingItem(null);
    setQuickAddOpen(true);
  }, []);
  const openEdit = useCallback((product: FlatProduct) => {
    setQuickAddEditingItem(product);
    setQuickAddOpen(true);
  }, []);
  const openEditById = useCallback((id: string) => {
    const product = products.find(item => item.id === id);
    if (product) openEdit(product);
  }, [openEdit, products]);
  useImperativeHandle(ref, () => ({ openAdd, openEditById }), [openAdd, openEditById]);
  async function toggleStatus(product: ServiceCatalogItem) {
    const next = product.status === 'active' ? 'inactive' : 'active';
    try {
      await updateItem(product.id, { status: next });
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không cập nhật được trạng thái.');
    }
  }

  // BUG THAT DA GAP ("Sản phẩm đã được tham chiếu mà vẫn xóa được, xóa xong
  // bị lỗi"): backend (delete_service_catalog_item) da co san co che bao ve
  // dung - sản phẩm dang duoc 1 bao gia tham chieu (quote_items) se KHONG bi
  // hard-delete, chi chuyen status sang 'inactive' va tra ve HTTP 200 voi
  // {deleted:false, deactivated:true} (khong throw loi). TRUOC DAY code o day
  // chi bat loi THROW (vd nhom con con/dang dung trong goi) va IM LANG hoan
  // toan voi truong hop deactivate - modal dong lai y het nhu xoa thanh cong
  // that. Vi bang mac dinh loc status='active', san pham vua bi an mat khoi
  // danh sach (du van con trong tong so "Tổng X sản phẩm" khong loc theo
  // status) - nguoi dung tuong nham la bug/mat du lieu. Them thong bao ro
  // rang cho dung truong hop nay.
  async function handleConfirmDelete() {
    if (!confirmDeleteTarget) return;
    try {
      const result = await deleteItem(confirmDeleteTarget.id);
      if ((result as { deactivated?: boolean } | undefined)?.deactivated) {
        window.alert(
          `Sản phẩm "${confirmDeleteTarget.name}" đang được tham chiếu trong (các) báo giá đã tạo nên không thể xóa hẳn - hệ thống đã tự chuyển sang trạng thái "Ngừng kinh doanh" thay vì xóa. Đổi bộ lọc trạng thái để xem lại sản phẩm này.`
        );
      }
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Không xoá được sản phẩm.');
    } finally {
      setConfirmDeleteTarget(null);
    }
  }

  function toggleBundleExpanded(id: string) {
    setExpandedBundles(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleQuotaPoolExpanded(bundleId: string, poolKey: string) {
    const stateKey = `${bundleId}:${poolKey}`;
    setExpandedQuotaPools(prev => {
      const next = new Set(prev);
      if (next.has(stateKey)) next.delete(stateKey);
      else next.add(stateKey);
      return next;
    });
  }

  function renderRowActions(product: FlatProduct) {
    return (
      <div className="sc-inline-actions">
        <button type="button" className="sc-icon-btn" title="Sửa" aria-label="Sửa" onClick={() => openEdit(product)}>
          <Pencil className="qc-inline-icon" />
        </button>
        <button
          type="button"
          className="sc-icon-btn"
          title={product.status === 'inactive' ? 'Kích hoạt lại' : 'Ngừng kinh doanh'}
          aria-label={product.status === 'inactive' ? 'Kích hoạt lại' : 'Ngừng kinh doanh'}
          onClick={() => void toggleStatus(product)}
        >
          {product.status === 'inactive' ? <RotateCcw className="qc-inline-icon" /> : <PauseCircle className="qc-inline-icon" />}
        </button>
        <button type="button" className="sc-icon-btn sc-icon-btn-danger" title="Xóa" aria-label="Xóa" onClick={() => setConfirmDeleteTarget(product)}>
          <Trash2 className="qc-inline-icon" />
        </button>
      </div>
    );
  }

  function displayBundleComponents(product: FlatProduct): BundleComponentPresentation[] {
    const rows: BundleComponentPresentation[] = [];
    const pools = new Map<string, BundleComponentPresentation & { type: 'pool' }>();
    for (const component of product.components || []) {
      const poolKey = component.quotaPoolKey?.trim();
      if (!poolKey) {
        rows.push({ type: 'component', component });
        continue;
      }
      let pool = pools.get(poolKey);
      if (!pool) {
        pool = {
          type: 'pool',
          key: poolKey,
          name: formatQuotaPoolName(poolKey, component.quotaPoolName),
          quota: component.quotaPoolQuota || component.quota || component.displayText || '—',
          components: [],
        };
        pools.set(poolKey, pool);
        rows.push(pool);
      }
      pool.components.push(component);
    }
    return rows;
  }

  function displayBundleComponentCustomerPrice(component: BundleComponentLine): number | null {
    const canonical = productsById.get(component.componentId);
    if (canonical) return resolvedCustomerPrice(canonical);
    return firstPositiveNumber(component.defaultCustomerPriceVnd, component.unitPriceVnd) ?? component.defaultCustomerPriceVnd ?? component.unitPriceVnd ?? null;
  }

  const productColSpan = fixedGroupId ? 12 : 13;

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

      {hasBundles ? (
        <div className="sc-subtabs" role="tablist" aria-label="Loại sản phẩm">
          <button
            type="button"
            role="tab"
            className={activeCatalogTab === 'standalone' ? 'active' : ''}
            onClick={() => setActiveCatalogTab('standalone')}
          >
            Sản phẩm lẻ / Add-on <span>{standaloneProducts.filter(p => !statusFilter || p.status === statusFilter).length}</span>
          </button>
          <button
            type="button"
            role="tab"
            className={activeCatalogTab === 'bundle' ? 'active' : ''}
            onClick={() => setActiveCatalogTab('bundle')}
          >
            Gói Combo <span>{bundleProducts.filter(p => !statusFilter || p.status === statusFilter).length}</span>
          </button>
        </div>
      ) : null}



      {activeCatalogTab === 'bundle' ? (
        <div className="sc-bundle-list">
          {filtered.length === 0 ? (
            <div className="sc-empty">Không có gói Combo phù hợp.</div>
          ) : (
            filtered.map(product => {
              const components = product.components || [];
              const visibleComponents = displayBundleComponents(product);
              const expanded = expandedBundles.has(product.id);
              return (
                <section className="sc-bundle-card" key={product.id}>
                  <div className="sc-bundle-card-head">
                    <div className="sc-bundle-card-main">
                      <div className="sc-cell-title">
                        <span className="sc-product-card-title">{product.quoteDisplayName || formatSkuName(product.sku, product.name)}</span>
                        <span className="sc-badge sc-badge-bundle">Gói Combo</span>
                        <span className={`sc-badge ${product.status === 'inactive' ? 'sc-badge-inactive' : 'sc-badge-active'}`}>
                          {product.status === 'inactive' ? 'Ngừng kinh doanh' : 'Đang kinh doanh'}
                        </span>
                      </div>
                      {product.quoteDescription || product.description ? <p className="sc-product-card-desc">{product.quoteDescription || product.description}</p> : null}
                      <div className="sc-bundle-price-line">
                        {product.annualCommitMonthlyPriceVnd != null ? (
                          <strong>{formatVnd(product.annualCommitMonthlyPriceVnd)}/tháng khi thanh toán năm</strong>
                        ) : (
                          <strong>{formatVnd(product.monthlyPriceVnd ?? product.defaultCustomerPriceVnd ?? product.defaultUnitPriceVnd)}/tháng</strong>
                        )}
                        {product.annualTotalPriceVnd != null ? <span>Tổng 12 tháng: {formatVnd(product.annualTotalPriceVnd)}</span> : null}
                        {product.quoteCta ? <span>{product.quoteCta}</span> : null}
                      </div>
                    </div>
                    <div className="sc-bundle-card-actions">
                      {renderRowActions(product)}
                      <button type="button" className="sc-btn" onClick={() => toggleBundleExpanded(product.id)}>
                        {expanded ? 'Ẩn thành phần' : 'Xem thành phần'} ({components.length})
                      </button>
                    </div>
                  </div>
                  {expanded ? (
                    <div className="sc-bundle-components-preview">
                      <div className="sc-bundle-components-title">Thành phần trong gói</div>
                      {components.length === 0 ? (
                        <p className="sc-tab-note">Chưa cấu hình thành phần cho gói này.</p>
                      ) : (
                        <div className="sc-bundle-components-table sc-bundle-components-table--readonly">
                          <div className="sc-bundle-components-head">
                            <span>SKU</span>
                            <span>Tên hạng mục</span>
                            <span>Mô tả</span>
                            <span>ĐVT</span>
                            <span>Quota</span>
                            <span>Giá vốn</span>
                            <span>Giá khách</span>
                            <span>Bắt buộc</span>
                            <span>Vượt quota tính thêm</span>
                          </div>
                          {visibleComponents.map(entry => {
                            if (entry.type === 'pool') {
                              const poolExpanded = expandedQuotaPools.has(`${product.id}:${entry.key}`);
                              return (
                                <Fragment key={`pool:${entry.key}`}>
                                  <div className="sc-bundle-components-row sc-bundle-components-row--pool">
                                    <span>
                                      <button
                                        type="button"
                                        className="sc-quota-pool-toggle"
                                        aria-expanded={poolExpanded}
                                        onClick={() => toggleQuotaPoolExpanded(product.id, entry.key)}
                                      >
                                        {poolExpanded ? '−' : '+'}
                                      </button>
                                    </span>
                                    <span>{entry.quota !== '—' ? `${entry.name} — ${entry.quota}` : entry.name}</span>
                                    <span>{entry.components.map(component => component.sku).filter(Boolean).join(', ') || '—'}</span>
                                    <span>Nhóm</span>
                                    <span>{entry.quota}</span>
                                    <span>—</span>
                                    <span>—</span>
                                    <span>{entry.components.some(component => component.required === false) ? 'Không' : 'Có'}</span>
                                    <span>{entry.components.some(component => component.overagePolicy === 'charge') ? 'Có' : 'Không'}</span>
                                  </div>
                                  {poolExpanded ? entry.components.map(component => (
                                    <div className="sc-bundle-components-row sc-bundle-components-row--pool-child" key={component.id || component.componentId}>
                                      <span>{component.sku || '—'}</span>
                                      <span>{component.customerDisplayName || component.name || '—'}</span>
                                      <span>{component.description || '—'}</span>
                                      <span>{component.unit || '—'}</span>
                                      <span>{component.quota || component.displayText || 'Dùng chung'}</span>
                                      <span>{formatVndOrMissing(component.defaultCostPriceVnd)}</span>
                                      <span>{formatVndOrMissing(displayBundleComponentCustomerPrice(component))}</span>
                                      <span>{component.required === false ? 'Không' : 'Có'}</span>
                                      <span>{component.overagePolicy === 'charge' ? 'Có' : 'Không'}</span>
                                    </div>
                                  )) : null}
                                </Fragment>
                              );
                            }
                            const { component } = entry;
                            return (
                              <div className="sc-bundle-components-row" key={component.id || component.componentId}>
                                <span>{component.sku || '—'}</span>
                                <span>{component.customerDisplayName || component.name || '—'}</span>
                                <span>{component.description || '—'}</span>
                                <span>{component.unit || '—'}</span>
                                <span>{component.quota || component.displayText || '—'}</span>
                                <span>{formatVndOrMissing(component.defaultCostPriceVnd)}</span>
                                <span>{formatVndOrMissing(displayBundleComponentCustomerPrice(component))}</span>
                                <span>{component.required === false ? 'Không' : 'Có'}</span>
                                <span>{component.overagePolicy === 'charge' ? 'Có' : 'Không'}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ) : null}
                </section>
              );
            })
          )}
        </div>
      ) : (
      <>
      <div className="sc-table-wrap">
        <table className="sc-table">
          <thead>
            <tr>
              <th>Mã/Sản phẩm</th>
              <th>Mô tả</th>
              {fixedGroupId ? null : <th>Nhóm</th>}
              <th>ĐVT</th>
              <th>Giá vốn</th>
              <th>Giá tháng</th>
              <th>Giá trả năm/tháng</th>
              <th>Giá khách mặc định</th>
              <th>VAT</th>
              <th>Trạng thái</th>
              <th>Hiển thị KH</th>
              <th>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={productColSpan} className="sc-empty">
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
                        </div>
                        {product.itemType === 'bundle' ? <span className="sc-badge sc-badge-bundle">Gói</span> : null}
                      </div>
                    </td>
                    {/* Yeu cau rieng "chuyển mô tả ra 1 cột ngoài luôn" - truoc
                     * day mo ta nam LONG ben trong o Ten (sc-cell-name-desc),
                     * gio tach rieng 1 cot doc lap giong cac cot gia/VAT khac. */}
                    <td className="sc-cell-desc" title={product.description || undefined}>{product.description || '—'}</td>
                    {fixedGroupId ? null : <td>{product.groupName}</td>}
                    <td>{product.unit || '—'}</td>
                    <td className={product.defaultCostPriceVnd == null ? 'sc-cell-price-missing' : undefined}>
                        {formatVndOrMissing(product.defaultCostPriceVnd)}
                      </td>
                      <td>{formatVndOrMissing(product.monthlyPriceVnd)}</td>
                      <td>{formatVndOrMissing(product.annualCommitMonthlyPriceVnd)}</td>
                      <td>{formatVndOrMissing(resolvedCustomerPrice(product))}</td>
                    <td>{product.defaultVatRate != null ? `${product.defaultVatRate}%` : '—'}</td>
                    <td>
                      <span className={`sc-badge ${product.status === 'inactive' ? 'sc-badge-inactive' : 'sc-badge-active'}`}>
                        {product.status === 'inactive' ? 'Ngừng kinh doanh' : 'Đang kinh doanh'}
                      </span>
                    </td>
                    <td>{product.customerVisible ? 'Có' : 'Không'}</td>
                    <td className="sc-row-actions">{renderRowActions(product)}</td>
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
              <div className="sc-product-card-price-row"><span>Giá vốn</span><span>{formatVndOrMissing(product.defaultCostPriceVnd)}</span></div>
              <div className="sc-product-card-price-row"><span>Giá tháng</span><span>{formatVndOrMissing(product.monthlyPriceVnd)}</span></div>
              <div className="sc-product-card-price-row"><span>Giá trả năm/tháng</span><span>{formatVndOrMissing(product.annualCommitMonthlyPriceVnd)}</span></div>
              <div className="sc-product-card-price-row"><span>Giá khách mặc định</span><span>{formatVndOrMissing(resolvedCustomerPrice(product))}</span></div>
            </div>
            <span className={`sc-badge ${product.status === 'inactive' ? 'sc-badge-inactive' : 'sc-badge-active'}`} style={{ alignSelf: 'flex-start' }}>
              {product.status === 'inactive' ? 'Ngừng kinh doanh' : 'Đang kinh doanh'}
            </span>
            {renderRowActions(product)}
          </div>
        ))}
      </div>
      </>
      )}

      <ConfirmModal
        open={Boolean(confirmDeleteTarget)}
        title="Xoá sản phẩm"
        message={confirmDeleteTarget ? `Xoá "${confirmDeleteTarget.name}"?` : ''}
        actions={[{ label: 'Xoá', variant: 'primary', onClick: () => void handleConfirmDelete() }]}
        onClose={() => setConfirmDeleteTarget(null)}
      />

      {quickAddOpen ? (
        <QuickAddProductModal
          open={quickAddOpen}
          onClose={() => {
            setQuickAddOpen(false);
            setQuickAddEditingItem(null);
          }}
          groups={groups}
          existingItems={products}
          defaultGroupId={fixedGroupId || groupFilter || undefined}
          editingItem={quickAddEditingItem || undefined}
          onCreated={() => {
            setQuickAddOpen(false);
            setQuickAddEditingItem(null);
            void refresh();
          }}
          onUpdated={() => {
            setQuickAddOpen(false);
            setQuickAddEditingItem(null);
            void refresh();
          }}
        />
      ) : null}
    </div>
  );
});
