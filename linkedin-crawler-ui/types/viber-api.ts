export type ViberAccountStatus = "pending" | "connected" | "disconnected" | "error";
export type ViberMediaType = "picture" | "video" | "file" | "sticker" | "location" | "contact";
export type ViberMessageStatus = "received" | "sent" | "delivered" | "seen" | "failed";

export interface ViberAccount {
  id: string;
  id_member: string | null;
  label: string | null;
  bot_id: string | null;
  bot_uri: string | null;
  display_name: string | null;
  avatar_url: string | null;
  subscribers_count: number | null;
  webhook_url: string | null;
  status: ViberAccountStatus;
  last_error: string | null;
  connected_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ViberDialog {
  id: string;
  account_id: string;
  viber_user_id: string;
  name: string | null;
  avatar_url: string | null;
  language: string | null;
  country: string | null;
  is_subscribed: boolean;
  unread_count: number;
  last_message_at: string | null;
  last_message_preview: string | null;
  updated_at: string;
}

export interface ViberMessage {
  id: string;
  account_id: string;
  viber_user_id: string;
  message_token: string;
  is_outgoing: boolean;
  sender_name: string | null;
  sent_by_member: string | null;
  text: string | null;
  media_type: ViberMediaType | null;
  media_url: string | null;
  file_name: string | null;
  file_size: number | null;
  status: ViberMessageStatus;
  error: string | null;
  sent_at: string;
  created_at: string;
}

export interface ViberStreamEvent {
  type: "message" | "status" | "dialog";
  account_id: string;
  viber_user_id?: string;
  message?: ViberMessage;
}
