'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { TableIcon } from './icons';
import type { CustomerColumnKey } from '../hooks/useCustomerColumnPreferences';

const COLUMN_OPTIONS: Array<{ key: CustomerColumnKey; label: string }> = [
  { key: 'primaryContact', label: 'Người liên hệ chính' },
  { key: 'phone', label: 'SĐT' },
  { key: 'email', label: 'Email' },
  { key: 'taxCode', label: 'MST' },
  { key: 'dealCount', label: 'Cơ hội' },
  { key: 'pipelineValue', label: 'Giá trị Pipeline' },
  { key: 'status', label: 'Trạng thái' },
  { key: 'owner', label: 'Owner' },
];

/**
 * Nut "Cột hiển thị" (secondary/outline) canh "+ Thêm khách hàng" tren trang
 * Khach hang - mo popover cho tick/bo-tick tung cot phu (Doanh nghiệp/Hành
 * động luon hien, khong dua vao day). Tick/bo tick cap nhat bang NGAY qua
 * props tu component cha (useCustomerColumnPreferences) - khong goi API,
 * khong reload. Portal + position:fixed giong ActionMenu.tsx/
 * ContactSummaryPopover de khong bi .crm-table-card cat mat.
 */
export function CustomerColumnVisibilityMenu({
  visible,
  onToggle,
  onSelectAll,
  onReset,
}: {
  visible: Set<CustomerColumnKey>;
  onToggle: (key: CustomerColumnKey) => void;
  onSelectAll: () => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  function openMenu() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setPosition({ top: rect.bottom + 4, left: rect.left });
    setOpen(true);
  }

  useLayoutEffect(() => {
    if (!open || !position) return;
    const popover = popoverRef.current;
    const trigger = triggerRef.current;
    if (!popover || !trigger) return;
    const rect = trigger.getBoundingClientRect();
    const margin = 8;
    let top = rect.bottom + 4;
    if (top + popover.offsetHeight + margin > window.innerHeight) {
      const above = rect.top - popover.offsetHeight - 4;
      top = above >= margin ? above : Math.max(margin, window.innerHeight - popover.offsetHeight - margin);
    }
    const left = Math.min(rect.left, Math.max(margin, window.innerWidth - popover.offsetWidth - margin));
    if (Math.abs(top - position.top) > 0.5 || Math.abs(left - position.left) > 0.5) {
      setPosition({ top, left });
    }
  }, [open, position]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    function onScroll() {
      setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="crm-secondary-button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openMenu())}
      >
        <TableIcon className="crm-button-icon" /> Cột hiển thị
      </button>
      {open && position
        ? createPortal(
            <div
              ref={popoverRef}
              className="crm-column-visibility-popover"
              role="dialog"
              aria-label="Cột hiển thị"
              style={{ top: position.top, left: position.left }}
            >
              <p className="crm-column-visibility-title">Cột hiển thị</p>
              <ul className="crm-column-visibility-list">
                {COLUMN_OPTIONS.map(option => (
                  <li key={option.key}>
                    <label className="crm-column-visibility-item">
                      <input
                        type="checkbox"
                        checked={visible.has(option.key)}
                        onChange={() => onToggle(option.key)}
                      />
                      <span>{option.label}</span>
                    </label>
                  </li>
                ))}
              </ul>
              <div className="crm-column-visibility-actions">
                <button type="button" className="crm-secondary-button" onClick={onSelectAll}>
                  Chọn tất cả
                </button>
                <button type="button" className="crm-secondary-button" onClick={onReset}>
                  Khôi phục mặc định
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
