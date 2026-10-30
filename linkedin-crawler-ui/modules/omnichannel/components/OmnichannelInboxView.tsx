"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Mail, MessageSquare, RotateCw, PenSquare } from "lucide-react";
import { ChannelType, ConversationItem, ChannelAccount, MessageItem, OutgoingEmailAttachment } from "../types";
import { omnichannelRepository } from "../repositories/OmnichannelRepository";
import { seedingCrmRepository } from "@/modules/crm/repositories/SeedingCrmRepository";
import { DealFormModal } from "@/modules/crm/components/DealFormModal";
import { TelegramConnectFlow } from "@/components/all-platform/telegram/TelegramConnectFlow";
import { ZaloConnectModal } from "./ZaloConnectModal";
import { EmailConnectModal } from "./EmailConnectModal";
import { EmailComposeModal } from "./EmailComposeModal";
import { ChannelScopePane } from "./ChannelScopePane";
import { ConversationList } from "./ConversationList";
import { ConversationHeader } from "./ConversationHeader";
import { MessageThread } from "./MessageThread";
import { AiReplySuggestion } from "./AiReplySuggestion";
import { MessageComposer } from "./MessageComposer";
import { Crm360Panel } from "./Crm360Panel";
import {
  PREVIEW_CHANNEL_ACCOUNTS,
  PREVIEW_CONVERSATIONS,
} from "../preview/omnichannelPreviewFixtures";
import { QuoteWorkspaceModal } from "@/modules/crm/components/QuoteWorkspaceModal";
import { useAppAuth } from "@/contexts/AppAuthContext";
import { CHANNEL_CAPABILITIES } from "../constants/channelCapabilities";
import { CustomerAddDrawer } from "@/modules/crm/components/CustomerAddDrawer";
import { AssignUserModal } from "./AssignUserModal";
import {
  Customer360Drawer,
  DealListDrawer,
  QuoteListDrawer,
  QuotePreviewDrawer,
} from "./OmnichannelDrawers";
import {
  FindCustomerMockModal,
  AddNoteMockModal,
  ConnectAccountMockModal,
  QuickRepliesMockModal,
} from "./OmnichannelMockModals";

export function OmnichannelInboxView() {
  const { user } = useAppAuth();
  const router = useRouter();
  // Real Data state
  const [realAccounts, setRealAccounts] = useState<ChannelAccount[]>([]);
  const [realConversations, setRealConversations] = useState<ConversationItem[]>([]);

  // Dev-Only Preview Mode state
  const [isPreviewMode, setIsPreviewMode] = useState(false);
  const [previewAccounts, setPreviewAccounts] = useState<ChannelAccount[]>([]);
  const [previewConversations, setPreviewConversations] = useState<ConversationItem[]>([]);

  // Selection & Navigation State
  const [selectedChannel, setSelectedChannel] = useState<ChannelType>("all");
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageItem[]>([]);

  // Loading States
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [loadingConvs, setLoadingConvs] = useState(false);
  const [loadingMsgs, setLoadingMsgs] = useState(false);

  // Filters & Layout
  const [searchQuery, setSearchQuery] = useState("");
  const [filterTab, setFilterTab] = useState<"all" | "unread" | "crm">("all");
  const [scopeFilter, setScopeFilter] = useState<"my" | "team" | "all">("my");
  const [isPane1Collapsed, setIsPane1Collapsed] = useState(false);
  const [isPane4Collapsed, setIsPane4Collapsed] = useState(false);
  const [composerText, setComposerText] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailRecipient, setEmailRecipient] = useState("");
  const [emailCcList, setEmailCcList] = useState<string[]>([]);
  const [emailReplyMode, setEmailReplyMode] = useState<"reply" | "reply_all" | "forward" | null>("reply");
  const [replyTargetMessage, setReplyTargetMessage] = useState<MessageItem | null>(null);
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [isEmailComposeOpen, setIsEmailComposeOpen] = useState(false);
  const [emailAttachments, setEmailAttachments] = useState<OutgoingEmailAttachment[]>([]);


  // Modals state
  const [isCreateDealOpen, setIsCreateDealOpen] = useState(false);
  const [dealLoading, setDealLoading] = useState(false);
  const [isCreateQuoteOpen, setIsCreateQuoteOpen] = useState(false);
  const [isFindCustomerOpen, setIsFindCustomerOpen] = useState(false);
  const [isAddNoteOpen, setIsAddNoteOpen] = useState(false);
  const [isConnectAccountOpen, setIsConnectAccountOpen] = useState(false);
  const [isQuickRepliesOpen, setIsQuickRepliesOpen] = useState(false);
  const [isQuotePreviewOpen, setIsQuotePreviewOpen] = useState(false);
  const [isAssignUserOpen, setIsAssignUserOpen] = useState(false);
  const [isCreateCustomerOpen, setIsCreateCustomerOpen] = useState(false);
  const [isTelegramConnectOpen, setIsTelegramConnectOpen] = useState(false);
  const [isZaloConnectOpen, setIsZaloConnectOpen] = useState(false);
  const [isEmailConnectOpen, setIsEmailConnectOpen] = useState(false);
  // Toast state
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage((curr) => (curr === msg ? null : curr)), 3500);
  };

  // Slide-over Drawers State (Primary: in-place view)
  const [isCustomerDrawerOpen, setIsCustomerDrawerOpen] = useState(false);
  const [isDealListDrawerOpen, setIsDealListDrawerOpen] = useState(false);
  const [isQuoteListDrawerOpen, setIsQuoteListDrawerOpen] = useState(false);
  const [selectedQuoteForPreview, setSelectedQuoteForPreview] = useState<any | null>(null);
  const [selectedDealForDetail, setSelectedDealForDetail] = useState<any | null>(null);

  // Active data arrays depending on mode
  const currentAccounts = isPreviewMode ? previewAccounts : realAccounts;
  const currentConversations = isPreviewMode ? previewConversations : realConversations;

  // Email sync state
  const [isSyncingEmail, setIsSyncingEmail] = useState(false);

  // Manual sync email action
  const handleManualSyncEmail = async () => {
    setIsSyncingEmail(true);
    const result = await omnichannelRepository.syncEmailMailbox();
    setIsSyncingEmail(false);
    if (result.ok) {
      showToast(`Đã đồng bộ xong! Nhập ${result.imported || 0} thư mới.`);
      const accs = await omnichannelRepository.fetchChannelAccounts();
      setRealAccounts(accs);
      const list = await omnichannelRepository.fetchConversations(
        selectedChannel,
        selectedAccount || undefined,
        accs
      );
      setRealConversations(list);
      if (list.length > 0 && !selectedConvId) {
        setSelectedConvId(list[0].id);
      }
    } else {
      showToast(`Lỗi đồng bộ email: ${result.error || "Không thể đồng bộ hộp thư."}`);
    }
  };

  // 1. Fetch Real Channel Accounts on mount
  const fetchRealAccounts = async () => {
    setLoadingAccounts(true);
    const accs = await omnichannelRepository.fetchChannelAccounts();
    setRealAccounts(accs);
    setLoadingAccounts(false);
    if (!isPreviewMode && accs.length > 0) {
      setSelectedAccount((curr) => {
        if (curr && accs.some((a) => a.id === curr)) return curr;
        const emailAcc = accs.find((a) => a.channel === "email");
        if (emailAcc) {
          setSelectedChannel("email");
          return emailAcc.id;
        }
        setSelectedChannel(accs[0].channel);
        return accs[0].id;
      });
    }
  };

  useEffect(() => {
    fetchRealAccounts();
  }, []);

  // 2. Fetch Real Conversations when channel/account selection changes (in Real Mode)
  useEffect(() => {
    if (isPreviewMode) return;

    let active = true;
    (async () => {
      setLoadingConvs(true);
      const list = await omnichannelRepository.fetchConversations(
        selectedChannel,
        selectedAccount || undefined,
        realAccounts
      );
      if (active) {
        setRealConversations(list);
        setLoadingConvs(false);
        if (list.length > 0) {
          setSelectedConvId(list[0].id);
        } else {
          setSelectedConvId(null);
          setMessages([]);
        }
      }

      // Non-blocking background sync for email: load DB immediately first, sync IMAP/Gmail API in background
      if (selectedChannel === "email") {
        const targetAcc = realAccounts.find((a) => a.id === selectedAccount);
        const targetEmail = targetAcc?.email || undefined;
        omnichannelRepository.syncEmailMailbox(targetEmail).then((syncRes) => {
          if (syncRes.ok && syncRes.imported && syncRes.imported > 0 && active) {
            omnichannelRepository.fetchConversations("email", selectedAccount || undefined, realAccounts).then((refreshed) => {
              if (active) {
                setRealConversations(refreshed);
                showToast(`📧 Nhận được ${syncRes.imported} thư mới!`);
              }
            });
          }
        }).catch(() => {});
      }
    })();
    return () => { active = false; };
  }, [selectedChannel, selectedAccount, isPreviewMode, realAccounts]);

  // 3. Fetch Real Messages when active conversation changes (in Real Mode)
  useEffect(() => {
    if (isPreviewMode || !selectedConvId || !selectedAccount) {
      return;
    }
    let active = true;
    (async () => {
      setLoadingMsgs(true);
      const msgs = await omnichannelRepository.fetchMessages(
        selectedChannel,
        selectedAccount,
        selectedConvId
      );
      if (active) {
        setMessages(msgs);
        setLoadingMsgs(false);
      }
    })();
    return () => { active = false; };
  }, [selectedChannel, selectedAccount, selectedConvId, isPreviewMode]);

  // Handle Enter Preview Mode (Dev-Only)
  const handleEnterPreviewMode = () => {
    setIsPreviewMode(true);
    setPreviewAccounts(PREVIEW_CHANNEL_ACCOUNTS);
    setPreviewConversations(PREVIEW_CONVERSATIONS);

    // Select first preview conversation by default
    const firstPreview = PREVIEW_CONVERSATIONS[0];
    if (firstPreview) {
      setSelectedChannel("all");
      setSelectedAccount(null);
      setSelectedConvId(firstPreview.id);
      setMessages(firstPreview.messages);
    }
  };

  // Handle Exit Preview Mode
  const handleExitPreviewMode = () => {
    setIsPreviewMode(false);
    setSelectedConvId(null);
    setMessages([]);
    fetchRealAccounts();
  };

  // Filter conversations
  const filteredConversations = useMemo(() => {
    return currentConversations.filter((c) => {
      if (selectedChannel !== "all" && c.channel !== selectedChannel) return false;
      if (selectedAccount && c.accountId !== selectedAccount) return false;
      if (filterTab === "unread" && c.unreadCount === 0) return false;
      if (filterTab === "crm" && !c.isCrmMatched) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = c.customerName.toLowerCase().includes(q);
        const matchText = c.lastMessageText.toLowerCase().includes(q);
        const matchPhone = c.crmData.phone?.includes(q);
        if (!matchName && !matchText && !matchPhone) return false;
      }
      return true;
    });
  }, [currentConversations, selectedChannel, selectedAccount, filterTab, searchQuery]);

  // Active Conversation with messages
  const activeConversation = useMemo(() => {
    const found = currentConversations.find((c) => c.id === selectedConvId) || filteredConversations[0];
    if (!found) return null;
    return {
      ...found,
      messages: !isPreviewMode && messages.length > 0 ? messages : found.messages,
    };
  }, [currentConversations, selectedConvId, filteredConversations, messages, isPreviewMode]);

  // Prefill customer initial values extracted from active conversation context
  const initialCustomerValues = useMemo(() => {
    if (!activeConversation) return undefined;

    const sourceMap: Record<string, string> = {
      email: "Email",
      zalo: "Zalo",
      facebook: "Facebook",
      telegram: "Telegram",
      linkedin: "LinkedIn",
    };
    const mappedSource = sourceMap[activeConversation.channel] || "Omnichannel";
    const isCompany = Boolean(activeConversation.crmData?.companyName);

    return {
      companyName: isCompany ? activeConversation.crmData.companyName : undefined,
      contactName: activeConversation.customerName || undefined,
      phone: activeConversation.crmData?.phone || undefined,
      email: activeConversation.crmData?.email || activeConversation.customerEmail || undefined,
      zalo: activeConversation.channel === "zalo" ? activeConversation.customerName : undefined,
      facebook: activeConversation.channel === "facebook" ? activeConversation.customerName : undefined,
      source: mappedSource,
      searchQuery:
        activeConversation.crmData?.phone ||
        activeConversation.crmData?.email ||
        activeConversation.customerEmail ||
        activeConversation.customerName ||
        undefined,
    };
  }, [activeConversation]);

  // Handle Reply to a specific email message in thread
  const handleReplyMessage = (msg: MessageItem, mode: "reply" | "reply_all" | "forward") => {
    setEmailReplyMode(mode);
    setReplyTargetMessage(msg);

    const rawSubj = msg.subject || activeConversation?.subject || "";
    const cleanSubj = rawSubj.replace(/^(?:(?:re|fw|fwd)\s*:\s*)+/gi, "").trim();

    if (mode === "forward") {
      setEmailSubject(cleanSubj ? `Fwd: ${cleanSubj}` : "Fwd: Thư chuyển tiếp");
      setEmailRecipient("");
      setEmailCcList([]);
      const quoteHeader = `\n\n---------- Thư chuyển tiếp ----------\nTừ: ${msg.senderName || msg.senderEmail} <${msg.senderEmail}>\nNgày: ${msg.time}\nTiêu đề: ${msg.subject || cleanSubj}\nĐến: ${msg.recipientEmails?.join(", ") || ""}\n\n${msg.text}`;
      setComposerText(quoteHeader);
    } else if (mode === "reply_all") {
      setEmailSubject(cleanSubj ? `Re: ${cleanSubj}` : "Re: Phản hồi");
      const targetSender = msg.sender === "me"
        ? (msg.recipientEmails?.[0] || activeConversation?.customerEmail || "")
        : (msg.senderEmail || activeConversation?.customerEmail || "");
      setEmailRecipient(targetSender);

      const ourEmail = (realAccounts.find((a) => a.channel === "email")?.email || "").toLowerCase();
      const ccSet = new Set<string>();
      (msg.recipientEmails || []).forEach((r) => ccSet.add(r.toLowerCase()));
      (msg.ccEmails || []).forEach((c) => ccSet.add(c.toLowerCase()));
      if (msg.senderEmail) ccSet.add(msg.senderEmail.toLowerCase());
      ccSet.delete(ourEmail);
      ccSet.delete(targetSender.toLowerCase());
      setEmailCcList(Array.from(ccSet));
    } else {
      setEmailSubject(cleanSubj ? `Re: ${cleanSubj}` : "Re: Phản hồi");
      const targetSender = msg.sender === "me"
        ? (msg.recipientEmails?.[0] || activeConversation?.customerEmail || "")
        : (msg.senderEmail || activeConversation?.customerEmail || "");
      setEmailRecipient(targetSender);
      setEmailCcList([]);
    }
  };

  // Handle Send Message
  const handleSendMessage = async () => {
    if (!composerText.trim() || !activeConversation || isSendingEmail) return;

    const textToSend = composerText.trim();
    const idempotencyKey = typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `idemp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const tempMsgId = `optimistic-${Date.now()}`;
    const optimisticMsg: MessageItem = {
      id: tempMsgId,
      sender: "me",
      senderName: "Tôi",
      subject: activeConversation.channel === "email" ? emailSubject : undefined,
      text: textToSend,
      time: new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }),
      status: "sending",
      idempotencyKey,
      recipientEmails: [emailRecipient || activeConversation.customerEmail || ""],
      ccEmails: emailCcList,
      attachments: emailAttachments.map((a) => ({
        name: a.name,
        size: a.size,
        type: a.type,
      })),
    };

    if (isPreviewMode) {
      // Local preview update
      setPreviewConversations((prev) =>
        prev.map((c) =>
          c.id === activeConversation.id
            ? {
                ...c,
                lastMessageText: textToSend,
                lastMessageTime: optimisticMsg.time,
                messages: [...c.messages, { ...optimisticMsg, status: "sent" }],
              }
            : c
        )
      );
      setComposerText("");
      return;
    }

    // Real Mode Update
    const accountToSend = selectedAccount || activeConversation.accountId;
    if (!accountToSend) {
      showToast("Vui lòng chọn tài khoản để gửi thư.");
      return;
    }

    if (activeConversation.channel === "email") {
      // 1. Optimistic UI update: immediately append message with "sending" status and lock button
      setIsSendingEmail(true);
      setMessages((prev) => [...prev, optimisticMsg]);
      setRealConversations((prev) =>
        prev.map((c) =>
          c.id === activeConversation.id
            ? {
                ...c,
                lastMessageText: textToSend.slice(0, 100),
                lastMessageTime: "vừa xong",
                messages: [...c.messages, optimisticMsg],
              }
            : c
        )
      );

      // Save and clear inputs immediately for responsive UX
      const savedSubject = emailSubject;
      const savedAttachments = emailAttachments;
      const savedRecipient = emailRecipient || activeConversation.customerEmail;
      const savedCc = emailCcList;
      const savedReplyTarget = replyTargetMessage;
      const savedReplyMode = emailReplyMode;

      setComposerText("");
      setEmailAttachments([]);
      setEmailReplyMode("reply");
      setReplyTargetMessage(null);

      const accountObj = realAccounts.find((a) => a.id === accountToSend);

      const res = await omnichannelRepository.sendMessage(
        "email",
        accountToSend,
        activeConversation.id,
        textToSend,
        {
          subject: savedSubject,
          attachments: savedAttachments,
          recipient_email: savedRecipient,
          cc_emails: savedCc,
          reply_to_message_id: savedReplyTarget?.id,
          mode: savedReplyMode || "reply",
          idempotency_key: idempotencyKey,
          from_email: accountObj?.email,
        }
      );
      setIsSendingEmail(false);

      if (!res.ok) {
        setMessages((prev) =>
          prev.map((m) => (m.id === tempMsgId ? { ...m, status: "failed" } : m))
        );
        showToast(`Gửi email thất bại: ${res.error || "Vui lòng kiểm tra lại cấu hình."}`);
        return;
      }

      const sentMsg: MessageItem = res.message
        ? { ...res.message, status: "sent" }
        : {
            ...optimisticMsg,
            status: "sent",
            subject: savedSubject,
            recipientEmails: [savedRecipient || ""],
            ccEmails: savedCc,
            attachments: savedAttachments.map((a) => ({
              name: a.name,
              size: a.size,
              type: a.type,
            })),
          };

      setMessages((prev) =>
        prev.map((m) => (m.id === tempMsgId ? sentMsg : m))
      );
      setRealConversations((prev) =>
        prev.map((c) =>
          c.id === activeConversation.id
            ? {
                ...c,
                lastMessageText: textToSend.slice(0, 100),
                lastMessageTime: "vừa xong",
                messages: c.messages.map((m) => (m.id === tempMsgId ? sentMsg : m)),
              }
            : c
        )
      );
      showToast("Đã gửi email phản hồi thành công!");
      return;
    }

    const res = await omnichannelRepository.sendMessage(
      activeConversation.channel,
      accountToSend,
      activeConversation.id,
      textToSend
    );

    if (!res.ok) {
      showToast("Gửi tin nhắn thất bại. Vui lòng kiểm tra lại kết nối tài khoản.");
      return;
    }

    setMessages((prev) => [...prev, { ...optimisticMsg, status: "sent" }]);
    setComposerText("");
  };


  // Official CRM Deal Creation
  const handleCreateDealOfficial = async (input: any) => {
    const dealName = input.projectName || "Cơ hội mới";

    if (isPreviewMode) {
      // Preview mode simulated update
      if (activeConversation) {
        setPreviewConversations((prev) =>
          prev.map((c) =>
            c.id === activeConversation.id
              ? {
                  ...c,
                  isCrmMatched: true,
                  opportunity: {
                    id: `opp-prev-${Date.now()}`,
                    code: `OPP-PREV-${Math.floor(100 + Math.random() * 900)}`,
                    name: dealName,
                    amount: `${(input.estimatedBudget || 50000000).toLocaleString("vi-VN")}đ`,
                    stage: "Tư vấn",
                    winRate: "50%",
                    ownerName: "Admin (Preview)",
                    updatedAt: "Vừa xong",
                  },
                }
              : c
          )
        );
      }
      setIsCreateDealOpen(false);
      showToast(`[PREVIEW UI] Đã tạo cơ hội "${dealName}" xem trước! Dữ liệu không ghi vào Database.`);
      return;
    }

    // Real Mode Deal Creation
    setDealLoading(true);
    try {
      const createdDeal = await seedingCrmRepository.createDeal(input);
      showToast(`Đã tạo cơ hội "${dealName}" thành công trên CRM!`);
      setIsCreateDealOpen(false);

      if (activeConversation) {
        setRealConversations((prev) =>
          prev.map((c) =>
            c.id === activeConversation.id
              ? {
                  ...c,
                  isCrmMatched: true,
                  opportunity: {
                    id: createdDeal.id,
                    code: `OPP-${createdDeal.id.substring(0, 6)}`,
                    name: dealName,
                    amount: `${input.estimatedBudget || 0}đ`,
                    stage: "Tư vấn",
                    winRate: "50%",
                    ownerName: "Admin",
                    updatedAt: "Vừa xong",
                  },
                }
              : c
          )
        );
      }
    } catch (e: any) {
      showToast(`Lỗi khi tạo cơ hội CRM: ${e.message || "Không thể lưu"}`);
    } finally {
      setDealLoading(false);
    }
  };

  // Dynamically compute conversation counts for each channel
  const channelCounts = useMemo(() => {
    return {
      all: currentConversations.length,
      email: currentConversations.filter((c) => c.channel === "email").length,
      facebook: currentConversations.filter((c) => c.channel === "facebook").length,
      zalo: currentConversations.filter((c) => c.channel === "zalo").length,
      telegram: currentConversations.filter((c) => c.channel === "telegram").length,
      whatsapp: currentConversations.filter((c) => c.channel === "whatsapp").length,
      viber: currentConversations.filter((c) => c.channel === "viber").length,
      linkedin: currentConversations.filter((c) => c.channel === "linkedin").length,
    };
  }, [currentConversations]);

  // Periodic background check for new incoming emails with notification toast
  useEffect(() => {
    if (isPreviewMode) return;
    const interval = setInterval(async () => {
      try {
        const emailConvs = await omnichannelRepository.fetchConversations("email");
        if (emailConvs.length > 0) {
          setRealConversations((prev) => {
            const map = new Map(prev.map((c) => [c.id, c]));
            let hasNewIncoming = false;
            let latestSender = "";
            let latestMsg = "";

            for (const ec of emailConvs) {
              const old = map.get(ec.id);
              if (!old) {
                map.set(ec.id, ec);
                if (ec.unreadCount > 0) {
                  hasNewIncoming = true;
                  latestSender = ec.customerName;
                  latestMsg = ec.lastMessageText;
                }
              } else if (ec.unreadCount > (old.unreadCount || 0)) {
                map.set(ec.id, { ...old, ...ec });
                hasNewIncoming = true;
                latestSender = ec.customerName;
                latestMsg = ec.lastMessageText;
              }
            }
            if (hasNewIncoming) {
              showToast(`📧 [Email mới] ${latestSender}: "${latestMsg.substring(0, 45)}..."`);
            }
            return Array.from(map.values());
          });
        }
      } catch (e) {
        // quiet background check
      }
    }, 20000);
    return () => clearInterval(interval);
  }, [isPreviewMode]);

  const isDev = process.env.NODE_ENV === "development";

  return (
    <div className="flex flex-col h-full w-full overflow-hidden bg-slate-100 font-sans">
      {/* Main 4-Pane Workspace */}
      <div className="flex flex-1 h-full w-full overflow-hidden min-h-0">
        {/* Pane 1 — Kênh & Tài khoản (~185px) */}
        <ChannelScopePane
          selectedChannel={selectedChannel}
          onSelectChannel={(ch) => {
            setSelectedChannel(ch);
            setSelectedAccount(null);
            setEmailAttachments([]);
          }}
          selectedAccount={selectedAccount}
          onSelectAccount={(acc) => setSelectedAccount(acc)}
          accounts={currentAccounts}
          channelCounts={channelCounts}
          isCollapsed={isPane1Collapsed}
          onToggleCollapse={() => setIsPane1Collapsed((v) => !v)}
          scopeFilter={scopeFilter}
          onSelectScopeFilter={(s) => setScopeFilter(s)}
          onConnectAccountModal={() => setIsConnectAccountOpen(true)}
        />

        {/* Pane 2 — Hội thoại (~320px) */}
        <ConversationList
          conversations={filteredConversations}
          selectedConvId={activeConversation?.id || null}
          onSelectConv={(id) => {
            setSelectedConvId(id);
            setEmailAttachments([]);
            setEmailReplyMode("reply");
            setReplyTargetMessage(null);
            if (isPreviewMode) {
              const target = previewConversations.find((c) => c.id === id);
              if (target) setMessages(target.messages);
            } else {
              const target = realConversations.find((c) => c.id === id);
              if (target) {
                if (target.channel === "email" && target.unreadCount > 0) {
                  omnichannelRepository.markEmailRead(id);
                  setRealConversations((prev) =>
                    prev.map((c) => (c.id === id ? { ...c, unreadCount: 0 } : c))
                  );
                }
                if (target.channel === "email") {
                  const rawSubj = target.subject || target.messages?.[0]?.subject || "";
                  const clean = rawSubj.replace(/^(?:(?:re|fw|fwd)\s*:\s*)+/gi, "").trim();
                  setEmailSubject(clean ? `Re: ${clean}` : "Re: Phản hồi thông tin");
                  setEmailRecipient(target.customerEmail || "");
                  setEmailCcList([]);
                }
              }
            }
          }}
          searchQuery={searchQuery}
          onSearchChange={(q) => setSearchQuery(q)}
          filterTab={filterTab}
          onFilterTabChange={(tab) => setFilterTab(tab)}
          selectedChannel={selectedChannel}
          selectedAccountInfo={realAccounts.find((a) => a.id === selectedAccount) || realAccounts.find((a) => a.channel === "email")}
          isSyncing={isSyncingEmail}
          onManualSync={handleManualSyncEmail}
          onComposeNewEmail={() => setIsEmailComposeOpen(true)}
        />

        {/* Pane 3 — Chat Workspace (flex-1, main focus) */}
        <div className="flex flex-1 flex-col h-full min-w-0 bg-white border-r border-slate-200">
          {loadingConvs || loadingMsgs ? (
            <div className="flex h-full flex-col items-center justify-center p-8 text-center text-xs text-slate-400 gap-2">
              <div className="h-6 w-6 border-2 border-[var(--color-markee-primary,#c2185b)] border-t-transparent rounded-full animate-spin" />
              <span>Đang tải dữ liệu hội thoại...</span>
            </div>
          ) : activeConversation ? (
            <>
              <ConversationHeader
                conversation={activeConversation}
                onOpenAssignUser={() => setIsAssignUserOpen(true)}
                onViewCustomerProfile={() => setIsCustomerDrawerOpen(true)}
                onCopyConvId={() => showToast("Đã sao chép ID hội thoại!")}
                onToggleUnread={() => showToast("Đã cập nhật trạng thái đọc.")}
              />

              <MessageThread
                conversation={activeConversation}
                onReplyMessage={handleReplyMessage}
              />

              <AiReplySuggestion
                suggestion={activeConversation.aiSuggestedReply}
                onInsertSuggestion={(text) =>
                  setComposerText((prev) => (prev ? `${prev} ${text}` : text))
                }
              />

              <MessageComposer
                text={composerText}
                onChangeText={(t) => setComposerText(t)}
                onSend={handleSendMessage}
                onOpenQuickReplies={() => setIsQuickRepliesOpen(true)}
                onOpenAiAssist={() => {
                  if (activeConversation.aiSuggestedReply) {
                    const reply = activeConversation.aiSuggestedReply;
                    setComposerText((prev) => (prev ? `${prev} ${reply}` : reply));
                  }
                }}
                onOpenAddNote={() => setIsAddNoteOpen(true)}
                onOpenCreateDeal={() => setIsCreateDealOpen(true)}
                onOpenCreateQuote={() => setIsCreateQuoteOpen(true)}
                isEmailChannel={activeConversation.channel === "email"}
                emailSubject={emailSubject}
                onChangeEmailSubject={setEmailSubject}
                emailRecipient={emailRecipient || activeConversation.customerEmail}
                onChangeEmailRecipient={setEmailRecipient}
                emailCc={emailCcList}
                onChangeEmailCc={setEmailCcList}
                emailAttachments={emailAttachments}
                onChangeEmailAttachments={setEmailAttachments}
                replyMode={emailReplyMode}
                onCancelReplyMode={() => {
                  setEmailReplyMode("reply");
                  setReplyTargetMessage(null);
                  const clean = (activeConversation.subject || "").replace(/^(?:(?:re|fw|fwd)\s*:\s*)+/gi, "").trim();
                  setEmailSubject(clean ? `Re: ${clean}` : "Re: Phản hồi");
                  setEmailRecipient(activeConversation.customerEmail || "");
                  setEmailCcList([]);
                }}
                isSending={isSendingEmail}
              />
            </>

          ) : (
            <div className="flex h-full flex-col items-center justify-center p-8 text-center text-xs text-slate-400 space-y-4">
              <div className="rounded-full bg-slate-100 p-4 text-slate-300">
                {selectedChannel === "email" ? "✉️" : "💬"}
              </div>
              <div className="space-y-1">
                <p className="font-semibold text-slate-700 text-sm">
                  {selectedChannel === "email"
                    ? (filteredConversations.length > 0 ? "Chưa chọn email nào" : "Hộp thư đến chưa có thư nào")
                    : "Chưa có hội thoại nào được chọn"}
                </p>
                <p className="max-w-xs text-[11px] text-slate-400 leading-relaxed">
                  {selectedChannel === "email"
                    ? (filteredConversations.length > 0
                        ? "Chọn một email từ danh sách bên trái để đọc nội dung và gửi phản hồi."
                        : (realAccounts.some((a) => a.channel === "email")
                            ? "Tài khoản email đã kết nối nhưng chưa có email nào được đồng bộ. Bấm 'Đồng bộ thư ngay' hoặc 'Soạn thư mới' để bắt đầu trao đổi."
                            : "Kết nối tài khoản Gmail / IMAP để đồng bộ và quản lý email trực tiếp trong CRM."))
                    : "Hội thoại sẽ tự động xuất hiện khi tài khoản được kết nối và có tin nhắn đồng bộ về hệ thống."}
                </p>
              </div>

              <div className="flex items-center gap-2 pt-2">
                {selectedChannel === "email" && realAccounts.some((a) => a.channel === "email") ? (
                  <>
                    <button
                      onClick={() => setIsEmailComposeOpen(true)}
                      className="rounded-lg bg-[var(--color-markee-primary,#c2185b)] px-3.5 py-1.5 text-xs font-semibold text-white shadow-2xs hover:bg-[#a3134c] transition flex items-center gap-1.5 cursor-pointer"
                    >
                      <PenSquare className="h-3.5 w-3.5" />
                      <span>Soạn thư mới</span>
                    </button>
                    <button
                      onClick={handleManualSyncEmail}
                      disabled={isSyncingEmail}
                      className="rounded-lg border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-700 shadow-2xs hover:bg-slate-50 transition flex items-center gap-1.5 disabled:opacity-50"
                    >
                      <RotateCw className={`h-3.5 w-3.5 ${isSyncingEmail ? "animate-spin" : ""}`} />
                      {isSyncingEmail ? "Đang đồng bộ..." : "Đồng bộ thư ngay"}
                    </button>
                    <button
                      onClick={() => setIsEmailConnectOpen(true)}
                      className="rounded-lg border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-700 shadow-2xs hover:bg-slate-50 transition"
                    >
                      Cấu hình tài khoản
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => {
                      if (selectedChannel === "email") {
                        setIsEmailConnectOpen(true);
                      } else {
                        setIsConnectAccountOpen(true);
                      }
                    }}
                    className="rounded-lg bg-[var(--color-markee-primary,#c2185b)] px-3.5 py-1.5 text-xs font-medium text-white shadow-2xs hover:bg-[#a3134c] transition"
                  >
                    + Kết nối tài khoản
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Pane 4 — CRM 360 (~330px, ALWAYS rendered as 4-pane shell) */}
        <Crm360Panel
          conversation={activeConversation}
          isCollapsed={isPane4Collapsed}
          onToggleCollapse={() => setIsPane4Collapsed((v) => !v)}
          onOpenCreateDeal={() => setIsCreateDealOpen(true)}
          onOpenCreateQuote={() => setIsCreateQuoteOpen(true)}
          onOpenFindCustomer={() => setIsFindCustomerOpen(true)}
          onOpenCreateCustomer={() => setIsCreateCustomerOpen(true)}
          onOpenAddNote={() => setIsAddNoteOpen(true)}
          onRefreshCrmData={() => showToast("Đã cập nhật dữ liệu CRM 360 mới nhất.")}
          onViewCustomerProfile={() => setIsCustomerDrawerOpen(true)}
          onViewAllDeals={() => setIsDealListDrawerOpen(true)}
          onViewAllQuotes={() => setIsQuoteListDrawerOpen(true)}
          onViewDealDetail={(deal) => setSelectedDealForDetail(deal)}
          onViewQuoteDetail={(quote) => setSelectedQuoteForPreview(quote)}
        />
      </div>

      {/* Slide-over In-Place Drawers (Primary UX) */}
      <Customer360Drawer
        isOpen={isCustomerDrawerOpen}
        onClose={() => setIsCustomerDrawerOpen(false)}
        conversation={activeConversation}
        onOpenCreateDeal={() => {
          setIsCustomerDrawerOpen(false);
          setIsCreateDealOpen(true);
        }}
        onOpenCreateQuote={() => {
          setIsCustomerDrawerOpen(false);
          setIsCreateQuoteOpen(true);
        }}
        onOpenAddNote={() => {
          setIsCustomerDrawerOpen(false);
          setIsAddNoteOpen(true);
        }}
      />

      <DealListDrawer
        isOpen={isDealListDrawerOpen}
        onClose={() => setIsDealListDrawerOpen(false)}
        customerName={activeConversation?.customerName || "Khách hàng"}
        opportunity={activeConversation?.opportunity}
        onOpenCreateDeal={() => {
          setIsDealListDrawerOpen(false);
          setIsCreateDealOpen(true);
        }}
        onSelectDeal={(deal) => {
          setSelectedDealForDetail(deal);
        }}
      />

      <QuoteListDrawer
        isOpen={isQuoteListDrawerOpen}
        onClose={() => setIsQuoteListDrawerOpen(false)}
        customerName={activeConversation?.customerName || "Khách hàng"}
        quote={activeConversation?.quote}
        onOpenCreateQuote={() => {
          setIsQuoteListDrawerOpen(false);
          setIsCreateQuoteOpen(true);
        }}
        onSelectQuote={(quote) => {
          setSelectedQuoteForPreview(quote);
        }}
      />

      <QuotePreviewDrawer
        isOpen={Boolean(selectedQuoteForPreview)}
        onClose={() => setSelectedQuoteForPreview(null)}
        quote={selectedQuoteForPreview}
        customerName={activeConversation?.customerName}
        onSendViaChannel={() => {
          if (selectedQuoteForPreview) {
            const text = `📑 Báo giá đính kèm: ${selectedQuoteForPreview.code || "QUA-2026-146"} · ${selectedQuoteForPreview.amount || "50.000.000đ"}`;
            setComposerText((prev) => (prev ? `${prev}\n${text}` : text));
            setSelectedQuoteForPreview(null);
            showToast("Đã thêm thông tin báo giá vào khung nhập tin nhắn!");
          }
        }}
      />

      {/* Official CRM Deal Modal */}
      <DealFormModal
        open={isCreateDealOpen}
        loading={dealLoading}
        onClose={() => setIsCreateDealOpen(false)}
        onCreate={handleCreateDealOfficial}
        onUpdate={() => {}}
        initialCustomer={activeConversation ? { id: activeConversation.id, name: activeConversation.customerName } as any : null}
      />

      {/* Interactive Drawers & Modals */}
      <ConnectAccountMockModal
        isOpen={isConnectAccountOpen}
        onClose={() => setIsConnectAccountOpen(false)}
        onSelectChannelConnect={(ch) => {
          setIsConnectAccountOpen(false);
          if (ch === "zalo") {
            setIsZaloConnectOpen(true);
            return;
          }
          if (ch === "telegram") {
            setIsTelegramConnectOpen(true);
            return;
          }
          if (ch === "email") {
            setIsEmailConnectOpen(true);
            return;
          }
          const cap = CHANNEL_CAPABILITIES[ch as ChannelType];
          if (cap && cap.isAvailable && cap.connectRoute) {
            router.push(`${cap.connectRoute}?returnTo=/all-platform/omnichannel-inbox`);
          }
        }}
      />

      {/* Email Connect Modal Popup */}
      <EmailConnectModal
        isOpen={isEmailConnectOpen}
        onClose={() => setIsEmailConnectOpen(false)}
        initialEmail={realAccounts.find((a) => a.channel === "email")?.email}
        initialName={realAccounts.find((a) => a.channel === "email")?.name}
        onSuccess={async (connectedAccount) => {
          setSelectedChannel("email");
          const accs = await omnichannelRepository.fetchChannelAccounts();
          setRealAccounts(accs);
          const emailAcc = accs.find((a) => a.channel === "email" && (!connectedAccount || a.email === connectedAccount.email)) || accs.find((a) => a.channel === "email");
          if (emailAcc) {
            setSelectedAccount(emailAcc.id);
            setLoadingConvs(true);
            const list = await omnichannelRepository.fetchConversations("email", emailAcc.id, accs);
            setRealConversations(list);
            setLoadingConvs(false);
            if (list.length > 0) {
              setSelectedConvId(list[0].id);
            }
          }
          showToast(`Đã kết nối tài khoản Email ${connectedAccount?.email || ""} thành công!`);
        }}
      />

      {/* Email Compose Modal */}
      <EmailComposeModal
        isOpen={isEmailComposeOpen}
        onClose={() => setIsEmailComposeOpen(false)}
        senderEmail={realAccounts.find((a) => a.channel === "email")?.email}
        senderName={realAccounts.find((a) => a.channel === "email")?.name}
        accounts={realAccounts}
        onSuccess={(newConv) => {
          setRealConversations((prev) => [newConv, ...prev.filter((c) => c.id !== newConv.id)]);
          setSelectedConvId(newConv.id);
          setSelectedChannel("email");
          if (newConv.messages) setMessages(newConv.messages);
          showToast("Đã gửi email mới thành công!");
        }}
      />

      {/* Official Zalo Accounts Management Modal Popup */}
      <ZaloConnectModal
        isOpen={isZaloConnectOpen}
        onClose={() => setIsZaloConnectOpen(false)}
        onSuccess={() => {
          fetchRealAccounts();
          showToast("Đã cập nhật danh sách tài khoản Zalo!");
        }}
      />

      {/* Official Telegram Connect Modal Flow */}
      {isTelegramConnectOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-2xs p-4 select-none">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl border border-slate-100 font-sans">
            <TelegramConnectFlow
              onDone={() => {
                setIsTelegramConnectOpen(false);
                fetchRealAccounts();
                showToast("Đã kết nối tài khoản Telegram thành công!");
              }}
              onCancel={() => setIsTelegramConnectOpen(false)}
            />
          </div>
        </div>
      )}

      <QuickRepliesMockModal
        isOpen={isQuickRepliesOpen}
        onClose={() => setIsQuickRepliesOpen(false)}
        onInsertTemplate={(text) => setComposerText((prev) => (prev ? `${prev}\n${text}` : text))}
      />

      {isCreateQuoteOpen && (
        <QuoteWorkspaceModal
          quoteId={null}
          deals={
            activeConversation?.opportunity
              ? [{ id: activeConversation.opportunity.id, customerName: activeConversation.customerName } as any]
              : []
          }
          dealsById={new Map()}
          agents={[]}
          user={user}
          initialCustomerId={activeConversation?.id}
          onClose={() => setIsCreateQuoteOpen(false)}
          onChanged={() => {
            setIsCreateQuoteOpen(false);
            const quoteCode = `QUA-2026-${Math.floor(100 + Math.random() * 900)}`;
            showToast(
              isPreviewMode
                ? `[PREVIEW UI] Đã tạo yêu cầu báo giá xem trước!`
                : `Đã lưu/tạo yêu cầu báo giá thành công trên CRM!`
            );

            if (activeConversation) {
              const updateFn = isPreviewMode ? setPreviewConversations : setRealConversations;
              updateFn((prev) =>
                prev.map((c) =>
                  c.id === activeConversation.id
                    ? {
                        ...c,
                        quote: {
                          id: `qua-${Date.now()}`,
                          code: quoteCode,
                          amount: "50.000.000đ",
                          status: "Draft",
                          ownerName: "Admin",
                          createdAt: "Vừa xong",
                        },
                      }
                    : c
                )
              );
            }
          }}
          onEditDraft={() => {}}
        />
      )}

      {/* Real Assignee Modal */}
      <AssignUserModal
        isOpen={isAssignUserOpen}
        onClose={() => setIsAssignUserOpen(false)}
        currentOwnerName={activeConversation?.crmData.ownerName || "Nguyễn Thị Mai"}
        onAssignUser={(assignedUser) => {
          setIsAssignUserOpen(false);
          if (activeConversation) {
            const updateFn = isPreviewMode ? setPreviewConversations : setRealConversations;
            updateFn((prev) =>
              prev.map((c) =>
                c.id === activeConversation.id
                  ? {
                      ...c,
                      crmData: {
                        ...c.crmData,
                        ownerName: assignedUser.display_name || assignedUser.full_name || "Nhân viên",
                        ownerAvatar: c.crmData.ownerAvatar,
                      },
                    }
                  : c
              )
            );
          }
        }}
      />

      {/* Real Customer Add Drawer */}
      <CustomerAddDrawer
        open={isCreateCustomerOpen}
        currentUser={user}
        onClose={() => setIsCreateCustomerOpen(false)}
        onCreated={() => {
          setIsCreateCustomerOpen(false);
          if (activeConversation) {
            const updateFn = isPreviewMode ? setPreviewConversations : setRealConversations;
            updateFn((prev) =>
              prev.map((c) =>
                c.id === activeConversation.id
                  ? {
                      ...c,
                      isCrmMatched: true,
                      crmData: {
                        ...c.crmData,
                        matched: true,
                        name: c.customerName,
                        statusLabel: "Khách hàng mới",
                      },
                    }
                  : c
              )
            );
          }
          showToast("Đã tạo và liên kết Khách hàng CRM thành công!");
        }}
      />

      <FindCustomerMockModal
        isOpen={isFindCustomerOpen}
        initialSearchQuery={initialCustomerValues?.searchQuery}
        onClose={() => setIsFindCustomerOpen(false)}
        onOpenCreateCustomer={() => {
          setIsFindCustomerOpen(false);
          setIsCreateCustomerOpen(true);
        }}
        onLinkCustomer={(name) => {
          setIsFindCustomerOpen(false);
          if (activeConversation) {
            const updateFn = isPreviewMode ? setPreviewConversations : setRealConversations;
            updateFn((prev) =>
              prev.map((c) =>
                c.id === activeConversation.id
                  ? {
                      ...c,
                      isCrmMatched: true,
                      crmData: {
                        ...c.crmData,
                        matched: true,
                        name: name,
                        statusLabel: "Khách hàng mới",
                      },
                    }
                  : c
              )
            );
          }
        }}
      />

      <AddNoteMockModal
        isOpen={isAddNoteOpen}
        onClose={() => setIsAddNoteOpen(false)}
        isCrmMatched={activeConversation?.isCrmMatched}
        customerName={activeConversation?.customerName}
        onOpenFindCustomer={() => setIsFindCustomerOpen(true)}
        onOpenCreateCustomer={() => setIsCreateCustomerOpen(true)}
        onSubmitMock={(noteText) => {
          setIsAddNoteOpen(false);
          if (activeConversation && noteText.trim()) {
            const newMsg: MessageItem = {
              id: `note-${Date.now()}`,
              sender: "system",
              text: `📝 Ghi chú nội bộ: ${noteText.trim()}`,
              time: new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }),
            };
            setMessages((prev) => [...prev, newMsg]);
            showToast("Đã lưu ghi chú nội bộ thành công!");
          }
        }}
      />

      {/* Global In-App Notification Toast */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-xl bg-slate-900/95 px-4 py-3 text-xs font-semibold text-white shadow-2xl backdrop-blur-sm border border-slate-700/50 animate-in fade-in slide-in-from-bottom-3">
          <span>{toastMessage}</span>
          <button
            onClick={() => setToastMessage(null)}
            className="ml-2 rounded p-0.5 text-slate-400 hover:bg-slate-800 hover:text-white transition"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
