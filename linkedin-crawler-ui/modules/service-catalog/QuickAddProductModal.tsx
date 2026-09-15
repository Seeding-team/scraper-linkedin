'use client';

/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useMemo, useState } from 'react';

import { serviceCatalogRepository } from './repositories/ServiceCatalogRepository';
import type { ServiceCatalogItem, ServiceCatalogItemInput, ServiceCatalogUnit, ServiceCatalogVatRate } from './types';
import { usePricingLogic } from './usePricingLogic';
import { emptyProductForm, formatSkuName, parseNullableNumber } from './catalog-form-utils';
import './styles/service-catalog.css';
import '@/modules/crm/styles/quote-center.css';
import { SearchableSelect } from '@/modules/crm/components/SearchableSelect';
import { CrmVendorSelect } from '@/modules/crm/components/CrmVendorSelect';
import { VendorImportFlow } from './VendorImportFlow';
import { ChevronDown, ChevronUp, CheckCircle2, Info, Building2, Box, X } from 'lucide-react';

function foldDiacritics(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function formatCurrency(val: number | string | null | undefined): string {
  if (typeof val === "number") return new Intl.NumberFormat("vi-VN").format(val);
  const n = typeof val === "string" ? parseNullableNumber(val) : null;
  if (n == null) return '0';
  return new Intl.NumberFormat('vi-VN').format(n);
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
  groups: ServiceCatalogItem[];
  existingItems: ServiceCatalogItem[];
  defaultGroupId?: string;
  initialValues?: {
    name?: string;
    unit?: string;
    vatRate?: number;
    unitPriceVnd?: number;
    costPrice?: number | null;
    costPriceVnd?: number | null;
  };
  onCreated: (created: ServiceCatalogItem) => void;
}) {
  const [activeTab, setActiveTab] = useState<'manual' | 'vendor'>('manual');

  const [parentId, setParentId] = useState(defaultGroupId || '');
  const [skuInput, setSkuInput] = useState('');
  const [nameInput, setNameInput] = useState('');
  const [unitInput, setUnitInput] = useState('');
  const [vatInput, setVatInput] = useState('');
  const [status, setStatus] = useState('active');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [brand, setBrand] = useState('');
  const [productType, setProductType] = useState('');
  const [vendorPartNumber, setVendorPartNumber] = useState('');
  const [internalNote, setInternalNote] = useState('');

  const { state: pricing, setState: setPricingState, updateField: setPricingField, getProfit, getMargin } = usePricingLogic();

  const [units, setUnits] = useState<ServiceCatalogUnit[] | null>(null);
  const [vatRates, setVatRates] = useState<ServiceCatalogVatRate[] | null>(null);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [groupError, setGroupError] = useState<string | null>(null);
  const [savingGroup, setSavingGroup] = useState(false);
  const [creatingGroupInDrawer, setCreatingGroupInDrawer] = useState(false);
  const [newGroupNameInDrawer, setNewGroupNameInDrawer] = useState('');
  const [groupErrorInDrawer, setGroupErrorInDrawer] = useState<string | null>(null);
  const [savingGroupInDrawer, setSavingGroupInDrawer] = useState(false);
  const [localGroups, setLocalGroups] = useState<ServiceCatalogItem[]>(groups);
  const [managingGroups, setManagingGroups] = useState(false);
  const [groupQuery, setGroupQuery] = useState('');
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingGroupName, setEditingGroupName] = useState('');

  const [showAdvancedInfo, setShowAdvancedInfo] = useState(false);
  const [showAdvancedCost, setShowAdvancedCost] = useState(false);
  const [showAdvancedSales, setShowAdvancedSales] = useState(false);


  useEffect(() => {
    if (open) {
      setParentId(defaultGroupId || '');
      setLocalGroups(groups);
      setSkuInput('');
      setNameInput(initialValues?.name || '');
      setUnitInput(initialValues?.unit || '');
      setVatInput(initialValues?.vatRate != null ? String(initialValues.vatRate) : '');
      setDescription('');
      setError(null);
      setFieldErrors({});
      setActiveTab('manual');
      setBrand('');
      setProductType('');
      setVendorPartNumber('');
      setInternalNote('');
      const initialCost = initialValues?.costPriceVnd ?? initialValues?.costPrice ?? 0;
      const initialPrice = initialValues?.unitPriceVnd ?? 0;
      setPricingState(prev => ({
        ...prev,
        pricingInputMode: initialPrice > 0 ? 'price' : 'cost',
        supplierCurrency: 'VND',
        supplierListPrice: initialCost,
        supplierDiscountPercent: 0,
        supplierNetPrice: initialCost,
        supplierExchangeRate: 25400,
        supplierConvertedPrice: initialCost,
        supplierVendorId: undefined,
        supplierQuoteRef: undefined,
        supplierQuoteSource: undefined,
        supplierQuoteDate: undefined,
        supplierValidUntil: undefined,
        shippingCost: 0,
        importFee: 0,
        otherCost: 0,
        pricingPolicy: 'catalog_default',
        costPriceVnd: initialCost,
        markupPercent: initialCost > 0 && initialPrice > 0 ? ((initialPrice - initialCost) / initialCost) * 100 : 0,
        customerPriceVnd: initialPrice,
      }));
    }
  }, [open, defaultGroupId, initialValues, groups, setPricingState]);



  useEffect(() => {
    if (!units) {
      serviceCatalogRepository.listUnits().then(res => setUnits(res)).catch(() => {});
      serviceCatalogRepository.listVatRates().then(res => setVatRates(res)).catch(() => {});
    }
  }, [units]);

  const duplicateWarning = useMemo(() => {
    if (!nameInput.trim() && !skuInput.trim()) return null;
    const cmpName = foldDiacritics(nameInput);
    const cmpSku = foldDiacritics(skuInput);
    const found = existingItems.find(item => {
      if (cmpSku && item.sku && foldDiacritics(item.sku) === cmpSku) return true;
      if (cmpName && item.name && foldDiacritics(item.name) === cmpName) return true;
      return false;
    });
    if (!found) return null;
    return `Sản phẩm tương tự có thể đã tồn tại: ${formatSkuName(found.sku, found.name)} (Nhóm: ${found.groupName || '?'}).`;
  }, [nameInput, skuInput, existingItems]);

  async function handleCreateGroupInline() {
    const trimmed = newGroupName.trim();
    if (!trimmed) {
      setGroupError('Vui lòng nhập tên nhóm.');
      return;
    }
    setSavingGroup(true);
    setGroupError(null);
    try {
      const created = await serviceCatalogRepository.create({ itemType: 'group', name: trimmed, status: 'active' });
      setLocalGroups(prev => [...prev, created]);
      setParentId(created.id);
      setFieldErrors(prev => ({ ...prev, parentId: '' }));
      setCreatingGroup(false);
      setNewGroupName('');
    } catch (err) {
      setGroupError(err instanceof Error ? err.message : 'Không tạo được nhóm.');
    } finally {
      setSavingGroup(false);
    }
  }

  async function handleCreateGroupInlineInDrawer() {
    const trimmed = newGroupNameInDrawer.trim();
    if (!trimmed) {
      setGroupErrorInDrawer('Vui lòng nhập tên nhóm.');
      return;
    }
    setSavingGroupInDrawer(true);
    setGroupErrorInDrawer(null);
    try {
      const created = await serviceCatalogRepository.create({ itemType: 'group', name: trimmed, status: 'active' });
      setLocalGroups(prev => [...prev, created]);
      setParentId(created.id);
      setFieldErrors(prev => ({ ...prev, parentId: '' }));
      setCreatingGroupInDrawer(false);
      setNewGroupNameInDrawer('');
    } catch (err) {
      setGroupErrorInDrawer(err instanceof Error ? err.message : 'Không tạo được nhóm.');
    } finally {
      setSavingGroupInDrawer(false);
    }
  }

  async function handleUpdateGroupInline(group: ServiceCatalogItem, patch: { name?: string; status?: 'active' | 'inactive' }) {
    const nextName = patch.name != null ? patch.name.trim() : undefined;
    if (patch.name != null && !nextName) {
      setGroupError('Vui lòng nhập tên nhóm.');
      return;
    }
    setSavingGroup(true);
    setGroupError(null);
    try {
      const updated = await serviceCatalogRepository.update(group.id, {
        itemType: 'group',
        name: nextName ?? group.name,
        status: patch.status ?? group.status,
      });
      setLocalGroups(prev => prev.map(item => item.id === group.id ? { ...item, ...updated } : item));
      setEditingGroupId(null);
      setEditingGroupName('');
    } catch (err) {
      setGroupError(err instanceof Error ? err.message : 'Khong cap nhat duoc nhom.');
    } finally {
      setSavingGroup(false);
    }
  }

    function validate() {
    const errs: Record<string, string> = {};
    if (!parentId) errs.parentId = 'Vui lòng chọn nhóm sản phẩm.';
    if (!nameInput.trim()) errs.name = 'Vui lòng nhập tên sản phẩm.';
    if (pricing.markupPercent < -100) errs.markup = 'Markup không hợp lệ.';
    return errs;
  }

  async function resolveUnitName(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const match = (units || []).find(u => u.name.toLowerCase() === trimmed.toLowerCase());
    if (match) return match.name;
    try {
      const created = await serviceCatalogRepository.createUnit(trimmed);
      return created.name;
    } catch {
      return trimmed;
    }
  }

  async function resolveVatRate(value: string) {
    const parsed = parseNullableNumber(value);
    if (parsed == null) return 0;
    const match = (vatRates || []).find(v => v.rate === parsed);
    if (match) return match.rate;
    try {
      const created = await serviceCatalogRepository.createVatRate(parsed);
      return created.rate;
    } catch {
      return parsed;
    }
  }

  async function handleSave() {
    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      setError('Vui lòng kiểm tra lại thông tin có lỗi màu đỏ.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload: ServiceCatalogItemInput = {
        ...emptyProductForm(),
        parentId,
        sku: skuInput.trim() || undefined,
        name: nameInput.trim(),
        unit: await resolveUnitName(unitInput),
        defaultVatRate: await resolveVatRate(vatInput),
        defaultUnitPriceVnd: pricing.customerPriceVnd || undefined,
        description: description.trim() || undefined,
        status: 'active',
        brand: brand.trim() || undefined,
        partNumber: vendorPartNumber.trim() || undefined,
        productType: productType.trim() || undefined,
        internalNote: internalNote.trim() || undefined,
        supplierCurrency: pricing.supplierCurrency,
        supplierListPrice: pricing.supplierListPrice || undefined,
        supplierDiscountPercent: pricing.supplierDiscountPercent || undefined,
        supplierNetPrice: pricing.supplierNetPrice || undefined,
        supplierExchangeRate: pricing.supplierExchangeRate || undefined,
        supplierConvertedPrice: pricing.supplierConvertedPrice || undefined,
        supplierVendorId: pricing.supplierVendorId || undefined,
        supplierQuoteRef: pricing.supplierQuoteRef || undefined,
        supplierQuoteSource: pricing.supplierQuoteSource || undefined,
        supplierQuoteDate: pricing.supplierQuoteDate || undefined,
        supplierValidUntil: pricing.supplierValidUntil || undefined,
        shippingCost: pricing.shippingCost || undefined,
        importFee: pricing.importFee || undefined,
        otherCost: pricing.otherCost || undefined,
        pricingInputMode: pricing.pricingInputMode,
        defaultCostPriceVnd: pricing.costPriceVnd || undefined,
        defaultMarkupPercent: pricing.markupPercent || undefined,
        defaultCustomerPriceVnd: pricing.customerPriceVnd || undefined,
        pricingPolicy: pricing.pricingPolicy || undefined,
      };
      const created = await serviceCatalogRepository.create(payload);
      onCreated(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Đã có lỗi xảy ra khi lưu.');
    } finally {
      setSaving(false);
    }
  }

  // Hooks phai goi VO DIEU KIEN truoc moi early return (Rules of Hooks) - filteredGroups
  // tung nam SAU `if (!open) return null` ben duoi, khien so luong hook goi ra it hon 1
  // khi modal dang dong (open=false) so voi khi mo (open=true) -> React error #310
  // "Rendered more hooks than during the previous render" moi lan modal chuyen dong/mo.
  const filteredGroups = useMemo(() => {
    const q = foldDiacritics(groupQuery);
    if (!q) return localGroups;
    return localGroups.filter(group => foldDiacritics(group.name || '').includes(q));
  }, [groupQuery, localGroups]);

  if (!open) return null;

  const costVal = pricing.costPriceVnd;
  const priceVal = pricing.customerPriceVnd;
  const profit = getProfit();
  const margin = getMargin();
  const pricingValid = priceVal >= costVal;

  return (
    <div className="qc-modal-backdrop qc-modal-backdrop--nested" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="sc-drawer sc-drawer--modal relative flex flex-col bg-[#fff7fa]" style={{ maxWidth: '1200px', width: '95vw', maxHeight: '95vh' }} onMouseDown={event => event.stopPropagation()}>

        {/* Header */}
        <div className="flex flex-col gap-4 border-b border-[#f3d5de] bg-white p-6 pb-4 shrink-0 rounded-t-xl">
          <div className="flex justify-between items-start">
            <div>
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-semibold text-slate-900 m-0">Thêm sản phẩm mới</h2>
                <div className="flex gap-2">
                  <span className="px-2.5 py-0.5 rounded-full bg-[#fde2eb] text-[#a91549] text-xs font-medium">VND mặc định</span>
                  <span className="px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-700 text-xs font-medium">Tự tính giá</span>
                </div>
              </div>
              <p className="mt-1.5 text-sm text-slate-500">Tạo sản phẩm, thiết lập giá vốn & chính sách giá bán tiêu chuẩn.</p>
            </div>
            <button type="button" className="text-slate-400 hover:text-slate-600 transition-colors" onClick={onClose}>
              <X size={24} />
            </button>
          </div>

          {/* 2 Choice Cards */}
          <div className="grid grid-cols-2 gap-4 mt-2">
            <div
              onClick={() => setActiveTab('manual')}
              className={`flex items-center gap-3 p-4 rounded-lg border-2 cursor-pointer transition-all ${activeTab === 'manual' ? 'border-[#2563eb] bg-[#eff6ff] shadow-sm' : 'border-slate-200 bg-white hover:border-slate-300'}`}
            >
              <div className={`p-2 rounded-md ${activeTab === 'manual' ? 'bg-[#dbeafe] text-[#2563eb]' : 'bg-slate-100 text-slate-500'}`}>
                <Box size={20} />
              </div>
              <div>
                <div className={`font-semibold ${activeTab === 'manual' ? 'text-[#1d4ed8]' : 'text-slate-700'}`}>Nhập từng sản phẩm</div>
                <div className="text-xs text-slate-500 mt-0.5">Điền thủ công thông tin sản phẩm và giá</div>
              </div>
            </div>
            <div
              onClick={() => setActiveTab('vendor')}
              className={`flex items-center gap-3 p-4 rounded-lg border-2 cursor-pointer transition-all ${activeTab === 'vendor' ? 'border-[#c2185b] bg-[#fff1f6] shadow-sm' : 'border-slate-200 bg-white hover:border-slate-300'}`}
            >
              <div className={`p-2 rounded-md ${activeTab === 'vendor' ? 'bg-[#fde2eb] text-[#c2185b]' : 'bg-slate-100 text-slate-500'}`}>
                <Building2 size={20} />
              </div>
              <div>
                <div className={`font-semibold ${activeTab === 'vendor' ? 'text-[#c2185b]' : 'text-slate-700'}`}>Lấy từ file Vendor (OCR)</div>
                <div className="text-xs text-slate-500 mt-0.5">Tải lên báo giá PDF/Excel của nhà cung cấp</div>
              </div>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {activeTab === 'vendor' ? (
            <div className="bg-white border border-[#ead8df] rounded-xl p-5 shadow-sm">
              <VendorImportFlow onClose={onClose} />
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-6">

              {/* Left Column - 75% */}
              <div className="col-span-3 flex flex-col gap-6">

                {duplicateWarning && (
                  <div className="bg-amber-50 border border-amber-200 text-amber-800 p-4 rounded-lg flex gap-3 text-sm">
                    <Info size={18} className="shrink-0 mt-0.5" />
                    <div>{duplicateWarning}</div>
                  </div>
                )}

                {/* Card 1: Thông tin chính */}
                <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/50">
                    <h3 className="font-semibold text-slate-800">Thông tin chính</h3>
                  </div>
                  <div className="p-5">
                    <div className="grid grid-cols-2 gap-x-6 gap-y-5">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1.5">Mã sản phẩm (SKU)</label>
                        <input className="w-full h-9 px-3 border border-slate-300 rounded-md text-sm focus:border-[#c2185b] focus:ring-1 focus:ring-[#c2185b]" placeholder="Tự sinh nếu để trống" value={skuInput} onChange={e => setSkuInput(e.target.value)} />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1.5">Tên sản phẩm <span className="text-[#c2185b]">*</span></label>
                        <input className="w-full h-9 px-3 border border-slate-300 rounded-md text-sm focus:border-[#c2185b] focus:ring-1 focus:ring-[#c2185b]" placeholder="Nhập tên sản phẩm" value={nameInput} onChange={e => setNameInput(e.target.value)} />
                        {fieldErrors.name && <div className="text-[#c2185b] text-xs mt-1">{fieldErrors.name}</div>}
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1.5">Hãng </label>
                        <input className="w-full h-9 px-3 border border-slate-300 rounded-md text-sm focus:border-[#c2185b] focus:ring-1 focus:ring-[#c2185b] bg-slate-50" placeholder="vd: Dell, HP..." value={brand} onChange={e => setBrand(e.target.value)} />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1.5">Nhóm sản phẩm <span className="text-[#c2185b]">*</span></label>
                        <SearchableSelect
                          value={parentId}
                          onChange={v => setParentId(v)}
                          options={localGroups.map(g => ({ value: g.id, label: g.name || '' }))}
                          placeholder="-- Chọn nhóm --"
                          actions={[
                            { key: 'add', label: '+ Thêm nhóm mới', type: 'add', onSelect: () => setCreatingGroup(true) },
                            { key: 'manage', label: 'Quản lý nhóm', type: 'manage', onSelect: () => setManagingGroups(true) },
                          ]}
                        />
                        {localGroups.length === 0 && !creatingGroup && (
                          <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                            <div className="font-medium">Chưa có nhóm sản phẩm.</div>
                            <button type="button" className="mt-2 px-3 py-1 bg-[#c2185b] text-white rounded text-sm font-medium hover:bg-[#a91549]" onClick={() => setCreatingGroup(true)}>
                              + Tạo nhóm đầu tiên
                            </button>
                          </div>
                        )}
                        {creatingGroup && (
                          <div className="flex gap-2 mt-2 p-2 bg-slate-50 border border-slate-200 rounded-md">
                            <input autoFocus className="flex-1 h-8 px-2 border border-slate-300 rounded text-sm" placeholder="Tên nhóm mới" value={newGroupName} onChange={e => setNewGroupName(e.target.value)} />
                            <button type="button" className="px-3 py-1 bg-[#c2185b] text-white rounded text-sm font-medium hover:bg-[#a91549] disabled:opacity-50" disabled={savingGroup} onClick={handleCreateGroupInline}>{savingGroup ? '...' : 'Lưu'}</button>
                            <button type="button" className="px-3 py-1 bg-slate-200 text-slate-700 rounded text-sm font-medium hover:bg-slate-300" onClick={() => { setCreatingGroup(false); setGroupError(null); }}>Hủy</button>
                          </div>
                        )}
                        {fieldErrors.parentId && <div className="text-[#c2185b] text-xs mt-1">{fieldErrors.parentId}</div>}
                        {groupError && <div className="text-[#c2185b] text-xs mt-1">{groupError}</div>}
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1.5">Đơn vị tính</label>
                        {/* ĐVT that su la master (migration 117, Cau hinh DVT & VAT -
                            ServiceCatalogConfigPage) - truoc day input nay chi la text
                            tu do, chi "hoi" master luc save (resolveUnitName) roi tu
                            dong tao moi neu go sai chinh ta, gay phinh to master ngoai
                            y muon. Dung <datalist> de goi y THAT tu units da fetch san
                            (khong hardcode), van cho go tu do neu chua co trong danh
                            sach (giu nguyen hanh vi quick-create hien tai o resolveUnitName). */}
                        <input
                          className="w-full h-9 px-3 border border-slate-300 rounded-md text-sm focus:border-[#c2185b] focus:ring-1 focus:ring-[#c2185b]"
                          placeholder="vd: Cái, Gói/tháng"
                          value={unitInput}
                          onChange={e => setUnitInput(e.target.value)}
                          list="qap-unit-options"
                        />
                        <datalist id="qap-unit-options">
                          {(units || []).filter(u => u.status === 'active').map(u => <option key={u.id} value={u.name} />)}
                        </datalist>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1.5">VAT (%)</label>
                          <input
                            type="number"
                            className="w-full h-9 px-3 border border-slate-300 rounded-md text-sm focus:border-[#c2185b] focus:ring-1 focus:ring-[#c2185b]"
                            placeholder="10"
                            value={vatInput}
                            onChange={e => setVatInput(e.target.value)}
                            list="qap-vat-options"
                          />
                          <datalist id="qap-vat-options">
                            {(vatRates || []).filter(v => v.status === 'active').map(v => <option key={v.id} value={v.rate} />)}
                          </datalist>
                          {fieldErrors.vat && <div className="text-[#c2185b] text-xs mt-1">{fieldErrors.vat}</div>}
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1.5">Trạng thái</label>
                          <select className="w-full h-9 px-3 border border-slate-300 rounded-md text-sm focus:border-[#c2185b] focus:ring-1 focus:ring-[#c2185b]" value={status} onChange={e => setStatus(e.target.value)}>
                            <option value="active">Đang kinh doanh</option>
                            <option value="inactive">Ngừng kinh doanh</option>
                          </select>
                        </div>
                      </div>
                    </div>

                    {/* Advanced Info */}
                    <div className="mt-5 pt-4 border-t border-slate-100">
                      <button type="button" className="flex items-center gap-1.5 text-sm font-medium text-[#c2185b] hover:text-[#a91549]" onClick={() => setShowAdvancedInfo(!showAdvancedInfo)}>
                        {showAdvancedInfo ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        Thông tin mở rộng
                      </button>
                      {showAdvancedInfo && (
                        <div className="grid grid-cols-2 gap-6 mt-4">
                          <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1.5">Part Number Vendor </label>
                            <input className="w-full h-9 px-3 border border-slate-300 rounded-md text-sm focus:border-[#c2185b] bg-slate-50" value={vendorPartNumber} onChange={e => setVendorPartNumber(e.target.value)} />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1.5">Loại sản phẩm </label>
                            <input className="w-full h-9 px-3 border border-slate-300 rounded-md text-sm focus:border-[#c2185b] bg-slate-50" value={productType} onChange={e => setProductType(e.target.value)} />
                          </div>
                          <div className="col-span-2">
                            <label className="block text-sm font-medium text-slate-700 mb-1.5">Mô tả chi tiết</label>
                            <textarea className="w-full p-3 border border-slate-300 rounded-md text-sm focus:border-[#c2185b] min-h-[80px]" placeholder="Nhập mô tả sản phẩm..." value={description} onChange={e => setDescription(e.target.value)} />
                          </div>
                          <div className="col-span-2">
                            <label className="block text-sm font-medium text-slate-700 mb-1.5">Ghi chú nội bộ</label>
                            <textarea className="w-full p-3 border border-slate-300 rounded-md text-sm focus:border-[#c2185b] min-h-[80px]" placeholder="Ghi chú nội bộ (không hiển thị cho khách)..." value={internalNote} onChange={e => setInternalNote(e.target.value)} />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Card 2: Giá mua / Giá vốn */}
                <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
                    <h3 className="font-semibold text-slate-800">Giá mua / Giá vốn</h3>
                    <div className="flex bg-slate-100 rounded-lg p-0.5 border border-slate-200">
                      <button type="button" className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${pricing.supplierCurrency === 'VND' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`} onClick={() => setPricingField('supplierCurrency', 'VND')}>VND</button>
                      <button type="button" className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${pricing.supplierCurrency === 'USD' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`} onClick={() => setPricingField('supplierCurrency', 'USD')}>USD</button>
                    </div>
                  </div>
                  <div className="p-5">
                    <div className="grid grid-cols-3 gap-6">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1.5">Giá niêm yết NCC </label>
                        <div className="relative">
                          <input type="number" className="w-full h-9 pl-3 pr-10 border border-slate-300 rounded-md text-sm focus:border-[#c2185b] bg-slate-50" value={pricing.supplierListPrice || ''} onChange={e => setPricingField('supplierListPrice', Number(e.target.value))} />
                          <span className="absolute right-3 top-2 text-xs font-medium text-slate-400">{pricing.supplierCurrency}</span>
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1.5">Chiết khấu NCC </label>
                        <div className="relative">
                          <input type="number" className="w-full h-9 pl-3 pr-8 border border-slate-300 rounded-md text-sm focus:border-[#c2185b] bg-slate-50" placeholder="0" value={pricing.supplierDiscountPercent || ''} onChange={e => setPricingField('supplierDiscountPercent', Number(e.target.value))} />
                          <span className="absolute right-3 top-2 text-xs font-medium text-slate-400">%</span>
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1.5">Giá mua sau CK</label>
                        <div className="relative">
                          <input type="number" className="w-full h-9 pl-3 pr-10 border border-slate-300 rounded-md text-sm focus:border-[#c2185b]" value={pricing.supplierNetPrice || ''} onChange={e => setPricingField('supplierNetPrice', Number(e.target.value))} />
                          <span className="absolute right-3 top-2 text-xs font-medium text-slate-400">{pricing.supplierCurrency}</span>
                        </div>
                      </div>
                    </div>

                    <div className="mt-5 p-4 bg-slate-50 border border-slate-100 rounded-lg">
                      <div className="grid grid-cols-3 gap-6">
                        <div>
                          <label className="block text-xs font-medium text-slate-500 mb-1">Tỷ giá VND/USD</label>
                          <input type="number" className="w-full h-8 px-2 border border-slate-300 rounded text-sm disabled:bg-slate-100 disabled:text-slate-400" value={pricing.supplierExchangeRate || ''} onChange={e => setPricingField('supplierExchangeRate', Number(e.target.value))} disabled={pricing.supplierCurrency === 'VND'} />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-500 mb-1">Giá mua quy đổi</label>
                          <div className="h-8 flex items-center text-sm font-semibold text-slate-700">
                            {formatCurrency(pricing.supplierConvertedPrice)} <span className="text-xs text-slate-400 font-normal ml-1">VND</span>
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">GIÁ VỐN / ĐVT (VND)</label>
                          <input type="number" className="w-full h-8 px-2 border border-[#f3b8ca] bg-[#fff1f6] rounded text-sm focus:border-[#c2185b] font-semibold text-[#a91549]" value={pricing.costPriceVnd || ''} onChange={e => setPricingField('costPriceVnd', Number(e.target.value))} />
                        </div>
                      </div>
                    </div>

                    <div className="mt-4">
                      <button type="button" className="flex items-center gap-1.5 text-sm font-medium text-[#c2185b] hover:text-[#a91549]" onClick={() => setShowAdvancedCost(!showAdvancedCost)}>
                        {showAdvancedCost ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        Nguồn giá & chi phí cộng thêm
                      </button>
                      {showAdvancedCost && (
                        <div className="mt-3 grid grid-cols-3 gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
                          <div className="col-span-3">
                            <label className="block text-xs font-medium text-slate-600 mb-1">Nha cung cap / Vendor</label>
                            <CrmVendorSelect value={pricing.supplierVendorId || ''} onChange={value => setPricingField('supplierVendorId', value || undefined)} placeholder="-- Chon Vendor --" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-600 mb-1">So bao gia / Ref</label>
                            <input className="w-full h-9 px-3 border border-slate-300 rounded-md text-sm focus:border-[#c2185b]" value={pricing.supplierQuoteRef || ''} onChange={e => setPricingField('supplierQuoteRef', e.target.value)} />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-600 mb-1">Nguon xac nhan</label>
                            <select className="w-full h-9 px-3 border border-slate-300 rounded-md text-sm focus:border-[#c2185b]" value={pricing.supplierQuoteSource || ''} onChange={e => setPricingField('supplierQuoteSource', e.target.value)}>
                              <option value="">-- Chon nguon --</option>
                              <option value="vendor_quote">Bao gia Vendor</option>
                              <option value="email">Email</option>
                              <option value="contract">Hop dong/PO</option>
                              <option value="manual">Nhap tay</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-600 mb-1">Ngay bao gia</label>
                            <input type="date" className="w-full h-9 px-3 border border-slate-300 rounded-md text-sm focus:border-[#c2185b]" value={pricing.supplierQuoteDate || ''} onChange={e => setPricingField('supplierQuoteDate', e.target.value)} />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-600 mb-1">Hieu luc den</label>
                            <input type="date" className="w-full h-9 px-3 border border-slate-300 rounded-md text-sm focus:border-[#c2185b]" value={pricing.supplierValidUntil || ''} onChange={e => setPricingField('supplierValidUntil', e.target.value)} />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-600 mb-1">Phi van chuyen</label>
                            <input type="number" className="w-full h-9 px-3 border border-slate-300 rounded-md text-sm focus:border-[#c2185b]" value={pricing.shippingCost || ''} onChange={e => setPricingField('shippingCost', Number(e.target.value) || 0)} />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-600 mb-1">Phi nhap khau / xu ly</label>
                            <input type="number" className="w-full h-9 px-3 border border-slate-300 rounded-md text-sm focus:border-[#c2185b]" value={pricing.importFee || ''} onChange={e => setPricingField('importFee', Number(e.target.value) || 0)} />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-600 mb-1">Chi phi khac</label>
                            <input type="number" className="w-full h-9 px-3 border border-slate-300 rounded-md text-sm focus:border-[#c2185b]" value={pricing.otherCost || ''} onChange={e => setPricingField('otherCost', Number(e.target.value) || 0)} />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Card 3: Giá bán mặc định */}
                <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/50">
                    <h3 className="font-semibold text-slate-800">Giá bán mặc định</h3>
                  </div>
                  <div className="p-5">
                    <div className="flex items-center gap-4">
                      <div className="flex-1">
                        <label className="block text-sm font-medium text-slate-700 mb-1.5">Giá vốn</label>
                        <div className="h-9 px-3 flex items-center border border-slate-200 bg-slate-50 rounded-md text-sm text-slate-500">
                          {formatCurrency(pricing.costPriceVnd)}
                        </div>
                      </div>
                      <div className="text-slate-400 mt-6 shrink-0">→</div>
                      <div className="flex-1">
                        <label className="block text-sm font-medium text-slate-700 mb-1.5">Markup mặc định</label>
                        <div className="relative">
                          <input type="number" className="w-full h-9 pl-3 pr-8 border border-slate-300 rounded-md text-sm focus:border-[#c2185b]" placeholder="0" value={pricing.markupPercent || ''} onChange={e => setPricingField('markupPercent', parseNullableNumber(e.target.value) ?? 0)} />
                          <span className="absolute right-3 top-2 text-xs font-medium text-slate-400">%</span>
                        </div>
                        {fieldErrors.markup && <div className="text-[#c2185b] text-xs mt-1">{fieldErrors.markup}</div>}
                      </div>
                      <div className="text-slate-400 mt-6 shrink-0">→</div>
                      <div className="flex-1">
                        <label className="block text-sm font-medium text-slate-900 mb-1.5">GIÁ BÁN / ĐVT (VND)</label>
                        <input type="number" className="w-full h-9 px-3 border-2 border-emerald-500 rounded-md text-sm font-bold text-emerald-700 focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600" value={pricing.customerPriceVnd || ''} onChange={e => setPricingField('customerPriceVnd', parseNullableNumber(e.target.value) ?? 0)} />
                      </div>
                    </div>

                    <div className="grid grid-cols-4 gap-4 mt-6 pt-5 border-t border-slate-100">
                      <div>
                        <div className="text-xs font-medium text-slate-500 mb-1">Lãi gộp</div>
                        <div className={`text-sm font-semibold ${profit > 0 ? 'text-emerald-600' : profit < 0 ? 'text-[#c2185b]' : 'text-slate-700'}`}>
                          {formatCurrency(profit)} <span className="text-xs font-normal text-slate-400">VND</span>
                        </div>
                      </div>
                      <div>
                        <div className="text-xs font-medium text-slate-500 mb-1">Biên lợi nhuận</div>
                        <div className={`text-sm font-semibold ${margin > 0 ? 'text-emerald-600' : margin < 0 ? 'text-[#c2185b]' : 'text-slate-700'}`}>
                          {margin.toFixed(2)}%
                        </div>
                      </div>
                      <div>
                        <div className="text-xs font-medium text-slate-500 mb-1">Giảm giá mặc định </div>
                        <div className="text-sm text-slate-400">-</div>
                      </div>
                      <div>
                        <div className="text-xs font-medium text-slate-500 mb-1">Giá sau giảm</div>
                        <div className="text-sm font-semibold text-slate-700">{formatCurrency(priceVal)}</div>
                      </div>
                    </div>

                    <div className="mt-5">
                      <button type="button" className="flex items-center gap-1.5 text-sm font-medium text-[#c2185b] hover:text-[#a91549]" onClick={() => setShowAdvancedSales(!showAdvancedSales)}>
                        {showAdvancedSales ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        Chính sách giá nâng cao
                      </button>
                      {showAdvancedSales && (
                        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
                          <label className="block text-xs font-medium text-slate-600 mb-2">Chính sách áp giá</label>
                          <div className="grid grid-cols-3 gap-3">
                            {[
                              ['catalog_default', 'Giá mặc định cho Catalog'],
                              ['sale_override_allowed', 'Cho phép Sale override'],
                              ['internal_only', 'Chỉ dùng nội bộ'],
                            ].map(([value, label]) => (
                              <button
                                key={value}
                                type="button"
                                className={`rounded-lg border px-3 py-2 text-left text-xs font-medium transition-colors ${pricing.pricingPolicy === value ? 'border-[#c2185b] bg-[#fff1f6] text-[#a91549] ring-1 ring-[#c2185b]' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'}`}
                                onClick={() => setPricingField('pricingPolicy', value)}
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Column - 25% Sticky */}
              <div className="col-span-1">
                <div className="sticky top-6 bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden flex flex-col">
                  <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/50">
                    <h3 className="font-semibold text-slate-800">Tóm tắt giá</h3>
                  </div>
                  <div className="p-5 flex flex-col gap-4">

                    <div>
                      <div className="text-xs font-medium text-slate-500 mb-1 uppercase">Giá bán / ĐVT</div>
                      <div className="text-2xl font-bold text-emerald-600">{formatCurrency(priceVal)}</div>
                    </div>

                    <div className="h-px bg-slate-100 w-full my-1"></div>

                    <div className="flex justify-between items-center">
                      <span className="text-sm text-slate-600">Giá vốn</span>
                      <span className="text-sm font-semibold text-slate-800">{formatCurrency(costVal)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-slate-600">Lãi gộp</span>
                      <span className={`text-sm font-semibold ${profit > 0 ? 'text-emerald-600' : profit < 0 ? 'text-[#c2185b]' : 'text-slate-800'}`}>{formatCurrency(profit)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-slate-600">Biên lợi nhuận</span>
                      <span className={`text-sm font-semibold ${margin > 0 ? 'text-emerald-600' : margin < 0 ? 'text-[#c2185b]' : 'text-slate-800'}`}>{margin.toFixed(2)}%</span>
                    </div>

                    <div className="mt-2 p-3 bg-slate-50 border border-slate-200 rounded-lg flex flex-col gap-2">
                      <div className="flex items-center gap-2 text-sm">
                        <CheckCircle2 size={16} className={pricingValid && priceVal > 0 ? 'text-emerald-500' : 'text-slate-300'} />
                        <span className={pricingValid && priceVal > 0 ? 'text-slate-700' : 'text-slate-400'}>Pricing hợp lệ</span>
                      </div>
                      <div className="flex items-center gap-2 text-sm">
                        <CheckCircle2 size={16} className={margin >= 15 ? 'text-emerald-500' : 'text-slate-300'} />
                        <span className={margin >= 15 ? 'text-slate-700' : 'text-slate-400'}>Biên LN đạt chuẩn (&gt;15%)</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

            </div>
          )}
        </div>

        {managingGroups && activeTab === 'manual' && (
          <div className="absolute inset-y-0 right-0 z-20 w-[420px] max-w-full border-l border-slate-200 bg-white shadow-2xl flex flex-col rounded-r-xl">
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
              <div>
                <h3 className="m-0 text-base font-semibold text-slate-900">Quản lý nhóm sản phẩm</h3>
                <p className="mt-1 text-xs text-slate-500">Tìm, sửa tên và bật/tắt trạng thái nhóm trong danh mục sản phẩm.</p>
              </div>
              <button type="button" className="text-slate-400 hover:text-slate-700" onClick={() => { setManagingGroups(false); setCreatingGroupInDrawer(false); setNewGroupNameInDrawer(''); setGroupErrorInDrawer(null); }}>
                <X size={20} />
              </button>
            </div>
            <div className="border-b border-slate-100 p-4">
              <div className="mb-3 flex items-center gap-2">
                <input
                  className="h-9 flex-1 rounded-md border border-slate-300 px-3 text-sm focus:border-[#c2185b] focus:ring-1 focus:ring-[#c2185b]"
                  placeholder="Tìm nhóm..."
                  value={groupQuery}
                  onChange={event => setGroupQuery(event.target.value)}
                />
                <button type="button" className="shrink-0 rounded-md bg-[#c2185b] px-3 py-2 text-sm font-medium text-white hover:bg-[#a91549]" onClick={() => setCreatingGroupInDrawer(true)}>
                  + Thêm nhóm sản phẩm
                </button>
              </div>
              {creatingGroupInDrawer && (
                <div className="flex gap-2 rounded-md border border-slate-200 bg-slate-50 p-2">
                  <input autoFocus className="h-8 flex-1 rounded border border-slate-300 px-2 text-sm" placeholder="Tên nhóm mới" value={newGroupNameInDrawer} onChange={e => setNewGroupNameInDrawer(e.target.value)} />
                  <button type="button" className="rounded bg-[#c2185b] px-3 py-1 text-sm font-medium text-white hover:bg-[#a91549] disabled:opacity-50" disabled={savingGroupInDrawer} onClick={handleCreateGroupInlineInDrawer}>{savingGroupInDrawer ? '...' : 'Lưu'}</button>
                  <button type="button" className="rounded bg-slate-200 px-3 py-1 text-sm font-medium text-slate-700 hover:bg-slate-300" onClick={() => { setCreatingGroupInDrawer(false); setGroupErrorInDrawer(null); }}>Hủy</button>
                </div>
              )}
              {groupErrorInDrawer && <div className="mt-2 text-xs font-medium text-[#c2185b]">{groupErrorInDrawer}</div>}
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {filteredGroups.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-300 p-5 text-center text-sm text-slate-500">Không có nhóm phù hợp.</div>
              ) : (
                <div className="space-y-2">
                  {filteredGroups.map(group => {
                    const editing = editingGroupId === group.id;
                    return (
                      <div key={group.id} className="rounded-lg border border-slate-200 p-3">
                        <div className="flex items-center gap-2">
                          {editing ? (
                            <input
                              className="h-8 flex-1 rounded border border-slate-300 px-2 text-sm"
                              value={editingGroupName}
                              onChange={event => setEditingGroupName(event.target.value)}
                            />
                          ) : (
                            <button
                              type="button"
                              className="min-w-0 flex-1 truncate text-left text-sm font-semibold text-slate-800"
                              onClick={() => setParentId(group.id)}
                              title="Chọn nhóm này"
                            >
                              {group.name}
                            </button>
                          )}
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${group.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                            {group.status === 'active' ? 'Đang sử dụng' : 'Đã ngừng'}
                          </span>
                        </div>
                        <div className="mt-3 flex justify-end gap-2">
                          {editing ? (
                            <>
                              <button type="button" className="rounded border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50" onClick={() => { setEditingGroupId(null); setEditingGroupName(''); }}>
                                Hủy
                              </button>
                              <button type="button" className="rounded bg-[#c2185b] px-3 py-1 text-xs font-semibold text-white hover:bg-[#a91549] disabled:opacity-50" disabled={savingGroup} onClick={() => handleUpdateGroupInline(group, { name: editingGroupName })}>
                                Lưu
                              </button>
                            </>
                          ) : (
                            <>
                              <button type="button" className="rounded border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50" onClick={() => { setEditingGroupId(group.id); setEditingGroupName(group.name || ''); }}>
                                Sửa
                              </button>
                              <button type="button" className="rounded border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50" disabled={savingGroup} onClick={() => handleUpdateGroupInline(group, { status: group.status === 'active' ? 'inactive' : 'active' })}>
                                {group.status === 'active' ? 'Ngừng sử dụng' : 'Kích hoạt lại'}
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className={`justify-between items-center p-4 border-t border-slate-200 bg-white shrink-0 rounded-b-xl ${activeTab === 'vendor' ? 'hidden' : 'flex'}`}>
          <div className="flex-1">
            {error && <div className="text-[#c2185b] text-sm font-medium">{error}</div>}
          </div>
          <div className="flex gap-3">
            <button type="button" className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors" onClick={onClose}>
              Lưu nháp
            </button>
            <button type="button" className="px-4 py-2 text-sm font-medium text-white bg-[#c2185b] rounded-lg hover:bg-[#a91549] transition-colors disabled:opacity-50 flex items-center gap-2 shadow-sm" disabled={saving || activeTab === 'vendor'} onClick={handleSave}>
              {saving ? 'Đang lưu...' : 'Tạo sản phẩm & lưu giá'}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
