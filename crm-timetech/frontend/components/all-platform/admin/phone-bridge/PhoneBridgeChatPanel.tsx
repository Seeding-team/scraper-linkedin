"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, MessageSquare, RefreshCw, Search, Send } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { phoneBridgeService } from "@/services/phone-bridge.service";
import type {
  PhoneBridgeActionResponse,
  PhoneBridgeConversation,
  PhoneBridgeMessage,
  PhoneBridgePlatform,
} from "@/types/phone-bridge";

interface PhoneBridgeChatPanelProps {
  serial: string;
  platform: PhoneBridgePlatform;
}

function conversationId(conversation: PhoneBridgeConversation): string {
  return (
    conversation.id ??
    conversation.conversationId ??
    conversation.conversation_id ??
    conversation.threadId ??
    conversation.thread_id ??
    conversation.conversationKey ??
    ""
  );
}

function conversationName(conversation: PhoneBridgeConversation): string {
  return (
    conversationTitle(conversation) ||
    conversationId(conversation) ||
    "Cuộc trò chuyện"
  );
}

function conversationTitle(conversation: PhoneBridgeConversation): string {
  return (
    conversation.title ??
    conversation.name ??
    conversation.participant ??
    ""
  );
}

function messageText(message: PhoneBridgeMessage): string {
  return message.text ?? message.message ?? "Tin nhắn không có nội dung";
}

function resultSummary(result: PhoneBridgeActionResponse): string {
  if (typeof result.preview === "string") return result.preview;
  if (result.preview) return JSON.stringify(result.preview);
  return result.message ?? "Dry-run hợp lệ. Kiểm tra rồi xác nhận để gửi thật.";
}

function messagesFromAction(result: PhoneBridgeActionResponse): PhoneBridgeMessage[] | null {
  if (Array.isArray(result.messages)) return result.messages;
  if (result.snapshot && Array.isArray(result.snapshot.messages)) {
    return result.snapshot.messages;
  }
  return null;
}

function conversationsFromScan(result: PhoneBridgeActionResponse): PhoneBridgeConversation[] {
  if (!Array.isArray(result.results)) return [];
  return result.results
    .filter((conversation) => Boolean(conversationTitle(conversation)))
    .map((conversation) => {
      const lastMessage = conversation.messages?.at(-1);
      return {
        ...conversation,
        snippet:
          conversation.snippet ??
          conversation.preview ??
          (lastMessage ? messageText(lastMessage) : undefined),
      };
    });
}

export function PhoneBridgeChatPanel({
  serial,
  platform,
}: PhoneBridgeChatPanelProps) {
  const [conversations, setConversations] = useState<
    PhoneBridgeConversation[]
  >([]);
  const [selectedId, setSelectedId] = useState("");
  const [messages, setMessages] = useState<PhoneBridgeMessage[]>([]);
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<PhoneBridgeActionResponse | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<"scan" | "open" | "preview" | "send" | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadConversations = useCallback(async () => {
    if (!serial) return;
    setLoading(true);
    setError(null);
    try {
      const response = await phoneBridgeService.getConversations(
        serial,
        platform,
      );
      const next = response.conversations ?? [];
      setConversations((current) =>
        response.isChatListScreen === false &&
        next.length === 0 &&
        current.length > 0
          ? current
          : next,
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Không thể tải cuộc trò chuyện.",
      );
    } finally {
      setLoading(false);
    }
  }, [platform, serial]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadConversations(), 0);
    return () => window.clearTimeout(timer);
  }, [loadConversations]);

  const scanAll = async () => {
    setBusy("scan");
    setError(null);
    setNotice(null);
    try {
      const result = await phoneBridgeService.scanAll(serial, platform);
      const scanned = conversationsFromScan(result);
      setConversations(scanned);
      setSelectedId("");
      setMessages([]);
      setPreview(null);
      setNotice(
        result.message ??
          `Đã quét ${scanned.length} cuộc trò chuyện. Chọn một cuộc trò chuyện để xem tin nhắn.`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Quét thất bại.");
    } finally {
      setBusy(null);
    }
  };

  const openConversation = async (conversation: PhoneBridgeConversation) => {
    const title = conversationTitle(conversation);
    if (!title) {
      setError("Cuộc trò chuyện không có tiêu đề để mở trên thiết bị.");
      return;
    }
    const id = conversationId(conversation) || title;
    setSelectedId(id);
    setMessages(conversation.messages ?? []);
    setPreview(null);
    setBusy("open");
    setError(null);
    setNotice(null);
    try {
      const result = await phoneBridgeService.openConversation(
        serial,
        platform,
        title,
      );
      const openedMessages = messagesFromAction(result);
      if (openedMessages) setMessages(openedMessages);
      setNotice(result.message ?? `Đã mở ${conversationName(conversation)}.`);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Không thể mở cuộc trò chuyện.",
      );
    } finally {
      setBusy(null);
    }
  };

  const runDrySend = async () => {
    const trimmed = text.trim();
    if (!trimmed || !selectedId) return;
    setBusy("preview");
    setError(null);
    setNotice(null);
    try {
      const result = await phoneBridgeService.sendMessage(serial, platform, {
        text: trimmed,
        dryRun: true,
        confirmed: false,
      });
      setPreview(result);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Không thể chạy dry-run.",
      );
    } finally {
      setBusy(null);
    }
  };

  const confirmSend = async () => {
    const trimmed = text.trim();
    if (!trimmed || !preview || !selectedId) return;
    setBusy("send");
    setError(null);
    setNotice(null);
    try {
      const result = await phoneBridgeService.sendMessage(serial, platform, {
        text: trimmed,
        dryRun: false,
        confirmed: true,
      });
      setNotice(result.message ?? "Đã gửi tin nhắn.");
      setText("");
      setPreview(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Gửi tin nhắn thất bại.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid min-h-[560px] overflow-hidden rounded-xl border border-border bg-card lg:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="border-b border-border lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between gap-2 border-b border-border p-3">
          <div>
            <p className="text-sm font-semibold">
              {platform === "messenger" ? "Messenger" : "Zalo"}
            </p>
            <p className="text-xs text-muted-foreground">
              {conversations.length} cuộc trò chuyện
            </p>
          </div>
          <div className="flex gap-1">
            <Button
              size="icon"
              variant="ghost"
              title="Làm mới danh sách"
              disabled={loading || busy !== null}
              onClick={() => void loadConversations()}
            >
              <RefreshCw className={loading ? "animate-spin" : ""} />
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy !== null}
              onClick={() => void scanAll()}
            >
              {busy === "scan" ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Search />
              )}
              Quét
            </Button>
          </div>
        </div>

        <div className="max-h-64 overflow-y-auto lg:max-h-[500px]">
          {loading && conversations.length === 0 ? (
            <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Đang tải...
            </div>
          ) : conversations.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              Chưa có cuộc trò chuyện. Hãy chạy quét.
            </p>
          ) : (
            conversations.map((conversation, index) => {
              const id =
                conversationId(conversation) ||
                conversationTitle(conversation);
              return (
                <button
                  key={id || index}
                  type="button"
                  disabled={busy === "open"}
                  onClick={() => void openConversation(conversation)}
                  className={`flex w-full items-start gap-3 border-b border-border px-3 py-3 text-left transition hover:bg-muted/60 ${
                    selectedId === id ? "bg-primary/5" : ""
                  }`}
                >
                  <span className="mt-0.5 rounded-full bg-primary/10 p-2 text-primary">
                    <MessageSquare className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">
                        {conversationName(conversation)}
                      </span>
                      {conversation.unreadCount ?? conversation.unread_count ? (
                        <Badge>
                          {conversation.unreadCount ?? conversation.unread_count}
                        </Badge>
                      ) : null}
                    </span>
                    <span className="mt-1 block truncate text-xs text-muted-foreground">
                      {conversation.snippet ??
                        conversation.preview ??
                        conversation.lastMessage ??
                        conversation.last_message ??
                        "Mở để xem tin nhắn"}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      </aside>

      <section className="flex min-w-0 flex-col">
        <div className="min-h-60 flex-1 space-y-2 overflow-y-auto bg-muted/20 p-4">
          {!selectedId ? (
            <div className="flex h-full min-h-52 items-center justify-center text-center text-sm text-muted-foreground">
              Chọn một cuộc trò chuyện để mở thread và gửi tin nhắn.
            </div>
          ) : messages.length === 0 ? (
            <div className="flex min-h-52 items-center justify-center text-sm text-muted-foreground">
              {busy === "open" ? "Đang mở thread..." : "Chưa có tin nhắn trả về."}
            </div>
          ) : (
            messages.map((message, index) => {
              const outgoing =
                message.fromMe ||
                message.from_me ||
                message.direction === "outgoing" ||
                message.direction === "outbound";
              return (
                <div
                  key={message.id || index}
                  className={`flex ${outgoing ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                      outgoing
                        ? "bg-primary text-primary-foreground"
                        : "border border-border bg-background"
                    }`}
                  >
                    {!outgoing &&
                    (message.senderName || message.sender_name || message.sender) ? (
                      <p className="mb-1 text-xs font-semibold opacity-70">
                        {message.senderName ??
                          message.sender_name ??
                          message.sender}
                      </p>
                    ) : null}
                    <p className="whitespace-pre-wrap break-words">
                      {messageText(message)}
                    </p>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="space-y-3 border-t border-border p-4">
          {error ? (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
          {notice ? (
            <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              {notice}
            </p>
          ) : null}
          <Textarea
            value={text}
            disabled={!selectedId || busy !== null}
            placeholder={
              selectedId
                ? "Nhập nội dung tin nhắn..."
                : "Chọn cuộc trò chuyện trước"
            }
            onChange={(event) => {
              setText(event.target.value);
              setPreview(null);
            }}
          />
          {preview ? (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                Kết quả dry-run
              </p>
              <p className="mt-1 break-words text-sm text-amber-900">
                {resultSummary(preview)}
              </p>
              <p className="mt-2 text-xs text-amber-800">
                Gửi thật là thao tác riêng. Chỉ bấm xác nhận sau khi đã kiểm tra.
              </p>
            </div>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            {preview ? (
              <>
                <Button
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() => setPreview(null)}
                >
                  Hủy xác nhận
                </Button>
                <Button
                  variant="destructive"
                  disabled={busy !== null}
                  onClick={() => void confirmSend()}
                >
                  {busy === "send" ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Send />
                  )}
                  Xác nhận gửi thật
                </Button>
              </>
            ) : (
              <Button
                disabled={!selectedId || !text.trim() || busy !== null}
                onClick={() => void runDrySend()}
              >
                {busy === "preview" ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Send />
                )}
                Chạy dry-run
              </Button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
