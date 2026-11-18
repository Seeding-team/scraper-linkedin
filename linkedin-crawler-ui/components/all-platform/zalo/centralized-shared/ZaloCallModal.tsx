"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Phone,
  PhoneCall,
  PhoneOff,
  Video,
  Mic,
  MicOff,
  Volume2,
  Wifi,
  CheckCircle2,
  X,
  RefreshCw,
  Send,
  Square,
  ExternalLink,
  Smartphone,
  ShieldCheck,
  Clock,
  Sparkles,
  Radio,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  buildZaloDirectCallWsUrl,
  checkZaloCallHealth,
  controlZaloDirectCall,
  getConversationPhone,
  getZaloDirectCallStatus,
  saveConversationPhone,
  sendZaloFriendRequest,
  sendZaloVoiceMessage,
  startZaloDirectCall,
  type ZaloDirectCallSession,
} from "@/services/zaloCrawlerService";
import { postCallResultService } from "@/services/all-platform.service";
import {
  FALLBACK_CALL_OPTIONS,
  loadCallResultOptions,
  type CallResultOption,
} from "@/components/all-platform/posts/PostCallResultDropdown";
import { useAppAuth } from "@/contexts/AppAuthContext";

export interface ZaloCallModalProps {
  open: boolean;
  onClose: () => void;
  accountId?: string;
  accountLabel?: string;
  conversationId?: string;
  customerName?: string;
  phoneNumber?: string | null;
  isGroup?: boolean;
  sourcePostId?: string | null;
  sourcePlatform?: string | null;
  initialMode?: "voice" | "video";
  onVoiceSendCustom?: (blob: Blob, durationSec?: number, filename?: string) => Promise<boolean>;
  onVoiceNoteSent?: () => void;
  onPhoneSaved?: (phone: string) => void;
}

function normalizeVnPhone(raw?: string | null): string {
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("84") && digits.length >= 10) {
    return `0${digits.slice(2)}`;
  }
  return digits;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function ZaloCallModal({
  open,
  onClose,
  accountId = "default",
  accountLabel,
  conversationId,
  customerName,
  phoneNumber,
  isGroup = false,
  sourcePostId,
  sourcePlatform,
  initialMode = "voice",
  onVoiceSendCustom,
  onVoiceNoteSent,
  onPhoneSaved,
}: ZaloCallModalProps) {
  const { user } = useAppAuth();
  const [mounted, setMounted] = useState(false);

  // ── Phone state ────────────────────────────────────────────────────────────
  const [resolvedPhone, setResolvedPhone] = useState<string>("");
  const [phoneInput, setPhoneInput] = useState<string>("");
  const [savingPhone, setSavingPhone] = useState(false);

  // ── Network / Session Pre-Flight ───────────────────────────────────────────
  const [checkingNet, setCheckingNet] = useState(false);
  const [pingMs, setPingMs] = useState<number | null>(null);
  const [jitterMs, setJitterMs] = useState<number | null>(null);
  const [sessionOnline, setSessionOnline] = useState<boolean | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);

  // ── Mic & Speaker Pre-Flight (AEC / NS / AGC) ─────────────────────────────
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedMicId, setSelectedMicId] = useState<string>("");
  const [testingMic, setTestingMic] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [micError, setMicError] = useState<string | null>(null);
  const [playingTestTone, setPlayingTestTone] = useState(false);

  // ── Active Call State & Timer (Hướng 3 — Direct Web Softphone Engine) ─────
  const [callMode, setCallMode] = useState<"voice" | "video">(initialMode);
  const [callLaunched, setCallLaunched] = useState(false);
  const [callElapsedSec, setCallElapsedSec] = useState(0);
  const [activeCallSession, setActiveCallSession] = useState<ZaloDirectCallSession | null>(null);
  const [startingDirectCall, setStartingDirectCall] = useState(false);
  const [endingDirectCall, setEndingDirectCall] = useState(false);
  const [isCallMuted, setIsCallMuted] = useState(false);
  const [sendingFriendReq, setSendingFriendReq] = useState(false);
  const [friendReqSent, setFriendReqSent] = useState(false);

  // ── Direct Web Voice Note Studio ───────────────────────────────────────────
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [recordSec, setRecordSec] = useState(0);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [recordedFilename, setRecordedFilename] = useState("voice-note.m4a");
  const [sendingVoice, setSendingVoice] = useState(false);

  // ── KPI Call Result Logging ────────────────────────────────────────────────
  const [callOptions, setCallOptions] = useState<CallResultOption[]>(FALLBACK_CALL_OPTIONS);
  const [selectedCallResult, setSelectedCallResult] = useState<string>("");
  const [savingCallResult, setSavingCallResult] = useState(false);
  const [loggedAttempts, setLoggedAttempts] = useState<number>(0);

  // ── Hardware & Web Softphone Gateway Refs ─────────────────────────────────
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<BlobPart[]>([]);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const callTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const callWsRef = useRef<WebSocket | null>(null);
  const callStatusPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const callProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const isCallMutedRef = useRef<boolean>(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    setCallMode(initialMode);
  }, [initialMode, open]);

  useEffect(() => {
    isCallMutedRef.current = isCallMuted;
  }, [isCallMuted]);

  const stopCallWsAndPolling = useCallback(() => {
    if (callStatusPollRef.current) {
      clearInterval(callStatusPollRef.current);
      callStatusPollRef.current = null;
    }
    if (callProcessorRef.current) {
      try {
        callProcessorRef.current.disconnect();
      } catch {
        /* ignore */
      }
      callProcessorRef.current = null;
    }
    if (callWsRef.current) {
      try {
        callWsRef.current.close();
      } catch {
        /* ignore */
      }
      callWsRef.current = null;
    }
  }, []);

  /**
   * Giải phóng đồng bộ (0ms) các MediaStreamTrack trước khi mở liên kết ngoài `zalo://`
   * để KHÔNG làm mất Transient User Activation của Chrome và nhả ngay khóa WASAPI.
   */
  const releaseMicTracksSync = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (mediaStreamRef.current) {
      for (const track of mediaStreamRef.current.getTracks()) {
        try {
          track.stop();
        } catch {
          /* ignore */
        }
      }
      mediaStreamRef.current = null;
    }
    setTestingMic(false);
    setMicLevel(0);
  }, []);

  const releaseBrowserAudioHardware = useCallback(async () => {
    stopCallWsAndPolling();
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        /* ignore */
      }
    }
    mediaRecorderRef.current = null;
    if (mediaStreamRef.current) {
      for (const track of mediaStreamRef.current.getTracks()) {
        try {
          track.stop();
        } catch {
          /* ignore */
        }
      }
      mediaStreamRef.current = null;
    }
    if (audioCtxRef.current) {
      try {
        if (audioCtxRef.current.state !== "closed") {
          await audioCtxRef.current.close();
        }
      } catch {
        /* ignore */
      }
      audioCtxRef.current = null;
    }
    setTestingMic(false);
    setIsRecordingVoice(false);
    setMicLevel(0);
  }, [stopCallWsAndPolling]);

  // Dọn dẹp triệt để khi đóng modal
  useEffect(() => {
    if (!open) {
      void releaseBrowserAudioHardware();
      if (callTimerRef.current) {
        clearInterval(callTimerRef.current);
        callTimerRef.current = null;
      }
      setCallLaunched(false);
      setCallElapsedSec(0);
      setActiveCallSession(null);
      setStartingDirectCall(false);
      setEndingDirectCall(false);
      setIsCallMuted(false);
      setSendingFriendReq(false);
      setFriendReqSent(false);
      setSelectedCallResult("");
      if (recordedUrl) {
        URL.revokeObjectURL(recordedUrl);
        setRecordedUrl(null);
      }
      setRecordedBlob(null);
      setRecordSec(0);
    }
  }, [open, releaseBrowserAudioHardware, recordedUrl]);

  // Nạp SĐT + danh mục kết quả cuộc gọi + đo chất lượng đường truyền khi mở modal
  const runNetworkDiagnostics = useCallback(async () => {
    setCheckingNet(true);
    try {
      const samples: number[] = [];
      let lastRes: Awaited<ReturnType<typeof checkZaloCallHealth>> | null = null;
      for (let i = 0; i < 3; i++) {
        const t0 = performance.now();
        const res = await checkZaloCallHealth(accountId || "default");
        const dt = Math.max(1, Math.round(performance.now() - t0));
        samples.push(dt);
        lastRes = res;
      }
      const avg = Math.round(samples.reduce((a, b) => a + b, 0) / samples.length);
      const jit =
        samples.length >= 2
          ? Math.round(
              samples.slice(1).reduce((acc, v, idx) => acc + Math.abs(v - samples[idx]), 0) /
                (samples.length - 1),
            )
          : 0;
      setPingMs(avg);
      setJitterMs(jit);
      if (lastRes) {
        setSessionOnline(Boolean(lastRes.listener_connected || lastRes.listener_running || lastRes.has_auth));
        setSessionExpired(Boolean(lastRes.auth_expired));
      }
    } catch {
      setPingMs(null);
      setJitterMs(null);
    } finally {
      setCheckingNet(false);
    }
  }, [accountId]);

  useEffect(() => {
    if (!open) return;

    const initialClean = normalizeVnPhone(phoneNumber);
    setResolvedPhone(initialClean);
    setPhoneInput(initialClean);

    if (!initialClean && conversationId && !isGroup) {
      getConversationPhone(conversationId, customerName, accountId)
        .then((res) => {
          if (res?.phone) {
            const p = normalizeVnPhone(res.phone);
            setResolvedPhone(p);
            setPhoneInput(p);
          }
        })
        .catch(() => {});
    }

    loadCallResultOptions()
      .then((opts) => {
        if (opts && opts.length > 0) setCallOptions(opts);
      })
      .catch(() => {});

    void runNetworkDiagnostics();

    if (typeof navigator !== "undefined" && navigator.mediaDevices?.enumerateDevices) {
      navigator.mediaDevices
        .enumerateDevices()
        .then((devs) => {
          const mics = devs.filter((d) => d.kind === "audioinput");
          setAudioDevices(mics);
          if (mics.length > 0 && !selectedMicId) {
            setSelectedMicId(mics[0].deviceId);
          }
        })
        .catch(() => {});
    }
  }, [open, phoneNumber, conversationId, isGroup, customerName, accountId, runNetworkDiagnostics, selectedMicId]);

  const cleanPhone = useMemo(() => normalizeVnPhone(resolvedPhone), [resolvedPhone]);
  const canOpenZaloDirect = Boolean(cleanPhone.length >= 9 || (conversationId && !isGroup));

  const networkQuality = useMemo(() => {
    if (checkingNet) {
      return {
        label: "Đang đo đường truyền...",
        tone: "bg-slate-100 text-slate-600 border-slate-200",
        dot: "bg-slate-400 animate-pulse",
      };
    }
    if (pingMs == null) {
      return {
        label: "Sẵn sàng kết nối qua App Zalo",
        tone: "bg-blue-50 text-blue-700 border-blue-200",
        dot: "bg-blue-500",
      };
    }
    if (pingMs <= 95 && (jitterMs ?? 0) <= 30) {
      return {
        label: `Chuẩn HD (${pingMs}ms · Jitter ${jitterMs ?? 0}ms) — Không lag`,
        tone: "bg-emerald-50 text-emerald-700 border-emerald-200",
        dot: "bg-emerald-500",
      };
    }
    if (pingMs <= 200) {
      return {
        label: `Ổn định (${pingMs}ms · Jitter ${jitterMs ?? 0}ms)`,
        tone: "bg-amber-50 text-amber-800 border-amber-200",
        dot: "bg-amber-500",
      };
    }
    return {
      label: `Độ trễ cao (${pingMs}ms) — Ưu tiên gọi Zalo App / SIM`,
      tone: "bg-rose-50 text-rose-700 border-rose-200",
      dot: "bg-rose-500",
    };
  }, [checkingNet, pingMs, jitterMs]);

  // ── Kiểm tra Mic trực tiếp (Khử vọng AEC + Lọc ồn NS + Cân bằng âm AGC) ───
  const toggleMicTest = async () => {
    if (testingMic) {
      await releaseBrowserAudioHardware();
      return;
    }
    setMicError(null);
    try {
      await releaseBrowserAudioHardware();
      const constraints: MediaStreamConstraints = {
        audio: {
          ...(selectedMicId ? { deviceId: { exact: selectedMicId } } : {}),
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          sampleRate: 48000,
        },
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      mediaStreamRef.current = stream;

      const devs = await navigator.mediaDevices.enumerateDevices().catch(() => []);
      const mics = devs.filter((d) => d.kind === "audioinput");
      if (mics.length > 0) setAudioDevices(mics);

      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.75;
      source.connect(analyser);

      const data = new Uint8Array(analyser.frequencyBinCount);
      setTestingMic(true);

      const updateMeter = () => {
        if (!mediaStreamRef.current) return;
        analyser.getByteTimeDomainData(data);
        let sumSq = 0;
        for (let i = 0; i < data.length; i++) {
          const norm = (data[i] - 128) / 128;
          sumSq += norm * norm;
        }
        const rms = Math.sqrt(sumSq / data.length);
        const level = Math.min(100, Math.round(rms * 320));
        setMicLevel(level);
        rafRef.current = requestAnimationFrame(updateMeter);
      };
      rafRef.current = requestAnimationFrame(updateMeter);
    } catch (err) {
      setMicError(
        err instanceof Error
          ? `Không mở được Mic (${err.message}). Hãy cấp quyền Microphone trên trình duyệt.`
          : "Không thể truy cập Microphone.",
      );
      setTestingMic(false);
    }
  };

  // ── Kiểm tra Loa / Tai nghe (2-Tone Chuông Trong Trẻo Không Cần File Ngoài) ─
  const handleSpeakerTest = async () => {
    if (playingTestTone) return;
    setPlayingTestTone(true);
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const tempCtx = new AudioCtx();
      const now = tempCtx.currentTime;

      const playTone = (freq: number, startOffset: number, dur: number) => {
        const osc = tempCtx.createOscillator();
        const gain = tempCtx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, now + startOffset);
        gain.gain.setValueAtTime(0.001, now + startOffset);
        gain.gain.exponentialRampToValueAtTime(0.18, now + startOffset + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.001, now + startOffset + dur);
        osc.connect(gain);
        gain.connect(tempCtx.destination);
        osc.start(now + startOffset);
        osc.stop(now + startOffset + dur + 0.02);
      };

      playTone(523.25, 0, 0.22); // C5
      playTone(659.25, 0.2, 0.32); // E5
      setTimeout(() => {
        void tempCtx.close().catch(() => {});
        setPlayingTestTone(false);
      }, 600);
    } catch {
      setPlayingTestTone(false);
      toast.error("Không thể phát âm thanh thử loa trên trình duyệt này.");
    }
  };

  // ── Lưu nhanh SĐT cho hội thoại ────────────────────────────────────────────
  const handleSavePhoneInline = async () => {
    const clean = normalizeVnPhone(phoneInput);
    if (clean.length < 9) {
      toast.error("Vui lòng nhập số điện thoại hợp lệ (9–11 chữ số).");
      return;
    }
    setSavingPhone(true);
    try {
      if (conversationId) {
        await saveConversationPhone(conversationId, clean, customerName);
      }
      setResolvedPhone(clean);
      setPhoneInput(clean);
      onPhoneSaved?.(clean);
      toast.success(`Đã lưu số điện thoại ${clean}`);
    } catch {
      setResolvedPhone(clean);
      toast.success(`Đã áp dụng số ${clean} cho phiên gọi này`);
    } finally {
      setSavingPhone(false);
    }
  };

  // ── Đường dẫn DeepLink đồng bộ cho nút phụ [Mở bằng App Zalo PC] ───────────
  const nativeZaloDeepLink = useMemo(() => {
    if (cleanPhone.length >= 9) {
      return `zalo://conversation?phone=${encodeURIComponent(cleanPhone)}`;
    }
    if (conversationId && !isGroup) {
      return `zalo://conversation?id=${encodeURIComponent(conversationId.trim())}`;
    }
    return "";
  }, [cleanPhone, conversationId, isGroup]);

  // ── Kết nối WebAudio <-> WebSocket /call-ws/{session_id} <-> UDP RTP Gateway ─
  const connectDirectCallAudioGateway = useCallback(
    async (session: ZaloDirectCallSession) => {
      stopCallWsAndPolling();
      try {
        const wsUrl = buildZaloDirectCallWsUrl(session.session_id);
        const ws = new WebSocket(wsUrl);
        ws.binaryType = "arraybuffer";
        callWsRef.current = ws;

        ws.onmessage = (ev) => {
          if (typeof ev.data === "string") {
            try {
              const raw = JSON.parse(ev.data) as Record<string, unknown>;
              const parsed = (raw.session || (raw.session_id ? raw : null)) as ZaloDirectCallSession | null;
              if (parsed) {
                setActiveCallSession(parsed);
                if (parsed.kpi_recorded) {
                  setLoggedAttempts((prev) => Math.max(1, prev));
                  if (typeof window !== "undefined") {
                    window.dispatchEvent(new CustomEvent("zalo-kpi-updated"));
                  }
                }
              }
            } catch {
              /* ignore malformed JSON frame */
            }
            return;
          }

          // Binary PCM16 / audio frame từ Zalo UDP RTP Gateway đẩy về trình duyệt
          if (ev.data instanceof ArrayBuffer && audioCtxRef.current && ev.data.byteLength >= 4) {
            try {
              const ctx = audioCtxRef.current;
              const pcm16 = new Int16Array(ev.data);
              if (pcm16.length > 0) {
                const audioBuf = ctx.createBuffer(1, pcm16.length, 16000);
                const channel = audioBuf.getChannelData(0);
                for (let i = 0; i < pcm16.length; i++) {
                  channel[i] = pcm16[i] / 32768;
                }
                const src = ctx.createBufferSource();
                src.buffer = audioBuf;
                src.connect(ctx.destination);
                src.start();
              }
            } catch {
              /* ignore frame decode error */
            }
          }
        };

        // Mở luồng Mic (AEC + NS + AGC) truyền thẳng PCM16 qua WebSocket sang UDP RTP Gateway
        if (typeof navigator !== "undefined" && navigator.mediaDevices?.getUserMedia) {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              ...(selectedMicId ? { deviceId: { exact: selectedMicId } } : {}),
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
              channelCount: 1,
              sampleRate: 16000,
            },
          });
          mediaStreamRef.current = stream;

          const AudioCtx =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
          const ctx = new AudioCtx({ sampleRate: 16000 });
          audioCtxRef.current = ctx;

          const source = ctx.createMediaStreamSource(stream);
          const processor = ctx.createScriptProcessor(1024, 1, 1);
          callProcessorRef.current = processor;

          processor.onaudioprocess = (audioEv) => {
            const input = audioEv.inputBuffer.getChannelData(0);
            let sumSq = 0;
            const pcm16 = new Int16Array(input.length);
            for (let i = 0; i < input.length; i++) {
              const s = Math.max(-1, Math.min(1, input[i]));
              sumSq += s * s;
              pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
            }
            const rms = Math.sqrt(sumSq / input.length);
            setMicLevel(isCallMutedRef.current ? 0 : Math.min(100, Math.round(rms * 320)));

            if (
              !isCallMutedRef.current &&
              callWsRef.current &&
              callWsRef.current.readyState === WebSocket.OPEN
            ) {
              callWsRef.current.send(pcm16.buffer);
            }
          };

          const zeroGain = ctx.createGain();
          zeroGain.gain.value = 0;
          source.connect(processor);
          processor.connect(zeroGain);
          zeroGain.connect(ctx.destination);
        }

        // Đồng bộ trạng thái Signaling định kỳ (11300 -> 11301 -> 11302 -> 11303 -> 11306)
        callStatusPollRef.current = setInterval(async () => {
          try {
            const res = await getZaloDirectCallStatus(session.session_id, accountId || "default");
            if (res?.session) {
              setActiveCallSession(res.session);
              if (
                res.session.status === "ended" ||
                res.session.status === "cancelled" ||
                res.session.status === "failed" ||
                res.session.status === "privacy_blocked" ||
                res.session.status === "rejected"
              ) {
                stopCallWsAndPolling();
                if (callTimerRef.current) {
                  clearInterval(callTimerRef.current);
                  callTimerRef.current = null;
                }
              }
            }
          } catch {
            /* ignore transient poll error */
          }
        }, 2000);
      } catch {
        /* ignore audio gateway setup error */
      }
    },
    [accountId, selectedMicId, stopCallWsAndPolling],
  );

  // ── Kích hoạt Gọi Trực Tiếp Trên Web CRM Qua Zalo VoIP Engine (Hướng 3) ────
  const handleStartDirectZaloCall = async (mode: "voice" | "video") => {
    if (!canOpenZaloDirect) {
      toast.error("Cần số điện thoại hoặc hội thoại cá nhân 1-1 để khởi tạo cuộc gọi Zalo.");
      return;
    }
    setCallMode(mode);
    setStartingDirectCall(true);
    setIsCallMuted(false);

    try {
      await releaseBrowserAudioHardware();
      const res = await startZaloDirectCall({
        account_id: accountId || "default",
        conversation_id: conversationId || "",
        callee_id: !isGroup && conversationId ? conversationId : "",
        phone_number: cleanPhone || undefined,
        customer_name: customerName || undefined,
        call_type: mode === "video" ? 2 : 1,
        source_post_id: sourcePostId,
        source_platform: sourcePlatform,
      });

      if (res?.session) {
        setActiveCallSession(res.session);
        setCallLaunched(true);
        if (callTimerRef.current) clearInterval(callTimerRef.current);
        setCallElapsedSec(0);
        callTimerRef.current = setInterval(() => {
          setCallElapsedSec((prev) => prev + 1);
        }, 1000);

        await connectDirectCallAudioGateway(res.session);

        if (res.session.status === "privacy_blocked") {
          toast.error(
            "Khách hàng đang bật chế độ 'Chặn cuộc gọi từ người lạ' trên Zalo di động (chỉ nhận cuộc gọi từ bạn bè). Hãy gửi tin nhắn thoại bên dưới hoặc kết bạn trước trên Zalo!",
            { duration: 7000 },
          );
        } else if (res.session.status === "rejected") {
          toast.warning(
            res.session.warning || "Cuộc gọi bị Zalo từ chối hoặc khách đang bận.",
            { duration: 5000 },
          );
        } else if (res.session.status === "failed") {
          toast.warning(
            `Zalo VoIP Engine phản hồi: ${res.session.warning || res.session.error || "Không thể cấp phát kênh VoIP"}. Bạn có thể dùng nút Mở bằng App Zalo PC hoặc gửi Tin nhắn thoại trực tiếp bên dưới.`,
          );
        } else {
          toast.success(
            `Đã phát lệnh gọi Zalo VoIP #${res.session.call_id} (11300/11301) từ nick "${accountLabel || accountId}" tới ${customerName || cleanPhone || conversationId}!`,
          );
        }
      }
    } catch (err) {
      toast.error(
        err instanceof Error
          ? `Không thể khởi tạo Zalo VoIP Engine: ${err.message}`
          : "Lỗi kết nối tới Zalo VoIP Call Engine trên máy chủ.",
      );
    } finally {
      setStartingDirectCall(false);
    }
  };

  // ── Kết thúc / Hủy cuộc gọi Web Softphone (11305/11306 + 11311 + Auto +1 KPI) ─
  const handleEndDirectCall = async () => {
    if (!activeCallSession) return;
    setEndingDirectCall(true);
    try {
      const action =
        activeCallSession.status === "connected" ? "end" : "cancel";
      const resultCode = selectedCallResult || "called";
      const res = await controlZaloDirectCall(
        activeCallSession.session_id,
        action,
        resultCode,
        accountId || "default",
      );
      if (res?.session) {
        setActiveCallSession(res.session);
        if (res.session.kpi_recorded) {
          const nextAttempts = Math.max(1, loggedAttempts + 1);
          setLoggedAttempts(nextAttempts);
          if (!selectedCallResult) setSelectedCallResult(resultCode);
          if (typeof window !== "undefined") {
            const targetKey =
              (sourcePostId && sourcePostId.trim()) ||
              `zalo:${accountId || "default"}:${conversationId || cleanPhone || "unknown"}`;
            const targetPlatform =
              sourcePostId && sourcePlatform ? sourcePlatform : "zalo";
            window.dispatchEvent(
              new CustomEvent("seeding_post_call_updated", {
                detail: {
                  postId: targetKey,
                  platform: targetPlatform,
                  resultCode,
                  attempts: nextAttempts,
                  lastCallAt: new Date().toISOString(),
                },
              }),
            );
            window.dispatchEvent(new CustomEvent("zalo-kpi-updated"));
          }
        }
      }
      toast.success("Đã kết thúc cuộc gọi Zalo & tự động ghi nhận +1 KPI CALL!");
    } catch {
      toast.error("Đã đóng phiên âm thanh cục bộ.");
    } finally {
      await releaseBrowserAudioHardware();
      if (callTimerRef.current) {
        clearInterval(callTimerRef.current);
        callTimerRef.current = null;
      }
      setEndingDirectCall(false);
    }
  };

  // ── Gửi lời mời kết bạn 1-click khi gặp lỗi privacy_blocked ────────────────
  const handleSendFriendRequest = async () => {
    const targetUid = activeCallSession?.callee_id || conversationId;
    if (!targetUid || targetUid.startsWith("g_") || targetUid.startsWith("group_")) {
      toast.error("Không tìm thấy Zalo UID của khách hàng để gửi lời mời kết bạn.");
      return;
    }
    setSendingFriendReq(true);
    try {
      const res = await sendZaloFriendRequest(
        accountId || "default",
        targetUid,
        "Xin chào! Mình liên hệ trao đổi công việc qua Zalo nhé.",
      );
      if (res?.ok) {
        setFriendReqSent(true);
        toast.success("Đã gửi lời mời kết bạn tới khách hàng thành công!");
      } else {
        toast.error("Không thể gửi kết bạn (khách đã chặn hoặc đã là bạn bè).");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Lỗi gửi kết bạn Zalo";
      toast.error(msg);
    } finally {
      setSendingFriendReq(false);
    }
  };

  // ── Ghi âm & Gửi Voice Note trực tiếp qua ZCA API (Không cần Zalo PC!) ─────
  const handleStartVoiceRecord = async () => {
    if (!conversationId) {
      toast.error("Hãy mở cuộc trò chuyện Zalo trước khi gửi ghi âm thoại trực tiếp.");
      return;
    }
    setMicError(null);
    await releaseBrowserAudioHardware();
    if (recordedUrl) {
      URL.revokeObjectURL(recordedUrl);
      setRecordedUrl(null);
    }
    setRecordedBlob(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(selectedMicId ? { deviceId: { exact: selectedMicId } } : {}),
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          sampleRate: 48000,
        },
      });
      mediaStreamRef.current = stream;

      const preferredTypes = [
        "audio/mp4;codecs=mp4a.40.2",
        "audio/mp4",
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/ogg;codecs=opus",
      ];
      let chosenMime = "";
      if (typeof MediaRecorder !== "undefined") {
        for (const t of preferredTypes) {
          if (MediaRecorder.isTypeSupported(t)) {
            chosenMime = t;
            break;
          }
        }
      }

      const recorder = chosenMime
        ? new MediaRecorder(stream, { mimeType: chosenMime, audioBitsPerSecond: 96000 })
        : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      recordChunksRef.current = [];

      const ext = chosenMime.includes("mp4") ? "m4a" : chosenMime.includes("ogg") ? "ogg" : "webm";
      setRecordedFilename(`zalo-voice-${Date.now()}.${ext}`);

      // VU meter song song trong lúc thu âm
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tickVu = () => {
        if (!mediaStreamRef.current) return;
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        setMicLevel(Math.min(100, Math.round(Math.sqrt(sum / data.length) * 320)));
        rafRef.current = requestAnimationFrame(tickVu);
      };
      rafRef.current = requestAnimationFrame(tickVu);

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          recordChunksRef.current.push(ev.data);
        }
      };

      recorder.onstop = () => {
        const finalMime = recorder.mimeType || chosenMime || "audio/mp4";
        const blob = new Blob(recordChunksRef.current, { type: finalMime });
        if (blob.size > 0) {
          setRecordedBlob(blob);
          setRecordedUrl(URL.createObjectURL(blob));
        }
      };

      recorder.start(250);
      setIsRecordingVoice(true);
      setRecordSec(0);
      recordTimerRef.current = setInterval(() => {
        setRecordSec((s) => s + 1);
      }, 1000);
    } catch (err) {
      setMicError(
        err instanceof Error
          ? `Không thể ghi âm (${err.message}). Vui lòng kiểm tra quyền Microphone.`
          : "Không thể bắt đầu ghi âm.",
      );
    }
  };

  const handleStopVoiceRecord = async () => {
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
      await audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    setIsRecordingVoice(false);
    setMicLevel(0);
  };

  const handleSendRecordedVoice = async () => {
    if (!recordedBlob || !conversationId) return;
    setSendingVoice(true);
    try {
      let ok = false;
      if (onVoiceSendCustom) {
        ok = await onVoiceSendCustom(recordedBlob, recordSec || 1, recordedFilename);
      } else {
        const res = await sendZaloVoiceMessage(
          accountId || "default",
          conversationId,
          recordedBlob,
          recordedFilename,
          {
            durationSec: recordSec || 1,
            threadType: isGroup ? 1 : 0,
            staffName: user?.name,
            staffAvatar: (user as { avatar_url?: string; avatar?: string } | null)?.avatar_url ||
              (user as { avatar_url?: string; avatar?: string } | null)?.avatar,
          },
        );
        ok = Boolean(res?.ok);
        if (ok) toast.success("Đã gửi tin nhắn thoại Zalo chuẩn AAC thành công!");
      }
      if (ok) {
        if (recordedUrl) URL.revokeObjectURL(recordedUrl);
        setRecordedUrl(null);
        setRecordedBlob(null);
        setRecordSec(0);
        onVoiceNoteSent?.();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Không thể gửi tin nhắn thoại Zalo.");
    } finally {
      setSendingVoice(false);
    }
  };

  // ── Chốt kết quả cuộc gọi & Cộng +1 KPI CALL ──────────────────────────────
  const handleLogCallResult = async (resultCode: string) => {
    const targetKey =
      (sourcePostId && sourcePostId.trim()) ||
      `zalo:${accountId || "default"}:${conversationId || cleanPhone || "unknown"}`;
    const targetPlatform =
      sourcePostId && sourcePlatform ? sourcePlatform : "zalo";

    setSavingCallResult(true);
    setSelectedCallResult(resultCode);
    try {
      const res = await postCallResultService.updateCallResult(targetKey, {
        result_code: resultCode,
        platform: targetPlatform,
      });
      if (res.success && res.data) {
        const attempts = res.data.call_attempts ?? loggedAttempts + 1;
        setLoggedAttempts(attempts);
        const label = callOptions.find((o) => o.code === resultCode)?.label || resultCode;
        toast.success(`Đã ghi nhận cuộc gọi: "${label}" (+1 KPI CALL — Lần ${attempts})`);
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("seeding_post_call_updated", {
              detail: {
                postId: targetKey,
                platform: targetPlatform,
                resultCode,
                attempts,
                lastCallAt: res.data.last_call_at,
              },
            }),
          );
          window.dispatchEvent(new CustomEvent("zalo-kpi-updated"));
        }
      } else {
        toast.error(res.message || "Không thể lưu kết quả cuộc gọi.");
      }
    } catch {
      toast.error("Lỗi máy chủ khi ghi nhận KPI cuộc gọi.");
    } finally {
      setSavingCallResult(false);
    }
  };

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100020] flex items-center justify-center bg-slate-950/55 p-3 sm:p-4 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-[560px] max-h-[92vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl text-slate-900 animate-in zoom-in-95 duration-150">
        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-100 bg-gradient-to-r from-[#0068FF] to-[#0052CC] px-5 py-4 text-white rounded-t-2xl">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15 backdrop-blur-xs shadow-inner">
              {callMode === "video" ? <Video className="h-5 w-5" /> : <Phone className="h-5 w-5" />}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="truncate text-sm sm:text-base font-bold">
                  Zalo Call Studio • {customerName || "Khách hàng Zalo"}
                </h3>
                {callLaunched && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/25 border border-emerald-300/40 px-2 py-0.5 text-[11px] font-mono font-bold text-emerald-50">
                    <Clock className="h-3 w-3 animate-pulse" />
                    {formatDuration(callElapsedSec)}
                  </span>
                )}
              </div>
              <p className="truncate text-[11.5px] text-blue-100">
                Nick trực: <span className="font-semibold text-white">{accountLabel || accountId}</span>
                {cleanPhone ? ` • SĐT: ${cleanPhone}` : conversationId ? ` • UID: ${conversationId}` : ""}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-1.5 text-white/80 hover:bg-white/15 hover:text-white transition cursor-pointer"
            title="Đóng"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-4 sm:p-5 space-y-4">
          {/* ── 1. Trạng thái Mạng & Phiên Zalo + Kiểm tra Mic/Loa chống lag ── */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold", networkQuality.tone)}>
                  <span className={cn("h-2 w-2 rounded-full", networkQuality.dot)} />
                  <Wifi className="h-3 w-3" />
                  {networkQuality.label}
                </span>
                {sessionExpired ? (
                  <span className="rounded-full bg-rose-100 text-rose-700 px-2 py-0.5 text-[10.5px] font-bold">
                    Phiên ZCA hết hạn
                  </span>
                ) : sessionOnline ? (
                  <span className="rounded-full bg-emerald-100 text-emerald-700 px-2 py-0.5 text-[10.5px] font-bold">
                    Zalo Bridge Online
                  </span>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => void runNetworkDiagnostics()}
                disabled={checkingNet}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100 transition cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={cn("h-3 w-3", checkingNet && "animate-spin")} />
                Đo lại mạng
              </button>
            </div>

            {/* Chọn Mic + Thanh đo âm lượng Mic + Nút thử Loa */}
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
              <div className="sm:col-span-6">
                <select
                  value={selectedMicId}
                  onChange={(e) => setSelectedMicId(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 focus:border-[#0068FF] focus:outline-none"
                  title="Chọn thiết bị Microphone"
                >
                  {audioDevices.length === 0 ? (
                    <option value="">🎙️ Microphone mặc định (AEC + Khử ồn)</option>
                  ) : (
                    audioDevices.map((d, idx) => (
                      <option key={d.deviceId || idx} value={d.deviceId}>
                        🎙️ {d.label || `Microphone ${idx + 1}`}
                      </option>
                    ))
                  )}
                </select>
              </div>
              <div className="sm:col-span-3">
                <button
                  type="button"
                  onClick={() => void toggleMicTest()}
                  className={cn(
                    "w-full inline-flex items-center justify-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-bold transition cursor-pointer",
                    testingMic
                      ? "border-rose-300 bg-rose-50 text-rose-700"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100",
                  )}
                >
                  {testingMic ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5 text-[#0068FF]" />}
                  <span>{testingMic ? "Dừng thử" : "Thử Mic"}</span>
                </button>
              </div>
              <div className="sm:col-span-3">
                <button
                  type="button"
                  onClick={() => void handleSpeakerTest()}
                  disabled={playingTestTone}
                  className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100 transition cursor-pointer disabled:opacity-60"
                >
                  <Volume2 className={cn("h-3.5 w-3.5 text-emerald-600", playingTestTone && "animate-bounce")} />
                  <span>{playingTestTone ? "Đang kêu..." : "Thử Loa"}</span>
                </button>
              </div>
            </div>

            {(testingMic || isRecordingVoice) && (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px] font-semibold text-slate-600">
                  <span>Độ nhạy Mic (Khử vọng AEC · Lọc tạp âm NS · Tự cân bằng AGC):</span>
                  <span className="font-mono font-bold text-emerald-600">{micLevel}%</span>
                </div>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all duration-75",
                      micLevel > 75 ? "bg-amber-500" : micLevel > 10 ? "bg-emerald-500" : "bg-blue-500",
                    )}
                    style={{ width: `${Math.max(4, micLevel)}%` }}
                  />
                </div>
              </div>
            )}

            {micError && (
              <p className="text-[11.5px] font-medium text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-2.5 py-1.5">
                {micError}
              </p>
            )}

            <div className="flex items-start gap-2 text-[11px] text-slate-500 leading-relaxed">
              <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600 mt-0.5" />
              <span>
                <strong className="text-slate-700">Chống ngắt quãng & chống khóa Mic:</strong> Khi bấm gọi Zalo, trình duyệt tự động nhả 100% kênh âm thanh để engine gốc <code className="text-[10.5px] bg-slate-200/70 px-1 rounded">ZaloCall</code> sử dụng codec Opus phần cứng ổn định, không trễ tiếng.
              </span>
            </div>
          </div>

          {/* ── 2. Nhập / Cập nhật SĐT nhanh (nếu hội thoại chưa có SĐT) ────── */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <input
                type="tel"
                value={phoneInput}
                onChange={(e) => setPhoneInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleSavePhoneInline();
                }}
                placeholder={
                  conversationId && !isGroup
                    ? "Nhập SĐT khách (không bắt buộc — vẫn gọi được qua Zalo UID)..."
                    : "Nhập SĐT khách hàng để gọi Zalo / SIM..."
                }
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-mono font-semibold text-slate-800 placeholder:font-sans placeholder:font-normal placeholder:text-slate-400 focus:border-[#0068FF] focus:outline-none focus:ring-2 focus:ring-[#0068FF]/15"
              />
            </div>
            {normalizeVnPhone(phoneInput) !== cleanPhone && normalizeVnPhone(phoneInput).length >= 9 && (
              <button
                type="button"
                onClick={() => void handleSavePhoneInline()}
                disabled={savingPhone}
                className="shrink-0 rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-white hover:bg-slate-800 transition cursor-pointer disabled:opacity-50"
              >
                {savingPhone ? "Đang lưu..." : "Lưu SĐT"}
              </button>
            )}
          </div>

          {/* ── 3. Cụm Nút Gọi Zalo Chính (Hướng 3 — Direct Web VoIP Engine) ── */}
          <div className="space-y-2.5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                type="button"
                disabled={!canOpenZaloDirect || startingDirectCall}
                onClick={() => void handleStartDirectZaloCall("voice")}
                className="flex items-center justify-center gap-2 rounded-xl bg-[#0068FF] hover:bg-[#0055D4] active:scale-[0.99] px-4 py-3 text-xs sm:text-sm font-bold text-white shadow-md shadow-blue-600/20 transition cursor-pointer disabled:opacity-50 disabled:pointer-events-none"
              >
                <Phone className="h-4 w-4 fill-white" />
                <span>
                  {startingDirectCall && callMode === "voice"
                    ? "Đang quay số VoIP (11300)..."
                    : "Gọi Thoại Qua Zalo (Web)"}
                </span>
              </button>

              <button
                type="button"
                disabled={!canOpenZaloDirect || startingDirectCall}
                onClick={() => void handleStartDirectZaloCall("video")}
                className="flex items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99] px-4 py-3 text-xs sm:text-sm font-bold text-white shadow-md shadow-emerald-600/20 transition cursor-pointer disabled:opacity-50 disabled:pointer-events-none"
              >
                <Video className="h-4 w-4" />
                <span>
                  {startingDirectCall && callMode === "video"
                    ? "Đang kết nối Video VoIP..."
                    : "Video Call Qua Zalo (Web)"}
                </span>
              </button>
            </div>

            {/* ── Bảng Điều Khiển Web Softphone (ZCA VoIP 11300..11311 + UDP RTP) ── */}
            {activeCallSession && (
              <div className="rounded-xl border border-blue-200 bg-gradient-to-br from-blue-50/90 via-white to-indigo-50/70 p-3.5 space-y-2.5 shadow-xs">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold border",
                        activeCallSession.status === "connected"
                          ? "bg-emerald-100 text-emerald-800 border-emerald-300"
                          : activeCallSession.status === "ringing" ||
                              activeCallSession.status === "dialing" ||
                              activeCallSession.status === "initializing"
                            ? "bg-blue-100 text-blue-800 border-blue-300"
                            : activeCallSession.status === "privacy_blocked"
                              ? "bg-rose-100 text-rose-800 border-rose-300"
                              : activeCallSession.status === "failed" ||
                                  activeCallSession.status === "rejected"
                                ? "bg-amber-100 text-amber-800 border-amber-300"
                                : "bg-slate-100 text-slate-700 border-slate-300",
                      )}
                    >
                      <Radio
                        className={cn(
                          "h-3 w-3",
                          (activeCallSession.status === "connected" ||
                            activeCallSession.status === "ringing" ||
                            activeCallSession.status === "dialing") &&
                            "animate-pulse",
                        )}
                      />
                      {activeCallSession.status === "initializing" &&
                        "Đang cấp phát Signaling (11300 requestcall)..."}
                      {activeCallSession.status === "dialing" &&
                        "Đang phát lệnh gọi tới Zalo khách (11301 request)..."}
                      {activeCallSession.status === "ringing" &&
                        "Đang đổ chuông trên Zalo khách hàng (11302 ringring)..."}
                      {activeCallSession.status === "connected" &&
                        `Đang đàm thoại 2 chiều (${formatDuration(callElapsedSec)})`}
                      {activeCallSession.status === "ended" &&
                        "Đã kết thúc đàm thoại (11306/11311)"}
                      {activeCallSession.status === "cancelled" &&
                        "Đã hủy cuộc gọi (11305/11311)"}
                      {activeCallSession.status === "privacy_blocked" &&
                        "Khách chặn cuộc gọi người lạ (chưa kết bạn)"}
                      {activeCallSession.status === "rejected" &&
                        "Cuộc gọi bị đối phương từ chối"}
                      {activeCallSession.status === "failed" &&
                        "Kênh VoIP bận hoặc không thể kết nối"}
                    </span>
                    <span className="text-[11px] font-mono font-semibold text-slate-500">
                      Call #{activeCallSession.call_id} • {activeCallSession.codec}
                    </span>
                  </div>

                  {(activeCallSession.status === "initializing" ||
                    activeCallSession.status === "dialing" ||
                    activeCallSession.status === "ringing" ||
                    activeCallSession.status === "connected") && (
                    <div className="flex items-center gap-1.5">
                      {activeCallSession.status === "ringing" && (
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              const res = await controlZaloDirectCall(
                                activeCallSession.session_id,
                                "mark_connected",
                                undefined,
                                accountId || "default",
                              );
                              if (res?.session) setActiveCallSession(res.session);
                              toast.success("Đã xác nhận kết nối và gửi 11304 AnswerACK!");
                            } catch (e) {
                              toast.error("Không thể gửi ACK: " + (e instanceof Error ? e.message : String(e)));
                            }
                          }}
                          className="inline-flex items-center gap-1 rounded-lg border border-emerald-400 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 px-2.5 py-1 text-[11px] font-bold transition cursor-pointer"
                          title="Nếu khách hàng trên điện thoại đã bấm nhấc máy, bấm vào đây để kích hoạt đàm thoại ngay lập tức"
                        >
                          <PhoneCall className="h-3.5 w-3.5 text-emerald-600 animate-bounce" />
                          <span>⚡ Khách đã nhấc máy? Vào đàm thoại</span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => setIsCallMuted((m) => !m)}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-bold transition cursor-pointer",
                          isCallMuted
                            ? "border-amber-300 bg-amber-100 text-amber-800"
                            : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100",
                        )}
                      >
                        {isCallMuted ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5 text-emerald-600" />}
                        <span>{isCallMuted ? "Đã tắt Mic" : "Mic đang bật"}</span>
                      </button>

                      <button
                        type="button"
                        disabled={endingDirectCall}
                        onClick={() => void handleEndDirectCall()}
                        className="inline-flex items-center gap-1 rounded-lg bg-rose-600 hover:bg-rose-700 px-2.5 py-1 text-[11px] font-bold text-white transition cursor-pointer disabled:opacity-50"
                      >
                        <PhoneOff className="h-3.5 w-3.5" />
                        <span>{endingDirectCall ? "Đang ngắt..." : "Kết thúc"}</span>
                      </button>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between text-[10.5px] font-mono text-slate-500 flex-wrap gap-2">
                  <span>
                    UDP RTP Port: <strong>{activeCallSession.rtp_port || "auto"}</strong>
                    {activeCallSession.public_ip
                      ? ` • STUN: ${activeCallSession.public_ip}:${activeCallSession.public_port}`
                      : ""}
                  </span>
                  <span>
                    RTP Tx: <strong>{activeCallSession.packets_sent}</strong> • Rx:{" "}
                    <strong>{activeCallSession.packets_received}</strong>
                    {activeCallSession.kpi_recorded ? " • Đã +1 KPI CALL" : ""}
                  </span>
                </div>

                {activeCallSession.status === "privacy_blocked" && (
                  <div className="rounded-xl border border-rose-200 bg-rose-50/90 p-3 text-[12px] text-rose-800 space-y-2 shadow-xs">
                    <div className="font-bold flex items-center gap-1.5 text-rose-900">
                      <span>⚠️ Đối phương đang chặn cuộc gọi từ người lạ</span>
                    </div>
                    <p className="text-[11px] leading-relaxed text-rose-700">
                      Trên Zalo di động, khách hàng chưa bật quyền <strong>&quot;Cho phép người lạ gọi điện&quot;</strong> (chỉ nhận cuộc gọi từ bạn bè), nên Zalo tự động chuyển cuộc gọi thành <em>&quot;Cuộc gọi nhỡ&quot;</em>.
                    </p>
                    <div className="flex flex-wrap items-center gap-2 pt-0.5">
                      <button
                        type="button"
                        disabled={sendingFriendReq || friendReqSent}
                        onClick={() => void handleSendFriendRequest()}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold shadow-xs transition cursor-pointer",
                          friendReqSent
                            ? "bg-emerald-600 text-white cursor-default"
                            : "bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50",
                        )}
                      >
                        <UserPlus className="h-3.5 w-3.5" />
                        <span>
                          {friendReqSent
                            ? "✓ Đã gửi lời mời kết bạn"
                            : sendingFriendReq
                              ? "Đang gửi kết bạn..."
                              : "🤝 Gửi lời mời kết bạn ngay"}
                        </span>
                      </button>
                      <span className="text-[11px] text-rose-800 font-medium">
                        hoặc gửi <strong>Tin nhắn thoại trực tiếp</strong> bên dưới!
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Kênh mở nhanh App Zalo PC đồng bộ (0ms User Gesture) & SIM ── */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {nativeZaloDeepLink && (
                <a
                  href={nativeZaloDeepLink}
                  onClick={() => {
                    releaseMicTracksSync();
                    setCallLaunched(true);
                  }}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50/60 hover:bg-blue-100/70 px-3 py-2 text-xs font-bold text-[#0068FF] transition"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span>Mở bằng App Zalo PC</span>
                </a>
              )}
              {cleanPhone.length >= 9 && (
                <>
                  <a
                    href={`https://zalo.me/${cleanPhone}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => releaseMicTracksSync()}
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 transition"
                  >
                    <ExternalLink className="h-3.5 w-3.5 text-[#0068FF]" />
                    <span>Mở Zalo.me ({cleanPhone})</span>
                  </a>
                  <a
                    href={`tel:${cleanPhone}`}
                    onClick={() => releaseMicTracksSync()}
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 transition"
                  >
                    <Smartphone className="h-3.5 w-3.5 text-emerald-600" />
                    <span>Gọi SIM di động</span>
                  </a>
                </>
              )}
            </div>
          </div>

          {/* ── 4. Gửi Ghi Âm Thoại Trực Tiếp Vào Hộp Thoại Zalo (Web Voice Note) ─ */}
          {conversationId && (
            <div className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <Sparkles className="h-4 w-4 text-[#0068FF]" />
                  <span className="text-xs font-bold text-slate-800">
                    Gửi Tin Nhắn Thoại Trực Tiếp (Không cần App Zalo PC)
                  </span>
                </div>
                {isRecordingVoice && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 text-rose-700 px-2 py-0.5 text-[11px] font-mono font-bold">
                    ● REC {formatDuration(recordSec)}
                  </span>
                )}
              </div>

              <p className="text-[11px] text-slate-500">
                Dùng khi dùng chung nick Zalo trên máy chủ hoặc khi khách chưa bắt máy: thu âm khử ồn trực tiếp trên Web và gửi thẳng bong bóng thoại vào Zalo của khách.
              </p>

              <div className="flex items-center gap-2 flex-wrap">
                {!isRecordingVoice ? (
                  <button
                    type="button"
                    onClick={() => void handleStartVoiceRecord()}
                    disabled={sendingVoice}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 px-3.5 py-2 text-xs font-bold text-white transition cursor-pointer disabled:opacity-50"
                  >
                    <Mic className="h-3.5 w-3.5" />
                    <span>{recordedBlob ? "Thu âm lại" : "Bắt đầu ghi âm"}</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleStopVoiceRecord()}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 px-3.5 py-2 text-xs font-bold text-white transition cursor-pointer"
                  >
                    <Square className="h-3.5 w-3.5 fill-white" />
                    <span>Dừng ({formatDuration(recordSec)})</span>
                  </button>
                )}

                {recordedUrl && recordedBlob && !isRecordingVoice && (
                  <>
                    <audio src={recordedUrl} controls className="h-9 flex-1 min-w-[180px]" />
                    <button
                      type="button"
                      onClick={() => void handleSendRecordedVoice()}
                      disabled={sendingVoice}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-[#0068FF] hover:bg-[#0055D4] px-3.5 py-2 text-xs font-bold text-white shadow-xs transition cursor-pointer disabled:opacity-50"
                    >
                      <Send className="h-3.5 w-3.5" />
                      <span>{sendingVoice ? "Đang gửi..." : "Gửi vào Zalo"}</span>
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          {/* ── 5. Ghi nhận Kết quả Cuộc gọi (+1 KPI CALL) ──────────────────── */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-slate-800">
                Chốt kết quả cuộc gọi (+1 KPI CALL)
              </span>
              {loggedAttempts > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-800 px-2.5 py-0.5 text-[11px] font-bold">
                  <CheckCircle2 className="h-3 w-3" />
                  Đã lưu (Lần {loggedAttempts})
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              {callOptions.map((opt) => {
                const isSelected = selectedCallResult === opt.code;
                return (
                  <button
                    key={opt.code}
                    type="button"
                    disabled={savingCallResult}
                    onClick={() => void handleLogCallResult(opt.code)}
                    className={cn(
                      "rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold text-left transition cursor-pointer truncate",
                      isSelected
                        ? "border-emerald-500 bg-emerald-50 text-emerald-800 font-bold shadow-2xs"
                        : "border-slate-200 bg-white text-slate-700 hover:border-[#0068FF]/50 hover:bg-blue-50/40",
                    )}
                    title={opt.label}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
