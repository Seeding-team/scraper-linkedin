"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MaterialIcon } from "@/components/ui";
import { useZaloConversationOptions } from "../centralized-shared/useZaloAccountOptions";
import { ZaloGroupPickerList } from "../centralized-shared/ZaloGroupPickerList";
import { createZaloForwardRule } from "@/services/zaloCrawlerService";

interface CreateForwardRuleDialogProps {
  accountId: string;
  onCreated: () => void;
}

export function CreateForwardRuleDialog({ accountId, onCreated }: CreateForwardRuleDialogProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [masterIds, setMasterIds] = useState<string[]>([]);
  const [targetIds, setTargetIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { conversations, loading } = useZaloConversationOptions(open ? accountId : "");
  const master = conversations.find((c) => c.conversation_id === masterIds[0]);

  async function handleSubmit() {
    if (!masterIds[0] || targetIds.length === 0) {
      setError("Cần chọn 1 nhóm chính và ít nhất 1 nhóm đích.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const targetNames: Record<string, string> = {};
      for (const id of targetIds) {
        const c = conversations.find((x) => x.conversation_id === id);
        if (c) targetNames[id] = c.conversation_name;
      }
      await createZaloForwardRule({
        account_id: accountId,
        name: name.trim() || undefined,
        master_thread_id: masterIds[0],
        master_thread_name: master?.conversation_name,
        target_thread_ids: targetIds,
        target_thread_names: targetNames,
      });
      setOpen(false);
      setName("");
      setMasterIds([]);
      setTargetIds([]);
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tạo được rule");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <MaterialIcon name="add" className="text-base" />
          Tạo rule mới
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Tạo rule chuyển tiếp tin nhắn</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div>
            <Label htmlFor="rule-name">Tên rule (tuỳ chọn)</Label>
            <Input id="rule-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="VD: Nhóm sale -> nhóm tổng" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="mb-2 block">Nhóm chính (nguồn)</Label>
              <ZaloGroupPickerList
                conversations={conversations}
                loading={loading}
                mode="single"
                selectedIds={masterIds}
                onChange={setMasterIds}
              />
            </div>
            <div>
              <Label className="mb-2 block">Nhóm đích (có thể chọn nhiều)</Label>
              <ZaloGroupPickerList
                conversations={conversations}
                loading={loading}
                mode="multi"
                selectedIds={targetIds}
                onChange={setTargetIds}
                excludeId={masterIds[0]}
              />
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Huỷ
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={submitting}>
            {submitting ? "Đang tạo..." : "Tạo rule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
