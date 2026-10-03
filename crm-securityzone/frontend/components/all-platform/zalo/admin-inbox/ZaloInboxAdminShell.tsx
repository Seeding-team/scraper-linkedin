"use client";

import { useMemo, useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useZaloAdminInbox, type ZaloConv } from "@/hooks/useZaloAdminInbox";
import ZaloTeamAccountTree from "./ZaloTeamAccountTree";
import ZaloAccountAuthView from "./ZaloAccountAuthView";
import { CrmCustomerModal } from "@/components/all-platform/components/CrmCustomerModal";
import { SalesAssetPickerModal } from "@/components/all-platform/sales-assets/SalesAssetPickerModal";
import { useRouter, useSearchParams } from "next/navigation";
import { resolveZaloConversationAccount } from "@/services/zaloCrawlerService";
import { KpiProgressCard } from "@/components/all-platform/components/kpi-progress-card";
import { MaterialIcon } from "@/components/ui";
import { cn } from "@/lib/utils";
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
} from "@/services/zaloCrawlerService";
import type { ZaloBroadcastTarget } from "@/types/zalo-api";
import { customerLeadService, type Customer } from "@/services/customer-lead.service";
import type { SalesAsset } from "@/services/sales-asset.service";

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

type PanelTab = "templates" | "customer" | "kpi" | "account" | "campaign";
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

// ─── Main Component ───────────────────────────────────────────────────────────

export function ZaloInboxAdminShell() {
  const inbox = useZaloAdminInbox();

  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    void Promise.resolve().then(() => setMounted(true));
  }, []);

  const [panelTab, setPanelTab] = useState<PanelTab>("templates");
  const [templateGroupId, setTemplateGroupId] = useState(QUICK_REPLY_GROUPS[0].id);
  const [noteDraftState, setNoteDraftState] = useState({ convId: "", value: "" });
  const panelScrollRef = useRef<HTMLDivElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  // States for account edit
  const [editLabel, setEditLabel] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [isSavingAccount, setIsSavingAccount] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  // UID người gửi đang được mở hội thoại riêng (loading state cho icon "Nhắn riêng"
  // trên tin nhắn nhóm) — không cần đã kết bạn, chỉ cần biết user_id + tên hiển thị
  // lấy sẵn từ chính tin nhắn nhóm đó (giống luồng "Nhắn tin cho người lạ" đã có).
  const [startingDmSenderId, setStartingDmSenderId] = useState<string | null>(null);

  // States for creating new account
  const [isCreatingAccount, setIsCreatingAccount] = useState(true);
  const [newLabel, setNewLabel] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newOwnerId, setNewOwnerId] = useState("");

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

  // Luong "Xu ly" tu trang Khach hang (CRM): ?conv=<conv_id> tren URL -> tu dong
  // do tim dung acc Zalo dang giu hoi thoai nay (qua API resolve-account, da co san
  // kiem tra quyen theo team/leader/admin) roi tu chon acc + nhay thang toi hoi thoai,
  // khong bat nguoi dung phai tu tim acc nao dang giu no.
  const router = useRouter();
  const searchParams = useSearchParams();
  const jumpToConvRef = useRef<string | null>(null);
  const jumpToAccountRef = useRef<string | null>(null);
  useEffect(() => {
    // Từ trang /all-platform/tai-khoan, nút "Mở chat" điều hướng sang đây kèm
    // ?account=<id> để tự chọn đúng tài khoản, không bắt người dùng tự tìm lại.
    const targetAccount = searchParams.get("account");
    if (!targetAccount || jumpToAccountRef.current === targetAccount) return;
    jumpToAccountRef.current = targetAccount;
    inbox.onSelectAccount(targetAccount);
  }, [searchParams, inbox]);
  useEffect(() => {
    const targetConv = searchParams.get("conv");
    if (!targetConv || jumpToConvRef.current === targetConv) return;
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
  const [currentLead, setCurrentLead] = useState<Customer | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    setSelectedFiles((prev) => [...prev, ...files]);
    e.target.value = "";
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

  // Sync edit account values & switch forms automatically
  useEffect(() => {
    void Promise.resolve().then(() => setIsCreatingAccount(!inbox.selectedAccountId));
  }, [inbox.selectedAccountId]);

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
    () => inbox.filtered.find((c) => c.conv_id === inbox.openConv) ?? null,
    [inbox.filtered, inbox.openConv]
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

  // Scroll to bottom on chat loading
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [inbox.messages]);

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
    inbox.setReply((prev) => (prev.trim() ? `${prev.trim()}\n${text}` : text));
  };

  const appendSalesAsset = (asset: SalesAsset) => {
    const link = asset.sourceUrl || asset.shareUrl;
    const meta = [asset.projectName, asset.version].filter(Boolean).join(" - ");
    const text = `${asset.title}${meta ? ` (${meta})` : ""}\n${link}`;
    inbox.setReply((prev) => (prev.trim() ? `${prev.trim()}\n${text}` : text));
    setShowSalesAssetPicker(false);
    inbox.showToast("Đã chèn tài liệu vào ô trả lời.", true);
  };

  useEffect(() => {
    if (!inbox.openConv) {
      void Promise.resolve().then(() => setCurrentLead(null));
      return;
    }
    let cancelled = false;
    void Promise.resolve().then(async () => {
      try {
        const lead = await customerLeadService.getByConvId(inbox.openConv);
        if (!cancelled) setCurrentLead(lead);
      } catch {
        if (!cancelled) setCurrentLead(null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [inbox.openConv]);

  // Nhắn riêng cho 1 người từng nhắn trong nhóm — KHÔNG cần đã kết bạn/tìm SĐT,
  // vì user_id + tên hiển thị đã có sẵn ngay trong tin nhắn nhóm (sender_id/
  // sender_name, do listener lưu lại khi nhận tin). Dùng lại đúng endpoint
  // "Nhắn tin cho người lạ" (POST /conversations/users) — tạo/mở thread cá nhân
  // rồi chuyển sang đó để nhắn liền.
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
      inbox.showToast(`Đã mở hội thoại riêng với ${senderName || senderId}`, true);
    } catch (e) {
      inbox.showToast(
        e instanceof Error ? e.message : "Không thể mở hội thoại riêng với người này",
        false,
      );
    } finally {
      setStartingDmSenderId(null);
    }
  };

  const handleSuggestKpi = async () => {
    if (!inbox.selectedAccountId || !ownerEmail) return;
    const pendingConvs = inbox.activeConvs
      .filter((c) => !inbox.verifiedConvIds.has(c.conv_id) && !inbox.suggestedConvIds.has(c.conv_id))
      .map((c) => c.conv_id);

    if (pendingConvs.length === 0) {
      inbox.showToast("Không có hội thoại nào cần đề xuất tính KPI", false);
      return;
    }
    await inbox.onSuggestKpi({
      member_email: ownerEmail,
      conv_ids: pendingConvs,
      user_id: inbox.selectedAccountId,
    });
  };

  const handleVerifyKpi = async () => {
    if (!inbox.openConv) return;
    await inbox.onBulkVerifyKpi({
      leader_email: inbox.leaderEmail,
      target_date: inbox.targetDate,
    });
  };

  // Zalo Account Actions
  const handleUpdateAccount = async () => {
    if (!inbox.selectedAccountId) return;
    setIsSavingAccount(true);
    try {
      await updateZaloAccount(inbox.selectedAccountId, {
        label: editLabel,
        phone: editPhone,
      });
      inbox.showToast("Cập nhật thông tin tài khoản thành công!", true);
      void inbox.refreshAccounts();
    } catch (e) {
      inbox.showToast(e instanceof Error ? e.message : "Cập nhật thất bại", false);
    } finally {
      setIsSavingAccount(false);
    }
  };

  const allMembers = useMemo(() => {
    return inbox.teams.flatMap((t) => t.members ?? []);
  }, [inbox.teams]);

  const handleCreateAccount = async () => {
    const cleanLabel = newLabel.trim();
    if (!cleanLabel) {
      inbox.showToast("Nhập tên nhãn hiển thị trước.", false);
      return;
    }
    if (!newOwnerId) {
      inbox.showToast("Chọn nhân sự quản lý tài khoản.", false);
      return;
    }
    setIsSavingAccount(true);
    try {
      const rawId = newPhone.trim() || cleanLabel;
      const accountId = rawId.toLowerCase().replace(/[^a-z0-9]/g, "");
      await createZaloAccount({
        account_id: accountId,
        owner_id: newOwnerId,
        id_member: newOwnerId,
        label: cleanLabel,
        phone: newPhone.trim() || undefined,
      });
      inbox.showToast("Đã thêm tài khoản Zalo mới thành công!", true);
      setNewLabel("");
      setNewPhone("");
      setIsCreatingAccount(false);
      void inbox.refreshAccounts();
    } catch (error) {
      inbox.showToast(error instanceof Error ? error.message : "Không thể tạo tài khoản Zalo.", false);
    } finally {
      setIsSavingAccount(false);
    }
  };

  const handleRestartListener = async () => {
    if (!inbox.selectedAccountId) return;
    inbox.showToast("Đang khởi động lại listener...", true);
    try {
      await restartZaloAccountListener(inbox.selectedAccountId);
      inbox.showToast("Listener đã được khởi động lại thành công!", true);
      void inbox.refreshAccounts();
    } catch (e) {
      inbox.showToast(e instanceof Error ? e.message : "Lỗi khởi động", false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!inbox.selectedAccountId) return;
    if (window.confirm("Bạn có chắc chắn muốn ẩn tài khoản Zalo này khỏi Inbox?")) {
      try {
        await deleteZaloAccount(inbox.selectedAccountId, false);
        inbox.showToast("Đã ẩn tài khoản Zalo", true);
        inbox.onSelectAccount("");
        void inbox.refreshAccounts();
      } catch (e) {
        inbox.showToast("Lỗi khi ẩn tài khoản", false);
      }
    }
  };

  const handleDeleteFull = async () => {
    if (!inbox.selectedAccountId) return;
    if (
      window.confirm(
        "CẢNH BÁO: Hành động này sẽ xoá hoàn toàn file session đăng nhập Zalo trên VPS và dữ liệu chat trong DB. Bạn có chắc chắn?"
      )
    ) {
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

  // Group messages by date
  const groupedMessages = (() => {
    const groups: { date: string; msgs: ZaloLibraryMessage[] }[] = [];
    for (const msg of inbox.messages) {
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

  const panelH = "h-[620px]";

  return (
    <div className="w-full max-w-full text-[#1A1A1A] flex flex-col bg-slate-50 pb-8">
      {/* ── Header ── */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3 flex-shrink-0">
        <div>
          <button
            type="button"
            onClick={() => router.push("/all-platform/tai-khoan")}
            className="mb-2 inline-flex items-center gap-1 rounded-lg border border-[#E5E5E5] bg-white px-2.5 py-1 text-xs font-bold text-[#666666] transition hover:border-[#E3000F] hover:text-[#E3000F]"
          >
            <MaterialIcon name="arrow_back" className="text-[16px]" />
            Quay lại Tài khoản
          </button>
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-[#E3000F] to-red-700 flex items-center justify-center shadow-sm">
              <MaterialIcon name="chat" className="text-white text-[18px]" />
            </div>
            <h1 className="text-xl font-black">Inbox Zalo Admin</h1>
          </div>
          <p className="mt-1 text-sm text-[#666666]">
            Quản lý hội thoại Zalo của tất cả nhân sự, theo dõi online/offline và tính KPI inbox.
          </p>
        </div>
        {/* Nút "Quét ngay" đã bị bỏ (2026-07-04) — cùng gọi inbox.scan() như 2
            nút Đồng bộ khác trong file này. Xem ghi chú trong useZaloAdminInbox.ts. */}
      </div>

      {/* Toast Alert */}
      {inbox.toast && (
        <div
          className={cn(
            "mb-3 rounded-lg border px-4 py-3 text-sm font-semibold transition-all shadow-sm flex-shrink-0",
            inbox.toast.ok ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-800"
          )}
        >
          {inbox.toast.msg}
        </div>
      )}

      {/* ── Stats Row ── */}
      <div className="mb-4 grid min-w-0 grid-cols-2 gap-3 xl:grid-cols-4 flex-shrink-0">
        {[
          ["Hội thoại", stats.total, stats.unread],
          ["Cần trả lời", stats.needReply, null],
          ["Lead đã lưu", stats.customers, stats.pushed],
          ["Online", inbox.sessions.filter((s) => s.listener?.connected).length, inbox.sessions.length],
        ].map(([label, val, sub], i) => (
          <div key={label} className="rounded-xl border border-[#E5E5E5] bg-white px-4 py-3 shadow-sm">
            <div className="text-[11px] font-bold uppercase text-[#A0A0A0]">{String(label)}</div>
            <div className="mt-1 text-2xl font-black" style={i === 1 ? { color: "#E3000F" } : {}}>
              {val}
            </div>
            {sub !== null && (
              <div className="text-xs text-[#A0A0A0]">
                {sub} {i === 0 ? "chưa đọc" : i === 2 ? "chưa tính KPI" : "tài khoản"}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* ── KPI Progress Cards ── */}
      {ownerEmail && (
        <div className="mb-4 grid grid-cols-1 xl:grid-cols-2 gap-4 flex-shrink-0">
          <KpiProgressCard email={ownerEmail} type="inbox" />
          <KpiProgressCard email={ownerEmail} type="lead" />
        </div>
      )}

      {/* ── Employee Accounts selection panel ── */}
      <div className="mb-4 min-w-0 rounded-xl border border-[#E5E5E5] bg-white p-3 shadow-sm flex-shrink-0">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-xs font-bold uppercase text-[#A0A0A0]">Tài khoản nhân viên</div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {inbox.role === "admin" || inbox.role === "leader" ? (
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={inbox.targetDate}
                  onChange={(e) => inbox.setTargetDate(e.target.value)}
                  className="rounded border border-[#E5E5E5] px-2 py-1 text-xs outline-none focus:border-[#E3000F]"
                />
                <button
                  onClick={() =>
                    inbox.onBulkVerifyKpi({ leader_email: inbox.leaderEmail, target_date: inbox.targetDate })
                  }
                  disabled={inbox.isBulkVerifying}
                  className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-emerald-700 disabled:opacity-50"
                >
                  {inbox.isBulkVerifying ? "ĐANG TÍNH..." : "TÍNH KPI HÀNG LOẠT"}
                </button>
              </div>
            ) : (
              <button
                onClick={handleSuggestKpi}
                disabled={inbox.isBulkSuggesting || !inbox.selectedAccountId}
                className="rounded bg-blue-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-blue-700 disabled:opacity-50"
              >
                {inbox.isBulkSuggesting ? "ĐANG ĐỀ XUẤT..." : "ĐỀ XUẤT TÍNH KPI HÀNG LOẠT"}
              </button>
            )}
            <div className="text-xs text-[#A0A0A0] hidden md:block">Realtime cập nhật, offline chỉ xem dữ liệu.</div>
          </div>
        </div>

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

      {/* ── 3-Pane Layout ── */}
      <div className="grid min-w-0 grid-cols-[280px_1fr_260px] gap-4">
        {/* Pane 1: Conversations list */}
        <section className="min-w-0 overflow-hidden rounded-xl border border-[#E5E5E5] bg-white shadow-sm flex flex-col">
          <div className="border-b border-[#E5E5E5] p-3 flex-shrink-0 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 min-w-0">
                <h2 className="text-sm font-bold">Hộp thư</h2>
                {/* Nút "Đồng bộ" thủ công đã bị bỏ (2026-07-04): nó gọi
                    syncZaloRecentConversations -> backend tự đăng nhập lại
                    phiên Zalo qua worker pool, chạy song song với listener
                    realtime đang giữ phiên đó -> 2 phiên đè/kick nhau, làm gãy
                    đồng bộ tự động cho tài khoản đó. Listener realtime đã tự lo
                    đồng bộ, không cần nút này nữa. */}
                {inbox.role === "member" && inbox.suggestedConvIds.size > 0 && (
                  <button
                    onClick={() => void inbox.onRevokeAllShares()}
                    title="Hủy chia sẻ toàn bộ các hội thoại chưa được duyệt KPI"
                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-bold text-slate-600 transition hover:border-red-400 hover:text-red-600 hover:bg-red-50 shrink-0"
                  >
                    <MaterialIcon name="lock" className="text-[11px]" />
                    <span>Hủy share tất cả</span>
                  </button>
                )}
              </div>
              <p className="text-[11px] text-[#A0A0A0] shrink-0">
                {inbox.loadingConvs ? "Đang cập nhật..." : `${inbox.filtered.length} hội thoại`}
              </p>
            </div>
            <div>
              <select
                value={inbox.filter}
                onChange={(e) => inbox.setFilter(e.target.value as ZaloInboxFilter)}
                className="h-8 w-full rounded-lg border border-[#E5E5E5] bg-white px-2 text-xs font-semibold outline-none focus:border-[#E3000F]"
              >
                <option value="all">Tất cả (Lọc)</option>
                <option value="need_reply">Cần trả lời</option>
                <option value="unread">Chưa đọc</option>
                <option value="customer">Khách hàng</option>
                <option value="need_verify">Chưa tính KPI (Đã share)</option>
              </select>
            </div>
            <div className="inline-flex rounded-lg border border-[#E5E5E5] bg-[#F8F8F8] p-0.5 w-full">
              <button
                onClick={() => inbox.setArchiveReading(false)}
                className={cn(
                  "flex-1 rounded-md py-1 text-xs font-bold transition",
                  !inbox.archiveReading ? "bg-white text-[#E3000F] shadow-sm" : "text-[#666666]"
                )}
              >
                Hộp thư
              </button>
              <button
                onClick={() => inbox.setArchiveReading(true)}
                className={cn(
                  "flex-1 rounded-md py-1 text-xs font-bold transition",
                  inbox.archiveReading ? "bg-white text-[#E3000F] shadow-sm" : "text-[#666666]"
                )}
              >
                Lưu trữ
              </button>
            </div>
          </div>

          <div className="h-[600px] overflow-y-auto p-2 space-y-1.5">
            {inbox.archiveReading ? (
              inbox.archives.length === 0 ? (
                <div className="py-12 text-center text-xs text-[#A0A0A0]">Chưa có hội thoại lưu trữ.</div>
              ) : (
                inbox.archives.map((item) => (
                  <button
                    key={item.conv_id}
                    onClick={() => inbox.openArchive(item.conv_id)}
                    className={cn(
                      "w-full rounded-lg border p-2.5 text-left transition text-xs",
                      inbox.openConv === item.conv_id && inbox.archiveReading
                        ? "border-[#E3000F] bg-[#FFF5F5]"
                        : "border-[#E5E5E5] bg-white hover:border-[#E3000F]/60"
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-bold text-slate-800">{item.name}</div>
                        <div className="mt-0.5 truncate text-[11px] text-[#A0A0A0]">{item.preview || "—"}</div>
                      </div>
                    </div>
                  </button>
                ))
              )
            ) : inbox.loadingConvs && inbox.filtered.length === 0 ? (
              <div className="py-12 text-center text-xs text-[#A0A0A0]">Đang tải hộp thư...</div>
            ) : inbox.filtered.length === 0 ? (
              <div className="py-12 text-center text-xs text-[#A0A0A0]">Chưa có hội thoại.</div>
            ) : (
              inbox.filtered.map((conv) => (
                <button
                  key={conv.conv_id}
                  onClick={() => inbox.openChat(conv.conv_id)}
                  className={cn(
                    "w-full rounded-lg border p-2.5 text-left transition text-xs",
                    inbox.openConv === conv.conv_id && !inbox.archiveReading
                      ? "border-[#E3000F] bg-[#FFF5F5]"
                      : "border-[#E5E5E5] bg-white hover:border-[#E3000F]/60"
                  )}
                >
                  <div className="flex items-start justify-between gap-1.5">
                    <div className="min-w-0 flex-1">
                      <div className={cn("truncate font-bold text-slate-800", conv.unread && "font-black text-black")}>
                        {conv.name}
                      </div>
                      <div className="mt-0.5 truncate text-[11px] text-[#A0A0A0]">{conv.preview || "—"}</div>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className="whitespace-nowrap text-[10px] text-[#A0A0A0]">{conv.time}</span>
                      <div className="flex items-center gap-1">
                        {inbox.verifiedConvIds.has(conv.conv_id) ? (
                          <span title="Đã duyệt KPI"><MaterialIcon name="verified" className="text-green-600 text-[13px]" /></span>
                        ) : inbox.suggestedConvIds.has(conv.conv_id) ? (
                          <span title="Đã chia sẻ với leader"><MaterialIcon name="share" className="text-blue-600 text-[13px]" /></span>
                        ) : (
                          <span title="Riêng tư (Chỉ mình tôi)"><MaterialIcon name="lock" className="text-slate-400 text-[13px]" /></span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {conv.unread && (
                      <span className="rounded-full bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-[9px] font-bold text-amber-700">
                        chưa đọc
                      </span>
                    )}
                    {conv.is_customer && (
                      <span className="rounded-full bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700">
                        khách
                      </span>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </section>

        {/* Pane 2: Chat panel (middle) */}
        <section className="flex h-[700px] min-w-0 flex-col overflow-hidden rounded-xl border border-[#E5E5E5] bg-white shadow-sm">
          {inbox.selectedAccountId && (accountStatus === "expired" || accountStatus === "offline") && (
            <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center justify-between text-xs text-amber-800 flex-shrink-0 animate-fade-in">
              <span className="flex items-center gap-1.5 font-semibold">
                <MaterialIcon name="warning" className="text-amber-500 text-base" />
                {canManageAccountAuth
                  ? "Tài khoản này chưa đăng nhập hoặc đã hết phiên. Vui lòng đăng nhập lại."
                  : "Tài khoản của nhân viên đang offline / hết phiên. Bạn đang xem dữ liệu lịch sử."}
              </span>
              {canManageAccountAuth && (
                <button
                  onClick={() => setShowAuthModal(true)}
                  className="bg-amber-600 hover:bg-amber-700 text-white font-bold px-2 py-1 rounded text-[10px] transition shadow-sm"
                >
                  Đăng nhập lại
                </button>
              )}
            </div>
          )}

          <div className="flex items-center justify-between gap-3 border-b border-[#E5E5E5] px-4 py-2.5 bg-[#FAFAFA] flex-shrink-0">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="truncate text-sm font-bold text-slate-800">{selectedName || "Hội thoại"}</h2>
                {/* Nút "Đồng bộ" tin nhắn theo hội thoại đã bị bỏ (2026-07-04) —
                    cùng lý do với nút đồng bộ ở Hộp thư: gọi syncZaloConversationMessages
                    làm backend đăng nhập lại phiên Zalo qua worker pool, đè lên
                    phiên listener realtime đang chạy cho tài khoản đó. */}
                {selectedMessageIds.length > 0 && (
                  <span className="bg-red-105 text-[#E3000F] text-[10px] font-bold px-1.5 py-0.5 rounded-full animate-pulse border border-red-200">
                    Đã chọn {selectedMessageIds.length} tin
                  </span>
                )}
              </div>
              <p className="truncate text-[11px] text-[#A0A0A0]">
                {selectedPreview || (inbox.openConv ? "Đang xem nội dung" : "Chọn hội thoại để bắt đầu")}
              </p>
            </div>
            {selectedConv && !inbox.archiveReading && (
              <div className="flex gap-1.5 items-center">
                <button
                  onClick={() => void inbox.onToggleShare(selectedConv.conv_id)}
                  disabled={inbox.verifiedConvIds.has(selectedConv.conv_id)}
                  className={cn(
                    "rounded-lg border px-2 py-1 text-xs font-bold transition flex items-center gap-1 shadow-sm",
                    inbox.verifiedConvIds.has(selectedConv.conv_id)
                      ? "border-green-200 bg-green-50 text-green-700 hover:bg-green-100 cursor-not-allowed"
                      : inbox.suggestedConvIds.has(selectedConv.conv_id)
                      ? "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
                      : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"
                  )}
                  title={
                    inbox.verifiedConvIds.has(selectedConv.conv_id)
                      ? "Leader đã duyệt KPI, không thể hủy chia sẻ"
                      : inbox.suggestedConvIds.has(selectedConv.conv_id)
                      ? "Nhấn để hủy chia sẻ với leader/admin"
                      : "Nhấn để chia sẻ hội thoại này với leader/admin"
                  }
                >
                  <MaterialIcon
                    name={
                      inbox.verifiedConvIds.has(selectedConv.conv_id)
                        ? "verified"
                        : inbox.suggestedConvIds.has(selectedConv.conv_id)
                        ? "share"
                        : "lock"
                    }
                    className="text-base"
                  />
                  <span>
                    {inbox.verifiedConvIds.has(selectedConv.conv_id)
                      ? "Đã Duyệt KPI"
                      : inbox.suggestedConvIds.has(selectedConv.conv_id)
                      ? "Hủy Chia Sẻ"
                      : "Chia Sẻ"}
                  </span>
                </button>
                <button
                  onClick={() => {
                    setPanelTab("campaign");
                    panelScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                  className={cn(
                    "rounded-lg border px-2 py-1 text-xs font-bold transition flex items-center gap-0.5 shadow-sm",
                    selectedMessageIds.length > 0
                      ? "border-red-200 bg-red-50 text-[#E3000F] hover:bg-red-100"
                      : "border-[#E5E5E5] bg-white text-slate-500 hover:bg-slate-50"
                  )}
                  title="Mở chiến dịch gửi tin hàng loạt (Auto)"
                >
                  <MaterialIcon name="campaign" className="text-base" />
                  <span>Auto Send</span>
                </button>
                <button
                  onClick={() => inbox.mark(selectedConv.conv_id, "is_customer", !selectedConv.is_customer)}
                  className="rounded-lg border border-[#E5E5E5] bg-white px-2 py-1 text-xs font-bold hover:border-[#E3000F] text-slate-700"
                >
                  {selectedConv.is_customer ? "Bỏ khách" : "Là khách"}
                </button>
                <button
                  onClick={() => inbox.saveArchive(selectedConv.conv_id, false)}
                  className="rounded-lg border border-[#E5E5E5] bg-white px-2 py-1 text-xs font-bold hover:border-[#E3000F] text-slate-700"
                >
                  Lưu
                </button>
                <button
                  onClick={() => inbox.saveArchive(selectedConv.conv_id, true)}
                  className="rounded-lg border border-red-200 bg-white px-2 py-1 text-xs font-bold text-red-500 hover:bg-red-50"
                >
                  Ẩn
                </button>
              </div>
            )}
          </div>

          {/* Messages scroll box */}
          <div ref={chatScrollRef} className="flex-1 overflow-y-auto bg-[#FCFCFC] px-4 py-4 space-y-3">
            {!inbox.openConv ? (
              <div className="flex h-full items-center justify-center text-xs text-[#A0A0A0]">
                Chọn một hội thoại để xem tin nhắn.
              </div>
            ) : inbox.loadingChat && inbox.messages.length === 0 ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                Đang tải hội thoại Zalo...
              </div>
            ) : inbox.messages.length === 0 ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                Chưa có nội dung hội thoại.
              </div>
            ) : (
              <div className="space-y-3">
                {groupedMessages.map((group, gi) => (
                  <div key={gi} className="space-y-2">
                    <div className="flex items-center gap-2 my-2.5">
                      <div className="flex-1 h-px bg-slate-200" />
                      <span className="text-[9px] text-slate-400 px-1.5 font-medium">{group.date}</span>
                      <div className="flex-1 h-px bg-slate-200" />
                    </div>
                    {group.msgs.map((msg, index) => {
                      const isSent = msg.is_sent;
                      const time = formatTime(msg.timestamp_text ?? msg.time_text);
                      const isSelected = selectedMessageIds.includes(msg.source_message_id || msg.id || "");
                      
                      const checkboxEl = (
                        <input
                          type="checkbox"
                          className="w-3.5 h-3.5 cursor-pointer opacity-0 group-hover:opacity-100 checked:opacity-100 transition-opacity shrink-0"
                          checked={isSelected}
                          onChange={() => {
                            const msgId = msg.source_message_id || msg.id || "";
                            if (!msgId) return;
                            setSelectedMessageIds(prev =>
                              prev.includes(msgId) ? prev.filter(x => x !== msgId) : [...prev, msgId]
                            );
                          }}
                        />
                      );

                      return (
                        <div key={index} className={cn("flex items-center gap-2 group", isSent ? "justify-end" : "justify-start")}>
                          {/* Checkbox on left for received messages */}
                          {!isSent && checkboxEl}

                          <div className={cn("max-w-[75%]", isSent ? "text-right" : "text-left")}>
                            {!isSent && msg.sender_name && (
                              <div className="flex items-center gap-1 mb-0.5 px-1">
                                <span className="text-[10px] text-[#A0A0A0]">{msg.sender_name}</span>
                                {/* Chỉ hiện icon "Nhắn riêng" khi sender KHÁC với hội
                                    thoại đang mở (tức đây là tin trong NHÓM) — nếu
                                    sender_id === conv_id thì đang mở đúng ngay hội
                                    thoại riêng với người này rồi, không cần nút nữa. */}
                                {msg.sender_id && msg.sender_id !== inbox.openConv && (
                                  <button
                                    type="button"
                                    onClick={() => void handleMessageSenderPrivately(msg.sender_id!, msg.sender_name || "")}
                                    disabled={startingDmSenderId === msg.sender_id}
                                    title={`Nhắn riêng cho ${msg.sender_name || "người này"}`}
                                    className="opacity-0 group-hover:opacity-100 transition-opacity text-[#A0A0A0] hover:text-[#E3000F] disabled:opacity-60 disabled:cursor-wait shrink-0"
                                  >
                                    <MaterialIcon
                                      name={startingDmSenderId === msg.sender_id ? "sync" : "send"}
                                      className={cn("text-[11px]", startingDmSenderId === msg.sender_id && "animate-spin")}
                                    />
                                  </button>
                                )}
                              </div>
                            )}
                            {msg.content && (
                              <div
                                className={cn(
                                  "whitespace-pre-wrap rounded-xl px-3 py-2 text-xs leading-relaxed break-words transition-all duration-200",
                                  isSent
                                    ? "bg-[#E3000F] text-white rounded-br-sm"
                                    : "bg-white text-slate-800 shadow-sm ring-1 ring-slate-150 rounded-bl-sm",
                                  isSelected && (
                                    isSent
                                      ? "ring-2 ring-[#E3000F] ring-offset-2"
                                      : "ring-2 ring-[#E3000F]/60 bg-red-50/30"
                                  )
                                )}
                              >
                                {msg.content}
                              </div>
                            )}
                            {(msg.assets ?? [])
                              .filter((asset) => asset.storage_url)
                              .map((asset, ai) => (
                                <div
                                  key={ai}
                                  className={cn(
                                    "rounded-xl overflow-hidden border border-slate-200 max-w-[200px] mt-1 shadow-sm",
                                    isSent ? "ml-auto" : "mr-auto"
                                  )}
                                >
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
                                      className="flex items-center gap-1.5 p-2 text-[11px] text-blue-600 hover:underline bg-white"
                                    >
                                      <MaterialIcon name="attach_file" className="text-[14px]" />
                                      File đính kèm
                                    </a>
                                  )}
                                </div>
                              ))}
                            {time && <div className="mt-0.5 px-1 text-[9px] text-[#A0A0A0]">{time}</div>}
                          </div>

                          {/* Checkbox on right for sent messages */}
                          {isSent && checkboxEl}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Quick template shortcuts & send button */}
          <div className="border-t border-[#E5E5E5] bg-white p-3 flex-shrink-0">
            <div className="mb-2 flex flex-wrap gap-1.5 justify-between items-center">
              <div className="flex flex-wrap gap-1.5">
                {activeTemplateGroup.items.slice(0, 3).map((item) => (
                  <button
                    key={item}
                    onClick={() => appendTemplate(item)}
                    disabled={!inbox.openConv || inbox.archiveReading}
                    className="rounded-full bg-[#F4F6FF] px-2.5 py-1 text-[11px] font-bold text-[#4F46E5] transition hover:bg-[#E9ECFF] disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {item.length > 34 ? `${item.slice(0, 34)}...` : item}
                  </button>
                ))}
              </div>
              {/* Quick Emojis */}
              <div className="flex gap-1">
                {["👍", "❤️", "😂", "😮", "🙏", "🌹", "✔️"].map((emoji) => (
                  <button
                    key={emoji}
                    onClick={() => appendEmoji(emoji)}
                    disabled={!inbox.openConv || inbox.archiveReading}
                    className="hover:scale-125 transition text-sm px-1 disabled:opacity-30"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>

            {/* Selected files preview */}
            {selectedFiles.length > 0 && (
              <div className="mb-2 flex gap-2 flex-wrap bg-slate-50 p-2 border border-slate-100 rounded-xl">
                {selectedFiles.map((f, i) => (
                  <div key={i} className="flex items-center gap-1 bg-slate-200/60 rounded-lg px-2 py-0.5 text-[10px]">
                    <MaterialIcon name="attach_file" className="text-[12px] text-slate-500" />
                    <span className="text-slate-700 max-w-[120px] truncate">{f.name}</span>
                    <button
                      onClick={() => setSelectedFiles((prev) => prev.filter((_, j) => j !== i))}
                      className="text-slate-400 hover:text-[#E3000F] transition"
                    >
                      <MaterialIcon name="close" className="text-[11px]" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2 items-end">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="h-8 w-8 rounded-lg flex items-center justify-center hover:bg-slate-100 transition flex-shrink-0"
                title="Đính kèm file"
                disabled={!inbox.openConv || inbox.archiveReading}
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
              <button
                type="button"
                onClick={() => setShowSalesAssetPicker(true)}
                className="h-8 w-8 rounded-lg flex items-center justify-center hover:bg-slate-100 transition flex-shrink-0"
                title="Gửi tài liệu"
                disabled={!inbox.openConv || inbox.archiveReading}
              >
                <MaterialIcon name="description" className="text-slate-500 text-[18px]" />
              </button>
              <textarea
                value={inbox.reply}
                onChange={(e) => inbox.setReply(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void handleSendReply();
                  }
                }}
                disabled={!inbox.openConv || inbox.archiveReading}
                rows={2}
                placeholder={
                  inbox.archiveReading
                    ? "Đang xem lưu trữ..."
                    : !inbox.selectedAccountId
                    ? "Chưa chọn tài khoản..."
                    : "Nhập câu trả lời... (Enter để gửi)"
                }
                className="min-h-[44px] flex-1 resize-none rounded-lg border border-[#E5E5E5] px-3 py-2 text-xs outline-none transition focus:border-[#E3000F] focus:ring-2 focus:ring-[#E3000F]/20 disabled:cursor-not-allowed disabled:bg-[#F5F5F5]"
              />
              <button
                onClick={() => void handleSendReply()}
                disabled={
                  !inbox.openConv ||
                  inbox.archiveReading ||
                  (!inbox.reply.trim() && selectedFiles.length === 0) ||
                  inbox.isSending
                }
                className="shrink-0 h-11 rounded-lg bg-[#E3000F] px-4 text-xs font-black text-white transition hover:bg-[#C40009] disabled:cursor-not-allowed disabled:opacity-50 flex items-center justify-center gap-1"
              >
                {inbox.isSending ? (
                  <MaterialIcon name="pending" className="text-[14px] animate-spin" />
                ) : (
                  <span>Gửi</span>
                )}
              </button>
            </div>
          </div>
        </section>

        {/* Pane 3: Tabs sidebar (Templates / Customer / KPI / Account Management) */}
        <aside className="min-w-0 overflow-hidden rounded-xl border border-[#E5E5E5] bg-white shadow-sm flex flex-col h-[700px]">
          <div className="grid border-b border-[#E5E5E5] bg-[#FAFAFA] text-[11px] font-black shrink-0 grid-cols-3">
            <button
              onClick={() => {
                setPanelTab("templates");
                panelScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
              }}
              className={cn(
                "py-3 truncate px-0.5 text-center transition flex items-center justify-center gap-0.5",
                (panelTab === "templates" || panelTab === "campaign") ? "bg-white text-[#E3000F]" : "text-[#666666] hover:bg-slate-50"
              )}
            >
              <MaterialIcon name="chat" className="text-[12px] shrink-0" />
              <span>Tương tác</span>
            </button>
            <button
              onClick={() => {
                setPanelTab("customer");
                panelScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
              }}
              className={cn(
                "py-3 truncate px-0.5 text-center transition flex items-center justify-center gap-0.5",
                (panelTab === "customer" || panelTab === "kpi") ? "bg-white text-[#E3000F]" : "text-[#666666] hover:bg-slate-50"
              )}
            >
              <MaterialIcon name="info" className="text-[12px] shrink-0" />
              <span>Thông tin</span>
            </button>
            <button
              onClick={() => {
                setPanelTab("account");
                panelScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
              }}
              className={cn(
                "py-3 truncate px-0.5 text-center transition flex items-center justify-center gap-0.5",
                panelTab === "account" ? "bg-white text-[#E3000F]" : "text-[#666666] hover:bg-slate-50"
              )}
            >
              <MaterialIcon name="settings" className="text-[12px] shrink-0" />
              <span>Cài đặt</span>
            </button>
          </div>

          <div ref={panelScrollRef} className={cn("overflow-y-auto p-3", panelH)}>
            {/* ── Interact Tab (Templates / Campaign) ── */}
            {(panelTab === "templates" || panelTab === "campaign") && (
              <div className="space-y-3">
                <div className="inline-flex rounded-lg border border-[#E5E5E5] bg-[#F8F8F8] p-0.5 w-full mb-1">
                  <button
                    onClick={() => setPanelTab("templates")}
                    className={cn(
                      "flex-1 rounded-md py-1 text-center text-[10px] font-bold transition",
                      panelTab === "templates" ? "bg-white text-[#E3000F] shadow-sm" : "text-[#666666] hover:text-[#1A1A1A]"
                    )}
                  >
                    Mẫu nhanh
                  </button>
                  <button
                    onClick={() => setPanelTab("campaign")}
                    className={cn(
                      "flex-1 rounded-md py-1 text-center text-[10px] font-bold transition flex items-center justify-center gap-0.5",
                      panelTab === "campaign" ? "bg-white text-[#E3000F] shadow-sm" : "text-[#666666] hover:text-[#1A1A1A]"
                    )}
                  >
                    <MaterialIcon name="campaign" className="text-[12px]" />
                    <span>Gửi Auto</span>
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
                              : "bg-[#F5F5F5] text-[#666666] hover:text-[#1A1A1A]"
                          )}
                        >
                          {group.label}
                        </button>
                      ))}
                    </div>
                    <div className="space-y-2">
                      {activeTemplateGroup.items.map((item) => (
                        <button
                          key={item}
                          onClick={() => appendTemplate(item)}
                          disabled={!inbox.openConv || inbox.archiveReading}
                          className="block w-full rounded-lg border border-[#E5E5E5] bg-white p-2.5 text-left text-xs leading-relaxed transition hover:border-[#E3000F]/60 hover:bg-[#FFF8F8] disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {item}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {panelTab === "campaign" && (
                  <div className="space-y-3 text-xs text-slate-700">
                    <div className="border border-slate-200 rounded-xl p-3 bg-slate-50 space-y-2">
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex justify-between">
                        <span>Tin nhắn đã chọn ({selectedMessageIds.length})</span>
                        <span className="text-[9px] text-[#E3000F] font-black">Có thể chỉnh sửa</span>
                      </div>
                      {selectedMessageIds.length === 0 ? (
                        <p className="text-slate-500 text-[11px]">Tích chọn tin nhắn ở cột chat giữa để bắt đầu chiến dịch.</p>
                      ) : (
                        <div className="max-h-[160px] overflow-y-auto space-y-2 pr-1 border border-slate-200/60 rounded bg-white p-2">
                          {inbox.messages
                            .filter(m => selectedMessageIds.includes(m.source_message_id || m.id || ""))
                            .map((m, idx) => {
                              const msgId = m.source_message_id || m.id || "";
                              const currentText = editedMessagesText[msgId] ?? m.content ?? "";
                              return (
                                <div key={idx} className="bg-slate-50 border border-slate-200/55 p-1.5 rounded space-y-1">
                                  <div className="flex justify-between items-center text-[9px] text-slate-400 font-bold">
                                    <span>Tin #{idx + 1}</span>
                                  </div>
                                  <textarea
                                    value={currentText}
                                    onChange={(e) => {
                                      setEditedMessagesText(prev => ({
                                        ...prev,
                                        [msgId]: e.target.value
                                      }));
                                    }}
                                    className="w-full bg-white border border-slate-250 rounded p-1 text-[11px] outline-none text-slate-700 resize-none font-sans"
                                    rows={2.5}
                                  />
                                  {(m.assets ?? [])
                                    .filter((asset) => asset.storage_url)
                                    .map((asset, ai) => (
                                      <div
                                        key={ai}
                                        className="rounded-lg overflow-hidden border border-slate-200 max-w-[120px] mt-1 bg-white"
                                      >
                                        {asset.storage_url?.match(/\.(jpg|jpeg|png|gif|webp)/i) ? (
                                          // eslint-disable-next-line @next/next/no-img-element
                                          <img
                                            src={asset.storage_url!}
                                            alt="media preview"
                                            className="w-full h-auto object-cover max-h-[80px]"
                                          />
                                        ) : (
                                          <div className="flex items-center gap-1 p-1.5 text-[9px] text-blue-600">
                                            <MaterialIcon name="attach_file" className="text-[12px]" />
                                            <span className="truncate">File đính kèm</span>
                                          </div>
                                        )}
                                      </div>
                                    ))}
                                </div>
                              );
                            })}
                        </div>
                      )}
                    </div>

                    <div>
                      <label className="text-[10px] text-slate-500 font-bold block mb-1">Phương thức nội dung</label>
                      <select
                        value={campaignMode}
                        onChange={(e) => setCampaignMode(e.target.value as CampaignMode)}
                        className="w-full border border-slate-200 rounded px-2 py-1 outline-none focus:border-[#E3000F] text-xs bg-white"
                      >
                        <option value="both">Gửi cả chữ & ảnh</option>
                        <option value="text">Chỉ gửi chữ</option>
                        <option value="image">Chỉ gửi ảnh</option>
                      </select>
                    </div>

                    <div>
                      <label className="text-[10px] text-slate-500 font-bold block mb-1">
                        Người nhận từ danh sách hội thoại ({autoSendTargetIds.length})
                      </label>
                      <div className="relative mb-2">
                        <MaterialIcon name="search" className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-xs" />
                        <input
                          type="text"
                          placeholder="Lọc danh sách..."
                          value={autoSendSearchQuery}
                          onChange={(e) => setAutoSendSearchQuery(e.target.value)}
                          className="w-full pl-6 pr-2 py-1 text-xs border border-slate-200 rounded outline-none"
                        />
                      </div>
                      <div className="h-[120px] overflow-y-auto border border-slate-200 rounded p-1.5 space-y-1 bg-white">
                        {inbox.filtered
                          .filter(c => c.conv_id !== inbox.openConv)
                          .filter(c => (c.name || "").toLowerCase().includes(autoSendSearchQuery.toLowerCase()))
                          .map((c) => (
                            <label key={c.conv_id} className="flex items-center gap-1.5 p-1 rounded hover:bg-slate-50 cursor-pointer">
                              <input
                                type="checkbox"
                                className="w-3 h-3"
                                checked={autoSendTargetIds.includes(c.conv_id)}
                                onChange={() => {
                                  const id = c.conv_id;
                                  setAutoSendTargetIds(prev =>
                                    prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
                                  );
                                }}
                              />
                              <span className="truncate text-[11px] font-semibold text-slate-700">{c.name}</span>
                            </label>
                          ))}
                      </div>
                    </div>

                    {campaignError && (
                      <div className="bg-red-50 border border-red-200 text-red-700 text-[11px] p-2 rounded-lg">
                        {campaignError}
                      </div>
                    )}
                    {campaignSuccess && (
                      <div className="bg-green-50 border border-green-200 text-green-700 text-[11px] p-2 rounded-lg">
                        {campaignSuccess}
                      </div>
                    )}

                    {campaignLogs.length > 0 && (
                      <div className="border border-slate-200 rounded bg-slate-50 p-2 text-[10px] max-h-[80px] overflow-y-auto space-y-1">
                        {campaignLogs.map((log, i) => (
                          <div key={i} className="flex justify-between items-center text-slate-600">
                            <span className="truncate">{log.name}</span>
                            <span className="text-green-600 font-bold">✓ Đã gửi</span>
                          </div>
                        ))}
                      </div>
                    )}

                    <button
                      onClick={handleAutoSend}
                      disabled={isSendingCampaign || selectedMessageIds.length === 0 || (autoSendTargetIds.length === 0 && !manualRecipients.trim())}
                      className="w-full flex items-center justify-center gap-1.5 rounded-xl bg-[#E3000F] hover:bg-[#C40009] text-white font-bold py-2 text-xs transition shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <MaterialIcon name="campaign" className="text-base" />
                      {isSendingCampaign ? "Đang gửi..." : "Bắt đầu chiến dịch"}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* ── Info Tab (Customer notes + KPI share/verify) ── */}
            {(panelTab === "customer" || panelTab === "kpi") && (
              <div className="space-y-4">
                {/* 1. Customer Note Section */}
                <div>
                  {!inbox.openConv ? (
                    <div className="rounded-lg border border-dashed border-[#E5E5E5] bg-[#FAFAFA] p-3 text-xs text-[#A0A0A0]">
                      Chọn hội thoại để xem thông tin khách hàng.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="rounded-lg border border-[#E5E5E5] p-2.5 bg-white">
                        <div className="text-[10px] font-bold uppercase text-[#A0A0A0]">Khách hàng</div>
                        <div className="mt-1 text-xs font-black truncate">{selectedName || inbox.openConv}</div>
                        <div className="mt-1 text-[11px] text-[#A0A0A0] truncate">{selectedPreview || "—"}</div>
                      </div>
                      <div className="rounded-lg border border-[#E5E5E5] bg-[#FFFDF7] p-2.5">
                        <div className="mb-1.5 flex items-center justify-between gap-2">
                          <div className="text-[10px] font-bold uppercase text-[#A0A0A0]">Ghi chú nhu cầu</div>
                          {selectedNote && !noteChanged && (
                            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-bold text-emerald-700">
                              đã lưu
                            </span>
                          )}
                        </div>
                        <textarea
                          value={noteDraft}
                          onChange={(e) => setNoteDraft(e.target.value)}
                          rows={3}
                          maxLength={1000}
                          placeholder="VD: Khách cần tư vấn..."
                          className="w-full resize-none rounded-lg border border-[#E5E5E5] bg-white px-2 py-1.5 text-xs leading-relaxed outline-none transition focus:border-[#E3000F] disabled:bg-[#F5F5F5]"
                        />
                        <div className="mt-1.5 flex items-center justify-between gap-2">
                          <span className="text-[10px] text-[#A0A0A0]">{noteDraft.trim().length}/1000</span>
                          <button
                            onClick={() => void inbox.saveCustomerNote(inbox.openConv, noteDraft)}
                            disabled={!inbox.openConv || inbox.savingNoteConv === inbox.openConv || !noteChanged}
                            className="rounded bg-[#E3000F] px-2.5 py-1 text-xs font-black text-white hover:bg-[#C40009] disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            Lưu ghi chú
                          </button>
                          <button
                            onClick={() => setShowCrmModal(true)}
                            disabled={!inbox.openConv}
                            className="rounded border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-black text-emerald-700 hover:bg-emerald-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            title="Lưu khách hàng vào CRM"
                          >
                            Lưu vào CRM
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* 2. KPI / Share Section */}
                <div className="pt-2 border-t border-slate-100">
                  {inbox.role === "admin" || inbox.role === "leader" ? (
                    <div
                      className={cn(
                        "rounded-xl border p-3.5 shadow-sm transition-colors",
                        inbox.verifiedConvIds.has(inbox.openConv) ? "border-emerald-250 bg-emerald-50" : "border-[#E5E5E5] bg-white"
                      )}
                    >
                      <div className="mb-1.5 flex items-center justify-between">
                        <div
                          className={cn(
                            "text-xs font-black uppercase tracking-wider",
                            inbox.verifiedConvIds.has(inbox.openConv) ? "text-emerald-700" : "text-[#1A1A1A]"
                          )}
                        >
                          {inbox.verifiedConvIds.has(inbox.openConv) ? "Đã duyệt KPI" : "Duyệt KPI"}
                        </div>
                        {inbox.verifiedConvIds.has(inbox.openConv) && (
                          <MaterialIcon name="check_circle" className="text-emerald-500 text-base" />
                        )}
                      </div>
                      {!inbox.verifiedConvIds.has(inbox.openConv) && (
                        <p className="text-[10px] text-slate-500 mb-2.5">
                          Bấm nút bên dưới để xác nhận tính KPI cho nhân viên.
                        </p>
                      )}
                      {inbox.openConv && (
                        <button
                          onClick={handleVerifyKpi}
                          className={cn(
                            "w-full rounded-lg py-1.5 text-xs font-bold text-white transition",
                            inbox.verifiedConvIds.has(inbox.openConv)
                              ? "bg-slate-200 text-slate-400 cursor-not-allowed"
                              : "bg-[#E3000F] hover:bg-[#C40009] shadow-sm"
                          )}
                          disabled={inbox.verifiedConvIds.has(inbox.openConv)}
                        >
                          {inbox.verifiedConvIds.has(inbox.openConv) ? "Đã duyệt" : "XÁC NHẬN KPI"}
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-[#E5E5E5] p-3 bg-white space-y-2">
                      <div className="text-[10px] font-bold uppercase text-[#A0A0A0]">KPI &amp; Chia sẻ</div>
                      {inbox.openConv ? (
                        <div>
                          {inbox.verifiedConvIds.has(inbox.openConv) ? (
                            <div className="p-2.5 rounded-lg bg-green-50 border border-green-200 text-[11px] text-green-700 font-semibold flex items-center gap-1.5">
                              <MaterialIcon name="check_circle" className="text-green-500 text-[16px]" />
                              Đã duyệt tính KPI (Đã khóa)
                            </div>
                          ) : inbox.suggestedConvIds.has(inbox.openConv) ? (
                            <div className="space-y-2">
                              <div className="p-2.5 rounded-lg bg-blue-50 border border-blue-200 text-[11px] text-blue-700 font-semibold flex items-center gap-1.5">
                                <MaterialIcon name="pending" className="text-blue-500 text-[16px]" />
                                Đang chia sẻ, chờ duyệt KPI
                              </div>
                              <button
                                onClick={() => void inbox.onToggleShare(inbox.openConv)}
                                className="w-full rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-1.5 text-xs transition border border-slate-200"
                              >
                                HỦY CHIA SẺ (THU HỒI)
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => void inbox.onToggleShare(inbox.openConv)}
                              className="w-full rounded bg-blue-600 hover:bg-blue-700 text-white font-bold py-1.5 text-xs transition shadow-sm"
                            >
                              CHIA SẺ HỘI THOẠI
                            </button>
                          )}
                        </div>
                      ) : (
                        <div className="text-xs text-slate-400 italic">Chọn hội thoại để chia sẻ</div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── Zalo Account Technical Management Tab ── */}
            {panelTab === "account" && (
              <div className="space-y-3">
                {isCreatingAccount ? (
                  <div className="border border-slate-200 rounded-xl p-3.5 bg-white space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                        Thêm tài khoản Zalo mới
                      </div>
                      {inbox.selectedAccountId && (
                        <button
                          onClick={() => setIsCreatingAccount(false)}
                          className="text-[10px] font-bold text-[#E3000F] hover:underline"
                        >
                          Quay lại
                        </button>
                      )}
                    </div>

                    <div className="space-y-2.5 text-xs text-slate-700">
                      <div>
                        <label className="text-[10px] text-slate-500 font-bold block mb-1">
                          Nhân sự quản lý tài khoản
                        </label>
                        <select
                          value={newOwnerId}
                          onChange={(e) => setNewOwnerId(e.target.value)}
                          className="w-full border border-slate-200 rounded px-2.5 py-1.5 outline-none focus:border-[#E3000F] text-xs bg-white"
                        >
                          <option value="">-- Chọn nhân viên --</option>
                          {allMembers.map((member) => (
                            <option key={member.id || member.email} value={member.id || member.email || ""}>
                              {member.name} ({member.email})
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="text-[10px] text-slate-500 font-bold block mb-1">
                          Tên nhãn hiển thị
                        </label>
                        <input
                          type="text"
                          value={newLabel}
                          onChange={(e) => setNewLabel(e.target.value)}
                          placeholder="MKT Zalo 01, CSKH 02..."
                          className="w-full border border-slate-200 rounded px-2.5 py-1.5 outline-none focus:border-[#E3000F] text-xs"
                        />
                      </div>

                      <div>
                        <label className="text-[10px] text-slate-500 font-bold block mb-1">
                          Số điện thoại (Tuỳ chọn)
                        </label>
                        <input
                          type="text"
                          value={newPhone}
                          onChange={(e) => setNewPhone(e.target.value)}
                          placeholder="Số điện thoại đăng nhập Zalo..."
                          className="w-full border border-slate-200 rounded px-2.5 py-1.5 outline-none focus:border-[#E3000F] text-xs"
                        />
                      </div>

                      <button
                        onClick={handleCreateAccount}
                        disabled={isSavingAccount || !newLabel.trim() || !newOwnerId}
                        className="w-full flex items-center justify-center gap-1.5 rounded-xl bg-[#E3000F] hover:bg-[#C40009] text-white font-bold py-2.5 text-xs transition shadow-sm disabled:opacity-40 disabled:cursor-not-allowed mt-2"
                      >
                        <MaterialIcon name="person_add" className="text-[16px]" />
                        {isSavingAccount ? "Đang tạo..." : "Thêm account"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3.5 text-xs text-slate-700">
                    <div className="flex justify-end">
                      <button
                        onClick={() => {
                          setNewLabel("");
                          setNewPhone("");
                          setNewOwnerId(inbox.selectedOwnerId || "");
                          setIsCreatingAccount(true);
                        }}
                        className="text-[10px] font-bold text-[#E3000F] hover:underline flex items-center gap-0.5"
                      >
                        <MaterialIcon name="add" className="text-[12px]" />
                        Thêm tài khoản mới
                      </button>
                    </div>

                    {/* Status Info Card */}
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
                      <div>
                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Mã Zalo ID</div>
                        <div className="font-mono text-slate-800 font-bold truncate">
                          {inbox.selectedAccountId}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Trạng thái Auth</div>
                          <div className="font-semibold flex items-center gap-1 mt-0.5">
                            <span
                              className={cn(
                                "h-2 w-2 rounded-full",
                                inbox.selectedAccountInfo?.has_auth ? "bg-green-500" : "bg-slate-400"
                              )}
                            />
                            {inbox.selectedAccountInfo?.has_auth ? "Đã login" : "Chưa login"}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Listener</div>
                          <div className="font-semibold flex items-center gap-1 mt-0.5">
                            <span
                              className={cn(
                                "h-2 w-2 rounded-full",
                                accountStatus === "online"
                                  ? "bg-green-500"
                                  : accountStatus === "connecting"
                                  ? "bg-amber-400 animate-pulse"
                                  : "bg-slate-400"
                              )}
                            />
                            {accountStatus === "online"
                              ? "Online"
                              : accountStatus === "connecting"
                              ? "Kết nối..."
                              : "Tắt (Offline)"}
                          </div>
                        </div>
                      </div>
                      <div className="border-t border-slate-200 pt-2 flex justify-between text-[11px]">
                        <span>Tin nhắn đã quét:</span>
                        <span className="font-bold text-slate-800">
                          {inbox.selectedAccountInfo?.listener?.messages_seen ?? 0}
                        </span>
                      </div>
                      {inbox.selectedAccountInfo?.listener?.pid && (
                        <div className="flex justify-between text-[10px] text-slate-400">
                          <span>Listener PID:</span>
                          <span className="font-mono">{inbox.selectedAccountInfo.listener.pid}</span>
                        </div>
                      )}
                      {/* Chưa có nút nào gọi extension đăng nhập khi account chưa từng
                          có session (has_auth=false) — trước đây chỉ có banner phía
                          trên, và banner đó cũng bị ẩn nếu người xem không phải đúng
                          owner. Thêm luôn 1 lối vào rõ ràng ngay trong card trạng thái. */}
                      {!inbox.selectedAccountInfo?.has_auth && canManageAccountAuth && (
                        <button
                          onClick={() => setShowAuthModal(true)}
                          className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-bold py-2 text-[11px] transition shadow-sm mt-1"
                        >
                          <MaterialIcon name="login" className="text-[14px]" />
                          Đăng nhập Zalo (Extension/QR)
                        </button>
                      )}
                    </div>

                    {/* Edit Info Form */}
                    <div className="border border-slate-250 rounded-xl p-3 bg-white space-y-2">
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                        Thông tin tài khoản
                      </div>
                      <div className="space-y-2">
                        <div>
                          <label className="text-[10px] text-slate-500">Tên nhãn hiển thị</label>
                          <input
                            type="text"
                            value={editLabel}
                            onChange={(e) => setEditLabel(e.target.value)}
                            placeholder="MKT 01, CSKH 02..."
                            className="w-full mt-1 border border-slate-200 rounded px-2 py-1 outline-none focus:border-[#E3000F] text-xs"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-slate-500">Số điện thoại</label>
                          <input
                            type="text"
                            value={editPhone}
                            onChange={(e) => setEditPhone(e.target.value)}
                            placeholder="09xxx..."
                            className="w-full mt-1 border border-slate-200 rounded px-2 py-1 outline-none focus:border-[#E3000F] text-xs"
                          />
                        </div>
                        <button
                          onClick={handleUpdateAccount}
                          disabled={isSavingAccount || !editLabel.trim()}
                          className="w-full rounded bg-slate-800 hover:bg-slate-900 text-white font-bold py-1.5 text-xs transition disabled:opacity-40"
                        >
                          {isSavingAccount ? "Đang lưu..." : "Lưu thay đổi"}
                        </button>
                      </div>
                    </div>

                    {/* Technical Actions Card */}
                    <div className="border border-slate-200 rounded-xl p-3 bg-white space-y-2.5">
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Thao tác kỹ thuật</div>
                      <div className="space-y-2">
                        <button
                          onClick={handleRestartListener}
                          className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 hover:border-[#E3000F] hover:text-[#E3000F] py-2 font-bold transition bg-white"
                        >
                          <MaterialIcon name="refresh" className="text-[16px]" />
                          Khởi động lại Listener
                        </button>

                        <button
                          onClick={handleDeleteAccount}
                          className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-red-100 hover:bg-red-50 text-red-600 py-2 font-bold transition bg-white"
                        >
                          <MaterialIcon name="visibility_off" className="text-[16px]" />
                          Ẩn tài khoản khỏi Inbox
                        </button>

                        <button
                          onClick={handleDeleteFull}
                          className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white py-2 font-bold transition shadow-sm"
                        >
                          <MaterialIcon name="delete" className="text-[16px]" />
                          Xoá hoàn toàn dữ liệu Zalo
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </aside>
      </div>

      {mounted && showAuthModal && inbox.selectedAccountId && createPortal(
        <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/50 p-4 font-sans text-slate-800 backdrop-blur-sm">
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
    </div>
  );
}
