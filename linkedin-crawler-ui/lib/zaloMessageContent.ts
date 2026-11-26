/**
 * Chuẩn hoá nội dung & đính kèm của 1 row `zalo_messages` ở tầng ĐỌC (read-time),
 * hỗ trợ hồi tố 100% dữ liệu lịch sử (kể cả khi `msg_kind` là NULL, bị gán nhầm
 * thành raw Zalo `msgType` như `"webchat"`/`"image"`, hoặc `raw_content` là chuỗi
 * JSON / envelope `{ data: { msgType, content }, isSelf }`).
 *
 * Quy chuẩn 2 tầng: khớp tuyệt đối với Zalo PC native (`app.asar` v26.11.12) và
 * skill `zalo-message-normalization`. KHÔNG bao giờ xuất chuỗi fallback xấu như
 * `"sendBubbleMessage"`, JSON thô `{...}`, hay `"— mở Zalo để xem"`.
 */

import {
  formatZaloSidebarPreview,
  isSendBubblePlaceholder,
  parseZaloCallMessage,
  type ZaloCallMessageInfo,
} from "./zaloCallMessage";
import {
  extractFreeTextBankAccounts,
  extractUrlsFromText,
  extractVietnamesePhones,
  formatMsgInfoActionList,
  formatZaloAnySidebarPreview,
  formatZaloFriendEvent,
  formatZaloGroupEvent,
  lookupVietnamBankByBin,
  lookupVietnamBankByKeyword,
  VIETNAM_BANK_BINS,
  ZALO_SIDEBAR_BRACKET_LABELS,
  type ExtractedFreeTextBankAccount,
  type ExtractedVietnamesePhone,
  type ZaloSystemEventIconKind,
} from "./zaloMessageCatalog";

export {
  extractFreeTextBankAccounts,
  extractUrlsFromText,
  extractVietnamesePhones,
  formatMsgInfoActionList,
  formatZaloAnySidebarPreview,
  formatZaloFriendEvent,
  formatZaloGroupEvent,
  lookupVietnamBankByBin,
  lookupVietnamBankByKeyword,
  VIETNAM_BANK_BINS,
  type ExtractedFreeTextBankAccount,
  type ExtractedVietnamesePhone,
  type ZaloSystemEventIconKind,
};

export type ZaloAttachmentKind =
  | "image"
  | "gif"
  | "video"
  | "voice"
  | "file"
  | "folder"
  | "link"
  | "sticker"
  | "location"
  | "contact"
  | "bankcard"
  | "call"
  | "ecard"
  | "poll"
  | "reminder"
  | "todo"
  | "doodle";

export type ZaloMessageKind =
  | ZaloAttachmentKind
  | "system_notice"
  | "undo"
  | "text"
  | "unknown";

export type ZaloLinkSubType =
  | "link"
  | "miniapp"
  | "minisite"
  | "oa"
  | "zvideo"
  | "article"
  | "post";

export type ZaloSystemEventCategory =
  | "friend"
  | "group"
  | "ecard"
  | "poll"
  | "reminder"
  | "todo"
  | "undo"
  | "info";

export interface ZaloSystemEventMeta {
  category: ZaloSystemEventCategory;
  act?: string;
  title: string;
  subtitle?: string;
  iconKind: ZaloSystemEventIconKind;
  ecardType?: number;
  thumb?: string;
  bannerUrl?: string;
  options?: string[];
  dueTime?: string | number;
}

export type ZaloAttachment = {
  kind: ZaloAttachmentKind;
  url?: string;
  thumb_url?: string;
  width?: number;
  height?: number;
  duration_ms?: number;
  size_bytes?: number;
  title?: string;
  description?: string;
  domain?: string;
  name?: string;
  ext?: string;
  checksum?: string;
  is_folder?: boolean;
  expired?: boolean;
  link_subtype?: ZaloLinkSubType;
  sticker_id?: number;
  cate_id?: number;
  sticker_type?: number;
  lat?: number;
  lon?: number;
  address?: string;
  avatar_url?: string;
  phone?: string;
  user_id?: string;
  qr_code_url?: string;
  // Thẻ tài khoản ngân hàng (zinstant.bankcard / templateId=11845)
  bank_name?: string;
  bank_short_name?: string;
  account_number?: string;
  account_name?: string;
  qr_url?: string;
  logo_url?: string;
  bg_url?: string;
  bin?: string;
  data_url?: string;
  // Thiệp eCard
  ecard_type?: number;
  banner_url?: string;
  // Cuộc gọi Zalo (recommened.misscall / calltime / calling / receivecall)
  call_info?: ZaloCallMessageInfo;
};

/** Row `zalo_messages` (chỉ những cột cần cho phân loại). */
export type StoredMessageRow = {
  msg_kind?: string | null;
  type?: string | null;
  is_sent?: boolean | null;
  is_deleted?: boolean | null;
  attachments?: unknown;
  raw_content?: unknown;
  image_urls?: unknown;
  content?: string | null;
};

export interface NormalizedZaloMessage {
  kind: ZaloMessageKind;
  /** Nội dung văn bản sạch (tuyệt đối không chứa sendBubbleMessage / JSON thô / "— mở Zalo để xem"). */
  text: string;
  attachments: ZaloAttachment[];
  /** Có mặt khi `kind === "call"`. */
  callInfo?: ZaloCallMessageInfo;
  /** Có mặt khi là thông báo hệ thống / kết bạn / nhóm / eCard / poll / reminder / todo / undo. */
  systemEvent?: ZaloSystemEventMeta;
  /** Tương thích ngược: alias của `systemEvent.title` khi là `system_notice`. */
  system_text?: string;
  /** Tương thích ngược: nhãn dự phòng sạch cho loại thẻ lạ (không có "— mở Zalo để xem"). */
  unknown_label?: string;
  /** Nhận diện thông minh trên tin nhắn văn bản thường. */
  inlineBanks: ExtractedFreeTextBankAccount[];
  inlinePhones: ExtractedVietnamesePhone[];
  inlineUrls: string[];
  /** Chuỗi xem trước sạch cho Sidebar & Quote Reply. */
  previewText: string;
  isRecalled: boolean;
}

type RawRecord = Record<string, unknown>;

const VIDEO_EXT_RE = /\.(mp4|mov|m4v|webm|mkv|avi|3gp|flv|wmv)(\?|#|$)/i;
const AUDIO_EXT_RE = /\.(m4a|mp3|aac|ogg|opus|wav|amr)(\?|#|$)/i;
const IMAGE_EXT_RE = /\.(jpe?g|png|webp|bmp|heic|heif|avif|jxl)(\?|#|$)/i;
const GIF_EXT_RE = /\.gif(\?|#|$)/i;
const HLS_EXT_RE = /\.m3u8(\?|#|$)/i;
const UGLY_FALLBACK_RE = /—\s*mở\s*zalo\s*để\s*xem|tin\s*nhắn\s*dạng\s*đặc\s*biệt/i;

/** Đủ 28 wire `msgType` chuẩn của Zalo PC + alias phổ biến → `ZaloMessageKind`. */
export const MSG_TYPE_KIND: Readonly<Record<string, ZaloMessageKind>> = {
  webchat: "text",
  text: "text",
  "chat.photo": "image",
  image: "image",
  "chat.gif": "gif",
  gif: "gif",
  "chat.sticker": "sticker",
  sticker: "sticker",
  "chat.doodle": "doodle",
  doodle: "doodle",
  "chat.video.msg": "video",
  video: "video",
  "chat.voice": "voice",
  voice: "voice",
  "share.file": "file",
  file: "file",
  folder: "folder",
  "chat.recommended": "link",
  "chat.link": "link",
  link: "link",
  "chat.zalo.me": "link",
  "chat.list.action": "link",
  "chat.location.new": "location",
  location: "location",
  "chat.contact": "contact",
  contact: "contact",
  group: "contact",
  "chat.webcontent": "bankcard",
  "chat.webcontent.v2": "bankcard",
  "zinstant.bankcard": "bankcard",
  bankcard: "bankcard",
  "chat.ecard": "system_notice",
  ecard: "ecard",
  "chat.undo": "undo",
  "chat.delete": "undo",
  "chat.delete.everyone": "undo",
  undo: "undo",
  "group.event": "system_notice",
  group_event: "system_notice",
  "group.leave": "system_notice",
  "friend.event": "system_notice",
  friend_event: "system_notice",
  system_notice: "system_notice",
  "chat.vanish": "system_notice",
  "chat.e2ee.replace": "system_notice",
  "group.poll": "system_notice",
  "chat.poll": "system_notice",
  poll: "poll",
  "chat.reminder": "system_notice",
  reminder: "reminder",
  "chat.todo": "system_notice",
  todo: "todo",
  call: "call",
  "chat.reaction": "text",
  "chat._jumpToMessage": "text",
};

/** URL dùng được: http(s) VÀ có path thật (loại placeholder domain trần). */
export function isUsableUrl(url: unknown): url is string {
  if (typeof url !== "string" || url.length === 0) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    return parsed.pathname.length > 1;
  } catch {
    return false;
  }
}

function firstUsableUrl(...values: unknown[]): string | undefined {
  for (const value of values) if (isUsableUrl(value)) return value;
  return undefined;
}

function firstPositiveNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return undefined;
}

function durationMs(...values: unknown[]): number | undefined {
  const n = firstPositiveNumber(...values);
  if (n === undefined) return undefined;
  return n < 1000 ? Math.round(n * 1000) : Math.round(n);
}

function firstText(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return undefined;
  }
}

function parseJsonSafe(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  const trimmed = raw.trim();
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return raw;
  try {
    return JSON.parse(trimmed);
  } catch {
    return raw;
  }
}

/** `content.params` của Zalo khi là object, khi là string JSON. */
function parseParams(params: unknown): RawRecord {
  if (!params) return {};
  if (typeof params === "object" && !Array.isArray(params)) return params as RawRecord;
  if (typeof params === "string") {
    try {
      const parsed: unknown = JSON.parse(params);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as RawRecord)
        : {};
    } catch {
      return {};
    }
  }
  return {};
}

function compact(obj: ZaloAttachment): ZaloAttachment {
  const out = {} as RawRecord;
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined || value === "") continue;
    out[key] = value;
  }
  return out as unknown as ZaloAttachment;
}

function extOf(name: unknown, url: unknown): string | undefined {
  const source = typeof name === "string" && name.includes(".") ? name : url;
  if (typeof source !== "string") return undefined;
  const match = source.split(/[?#]/)[0].match(/\.([a-z0-9]{1,8})$/i);
  return match ? match[1].toLowerCase() : undefined;
}

function isRawJsonText(text: string): boolean {
  const t = text.trim();
  if (!((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]")))) {
    return false;
  }
  try {
    const parsed: unknown = JSON.parse(t);
    return !!parsed && typeof parsed === "object";
  } catch {
    return false;
  }
}

function sanitizeDisplayText(rawText?: string | null): string {
  if (typeof rawText !== "string") return "";
  const trimmed = rawText.trim();
  if (!trimmed) return "";
  if (isSendBubblePlaceholder(trimmed)) return "";
  if (UGLY_FALLBACK_RE.test(trimmed)) return "";
  if (isRawJsonText(trimmed)) return "";
  return trimmed;
}

/**
 * Giải nén `raw_content` từ mọi hình dạng lưu trong Supabase:
 *   1. Chuỗi JSON (cần `JSON.parse`)
 *   2. Envelope `zca_persistent_listener.js`: `{ data: { msgType, content, dName, ... }, isSelf, threadId }`
 *   3. Object phẳng: `{ href, title, action, params, description, ... }`
 *   4. Mảng các item: `[item1, item2, ...]`
 */
interface UnwrappedEnvelope {
  parsedRoot: unknown;
  envelopeObj: RawRecord | null;
  dataObj: RawRecord | null;
  wireMsgType: string;
  innerItems: RawRecord[];
  innerFirst: RawRecord | null;
  plainInnerText: string | null;
}

function unwrapRawEnvelope(rawInput: unknown): UnwrappedEnvelope {
  const parsedRoot = parseJsonSafe(rawInput);

  if (!parsedRoot || typeof parsedRoot !== "object") {
    return {
      parsedRoot,
      envelopeObj: null,
      dataObj: null,
      wireMsgType: "",
      innerItems: [],
      innerFirst: null,
      plainInnerText: typeof parsedRoot === "string" ? parsedRoot : null,
    };
  }

  if (Array.isArray(parsedRoot)) {
    const items = parsedRoot
      .map((item) => parseJsonSafe(item))
      .filter((item): item is RawRecord => !!item && typeof item === "object" && !Array.isArray(item));
    const first = items[0] || null;
    return {
      parsedRoot,
      envelopeObj: first,
      dataObj: first,
      wireMsgType: firstText(first?.msgType)?.toLowerCase() || "",
      innerItems: items,
      innerFirst: first,
      plainInnerText: null,
    };
  }

  const envelopeObj = parsedRoot as RawRecord;
  const maybeData = parseJsonSafe(envelopeObj.data);
  const dataObj =
    maybeData && typeof maybeData === "object" && !Array.isArray(maybeData)
      ? (maybeData as RawRecord)
      : envelopeObj;

  const wireMsgType =
    firstText(dataObj.msgType, envelopeObj.msgType)?.toLowerCase() || "";

  const rawInner = dataObj.content !== undefined ? parseJsonSafe(dataObj.content) : undefined;
  if (typeof rawInner === "string") {
    return {
      parsedRoot,
      envelopeObj,
      dataObj,
      wireMsgType,
      innerItems: [],
      innerFirst: null,
      plainInnerText: rawInner,
    };
  }
  if (Array.isArray(rawInner)) {
    const items = rawInner
      .map((item) => parseJsonSafe(item))
      .filter((item): item is RawRecord => !!item && typeof item === "object" && !Array.isArray(item));
    return {
      parsedRoot,
      envelopeObj,
      dataObj,
      wireMsgType,
      innerItems: items,
      innerFirst: items[0] || null,
      plainInnerText: null,
    };
  }
  if (rawInner && typeof rawInner === "object") {
    const rec = rawInner as RawRecord;
    return {
      parsedRoot,
      envelopeObj,
      dataObj,
      wireMsgType,
      innerItems: [rec],
      innerFirst: rec,
      plainInnerText: null,
    };
  }

  // Trường hợp raw_content phẳng (không bọc data.content)
  return {
    parsedRoot,
    envelopeObj,
    dataObj,
    wireMsgType,
    innerItems: [dataObj],
    innerFirst: dataObj,
    plainInnerText: null,
  };
}

// ── Builders cho từng loại Attachment ─────────────────────────────────────────

function extractImageUrl(c: RawRecord): string | undefined {
  const p = parseParams(c.params);
  return firstUsableUrl(
    c.hdUrl,
    c.oriUrl,
    c.normalUrl,
    c.rawUrl,
    p.hd,
    p.hdUrl,
    p.oriUrl,
    p.normalUrl,
    p.rawUrl,
    c.href,
    c.thumbUrl,
    c.thumb,
    p.thumbUrl,
  );
}

function buildImage(c: RawRecord, kind: "image" | "gif" | "doodle"): ZaloAttachment | null {
  const p = parseParams(c.params);
  const url = extractImageUrl(c);
  if (!url) return null;
  const thumb = firstUsableUrl(c.thumbUrl, c.thumb, p.thumbUrl);
  return compact({
    kind,
    url,
    thumb_url: thumb && thumb !== url ? thumb : undefined,
    width: firstPositiveNumber(c.width, p.width),
    height: firstPositiveNumber(c.height, p.height),
    title: typeof c.title === "string" && !isUsableUrl(c.title) ? firstText(c.title) : undefined,
  });
}

function buildVideo(c: RawRecord): ZaloAttachment | null {
  const p = parseParams(c.params);
  const direct = firstUsableUrl(c.videoUrl, p.videoUrl, p.video_url, c.fileUrl, p.fileUrl, c.href);
  const hls = firstUsableUrl(p.m3u8_hls, p.hlsUrl, c.m3u8_hls);
  const url = direct && !HLS_EXT_RE.test(direct) ? direct : direct || hls;
  if (!url) return null;
  return compact({
    kind: "video",
    url,
    thumb_url: firstUsableUrl(c.thumbUrl, c.thumb, p.thumbUrl, p.thumb),
    duration_ms: durationMs(c.duration, p.duration),
    width: firstPositiveNumber(c.width, p.width, p.video_width),
    height: firstPositiveNumber(c.height, p.height, p.video_height),
    size_bytes: firstPositiveNumber(c.fileSize, p.fileSize, p.totalSize, c.totalSize),
    title: typeof c.title === "string" && !isUsableUrl(c.title) ? firstText(c.title) : undefined,
  });
}

function buildVoice(c: RawRecord): ZaloAttachment | null {
  const p = parseParams(c.params);
  const url = firstUsableUrl(c.voiceUrl, c.m4aUrl, p.voiceUrl, p.m4aUrl, c.href, c.fileUrl, p.fileUrl);
  if (!url) return null;
  return compact({
    kind: "voice",
    url,
    duration_ms: durationMs(c.duration, p.duration),
    size_bytes: firstPositiveNumber(c.fileSize, p.fileSize, p.totalSize),
  });
}

function isFolderParams(p: RawRecord): boolean {
  if (Number(p.fType) === 2 || p.isFolder === true) return true;
  const fdata = parseParams(p.fdata);
  if (Number(fdata.fType) === 2 || Number(fdata.type) === 2 && Number(p.fType) === 2) return true;
  return false;
}

function buildFile(c: RawRecord): ZaloAttachment | null {
  const p = parseParams(c.params);
  const url = firstUsableUrl(c.fileUrl, p.fileUrl, c.href);
  const folder = isFolderParams(p);

  const rawName = [c.fileName, p.fileName, c.title, p.title].find(
    (v) => typeof v === "string" && v.trim() && !isUsableUrl(v),
  ) as string | undefined;
  const rawExt =
    firstText(p.fileExt, p.extention, c.fileExt) || extOf(rawName, url);
  const ext = rawExt ? String(rawExt).toLowerCase().replace(/^\./, "") : undefined;

  let name = rawName ? rawName.trim().slice(0, 255) : undefined;
  // Quy tắc native Zalo PC (`_normalizeMessageJSON`): tự ghép `.fileExt` nếu title thiếu đuôi
  if (name && ext && !folder && !name.toLowerCase().endsWith(`.${ext}`)) {
    name = `${name}.${ext}`;
  }

  // Kể cả khi file đã hết hạn (không còn url) vẫn trả về card để hiển thị tên + "Tệp đã hết hạn trên Zalo"
  if (!url && !name) return null;

  return compact({
    kind: folder ? "folder" : "file",
    url,
    name: name || (folder ? "Thư mục" : "Tệp đính kèm"),
    ext: folder ? undefined : ext,
    size_bytes: firstPositiveNumber(c.fileSize, p.fileSize, p.totalSize, c.totalSize),
    checksum: firstText(p.checksum, c.checksum),
    is_folder: folder || undefined,
    expired: !url || p.expired === true || c.expired === true ? true : undefined,
  });
}

function resolveLinkSubType(action: string, p: RawRecord): ZaloLinkSubType {
  const act = action.toLowerCase();
  if (act === "recommened.miniapp") return "miniapp";
  if (act === "recommened.minisite") return "minisite";
  if (act === "recommened.oa") return "oa";
  if (act === "recommened.zvideo" || Number(p.type) === 10 || Number(p.type) === 11) return "zvideo";
  if (act === "recommened.article") return "article";
  if (act === "recommened.post") return "post";
  return "link";
}

function buildLink(c: RawRecord): ZaloAttachment | null {
  const p = parseParams(c.params);
  const url = firstUsableUrl(c.href, p.href, p.src, c.src);
  if (!url) return null;

  const mediaTitle = firstText(p.mediaTitle, p.title);
  const rawTitle = firstText(c.title);
  // Nếu `c.title` chỉ là URL trần (hoặc bắt đầu bằng URL kèm chú thích nhiều dòng),
  // ưu tiên `params.mediaTitle` cho tiêu đề thẻ Link!
  const titleIsJustUrl = rawTitle ? /^https?:\/\//i.test(rawTitle) : false;
  const cardTitle = mediaTitle || (!titleIsJustUrl ? rawTitle : undefined) || hostOf(url) || url;

  const action = firstText(c.action) || "";
  const linkSubType = resolveLinkSubType(action, p);

  return compact({
    kind: "link",
    url,
    title: cardTitle.slice(0, 300),
    description: firstText(c.description, c.desc, p.desc, p.description)?.slice(0, 500),
    thumb_url: firstUsableUrl(c.thumb, c.thumbUrl, p.thumb, p.thumbUrl),
    domain: hostOf(url) || firstText(p.src),
    link_subtype: linkSubType,
  });
}

/**
 * Dựng URL ảnh nhãn dán Zalo công khai (PNG/WebP 1 khung rõ nét, không cần cookie).
 * Lưu ý: endpoint Zalo dùng `/sticker/webpc?eid=...` (chữ `c`), còn `/sticker/webp` trả 404.
 */
export function buildZaloStickerCdnUrl(
  stickerId?: number | null,
  size = 130,
): string | undefined {
  if (typeof stickerId !== "number" || !Number.isFinite(stickerId) || stickerId <= 0) {
    return undefined;
  }
  const safeSize = Number.isFinite(size) && size > 0 ? Math.trunc(size) : 130;
  return `https://zalo-api.zadn.vn/api/emoticon/sticker/webpc?eid=${Math.trunc(stickerId)}&size=${safeSize}`;
}

const STICKER_PLACEHOLDER_RE = /^\[?(?:sticker|nhãn dán|bộ sticker)(?:\s*#(\d+))?\]?$/i;

function isStickerPlaceholderText(text?: string | null): boolean {
  if (!text) return false;
  return STICKER_PLACEHOLDER_RE.test(text.trim());
}

function extractStickerIdFromPlaceholder(text?: string | null): number | undefined {
  if (!text) return undefined;
  const match = text.trim().match(STICKER_PLACEHOLDER_RE);
  if (!match?.[1]) return undefined;
  const n = Number(match[1]);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : undefined;
}

function buildSticker(c: RawRecord): ZaloAttachment | null {
  const p = parseParams(c.params);
  const stickerId = firstPositiveNumber(
    c.id,
    c.stickerId,
    c.sticker_id,
    p.id,
    p.stickerId,
    p.sticker_id,
  );
  const explicitUrl = firstUsableUrl(
    c.stickerWebpUrl,
    c.stickerUrl,
    p.webpUrl,
    p.stickerWebpUrl,
    p.stickerUrl,
    c.staticUrl,
    c.animationUrl,
    c.thumb,
    c.normalUrl,
    c.hdUrl,
    c.url,
    c.href,
  );
  const url = explicitUrl || buildZaloStickerCdnUrl(stickerId);
  if (stickerId === undefined && !url) return null;
  const rawType = c.type ?? p.type;
  return compact({
    kind: "sticker",
    sticker_id: stickerId,
    cate_id: firstPositiveNumber(c.catId, c.cateId, c.cate_id, p.catId, p.cateId, p.cate_id),
    sticker_type: rawType !== undefined && rawType !== "" && Number.isFinite(Number(rawType))
      ? Number(rawType)
      : undefined,
    url,
  });
}

function buildLocation(c: RawRecord): ZaloAttachment | null {
  const p = parseParams(c.params);
  const lat = Number(c.latitude ?? c.lat ?? p.latitude ?? p.lat);
  const lon = Number(c.longitude ?? c.lon ?? c.lng ?? c.lo ?? p.longitude ?? p.lon ?? p.lng ?? p.lo);
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lon) && (lat !== 0 || lon !== 0);
  const url = firstUsableUrl(c.href, p.href);
  if (!hasCoords && !url) return null;
  return compact({
    kind: "location",
    lat: hasCoords ? lat : undefined,
    lon: hasCoords ? lon : undefined,
    url: url || (hasCoords ? `https://www.google.com/maps?q=${lat},${lon}` : undefined),
    title: firstText(c.title, p.title),
    address: firstText(c.addr, c.description, c.desc, p.address, p.addr),
    thumb_url: firstUsableUrl(c.thumb, p.thumb),
  });
}

/**
 * Bóc tách số điện thoại từ danh thiếp Zalo (`recommened.user` / `recommened.vip`).
 * Native Zalo PC lưu SĐT bên trong `JSON.parse(content.description).phone`.
 */
export function extractContactPhone(c: RawRecord, p?: RawRecord): string | undefined {
  if (p && typeof p.phone === "string" && p.phone.trim()) return p.phone.trim();
  if (typeof c.phone === "string" && c.phone.trim()) return c.phone.trim();

  const sources = [c.description, c.desc, p?.description, p?.desc];
  for (const rawDesc of sources) {
    if (typeof rawDesc === "string" && rawDesc.trim()) {
      try {
        const parsed: unknown = JSON.parse(rawDesc.trim());
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          const rec = parsed as RawRecord;
          if (typeof rec.phone === "string" && rec.phone.trim()) {
            return rec.phone.trim();
          }
          if (
            typeof rec.caption === "string" &&
            /^[0-9+\s.-]{9,16}$/.test(rec.caption.trim())
          ) {
            return rec.caption.trim().replace(/[\s.-]+/g, "");
          }
        }
      } catch {
        const direct = rawDesc.trim().replace(/[^0-9+]/g, "");
        if (direct.length >= 9 && direct.length <= 15) return direct;
      }
    }
  }
  return undefined;
}

function extractContactDescMeta(c: RawRecord): { qrCodeUrl?: string; bgUrl?: string; gUid?: string } {
  const rawDesc = firstText(c.description, c.desc);
  if (!rawDesc || !rawDesc.startsWith("{")) return {};
  try {
    const parsed = JSON.parse(rawDesc) as RawRecord;
    return {
      qrCodeUrl: firstUsableUrl(parsed.qrCodeUrl),
      bgUrl: firstUsableUrl(parsed.cardBackground),
      gUid: firstText(parsed.gUid),
    };
  } catch {
    return {};
  }
}

function buildContact(c: RawRecord): ZaloAttachment | null {
  const p = parseParams(c.params);
  const descMeta = extractContactDescMeta(c);
  // Native Zalo PC: `content.params` là chuỗi uid (vd `"519110756"`)
  const userId =
    typeof c.params === "string" && c.params.trim() && !c.params.trim().startsWith("{")
      ? c.params.trim()
      : firstText(p.uid, p.userId, p.id, c.uid, descMeta.gUid);

  const name = firstText(c.title, p.dName, p.dname, p.displayName, p.name);
  const phone = extractContactPhone(c, p);
  const avatarUrl = firstUsableUrl(c.thumb, c.thumbUrl, p.avatar);
  const url = firstUsableUrl(c.href, p.href);

  if (!name && !phone && !userId && !avatarUrl) return null;

  return compact({
    kind: "contact",
    url,
    name: name || "Danh thiếp Zalo",
    avatar_url: avatarUrl,
    phone,
    user_id: userId,
    qr_code_url: descMeta.qrCodeUrl,
    bg_url: descMeta.bgUrl,
  });
}

/**
 * Thẻ chia sẻ tài khoản ngân hàng (`zinstant.bankcard` / `templateId=11845` / `chat.webcontent*`).
 */
function buildBankcard(c: RawRecord): ZaloAttachment | null {
  const p = parseParams(c.params);
  const zdata = parseParams(c.zinstant_data ?? p.zinstant_data);
  const pcItem =
    (p.pcItem && typeof p.pcItem === "object" ? (p.pcItem as RawRecord) : null) ||
    (zdata.pcItem && typeof zdata.pcItem === "object" ? (zdata.pcItem as RawRecord) : null);
  const item =
    (p.item && typeof p.item === "object" ? (p.item as RawRecord) : null) ||
    (zdata.item && typeof zdata.item === "object" ? (zdata.item as RawRecord) : null);
  const bubbleItem =
    p.bubbleItem && typeof p.bubbleItem === "object" ? (p.bubbleItem as RawRecord) : null;

  let dataUrl =
    firstText(
      pcItem?.data_url,
      item?.data_url,
      bubbleItem?.data_url,
      zdata.data_url,
      c.data_url,
      p.data_url,
      c.url,
    ) || "";

  if (!dataUrl) {
    try {
      const rawStr = JSON.stringify(c);
      const m = rawStr.match(/https?:\/\/[^"'\s\\]*(?:zadn\.vn|zaloapp\.com)[^"'\s\\]*/i);
      if (m) {
        dataUrl = m[0].replace(/\\u0026/g, "&").replace(/\\/g, "");
      }
    } catch {
      // ignore
    }
  }

  if (dataUrl && !dataUrl.includes("data=html") && /(?:zinst-stc|stc-zinstant)/i.test(dataUrl)) {
    dataUrl = dataUrl.includes("?") ? `${dataUrl}&data=html` : `${dataUrl}?data=html`;
  }

  const bin = firstText(c.bin, p.bin, c.binBank, p.binBank, zdata.bin);
  const bankInfo = lookupVietnamBankByBin(bin);
  const rawBankName = firstText(c.bank_name, p.bank_name, c.bankName, p.bankName, zdata.bank_name);
  const bankFromName = !bankInfo && rawBankName ? lookupVietnamBankByKeyword(rawBankName) : null;
  const resolvedBank = bankInfo || bankFromName;

  const accountNo = firstText(
    c.account_number,
    p.account_number,
    c.account_no,
    p.account_no,
    c.numAccBank,
    p.numAccBank,
    zdata.account_no,
  );
  const accountName = firstText(
    c.account_name,
    p.account_name,
    c.nameAccBank,
    p.nameAccBank,
    c.holderName,
    p.holderName,
    zdata.account_name,
  );

  return compact({
    kind: "bankcard",
    url: dataUrl || undefined,
    data_url: dataUrl || undefined,
    bin: bin || resolvedBank?.bin,
    bank_name: rawBankName || resolvedBank?.fullName,
    bank_short_name: resolvedBank?.shortName || rawBankName,
    account_number: accountNo,
    account_name: accountName,
    qr_url: firstUsableUrl(c.qr_url, p.qr_url, zdata.qr_url),
    logo_url: firstUsableUrl(c.logo_url, p.logo_url, zdata.logo_url),
    bg_url: firstUsableUrl(c.bg_url, p.bg_url, zdata.bg_url),
  });
}

const BUILDERS: Partial<Record<ZaloAttachmentKind, (c: RawRecord) => ZaloAttachment | null>> = {
  image: (c) => buildImage(c, "image"),
  gif: (c) => buildImage(c, "gif"),
  doodle: (c) => buildImage(c, "doodle"),
  video: buildVideo,
  voice: buildVoice,
  file: buildFile,
  folder: buildFile,
  link: buildLink,
  sticker: buildSticker,
  location: buildLocation,
  contact: buildContact,
  bankcard: buildBankcard,
  call: (c) => {
    const info = parseZaloCallMessage({ raw_content: c });
    return info ? { kind: "call", title: info.title, description: info.subtitle, call_info: info } : null;
  },
};

function looksLikeSticker(c: RawRecord): boolean {
  if (c.stickerUrl || c.stickerWebpUrl) return true;
  const hasId = Number.isFinite(Number(c.id ?? c.stickerId ?? c.sticker_id)) && Number(c.id ?? c.stickerId ?? c.sticker_id) > 0;
  const hasCat =
    Number.isFinite(Number(c.catId ?? c.cateId ?? c.cate_id)) &&
    Number(c.catId ?? c.cateId ?? c.cate_id) > 0;
  return hasId && hasCat;
}

function isBankcardCandidate(c: RawRecord | null, rawStr: string, contentText: string): boolean {
  if (c) {
    const action = firstText(c.action)?.toLowerCase() || "";
    if (action.includes("bankcard") || action === "zinstant.bankcard") return true;
    const zId = firstText(c.zinstantdata_id, c.template_id, c.templateId);
    if (zId && zId.includes("11845")) return true;
    if (firstText(c.numAccBank, c.binBank)) return true;
  }
  if (
    rawStr.includes("zinstant.bankcard") ||
    rawStr.includes("templateId=11845") ||
    rawStr.includes("zinst-stc.zadn.vn") ||
    rawStr.includes("stc-zinstant.zadn.vn")
  ) {
    return true;
  }
  if (contentText && /^\[?tài khoản ngân hàng\]?$/i.test(contentText.trim())) {
    return true;
  }
  return false;
}

function guessKind(c: RawRecord): ZaloMessageKind {
  const action = firstText(c.action)?.toLowerCase() || "";
  if (action.includes("bankcard")) return "bankcard";
  if (action === "recommend.gif") return "gif";
  if (action === "recommened.user" || action === "recommened.vip" || action === "chat.contact") return "contact";
  if (action === "recommened.friend" || action === "msginfo.actionlist") return "system_notice";
  if (action === "recommened.location") return "location";
  if (
    action === "recommened.link" ||
    action === "recommened.minisite" ||
    action === "recommened.miniapp" ||
    action === "recommened.oa" ||
    action === "recommened.article" ||
    action === "recommened.post" ||
    action === "recommened.zvideo"
  ) {
    return "link";
  }

  const p = parseParams(c.params);
  if (looksLikeSticker(c)) return "sticker";
  if (c.videoUrl || p.videoUrl || p.m3u8_hls) return "video";
  if (c.voiceUrl || c.m4aUrl || p.voiceUrl || p.m4aUrl) return "voice";

  const href = typeof c.href === "string" ? c.href : "";
  const fileUrl = typeof c.fileUrl === "string" ? c.fileUrl : typeof p.fileUrl === "string" ? p.fileUrl : "";
  const probe = fileUrl || href;
  if (VIDEO_EXT_RE.test(probe)) return "video";
  if (AUDIO_EXT_RE.test(probe)) return "voice";
  if (GIF_EXT_RE.test(probe)) return "gif";

  if (c.hdUrl || c.oriUrl || c.normalUrl || c.rawUrl || c.thumbUrl || p.hd || p.hdUrl || p.normalUrl || p.rawUrl) {
    return "image";
  }
  if (IMAGE_EXT_RE.test(probe)) return "image";

  if (c.fileName || p.fileName || p.fileExt || p.extention || fileUrl) {
    return isFolderParams(p) ? "folder" : "file";
  }
  if (
    Number.isFinite(Number(c.latitude ?? c.lat ?? p.lat)) &&
    Number.isFinite(Number(c.longitude ?? c.lon ?? c.lng ?? c.lo ?? p.lon ?? p.lo)) &&
    (Number(c.latitude ?? c.lat ?? p.lat) !== 0 || Number(c.longitude ?? c.lon ?? c.lng ?? c.lo ?? p.lon ?? p.lo) !== 0)
  ) {
    return "location";
  }
  if (extractContactPhone(c, p)) return "contact";
  if (isUsableUrl(href)) return "link";
  return "text";
}

function refineRecommendedKind(c: RawRecord, wireMsgType: string): ZaloMessageKind {
  const action = firstText(c.action)?.toLowerCase() || "";

  if (
    action === "recommened.misscall" ||
    action === "recommened.calltime" ||
    action === "recommened.calling" ||
    action === "recommened.receivecall"
  ) {
    return "call";
  }
  if (action.includes("bankcard")) return "bankcard";
  if (action === "recommend.gif") return "gif";
  if (action === "recommened.friend") return "system_notice";
  if (action === "recommened.location") return "location";
  if (action === "recommened.stickerset") return "sticker";

  // `show.profile` trên `chat.ecard` là thiệp kết bạn (`system_notice`), còn trên `chat.recommended` là danh thiếp (`contact`)
  if (action === "show.profile") {
    return wireMsgType === "chat.ecard" ? "system_notice" : "contact";
  }
  if (
    action === "recommened.user" ||
    action === "recommened.vip" ||
    action === "chat.contact" ||
    action.includes("vcard")
  ) {
    return "contact";
  }
  if (
    action === "recommened.link" ||
    action === "recommened.minisite" ||
    action === "recommened.miniapp" ||
    action === "recommened.oa" ||
    action === "recommened.zvideo" ||
    action === "recommened.article" ||
    action === "recommened.post"
  ) {
    return "link";
  }

  const p = parseParams(c.params);
  if (extractContactPhone(c, p)) return "contact";
  return "link";
}

function isAttachmentKind(kind: ZaloMessageKind): kind is ZaloAttachmentKind {
  return kind !== "text" && kind !== "unknown" && kind !== "system_notice" && kind !== "undo";
}

function normalizeOne(content: unknown, kind: ZaloMessageKind): ZaloAttachment | null {
  if (!content || typeof content !== "object") return null;
  const c = content as RawRecord;
  const primary = isAttachmentKind(kind) ? BUILDERS[kind] : undefined;
  const built = primary ? primary(c) : null;
  if (built) return built;
  const guessed = guessKind(c);
  if (guessed !== kind && isAttachmentKind(guessed)) {
    const fallbackBuilder = BUILDERS[guessed];
    return fallbackBuilder ? fallbackBuilder(c) : null;
  }
  return null;
}

function attachmentsFromStoredColumn(value: unknown): ZaloAttachment[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (a): a is ZaloAttachment =>
      !!a && typeof a === "object" && typeof (a as ZaloAttachment).kind === "string",
  );
}

function extractPollMeta(c: RawRecord | null, dataObj: RawRecord | null): ZaloSystemEventMeta | null {
  if (!c) return null;
  const p = parseParams(c.params);
  if (p.pollId === undefined && firstText(dataObj?.msgType)?.toLowerCase() !== "group.poll") {
    return null;
  }
  const dName = firstText(p.dName, dataObj?.dName) || "";
  const question = firstText(p.question, c.title) || "";
  const action = firstText(c.action)?.toLowerCase() || "";

  let title: string;
  if (action === "close") {
    title = dName ? `${dName} đã kết thúc bình chọn` : "Bình chọn đã kết thúc";
  } else if (action === "vote") {
    title = dName ? `${dName} đang bình chọn` : "Có thành viên đang bình chọn";
  } else {
    const msgFormatted = formatMsgInfoActionList(c);
    title = msgFormatted || (question ? `Bình chọn: ${question}` : "Bình chọn trong nhóm");
  }

  const rawOptions = Array.isArray(p.options) ? p.options : [];
  const options = rawOptions
    .map((o) => (typeof o === "string" ? o.trim() : firstText((o as RawRecord)?.content, (o as RawRecord)?.title) || ""))
    .filter(Boolean);

  return {
    category: "poll",
    act: action || "group.poll",
    title,
    subtitle: question && !title.includes(question) ? question : undefined,
    iconKind: "poll",
    ...(options.length > 0 ? { options } : {}),
  };
}

function finalizeResult(
  row: StoredMessageRow,
  partial: {
    kind: ZaloMessageKind;
    text?: string;
    attachments: ZaloAttachment[];
    callInfo?: ZaloCallMessageInfo;
    systemEvent?: ZaloSystemEventMeta;
    unknown_label?: string;
    isRecalled?: boolean;
  },
): NormalizedZaloMessage {
  const cleanText = sanitizeDisplayText(partial.text);
  const runInline = partial.kind === "text" && cleanText.length > 0;
  const inlineUrls = runInline ? extractUrlsFromText(cleanText) : [];
  const inlinePhones = runInline ? extractVietnamesePhones(cleanText) : [];
  const inlineBanks = runInline ? extractFreeTextBankAccounts(cleanText) : [];

  const computedPreview = formatZaloAnySidebarPreview({
    content: partial.systemEvent?.title || cleanText || row.content,
    type: row.type,
    msg_kind: partial.kind !== "text" ? partial.kind : row.msg_kind,
    raw_content: row.raw_content,
    attachments: partial.attachments,
    is_sent: row.is_sent,
    is_deleted: partial.isRecalled || row.is_deleted,
  });

  return {
    kind: partial.kind,
    text: cleanText,
    attachments: partial.attachments,
    ...(partial.callInfo ? { callInfo: partial.callInfo } : {}),
    ...(partial.systemEvent ? { systemEvent: partial.systemEvent } : {}),
    ...(partial.kind === "system_notice" && partial.systemEvent?.title
      ? { system_text: partial.systemEvent.title }
      : {}),
    ...(partial.unknown_label ? { unknown_label: partial.unknown_label } : {}),
    inlineBanks,
    inlinePhones,
    inlineUrls,
    previewText: computedPreview || kindLabel(partial.kind),
    isRecalled: Boolean(partial.isRecalled),
  };
}

/**
 * Chuẩn hóa toàn diện 1 row `zalo_messages` cho mọi bề mặt chat & sidebar.
 */
export function normalizeStoredMessage(row: StoredMessageRow): NormalizedZaloMessage {
  const env = unwrapRawEnvelope(row.raw_content);
  const rawTypeLower = firstText(row.type)?.toLowerCase() || "";
  const rawKindLower = firstText(row.msg_kind)?.toLowerCase() || "";
  const wireMsgType = env.wireMsgType || rawTypeLower;
  const inner = env.innerFirst;
  const action = firstText(inner?.action, env.dataObj?.action)?.toLowerCase() || "";
  const rowContentText = typeof row.content === "string" ? row.content.trim() : "";

  // 1. Tin nhắn đã thu hồi / đã xóa (`chat.undo`, `chat.delete`, `chat.delete.everyone`, `is_deleted`)
  if (
    row.is_deleted ||
    wireMsgType === "chat.undo" ||
    rawKindLower === "undo" ||
    wireMsgType === "chat.delete.everyone" ||
    wireMsgType === "chat.delete"
  ) {
    const isDelete = wireMsgType === "chat.delete.everyone" || wireMsgType === "chat.delete";
    const title = isDelete ? "Tin nhắn đã bị xóa" : "Tin nhắn đã được thu hồi";
    return finalizeResult(row, {
      kind: "undo",
      text: title,
      attachments: [],
      isRecalled: true,
      systemEvent: {
        category: "undo",
        act: wireMsgType || "chat.undo",
        title,
        iconKind: "recall",
      },
    });
  }

  // 2. Tin nhắn cuộc gọi Zalo (ủy quyền hoàn toàn cho `zaloCallMessage.ts` — LOCKED)
  const callInfo = parseZaloCallMessage({
    type: row.type,
    msg_kind: row.msg_kind,
    content: row.content,
    is_sent: row.is_sent,
    raw_content: env.parsedRoot,
  });
  if (callInfo) {
    return finalizeResult(row, {
      kind: "call",
      text: "",
      callInfo,
      attachments: [
        {
          kind: "call",
          title: callInfo.title,
          description: callInfo.subtitle,
          duration_ms: callInfo.durationSec > 0 ? callInfo.durationSec * 1000 : undefined,
          call_info: callInfo,
        },
      ],
    });
  }

  // 3. Thẻ ngân hàng ZInstant / VietQR (`zinstant.bankcard`, `templateId=11845`, `chat.webcontent*`)
  const rawProbeStr =
    typeof row.raw_content === "string"
      ? row.raw_content
      : inner
        ? (() => {
            try {
              return JSON.stringify(inner);
            } catch {
              return "";
            }
          })()
        : "";
  const bankItem =
    wireMsgType === "chat.webcontent" ||
    wireMsgType === "chat.webcontent.v2" ||
    rawKindLower === "bankcard" ||
    isBankcardCandidate(inner, rawProbeStr, rowContentText)
      ? inner || env.dataObj || {}
      : null;

  if (bankItem && isBankcardCandidate(bankItem, rawProbeStr, rowContentText)) {
    const card = buildBankcard(bankItem);
    if (card) {
      return finalizeResult(row, {
        kind: "bankcard",
        text: "",
        attachments: [card],
      });
    }
  }

  // 4. Thông báo hệ thống: `msginfo.actionlist`, `chat.ecard`, `friend.event`, `group.event`, `poll`, `reminder`, `todo`, `vanish`
  if (action === "msginfo.actionlist") {
    const formatted = formatMsgInfoActionList(env.parsedRoot);
    if (formatted) {
      const lower = formatted.toLowerCase();
      const category: ZaloSystemEventCategory =
        lower.includes("kết bạn") || lower.includes("bạn bè")
          ? "friend"
          : lower.includes("bình chọn")
            ? "poll"
            : lower.includes("nhắc hẹn")
              ? "reminder"
              : "group";
      const iconKind: ZaloSystemEventIconKind = lower.includes("bỏ ghim")
        ? "unpin"
        : lower.includes("ghim")
          ? "pin"
          : category === "friend"
            ? "friend_accept"
            : category === "poll"
              ? "poll"
              : category === "reminder"
                ? "reminder"
                : "info";
      return finalizeResult(row, {
        kind: "system_notice",
        text: formatted,
        attachments: [],
        systemEvent: {
          category,
          act: "msginfo.actionlist",
          title: formatted,
          iconKind,
        },
      });
    }
  }

  // 4b. `chat.ecard` (bao gồm `action="show.profile"` + `type="2"` đồng ý kết bạn, birthday, reminder ecard) & `friend.event` & `recommened.friend`
  if (
    wireMsgType === "chat.ecard" ||
    wireMsgType === "friend.event" ||
    wireMsgType === "friend_event" ||
    action === "recommened.friend"
  ) {
    const fe = formatZaloFriendEvent(env.parsedRoot);
    if (fe) {
      const category: ZaloSystemEventCategory =
        fe.iconKind === "reminder"
          ? "reminder"
          : fe.iconKind === "friend_accept" ||
              fe.iconKind === "friend_request" ||
              fe.iconKind === "friend_remove" ||
              fe.iconKind === "friend_block" ||
              fe.iconKind === "stranger"
            ? "friend"
            : fe.iconKind === "group_join"
              ? "group"
              : "ecard";
      return finalizeResult(row, {
        kind: "system_notice",
        text: fe.title,
        attachments: [],
        systemEvent: {
          category,
          act: fe.act,
          title: fe.title,
          subtitle: fe.subtitle,
          iconKind: fe.iconKind,
          ecardType: fe.ecardType,
          thumb: fe.thumb,
          bannerUrl: fe.bannerUrl,
        },
      });
    }
  }

  // 4c. Bình chọn (`group.poll`, `chat.poll`, hoặc `params.pollId`)
  const pollMeta = extractPollMeta(inner, env.dataObj);
  if (pollMeta) {
    return finalizeResult(row, {
      kind: "system_notice",
      text: pollMeta.title,
      attachments: [],
      systemEvent: pollMeta,
    });
  }

  // 4d. Nhắc hẹn (`chat.reminder`) & Công việc (`chat.todo`)
  if (wireMsgType === "chat.reminder" || rawKindLower === "reminder") {
    const p = parseParams(inner?.params);
    const title = firstText(inner?.title, p.title, sanitizeDisplayText(rowContentText)) || "Nhắc hẹn";
    const dueRaw = p.startTime ?? p.dueTime ?? inner?.startTime;
    const dueTime =
      typeof dueRaw === "number" || typeof dueRaw === "string" ? dueRaw : undefined;
    return finalizeResult(row, {
      kind: "system_notice",
      text: title,
      attachments: [],
      systemEvent: {
        category: "reminder",
        act: "chat.reminder",
        title,
        subtitle: firstText(inner?.description, p.description),
        iconKind: "reminder",
        dueTime,
      },
    });
  }

  if (wireMsgType === "chat.todo" || rawKindLower === "todo") {
    const p = parseParams(inner?.params);
    const title =
      firstText(inner?.message, inner?.title, p.title, sanitizeDisplayText(rowContentText)) ||
      "Công việc Zalo To-Do";
    return finalizeResult(row, {
      kind: "system_notice",
      text: title,
      attachments: [],
      systemEvent: {
        category: "todo",
        act: action || "chat.todo",
        title,
        subtitle: firstText(inner?.description, p.description),
        iconKind: "todo",
      },
    });
  }

  // 4e. Sự kiện nhóm (`group.event`, `group_event`, `group.leave`)
  if (
    wireMsgType === "group.event" ||
    wireMsgType === "group_event" ||
    wireMsgType === "group.leave" ||
    rawKindLower === "system_notice"
  ) {
    const ge = formatZaloGroupEvent(env.parsedRoot);
    if (ge) {
      return finalizeResult(row, {
        kind: "system_notice",
        text: ge.title,
        attachments: [],
        systemEvent: {
          category: "group",
          act: ge.act,
          title: ge.title,
          subtitle: ge.subtitle,
          iconKind: ge.iconKind,
        },
      });
    }
    if (rawKindLower === "system_notice" && sanitizeDisplayText(rowContentText)) {
      const cleanNotice = sanitizeDisplayText(rowContentText);
      return finalizeResult(row, {
        kind: "system_notice",
        text: cleanNotice,
        attachments: [],
        systemEvent: {
          category: "info",
          title: cleanNotice,
          iconKind: "info",
        },
      });
    }
  }

  // 4f. Tin nhắn tự xóa (`chat.vanish`)
  if (wireMsgType === "chat.vanish") {
    const title = "Tin nhắn đã tự xóa";
    return finalizeResult(row, {
      kind: "system_notice",
      text: title,
      attachments: [],
      systemEvent: {
        category: "info",
        act: "chat.vanish",
        title,
        iconKind: "vanish",
      },
    });
  }

  // 5. Cột `attachments` đã chuẩn hóa sẵn bởi Bridge (bổ sung SĐT/BIN/URL sticker nếu thiếu)
  const stored = attachmentsFromStoredColumn(row.attachments);
  if (stored.length > 0) {
    const mappedKind = (MSG_TYPE_KIND[rawKindLower] as ZaloMessageKind | undefined) || stored[0].kind;
    const rowImageFallback = Array.isArray(row.image_urls) ? row.image_urls.find(isUsableUrl) : undefined;
    const p = inner ? parseParams(inner.params) : {};
    for (const a of stored) {
      if (a.kind === "sticker") {
        if (!a.sticker_id && inner) {
          const sid = firstPositiveNumber(
            inner.id,
            inner.stickerId,
            inner.sticker_id,
            p.id,
            p.stickerId,
            p.sticker_id,
          );
          if (sid) a.sticker_id = sid;
        }
        if (!isUsableUrl(a.url)) {
          const resolvedUrl = buildZaloStickerCdnUrl(a.sticker_id) || rowImageFallback;
          if (resolvedUrl) a.url = resolvedUrl;
        }
      }
      if (inner) {
        if (a.kind === "contact") {
          if (!a.phone) {
            const ph = extractContactPhone(inner, p);
            if (ph) a.phone = ph;
          }
          if (!a.user_id && typeof inner.params === "string" && !inner.params.startsWith("{")) {
            a.user_id = inner.params.trim();
          }
        }
        if (a.kind === "bankcard" && a.bin && !a.bank_short_name) {
          const b = lookupVietnamBankByBin(a.bin);
          if (b) {
            a.bank_short_name = b.shortName;
            if (!a.bank_name) a.bank_name = b.fullName;
          }
        }
      }
    }
    const cleanStoredText = sanitizeDisplayText(rowContentText);
    return finalizeResult(row, {
      kind: mappedKind,
      text: mappedKind === "sticker" && isStickerPlaceholderText(cleanStoredText) ? "" : cleanStoredText,
      attachments: stored,
    });
  }

  // 6. Phân loại từ `raw_content` đã unwrap (ưu tiên `wireMsgType` + `action` hơn `row.msg_kind` cũ bị gán sai)
  if (inner) {
    // 6a. Rich text (`webchat` + `action="rtf"`)
    if (action === "rtf" && (wireMsgType === "webchat" || wireMsgType === "" || wireMsgType === "text")) {
      const fullRtf = firstText(inner.title, rowContentText) || "";
      return finalizeResult(row, {
        kind: "text",
        text: fullRtf,
        attachments: [],
      });
    }

    // 6b. Xác định kind chính xác từ wireMsgType / action / shape
    let resolvedKind: ZaloMessageKind;
    if (wireMsgType && MSG_TYPE_KIND[wireMsgType]) {
      resolvedKind = MSG_TYPE_KIND[wireMsgType];
    } else if (rawKindLower && MSG_TYPE_KIND[rawKindLower] && rawKindLower !== "text" && rawKindLower !== "webchat") {
      resolvedKind = MSG_TYPE_KIND[rawKindLower];
    } else {
      resolvedKind = guessKind(inner);
    }

    // Photo-sticker: `chat.photo` với `msgBubbleLayoutType === 3` hoặc `stickerUrl`
    if (resolvedKind === "image") {
      const p = parseParams(inner.params);
      if (
        Number(p.msgBubbleLayoutType) === 3 ||
        (Number(p.subType) === 1 && typeof p.webpUrl === "string") ||
        looksLikeSticker(inner)
      ) {
        resolvedKind = "sticker";
      }
    }

    if (
      resolvedKind === "link" ||
      wireMsgType === "chat.recommended" ||
      wireMsgType === "group"
    ) {
      resolvedKind = refineRecommendedKind(inner, wireMsgType);
    }

    if (resolvedKind === "file") {
      const p = parseParams(inner.params);
      if (isFolderParams(p)) resolvedKind = "folder";
    }

    // Nếu `refineRecommendedKind` chuyển sang `system_notice` (vd `recommened.friend` đã check ở 4b)
    if (resolvedKind === "system_notice") {
      const fallbackTitle = firstText(inner.title, inner.description, sanitizeDisplayText(rowContentText)) || "Thông báo hệ thống";
      return finalizeResult(row, {
        kind: "system_notice",
        text: fallbackTitle,
        attachments: [],
        systemEvent: {
          category: "info",
          act: action || wireMsgType,
          title: fallbackTitle,
          iconKind: "info",
        },
      });
    }

    // Build attachments
    if (isAttachmentKind(resolvedKind)) {
      const items = env.innerItems.length > 0 ? env.innerItems : [inner];
      const attachments = items
        .map((item) => normalizeOne(item, resolvedKind))
        .filter((a): a is ZaloAttachment => !!a);

      if (attachments.length > 0) {
        const finalKind = attachments[0].kind;
        // Giữ lại caption nếu là link/ảnh/video có lời nhắn kèm theo (vd URL + "\n@Mylife dạ e mới làm...")
        let captionText = "";
        if (finalKind === "link") {
          const rawTitle = firstText(inner.title) || sanitizeDisplayText(rowContentText);
          if (rawTitle) {
            const stripped = rawTitle
              .replace(attachments[0].url || "", "")
              .trim();
            if (stripped && !isUsableUrl(stripped)) {
              captionText = stripped;
            }
          }
        } else if (finalKind === "image" || finalKind === "video") {
          const cap = firstText(inner.title) || sanitizeDisplayText(rowContentText);
          if (cap && !isUsableUrl(cap)) captionText = cap;
        }

        return finalizeResult(row, {
          kind: finalKind,
          text: captionText,
          attachments,
        });
      }

      // Nếu là URL trần trong `content` mà `buildLink` thất bại (không có href) → trả về text thường (linkify sẽ xử lý)
      if (resolvedKind === "link" && rowContentText && /^https?:\/\//i.test(rowContentText)) {
        return finalizeResult(row, {
          kind: "text",
          text: rowContentText,
          attachments: [],
        });
      }

      // Nếu là zinstant / chat.webcontent không rõ phải bankcard
      if (wireMsgType === "chat.webcontent" || wireMsgType === "chat.webcontent.v2") {
        const customText = formatMsgInfoActionList(parseParams(inner.params).customMsg);
        const label = customText || ZALO_SIDEBAR_BRACKET_LABELS.STR_MSG_MEDIA;
        return finalizeResult(row, {
          kind: "bankcard",
          text: "",
          attachments: [buildBankcard(inner) || { kind: "bankcard", title: label }],
          unknown_label: label,
        });
      }

      // Không để rơi vào "— mở Zalo để xem" — dùng nhãn Zalo native sạch
      const cleanFallback = sanitizeDisplayText(rowContentText);
      if (cleanFallback) {
        return finalizeResult(row, {
          kind: "text",
          text: cleanFallback,
          attachments: [],
        });
      }
      return finalizeResult(row, {
        kind: resolvedKind,
        text: "",
        attachments: [],
        unknown_label: kindLabel(resolvedKind),
      });
    }
  }

  // 7. Tin cũ chỉ còn `image_urls` hoặc tin sticker legacy thiếu `raw_content`
  const isStickerHint =
    rawKindLower === "sticker" ||
    rawKindLower === "chat.sticker" ||
    wireMsgType === "chat.sticker";
  const urls = Array.isArray(row.image_urls) ? row.image_urls.filter(isUsableUrl) : [];
  if (urls.length > 0) {
    if (isStickerHint) {
      const sidFromText = extractStickerIdFromPlaceholder(rowContentText);
      const attachments = urls.map<ZaloAttachment>((url) =>
        compact({ kind: "sticker", sticker_id: sidFromText, url }),
      );
      const cleanTxt = sanitizeDisplayText(rowContentText);
      return finalizeResult(row, {
        kind: "sticker",
        text: isStickerPlaceholderText(cleanTxt) ? "" : cleanTxt,
        attachments,
      });
    }
    const attachments = urls.map<ZaloAttachment>((url) =>
      VIDEO_EXT_RE.test(url) || HLS_EXT_RE.test(url)
        ? { kind: "video", url }
        : AUDIO_EXT_RE.test(url)
          ? { kind: "voice", url }
          : { kind: GIF_EXT_RE.test(url) ? "gif" : "image", url },
    );
    return finalizeResult(row, {
      kind: attachments[0].kind,
      text: sanitizeDisplayText(rowContentText),
      attachments,
    });
  }

  if (isStickerHint) {
    const sidFromText = extractStickerIdFromPlaceholder(rowContentText);
    const cdnUrl = buildZaloStickerCdnUrl(sidFromText);
    if (sidFromText && cdnUrl) {
      return finalizeResult(row, {
        kind: "sticker",
        text: "",
        attachments: [{ kind: "sticker", sticker_id: sidFromText, url: cdnUrl }],
      });
    }
  }

  // 8. Tin văn bản thuần (bao gồm `webchat` có `data.content` là chuỗi)
  const plainText = sanitizeDisplayText(env.plainInnerText || rowContentText);
  const mappedFallbackKind =
    MSG_TYPE_KIND[wireMsgType] || MSG_TYPE_KIND[rawKindLower] || "text";

  return finalizeResult(row, {
    kind: plainText ? "text" : mappedFallbackKind,
    text: plainText,
    attachments: [],
  });
}

const KIND_LABEL: Record<string, string> = {
  image: "[Hình ảnh]",
  gif: "[GIF]",
  video: "[Video]",
  voice: "[Tin nhắn thoại]",
  file: "[File]",
  folder: "[Thư mục]",
  link: "[Link]",
  sticker: "[Sticker]",
  location: "[Vị trí]",
  contact: "[Danh thiếp]",
  bankcard: "[Thẻ ngân hàng]",
  call: "[Cuộc gọi]",
  ecard: "[Thiệp]",
  poll: "[Bình chọn]",
  reminder: "[Nhắc hẹn]",
  todo: "[Công việc]",
  doodle: "[Vẽ hình]",
  system_notice: "[Thông báo]",
  undo: "Tin nhắn đã được thu hồi",
  unknown: "[Tin nhắn]",
};

/** Nhãn ngắn cho preview (danh sách hội thoại, tin trích dẫn...). */
export function kindLabel(kind: ZaloMessageKind): string {
  return KIND_LABEL[kind] || "";
}

/**
 * Dòng preview ở danh sách hội thoại (giữ 100% tương thích ngược với `hooks/useZalo.ts`).
 */
export function previewText(input: {
  text?: string | null;
  kind?: ZaloMessageKind | null;
  attachments?: ZaloAttachment[] | null;
}): string {
  const first = input.attachments?.[0];
  if (first?.kind === "call") {
    const label = first.call_info?.previewLabel || first.title || "Cuộc gọi";
    const icon = first.call_info?.isMissed ? "📵" : first.call_info?.mediaType === "video" ? "📹" : "📞";
    return `${icon} ${label}`;
  }
  if (input.kind === "undo") {
    return "Tin nhắn đã được thu hồi";
  }
  const clean = sanitizeDisplayText(input.text);
  if (clean) {
    return clean;
  }
  if (input.text && isSendBubblePlaceholder(input.text)) {
    return formatZaloSidebarPreview(input.text);
  }
  if (!first) return input.kind && input.kind !== "text" ? kindLabel(input.kind) : "";
  if (first.kind === "link") return `${KIND_LABEL.link} ${first.title || first.url || ""}`.trim();
  if (first.kind === "file") return `${KIND_LABEL.file} ${first.name || ""}`.trim();
  if (first.kind === "folder") return `${KIND_LABEL.folder} ${first.name || ""}`.trim();
  if (first.kind === "contact") return `${KIND_LABEL.contact} ${first.name || ""}`.trim();
  return KIND_LABEL[first.kind] || KIND_LABEL.unknown;
}

/** Đổi byte → chuỗi đọc được ("1,2 MB"). */
export function formatBytes(bytes?: number): string {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1).replace(".", ",")} ${units[unit]}`;
}

/** Đổi mili-giây → "m:ss" cho video/voice. */
export function formatDuration(ms?: number): string {
  if (!ms || !Number.isFinite(ms) || ms <= 0) return "";
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
