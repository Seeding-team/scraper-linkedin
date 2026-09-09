'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ConfirmModal } from '@/modules/crm/components/ConfirmModal';
import { ActionMenu } from '@/modules/crm/components/ActionMenu';
import { Eye, Pencil, PauseCircle, Trash2, X } from '@/modules/crm/components/icons';
import {
  priceBookZoneRepository,
  type PriceBookItem,
  type PriceBookItemInput,
  type PriceBookVersion,
} from './repositories/PriceBookZoneRepository';
import { previewPriceBookItem, formatVnd, formatPercent, formatUsd } from './price-book-preview';

function emptyForm(groupLabel: 'I' | 'II'): PriceBookItemInput {
  return {
    sourceSheet: groupLabel === 'I' ? '1.IN-Software AI' : '2.IN-Software AI',
    sourceStt: '',
    sourceGroupLabel: groupLabel,
    sku: '',
    name: '',
    description: '',
    unit: 'Gói',
    defaultQuantity: 1,
    costMode: groupLabel === 'I' ? 'usd' : 'vnd',
    vendorName: '',
    importDutyPercent: 0,
    vatInPercent: groupLabel === 'I' ? 10 : 0,
    defaultRatePercent: 0,
    vatEuPercent: groupLabel === 'I' ? 10 : 0,
  };
}

function itemToForm(item: PriceBookItem): PriceBookItemInput {
  return {
    sourceSheet: item.sourceSheet,
    sourceStt: item.sourceStt,
    sourceGroupLabel: item.sourceSheet.startsWith('1.') ? 'I' : 'II',
    sku: item.sku,
    name: item.name,
    description: item.description || '',
    unit: item.unit || '',
    defaultQuantity: item.defaultQuantity,
    productImageUrl: item.productImageUrl,
    costMode: item.costMode,
    vendorName: item.vendorName || '',
    listPriceUsd: item.listPriceUsd,
    unitPriceUsd: item.unitPriceUsd,
    unitPriceVndDirect: item.unitPriceVndDirect,
    exchangeRate: item.exchangeRate,
    importDutyPercent: item.importDutyPercent,
    vatInPercent: item.vatInPercent,
    quoteReceivedDate: item.quoteReceivedDate,
    quoteLink: item.quoteLink || '',
    defaultRatePercent: item.defaultRatePercent,
    vatEuPercent: item.vatEuPercent,
    referencePrice: item.referencePrice,
    referenceLink: item.referenceLink || '',
  };
}

interface FlatZoneItem extends PriceBookItem {
  groupLabel: 'I' | 'II';
  costUnit: number | null;
  unitPrice: number | null;
}

/** Che do XEM (khong phai bao gia chinh thuc) - "vnd" la mac dinh/duy nhat
 * dung de nhap/tinh gia THAT; "usd" chi doi CACH HIEN THI sang so quy doi
 * tham khao (costUsd/customerPriceUsd, da tinh THAT o backend bang Decimal
 * - xem attach_usd_conversion() trong price_book_service.py), khong tao/
 * sua du lieu gi. */
type CurrencyView = 'vnd' | 'usd';

export function PriceBookZoneTab() {
  const [statusView, setStatusView] = useState<'draft' | 'published'>('published');
  const [currencyView, setCurrencyView] = useState<CurrencyView>('vnd');
  const [version, setVersion] = useState<PriceBookVersion | null>(null);
  const [items, setItems] = useState<PriceBookItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState<'' | 'I' | 'II'>('');
  const [statusFilter, setStatusFilter] = useState('');

  const [editTarget, setEditTarget] = useState<{ mode: 'add' | 'edit'; id?: string } | null>(null);
  const [form, setForm] = useState<PriceBookItemInput>(emptyForm('I'));
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<PriceBookItem | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);

  // Khoa cuon trang ben ngoai khi Drawer dang mo - dung pattern chung voi
  // ServiceCatalogPage/QuoteWorkspaceModal.
  useEffect(() => {
    if (!editTarget) return;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [editTarget]);

  async function refresh(view: 'draft' | 'published' = statusView) {
    setLoading(true);
    try {
      const result = await priceBookZoneRepository.listItems(view);
      setVersion(result.version);
      setItems(result.items);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không tải được Bảng giá VPS Zone.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh(statusView);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusView]);

  // Bang GOP CHUNG ca Muc I/II (giong dung 1 bang cua "San pham & dich vu",
  // khong tach 2 bang rieng nhu truoc) - "Nhom" hien Muc I/II thay vi ten
  // nhom san pham noi bo.
  const flatItems = useMemo<FlatZoneItem[]>(() => {
    return items.map(item => {
      const p = previewPriceBookItem({
        costMode: item.costMode,
        unitPriceUsd: item.unitPriceUsd,
        exchangeRate: item.exchangeRate,
        unitPriceVndDirect: item.unitPriceVndDirect,
        importDutyPercent: item.importDutyPercent,
        vatInPercent: item.vatInPercent,
        vatEuPercent: item.vatEuPercent,
        defaultQuantity: item.defaultQuantity,
        defaultRatePercent: item.defaultRatePercent,
        referencePrice: item.referencePrice,
      });
      return {
        ...item,
        groupLabel: item.sourceSheet.startsWith('1.') ? 'I' : 'II',
        costUnit: p.costUnit,
        unitPrice: p.unitPrice,
      };
    });
  }, [items]);

  // Dai dien 1 ty gia de hien dong "Tỷ giá: 1 USD = X VNĐ" o dau trang -
  // audit that cho thay ca 9 san pham hien dung CHUNG 1 ty gia (26.326),
  // lay dong dau tien co exchangeRate la du; neu sau nay co ty gia khac
  // nhau giua cac san pham thi dong nay se can doi thanh hien theo tung
  // dong thay vi 1 dong chung (chua xay ra trong du lieu that hien tai).
  const representativeExchangeRate = useMemo(
    () => flatItems.find(item => item.exchangeRate != null)?.exchangeRate ?? null,
    [flatItems]
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return flatItems.filter(item => {
      if (groupFilter && item.groupLabel !== groupFilter) return false;
      if (statusFilter && item.status !== statusFilter) return false;
      if (!term) return true;
      return (
        item.name.toLowerCase().includes(term) ||
        item.sku.toLowerCase().includes(term) ||
        (item.description || '').toLowerCase().includes(term)
      );
    });
  }, [flatItems, search, groupFilter, statusFilter]);

  function openAdd(groupLabel: 'I' | 'II' = 'I') {
    setEditTarget({ mode: 'add' });
    setForm(emptyForm(groupLabel));
    setFormError(null);
  }
  function openEdit(item: PriceBookItem) {
    setEditTarget({ mode: 'edit', id: item.id });
    setForm(itemToForm(item));
    setFormError(null);
  }
  function closeDrawer() {
    setEditTarget(null);
  }

  async function handleSave() {
    if (!form.name.trim() || !form.sku.trim() || !form.sourceStt.trim()) {
      setFormError('Tên, SKU và STT nguồn là bắt buộc.');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      if (editTarget?.mode === 'edit' && editTarget.id) {
        await priceBookZoneRepository.updateItem(editTarget.id, form);
      } else {
        await priceBookZoneRepository.createItem(form);
      }
      setEditTarget(null);
      setNotice('Đã lưu vào bản nháp (Draft).');
      setStatusView('draft');
      await refresh('draft');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Không lưu được sản phẩm.');
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirmDelete() {
    if (!confirmTarget) return;
    try {
      const result = await priceBookZoneRepository.deleteItem(confirmTarget.id);
      setNotice(result.deleted ? 'Đã xoá sản phẩm.' : 'Sản phẩm đã từng dùng trong báo giá — chuyển sang Ngừng kinh doanh.');
      setConfirmTarget(null);
      setStatusView('draft');
      await refresh('draft');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Không xoá được sản phẩm.');
      setConfirmTarget(null);
    }
  }

  async function handleDiscontinue(item: PriceBookItem) {
    try {
      await priceBookZoneRepository.discontinueItem(item.id);
      setNotice('Đã ngừng kinh doanh sản phẩm.');
      setStatusView('draft');
      await refresh('draft');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không cập nhật được trạng thái.');
    }
  }

  async function handlePublish() {
    setPublishing(true);
    try {
      await priceBookZoneRepository.publish();
      setNotice('Đã phát hành phiên bản mới — áp dụng cho báo giá mới từ bây giờ.');
      setStatusView('published');
      await refresh('published');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không phát hành được.');
    } finally {
      setPublishing(false);
    }
  }

  const preview = previewPriceBookItem({
    costMode: form.costMode,
    unitPriceUsd: form.unitPriceUsd,
    exchangeRate: form.exchangeRate,
    unitPriceVndDirect: form.unitPriceVndDirect,
    importDutyPercent: form.importDutyPercent,
    vatInPercent: form.vatInPercent,
    vatEuPercent: form.vatEuPercent,
    defaultQuantity: form.defaultQuantity,
    defaultRatePercent: form.defaultRatePercent,
    referencePrice: form.referencePrice,
  });

  return (
    <div className="sc-tab-panel">
      <div className="sc-pb-toolbar">
        <div className="sc-pb-toolbar-tabs">
          <button
            type="button"
            className={statusView === 'published' ? 'sc-btn sc-btn-primary' : 'sc-btn'}
            onClick={() => setStatusView('published')}
          >
            Đang phát hành
          </button>
          <button
            type="button"
            className={statusView === 'draft' ? 'sc-btn sc-btn-primary' : 'sc-btn'}
            onClick={() => setStatusView('draft')}
          >
            Bản nháp (Draft)
          </button>
          <button
            type="button"
            className="sc-pb-help-btn"
            onClick={() => setGuideOpen(true)}
            title="Hướng dẫn công thức tính giá"
            aria-label="Hướng dẫn công thức tính giá"
          >
            ?
          </button>
        </div>
        {statusView === 'draft' && version ? (
          <button type="button" className="sc-btn sc-btn-primary" onClick={() => void handlePublish()} disabled={publishing}>
            {publishing ? 'Đang phát hành…' : `Phát hành phiên bản ${version.version}`}
          </button>
        ) : null}
      </div>

      {/* Toggle CHI la che do XEM (khong phai bao gia chinh thuc bang USD) -
       * nhan phai ghi ro "Xem quy đổi" de khong ai hieu nham he thong phat
       * hanh bao gia USD. So USD la tinh THAT o backend (Decimal), khong
       * phai gia lap doi ky hieu tien te. */}
      <div className="sc-mode-toggle sc-pb-currency-toggle" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={currencyView === 'vnd'}
          className={currencyView === 'vnd' ? 'active' : ''}
          onClick={() => setCurrencyView('vnd')}
        >
          Giá VNĐ
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={currencyView === 'usd'}
          className={currencyView === 'usd' ? 'active' : ''}
          onClick={() => setCurrencyView('usd')}
        >
          Xem quy đổi USD
        </button>
      </div>
      {currencyView === 'usd' && representativeExchangeRate != null ? (
        <p className="sc-pb-fx-note">
          Tỷ giá: 1 USD = {representativeExchangeRate.toLocaleString('vi-VN')} VNĐ ·{' '}
          <span className="sc-pb-fx-badge">Tham khảo</span>
        </p>
      ) : null}

      {version ? (
        <p style={{ fontSize: 12, color: 'var(--sc-muted, #888)' }}>
          Phiên bản {version.version} — {version.status === 'draft' ? 'Bản nháp, chưa áp dụng cho báo giá mới' : 'Đang áp dụng'}
        </p>
      ) : (
        <p style={{ fontSize: 12, color: 'var(--sc-muted, #888)' }}>Chưa có phiên bản nào.</p>
      )}

      {error ? <div className="sc-error">{error}</div> : null}
      {notice ? <div className="sc-notice">{notice}</div> : null}
      {loading ? <div>Đang tải...</div> : null}

      <div className="sc-toolbar">
        <input
          className="sc-search"
          placeholder="Tìm theo mã, tên, mô tả..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select value={groupFilter} onChange={e => setGroupFilter(e.target.value as '' | 'I' | 'II')}>
          <option value="">Tất cả mục</option>
          <option value="I">Mục I</option>
          <option value="II">Mục II</option>
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">Tất cả trạng thái</option>
          <option value="active">Đang kinh doanh</option>
          <option value="discontinued">Ngừng kinh doanh</option>
        </select>
        {statusView === 'draft' ? (
          <button type="button" className="sc-btn sc-btn-primary" onClick={() => openAdd('I')}>
            + Sản phẩm mới
          </button>
        ) : null}
      </div>

      {!loading ? (
        <div className="sc-table-wrap">
          <table className="sc-table">
            <thead>
              <tr>
                <th>Mã/Sản phẩm</th>
                <th>Nhóm</th>
                <th>ĐVT</th>
                <th>{currencyView === 'usd' ? 'Giá vốn/ĐV (USD)' : 'Giá vốn/ĐV'}</th>
                <th>Markup</th>
                <th>{currencyView === 'usd' ? 'Giá khách/ĐV (USD)' : 'Giá khách/ĐV'}</th>
                <th>VAT</th>
                <th>Trạng thái</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="sc-empty">Không có sản phẩm phù hợp.</td>
                </tr>
              ) : (
                filtered.map(item => (
                  <tr key={item.id}>
                    <td>
                      <div className="sc-cell-title">
                        <div className="sc-cell-name-block">
                          <span className="sc-cell-title-text" title={`${item.sku} — ${item.name}`}>{item.sku} — {item.name}</span>
                          {item.description ? <span className="sc-cell-name-desc" title={item.description}>{item.description}</span> : null}
                        </div>
                      </div>
                    </td>
                    <td>Mục {item.groupLabel}</td>
                    <td>{item.unit || '—'}</td>
                    {currencyView === 'usd' ? (
                      <td className={item.costUsd == null ? 'sc-cell-price-missing' : undefined}>
                        {item.exchangeRate == null ? (
                          <span title="Chưa có tỷ giá, không quy đổi được">—</span>
                        ) : (
                          <>
                            {formatUsd(item.costUsd)} <span className="sc-pb-fx-badge">Tham khảo</span>
                          </>
                        )}
                      </td>
                    ) : (
                      <td className={item.costUnit == null ? 'sc-cell-price-missing' : undefined}>{formatVnd(item.costUnit)}</td>
                    )}
                    <td>{item.defaultRatePercent != null ? `${item.defaultRatePercent}%` : '—'}</td>
                    {currencyView === 'usd' ? (
                      <td>
                        {item.exchangeRate == null ? (
                          <span title="Chưa có tỷ giá, không quy đổi được">—</span>
                        ) : (
                          <>
                            {formatUsd(item.customerPriceUsd)} <span className="sc-pb-fx-badge">Tham khảo</span>
                          </>
                        )}
                      </td>
                    ) : (
                      <td>{formatVnd(item.unitPrice)}</td>
                    )}
                    <td>{item.vatEuPercent ?? 0}%</td>
                    <td>
                      <span className={`sc-badge ${item.status === 'discontinued' ? 'sc-badge-inactive' : 'sc-badge-active'}`}>
                        {item.status === 'active' ? 'Đang kinh doanh' : 'Ngừng kinh doanh'}
                      </span>
                    </td>
                    <td className="sc-row-actions">
                      {statusView === 'draft' ? (
                        <ActionMenu
                          items={[
                            { key: 'view', label: 'Xem chi tiết', icon: Eye, onSelect: () => openEdit(item) },
                            { key: 'edit', label: 'Sửa', icon: Pencil, onSelect: () => openEdit(item) },
                            ...(item.status === 'active'
                              ? [{ key: 'discontinue', label: 'Ngừng kinh doanh', icon: PauseCircle, onSelect: () => void handleDiscontinue(item), group: 2 }]
                              : []),
                            { key: 'delete', label: 'Xoá', icon: Trash2, danger: true, onSelect: () => setConfirmTarget(item), group: 3 },
                          ]}
                        />
                      ) : (
                        <ActionMenu items={[{ key: 'view', label: 'Xem chi tiết (chỉ đọc)', icon: Eye, onSelect: () => openEdit(item) }]} />
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="sc-product-cards">
        {filtered.map(item => (
          <div className="sc-product-card" key={item.id}>
            <div className="sc-cell-title">
              <span className="sc-product-card-title">{item.sku} — {item.name}</span>
              <span className="sc-badge">Mục {item.groupLabel}</span>
            </div>
            {item.description ? <div className="sc-product-card-desc">{item.description}</div> : null}
            <div className="sc-row-sub">{item.unit || '—'}</div>
            <div className="sc-product-card-prices">
              {currencyView === 'usd' ? (
                <>
                  <div className="sc-product-card-price-row">
                    <span>Giá vốn/ĐV (USD)</span>
                    <span>{item.exchangeRate == null ? '—' : <>{formatUsd(item.costUsd)} <span className="sc-pb-fx-badge">Tham khảo</span></>}</span>
                  </div>
                  <div className="sc-product-card-price-row"><span>Markup</span><span>{item.defaultRatePercent != null ? `${item.defaultRatePercent}%` : '—'}</span></div>
                  <div className="sc-product-card-price-row">
                    <span>Giá khách/ĐV (USD)</span>
                    <span>{item.exchangeRate == null ? '—' : <>{formatUsd(item.customerPriceUsd)} <span className="sc-pb-fx-badge">Tham khảo</span></>}</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="sc-product-card-price-row"><span>Giá vốn/ĐV</span><span>{formatVnd(item.costUnit)}</span></div>
                  <div className="sc-product-card-price-row"><span>Markup</span><span>{item.defaultRatePercent != null ? `${item.defaultRatePercent}%` : '—'}</span></div>
                  <div className="sc-product-card-price-row"><span>Giá khách/ĐV</span><span>{formatVnd(item.unitPrice)}</span></div>
                </>
              )}
            </div>
            <span className={`sc-badge ${item.status === 'discontinued' ? 'sc-badge-inactive' : 'sc-badge-active'}`} style={{ alignSelf: 'flex-start' }}>
              {item.status === 'active' ? 'Đang kinh doanh' : 'Ngừng kinh doanh'}
            </span>
            <div className="sc-pb-card-actions">
              <button type="button" className="sc-btn" onClick={() => openEdit(item)}>Xem/Sửa</button>
              {statusView === 'draft' && item.status === 'active' ? (
                <button type="button" className="sc-btn" onClick={() => void handleDiscontinue(item)}>Ngừng kinh doanh</button>
              ) : null}
              {statusView === 'draft' ? (
                <button type="button" className="sc-btn-danger" onClick={() => setConfirmTarget(item)}>Xoá</button>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      {editTarget ? createPortal(
        // Portal thang ra document.body - xem comment chi tiet o ham tuong
        // tu trong ServiceCatalogPage.tsx (bug that: position:fixed bi 1 to
        // tien layout gioi han neu khong qua Portal).
        <div className="sc-drawer-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) closeDrawer(); }}>
          <div className="sc-drawer">
            <div className="sc-drawer-head">
              <div>
                <h2>{editTarget.mode === 'add' ? 'Thêm sản phẩm mới' : 'Chi tiết sản phẩm'}</h2>
                <p>Bảng giá VPS Zone {statusView === 'published' ? '· lưu sẽ tự tạo bản nháp mới, không ảnh hưởng báo giá đã tạo' : '(Draft)'}</p>
              </div>
              <button type="button" className="sc-icon-btn" aria-label="Đóng" onClick={closeDrawer}>
                <X className="qc-inline-icon" />
              </button>
            </div>
            <div className="sc-drawer-body">
              <p className="sc-drawer-section-title">Thông tin sản phẩm</p>
              <div className="sc-panel-grid">
                <label className="sc-field">
                  <span>Mục *</span>
                  <select
                    value={form.sourceGroupLabel}
                    onChange={e => {
                      const label = e.target.value as 'I' | 'II';
                      setForm({ ...form, sourceGroupLabel: label, sourceSheet: label === 'I' ? '1.IN-Software AI' : '2.IN-Software AI' });
                    }}
                  >
                    <option value="I">Mục I</option>
                    <option value="II">Mục II</option>
                  </select>
                </label>
                <label className="sc-field">
                  <span>SKU *</span>
                  <input value={form.sku} onChange={e => setForm({ ...form, sku: e.target.value })} />
                </label>
                <label className="sc-field">
                  <span>STT nguồn (Excel) *</span>
                  <input value={form.sourceStt} onChange={e => setForm({ ...form, sourceStt: e.target.value })} />
                </label>
                <label className="sc-field">
                  <span>Tên sản phẩm *</span>
                  <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
                </label>
                <label className="sc-field">
                  <span>Đơn vị tính</span>
                  <input value={form.unit || ''} onChange={e => setForm({ ...form, unit: e.target.value })} />
                </label>
                <label className="sc-field">
                  <span>SL mặc định</span>
                  <input
                    type="number"
                    value={form.defaultQuantity ?? 1}
                    onChange={e => setForm({ ...form, defaultQuantity: Number(e.target.value) })}
                  />
                </label>
                <label className="sc-field" style={{ gridColumn: '1 / -1' }}>
                  <span>Mô tả (nguyên văn)</span>
                  <textarea
                    value={form.description || ''}
                    onChange={e => setForm({ ...form, description: e.target.value })}
                    rows={4}
                  />
                </label>
              </div>

              <p className="sc-drawer-section-title">Giá vốn</p>
              <div className="sc-panel-grid">
                <label className="sc-field">
                  <span>Chế độ giá vốn</span>
                  {/* Tab toggle VND/USD thay cho <select> cu ("chõ vps zone chưa
                   * có chỗ chuyển đổi giá usd với vnd , cho tab toogle để bật
                   * vnd với usd") - bam chuyen doi ngay, khong can mo dropdown. */}
                  <div className="sc-mode-toggle" role="tablist">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={form.costMode === 'vnd'}
                      className={form.costMode === 'vnd' ? 'active' : ''}
                      onClick={() => setForm({ ...form, costMode: 'vnd' })}
                    >
                      VNĐ trực tiếp
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={form.costMode === 'usd'}
                      className={form.costMode === 'usd' ? 'active' : ''}
                      onClick={() => setForm({ ...form, costMode: 'usd' })}
                    >
                      USD × Tỷ giá
                    </button>
                  </div>
                </label>
                {form.costMode === 'usd' ? (
                  <label className="sc-field">
                    <span>Đơn giá USD</span>
                    <input
                      type="number"
                      value={form.unitPriceUsd ?? ''}
                      onChange={e => setForm({ ...form, unitPriceUsd: e.target.value ? Number(e.target.value) : null })}
                    />
                  </label>
                ) : (
                  <label className="sc-field">
                    <span>Giá vốn VND trực tiếp</span>
                    <input
                      type="number"
                      value={form.unitPriceVndDirect ?? ''}
                      onChange={e => setForm({ ...form, unitPriceVndDirect: e.target.value ? Number(e.target.value) : null })}
                    />
                  </label>
                )}
                {/* Tỷ giá LUON hien bat ke costMode - can de quy doi chieu
                 * nguoc VND->USD (Muc II) cho lop "Xem quy đổi USD" - truoc
                 * day chi hien o mode USD nen 5 san pham Muc II khong co
                 * ty gia nao ca, khong quy doi duoc. */}
                <label className="sc-field">
                  <span>Tỷ giá (USD/VNĐ)</span>
                  <input
                    type="number"
                    value={form.exchangeRate ?? ''}
                    onChange={e => setForm({ ...form, exchangeRate: e.target.value ? Number(e.target.value) : null })}
                    placeholder="Vd: 26326"
                  />
                </label>
                {form.costMode === 'usd' ? (
                  <label className="sc-field">
                    <span>Thuế nhập khẩu (%)</span>
                    <input
                      type="number"
                      value={form.importDutyPercent ?? 0}
                      onChange={e => setForm({ ...form, importDutyPercent: Number(e.target.value) })}
                    />
                  </label>
                ) : null}
                <label className="sc-field">
                  <span>VAT đầu vào (%)</span>
                  <input type="number" value={form.vatInPercent ?? 0} onChange={e => setForm({ ...form, vatInPercent: Number(e.target.value) })} />
                </label>
                <label className="sc-field">
                  <span>Nhà cung cấp (tuỳ chọn)</span>
                  <input value={form.vendorName || ''} onChange={e => setForm({ ...form, vendorName: e.target.value })} />
                </label>
                <label className="sc-field">
                  <span>Link báo giá (tuỳ chọn)</span>
                  <input value={form.quoteLink || ''} onChange={e => setForm({ ...form, quoteLink: e.target.value })} />
                </label>
              </div>

              <p className="sc-drawer-section-title">Giá bán (Markup)</p>
              <div className="sc-panel-grid">
                <label className="sc-field">
                  <span>Markup (Rate) mặc định (%)</span>
                  <input
                    type="number"
                    value={form.defaultRatePercent ?? 0}
                    onChange={e => setForm({ ...form, defaultRatePercent: Number(e.target.value) })}
                  />
                </label>
                <label className="sc-field">
                  <span>VAT đầu ra (%)</span>
                  <input type="number" value={form.vatEuPercent ?? 0} onChange={e => setForm({ ...form, vatEuPercent: Number(e.target.value) })} />
                </label>
                <label className="sc-field">
                  <span>Giá tham chiếu (tuỳ chọn)</span>
                  <input
                    type="number"
                    value={form.referencePrice ?? ''}
                    onChange={e => setForm({ ...form, referencePrice: e.target.value ? Number(e.target.value) : null })}
                  />
                </label>
                <label className="sc-field">
                  <span>Link tham chiếu (tuỳ chọn)</span>
                  <input value={form.referenceLink || ''} onChange={e => setForm({ ...form, referenceLink: e.target.value })} />
                </label>
              </div>

              <p className="sc-drawer-section-title">Xem trước giá bán</p>
              <div className="sc-pricing-preview">
                <div className="sc-pricing-preview-card">
                  <div className="sc-pricing-preview-row"><span>Giá vốn/ĐV</span><span>{formatVnd(preview.costUnit)}</span></div>
                  <div className="sc-pricing-preview-row"><span>Giá khách/ĐV</span><span>{formatVnd(preview.unitPrice)}</span></div>
                  <div className="sc-pricing-preview-row"><span>Khách phải trả (đã gồm thuế)</span><span>{formatVnd(preview.totalAmount)}</span></div>
                  <div className="sc-pricing-preview-row"><span>Margin</span><span>{formatPercent(preview.marginPercent)}</span></div>
                  <div className="sc-pricing-preview-row"><span>So với giá tham chiếu</span><span>{formatPercent(preview.referenceDiffPercent)}</span></div>
                </div>
                <p className="sc-drawer-section-hint">
                  Đây chỉ là số xem trước để tham khảo — khi bấm Lưu, hệ thống sẽ tính lại chính xác toàn bộ.
                </p>
              </div>

              {formError ? <div className="sc-error">{formError}</div> : null}
            </div>
            <div className="sc-drawer-footer">
              <button type="button" className="sc-btn" onClick={closeDrawer}>Huỷ</button>
              <button type="button" className="sc-btn sc-btn-primary" onClick={() => void handleSave()} disabled={saving}>
                {saving ? 'Đang lưu…' : 'Lưu (vào Draft)'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      ) : null}

      <ConfirmModal
        open={Boolean(confirmTarget)}
        title="Xóa sản phẩm"
        message={
          confirmTarget
            ? `Xoá "${confirmTarget.name}"? Nếu sản phẩm đã từng được dùng trong báo giá, hệ thống sẽ tự chuyển sang "Ngừng kinh doanh" thay vì xoá hẳn.`
            : ''
        }
        actions={[{ label: 'Xóa', variant: 'primary', onClick: () => void handleConfirmDelete() }]}
        onClose={() => setConfirmTarget(null)}
      />

      {guideOpen ? (
        <div className="sc-modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setGuideOpen(false); }}>
          <div className="sc-modal">
            <div className="sc-modal-head">
              <strong>Hướng dẫn cách tính giá</strong>
              <button type="button" className="sc-icon-btn" onClick={() => setGuideOpen(false)} aria-label="Đóng">
                ✕
              </button>
            </div>
            <div className="sc-modal-body">
              <p>
                Mỗi sản phẩm có 2 bước tính: <strong>tính giá vốn</strong> (mua vào hết bao nhiêu), rồi <strong>tính giá bán</strong>
                {' '}(bán cho khách bao nhiêu). Bên dưới là 2 cách cho từng bước — chọn đúng 1 cách cho mỗi bước, không dùng cả 2 cùng lúc.
              </p>

              <h4>Bước 1 — Tính giá vốn (mục &quot;Chế độ giá vốn&quot;)</h4>
              <ul>
                <li>
                  <strong>USD × Tỷ giá</strong>: dùng khi mua hàng bằng USD (ví dụ mua qua Anthropic). Nhập <em>Đơn giá USD</em> và{' '}
                  <em>Tỷ giá</em>, hệ thống tự nhân ra tiền Việt. Nếu có thuế nhập khẩu thì nhập thêm % vào ô <em>Thuế nhập khẩu</em>.
                  <br />
                  <span className="sc-row-sub">Ví dụ: 66,66 USD × tỷ giá 26.326 = 1.754.891đ (thuế nhập khẩu 0%).</span>
                </li>
                <li>
                  <strong>VNĐ trực tiếp</strong>: dùng khi đã biết sẵn giá mua bằng tiền Việt (mua qua đại lý trong nước). Chỉ cần
                  nhập thẳng số tiền vào ô <em>Giá vốn VND trực tiếp</em>, không cần quy đổi gì thêm.
                </li>
              </ul>

              <h4>Bước 2 — Tính giá bán (mục &quot;Markup (Rate) mặc định&quot;)</h4>
              <p>
                Ở trang này (Bảng giá chuẩn), giá bán luôn tính từ <strong>Markup %</strong> (phần trăm lời thêm vào giá vốn):
              </p>
              <p className="sc-row-sub">Giá bán = Giá vốn × (1 + Markup%). Ví dụ: 1.754.891đ × (1 + 34,06%) ≈ 2.352.596đ.</p>
              <p>
                Markup ở đây chỉ là <strong>mức đề xuất mặc định</strong>. Khi Sale làm báo giá thật cho khách (bên Quote Workspace),
                Sale có thể đổi cách khác: <strong>gõ thẳng Giá khách</strong> muốn báo, hệ thống sẽ tự tính ngược ra Markup% tương
                ứng — không ảnh hưởng tới Markup mặc định lưu ở đây.
              </p>

              <h4>VAT — tính riêng 2 đầu</h4>
              <p>
                <strong>VAT đầu vào</strong> cộng thêm vào tiền vốn. <strong>VAT đầu ra</strong>{' '}cộng thêm vào tiền bán (ra
                &quot;Khách phải trả&quot;). 2 loại VAT này độc lập nhau, không liên quan tới nhau.
              </p>

              <h4>Giá tham chiếu</h4>
              <p>
                Là giá thị trường/đối thủ để so sánh xem giá mình bán cao hay thấp hơn — chỉ để tham khảo, không ảnh hưởng tới
                công thức tính tiền.
              </p>

              <p className="sc-row-sub">
                Lưu ý: mọi số hiển thị ở khung &quot;Xem trước&quot; chỉ để xem trước — khi bấm Lưu, hệ thống luôn tính lại chính
                xác ở máy chủ.
              </p>
            </div>
            <div className="sc-modal-actions">
              <button type="button" className="sc-btn sc-btn-primary" onClick={() => setGuideOpen(false)}>
                Đã hiểu
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
