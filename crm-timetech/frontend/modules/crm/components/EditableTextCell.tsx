'use client';

import { useRef, useState } from 'react';

/**
 * Ô bảng text bấm-vào-để-sửa, dùng trong bảng Preview Import Lead (Họ tên,
 * Công ty, SĐT, Email, Zalo, Facebook, Telegram, Website, Ghi chú). Theo
 * đúng state-machine của ContactAssignCell (CrmCustomerDetailPage.tsx): click
 * hiện input, onBlur/Enter lưu + đóng, Escape huỷ không lưu. Nguồn/Chức vụ
 * (combobox) và Người phụ trách (member picker) KHÔNG dùng component này —
 * chúng render thẳng SearchableSelect/MemberSearchSelect (đã tự có trigger
 * gọn trong cell, không cần bọc thêm 1 lớp click-to-edit).
 */
export function EditableTextCell({
  value,
  onSave,
  placeholder = '—',
  multiline = false,
}: {
  value: string;
  onSave: (next: string) => void;
  placeholder?: string;
  multiline?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  function startEdit() {
    setDraft(value);
    setEditing(true);
  }

  function commit() {
    setEditing(false);
    if (draft !== value) onSave(draft);
  }

  if (!editing) {
    return (
      <button type="button" className="crm-lead-import-cell-display" onClick={startEdit}>
        {value || <span className="crm-muted">{placeholder}</span>}
      </button>
    );
  }

  if (multiline) {
    return (
      <textarea
        autoFocus
        className="crm-lead-import-cell-input"
        rows={2}
        value={draft}
        onChange={event => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={event => {
          if (event.key === 'Escape') { event.preventDefault(); setEditing(false); }
        }}
      />
    );
  }

  return (
    <input
      ref={inputRef}
      autoFocus
      className="crm-lead-import-cell-input"
      value={draft}
      onChange={event => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={event => {
        if (event.key === 'Enter') { event.preventDefault(); commit(); }
        if (event.key === 'Escape') { event.preventDefault(); setEditing(false); }
      }}
    />
  );
}
