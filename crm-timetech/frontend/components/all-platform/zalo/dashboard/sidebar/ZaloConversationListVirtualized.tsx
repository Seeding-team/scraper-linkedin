"use client";

/**
 * Virtualized list cho Zalo Conversation Sidebar.
 *
 * Tại sao cần: Khi account có 246+ groups (như tài khoản ho-ng), render toàn bộ
 * items vào DOM gây lag khi scroll, scrollbar giật, FPS tụt. Virtualization
 * chỉ render ~15 items thực sự hiển thị + buffer, giữ FPS ổn định 60.
 *
 * Thư viện: @tanstack/react-virtual (3KB, native React 19 support, no peer deps).
 *
 * Cách hoạt động:
 *   - Component cha truyền `height` (tính từ container height qua ResizeObserver).
 *   - Component đo từng row = 72px (chiều cao cố định của conversation item).
 *   - Chỉ render items trong viewport + overscan 5 items.
 *
 * Không phá logic hiện tại:
 *   - Component này wrap conversation item, không thay đổi props của nó.
 *   - Search filter hoạt động bình thường (parent filter rồi truyền vào).
 *   - Selection state do parent quản lý.
 */

import { useRef, useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ZaloConversationListSkeleton } from "../chat/ZaloChatSkeleton";
import type { ZaloConversationSummary } from "@/types/zalo-api";
import { MaterialIcon } from "@/components/ui";
import { InboxShareToggle } from "../InboxShareToggle";
import { useAppAuth } from "@/contexts/AppAuthContext";

interface Props {
  conversations: ZaloConversationSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  searchQuery: string;
  isLoading?: boolean;
  /** Bật tick "share với leader" trên mỗi conversation (cho luồng Tin nhắn KPI) */
  enableInboxShare?: boolean;
  /** accountId (Zalo) hiện tại của sidebar */
  accountId?: string;
  /** Chế độ full-screen: tăng kích thước UI (font/row) cho dễ nhìn */
  fullScreen?: boolean;
  conversationTags: Record<string, string>;
  onSetTag: (convId: string, tag: string) => void;
  onTogglePin?: (id: string) => void;
  onToggleHide?: (id: string) => void;
  pinnedConversations?: Record<string, boolean>;
  hiddenConversations?: Record<string, boolean>;
}

const ROW_HEIGHT_DEFAULT = 72; // px — match với padding + content của conversation item
const ROW_HEIGHT_FULL = 88;   // px — lớn hơn cho chế độ fullScreen
const OVERSCAN = 5;           // render thêm 5 items trên/dưới viewport

export function ZaloConversationListVirtualized({
  conversations,
  selectedId,
  onSelect,
  searchQuery,
  isLoading = false,
  enableInboxShare = false,
  accountId,
  fullScreen = false,
  conversationTags,
  onSetTag,
  onTogglePin,
  onToggleHide,
  pinnedConversations,
  hiddenConversations,
}: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [parentHeight, setParentHeight] = useState(0);
  const [dropdownOpenId, setDropdownOpenId] = useState<string | null>(null);
  const [dropdownPos, setDropdownPos] = useState({ x: 0, y: 0 });
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    return () => {
      const tooltip = document.getElementById("zalo-custom-tooltip");
      if (tooltip) tooltip.remove();
    };
  }, []);

  useEffect(() => {
    if (!dropdownOpenId) return;
    const handleOutsideClick = () => {
      setDropdownOpenId(null);
    };
    document.addEventListener("click", handleOutsideClick);
    return () => {
      document.removeEventListener("click", handleOutsideClick);
    };
  }, [dropdownOpenId]);

  useEffect(() => {
    const parent = parentRef.current;
    if (!parent) return;
    const handleScroll = () => {
      const tooltip = document.getElementById("zalo-custom-tooltip");
      if (tooltip) tooltip.remove();
    };
    parent.addEventListener("scroll", handleScroll);
    return () => {
      parent.removeEventListener("scroll", handleScroll);
    };
  }, []);

  const TAGS = [
    { value: "new", label: "Mới", bg: "bg-emerald-50 text-emerald-700 border-emerald-200" },
    { value: "chatting", label: "Đang chat", bg: "bg-blue-50 text-blue-700 border-blue-200" },
    { value: "followup", label: "Follow-up", bg: "bg-amber-50 text-amber-700 border-amber-200" },
    { value: "inactive", label: "Không HĐ", bg: "bg-surface-container-low text-on-surface-variant border-outline-variant" },
  ];

  // Đo height của container thật qua ResizeObserver.
  // Quan trọng: virtualization cần height chính xác để tính viewport.
  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const height = entries[0]?.contentRect.height ?? 0;
      setParentHeight(height);
    });
    observer.observe(el);
    // Set initial height ngay lập tức (tránh flash 0px)
    setParentHeight(el.clientHeight);
    return () => observer.disconnect();
  }, []);

  const virtualizer = useVirtualizer({
    count: conversations.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => (fullScreen ? ROW_HEIGHT_FULL : ROW_HEIGHT_DEFAULT),
    overscan: OVERSCAN,
  });

  // Auto-scroll đến conversation đang được chọn khi selectedId thay đổi từ bên ngoài
  // (vd: search → click result ở nơi khác → sidebar cần cuộn tới đó).
  useEffect(() => {
    if (!selectedId) return;
    const idx = conversations.findIndex((c) => c.conversation_id === selectedId);
    if (idx >= 0) {
      virtualizer.scrollToIndex(idx, { align: "auto" });
    }
  }, [selectedId, conversations, virtualizer]);

  const totalSize = virtualizer.getTotalSize();
  const virtualItems = virtualizer.getVirtualItems();

  if (isLoading && conversations.length === 0) {
    return <ZaloConversationListSkeleton count={10} />;
  }

  if (conversations.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-8 text-center bg-surface h-full">
        <p className="text-sm text-on-surface-variant leading-relaxed">
          {searchQuery
            ? "Không tìm thấy hội thoại phù hợp"
            : "Chưa có hội thoại. Bấm Đồng bộ để tải về."}
        </p>
      </div>
    );
  }

  return (
    <div
      ref={parentRef}
      className="flex-1 overflow-y-auto min-h-0 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-slate-300/80 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-slate-400 [&::-webkit-scrollbar-track]:bg-transparent"
    >
      <div
        style={{
          height: `${totalSize}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {virtualItems.map((virtualRow) => {
          const conv = conversations[virtualRow.index];
          if (!conv) return null;
          const isActive = conv.conversation_id === selectedId;
          const title = conv.conversation_name || `Hội thoại ${conv.conversation_id.slice(0, 6)}`;
          const isPinned = pinnedConversations
            ? !!pinnedConversations[conv.conversation_id]
            : !!conv.is_pinned;
          const isFb = conv.conversation_id.startsWith("fb_");

          return (
            <div
              key={conv.conversation_id}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <div
                role="button"
                tabIndex={0}
                onClick={() => onSelect(conv.conversation_id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(conv.conversation_id);
                  }
                }}
                onMouseEnter={(e) => {
                  const item = e.currentTarget;
                  const fullName = item.getAttribute('data-fullname') || '';
                  if (!fullName) return;

                  let tooltip = document.getElementById('zalo-custom-tooltip');
                  if (!tooltip) {
                    tooltip = document.createElement('div');
                    tooltip.id = 'zalo-custom-tooltip';
                    tooltip.style.cssText = 'position:fixed;background:#1a1a1a;color:#fff;border-radius:6px;padding:6px 10px;font-size:12px;z-index:9999;pointer-events:none;white-space:nowrap;transition:opacity 0.1s;';
                    document.body.appendChild(tooltip);
                  }

                  tooltip.textContent = fullName;
                  const rect = item.getBoundingClientRect();
                  tooltip.style.left = (rect.right + 8) + 'px';
                  const tooltipHeight = tooltip.offsetHeight || 28;
                  tooltip.style.top = (rect.top + rect.height / 2 - tooltipHeight / 2) + 'px';
                }}
                onMouseLeave={() => {
                  const tooltip = document.getElementById('zalo-custom-tooltip');
                  if (tooltip) {
                    tooltip.remove();
                  }
                }}
                title={title}
                data-fullname={title}
                className={`zalo-chat-item w-full h-full flex items-center gap-3 cursor-pointer ${
                  fullScreen ? "px-5 gap-4" : "px-4"
                } text-left transition border-b border-outline-variant hover:bg-surface-container-low focus:outline-none focus-visible:bg-surface-container-low focus-visible:ring-2 focus-visible:ring-red-500/40 relative group ${
                  isActive
                    ? "bg-red-50/50 before:absolute before:left-0 before:top-0 before:bottom-0 before:w-1 before:bg-primary before:rounded-r-md"
                    : ""
                }`}
              >
                {conv.avatar_url ? (
                  <div className="relative shrink-0 select-none">
                    <img
                      src={conv.avatar_url}
                      alt={title}
                      className={`${
                        fullScreen ? "h-11 w-11" : "h-9 w-9"
                      } rounded-full object-cover border border-outline-variant bg-surface`}
                      onError={(e) => {
                        (e.target as HTMLElement).style.display = "none";
                      }}
                    />
                    {isPinned && (
                      <div className="absolute -top-1.5 -left-1.5 text-[10px]">📌</div>
                    )}
                  </div>
                ) : (
                  <div
                    className={`${
                      fullScreen ? "h-11 w-11 text-[13px]" : "h-9 w-9 text-[11px]"
                    } shrink-0 rounded-full flex items-center justify-center font-bold relative select-none ${
                      isActive
                        ? "bg-primary text-white"
                        : "bg-surface-container-highest text-on-surface-variant"
                    }`}
                  >
                    {initials(title)}
                    {isPinned && (
                      <div className="absolute -top-1.5 -left-1.5 text-[10px]">📌</div>
                    )}
                  </div>
                )}
                <div className="min-w-0 flex-1 flex flex-col">
                  {/* Dòng 1 — tên + timestamp */}
                  <div className="zalo-chat-item-row1 flex items-center justify-between mb-0.5">
                    <div
                      title={title}
                      className={`zalo-chat-item-name truncate text-[13px] font-semibold text-on-surface ${
                        conv.unread_count && conv.unread_count > 0 ? "font-bold" : ""
                      }`}
                    >
                      {title}
                    </div>
                    <div className="zalo-chat-item-time text-[10px] text-on-surface-variant shrink-0 font-medium">
                      {formatTime(conv.latest_message_at)}
                    </div>
                  </div>

                  {/* Dòng 2 — badge channel + badge trạng thái */}
                  <div className="zalo-chat-item-row2 flex items-center gap-1.5 mb-0.5">
                    {/* Badge channel */}
                    {isFb ? (
                      <span className="text-[8px] bg-surface-container-low text-on-surface-variant font-bold px-1.5 py-0.5 rounded border border-outline-variant uppercase shrink-0">
                        FB
                      </span>
                    ) : (
                      <span className="text-[8px] bg-sky-50 text-[#0068ff] font-bold px-1.5 py-0.5 rounded border border-sky-200 uppercase shrink-0">
                        Zalo
                      </span>
                    )}

                    {/* Badge trạng thái */}
                    {(() => {
                      const tagVal = conversationTags[conv.conversation_id] || "new";
                      const currentTag = TAGS.find((t) => t.value === tagVal) || TAGS[0];
                      return (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            const rect = e.currentTarget.getBoundingClientRect();
                            setDropdownPos({
                              x: rect.left + window.scrollX,
                              y: rect.bottom + window.scrollY,
                            });
                            setDropdownOpenId(conv.conversation_id);
                          }}
                          className={`px-1 py-0.5 rounded text-[8px] font-bold border transition ${currentTag.bg} hover:brightness-95 shrink-0`}
                        >
                          {currentTag.label}
                        </button>
                      );
                    })()}

                    {enableInboxShare && accountId && (
                      <div className="zalo-icon-hide ml-auto">
                        <InboxShareToggle
                          accountId={accountId}
                          conversationId={conv.conversation_id}
                          showLabel={false}
                          size="sm"
                        />
                      </div>
                    )}
                  </div>

                  {/* Dòng 3 — preview message */}
                  <div className="zalo-chat-item-row3 flex items-center justify-between">
                    <div
                      className={`truncate flex-1 text-[12px] ${
                        conv.unread_count && conv.unread_count > 0
                          ? "text-on-surface font-semibold"
                          : isActive
                            ? "text-on-surface font-medium"
                            : "text-on-surface-variant"
                      }`}
                    >
                      {(() => {
                        const cleanSenderName = conv.latest_sender_name?.trim();
                        if (!cleanSenderName) return "";

                        const lowerName = cleanSenderName.toLowerCase();
                        const isSelf = lowerName === "__me__" || lowerName === "me" || lowerName === "bạn" || lowerName === "ban";
                        if (isSelf) {
                          return "Bạn: ";
                        }

                        const isGroup = !conv.conversation_id.startsWith("fb_") && conv.conversation_id.startsWith("g");
                        if (isGroup) {
                          return `${cleanSenderName}: `;
                        }

                        return "";
                      })()}
                      {conv.latest_content || "Tin nhắn mới"}
                    </div>
                    {conv.unread_count !== undefined &&
                      conv.unread_count > 0 && (
                        <span className={`flex h-4.5 min-w-4.5 text-[9px] shrink-0 items-center justify-center rounded-full bg-red-500 px-1 font-bold text-white shadow-sm`}>
                          {conv.unread_count}
                        </span>
                      )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {mounted && dropdownOpenId &&
        createPortal(
          <div
            className="fixed z-[9999] bg-surface border border-outline-variant rounded-lg shadow-xl py-1 w-28 text-[11px] font-medium"
            style={{
              left: `${dropdownPos.x}px`,
              top: `${dropdownPos.y + 4}px`,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {TAGS.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => {
                  onSetTag(dropdownOpenId, t.value);
                }}
                className="w-full text-left px-2.5 py-1.5 hover:bg-surface-container-low flex items-center gap-1.5 text-on-surface"
              >
                <span className={`w-2 h-2 rounded-full border ${t.bg}`} />
                {t.label}
              </button>
            ))}
          </div>,
          document.body
        )}
    </div>
  );
}

// ── Helpers (copy từ ZaloChatView để component độc lập) ───────────────────

function formatTime(value?: string | null) {
  if (!value) return "";
  const num = Number(value);
  const date =
    !Number.isNaN(num) && String(num) === String(value).trim()
      ? new Date(num)
      : new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function initials(value: string) {
  const words = value
    .replace(/^\[|\]$/g, "")
    .split(/\s+/)
    .filter(Boolean);
  const first = words[0]?.[0] ?? "Z";
  const second = words.length > 1 ? words[words.length - 1]?.[0] : "";
  return `${first}${second}`.toUpperCase();
}
