'use client';

import { useEffect, useRef, useState } from 'react';
import {
  CrmCategoryManageDrawer,
  CrmCategoryQuickModal,
  fetchCrmCategoryLabels,
  invalidateCrmCategoryCache,
  resolveCanManageCategories,
} from './CrmCategorySelect';
import { OTHER_PRODUCT_LABEL, OTHER_PRODUCT_PREFIX, parseProductList } from '../utils/leadQualificationRules';
import type { Category } from '@/types/unified.types';

const CATEGORY_TYPE = 'crm_service_package' as const;

function serializeProducts(known: string[], otherChecked: boolean, otherText: string): string {
  const parts = [...known];
  if (otherChecked) {
    const text = otherText.trim();
    parts.push(text ? `${OTHER_PRODUCT_PREFIX}${text}` : OTHER_PRODUCT_LABEL);
  }
  return parts.join(', ');
}

/** "Khách đang quan tâm gì?" - cho chọn NHIỀU sản phẩm/dịch vụ cùng lúc +
 * "Khác" nhập tay (feedback leader, PDF góp ý màn Xác minh Lead: "cho chọn
 * nhiều giải pháp", "nếu chọn khác thì nhập tay vào"), thay cho
 * CrmCategorySelect đơn 1 giá trị trước đây. Value vẫn là 1 chuỗi (nối bằng
 * ", ") để tương thích ĐÚNG cột TEXT `qualification_need` sẵn có, không cần
 * đổi kiểu dữ liệu/migration.
 *
 * Giữ lại "+ Thêm sản phẩm/dịch vụ"/"Quản lý sản phẩm/dịch vụ" (feedback:
 * "trước đây có 2 nút ở dưới đâu rồi?" - CrmCategorySelect bản cũ vốn có 2
 * action này qua SearchableSelect, bản multi-select viết riêng lúc đầu bị bỏ
 * sót) - tu quan ly state/cache rieng (khong dung useCrmCategoryLabels) de
 * co the force-refresh danh sach ngay sau khi Admin them/sua danh muc. */
export function CrmProductMultiSelect({
  value,
  onChange,
  disabled = false,
  placeholder = '-- Chọn sản phẩm / dịch vụ --',
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [knownLabels, setKnownLabels] = useState<string[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  async function refreshLabels(force = false) {
    if (force) invalidateCrmCategoryCache(CATEGORY_TYPE);
    const next = await fetchCrmCategoryLabels(CATEGORY_TYPE);
    setKnownLabels(next);
  }

  useEffect(() => {
    void refreshLabels(false);
    void resolveCanManageCategories().then(setCanManage);
  }, []);

  const items = parseProductList(value);
  const knownSet = new Set(knownLabels);
  const known = items.filter(item => knownSet.has(item));
  const otherItem = items.find(item => !knownSet.has(item)) || '';
  const otherChecked = Boolean(otherItem);
  const otherText = otherItem.startsWith(OTHER_PRODUCT_PREFIX) ? otherItem.slice(OTHER_PRODUCT_PREFIX.length) : otherItem;

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (containerRef.current?.contains(target)) return;
      setOpen(false);
      setSearch('');
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function toggleKnown(label: string) {
    if (disabled) return;
    const next = known.includes(label) ? known.filter(item => item !== label) : [...known, label];
    onChange(serializeProducts(next, otherChecked, otherText));
  }

  function toggleOther() {
    if (disabled) return;
    onChange(serializeProducts(known, !otherChecked, otherText));
  }

  function updateOtherText(text: string) {
    onChange(serializeProducts(known, true, text));
  }

  async function handleQuickAdded(category: Category) {
    setQuickAddOpen(false);
    await refreshLabels(true);
    const label = category.name || category.code;
    if (label && !known.includes(label)) onChange(serializeProducts([...known, label], otherChecked, otherText));
  }

  async function handleManageChanged() {
    await refreshLabels(true);
  }

  const chips: string[] = [...known];
  if (otherChecked) chips.push(otherText.trim() ? `Khác: ${otherText.trim()}` : 'Khác');

  const filteredLabels = search.trim()
    ? knownLabels.filter(label => label.toLowerCase().includes(search.trim().toLowerCase()))
    : knownLabels;

  return (
    <div className="crm-product-multi" ref={containerRef}>
      <button
        type="button"
        className={`crm-product-multi-trigger ${chips.length ? 'has-value' : ''} ${open ? 'is-open' : ''}`}
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
      >
        {chips.length ? (
          <span className="crm-product-multi-chips">
            {chips.map(chip => (
              <span key={chip} className="crm-product-chip">{chip}</span>
            ))}
          </span>
        ) : (
          <span className="crm-product-multi-placeholder">{placeholder}</span>
        )}
        <span className="crm-select-chevron" aria-hidden>▾</span>
      </button>
      {open && !disabled ? (
        <div className="crm-product-multi-menu">
          <input
            autoFocus
            type="text"
            className="crm-product-multi-search"
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Tìm sản phẩm / dịch vụ..."
          />
          <div className="crm-product-multi-options">
            {filteredLabels.map(label => (
              <label key={label} className="crm-product-multi-option">
                <input type="checkbox" checked={known.includes(label)} onChange={() => toggleKnown(label)} />
                <span>{label}</span>
              </label>
            ))}
            {filteredLabels.length === 0 ? (
              <div className="crm-product-multi-empty">Không tìm thấy</div>
            ) : null}
            <label className="crm-product-multi-option">
              <input type="checkbox" checked={otherChecked} onChange={toggleOther} />
              <span>{OTHER_PRODUCT_LABEL}</span>
            </label>
          </div>
          {canManage ? (
            <div className="crm-product-multi-actions">
              <button type="button" onClick={() => { setOpen(false); setQuickAddOpen(true); }}>
                + Thêm sản phẩm / dịch vụ
              </button>
              <button type="button" onClick={() => { setOpen(false); setManageOpen(true); }}>
                Quản lý sản phẩm / dịch vụ
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      {/* Ô nhập tay "Khác" hiện THƯỜNG TRỰC ngay dưới ô chọn (đúng mockup
       * markee_crm_v38..., không chỉ hiện lúc mở dropdown) - cho sửa nhanh
       * không cần mở lại dropdown mỗi lần. */}
      {otherChecked ? (
        <input
          type="text"
          className="crm-product-multi-other-input"
          disabled={disabled}
          value={otherText}
          onChange={event => updateOtherText(event.target.value)}
          placeholder="Nhập tay sản phẩm / dịch vụ khác"
        />
      ) : null}
      {quickAddOpen ? (
        <CrmCategoryQuickModal categoryType={CATEGORY_TYPE} onClose={() => setQuickAddOpen(false)} onSaved={category => void handleQuickAdded(category)} />
      ) : null}
      {manageOpen ? (
        <CrmCategoryManageDrawer categoryType={CATEGORY_TYPE} onClose={() => setManageOpen(false)} onChanged={() => void handleManageChanged()} />
      ) : null}
    </div>
  );
}
