'use client';

import type { ReactNode } from 'react';
import { X, ArrowLeft } from '../icons';

/** Drawer bên phải DÙNG CHUNG cho toàn bộ Quản lý tiến độ - hiển thị breadcrumb
 * (Team Sales / Thanh / Báo giá / BG-202609...) + nút Back quay lại đúng 1 lớp
 * trước trong CÙNG drawer (không reload trang, không navigate ra khỏi module -
 * yêu cầu rebuild interaction). `breadcrumb` là toàn bộ chuỗi nhãn hiện có,
 * `onBreadcrumbClick(index)` cho phép nhảy thẳng về 1 mốc bất kỳ trong chuỗi. */
export function ProgressRightDrawer({
  eyebrow,
  title,
  subtitle,
  children,
  onClose,
  onBack,
  breadcrumb,
  onBreadcrumbClick,
  width: _legacyWidth,
  hideHeader = false,
  persistent = false,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string | null;
  children: ReactNode;
  onClose: () => void;
  onBack?: () => void;
  breadcrumb?: string[];
  onBreadcrumbClick?: (index: number) => void;
  /** Da bo: chieu rong gio theo chuan chung --crm-drawer-width (crm.css), giu prop de khong vo noi goi cu. */
  width?: number;
  hideHeader?: boolean;
  /** Drawer "persistent" (Lead 360): khong co lop phu chan thao tac ben duong, KHONG dong khi bam ra ngoai - chi dong bang nut X. */
  persistent?: boolean;
}) {
  return (
    <>
      <div className={`progress-drawer-backdrop${persistent ? ' progress-drawer-backdrop--passive' : ''}`} onClick={persistent ? undefined : onClose} />
      <aside className={`progress-drawer${persistent ? ' progress-drawer--persistent' : ''}`}>
        {!hideHeader && (
          <header className="progress-drawer-header">
          <div className="min-w-0" style={{ flex: 1 }}>
            {breadcrumb && breadcrumb.length > 1 ? (
              <nav className="progress-drawer-breadcrumb">
                {breadcrumb.map((label, idx) => (
                  <span key={idx} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {idx > 0 ? <span>/</span> : null}
                    {idx === breadcrumb.length - 1 ? (
                      <span className="current">{label}</span>
                    ) : (
                      <button type="button" onClick={() => onBreadcrumbClick?.(idx)}>{label}</button>
                    )}
                  </span>
                ))}
              </nav>
            ) : null}
            <div className="progress-drawer-header-row">
              {onBack ? (
                <button type="button" className="progress-drawer-back" onClick={onBack} aria-label="Quay lại">
                  <ArrowLeft className="crm-icon" />
                </button>
              ) : null}
              <div className="min-w-0">
                {eyebrow ? <span>{eyebrow}</span> : null}
                <h2>{title}</h2>
                {subtitle ? <p>{subtitle}</p> : null}
              </div>
            </div>
          </div>
          <button type="button" className="progress-drawer-close" onClick={onClose} aria-label="Đóng">
            <X className="crm-icon" />
          </button>
        </header>
        )}
        <div className="progress-drawer-body" style={hideHeader ? { padding: 0 } : undefined}>
          {children}
        </div>
      </aside>
    </>
  );
}
