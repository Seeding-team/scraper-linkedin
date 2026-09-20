'use client';

/* eslint-disable react-hooks/set-state-in-effect */
import { CatalogPickerModal } from './CatalogPickerModal';

import { useEffect, useMemo, useState } from 'react';

import { serviceCatalogRepository } from './repositories/ServiceCatalogRepository';
import type { BundleComponentInput, ServiceCatalogItem, ServiceCatalogItemInput, ServiceCatalogUnit, ServiceCatalogVatRate } from './types';
import { usePricingLogic } from './usePricingLogic';
import { emptyProductForm, formatSkuName, parseNullableNumber } from './catalog-form-utils';
import { targetGrossMarginFromCustomerPrice } from './pricing-math';
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

type QuickBundleComponent = BundleComponentInput & {
  sku?: string;
  name?: string;
  unit?: string;
  defaultCustomerPriceVnd?: number | null;
  defaultCostPriceVnd?: number | null;
};

export function QuickAddProductModal({
  open,
  onClose,
  groups,
  existingItems,
  defaultGroupId,
  initialValues,
  onCreated,
  editingItem,
  onUpdated,
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
  editingItem?: ServiceCatalogItem;
  onUpdated?: (updated: ServiceCatalogItem) => void;
}) {
  const [activeTab, setActiveTab] = useState<'manual' | 'vendor'>('manual');

  const [itemType, setItemType] = useState<'component' | 'bundle'>('component');
  const [bundleComponents, setBundleComponents] = useState<QuickBundleComponent[]>([]);
  const [bundleMonthlyPrice, setBundleMonthlyPrice] = useState('');
  const [bundleAnnualMonthlyPrice, setBundleAnnualMonthlyPrice] = useState('');
  const [bundleAnnualTotalPrice, setBundleAnnualTotalPrice] = useState('');
  const [bundleCostPrice, setBundleCostPrice] = useState('');
  const [bundleDiscount, setBundleDiscount] = useState('');
  const [showComponentPicker, setShowComponentPicker] = useState(false);
  const [showNestedAdd, setShowNestedAdd] = useState(false);


  const [parentId, setParentId] = useState(defaultGroupId || '');
  const [skuInput, setSkuInput] = useState('');
  const [nameInput, setNameInput] = useState('');
  const [unitInput, setUnitInput] = useState('');
  const [vatInput, setVatInput] = useState('');
  const [status, setStatus] = useState('active');
  const [customerVisible, setCustomerVisible] = useState(true);
  // Quota / diem noi bat cua goi - CHI dung khi itemType==='bundle' (component
  // khong co khai niem quota nguoi dung/kenh/tin nhan, day la thuoc tinh cua
  // ca goi Combo - xem migration 141 service_catalog_items.quota_*).
  const [bundleQuotaUserLabel, setBundleQuotaUserLabel] = useState('');
  const [bundleQuotaChannelsLabel, setBundleQuotaChannelsLabel] = useState('');
  const [bundleQuotaMessagesLabel, setBundleQuotaMessagesLabel] = useState('');
  const [bundleQuotaAiData, setBundleQuotaAiData] = useState('');
  const [bundleQuotaHighlights, setBundleQuotaHighlights] = useState('');
  const [description, setDescription] = useState('');
  const [note, setNote] = useState('');
  const [quoteDisplayName, setQuoteDisplayName] = useState('');
  const [quoteDescription, setQuoteDescription] = useState('');
  const [quoteCta, setQuoteCta] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [brand, setBrand] = useState('');
  const [productType, setProductType] = useState('');
  const [vendorPartNumber, setVendorPartNumber] = useState('');
  const [internalNote, setInternalNote] = useState('');

  const { state: pricing, setState: setPricingState, updateField: setPricingField, getProfit } = usePricingLogic();

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
      setLocalGroups(groups);
      if (editingItem) {
        setItemType(editingItem.itemType === 'bundle' ? 'bundle' : 'component');
        setSkuInput(editingItem.sku || '');
        setNameInput(editingItem.name || '');
        setUnitInput(editingItem.unit || '');
        setVatInput(editingItem.defaultVatRate != null ? String(editingItem.defaultVatRate) : '');
        setStatus(editingItem.status || 'active');
        setDescription(editingItem.description || '');
        setNote(editingItem.note || '');
        setQuoteDisplayName(editingItem.quoteDisplayName || '');
        setQuoteDescription(editingItem.quoteDescription || '');
        setQuoteCta(editingItem.quoteCta || '');
        setParentId(editingItem.parentId || defaultGroupId || '');
        setBrand(editingItem.brand || '');
        setProductType(editingItem.productType || '');
        setVendorPartNumber(editingItem.partNumber || '');
        setInternalNote(editingItem.internalNote || '');
        setCustomerVisible(editingItem.customerVisible ?? true);

        if (editingItem.itemType === 'bundle') {
          setBundleMonthlyPrice(editingItem.monthlyPriceVnd != null ? String(editingItem.monthlyPriceVnd) : '');
          setBundleAnnualMonthlyPrice(editingItem.annualCommitMonthlyPriceVnd != null ? String(editingItem.annualCommitMonthlyPriceVnd) : '');
          setBundleAnnualTotalPrice(editingItem.annualTotalPriceVnd != null ? String(editingItem.annualTotalPriceVnd) : '');
          setBundleCostPrice(editingItem.defaultCostPriceVnd != null ? String(editingItem.defaultCostPriceVnd) : '');
          setBundleDiscount(editingItem.maxSaleDiscountPercent != null ? String(editingItem.maxSaleDiscountPercent) : '');
          setBundleQuotaUserLabel(editingItem.quotaUserLabel || (editingItem.quotaUserCount != null ? String(editingItem.quotaUserCount) : ''));
          setBundleQuotaChannelsLabel(editingItem.quotaConnectedChannelsLabel || (editingItem.quotaConnectedChannels != null ? String(editingItem.quotaConnectedChannels) : ''));
          setBundleQuotaMessagesLabel(editingItem.quotaMessagesPerMonthLabel || (editingItem.quotaMessagesPerMonth != null ? String(editingItem.quotaMessagesPerMonth) : ''));
          setBundleQuotaAiData(editingItem.quotaAiData || '');
          setBundleQuotaHighlights(editingItem.quotaHighlights || '');
          setPricingState(prev => ({
            ...prev,
            costPriceVnd: editingItem.defaultCostPriceVnd ?? 0,
            customerPriceVnd: editingItem.monthlyPriceVnd ?? editingItem.defaultCustomerPriceVnd ?? 0,
            markupPercent: editingItem.defaultMarkupPercent ?? 0,
          }));

          if (editingItem.components) {
            setBundleComponents(editingItem.components.map((c, index) => ({
              ...c,
              quantity: c.quantity ?? 1,
              sortOrder: c.sortOrder ?? index,
              sku: c.sku || '',
              name: c.name || '',
              unit: c.unit || '',
            })));
          }
        } else {
          setPricingState({
            pricingInputMode: editingItem.pricingInputMode || 'cost',
            supplierCurrency: editingItem.supplierCurrency === 'USD' ? 'USD' : 'VND',
            supplierListPrice: editingItem.supplierListPrice ?? 0,
            supplierDiscountPercent: editingItem.supplierDiscountPercent ?? 0,
            supplierNetPrice: editingItem.supplierNetPrice ?? 0,
            supplierExchangeRate: editingItem.supplierExchangeRate ?? 25400,
            supplierConvertedPrice: editingItem.supplierConvertedPrice ?? 0,
            supplierVendorId: editingItem.supplierVendorId || '',
            supplierQuoteRef: editingItem.supplierQuoteRef || '',
            supplierQuoteSource: editingItem.supplierQuoteSource || '',
            supplierQuoteDate: editingItem.supplierQuoteDate || '',
            supplierValidUntil: editingItem.supplierValidUntil || '',
            shippingCost: editingItem.shippingCost ?? 0,
            importFee: editingItem.importFee ?? 0,
            otherCost: editingItem.otherCost ?? 0,
            pricingPolicy: editingItem.pricingPolicy || '',
            costPriceVnd: editingItem.defaultCostPriceVnd ?? 0,
            markupPercent: editingItem.defaultMarkupPercent ?? 0,
            customerPriceVnd: editingItem.defaultCustomerPriceVnd ?? editingItem.defaultUnitPriceVnd ?? 0,
          });
          setBundleComponents([]);
        }
      } else {
        // Reset form
        setItemType('component');
        setBundleComponents([]);
        setBundleMonthlyPrice('');
        setBundleAnnualMonthlyPrice('');
        setBundleAnnualTotalPrice('');
        setBundleCostPrice('');
        setBundleDiscount('');
        setBundleQuotaUserLabel('');
        setBundleQuotaChannelsLabel('');
        setBundleQuotaMessagesLabel('');
        setBundleQuotaAiData('');
        setBundleQuotaHighlights('');
        setCustomerVisible(true);
        setSkuInput('');
        setNameInput('');
        setDescription('');
        setNote('');
        setQuoteDisplayName('');
        setQuoteDescription('');
        setQuoteCta('');
        setStatus('active');
        setBrand('');
        setProductType('');
        setVendorPartNumber('');
        setInternalNote('');
        // keep default values...
      }
    }
  }, [open, editingItem, defaultGroupId, groups, setPricingState]);

  useEffect(() => {
    if (open && !editingItem) {
      setParentId(defaultGroupId || '');
      setLocalGroups(groups);
      setSkuInput('');
      setNameInput(initialValues?.name || '');
      setUnitInput(initialValues?.unit || '');
      setVatInput(initialValues?.vatRate != null ? String(initialValues.vatRate) : '');
      setDescription('');
      setNote('');
      setQuoteDisplayName('');
      setQuoteDescription('');
      setQuoteCta('');
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
        markupPercent: targetGrossMarginFromCustomerPrice(initialCost, initialPrice) ?? 0,
        customerPriceVnd: initialPrice,
      }));
    }
  }, [open, editingItem, defaultGroupId, initialValues, groups, setPricingState]);



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
      if (editingItem && item.id === editingItem.id) return false;
      if (cmpSku && item.sku && foldDiacritics(item.sku) === cmpSku) return true;
      if (cmpName && item.name && foldDiacritics(item.name) === cmpName) return true;
      return false;
    });
    if (!found) return null;
    return `Sản phẩm tương tự có thể đã tồn tại: ${formatSkuName(found.sku, found.name)} (Nhóm: ${found.groupName || '?'}).`;
  }, [nameInput, skuInput, existingItems, editingItem]);

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
    if (pricing.markupPercent >= 100) errs.markup = 'Markup phải nhỏ hơn 100%.';
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

  function updateBundleComponent(index: number, patch: Partial<QuickBundleComponent>) {
    setBundleComponents(prev => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
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
      const resolvedUnit = await resolveUnitName(unitInput);
      const resolvedVatRate = await resolveVatRate(vatInput);
      const cleanText = (value: string) => value.trim();
      const cleanOptionalText = (value: string) => {
        const trimmed = value.trim();
        return trimmed ? trimmed : undefined;
      };
      const cleanDate = (value?: string) => {
        const trimmed = (value || '').trim();
        return trimmed ? trimmed : undefined;
      };
      const payload: ServiceCatalogItemInput = itemType === 'bundle'
        ? {
            ...emptyProductForm(),
            itemType: 'bundle',
            parentId,
            sku: cleanText(skuInput),
            name: nameInput.trim(),
            unit: resolvedUnit,
            defaultVatRate: resolvedVatRate,
            description: cleanText(description),
            note: cleanText(note),
            quoteDisplayName: cleanText(quoteDisplayName),
            quoteDescription: cleanText(quoteDescription),
            quoteCta: cleanText(quoteCta),
            status: status as 'active' | 'inactive',
            customerVisible,
            brand: cleanText(brand),
            partNumber: cleanText(vendorPartNumber),
            productType: cleanText(productType),
            internalNote: cleanText(internalNote),
            quotaUserLabel: cleanText(bundleQuotaUserLabel),
            quotaUserCount: parseNullableNumber(bundleQuotaUserLabel),
            quotaConnectedChannelsLabel: cleanText(bundleQuotaChannelsLabel),
            quotaConnectedChannels: parseNullableNumber(bundleQuotaChannelsLabel),
            quotaMessagesPerMonthLabel: cleanText(bundleQuotaMessagesLabel),
            quotaMessagesPerMonth: parseNullableNumber(bundleQuotaMessagesLabel),
            quotaAiData: cleanText(bundleQuotaAiData),
            quotaHighlights: cleanText(bundleQuotaHighlights),
            // emptyProductForm() mac dinh 2 field nay la CHUOI RONG (dung cho
            // component - vendor quote date), nhung cot DB la kieu date - gui
            // "" thay vi bo qua se bi Postgres tu choi (22007 invalid input
            // syntax for type date). Bundle khong dung 2 field vendor nay nen
            // luon bo qua (undefined), khac component (giu nguyen hanh vi cu).
            supplierQuoteDate: undefined,
            supplierValidUntil: undefined,
            // Bundle dung gia nhap tay (Card "Gia goi"), KHONG suy tu vendor
            // cost/markup nhu component thuong (xem ServiceCatalogProductsTable.tsx
            // handleSave() - cung 1 quy uoc).
            monthlyPriceVnd: parseNullableNumber(bundleMonthlyPrice),
            annualCommitMonthlyPriceVnd: parseNullableNumber(bundleAnnualMonthlyPrice),
            annualTotalPriceVnd: parseNullableNumber(bundleAnnualTotalPrice),
            defaultUnitPriceVnd: parseNullableNumber(bundleMonthlyPrice) ?? 0,
            maxSaleDiscountPercent: parseNullableNumber(bundleDiscount),
            defaultCostPriceVnd: parseNullableNumber(bundleCostPrice),
            defaultCustomerPriceVnd: parseNullableNumber(bundleMonthlyPrice),
            pricingInputMode: 'cost',
          }
        : {
            ...emptyProductForm(),
            itemType: 'component',
            parentId,
            sku: cleanText(skuInput),
            name: nameInput.trim(),
            unit: resolvedUnit,
            defaultVatRate: resolvedVatRate,
            defaultUnitPriceVnd: pricing.customerPriceVnd,
            description: cleanText(description),
            note: cleanText(note),
            quoteDisplayName: cleanText(quoteDisplayName),
            quoteDescription: cleanText(quoteDescription),
            quoteCta: cleanText(quoteCta),
            status: status as 'active' | 'inactive',
            customerVisible,
            brand: cleanText(brand),
            partNumber: cleanText(vendorPartNumber),
            productType: cleanText(productType),
            internalNote: cleanText(internalNote),
            supplierCurrency: pricing.supplierCurrency,
            supplierListPrice: pricing.supplierListPrice,
            supplierDiscountPercent: pricing.supplierDiscountPercent,
            supplierNetPrice: pricing.supplierNetPrice,
            supplierExchangeRate: pricing.supplierExchangeRate,
            supplierConvertedPrice: pricing.supplierConvertedPrice,
            supplierVendorId: cleanOptionalText(pricing.supplierVendorId || ''),
            supplierQuoteRef: cleanText(pricing.supplierQuoteRef || ''),
            supplierQuoteSource: cleanText(pricing.supplierQuoteSource || ''),
            supplierQuoteDate: cleanDate(pricing.supplierQuoteDate),
            supplierValidUntil: cleanDate(pricing.supplierValidUntil),
            shippingCost: pricing.shippingCost,
            importFee: pricing.importFee,
            otherCost: pricing.otherCost,
            pricingInputMode: pricing.pricingInputMode,
            defaultCostPriceVnd: pricing.costPriceVnd,
            defaultMarkupPercent: pricing.markupPercent,
            defaultCustomerPriceVnd: pricing.customerPriceVnd,
            pricingPolicy: cleanText(pricing.pricingPolicy || ''),
          };
      const saved = editingItem
        ? await serviceCatalogRepository.update(editingItem.id, payload)
        : await serviceCatalogRepository.create(payload);
      if (itemType === 'bundle' && bundleComponents.length > 0) {
        await serviceCatalogRepository.setBundleComponents(
          saved.id,
          bundleComponents.map((c, index) => ({ ...c, quantity: c.quantity ?? 1, sortOrder: c.sortOrder ?? index })),
        );
      } else if (editingItem?.itemType === 'bundle' && itemType === 'bundle') {
        await serviceCatalogRepository.setBundleComponents(editingItem.id, []);
      }
      if (editingItem) {
        onUpdated?.(saved);
      } else {
        onCreated(saved);
      }
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

  const isBundleMode = itemType === 'bundle';
  const costVal = isBundleMode ? (parseNullableNumber(bundleCostPrice) ?? 0) : pricing.costPriceVnd;
  const priceVal = isBundleMode ? (parseNullableNumber(bundleMonthlyPrice) ?? 0) : pricing.customerPriceVnd;
  const profit = isBundleMode ? priceVal - costVal : getProfit();
  const margin = priceVal > 0 ? (profit / priceVal) * 100 : 0;
  const pricingValid = priceVal >= costVal;
  const modalTitle = editingItem
    ? (isBundleMode ? 'Chỉnh sửa gói Combo' : 'Chỉnh sửa sản phẩm')
    : (isBundleMode ? 'Thêm gói Combo' : 'Thêm sản phẩm mới');
  const modalSubtitle = isBundleMode
    ? 'Thiết lập thông tin gói, giá bán và thành phần hiển thị trên báo giá.'
    : editingItem
      ? 'Cập nhật thông tin, giá vốn & chính sách giá bán tiêu chuẩn.'
      : 'Tạo sản phẩm, thiết lập giá vốn & chính sách giá bán tiêu chuẩn.';

  return (
    <>
    <div className="qc-modal-backdrop qc-modal-backdrop--nested" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="sc-drawer sc-drawer--modal relative flex flex-col bg-[#fff7fa]" style={{ maxWidth: '1200px', width: '95vw', maxHeight: '95vh' }} onMouseDown={event => event.stopPropagation()}>

        {/* Header */}
        <div className="flex flex-col gap-4 border-b border-[#f3d5de] bg-white p-6 pb-4 shrink-0 rounded-t-xl">
          <div className="flex justify-between items-start">
            <div>
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-semibold text-slate-900 m-0">{modalTitle}</h2>
                <div className="flex gap-2">
                  <span className="px-2.5 py-0.5 rounded-full bg-[#fde2eb] text-[#a91549] text-xs font-medium">VND mặc định</span>
                  <span className="px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-700 text-xs font-medium">Tự tính giá</span>
                </div>
              </div>
              <p className="mt-1.5 text-sm text-slate-500">{modalSubtitle}</p>
            </div>
            <button type="button" className="text-slate-400 hover:text-slate-600 transition-colors" onClick={onClose}>
              <X size={24} />
            </button>
          </div>

  
        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50 flex items-center justify-center gap-6">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="radio" className="w-4 h-4 text-[#c2185b]" checked={itemType === 'component'} onChange={() => setItemType('component')} disabled={!!editingItem} />
            <span className="text-sm font-medium text-slate-700">Sản phẩm lẻ / Add-on</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="radio" className="w-4 h-4 text-[#c2185b]" checked={itemType === 'bundle'} onChange={() => setItemType('bundle')} disabled={!!editingItem} />
            <span className="text-sm font-medium text-slate-700">Gói Combo</span>
          </label>
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
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1.5">Hiển thị khách hàng</label>
                          <select className="w-full h-9 px-3 border border-slate-300 rounded-md text-sm focus:border-[#c2185b] focus:ring-1 focus:ring-[#c2185b]" value={customerVisible ? 'yes' : 'no'} onChange={e => setCustomerVisible(e.target.value === 'yes')}>
                            <option value="yes">Có</option>
                            <option value="no">Không</option>
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
                          <div className="col-span-2">
                            <label className="block text-sm font-medium text-slate-700 mb-1.5">Ghi chú</label>
                            <textarea className="w-full p-3 border border-slate-300 rounded-md text-sm focus:border-[#c2185b] min-h-[80px]" value={note} onChange={e => setNote(e.target.value)} />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1.5">Tên hiển thị trên báo giá</label>
                            <input className="w-full h-9 px-3 border border-slate-300 rounded-md text-sm focus:border-[#c2185b] bg-slate-50" value={quoteDisplayName} onChange={e => setQuoteDisplayName(e.target.value)} />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1.5">CTA / ghi chú bán hàng</label>
                            <input className="w-full h-9 px-3 border border-slate-300 rounded-md text-sm focus:border-[#c2185b] bg-slate-50" value={quoteCta} onChange={e => setQuoteCta(e.target.value)} />
                          </div>
                          <div className="col-span-2">
                            <label className="block text-sm font-medium text-slate-700 mb-1.5">Mô tả ngắn cho khách</label>
                            <textarea className="w-full p-3 border border-slate-300 rounded-md text-sm focus:border-[#c2185b] min-h-[80px]" value={quoteDescription} onChange={e => setQuoteDescription(e.target.value)} />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Card Bundle: Thanh phan trong goi + Gia goi - CHI hien khi
                    itemType==='bundle'. Card 2/3 ben duoi (gia von tu
                    vendor/markup) khong ap dung cho Bundle (bundle dung gia
                    nhap tay o day, KHONG suy tu vendor cost) - itemType===
                    'component' van dung Card 2/3 nhu cu, khong doi hanh vi. */}
                {itemType === 'bundle' ? (
                  <>
                    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                      <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/50">
                        <h3 className="font-semibold text-slate-800">Thành phần trong gói</h3>
                      </div>
                      <div className="p-5">
                        {bundleComponents.length === 0 ? (
                          <div className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500">
                            Chưa có thành phần nào trong gói.
                          </div>
                        ) : (
                          <div className="flex flex-col gap-3">
                            {bundleComponents.map((item, index) => (
                              <div key={`${item.componentId}-${index}`} className="rounded-lg border border-slate-200 p-3">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0 flex-1">
                                    <div className="truncate text-sm font-semibold text-slate-800">{formatSkuName(item.sku, item.name || item.componentId)}</div>
                                    <div className="text-xs text-slate-500">{item.unit || ''}</div>
                                  </div>
                                  <button
                                    type="button"
                                    className="shrink-0 text-xs font-medium text-[#c2185b] hover:text-[#a91549]"
                                    onClick={() => setBundleComponents(bundleComponents.filter((_, i) => i !== index))}
                                  >
                                    Xóa
                                  </button>
                                </div>
                                <div className="mt-3 grid grid-cols-6 gap-3">
                                  <div className="col-span-2">
                                    <label className="block text-xs font-medium text-slate-600 mb-1">Tên hiển thị</label>
                                    <input
                                      className="w-full h-8 px-2 border border-slate-300 rounded text-sm"
                                      value={item.customerDisplayName || ''}
                                      onChange={e => updateBundleComponent(index, { customerDisplayName: e.target.value })}
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-xs font-medium text-slate-600 mb-1">Quota</label>
                                    <input
                                      className="w-full h-8 px-2 border border-slate-300 rounded text-sm"
                                      value={item.quota || ''}
                                      onChange={e => updateBundleComponent(index, { quota: e.target.value })}
                                    />
                                  </div>
                                  <label className="flex items-center gap-2 mt-5">
                                    <input
                                      type="checkbox"
                                      checked={item.required ?? true}
                                      onChange={e => updateBundleComponent(index, { required: e.target.checked })}
                                    />
                                    <span className="text-xs font-medium text-slate-600">Bắt buộc</span>
                                  </label>
                                  <div>
                                    <label className="block text-xs font-medium text-slate-600 mb-1">Vượt quota tính thêm</label>
                                    <input
                                      className="w-full h-8 px-2 border border-slate-300 rounded text-sm"
                                      value={item.overagePolicy || ''}
                                      onChange={e => updateBundleComponent(index, { overagePolicy: e.target.value })}
                                    />
                                  </div>
                                  <label className="flex items-center gap-2 mt-5">
                                    <input
                                      type="checkbox"
                                      checked={item.showOnQuote ?? true}
                                      onChange={e => updateBundleComponent(index, { showOnQuote: e.target.checked })}
                                    />
                                    <span className="text-xs font-medium text-slate-600">Hiển thị trên báo giá</span>
                                  </label>
                                  <div>
                                    <label className="block text-xs font-medium text-slate-600 mb-1">Pool key</label>
                                    <input
                                      className="w-full h-8 px-2 border border-slate-300 rounded text-sm"
                                      value={item.quotaPoolKey || ''}
                                      onChange={e => updateBundleComponent(index, { quotaPoolKey: e.target.value })}
                                    />
                                  </div>
                                  <div className="col-span-2">
                                    <label className="block text-xs font-medium text-slate-600 mb-1">Tên pool</label>
                                    <input
                                      className="w-full h-8 px-2 border border-slate-300 rounded text-sm"
                                      value={item.quotaPoolName || ''}
                                      onChange={e => updateBundleComponent(index, { quotaPoolName: e.target.value })}
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-xs font-medium text-slate-600 mb-1">Quota pool</label>
                                    <input
                                      className="w-full h-8 px-2 border border-slate-300 rounded text-sm"
                                      value={item.quotaPoolQuota || ''}
                                      onChange={e => updateBundleComponent(index, { quotaPoolQuota: e.target.value })}
                                    />
                                  </div>
                                  <div className="col-span-2">
                                    <label className="block text-xs font-medium text-slate-600 mb-1">Ghi chú CRM</label>
                                    <input
                                      className="w-full h-8 px-2 border border-slate-300 rounded text-sm"
                                      value={item.crmNote || ''}
                                      onChange={e => updateBundleComponent(index, { crmNote: e.target.value })}
                                    />
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="mt-4 flex gap-3">
                          <button type="button" className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50" onClick={() => setShowComponentPicker(true)}>
                            + Chọn sản phẩm lẻ
                          </button>
                          <button type="button" className="rounded-md border border-[#c2185b] px-3 py-2 text-sm font-medium text-[#c2185b] hover:bg-[#fff1f6]" onClick={() => setShowNestedAdd(true)}>
                            + Tạo sản phẩm mới
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                      <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/50">
                        <h3 className="font-semibold text-slate-800">Giá gói</h3>
                      </div>
                      <div className="p-5 grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1.5">Giá bán theo tháng</label>
                          <input type="number" className="w-full h-9 px-3 border border-slate-300 rounded-md text-sm" value={bundleMonthlyPrice} onChange={e => setBundleMonthlyPrice(e.target.value)} />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1.5">Giá / tháng khi thanh toán năm</label>
                          <input type="number" className="w-full h-9 px-3 border border-slate-300 rounded-md text-sm" value={bundleAnnualMonthlyPrice} onChange={e => setBundleAnnualMonthlyPrice(e.target.value)} />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1.5">Tổng thanh toán 12 tháng</label>
                          <input type="number" className="w-full h-9 px-3 border border-slate-300 rounded-md text-sm" value={bundleAnnualTotalPrice} onChange={e => setBundleAnnualTotalPrice(e.target.value)} />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1.5">Giá vốn target</label>
                          <input type="number" className="w-full h-9 px-3 border border-slate-300 rounded-md text-sm" value={bundleCostPrice} onChange={e => setBundleCostPrice(e.target.value)} />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1.5">Discount tối đa Sale (%)</label>
                          <input type="number" className="w-full h-9 px-3 border border-slate-300 rounded-md text-sm" value={bundleDiscount} onChange={e => setBundleDiscount(e.target.value)} />
                        </div>
                      </div>
                    </div>

                    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                      <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/50">
                        <h3 className="font-semibold text-slate-800">Quota / điểm nổi bật của gói</h3>
                      </div>
                      <div className="p-5 grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1.5">User</label>
                          <input className="w-full h-9 px-3 border border-slate-300 rounded-md text-sm" value={bundleQuotaUserLabel} onChange={e => setBundleQuotaUserLabel(e.target.value)} />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1.5">Kênh</label>
                          <input className="w-full h-9 px-3 border border-slate-300 rounded-md text-sm" value={bundleQuotaChannelsLabel} onChange={e => setBundleQuotaChannelsLabel(e.target.value)} />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1.5">Tin nhắn</label>
                          <input className="w-full h-9 px-3 border border-slate-300 rounded-md text-sm" value={bundleQuotaMessagesLabel} onChange={e => setBundleQuotaMessagesLabel(e.target.value)} />
                        </div>
                        <div className="col-span-2">
                          <label className="block text-sm font-medium text-slate-700 mb-1.5">AI / dữ liệu</label>
                          <textarea className="w-full p-3 border border-slate-300 rounded-md text-sm min-h-[60px]" value={bundleQuotaAiData} onChange={e => setBundleQuotaAiData(e.target.value)} />
                        </div>
                        <div className="col-span-2">
                          <label className="block text-sm font-medium text-slate-700 mb-1.5">Điểm nổi bật</label>
                          <textarea className="w-full p-3 border border-slate-300 rounded-md text-sm min-h-[60px]" value={bundleQuotaHighlights} onChange={e => setBundleQuotaHighlights(e.target.value)} />
                        </div>
                      </div>
                    </div>
                  </>
                ) : null}

                {/* Card 2: Giá mua / Giá vốn - chi dung khi itemType==='component' */}
                <div className={`bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden ${itemType === 'bundle' ? 'hidden' : ''}`}>
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

                {/* Card 3: Giá bán mặc định - chi dung khi itemType==='component' */}
                <div className={`bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden ${itemType === 'bundle' ? 'hidden' : ''}`}>
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
              {editingItem ? 'Hủy' : 'Lưu nháp'}
            </button>
            <button type="button" className="px-4 py-2 text-sm font-medium text-white bg-[#c2185b] rounded-lg hover:bg-[#a91549] transition-colors disabled:opacity-50 flex items-center gap-2 shadow-sm" disabled={saving || activeTab === 'vendor'} onClick={handleSave}>
              {saving ? 'Đang lưu...' : editingItem ? 'Lưu thay đổi' : 'Tạo sản phẩm & lưu giá'}
            </button>
          </div>
        </div>

      </div>
    </div>
    {showComponentPicker && (
      <CatalogPickerModal
        open={showComponentPicker}
        onClose={() => setShowComponentPicker(false)}
        activeSource="internal"
        onSourceChange={() => {}}
        showZoneTab={false}
        loading={false}
        items={existingItems.filter(i => i.itemType === 'component').map(i => ({
          id: i.id,
          itemType: 'component',
          sku: i.sku,
          name: i.name,
          description: i.description,
          groupId: i.groupId,
          groupName: i.groupName,
          unit: i.unit,
          customerPriceVnd: i.defaultCustomerPriceVnd ?? i.defaultUnitPriceVnd ?? 0,
          monthlyPriceVnd: i.monthlyPriceVnd,
          annualCommitMonthlyPriceVnd: i.annualCommitMonthlyPriceVnd,
          annualTotalPriceVnd: i.annualTotalPriceVnd,
          status: i.status,
          alreadyAdded: bundleComponents.some(c => c.componentId === i.id),
        }))}
        onAddSelected={ids => {
          const selected = existingItems.filter(i => ids.includes(i.id) && !bundleComponents.some(c => c.componentId === i.id));
          const newComponents: QuickBundleComponent[] = selected.map((i, index) => ({
            componentId: i.id,
            quantity: 1,
            sku: i.sku,
            name: i.name,
            customerDisplayName: i.name,
            unit: i.unit,
            quota: '1',
            required: true,
            showOnQuote: true,
            sortOrder: bundleComponents.length + index,
            defaultCustomerPriceVnd: i.defaultCustomerPriceVnd,
            defaultCostPriceVnd: i.defaultCostPriceVnd
          }));
          setBundleComponents([...bundleComponents, ...newComponents]);
          setShowComponentPicker(false);
        }}
      />
    )}
    {showNestedAdd && (
      <QuickAddProductModal
        open={showNestedAdd}
        onClose={() => setShowNestedAdd(false)}
        groups={groups}
        existingItems={existingItems}
        defaultGroupId={parentId}
        onCreated={(created) => {
          setBundleComponents([...bundleComponents, {
            componentId: created.id,
            quantity: 1,
            sku: created.sku,
            name: created.name,
            customerDisplayName: created.name,
            unit: created.unit,
            quota: '1',
            required: true,
            showOnQuote: true,
            sortOrder: bundleComponents.length,
            defaultCustomerPriceVnd: created.defaultCustomerPriceVnd,
            defaultCostPriceVnd: created.defaultCostPriceVnd
          }]);
          setShowNestedAdd(false);
        }}
      />
    )}
    </>
  );
}
