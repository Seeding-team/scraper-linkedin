"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock,
  DatabaseZap,
  Globe,
  Loader2,
  Plus,
  RotateCcw,
  Save,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useAppAuth } from "@/contexts/AppAuthContext";
import { cn } from "@/lib/utils";
import { slaAlertsService } from "@/services/slaAlertsService";
import {
  alert as uiAlert,
  btn,
  btnSize,
  card,
  input as uiInput,
  label as uiLabel,
} from "@/components/all-platform/zalo/centralized-shared/zaloUi";
import {
  DEFAULT_SLA_CONFIG,
  getChannelMeta,
  PRIMARY_SLA_CHANNELS,
  type SlaBackfillResult,
  type SlaConfig,
  type SlaConfigBundle,
  type SlaShift,
} from "@/types/sla-alerts";

export interface SlaSettingsTabProps {
  refreshSignal: number;
  onSaved?: () => void;
}

const WEEKDAYS: ReadonlyArray<{ iso: number; short: string; full: string }> = [
  { iso: 1, short: "T2", full: "Thứ 2" },
  { iso: 2, short: "T3", full: "Thứ 3" },
  { iso: 3, short: "T4", full: "Thứ 4" },
  { iso: 4, short: "T5", full: "Thứ 5" },
  { iso: 5, short: "T6", full: "Thứ 6" },
  { iso: 6, short: "T7", full: "Thứ 7" },
  { iso: 7, short: "CN", full: "Chủ nhật" },
];

const SCOPE_OPTIONS: ReadonlyArray<{ scopeKey: string; label: string; subtitle: string }> = [
  { scopeKey: "global", label: "Mặc định toàn hệ thống (Global)", subtitle: "Áp dụng cho mọi kênh chưa có override" },
  { scopeKey: "channel:zalo", label: "Zalo", subtitle: "Override riêng cho kênh Zalo" },
  { scopeKey: "channel:messenger", label: "Messenger", subtitle: "Override riêng cho kênh Facebook Messenger" },
  { scopeKey: "channel:telegram", label: "Telegram", subtitle: "Override riêng cho kênh Telegram" },
  { scopeKey: "channel:whatsapp", label: "WhatsApp", subtitle: "Override riêng cho kênh WhatsApp" },
];

function cloneConfig(cfg: SlaConfig, scopeKey: string): SlaConfig {
  return {
    scope_key: scopeKey,
    target_minutes: cfg.target_minutes ?? 5,
    warning_pct: cfg.warning_pct ?? 70,
    business_hours_enabled: cfg.business_hours_enabled ?? true,
    timezone: cfg.timezone || "Asia/Ho_Chi_Minh",
    work_days: Array.isArray(cfg.work_days) ? [...cfg.work_days] : [1, 2, 3, 4, 5, 6],
    shifts:
      Array.isArray(cfg.shifts) && cfg.shifts.length > 0
        ? cfg.shifts.map((s) => ({ start: s.start || "08:00", end: s.end || "17:30" }))
        : [
            { start: "08:00", end: "12:00" },
            { start: "13:30", end: "17:30" },
          ],
    include_group_chats: Boolean(cfg.include_group_chats),
    exclude_bot_replies: cfg.exclude_bot_replies ?? true,
  };
}

export function SlaSettingsTab({ refreshSignal, onSaved }: SlaSettingsTabProps) {
  const { user } = useAppAuth();
  const userEmail = user?.email ?? null;
  const canEdit = user?.role === "admin" || user?.role === "leader";

  const [bundle, setBundle] = useState<SlaConfigBundle | null>(null);
  const [selectedScope, setSelectedScope] = useState<string>("global");
  const [form, setForm] = useState<SlaConfig>(() => cloneConfig(DEFAULT_SLA_CONFIG, "global"));

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Backfill state
  const [backfillDays, setBackfillDays] = useState<number>(7);
  const [backfillChannels, setBackfillChannels] = useState<string[]>([
    "zalo",
    "messenger",
    "telegram",
    "whatsapp",
  ]);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillResult, setBackfillResult] = useState<SlaBackfillResult | null>(null);
  const [backfillError, setBackfillError] = useState<string | null>(null);

  const overrideMap = useMemo(() => {
    const map = new Map<string, SlaConfig>();
    if (bundle?.global) {
      map.set("global", bundle.global);
    }
    for (const ov of bundle?.overrides || []) {
      map.set(ov.scope_key, ov);
    }
    return map;
  }, [bundle]);

  const loadConfig = useCallback(
    async (scopeForSync?: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await slaAlertsService.getSlaConfig(userEmail);
        if (res.success && res.data) {
          const nextBundle: SlaConfigBundle = {
            global: res.data.global || DEFAULT_SLA_CONFIG,
            overrides: Array.isArray(res.data.overrides) ? res.data.overrides : [],
          };
          setBundle(nextBundle);
          const targetScope = scopeForSync ?? selectedScope;
          const exact =
            targetScope === "global"
              ? nextBundle.global
              : nextBundle.overrides.find((ov) => ov.scope_key === targetScope);
          setForm(cloneConfig(exact || nextBundle.global, targetScope));
        } else {
          setError(res.message || "Không tải được cấu hình SLA.");
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Lỗi tải cấu hình SLA.");
      } finally {
        setLoading(false);
      }
    },
    [userEmail, selectedScope],
  );

  useEffect(() => {
    let alive = true;
    void Promise.resolve().then(() => {
      if (alive) void loadConfig();
    });
    return () => {
      alive = false;
    };
  }, [loadConfig, refreshSignal]);

  const handleSelectScope = (scopeKey: string) => {
    setSelectedScope(scopeKey);
    const globalCfg = bundle?.global || DEFAULT_SLA_CONFIG;
    const exact = overrideMap.get(scopeKey);
    setForm(cloneConfig(exact || globalCfg, scopeKey));
    setNotice(null);
    setError(null);
  };

  const hasCustomOverride = selectedScope !== "global" && overrideMap.has(selectedScope);

  const toggleWorkDay = (iso: number) => {
    setForm((prev) => {
      const exists = prev.work_days.includes(iso);
      const next = exists
        ? prev.work_days.filter((d) => d !== iso)
        : [...prev.work_days, iso].sort((a, b) => a - b);
      return { ...prev, work_days: next };
    });
  };

  const updateShift = (index: number, field: keyof SlaShift, value: string) => {
    setForm((prev) => {
      const next = prev.shifts.map((s, idx) => (idx === index ? { ...s, [field]: value } : s));
      return { ...prev, shifts: next };
    });
  };

  const addShift = () => {
    setForm((prev) => ({
      ...prev,
      shifts: [...prev.shifts, { start: "18:00", end: "21:00" }],
    }));
  };

  const removeShift = (index: number) => {
    setForm((prev) => ({
      ...prev,
      shifts: prev.shifts.filter((_, idx) => idx !== index),
    }));
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) return;

    if (form.target_minutes < 1 || form.target_minutes > 1440) {
      setError("Mục tiêu SLA phải nằm trong khoảng 1 đến 1440 phút.");
      return;
    }
    if (form.warning_pct < 10 || form.warning_pct > 99) {
      setError("Ngưỡng cảnh báo vàng phải nằm trong khoảng 10% đến 99%.");
      return;
    }
    if (form.business_hours_enabled) {
      if (form.work_days.length === 0) {
        setError("Vui lòng chọn ít nhất 1 ngày làm việc khi bật chế độ Giờ hành chính.");
        return;
      }
      if (form.shifts.length === 0) {
        setError("Vui lòng cấu hình ít nhất 1 ca làm việc.");
        return;
      }
      for (const sh of form.shifts) {
        if (!sh.start || !sh.end || sh.start >= sh.end) {
          setError(`Ca làm việc không hợp lệ (${sh.start} – ${sh.end}): giờ kết thúc phải sau giờ bắt đầu.`);
          return;
        }
      }
    }

    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const payload: SlaConfig = {
        ...form,
        scope_key: selectedScope,
        timezone: "Asia/Ho_Chi_Minh",
        work_days: form.work_days.length > 0 ? form.work_days : [1, 2, 3, 4, 5, 6],
        shifts:
          form.shifts.length > 0
            ? form.shifts
            : [
                { start: "08:00", end: "12:00" },
                { start: "13:30", end: "17:30" },
              ],
      };
      const res = await slaAlertsService.upsertSlaConfig(payload, user?.email);
      if (res.success) {
        setNotice(
          selectedScope === "global"
            ? "Đã lưu cấu hình SLA mặc định toàn hệ thống."
            : `Đã lưu cấu hình Override SLA cho ${selectedScope.replace("channel:", "").toUpperCase()}.`,
        );
        await loadConfig();
        onSaved?.();
      } else {
        setError(res.message || "Không lưu được cấu hình SLA.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi khi lưu cấu hình SLA.");
    } finally {
      setSaving(false);
    }
  };

  const toggleBackfillChannel = (ch: string) => {
    setBackfillChannels((prev) =>
      prev.includes(ch) ? prev.filter((item) => item !== ch) : [...prev, ch],
    );
  };

  const handleRunBackfill = async () => {
    if (!canEdit) return;
    if (backfillChannels.length === 0) {
      setBackfillError("Vui lòng chọn ít nhất 1 kênh để chạy Backfill.");
      return;
    }
    setBackfilling(true);
    setBackfillError(null);
    setBackfillResult(null);
    try {
      const res = await slaAlertsService.backfillHistory(
        { days: backfillDays, channels: backfillChannels },
        user?.email,
      );
      if (res.success && res.data) {
        setBackfillResult(res.data);
        onSaved?.();
      } else {
        setBackfillError(res.message || "Backfill thất bại.");
      }
    } catch (err) {
      setBackfillError(err instanceof Error ? err.message : "Lỗi khi chạy Backfill dữ liệu lịch sử.");
    } finally {
      setBackfilling(false);
    }
  };

  const warningMinutesPreview = Math.max(
    1,
    Math.round((form.target_minutes * form.warning_pct) / 100 * 10) / 10,
  );

  return (
    <div className="space-y-6">
      {!canEdit && (
        <div className={uiAlert.info}>
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Bạn đang xem ở chế độ chỉ đọc. Chỉ tài khoản <strong>Admin</strong> hoặc{" "}
            <strong>Leader</strong> mới có quyền thay đổi cấu hình SLA và chạy Backfill.
          </span>
        </div>
      )}

      {notice && (
        <div className={uiAlert.success}>
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="flex-1">{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="text-xs font-semibold underline cursor-pointer"
          >
            Đóng
          </button>
        </div>
      )}
      {error && (
        <div className={uiAlert.error}>
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="flex-1">{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-xs font-semibold underline cursor-pointer"
          >
            Đóng
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* ── Left: Scope Selector (Global + Per-Channel Overrides) ──────── */}
        <aside className={`${card} p-4 shadow-2xs lg:col-span-4`}>
          <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <Globe className="h-4 w-4 text-brand" />
            Phạm vi áp dụng SLA
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            Cấu hình Global làm mặc định. Bạn có thể thiết lập Override riêng cho từng kênh.
          </p>

          <div className="mt-4 space-y-2">
            {SCOPE_OPTIONS.map((opt) => {
              const active = selectedScope === opt.scopeKey;
              const savedCfg = overrideMap.get(opt.scopeKey);
              const isOverride = opt.scopeKey !== "global" && Boolean(savedCfg);
              const channelId = opt.scopeKey.startsWith("channel:")
                ? opt.scopeKey.replace("channel:", "")
                : null;
              const chMeta = channelId ? getChannelMeta(channelId) : null;

              return (
                <button
                  key={opt.scopeKey}
                  type="button"
                  onClick={() => handleSelectScope(opt.scopeKey)}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-xl border p-3 text-left transition cursor-pointer",
                    active
                      ? "border-brand bg-brand-subtle/60 shadow-2xs"
                      : "border-slate-200/80 bg-white hover:border-slate-300 hover:bg-slate-50",
                  )}
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    {chMeta ? (
                      <span
                        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[10px] font-extrabold text-white"
                        style={{ backgroundColor: chMeta.color }}
                      >
                        {chMeta.short}
                      </span>
                    ) : (
                      <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand text-white">
                        <Globe className="h-3.5 w-3.5" />
                      </span>
                    )}
                    <div className="min-w-0">
                      <div className="truncate text-xs font-bold text-slate-900">{opt.label}</div>
                      <div className="truncate text-[11px] text-slate-500">
                        {savedCfg
                          ? `SLA ${savedCfg.target_minutes}p · Cảnh báo ${savedCfg.warning_pct}%`
                          : "Đang kế thừa Global"}
                      </div>
                    </div>
                  </div>
                  {opt.scopeKey === "global" ? (
                    <span className="shrink-0 rounded-full bg-brand px-2 py-0.5 text-[10px] font-bold text-white">
                      Mặc định
                    </span>
                  ) : isOverride ? (
                    <span className="shrink-0 rounded-full bg-[#10a39c]/15 px-2 py-0.5 text-[10px] font-bold text-[#0d7f79]">
                      Đã Override
                    </span>
                  ) : (
                    <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                      Kế thừa
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </aside>

        {/* ── Right: SLA Target & Business Hours Form ────────────────────── */}
        <form
          onSubmit={handleSaveConfig}
          className={`${card} p-5 shadow-2xs lg:col-span-8 space-y-6`}
        >
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-slate-900">
                  {selectedScope === "global"
                    ? "Cấu hình SLA Mặc định (Global)"
                    : `Cấu hình Override kênh ${getChannelMeta(selectedScope.replace("channel:", "")).label}`}
                </h3>
                {selectedScope !== "global" && !hasCustomOverride && (
                  <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700">
                    Đang hiển thị bản sao từ Global — bấm Lưu để tạo Override
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-slate-500">
                Múi giờ chuẩn: <strong>Asia/Ho_Chi_Minh (UTC+7)</strong>. Thay đổi áp dụng ngay cho các lượt mới và watchdog SLA.
              </p>
            </div>
            {loading && <Loader2 className="h-4 w-4 animate-spin text-brand" />}
          </div>

          {/* SLA Target + Warning Pct */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-4">
              <label className={uiLabel} htmlFor="sla-target-minutes">
                Mục tiêu phản hồi SLA (phút)
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="sla-target-minutes"
                  type="number"
                  min={1}
                  max={1440}
                  disabled={!canEdit}
                  value={form.target_minutes}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      target_minutes: Math.max(1, Number(e.target.value) || 1),
                    }))
                  }
                  className={`${uiInput} w-28 font-bold tabular-nums`}
                />
                <span className="text-xs font-medium text-slate-600">phút (mặc định 5p)</span>
              </div>
              <p className="mt-1.5 text-[11px] text-slate-500">
                Quá mốc này sẽ đổi sang trạng thái <strong className="text-brand">Quá hạn (đỏ)</strong> và bắn cảnh báo.
              </p>
            </div>

            <div className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-4">
              <label className={uiLabel} htmlFor="sla-warning-pct">
                Ngưỡng cảnh báo sắp hạn (%)
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="sla-warning-pct"
                  type="number"
                  min={10}
                  max={99}
                  disabled={!canEdit}
                  value={form.warning_pct}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      warning_pct: Math.min(99, Math.max(10, Number(e.target.value) || 70)),
                    }))
                  }
                  className={`${uiInput} w-28 font-bold tabular-nums`}
                />
                <span className="text-xs font-medium text-slate-600">
                  % (~<strong>{warningMinutesPreview} phút</strong>)
                </span>
              </div>
              <p className="mt-1.5 text-[11px] text-slate-500">
                Đạt ngưỡng này badge chuyển <strong className="text-amber-700">Sắp hạn (vàng)</strong> để nhắc nhân viên kịp thời.
              </p>
            </div>
          </div>

          {/* Business Hours vs 24/7 */}
          <div className="rounded-2xl border border-slate-200/80 p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#10a39c]/10 text-[#10a39c]">
                  <CalendarClock className="h-4.5 w-4.5" />
                </span>
                <div>
                  <div className="text-sm font-bold text-slate-900">
                    Chế độ tính thời gian theo Giờ Hành Chính
                  </div>
                  <p className="text-xs text-slate-500">
                    {form.business_hours_enabled
                      ? "Đồng hồ SLA tạm dừng ngoài ca làm việc / ngày nghỉ và chạy tiếp vào đầu ca sáng hôm sau."
                      : "Đang bật chế độ 24/7 — đồng hồ SLA chạy liên tục cả đêm và Chủ Nhật."}
                  </p>
                </div>
              </div>

              <button
                type="button"
                disabled={!canEdit}
                onClick={() =>
                  setForm((prev) => ({
                    ...prev,
                    business_hours_enabled: !prev.business_hours_enabled,
                  }))
                }
                className={cn(
                  "inline-flex h-6 w-11 shrink-0 items-center rounded-full transition cursor-pointer disabled:opacity-50",
                  form.business_hours_enabled ? "bg-[#10a39c]" : "bg-slate-300",
                )}
                aria-pressed={form.business_hours_enabled}
              >
                <span
                  className={cn(
                    "h-5 w-5 rounded-full bg-white shadow transition",
                    form.business_hours_enabled ? "translate-x-5" : "translate-x-0.5",
                  )}
                />
              </button>
            </div>

            {form.business_hours_enabled && (
              <div className="space-y-4 border-t border-slate-100 pt-4">
                {/* Work Days Pill Toggle */}
                <div>
                  <label className={uiLabel}>Ngày làm việc trong tuần (T2 – CN)</label>
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    {WEEKDAYS.map((day) => {
                      const active = form.work_days.includes(day.iso);
                      return (
                        <button
                          key={day.iso}
                          type="button"
                          disabled={!canEdit}
                          onClick={() => toggleWorkDay(day.iso)}
                          title={day.full}
                          className={cn(
                            "h-9 min-w-[46px] rounded-full border px-3 text-xs font-bold transition cursor-pointer disabled:opacity-60",
                            active
                              ? "border-brand bg-brand text-white shadow-xs shadow-brand/20"
                              : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
                          )}
                        >
                          {day.short}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Shifts List */}
                <div>
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <label className="text-[13px] font-semibold text-[#2f3e50]">
                      Khung giờ các ca làm việc
                    </label>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={addShift}
                        className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                      >
                        <Plus className="h-3 w-3" />
                        Thêm ca
                      </button>
                    )}
                  </div>
                  <div className="space-y-2">
                    {form.shifts.map((shift, idx) => (
                      <div
                        key={`shift-${idx}`}
                        className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200/80 bg-slate-50/70 px-3 py-2"
                      >
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 min-w-[68px]">
                          <Clock className="h-3.5 w-3.5 text-slate-400" />
                          Ca {idx + 1}
                        </span>
                        <input
                          type="time"
                          disabled={!canEdit}
                          value={shift.start}
                          onChange={(e) => updateShift(idx, "start", e.target.value)}
                          className={`${uiInput} h-8 w-32 text-xs font-semibold tabular-nums`}
                        />
                        <span className="text-xs font-bold text-slate-400">→</span>
                        <input
                          type="time"
                          disabled={!canEdit}
                          value={shift.end}
                          onChange={(e) => updateShift(idx, "end", e.target.value)}
                          className={`${uiInput} h-8 w-32 text-xs font-semibold tabular-nums`}
                        />
                        {canEdit && form.shifts.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeShift(idx)}
                            className="ml-auto rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 cursor-pointer"
                            title="Xóa ca này"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Filtering Rules */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200/80 bg-white p-3.5 hover:bg-slate-50">
              <input
                type="checkbox"
                disabled={!canEdit}
                checked={!form.include_group_chats}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, include_group_chats: !e.target.checked }))
                }
                className="mt-0.5 h-4 w-4 rounded accent-[#ba244a]"
              />
              <div>
                <div className="text-xs font-bold text-slate-900">
                  Loại trừ nhóm chat (Chỉ tính inbox 1-1)
                </div>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  Khuyên bật để tránh tin nhắn trao đổi nội bộ trong nhóm làm sai lệch chỉ số SLA.
                </p>
              </div>
            </label>

            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200/80 bg-white p-3.5 hover:bg-slate-50">
              <input
                type="checkbox"
                disabled={!canEdit}
                checked={form.exclude_bot_replies}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, exclude_bot_replies: e.target.checked }))
                }
                className="mt-0.5 h-4 w-4 rounded accent-[#ba244a]"
              />
              <div>
                <div className="text-xs font-bold text-slate-900">
                  Loại trừ tin trả lời tự động (Bot Auto-Reply)
                </div>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  Chỉ chốt SLA khi nhân viên thật phản hồi, không tính tin nhắn trả lời tự động.
                </p>
              </div>
            </label>
          </div>

          {/* Form Actions */}
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-4">
            <button
              type="button"
              disabled={!canEdit || saving}
              onClick={() => {
                const base = overrideMap.get(selectedScope) || bundle?.global || DEFAULT_SLA_CONFIG;
                setForm(cloneConfig(base, selectedScope));
              }}
              className={`${btn.outline} ${btnSize.sm} cursor-pointer`}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Hoàn tác
            </button>
            <button
              type="submit"
              disabled={!canEdit || saving}
              className={`${btn.primary} ${btnSize.md} cursor-pointer`}
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Lưu cấu hình SLA
            </button>
          </div>
        </form>
      </div>

      {/* ── Historical Backfill Section ─────────────────────────────────────── */}
      <section className={`${card} p-5 shadow-2xs`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-subtle text-brand">
              <DatabaseZap className="h-5 w-5" />
            </span>
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Backfill dữ liệu SLA lịch sử
              </h3>
              <p className="mt-0.5 max-w-2xl text-xs text-slate-500">
                Quét lại tin nhắn lịch sử từ các bảng Zalo, Messenger, Telegram, WhatsApp để tự động tái dựng
                các lượt hỏi-đáp chưa có trong hệ thống SLA (an toàn idempotent, không tạo trùng).
              </p>
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200/80 bg-slate-50/70 p-4">
          <div className="flex flex-wrap items-center gap-6">
            {/* Days picker */}
            <div>
              <div className="mb-1.5 text-xs font-bold text-slate-700">Khoảng lịch sử</div>
              <div className="inline-flex rounded-full border border-slate-200 bg-white p-0.5">
                {[7, 14, 30].map((d) => (
                  <button
                    key={d}
                    type="button"
                    disabled={!canEdit || backfilling}
                    onClick={() => setBackfillDays(d)}
                    className={cn(
                      "rounded-full px-3.5 py-1 text-xs font-bold transition cursor-pointer disabled:opacity-50",
                      backfillDays === d
                        ? "bg-brand text-white shadow-2xs"
                        : "text-slate-600 hover:text-slate-900",
                    )}
                  >
                    {d} ngày
                  </button>
                ))}
              </div>
            </div>

            {/* Channel checkboxes */}
            <div>
              <div className="mb-1.5 text-xs font-bold text-slate-700">Kênh cần tái dựng</div>
              <div className="flex flex-wrap items-center gap-2">
                {PRIMARY_SLA_CHANNELS.map((ch) => {
                  const checked = backfillChannels.includes(ch.id);
                  return (
                    <label
                      key={ch.id}
                      className={cn(
                        "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition",
                        checked
                          ? "border-brand/40 bg-brand-subtle text-brand"
                          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-100",
                      )}
                    >
                      <input
                        type="checkbox"
                        disabled={!canEdit || backfilling}
                        checked={checked}
                        onChange={() => toggleBackfillChannel(ch.id)}
                        className="h-3.5 w-3.5 accent-[#ba244a]"
                      />
                      {ch.label}
                    </label>
                  );
                })}
              </div>
            </div>
          </div>

          <button
            type="button"
            disabled={!canEdit || backfilling || backfillChannels.length === 0}
            onClick={() => void handleRunBackfill()}
            className={`${btn.primary} ${btnSize.md} cursor-pointer`}
          >
            {backfilling ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <DatabaseZap className="h-4 w-4" />
            )}
            {backfilling ? "Đang quét lịch sử..." : "Chạy Backfill ngay"}
          </button>
        </div>

        {backfillError && (
          <div className={`mt-3 ${uiAlert.error}`}>
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{backfillError}</span>
          </div>
        )}

        {backfillResult && (
          <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-bold text-emerald-800">
                <CheckCircle2 className="h-4.5 w-4.5" />
                Backfill hoàn tất!
              </div>
              <div className="flex flex-wrap items-center gap-4 text-xs font-semibold text-emerald-900 tabular-nums">
                <span>
                  Tin nhắn đã quét: <strong>{backfillResult.processed_messages.toLocaleString("vi-VN")}</strong>
                </span>
                <span>
                  Lượt SLA đã tái dựng: <strong>{backfillResult.turns_created.toLocaleString("vi-VN")}</strong>
                </span>
              </div>
            </div>

            {backfillResult.by_channel && Object.keys(backfillResult.by_channel).length > 0 && (
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {Object.entries(backfillResult.by_channel).map(([ch, stats]) => {
                  const meta = getChannelMeta(ch);
                  const turns = typeof stats === "number" ? stats : stats?.turns_created ?? 0;
                  const msgs = typeof stats === "number" ? null : stats?.processed_messages ?? null;
                  return (
                    <div
                      key={ch}
                      className="rounded-xl border border-emerald-200/80 bg-white px-3 py-2 text-xs"
                    >
                      <div className="font-bold text-slate-800">{meta.label}</div>
                      <div className="mt-0.5 text-[11px] text-slate-600 tabular-nums">
                        +{turns} lượt SLA
                        {msgs !== null ? ` (${msgs} tin)` : ""}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
