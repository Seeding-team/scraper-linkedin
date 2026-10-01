"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { scheduledCommentService } from "@/services/scheduled-comment.service";
import { API_BASE_URL } from "@/lib/env";

export type ExtensionPlatform = "facebook" | "linkedin" | "threads";
/** Nền tảng cào/bình luận theo NHÓM (Threads không có nhóm - tìm theo từ khoá). */
export type GroupPlatform = Exclude<ExtensionPlatform, "threads">;

/** Phiên bản tối thiểu của "Markee Seeding Extension" (extensions/comment-extension) có lệnh cào gộp. */
export const REQUIRED_EXTENSION_VERSION = "2.0";

/** Phiên bản đầu tiên có lệnh cào Threads theo từ khoá (MK_TH_CRAWL_*, feature "th_crawl"). */
export const THREADS_CRAWL_EXTENSION_VERSION = "2.1";

/** Phiên bản đầu tiên có lệnh cào xoay vòng cả 3 nền tảng (MK_ROTATE_CRAWL_*, feature "rotate_crawl"). */
export const ROTATE_CRAWL_EXTENSION_VERSION = "2.7";

export type ExtensionStatus = "checking" | "ready" | "outdated" | "missing" | "invalidated";

export function extensionApiBase(): string {
  if (API_BASE_URL) return API_BASE_URL;
  return typeof window !== "undefined" ? window.location.origin : "https://seeding.markeeai.com";
}

function postToExtension(action: string, payload?: unknown) {
  window.postMessage(payload === undefined ? { action } : { action, payload }, "*");
}

// ── Kết nối extension ────────────────────────────────────────────────────────

export function useSeedingExtensionStatus() {
  const [status, setStatus] = useState<ExtensionStatus>("checking");
  const [version, setVersion] = useState("");
  const [features, setFeatures] = useState<string[]>([]);

  useEffect(() => {
    let ready = false;
    let legacySeen = false;
    let attempts = 0;

    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || !event.data) return;
      const action = event.data.action;
      if (action === "MK_EXTENSION_READY") {
        ready = true;
        setVersion(event.data.payload?.version || "");
        setFeatures(Array.isArray(event.data.payload?.features) ? event.data.payload.features : []);
        setStatus("ready");
      } else if (action === "COMMENT_EXTENSION_READY") {
        legacySeen = true;
      } else if (action === "COMMENT_EXTENSION_INVALIDATED") {
        ready = false;
        setStatus("invalidated");
      }
    };

    window.addEventListener("message", onMessage);
    postToExtension("MK_PING");
    const interval = window.setInterval(() => {
      if (ready || attempts >= 10) {
        window.clearInterval(interval);
        return;
      }
      attempts++;
      postToExtension("MK_PING");
      postToExtension("PING_COMMENT_EXTENSION");
      // Bản cũ (<= 1.8) chỉ trả COMMENT_EXTENSION_READY: bình luận được nhưng KHÔNG cào được.
      if (attempts >= 3) setStatus(legacySeen ? "outdated" : "missing");
    }, 1000);

    return () => {
      window.removeEventListener("message", onMessage);
      window.clearInterval(interval);
    };
  }, []);

  return { status, version, features, isReady: status === "ready" };
}

// ── Cào bài (Facebook + LinkedIn) ───────────────────────────────────────────

export interface CrawlLogLine {
  level: "info" | "success" | "warn" | "error";
  message: string;
  at: number;
}

export interface CrawlRuntime {
  running: boolean;
  done: boolean;
  logs: CrawlLogLine[];
  groupIndex: number;
  totalGroups: number;
  posts: number;
  saved: number;
}

const EMPTY_RUNTIME: CrawlRuntime = { running: false, done: false, logs: [], groupIndex: 0, totalGroups: 0, posts: 0, saved: 0 };
const PREFIX: Record<ExtensionPlatform, string> = { facebook: "MK_FB_CRAWL_", linkedin: "MK_LI_CRAWL_", threads: "MK_TH_CRAWL_" };

export interface CrawlGroupInput {
  id?: string;
  name?: string;
  url: string;
  keywords?: string[] | null;
  post_limit?: number | null;
}

interface UseExtensionCrawlOptions {
  onSaved?: (platform: ExtensionPlatform, data: { count: number; groupUrl: string; groupId: string }) => void;
  onDone?: (platform: ExtensionPlatform, data: { totalSaved: number; stopped: boolean }) => void;
}

export function useExtensionCrawl({ onSaved, onDone }: UseExtensionCrawlOptions = {}) {
  const [runtime, setRuntime] = useState<Record<ExtensionPlatform, CrawlRuntime>>({
    facebook: EMPTY_RUNTIME,
    linkedin: EMPTY_RUNTIME,
    threads: EMPTY_RUNTIME,
  });
  const onSavedRef = useRef(onSaved);
  const onDoneRef = useRef(onDone);
  const startTimeoutRef = useRef<Record<ExtensionPlatform, number | null>>({ facebook: null, linkedin: null, threads: null });
  useEffect(() => {
    onSavedRef.current = onSaved;
    onDoneRef.current = onDone;
  }, [onSaved, onDone]);

  const update = useCallback((platform: ExtensionPlatform, fn: (r: CrawlRuntime) => CrawlRuntime) => {
    setRuntime((prev) => ({ ...prev, [platform]: fn(prev[platform]) }));
  }, []);

  const addLog = useCallback(
    (platform: ExtensionPlatform, level: CrawlLogLine["level"], message: string) =>
      update(platform, (r) => ({ ...r, logs: [...r.logs, { level, message, at: Date.now() }].slice(-200) })),
    [update],
  );

  useEffect(() => {
    const clearStartTimeout = (platform: ExtensionPlatform) => {
      const t = startTimeoutRef.current[platform];
      if (t) window.clearTimeout(t);
      startTimeoutRef.current[platform] = null;
    };

    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || !event.data || typeof event.data.action !== "string") return;
      const action: string = event.data.action;
      const platform: ExtensionPlatform | null = action.startsWith(PREFIX.facebook)
        ? "facebook"
        : action.startsWith(PREFIX.linkedin)
          ? "linkedin"
          : action.startsWith(PREFIX.threads)
            ? "threads"
            : null;
      if (!platform) return;
      const kind = action.slice(PREFIX[platform].length);
      const p = event.data.payload || {};

      if (kind === "START_RESULT") {
        clearStartTimeout(platform);
        if (!p.success) {
          update(platform, (r) => ({ ...r, running: false }));
          addLog(platform, "error", p.error || "Extension từ chối lệnh cào.");
        }
      } else if (kind === "STATUS_RESULT") {
        if (p.running) update(platform, (r) => ({ ...r, running: true, done: false }));
      } else if (kind === "LOG") {
        addLog(platform, (p.level as CrawlLogLine["level"]) || "info", p.message || "");
      } else if (kind === "PROGRESS") {
        update(platform, (r) => ({
          ...r,
          running: true,
          groupIndex: typeof p.groupIndex === "number" ? p.groupIndex : r.groupIndex,
          totalGroups: typeof p.totalGroups === "number" ? p.totalGroups : r.totalGroups,
          posts: typeof p.posts === "number" && p.posts > 0 ? p.posts : r.posts,
        }));
      } else if (kind === "SAVED") {
        const count = Number(p.count) || 0;
        update(platform, (r) => ({ ...r, saved: r.saved + count }));
        onSavedRef.current?.(platform, { count, groupUrl: p.groupUrl || "", groupId: p.groupId || "" });
      } else if (kind === "DONE") {
        clearStartTimeout(platform);
        update(platform, (r) => ({ ...r, running: false, done: true }));
        onDoneRef.current?.(platform, { totalSaved: Number(p.totalSaved) || 0, stopped: !!p.stopped });
      }
    };

    window.addEventListener("message", onMessage);
    // Trang vừa mở lại giữa lúc extension đang cào (F5) -> vẫn hiện đúng trạng thái "đang chạy".
    postToExtension("MK_FB_CRAWL_STATUS");
    postToExtension("MK_LI_CRAWL_STATUS");
    postToExtension("MK_TH_CRAWL_STATUS");
    return () => window.removeEventListener("message", onMessage);
  }, [addLog, update]);

  const sendStart = useCallback(
    (platform: ExtensionPlatform, total: number, unit: string, payload: Record<string, unknown>, minVersion: string) => {
      setRuntime((prev) => ({
        ...prev,
        [platform]: { ...EMPTY_RUNTIME, running: true, totalGroups: total, logs: [{ level: "info", message: `Đang gửi lệnh cào ${total} ${unit} tới Extension...`, at: Date.now() }] },
      }));
      postToExtension(PREFIX[platform] + "START", payload);
      const existing = startTimeoutRef.current[platform];
      if (existing) window.clearTimeout(existing);
      startTimeoutRef.current[platform] = window.setTimeout(() => {
        startTimeoutRef.current[platform] = null;
        update(platform, (r) => ({ ...r, running: false }));
        addLog(platform, "error", `Extension không phản hồi lệnh cào sau 8 giây. Kiểm tra đã cài đúng Markee Seeding Extension ${minVersion}, rồi F5 lại trang.`);
      }, 8000);
    },
    [addLog, update],
  );

  const start = useCallback(
    (platform: ExtensionPlatform, groups: CrawlGroupInput[], config: Record<string, unknown>) =>
      sendStart(platform, groups.length, "nhóm", { groups, config: { apiBase: extensionApiBase(), ...config } }, REQUIRED_EXTENSION_VERSION),
    [sendStart],
  );

  /** Threads không có group: gửi danh sách TỪ KHOÁ (extension mở trang tìm kiếm cho từng từ khoá). */
  const startKeywords = useCallback(
    (keywords: string[], config: Record<string, unknown>) =>
      sendStart("threads", keywords.length, "từ khoá", { keywords, config: { apiBase: extensionApiBase(), ...config } }, THREADS_CRAWL_EXTENSION_VERSION),
    [sendStart],
  );

  const stop = useCallback(
    (platform: ExtensionPlatform) => {
      postToExtension(PREFIX[platform] + "STOP");
      addLog(platform, "warn", "Đã gửi lệnh dừng — extension sẽ lưu nốt phần đã cào rồi dừng.");
    },
    [addLog],
  );

  const reset = useCallback((platform: ExtensionPlatform) => update(platform, () => EMPTY_RUNTIME), [update]);

  return { runtime, start, startKeywords, stop, reset };
}

// ── Nhiều lịch cào xoay vòng độc lập Facebook -> LinkedIn -> Threads -> lặp lại ─
// Dành cho acc "seeding-crawl" đăng nhập cố định trên VPS: mỗi lịch có nhóm/từ khoá +
// giờ lặp lại RIÊNG. Chỉ 1 lịch chạy tại 1 thời điểm (đúng tinh thần "hàng đợi") - lịch
// nào đến giờ trước chạy trước, lịch khác tự chờ, xong lịch này thì tự chạy tiếp lịch kế.

export type ScheduleStatus = "waiting_interval" | "waiting_online" | "running" | "stopped" | "done";
export type ScheduleStage = "facebook" | "linkedin" | "threads" | null;

export interface RotationGroupInput {
  id?: string;
  name?: string;
  url: string;
}

export interface RotationScheduleCfg {
  apiBase: string;
  email: string;
  idMember: string | null;
  intervalHours: number;
  repeatEnabled: boolean;
  fbGroups: RotationGroupInput[];
  liGroups: RotationGroupInput[];
  threadsKeywords: string[];
}

export interface RotationSchedule {
  id: string;
  label: string;
  cfg: RotationScheduleCfg;
  enabled: boolean;
  status: ScheduleStatus;
  currentStage: ScheduleStage;
  roundNumber: number;
  nextRunAt: number | null;
  lastRoundSummary: { roundNumber: number; totalSaved: number; at: number } | null;
  lastError: string | null;
  createdAt: number;
}

export function useRotationSchedules() {
  const [schedules, setSchedules] = useState<RotationSchedule[]>([]);
  const [logs, setLogs] = useState<CrawlLogLine[]>([]);
  const [loaded, setLoaded] = useState(false);

  const addLog = useCallback(
    (level: CrawlLogLine["level"], message: string) =>
      setLogs((prev) => [...prev, { level, message, at: Date.now() }].slice(-300)),
    [],
  );

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || !event.data || typeof event.data.action !== "string") return;
      const action: string = event.data.action;
      if (!action.startsWith("MK_ROTATE_SCHEDULE_")) return;
      const kind = action.slice("MK_ROTATE_SCHEDULE_".length);
      const p = event.data.payload || {};

      if (kind === "CHANGED") {
        setSchedules(Array.isArray(p.schedules) ? p.schedules : []);
        setLoaded(true);
      } else if (kind === "LIST_RESULT") {
        if (p.success) setSchedules(Array.isArray(p.schedules) ? p.schedules : []);
        setLoaded(true);
      } else if (kind === "LOG") {
        addLog((p.level as CrawlLogLine["level"]) || "info", `[${p.label || "?"}] ${p.message || ""}`);
      } else if (kind === "STAGE") {
        setSchedules((prev) =>
          prev.map((s) =>
            s.id === p.scheduleId
              ? { ...s, currentStage: (p.stage as ScheduleStage) ?? s.currentStage, roundNumber: typeof p.roundNumber === "number" ? p.roundNumber : s.roundNumber }
              : s,
          ),
        );
      } else if (kind === "ROUND_DONE") {
        addLog("success", `Vòng ${p.roundNumber} hoàn tất — +${p.totalSaved} bài mới.`);
      }
    };

    window.addEventListener("message", onMessage);
    postToExtension("MK_ROTATE_SCHEDULE_LIST");
    return () => window.removeEventListener("message", onMessage);
  }, [addLog]);

  const addSchedule = useCallback(
    (
      label: string,
      fbGroups: RotationGroupInput[],
      liGroups: RotationGroupInput[],
      threadsKeywords: string[],
      config: Record<string, unknown>,
    ): Promise<{ success: boolean; error?: string }> => {
      return new Promise((resolve) => {
        let settled = false;
        const onMsg = (e: MessageEvent) => {
          if (e.source !== window || e.data?.action !== "MK_ROTATE_SCHEDULE_ADD_RESULT") return;
          if (settled) return;
          settled = true;
          window.removeEventListener("message", onMsg);
          resolve(e.data.payload || { success: false, error: "Không nhận được phản hồi từ Extension." });
        };
        window.addEventListener("message", onMsg);
        postToExtension("MK_ROTATE_SCHEDULE_ADD", { label, fbGroups, liGroups, threadsKeywords, config: { apiBase: extensionApiBase(), ...config } });
        window.setTimeout(() => {
          if (settled) return;
          settled = true;
          window.removeEventListener("message", onMsg);
          resolve({ success: false, error: `Extension không phản hồi sau 8 giây. Kiểm tra đã cài đúng Markee Seeding Extension bản ${ROTATE_CRAWL_EXTENSION_VERSION}+, rồi F5 lại trang.` });
        }, 8000);
      });
    },
    [],
  );

  const toggleSchedule = useCallback((id: string, enabled: boolean) => {
    postToExtension("MK_ROTATE_SCHEDULE_TOGGLE", { id, enabled });
  }, []);

  const stopSchedule = useCallback(
    (id: string) => {
      postToExtension("MK_ROTATE_SCHEDULE_STOP", { id });
      addLog("warn", "Đã gửi lệnh dừng 1 lịch cào.");
    },
    [addLog],
  );

  const deleteSchedule = useCallback((id: string) => {
    postToExtension("MK_ROTATE_SCHEDULE_DELETE", { id });
  }, []);

  return { schedules, logs, loaded, addSchedule, toggleSchedule, stopSchedule, deleteSchedule };
}

// ── Bình luận hàng loạt (Facebook + LinkedIn) + hẹn giờ Facebook ─────────────

export interface CommentProgress {
  current: number;
  total: number;
  status: string;
  url?: string;
  result?: { success?: boolean; error?: string };
}

export interface CommentPostInput {
  url: string;
  id_post?: string;
  id_platform?: number;
}

interface UseBulkCommentOptions {
  isReady: boolean;
  email?: string;
  onComplete?: (seededUrls: string[]) => void;
}

// Chỉ Facebook/LinkedIn có bình luận hàng loạt từ trang này (Threads mới có cào).
export const PLATFORM_DB_ID: Record<GroupPlatform, number> = { facebook: 1, linkedin: 2 };

export function useBulkCommentRuntime({ isReady, email, onComplete }: UseBulkCommentOptions) {
  const [isCommenting, setIsCommenting] = useState(false);
  const [progress, setProgress] = useState<CommentProgress | null>(null);
  const [stopping, setStopping] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const isCommentingRef = useRef(false);
  const runRef = useRef<{ kind: "manual" | "scheduled"; urls: string[]; scheduledId?: string } | null>(null);
  const processingScheduledRef = useRef<Set<string>>(new Set());
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  const setCommenting = (value: boolean) => {
    isCommentingRef.current = value;
    setIsCommenting(value);
  };

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || !event.data) return;
      const { action, payload } = event.data;
      // Bridge phát song song BULK_COMMENT_* và LI_COMMENT_* cho cùng 1 sự kiện — chỉ nghe BULK_*.
      if (action === "BULK_COMMENT_STARTED") {
        setCommenting(true);
        setLastError(null);
      } else if (action === "BULK_COMMENT_FAILED_TO_START") {
        setCommenting(false);
        const run = runRef.current;
        runRef.current = null;
        if (run?.kind === "scheduled" && run.scheduledId) processingScheduledRef.current.delete(run.scheduledId);
        setLastError(event.data.error || "Extension từ chối lệnh bình luận.");
      } else if (action === "BULK_COMMENT_PROGRESS") {
        if (payload) setProgress(payload);
      } else if (action === "BULK_COMMENT_DONE") {
        setCommenting(false);
        setStopping(false);
        const run = runRef.current;
        runRef.current = null;
        if (run?.kind === "scheduled" && run.scheduledId) {
          scheduledCommentService.markPosted(run.scheduledId).catch(() => {});
          processingScheduledRef.current.delete(run.scheduledId);
          setProgress((p) => (p ? { ...p, status: "Đã hoàn tất comment hẹn giờ!" } : null));
        } else {
          setProgress((p) => (p ? { ...p, status: "Hoàn tất toàn bộ tiến trình!" } : null));
          onCompleteRef.current?.(run?.urls || []);
        }
      } else if (action === "STATUS_RESPONSE") {
        const running = !!payload?.isCommenting;
        if (running) {
          setCommenting(true);
          if (payload?.currentProgress) setProgress(payload.currentProgress);
        } else if (isCommentingRef.current && !runRef.current) {
          setCommenting(false);
        }
      } else if (action === "STOP_BULK_COMMENT_RESPONSE") {
        setStopping(false);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    if (!isReady) return;
    postToExtension("GET_STATUS");
    const interval = window.setInterval(() => postToExtension("GET_STATUS"), 3000);
    return () => window.clearInterval(interval);
  }, [isReady]);

  const start = useCallback(
    (posts: CommentPostInput[], text: string, extra: { id_social_account?: string; id_platform: number }) => {
      runRef.current = { kind: "manual", urls: posts.map((p) => p.url) };
      setLastError(null);
      setProgress({ current: 0, total: posts.length, status: "Đang gửi lệnh tới Extension..." });
      setCommenting(true);
      postToExtension("START_BULK_COMMENT", {
        posts,
        text,
        verifyConfig: {
          apiBase: extensionApiBase(),
          email_member: email,
          id_social_account: extra.id_social_account || undefined,
          id_platform: extra.id_platform,
        },
      });
    },
    [email],
  );

  const stop = useCallback(() => {
    setStopping(true);
    postToExtension("STOP_BULK_COMMENT");
  }, []);

  // Comment hẹn giờ (Facebook): khi trang đang mở + extension sẵn sàng, tới giờ thì tự chạy
  // từng comment một (giữ đúng nội dung + tài khoản riêng của từng lịch hẹn).
  useEffect(() => {
    if (!isReady || !email) return;
    const poll = async () => {
      if (isCommentingRef.current) return;
      try {
        const res = await scheduledCommentService.getAll({ status: "pending", platform: "facebook", page: 1, limit: 50 });
        const due = (res.data || []).filter(
          (sc) => !processingScheduledRef.current.has(sc.id) && new Date(sc.scheduled_at) <= new Date(),
        );
        if (due.length === 0 || isCommentingRef.current) return;
        const item = due[0];
        processingScheduledRef.current.add(item.id);
        runRef.current = { kind: "scheduled", urls: [item.post_url], scheduledId: item.id };
        setCommenting(true);
        postToExtension("START_BULK_COMMENT", {
          posts: [{ url: item.post_url, id_post: item.id_post_fb, id_platform: PLATFORM_DB_ID.facebook }],
          text: item.comment_content || "",
          verifyConfig: {
            apiBase: extensionApiBase(),
            email_member: email,
            id_social_account: item.id_social_account || undefined,
            id_platform: PLATFORM_DB_ID.facebook,
          },
        });
      } catch {
        // thử lại ở lượt poll kế tiếp
      }
    };
    const interval = window.setInterval(poll, 10000);
    return () => window.clearInterval(interval);
  }, [isReady, email]);

  return { isCommenting, progress, stopping, lastError, start, stop };
}
