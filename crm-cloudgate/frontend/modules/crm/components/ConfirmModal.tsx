'use client';

import { X } from './icons';

export interface ConfirmModalAction {
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'default';
  disabled?: boolean;
}

/** Modal xác nhận dùng chung (thay window.confirm) — hỗ trợ 2-3 nút tuỳ
 * dùng (không chỉ đúng/huỷ đơn thuần, vd "Tăng số lượng dòng có sẵn" /
 * "Vẫn thêm dòng mới" / "Huỷ"). Style theo đúng class crm-modal-* hiện có,
 * không cần CSS mới. */
export function ConfirmModal({
  open,
  title,
  message,
  actions,
  onClose,
}: {
  open: boolean;
  title: string;
  message: string;
  actions: ConfirmModalAction[];
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div className="crm-modal-backdrop" onClick={onClose}>
      <div className="crm-modal crm-modal--confirm" onClick={event => event.stopPropagation()}>
        <header className="crm-modal-header">
          <h2 className="crm-modal-title">{title}</h2>
          <button type="button" className="crm-modal-close" onClick={onClose} aria-label="Đóng">
            <X className="crm-icon" />
          </button>
        </header>
        <div className="crm-modal-body">
          <p>{message}</p>
        </div>
        <footer className="crm-modal-footer">
          <div className="crm-deal-footer-actions">
            <button type="button" className="crm-cancel-button" onClick={onClose}>Huỷ</button>
            {actions.map((action, index) => (
              <button
                key={index}
                type="button"
                className={action.variant === 'primary' ? 'crm-save-button' : 'crm-cancel-button'}
                disabled={action.disabled}
                onClick={action.onClick}
              >
                {action.label}
              </button>
            ))}
          </div>
        </footer>
      </div>
    </div>
  );
}
