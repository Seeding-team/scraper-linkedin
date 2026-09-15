"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { MaterialIcon } from "@/components/ui";
import { useZaloAccountOptions, useZaloConversationOptions } from "../centralized-shared/useZaloAccountOptions";
import { ZaloAccountPicker } from "../centralized-shared/ZaloAccountPicker";
import { ZaloGroupPickerList } from "../centralized-shared/ZaloGroupPickerList";
import {
  createZaloBroadcast,
  getZaloBroadcast,
  previewZaloBroadcast,
} from "@/services/zaloCrawlerService";
import type { ZaloBroadcastPreviewResponse } from "@/types/zalo-api";

export function ZaloBroadcastGroupsPageContent() {
  const { accounts, selectedAccountId, setSelectedAccountId, loading: loadingAccounts } = useZaloAccountOptions();
  const { conversations, loading: loadingConversations } = useZaloConversationOptions(selectedAccountId);
  const [text, setText] = useState("");
  const [targetIds, setTargetIds] = useState<string[]>([]);
  const [preview, setPreview] = useState<ZaloBroadcastPreviewResponse | null>(null);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [status, setStatus] = useState<Record<string, unknown> | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!campaignId) return;
    const interval = setInterval(async () => {
      try {
        const res = await getZaloBroadcast(campaignId);
        setStatus(res.campaign);
      } catch {
        /* poll lỗi tạm thời, bỏ qua */
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [campaignId]);

  async function handlePreview() {
    if (!text.trim() || targetIds.length === 0) {
      setError("Nhập nội dung tin và chọn ít nhất 1 nhóm đích.");
      return;
    }
    setLoadingPreview(true);
    setError(null);
    try {
      const trimmed = text.trim();
      const targets = targetIds.map((id) => {
        const c = conversations.find((x) => x.conversation_id === id);
        return { group_id: id, group_name: c?.conversation_name || id };
      });
      const res = await previewZaloBroadcast(selectedAccountId, {
        user_id: selectedAccountId,
        text: trimmed,
        targets,
        content_mode: "text",
      });
      setPreview(res);
      setPreviewText(trimmed);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không xem trước được");
    } finally {
      setLoadingPreview(false);
    }
  }

  async function handleSend() {
    if (!previewText) {
      setError("Hãy bấm 'Xem trước' trước khi gửi.");
      return;
    }
    setSending(true);
    setError(null);
    try {
      const targets = targetIds.map((id) => {
        const c = conversations.find((x) => x.conversation_id === id);
        return { group_id: id, group_name: c?.conversation_name || id };
      });
      const res = await createZaloBroadcast(selectedAccountId, {
        user_id: selectedAccountId,
        text: previewText,
        targets,
        content_mode: "text",
      });
      setCampaignId(res.campaign_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không gửi được broadcast");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex-1 overflow-y-auto bg-[#f8f9fa] p-6">
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-800">Gửi tin tới nhiều nhóm</h1>
            <p className="text-sm text-muted-foreground">Soạn 1 tin, chọn nhiều nhóm của tài khoản này, gửi đồng loạt có giãn cách.</p>
          </div>
          <ZaloAccountPicker accounts={accounts} value={selectedAccountId} onChange={setSelectedAccountId} loading={loadingAccounts} />
        </div>

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}</div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Nội dung tin nhắn</CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder="Nhập nội dung cần gửi..." />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Chọn nhóm đích ({targetIds.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <ZaloGroupPickerList
                conversations={conversations}
                loading={loadingConversations}
                mode="multi"
                selectedIds={targetIds}
                onChange={setTargetIds}
              />
            </CardContent>
          </Card>
        </div>

        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={() => void handlePreview()} disabled={loadingPreview || !selectedAccountId}>
            <MaterialIcon name="visibility" className="text-base" />
            {loadingPreview ? "Đang xem trước..." : "Xem trước"}
          </Button>
          <Button onClick={() => void handleSend()} disabled={sending || !preview}>
            <MaterialIcon name="send" className="text-base" />
            {sending ? "Đang gửi..." : `Gửi tới ${targetIds.length} nhóm`}
          </Button>
        </div>

        {preview && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Xem trước</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              <p>{preview.target_count} nhóm sẽ nhận · {preview.message_count} tin nhắn</p>
              {preview.warnings.length > 0 && (
                <ul className="list-disc pl-5 text-amber-600">
                  {preview.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}

        {status && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Tiến độ gửi</CardTitle>
            </CardHeader>
            <CardContent className="flex items-center gap-2 text-sm">
              <Badge variant="outline">{String((status as { status?: string }).status || "đang xử lý")}</Badge>
              <span className="text-muted-foreground">Đang gửi tới các nhóm đã chọn...</span>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
