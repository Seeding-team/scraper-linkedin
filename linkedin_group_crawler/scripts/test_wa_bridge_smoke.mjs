#!/usr/bin/env node
/**
 * Smoke & contract verification suite for WhatsApp Persistent Bridge (Baileys v7 ESM).
 *
 * Verifies:
 * 1. `node --check` on `scripts/wa_persistent_bridge.mjs` (0 syntax errors).
 * 2. Baileys v7 ESM exports (`makeWASocket`, `useMultiFileAuthState`, `DisconnectReason`,
 *    `downloadMediaMessage`, `fetchLatestBaileysVersion`, `Browsers`, `isPnUser`, `isLidUser`).
 * 3. `qrcode`, `pino`, `@hapi/boom` ESM imports + QR PNG data URL generation.
 * 4. Subprocess `--dry-run` execution: stdin `ping`, `get_status`, live-socket guard,
 *    invalid JSON guard, `shutdown` -> 100% pure NDJSON on stdout (ZERO stray text!).
 * 5. Pure normalization helpers across all message types (text, image, video, voice, audio,
 *    document, sticker, contact/vCard, location, poll, reaction, call_log, revoked, edited,
 *    ephemeral/viewOnce unwrap, LID<->PN alt JIDs, call status mapping).
 * 6. Zero regression on existing CommonJS Zalo scripts (`zca_api_bridge.js`, `zca_persistent_listener.js`,
 *    and `require("zca-js")` via CommonJS).
 */

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
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
  fetchLatestWaWebVersion,
  isLidUser,
  isPnUser,
  makeCacheableSignalKeyStore,
  proto,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";

import {
  acquireBridgeLock,
  buildProxyTransports,
  BUNDLED_WA_VERSION,
  classifyDisconnectDecision,
  cleanDirtyUnregisteredAuthDir,
  formatPairingCode,
  mapAckStatus,
  maskProxyUrl,
  MAX_UNSCANNED_AUTH_CYCLES,
  normalizeBaileysMessage,
  normalizeCallStatus,
  normalizePairingPhone,
  parseVCard,
  releaseBridgeLock,
  writeJsonAtomic,
} from "./wa_persistent_bridge.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const crawlerRoot = path.resolve(__dirname, "..");
const bridgePath = path.join(__dirname, "wa_persistent_bridge.mjs");
const zcaBridgePath = path.join(__dirname, "zca_api_bridge.js");
const zcaListenerPath = path.join(__dirname, "zca_persistent_listener.js");

const results = [];

async function runCheck(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, status: "PASS", ms: Date.now() - t0 });
    console.log(`[PASS] ${name} (${Date.now() - t0}ms)`);
  } catch (err) {
    results.push({ name, status: "FAIL", ms: Date.now() - t0, error: err?.message || String(err) });
    console.error(`[FAIL] ${name}: ${err?.stack || err}`);
  }
}

// 1. Syntax check on wa_persistent_bridge.mjs
await runCheck("1. node --check scripts/wa_persistent_bridge.mjs", () => {
  const res = spawnSync(process.execPath, ["--check", bridgePath], { encoding: "utf8" });
  assert.equal(res.status, 0, `Syntax check failed: ${res.stderr}`);
});

// 2. Baileys v7 ESM exports + supporting libs + proxy transports
await runCheck("2. Baileys v7 ESM exports + qrcode/pino/@hapi/boom + proxy libs", async () => {
  assert.equal(typeof makeWASocket, "function", "makeWASocket must be a function");
  assert.equal(typeof useMultiFileAuthState, "function", "useMultiFileAuthState must be a function");
  assert.equal(typeof makeCacheableSignalKeyStore, "function", "makeCacheableSignalKeyStore must be a function");
  assert.equal(typeof downloadMediaMessage, "function", "downloadMediaMessage must be a function");
  assert.equal(typeof fetchLatestWaWebVersion, "function", "fetchLatestWaWebVersion must be a function");
  assert.equal(typeof DisconnectReason, "object", "DisconnectReason must be an object");
  assert.equal(DisconnectReason.loggedOut, 401);
  assert.equal(DisconnectReason.restartRequired, 515);
  assert.equal(typeof Browsers.ubuntu, "function");
  assert.equal(typeof isPnUser, "function");
  assert.equal(typeof isLidUser, "function");
  assert.equal(Array.isArray(DEFAULT_CONNECTION_CONFIG.version), true);
  assert.deepEqual(BUNDLED_WA_VERSION, [2, 3000, 1043857760]);
  assert.equal(proto.Message.ProtocolMessage.Type.REVOKE, 0);
  assert.equal(proto.Message.ProtocolMessage.Type.MESSAGE_EDIT, 14);
  assert.equal(typeof HttpsProxyAgent, "function");
  assert.equal(typeof SocksProxyAgent, "function");
  assert.equal(typeof UndiciProxyAgent, "function");

  const testBoom = new Boom("test", { statusCode: 401 });
  assert.equal(testBoom.output.statusCode, 401);

  const testLogger = pino({ level: "silent" }, pino.destination(2));
  assert.equal(typeof testLogger.warn, "function");

  const dataUrl = await QRCode.toDataURL("whatsapp-smoke-qr-test");
  assert.ok(dataUrl.startsWith("data:image/png;base64,"), "QRCode must produce PNG data URL");
});

// 3. Subprocess --dry-run NDJSON contract & stdout purity
await runCheck("3. wa_persistent_bridge.mjs --dry-run NDJSON RPC & pure stdout", async () => {
  const child = spawn(
    process.execPath,
    [bridgePath, "--account-id", "acc-smoke-1", "--dry-run"],
    {
      cwd: crawlerRoot,
      stdio: ["pipe", "pipe", "pipe"],
    }
  );

  let stdoutRaw = "";
  let stderrRaw = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdoutRaw += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderrRaw += chunk;
  });

  const commands = [
    JSON.stringify({ req_id: "1", cmd: "ping" }),
    JSON.stringify({ req_id: "2", cmd: "get_status" }),
    JSON.stringify({ req_id: "3", cmd: "send_text", payload: { chat_jid: "84901234567@s.whatsapp.net", text: "hi" } }),
    "NOT_VALID_JSON{{{",
    JSON.stringify({ req_id: "4", cmd: "shutdown" }),
  ];

  // Wait briefly for startup ready event, then send commands
  await new Promise((r) => setTimeout(r, 250));
  for (const line of commands) {
    child.stdin.write(`${line}\n`);
  }
  child.stdin.end();

  const exitCode = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`--dry-run bridge timed out. stdout=${stdoutRaw} stderr=${stderrRaw}`));
    }, 10000);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });

  assert.equal(exitCode, 0, `Expected exit 0, got ${exitCode}. stderr=${stderrRaw}`);

  const lines = stdoutRaw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  assert.ok(lines.length >= 6, `Expected >=6 NDJSON lines, got ${lines.length}: ${stdoutRaw}`);

  const parsed = lines.map((line, idx) => {
    try {
      return JSON.parse(line);
    } catch (err) {
      throw new Error(`Stray non-JSON text on stdout line ${idx + 1}: ${line}`);
    }
  });

  const readyEv = parsed.find((x) => x.event === "ready");
  assert.ok(readyEv, "Missing ready event");
  assert.equal(readyEv.account_id, "acc-smoke-1");
  assert.equal(readyEv.dry_run, true);
  assert.equal(readyEv.baileys_exports_ok, true);

  const pingRes = parsed.find((x) => x.req_id === "1");
  assert.ok(pingRes && pingRes.ok === true && pingRes.data?.pong === true, `Bad ping reply: ${JSON.stringify(pingRes)}`);

  const statusRes = parsed.find((x) => x.req_id === "2");
  assert.ok(statusRes && statusRes.ok === true && statusRes.data?.status === "dry_run");

  const dryGuardRes = parsed.find((x) => x.req_id === "3");
  assert.ok(dryGuardRes && dryGuardRes.ok === false && /dry-run/i.test(dryGuardRes.error));

  const badJsonRes = parsed.find((x) => x.req_id === null && x.ok === false);
  assert.ok(badJsonRes && /Invalid JSON/i.test(badJsonRes.error));

  const shutdownRes = parsed.find((x) => x.req_id === "4");
  assert.ok(shutdownRes && shutdownRes.ok === true && shutdownRes.data?.shutting_down === true);
});

// 4. Message normalization across all rich message types + LID + Call + Revoke + Edit
await runCheck("4. Rich message normalization (all 14 types + LID alt + call/revoke/edit)", () => {
  const baseKey = {
    remoteJid: "123456789012345@lid",
    remoteJidAlt: "84901234567@s.whatsapp.net",
    id: "MSG_001",
    fromMe: false,
  };
  const resolvedChat = {
    canonical_jid: "84901234567@s.whatsapp.net",
    alt_jid: "123456789012345@lid",
    phone_number: "84901234567",
  };
  const ctx = { accountId: "acc-1", resolvedChat, resolvedSender: resolvedChat, senderName: "Nguyen Van A" };

  // Text + quote reply
  const rText = normalizeBaileysMessage(
    {
      key: baseKey,
      messageTimestamp: 1730000000,
      status: 3,
      message: {
        extendedTextMessage: {
          text: "Xin chao WhatsApp CRM!",
          contextInfo: { stanzaId: "PREV_1", quotedMessage: { conversation: "Tin cu" } },
        },
      },
    },
    ctx
  );
  assert.equal(rText.kind, "message");
  assert.equal(rText.payload.msg_type, "text");
  assert.equal(rText.payload.chat_jid, "84901234567@s.whatsapp.net");
  assert.equal(rText.payload.chat_alt_jid, "123456789012345@lid");
  assert.equal(rText.payload.sender_phone, "84901234567");
  assert.equal(rText.payload.reply_to_message_id, "PREV_1");
  assert.equal(rText.payload.quoted_text, "Tin cu");
  assert.equal(rText.payload.ack_status, "delivered");

  // Ephemeral + ViewOnce Image
  const rImg = normalizeBaileysMessage(
    {
      key: { ...baseKey, id: "MSG_IMG" },
      messageTimestamp: 1730000001,
      message: {
        ephemeralMessage: {
          message: {
            viewOnceMessageV2: {
              message: {
                imageMessage: { caption: "Anh bao gia", mimetype: "image/jpeg", fileLength: 102400, width: 800, height: 600 },
              },
            },
          },
        },
      },
    },
    ctx
  );
  assert.equal(rImg.payload.msg_type, "image");
  assert.equal(rImg.payload.text, "Anh bao gia");
  assert.equal(rImg.payload.metadata.view_once, true);

  // Voice PTT vs Audio
  const rVoice = normalizeBaileysMessage(
    {
      key: { ...baseKey, id: "MSG_PTT" },
      message: { audioMessage: { ptt: true, seconds: 14, mimetype: "audio/ogg; codecs=opus" } },
    },
    ctx
  );
  assert.equal(rVoice.payload.msg_type, "voice");
  assert.equal(rVoice.payload.media_duration_s, 14);

  const rAudio = normalizeBaileysMessage(
    {
      key: { ...baseKey, id: "MSG_AUD" },
      message: { audioMessage: { ptt: false, seconds: 120, mimetype: "audio/mpeg" } },
    },
    ctx
  );
  assert.equal(rAudio.payload.msg_type, "audio");

  // Video, Document, Sticker
  const rVid = normalizeBaileysMessage(
    { key: { ...baseKey, id: "MSG_VID" }, message: { videoMessage: { caption: "Demo", seconds: 9 } } },
    ctx
  );
  assert.equal(rVid.payload.msg_type, "video");

  const rDoc = normalizeBaileysMessage(
    {
      key: { ...baseKey, id: "MSG_DOC" },
      message: { documentMessage: { fileName: "hop_dong.pdf", mimetype: "application/pdf", fileLength: 55000 } },
    },
    ctx
  );
  assert.equal(rDoc.payload.msg_type, "document");
  assert.equal(rDoc.payload.media_filename, "hop_dong.pdf");

  const rStk = normalizeBaileysMessage(
    { key: { ...baseKey, id: "MSG_STK" }, message: { stickerMessage: { isAnimated: true } } },
    ctx
  );
  assert.equal(rStk.payload.msg_type, "sticker");
  assert.equal(rStk.payload.metadata.is_animated, true);

  // Contact vCard
  const vcard = "BEGIN:VCARD\nVERSION:3.0\nFN:Tran Minh\nORG:Markee AI;\nTEL;type=CELL;waid=84911223344:+84911223344\nEND:VCARD";
  assert.deepEqual(parseVCard(vcard), { display_name: "Tran Minh", phone: "84911223344", organization: "Markee AI" });
  const rContact = normalizeBaileysMessage(
    { key: { ...baseKey, id: "MSG_VCARD" }, message: { contactMessage: { displayName: "Tran Minh", vcard } } },
    ctx
  );
  assert.equal(rContact.payload.msg_type, "contact");
  assert.equal(rContact.payload.metadata.phone, "84911223344");

  // Location
  const rLoc = normalizeBaileysMessage(
    {
      key: { ...baseKey, id: "MSG_LOC" },
      message: { locationMessage: { degreesLatitude: 10.7769, degreesLongitude: 106.7009, name: "HCMC" } },
    },
    ctx
  );
  assert.equal(rLoc.payload.msg_type, "location");
  assert.equal(rLoc.payload.metadata.latitude, 10.7769);

  // Poll
  const rPoll = normalizeBaileysMessage(
    {
      key: { ...baseKey, id: "MSG_POLL" },
      message: {
        pollCreationMessageV3: {
          name: "Chon khung gio hop?",
          options: [{ optionName: "9h sang" }, { optionName: "14h chieu" }],
          selectableOptionsCount: 1,
        },
      },
    },
    ctx
  );
  assert.equal(rPoll.payload.msg_type, "poll");
  assert.deepEqual(rPoll.payload.metadata.options, ["9h sang", "14h chieu"]);

  // Reaction
  const rReact = normalizeBaileysMessage(
    {
      key: { ...baseKey, id: "MSG_REACT" },
      message: { reactionMessage: { key: baseKey, text: "👍" } },
    },
    ctx
  );
  assert.equal(rReact.kind, "reaction");
  assert.equal(rReact.payload.emoji, "👍");
  assert.equal(rReact.payload.message_id, "MSG_001");

  // Missed Call stub
  const rCall = normalizeBaileysMessage(
    { key: { ...baseKey, id: "MSG_CALL" }, messageStubType: 41 },
    ctx
  );
  assert.equal(rCall.payload.msg_type, "call_log");
  assert.equal(rCall.payload.metadata.is_video, true);

  // Protocol REVOKE & MESSAGE_EDIT
  const rRevoke = normalizeBaileysMessage(
    {
      key: { ...baseKey, id: "PROTO_1" },
      message: { protocolMessage: { type: 0, key: baseKey } },
    },
    ctx
  );
  assert.equal(rRevoke.kind, "message_update");
  assert.equal(rRevoke.payload.is_deleted, true);
  assert.equal(rRevoke.payload.message_id, "MSG_001");

  const rEdit = normalizeBaileysMessage(
    {
      key: { ...baseKey, id: "PROTO_2" },
      message: { protocolMessage: { type: 14, key: baseKey, editedMessage: { conversation: "Da sua lai" } } },
    },
    ctx
  );
  assert.equal(rEdit.kind, "message_update");
  assert.equal(rEdit.payload.is_edited, true);
  assert.equal(rEdit.payload.text, "Da sua lai");

  // Helpers
  assert.equal(formatPairingCode("abcd1234"), "ABCD-1234");
  assert.equal(mapAckStatus(4), "read");
  assert.equal(normalizeCallStatus("offer"), "offer");
  assert.equal(normalizeCallStatus("preaccept"), "ringing");
  assert.equal(normalizeCallStatus("relaylatency"), null);
});

// 5. Zero regression on Zalo CommonJS scripts & zca-js package
await runCheck("5. Zero regression on Zalo zca_api_bridge.js & CommonJS require('zca-js')", () => {
  const res1 = spawnSync(process.execPath, ["--check", zcaBridgePath], { encoding: "utf8" });
  assert.equal(res1.status, 0, `zca_api_bridge.js --check failed: ${res1.stderr}`);

  const res2 = spawnSync(process.execPath, ["--check", zcaListenerPath], { encoding: "utf8" });
  assert.equal(res2.status, 0, `zca_persistent_listener.js --check failed: ${res2.stderr}`);

  const requireCjs = createRequire(path.join(crawlerRoot, "package.json"));
  const zca = requireCjs("zca-js");
  assert.equal(typeof zca.Zalo, "function", "require('zca-js').Zalo must remain intact");
});

// 6. Dual-transport proxy parsing, masking & zero credential leak in --dry-run
await runCheck("6. Dual-transport proxy parsing, masking & zero WA_PROXY_URL leak", async () => {
  const empty = buildProxyTransports("");
  assert.equal(empty.enabled, false);
  assert.equal(empty.agent, undefined);
  assert.equal(empty.fetchAgent, undefined);
  assert.equal(empty.dispatcher, undefined);

  const httpT = buildProxyTransports("http://alice:s3cr3tPass@1.2.3.4:8080");
  assert.equal(httpT.enabled, true);
  assert.equal(httpT.protocol, "http:");
  assert.equal(httpT.maskedUrl, "http://***@1.2.3.4:8080");
  assert.ok(httpT.agent instanceof HttpsProxyAgent);
  assert.equal(httpT.fetchAgent, httpT.agent);
  assert.ok(httpT.dispatcher instanceof UndiciProxyAgent);
  await httpT.dispatcher.close();

  const socksT = buildProxyTransports("socks5://bob:topSecret@5.6.7.8:1080");
  assert.equal(socksT.enabled, true);
  assert.equal(socksT.protocol, "socks5:");
  assert.equal(socksT.maskedUrl, "socks5://***@5.6.7.8:1080");
  assert.ok(socksT.agent instanceof SocksProxyAgent);
  assert.equal(socksT.fetchAgent, socksT.agent);
  assert.equal(socksT.dispatcher, undefined);

  assert.equal(maskProxyUrl("http://10.20.30.40:3128"), "http://10.20.30.40:3128");
  assert.throws(() => buildProxyTransports("ftp://1.2.3.4:21"), /Unsupported WA_PROXY_URL/i);
  assert.throws(() => buildProxyTransports("not-a-url"), /Invalid WA_PROXY_URL/i);

  // Verify WA_PROXY_URL via env works in --dry-run and NEVER leaks password to stdout or stderr
  const child = spawn(
    process.execPath,
    [bridgePath, "--account-id", "acc-proxy-smoke", "--dry-run"],
    {
      cwd: crawlerRoot,
      env: { ...process.env, WA_PROXY_URL: "http://proxyuser:UltraSecret99@198.51.100.7:8080" },
      stdio: ["pipe", "pipe", "pipe"],
    }
  );
  let stdoutRaw = "";
  let stderrRaw = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (c) => (stdoutRaw += c));
  child.stderr.on("data", (c) => (stderrRaw += c));
  await new Promise((r) => setTimeout(r, 250));
  child.stdin.write(`${JSON.stringify({ req_id: "s1", cmd: "get_status" })}\n`);
  child.stdin.write(`${JSON.stringify({ req_id: "s2", cmd: "shutdown" })}\n`);
  child.stdin.end();
  const exitCode = await new Promise((resolve) => child.on("close", resolve));
  assert.equal(exitCode, 0, `Proxy dry-run failed: ${stderrRaw}`);
  assert.equal(stdoutRaw.includes("UltraSecret99"), false, "Raw proxy password leaked to stdout!");
  assert.equal(stderrRaw.includes("UltraSecret99"), false, "Raw proxy password leaked to stderr!");
  const lines = stdoutRaw.trim().split(/\r?\n/).map((l) => JSON.parse(l));
  const readyEv = lines.find((x) => x.event === "ready");
  assert.equal(readyEv?.has_proxy, true);
  assert.equal(readyEv?.proxy_masked, "http://***@198.51.100.7:8080");
  const statusRes = lines.find((x) => x.req_id === "s1");
  assert.equal(statusRes?.data?.proxy_masked, "http://***@198.51.100.7:8080");
});

// 7. Atomic creds write & dirty unregistered creds.me wipe preserving .bridge.lock
await runCheck("7. Atomic creds write & dirty creds.me wipe preserving .bridge.lock", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wa-atomic-smoke-"));
  try {
    const credsPath = path.join(tmpDir, "creds.json");
    const sampleCreds = {
      registered: false,
      me: { id: "84901234567@s.whatsapp.net", name: "~" },
      noiseKey: { public: Buffer.from([10, 20, 30, 40]) },
    };
    await writeJsonAtomic(credsPath, sampleCreds);
    const remainingTmp = fs.readdirSync(tmpDir).filter((f) => f.endsWith(".tmp"));
    assert.equal(remainingTmp.length, 0, "Atomic write must not leave .tmp files");

    const parsed = JSON.parse(fs.readFileSync(credsPath, "utf8"), BufferJSON.reviver);
    assert.equal(parsed.me.id, "84901234567@s.whatsapp.net");
    assert.ok(Buffer.isBuffer(parsed.noiseKey.public));
    assert.deepEqual(Array.from(parsed.noiseKey.public), [10, 20, 30, 40]);

    // Dirty unregistered creds.me + session file + .bridge.lock
    fs.writeFileSync(path.join(tmpDir, "pre-key-1.json"), "{}", "utf8");
    fs.writeFileSync(path.join(tmpDir, ".bridge.lock"), JSON.stringify({ pid: process.pid }), "utf8");
    const wiped = cleanDirtyUnregisteredAuthDir(tmpDir);
    assert.equal(wiped, true);
    assert.equal(fs.existsSync(credsPath), false, "Dirty creds.json must be wiped");
    assert.equal(fs.existsSync(path.join(tmpDir, "pre-key-1.json")), false, "Stale key files must be wiped");
    assert.equal(fs.existsSync(path.join(tmpDir, ".bridge.lock")), true, ".bridge.lock must be preserved");

    // Registered creds.json must NEVER be wiped
    await writeJsonAtomic(credsPath, { registered: true, me: { id: "84901234567@s.whatsapp.net" } });
    assert.equal(cleanDirtyUnregisteredAuthDir(tmpDir), false);
    assert.equal(fs.existsSync(credsPath), true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// 8. Pairing phone normalization (VN 0xx -> 84xx, strip 00 / + / spaces)
await runCheck("8. Pairing phone normalization (VN 0xx -> 84xx & strip 00/+/spaces)", () => {
  assert.equal(normalizePairingPhone("0901234567"), "84901234567");
  assert.equal(normalizePairingPhone("0901 234 567"), "84901234567");
  assert.equal(normalizePairingPhone("+84 901-234-567"), "84901234567");
  assert.equal(normalizePairingPhone("0084 901 234 567"), "84901234567");
  assert.equal(normalizePairingPhone("001 (415) 555-2671"), "14155552671");
  assert.equal(normalizePairingPhone("+1 415 555 2671"), "14155552671");
  assert.equal(normalizePairingPhone("84901234567"), "84901234567");
});

// 9. QR expiry cap (max 2 cycles) & fatal disconnect stop (401/403/405/411/440/515)
await runCheck("9. QR expiry cap (max 2 cycles) & fatal disconnect classification", () => {
  assert.equal(MAX_UNSCANNED_AUTH_CYCLES, 2);

  // Cycle 1 unscanned 408 -> reconnect once
  const c1 = classifyDisconnectDecision({
    statusCode: 408,
    errMessage: "QR refs attempts ended",
    isRegistered: false,
    authArtifactEmitted: true,
    unscannedAuthCycles: 0,
  });
  assert.equal(c1.willReconnect, true);
  assert.equal(c1.nextUnscannedCycles, 1);

  // Cycle 2 unscanned 408 -> qr_expired & STOP reconnecting
  const c2 = classifyDisconnectDecision({
    statusCode: 408,
    errMessage: "QR refs attempts ended",
    isRegistered: false,
    authArtifactEmitted: true,
    unscannedAuthCycles: c1.nextUnscannedCycles,
  });
  assert.equal(c2.status, "qr_expired");
  assert.equal(c2.willReconnect, false);
  assert.equal(c2.error, "Mã QR đã hết hạn — bấm Làm mới QR để tạo mã mới.");

  // Fatal codes must STOP infinite retry loop
  const d401 = classifyDisconnectDecision({ statusCode: 401, isRegistered: true });
  assert.equal(d401.status, "logged_out");
  assert.equal(d401.willReconnect, false);

  for (const code of [403, 405, 411, 440]) {
    const d = classifyDisconnectDecision({ statusCode: code, isRegistered: false });
    assert.equal(d.status, "error", `Code ${code} must emit status=error`);
    assert.equal(d.willReconnect, false, `Code ${code} must stop reconnecting`);
    if (code === 403 || code === 405) {
      assert.match(d.error, /Proxy/i, `Code ${code} must hint Sticky Proxy`);
    }
  }

  // 515 restartRequired -> reconnect immediately
  const d515 = classifyDisconnectDecision({ statusCode: 515, isRegistered: false, pairSuccessReceived: true });
  assert.equal(d515.willReconnect, true);
  assert.equal(d515.isRestartRequired, true);
});

// 10. Advisory lockfile (.bridge.lock): recovers stale PID, blocks live PID conflict
await runCheck("10. Advisory .bridge.lock recovers stale PID & blocks live PID", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wa-lock-smoke-"));
  try {
    const lockFile = path.join(tmpDir, ".bridge.lock");
    // 1) Stale lock from dead PID -> auto-recovered
    fs.writeFileSync(lockFile, JSON.stringify({ pid: 999999, account_id: "old" }), "utf8");
    const acquired = acquireBridgeLock(tmpDir, "acc-lock-1");
    assert.equal(acquired, lockFile);
    const lockData = JSON.parse(fs.readFileSync(lockFile, "utf8"));
    assert.equal(lockData.pid, process.pid);
    releaseBridgeLock(acquired);
    assert.equal(fs.existsSync(lockFile), false);

    // 2) Live lock from parent PID -> blocks duplicate spawn to prevent 440
    if (process.ppid && process.ppid !== process.pid) {
      fs.writeFileSync(lockFile, JSON.stringify({ pid: process.ppid, account_id: "live" }), "utf8");
      assert.throws(() => acquireBridgeLock(tmpDir, "acc-lock-1"), /440|đang chạy/i);
      // releaseBridgeLock must NOT remove another live PID's lock
      releaseBridgeLock(lockFile);
      assert.equal(fs.existsSync(lockFile), true);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

const failed = results.filter((r) => r.status === "FAIL");
console.log(`\nSummary: ${results.length - failed.length}/${results.length} PASS`);
if (failed.length > 0) {
  process.exit(1);
}
