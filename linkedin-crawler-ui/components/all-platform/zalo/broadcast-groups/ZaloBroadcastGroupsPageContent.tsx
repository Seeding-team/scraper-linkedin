"use client";

/**
 * Trang "Đăng nhiều nhóm" — port giao diện từ zalo-account-module/app/(dashboard)/
 * broadcast-groups/page.tsx, chỉ đổi token màu brand (xem lib/zaloUi.ts). Logic/
 * data-fetching giữ nguyên — vẫn dùng previewZaloBroadcast/createZaloBroadcast/
 * getZaloBroadcast theo đúng hợp đồng backend 1-account hiện có (khác bản gốc
 * multi-account vì backend app này chưa hỗ trợ multi-account/broadcast).
 */

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Send, Users, X } from "lucide-react";
import { useZaloAccountOptions, useZaloConversationOptions } from "../centralized-shared/useZaloAccountOptions";
import { ZaloAccountPicker } from "../centralized-shared/ZaloAccountPicker";
import { ZaloGroupPickerList } from "../centralized-shared/ZaloGroupPickerList";
import { createZaloBroadcast, getZaloBroadcast, previewZaloBroadcast } from "@/services/zaloCrawlerService";
import type { ZaloBroadcastPreviewResponse } from "@/types/zalo-api";
import { alert, btn, btnSize, broadcastGridWide, card, infoBox, pill, textarea } from "@/lib/zaloUi";

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
      setStatus(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không gửi được broadcast");
    } finally {
      setSending(false);
    }
  }

  const statusStr = String((status as { status?: string } | null)?.status || "");
  const statusPillCls = statusStr === "completed" ? pill.success : statusStr === "failed" ? pill.danger : pill.info;
  const statusLabel = statusStr === "completed" ? "Hoàn tất" : statusStr === "failed" ? "Lỗi" : statusStr === "running" ? "Đang gửi..." : statusStr || "Đang khởi tạo...";

  return (
    <div className="flex-1 overflow-y-auto bg-[#f8f9fa] p-4 sm:p-6">
      <div className="mx-auto flex max-w-5xl flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-800">Đăng nhiều nhóm</h1>
            <p className="text-sm text-muted-foreground">Soạn 1 tin, chọn nhiều nhóm của tài khoản này, gửi đồng loạt có giãn cách.</p>
          </div>
          <ZaloAccountPicker accounts={accounts} value={selectedAccountId} onChange={setSelectedAccountId} loading={loadingAccounts} />
        </div>

        <div className={infoBox}>
          <Send className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
          <span>
            <strong>Đăng nhiều nhóm</strong> — Gửi 1 tin cho nhiều nhóm của tài khoản Zalo đã chọn, giãn cách an toàn giữa mỗi nhóm.
          </span>
        </div>

        {error ? (
          <div className={`${alert.error} justify-between`}>
            <span className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </span>
            <button type="button" onClick={() => setError(null)} className="text-red-400 hover:text-red-600">
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : null}

        <div className={broadcastGridWide}>
          <section className={`${card} bg-[#f8fafc] p-5`}>
            <div className="flex items-center gap-2 text-[14px] font-semibold text-[#0a1a2b]">
              <Users className="h-4 w-4" /> Chọn nhóm đích ({targetIds.length})
            </div>
            <div className="mt-3">
              <ZaloGroupPickerList
                conversations={conversations}
                loading={loadingConversations}
                mode="multi"
                selectedIds={targetIds}
                onChange={setTargetIds}
                groupsOnly
              />
            </div>
          </section>

          <section className={`${card} bg-[#f8fafc] p-5`}>
            <label className="flex items-center gap-2 text-[14px] font-semibold text-[#0a1a2b]">
              <Send className="h-4 w-4" /> Nội dung tin nhắn
            </label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={8}
              placeholder="Nhập nội dung sẽ đăng lên tất cả nhóm đã chọn..."
              className={`${textarea} mt-2 min-h-[180px]`}
            />
          </section>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => void handlePreview()} disabled={loadingPreview || !selectedAccountId} className={`${btn.outline} ${btnSize.md}`}>
            {loadingPreview ? "Đang xem trước..." : "Xem trước"}
          </button>
          <button type="button" onClick={() => void handleSend()} disabled={sending || !preview} className={`${btn.primary} ${btnSize.lg}`}>
            <Send className="h-4 w-4" />
            {sending ? "Đang gửi..." : `Đăng ngay tới ${targetIds.length} nhóm`}
          </button>
        </div>

        {preview ? (
          <div className={alert.info}>
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p>
                {preview.target_count} nhóm sẽ nhận · {preview.message_count} tin nhắn
              </p>
              {preview.warnings.length > 0 ? (
                <ul className="mt-1 list-disc pl-4 text-amber-700">
                  {preview.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
        ) : null}

        {status ? (
          <section className={card}>
            <div className="border-b border-[#eef1f5] px-5 py-3.5">
              <h2 className="text-[15px] font-semibold text-[#0a1a2b]">Tiến độ gửi</h2>
            </div>
            <div className="flex items-center gap-2 px-5 py-3.5">
              <span className={statusPillCls}>{statusLabel}</span>
              <span className="text-sm text-muted-foreground">Đang gửi tới các nhóm đã chọn...</span>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
