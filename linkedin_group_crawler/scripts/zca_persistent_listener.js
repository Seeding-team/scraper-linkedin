#!/usr/bin/env node

const { Zalo, ThreadType } = require("zca-js");
const fs = require("fs");

// Đảm bảo mọi emit ra stdout được flush ngay lập tức (không buffer).
// Trên Windows, pipe Popen có buffer ~4KB, nếu không flush kịp sẽ block Node process.
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
// lại từ URL. Lý do: url video/file/voice cũng host trên domain zdn.vn/
// zadn.vn giống ảnh, nên heuristic isLikelyImageUrl (match theo domain) dễ
// nhận NHẦM video/file/voice thành "image" nếu chỉ dựa vào URL.
const STRUCTURED_MEDIA_MSG_TYPES = new Set([
  "chat.photo", "chat.gif", "chat.doodle",
  "chat.video.msg", "chat.voice", "share.file", "chat.sticker",
]);
const IMAGE_LIKE_MSG_TYPES = new Set(["chat.photo", "chat.gif", "chat.doodle"]);

function resolveMessageType(msgType, imageUrlsCount) {
  if (STRUCTURED_MEDIA_MSG_TYPES.has(msgType)) {
    return IMAGE_LIKE_MSG_TYPES.has(msgType) ? "image" : msgType;
  }
  // msgType lạ/text ("webchat"...) — giữ heuristic cũ: có URL "giống ảnh"
  // trong nội dung text (dán link ảnh trần) thì coi là ảnh.
  return imageUrlsCount ? "image" : msgType;
}

function collectUrls(value, out = []) {
  if (!value) return out;
  if (typeof value === "string") {
    if (isLikelyImageUrl(value)) out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectUrls(item, out);
    return out;
  }
  if (typeof value === "object") {
    let found = false;
    for (const key of ["hdUrl", "normalUrl", "url", "imageUrl", "photoUrl", "src", "fileUrl", "href", "stickerUrl", "stickerWebpUrl"]) {
      if (value[key] && typeof value[key] === "string" && isLikelyImageUrl(value[key])) {
        out.push(value[key]);
        found = true;
        break;
      }
    }
    if (found) {
      return Array.from(new Set(out));
    }
    for (const item of Object.values(value)) collectUrls(item, out);
  }
  return Array.from(new Set(out));
}

// Trước đây chỉ collectUrls() (chỉ nhận URL "giống ảnh") — video/file/voice
// (chat.video.msg, share.file, chat.voice, chat.gif...) không có URL nào được
// lưu lại, khiến tin nhắn loại này KHÔNG THỂ xem/tải được (chỉ còn text/filename
// suông). Hàm này quét RỘNG HƠN: nhận mọi URL http(s) hợp lệ ở các key thường
// chứa link media/file của Zalo, không giới hạn "giống ảnh" — dùng cho
// media_urls (ảnh/video/file/voice) để đưa vào pipeline lưu asset chung.
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
      "hdUrl", "normalUrl", "url", "imageUrl", "photoUrl", "src",
      "fileUrl", "href", "stickerUrl", "stickerWebpUrl",
      "videoUrl", "video_url", "voiceUrl", "voice_url", "oriUrl", "rawUrl",
      "gifUrl", "downloadUrl",
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

function normalizeMessage(raw, index, ownId = null) {
  const data = raw && raw.data ? raw.data : raw || {};
  const content = data.content ?? data.message ?? data.msg ?? raw.content ?? raw.message;
  const attachmentsBlob = data.attachments || data.attachment || data.photos;
  const imageUrls = collectUrls(content).concat(collectUrls(attachmentsBlob));
  // media_urls (rộng hơn imageUrls) — nhận cả URL video/file/voice/gif, không
  // chỉ ảnh, để tin nhắn chat.video.msg/share.file/chat.voice/chat.gif cũng có
  // link thật đưa vào pipeline lưu asset (trước đây các loại này KHÔNG hề có
  // URL nào được lưu, chỉ còn text/filename suông, không xem/tải được).
  const mediaUrls = Array.from(new Set(collectMediaUrls(content).concat(collectMediaUrls(attachmentsBlob))));
  const fileNameHint = collectFileName(content) || collectFileName(attachmentsBlob);
  const msgType = String(data.msgType || data.type || raw.type || "text");
  
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
    if (ownId && idTo === String(ownId)) {
      // Received a personal message sent TO ME
      threadId = senderId;
    } else {
      // I sent a personal message, OR someone sent a group message, OR I sent a group message
      threadId = idTo;
    }
    // Fallback if idTo was empty
    if (!threadId) {
      threadId = senderId;
    }
  }

  // Fix DM: nếu threadId trùng với ownId → Zalo đã trả nhầm ID của chính mình
  // làm threadId cho cuộc chat cá nhân. Phải lấy lại ID đối phương.
  if (ownId && threadId === String(ownId)) {
    if (idTo && idTo !== String(ownId)) {
      threadId = idTo;        // Tôi gửi → thread = người nhận
    } else if (senderId && senderId !== String(ownId)) {
      threadId = senderId;    // Người khác gửi cho tôi → thread = người gửi
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
  let contentText = textOf(content);
  if (imageUrls.length > 0 && contentText) {
    const trimmed = contentText.trim();
    if (imageUrls.includes(trimmed) || isLikelyImageUrl(trimmed)) {
      contentText = "";
    }
  }
  // Tin file/video/voice không có text thật (content chỉ là data URL/blob) —
  // dùng tên file thật (fileName/title) làm content để UI hiện đúng tên file
  // thay vì rỗng hoặc rơi vào nhánh "URL bị strip" ở trên.
  if (!contentText && fileNameHint) {
    contentText = fileNameHint;
  }

  // Zalo tập trung (Mục 7.1 guide): cli_msg_id RIÊNG với message_id — message_id
  // ưu tiên msgId thật (dùng làm source_message_id/dedup key), cli_msg_id CHỈ để
  // thu hồi tin (api.undo cần cả 2). KHÔNG gộp chung như messageId ở trên vì
  // cliMsgId có thể trùng giữa nhiều tin nếu dùng làm dedup key.
  const cliMsgId = data.cliMsgId != null ? String(data.cliMsgId) : (raw.cliMsgId != null ? String(raw.cliMsgId) : null);
  const mentions = Array.isArray(data.mentions) ? data.mentions : (Array.isArray(raw.mentions) ? raw.mentions : null);
  const resolvedType = resolveMessageType(msgType, imageUrls.length);

  return {
    thread_id: threadId || null,
    message_id: messageId,
    sender_id: senderId || null,
    sender_name: data.dName || data.displayName || raw.senderName || raw.sender_name || null,
    timestamp: timestamp ? String(timestamp) : null,
    time_text: timestamp ? new Date(Number(timestamp)).toISOString() : null,
    type: resolvedType,
    content: contentText || null,
    // image_urls: giữ tên field cũ (đỡ đụng Python/DB) nhưng giờ mang URL
    // media THẬT của mọi loại (ảnh/video/file/voice/gif), không chỉ ảnh —
    // xem comment collectMediaUrls() ở trên.
    image_urls: mediaUrls,
    reply_to_id: data.quote?.msgId || data.quoteMsgId || null,
    is_deleted: msgType === "chat.delete" || msgType === "recalled",
    is_sent: isSent,
    ts: timestamp || null,
    cli_msg_id: cliMsgId,
    mentions,
    msg_kind: resolvedType,
    raw,
  };
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

main().catch((error) => {
  emit({ event: "fatal", error: "listener_fatal", error_detail: serializeError(error) });
  process.exit(1);
});
