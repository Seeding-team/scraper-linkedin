"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ZaloLibraryMessage, ZaloConversationSummary } from "@/types/zalo-api";
import { MaterialIcon } from "@/components/ui";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  messages: ZaloLibraryMessage[];
  loadingMessages: boolean;
  selectedConvId: string;
  selectedConv: ZaloConversationSummary | null;
  selectedAccountId: string;
  ownerName: string;
  accountLabel: string;
  sendMessage: (text: string, files?: File[]) => Promise<void>;
  isSending: boolean;
  sendError: string | null;
  kpiCount: number;
  onBack?: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(value: string | null | undefined): string {
  if (!value) return "";
  const trimmed = String(value).trim();
  const num = Number(trimmed);
  const ms = !Number.isNaN(num) && /^\d+$/.test(trimmed)
    ? (num < 1e11 ? num * 1000 : num)
    : Date.parse(trimmed);

  if (!ms || Number.isNaN(ms)) return trimmed;
  return new Date(ms).toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Ho_Chi_Minh",
  });
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "";
  const trimmed = String(value).trim();
  const num = Number(trimmed);
  const ms = !Number.isNaN(num) && /^\d+$/.test(trimmed)
    ? (num < 1e11 ? num * 1000 : num)
    : Date.parse(trimmed);

  if (!ms || Number.isNaN(ms)) return "";
  return new Date(ms).toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Asia/Ho_Chi_Minh",
  });
}

// ─── KPI Drawer ───────────────────────────────────────────────────────────────

function KpiDrawer({
  ownerName,
  accountLabel,
  kpiCount,
  messages,
}: {
  ownerName: string;
  accountLabel: string;
  kpiCount: number;
  messages: ZaloLibraryMessage[];
}) {
  const sentCount = messages.filter((m) => m.is_sent).length;
  const receivedCount = messages.filter((m) => !m.is_sent).length;
  const replyRate = receivedCount > 0
    ? Math.round((sentCount / receivedCount) * 100)
    : 0;

  return (
    <div className="w-64 border-l border-slate-200 bg-slate-50 flex flex-col overflow-y-auto">
      <div className="px-4 py-3 border-b border-slate-200 bg-white">
        <h3 className="text-[13px] font-bold text-slate-800">KPI Tháng này</h3>
        <p className="text-[11px] text-slate-500 truncate">{ownerName} · {accountLabel}</p>
      </div>

      <div className="p-4 space-y-3">
        {/* Inbox KPI */}
        <div className="bg-white rounded-xl border border-slate-200 p-3">
          <div className="flex items-center gap-2 mb-2">
            <div className="h-7 w-7 rounded-lg bg-green-50 flex items-center justify-center">
              <MaterialIcon name="inbox" className="text-green-600 text-[16px]" />
            </div>
            <span className="text-[12px] font-semibold text-slate-700">Inbox KPI</span>
          </div>
          <div className="text-[24px] font-extrabold text-green-600 leading-tight">{kpiCount}</div>
          <div className="text-[10px] text-slate-400 mt-0.5">hội thoại đã verify</div>
        </div>

        {/* Messages stats */}
        <div className="bg-white rounded-xl border border-slate-200 p-3">
          <div className="text-[11px] font-semibold text-slate-600 mb-2">Phiên chat này</div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-slate-500">Đã gửi</span>
              <span className="text-[13px] font-bold text-blue-600">{sentCount}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-slate-500">Nhận được</span>
              <span className="text-[13px] font-bold text-slate-600">{receivedCount}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-slate-500">Tỉ lệ phản hồi</span>
              <span className={cn(
                "text-[13px] font-bold",
                replyRate >= 80 ? "text-green-600" : replyRate >= 50 ? "text-amber-600" : "text-red-600"
              )}>
                {replyRate}%
              </span>
            </div>
          </div>
        </div>

        {/* Tips */}
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-3">
          <div className="flex items-start gap-2">
            <MaterialIcon name="auto_awesome" className="text-blue-500 text-[14px] mt-0.5" />
            <p className="text-[11px] text-blue-700 leading-relaxed">
              Hội thoại được tính KPI khi leader xác minh qua mục <strong>Chia sẻ inbox</strong>.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Chat Panel ──────────────────────────────────────────────────────────

export function ZaloAdminChatPanel({
  messages,
  loadingMessages,
  selectedConvId,
  selectedConv,
  selectedAccountId,
  ownerName,
  accountLabel,
  sendMessage,
  isSending,
  sendError,
  kpiCount,
  onBack,
}: Props) {
  const [inputText, setInputText] = useState("");
  const [showKpi, setShowKpi] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastConvRef = useRef<string>("");

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const isNew = lastConvRef.current !== selectedConvId;
    if (isNew || (el.scrollHeight - el.scrollTop - el.clientHeight < 200)) {
      el.scrollTop = el.scrollHeight;
    }
    lastConvRef.current = selectedConvId;
  }, [messages, selectedConvId]);

  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if (!text && selectedFiles.length === 0) return;
    setInputText("");
    setSelectedFiles([]);
    await sendMessage(text, selectedFiles.length > 0 ? selectedFiles : undefined);
  }, [inputText, selectedFiles, sendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend]
  );

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    setSelectedFiles((prev) => [...prev, ...files]);
    e.target.value = "";
  }, []);

  const convTitle =
    selectedConv?.conversation_name && selectedConv.conversation_name !== selectedConv.conversation_id
      ? selectedConv.conversation_name
      : "Hội thoại";

  // Group messages by date for display
  const groupedMessages = (() => {
    const groups: { date: string; msgs: ZaloLibraryMessage[] }[] = [];
    for (const msg of messages) {
      const date = formatDate(msg.timestamp_text ?? msg.time_text);
      const last = groups[groups.length - 1];
      if (!last || last.date !== date) {
        groups.push({ date, msgs: [msg] });
      } else {
        last.msgs.push(msg);
      }
    }
    return groups;
  })();

  if (!selectedConvId) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-slate-50 gap-3">
        <div className="h-16 w-16 rounded-full bg-red-50 flex items-center justify-center">
          <MaterialIcon name="chat" className="text-red-300 text-[36px]" />
        </div>
        <p className="text-[14px] text-slate-400 font-medium">Chọn hội thoại để bắt đầu chat</p>
        <p className="text-[12px] text-slate-300">Bạn đang xem inbox của: <strong>{ownerName}</strong></p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 h-full overflow-hidden">
      {/* ── Chat Area ── */}
      <div className="flex flex-col flex-1 overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-slate-200 bg-white flex-shrink-0">
          {onBack && (
            <button
              onClick={onBack}
              className="h-8 w-8 rounded-lg flex items-center justify-center hover:bg-slate-100 transition"
            >
              <MaterialIcon name="arrow_back" className="text-slate-500 text-[18px]" />
            </button>
          )}
          <div className="h-9 w-9 rounded-full bg-gradient-to-br from-red-400 to-red-600 flex items-center justify-center text-[13px] font-bold text-white flex-shrink-0">
            {(convTitle[0] ?? "Z").toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-bold text-slate-800 truncate">{convTitle}</div>
            <div className="text-[11px] text-slate-500 truncate">
              {ownerName} · {accountLabel}
            </div>
          </div>

          {/* KPI toggle */}
          <button
            onClick={() => setShowKpi((v) => !v)}
            className={cn(
              "h-8 w-8 rounded-lg flex items-center justify-center transition",
              showKpi ? "bg-green-50 text-green-600" : "hover:bg-slate-100 text-slate-500"
            )}
            title="Xem KPI"
          >
            <MaterialIcon name="analytics" className="text-[18px]" />
          </button>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-1 bg-slate-50">
          {loadingMessages && messages.length === 0 ? (
            <div className="space-y-3">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className={cn("flex gap-2 animate-pulse", i % 2 === 0 ? "justify-end" : "")}>
                  {i % 2 !== 0 && <div className="h-7 w-7 bg-slate-200 rounded-full flex-shrink-0" />}
                  <div className={cn(
                    "rounded-2xl px-3 py-2",
                    i % 2 === 0 ? "bg-red-100 w-32 h-8" : "bg-white w-48 h-8"
                  )} />
                </div>
              ))}
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-center px-4">
              <MaterialIcon name="chat" className="text-slate-200 text-[40px]" />
              <p className="text-[13px] text-slate-400">Chưa có tin nhắn</p>
            </div>
          ) : (
            <>
              {groupedMessages.map((group, gi) => (
                <div key={gi}>
                  {group.date && (
                    <div className="flex items-center gap-2 my-3">
                      <div className="flex-1 h-px bg-slate-200" />
                      <span className="text-[10px] text-slate-400 px-2 font-medium">{group.date}</span>
                      <div className="flex-1 h-px bg-slate-200" />
                    </div>
                  )}
                  {group.msgs.map((msg, mi) => {
                    const isSent = msg.is_sent;
                    const time = formatTime(msg.timestamp_text ?? msg.time_text);
                    const content = msg.content ?? "";
                    const assets = (msg.assets ?? []).filter((a) => a.storage_url);

                    return (
                      <div
                        key={msg.id ?? mi}
                        className={cn("flex gap-2 mb-0.5", isSent ? "justify-end" : "justify-start")}
                      >
                        {!isSent && (
                          <div className="h-7 w-7 rounded-full bg-gradient-to-br from-slate-400 to-slate-600 flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0 mt-0.5">
                            {(msg.sender_name?.[0] ?? "Z").toUpperCase()}
                          </div>
                        )}
                        <div className={cn("max-w-[70%]", isSent ? "items-end" : "items-start", "flex flex-col gap-0.5")}>
                          {!isSent && msg.sender_name && (
                            <span className="text-[10px] text-slate-400 px-1">{msg.sender_name}</span>
                          )}
                          {content && (
                            <div
                              className={cn(
                                "px-3 py-2 rounded-2xl text-[13px] leading-relaxed whitespace-pre-wrap break-words",
                                isSent
                                  ? "bg-red-500 text-white rounded-br-sm"
                                  : "bg-white text-slate-800 border border-slate-200 rounded-bl-sm shadow-sm"
                              )}
                            >
                              {content}
                            </div>
                          )}
                          {assets.map((asset, ai) => (
                            <div key={ai} className="rounded-xl overflow-hidden border border-slate-200 max-w-[200px]">
                              {asset.storage_url?.match(/\.(jpg|jpeg|png|gif|webp)/i) ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={asset.storage_url!}
                                  alt="media"
                                  className="w-full h-auto"
                                  loading="lazy"
                                />
                              ) : (
                                <a
                                  href={asset.storage_url!}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center gap-1.5 p-2 text-[11px] text-blue-600 hover:underline"
                                >
                                  <MaterialIcon name="attach_file" className="text-[14px]" />
                                  File đính kèm
                                </a>
                              )}
                            </div>
                          ))}
                          <span className="text-[9px] text-slate-400 px-1">{time}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </>
          )}
        </div>

        {/* Send error */}
        {sendError && (
          <div className="px-4 py-1.5 bg-red-50 border-t border-red-100">
            <p className="text-[11px] text-red-600">{sendError}</p>
          </div>
        )}

        {/* Selected files preview */}
        {selectedFiles.length > 0 && (
          <div className="px-4 py-2 border-t border-slate-100 bg-white flex gap-2 flex-wrap">
            {selectedFiles.map((f, i) => (
              <div key={i} className="flex items-center gap-1 bg-slate-100 rounded-lg px-2 py-1 text-[11px]">
                <MaterialIcon name="attach_file" className="text-[12px] text-slate-500" />
                <span className="text-slate-700 max-w-[100px] truncate">{f.name}</span>
                <button
                  onClick={() => setSelectedFiles((prev) => prev.filter((_, j) => j !== i))}
                  className="text-slate-400 hover:text-red-500 transition"
                >
                  <MaterialIcon name="close" className="text-[12px]" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Input box */}
        <div className="flex items-end gap-2 px-3 py-2.5 border-t border-slate-200 bg-white flex-shrink-0">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="h-8 w-8 rounded-lg flex items-center justify-center hover:bg-slate-100 transition flex-shrink-0"
            title="Đính kèm file"
          >
            <MaterialIcon name="attach_file" className="text-slate-500 text-[18px]" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFileChange}
          />

          <textarea
            className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-[13px] text-slate-800 resize-none focus:border-red-400 focus:ring-1 focus:ring-red-200 outline-none transition placeholder:text-slate-400 min-h-[38px] max-h-[120px]"
            placeholder="Nhập tin nhắn... (Enter để gửi)"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
          />

          <button
            onClick={() => void handleSend()}
            disabled={isSending || (!inputText.trim() && selectedFiles.length === 0)}
            className={cn(
              "h-9 w-9 rounded-xl flex items-center justify-center transition flex-shrink-0",
              isSending || (!inputText.trim() && selectedFiles.length === 0)
                ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                : "bg-red-500 text-white hover:bg-red-600 shadow-sm"
            )}
          >
            {isSending ? (
              <MaterialIcon name="pending" className="text-[18px] animate-spin" />
            ) : (
              <MaterialIcon name="send" className="text-[18px]" />
            )}
          </button>
        </div>
      </div>

      {/* ── KPI Drawer ── */}
      {showKpi && (
        <KpiDrawer
          ownerName={ownerName}
          accountLabel={accountLabel}
          kpiCount={kpiCount}
          messages={messages}
        />
      )}
    </div>
  );
}
