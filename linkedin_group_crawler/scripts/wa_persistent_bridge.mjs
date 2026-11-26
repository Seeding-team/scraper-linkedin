#!/usr/bin/env node
/**
 * Persistent WhatsApp Multi-Device NDJSON Bridge (Baileys v7 ESM).
 *
 * Protocol contract:
 * - stdout: EXCLUSIVELY 1-line JSON objects (NDJSON) for events and RPC replies.
 * - stderr: ALL pino logs, console redirects, and diagnostic traces.
 * - stdin:  1-line JSON commands `{ req_id, cmd, payload }`
 *           -> replies `{ req_id, ok: true, data }` or `{ req_id, ok: false, error }`.
 *
 * CLI args:
 *   --account-id <id>
 *   --auth-dir <path>
 *   --media-dir <path>
 *   [--pairing-phone <digits>]
 *   [--browser-name <name>]
 *   [--dry-run]
 */

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { Boom } from "@hapi/boom";
import { HttpsProxyAgent } from "https-proxy-agent";
import pino from "pino";
import QRCode from "qrcode";
import { SocksProxyAgent } from "socks-proxy-agent";
import { ProxyAgent as UndiciProxyAgent } from "undici";
import makeWASocket, {
  Browsers,
  BufferJSON,
  DEFAULT_CONNECTION_CONFIG,
  DisconnectReason,
  downloadMediaMessage,
  extractMessageContent,
  fetchLatestWaWebVersion,
  getContentType,
  isJidBroadcast,
  isJidGroup,
  isJidNewsletter,
  isLidUser,
  isPnUser,
  jidDecode,
  jidNormalizedUser,
  makeCacheableSignalKeyStore,
  normalizeMessageContent,
  proto,
  toNumber,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";

// ---------------------------------------------------------------------------
// 1. Protect stdout so no dependency ever breaks NDJSON framing in bridge mode
// ---------------------------------------------------------------------------
const rawStdoutWrite = process.stdout.write.bind(process.stdout);

function logStderr(level, msg, extra = undefined) {
  try {
    const suffix = extra !== undefined ? ` ${safeStringify(extra)}` : "";
    process.stderr.write(`[wa-bridge][${level}] ${msg}${suffix}\n`);
  } catch {
    // ignore stderr write failures
  }
}

function installStdoutGuard() {
  console.log = (...args) => logStderr("info", args.map(formatConsoleArg).join(" "));
  console.info = (...args) => logStderr("info", args.map(formatConsoleArg).join(" "));
  console.debug = (...args) => logStderr("debug", args.map(formatConsoleArg).join(" "));
  console.warn = (...args) => logStderr("warn", args.map(formatConsoleArg).join(" "));
  console.error = (...args) => logStderr("error", args.map(formatConsoleArg).join(" "));
}

function formatConsoleArg(arg) {
  if (typeof arg === "string") return arg;
  if (arg instanceof Error) return arg.stack || arg.message;
  return safeStringify(arg);
}

function jsonReplacer(_key, value) {
  if (typeof value === "bigint") {
    const num = Number(value);
    return Number.isSafeInteger(num) ? num : value.toString();
  }
  if (
    value &&
    typeof value === "object" &&
    value.constructor &&
    value.constructor.name === "Long" &&
    typeof value.toNumber === "function"
  ) {
    return value.toNumber();
  }
  return value;
}

export function safeStringify(value) {
  try {
    return JSON.stringify(value, jsonReplacer);
  } catch (err) {
    return JSON.stringify({ error: `json_serialize_failed: ${err?.message || String(err)}` });
  }
}

function emitStdout(payload) {
  try {
    rawStdoutWrite(`${safeStringify(payload)}\n`);
  } catch (err) {
    logStderr("error", "Failed to write NDJSON line to stdout", err?.message || String(err));
  }
}

function nowIso() {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// 2. Constants & Pure Normalization Helpers (exported for smoke/unit tests)
// ---------------------------------------------------------------------------
const MAX_AUTO_DOWNLOAD_BYTES = 25 * 1024 * 1024; // 25 MB
const MAX_HISTORY_MESSAGES = 500;
const HISTORY_BATCH_CHUNK_SIZE = 20;
const CHATS_SYNC_CHUNK_SIZE = 50;
const CONTACTS_SYNC_CHUNK_SIZE = 80;
const MAX_MESSAGE_CACHE = 1200;
const MAX_LID_CACHE = 20000;

export const BUNDLED_WA_VERSION = [2, 3000, 1043857760];
const WA_VERSION_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const WA_VERSION_FETCH_TIMEOUT_MS = 4000;
export const MAX_UNSCANNED_AUTH_CYCLES = 2;
export const VALID_PROXY_PROTOCOLS = new Set([
  "http:",
  "https:",
  "socks4:",
  "socks4a:",
  "socks5:",
  "socks5h:",
]);

const CALL_STUB_TYPES = new Set([40, 41, 45, 46, 169, 170]);
const REVOKE_STUB_TYPES = new Set([1, 132]);

const MIME_TO_EXT = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "audio/ogg": "ogg",
  "audio/opus": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/wav": "wav",
  "audio/webm": "webm",
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/zip": "zip",
  "application/x-rar-compressed": "rar",
  "text/plain": "txt",
  "text/csv": "csv",
};

export function parseCliArgs(argv) {
  const args = {
    accountId: "default",
    authDir: path.resolve("storage", "whatsapp_auth", "default"),
    mediaDir: path.resolve("storage", "whatsapp_media", "default"),
    pairingPhone: "",
    browserName: "",
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (key === "dry-run") {
      args.dryRun = true;
      continue;
    }
    if (next === undefined || next.startsWith("--")) continue;
    if (key === "account-id") args.accountId = next;
    else if (key === "auth-dir") args.authDir = path.resolve(next);
    else if (key === "media-dir") args.mediaDir = path.resolve(next);
    else if (key === "pairing-phone") args.pairingPhone = next;
    else if (key === "browser-name") args.browserName = next;
    i += 1;
  }
  return args;
}

export function cleanPhoneDigits(input) {
  if (!input) return "";
  return String(input).replace(/\D/g, "");
}

export function normalizePairingPhone(input) {
  let digits = cleanPhoneDigits(input);
  if (!digits) return "";
  if (digits.startsWith("00")) {
    digits = digits.slice(2);
  } else if (digits.startsWith("0") && digits.length >= 8) {
    digits = `84${digits.slice(1)}`;
  }
  return digits;
}

export function maskProxyUrl(rawProxyUrl) {
  const trimmed = String(rawProxyUrl || "").trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    const scheme = parsed.protocol.replace(/:$/, "").toLowerCase();
    const host = parsed.hostname;
    if (!scheme || !host) return null;
    const hostPart = host.includes(":") ? `[${host}]` : host;
    const portPart = parsed.port ? `:${parsed.port}` : "";
    const hasAuth = Boolean(parsed.username || parsed.password);
    return hasAuth
      ? `${scheme}://***@${hostPart}${portPart}`
      : `${scheme}://${hostPart}${portPart}`;
  } catch {
    return null;
  }
}

export function buildProxyTransports(rawProxyUrl) {
  const trimmed = String(rawProxyUrl || "").trim();
  if (!trimmed) {
    return {
      enabled: false,
      protocol: null,
      maskedUrl: null,
      agent: undefined,
      fetchAgent: undefined,
      dispatcher: undefined,
    };
  }
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch (err) {
    throw new Error(`Invalid WA_PROXY_URL syntax: ${err?.message || String(err)}`);
  }
  const protocol = parsed.protocol.toLowerCase();
  if (!VALID_PROXY_PROTOCOLS.has(protocol) || !parsed.hostname) {
    throw new Error(
      `Unsupported WA_PROXY_URL protocol '${protocol}' (allowed: http, https, socks4, socks5, socks5h)`
    );
  }
  const maskedUrl = maskProxyUrl(trimmed);
  if (protocol.startsWith("socks")) {
    const agent = new SocksProxyAgent(trimmed);
    return {
      enabled: true,
      protocol,
      maskedUrl,
      agent,
      fetchAgent: agent,
      dispatcher: undefined,
    };
  }
  const agent = new HttpsProxyAgent(trimmed);
  const dispatcher = new UndiciProxyAgent(trimmed);
  return {
    enabled: true,
    protocol,
    maskedUrl,
    agent,
    fetchAgent: agent,
    dispatcher,
  };
}

export async function writeJsonAtomic(filePath, data) {
  const dir = path.dirname(filePath);
  await fs.promises.mkdir(dir, { recursive: true });
  const serialized = JSON.stringify(data, BufferJSON.replacer);
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2, 8)}.tmp`;
  try {
    await fs.promises.writeFile(tmpPath, serialized, { encoding: "utf8", mode: 0o600 });
    let renamed = false;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await fs.promises.rename(tmpPath, filePath);
        renamed = true;
        break;
      } catch (err) {
        if ((err?.code === "EPERM" || err?.code === "EBUSY") && attempt < 2) {
          await new Promise((r) => setTimeout(r, 30 * (attempt + 1)));
          continue;
        }
        throw err;
      }
    }
    if (!renamed) {
      throw new Error(`Failed to atomically rename ${tmpPath} -> ${filePath}`);
    }
  } catch (err) {
    try {
      await fs.promises.unlink(tmpPath);
    } catch {
      // ignore temp cleanup failure
    }
    throw err;
  }
}

export function cleanDirtyUnregisteredAuthDir(authDir) {
  if (!authDir || !fs.existsSync(authDir)) return false;
  const credsPath = path.join(authDir, "creds.json");
  if (!fs.existsSync(credsPath)) return false;
  let parsed = null;
  try {
    const raw = fs.readFileSync(credsPath, "utf8");
    parsed = JSON.parse(raw, BufferJSON.reviver);
  } catch {
    // Truncated or corrupted creds.json -> wipe auth files preserving .bridge.lock
    parsed = { registered: false, me: { id: "corrupted" } };
  }
  if (parsed && !parsed.registered && parsed.me) {
    const entries = fs.readdirSync(authDir);
    for (const name of entries) {
      if (name === ".bridge.lock") continue;
      try {
        fs.rmSync(path.join(authDir, name), { recursive: true, force: true });
      } catch {
        // ignore individual removal failure
      }
    }
    return true;
  }
  return false;
}

export function isPidAlive(pid) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return false;
  if (n === process.pid) return true;
  try {
    process.kill(n, 0);
    return true;
  } catch (err) {
    if (err?.code === "EPERM") return true;
    return false;
  }
}

export function acquireBridgeLock(authDir, accountId) {
  fs.mkdirSync(authDir, { recursive: true });
  const lockPath = path.join(authDir, ".bridge.lock");
  const payload = JSON.stringify({
    pid: process.pid,
    account_id: String(accountId || ""),
    acquired_at: nowIso(),
  });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fs.writeFileSync(lockPath, payload, { flag: "wx", encoding: "utf8" });
      return lockPath;
    } catch (err) {
      if (err?.code !== "EEXIST") throw err;
      let existing = null;
      try {
        existing = JSON.parse(fs.readFileSync(lockPath, "utf8"));
      } catch {
        existing = null;
      }
      const holderPid = Number(existing?.pid);
      if (holderPid === process.pid) {
        return lockPath;
      }
      if (holderPid && isPidAlive(holderPid)) {
        throw new Error(
          `Phiên WhatsApp bridge khác (PID ${holderPid}) đang chạy trên cùng thư mục auth '${authDir}'. ` +
            "Đã chặn khởi chạy trùng lặp để tránh xung đột 440 (connectionReplaced)."
        );
      }
      try {
        fs.unlinkSync(lockPath);
      } catch {
        // ignore race unlink
      }
    }
  }
  throw new Error(`Không thể tạo lockfile '${lockPath}' sau khi dọn lock cũ.`);
}

export function releaseBridgeLock(lockPath) {
  if (!lockPath || !fs.existsSync(lockPath)) return;
  try {
    const existing = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    if (existing?.pid && Number(existing.pid) !== process.pid) {
      return;
    }
  } catch {
    // unreadable lockfile; ignore
  }
  try {
    fs.unlinkSync(lockPath);
  } catch {
    // ignore unlink failure
  }
}

export function classifyDisconnectDecision({
  statusCode = null,
  errMessage = "",
  isRegistered = false,
  isShuttingDown = false,
  pairSuccessReceived = false,
  authArtifactEmitted = false,
  unscannedAuthCycles = 0,
  maxUnscannedCycles = MAX_UNSCANNED_AUTH_CYCLES,
} = {}) {
  const code = statusCode !== null && statusCode !== undefined ? Number(statusCode) : null;

  if (code === DisconnectReason.loggedOut || code === 401) {
    return {
      status: "logged_out",
      willReconnect: false,
      isRestartRequired: false,
      nextUnscannedCycles: 0,
      error: "Phiên WhatsApp đã bị đăng xuất khỏi thiết bị chính (401). Vui lòng quét QR hoặc ghép nối lại.",
    };
  }
  if (code === DisconnectReason.forbidden || code === 403) {
    return {
      status: "error",
      willReconnect: false,
      isRestartRequired: false,
      nextUnscannedCycles: unscannedAuthCycles,
      error:
        "WhatsApp từ chối kết nối (403 — IP VPS có thể bị chặn). Vui lòng cấu hình Sticky Proxy riêng (HTTP/SOCKS5) rồi thử lại.",
    };
  }
  if (code === 405) {
    return {
      status: "error",
      willReconnect: false,
      isRestartRequired: false,
      nextUnscannedCycles: unscannedAuthCycles,
      error:
        "Máy chủ WhatsApp từ chối bắt tay kết nối (405 — IP VPS hoặc phiên bản bị hạn chế). Vui lòng cấu hình Sticky Proxy riêng (HTTP/SOCKS5) rồi thử lại.",
    };
  }
  if (code === DisconnectReason.multideviceMismatch || code === 411) {
    return {
      status: "error",
      willReconnect: false,
      isRestartRequired: false,
      nextUnscannedCycles: unscannedAuthCycles,
      error:
        "Tài khoản chưa tương thích chế độ đa thiết bị (411). Vui lòng cập nhật WhatsApp trên điện thoại rồi thử lại.",
    };
  }
  if (code === DisconnectReason.connectionReplaced || code === 440) {
    return {
      status: "error",
      willReconnect: false,
      isRestartRequired: false,
      nextUnscannedCycles: unscannedAuthCycles,
      error:
        "Kết nối bị thay thế bởi phiên khác cùng thiết bị (440). Vui lòng kiểm tra tiến trình trùng lặp rồi bấm Kết nối lại.",
    };
  }

  if (isShuttingDown) {
    return {
      status: "close",
      willReconnect: false,
      isRestartRequired: false,
      nextUnscannedCycles: unscannedAuthCycles,
      error: errMessage || "Bridge shutting down",
    };
  }

  const isRestartRequired = code === DisconnectReason.restartRequired || code === 515;
  if (isRestartRequired) {
    return {
      status: "reconnecting",
      willReconnect: true,
      isRestartRequired: true,
      nextUnscannedCycles: 0,
      error: null,
    };
  }

  const isUnregisteredAuthClose =
    !isRegistered &&
    !pairSuccessReceived &&
    (code === DisconnectReason.timedOut ||
      code === 408 ||
      authArtifactEmitted ||
      /qr refs attempts ended/i.test(String(errMessage || "")));

  if (isUnregisteredAuthClose) {
    const nextCycles = unscannedAuthCycles + 1;
    if (nextCycles >= maxUnscannedCycles) {
      return {
        status: "qr_expired",
        willReconnect: false,
        isRestartRequired: false,
        nextUnscannedCycles: nextCycles,
        error: "Mã QR đã hết hạn — bấm Làm mới QR để tạo mã mới.",
      };
    }
    return {
      status: "reconnecting",
      willReconnect: true,
      isRestartRequired: false,
      nextUnscannedCycles: nextCycles,
      error: errMessage || "Đang làm mới phiên QR...",
    };
  }

  return {
    status: "reconnecting",
    willReconnect: true,
    isRestartRequired: false,
    nextUnscannedCycles: unscannedAuthCycles,
    error: errMessage || (code ? `Disconnect code ${code}` : "Connection closed"),
  };
}

export function extractPhoneFromJid(jid) {
  if (!jid || typeof jid !== "string") return null;
  if (isJidGroup(jid) || isJidBroadcast(jid) || isJidNewsletter(jid)) return null;
  if (isLidUser(jid) || jid.endsWith("@lid") || jid.endsWith("@hosted.lid")) return null;
  const decoded = jidDecode(jid);
  const user = decoded?.user || jid.split("@")[0]?.split(":")[0] || "";
  const digits = cleanPhoneDigits(user);
  return digits.length >= 6 ? digits : null;
}

export function normalizeTargetJid(input) {
  if (!input || typeof input !== "string") return "";
  const trimmed = input.trim();
  if (!trimmed) return "";
  if (trimmed.includes("@")) {
    return jidNormalizedUser(trimmed) || trimmed;
  }
  const digits = cleanPhoneDigits(trimmed);
  if (!digits) return trimmed;
  return `${digits}@s.whatsapp.net`;
}

export function classifyChatType(jid) {
  if (!jid) return "direct";
  if (isJidGroup(jid) || jid.endsWith("@g.us")) return "group";
  if (isJidBroadcast(jid) || jid.endsWith("@broadcast") || isJidNewsletter(jid)) return "broadcast";
  return "direct";
}

export function isIgnoredSystemJid(jid) {
  if (!jid) return true;
  return jid === "status@broadcast" || isJidNewsletter(jid);
}

export function mapAckStatus(status) {
  if (status === undefined || status === null) return "sent";
  if (typeof status === "string") {
    const lower = status.toLowerCase();
    if (["error", "pending", "sent", "delivered", "read", "played"].includes(lower)) return lower;
  }
  const num = Number(status);
  switch (num) {
    case 0:
      return "error";
    case 1:
      return "pending";
    case 2:
      return "sent";
    case 3:
      return "delivered";
    case 4:
      return "read";
    case 5:
      return "played";
    default:
      return "sent";
  }
}

export function normalizeCallStatus(rawStatus) {
  const s = String(rawStatus || "").toLowerCase();
  if (s === "offer" || s === "ringing" || s === "accept" || s === "reject" || s === "timeout" || s === "terminate") {
    return s;
  }
  if (s === "preaccept") return "ringing";
  return null; // ignore noisy low-level ICE/relay updates ('transport', 'relaylatency')
}

export function formatPairingCode(code) {
  const clean = String(code || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (clean.length === 8) return `${clean.slice(0, 4)}-${clean.slice(4)}`;
  return clean;
}

export function toIsoTimestamp(value) {
  if (!value) return nowIso();
  if (value instanceof Date) return value.toISOString();
  const num = toNumber(value);
  if (!Number.isFinite(num) || num <= 0) return nowIso();
  const ms = num > 1e12 ? num : num * 1000;
  return new Date(ms).toISOString();
}

export function parseVCard(vcard) {
  if (!vcard || typeof vcard !== "string") {
    return { display_name: null, phone: null, organization: null };
  }
  let displayName = null;
  let phone = null;
  let organization = null;
  const lines = vcard.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const upper = line.toUpperCase();
    if (upper.startsWith("FN:") || upper.startsWith("FN;")) {
      const idx = line.indexOf(":");
      if (idx >= 0) displayName = line.slice(idx + 1).trim() || displayName;
    } else if (upper.startsWith("ORG:") || upper.startsWith("ORG;")) {
      const idx = line.indexOf(":");
      if (idx >= 0) organization = line.slice(idx + 1).replace(/;+$/g, "").trim() || organization;
    } else if (upper.startsWith("TEL")) {
      const waidMatch = /waid=(\d+)/i.exec(line);
      if (waidMatch) {
        phone = waidMatch[1];
      } else {
        const idx = line.indexOf(":");
        if (idx >= 0 && !phone) {
          const digits = cleanPhoneDigits(line.slice(idx + 1));
          if (digits) phone = digits;
        }
      }
    }
  }
  return { display_name: displayName, phone, organization };
}

export function deriveExtension(mimeType, filename, fallback = "bin") {
  if (filename && typeof filename === "string") {
    const ext = path.extname(filename).replace(/^\./, "").toLowerCase();
    if (ext && /^[a-z0-9]{1,8}$/.test(ext)) return ext;
  }
  if (mimeType && typeof mimeType === "string") {
    const baseMime = mimeType.split(";")[0].trim().toLowerCase();
    if (MIME_TO_EXT[baseMime]) return MIME_TO_EXT[baseMime];
    const parts = baseMime.split("/");
    if (parts[1]) {
      const candidate = parts[1].replace(/[^a-z0-9]/g, "").slice(0, 6);
      if (candidate) return candidate;
    }
  }
  return fallback;
}

export function sanitizeRawKey(key) {
  if (!key || typeof key !== "object") return {};
  const clean = {};
  if (key.remoteJid) clean.remoteJid = String(key.remoteJid);
  if (key.id) clean.id = String(key.id);
  if (typeof key.fromMe === "boolean") clean.fromMe = key.fromMe;
  if (key.participant) clean.participant = String(key.participant);
  if (key.remoteJidAlt) clean.remoteJidAlt = String(key.remoteJidAlt);
  if (key.participantAlt) clean.participantAlt = String(key.participantAlt);
  if (key.addressingMode) clean.addressingMode = String(key.addressingMode);
  return clean;
}

export function unwrapMessagePayload(rawMessage) {
  if (!rawMessage || typeof rawMessage !== "object") return { content: null, viewOnce: false };
  let viewOnce = false;
  let cursor = rawMessage;
  let guard = 0;

  // Walk outer wrappers BEFORE normalizeMessageContent so nested viewOnce flags are preserved
  while (cursor && typeof cursor === "object" && guard < 8) {
    guard += 1;
    if (cursor.ephemeralMessage?.message) {
      cursor = cursor.ephemeralMessage.message;
      continue;
    }
    if (cursor.viewOnceMessage?.message) {
      viewOnce = true;
      cursor = cursor.viewOnceMessage.message;
      continue;
    }
    if (cursor.viewOnceMessageV2?.message) {
      viewOnce = true;
      cursor = cursor.viewOnceMessageV2.message;
      continue;
    }
    if (cursor.viewOnceMessageV2Extension?.message) {
      viewOnce = true;
      cursor = cursor.viewOnceMessageV2Extension.message;
      continue;
    }
    if (cursor.documentWithCaptionMessage?.message) {
      cursor = cursor.documentWithCaptionMessage.message;
      continue;
    }
    if (cursor.editedMessage?.message) {
      cursor = cursor.editedMessage.message;
      continue;
    }
    break;
  }

  const normalized = normalizeMessageContent(cursor) || extractMessageContent(cursor) || cursor;
  return { content: normalized, viewOnce };
}

export function extractQuotedSummary(quotedMessage) {
  if (!quotedMessage || typeof quotedMessage !== "object") return null;
  const { content } = unwrapMessagePayload(quotedMessage);
  if (!content) return null;
  if (typeof content.conversation === "string" && content.conversation) return content.conversation;
  if (content.extendedTextMessage?.text) return content.extendedTextMessage.text;
  if (content.imageMessage) return content.imageMessage.caption || "[Hình ảnh]";
  if (content.videoMessage) return content.videoMessage.caption || "[Video]";
  if (content.ptvMessage) return "[Video ngắn]";
  if (content.audioMessage) return content.audioMessage.ptt ? "[Tin nhắn thoại]" : "[Âm thanh]";
  if (content.documentMessage) return content.documentMessage.fileName || "[Tài liệu]";
  if (content.stickerMessage) return "[Nhãn dán]";
  if (content.locationMessage || content.liveLocationMessage) {
    const loc = content.locationMessage || content.liveLocationMessage;
    return loc.name || loc.address || "[Vị trí]";
  }
  if (content.contactMessage) return `[Danh thiếp: ${content.contactMessage.displayName || ""}]`.trim();
  if (content.contactsArrayMessage) return "[Danh thiếp]";
  const poll =
    content.pollCreationMessage ||
    content.pollCreationMessageV2 ||
    content.pollCreationMessageV3;
  if (poll) return `[Bình chọn: ${poll.name || ""}]`.trim();
  return null;
}

function getContextInfo(content) {
  if (!content || typeof content !== "object") return null;
  const type = getContentType(content);
  if (!type) return null;
  const inner = content[type];
  if (inner && typeof inner === "object" && inner.contextInfo) {
    return inner.contextInfo;
  }
  return null;
}

/**
 * Normalize a Baileys WAMessage into a flat CRM message object (without media download).
 * Returns `{ kind: "message" | "reaction" | "message_update" | "skip", payload }`.
 */
export function normalizeBaileysMessage(msg, ctx = {}) {
  const {
    accountId = "default",
    resolvedChat = null,
    resolvedSender = null,
    senderName = null,
  } = ctx;

  const key = msg?.key || {};
  const rawRemoteJid = key.remoteJid || "";
  if (isIgnoredSystemJid(rawRemoteJid)) {
    return { kind: "skip", payload: null };
  }

  const chatJid = resolvedChat?.canonical_jid || normalizeTargetJid(rawRemoteJid);
  const chatAltJid = resolvedChat?.alt_jid || (key.remoteJidAlt ? jidNormalizedUser(key.remoteJidAlt) : null);
  const isOutgoing = Boolean(key.fromMe);
  const isGroup = classifyChatType(chatJid) === "group";
  const rawSenderJid = isOutgoing
    ? (ctx.meJid || rawRemoteJid)
    : isGroup
      ? (key.participant || rawRemoteJid)
      : rawRemoteJid;

  const senderJid = resolvedSender?.canonical_jid || normalizeTargetJid(rawSenderJid);
  const senderAltJid =
    resolvedSender?.alt_jid ||
    (isGroup && key.participantAlt ? jidNormalizedUser(key.participantAlt) : chatAltJid);
  const senderPhone =
    resolvedSender?.phone_number ||
    extractPhoneFromJid(senderJid) ||
    extractPhoneFromJid(senderAltJid) ||
    null;

  const resolvedName =
    senderName ||
    (!isOutgoing && msg.pushName ? String(msg.pushName) : null) ||
    null;

  const messageId = String(key.id || "");
  const sentAt = toIsoTimestamp(msg.messageTimestamp);
  const ackStatus = mapAckStatus(msg.status);
  const rawKey = sanitizeRawKey(key);
  const stubType = msg.messageStubType !== undefined && msg.messageStubType !== null ? Number(msg.messageStubType) : null;

  const baseFields = {
    account_id: accountId,
    chat_jid: chatJid,
    chat_alt_jid: chatAltJid && chatAltJid !== chatJid ? chatAltJid : null,
    message_id: messageId,
    sender_jid: senderJid,
    sender_alt_jid: senderAltJid && senderAltJid !== senderJid ? senderAltJid : null,
    sender_phone: senderPhone,
    sender_name: resolvedName,
    is_outgoing: isOutgoing,
    msg_type: "unknown",
    text: null,
    media_local_path: null,
    media_mime: null,
    media_filename: null,
    media_size: null,
    media_duration_s: null,
    reply_to_message_id: null,
    quoted_text: null,
    metadata: {},
    raw_key: rawKey,
    ack_status: ackStatus,
    is_edited: false,
    is_deleted: false,
    sent_at: sentAt,
  };

  // 1. Handle stub-only messages (missed calls, revokes)
  if (stubType !== null && !msg.message) {
    if (REVOKE_STUB_TYPES.has(stubType)) {
      return {
        kind: "message",
        payload: {
          ...baseFields,
          msg_type: "revoked",
          is_deleted: true,
          metadata: { stub_type: stubType },
        },
      };
    }
    if (CALL_STUB_TYPES.has(stubType)) {
      const isVideo = stubType === 41 || stubType === 46 || stubType === 170;
      const isGroupCall = stubType === 45 || stubType === 46;
      return {
        kind: "message",
        payload: {
          ...baseFields,
          msg_type: "call_log",
          text: isVideo ? "Cuộc gọi video nhỡ" : "Cuộc gọi thoại nhỡ",
          metadata: {
            is_video: isVideo,
            is_group: isGroupCall,
            missed: true,
            stub_type: stubType,
            stub_params: msg.messageStubParameters || [],
          },
        },
      };
    }
    return { kind: "skip", payload: null };
  }

  // 2. Unwrap message payload (ephemeral / viewOnce / edited / documentWithCaption)
  const rawMessage = msg.message;
  if (!rawMessage || typeof rawMessage !== "object") {
    return { kind: "skip", payload: null };
  }

  // Handle protocolMessage BEFORE deep unwrap so REVOKE / MESSAGE_EDIT are caught cleanly
  const protoMsg =
    rawMessage.protocolMessage ||
    rawMessage.editedMessage?.message?.protocolMessage ||
    rawMessage.ephemeralMessage?.message?.protocolMessage;
  if (protoMsg) {
    const pType = Number(protoMsg.type);
    const targetId = protoMsg.key?.id ? String(protoMsg.key.id) : messageId;
    if (pType === 0) {
      // REVOKE
      return {
        kind: "message_update",
        payload: {
          event: "message_update",
          account_id: accountId,
          chat_jid: chatJid,
          chat_alt_jid: baseFields.chat_alt_jid,
          message_id: targetId,
          is_deleted: true,
          msg_type: "revoked",
          text: null,
          ts: nowIso(),
        },
      };
    }
    if (pType === 14 && protoMsg.editedMessage) {
      // MESSAGE_EDIT
      const { content: editedInner } = unwrapMessagePayload(protoMsg.editedMessage);
      const editedText =
        editedInner?.conversation ||
        editedInner?.extendedTextMessage?.text ||
        editedInner?.imageMessage?.caption ||
        editedInner?.videoMessage?.caption ||
        editedInner?.documentMessage?.caption ||
        "";
      return {
        kind: "message_update",
        payload: {
          event: "message_update",
          account_id: accountId,
          chat_jid: chatJid,
          chat_alt_jid: baseFields.chat_alt_jid,
          message_id: targetId,
          is_edited: true,
          text: editedText,
          ts: nowIso(),
        },
      };
    }
    // Internal protocol messages (history sync, app state sync, ephemeral setting, etc.)
    return { kind: "skip", payload: null };
  }

  // Skip pure senderKeyDistributionMessage / messageContextInfo-only wrappers
  const topKeys = Object.keys(rawMessage).filter(
    (k) => k !== "messageContextInfo" && k !== "senderKeyDistributionMessage"
  );
  if (topKeys.length === 0) {
    return { kind: "skip", payload: null };
  }

  const { content, viewOnce } = unwrapMessagePayload(rawMessage);
  if (!content) {
    return { kind: "skip", payload: null };
  }

  // Handle reactionMessage as a dedicated reaction event
  if (content.reactionMessage) {
    const r = content.reactionMessage;
    const targetKey = r.key || {};
    return {
      kind: "reaction",
      payload: {
        event: "reaction",
        account_id: accountId,
        chat_jid: chatJid,
        chat_alt_jid: baseFields.chat_alt_jid,
        message_id: String(targetKey.id || ""),
        sender_jid: senderJid,
        sender_phone: senderPhone,
        sender_name: resolvedName,
        emoji: r.text || "",
        is_removed: !r.text,
        target_key: sanitizeRawKey(targetKey),
        sent_at: sentAt,
        ts: nowIso(),
      },
    };
  }

  // Extract reply/quote contextInfo if present
  const contextInfo = getContextInfo(content);
  if (contextInfo) {
    if (contextInfo.stanzaId) {
      baseFields.reply_to_message_id = String(contextInfo.stanzaId);
    }
    if (contextInfo.quotedMessage) {
      baseFields.quoted_text = extractQuotedSummary(contextInfo.quotedMessage);
    }
    if (Array.isArray(contextInfo.mentionedJid) && contextInfo.mentionedJid.length > 0) {
      baseFields.metadata.mentions = contextInfo.mentionedJid;
    }
    if (contextInfo.isForwarded) {
      baseFields.metadata.is_forwarded = true;
      baseFields.metadata.forwarding_score = Number(contextInfo.forwardingScore || 1);
    }
  }
  if (viewOnce) {
    baseFields.metadata.view_once = true;
  }

  // Classify every supported rich message type
  if (typeof content.conversation === "string") {
    baseFields.msg_type = "text";
    baseFields.text = content.conversation;
  } else if (content.extendedTextMessage) {
    const ext = content.extendedTextMessage;
    baseFields.msg_type = "text";
    baseFields.text = ext.text || "";
    if (ext.matchedText || ext.canonicalUrl || ext.title) {
      baseFields.metadata.link_preview = {
        url: ext.canonicalUrl || ext.matchedText || null,
        title: ext.title || null,
        description: ext.description || null,
      };
    }
  } else if (content.imageMessage) {
    const img = content.imageMessage;
    baseFields.msg_type = "image";
    baseFields.text = img.caption || "";
    baseFields.media_mime = img.mimetype || "image/jpeg";
    baseFields.media_size = toNumber(img.fileLength) || null;
    baseFields.metadata.width = img.width || null;
    baseFields.metadata.height = img.height || null;
  } else if (content.videoMessage || content.ptvMessage) {
    const vid = content.videoMessage || content.ptvMessage;
    baseFields.msg_type = "video";
    baseFields.text = vid.caption || "";
    baseFields.media_mime = vid.mimetype || "video/mp4";
    baseFields.media_size = toNumber(vid.fileLength) || null;
    baseFields.media_duration_s = vid.seconds !== undefined ? toNumber(vid.seconds) : null;
    baseFields.metadata.width = vid.width || null;
    baseFields.metadata.height = vid.height || null;
    baseFields.metadata.gif_playback = Boolean(vid.gifPlayback);
    baseFields.metadata.ptv = Boolean(content.ptvMessage);
  } else if (content.audioMessage) {
    const aud = content.audioMessage;
    const isPtt = Boolean(aud.ptt);
    baseFields.msg_type = isPtt ? "voice" : "audio";
    baseFields.media_mime = aud.mimetype || (isPtt ? "audio/ogg; codecs=opus" : "audio/mpeg");
    baseFields.media_size = toNumber(aud.fileLength) || null;
    baseFields.media_duration_s = aud.seconds !== undefined ? toNumber(aud.seconds) : null;
    baseFields.metadata.ptt = isPtt;
  } else if (content.documentMessage) {
    const doc = content.documentMessage;
    baseFields.msg_type = "document";
    baseFields.text = doc.caption || "";
    baseFields.media_mime = doc.mimetype || "application/octet-stream";
    baseFields.media_filename = doc.fileName || doc.title || "document";
    baseFields.media_size = toNumber(doc.fileLength) || null;
    if (doc.pageCount) baseFields.metadata.page_count = toNumber(doc.pageCount);
  } else if (content.stickerMessage) {
    const stk = content.stickerMessage;
    baseFields.msg_type = "sticker";
    baseFields.media_mime = stk.mimetype || "image/webp";
    baseFields.media_size = toNumber(stk.fileLength) || null;
    baseFields.metadata.is_animated = Boolean(stk.isAnimated);
    baseFields.metadata.is_lottie = Boolean(stk.isLottie);
    baseFields.metadata.width = stk.width || null;
    baseFields.metadata.height = stk.height || null;
  } else if (content.contactMessage) {
    const c = content.contactMessage;
    const parsed = parseVCard(c.vcard);
    const displayName = c.displayName || parsed.display_name || parsed.phone || "Contact";
    baseFields.msg_type = "contact";
    baseFields.text = displayName;
    baseFields.metadata.display_name = displayName;
    baseFields.metadata.phone = parsed.phone;
    baseFields.metadata.organization = parsed.organization;
    baseFields.metadata.vcard = c.vcard || null;
    baseFields.metadata.contacts = [
      {
        display_name: displayName,
        phone: parsed.phone,
        organization: parsed.organization,
        vcard: c.vcard || null,
      },
    ];
  } else if (content.contactsArrayMessage) {
    const arr = content.contactsArrayMessage;
    const contacts = (arr.contacts || []).map((c) => {
      const parsed = parseVCard(c.vcard);
      return {
        display_name: c.displayName || parsed.display_name || parsed.phone || "Contact",
        phone: parsed.phone,
        organization: parsed.organization,
        vcard: c.vcard || null,
      };
    });
    baseFields.msg_type = "contact";
    baseFields.text =
      arr.displayName || contacts.map((x) => x.display_name).filter(Boolean).join(", ") || "Contacts";
    baseFields.metadata.display_name = baseFields.text;
    baseFields.metadata.contacts = contacts;
  } else if (content.locationMessage || content.liveLocationMessage) {
    const isLive = Boolean(content.liveLocationMessage);
    const loc = content.locationMessage || content.liveLocationMessage;
    baseFields.msg_type = "location";
    baseFields.text = loc.name || loc.address || loc.caption || "";
    baseFields.metadata.latitude = loc.degreesLatitude ?? null;
    baseFields.metadata.longitude = loc.degreesLongitude ?? null;
    baseFields.metadata.name = loc.name || null;
    baseFields.metadata.address = loc.address || null;
    baseFields.metadata.url = loc.url || null;
    baseFields.metadata.is_live = isLive;
    if (loc.caption) baseFields.metadata.caption = loc.caption;
  } else if (
    content.pollCreationMessage ||
    content.pollCreationMessageV2 ||
    content.pollCreationMessageV3
  ) {
    const poll =
      content.pollCreationMessage ||
      content.pollCreationMessageV2 ||
      content.pollCreationMessageV3;
    const options = (poll.options || []).map((o) => o?.optionName || "").filter(Boolean);
    baseFields.msg_type = "poll";
    baseFields.text = poll.name || "";
    baseFields.metadata.question = poll.name || "";
    baseFields.metadata.options = options;
    baseFields.metadata.selectable_count = Number(poll.selectableOptionsCount ?? 1);
  } else if (content.pollUpdateMessage) {
    baseFields.msg_type = "poll";
    baseFields.text = "Đã bình chọn";
    baseFields.metadata.is_poll_vote = true;
    baseFields.metadata.poll_creation_key = sanitizeRawKey(content.pollUpdateMessage.pollCreationMessageKey);
  } else if (content.call || content.callLogMesssage || content.callLogMessage) {
    const callObj = content.callLogMesssage || content.callLogMessage || content.call;
    const isVideo = Boolean(callObj?.isVideo);
    baseFields.msg_type = "call_log";
    baseFields.text = isVideo ? "Cuộc gọi video" : "Cuộc gọi thoại";
    baseFields.metadata.is_video = isVideo;
    baseFields.metadata.duration_seconds = toNumber(callObj?.durationSecs) || 0;
    baseFields.metadata.call_outcome = callObj?.callOutcome ?? null;
  } else {
    const contentType = getContentType(content);
    baseFields.msg_type = "unknown";
    baseFields.metadata.raw_type = contentType || null;
    if (stubType !== null) baseFields.metadata.stub_type = stubType;
  }

  return { kind: "message", payload: baseFields };
}

function isDownloadableMediaType(msgType) {
  return (
    msgType === "image" ||
    msgType === "video" ||
    msgType === "audio" ||
    msgType === "voice" ||
    msgType === "document" ||
    msgType === "sticker"
  );
}

// ---------------------------------------------------------------------------
// 3. Bridge Runtime State & LID <-> PN Resolver
// ---------------------------------------------------------------------------
function createBridgeRuntime(cliArgs) {
  const logger = pino(
    { level: process.env.WA_BRIDGE_LOG_LEVEL || "warn" },
    pino.destination(2)
  );

  const startedAtMs = Date.now();
  const rawProxyUrl = (process.env.WA_PROXY_URL || "").trim();
  const proxyTransports = buildProxyTransports(rawProxyUrl);
  if (proxyTransports.enabled) {
    logStderr(
      "info",
      `Proxy transport enabled (${proxyTransports.protocol}) via ${proxyTransports.maskedUrl}`
    );
  }

  let sock = null;
  let authState = null;
  let saveCredsFn = null;
  let lastSaveCredsPromise = Promise.resolve();
  let lockPath = null;
  let cachedWaVersion = null;
  let cachedWaVersionAtMs = 0;
  let connectionStatus = cliArgs.dryRun ? "dry_run" : "connecting";
  let meInfo = null;
  let lastQr = null;
  let lastQrDataUrl = null;
  let lastPairingCode = null;
  let pairingMode = Boolean(cliArgs.pairingPhone);
  let pairingRequestedForSocket = false;
  let authArtifactEmittedForSocket = false;
  let pairSuccessReceived = false;
  let unscannedAuthCycles = 0;
  let reconnectAttempts = 0;
  let reconnectTimer = null;
  let pairingTimer = null;
  let isShuttingDown = false;
  let activeGeneration = 0;

  // Bounded caches (prevent unbounded memory growth in long-running containers)
  const lidToPnMap = new Map();
  const pnToLidMap = new Map();
  const contactCache = new Map();
  const chatCache = new Map();
  const messageCache = new Map(); // key: `${jid}:${id}` -> WAMessage
  const messageByIdCache = new Map(); // key: id -> WAMessage

  function setBounded(map, key, val, limit) {
    if (!key) return;
    if (map.has(key)) map.delete(key);
    map.set(key, val);
    if (map.size > limit) {
      const oldest = map.keys().next().value;
      if (oldest !== undefined) map.delete(oldest);
    }
  }

  function recordLidPnPair(lidRaw, pnRaw) {
    const lid = lidRaw ? jidNormalizedUser(lidRaw) : "";
    const pn = pnRaw ? jidNormalizedUser(pnRaw) : "";
    if (lid && pn && (isLidUser(lid) || lid.endsWith("@lid")) && (isPnUser(pn) || pn.endsWith("@s.whatsapp.net"))) {
      setBounded(lidToPnMap, lid, pn, MAX_LID_CACHE);
      setBounded(pnToLidMap, pn, lid, MAX_LID_CACHE);
    }
  }

  function cacheMessage(msg) {
    if (!msg?.key?.id) return;
    const id = String(msg.key.id);
    const remote = msg.key.remoteJid ? jidNormalizedUser(msg.key.remoteJid) : "";
    if (remote) {
      setBounded(messageCache, `${remote}:${id}`, msg, MAX_MESSAGE_CACHE);
    }
    setBounded(messageByIdCache, id, msg, MAX_MESSAGE_CACHE);
  }

  function lookupCachedMessage(keyOrId, chatJid = "") {
    if (keyOrId && typeof keyOrId === "object") {
      const id = keyOrId.id ? String(keyOrId.id) : "";
      const remote = keyOrId.remoteJid ? jidNormalizedUser(keyOrId.remoteJid) : "";
      if (remote && id && messageCache.has(`${remote}:${id}`)) {
        return messageCache.get(`${remote}:${id}`);
      }
      if (id && messageByIdCache.has(id)) return messageByIdCache.get(id);
      return null;
    }
    const id = String(keyOrId || "");
    const remote = chatJid ? jidNormalizedUser(chatJid) : "";
    if (remote && id && messageCache.has(`${remote}:${id}`)) {
      return messageCache.get(`${remote}:${id}`);
    }
    return id ? messageByIdCache.get(id) || null : null;
  }

  async function resolveJidPair(primaryRaw, altRaw = null) {
    if (!primaryRaw) {
      return { canonical_jid: "", alt_jid: null, phone_number: null };
    }
    const primary = jidNormalizedUser(primaryRaw) || primaryRaw;
    const alt = altRaw ? (jidNormalizedUser(altRaw) || altRaw) : null;

    if (isJidGroup(primary) || isJidBroadcast(primary) || isJidNewsletter(primary)) {
      return { canonical_jid: primary, alt_jid: alt && alt !== primary ? alt : null, phone_number: null };
    }

    // Record explicit alt mapping if provided by Baileys v7
    if (alt) {
      if (isLidUser(primary) && isPnUser(alt)) recordLidPnPair(primary, alt);
      else if (isPnUser(primary) && isLidUser(alt)) recordLidPnPair(alt, primary);
    }

    let pnJid = isPnUser(primary) ? primary : (alt && isPnUser(alt) ? alt : null);
    let lidJid = isLidUser(primary) ? primary : (alt && isLidUser(alt) ? alt : null);

    // Consult in-memory map + async Baileys v7 signalRepository.lidMapping
    if (lidJid && !pnJid) {
      pnJid = lidToPnMap.get(lidJid) || null;
      if (!pnJid && sock?.signalRepository?.lidMapping?.getPNForLID) {
        try {
          const found = await sock.signalRepository.lidMapping.getPNForLID(lidJid);
          if (found) {
            pnJid = jidNormalizedUser(found) || found;
            recordLidPnPair(lidJid, pnJid);
          }
        } catch {
          // ignore lookup errors
        }
      }
    }
    if (pnJid && !lidJid) {
      lidJid = pnToLidMap.get(pnJid) || null;
      if (!lidJid && sock?.signalRepository?.lidMapping?.getLIDForPN) {
        try {
          const found = await sock.signalRepository.lidMapping.getLIDForPN(pnJid);
          if (found) {
            lidJid = jidNormalizedUser(found) || found;
            recordLidPnPair(lidJid, pnJid);
          }
        } catch {
          // ignore lookup errors
        }
      }
    }

    const canonical = pnJid || primary;
    const secondary = pnJid ? lidJid : (alt && alt !== canonical ? alt : null);
    const phone = extractPhoneFromJid(canonical) || extractPhoneFromJid(secondary);
    return {
      canonical_jid: canonical,
      alt_jid: secondary && secondary !== canonical ? secondary : null,
      phone_number: phone,
    };
  }

  function upsertContactCache(contact) {
    if (!contact) return null;
    const rawId = contact.id ? jidNormalizedUser(contact.id) : "";
    const lid = contact.lid ? jidNormalizedUser(contact.lid) : (isLidUser(rawId) ? rawId : null);
    const pnFromField = contact.phoneNumber ? normalizeTargetJid(contact.phoneNumber) : null;
    const pn = pnFromField || (isPnUser(rawId) ? rawId : null);
    if (lid && pn) recordLidPnPair(lid, pn);

    const canonical = pn || rawId || lid;
    if (!canonical || isIgnoredSystemJid(canonical)) return null;

    const prev = contactCache.get(canonical) || {};
    const savedName = contact.name || prev.saved_name || null;
    const pushName = contact.notify || prev.push_name || null;
    const verifiedName = contact.verifiedName || prev.verified_name || null;
    const displayName = savedName || pushName || verifiedName || prev.display_name || null;
    const avatarUrl =
      typeof contact.imgUrl === "string" && /^https?:\/\//i.test(contact.imgUrl)
        ? contact.imgUrl
        : prev.avatar_url || null;

    const normalized = {
      jid: canonical,
      lid: lid || prev.lid || pnToLidMap.get(canonical) || null,
      phone_number: extractPhoneFromJid(canonical) || prev.phone_number || null,
      display_name: displayName,
      saved_name: savedName,
      push_name: pushName,
      verified_name: verifiedName,
      avatar_url: avatarUrl,
    };
    contactCache.set(canonical, normalized);
    if (normalized.lid && normalized.lid !== canonical) {
      contactCache.set(normalized.lid, normalized);
    }
    return normalized;
  }

  function lookupContactName(jid, altJid = null) {
    const c1 = jid ? contactCache.get(jidNormalizedUser(jid) || jid) : null;
    if (c1?.display_name) return c1.display_name;
    const c2 = altJid ? contactCache.get(jidNormalizedUser(altJid) || altJid) : null;
    if (c2?.display_name) return c2.display_name;
    return null;
  }

  async function normalizeChatRecord(rawChat, isPartialUpdate = false) {
    if (!rawChat?.id || isIgnoredSystemJid(rawChat.id)) return null;
    const resolved = await resolveJidPair(rawChat.id, rawChat.lidJid || rawChat.pnJid || null);
    const chatJid = resolved.canonical_jid;
    const chatType = classifyChatType(chatJid);
    const prev = chatCache.get(chatJid) || {};

    const titleFromContact = lookupContactName(chatJid, resolved.alt_jid);
    const title =
      rawChat.name ||
      rawChat.subject ||
      titleFromContact ||
      prev.title ||
      resolved.phone_number ||
      chatJid;

    const rawTs = rawChat.conversationTimestamp || rawChat.lastMessageRecvTimestamp || rawChat.timestamp;
    const lastMessageAt = rawTs ? toIsoTimestamp(rawTs) : prev.last_message_at || null;

    const record = {
      chat_jid: chatJid,
      raw_jid: rawChat.id,
      chat_alt_jid: resolved.alt_jid || prev.chat_alt_jid || null,
      chat_type: chatType,
      title,
      phone_number: chatType === "direct" ? (resolved.phone_number || prev.phone_number || null) : null,
      last_message_at: lastMessageAt,
      last_message_preview: prev.last_message_preview || null,
    };

    if (rawChat.unreadCount !== undefined && rawChat.unreadCount !== null) {
      record.unread_count = Math.max(0, Number(rawChat.unreadCount));
    } else if (!isPartialUpdate) {
      record.unread_count = prev.unread_count ?? 0;
    }

    if (rawChat.pinned !== undefined && rawChat.pinned !== null) {
      record.is_pinned = Boolean(toNumber(rawChat.pinned) > 0 || rawChat.pinned === true);
    } else if (!isPartialUpdate) {
      record.is_pinned = prev.is_pinned ?? false;
    }

    if (rawChat.muteEndTime !== undefined) {
      const muteEnd = toNumber(rawChat.muteEndTime);
      record.is_muted = Boolean(muteEnd && muteEnd !== 0);
    } else if (!isPartialUpdate) {
      record.is_muted = prev.is_muted ?? false;
    }

    if (rawChat.archived !== undefined) {
      record.is_archived = Boolean(rawChat.archived);
    } else if (!isPartialUpdate) {
      record.is_archived = prev.is_archived ?? false;
    }

    if (Array.isArray(rawChat.participants)) {
      record.participant_count = rawChat.participants.length;
    } else if (rawChat.size !== undefined) {
      record.participant_count = Number(rawChat.size);
    } else if (!isPartialUpdate) {
      record.participant_count = prev.participant_count ?? 0;
    }

    chatCache.set(chatJid, { ...prev, ...record });
    return record;
  }

  function extractMeInfo() {
    const rawMe = sock?.user || authState?.creds?.me;
    if (!rawMe?.id) return null;
    const jid = jidNormalizedUser(rawMe.id) || rawMe.id;
    const lid = rawMe.lid ? jidNormalizedUser(rawMe.lid) : (pnToLidMap.get(jid) || null);
    const phoneNumber = extractPhoneFromJid(jid);
    const displayName = rawMe.name || rawMe.notify || null;
    return {
      jid,
      lid,
      phone_number: phoneNumber,
      display_name: displayName,
    };
  }

  async function downloadIncomingMedia(msg, normalizedMsg) {
    if (!sock || !isDownloadableMediaType(normalizedMsg.msg_type)) return;
    if (normalizedMsg.media_size && normalizedMsg.media_size > MAX_AUTO_DOWNLOAD_BYTES) {
      normalizedMsg.metadata.media_skipped_reason = "exceeds_25mb";
      return;
    }
    try {
      fs.mkdirSync(cliArgs.mediaDir, { recursive: true });
      const safeId = (normalizedMsg.message_id || `msg_${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, "_");
      const ext = deriveExtension(normalizedMsg.media_mime, normalizedMsg.media_filename, "bin");
      const targetPath = path.join(cliArgs.mediaDir, `${safeId}.${ext}`);

      if (fs.existsSync(targetPath)) {
        const stat = fs.statSync(targetPath);
        normalizedMsg.media_local_path = targetPath;
        normalizedMsg.media_size = stat.size;
        return;
      }

      const downloadOpts = proxyTransports.dispatcher
        ? { options: { dispatcher: proxyTransports.dispatcher } }
        : {};
      const buffer = await downloadMediaMessage(
        msg,
        "buffer",
        downloadOpts,
        {
          logger,
          reuploadRequest: sock.updateMediaMessage,
        }
      );

      if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) return;
      if (buffer.length > MAX_AUTO_DOWNLOAD_BYTES) {
        normalizedMsg.metadata.media_skipped_reason = "exceeds_25mb";
        return;
      }

      fs.writeFileSync(targetPath, buffer);
      normalizedMsg.media_local_path = targetPath;
      normalizedMsg.media_size = buffer.length;
    } catch (err) {
      logStderr("warn", `Media download failed for ${normalizedMsg.message_id}`, err?.message || String(err));
      normalizedMsg.metadata.media_download_error = err?.message || String(err);
    }
  }

  async function processSingleMessage(msg, { downloadMedia = false } = {}) {
    if (!msg?.key?.remoteJid || isIgnoredSystemJid(msg.key.remoteJid)) {
      return { kind: "skip", payload: null };
    }
    cacheMessage(msg);

    const resolvedChat = await resolveJidPair(msg.key.remoteJid, msg.key.remoteJidAlt || null);
    const isGroup = classifyChatType(resolvedChat.canonical_jid) === "group";
    const isOutgoing = Boolean(msg.key.fromMe);
    const me = extractMeInfo();

    let resolvedSender;
    if (isOutgoing && me?.jid) {
      resolvedSender = {
        canonical_jid: me.jid,
        alt_jid: me.lid || null,
        phone_number: me.phone_number || null,
      };
    } else if (isGroup && msg.key.participant) {
      resolvedSender = await resolveJidPair(msg.key.participant, msg.key.participantAlt || null);
    } else {
      resolvedSender = resolvedChat;
    }

    // Learn pushName if contact has no saved name yet
    if (!isOutgoing && msg.pushName && resolvedSender.canonical_jid) {
      const existing = contactCache.get(resolvedSender.canonical_jid);
      if (!existing || !existing.push_name) {
        upsertContactCache({
          id: resolvedSender.canonical_jid,
          lid: resolvedSender.alt_jid && isLidUser(resolvedSender.alt_jid) ? resolvedSender.alt_jid : undefined,
          notify: msg.pushName,
        });
      }
    }

    const senderName = isOutgoing
      ? (me?.display_name || "Bạn")
      : (lookupContactName(resolvedSender.canonical_jid, resolvedSender.alt_jid) || msg.pushName || null);

    const result = normalizeBaileysMessage(msg, {
      accountId: cliArgs.accountId,
      resolvedChat,
      resolvedSender,
      senderName,
      meJid: me?.jid || null,
    });

    if (result.kind === "message" && downloadMedia) {
      await downloadIncomingMedia(msg, result.payload);
    }

    // Update chat preview cache
    if (result.kind === "message" && result.payload) {
      const p = result.payload;
      const existingChat = chatCache.get(p.chat_jid) || {
        chat_jid: p.chat_jid,
        raw_jid: msg.key.remoteJid,
        chat_alt_jid: p.chat_alt_jid,
        chat_type: classifyChatType(p.chat_jid),
        title: (!isGroup && senderName) || resolvedChat.phone_number || p.chat_jid,
        phone_number: !isGroup ? resolvedChat.phone_number : null,
      };
      existingChat.last_message_at = p.sent_at;
      existingChat.last_message_preview = p.text || `[${p.msg_type}]`;
      chatCache.set(p.chat_jid, existingChat);
    }

    return result;
  }

  function emitChunked(eventName, listKey, items, chunkSize, extra = {}) {
    if (!items || items.length === 0) return;
    const totalChunks = Math.ceil(items.length / chunkSize);
    for (let i = 0; i < items.length; i += chunkSize) {
      const slice = items.slice(i, i + chunkSize);
      emitStdout({
        event: eventName,
        account_id: cliArgs.accountId,
        [listKey]: slice,
        chunk_index: Math.floor(i / chunkSize),
        total_chunks: totalChunks,
        ...extra,
        ts: nowIso(),
      });
    }
  }

  // -------------------------------------------------------------------------
  // 4. Socket Lifecycle & Reconnection State Machine
  // -------------------------------------------------------------------------
  async function resolveWaWebVersion() {
    const now = Date.now();
    if (cachedWaVersion && now - cachedWaVersionAtMs < WA_VERSION_CACHE_TTL_MS) {
      return cachedWaVersion;
    }
    try {
      const fetchOpts = { signal: AbortSignal.timeout(WA_VERSION_FETCH_TIMEOUT_MS) };
      if (proxyTransports.dispatcher) {
        fetchOpts.dispatcher = proxyTransports.dispatcher;
      }
      const res = await fetchLatestWaWebVersion(fetchOpts);
      if (Array.isArray(res?.version) && res.version.length === 3 && !res.error) {
        cachedWaVersion = res.version;
        cachedWaVersionAtMs = now;
        return res.version;
      }
      logStderr(
        "warn",
        "fetchLatestWaWebVersion returned error/empty, using bundled fallback",
        res?.error
      );
    } catch (err) {
      logStderr(
        "warn",
        "fetchLatestWaWebVersion failed/timed out, using bundled fallback",
        err?.message || String(err)
      );
    }
    return BUNDLED_WA_VERSION;
  }

  function resolveBrowserTuple() {
    // Pairing code & Multi-Device servers strictly validate standard OS/browser display tuples.
    return Browsers.ubuntu("Chrome");
  }

  function enqueueAtomicSaveCreds(authDir, credsObj) {
    const credsPath = path.join(authDir, "creds.json");
    const next = lastSaveCredsPromise
      .catch(() => {})
      .then(() => writeJsonAtomic(credsPath, credsObj));
    lastSaveCredsPromise = next;
    return next;
  }

  async function waitForOpenSocket(targetSock, timeoutMs = 10000) {
    if (!targetSock) {
      throw new Error("WhatsApp socket is not initialized yet");
    }
    if (targetSock.ws?.isOpen) {
      return;
    }
    if (typeof targetSock.waitForSocketOpen !== "function") {
      throw new Error("WhatsApp WebSocket is not open yet");
    }
    await Promise.race([
      targetSock.waitForSocketOpen(),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("Quá thời gian chờ mở WebSocket WhatsApp.")), timeoutMs);
      }),
    ]);
    if (!targetSock.ws?.isOpen) {
      throw new Error("WhatsApp WebSocket closed before pairing code could be requested");
    }
  }

  async function triggerPairingCodeInternal(phoneInput) {
    pairingMode = true;
    const digits = normalizePairingPhone(phoneInput);
    if (digits.length < 7 || digits.length > 15) {
      throw new Error(
        "Số điện thoại không hợp lệ — nhập số VN (09xxxxxxxx) hoặc E.164 (84901234567)."
      );
    }
    if (!sock) {
      throw new Error("WhatsApp socket is not initialized yet");
    }
    if (authState?.creds?.registered) {
      throw new Error("Account is already registered/authenticated; logout first to re-pair");
    }
    await waitForOpenSocket(sock, 10000);
    authArtifactEmittedForSocket = true;
    const rawCode = await sock.requestPairingCode(digits);
    const formatted = formatPairingCode(rawCode);
    lastPairingCode = rawCode;
    emitStdout({
      event: "pairing_code",
      account_id: cliArgs.accountId,
      pairing_code: rawCode,
      formatted_code: formatted,
      phone_number: digits,
      ts: nowIso(),
    });
    return {
      pairing_code: rawCode,
      formatted_code: formatted,
      phone_number: digits,
    };
  }

  function scheduleReconnect(delayMs) {
    if (isShuttingDown) return;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (!isShuttingDown) {
        startSocket().catch((err) => {
          logStderr("error", "Reconnect startSocket failed", err?.stack || String(err));
          reconnectAttempts += 1;
          const nextDelay = Math.min(30000, 1000 * Math.pow(2, reconnectAttempts));
          scheduleReconnect(nextDelay);
        });
      }
    }, delayMs);
  }

  async function cleanupPreviousSocket() {
    if (pairingTimer) {
      clearTimeout(pairingTimer);
      pairingTimer = null;
    }
    if (sock) {
      const prevSock = sock;
      sock = null;
      try {
        prevSock.ev.removeAllListeners("connection.update");
        prevSock.ev.removeAllListeners("creds.update");
        prevSock.ev.removeAllListeners("messaging-history.set");
        prevSock.ev.removeAllListeners("chats.upsert");
        prevSock.ev.removeAllListeners("chats.update");
        prevSock.ev.removeAllListeners("contacts.upsert");
        prevSock.ev.removeAllListeners("contacts.update");
        prevSock.ev.removeAllListeners("lid-mapping.update");
        prevSock.ev.removeAllListeners("messages.upsert");
        prevSock.ev.removeAllListeners("messages.update");
        prevSock.ev.removeAllListeners("messages.delete");
        prevSock.ev.removeAllListeners("messages.reaction");
        prevSock.ev.removeAllListeners("presence.update");
        prevSock.ev.removeAllListeners("groups.upsert");
        prevSock.ev.removeAllListeners("groups.update");
        prevSock.ev.removeAllListeners("call");
      } catch {
        // ignore listener cleanup errors
      }
      try {
        prevSock.end(undefined);
      } catch {
        // ignore socket end errors
      }
      try {
        prevSock.ws?.close();
      } catch {
        // ignore ws close errors
      }
    }
  }

  async function startSocket() {
    if (isShuttingDown) return;
    activeGeneration += 1;
    const gen = activeGeneration;
    pairingRequestedForSocket = false;
    authArtifactEmittedForSocket = false;
    pairSuccessReceived = false;

    await cleanupPreviousSocket();

    fs.mkdirSync(cliArgs.authDir, { recursive: true });
    fs.mkdirSync(cliArgs.mediaDir, { recursive: true });

    // Prevent poisoned reconnect loop when an aborted pairing attempt wrote creds.me while registered=false
    if (cleanDirtyUnregisteredAuthDir(cliArgs.authDir)) {
      logStderr(
        "warn",
        `Wiped dirty unregistered creds.me in ${cliArgs.authDir} before rebuilding auth state`
      );
    }

    const { state } = await useMultiFileAuthState(cliArgs.authDir);
    if (!state.creds.registered && state.creds.me) {
      logStderr("warn", "Detected in-memory dirty unregistered creds.me; resetting auth directory");
      cleanDirtyUnregisteredAuthDir(cliArgs.authDir);
    }
    const saveCredsAtomic = () => enqueueAtomicSaveCreds(cliArgs.authDir, state.creds);
    authState = state;
    saveCredsFn = saveCredsAtomic;

    const version = await resolveWaWebVersion();
    const browser = resolveBrowserTuple();

    connectionStatus = "connecting";
    emitStdout({
      event: "connection",
      account_id: cliArgs.accountId,
      status: "connecting",
      me: extractMeInfo(),
      version,
      ts: nowIso(),
    });

    const socketConfig = {
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      logger,
      browser,
      countryCode: "VN",
      syncFullHistory: false,
      markOnlineOnConnect: false,
      generateHighQualityLinkPreview: false,
      getMessage: async (key) => {
        const cached = lookupCachedMessage(key);
        return cached?.message || undefined;
      },
    };
    if (proxyTransports.agent) {
      socketConfig.agent = proxyTransports.agent;
      socketConfig.fetchAgent = proxyTransports.fetchAgent;
    }
    if (proxyTransports.dispatcher) {
      socketConfig.options = { dispatcher: proxyTransports.dispatcher };
    }

    const newSock = makeWASocket(socketConfig);
    sock = newSock;

    // 4.1 Persist credentials atomically & track promise for 515 restart flush
    newSock.ev.on("creds.update", async () => {
      if (gen !== activeGeneration) return;
      try {
        await saveCredsAtomic();
      } catch (err) {
        logStderr("error", "Atomic saveCreds failed", err?.message || String(err));
      }
    });

    // Surface server-side pairing IQ rejections (e.g. 429 rate-overlimit) cleanly
    try {
      newSock.ws?.on("CB:iq,type:error", (node) => {
        if (gen !== activeGeneration || state.creds.registered || !pairingRequestedForSocket) {
          return;
        }
        const children = Array.isArray(node?.content) ? node.content : [];
        const errChild = children.find((c) => c?.tag === "error");
        const errCode = Number(errChild?.attrs?.code || 0);
        const errText = errChild?.attrs?.text || "";
        if (errCode === 429) {
          const msg =
            "WhatsApp tạm giới hạn gửi mã ghép nối (429). Vui lòng đợi 1-2 phút hoặc chuyển sang quét QR / gắn Proxy riêng.";
          logStderr("error", "Pairing IQ rejected with 429", { errCode, errText });
          emitStdout({
            event: "connection",
            account_id: cliArgs.accountId,
            status: "error",
            me: null,
            status_code: 429,
            error: msg,
            will_reconnect: false,
            ts: nowIso(),
          });
        } else if (errCode >= 400) {
          logStderr("warn", "Pairing IQ error from WhatsApp", { errCode, errText });
        }
      });
    } catch {
      // ignore if ws wrapper does not support custom CB listener
    }

    // Non-blind WS-open readiness fallback for --pairing-phone if WA server skips initial qr frame
    if (pairingMode && cliArgs.pairingPhone && !state.creds.registered) {
      void (async () => {
        try {
          await waitForOpenSocket(newSock, 15000);
          await new Promise((resolve) => {
            pairingTimer = setTimeout(resolve, 2500);
          });
          pairingTimer = null;
          if (gen !== activeGeneration || isShuttingDown || sock !== newSock) return;
          if (!state.creds.registered && !pairingRequestedForSocket && newSock.ws?.isOpen) {
            pairingRequestedForSocket = true;
            try {
              await triggerPairingCodeInternal(cliArgs.pairingPhone);
            } catch (err) {
              logStderr("error", "WS-open fallback requestPairingCode failed", err?.message || String(err));
              connectionStatus = "error";
              emitStdout({
                event: "connection",
                account_id: cliArgs.accountId,
                status: "error",
                me: null,
                error: `Không thể tạo mã ghép nối 8 ký tự: ${err?.message || String(err)}`,
                will_reconnect: false,
                ts: nowIso(),
              });
            }
          }
        } catch (err) {
          if (gen !== activeGeneration || isShuttingDown) return;
          logStderr("warn", "Pairing WS readiness waiter exited early", err?.message || String(err));
        }
      })();
    }

    // 4.2 Connection lifecycle + QR + Phone Pairing Code
    newSock.ev.on("connection.update", async (update) => {
      if (gen !== activeGeneration) return;
      const { connection, lastDisconnect, qr, isNewLogin } = update;

      if (isNewLogin) {
        pairSuccessReceived = true;
      }

      if (qr) {
        authArtifactEmittedForSocket = true;
        if (pairingMode && !state.creds.registered) {
          // Suppress QR emission in pairing mode; first QR confirms WS + Noise handshake are ready!
          if (cliArgs.pairingPhone && !pairingRequestedForSocket && newSock.ws?.isOpen) {
            if (pairingTimer) {
              clearTimeout(pairingTimer);
              pairingTimer = null;
            }
            pairingRequestedForSocket = true;
            try {
              await triggerPairingCodeInternal(cliArgs.pairingPhone);
            } catch (err) {
              logStderr("error", "Auto requestPairingCode failed", err?.message || String(err));
              connectionStatus = "error";
              emitStdout({
                event: "connection",
                account_id: cliArgs.accountId,
                status: "error",
                me: null,
                error: `Không thể tạo mã ghép nối 8 ký tự: ${err?.message || String(err)}`,
                will_reconnect: false,
                ts: nowIso(),
              });
            }
          }
        } else {
          lastQr = qr;
          try {
            lastQrDataUrl = await QRCode.toDataURL(qr, { margin: 2, width: 320 });
          } catch (err) {
            logStderr("warn", "QRCode.toDataURL failed", err?.message || String(err));
            lastQrDataUrl = null;
          }
          emitStdout({
            event: "qr",
            account_id: cliArgs.accountId,
            qr,
            qr_data_url: lastQrDataUrl,
            ts: nowIso(),
          });
        }
      }

      if (connection === "connecting") {
        connectionStatus = "connecting";
        emitStdout({
          event: "connection",
          account_id: cliArgs.accountId,
          status: "connecting",
          me: extractMeInfo(),
          ts: nowIso(),
        });
      } else if (connection === "open") {
        if (pairingTimer) {
          clearTimeout(pairingTimer);
          pairingTimer = null;
        }
        reconnectAttempts = 0;
        unscannedAuthCycles = 0;
        pairSuccessReceived = false;
        lastQr = null;
        lastQrDataUrl = null;
        lastPairingCode = null;
        connectionStatus = "open";
        meInfo = extractMeInfo();
        if (meInfo?.jid && meInfo?.lid) {
          recordLidPnPair(meInfo.lid, meInfo.jid);
        }
        emitStdout({
          event: "connection",
          account_id: cliArgs.accountId,
          status: "open",
          me: meInfo,
          ts: nowIso(),
        });
      } else if (connection === "close") {
        if (pairingTimer) {
          clearTimeout(pairingTimer);
          pairingTimer = null;
        }
        const errObj = lastDisconnect?.error;
        const boomErr = errObj instanceof Boom ? errObj : null;
        const statusCode =
          boomErr?.output?.statusCode ??
          errObj?.output?.statusCode ??
          errObj?.statusCode ??
          null;
        const errMessage =
          errObj?.message || (statusCode ? `Disconnect code ${statusCode}` : "Connection closed");

        const decision = classifyDisconnectDecision({
          statusCode,
          errMessage,
          isRegistered: Boolean(state.creds.registered),
          isShuttingDown,
          pairSuccessReceived,
          authArtifactEmitted: authArtifactEmittedForSocket,
          unscannedAuthCycles,
          maxUnscannedCycles: MAX_UNSCANNED_AUTH_CYCLES,
        });

        unscannedAuthCycles = decision.nextUnscannedCycles;
        connectionStatus = decision.status;

        if (!decision.willReconnect) {
          lastQr = null;
          lastQrDataUrl = null;
          lastPairingCode = null;
          if (decision.status === "logged_out" || decision.status === "qr_expired") {
            meInfo = null;
          }
          logStderr(
            decision.status === "error" ? "error" : "warn",
            `Stopping bridge reconnect (${decision.status}, code=${statusCode}): ${decision.error}`
          );
          emitStdout({
            event: "connection",
            account_id: cliArgs.accountId,
            status: decision.status,
            me: decision.status === "logged_out" || decision.status === "qr_expired" ? null : extractMeInfo(),
            status_code: statusCode,
            error: decision.error,
            will_reconnect: false,
            ts: nowIso(),
          });
          return;
        }

        emitStdout({
          event: "connection",
          account_id: cliArgs.accountId,
          status: decision.status,
          me: extractMeInfo(),
          status_code: statusCode,
          error: decision.error,
          will_reconnect: true,
          ts: nowIso(),
        });

        if (decision.isRestartRequired) {
          // Ensure creds.json is atomically flushed to disk before reconnecting on 515!
          try {
            await lastSaveCredsPromise;
          } catch (saveErr) {
            logStderr("warn", "Failed awaiting lastSaveCredsPromise before 515 reconnect", saveErr?.message || String(saveErr));
          }
          reconnectAttempts = 0;
          scheduleReconnect(250);
        } else {
          const baseDelay = Math.min(30000, 1000 * Math.pow(2, reconnectAttempts));
          const jitter = Math.floor(Math.random() * 500);
          reconnectAttempts += 1;
          scheduleReconnect(baseDelay + jitter);
        }
      }
    });

    // 4.3 LID <-> PN mapping updates
    newSock.ev.on("lid-mapping.update", (mapping) => {
      if (gen !== activeGeneration || !mapping) return;
      if (mapping.lid && mapping.pn) {
        recordLidPnPair(mapping.lid, mapping.pn);
      }
    });

    // 4.4 Initial History Sync (capped & chunked to prevent stdout overload)
    newSock.ev.on("messaging-history.set", async (history) => {
      if (gen !== activeGeneration || !history) return;
      try {
        const { chats = [], contacts = [], messages = [], lidPnMappings = [], isLatest = false, syncType = null } = history;

        for (const pair of lidPnMappings || []) {
          if (pair?.lid && pair?.pn) recordLidPnPair(pair.lid, pair.pn);
        }

        const normalizedContacts = [];
        for (const c of contacts) {
          const nc = upsertContactCache(c);
          if (nc) normalizedContacts.push(nc);
        }
        emitChunked("contacts_sync", "contacts", normalizedContacts, CONTACTS_SYNC_CHUNK_SIZE, {
          source: "history",
        });

        const normalizedChats = [];
        for (const ch of chats) {
          const nch = await normalizeChatRecord(ch, false);
          if (nch) normalizedChats.push(nch);
        }
        emitChunked("chats_sync", "chats", normalizedChats, CHATS_SYNC_CHUNK_SIZE, {
          source: "history",
        });

        // Sort newest-first and cap at MAX_HISTORY_MESSAGES to keep initial sync snappy & bounded
        const sortedMsgs = [...messages]
          .filter((m) => m?.key?.remoteJid && !isIgnoredSystemJid(m.key.remoteJid))
          .sort((a, b) => toNumber(b.messageTimestamp) - toNumber(a.messageTimestamp))
          .slice(0, MAX_HISTORY_MESSAGES);

        const normalizedMessages = [];
        for (const m of sortedMsgs) {
          const res = await processSingleMessage(m, { downloadMedia: false });
          if (res.kind === "message" && res.payload) {
            normalizedMessages.push(res.payload);
          }
        }

        emitChunked("messages_batch", "messages", normalizedMessages, HISTORY_BATCH_CHUNK_SIZE, {
          is_latest: Boolean(isLatest),
          sync_type: syncType ?? null,
        });
      } catch (err) {
        logStderr("error", "messaging-history.set handler error", err?.stack || String(err));
      }
    });

    // 4.5 Chats & Groups Sync
    newSock.ev.on("chats.upsert", async (chats) => {
      if (gen !== activeGeneration || !Array.isArray(chats)) return;
      const out = [];
      for (const ch of chats) {
        const nch = await normalizeChatRecord(ch, false);
        if (nch) out.push(nch);
      }
      emitChunked("chats_sync", "chats", out, CHATS_SYNC_CHUNK_SIZE, { source: "upsert" });
    });

    newSock.ev.on("chats.update", async (updates) => {
      if (gen !== activeGeneration || !Array.isArray(updates)) return;
      const out = [];
      for (const ch of updates) {
        const nch = await normalizeChatRecord(ch, true);
        if (nch) out.push(nch);
      }
      emitChunked("chats_sync", "chats", out, CHATS_SYNC_CHUNK_SIZE, { source: "update" });
    });

    newSock.ev.on("groups.upsert", async (groups) => {
      if (gen !== activeGeneration || !Array.isArray(groups)) return;
      const out = [];
      for (const g of groups) {
        const nch = await normalizeChatRecord(
          { id: g.id, subject: g.subject, participants: g.participants, size: g.size },
          true
        );
        if (nch) out.push(nch);
      }
      emitChunked("chats_sync", "chats", out, CHATS_SYNC_CHUNK_SIZE, { source: "groups_upsert" });
    });

    newSock.ev.on("groups.update", async (groups) => {
      if (gen !== activeGeneration || !Array.isArray(groups)) return;
      const out = [];
      for (const g of groups) {
        if (!g?.id) continue;
        const nch = await normalizeChatRecord(
          { id: g.id, subject: g.subject, participants: g.participants, size: g.size },
          true
        );
        if (nch) out.push(nch);
      }
      emitChunked("chats_sync", "chats", out, CHATS_SYNC_CHUNK_SIZE, { source: "groups_update" });
    });

    // 4.6 Contacts Sync
    newSock.ev.on("contacts.upsert", (contacts) => {
      if (gen !== activeGeneration || !Array.isArray(contacts)) return;
      const out = [];
      for (const c of contacts) {
        const nc = upsertContactCache(c);
        if (nc) out.push(nc);
      }
      emitChunked("contacts_sync", "contacts", out, CONTACTS_SYNC_CHUNK_SIZE, { source: "upsert" });
    });

    newSock.ev.on("contacts.update", (updates) => {
      if (gen !== activeGeneration || !Array.isArray(updates)) return;
      const out = [];
      for (const c of updates) {
        const nc = upsertContactCache(c);
        if (nc) out.push(nc);
      }
      emitChunked("contacts_sync", "contacts", out, CONTACTS_SYNC_CHUNK_SIZE, { source: "update" });
    });

    // 4.7 Realtime Messages Upsert (auto-download media <= 25MB)
    newSock.ev.on("messages.upsert", async (upsert) => {
      if (gen !== activeGeneration || !upsert?.messages) return;
      const upsertType = upsert.type || "notify";
      for (const msg of upsert.messages) {
        try {
          const shouldDownload = upsertType === "notify" || upsertType === "append";
          const res = await processSingleMessage(msg, { downloadMedia: shouldDownload });
          if (res.kind === "skip" || !res.payload) continue;
          if (res.kind === "reaction" || res.kind === "message_update") {
            emitStdout(res.payload);
          } else if (res.kind === "message") {
            emitStdout({
              event: "message",
              upsert_type: upsertType,
              ...res.payload,
              ts: nowIso(),
            });
          }
        } catch (err) {
          logStderr("error", "messages.upsert item failed", err?.stack || String(err));
        }
      }
    });

    // 4.8 Message Status / Edit / Revoke Updates
    newSock.ev.on("messages.update", async (updates) => {
      if (gen !== activeGeneration || !Array.isArray(updates)) return;
      for (const item of updates) {
        try {
          const key = item?.key;
          const upd = item?.update || {};
          if (!key?.remoteJid || !key?.id || isIgnoredSystemJid(key.remoteJid)) continue;
          const resolvedChat = await resolveJidPair(key.remoteJid, key.remoteJidAlt || null);

          const ev = {
            event: "message_update",
            account_id: cliArgs.accountId,
            chat_jid: resolvedChat.canonical_jid,
            chat_alt_jid: resolvedChat.alt_jid,
            message_id: String(key.id),
            ts: nowIso(),
          };
          let hasChange = false;

          if (upd.status !== undefined && upd.status !== null) {
            ev.ack_status = mapAckStatus(upd.status);
            hasChange = true;
          }
          if (upd.messageStubType !== undefined && REVOKE_STUB_TYPES.has(Number(upd.messageStubType))) {
            ev.is_deleted = true;
            ev.msg_type = "revoked";
            ev.text = null;
            hasChange = true;
          }
          if (upd.message === null) {
            ev.is_deleted = true;
            ev.msg_type = "revoked";
            ev.text = null;
            hasChange = true;
          } else if (upd.message?.protocolMessage?.type === 14 && upd.message.protocolMessage.editedMessage) {
            const { content: editedInner } = unwrapMessagePayload(upd.message.protocolMessage.editedMessage);
            ev.is_edited = true;
            ev.text =
              editedInner?.conversation ||
              editedInner?.extendedTextMessage?.text ||
              editedInner?.imageMessage?.caption ||
              "";
            hasChange = true;
          }
          if (hasChange) {
            emitStdout(ev);
          }
        } catch (err) {
          logStderr("warn", "messages.update item failed", err?.message || String(err));
        }
      }
    });

    newSock.ev.on("messages.delete", async (del) => {
      if (gen !== activeGeneration || !del) return;
      if ("keys" in del && Array.isArray(del.keys)) {
        for (const key of del.keys) {
          if (!key?.remoteJid || !key?.id) continue;
          const resolvedChat = await resolveJidPair(key.remoteJid, key.remoteJidAlt || null);
          emitStdout({
            event: "message_update",
            account_id: cliArgs.accountId,
            chat_jid: resolvedChat.canonical_jid,
            chat_alt_jid: resolvedChat.alt_jid,
            message_id: String(key.id),
            is_deleted: true,
            msg_type: "revoked",
            text: null,
            ts: nowIso(),
          });
        }
      }
    });

    // 4.9 Message Reactions
    newSock.ev.on("messages.reaction", async (reactions) => {
      if (gen !== activeGeneration || !Array.isArray(reactions)) return;
      for (const item of reactions) {
        try {
          const key = item?.key || {};
          const reaction = item?.reaction || {};
          if (!key.remoteJid || !key.id) continue;
          const resolvedChat = await resolveJidPair(key.remoteJid, key.remoteJidAlt || null);
          const actorKey = reaction.key || {};
          const actorRaw = actorKey.fromMe
            ? (extractMeInfo()?.jid || key.remoteJid)
            : (actorKey.participant || actorKey.remoteJid || key.remoteJid);
          const resolvedSender = await resolveJidPair(actorRaw, actorKey.participantAlt || null);
          emitStdout({
            event: "reaction",
            account_id: cliArgs.accountId,
            chat_jid: resolvedChat.canonical_jid,
            chat_alt_jid: resolvedChat.alt_jid,
            message_id: String(key.id),
            sender_jid: resolvedSender.canonical_jid,
            sender_phone: resolvedSender.phone_number,
            sender_name: lookupContactName(resolvedSender.canonical_jid, resolvedSender.alt_jid),
            emoji: reaction.text || "",
            is_removed: !reaction.text,
            target_key: sanitizeRawKey(key),
            ts: nowIso(),
          });
        } catch (err) {
          logStderr("warn", "messages.reaction item failed", err?.message || String(err));
        }
      }
    });

    // 4.10 Presence (typing / recording / online)
    newSock.ev.on("presence.update", async (update) => {
      if (gen !== activeGeneration || !update?.id || !update?.presences) return;
      const resolvedChat = await resolveJidPair(update.id);
      for (const [participantRaw, data] of Object.entries(update.presences)) {
        const resolvedPart = await resolveJidPair(participantRaw);
        emitStdout({
          event: "presence",
          account_id: cliArgs.accountId,
          chat_jid: resolvedChat.canonical_jid,
          participant_jid: resolvedPart.canonical_jid,
          state: data?.lastKnownPresence || "unavailable",
          last_seen: data?.lastSeen ? toIsoTimestamp(data.lastSeen) : null,
          ts: nowIso(),
        });
      }
    });

    // 4.11 Inbound/Outbound Call Signaling Events (WACallEvent[])
    newSock.ev.on("call", async (calls) => {
      if (gen !== activeGeneration || !Array.isArray(calls)) return;
      for (const c of calls) {
        try {
          const normalizedStatus = normalizeCallStatus(c.status);
          if (!normalizedStatus) continue;
          const callerJid = c.from || c.chatId || "";
          const resolvedChat = await resolveJidPair(c.chatId || c.from, c.callerPn || null);
          const callerPn =
            c.callerPn ||
            resolvedChat.phone_number ||
            extractPhoneFromJid(callerJid) ||
            null;
          emitStdout({
            event: "call",
            account_id: cliArgs.accountId,
            call_id: String(c.id || ""),
            caller_jid: callerJid,
            caller_pn: callerPn ? cleanPhoneDigits(callerPn) || callerPn : null,
            chat_jid: resolvedChat.canonical_jid,
            status: normalizedStatus,
            raw_status: c.status,
            is_video: Boolean(c.isVideo),
            is_group: Boolean(c.isGroup),
            group_jid: c.groupJid || null,
            offline: Boolean(c.offline),
            timestamp: toIsoTimestamp(c.date),
            ts: nowIso(),
          });
        } catch (err) {
          logStderr("warn", "call event handler failed", err?.message || String(err));
        }
      }
    });
  }

  // -------------------------------------------------------------------------
  // 5. Stdin Command Handlers (all 21 commands)
  // -------------------------------------------------------------------------
  function assertLiveSocket() {
    if (cliArgs.dryRun) {
      throw new Error("Bridge is running in --dry-run mode (no live WhatsApp socket)");
    }
    if (!sock) {
      throw new Error("WhatsApp socket is not initialized");
    }
    if (connectionStatus !== "open") {
      throw new Error(`WhatsApp account is not connected (current status: ${connectionStatus})`);
    }
  }

  function buildQuotedOption(payload) {
    const replyKey = payload?.reply_to_key;
    if (!replyKey || typeof replyKey !== "object" || !replyKey.id) return undefined;
    const cached = lookupCachedMessage(replyKey);
    if (cached) return cached;
    return {
      key: {
        remoteJid: replyKey.remoteJid || normalizeTargetJid(payload.chat_jid),
        id: String(replyKey.id),
        fromMe: Boolean(replyKey.fromMe),
        ...(replyKey.participant ? { participant: replyKey.participant } : {}),
      },
      message: {
        conversation: String(payload.quoted_text || ""),
      },
    };
  }

  async function finalizeSentMessage(sentMsg, fallbackChatJid) {
    if (!sentMsg) {
      return {
        message_id: null,
        chat_jid: fallbackChatJid,
        raw_key: {},
        sent_at: nowIso(),
        ack_status: "sent",
      };
    }
    const res = await processSingleMessage(sentMsg, { downloadMedia: false });
    const msgPayload = res.kind === "message" ? res.payload : null;
    return {
      message_id: String(sentMsg.key?.id || ""),
      chat_jid: msgPayload?.chat_jid || fallbackChatJid,
      chat_alt_jid: msgPayload?.chat_alt_jid || null,
      raw_key: sanitizeRawKey(sentMsg.key),
      sent_at: msgPayload?.sent_at || toIsoTimestamp(sentMsg.messageTimestamp),
      ack_status: msgPayload?.ack_status || "sent",
      message: msgPayload,
    };
  }

  async function sendMediaInternal(payload) {
    const chatJid = normalizeTargetJid(payload.chat_jid);
    if (!chatJid) throw new Error("chat_jid is required");
    const filePath = payload.file_path;
    if (!filePath || typeof filePath !== "string") throw new Error("file_path is required");

    const isRemote = /^https?:\/\//i.test(filePath);
    if (!isRemote && !fs.existsSync(filePath)) {
      throw new Error(`Media file does not exist: ${filePath}`);
    }

    const mediaType = String(payload.media_type || "document").toLowerCase();
    const filename = payload.filename || (isRemote ? "attachment" : path.basename(filePath));
    const caption = payload.caption || undefined;
    const mediaUpload = { url: filePath };
    const quoted = buildQuotedOption(payload);
    const sendOpts = quoted ? { quoted } : undefined;

    let content;
    if (mediaType === "image") {
      content = {
        image: mediaUpload,
        caption,
        mimetype: payload.mime_type || undefined,
      };
    } else if (mediaType === "video") {
      content = {
        video: mediaUpload,
        caption,
        mimetype: payload.mime_type || "video/mp4",
        gifPlayback: Boolean(payload.gif_playback),
      };
    } else if (mediaType === "voice" || mediaType === "audio") {
      const isPtt = mediaType === "voice" || Boolean(payload.ptt);
      content = {
        audio: mediaUpload,
        ptt: isPtt,
        mimetype: payload.mime_type || (isPtt ? "audio/ogg; codecs=opus" : "audio/mpeg"),
      };
    } else if (mediaType === "sticker") {
      content = {
        sticker: mediaUpload,
      };
    } else {
      content = {
        document: mediaUpload,
        mimetype: payload.mime_type || "application/octet-stream",
        fileName: filename,
        caption,
      };
    }

    const sent = await sock.sendMessage(chatJid, content, sendOpts);
    return finalizeSentMessage(sent, chatJid);
  }

  async function handleCommand(cmd, payload = {}) {
    switch (cmd) {
      case "ping":
        return {
          pong: true,
          account_id: cliArgs.accountId,
          status: connectionStatus,
          dry_run: cliArgs.dryRun,
          uptime_s: Math.floor((Date.now() - startedAtMs) / 1000),
          ts: nowIso(),
        };

      case "get_status":
        return {
          account_id: cliArgs.accountId,
          status: connectionStatus,
          me: meInfo || extractMeInfo(),
          has_qr: Boolean(lastQr),
          qr_data_url: lastQrDataUrl,
          pairing_code: lastPairingCode,
          has_proxy: proxyTransports.enabled,
          proxy_masked: proxyTransports.maskedUrl,
          unscanned_auth_cycles: unscannedAuthCycles,
          reconnect_attempts: reconnectAttempts,
          cached_chats: chatCache.size,
          cached_contacts: contactCache.size,
          cached_messages: messageCache.size,
          dry_run: cliArgs.dryRun,
          uptime_s: Math.floor((Date.now() - startedAtMs) / 1000),
        };

      case "request_pairing_code": {
        if (cliArgs.dryRun) {
          throw new Error("Bridge is running in --dry-run mode (no live WhatsApp socket)");
        }
        return await triggerPairingCodeInternal(payload.phone_number);
      }

      case "sync_chats": {
        assertLiveSocket();
        let groupsCount = 0;
        try {
          const groups = await sock.groupFetchAllParticipating();
          const groupRecords = [];
          for (const g of Object.values(groups || {})) {
            const rec = await normalizeChatRecord(
              {
                id: g.id,
                subject: g.subject,
                participants: g.participants,
                size: g.size,
              },
              true
            );
            if (rec) groupRecords.push(rec);
          }
          groupsCount = groupRecords.length;
        } catch (err) {
          logStderr("warn", "groupFetchAllParticipating failed during sync_chats", err?.message || String(err));
        }
        const allChats = Array.from(chatCache.values());
        emitChunked("chats_sync", "chats", allChats, CHATS_SYNC_CHUNK_SIZE, { source: "sync_chats" });
        const uniqueContacts = Array.from(
          new Map(Array.from(contactCache.values()).map((c) => [c.jid, c])).values()
        );
        emitChunked("contacts_sync", "contacts", uniqueContacts, CONTACTS_SYNC_CHUNK_SIZE, {
          source: "sync_chats",
        });
        return {
          chats_count: allChats.length,
          groups_count: groupsCount,
          contacts_count: uniqueContacts.length,
        };
      }

      case "send_text": {
        assertLiveSocket();
        const chatJid = normalizeTargetJid(payload.chat_jid);
        const text = String(payload.text ?? "");
        if (!chatJid) throw new Error("chat_jid is required");
        if (!text.trim()) throw new Error("text must not be empty");
        const content = { text };
        if (Array.isArray(payload.mentions) && payload.mentions.length > 0) {
          content.mentions = payload.mentions.map(normalizeTargetJid).filter(Boolean);
        }
        const quoted = buildQuotedOption(payload);
        const sent = await sock.sendMessage(chatJid, content, quoted ? { quoted } : undefined);
        return await finalizeSentMessage(sent, chatJid);
      }

      case "send_media": {
        assertLiveSocket();
        return await sendMediaInternal(payload);
      }

      case "send_location": {
        assertLiveSocket();
        const chatJid = normalizeTargetJid(payload.chat_jid);
        const lat = Number(payload.latitude);
        const lng = Number(payload.longitude);
        if (!chatJid) throw new Error("chat_jid is required");
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          throw new Error("Valid numeric latitude and longitude are required");
        }
        const quoted = buildQuotedOption(payload);
        const sent = await sock.sendMessage(
          chatJid,
          {
            location: {
              degreesLatitude: lat,
              degreesLongitude: lng,
              name: payload.name || undefined,
              address: payload.address || undefined,
            },
          },
          quoted ? { quoted } : undefined
        );
        return await finalizeSentMessage(sent, chatJid);
      }

      case "send_contact": {
        assertLiveSocket();
        const chatJid = normalizeTargetJid(payload.chat_jid);
        const contactName = String(payload.contact_name || "").trim();
        const digits = cleanPhoneDigits(payload.contact_phone);
        if (!chatJid) throw new Error("chat_jid is required");
        if (!contactName || !digits) {
          throw new Error("contact_name and valid contact_phone are required");
        }
        const orgLine = payload.organization ? `ORG:${String(payload.organization).trim()};\n` : "";
        const vcard =
          "BEGIN:VCARD\n" +
          "VERSION:3.0\n" +
          `FN:${contactName}\n` +
          orgLine +
          `TEL;type=CELL;type=VOICE;waid=${digits}:+${digits}\n` +
          "END:VCARD";
        const quoted = buildQuotedOption(payload);
        const sent = await sock.sendMessage(
          chatJid,
          {
            contacts: {
              displayName: contactName,
              contacts: [{ displayName: contactName, vcard }],
            },
          },
          quoted ? { quoted } : undefined
        );
        return await finalizeSentMessage(sent, chatJid);
      }

      case "send_poll": {
        assertLiveSocket();
        const chatJid = normalizeTargetJid(payload.chat_jid);
        const question = String(payload.question || "").trim();
        const options = Array.isArray(payload.options)
          ? payload.options.map((o) => String(o || "").trim()).filter(Boolean)
          : [];
        if (!chatJid) throw new Error("chat_jid is required");
        if (!question) throw new Error("question is required");
        if (options.length < 2 || options.length > 12) {
          throw new Error("Poll requires between 2 and 12 options");
        }
        const selectableCount = Math.max(
          1,
          Math.min(options.length, Number(payload.selectable_count ?? 1))
        );
        const quoted = buildQuotedOption(payload);
        const sent = await sock.sendMessage(
          chatJid,
          {
            poll: {
              name: question,
              values: options,
              selectableCount,
            },
          },
          quoted ? { quoted } : undefined
        );
        return await finalizeSentMessage(sent, chatJid);
      }

      case "react": {
        assertLiveSocket();
        const key = payload.key;
        if (!key || !key.id || (!key.remoteJid && !payload.chat_jid)) {
          throw new Error("key with id and remoteJid is required");
        }
        const chatJid = normalizeTargetJid(payload.chat_jid || key.remoteJid);
        const reactKey = { ...key, remoteJid: key.remoteJid || chatJid };
        const emoji = payload.emoji !== undefined && payload.emoji !== null ? String(payload.emoji) : "";
        await sock.sendMessage(chatJid, {
          react: {
            text: emoji,
            key: reactKey,
          },
        });
        return { ok: true, chat_jid: chatJid, message_id: String(key.id), emoji };
      }

      case "edit_message": {
        assertLiveSocket();
        const key = payload.key;
        const text = String(payload.text ?? "");
        if (!key || !key.id || (!key.remoteJid && !payload.chat_jid)) {
          throw new Error("key with id and remoteJid is required");
        }
        if (!text.trim()) throw new Error("text must not be empty");
        const chatJid = normalizeTargetJid(payload.chat_jid || key.remoteJid);
        const editKey = { ...key, remoteJid: key.remoteJid || chatJid, fromMe: true };
        const sent = await sock.sendMessage(chatJid, { text, edit: editKey });
        return {
          edited: true,
          chat_jid: chatJid,
          message_id: String(key.id),
          edit_protocol_id: sent?.key?.id || null,
          text,
        };
      }

      case "delete_message": {
        assertLiveSocket();
        const key = payload.key;
        if (!key || !key.id || (!key.remoteJid && !payload.chat_jid)) {
          throw new Error("key with id and remoteJid is required");
        }
        const chatJid = normalizeTargetJid(payload.chat_jid || key.remoteJid);
        const targetKey = { ...key, remoteJid: key.remoteJid || chatJid };
        const forEveryone = payload.for_everyone !== false;
        if (forEveryone) {
          await sock.sendMessage(chatJid, { delete: targetKey });
        } else {
          await sock.chatModify(
            {
              deleteForMe: {
                deleteMedia: Boolean(payload.delete_media),
                key: targetKey,
                timestamp: Math.floor(Date.now() / 1000),
              },
            },
            chatJid
          );
        }
        return {
          deleted: true,
          for_everyone: forEveryone,
          chat_jid: chatJid,
          message_id: String(key.id),
        };
      }

      case "forward_message": {
        assertLiveSocket();
        const toChatJid = normalizeTargetJid(payload.to_chat_jid);
        if (!toChatJid) throw new Error("to_chat_jid is required");

        const cached =
          lookupCachedMessage(payload.key) ||
          lookupCachedMessage(payload.message_id, payload.from_chat_jid);

        if (cached && cached.message) {
          const sent = await sock.sendMessage(toChatJid, { forward: cached });
          return {
            ...(await finalizeSentMessage(sent, toChatJid)),
            mode: "native_forward",
          };
        }
        if (payload.media_local_path && fs.existsSync(payload.media_local_path)) {
          const sentMedia = await sendMediaInternal({
            chat_jid: toChatJid,
            file_path: payload.media_local_path,
            media_type: payload.media_type || "document",
            mime_type: payload.media_mime,
            filename: payload.media_filename,
            caption: payload.text || undefined,
          });
          return { ...sentMedia, mode: "media_resend" };
        }
        if (payload.text && String(payload.text).trim()) {
          const sent = await sock.sendMessage(toChatJid, { text: String(payload.text) });
          return {
            ...(await finalizeSentMessage(sent, toChatJid)),
            mode: "text_resend",
          };
        }
        throw new Error("Cannot forward: message not in memory cache and no fallback text/media provided");
      }

      case "mark_read": {
        assertLiveSocket();
        let keys = Array.isArray(payload.keys) ? payload.keys : [];
        if (keys.length === 0 && payload.chat_jid && Array.isArray(payload.message_ids)) {
          const jid = normalizeTargetJid(payload.chat_jid);
          keys = payload.message_ids.map((id) => ({
            remoteJid: jid,
            id: String(id),
            fromMe: false,
          }));
        }
        if (keys.length === 0) return { marked: 0 };
        await sock.readMessages(keys);
        return { marked: keys.length };
      }

      case "send_presence": {
        assertLiveSocket();
        const chatJid = payload.chat_jid ? normalizeTargetJid(payload.chat_jid) : undefined;
        const allowed = new Set(["available", "unavailable", "composing", "recording", "paused"]);
        const state = allowed.has(payload.state) ? payload.state : "composing";
        await sock.sendPresenceUpdate(state, chatJid);
        return { chat_jid: chatJid || null, state };
      }

      case "check_number": {
        assertLiveSocket();
        const digits = cleanPhoneDigits(payload.phone_number);
        if (digits.length < 6) throw new Error("Invalid phone_number");
        const results = await sock.onWhatsApp(digits);
        const first = Array.isArray(results) && results.length > 0 ? results[0] : null;
        return {
          exists: Boolean(first?.exists),
          jid: first?.jid ? jidNormalizedUser(first.jid) : null,
          phone_number: digits,
        };
      }

      case "fetch_avatar": {
        assertLiveSocket();
        const jid = normalizeTargetJid(payload.jid);
        if (!jid) throw new Error("jid is required");
        const picType = payload.type === "preview" ? "preview" : "image";
        try {
          const url = await sock.profilePictureUrl(jid, picType);
          return { jid, avatar_url: url || null };
        } catch {
          // 404 item-not-found or privacy restricted is normal on WhatsApp
          return { jid, avatar_url: null };
        }
      }

      case "group_metadata": {
        assertLiveSocket();
        const chatJid = normalizeTargetJid(payload.chat_jid);
        if (!chatJid || !isJidGroup(chatJid)) {
          throw new Error("Valid group chat_jid (@g.us) is required");
        }
        const meta = await sock.groupMetadata(chatJid);
        const participants = [];
        for (const p of meta.participants || []) {
          const resolved = await resolveJidPair(p.id, p.phoneNumber || p.lid || null);
          participants.push({
            jid: resolved.canonical_jid,
            raw_jid: p.id,
            alt_jid: resolved.alt_jid,
            phone_number: resolved.phone_number,
            name: lookupContactName(resolved.canonical_jid, resolved.alt_jid),
            admin: p.admin || null,
          });
        }
        return {
          id: meta.id,
          subject: meta.subject || "",
          description: meta.desc || "",
          owner: meta.owner || null,
          creation: meta.creation ? toIsoTimestamp(meta.creation) : null,
          size: meta.size ?? participants.length,
          announce: Boolean(meta.announce),
          restrict: Boolean(meta.restrict),
          participants,
        };
      }

      case "reject_call": {
        assertLiveSocket();
        const callId = String(payload.call_id || "").trim();
        const callerJid = String(payload.caller_jid || "").trim();
        if (!callId || !callerJid) {
          throw new Error("call_id and caller_jid are required");
        }
        await sock.rejectCall(callId, callerJid);
        return { rejected: true, call_id: callId, caller_jid: callerJid };
      }

      case "logout": {
        if (cliArgs.dryRun) {
          connectionStatus = "logged_out";
          return { logged_out: true, dry_run: true };
        }
        isShuttingDown = true;
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
        if (sock) {
          try {
            await sock.logout("User requested logout");
          } catch (err) {
            logStderr("warn", "sock.logout warning", err?.message || String(err));
          }
        }
        await cleanupPreviousSocket();
        try {
          await lastSaveCredsPromise;
        } catch {
          // ignore pending save errors during logout
        }
        releaseBridgeLock(lockPath);
        lockPath = null;
        try {
          await proxyTransports.dispatcher?.close?.();
        } catch {
          // ignore dispatcher close failure
        }
        if (payload.clear_auth !== false && fs.existsSync(cliArgs.authDir)) {
          try {
            fs.rmSync(cliArgs.authDir, { recursive: true, force: true });
          } catch (err) {
            logStderr("warn", "Failed to remove authDir on logout", err?.message || String(err));
          }
        }
        connectionStatus = "logged_out";
        meInfo = null;
        emitStdout({
          event: "connection",
          account_id: cliArgs.accountId,
          status: "logged_out",
          me: null,
          will_reconnect: false,
          ts: nowIso(),
        });
        return { logged_out: true };
      }

      case "shutdown": {
        isShuttingDown = true;
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
        await cleanupPreviousSocket();
        try {
          await lastSaveCredsPromise;
        } catch {
          // ignore save errors during shutdown
        }
        try {
          await proxyTransports.dispatcher?.close?.();
        } catch {
          // ignore dispatcher close failure
        }
        releaseBridgeLock(lockPath);
        lockPath = null;
        return { shutting_down: true };
      }

      default:
        throw new Error(`Unknown command: ${cmd}`);
    }
  }

  // -------------------------------------------------------------------------
  // 6. Stdin NDJSON Loop & Lifecycle Entry
  // -------------------------------------------------------------------------
  function startStdinLoop() {
    const rl = readline.createInterface({
      input: process.stdin,
      crlfDelay: Infinity,
      terminal: false,
    });

    rl.on("line", (rawLine) => {
      const line = rawLine.trim();
      if (!line) return;
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch (err) {
        emitStdout({
          req_id: null,
          ok: false,
          error: `Invalid JSON command: ${err?.message || String(err)}`,
        });
        return;
      }

      const reqId = parsed?.req_id ?? null;
      const cmd = String(parsed?.cmd || "").trim();
      const payload = parsed?.payload && typeof parsed.payload === "object" ? parsed.payload : {};

      Promise.resolve()
        .then(() => handleCommand(cmd, payload))
        .then((data) => {
          emitStdout({ req_id: reqId, ok: true, data });
          if (cmd === "shutdown") {
            setImmediate(() => process.exit(0));
          }
        })
        .catch((err) => {
          const msg = err?.message || String(err);
          logStderr("warn", `Command '${cmd}' failed`, msg);
          emitStdout({ req_id: reqId, ok: false, error: msg });
        });
    });

    rl.on("close", async () => {
      // Parent process closed stdin pipe -> shut down cleanly so no orphan node process remains
      if (!isShuttingDown) {
        isShuttingDown = true;
        if (reconnectTimer) clearTimeout(reconnectTimer);
        await cleanupPreviousSocket();
        try {
          await lastSaveCredsPromise;
        } catch {
          // ignore
        }
        try {
          await proxyTransports.dispatcher?.close?.();
        } catch {
          // ignore
        }
        releaseBridgeLock(lockPath);
        lockPath = null;
        setImmediate(() => process.exit(0));
      }
    });
  }

  async function start() {
    process.stdout.on("error", (err) => {
      if (err?.code === "EPIPE") {
        isShuttingDown = true;
        releaseBridgeLock(lockPath);
        process.exit(0);
      }
    });

    process.on("exit", () => {
      releaseBridgeLock(lockPath);
    });

    const onSignal = async (sig) => {
      logStderr("info", `Received ${sig}, shutting down bridge`);
      isShuttingDown = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      await cleanupPreviousSocket();
      try {
        await lastSaveCredsPromise;
      } catch {
        // ignore
      }
      try {
        await proxyTransports.dispatcher?.close?.();
      } catch {
        // ignore
      }
      releaseBridgeLock(lockPath);
      lockPath = null;
      process.exit(0);
    };
    process.on("SIGINT", () => void onSignal("SIGINT"));
    process.on("SIGTERM", () => void onSignal("SIGTERM"));
    process.on("uncaughtException", (err) => {
      logStderr("error", "uncaughtException", err?.stack || String(err));
    });
    process.on("unhandledRejection", (reason) => {
      logStderr("error", "unhandledRejection", reason?.stack || String(reason));
    });

    startStdinLoop();

    if (cliArgs.dryRun) {
      emitStdout({
        event: "ready",
        account_id: cliArgs.accountId,
        dry_run: true,
        has_proxy: proxyTransports.enabled,
        proxy_masked: proxyTransports.maskedUrl,
        baileys_exports_ok:
          typeof makeWASocket === "function" &&
          typeof useMultiFileAuthState === "function" &&
          typeof makeCacheableSignalKeyStore === "function" &&
          typeof downloadMediaMessage === "function" &&
          typeof fetchLatestWaWebVersion === "function" &&
          typeof DisconnectReason === "object",
        default_version: BUNDLED_WA_VERSION,
        ts: nowIso(),
      });
      return;
    }

    lockPath = acquireBridgeLock(cliArgs.authDir, cliArgs.accountId);

    emitStdout({
      event: "ready",
      account_id: cliArgs.accountId,
      dry_run: false,
      has_proxy: proxyTransports.enabled,
      proxy_masked: proxyTransports.maskedUrl,
      ts: nowIso(),
    });
    await startSocket();
  }

  return { start };
}

// Entrypoint guard (safe across Windows drive-letter casing & Linux)
const currentFilePath = path.resolve(fileURLToPath(import.meta.url));
const entryFilePath = process.argv[1] ? path.resolve(process.argv[1]) : "";
const isMainModule =
  Boolean(entryFilePath) &&
  (process.platform === "win32"
    ? currentFilePath.toLowerCase() === entryFilePath.toLowerCase()
    : currentFilePath === entryFilePath);

if (isMainModule) {
  installStdoutGuard();
  const cliArgs = parseCliArgs(process.argv.slice(2));
  Promise.resolve()
    .then(() => {
      const runtime = createBridgeRuntime(cliArgs);
      return runtime.start();
    })
    .catch((err) => {
      logStderr("error", "Fatal bridge startup error", err?.stack || String(err));
      emitStdout({
        event: "connection",
        account_id: cliArgs.accountId,
        status: "error",
        me: null,
        error: err?.message || String(err),
        will_reconnect: false,
        ts: nowIso(),
      });
      process.exit(1);
    });
}
