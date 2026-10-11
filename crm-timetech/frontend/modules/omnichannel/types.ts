export type ChannelType =
  | "all"
  | "facebook"
  | "zalo"
  | "telegram"
  | "whatsapp"
  | "viber"
  | "linkedin";

export interface ChannelAccount {
  id: string;
  name: string;
  channel: Exclude<ChannelType, "all">;
  avatar?: string;
  status: "online" | "offline" | "paused";
  count?: number;
}

export interface MessageItem {
  id: string;
  sender: "me" | "them" | "system";
  senderName?: string;
  text: string;
  time: string;
  attachment?: {
    type: "pdf" | "image" | "file";
    name: string;
    size: string;
    url?: string;
  };
  status?: "sent" | "delivered" | "read";
}

export interface CrmCustomerMatch {
  matched: boolean;
  name?: string;
  companyName?: string;
  statusLabel?: string;
  phone?: string;
  email?: string;
  address?: string;
  ownerName?: string;
  ownerAvatar?: string;
}

export interface CrmOpportunity {
  id: string;
  code: string;
  name: string;
  amount: string;
  stage: string;
  winRate: string;
  ownerName: string;
  updatedAt: string;
}

export interface CrmQuote {
  id: string;
  code: string;
  amount: string;
  status: string;
  ownerName: string;
  createdAt: string;
}

export interface ConversationItem {
  id: string;
  channel: Exclude<ChannelType, "all">;
  accountId: string;
  accountLabel: string;
  customerName: string;
  customerAvatar: string;
  unreadCount: number;
  lastMessageText: string;
  lastMessageTime: string;
  tags: string[];
  isCrmMatched: boolean;
  crmData: CrmCustomerMatch;
  opportunity?: CrmOpportunity;
  quote?: CrmQuote;
  messages: MessageItem[];
  aiSuggestedReply?: string;
}
