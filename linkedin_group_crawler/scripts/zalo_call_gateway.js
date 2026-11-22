"use strict";

/**
 * Zalo Call Gateway (Unified Node.js VoIP Media & Signaling Engine)
 * Xử lý trọn gói cuộc gọi thoại Zalo thuần JavaScript / Node.js:
 *   1. Khởi tạo signaling (11300 requestcall -> 11301 request) gắn liền với phiên Zalo.
 *   2. Đóng gói & gửi Handshake Frame mã hóa AES (CALL_V2_AES_KEY) tới Relay :4200.
 *   3. Chuẩn hóa RTP Opus (PT=113, sampleRate=48000, 20ms=960 samples, Opus silence TOC).
 *   4. Phản hồi 11304 (answerack) ngay trong 0ms khi nhận sự kiện answer từ WebSocket.
 *   5. Kênh WebSocket audio 2 chiều phục vụ trực tiếp trình duyệt của Sale.
 */

const dgram = require("dgram");
const crypto = require("crypto");
const http = require("http");
const { WebSocketServer } = require("ws");
const {
  CALL_V2_TRANSPORT_AES_KEY,
  buildZrtcInitZrtpPacket,
  buildZrtcEchoPacket,
  wrapZrtcAudioRtpPacket,
  parseZrtcPacket,
  encryptZCallTransportFrame,
  decryptZCallTransportFrame,
  startDirectZaloCall,
  zcallSendAnswerAck,
  zcallSendCancelCall,
  zcallSendEndCall,
  zcallSendLogEndCall,
  DEFAULT_VOIP_CODECS,
} = require("./zca_call_engine");

// Chuẩn Opus ZRTC Native của Zalo (opus/16000/1, PT=112, 20ms=320 samples)
const OPUS_PAYLOAD_TYPE = 112;
const OPUS_TIMESTAMP_STEP = 320; // 16000 * 0.02
const OPUS_SILENCE_FRAME = Buffer.from([0xf8, 0xff, 0xfe]);

/**
 * Đóng gói gói tin RTP 12-byte chuẩn RFC 3550
 */
function buildRtpPacket(payload, { seq, timestamp, ssrc, payloadType = OPUS_PAYLOAD_TYPE, marker = false }) {
  const header = Buffer.alloc(12);
  header[0] = 0x80; // V=2, P=0, X=0, CC=0
  header[1] = (marker ? 0x80 : 0x00) | (payloadType & 0x7f);
  header.writeUInt16BE(seq & 0xffff, 2);
  header.writeUInt32BE(timestamp >>> 0, 4);
  header.writeUInt32BE(ssrc >>> 0, 8);
  return Buffer.concat([header, payload]);
}

/**
 * Bóc tách gói tin RTP từ Relay
 */
function parseRtpPacket(buf) {
  if (!buf || buf.length < 12) return null;
  const b0 = buf[0];
  const b1 = buf[1];
  const version = (b0 >> 6) & 0x03;
  if (version !== 2) return null;
  const cc = b0 & 0x0f;
  const extension = Boolean((b0 >> 4) & 0x01);
  const payloadType = b1 & 0x7f;
  const seq = buf.readUInt16BE(2);
  const timestamp = buf.readUInt32BE(4);
  const ssrc = buf.readUInt32BE(8);

  let offset = 12 + cc * 4;
  if (buf.length < offset) return null;
  if (extension) {
    if (buf.length < offset + 4) return null;
    const extLenWords = buf.readUInt16BE(offset + 2);
    offset += 4 + extLenWords * 4;
    if (buf.length < offset) return null;
  }

  let end = buf.length;
  if (b0 & 0x20) {
    const padding = buf[end - 1];
    if (!padding || padding > end - offset) return null;
    end -= padding;
  }
  return {
    version,
    payloadType,
    seq,
    timestamp,
    ssrc,
    payload: buf.subarray(offset, end),
  };
}

class ZaloCallGatewaySession {
  constructor({ sessionId, accountId, callId, calleeId, phone, callType = 1, api }) {
    this.sessionId = sessionId;
    this.accountId = accountId;
    this.callId = Number(callId);
    this.calleeId = String(calleeId);
    this.phone = phone;
    this.callType = Number(callType);
    this.api = api;

    this.status = "initializing"; // initializing -> dialing -> ringing -> connected -> ended / cancelled / rejected
    this.startedAt = Date.now();
    this.connectedAt = null;
    this.endedAt = null;
    this.warning = null;

    // UDP & Relay state
    this.udpSocket = null;
    this.remoteRelay = null; // { host, port }
    this.p2pTarget = null; // { host, port }
    this.relayServers = [];
    this.sessId = null;
    this.fromId = 0;
    this.toId = 0;
    this.zrtcToken = 0;
    this.echoSeq = 0;

    // RTP state
    this.seq = Math.floor(Math.random() * 1000);
    this.timestamp = Math.floor(Math.random() * 100000);
    this.ssrc = Math.floor(Math.random() * 0x7fffffff) + 100000;
    this.packetsSent = 0;
    this.packetsReceived = 0;

    this.keepaliveTimer = null;
    this.wsClients = new Set();
  }

  get durationSec() {
    if (!this.connectedAt) return 0;
    const end = this.endedAt || Date.now();
    return Math.max(0, Math.round((end - this.connectedAt) / 1000));
  }

  toDict() {
    return {
      session_id: this.sessionId,
      account_id: this.accountId,
      call_id: this.callId,
      callee_id: this.calleeId,
      phone_number: this.phone || "",
      call_type: this.callType,
      status: this.status,
      codec: "opus/16000/1 (PT 112)",
      zrtc_token: this.zrtcToken || 0,
      duration_sec: this.durationSec,
      packets_sent: this.packetsSent,
      packets_received: this.packetsReceived,
      relay_host: this.remoteRelay?.host || null,
      relay_port: this.remoteRelay?.port || null,
      warning: this.warning,
      started_at: this.startedAt,
      connected_at: this.connectedAt,
      ended_at: this.endedAt,
    };
  }

  broadcastJson(obj) {
    const text = JSON.stringify(obj);
    for (const ws of this.wsClients) {
      if (ws.readyState === 1) {
        try {
          ws.send(text);
        } catch (_) {}
      }
    }
  }

  broadcastAudio(buf) {
    for (const ws of this.wsClients) {
      if (ws.readyState === 1) {
        try {
          ws.send(buf, { binary: true });
        } catch (_) {}
      }
    }
  }

  /**
   * Khởi tạo UDP Socket và gửi gói bắt tay nhị phân ZrtcPacket InitZRTP tới Relay :4200
   */
  async initUdpRelay(s1Data, initialToken = 0) {
    this.udpSocket = dgram.createSocket("udp4");

    const relayAddr = s1Data.rtpIP || s1Data.rtpAddress || "171.244.25.90:4200";
    const [host, portStr] = relayAddr.split(":");
    this.remoteRelay = { host, port: Number(portStr || 4200) };
    this.sessId = s1Data.sessId || s1Data.session || String(this.callId);
    this.fromId = Number(s1Data.fromId || this.fromId || 0) >>> 0;
    this.toId = Number(s1Data.toId || this.toId || 0) >>> 0;
    if (initialToken) {
      this.zrtcToken = Number(initialToken) >>> 0;
    }

    if (Array.isArray(s1Data.servers)) {
      this.relayServers = s1Data.servers
        .map((s) => {
          const raw = s.rtpaddr || s.rtcpaddr;
          if (!raw) return null;
          const [h, p] = raw.split(":");
          return { host: h, port: Number(p || 4200) };
        })
        .filter(Boolean);
    }

    this.udpSocket.on("message", (msg, rinfo) => {
      if (!["dialing", "ringing", "connected"].includes(this.status)) return;
      const sources = [this.remoteRelay, this.p2pTarget, ...this.relayServers].filter(Boolean);
      if (!sources.some((s) => s.host === rinfo.address && s.port === rinfo.port)) return;

      // Kiểm tra gói tin ZrtcPacket (msgType=2 phản hồi InitZRTP/Echo hoặc msgType=5 Audio RTP)
      const zrtc = parseZrtcPacket(msg);
      if (zrtc && zrtc.msgType === 2) {
        if ((zrtc.cmd === 11 || zrtc.cmd === 12) && zrtc.res === 0 && zrtc.token) {
          this.zrtcToken = zrtc.token >>> 0;
        }
        return;
      }

      const rtpBuf = zrtc && zrtc.msgType === 5 && zrtc.rtpPayload ? zrtc.rtpPayload : msg;
      const parsed = parseRtpPacket(rtpBuf);
      if (
        !parsed ||
        (parsed.payloadType !== 112 && parsed.payloadType !== 113) ||
        !parsed.payload.length ||
        parsed.ssrc === this.ssrc
      ) {
        return;
      }
      this.packetsReceived += 1;
      if (this.status === "ringing") {
        this.status = "connected";
        this.connectedAt = this.connectedAt || Date.now();
        // Nhận được audio packet thực từ khách -> gửi ngay 11304 answerack
        zcallSendAnswerAck(this.api, {
          calleeId: this.calleeId,
          callId: this.callId,
        }).catch(() => {});
        this.broadcastJson({ type: "call_state", session: this.toDict() });
      }

      if (parsed && parsed.payload && parsed.payload.length > 0) {
        this.broadcastAudio(parsed.payload);
      }
    });

    this.udpSocket.on("error", (err) => {
      console.warn(`[CALL-GATEWAY] UDP socket error for session=${this.sessionId}:`, err.message);
    });

    await new Promise((resolve) => {
      this.udpSocket.bind(0, () => resolve(true));
    });

    // Gửi ZrtcPacket InitZRTP (cmd=11, subCmd=1 & 2) tới Relay :4200
    this.sendHandshakeFrame();

    // Bắt đầu nhịp keep-alive định kỳ 1s
    this.keepaliveTimer = setInterval(() => {
      this.sendKeepaliveTick();
    }, 1000);
  }

  sendHandshakeFrame() {
    if (!this.udpSocket || !this.remoteRelay) return;
    try {
      const pktSub1 = buildZrtcInitZrtpPacket({
        callId: this.callId,
        fromId: this.fromId,
        toId: this.toId,
        sessId: this.sessId,
        isCaller: true,
        subCmd: 1,
      });
      const pktSub2 = buildZrtcInitZrtpPacket({
        callId: this.callId,
        fromId: this.fromId,
        toId: this.toId,
        sessId: this.sessId,
        isCaller: true,
        subCmd: 2,
      });
      this.udpSocket.send(pktSub1, this.remoteRelay.port, this.remoteRelay.host);
      this.udpSocket.send(pktSub2, this.remoteRelay.port, this.remoteRelay.host);
      for (const srv of this.relayServers.slice(0, 2)) {
        this.udpSocket.send(pktSub1, srv.port, srv.host);
        this.udpSocket.send(pktSub2, srv.port, srv.host);
      }
    } catch (err) {
      console.warn(`[CALL-GATEWAY] Handshake frame error:`, err.message);
    }
  }

  sendKeepaliveTick() {
    if (!this.udpSocket || !this.remoteRelay || this.status === "ended") return;
    if (!this.zrtcToken) {
      this.sendHandshakeFrame();
    } else {
      this.echoSeq = (this.echoSeq + 1) & 0xff;
      const echoPkt = buildZrtcEchoPacket({
        callId: this.callId,
        fromId: this.fromId,
        token: this.zrtcToken,
        seq: this.echoSeq,
      });
      this.udpSocket.send(echoPkt, this.remoteRelay.port, this.remoteRelay.host);
    }

    this.seq = (this.seq + 1) & 0xffff;
    this.timestamp = (this.timestamp + OPUS_TIMESTAMP_STEP) >>> 0;
    this.packetsSent += 1;

    // Gói tin Opus silence TOC chuẩn (PT=112) bọc 5-byte ZRTC Header khi gửi qua Relay
    const rawRtp = buildRtpPacket(OPUS_SILENCE_FRAME, {
      seq: this.seq,
      timestamp: this.timestamp,
      ssrc: this.ssrc,
      payloadType: OPUS_PAYLOAD_TYPE,
    });
    const zrtcRtp = wrapZrtcAudioRtpPacket(rawRtp, this.zrtcToken || this.fromId);

    this.udpSocket.send(zrtcRtp, this.remoteRelay.port, this.remoteRelay.host);
    if (this.p2pTarget) {
      this.udpSocket.send(rawRtp, this.p2pTarget.port, this.p2pTarget.host);
    }
  }

  /**
   * Nhận audio từ trình duyệt Sale, đóng gói RTP PT=112 + 5-byte ZRTC header và đẩy qua Relay
   */
  sendAudioFromBrowser(audioBuffer) {
    if (!this.udpSocket || !this.remoteRelay || !audioBuffer || audioBuffer.length === 0) return;
    this.seq = (this.seq + 1) & 0xffff;
    this.timestamp = (this.timestamp + OPUS_TIMESTAMP_STEP) >>> 0;
    this.packetsSent += 1;

    const rawRtp = buildRtpPacket(audioBuffer, {
      seq: this.seq,
      timestamp: this.timestamp,
      ssrc: this.ssrc,
      payloadType: OPUS_PAYLOAD_TYPE,
    });
    const zrtcRtp = wrapZrtcAudioRtpPacket(rawRtp, this.zrtcToken || this.fromId);

    this.udpSocket.send(zrtcRtp, this.remoteRelay.port, this.remoteRelay.host);
    if (this.p2pTarget) {
      this.udpSocket.send(rawRtp, this.p2pTarget.port, this.p2pTarget.host);
    }
  }

  /**
   * Xử lý gói đàm phán sớm P2P / SDP Offer từ Callee khi máy khách bắt đầu đổ chuông (act: answer, status: 5)
   * Tuyệt đối KHÔNG chuyển sang connected và KHÔNG gửi 11304 answerack sớm gây drop cuộc gọi!
   */
  handleEarlyNegotiation(data, params = {}) {
    try {
      const p = typeof data.params === "string" ? JSON.parse(data.params) : data.params || params || {};
      const ext = typeof p.extendData === "string" ? JSON.parse(p.extendData) : p.extendData || {};
      if (Array.isArray(ext.p2p) && ext.p2p.length > 0) {
        const bestP2p = ext.p2p[0];
        if (bestP2p.ip && bestP2p.port) {
          this.p2pTarget = { host: String(bestP2p.ip), port: Number(bestP2p.port) };
        }
      }
      if (p.rtpSerIp && typeof p.rtpSerIp === "string") {
        const [h, portStr] = p.rtpSerIp.split(":");
        if (h && portStr) {
          this.remoteRelay = { host: h, port: Number(portStr) };
        }
      }
    } catch (_) {}

    if (this.status !== "connected") this.status = "ringing";
    // TUYỆT ĐỐI KHÔNG bắn gói tin 49$ hay RTP tới p2pTarget trong giai đoạn đổ chuông sớm!
    // Gói tin không phải STUN Binding Request gửi tới candidate P2P của điện thoại khách sẽ làm vỡ state machine ICE.
    this.broadcastJson({ type: "call_state", session: this.toDict() });
  }

  /**
   * Xử lý khi khách hàng bắt máy (act: answer)
   */
  async handleAnswerEvent(data) {
    if (!["dialing", "ringing"].includes(this.status)) return;
    if (this.connectedAt === null) {
      this.connectedAt = Date.now();
    }
    this.status = "connected";

    // Phân tích candidate P2P nếu có
    try {
      const params = typeof data.params === "string" ? JSON.parse(data.params) : data.params || {};
      const ext = typeof params.extendData === "string" ? JSON.parse(params.extendData) : params.extendData || {};
      if (Array.isArray(ext.p2p) && ext.p2p.length > 0) {
        const bestP2p = ext.p2p[0];
        if (bestP2p.ip && bestP2p.port) {
          this.p2pTarget = { host: String(bestP2p.ip), port: Number(bestP2p.port) };
        }
      }
    } catch (_) {}

    // Gửi ngay 11304 (answerack) trong 0ms
    try {
      await zcallSendAnswerAck(this.api, {
        calleeId: this.calleeId,
        callId: this.callId,
      });
    } catch (err) {
      console.warn(`[CALL-GATEWAY] AnswerAck error:`, err.message);
    }

    // Bắn burst 30 gói để kích hoạt luồng media 2 chiều tức thời
    for (let i = 0; i < 30; i++) {
      this.sendKeepaliveTick();
    }

    this.broadcastJson({ type: "call_state", session: this.toDict() });
  }

  close() {
    this.status = "ended";
    this.endedAt = this.endedAt || Date.now();
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
    if (this.udpSocket) {
      try {
        this.udpSocket.close();
      } catch (_) {}
      this.udpSocket = null;
    }
    this.broadcastJson({ type: "call_state", session: this.toDict() });
  }
}

// Registry các cuộc gọi đang mở trong Node.js (hỗ trợ tra cứu đa chiều)
const sessions = new Map(); // sessionId -> session
const sessionsByCallId = new Map(); // callId (string) -> session
const sessionsByCalleeId = new Map(); // calleeId (string) -> session

function registerGatewaySession(session) {
  if (!session) return;
  if (session.sessionId) sessions.set(session.sessionId, session);
  if (session.callId) sessionsByCallId.set(String(session.callId), session);
  if (session.calleeId) sessionsByCalleeId.set(String(session.calleeId), session);
}

function unregisterGatewaySession(session) {
  if (!session) return;
  if (session.sessionId) sessions.delete(session.sessionId);
  if (session.callId) sessionsByCallId.delete(String(session.callId));
  if (session.calleeId) sessionsByCalleeId.delete(String(session.calleeId));
}

function findGatewaySession({ sessionId, callId, calleeId } = {}) {
  if (sessionId && sessions.has(sessionId)) return sessions.get(sessionId);
  if (callId && sessionsByCallId.has(String(callId))) return sessionsByCallId.get(String(callId));
  if (calleeId && sessionsByCalleeId.has(String(calleeId))) return sessionsByCalleeId.get(String(calleeId));
  return null;
}

function getCallSession(sessionId) {
  return findGatewaySession({ sessionId });
}

/**
 * Xử lý sự kiện VoIP trực tiếp từ Zalo WebSocket (act: answer, ring_ring, busy, cancel, endcall)
 */
function handleVoipEvent(voipEvent) {
  if (!voipEvent) return null;
  const act = (voipEvent.act || "").toLowerCase();
  const data = voipEvent.data || {};
  let params = data.params;
  if (typeof params === "string") {
    try { params = JSON.parse(params); } catch (_) {}
  }
  params = params || {};
  const callId = data.callId || params.callId || (data.id ? data.id : null);
  const calleeId = data.calleeId || data.fromId || data.toId || params.calleeId;

  let session = callId ? sessionsByCallId.get(String(callId)) : findGatewaySession({ calleeId });
  if (!session && !callId && !calleeId) {
    const active = [...sessions.values()].filter(s => ["dialing", "ringing", "connected"].includes(s.status));
    if (active.length === 1) session = active[0];
  }
  if (!session) return null;
  if (!["dialing", "ringing", "connected"].includes(session.status)) return session;

  const rawStatus = String(data.status ?? params.status ?? "").trim();
  if (act === "answer") {
    if (rawStatus === "5") {
      // Theo ZCallInfoSignal::receiveAnswer (0x007ec17f), status=5 là callee_init_zrtp_fail
      // (thiết bị khách thất bại khởi tạo ZRTP/codec và đã tự ngắt cuộc gọi).
      session.warning = "Thiết bị khách không thể khởi tạo kênh thoại ZRTC (callee_init_zrtp_fail - status 5).";
      session.status = "failed";
      session.close();
    } else if (rawStatus === "3") {
      session.status = "rejected";
      session.close();
    } else if (rawStatus === "1") {
      session.status = "busy";
      session.close();
    } else if (rawStatus === "0" || rawStatus === "") {
      // Khách hàng thực sự bấm nghe máy (status 0 hoặc accept)
      session.handleAnswerEvent(data);
    }
  } else if (act === "accept") {
    session.handleAnswerEvent(data);
  } else if (act === "ring_ring") {
    if (session.status !== "connected") session.status = "ringing";
    session.broadcastJson({ type: "call_state", session: session.toDict() });
  } else if (["cancel", "endcall", "end_call", "reject", "busy"].includes(act)) {
    session.status = act === "endcall" || act === "end_call" ? "ended" : act;
    session.close();
  }
  return session;
}

/**
 * Điều khiển cuộc gọi Gateway (cancel, end, answer_ack)
 */
async function performGatewayCallAction(api, payload = {}) {
  const { sessionId, callId, action, calleeId } = payload;
  const session = findGatewaySession({ sessionId, callId, calleeId });
  if (!session) {
    return { ok: false, error: `Không tìm thấy phiên gọi Gateway: ${sessionId || callId}` };
  }
  const act = (action || "").toLowerCase();
  if (act === "cancel") {
    session.status = "cancelled";
    session.close();
    try {
      await zcallSendCancelCall(api, {
        calleeId: session.calleeId,
        callId: session.callId,
        callType: session.callType,
      });
    } catch (_) {}
    return { ok: true, session: session.toDict() };
  } else if (["end", "hangup"].includes(act)) {
    session.status = "ended";
    const dur = session.durationSec;
    session.close();
    try {
      await zcallSendEndCall(api, {
        uidTo: session.calleeId,
        callId: session.callId,
        duration: dur,
        status: 3,
        role: 1,
      });
    } catch (_) {}
    return { ok: true, session: session.toDict() };
  } else if (["mark_connected", "answer_ack", "answer"].includes(act)) {
    await session.handleAnswerEvent({ calleeId: session.calleeId, callId: session.callId });
    return { ok: true, session: session.toDict() };
  }
  return { ok: true, session: session.toDict() };
}

function getGatewayCallStatus(payload = {}) {
  const session = findGatewaySession(payload);
  if (!session) return { ok: false, error: "Session not found" };
  return { ok: true, session: session.toDict() };
}

function sendGatewayCallAudio(payload = {}) {
  const session = findGatewaySession(payload);
  if (!session) return { ok: false, error: "Session not found" };
  const { audio_base64 } = payload;
  if (audio_base64) {
    session.sendAudioFromBrowser(Buffer.from(audio_base64, "base64"));
  }
  return { ok: true };
}

/**
 * Khởi tạo cuộc gọi mới qua Unified Gateway
 */
async function initiateGatewayCall(api, { accountId, calleeId, phone, callType = 1 }) {
  const sessionId = `zcall_gw_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const callId = (Math.floor(Date.now() / 1000) & 0x3fffffff) ^ Math.floor(Math.random() * 1000);

  const session = new ZaloCallGatewaySession({
    sessionId,
    accountId,
    callId,
    calleeId,
    phone,
    callType,
    api,
  });

  registerGatewaySession(session);

  try {
    session.status = "dialing";
    const sigRes = await startDirectZaloCall(api, {
      calleeId,
      phone,
      callId,
      callType,
      codec: DEFAULT_VOIP_CODECS,
    });

    if (!sigRes.ok || !sigRes.call_ok) {
      session.status = sigRes.status || "failed";
      session.warning = sigRes.request_warning || "Không thể khởi tạo cuộc gọi Zalo";
      session.close();
      return { ok: false, session: session.toDict(), error: session.warning };
    }

    // Cập nhật lại callId và calleeId thực tế từ Zalo nếu có
    if (sigRes.call_id) {
      session.callId = Number(sigRes.call_id);
      sessionsByCallId.set(String(session.callId), session);
    }
    if (sigRes.callee_id) {
      session.calleeId = String(sigRes.callee_id);
      sessionsByCalleeId.set(String(session.calleeId), session);
    }

    session.status = "ringing";
    const s1Data = sigRes.requestcall_result || {};
    await session.initUdpRelay(s1Data, sigRes.zrtc_token || 0);

    return { ok: true, session: session.toDict() };
  } catch (err) {
    session.status = "failed";
    session.warning = err.message;
    session.close();
    return { ok: false, session: session.toDict(), error: err.message };
  }
}

module.exports = {
  OPUS_PAYLOAD_TYPE,
  OPUS_TIMESTAMP_STEP,
  OPUS_SILENCE_FRAME,
  buildRtpPacket,
  parseRtpPacket,
  ZaloCallGatewaySession,
  getCallSession,
  findGatewaySession,
  registerGatewaySession,
  unregisterGatewaySession,
  handleVoipEvent,
  performGatewayCallAction,
  getGatewayCallStatus,
  sendGatewayCallAudio,
  initiateGatewayCall,
  sessions,
  sessionsByCallId,
  sessionsByCalleeId,
};
