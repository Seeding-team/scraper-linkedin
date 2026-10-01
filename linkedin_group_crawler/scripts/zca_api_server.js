#!/usr/bin/env node
/**
 * ZCA API Persistent Server (JSON-Lines protocol)
 * ─────────────────────────────────────────────────────────────────
 * Chạy ở server mode: đọc lệnh qua stdin (1 JSON object / dòng),
 * trả kết quả qua stdout (1 JSON object / dòng). Giữ Zalo session
 * sống giữa các lệnh — loại bỏ overhead spawn process mỗi lần gọi.
 *
 * Protocol:
 *   stdin  → {"id":"req-1","command":"list-groups","args":{},"auth":{...}}
 *   stdout → {"id":"req-1","ok":true,"result":{...}}
 *            {"id":"req-1","ok":false,"error":"...","error_detail":{...}}
 *
 * Commands: list-groups | list-friends | group-history | user-history |
 *           group-related-ids | send-message | send-images | remove-unread |
 *           find-user-by-phone | find-user-by-username | first-time-sync |
 *           recall-message | friend-status | send-friend-request |
 *           accept-friend-request | group-members-full | stickers-detail |
 *           send-sticker (Zalo tập trung — port từ ZALO_CENTRALIZED_MODULE_GUIDE.md)
 *
 * Server tự thoát sau MAX_IDLE_MS ms không có request (mặc định 10 phút).
 * Python pool sẽ restart lại khi cần.
 */

"use strict";

const readline = require("readline");

const MAX_IDLE_MS = parseInt(process.env.ZCA_SERVER_IDLE_MS || "600000", 10); // 10 phút

// ── Shared helpers (copy từ zca_api_bridge.js) ────────────────────────────────

function safeJson(value) {
  try { return JSON.stringify(value); } catch (_) { return String(value); }
}

function serializeError(error) {
  if (!error) return { message: "Unknown error" };
  if (error instanceof Error) {
    return { name: error.name || "Error", message: error.message || String(error), code: error.code ?? null };
  }
  if (typeof error === "object") {
    return { name: error.name || "NonError", message: error.message || safeJson(error), code: error.code ?? null };
  }
  return { message: String(error) };
}

function normalizeCookieJar(cookies) {
  if (!cookies) return null;
  let parsed = typeof cookies === "string" ? JSON.parse(cookies) : cookies;
  if (Array.isArray(parsed)) {
    return parsed.map(c => {
      let e = c.expires || c.expirationDate;
      if (typeof e === "number") c.expires = new Date(e * 1000).toISOString();
      return c;
    });
  }
  if (parsed && Array.isArray(parsed.cookies)) {
    parsed.cookies = parsed.cookies.map(c => {
      let e = c.expires || c.expirationDate;
      if (typeof e === "number") c.expires = new Date(e * 1000).toISOString();
      return c;
    });
  }
  return parsed;
}

// ── Session cache ─────────────────────────────────────────────────────────────
// Cache loginApi per auth key để tránh login lại mỗi lần gọi.
// Key = hash(imei + userAgent + cookies[0].value)
const _sessionCache = new Map(); // authKey → { api, lastUsed }
const SESSION_TTL_MS = 25 * 60 * 1000; // 25 phút

function authKey(auth) {
  const cookies = Array.isArray(auth.cookies) ? auth.cookies : [];
  const firstVal = cookies[0]?.value || "";
  return `${auth.imei || ""}|${(auth.userAgent || "").slice(0, 50)}|${firstVal.slice(0, 20)}`;
}

async function getApi(auth) {
  const key = authKey(auth);
  const cached = _sessionCache.get(key);
  const now = Date.now();
  if (cached && now - cached.lastUsed < SESSION_TTL_MS) {
    cached.lastUsed = now;
    return cached.api;
  }
  // Login mới
  const { Zalo } = require("zca-js");
  const cookie = normalizeCookieJar(auth.cookies);
  if (!cookie || !auth.imei || !auth.userAgent) {
    throw new Error("Missing ZCA auth fields: cookies, imei, userAgent");
  }
  const zalo = new Zalo({ selfListen: false, checkUpdate: false, logging: false });
  const api = await zalo.login({ cookie, imei: auth.imei, userAgent: auth.userAgent });
  _sessionCache.set(key, { api, lastUsed: now });
  // Cleanup entries quá cũ
  for (const [k, v] of _sessionCache) {
    if (now - v.lastUsed > SESSION_TTL_MS * 2) _sessionCache.delete(k);
  }
  return api;
}

// ── Helper functions (từ zca_api_bridge.js) ───────────────────────────────────

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
    return value.title || value.text || value.msg || value.message || value.description || value.href || "";
  }
  return "";
}

function isLikelyImageUrl(value) {
  if (!/^https?:\/\//i.test(value)) return false;
  if (/\.(png|jpe?g|webp|gif)(\?|#|$)/i.test(value)) return true;
  return /(photo|image|img|thumb|avatar|zalo|zstatic|zadn|zaloapp)/i.test(value);
}

// Đồng bộ với zca_persistent_listener.js: msgType Zalo đã tự phân loại rõ —
// TIN vào giá trị này, không suy luận lại từ URL (video/file/voice cũng host
// trên domain zdn.vn/zadn.vn giống ảnh nên isLikelyImageUrl dễ nhận nhầm).
const STRUCTURED_MEDIA_MSG_TYPES = new Set([
  "chat.photo", "chat.gif", "chat.doodle",
  "chat.video.msg", "chat.voice", "share.file", "chat.sticker",
]);
const IMAGE_LIKE_MSG_TYPES = new Set(["chat.photo", "chat.gif", "chat.doodle"]);

function resolveMessageType(msgType, imageUrlsCount) {
  if (STRUCTURED_MEDIA_MSG_TYPES.has(msgType)) {
    return IMAGE_LIKE_MSG_TYPES.has(msgType) ? "image" : msgType;
  }
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
    for (const key of ["hdUrl", "normalUrl", "url", "imageUrl", "photoUrl", "src", "fileUrl", "href"]) {
      if (value[key] && typeof value[key] === "string" && isLikelyImageUrl(value[key])) {
        out.push(value[key]); found = true; break;
      }
    }
    if (!found) for (const item of Object.values(value)) collectUrls(item, out);
  }
  return Array.from(new Set(out));
}

// Đồng bộ với zca_persistent_listener.js: quét rộng hơn collectUrls() (không
// giới hạn "giống ảnh") để tin video/file/voice/gif sync lại từ lịch sử cũng
// có URL thật để xem/tải, không chỉ ảnh. Xem comment đầy đủ ở file listener.
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
        out.push(value[key]); found = true; break;
      }
    }
    if (found) return Array.from(new Set(out));
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === "string" && /^(params|attach|attachment|content)$/i.test(key) && /^[{[]/.test(item.trim())) {
        try {
          collectMediaUrls(JSON.parse(item), out);
          continue;
        } catch (_) {
          /* ignore */
        }
      }
      collectMediaUrls(item, out);
    }
  }
  return Array.from(new Set(out));
}

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
  for (const v of values) { const t = toTimestampMs(v); if (t > 0) return t; }
  return 0;
}

function normalizeMessage(raw, index, ownId = null) {
  const data = raw && raw.data ? raw.data : raw || {};
  const content = data.content ?? data.message ?? data.msg ?? raw.content ?? raw.message;
  const attachmentsBlob = data.attachments || data.attachment || data.photos;
  const imageUrls = collectUrls(content).concat(collectUrls(attachmentsBlob));
  const mediaUrls = Array.from(new Set(collectMediaUrls(content).concat(collectMediaUrls(attachmentsBlob))));
  const fileNameHint = collectFileName(content) || collectFileName(attachmentsBlob);
  const msgType = String(data.msgType || data.type || raw.type || "text");
  const senderId = String(data.uidFrom || raw.uidFrom || raw.senderId || raw.sender_id || "");
  const isSent = Boolean(raw.isSelf || data.isSelf || (ownId && String(senderId) === String(ownId)));
  let threadId = String(raw.threadId || data.threadId || data.groupId || raw.groupId || data.grid || raw.grid || "");
  const idTo = String(data.idTo || raw.idTo || data.toUid || raw.toUid || data.receiverId || raw.receiverId || "");
  if (!threadId) threadId = (ownId && idTo === String(ownId)) ? senderId : (idTo || senderId);
  if (ownId && threadId === String(ownId)) {
    if (idTo && idTo !== String(ownId)) threadId = idTo;
    else if (senderId && senderId !== String(ownId)) threadId = senderId;
  }
  const messageId = String(data.msgId || data.cliMsgId || data.realMsgId || raw.msgId || raw.messageId || raw.id || `${data.ts || Date.now()}-${index}`);
  const timestampMs = firstTimestampMs(data.ts, data.time, data.timestamp, raw.timestamp, raw.ts, raw.time, raw.createdAt, data.createdAt);
  let contentText = textOf(content);
  if (imageUrls.length > 0 && contentText) {
    const trimmed = contentText.trim();
    if (imageUrls.includes(trimmed) || isLikelyImageUrl(trimmed)) contentText = "";
  }
  if (!contentText && fileNameHint) {
    contentText = fileNameHint;
  }
  const resolvedType = resolveMessageType(msgType, imageUrls.length);
  return {
    message_id: messageId,
    sender_id: senderId || null,
    sender_name: data.dName || data.displayName || raw.senderName || raw.sender_name || null,
    timestamp: timestampMs ? String(timestampMs) : null,
    time_text: timestampMs ? new Date(Number(timestampMs)).toISOString() : null,
    type: resolvedType,
    content: contentText || null,
    // Giữ tên field cũ nhưng mang URL media thật của mọi loại — xem comment
    // collectMediaUrls() ở trên và trong zca_persistent_listener.js.
    image_urls: mediaUrls,
    reply_to_id: data.quote?.msgId || data.quoteMsgId || null,
    is_deleted: msgType === "chat.delete" || msgType === "recalled",
    is_sent: isSent,
    group_id: threadId || null,
    msg_kind: resolvedType,
  };
}

function sortMessagesOldToNew(messages) {
  return [...messages].sort((a, b) => {
    const tA = toTimestampMs(a.timestamp || a.time_text);
    const tB = toTimestampMs(b.timestamp || b.time_text);
    if (tA !== tB) return tA - tB;
    // Numeric sort để tránh "9" > "10"
    const nA = parseInt(String(a.message_id || ""), 10);
    const nB = parseInt(String(b.message_id || ""), 10);
    if (!isNaN(nA) && !isNaN(nB) && nA !== nB) return nA - nB;
    return String(a.message_id || "").localeCompare(String(b.message_id || ""));
  });
}

function extractMessageList(response) {
  if (Array.isArray(response)) return response;
  if (!response || typeof response !== "object") return [];
  for (const key of ["messages","items","list","groupMsgs","msgs"]) {
    if (Array.isArray(response[key])) return response[key];
  }
  const data = response.data;
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    for (const key of ["messages","items","list","groupMsgs","msgs"]) {
      if (Array.isArray(data[key])) return data[key];
    }
    for (const value of Object.values(data)) {
      if (Array.isArray(value)) return value;
    }
  }
  return [];
}

function normalizeHistory(response, ownId = null) {
  return sortMessagesOldToNew(
    extractMessageList(response)
      .map((item, idx) => normalizeMessage(item, idx, ownId))
      .filter(msg => msg && msg.message_id)
  );
}

function groupIdsFromAllGroups(response) {
  const ids = [];
  const add = (v) => { const id = String(v || "").trim(); if (id && !ids.includes(id)) ids.push(id); };
  if (Array.isArray(response)) {
    for (const item of response) {
      if (typeof item === "string" || typeof item === "number") add(item);
      else add(item.groupId || item.grid || item.id || item.threadId);
    }
    return ids;
  }
  if (response && typeof response === "object") {
    for (const key of ["gridVerMap","gridInfoMap","groupInfoMap"]) {
      const map = response[key];
      if (map && typeof map === "object") for (const groupId of Object.keys(map)) add(groupId);
    }
    for (const key of ["groups","data","items","list"]) {
      for (const item of valuesFromUnknown(response[key])) {
        if (typeof item === "string" || typeof item === "number") add(item);
        else add(item.groupId || item.grid || item.id || item.threadId);
      }
    }
  }
  return ids;
}

function normalizeGroup(groupId, raw) {
  const source = raw || {};
  const lastRaw = source.lastMsg || source.lastMessage || source.msg || source.preview || null;
  const id = String(groupId || source.group_id || source.groupId || source.grid || source.id || source.threadId || source.conversationId || "");
  const name = String(source.name || source.group_name || source.displayName || source.groupName || source.title || source.topic || source.shortName || source.fullName || source.globalId || id);
  const lastMessageAt = firstTimestampMs(source.last_message_at, source.lastMessageAt, source.lastMsgAt, source.lastMsgTime, source.lastTime, source.updateTime, source.updatedAt, source.ts, source.time, lastRaw && lastRaw.ts, lastRaw && lastRaw.time, lastRaw && lastRaw.timestamp, lastRaw && lastRaw.createdAt);
  return {
    group_id: id, name,
    avatar_url: source.avatar || source.avt || source.fullAvt || source.avatarUrl || null,
    last_message: textOf(lastRaw) || null,
    last_message_at: lastMessageAt || null,
    unread_count: Number(source.unreadCount || source.unread || 0) || 0,
    is_pinned: Boolean(source.isPinned || source.pinned || source.pin || source.isPin),
    raw: source,
  };
}

function normalizeGroups(response) {
  const groups = []; const seen = new Set();
  const add = (groupId, raw) => {
    const group = normalizeGroup(groupId, raw);
    if (!group.group_id || seen.has(group.group_id)) return;
    seen.add(group.group_id); groups.push(group);
  };
  if (Array.isArray(response)) { for (const item of response) add(null, item); }
  else if (response && typeof response === "object") {
    for (const key of ["groups","data","items","list"]) for (const item of valuesFromUnknown(response[key])) add(null, item);
    const gridVerMap = response.gridVerMap || response.gridInfoMap || response.groupInfoMap;
    if (gridVerMap && typeof gridVerMap === "object") for (const [gId, raw] of Object.entries(gridVerMap)) add(gId, raw);
    for (const [key, raw] of Object.entries(response)) if (/^\d+$/.test(String(key))) add(key, raw);
  }
  return groups;
}

function sortGroupsLikeZalo(groups) {
  return [...groups].sort((a, b) => {
    const pinA = a.is_pinned ? 1 : 0, pinB = b.is_pinned ? 1 : 0;
    if (pinA !== pinB) return pinB - pinA;
    const tA = toTimestampMs(a.last_message_at), tB = toTimestampMs(b.last_message_at);
    if (tA !== tB) return tB - tA;
    return String(a.name || "").localeCompare(String(b.name || ""));
  });
}

// ── Command handlers ──────────────────────────────────────────────────────────

async function cmdListGroups(api, _args) {
  const allGroupsResponse = await api.getAllGroups();
  const groupIds = groupIdsFromAllGroups(allGroupsResponse);
  let groups;
  if (!groupIds.length) {
    groups = normalizeGroups(allGroupsResponse);
  } else {
    groups = [];
    for (let i = 0; i < groupIds.length; i += 50) {
      const chunk = groupIds.slice(i, i + 50);
      try {
        const infoResponse = await api.getGroupInfo(chunk);
        groups.push(...normalizeGroups(infoResponse));
      } catch (_) {
        for (const gId of chunk) groups.push(normalizeGroup(gId, { grid: gId }));
      }
    }
  }
  return { ok: true, groups: sortGroupsLikeZalo(normalizeGroups(groups)) };
}

async function cmdListFriends(api, _args) {
  // zca-js khong co api.getFriendList — ten dung la getAllFriends (giong
  // zca_api_bridge.js). Goi sai ten lam ZCA pool bao loi va roi ve
  // spawn-per-call (cham) moi lan list-friends.
  const response = await api.getAllFriends();
  const rawList = Array.isArray(response) ? response : Object.values(response || {});
  const friends = rawList.map(raw => {
    const id = String(raw.userId || raw.uid || raw.id || raw.zaloId || "");
    const name = String(raw.name || raw.displayName || raw.fullName || raw.dName || id);
    return { group_id: id, name, avatar_url: raw.avatar || raw.avt || null, last_message: null, last_message_at: null, unread_count: 0, is_pinned: false, is_friend: true };
  }).filter(f => f.group_id);
  return { ok: true, friends };
}

async function cmdGroupHistory(api, args) {
  const { "group-id": groupId, count = 500 } = args;
  if (!groupId) throw new Error("Missing --group-id");
  const response = await api.getGroupChatHistory(String(groupId), Math.min(Number(count), 500));
  return { ok: true, messages: normalizeHistory(response) };
}

async function cmdUserHistory(api, args) {
  const { "user-id": userId, count = 500 } = args;
  if (!userId) throw new Error("Missing --user-id");
  const response = await api.getUserChatHistory(String(userId), Math.min(Number(count), 500));
  return { ok: true, messages: normalizeHistory(response) };
}

async function cmdGroupRelatedIds(api, args) {
  const { "group-id": groupId } = args;
  if (!groupId) throw new Error("Missing --group-id");
  const ids = [];
  const add = (v) => { const id = String(v || "").trim(); if (id && !ids.includes(id)) ids.push(id); };
  add(groupId);
  const infoResponse = await api.getGroupInfo([String(groupId)]);
  const groups = normalizeGroups(infoResponse);
  for (const group of groups) {
    add(group.group_id);
    const raw = group.raw || {};
    add(raw.groupId); add(raw.group_id); add(raw.globalId); add(raw.grid); add(raw.id);
  }
  return { ok: true, ids, groups };
}

async function cmdSendMessage(api, args, payload) {
  const { "thread-id": threadId, type = "1", text = "" } = args;
  if (!threadId) throw new Error("Missing --thread-id");
  const { ThreadType } = require("zca-js");
  const threadType = Number(type) === 0 ? ThreadType.User : ThreadType.Group;
  // mentions: [{pos,uid,len}] cho @tag/@All — xem Mục 3.3.5 + Mục 4.6 (mentionUtils)
  // của ZALO_CENTRALIZED_MODULE_GUIDE.md. Đến từ payload (không phải args) vì là mảng object.
  const mentions = (payload || {}).mentions;
  const quoteIn = (payload || {}).quote;
  const messageContent = { msg: text };
  if (Array.isArray(mentions) && mentions.length) {
    messageContent.mentions = mentions;
  }
  if (quoteIn && quoteIn.msgId) {
    // Tinh nang "Tra loi tin nhan" - dung dung shape SendMessageQuote cua zca-js
    // (node_modules/zca-js/dist/apis/sendMessage.d.ts): {content, msgType, uidFrom,
    // msgId, cliMsgId, ts, ttl}. Co tinh bo qua propertyExt (khong bat buoc o runtime
    // du type khai la required) va ep content ve string, giong cach lam da duoc kiem
    // chung o project tham khao (tranh dung loi zca-js throw voi content khong phai
    // string + msgType "webchat").
    messageContent.quote = {
      content: String(quoteIn.content || ""),
      msgType: "webchat",
      uidFrom: quoteIn.uidFrom != null ? String(quoteIn.uidFrom) : "",
      msgId: String(quoteIn.msgId),
      cliMsgId: quoteIn.cliMsgId != null ? String(quoteIn.cliMsgId) : "",
      ts: quoteIn.ts != null ? String(quoteIn.ts) : "",
      ttl: 0,
    };
  }
  const response = await api.sendMessage(messageContent, String(threadId), threadType);
  // QUAN TRỌNG: key PHẢI là "response" (khớp với zca_api_bridge.js's
  // `emitAndExit({ ok: true, response })`) — Python (_persist_outgoing_message
  // -> _build_outgoing_message_id) luôn đọc result.get("response") để lấy
  // msgId thật từ { message: { msgId } }. Worker pool này trước đây trả về
  // key "result" (không khớp) -> Python luôn đọc None -> luôn dùng ID tạm
  // "local-..." -> khi Zalo echo tin về với msgId thật, DB coi là 2 tin khác
  // nhau -> hiển thị lặp trên UI mỗi lần gửi (dù Zalo chỉ nhận 1 tin thật).
  return { ok: true, response };
}

async function cmdRemoveUnread(api, args) {
  const { "thread-id": threadId, type = "1" } = args;
  if (!threadId) throw new Error("Missing --thread-id");
  const { ThreadType } = require("zca-js");
  const threadType = Number(type) === 0 ? ThreadType.User : ThreadType.Group;
  try {
    const result = await api.markAsRead(String(threadId), threadType);
    return { ok: true, result };
  } catch (err) {
    return { ok: true, result: null, warning: serializeError(err).message };
  }
}

async function cmdFindUserByPhone(api, args) {
  const { phone } = args;
  if (!phone) throw new Error("Missing --phone");
  const result = await api.findUser(String(phone));
  return { ok: true, user: result };
}

async function cmdFindUserByUsername(api, args) {
  const { username } = args;
  if (!username) throw new Error("Missing --username");
  const result = await api.findUserByUsername(String(username));
  return { ok: true, user: result };
}

// ── Zalo tập trung: recall/mentions/friend-actions/group-scan (port guide) ────

async function cmdRecallMessage(api, args, payload) {
  const { "thread-id": threadId, type = "1" } = args;
  const { msg_id: msgId, cli_msg_id: cliMsgId } = payload || {};
  if (!threadId) throw new Error("Missing --thread-id");
  if (!msgId || !cliMsgId) throw new Error("Missing msg_id/cli_msg_id in payload");
  const { ThreadType } = require("zca-js");
  const threadType = Number(type) === 0 ? ThreadType.User : ThreadType.Group;
  const response = await api.undo({ msgId, cliMsgId }, String(threadId), threadType);
  return { ok: true, response };
}

// Thả cảm xúc (reaction) cho 1 tin nhắn — giống bấm giữ tin nhắn trên app Zalo
// rồi chọn icon. Cần đúng msgId (source_message_id, số nguyên) + cliMsgId của
// tin ĐANG được react tới (không phải tin mới), giống hệt recall-message.
async function cmdAddReaction(api, args, payload) {
  const { "thread-id": threadId, type = "1" } = args;
  const { msg_id: msgId, cli_msg_id: cliMsgId, icon } = payload || {};
  if (!threadId) throw new Error("Missing --thread-id");
  if (!msgId || !cliMsgId) throw new Error("Missing msg_id/cli_msg_id in payload");
  if (!icon) throw new Error("Missing icon in payload");
  const { ThreadType, Reactions } = require("zca-js");
  const threadType = Number(type) === 0 ? ThreadType.User : ThreadType.Group;
  // icon là tên enum Reactions (vd "HEART", "LIKE"..., hoặc "NONE" để BỎ react
  // — Reactions.NONE = "" nên KHÔNG được check bằng "!reactionValue" (chuỗi
  // rỗng là falsy trong JS, sẽ bị coi nhầm là "không tìm thấy") — phải check
  // đúng bằng "key có tồn tại trong enum hay không".
  const iconKey = String(icon).toUpperCase();
  if (!(iconKey in Reactions)) throw new Error(`Unknown reaction icon: ${icon}`);
  const reactionValue = Reactions[iconKey];
  const response = await api.addReaction(reactionValue, {
    data: { msgId: String(msgId), cliMsgId: String(cliMsgId) },
    threadId: String(threadId),
    type: threadType,
  });
  return { ok: true, response };
}

async function cmdFriendStatus(api, args) {
  const { uid } = args;
  if (!uid) throw new Error("Missing --uid");
  const response = await api.getFriendRequestStatus(String(uid));
  // is_requested=true: MÌNH đã gửi lời mời (chờ họ chấp nhận).
  // is_requesting=true: HỌ đang gửi lời mời cho MÌNH (chờ mình chấp nhận).
  // Cảnh báo Mục 11.1 guide: rất dễ map ngược 2 field này — KHÔNG đảo tên khi dùng ở Python/FE.
  return { ok: true, response };
}

async function cmdSendFriendRequest(api, args, payload) {
  const { uid } = args;
  const msg = (payload || {}).msg || "";
  if (!uid) throw new Error("Missing --uid");
  const response = await api.sendFriendRequest(String(msg), String(uid));
  return { ok: true, response };
}

async function cmdAcceptFriendRequest(api, args) {
  const { uid } = args;
  if (!uid) throw new Error("Missing --uid");
  const response = await api.acceptFriendRequest(String(uid));
  return { ok: true, response };
}

async function cmdGroupMembersFull(api, args) {
  const { "group-id": groupId } = args;
  if (!groupId) throw new Error("Missing --group-id");
  const infoResponse = await api.getGroupInfo(String(groupId));
  const info = (infoResponse.gridInfoMap || {})[String(groupId)] || {};
  // getGroupInfo đã trả memberIds ĐẦY ĐỦ (không cap 155-200 — cap đó chỉ ở UI Zalo),
  // currentMems có sẵn role (admin/member) cho từng id.
  const memberIds = Array.from(new Set(info.memberIds || (info.currentMems || []).map(m => m.id))).filter(Boolean);
  const roleById = new Map((info.currentMems || []).map(m => [String(m.id), m]));

  const profiles = [];
  for (let i = 0; i < memberIds.length; i += 50) {
    const chunk = memberIds.slice(i, i + 50);
    try {
      const resp = await api.getGroupMembersInfo(chunk);
      const map = resp.profiles || {};
      for (const id of chunk) {
        const p = map[id];
        const roleInfo = roleById.get(String(id));
        profiles.push({
          uid: String(id),
          display_name: p ? (p.zaloName || p.displayName || String(id)) : String(id),
          avatar_url: p ? p.avatar : null,
          role: roleInfo ? (roleInfo.isAdmin ? "admin" : "member") : "member",
        });
      }
    } catch (err) {
      for (const id of chunk) profiles.push({ uid: String(id), display_name: String(id), avatar_url: null, role: "member" });
    }
  }
  return { ok: true, group_id: String(groupId), total_member: info.totalMember || memberIds.length, members: profiles };
}

async function cmdStickersDetail(api, args) {
  const { ids } = args;
  if (!ids) throw new Error("Missing --ids");
  const idList = String(ids).split(",").map(s => Number(s.trim())).filter(n => Number.isFinite(n));
  const response = await api.getStickersDetail(idList);
  return { ok: true, stickers: response };
}

// Trước đây UI chỉ có ô nhập "sticker id đã biết" (Zalo không có API liệt kê
// đủ mọi category qua zca-js) — searchSticker(keyword) là API TÌM sticker
// thật theo từ khoá (giống thanh tìm sticker trong app Zalo), trả về
// {cate_id, sticker_id} nên phải gọi tiếp getStickersDetail để lấy URL ảnh
// thật hiển thị lên UI. Gộp 2 lệnh thành 1 round-trip cho FE đơn giản.
async function cmdSearchStickers(api, args) {
  const { keyword, limit = "24" } = args;
  if (!keyword) throw new Error("Missing --keyword");
  const basics = await api.searchSticker(String(keyword), Number(limit) || 24);
  const ids = Array.from(new Set((basics || []).map((b) => Number(b.sticker_id)).filter((n) => Number.isFinite(n))));
  if (ids.length === 0) return { ok: true, stickers: [] };
  const details = await api.getStickersDetail(ids);
  return { ok: true, stickers: details };
}

async function cmdInviteToGroup(api, args) {
  // "add thẳng nếu đã bạn bè, invite nếu quen biết" (Mục 3.3.5 guide) — zca-js expose
  // 2 API khác nhau tuỳ quan hệ; thử addUserToGroup (thêm thẳng) trước, fallback
  // inviteUserToGroups (gửi lời mời) nếu bị từ chối.
  const { uid, "group-id": groupId } = args;
  if (!uid) throw new Error("Missing --uid");
  if (!groupId) throw new Error("Missing --group-id");
  try {
    const response = await api.addUserToGroup(String(uid), String(groupId));
    const failed = Array.isArray(response.errorMembers) && response.errorMembers.includes(String(uid));
    if (!failed) return { ok: true, mode: "add", response };
  } catch (_) {
    // rơi qua invite bên dưới
  }
  const response = await api.inviteUserToGroups(String(uid), String(groupId));
  return { ok: true, mode: "invite", response };
}

async function cmdSendSticker(api, args, payload) {
  const { "thread-id": threadId, type = "1" } = args;
  const { id, cateId, type: stickerType } = payload || {};
  if (!threadId) throw new Error("Missing --thread-id");
  if (id == null || cateId == null) throw new Error("Missing id/cateId in payload");
  const { ThreadType } = require("zca-js");
  const threadType = Number(type) === 0 ? ThreadType.User : ThreadType.Group;
  const response = await api.sendSticker({ id: Number(id), cateId: Number(cateId), type: Number(stickerType || 1) }, String(threadId), threadType);
  return { ok: true, response };
}

async function cmdFirstTimeSync(api, args) {
  const messagesPerChat = Math.min(Number(args["messages-per-chat"] || 50), 200);
  const groupLimit = Math.min(Number(args["group-limit"] || 25), 50);
  const includeFriends = String(args["include-friends"] || "true") === "true";

  const [groupsResult, friendsResult] = await Promise.allSettled([
    cmdListGroups(api, {}),
    includeFriends ? cmdListFriends(api, {}) : Promise.resolve({ ok: true, friends: [] }),
  ]);

  const groups = groupsResult.status === "fulfilled" ? (groupsResult.value.groups || []) : [];
  const friends = friendsResult.status === "fulfilled" ? (friendsResult.value.friends || []) : [];
  const targets = [...groups.slice(0, groupLimit), ...(includeFriends ? friends.slice(0, 10) : [])];

  const allMessages = [];
  const errors = [];
  for (const target of targets) {
    try {
      const isGroup = !target.is_friend;
      const response = isGroup
        ? await api.getGroupChatHistory(String(target.group_id), messagesPerChat)
        : await api.getUserChatHistory(String(target.group_id), messagesPerChat);
      const messages = normalizeHistory(response).map(m => ({ ...m, group_id: m.group_id || target.group_id }));
      allMessages.push(...messages);
    } catch (err) {
      errors.push({ group_id: target.group_id, error: serializeError(err).message });
    }
  }

  return {
    ok: true, groups, friends, messages: allMessages,
    total_groups: groups.length, total_friends: friends.length,
    total_messages: allMessages.length, errors,
  };
}

// ── Dispatch ──────────────────────────────────────────────────────────────────

const COMMANDS = {
  "list-groups": cmdListGroups,
  "list-friends": cmdListFriends,
  "group-history": cmdGroupHistory,
  "user-history": cmdUserHistory,
  "group-related-ids": cmdGroupRelatedIds,
  "send-message": cmdSendMessage,
  "send-images": async (api, args, payload) => {
    // send-images vẫn cần file_paths từ payload
    const { "thread-id": threadId, type = "1" } = args;
    if (!threadId) throw new Error("Missing --thread-id");
    const filePaths = (payload || {}).file_paths || [];
    const text = (payload || {}).text || "";
    const { ThreadType } = require("zca-js");
    const threadType = Number(type) === 0 ? ThreadType.User : ThreadType.Group;
    const response = await api.sendAttachment({ filePaths, msg: text }, String(threadId), threadType);
    // Cung bug + fix nhu cmdSendMessage phia tren - xem comment o do.
    return { ok: true, response };
  },
  "remove-unread": cmdRemoveUnread,
  "find-user-by-phone": cmdFindUserByPhone,
  "find-user-by-username": cmdFindUserByUsername,
  "first-time-sync": cmdFirstTimeSync,
  "recall-message": cmdRecallMessage,
  "add-reaction": cmdAddReaction,
  "friend-status": cmdFriendStatus,
  "send-friend-request": cmdSendFriendRequest,
  "accept-friend-request": cmdAcceptFriendRequest,
  "group-members-full": cmdGroupMembersFull,
  "stickers-detail": cmdStickersDetail,
  "search-stickers": cmdSearchStickers,
  "send-sticker": cmdSendSticker,
  "invite-to-group": cmdInviteToGroup,
  // sync-old-messages: complex (needs listener), keep using spawn-per-call via zca_api_bridge.js
};

// ── Server event loop ─────────────────────────────────────────────────────────

let idleTimer = null;

function resetIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    process.stderr.write(`[zca-server] idle timeout ${MAX_IDLE_MS}ms — shutting down\n`);
    process.exit(0);
  }, MAX_IDLE_MS);
  if (idleTimer.unref) idleTimer.unref(); // không giữ event loop
}

function sendLine(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

async function handleRequest(req) {
  const { id, command, args = {}, auth, payload } = req;
  if (!command) {
    sendLine({ id, ok: false, error: "Missing 'command' field" });
    return;
  }
  if (command === "ping") {
    sendLine({ id, ok: true, result: { pong: true } });
    return;
  }
  if (command === "shutdown") {
    sendLine({ id, ok: true, result: { message: "shutting down" } });
    setImmediate(() => process.exit(0));
    return;
  }
  const handler = COMMANDS[command];
  if (!handler) {
    sendLine({ id, ok: false, error: `Unknown command: ${command}` });
    return;
  }
  if (!auth) {
    sendLine({ id, ok: false, error: "Missing 'auth' field" });
    return;
  }
  try {
    const api = await getApi(auth);
    const result = await handler(api, args, payload);
    sendLine({ id, ok: true, ...result });
  } catch (err) {
    const serialized = serializeError(err);
    sendLine({ id, ok: false, error: serialized.message, error_detail: serialized });
  }
}

// Startup: ghi ra stderr để Python pool biết server đã sẵn sàng
process.stderr.write("[zca-server] ready\n");
resetIdleTimer();

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  resetIdleTimer();
  let req;
  try {
    req = JSON.parse(trimmed);
  } catch (_) {
    sendLine({ id: null, ok: false, error: `Invalid JSON: ${trimmed.slice(0, 200)}` });
    return;
  }
  handleRequest(req).catch((err) => {
    sendLine({ id: req.id, ok: false, error: String(err) });
  });
});

rl.on("close", () => {
  process.stderr.write("[zca-server] stdin closed — shutting down\n");
  process.exit(0);
});

process.on("uncaughtException", (err) => {
  process.stderr.write(`[zca-server] uncaughtException: ${err.message}\n`);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  process.stderr.write(`[zca-server] unhandledRejection: ${reason}\n`);
});
