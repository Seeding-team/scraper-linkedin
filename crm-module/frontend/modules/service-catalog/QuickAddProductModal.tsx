'use client';

import { useEffect, useMemo, useState } from 'react';
import { X } from '@/modules/crm/components/icons';
import { serviceCatalogRepository } from './repositories/ServiceCatalogRepository';
import type { ServiceCatalogItem, ServiceCatalogItemInput, ServiceCatalogUnit, ServiceCatalogVatRate } from './types';
import { emptyProductForm, formatSkuName, computeCustomerFromMarkup, computeMarkupFromCustomer, parseNullableNumber } from './catalog-form-utils';
import './styles/service-catalog.css';
import '@/modules/crm/styles/quote-center.css';

/** "Tạo nhanh sản phẩm ngay trong popup chọn từ danh mục" (yeu cau muc 2) +
 * "Bấm dấu cộng để thêm hạng mục tự nhập vào Sản phẩm & dịch vụ" (yeu cau
 * muc 5) - DUNG CHUNG 1 component cho ca 2 noi goi (QuoteWorkspaceModal),
 * vi ca 2 deu can dung 1 luong: chon/tao Nhom -> dien thong tin san pham ->
 * luu qua DUNG serviceCatalogRepository.create()/upsertPricing() (dung API/
 * schema/validation/phan quyen voi trang quan ly "Sản phẩm & dịch vụ", KHONG
 * tao bang/nguon du lieu rieng - dung yeu cau ro rang).
 *
 * BUG THAT DA GAP ("modal hẹp cao toàn màn hình, trắng thừa nhiều"): dung
 * .sc-drawer goc (drawer canh phai, height:100vh) du chi vai field - doi
 * sang modal GIUA man hinh, cao theo noi dung (xem .sc-drawer--modal trong
 * service-catalog.css, KHONG doi .sc-drawer goc de khong anh huong cac
 * drawer khac trong module).
 *
 * BUG THAT DA GAP ("bấm + vào sp mà nó fill k đúng"): component nay KHONG
 * unmount giua 2 lan mo (`if (!open) return null` chi an di) - cac state
 * (nameInput/unitInput/costPrice...) truoc day chi khoi tao 1 LAN DUY NHAT
 * qua useState(initialValues) luc MOUNT DAU TIEN, nen lan mo thu 2 tro di
 * (vd bam dau "+" o 1 dong KHAC) van con nguyen du lieu CU. Fix: 1 effect
 * rieng dong bo LAI toan bo form tu initialValues moi lan `open` chuyen
 * sang true.
 *
 * BUG THAT DA GAP ("2 cái ĐVT/VAT không cần cấu hình nữa, cho nhập đi"):
 * yeu cau truoc do bat <select> chi chon tu master data (migration 117) -
 * nay doi lai theo yeu cau moi: cho nhap TU DO (input + datalist goi y tu
 * danh sach hien co), luc luu neu gia tri KHONG khop 1 ĐVT/VAT da co thi TU
 * DONG tao moi thang vao DB (createUnit/createVatRate) - "tự ăn db luôn",
 * khong con bat buoc chon truoc trong trang Cau hinh.
 *
 * Canh bao trung ten/ma (khong chan cung) - so sanh khong dau, khong phan
 * biet hoa/thuong voi `existingItems` (danh sach san pham da tai san co tu
 * catalogTree cua noi goi, khong goi API rieng). */
function foldDiacritics(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

export function QuickAddProductModal({
  open,
  onClose,
  groups,
  existingItems,
  defaultGroupId,
  initialValues,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  /** Danh sach Nhom THAT (id that, khong phai chuoi groupName da flatten) -
   * caller truyen thang catalogTree (list cac item itemType==='group'). */
  groups: ServiceCatalogItem[];
  /** San pham (khong phai nhom) da co san, dung de canh bao trung ten/ma -
   * caller truyen flattenCatalogTree(catalogTree) da co san. */
  existingItems: ServiceCatalogItem[];
  defaultGroupId?: string;
  initialValues?: {
    name?: string;
    unit?: string;
    vatRate?: number;
    unitPriceVnd?: number;
    costPriceVnd?: number | null;
  };
  onCreated: (created: ServiceCatalogItem) => void;
}) {
  const [parentId, setParentId] = useState(defaultGroupId || '');
  const [skuInput, setSkuInput] = useState('');
  const [nameInput, setNameInput] = useState('');
  const [unitInput, setUnitInput] = useState('');
  const [vatInput, setVatInput] = useState('');
  const [costPrice, setCostPrice] = useState('');
  const [markupPercent, setMarkupPercent] = useState('');
  const [customerPrice, setCustomerPrice] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Danh sach ĐVT/VAT hien co - CHI con dung de GOI Y (datalist) + tra cuu
  // id khi gia tri nhap KHOP 1 ban ghi da co, khong con ep chon qua <select>.
  const [units, setUnits] = useState<ServiceCatalogUnit[] | null>(null);
  const [vatRates, setVatRates] = useState<ServiceCatalogVatRate[] | null>(null);

  const [creatingGroup, setCreatingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [groupError, setGroupError] = useState<string | null>(null);
  const [savingGroup, setSavingGroup] = useState(false);
  const [localGroups, setLocalGroups] = useState<ServiceCatalogItem[]>(groups);

  // Dong bo TOAN BO form tu initialValues/defaultGroupId MOI LAN modal mo
  // (khong chi luc mount dau tien) - day chinh la fix cho bug "bấm + vào sp
  // mà nó fill k đúng" (du lieu cu cua lan mo truoc con sot lai vi component
  // khong unmount giua 2 lan mo).
  useEffect(() => {
    if (!open) return;
    setParentId(defaultGroupId || '');
    setSkuInput('');
    setNameInput(initialValues?.name || '');
    setUnitInput(initialValues?.unit || '');
    setVatInput(initialValues?.vatRate != null ? String(initialValues.vatRate) : '');
    setCostPrice(initialValues?.costPriceVnd != null ? String(initialValues.costPriceVnd) : '');
    setMarkupPercent('');
    setCustomerPrice(initialValues?.unitPriceVnd != null ? String(initialValues.unitPriceVnd) : '');
    setDescription('');
    setError(null);
    setFieldErrors({});
    setCreatingGroup(false);
    setNewGroupName('');
    setGroupError(null);
    setLocalGroups(groups);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setLocalGroups(groups);
  }, [open, groups]);

  useEffect(() => {
    if (!open || units !== null) return;
    serviceCatalogRepository.listUnits(false).then(setUnits).catch(() => setUnits([]));
  }, [open, units]);
  useEffect(() => {
    if (!open || vatRates !== null) return;
    serviceCatalogRepository.listVatRates(false).then(setVatRates).catch(() => setVatRates([]));
  }, [open, vatRates]);

  // BUG THAT DA GAP ("tên khác mà sao báo trùng"): logic cu dung
  // `folded.includes(term) || term.includes(folded)` - so KHOP CON CHUOI,
  // nen "testtt" bi bao trung voi "test" (chi vi "test" la 1 doan con cua
  // "testtt") du 2 ten THAT SU khac nhau. Chi con canh bao khi ten (sau khi
  // fold dau/hoa-thuong) TRUNG KHOP TOAN BO voi 1 san pham da co - dung y
  // nghia "trùng tên" that su, khong con bao gia lung tung voi bat ky ten
  // nao chua 1 doan chu giong nhau.
  const duplicateWarning = useMemo(() => {
    const term = foldDiacritics(nameInput);
    if (!term) return null;
    const matches = existingItems.filter(item => foldDiacritics(item.name) === term);
    if (matches.length === 0) return null;
    return `Đã có sản phẩm trùng tên: ${matches.slice(0, 3).map(m => formatSkuName(m.sku, m.name)).join(', ')}${matches.length > 3 ? '…' : ''}`;
  }, [nameInput, existingItems]);

  // Nhap Gia von + Markup -> tu tinh Gia ban; nhap Gia ban -> cap nhat lai
  // Markup (dung LAI DUNG cong thuc computeCustomerFromMarkup/
  // computeMarkupFromCustomer da co san o trang quan ly, khong viet cong
  // thuc rieng thu 2).
  function handleCostChange(raw: string) {
    setCostPrice(raw);
    const cost = parseNullableNumber(raw);
    const markup = parseNullableNumber(markupPercent);
    const computed = computeCustomerFromMarkup(cost, markup);
    if (computed != null) setCustomerPrice(String(Math.round(computed)));
  }
  function handleMarkupChange(raw: string) {
    setMarkupPercent(raw);
    const cost = parseNullableNumber(costPrice);
    const markup = parseNullableNumber(raw);
    const computed = computeCustomerFromMarkup(cost, markup);
    if (computed != null) setCustomerPrice(String(Math.round(computed)));
  }
  function handleCustomerPriceChange(raw: string) {
    setCustomerPrice(raw);
    const cost = parseNullableNumber(costPrice);
    const customer = parseNullableNumber(raw);
    const computed = computeMarkupFromCustomer(cost, customer);
    if (computed != null) setMarkupPercent(computed.toFixed(2));
  }

  async function handleCreateGroupInline() {
    if (!newGroupName.trim()) {
      setGroupError('Tên nhóm bắt buộc.');
      return;
    }
    setSavingGroup(true);
    setGroupError(null);
    try {
      const created = await serviceCatalogRepository.create({
        itemType: 'group',
        name: newGroupName.trim(),
        status: 'active',
      });
      setLocalGroups(prev => [...prev, created]);
      setParentId(created.id);
      setNewGroupName('');
      setCreatingGroup(false);
    } catch (err) {
      setGroupError(err instanceof Error ? err.message : 'Không tạo được nhóm sản phẩm.');
    } finally {
      setSavingGroup(false);
    }
  }

  function validate(): Record<string, string> {
    const errs: Record<string, string> = {};
    if (!nameInput.trim()) errs.name = 'Tên sản phẩm bắt buộc.';
    if (!parentId) errs.parentId = 'Vui lòng chọn nhóm sản phẩm.';
    const markup = parseNullableNumber(markupPercent);
    if (markup != null && !Number.isFinite(markup)) errs.markup = 'Markup không hợp lệ.';
    if (vatInput.trim() !== '' && !Number.isFinite(Number(vatInput))) errs.vat = 'VAT phải là số.';
    return errs;
  }

  // "2 cái này k cần cấu hình nữa mà cho nhập đi, r tự ăn db luôn" - ĐVT/VAT
  // gio la INPUT TU DO: neu gia tri go khop (khong phan biet hoa/thuong voi
  // ĐVT, dung so voi VAT) 1 ban ghi master data da co thi DUNG LAI id do; neu
  // KHONG khop thi TU TAO MOI thang vao DB qua dung API cua trang "Cấu hình"
  // (createUnit/createVatRate) - Sale khong con phai vao trang Cau hinh truoc.
  async function resolveUnitName(raw: string): Promise<string> {
    const trimmed = raw.trim();
    if (!trimmed) return '';
    const existing = (units || []).find(u => u.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) return existing.name;
    try {
      const created = await serviceCatalogRepository.createUnit(trimmed);
      setUnits(prev => (prev ? [...prev, created] : [created]));
      return created.name;
    } catch {
      // Tao ĐVT moi that bai (vd trung ten do race condition) - van dung
      // nguyen gia tri go, KHONG chan viec luu san pham.
      return trimmed;
    }
  }
  async function resolveVatRate(raw: string): Promise<number> {
    const trimmed = raw.trim();
    if (trimmed === '') return 0;
    const value = Number(trimmed);
    if (!Number.isFinite(value)) return 0;
    const existing = (vatRates || []).find(v => v.rate === value);
    if (existing) return existing.rate;
    try {
      const created = await serviceCatalogRepository.createVatRate(value);
      setVatRates(prev => (prev ? [...prev, created] : [created]));
      return created.rate;
    } catch {
      return value;
    }
  }

  async function handleSave() {
    const errs = validate();
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) {
      setError(null);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const [unitName, vatRate] = await Promise.all([resolveUnitName(unitInput), resolveVatRate(vatInput)]);
      const created = await serviceCatalogRepository.create({
        ...emptyProductForm(parentId),
        parentId,
        sku: skuInput.trim() || undefined,
        name: nameInput.trim(),
        unit: unitName,
        defaultVatRate: vatRate,
        defaultUnitPriceVnd: parseNullableNumber(customerPrice) ?? 0,
        description: description.trim() || undefined,
      });
      const parsedCost = parseNullableNumber(costPrice);
      const parsedMarkup = parseNullableNumber(markupPercent);
      let hydratedCreated = created;
      if (parsedCost != null || parsedMarkup != null) {
        const pricing = await serviceCatalogRepository.upsertPricing(created.id, {
          issuerCompanyId: null,
          defaultCostPriceVnd: parsedCost,
          defaultMarkupPercent: parsedMarkup,
          defaultCustomerPriceVnd: parseNullableNumber(customerPrice),
          pricingInputMode: parsedMarkup != null ? 'markup' : 'customer_price',
        });
        hydratedCreated = {
          ...created,
          defaultCostPriceVnd: pricing.defaultCostPriceVnd,
          defaultMarkupPercent: pricing.defaultMarkupPercent,
          defaultCustomerPriceVnd: pricing.defaultCustomerPriceVnd,
        };
      }
      onCreated(hydratedCreated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không tạo được sản phẩm.');
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div className="qc-modal-backdrop qc-modal-backdrop--nested" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="sc-drawer sc-drawer--modal" onMouseDown={event => event.stopPropagation()}>
        <div className="sc-drawer-head">
          <div>
            <h2>Thêm sản phẩm mới</h2>
            <p>Lưu trực tiếp vào &quot;Sản phẩm &amp; dịch vụ&quot;</p>
          </div>
          <button type="button" className="sc-icon-btn" aria-label="Đóng" onClick={onClose}>
            <X className="qc-inline-icon" />
          </button>
        </div>
        <div className="sc-drawer-body">
          <div className="sc-panel-grid sc-panel-grid--2col">
            <label className="sc-field" style={{ gridColumn: '1 / -1' }}>
              <span>Nhóm sản phẩm *</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <select
                  style={{ flex: 1 }}
                  value={parentId}
                  onChange={e => setParentId(e.target.value)}
                >
                  <option value="">-- Chọn nhóm --</option>
                  {localGroups.map(group => (
                    <option key={group.id} value={group.id}>{group.name}</option>
                  ))}
                </select>
                {creatingGroup ? (
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                    <input
                      className="sc-search"
                      style={{ width: 140 }}
                      placeholder="Tên nhóm mới"
                      value={newGroupName}
                      onChange={e => setNewGroupName(e.target.value)}
                    />
                    <button type="button" className="sc-btn sc-btn-primary" disabled={savingGroup} onClick={() => void handleCreateGroupInline()}>
                      {savingGroup ? '...' : 'Lưu'}
                    </button>
                    <button type="button" className="sc-btn" onClick={() => { setCreatingGroup(false); setGroupError(null); }}>Huỷ</button>
                  </div>
                ) : (
                  <button type="button" className="sc-btn" style={{ flexShrink: 0 }} onClick={() => setCreatingGroup(true)}>+ Nhóm mới</button>
                )}
              </div>
              {fieldErrors.parentId ? <div className="sc-error">{fieldErrors.parentId}</div> : null}
              {groupError ? <div className="sc-error">{groupError}</div> : null}
            </label>

            <label className="sc-field">
              <span>Mã sản phẩm (SKU)</span>
              <input value={skuInput} onChange={e => setSkuInput(e.target.value)} placeholder="Tự sinh nếu để trống" />
            </label>
            <label className="sc-field">
              <span>Tên sản phẩm *</span>
              <input value={nameInput} onChange={e => setNameInput(e.target.value)} />
              {fieldErrors.name ? <div className="sc-error">{fieldErrors.name}</div> : null}
            </label>

            {/* ĐVT/VAT - input tu do THUAN TUY (KHONG con list=/<datalist>) -
             * yeu cau rieng "bấm dô cho điền th k xổ ra" (thuoc tinh
             * list= khien trinh duyet tu xo dropdown goi y ra ngay luc bam
             * vao o, gay vuong khi go). Gia tri khong khop danh sach hien co
             * se TU DONG tao moi luc bam Luu san pham (xem resolveUnitName/
             * resolveVatRate) - hanh vi tao-moi-tu-dong KHONG doi, chi bo
             * phan goi y xo ra tu dong. */}
            <label className="sc-field">
              <span>Đơn vị tính</span>
              <input
                value={unitInput}
                onChange={e => setUnitInput(e.target.value)}
                placeholder="vd: Gói/tháng"
              />
            </label>
            <label className="sc-field">
              <span>VAT (%)</span>
              <input
                type="number"
                value={vatInput}
                onChange={e => setVatInput(e.target.value)}
                placeholder="vd: 10"
              />
              {fieldErrors.vat ? <div className="sc-error">{fieldErrors.vat}</div> : null}
            </label>

            <label className="sc-field">
              <span>Giá vốn/ĐV mặc định</span>
              <input type="number" placeholder="Chưa nhập" value={costPrice} onChange={e => handleCostChange(e.target.value)} />
            </label>
            <label className="sc-field">
              <span>Markup mặc định (%)</span>
              <input type="number" step="0.01" placeholder="Chưa nhập" value={markupPercent} onChange={e => handleMarkupChange(e.target.value)} />
              {fieldErrors.markup ? <div className="sc-error">{fieldErrors.markup}</div> : null}
            </label>

            <label className="sc-field" style={{ gridColumn: '1 / -1' }}>
              <span>Giá bán/ĐV mặc định</span>
              <input type="number" placeholder="Tự tính từ Giá vốn + Markup, hoặc nhập tay" value={customerPrice} onChange={e => handleCustomerPriceChange(e.target.value)} />
            </label>

            <label className="sc-field" style={{ gridColumn: '1 / -1' }}>
              <span>Mô tả</span>
              <textarea value={description} onChange={e => setDescription(e.target.value)} />
            </label>
          </div>
          {duplicateWarning ? <div className="sc-notice" style={{ color: '#b45309' }}>{duplicateWarning}</div> : null}
          {error ? <div className="sc-error">{error}</div> : null}
        </div>
        <div className="sc-drawer-footer">
          <button type="button" className="sc-btn" onClick={onClose}>Huỷ</button>
          <button type="button" className="sc-btn sc-btn-primary" disabled={saving} onClick={() => void handleSave()}>
            {saving ? 'Đang lưu...' : 'Lưu sản phẩm'}
          </button>
        </div>
      </div>
    </div>
  );
}
