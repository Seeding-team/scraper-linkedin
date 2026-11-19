"use strict";

/**
 * ZRTC Media Worker (Hướng A - Server-Side Native ZRTC Bridge)
 * Chạy trên máy chủ/VPS Windows (nơi có Zalo PC zcall_ia32.node + node-gyp/Electron ABI 110),
 * kết nối outbound tới Seeding Backend (/api/all-platform/zalo/conversations/zrtc-worker-ws)
 * để xử lý ZRTC (newZrtc=1, DTLS-SRTP/ICE, Relay :4200) thay cho trình duyệt của Sale.
 *
 * Sale chỉ cần mở web Seeding (không cần cài/đăng nhập Zalo).
 */

const path = require("path");
const WebSocket = require("ws");

const WORKER_WS_URL =
  process.env.ZRTC_WORKER_WS_URL ||
  "wss://seeding.markeeai.com/api/all-platform/zalo/conversations/zrtc-worker-ws";
const WORKER_TOKEN = process.env.ZRTC_WORKER_TOKEN || "";
const WORKER_ID = process.env.ZRTC_WORKER_ID || `zrtc_win_${process.pid}`;
const ZALO_ZCALL_DIR =
  process.env.ZALO_ZCALL_DIR ||
  path.join(
    process.env.LOCALAPPDATA || "",
    "Programs",
    "Zalo",
    "Zalo-26.11.12",
    "resources",
    "app.asar.unpacked",
    "native",
    "nativelibs",
    "zcall",
  );

let zcall = null;
try {
  zcall = require(path.join(ZALO_ZCALL_DIR, "index.js"));
  console.log("[ZRTC-WORKER] Loaded native zcall from", ZALO_ZCALL_DIR);
} catch (err) {
  console.warn(
    "[ZRTC-WORKER] Could not load native zcall directly in this Node runtime:",
    err && err.message ? err.message : err,
  );
  console.warn(
    "[ZRTC-WORKER] Ensure this runs under Electron/Node ABI 110 (win32-ia32) with node.dll available.",
  );
}

const activeCalls = new Map();
let ws = null;
let eventTimer = null;

function sendJson(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

function connect() {
  const url = new URL(WORKER_WS_URL);
  url.searchParams.set("worker_id", WORKER_ID);
  if (WORKER_TOKEN) url.searchParams.set("token", WORKER_TOKEN);

  console.log("[ZRTC-WORKER] Connecting to", url.origin + url.pathname);
  ws = new WebSocket(url.toString());
  ws.binaryType = "nodebuffer";

  ws.on("open", () => {
    console.log("[ZRTC-WORKER] Connected as", WORKER_ID);
    if (eventTimer) clearInterval(eventTimer);
    eventTimer = setInterval(() => {
      if (zcall && typeof zcall.checkEventMessage === "function") {
        try {
          zcall.checkEventMessage();
        } catch (_) {}
      }
      sendJson({ type: "ping", ts: Date.now() });
    }, 5000);
  });

  ws.on("message", async (raw, isBinary) => {
    if (isBinary) {
      // Khung audio PCM16 từ trình duyệt Sale: "ZPCM" + [len] + session_id + pcm16
      const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      if (buf.length >= 6 && buf.subarray(0, 4).toString("ascii") === "ZPCM") {
        const sidLen = buf[4];
        const sid = buf.subarray(5, 5 + sidLen).toString("utf8");
        const pcm = buf.subarray(5 + sidLen);
        const call = activeCalls.get(sid);
        if (call && call.onBrowserAudio) {
          call.onBrowserAudio(pcm);
        }
      }
      return;
    }

    let msg = null;
    try {
      msg = JSON.parse(raw.toString("utf8"));
    } catch (_) {
      return;
    }
    const type = String(msg.type || "").toLowerCase();

    if (type === "start_call") {
      const { req_id, session_id, call_id, call_type, s1_data } = msg;
      try {
        if (!zcall) {
          throw new Error("Native zcall addon not loaded in worker");
        }
        const cfg = {
          ...(s1_data || {}),
          callId: Number(s1_data?.id || s1_data?.callId || call_id),
          protocol: Number(s1_data?.protocol || 3),
        };
        await zcall.makeCall(cfg, Number(call_type || 1) === 2);
        const extendData = typeof zcall.getExtendData === "function" ? zcall.getExtendData() : "";
        activeCalls.set(session_id, { session_id, call_id: cfg.callId });
        sendJson({
          type: "rpc_result",
          req_id,
          ok: true,
          extend_data: typeof extendData === "string" ? extendData : JSON.stringify(extendData || {}),
        });
      } catch (err) {
        sendJson({
          type: "rpc_result",
          req_id,
          ok: false,
          error: err && err.message ? err.message : String(err),
        });
      }
    } else if (type === "update_caller_info") {
      const { codec, extend_data } = msg;
      if (zcall && typeof zcall.updateCallerInfo === "function") {
        try {
          zcall.updateCallerInfo(codec || "", extend_data || "");
        } catch (err) {
          console.warn("[ZRTC-WORKER] updateCallerInfo error:", err && err.message);
        }
      }
    } else if (type === "end_call") {
      const { session_id } = msg;
      activeCalls.delete(session_id);
      if (zcall && typeof zcall.stop === "function") {
        try {
          zcall.stop();
        } catch (_) {}
      }
    }
  });

  ws.on("close", () => {
    if (eventTimer) clearInterval(eventTimer);
    console.warn("[ZRTC-WORKER] Disconnected, reconnecting in 3s...");
    setTimeout(connect, 3000);
  });

  ws.on("error", (err) => {
    console.warn("[ZRTC-WORKER] WS error:", err && err.message ? err.message : err);
  });
}

connect();
