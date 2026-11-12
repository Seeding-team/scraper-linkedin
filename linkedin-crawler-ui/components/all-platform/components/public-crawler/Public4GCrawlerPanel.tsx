"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
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
  | "max_scrolls_per_group";

const PUBLIC_CRAWL_LIMITS: Record<
  NumericConfigField,
  { min: number; max: number; fallback: number; label: string }
> = {
  groups_per_ip_rotate: {
    min: 1,
    max: 6,
    fallback: 6,
    label: "Xoay IP sau mỗi (nhóm)",
  },
  cycle_interval_min: {
    min: 15,
    max: 1440,
    fallback: 15,
    label: "Chu kỳ quét lại (phút)",
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
};

const NUMERIC_CONFIG_FIELDS: NumericConfigField[] = [
  "groups_per_ip_rotate",
  "cycle_interval_min",
  "concurrent_sims",
  "max_posts_per_group",
  "max_scrolls_per_group",
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
  };
}

const DEFAULT_CONFIG: PublicCrawlConfig = {
  id: "default",
  enabled: false,
  cycle_interval_min: 15,
  groups_per_ip_rotate: 6,
  max_posts_per_group: 25,
  max_scrolls_per_group: 2,
  concurrent_sims: 1,
  auto_skip_private: true,
  headless: true,
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

  // Adaptive polling: fast when running (2.5s), light when idle (15s)
  const isRunning = Boolean(statusData?.runtime.is_running);
  useEffect(() => {
    const timer = window.setInterval(
      () => {
        void loadAll(false);
      },
      isRunning ? 2500 : 15000,
    );
    return () => window.clearInterval(timer);
  }, [isRunning, loadAll]);

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
      const summary = `Đã khớp cấu hình: ${config.max_posts_per_group} bài/nhóm · sâu ${config.max_scrolls_per_group} · xoay IP/${config.groups_per_ip_rotate} nhóm · ${config.concurrent_sims} luồng · chu kỳ ${config.cycle_interval_min}p.`;
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

  const handleRunNow = async (onlySelected = false, limitGroups?: number) => {
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
      });
      if (res.started) {
        setFeedback({
          type: "success",
          text:
            (limitGroups
              ? `Đang Test Cào Nhanh ${res.total_groups ?? 0} nhóm Public bằng ${(res.sim_nodes || []).join(", ")} (0% Cookie).`
              : `Đã khởi chạy cào ${res.total_groups ?? 0} nhóm Public bằng ${(res.sim_nodes || []).join(", ")} (0% Cookie).`) +
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
            Cào Nhóm Facebook Public Siêu Tốc Qua Proxy Xoay Tự Động
          </h2>
          <p className="text-xs text-slate-600 max-w-3xl leading-relaxed">
            Hoạt động 100% ở chế độ Khách không cookie, kết hợp{" "}
            <span className="font-semibold text-slate-800">HTTPX SSR Fast-Path (~1s/nhóm)</span>{" "}
            và <span className="font-semibold text-slate-800">Playwright Guest Fallback</span>{" "}
            qua Proxy dân cư/4G tự xoay mỗi 60s (tách biệt hoàn toàn khỏi Mobile Phone Bridge).{" "}
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
          {!isRunning ? (
            <>
              <button
                type="button"
                disabled={!canControl || triggeringRun || publicEnabledCount === 0}
                onClick={() => void handleRunNow(false, 3)}
                className="px-3.5 py-2 rounded-xl text-xs font-bold border border-emerald-300 bg-white hover:bg-emerald-50 disabled:opacity-50 text-emerald-700 shadow-xs flex items-center gap-1.5 cursor-pointer transition"
              >
                <Zap className="size-3.5" />
                {triggeringRun ? "Đang khởi chạy..." : "Test Cào Nhanh 3 Nhóm"}
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

      {/* Telemetry KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="rounded-xl border border-slate-200 bg-white p-3.5">
          <div className="text-[11px] font-bold text-slate-500 uppercase">Trạng thái</div>
          <div className="mt-1 flex items-center gap-2 text-sm font-black text-slate-900">
            <span
              className={cn(
                "size-2.5 rounded-full",
                isRunning ? "bg-emerald-500 animate-pulse" : "bg-slate-300",
              )}
            />
            {isRunning
              ? `Đang chạy (${runtime?.completed_groups ?? 0}/${runtime?.total_groups ?? 0})`
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
                    <span className="px-2 py-0.5 rounded font-bold bg-slate-100 text-slate-700">
                      Trạng thái: {sim.status}
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
              title="Khóa tối thiểu 15 phút để không spam nhóm; có thể tăng lên 30–1440 phút cho nhẹ proxy."
            >
              <span className="font-bold text-slate-600 block">
                Chu kỳ quét lại (phút){" "}
                <span className="font-normal text-[10px] text-slate-400">(≥ 15p)</span>
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
