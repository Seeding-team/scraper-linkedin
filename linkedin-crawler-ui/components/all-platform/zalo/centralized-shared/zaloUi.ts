/**
 * Design tokens — port nguyên từ zalo-account-module/zalo-forward-module
 * (InvoiceFlowManager, src/lib/ui.ts), CHỈ đổi màu thương hiệu: dùng token
 * `brand`/`brand-hover`/`brand-dark`/`brand-subtle`/`brand-border` đã khai ở
 * app/globals.css (map sang #ba244a của app này, module gốc dùng #0068ff).
 * Mọi trang Zalo tập trung trong app này (forward-rules, campaigns...) dùng
 * chung file này để đồng bộ giao diện 100% với module gốc.
 */

import {
  extractFreeTextBankAccounts,
  formatZaloAnySidebarPreview,
  ZALO_SIDEBAR_BRACKET_LABELS,
  type ZaloSidebarPreviewInput,
} from "@/lib/zaloMessageCatalog";
import { kindLabel, type ZaloMessageKind } from "@/lib/zaloMessageContent";

export { formatZaloAnySidebarPreview, kindLabel, ZALO_SIDEBAR_BRACKET_LABELS };

const FOCUS = "outline-none focus-visible:border-brand focus-visible:ring-[3px] focus-visible:ring-brand/15";

const BTN_BASE =
  "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 " +
  FOCUS;

export const btn = {
  primary: `${BTN_BASE} bg-brand text-white shadow-sm shadow-brand/20 hover:bg-brand-hover`,
  outline: `${BTN_BASE} border border-[#dce1e8] bg-white text-[#2f3e50] hover:bg-[#f1f4f8]`,
  ghost: `${BTN_BASE} text-slate-600 hover:bg-slate-100 hover:text-slate-900`,
  danger: `${BTN_BASE} border border-[#f5c6cb] bg-white text-[#e74c3c] hover:bg-[#fde8e8]`,
  warning: `${BTN_BASE} border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100`,
};

export const btnSize = {
  sm: "h-8 px-3.5",
  md: "h-9 px-4.5",
  lg: "h-11 px-7 text-base",
  icon: "h-8 w-8 p-0",
};

export const input =
  "h-10 w-full rounded-xl border border-[#dce1e8] bg-white px-3.5 text-sm text-[#0a1a2b] transition-[color,box-shadow] placeholder:text-[#a0b0c0] disabled:opacity-50 " +
  FOCUS;

export const select =
  "h-10 rounded-[30px] border border-[#dce1e8] bg-white px-4 text-[13px] font-medium text-[#2f3e50] " + FOCUS;

export const textarea =
  "w-full resize-y rounded-xl border border-[#dce1e8] bg-white px-4 py-3 text-sm text-[#0a1a2b] transition-[color,box-shadow] placeholder:text-[#a0b0c0] disabled:opacity-50 " +
  FOCUS;

export const card = "rounded-2xl border border-[#eef1f5] bg-white";

export const label = "mb-1 block text-[13px] font-semibold text-[#2f3e50]";

const PILL_BASE = "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-3 py-0.5 text-xs font-medium";

export const pill = {
  success: `${PILL_BASE} bg-emerald-50 text-emerald-700`,
  warning: `${PILL_BASE} bg-amber-50 text-amber-700`,
  danger: `${PILL_BASE} bg-red-50 text-red-700`,
  info: `${PILL_BASE} bg-brand-subtle text-brand`,
  neutral: `${PILL_BASE} bg-[#e8edf5] text-[#2f3e50]`,
};

export const table = {
  wrapper: "relative w-full overflow-x-auto",
  root: "w-full border-collapse text-sm",
  head: "whitespace-nowrap py-3 pr-3 text-left align-middle text-xs font-semibold uppercase tracking-[0.3px] text-[#6b7a8d] [&:last-child]:pr-0",
  row: "border-b border-[#f0f3f7] transition-colors last:border-0 hover:bg-[#fafcff]",
  cell: "py-3.5 pr-3 align-middle text-[#1f2a3a] [&:last-child]:pr-0",
};

export const modal = {
  overlay: "fixed inset-0 z-50 bg-black/35 backdrop-blur-sm p-5",
  panel: "w-full rounded-3xl border border-[#eef1f5] bg-white shadow-[0_30px_60px_rgba(0,0,0,0.2)]",
};

export const pageStack = "flex flex-col gap-6";

export const alert = {
  error: "flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700",
  success:
    "flex items-start gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-700",
  info: "flex items-start gap-2 rounded-2xl border border-blue-200 bg-blue-50 px-3.5 py-2.5 text-sm text-blue-700",
};

export const emptyState = {
  wrap: "py-10 text-center text-[#6b7a8d]",
  title: "text-lg font-semibold text-[#2f3e50]",
  desc: "mt-1.5 text-sm",
};

/**
 * Chuẩn hóa nhãn loại tin nhắn theo đủ bộ 31 nhãn native Zalo PC + `[Thẻ ngân hàng]`.
 */
export function getZaloKindLabel(kind: ZaloMessageKind): string {
  return kindLabel(kind);
}

export interface ZaloSidebarConversationFields {
  conversation_id?: string | null;
  thread_type?: string | null;
  has_messages?: boolean | null;
  latest_content?: string | null;
  latest_sender_name?: string | null;
  latest_is_self?: boolean | null;
  latest_is_deleted?: boolean | null;
  latest_type?: string | null;
  latest_msg_type?: string | null;
  latest_msg_kind?: string | null;
  latest_raw_content?: unknown;
  last_message_content?: string | null;
  last_message_type?: string | null;
  last_message_kind?: string | null;
  last_message_raw_content?: unknown;
  last_message_is_deleted?: boolean | null;
}

const RAW_INTERNAL_TYPE_LABEL_MAP: Readonly<Record<string, string>> = {
  "group.event": "👥 Thông báo nhóm",
  group_event: "👥 Thông báo nhóm",
  "friend.event": "👋 Thông báo kết bạn",
  friend_event: "👋 Thông báo kết bạn",
  "chat.undo": "Tin nhắn đã được thu hồi",
  "chat.delete": "Tin nhắn đã bị xóa",
  "chat.delete.everyone": "Tin nhắn đã bị xóa",
  "chat.photo": "🖼️ [Hình ảnh]",
  "chat.video.msg": "🎬 [Video]",
  "chat.voice": "🎤 [Tin nhắn thoại]",
  "chat.gif": "✨ [GIF]",
  "chat.sticker": "😊 [Sticker]",
  "chat.doodle": "🎨 [Vẽ hình]",
  "chat.location.new": "📍 [Vị trí]",
  "share.file": "📎 [Tập tin]",
  "chat.ecard": "👋 [Thiệp]",
  "group.poll": "📊 [Bình chọn]",
  "chat.todo": "✅ [Công việc]",
  "chat.reminder": "⏰ [Nhắc hẹn]",
  "chat.webcontent": "💳 [Thẻ ngân hàng]",
  "chat.webcontent.v2": "💳 [Thẻ ngân hàng]",
  "zinstant.bankcard": "💳 [Thẻ ngân hàng]",
};

function decorateSidebarPreview(preview: string): string {
  const trimmed = preview.trim();
  if (!trimmed) return "";

  const lower = trimmed.toLowerCase();
  if (RAW_INTERNAL_TYPE_LABEL_MAP[lower]) {
    return RAW_INTERNAL_TYPE_LABEL_MAP[lower];
  }

  // Cuộc gọi đã có icon 📞/📹/📵 từ formatZaloSidebarPreview
  if (/^(?:📞|📹|📵|💳|📎|📁|👤|🔗|🖼️|✨|🎬|🎤|😊|🎨|📍|📊|⏰|✅|👋|👥)\s/.test(trimmed)) {
    return trimmed;
  }

  // Thẻ ngân hàng
  if (trimmed.startsWith("[Thẻ ngân hàng]") || trimmed.startsWith("[Tài khoản ngân hàng]")) {
    return `💳 ${trimmed.replace("[Tài khoản ngân hàng]", "[Thẻ ngân hàng]")}`;
  }
  // Tập tin / Thư mục
  if (trimmed.startsWith("[File]")) {
    return `📎 ${trimmed.replace(/^\[File\]/, "[Tập tin]")}`;
  }
  if (trimmed.startsWith("[Tệp đính kèm]") || trimmed.startsWith("[Tập tin]")) {
    return `📎 ${trimmed}`;
  }
  if (trimmed.startsWith("[Thư mục]")) {
    return `📁 ${trimmed}`;
  }
  // Danh thiếp
  if (trimmed.startsWith("[Danh thiếp]")) {
    return `👤 ${trimmed}`;
  }
  // Liên kết / Mini App / Bài viết
  if (trimmed.startsWith("[Link]")) {
    return `🔗 ${trimmed.replace(/^\[Link\]/, "[Liên kết]")}`;
  }
  if (
    trimmed.startsWith("[Liên kết]") ||
    trimmed.startsWith("[Mini App]") ||
    trimmed.startsWith("[Bài viết]") ||
    trimmed.startsWith("[Bài đăng]")
  ) {
    return `🔗 ${trimmed}`;
  }
  // Hình ảnh / Album / GIF / Video / Voice / Sticker / Doodle / Location
  if (trimmed.startsWith("[Hình ảnh]") || trimmed.startsWith("[Album]")) {
    return `🖼️ ${trimmed}`;
  }
  if (trimmed.startsWith("[GIF]") || trimmed.startsWith("[Ảnh động]")) {
    return `✨ ${trimmed}`;
  }
  if (trimmed.startsWith("[Video]")) {
    return `🎬 ${trimmed}`;
  }
  if (trimmed.startsWith("[Tin nhắn thoại]")) {
    return `🎤 ${trimmed}`;
  }
  if (trimmed.startsWith("[Sticker]") || trimmed.startsWith("[Bộ sticker]")) {
    return `😊 ${trimmed}`;
  }
  if (trimmed.startsWith("[Vẽ hình]")) {
    return `🎨 ${trimmed}`;
  }
  if (trimmed.startsWith("[Vị trí]")) {
    return `📍 ${trimmed}`;
  }
  // Bình chọn / Nhắc hẹn / Công việc
  if (trimmed.startsWith("[Bình chọn]")) {
    return `📊 ${trimmed}`;
  }
  if (trimmed.startsWith("[Nhắc hẹn]")) {
    return `⏰ ${trimmed}`;
  }
  if (trimmed.startsWith("[Công việc]")) {
    return `✅ ${trimmed}`;
  }
  // Thiệp / Lời mời kết bạn / Đồng ý kết bạn
  if (
    trimmed.startsWith("[Thiệp]") ||
    trimmed.startsWith("[Gợi ý kết bạn]") ||
    /(?:đã đồng ý kết bạn|trở thành bạn bè|lời mời kết bạn|yêu cầu kết bạn)/i.test(trimmed)
  ) {
    return `👋 ${trimmed}`;
  }
  // Thông báo sự kiện nhóm
  if (
    trimmed.startsWith("[Thông báo nhóm]") ||
    /(?:tham gia nhóm|rời khỏi nhóm|xóa khỏi nhóm|chặn khỏi nhóm|đổi tên nhóm|ảnh đại diện nhóm|phó nhóm|trưởng nhóm|giải tán nhóm|ghim một tin nhắn|đã ghim \d+ tin nhắn|bỏ ghim)/i.test(
      trimmed,
    )
  ) {
    return `👥 ${trimmed}`;
  }

  // Tin nhắn thu hồi / đã xóa giữ gọn sạch
  if (/^tin nhắn đã (?:được )?(?:thu hồi|bị xóa|xóa|tự xóa)/i.test(trimmed)) {
    return trimmed;
  }

  // Nếu tin nhắn văn bản thường có chứa số tài khoản ngân hàng tự do → gắn nhẹ 💳 ở đầu
  const freeBanks = extractFreeTextBankAccounts(trimmed);
  if (freeBanks.length > 0) {
    return `💳 ${trimmed}`;
  }

  return trimmed;
}

/**
 * Chuẩn hóa dòng xem trước tin nhắn cuối cho mọi Sidebar danh sách hội thoại Zalo.
 * Tự động tận dụng toàn bộ trường `content`, `type`, `msg_kind`, `raw_content`,
 * `is_sent`, `is_deleted` nếu backend trả về, đồng thời loại bỏ 100% fallback xấu.
 */
const UGLY_SIDEBAR_FALLBACK_RE = /—\s*mở\s*zalo\s*để\s*xem|tin\s*nhắn\s*dạng\s*đặc\s*biệt/i;

export function formatConversationSidebarPreview(
  conv: ZaloSidebarConversationFields,
  options?: { isSelf?: boolean; emptyText?: string },
): string {
  const rec = conv as Record<string, unknown>;
  const rawContentStr =
    typeof conv.latest_content === "string"
      ? conv.latest_content
      : typeof conv.last_message_content === "string"
        ? conv.last_message_content
        : null;
  const content =
    rawContentStr && UGLY_SIDEBAR_FALLBACK_RE.test(rawContentStr) ? null : rawContentStr;
  const type =
    (typeof conv.latest_type === "string" && conv.latest_type) ||
    (typeof conv.latest_msg_type === "string" && conv.latest_msg_type) ||
    (typeof conv.last_message_type === "string" && conv.last_message_type) ||
    (typeof rec.type === "string" ? rec.type : null);
  const msgKind =
    (typeof conv.latest_msg_kind === "string" && conv.latest_msg_kind) ||
    (typeof conv.last_message_kind === "string" && conv.last_message_kind) ||
    (typeof rec.msg_kind === "string" ? rec.msg_kind : null);
  const rawContent =
    conv.latest_raw_content !== undefined
      ? conv.latest_raw_content
      : conv.last_message_raw_content !== undefined
        ? conv.last_message_raw_content
        : rec.raw_content;
  const isDeleted = Boolean(conv.latest_is_deleted ?? conv.last_message_is_deleted ?? rec.is_deleted);
  const isSent = options?.isSelf ?? Boolean(conv.latest_is_self);

  const input: ZaloSidebarPreviewInput = {
    content,
    type,
    msg_kind: msgKind,
    raw_content: rawContent,
    is_sent: isSent,
    is_deleted: isDeleted,
  };

  const formatted = formatZaloAnySidebarPreview(input);
  const decorated = decorateSidebarPreview(formatted);
  if (decorated) return decorated;
  if (rawContentStr && UGLY_SIDEBAR_FALLBACK_RE.test(rawContentStr)) return "[Tin nhắn]";
  return options?.emptyText || "";
}

/** Kiểm tra dòng preview đã là thông báo hệ thống / kết bạn / nhóm để không lặp tiền tố "Bạn: ". */
export function isSidebarSystemNoticePreview(preview: string): boolean {
  return /^(?:👋|👥)\s/.test(preview) || /^(?:Bạn và |Hai bạn |Trưởng nhóm |Nhóm đã )/i.test(preview);
}
