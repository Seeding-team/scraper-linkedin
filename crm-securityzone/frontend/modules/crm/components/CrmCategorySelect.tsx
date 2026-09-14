'use client';

import { useEffect, useMemo, useState } from 'react';
import { SearchableSelect } from './SearchableSelect';
import { allPlatformCategoriesService, authService, invalidateTaxonomyCache } from '@/services/all-platform.service';
import type { AppUser, Category, CategoryType } from '@/types/unified.types';

export type CrmCategoryOption = { value: string; label: string };

type CategoryValueMode = 'label' | 'code' | 'id';

const cachedRows = new Map<string, Category[]>();
const cachedRowPromises = new Map<string, Promise<Category[]>>();
const cachedOptions = new Map<string, string[]>();
const cachedPromises = new Map<string, Promise<string[]>>();
const cachedCodeOptions = new Map<string, CrmCategoryOption[]>();
const cachedCodePromises = new Map<string, Promise<CrmCategoryOption[]>>();
let categoryManagePermissionPromise: Promise<boolean> | null = null;

const CATEGORY_LABELS: Partial<Record<CategoryType, string>> = {
  crm_source: 'nguồn',
  crm_service_package: 'danh mục sản phẩm',
  crm_package: 'gói',
  crm_industry: 'lĩnh vực',
  crm_position: 'chức vụ',
  crm_city: 'thành phố',
  crm_expected_timeline: 'thời gian triển khai',
  crm_next_step: 'việc tiếp theo',
  crm_nurture_reason: 'lý do nuôi dưỡng',
  crm_follow_up_channel: 'kênh chăm sóc lại',
  crm_unqualified_reason: 'lý do không đạt chuẩn',
  crm_quote_type: 'loại báo giá',
  crm_contract_status: 'trạng thái hợp đồng',
  crm_payment_status: 'trạng thái thanh toán',
  crm_billing_type: 'loại billing',
  crm_won_reason: 'lý do thắng deal',
  crm_lost_reason: 'lý do thua deal',
  crm_outcome_confidence: 'độ tin cậy kết quả',
  crm_outcome_trigger: 'tín hiệu phát sinh',
  crm_outcome_objection: 'phản đối',
  crm_kb_reuse_level: 'mức tái sử dụng',
  crm_kb_owner: 'người phụ trách tri thức',
  crm_kb_status: 'trạng thái tri thức',
};

function categoryLabel(categoryType: CategoryType): string {
  return CATEGORY_LABELS[categoryType] || categoryType.replace(/^crm_/, '').replace(/_/g, ' ');
}

function slugifyCode(value: string): string {
  return (
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[đĐ]/g, 'd')
      .trim()
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'new_category'
  );
}

function canManageCategories(user: AppUser | null): boolean {
  if (!user) return false;
  const role = String(user.role || '').toLowerCase();
  if (role === 'admin' || role === 'leader') return true;
  return user.quote_business_role === 'sale' || user.quote_business_role === 'presale' || user.quote_business_role === 'both';
}

function getCategoryValue(category: Category, mode: CategoryValueMode): string {
  if (mode === 'id') return category.id;
  if (mode === 'code') return category.code;
  return category.name || category.code;
}

function getCategoryOption(category: Category, mode: CategoryValueMode): CrmCategoryOption | null {
  const value = getCategoryValue(category, mode);
  if (!value) return null;
  return { value, label: category.name || category.code || value };
}

async function fetchCrmCategoryRows(categoryType: CategoryType, activeOnly: boolean, forceRefresh = false): Promise<Category[]> {
  const key = `${categoryType}:${activeOnly ? 'active' : 'all'}`;
  if (!forceRefresh) {
    const cached = cachedRows.get(key);
    if (cached) return cached;
    const inflight = cachedRowPromises.get(key);
    if (inflight) return inflight;
  }
  const promise = allPlatformCategoriesService
    .getAll(categoryType, { activeOnly, forceRefresh })
    .then(res => {
      const rows = res.data || [];
      cachedRows.set(key, rows);
      return rows;
    })
    .finally(() => cachedRowPromises.delete(key));
  cachedRowPromises.set(key, promise);
  return promise;
}

async function resolveCanManageCategories(): Promise<boolean> {
  if (!categoryManagePermissionPromise) {
    categoryManagePermissionPromise = authService
      .me()
      .then(res => canManageCategories(res.data || null))
      .catch(() => false);
  }
  return categoryManagePermissionPromise;
}

export function fetchCrmCategoryLabels(categoryType: CategoryType): Promise<string[]> {
  const cached = cachedOptions.get(categoryType);
  if (cached) return Promise.resolve(cached);
  let promise = cachedPromises.get(categoryType);
  if (!promise) {
    promise = fetchCrmCategoryRows(categoryType, true)
      .then(rows => {
        const labels = rows.map(c => c.name || c.code).filter(Boolean);
        cachedOptions.set(categoryType, labels);
        return labels;
      })
      .catch(() => {
        cachedPromises.delete(categoryType);
        return [] as string[];
      });
    cachedPromises.set(categoryType, promise);
  }
  return promise;
}

export function fetchCrmCategoryCodeOptions(categoryType: CategoryType): Promise<CrmCategoryOption[]> {
  const cached = cachedCodeOptions.get(categoryType);
  if (cached) return Promise.resolve(cached);
  let promise = cachedCodePromises.get(categoryType);
  if (!promise) {
    promise = fetchCrmCategoryRows(categoryType, true)
      .then(rows => {
        const options = rows.map(row => getCategoryOption(row, 'code')).filter((row): row is CrmCategoryOption => Boolean(row));
        cachedCodeOptions.set(categoryType, options);
        return options;
      })
      .catch(() => {
        cachedCodePromises.delete(categoryType);
        return [] as CrmCategoryOption[];
      });
    cachedCodePromises.set(categoryType, promise);
  }
  return promise;
}

export function invalidateCrmCategoryCache(categoryType?: CategoryType) {
  if (categoryType) {
    for (const suffix of ['active', 'all']) cachedRows.delete(`${categoryType}:${suffix}`);
    cachedRowPromises.delete(`${categoryType}:active`);
    cachedRowPromises.delete(`${categoryType}:all`);
    cachedOptions.delete(categoryType);
    cachedPromises.delete(categoryType);
    cachedCodeOptions.delete(categoryType);
    cachedCodePromises.delete(categoryType);
    invalidateTaxonomyCache(`categories:${categoryType}:active`);
    invalidateTaxonomyCache(`categories:${categoryType}:all`);
    return;
  }
  cachedRows.clear();
  cachedRowPromises.clear();
  cachedOptions.clear();
  cachedPromises.clear();
  cachedCodeOptions.clear();
  cachedCodePromises.clear();
  invalidateTaxonomyCache();
}

export function useCrmCategoryLabels(categoryType: CategoryType, fallbackLabels: string[] = []) {
  const [labels, setLabels] = useState<string[]>(() => cachedOptions.get(categoryType) || []);
  const [loaded, setLoaded] = useState<boolean>(() => cachedOptions.has(categoryType));

  useEffect(() => {
    let alive = true;
    void fetchCrmCategoryLabels(categoryType).then(next => {
      if (!alive) return;
      setLabels(next);
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, [categoryType]);

  const usingFallback = loaded && labels.length === 0 && fallbackLabels.length > 0;
  return { labels: usingFallback ? fallbackLabels : labels, loaded, usingFallback };
}

export function useCrmCategoryCodeOptions(categoryType: CategoryType, fallbackOptions: CrmCategoryOption[] = []) {
  const [options, setOptions] = useState<CrmCategoryOption[]>(() => cachedCodeOptions.get(categoryType) || []);
  const [loaded, setLoaded] = useState<boolean>(() => cachedCodeOptions.has(categoryType));

  useEffect(() => {
    let alive = true;
    void fetchCrmCategoryCodeOptions(categoryType).then(next => {
      if (!alive) return;
      setOptions(next);
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, [categoryType]);

  const usingFallback = loaded && options.length === 0 && fallbackOptions.length > 0;
  return { options: usingFallback ? fallbackOptions : options, loaded, usingFallback };
}

export function CrmCategoryQuickModal({
  categoryType,
  initialCategory,
  onClose,
  onSaved,
  inline = false,
}: {
  inline?: boolean;
  categoryType: CategoryType;
  initialCategory?: Category | null;
  onClose: () => void;
  onSaved: (category: Category) => void;
}) {
  const typeLabel = categoryLabel(categoryType);
  const [name, setName] = useState(initialCategory?.name || '');
  const [code, setCode] = useState(initialCategory?.code || '');
  const [description, setDescription] = useState(initialCategory?.description || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (initialCategory) return;
    setCode(prev => (prev ? prev : slugifyCode(name)));
  }, [name, initialCategory]);

  async function save() {
    const finalName = name.trim();
    const finalCode = code.trim();
    if (!finalName || !finalCode) {
      setError('Nhập đủ Tên và Mã.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = initialCategory
        ? await allPlatformCategoriesService.update({ id: initialCategory.id, code: finalCode, name: finalName, description: description.trim() || undefined })
        : await allPlatformCategoriesService.add({ category_type: categoryType, code: finalCode, name: finalName, description: description.trim() || undefined, is_active: true });
      if (res.success === false || !res.data) throw new Error(res.message || 'Không lưu được danh mục.');
      onSaved(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không lưu được danh mục.');
    } finally {
      setBusy(false);
    }
  }

  const content = (
      <div className={inline ? "crm-category-quick-inline" : "crm-category-quick-modal"} onMouseDown={event => event.stopPropagation()} style={inline ? { display: 'flex', flexDirection: 'column', height: '100%', padding: '0 1rem' } : {}}>
        <div className="crm-category-quick-head">
          <div>
            <p>{initialCategory ? `Sửa ${typeLabel}` : `Thêm ${typeLabel}`}</p>
            <span>Danh mục CRM · {categoryType}</span>
          </div>
          <button type="button" onClick={onClose} disabled={busy}>×</button>
        </div>
        {error ? <div className="crm-inline-error">{error}</div> : null}
        <label>
          Tên
          <input value={name} onChange={event => setName(event.target.value)} autoFocus />
        </label>
        <label>
          Mã
          <input value={code} onChange={event => setCode(event.target.value)} />
        </label>
        <label>
          Mô tả
          <textarea value={description} onChange={event => setDescription(event.target.value)} rows={3} />
        </label>
        <div className="crm-category-quick-actions">
          <button type="button" className="qc-btn" onClick={onClose} disabled={busy}>Hủy</button>
          <button type="button" className="qc-btn qc-btn-primary" onClick={() => void save()} disabled={busy}>
            {busy ? 'Đang lưu...' : 'Lưu'}
          </button>
        </div>
      </div>
  );
  if (inline) return content;
  return (
    <div className="qc-modal-backdrop qc-modal-backdrop--nested" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      {content}
    </div>
  );
}

export function CrmCategoryManageDrawer({
  categoryType,
  onClose,
  onChanged,
}: {
  categoryType: CategoryType;
  onClose: () => void;
  onChanged: (category?: Category) => void;
}) {
  const typeLabel = categoryLabel(categoryType);
  const [rows, setRows] = useState<Category[]>([]);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Category | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');

  async function load(force = false) {
    setLoading(true);
    setError('');
    try {
      const next = await fetchCrmCategoryRows(categoryType, false, force);
      setRows(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không tải được danh mục.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryType]);

  const filteredRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter(row => {
      if (statusFilter === 'active' && row.is_active === false) return false;
      if (statusFilter === 'inactive' && row.is_active !== false) return false;
      if (!needle) return true;
      return `${row.name || ''} ${row.code || ''} ${row.description || ''}`.toLowerCase().includes(needle);
    });
  }, [rows, query, statusFilter]);

  async function toggleActive(row: Category) {
    try {
      const res = await allPlatformCategoriesService.update({ id: row.id, is_active: row.is_active === false });
      if (res.success === false) throw new Error(res.message || 'Không cập nhật được trạng thái.');
      invalidateCrmCategoryCache(categoryType);
      await load(true);
      onChanged(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không cập nhật được trạng thái.');
    }
  }

  function handleSaved(category: Category) {
    setEditing(null);
    setAdding(false);
    invalidateCrmCategoryCache(categoryType);
    void load(true);
    onChanged(category);
  }

  return (
    <div className="qc-modal-backdrop qc-modal-backdrop--nested" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="crm-category-manage-drawer" onMouseDown={event => event.stopPropagation()}>
        <div className="crm-category-manage-head">
          <div>
            <p>Quản lý {typeLabel}</p>
            <span>Search · Thêm · Sửa · Đang sử dụng / Ngừng sử dụng</span>
          </div>
          <button type="button" onClick={onClose}>×</button>
        </div>
        {!(adding || editing) ? (
          <>
            <div className="crm-category-manage-toolbar">
              <input value={query} onChange={event => setQuery(event.target.value)} placeholder={`Tìm ${typeLabel}...`} />
              <button type="button" className="qc-btn qc-btn-primary" onClick={() => setAdding(true)}>+ Thêm {typeLabel}</button>
            </div>
            <div className="crm-category-status-tabs">
              {(['all', 'active', 'inactive'] as const).map(key => (
                <button key={key} type="button" className={statusFilter === key ? 'is-active' : ''} onClick={() => setStatusFilter(key)}>
                  {key === 'all' ? 'Tất cả' : key === 'active' ? 'Đang sử dụng' : 'Ngừng sử dụng'}
                </button>
              ))}
            </div>
            {error ? <div className="crm-inline-error">{error}</div> : null}
            <div className="crm-category-manage-list">
              {loading ? <div className="crm-searchable-select-empty">Đang tải...</div> : null}
              {!loading && filteredRows.length === 0 ? <div className="crm-searchable-select-empty">Không tìm thấy</div> : null}
              {filteredRows.map(row => (
                <div key={row.id} className="crm-category-manage-row">
                  <div>
                    <strong>{row.name || row.code}</strong>
                    <span>{row.code}</span>
                  </div>
                  <em className={row.is_active === false ? 'is-off' : ''}>{row.is_active === false ? 'Ngừng sử dụng' : 'Đang sử dụng'}</em>
                  <button type="button" className="qc-btn" onClick={() => setEditing(row)}>Sửa</button>
                  <button type="button" className="qc-btn" onClick={() => void toggleActive(row)}>
                    {row.is_active === false ? 'Bật lại' : 'Ngừng'}
                  </button>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {adding && <CrmCategoryQuickModal inline categoryType={categoryType} onClose={() => setAdding(false)} onSaved={handleSaved} />}
            {editing && <CrmCategoryQuickModal inline categoryType={categoryType} initialCategory={editing} onClose={() => setEditing(null)} onSaved={handleSaved} />}
          </div>
        )}
      </aside>
    </div>
  );
}

function CrmCategorySelectBase({
  categoryType,
  value,
  onChange,
  placeholder,
  disabled = false,
  fallbackOptions = [],
  excludeValues = [],
  hideClearOption = false,
  valueMode,
  labelSnapshot,
}: {
  categoryType: CategoryType;
  value: string;
  onChange: (value: string, label: string) => void;
  placeholder?: string;
  disabled?: boolean;
  fallbackOptions?: CrmCategoryOption[];
  excludeValues?: string[];
  hideClearOption?: boolean;
  valueMode: CategoryValueMode;
  labelSnapshot?: string | null;
}) {
  const [rows, setRows] = useState<Category[]>(() => cachedRows.get(`${categoryType}:active`) || []);
  const [canManage, setCanManage] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const typeLabel = categoryLabel(categoryType);

  async function refresh(force = false) {
    const nextRows = await fetchCrmCategoryRows(categoryType, true, force);
    setRows(nextRows);
    return nextRows;
  }

  useEffect(() => {
    let alive = true;
    void refresh(false).then(next => { if (alive) setRows(next); });
    void resolveCanManageCategories().then(allowed => { if (alive) setCanManage(allowed); });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryType]);

  const excluded = new Set(excludeValues.map(optionValue => optionValue.trim().toLowerCase()));
  const rowOptions = rows
    .map(row => getCategoryOption(row, valueMode))
    .filter((option): option is CrmCategoryOption => Boolean(option))
    .filter(option => !excluded.has(option.value.trim().toLowerCase()));
  const mergedOptions = rowOptions.length > 0 ? rowOptions : fallbackOptions;
  const selectedKnown = mergedOptions.some(option => option.value === value);
  const displayOptions =
    value && !selectedKnown ? [{ value, label: labelSnapshot || value }, ...mergedOptions] : mergedOptions;

  async function handleCreated(category: Category) {
    setQuickAddOpen(false);
    invalidateCrmCategoryCache(categoryType);
    const nextRows = await refresh(true);
    const selectedRow = nextRows.find(row => row.id === category.id) || category;
    onChange(getCategoryValue(selectedRow, valueMode), selectedRow.name || selectedRow.code || '');
  }

  async function handleManagedChanged(category?: Category) {
    invalidateCrmCategoryCache(categoryType);
    await refresh(true);
    if (category && valueMode === 'id' && category.id === value) onChange(getCategoryValue(category, valueMode), category.name || category.code || '');
  }

  return (
    <>
      <SearchableSelect
        value={value}
        disabled={disabled}
        onChange={next => {
          const picked = displayOptions.find(option => option.value === next);
          onChange(next, picked?.label || '');
        }}
        options={displayOptions}
        placeholder={placeholder || '-- Chọn --'}
        hideClearOption={hideClearOption}
        actions={
          canManage && !disabled
            ? [
                { key: 'create-category', label: `+ Thêm ${typeLabel}`, onSelect: () => setQuickAddOpen(true) },
                { key: 'manage-category', label: `Quản lý ${typeLabel}`, onSelect: () => setManageOpen(true) },
              ]
            : []
        }
      />
      {quickAddOpen ? (
        <CrmCategoryQuickModal categoryType={categoryType} onClose={() => setQuickAddOpen(false)} onSaved={category => void handleCreated(category)} />
      ) : null}
      {manageOpen ? (
        <CrmCategoryManageDrawer categoryType={categoryType} onClose={() => setManageOpen(false)} onChanged={category => void handleManagedChanged(category)} />
      ) : null}
    </>
  );
}

export function CrmCategorySelect({
  categoryType,
  value,
  onChange,
  placeholder,
  disabled = false,
  fallbackLabels = [],
  excludeLabels = [],
}: {
  categoryType: CategoryType;
  value: string;
  onChange: (label: string) => void;
  placeholder?: string;
  disabled?: boolean;
  fallbackLabels?: string[];
  excludeLabels?: string[];
}) {
  return (
    <CrmCategorySelectBase
      categoryType={categoryType}
      value={value}
      disabled={disabled}
      onChange={next => onChange(next)}
      placeholder={placeholder}
      fallbackOptions={fallbackLabels.map(label => ({ value: label, label }))}
      excludeValues={excludeLabels}
      valueMode="label"
    />
  );
}

export function CrmCategoryCodeSelect({
  categoryType,
  value,
  onChange,
  placeholder,
  disabled = false,
  fallbackOptions = [],
  excludeValues = [],
  hideClearOption = false,
}: {
  categoryType: CategoryType;
  value: string;
  onChange: (code: string) => void;
  placeholder?: string;
  disabled?: boolean;
  fallbackOptions?: CrmCategoryOption[];
  excludeValues?: string[];
  hideClearOption?: boolean;
}) {
  return (
    <CrmCategorySelectBase
      categoryType={categoryType}
      value={value}
      disabled={disabled}
      onChange={next => onChange(next)}
      placeholder={placeholder}
      fallbackOptions={fallbackOptions}
      excludeValues={excludeValues}
      hideClearOption={hideClearOption}
      valueMode="code"
    />
  );
}

export function CrmCategoryIdSelect({
  categoryType,
  value,
  labelSnapshot,
  onChange,
  placeholder,
  disabled = false,
}: {
  categoryType: CategoryType;
  value: string;
  labelSnapshot?: string | null;
  onChange: (id: string, label: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <CrmCategorySelectBase
      categoryType={categoryType}
      value={value}
      labelSnapshot={labelSnapshot}
      disabled={disabled}
      onChange={onChange}
      placeholder={placeholder}
      valueMode="id"
    />
  );
}
