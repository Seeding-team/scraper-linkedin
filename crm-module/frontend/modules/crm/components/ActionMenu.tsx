'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ComponentType, SVGProps } from 'react';
import { createPortal } from 'react-dom';
import { MoreVertical } from './icons';

export type ActionMenuItem = {
  key: string;
  label: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** Tooltip khi item bị disabled (vd lý do backend chưa hỗ trợ) — hiện qua
   * thuộc tính title chuẩn của trình duyệt. */
  title?: string;
  /** Icon hệ thống (từ ./icons) hiện bên trái label — không dùng emoji/ký tự. */
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  /** Nhãn nhỏ hiện bên phải item (vd "V2" cho "Tạo phiên bản mới", số lượng
   * version cho "Lịch sử phiên bản") — không phải hành động, chỉ hiển thị. */
  trailing?: string;
  /** Số thứ tự nhóm — item khác `group` với item ngay trước sẽ tự chèn 1
   * đường phân cách (separator) ở giữa, giống menu tham khảo (HTML) chia
   * "Mở/Sửa/Duyệt" | "Tạo phiên bản/Preview" | "Copy link/Gửi email" |
   * "Lịch sử version" thành các cụm riêng. Không cần khai báo separator
   * riêng — chỉ cần đặt đúng số group. */
  group?: number;
};

/**
 * Nút "⋯" mở dropdown chứa các hành động phụ (Sửa, Xóa, Tạo deal...) —
 * dùng chung cho mọi bảng/row trong CRM để tránh hàng nút hành động bị
 * bóp/wrap ở màn hình hẹp. Tự đóng khi click ra ngoài, cuộn trang, hoặc
 * nhấn Escape.
 *
 * Danh sách dropdown render qua Portal vào document.body (position: fixed,
 * toạ độ tính từ getBoundingClientRect() của nút bấm) — KHÔNG render lồng
 * trong .crm-table-card như trước, vì card đó có overflow:hidden (bo góc
 * bảng) nên dropdown mở ở hàng gần mép phải/dưới bị cắt mất, chỉ lộ ra vài
 * pixel (bug thực tế thấy trên UI, không phải giả thuyết).
 *
 * Dùng: <ActionMenu items={[{ key: 'edit', label: 'Sửa', onSelect: ... }]} />
 */
export function ActionMenu({ items, label = 'Thao tác khác' }: { items: ActionMenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; right: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  function openMenu() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      setPosition({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    }
    setOpen(true);
  }

  /** Menu render qua Portal voi position:fixed nen KHONG the cuon vao tam
   * nhin: neu no roi ra ngoai day man hinh thi coi nhu bam khong duoc. Tren
   * man hep (mobile), nut "⋯" cua the Lead nam sat day trang -> toan bo menu
   * (ke ca muc "Xóa Lead" o cuoi) nam duoi viewport. Do chieu cao THAT sau khi
   * render roi lat len tren nut neu khong con cho, va ep menu nam trong man
   * hinh theo ca 2 chieu. */
  useLayoutEffect(() => {
    if (!open || !position) return;
    const list = listRef.current;
    const trigger = triggerRef.current;
    if (!list || !trigger) return;
    const rect = trigger.getBoundingClientRect();
    const height = list.offsetHeight;
    const margin = 8;
    let top = rect.bottom + 4;
    if (top + height + margin > window.innerHeight) {
      const above = rect.top - height - 4;
      top = above >= margin ? above : Math.max(margin, window.innerHeight - height - margin);
    }
    const right = Math.min(
      Math.max(margin, window.innerWidth - rect.right),
      Math.max(margin, window.innerWidth - list.offsetWidth - margin),
    );
    if (Math.abs(top - position.top) > 0.5 || Math.abs(right - position.right) > 0.5) {
      setPosition({ top, right });
    }
  }, [open, position]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (listRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    // Dong menu khi cuon (trang hoac ben trong bang) thay vi theo doi lai vi
    // tri lien tuc - don gian, dung idiom pho bien cua cac thu vien dropdown.
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

  if (!items.length) return null;

  return (
    <div className="crm-action-menu">
      <button
        ref={triggerRef}
        type="button"
        className="crm-icon-action crm-action-menu-trigger"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={event => {
          event.stopPropagation();
          if (open) {
            setOpen(false);
          } else {
            openMenu();
          }
        }}
      >
        <MoreVertical className="crm-inline-icon" />
      </button>
      {open && position
        ? createPortal(
            <div
              ref={listRef}
              className="crm-action-menu-list crm-action-menu-list--portal"
              role="menu"
              style={{ top: position.top, right: position.right }}
            >
              {items.map((item, index) => {
                const prev = items[index - 1];
                const needsSeparator = index > 0 && prev?.group !== undefined && item.group !== undefined && prev.group !== item.group;
                const Icon = item.icon;
                return (
                  <div key={item.key}>
                    {needsSeparator ? <div className="crm-action-menu-separator" role="separator" /> : null}
                    <button
                      type="button"
                      role="menuitem"
                      disabled={item.disabled}
                      title={item.title}
                      className={`crm-action-menu-item ${item.danger ? 'crm-action-menu-item--danger' : ''}`}
                      onClick={event => {
                        event.stopPropagation();
                        setOpen(false);
                        item.onSelect();
                      }}
                    >
                      {Icon ? <Icon className="crm-action-menu-item-icon" /> : null}
                      <span className="crm-action-menu-item-label">{item.label}</span>
                      {item.trailing ? <span className="crm-action-menu-item-trailing">{item.trailing}</span> : null}
                    </button>
                  </div>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
