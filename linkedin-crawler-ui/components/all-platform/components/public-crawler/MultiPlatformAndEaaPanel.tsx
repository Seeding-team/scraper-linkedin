"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Briefcase,
  CheckCircle2,
  KeyRound,
  Play,
  Plus,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  Zap,
} from "lucide-react";

import { useAppAuth } from "@/contexts/AppAuthContext";
import { cn } from "@/lib/utils";
import { publicCrawlerService } from "@/services/public-crawler.service";
import type {
  FbEaaTokenItem,
  FbEaaTokenTestResponse,
  InstagramTargetItem,
  LinkedInNoAccTargetItem,
  PublicCrawlConfig,
  PublicCrawlRuntime,
} from "@/types/public-crawler";

type SubSection = "eaa" | "instagram" | "linkedin";

function formatShortTime(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
  });
}

function usageBarColor(pct: number): string {
  if (pct >= 65) return "bg-rose-500";
  if (pct >= 45) return "bg-amber-500";
  return "bg-emerald-500";
}

function statusBadgeMeta(status: string): { label: string; cls: string } {
  switch (status) {
    case "active":
      return { label: "Đang hoạt động", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" };
    case "cooldown":
      return { label: "Đang nghỉ Cooldown", cls: "bg-amber-50 text-amber-700 border-amber-200" };
    case "quarantined":
      return { label: "Cách ly (190/368)", cls: "bg-rose-50 text-rose-700 border-rose-200" };
    case "disabled":
      return { label: "Đã tắt", cls: "bg-slate-100 text-slate-600 border-slate-200" };
    default:
      return { label: status, cls: "bg-slate-100 text-slate-600 border-slate-200" };
  }
}

export function MultiPlatformAndEaaPanel() {
  const { user } = useAppAuth();
  const canControl = user?.role === "admin" || user?.role === "leader";

  const [subTab, setSubTab] = useState<SubSection>("eaa");
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<PublicCrawlConfig | null>(null);
  const [runtime, setRuntime] = useState<PublicCrawlRuntime | null>(null);
  const [eaaTokens, setEaaTokens] = useState<FbEaaTokenItem[]>([]);
  const [igTargets, setIgTargets] = useState<InstagramTargetItem[]>([]);
  const [liTargets, setLiTargets] = useState<LinkedInNoAccTargetItem[]>([]);
  const [feedback, setFeedback] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);

  // EAA Form state
  const [eaaLabel, setEaaLabel] = useState("");
  const [eaaTokenInput, setEaaTokenInput] = useState("");
  const [eaaProxyInput, setEaaProxyInput] = useState("");
  const [eaaQuotaInput, setEaaQuotaInput] = useState("80");
  const [eaaTestGroupInput, setEaaTestGroupInput] = useState("");
  const [eaaBusy, setEaaBusy] = useState(false);
  const [testingTokenId, setTestingTokenId] = useState<string | null>(null);
  const [lastTokenTest, setLastTokenTest] = useState<FbEaaTokenTestResponse | null>(null);

  // Instagram Form state
  const [igTargetType, setIgTargetType] = useState<"keyword" | "profile">("keyword");
  const [igValuesInput, setIgValuesInput] = useState("");
  const [igTopicInput, setIgTopicInput] = useState("Chung");
  const [igBusy, setIgBusy] = useState(false);

  // LinkedIn No-Acc Form state
  const [liKeywordsInput, setLiKeywordsInput] = useState("");
  const [liLocationInput, setLiLocationInput] = useState("Vietnam");
  const [liChannelInput, setLiChannelInput] = useState<"both" | "jobs_guest" | "search_index">("both");
  const [liBusy, setLiBusy] = useState(false);

  const loadAll = useCallback(async () => {
    try {
      const [statusRes, tokensRes, igRes, liRes] = await Promise.all([
        publicCrawlerService.getStatus(),
        publicCrawlerService.getEaaTokens().catch(() => ({ success: false, items: [] })),
        publicCrawlerService.getInstagramTargets().catch(() => ({ success: false, items: [] })),
        publicCrawlerService.getLinkedInNoAccTargets().catch(() => ({ success: false, items: [] })),
      ]);
      setConfig(statusRes.config);
      setRuntime(statusRes.runtime);
      setEaaTokens(tokensRes.items || []);
      setIgTargets(igRes.items || []);
      setLiTargets(liRes.items || []);
    } catch (err) {
      setFeedback({
        type: "error",
        text: err instanceof Error ? err.message : "Không tải được cấu hình đa nền tảng.",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [statusRes, tokensRes, igRes, liRes] = await Promise.all([
          publicCrawlerService.getStatus(),
          publicCrawlerService.getEaaTokens().catch(() => ({ success: false, items: [] })),
          publicCrawlerService.getInstagramTargets().catch(() => ({ success: false, items: [] })),
          publicCrawlerService.getLinkedInNoAccTargets().catch(() => ({ success: false, items: [] })),
        ]);
        if (cancelled) return;
        setConfig(statusRes.config);
        setRuntime(statusRes.runtime);
        setEaaTokens(tokensRes.items || []);
        setIgTargets(igRes.items || []);
        setLiTargets(liRes.items || []);
      } catch (err) {
        if (cancelled) return;
        setFeedback({
          type: "error",
          text: err instanceof Error ? err.message : "Không tải được cấu hình đa nền tảng.",
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleToggleConfigFlag = async (
    field: "use_eaa_for_private_groups" | "alternating_instagram_enabled" | "alternating_linkedin_no_acc_enabled" | "use_curl_cffi",
    nextVal: boolean,
  ) => {
    if (!canControl) return;
    try {
      const res = await publicCrawlerService.updateConfig({ [field]: nextVal });
      setConfig(res.config);
      setFeedback({ type: "success", text: "Đã lưu cấu hình đồng bộ ngay lập tức." });
    } catch (err) {
      setFeedback({ type: "error", text: err instanceof Error ? err.message : "Lưu cấu hình thất bại." });
    }
  };

  // ── EAA Actions ───────────────────────────────────────────────────────────
  const handleAddEaaToken = async () => {
    if (!canControl) return;
    if (!eaaLabel.trim() || !eaaTokenInput.trim()) {
      setFeedback({ type: "error", text: "Vui lòng nhập Tên gợi nhớ và Mã Token EAA..." });
      return;
    }
    setEaaBusy(true);
    setFeedback(null);
    try {
      const res = await publicCrawlerService.createEaaToken({
        label: eaaLabel.trim(),
        access_token: eaaTokenInput.trim(),
        sticky_proxy_url: eaaProxyInput.trim() || undefined,
        hourly_quota: Number(eaaQuotaInput) || 80,
      });
      setEaaLabel("");
      setEaaTokenInput("");
      setEaaProxyInput("");
      setFeedback({
        type: "success",
        text: `Đã mã hóa Fernet & lưu token "${res.item.label}" (${res.item.token_type}).`,
      });
      await loadAll();
    } catch (err) {
      setFeedback({ type: "error", text: err instanceof Error ? err.message : "Thêm EAA token thất bại." });
    } finally {
      setEaaBusy(false);
    }
  };

  const handleTestRawToken = async () => {
    if (!canControl || !eaaTokenInput.trim()) return;
    setEaaBusy(true);
    setLastTokenTest(null);
    try {
      const res = await publicCrawlerService.testRawEaaToken({
        access_token: eaaTokenInput.trim(),
        sticky_proxy_url: eaaProxyInput.trim() || undefined,
        test_group_id_or_url: eaaTestGroupInput.trim() || undefined,
      });
      setLastTokenTest(res);
      setFeedback({
        type: res.ok ? "success" : "error",
        text: res.ok
          ? `Token sống tốt (${res.fb_user_name || res.fb_user_id}) · X-App-Usage=${res.app_usage_pct ?? 0}% (${res.latency_ms}ms)`
          : `Token lỗi (mã ${res.error_code ?? "?"}): ${res.error || "Không hợp lệ"}`,
      });
    } catch (err) {
      setFeedback({ type: "error", text: err instanceof Error ? err.message : "Test token thất bại." });
    } finally {
      setEaaBusy(false);
    }
  };

  const handleTestSavedToken = async (tokenId: string) => {
    if (!canControl) return;
    setTestingTokenId(tokenId);
    try {
      const res = await publicCrawlerService.testEaaToken(tokenId, eaaTestGroupInput.trim() || undefined);
      setLastTokenTest(res);
      setFeedback({
        type: res.ok ? "success" : "error",
        text: res.ok
          ? `Token OK (${res.fb_user_name || res.fb_user_id || res.token_masked}) · X-App-Usage=${res.app_usage_pct ?? 0}%`
          : `Token gặp lỗi (mã ${res.error_code ?? "?"}): ${res.error || "Kiểm tra lại phiên"}`,
      });
      await loadAll();
    } catch (err) {
      setFeedback({ type: "error", text: err instanceof Error ? err.message : "Test token thất bại." });
    } finally {
      setTestingTokenId(null);
    }
  };

  const handleToggleToken = async (item: FbEaaTokenItem) => {
    if (!canControl) return;
    const nextStatus = item.status === "active" ? "disabled" : "active";
    try {
      await publicCrawlerService.updateEaaToken(item.id, { status: nextStatus });
      await loadAll();
    } catch (err) {
      setFeedback({ type: "error", text: err instanceof Error ? err.message : "Đổi trạng thái thất bại." });
    }
  };

  const handleDeleteToken = async (id: string) => {
    if (!canControl) return;
    try {
      await publicCrawlerService.deleteEaaToken(id);
      await loadAll();
    } catch (err) {
      setFeedback({ type: "error", text: err instanceof Error ? err.message : "Xóa token thất bại." });
    }
  };

  // ── Instagram Actions ─────────────────────────────────────────────────────
  const handleAddIgTargets = async () => {
    if (!canControl) return;
    const lines = igValuesInput
      .split(/[\n,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (lines.length === 0) return;
    setIgBusy(true);
    try {
      const res = await publicCrawlerService.addInstagramTargets({
        target_type: igTargetType,
        values: lines,
        topic: igTopicInput.trim() || "Chung",
      });
      setIgValuesInput("");
      setFeedback({ type: "success", text: res.message });
      await loadAll();
    } catch (err) {
      setFeedback({ type: "error", text: err instanceof Error ? err.message : "Thêm mục tiêu Instagram thất bại." });
    } finally {
      setIgBusy(false);
    }
  };

  // ── LinkedIn No-Acc Actions ───────────────────────────────────────────────
  const handleAddLiTargets = async () => {
    if (!canControl) return;
    const lines = liKeywordsInput
      .split(/[\n,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (lines.length === 0) return;
    setLiBusy(true);
    try {
      const res = await publicCrawlerService.addLinkedInNoAccTargets({
        keywords: lines,
        location: liLocationInput.trim() || "Vietnam",
        channel: liChannelInput,
      });
      setLiKeywordsInput("");
      setFeedback({ type: "success", text: res.message });
      await loadAll();
    } catch (err) {
      setFeedback({ type: "error", text: err instanceof Error ? err.message : "Thêm từ khóa LinkedIn thất bại." });
    } finally {
      setLiBusy(false);
    }
  };

  const handleQuickRunPlatform = async (platform: "instagram" | "linkedin_no_acc") => {
    if (!canControl) return;
    try {
      const res = await publicCrawlerService.runNow({ platform, limit_groups: 5 });
      setFeedback({
        type: res.started ? "success" : "info",
        text: res.started
          ? `Đã khởi chạy Test Nhanh ${platform === "instagram" ? "Instagram No-Acc" : "LinkedIn No-Acc"} (${res.total_groups ?? 0} mục tiêu).`
          : res.message || "Không thể khởi chạy lúc này.",
      });
    } catch (err) {
      setFeedback({ type: "error", text: err instanceof Error ? err.message : "Lỗi khởi chạy crawler." });
    }
  };

  return (
    <div className="space-y-5">
      {/* Phase 1 Core 4G Telemetry Banner */}
      <div className="rounded-2xl border border-indigo-200 bg-gradient-to-r from-indigo-50/90 via-purple-50/60 to-rose-50/70 p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-black bg-indigo-600 text-white">
              <Zap className="size-3" /> LÕI 4G NÂNG CẤP (TLS · DOC_ID ĐỘNG · CIRCUIT BREAKER)
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-white border border-indigo-200 text-indigo-800">
              TLS: {runtime?.tls_engine === "curl_cffi_chrome131" ? "curl_cffi Chrome 131" : "HTTPX Fallback"}
            </span>
            {runtime?.active_gql_doc_id && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-mono font-bold bg-white border border-slate-200 text-slate-700">
                doc_id: {runtime.active_gql_doc_id}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            Quản lý đồng bộ <strong>Facebook EAA Token Fast-Lane</strong> (cho Nhóm Kín, mã hóa Fernet 5 lớp chống checkpoint),{" "}
            <strong>Instagram No-Acc</strong> (<code>/popular/</code> + <code>/embed/captioned/</code>) và{" "}
            <strong>LinkedIn No-Acc B2B</strong> (<code>/jobs-guest/api</code> + Search Index).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border border-indigo-200 bg-white text-xs font-bold text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              disabled={!canControl}
              checked={Boolean(config?.use_curl_cffi ?? true)}
              onChange={(e) => void handleToggleConfigFlag("use_curl_cffi", e.target.checked)}
              className="rounded border-slate-300 text-indigo-600"
            />
            TLS Chrome 131
          </label>
          <button
            type="button"
            onClick={() => void loadAll()}
            className="px-3 py-1.5 rounded-xl text-xs font-bold border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
            Làm mới
          </button>
        </div>
      </div>

      {/* Feedback Banner */}
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

      {/* Sub-Tabs Switcher */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-3">
        <button
          type="button"
          onClick={() => setSubTab("eaa")}
          className={cn(
            "px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition cursor-pointer border",
            subTab === "eaa"
              ? "bg-blue-600 text-white border-blue-600 shadow-xs"
              : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50",
          )}
        >
          <KeyRound className="size-3.5" />
          Facebook EAA Token Pool ({eaaTokens.length})
        </button>
        <button
          type="button"
          onClick={() => setSubTab("instagram")}
          className={cn(
            "px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition cursor-pointer border",
            subTab === "instagram"
              ? "bg-pink-600 text-white border-pink-600 shadow-xs"
              : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50",
          )}
        >
          <Sparkles className="size-3.5" />
          Instagram No-Acc ({igTargets.length})
        </button>
        <button
          type="button"
          onClick={() => setSubTab("linkedin")}
          className={cn(
            "px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition cursor-pointer border",
            subTab === "linkedin"
              ? "bg-sky-700 text-white border-sky-700 shadow-xs"
              : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50",
          )}
        >
          <Briefcase className="size-3.5" />
          LinkedIn No-Acc B2B ({liTargets.length})
        </button>
      </div>

      {/* ── SUBTAB 1: FACEBOOK EAA TOKEN POOL ─────────────────────────────── */}
      {subTab === "eaa" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50/60 px-4 py-3">
            <div className="space-y-0.5">
              <div className="text-xs font-black text-blue-950 flex items-center gap-1.5">
                <ShieldCheck className="size-4 text-blue-600" />
                Smart Router: Tự Động Chuyển Nhóm Kín (Private Group) Sang EAA Pool
              </div>
              <p className="text-[11px] text-blue-900/80">
                Nhóm Công Khai luôn chạy 100% No-Acc 4G (0% die acc). Chỉ nhóm bị phát hiện Private mới định tuyến sang EAA Pool (≤80 req/h, tự nghỉ khi X-App-Usage ≥ 65%, tự cách ly khi gặp mã 190/368).
              </p>
            </div>
            <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white border border-blue-200 text-xs font-bold text-blue-900 cursor-pointer shrink-0">
              <input
                type="checkbox"
                disabled={!canControl}
                checked={Boolean(config?.use_eaa_for_private_groups)}
                onChange={(e) => void handleToggleConfigFlag("use_eaa_for_private_groups", e.target.checked)}
                className="rounded border-blue-300 text-blue-600"
              />
              {config?.use_eaa_for_private_groups ? "ĐANG BẬT SMART ROUTER" : "ĐANG TẮT"}
            </label>
          </div>

          {/* Add & Test Token Form */}
          <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
            <div className="text-xs font-black text-slate-800 flex items-center gap-1.5">
              <Plus className="size-4 text-blue-600" />
              Nạp &amp; Test Token Facebook EAA (Lưu Mã Hóa Fernet — Không Bao Giờ Trả Plaintext)
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              <input
                type="text"
                value={eaaLabel}
                onChange={(e) => setEaaLabel(e.target.value)}
                placeholder="Tên gợi nhớ (vd: VIA Sale #01)"
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
              />
              <input
                type="password"
                value={eaaTokenInput}
                onChange={(e) => setEaaTokenInput(e.target.value)}
                placeholder="Dán mã EAAD6V7... / EAAAAU... / EAAG..."
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-mono"
              />
              <input
                type="text"
                value={eaaProxyInput}
                onChange={(e) => setEaaProxyInput(e.target.value)}
                placeholder="Proxy Sticky 1-1 (host:port:user:pass)"
                className={cn(
                  "rounded-xl border bg-white px-3 py-2 text-xs font-mono",
                  eaaTokenInput && !eaaProxyInput.trim() ? "border-rose-400 bg-rose-50/40" : "border-slate-200",
                )}
              />
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={5}
                  max={150}
                  value={eaaQuotaInput}
                  onChange={(e) => setEaaQuotaInput(e.target.value)}
                  title="Giới hạn request/giờ (khuyến nghị ≤ 80)"
                  className="w-24 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-mono"
                />
                <span className="text-[11px] font-semibold text-slate-500">req/giờ</span>
              </div>
            </div>

            {eaaTokenInput.trim() && !eaaProxyInput.trim() && (
              <div className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-[11px] font-bold text-rose-800 flex items-center gap-2">
                <ShieldAlert className="size-4 text-rose-600 shrink-0" />
                CẢNH BÁO AN TOÀN: Token chưa gắn Proxy Sticky cố định (1 Token = 1 IP)! Dùng IP máy chủ Datacenter rất dễ ăn checkpoint 956/190.
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={eaaTestGroupInput}
                onChange={(e) => setEaaTestGroupInput(e.target.value)}
                placeholder="Group ID / URL để test thử đọc bài (tùy chọn)"
                className="w-72 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-mono"
              />
              <button
                type="button"
                disabled={!canControl || eaaBusy || !eaaTokenInput.trim()}
                onClick={() => void handleTestRawToken()}
                className="px-3.5 py-1.5 rounded-xl text-xs font-bold border border-sky-300 bg-white hover:bg-sky-50 text-sky-700 disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
              >
                <Zap className="size-3.5" />
                Test Token 1-Chạm (/me)
              </button>
              <button
                type="button"
                disabled={!canControl || eaaBusy || !eaaLabel.trim() || !eaaTokenInput.trim()}
                onClick={() => void handleAddEaaToken()}
                className="px-4 py-1.5 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
              >
                <Plus className="size-3.5" />
                Mã hóa &amp; Thêm vào Pool
              </button>
            </div>

            {lastTokenTest && (
              <div
                className={cn(
                  "rounded-xl border px-3 py-2 text-xs flex flex-wrap items-center gap-3",
                  lastTokenTest.ok ? "bg-emerald-50 border-emerald-200 text-emerald-900" : "bg-rose-50 border-rose-200 text-rose-900",
                )}
              >
                {lastTokenTest.ok ? <CheckCircle2 className="size-4 text-emerald-600" /> : <AlertTriangle className="size-4 text-rose-600" />}
                <span>
                  <strong>{lastTokenTest.token_type}</strong> · {lastTokenTest.fb_user_name || lastTokenTest.fb_user_id || "—"} ·{" "}
                  X-App-Usage: <strong>{lastTokenTest.app_usage_pct ?? 0}%</strong>
                  {lastTokenTest.sample_posts_count != null && ` · Đọc thử nhóm: ${lastTokenTest.sample_posts_count} bài`}
                  {lastTokenTest.group_error && ` · ${lastTokenTest.group_error}`}
                </span>
              </div>
            )}
          </div>

          {/* Token Pool Table */}
          <div className="overflow-x-auto rounded-2xl border border-slate-200">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="text-left px-3 py-2.5 font-bold">Token / Loại</th>
                  <th className="text-left px-3 py-2.5 font-bold">Proxy Sticky</th>
                  <th className="text-left px-3 py-2.5 font-bold">Trạng thái</th>
                  <th className="text-left px-3 py-2.5 font-bold">X-App-Usage %</th>
                  <th className="text-left px-3 py-2.5 font-bold">Quota / Giờ</th>
                  <th className="text-left px-3 py-2.5 font-bold">Lần dùng cuối</th>
                  <th className="text-right px-3 py-2.5 font-bold">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {eaaTokens.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                      Chưa có mã EAA nào trong Pool. Dán token EAAD6V7 / EAAAAU / EAAG ở trên để kích hoạt Fast-Lane Nhóm Kín.
                    </td>
                  </tr>
                ) : (
                  eaaTokens.map((t) => {
                    const badge = statusBadgeMeta(t.status);
                    return (
                      <tr key={t.id} className="hover:bg-slate-50/60">
                        <td className="px-3 py-2.5">
                          <div className="font-bold text-slate-900">{t.label}</div>
                          <div className="text-[11px] font-mono text-slate-500">
                            <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 font-bold mr-1.5">{t.token_type}</span>
                            {t.token_masked}
                            {t.fb_user_name ? ` · ${t.fb_user_name}` : ""}
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          {t.has_sticky_proxy ? (
                            <span className="font-mono text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-lg">
                              {t.sticky_proxy_masked}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-lg">
                              <AlertTriangle className="size-3" /> Chưa gắn Proxy
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <span className={cn("inline-flex px-2 py-0.5 rounded-full text-[11px] font-bold border", badge.cls)}>
                            {badge.label}
                          </span>
                          {t.last_error_code && (
                            <div className="text-[10px] text-rose-600 mt-0.5 max-w-[200px] truncate" title={t.last_error_message || ""}>
                              Mã {t.last_error_code}: {t.last_error_message}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2.5 min-w-[130px]">
                          <div className="flex items-center justify-between text-[11px] font-mono mb-1">
                            <span>{t.last_app_usage_pct.toFixed(0)}%</span>
                            <span className="text-slate-400">Ngưỡng 65%</span>
                          </div>
                          <div className="h-1.5 w-full rounded-full bg-slate-200 overflow-hidden">
                            <div
                              className={cn("h-full rounded-full transition-all", usageBarColor(t.last_app_usage_pct))}
                              style={{ width: `${Math.min(100, Math.max(2, t.last_app_usage_pct))}%` }}
                            />
                          </div>
                        </td>
                        <td className="px-3 py-2.5 font-mono text-[11px]">
                          <strong>{t.requests_this_hour}</strong> / {t.hourly_quota}
                          <div className="text-[10px] text-slate-400">+{t.total_posts_saved} bài</div>
                        </td>
                        <td className="px-3 py-2.5 text-[11px] text-slate-500">{formatShortTime(t.last_used_at)}</td>
                        <td className="px-3 py-2.5 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={!canControl || testingTokenId === t.id}
                              onClick={() => void handleTestSavedToken(t.id)}
                              className="px-2 py-1 rounded-lg border border-sky-200 bg-sky-50 text-sky-700 font-bold text-[11px] hover:bg-sky-100 cursor-pointer"
                            >
                              {testingTokenId === t.id ? "Đang test..." : "Test"}
                            </button>
                            <button
                              type="button"
                              disabled={!canControl}
                              onClick={() => void handleToggleToken(t)}
                              className="px-2 py-1 rounded-lg border border-slate-200 bg-white text-slate-700 font-bold text-[11px] hover:bg-slate-50 cursor-pointer"
                            >
                              {t.status === "active" ? "Tắt" : "Bật lại"}
                            </button>
                            <button
                              type="button"
                              disabled={!canControl}
                              onClick={() => void handleDeleteToken(t.id)}
                              className="p-1 rounded-lg text-rose-500 hover:bg-rose-50 cursor-pointer"
                              title="Xóa token"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── SUBTAB 2: INSTAGRAM NO-ACC ────────────────────────────────────── */}
      {subTab === "instagram" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-pink-200 bg-pink-50/60 px-4 py-3">
            <div className="space-y-0.5">
              <div className="text-xs font-black text-pink-950">Instagram No-Acc 4G (Từ Khóa `/popular/` + Profile Công Khai + `/embed/captioned/`)</div>
              <p className="text-[11px] text-pink-900/80">
                100% chế độ Khách không tài khoản, chặn ảnh/font (~120MB RAM), tự dừng khi gặp watermark DB và đẩy thẳng vào Post Feed (tab Instagram) + AI chấm điểm.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white border border-pink-200 text-xs font-bold text-pink-900 cursor-pointer">
                <input
                  type="checkbox"
                  disabled={!canControl}
                  checked={Boolean(config?.alternating_instagram_enabled)}
                  onChange={(e) => void handleToggleConfigFlag("alternating_instagram_enabled", e.target.checked)}
                  className="rounded border-pink-300 text-pink-600"
                />
                Luân phiên 24/24 trên Pool 4G
              </label>
              <button
                type="button"
                disabled={!canControl || igTargets.length === 0}
                onClick={() => void handleQuickRunPlatform("instagram")}
                className="px-3.5 py-1.5 rounded-xl text-xs font-bold bg-pink-600 hover:bg-pink-700 text-white disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
              >
                <Play className="size-3.5" />
                Chạy Test Instagram
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={igTargetType}
                onChange={(e) => setIgTargetType(e.target.value as "keyword" | "profile")}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold"
              >
                <option value="keyword">Từ khóa / Hashtag (/popular/...)</option>
                <option value="profile">Profile Công Khai (@username)</option>
              </select>
              <input
                type="text"
                value={igTopicInput}
                onChange={(e) => setIgTopicInput(e.target.value)}
                placeholder="Chủ đề (vd: Thiết kế web)"
                className="w-44 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
              />
              <input
                type="text"
                value={igValuesInput}
                onChange={(e) => setIgValuesInput(e.target.value)}
                placeholder={igTargetType === "keyword" ? "Nhập từ khóa, phân tách dấu phẩy (vd: thietkeweb, marketing)" : "Nhập username (vd: @ten_doi_thu, brand_b)"}
                className="flex-1 min-w-[260px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
              />
              <button
                type="button"
                disabled={!canControl || igBusy || !igValuesInput.trim()}
                onClick={() => void handleAddIgTargets()}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-pink-600 hover:bg-pink-700 text-white disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
              >
                <Plus className="size-3.5" /> Thêm mục tiêu
              </button>
            </div>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-slate-200">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="text-left px-3 py-2.5 font-bold">Loại</th>
                  <th className="text-left px-3 py-2.5 font-bold">Mục tiêu</th>
                  <th className="text-left px-3 py-2.5 font-bold">Chủ đề</th>
                  <th className="text-left px-3 py-2.5 font-bold">Bài / Lead cao</th>
                  <th className="text-left px-3 py-2.5 font-bold">Lần cào cuối</th>
                  <th className="text-right px-3 py-2.5 font-bold">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {igTargets.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                      Chưa có từ khóa / Profile Instagram nào. Thêm ở ô trên để bắt đầu cào No-Acc 4G.
                    </td>
                  </tr>
                ) : (
                  igTargets.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50/60">
                      <td className="px-3 py-2">
                        <span className={cn("px-2 py-0.5 rounded-full text-[11px] font-bold", item.target_type === "profile" ? "bg-purple-50 text-purple-700" : "bg-pink-50 text-pink-700")}>
                          {item.target_type === "profile" ? "Profile" : "Từ khóa"}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-bold text-slate-900">
                        {item.target_type === "profile" ? `@${item.target_value}` : item.target_value}
                      </td>
                      <td className="px-3 py-2 text-slate-600">{item.topic}</td>
                      <td className="px-3 py-2 font-mono text-[11px]">
                        {item.total_posts_found} bài · <span className="text-emerald-700 font-bold">{item.high_score_posts} lead</span>
                      </td>
                      <td className="px-3 py-2 text-[11px] text-slate-500">{formatShortTime(item.last_crawled_at)}</td>
                      <td className="px-3 py-2 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={!canControl}
                            onClick={async () => {
                              await publicCrawlerService.toggleInstagramTarget(item.id, !item.is_active);
                              await loadAll();
                            }}
                            className={cn(
                              "px-2 py-1 rounded-lg text-[11px] font-bold border cursor-pointer",
                              item.is_active ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-slate-100 border-slate-200 text-slate-500",
                            )}
                          >
                            {item.is_active ? "Đang bật" : "Đã tắt"}
                          </button>
                          <button
                            type="button"
                            disabled={!canControl}
                            onClick={async () => {
                              await publicCrawlerService.deleteInstagramTarget(item.id);
                              await loadAll();
                            }}
                            className="p-1 rounded-lg text-rose-500 hover:bg-rose-50 cursor-pointer"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── SUBTAB 3: LINKEDIN NO-ACC B2B ─────────────────────────────────── */}
      {subTab === "linkedin" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sky-200 bg-sky-50/60 px-4 py-3">
            <div className="space-y-0.5">
              <div className="text-xs font-black text-sky-950">LinkedIn No-Acc B2B (Guest Jobs API siêu tốc 0 RAM Chrome + Search Index Posts)</div>
              <p className="text-[11px] text-sky-900/80">
                Quét tín hiệu tuyển dụng B2B (`/jobs-guest/jobs/api`) và bài viết công khai (`site:linkedin.com/posts`) hoàn toàn không cần cookie `li_at`, lưu chung bảng `linkedin_posts` (`post_kind=job_intent`) để AI tự chấm điểm.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white border border-sky-200 text-xs font-bold text-sky-900 cursor-pointer">
                <input
                  type="checkbox"
                  disabled={!canControl}
                  checked={Boolean(config?.alternating_linkedin_no_acc_enabled)}
                  onChange={(e) => void handleToggleConfigFlag("alternating_linkedin_no_acc_enabled", e.target.checked)}
                  className="rounded border-sky-300 text-sky-600"
                />
                Luân phiên 24/24 trên Pool 4G
              </label>
              <button
                type="button"
                disabled={!canControl || liTargets.length === 0}
                onClick={() => void handleQuickRunPlatform("linkedin_no_acc")}
                className="px-3.5 py-1.5 rounded-xl text-xs font-bold bg-sky-700 hover:bg-sky-800 text-white disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
              >
                <Play className="size-3.5" />
                Chạy Test LinkedIn No-Acc
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={liKeywordsInput}
              onChange={(e) => setLiKeywordsInput(e.target.value)}
              placeholder="Từ khóa B2B (vd: ERP, Cybersecurity, Digital Marketing, AI Engineer)"
              className="flex-1 min-w-[260px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
            />
            <input
              type="text"
              value={liLocationInput}
              onChange={(e) => setLiLocationInput(e.target.value)}
              placeholder="Khu vực (Vietnam)"
              className="w-36 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
            />
            <select
              value={liChannelInput}
              onChange={(e) => setLiChannelInput(e.target.value as "both" | "jobs_guest" | "search_index")}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold"
            >
              <option value="both">Cả 2 kênh (Jobs + Posts)</option>
              <option value="jobs_guest">Chỉ Jobs Guest API</option>
              <option value="search_index">Chỉ Search Index Posts</option>
            </select>
            <button
              type="button"
              disabled={!canControl || liBusy || !liKeywordsInput.trim()}
              onClick={() => void handleAddLiTargets()}
              className="px-4 py-2 rounded-xl text-xs font-bold bg-sky-700 hover:bg-sky-800 text-white disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
            >
              <Plus className="size-3.5" /> Thêm từ khóa B2B
            </button>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-slate-200">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="text-left px-3 py-2.5 font-bold">Từ khóa B2B</th>
                  <th className="text-left px-3 py-2.5 font-bold">Khu vực</th>
                  <th className="text-left px-3 py-2.5 font-bold">Kênh cào</th>
                  <th className="text-left px-3 py-2.5 font-bold">Tín hiệu / Lead cao</th>
                  <th className="text-left px-3 py-2.5 font-bold">Lần cào cuối</th>
                  <th className="text-right px-3 py-2.5 font-bold">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {liTargets.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                      Chưa có từ khóa LinkedIn No-Acc nào. Thêm từ khóa B2B để bắt đầu quét không cần acc.
                    </td>
                  </tr>
                ) : (
                  liTargets.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50/60">
                      <td className="px-3 py-2 font-bold text-slate-900">{item.keyword}</td>
                      <td className="px-3 py-2 text-slate-600">{item.location}</td>
                      <td className="px-3 py-2">
                        <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-sky-50 text-sky-700">
                          {item.channel === "jobs_guest" ? "Jobs Guest" : item.channel === "search_index" ? "Search Index" : "Jobs + Posts"}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono text-[11px]">
                        {item.total_posts_found} tín hiệu · <span className="text-emerald-700 font-bold">{item.high_score_posts} lead</span>
                      </td>
                      <td className="px-3 py-2 text-[11px] text-slate-500">{formatShortTime(item.last_crawled_at)}</td>
                      <td className="px-3 py-2 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={!canControl}
                            onClick={async () => {
                              await publicCrawlerService.toggleLinkedInNoAccTarget(item.id, !item.is_active);
                              await loadAll();
                            }}
                            className={cn(
                              "px-2 py-1 rounded-lg text-[11px] font-bold border cursor-pointer",
                              item.is_active ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-slate-100 border-slate-200 text-slate-500",
                            )}
                          >
                            {item.is_active ? "Đang bật" : "Đã tắt"}
                          </button>
                          <button
                            type="button"
                            disabled={!canControl}
                            onClick={async () => {
                              await publicCrawlerService.deleteLinkedInNoAccTarget(item.id);
                              await loadAll();
                            }}
                            className="p-1 rounded-lg text-rose-500 hover:bg-rose-50 cursor-pointer"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
