export type ChannelType =
  | "all"
  | "email"
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
  status: "online" | "offline" | "paused" | "error" | "syncing" | "expired";
  count?: number;
  email?: string;
  lastSyncedAt?: string | null;
  lastSyncError?: string | null;
  totalThreads?: number;
  providerType?: "google_oauth" | "imap_smtp" | "microsoft_oauth";
  reconnectRequired?: boolean;
  isDefault?: boolean;
}

export interface OutgoingEmailAttachment {
  name: string;
  size: string;
  type: "pdf" | "image" | "file";
  content_type: string;
  size_bytes: number;
  content_base64: string;
}

export interface MessageItem {
  id: string;
  sender: "me" | "them" | "system";
  senderName?: string;
  senderEmail?: string;
  recipientEmails?: string[];
  ccEmails?: string[];
  subject?: string;
  text: string;
  html?: string;
  time: string;
  attachment?: {
    type: "pdf" | "image" | "file";
    name: string;
    size: string;
    url?: string;
  };
  attachments?: Array<{
    type: "pdf" | "image" | "file";
    name: string;
    size: string;
    url?: string;
  }>;
  status?: "sent" | "delivered" | "read" | "sending" | "failed";
  messageId?: string;
  inReplyTo?: string;
  referencesHeader?: string;
  idempotencyKey?: string;
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

export interface CrmContractItem {
  id: string;
  code: string;
  title: string;
  status: string;
  amount: string;
  signedAt?: string;
  effectiveDate?: string;
}

export interface ConversationItem {
  id: string;
  channel: Exclude<ChannelType, "all">;
  accountId: string;
  accountLabel: string;
  customerName: string;
  customerAvatar: string;
  customerEmail?: string;
  subject?: string;
  unreadCount: number;
  lastMessageText: string;
  lastMessageTime: string;
  tags: string[];
  isCrmMatched: boolean;
  crmData: CrmCustomerMatch;
  opportunity?: CrmOpportunity;
  quote?: CrmQuote;
  contracts?: CrmContractItem[];
  messages: MessageItem[];
  aiSuggestedReply?: string;
}
