"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Globe,
  Lock,
  Play,
  RefreshCw,
  RotateCw,
  Save,
  ShieldCheck,
  Square,
  Terminal,
  Zap,
} from "lucide-react";

import { useAppAuth } from "@/contexts/AppAuthContext";
import { cn } from "@/lib/utils";
import { publicCrawlerService } from "@/services/public-crawler.service";
import type {
  ThreadsKeywordLibraryItem,
  ProxyTestResponse,
  PublicCrawlConfig,
  PublicCrawlGroupItem,
  PublicCrawlStatusResponse,
} from "@/types/public-crawler";

type NumericConfigField =
  | "groups_per_ip_rotate"
  | "cycle_interval_min"
  | "concurrent_sims"
  | "max_posts_per_group"
  | "max_scrolls_per_group"
  | "threads_keyword_target"
  | "threads_max_posts_per_keyword"
  | "threads_max_age_days";

const PUBLIC_CRAWL_LIMITS: Record<
  NumericConfigField,
  { min: number; max: number; fallback: number; label: string }
> = {
  groups_per_ip_rotate: {
    min: 1,
    max: 6,
    fallback: 6,
    label: "Xoay IP sau mỗi (nhóm/từ khóa)",
  },
  cycle_interval_min: {
    min: 0,
    max: 1440,
    fallback: 0,
    label: "Chu kỳ nghỉ giữa các vòng (phút)",
  },
  concurrent_sims: {
    min: 1,
    max: 4,
    fallback: 1,
    label: "Số luồng Proxy song song",
  },
  max_posts_per_group: {
    min: 1,
    max: 25,
    fallback: 25,
    label: "Số bài tối đa / nhóm",
  },
  max_scrolls_per_group: {
    min: 0,
    max: 3,
    fallback: 2,
    label: "Độ sâu phân trang (0 = 1 bài)",
  },
  threads_keyword_target: {
    min: 5,
    max: 50,
    fallback: 30,
    label: "Số từ khóa AI Threads / vòng",
  },
  threads_max_posts_per_keyword: {
    min: 5,
    max: 30,
    fallback: 20,
    label: "Số bài Threads / từ khóa",
  },
  threads_max_age_days: {
    min: 1,
    max: 30,
    fallback: 7,
    label: "Giới hạn tuổi bài Threads (ngày)",
  },
};

const NUMERIC_CONFIG_FIELDS: NumericConfigField[] = [
  "groups_per_ip_rotate",
  "cycle_interval_min",
  "concurrent_sims",
  "max_posts_per_group",
  "max_scrolls_per_group",
  "threads_keyword_target",
  "threads_max_posts_per_keyword",
  "threads_max_age_days",
];

function getNumericBounds(
  field: NumericConfigField,
  maxConcurrentByProxy: number,
): { min: number; max: number } {
  const base = PUBLIC_CRAWL_LIMITS[field];
  if (field === "concurrent_sims") {
    return {
      min: base.min,
      max: Math.min(base.max, Math.max(1, maxConcurrentByProxy)),
    };
  }
  return { min: base.min, max: base.max };
}

function clampNumericField(
  field: NumericConfigField,
  raw: unknown,
  maxConcurrentByProxy: number,
): { value: number; adjustedNote: string | null } {
  const { min, max } = getNumericBounds(field, maxConcurrentByProxy);
  const meta = PUBLIC_CRAWL_LIMITS[field];
  const parsed = typeof raw === "string" ? Number(raw.trim()) : Number(raw);
  if (raw === "" || raw === null || raw === undefined || !Number.isFinite(parsed)) {
    const safeFallback = Math.max(min, Math.min(max, meta.fallback));
    return { value: safeFallback, adjustedNote: null };
  }
  const intVal = Math.trunc(parsed);
  const clamped = Math.max(min, Math.min(max, intVal));
  if (clamped !== intVal) {
    return {
      value: clamped,
      adjustedNote: `${meta.label} được giới hạn an toàn trong khoảng ${min}–${max} (đã khớp về ${clamped}).`,
    };
  }
  return { value: clamped, adjustedNote: null };
}

function configToNumberStrings(
  cfg: PublicCrawlConfig,
  maxConcurrentByProxy: number,
): Record<NumericConfigField, string> {
  return {
    groups_per_ip_rotate: String(
      clampNumericField("groups_per_ip_rotate", cfg.groups_per_ip_rotate, maxConcurrentByProxy).value,
    ),
    cycle_interval_min: String(
      clampNumericField("cycle_interval_min", cfg.cycle_interval_min, maxConcurrentByProxy).value,
    ),
    concurrent_sims: String(
      clampNumericField("concurrent_sims", cfg.concurrent_sims, maxConcurrentByProxy).value,
    ),
    max_posts_per_group: String(
      clampNumericField("max_posts_per_group", cfg.max_posts_per_group, maxConcurrentByProxy).value,
    ),
    max_scrolls_per_group: String(
      clampNumericField("max_scrolls_per_group", cfg.max_scrolls_per_group, maxConcurrentByProxy).value,
    ),
    threads_keyword_target: String(
      clampNumericField("threads_keyword_target", cfg.threads_keyword_target, maxConcurrentByProxy).value,
    ),
    threads_max_posts_per_keyword: String(
      clampNumericField("threads_max_posts_per_keyword", cfg.threads_max_posts_per_keyword, maxConcurrentByProxy).value,
    ),
    threads_max_age_days: String(
      clampNumericField("threads_max_age_days", cfg.threads_max_age_days, maxConcurrentByProxy).value,
    ),
  };
}

function sanitizeConfigObject(
  cfg: PublicCrawlConfig,
  maxConcurrentByProxy: number,
): PublicCrawlConfig {
  return {
    ...cfg,
    groups_per_ip_rotate: clampNumericField(
      "groups_per_ip_rotate",
      cfg.groups_per_ip_rotate,
      maxConcurrentByProxy,
    ).value,
    cycle_interval_min: clampNumericField(
      "cycle_interval_min",
      cfg.cycle_interval_min,
      maxConcurrentByProxy,
    ).value,
    concurrent_sims: clampNumericField(
      "concurrent_sims",
      cfg.concurrent_sims,
      maxConcurrentByProxy,
    ).value,
    max_posts_per_group: clampNumericField(
      "max_posts_per_group",
      cfg.max_posts_per_group,
      maxConcurrentByProxy,
    ).value,
    max_scrolls_per_group: clampNumericField(
      "max_scrolls_per_group",
      cfg.max_scrolls_per_group,
      maxConcurrentByProxy,
    ).value,
    alternating_threads_enabled: cfg.alternating_threads_enabled ?? true,
    threads_keyword_target: clampNumericField(
      "threads_keyword_target",
      cfg.threads_keyword_target,
      maxConcurrentByProxy,
    ).value,
    threads_max_posts_per_keyword: clampNumericField(
      "threads_max_posts_per_keyword",
      cfg.threads_max_posts_per_keyword,
      maxConcurrentByProxy,
    ).value,
    threads_max_age_days: clampNumericField(
      "threads_max_age_days",
      cfg.threads_max_age_days,
      maxConcurrentByProxy,
    ).value,
  };
}

const DEFAULT_CONFIG: PublicCrawlConfig = {
  id: "default",
  enabled: true,
  cycle_interval_min: 0,
  groups_per_ip_rotate: 6,
  max_posts_per_group: 25,
  max_scrolls_per_group: 2,
  concurrent_sims: 1,
  auto_skip_private: true,
  headless: true,
  alternating_threads_enabled: true,
  threads_keyword_target: 30,
  threads_max_posts_per_keyword: 20,
  threads_max_age_days: 7,
};

const LOG_TEXT_COLOR: Record<string, string> = {
  success: "text-emerald-300",
  error: "text-rose-300",
  warn: "text-amber-300",
  info: "text-slate-200",
};

function formatDateTime(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    day: "2-digit",
    month: "2-digit",
  });
}

function statusChipMeta(status?: string | null): { label: string; cls: string } {
  switch (status) {
    case "ok":
      return { label: "OK", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" };
    case "rotated_retry":
      return { label: "Đã xoay IP & OK", cls: "bg-sky-50 text-sky-700 border-sky-200" };
    case "private_skipped":
      return { label: "Nhóm kín", cls: "bg-amber-50 text-amber-700 border-amber-200" };
    case "blocked":
      return { label: "Bị chặn / Wall", cls: "bg-rose-50 text-rose-700 border-rose-200" };
    case "error":
      return { label: "Lỗi", cls: "bg-rose-50 text-rose-700 border-rose-200" };
    default:
      return { label: "Chưa chạy", cls: "bg-slate-50 text-slate-500 border-slate-200" };
  }
}

export function Public4GCrawlerPanel() {
  const { user } = useAppAuth();
  const canControl = user?.role === "admin" || user?.role === "leader";

  const [statusData, setStatusData] = useState<PublicCrawlStatusResponse | null>(null);
  const [configDraft, setConfigDraft] = useState<PublicCrawlConfig>(DEFAULT_CONFIG);
  const [numberInputs, setNumberInputs] = useState<Record<NumericConfigField, string>>(() =>
    configToNumberStrings(DEFAULT_CONFIG, 1),
  );
  const [configDirty, setConfigDirty] = useState(false);
  const configDirtyRef = useRef(false);
  useEffect(() => {
    configDirtyRef.current = configDirty;
  }, [configDirty]);

  const maxConcurrentByProxy = useMemo(() => {
    const serverCap = statusData?.config?.max_allowed_concurrent_sims;
    const byProxyCount = Math.min(
      PUBLIC_CRAWL_LIMITS.concurrent_sims.max,
      Math.max(1, (statusData?.sims || []).length),
    );
    return serverCap ? Math.min(PUBLIC_CRAWL_LIMITS.concurrent_sims.max, Math.max(1, serverCap)) : byProxyCount;
  }, [statusData?.config?.max_allowed_concurrent_sims, statusData?.sims]);

  const [groups, setGroups] = useState<PublicCrawlGroupItem[]>([]);
  const [visibilityFilter, setVisibilityFilter] = useState<"all" | "public" | "private">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [keywordsInput, setKeywordsInput] = useState("");

  const [loading, setLoading] = useState(true);
  const [savingConfig, setSavingConfig] = useState(false);
  const [savingProxies, setSavingProxies] = useState(false);
  const [proxyPoolInput, setProxyPoolInput] = useState("");
  const [showProxyEditor, setShowProxyEditor] = useState(false);
  const [triggeringRun, setTriggeringRun] = useState(false);
  const [testingProxyNode, setTestingProxyNode] = useState<string | null>(null);
  const [lastProxyTest, setLastProxyTest] = useState<ProxyTestResponse | null>(null);
  // Thư viện từ khóa Threads theo Chủ đề (mở full quyền cho member, leader, admin)
  const [threadsLibraryKeywords, setThreadsLibraryKeywords] = useState<ThreadsKeywordLibraryItem[]>([]);
  const [threadsTopics, setThreadsTopics] = useState<string[]>([
    "Website",
    "Mobile App",
    "Phần mềm & CRM",
    "Marketing & Ads",
    "AI & Automation",
    "Chung",
  ]);
  const [selectedTopic, setSelectedTopic] = useState("Website");
  const [customTopicInput, setCustomTopicInput] = useState("");
  const [newKeywordInput, setNewKeywordInput] = useState("");
  const [isAddingKeyword, setIsAddingKeyword] = useState(false);
  const [libraryFilterTopic, setLibraryFilterTopic] = useState("all");

  const [feedback, setFeedback] = useState<{ type: "success" | "error" | "info"; text: string } | null>(
    null,
  );

  const syncFormFromServer = useCallback((cfg: PublicCrawlConfig, proxyCount: number) => {
    const cap = Math.min(PUBLIC_CRAWL_LIMITS.concurrent_sims.max, Math.max(1, proxyCount));
    const clean = sanitizeConfigObject(cfg, cfg.max_allowed_concurrent_sims ?? cap);
    setConfigDraft(clean);
    setNumberInputs(configToNumberStrings(clean, cfg.max_allowed_concurrent_sims ?? cap));
    setConfigDirty(false);
  }, []);

  const loadThreadsLibrary = useCallback(async () => {
    try {
      const res = await publicCrawlerService.getThreadsKeywords();
      if (res.success && Array.isArray(res.items)) {
        setThreadsLibraryKeywords(res.items);
        if (res.topics && res.topics.length > 0) {
          setThreadsTopics(res.topics);
        }
      }
    } catch {
      // quiet fail
    }
  }, []);

  const handleAddKeywordToLibrary = async () => {
    const raw = newKeywordInput.trim();
    if (!raw) {
      setFeedback({ type: "error", text: "Vui lòng nhập từ khóa cần thêm vào thư viện Threads" });
      return;
    }
    const topicToUse = customTopicInput.trim() || selectedTopic || "Chung";
    const kws = raw.split(/[,\n]/).map((k) => k.trim()).filter(Boolean);
    if (kws.length === 0) return;

    setIsAddingKeyword(true);
    try {
      const res = await publicCrawlerService.addThreadsKeywords({
        topic: topicToUse,
        keywords: kws,
      });
      if (res.success) {
        setFeedback({
          type: "success",
          text: res.message || `Đã thêm ${kws.length} từ khóa vào chủ đề "${topicToUse}"`,
        });
        setNewKeywordInput("");
        setCustomTopicInput("");
        await loadThreadsLibrary();
      } else {
        setFeedback({ type: "error", text: res.message || "Không thể thêm từ khóa" });
      }
    } catch (err) {
      setFeedback({
        type: "error",
        text: err instanceof Error ? err.message : "Lỗi khi thêm từ khóa",
      });
    } finally {
      setIsAddingKeyword(false);
    }
  };

  const handleDeleteKeywordFromLibrary = async (kwId: string, kwName: string) => {
    try {
      const res = await publicCrawlerService.deleteThreadsKeyword(kwId);
      if (res.success) {
        setFeedback({ type: "success", text: `Đã xóa từ khóa "${kwName}" khỏi thư viện` });
        await loadThreadsLibrary();
      }
    } catch (err) {
      setFeedback({
        type: "error",
        text: err instanceof Error ? err.message : "Lỗi khi xóa từ khóa",
      });
    }
  };

  const loadAll = useCallback(
    async (syncDraft = false) => {
      try {
        const [statusRes, groupsRes] = await Promise.all([
          publicCrawlerService.getStatus(),
          publicCrawlerService.listGroups(),
        ]);
        setStatusData(statusRes);
        if (syncDraft || !configDirtyRef.current) {
          syncFormFromServer(statusRes.config, (statusRes.sims || []).length);
        }
        setGroups(groupsRes.groups || []);
        void loadThreadsLibrary();
      } catch (err) {
        setFeedback({
          type: "error",
          text: err instanceof Error ? err.message : "Không tải được trạng thái Public 4G Crawler",
        });
      } finally {
        setLoading(false);
      }
    },
    [syncFormFromServer],
  );

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      publicCrawlerService.getStatus(),
      publicCrawlerService.listGroups(),
    ])
      .then(([statusRes, groupsRes]) => {
        if (cancelled) return;
        setStatusData(statusRes);
        syncFormFromServer(statusRes.config, (statusRes.sims || []).length);
        setGroups(groupsRes.groups || []);
        void loadThreadsLibrary();
      })
      .catch((err) => {
        if (cancelled) return;
        setFeedback({
          type: "error",
          text:
            err instanceof Error
              ? err.message
              : "Không tải được trạng thái Public 4G Crawler",
        });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [syncFormFromServer]);

  // Adaptive polling: fast when running or switching rounds (2.5s), light when idle (15s)
  const isRunning = Boolean(statusData?.runtime.is_running);
  const isLoopActive = isRunning || Boolean(statusData?.runtime.continuous_waiting);
  useEffect(() => {
    const timer = window.setInterval(
      () => {
        void loadAll(false);
      },
      isLoopActive ? 2500 : 15000,
    );
    return () => window.clearInterval(timer);
  }, [isLoopActive, loadAll]);

  const filteredGroups = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return groups.filter((g) => {
      if (visibilityFilter !== "all" && g.visibility !== visibilityFilter) return false;
      if (!q) return true;
      return (
        (g.group_name || "").toLowerCase().includes(q) ||
        (g.group_url || "").toLowerCase().includes(q)
      );
    });
  }, [groups, visibilityFilter, searchQuery]);

  const publicEnabledCount = useMemo(
    () => groups.filter((g) => g.visibility === "public" && g.public_crawl_enabled).length,
    [groups],
  );
  const privateCount = useMemo(
    () => groups.filter((g) => g.visibility === "private").length,
    [groups],
  );

  const parsedKeywords = useMemo(
    () =>
      keywordsInput
        .split(/[,\n]/g)
        .map((s) => s.trim())
        .filter(Boolean),
    [keywordsInput],
  );

  const buildSanitizedDraft = useCallback(() => {
    const notes: string[] = [];
    const nextNumbers: Record<NumericConfigField, string> = { ...numberInputs };
    const nextDraft: PublicCrawlConfig = { ...configDraft };

    for (const field of NUMERIC_CONFIG_FIELDS) {
      const res = clampNumericField(field, numberInputs[field], maxConcurrentByProxy);
      nextDraft[field] = res.value;
      nextNumbers[field] = String(res.value);
      if (res.adjustedNote) notes.push(res.adjustedNote);
    }

    return { nextDraft, nextNumbers, notes };
  }, [configDraft, maxConcurrentByProxy, numberInputs]);

  const handleNumericChange = (field: NumericConfigField, raw: string) => {
    setNumberInputs((prev) => ({ ...prev, [field]: raw }));
    setConfigDirty(true);
    const trimmed = raw.trim();
    if (!trimmed) return;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return;
    const { min, max } = getNumericBounds(field, maxConcurrentByProxy);
    const intVal = Math.trunc(parsed);
    if (intVal >= min && intVal <= max) {
      setConfigDraft((prev) => ({ ...prev, [field]: intVal }));
    }
  };

  const commitNumericField = (field: NumericConfigField) => {
    const { value, adjustedNote } = clampNumericField(
      field,
      numberInputs[field],
      maxConcurrentByProxy,
    );
    setNumberInputs((prev) => ({ ...prev, [field]: String(value) }));
    setConfigDraft((prev) => ({ ...prev, [field]: value }));
    if (adjustedNote) {
      setFeedback({ type: "info", text: adjustedNote });
    }
  };

  const persistSanitizedConfig = async (): Promise<{
    config: PublicCrawlConfig;
    notes: string[];
  }> => {
    const { nextDraft, notes } = buildSanitizedDraft();
    const res = await publicCrawlerService.updateConfig({
      enabled: nextDraft.enabled,
      cycle_interval_min: nextDraft.cycle_interval_min,
      groups_per_ip_rotate: nextDraft.groups_per_ip_rotate,
      max_posts_per_group: nextDraft.max_posts_per_group,
      max_scrolls_per_group: nextDraft.max_scrolls_per_group,
      concurrent_sims: nextDraft.concurrent_sims,
      auto_skip_private: nextDraft.auto_skip_private,
      alternating_threads_enabled: nextDraft.alternating_threads_enabled ?? true,
      threads_keyword_target: nextDraft.threads_keyword_target ?? 30,
      threads_max_posts_per_keyword: nextDraft.threads_max_posts_per_keyword ?? 20,
      threads_max_age_days: nextDraft.threads_max_age_days ?? 7,
    });
    syncFormFromServer(res.config, (statusData?.sims || []).length);
    return { config: res.config, notes };
  };

  const handleSaveConfig = async () => {
    if (!canControl) return;
    setSavingConfig(true);
    setFeedback(null);
    try {
      const { config, notes } = await persistSanitizedConfig();
      const threadsLabel = config.alternating_threads_enabled
        ? `Threads AI (${config.threads_keyword_target ?? 30} từ khóa)`
        : "Threads: Tắt";
      const summary = `Đã khớp cấu hình: ${config.max_posts_per_group} bài/nhóm · sâu ${config.max_scrolls_per_group} · xoay IP/${config.groups_per_ip_rotate} · ${config.concurrent_sims} luồng · chu kỳ ${config.cycle_interval_min}p · ${threadsLabel}.`;
      setFeedback({
        type: "success",
        text: notes.length > 0 ? `${summary} (${notes.join(" ")})` : summary,
      });
      await loadAll(false);
    } catch (err) {
      setFeedback({
        type: "error",
        text: err instanceof Error ? err.message : "Lưu cấu hình thất bại",
      });
    } finally {
      setSavingConfig(false);
    }
  };

  const handleSaveProxies = async () => {
    if (!canControl) return;
    setSavingProxies(true);
    setFeedback(null);
    try {
      const lines = proxyPoolInput
        .split(/[\r\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await publicCrawlerService.updateConfig({ proxy_urls: lines });
      syncFormFromServer(res.config, lines.length);
      setProxyPoolInput("");
      setShowProxyEditor(false);
      setFeedback({
        type: "success",
        text:
          lines.length > 0
            ? `Đã lưu ${lines.length} Proxy Xoay Tự Động vào hệ thống.`
            : "Đã xóa danh sách Proxy cấu hình trong DB.",
      });
      await loadAll(false);
    } catch (err) {
      setFeedback({
        type: "error",
        text: err instanceof Error ? err.message : "Lưu danh sách Proxy thất bại",
      });
    } finally {
      setSavingProxies(false);
    }
  };

  const handleRunNow = async (
    onlySelected = false,
    limitGroups?: number,
    platform: "auto" | "facebook" | "threads" = "auto",
  ) => {
    if (!canControl) return;
    setTriggeringRun(true);
    setFeedback(null);
    try {
      let autoSavedText = "";
      if (configDirtyRef.current) {
        const { config } = await persistSanitizedConfig();
        autoSavedText = ` (Đã tự đồng bộ: ${config.max_posts_per_group} bài · sâu ${config.max_scrolls_per_group} · ${config.concurrent_sims} luồng)`;
      }
      const group_ids = onlySelected && selectedIds.size > 0 ? Array.from(selectedIds) : undefined;
      const res = await publicCrawlerService.runNow({
        group_ids,
        keywords: parsedKeywords.length > 0 ? parsedKeywords : undefined,
        limit_groups: limitGroups,
        platform,
      });
      if (res.started) {
        const runPlatformLabel =
          platform === "threads"
            ? `${res.total_groups ?? 0} từ khóa Threads (No-Acc)`
            : `${res.total_groups ?? 0} nhóm Public`;
        setFeedback({
          type: "success",
          text:
            (limitGroups
              ? `Đang Test Cào Nhanh ${runPlatformLabel} bằng ${(res.sim_nodes || []).join(", ")} (0% Cookie).`
              : `Đã khởi chạy cào ${runPlatformLabel} bằng ${(res.sim_nodes || []).join(", ")} (0% Cookie).`) +
            autoSavedText,
        });
      } else {
        setFeedback({
          type: "info",
          text: res.message || `Không thể khởi chạy (${res.reason || "unknown"}).`,
        });
      }
      await loadAll(false);
    } catch (err) {
      setFeedback({
        type: "error",
        text: err instanceof Error ? err.message : "Lỗi khởi chạy Public 4G Crawler",
      });
    } finally {
      setTriggeringRun(false);
    }
  };

  const handleStop = async () => {
    if (!canControl) return;
    try {
      const res = await publicCrawlerService.stop();
      setFeedback({
        type: res.stopped ? "info" : "error",
        text: res.stopped
          ? "Đã gửi lệnh dừng an toàn — phiên sẽ dừng ngay sau nhóm hiện tại."
          : res.message || "Không có phiên nào đang chạy.",
      });
      await loadAll(false);
    } catch (err) {
      setFeedback({
        type: "error",
        text: err instanceof Error ? err.message : "Lỗi khi gửi lệnh dừng",
      });
    }
  };

  const handleTestProxy = async (nodeId?: string, doRotate = false) => {
    if (!canControl) return;
    setTestingProxyNode(`${nodeId || "all"}:${doRotate ? "rot" : "probe"}`);
    setFeedback(null);
    try {
      const res = await publicCrawlerService.testProxy({ node_id: nodeId, do_rotate: doRotate });
      setLastProxyTest(res);
      const first = res.results?.[0];
      if (res.ok && first) {
        const curIp = first.egressIpAfter || first.egressIpBefore || "?";
        const fbTag = first.fbStatus
          ? ` | FB Guest: HTTP ${first.fbStatus}${first.fbOk ? " OK" : " (đang 302, chờ chu kỳ 60s)"}`
          : "";
        const ipNote = doRotate
          ? `IP trước ${first.egressIpBefore || "?"} -> sau ${first.egressIpAfter || "?"} (${first.ipChanged ? "ĐÃ ĐỔI IP MỚI" : "Chưa qua chu kỳ 60s"})`
          : `IP hiện tại ${curIp} (${first.latencyMs ?? "?"}ms)${fbTag}`;
        setFeedback({
          type: "success",
          text: `${first.label}: Proxy ${first.socksOk ? "OK" : "Lỗi"} | ${ipNote}`,
        });
      } else {
        setFeedback({
          type: "error",
          text: res.error || first?.error || "Test kết nối Proxy Xoay thất bại.",
        });
      }
      await loadAll(false);
    } catch (err) {
      setFeedback({
        type: "error",
        text: err instanceof Error ? err.message : "Lỗi kiểm tra Proxy Xoay",
      });
    } finally {
      setTestingProxyNode(null);
    }
  };

  const handleToggleGroup = async (
    group: PublicCrawlGroupItem,
    patch: { visibility?: "public" | "private"; public_crawl_enabled?: boolean },
  ) => {
    if (!canControl) return;
    try {
      const res = await publicCrawlerService.updateGroup(group.id, patch);
      setGroups((prev) =>
        prev.map((item) => (item.id === group.id ? { ...item, ...res.group } : item)),
      );
    } catch (err) {
      setFeedback({
        type: "error",
        text: err instanceof Error ? err.message : "Cập nhật nhóm thất bại",
      });
    }
  };

  const handleBulkToggle = async (enabled: boolean) => {
    if (!canControl || selectedIds.size === 0) return;
    try {
      await publicCrawlerService.bulkToggleGroups({
        group_ids: Array.from(selectedIds),
        public_crawl_enabled: enabled,
      });
      setSelectedIds(new Set());
      await loadAll(false);
    } catch (err) {
      setFeedback({
        type: "error",
        text: err instanceof Error ? err.message : "Cập nhật hàng loạt thất bại",
      });
    }
  };

  const sims = statusData?.sims || [];
  const runtime = statusData?.runtime;
  const logs = statusData?.logs || [];
  const recentRuns = statusData?.recent_runs || [];

  const allVisibleSelected =
    filteredGroups.length > 0 && filteredGroups.every((g) => selectedIds.has(g.id));

  return (
    <div className="space-y-6">
      {/* Banner Zero-Account & Minh bạch phạm vi */}
      <div className="rounded-2xl border border-emerald-200 bg-gradient-to-r from-emerald-50/90 via-teal-50/70 to-sky-50/80 p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-black bg-emerald-600 text-white">
              <ShieldCheck className="size-3.5" /> 0% BAN ACC — CHẾ ĐỘ KHÁCH KHÔNG COOKIE
            </span>
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-sky-100 text-sky-800 border border-sky-200">
              <Zap className="size-3" /> HTTPX SSR (~1s) + Playwright Fallback · Proxy Tự Xoay 60s
            </span>
          </div>
          <h2 className="text-base font-black text-slate-900">
            Cào Facebook Public &amp; Threads No-Acc Luân Phiên 24/24 Qua Proxy Xoay 4G
          </h2>
          <p className="text-xs text-slate-600 max-w-3xl leading-relaxed">
            Hoạt động 100% ở chế độ Khách không cookie: chạy hết nhóm Facebook Public (ưu tiên nhóm mới thêm) rồi tự
            chuyển sang cào <span className="font-semibold text-slate-800">Threads ~30 từ khóa AI tự biến đổi</span>{" "}
            trên chính Proxy Xoay 4G, lặp lại liên tục 24/24 (chỉ dừng khi Proxy hết hạn).{" "}
            <span className="font-semibold text-slate-800">Nhóm kín (Private)</span> tự động bỏ qua để dùng Extension.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            disabled={!canControl || sims.length === 0 || testingProxyNode !== null}
            onClick={() => void handleTestProxy(undefined, false)}
            className="px-3.5 py-2 rounded-xl text-xs font-bold border border-sky-300 bg-white hover:bg-sky-50 disabled:opacity-50 text-sky-700 shadow-xs flex items-center gap-1.5 cursor-pointer transition"
          >
            <RotateCw className={cn("size-3.5", testingProxyNode !== null && "animate-spin")} />
            {testingProxyNode === "all:probe" ? "Đang kiểm tra..." : "Kiểm tra Proxy Xoay (1 Bấm)"}
          </button>
          {!isLoopActive ? (
            <>
              <button
                type="button"
                disabled={!canControl || triggeringRun || publicEnabledCount === 0}
                onClick={() => void handleRunNow(false, 3, "facebook")}
                className="px-3.5 py-2 rounded-xl text-xs font-bold border border-emerald-300 bg-white hover:bg-emerald-50 disabled:opacity-50 text-emerald-700 shadow-xs flex items-center gap-1.5 cursor-pointer transition"
              >
                <Zap className="size-3.5" />
                {triggeringRun ? "Đang khởi chạy..." : "Test Nhanh 3 Nhóm FB"}
              </button>
              <button
                type="button"
                disabled={!canControl || triggeringRun}
                onClick={() => void handleRunNow(false, 5, "threads")}
                className="px-3.5 py-2 rounded-xl text-xs font-bold border border-purple-300 bg-white hover:bg-purple-50 disabled:opacity-50 text-purple-700 shadow-xs flex items-center gap-1.5 cursor-pointer transition"
              >
                <Zap className="size-3.5" />
                {triggeringRun ? "Đang khởi chạy..." : "Test Nhanh Threads (5 từ khóa)"}
              </button>
              <button
                type="button"
                disabled={!canControl || triggeringRun}
                onClick={() => void handleRunNow(false)}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white shadow-xs flex items-center gap-1.5 cursor-pointer transition"
              >
                <Play className="size-3.5" />
                {triggeringRun ? "Đang khởi chạy..." : `Chạy ngay (${publicEnabledCount} nhóm Public)`}
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={!canControl}
              onClick={() => void handleStop()}
              className="px-4 py-2 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white shadow-xs flex items-center gap-1.5 cursor-pointer transition"
            >
              <Square className="size-3.5" />
              {runtime?.stop_requested ? "Đang dừng..." : "Dừng an toàn"}
            </button>
          )}
          <button
            type="button"
            onClick={() => void loadAll(false)}
            className="px-3 py-2 rounded-xl text-xs font-bold border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 flex items-center gap-1.5 cursor-pointer transition"
          >
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
            Làm mới
          </button>
        </div>
      </div>

      {!canControl && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs font-medium text-amber-800">
          Bạn đang xem ở chế độ chỉ đọc. Chỉ tài khoản <strong>Admin</strong> hoặc{" "}
          <strong>Leader</strong> mới có quyền bấm Chạy/Dừng, cấu hình xoay IP SIM 4G hoặc đổi trạng thái Public/Private.
        </div>
      )}

      {feedback && (
        <div
          className={cn(
            "rounded-xl border px-4 py-2.5 text-xs font-semibold flex items-center justify-between gap-2",
            feedback.type === "success" && "bg-emerald-50 border-emerald-200 text-emerald-800",
            feedback.type === "error" && "bg-rose-50 border-rose-200 text-rose-800",
            feedback.type === "info" && "bg-sky-50 border-sky-200 text-sky-800",
          )}
        >
          <span>{feedback.text}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-[11px] opacity-70 hover:opacity-100 cursor-pointer"
          >
            Đóng
          </button>
        </div>
      )}

      {lastProxyTest && (
        <div className="rounded-2xl border border-sky-200 bg-sky-50/60 p-4 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-black text-slate-900 flex items-center gap-1.5">
              <Globe className="size-4 text-sky-600" />
              Kết quả Kiểm tra Proxy Xoay Tự Động
            </div>
            <button
              type="button"
              onClick={() => setLastProxyTest(null)}
              className="text-[11px] font-semibold text-slate-500 hover:text-slate-800 cursor-pointer"
            >
              Đóng
            </button>
          </div>
          {lastProxyTest.results.length === 0 ? (
            <div className="text-xs text-rose-700 font-semibold">
              {lastProxyTest.error || "Chưa cấu hình proxy xoay nào."}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {lastProxyTest.results.map((r) => (
                <div
                  key={r.id}
                  className="rounded-xl border border-slate-200 bg-white p-3 text-xs space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-black text-slate-900">
                      {r.label} <span className="font-mono text-[10px] text-slate-500">({r.id})</span>
                    </span>
                    {r.rotated ? (
                      <span
                        className={cn(
                          "px-2 py-0.5 rounded-full text-[10px] font-bold border",
                          r.ipChanged
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                            : "bg-amber-50 text-amber-700 border-amber-200",
                        )}
                      >
                        {r.ipChanged ? "Đã tự đổi IP mới" : "Chưa qua chu kỳ 60s"}
                      </span>
                    ) : (
                      <span
                        className={cn(
                          "px-2 py-0.5 rounded-full text-[10px] font-bold border",
                          r.socksOk
                            ? "bg-sky-50 text-sky-700 border-sky-200"
                            : "bg-rose-50 text-rose-700 border-rose-200",
                        )}
                      >
                        {r.socksOk ? "Tunnel OK" : "Lỗi kết nối"}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-700">
                    <span>
                      IP:{" "}
                      <strong className="font-mono text-slate-900">
                        {r.egressIpBefore || "—"}
                      </strong>
                    </span>
                    {r.egressIpAfter && r.egressIpAfter !== r.egressIpBefore && (
                      <span>
                        → IP mới:{" "}
                        <strong className="font-mono text-emerald-700">
                          {r.egressIpAfter}
                        </strong>
                      </span>
                    )}
                    {r.latencyMs != null && (
                      <span className="text-slate-500">· {r.latencyMs}ms</span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                    <span
                      className={cn(
                        "px-1.5 py-0.5 rounded font-bold",
                        r.socksOk ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700",
                      )}
                    >
                      Proxy Tunnel: {r.socksOk ? "OK" : "Lỗi"}
                    </span>
                    <span
                      className={cn(
                        "px-1.5 py-0.5 rounded font-bold",
                        r.fbOk
                          ? "bg-emerald-50 text-emerald-700"
                          : r.fbStatus === 302
                            ? "bg-amber-50 text-amber-700"
                            : "bg-slate-100 text-slate-600",
                      )}
                    >
                      FB Guest: {r.fbOk ? `HTTP ${r.fbStatus} OK` : r.fbStatus ? `HTTP ${r.fbStatus} (Chờ xoay 60s)` : "N/A"}
                    </span>
                    <span className="px-1.5 py-0.5 rounded font-bold bg-sky-50 text-sky-700">
                      Tự xoay mỗi 60s
                    </span>
                  </div>
                  {r.error && <div className="text-[11px] text-rose-600 font-medium">{r.error}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Proxy Expired Critical Banner */}
      {runtime?.auto_pause_reason === "proxy_expired" && (
        <div className="rounded-2xl border-2 border-rose-300 bg-rose-50 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <AlertTriangle className="size-5 text-rose-600 shrink-0 mt-0.5" />
            <div className="space-y-1 text-xs">
              <div className="font-black text-rose-900">
                AUTO CÀO 24/24 ĐÃ TỰ DỪNG VÌ PROXY 4G HẾT HẠN / LỖI XÁC THỰC
              </div>
              <p className="text-rose-800 leading-relaxed">
                {runtime.proxy_expired_error ||
                  "Tất cả proxy trong pool đều không thể kết nối hoặc từ chối xác thực SOCKS5."}
              </p>
              <p className="text-rose-700">
                Dán Proxy mới và bấm <strong>Lưu danh sách Proxy</strong> để hệ thống tự phục hồi chạy tiếp 24/24.
              </p>
            </div>
          </div>
          {canControl && (
            <button
              type="button"
              onClick={() => setShowProxyEditor(true)}
              className="px-3.5 py-2 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white shrink-0 cursor-pointer"
            >
              Cập nhật Proxy ngay
            </button>
          )}
        </div>
      )}

      {/* Telemetry KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="rounded-xl border border-slate-200 bg-white p-3.5">
          <div className="text-[11px] font-bold text-slate-500 uppercase flex items-center justify-between gap-1">
            <span>Trạng thái {runtime?.loop_round ? `· Vòng #${runtime.loop_round}` : ""}</span>
            {runtime?.current_platform && (
              <span
                className={cn(
                  "px-1.5 py-0.5 rounded text-[10px] font-black",
                  runtime.current_platform === "both"
                    ? "bg-gradient-to-r from-sky-100 to-purple-100 text-purple-900 border border-purple-200"
                    : runtime.current_platform === "threads"
                      ? "bg-purple-100 text-purple-800"
                      : "bg-sky-100 text-sky-800",
                )}
              >
                {runtime.current_platform === "both"
                  ? "⚡ SONG SONG: FB + THREADS"
                  : runtime.current_platform === "threads"
                    ? "THREADS"
                    : "FACEBOOK"}
              </span>
            )}
          </div>
          <div className="mt-1 flex items-center gap-2 text-sm font-black text-slate-900">
            <span
              className={cn(
                "size-2.5 rounded-full shrink-0",
                runtime?.auto_pause_reason === "proxy_expired"
                  ? "bg-rose-500"
                  : isLoopActive
                    ? "bg-emerald-500 animate-pulse"
                    : "bg-slate-300",
              )}
            />
            {isRunning
              ? runtime?.current_platform === "both"
                ? `⚡ Song Song (FB + Threads) · (${runtime?.completed_groups ?? 0}/${runtime?.total_groups ?? 0})`
                : `${runtime?.current_platform === "threads" ? "Threads" : "FB"} (${runtime?.completed_groups ?? 0}/${runtime?.total_groups ?? 0})`
              : runtime?.continuous_waiting
                ? `Chuyển pha → ${runtime?.next_platform === "threads" ? "Threads AI" : "Facebook"}...`
                : runtime?.auto_pause_reason === "proxy_expired"
                  ? "Dừng: Proxy hết hạn"
                  : configDraft.enabled && configDraft.cycle_interval_min === 0
                    ? "Auto 24/24 · Sẵn sàng"
                    : "Sẵn sàng"}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3.5">
          <div className="text-[11px] font-bold text-slate-500 uppercase">Nhóm Public / Private</div>
          <div className="mt-1 text-sm font-black text-slate-900">
            <span className="text-sky-700">{publicEnabledCount} Public</span>{" "}
            <span className="text-slate-400 font-semibold">/ {privateCount} Private</span>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3.5">
          <div className="text-[11px] font-bold text-slate-500 uppercase">Bài mới phiên này</div>
          <div className="mt-1 text-sm font-black text-emerald-700">
            +{runtime?.posts_saved ?? 0} bài
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3.5">
          <div className="text-[11px] font-bold text-slate-500 uppercase">Tốc độ trung bình</div>
          <div className="mt-1 text-sm font-black text-slate-900">
            {runtime?.avg_ms_per_group
              ? `${(runtime.avg_ms_per_group / 1000).toFixed(1)} giây/nhóm`
              : "—"}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3.5">
          <div className="text-[11px] font-bold text-slate-500 uppercase">Số lần xoay IP 4G</div>
          <div className="mt-1 text-sm font-black text-indigo-700">
            {runtime?.ip_rotations ?? 0} lần
          </div>
        </div>
      </div>

      {/* Pool Proxy Xoay Tự Động + Cấu hình */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        {/* Pool Proxy Xoay */}
        <div className="xl:col-span-5 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-black text-slate-900 flex items-center gap-1.5">
              <Globe className="size-4 text-sky-600" /> Pool Proxy Xoay Tự Động ({sims.length} proxy)
            </h3>
            <div className="flex items-center gap-1.5">
              {canControl && (
                <button
                  type="button"
                  onClick={() => setShowProxyEditor((prev) => !prev)}
                  className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-sky-50 border border-sky-200 hover:bg-sky-100 text-sky-700 cursor-pointer"
                >
                  {showProxyEditor ? "Đóng ô nhập" : sims.length === 0 ? "+ Gắn Proxy Xoay" : "Đổi / Thêm Proxy"}
                </button>
              )}
              <button
                type="button"
                disabled={!canControl || sims.length === 0 || testingProxyNode !== null}
                onClick={() => void handleTestProxy(undefined, false)}
                className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-white border border-slate-200 hover:bg-slate-100 disabled:opacity-50 text-slate-700 cursor-pointer"
              >
                {testingProxyNode === "all:probe" ? "Đang test..." : "Kiểm tra nhanh"}
              </button>
            </div>
          </div>

          {(showProxyEditor || sims.length === 0) && canControl && (
            <div className="rounded-xl border border-sky-200 bg-white p-3 space-y-2">
              <div className="text-[11px] font-bold text-slate-700">
                Dán Proxy Xoay (mỗi dòng 1 proxy — hỗ trợ <code className="bg-slate-100 px-1 rounded">host:port:user:pass</code>,{" "}
                <code className="bg-slate-100 px-1 rounded">socks5://user:pass@host:port</code> hoặc{" "}
                <code className="bg-slate-100 px-1 rounded">http://...</code>)
              </div>
              <textarea
                rows={3}
                value={proxyPoolInput}
                onChange={(e) => setProxyPoolInput(e.target.value)}
                placeholder={"203.0.113.10:1080:username:password\n(để trống rồi bấm Lưu nếu muốn xóa pool)"}
                className="w-full rounded-lg border border-slate-200 p-2 font-mono text-[11px] focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-slate-500">
                  Mật khẩu được mã hóa/che an toàn trên UI sau khi lưu.
                </span>
                <button
                  type="button"
                  disabled={savingProxies}
                  onClick={() => void handleSaveProxies()}
                  className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-sky-600 hover:bg-sky-700 text-white disabled:opacity-50 flex items-center gap-1 cursor-pointer"
                >
                  <Save className="size-3" />
                  {savingProxies ? "Đang lưu..." : "Lưu danh sách Proxy"}
                </button>
              </div>
            </div>
          )}

          {sims.length === 0 ? (
            <div className="rounded-xl border border-dashed border-amber-300 bg-amber-50/70 p-4 text-xs text-amber-800 space-y-1">
              <div className="font-bold">Chưa có Proxy Xoay nào trong cấu hình DB.</div>
              <p>
                Dán dòng <code className="bg-amber-100 px-1 rounded">host:port:user:pass</code> vào ô phía trên và bấm <strong>Lưu danh sách Proxy</strong> để chạy ngay (không dùng Mobile Phone Bridge).
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {sims.map((sim) => (
                <div
                  key={sim.id}
                  className="rounded-xl border border-slate-200 bg-white p-3 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs font-black text-slate-900 flex items-center gap-1.5 truncate">
                        {sim.label}
                        <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                          {sim.id}
                        </span>
                      </div>
                      {sim.maskedUrl && (
                        <div className="font-mono text-[10px] text-slate-400 truncate mt-0.5">
                          {sim.maskedUrl}
                        </div>
                      )}
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        IP hiện tại:{" "}
                        <span className="font-mono font-bold text-slate-800">
                          {sim.last_egress_ip || "Chưa probe"}
                        </span>
                        {sim.last_latency_ms != null && (
                          <span className="text-slate-400"> · {sim.last_latency_ms}ms</span>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={!canControl || testingProxyNode !== null}
                      onClick={() => void handleTestProxy(sim.id, true)}
                      title="Chờ và kiểm chứng chu kỳ tự đổi IP (tối đa 65s)"
                      className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-sky-50 text-sky-700 border border-sky-200 hover:bg-sky-100 disabled:opacity-50 flex items-center gap-1 cursor-pointer shrink-0"
                    >
                      <RotateCw
                        className={cn(
                          "size-3",
                          testingProxyNode === `${sim.id}:rot` && "animate-spin",
                        )}
                      />
                      {testingProxyNode === `${sim.id}:rot` ? "Đang đo 60s..." : "Đo đổi IP (60s)"}
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                    {sim.platform && (
                      <span
                        className={cn(
                          "px-2 py-0.5 rounded font-black border uppercase tracking-wider",
                          sim.platform === "facebook"
                            ? "bg-sky-100 text-sky-800 border-sky-300"
                            : "bg-purple-100 text-purple-800 border-purple-300",
                        )}
                      >
                        {sim.platform === "facebook" ? "🎯 CHUYÊN FB (:4434)" : "🎯 CHUYÊN THREADS (:4554)"}
                      </span>
                    )}
                    <span
                      className={cn(
                        "px-2 py-0.5 rounded font-bold border",
                        sim.hasSocks
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                          : "bg-rose-50 text-rose-700 border-rose-200",
                      )}
                    >
                      Tunnel {(sim.scheme || "socks5").toUpperCase()}: {sim.hasSocks ? "Sẵn sàng" : "Thiếu URL"}
                    </span>
                    <span className="px-2 py-0.5 rounded font-bold border bg-sky-50 text-sky-700 border-sky-200">
                      Tự xoay: 60s/lần
                    </span>
                    {sim.last_fb_status != null && (
                      <span
                        className={cn(
                          "px-2 py-0.5 rounded font-bold border",
                          sim.last_fb_status === 200
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                            : "bg-amber-50 text-amber-700 border-amber-200",
                        )}
                      >
                        FB Guest: HTTP {sim.last_fb_status}
                      </span>
                    )}
                    <span
                      className={cn(
                        "px-2 py-0.5 rounded font-bold border",
                        sim.status === "expired"
                          ? "bg-rose-100 text-rose-800 border-rose-300"
                          : sim.status === "crawling"
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                            : "bg-slate-100 text-slate-700 border-slate-200",
                      )}
                    >
                      Trạng thái: {sim.status === "expired" ? "Hết hạn / Lỗi Auth" : sim.status}
                    </span>
                  </div>
                  {sim.last_error && (
                    <div className="text-[11px] text-rose-600 font-medium">{sim.last_error}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Form Cấu hình & Auto Liên Tục */}
        <div className="xl:col-span-7 rounded-2xl border border-slate-200 bg-white p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-black text-slate-900 flex items-center gap-1.5">
              <Activity className="size-4 text-emerald-600" /> Cấu hình Chạy Liên Tục &amp; Xoay IP 4G
            </h3>
            <label className="inline-flex items-center gap-2 cursor-pointer text-xs font-bold text-slate-800">
              <input
                type="checkbox"
                disabled={!canControl}
                checked={configDraft.enabled}
                onChange={(e) => {
                  setConfigDraft((prev) => ({ ...prev, enabled: e.target.checked }));
                  setConfigDirty(true);
                }}
                className="size-4 accent-emerald-600 rounded"
              />
              Bật Auto Cào Liên Tục 24/24
            </label>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <label
              className="space-y-1 text-xs"
              title="Giới hạn an toàn 1–6 nhóm/lần reset phiên. Chỉnh thấp hơn (2–4) giúp proxy xoay 60s ít chạm tường 302."
            >
              <span className="font-bold text-slate-600 block">
                Xoay IP sau mỗi (nhóm){" "}
                <span className="font-normal text-[10px] text-slate-400">(1–6)</span>
              </span>
              <input
                type="number"
                min={PUBLIC_CRAWL_LIMITS.groups_per_ip_rotate.min}
                max={PUBLIC_CRAWL_LIMITS.groups_per_ip_rotate.max}
                disabled={!canControl}
                value={numberInputs.groups_per_ip_rotate}
                onChange={(e) => handleNumericChange("groups_per_ip_rotate", e.target.value)}
                onBlur={() => commitNumericField("groups_per_ip_rotate")}
                className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold"
              />
            </label>
            <label
              className="space-y-1 text-xs"
              title="Đặt 0 phút để chạy xoay vòng liên tục 24/24 không nghỉ (tự nạp lại nhóm mới mỗi vòng); tăng 1–1440 nếu muốn nghỉ giữa các vòng."
            >
              <span className="font-bold text-slate-600 block">
                Chu kỳ nghỉ (phút){" "}
                <span className="font-normal text-[10px] text-emerald-700">(0 = 24/24 liên tục)</span>
              </span>
              <input
                type="number"
                min={PUBLIC_CRAWL_LIMITS.cycle_interval_min.min}
                max={PUBLIC_CRAWL_LIMITS.cycle_interval_min.max}
                disabled={!canControl}
                value={numberInputs.cycle_interval_min}
                onChange={(e) => handleNumericChange("cycle_interval_min", e.target.value)}
                onBlur={() => commitNumericField("cycle_interval_min")}
                className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold"
              />
            </label>
            <label
              className="space-y-1 text-xs"
              title={`Tự khớp theo số proxy trong Pool (hiện có ${sims.length} proxy, trần tối đa ${PUBLIC_CRAWL_LIMITS.concurrent_sims.max}).`}
            >
              <span className="font-bold text-slate-600 block">
                Số luồng Proxy song song{" "}
                <span className="font-normal text-[10px] text-slate-400">
                  ({maxConcurrentByProxy === 1 ? "khớp 1 proxy" : `1–${maxConcurrentByProxy}`})
                </span>
              </span>
              <input
                type="number"
                min={1}
                max={maxConcurrentByProxy}
                disabled={!canControl || maxConcurrentByProxy <= 1}
                value={numberInputs.concurrent_sims}
                onChange={(e) => handleNumericChange("concurrent_sims", e.target.value)}
                onBlur={() => commitNumericField("concurrent_sims")}
                className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold disabled:bg-slate-50 disabled:text-slate-500"
              />
            </label>
            <label
              className="space-y-1 text-xs"
              title="Trần an toàn tối đa 25 bài/nhóm (khuyên dùng 15–20 bài). Không cho chỉnh căng hơn 25 để tránh cháy IP 60s."
            >
              <span className="font-bold text-slate-600 block">
                Số bài tối đa / nhóm{" "}
                <span className="font-normal text-[10px] text-slate-400">(1–25)</span>
              </span>
              <input
                type="number"
                min={PUBLIC_CRAWL_LIMITS.max_posts_per_group.min}
                max={PUBLIC_CRAWL_LIMITS.max_posts_per_group.max}
                disabled={!canControl}
                value={numberInputs.max_posts_per_group}
                onChange={(e) => handleNumericChange("max_posts_per_group", e.target.value)}
                onBlur={() => commitNumericField("max_posts_per_group")}
                className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold"
              />
            </label>
            <label
              className="space-y-1 text-xs"
              title="0: quét nhanh SSR 1–3 bài (~1s); 1: nhẹ (~4 trang, ~12 bài); 2: chuẩn (~20–25 bài); 3: tối đa (~10 trang GraphQL)."
            >
              <span className="font-bold text-slate-600 block">
                Độ sâu phân trang (0 = 1 bài){" "}
                <span className="font-normal text-[10px] text-slate-400">(0–3)</span>
              </span>
              <input
                type="number"
                min={PUBLIC_CRAWL_LIMITS.max_scrolls_per_group.min}
                max={PUBLIC_CRAWL_LIMITS.max_scrolls_per_group.max}
                disabled={!canControl}
                value={numberInputs.max_scrolls_per_group}
                onChange={(e) => handleNumericChange("max_scrolls_per_group", e.target.value)}
                onBlur={() => commitNumericField("max_scrolls_per_group")}
                className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold"
              />
            </label>
            <label className="flex items-center gap-2 pt-5 text-xs font-semibold text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                disabled={!canControl}
                checked={configDraft.auto_skip_private}
                onChange={(e) => {
                  setConfigDraft((p) => ({ ...p, auto_skip_private: e.target.checked }));
                  setConfigDirty(true);
                }}
                className="size-4 accent-amber-600 rounded"
              />
              Tự gắn cờ Private nếu nhóm kín
            </label>
          </div>

          {/* Threads No-Acc Seeding Settings & Keyword Library */}
          <div className="rounded-xl border border-purple-200/80 bg-purple-50/40 p-3 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-purple-200/60">
              <label className="flex items-center gap-2 text-xs font-bold text-purple-900 cursor-pointer">
                <input
                  type="checkbox"
                  disabled={!canControl}
                  checked={configDraft.alternating_threads_enabled ?? true}
                  onChange={(e) => {
                    setConfigDraft((p) => ({ ...p, alternating_threads_enabled: e.target.checked }));
                    setConfigDirty(true);
                  }}
                  className="size-4 accent-purple-600 rounded"
                />
                <span>Luân phiên 24/24 sang Threads No-Acc (Thư viện từ khóa theo chủ đề)</span>
              </label>
              <span className="text-[11px] font-semibold text-purple-700 bg-purple-100/80 px-2 py-0.5 rounded-full border border-purple-200">
                FB Hết Nhóm → Threads Thư viện từ khóa → FB → ...
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <label
                className="space-y-1 text-xs"
                title="Số bài tối đa lưu mỗi từ khóa Threads trong 1 vòng (5–30)."
              >
                <span className="font-bold text-slate-600 block">
                  Số bài Threads / từ khóa{" "}
                  <span className="font-normal text-[10px] text-slate-400">(5–30)</span>
                </span>
                <input
                  type="number"
                  min={PUBLIC_CRAWL_LIMITS.threads_max_posts_per_keyword.min}
                  max={PUBLIC_CRAWL_LIMITS.threads_max_posts_per_keyword.max}
                  disabled={!canControl}
                  value={numberInputs.threads_max_posts_per_keyword}
                  onChange={(e) =>
                    handleNumericChange("threads_max_posts_per_keyword", e.target.value)
                  }
                  onBlur={() => commitNumericField("threads_max_posts_per_keyword")}
                  className="w-full rounded-lg border border-purple-200 bg-white px-2.5 py-1.5 text-xs font-semibold"
                />
              </label>
              <label
                className="space-y-1 text-xs"
                title="Bỏ qua bài Threads đăng cũ hơn N ngày (1–30 ngày, khuyên dùng 7)."
              >
                <span className="font-bold text-slate-600 block">
                  Giới hạn tuổi bài (ngày){" "}
                  <span className="font-normal text-[10px] text-slate-400">(1–30)</span>
                </span>
                <input
                  type="number"
                  min={PUBLIC_CRAWL_LIMITS.threads_max_age_days.min}
                  max={PUBLIC_CRAWL_LIMITS.threads_max_age_days.max}
                  disabled={!canControl}
                  value={numberInputs.threads_max_age_days}
                  onChange={(e) => handleNumericChange("threads_max_age_days", e.target.value)}
                  onBlur={() => commitNumericField("threads_max_age_days")}
                  className="w-full rounded-lg border border-purple-200 bg-white px-2.5 py-1.5 text-xs font-semibold"
                />
              </label>
            </div>

            {/* THƯ VIỆN TỪ KHÓA THREADS THEO CHỦ ĐỀ (OPEN CHO TOÀN BỘ MEMBER, LEADER, ADMIN) */}
            <div className="pt-2 border-t border-purple-200/60 space-y-2.5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold text-purple-950 uppercase tracking-wider">
                    📚 Thư viện từ khóa Threads ({threadsLibraryKeywords.length} từ)
                  </span>
                  <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.2 rounded-full">
                    Cào toàn bộ sau mỗi vòng
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-[11px]">
                  <span className="text-slate-500 font-medium">Lọc chủ đề:</span>
                  <select
                    value={libraryFilterTopic}
                    onChange={(e) => setLibraryFilterTopic(e.target.value)}
                    className="rounded-lg border border-purple-200 bg-white px-2 py-1 text-xs font-semibold text-purple-900"
                  >
                    <option value="all">Tất cả chủ đề</option>
                    {threadsTopics.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Form thêm từ khóa mới vào Thư viện */}
              <div className="rounded-xl border border-purple-200 bg-white p-2.5 space-y-2 shadow-2xs">
                <div className="text-[11px] font-bold text-slate-700 flex items-center gap-1">
                  <span>+ Thêm từ khóa mới để chạy seeding Threads:</span>
                  <span className="text-[10px] font-normal text-slate-500">
                    (Vòng cào sau sẽ tự động nạp lại và cào toàn bộ)
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
                  <div className="sm:col-span-4">
                    <select
                      value={selectedTopic}
                      onChange={(e) => setSelectedTopic(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-800"
                    >
                      {threadsTopics.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                      <option value="custom">+ Chủ đề khác...</option>
                    </select>
                  </div>
                  {selectedTopic === "custom" && (
                    <div className="sm:col-span-3">
                      <input
                        type="text"
                        value={customTopicInput}
                        onChange={(e) => setCustomTopicInput(e.target.value)}
                        placeholder="Tên chủ đề mới..."
                        className="w-full rounded-lg border border-purple-200 bg-white px-2.5 py-1.5 text-xs font-medium"
                      />
                    </div>
                  )}
                  <div className={selectedTopic === "custom" ? "sm:col-span-3" : "sm:col-span-6"}>
                    <input
                      type="text"
                      value={newKeywordInput}
                      onChange={(e) => setNewKeywordInput(e.target.value)}
                      placeholder="Nhập từ khóa (vd: thiết kế web, landing page, app bán hàng)..."
                      className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void handleAddKeywordToLibrary();
                        }
                      }}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <button
                      type="button"
                      disabled={isAddingKeyword || !newKeywordInput.trim()}
                      onClick={() => void handleAddKeywordToLibrary()}
                      className="w-full rounded-lg bg-purple-700 hover:bg-purple-800 text-white font-bold text-xs py-1.5 px-3 transition shadow-xs disabled:opacity-50 cursor-pointer flex items-center justify-center gap-1"
                    >
                      <span>{isAddingKeyword ? "Đang thêm..." : "+ Thêm"}</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Danh sách hiển thị các từ khóa phân loại theo Chủ đề */}
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {threadsLibraryKeywords.length === 0 ? (
                  <div className="text-xs text-slate-500 py-3 text-center">
                    Thư viện chưa có từ khóa. Hãy thêm từ khóa phía trên để bắt đầu cào Threads.
                  </div>
                ) : (
                  Object.entries(
                    threadsLibraryKeywords
                      .filter((k) => libraryFilterTopic === "all" || k.topic === libraryFilterTopic)
                      .reduce<Record<string, ThreadsKeywordLibraryItem[]>>((acc, kw) => {
                        const t = kw.topic || "Chung";
                        if (!acc[t]) acc[t] = [];
                        acc[t].push(kw);
                        return acc;
                      }, {})
                  ).map(([topicName, items]) => (
                    <div key={topicName} className="rounded-lg border border-purple-100 bg-white/80 p-2 space-y-1.5">
                      <div className="flex items-center justify-between text-[11px] font-bold text-purple-900 border-b border-purple-50 pb-1">
                        <span className="flex items-center gap-1">
                          <span className="inline-block w-1.5 h-1.5 rounded-full bg-purple-600"></span>
                          <span>{topicName}</span>
                          <span className="text-[10px] font-normal text-slate-500">({items.length} từ)</span>
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {items.map((kwItem) => (
                          <span
                            key={kwItem.id || kwItem.keyword}
                            title={`Chủ đề: ${kwItem.topic} · Đã dùng ${kwItem.times_used} vòng · ${kwItem.total_posts_found} bài · ${kwItem.high_score_posts} Lead >=70đ`}
                            className={cn(
                              "inline-flex items-center gap-1 pl-2.5 pr-1.5 py-0.5 rounded-full text-[11px] font-semibold border transition shadow-2xs",
                              kwItem.high_score_posts > 0
                                ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                                : "bg-white text-purple-900 border-purple-200",
                            )}
                          >
                            <span>{kwItem.keyword}</span>
                            {(kwItem.high_score_posts > 0 || kwItem.total_posts_found > 0) && (
                              <span className="font-mono text-[9px] opacity-80">
                                ({kwItem.high_score_posts}L/{kwItem.total_posts_found}B)
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => void handleDeleteKeywordFromLibrary(kwItem.id || kwItem.keyword, kwItem.keyword)}
                              className="ml-0.5 p-0.5 rounded-full hover:bg-rose-100 text-slate-400 hover:text-rose-600 transition cursor-pointer"
                              title="Xóa từ khóa này khỏi thư viện"
                            >
                              ✕
                            </button>
                          </span>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="text-[10.5px] text-purple-800 bg-purple-100/50 p-2 rounded-lg border border-purple-200/60 leading-relaxed">
                💡 <strong>Cơ chế tự động:</strong> Hệ thống sẽ cào <strong>TOÀN BỘ</strong> các từ khóa trong thư viện trên mỗi vòng lặp Threads. Khi thành viên thêm từ khóa hoặc chủ đề mới, ngay sau khi vòng hiện tại kết thúc, vòng kế tiếp sẽ tự động nạp lại và cào đầy đủ. AI đề xuất & đánh giá từ khóa đã được tắt để tiết kiệm 100% token AI.
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1 border-t border-slate-100">
            <input
              type="text"
              value={keywordsInput}
              onChange={(e) => setKeywordsInput(e.target.value)}
              placeholder="Từ khóa lọc tùy chọn khi chạy tay (phân cách dấu phẩy, để trống = lấy bài mới nhất hôm nay)"
              className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs"
            />
            <button
              type="button"
              disabled={!canControl || savingConfig}
              onClick={() => void handleSaveConfig()}
              className={cn(
                "px-3.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer shrink-0 transition",
                configDirty
                  ? "bg-slate-900 hover:bg-slate-800 text-white"
                  : "bg-slate-100 hover:bg-slate-200 text-slate-800",
                "disabled:opacity-50",
              )}
            >
              <Save className="size-3.5" />
              {savingConfig ? "Đang lưu..." : configDirty ? "Lưu cấu hình *" : "Lưu cấu hình"}
            </button>
          </div>
        </div>
      </div>

      {/* Bảng Nhóm Public / Private */}
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-black text-slate-900">
              Danh sách Nhóm Facebook ({filteredGroups.length})
            </h3>
            <div className="inline-flex rounded-lg bg-slate-100 p-0.5 text-[11px] font-bold">
              {(["all", "public", "private"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setVisibilityFilter(tab)}
                  className={cn(
                    "px-2.5 py-1 rounded-md cursor-pointer transition",
                    visibilityFilter === tab ? "bg-white text-slate-900 shadow-xs" : "text-slate-500",
                  )}
                >
                  {tab === "all" ? "Tất cả" : tab === "public" ? "Public 4G" : "Private (Kín)"}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tìm tên nhóm hoặc URL..."
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs w-56"
            />
            {selectedIds.size > 0 && canControl && (
              <>
                <button
                  type="button"
                  disabled={isRunning || triggeringRun}
                  onClick={() => void handleRunNow(true)}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 cursor-pointer"
                >
                  Chạy {selectedIds.size} nhóm đã chọn
                </button>
                <button
                  type="button"
                  onClick={() => void handleBulkToggle(true)}
                  className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-sky-50 text-sky-700 border border-sky-200 cursor-pointer"
                >
                  Bật Public 4G
                </button>
                <button
                  type="button"
                  onClick={() => void handleBulkToggle(false)}
                  className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-slate-100 text-slate-700 cursor-pointer"
                >
                  Tắt Public 4G
                </button>
              </>
            )}
          </div>
        </div>

        <div className="max-h-[400px] overflow-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-500 uppercase">
              <tr>
                <th className="p-3 w-8">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedIds(new Set(filteredGroups.map((g) => g.id)));
                      } else {
                        setSelectedIds(new Set());
                      }
                    }}
                  />
                </th>
                <th className="p-3">Nhóm Facebook</th>
                <th className="p-3">Phân loại</th>
                <th className="p-3">Bật Cào Public</th>
                <th className="p-3">Lần cào 4G gần nhất</th>
                <th className="p-3 text-right">Bài mới</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredGroups.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-slate-400">
                    Không có nhóm nào khớp bộ lọc hiện tại.
                  </td>
                </tr>
              ) : (
                filteredGroups.map((g) => {
                  const chip = statusChipMeta(g.last_public_crawl_status);
                  const isPublic = g.visibility !== "private";
                  return (
                    <tr key={g.id} className="hover:bg-slate-50/70">
                      <td className="p-3">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(g.id)}
                          onChange={(e) => {
                            setSelectedIds((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(g.id);
                              else next.delete(g.id);
                              return next;
                            });
                          }}
                        />
                      </td>
                      <td className="p-3 max-w-[320px]">
                        <div className="font-bold text-slate-900 truncate">
                          {g.group_name || "Nhóm chưa đặt tên"}
                        </div>
                        <a
                          href={g.group_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[11px] text-sky-700 hover:underline truncate block"
                        >
                          {g.group_url}
                        </a>
                      </td>
                      <td className="p-3">
                        <button
                          type="button"
                          disabled={!canControl}
                          onClick={() =>
                            void handleToggleGroup(g, {
                              visibility: isPublic ? "private" : "public",
                            })
                          }
                          title="Nhấn để chuyển đổi Public / Private"
                          className={cn(
                            "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold border cursor-pointer disabled:cursor-default",
                            isPublic
                              ? "bg-sky-50 text-sky-700 border-sky-200"
                              : "bg-amber-50 text-amber-700 border-amber-200",
                          )}
                        >
                          {isPublic ? <Globe className="size-3" /> : <Lock className="size-3" />}
                          {isPublic ? "Public" : "Private"}
                        </button>
                      </td>
                      <td className="p-3">
                        <input
                          type="checkbox"
                          disabled={!canControl || !isPublic}
                          checked={Boolean(g.public_crawl_enabled && isPublic)}
                          onChange={(e) =>
                            void handleToggleGroup(g, { public_crawl_enabled: e.target.checked })
                          }
                          className="size-4 accent-emerald-600 cursor-pointer"
                        />
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={cn(
                              "px-2 py-0.5 rounded-full text-[10px] font-bold border",
                              chip.cls,
                            )}
                            title={g.last_public_crawl_error || ""}
                          >
                            {chip.label}
                          </span>
                          <span className="text-[11px] text-slate-500">
                            {formatDateTime(g.last_public_crawled_at)}
                          </span>
                        </div>
                      </td>
                      <td className="p-3 text-right font-bold text-slate-800">
                        {g.last_public_posts_count ?? 0}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Live Terminal & Run History */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        <div className="xl:col-span-7 rounded-2xl border border-slate-800 bg-slate-950 p-4 text-slate-100 space-y-2.5">
          <div className="flex items-center justify-between text-xs font-bold text-slate-300">
            <span className="flex items-center gap-1.5">
              <Terminal className="size-4 text-emerald-400" /> Console Hoạt Động (Realtime)
            </span>
            <span className="text-[11px] text-slate-400">{logs.length} dòng gần nhất</span>
          </div>
          <div className="h-56 overflow-y-auto font-mono text-[11px] space-y-1 pr-1">
            {logs.length === 0 ? (
              <div className="text-slate-500 italic">
                Chưa có log trong phiên hiện tại. Bấm &ldquo;Chạy ngay&rdquo; hoặc &ldquo;Kiểm tra Proxy Xoay&rdquo;.
              </div>
            ) : (
              logs.map((entry, idx) => (
                <div key={`${entry.ts}-${idx}`} className="leading-relaxed">
                  <span className="text-slate-500 mr-2">
                    {formatDateTime(entry.ts)}
                  </span>
                  <span className="text-sky-400 mr-2">[{entry.sim_id}]</span>
                  <span className={LOG_TEXT_COLOR[entry.level] || "text-slate-200"}>
                    {entry.message}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="xl:col-span-5 rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
          <h3 className="text-sm font-black text-slate-900 flex items-center gap-1.5">
            <CheckCircle2 className="size-4 text-emerald-600" /> Lịch sử vòng chạy gần đây
          </h3>
          <div className="space-y-2 max-h-56 overflow-y-auto">
            {recentRuns.length === 0 ? (
              <p className="text-xs text-slate-400">Chưa có lịch sử vòng chạy nào.</p>
            ) : (
              recentRuns.map((run) => (
                <div
                  key={run.id}
                  className="rounded-xl border border-slate-100 bg-slate-50/70 p-2.5 text-xs space-y-1"
                >
                  <div className="flex items-center justify-between font-bold">
                    <span className="text-slate-900">
                      {run.trigger_source === "scheduler" ? "Tự động" : "Chạy tay"} ·{" "}
                      {formatDateTime(run.started_at)}
                    </span>
                    <span
                      className={cn(
                        "px-2 py-0.5 rounded-full text-[10px]",
                        run.status === "completed"
                          ? "bg-emerald-100 text-emerald-700"
                          : run.status === "running"
                            ? "bg-sky-100 text-sky-700"
                            : "bg-amber-100 text-amber-700",
                      )}
                    >
                      {run.status}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-600 flex flex-wrap gap-x-3 gap-y-0.5">
                    <span>OK: {run.groups_ok}/{run.total_groups}</span>
                    <span>+{run.posts_saved} bài</span>
                    <span>Xoay IP: {run.ip_rotations}</span>
                    <span>TB: {run.avg_ms_per_group ? `${(run.avg_ms_per_group / 1000).toFixed(1)}s` : "—"}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
