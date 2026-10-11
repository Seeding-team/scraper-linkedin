export type PhoneBridgePlatform = "messenger" | "zalo";

export interface PhoneBridgeConnectionState {
  connected?: boolean;
  online?: boolean;
  status?: string;
  message?: string;
  [key: string]: unknown;
}

export interface PhoneBridgeStatus {
  enabled?: boolean;
  configured?: boolean;
  connected?: boolean;
  online?: boolean;
  status?: string;
  bridge?: PhoneBridgeConnectionState | string;
  tunnel?: PhoneBridgeConnectionState | string;
  health?: Record<string, unknown> | null;
  errors?: Array<Record<string, unknown>>;
  message?: string;
  [key: string]: unknown;
}

export interface PhoneBridgeDevice {
  serial: string;
  name?: string;
  model?: string;
  status?: string;
  state?: string;
  connected?: boolean;
  online?: boolean;
  platforms?: string[];
  [key: string]: unknown;
}

export interface PhoneBridgeDevicesResponse {
  devices: PhoneBridgeDevice[];
  [key: string]: unknown;
}

export interface PhoneBridgeMessage {
  id?: string;
  sender?: string;
  senderName?: string;
  sender_name?: string;
  text?: string;
  message?: string;
  timestamp?: string | number;
  createdAt?: string;
  created_at?: string;
  direction?: "incoming" | "outgoing" | string;
  fromMe?: boolean;
  from_me?: boolean;
  [key: string]: unknown;
}

export interface PhoneBridgeConversation {
  id?: string;
  conversationId?: string;
  conversation_id?: string;
  conversationKey?: string;
  threadId?: string;
  thread_id?: string;
  name?: string;
  title?: string;
  participant?: string;
  snippet?: string;
  preview?: string | null;
  lastMessage?: string;
  last_message?: string;
  unreadCount?: number;
  unread_count?: number;
  messages?: PhoneBridgeMessage[];
  [key: string]: unknown;
}

export interface PhoneBridgeConversationsResponse {
  conversations?: PhoneBridgeConversation[];
  items?: PhoneBridgeConversation[];
  messages?: PhoneBridgeMessage[];
  isChatListScreen?: boolean;
  [key: string]: unknown;
}

export interface PhoneBridgeActionResponse {
  success?: boolean;
  message?: string;
  preview?: string | Record<string, unknown>;
  confirmationToken?: string;
  dryRun?: boolean;
  messages?: PhoneBridgeMessage[];
  results?: PhoneBridgeConversation[];
  snapshot?: {
    messages?: PhoneBridgeMessage[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface PhoneBridgeEvent {
  id: string;
  receivedAt: string;
  type: string;
  data: unknown;
}
