'use client';

import { useMemo, useState } from 'react';
import { Building2, TriangleAlert, X } from 'lucide-react';
import type { WorkspaceMeta } from './types';

interface WorkspaceAssignDialogProps {
  workspaces: WorkspaceMeta[];
  selectedCount: number;
  /** Ban ghi union hien tai cua cac nhom da chon —setState khoi draft LUC MOUNT
   * (component chi duoc mount khi dialog mo o parent). */
  currentWorkspaces: string[];
  submitting: boolean;
  /** Loi tu backend (thuc su) — dialog GIU MO de sua/retry; khong dong. */
  error: string | null;
  onConfirm: (instances: string[]) => Promise<void> | void;
  onClose: () => void;
}

/**
 * Dialog "Chỉnh sửa hàng hóa theo Workspace" (bulk replace-all, migration 190):
 * - "Tất cả Workspace" là master checkbox: checked <=> tat ca option con dang
 *   check; thao (indeterminate) khi mot phan; bam chon/bo chon ca bo.
 * - Confirm disabled khi draft rong (KHONG cho phep gan set rong), Confirm
 *   goi API thay toan bo assignment cua cac nhom da chon (kèm product bên trong).
 * - Loi: giu dialog MO hien error that (message API/DB) de retry; khong bao
 *   success khi loi. Dialog chi duoc mount khi MO (parent) → draft state
 *   khoi dung (theo currentWorkspaces) moi mỗi lần mở, không cần effect.
 */
export function WorkspaceAssignDialog({
  workspaces,
  selectedCount,
  currentWorkspaces,
  submitting,
  error,
  onConfirm,
  onClose,
}: WorkspaceAssignDialogProps) {
  const keys = useMemo(
    () => workspaces.map(w => w.instance_key.toLowerCase()).filter(Boolean),
    [workspaces],
  );

  const [draft, setDraft] = useState<string[]>(() => {
    // seed = union cua assignment hien tai cua cac nhom da chon (chi nhung key
    // thuoc danh sach workspace dong); group chua co assignment → draft trong.
    const current = new Set(currentWorkspaces.map(w => (w || '').toLowerCase()).filter(Boolean));
    return keys.filter(k => current.has(k));
  });

  const allChecked = keys.length > 0 && draft.length === keys.length;
  const partialChecked = draft.length > 0 && draft.length < keys.length;

  function toggle(key: string) {
    const k = key.toLowerCase();
    setDraft(prev => (prev.includes(k) ? prev.filter(x => x !== k) : [...prev, k]));
  }

  function toggleAll() {
    setDraft(allChecked ? [] : [...keys]);
  }

  async function handleConfirm() {
    if (draft.length === 0 || submitting) return;
    await onConfirm(draft);
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/50 backdrop-blur-[2px]"
      onMouseDown={e => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Chỉnh sửa hàng hóa theo Workspace"
    >
      <div className="w-[26rem] max-w-[92vw] rounded-xl bg-white shadow-2xl border border-slate-200 overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between px-4 py-3 border-b border-slate-100 bg-slate-50/70">
          <div className="flex items-start gap-2">
            <span className="mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-lg bg-[#ba244a]/10 text-[#ba244a]">
              <Building2 className="w-4 h-4" />
            </span>
            <div>
              <div className="text-sm font-semibold text-slate-900">Chỉnh sửa hàng hóa theo Workspace</div>
              <div className="text-[11px] text-slate-500">
                Đã chọn <strong>{selectedCount}</strong> nhóm sản phẩm
              </div>
            </div>
          </div>
          <button
            type="button"
            className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100"
            onClick={onClose}
            disabled={submitting}
            aria-label="Đóng"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Warning: replace-all */}
        <div className="mx-4 mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            <strong>Thay thế toàn bộ</strong> Workspace hiện tại của các nhóm đã chọn và các sản phẩm bên
            trong nhóm. Xác nhận = gán đúng bộ được chọn, bỏ tất cả Workspace khác.
          </span>
        </div>

        {/* Danh sach workspace (dong tu API GET /workspaces) */}
        <div className="px-2 py-2 max-h-64 overflow-y-auto">
          <label className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-slate-50 cursor-pointer text-xs text-slate-700">
            <input
              type="checkbox"
              ref={el => {
                if (el) el.indeterminate = partialChecked;
              }}
              checked={allChecked}
              onChange={toggleAll}
              className="w-3.5 h-3.5 rounded border-slate-300 text-[#ba244a] focus:ring-[#ba244a] accent-[#ba244a]"
            />
            <span className="font-medium text-slate-800">Tất cả Workspace</span>
          </label>
          <div className="h-px bg-slate-100 my-1 mx-2" />
          {workspaces.map(ws => {
            const key = ws.instance_key.toLowerCase();
            const checked = draft.includes(key);
            return (
              <label
                key={ws.instance_key}
                className="flex items-center justify-between px-2.5 py-1.5 rounded-lg hover:bg-slate-50 cursor-pointer text-xs text-slate-700"
              >
                <div className="flex items-center gap-2.5">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(ws.instance_key)}
                    className="w-3.5 h-3.5 rounded border-slate-300 text-[#ba244a] focus:ring-[#ba244a] accent-[#ba244a]"
                  />
                  <div className="flex flex-col">
                    <span className="font-medium text-slate-800">{ws.name}</span>
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider">
                      {ws.code || ws.instance_key}
                    </span>
                  </div>
                </div>
              </label>
            );
          })}
          {workspaces.length === 0 && (
            <div className="px-3 py-6 text-center text-xs text-slate-400">
              Không tải được danh sách Workspace. Vui lòng thử lại sau.
            </div>
          )}
        </div>

        {/* Error: dialog giu MO, hien loi that tu API/DB */}
        {error ? (
          <div className="mx-4 mb-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] leading-relaxed text-rose-700">
            {error}
          </div>
        ) : null}

        {/* Footer */}
        <div className="px-4 py-3 bg-slate-50/80 border-t border-slate-100 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-3.5 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition-colors"
          >
            Huỷ
          </button>
          <button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={submitting || draft.length === 0 || workspaces.length === 0}
            className="px-4 py-1.5 text-xs font-semibold text-white bg-[#ba244a] hover:bg-[#a01c3e] rounded-lg shadow-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title={draft.length === 0 ? 'Cần chọn ít nhất 1 Workspace' : undefined}
          >
            {submitting ? 'Đang cập nhật...' : 'Xác nhận'}
          </button>
        </div>
      </div>
    </div>
  );
}
