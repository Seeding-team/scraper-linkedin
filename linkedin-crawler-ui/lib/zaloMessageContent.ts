/**
 * Chuẩn hoá đính kèm của 1 row `zalo_messages` để UI chat render đúng LOẠI
 * (ảnh / video / link / file / voice / sticker / vị trí) thay vì nhét tất cả
 * vào `<img>`.
 *
 * ── Vì sao cần tầng này ở phía ĐỌC ─────────────────────────────────────────
 * Bridge (services/zalo-bridge/src/services/messageContent.js) đã phân loại và
 * ghi sẵn `msg_kind` + `attachments` cho tin nhắn MỚI. Nhưng mọi row CŨ trong
 * DB thì:
 *   - `msg_kind` = NULL, `attachments` = NULL
 *   - `image_urls` chứa lẫn lộn cả `href` của tin link (trang web) lẫn `.mp4`
 *     của tin video — đúng nguyên nhân bug "link hiển thị thành ảnh vỡ"
 *   - nhưng `raw_content` (JSONB, có từ migration 2026-09-04) vẫn giữ nguyên
 *     content object gốc của Zalo
 * → phân loại lại tại chỗ đọc từ `raw_content` thì tin cũ cũng hiển thị đúng
 * ngay, không cần UPDATE backfill trên bảng đang có traffic ghi liên tục.
 *
 * Logic phải KHỚP với bản JS ở bridge. Hai bản cố ý tách rời (Node service vs
 * Next.js app, không import chéo được) — sửa 1 bên nhớ sửa bên kia, và cả bản
 * sao ở services/zalo-account-module/src/lib/zaloMessageContent.ts.
 */

export type ZaloAttachmentKind =
  | "image"
  | "gif"
  | "video"
  | "voice"
  | "file"
  | "link"
  | "sticker"
  | "location"
  | "contact"
  | "bankcard";

/**
 * Thông báo hệ thống chung (kết bạn, bình chọn, ...) — KHÔNG phải attachment
 * (không có ảnh/file/link gì), chỉ 1 dòng chữ hiển thị CĂN GIỮA như tin hệ
 * thống, khác hẳn bong bóng trái/phải bình thường. Xem systemActionText().
 */
export type ZaloMessageKind = ZaloAttachmentKind | "text" | "unknown" | "system_notice";

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
  sticker_id?: number;
  cate_id?: number;
  sticker_type?: number;
  lat?: number;
  lon?: number;
  address?: string;
  avatar_url?: string;
  phone?: string;
  // Dành cho thẻ tài khoản ngân hàng (zinstant.bankcard)
  bank_name?: string;
  account_number?: string;
  qr_url?: string;
  logo_url?: string;
  bg_url?: string;
  bin?: string;
  data_url?: string;
};

type RawRecord = Record<string, unknown>;

const VIDEO_EXT_RE = /\.(mp4|mov|m4v|webm|mkv|avi|3gp|flv|wmv)(\?|#|$)/i;
const AUDIO_EXT_RE = /\.(m4a|mp3|aac|ogg|opus|wav|amr)(\?|#|$)/i;
const IMAGE_EXT_RE = /\.(jpe?g|png|webp|bmp|heic|heif|avif|jxl)(\?|#|$)/i;
const GIF_EXT_RE = /\.gif(\?|#|$)/i;
const HLS_EXT_RE = /\.m3u8(\?|#|$)/i;

/** msgType thô của Zalo → kind chuẩn hoá (khớp MSG_TYPE_KIND ở bridge). */
const MSG_TYPE_KIND: Record<string, ZaloAttachmentKind> = {
  "chat.photo": "image",
  "chat.gif": "gif",
  "chat.sticker": "sticker",
  "chat.doodle": "image",
  "chat.video.msg": "video",
  "chat.voice": "voice",
  "share.file": "file",
  "chat.recommended": "link",
  "chat.link": "link",
  "chat.location.new": "location",
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
  // Payload cũ đôi khi trả GIÂY: dưới 1000 gần như chắc chắn là giây (clip Zalo
  // không bao giờ ngắn hơn 1 giây nhưng cũng hiếm khi dài quá 1000 giây).
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

/** `content.params` của Zalo khi là object, khi là string JSON. */
function parseParams(params: unknown): RawRecord {
  if (!params) return {};
  if (typeof params === "object" && !Array.isArray(params)) return params as RawRecord;
  if (typeof params === "string") {
    try {
      const parsed: unknown = JSON.parse(params);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as RawRecord) : {};
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

function extractImageUrl(c: RawRecord): string | undefined {
  const p = parseParams(c.params);
  return firstUsableUrl(
    c.hdUrl,
    c.oriUrl,
    c.normalUrl,
    c.rawUrl,
    c.href,
    c.thumbUrl,
    c.thumb,
    p.hdUrl,
    p.oriUrl,
    p.normalUrl,
    p.rawUrl,
    p.thumbUrl
  );
}

function buildImage(c: RawRecord, kind: "image" | "gif"): ZaloAttachment | null {
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
  });
}

function buildVideo(c: RawRecord): ZaloAttachment | null {
  const p = parseParams(c.params);
  // Ưu tiên file thật (mp4) hơn HLS: <video> của Chrome/Firefox không phát
  // được .m3u8 natively → chọn nhầm là ra ô đen câm.
  const direct = firstUsableUrl(c.videoUrl, p.videoUrl, p.video_url, c.fileUrl, p.fileUrl, c.href);
  const hls = firstUsableUrl(p.m3u8_hls, p.hlsUrl, c.m3u8_hls);
  const url = direct && !HLS_EXT_RE.test(direct) ? direct : direct || hls;
  if (!url) return null;
  return compact({
    kind: "video",
    url,
    thumb_url: firstUsableUrl(c.thumbUrl, c.thumb, p.thumbUrl, p.thumb),
    duration_ms: durationMs(c.duration, p.duration),
    width: firstPositiveNumber(c.width, p.width),
    height: firstPositiveNumber(c.height, p.height),
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

function buildFile(c: RawRecord): ZaloAttachment | null {
  const p = parseParams(c.params);
  const url = firstUsableUrl(c.fileUrl, p.fileUrl, c.href);
  if (!url) return null;
  const name = [c.fileName, p.fileName, c.title, p.title].find(
    (v) => typeof v === "string" && v.trim() && !isUsableUrl(v)
  ) as string | undefined;
  const rawExt = extOf(name, url) || p.fileExt || p.extention;
  return compact({
    kind: "file",
    url,
    name: name ? name.trim().slice(0, 255) : undefined,
    ext: rawExt ? String(rawExt).toLowerCase().replace(/^\./, "") : undefined,
    size_bytes: firstPositiveNumber(c.fileSize, p.fileSize, p.totalSize, c.totalSize),
  });
}

function buildLink(c: RawRecord): ZaloAttachment | null {
  const p = parseParams(c.params);
  const url = firstUsableUrl(c.href, p.src, c.src, p.href);
  if (!url) return null;
  return compact({
    kind: "link",
    url,
    title: firstText(c.title, p.title)?.slice(0, 300),
    description: firstText(c.description, c.desc, p.desc)?.slice(0, 500),
    thumb_url: firstUsableUrl(c.thumb, c.thumbUrl, p.thumb),
    domain: hostOf(url),
  });
}

function buildSticker(c: RawRecord): ZaloAttachment | null {
  const stickerId = firstPositiveNumber(c.id, c.stickerId, c.sticker_id);
  if (stickerId === undefined) return null;
  return compact({
    kind: "sticker",
    sticker_id: stickerId,
    cate_id: firstPositiveNumber(c.cateId, c.catId, c.cate_id),
    sticker_type: Number.isFinite(Number(c.type)) ? Number(c.type) : undefined,
    url: firstUsableUrl(c.stickerWebpUrl, c.stickerUrl, c.url, c.href),
  });
}

function buildLocation(c: RawRecord): ZaloAttachment | null {
  const p = parseParams(c.params);
  const lat = Number(c.latitude ?? c.lat ?? p.latitude ?? p.lat);
  const lon = Number(c.longitude ?? c.lon ?? c.lng ?? p.longitude ?? p.lon ?? p.lng);
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lon) && (lat !== 0 || lon !== 0);
  const url = firstUsableUrl(c.href, p.href);
  if (!hasCoords && !url) return null;
  return compact({
    kind: "location",
    lat: hasCoords ? lat : undefined,
    lon: hasCoords ? lon : undefined,
    url: url || (hasCoords ? `https://www.google.com/maps?q=${lat},${lon}` : undefined),
    title: firstText(c.title),
    address: firstText(c.description, c.desc, p.address),
  });
}

export function extractContactPhone(c: RawRecord, p?: RawRecord): string | undefined {
  if (p && typeof p.phone === "string" && p.phone.trim()) return p.phone.trim();
  if (typeof c.phone === "string" && c.phone.trim()) return c.phone.trim();

  // Zalo contact card formats phone inside JSON description: {"phone":"0909369898", "caption":"0909369898", ...}
  const sources = [c.description, c.desc, p?.description, p?.desc];
  for (const rawDesc of sources) {
    if (typeof rawDesc === "string" && rawDesc.trim()) {
      try {
        const parsed = JSON.parse(rawDesc.trim());
        if (parsed && typeof parsed.phone === "string" && parsed.phone.trim()) {
          return parsed.phone.trim();
        }
        if (parsed && typeof parsed.caption === "string" && /^[0-9+ ]{9,15}$/.test(parsed.caption.trim())) {
          return parsed.caption.trim().replace(/\s+/g, "");
        }
      } catch {
        const direct = rawDesc.trim().replace(/[^0-9+]/g, "");
        if (direct.length >= 9 && direct.length <= 15) return direct;
      }
    }
  }
  return undefined;
}

function buildContact(c: RawRecord): ZaloAttachment | null {
  const p = parseParams(c.params);
  return compact({
    kind: "contact",
    url: firstUsableUrl(c.href, p.href),
    name: firstText(c.title, p.name, p.displayName),
    avatar_url: firstUsableUrl(c.thumb, c.thumbUrl, p.avatar),
    phone: extractContactPhone(c, p),
  });
}

/**
 * Thẻ chia sẻ tài khoản ngân hàng (zinstant.bankcard) — trích xuất data_url
 * (chứa template HTML hiển thị tên ngân hàng, số TK, logo, QR VietQR) và
 * các trường đã bóc tách sẵn nếu có.
 */
function buildBankcard(c: RawRecord): ZaloAttachment | null {
  const p = parseParams(c.params);
  const pcItem = p.pcItem && typeof p.pcItem === "object" ? (p.pcItem as RawRecord) : null;
  const item = p.item && typeof p.item === "object" ? (p.item as RawRecord) : null;
  const bubbleItem = p.bubbleItem && typeof p.bubbleItem === "object" ? (p.bubbleItem as RawRecord) : null;

  let dataUrl =
    (typeof pcItem?.data_url === "string" && pcItem.data_url) ||
    (typeof item?.data_url === "string" && item.data_url) ||
    (typeof bubbleItem?.data_url === "string" && bubbleItem.data_url) ||
    (typeof c.data_url === "string" && c.data_url) ||
    (typeof c.url === "string" && c.url) ||
    "";

  if (!dataUrl && c) {
    try {
      const rawStr = JSON.stringify(c);
      const m = rawStr.match(/https?:\/\/[^"'\s\\]*zadn\.vn[^"'\s\\]*/i);
      if (m) {
        dataUrl = m[0].replace(/\\u0026/g, "&").replace(/\\/g, "");
      }
    } catch {
      /* ignore */
    }
  }

  if (dataUrl && !dataUrl.includes("data=html")) {
    dataUrl = dataUrl.includes("?") ? `${dataUrl}&data=html` : `${dataUrl}?data=html`;
  }

  return compact({
    kind: "bankcard",
    url: dataUrl || undefined,
    data_url: dataUrl || undefined,
    bank_name: typeof c.bank_name === "string" ? c.bank_name : typeof p.bank_name === "string" ? p.bank_name : undefined,
    account_number: typeof c.account_number === "string" ? c.account_number : typeof p.account_number === "string" ? p.account_number : undefined,
    qr_url: typeof c.qr_url === "string" ? c.qr_url : typeof p.qr_url === "string" ? p.qr_url : undefined,
    logo_url: typeof c.logo_url === "string" ? c.logo_url : typeof p.logo_url === "string" ? p.logo_url : undefined,
    bg_url: typeof c.bg_url === "string" ? c.bg_url : typeof p.bg_url === "string" ? p.bg_url : undefined,
    bin: typeof c.bin === "string" ? c.bin : typeof p.bin === "string" ? p.bin : undefined,
  }) as ZaloAttachment;
}

const BUILDERS: Record<ZaloAttachmentKind, (c: RawRecord) => ZaloAttachment | null> = {
  image: (c) => buildImage(c, "image"),
  gif: (c) => buildImage(c, "gif"),
  video: buildVideo,
  voice: buildVoice,
  file: buildFile,
  link: buildLink,
  sticker: buildSticker,
  location: buildLocation,
  contact: buildContact,
  bankcard: buildBankcard,
};

function looksLikeSticker(c: RawRecord): boolean {
  return Number.isFinite(Number(c.id)) && Number.isFinite(Number(c.cateId));
}

/**
 * Đoán kind từ SHAPE của content khi không có msg_kind/msgType (row cũ).
 * Cố ý KHÔNG đoán theo tên miền (kiểu "url có chữ zalo/thumb → ảnh") — đó
 * chính là logic sai đã gây ra bug link-thành-ảnh.
 */
function guessKind(c: RawRecord): ZaloMessageKind {
  const action = typeof c.action === "string" ? c.action.toLowerCase() : "";
  if (action.includes("bankcard") || action.includes("bank")) return "bankcard";

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

  // Ảnh Zalo luôn có ít nhất 1 field ảnh chuyên dụng. KHÔNG xét `href` ở đây:
  // link/file cũng có href — đúng chỗ code cũ nhầm.
  if (c.hdUrl || c.oriUrl || c.normalUrl || c.rawUrl || c.thumbUrl || p.hdUrl || p.normalUrl || p.rawUrl) {
    return "image";
  }
  if (IMAGE_EXT_RE.test(probe)) return "image";

  if (c.fileName || p.fileName || p.fileExt || p.extention || fileUrl) return "file";
  if (Number.isFinite(Number(c.latitude ?? c.lat)) && Number.isFinite(Number(c.longitude ?? c.lon ?? c.lng))) {
    return "location";
  }
  // Tin chia sẻ DANH THIẾP luôn kèm số điện thoại (yêu cầu người dùng
  // 2026-09-18: "tin có SĐT thì hiểu là danh thiếp") — kiểm tra TRƯỚC nhánh
  // 'link' chung, mirror đúng bridge (messageContent.js guessKindFromContent()).
  if (typeof p.phone === "string" && p.phone.trim()) return "contact";
  if (isUsableUrl(href)) return "link";
  return "text";
}

/**
 * Zalo dùng CHUNG 1 "khuôn" content cho rất nhiều loại THÔNG BÁO HỆ THỐNG
 * khác nhau trong nhóm/hội thoại — không phải tin nhắn thật của ai cả:
 * {action, title, thumb, href:"", params:"{...}", childnumber, description}.
 * Đã xác nhận trực tiếp trên dữ liệu thật (2026-09-14) ít nhất 4 loại:
 *   - action="msginfo.actionlist" (kết bạn): title ĐÃ là câu hoàn chỉnh
 *     "Bạn vừa kết bạn với <Tên>".
 *   - action="vote" (tham gia bình chọn) / "close" (đóng bình chọn) — cả 2
 *     đều có params.pollId + params.question: BẤT KỲ action nào đi kèm
 *     pollId đều coi là hoạt động bình chọn (đề phòng Zalo còn action khác
 *     chưa gặp, vd "reopen"/"extend"...) — hiện gọn "<Tên> đang bình chọn"
 *     thay vì ghép câu dài từ params.msg.vi (dồn dập nhiều tin vote liên
 *     tiếp thì câu dài đọc rối hơn là có ích).
 *   - action="recommened.calltime" (thông báo cuộc gọi): title có giá trị
 *     nhưng không phải câu người đọc được ("sendBubbleMessage"), không có
 *     params.msg.vi lẫn pollId — vẫn rơi về nhánh "unknown" cũ, KHÔNG cố
 *     đoán bừa cho action lạ (thà hiện fallback cũ còn hơn hiện sai).
 *
 * Đặc điểm CHUNG để phân biệt với tin CHIA SẺ LINK/DANH THIẾP thật
 * (chat.recommended — cũng có field `action` và đôi khi `title`): loại đó
 * LUÔN có `href` thật (chính là mục đích của tin), còn mọi thông báo hệ
 * thống loại này đều có `href: ""` — dùng làm điều kiện chặn false-positive.
 *
 * Trước đây các tin này rơi vào nhánh "unknown" (guessKind không nhận ra
 * shape lạ) nên hiện thẳng fallback "Tin nhắn dạng đặc biệt — mở Zalo để
 * xem", gây khó hiểu — đặc biệt rối khi 1 nhóm có bình chọn đang chạy, hàng
 * chục tin "vote" dồn dập đều hiện y hệt fallback đó.
 */
function systemActionText(c: RawRecord): string | null {
  if (!c || typeof c !== "object" || typeof c.action !== "string" || !c.action) return null;
  if (typeof c.href === "string" && c.href.trim()) return null; // tin chia sẻ link/danh thiếp thật

  const title = typeof c.title === "string" ? c.title.trim() : "";
  if (title && /kết bạn|bạn bè/i.test(title)) return title;

  const p = parseParams(c.params);
  const dName = typeof p.dName === "string" ? p.dName.trim() : "";

  // Mọi hoạt động BÌNH CHỌN (vote/đóng/...) đều mang params.pollId — bắt theo
  // field này (thay vì liệt kê từng action) để bao quát cả action nào khác
  // chưa gặp trong dữ liệu thật, miễn cùng thuộc luồng bình chọn.
  if (typeof p.pollId !== "undefined") {
    const who = dName ? `${dName} ` : "";
    return c.action === "close" ? `${who}đã kết thúc bình chọn`.trim() : `${who}đang bình chọn`.trim();
  }

  const msgTemplates = p.msg && typeof p.msg === "object" && !Array.isArray(p.msg) ? (p.msg as RawRecord) : null;
  const template = msgTemplates && typeof msgTemplates.vi === "string" ? msgTemplates.vi.trim() : "";
  if (!template) return null;

  const question = typeof p.question === "string" ? p.question.trim() : "";
  const text = template.replace("%1$s", dName || "Có người").replace("%2$s", question);
  return text.trim() || null;
}

/**
 * Zalo dùng hệ thống "zinstant" (thẻ rich content mã hoá — vd chia sẻ tài
 * khoản ngân hàng `action: "zinstant.bankcard"`, hiện logo ngân hàng + mã QR)
 * để hiển thị các loại thẻ đặc biệt. Nội dung THẬT (tên ngân hàng, số tài
 * khoản, QR...) được Zalo TỰ RENDER từ 1 template mã hoá
 * (`params.item.data_url`, kèm checksum) — KHÔNG thể tái dựng lại phía ta.
 * Nhưng payload LUÔN kèm `params.customMsg.msg.vi` — đúng chuỗi fallback
 * Zalo tự dùng khi client không hỗ trợ render template đó (vd
 * "[Tài khoản ngân hàng]") — dùng chuỗi này thay cho fallback chung chung
 * "Tin nhắn dạng đặc biệt — mở Zalo để xem" (yêu cầu người dùng 2026-09-21).
 */
function zinstantFallbackLabel(c: RawRecord): string | null {
  if (!c || typeof c !== "object") return null;
  const p = parseParams(c.params);
  const customMsg = p.customMsg && typeof p.customMsg === "object" ? (p.customMsg as RawRecord) : null;
  const msgTemplates = customMsg?.msg && typeof customMsg.msg === "object" ? (customMsg.msg as RawRecord) : null;
  const label = msgTemplates && typeof msgTemplates.vi === "string" ? msgTemplates.vi.trim() : "";
  return label || null;
}

function refineRecommendedKind(c: RawRecord): ZaloAttachmentKind {
  const action = typeof c.action === "string" ? c.action.toLowerCase() : "";
  if (action.includes("bankcard") || action.includes("bank")) return "bankcard";
  if (action.includes("user") || action.includes("contact") || action.includes("profile")) return "contact";
  if (action.includes("video")) return "video";
  // Có SĐT trong params hoặc description → chắc chắn là danh thiếp dù action không nói rõ.
  const p = parseParams(c.params);
  if (extractContactPhone(c, p)) return "contact";
  return "link";
}

function isAttachmentKind(kind: ZaloMessageKind): kind is ZaloAttachmentKind {
  return kind !== "text" && kind !== "unknown" && kind !== "system_notice";
}

function normalizeOne(content: unknown, kind: ZaloMessageKind): ZaloAttachment | null {
  if (!content || typeof content !== "object") return null;
  const c = content as RawRecord;
  const primary = isAttachmentKind(kind) ? BUILDERS[kind] : undefined;
  const built = primary ? primary(c) : null;
  if (built) return built;
  const guessed = guessKind(c);
  if (guessed !== kind && isAttachmentKind(guessed)) return BUILDERS[guessed](c);
  return null;
}

/** Row `zalo_messages` (chỉ những cột cần cho phân loại). */
export type StoredMessageRow = {
  msg_kind?: string | null;
  attachments?: unknown;
  raw_content?: unknown;
  image_urls?: unknown;
  content?: string | null;
};

function attachmentsFromStoredColumn(value: unknown): ZaloAttachment[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (a): a is ZaloAttachment =>
      !!a && typeof a === "object" && typeof (a as ZaloAttachment).kind === "string"
  );
}

/**
 * Kết quả cuối cùng cho UI: luôn có `kind` + `attachments` đã chuẩn hoá.
 *
 * Thứ tự ưu tiên:
 *   1. Cột `attachments` (bridge đã phân loại sẵn — tin nhắn mới).
 *   2. `raw_content` → phân loại lại tại đây (tin nhắn cũ, từ 2026-09-04).
 *   3. `image_urls` → coi là ảnh (tin nhắn rất cũ, không còn dữ liệu khác).
 */
export function normalizeStoredMessage(row: StoredMessageRow): {
  kind: ZaloMessageKind;
  attachments: ZaloAttachment[];
  /** Chỉ có khi kind === "system_notice" — dòng chữ hiện căn giữa. */
  system_text?: string;
  /** Chỉ có khi kind === "unknown" VÀ payload là thẻ "zinstant" (vd danh
   *  thiếp ngân hàng) — nhãn cụ thể hơn thay cho "Tin nhắn dạng đặc biệt"
   *  chung chung, xem zinstantFallbackLabel(). */
  unknown_label?: string;
} {
  let raw = row.raw_content;
  if (typeof raw === "string" && (raw.trim().startsWith("{") || raw.trim().startsWith("["))) {
    try {
      raw = JSON.parse(raw);
    } catch {
      // ignore
    }
  }

  // Quét toàn diện tìm thẻ tài khoản ngân hàng zinstant.bankcard (cho cả tin mới và toàn bộ tin cũ từ trước đến nay)
  const rawList = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? [raw] : [];
  const bankItem = rawList.find(
    (item) =>
      item &&
      typeof item === "object" &&
      (String((item as RawRecord).action ?? "").toLowerCase().includes("bankcard") ||
        String((item as RawRecord).params ?? "").includes("zinstant.bankcard") ||
        String((item as RawRecord).params ?? "").includes("templateId=11845") ||
        String((item as RawRecord).title ?? "").toLowerCase().includes("tài khoản ngân hàng") ||
        JSON.stringify(item).includes("zinst-stc.zadn.vn") ||
        (row.content && /\[?tài khoản ngân hàng\]?/i.test(row.content.trim())))
  ) as RawRecord | undefined;

  if (bankItem) {
    const card = buildBankcard(bankItem);
    if (card && (card.data_url || card.account_number)) {
      return { kind: "bankcard", attachments: [card] };
    }
  }

  const rawFirst =
    raw && typeof raw === "object" ? ((Array.isArray(raw) ? raw[0] : raw) as RawRecord) : null;

  // Thông báo hệ thống (kết bạn/vote...) PHẢI được nhận diện qua raw_content
  // TRƯỚC shortcut "content bắt đầu bằng https → link" ngay dưới đây. Lý do:
  // 1 bug ở tầng ghi (bridge, đã sửa 2026-09-18 — xem isSystemNoticeShape() ở
  // messageContent.js) từng khiến `content` của thông báo hệ thống bị lưu
  // NHẦM thành 1 URL avatar/thumb kẹt trong params. Nếu shortcut bên dưới
  // chạy trước, nó khoá cứng row đó thành "text" vĩnh viễn dù raw_content vẫn
  // còn nguyên đủ dữ liệu để nhận ra đúng là system_notice.
  if (rawFirst) {
    const noticeText = systemActionText(rawFirst);
    if (noticeText) {
      return { kind: "system_notice", attachments: [], system_text: noticeText };
    }
  }

  // Yêu cầu người dùng (2026-09-17): nội dung TRẦN bắt đầu bằng http(s) LUÔN
  // hiểu là link thường, bất kể raw_content/msgType nói gì. Lý do có bug này:
  // Zalo đôi khi tự gắn msgType "chat.recommended" cho tin CHÍNH NGƯỜI DÙNG
  // tự gõ/dán 1 URL trần (không phải share link có thumbnail thật) nhưng
  // payload lúc đó KHÔNG có field href đúng chỗ buildLink() cần → dựng link
  // thất bại → rơi vào kind khác "text" với attachments rỗng → UI hiện
  // fallback "Tin nhắn dạng đặc biệt — mở Zalo để xem" dù nội dung thật (URL)
  // vẫn nằm nguyên trong `content`. Ưu tiên kiểm tra này TRƯỚC MỌI phân loại
  // khác để không bao giờ rơi vào fallback đó với 1 URL trần — text thường
  // đã tự bôi link/bấm được qua linkifyText() (ZaloChatPanel.tsx).
  if (typeof row.content === "string" && /^https?:\/\//i.test(row.content.trim())) {
    return { kind: "text", attachments: [] };
  }

  const stored = attachmentsFromStoredColumn(row.attachments);
  if (stored.length > 0) {
    const kind = (row.msg_kind as ZaloMessageKind) || stored[0].kind;
    // Bổ sung SĐT cho danh thiếp cũ trong DB nếu raw_content có
    if (rawFirst) {
      const p = parseParams(rawFirst.params);
      for (const a of stored) {
        if (a.kind === "contact" && !a.phone) {
          const ph = extractContactPhone(rawFirst, p);
          if (ph) a.phone = ph;
        }
      }
    }
    return { kind, attachments: stored };
  }

  if (raw && typeof raw === "object") {
    const first = rawFirst as RawRecord;

    let kind: ZaloMessageKind =
      (row.msg_kind && row.msg_kind !== "text" ? (row.msg_kind as ZaloMessageKind) : undefined) ||
      MSG_TYPE_KIND[String(first?.msgType ?? "")] ||
      guessKind(first || {});
    if (kind === "link") kind = refineRecommendedKind(first || {});

    const items = Array.isArray(raw) ? raw : [raw];
    const attachments = items.map((item) => normalizeOne(item, kind)).filter((a): a is ZaloAttachment => !!a);
    if (attachments.length > 0) return { kind: attachments[0].kind, attachments };
    // raw_content có nhưng không dựng được gì (vd sticker chưa resolve URL,
    // hoặc thẻ "zinstant" như danh thiếp ngân hàng — không thể render, chỉ
    // còn cách hiện nhãn fallback) — vẫn trả đúng kind để UI hiện placeholder
    // thay vì bong bóng rỗng.
    if (kind !== "text") {
      const label = zinstantFallbackLabel(first);
      return { kind, attachments: [], ...(label ? { unknown_label: label } : {}) };
    }
  }

  // Tin rất cũ: chỉ còn image_urls. Ở đây KHÔNG lọc lại được link/video lẫn
  // trong đó (raw_content đã mất) — nhưng vẫn chặn được url .mp4/.m3u8 lọt vào
  // thẻ <img>, coi chúng là video để ít nhất còn bấm phát được.
  const urls = Array.isArray(row.image_urls) ? row.image_urls.filter(isUsableUrl) : [];
  if (urls.length > 0) {
    const attachments = urls.map<ZaloAttachment>((url) =>
      VIDEO_EXT_RE.test(url) || HLS_EXT_RE.test(url)
        ? { kind: "video", url }
        : AUDIO_EXT_RE.test(url)
          ? { kind: "voice", url }
          : { kind: GIF_EXT_RE.test(url) ? "gif" : "image", url }
    );
    return { kind: attachments[0].kind, attachments };
  }

  return { kind: row.content?.trim() ? "text" : (row.msg_kind as ZaloMessageKind) || "text", attachments: [] };
}

const KIND_LABEL: Record<string, string> = {
  image: "[Hình ảnh]",
  gif: "[Ảnh động]",
  video: "[Video]",
  voice: "[Tin nhắn thoại]",
  file: "[Tệp đính kèm]",
  link: "[Liên kết]",
  sticker: "[Sticker]",
  location: "[Vị trí]",
  contact: "[Danh thiếp]",
  unknown: "[Tin nhắn]",
};

/** Nhãn ngắn cho preview (danh sách hội thoại, tin trích dẫn...). */
export function kindLabel(kind: ZaloMessageKind): string {
  return KIND_LABEL[kind] || "";
}

/**
 * Dòng preview ở danh sách hội thoại. Tin đính kèm có `content` rỗng (nội dung
 * thật là object) — không có hàm này thì sidebar hiện dòng TRẮNG, không biết
 * vừa nhận được gì. Giữ khớp previewTextFor() ở bridge (messageContent.js).
 */
export function previewText(input: {
  text?: string | null;
  kind?: ZaloMessageKind | null;
  attachments?: ZaloAttachment[] | null;
}): string {
  if (input.text && input.text.trim()) return input.text.trim();
  const first = input.attachments?.[0];
  if (!first) return input.kind && input.kind !== "text" ? kindLabel(input.kind) : "";
  if (first.kind === "link") return `${KIND_LABEL.link} ${first.title || first.url || ""}`.trim();
  if (first.kind === "file") return `${KIND_LABEL.file} ${first.name || ""}`.trim();
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
