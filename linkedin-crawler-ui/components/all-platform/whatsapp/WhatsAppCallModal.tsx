"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ExternalLink,
  Loader2,
  Mic,
  MicOff,
  Phone,
  PhoneCall,
  PhoneIncoming,
  PhoneOff,
  Radio,
  Send,
  Settings2,
  ShieldCheck,
  Smartphone,
  Video,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { whatsappService } from "@/services/whatsapp.service";
import type { WhatsAppAccount, WhatsAppSseCallEventPayload } from "@/types/whatsapp";
import {
  formatDurationSeconds,
  formatPhoneDisplay,
  normalizeWaPhoneDigits,
  WhatsAppAvatar,
} from "./whatsapp-ui";

export interface ActiveWhatsAppCallSession {
  direction: "inbound" | "outbound";
  accountId: string;
  callId: string;
  chatJid: string;
  callerJid?: string;
  peerName: string;
  peerPhone: string;
  peerAvatar?: string | null;
  isVideo: boolean;
  callMode: "baileys_signal" | "cloud_webrtc" | "linked_device_handoff" | string;
  sdpOffer?: string | null;
  sdpAnswer?: string | null;
  remoteStatus?: string | null;
}

export interface WhatsAppCallModalProps {
  session: ActiveWhatsAppCallSession;
  account: WhatsAppAccount | null;
  lastCallEvent?: WhatsAppSseCallEventPayload | null;
  onClose: () => void;
  onOpenCloudSettings: () => void;
  onCallLogged?: () => void;
}

type LocalCallPhase =
  | "idle"
  | "ringing_in"
  | "dialing_webrtc"
  | "ringing_out"
  | "connecting_webrtc"
  | "connected"
  | "handoff_ready"
  | "ended"
  | "rejected"
  | "missed"
  | "failed";

const QUICK_REJECT_REPLIES = [
  "Hiện mình đang bận, bạn để lại tin nhắn mình phản hồi ngay nhé!",
  "Mình đang họp, lát nữa mình gọi lại ngay ạ.",
  "Vui lòng nhắn tin nội dung cần hỗ trợ giúp mình nhé!",
];

function waitForIceGathering(pc: RTCPeerConnection, timeoutMs = 1500): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      pc.removeEventListener("icegatheringstatechange", onState);
      resolve();
    };
    const onState = () => {
      if (pc.iceGatheringState === "complete") finish();
    };
    pc.addEventListener("icegatheringstatechange", onState);
    window.setTimeout(finish, timeoutMs);
  });
}

function isTerminalCallStatus(st?: string | null): boolean {
  if (!st) return false;
  return ["ended", "terminate", "rejected", "reject", "missed", "timeout", "failed"].includes(
    st.toLowerCase(),
  );
}

export function WhatsAppCallModal({
  session,
  account,
  lastCallEvent,
  onClose,
  onOpenCloudSettings,
  onCallLogged,
}: WhatsAppCallModalProps) {
  const cloudCapable = Boolean(account?.cloud_calling_enabled);
  const hasIncomingSdpOffer = Boolean(session.sdpOffer?.trim());

  const [phase, setPhase] = useState<LocalCallPhase>(() => {
    if (session.direction === "inbound") return "ringing_in";
    return cloudCapable ? "idle" : "handoff_ready";
  });
  const [activeCallId, setActiveCallId] = useState<string>(session.callId);
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const [waDeepLink, setWaDeepLink] = useState<string>(() => {
    const digits = normalizeWaPhoneDigits(session.peerPhone);
    return digits ? `whatsapp://send?phone=${digits}` : "whatsapp://";
  });
  const [waWebLink, setWaWebLink] = useState<string>(() => {
    const digits = normalizeWaPhoneDigits(session.peerPhone);
    return digits ? `https://wa.me/${digits}` : "https://web.whatsapp.com";
  });
  const [isMuted, setIsMuted] = useState(false);
  const [ringtoneMuted, setRingtoneMuted] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [showRejectReply, setShowRejectReply] = useState(false);
  const [rejectReplyText, setRejectReplyText] = useState(
    account?.auto_reject_message || QUICK_REJECT_REPLIES[0],
  );
  const [busyAction, setBusyAction] = useState(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const appliedAnswerRef = useRef<string | null>(null);
  const handoffLoggedRef = useRef(false);

  // Derive terminal remote status cleanly (zero sync setState in effect)
  const remoteEventMatches =
    lastCallEvent &&
    lastCallEvent.account_id === session.accountId &&
    (lastCallEvent.call_id === activeCallId || lastCallEvent.call_id === session.callId)
      ? lastCallEvent
      : null;

  const remoteStatus = remoteEventMatches?.status || session.remoteStatus || null;
  const remoteSdpAnswer =
    remoteEventMatches?.sdp_answer ||
    remoteEventMatches?.call_answer_sdp ||
    session.sdpAnswer ||
    null;

  const effectivePhase: LocalCallPhase = (() => {
    if (
      phase === "ended" ||
      phase === "rejected" ||
      phase === "failed" ||
      phase === "handoff_ready"
    ) {
      return phase;
    }
    if (
      remoteEventMatches?.sub_event === "linked_device_handoff" ||
      remoteEventMatches?.call_mode === "linked_device_handoff"
    ) {
      return "handoff_ready";
    }
    if (remoteStatus) {
      const s = remoteStatus.toLowerCase();
      if (s === "rejected" || s === "reject") return "rejected";
      if (s === "missed" || s === "timeout") return "missed";
      if (s === "ended" || s === "terminate") return "ended";
      if (s === "failed") return "failed";
    }
    return phase;
  })();

  const cleanupMedia = useCallback(() => {
    if (pcRef.current) {
      try {
        pcRef.current.close();
      } catch {
        // ignore
      }
      pcRef.current = null;
    }
    if (localStreamRef.current) {
      for (const track of localStreamRef.current.getTracks()) {
        try {
          track.stop();
        } catch {
          // ignore
        }
      }
      localStreamRef.current = null;
    }
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
    }
  }, []);

  // Cleanup WebRTC & mic on unmount or when call becomes terminal
  useEffect(() => {
    if (isTerminalCallStatus(effectivePhase)) {
      cleanupMedia();
    }
  }, [effectivePhase, cleanupMedia]);

  useEffect(() => {
    return () => {
      cleanupMedia();
    };
  }, [cleanupMedia]);

  // Gentle synthesized WebAudio ringtone while inbound ringing
  useEffect(() => {
    if (effectivePhase !== "ringing_in" || ringtoneMuted) return;
    if (typeof window === "undefined") return;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    let ctx: AudioContext | null = null;
    try {
      ctx = new AudioCtx();
    } catch {
      return;
    }

    const playChime = () => {
      if (!ctx || ctx.state === "closed") return;
      if (ctx.state === "suspended") {
        void ctx.resume().catch(() => {});
      }
      const now = ctx.currentTime;
      const playTone = (freq: number, startOffset: number, dur: number) => {
        if (!ctx) return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, now + startOffset);
        gain.gain.setValueAtTime(0.001, now + startOffset);
        gain.gain.exponentialRampToValueAtTime(0.08, now + startOffset + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.001, now + startOffset + dur);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + startOffset);
        osc.stop(now + startOffset + dur + 0.02);
      };
      // Pleasant dual-tone WhatsApp-like ring pattern
      playTone(587.33, 0, 0.24);
      playTone(783.99, 0.28, 0.36);
    };

    playChime();
    const interval = window.setInterval(playChime, 2400);
    return () => {
      window.clearInterval(interval);
      if (ctx) {
        void ctx.close().catch(() => {});
      }
    };
  }, [effectivePhase, ringtoneMuted]);

  // Live duration timer while connected
  useEffect(() => {
    if (effectivePhase !== "connected") return;
    const id = window.setInterval(() => {
      setElapsedSec((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, [effectivePhase]);

  // For personal linked-device outbound call (no Cloud Calling API), log call intent once asynchronously
  useEffect(() => {
    if (session.direction !== "outbound" || cloudCapable || handoffLoggedRef.current) return;
    handoffLoggedRef.current = true;
    let cancelled = false;
    (async () => {
      const digits = normalizeWaPhoneDigits(session.peerPhone);
      if (!digits) return;
      const res = await whatsappService.initiateOutboundCall({
        account_id: session.accountId,
        chat_jid: session.chatJid,
        target_phone: digits,
        is_video: session.isVideo,
      });
      if (cancelled) return;
      if (res.success && res.data) {
        if (res.data.call_id) setActiveCallId(res.data.call_id);
        if (res.data.wa_deep_link) setWaDeepLink(res.data.wa_deep_link);
        if (res.data.wa_web_link) setWaWebLink(res.data.wa_web_link);
        const noteText = res.data.protocol_note || res.data.note;
        if (noteText) setStatusNote(noteText);
        onCallLogged?.();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    session.direction,
    session.accountId,
    session.chatJid,
    session.peerPhone,
    session.isVideo,
    cloudCapable,
    onCallLogged,
  ]);

  // Apply remote SDP Answer when SSE delivers call_answer_sdp for outbound WebRTC call
  useEffect(() => {
    if (!remoteSdpAnswer || !pcRef.current) return;
    if (appliedAnswerRef.current === remoteSdpAnswer) return;
    appliedAnswerRef.current = remoteSdpAnswer;
    let cancelled = false;
    (async () => {
      try {
        const pc = pcRef.current;
        if (!pc || pc.signalingState === "closed") return;
        await pc.setRemoteDescription({ type: "answer", sdp: remoteSdpAnswer });
        if (!cancelled) {
          setPhase("connected");
          setStatusNote("Đã kết nối âm thanh WebRTC 2 chiều (Opus)");
        }
      } catch (err) {
        if (!cancelled) {
          setPhase("failed");
          setStatusNote(err instanceof Error ? err.message : "Lỗi thiết lập kết nối SDP Answer.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [remoteSdpAnswer]);

  const setupPeerConnection = useCallback((stream: MediaStream): RTCPeerConnection => {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
      ],
    });
    pc.ontrack = (event) => {
      const audioEl = remoteAudioRef.current;
      if (!audioEl) return;
      const remoteStream = event.streams[0] || new MediaStream([event.track]);
      audioEl.srcObject = remoteStream;
      void audioEl.play().catch(() => {});
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        setPhase("connected");
      } else if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
        setStatusNote("Kết nối WebRTC bị gián đoạn.");
      }
    };
    // Keep stream tracks ready for explicit ordering
    localStreamRef.current = stream;
    pcRef.current = pc;
    return pc;
  }, []);

  // Accept inbound Meta Cloud Calling WebRTC offer
  const handleAcceptWebRtc = useCallback(async () => {
    if (!session.sdpOffer) return;
    setBusyAction(true);
    setPhase("connecting_webrtc");
    setStatusNote("Đang cấp quyền micro & khởi tạo WebRTC Answer...");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      const pc = setupPeerConnection(stream);

      // CRITICAL Meta Cloud Calling API SDP Timing Rule:
      // 1) Set remote SDP offer
      await pc.setRemoteDescription({ type: "offer", sdp: session.sdpOffer });
      // 2) Attach ALL local audio tracks BEFORE calling createAnswer()
      for (const track of stream.getTracks()) {
        pc.addTrack(track, stream);
      }
      // 3) Generate SDP answer & gather ICE
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await waitForIceGathering(pc, 1500);

      const finalSdp = pc.localDescription?.sdp || answer.sdp || "";
      const res = await whatsappService.acceptCall(activeCallId, {
        account_id: session.accountId,
        sdp_answer: finalSdp,
      });

      if (!res.success) {
        cleanupMedia();
        setPhase("failed");
        setStatusNote(res.message || "Không thể chấp nhận cuộc gọi qua Meta Cloud API.");
        toast.error(res.message || "Chấp nhận cuộc gọi thất bại.");
      } else {
        setPhase("connected");
        setStatusNote("Đang đàm thoại trực tiếp qua trình duyệt (WebRTC Opus)");
        onCallLogged?.();
      }
    } catch (err) {
      cleanupMedia();
      setPhase("failed");
      const msg =
        err instanceof Error
          ? err.message
          : "Không thể truy cập Microphone để nghe cuộc gọi.";
      setStatusNote(msg);
      toast.error(msg);
    } finally {
      setBusyAction(false);
    }
  }, [session.sdpOffer, session.accountId, activeCallId, setupPeerConnection, cleanupMedia, onCallLogged]);

  // Start outbound Meta Cloud Calling WebRTC call
  const handleStartOutboundWebRtc = useCallback(async () => {
    const digits = normalizeWaPhoneDigits(session.peerPhone);
    if (!digits) {
      toast.error("Hội thoại này chưa có số điện thoại hợp lệ để gọi.");
      return;
    }
    setBusyAction(true);
    setPhase("dialing_webrtc");
    setStatusNote("Đang kết nối micro & tạo phiên WebRTC Offer...");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      const pc = setupPeerConnection(stream);
      for (const track of stream.getTracks()) {
        pc.addTrack(track, stream);
      }
      const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: false });
      await pc.setLocalDescription(offer);
      await waitForIceGathering(pc, 1500);

      const finalOffer = pc.localDescription?.sdp || offer.sdp || "";
      const res = await whatsappService.initiateOutboundCall({
        account_id: session.accountId,
        chat_jid: session.chatJid,
        target_phone: digits,
        is_video: session.isVideo,
        sdp_offer: finalOffer,
      });

      if (!res.success || !res.data) {
        cleanupMedia();
        setPhase("failed");
        setStatusNote(res.message || "Không thể khởi tạo cuộc gọi đi.");
        toast.error(res.message || "Khởi tạo cuộc gọi thất bại.");
        return;
      }

      if (res.data.call_id) setActiveCallId(res.data.call_id);
      if (res.data.wa_deep_link) setWaDeepLink(res.data.wa_deep_link);
      if (res.data.wa_web_link) setWaWebLink(res.data.wa_web_link);
      onCallLogged?.();

      if (res.data.mode === "linked_device_handoff") {
        cleanupMedia();
        setPhase("handoff_ready");
        setStatusNote(
          res.data.protocol_note ||
            res.data.note ||
            "Tài khoản chưa đủ cấu hình Meta Cloud Calling — chuyển sang gọi qua WhatsApp PC.",
        );
        return;
      }

      if (res.data.sdp_answer) {
        appliedAnswerRef.current = res.data.sdp_answer;
        await pc.setRemoteDescription({ type: "answer", sdp: res.data.sdp_answer });
        setPhase("connected");
        setStatusNote("Đã kết nối âm thanh WebRTC 2 chiều");
      } else {
        setPhase("ringing_out");
        setStatusNote("Đang đổ chuông phía khách hàng... chờ tín hiệu nghe máy");
      }
    } catch (err) {
      cleanupMedia();
      setPhase("failed");
      const msg =
        err instanceof Error ? err.message : "Không thể mở micro hoặc gọi ra qua WebRTC.";
      setStatusNote(msg);
      toast.error(msg);
    } finally {
      setBusyAction(false);
    }
  }, [
    session.peerPhone,
    session.accountId,
    session.chatJid,
    session.isVideo,
    setupPeerConnection,
    cleanupMedia,
    onCallLogged,
  ]);

  const handleRejectInbound = useCallback(
    async (withAutoReply: boolean) => {
      setBusyAction(true);
      const res = await whatsappService.rejectCall({
        account_id: session.accountId,
        call_id: activeCallId,
        caller_jid: session.callerJid || session.chatJid,
        auto_reply_text: withAutoReply ? rejectReplyText.trim() || undefined : undefined,
      });
      setBusyAction(false);
      cleanupMedia();
      if (!res.success) {
        toast.error(res.message || "Không thể gửi lệnh từ chối cuộc gọi.");
      } else {
        toast.success(
          withAutoReply
            ? "Đã từ chối cuộc gọi và gửi tin nhắn phản hồi."
            : "Đã từ chối cuộc gọi đến.",
        );
      }
      setPhase("rejected");
      onCallLogged?.();
    },
    [session.accountId, session.callerJid, session.chatJid, activeCallId, rejectReplyText, cleanupMedia, onCallLogged],
  );

  const handleHangup = useCallback(async () => {
    setBusyAction(true);
    cleanupMedia();
    if (activeCallId && !activeCallId.startsWith("local_")) {
      await whatsappService.terminateCall(activeCallId, { account_id: session.accountId });
    }
    setBusyAction(false);
    setPhase("ended");
    onCallLogged?.();
  }, [activeCallId, session.accountId, cleanupMedia, onCallLogged]);

  const handleToggleMute = () => {
    const next = !isMuted;
    setIsMuted(next);
    if (localStreamRef.current) {
      for (const track of localStreamRef.current.getAudioTracks()) {
        track.enabled = !next;
      }
    }
  };

  const handleCloseSafe = () => {
    if (effectivePhase === "connected" || effectivePhase === "ringing_out" || effectivePhase === "dialing_webrtc") {
      void handleHangup();
    } else {
      cleanupMedia();
    }
    onClose();
  };

  const statusHeadline = (() => {
    switch (effectivePhase) {
      case "ringing_in":
        return session.isVideo ? "Cuộc gọi video đến..." : "Cuộc gọi thoại đến...";
      case "dialing_webrtc":
        return "Đang khởi tạo WebRTC...";
      case "ringing_out":
        return "Đang đổ chuông...";
      case "connecting_webrtc":
        return "Đang kết nối âm thanh...";
      case "connected":
        return `Đang đàm thoại • ${formatDurationSeconds(elapsedSec)}`;
      case "handoff_ready":
        return "Gọi nhanh qua WhatsApp PC";
      case "rejected":
        return "Cuộc gọi đã bị từ chối";
      case "missed":
        return "Cuộc gọi nhỡ";
      case "ended":
        return elapsedSec > 0
          ? `Cuộc gọi kết thúc (${formatDurationSeconds(elapsedSec)})`
          : "Cuộc gọi đã kết thúc";
      case "failed":
        return "Kết nối cuộc gọi thất bại";
      default:
        return cloudCapable ? "Sẵn sàng gọi WebRTC 2 chiều" : "Cuộc gọi WhatsApp";
    }
  })();

  const modalNode = (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/65 backdrop-blur-xs p-4">
      {/* Hidden remote WebRTC audio sink */}
      <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />

      <div className="w-full max-w-md overflow-hidden rounded-3xl border border-slate-700/60 bg-gradient-to-b from-[#0b1f1c] via-[#0e2a26] to-[#0a1917] text-white shadow-2xl">
        {/* Top bar */}
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 border border-emerald-400/30 px-2.5 py-0.5 text-[10.5px] font-bold text-emerald-300">
              {session.isVideo ? <Video className="h-3 w-3" /> : <Phone className="h-3 w-3" />}
              {session.isVideo ? "WhatsApp Video" : "WhatsApp Voice"}
            </span>
            {(cloudCapable || hasIncomingSdpOffer) ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/20 border border-sky-400/30 px-2 py-0.5 text-[10px] font-semibold text-sky-200">
                <ShieldCheck className="h-3 w-3" />
                Cloud WebRTC
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-slate-300">
                <Radio className="h-3 w-3" />
                Linked Device
              </span>
            )}
          </div>

          <div className="flex items-center gap-1">
            {effectivePhase === "ringing_in" && (
              <button
                type="button"
                onClick={() => setRingtoneMuted((m) => !m)}
                title={ringtoneMuted ? "Bật chuông" : "Tắt chuông"}
                className="rounded-full p-1.5 text-slate-300 hover:bg-white/10 hover:text-white cursor-pointer"
              >
                {ringtoneMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </button>
            )}
            <button
              type="button"
              onClick={handleCloseSafe}
              className="rounded-full p-1.5 text-slate-300 hover:bg-white/10 hover:text-white cursor-pointer"
              aria-label="Đóng cuộc gọi"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Peer Showcase */}
        <div className="flex flex-col items-center px-6 py-6 text-center">
          <div className="relative">
            {(effectivePhase === "ringing_in" || effectivePhase === "ringing_out" || effectivePhase === "connected") && (
              <span className="absolute -inset-3 rounded-full bg-emerald-500/20 animate-ping" />
            )}
            <WhatsAppAvatar
              src={session.peerAvatar}
              name={session.peerName}
              size={84}
              className="relative ring-4 ring-emerald-400/40 rounded-full"
            />
          </div>

          <h3 className="mt-4 text-lg font-bold tracking-tight text-white">{session.peerName}</h3>
          {session.peerPhone && (
            <p className="mt-0.5 font-mono text-xs text-emerald-200/80">
              {formatPhoneDisplay(session.peerPhone)}
            </p>
          )}

          <div className="mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-emerald-100">
            {effectivePhase === "connected" && (
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            )}
            <span>{statusHeadline}</span>
          </div>

          {statusNote && (
            <p className="mt-2 max-w-xs text-[11.5px] leading-relaxed text-slate-300">
              {statusNote}
            </p>
          )}
        </div>

        {/* Action Panel */}
        <div className="border-t border-white/10 bg-black/25 px-5 py-4 space-y-3">
          {/* INBOUND RINGING CONTROLS */}
          {effectivePhase === "ringing_in" && (
            <>
              <div className="flex items-center justify-center gap-4">
                <button
                  type="button"
                  disabled={busyAction}
                  onClick={() => void handleRejectInbound(false)}
                  className="flex flex-col items-center gap-1.5 group cursor-pointer disabled:opacity-50"
                >
                  <span className="flex h-14 w-14 items-center justify-center rounded-full bg-rose-600 text-white shadow-lg group-hover:bg-rose-500 transition">
                    <PhoneOff className="h-6 w-6" />
                  </span>
                  <span className="text-[11px] font-semibold text-rose-200">Từ chối</span>
                </button>

                {hasIncomingSdpOffer ? (
                  <button
                    type="button"
                    disabled={busyAction}
                    onClick={() => void handleAcceptWebRtc()}
                    className="flex flex-col items-center gap-1.5 group cursor-pointer disabled:opacity-50"
                  >
                    <span className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg group-hover:bg-emerald-400 transition">
                      <PhoneIncoming className="h-6 w-6" />
                    </span>
                    <span className="text-[11px] font-semibold text-emerald-200">
                      Nghe máy (WebRTC)
                    </span>
                  </button>
                ) : (
                  <a
                    href={waDeepLink}
                    className="flex flex-col items-center gap-1.5 group"
                  >
                    <span className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-600 text-white shadow-lg group-hover:bg-emerald-500 transition">
                      <Smartphone className="h-6 w-6" />
                    </span>
                    <span className="text-[11px] font-semibold text-emerald-200">
                      Mở WhatsApp PC
                    </span>
                  </a>
                )}

                <button
                  type="button"
                  onClick={() => setShowRejectReply((v) => !v)}
                  className="flex flex-col items-center gap-1.5 group cursor-pointer"
                >
                  <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/15 text-white group-hover:bg-white/25 transition">
                    <Send className="h-5 w-5" />
                  </span>
                  <span className="text-[11px] font-semibold text-slate-200">
                    Từ chối + Nhắn
                  </span>
                </button>
              </div>

              {!hasIncomingSdpOffer && (
                <div className="rounded-xl border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100/90">
                  Thiết bị cá nhân (QR/Pairing) nhận tín hiệu cuộc gọi đến và hỗ trợ{" "}
                  <strong>Từ chối + Nhắn tin tự động</strong> ngay tại đây. Bật{" "}
                  <strong>Meta Cloud Calling API</strong> để đàm thoại 2 chiều trên trình duyệt.
                </div>
              )}

              {showRejectReply && (
                <div className="space-y-2 rounded-2xl border border-white/15 bg-white/5 p-3">
                  <div className="flex flex-wrap gap-1.5">
                    {QUICK_REJECT_REPLIES.map((tpl) => (
                      <button
                        key={tpl}
                        type="button"
                        onClick={() => setRejectReplyText(tpl)}
                        className="rounded-full bg-white/10 px-2.5 py-1 text-[10.5px] text-slate-200 hover:bg-white/20 text-left cursor-pointer"
                      >
                        {tpl.slice(0, 34)}...
                      </button>
                    ))}
                  </div>
                  <textarea
                    rows={2}
                    value={rejectReplyText}
                    onChange={(e) => setRejectReplyText(e.target.value)}
                    className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-xs text-white outline-none focus:border-emerald-400"
                  />
                  <button
                    type="button"
                    disabled={busyAction}
                    onClick={() => void handleRejectInbound(true)}
                    className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-rose-600 py-2 text-xs font-bold text-white hover:bg-rose-500 disabled:opacity-60 cursor-pointer"
                  >
                    {busyAction ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PhoneOff className="h-3.5 w-3.5" />}
                    Từ chối & Gửi tin nhắn này
                  </button>
                </div>
              )}
            </>
          )}

          {/* OUTBOUND CLOUD WEBRTC IDLE */}
          {effectivePhase === "idle" && session.direction === "outbound" && cloudCapable && (
            <div className="space-y-2.5">
              <button
                type="button"
                disabled={busyAction}
                onClick={() => void handleStartOutboundWebRtc()}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 py-3 text-sm font-bold text-white shadow-lg hover:bg-emerald-400 disabled:opacity-60 transition cursor-pointer"
              >
                {busyAction ? (
                  <Loader2 className="h-4.5 w-4.5 animate-spin" />
                ) : (
                  <PhoneCall className="h-4.5 w-4.5" />
                )}
                <span>Bắt đầu gọi WebRTC ngay</span>
              </button>
              <a
                href={waDeepLink}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-white/5 py-2 text-xs font-semibold text-slate-200 hover:bg-white/10"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Hoặc mở gọi trên WhatsApp PC
              </a>
            </div>
          )}

          {/* PERSONAL LINKED-DEVICE HANDOFF */}
          {effectivePhase === "handoff_ready" && (
            <div className="space-y-2.5">
              <a
                href={waDeepLink}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 py-3 text-sm font-bold text-white shadow-lg hover:bg-emerald-400 transition"
              >
                <Smartphone className="h-4.5 w-4.5" />
                <span>Mở gọi trên WhatsApp PC (whatsapp://)</span>
              </a>
              <div className="grid grid-cols-2 gap-2">
                <a
                  href={waWebLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-white/5 py-2 text-xs font-semibold text-slate-200 hover:bg-white/10"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Mở wa.me
                </a>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenCloudSettings();
                  }}
                  className="flex items-center justify-center gap-1.5 rounded-xl border border-emerald-400/35 bg-emerald-500/15 py-2 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/25 cursor-pointer"
                >
                  <Settings2 className="h-3.5 w-3.5" />
                  Bật Cloud Calling
                </button>
              </div>
              <p className="text-center text-[10.5px] text-slate-400">
                Lịch sử cuộc gọi đã được tự động ghi nhận vào nhật ký cuộc gọi của tài khoản.
              </p>
            </div>
          )}

          {/* LIVE / CONNECTING WEBRTC CONTROLS */}
          {(effectivePhase === "dialing_webrtc" ||
            effectivePhase === "ringing_out" ||
            effectivePhase === "connecting_webrtc" ||
            effectivePhase === "connected") && (
            <div className="flex items-center justify-center gap-6 py-1">
              <button
                type="button"
                onClick={handleToggleMute}
                className="flex flex-col items-center gap-1.5 cursor-pointer"
              >
                <span
                  className={cn(
                    "flex h-12 w-12 items-center justify-center rounded-full transition",
                    isMuted
                      ? "bg-amber-500 text-white"
                      : "bg-white/15 text-white hover:bg-white/25",
                  )}
                >
                  {isMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                </span>
                <span className="text-[11px] text-slate-200">{isMuted ? "Bật mic" : "Tắt mic"}</span>
              </button>

              <button
                type="button"
                disabled={busyAction}
                onClick={() => void handleHangup()}
                className="flex flex-col items-center gap-1.5 cursor-pointer disabled:opacity-60"
              >
                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-rose-600 text-white shadow-lg hover:bg-rose-500 transition">
                  <PhoneOff className="h-6 w-6" />
                </span>
                <span className="text-[11px] font-semibold text-rose-200">Kết thúc</span>
              </button>
            </div>
          )}

          {/* TERMINAL STATES */}
          {(effectivePhase === "ended" ||
            effectivePhase === "rejected" ||
            effectivePhase === "missed" ||
            effectivePhase === "failed") && (
            <div className="flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl bg-white/15 px-5 py-2 text-xs font-bold text-white hover:bg-white/25 cursor-pointer"
              >
                Đóng cửa sổ
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(modalNode, document.body);
}
