import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, ChevronRight, FileText, Loader2, UploadCloud } from 'lucide-react';
import { CrmVendorSelect } from '@/modules/crm/components/CrmVendorSelect';
import { SearchableSelect } from '@/modules/crm/components/SearchableSelect';
import { VendorImportRepository, VendorImportBatch, VendorImportItem } from '@/modules/crm/repositories/VendorImportRepository';
import { usePricingLogic } from './usePricingLogic';
import { serviceCatalogRepository } from './repositories/ServiceCatalogRepository';
import type { ServiceCatalogItem } from './types';

type Step = 1 | 2 | 3 | 4;

export function VendorImportFlow({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<Step>(1);
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [vendorId, setVendorId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [exchangeRate, setExchangeRate] = useState('25400');
  const [priceScope, setPriceScope] = useState<'project_only' | 'cost_price_book' | 'product_catalog'>('project_only');
  const [uploading, setUploading] = useState(false);
  const [batch, setBatch] = useState<VendorImportBatch | null>(null);
  const [items, setItems] = useState<VendorImportItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<VendorImportItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  // "Nhom san pham mac dinh" (migration 132: vendor_import_batches.default_group_id
  // + vendor_import_items.group_id) - dung CHUNG 1 nguon canonical Product
  // Group voi QuickAddProductModal (serviceCatalogRepository), khong tao
  // danh sach rieng. Ap dung cho MOI SKU tu file Vendor - SKU khop san pham
  // co san van giu nguyen nhom canonical cua no (xem process_ocr_extraction).
  const [groups, setGroups] = useState<ServiceCatalogItem[]>([]);
  const [defaultGroupId, setDefaultGroupId] = useState('');
  const [creatingDefaultGroup, setCreatingDefaultGroup] = useState(false);
  const [newDefaultGroupName, setNewDefaultGroupName] = useState('');
  const [savingDefaultGroup, setSavingDefaultGroup] = useState(false);
  const [defaultGroupError, setDefaultGroupError] = useState<string | null>(null);

  useEffect(() => {
    serviceCatalogRepository.list().then(tree => {
      setGroups(tree.filter(item => item.itemType === 'group'));
    }).catch(() => {});
  }, []);

  async function handleCreateDefaultGroup() {
    const trimmed = newDefaultGroupName.trim();
    if (!trimmed) {
      setDefaultGroupError('Vui lòng nhập tên nhóm.');
      return;
    }
    setSavingDefaultGroup(true);
    setDefaultGroupError(null);
    try {
      const created = await serviceCatalogRepository.create({ itemType: 'group', name: trimmed, status: 'active' });
      setGroups(prev => [...prev, created]);
      setDefaultGroupId(created.id);
      setCreatingDefaultGroup(false);
      setNewDefaultGroupName('');
    } catch (err) {
      setDefaultGroupError(err instanceof Error ? err.message : 'Không tạo được nhóm.');
    } finally {
      setSavingDefaultGroup(false);
    }
  }

  const { state: pricing, updateField: setPricingField } = usePricingLogic();
  const [editSku, setEditSku] = useState('');
  const [editName, setEditName] = useState('');
  const [editAction, setEditAction] = useState<'existing' | 'new' | 'ignored'>('new');
  const [editQuoteDate, setEditQuoteDate] = useState('');
  const [editGroupId, setEditGroupId] = useState('');
  const [itemError, setItemError] = useState<string | null>(null);
  const [savingItem, setSavingItem] = useState(false);

  const nextStep = () => setStep(s => Math.min(s + 1, 4) as Step);
  const prevStep = () => setStep(s => Math.max(s - 1, 1) as Step);

  // true tu luc bam "Chay OCR + AI" toi khi batch ve trang thai cuoi
  // (review/failed) - dieu khien ca spinner lan polling ben duoi. Dung mot
  // co duy nhat thay vi chi poll khi status === 'extracting' nhu truoc: sau
  // /retry, batch co the con dung o 'uploaded' 1 nhip (background task chua
  // kip chay) - neu chi cho status 'extracting' thi khong co gi kich hoat
  // polling, UI se ket dung mai (day chinh la bug da bao cao).
  const [triggering, setTriggering] = useState(false);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    if (triggering && batch) {
      const batchId = batch.id;
      interval = setInterval(async () => {
        try {
          const refreshed = await VendorImportRepository.getBatch(batchId);
          setBatch(refreshed);
          if (refreshed.status === 'review' || refreshed.status === 'failed') {
            if (refreshed.status === 'review') {
              setItems(await VendorImportRepository.getBatchItems(refreshed.id));
            }
            setTriggering(false);
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Khong tai duoc batch.');
          setTriggering(false);
        }
      }, 1500);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [triggering, batch?.id]);

  const handleRunOcr = async () => {
    if (!batch) return;
    setError(null);
    setTriggering(true);
    try {
      await VendorImportRepository.retryBatch(batch.id);
      const refreshed = await VendorImportRepository.getBatch(batch.id);
      setBatch(refreshed);
      if (refreshed.status === 'review') {
        setItems(await VendorImportRepository.getBatchItems(refreshed.id));
        setTriggering(false);
      } else if (refreshed.status === 'failed') {
        setTriggering(false);
      }
      // con lai (uploaded/extracting): giu triggering=true, effect o tren se tu poll tiep.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Khong chay duoc OCR + AI.');
      setTriggering(false);
    }
  };

  const handleUpload = async () => {
    if (!vendorId || !file) return;
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('vendor_id', vendorId);
      if (projectId.trim()) formData.append('project_id', projectId.trim());
      formData.append('exchange_rate', exchangeRate || '1');
      formData.append('target_scope', priceScope);
      if (defaultGroupId) formData.append('default_group_id', defaultGroupId);
      formData.append('file', file);
      const created = await VendorImportRepository.uploadBatch(formData);
      setBatch(created);
      setStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const handleSelectFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0];
    if (selected) setFile(selected);
  };

  const handleSelectItem = (item: VendorImportItem) => {
    setSelectedItem(item);
    setItemError(null);
    setEditSku(item.sku || '');
    setEditName(item.name || '');
    setEditAction(item.mapping_action || (item.matched_catalog_item_id ? 'existing' : 'new'));
    setEditQuoteDate(item.quote_date || '');
    setEditGroupId(item.group_id || '');
    setPricingField('supplierCurrency', item.currency as 'VND' | 'USD');
    setPricingField('supplierListPrice', item.list_price || 0);
    setPricingField('supplierDiscountPercent', item.discount_percent || 0);
    setPricingField('supplierNetPrice', item.net_price || 0);
    setPricingField('shippingCost', item.shipping_cost || 0);
    setPricingField('otherCost', item.other_cost || 0);
    if (item.currency === 'USD') setPricingField('supplierExchangeRate', Number(exchangeRate) || 1);
  };

  // Item ke tiep CHUA xu ly (review_status='pending'), dung cho nut "Item
  // tiep theo ->" tu dong nhay qua dong can lam viec, khong bat nguoi dung
  // phai tu keo danh sach tim.
  const selectNextUnresolved = (afterId: string) => {
    const idx = items.findIndex(i => i.id === afterId);
    const rest = [...items.slice(idx + 1), ...items.slice(0, idx + 1)];
    const next = rest.find(i => i.id !== afterId && i.review_status === 'pending');
    if (next) handleSelectItem(next);
    else setSelectedItem(null);
  };

  /** "Luu" va "Xac nhan" la CUNG 1 hanh dong o backend (PATCH item, review_status
   * duoc server tu suy tu mapping_action - xem update_item() trong
   * supabase_vendor_imports_service.py) - khong co khai niem "Save" rieng biet
   * voi "Confirm" o tang API. `resolvedAction` cho phep goi rieng cho nut
   * "Bo qua item" (luon ignored, bo qua validate ten san pham) tach voi nut
   * "Xac nhan item" (dung editAction dang chon, BAT BUOC co ten san pham). */
  const persistItem = async (resolvedAction: 'existing' | 'new' | 'ignored', advanceAfter: boolean) => {
    if (!selectedItem || !batch) return;
    setItemError(null);
    if (resolvedAction !== 'ignored' && !editName.trim()) {
      setItemError('Ten san pham khong duoc de trong.');
      return;
    }
    setSavingItem(true);
    try {
      const payload: Partial<VendorImportItem> = {
        sku: editSku.trim() || null,
        name: editName.trim() || selectedItem.name,
        mapping_action: resolvedAction,
        currency: pricing.supplierCurrency,
        list_price: pricing.supplierListPrice,
        discount_percent: pricing.supplierDiscountPercent,
        net_price: pricing.supplierNetPrice,
        shipping_cost: pricing.shippingCost,
        other_cost: pricing.otherCost,
        quote_date: editQuoteDate || null,
      };
      // Nhom san pham CHI duoc phep doi cho SKU MOI - SKU khop san pham co
      // san (existing) PHAI giu nguyen nhom canonical, khong gui group_id
      // len de tranh vo tinh doi nhom 1 san pham dang dung that (yeu cau
      // that: "Import gia Vendor khong duoc tu doi nhom cua existing SKU").
      if (resolvedAction === 'new') {
        payload.group_id = editGroupId || null;
      }
      const updated = await VendorImportRepository.updateItem(batch.id, selectedItem.id, payload);
      setItems(prev => prev.map(item => (item.id === selectedItem.id ? updated : item)));
      setSelectedItem(updated);
      if (advanceAfter) selectNextUnresolved(updated.id);
    } catch (err) {
      setItemError(err instanceof Error ? err.message : 'Khong luu duoc item.');
    } finally {
      setSavingItem(false);
    }
  };

  const handleConfirmItem = () => persistItem(editAction, true);
  const handleSkipItem = () => persistItem('ignored', true);

  const handleApprove = async () => {
    if (!batch) return;
    const pending = items.filter(item => item.review_status === 'pending');
    if (pending.length > 0) {
      setError('Can xu ly tat ca item pending truoc khi approve.');
      return;
    }
    setError(null);
    try {
      await VendorImportRepository.approveBatch(batch.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approve failed.');
    }
  };

  // review_status THAT (pending/mapped/new/ignored, migration 127) - khong
  // dung mapping_action de dem vi mapping_action co the null (item chua tung
  // duoc luu lan nao).
  const REVIEW_STATUS_LABELS: Record<string, string> = {
    pending: 'Chua xu ly',
    mapped: 'Da khop',
    new: 'SKU moi',
    ignored: 'Bo qua',
  };
  const reviewCounts = {
    mapped: items.filter(item => item.review_status === 'mapped').length,
    new: items.filter(item => item.review_status === 'new').length,
    ignored: items.filter(item => item.review_status === 'ignored').length,
    pending: items.filter(item => item.review_status === 'pending').length,
  };
  const resolvedCount = items.length - reviewCounts.pending;
  const allResolved = items.length > 0 && reviewCounts.pending === 0;

  // Step 4: mo ta THAT theo dung logic approve_batch()/_approve_cost_price_book()/
  // _approve_product_catalog() (vendor_imports.py) - khong bia them hanh vi
  // chua co (vd project_only KHONG co validate Project bat buoc o backend
  // hom nay, cost_price_book xu ly DONG DEU mapped+new, con product_catalog
  // thi item mapped ma KHONG co matched_catalog_item_id se bi BO QUA am tham).
  const mappedWithoutMatchCount = items.filter(item => item.review_status === 'mapped' && !item.matched_catalog_item_id).length;
  const SCOPE_META: Record<typeof priceScope, { label: string; explain: string }> = {
    project_only: {
      label: 'Chỉ dùng cho Project này',
      explain: 'Dữ liệu giá chỉ áp dụng cho Project hiện tại. Không cập nhật Product Catalog hay Cost Price Book.',
    },
    cost_price_book: {
      label: 'Cost Price Book',
      explain: 'Tạo phiên bản Cost Price Book mới cho vendor này. Phiên bản trước đó (nếu có) sẽ chuyển sang trạng thái lưu trữ (archived), không bị xóa.',
    },
    product_catalog: {
      label: 'Product Catalog',
      explain: 'Tạo/cập nhật sản phẩm và dữ liệu giá theo mapping đã review.',
    },
  };
  const impactLines: string[] = [];
  if (priceScope === 'project_only') {
    impactLines.push(`${reviewCounts.new + reviewCounts.mapped} dòng đã review sẽ áp dụng giá cho Project hiện tại.`);
    impactLines.push(`${reviewCounts.ignored} dòng bỏ qua sẽ không được import.`);
  } else if (priceScope === 'cost_price_book') {
    impactLines.push(`${reviewCounts.new + reviewCounts.mapped} dòng sẽ được đưa vào phiên bản Cost Price Book mới.`);
    impactLines.push(`${reviewCounts.ignored} dòng bỏ qua sẽ không được đưa vào.`);
  } else {
    impactLines.push(`${reviewCounts.new} dòng SKU mới sẽ được tạo mới trong danh mục sản phẩm.`);
    impactLines.push(`${reviewCounts.mapped - mappedWithoutMatchCount} dòng khớp sản phẩm có sẵn sẽ được cập nhật giá mới.`);
    impactLines.push(`${reviewCounts.ignored} dòng bỏ qua sẽ không được import.`);
  }
  if (reviewCounts.pending > 0) {
    impactLines.push(`${reviewCounts.pending} dòng còn chờ xử lý - cần xử lý hết trước khi Approve.`);
  }

  return (
    <div className={`flex flex-col ${step === 3 ? 'min-h-[620px]' : ''}`}>
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-200 px-1 pb-3">
        <h2 className="m-0 text-lg font-semibold text-slate-900">Import báo giá Vendor</h2>
        <div className="flex items-center gap-2 text-sm">
          {[1, 2, 3, 4].map(s => (
            <React.Fragment key={s}>
              <div className={`flex h-6 w-6 items-center justify-center rounded-full font-medium ${step === s ? 'bg-[#c2185b] text-white' : step > s ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-400'}`}>
                {step > s ? <CheckCircle2 size={14} /> : s}
              </div>
              <span className={`font-medium ${step === s ? 'text-[#c2185b]' : step > s ? 'text-emerald-600' : 'text-slate-400'}`}>
                {s === 1 ? 'Nguồn' : s === 2 ? 'OCR+AI' : s === 3 ? 'Review' : 'Approve'}
              </span>
              {s < 4 ? <ChevronRight size={16} className="mx-1 text-slate-300" /> : null}
            </React.Fragment>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-1 py-4">
        {error ? <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-medium text-rose-700">{error}</div> : null}

        {step === 1 ? (
          <div className="mx-auto flex max-w-5xl flex-col gap-4 pb-4">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">Nhà cung cấp / Vendor *</label>
                <CrmVendorSelect value={vendorId} onChange={setVendorId} placeholder="-- Chọn Vendor --" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">Project</label>
                <input className="h-9 w-full rounded-md border border-slate-300 px-3 text-sm focus:border-[#c2185b]" value={projectId} onChange={e => setProjectId(e.target.value)} />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">Tỷ giá</label>
                <input type="number" className="h-9 w-full rounded-md border border-slate-300 px-3 text-sm focus:border-[#c2185b]" value={exchangeRate} onChange={e => setExchangeRate(e.target.value)} />
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Nhóm sản phẩm mặc định</label>
              <p className="mb-1.5 text-xs text-slate-400">Áp dụng cho SKU mới trích xuất từ file. SKU khớp sản phẩm có sẵn sẽ giữ nguyên nhóm hiện tại, không bị đổi.</p>
              <SearchableSelect
                value={defaultGroupId}
                onChange={setDefaultGroupId}
                options={groups.map(g => ({ value: g.id, label: g.name || '' }))}
                placeholder="-- Chọn nhóm sản phẩm --"
                actions={[
                  { key: 'add', label: '+ Tạo nhóm sản phẩm', type: 'add', onSelect: () => setCreatingDefaultGroup(true) },
                ]}
              />
              {creatingDefaultGroup && (
                <div className="mt-2 flex gap-2 rounded-md border border-slate-200 bg-slate-50 p-2">
                  <input autoFocus className="h-8 flex-1 rounded border border-slate-300 px-2 text-sm" placeholder="Tên nhóm mới" value={newDefaultGroupName} onChange={e => setNewDefaultGroupName(e.target.value)} />
                  <button type="button" className="rounded bg-[#c2185b] px-3 py-1 text-sm font-medium text-white hover:bg-[#a91549] disabled:opacity-50" disabled={savingDefaultGroup} onClick={handleCreateDefaultGroup}>{savingDefaultGroup ? '...' : 'Lưu'}</button>
                  <button type="button" className="rounded bg-slate-200 px-3 py-1 text-sm font-medium text-slate-700 hover:bg-slate-300" onClick={() => { setCreatingDefaultGroup(false); setDefaultGroupError(null); }}>Hủy</button>
                </div>
              )}
              {defaultGroupError && <div className="mt-1 text-xs font-medium text-rose-600">{defaultGroupError}</div>}
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">File báo giá</label>
              <div className="flex min-h-[128px] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-4 text-center transition-colors hover:bg-slate-100" onClick={() => fileInputRef.current?.click()}>
                <input type="file" className="hidden" ref={fileInputRef} onChange={handleSelectFile} accept=".pdf,.xlsx,.xls,.png,.jpg,.jpeg" />
                {file ? (
                  <div className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-left shadow-sm">
                    <div className="flex min-w-0 items-center gap-2">
                      <FileText size={20} className="shrink-0 text-[#c2185b]" />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-slate-800">{file.name}</div>
                        <div className="text-xs text-slate-500">{(file.size / 1024 / 1024).toFixed(2)} MB</div>
                      </div>
                    </div>
                    <span className="text-xs font-medium text-[#c2185b]">Đổi file</span>
                  </div>
                ) : (
                  <>
                    <UploadCloud size={28} className="mb-2 text-slate-400" />
                    <div className="text-sm font-semibold text-slate-700">Kéo thả file hoặc nhấn để tải lên</div>
                    <div className="mt-1 text-xs text-slate-500">PDF, Excel, PNG, JPG</div>
                  </>
                )}
              </div>
            </div>

            <div>
              <label className="mb-3 block text-sm font-medium text-slate-700">Phạm vi sử dụng giá</label>
              <div className="grid grid-cols-3 gap-3">
                {[
                  ['project_only', 'Project only', 'Chỉ dùng cho project hiện tại.'],
                  ['cost_price_book', 'Cost Price Book', 'Tạo version giá vốn mới.'],
                  ['product_catalog', 'Product Catalog', 'Cập nhật giá mặc định catalog.'],
                ].map(([scope, title, description]) => (
                  <div key={scope} className={`cursor-pointer rounded-xl border p-3 transition-all ${priceScope === scope ? 'border-[#c2185b] bg-[#fff1f6] ring-1 ring-[#c2185b]' : 'border-slate-200 bg-white hover:border-slate-300'}`} onClick={() => setPriceScope(scope as typeof priceScope)}>
                    <div className="text-sm font-semibold">{title}</div>
                    <p className="mt-1 text-xs text-slate-500">{description}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {step === 2 && batch ? (
          <div className="mx-auto flex max-w-5xl items-start gap-6">
            <div className="flex-1 rounded-xl border border-slate-200 bg-white p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
                <FileText size={18} className="text-[#c2185b]" />
                File đã tải lên
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                  <div className="text-xs text-slate-500">Tên file</div>
                  <div className="mt-1 break-all font-medium text-slate-800">{batch.source_file_name}</div>
                </div>
                <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                  <div className="text-xs text-slate-500">Storage path</div>
                  <div className="mt-1 break-all font-mono text-xs text-slate-700">crm-attachments/{batch.source_file_path}</div>
                </div>
                <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                  <div className="text-xs text-slate-500">Dung lượng</div>
                  <div className="mt-1 font-medium text-slate-800">{((batch.source_file_size || 0) / 1024 / 1024).toFixed(2)} MB</div>
                </div>
                <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                  <div className="text-xs text-slate-500">Workspace</div>
                  <div className="mt-1 font-medium text-slate-800">{batch.instance}</div>
                </div>
              </div>
            </div>
            <div className="flex w-80 flex-col gap-4">
              <h3 className="m-0 text-lg font-semibold text-slate-800">OCR & AI Extraction</h3>
              {batch.status === 'uploaded' && !triggering ? (
                <div className="flex flex-col items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-center text-sm text-slate-600">File đã sẵn sàng. Bấm để bắt đầu trích xuất.</div>
                  <button type="button" className="w-full rounded-lg bg-[#c2185b] px-4 py-2 text-sm font-medium text-white hover:bg-[#a91549]" onClick={handleRunOcr}>
                    Chạy OCR + AI
                  </button>
                </div>
              ) : batch.status === 'extracting' || triggering ? (
                <div className="flex flex-col items-center rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <Loader2 className="mb-2 animate-spin text-[#c2185b]" size={32} />
                  <div className="text-sm font-medium">Đang phân tích file...</div>
                </div>
              ) : batch.status === 'failed' ? (
                <div className="flex flex-col items-center gap-3 rounded-xl border border-[#f3b8ca] bg-[#fff1f6] p-4 text-[#a91549]">
                  <AlertCircle size={32} />
                  <div className="text-center text-sm font-medium">Trích xuất lỗi: {batch.error_message}</div>
                  <button type="button" className="w-full rounded-lg border border-[#a91549] bg-white px-4 py-2 text-sm font-medium text-[#a91549] hover:bg-[#fff1f6]" onClick={handleRunOcr}>
                    Thử lại OCR + AI
                  </button>
                </div>
              ) : batch.status === 'review' && items.length === 0 ? (
                <div className="flex flex-col items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-800">
                  <AlertCircle size={32} />
                  <div className="text-center text-sm font-medium">Không tìm thấy dòng sản phẩm trong file.</div>
                  {batch.extraction_meta?.ai_configured === false ? (
                    <div className="text-center text-xs text-amber-700">AI chưa được cấu hình - đang dùng phân tích cơ bản (chỉ đọc được bảng có dấu "|"), có thể bỏ sót sản phẩm.</div>
                  ) : null}
                  <button type="button" className="w-full rounded-lg border border-amber-400 bg-white px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-100" onClick={handleRunOcr}>
                    Chạy lại OCR + AI
                  </button>
                </div>
              ) : batch.status === 'review' ? (
                <div className="flex flex-col gap-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl border border-slate-200 bg-white p-3 text-center shadow-sm">
                      <div className="mb-1 text-xs text-slate-500">Dòng tìm thấy</div>
                      <div className="text-xl font-bold text-slate-800">{items.length}</div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white p-3 text-center shadow-sm">
                      <div className="mb-1 text-xs text-slate-500">Trạng thái</div>
                      <div className={`text-xl font-bold ${batch.extraction_meta?.ai_configured === false ? 'text-amber-600' : 'text-emerald-600'}`}>
                        {batch.extraction_meta?.ai_configured === false ? 'Có cảnh báo' : 'Hoàn tất'}
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white p-3 text-center shadow-sm">
                      <div className="mb-1 text-xs text-slate-500">SKU khớp</div>
                      <div className="text-xl font-bold text-slate-800">{items.filter(i => i.matched_catalog_item_id).length}</div>
                    </div>
                    {typeof batch.extraction_meta?.confidence === 'number' ? (
                      <div className="rounded-xl border border-slate-200 bg-white p-3 text-center shadow-sm">
                        <div className="mb-1 text-xs text-slate-500">Độ tin cậy</div>
                        <div className="text-xl font-bold text-slate-800">{Math.round(batch.extraction_meta.confidence * 100)}%</div>
                      </div>
                    ) : null}
                  </div>
                  {batch.extraction_meta?.ai_configured === false ? (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-700">
                      AI chưa được cấu hình - đang dùng phân tích cơ bản (chỉ đọc được bảng có dấu "|"), kết quả có thể thiếu.
                    </div>
                  ) : null}
                  <button type="button" className="w-fit self-start text-xs font-medium text-slate-500 underline hover:text-slate-700" onClick={handleRunOcr}>
                    Chạy lại OCR + AI
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="flex h-full flex-col gap-4">
            <div className="sticky top-0 z-10 flex flex-wrap items-center gap-4 rounded-xl border border-slate-200 bg-slate-50 p-3 shadow-sm">
              <div className="text-sm font-semibold text-slate-800">
                Đã xử lý {resolvedCount}/{items.length}
              </div>
              <div className="h-2 flex-1 min-w-[120px] overflow-hidden rounded-full bg-slate-200">
                <div className="h-full rounded-full bg-[#c2185b] transition-all" style={{ width: `${items.length ? (resolvedCount / items.length) * 100 : 0}%` }} />
              </div>
              <div className="flex flex-wrap gap-3 text-xs text-slate-600">
                <span>Đã khớp: <b className="text-slate-800">{reviewCounts.mapped}</b></span>
                <span>SKU mới: <b className="text-slate-800">{reviewCounts.new}</b></span>
                <span>Bỏ qua: <b className="text-slate-800">{reviewCounts.ignored}</b></span>
                <span>Chưa xử lý: <b className="text-amber-600">{reviewCounts.pending}</b></span>
              </div>
            </div>

            <div className="flex flex-1 gap-6 overflow-hidden">
              <div className="flex w-72 flex-col gap-3 border-r border-slate-200 pr-4">
                <h4 className="m-0 font-semibold text-slate-800">Sản phẩm từ file ({items.length})</h4>
                <div className="flex flex-1 flex-col gap-2 overflow-y-auto pr-1">
                  {items.map((item, index) => (
                    <div key={item.id} onClick={() => handleSelectItem(item)} className={`cursor-pointer rounded-lg border p-3 transition-colors ${selectedItem?.id === item.id ? 'border-[#f3b8ca] bg-[#fff1f6]' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-sm font-semibold text-slate-800">{item.sku || `ITEM-${index + 1}`}</span>
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${item.review_status === 'pending' ? 'bg-amber-100 text-amber-700' : item.review_status === 'ignored' ? 'bg-slate-200 text-slate-600' : 'bg-emerald-100 text-emerald-700'}`}>
                          {REVIEW_STATUS_LABELS[item.review_status] || item.review_status}
                        </span>
                      </div>
                      <div className="truncate text-xs text-slate-500">{item.name}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex-1 overflow-y-auto pr-2">
                {selectedItem ? (
                  <div className="flex flex-col gap-6">
                    <div className="flex items-center justify-between">
                      <h3 className="mb-0 text-lg font-semibold text-slate-800">Chi tiết & Mapping</h3>
                      <span className={`rounded px-2 py-1 text-xs font-medium ${selectedItem.review_status === 'pending' ? 'bg-amber-100 text-amber-700' : selectedItem.review_status === 'ignored' ? 'bg-slate-200 text-slate-600' : 'bg-emerald-100 text-emerald-700'}`}>
                        {REVIEW_STATUS_LABELS[selectedItem.review_status] || selectedItem.review_status}
                      </span>
                    </div>
                    {itemError ? <div className="rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs font-medium text-rose-700">{itemError}</div> : null}

                    <div>
                      <div className="mb-2 text-xs font-semibold uppercase text-slate-500">Thông tin chính</div>
                      <div className="grid grid-cols-2 gap-4">
                        <label className="block text-sm font-medium text-slate-700">
                          SKU
                          <input className="mt-1.5 h-9 w-full rounded-md border border-slate-300 px-3 text-sm" value={editSku} onChange={e => setEditSku(e.target.value)} />
                        </label>
                        <label className="block text-sm font-medium text-slate-700">
                          Tên sản phẩm *
                          <input className="mt-1.5 h-9 w-full rounded-md border border-slate-300 px-3 text-sm" value={editName} onChange={e => setEditName(e.target.value)} />
                        </label>
                      </div>
                    </div>

                    <div>
                      <div className="mb-2 text-xs font-semibold uppercase text-slate-500">Giá mua / Giá vốn</div>
                      <div className="mb-3">
                        <label className="block text-sm font-medium text-slate-700">
                          Đơn vị tiền NCC
                          <select
                            className="mt-1.5 h-9 w-full max-w-[160px] rounded-md border border-slate-300 px-3 text-sm"
                            value={pricing.supplierCurrency}
                            onChange={e => setPricingField('supplierCurrency', e.target.value as 'VND' | 'USD')}
                          >
                            <option value="VND">VND</option>
                            <option value="USD">USD</option>
                          </select>
                        </label>
                      </div>
                      <div className="grid grid-cols-3 gap-4">
                        <label className="block text-sm font-medium text-slate-700">
                          Giá niêm yết
                          <input type="number" className="mt-1.5 h-9 w-full rounded-md border border-slate-300 px-3 text-sm" value={pricing.supplierListPrice || ''} onChange={e => setPricingField('supplierListPrice', Number(e.target.value) || 0)} />
                        </label>
                        <label className="block text-sm font-medium text-slate-700">
                          Chiết khấu (%)
                          <input type="number" className="mt-1.5 h-9 w-full rounded-md border border-slate-300 px-3 text-sm" value={pricing.supplierDiscountPercent || ''} onChange={e => setPricingField('supplierDiscountPercent', Number(e.target.value) || 0)} />
                        </label>
                        <label className="block text-sm font-medium text-slate-700">
                          Giá mua (Net)
                          <input type="number" className="mt-1.5 h-9 w-full rounded-md border border-blue-200 bg-blue-50 px-3 text-sm font-semibold text-blue-700" value={pricing.supplierNetPrice || ''} onChange={e => setPricingField('supplierNetPrice', Number(e.target.value) || 0)} />
                          <div className="mt-1 text-[11px] font-normal normal-case text-slate-400">Tự tính từ giá niêm yết - chiết khấu, có thể sửa tay.</div>
                        </label>
                      </div>
                      {pricing.supplierCurrency === 'USD' ? (
                        <div className="mt-3 grid grid-cols-2 gap-4">
                          <label className="block text-sm font-medium text-slate-700">
                            Tỷ giá VND/USD
                            <input type="number" className="mt-1.5 h-9 w-full rounded-md border border-slate-300 px-3 text-sm" value={pricing.supplierExchangeRate || ''} onChange={e => setPricingField('supplierExchangeRate', Number(e.target.value) || 1)} />
                          </label>
                          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm">
                            <div className="text-xs text-slate-500">Giá mua quy đổi</div>
                            <div className="font-semibold text-slate-800">{Math.round(pricing.supplierConvertedPrice).toLocaleString('vi-VN')} VND</div>
                          </div>
                        </div>
                      ) : null}
                    </div>

                    <div>
                      <div className="mb-2 text-xs font-semibold uppercase text-slate-500">Nguồn giá & chi phí cộng thêm</div>
                      <div className="grid grid-cols-3 gap-4">
                        <label className="block text-sm font-medium text-slate-700">
                          Phí vận chuyển
                          <input type="number" className="mt-1.5 h-9 w-full rounded-md border border-slate-300 px-3 text-sm" value={pricing.shippingCost || ''} onChange={e => setPricingField('shippingCost', Number(e.target.value) || 0)} />
                        </label>
                        <label className="block text-sm font-medium text-slate-700">
                          Chi phí khác
                          <input type="number" className="mt-1.5 h-9 w-full rounded-md border border-slate-300 px-3 text-sm" value={pricing.otherCost || ''} onChange={e => setPricingField('otherCost', Number(e.target.value) || 0)} />
                        </label>
                        <label className="block text-sm font-medium text-slate-700">
                          Ngày báo giá
                          <input type="date" className="mt-1.5 h-9 w-full rounded-md border border-slate-300 px-3 text-sm" value={editQuoteDate} onChange={e => setEditQuoteDate(e.target.value)} />
                        </label>
                      </div>
                      <div className="mt-3 rounded-md border border-slate-300 bg-slate-50 px-3 py-2">
                        <div className="text-xs text-slate-500">Giá vốn/ĐVT = Giá mua quy đổi + Phí vận chuyển + Chi phí khác</div>
                        <div className="text-lg font-bold text-slate-800">{Math.round(pricing.costPriceVnd).toLocaleString('vi-VN')} VND</div>
                      </div>
                    </div>

                    <div>
                      <div className="mb-2 text-xs font-semibold uppercase text-slate-500">Mapping & kết quả</div>
                      <label className="block text-sm font-medium text-slate-700">
                        Hành động Mapping
                        <select className="mt-1.5 h-9 w-full rounded-md border border-slate-300 px-3 text-sm" value={editAction} onChange={e => setEditAction(e.target.value as typeof editAction)}>
                          <option value="new">Tạo sản phẩm mới</option>
                          <option value="existing">Map với sản phẩm đã có</option>
                          <option value="ignored">Bỏ qua dòng này</option>
                        </select>
                      </label>
                      {editAction === 'existing' && !selectedItem.matched_catalog_item_id ? (
                        <div className="mt-2 text-xs text-amber-600">Chưa khớp được sản phẩm có sẵn theo SKU. Nếu Approve ở phạm vi Product Catalog, dòng này sẽ KHÔNG được xử lý trừ khi bạn chọn "Tạo sản phẩm mới" thay thế.</div>
                      ) : null}

                      <label className="mt-3 block text-sm font-medium text-slate-700">
                        Nhóm sản phẩm
                        {editAction === 'new' ? (
                          <>
                            <div className="mt-1.5">
                              <SearchableSelect
                                value={editGroupId}
                                onChange={setEditGroupId}
                                options={groups.map(g => ({ value: g.id, label: g.name || '' }))}
                                placeholder="-- Chọn nhóm sản phẩm --"
                              />
                            </div>
                            <div className="mt-1 text-[11px] font-normal normal-case text-slate-400">
                              Mặc định lấy theo "Nhóm sản phẩm mặc định" ở Bước 1 - có thể đổi riêng cho dòng này.
                            </div>
                          </>
                        ) : (
                          <div className="mt-1.5 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                            {groups.find(g => g.id === selectedItem.group_id)?.name || (selectedItem.group_id ? selectedItem.group_id : 'Chưa xác định')}
                            <div className="mt-1 text-[11px] font-normal normal-case text-slate-400">
                              Sản phẩm đã có sẵn - giữ nguyên nhóm hiện tại, import giá Vendor không đổi nhóm.
                            </div>
                          </div>
                        )}
                      </label>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-4">
                      <button type="button" disabled={savingItem} className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50" onClick={handleConfirmItem}>
                        Xác nhận item
                      </button>
                      <button type="button" disabled={savingItem} className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50" onClick={handleSkipItem}>
                        Bỏ qua item
                      </button>
                      <button type="button" className="ml-auto rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50" onClick={() => selectNextUnresolved(selectedItem.id)}>
                        Item tiếp theo →
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center text-slate-400">
                    {reviewCounts.pending === 0 && items.length > 0 ? 'Tất cả item đã được xử lý. Chọn 1 item bên trái để xem lại.' : 'Chọn 1 sản phẩm bên trái để xem và sửa'}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : null}

        {step === 4 ? (
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 pb-8">
            <div className="flex w-full flex-col items-center gap-2 text-center">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                <CheckCircle2 size={28} />
              </div>
              <h2 className="m-0 text-xl font-bold text-slate-800">Sẵn sàng Approve</h2>
              {/* max-w-lg KHONG dung duoc trong repo nay: app/globals.css dinh
                  nghia --spacing-lg: 24px (thang do rieng cho spacing), va
                  Tailwind v4 lay nham gia tri nay cho utility max-w-lg thay vi
                  --container-lg that (32rem) - da xac nhan qua getComputedStyle
                  (maxWidth tra ve dung 24px). Dung gia tri arbitrary [32rem]
                  (dung gia tri Tailwind default that) de tranh dung ten bi
                  trung nay, khong phai "vá cứng" mot con so tuy y. */}
              <p className="w-full max-w-[32rem] text-sm text-slate-500">
                Dữ liệu đã được review xong. Nhấn Approve để lưu vào hệ thống theo phạm vi đã chọn.
              </p>
            </div>

            <div className="grid grid-cols-4 gap-3">
              {[
                ['Đã khớp', reviewCounts.mapped, 'text-blue-600'],
                ['SKU mới', reviewCounts.new, 'text-emerald-600'],
                ['Bỏ qua', reviewCounts.ignored, 'text-slate-500'],
                ['Chưa xử lý', reviewCounts.pending, reviewCounts.pending > 0 ? 'text-amber-600' : 'text-slate-400'],
              ].map(([label, count, color]) => (
                <div key={label as string} className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-center">
                  <div className="mb-1 text-xs text-slate-500">{label as string}</div>
                  <div className={`text-xl font-bold ${color}`}>{count as number}</div>
                </div>
              ))}
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="mb-3 text-xs font-semibold uppercase text-slate-500">Thông tin nguồn</div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-slate-500">Vendor: </span><span className="font-medium text-slate-800">{batch?.crm_vendors?.name || batch?.vendor_id || '—'}</span></div>
                <div><span className="text-slate-500">File nguồn: </span><span className="font-medium text-slate-800">{batch?.source_file_name || '—'}</span></div>
                <div><span className="text-slate-500">Tỷ giá: </span><span className="font-medium text-slate-800">{batch?.exchange_rate?.toLocaleString('vi-VN') || '—'}</span></div>
                <div><span className="text-slate-500">Project: </span><span className="font-medium text-slate-800">{batch?.project_id || 'Không gắn Project'}</span></div>
              </div>
            </div>

            <div className="rounded-xl border border-[#f3b8ca] bg-[#fff1f6] p-4">
              <div className="mb-1 text-xs font-semibold uppercase text-[#a91549]">Phạm vi áp dụng</div>
              <div className="mb-1 text-base font-semibold text-slate-800">{SCOPE_META[priceScope].label}</div>
              <p className="m-0 text-sm text-slate-700">{SCOPE_META[priceScope].explain}</p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="mb-2 text-xs font-semibold uppercase text-slate-500">Tác động khi Approve</div>
              <ul className="m-0 list-disc space-y-1 pl-5 text-sm text-slate-600">
                {impactLines.map(line => <li key={line}>{line}</li>)}
              </ul>
              {priceScope === 'product_catalog' && mappedWithoutMatchCount > 0 ? (
                <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-700">
                  ⚠ {mappedWithoutMatchCount} dòng chọn "Map với sản phẩm đã có" nhưng chưa khớp được ID sản phẩm cụ thể - các dòng này sẽ KHÔNG được xử lý khi Approve.
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center justify-between border-t border-slate-200 bg-white px-1 pt-3">
        <button type="button" className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50" onClick={step === 1 ? onClose : prevStep}>
          {step === 1 ? 'Hủy' : 'Quay lại'}
        </button>
        {step === 3 ? (
          <div className="flex flex-col items-end gap-1">
            {!allResolved ? (
              <div className="text-xs font-medium text-amber-600">Còn {reviewCounts.pending} item chưa xử lý.</div>
            ) : null}
            <button type="button" className="rounded-lg bg-[#c2185b] px-4 py-2 text-sm font-medium text-white hover:bg-[#a91549] disabled:opacity-50" onClick={nextStep} disabled={!allResolved}>
              Tiếp tục đến Approve →
            </button>
          </div>
        ) : step < 4 ? (
          <button type="button" className="rounded-lg bg-[#c2185b] px-4 py-2 text-sm font-medium text-white hover:bg-[#a91549] disabled:opacity-50" onClick={step === 1 ? handleUpload : nextStep} disabled={(step === 1 && (!file || !vendorId || uploading)) || (step === 2 && (batch?.status !== 'review' || items.length === 0))}>
            {step === 1 ? (uploading ? 'Đang tải lên...' : 'Tiếp tục') : step === 2 ? 'Tiếp tục đến Review →' : 'Tiếp tục'}
          </button>
        ) : (
          <div className="flex flex-col items-end gap-1">
            {reviewCounts.pending > 0 ? (
              <div className="text-xs font-medium text-amber-600">Còn {reviewCounts.pending} dòng chưa xử lý - quay lại Review để hoàn tất.</div>
            ) : null}
            <button type="button" disabled={reviewCounts.pending > 0} className="flex items-center gap-2 rounded-lg bg-[#c2185b] px-4 py-2 text-sm font-medium text-white hover:bg-[#a91549] disabled:opacity-50" onClick={handleApprove}>
              <CheckCircle2 size={18} /> Xác nhận Import
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
