'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Building2, ChevronDown, RotateCcw } from 'lucide-react';
import type { WorkspaceMeta } from './types';

interface WorkspaceFilterPopoverProps {
  workspaces: WorkspaceMeta[];
  appliedWorkspaces: string[];
  triggerLabel: string;
  loading?: boolean;
  onApply: (workspaces: string[]) => void;
  onReset: () => void;
}

/**
 * TÍCH HỢP BỘ LỌC WORKSPACE: Nút bộ lọc đa chọn Workspace theo chuẩn UI/UX.
 * - Hiển thị trên Seeding chính, cho phép chọn 1, nhiều hoặc tất cả các workspace.
 * - Danh sách nạp động 100% từ Database qua prop workspaces.
 * - Nhấn "Áp dụng" để kích hoạt tải dữ liệu tương ứng.
 */
export function WorkspaceFilterPopover({
  workspaces,
  appliedWorkspaces,
  triggerLabel,
  loading,
  onApply,
  onReset,
}: WorkspaceFilterPopoverProps) {
  const [open, setOpen] = useState(false);
  const [draftWorkspaces, setDraftWorkspaces] = useState<string[]>(appliedWorkspaces);
  const containerRef = useRef<HTMLDivElement>(null);

  // Đồng bộ draft khi mở popover
  const handleToggleOpen = useCallback(() => {
    setOpen(prev => {
      const next = !prev;
      if (next) {
        setDraftWorkspaces(appliedWorkspaces);
      }
      return next;
    });
  }, [appliedWorkspaces]);

  // Xử lý click ngoài để đóng popover
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [open]);

  const isAllSelected = draftWorkspaces.length === 0;

  function handleToggleDraft(key: string) {
    setDraftWorkspaces(prev => {
      const lowerKey = key.toLowerCase();
      const exists = prev.map(k => k.toLowerCase()).includes(lowerKey);
      if (exists) {
        return prev.filter(k => k.toLowerCase() !== lowerKey);
      } else {
        return [...prev, lowerKey];
      }
    });
  }

  function handleSelectAllDraft() {
    setDraftWorkspaces([]);
  }

  function handleApply() {
    onApply(draftWorkspaces);
    setOpen(false);
  }

  function handleReset() {
    onReset();
    setDraftWorkspaces([]);
    setOpen(false);
  }

  return (
    <div className="relative inline-block text-left" ref={containerRef}>
      {/* Nút Trigger bộ lọc */}
      <button
        type="button"
        onClick={handleToggleOpen}
        disabled={loading}
        className={`inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors shadow-xs ${
          appliedWorkspaces.length > 0
            ? 'border-[#ba244a] bg-rose-50/70 text-[#ba244a] hover:bg-rose-100/70'
            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
        }`}
        title="Lọc danh mục sản phẩm theo Workspace"
      >
        <Building2 className={`w-3.5 h-3.5 ${appliedWorkspaces.length > 0 ? 'text-[#ba244a]' : 'text-slate-500'}`} />
        <span>Workspace: <strong className="font-semibold">{triggerLabel}</strong></span>
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* Popover danh sách đa chọn */}
      {open && (
        <div className="absolute left-0 mt-1.5 w-72 rounded-xl bg-white shadow-xl border border-slate-200/80 z-50 animate-in fade-in zoom-in-95 duration-100 overflow-hidden">
          {/* Header Popover */}
          <div className="p-3 border-b border-slate-100 flex items-center justify-between bg-slate-50/60">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-slate-800">Chọn Workspace</span>
              <span className="text-[10px] text-slate-400">({workspaces.length})</span>
            </div>
            <button
              type="button"
              onClick={handleReset}
              className="text-[11px] text-slate-500 hover:text-[#ba244a] flex items-center gap-1 transition-colors"
              title="Đặt lại về hiển thị tất cả"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Đặt lại</span>
            </button>
          </div>

          {/* Body: Danh sách checkbox động */}
          <div className="p-2 max-h-60 overflow-y-auto space-y-1">
            {/* Lựa chọn 'Tất cả Workspace' */}
            <label
              className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg hover:bg-slate-50 cursor-pointer text-xs text-slate-700 transition-colors"
            >
              <input
                type="checkbox"
                checked={isAllSelected}
                onChange={handleSelectAllDraft}
                className="w-3.5 h-3.5 rounded border-slate-300 text-[#ba244a] focus:ring-[#ba244a] accent-[#ba244a]"
              />
              <span className="font-medium text-slate-800">Tất cả Workspace</span>
            </label>

            <div className="h-px bg-slate-100 my-1" />

            {/* Danh sách Workspace nạp từ DB */}
            {workspaces.map(ws => {
              const checked = draftWorkspaces.map(k => k.toLowerCase()).includes(ws.instance_key.toLowerCase());
              return (
                <label
                  key={ws.instance_key}
                  className="flex items-center justify-between px-2.5 py-1.5 rounded-lg hover:bg-slate-50 cursor-pointer text-xs text-slate-700 transition-colors"
                >
                  <div className="flex items-center gap-2.5">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => handleToggleDraft(ws.instance_key)}
                      className="w-3.5 h-3.5 rounded border-slate-300 text-[#ba244a] focus:ring-[#ba244a] accent-[#ba244a]"
                    />
                    <div className="flex flex-col">
                      <span className="font-medium text-slate-800">{ws.name}</span>
                      <span className="text-[10px] text-slate-400 uppercase tracking-wider">{ws.code || ws.instance_key}</span>
                    </div>
                  </div>
                  {ws.total_groups != null && ws.total_groups > 0 && (
                    <span className="text-[10px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-full font-mono">
                      {ws.total_groups}
                    </span>
                  )}
                </label>
              );
            })}

            {workspaces.length === 0 && !loading && (
              <div className="p-3 text-center text-xs text-slate-400">
                Không tìm thấy workspace nào
              </div>
            )}
          </div>

          {/* Footer Popover: Nút Áp dụng */}
          <div className="p-2.5 bg-slate-50/80 border-t border-slate-100 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-800 rounded-lg hover:bg-slate-100 transition-colors"
            >
              Huỷ
            </button>
            <button
              type="button"
              onClick={handleApply}
              className="px-3.5 py-1.5 text-xs font-semibold text-white bg-[#ba244a] hover:bg-[#a01c3e] rounded-lg shadow-xs transition-colors"
            >
              Áp dụng
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
