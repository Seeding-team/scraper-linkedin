"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ZaloConversationSummary } from "@/types/zalo-api";
import { cn } from "@/lib/utils";

interface ZaloGroupPickerListProps {
  conversations: ZaloConversationSummary[];
  loading?: boolean;
  mode: "single" | "multi";
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  /** Loại trừ 1 conversation_id khỏi danh sách chọn (vd: nhóm chính không được chọn làm đích). */
  excludeId?: string | null;
}

export function ZaloGroupPickerList({
  conversations,
  loading,
  mode,
  selectedIds,
  onChange,
  excludeId,
}: ZaloGroupPickerListProps) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const groupsOnly = conversations.filter((c) => c.conversation_id !== excludeId);
    if (!query.trim()) return groupsOnly;
    const q = query.trim().toLowerCase();
    return groupsOnly.filter((c) => c.conversation_name?.toLowerCase().includes(q));
  }, [conversations, query, excludeId]);

  function toggle(id: string) {
    if (mode === "single") {
      onChange([id]);
      return;
    }
    onChange(selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]);
  }

  return (
    <div className="flex flex-col gap-2">
      <Input
        placeholder="Tìm nhóm theo tên..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="h-8"
      />
      <ScrollArea className="h-64 rounded-md border border-border">
        {loading ? (
          <div className="p-4 text-center text-sm text-muted-foreground">Đang tải danh sách hội thoại...</div>
        ) : filtered.length === 0 ? (
          <div className="p-4 text-center text-sm text-muted-foreground">Không có hội thoại phù hợp.</div>
        ) : (
          <div className="flex flex-col">
            {filtered.map((c) => {
              const checked = selectedIds.includes(c.conversation_id);
              return (
                <button
                  key={c.conversation_id}
                  type="button"
                  onClick={() => toggle(c.conversation_id)}
                  className={cn(
                    "flex items-center gap-2 border-b border-border/60 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-accent",
                    checked && "bg-accent/60",
                  )}
                >
                  {mode === "multi" ? (
                    <Checkbox checked={checked} className="pointer-events-none" />
                  ) : (
                    <span
                      className={cn(
                        "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                        checked ? "border-primary" : "border-muted-foreground/50",
                      )}
                    >
                      {checked && <span className="h-2 w-2 rounded-full bg-primary" />}
                    </span>
                  )}
                  <span className="truncate">{c.conversation_name || c.conversation_id}</span>
                </button>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
