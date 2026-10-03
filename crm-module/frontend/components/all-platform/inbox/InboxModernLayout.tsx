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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import TeamAccountTree from "@/components/all-platform/inbox/TeamAccountTree";
import { KpiProgressCard } from "@/components/all-platform/components/kpi-progress-card";
import { CrmCustomerModal } from "@/components/all-platform/components/CrmCustomerModal";
import { SalesAssetPickerModal } from "@/components/all-platform/sales-assets/SalesAssetPickerModal";
import { customerLeadService, type Customer } from "@/services/customer-lead.service";
import type { SalesAsset } from "@/services/sales-asset.service";

interface Session { user_id: string; fb_user_id?: string; label?: string; owner?: string; online?: boolean; inbox_enabled?: boolean; status?: string; }
interface Conv { conv_id: string; name: string; preview: string; unread: boolean; time: string; is_customer: boolean; pushed_to_zalo: boolean; deleted: boolean; archived?: boolean; archived_at?: string; }
interface ArchiveConv { conv_id: string; name: string; preview?: string; time?: string; archived_at?: string; last_saved_at?: string; archive_reason?: string; outcome?: string; note?: string; messages_count?: number; archived_by_name?: string; is_customer?: boolean; pushed_to_zalo?: boolean; }
interface Msg { from: "me" | "them"; text: string; time: string; clientId?: string; }
interface UserRow { id?: string; email?: string; name?: string; }
interface TeamRow { id?: string; name_team?: string; id_leader?: string; leader_name?: string; leader_email?: string; members?: UserRow[]; }

type InboxFilter = "all" | "unread" | "customer" | "need_reply" | "need_verify";
type InboxViewMode = "inbox" | "archive";
type PanelTab = "templates" | "customer" | "kpi";

interface Props {
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
  /** conv_id -> thoi diem xac nhan Lead (ISO string), de hien "Da xac nhan
   * KPI tuan X" dung tuan LUC XAC NHAN, khong phai tuan dang xem lai. */
  verifiedConvDates?: Record<string, string>;
  /** conv_id -> created_at cua dong KPI Inbox (BAT KY hoi thoai nao da tinh,
   * khong chi rieng Lead) - de hien "KPI Inbox tinh vao tuan X". */
  inboxKpiWeekDates?: Record<string, string>;
  userEmail: string;
  ownerEmail: string;
  /** Email cua CHU tai khoan FB dang duoc xem (khac userEmail khi leader/admin
   * dang xem tai khoan cua 1 member khac) - dung de xac nhan/hien thi KPI
   * dung nguoi, tranh gan nham cho leader. */
  accountOwnerEmail: string;
}

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

function displayMessage(message: Msg): { content: string; time: string } {
  const matched = message.text.match(/^Tin nhắn do .+? gửi lúc (.+?):\s*([\s\S]*)$/i);
  let content = matched ? (matched[2] || "").trim() : message.text;
  const time = matched ? (matched[1] || "").trim() : (message.time || "");
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

// So thu tu tuan trong nam - cung quy uoc voi AssignKpiModal/KpiRewardSections:
// tuan 1 bat dau tu thu Hai cua/truoc ngay 1/1. Khong truyen date = tuan hien tai
// (dung cho badge "Da dong bo KPI Inbox tu dong" - luon la tuan dang o).
function getWeekNumber(date: Date): number {
  const year = date.getFullYear();
  const firstDay = new Date(year, 0, 1);
  const dayOfWeek = firstDay.getDay() || 7;
  const startMonday = new Date(firstDay);
  startMonday.setDate(firstDay.getDate() - dayOfWeek + 1);
  const diffDays = Math.round((date.getTime() - startMonday.getTime()) / 86400000);
  return Math.floor(diffDays / 7) + 1;
}

function getCurrentWeekNumber(): number {
  return getWeekNumber(new Date());
}

// StatCard — mini the thong ke tren dau trang, dung lai dung pattern da chuan hoa
// o trang teams-management (icon chip pastel + so lon + nhan), khop 1:1 style
// MetricCard cua app.markeeai.com.
function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  iconClassName,
}: {
  icon: React.ComponentType<{ size?: number }>;
  label: string;
  value: string | number;
  hint?: string;
  iconClassName?: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-4">
      <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg", iconClassName)}>
        <Icon size={18} />
      </div>
      <div className="min-w-0">
        <p className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <div className="flex items-baseline gap-1.5">
          <span className="text-xl font-bold tracking-tight text-foreground tabular-nums">{value}</span>
          {hint ? <span className="truncate text-[11px] text-muted-foreground">{hint}</span> : null}
        </div>
      </div>
    </div>
  );
}

export default function InboxModernLayout(props: Props) {
  const {
    role, owner, sessions, rawSessions = [], allowedOwnerIds = null, extraAccountIds = new Set<string>(), toggleExtraAccount,
    ownerNames, teams, acc, accOnline, accPaused,
    needRelogin, needsPin = false, needsPinMessage = "", connErr, extInstalled, scanning, loadingConvs, loadingArchives,
    loadingChat, loadingFresh, archiveReading, viewMode, filter, activeConvs, filtered, allConvs = [], loadingAllConvs = false, onRequestAllConvs,
    archives, openConv, msgs, reply, customerNotes, savingNoteConv, toast,
    chatScrollRef, selectAcc, scan, setViewMode, setArchiveReading, setFilter,
    setReply, openChat, hoverConv, openArchive, mark, saveArchive, saveCustomerNote, sendReply,
    needsReply, accLabel, syncFbInbox, verifiedConvIds, verifiedConvDates = {}, inboxKpiWeekDates = {},
    userEmail, ownerEmail, accountOwnerEmail,
  } = props;

  const [panelTab, setPanelTab] = useState<PanelTab>("templates");
  const [templateGroupId, setTemplateGroupId] = useState(QUICK_REPLY_GROUPS[0].id);
  const [kpiToast, setKpiToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [noteDraftState, setNoteDraftState] = useState({ convId: "", value: "" });
  const panelScrollRef = useRef<HTMLDivElement>(null);
  const [showLeadModal, setShowLeadModal] = useState(false);
  const [showAddAccountPicker, setShowAddAccountPicker] = useState(false);
  const [showSalesAssetPicker, setShowSalesAssetPicker] = useState(false);
  const [currentLead, setCurrentLead] = useState<Customer | null>(null);
  const [accountBarOpen, setAccountBarOpen] = useState(true);
  const [trackSearchOpen, setTrackSearchOpen] = useState(false);
  const [trackSearchQuery, setTrackSearchQuery] = useState("");
  const [trackSelectedIds, setTrackSelectedIds] = useState<Set<string>>(new Set());
  const selectedSession = sessions.find(s => s.user_id === acc);
  const selectedConv = activeConvs.find(c => c.conv_id === openConv) || filtered.find(c => c.conv_id === openConv);
  const selectedArchive = archives.find(a => a.conv_id === openConv);
  const selectedName = archiveReading ? selectedArchive?.name : selectedConv?.name;
  const selectedPreview = archiveReading ? selectedArchive?.preview : selectedConv?.preview;
  const selectedNote = openConv ? (customerNotes[openConv] ?? selectedArchive?.note ?? "") : "";
  const activeTemplateGroup = QUICK_REPLY_GROUPS.find(g => g.id === templateGroupId) || QUICK_REPLY_GROUPS[0];
  const noteDraft = noteDraftState.convId === openConv ? noteDraftState.value : selectedNote;
  const setNoteDraft = (value: string) => setNoteDraftState({ convId: openConv, value });
  const noteChanged = noteDraft.trim() !== selectedNote.trim();

  const stats = useMemo(() => ({
    unread: activeConvs.filter(c => c.unread).length,
    need: activeConvs.filter(needsReply).length,
    customers: activeConvs.filter(c => c.is_customer).length,
    pushed: activeConvs.filter(c => c.pushed_to_zalo).length,
  }), [activeConvs, needsReply]);

  // Quet TOAN BO hoi thoai cu (khong con trong active window ~7 ngay) de chon nhieu + danh dau khach 1 lan,
  // phong khi nhan vien quen bam "La khach" luc nhan tin.
  const TRACK_SEARCH_LIMIT = 200;
  const trackSearchPool = useMemo(() => {
    const activeIds = new Set(activeConvs.map(c => c.conv_id));
    return allConvs.filter(c => !c.deleted && !activeIds.has(c.conv_id));
  }, [allConvs, activeConvs]);
  const trackSearchResults = useMemo(() => {
    const q = trackSearchQuery.trim().toLowerCase();
    const filtered = q ? trackSearchPool.filter(c => (c.name || "").toLowerCase().includes(q)) : trackSearchPool;
    return filtered.slice(0, TRACK_SEARCH_LIMIT);
  }, [trackSearchQuery, trackSearchPool]);

  const canSend = !!openConv && !archiveReading && accOnline && !accPaused && !needRelogin;
  const appendTemplate = (text: string) => setReply(reply.trim() ? `${reply.trim()}\n${text}` : text);
  const appendSalesAsset = (asset: SalesAsset) => {
    const link = asset.sourceUrl || asset.shareUrl;
    const meta = [asset.projectName, asset.version].filter(Boolean).join(" - ");
    const text = `${asset.title}${meta ? ` (${meta})` : ""}\n${link}`;
    setReply(reply.trim() ? `${reply.trim()}\n${text}` : text);
    setShowSalesAssetPicker(false);
    showToastKpi("Đã chèn tài liệu vào ô trả lời.", true);
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

  const switchInbox = () => { setViewMode("inbox"); setArchiveReading(false); };

  const confirmHide = (conv: Conv) => {
    if (window.confirm(`Ẩn "${conv.name || "hội thoại này"}" khỏi hộp thư?`)) {
      saveArchive(conv.conv_id, true);
    }
  };

  const panelH = "flex-1 min-h-0";

  // Cac canh bao trang thai (mat ket noi/cookie het han/can PIN/thieu extension) truoc day
  // chen thang vao dau noi dung, day layout xuong moi lan xuat hien - gio doi thanh popup NOI
  // (fixed, khong chiem cho trong luong trang), xep chong o giua-tren man hinh, khong che
  // thanh tieu de sticky cua khung noi dung (o tren no).
  const statusAlerts: { key: string; tone: "amber" | "red" | "blue"; icon?: React.ReactNode; text: React.ReactNode }[] = [];
  if (connErr) statusAlerts.push({ key: "connErr", tone: "amber", text: "Không kết nối được service. Kiểm tra backend." });
  if (needRelogin) statusAlerts.push({ key: "needRelogin", tone: "red", text: <>Cookie hết hạn. Vào Quản lý tài khoản &gt; Tài khoản FB &amp; KPI để đăng nhập lại.</> });
  if (needsPin) statusAlerts.push({
    key: "needsPin", tone: "amber", icon: <Lock size={16} className="mt-0.5 shrink-0" />,
    text: needsPinMessage || "Facebook yêu cầu nhập mã PIN thủ công để khôi phục 1 đoạn chat. Vào Messenger trên máy nhân viên, mở hội thoại, nhập mã PIN 1 lần rồi thử lại.",
  });
  if (role === "member" && extInstalled !== null && !sessions.some(s => s.owner === owner)) {
    statusAlerts.push({
      key: "extMissing", tone: "blue",
      text: extInstalled === false ? "Chưa cài hoặc chưa mở extension Markee." : "Extension sẵn sàng nhưng tài khoản FB chưa kết nối.",
    });
  }
  const alertToneClass: Record<string, string> = {
    amber: "border-amber-300 bg-amber-50 text-amber-800",
    red: "border-red-300 bg-red-50 text-red-700",
    blue: "border-blue-200 bg-blue-50 text-blue-800",
  };

  return (
    <div className="w-full max-w-full overflow-x-hidden text-foreground">
      {statusAlerts.length > 0 && (
        <div className="pointer-events-none fixed inset-x-0 top-16 z-30 flex flex-col items-center gap-2 px-4">
          {statusAlerts.map(a => (
            <div key={a.key} className={cn("pointer-events-auto flex w-full max-w-xl items-start gap-2 rounded-xl border px-4 py-3 text-sm font-semibold shadow-lg", alertToneClass[a.tone])}>
              {a.icon}
              <span>{a.text}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Nut Quet + 4 the thong ke — ten trang da hien o thanh sticky tren cung
          (AllPlatformShell), khong lap lai tieu de "Inbox Facebook" o day nua. ── */}
      <div className="mb-4 flex justify-end">
        <button
          onClick={scan}
          disabled={scanning || !acc || !accOnline || needRelogin}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw size={15} className={scanning ? "animate-spin" : ""} />
          {scanning ? "Đang quét" : "Quét ngay"}
        </button>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={InboxIcon} label="Hội thoại" value={activeConvs.length} hint={`${stats.unread} chưa đọc`} iconClassName="bg-blue-100 text-blue-600" />
        <StatCard icon={UserSearch} label="Cần trả lời" value={stats.need} iconClassName="bg-red-100 text-red-600" />
        <StatCard icon={Star} label="Lead đã lưu" value={stats.customers} hint={`${stats.pushed} đẩy Zalo`} iconClassName="bg-emerald-100 text-emerald-600" />
        <StatCard icon={CheckCircle2} label="Online" value={sessions.filter(s => s.status === "online").length} hint={`${sessions.length} tài khoản`} iconClassName="bg-violet-100 text-violet-600" />
      </div>

      {/* ── Khoi chon tai khoan + KPI hang loat ──────────────────────────
          KHONG dung overflow-hidden o day: se cat mat dropdown chon tai khoan
          (absolute) khi no xo xuong duoi vien card. */}
      <div className="mb-4 rounded-xl border border-border bg-card">
        <div className="p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tài khoản nhân viên</div>
              <div className="mt-0.5 flex items-center gap-2 text-sm font-semibold text-foreground">
                <span className={cn("size-2 rounded-full", statusDotClass(selectedSession?.status))} />
                {selectedSession ? accLabel(selectedSession) : "Chưa chọn tài khoản"}
                {selectedSession && <span className="text-xs font-medium text-muted-foreground">({statusLabel(selectedSession.status)})</span>}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {accountBarOpen && (
                <>
                  {/* Da bo nut "Dua xuat/Tinh KPI hang loat" - KPI Inbox gio tinh
                      tu dong hoan toan (auto-detect + khoa 30 ngay), khong con
                      co che de xuat/xac nhan thu cong nao nua. */}
                  {(role === "admin" || role === "leader") && typeof toggleExtraAccount === "function" && (
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setShowAddAccountPicker(v => !v)}
                        className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground transition hover:border-primary hover:text-primary"
                      >
                        + Thêm tài khoản khác
                      </button>
                      {showAddAccountPicker && (
                        <div className="absolute right-0 z-20 mt-1 max-h-80 w-72 overflow-auto rounded-xl border border-border bg-popover p-2 shadow-lg">
                          <div className="px-1 pb-1.5 text-[11px] text-muted-foreground">Chọn thêm acc ngoài phạm vi mặc định (team/của bạn) để hiện trong Inbox — chỉ lưu trên trình duyệt này.</div>
                          {rawSessions.length === 0 ? (
                            <div className="px-1 py-2 text-xs text-muted-foreground">Chưa có acc nào.</div>
                          ) : (
                            rawSessions.map(s => {
                              const inDefaultScope = allowedOwnerIds === null || (!!s.owner && allowedOwnerIds.has(String(s.owner)));
                              const checked = extraAccountIds.has(s.user_id);
                              return (
                                <label key={s.user_id} className={cn("flex items-center gap-2 rounded-md px-1.5 py-1 text-xs cursor-pointer hover:bg-accent", inDefaultScope && "opacity-50")}>
                                  <input type="checkbox" checked={checked || inDefaultScope} disabled={inDefaultScope} onChange={() => toggleExtraAccount(s.user_id)} />
                                  <span className={cn("inline-block size-1.5 rounded-full", statusDotClass(s.status))} />
                                  <span className="truncate">{accLabel(s)}</span>
                                  {inDefaultScope && <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">(mặc định)</span>}
                                </label>
                              );
                            })
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  <div className="hidden text-xs text-muted-foreground md:block">Online realtime, offline chỉ xem dữ liệu.</div>
                </>
              )}
              <button
                type="button"
                onClick={() => setAccountBarOpen(v => !v)}
                title={accountBarOpen ? "Thu gọn danh sách tài khoản" : "Hiện danh sách tài khoản"}
                className="rounded-lg border border-border p-1.5 text-muted-foreground transition hover:border-primary hover:text-primary"
              >
                <ChevronDown size={15} className={cn("transition-transform", accountBarOpen && "rotate-180")} />
              </button>
            </div>
          </div>
          {accountBarOpen && (
            sessions.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-muted/40 px-3 py-4 text-sm text-muted-foreground">
                {extInstalled === false ? "Chưa thấy extension. Hãy cài và mở extension." : "Chưa có tài khoản Facebook nào."}
              </div>
            ) : (role === "admin" || role === "leader") ? (
              <TeamAccountTree sessions={sessions} ownerNames={ownerNames} teams={teams} selectedAcc={acc} role={role} owner={owner} onSelect={selectAcc} />
            ) : (
              <div className="flex flex-wrap gap-2">
                {sessions.map(session => (
                  <button
                    key={session.user_id}
                    onClick={() => selectAcc(session.user_id)}
                    className={cn(
                      "inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm font-semibold transition",
                      acc === session.user_id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground hover:border-primary",
                    )}
                  >
                    <span className={cn("size-2 rounded-full", statusDotClass(session.status))} />
                    {accLabel(session)}
                    <span className="text-[10px] opacity-70">{statusLabel(session.status)}</span>
                  </button>
                ))}
              </div>
            )
          )}
        </div>

        {(accountOwnerEmail || userEmail) && (
          <div className="grid grid-cols-1 gap-4 border-t border-border p-4 xl:grid-cols-2">
            <KpiProgressCard email={accountOwnerEmail || userEmail} type="inbox" />
            <KpiProgressCard email={accountOwnerEmail || userEmail} type="lead" />
          </div>
        )}
      </div>

      {/* ── 3 cot: Hop thu / Hoi thoai / Panel — luon hien ────────────────── */}
      <div className="grid min-w-0 grid-cols-[280px_1fr_340px] gap-4">
        {/* Cot 1: Danh sach hoi thoai */}
        <section className="flex h-[656px] min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card xl:h-[716px]">
          <div className="shrink-0 border-b border-border p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold text-foreground">Hộp thư</h2>
                <p className="text-xs text-muted-foreground">{loadingConvs ? "Đang cập nhật..." : `${filtered.length} hội thoại`}</p>
              </div>
              <select
                value={filter}
                onChange={e => setFilter(e.target.value as InboxFilter)}
                className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-xs font-medium outline-none focus:border-primary"
              >
                <option value="all">Tất cả</option>
                <option value="need_reply">Cần trả lời</option>
                <option value="unread">Chưa đọc</option>
                <option value="customer">Khách</option>
                <option value="need_verify">Chưa tính KPI</option>
              </select>
            </div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="inline-flex rounded-lg border border-border bg-muted/50 p-0.5">
                <button onClick={switchInbox} className={cn("rounded-md px-2.5 py-1 text-xs font-semibold transition", viewMode === "inbox" ? "bg-card text-primary shadow-sm" : "text-muted-foreground")}>Hộp thư</button>
                <button onClick={() => setViewMode("archive")} className={cn("rounded-md px-2.5 py-1 text-xs font-semibold transition", viewMode === "archive" ? "bg-card text-primary shadow-sm" : "text-muted-foreground")}>Lưu trữ</button>
              </div>
              <button
                type="button"
                onClick={() => {
                  setTrackSearchOpen(v => {
                    const next = !v;
                    if (next) onRequestAllConvs?.();
                    else setTrackSelectedIds(new Set());
                    return next;
                  });
                }}
                title="Quét toàn bộ hội thoại cũ, chọn nhiều rồi đánh dấu là khách 1 lần (phòng khi quên bấm lúc nhắn)"
                className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] font-semibold text-muted-foreground transition hover:border-primary hover:text-primary"
              >
                <Search size={12} />
                Quét
              </button>
            </div>
            {trackSearchOpen && (
              <div className="mb-2 rounded-xl border border-border bg-muted/40 p-2">
                <input
                  autoFocus
                  value={trackSearchQuery}
                  onChange={e => setTrackSearchQuery(e.target.value)}
                  placeholder={loadingAllConvs ? "Đang tải toàn bộ hội thoại..." : "Lọc theo tên (để trống = xem hết hội thoại cũ)..."}
                  className="w-full rounded-lg border border-input bg-card px-3 py-1.5 text-sm outline-none focus:border-primary"
                />
                <div className="mt-2 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    disabled={trackSearchResults.length === 0}
                    onClick={() => setTrackSelectedIds(prev =>
                      prev.size === trackSearchResults.length
                        ? new Set()
                        : new Set(trackSearchResults.map(c => c.conv_id))
                    )}
                    className="text-xs font-semibold text-primary transition hover:underline disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {trackSelectedIds.size > 0 && trackSelectedIds.size === trackSearchResults.length
                      ? "Bỏ chọn tất cả"
                      : `Chọn tất cả (${trackSearchResults.length})`}
                  </button>
                  {trackSelectedIds.size > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        trackSelectedIds.forEach(id => mark(id, "is_customer", true));
                        setTrackSelectedIds(new Set());
                        setTrackSearchQuery("");
                        setTrackSearchOpen(false);
                      }}
                      className="rounded-lg bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground transition hover:opacity-90"
                    >
                      Đánh dấu {trackSelectedIds.size} mục là khách
                    </button>
                  )}
                </div>
                <div className="mt-2 max-h-64 space-y-1 overflow-auto">
                  {loadingAllConvs ? (
                    <div className="px-1 py-2 text-xs text-muted-foreground">Đang tải toàn bộ hội thoại...</div>
                  ) : trackSearchResults.length === 0 ? (
                    <div className="px-1 py-2 text-xs text-muted-foreground">Không có hội thoại nào khớp (chỉ tìm được trong dữ liệu đã quét trước đó).</div>
                  ) : (
                    trackSearchResults.map(c => {
                      const checked = trackSelectedIds.has(c.conv_id);
                      return (
                        <label key={c.conv_id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-accent">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => setTrackSelectedIds(prev => {
                              const next = new Set(prev);
                              if (next.has(c.conv_id)) next.delete(c.conv_id); else next.add(c.conv_id);
                              return next;
                            })}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-semibold text-foreground">{c.name || c.conv_id}</div>
                            <div className="truncate text-xs text-muted-foreground">{c.preview || "(không có preview)"} · {c.time}</div>
                          </div>
                          <button
                            type="button"
                            onClick={() => mark(c.conv_id, "is_customer", true)}
                            className="shrink-0 rounded-lg border border-primary/30 px-2 py-1 text-[11px] font-semibold text-primary transition hover:bg-primary/10"
                          >
                            Đánh dấu
                          </button>
                        </label>
                      );
                    })
                  )}
                  {trackSearchPool.length > TRACK_SEARCH_LIMIT && (
                    <div className="px-1 pt-1 text-[10px] text-muted-foreground">Chỉ hiện {TRACK_SEARCH_LIMIT}/{trackSearchPool.length} — gõ tên để lọc bớt.</div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-auto p-2">
            {viewMode === "archive" ? (
              loadingArchives && archives.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">Đang tải lưu trữ...</div>
              ) : archives.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">Chưa có hội thoại lưu trữ.</div>
              ) : archives.map(item => {
                const initial = (item.name || "?").trim().charAt(0).toUpperCase() || "?";
                const active = openConv === item.conv_id && archiveReading;
                return (
                <button
                  key={item.conv_id}
                  onClick={() => openArchive(item.conv_id)}
                  className={cn("mb-0.5 flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition", active ? "bg-primary/10" : "hover:bg-accent")}
                >
                  <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-muted text-base font-bold text-muted-foreground">
                    {initial}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <div className="truncate text-sm font-semibold text-foreground">{item.name || item.conv_id}</div>
                      <span className="shrink-0 text-[11px] text-muted-foreground">{item.messages_count || 0} tin</span>
                    </div>
                    <div className="truncate text-xs text-muted-foreground">{item.preview || "—"}</div>
                    {(item.is_customer || item.pushed_to_zalo) && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {item.is_customer && <Badge variant="secondary" className="border-transparent bg-emerald-100 text-[9px] text-emerald-700">khách</Badge>}
                        {item.pushed_to_zalo && <Badge variant="secondary" className="border-transparent bg-blue-100 text-[9px] text-blue-700">Zalo</Badge>}
                      </div>
                    )}
                  </div>
                </button>
                );
              })
            ) : loadingConvs && filtered.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">Đang tải hộp thư...</div>
            ) : filtered.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">Chưa có hội thoại.</div>
            ) : filtered.map(conv => {
              const initial = (conv.name || "?").trim().charAt(0).toUpperCase() || "?";
              const active = openConv === conv.conv_id && !archiveReading;
              return (
              <button
                key={conv.conv_id}
                onClick={() => openChat(conv.conv_id)}
                onMouseEnter={() => hoverConv?.(conv.conv_id)}
                className={cn("mb-0.5 flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition", active ? "bg-primary/10" : "hover:bg-accent")}
              >
                <div className="relative shrink-0">
                  <div className="flex size-11 items-center justify-center rounded-full bg-primary/15 text-base font-bold text-primary">
                    {initial}
                  </div>
                  {conv.unread && <span className="absolute -right-0.5 -top-0.5 size-3 rounded-full border-2 border-card bg-primary" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <div className={cn("truncate text-sm", conv.unread ? "font-bold text-foreground" : "font-semibold text-foreground")}>{conv.name || "Người dùng"}</div>
                    <span className="shrink-0 text-[11px] text-muted-foreground">{conv.time}</span>
                  </div>
                  <div className={cn("truncate text-xs", conv.unread ? "font-medium text-foreground" : "text-muted-foreground")}>{conv.preview || "—"}</div>
                  {(needsReply(conv) || conv.is_customer || conv.pushed_to_zalo) && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {needsReply(conv) && <Badge variant="secondary" className="border-transparent bg-red-100 text-[9px] text-red-700">cần trả lời</Badge>}
                      {conv.is_customer && <Badge variant="secondary" className="border-transparent bg-emerald-100 text-[9px] text-emerald-700">khách</Badge>}
                      {conv.pushed_to_zalo && <Badge variant="secondary" className="border-transparent bg-blue-100 text-[9px] text-blue-700">Zalo</Badge>}
                    </div>
                  )}
                </div>
              </button>
              );
            })}
          </div>
        </section>

        {/* Cot 2: Cua so chat */}
        <section className="flex h-[656px] min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card xl:h-[716px]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              {openConv && (
                <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-bold text-primary">
                  {(selectedName || "?").trim().charAt(0).toUpperCase() || "?"}
                </div>
              )}
              <div className="min-w-0">
                <h2 className="truncate text-sm font-bold text-foreground">{selectedName || "Hội thoại"}</h2>
                <p className="truncate text-xs text-muted-foreground">{selectedPreview || (openConv ? "Đang xem nội dung" : "Chọn hội thoại để bắt đầu")}</p>
              </div>
            </div>
            {selectedConv && !archiveReading && (
              <div className="flex flex-wrap gap-2">
                <button onClick={() => mark(selectedConv.conv_id, "is_customer", !selectedConv.is_customer)} className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold transition hover:border-primary">
                  {selectedConv.is_customer ? "Bỏ khách" : "Là khách"}
                </button>
                {selectedConv.is_customer && (
                  <button onClick={() => mark(selectedConv.conv_id, "pushed_to_zalo", !selectedConv.pushed_to_zalo)} className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold transition hover:border-primary">
                    {selectedConv.pushed_to_zalo ? "Bỏ Zalo" : "Đẩy Zalo"}
                  </button>
                )}
                <button onClick={() => saveArchive(selectedConv.conv_id, false)} className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold transition hover:border-primary">Lưu</button>
                <button onClick={() => confirmHide(selectedConv)} className="rounded-lg border border-destructive/30 px-2.5 py-1.5 text-xs font-semibold text-destructive transition hover:bg-destructive/10">Ẩn</button>
              </div>
            )}
            {archiveReading && openConv && (
              <button onClick={() => { switchInbox(); openChat(openConv); }} className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold transition hover:border-primary">Mở inbox</button>
            )}
          </div>

          <div ref={chatScrollRef} className="flex-1 overflow-auto bg-muted/30 px-4 py-4">
            {!openConv ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Chọn một hội thoại để xem tin nhắn.</div>
            ) : loadingChat && msgs.length === 0 ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">Đang tải hội thoại...</div>
            ) : msgs.length === 0 ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                {archiveReading ? "Bản lưu chưa có nội dung." :
                 needRelogin ? "Cookie hết hạn." :
                 accPaused ? "Realtime đang tạm dừng." :
                 !accOnline ? "Tài khoản offline." :
                 "Chưa lấy được tin nhắn."}
              </div>
            ) : (
              <div className="space-y-3">
                {msgs.map((message, index) => {
                  const { content, time } = displayMessage(message);
                  return (
                    <div key={`${index}-${message.clientId || time}`} className={cn("flex", message.from === "me" ? "justify-end" : "justify-start")}>
                      <div className={cn("max-w-[78%]", message.from === "me" ? "text-right" : "text-left")}>
                        <div className={cn("whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm leading-relaxed", message.from === "me" ? "bg-primary text-primary-foreground" : "bg-card text-foreground shadow-sm")}>
                          {content}
                        </div>
                        {time && <div className="mt-1 px-1 text-[10px] text-muted-foreground">{time}</div>}
                      </div>
                    </div>
                  );
                })}
                {loadingFresh && <div className="text-center text-[11px] text-muted-foreground">Đang cập nhật...</div>}
              </div>
            )}
          </div>

          <div className="border-t border-border bg-card p-3">
            <div className="mb-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setShowSalesAssetPicker(true)}
                disabled={!openConv || archiveReading}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-bold text-slate-700 transition hover:border-primary/40 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
              >
                <FileText size={13} />
                Gửi tài liệu
              </button>
              {activeTemplateGroup.items.slice(0, 3).map(item => (
                <button key={item} onClick={() => appendTemplate(item)} disabled={!openConv || archiveReading}
                  className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary transition hover:bg-primary/20 disabled:opacity-40 disabled:cursor-not-allowed">
                  {item.length > 34 ? `${item.slice(0, 34)}...` : item}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <textarea
                value={reply}
                onChange={e => setReply(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendReply(); } }}
                disabled={!canSend}
                rows={2}
                placeholder={archiveReading ? "Đang xem lưu trữ..." : needRelogin ? "Cookie hết hạn..." : !accOnline ? "Offline..." : "Nhập trả lời..."}
                className="min-h-[44px] flex-1 resize-none rounded-xl border border-input px-3 py-2 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:cursor-not-allowed disabled:bg-muted/50"
              />
              <button onClick={sendReply} disabled={!canSend || !reply.trim()}
                className="shrink-0 rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50">
                Gửi
              </button>
            </div>
          </div>
        </section>

        {/* Cot 3: Panel (Mau / Khach / KPI) */}
        <aside className="flex h-[656px] min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card xl:h-[716px]">
          <div className="grid shrink-0 grid-cols-3 border-b border-border bg-muted/40 text-sm font-bold">
            <button onClick={() => { setPanelTab("templates"); panelScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" }); }}
              className={cn("flex items-center justify-center gap-1.5 border-b-2 py-3 text-xs transition", panelTab === "templates" ? "border-primary bg-card text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>
              <MessageCircle size={14} />Mẫu
            </button>
            <button onClick={() => { setPanelTab("customer"); panelScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" }); }}
              className={cn("flex items-center justify-center gap-1.5 border-b-2 py-3 text-xs transition", panelTab === "customer" ? "border-primary bg-card text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>
              <User size={14} />Khách
            </button>
            <button onClick={() => { setPanelTab("kpi"); panelScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" }); }}
              className={cn("flex items-center justify-center gap-1.5 border-b-2 py-3 text-xs transition", panelTab === "kpi" ? "border-primary bg-card text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>
              <BarChart3 size={14} />KPI
            </button>
          </div>

          <div ref={panelScrollRef} className={cn("overflow-auto p-4", panelH)}>
            {/* ── Mau ── */}
            {panelTab === "templates" && (
              <div>
                <div className="mb-3 flex flex-wrap gap-1.5">
                  {QUICK_REPLY_GROUPS.map(group => (
                    <button key={group.id} onClick={() => setTemplateGroupId(group.id)}
                      className={cn("rounded-full px-3 py-1.5 text-xs font-semibold transition", templateGroupId === group.id ? "bg-primary text-primary-foreground" : "bg-muted/60 text-muted-foreground hover:text-foreground")}>
                      {group.label}
                    </button>
                  ))}
                </div>
                <div className="space-y-2">
                  {activeTemplateGroup.items.map(item => (
                    <button key={item} onClick={() => appendTemplate(item)} disabled={!openConv || archiveReading}
                      className="block w-full rounded-xl border border-border bg-card p-3 text-left text-sm leading-relaxed transition hover:border-primary hover:bg-primary/5 disabled:opacity-40 disabled:cursor-not-allowed">
                      {item}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ── Khach ── */}
            {panelTab === "customer" && (
              <div>
                {!openConv ? (
                  <div className="rounded-xl border border-dashed border-border bg-muted/40 p-4 text-sm text-muted-foreground">Chọn hội thoại để xem thông tin.</div>
                ) : (
                  <div className="space-y-3">
                    <div className="rounded-xl border border-border p-3">
                      <div className="text-xs font-semibold uppercase text-muted-foreground">Tên</div>
                      <div className="mt-1 text-sm font-bold text-foreground">{selectedName || openConv}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{selectedPreview || "—"}</div>
                    </div>
                    <div className="rounded-xl border border-border bg-muted/30 p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div>
                          <div className="text-xs font-semibold uppercase text-muted-foreground">Ghi chú nhu cầu</div>
                          <div className="text-[11px] text-muted-foreground">Lưu điểm cần nhớ về khách.</div>
                        </div>
                        {selectedNote && !noteChanged && <Badge variant="secondary" className="border-transparent bg-emerald-100 text-[10px] text-emerald-700">đã lưu</Badge>}
                      </div>
                      <textarea
                        value={noteDraft}
                        onChange={e => setNoteDraft(e.target.value)}
                        rows={5}
                        maxLength={1000}
                        placeholder="VD: khách cần app booking..."
                        className="w-full resize-none rounded-xl border border-input bg-card px-3 py-2 text-sm leading-relaxed outline-none transition focus:border-primary disabled:bg-muted/50 disabled:cursor-not-allowed"
                      />
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <span className="text-[11px] text-muted-foreground">{noteDraft.trim().length}/1000</span>
                        <button
                          onClick={() => saveCustomerNote(openConv, noteDraft)}
                          disabled={!openConv || savingNoteConv === openConv || !noteChanged}
                          className="rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {savingNoteConv === openConv ? "Đang lưu..." : "Lưu ghi chú"}
                        </button>
                      </div>
                    </div>
                    {selectedConv && !archiveReading && (
                      <div className="grid gap-2">
                        <button
                          onClick={() => setShowLeadModal(true)}
                          className="flex items-center justify-center gap-2 rounded-xl border border-amber-200 bg-amber-100 px-3 py-2 text-sm font-semibold text-amber-800 transition hover:bg-amber-200"
                        >
                          <UserPlus size={16} />
                          Lưu vào CRM (Leads)
                        </button>
                        <button onClick={() => mark(selectedConv.conv_id, "is_customer", !selectedConv.is_customer)}
                          className="rounded-xl border border-border px-3 py-2 text-sm font-semibold transition hover:border-primary">
                          {selectedConv.is_customer ? "Bỏ đánh dấu khách" : "Đánh dấu là khách"}
                        </button>
                        <button onClick={() => saveArchive(selectedConv.conv_id, false)}
                          className="rounded-xl border border-border px-3 py-2 text-sm font-semibold transition hover:border-primary">Lưu khách</button>
                        <button onClick={() => confirmHide(selectedConv)}
                          className="rounded-xl border border-destructive/30 px-3 py-2 text-sm font-semibold text-destructive transition hover:bg-destructive/10">Ẩn khỏi hộp thư</button>
                      </div>
                    )}
                    {archiveReading && <div className="rounded-xl bg-muted/40 p-3 text-sm text-muted-foreground">Đây là bản lưu trữ.</div>}
                  </div>
                )}
              </div>
            )}

            {/* ── KPI ── */}
            {panelTab === "kpi" && (
              <div>
                {/* Admin / Leader: Xac nhan KPI */}
                {(role === "admin" || role === "leader") && (() => {
                  const isConfirmed = verifiedConvIds?.has(openConv);
                  const confirmedAt = verifiedConvDates[openConv];
                  // Hoi thoai da xac nhan roi thi hien dung TUAN LUC XAC NHAN
                  // (co the la tuan truoc), khong phai tuan dang xem lai hom nay.
                  const confirmedWeekNumber = confirmedAt ? getWeekNumber(new Date(confirmedAt)) : getCurrentWeekNumber();
                  return (
                  <div className={cn("mb-5 rounded-xl border p-4 transition-colors",
                    isConfirmed ? "border-emerald-200 bg-emerald-50" : "border-primary/20 bg-card")}>

                    <div className="mb-1 flex flex-wrap items-center justify-between gap-1.5">
                      <div className={cn("flex min-w-0 flex-wrap items-center gap-1.5 text-xs font-bold uppercase", isConfirmed ? "text-emerald-700" : "text-foreground")}>
                        <span className="whitespace-nowrap">{isConfirmed ? "Đã xác nhận Lead" : "Xác nhận Lead"}</span>
                        <span className="shrink-0 whitespace-nowrap rounded-full bg-black/5 px-1.5 py-0.5 text-[10px] font-semibold normal-case text-muted-foreground">Tuần {confirmedWeekNumber}</span>
                      </div>
                      {verifiedConvIds?.has(openConv) && <CheckCircle2 size={18} className="shrink-0 text-emerald-500" />}
                    </div>

                    {/* KPI Inbox tinh tu dong khi extension quet duoc tin nhan moi -
                        badge nay chi de user yen tam biet acc dang/da duoc dong bo,
                        khong phai nut bam. */}
                    {!accOnline ? (
                      <div className="mb-3 flex items-center gap-1.5 rounded-lg bg-muted/60 px-2.5 py-1.5 text-[11px] font-semibold text-muted-foreground">
                        <Lock size={12} /> Tài khoản offline — chưa quét được KPI Inbox tự động.
                      </div>
                    ) : needRelogin ? (
                      <div className="mb-3 flex items-center gap-1.5 rounded-lg bg-red-50 px-2.5 py-1.5 text-[11px] font-semibold text-red-600">
                        🔴 Cần đăng nhập lại — chưa quét được KPI Inbox tự động.
                      </div>
                    ) : scanning ? (
                      <div className="mb-3 flex items-center gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] font-semibold text-amber-700">
                        <RefreshCw size={12} className="animate-spin" /> Đang quét tự động...
                      </div>
                    ) : (
                      <div className="mb-3 flex items-center justify-between gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-700">
                        <span>✅ Đã đồng bộ KPI Inbox tự động</span>
                        <button
                          onClick={scan}
                          title="Quét lại ngay để chắc chắn KPI đã đồng bộ đúng"
                          className="flex shrink-0 items-center gap-1 rounded-md border border-emerald-300 bg-white px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 transition hover:bg-emerald-100"
                        >
                          <RefreshCw size={10} /> Quét lại
                        </button>
                      </div>
                    )}

                    {/* KPI Inbox tinh theo created_at cua dong fb_inbox_kpi (thoi diem
                        tin nhan dau tien duoc auto-detect) - co the khac tuan voi luc
                        Lead duoc xac nhan (vd hoi thoai cu, Lead moi danh dau hom nay).
                        Hien ro cho leader biet dang xem lai 1 chat da tinh vao tuan nao. */}
                    {openConv && (
                      inboxKpiWeekDates[openConv] ? (
                        <div className="mb-3 rounded-lg bg-violet-50 px-2.5 py-1.5 text-[11px] font-semibold text-violet-700">
                          📊 KPI Inbox của hội thoại này tính vào Tuần {getWeekNumber(new Date(inboxKpiWeekDates[openConv]))}
                        </div>
                      ) : (
                        <div className="mb-3 text-[11px] font-medium text-muted-foreground">
                          Hội thoại này chưa được tính KPI Inbox.
                        </div>
                      )
                    )}

                    {!verifiedConvIds?.has(openConv) && (
                      <div className="mb-3 text-xs text-muted-foreground">Chọn hội thoại bên trái rồi bấm xác nhận nếu đây là khách hàng tiềm năng (Lead).</div>
                    )}

                    {/* Da chon 1 hoi thoai roi thi ten da hien san o header khung chat phia
                        tren - khong lap lai ten o day nua, chi hien badge trang thai neu co. */}
                    {openConv && selectedConv && (selectedConv.is_customer || selectedConv.pushed_to_zalo) ? (
                      <div className="mb-4 flex flex-wrap gap-1.5">
                        {selectedConv.is_customer && <Badge variant="secondary" className="gap-1 border-transparent bg-emerald-100 text-[10px] text-emerald-700"><Star size={11} /> Đã đánh dấu khách</Badge>}
                        {selectedConv.pushed_to_zalo && <Badge variant="secondary" className="gap-1 border-transparent bg-blue-100 text-[10px] text-blue-700"><Send size={11} /> Đã đẩy Zalo</Badge>}
                      </div>
                    ) : !openConv ? (
                      <div className="mb-4 rounded-xl border border-dashed border-border bg-muted/40 p-4 text-center text-xs text-muted-foreground">
                        Chưa chọn hội thoại
                      </div>
                    ) : null}

                    {/* KPI Inbox gio tinh tu dong hoan toan khi extension quet duoc tin
                        nhan (xem badge trang thai o tren) - khong con nut xac nhan Inbox
                        thu cong nua. Nut con lai chi danh dau Lead (khach hang tiem nang),
                        khong dung dung de "bao" KPI Inbox cho hoi thoai cu. */}
                    {openConv && selectedConv && (
                      verifiedConvIds?.has(openConv) ? (
                        <div className="whitespace-nowrap rounded-xl border border-emerald-200/50 bg-emerald-100/50 p-3 text-center text-xs font-semibold text-emerald-700">
                          Bạn đã đánh dấu Lead cho hội thoại này (Tuần {confirmedWeekNumber}).
                        </div>
                      ) : (
                        <button onClick={async () => {
                          if (!acc) return;
                          try {
                            await syncFbInbox({ leader_email: ownerEmail, member_email: accountOwnerEmail || userEmail, conv_ids: [openConv], user_id: acc, is_lead: true });
                            showToastKpi("Đã xác nhận Lead!", true);
                            mark(openConv, "is_customer", true);
                          } catch { showToastKpi("Lỗi xác nhận lead", false); }
                        }}
                          className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-600 active:scale-[0.98]">
                          <Star size={16} /> Xác nhận Lead
                        </button>
                      )
                    )}
                  </div>
                  );
                })()}

                {/* Tong quan */}
                <div className="mb-3 text-sm font-bold text-foreground">Tổng quan inbox</div>
                {[
                  ["Cần trả lời", stats.need, activeConvs.length || 1, "bg-primary"],
                  ["Chưa đọc",    stats.unread,    activeConvs.length || 1, "bg-amber-500"],
                  ["Lead đã lưu", stats.customers, activeConvs.length || 1, "bg-emerald-500"],
                  ["Đã đẩy Zalo", stats.pushed,    activeConvs.length || 1, "bg-blue-500"],
                ].map(([label, value, total, color]) => {
                  const pct = Math.min(100, Math.round((Number(value) / Number(total)) * 100));
                  return (
                    <div key={String(label)} className="mb-3 rounded-xl border border-border p-3">
                      <div className="mb-2 flex justify-between text-xs font-semibold">
                        <span>{String(label)}</span>
                        <span>{Number(value)}</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <div className={cn("h-full", String(color))} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </aside>
      </div>

      <SalesAssetPickerModal
        open={showSalesAssetPicker}
        onClose={() => setShowSalesAssetPicker(false)}
        onSend={appendSalesAsset}
        customerLeadId={currentLead?.id || null}
        dealId={currentLead?.id || null}
      />

      {toast && <div className={cn("fixed bottom-6 right-6 z-50 rounded-xl px-5 py-3.5 font-semibold text-white shadow-lg", toast.ok ? "bg-green-600" : "bg-red-600")}>{toast.msg}</div>}
      {kpiToast && <div className={cn("fixed bottom-6 right-6 z-50 rounded-xl px-5 py-3.5 font-semibold text-white shadow-lg", kpiToast.ok ? "bg-green-600" : "bg-red-600")}>{kpiToast.msg}</div>}

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
