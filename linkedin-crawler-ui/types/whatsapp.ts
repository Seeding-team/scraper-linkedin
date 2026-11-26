export type WhatsAppAccountStatus =
  | "pending"
  | "qr_ready"
  | "qr_expired"
  | "pairing_ready"
  | "connecting"
  | "reconnecting"
  | "connected"
  | "disconnected"
  | "logged_out"
  | "error";

export type WhatsAppAuthMode = "qr" | "pairing";

export interface WhatsAppAccount {
  id: string;
  id_member?: string;
  phone_number?: string | null;
  jid?: string | null;
  lid?: string | null;
  display_name?: string | null;
  avatar_url?: string | null;
  label?: string | null;
  status: WhatsAppAccountStatus | string;
  auth_mode?: WhatsAppAuthMode | string | null;
  qr_data_url?: string | null;
  pairing_code?: string | null;
  auth_dir?: string | null;
  has_proxy?: boolean;
  proxy_masked?: string | null;
  cloud_calling_enabled?: boolean;
  cloud_phone_number_id?: string | null;
  cloud_waba_id?: string | null;
  has_cloud_token?: boolean;
  cloud_webhook_verify_token?: string | null;
  auto_reject_calls?: boolean;
  auto_reject_message?: string | null;
  last_error?: string | null;
  last_connected_at?: string | null;
  bridge_running?: boolean;
  bridge_connected?: boolean;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface WhatsAppAccountStatusResult {
  account?: WhatsAppAccount | null;
  id?: string;
  status?: WhatsAppAccountStatus | string;
  qr_data_url?: string | null;
  pairing_code?: string | null;
  phone_number?: string | null;
  display_name?: string | null;
  has_proxy?: boolean;
  proxy_masked?: string | null;
  last_error?: string | null;
  bridge_running?: boolean;
  bridge_connected?: boolean;
}

export interface WhatsAppSettingsPatch {
  label?: string | null;
  /** Pass "" to clear saved proxy; omit (undefined) to preserve existing proxy. */
  proxy_url?: string | null;
  auto_reject_calls?: boolean;
  auto_reject_message?: string | null;
  cloud_calling_enabled?: boolean;
  cloud_phone_number_id?: string | null;
  cloud_waba_id?: string | null;
  cloud_access_token?: string | null;
  cloud_webhook_verify_token?: string | null;
}

export type WhatsAppChatType = "direct" | "group" | "broadcast";

export type WhatsAppConversationFilter =
  | "all"
  | "unread"
  | "groups"
  | "direct"
  | "pinned"
  | "archived";

export interface WhatsAppConversation {
  id?: string;
  account_id: string;
  chat_jid: string;
  chat_alt_jid?: string | null;
  chat_type: WhatsAppChatType | string;
  title?: string | null;
  phone_number?: string | null;
  avatar_url?: string | null;
  last_message_at?: string | null;
  last_message_preview?: string | null;
  unread_count: number;
  is_pinned?: boolean;
  is_muted?: boolean;
  is_archived?: boolean;
  custom_label?: string | null;
  participant_count?: number;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface WhatsAppConversationPatch {
  is_pinned?: boolean;
  is_muted?: boolean;
  is_archived?: boolean;
  custom_label?: string | null;
}

export type WhatsAppMessageType =
  | "text"
  | "image"
  | "video"
  | "audio"
  | "voice"
  | "document"
  | "sticker"
  | "contact"
  | "location"
  | "poll"
  | "call_log"
  | "revoked"
  | "system"
  | "unknown";

export type WhatsAppAckStatus =
  | "pending"
  | "sending"
  | "sent"
  | "delivered"
  | "read"
  | "played"
  | "failed"
  | string;

export interface WhatsAppReaction {
  sender_jid?: string | null;
  sender_name?: string | null;
  emoji: string;
  timestamp?: string | null;
}

export interface WhatsAppLocationMeta {
  latitude: number;
  longitude: number;
  name?: string | null;
  address?: string | null;
}

export interface WhatsAppContactMeta {
  display_name?: string | null;
  contact_name?: string | null;
  phone_number?: string | null;
  contact_phone?: string | null;
  vcard?: string | null;
}

export interface WhatsAppPollOption {
  name: string;
  votes?: number;
}

export interface WhatsAppPollMeta {
  question?: string | null;
  options?: Array<string | WhatsAppPollOption>;
  selectable_count?: number;
}

export interface WhatsAppCallLogMeta {
  call_id?: string | null;
  direction?: WhatsAppCallDirection | string | null;
  call_type?: WhatsAppCallType | string | null;
  call_mode?: WhatsAppCallMode | string | null;
  status?: WhatsAppCallStatus | string | null;
  call_status?: WhatsAppCallStatus | string | null;
  duration_seconds?: number | null;
  is_video?: boolean;
  peer_phone?: string | null;
  peer_name?: string | null;
}

export interface WhatsAppMessageMetadata {
  latitude?: number;
  longitude?: number;
  name?: string | null;
  address?: string | null;
  location?: WhatsAppLocationMeta;
  contact_name?: string | null;
  contact_phone?: string | null;
  phone?: string | null;
  display_name?: string | null;
  vcard?: string | null;
  contact?: WhatsAppContactMeta;
  question?: string | null;
  options?: Array<string | WhatsAppPollOption>;
  selectable_count?: number;
  poll?: WhatsAppPollMeta;
  call_id?: string | null;
  direction?: string | null;
  call_type?: string | null;
  call_mode?: string | null;
  status?: string | null;
  call_status?: string | null;
  duration_seconds?: number | null;
  is_video?: boolean;
  call_log?: WhatsAppCallLogMeta;
  [key: string]: unknown;
}

export interface WhatsAppMessage {
  id?: string;
  account_id: string;
  chat_jid: string;
  message_id: string;
  sender_jid?: string | null;
  sender_phone?: string | null;
  sender_name?: string | null;
  is_outgoing: boolean;
  msg_type: WhatsAppMessageType | string;
  text?: string | null;
  media_url?: string | null;
  media_local_path?: string | null;
  media_mime?: string | null;
  media_filename?: string | null;
  media_size?: number | null;
  media_duration_s?: number | null;
  reply_to_message_id?: string | null;
  quoted_text?: string | null;
  metadata?: WhatsAppMessageMetadata | null;
  reactions?: WhatsAppReaction[] | null;
  raw_key?: Record<string, unknown> | null;
  ack_status?: WhatsAppAckStatus | null;
  is_edited?: boolean;
  is_deleted?: boolean;
  sent_at: string;
  created_at?: string | null;
  /** Client-only flag for 0ms Optimistic UI bubbles */
  _optimistic?: boolean;
  _optimistic_status?: "sending" | "failed";
}

export type WhatsAppMediaSendType =
  | "image"
  | "video"
  | "audio"
  | "voice"
  | "document"
  | "sticker";

export type WhatsAppCallDirection = "inbound" | "outbound";
export type WhatsAppCallType = "audio" | "video";
export type WhatsAppCallMode = "baileys_signal" | "cloud_webrtc" | "linked_device_handoff";
export type WhatsAppCallStatus =
  | "ringing"
  | "offer"
  | "pre_accepted"
  | "connected"
  | "accept"
  | "rejected"
  | "reject"
  | "missed"
  | "timeout"
  | "ended"
  | "terminate"
  | "failed";

export interface WhatsAppCallLog {
  id?: string;
  account_id: string;
  call_id: string;
  chat_jid?: string | null;
  peer_jid?: string | null;
  peer_phone?: string | null;
  peer_name?: string | null;
  direction: WhatsAppCallDirection | string;
  call_type: WhatsAppCallType | string;
  call_mode?: WhatsAppCallMode | string;
  status: WhatsAppCallStatus | string;
  duration_seconds?: number;
  sdp_offer?: string | null;
  sdp_answer?: string | null;
  started_at?: string | null;
  ended_at?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at?: string | null;
}

export interface WhatsAppOutboundCallResult {
  call_id: string;
  mode: WhatsAppCallMode | string;
  status?: WhatsAppCallStatus | string;
  wa_deep_link?: string | null;
  wa_call_deep_link?: string | null;
  wa_web_link?: string | null;
  note?: string | null;
  protocol_note?: string | null;
  sdp_answer?: string | null;
  call?: WhatsAppCallLog | null;
  call_log?: WhatsAppCallLog | null;
}

export interface WhatsAppQuickReply {
  id: string;
  id_member?: string;
  shortcut: string;
  title: string;
  content: string;
  category?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface WhatsAppGroupParticipant {
  id?: string;
  jid?: string;
  phone_number?: string | null;
  name?: string | null;
  admin?: "admin" | "superadmin" | string | null;
}

export interface WhatsAppGroupInfo {
  chat_jid: string;
  subject?: string | null;
  description?: string | null;
  owner_jid?: string | null;
  owner?: string | null;
  participant_count?: number;
  size?: number;
  participants: WhatsAppGroupParticipant[];
}

export interface WhatsAppPresenceState {
  chat_jid: string;
  participant_jid?: string | null;
  state: "composing" | "recording" | "available" | "unavailable" | "paused" | string;
  updated_at: number;
}

export interface WhatsAppSseAccountStatusPayload {
  account_id: string;
  status?: WhatsAppAccountStatus | string;
  qr_data_url?: string | null;
  pairing_code?: string | null;
  phone_number?: string | null;
  display_name?: string | null;
  has_proxy?: boolean;
  proxy_masked?: string | null;
  last_error?: string | null;
  account?: WhatsAppAccount | null;
}

export interface WhatsAppSseMessagePayload {
  account_id: string;
  chat_jid?: string;
  message?: WhatsAppMessage;
  [key: string]: unknown;
}

export interface WhatsAppSseMessageUpdatePayload {
  account_id: string;
  chat_jid?: string;
  message_id: string;
  ack_status?: string;
  is_deleted?: boolean;
  is_edited?: boolean;
  text?: string | null;
  reactions?: WhatsAppReaction[];
  reaction?: { sender_jid?: string; emoji: string };
  message?: WhatsAppMessage | null;
}

export interface WhatsAppSseConversationUpdatePayload {
  account_id: string;
  action?: string;
  chat_jid?: string;
  conversation?: WhatsAppConversation;
  [key: string]: unknown;
}

export interface WhatsAppSsePresencePayload {
  account_id: string;
  chat_jid: string;
  participant_jid?: string | null;
  state: string;
}

export interface WhatsAppSseCallEventPayload {
  account_id: string;
  sub_event?: string;
  call_id: string;
  chat_jid?: string | null;
  caller_jid?: string | null;
  peer_jid?: string | null;
  caller_pn?: string | null;
  caller_phone?: string | null;
  peer_phone?: string | null;
  peer_name?: string | null;
  caller_name?: string | null;
  direction?: WhatsAppCallDirection | string;
  call_type?: WhatsAppCallType | string;
  call_mode?: WhatsAppCallMode | string;
  is_video?: boolean;
  offline?: boolean;
  can_webrtc_answer?: boolean;
  status?: WhatsAppCallStatus | string;
  event_type?: string;
  sdp_offer?: string | null;
  sdp_answer?: string | null;
  call_answer_sdp?: string | null;
  duration_seconds?: number;
  call?: WhatsAppCallLog | null;
  call_log?: WhatsAppCallLog | null;
}
