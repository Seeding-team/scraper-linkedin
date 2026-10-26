'use client';

import React from 'react';

interface WorkspaceBadgeProps {
  instance?: string;
  /** Many-to-many Workspace (migration 190): set task-added assignment; "instance" legacy
   * duoc giuung de khong phai sua cỉ prop trong các che do cu. */
  workspaces?: string[];
  className?: string;
}

const WORKSPACE_LABEL_STYLE: Record<string, { label: string; badgeClass: string }> = {
  markee: { label: 'Markee', badgeClass: 'bg-rose-50 text-rose-700 border-rose-200' },
  cloudgate: { label: 'CloudGate', badgeClass: 'bg-sky-50 text-sky-700 border-sky-200' },
  securityzone: { label: 'SecurityZone', badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  timetech: { label: 'TimeTech', badgeClass: 'bg-amber-50 text-amber-700 border-amber-200' },
};

function workspaceStyle(instance: string): { label: string; badgeClass: string } {
  const inst = (instance || 'markee').toLowerCase();
  return WORKSPACE_LABEL_STYLE[inst] || {
    label: inst.toUpperCase(),
    badgeClass: 'bg-slate-50 text-slate-700 border-slate-200',
  };
}

function badgeOf(instance: string, className: string) {
  const style = workspaceStyle(instance);
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium border ${style.badgeClass} ${className}`}
      title={`Workspace: ${style.label}`}
    >
      {style.label}
    </span>
  );
}

/**
 * Tag hiển thị nhãn thương hiệu / Workspace của nhóm sản phẩm.
 * - instance đơn (read-path cũ).
 * - workspaces[] (many-to-many, migration 190): render 1 tag cho MỖI workspace,
 *   viền theo brand, không lặp, không sinh tag rác cho giá trị rỗng.
 */
export function WorkspaceBadge({ instance, workspaces, className = '' }: WorkspaceBadgeProps) {
  if (Array.isArray(workspaces) && workspaces.length > 0) {
    const unique = Array.from(new Set(workspaces.map(w => (w || '').toLowerCase()).filter(Boolean)));
    if (unique.length > 0) {
      return (
        <span className={`inline-flex items-center gap-1 ${className}`}>
          {unique.map(inst => (
            <React.Fragment key={inst}>{badgeOf(inst, '')}</React.Fragment>
          ))}
        </span>
      );
    }
  }
  return badgeOf(instance || 'markee', className);
}
