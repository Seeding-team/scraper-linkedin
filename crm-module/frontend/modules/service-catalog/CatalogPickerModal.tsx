'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { X } from '@/modules/crm/components/icons';
import './styles/service-catalog.css';
// qc-modal-backdrop/qc-btn/qc-mini-btn/qc-workspace-note/qc-row-sub - dung
// lai tu quote-center.css (component nay duoc dung CA trong QuoteWorkspaceModal
// LAN FillQuoteStep/CreateQuoteModal - import truc tiep o day de dam bao co
// san du du dieu kien caller nao render truoc, khong phu thuoc thu tu import
// CSS toan cuc cua trang).
import '@/modules/crm/styles/quote-center.css';
import { formatVnd, formatUsd } from './price-book-preview';

/** Dong da chuan hoa de hien thi trong Catalog Picker - noi goi (QuoteWorkspaceModal,
 * FillQuoteStep) tu quy doi ServiceCatalogItem/PriceBookItem thanh dang nay,
 * component nay KHONG biet gi ve 2 kieu du lieu goc do - dung CHUNG cho ca 2
 * nguon (Danh muc noi bo/Bang gia VPS Zone) va CA 2 diem goi. */
export interface CatalogPickerListItem {
  id: string;
  sku?: string | null;
  name: string;
  description?: string | null;
  groupName?: string | null;
  unit?: string | null;
  vatRate?: number | null;
  /** undefined = nguoi dung KHONG co quyen xem (an han, khong hien "Chưa nhập"
   * gia); null = co quyen nhung chua cau hinh; number = da co gia tri (bao
   * gom 0, KHONG duoc coi la falsy). */
  costPriceVnd?: number | null;
  markupPercent?: number | null;
  customerPriceVnd: number;
  status?: 'active' | 'inactive';
  alreadyAdded: boolean;
  /** Lop XEM QUY DOI USD (tham khao, CHI dung cho nguon "Bảng giá VPS Zone") -
   * tinh THAT o backend bang Decimal, cung nguyen tac undefined/null/number
   * nhu costPriceVnd o tren. `exchangeRate` di kem de hien dong "Tỷ giá:..."
   * va biet item nao chua co ty gia (khong quy doi duoc). */
  costPriceUsd?: number | null;
  customerPriceUsd?: number | null;
  exchangeRate?: number | null;
}

function foldDiacritics(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase();
}

export function CatalogPickerModal({
  open,
  onClose,
  title = 'Chọn sản phẩm / dịch vụ',
  subtitle = 'Tìm nhanh theo mã, tên hoặc nhóm sản phẩm',
  showZoneTab,
  activeSource,
  onSourceChange,
  loading,
  items,
  onAddSelected,
  adding,
  extraToolbar,
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
  adding?: boolean;
  /** Slot rieng cho toolbar dac thu tung noi goi (vd chon "Thêm vào mục" cua
   * QuoteWorkspaceModal) - render ngay duoi thanh filter chuan. */
  extraToolbar?: ReactNode;
  /** Cap dieu khien NHOM DANG LOC ra ben ngoai (tuy chon) - caller (vd
   * QuoteWorkspaceModal, "+ Sản phẩm mới" trong popup) can biet dung nhom
   * nao dang duoc xem de tu chon san Nhom do khi tao san pham moi. KHONG
   * truyen 2 prop nay (nhu QuoteFormFiller dang dung) thi component giu
   * nguyen hanh vi uncontrolled cu (tu quan ly groupFilter noi bo). */
  groupFilterValue?: string;
  onGroupFilterChange?: (value: string) => void;
  /** BUG THAT DA GAP ("tự động thêm thẳng vào báo giá ngay sau khi lưu sản
   * phẩm" - hanh vi sai): sau khi tao nhanh 1 san pham moi trong popup nay
   * ("+ Sản phẩm mới"), dung MODAL PHAI DUNG lai o day (KHONG dong, KHONG tu
   * them vao bao gia) va CHI tu TICH CHON san pham vua tao de Sale tu kiem
   * tra roi bam "+ Thêm vào báo giá" nhu binh thuong. Caller set id nay MOI
   * LAN tao xong (vd sau refreshCatalogTree()) - component tu tick khi id
   * xuat hien trong `items`. */
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
  // Toggle CHI la che do XEM (khong phai chon currency de phat hanh bao gia) -
  // chi co y nghia o nguon "zone" (Bang gia VPS Zone), "Danh mục nội bộ"
  // khong co khai niem USD nen luon coi la 'vnd'.
  const [currencyView, setCurrencyView] = useState<'vnd' | 'usd'>('vnd');

  // Reset toan bo state cuc bo moi lan modal MO LAI (khong giu loc/chon cua
  // lan truoc, tranh nham lan da chon nhung thuc ra la state cu).
  useEffect(() => {
    if (open) {
      setSearch('');
      setGroupFilter('');
      setShowAddedOnly(false);
      setSelected(new Set());
      setCurrencyView('vnd');
    }
  }, [open, activeSource]);

  // "+ Sản phẩm mới" tao xong: KHONG tu them vao bao gia, CHI tu TICH CHON
  // (yeu cau sua bug "tự động thêm thẳng vào báo giá") - id chi xuat hien
  // trong `items` SAU KHI caller refreshCatalogTree() xong, nen dung effect
  // rieng thay vi tick ngay luc nhan prop (item co the chua co trong danh
  // sach o thoi diem do).
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
      if (!item.groupName) continue;
      map.set(item.groupName, (map.get(item.groupName) || 0) + 1);
    }
    return Array.from(map.entries());
  }, [items]);

  const filtered = useMemo(() => {
    const term = foldDiacritics(search.trim());
    return items.filter(item => {
      if (activeOnly && item.status === 'inactive') return false;
      if (hasPriceOnly && !(item.customerPriceVnd > 0)) return false;
      if (showAddedOnly && !item.alreadyAdded) return false;
      if (groupFilter && item.groupName !== groupFilter) return false;
      if (!term) return true;
      return (
        foldDiacritics(item.name).includes(term) ||
        foldDiacritics(item.sku || '').includes(term) ||
        foldDiacritics(item.description || '').includes(term)
      );
    });
  }, [items, search, activeOnly, hasPriceOnly, showAddedOnly, groupFilter]);

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

  function selectAll() {
    setSelected(new Set(filtered.filter(i => !i.alreadyAdded).map(i => i.id)));
  }

  function handleAdd() {
    if (selected.size === 0) return;
    onAddSelected(Array.from(selected));
    setSelected(new Set());
  }

  if (!open) return null;

  return (
    <div className="qc-modal-backdrop qc-modal-backdrop--nested" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="cp-modal">
        <div className="cp-head">
          <div>
            <h3>{title}</h3>
            <p>{subtitle}</p>
          </div>
          <button type="button" className="crm-icon-action" aria-label="Đóng" onClick={onClose}>
            <X className="qc-inline-icon" />
          </button>
        </div>

        {showZoneTab ? (
          <div className="cp-tabs">
            <button type="button" className={activeSource === 'internal' ? 'active' : ''} onClick={() => onSourceChange('internal')}>
              Danh mục nội bộ
            </button>
            <button type="button" className={activeSource === 'zone' ? 'active' : ''} onClick={() => onSourceChange('zone')}>
              Bảng giá VPS Zone
            </button>
          </div>
        ) : null}

        <div className="cp-search-row">
          <input
            className="cp-search"
            placeholder="Tìm mã, tên, mô tả..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="cp-filter-chips">
          <button type="button" className={activeOnly ? 'active' : ''} onClick={() => setActiveOnly(v => !v)}>Đang kinh doanh</button>
          <button type="button" className={hasPriceOnly ? 'active' : ''} onClick={() => setHasPriceOnly(v => !v)}>Có đơn giá</button>
          <button
            type="button"
            onClick={() => { setSearch(''); setGroupFilter(''); setActiveOnly(false); setHasPriceOnly(false); setShowAddedOnly(false); }}
          >
            Xoá lọc
          </button>
        </div>
        {extraToolbar}
        {hydratingItem ? (
          <div className="cp-hydration-state" role="status">
            <span className="cp-hydration-spinner" aria-hidden="true" />
            Đang tải đầy đủ giá của “{hydratingItem.name}”…
          </div>
        ) : hydrationError ? (
          <div className="cp-hydration-state cp-hydration-state--error" role="alert">
            <span>{hydrationError}</span>
            <button type="button" className="qc-mini-btn" onClick={onRetryHydration}>Thử lại</button>
          </div>
        ) : null}

        <div className="cp-body">
          <aside className="cp-sidebar">
            <div className="cp-sidebar-section">
              <div className="cp-sidebar-title">Truy cập nhanh</div>
              <button type="button" className={!groupFilter && !showAddedOnly ? 'active' : ''} onClick={() => { setGroupFilter(''); setShowAddedOnly(false); }}>
                Tất cả sản phẩm <span>{items.length}</span>
              </button>
              <button type="button" className={showAddedOnly ? 'active' : ''} onClick={() => setShowAddedOnly(v => !v)}>
                Đã có trong báo giá <span>{addedCount}</span>
              </button>
            </div>
            {groups.length > 0 ? (
              <div className="cp-sidebar-section">
                <div className="cp-sidebar-title">Nhóm sản phẩm</div>
                {groups.map(([name, count]) => (
                  <button
                    type="button"
                    key={name}
                    className={groupFilter === name ? 'active' : ''}
                    onClick={() => setGroupFilter(groupFilter === name ? '' : name)}
                  >
                    {name} <span>{count}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </aside>

          <div className="cp-list">
            <div className="cp-list-head">
              <span>{loading ? 'Đang tải...' : `Hiển thị ${filtered.length} sản phẩm`}</span>
              {/* Toggle CHI doi cach HIEN THI (khong co khai niem "nhap" o
               * Picker) - nhan phai ghi ro "Xem quy đổi" giong dung tinh
               * than trang quan ly, chi hien khi dang o tab Zone (Danh muc
               * noi bo khong co USD). Dat CUNG HANG voi "Hiển thị N sản
               * phẩm"/"Chọn tất cả" theo dung yeu cau. */}
              {activeSource === 'zone' ? (
                <div className="sc-mode-toggle sc-pb-currency-toggle cp-currency-toggle">
                  <button type="button" className={currencyView === 'vnd' ? 'active' : ''} onClick={() => setCurrencyView('vnd')}>
                    Giá VNĐ
                  </button>
                  <button type="button" className={currencyView === 'usd' ? 'active' : ''} onClick={() => setCurrencyView('usd')}>
                    Xem quy đổi USD
                  </button>
                  {currencyView === 'usd' && representativeExchangeRate != null ? (
                    <span className="cp-fx-note">
                      1$ = {representativeExchangeRate.toLocaleString('vi-VN')}đ · <span className="sc-pb-fx-badge">Tham khảo</span>
                    </span>
                  ) : null}
                </div>
              ) : null}
              <button type="button" className="qc-mini-btn" onClick={selectAll} disabled={filtered.length === 0}>
                Chọn tất cả
              </button>
            </div>
            {loading ? (
              <p className="qc-workspace-note">Đang tải danh mục...</p>
            ) : filtered.length === 0 ? (
              <p className="qc-workspace-note">Không tìm thấy sản phẩm phù hợp.</p>
            ) : (
              filtered.map(item => (
                <label key={item.id} className={`cp-row${item.alreadyAdded ? ' cp-row--added' : ''}`}>
                  <input
                    type="checkbox"
                    checked={item.alreadyAdded || selected.has(item.id)}
                    disabled={item.alreadyAdded}
                    onChange={() => toggleSelect(item.id, item.alreadyAdded)}
                  />
                  <div className="cp-row-main">
                    <div className="cp-row-title">
                      <strong>{item.sku ? `${item.sku} — ${item.name}` : item.name}</strong>
                      {item.status === 'inactive' ? <span className="qc-row-sub">Ngừng kinh doanh</span> : null}
                    </div>
                    {item.description ? <div className="cp-row-desc">{item.description}</div> : null}
                  </div>
                  <div className="cp-row-meta">
                    <span>{item.groupName || '—'}</span>
                    <span>{item.unit || '—'}</span>
                  </div>
                  {canViewCost ? (
                    <>
                      <div className="cp-row-price">
                        <span className="cp-row-price-label">{currencyView === 'usd' ? 'Giá vốn/ĐV (USD)' : 'Giá vốn/ĐV'}</span>
                        <span>
                          {currencyView === 'usd' ? (
                            item.costPriceUsd === undefined ? (
                              'Không có quyền xem'
                            ) : item.exchangeRate == null ? (
                              '—'
                            ) : (
                              <>
                                {formatUsd(item.costPriceUsd)} <span className="sc-pb-fx-badge">Tham khảo</span>
                              </>
                            )
                          ) : item.costPriceVnd === undefined ? (
                            'Không có quyền xem'
                          ) : (
                            formatVnd(item.costPriceVnd)
                          )}
                        </span>
                      </div>
                      <div className="cp-row-price">
                        <span className="cp-row-price-label">Markup</span>
                        <span>{item.markupPercent === undefined ? '—' : item.markupPercent == null ? '—' : `${item.markupPercent.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%`}</span>
                      </div>
                    </>
                  ) : null}
                  <div className="cp-row-price">
                    <span className="cp-row-price-label">{currencyView === 'usd' ? 'Giá khách/ĐV (USD)' : 'Giá khách/ĐV'}</span>
                    <span>
                      {currencyView === 'usd' ? (
                        // Gia khach KHONG bi gate theo quyen xem cost (khac
                        // costPriceUsd o tren) - chi "—" khi THAT SU thieu du
                        // lieu (customerPriceUsd null vi chua co ty giá), KHONG
                        // dua vao exchangeRate (field do CO THE bi an rieng
                        // cho nguoi khong du quyen xem gia von, khong lien
                        // quan gi den viec co duoc xem gia khach hay khong).
                        item.customerPriceUsd == null ? (
                          '—'
                        ) : (
                          <>
                            {formatUsd(item.customerPriceUsd)} <span className="sc-pb-fx-badge">Tham khảo</span>
                          </>
                        )
                      ) : (
                        formatVnd(item.customerPriceVnd)
                      )}
                    </span>
                  </div>
                  <div className="cp-row-price">
                    <span className="cp-row-price-label">VAT</span>
                    <span>{item.vatRate ? `${item.vatRate}%` : '—'}</span>
                  </div>
                  {item.alreadyAdded ? <span className="cp-row-add cp-row-add--done">✓ Đã thêm</span> : null}
                </label>
              ))
            )}
          </div>
        </div>

        <div className="cp-footer">
          <span>{selected.size > 0 ? `Đã chọn ${selected.size} sản phẩm` : 'Chưa chọn sản phẩm nào'}</span>
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
