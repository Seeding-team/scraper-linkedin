/**
 * TypeScript Contracts & Shared Constants for:
 *  - Inbox SLA Monitor (/all-platform/sla-monitor)
 *  - Node.js Zalo Group Alert Forward Engine
 *  - Live SLA Badges (Zalo Inbox & Omnichannel Inbox)
 *
 * Synced 100% with migration 243 (`inbox_sla_configs`, `inbox_sla_turns`,
 * `inbox_alert_forward_configs`, `inbox_alert_forward_logs`) and backend
 * `/api/all-platform/sla-alerts/*` endpoints.
 */

export type SlaChannel = "zalo" | "messenger" | "telegram" | "whatsapp" | "email";
export type SlaChannelFilter = "all" | SlaChannel;
export type SlaTurnStatus = "waiting" | "met" | "breached" | "dismissed";
export type SlaLiveState = "ok" | "warning" | "breached";
export type AlertForwardMode = "new_turn_only" | "every_batch";
export type AlertLogType = "new_message" | "sla_warning" | "sla_breach" | "test";
export type AlertLogStatus = "sent" | "dry_run" | "failed" | "skipped" | "rate_limited";

export interface SlaShift {
  start: string; // HH:mm
  end: string; // HH:mm
}

export interface SlaConfig {
  id?: string;
  scope_key: string; // 'global' | 'channel:zalo' | 'channel:messenger' | ... | 'account:<ch>:<id>'
  target_minutes: number;
  warning_pct: number;
  business_hours_enabled: boolean;
  timezone: string;
  work_days: number[]; // ISO weekday: 1=Mon .. 7=Sun
  shifts: SlaShift[];
  include_group_chats: boolean;
  exclude_bot_replies: boolean;
  updated_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface SlaConfigBundle {
  global: SlaConfig;
  overrides: SlaConfig[];
}

export interface SlaDashboardRange {
  start_date?: string;
  end_date?: string;
  start?: string;
  end?: string;
  channel?: string;
}

export interface SlaDashboardKpis {
  total_turns: number;
  met_count: number;
  breached_count: number;
  waiting_count: number;
  waiting_breached_count: number;
  waiting_warning_count: number;
  sla_compliance_pct: number;
  avg_frt_seconds: number;
  avg_response_seconds: number;
  p50_response_seconds: number;
  p90_response_seconds: number;
}

export interface SlaChannelStat {
  channel: string;
  total: number;
  met: number;
  breached: number;
  waiting: number;
  compliance_pct: number;
  avg_response_seconds: number;
}

export interface SlaStaffStat {
  user_id: string | null;
  email: string | null;
  name: string | null;
  total: number;
  met: number;
  breached: number;
  compliance_pct: number;
  avg_response_seconds: number;
  p90_response_seconds: number;
}

export interface SlaDailyTrendPoint {
  day: string; // YYYY-MM-DD
  total: number;
  met: number;
  breached: number;
  compliance_pct: number;
  avg_response_seconds: number;
}

export interface SlaDashboardData {
  range: SlaDashboardRange;
  kpis: SlaDashboardKpis;
  by_channel: SlaChannelStat[];
  by_staff: SlaStaffStat[];
  daily_trend: SlaDailyTrendPoint[];
}

export interface SlaTurn {
  id: string;
  channel: SlaChannel | string;
  account_id: string;
  account_name?: string | null;
  conversation_id: string;
  customer_name?: string | null;
  customer_phone?: string | null;
  thread_type?: "direct" | "group" | string;
  customer_msg_at: string;
  last_customer_msg_at?: string | null;
  unanswered_msg_count: number;
  first_msg_preview?: string | null;
  last_msg_preview?: string | null;
  staff_reply_at?: string | null;
  deadline_at?: string | null;
  raw_response_seconds?: number | null;
  business_response_seconds?: number | null;
  target_seconds: number;
  is_first_turn?: boolean;
  status: SlaTurnStatus;
  assigned_user_id?: string | null;
  responded_by_user_id?: string | null;
  responded_by_email?: string | null;
  responded_by_name?: string | null;
  warning_notified_at?: string | null;
  breach_notified_at?: string | null;
  dismiss_reason?: string | null;
  dismissed_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  // Computed live fields returned by GET /turns
  current_wait_business_seconds?: number | null;
  live_state?: SlaLiveState | null;
  open_url?: string | null;
}

export interface SlaTurnsListData {
  items: SlaTurn[];
  total: number;
}

export interface JsEngineStats {
  pending_debounce?: number;
  queued_jobs?: number;
  sent_total?: number;
  failed_total?: number;
  coalesced_total?: number;
  rate_limited_total?: number;
  active_sessions?: number;
}

export interface JsEngineStatus {
  running?: boolean;
  alive?: boolean;
  status?: string;
  mode?: string;
  restarts?: number;
  pid?: number | null;
  uptime_ms?: number | null;
  started_at?: string | null;
  stats?: JsEngineStats | null;
  error?: string | null;
  last_error?: string | null;
}

export interface LiveSlaBadge {
  id?: string;
  turn_id?: string;
  channel: string;
  account_id: string;
  account_name?: string | null;
  conversation_id: string;
  customer_name?: string | null;
  customer_msg_at?: string;
  last_customer_msg_at?: string | null;
  deadline_at?: string | null;
  target_seconds: number;
  wait_business_seconds: number;
  current_wait_business_seconds?: number;
  unanswered_msg_count?: number;
  state: SlaLiveState;
  live_state?: SlaLiveState;
  open_url?: string | null;
}

export interface LiveSlaBadgesResponse {
  items: LiveSlaBadge[];
  engine_status?: JsEngineStatus | null;
}

export interface AlertForwardConfig {
  id: string;
  name: string;
  is_enabled: boolean;
  dry_run: boolean;
  notifier_zalo_account_id: string;
  notifier_zalo_account_name?: string | null;
  target_zalo_group_id: string;
  target_zalo_group_name?: string | null;
  channels: string[];
  source_account_ids: string[];
  include_group_chats: boolean;
  excluded_conversation_ids: string[];
  alert_mode: AlertForwardMode;
  debounce_seconds: number;
  cooldown_minutes: number;
  notify_new_message: boolean;
  notify_sla_warning: boolean;
  notify_sla_breach: boolean;
  forward_images: boolean;
  mention_all_on_breach: boolean;
  mention_zalo_uids?: unknown[];
  new_message_template?: string | null;
  sla_breach_template?: string | null;
  created_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface AlertForwardConfigCreatePayload {
  name: string;
  is_enabled?: boolean;
  dry_run?: boolean;
  notifier_zalo_account_id: string;
  notifier_zalo_account_name?: string | null;
  target_zalo_group_id: string;
  target_zalo_group_name?: string | null;
  channels: string[];
  source_account_ids?: string[];
  include_group_chats?: boolean;
  excluded_conversation_ids?: string[];
  alert_mode?: AlertForwardMode;
  debounce_seconds?: number;
  cooldown_minutes?: number;
  notify_new_message?: boolean;
  notify_sla_warning?: boolean;
  notify_sla_breach?: boolean;
  forward_images?: boolean;
  mention_all_on_breach?: boolean;
  mention_zalo_uids?: unknown[];
  new_message_template?: string | null;
  sla_breach_template?: string | null;
}

export type AlertForwardConfigUpdatePayload = Partial<AlertForwardConfigCreatePayload>;

export interface AlertForwardConfigsResponse {
  items: AlertForwardConfig[];
  engine_status?: JsEngineStatus | null;
}

export interface AlertForwardTestResult {
  sent: boolean;
  dry_run: boolean;
  via?: string | null;
  latency_ms?: number | null;
  rendered_text?: string | null;
  error?: string | null;
}

export interface ZaloGroupOption {
  group_id: string;
  name: string;
  avatar_url?: string | null;
}

export interface AlertForwardLog {
  id: number | string;
  config_id?: string | null;
  alert_type: AlertLogType | string;
  channel: string;
  source_account_id?: string | null;
  source_conversation_id?: string | null;
  sla_turn_id?: string | null;
  target_zalo_group_id?: string | null;
  rendered_text?: string | null;
  status: AlertLogStatus | string;
  via?: "js_engine" | "python_fallback" | string | null;
  latency_ms?: number | null;
  error?: string | null;
  created_at: string;
}

export interface SlaBackfillResult {
  processed_messages: number;
  turns_created: number;
  by_channel: Record<string, number | { processed_messages?: number; turns_created?: number }>;
}

// ─── Shared UI Metadata & Formatters ─────────────────────────────────────────

export const PRIMARY_SLA_CHANNELS: ReadonlyArray<{
  id: Exclude<SlaChannel, "email">;
  label: string;
  short: string;
  color: string;
  badgeClass: string;
}> = [
  {
    id: "zalo",
    label: "Zalo",
    short: "ZL",
    color: "#0068FF",
    badgeClass: "bg-blue-50 text-blue-700 border-blue-200",
  },
  {
    id: "messenger",
    label: "Messenger",
    short: "FB",
    color: "#1877F2",
    badgeClass: "bg-indigo-50 text-indigo-700 border-indigo-200",
  },
  {
    id: "telegram",
    label: "Telegram",
    short: "TG",
    color: "#229ED9",
    badgeClass: "bg-sky-50 text-sky-700 border-sky-200",
  },
  {
    id: "whatsapp",
    label: "WhatsApp",
    short: "WA",
    color: "#16a34a",
    badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
];

export const CHANNEL_META: Readonly<
  Record<string, { label: string; short: string; color: string; badgeClass: string }>
> = {
  zalo: PRIMARY_SLA_CHANNELS[0],
  messenger: PRIMARY_SLA_CHANNELS[1],
  facebook: PRIMARY_SLA_CHANNELS[1],
  telegram: PRIMARY_SLA_CHANNELS[2],
  whatsapp: PRIMARY_SLA_CHANNELS[3],
  email: {
    label: "Email",
    short: "EM",
    color: "#d97706",
    badgeClass: "bg-amber-50 text-amber-700 border-amber-200",
  },
};

export function getChannelMeta(channel?: string | null) {
  const key = (channel || "").trim().toLowerCase();
  return (
    CHANNEL_META[key] || {
      label: channel || "Khác",
      short: (channel || "??").slice(0, 2).toUpperCase(),
      color: "#64748b",
      badgeClass: "bg-slate-100 text-slate-700 border-slate-200",
    }
  );
}

export function normalizeSlaChannel(channel?: string | null): string {
  const raw = (channel || "").trim().toLowerCase();
  if (raw === "facebook" || raw === "fb" || raw === "fb_messenger") return "messenger";
  return raw;
}

export function formatDurationVi(seconds?: number | null): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "—";
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const mins = Math.floor(s / 60);
  const remSec = s % 60;
  if (mins < 60) {
    return remSec > 0 ? `${mins}p ${remSec}s` : `${mins}p`;
  }
  const hours = Math.floor(mins / 60);
  const remMin = mins % 60;
  if (hours < 24) {
    return remMin > 0 ? `${hours}g ${remMin}p` : `${hours}g`;
  }
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days}n ${remHours}g` : `${days}n`;
}

export function formatShortWaitBadge(seconds?: number | null): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "0p";
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const mins = Math.floor(s / 60);
  if (mins < 60) return `${mins}p`;
  const hours = Math.floor(mins / 60);
  const remMin = mins % 60;
  return remMin > 0 ? `${hours}g${remMin}p` : `${hours}g`;
}

export function formatDateTimeVn(iso?: string | null): string {
  if (!iso) return "—";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  return new Date(ms).toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Asia/Ho_Chi_Minh",
  });
}

export function formatTimeVn(iso?: string | null): string {
  if (!iso) return "—";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  return new Date(ms).toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Ho_Chi_Minh",
  });
}

export function isJsEngineOnline(status?: JsEngineStatus | null): boolean {
  if (!status) return false;
  if (typeof status.running === "boolean") return status.running;
  if (typeof status.alive === "boolean") return status.alive;
  if (typeof status.status === "string") {
    return ["running", "online", "ready", "ok", "live"].includes(status.status.toLowerCase());
  }
  return Boolean(status.pid);
}

export const DEFAULT_SLA_CONFIG: SlaConfig = {
  scope_key: "global",
  target_minutes: 5,
  warning_pct: 70,
  business_hours_enabled: true,
  timezone: "Asia/Ho_Chi_Minh",
  work_days: [1, 2, 3, 4, 5, 6],
  shifts: [
    { start: "08:00", end: "12:00" },
    { start: "13:30", end: "17:30" },
  ],
  include_group_chats: false,
  exclude_bot_replies: true,
};

export const DEFAULT_NEW_MESSAGE_TEMPLATE =
  "🔔 [TIN MỚI - {{channel}}]\n" +
  "👤 Khách: {{customer_name}} ({{customer_phone}})\n" +
  "📱 Kênh/TK: {{account_name}}\n" +
  "💬 Nội dung: \"{{content}}\"{{extra_count_text}}\n" +
  "⏱ Lúc: {{time_vn}} · Hạn SLA ({{sla_minutes}}p): {{deadline_vn}}\n" +
  "🔗 Mở xử lý: {{open_url}}";

export const DEFAULT_SLA_BREACH_TEMPLATE =
  "🚨 [QUÁ HẠN SLA - {{channel}}]\n" +
  "👤 Khách: {{customer_name}} ({{customer_phone}})\n" +
  "📱 Kênh/TK: {{account_name}}\n" +
  "⏳ Đã chờ: {{wait_text}} (Mục tiêu {{sla_minutes}}p)\n" +
  "💬 Tin gần nhất: \"{{content}}\"\n" +
  "🔗 Xử lý ngay: {{open_url}}";

export function renderAlertTemplatePreview(
  template: string | null | undefined,
  fallback: string,
  sample: Record<string, string>,
): string {
  const src = (template && template.trim()) || fallback;
  return src.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => {
    return key in sample ? sample[key] : `{{${key}}}`;
  });
}
