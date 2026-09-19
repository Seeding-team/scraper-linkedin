import { useEffect, useMemo, useState, Fragment, type ReactNode } from 'react';
import { X, Pencil, MoreVertical, PauseCircle, Trash2 } from '@/modules/crm/components/icons';
import { ActionMenu } from '@/modules/crm/components/ActionMenu';
import './styles/service-catalog.css';
import '@/modules/crm/styles/quote-center.css';
import { formatVnd, formatUsd } from './price-book-preview';

export interface CatalogPickerListItem {
  id: string;
  itemType?: 'component' | 'bundle';
  sku?: string | null;
  name: string;
  description?: string | null;
  quoteDisplayName?: string | null;
  quoteDescription?: string | null;
  quoteCta?: string | null;
  groupId?: string | null;
  groupName?: string | null;
  unit?: string | null;
  vatRate?: number | null;
  costPriceVnd?: number | null;
  markupPercent?: number | null;
  customerPriceVnd: number;
  monthlyPriceVnd?: number | null;
  annualCommitMonthlyPriceVnd?: number | null;
  annualTotalPriceVnd?: number | null;
  status?: 'active' | 'inactive';
  alreadyAdded: boolean;
  components?: Array<{
    componentId: string;
    sku?: string | null;
    name?: string | null;
    description?: string | null;
    unit?: string | null;
    quota?: string | null;
    customerDisplayName?: string | null;
    crmNote?: string | null;
    quotaPoolKey?: string | null;
    quotaPoolName?: string | null;
    quotaPoolQuota?: string | null;
    quotaPoolLimit?: number | null;
    displayText?: string | null;
    defaultCostPriceVnd?: number | null;
    defaultCustomerPriceVnd?: number | null;
    unitPriceVnd?: number | null;
    monthlyPriceVnd?: number | null;
    annualCommitMonthlyPriceVnd?: number | null;
    required?: boolean;
    overagePolicy?: string | null;
    showOnQuote?: boolean;
  }>;
  costPriceUsd?: number | null;
  customerPriceUsd?: number | null;
  exchangeRate?: number | null;
}

function foldDiacritics(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase();
}

function firstPositiveNumber(...values: Array<number | null | undefined>): number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

function componentCustomerPrice(component: NonNullable<CatalogPickerListItem['components']>[number]): number | null {
  return firstPositiveNumber(
    component.defaultCustomerPriceVnd,
    component.monthlyPriceVnd,
    component.annualCommitMonthlyPriceVnd,
    component.unitPriceVnd
  ) ?? component.defaultCustomerPriceVnd ?? component.unitPriceVnd ?? null;
}

export function CatalogPickerModal({
  open,
  onClose,
  title = 'Chọn sản phẩm / dịch vụ',
  subtitle = 'Tìm kiếm và chọn sản phẩm để thêm vào báo giá',
  showZoneTab,
  activeSource,
  onSourceChange,
  loading,
  items,
  onAddSelected,
  onEditItem,
  onToggleItemStatus,
  onDeleteItem,
  adding,
  extraToolbar,
  onQuickAddProduct,
  onQuickAddGroup,
  groupFilterValue,
  onGroupFilterChange,
  autoSelectId,
  hydratingItem,
  hydrationError,
  onRetryHydration,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  showZoneTab: boolean;
  activeSource: 'internal' | 'zone';
  onSourceChange: (source: 'internal' | 'zone') => void;
  loading: boolean;
  items: CatalogPickerListItem[];
  onAddSelected: (ids: string[]) => void;
  onEditItem?: (item: CatalogPickerListItem) => void;
  onToggleItemStatus?: (item: CatalogPickerListItem) => void | Promise<void>;
  onDeleteItem?: (item: CatalogPickerListItem) => void | Promise<void>;
  adding?: boolean;
  extraToolbar?: ReactNode;
  onQuickAddProduct?: () => void;
  onQuickAddGroup?: () => void;
  groupFilterValue?: string;
  onGroupFilterChange?: (value: string) => void;
  autoSelectId?: string | null;
  hydratingItem?: { id: string; name: string } | null;
  hydrationError?: string | null;
  onRetryHydration?: () => void;
}) {
  const [search, setSearch] = useState('');
  const [internalGroupFilter, setInternalGroupFilter] = useState('');
  const groupFilter = groupFilterValue !== undefined ? groupFilterValue : internalGroupFilter;
  const setGroupFilter = onGroupFilterChange || setInternalGroupFilter;
  const [activeOnly, setActiveOnly] = useState(true);
  const [hasPriceOnly, setHasPriceOnly] = useState(false);
  const [showAddedOnly, setShowAddedOnly] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [activeProductTab, setActiveProductTab] = useState<'standalone' | 'bundle'>('standalone');
  const [expandedBundles, setExpandedBundles] = useState<Set<string>>(new Set());
  const [currencyView, setCurrencyView] = useState<'vnd' | 'usd'>('vnd');
  const [groupSearch, setGroupSearch] = useState('');

  useEffect(() => {
    if (open) {
      setSearch('');
      setGroupFilter('');
      setShowAddedOnly(false);
      setSelected(new Set());
      setCurrencyView('vnd');
      setGroupSearch('');
    }
  }, [open, activeSource]);

  useEffect(() => {
    if (!autoSelectId) return;
    if (!items.some(item => item.id === autoSelectId && !item.alreadyAdded)) return;
    setSelected(prev => (prev.has(autoSelectId) ? prev : new Set(prev).add(autoSelectId)));
  }, [autoSelectId, items]);

  const representativeExchangeRate = useMemo(
    () => items.find(item => item.exchangeRate != null)?.exchangeRate ?? null,
    [items]
  );

  const groups = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of items) {
      if (item.status === 'inactive') continue; // archived không tính vào active count
      const groupName = item.groupName || 'Chưa phân nhóm';
      map.set(groupName, (map.get(groupName) || 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [items]);
  
  const displayedGroups = useMemo(() => {
    const term = foldDiacritics(groupSearch.trim());
    if (!term) return groups;
    return groups.filter(g => foldDiacritics(g[0]).includes(term));
  }, [groups, groupSearch]);

  const filtered = useMemo(() => {
    const term = foldDiacritics(search.trim());
    return items.filter(item => {
      if (activeOnly && item.status === 'inactive') return false;
      if (hasPriceOnly && !(item.customerPriceVnd > 0)) return false;
      if (showAddedOnly && !item.alreadyAdded) return false;
      if (groupFilter && (item.groupName || 'Chưa phân nhóm') !== groupFilter && groupFilter !== 'Tất cả sản phẩm') return false;
      if (!term) return true;
      return (
        foldDiacritics(item.name).includes(term) ||
        foldDiacritics(item.sku || '').includes(term) ||
        foldDiacritics(item.description || '').includes(term)
      );
    });
  }, [items, search, activeOnly, hasPriceOnly, showAddedOnly, groupFilter]);

  const standaloneItems = useMemo(() => filtered.filter(item => item.itemType !== 'bundle'), [filtered]);
  const bundleItems = useMemo(() => filtered.filter(item => item.itemType === 'bundle'), [filtered]);
  const visibleProductTab = activeProductTab === 'bundle' ? 'bundle' : 'standalone';
  const displayedItems = visibleProductTab === 'bundle' ? bundleItems : standaloneItems;

  const addedCount = items.filter(i => i.alreadyAdded).length;
  const canViewCost = items.some(i => i.costPriceVnd !== undefined);

  function toggleSelect(id: string, alreadyAdded: boolean) {
    if (alreadyAdded) return;
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleAdd() {
    if (selected.size === 0) return;
    onAddSelected(Array.from(selected));
    setSelected(new Set());
  }

  function toggleBundleExpanded(id: string) {
    setExpandedBundles(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function runItemAction(item: CatalogPickerListItem, action: (item: CatalogPickerListItem) => void | Promise<void>) {
    setActionBusyId(item.id);
    try {
      await action(item);
    } finally {
      setActionBusyId(null);
    }
  }

  function renderQuickActions(item: CatalogPickerListItem) {
    if (!onEditItem && !onToggleItemStatus && !onDeleteItem) return null;
    const busy = actionBusyId === item.id;
    return (
      <div className="cp-row-actions" onClick={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()}>
        {onEditItem ? (
          <button type="button" className="qc-mini-btn qc-mini-btn-icon" disabled={busy} onClick={() => onEditItem(item)} title="Sửa">
            <Pencil className="crm-inline-icon" />
          </button>
        ) : null}
        <ActionMenu
          icon={MoreVertical}
          items={[
            ...(onToggleItemStatus ? [{
              key: 'toggle',
              label: item.status === 'inactive' ? 'Kích hoạt lại' : 'Ngừng kinh doanh',
              icon: PauseCircle,
              onSelect: () => void runItemAction(item, onToggleItemStatus)
            }] : []),
            ...(onDeleteItem ? [{
              key: 'delete',
              label: 'Xóa',
              icon: Trash2,
              danger: true,
              onSelect: () => void runItemAction(item, onDeleteItem)
            }] : [])
          ]}
        />
      </div>
    );
  }

  function formatCostOrMissing(val: number | null | undefined) {
    if (val === undefined) return 'Không có quyền xem';
    if (val === null) return '—';
    return formatVnd(val);
  }

  function formatPriceOrMissing(val: number | null | undefined) {
    if (val == null) return '—';
    return formatVnd(val);
  }

  if (!open) return null;

  const currentGroupName = groupFilter || 'Tất cả sản phẩm';
  const selectedStandaloneCount = Array.from(selected).filter(id => standaloneItems.some(i => i.id === id)).length;
  const selectedBundleCount = Array.from(selected).filter(id => bundleItems.some(i => i.id === id)).length;

  return (
    <div className="qc-modal-backdrop qc-modal-backdrop--nested" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="cp-modal cp-modal-redesign">
        <div className="cp-head-redesign">
          <div className="cp-head-title">
            <h3>{title}</h3>
            <p>{subtitle}</p>
          </div>
          
          <div className="cp-head-controls">
            <input
              className="cp-search"
              placeholder="Tìm SKU, tên sản phẩm, mô tả..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            
            {showZoneTab ? (
              <select
                className="cp-source-select"
                value={activeSource}
                onChange={e => onSourceChange(e.target.value as 'internal' | 'zone')}
              >
                <option value="internal">Danh mục nội bộ</option>
                <option value="zone">Bảng giá VPS Zone</option>
              </select>
            ) : null}
            
            <ActionMenu
               label="Bộ lọc"
               iconClassName="crm-inline-icon"
               items={[
                 {
                   key: 'activeOnly',
                   label: activeOnly ? '✓ Đang kinh doanh' : 'Đang kinh doanh',
                   onSelect: () => setActiveOnly(!activeOnly)
                 },
                 {
                   key: 'hasPriceOnly',
                   label: hasPriceOnly ? '✓ Có đơn giá' : 'Có đơn giá',
                   onSelect: () => setHasPriceOnly(!hasPriceOnly)
                 },
                 {
                   key: 'clear',
                   label: 'Xóa lọc',
                   onSelect: () => { setActiveOnly(false); setHasPriceOnly(false); }
                 }
               ]}
            />
          </div>

          <button type="button" className="crm-icon-action cp-close-btn" aria-label="Đóng" onClick={onClose}>
            <X className="qc-inline-icon" />
          </button>
        </div>
        
        {extraToolbar}
        {hydratingItem ? (
          <div className="cp-hydration-state" role="status">
            <span className="cp-hydration-spinner" aria-hidden="true" />
            Đang tải đầy đủ giá của "{hydratingItem.name}"…
          </div>
        ) : hydrationError ? (
          <div className="cp-hydration-state cp-hydration-state--error" role="alert">
            <span>{hydrationError}</span>
            <button type="button" className="qc-mini-btn" onClick={onRetryHydration}>Thử lại</button>
          </div>
        ) : null}

        <div className="cp-body-redesign">
          <aside className="cp-sidebar-redesign">
            {(onQuickAddProduct || onQuickAddGroup) && (
              <div className="cp-sidebar-actions" style={{ padding: '16px 16px 0', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {onQuickAddProduct && (
                  <button type="button" className="qc-btn qc-btn-primary" onClick={onQuickAddProduct} style={{ width: '100%', justifyContent: 'center' }}>
                    + Sản phẩm mới
                  </button>
                )}
                {onQuickAddGroup && (
                  <button type="button" className="qc-btn" onClick={onQuickAddGroup} style={{ width: '100%', justifyContent: 'center' }}>
                    + Nhóm sản phẩm
                  </button>
                )}
              </div>
            )}
            <div className="cp-sidebar-title">Nhóm sản phẩm</div>
            {groups.length > 10 ? (
              <div className="cp-sidebar-search">
                <input 
                  type="text" 
                  placeholder="Tìm nhóm..." 
                  value={groupSearch} 
                  onChange={e => setGroupSearch(e.target.value)}
                />
              </div>
            ) : null}
            
            <div className="cp-sidebar-list">
              <button type="button" className={!groupFilter ? 'active' : ''} onClick={() => setGroupFilter('')}>
                Tất cả sản phẩm <span>{items.filter(i => i.status !== 'inactive').length}</span>
              </button>
              {displayedGroups.map(([name, count]) => (
                <button
                  type="button"
                  key={name}
                  className={groupFilter === name ? 'active' : ''}
                  onClick={() => setGroupFilter(name)}
                >
                  {name} <span>{count}</span>
                </button>
              ))}
            </div>
          </aside>

          <div className="cp-content-redesign">
            <div className="cp-content-header">
              <h2>{currentGroupName} <span>{filtered.length} sản phẩm</span></h2>
            </div>
            <div className="cp-tabs cp-product-tabs">
              <button type="button" className={visibleProductTab === 'standalone' ? 'active' : ''} onClick={() => setActiveProductTab('standalone')}>
                Sản phẩm lẻ / Add-on <span>{standaloneItems.length}</span>
              </button>
              <button type="button" className={visibleProductTab === 'bundle' ? 'active' : ''} onClick={() => setActiveProductTab('bundle')}>
                Gói Combo <span>{bundleItems.length}</span>
              </button>
            </div>
            
            <div className="cp-content-scroll">
            <div className="cp-content-scroll-inner">
              {loading ? (
                <p className="qc-workspace-note">Đang tải danh mục...</p>
              ) : displayedItems.length === 0 ? (
                <p className="qc-workspace-note">Không tìm thấy sản phẩm phù hợp.</p>
              ) : visibleProductTab === 'standalone' ? (
                <table className="sc-table cp-compact-table">
                  <thead>
                    <tr>
                      <th style={{width: 40}}></th>
                      <th style={{width: '30%'}}>Sản phẩm</th>
                      <th>ĐVT</th>
                      {canViewCost && <th>Giá vốn</th>}
                      <th>Giá tháng</th>
                      <th>Trả năm/tháng</th>
                      <th>Giá khách</th>
                      <th>VAT</th>
                      <th>Trạng thái</th>
                      <th style={{textAlign: 'right'}}>Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {standaloneItems.map(item => {
                      const isSelected = selected.has(item.id) || item.alreadyAdded;
                      return (
                        <tr key={item.id} 
                            className={`cp-selectable-row ${isSelected ? 'cp-row-selected' : ''} ${item.alreadyAdded ? 'cp-row-added' : ''}`}
                            onClick={() => toggleSelect(item.id, item.alreadyAdded)}
                        >
                          <td onClick={e => e.stopPropagation()}>
                            <input 
                               type="checkbox" 
                               checked={isSelected} 
                               disabled={item.alreadyAdded}
                               onChange={() => toggleSelect(item.id, item.alreadyAdded)}
                            />
                          </td>
                          <td>
                            <div className="cp-row-name" title={item.name}>{item.sku ? `${item.sku} — ` : ''}{item.name}</div>
                            {item.description && <div className="cp-row-desc cp-truncate-2" title={item.description}>{item.description}</div>}
                          </td>
                          <td>{item.unit || '—'}</td>
                          {canViewCost && <td className={item.costPriceVnd === undefined ? 'sc-cell-price-missing' : ''}>{formatCostOrMissing(item.costPriceVnd)}</td>}
                          <td>{formatPriceOrMissing(item.monthlyPriceVnd)}</td>
                          <td>{formatPriceOrMissing(item.annualCommitMonthlyPriceVnd)}</td>
                          <td>{formatPriceOrMissing(item.customerPriceVnd)}</td>
                          <td>{item.vatRate != null ? `${item.vatRate}%` : '—'}</td>
                          <td>
                            <span className={`sc-badge ${item.status === 'inactive' ? 'sc-badge-inactive' : 'sc-badge-active'}`}>
                              {item.status === 'inactive' ? 'Sắp ngừng KD' : 'Đang kinh doanh'}
                            </span>
                          </td>
                          <td style={{textAlign: 'right'}}>{renderQuickActions(item)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <div className="cp-bundle-cards-redesign">
                  {bundleItems.map(item => {
                      const expanded = expandedBundles.has(item.id);
                      const isSelected = selected.has(item.id) || item.alreadyAdded;
                      const components = item.components || [];
                      
                      // Group components by pool
                      const standaloneComponents: any[] = [];
                      const pools = new Map<string, any>();
                      
                      components.forEach(c => {
                        if (c.quotaPoolKey) {
                          if (!pools.has(c.quotaPoolKey)) {
                            pools.set(c.quotaPoolKey, {
                              key: c.quotaPoolKey,
                              name: c.quotaPoolName || 'Kênh kết nối',
                              quota: c.quotaPoolQuota,
                              items: []
                            });
                          }
                          pools.get(c.quotaPoolKey).items.push(c);
                        } else {
                          standaloneComponents.push(c);
                        }
                      });

                      // Quota summary mapping
                      const coreComponent = components.find(c => c.sku === 'MCHAT-CORE');
                      const agentComponent = components.find(c => c.sku === 'MCHAT-AGENT');
                      const fbComponent = components.find(c => c.sku === 'MCHAT-CH-FB');
                      const kbComponent = components.find(c => c.sku === 'MCHAT-KB');
                      
                      return (
                        <div key={item.id} className={`cp-bundle-card ${isSelected ? 'cp-row-selected' : ''}`} onClick={() => toggleSelect(item.id, item.alreadyAdded)}>
                          <div className="cp-bundle-card-top flex justify-between items-start">
                            <div className="flex gap-4 flex-1">
                              <div className="cp-bundle-select-box pt-1" onClick={e => e.stopPropagation()}>
                                 <input type="checkbox" checked={isSelected} disabled={item.alreadyAdded} onChange={() => toggleSelect(item.id, item.alreadyAdded)} />
                              </div>
                              <div className="cp-bundle-info flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                  <div className="cp-bundle-title font-semibold text-slate-900">{item.name}</div>
                                  <span className="sc-badge sc-badge-bundle bg-blue-50 text-blue-700 border-blue-200">Gói Combo</span>
                                  <span className={`sc-badge ${item.status === 'inactive' ? 'sc-badge-inactive' : 'sc-badge-active'}`}>{item.status === 'inactive' ? 'Ngừng kinh doanh' : 'Đang kinh doanh'}</span>
                                </div>
                                <div className="text-xs text-slate-500 font-mono mb-2">{item.sku}</div>
                                {item.description && <div className="cp-bundle-desc text-sm text-slate-600 line-clamp-2">{item.description}</div>}
                              </div>
                            </div>
                            
                            <div className="flex flex-col items-end gap-3 min-w-[280px]">
                              <div className="flex items-start justify-between w-full">
                                <div className="flex flex-col text-sm text-slate-600">
                                  {agentComponent && <div className="mb-0.5">👤 {agentComponent.quota}</div>}
                                  {fbComponent && <div className="mb-0.5">◉ {fbComponent.quotaPoolQuota || 'Tùy chọn kênh'}</div>}
                                  {kbComponent && <div>▣ {kbComponent.quota || 'Nội dung KB'}</div>}
                                </div>
                                <div className="text-right">
                                  {item.monthlyPriceVnd != null ? (
                                    <>
                                      <div className="text-base font-bold text-slate-900">{formatVnd(item.monthlyPriceVnd)}<span className="text-sm font-normal text-slate-500">/tháng</span></div>
                                      {item.annualCommitMonthlyPriceVnd != null && <div className="text-xs font-medium text-slate-500 mt-0.5">{formatVnd(item.annualCommitMonthlyPriceVnd)}/tháng (năm)</div>}
                                    </>
                                  ) : (
                                    <div className="text-base font-bold text-slate-900">{formatVnd(item.customerPriceVnd)}</div>
                                  )}
                                </div>
                              </div>
                              
                              <div className="cp-bundle-actions flex items-center gap-2 mt-2" onClick={e => e.stopPropagation()}>
                                <button type="button" className="qc-btn bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs px-3 py-1.5 h-8 font-medium border-0" onClick={() => toggleBundleExpanded(item.id)}>
                                  {expanded ? 'Thu gọn' : `Xem thành phần (${components.length})`}
                                </button>
                                <div className="cp-bundle-row-actions bg-white border border-slate-200 rounded px-1 py-1 flex items-center gap-1 shadow-sm h-8">
                                  {onEditItem && (
                                    <button type="button" className="sc-icon-btn p-1 text-slate-400 hover:text-blue-600 rounded hover:bg-slate-50" onClick={(e) => { e.stopPropagation(); onEditItem(item); }} title="Sửa">
                                      <Pencil />
                                    </button>
                                  )}
                                  <ActionMenu
                                    icon={MoreVertical}
                                    items={[
                                      { key: 'status', label: item.status === 'inactive' ? 'Kích hoạt lại' : 'Ngừng kinh doanh', onSelect: async () => onToggleItemStatus?.(item) },
                                      { key: 'delete', label: 'Xóa', danger: true, onSelect: async () => onDeleteItem?.(item) }
                                    ]}
                                  />
                                </div>
                              </div>
                            </div>
                          </div>
                          
                          {expanded && (
                            <div className="cp-bundle-components mt-4 pt-4 border-t border-slate-200" onClick={e => e.stopPropagation()}>
                              {components.length === 0 ? (
                                <p className="qc-workspace-note">Chưa cấu hình thành phần.</p>
                              ) : (
                                <table className="w-full text-left text-sm sc-table cp-compact-table">
                                  <thead>
                                    <tr className="bg-slate-50">
                                      <th className="py-2 px-3 font-medium text-slate-600">SKU</th>
                                      <th className="py-2 px-3 font-medium text-slate-600 w-1/4">Tên sản phẩm</th>
                                      <th className="py-2 px-3 font-medium text-slate-600">ĐVT</th>
                                      <th className="py-2 px-3 font-medium text-slate-600">Quota</th>
                                      {canViewCost && <th className="py-2 px-3 font-medium text-slate-600">Giá vốn</th>}
                                      <th className="py-2 px-3 font-medium text-slate-600">Giá khách</th>
                                      <th className="py-2 px-3 font-medium text-slate-600 text-center">Bắt buộc</th>
                                      <th className="py-2 px-3 font-medium text-slate-600 text-center">Vượt quota</th>
                                      <th className="py-2 px-3 font-medium text-slate-600 text-center">In báo giá</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-100">
                                    {Array.from(pools.values()).map(pool => (
                                      <Fragment key={pool.key}>
                                        <tr className="bg-blue-50/30">
                                          <td colSpan={2} className="py-2 px-3">
                                            <div className="font-semibold text-slate-800 flex items-center gap-1.5"><span className="text-blue-500 font-bold">▣</span> Nhóm quota: {pool.name}</div>
                                          </td>
                                          <td className="py-2 px-3"></td>
                                          <td className="py-2 px-3 font-medium text-slate-900">{pool.quota}</td>
                                          {canViewCost && <td className="py-2 px-3"></td>}
                                          <td className="py-2 px-3"></td>
                                          <td className="py-2 px-3"></td>
                                          <td className="py-2 px-3"></td>
                                          <td className="py-2 px-3"></td>
                                        </tr>
                                        {pool.items.map((component: any) => (
                                          <tr key={component.componentId} className="hover:bg-slate-50 group">
                                            <td className="py-2 px-3 font-mono text-xs text-slate-500 pl-6 border-l-2 border-blue-200">{component.sku || component.componentId.slice(0, 8)}</td>
                                            <td className="py-2 px-3">
                                              <div className="font-medium text-slate-700 truncate" title={component.customerDisplayName || component.name}>{component.customerDisplayName || component.name || '—'}</div>
                                            </td>
                                            <td className="py-2 px-3 text-slate-600">{component.unit || '—'}</td>
                                            <td className="py-2 px-3 text-slate-500 text-xs italic">Dùng chung</td>
                                            {canViewCost && <td className={`py-2 px-3 ${component.defaultCostPriceVnd === undefined ? 'text-red-400' : 'text-slate-700'}`}>{formatCostOrMissing(component.defaultCostPriceVnd)}</td>}
                                            <td className="py-2 px-3 text-slate-700">{formatVnd(componentCustomerPrice(component))}</td>
                                            <td className="py-2 px-3 text-center text-slate-500">{component.required !== false ? 'Có' : 'Không'}</td>
                                            <td className="py-2 px-3 text-center text-slate-500">{component.overagePolicy === 'charge' ? 'Tính thêm' : 'Không'}</td>
                                            <td className="py-2 px-3 text-center text-slate-500">{component.showOnQuote !== false ? 'Có' : 'Không'}</td>
                                          </tr>
                                        ))}
                                      </Fragment>
                                    ))}
                                    {standaloneComponents.map((component: any) => (
                                      <tr key={component.componentId} className="hover:bg-slate-50">
                                        <td className="py-2 px-3 font-mono text-xs text-slate-500">{component.sku || component.componentId.slice(0, 8)}</td>
                                        <td className="py-2 px-3">
                                          <div className="font-medium text-slate-900 truncate" title={component.customerDisplayName || component.name}>{component.customerDisplayName || component.name || '—'}</div>
                                        </td>
                                        <td className="py-2 px-3 text-slate-600">{component.unit || '—'}</td>
                                        <td className="py-2 px-3 text-slate-900">{component.quota || '—'}</td>
                                        {canViewCost && <td className={`py-2 px-3 ${component.defaultCostPriceVnd === undefined ? 'text-red-400' : 'text-slate-700'}`}>{formatCostOrMissing(component.defaultCostPriceVnd)}</td>}
                                        <td className="py-2 px-3 text-slate-700">{formatVnd(componentCustomerPrice(component))}</td>
                                        <td className="py-2 px-3 text-center text-slate-500">{component.required !== false ? 'Có' : 'Không'}</td>
                                        <td className="py-2 px-3 text-center text-slate-500">{component.overagePolicy === 'charge' ? 'Tính thêm' : 'Không'}</td>
                                        <td className="py-2 px-3 text-center text-slate-500">{component.showOnQuote !== false ? 'Có' : 'Không'}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </div>
                          )}
                        </div>
                      );                  })}
                </div>
              )}
            </div>
            </div>
          </div>
        </div>

        <div className="cp-footer-redesign">
          <div className="cp-footer-left">
            {selected.size > 0 ? (
              <>
                <span className="cp-footer-count">Đã chọn {selected.size} sản phẩm</span>
                <span className="cp-footer-details">
                  {selectedStandaloneCount > 0 ? `${selectedStandaloneCount} sản phẩm lẻ` : ''}
                  {selectedStandaloneCount > 0 && selectedBundleCount > 0 ? ' · ' : ''}
                  {selectedBundleCount > 0 ? `${selectedBundleCount} gói Combo` : ''}
                </span>
              </>
            ) : (
              <span className="cp-footer-count">Chưa chọn sản phẩm nào</span>
            )}
          </div>
          <div className="cp-footer-actions">
            <button type="button" className="qc-btn" onClick={() => setSelected(new Set())} disabled={selected.size === 0}>
              Bỏ chọn
            </button>
            <button type="button" className="qc-btn qc-btn-primary" disabled={selected.size === 0 || adding || Boolean(hydratingItem)} onClick={handleAdd}>
              {adding ? 'Đang thêm…' : `+ Thêm vào báo giá (${selected.size})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
