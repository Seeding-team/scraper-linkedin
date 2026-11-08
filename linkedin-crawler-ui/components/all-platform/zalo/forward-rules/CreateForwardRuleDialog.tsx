"use client";

/** Modal tạo rule — port nguyên từ RuleEditorModal (ForwardRulesDashboard.tsx,
 * zalo-forward-module), chỉ đổi màu thương hiệu. Logic/API call giữ nguyên
 * theo hợp đồng đã có của app này. */

import { useMemo, useState } from "react";
import { Check, Loader2, Search } from "lucide-react";
import { useZaloConversationOptions } from "../centralized-shared/useZaloAccountOptions";
import { createZaloForwardRule } from "@/services/zaloCrawlerService";
import { btn, btnSize, input } from "../centralized-shared/zaloUi";

interface CreateForwardRuleDialogProps {
  accountId: string;
  onClose: () => void;
  onCreated: () => void;
}

type GroupOption = { id: string; name: string };

function GroupPickerList({
  groups,
  excludeIds,
  mode,
  selectedIds,
  onSelectSingle,
  onToggleMulti,
}: {
  groups: GroupOption[];
  excludeIds: Set<string>;
  mode: "single" | "multi";
  selectedIds: Set<string>;
  onSelectSingle?: (id: string) => void;
  onToggleMulti?: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return groups.filter((g) => !excludeIds.has(g.id)).filter((g) => !q || g.name.toLowerCase().includes(q));
  }, [groups, excludeIds, search]);

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200">
      <div className="flex items-center gap-1.5 border-b border-slate-200 bg-slate-50 px-2.5 py-1.5">
        <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Tìm nhóm..."
          className="w-full bg-transparent text-xs text-slate-900 outline-none placeholder:text-slate-400"
        />
      </div>
      <div className="max-h-48 overflow-auto">
        {filtered.length === 0 ? (
          <div className="px-3 py-4 text-center text-[11px] text-slate-500">Không có nhóm phù hợp.</div>
        ) : (
          filtered.map((g) => {
            const checked = selectedIds.has(g.id);
            return (
              <label
                key={g.id}
                className="flex cursor-pointer items-center gap-2 border-b border-slate-100 px-2.5 py-1.5 text-xs last:border-b-0 hover:bg-slate-50"
              >
                <input
                  type={mode === "single" ? "radio" : "checkbox"}
                  name={mode === "single" ? "master-group" : undefined}
                  checked={checked}
                  onChange={() => (mode === "single" ? onSelectSingle?.(g.id) : onToggleMulti?.(g.id))}
                  className="accent-brand"
                />
                <span className="truncate text-slate-700">{g.name}</span>
              </label>
            );
          })
        )}
      </div>
    </div>
  );
}

export function CreateForwardRuleDialog({ accountId, onClose, onCreated }: CreateForwardRuleDialogProps) {
  const [name, setName] = useState("");
  const [masterId, setMasterId] = useState("");
  const [targetIds, setTargetIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { conversations } = useZaloConversationOptions(accountId);
  const groups: GroupOption[] = useMemo(
    () =>
      conversations
        .filter((c) => c.conversation_id) // group_id/thread_id có sẵn
        .map((c) => ({ id: c.conversation_id, name: c.conversation_name || `Nhóm ${c.conversation_id}` })),
    [conversations],
  );
  const nameOf = (id: string) => groups.find((g) => g.id === id)?.name || id;

  async function handleSave() {
    if (!masterId) {
      setError("Vui lòng chọn nhóm chính.");
      return;
    }
    if (targetIds.size === 0) {
      setError("Vui lòng chọn ít nhất 1 nhóm đích.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const targetThreadIds = Array.from(targetIds);
      const targetThreadNames: Record<string, string> = {};
      for (const id of targetThreadIds) targetThreadNames[id] = nameOf(id);
      await createZaloForwardRule({
        account_id: accountId,
        name: name.trim() || undefined,
        master_thread_id: masterId,
        master_thread_name: nameOf(masterId),
        target_thread_ids: targetThreadIds,
        target_thread_names: targetThreadNames,
      });
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi lưu luật chuyển tiếp.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[170] grid place-items-center bg-black/50 px-4">
      <button type="button" className="absolute inset-0" aria-label="Đóng" onClick={onClose} />
      <div className="relative flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl border border-slate-200 bg-white shadow-lg">
        <div className="shrink-0 px-5 pt-5 text-base font-semibold text-slate-900">Tạo luật chuyển tiếp mới</div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
          <div className="space-y-3">
            <input
              type="text"
              placeholder="Tên luật (tuỳ chọn, vd: Thông báo cửa hàng)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={input}
            />

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <div className="mb-1 text-xs font-semibold text-slate-700">
                  Nhóm chính {masterId ? <span className="font-normal text-slate-400">— {nameOf(masterId)}</span> : null}
                </div>
                <GroupPickerList
                  groups={groups}
                  excludeIds={targetIds}
                  mode="single"
                  selectedIds={new Set(masterId ? [masterId] : [])}
                  onSelectSingle={(id) => setMasterId(id)}
                />
              </div>

              <div>
                <div className="mb-1 text-xs font-semibold text-slate-700">Nhóm đích ({targetIds.size} đã chọn)</div>
                <GroupPickerList
                  groups={groups}
                  excludeIds={new Set(masterId ? [masterId] : [])}
                  mode="multi"
                  selectedIds={targetIds}
                  onToggleMulti={(id) =>
                    setTargetIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(id)) next.delete(id);
                      else next.add(id);
                      return next;
                    })
                  }
                />
              </div>
            </div>

            {error ? <p className="text-sm text-red-600">{error}</p> : null}
          </div>
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <button type="button" onClick={onClose} className={`${btn.outline} ${btnSize.sm}`}>
            Hủy
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || !masterId || targetIds.size === 0}
            className={`${btn.primary} ${btnSize.sm}`}
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Lưu
          </button>
        </div>
      </div>
    </div>
  );
}
