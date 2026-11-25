/**
 * Bộ chuẩn hoá & giải mã tin nhắn cuộc gọi Zalo (read-time UI parser).
 *
 * Khớp 100% đặc tả gốc của Zalo PC (module r6Qt / STR_CALL_TITLE_*):
 * - msgType: "chat.recommended" (hoặc call.voice / call.video)
 * - content.action:
 *     - "recommened.misscall"    (cuộc gọi nhỡ / bị từ chối / đã hủy / bận)
 *     - "recommened.calltime"    (cuộc gọi đã kết nối có thời lượng)
 *     - "recommened.calling"     (cuộc gọi đi)
 *     - "recommened.receivecall" (cuộc gọi đến)
 *     (Hỗ trợ cả typo gốc "recommened.*" của Zalo lẫn "recommended.*")
 * - content.params (JSON string hoặc object):
 *     - callId: number | string
 *     - duration: number (giây; fallback tự xử lý nếu là ms > 86400)
 *     - reason:
 *         0 = DEFAULT (không trả lời / nhỡ)
 *         1 = CALLEE_BUSY (Người nhận bận)
 *         2 = TIMEOUT_HAVE_RINGING (Không trả lời / nhỡ)
 *         3 = CALLEE_REJECT (Từ chối)
 *         4 = CALLER_REJECT_HAVE_RINGING (Người gọi đã hủy)
 *         5 = CALLER_REJECT_NOT_RINGING (Người gọi đã hủy)
 *     - isCaller: 1 | 0 | boolean
 *     - calltype: 1 (hoặc 3) = video, 0 = thoại (audio)
 *     - isEnableCallback: 1 | 0 | boolean
 * - Hỗ trợ hồi tố 100% các row lịch sử cũ trong DB nơi `raw_content` bị null
 *   và chỉ còn `content === "sendBubbleMessage"`.
 */

export type ZaloCallDirection = "incoming" | "outgoing";
export type ZaloCallMediaType = "audio" | "video";
export type ZaloCallStatus = "completed" | "missed" | "rejected" | "cancelled" | "busy";

export interface ZaloCallMessageInfo {
  direction: ZaloCallDirection;
  mediaType: ZaloCallMediaType;
  status: ZaloCallStatus;
  /** Tiêu đề chính hiển thị trên thẻ cuộc gọi (vd: "Cuộc gọi thoại nhỡ", "Cuộc gọi thoại đến", "Cuộc gọi thoại đi") */
  title: string;
  /** Phụ đề ngắn hiển thị dưới tiêu đề (vd: "Bạn bị nhỡ", "1 phút 24 giây", "Người nhận bận") */
  subtitle: string;
  /** Nhãn gọn dùng cho sidebar preview / reply quote (vd: "Cuộc gọi thoại nhỡ", "Cuộc gọi thoại đến (01:24)") */
  previewLabel: string;
  /** Thời lượng tính bằng giây (0 nếu nhỡ / chưa có) */
  durationSec: number;
  /** Thời lượng format sẵn dạng "01:24" (rỗng nếu 0) */
  durationClock: string;
  /** Thời lượng tiếng Việt dạng "1 phút 24 giây" (rỗng nếu 0) */
  durationHuman: string;
  /** Cho phép hiện nút "Gọi lại" trên thẻ */
  enableCallback: boolean;
  /** Có phải cuộc gọi nhỡ (cần nhấn mạnh màu đỏ giống Zalo) */
  isMissed: boolean;
  /** Mã callId gốc của Zalo (nếu có) */
  callId?: string;
  /** Mã reason gốc của Zalo (0..5) */
  reasonCode?: number;
  /** Action gốc (vd: "recommened.misscall") */
  rawAction?: string;
}

type RawRecord = Record<string, unknown>;

export interface ZaloCallParseInput {
  type?: string | null;
  msg_kind?: string | null;
  content?: string | null;
  is_sent?: boolean | null;
  raw_content?: unknown;
}

const CALL_ACTION_RE = /^(?:recommened|recommended)\.(?:misscall|calltime|calling|receivecall|groupcall|audiocall|videocall|voicecall|call)$/i;

function asObj(val: unknown): RawRecord | null {
  if (!val) return null;
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return parsed as RawRecord;
        }
        if (Array.isArray(parsed) && parsed[0] && typeof parsed[0] === "object") {
          return parsed[0] as RawRecord;
        }
      } catch {
        return null;
      }
    }
    return null;
  }
  if (Array.isArray(val)) {
    return val[0] && typeof val[0] === "object" ? (val[0] as RawRecord) : null;
  }
  if (typeof val === "object") {
    return val as RawRecord;
  }
  return null;
}

function parseJsonRecord(val: unknown): RawRecord {
  return asObj(val) || {};
}

function toFiniteNumber(val: unknown): number | undefined {
  if (val === null || val === undefined || val === "") return undefined;
  const n = Number(val);
  return Number.isFinite(n) ? n : undefined;
}

function normalizeDurationSec(rawDuration: unknown): number {
  const n = toFiniteNumber(rawDuration);
  if (n === undefined || n <= 0) return 0;
  // Zalo chat.recommended lưu duration bằng GIÂY (theo generateCallMsgTemplate: Math.floor(ms/1000)).
  // Nếu gặp payload cũ > 86400 (1 ngày bằng giây), coi là mili-giây và quy đổi về giây.
  if (n > 86400) {
    return Math.max(1, Math.round(n / 1000));
  }
  return Math.round(n);
}

export function formatCallDurationClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) {
    return `${hours}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function formatCallDurationHuman(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) {
    return mins > 0 ? `${hours} giờ ${mins} phút` : `${hours} giờ`;
  }
  if (mins > 0) {
    return secs > 0 ? `${mins} phút ${secs} giây` : `${mins} phút`;
  }
  return `${secs} giây`;
}

/**
 * Unwrap envelope `raw_content` của `zca_persistent_listener.js` (`{ data: { content: {...}, msgType }, isSelf }`)
 * hoặc `raw_content` phẳng (`{ action, params, title, description }`).
 */
function unwrapCallEnvelope(rawContent: unknown): {
  envelope: RawRecord | null;
  dataObj: RawRecord | null;
  inner: RawRecord | null;
} {
  const envelope = asObj(rawContent);
  if (!envelope) return { envelope: null, dataObj: null, inner: null };

  const dataObj = asObj(envelope.data);
  const innerFromData = dataObj ? asObj(dataObj.content) : null;
  if (innerFromData) {
    return { envelope, dataObj, inner: innerFromData };
  }

  const innerFromEnv = asObj(envelope.content);
  if (innerFromEnv) {
    return { envelope, dataObj: envelope, inner: innerFromEnv };
  }

  return { envelope, dataObj: dataObj || envelope, inner: dataObj || envelope };
}

/** Kiểm tra nhanh một chuỗi thô có phải placeholder `sendBubbleMessage` của Zalo không. */
export function isSendBubblePlaceholder(text?: string | null): boolean {
  if (!text) return false;
  return text.trim().toLowerCase() === "sendbubblemessage";
}

/**
 * Phân tích 1 tin nhắn Zalo xem có phải tin nhắn cuộc gọi hay không.
 * Trả về `null` nếu là tin nhắn thường (text, ảnh, link, file, danh thiếp...).
 * Cố ý chặt chẽ để KHÔNG bao giờ nhận nhầm tin nhắn chat bình thường nhắc đến từ "cuộc gọi".
 */
export function parseZaloCallMessage(input: ZaloCallParseInput | null | undefined): ZaloCallMessageInfo | null {
  if (!input) return null;

  const contentText = typeof input.content === "string" ? input.content.trim() : "";
  const msgType = String(input.msg_kind || input.type || "").trim().toLowerCase();
  const { envelope, dataObj, inner } = unwrapCallEnvelope(input.raw_content);

  const rawMsgType = String(dataObj?.msgType || envelope?.msgType || "").trim().toLowerCase();
  const action = String(inner?.action || dataObj?.action || envelope?.action || "").trim();
  const actionLower = action.toLowerCase();
  const innerTitle = typeof inner?.title === "string" ? inner.title.trim() : "";
  const innerDesc = typeof inner?.description === "string" ? inner.description.trim() : "";
  const params = parseJsonRecord(inner?.params ?? dataObj?.params ?? envelope?.params);

  // Xác định điều kiện chắc chắn là tin nhắn cuộc gọi Zalo
  const hasCallAction =
    CALL_ACTION_RE.test(actionLower) ||
    actionLower.includes("misscall") ||
    actionLower.includes("calltime") ||
    actionLower.includes("receivecall") ||
    actionLower === "recommened.calling" ||
    actionLower === "recommended.calling" ||
    actionLower.includes("voicecall") ||
    actionLower.includes("videocall") ||
    actionLower.includes("groupcall");

  const hasCallMsgType =
    msgType === "call" ||
    msgType.startsWith("call.") ||
    msgType.endsWith(".call") ||
    msgType.includes("voicecall") ||
    msgType.includes("videocall") ||
    rawMsgType.startsWith("call.") ||
    rawMsgType.includes("voicecall") ||
    rawMsgType.includes("videocall");

  const hasCallParams =
    params.callId !== undefined ||
    params.call_id !== undefined ||
    params.calltype !== undefined ||
    params.callType !== undefined ||
    params.isEnableCallback !== undefined ||
    params.isCaller !== undefined;

  const isPlaceholderBubble =
    isSendBubblePlaceholder(contentText) || isSendBubblePlaceholder(innerTitle);

  const isRecommendedOrCallType =
    msgType === "chat.recommended" ||
    rawMsgType === "chat.recommended" ||
    hasCallMsgType ||
    !msgType ||
    msgType === "unknown";

  const isExactCallLabelInRecommended =
    isRecommendedOrCallType &&
    !inner?.href &&
    /^(cuộc gọi(\s+(thoại|video))?(\s+(đến|đi|nhỡ|bị từ chối|đã hủy))?|bạn bị nhỡ|bạn đã hủy|bạn đã từ chối|người nhận bận|người nhận từ chối)$/i.test(
      contentText || innerTitle,
    );

  const isCallMessage =
    hasCallAction ||
    hasCallMsgType ||
    isPlaceholderBubble ||
    (hasCallParams && (isRecommendedOrCallType || innerDesc.toLowerCase().includes("cuộc gọi"))) ||
    isExactCallLabelInRecommended;

  if (!isCallMessage) return null;

  // 1. Xác định chiều cuộc gọi (outgoing = gọi đi, incoming = gọi đến)
  // Khớp Zalo PC r6Qt: ưu tiên params.isCaller -> action -> raw.isSelf -> input.is_sent
  let isCaller: boolean;
  if (params.isCaller !== undefined && params.isCaller !== null) {
    isCaller = params.isCaller === 1 || params.isCaller === "1" || params.isCaller === true;
  } else if (actionLower === "recommened.calling" || actionLower === "recommended.calling") {
    isCaller = true;
  } else if (actionLower === "recommened.receivecall" || actionLower === "recommended.receivecall") {
    isCaller = false;
  } else if (typeof envelope?.isSelf === "boolean") {
    isCaller = envelope.isSelf;
  } else if (typeof input.is_sent === "boolean") {
    isCaller = input.is_sent;
  } else {
    isCaller = false;
  }
  const direction: ZaloCallDirection = isCaller ? "outgoing" : "incoming";

  // 2. Xác định loại cuộc gọi (audio vs video)
  // Khớp Zalo PC r6Qt: calltype === 1 là VIDEO (kèm hỗ trợ callType === 3 của VoIP Web và keyword video)
  const rawCallType = toFiniteNumber(params.calltype ?? params.callType ?? inner?.calltype);
  const isVideo =
    rawCallType === 1 ||
    rawCallType === 3 ||
    actionLower.includes("video") ||
    msgType.includes("video") ||
    rawMsgType.includes("video") ||
    /video/i.test(innerDesc) ||
    /video/i.test(contentText);
  const mediaType: ZaloCallMediaType = isVideo ? "video" : "audio";
  const mediaWord = isVideo ? "video" : "thoại";

  // 3. Thời lượng & reason code
  const durationSec = normalizeDurationSec(params.duration ?? inner?.duration ?? dataObj?.duration);
  const durationClock = formatCallDurationClock(durationSec);
  const durationHuman = formatCallDurationHuman(durationSec);
  const reasonCode = toFiniteNumber(params.reason ?? inner?.reason);

  // 4. Xác định trạng thái chuẩn theo Zalo PC r6Qt
  const isMissAction =
    actionLower.includes("misscall") ||
    /nhỡ|từ chối|đã hủy|bận|missed|rejected|cancel/i.test(contentText);

  let status: ZaloCallStatus;
  let title: string;
  let subtitle: string;

  const isLegacyBarePlaceholder =
    isPlaceholderBubble && !hasCallAction && !hasCallParams && durationSec === 0;

  if (isLegacyBarePlaceholder) {
    // Bản ghi lịch sử cũ (không có raw_content, chỉ còn content="sendBubbleMessage")
    status = direction === "outgoing" ? "completed" : "completed";
    title = direction === "outgoing" ? `Cuộc gọi ${mediaWord} đi` : `Cuộc gọi ${mediaWord} đến`;
    subtitle = "Cuộc gọi Zalo";
  } else if (isMissAction && durationSec === 0) {
    if (direction === "outgoing") {
      if (reasonCode === 4 || reasonCode === 5) {
        status = "cancelled";
        title = "Bạn đã hủy";
        subtitle = `Cuộc gọi ${mediaWord} đi`;
      } else if (reasonCode === 3) {
        status = "rejected";
        title = "Người nhận từ chối";
        subtitle = `Cuộc gọi ${mediaWord} đi`;
      } else if (reasonCode === 1) {
        status = "busy";
        title = "Người nhận bận";
        subtitle = `Cuộc gọi ${mediaWord} đi`;
      } else {
        status = "missed";
        title = `Cuộc gọi ${mediaWord} đi`;
        subtitle = "Không trả lời";
      }
    } else {
      // Cuộc gọi đến không nhấc máy (missed / rejected)
      if (reasonCode === 3) {
        status = "rejected";
        title = "Bạn đã từ chối";
        subtitle = `Cuộc gọi ${mediaWord} đến`;
      } else {
        status = "missed";
        title = isVideo ? "Cuộc gọi video nhỡ" : "Cuộc gọi thoại nhỡ";
        subtitle = "Bạn bị nhỡ";
      }
    }
  } else {
    // Cuộc gọi đã kết nối (recommened.calltime / calling / receivecall hoặc duration > 0)
    status = "completed";
    if (direction === "outgoing") {
      title = isVideo ? "Cuộc gọi video đi" : "Cuộc gọi thoại đi";
    } else {
      title = isVideo ? "Cuộc gọi video đến" : "Cuộc gọi thoại đến";
    }
    subtitle = durationHuman || (isVideo ? "Cuộc gọi video" : "Cuộc gọi thoại");
  }

  const isMissed = status === "missed" && direction === "incoming";

  // 5. Cho phép gọi lại (mặc định true trừ khi Zalo gửi rõ isEnableCallback = 0)
  const enableCallback =
    params.isEnableCallback === undefined || params.isEnableCallback === null
      ? true
      : params.isEnableCallback !== 0 && params.isEnableCallback !== "0" && params.isEnableCallback !== false;

  const callIdVal = params.callId ?? params.call_id;
  const callId = callIdVal !== undefined && callIdVal !== null ? String(callIdVal) : undefined;

  // 6. Nhãn gọn cho preview sidebar / reply quote
  let previewLabel: string;
  if (isMissed) {
    previewLabel = isVideo ? "Cuộc gọi video nhỡ" : "Cuộc gọi thoại nhỡ";
  } else if (status === "cancelled") {
    previewLabel = `Đã hủy cuộc gọi ${mediaWord}`;
  } else if (status === "rejected") {
    previewLabel = direction === "outgoing" ? "Người nhận từ chối cuộc gọi" : "Đã từ chối cuộc gọi";
  } else if (status === "busy") {
    previewLabel = "Người nhận đang bận";
  } else if (status === "missed" && direction === "outgoing") {
    previewLabel = `Cuộc gọi ${mediaWord} đi (Không trả lời)`;
  } else if (durationClock) {
    previewLabel = `${title} (${durationClock})`;
  } else {
    previewLabel = title;
  }

  return {
    direction,
    mediaType,
    status,
    title,
    subtitle,
    previewLabel,
    durationSec,
    durationClock,
    durationHuman,
    enableCallback,
    isMissed,
    callId,
    reasonCode,
    rawAction: action || undefined,
  };
}

/**
 * Chuẩn hoá chuỗi preview hội thoại ở sidebar (khi bảng `zalo_groups.last_message_content`
 * chỉ lưu text thô như "sendBubbleMessage").
 */
export function formatZaloSidebarPreview(
  rawText?: string | null,
  options?: { isSelf?: boolean; fallbackMessage?: ZaloCallParseInput | null },
): string {
  if (options?.fallbackMessage) {
    const parsed = parseZaloCallMessage(options.fallbackMessage);
    if (parsed) {
      const icon = parsed.isMissed ? "📵" : parsed.mediaType === "video" ? "📹" : "📞";
      return `${icon} ${parsed.previewLabel}`;
    }
  }
  const text = (rawText || "").trim();
  if (!text) return "";
  if (isSendBubblePlaceholder(text)) {
    return options?.isSelf ? "📞 Cuộc gọi đi" : "📞 Cuộc gọi đến / nhỡ";
  }
  return text;
}
