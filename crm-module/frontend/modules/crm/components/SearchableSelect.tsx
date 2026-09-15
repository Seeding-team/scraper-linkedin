'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';

type Option = string | { value: string; label: string; richLabel?: ReactNode; searchText?: string; disabled?: boolean };
type SelectAction = { key: string; label: string; onSelect: () => void; disabled?: boolean; type?: 'add' | 'manage' | 'default' };
import { Settings } from 'lucide-react';

function optionValue(option: Option): string {
  return typeof option === 'string' ? option : option.value;
}

function optionLabel(option: Option): string {
  return typeof option === 'string' ? option : option.label;
}

// richLabel (khi co, vd MemberSearchSelect ve avatar+ten+subtitle) - dung DE
// HIEN THI thay vi label thuong (van dung label thuong lam fallback text cho
// trigger/search - xem optionLabel/optionSearchText).
function optionRichLabel(option: Option): ReactNode {
  return typeof option === 'string' ? option : (option.richLabel ?? option.label);
}

// searchText (khi co, vd MemberSearchSelect ghep them email/ma nhan vien) -
// dung DE TIM thay vi label hien thi, cho phep go email/ma nhan vien van ra
// dung ket qua ngay ca khi label chi hien ten.
function optionSearchText(option: Option): string {
  return typeof option === 'string' ? option : option.searchText ?? option.label;
}

function optionDisabled(option: Option): boolean {
  return typeof option === 'string' ? false : Boolean(option.disabled);
}

// Bỏ dấu tiếng Việt để search không phân biệt dấu (vd gõ "giam doc" vẫn khớp
// "Giám đốc") — dùng chung cho mọi nơi gọi SearchableSelect, không riêng gì
// Chức vụ, vì lợi ích này áp dụng tốt như nhau cho Nguồn/Gói/Lĩnh vực.
function foldDiacritics(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase();
}

/** Dropdown <select> tùy biến (trigger + menu tìm kiếm được) — dùng thay cho
 * <select> gốc để mọi dropdown trong form CRM có cùng 1 kiểu hiển thị, không
 * lệ thuộc vào cách mỗi trình duyệt tự vẽ <select>/<option> gốc. */
export function SearchableSelect({
  value,
  onChange,
  options,
  actions = [],
  placeholder = '-- Chọn --',
  searchPlaceholder = 'Tìm...',
  disabled = false,
  // Yeu cau rieng "bỏ chữ Chưa thuộc dự án/Chọn cơ hội trong danh sách" -
  // trigger DA hien dung placeholder nay khi chua chon gi, hien lai 1 lan
  // nua thanh 1 dong trong danh sach (dung de "clear ve rong") bi thua/gay
  // roi mat voi 1 so field (vd Dự án/Cơ hội trong Quote Workspace). Mac dinh
  // van hien (khong doi hanh vi cac noi goi khac), CHI tat khi truyen ro
  // hideClearOption.
  hideClearOption = false,
  loading = false,
  emptyText = 'Không tìm thấy',
  testId,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  actions?: SelectAction[];
  hideClearOption?: boolean;
  placeholder?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  loading?: boolean;
  emptyText?: string;
  /** Gan data-testid len container ngoai cung - giu tuong thich cho cac
   * Playwright script cu tra cuu theo id nay (dau vay ban query truoc
   * gio dua vao "<select> option" that se khong con dung, vi day la
   * dropdown div-based, khong phai <select> goc). */
  testId?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [menuStyle, setMenuStyle] = useState<{ top: number; left: number; width: number } | null>(null);

  /** Menu render qua Portal ra document.body (position:fixed) - KHONG con long
   * trong container co overflow (vd o loc trong bang bao gia) vi container do
   * cat mat menu o hang gan mep (bug thuc te da thay tren UI). Toa do tinh tu
   * getBoundingClientRect() cua trigger, tu lat len tren neu gan day viewport,
   * giong dung idiom da dung o ActionMenu.tsx. */
  useLayoutEffect(() => {
    if (!isOpen) return;
    const trigger = containerRef.current;
    const menu = menuRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(Math.max(rect.width, 260), 320);
    const margin = 8;
    let left = rect.left;
    if (left + width + margin > window.innerWidth) {
      left = Math.max(margin, window.innerWidth - width - margin);
    }
    const menuHeight = menu?.offsetHeight ?? 0;
    let top = rect.bottom + 4;
    if (menuHeight && top + menuHeight + margin > window.innerHeight) {
      const above = rect.top - menuHeight - 4;
      top = above >= margin ? above : Math.max(margin, window.innerHeight - menuHeight - margin);
    }
    setMenuStyle(prev => {
      if (prev && Math.abs(prev.top - top) < 0.5 && Math.abs(prev.left - left) < 0.5 && Math.abs(prev.width - width) < 0.5) {
        return prev;
      }
      return { top, left, width };
    });
  });

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (containerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setIsOpen(false);
      setSearch('');
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
        setSearch('');
      }
    };
    // Chi dong menu khi CUON BEN NGOAI menu (trang/bang chua no) - cuon BEN
    // TRONG danh sach option (list dai, co overflow-y:auto rieng) KHONG duoc
    // tinh, vi 'scroll' bat o pha capture tren window se "thay" ca scroll cua
    // chinh list nay - neu khong loai truong hop nay, cuon chuot trong list
    // se dong menu ngay lap tuc (bug that da gap: "cuon khong duoc" vi menu
    // tu dong tat truoc khi nguoi dung kip thay noi dung cuon).
    const handleReposition = (event: Event) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('scroll', handleReposition, true);
    window.addEventListener('resize', handleReposition);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', handleReposition, true);
      window.removeEventListener('resize', handleReposition);
    };
  }, []);

  const filtered = search.trim()
    ? options.filter(o => foldDiacritics(optionSearchText(o)).includes(foldDiacritics(search.trim())))
    : options;

  // Giu nguoi/gia tri DANG DUOC CHON hien o dau danh sach ke ca khi khong
  // khop filter hien tai - vd ban ghi cu/da nghi viec van phai thay duoc
  // "dang gan cho ai" thay vi bien mat khoi list khi go tim (yeu cau
  // "Keep currently selected member visible even if temporarily outside the
  // current filter"). Chi ap dung khi value THAT SU ton tai trong options
  // goc (khong tu bia them lua chon khong co that).
  const selectedOption = value ? options.find(o => optionValue(o) === value) : undefined;
  const visibleOptions =
    selectedOption && !filtered.some(o => optionValue(o) === value) ? [selectedOption, ...filtered] : filtered;

  const selectedLabel = options.find(o => optionValue(o) === value);

  // Danh sach dieu huong ban phim PHAI khop DUNG thu tu render ben duoi (dong
  // "clear" - neu co - roi moi den tung option) de arrow-key/Enter chon
  // trung voi cai dang highlight tren man hinh.
  const keyboardItems: Array<{ value: string; disabled?: boolean }> = [
    ...(hideClearOption ? [] : [{ value: '' }]),
    ...visibleOptions.map(o => ({ value: optionValue(o), disabled: optionDisabled(o) })),
  ];

  useEffect(() => {
    setHighlightedIndex(0);
  }, [search, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const el = listRef.current?.querySelector<HTMLElement>('[data-highlighted="true"]');
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlightedIndex, isOpen]);

  function handleInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlightedIndex(i => Math.min(i + 1, keyboardItems.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlightedIndex(i => Math.max(i - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const target = keyboardItems[highlightedIndex];
      if (target && !target.disabled) {
        onChange(target.value);
        setIsOpen(false);
        setSearch('');
      }
    }
  }

  return (
    <div ref={containerRef} className="crm-searchable-select" data-testid={testId}>
      <button
        type="button"
        className="crm-searchable-select-trigger"
        onClick={() => !disabled && setIsOpen(open => !open)}
        disabled={disabled}
      >
        <span>{selectedLabel ? optionRichLabel(selectedLabel) : placeholder}</span>
        <span aria-hidden>▾</span>
      </button>
      {isOpen && !disabled && menuStyle
        ? createPortal(
            <div
              ref={menuRef}
              className="crm-searchable-select-menu crm-searchable-select-menu--portal"
              style={{ top: menuStyle.top, left: menuStyle.left, width: menuStyle.width }}
            >
              <input
                autoFocus
                type="text"
                value={search}
                onChange={event => setSearch(event.target.value)}
                onKeyDown={handleInputKeyDown}
                placeholder={searchPlaceholder}
                className="crm-searchable-select-input"
              />
              <div className="crm-searchable-select-list" ref={listRef}>
                {hideClearOption ? null : (
                  <button
                    type="button"
                    data-highlighted={highlightedIndex === 0}
                    className={`crm-searchable-select-option ${highlightedIndex === 0 ? 'is-highlighted' : ''}`}
                    onClick={() => { onChange(''); setIsOpen(false); setSearch(''); }}
                  >
                    {placeholder}
                  </button>
                )}
                {!loading && visibleOptions.map((option, index) => {
                  const keyboardIndex = (hideClearOption ? 0 : 1) + index;
                  return (
                    <button
                      key={optionValue(option)}
                      type="button"
                      disabled={optionDisabled(option)}
                      data-highlighted={highlightedIndex === keyboardIndex}
                      className={`crm-searchable-select-option ${value === optionValue(option) ? 'is-selected' : ''} ${highlightedIndex === keyboardIndex ? 'is-highlighted' : ''}`}
                      onClick={() => { if (optionDisabled(option)) return; onChange(optionValue(option)); setIsOpen(false); setSearch(''); }}
                    >
                      {optionRichLabel(option)}
                    </button>
                  );
                })}
                {loading ? (
                  <div className="crm-searchable-select-empty">Đang tải...</div>
                ) : visibleOptions.length === 0 ? (
                  <div className="crm-searchable-select-empty">{emptyText}</div>
                ) : null}
              </div>
              {actions.length > 0 ? (
                <div className="crm-searchable-select-actions">
                  <div className="crm-searchable-select-divider" />
                  {actions.map(action => (
                    <button
                      key={action.key}
                      type="button"
                      className={`crm-searchable-select-action ${action.type ? 'crm-searchable-select-action--' + action.type : ''}`}
                      disabled={action.disabled}
                      onClick={() => {
                        if (action.disabled) return;
                        action.onSelect();
                        setIsOpen(false);
                        setSearch('');
                      }}
                    >
                      {action.type === 'manage' && <Settings size={14} style={{ marginRight: 6 }} />}
                      {action.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
