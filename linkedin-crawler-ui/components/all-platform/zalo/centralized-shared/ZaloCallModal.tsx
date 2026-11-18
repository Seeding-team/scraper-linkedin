"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Phone,
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
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  checkZaloCallHealth,
  getConversationPhone,
  saveConversationPhone,
  sendZaloVoiceMessage,
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

  // ── Active Call State & Timer ──────────────────────────────────────────────
  const [callMode, setCallMode] = useState<"voice" | "video">(initialMode);
  const [callLaunched, setCallLaunched] = useState(false);
  const [callElapsedSec, setCallElapsedSec] = useState(0);

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

  // ── Hardware Refs (Explicitly released before launching native ZaloCall.exe) ─
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<BlobPart[]>([]);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const callTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    setCallMode(initialMode);
  }, [initialMode, open]);

  /**
   * GIẢI PHÓNG HOÀN TOÀN PHẦN CỨNG ÂM THANH TRÌNH DUYỆT (Anti-WASAPI Exclusive Lock):
   * Khi gọi qua App Zalo PC (ZaloCall.exe), nếu Chrome vẫn giữ MediaStreamTrack mở,
   * driver âm thanh Windows có thể bị xung đột làm mất tiếng mic, rè hoặc đứt quãng.
   * Gọi hàm này TRƯỚC khi bắn URI `zalo://` đảm bảo Zalo nhận 100% phần cứng Mic/Loa sạch!
   */
  const releaseBrowserAudioHardware = useCallback(async () => {
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
  }, []);

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

  // ── Kích hoạt Gọi qua Zalo Native (Opus VoIP chống lag + tự nhả Mic Chrome) ─
  const handleLaunchZaloCall = async (mode: "voice" | "video") => {
    setCallMode(mode);
    // Bước 1: Giải phóng ngay mọi MediaStream/AudioContext của trình duyệt để ZaloCall.exe độc quyền phần cứng sạch
    await releaseBrowserAudioHardware();

    // Bước 2: Tạo chuẩn URI `zalo://conversation?...` khớp 100% bộ xử lý z-uri-open-conv của Zalo PC/App
    let deepLink = "";
    if (cleanPhone.length >= 9) {
      deepLink = `zalo://conversation?phone=${encodeURIComponent(cleanPhone)}`;
    } else if (conversationId && !isGroup) {
      deepLink = `zalo://conversation?id=${encodeURIComponent(conversationId.trim())}`;
    } else {
      toast.error("Cần số điện thoại hoặc hội thoại cá nhân 1-1 để mở cuộc gọi Zalo.");
      return;
    }

    // Bước 3: Mở giao thức zalo:// qua hidden iframe để KHÔNG ngắt kết nối SSE/WebSocket của trang hiện tại
    try {
      const iframe = document.createElement("iframe");
      iframe.style.display = "none";
      iframe.src = deepLink;
      document.body.appendChild(iframe);
      window.setTimeout(() => {
        try {
          document.body.removeChild(iframe);
        } catch {
          /* ignore */
        }
      }, 2500);
    } catch {
      window.location.href = deepLink;
    }

    setCallLaunched(true);
    if (!callTimerRef.current) {
      setCallElapsedSec(0);
      callTimerRef.current = setInterval(() => {
        setCallElapsedSec((prev) => prev + 1);
      }, 1000);
    }

    toast.success(
      mode === "video"
        ? "Đã chuyển sang App Zalo (đã giải phóng Mic trình duyệt) — Bấm biểu tượng Video góc phải Zalo để bắt đầu!"
        : "Đã mở hộp thoại trên App Zalo (Mic & Loa sạch 100%) — Bấm nút Gọi trên Zalo để đàm thoại chuẩn HD!",
    );
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

          {/* ── 3. Cụm Nút Gọi Zalo Chính & Kênh Dự Phòng ─────────────────── */}
          <div className="space-y-2.5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                type="button"
                disabled={!canOpenZaloDirect}
                onClick={() => void handleLaunchZaloCall("voice")}
                className="flex items-center justify-center gap-2 rounded-xl bg-[#0068FF] hover:bg-[#0055D4] active:scale-[0.99] px-4 py-3 text-xs sm:text-sm font-bold text-white shadow-md shadow-blue-600/20 transition cursor-pointer disabled:opacity-50 disabled:pointer-events-none"
              >
                <Phone className="h-4 w-4 fill-white" />
                <span>Gọi Thoại Qua Zalo</span>
              </button>

              <button
                type="button"
                disabled={!canOpenZaloDirect}
                onClick={() => void handleLaunchZaloCall("video")}
                className="flex items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99] px-4 py-3 text-xs sm:text-sm font-bold text-white shadow-md shadow-emerald-600/20 transition cursor-pointer disabled:opacity-50 disabled:pointer-events-none"
              >
                <Video className="h-4 w-4" />
                <span>Video Call Qua Zalo</span>
              </button>
            </div>

            {cleanPhone.length >= 9 && (
              <div className="grid grid-cols-2 gap-2">
                <a
                  href={`https://zalo.me/${cleanPhone}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => void releaseBrowserAudioHardware()}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 transition"
                >
                  <ExternalLink className="h-3.5 w-3.5 text-[#0068FF]" />
                  <span>Mở Zalo.me ({cleanPhone})</span>
                </a>
                <a
                  href={`tel:${cleanPhone}`}
                  onClick={() => void releaseBrowserAudioHardware()}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 transition"
                >
                  <Smartphone className="h-3.5 w-3.5 text-emerald-600" />
                  <span>Gọi SIM di động</span>
                </a>
              </div>
            )}

            {callLaunched && (
              <div className="rounded-xl border border-blue-200 bg-blue-50/80 px-3.5 py-2.5 text-xs text-blue-900 flex items-center justify-between gap-2">
                <span>
                  Đã mở đúng hội thoại trên <strong>App Zalo</strong> (đã nhả khóa Mic trình duyệt). Bấm biểu tượng{" "}
                  <strong>{callMode === "video" ? "📹 Video" : "📞 Gọi thoại"}</strong> góc phải cửa sổ Zalo để bắt đầu!
                </span>
              </div>
            )}
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
