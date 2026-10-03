"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import type { RefObject } from "react";
import {
  Inbox as InboxIcon,
  Search,
  RefreshCw,
  Lock,
  UserSearch,
  ChevronDown,
  CheckCircle2,
  MessageCircle,
  User,
  BarChart3,
  Star,
  UserPlus,
  Send,
  FileText,
  Plus,
  AlertTriangle,
  Paperclip,
  Image as ImageIcon,
  Smile,
  MoreVertical,
  SlidersHorizontal,
  ExternalLink,
  Phone,
  Video,
  Download,
  FileIcon,
  Sparkles,
  Briefcase,
  FileSpreadsheet,
  CheckSquare,
  StickyNote,
  Eye,
  Tag,
  Building2,
  Calendar,
  DollarSign,
  UserCheck,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import TeamAccountTree from "@/components/all-platform/inbox/TeamAccountTree";
import { KpiProgressCard } from "@/components/all-platform/components/kpi-progress-card";
import { CrmCustomerModal } from "@/components/all-platform/components/CrmCustomerModal";
import { SalesAssetPickerModal } from "@/components/all-platform/sales-assets/SalesAssetPickerModal";
import { customerLeadService, type Customer } from "@/services/customer-lead.service";
import type { SalesAsset } from "@/services/sales-asset.service";
import { CustomerAddDrawer } from "@/modules/crm/components/CustomerAddDrawer";
import { DealFormModal } from "@/modules/crm/components/DealFormModal";
import { QuoteWorkspaceModal } from "@/modules/crm/components/QuoteWorkspaceModal";
import { AssignUserModal } from "@/modules/omnichannel/components/AssignUserModal";
import { CrmQuote360Panel } from "@/components/all-platform/inbox/CrmQuote360Panel";
import { useAppAuth } from "@/contexts/AppAuthContext";

function FacebookIcon({ className, size = 20 }: { className?: string; size?: number }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
    </svg>
  );
}

interface Session {
  user_id: string;
  fb_user_id?: string;
  label?: string;
  owner?: string;
  online?: boolean;
  inbox_enabled?: boolean;
  status?: string;
}

interface Conv {
  conv_id: string;
  name: string;
  preview: string;
  unread: boolean;
  time: string;
  is_customer: boolean;
  pushed_to_zalo: boolean;
  deleted: boolean;
  archived?: boolean;
  archived_at?: string;
}

interface ArchiveConv {
  conv_id: string;
  name: string;
  preview?: string;
  time?: string;
  archived_at?: string;
  last_saved_at?: string;
  archive_reason?: string;
  outcome?: string;
  note?: string;
  messages_count?: number;
  archived_by_name?: string;
  is_customer?: boolean;
  pushed_to_zalo?: boolean;
}

interface Msg {
  from: "me" | "them";
  text: string;
  time: string;
  clientId?: string;
}

interface UserRow {
  id?: string;
  email?: string;
  name?: string;
}

interface TeamRow {
  id?: string;
  name_team?: string;
  id_leader?: string;
  leader_name?: string;
  leader_email?: string;
  members?: UserRow[];
}

type InboxFilter = "all" | "unread" | "customer" | "need_reply" | "need_verify";
type InboxViewMode = "inbox" | "archive";

interface Props {
  displayScope?: "mine" | "team" | "all";
  onScopeChange?: (scope: "mine" | "team" | "all") => void;
  role: string;
  owner: string;
  sessions: Session[];
  rawSessions?: Session[];
  allowedOwnerIds?: Set<string> | null;
  extraAccountIds?: Set<string>;
  toggleExtraAccount?: (userId: string) => void;
  ownerNames: Record<string, string>;
  teams: TeamRow[];
  acc: string;
  accOnline: boolean;
  accPaused: boolean;
  needRelogin: boolean;
  needsPin?: boolean;
  needsPinMessage?: string;
  connErr: boolean;
  extInstalled: boolean | null;
  scanning: boolean;
  loadingConvs: boolean;
  loadingArchives: boolean;
  loadingChat: boolean;
  loadingFresh: boolean;
  archiveReading: boolean;
  viewMode: InboxViewMode;
  filter: InboxFilter;
  activeConvs: Conv[];
  filtered: Conv[];
  allConvs?: Conv[];
  loadingAllConvs?: boolean;
  onRequestAllConvs?: () => void;
  archives: ArchiveConv[];
  openConv: string;
  msgs: Msg[];
  reply: string;
  customerNotes: Record<string, string>;
  savingNoteConv: string;
  toast: { msg: string; ok: boolean } | null;
  chatScrollRef: RefObject<HTMLDivElement | null>;
  selectAcc: (uid: string) => void;
  scan: () => void;
  setViewMode: (mode: InboxViewMode) => void;
  setArchiveReading: (value: boolean) => void;
  setFilter: (filter: InboxFilter) => void;
  setReply: (value: string) => void;
  openChat: (convId: string) => void;
  hoverConv?: (convId: string) => void;
  openArchive: (convId: string) => void;
  mark: (convId: string, field: string, value: boolean) => void;
  saveArchive: (convId: string, hide?: boolean) => void;
  saveCustomerNote: (convId: string, note: string) => void;
  sendReply: () => void;
  needsReply: (conv: Conv) => boolean;
  accLabel: (session: Session) => string;
  syncFbInbox: (payload: {
    leader_email: string;
    member_email: string;
    conv_ids: string[];
    user_id: string;
    is_lead: boolean;
  }) => Promise<void>;
  verifiedConvIds: Set<string>;
  verifiedConvDates?: Record<string, string>;
  inboxKpiWeekDates?: Record<string, string>;
  userEmail: string;
  ownerEmail: string;
  accountOwnerEmail: string;
}

const QUICK_REPLY_GROUPS = [
  {
    id: "greeting",
    label: "Chào hỏi",
    items: [
      {
        title: "Chào hỏi khách mới",
        text: "Chào bạn, bên mình có thể hỗ trợ bạn phần nào ạ?",
      },
      {
        title: "Cảm ơn khách hàng",
        text: "Dạ em cảm ơn anh/chị đã phản hồi ạ! Bên em sẽ hỗ trợ anh/chị ngay nhé.",
      },
      {
        title: "Tư vấn ban đầu",
        text: "Dạ mình đang xem thông tin, bạn cho mình xin thêm nhu cầu cụ thể nhé.",
      },
    ],
  },
  {
    id: "quote",
    label: "Báo giá",
    items: [
      {
        title: "Báo giá sản phẩm",
        text: "Dạ em gửi anh/chị bảng báo giá chi tiết sản phẩm theo yêu cầu ạ.",
      },
      {
        title: "Báo giá theo số lượng",
        text: "Dạ để báo giá chính xác, bạn cho mình xin số lượng và khu vực cần triển khai nhé.",
      },
    ],
  },
  {
    id: "followup",
    label: "Follow-up",
    items: [
      {
        title: "Follow-up sau tư vấn",
        text: "Dạ em xin phép hỏi anh/chị đã xem thông tin và có cần hỗ trợ gì thêm không ạ?",
      },
    ],
  },
  {
    id: "handoff",
    label: "Chuyển lead",
    items: [
      {
        title: "Chuyển lead",
        text: "Dạ em đã ghi nhận thông tin và chuyển bộ phận liên quan hỗ trợ anh/chị ạ.",
      },
    ],
  },
];

const AI_SUGGESTIONS = [
  "Gợi ý gói Enterprise",
  "Hỗ trợ triển khai",
  "Xin thông tin chi tiết",
  "Cảm ơn khách hàng",
];

const EMOJIS = ["👍", "❤️", "😊", "🙏", "🔥", "🎉", "👌", "👏", "😃", "📞", "💼", "✨"];

function displayMessage(message: Msg): { content: string; time: string } {
  const matched = message.text.match(/^Tin nhắn do .+? gửi lúc (.+?):\s*([\s\S]*)$/i);
  let content = matched ? (matched[2] || "").trim() : message.text;
  const time = matched ? (matched[1] || "").trim() : message.time || "";
  const stripped = content.replace(/^(?:(?:Thứ\s+\S+\s+)?\d{1,2}(?::\d{2})?(?:sáng|chiều|ch|sa|CH|SA|AM|PM)?)\s*[:\n]+\s*/i, "").trim();
  if (stripped) content = stripped;
  return { content, time };
}

function statusDotClass(status?: string): string {
  if (status === "online") return "bg-emerald-500";
  if (status === "paused") return "bg-amber-400";
  return "bg-slate-300";
}

function statusLabel(status?: string): string {
  if (status === "online") return "online";
  if (status === "paused") return "paused";
  return "offline";
}

export default function InboxModernLayout(props: Props) {
  const { user } = useAppAuth();
  const {
    displayScope = "all",
    onScopeChange,
    role,
    owner,
    sessions,
    rawSessions = [],
    allowedOwnerIds = null,
    extraAccountIds = new Set<string>(),
    toggleExtraAccount,
    ownerNames,
    teams,
    acc,
    accOnline,
    accPaused,
    needRelogin,
    needsPin = false,
    needsPinMessage = "",
    connErr,
    extInstalled,
    scanning,
    loadingConvs,
    loadingArchives,
    loadingChat,
    loadingFresh,
    archiveReading,
    viewMode,
    filter,
    activeConvs,
    filtered,
    allConvs = [],
    loadingAllConvs = false,
    onRequestAllConvs,
    archives,
    openConv,
    msgs,
    reply,
    customerNotes,
    savingNoteConv,
    toast,
    chatScrollRef,
    selectAcc,
    scan,
    setViewMode,
    setArchiveReading,
    setFilter,
    setReply,
    openChat,
    hoverConv,
    openArchive,
    mark,
    saveArchive,
    saveCustomerNote,
    sendReply,
    needsReply,
    accLabel,
    syncFbInbox,
    verifiedConvIds,
    verifiedConvDates = {},
    inboxKpiWeekDates = {},
    userEmail,
    ownerEmail,
    accountOwnerEmail,
  } = props;

  const [templateGroupId, setTemplateGroupId] = useState(QUICK_REPLY_GROUPS[0].id);
  const [kpiToast, setKpiToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [noteDraftState, setNoteDraftState] = useState({ convId: "", value: "" });

  // Real CRM Modals & Drawers State
  const [showLeadModal, setShowLeadModal] = useState(false);
  const [showSalesAssetPicker, setShowSalesAssetPicker] = useState(false);
  const [showDealModal, setShowDealModal] = useState(false);
  const [showQuoteModal, setShowQuoteModal] = useState(false);
  const [selectedQuoteId, setSelectedQuoteId] = useState<string | null>(null);
  const [showCustomerDrawer, setShowCustomerDrawer] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [showInternalNoteModal, setShowInternalNoteModal] = useState(false);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  // Form State for Drawers
  const [dealTitle, setDealTitle] = useState("");
  const [dealValue, setDealValue] = useState("50.000.000");
  const [quoteTitle, setQuoteTitle] = useState("");
  const [quoteValue, setQuoteValue] = useState("50.000.000");

  // File Inputs Refs
  const documentInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const [currentLead, setCurrentLead] = useState<Customer | null>(null);
  const [accountDropdownOpen, setAccountDropdownOpen] = useState(false);
  const [assignee, setAssignee] = useState(userEmail || "Chưa phân công");
  const [taskTitle, setTaskTitle] = useState("");

  const selectedSession = sessions.find(s => s.user_id === acc);
  const selectedConv = activeConvs.find(c => c.conv_id === openConv) || filtered.find(c => c.conv_id === openConv);
  const selectedArchive = archives.find(a => a.conv_id === openConv);
  const selectedName = archiveReading ? selectedArchive?.name : selectedConv?.name;
  const selectedPreview = archiveReading ? selectedArchive?.preview : selectedConv?.preview;
  const selectedNote = openConv ? customerNotes[openConv] ?? selectedArchive?.note ?? "" : "";
  const activeTemplateGroup = QUICK_REPLY_GROUPS.find(g => g.id === templateGroupId) || QUICK_REPLY_GROUPS[0];
  const noteDraft = noteDraftState.convId === openConv ? noteDraftState.value : selectedNote;
  const setNoteDraft = (value: string) => setNoteDraftState({ convId: openConv, value });

  const stats = useMemo(
    () => ({
      unread: activeConvs.filter(c => c.unread).length,
      need: activeConvs.filter(needsReply).length,
      customers: activeConvs.filter(c => c.is_customer).length,
      pushed: activeConvs.filter(c => c.pushed_to_zalo).length,
    }),
    [activeConvs, needsReply]
  );

  const canSend = !!openConv && !archiveReading && accOnline && !accPaused && !needRelogin;

  const appendTemplate = (text: string) => setReply(reply.trim() ? `${reply.trim()}\n${text}` : text);

  const appendAiSuggestion = (suggestion: string) => {
    const textToInsert = suggestion === "Gợi ý gói Enterprise"
      ? "Chào anh, em gửi anh thông tin các gói Enterprise phù hợp với quy mô doanh nghiệp mình nhé ạ."
      : suggestion === "Hỗ trợ triển khai"
      ? "Bên em sẽ hỗ trợ triển khai setup trực tiếp và đào tạo nhân viên sử dụng chi tiết ạ."
      : suggestion === "Xin thông tin chi tiết"
      ? "Anh/chị có thể cho em xin số điện thoại hoặc nhu cầu cụ thể để bên em tư vấn tốt hơn ạ?"
      : "Dạ em cảm ơn anh/chị đã quan tâm!";
    setReply(reply.trim() ? `${reply.trim()}\n${textToInsert}` : textToInsert);
  };

  const appendSalesAsset = (asset: SalesAsset) => {
    const link = asset.sourceUrl || asset.shareUrl;
    const meta = [asset.projectName, asset.version].filter(Boolean).join(" - ");
    const text = `${asset.title}${meta ? ` (${meta})` : ""}\n${link}`;
    setReply(reply.trim() ? `${reply.trim()}\n${text}` : text);
    setShowSalesAssetPicker(false);
    showToastKpi("Đã chèn tài liệu vào ô trả lời.", true);
  };

  const handleDocumentSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const textToAppend = `📎 [Tài liệu] ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
    setReply(reply ? `${reply}\n${textToAppend}` : textToAppend);
    showToastKpi(`Đã đính kèm tài liệu: ${file.name}`, true);
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const textToAppend = `🖼 [Hình ảnh] ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
    setReply(reply ? `${reply}\n${textToAppend}` : textToAppend);
    showToastKpi(`Đã đính kèm hình ảnh: ${file.name}`, true);
  };

  const insertEmoji = (emoji: string) => {
    setReply(reply + emoji);
    setShowEmojiPicker(false);
  };

  useEffect(() => {
    if (!openConv) {
      void Promise.resolve().then(() => setCurrentLead(null));
      return;
    }
    let cancelled = false;
    void Promise.resolve().then(async () => {
      try {
        const lead = await customerLeadService.getByConvId(openConv);
        if (!cancelled) setCurrentLead(lead);
      } catch {
        if (!cancelled) setCurrentLead(null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [openConv]);

  const showToastKpi = (msg: string, ok: boolean) => {
    setKpiToast({ msg, ok });
    setTimeout(() => setKpiToast(null), 3500);
  };

  const switchInbox = () => {
    setViewMode("inbox");
    setArchiveReading(false);
  };

  const confirmHide = (conv: Conv) => {
    if (window.confirm(`Ẩn "${conv.name || "hội thoại này"}" khỏi hộp thư?`)) {
      saveArchive(conv.conv_id, true);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-80px)] max-h-[calc(100vh-80px)] overflow-hidden text-slate-800 bg-white p-4 gap-3">
      {/* Hidden File Inputs for Native Attachments */}
      <input type="file" ref={documentInputRef} onChange={handleDocumentSelect} className="hidden" />
      <input type="file" accept="image/*" ref={imageInputRef} onChange={handleImageSelect} className="hidden" />

      {/* ── 1. HEADER CHÍNH ───────────────────────────────── */}
      <div className="shrink-0 flex items-center justify-between border-b border-slate-100 pb-3">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-2xl bg-[#1877f2] text-white shadow-xs shrink-0">
            <FacebookIcon size={24} />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
              Inbox Facebook
            </h1>
            <p className="text-xs text-slate-500">
              Quản lý hội thoại Facebook Messenger theo tài khoản nhân viên
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Service Status Badge */}
          <div className={cn(
            "flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-semibold border",
            connErr ? "bg-red-50 text-red-700 border-red-200" :
            !accOnline ? "bg-amber-50 text-amber-700 border-amber-200" :
            "bg-emerald-50 text-emerald-700 border-emerald-200"
          )}>
            <span className={cn("size-2 rounded-full",
              connErr ? "bg-red-500 animate-pulse" :
              !accOnline ? "bg-amber-500" :
              "bg-emerald-500"
            )} />
            {connErr ? "Mất kết nối service" : !accOnline ? "Tài khoản offline" : "Service đang chạy"}
          </div>

          {/* Sync Button */}
          <button
            onClick={scan}
            disabled={scanning || !acc || !accOnline || needRelogin}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-700 shadow-xs transition hover:bg-slate-50 hover:text-[#d81b60] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw size={14} className={scanning ? "animate-spin" : ""} />
            {scanning ? "Đang đồng bộ..." : "Đồng bộ"}
          </button>

          {/* Quét ngay button */}
          <button
            onClick={scan}
            disabled={scanning || !acc || !accOnline}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#d81b60] px-4 text-xs font-bold text-white shadow-xs transition hover:bg-[#c2185b] disabled:opacity-50"
          >
            <RefreshCw size={14} className={scanning ? "animate-spin" : ""} />
            Quét ngay
          </button>

          {/* Thêm tài khoản button */}
          <a
            href="/all-platform/quan-ly-tai-khoan"
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-700 shadow-xs transition hover:bg-slate-50"
          >
            <Plus size={15} />
            Thêm tài khoản khác
          </a>
        </div>
      </div>

      {/* ── 2. TOP CARDS ROW: ACCOUNT TOOLBAR (LEFT) & MINI KPI STRIP (RIGHT) ── */}
      <div className="shrink-0 grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-3">
        {/* Left Card: Account Selector & Actions */}
        <div className="flex flex-col justify-between rounded-2xl border border-slate-200/80 bg-white p-3.5 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2 mb-2">
            <div className="text-xs font-bold text-slate-800">TÀI KHOẢN NHÂN VIÊN</div>
            
            {/* Phạm vi hiển thị Radio Group */}
            <div className="flex items-center gap-3 text-xs">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Phạm vi hiển thị:</span>
              <label className="inline-flex items-center gap-1.5 cursor-pointer font-bold text-slate-700 hover:text-[#d81b60] transition">
                <input
                  type="radio"
                  name="displayScope"
                  value="mine"
                  checked={displayScope === "mine"}
                  onChange={() => onScopeChange?.("mine")}
                  className="accent-[#d81b60] cursor-pointer"
                />
                Của tôi
              </label>
              <label className="inline-flex items-center gap-1.5 cursor-pointer font-bold text-slate-700 hover:text-[#d81b60] transition">
                <input
                  type="radio"
                  name="displayScope"
                  value="team"
                  checked={displayScope === "team"}
                  onChange={() => onScopeChange?.("team")}
                  className="accent-[#d81b60] cursor-pointer"
                />
                Team Sales
              </label>
              <label className="inline-flex items-center gap-1.5 cursor-pointer font-bold text-slate-700 hover:text-[#d81b60] transition">
                <input
                  type="radio"
                  name="displayScope"
                  value="all"
                  checked={displayScope === "all"}
                  onChange={() => onScopeChange?.("all")}
                  className="accent-[#d81b60] cursor-pointer"
                />
                Tất cả
              </label>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Active Account Info */}
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="flex size-10 items-center justify-center rounded-full bg-[#1877f2]/10 font-bold text-[#1877f2] text-sm shrink-0">
                  {(selectedSession ? accLabel(selectedSession) : sessions.length > 0 ? accLabel(sessions[0]) : "FB").charAt(0).toUpperCase()}
                </div>
                <span className={cn("absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-white", statusDotClass(selectedSession?.status))} />
              </div>

              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold text-slate-900">
                    {selectedSession ? accLabel(selectedSession) : sessions.length > 0 ? accLabel(sessions[0]) : "Chưa có tài khoản Facebook"}
                  </span>
                  <ChevronDown size={14} className="text-slate-400" />
                </div>
                <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                  <span>{selectedSession?.owner ? ownerNames[selectedSession.owner] || selectedSession.owner : (userEmail || "Chưa chọn nhân viên")}</span>
                  <span>·</span>
                  <span className={cn("font-medium", selectedSession?.status === "online" ? "text-emerald-600" : "text-slate-400")}>
                    {selectedSession?.status === "online" ? "Online ●" : "Offline ●"}
                  </span>
                </div>
              </div>
            </div>

            {/* Action Buttons Row */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setAccountDropdownOpen(v => !v)}
                className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                <span>🔄 Đổi tài khoản</span>
              </button>

              <div className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700">
                <span>🔌 Extension</span>
                <span className={cn("size-2 rounded-full", extInstalled ? "bg-emerald-500" : "bg-amber-500")} />
              </div>

              <button
                onClick={scan}
                disabled={scanning}
                className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                <RefreshCw size={13} className={scanning ? "animate-spin" : ""} />
                Quét hội thoại
              </button>

              <a
                href="/all-platform/quan-ly-tai-khoan"
                className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                <Plus size={13} /> Thêm tài khoản
              </a>
            </div>
          </div>
        </div>

        {/* Right Card: Mini KPI Cards Strip */}
        <div className="flex items-center gap-3 rounded-2xl border border-slate-200/80 bg-white p-3.5 shadow-xs">
          <div className="flex items-center gap-2.5 rounded-xl bg-blue-50/80 px-3 py-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-blue-100 text-blue-600">
              <MessageCircle size={16} />
            </div>
            <div>
              <div className="text-[10px] font-medium text-slate-500">Hội thoại</div>
              <div className="text-base font-bold text-slate-900 leading-tight">{activeConvs.length}</div>
            </div>
          </div>

          <div className="flex items-center gap-2.5 rounded-xl bg-red-50/80 px-3 py-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-red-100 text-red-500">
              <InboxIcon size={16} />
            </div>
            <div>
              <div className="text-[10px] font-medium text-slate-500">Chưa đọc</div>
              <div className="text-base font-bold text-red-600 leading-tight">{stats.unread}</div>
            </div>
          </div>

          <div className="flex items-center gap-2.5 rounded-xl bg-amber-50/80 px-3 py-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-amber-100 text-amber-500">
              <RefreshCw size={16} />
            </div>
            <div>
              <div className="text-[10px] font-medium text-slate-500">Cần trả lời</div>
              <div className="text-base font-bold text-amber-600 leading-tight">{stats.need}</div>
            </div>
          </div>

          <div className="flex items-center gap-2.5 rounded-xl bg-emerald-50/80 px-3 py-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600">
              <Star size={16} />
            </div>
            <div>
              <div className="text-[10px] font-medium text-slate-500">Lead đã lưu</div>
              <div className="text-base font-bold text-emerald-600 leading-tight">{stats.customers}</div>
            </div>
          </div>

          <div className="flex items-center gap-2.5 rounded-xl bg-purple-50/80 px-3 py-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-purple-100 text-purple-600">
              <User size={16} />
            </div>
            <div>
              <div className="text-[10px] font-medium text-slate-500">Online</div>
              <div className="text-base font-bold text-purple-600 leading-tight">
                {sessions.filter(s => s.status === "online" || s.online).length}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── 3. WORKSPACE CHÍNH (3 PANES) ────────────────────────── */}
      <div className="flex-1 min-h-0 grid grid-cols-[310px_1fr_360px] gap-3">

        {/* ── LEFT PANE: HỘP THƯ CONVERSATION LIST (310px) ───── */}
        <section className="flex flex-col min-h-0 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-xs">
          {/* Header */}
          <div className="shrink-0 border-b border-slate-200/80 p-3.5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-slate-900">Hộp thư</h2>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">
                  {viewMode === "archive" ? archives.length : activeConvs.length}
                </span>
              </div>

              <div className="flex items-center gap-1.5">
                <button type="button" onClick={scan} className="p-1.5 text-slate-400 hover:text-slate-700">
                  <RefreshCw size={14} className={scanning ? "animate-spin" : ""} />
                </button>
                <button type="button" className="p-1.5 text-slate-400 hover:text-slate-700">
                  <SlidersHorizontal size={14} />
                </button>
              </div>
            </div>

            {/* Search */}
            <div className="relative">
              <Search size={14} className="absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                placeholder="Tìm tên, nội dung hội thoại..."
                className="w-full rounded-xl border border-slate-200 bg-white pl-8 pr-3 py-1.5 text-xs outline-none focus:border-[#d81b60]"
              />
            </div>

            {/* Filter Pills */}
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
              <button
                onClick={() => setFilter("all")}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-bold transition shrink-0",
                  filter === "all" ? "bg-[#d81b60] text-white" : "bg-slate-100 text-slate-600"
                )}
              >
                Tất cả <span className="ml-1 opacity-80">{viewMode === "archive" ? archives.length : activeConvs.length}</span>
              </button>

              <button
                onClick={() => setFilter("unread")}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-bold transition shrink-0",
                  filter === "unread" ? "bg-[#d81b60] text-white" : "bg-slate-100 text-slate-600"
                )}
              >
                Chưa đọc <span className="ml-1 opacity-80">{viewMode === "archive" ? 0 : stats.unread}</span>
              </button>

              <button
                onClick={() => setFilter("need_reply")}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-bold transition shrink-0",
                  filter === "need_reply" ? "bg-[#d81b60] text-white" : "bg-slate-100 text-slate-600"
                )}
              >
                Cần trả lời <span className="ml-1 opacity-80">{viewMode === "archive" ? 0 : stats.need}</span>
              </button>
            </div>

            {/* Subtabs */}
            <div className="grid grid-cols-2 rounded-xl bg-slate-100/80 p-1 text-xs font-bold">
              <button
                onClick={switchInbox}
                className={cn(
                  "rounded-lg py-1.5 transition text-center",
                  viewMode === "inbox" ? "bg-[#fce4ec] text-[#d81b60]" : "text-slate-500"
                )}
              >
                Hộp thư
              </button>
              <button
                onClick={() => setViewMode("archive")}
                className={cn(
                  "rounded-lg py-1.5 transition text-center",
                  viewMode === "archive" ? "bg-[#fce4ec] text-[#d81b60]" : "text-slate-500"
                )}
              >
                Lưu trữ
              </button>
            </div>
          </div>

          {/* Conversation list */}
          <div className="flex-1 min-h-0 overflow-auto p-2 space-y-1 no-scrollbar">
            {filtered.map(conv => {
              const initial = (conv.name || "N").trim().charAt(0).toUpperCase();
              const active = openConv === conv.conv_id && !archiveReading;
              return (
                <button
                  key={conv.conv_id}
                  onClick={() => openChat(conv.conv_id)}
                  className={cn(
                    "relative flex w-full items-center gap-3 rounded-xl p-2.5 text-left transition border",
                    active
                      ? "bg-[#fce4ec]/50 border-[#d81b60]/30 shadow-xs border-l-4 border-l-[#d81b60]"
                      : "border-transparent hover:bg-slate-50"
                  )}
                >
                  <div className="relative shrink-0">
                    <div className="flex size-10 items-center justify-center rounded-full bg-[#1877f2]/10 text-xs font-bold text-[#1877f2]">
                      {initial}
                    </div>
                    <span className="absolute bottom-0 right-0 size-2.5 rounded-full border-2 border-white bg-emerald-500" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-1">
                      <span className={cn("truncate text-xs", conv.unread ? "font-bold text-slate-900" : "font-semibold text-slate-800")}>
                        {conv.name || "Người dùng Facebook"}
                      </span>
                      <span className="shrink-0 text-[10px] text-slate-400">{conv.time}</span>
                    </div>

                    <p className={cn("truncate text-[11px]", conv.unread ? "font-bold text-slate-900" : "text-slate-500")}>
                      {conv.preview || "—"}
                    </p>

                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.2 text-[9px] font-bold text-blue-600 border border-blue-100">
                        <FacebookIcon size={9} /> Messenger
                      </span>

                      {conv.is_customer && (
                        <span className="inline-flex rounded-full bg-emerald-50 px-2 py-0.2 text-[9px] font-bold text-emerald-700 border border-emerald-100">
                          Khách hàng CRM
                        </span>
                      )}

                      {needsReply(conv) && (
                        <span className="inline-flex rounded-full bg-amber-50 px-2 py-0.2 text-[9px] font-bold text-amber-700 border border-amber-100">
                          ● Cần trả lời
                        </span>
                      )}
                    </div>
                  </div>

                  {conv.unread && (
                    <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-[#d81b60] text-[10px] font-bold text-white">
                      2
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </section>

        {/* ── CENTER PANE: CHAT WINDOW (Flex-1) ───────────────── */}
        <section className="flex flex-col min-h-0 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-xs">
          {/* Header */}
          <div className="shrink-0 flex items-center justify-between border-b border-slate-200/80 bg-white px-4 py-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#1877f2]/10 font-bold text-[#1877f2] text-sm">
                {(selectedName || "FB").charAt(0).toUpperCase()}
              </div>

              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="truncate text-sm font-bold text-slate-900">
                    {selectedName || (openConv ? "Facebook User" : "Chọn một hội thoại")}
                  </h2>
                </div>
                {openConv && (
                  <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
                    <span className="flex items-center gap-1 font-medium text-slate-600">
                      <FacebookIcon size={12} className="text-[#1877f2]" /> Facebook • {selectedSession ? accLabel(selectedSession) : "Fanpage"}
                    </span>
                    {selectedSession?.status === "online" && (
                      <>
                        <span>•</span>
                        <span className="flex items-center gap-1 text-emerald-600 font-semibold">
                          <span className="size-1.5 rounded-full bg-emerald-500" /> Online
                        </span>
                      </>
                    )}
                    {selectedConv?.is_customer && (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.2 text-[10px] font-bold text-emerald-700">
                        Khách hàng CRM
                      </span>
                    )}
                    {selectedConv?.unread && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.2 text-[10px] font-bold text-amber-700">
                        Cần trả lời
                      </span>
                    )}
                    <button onClick={() => setShowLeadModal(true)} className="rounded-full border border-slate-200 bg-white px-2 py-0.2 text-[10px] font-semibold text-slate-600 hover:border-primary">
                      + Thêm tag
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowAssignModal(true)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-[#d81b60]/40 bg-[#fce4ec]/50 px-3 py-1.5 text-xs font-bold text-[#d81b60] hover:bg-[#fce4ec]"
              >
                <User size={14} /> Gắn người
              </button>

              <button type="button" className="p-2 rounded-xl text-slate-500 hover:bg-slate-100">
                <Phone size={16} />
              </button>
              <button type="button" className="p-2 rounded-xl text-slate-500 hover:bg-slate-100">
                <Video size={16} />
              </button>
              <button type="button" className="p-2 rounded-xl text-slate-500 hover:bg-slate-100">
                <MoreVertical size={16} />
              </button>
            </div>
          </div>

          {/* Messages Thread Feed */}
          <div ref={chatScrollRef} className="flex-1 min-h-0 overflow-auto bg-white p-4 space-y-4 no-scrollbar">
            {loadingChat ? (
              <div className="flex h-full items-center justify-center text-xs text-slate-400">
                <RefreshCw size={16} className="animate-spin mr-2" /> Đang tải tin nhắn...
              </div>
            ) : !openConv ? (
              <div className="flex h-full flex-col items-center justify-center text-xs text-slate-400 gap-2">
                <MessageCircle size={32} className="text-slate-300" />
                <span>Chọn một hội thoại để xem tin nhắn</span>
              </div>
            ) : msgs.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-xs text-slate-400 gap-2">
                <MessageCircle size={32} className="text-slate-300" />
                <span>Chưa có tin nhắn trong hội thoại này</span>
              </div>
            ) : (
              <div className="space-y-3">
                {msgs.map((m, idx) => {
                  const parsed = displayMessage(m);
                  const isMe = m.from === "me";
                  return (
                    <div key={m.clientId || idx} className={cn("flex items-end gap-2", isMe ? "justify-end" : "justify-start")}>
                      {!isMe && (
                        <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#1877f2]/10 font-bold text-[#1877f2] text-xs">
                          {selectedName ? selectedName.charAt(0).toUpperCase() : "U"}
                        </div>
                      )}
                      <div className={cn("max-w-[78%]", isMe ? "text-right" : "text-left")}>
                        <div
                          className={cn(
                            "rounded-2xl px-4 py-2.5 text-xs font-normal leading-relaxed whitespace-pre-wrap break-words",
                            isMe
                              ? "bg-[#e3f2fd] text-slate-900 border border-blue-100 rounded-br-xs ml-auto"
                              : "bg-slate-100 text-slate-800 border border-slate-200/60 rounded-bl-xs"
                          )}
                        >
                          {parsed.content}
                        </div>
                        {parsed.time && (
                          <div className={cn("mt-1 text-[10px] text-slate-400 flex items-center gap-1", isMe ? "justify-end" : "justify-start")}>
                            <span>{parsed.time}</span>
                            {isMe && <span className="text-blue-500 font-bold">✓✓</span>}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* OMNI FEATURE 1: AI REPLY SUGGESTIONS BAR (TREN COMPOSER) */}
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

          {/* COMPOSER WITH FULLY FUNCTIONAL ACTIONS */}
          <div className="shrink-0 border-t border-slate-200/80 bg-white p-3 space-y-2 relative">
            {/* Emoji Popover Picker */}
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

            {/* Action Toolbar */}
            <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-100 pb-2">
              <button
                type="button"
                onClick={() => documentInputRef.current?.click()}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
              >
                <Paperclip size={13} /> Gửi tài liệu
              </button>

              <button
                type="button"
                onClick={() => imageInputRef.current?.click()}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
              >
                <ImageIcon size={13} /> Chọn ảnh
              </button>

              <button
                type="button"
                onClick={() => setShowEmojiPicker(v => !v)}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
              >
                <Smile size={13} /> Emoji
              </button>

              <button
                type="button"
                onClick={() => setTemplateGroupId("greeting")}
                className="inline-flex items-center gap-1 rounded-lg border border-[#d81b60]/40 bg-[#fce4ec]/60 px-2.5 py-1 text-[11px] font-bold text-[#d81b60]"
              >
                <Star size={13} /> Mẫu nhanh
              </button>

              {/* Omni real action triggers */}
              <button
                type="button"
                onClick={() => setShowInternalNoteModal(true)}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
              >
                <StickyNote size={13} /> Ghi chú nội bộ
              </button>

              <button
                type="button"
                onClick={() => setShowTaskModal(true)}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
              >
                <CheckSquare size={13} /> Tạo việc
              </button>

              <button
                type="button"
                onClick={() => setShowDealModal(true)}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
              >
                <Briefcase size={13} /> Tạo cơ hội
              </button>

              <button
                type="button"
                onClick={() => setShowQuoteModal(true)}
                className="inline-flex items-center gap-1 rounded-lg border border-[#d81b60]/40 bg-[#d81b60]/10 px-2.5 py-1 text-[11px] font-bold text-[#d81b60] hover:bg-[#d81b60]/20"
              >
                <FileSpreadsheet size={13} /> Báo giá CRM &gt;
              </button>

              <button
                type="button"
                onClick={() => appendAiSuggestion("Giới thiệu sản phẩm & dịch vụ giải pháp của công ty")}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
              >
                🛍 Giới thiệu sản phẩm &gt;
              </button>

              <button
                type="button"
                onClick={() => appendAiSuggestion("Hẹn lịch demo hệ thống trực tiếp cho anh/chị")}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
              >
                📅 Hẹn lịch demo &gt;
              </button>

              <button
                type="button"
                onClick={() => appendAiSuggestion("Dạ cảm ơn anh/chị đã quan tâm giải pháp bên em ạ!")}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
              >
                🙏 Cảm ơn khách hàng
              </button>
            </div>

            {/* Input Row */}
            <div className="flex gap-2 items-end">
              <textarea
                value={reply}
                onChange={e => setReply(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendReply();
                  }
                }}
                disabled={!canSend}
                rows={3}
                placeholder="Nhập tin nhắn..."
                className="flex-1 min-h-[72px] max-h-[140px] overflow-y-auto leading-relaxed rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-xs outline-none focus:border-[#d81b60]"
              />

              <button
                onClick={sendReply}
                disabled={!canSend || !reply.trim()}
                className="flex h-11 items-center justify-center rounded-2xl bg-[#d81b60] px-6 text-xs font-bold text-white shadow-xs transition hover:bg-[#c2185b] disabled:opacity-40"
              >
                Gửi
              </button>
            </div>
          </div>
        </section>

        {/* ── RIGHT PANE: CRM 360 PANEL (360px) ───────────────── */}
        <aside className="flex flex-col min-h-0 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-xs">
          {/* Header */}
          <div className="shrink-0 flex items-center justify-between border-b border-slate-200/80 bg-white px-4 py-3">
            <h2 className="text-sm font-bold text-slate-900">CRM 360</h2>
            <div className="flex items-center gap-2">
              <button type="button" onClick={scan} className="p-1 text-slate-400 hover:text-slate-700">
                <RefreshCw size={14} />
              </button>
              <button type="button" onClick={() => setShowCustomerDrawer(true)} className="p-1 text-slate-400 hover:text-slate-700">
                <ExternalLink size={14} />
              </button>
            </div>
          </div>

          {/* Content Feed */}
          <div className="flex-1 min-h-0 overflow-auto p-3.5 space-y-4 no-scrollbar">

            {/* SECTION 1: KHÁCH HÀNG CARD */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">KHÁCH HÀNG</span>
                {currentLead && (
                  <button
                    onClick={() => setShowCustomerDrawer(true)}
                    className="text-[11px] font-bold text-slate-600 hover:text-[#d81b60]"
                  >
                    Xem chi tiết &gt;
                  </button>
                )}
              </div>

              {currentLead ? (
                <div className="rounded-2xl border border-slate-200/80 bg-slate-50/50 p-3.5 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <div className="flex size-9 items-center justify-center rounded-xl bg-red-100 text-red-600 font-bold shrink-0">
                        <Building2 size={18} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="text-xs font-bold text-slate-900 truncate">
                            {currentLead.customer_name || currentLead.company_name || selectedName || "Khách hàng"}
                          </h3>
                          <span className="rounded-full bg-emerald-100 px-2 py-0.2 text-[9px] font-bold text-emerald-700">
                            Đã liên kết
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-500">{currentLead.deal_stage || "Khách hàng"}</p>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 border-t border-slate-200/60 pt-2.5 text-xs">
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
                        {currentLead.leaded_by || userEmail || "Chưa phân công"}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <button
                      onClick={() => setShowCustomerDrawer(true)}
                      className="flex items-center justify-center gap-1 rounded-xl border border-slate-200 bg-white py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      <Eye size={13} /> Xem hồ sơ
                    </button>
                    <button
                      onClick={() => setShowInternalNoteModal(true)}
                      className="flex items-center justify-center gap-1 rounded-xl border border-slate-200 bg-white py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      <StickyNote size={13} /> Tạo ghi chú
                    </button>
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 p-4 text-center space-y-2">
                  <UserSearch className="mx-auto size-8 text-slate-300" />
                  <div className="text-xs text-slate-500 font-medium">Chưa liên kết với khách hàng CRM</div>
                  <button
                    onClick={() => setShowCustomerDrawer(true)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-[#d81b60]/30 bg-[#d81b60]/10 px-3 py-1.5 text-xs font-bold text-[#d81b60] hover:bg-[#d81b60]/20 transition"
                  >
                    <Plus size={14} /> Thêm khách hàng CRM
                  </button>
                </div>
              )}
            </div>

            {/* SECTION 2: CƠ HỘI ĐANG MỞ */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[11px] font-bold tracking-wider text-slate-400">
                <span>CƠ HỘI ĐANG MỞ</span>
                <button onClick={() => setShowDealModal(true)} className="text-slate-500 hover:text-[#d81b60] font-semibold">+ Tạo mới</button>
              </div>

              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/30 p-3 text-center text-xs text-slate-400">
                Chưa có cơ hội cho hội thoại này
              </div>
            </div>

            {/* SECTION 3: BÁO GIÁ LIÊN QUAN */}
            <CrmQuote360Panel
              currentLead={currentLead}
              channelName="Facebook"
              openConvId={openConv}
              onOpenCreateQuote={() => {
                setSelectedQuoteId(null);
                setShowQuoteModal(true);
              }}
              onOpenViewQuote={(quoteId) => {
                setSelectedQuoteId(quoteId);
                setShowQuoteModal(true);
              }}
              onSendQuoteMessage={(content) => {
                setReply(content);
                setTimeout(() => {
                  sendReply();
                }, 100);
              }}
              showToast={(msg, ok) => showToastKpi(msg, ok)}
            />

            {/* SECTION 4: THAO TÁC NHANH */}
            <div className="space-y-2">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">THAO TÁC NHANH</div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setShowDealModal(true)}
                  className="flex items-center justify-center gap-1 rounded-xl bg-[#d81b60] py-2 text-xs font-bold text-white shadow-xs hover:bg-[#c2185b]"
                >
                  <Plus size={14} /> Tạo cơ hội
                </button>

                <button
                  onClick={() => setShowQuoteModal(true)}
                  className="flex items-center justify-center gap-1 rounded-xl border border-slate-200 bg-white py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <FileSpreadsheet size={14} /> Tạo báo giá
                </button>

                <button
                  onClick={() => setShowLeadModal(true)}
                  className="flex items-center justify-center gap-1 rounded-xl border border-slate-200 bg-white py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <Search size={14} /> Tìm khách hàng
                </button>

                <button
                  onClick={() => setShowInternalNoteModal(true)}
                  className="flex items-center justify-center gap-1 rounded-xl border border-slate-200 bg-white py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <Plus size={14} /> Thêm ghi chú
                </button>
              </div>
            </div>

            {/* SECTION 5: MẪU TRẢ LỜI NHANH */}
            <div className="space-y-2 pt-2 border-t border-slate-100">
              <div className="flex items-center justify-between text-[11px] font-bold tracking-wider text-slate-400">
                <span>MẪU TRẢ LỜI NHANH</span>
                <button onClick={() => setTemplateGroupId("greeting")} className="text-slate-500 hover:text-[#d81b60] font-semibold">Xem tất cả &gt;</button>
              </div>

              <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
                {QUICK_REPLY_GROUPS.map(g => (
                  <button
                    key={g.id}
                    onClick={() => setTemplateGroupId(g.id)}
                    className={cn(
                      "rounded-full px-2.5 py-0.5 text-[11px] font-bold shrink-0",
                      templateGroupId === g.id ? "bg-[#d81b60] text-white" : "bg-slate-100 text-slate-600"
                    )}
                  >
                    {g.label}
                  </button>
                ))}
              </div>

              <div className="space-y-2 pt-1">
                {activeTemplateGroup.items.map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200/80 bg-white p-2.5">
                    <span className="text-xs text-slate-700 truncate">{item.text}</span>
                    <button
                      onClick={() => appendTemplate(item.text)}
                      className="rounded-full bg-[#fce4ec] px-2.5 py-0.5 text-[10px] font-bold text-[#d81b60] shrink-0"
                    >
                      Chèn
                    </button>
                  </div>
                ))}
              </div>
            </div>

          </div>
        </aside>

      </div>

      {/* ── REAL CRM MODALS & DRAWERS ───────────────────────── */}
      <DealFormModal
        open={showDealModal}
        onClose={() => setShowDealModal(false)}
        onCreate={() => {
          setShowDealModal(false);
          showToastKpi("Đã tạo cơ hội kinh doanh mới!", true);
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
            showToastKpi("Đã cập nhật dữ liệu báo giá!", true);
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
          showToastKpi(`Đã cập nhật thông tin khách hàng ID ${customerId}!`, true);
        }}
      />

      {/* Internal Note Modal */}
      {showInternalNoteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <StickyNote size={18} className="text-[#d81b60]" /> Thêm ghi chú nội bộ CRM
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
                onChange={e => setNoteDraft(e.target.value)}
                rows={5}
                placeholder="Nhập ghi chú yêu cầu, thỏa thuận với khách..."
                className="w-full rounded-xl border border-slate-200 p-3 text-xs outline-none focus:border-[#d81b60]"
              />
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowInternalNoteModal(false)} className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold">Hủy</button>
                <button
                  onClick={() => {
                    if (openConv) saveCustomerNote(openConv, noteDraft);
                    setShowInternalNoteModal(false);
                    showToastKpi("Đã lưu ghi chú CRM thành công!", true);
                  }}
                  className="rounded-xl bg-[#d81b60] px-4 py-2 text-xs font-bold text-white"
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
                <CheckSquare size={18} className="text-[#d81b60]" /> Tạo công việc (Task)
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
                  onChange={e => setTaskTitle(e.target.value)}
                  placeholder="VD: Gọi điện tư vấn lại demo gói Enterprise"
                  className="w-full mt-1 rounded-xl border border-slate-200 p-2.5 text-xs outline-none focus:border-[#d81b60]"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => setShowTaskModal(false)} className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold">Hủy</button>
                <button
                  onClick={() => {
                    setShowTaskModal(false);
                    showToastKpi("Đã giao việc thành công!", true);
                  }}
                  className="rounded-xl bg-[#d81b60] px-4 py-2 text-xs font-bold text-white"
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
          showToastKpi(`Đã gán người phụ trách: ${name}`, true);
        }}
      />

      {/* Legacy Modals */}
      <SalesAssetPickerModal
        open={showSalesAssetPicker}
        onClose={() => setShowSalesAssetPicker(false)}
        onSend={appendSalesAsset}
        customerLeadId={currentLead?.id || null}
        dealId={currentLead?.id || null}
      />

      {toast && (
        <div className={cn("fixed bottom-6 right-6 z-50 rounded-xl px-4 py-3 text-xs font-bold text-white shadow-xl", toast.ok ? "bg-emerald-600" : "bg-red-600")}>
          {toast.msg}
        </div>
      )}
      {kpiToast && (
        <div className={cn("fixed bottom-6 right-6 z-50 rounded-xl px-4 py-3 text-xs font-bold text-white shadow-xl", kpiToast.ok ? "bg-emerald-600" : "bg-red-600")}>
          {kpiToast.msg}
        </div>
      )}

      <CrmCustomerModal
        isOpen={showLeadModal}
        onClose={() => setShowLeadModal(false)}
        defaultConvId={openConv || undefined}
        defaultCustomerName={selectedName || undefined}
        defaultSourcePlatform="FB_Inbox"
      />
    </div>
  );
}
