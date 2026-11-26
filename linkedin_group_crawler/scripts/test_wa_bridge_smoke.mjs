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
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Boom } from "@hapi/boom";
import pino from "pino";
import QRCode from "qrcode";
import makeWASocket, {
  Browsers,
  DEFAULT_CONNECTION_CONFIG,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  isLidUser,
  isPnUser,
  proto,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";

import {
  formatPairingCode,
  mapAckStatus,
  normalizeBaileysMessage,
  normalizeCallStatus,
  parseVCard,
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

// 2. Baileys v7 ESM exports + supporting libs
await runCheck("2. Baileys v7 ESM exports + qrcode/pino/@hapi/boom", async () => {
  assert.equal(typeof makeWASocket, "function", "makeWASocket must be a function");
  assert.equal(typeof useMultiFileAuthState, "function", "useMultiFileAuthState must be a function");
  assert.equal(typeof downloadMediaMessage, "function", "downloadMediaMessage must be a function");
  assert.equal(typeof fetchLatestBaileysVersion, "function", "fetchLatestBaileysVersion must be a function");
  assert.equal(typeof DisconnectReason, "object", "DisconnectReason must be an object");
  assert.equal(DisconnectReason.loggedOut, 401);
  assert.equal(DisconnectReason.restartRequired, 515);
  assert.equal(typeof Browsers.ubuntu, "function");
  assert.equal(typeof isPnUser, "function");
  assert.equal(typeof isLidUser, "function");
  assert.equal(Array.isArray(DEFAULT_CONNECTION_CONFIG.version), true);
  assert.equal(proto.Message.ProtocolMessage.Type.REVOKE, 0);
  assert.equal(proto.Message.ProtocolMessage.Type.MESSAGE_EDIT, 14);

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

const failed = results.filter((r) => r.status === "FAIL");
console.log(`\nSummary: ${results.length - failed.length}/${results.length} PASS`);
if (failed.length > 0) {
  process.exit(1);
}
