"use strict";

/**
 * ZCA Voice Call Engine (Hướng 3 - Direct Zalo VoIP Signaling 11300..11311 & Transport Crypto)
 * Được trích xuất chính xác từ hợp đồng giao thức gốc trong app.asar của Zalo:
 *   - 11300 (401): /api/voicecall/requestcall
 *   - 11301 (416): /api/voicecall/request
 *   - 11302 (407): /api/voicecall/ringring
 *   - 11303 (402): /api/voicecall/answer
 *   - 11304 (408): /api/voicecall/answerack
 *   - 11305 (405): /api/voicecall/cancel
 *   - 11306 (409): /api/voicecall/endcall
 *   - 11311 (406): /api/voicecall/logendcall
 */

const crypto = require("crypto");
const dgram = require("dgram");

const CALL_V2_TRANSPORT_AES_KEY = "yjAF9oqMWl6XfXYJn9mA7w==";
const CALL_V2_ZERO_IV = Buffer.from("0".repeat(32), "hex");

/**
 * Zalo Native CallController::ctor (0x008ede19) & matchAudioCodec (0x008e9bec)
 * bắt buộc kiểm tra khớp tên codec "opus/16000/1" VÀ payload == 112 (0x70).
 */
const DEFAULT_VOIP_CODECS = JSON.stringify([
  {
    dynamicFptime: 0,
    frmPtime: 20,
    name: "opus/16000/1",
    payload: 112,
  },
]);

function buildDefaultZrtcExtendData({ callType = 1, p2pList = [], serverAddrList = [] } = {}) {
  return JSON.stringify({
    callType: Number(callType) === 2 || Number(callType) === 3 ? 1 : 0,
    fecTP: 0,
    gccAudio: 0,
    gccEarlyCall: 0,
    gccMode: 0,
    gccSVLR: 0,
    newZrtc: 1,
    p2p: Array.isArray(p2pList) ? p2pList : [],
    packetMode: 2,
    platform: 2,
    sP2P: 0,
    serverAddr: Array.isArray(serverAddrList) ? serverAddrList : [],
    spTcp: 1,
    srtcp: 0,
    srtpMode: 0,
    supportCallBusy: 1,
    supportHevcDecode: 1,
    tpType: 0,
  });
}

/**
 * Đóng gói gói tin nhị phân ZrtcPacket InitZRTP (msgType=1, magic=0x7E, cmd=11 cho Caller / 12 cho Callee)
 * Trích xuất chính xác từ ZrtcPacket::buildInitZRTP (0x00894cc7) & ZrtcPacket::serialize (0x00893a2c).
 */
function buildZrtcInitZrtpPacket({
  callId,
  fromId,
  toId,
  sessId,
  isCaller = true,
  subCmd = 1,
}) {
  const sessStr = String(sessId || `${callId}_0_401`);
  const sessBytes = Buffer.from(sessStr, "utf8");
  const buf = Buffer.alloc(31 + sessBytes.length);
  const cmd = isCaller ? 11 : 12;

  // 21-byte ZrtcPacket Header (<BBIIIIHB)
  buf.writeUInt8(1, 0); // msgType = 1
  buf.writeUInt8(0x7e, 1); // magic = 0x7E ('~')
  buf.writeUInt32LE(0, 2); // field_08 = 0
  buf.writeUInt32LE(0, 6); // field_0C = 0
  buf.writeUInt32LE((Number(fromId) || 0) >>> 0, 10); // field_10 = userId (32-bit internal fromId)
  buf.writeUInt32LE(0, 14); // field_14 = token (0 when requesting InitZRTP)
  buf.writeUInt16LE(cmd & 0xffff, 18); // field_18 = cmd (11=Caller, 12=Callee)
  buf.writeUInt8((Number(subCmd) || 1) & 0xff, 20); // field_1A = subCmd (1=RTP, 2=RTCP)

  // Body (<IIH + sessBytes)
  buf.writeUInt32LE((Number(callId) || 0) >>> 0, 21); // field_34 = callId
  buf.writeUInt32LE((Number(toId) || 0) >>> 0, 25); // field_38 = partnerId (32-bit internal toId)
  buf.writeUInt16LE(sessBytes.length & 0xffff, 29); // uint16_le len(sessId)
  sessBytes.copy(buf, 31);
  return buf;
}

/**
 * Đóng gói gói tin nhị phân ZrtcPacket Echo / Keepalive (msgType=1, magic=0x7E, cmd=3)
 * Trích xuất từ ZrtcPacket::buildEcho (0x00894b8e).
 */
function buildZrtcEchoPacket({ callId, fromId, token = 0, seq = 1 }) {
  const buf = Buffer.alloc(25);
  buf.writeUInt8(1, 0); // msgType = 1
  buf.writeUInt8(0x7e, 1); // magic = 0x7E
  buf.writeUInt32LE(0, 2);
  buf.writeUInt32LE(0, 6);
  buf.writeUInt32LE((Number(fromId) || 0) >>> 0, 10);
  buf.writeUInt32LE((Number(token) || Number(fromId) || 0) >>> 0, 14);
  buf.writeUInt16LE(3, 18); // cmd = 3 (Echo)
  buf.writeUInt8((Number(seq) || 1) & 0xff, 20);
  buf.writeUInt32LE((Number(callId) || 0) >>> 0, 21);
  return buf;
}

/**
 * Bọc 5-byte ZRTC Media Header (msgType=3 cho Audio RTP, msgType=5 cho Audio RTCP + uint32_le token).
 * Xác thực trực tiếp từ gói UDP live của ZaloCall.exe:
 *   - 03 <tok_4B_LE> 80 70 ... -> Audio RTP (PT=112, opus/16000/1)
 *   - 05 <tok_4B_LE> 80 c8 ... -> Audio RTCP (SR/SDES)
 */
function wrapZrtcAudioRtpPacket(rtpBuf, token = 0, isRtcp = false) {
  const hdr = Buffer.alloc(5);
  hdr.writeUInt8(isRtcp ? 5 : 3, 0);
  hdr.writeUInt32LE((Number(token) || 0) >>> 0, 1);
  return Buffer.concat([hdr, rtpBuf]);
}

/**
 * Giải mã gói tin ZrtcPacket phản hồi từ Media Relay Server (:4200)
 * Trích xuất từ ZrtcPacket::deserialize (0x00893fe3).
 */
function parseZrtcPacket(buf) {
  if (!buf || buf.length < 5) return null;
  const msgType = buf.readUInt8(0);
  if ((msgType === 1 || msgType === 2) && buf.length >= 25 && buf.readUInt8(1) === 0x7e) {
    const userId = buf.readUInt32LE(10);
    const headerToken = buf.readUInt32LE(14);
    const cmd = buf.readUInt16LE(18);
    const subCmd = buf.readUInt8(20);
    const res = buf.readInt32LE(21);
    let callId = 0;
    let token = headerToken;
    let publicAddr = "";
    if (msgType === 2 && (cmd === 11 || cmd === 12) && res === 0 && buf.length >= 35) {
      callId = buf.readUInt32LE(25);
      token = buf.readUInt32LE(29);
      const addrLen = buf.readUInt16LE(33);
      if (addrLen > 0 && buf.length >= 35 + addrLen) {
        publicAddr = buf.subarray(35, 35 + addrLen).toString("utf8");
      }
    }
    return {
      msgType,
      userId,
      cmd,
      subCmd,
      res,
      callId,
      token,
      publicAddr,
    };
  }
  if ((msgType === 5 || msgType === 3) && buf.length >= 17) {
    return {
      msgType,
      token: buf.readUInt32LE(1),
      rtpPayload: buf.subarray(5),
    };
  }
  return null;
}

/**
 * Thực hiện bắt tay UDP ZrtcPacket InitZRTP tới Media Relay (:4200) ngay sau 11300
 * để kích hoạt phiên thoại trên Relay trước khi gửi 11301 tới máy khách.
 */
async function performUdpInitZrtpHandshake(s1Data, { callId, timeoutMs = 600 } = {}) {
  if (!s1Data || typeof s1Data !== "object") {
    return { ok: false, token: 0, res: -1 };
  }
  const effectiveCallId = Number(s1Data.id || s1Data.callId || callId || 0) >>> 0;
  const fromId = Number(s1Data.fromId || 0) >>> 0;
  const toId = Number(s1Data.toId || 0) >>> 0;
  const sessId = String(s1Data.sessId || s1Data.session || `${effectiveCallId}_0_401`);
  if (!effectiveCallId || !fromId) {
    return { ok: false, token: 0, res: -2, fromId, toId, sessId };
  }

  const targets = [];
  const addTarget = (rawAddr) => {
    if (!rawAddr || typeof rawAddr !== "string" || !rawAddr.includes(":")) return;
    const [host, portStr] = rawAddr.split(":");
    const port = Number(portStr || 4200);
    if (host && port > 0 && !targets.some((t) => t.host === host && t.port === port)) {
      targets.push({ host, port });
    }
  };
  addTarget(s1Data.rtpIP || s1Data.rtpAddress);
  addTarget(s1Data.rtcpIP || s1Data.rtcpAddress);
  if (Array.isArray(s1Data.servers)) {
    for (const srv of s1Data.servers) {
      if (srv && typeof srv === "object") {
        addTarget(srv.rtpaddr || srv.rtp);
        addTarget(srv.rtcpaddr || srv.rtcp);
      }
    }
  }
  if (targets.length === 0) {
    addTarget("171.244.25.121:4200");
  }

  const pktSub1 = buildZrtcInitZrtpPacket({
    callId: effectiveCallId,
    fromId,
    toId,
    sessId,
    isCaller: true,
    subCmd: 1,
  });
  const pktSub2 = buildZrtcInitZrtpPacket({
    callId: effectiveCallId,
    fromId,
    toId,
    sessId,
    isCaller: true,
    subCmd: 2,
  });

  return new Promise((resolve) => {
    const sock = dgram.createSocket("udp4");
    let settled = false;
    let bestResult = { ok: false, token: 0, res: null, publicAddr: "", fromId, toId, sessId };

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        sock.close();
      } catch (_) {}
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish(bestResult);
    }, Math.max(150, Number(timeoutMs || 600)));

    sock.on("error", () => {
      finish(bestResult);
    });

    sock.on("message", (msg) => {
      const parsed = parseZrtcPacket(msg);
      if (parsed && parsed.msgType === 2 && (parsed.cmd === 11 || parsed.cmd === 12)) {
        bestResult = {
          ok: parsed.res === 0,
          token: parsed.token || 0,
          res: parsed.res,
          publicAddr: parsed.publicAddr || "",
          fromId,
          toId,
          sessId,
        };
        if (parsed.res === 0) {
          finish(bestResult);
        }
      }
    });

    sock.bind(0, () => {
      for (const t of targets) {
        try {
          sock.send(pktSub1, t.port, t.host);
          sock.send(pktSub2, t.port, t.host);
        } catch (_) {}
      }
    });
  });
}

function encryptZCallTransportFrame(arg1, arg2 = CALL_V2_TRANSPORT_AES_KEY) {
  let headerPrefix = "";
  let payloadObj = arg1;
  let keyBase64 = arg2;
  if (typeof arg1 === "string" && arg2 && typeof arg2 === "object") {
    headerPrefix = `${arg1}$`;
    payloadObj = arg2;
    keyBase64 = CALL_V2_TRANSPORT_AES_KEY;
  }
  const jsonText = typeof payloadObj === "string" ? payloadObj : JSON.stringify(payloadObj);
  const cipher = crypto.createCipheriv(
    "aes-128-cbc",
    Buffer.from(String(keyBase64 || CALL_V2_TRANSPORT_AES_KEY), "base64"),
    CALL_V2_ZERO_IV,
  );
  const encrypted = Buffer.concat([cipher.update(jsonText, "utf8"), cipher.final()]);
  return `${headerPrefix}${encrypted.toString("hex")}$`;
}

function decryptZCallTransportFrame(hexFrame, keyBase64 = CALL_V2_TRANSPORT_AES_KEY) {
  const raw = String(hexFrame || "").trim();
  if (!raw) return null;
  const parts = raw.split("$").filter(Boolean);
  const hasHeader = parts.length >= 2 && parts[0].length <= 8;
  const header = hasHeader ? parts[0] : null;
  const cleanHex = hasHeader ? parts[1] : parts[0];
  if (!cleanHex) return null;
  const decipher = crypto.createDecipheriv(
    "aes-128-cbc",
    Buffer.from(String(keyBase64 || CALL_V2_TRANSPORT_AES_KEY), "base64"),
    CALL_V2_ZERO_IV,
  );
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(cleanHex, "hex")),
    decipher.final(),
  ]);
  const text = decrypted.toString("utf8").replace(/\0/g, "");
  const parsed = JSON.parse(text);
  return hasHeader ? { header, payload: parsed } : parsed;
}

function generateZaloCallId() {
  const sec = Math.floor(Date.now() / 1000) & 0x3fffffff;
  const rand = Math.floor(Math.random() * 1000) & 0x3ff;
  return ((sec << 4) ^ rand) & 0x7fffffff || Math.floor(Date.now() / 1000);
}

function ensureVoiceCallBridge(api) {
  if (!api) throw new Error("Missing zca-js api instance");
  if (typeof api.__zcallExec === "function") {
    return api.__zcallExec;
  }
  if (typeof api.custom === "function") {
    api.custom("__zcallExec", async ({ ctx, utils, props }) => {
      const { endpointPath, paramsObj } = props || {};
      const voiceDomainList =
        (api.zpwServiceMap && (api.zpwServiceMap.voice_call || api.zpwServiceMap.voicecall)) || [];
      const baseDomain = String(
        voiceDomainList[0] || "https://voicecall-wpa.chat.zalo.me",
      ).replace(/\/+$/, "");

      const payloadWithImei = {
        ...paramsObj,
        ...(paramsObj && paramsObj.imei === undefined ? { imei: ctx.imei } : {}),
      };
      const encryptedParams = utils.encodeAES(JSON.stringify(payloadWithImei));
      if (!encryptedParams) {
        throw new Error("Failed to encrypt voicecall params with zpw_enk");
      }
      const url = utils.makeURL(`${baseDomain}${endpointPath}`, {
        params: encryptedParams,
      });
      const response = await utils.request(url, { method: "GET" });
      return utils.resolve(response);
    });
    return api.__zcallExec;
  }
  throw new Error("zca-js api.custom is not available on this instance");
}

async function callZaloVoiceEndpoint(api, endpointPath, paramsObj) {
  const exec = ensureVoiceCallBridge(api);
  return exec({ endpointPath, paramsObj });
}

// 11300 (Signal 401): Khởi tạo phiên gọi
async function zcallRequestCall(api, { calleeId, callId, codec = DEFAULT_VOIP_CODECS, typeRequest = 1 }) {
  const resolvedCallId = Number(callId || generateZaloCallId());
  const resolvedCodec =
    codec != null && String(codec).trim() !== "" && String(codec).trim() !== "[]"
      ? typeof codec === "string"
        ? codec
        : JSON.stringify(codec)
      : DEFAULT_VOIP_CODECS;
  const data = await callZaloVoiceEndpoint(api, "/api/voicecall/requestcall", {
    calleeId: String(calleeId),
    callId: resolvedCallId,
    codec: resolvedCodec,
    typeRequest: Number(typeRequest || 1),
  });
  return { callId: resolvedCallId, data };
}

// 11301 (Signal 416): Gửi thông số RTP/RTCP làm đổ chuông máy khách hàng
async function zcallSendRequestCall(
  api,
  {
    calleeId,
    rtcpAddress = "",
    rtpAddress = "",
    codec = DEFAULT_VOIP_CODECS,
    extendData = "",
    session,
    callId,
  },
) {
  const resolvedCallId = Number(callId || generateZaloCallId());
  const resolvedCodec =
    codec != null && String(codec).trim() !== "" && String(codec).trim() !== "[]"
      ? typeof codec === "string"
        ? codec
        : JSON.stringify(codec)
      : DEFAULT_VOIP_CODECS;
  const payload = {
    calleeId: String(calleeId),
    rtcpAddress: String(rtcpAddress || rtpAddress || ""),
    rtpAddress: String(rtpAddress || ""),
    codec: resolvedCodec,
    session: session != null ? session : resolvedCallId,
    callId: resolvedCallId,
  };
  if (extendData) {
    payload.extendData = String(extendData);
    payload.subCommand = 3;
  }
  const data = await callZaloVoiceEndpoint(api, "/api/voicecall/request", payload);
  return { callId: resolvedCallId, data };
}

// 11302 (Signal 407): Báo máy đang đổ chuông (RingRing)
async function zcallSendRingRing(api, { callerId, callId }) {
  return callZaloVoiceEndpoint(api, "/api/voicecall/ringring", {
    callerId: String(callerId),
    callId: Number(callId),
    status: 0,
  });
}

// 11303 (Signal 402): Trả lời cuộc gọi
async function zcallSendAnswerCall(
  api,
  {
    callerId,
    callId,
    status = 0,
    codec = DEFAULT_VOIP_CODECS,
    extendData = "",
    rtcpAddress = "",
    rtpAddress = "",
    session,
  },
) {
  const payload = {
    callerId: String(callerId),
    callId: Number(callId),
    status: Number(status || 0),
    codec: typeof codec === "string" ? codec : JSON.stringify(codec || []),
    rtcpAddress: String(rtcpAddress || rtpAddress || ""),
    rtpAddress: String(rtpAddress || ""),
    session_id: Number(session || callId || 0),
  };
  if (extendData) {
    payload.extendData = String(extendData);
    payload.subCommand = 3;
  }
  return callZaloVoiceEndpoint(api, "/api/voicecall/answer", payload);
}

// 11304 (Signal 408): Xác nhận ACK đã nghe máy
async function zcallSendAnswerAck(api, { calleeId, callId }) {
  return callZaloVoiceEndpoint(api, "/api/voicecall/answerack", {
    calleeId: String(calleeId),
    callId: Number(callId),
    status: 0,
  });
}

// 11305 (Signal 405): Hủy cuộc gọi khi đang đổ chuông
async function zcallSendCancelCall(api, { toId, callerId, callId, callType = 1 }) {
  return callZaloVoiceEndpoint(api, "/api/voicecall/cancel", {
    callerId: String(callerId || toId),
    callId: Number(callId),
    callType: Number(callType || 1),
    status: 0,
  });
}

// 11306 (Signal 409): Kết thúc cuộc gọi đang đàm thoại
async function zcallSendEndCall(api, { uidTo, callId, status = 3 }) {
  return callZaloVoiceEndpoint(api, "/api/voicecall/endcall", {
    uidTo: String(uidTo),
    callId: Number(callId),
    status: Number(status ?? 3),
  });
}

// 11311 (Signal 406): Ghi log kết thúc cuộc gọi lên hệ thống Zalo
async function zcallSendLogEndCall(
  api,
  { callId, partnerId, status = 3, logdata = "{}", duration = 0, role = 1 },
) {
  return callZaloVoiceEndpoint(api, "/api/voicecall/logendcall", {
    call_id: Number(callId),
    partner_id: String(partnerId),
    status: Number(status ?? 3),
    logdata: typeof logdata === "string" ? logdata : JSON.stringify(logdata || {}),
    duration: Math.max(0, Math.round(Number(duration || 0))),
    role: Number(role ?? 1),
  });
}

/**
 * Thực thi luồng gọi 2 pha (11300 requestcall -> 11301 request) trực tiếp từ zca-js:
 * - Nếu chưa có calleeId mà có phone, tự động gọi api.findUser(phone) để lấy Zalo UID.
 */
async function startDirectZaloCall(
  api,
  {
    calleeId,
    phone,
    phoneNumber,
    callId,
    callType = 1,
    rtpAddress = "",
    rtcpAddress = "",
    codec = DEFAULT_VOIP_CODECS,
    extendData = "",
    skipUdpInitZrtp = false,
  },
) {
  let targetUid = String(calleeId || "").trim();
  let resolvedProfile = null;
  const rawPhone = phone || phoneNumber;

  if ((!targetUid || targetUid.length < 5) && rawPhone) {
    const cleanPhone = String(rawPhone).replace(/\D/g, "");
    if (cleanPhone.length >= 9 && typeof api.findUser === "function") {
      const found = await api.findUser(cleanPhone);
      if (found && found.uid) {
        targetUid = String(found.uid).trim();
        resolvedProfile = {
          uid: targetUid,
          display_name: found.display_name || found.zalo_name || cleanPhone,
          avatar: found.avatar || null,
        };
      }
    }
  }

  if (!targetUid) {
    throw new Error("Không tìm thấy Zalo UID của khách hàng để khởi tạo cuộc gọi.");
  }

  const resolvedCodec =
    codec != null && String(codec).trim() !== "" && String(codec).trim() !== "[]"
      ? typeof codec === "string"
        ? codec
        : JSON.stringify(codec)
      : DEFAULT_VOIP_CODECS;

  const finalCallId = Number(callId || generateZaloCallId());
  let step1 = null;
  try {
    step1 = await zcallRequestCall(api, {
      calleeId: targetUid,
      callId: finalCallId,
      codec: resolvedCodec,
      typeRequest: Number(callType || 1),
    });
  } catch (err) {
    const errMsg = err && err.message ? err.message : String(err);
    return {
      ok: true,
      call_ok: false,
      call_id: finalCallId,
      callee_id: targetUid,
      status: "failed",
      request_warning: `Lỗi khởi tạo cuộc gọi Zalo (11300): ${errMsg}`,
    };
  }

  const s1Data = (step1 && step1.data) || {};
  const effectiveCallId = Number(s1Data.id || s1Data.callId || s1Data.call_id || finalCallId);
  const serverSession =
    s1Data.sessId || s1Data.session || s1Data.session_id || s1Data.sessionId || effectiveCallId;
  const relayRtp =
    s1Data.rtpIP ||
    s1Data.rtpAddress ||
    s1Data.rtp_address ||
    s1Data.relayAddress ||
    "171.244.25.121:4200";
  const relayRtcp =
    s1Data.rtcpIP || s1Data.rtcpAddress || s1Data.rtcp_address || relayRtp;
  const hasValidStunRtp =
    rtpAddress &&
    !String(rtpAddress).startsWith("127.0.0.1") &&
    !String(rtpAddress).startsWith("0.0.0.0");

  // Trong giao thức Zalo Call (xác thực từ gói answer/request thật):
  // - rtpAddress & rtcpAddress của 11301 là địa chỉ Relay Server (:4200)
  // - Địa chỉ STUN public của caller nằm trong extendData.p2p (type: 1)
  // - extendData chứa serverAddr, newZrtc=1, packetMode=2, platform=1, gcc*... kèm subCommand=3
  const serverAddrList = (
    Array.isArray(s1Data.servers) && s1Data.servers.length > 0
      ? s1Data.servers
      : [{ rtpaddr: relayRtp, rtcpaddr: relayRtcp, bonus: 0.0 }]
  ).map((srv) => ({
    rtcp: String(srv.rtcpaddr || srv.rtcp || relayRtcp),
    ...(srv.rtcpIPv6 ? { rtcpIPv6: String(srv.rtcpIPv6) } : {}),
    rtp: String(srv.rtpaddr || srv.rtp || relayRtp),
    ...(srv.rtpIPv6 ? { rtpIPv6: String(srv.rtpIPv6) } : {}),
    tpType: Number(srv.tpType ?? 0),
  }));

  const p2pList = [];
  if (hasValidStunRtp) {
    const rtpStr = String(rtpAddress);
    const lastColon = rtpStr.lastIndexOf(":");
    if (lastColon > 0) {
      const stunIp = rtpStr.slice(0, lastColon);
      const stunPort = Number(rtpStr.slice(lastColon + 1));
      if (stunIp && stunPort > 0) {
        p2pList.push({ ip: stunIp, port: stunPort, type: 0 });
      }
    }
  }

  // Luôn đính kèm extendData chuẩn ZRTC của ZaloCall.exe (newZrtc=1, sP2P=0, srtpMode=0, packetMode=2, serverAddr)
  // kèm subCommand=3 ở 11301 để máy khách đàm phán codec/ZRTP thành công, không văng status=5 callee_init_zrtp_fail.
  const resolvedExtendData =
    extendData && String(extendData).trim() !== ""
      ? String(extendData)
      : buildDefaultZrtcExtendData({ callType, p2pList, serverAddrList });

  const serverRtp = relayRtp;
  const serverRtcp = relayRtcp;

  // Nếu Step 1 bị từ chối (ví dụ status: 7: Chặn cuộc gọi từ người lạ / không muốn nhận cuộc gọi),
  // KHÔNG gọi tiếp Step 2 (11301) vì máy chủ Zalo sẽ ném lỗi "Tham số không hợp lệ".
  const isRejectedOrBusy = s1Data.status !== undefined && Number(s1Data.status) !== 0;

  let zrtcInitResult = null;
  let step2 = null;
  let step2Error = null;
  if (!isRejectedOrBusy) {
    if (!skipUdpInitZrtp) {
      try {
        zrtcInitResult = await performUdpInitZrtpHandshake(s1Data, {
          callId: effectiveCallId,
          timeoutMs: 600,
        });
      } catch (_) {}
    }

    try {
      step2 = await zcallSendRequestCall(api, {
        calleeId: targetUid,
        rtcpAddress: serverRtcp,
        rtpAddress: serverRtp,
        codec: resolvedCodec,
        extendData: resolvedExtendData,
        session: serverSession,
        callId: effectiveCallId,
      });
    } catch (err) {
      step2Error = err && err.message ? err.message : String(err);
    }
  } else {
    step2Error = s1Data.msg || "Cuộc gọi bị từ chối do cài đặt quyền riêng tư của đối phương (chặn người lạ) hoặc đang bận.";
  }

  return {
    ok: true,
    call_ok: !isRejectedOrBusy,
    call_id: effectiveCallId,
    callee_id: targetUid,
    from_id: Number(s1Data.fromId || 0) >>> 0,
    to_id: Number(s1Data.toId || 0) >>> 0,
    zrtc_token: zrtcInitResult && zrtcInitResult.token ? zrtcInitResult.token : 0,
    zrtc_init: zrtcInitResult,
    session: serverSession,
    call_type: Number(callType || 1),
    status: isRejectedOrBusy ? (Number(s1Data.status) === 7 ? "privacy_blocked" : "rejected") : "ringing",
    profile: resolvedProfile,
    rtp_address: relayRtp,
    rtcp_address: s1Data.rtcpIP || relayRtp,
    local_rtp_address: serverRtp,
    relay_servers: Array.isArray(s1Data.servers) ? s1Data.servers : [],
    requestcall_result: s1Data,
    request_result: step2 ? step2.data : null,
    request_warning: step2Error,
  };
}

module.exports = {
  CALL_V2_TRANSPORT_AES_KEY,
  DEFAULT_VOIP_CODECS,
  buildDefaultZrtcExtendData,
  buildZrtcInitZrtpPacket,
  buildZrtcEchoPacket,
  wrapZrtcAudioRtpPacket,
  parseZrtcPacket,
  performUdpInitZrtpHandshake,
  encryptZCallTransportFrame,
  decryptZCallTransportFrame,
  generateZaloCallId,
  zcallRequestCall,
  zcallSendRequestCall,
  zcallSendRingRing,
  zcallSendAnswerCall,
  zcallSendAnswerAck,
  zcallSendCancelCall,
  zcallSendEndCall,
  zcallSendLogEndCall,
  startDirectZaloCall,
};
