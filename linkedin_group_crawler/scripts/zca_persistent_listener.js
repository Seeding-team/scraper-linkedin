#!/usr/bin/env node

const { Zalo, ThreadType } = require("zca-js");
const fs = require("fs");

// Đảm bảo mọi emit ra stdout được flush ngay lập tức (không buffer).
// Trên Windows, pipe Popen có buffer ~4KB, nếu không flush kịp sẽ block Node process.
if (require.main === module) {
  if (process.stdout._handle && typeof process.stdout._handle.setBlocking === "function") {
    process.stdout._handle.setBlocking(true);
  }
  process.stdout.write = new Proxy(process.stdout.write.bind(process.stdout), {
    apply(target, thisArg, args) {
      const result = target(...args);
      // Force flush ngay sau mỗi write.
      try {
        if (thisArg._handle && typeof thisArg._handle.flush === "function") {
          thisArg._handle.flush();
        }
      } catch (_) {
        /* ignore */
      }
      return result;
    },
  });
}

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch (_error) {
    return String(value);
  }
}

function emit(payload) {
  const line = `${JSON.stringify({ ts: Date.now(), ...payload })}\n`;
  try {
    fs.writeSync(1, line);
  } catch (_) {
    process.stdout.write(line);
  }
}

function serializeError(error) {
  if (!error) return { name: "Error", message: "Unknown error", code: null };
  if (error instanceof Error) {
    return {
      name: error.name || "Error",
      message: error.message || String(error),
      code: error.code ?? null,
      stack: error.stack || null,
    };
  }
  if (typeof error === "object") {
    return {
      name: error.name || "NonError",
      message: error.message || safeJson(error),
      code: error.code ?? null,
      raw: error,
    };
  }
  return { name: "Error", message: String(error), code: null };
}

// ── Debug logs ra stderr (Python sẽ capture và log lên) ─────────────────────
function debugLog(stage, extra = {}) {
  emit({ event: "debug", stage, ...extra });
}

function readStdinJson() {
  return new Promise((resolve, reject) => {
    let raw = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      raw += chunk;
    });
    process.stdin.on("end", () => {
      try {
        resolve(raw.trim() ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    process.stdin.on("error", reject);
  });
}

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith("--")) continue;
    const name = key.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[name] = true;
    } else {
      args[name] = next;
      i += 1;
    }
  }
  return args;
}

function normalizeCookieJar(cookies) {
  if (!cookies) return null;
  let parsed = typeof cookies === "string" ? JSON.parse(cookies) : cookies;
  
  if (Array.isArray(parsed)) {
    parsed = parsed.map(c => {
      let e = c.expires || c.expirationDate;
      if (typeof e === 'number') {
        c.expires = new Date(e * 1000).toISOString();
      }
      return c;
    });
    return parsed;
  }
  
  if (parsed && Array.isArray(parsed.cookies)) {
    parsed.cookies = parsed.cookies.map(c => {
      let e = c.expires || c.expirationDate;
      if (typeof e === 'number') {
        c.expires = new Date(e * 1000).toISOString();
      }
      return c;
    });
  }
  
  return parsed;
}

function valuesFromUnknown(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "object") return Object.values(value);
  return [];
}

function textOf(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(textOf).filter(Boolean).join(" ");
  if (typeof value === "object") {
    return (
      value.title ||
      value.text ||
      value.msg ||
      value.message ||
      value.description ||
      value.href ||
      ""
    );
  }
  return "";
}

function isLikelyImageUrl(value) {
  if (!/^https?:\/\//i.test(value)) return false;
  if (/\.(png|jpe?g|webp|gif)(\?|#|$)/i.test(value)) return true;
  return /(photo|image|img|thumb|avatar|zalo|zstatic|zadn|zaloapp)/i.test(value);
}

function isLikelyVideoUrl(value) {
  if (!/^https?:\/\//i.test(value)) return false;
  return /\.(mp4|webm|mov|m4v|3gp)(\?|#|$)/i.test(value);
}

// msgType Zalo đã tự phân loại rõ ràng — TIN vào giá trị này, không suy luận
// lại từ URL. Lý do: url video/file/voice/avatar cũng host trên domain zdn.vn/
// zadn.vn giống ảnh, nên heuristic isLikelyImageUrl dễ nhận NHẦM non-image thành "image".
const STRUCTURED_MEDIA_MSG_TYPES = new Set([
  "chat.photo", "chat.gif", "chat.doodle",
  "chat.video.msg", "chat.voice", "share.file", "chat.sticker",
]);
const IMAGE_LIKE_MSG_TYPES = new Set(["chat.photo", "chat.gif", "chat.doodle"]);

const CALL_ACTIONS = new Set([
  "recommened.misscall", "recommened.calltime", "recommened.calling", "recommened.receivecall",
  "recommended.misscall", "recommended.calltime", "recommended.calling", "recommended.receivecall",
]);
const CONTACT_ACTIONS = new Set([
  "recommened.user", "recommened.vip", "show.profile",
  "recommended.user", "recommended.vip",
]);
const LINK_ACTIONS = new Set([
  "recommened.link", "recommened.minisite", "recommened.miniapp",
  "recommened.oa", "recommened.zvideo", "recommened.article", "recommened.post",
  "recommended.link", "recommended.minisite", "recommended.miniapp",
  "recommended.oa", "recommended.zvideo", "recommended.article", "recommended.post",
]);
const SYSTEM_NOTICE_MSG_TYPES = new Set([
  "group.event", "group.leave", "friend.event", "chat.ecard",
  "group.poll", "chat.poll", "chat.reminder", "chat.todo",
  "chat.list.action", "chat.e2ee.replace", "chat.delete",
  "chat.delete.everyone", "chat.vanish", "chat.reaction", "chat._jumpToMessage",
]);
const SYSTEM_NOTICE_ACTIONS = new Set([
  "msginfo.actionlist", "recommened.friend", "recommended.friend",
  "todo.remind", "todo.remind2",
]);
const STRUCTURED_CONTENT_KEYS = new Set([
  "action", "href", "thumb", "title", "params", "zinstantdata_id", "zinstant_data",
  "template_id", "templateId", "data_url", "lat", "latitude", "lo", "longitude",
  "id", "catId", "cate_id", "message", "description", "type", "fileExt", "fileSize",
]);
const NON_BANKCARD_ZINSTANT_TEMPLATE_IDS = new Set([14875, 17123]);

function parseJsonObjectLoose(value) {
  if (!value) return null;
  if (typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    let parsed = JSON.parse(trimmed);
    if (typeof parsed === "string" && parsed.trim().startsWith("{")) {
      parsed = JSON.parse(parsed.trim());
    }
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch (_) {
    /* ignore */
  }
  return null;
}

function unwrapStructuredContent(rawContent, msgType) {
  if (rawContent && typeof rawContent === "object" && !Array.isArray(rawContent)) {
    return rawContent;
  }
  const parsed = parseJsonObjectLoose(rawContent);
  if (!parsed) return null;
  // Legacy type === "group" rows store contact/recommended payload as raw JSON string.
  if (msgType === "group" || msgType === "chat.recommended" || msgType === "chat.webcontent" || msgType === "chat.webcontent.v2") {
    return parsed;
  }
  for (const key of Object.keys(parsed)) {
    if (STRUCTURED_CONTENT_KEYS.has(key)) return parsed;
  }
  return null;
}

function extractTemplateId(contentObj, paramsObj, dataObj) {
  const candidates = [
    contentObj && contentObj.template_id,
    contentObj && contentObj.templateId,
    paramsObj && paramsObj.template_id,
    paramsObj && paramsObj.templateId,
    paramsObj && paramsObj.item && (paramsObj.item.template_id ?? paramsObj.item.templateId),
    paramsObj && paramsObj.pcItem && (paramsObj.pcItem.template_id ?? paramsObj.pcItem.templateId),
    dataObj && (dataObj.template_id ?? dataObj.templateId),
  ];
  for (const c of candidates) {
    if (c != null && c !== "" && Number.isFinite(Number(c))) {
      return Number(c);
    }
  }
  const zinstantIds = [
    contentObj && contentObj.zinstantdata_id,
    paramsObj && paramsObj.zinstantdata_id,
    dataObj && dataObj.zinstantdata_id,
  ];
  for (const zid of zinstantIds) {
    if (typeof zid === "string") {
      const m = zid.match(/templateId\s*=\s*(\d+)/i);
      if (m) return Number(m[1]);
    }
  }
  return null;
}

function extractBankcardDataUrl(contentObj, paramsObj, dataObj) {
  const zdata = parseJsonObjectLoose(contentObj && contentObj.zinstant_data)
    || parseJsonObjectLoose(paramsObj && paramsObj.zinstant_data);
  const candidates = [
    contentObj && contentObj.data_url,
    paramsObj && paramsObj.data_url,
    paramsObj && paramsObj.item && paramsObj.item.data_url,
    paramsObj && paramsObj.pcItem && paramsObj.pcItem.data_url,
    zdata && zdata.data_url,
    dataObj && dataObj.data_url,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && /^https?:\/\//i.test(c.trim())) {
      return c.trim();
    }
  }
  return null;
}

function formatMsgInfoActionlistText(contentObj, paramsObj) {
  const msgObj = paramsObj && paramsObj.msg;
  let template = "";
  if (msgObj && typeof msgObj === "object") {
    template = String(msgObj.vi || msgObj.en || "").trim();
  } else if (typeof msgObj === "string") {
    template = msgObj.trim();
  }
  if (template) {
    const highlights = Array.isArray(paramsObj && paramsObj.highLightsV2)
      ? paramsObj.highLightsV2
      : (Array.isArray(paramsObj && paramsObj.highLights) ? paramsObj.highLights : []);
    let resolved = template;
    highlights.forEach((h, idx) => {
      const label = (h && typeof h === "object")
        ? String(h.content || h.title || h.text || h.name || "").trim()
        : String(h || "").trim();
      if (label) {
        resolved = resolved.replace(new RegExp(`%${idx + 1}\\$s`, "g"), label);
        resolved = resolved.replace(new RegExp(`\\$${idx}\\$`, "g"), label);
      }
    });
    resolved = resolved.replace(/%\d+\$s/g, "").replace(/\$\d+\$/g, "").replace(/\s{2,}/g, " ").trim();
    if (resolved) return resolved;
  }
  const title = contentObj && typeof contentObj.title === "string" ? contentObj.title.trim() : "";
  return title || "Thông báo hệ thống";
}

function formatCallSummaryVi(action, paramsObj, isSent) {
  const act = String(action || "").toLowerCase();
  const params = paramsObj && typeof paramsObj === "object" ? paramsObj : {};
  let isCaller;
  if (typeof params.isCaller === "boolean") {
    isCaller = params.isCaller;
  } else if (params.isCaller != null) {
    isCaller = Boolean(Number(params.isCaller));
  } else if (act.includes("calling")) {
    isCaller = true;
  } else if (act.includes("receivecall")) {
    isCaller = false;
  } else {
    isCaller = Boolean(isSent);
  }
  const rawCallType = params.calltype ?? params.callType ?? params.type ?? 0;
  const isVideo = Number(rawCallType) === 1 || Number(rawCallType) === 3 || Boolean(params.isVideo);
  const reason = params.reason != null ? Number(params.reason) : 0;
  const isMissed = act.includes("misscall");

  if (isCaller) {
    if (isMissed) {
      if (reason === 4 || reason === 5) return "Bạn đã hủy";
      if (reason === 3) return "Người nhận từ chối";
      if (reason === 1) return "Người nhận bận";
    }
    return isVideo ? "Cuộc gọi video đi" : "Cuộc gọi thoại đi";
  }
  if (isMissed) {
    if (reason === 3) return "Bạn đã từ chối";
    return isVideo ? "Cuộc gọi video nhỡ" : "Cuộc gọi thoại nhỡ";
  }
  return isVideo ? "Cuộc gọi video đến" : "Cuộc gọi thoại đến";
}

function formatFileNameWithExt(title, fileExt) {
  const cleanTitle = String(title || "").trim();
  const cleanExt = String(fileExt || "").trim().replace(/^\.+/, "");
  if (!cleanTitle) return cleanExt ? `file.${cleanExt}` : "";
  if (!cleanExt) return cleanTitle;
  const suffix = `.${cleanExt}`;
  if (cleanTitle.toLowerCase().endsWith(suffix.toLowerCase())) {
    return cleanTitle;
  }
  return `${cleanTitle}${suffix}`;
}

function extractFileMetadata(contentObj, paramsObj, fileNameHint) {
  const rawTitle = (contentObj && typeof contentObj.title === "string" && contentObj.title.trim())
    || (contentObj && typeof contentObj.fileName === "string" && contentObj.fileName.trim())
    || (paramsObj && typeof paramsObj.fileName === "string" && paramsObj.fileName.trim())
    || fileNameHint
    || "";
  const fileExt = String(
    (paramsObj && paramsObj.fileExt)
    || (contentObj && contentObj.fileExt)
    || ""
  ).trim().replace(/^\.+/, "") || null;
  const rawSize = (paramsObj && (paramsObj.fileSize ?? paramsObj.totalSize))
    ?? (contentObj && contentObj.fileSize)
    ?? null;
  const fileSize = rawSize != null && rawSize !== "" && Number.isFinite(Number(rawSize))
    ? Number(rawSize)
    : null;
  const fdataObj = parseJsonObjectLoose(paramsObj && paramsObj.fdata) || (paramsObj && paramsObj.fdata) || {};
  const fTypeVal = fdataObj && fdataObj.fType != null
    ? Number(fdataObj.fType)
    : (paramsObj && paramsObj.fType != null ? Number(paramsObj.fType) : null);
  const isFolder = fTypeVal === 2;
  const fileName = isFolder ? rawTitle : formatFileNameWithExt(rawTitle, fileExt);
  return {
    fileName: fileName || null,
    fileExt,
    fileSize,
    isFolder,
  };
}

function sanitizeUglyFallbackText(text) {
  if (typeof text !== "string") return "";
  let s = text.trim();
  if (!s) return "";
  if (s.toLowerCase() === "sendbubblemessage") return "";
  s = s.replace(/\s*[—–-]+\s*mở\s+zalo\s+để\s+xem\.?\s*$/i, "").trim();
  if (/^[{[]/.test(s)) {
    try {
      JSON.parse(s);
      return "";
    } catch (_) {
      /* ordinary text starting with bracket */
    }
  }
  return s;
}

function classifyMessageKind({ msgType, action, templateId, contentObj, rawContent }) {
  const mt = String(msgType || "text").trim();
  const act = String(action || "").trim().toLowerCase();

  // 1. Undo / recall
  if (mt === "chat.undo" || mt === "recalled") {
    return "undo";
  }

  // 2. Bankcard (zinstant.bankcard, templateId=11845, chat.webcontent / chat.webcontent.v2)
  if (act === "zinstant.bankcard" || Number(templateId) === 11845) {
    return "bankcard";
  }
  if (mt === "chat.webcontent" || mt === "chat.webcontent.v2") {
    if (templateId != null && NON_BANKCARD_ZINSTANT_TEMPLATE_IDS.has(Number(templateId))) {
      return "system_notice";
    }
    return "bankcard";
  }

  // 3. Call actions inside chat.recommended
  if (CALL_ACTIONS.has(act)) {
    return "call";
  }

  // 4. eCard & system notices (check chat.ecard BEFORE show.profile so friend-accept ecards stay system_notice!)
  if (mt === "chat.ecard") {
    return "system_notice";
  }
  if (SYSTEM_NOTICE_MSG_TYPES.has(mt) || SYSTEM_NOTICE_ACTIONS.has(act)) {
    return "system_notice";
  }

  // 5. Contact / Danh thiếp (including legacy type === "group" wrapping recommened.user)
  if (mt === "chat.contact" || CONTACT_ACTIONS.has(act)) {
    return "contact";
  }

  // 6. Location
  if (mt === "chat.location.new" || act === "recommened.location" || act === "recommended.location") {
    return "location";
  }

  // 7. GIF (note double-m "recommend.gif")
  if (mt === "chat.gif" || act === "recommend.gif" || act === "recommened.gif") {
    return "gif";
  }

  // 8. Sticker & stickerset
  if (mt === "chat.sticker" || act === "recommened.stickerset" || act === "recommended.stickerset") {
    return "sticker";
  }

  // 9. File / Folder
  if (mt === "share.file" || mt === "file") {
    return "file";
  }

  // 10. Video / Voice / Doodle / Photo
  if (mt === "chat.video.msg" || mt === "video") return "video";
  if (mt === "chat.voice" || mt === "voice") return "voice";
  if (mt === "chat.doodle" || mt === "doodle") return "doodle";
  if (mt === "chat.photo" || mt === "image") return "image";

  // 11. Link / MiniApp / OA / ZVideo / Article / Post
  if (mt === "chat.link" || mt === "chat.zalo.me" || LINK_ACTIONS.has(act)) {
    return "link";
  }

  // 12. Legacy "group" wrapper without recognized action
  if (mt === "group") {
    return "system_notice";
  }

  // 13. chat.recommended fallback
  if (mt === "chat.recommended") {
    if (contentObj && typeof contentObj.href === "string" && /^https?:\/\//i.test(contentObj.href)) {
      return "link";
    }
    return "text";
  }

  // 14. Rich text (rtf) & plain webchat/text
  if (act === "rtf") {
    return "text";
  }
  if (mt === "webchat" || mt === "text") {
    if (typeof rawContent === "string" && isLikelyImageUrl(rawContent.trim())) {
      return "image";
    }
    return "text";
  }

  return "text";
}

function resolveMessageType(msgType, imageUrlsCount, msgKind = null) {
  const mt = String(msgType || "text").trim();
  // Bảo toàn 100% hợp đồng chat.recommended cho cuộc gọi (parseZaloCallMessage) và card giàu dữ liệu.
  if (msgKind === "call" || mt === "chat.recommended") {
    return mt === "chat.recommended" ? "chat.recommended" : mt;
  }
  if (msgKind === "sticker") {
    return mt === "chat.recommended" ? "chat.recommended" : "chat.sticker";
  }
  if (msgKind === "bankcard" || msgKind === "contact" || msgKind === "link" || msgKind === "location" || msgKind === "system_notice" || msgKind === "undo") {
    return mt;
  }
  if (STRUCTURED_MEDIA_MSG_TYPES.has(mt)) {
    return IMAGE_LIKE_MSG_TYPES.has(mt) ? "image" : mt;
  }
  if (msgKind === "image") {
    return "image";
  }
  if (msgKind === "gif") {
    return "chat.gif";
  }
  if (msgKind === "doodle") {
    return "chat.doodle";
  }
  if (msgKind === "text") {
    return mt;
  }
  return imageUrlsCount ? "image" : mt;
}

function collectUrls(value, out = []) {
  if (!value) return out;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (isLikelyImageUrl(trimmed)) out.push(trimmed);
    if (/^[{[]/.test(trimmed)) {
      try { collectUrls(JSON.parse(trimmed), out); } catch (_) { /* ignore */ }
    }
    return Array.from(new Set(out));
  }
  if (Array.isArray(value)) {
    for (const item of value) collectUrls(item, out);
    return Array.from(new Set(out));
  }
  if (typeof value === "object") {
    let found = false;
    for (const key of ["hdUrl", "normalUrl", "url", "imageUrl", "photoUrl", "src", "fileUrl", "href", "stickerUrl", "stickerWebpUrl", "oriUrl", "rawUrl", "gifUrl", "thumbUrl"]) {
      if (value[key] && typeof value[key] === "string" && isLikelyImageUrl(value[key])) {
        out.push(value[key].trim());
        found = true;
        break; // Lấy 1 URL chất lượng cao nhất cho 1 object media, tránh gom cả hdUrl lẫn normalUrl/thumbUrl
      }
    }
    if (!found) {
      for (const item of Object.values(value)) collectUrls(item, out);
    }
  }
  return Array.from(new Set(out));
}

function collectMediaUrls(value, out = []) {
  if (!value) return out;
  if (typeof value === "string") {
    if (/^https?:\/\//i.test(value)) out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectMediaUrls(item, out);
    return out;
  }
  if (typeof value === "object") {
    let found = false;
    for (const key of [
      "hdUrl", "normalUrl", "thumbUrl", "url", "imageUrl", "photoUrl", "src",
      "fileUrl", "href", "stickerUrl", "stickerWebpUrl",
      "videoUrl", "video_url", "voiceUrl", "voice_url", "oriUrl", "rawUrl",
      "gifUrl", "downloadUrl", "download_url", "previewUrl", "preview_url",
    ]) {
      if (value[key] && typeof value[key] === "string" && /^https?:\/\//i.test(value[key])) {
        out.push(value[key]);
        found = true;
        break;
      }
    }
    if (found) {
      return Array.from(new Set(out));
    }
    for (const [key, item] of Object.entries(value)) {
      // Zalo hay double-encode "params"/"attach" thành 1 chuỗi JSON string
      // (thay vì object) — thử parse trước khi bỏ qua.
      if (typeof item === "string" && /^(params|attach|attachment|content)$/i.test(key) && /^[{[]/.test(item.trim())) {
        try {
          collectMediaUrls(JSON.parse(item), out);
          continue;
        } catch (_) {
          /* không phải JSON hợp lệ, bỏ qua */
        }
      }
      collectMediaUrls(item, out);
    }
  }
  return Array.from(new Set(out));
}

// Tên file thực (dùng cho share.file/doc) — Zalo để tên file ở "fileName"/"title"/"name".
function collectFileName(value) {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const name = collectFileName(item);
      if (name) return name;
    }
    return null;
  }
  for (const key of ["fileName", "title", "name"]) {
    if (typeof value[key] === "string" && value[key].trim()) return value[key].trim();
  }
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string" && /^(params|attach|attachment)$/i.test(key) && /^[{[]/.test(item.trim())) {
      try {
        const name = collectFileName(JSON.parse(item));
        if (name) return name;
      } catch (_) {
        /* ignore */
      }
      continue;
    }
    if (item && typeof item === "object") {
      const name = collectFileName(item);
      if (name) return name;
    }
  }
  return null;
}

function toTimestampMs(value) {
  if (value == null || value === "") return 0;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return 0;
    return value < 10000000000 ? Math.floor(value * 1000) : Math.floor(value);
  }
  const text = String(value).trim();
  if (!text) return 0;
  if (/^\d+$/.test(text)) {
    const n = Number(text);
    if (!Number.isFinite(n)) return 0;
    return n < 10000000000 ? Math.floor(n * 1000) : Math.floor(n);
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function firstTimestampMs(...values) {
  for (const value of values) {
    const ts = toTimestampMs(value);
    if (ts > 0) return ts;
  }
  return 0;
}

function extractStickerId(contentObj, paramsObj, rawContent) {
  const candidates = [
    contentObj && contentObj.id,
    contentObj && contentObj.stickerId,
    contentObj && contentObj.sticker_id,
    paramsObj && paramsObj.id,
    paramsObj && paramsObj.stickerId,
    paramsObj && paramsObj.sticker_id,
    rawContent && typeof rawContent === "object" ? rawContent.id : null,
    rawContent && typeof rawContent === "object" ? rawContent.stickerId : null,
  ];
  for (const val of candidates) {
    if (val === null || val === undefined || val === "") continue;
    const n = Number(val);
    if (Number.isFinite(n) && n > 0) return Math.trunc(n);
  }
  return null;
}

function buildZaloStickerCdnUrl(stickerId, size = 130) {
  if (!Number.isFinite(stickerId) || stickerId <= 0) return null;
  return `https://zalo-api.zadn.vn/api/emoticon/sticker/webpc?eid=${Math.trunc(stickerId)}&size=${size}`;
}

function normalizeMessage(raw, index, ownId = null) {
  const data = raw && raw.data ? raw.data : raw || {};
  const rawContent = data.content ?? data.message ?? data.msg ?? raw.content ?? raw.message;
  const msgType = String(data.msgType || data.type || raw.type || "text").trim();
  const contentObj = unwrapStructuredContent(rawContent, msgType);
  const paramsObj =
    parseJsonObjectLoose(contentObj && contentObj.params)
    || parseJsonObjectLoose(data.params)
    || parseJsonObjectLoose(raw.params)
    || {};
  const descObj = parseJsonObjectLoose(contentObj && contentObj.description) || {};
  const action = String(
    (contentObj && contentObj.action)
    || data.action
    || raw.action
    || ""
  ).trim().toLowerCase();
  const templateId = extractTemplateId(contentObj, paramsObj, data);
  const bankcardDataUrl = extractBankcardDataUrl(contentObj, paramsObj, data);

  const msgKind = classifyMessageKind({
    msgType,
    action,
    templateId,
    contentObj,
    rawContent,
  });

  const attachmentsBlob = data.attachments || data.attachment || data.photos || data.attach || raw.attach || data.params || raw.params;
  const mediaSource = {
    content: contentObj || rawContent,
    attachments: attachmentsBlob,
    attach: data.attach || raw.attach,
    params: data.params || raw.params,
    hrefInfo: data.hrefInfo || raw.hrefInfo,
    data,
    raw,
  };
  const isMediaKind = msgKind === "image" || msgKind === "gif" || msgKind === "doodle" || msgKind === "video" || msgKind === "voice" || msgKind === "file" || msgKind === "sticker";
  const imageUrls = isMediaKind ? collectUrls(mediaSource) : [];
  // media_urls (rộng hơn imageUrls) — chỉ thu thập cho các tin media/file thực sự để không gom avatar/thumb ecard vào assets.
  const mediaUrls = isMediaKind ? Array.from(new Set(collectMediaUrls(mediaSource))) : [];
  if (msgKind === "sticker" && imageUrls.length === 0 && mediaUrls.length === 0) {
    const stickerId = extractStickerId(contentObj, paramsObj, rawContent);
    const stickerCdnUrl = buildZaloStickerCdnUrl(stickerId, 130);
    if (stickerCdnUrl) {
      imageUrls.push(stickerCdnUrl);
      mediaUrls.push(stickerCdnUrl);
    }
  }
  const fileNameHint = collectFileName(mediaSource);

  const senderId = String(data.uidFrom || raw.uidFrom || raw.senderId || raw.sender_id || "");
  const isSent = Boolean(raw.isSelf || data.isSelf || (ownId && String(senderId) === String(ownId)));

  let threadId = String(
    raw.threadId ||
    data.threadId ||
    data.groupId ||
    raw.groupId ||
    data.grid ||
    raw.grid ||
    ""
  );

  const idTo = String(
    data.idTo || raw.idTo ||
    data.toUid || raw.toUid ||
    data.receiverId || raw.receiverId ||
    data.destId || raw.destId ||
    ""
  );

  if (!threadId) {
    if (!isSent) {
      // Received an incoming message: thread is ALWAYS the sender (Rule 12 Anti-self collapse)
      threadId = senderId || idTo;
    } else {
      // Outgoing message: thread is the recipient idTo
      threadId = idTo || senderId;
    }
  }

  // Fix DM / Anti-self collapse (Rule 12): nếu threadId trùng với ownId
  if (ownId && threadId === String(ownId)) {
    if (!isSent && senderId && senderId !== String(ownId)) {
      threadId = senderId;    // Người khác gửi cho tôi → thread = người gửi
    } else if (isSent && idTo && idTo !== String(ownId)) {
      threadId = idTo;        // Tôi gửi → thread = người nhận
    }
  }

  const messageId = String(
    data.msgId ||
      data.cliMsgId ||
      data.realMsgId ||
      raw.msgId ||
      raw.messageId ||
      raw.id ||
      `${data.ts || Date.now()}-${index}`
  );
  const timestampMs = firstTimestampMs(
    data.ts,
    data.time,
    data.timestamp,
    raw.timestamp,
    raw.ts,
    raw.time,
    raw.createdAt,
    data.createdAt
  );
  const timestamp = timestampMs || null;

  let contentText = "";
  let fileMeta = null;

  if (msgKind === "file") {
    fileMeta = extractFileMetadata(contentObj, paramsObj, fileNameHint);
    contentText = fileMeta.fileName || (fileMeta.isFolder ? "[Thư mục]" : "[File]");
  } else if (msgKind === "call") {
    contentText = formatCallSummaryVi(action, paramsObj, isSent);
  } else if (msgKind === "bankcard") {
    const cleanTitle = sanitizeUglyFallbackText(contentObj && typeof contentObj.title === "string" ? contentObj.title : "");
    contentText = cleanTitle || "[Thẻ ngân hàng]";
  } else if (msgKind === "contact") {
    const contactName = sanitizeUglyFallbackText(contentObj && typeof contentObj.title === "string" ? contentObj.title : "");
    const contactPhone = String(descObj.phone || (contentObj && contentObj.phone) || "").trim();
    if (contactName && contactPhone) {
      contentText = `[Danh thiếp] ${contactName} - ${contactPhone}`;
    } else if (contactName) {
      contentText = `[Danh thiếp] ${contactName}`;
    } else if (contactPhone) {
      contentText = `[Danh thiếp] ${contactPhone}`;
    } else {
      contentText = "[Danh thiếp]";
    }
  } else if (msgKind === "location") {
    const isUserLoc = Boolean(contentObj && contentObj.isUserLocation);
    const locTitle = sanitizeUglyFallbackText(
      (contentObj && (contentObj.title || contentObj.desc || contentObj.description || contentObj.addr)) || ""
    );
    const lat = contentObj && (contentObj.lat ?? contentObj.latitude);
    const lon = contentObj && (contentObj.lo ?? contentObj.longitude);
    if (isUserLoc) {
      contentText = "Vị trí hiện tại";
    } else if (locTitle) {
      contentText = locTitle;
    } else if (lat != null && lon != null) {
      contentText = `Toạ độ (${lat}, ${lon})`;
    } else {
      contentText = "[Vị trí]";
    }
  } else if (msgKind === "undo") {
    contentText = "Tin nhắn đã được thu hồi";
  } else if (msgKind === "system_notice") {
    if (action === "msginfo.actionlist") {
      contentText = formatMsgInfoActionlistText(contentObj, paramsObj);
    } else if (msgType === "chat.ecard") {
      contentText = sanitizeUglyFallbackText(
        (paramsObj && paramsObj.previewTxt)
        || (contentObj && contentObj.description)
        || (contentObj && contentObj.title)
        || ""
      ) || "[Thiệp]";
    } else if (msgType === "group.poll" || msgType === "chat.poll") {
      contentText = formatMsgInfoActionlistText(contentObj, paramsObj);
      if (contentText === "Thông báo hệ thống") {
        contentText = sanitizeUglyFallbackText((paramsObj && paramsObj.question) || (contentObj && contentObj.title) || "") || "[Bình chọn]";
      }
    } else if (msgType === "chat.todo") {
      const innerMsg = contentObj && contentObj.message;
      const todoText = typeof innerMsg === "string"
        ? innerMsg
        : (innerMsg && typeof innerMsg === "object" ? (innerMsg.message || innerMsg.title || "") : "");
      contentText = sanitizeUglyFallbackText(todoText || (contentObj && contentObj.title) || "") || "[Công việc]";
    } else if (msgType === "chat.list.action") {
      const items = contentObj && Array.isArray(contentObj.message) ? contentObj.message : [];
      const headerItem = items.find((it) => it && (it.type === "l.a.header.only" || it.type === "l.a.header.full") && it.title);
      contentText = sanitizeUglyFallbackText((headerItem && headerItem.title) || "") || "[Tin nhắn chưa hỗ trợ ở phiên bản hiện tại]";
    } else if (msgType === "chat.e2ee.replace") {
      contentText = "Đang chờ tin nhắn này";
    } else if (msgType === "chat.delete" || msgType === "chat.delete.everyone") {
      contentText = "Tin nhắn đã bị xóa";
    } else if (msgType === "chat.vanish") {
      contentText = "[Tin nhắn đã tự xóa]";
    } else if (msgType === "group.leave") {
      contentText = sanitizeUglyFallbackText(textOf(contentObj || rawContent)) || "Đã rời khỏi nhóm";
    } else {
      contentText = sanitizeUglyFallbackText(textOf(contentObj || rawContent)) || "Thông báo hệ thống";
    }
  } else if (msgKind === "link") {
    contentText = sanitizeUglyFallbackText(
      (contentObj && (contentObj.title || contentObj.href || contentObj.description))
      || textOf(rawContent)
    ) || "[Link]";
  } else if (action === "rtf" && contentObj && typeof contentObj.title === "string") {
    contentText = sanitizeUglyFallbackText(contentObj.title);
  } else {
    contentText = sanitizeUglyFallbackText(textOf(contentObj || rawContent));
    if (imageUrls.length > 0 && contentText) {
      const trimmed = contentText.trim();
      if (imageUrls.includes(trimmed) || isLikelyImageUrl(trimmed)) {
        contentText = "";
      }
    }
    if (!contentText && fileNameHint && isMediaKind) {
      contentText = fileNameHint;
    }
  }

  // Zalo tập trung (Mục 7.1 guide): cli_msg_id RIÊNG với message_id — message_id
  // ưu tiên msgId thật (dùng làm source_message_id/dedup key), cli_msg_id CHỈ để
  // thu hồi tin (api.undo cần cả 2).
  const cliMsgId = data.cliMsgId != null ? String(data.cliMsgId) : (raw.cliMsgId != null ? String(raw.cliMsgId) : null);
  const mentions = Array.isArray(data.mentions) ? data.mentions : (Array.isArray(raw.mentions) ? raw.mentions : null);
  const resolvedType = resolveMessageType(msgType, imageUrls.length, msgKind);
  const isDeleted =
    msgType === "chat.delete"
    || msgType === "chat.delete.everyone"
    || msgType === "chat.vanish"
    || msgType === "chat.undo"
    || msgType === "recalled";

  // Đính kèm metadata chuẩn hóa bổ sung vào bản copy raw an toàn (giữ nguyên 100% trường gốc).
  const normalizedRaw = (raw && typeof raw === "object") ? { ...raw } : { raw_value: raw };
  if (fileMeta) {
    normalizedRaw._file_meta = fileMeta;
  }
  if (bankcardDataUrl) {
    normalizedRaw._bankcard_data_url = bankcardDataUrl;
  }
  if (templateId != null) {
    normalizedRaw._template_id = templateId;
  }

  return {
    thread_id: threadId || null,
    message_id: messageId,
    sender_id: senderId || null,
    sender_name: data.dName || data.displayName || raw.senderName || raw.sender_name || null,
    timestamp: timestamp ? String(timestamp) : null,
    time_text: timestamp ? new Date(Number(timestamp)).toISOString() : null,
    type: resolvedType,
    content: contentText || null,
    // image_urls: giữ tên field cũ nhưng chỉ mang URL media/file thực sự.
    image_urls: mediaUrls,
    reply_to_id: (data.quote && data.quote.msgId) || data.quoteMsgId || null,
    is_deleted: isDeleted,
    is_sent: isSent,
    ts: timestamp || null,
    cli_msg_id: cliMsgId,
    mentions,
    msg_kind: msgKind,
    file_meta: fileMeta,
    bankcard_data_url: bankcardDataUrl,
    raw: normalizedRaw,
  };
}

// ── G1: Chuẩn hóa friend_event, group_event và G7: undo (recall) ─────────────
const FRIEND_EVENT_TYPE_TO_ACT = {
  0: "add",
  1: "remove",
  2: "req_v2",
  3: "undo_req",
  4: "reject",
  5: "seen_fr_req",
  6: "block",
  7: "unblock",
  8: "block_call",
  9: "unblock_call",
  10: "pin_unpin",
  11: "pin_create",
  12: "unknown",
};

function normalizeFriendEvent(event, ownId = null) {
  if (!event || typeof event !== "object") return null;
  const numericType = typeof event.type === "number" ? event.type : Number(event.type);
  const act = String(
    event.act
    || FRIEND_EVENT_TYPE_TO_ACT[numericType]
    || (typeof event.type === "string" ? event.type.toLowerCase() : "unknown")
  ).trim().toLowerCase();

  // seen_fr_req không có hội thoại đối phương thực (threadId=ownId), bỏ qua không lưu bubble.
  if (act === "seen_fr_req" || numericType === 5) {
    return null;
  }

  const data = event.data;
  const dataObj = (data && typeof data === "object" && !Array.isArray(data)) ? data : {};
  const isSelf = Boolean(event.isSelf);
  const ownStr = ownId != null ? String(ownId) : "";

  let threadId = "";
  if (act === "req_v2" || act === "req" || act === "undo_req" || act === "reject") {
    const fromUid = String(dataObj.fromUid || "");
    const toUid = String(dataObj.toUid || "");
    if (isSelf || (ownStr && fromUid === ownStr)) {
      threadId = toUid || String(event.threadId || "");
    } else {
      threadId = fromUid || String(event.threadId || "");
    }
  } else if (act === "pin_create" || act === "pin_unpin") {
    threadId = String(dataObj.conversationId || event.threadId || "");
  } else {
    threadId = String(
      event.threadId
      || (typeof data === "string" || typeof data === "number" ? data : "")
      || dataObj.uid
      || dataObj.fromUid
      || dataObj.toUid
      || ""
    );
  }

  // Anti-self collapse cho friend_event 1-1
  if (ownStr && threadId === ownStr) {
    const fromUid = String(dataObj.fromUid || "");
    const toUid = String(dataObj.toUid || "");
    if (fromUid && fromUid !== ownStr) threadId = fromUid;
    else if (toUid && toUid !== ownStr) threadId = toUid;
  }

  if (!threadId) return null;

  const reqMessage = typeof dataObj.message === "string" ? dataObj.message.trim() : "";
  const topicTitle = dataObj.topic && dataObj.topic.params && typeof dataObj.topic.params.title === "string"
    ? dataObj.topic.params.title.trim()
    : "";

  let contentText = "Thông báo kết bạn";
  switch (act) {
    case "add":
      contentText = "Hai bạn đã trở thành bạn bè";
      break;
    case "req_v2":
    case "req":
    case "request":
      if (isSelf) {
        contentText = reqMessage ? `Đã gửi lời mời kết bạn: "${reqMessage}"` : "Đã gửi lời mời kết bạn";
      } else {
        contentText = reqMessage ? `Đã gửi lời mời kết bạn đến bạn: "${reqMessage}"` : "Đã gửi lời mời kết bạn đến bạn";
      }
      break;
    case "undo_req":
    case "undo_request":
      contentText = "Đã thu hồi lời mời kết bạn";
      break;
    case "reject":
    case "reject_request":
      contentText = "Lời mời kết bạn đã bị từ chối";
      break;
    case "remove":
      contentText = "Đã xóa kết bạn";
      break;
    case "block":
      contentText = "Đã chặn người dùng này";
      break;
    case "unblock":
      contentText = "Đã bỏ chặn người dùng này";
      break;
    case "block_call":
      contentText = "Đã chặn cuộc gọi từ người dùng này";
      break;
    case "unblock_call":
      contentText = "Đã bỏ chặn cuộc gọi từ người dùng này";
      break;
    case "pin_create":
      contentText = topicTitle ? `Đã ghim tin nhắn: "${topicTitle}"` : "Đã ghim một tin nhắn";
      break;
    case "pin_unpin":
      contentText = "Đã bỏ ghim một tin nhắn";
      break;
    default:
      contentText = "Thông báo kết bạn";
      break;
  }

  const tsMs = firstTimestampMs(
    dataObj.ts,
    dataObj.time,
    dataObj.createTime,
    event.ts,
    Date.now()
  ) || Date.now();
  const senderId = String(
    dataObj.fromUid
    || dataObj.actorId
    || (isSelf ? ownStr : threadId)
    || ""
  ) || null;
  const messageId = `friend-event-${act}-${threadId}-${tsMs}`;

  return {
    thread_id: threadId,
    message_id: messageId,
    sender_id: senderId,
    sender_name: isSelf ? "Bạn" : null,
    timestamp: String(tsMs),
    time_text: new Date(tsMs).toISOString(),
    type: "friend.event",
    content: contentText,
    image_urls: [],
    reply_to_id: null,
    is_deleted: false,
    is_sent: isSelf,
    ts: tsMs,
    cli_msg_id: null,
    mentions: null,
    msg_kind: "system_notice",
    raw: {
      event_kind: "friend_event",
      act,
      friend_event_type: Number.isFinite(numericType) ? numericType : event.type,
      threadId,
      isSelf,
      data,
    },
  };
}

function normalizeGroupEvent(event, ownId = null) {
  if (!event || typeof event !== "object") return null;
  const data = (event.data && typeof event.data === "object") ? event.data : {};
  const act = String(event.act || event.type || "unknown").trim().toLowerCase();
  const threadId = String(event.threadId || data.groupId || data.group_id || "").trim();
  if (!threadId) return null;

  const isSelf = Boolean(event.isSelf);
  const ownStr = ownId != null ? String(ownId) : "";
  const sourceId = String(data.sourceId || data.actorId || data.creatorId || "");
  const updateMembers = Array.isArray(data.updateMembers) ? data.updateMembers : [];
  const memberNames = updateMembers
    .map((m) => (m && typeof m === "object" ? String(m.dName || m.displayName || m.name || "").trim() : ""))
    .filter(Boolean);
  const memberIds = updateMembers
    .map((m) => (m && typeof m === "object" ? String(m.id || "") : String(m || "")))
    .filter(Boolean);
  const membersText = memberNames.join(", ");
  const ownInMembers = Boolean(ownStr && memberIds.includes(ownStr));
  const actorIsOwn = Boolean(ownStr && sourceId === ownStr);
  const groupName = typeof data.groupName === "string" ? data.groupName.trim() : "";

  const topicObj = data.topic || data.groupTopic || {};
  const topicParams = parseJsonObjectLoose(topicObj.params) || (topicObj.params && typeof topicObj.params === "object" ? topicObj.params : {});
  const topicTitle = String(topicParams.title || topicObj.title || data.msg || "").trim();

  let contentText = "Thông báo nhóm";
  switch (act) {
    case "join":
      if (ownInMembers && memberIds.length === 1) {
        contentText = "Bạn vừa tham gia nhóm";
      } else if (membersText) {
        if (memberIds.length === 1 && sourceId && memberIds[0] === sourceId) {
          contentText = `${membersText} đã tham gia nhóm`;
        } else if (actorIsOwn) {
          contentText = `${membersText} được bạn thêm vào nhóm`;
        } else {
          contentText = `${membersText} đã được thêm vào nhóm`;
        }
      } else {
        contentText = "Có thành viên mới tham gia nhóm";
      }
      break;
    case "leave":
      contentText = membersText ? `${membersText} đã rời khỏi nhóm` : "Một thành viên đã rời khỏi nhóm";
      break;
    case "remove_member":
      if (ownInMembers) {
        contentText = "Bạn đã được xoá khỏi nhóm";
      } else if (membersText) {
        contentText = actorIsOwn ? `${membersText} được bạn xóa khỏi nhóm` : `${membersText} đã bị xóa khỏi nhóm`;
      } else {
        contentText = "Một thành viên đã bị xóa khỏi nhóm";
      }
      break;
    case "block_member":
      contentText = membersText
        ? (actorIsOwn ? `${membersText} bị bạn chặn khỏi nhóm này` : `${membersText} bị chặn khỏi nhóm này`)
        : "Một thành viên bị chặn khỏi nhóm này";
      break;
    case "disband_group":
    case "destroy":
      contentText = "Trưởng nhóm đã giải tán nhóm";
      break;
    case "update":
      contentText = groupName
        ? `Tên nhóm đã đổi thành "${groupName}"`
        : "Thông tin nhóm đã được cập nhật";
      break;
    case "update_avatar":
      contentText = "Ảnh đại diện nhóm đã thay đổi";
      break;
    case "add_admin":
      if (ownInMembers) {
        contentText = "Bạn đã trở thành phó nhóm";
      } else if (membersText) {
        contentText = `${membersText} đã được bổ nhiệm thành phó nhóm`;
      } else {
        contentText = "Đã bổ nhiệm phó nhóm mới";
      }
      break;
    case "remove_admin":
      if (ownInMembers) {
        contentText = "Bạn đã không còn là phó nhóm";
      } else if (membersText) {
        contentText = `${membersText} đã không còn là phó nhóm`;
      } else {
        contentText = "Đã gỡ quyền phó nhóm";
      }
      break;
    case "new_link": {
      const link = data.info && typeof data.info.group_link === "string" ? data.info.group_link.trim() : "";
      contentText = link ? `Link mời tham gia nhóm: ${link}` : "Link mời tham gia nhóm đã được cập nhật";
      break;
    }
    case "join_request": {
      const pending = Number(data.totalPending || (Array.isArray(data.uids) ? data.uids.length : 0));
      contentText = pending > 1
        ? `Có ${pending} yêu cầu tham gia nhóm đang chờ phê duyệt`
        : "Có yêu cầu tham gia nhóm đang chờ phê duyệt";
      break;
    }
    case "update_setting":
      contentText = "Cài đặt nhóm đã được cập nhật";
      break;
    case "new_pin_topic":
    case "update_pin_topic":
    case "reorder_pin_topic":
      contentText = topicTitle
        ? `Đã ghim thông báo nhóm: "${topicTitle}"`
        : "Đã ghim một tin nhắn thành thông báo nhóm";
      break;
    case "unpin_topic":
    case "remove_topic":
      contentText = topicTitle
        ? `Đã bỏ ghim thông báo nhóm: "${topicTitle}"`
        : "Đã bỏ ghim một thông báo nhóm";
      break;
    case "update_board":
      contentText = topicTitle ? `Đã cập nhật bảng tin nhóm: "${topicTitle}"` : "Đã cập nhật bảng tin nhóm";
      break;
    case "remove_board":
      contentText = topicTitle ? `Đã xóa khỏi bảng tin nhóm: "${topicTitle}"` : "Đã xóa một mục khỏi bảng tin nhóm";
      break;
    case "remind_topic":
      contentText = topicTitle ? `Nhắc hẹn: "${topicTitle}"` : "Có nhắc hẹn mới trong nhóm";
      break;
    case "accept_remind":
      contentText = "Đã xác nhận tham gia nhắc hẹn";
      break;
    case "reject_remind":
      contentText = "Đã từ chối nhắc hẹn";
      break;
    default:
      contentText = groupName ? `Thông báo nhóm ${groupName}` : "Thông báo nhóm";
      break;
  }

  const tsMs = firstTimestampMs(
    data.time,
    data.createTime,
    data.editTime,
    event.ts,
    Date.now()
  ) || Date.now();
  const messageId = `group-event-${act}-${threadId}-${tsMs}`;

  return {
    thread_id: threadId,
    message_id: messageId,
    sender_id: sourceId || null,
    sender_name: actorIsOwn ? "Bạn" : null,
    timestamp: String(tsMs),
    time_text: new Date(tsMs).toISOString(),
    type: "group.event",
    content: contentText,
    image_urls: [],
    reply_to_id: null,
    is_deleted: false,
    is_sent: isSelf,
    ts: tsMs,
    cli_msg_id: null,
    mentions: null,
    msg_kind: "system_notice",
    group_name: groupName || null,
    raw: {
      event_kind: "group_event",
      act,
      group_event_type: event.type || act,
      threadId,
      isSelf,
      data,
    },
  };
}

function normalizeUndoEvent(undoEvent, ownId = null) {
  if (!undoEvent || typeof undoEvent !== "object") return null;
  const data = (undoEvent.data && typeof undoEvent.data === "object") ? undoEvent.data : undoEvent;
  const content = (data.content && typeof data.content === "object") ? data.content : parseJsonObjectLoose(data.content) || {};
  const isSelf = Boolean(undoEvent.isSelf);
  const isGroup = Boolean(undoEvent.isGroup);
  const ownStr = ownId != null ? String(ownId) : "";

  let threadId = String(undoEvent.threadId || "");
  if (!threadId) {
    if (isGroup || isSelf) {
      threadId = String(data.idTo || content.destId || "");
    } else {
      threadId = String(data.uidFrom || content.srcId || data.idTo || "");
    }
  }
  if (!isGroup && ownStr && threadId === ownStr) {
    const uidFrom = String(data.uidFrom || content.srcId || "");
    const idTo = String(data.idTo || content.destId || "");
    if (!isSelf && uidFrom && uidFrom !== ownStr) threadId = uidFrom;
    else if (isSelf && idTo && idTo !== ownStr) threadId = idTo;
  }

  const targetMessageId = content.globalMsgId != null
    ? String(content.globalMsgId)
    : (data.realMsgId != null ? String(data.realMsgId) : (data.msgId != null ? String(data.msgId) : null));
  const targetCliMsgId = content.cliMsgId != null
    ? String(content.cliMsgId)
    : (data.cliMsgId != null ? String(data.cliMsgId) : null);

  if (!targetMessageId && !targetCliMsgId) return null;

  const tsMs = firstTimestampMs(data.ts, undoEvent.ts, Date.now()) || Date.now();
  return {
    thread_id: threadId || null,
    message_id: targetMessageId,
    cli_msg_id: targetCliMsgId,
    undo_packet_msg_id: data.msgId != null ? String(data.msgId) : null,
    sender_id: data.uidFrom != null ? String(data.uidFrom) : null,
    is_self: isSelf,
    is_group: isGroup,
    ts: tsMs,
    raw: undoEvent,
  };
}

// Map rType (số Zalo dùng nội bộ) -> tên icon enum Reactions của zca-js.
// Trích thẳng từ node_modules/zca-js/dist/apis/addReaction.js (switch-case)
// bằng script 1 lần (không chép tay để tránh sai số) — dùng để nhận diện
// đúng cảm xúc người KHÁC thả (họ dùng app Zalo thật, không giới hạn 6 icon
// nhanh của UI mình, có thể là bất kỳ icon nào trong ~54 icon Zalo hỗ trợ).
const RTYPE_TO_REACTION_NAME = {
  0: "HAHA", 1: "SAD", 2: "CRY", 3: "LIKE", 4: "DISLIKE", 5: "HEART",
  7: "TEARS_OF_JOY", 8: "KISS", 16: "VERY_SAD", 20: "ANGRY", 21: "COOL",
  22: "NERD", 23: "BIG_SMILE", 26: "SUNGLASSES", 29: "LOVE", 30: "NEUTRAL",
  32: "WOW", 35: "SAD_FACE", 36: "BYE", 38: "SLEEPY", 39: "WIPE", 42: "DIG",
  44: "ANGUISH", 45: "WINK", 46: "HANDCLAP", 47: "ANGRY_FACE", 48: "F_CHAIR",
  49: "L_CHAIR", 50: "R_CHAIR", 51: "CONFUSED", 52: "SILENT", 53: "SURPRISE",
  54: "EMBARRASSED", 60: "AFRAID", 61: "SAD2", 62: "BIG_LAUGH", 63: "RICH",
  65: "BROKEN_HEART", 66: "SHIT", 67: "SUN", 68: "OK", 69: "PEACE",
  70: "THANKS", 71: "PUNCH", 72: "SHARE", 73: "PRAY", 99: "BEER",
  120: "ROSE", 121: "FADE", 126: "BIRTHDAY", 127: "BOMB", 131: "NO",
  132: "BAD", 133: "LOVE_YOU",
};

// Chuẩn hoá event "reaction" từ listener zca-js thành payload gọn để Python
// lưu vào cột reactions (map uid -> icon) — KHÁC message, reaction không có
// nội dung/asset riêng, chỉ cần biết: ai react, react vào tin nào, icon gì.
function normalizeReaction(reaction) {
  const data = reaction && reaction.data ? reaction.data : {};
  const content = typeof data.content === "string" ? safeJsonParse(data.content) : (data.content || {});
  const rMsg = Array.isArray(content.rMsg) ? content.rMsg[0] : null;
  const rType = content.rType;
  const iconName = RTYPE_TO_REACTION_NAME[rType] || null;
  return {
    thread_id: reaction.threadId ? String(reaction.threadId) : null,
    message_id: rMsg && rMsg.gMsgID != null ? String(rMsg.gMsgID) : null,
    cli_msg_id: rMsg && rMsg.cMsgID != null ? String(rMsg.cMsgID) : null,
    reactor_uid: data.uidFrom != null ? String(data.uidFrom) : null,
    icon: iconName,
    r_icon_raw: content.rIcon || null,
    r_type_raw: rType != null ? Number(rType) : null,
    is_self: Boolean(reaction.isSelf),
    // rIcon = "" hoặc rType = -1/undefined nghĩa là BỎ reaction (Zalo gửi
    // event reaction rỗng khi user bấm lại icon đang có để huỷ).
    removed: !content.rIcon && (rType == null || rType === -1),
  };
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch (_) {
    return {};
  }
}

async function login(auth) {
  const cookie = normalizeCookieJar(auth.cookies);
  if (!cookie || !auth.imei || !auth.userAgent) {
    throw new Error("Missing ZCA auth fields: cookies, imei, userAgent");
  }
  const zalo = new Zalo({
    selfListen: true,
    checkUpdate: false,
    logging: false,
  });
  return await zalo.login({
    cookie,
    imei: auth.imei,
    userAgent: auth.userAgent,
  });
}

async function requestOldMessages(listener) {
  try {
    if (listener && typeof listener.requestOldMessages === "function") {
      listener.requestOldMessages(ThreadType.Group, null);
      emit({ event: "old_messages_requested", type: ThreadType.Group });
      if (ThreadType.User !== undefined) {
        listener.requestOldMessages(ThreadType.User, null);
        emit({ event: "old_messages_requested", type: ThreadType.User });
      }
    }
  } catch (error) {
    emit({ event: "error", error: "request_old_messages_failed", error_detail: serializeError(error) });
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const input = await readStdinJson();
  const userId = String(args["user-id"] || input.user_id || "default");
  const oldMessageIntervalMs = Number(args["old-message-interval-ms"] || 0);
  const auth = input.auth || input.zca_auth || input;

  emit({ event: "starting", user_id: userId, old_message_interval_ms: oldMessageIntervalMs });
  debugLog("auth_received", {
    has_cookies: Boolean(auth && auth.cookies),
    has_imei: Boolean(auth && auth.imei),
    has_userAgent: Boolean(auth && auth.userAgent),
  });

  let api;
  try {
    api = await login(auth);
    emit({ event: "login_ok", user_id: userId });
  } catch (error) {
    emit({ event: "login_failed", user_id: userId, error: "login_error", error_detail: serializeError(error) });
    setTimeout(() => process.exit(2), 250).unref();
    return;
  }

  const ownId = typeof api.getOwnId === "function" ? api.getOwnId() : null;
  const listener = api.listener;
  if (!listener || typeof listener.start !== "function") {
    emit({ event: "error", user_id: userId, error: "no_listener", error_detail: "ZCA listener is not available" });
    setTimeout(() => process.exit(3), 250).unref();
    return;
  }

  // Hook bảo đảm 100% bắt trọn sự kiện VoIP (cmd 601 + 602 act_type 'voip' -> answer, ringring, endcall...)
  // Dùng readUInt16LE(1) chuẩn Little-Endian của Zalo WS (trùng khớp listen.cjs getHeader) và chống emit trùng.
  function ensureVoipListenerHook(l) {
    if (!l || l.__voipHooked) return;
    l.__voipHooked = true;
    let voipEmitSeq = 0;
    const origEmit = l.emit.bind(l);
    l.emit = function (evName, ...rest) {
      if (evName === "voip") voipEmitSeq += 1;
      return origEmit(evName, ...rest);
    };
    const origStart = l.start.bind(l);
    l.start = function (opts) {
      const res = origStart(opts);
      if (this.ws && !this.ws.__voipHooked) {
        this.ws.__voipHooked = true;
        const prevOnMessage = this.ws.onmessage;
        this.ws.onmessage = async (event) => {
          const seqBefore = voipEmitSeq;
          if (prevOnMessage) {
            try {
              await prevOnMessage.call(this.ws, event);
            } catch (err) {
              debugLog("prev_onmessage_error", { error: String(err) });
            }
          }
          // Nếu vendor/zca-js đã emit sự kiện voip trong prevOnMessage thì không phát trùng lần 2
          if (voipEmitSeq > seqBefore) return;
          try {
            const { data } = event;
            if (data && typeof data === "object" && Buffer.isBuffer(data) && data.length > 4 && this.cipherKey) {
              const header = data.subarray(0, 4);
              const cmd = header.readUInt16LE(1);
              if (cmd === 601 || cmd === 602) {
                const text = new TextDecoder("utf-8").decode(data.subarray(4));
                if (text) {
                  const json = JSON.parse(text);
                  const path = require("path");
                  let decodeFunc = null;
                  try {
                    const utilsCjs = require(path.resolve(__dirname, "../node_modules/zca-js/dist/cjs/utils.cjs"));
                    decodeFunc = utilsCjs.decodeEventData;
                  } catch (_) {}
                  if (typeof decodeFunc === "function") {
                    const dec = await decodeFunc(json, this.cipherKey);
                    const ctrls = (dec && dec.data && (dec.data.controls || dec.data.actions)) || [];
                    for (const c of ctrls) {
                      const ct = c.content || c || {};
                      if (ct.act_type === "voip") {
                        let d = ct.data;
                        if (typeof d === "string") {
                          try { d = JSON.parse(d); } catch (_) {}
                        }
                        l.emit("voip", {
                          act: ct.act,
                          act_type: ct.act_type,
                          data: d || {},
                        });
                      }
                    }
                  }
                }
              }
            }
          } catch (_) {}
        };
      }
      return res;
    };
  }
  ensureVoipListenerHook(listener);

  emit({ event: "listener_ready", user_id: userId, own_id: ownId });

  let stopping = false;
  let oldMessageTimer = null;
  let oldMessageKickoffTimer = null;

  const stop = (signal) => {
    if (stopping) return;
    stopping = true;
    if (oldMessageKickoffTimer) clearTimeout(oldMessageKickoffTimer);
    if (oldMessageTimer) clearInterval(oldMessageTimer);
    emit({ event: "stopping", user_id: userId, signal });
    try {
      if (typeof listener.stop === "function") listener.stop();
    } catch (error) {
      emit({ event: "error", error: "listener_stop_failed", error_detail: serializeError(error) });
    }
    setTimeout(() => process.exit(0), 250).unref();
  };

  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("uncaughtException", (error) => {
    emit({ event: "fatal", error: "uncaught_exception", error_detail: serializeError(error) });
    setTimeout(() => process.exit(99), 250).unref();
  });
  process.on("unhandledRejection", (reason) => {
    emit({ event: "fatal", error: "unhandled_rejection", error_detail: serializeError(reason) });
  });

  listener.on("connected", () => {
    emit({ event: "connected", user_id: userId, own_id: typeof api.getOwnId === "function" ? api.getOwnId() : null });
    if (oldMessageIntervalMs > 0 && !oldMessageTimer) {
      requestOldMessages(listener);
      oldMessageTimer = setInterval(() => requestOldMessages(listener), oldMessageIntervalMs);
    }
  });
  listener.on("disconnected", (code, reason) => {
    emit({ event: "disconnected", user_id: userId, code, reason: reason ? String(reason) : null });
  });
  listener.on("closed", (code, reason) => {
    emit({ event: "closed", user_id: userId, code, reason: reason ? String(reason) : null });
    // zca-js has exhausted its own reconnect attempts. Heartbeat/stats timers
    // would otherwise keep this process alive forever while the socket is dead.
    // Exiting lets the Python supervisor start a fresh listener with backoff.
    if (!stopping) setTimeout(() => process.exit(5), 250).unref();
  });
  listener.on("error", (error) => {
    emit({ event: "error", user_id: userId, error: "listener_error", error_detail: serializeError(error) });
  });
  let totalMessageEvents = 0;
  let totalOldMessageEvents = 0;
  const byThread = new Map();
  function trackThread(threadId) {
    if (!threadId) return null;
    const entry = byThread.get(threadId) || { thread_id: threadId, count: 0, last_seen: 0 };
    entry.count += 1;
    entry.last_seen = Date.now();
    byThread.set(threadId, entry);
    return entry;
  }

  listener.on("message", (message) => {
    totalMessageEvents += 1;
    debugLog("message_received", {
      type: message && message.constructor && message.constructor.name,
      total: totalMessageEvents,
    });
    const normalized = normalizeMessage(message, 0, ownId);
    if (normalized.thread_id && normalized.message_id) {
      trackThread(normalized.thread_id);
      emit({ event: "message", user_id: userId, message: normalized });
    } else {
      debugLog("message_dropped", { reason: "missing_ids", thread_id: normalized.thread_id, message_id: normalized.message_id });
    }
  });
  // Thả cảm xúc (reaction) — event RIÊNG với "message", zca-js emit khi CHÍNH
  // MÌNH react (selfListen=true nên tự react cũng echo về) HOẶC khi đối
  // phương/thành viên khác trong nhóm react vào bất kỳ tin nào trong luồng.
  listener.on("reaction", (reaction) => {
    const normalized = normalizeReaction(reaction);
    if (normalized.thread_id && normalized.message_id && normalized.reactor_uid) {
      emit({ event: "reaction", user_id: userId, reaction: normalized });
    } else {
      debugLog("reaction_dropped", { reason: "missing_ids", ...normalized });
    }
  });
  let callGateway = null;
  try {
    callGateway = require("./zalo_call_gateway");
  } catch (_) {}

  listener.on("voip", (voipEvent) => {
    if (callGateway && typeof callGateway.handleVoipEvent === "function") {
      try {
        callGateway.handleVoipEvent(voipEvent);
      } catch (gwErr) {
        debugLog("gateway_voip_error", { error: String(gwErr) });
      }
    }
    emit({
      event: "voip",
      user_id: userId,
      voip: voipEvent || {},
    });
  });
  listener.on("old_messages", (messages, type) => {
    totalOldMessageEvents += 1;
    const numericType = Number(type);
    if (
      numericType !== Number(ThreadType.Group) &&
      numericType !== Number(ThreadType.User)
    ) {
      return;
    }
    const normalized = valuesFromUnknown(messages)
      .map((message, index) => normalizeMessage(message, index, ownId))
      .filter((message) => message.thread_id && message.message_id);
    for (const m of normalized) trackThread(m.thread_id);
    debugLog("old_messages_received", { type, count: normalized.length, total: totalOldMessageEvents });
    emit({ event: "old_messages", user_id: userId, type, messages: normalized });
  });

  // G1 & G7: Đăng ký an toàn friend_event, group_event, undo (bọc feature-check + try/catch để không bao giờ crash listener).
  if (listener && typeof listener.on === "function") {
    try {
      listener.on("friend_event", (friendEvent) => {
        try {
          const normalized = normalizeFriendEvent(friendEvent, ownId);
          if (normalized && normalized.thread_id && normalized.message_id) {
            trackThread(normalized.thread_id);
            emit({ event: "friend_event", user_id: userId, message: normalized });
          } else {
            debugLog("friend_event_skipped", {
              type: friendEvent && friendEvent.type,
              thread_id: normalized && normalized.thread_id,
            });
          }
        } catch (err) {
          debugLog("friend_event_handler_error", { error: String(err) });
        }
      });
    } catch (err) {
      debugLog("friend_event_subscribe_error", { error: String(err) });
    }

    try {
      listener.on("group_event", (groupEvent) => {
        try {
          const normalized = normalizeGroupEvent(groupEvent, ownId);
          if (normalized && normalized.thread_id && normalized.message_id) {
            trackThread(normalized.thread_id);
            emit({ event: "group_event", user_id: userId, message: normalized });
          } else {
            debugLog("group_event_skipped", {
              act: groupEvent && (groupEvent.act || groupEvent.type),
              thread_id: normalized && normalized.thread_id,
            });
          }
        } catch (err) {
          debugLog("group_event_handler_error", { error: String(err) });
        }
      });
    } catch (err) {
      debugLog("group_event_subscribe_error", { error: String(err) });
    }

    try {
      listener.on("undo", (undoEvent) => {
        try {
          const normalized = normalizeUndoEvent(undoEvent, ownId);
          if (normalized && (normalized.message_id || normalized.cli_msg_id)) {
            if (normalized.thread_id) trackThread(normalized.thread_id);
            emit({ event: "undo", user_id: userId, undo: normalized });
          } else {
            debugLog("undo_event_dropped", { reason: "missing_target_ids" });
          }
        } catch (err) {
          debugLog("undo_event_handler_error", { error: String(err) });
        }
      });
    } catch (err) {
      debugLog("undo_event_subscribe_error", { error: String(err) });
    }
  }

  // Mỗi 30s in ra thống kê: tổng event đã nhận + top 10 thread.
  setInterval(() => {
    const top = Array.from(byThread.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
    emit({
      event: "stats",
      user_id: userId,
      total_message_events: totalMessageEvents,
      total_old_message_events: totalOldMessageEvents,
      distinct_threads: byThread.size,
      top_threads: top,
    });
  }, 30000);

  // Heartbeat mỗi 10s để Python biết Node còn sống (kể cả khi không có event).
  const heartbeatTimer = setInterval(() => {
    emit({ event: "heartbeat", user_id: userId, pid: process.pid, uptime_s: Math.floor(process.uptime()) });
  }, 10000);

  try {
    listener.start({ retryOnClose: true });
    emit({ event: "ready", user_id: userId, pid: process.pid });
  } catch (error) {
    emit({ event: "fatal", error: "listener_start_failed", error_detail: serializeError(error) });
    setTimeout(() => process.exit(4), 250).unref();
  }

  // Cleanup heartbeat khi stop.
  process.on("exit", () => {
    clearInterval(heartbeatTimer);
  });
}

if (require.main === module) {
  main().catch((error) => {
    emit({ event: "fatal", error: "listener_fatal", error_detail: serializeError(error) });
    process.exit(1);
  });
} else {
  module.exports = {
    classifyMessageKind,
    resolveMessageType,
    normalizeMessage,
    normalizeFriendEvent,
    normalizeGroupEvent,
    normalizeUndoEvent,
    formatFileNameWithExt,
    extractFileMetadata,
    formatCallSummaryVi,
    formatMsgInfoActionlistText,
    sanitizeUglyFallbackText,
    unwrapStructuredContent,
  };
}
