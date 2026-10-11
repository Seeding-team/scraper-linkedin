export type TelegramAuthType = "user" | "bot";
export type TelegramAccountStatus = "pending" | "awaiting_code" | "awaiting_password" | "connected" | "disconnected" | "error";
export type TelegramDialogType = "user" | "group" | "channel" | "bot";
export type TelegramMediaType = "photo" | "video" | "voice" | "document";

export interface TelegramAccount {
  id: string;
  id_member: string | null;
  label: string | null;
  auth_type: TelegramAuthType;
  phone: string | null;
  telegram_user_id: number | null;
  username: string | null;
  display_name: string | null;
  status: TelegramAccountStatus;
  last_error: string | null;
  connected_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TelegramDialog {
  id: string;
  account_id: string;
  dialog_id: number;
  dialog_type: TelegramDialogType;
  title: string | null;
  username: string | null;
  photo_url: string | null;
  unread_count: number;
  last_message_at: string | null;
  last_message_preview: string | null;
  is_pinned: boolean;
  updated_at: string;
}

export interface TelegramMessage {
  id: string;
  account_id: string;
  dialog_id: number;
  message_id: number;
  sender_id: number | null;
  sender_name: string | null;
  is_outgoing: boolean;
  text: string | null;
  media_type: TelegramMediaType | null;
  media_url: string | null;
  reply_to_message_id: number | null;
  is_edited: boolean;
  is_deleted: boolean;
  is_pinned: boolean;
  sent_at: string;
  created_at: string;
}

export interface TelegramLoginStepResult {
  account_id: string;
  status: "awaiting_code" | "awaiting_password" | "connected";
}
