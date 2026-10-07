'use client';

import React from 'react';

interface WorkspaceBadgeProps {
  instance?: string;
  className?: string;
}

/**
 * TÍCH HỢP BỘ LỌC WORKSPACE: Tag hiển thị nhãn thương hiệu / Workspace của nhóm sản phẩm.
 * Tuân thủ quy chuẩn thiết kế UI/UX: font 11px, bo góc nhẹ, viền border đồng bộ.
 */
export function WorkspaceBadge({ instance, className = '' }: WorkspaceBadgeProps) {
  const inst = (instance || 'markee').toLowerCase();

  let label = 'Markee';
  let badgeClass = 'bg-rose-50 text-rose-700 border-rose-200';

  if (inst === 'cloudgate') {
    label = 'CloudGate';
    badgeClass = 'bg-sky-50 text-sky-700 border-sky-200';
  } else if (inst === 'securityzone') {
    label = 'SecurityZone';
    badgeClass = 'bg-emerald-50 text-emerald-700 border-emerald-200';
  } else if (inst !== 'markee') {
    label = inst.toUpperCase();
    badgeClass = 'bg-slate-50 text-slate-700 border-slate-200';
  }

  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium border ${badgeClass} ${className}`}
      title={`Workspace: ${label}`}
    >
      {label}
    </span>
  );
}
