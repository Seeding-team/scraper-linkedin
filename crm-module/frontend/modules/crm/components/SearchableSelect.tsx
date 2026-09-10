'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type Option = string | { value: string; label: string };

function optionValue(option: Option): string {
  return typeof option === 'string' ? option : option.value;
}

function optionLabel(option: Option): string {
  return typeof option === 'string' ? option : option.label;
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
  placeholder = '-- Chọn --',
  disabled = false,
  // Yeu cau rieng "bỏ chữ Chưa thuộc dự án/Chọn cơ hội trong danh sách" -
  // trigger DA hien dung placeholder nay khi chua chon gi, hien lai 1 lan
  // nua thanh 1 dong trong danh sach (dung de "clear ve rong") bi thua/gay
  // roi mat voi 1 so field (vd Dự án/Cơ hội trong Quote Workspace). Mac dinh
  // van hien (khong doi hanh vi cac noi goi khac), CHI tat khi truyen ro
  // hideClearOption.
  hideClearOption = false,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  hideClearOption?: boolean;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
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
    ? options.filter(o => foldDiacritics(optionLabel(o)).includes(foldDiacritics(search.trim())))
    : options;

  const selectedLabel = options.find(o => optionValue(o) === value);

  return (
    <div ref={containerRef} className="crm-searchable-select">
      <button
        type="button"
        className="crm-searchable-select-trigger"
        onClick={() => !disabled && setIsOpen(open => !open)}
        disabled={disabled}
      >
        <span>{selectedLabel ? optionLabel(selectedLabel) : placeholder}</span>
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
                placeholder="Tìm..."
                className="crm-searchable-select-input"
              />
              <div className="crm-searchable-select-list">
                {hideClearOption ? null : (
                  <button
                    type="button"
                    className="crm-searchable-select-option"
                    onClick={() => { onChange(''); setIsOpen(false); setSearch(''); }}
                  >
                    {placeholder}
                  </button>
                )}
                {filtered.map(option => (
                  <button
                    key={optionValue(option)}
                    type="button"
                    className={`crm-searchable-select-option ${value === optionValue(option) ? 'is-selected' : ''}`}
                    onClick={() => { onChange(optionValue(option)); setIsOpen(false); setSearch(''); }}
                  >
                    {optionLabel(option)}
                  </button>
                ))}
                {filtered.length === 0 ? (
                  <div className="crm-searchable-select-empty">Không tìm thấy</div>
                ) : null}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
