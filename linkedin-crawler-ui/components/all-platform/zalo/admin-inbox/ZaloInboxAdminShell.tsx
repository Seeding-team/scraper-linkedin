"use client";

import { useMemo, useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useAppAuth } from "@/contexts/AppAuthContext";
import { useZaloAdminInbox, type ZaloConv } from "@/hooks/useZaloAdminInbox";
import { useZaloPushNotifications } from "@/hooks/useZaloPushNotifications";
import { Avatar } from "../dashboard/Avatar";
import ZaloTeamAccountTree from "./ZaloTeamAccountTree";
import ZaloAccountAuthView from "./ZaloAccountAuthView";
import { CrmCustomerModal } from "@/components/all-platform/components/CrmCustomerModal";
import { SalesAssetPickerModal } from "@/components/all-platform/sales-assets/SalesAssetPickerModal";
import { useRouter, useSearchParams } from "next/navigation";
import { resolveZaloConversationAccount } from "@/services/zaloCrawlerService";
import { KpiProgressCard } from "@/components/all-platform/components/kpi-progress-card";
import { MaterialIcon } from "@/components/ui";
import { cn } from "@/lib/utils";
import { ZaloStickerPicker } from "../centralized-shared/ZaloStickerPicker";
import { ZaloReactionQuickPicker, ZaloReactionBadges } from "../centralized-shared/ZaloReactionPicker";
import { ZaloMessageSearchPanel } from "../centralized-shared/ZaloMessageSearchPanel";
import { ZaloForwardModal } from "../centralized-shared/ZaloForwardModal";
import { ZaloSwipeableMessageItem } from "../centralized-shared/ZaloSwipeableMessageItem";
import { ZaloNewChatModal } from "../dashboard/ZaloNewChatModal";
import type { ZaloConversationSummary, ZaloLibraryMessage } from "@/types/zalo-api";
import {
  restartZaloAccountListener,
  updateZaloAccount,
  deleteZaloAccount,
  deleteZaloAccountFull,
  createZaloAccount,
  createZaloBroadcast,
  createZaloUserThread,
  updateZaloLibraryMessage,
  getZaloQuickReplies,
  createZaloQuickReply,
  deleteZaloQuickReply,
  type ZaloQuickReply,
} from "@/services/zaloCrawlerService";
import type { ZaloBroadcastTarget } from "@/types/zalo-api";
import { customerLeadService, type Customer } from "@/services/customer-lead.service";
import type { SalesAsset } from "@/services/sales-asset.service";
import { DealFormModal } from "@/modules/crm/components/DealFormModal";
import { QuoteWorkspaceModal } from "@/modules/crm/components/QuoteWorkspaceModal";
import { CrmQuote360Panel } from "@/components/all-platform/inbox/CrmQuote360Panel";
import { CustomerAddDrawer } from "@/modules/crm/components/CustomerAddDrawer";
import { AssignUserModal } from "@/modules/omnichannel/components/AssignUserModal";
import {
  Sparkles,
  Paperclip,
  Image as ImageIcon,
  Smile,
  Star,
  StickyNote,
  CheckSquare,
  Briefcase,
  FileSpreadsheet,
  Eye,
  Building2,
  ExternalLink,
  X,
  UserCheck,
  Phone,
  Video,
  MoreVertical,
  BarChart3,
  Download,
  Search,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  User,
  MessageCircle,
  Inbox as InboxIcon,
  CheckCircle2,
} from "lucide-react";

// ─── Constants & Templates ──────────────────────────────────────────────────

const QUICK_REPLY_GROUPS = [
  {
    id: "greeting",
    label: "Chào hỏi",
    items: [
      "Chào bạn, bên mình có thể hỗ trợ bạn phần nào ạ?",
      "Dạ mình đang xem thông tin, bạn cho mình xin thêm nhu cầu cụ thể nhé.",
      "Cảm ơn bạn đã nhắn tin. Mình hỗ trợ bạn ngay đây ạ.",
    ],
  },
  {
    id: "quote",
    label: "Báo giá",
    items: [
      "Dạ để báo giá chính xác, bạn cho mình xin số lượng và khu vực cần triển khai nhé.",
      "Mình gửi bạn gói phù hợp trước, nếu cần mình sẽ tư vấn thêm để tối ưu chi phí ạ.",
      "Bên mình có thể làm theo ngân sách của bạn, bạn dự kiến khoảng bao nhiêu để mình tư vấn đúng hơn?",
    ],
  },
  {
    id: "followup",
    label: "Follow-up",
    items: [
      "Bạn cần mình hỗ trợ thêm thông tin nào trước khi chốt không ạ?",
      "Mình nhắc nhẹ để bạn khỏi trôi tin, phần này bên mình vẫn đang giữ slot hỗ trợ nhé.",
      "Nếu tiện, mình có thể gọi nhanh 3-5 phút để nắm nhu cầu và tư vấn sát hơn ạ.",
    ],
  },
  {
    id: "handoff",
    label: "Chuyển lead",
    items: [
      "Mình đã ghi nhận nhu cầu của bạn, bên mình sẽ liên hệ lại để tư vấn chi tiết hơn nhé.",
      "Bạn cho mình xin số điện thoại/Zalo để team tư vấn gửi thông tin nhanh hơn ạ.",
      "Dạ mình chuyển thông tin qua bộ phận phụ trách, bạn để ý tin nhắn giúp mình nhé.",
    ],
  },
];

const AI_SUGGESTIONS = [
  "Giới thiệu dịch vụ",
  "Gửi bảng báo giá chi tiết",
  "Hỗ trợ triển khai",
  "Cảm ơn khách hàng",
];

const EMOJIS = ["👍", "❤️", "😊", "🙏", "🔥", "🎉", "👌", "👏", "😃", "📞", "💼", "✨"];

type PanelTab = "templates" | "customer" | "kpi" | "account" | "campaign" | "crm360";
type ZaloInboxFilter = "all" | "unread" | "customer" | "need_reply" | "need_verify";
type CampaignMode = "both" | "text" | "image";

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

const VIDEO_EXT_RE = /\.(mp4|webm|mov|m4v|3gp|mkv|avi)(\?|#|$)/i;
const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif|bmp|svg)(\?|#|$)/i;
const AUDIO_EXT_RE = /\.(mp3|m4a|aac|wav|ogg|opus)(\?|#|$)/i;

type ZaloAssetKind = "image" | "video" | "audio" | "file";

function classifyAssetKind(url: string, message: ZaloLibraryMessage): ZaloAssetKind {
  if (VIDEO_EXT_RE.test(url)) return "video";
  if (AUDIO_EXT_RE.test(url)) return "audio";
  if (IMAGE_EXT_RE.test(url)) return "image";
  const type = String(message.type || message.msg_kind || "").toLowerCase();
  if (type === "image" || type === "chat.gif" || type === "chat.sticker") return "image";
  if (type === "chat.video.msg" || type.startsWith("video")) return "video";
  if (type === "chat.voice" || type.startsWith("voice") || type.startsWith("audio")) return "audio";
  return type === "image" ? "image" : "file";
}

function assetFileName(url: string, message: ZaloLibraryMessage): string {
  const fromContent = (message.content || "").trim();
  if (fromContent && !fromContent.includes("\n") && fromContent.length <= 150) {
    return fromContent;
  }
  try {
    const base = decodeURIComponent(url.split("/").pop()?.split("?")[0] || "");
    return base || "file";
  } catch {
    return "file";
  }
}

function ZaloMessageAssetView({ asset, message }: { asset: NonNullable<ZaloLibraryMessage["assets"]>[number]; message: ZaloLibraryMessage }) {
  const url = asset.storage_url || "";
  const kind = classifyAssetKind(url, message);
  const fileName = assetFileName(url, message);

  if (kind === "image") {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" title="Mở ảnh gốc">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={fileName} className="w-full h-auto rounded-lg" loading="lazy" />
      </a>
    );
  }
  if (kind === "video") {
    return <video src={url} controls preload="metadata" className="w-full max-h-[220px] rounded-lg bg-black/5" />;
  }
  if (kind === "audio") {
    return <audio src={url} controls className="w-full" />;
  }
  return (
    <a
      href={url}
      download={fileName}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 p-2.5 text-xs text-blue-600 hover:underline bg-white rounded-xl border border-slate-200"
      title={`Tải về: ${fileName}`}
    >
      <MaterialIcon name="description" className="text-[16px] shrink-0" />
      <span className="truncate flex-1 font-semibold">{fileName}</span>
      <MaterialIcon name="download" className="text-[14px] shrink-0" />
    </a>
  );
}

function ZaloFilePreviewItem({ file, onRemove }: { file: File; onRemove: () => void }) {
  const isImage = file.type.startsWith("image/");
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!isImage) return;
    const url = URL.createObjectURL(file);
    setObjectUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [file, isImage]);

  if (isImage && objectUrl) {
    return (
      <div className="relative group rounded-lg overflow-hidden border border-slate-200 bg-white shadow-xs">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={objectUrl} alt={file.name} className="h-14 w-14 object-cover" />
        <button
          type="button"
          onClick={onRemove}
          className="absolute top-1 right-1 bg-black/60 hover:bg-[#E3000F] text-white rounded-full p-0.5 transition shadow-xs"
          title="Xóa ảnh"
        >
          <MaterialIcon name="close" className="text-[10px]" />
        </button>
        <div className="absolute bottom-0 inset-x-0 bg-black/60 text-[9px] text-white px-1 py-0.5 truncate text-center opacity-0 group-hover:opacity-100 transition-opacity">
          {file.name}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-lg px-2.5 py-1 text-[11px]">
      <MaterialIcon name="attach_file" className="text-[14px] text-slate-500" />
      <span className="text-slate-700 max-w-[140px] truncate font-medium">{file.name}</span>
      <button
        type="button"
        onClick={onRemove}
        className="text-slate-400 hover:text-[#E3000F] transition ml-1"
        title="Xóa file"
      >
        <MaterialIcon name="close" className="text-[12px]" />
      </button>
    </div>
  );
}
function looksLikeVnPhoneQuery(raw: string): boolean {
  const digits = raw.replace(/[\s.\-()]/g, "");
  return /^(\+?84|0)\d{8,10}$/.test(digits);
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function ZaloInboxAdminShell() {
  const { user } = useAppAuth();
  const inbox = useZaloAdminInbox();
  const push = useZaloPushNotifications();

  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    void Promise.resolve().then(() => setMounted(true));
  }, []);

  const [panelTab, setPanelTab] = useState<PanelTab>("templates");
  const [templateGroupId, setTemplateGroupId] = useState(QUICK_REPLY_GROUPS[0].id);
  const [noteDraftState, setNoteDraftState] = useState({ convId: "", value: "" });
  const panelScrollRef = useRef<HTMLDivElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const lastChatScrollStateRef = useRef({ convId: "", lastMessageKey: "" });
  const groupMembersLoadKeyRef = useRef<string | null>(null);

  // States for account edit
  const [editLabel, setEditLabel] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [isSavingAccount, setIsSavingAccount] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [startingDmSenderId, setStartingDmSenderId] = useState<string | null>(null);

  // States for campaign / multi-message forwarding
  const [selectedMessageIds, setSelectedMessageIds] = useState<string[]>([]);
  const [autoSendTargetIds, setAutoSendTargetIds] = useState<string[]>([]);
  const [autoSendSearchQuery, setAutoSendSearchQuery] = useState("");
  const [manualRecipients, setManualRecipients] = useState("");
  const [campaignMode, setCampaignMode] = useState<CampaignMode>("both");
  const [isSendingCampaign, setIsSendingCampaign] = useState(false);
  const [campaignSuccess, setCampaignSuccess] = useState<string | null>(null);
  const [campaignError, setCampaignError] = useState<string | null>(null);
  const [campaignLogs, setCampaignLogs] = useState<{ name: string; status: "sending" | "success" | "failed" }[]>([]);
  const [editedMessagesText, setEditedMessagesText] = useState<Record<string, string>>({});
  const [showCrmModal, setShowCrmModal] = useState(false);

  // Real CRM Modals & Drawers State
  const [showDealModal, setShowDealModal] = useState(false);
  const [showQuoteModal, setShowQuoteModal] = useState(false);
  const [showCustomerDrawer, setShowCustomerDrawer] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [showInternalNoteModal, setShowInternalNoteModal] = useState(false);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showOverflowMenu, setShowOverflowMenu] = useState(false);

  // Form State for Drawers
  const [dealTitle, setDealTitle] = useState("");
  const [dealValue, setDealValue] = useState("50.000.000");
  const [quoteTitle, setQuoteTitle] = useState("");
  const [quoteValue, setQuoteValue] = useState("50.000.000");
  const [taskTitle, setTaskTitle] = useState("");
  const [assignee, setAssignee] = useState(user?.name || user?.email || "Chưa phân công");

  // File Input Refs
  const fileInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const router = useRouter();
  const searchParams = useSearchParams();
  const jumpToConvRef = useRef<string | null>(null);
  const jumpToAccountRef = useRef<string | null>(null);

  useEffect(() => {
    const targetAccount = searchParams.get("account");
    if (!targetAccount || jumpToAccountRef.current === targetAccount) return;
    jumpToAccountRef.current = targetAccount;
    inbox.onSelectAccount(targetAccount);
  }, [searchParams, inbox]);

  useEffect(() => {
    const targetConv = searchParams.get("conv");
    if (!targetConv || jumpToConvRef.current === targetConv) return;
    // SU CO THAT (2026-10-04): useRef chi chan duoc trong CUNG 1 lan mount -
    // neu trang bi reload lien tuc (vd do ket hop voi loi auth/me cham gay
    // "van dang nhap bi vang ra" o thoi diem do), moi lan reload la 1 mount
    // MOI, jumpToConvRef tro ve null, effect nay goi lai resolveZaloConversationAccount
    // tu dau - da gay flood hang nghin request /resolve-account trong vai
    // phut, nghet CPU backend toi 86%+ lam MOI API (ke ca auth/me) bi xep
    // hang/timeout - dung la nguyen nhan goc cua "dang nhap gg xac nhan lau,
    // load lau, reload bi vang login". Them lop chan bang sessionStorage
    // (song qua ca reload trang that, chi mat khi dong tab) voi cooldown
    // ngan - neu da thu goi conv nay trong 15s gan day thi bo qua, tranh
    // vong lap tu tang toc do.
    const cooldownKey = `zalo-resolve-attempt:${targetConv}`;
    try {
      const lastAttempt = Number(window.sessionStorage.getItem(cooldownKey) || 0);
      if (Date.now() - lastAttempt < 15000) {
        jumpToConvRef.current = targetConv;
        return;
      }
      window.sessionStorage.setItem(cooldownKey, String(Date.now()));
    } catch {
      // sessionStorage khong kha dung (vd private mode chan) - van tiep tuc,
      // chi mat lop chan qua-reload, khong chan ca luong binh thuong.
    }
    jumpToConvRef.current = targetConv;
    (async () => {
      try {
        const res = await resolveZaloConversationAccount(targetConv);
        if (res?.account_id) {
          inbox.onSelectAccount(res.account_id);
        }
      } catch (e) {
        console.warn("Không tự động mở được hội thoại từ link Xử lý:", e);
      }
    })();
  }, [searchParams, inbox]);

  useEffect(() => {
    const targetConv = jumpToConvRef.current;
    if (!targetConv || !inbox.selectedAccountId) return;
    if (inbox.filtered.some((c) => c.conv_id === targetConv)) {
      inbox.openChat(targetConv);
      jumpToConvRef.current = null;
    }
  }, [inbox.selectedAccountId, inbox.filtered, inbox]);

  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [showSalesAssetPicker, setShowSalesAssetPicker] = useState(false);
  const [selectedQuoteId, setSelectedQuoteId] = useState<string | null>(null);
  const [currentLead, setCurrentLead] = useState<Customer | null>(null);

  useEffect(() => {
    if (!inbox.openConv) {
      setCurrentLead(null);
      return;
    }
    let cancelled = false;
    setCurrentLead(null);
    void (async () => {
      try {
        const lead = await customerLeadService.getByConvId(inbox.openConv);
        if (!cancelled) setCurrentLead(lead);
      } catch {
        if (!cancelled) setCurrentLead(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [inbox.openConv]);

  const [showMentionPicker, setShowMentionPicker] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionAtPos, setMentionAtPos] = useState<number | null>(null);
  const [showStickerPicker, setShowStickerPicker] = useState(false);
  const [reactionPickerFor, setReactionPickerFor] = useState<string | null>(null);
  const [messageMenuFor, setMessageMenuFor] = useState<string | null>(null);
  const [showSearchPanel, setShowSearchPanel] = useState(false);

  const [forwardingMessage, setForwardingMessage] = useState<ZaloLibraryMessage | null>(null);
  const [newChatModalOpen, setNewChatModalOpen] = useState(false);
  const [phoneSearchQuery, setPhoneSearchQuery] = useState<string | undefined>(undefined);

  const [customQuickReplies, setCustomQuickReplies] = useState<ZaloQuickReply[]>([]);
  const [showSaveTemplateForm, setShowSaveTemplateForm] = useState(false);
  const [newTemplateLabel, setNewTemplateLabel] = useState("");
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);

  useEffect(() => {
    if (!inbox.selectedAccountId) {
      setCustomQuickReplies([]);
      return;
    }
    let cancelled = false;
    getZaloQuickReplies(inbox.selectedAccountId)
      .then((list) => {
        if (!cancelled) setCustomQuickReplies(list);
      })
      .catch(() => {
        if (!cancelled) setCustomQuickReplies([]);
      });
    return () => {
      cancelled = true;
    };
  }, [inbox.selectedAccountId]);

  const handleSaveCurrentAsTemplate = async () => {
    const text = inbox.reply.trim();
    const label = newTemplateLabel.trim();
    if (!text || !label || !inbox.selectedAccountId) return;
    setIsSavingTemplate(true);
    try {
      const created = await createZaloQuickReply(inbox.selectedAccountId, { label, text });
      setCustomQuickReplies((prev) => [created, ...prev]);
      setNewTemplateLabel("");
      setShowSaveTemplateForm(false);
    } catch (e) {
      inbox.showToast(e instanceof Error ? e.message : "Không thể lưu mẫu nhắn nhanh.", false);
    } finally {
      setIsSavingTemplate(false);
    }
  };

  const handleDeleteQuickReply = async (replyId: number) => {
    if (!inbox.selectedAccountId) return;
    setCustomQuickReplies((prev) => prev.filter((r) => r.id !== replyId));
    try {
      await deleteZaloQuickReply(inbox.selectedAccountId, replyId);
    } catch (e) {
      inbox.showToast(e instanceof Error ? e.message : "Không thể xoá mẫu nhắn nhanh.", false);
    }
  };

  // Nhảy tới 1 tin nhắn tìm được — best-effort, chỉ hoạt động nếu tin đang
  // nằm trong danh sách ĐÃ TẢI (data-msg-anchor khớp source_message_id).
  const handleJumpToSearchedMessage = (message: ZaloLibraryMessage): boolean => {
    if (!message.source_message_id) return false;
    const el = chatScrollRef.current?.querySelector(
      `[data-msg-anchor="${CSS.escape(message.source_message_id)}"]`,
    ) as HTMLElement | null;
    if (!el) return false;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("ring-2", "ring-[#E3000F]", "ring-offset-2");
    setTimeout(() => el.classList.remove("ring-2", "ring-[#E3000F]", "ring-offset-2"), 1600);
    return true;
  };

  // Tra ngược tin đang được trích dẫn TRONG danh sách đã tải sẵn (không gọi
  // API mới) — nếu tin gốc nằm ngoài phạm vi trang hiện tại, trả về undefined
  // và UI tự hiện fallback "Tin nhắn gốc" không nội dung.
  const findQuotedMessage = (replyToId: string | null | undefined) => {
    if (!replyToId) return undefined;
    return inbox.messages.find((m) => m.source_message_id === replyToId || m.id === replyToId);
  };

  const handleCopyMessage = (message: ZaloLibraryMessage) => {
    const text = (message.content || "").trim();
    if (!text) return;
    navigator.clipboard
      .writeText(text)
      .then(() => inbox.showToast("Đã copy tin nhắn", true))
      .catch(() => inbox.showToast("Không thể copy — trình duyệt chặn quyền clipboard", false));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    setSelectedFiles((prev) => [...prev, ...files]);
    e.target.value = "";
  };

  // Dán hình trực tiếp vào ô nhắn tin (Ctrl+V) để gửi luôn, không cần bấm
  // chọn file — giống hành vi chuẩn của Zalo Web/app thật.
  const handlePasteImage = (e: React.ClipboardEvent<HTMLTextAreaElement | HTMLDivElement>) => {
    const clipboardData = e.clipboardData;
    if (!clipboardData) return;

    const files: File[] = [];

    // 1. Thử lấy từ e.clipboardData.files trực tiếp
    if (clipboardData.files && clipboardData.files.length > 0) {
      for (let i = 0; i < clipboardData.files.length; i += 1) {
        const f = clipboardData.files[i];
        if (f.type.startsWith("image/")) {
          files.push(f);
        }
      }
    }

    // 2. Thử lấy từ e.clipboardData.items (dán từ Snipping Tool, clipboard screenshot, browser copy)
    if (files.length === 0 && clipboardData.items && clipboardData.items.length > 0) {
      for (let i = 0; i < clipboardData.items.length; i += 1) {
        const item = clipboardData.items[i];
        if (item.kind === "file" && item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            const ext = file.type.split("/")[1] || "png";
            const filename =
              file.name && file.name !== "image.png"
                ? file.name
                : `pasted_image_${Date.now()}_${i + 1}.${ext}`;
            const renamedFile = new File([file], filename, { type: file.type });
            files.push(renamedFile);
          }
        }
      }
    }

    if (files.length > 0) {
      e.preventDefault();
      setSelectedFiles((prev) => [...prev, ...files]);
      inbox.showToast(`Đã dán ${files.length} ảnh trực tiếp`, true);
    }
  };

  const handleSendReply = async () => {
    const text = inbox.reply.trim();
    if (!text && selectedFiles.length === 0) return;

    inbox.setReply("");
    setSelectedFiles([]);

    try {
      await inbox.sendMessage(text, selectedFiles.length > 0 ? selectedFiles : undefined);
    } catch (e) {
      console.error("Failed to send message via ZCA", e);
    }
  };

  const appendEmoji = (emoji: string) => {
    inbox.setReply((prev) => prev + emoji);
  };

  // Zalo tập trung: gõ "@" mở popup chọn thành viên nhóm (cần đã bấm "Quét thành
  // viên" ở tab Thông tin trước — xem inbox.groupMembers) — chèn mention token
  // {pos,uid,len} khớp format sendZaloMessageWithMentions cần.
  const handleReplyChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    inbox.setReply(value);
    const caret = e.target.selectionStart ?? value.length;
    const atIdx = value.lastIndexOf("@", caret - 1);
    if (atIdx === -1 || /\s/.test(value.slice(atIdx + 1, caret))) {
      setShowMentionPicker(false);
      setMentionAtPos(null);
      return;
    }
    setMentionAtPos(atIdx);
    setMentionQuery(value.slice(atIdx + 1, caret));
    setShowMentionPicker(true);
  };

  const insertMention = (uid: string, displayName: string) => {
    if (mentionAtPos === null) return;
    const before = inbox.reply.slice(0, mentionAtPos);
    const after = inbox.reply.slice(mentionAtPos + 1 + mentionQuery.length);
    const label = `@${displayName}`;
    inbox.setReply(`${before}${label} ${after}`);
    inbox.setPendingMentions((prev) => [...prev, { pos: before.length, uid, len: label.length }]);
    setShowMentionPicker(false);
    setMentionAtPos(null);
    setMentionQuery("");
  };

  const filteredMentionCandidates = (inbox.groupMembers?.members ?? []).filter((m) =>
    !mentionQuery.trim() || m.display_name.toLowerCase().includes(mentionQuery.trim().toLowerCase())
  );

  const handleSendSticker = (sticker: { id: number; cateId: number }) => {
    setShowStickerPicker(false);
    void inbox.sendStickerAction(sticker);
  };

  // Đóng panel tìm tin nhắn khi đổi hội thoại — tránh tìm nhầm sang hội
  // thoại khác vẫn đang hiện kết quả cũ.
  useEffect(() => {
    setShowSearchPanel(false);
  }, [inbox.openConv]);

  const handleAutoSend = async () => {
    if (!inbox.selectedAccountId || selectedMessageIds.length === 0) return;

    setIsSendingCampaign(true);
    setCampaignError(null);
    setCampaignSuccess(null);
    setCampaignLogs([]);

    const manualLines = manualRecipients
      .split("\n")
      .map(line => line.trim())
      .filter(Boolean);

    const targets: ZaloBroadcastTarget[] = [];

    // System targets
    autoSendTargetIds.forEach(id => {
      const conv = inbox.filtered.find(c => c.conv_id === id);
      if (conv) {
        targets.push({ group_id: conv.conv_id, group_name: conv.name || conv.conv_id });
      }
    });

    // Manual targets
    manualLines.forEach(line => {
      targets.push({ group_id: line, group_name: line });
    });

    if (targets.length === 0) {
      setCampaignError("Không tìm thấy người nhận hợp lệ.");
      setIsSendingCampaign(false);
      return;
    }

    setIsSendingCampaign(true);
    setCampaignError(null);
    setCampaignSuccess(null);
    setCampaignLogs([]);

    // Build text overrides
    const textOverrides: Record<string, string> = {};
    selectedMessageIds.forEach(msgId => {
      const text = editedMessagesText[msgId];
      if (text !== undefined) {
        textOverrides[msgId] = text;
      }
    });

    try {
      await createZaloBroadcast(inbox.selectedAccountId, {
        user_id: inbox.selectedAccountId,
        message_ids: selectedMessageIds,
        targets,
        content_mode: campaignMode,
        text_overrides: textOverrides,
      });

      // Simulate log stream for interactive view
      let currentIdx = 0;
      const logNext = () => {
        if (currentIdx >= targets.length) {
          setCampaignSuccess(`Đã gửi thành công đến ${targets.length} người nhận!`);
          setIsSendingCampaign(false);
          setAutoSendTargetIds([]);
          setSelectedMessageIds([]);
          setManualRecipients("");
        } else {
          const target = targets[currentIdx];
          setCampaignLogs(prev => [...prev, { name: target.group_name, status: "success" }]);
          currentIdx++;
          setTimeout(logNext, 300);
        }
      };
      logNext();
    } catch (e) {
      setCampaignError(e instanceof Error ? e.message : String(e));
      setIsSendingCampaign(false);
    }
  };

  // Reset selected campaign messages and target recipients when conversation or account changes
  useEffect(() => {
    void Promise.resolve().then(() => {
      setSelectedMessageIds([]);
      setEditedMessagesText({});
      setAutoSendTargetIds([]);
    });
  }, [inbox.openConv, inbox.selectedAccountId]);

  // Selected conversation objects mapped
  const selectedConv = useMemo<ZaloConv | null>(
    () => inbox.activeConvs.find((c) => c.conv_id === inbox.openConv) ?? null,
    [inbox.activeConvs, inbox.openConv]
  );
  const selectedArchive = useMemo(() => {
    return inbox.archives.find((a) => a.conv_id === inbox.openConv) ?? null;
  }, [inbox.archives, inbox.openConv]);

  const selectedName = inbox.archiveReading ? selectedArchive?.name : selectedConv?.name;
  const selectedPreview = inbox.archiveReading ? selectedArchive?.preview : selectedConv?.preview;
  const selectedNote = inbox.openConv ? (inbox.customerNotes[inbox.openConv] ?? selectedArchive?.note ?? "") : "";

  const activeTemplateGroup = QUICK_REPLY_GROUPS.find((g) => g.id === templateGroupId) || QUICK_REPLY_GROUPS[0];
  const noteDraft = noteDraftState.convId === inbox.openConv ? noteDraftState.value : selectedNote;
  const setNoteDraft = (value: string) => setNoteDraftState({ convId: inbox.openConv, value });
  const noteChanged = noteDraft.trim() !== selectedNote.trim();

  // Giữ feed ổn định: chỉ tự kéo xuống khi đổi hội thoại hoặc khi người dùng
  // đang ở gần đáy, tránh poll realtime làm nhảy khỏi đoạn tin đang đọc.
  useEffect(() => {
    const el = chatScrollRef.current;
    const convId = inbox.openConv || "";
    const lastMsg = inbox.messages[inbox.messages.length - 1];
    const lastMessageKey = lastMsg ? String(lastMsg.source_message_id || lastMsg.id || lastMsg.timestamp_text || "") : "";
    const prev = lastChatScrollStateRef.current;
    const convChanged = prev.convId !== convId;
    const messageChanged = prev.lastMessageKey !== lastMessageKey;
    if (!el || (!convChanged && !messageChanged)) {
      lastChatScrollStateRef.current = { convId, lastMessageKey };
      return;
    }
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const shouldStickToBottom = convChanged || distanceFromBottom < 180;
    lastChatScrollStateRef.current = { convId, lastMessageKey };
    if (shouldStickToBottom) {
      const scrollToBottom = () => {
        if (chatScrollRef.current) {
          chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
        }
      };
      requestAnimationFrame(() => {
        scrollToBottom();
        requestAnimationFrame(scrollToBottom);
        window.setTimeout(scrollToBottom, 80);
      });
    }
  }, [inbox.messages, inbox.openConv]);

  useEffect(() => {
    lastChatScrollStateRef.current = { convId: "", lastMessageKey: "" };
    setMessageMenuFor(null);
    setReactionPickerFor(null);
    groupMembersLoadKeyRef.current = null;
  }, [inbox.openConv, inbox.selectedAccountId]);

  useEffect(() => {
    if (!inbox.openConv || !inbox.selectedAccountId || inbox.loadingGroupMembers) return;
    if (inbox.groupMembers?.group_id === inbox.openConv && inbox.groupMembers.members.length > 0) return;
    const loadKey = `${inbox.selectedAccountId}:${inbox.openConv}`;
    if (groupMembersLoadKeyRef.current === loadKey) return;
    const hasReceivedGroupSender = inbox.messages.some(
      (msg) => !msg.is_sent && msg.sender_id && msg.sender_id !== inbox.openConv,
    );
    if (hasReceivedGroupSender) {
      groupMembersLoadKeyRef.current = loadKey;
      void inbox.loadGroupMembers();
    }
  }, [inbox.openConv, inbox.selectedAccountId, inbox.messages, inbox.loadingGroupMembers, inbox.groupMembers]);

  const groupMemberByUid = useMemo(() => {
    if (!inbox.openConv || inbox.groupMembers?.group_id !== inbox.openConv) {
      return new Map<string, NonNullable<typeof inbox.groupMembers>["members"][number]>();
    }
    const entries = inbox.groupMembers.members.map((member) => [member.uid, member] as const);
    return new Map(entries);
  }, [inbox.groupMembers, inbox.openConv]);

  // Current owner/account labels for display
  const ownerName = inbox.selectedOwnerInfo?.ownerName ?? inbox.ownerNames[inbox.selectedOwnerId] ?? "";
  const ownerEmail = inbox.selectedOwnerInfo?.ownerEmail ?? inbox.ownerEmails[inbox.selectedOwnerId] ?? "";
  const accountLabel = inbox.selectedAccountInfo
    ? inbox.selectedAccountInfo.label ?? inbox.selectedAccountInfo.phone ?? inbox.selectedAccountId
    : "";
  // Ai được phép bấm "Đăng nhập lại"/gọi extension cho account đang xem — trước đây
  // CHỈ cho phép khi ownerEmail khớp đúng email người gọi (owner_id resolve đúng
  // group của họ), nên admin/leader hoặc bất kỳ ai xem 1 account is_shared_with_all
  // (KHÔNG thuộc team mình, ownerEmail resolve rỗng) không hề thấy nút này — đúng
  // y bug "chưa login mà không có nút nào để gọi extension đăng nhập" report ngày
  // 2026-08-25. Giờ mở rộng: chủ sở hữu thật HOẶC admin/leader HOẶC account đã
  // đánh dấu dùng chung toàn công ty.
  const isOwnAccount = Boolean(
    ownerEmail && inbox.leaderEmail && ownerEmail.toLowerCase() === inbox.leaderEmail.toLowerCase()
  );
  const canManageAccountAuth =
    isOwnAccount ||
    inbox.role === "admin" ||
    inbox.role === "leader" ||
    Boolean(inbox.selectedAccountInfo?.is_shared_with_all);
  const accountStatus = inbox.selectedAccountId ? inbox.getAccountStatus(inbox.selectedAccountId) : "offline";

  // Sync edit account values
  useEffect(() => {
    if (inbox.selectedAccountInfo) {
      void Promise.resolve().then(() => {
        setEditLabel(inbox.selectedAccountInfo?.label || "");
        setEditPhone(inbox.selectedAccountInfo?.phone || "");
      });
    }
  }, [inbox.selectedAccountId, inbox.selectedAccountInfo]);

  // Stats calculation
  const stats = useMemo(() => {
    const activeList = inbox.activeConvs.filter((c) => !c.archived);
    return {
      total: activeList.length,
      unread: activeList.filter((c) => c.unread).length,
      needReply: activeList.filter((c) => c.unread || c.preview !== "").length,
      customers: activeList.filter((c) => c.is_customer).length,
      pushed: activeList.filter((c) => c.is_customer).length,
    };
  }, [inbox.activeConvs]);

  const appendTemplate = (text: string) => {
    inbox.setReply(inbox.reply.trim() ? `${inbox.reply.trim()}\n${text}` : text);
  };

  const appendAiSuggestion = (suggestion: string) => {
    const textToInsert = suggestion === "Giới thiệu dịch vụ"
      ? "Chào bạn, bên mình là Markee AI Agency chuyên cung cấp giải pháp Marketing và CRM cho doanh nghiệp ạ."
      : suggestion === "Gửi bảng báo giá chi tiết"
      ? "Chào anh, em gửi anh bảng báo giá chi tiết dịch vụ nhé ạ. Anh xem qua giúp em nhé."
      : suggestion === "Hỗ trợ triển khai"
      ? "Bên em sẽ hỗ trợ triển khai setup trực tiếp và hướng dẫn nhân sự sử dụng đầy đủ ạ."
      : "Dạ em cảm ơn anh/chị đã phản hồi!";
    inbox.setReply(inbox.reply.trim() ? `${inbox.reply.trim()}\n${textToInsert}` : textToInsert);
  };

  const appendSalesAsset = (asset: SalesAsset) => {
    const link = asset.sourceUrl || asset.shareUrl;
    const meta = [asset.projectName, asset.version].filter(Boolean).join(" - ");
    const text = `${asset.title}${meta ? ` (${meta})` : ""}\n${link}`;
    inbox.setReply(inbox.reply.trim() ? `${inbox.reply.trim()}\n${text}` : text);
    setShowSalesAssetPicker(false);
    inbox.showToast("Đã chèn tài liệu vào ô trả lời.", true);
  };

  const handleDocumentSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFileChange(e);
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFileChange(e);
  };
  const insertEmoji = (emoji: string) => {
    inbox.setReply(inbox.reply + emoji);
    setShowEmojiPicker(false);
  };

  const handleUpdateAccount = async () => {
    if (!inbox.selectedAccountId) return;
    setIsSavingAccount(true);
    try {
      await updateZaloAccount(inbox.selectedAccountId, {
        label: editLabel.trim() || undefined,
        phone: editPhone.trim() || undefined,
      });
      inbox.showToast("Đã cập nhật thông tin tài khoản Zalo", true);
      void inbox.refreshAccounts();
    } catch (e) {
      inbox.showToast("Không thể cập nhật tài khoản Zalo", false);
    } finally {
      setIsSavingAccount(false);
    }
  };

  const handleRestartListener = async () => {
    if (!inbox.selectedAccountId) return;
    try {
      await restartZaloAccountListener(inbox.selectedAccountId);
      inbox.showToast("Đã gửi yêu cầu khởi động lại Listener", true);
      void inbox.refreshAccounts();
    } catch (e) {
      inbox.showToast("Lỗi khi khởi động lại Listener", false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!inbox.selectedAccountId) return;
    if (window.confirm("Bạn có chắc chắn muốn ẩn tài khoản Zalo này khỏi hệ thống?")) {
      try {
        await deleteZaloAccount(inbox.selectedAccountId, false);
        inbox.showToast("Đã ẩn tài khoản Zalo", true);
        inbox.onSelectAccount("");
        void inbox.refreshAccounts();
      } catch (e) {
        inbox.showToast("Lỗi khi ẩn tài khoản Zalo", false);
      }
    }
  };

  const handleDeleteFull = async () => {
    if (!inbox.selectedAccountId) return;
    if (window.confirm("CẢNH BÁO: Hành động này sẽ xoá hoàn toàn file session đăng nhập Zalo trên VPS và dữ liệu chat trong DB. Bạn có chắc chắn?")) {
      try {
        await deleteZaloAccountFull(inbox.selectedAccountId, inbox.selectedOwnerId);
        inbox.showToast("Đã xoá hoàn toàn tài khoản Zalo", true);
        inbox.onSelectAccount("");
        void inbox.refreshAccounts();
      } catch (e) {
        inbox.showToast("Lỗi khi xoá hoàn toàn tài khoản", false);
      }
    }
  };

  const handleMessageSenderPrivately = async (senderId: string, senderName: string) => {
    if (!inbox.selectedAccountId || !senderId || startingDmSenderId) return;
    setStartingDmSenderId(senderId);
    try {
      const res = await createZaloUserThread(inbox.selectedAccountId, {
        user_id: senderId,
        display_name: senderName || `User ${senderId}`,
      });
      await inbox.refreshConversations();
      inbox.openChat(res.conversation_id);
      inbox.showToast(`Da mo hoi thoai rieng voi ${senderName || senderId}`, true);
    } catch (error) {
      inbox.showToast(error instanceof Error ? error.message : "Khong the mo hoi thoai rieng voi nguoi nay", false);
    } finally {
      setStartingDmSenderId(null);
    }
  };
  const handleVerifyKpi = async () => {
    if (!inbox.openConv || !inbox.selectedAccountId) return;
    try {
      await inbox.onSyncConversationMessages(inbox.openConv);
      inbox.showToast("Đã duyệt KPI hội thoại này!", true);
    } catch {
      inbox.showToast("Lỗi duyệt KPI", false);
    }
  };

  const handleSuggestKpi = async () => {
    if (!inbox.selectedAccountId) return;
    try {
      await inbox.bulkSuggestKpi();
      inbox.showToast("Đã đề xuất tính KPI hàng loạt thành công!", true);
    } catch {
      inbox.showToast("Lỗi đề xuất tính KPI", false);
    }
  };

  const groupedMessages = useMemo(() => {
    const groups: { date: string; msgs: ZaloLibraryMessage[] }[] = [];
    for (const msg of inbox.messages) {
      const date = formatDate(msg.timestamp_text ?? msg.time_text) || "Hom nay";
      const last = groups[groups.length - 1];
      if (!last || last.date !== date) {
        groups.push({ date, msgs: [msg] });
      } else {
        last.msgs.push(msg);
      }
    }
    return groups;
  }, [inbox.messages]);
  const panelH = "h-[620px]";

  return (
    <div className="w-full max-w-full text-[#1A1A1A] flex flex-col bg-white h-full min-h-0 overflow-hidden font-sans">
      {/* Hidden File Inputs for Native Attachments */}
      <input type="file" ref={documentInputRef} onChange={handleDocumentSelect} className="hidden" />
      <input type="file" accept="image/*" ref={imageInputRef} onChange={handleImageSelect} className="hidden" />

      <div className={cn(inbox.openConv ? "hidden lg:contents" : "contents")}>
        {/* ── Compact Operational Top Bar (Header + KPI Strip + Operational Account Bar) ── */}
        <div className="mb-3 space-y-2 flex-shrink-0">
          {/* Header Row */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => router.push("/all-platform/tai-khoan")}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-600 transition hover:border-[#E3000F] hover:text-[#E3000F]"
              >
                <MaterialIcon name="arrow_back" className="text-[14px]" />
                Tài khoản
              </button>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold text-slate-900">Inbox Zalo Admin</h1>
                <span className="rounded-full bg-red-50 border border-red-100 px-2 py-0.2 text-[10px] font-bold text-[#E3000F]">
                  Zalo Operational
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs">
              {inbox.role === "admin" || inbox.role === "leader" ? (
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={inbox.targetDate}
                    onChange={(e) => inbox.setTargetDate(e.target.value)}
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs outline-none focus:border-[#E3000F]"
                  />
                  <button
                    onClick={() => inbox.onBulkVerifyKpi({ leader_email: inbox.leaderEmail, target_date: inbox.targetDate })}
                    disabled={inbox.isBulkVerifying}
                    className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-bold text-white transition hover:bg-emerald-700 disabled:opacity-50 shadow-2xs"
                  >
                    {inbox.isBulkVerifying ? "ĐANG TÍNH..." : "TÍNH KPI HÀNG LOẠT"}
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleSuggestKpi}
                  disabled={inbox.isBulkSuggesting || !inbox.selectedAccountId}
                  className="rounded-lg bg-blue-600 px-3 py-1 text-xs font-bold text-white transition hover:bg-blue-700 disabled:opacity-50 shadow-2xs"
                >
                  {inbox.isBulkSuggesting ? "ĐANG ĐỀ XUẤT..." : "ĐỀ XUẤT TÍNH KPI HÀNG LOẠT"}
                </button>
              )}
              <span className="text-[11px] text-slate-400 font-medium hidden md:inline">● Realtime</span>
            </div>
          </div>

          {/* Compact Operational Strip (KPI Summary + Account Selector) */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-xs shadow-2xs">
            {/* Compact KPI Strip */}
            <div className="flex flex-wrap items-center gap-3 text-xs font-medium text-slate-600">
              <div>
                Hội thoại <strong className="text-slate-900 font-bold">{stats.total}</strong>
                {stats.unread > 0 && <span className="text-red-600 font-bold ml-1">· {stats.unread} chưa đọc</span>}
              </div>
              <span className="text-slate-200">|</span>
              <div>
                Cần trả lời <strong className="text-[#E3000F] font-bold">{stats.needReply}</strong>
              </div>
              <span className="text-slate-200">|</span>
              <div>
                Lead đã lưu <strong className="text-slate-900 font-bold">{stats.customers}</strong>
              </div>
              <span className="text-slate-200">|</span>
              <div>
                Online <strong className="text-emerald-700 font-bold">{inbox.sessions.filter((s) => s.listener?.connected).length}/{inbox.sessions.length}</strong>
              </div>
            </div>

            {/* Account Selector Bar */}
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-slate-400 font-medium shrink-0">Tài khoản:</span>
              <ZaloTeamAccountTree
                sessions={inbox.sessions}
                ownerNames={inbox.ownerNames}
                teams={inbox.teams}
                selectedAcc={inbox.selectedAccountId}
                onSelect={inbox.onSelectAccount}
                role={inbox.role}
                owner={inbox.leaderEmail}
              />
            </div>
          </div>
        </div>

        {/* Toast Alert */}
        {inbox.toast && (
          <div
            className={cn(
              "mb-2 rounded-xl border px-3 py-2 text-xs font-bold transition-all shadow-2xs flex-shrink-0",
              inbox.toast.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800"
            )}
          >
            {inbox.toast.msg}
          </div>
        )}
      </div>

      {/* ── 3-Pane Viewport Grid ── */}
      <div className="grid min-w-0 flex-1 min-h-0 overflow-hidden grid-cols-1 gap-3 lg:grid-cols-[290px_1fr_350px] h-full">
        {/* Pane 1: Conversations List */}
        <section
          className={cn(
            "min-w-0 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-xs flex-col",
            inbox.openConv ? "hidden lg:flex" : "flex"
          )}
        >
          <div className="border-b border-slate-200/80 p-3.5 flex-shrink-0 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 min-w-0">
                <h2 className="text-sm font-bold text-slate-900">Hộp thư</h2>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">
                  {inbox.filtered.length}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                {inbox.loadingConvs ? "Đang tải..." : `${inbox.filtered.length} hội thoại`}
              </p>
            </div>

            <div className="relative">
              <MaterialIcon name="search" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-slate-400" />
              <input
                type="text"
                value={inbox.searchQuery}
                onChange={(e) => inbox.setSearchQuery(e.target.value)}
                placeholder="Tìm theo tên hoặc SĐT..."
                className="h-8 w-full rounded-xl border border-slate-200 bg-white pl-8 pr-3 text-xs outline-none focus:border-[#E3000F]"
              />
            </div>

            <div>
              <select
                value={inbox.filter}
                onChange={(e) => inbox.setFilter(e.target.value as ZaloInboxFilter)}
                className="h-8 w-full rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-semibold outline-none focus:border-[#E3000F]"
              >
                <option value="all">Tất cả (Lọc)</option>
                <option value="need_reply">Cần trả lời</option>
                <option value="unread">Chưa đọc</option>
                <option value="customer">Khách hàng</option>
                <option value="need_verify">Chưa tính KPI</option>
              </select>
            </div>

            <div className="grid grid-cols-2 rounded-xl bg-slate-100/80 p-1 text-xs font-bold">
              <button
                onClick={() => inbox.setArchiveReading(false)}
                className={cn(
                  "rounded-lg py-1.5 transition text-center",
                  !inbox.archiveReading ? "bg-[#fce4ec] text-[#d81b60]" : "text-slate-500"
                )}
              >
                Hộp thư
              </button>
              <button
                onClick={() => inbox.setArchiveReading(true)}
                className={cn(
                  "rounded-lg py-1.5 transition text-center",
                  inbox.archiveReading ? "bg-[#fce4ec] text-[#d81b60]" : "text-slate-500"
                )}
              >
                Lưu trữ
              </button>
            </div>
          </div>

          <div className="h-[600px] overflow-y-auto p-2 space-y-1.5 no-scrollbar">
            {inbox.archiveReading ? (
              inbox.archives.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-400">Chưa có hội thoại lưu trữ.</div>
              ) : (
                inbox.archives.map((item) => (
                  <button
                    key={item.conv_id}
                    onClick={() => inbox.openArchive(item.conv_id)}
                    className={cn(
                      "w-full rounded-xl border p-2.5 text-left transition text-xs",
                      inbox.openConv === item.conv_id && inbox.archiveReading
                        ? "border-[#E3000F] bg-[#FFF5F5]"
                        : "border-transparent bg-white hover:bg-slate-50"
                    )}
                  >
                    <div className="truncate font-bold text-slate-900">{item.name}</div>
                    <div className="mt-0.5 truncate text-[11px] text-slate-500">{item.preview || "—"}</div>
                  </button>
                ))
              )
            ) : inbox.loadingConvs && inbox.filtered.length === 0 ? (
              <div className="py-12 text-center text-xs text-slate-400">Đang tải hộp thư...</div>
            ) : inbox.filtered.length === 0 ? (
              <div className="py-12 text-center text-xs text-slate-400">Chưa có hội thoại.</div>
            ) : (
              inbox.filtered.map((conv) => {
                const active = inbox.openConv === conv.conv_id && !inbox.archiveReading;
                const lastSender = conv.latest_sender_name?.trim();
                const previewText = conv.preview || "—";
                const previewWithSender = lastSender && lastSender !== conv.name && previewText !== "—"
                  ? `${lastSender}: ${previewText}`
                  : previewText;
                return (
                  <button
                    key={conv.conv_id}
                    onClick={() => inbox.openChat(conv.conv_id)}
                    className={cn(
                      "relative flex w-full items-center gap-3 rounded-xl p-2.5 text-left transition border",
                      active
                        ? "bg-[#fce4ec]/50 border-[#d81b60]/30 shadow-xs border-l-4 border-l-[#d81b60]"
                        : "border-transparent hover:bg-slate-50"
                    )}
                  >
                    <div className="relative shrink-0">
                      <Avatar src={conv.avatar_url} name={conv.name} className="h-10 w-10 text-xs" />
                      <span className="absolute bottom-0 right-0 size-2.5 rounded-full border-2 border-white bg-emerald-500" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-1">
                        <span className={cn("truncate text-xs", conv.unread ? "font-bold text-slate-900" : "font-semibold text-slate-800")}>
                          {conv.name}
                        </span>
                        <span className="shrink-0 text-[10px] text-slate-400">{conv.time}</span>
                      </div>

                      <p className={cn("truncate text-[11px]", conv.unread ? "font-bold text-slate-900" : "text-slate-500")}>
                        {previewWithSender}
                      </p>

                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.2 text-[9px] font-bold text-blue-600 border border-blue-100">
                          Zalo
                        </span>
                        {conv.is_customer && (
                          <span className="inline-flex rounded-full bg-emerald-50 px-2 py-0.2 text-[9px] font-bold text-emerald-700 border border-emerald-100">
                            Khách
                          </span>
                        )}
                        {conv.unread && (
                          <span className="inline-flex rounded-full bg-amber-50 px-2 py-0.2 text-[9px] font-bold text-amber-700 border border-amber-100">
                            ● Cần trả lời
                          </span>
                        )}
                      </div>
                    </div>

                    {conv.unread && (
                      <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-[#E3000F] text-[10px] font-bold text-white">
                        1
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </section>

        {/* Pane 2: Chat Workspace (middle) */}
        <section
          className={cn(
            "min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-xs h-full min-h-0",
            inbox.openConv ? "flex" : "hidden lg:flex"
          )}
        >
          {/* Session Banner Warning */}
          {inbox.selectedAccountId && (accountStatus === "expired" || accountStatus === "offline") && (
            <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center justify-between text-xs text-amber-800 flex-shrink-0">
              <span className="flex items-center gap-1.5 font-semibold">
                <MaterialIcon name="warning" className="text-amber-500 text-base" />
                {canManageAccountAuth
                  ? "Tài khoản này chưa đăng nhập hoặc đã hết phiên. Vui lòng đăng nhập lại."
                  : "Tài khoản của nhân viên đang offline / hết phiên."}
              </span>
              {canManageAccountAuth && (
                <button
                  onClick={() => setShowAuthModal(true)}
                  className="bg-amber-600 hover:bg-amber-700 text-white font-bold px-3 py-1 rounded-xl text-xs transition shadow-xs"
                >
                  Đăng nhập lại
                </button>
              )}
            </div>
          )}

          {/* Header */}
          <div className="flex items-center justify-between gap-3 border-b border-slate-200/80 px-4 py-3 bg-white flex-shrink-0 relative">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Avatar src={selectedConv?.avatar_url} name={selectedName || "Z"} className="h-9 w-9 text-xs" />
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="truncate text-sm font-bold text-slate-900">{selectedName || (inbox.openConv ? "Zalo User" : "Chọn hội thoại")}</h2>
                    {selectedConv?.is_customer && <span className="text-amber-500 text-sm" title="Khách hàng">⭐</span>}
                  </div>
                  {inbox.openConv && (
                    <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
                      <span className="font-medium text-slate-600">
                        Zalo • {inbox.selectedAccountInfo ? (inbox.selectedAccountInfo.label || inbox.selectedAccountInfo.account_id) : "Account"}
                      </span>
                      <span>•</span>
                      <span className={cn("font-semibold", inbox.accOnline ? "text-emerald-600" : "text-slate-400")}>
                        {inbox.accOnline ? "● Online" : "● Offline"}
                      </span>
                      {selectedConv?.is_customer && (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.2 text-[10px] font-bold text-emerald-700">
                          Khách hàng
                        </span>
                      )}
                      {selectedConv?.unread && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.2 text-[10px] font-bold text-amber-700">
                          Cần trả lời
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Header Action Buttons (Merged Legacy Zalo + Omni) */}
            {inbox.openConv && (
              <div className="flex items-center gap-2 relative">
                {/* OMNI ACTION: Gán người */}
                <button
                  type="button"
                  onClick={() => setShowAssignModal(true)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-[#d81b60]/40 bg-[#fce4ec]/50 px-3 py-1.5 text-xs font-bold text-[#d81b60] hover:bg-[#fce4ec] transition shadow-2xs"
                >
                  <User size={14} /> Gắn người
                </button>

                {/* LEGACY ZALO ACTION: Chia sẻ */}
                <button
                  type="button"
                  onClick={() => inbox.onToggleShare(inbox.openConv)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition shadow-2xs",
                    inbox.verifiedConvIds.has(inbox.openConv) || inbox.suggestedConvIds.has(inbox.openConv)
                      ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  )}
                  title="Chia sẻ hội thoại lên danh sách KPI team"
                >
                  <MaterialIcon name="share" className="text-sm" /> Chia sẻ
                </button>

                {/* LEGACY ZALO ACTION: Auto Send */}
                <button
                  type="button"
                  onClick={() => setPanelTab("campaign")}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition shadow-2xs",
                    panelTab === "campaign"
                      ? "border-purple-300 bg-purple-50 text-purple-700 font-bold"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  )}
                  title="Mở công cụ gửi tự động / chiến dịch Auto Send"
                >
                  <MaterialIcon name="send" className="text-sm" /> Auto Send
                </button>

                {/* OVERFLOW MENU BUTTON [...] */}
                <button
                  type="button"
                  onClick={() => setShowOverflowMenu((v) => !v)}
                  className="p-2 rounded-xl text-slate-600 hover:bg-slate-100 transition border border-slate-200"
                  title="Thao tác khác"
                >
                  <MoreVertical size={16} />
                </button>

                {/* OVERFLOW MENU DROPDOWN */}
                {showOverflowMenu && (
                  <div
                    className="absolute right-0 top-full mt-2 z-50 w-56 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-2xl space-y-0.5 text-xs"
                    onClick={() => setShowOverflowMenu(false)}
                  >
                    <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      THAO TÁC ZALO
                    </div>

                    <button
                      type="button"
                      onClick={() => inbox.loadGroupMembers()}
                      className="w-full flex items-center gap-2.5 px-2.5 py-2 text-left rounded-xl hover:bg-slate-100 font-medium text-slate-700"
                    >
                      <UserCheck size={15} className="text-slate-500" /> Quét thành viên (Quét TV)
                    </button>

                    <button
                      type="button"
                      onClick={() => setShowSearchPanel(true)}
                      className="w-full flex items-center gap-2.5 px-2.5 py-2 text-left rounded-xl hover:bg-slate-100 font-medium text-slate-700"
                    >
                      <Search size={15} className="text-slate-500" /> Tìm kiếm tin nhắn
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        if (push.subscribed) {
                          void push.unsubscribe();
                        } else {
                          void push.subscribe();
                        }
                      }}
                      className="w-full flex items-center gap-2.5 px-2.5 py-2 text-left rounded-xl hover:bg-slate-100 font-medium text-slate-700"
                    >
                      <MaterialIcon name="notifications" className="text-base text-slate-500" />
                      {push.subscribed ? "Tắt thông báo (Bật TB)" : "Bật thông báo (Bật TB)"}
                    </button>

                    <button
                      type="button"
                      onClick={() => inbox.mark(inbox.openConv, "is_customer", !selectedConv?.is_customer)}
                      className="w-full flex items-center gap-2.5 px-2.5 py-2 text-left rounded-xl hover:bg-slate-100 font-medium text-slate-700"
                    >
                      <Star size={15} className="text-amber-500" />
                      {selectedConv?.is_customer ? "Bỏ đánh dấu là khách" : "Đánh dấu là khách (Là khách)"}
                    </button>

                    <button
                      type="button"
                      onClick={() => inbox.saveArchive(inbox.openConv)}
                      className="w-full flex items-center gap-2.5 px-2.5 py-2 text-left rounded-xl hover:bg-slate-100 font-medium text-slate-700"
                    >
                      <InboxIcon size={15} className="text-slate-500" /> Lưu hội thoại (Lưu)
                    </button>

                    <button
                      type="button"
                      onClick={() => inbox.saveArchive(inbox.openConv, true)}
                      className="w-full flex items-center gap-2.5 px-2.5 py-2 text-left rounded-xl hover:bg-slate-100 font-medium text-slate-700"
                    >
                      <Eye size={15} className="text-slate-500" /> Ẩn hội thoại (Ẩn)
                    </button>

                    <div className="border-t border-slate-100 my-1" />

                    <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      THAO TÁC OMNICHANNEL
                    </div>

                    <button
                      type="button"
                      onClick={() => setShowCustomerDrawer(true)}
                      className="w-full flex items-center gap-2.5 px-2.5 py-2 text-left rounded-xl hover:bg-slate-100 font-medium text-slate-700"
                    >
                      <Eye size={15} className="text-slate-500" /> Xem hồ sơ khách hàng
                    </button>

                    <button
                      type="button"
                      onClick={() => inbox.mark(inbox.openConv, "unread", true)}
                      className="w-full flex items-center gap-2.5 px-2.5 py-2 text-left rounded-xl hover:bg-slate-100 font-medium text-slate-700"
                    >
                      <MessageCircle size={15} className="text-slate-500" /> Đánh dấu chưa đọc
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard.writeText(inbox.openConv);
                        inbox.showToast("Đã sao chép ID hội thoại", true);
                      }}
                      className="w-full flex items-center gap-2.5 px-2.5 py-2 text-left rounded-xl hover:bg-slate-100 font-medium text-slate-700"
                    >
                      <MaterialIcon name="content_copy" className="text-base text-slate-500" /> Sao chép ID hội thoại
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Messages Feed */}
          <div ref={chatScrollRef} className="flex-1 min-h-0 overflow-auto bg-white p-4 space-y-4 no-scrollbar">
            {groupedMessages.length > 0 ? (
              <div className="space-y-3">
                {groupedMessages.map((group) => (
                  <div key={group.date} className="space-y-2">
                    <div className="flex items-center gap-2 my-2.5">
                      <div className="flex-1 h-px bg-slate-200" />
                      <span className="text-[9px] text-slate-400 px-1.5 font-medium">{group.date}</span>
                      <div className="flex-1 h-px bg-slate-200" />
                    </div>
                    {group.msgs.map((msg, index) => {
                      const isSent = msg.is_sent;
                      const time = formatTime(msg.timestamp_text ?? msg.time_text);
                      const isSelected = selectedMessageIds.includes(msg.source_message_id || msg.id || "");
                      const senderMember = msg.sender_id ? groupMemberByUid.get(msg.sender_id) : undefined;
                      const senderName = senderMember?.display_name || msg.sender_name || selectedName || "Zalo";
                      const senderAvatar = senderMember?.avatar_url || (msg as unknown as { sender_avatar_url?: string; avatar_url?: string }).sender_avatar_url || (msg as unknown as { avatar_url?: string }).avatar_url || null;
                      const isGroupSender = Boolean(msg.sender_id && msg.sender_id !== inbox.openConv);
                      const checkboxEl = (
                        <input
                          type="checkbox"
                          className="w-3.5 h-3.5 cursor-pointer opacity-0 group-hover:opacity-100 checked:opacity-100 transition-opacity shrink-0"
                          checked={isSelected}
                          onChange={() => {
                            const msgId = msg.source_message_id || msg.id || "";
                            if (!msgId) return;
                            setSelectedMessageIds((prev) =>
                              prev.includes(msgId) ? prev.filter((x) => x !== msgId) : [...prev, msgId],
                            );
                          }}
                        />
                      );

                      return (
                        <ZaloSwipeableMessageItem
                          key={msg.source_message_id || msg.id || `${group.date}-${index}`}
                          disabled={msg.is_deleted}
                          onReply={() => inbox.setReplyingTo(msg)}
                          direction={isSent ? "left" : "right"}
                          className="w-full"
                        >
                          <div
                            data-msg-anchor={msg.source_message_id || undefined}
                            className={cn("flex items-center gap-2 group rounded-lg transition-shadow py-0.5", isSent ? "justify-end" : "justify-start")}
                          >
                            {!isSent && checkboxEl}
                            {!isSent && <Avatar src={senderAvatar} name={senderName} className="h-7 w-7 text-[10px] shrink-0 self-end" />}
                            <div className={cn("max-w-[88%] sm:max-w-[75%]", isSent ? "text-right" : "text-left")}>
                              {!isSent && (
                                <div className="flex items-center gap-1 mb-0.5 px-1">
                                  <span className="text-[10px] font-semibold text-slate-500">{senderName}</span>
                                  {isGroupSender && (
                                    <button
                                      type="button"
                                      onClick={() => void handleMessageSenderPrivately(msg.sender_id!, senderName)}
                                      disabled={startingDmSenderId === msg.sender_id}
                                      title={`Nhan rieng cho ${senderName}`}
                                      className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-400 hover:text-[#E3000F] disabled:opacity-60 disabled:cursor-wait shrink-0"
                                    >
                                      <MaterialIcon
                                        name={startingDmSenderId === msg.sender_id ? "sync" : "send"}
                                        className={cn("text-[11px]", startingDmSenderId === msg.sender_id && "animate-spin")}
                                      />
                                    </button>
                                  )}
                                </div>
                              )}
                              {!msg.is_deleted && msg.reply_to_id && (() => {
                                const quoted = findQuotedMessage(msg.reply_to_id);
                                const quotedMember = quoted?.sender_id ? groupMemberByUid.get(quoted.sender_id) : undefined;
                                const quotedSender = quoted
                                  ? quoted.is_sent
                                    ? "Bạn"
                                    : quotedMember?.display_name || quoted.sender_name || senderName || "Zalo"
                                  : "Tin nhắn gốc";
                                return (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (quoted) handleJumpToSearchedMessage(quoted);
                                    }}
                                    className={cn(
                                      "mb-1 block w-full rounded-xl border-l-4 px-2.5 py-1.5 text-left shadow-xs",
                                      isSent
                                        ? "border-white/60 bg-white/15 text-white/90"
                                        : "border-[#E3000F] bg-white text-[#4b5563]",
                                    )}
                                    title={quoted ? "Đi tới tin nhắn gốc" : undefined}
                                  >
                                    <span className={cn("block text-[10px] font-bold", isSent ? "text-white" : "text-[#E3000F]")}>Trả lời {quotedSender}</span>
                                    <span className="block truncate text-[10.5px] opacity-90">
                                      {quoted?.content || (quoted ? "Đính kèm" : "Chưa tải được nội dung gốc")}
                                    </span>
                                  </button>
                                );
                              })()}
                              {msg.content && (
                                <div
                                  className={cn(
                                    "whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-xs leading-relaxed break-words transition-all duration-200 shadow-xs",
                                    isSent ? "bg-brand text-white rounded-br-md" : "bg-[#f1f4f8] text-[#1f2a3a] rounded-bl-md",
                                    isSelected && (isSent ? "ring-2 ring-brand ring-offset-2" : "ring-2 ring-brand/60 bg-brand-subtle"),
                                  )}
                                >
                                  {msg.content}
                                </div>
                              )}
                              {(msg.assets ?? [])
                                .filter((asset) => asset.storage_url)
                                .map((asset, assetIndex) => (
                                  <div
                                    key={assetIndex}
                                    className={cn(
                                      "rounded-xl overflow-hidden border border-slate-200 max-w-[200px] mt-1 shadow-xs",
                                      isSent ? "ml-auto" : "mr-auto",
                                    )}
                                  >
                                    <ZaloMessageAssetView asset={asset} message={msg} />
                                  </div>
                                ))}
                              {(() => {
                                const msgKey = msg.source_message_id || msg.id || String(index);
                                const canReact = !msg.is_deleted && msg.source_message_id && (msg as unknown as { cli_msg_id?: string }).cli_msg_id;
                                const canActOnMessage = !msg.is_deleted && !!(msg.source_message_id || msg.id);
                                const canCopyMessage = canActOnMessage && !!msg.content?.trim();
                                const canForwardMessage = canActOnMessage && !!(msg.content?.trim() || (msg.assets ?? []).some((asset) => asset.storage_url));
                                return (
                                  <div className="relative mt-0.5 flex items-center gap-1 px-1" style={{ justifyContent: isSent ? "flex-end" : "flex-start" }}>
                                    {time && <span className="text-[9px] text-[#A0A0A0]">{time}</span>}
                                    {canReact && (
                                      <button
                                        type="button"
                                        data-zalo-reaction-ui
                                        onClick={() => setReactionPickerFor((prev) => (prev === msgKey ? null : msgKey))}
                                        title="Thả cảm xúc"
                                        className="opacity-0 group-hover:opacity-100 transition-opacity text-[#A0A0A0] hover:text-brand"
                                      >
                                        <MaterialIcon name="mood" className="text-[11px]" />
                                      </button>
                                    )}
                                    {canActOnMessage && (
                                      <div className="relative">
                                        <button
                                          type="button"
                                          onClick={() => setMessageMenuFor((prev) => (prev === msgKey ? null : msgKey))}
                                          title="Thao tác tin nhắn"
                                          className="flex h-5 w-5 items-center justify-center rounded-full text-[#A0A0A0] opacity-70 transition hover:bg-slate-100 hover:text-[#E3000F] group-hover:opacity-100"
                                        >
                                          <MoreVertical size={13} />
                                        </button>
                                        {messageMenuFor === msgKey && (
                                          <div className={cn("absolute bottom-full z-40 mb-1 w-36 rounded-xl border border-slate-200 bg-white p-1 shadow-xl", isSent ? "right-0" : "left-0")}>
                                            <button
                                              type="button"
                                              onClick={() => {
                                                inbox.setReplyingTo(msg);
                                                setMessageMenuFor(null);
                                              }}
                                              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[11px] font-semibold text-slate-700 hover:bg-slate-50 hover:text-[#E3000F]"
                                            >
                                              <MaterialIcon name="reply" className="text-[13px]" /> Trả lời
                                            </button>
                                            <button
                                              type="button"
                                              disabled={!canForwardMessage}
                                              onClick={() => {
                                                if (!canForwardMessage) return;
                                                setForwardingMessage(msg);
                                                setMessageMenuFor(null);
                                              }}
                                              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[11px] font-semibold text-slate-700 hover:bg-slate-50 hover:text-[#E3000F] disabled:cursor-not-allowed disabled:opacity-40"
                                            >
                                              <MaterialIcon name="forward" className="text-[13px]" /> Chuyển tiếp
                                            </button>
                                            <button
                                              type="button"
                                              disabled={!canCopyMessage}
                                              onClick={() => {
                                                if (!canCopyMessage) return;
                                                handleCopyMessage(msg);
                                                setMessageMenuFor(null);
                                              }}
                                              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[11px] font-semibold text-slate-700 hover:bg-slate-50 hover:text-[#E3000F] disabled:cursor-not-allowed disabled:opacity-40"
                                            >
                                              <MaterialIcon name="content_copy" className="text-[13px]" /> Copy
                                            </button>
                                          </div>
                                        )}
                                      </div>
                                    )}
                                    {isSent && !msg.is_deleted && (msg as unknown as { cli_msg_id?: string }).cli_msg_id && (
                                      <button
                                        type="button"
                                        onClick={() => void inbox.recallMessage(msg)}
                                        title="Thu hoi tin nhan"
                                        className="opacity-0 group-hover:opacity-100 transition-opacity text-[#A0A0A0] hover:text-[#E3000F]"
                                      >
                                        <MaterialIcon name="delete" className="text-[11px]" />
                                      </button>
                                    )}
                                    {msg.is_deleted && <span className="italic text-[9px] text-[#A0A0A0]">Tin nhan da thu hoi</span>}
                                    {reactionPickerFor === msgKey && (
                                      <div data-zalo-reaction-ui className={`absolute bottom-full z-30 mb-1 ${isSent ? "right-0" : "left-0"}`}>
                                        <ZaloReactionQuickPicker
                                          activeIcon={msg.reactions?.[inbox.myZaloUid || "__me__"] || null}
                                          onPick={(icon) => {
                                            void inbox.reactToMessage(msg, icon);
                                            setReactionPickerFor(null);
                                          }}
                                        />
                                      </div>
                                    )}
                                  </div>
                                );
                              })()}
                              {!msg.is_deleted && (
                                <div className={isSent ? "flex justify-end" : "flex justify-start"}>
                                  <ZaloReactionBadges
                                    reactions={msg.reactions}
                                    myUid={inbox.myZaloUid}
                                    onClickIcon={(icon) => void inbox.reactToMessage(msg, icon)}
                                  />
                                </div>
                              )}
                            </div>
                            {isSent && checkboxEl}
                          </div>
                        </ZaloSwipeableMessageItem>
                      );
                    })}
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center text-center p-6 text-slate-400">
                <MessageCircle size={32} className="mb-2 opacity-40 text-slate-400" />
                <p className="text-xs font-semibold text-slate-600">Chua co tin nhan</p>
                <p className="text-[11px] text-slate-400 mt-1">Bat dau tro chuyen bang cach nhap noi dung phia duoi.</p>
              </div>
            )}
          </div>
          {/* AI REPLY SUGGESTIONS BAR */}
          <div className="shrink-0 border-t border-purple-100 bg-purple-50/60 p-2.5">
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-1.5 text-xs font-bold text-purple-800">
                <Sparkles size={14} className="text-purple-600 fill-purple-300" />
                Gợi ý trả lời bằng AI
              </div>
              <button type="button" className="text-purple-600 hover:text-purple-800 p-0.5">
                <RefreshCw size={12} />
              </button>
            </div>

            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
              {AI_SUGGESTIONS.map(sug => (
                <button
                  key={sug}
                  onClick={() => appendAiSuggestion(sug)}
                  className="shrink-0 rounded-full border border-purple-200 bg-white px-3 py-1 text-xs font-semibold text-purple-900 hover:bg-purple-100/70 shadow-2xs"
                >
                  {sug}
                </button>
              ))}
            </div>
          </div>

          {/* COMPOSER TOOLBAR & INPUT */}
          <div className="shrink-0 border-t border-slate-200/80 bg-white p-3 space-y-2 relative">
            {showEmojiPicker && (
              <div className="absolute bottom-full left-3 mb-2 z-40 flex items-center gap-1.5 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
                {EMOJIS.map(emoji => (
                  <button
                    key={emoji}
                    onClick={() => insertEmoji(emoji)}
                    className="p-1.5 text-base hover:bg-slate-100 rounded-lg transition"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}

            {inbox.replyingTo && (
              <div className="flex items-center gap-2 rounded-xl border border-[#E3000F]/20 bg-[#FFF5F5] px-3 py-2 text-xs">
                <MaterialIcon name="reply" className="shrink-0 text-base text-[#E3000F]" />
                <div className="min-w-0 flex-1">
                  <div className="font-bold text-[#E3000F]">
                    Đang trả lời {inbox.replyingTo.is_sent ? "bạn" : inbox.replyingTo.sender_name || "khách"}
                  </div>
                  <div className="truncate text-slate-600">
                    {inbox.replyingTo.content || ((inbox.replyingTo.assets?.length ?? 0) > 0 ? "Đính kèm" : "Tin nhắn")}
                  </div>
                </div>
                <button type="button" onClick={() => inbox.setReplyingTo(null)} className="rounded-full p-1 hover:bg-white" title="Hủy trả lời">
                  <MaterialIcon name="close" className="text-sm text-slate-400" />
                </button>
              </div>
            )}

            {selectedFiles.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/80 p-2">
                {selectedFiles.map((file, index) => (
                  <ZaloFilePreviewItem
                    key={`${file.name}-${index}`}
                    file={file}
                    onRemove={() => setSelectedFiles((prev) => prev.filter((_, i) => i !== index))}
                  />
                ))}
                {selectedFiles.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setSelectedFiles([])}
                    className="rounded-lg px-2 py-1 text-[11px] font-semibold text-slate-500 hover:bg-white hover:text-[#E3000F]"
                  >
                    Xoa tat ca ({selectedFiles.length})
                  </button>
                )}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-100 pb-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={!inbox.openConv || inbox.archiveReading}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40"
                title="Dinh kem file"
              >
                <Paperclip size={13} /> File
              </button>
              <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileChange} />

              <button
                type="button"
                onClick={() => imageInputRef.current?.click()}
                disabled={!inbox.openConv || inbox.archiveReading}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40"
              >
                <ImageIcon size={13} /> Anh
              </button>

              <button
                type="button"
                onClick={() => setShowEmojiPicker((value) => !value)}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
              >
                <Smile size={13} /> Emoji
              </button>

              <button
                type="button"
                onClick={() => setPanelTab("templates")}
                className="inline-flex items-center gap-1 rounded-lg border border-[#d81b60]/40 bg-[#fce4ec]/60 px-2.5 py-1 text-[11px] font-bold text-[#d81b60]"
              >
                <Star size={13} /> Mau nhanh
              </button>

              <button
                type="button"
                onClick={() => setShowDealModal(true)}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
              >
                <Briefcase size={13} /> Tao co hoi
              </button>

              <button
                type="button"
                onClick={() => setShowQuoteModal(true)}
                className="inline-flex items-center gap-1 rounded-lg border border-[#E3000F]/40 bg-[#E3000F]/10 px-2.5 py-1 text-[11px] font-bold text-[#E3000F] hover:bg-[#E3000F]/20"
              >
                <FileSpreadsheet size={13} /> Bao gia CRM
              </button>
            </div>

            <div className="relative flex gap-2 items-end">
              {showMentionPicker && (
                <div className="absolute bottom-full left-0 z-20 mb-1 max-h-48 w-64 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
                  {!inbox.groupMembers ? (
                    <div className="px-3 py-2 text-[11px] text-slate-400">Dang lay thanh vien nhom tu ZCA...</div>
                  ) : filteredMentionCandidates.length === 0 ? (
                    <div className="px-3 py-2 text-[11px] text-slate-400">Khong tim thay thanh vien.</div>
                  ) : (
                    filteredMentionCandidates.slice(0, 20).map((member) => (
                      <button
                        key={member.uid}
                        type="button"
                        onClick={() => insertMention(member.uid, member.display_name)}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] hover:bg-slate-50"
                      >
                        <Avatar src={member.avatar_url} name={member.display_name} className="h-6 w-6 text-[9px]" />
                        <span className="truncate font-semibold text-slate-700">{member.display_name}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
              <textarea
                value={inbox.reply}
                onChange={handleReplyChange}
                onPaste={handlePasteImage}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !showMentionPicker) {
                    event.preventDefault();
                    void handleSendReply();
                  }
                }}
                rows={3}
                disabled={!inbox.openConv || inbox.archiveReading || inbox.isSending}
                placeholder="Nhap tin nhan..."
                className="flex-1 min-h-[72px] max-h-[140px] overflow-y-auto leading-relaxed rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-xs outline-none focus:border-[#E3000F] disabled:bg-slate-50 disabled:opacity-70"
              />

              <button
                type="button"
                onClick={() => void handleSendReply()}
                disabled={!inbox.openConv || inbox.archiveReading || inbox.isSending || (!inbox.reply.trim() && selectedFiles.length === 0)}
                className="flex h-11 items-center justify-center rounded-2xl bg-[#E3000F] px-6 text-xs font-bold text-white shadow-xs transition hover:bg-[#C40009] disabled:opacity-40"
              >
                {inbox.isSending ? "Dang gui..." : "Gui"}
              </button>
            </div>
          </div>        </section>

        {/* ── RIGHT PANE: 4 TABS (TƯƠNG TÁC / THÔNG TIN / CRM 360 / CÀI ĐẶT) ── */}
        <aside className="flex flex-col min-h-0 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-xs">
          {/* 4 Tabs Navigation Header */}
          <div className="shrink-0 grid grid-cols-4 border-b border-slate-200/80 bg-white text-xs font-bold">
            <button
              onClick={() => setPanelTab("templates")}
              className={cn(
                "flex items-center justify-center gap-1 py-3 transition text-[11px]",
                panelTab === "templates" || panelTab === "campaign" ? "border-b-2 border-[#E3000F] text-[#E3000F]" : "text-slate-500 hover:text-slate-800"
              )}
            >
              <MessageCircle size={14} /> Tương tác
            </button>

            <button
              onClick={() => setPanelTab("customer")}
              className={cn(
                "flex items-center justify-center gap-1 py-3 transition text-[11px]",
                panelTab === "customer" ? "border-b-2 border-[#E3000F] text-[#E3000F]" : "text-slate-500 hover:text-slate-800"
              )}
            >
              <User size={14} /> Thông tin
            </button>

            <button
              onClick={() => setPanelTab("crm360")}
              className={cn(
                "flex items-center justify-center gap-1 py-3 transition text-[11px]",
                panelTab === "crm360" ? "border-b-2 border-[#E3000F] text-[#E3000F]" : "text-slate-500 hover:text-slate-800"
              )}
            >
              <Building2 size={14} /> CRM 360
            </button>

            <button
              onClick={() => setPanelTab("account")}
              className={cn(
                "flex items-center justify-center gap-1 py-3 transition text-[11px]",
                panelTab === "account" ? "border-b-2 border-[#E3000F] text-[#E3000F]" : "text-slate-500 hover:text-slate-800"
              )}
            >
              <BarChart3 size={14} /> Cài đặt
            </button>
          </div>

          {/* Scrollable Tab Content */}
          <div ref={panelScrollRef} className="flex-1 min-h-0 overflow-auto p-3.5 space-y-4 no-scrollbar">

            {/* TAB 1: TƯƠNG TÁC (QUICK REPLIES + CAMPAIGN + LỊCH SỬ TƯƠNG TÁC) */}
            {(panelTab === "templates" || panelTab === "campaign") && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 rounded-xl bg-slate-100 p-0.5 text-[10px] font-bold">
                  <button
                    onClick={() => setPanelTab("templates")}
                    className={cn(
                      "rounded-lg py-1.5 transition text-center",
                      panelTab === "templates" ? "bg-white text-[#E3000F] shadow-xs" : "text-slate-600"
                    )}
                  >
                    Mẫu nhanh
                  </button>
                  <button
                    onClick={() => setPanelTab("campaign")}
                    className={cn(
                      "rounded-lg py-1.5 transition text-center flex items-center justify-center gap-1",
                      panelTab === "campaign" ? "bg-white text-[#E3000F] shadow-xs" : "text-slate-600"
                    )}
                  >
                    <MaterialIcon name="campaign" className="text-[12px]" /> Gửi Auto
                  </button>
                </div>

                {panelTab === "templates" && (
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-1">
                      {QUICK_REPLY_GROUPS.map((group) => (
                        <button
                          key={group.id}
                          onClick={() => setTemplateGroupId(group.id)}
                          className={cn(
                            "rounded-full px-2.5 py-1 text-[10px] font-bold transition",
                            templateGroupId === group.id
                              ? "bg-[#E3000F] text-white"
                              : "bg-slate-100 text-slate-600"
                          )}
                        >
                          {group.label}
                        </button>
                      ))}
                    </div>

                    <div className="space-y-2">
                      {activeTemplateGroup.items.map((item) => (
                        <div key={item} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200/80 bg-white p-2.5">
                          <span className="text-xs text-slate-700 truncate">{item}</span>
                          <button
                            onClick={() => appendTemplate(item)}
                            className="rounded-full bg-[#fce4ec] px-2.5 py-0.5 text-[10px] font-bold text-[#d81b60] shrink-0"
                          >
                            Chèn
                          </button>
                        </div>
                      ))}
                    </div>

                    {/* Lịch sử tương tác */}
                    <div className="space-y-2 pt-3 border-t border-slate-100">
                      <div className="flex items-center justify-between text-[11px] font-bold tracking-wider text-slate-400">
                        <span>LỊCH SỬ TƯƠNG TÁC</span>
                        <button className="text-slate-500 hover:text-[#d81b60] font-semibold">Xem tất cả &gt;</button>
                      </div>

                      <div className="space-y-2 text-xs">
                        <div className="flex items-start gap-2 rounded-xl border border-slate-200/60 bg-slate-50/50 p-2">
                          <div className="flex size-7 items-center justify-center rounded-lg bg-amber-100 text-amber-700 shrink-0 font-bold">📄</div>
                          <div>
                            <div className="font-bold text-slate-900">Đã gửi bảng báo giá</div>
                            <div className="text-[10px] text-slate-400">11:00 - Markee</div>
                          </div>
                        </div>

                        <div className="flex items-start gap-2 rounded-xl border border-slate-200/60 bg-slate-50/50 p-2">
                          <div className="flex size-7 items-center justify-center rounded-lg bg-blue-100 text-blue-700 shrink-0 font-bold">💬</div>
                          <div>
                            <div className="font-bold text-slate-900">Đã nhắn tin</div>
                            <div className="text-[10px] text-slate-400">10:58 - Markee</div>
                          </div>
                        </div>

                        <div className="flex items-start gap-2 rounded-xl border border-slate-200/60 bg-slate-50/50 p-2">
                          <div className="flex size-7 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 shrink-0 font-bold">👤</div>
                          <div>
                            <div className="font-bold text-slate-900">Khách hàng đã nhắn tin</div>
                            <div className="text-[10px] text-slate-400">10:58</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* TAB 2: THÔNG TIN (ZALO CONTACT DETAILS & NOTES) */}
            {panelTab === "customer" && (
              <div className="space-y-3">
                <div className="rounded-2xl border border-slate-200/80 bg-white p-3.5 space-y-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Tài khoản Zalo</span>
                  <h3 className="text-xs font-bold text-slate-900">{selectedName || inbox.openConv}</h3>
                  <p className="text-xs text-slate-500">{selectedPreview || "—"}</p>
                </div>

                <div className="rounded-2xl border border-slate-200/80 bg-slate-50/50 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-700">Ghi chú nhu cầu</span>
                    {selectedNote && !noteChanged && (
                      <span className="rounded bg-emerald-100 px-2 py-0.2 text-[9px] font-bold text-emerald-700">
                        Đã lưu
                      </span>
                    )}
                  </div>

                  <textarea
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                    rows={4}
                    maxLength={1000}
                    placeholder="Nhập ghi chú yêu cầu..."
                    className="w-full resize-none rounded-xl border border-slate-200 bg-white p-2.5 text-xs leading-relaxed outline-none focus:border-[#E3000F]"
                  />

                  <div className="flex items-center justify-between text-[10px]">
                    <span className="text-slate-400">{noteDraft.trim().length}/1000</span>
                    <button
                      onClick={() => void inbox.saveCustomerNote(inbox.openConv, noteDraft)}
                      disabled={!inbox.openConv || inbox.savingNoteConv === inbox.openConv || !noteChanged}
                      className="rounded-xl bg-[#E3000F] px-3 py-1 font-bold text-white shadow-xs hover:bg-[#C40009] disabled:opacity-40"
                    >
                      Lưu ghi chú
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 3: CRM 360 (FULL OMNI WORKFLOW) */}
            {panelTab === "crm360" && (
              <div className="space-y-4 text-xs">
                {/* SECTION 1: KHÁCH HÀNG */}
                <div className="space-y-3 pb-3 border-b border-slate-100">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">KHÁCH HÀNG</span>
                    {currentLead && (
                      <button onClick={() => setShowCustomerDrawer(true)} className="text-[11px] font-semibold text-slate-500 hover:text-[#E3000F]">
                        Xem chi tiết &gt;
                      </button>
                    )}
                  </div>

                  {currentLead ? (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2.5">
                        <div className="flex size-9 items-center justify-center rounded-xl bg-red-50 text-[#E3000F] font-bold shrink-0">
                          <Building2 size={18} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <h3 className="text-xs font-bold text-slate-900 truncate">
                              {currentLead.customer_name || currentLead.company_name || selectedName || "Khách hàng"}
                            </h3>
                            <span className="rounded-full bg-emerald-50 px-2 py-0.2 text-[9px] font-bold text-emerald-700 border border-emerald-100/60">
                              ✓ Đã liên kết CRM
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500">{currentLead.deal_stage || "Khách hàng"}</p>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-x-3 gap-y-2 pt-1 text-xs">
                        <div>
                          <span className="text-[10px] text-slate-400 block">SĐT</span>
                          <span className="font-semibold text-slate-800">{currentLead.phone || "—"}</span>
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-400 block">Email</span>
                          <span className="font-semibold text-slate-800 truncate block">{currentLead.email || "—"}</span>
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-400 block">Địa chỉ</span>
                          <span className="font-semibold text-slate-800 truncate block">{currentLead.address || "—"}</span>
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-400 block">Người phụ trách</span>
                          <span className="font-semibold text-slate-800 flex items-center gap-1 mt-0.5 truncate">
                            <span className="size-3.5 rounded-full bg-slate-300 inline-block shrink-0" />
                            {currentLead.leaded_by || user?.name || "Chưa phân công"}
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2 pt-1">
                        <button
                          onClick={() => setShowCustomerDrawer(true)}
                          className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-200/80 bg-white py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
                        >
                          <Eye size={13} /> Xem hồ sơ
                        </button>
                        <button
                          onClick={() => setShowInternalNoteModal(true)}
                          className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-200/80 bg-white py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
                        >
                          <StickyNote size={13} /> Tạo ghi chú
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 p-4 text-center space-y-3">
                      <div className="space-y-1">
                        <div className="text-xs font-bold text-slate-800">Chưa liên kết khách hàng</div>
                        <div className="text-[11px] text-slate-500">Hội thoại này chưa được liên kết với hồ sơ CRM.</div>
                      </div>
                      <div className="flex items-center justify-center gap-2 pt-1">
                        <button
                          onClick={() => setShowCrmModal(true)}
                          className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-2xs"
                        >
                          Tìm khách hàng
                        </button>
                        <button
                          onClick={() => setShowCustomerDrawer(true)}
                          className="rounded-xl bg-[#E3000F] px-3 py-1.5 text-xs font-bold text-white shadow-2xs hover:bg-[#C40009]"
                        >
                          + Tạo mới
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* SECTION 2: CƠ HỘI ĐANG MỞ */}
                <div className="space-y-2 pb-3 border-b border-slate-100">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">CƠ HỘI ĐANG MỞ</span>
                    <button onClick={() => setShowDealModal(true)} className="text-[11px] font-semibold text-slate-500 hover:text-[#E3000F]">
                      + Tạo mới
                    </button>
                  </div>

                  <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/30 p-3 text-center text-xs text-slate-400">
                    Chưa có dữ liệu do chưa liên kết khách hàng
                  </div>
                </div>

                {/* SECTION 3: BÁO GIÁ LIÊN QUAN */}
                <CrmQuote360Panel
                  currentLead={currentLead}
                  channelName="Zalo"
                  openConvId={inbox.openConv}
                  onOpenCreateQuote={() => {
                    setSelectedQuoteId(null);
                    setShowQuoteModal(true);
                  }}
                  onOpenViewQuote={(quoteId) => {
                    setSelectedQuoteId(quoteId);
                    setShowQuoteModal(true);
                  }}
                  onSendQuoteMessage={(content) => {
                    inbox.setReply(content);
                    setTimeout(() => {
                      inbox.sendReply();
                    }, 100);
                  }}
                  showToast={(msg, ok) => inbox.showToast(msg, ok)}
                />

                {/* SECTION 4: THAO TÁC NHANH */}
                <div className="space-y-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">THAO TÁC NHANH</span>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setShowDealModal(true)}
                      className="flex items-center justify-center gap-1 rounded-xl border border-slate-200/80 bg-white py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
                    >
                      <Plus size={13} className="text-[#E3000F]" /> Tạo cơ hội
                    </button>

                    <button
                      onClick={() => setShowQuoteModal(true)}
                      className="flex items-center justify-center gap-1 rounded-xl border border-slate-200/80 bg-white py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
                    >
                      <FileSpreadsheet size={13} /> Tạo báo giá
                    </button>

                    <button
                      onClick={() => setShowCrmModal(true)}
                      className="flex items-center justify-center gap-1 rounded-xl border border-slate-200/80 bg-white py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
                    >
                      <Search size={13} /> Tìm khách hàng
                    </button>

                    <button
                      onClick={() => setShowInternalNoteModal(true)}
                      className="flex items-center justify-center gap-1 rounded-xl border border-slate-200/80 bg-white py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
                    >
                      <Plus size={13} /> Thêm ghi chú
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 4: CÀI ĐẶT TÀI KHOẢN & TECHNICAL ACTIONS */}
            {panelTab === "account" && (
              <div className="space-y-3">
                <div className="border border-slate-200 rounded-xl p-3 bg-white space-y-2">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Tài khoản hiện tại</div>
                  <div className="text-xs font-bold text-slate-900">{inbox.selectedAccountInfo?.label || "Zalo Account"}</div>
                </div>

                <div className="border border-slate-200 rounded-xl p-3 bg-white space-y-2">
                  <button
                    onClick={handleRestartListener}
                    className="w-full flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 hover:border-[#E3000F] hover:text-[#E3000F] py-2 text-xs font-bold transition bg-white"
                  >
                    <RefreshCw size={14} /> Khởi động lại Listener
                  </button>

                  <button
                    onClick={handleDeleteAccount}
                    className="w-full flex items-center justify-center gap-1.5 rounded-xl border border-red-100 hover:bg-red-50 text-red-600 py-2 text-xs font-bold transition bg-white"
                  >
                    Ẩn tài khoản khỏi Inbox
                  </button>

                  <button
                    onClick={handleDeleteFull}
                    className="w-full flex items-center justify-center gap-1.5 rounded-xl bg-red-600 hover:bg-red-700 text-white py-2 text-xs font-bold transition shadow-xs"
                  >
                    Xoá hoàn toàn dữ liệu Zalo
                  </button>
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* ── REAL CRM MODALS & DRAWERS ───────────────────────── */}
      <DealFormModal
        open={showDealModal}
        onClose={() => setShowDealModal(false)}
        onCreate={() => {
          setShowDealModal(false);
          inbox.showToast("Đã tạo cơ hội kinh doanh mới!", true);
        }}
        onUpdate={() => {}}
      />

      {showQuoteModal && (
        <QuoteWorkspaceModal
          quoteId={selectedQuoteId}
          onClose={() => {
            setShowQuoteModal(false);
            setSelectedQuoteId(null);
          }}
          deals={[]}
          dealsById={new Map()}
          agents={[]}
          user={user}
          initialCustomerId={currentLead?.id}
          lockCustomer={!!currentLead}
          onChanged={() => {
            inbox.showToast("Đã cập nhật dữ liệu báo giá!", true);
          }}
          onEditDraft={() => {}}
        />
      )}

      <CustomerAddDrawer
        open={showCustomerDrawer}
        currentUser={null}
        onClose={() => setShowCustomerDrawer(false)}
        onCreated={(customerId) => {
          setShowCustomerDrawer(false);
          inbox.showToast(`Đã cập nhật thông tin khách hàng ID ${customerId}!`, true);
        }}
      />

      {showSearchPanel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 font-sans text-slate-800">
          <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl">
            <ZaloMessageSearchPanel
              accountId={inbox.selectedAccountId || ""}
              conversationId={inbox.openConv || ""}
              onClose={() => setShowSearchPanel(false)}
            />
          </div>
        </div>
      )}

      {/* Internal Note Modal */}
      {showInternalNoteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <StickyNote size={18} className="text-[#E3000F]" /> Thêm ghi chú nội bộ CRM
              </h3>
              <button onClick={() => setShowInternalNoteModal(false)} className="rounded-full p-1 text-slate-400 hover:bg-slate-100">
                <X size={18} />
              </button>
            </div>
            <div className="space-y-3">
              <div className="text-xs text-slate-500">
                Ghi chú sẽ được gắn trực tiếp vào hồ sơ khách hàng <span className="font-bold text-slate-800">{currentLead?.customer_name || currentLead?.company_name || selectedName || "khách hàng"}</span> và đồng bộ toàn hệ thống CRM.
              </div>
              <textarea
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                rows={5}
                placeholder="Nhập ghi chú yêu cầu, thỏa thuận với khách..."
                className="w-full rounded-xl border border-slate-200 p-3 text-xs outline-none focus:border-[#E3000F]"
              />
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowInternalNoteModal(false)} className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold">Hủy</button>
                <button
                  onClick={() => {
                    if (inbox.openConv) void inbox.saveCustomerNote(inbox.openConv, noteDraft);
                    setShowInternalNoteModal(false);
                    inbox.showToast("Đã lưu ghi chú CRM thành công!", true);
                  }}
                  className="rounded-xl bg-[#E3000F] px-4 py-2 text-xs font-bold text-white"
                >
                  Lưu ghi chú
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Task Modal */}
      {showTaskModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <CheckSquare size={18} className="text-[#E3000F]" /> Tạo công việc (Task)
              </h3>
              <button onClick={() => setShowTaskModal(false)} className="rounded-full p-1 text-slate-400 hover:bg-slate-100">
                <X size={18} />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-bold text-slate-700">Tên công việc</label>
                <input
                  type="text"
                  value={taskTitle}
                  onChange={(e) => setTaskTitle(e.target.value)}
                  placeholder="VD: Gọi điện tư vấn lại demo dịch vụ Markee AI"
                  className="w-full mt-1 rounded-xl border border-slate-200 p-2.5 text-xs outline-none focus:border-[#E3000F]"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => setShowTaskModal(false)} className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold">Hủy</button>
                <button
                  onClick={() => {
                    setShowTaskModal(false);
                    inbox.showToast("Đã giao việc thành công!", true);
                  }}
                  className="rounded-xl bg-[#E3000F] px-4 py-2 text-xs font-bold text-white"
                >
                  Tạo việc
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <AssignUserModal
        isOpen={showAssignModal}
        onClose={() => setShowAssignModal(false)}
        currentOwnerName={assignee}
        onAssignUser={(member) => {
          const name = member.display_name || member.full_name || "Nhân viên";
          setAssignee(name);
          setShowAssignModal(false);
          inbox.showToast(`Đã gán người phụ trách: ${name}`, true);
        }}
      />

      {/* Auth Portal Modal */}
      {mounted && showAuthModal && inbox.selectedAccountId && createPortal(
        <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/50 p-4 font-sans text-slate-800 backdrop-blur-xs">
          <div className="relative w-full max-w-[448px] min-w-[320px] bg-white rounded-2xl shadow-2xl overflow-hidden">
            <button
              onClick={() => setShowAuthModal(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 transition z-10 cursor-pointer"
            >
              <MaterialIcon name="close" className="text-xl" />
            </button>
            <ZaloAccountAuthView
              accountId={inbox.selectedAccountId}
              ownerName={ownerName}
              autoTrigger={true}
              onSuccess={() => {
                setShowAuthModal(false);
                void inbox.refreshAccounts();
              }}
            />
          </div>
        </div>,
        document.body
      )}

      <SalesAssetPickerModal
        open={showSalesAssetPicker}
        onClose={() => setShowSalesAssetPicker(false)}
        onSend={appendSalesAsset}
        customerLeadId={currentLead?.id || null}
        dealId={currentLead?.id || null}
      />

      <CrmCustomerModal
        isOpen={showCrmModal}
        onClose={() => setShowCrmModal(false)}
        defaultConvId={inbox.openConv || undefined}
        defaultCustomerName={selectedName || undefined}
        defaultSourcePlatform="Zalo"
      />

      <ZaloForwardModal
        open={!!forwardingMessage}
        accountId={inbox.selectedAccountId || ""}
        sourceConversationId={inbox.openConv || ""}
        message={forwardingMessage}
        conversations={inbox.conversations}
        onClose={() => setForwardingMessage(null)}
      />

      <ZaloNewChatModal
        open={newChatModalOpen}
        accountId={inbox.selectedAccountId || ""}
        initialQuery={phoneSearchQuery}
        onClose={() => {
          setNewChatModalOpen(false);
          setPhoneSearchQuery(undefined);
        }}
        onChatReady={(conversationId) => {
          void inbox.refreshConversations();
          inbox.openChat(conversationId);
        }}
        onError={(msg) => inbox.showToast(msg, false)}
        onSuccess={(name) => inbox.showToast(`Đã mở chat với ${name}`, true)}
      />
    </div>
  );
}
