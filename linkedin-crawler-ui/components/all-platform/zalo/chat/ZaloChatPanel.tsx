"use client";

/**
 * Ported từ components/zalo/chat/ZaloChatPanel.tsx (app chính).
 *
 * Giao diện (2026-09-10): reskin pixel-match theo mockup TimeTech Chat
 * (timetich.html, khối `.chat-panel` / `.chat-header` / `.chat-footer`) —
 * header nền #fafcff với nút hành động dạng viên thuốc viền #dce1e8, khung
 * gõ tin dạng viên thuốc nền #f1f4f8, nút gửi tròn xanh #0068ff. Logic gửi
 * tin / đính kèm file / gom nhóm ảnh giữ nguyên, không đổi.
 */

import { ArrowLeft, Check, Copy, Forward, Images, Loader2, MessageCircle, MoreVertical, Paperclip, Pencil, Plus, RefreshCw, Reply, Search as SearchIcon, Send, SmilePlus, Sticker as StickerIcon, Trash2, Undo2, User, UserPlus, X, Zap } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { emojiForReaction, REACTION_OPTIONS, zaloApi, ZaloConversation, ZaloMessage, ZaloSticker } from "@/lib/zaloApiClient";
import {
  ALL_MENTION_TOKEN,
  ALL_MENTION_UID,
  filterMentionCandidates,
  findActiveMentionQuery,
  insertMentionToken,
  matchesAllMention,
  type MentionCandidate,
  type PendingMention,
} from "@/lib/mentionUtils";
import { previewText, type ZaloAttachment } from "@/lib/zaloMessageContent";
import { Avatar } from "./Avatar";
import { MessageAttachments } from "./MessageAttachments";
import { MentionPicker } from "./MentionPicker";
import { ForwardMessageModal } from "./ForwardMessageModal";
import { MediaGalleryModal } from "./MediaGalleryModal";

const IMAGE_GROUP_WINDOW_MS = 3000;

/**
 * Zalo gửi mỗi ảnh của 1 album như 1 TIN NHẮN RIÊNG → render y nguyên sẽ ra
 * nhiều bong bóng rời rạc. Gộp các tin liên tiếp CHỈ có ảnh, cùng người gửi,
 * sát nhau về thời gian → 1 bong bóng nhiều ảnh, khớp cách Zalo hiển thị.
 *
 * Chỉ gộp ẢNH: video/link/file mỗi cái là 1 thẻ riêng, gộp lại sẽ rối.
 */
function isImageOnlyMessage(m: ZaloMessage): boolean {
  if (m.content?.trim()) return false;
  const attachments = m.attachments || [];
  if (attachments.length === 0) return false;
  return attachments.every((a) => a.kind === "image" || a.kind === "gif");
}

function groupImageMessagesForDisplay(messages: ZaloMessage[]): ZaloMessage[] {
  const grouped: ZaloMessage[] = [];
  for (const m of messages) {
    const last = grouped[grouped.length - 1];
    const withinWindow = !!last && Math.abs(new Date(m.timestamp || 0).getTime() - new Date(last.timestamp || 0).getTime()) <= IMAGE_GROUP_WINDOW_MS;

    if (last && isImageOnlyMessage(m) && isImageOnlyMessage(last) && last.sender_id === m.sender_id && last.is_sent === m.is_sent && withinWindow) {
      grouped[grouped.length - 1] = {
        ...last,
        attachments: [...(last.attachments || []), ...(m.attachments || [])],
        image_urls: [...(last.image_urls || []), ...(m.image_urls || [])],
        timestamp: m.timestamp || last.timestamp,
      };
      continue;
    }
    grouped.push(m);
  }
  return grouped;
}

interface Props {
  conv: ZaloConversation | null;
  messages: ZaloMessage[];
  loading: boolean;
  sending: boolean;
  replyText: string;
  setReplyText: (s: string) => void;
  pendingFiles: File[];
  setPendingFiles: (files: File[]) => void;
  /** Mention đã chèn vào replyText (gõ "@" chọn thành viên/@All) — sống ở
   *  useZalo() cùng cấp với replyText để không mất khi component re-mount. */
  pendingMentions: PendingMention[];
  setPendingMentions: (mentions: PendingMention[]) => void;
  onSend: () => void;
  onSync: () => void;
  onBack?: () => void;
  headerActions?: React.ReactNode;
  /** Cần để gọi bridge lấy danh sách thành viên nhóm khi mở popup mention. */
  accountId: string;
  /** Gọi NGAY sau khi THU HỒI 1 tin thành công, kèm message_id đã thu hồi —
   *  parent cập nhật local state tức thì (không đợi refetch) để hiện đúng
   *  "Tin nhắn đã bị thu hồi" ngay lập tức, đồng thời tự refetch nền để đồng
   *  bộ lại với server (bridge đã cập nhật is_deleted=true ở DB). */
  onMessageRecalled?: (messageId: string) => void;
  /** Tìm tin nhắn cũ theo nội dung TRONG hội thoại đang mở — xem nút kính lúp
   *  ở header. Không đổi `messages` hiện tại, chỉ trả danh sách kết quả rời
   *  để hiện dropdown (xem searchMessagesInThread ở useZalo.ts). */
  onSearchMessages?: (query: string) => Promise<ZaloMessage[]>;
  /** Bấm vào 1 kết quả tìm kiếm — tải lại `messages` quanh mốc ts đó + cuộn
   *  tới, xem jumpToMessage ở useZalo.ts. */
  onJumpToMessage?: (ts: number | string, messageId: string) => void;
  /** message_id đang cần chớp sáng + cuộn tới (vừa "nhảy tới" từ tìm kiếm). */
  highlightedMessageId?: string | null;
  /** Gọi NGAY sau khi thả/gỡ cảm xúc thành công — parent cập nhật local state
   *  tức thì, xem applyReactionLocally() ở useZalo.ts. */
  onReactionApplied?: (messageId: string, reaction: string | null) => void;
  /** Tin đang được TRẢ LỜI (quote) — kéo 1 tin từ trái sang phải để chọn (xem
   *  MessageBubble bên dưới). null = không trả lời tin nào. */
  replyingTo?: ZaloMessage | null;
  /** Bắt đầu trả lời 1 tin — gọi khi kéo tin đủ xa sang phải rồi thả chuột. */
  onStartReply?: (msg: ZaloMessage) => void;
  /** Huỷ trả lời (bấm X trên thanh preview phía trên ô nhập tin). */
  onCancelReply?: () => void;
  /** Toàn bộ danh sách hội thoại — CHỈ dùng làm nguồn chọn đích cho picker
   *  "Chuyển tiếp" thủ công (ForwardMessageModal). undefined = ẩn nút chuyển
   *  tiếp (an toàn khi parent chưa kịp truyền). */
  conversations?: ZaloConversation[];
  /** Bấm "Nhắn tin" trên 1 danh thiếp (contact card) có SĐT — mở/chuyển thẳng
   *  sang hội thoại với người đó, xem handleContactMessage ở ZaloPageContent.tsx. */
  onContactMessage?: (a: ZaloAttachment) => void;
}

type FriendStatus = { is_friend: boolean | null; is_requesting: boolean | null; is_requested: boolean | null };

/**
 * Huy hiệu trạng thái bạn bè cạnh tên hội thoại 'user' đang mở — ưu tiên hiển
 * thị theo thứ tự: đã là bạn > mình vừa gửi lời mời > họ vừa gửi lời mời >
 * chưa kết bạn. `null` (chưa tra được/đang tải) thì không hiện gì, tránh báo
 * sai trạng thái.
 *
 * LƯU Ý QUAN TRỌNG (xác nhận thực tế 2026-09-15, KHÁC tên gọi trực giác của
 * zca-js): field `is_requested` của Zalo mới là "MÌNH đã gửi lời mời cho họ",
 * còn `is_requesting` mới là "HỌ đang gửi lời mời cho mình, đang chờ mình
 * chấp nhận" — NGƯỢC với tên gọi tưởng như hiển nhiên. Test thật: gửi lời
 * mời xong hiện đúng "Đã gửi lời mời" (state lạc quan tại chỗ), nhưng chuyển
 * hội thoại rồi quay lại (tra lại status THẬT từ Zalo) thì lại hiện "Họ muốn
 * kết bạn" — tức là field Zalo trả về true lúc đó chính là `is_requested`,
 * không phải `is_requesting` như suy đoán ban đầu. Đổi tên biến ở đây rất dễ
 * gây nhầm lẫn thêm lần nữa nên đã chừa lại nguyên comment này, ĐỪNG đảo lại
 * nếu không có bằng chứng thực tế mới.
 */
function FriendStatusBadge({ status }: { status: FriendStatus }) {
  if (status.is_friend === true) {
    return <span className="shrink-0 rounded-full bg-[#e7f7ec] px-2 py-0.5 text-[11px] font-medium text-[#1a9c46]">Bạn bè</span>;
  }
  if (status.is_requested === true) {
    return <span className="shrink-0 rounded-full bg-[#fff4e0] px-2 py-0.5 text-[11px] font-medium text-[#b06a00]">Đã gửi lời mời</span>;
  }
  if (status.is_requesting === true) {
    return <span className="shrink-0 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-[#c62828]">Họ muốn kết bạn</span>;
  }
  if (status.is_friend === false) {
    return <span className="shrink-0 rounded-full bg-[#f1f4f8] px-2 py-0.5 text-[11px] font-medium text-[#6b7a8d]">Chưa kết bạn</span>;
  }
  return null;
}

function formatTime(dateStr?: string | null): string {
  if (!dateStr) return "";
  const t = new Date(dateStr);
  if (Number.isNaN(t.getTime())) return dateStr;
  return t.toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
}

/** Giới hạn độ dài preview tin ĐANG ĐƯỢC TRẢ LỜI (khối trích dẫn trong bong
 *  bóng + thanh "Trả lời..." trên ô soạn) — tin gốc dài làm khối này giãn hết
 *  cỡ bong bóng, rối giao diện (yêu cầu người dùng 2026-09-20). Cắt tại đây
 *  (không chỉ dựa vào CSS truncate) để chắc chắn gọn dù text không có khoảng
 *  trắng nào để `truncate` (nowrap) tự ngắt dòng đẹp. */
const REPLY_PREVIEW_MAX_LEN = 80;
function truncatePreview(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > REPLY_PREVIEW_MAX_LEN ? `${trimmed.slice(0, REPLY_PREVIEW_MAX_LEN).trimEnd()}…` : trimmed;
}

/** Escape ký tự đặc biệt regex — `query` gõ tự do từ người dùng (vd "a.b(c"). */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Bôi vàng đúng đoạn khớp từ khoá trong preview kết quả tìm kiếm.
 * `text.split(regexCóCapturingGroup)` xen kẽ [thường, khớp, thường, khớp,
 * ...] — index LẺ luôn là phần khớp (cùng cách làm với linkifyText() ở trên),
 * không dùng lại `re.test()` vì regex có cờ `g` sẽ giữ `lastIndex` giữa các
 * lần gọi, gây kết quả sai khi lặp qua từng phần tử.
 */
function highlightMatch(text: string, query: string): React.ReactNode[] {
  if (!query) return [text];
  const re = new RegExp(`(${escapeRegExp(query)})`, "gi");
  return text.split(re).map((part, i) =>
    i % 2 === 1 ? (
      <mark key={i} className="rounded-sm bg-[#fff3cd] px-0.5 text-inherit">
        {part}
      </mark>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

/**
 * Bắt URL trong nội dung tin nhắn CHỮ THƯỜNG (không phải tin chia sẻ link
 * "chat.recommended" — loại đó đã có thẻ preview riêng ở MessageAttachments).
 * Zalo cho phép dán thẳng 1 URL vào tin nhắn mà KHÔNG dùng tính năng share
 * link — Zalo protocol coi đây là `content` string thuần (msgType vẫn là
 * "webchat"/text bình thường), nên trước đây bị render y nguyên như chữ,
 * không bấm được. Regex bắt cả "https://..." lẫn "www...." không có scheme.
 */
const URL_REGEX = /(https?:\/\/[^\s<>"')]+|www\.[^\s<>"')]+\.[a-z]{2,}[^\s<>"'()]*)/gi;

/** Cắt dấu câu cuối câu (., ,, ;, :, !, ?) dính liền sau URL — vd "xem tại
 *  https://a.co/x." → chỉ link hoá "https://a.co/x", dấu chấm cuối câu vẫn
 *  hiện như chữ thường. */
function splitTrailingPunctuation(match: string): { url: string; trailing: string } {
  const m = match.match(/^(.*?)([.,;:!?]+)$/);
  return m && m[1] ? { url: m[1], trailing: m[2] } : { url: match, trailing: "" };
}

/**
 * Nhận diện tin nhắn CHỮ THƯỜNG có khả năng chứa SỐ TÀI KHOẢN NGÂN HÀNG (yêu
 * cầu người dùng 2026-09-20: "gửi số tài khoản ngân hàng cũng hiển thị được")
 * — Zalo KHÔNG có 1 loại tin native riêng cho việc này (khác danh thiếp), nhân
 * viên thường gõ tay kiểu "STK 0123456789 Vietcombank Nguyễn Văn A". Bắt theo
 * 2 điều kiện CÙNG LÚC để tránh bắt nhầm số điện thoại/mã đơn hàng thường:
 *   1. Có ít nhất 1 từ khoá liên quan ngân hàng ở BẤT KỲ đâu trong tin.
 *   2. Dãy số 8-19 chữ số (cho phép khoảng trắng xen giữa kiểu "0123 4567 890").
 */
const BANK_KEYWORD_RE =
  /(stk|s\.?\s?tk|số\s*tk|số\s*tài\s*khoản|tài\s*khoản\s*ngân\s*hàng|tk\s*ngân\s*hàng|chuyển\s*khoản|ngân\s*hàng|vietcombank|\bvcb\b|techcombank|\btcb\b|\bbidv\b|agribank|\bacb\b|mbbank|\bmb\s*bank\b|vpbank|tpbank|sacombank|\bvib\b|\bshb\b|eximbank|hdbank|\bocb\b|seabank|vietinbank|\bctg\b|\bscb\b|abbank|\bmsb\b|pvcombank|lienvietpostbank|\blpb\b|bac\s*a\s*bank|\bncb\b|vietabank|kienlongbank|pgbank|saigonbank|dongabank|baovietbank|vietbank|nam\s*a\s*bank|gpbank|cbbank|\bck\b|\bctk\b|vietqr|napas|cake|timo|ubank)/i;
const BANK_ACCOUNT_RUN_RE = /(?<!\d)(\d(?:[\d ]{4,17})\d)(?!\d)/g;

/** Bấm vào số tài khoản để copy — phản hồi tức thì bằng icon đổi thành dấu tích. */
function BankAccountChip({ raw, mine }: { raw: string; mine: boolean }) {
  const [copied, setCopied] = useState(false);
  const digits = raw.replace(/\D/g, "");
  async function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(digits);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* trình duyệt không hỗ trợ Clipboard API — bỏ qua, người dùng vẫn tự bôi đen copy được */
    }
  }
  return (
    <span className="inline-flex items-center gap-1.5 align-baseline my-0.5">
      <span className="font-mono font-bold tracking-wider select-all">{raw}</span>
      <button
        type="button"
        onClick={handleCopy}
        title="Sao chép số tài khoản"
        className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold transition active:scale-95 cursor-pointer ${
          mine
            ? "bg-white/20 hover:bg-white/30 text-white"
            : "bg-blue-50 hover:bg-blue-100 text-[#c62828] border border-blue-200/80"
        }`}
      >
        {copied ? (
          <>
            <Check className="h-3 w-3 text-emerald-500 shrink-0" />
            <span className="text-emerald-500">Đã chép</span>
          </>
        ) : (
          <>
            <Copy className="h-3 w-3 shrink-0" />
            <span>Sao chép</span>
          </>
        )}
      </button>
    </span>
  );
}

/** Tách tiếp phần CHỮ THƯỜNG (không phải URL) tìm số tài khoản ngân hàng. */
function linkifyBankAccounts(text: string, mine: boolean, key: string | number): React.ReactNode {
  const digitsOnly = text.trim().replace(/\s+/g, "");
  const isPureNumber = /^\d{6,19}$/.test(digitsOnly);
  if (!isPureNumber && !BANK_KEYWORD_RE.test(text)) return <span key={key}>{text}</span>;
  return (
    <span key={key}>
      {text.split(BANK_ACCOUNT_RUN_RE).map((seg, j) => {
        if (!seg) return null;
        if (j % 2 === 1) {
          const digitsOnly = seg.replace(/\D/g, "");
          if (digitsOnly.length >= 6 && digitsOnly.length <= 19) {
            return <BankAccountChip key={j} raw={seg} mine={mine} />;
          }
        }
        return <span key={j}>{seg}</span>;
      })}
    </span>
  );
}

function linkifyText(text: string, mine: boolean): React.ReactNode[] {
  // `text.split(regexCóCapturingGroup)` xen kẽ [chữ thường, url khớp, chữ
  // thường, url khớp, ...] — index lẻ luôn là phần khớp URL.
  return text.split(URL_REGEX).map((part, i) => {
    if (!part) return null;
    if (i % 2 === 0) return linkifyBankAccounts(part, mine, i);
    const { url, trailing } = splitTrailingPunctuation(part);
    const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    return (
      <span key={i}>
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className={`underline underline-offset-2 break-all ${mine ? "text-white" : "text-[#c62828]"}`}
        >
          {url}
        </a>
        {trailing}
      </span>
    );
  });
}

/** Kéo sang phải bao nhiêu px thì tính là "muốn trả lời" — thả chuột trước
 *  mốc này thì bong bóng tự trượt về vị trí cũ, coi như không có gì xảy ra. */
const REPLY_DRAG_THRESHOLD = 56;
/** Trần kéo — kéo xa hơn cũng không trượt thêm, tránh bong bóng bay quá xa
 *  khỏi khung nhìn. */
const REPLY_DRAG_MAX = 84;

function MessageBubble({
  msg,
  onRecall,
  recalling,
  highlighted,
  onReact,
  reacting,
  pickerOpen,
  onTogglePicker,
  onSwipeReply,
  onJumpToQuote,
  onForward,
  onContactMessage,
  menuOpen,
  onToggleMenu,
  onMediaLoad,
  onOpenGallery,
}: {
  msg: ZaloMessage;
  /** Chỉ truyền được khi tin có `cli_msg_id` (xem điều kiện hiện nút bên dưới). */
  onRecall?: (msg: ZaloMessage) => void;
  recalling?: boolean;
  /** Vừa "nhảy tới" từ kết quả tìm kiếm — chớp sáng nhẹ để dễ nhận ra giữa
   *  nhiều tin nhắn xung quanh. */
  highlighted?: boolean;
  /** Chọn 1 cảm xúc từ thanh 6 icon (key rỗng "" = bấm lại cảm xúc đang chọn,
   *  tự hiểu là GỠ — xem handleReact ở ZaloChatPanel). Cùng điều kiện
   *  cli_msg_id với onRecall (cần cả 2 id để gọi addReaction). */
  onReact?: (msg: ZaloMessage, reactionKey: string) => void;
  reacting?: boolean;
  pickerOpen?: boolean;
  onTogglePicker?: () => void;
  /** Kéo tin từ trái sang phải rồi thả CHUỘT quá REPLY_DRAG_THRESHOLD — bắt
   *  đầu trả lời tin này (xem handleReply ở ZaloChatPanel). Chỉ hiện khi có
   *  cli_msg_id, giống điều kiện react/recall. */
  onSwipeReply?: (msg: ZaloMessage) => void;
  /** Bấm vào phần trích dẫn (quote) bên trong bong bóng để nhảy tới đúng tin
   *  GỐC đang được trả lời — dùng lại đúng cơ chế "nhảy tới" của tìm kiếm
   *  trong hội thoại (xem onJumpToMessage ở ZaloChatPanel). */
  onJumpToQuote?: (ts: number | string, messageId: string) => void;
  /** Mở picker "Chuyển tiếp" cho tin này — chọn 1/nhiều hội thoại đích để gửi
   *  lại nguyên nội dung/đính kèm (KHÁC tính năng forward-rules tự động của
   *  zalo-forward-module — đây là thao tác thủ công, xem ForwardMessageModal). */
  onForward?: (msg: ZaloMessage) => void;
  /** Bấm "Nhắn tin" trên 1 danh thiếp (contact card) có SĐT bên trong tin này. */
  onContactMessage?: (a: ZaloAttachment) => void;
  /** Menu "..." gom Copy/Chuyển tiếp/Thu hồi (yêu cầu người dùng 2026-09-21 —
   *  gọn hàng hành động, chỉ để riêng "Thả cảm xúc" ngoài menu). Cùng cơ chế
   *  bật/tắt theo id tin với pickerOpen/onTogglePicker (1 menu mở tại 1 thời
   *  điểm, state giữ ở ZaloChatPanel). */
  menuOpen?: boolean;
  onToggleMenu?: () => void;
  /** Ảnh/video trong đính kèm load xong kích thước thật — xem docstring
   *  `onMediaLoad` ở MessageAttachments.tsx (fix "toàn load ở lưng chừng
   *  hội thoại" 2026-09-23). */
  onMediaLoad?: () => void;
  /** Bấm vào 1 ảnh trong tin này — mở trình xem toàn màn hình tại đúng ảnh đó
   *  (xem docstring `onOpenGallery` ở MessageAttachments.tsx). */
  onOpenGallery?: (messageId: string) => void;
}) {


  const mine = msg.is_sent;
  const [expanded, setExpanded] = useState(false);
  // Toạ độ menu "⋮" tính tay lúc bấm mở (xem onClick của nút "⋮" bên dưới) —
  // bắt buộc dùng `position: fixed` theo toạ độ VIEWPORT thay vì `absolute`
  // trong khung tin nhắn, vì khung đó có `overflow-y-auto` nên bất kỳ phần
  // nào của menu tràn ra ngoài (tin cuối cùng ở sát đáy khung, hoặc sát mép
  // phải nơi có thanh cuộn) đều bị CẮT MẤT chứ không chỉ che khuất — đổi
  // z-index không cứu được vì đây là clip bởi overflow của ancestor, không
  // phải vấn đề thứ tự xếp chồng (báo lỗi 2026-10-06, kèm ảnh chụp).
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);

  // ── Kéo sang phải để trả lời (chỉ bằng CHUỘT — người dùng mô tả rõ "thả
  // chuột", không phải cử chỉ vuốt cảm ứng nên cố tình bỏ qua pointerType
  // khác 'mouse' để không xung đột với cuộn dọc trên điện thoại/tablet). ──
  const [dragX, setDragX] = useState(0);
  const draggingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const canSwipeReply = !!msg.cli_msg_id && !!onSwipeReply;
  // `select-none` CHỈ áp trong lúc đang thực sự kéo (state, không phải ref, để
  // trigger re-render đổi class) — trước đây áp CỐ ĐỊNH cho mọi bong bóng
  // (kể cả lúc không kéo gì) nên chặn luôn "bôi đen để copy" tin đã gửi (bug
  // báo 2026-09-18: "Không copy được tin nhắn đã gửi").
  const [isDragging, setIsDragging] = useState(false);

  const handleDragPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!canSwipeReply || e.pointerType !== "mouse" || e.button !== 0) return;
    // Bấm vào 1 nút hành động (Thả cảm xúc/Thu hồi/Chuyển tiếp/trích dẫn...)
    // bên trong bong bóng KHÔNG được tính là bắt đầu kéo — trước đây bất kỳ
    // pointerdown nào trong cả hàng (kể cả trên các nút này) đều gọi
    // setPointerCapture() về hàng ngoài, khiến Chrome không còn phát sinh
    // "click" cho đúng phần tử con nữa (pointer capture retarget click) →
    // Cảm xúc/Thu hồi/Chuyển tiếp bấm không phản ứng gì (bug báo 2026-09-21).
    if ((e.target as Element).closest?.("button, a")) return;
    draggingRef.current = true;
    dragStartXRef.current = e.clientX;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const handleDragPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const delta = e.clientX - dragStartXRef.current;
    // Chỉ khoá bôi đen chữ SAU KHI đã thực sự nhích qua vài px — bấm chuột rồi
    // nhả tại chỗ (click bình thường) không được đụng vào khả năng chọn chữ.
    if (!isDragging && Math.abs(delta) > 3) setIsDragging(true);
    setDragX(Math.max(0, Math.min(REPLY_DRAG_MAX, delta)));
  };
  const endDrag = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setIsDragging(false);
    setDragX((current) => {
      if (current >= REPLY_DRAG_THRESHOLD) onSwipeReply?.(msg);
      return 0;
    });
  };

  // Bấm ra ngoài menu "⋮" (Copy/Chuyển tiếp/Thu hồi) thì tự đóng lại — yêu
  // cầu người dùng 2026-09-21. menuRef bọc cả nút "⋮" lẫn dropdown, click bên
  // trong đó (kể cả các item) không bị coi là "ngoài".
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    function handlePointerDown(e: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onToggleMenu?.();
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [menuOpen, onToggleMenu]);

  // Thông báo hệ thống (kết bạn, bình chọn, ...) — hiện CĂN GIỮA như 1 dòng
  // thông báo, KHÔNG phải bong bóng trái/phải bình thường (xem
  // systemActionText() ở zaloMessageContent.ts).
  if (msg.msg_kind === "system_notice") {
    return (
      <div className="flex justify-center px-4 py-1">
        <div className="max-w-[90%] rounded-full bg-[#eef1f5] px-3.5 py-1.5 text-center text-[12px] text-[#6b7a8d]">
          {msg.system_text || "Thông báo hệ thống"}
        </div>
      </div>
    );
  }

  const attachments = (msg.attachments && msg.attachments.length > 0)
    ? msg.attachments
    : (msg.image_urls && msg.image_urls.length > 0
        ? msg.image_urls.map((url) => ({ kind: "image" as const, url }))
        : []);
  const hasAttachments = attachments.length > 0;
  // Sticker/ảnh (đơn hoặc album, không kèm chú thích): bỏ nền bong bóng cho
  // giống Zalo thật — nền xanh/trắng bọc quanh ảnh/nhãn dán trong suốt trông
  // rất rối (yêu cầu người dùng 2026-09-20: "hình ảnh không nên tô màu nền
  // xanh xung quanh như chữ"). Video/file/link/danh thiếp... vẫn giữ khung —
  // các loại đó cần viền/nền để đọc được chữ/icon bên trong.
  const bare =
    !msg.content?.trim() &&
    attachments.length > 0 &&
    attachments.every((a) => a.kind === "sticker" || a.kind === "image" || a.kind === "gif" || a.kind === "contact");

  // Gom Copy/Chuyển tiếp/Thu hồi vào 1 menu "⋮" nổi bên cạnh bong bóng (yêu
  // cầu người dùng 2026-09-21) — chỉ liệt kê hành động THẬT SỰ dùng được cho
  // tin này, tin nào không đủ điều kiện thì tự ẩn khỏi menu thay vì hiện
  // xám/disable. "Thả cảm xúc" KHÔNG nằm trong menu này — vẫn ở hàng giờ gửi
  // bên dưới, giữ nguyên như trước.
  const menuActions: { key: string; label: string; icon: typeof Copy; danger?: boolean; busy?: boolean; onClick: () => void }[] = [];
  // "Trả lời" — cùng hành động với kéo bong bóng sang phải (onSwipeReply), chỉ
  // thêm 1 lối vào khác dễ bấm hơn trên thiết bị không có chuột (yêu cầu người
  // dùng: thêm nút trả lời vào menu "...").  Cùng điều kiện cli_msg_id với kéo.
  if (canSwipeReply) {
    menuActions.push({
      key: "reply",
      label: "Trả lời",
      icon: Reply,
      onClick: () => {
        onSwipeReply?.(msg);
        onToggleMenu?.();
      },
    });
  }
  if (msg.content?.trim()) {
    menuActions.push({
      key: "copy",
      label: "Copy",
      icon: Copy,
      onClick: () => {
        void navigator.clipboard?.writeText(msg.content || "");
        onToggleMenu?.();
      },
    });
  }
  // Chuyển tiếp THỦ CÔNG — mọi tin có chữ hoặc đính kèm đều chuyển tiếp được
  // (khác Thu hồi chỉ áp dụng tin của mình).
  if (onForward && (msg.content?.trim() || hasAttachments)) {
    menuActions.push({
      key: "forward",
      label: "Chuyển tiếp",
      icon: Forward,
      onClick: () => {
        onForward(msg);
        onToggleMenu?.();
      },
    });
  }
  // Chỉ tự thu hồi được tin CỦA MÌNH, và chỉ khi có cli_msg_id (tin gửi từ
  // sau khi bridge bắt đầu persist cột này — xem migration
  // 2026-09-14_zalo_recall_message.sql). Tin cũ hơn không có cột này nên
  // không thể gọi api.undo() (cần cả msgId lẫn cliMsgId).
  if (mine && msg.cli_msg_id && onRecall) {
    menuActions.push({
      key: "recall",
      label: "Thu hồi",
      icon: Undo2,
      danger: true,
      busy: !!recalling,
      onClick: () => {
        onRecall(msg);
        onToggleMenu?.();
      },
    });
  }

  if (msg.is_deleted) {
    return (
      <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
        <div className="rounded-2xl bg-[#eef1f5] px-4 py-2 text-xs italic text-[#8a9aa8]">Tin nhắn đã bị thu hồi</div>
      </div>
    );
  }

  return (
    <div
      // z-10 khi đang mở menu "⋮"/picker cảm xúc — bảo đảm dropdown của tin
      // này luôn nổi TRÊN bong bóng của các tin liền kề (mặc định các hàng
      // tin xếp chồng theo thứ tự DOM nên hàng phía dưới có thể đè lên dropdown
      // của hàng phía trên nếu không nâng z-index, gây che khuất Copy/Chuyển
      // tiếp — báo lỗi 2026-09-21).
      className={`relative flex gap-2 rounded-xl px-1.5 py-0.5 transition-colors duration-700 ${mine ? "justify-end" : "justify-start"} ${highlighted ? "bg-[#fff3cd]" : "bg-transparent"} ${canSwipeReply ? "cursor-grab active:cursor-grabbing" : ""} ${isDragging ? "select-none" : ""} ${menuOpen || pickerOpen ? "z-10" : ""}`}
      style={{ transform: dragX ? `translateX(${dragX}px)` : undefined, transition: draggingRef.current ? "none" : "transform 0.18s ease" }}
      onPointerDown={handleDragPointerDown}
      onPointerMove={handleDragPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {dragX > 2 ? (
        <div
          className="pointer-events-none absolute left-0 top-1/2 -translate-x-full -translate-y-1/2 pl-1 text-[#c62828]"
          style={{ opacity: Math.min(dragX / REPLY_DRAG_THRESHOLD, 1) }}
        >
          <Reply className="h-4 w-4" />
        </div>
      ) : null}
      {!mine && (
        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#dce1e8] text-xs font-bold text-[#2f3e50]">
          {msg.sender_name?.[0]?.toUpperCase() || <User className="h-3.5 w-3.5" />}
        </div>
      )}
      <div className={`relative min-w-0 max-w-[88%] sm:max-w-[80%] ${mine ? "items-end" : "items-start"} flex flex-col gap-0.5`}>
        {!mine && msg.sender_name && <div className="px-2 text-[11px] font-semibold text-[#6b7a8d]">{msg.sender_name}</div>}
        {pickerOpen ? (
          <div className={`absolute -top-10 z-20 flex items-center gap-0.5 rounded-full border border-[#dce1e8] bg-white p-1 shadow-lg ${mine ? "right-0" : "left-0"}`}>
            {REACTION_OPTIONS.map((r) => (
              <button
                key={r.key}
                type="button"
                title={r.label}
                onClick={() => onReact?.(msg, msg.my_reaction === r.key ? "none" : r.key)}
                className={`grid h-7 w-7 place-items-center rounded-full text-base transition hover:scale-125 hover:bg-[#f1f4f8] ${msg.my_reaction === r.key ? "bg-red-50" : ""}`}
              >
                {r.emoji}
              </button>
            ))}
          </div>
        ) : null}
        <div className={`flex min-w-0 items-center gap-0.5 ${mine ? "flex-row-reverse" : ""}`}>
          <div
            className={
              bare
                ? "min-w-0 text-sm leading-relaxed"
                : `min-w-0 rounded-2xl px-4 py-2 text-sm leading-relaxed ${mine ? "rounded-br-sm bg-gradient-to-r from-[#c62828] to-[#dc2626] text-white" : "rounded-bl-sm bg-white text-[#0a1a2b] shadow-sm"}`
            }
          >
            {/* Trích dẫn tin ĐANG ĐƯỢC TRẢ LỜI — hiện NGAY trong bong bóng để
                biết tin này reply cho tin nhắn nào (yêu cầu người dùng
                2026-09-18: "phải hiển thị tin nhắn đó trả lời cho tin nhắn
                nào"), khớp `quote` do bridge dựng sẵn (buildQuotePreview() ở
                supabaseSync.js). Bấm vào để nhảy tới đúng tin gốc nếu còn id. */}
            {msg.quote ? (
              <button
                type="button"
                onClick={() => {
                  const targetId = msg.quote?.global_msg_id || msg.quote?.cli_msg_id;
                  if (targetId && msg.quote?.ts) onJumpToQuote?.(msg.quote.ts, targetId);
                }}
                className={`mb-1.5 block w-full rounded-lg border-l-[3px] px-2.5 py-1.5 text-left text-[12.5px] ${mine ? "border-white/60 bg-white/15 text-white/90" : "border-[#c62828]/50 bg-[#f1f4f8] text-[#4a5b6d]"
                  }`}
              >
                <div className={`text-[11.5px] font-semibold ${mine ? "text-white" : "text-[#c62828]"}`}>
                  {msg.quote.from_name || "Tin nhắn gốc"}
                </div>
                <div className="truncate opacity-90">{msg.quote.text ? truncatePreview(msg.quote.text) : "Tin nhắn"}</div>
              </button>
            ) : null}
            {/* Đính kèm render theo ĐÚNG loại (ảnh / video phát tại chỗ / link
                dạng thẻ xem trước / file / thoại / nhãn dán) — xem
                MessageAttachments.tsx. Trước đây mọi URL đều bị nhét vào <img>
                nên link và video hiện thành ảnh vỡ. */}
            <MessageAttachments
              attachments={attachments}
              kind={msg.msg_kind}
              mine={mine}
              onContactMessage={onContactMessage}
              unknownLabel={msg.unknown_label}
              onMediaLoad={onMediaLoad}
              onOpenGallery={onOpenGallery ? () => onOpenGallery(msg.message_id) : undefined}
            />
            {msg.content && !(hasAttachments && msg.msg_kind === "bankcard" && /^\[(tài khoản ngân hàng|bank account)\]$/i.test(msg.content.trim())) && (
              <div className={`whitespace-pre-wrap break-words ${hasAttachments ? "mt-2" : ""}`} onClick={() => setExpanded(!expanded)}>
                {linkifyText(msg.content, mine)}
              </div>
            )}
          </div>
          {/* Menu "⋮" Copy/Chuyển tiếp/Thu hồi — nổi ngay CẠNH bong bóng (yêu
              cầu người dùng 2026-09-21, kèm ảnh chụp Zalo thật làm mẫu), khác
              trước đây gộp vào hàng giờ gửi bên dưới. */}
          {menuActions.length > 0 ? (
            <div ref={menuRef} className="relative shrink-0">
              <button
                type="button"
                onClick={(e) => {
                  if (!menuOpen) {
                    // Tự đo chỗ trống quanh nút NGAY lúc bấm mở — tin nằm gần
                    // đáy khung chat (vd tin cuối cùng) thì mở LÊN TRÊN thay vì
                    // xuống dưới, và luôn kẹp trong chiều ngang màn hình để
                    // không lọt ra ngoài/bị thanh cuộn đè lên (xem khai báo
                    // menuPos ở trên).
                    const MENU_WIDTH = 160; // khớp w-40
                    const MENU_HEIGHT = menuActions.length * 36 + 8;
                    const VIEWPORT_MARGIN = 8;
                    const rect = e.currentTarget.getBoundingClientRect();
                    const openUpward = rect.bottom + MENU_HEIGHT + 4 > window.innerHeight;
                    const top = openUpward ? rect.top - MENU_HEIGHT - 4 : rect.bottom + 4;
                    const rawLeft = mine ? rect.left : rect.right - MENU_WIDTH;
                    const left = Math.min(
                      Math.max(VIEWPORT_MARGIN, rawLeft),
                      window.innerWidth - MENU_WIDTH - VIEWPORT_MARGIN
                    );
                    setMenuPos({ top, left });
                  }
                  onToggleMenu?.();
                }}
                title="Thêm tuỳ chọn"
                className={`grid h-6 w-6 place-items-center rounded-full transition hover:bg-[#f1f4f8] hover:text-[#c62828] ${menuOpen ? "bg-[#f1f4f8] text-[#c62828]" : "text-[#8a9aa8]"}`}
              >
                <MoreVertical className="h-4 w-4" />
              </button>
              {menuOpen && menuPos ? (
                <div
                  style={{ position: "fixed", top: menuPos.top, left: menuPos.left }}
                  className="z-40 w-40 overflow-hidden rounded-lg border border-[#dce1e8] bg-white py-1 text-left shadow-lg"
                >
                  {menuActions.map((a) => {
                    const Icon = a.icon;
                    return (
                      <button
                        key={a.key}
                        type="button"
                        onClick={a.onClick}
                        disabled={a.busy}
                        className={`flex w-full items-center gap-2 px-3 py-2 text-[12.5px] transition hover:bg-[#f1f4f8] disabled:opacity-50 ${a.danger ? "text-red-500" : "text-[#2f3e50]"}`}
                      >
                        {a.busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
                        {a.label}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        {/* Tổng hợp cảm xúc đã thả (của mọi người, không chỉ mình) — bấm vào
            cũng mở lại thanh chọn để đổi/gỡ cảm xúc của MÌNH cho nhanh. */}
        {msg.reactions && Object.keys(msg.reactions).length > 0 ? (
          <button
            type="button"
            onClick={() => onTogglePicker?.()}
            className={`inline-flex items-center gap-1 self-start rounded-full border border-[#eef1f5] bg-white px-1.5 py-0.5 text-[11px] shadow-sm ${mine ? "self-end" : "self-start"}`}
          >
            {Object.entries(msg.reactions)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 4)
              .map(([key, count]) => (
                <span key={key} className="inline-flex items-center gap-0.5">
                  <span>{emojiForReaction(key)}</span>
                  {count > 1 ? <span className="text-[#8a9aa8]">{count}</span> : null}
                </span>
              ))}
          </button>
        ) : null}
        <div className={`flex items-center gap-1.5 px-2 text-[11px] text-[#8a9aa8] ${mine ? "flex-row-reverse" : ""}`}>
          <span>{formatTime(msg.timestamp || msg.time_text)}</span>
          {/* Thả cảm xúc — GIỮ NGUYÊN riêng ngoài menu "..." theo yêu cầu
              người dùng 2026-09-21 ("thả cảm xúc vẫn để nguyên không thay đổi
              gì"). Cần cli_msg_id (tin quá cũ chưa có cột này thì zca-js
              không xác định được tin để addReaction). Áp dụng cho MỌI tin
              (không chỉ tin của mình) — khác Thu hồi chỉ tự thu hồi được tin
              của mình. */}
          {msg.cli_msg_id && onReact ? (
            <button
              type="button"
              onClick={() => onTogglePicker?.()}
              disabled={!!reacting}
              title="Thả cảm xúc"
              className={`transition hover:text-[#c62828] disabled:opacity-50 ${pickerOpen ? "text-[#c62828]" : "text-[#6b7a8d]"}`}
            >
              {reacting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : msg.my_reaction ? <span className="text-sm leading-none">{emojiForReaction(msg.my_reaction)}</span> : <SmilePlus className="h-3.5 w-3.5" />}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function ZaloChatPanel({
  conv,
  messages,
  loading,
  sending,
  replyText,
  setReplyText,
  pendingFiles,
  setPendingFiles,
  pendingMentions,
  setPendingMentions,
  onSend,
  onSync,
  onBack,
  headerActions,
  accountId,
  onMessageRecalled,
  onSearchMessages,
  onJumpToMessage,
  highlightedMessageId,
  onReactionApplied,
  replyingTo,
  onStartReply,
  onCancelReply,
  conversations,
  onContactMessage
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [dragOver, setDragOver] = useState(false);
  // Rà soát giới hạn Zalo 2026-10-01 (sự cố thật: job gửi hàng loạt 39 ảnh/tin
  // bị Zalo từ chối 100%) — backend /send-media đã chặn cứng 10 file/lần
  // (multer, xem services/zalo-bridge/src/routes/zalo-client.js), nhưng
  // trước đây khung chat KHÔNG báo gì cả lúc chọn/dán/kéo-thả ảnh, người dùng
  // chỉ biết khi bấm Gửi rồi nhận lỗi. Cảnh báo NGAY lúc chọn.
  const [fileLimitWarning, setFileLimitWarning] = useState<string | null>(null);
  const MAX_PENDING_FILES = 10;
  const [friendStatus, setFriendStatus] = useState<FriendStatus | null>(null);
  // Trình xem ảnh toàn màn hình (MediaGalleryModal) — xem docstring ở đó.
  // `galleryInitialMessageId` null = mở lưới thumbnail (bấm nút "Xem ảnh" ở
  // header); có giá trị = mở thẳng viewer tại đúng ảnh vừa bấm trong chat.
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [galleryInitialMessageId, setGalleryInitialMessageId] = useState<string | null>(null);
  const [recallingId, setRecallingId] = useState<string | null>(null);
  const [sendingFriendRequest, setSendingFriendRequest] = useState(false);
  const [acceptingFriendRequest, setAcceptingFriendRequest] = useState(false);

  // ── Tìm tin nhắn cũ trong hội thoại đang mở ──────────────────────────────
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ZaloMessage[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchDone, setSearchDone] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const messageNodeRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  // Đổi hội thoại → đóng ô tìm kiếm cũ, tránh hiện kết quả của hội thoại trước.
  useEffect(() => {
    setSearchOpen(false);
    setSearchQuery("");
    setSearchResults([]);
    setSearchDone(false);
    setReactionPickerFor(null);
    setActionMenuFor(null);
    setGalleryOpen(false);
    setGalleryInitialMessageId(null);
  }, [conv?.conversation_id]);

  // Debounce 400ms — tránh gọi API theo từng ký tự gõ.
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q || !onSearchMessages) {
      setSearchResults([]);
      setSearchDone(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    setSearchDone(false);
    const timer = setTimeout(async () => {
      const results = await onSearchMessages(q);
      if (cancelled) return;
      setSearchResults(results);
      setSearching(false);
      setSearchDone(true);
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchQuery, onSearchMessages]);

  // ── Gửi nhãn dán (sticker picker) ────────────────────────────────────────
  const [stickerPickerOpen, setStickerPickerOpen] = useState(false);
  const [stickerQuery, setStickerQuery] = useState("");
  const [stickerResults, setStickerResults] = useState<ZaloSticker[]>([]);
  const [stickerSearching, setStickerSearching] = useState(false);
  const [sendingSticker, setSendingSticker] = useState(false);

  useEffect(() => {
    if (!stickerPickerOpen) return;
    setStickerQuery("");
    setStickerResults([]);
  }, [stickerPickerOpen]);

  useEffect(() => {
    const q = stickerQuery.trim();
    if (!q) {
      setStickerResults([]);
      return;
    }
    let cancelled = false;
    setStickerSearching(true);
    const timer = setTimeout(async () => {
      try {
        const found = await zaloApi.searchStickers(q, accountId);
        if (cancelled) return;
        const urls = await zaloApi.resolveStickerUrls(
          found.map((s) => s.id),
          accountId
        );
        if (cancelled) return;
        setStickerResults(found.map((s) => ({ ...s, url: urls[s.id] || null })).filter((s) => s.url));
      } catch {
        if (!cancelled) setStickerResults([]);
      } finally {
        if (!cancelled) setStickerSearching(false);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [stickerQuery, accountId]);

  async function handleSendSticker(sticker: ZaloSticker) {
    if (!conv) return;
    setSendingSticker(true);
    try {
      await zaloApi.sendSticker(conv.conversation_id, { id: sticker.id, cateId: sticker.cateId, type: sticker.type }, conv.thread_type, accountId);
      setStickerPickerOpen(false);
    } catch (e) {
      if (typeof window !== "undefined") window.alert(e instanceof Error ? e.message : "Gửi nhãn dán thất bại");
    } finally {
      setSendingSticker(false);
    }
  }

  // ── Tin nhắn nhanh (tin soạn sẵn, giống Zalo) ────────────────────────────
  type QuickReply = { id: number; content: string };
  const [quickReplyOpen, setQuickReplyOpen] = useState(false);
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
  const [loadingQuickReplies, setLoadingQuickReplies] = useState(false);
  const [quickReplyFilter, setQuickReplyFilter] = useState("");
  const [addingQuickReply, setAddingQuickReply] = useState(false);
  const [newQuickReplyText, setNewQuickReplyText] = useState("");
  const [savingQuickReply, setSavingQuickReply] = useState(false);
  const [editingQuickReplyId, setEditingQuickReplyId] = useState<number | null>(null);
  const [editingQuickReplyText, setEditingQuickReplyText] = useState("");

  const loadQuickReplies = useCallback(async () => {
    setLoadingQuickReplies(true);
    try {
      const res = await fetch(`/api/zalo/quick-replies?account_id=${encodeURIComponent(accountId)}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      setQuickReplies(Array.isArray(data?.quick_replies) ? data.quick_replies : []);
    } catch {
      setQuickReplies([]);
    } finally {
      setLoadingQuickReplies(false);
    }
  }, [accountId]);

  useEffect(() => {
    if (!quickReplyOpen) return;
    setQuickReplyFilter("");
    setAddingQuickReply(false);
    setNewQuickReplyText("");
    setEditingQuickReplyId(null);
    void loadQuickReplies();
  }, [quickReplyOpen, loadQuickReplies]);

  const filteredQuickReplies = useMemo(() => {
    const q = quickReplyFilter.trim().toLowerCase();
    if (!q) return quickReplies;
    return quickReplies.filter((r) => r.content.toLowerCase().includes(q));
  }, [quickReplies, quickReplyFilter]);

  function handleInsertQuickReply(content: string) {
    setReplyText(replyText.trim() ? `${replyText.trimEnd()} ${content}` : content);
    setQuickReplyOpen(false);
    textareaRef.current?.focus();
  }

  async function handleAddQuickReply() {
    const content = newQuickReplyText.trim();
    if (!content) return;
    setSavingQuickReply(true);
    try {
      const res = await fetch("/api/zalo/quick-replies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account_id: accountId, content }),
      });
      const data = await res.json().catch(() => ({}));
      if (!data?.ok) throw new Error(data?.error || "Không lưu được tin nhắn nhanh");
      setNewQuickReplyText("");
      setAddingQuickReply(false);
      await loadQuickReplies();
    } catch (e) {
      if (typeof window !== "undefined") window.alert(e instanceof Error ? e.message : "Không lưu được tin nhắn nhanh");
    } finally {
      setSavingQuickReply(false);
    }
  }

  async function handleUpdateQuickReply(id: number) {
    const content = editingQuickReplyText.trim();
    if (!content) return;
    setSavingQuickReply(true);
    try {
      const res = await fetch(`/api/zalo/quick-replies/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const data = await res.json().catch(() => ({}));
      if (!data?.ok) throw new Error(data?.error || "Không lưu được thay đổi");
      setEditingQuickReplyId(null);
      await loadQuickReplies();
    } catch (e) {
      if (typeof window !== "undefined") window.alert(e instanceof Error ? e.message : "Không lưu được thay đổi");
    } finally {
      setSavingQuickReply(false);
    }
  }

  async function handleDeleteQuickReply(id: number) {
    setQuickReplies((prev) => prev.filter((r) => r.id !== id));
    try {
      await fetch(`/api/zalo/quick-replies/${id}`, { method: "DELETE" });
    } catch {
      await loadQuickReplies();
    }
  }

  function handleJumpFromSearch(msg: ZaloMessage) {
    if (!msg.ts && !msg.timestamp) return;
    onJumpToMessage?.(msg.ts ?? msg.timestamp ?? "", msg.message_id);
    setSearchOpen(false);
  }

  // Vừa "nhảy tới" 1 tin (từ tìm kiếm) — cuộn nó vào giữa khung nhìn. Không
  // cuộn nếu không có id (vd sau khi gửi tin mới, effect scroll-to-bottom
  // khác lo, xem effect theo messages.length bên dưới).
  useEffect(() => {
    if (!highlightedMessageId) return;
    const el = messageNodeRefs.current.get(highlightedMessageId);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightedMessageId]);

  const handleSendFriendRequest = useCallback(async () => {
    if (!conv || conv.thread_type !== "user") return;
    const uid = conv.thread_id || conv.conversation_id;
    setSendingFriendRequest(true);
    try {
      await zaloApi.sendFriendRequest(uid, accountId);
      // Cập nhật ngay tại chỗ thay vì đợi tra lại Zalo — trạng thái đôi khi
      // mất vài giây mới phản ánh đúng ở lượt getFriendStatus() kế tiếp, cập
      // nhật lạc quan ở đây để badge không đứng yên ở "Chưa kết bạn" dù đã
      // gửi lời mời thành công. `is_requested: true` = MÌNH vừa gửi (xem ghi
      // chú field-mapping ở FriendStatusBadge).
      setFriendStatus((prev) => ({ is_friend: prev?.is_friend ?? false, is_requesting: prev?.is_requesting ?? false, is_requested: true }));
    } catch (e) {
      if (typeof window !== "undefined") window.alert(e instanceof Error ? e.message : "Gửi lời mời kết bạn thất bại");
    } finally {
      setSendingFriendRequest(false);
    }
  }, [conv, accountId]);

  const handleAcceptFriendRequest = useCallback(async () => {
    if (!conv || conv.thread_type !== "user") return;
    const uid = conv.thread_id || conv.conversation_id;
    setAcceptingFriendRequest(true);
    try {
      await zaloApi.acceptFriendRequest(uid, accountId);
      setFriendStatus({ is_friend: true, is_requesting: false, is_requested: false });
    } catch (e) {
      if (typeof window !== "undefined") window.alert(e instanceof Error ? e.message : "Chấp nhận lời mời kết bạn thất bại");
    } finally {
      setAcceptingFriendRequest(false);
    }
  }, [conv, accountId]);

  const handleRecall = useCallback(
    async (msg: ZaloMessage) => {
      if (!conv || !msg.cli_msg_id) return;
      if (typeof window !== "undefined" && !window.confirm("Thu hồi tin nhắn này? Tin sẽ biến mất ở CẢ HAI bên trên Zalo, không thể hoàn tác.")) {
        return;
      }
      setRecallingId(msg.message_id);
      try {
        await zaloApi.recallMessage(conv.conversation_id, msg.message_id, msg.cli_msg_id, conv.thread_type, accountId);
        onMessageRecalled?.(msg.message_id);
      } catch (e) {
        if (typeof window !== "undefined") window.alert(e instanceof Error ? e.message : "Thu hồi tin nhắn thất bại");
      } finally {
        setRecallingId(null);
      }
    },
    [conv, accountId, onMessageRecalled]
  );

  // ── Thả cảm xúc ──────────────────────────────────────────────────────────
  const [reactingId, setReactingId] = useState<string | null>(null);
  const [reactionPickerFor, setReactionPickerFor] = useState<string | null>(null);
  // Menu "..." gom Copy/Chuyển tiếp/Thu hồi — cùng cơ chế 1-mở-tại-1-thời-điểm
  // với reactionPickerFor (yêu cầu người dùng 2026-09-21).
  const [actionMenuFor, setActionMenuFor] = useState<string | null>(null);

  const handleReact = useCallback(
    async (msg: ZaloMessage, reactionKey: string) => {
      if (!conv || !msg.cli_msg_id) return;
      setReactionPickerFor(null);
      setReactingId(msg.message_id);
      try {
        await zaloApi.reactToMessage(conv.conversation_id, msg.message_id, msg.cli_msg_id, reactionKey, conv.thread_type, accountId);
        onReactionApplied?.(msg.message_id, reactionKey === "none" ? null : reactionKey);
      } catch (e) {
        if (typeof window !== "undefined") window.alert(e instanceof Error ? e.message : "Thả cảm xúc thất bại");
      } finally {
        setReactingId(null);
      }
    },
    [conv, accountId, onReactionApplied]
  );

  // ── Chuyển tiếp THỦ CÔNG (ForwardMessageModal) ──────────────────────────
  const [forwardMsg, setForwardMsg] = useState<ZaloMessage | null>(null);
  const [forwarding, setForwarding] = useState(false);

  const handleConfirmForward = useCallback(
    async (targets: Array<{ thread_id: string; thread_type: "user" | "group"; conversation_id: string }>) => {
      if (!forwardMsg) return;
      setForwarding(true);
      try {
        const result = await zaloApi.forwardMessage(
          targets.map((t) => ({ thread_id: t.thread_id, thread_type: t.thread_type })),
          forwardMsg.content || "",
          forwardMsg.attachments,
          accountId
        );
        const okCount = result?.success?.length || 0;
        const failCount = result?.fail?.length || 0;
        if (typeof window !== "undefined") {
          window.alert(
            failCount === 0
              ? `Đã chuyển tiếp tới ${okCount} hội thoại.`
              : `Đã chuyển tiếp tới ${okCount}/${targets.length} hội thoại (${failCount} thất bại).`
          );
        }
        setForwardMsg(null);
      } catch (e) {
        if (typeof window !== "undefined") window.alert(e instanceof Error ? e.message : "Chuyển tiếp thất bại");
      } finally {
        setForwarding(false);
      }
    },
    [forwardMsg, accountId]
  );

  // Tra trạng thái bạn bè khi mở 1 hội thoại 'user' — nhóm không có khái niệm
  // này. Dùng conversation_id/thread_type (nguyên thuỷ) làm dep thay vì cả
  // object `conv` để không tra lại mỗi lần parent poll tin nhắn mới (conv là
  // object mới mỗi lần poll dù cùng 1 hội thoại).
  const convId = conv?.conversation_id;
  const convThreadType = conv?.thread_type;
  useEffect(() => {
    setFriendStatus(null);
    if (!conv || convThreadType !== "user") return;
    const uid = conv.thread_id || conv.conversation_id;
    let cancelled = false;
    zaloApi.getFriendStatus(uid, accountId).then((res) => {
      if (cancelled || !res || !res.ok) return;
      setFriendStatus({ is_friend: res.is_friend, is_requesting: res.is_requesting, is_requested: res.is_requested });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convId, convThreadType, accountId]);

  const displayMessages = useMemo(() => groupImageMessagesForDisplay(messages), [messages]);

  // Cuộn xuống cuối khi MỞ hội thoại (đổi convId) hoặc có tin mới (đổi
  // messages.length). Trước đây chỉ phụ thuộc messages.length — chuyển sang
  // hội thoại khác mà TÌNH CỜ cùng số lượng tin (rất hay gặp, vd đều đang
  // hiện 200 tin do trang API giới hạn) thì effect không chạy lại, khung chat
  // giữ nguyên vị trí cuộn của hội thoại TRƯỚC, trông như "kẹt lưng chừng"
  // (báo lỗi 2026-09-23). Giờ luôn cuộn lại mỗi khi convId đổi.
  const lastScrolledConvIdRef = useRef<string | undefined>(undefined);
  // Cuộn xuống đáy hội thoại — dùng trực tiếp scrollTop = scrollHeight thay
  // vì scrollIntoView vì scrollIntoView trên iOS Safari KHÔNG đáng tin cậy khi
  // bàn phím ảo xuất hiện/biến mất (viewport bị resize, scrollIntoView có thể
  // cuộn lệch hoặc không cuộn gì cả — bug báo 2026-10-13: "trên mobile tin nhắn
  // không cuộn tới cuối cùng"). scrollTop = scrollHeight LUÔN đặt đúng vị trí
  // bottom của container bất kể trạng thái bàn phím hay safe-area.
  const scrollToBottom = useCallback((smooth: boolean) => {
    const apply = () => {
      const el = messagesContainerRef.current;
      if (!el) return;
      if (smooth) {
        el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
      } else {
        el.scrollTop = el.scrollHeight;
      }
    };
    apply();
    // iOS Safari đôi khi tính scrollHeight sai trong cùng frame với DOM mới —
    // căn lại sau 1–2 frame layout (bàn phím, tin SSE, ảnh lazy).
    requestAnimationFrame(() => {
      apply();
      requestAnimationFrame(apply);
    });
  }, []);

  // iOS Safari thay đổi visual viewport khi thanh địa chỉ/bàn phím hiện hoặc ẩn.
  // Đợi layout hoàn tất rồi căn lại đáy nếu người dùng đang ở gần cuối hội thoại.
  useEffect(() => {
    const el = messagesContainerRef.current;
    if (!el || typeof window === "undefined") return;
    let frame = 0;
    const alignIfNearBottom = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const node = messagesContainerRef.current;
        if (!node) return;
        const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
        if (distance < 240) node.scrollTop = node.scrollHeight;
      });
    };
    window.addEventListener("resize", alignIfNearBottom);
    window.visualViewport?.addEventListener("resize", alignIfNearBottom);
    window.visualViewport?.addEventListener("scroll", alignIfNearBottom);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", alignIfNearBottom);
      window.visualViewport?.removeEventListener("resize", alignIfNearBottom);
      window.visualViewport?.removeEventListener("scroll", alignIfNearBottom);
    };
  }, [convId]);

  // Mọi thay đổi chiều cao nội dung (ảnh, sticker, bàn phím…) — bắt kịp đáy
  // tốt hơn chỉ dựa vào onLoad từng media.
  useEffect(() => {
    const el = messagesContainerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (distance < 240) el.scrollTop = el.scrollHeight;
    });
    ro.observe(el);
    const inner = el.firstElementChild;
    if (inner) ro.observe(inner);
    return () => ro.disconnect();
  }, [convId]);

  useEffect(() => {
    const isNewConv = lastScrolledConvIdRef.current !== convId;
    lastScrolledConvIdRef.current = convId;
    // Luôn cuộn tức thì — smooth trên mobile/iOS thường dừng lưng chừng khi
    // scrollHeight tăng (tin mới SSE, gửi tin, ảnh load).
    scrollToBottom(false);
    if (!isNewConv) return;
    // Mới MỞ hội thoại — ảnh/video trong các tin cũ còn chưa load xong lúc
    // cuộn lần đầu này sẽ đẩy chiều cao khung chat tăng dần ngay sau đó, khiến
    // vị trí "cuối" vừa cuộn tới không còn là đáy thật nữa. handleMediaLoad()
    // bên dưới chỉ tự cuộn lại khi đang cách đáy <200px — không đủ khi nhiều
    // ảnh cùng load dồn lúc mới mở. Cuộn lại thêm vài lần ngắn để bắt kịp.
    const timers = [100, 300, 700].map((ms) =>
      window.setTimeout(() => scrollToBottom(false), ms)
    );
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [convId, messages.length, scrollToBottom]);

  // Ảnh/video đính kèm chưa biết kích thước thật lúc cuộn ban đầu (load lazy/
  // async) — load xong SAU đó đẩy nội dung cao thêm, kéo vị trí đang xem lên
  // trên đáy thật dù mới vừa cuộn xuống cuối (cùng bug "kẹt lưng chừng" ở
  // trên). Chỉ tự cuộn lại NẾU đang gần đáy (< 200px) — tránh giật màn hình
  // của người đang chủ động cuộn lên xem tin nhắn cũ trong lúc ảnh bên dưới
  // vẫn tải.
  const handleMediaLoad = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom < 200) scrollToBottom(false);
  }, [scrollToBottom]);

  // Ảnh preview thật cho khay đính kèm đang chờ gửi (paste/chọn file/kéo
  // thả) — song song index với `pendingFiles`, null cho file không phải ảnh.
  // Object URL chỉ sống trong bộ nhớ trình duyệt, PHẢI tự revoke khi
  // pendingFiles đổi (thêm/bớt ảnh) hoặc rời trang, nếu không rò rỉ bộ nhớ.
  const pendingPreviews = useMemo(
    () => pendingFiles.map((f) => (f.type.startsWith("image/") ? URL.createObjectURL(f) : null)),
    [pendingFiles]
  );
  useEffect(() => {
    return () => {
      pendingPreviews.forEach((url) => url && URL.revokeObjectURL(url));
    };
  }, [pendingPreviews]);

  const handleFileSelect = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    let incoming = Array.from(files);
    if (pendingFiles.length + incoming.length > MAX_PENDING_FILES) {
      const allowed = Math.max(0, MAX_PENDING_FILES - pendingFiles.length);
      setFileLimitWarning(`Tối đa ${MAX_PENDING_FILES} file/tin nhắn — Zalo sẽ từ chối gửi nếu đính kèm nhiều hơn. Chỉ thêm được ${allowed} file nữa.`);
      incoming = incoming.slice(0, allowed);
      if (incoming.length === 0) return;
    }
    setPendingFiles([...pendingFiles, ...incoming]);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleFileSelect(e.dataTransfer.files);
  };

  /**
   * Dán ảnh (Ctrl+V) thẳng vào ô soạn tin — vd chụp màn hình rồi Ctrl+V ngay,
   * không cần lưu file ra đĩa trước rồi mới chọn qua hộp thoại "Đính kèm
   * file". Chỉ can thiệp khi clipboard THẬT SỰ có ảnh (`getAsFile()` khác
   * null) — dán TEXT bình thường thì để mặc định trình duyệt tự xử lý (chèn
   * vào textarea), không được `preventDefault()` trong trường hợp đó.
   */
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items || items.length === 0) return;
    const imageFiles: File[] = [];
    for (const item of Array.from(items)) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (imageFiles.length === 0) return;
    e.preventDefault();
    let allowedFiles = imageFiles;
    if (pendingFiles.length + imageFiles.length > MAX_PENDING_FILES) {
      const allowed = Math.max(0, MAX_PENDING_FILES - pendingFiles.length);
      setFileLimitWarning(`Tối đa ${MAX_PENDING_FILES} file/tin nhắn — Zalo sẽ từ chối gửi nếu đính kèm nhiều hơn. Chỉ thêm được ${allowed} ảnh nữa.`);
      allowedFiles = imageFiles.slice(0, allowed);
      if (allowedFiles.length === 0) return;
    }
    setPendingFiles([...pendingFiles, ...allowedFiles]);
  };

  // ── Gõ "@" để tag thành viên nhóm (chỉ áp dụng cho tin NHÓM — Zalo thật
  // cũng không cho tag trong chat riêng tư) ──────────────────────────────────
  const groupId = conv?.thread_type === "group" ? conv.thread_id || conv.conversation_id : null;
  const [groupMembers, setGroupMembers] = useState<MentionCandidate[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  // Cache theo group_id trong vòng đời component — quét thành viên là thao
  // tác NẶNG ở bridge (phân trang qua group/link/ginfo, có thể tới vài chục
  // giây với nhóm đông, xem getGroupMembers() ở zaloApiClient.ts), nên chỉ gọi
  // 1 LẦN/nhóm, không refetch mỗi lần mở lại popup mention.
  const membersCacheRef = useRef<Map<string, MentionCandidate[]>>(new Map());
  const [mentionRange, setMentionRange] = useState<{ start: number; query: string } | null>(null);
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0);

  // Đổi hội thoại → đóng popup đang mở (nếu có) + nạp lại cache của nhóm mới.
  useEffect(() => {
    setMentionRange(null);
    setMentionActiveIndex(0);
    setGroupMembers((groupId && membersCacheRef.current.get(groupId)) || []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conv?.conversation_id]);

  const ensureGroupMembersLoaded = useCallback(() => {
    if (!groupId || membersCacheRef.current.has(groupId) || loadingMembers) return;
    setLoadingMembers(true);
    zaloApi
      .getGroupMembers({ group_id: groupId }, accountId)
      .then((res) => {
        const list: MentionCandidate[] = res?.ok
          ? (res.members || []).map((m) => ({ uid: m.uid, display_name: m.display_name, avatar: m.avatar }))
          : [];
        membersCacheRef.current.set(groupId, list);
        setGroupMembers(list);
      })
      .catch(() => {
        // Best-effort — quét thành viên có thể lỗi (nhóm dạng Cộng đồng,
        // timeout...) nhưng KHÔNG chặn chọn "@All" (không cần danh sách
        // thành viên), nên không set lỗi chặn cả popup, chỉ để rỗng.
        membersCacheRef.current.set(groupId, []);
        setGroupMembers([]);
      })
      .finally(() => setLoadingMembers(false));
  }, [groupId, accountId, loadingMembers]);

  const handleComposeChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setReplyText(value);
    if (!groupId) {
      setMentionRange(null);
      return;
    }
    const range = findActiveMentionQuery(value, e.target.selectionStart ?? value.length);
    setMentionRange(range);
    setMentionActiveIndex(0);
    if (range) ensureGroupMembersLoaded();
  };

  const selectMention = (uid: string, token: string) => {
    if (!mentionRange) return;
    const { text, cursor } = insertMentionToken(replyText, mentionRange, token);
    setReplyText(text);
    setPendingMentions([...pendingMentions, { uid, token }]);
    setMentionRange(null);
    setMentionActiveIndex(0);
    // React cập nhật value bất đồng bộ — đợi 1 khung hình rồi mới đặt lại vị
    // trí con trỏ, nếu không setSelectionRange sẽ chạy trên value CŨ.
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(cursor, cursor);
    });
  };

  const mentionQuery = mentionRange?.query ?? "";
  const mentionShowAll = mentionRange ? matchesAllMention(mentionQuery) : false;
  const mentionFilteredMembers = mentionRange ? filterMentionCandidates(groupMembers, mentionQuery) : [];
  const mentionRowCount = (mentionShowAll ? 1 : 0) + mentionFilteredMembers.length;

  const headerBar = (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[#eef1f5] bg-[#fafcff] px-6 py-3.5">
      <div className="flex min-w-0 items-center gap-3.5">
        {conv ? (
          <>
            {onBack ? (
              <button
                type="button"
                onClick={onBack}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[#dce1e8] bg-white text-[#4f5f71] transition hover:bg-[#f1f4f8] lg:hidden"
                aria-label="Quay lại danh sách hội thoại"
                title="Quay lại hội thoại"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            ) : null}
            <Avatar src={conv.avatar_url} name={conv.conversation_name} className="h-[42px] w-[42px] text-base" />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div className="truncate text-base font-semibold text-[#0a1a2b]">{conv.conversation_name || "Không tên"}</div>
                {conv.thread_type === "user" && friendStatus ? <FriendStatusBadge status={friendStatus} /> : null}
                {/* Chỉ hiện khi status THẬT SỰ là "chưa kết bạn" (is_friend
                    false, không đang chờ 2 chiều) — cho gửi lời mời ngay tại
                    đây thay vì phải quay lại ô tìm số điện thoại. */}
                {conv.thread_type === "user" &&
                  friendStatus &&
                  friendStatus.is_friend === false &&
                  friendStatus.is_requesting !== true &&
                  friendStatus.is_requested !== true ? (
                  <button
                    type="button"
                    onClick={() => void handleSendFriendRequest()}
                    disabled={sendingFriendRequest}
                    title={`Gửi lời mời kết bạn tới ${conv.conversation_name || "người này"}`}
                    className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[#c62828] px-2 py-0.5 text-[11px] font-medium text-[#c62828] transition hover:bg-red-50 disabled:opacity-60"
                  >
                    {sendingFriendRequest ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserPlus className="h-3 w-3" />}
                    Kết bạn
                  </button>
                ) : null}
                {/* HỌ đã gửi lời mời cho mình (is_requesting=true, xem ghi
                    chú field-mapping ở FriendStatusBadge) — cho chấp nhận
                    ngay tại đây thay vì phải mở app Zalo thật. */}
                {conv.thread_type === "user" && friendStatus && friendStatus.is_friend !== true && friendStatus.is_requesting === true ? (
                  <button
                    type="button"
                    onClick={() => void handleAcceptFriendRequest()}
                    disabled={acceptingFriendRequest}
                    title={`Chấp nhận lời mời kết bạn từ ${conv.conversation_name || "người này"}`}
                    className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[#1a9c46] px-2 py-0.5 text-[11px] font-medium text-[#1a9c46] transition hover:bg-[#e7f7ec] disabled:opacity-60"
                  >
                    {acceptingFriendRequest ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                    Chấp nhận
                  </button>
                ) : null}
              </div>
              <div className="flex items-center gap-1.5 text-xs text-[#6b7a8d]">
                <span className="inline-block h-2 w-2 rounded-full bg-[#31b545]" />
                Đang hoạt động
              </div>
            </div>
          </>
        ) : (
          <div className="min-w-0">
            <div className="text-base font-semibold text-[#0a1a2b]">Zalo Chat</div>
            <div className="text-xs text-[#6b7a8d]">Chọn hội thoại bên trái</div>
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        {/* Ẩn hẳn trên mobile (2026-10-03, báo lỗi: cụm nút ZaloAuthCard + nút
            Thông báo chồng lấn/rối trên màn hẹp khi mở 1 hội thoại cụ thể) —
            cụm này vốn là công cụ debug/quản trị (tải extension, reconnect,
            đăng nhập lại...), không cần thiết cho người dùng mobile đang đọc
            chat. Vẫn hiện bình thường từ lg trở lên (desktop). */}
        <div className="hidden items-center gap-1.5 lg:flex">{headerActions}</div>
        {conv && onSearchMessages ? (
          <button
            type="button"
            onClick={() => setSearchOpen((v) => !v)}
            title="Tìm tin nhắn trong hội thoại này"
            className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition ${searchOpen ? "border-[#c62828] bg-red-50 text-[#c62828]" : "border-[#dce1e8] bg-transparent text-[#4f5f71] hover:bg-[#f1f4f8]"
              }`}
          >
            <SearchIcon className="h-3.5 w-3.5" />
          </button>
        ) : null}
        {conv ? (
          <button
            type="button"
            onClick={() => {
              setGalleryInitialMessageId(null);
              setGalleryOpen(true);
            }}
            title="Xem ảnh đã trao đổi trong hội thoại này"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#dce1e8] bg-transparent text-[#4f5f71] transition hover:bg-[#f1f4f8]"
          >
            <Images className="h-3.5 w-3.5" />
          </button>
        ) : null}
        {conv ? (
          <button
            onClick={onSync}
            disabled={loading}
            className="inline-flex items-center gap-1 whitespace-nowrap rounded-[30px] border border-[#dce1e8] bg-transparent px-3.5 py-1 text-xs font-medium text-[#2f3e50] transition hover:bg-[#f1f4f8] disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 text-[#6b7a8d] ${loading ? "animate-spin" : ""}`} />
            Làm mới
          </button>
        ) : null}
      </div>
    </div>
  );

  const searchBar =
    conv && searchOpen ? (
      <div className="relative shrink-0 border-b border-[#eef1f5] bg-white px-6 py-2.5">
        <div className="flex items-center gap-2 rounded-full border border-[#dce1e8] bg-[#f8fafc] px-3.5 py-1.5 transition focus-within:border-[#c62828] focus-within:bg-white focus-within:shadow-[0_0_0_3px_rgba(0,104,255,0.08)]">
          <SearchIcon className="h-3.5 w-3.5 shrink-0 text-[#8a9aa8]" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setSearchOpen(false);
            }}
            placeholder={`Tìm tin nhắn trong "${conv.conversation_name || "hội thoại này"}"...`}
            className="flex-1 bg-transparent py-1 text-sm text-[#0a1a2b] outline-none placeholder:text-[#a0b0c0]"
          />
          {searching ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[#8a9aa8]" /> : null}
          <button type="button" onClick={() => setSearchOpen(false)} className="shrink-0 text-[#8a9aa8] hover:text-[#4f5f71]">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {searchQuery.trim() ? (
          <div className="absolute inset-x-6 top-[calc(100%-2px)] z-20 max-h-80 overflow-y-auto rounded-b-xl border border-t-0 border-[#dce1e8] bg-white shadow-lg">
            {searchResults.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs text-[#8a9aa8]">
                {searching ? "Đang tìm..." : searchDone ? `Không tìm thấy tin nhắn nào chứa "${searchQuery.trim()}".` : ""}
              </div>
            ) : (
              searchResults.map((r) => {
                const preview = r.content || (r.msg_kind && r.msg_kind !== "text" ? `[${r.msg_kind}]` : "");
                return (
                  <button
                    key={r.message_id || `${r.ts}-${r.sender_id}`}
                    type="button"
                    onClick={() => handleJumpFromSearch(r)}
                    className="flex w-full flex-col items-start gap-0.5 border-b border-[#f1f4f8] px-4 py-2.5 text-left transition last:border-b-0 hover:bg-[#f5f9ff]"
                  >
                    <div className="flex w-full items-center justify-between gap-2">
                      <span className="truncate text-[12.5px] font-semibold text-[#0a1a2b]">{r.is_sent ? "Bạn" : r.sender_name || conv.conversation_name}</span>
                      <span className="shrink-0 text-[11px] text-[#8a9aa8]">{formatTime(r.timestamp || r.time_text)}</span>
                    </div>
                    <span className="line-clamp-1 w-full text-[13px] text-[#4f5f71]">{highlightMatch(preview, searchQuery.trim())}</span>
                  </button>
                );
              })
            )}
          </div>
        ) : null}
      </div>
    ) : null;

  if (!conv) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white">
        {headerBar}
        <div className="flex flex-1 flex-col items-center justify-center gap-1.5 bg-[#fafcff]">
          <MessageCircle className="mb-1 h-12 w-12 text-[#dce1e8]" />
          <div className="text-[15px] font-medium text-[#6b7a8d]">Chọn một hội thoại để bắt đầu nhắn tin</div>
          <div className="text-[13px] text-[#8a9aa8]">Tin nhắn sẽ hiển thị tại đây</div>
        </div>
        <div className="flex shrink-0 items-center gap-3 border-t border-[#eef1f5] bg-white px-6 py-3 opacity-50">
          <div className="flex flex-1 items-center rounded-[30px] bg-[#f1f4f8] px-4 py-2.5 text-sm text-[#a0b0c0]">Nhập tin nhắn...</div>
          <div className="grid h-11 w-11 place-items-center rounded-full bg-gradient-to-r from-[#c62828] to-[#dc2626] text-white">
            <Send className="h-[18px] w-[18px]" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white">
        {headerBar}
        {searchBar}

        {/* overflow-x-hidden TƯỜNG MINH — chỉ set overflow-y-auto thì trình
          duyệt tự suy overflow-x thành 'auto' theo spec CSS (2 trục không thể
          1 bên visible 1 bên không), khiến khung tin nhắn KÉO NGANG được nếu
          có 1 hàng tin nào đó (nhất là bong bóng nhóm — có avatar + tên +
          nút "⋮" mới thêm) lỡ rộng hơn khung 1 chút, kéo lộ khoảng trắng rồi
          bật lại đúng vị trí (báo lỗi 2026-09-22: "kéo qua kéo về bị vào
          khoảng trắng ... nhảy về đúng đoạn chat thật"). Chat không bao giờ
          cần cuộn ngang nên khoá hẳn trục X. */}
        <div ref={messagesContainerRef} className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain bg-[#fafcff] p-5">
          {loading && messages.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-[#6b7a8d]">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Đang tải tin nhắn...
            </div>
          ) : messages.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-[#8a9aa8]">Chưa có tin nhắn nào. Hãy bắt đầu cuộc trò chuyện!</div>
          ) : (
            <div className="space-y-3">
              {displayMessages.map((m, idx) => {
                const tsRaw = m.timestamp ? new Date(m.timestamp).getTime() : 0;
                const mId = m.message_id ? String(m.message_id) : `${Number.isFinite(tsRaw) ? tsRaw : idx}|${m.sender_id ?? ""}|${(m.content ?? "").slice(0, 50)}`;
                return (
                  <div
                    key={mId}
                    ref={(el) => {
                      if (el) messageNodeRefs.current.set(mId, el);
                      else messageNodeRefs.current.delete(mId);
                    }}
                  >
                    <MessageBubble
                      msg={m}
                      onRecall={handleRecall}
                      recalling={recallingId === m.message_id}
                      highlighted={highlightedMessageId === mId}
                      onReact={handleReact}
                      reacting={reactingId === m.message_id}
                      pickerOpen={reactionPickerFor === mId}
                      onTogglePicker={() => setReactionPickerFor((prev) => (prev === mId ? null : mId))}
                      onSwipeReply={onStartReply}
                      onJumpToQuote={onJumpToMessage}
                      onForward={conversations && conversations.length > 0 ? setForwardMsg : undefined}
                      onContactMessage={onContactMessage}
                      menuOpen={actionMenuFor === mId}
                      onToggleMenu={() => setActionMenuFor((prev) => (prev === mId ? null : mId))}
                      onMediaLoad={handleMediaLoad}
                      onOpenGallery={(messageId) => {
                        setGalleryInitialMessageId(messageId);
                        setGalleryOpen(true);
                      }}
                    />
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {replyingTo ? (
          <div className="flex shrink-0 items-center gap-2 border-t border-[#eef1f5] bg-[#f5f9ff] px-4 py-2">
            <Reply className="h-3.5 w-3.5 shrink-0 text-[#c62828]" />
            <div className="min-w-0 flex-1 border-l-2 border-[#c62828] pl-2">
              <div className="truncate text-[11.5px] font-semibold text-[#c62828]">
                Trả lời {replyingTo.is_sent ? "chính bạn" : replyingTo.sender_name || "tin nhắn"}
              </div>
              <div className="truncate text-[12.5px] text-[#4f5f71]">
                {replyingTo.content?.trim()
                  ? truncatePreview(replyingTo.content)
                  : replyingTo.msg_kind && replyingTo.msg_kind !== "text"
                    ? `[${replyingTo.msg_kind}]`
                    : "Tin nhắn"}
              </div>
            </div>
            <button type="button" onClick={onCancelReply} className="shrink-0 text-[#8a9aa8] hover:text-[#4f5f71]" title="Huỷ trả lời">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : null}

        {fileLimitWarning ? (
          <div className="flex shrink-0 items-center justify-between gap-2 border-t border-amber-200 bg-amber-50 px-3 py-1.5 text-[12px] text-amber-800">
            <span>{fileLimitWarning}</span>
            <button type="button" onClick={() => setFileLimitWarning(null)} className="shrink-0 text-amber-500 hover:text-amber-700">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : null}

        {pendingFiles.length > 0 && (
          <div className="flex shrink-0 flex-wrap items-end gap-2 border-t border-[#eef1f5] bg-[#fafcff] p-2.5">
            {pendingFiles.map((f, i) => {
              const previewUrl = pendingPreviews[i];
              if (previewUrl) {
                return (
                  <div key={i} className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-[#dce1e8] bg-white">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={previewUrl} alt={f.name} className="h-full w-full object-cover" />
                    <button
                      onClick={() => setPendingFiles(pendingFiles.filter((_, idx) => idx !== i))}
                      title="Bỏ ảnh"
                      className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5 text-white transition hover:bg-black/80"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                );
              }
              return (
                <div key={i} className="flex items-center gap-1.5 rounded-[30px] border border-[#dce1e8] bg-white px-3 py-1 text-xs text-[#2f3e50]">
                  <Paperclip className="h-3.5 w-3.5 text-[#6b7a8d]" />
                  <span className="max-w-[140px] truncate">{f.name}</span>
                  <button onClick={() => setPendingFiles(pendingFiles.filter((_, idx) => idx !== i))} className="ml-1 text-[#8a9aa8] hover:text-red-500">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <div
          className={`flex shrink-0 w-full items-center gap-3 border-t border-[#eef1f5] px-6 py-3 pb-[max(12px,env(safe-area-inset-bottom))] ${dragOver ? "bg-red-50" : "bg-white"}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          {mentionRange ? (
            <MentionPicker
              query={mentionQuery}
              members={groupMembers}
              loading={loadingMembers}
              activeIndex={mentionActiveIndex}
              onActiveIndexChange={setMentionActiveIndex}
              onSelectAll={() => selectMention(ALL_MENTION_UID, ALL_MENTION_TOKEN)}
              onSelectMember={(m) => selectMention(m.uid, `@${m.display_name || m.uid}`)}
            />
          ) : null}
          {stickerPickerOpen ? (
            <div className="absolute bottom-full left-6 z-20 mb-2 w-72 rounded-xl border border-[#dce1e8] bg-white p-3 shadow-lg">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-[#2f3e50]">Gửi nhãn dán</span>
                <button type="button" onClick={() => setStickerPickerOpen(false)} className="text-[#8a9aa8] hover:text-[#4f5f71]">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="flex items-center gap-2 rounded-full border border-[#dce1e8] bg-[#f8fafc] px-3 py-1.5">
                <SearchIcon className="h-3.5 w-3.5 shrink-0 text-[#8a9aa8]" />
                <input
                  autoFocus
                  type="text"
                  value={stickerQuery}
                  onChange={(e) => setStickerQuery(e.target.value)}
                  placeholder="Tìm nhãn dán, vd: haha, chào..."
                  className="w-full flex-1 bg-transparent py-0.5 text-sm text-[#0a1a2b] outline-none placeholder:text-[#a0b0c0]"
                />
                {stickerSearching ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[#8a9aa8]" /> : null}
              </div>
              <div className="mt-2 grid max-h-56 grid-cols-4 gap-1.5 overflow-y-auto">
                {stickerResults.length === 0 && !stickerSearching && stickerQuery.trim() ? (
                  <div className="col-span-4 py-4 text-center text-[11px] text-[#8a9aa8]">Không tìm thấy nhãn dán nào.</div>
                ) : (
                  stickerResults.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      disabled={sendingSticker}
                      onClick={() => void handleSendSticker(s)}
                      className="grid aspect-square place-items-center rounded-lg p-1 transition hover:bg-[#f1f4f8] disabled:opacity-50"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={s.url || ""} alt="" className="max-h-full max-w-full" />
                    </button>
                  ))
                )}
              </div>
            </div>
          ) : null}
          {quickReplyOpen ? (
            <div className="absolute bottom-full left-6 z-20 mb-2 w-80 rounded-xl border border-[#dce1e8] bg-white p-3 shadow-lg">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-[#2f3e50]">Tin nhắn nhanh</span>
                <button type="button" onClick={() => setQuickReplyOpen(false)} className="text-[#8a9aa8] hover:text-[#4f5f71]">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="flex items-center gap-2 rounded-full border border-[#dce1e8] bg-[#f8fafc] px-3 py-1.5">
                <SearchIcon className="h-3.5 w-3.5 shrink-0 text-[#8a9aa8]" />
                <input
                  autoFocus
                  type="text"
                  value={quickReplyFilter}
                  onChange={(e) => setQuickReplyFilter(e.target.value)}
                  placeholder="Tìm tin nhắn nhanh..."
                  className="w-full flex-1 bg-transparent py-0.5 text-sm text-[#0a1a2b] outline-none placeholder:text-[#a0b0c0]"
                />
              </div>
              <div className="mt-2 max-h-64 space-y-1 overflow-y-auto">
                {loadingQuickReplies ? (
                  <div className="flex items-center justify-center gap-1.5 py-4 text-[11px] text-[#8a9aa8]">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Đang tải...
                  </div>
                ) : filteredQuickReplies.length === 0 ? (
                  <div className="py-4 text-center text-[11px] text-[#8a9aa8]">
                    {quickReplies.length === 0 ? "Chưa có tin nhắn nhanh nào." : "Không tìm thấy."}
                  </div>
                ) : (
                  filteredQuickReplies.map((r) =>
                    editingQuickReplyId === r.id ? (
                      <div key={r.id} className="rounded-lg border border-[#dce1e8] p-2">
                        <textarea
                          autoFocus
                          value={editingQuickReplyText}
                          onChange={(e) => setEditingQuickReplyText(e.target.value)}
                          rows={2}
                          className="w-full resize-none rounded-md border border-[#dce1e8] px-2 py-1 text-[13px] text-[#0a1a2b] outline-none focus:border-[#c62828]"
                        />
                        <div className="mt-1.5 flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setEditingQuickReplyId(null)}
                            className="rounded-full px-2 py-1 text-[11px] text-[#6b7a8d] hover:bg-[#f1f4f8]"
                          >
                            Huỷ
                          </button>
                          <button
                            type="button"
                            disabled={savingQuickReply || !editingQuickReplyText.trim()}
                            onClick={() => void handleUpdateQuickReply(r.id)}
                            className="rounded-full bg-[#0068ff] px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-50"
                          >
                            Lưu
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div key={r.id} className="group flex items-start gap-1.5 rounded-lg px-2 py-1.5 hover:bg-[#f1f4f8]">
                        <button
                          type="button"
                          onClick={() => handleInsertQuickReply(r.content)}
                          className="min-w-0 flex-1 whitespace-pre-wrap break-words text-left text-[13px] text-[#0a1a2b]"
                        >
                          {r.content}
                        </button>
                        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
                          <button
                            type="button"
                            title="Sửa"
                            onClick={() => {
                              setEditingQuickReplyId(r.id);
                              setEditingQuickReplyText(r.content);
                            }}
                            className="rounded p-1 text-[#8a9aa8] hover:bg-white hover:text-[#c62828]"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            title="Xoá"
                            onClick={() => void handleDeleteQuickReply(r.id)}
                            className="rounded p-1 text-[#8a9aa8] hover:bg-white hover:text-red-500"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    )
                  )
                )}
              </div>
              <div className="mt-2 border-t border-[#eef1f5] pt-2">
                {addingQuickReply ? (
                  <div>
                    <textarea
                      autoFocus
                      value={newQuickReplyText}
                      onChange={(e) => setNewQuickReplyText(e.target.value)}
                      rows={2}
                      placeholder="Nội dung tin nhắn nhanh..."
                      className="w-full resize-none rounded-md border border-[#dce1e8] px-2 py-1 text-[13px] text-[#0a1a2b] outline-none focus:border-[#c62828]"
                    />
                    <div className="mt-1.5 flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setAddingQuickReply(false);
                          setNewQuickReplyText("");
                        }}
                        className="rounded-full px-2 py-1 text-[11px] text-[#6b7a8d] hover:bg-[#f1f4f8]"
                      >
                        Huỷ
                      </button>
                      <button
                        type="button"
                        disabled={savingQuickReply || !newQuickReplyText.trim()}
                        onClick={() => void handleAddQuickReply()}
                        className="rounded-full bg-[#0068ff] px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-50"
                      >
                        {savingQuickReply ? <Loader2 className="h-3 w-3 animate-spin" /> : "Thêm"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setAddingQuickReply(true)}
                    className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-[#dce1e8] py-1.5 text-[12px] font-medium text-[#c62828] hover:bg-[#f1f4f8]"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Thêm tin nhắn nhanh
                  </button>
                )}
              </div>
            </div>
          ) : null}
          <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(e) => handleFileSelect(e.target.files)} />
          <button
            type="button"
            onClick={() => setQuickReplyOpen((v) => !v)}
            className={`shrink-0 transition hover:text-[#c62828] ${quickReplyOpen ? "text-[#c62828]" : "text-[#8a9aa8]"}`}
            title="Tin nhắn nhanh"
          >
            <Zap className="h-[18px] w-[18px]" />
          </button>
          <button
            type="button"
            onClick={() => setStickerPickerOpen((v) => !v)}
            className={`shrink-0 transition hover:text-[#c62828] ${stickerPickerOpen ? "text-[#c62828]" : "text-[#8a9aa8]"}`}
            title="Gửi nhãn dán"
          >
            <StickerIcon className="h-[18px] w-[18px]" />
          </button>
          <div className="flex flex-1 items-center gap-1.5 rounded-[30px] border border-transparent bg-[#f1f4f8] px-4 transition focus-within:border-[#c62828] focus-within:bg-white">
            <textarea
              ref={textareaRef}
              value={replyText}
              onChange={handleComposeChange}
              onPaste={handlePaste}
              onKeyDown={(e) => {
                if (mentionRange) {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setMentionActiveIndex((i) => (mentionRowCount === 0 ? 0 : (i + 1) % mentionRowCount));
                    return;
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setMentionActiveIndex((i) => (mentionRowCount === 0 ? 0 : (i - 1 + mentionRowCount) % mentionRowCount));
                    return;
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setMentionRange(null);
                    return;
                  }
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (mentionRowCount === 0) {
                      setMentionRange(null);
                    } else if (mentionShowAll && mentionActiveIndex === 0) {
                      selectMention(ALL_MENTION_UID, ALL_MENTION_TOKEN);
                    } else {
                      const member = mentionFilteredMembers[mentionShowAll ? mentionActiveIndex - 1 : mentionActiveIndex];
                      if (member) selectMention(member.uid, `@${member.display_name || member.uid}`);
                    }
                    return;
                  }
                  // Các phím khác (gõ chữ, Backspace, mũi tên trái/phải...) rơi
                  // qua bình thường — onChange sẽ tự cập nhật lại query.
                  return;
                }
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void onSend();
                }
              }}
              onBlur={() => {
                // Trễ 1 nhịp để onClick trên MentionPicker (nút dùng onMouseDown
                // preventDefault nên bình thường không kích blur) vẫn kịp chạy
                // nếu trình duyệt nào đó vẫn fire blur trước click.
                setTimeout(() => setMentionRange(null), 120);
              }}
              placeholder="Nhập tin nhắn..."
              rows={1}
              className="max-h-24 flex-1 resize-none bg-transparent py-2.5 text-sm text-[#0a1a2b] outline-none placeholder:text-[#a0b0c0]"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={pendingFiles.length >= MAX_PENDING_FILES}
              className="shrink-0 text-[#8a9aa8] transition hover:text-[#c62828] disabled:cursor-not-allowed disabled:opacity-40"
              title={pendingFiles.length >= MAX_PENDING_FILES ? `Đã đạt tối đa ${MAX_PENDING_FILES} file/tin nhắn` : "Đính kèm file"}
            >
              <Paperclip className="h-[18px] w-[18px]" />
            </button>
          </div>
          <button
            onClick={onSend}
            disabled={sending || (!replyText.trim() && pendingFiles.length === 0)}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gradient-to-r from-[#c62828] to-[#dc2626] text-white transition hover:from-[#b71c1c] hover:to-[#c62828] disabled:opacity-50"
            title="Gửi"
          >
            {sending ? <Loader2 className="h-[18px] w-[18px] animate-spin" /> : <Send className="h-[18px] w-[18px]" />}
          </button>
        </div>
      </div>
      {forwardMsg && conversations ? (
        <ForwardMessageModal
          conversations={conversations}
          excludeConversationId={conv?.conversation_id}
          preview={previewText({ text: forwardMsg.content, kind: forwardMsg.msg_kind, attachments: forwardMsg.attachments })}
          sending={forwarding}
          onCancel={() => setForwardMsg(null)}
          onConfirm={handleConfirmForward}
        />
      ) : null}
      {galleryOpen ? (
        <MediaGalleryModal
          key={conv.conversation_id}
          open={galleryOpen}
          onClose={() => setGalleryOpen(false)}
          conversationId={conv.conversation_id}
          accountId={accountId}
          conversationName={conv.conversation_name}
          initialMessageId={galleryInitialMessageId}
        />
      ) : null}
    </>
  );
}
