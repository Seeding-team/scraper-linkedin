"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { ChannelType, ConversationItem, ChannelAccount, MessageItem } from "../types";
import { omnichannelRepository } from "../repositories/OmnichannelRepository";
import { seedingCrmRepository } from "@/modules/crm/repositories/SeedingCrmRepository";
import { DealFormModal } from "@/modules/crm/components/DealFormModal";
import { TelegramConnectFlow } from "@/components/all-platform/telegram/TelegramConnectFlow";
import { ZaloConnectModal } from "./ZaloConnectModal";
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

  // 1. Fetch Real Channel Accounts on mount
  const fetchRealAccounts = async () => {
    setLoadingAccounts(true);
    const accs = await omnichannelRepository.fetchChannelAccounts();
    setRealAccounts(accs);
    setLoadingAccounts(false);
    if (!isPreviewMode && accs.length > 0) {
      setSelectedChannel(accs[0].channel);
      setSelectedAccount(accs[0].id);
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
      email: activeConversation.crmData?.email || undefined,
      zalo: activeConversation.channel === "zalo" ? activeConversation.customerName : undefined,
      facebook: activeConversation.channel === "facebook" ? activeConversation.customerName : undefined,
      source: mappedSource,
      searchQuery:
        activeConversation.crmData?.phone ||
        activeConversation.crmData?.email ||
        activeConversation.customerName ||
        undefined,
    };
  }, [activeConversation]);

  // Handle Send Message
  const handleSendMessage = async () => {
    if (!composerText.trim() || !activeConversation) return;

    const textToSend = composerText.trim();
    const tempMsgId = `msg-${Date.now()}`;
    const newMsg: MessageItem = {
      id: tempMsgId,
      sender: "me",
      senderName: "Tôi",
      text: textToSend,
      time: new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }),
      status: "sent",
    };

    if (isPreviewMode) {
      // Local preview update
      setPreviewConversations((prev) =>
        prev.map((c) =>
          c.id === activeConversation.id
            ? {
                ...c,
                lastMessageText: textToSend,
                lastMessageTime: newMsg.time,
                messages: [...c.messages, newMsg],
              }
            : c
        )
      );
      setComposerText("");
      return;
    }

    // Real Mode Update
    if (!selectedAccount) return;
    setMessages((prev) => [...prev, newMsg]);
    setComposerText("");

    const success = await omnichannelRepository.sendMessage(
      activeConversation.channel,
      selectedAccount,
      activeConversation.id,
      textToSend
    );

    if (!success) {
      showToast("Gửi tin nhắn thất bại. Vui lòng kiểm tra lại kết nối tài khoản.");
    }
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
      facebook: currentConversations.filter((c) => c.channel === "facebook").length,
      zalo: currentConversations.filter((c) => c.channel === "zalo").length,
      telegram: currentConversations.filter((c) => c.channel === "telegram").length,
      whatsapp: currentConversations.filter((c) => c.channel === "whatsapp").length,
      viber: currentConversations.filter((c) => c.channel === "viber").length,
      linkedin: currentConversations.filter((c) => c.channel === "linkedin").length,
    };
  }, [currentConversations]);

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
            if (isPreviewMode) {
              const target = previewConversations.find((c) => c.id === id);
              if (target) setMessages(target.messages);
            }
          }}
          searchQuery={searchQuery}
          onSearchChange={(q) => setSearchQuery(q)}
          filterTab={filterTab}
          onFilterTabChange={(tab) => setFilterTab(tab)}
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

              <MessageThread conversation={activeConversation} />

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
              />
            </>
          ) : (
            <div className="flex h-full flex-col items-center justify-center p-8 text-center text-xs text-slate-400 space-y-4">
              <div className="rounded-full bg-slate-100 p-4 text-slate-300">
                💬
              </div>
              <div className="space-y-1">
                <p className="font-semibold text-slate-700 text-sm">Chưa có hội thoại nào được chọn</p>
                <p className="max-w-xs text-[11px] text-slate-400 leading-relaxed">
                  Hội thoại sẽ tự động xuất hiện khi tài khoản được kết nối và có tin nhắn đồng bộ về hệ thống.
                </p>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <button
                  onClick={() => setIsConnectAccountOpen(true)}
                  className="rounded-lg bg-[var(--color-markee-primary,#c2185b)] px-3.5 py-1.5 text-xs font-medium text-white shadow-2xs hover:bg-[#a3134c] transition"
                >
                  + Kết nối tài khoản
                </button>
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
          const cap = CHANNEL_CAPABILITIES[ch as ChannelType];
          if (cap && cap.isAvailable && cap.connectRoute) {
            router.push(`${cap.connectRoute}?returnTo=/all-platform/omnichannel-inbox`);
          }
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
        initialValues={initialCustomerValues}
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
