"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { MaterialIcon, type MaterialSymbolName } from "@/components/ui";
import { useAppAuth } from "@/contexts/AppAuthContext";
import {
  kpiRewardsService,
  teamsService,
  type KpiGoalStatus,
  type KpiRewardMemberSummary,
  type KpiRewardMetric,
  type KpiRewardRule,
  type KpiRewardRuleLog,
  type KpiRewardSummary,
  type KpiRuleSource,
  type TeamRow,
} from "@/services/all-platform.service";
import { cn } from "@/lib/utils";
import { getTeamTypeLabel } from "@/lib/teamTypes";
import { CurrencyInput } from "@/components/CurrencyInput";

type RuleGroup = {
  key: KpiRewardMetric;
  label: string;
  weightLabel: string;
  defaultWeight: number;
  defaultThreshold: number;
  defaultReward: number;
  defaultMaxRate: number;
  icon: MaterialSymbolName;
  // Mau badge icon rieng cho tung metric - giup quet mat nhanh khi nhin ca bang
  // (Leader ngay tra luong hay nhin luot qua nhieu dong), khong to nen ca dong/cot
  // de tranh loe loet nhu ban thiet ke truoc.
  badgeClass: string;
};

const RULE_GROUPS: RuleGroup[] = [
  {
    key: "total_bonus",
    label: "BONUS TOTAL",
    weightLabel: "",
    defaultWeight: 100,
    defaultThreshold: 75,
    defaultReward: 100000,
    defaultMaxRate: 200,
    icon: "account_balance_wallet",
    badgeClass: "bg-emerald-50 text-emerald-700",
  },
  {
    key: "lead",
    label: "LEAD",
    weightLabel: "40%",
    defaultWeight: 40,
    defaultThreshold: 80,
    defaultReward: 10000,
    defaultMaxRate: 200,
    icon: "person",
    badgeClass: "bg-violet-50 text-violet-700",
  },
  {
    key: "inbox",
    label: "INBOX",
    weightLabel: "30%",
    defaultWeight: 30,
    defaultThreshold: 80,
    defaultReward: 3000,
    defaultMaxRate: 200,
    icon: "mail",
    badgeClass: "bg-amber-50 text-amber-700",
  },
  {
    key: "post",
    label: "POST",
    weightLabel: "20%",
    defaultWeight: 20,
    defaultThreshold: 80,
    defaultReward: 2000,
    defaultMaxRate: 200,
    icon: "send",
    badgeClass: "bg-blue-50 text-blue-700",
  },
  {
    key: "comment",
    label: "COMMENT",
    weightLabel: "10%",
    defaultWeight: 10,
    defaultThreshold: 80,
    defaultReward: 1000,
    defaultMaxRate: 200,
    icon: "chat_bubble",
    badgeClass: "bg-sky-50 text-sky-700",
  },
];

function formatLogValue(field: string, value: number | null): string {
  if (value === null) return "—";
  if (field === "threshold_value" || field === "max_rate") return `${formatNumber(value)}%`;
  return formatVnd(value);
}

function splitWeek(value: string): { startDate: string; endDate: string } {
  const [startDate, endDate] = value.split("_");
  return { startDate, endDate };
}

function formatDateVN(value: string): string {
  const [y, m, d] = value.split("-");
  if (!y || !m || !d) return value;
  return `${d}/${m}/${y}`;
}

// So thu tu tuan trong nam theo cung quy uoc voi AssignKpiModal.generateWeeks:
// tuan 1 bat dau tu thu Hai cua/truoc ngay 1/1.
function getWeekNumber(dateStr: string): number {
  const date = new Date(`${dateStr}T00:00:00`);
  const year = date.getFullYear();
  const firstDay = new Date(year, 0, 1);
  const dayOfWeek = firstDay.getDay() || 7;
  const startMonday = new Date(firstDay);
  startMonday.setDate(firstDay.getDate() - dayOfWeek + 1);
  const diffDays = Math.round((date.getTime() - startMonday.getTime()) / 86400000);
  return Math.floor(diffDays / 7) + 1;
}

function formatWeekLabel(startDate: string, endDate: string): string {
  return `Tuần ${getWeekNumber(startDate)} (${formatDateVN(startDate)} - ${formatDateVN(endDate)})`;
}

function getCurrentWeekValue(): string {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmt = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return `${fmt(monday)}_${fmt(sunday)}`;
}

function formatVnd(value: number): string {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(value || 0);
}

function defaultRules(teamId: string, startDate: string, endDate: string): KpiRewardRule[] {
  return RULE_GROUPS.map((group) => ({
    teamId,
    startDate,
    endDate,
    metric: group.key,
    weight: group.defaultWeight,
    thresholdValue: group.defaultThreshold,
    rewardPerUnit: group.defaultReward,
    maxReward: null,
    maxRate: group.defaultMaxRate,
    status: "approved",
  }));
}

function normalizeRules(
  teamId: string,
  startDate: string,
  endDate: string,
  rules: KpiRewardRule[],
): KpiRewardRule[] {
  const map = new Map(rules.map((rule) => [rule.metric, rule]));
  return defaultRules(teamId, startDate, endDate).map((fallback) => ({
    ...fallback,
    ...(map.get(fallback.metric) || {}),
    maxRate: map.get(fallback.metric)?.maxRate ?? fallback.maxRate,
  }));
}

function getRule(rules: KpiRewardRule[], metric: KpiRewardMetric): KpiRewardRule {
  return rules.find((rule) => rule.metric === metric)!;
}

// Cong thuc dung THU TU: tinh Max Bonus (tran) TRUOC tu rewardPerUnit x target x
// maxRate/100, roi Total Bonus (du kien o dung target) MOI tinh SAU = min(raw, Max
// Bonus) - dam bao Total khong bao gio vuot Max khi maxRate < 100%. Ap dung cho ca
// Lead/Inbox/Post/Comment (truoc day Lead bi thieu cot Max Bonus). Rieng BONUS TOTAL
// la 1 khoan thuong CO DINH (khong theo cong thuc don vi x target) nen khong co Max
// rieng - Total Bonus cua no = Bonus co dinh + tong Total Bonus (da gioi han) cua 4
// metric con lai. Khong duoc de nguoi dung nhap tay may truong nay - luon tinh lai.
function computeMetricBonuses(
  rules: KpiRewardRule[],
  targetsByMetric: Record<"lead" | "inbox" | "post" | "comment", number>,
): {
  totalByMetric: Record<KpiRewardMetric, number>;
  maxByMetric: Record<"lead" | "inbox" | "post" | "comment", number>;
} {
  const maxByMetric = {} as Record<"lead" | "inbox" | "post" | "comment", number>;
  const totalByMetric = { lead: 0, inbox: 0, post: 0, comment: 0 } as Record<"lead" | "inbox" | "post" | "comment", number>;
  (["lead", "inbox", "post", "comment"] as const).forEach((metric) => {
    const rule = getRule(rules, metric);
    const raw = (rule.rewardPerUnit || 0) * (targetsByMetric[metric] || 0);
    const maxBonus = raw * ((rule.maxRate || 200) / 100);
    maxByMetric[metric] = maxBonus;
    totalByMetric[metric] = Math.min(raw, maxBonus);
  });
  const flatBonus = getRule(rules, "total_bonus").rewardPerUnit || 0;
  return {
    totalByMetric: {
      ...totalByMetric,
      total_bonus: flatBonus + totalByMetric.lead + totalByMetric.inbox + totalByMetric.post + totalByMetric.comment,
    },
    maxByMetric,
  };
}

// Chi mau chu phan biet % / max, khong to nen o - giu giao dien tho gion nhu
// cot Total (khong khung/bo goc). Khi chua bam "Chinh sua" thi khong co gach
// chan de tranh nhin lam tuong la o bam duoc, giam bam nham.
const RULE_INPUT_TONES: Record<"plain" | "percent" | "max", string> = {
  plain: "text-slate-700",
  percent: "text-amber-700",
  max: "text-rose-700",
};

function RuleInput({
  value,
  onChange,
  disabled,
  suffix,
  tone = "plain",
  editable = false,
  money = false,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
  disabled?: boolean;
  suffix?: string;
  tone?: "plain" | "percent" | "max";
  editable?: boolean;
  money?: boolean;
}) {
  const textClass = RULE_INPUT_TONES[tone];
  return (
    <div
      className={cn(
        "flex h-8 items-center justify-end gap-0.5 px-1",
        editable && !disabled ? "border-b border-slate-400" : "",
      )}
    >
      {money ? (
        <CurrencyInput
          maxLength={15}
          title={value === null || value === undefined ? undefined : formatNumber(value)}
          value={value}
          disabled={disabled}
          onChange={(next) => onChange(next === null ? null : Math.max(0, next))}
          className={cn(
            "min-w-0 flex-1 overflow-hidden text-ellipsis appearance-none bg-transparent text-right text-[11px] font-semibold outline-none disabled:cursor-default xl:text-[12px]",
            textClass,
          )}
        />
      ) : (
        <input
          type="number"
          min={0}
          value={value ?? ""}
          disabled={disabled}
          onChange={(event) => {
            const raw = event.target.value;
            onChange(raw === "" ? null : Math.max(0, Number(raw) || 0));
          }}
          className={cn(
            "min-w-0 flex-1 appearance-none bg-transparent text-right text-[11px] font-semibold outline-none disabled:cursor-default xl:text-[12px]",
            "[&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
            textClass,
          )}
        />
      )}
      {suffix ? <span className={cn("ml-0.5 text-[10px] font-semibold", textClass)}>{suffix}</span> : null}
    </div>
  );
}

export function KpiRewardRuleTable({
  teamId,
  selectedWeek,
  readOnly = false,
  onChanged,
  autoEdit = false,
}: {
  teamId: string;
  selectedWeek: string;
  readOnly?: boolean;
  onChanged?: () => void;
  // Bam thang vao che do sua ngay khi mo (vd tu nut but trong bang accordion cua
  // Admin) - khong bat nguoi dung phai bam them 1 lan "Chinh sua" nua.
  autoEdit?: boolean;
}) {
  const { startDate, endDate } = splitWeek(selectedWeek);
  const [rules, setRules] = useState<KpiRewardRule[]>(() => defaultRules(teamId, startDate, endDate));
  const [note, setNote] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  // Mac dinh khoa - phai bam "Chinh sua" moi mo duoc cac o nhap, tranh bam nham
  // vao rule dang dung cho ca team khi chi dinh xem qua.
  const [isEditing, setIsEditing] = useState(false);
  const canEdit = !readOnly && isEditing;
  // Snapshot rules+note luc bat dau sua - bam "Huy" thi phuc hoi lai dung snapshot
  // nay (khong goi lai API), tranh truong hop bam tat che do sua ma gia tri da go
  // van con nguyen trong state (nhu truoc day khi chi co 1 nut toggle).
  const [editSnapshot, setEditSnapshot] = useState<{ rules: KpiRewardRule[]; note: string } | null>(null);
  const [logs, setLogs] = useState<KpiRewardRuleLog[]>([]);
  // Nguon cua rule dang hien thi: "current" = da luu dung tuan nay, "copied" = tu dong
  // sao chep tu tuan gan nhat truoc do (chua luu cho tuan nay), "default" = chua tung
  // co rule nao, dung mac dinh. Giup leader biet ro dang xem gi truoc khi bam Luu.
  const [ruleSource, setRuleSource] = useState<"current" | "copied" | "default">("current");
  const [sourceWeek, setSourceWeek] = useState<{ start: string; end: string } | null>(null);
  const [summary, setSummary] = useState<KpiRewardSummary | null>(null);

  // Target cua ca team (gop tung thanh vien lai theo metric) - dung de tinh Total
  // Bonus/Max Bonus DU KIEN trong bang rule (khong phai tien thuong thuc nhan).
  const teamTargets = useMemo(() => {
    const targets = { lead: 0, inbox: 0, post: 0, comment: 0 };
    for (const member of summary?.memberSummaries || []) {
      if (member.teamId !== teamId) continue;
      (["lead", "inbox", "post", "comment"] as const).forEach((metric) => {
        targets[metric] += member.targets[metric] || 0;
      });
    }
    return targets;
  }, [summary, teamId]);

  // Max Bonus (tran) tinh truoc, Total Bonus (du kien) tinh sau = min(raw, Max) -
  // luon tinh lai tu rules + teamTargets, KHONG cho nhap tay may truong nay.
  const { totalByMetric: totalBonusByMetric, maxByMetric } = useMemo(
    () => computeMetricBonuses(rules, teamTargets),
    [rules, teamTargets],
  );

  const loadLogs = useCallback(async () => {
    if (!teamId) return;
    const res = await kpiRewardsService.logs({ teamId, startDate, endDate });
    setLogs(res.success && res.data ? res.data : []);
  }, [teamId, startDate, endDate]);

  const loadSummary = useCallback(async () => {
    if (!teamId) return;
    const res = await kpiRewardsService.summary({ teamId, startDate, endDate });
    setSummary(res.success && res.data ? res.data : null);
  }, [teamId, startDate, endDate]);

  const loadRules = useCallback(async () => {
    if (!teamId) return;
    setIsLoading(true);
    try {
      const res = await kpiRewardsService.effectiveRules({ teamId, startDate, endDate });
      const effective = res.success && res.data ? res.data : { rules: [], source: "default" as const, sourceWeek: null };
      const next = normalizeRules(teamId, startDate, endDate, effective.rules);
      setRules(next);
      setNote(next.find((rule) => rule.leaderNote)?.leaderNote || next.find((rule) => rule.adminNote)?.adminNote || "");
      setRuleSource(effective.source);
      setSourceWeek(effective.sourceWeek);
      setIsEditing(false);
    } finally {
      setIsLoading(false);
    }
  }, [teamId, startDate, endDate]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadRules();
      void loadLogs();
      void loadSummary();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadRules, loadLogs, loadSummary]);

  const updateRule = (metric: KpiRewardMetric, patch: Partial<KpiRewardRule>) => {
    setRules((current) => current.map((rule) => (rule.metric === metric ? { ...rule, ...patch } : rule)));
  };

  const startEditing = () => {
    setEditSnapshot({ rules, note });
    setIsEditing(true);
  };

  useEffect(() => {
    if (!autoEdit || readOnly || isLoading || isEditing) return;
    const timer = window.setTimeout(() => {
      startEditing();
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoEdit, isLoading]);

  const cancelEditing = () => {
    if (editSnapshot) {
      setRules(editSnapshot.rules);
      setNote(editSnapshot.note);
    }
    setEditSnapshot(null);
    setIsEditing(false);
  };

  const payloadRules = rules.map((rule) => ({
    metric: rule.metric,
    weight: Number(rule.weight || 0),
    threshold_value: Number(rule.thresholdValue || 0),
    reward_per_unit: Number(rule.rewardPerUnit || 0),
    max_reward: rule.maxReward === null ? null : Number(rule.maxReward || 0),
    max_rate: Number(rule.maxRate || 200),
  }));

  const saveActive = async () => {
    setIsSaving(true);
    try {
      const res = await kpiRewardsService.saveActive({
        team_id: teamId,
        start_date: startDate,
        end_date: endDate,
        leader_note: note,
        admin_note: note,
        rules: payloadRules,
      });
      if (!res.success) throw new Error(res.message || "Lưu rule thất bại");
      toast.success("Đã lưu rule KPI & thưởng đang dùng");
      setEditSnapshot(null);
      await loadRules();
      await loadLogs();
      await loadSummary();
      onChanged?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Lưu rule thất bại");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-white shadow-sm">
      {/* Man THIET LAP - khong hien du lieu ket qua/thuc te cua thanh vien, khong
          progress, khong trang thai dat/chua dat. Chi cau hinh + luu. */}
      <div className="flex flex-col gap-3 border-b border-border px-5 py-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-base font-bold text-foreground">Rule KPI & Thưởng</h2>
          <p className="mt-1 text-[12px] text-muted-foreground">Thiết lập quy tắc thưởng theo team và tuần</p>
          {ruleSource === "copied" && sourceWeek ? (
            <p className="mt-1 flex items-center gap-1 text-[12px] font-medium text-amber-700">
              <MaterialIcon name="content_copy" className="text-sm" />
              Đang dùng cấu hình của {formatWeekLabel(sourceWeek.start, sourceWeek.end)}. Vui lòng kiểm tra và lưu lại để áp dụng cho tuần này.
            </p>
          ) : null}
          {ruleSource === "default" ? (
            <p className="mt-1 flex items-center gap-1 text-[12px] font-medium text-amber-700">
              <MaterialIcon name="info" className="text-sm" />
              Team chưa từng cài rule - đang dùng cấu hình mặc định, chưa lưu cho tuần này.
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <span className="flex h-9 items-center rounded-lg bg-primary/10 px-3 text-[12px] font-bold text-primary">
            Tuần {getWeekNumber(startDate)}
          </span>
          {isLoading ? <span className="text-[12px] text-muted-foreground">Đang tải...</span> : null}
          {!readOnly ? (
            isEditing ? (
              <>
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={cancelEditing}
                  className="flex h-9 items-center gap-1.5 rounded-lg bg-zinc-100 px-3 text-[12px] font-semibold text-foreground transition hover:bg-zinc-200 disabled:opacity-50"
                >
                  <MaterialIcon name="close" className="text-base" />
                  Hủy
                </button>
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={saveActive}
                  className="flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-[12px] font-semibold text-white transition disabled:opacity-50"
                >
                  <MaterialIcon name="check" className="text-base" />
                  {isSaving ? "Đang lưu..." : `Lưu rule tuần`}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={startEditing}
                className="flex h-9 items-center gap-1.5 rounded-lg bg-zinc-100 px-3 text-[12px] font-semibold text-foreground transition hover:bg-zinc-200"
              >
                <MaterialIcon name="edit" className="text-base" />
                Chỉnh sửa
              </button>
            )
          ) : null}
        </div>
      </div>

      {/* Bang chi so day du - moi metric 1 dong (ke ca BONUS TOTAL), 4 cot: Nguong (%),
          Bonus/don vi, Total Bonus, Max Bonus. Max Bonus tinh TRUOC (tran = rewardPerUnit
          x target x maxRate/100), Total Bonus tinh SAU = min(raw, Max Bonus) - dam bao
          Total khong bao gio vuot Max. BONUS TOTAL la khoan co dinh (khong theo don vi)
          nen khong co Max rieng. */}
      <div className="p-5">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b-2 border-border text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2.5 text-left">Chỉ số</th>
              <th className="w-[100px] px-2 py-2.5 text-right">Ngưỡng (%)</th>
              <th className="w-[130px] px-2 py-2.5 text-right">Bonus / đơn vị</th>
              <th className="w-[140px] px-2 py-2.5 text-right">Total Bonus</th>
              <th className="w-[130px] px-2 py-2.5 text-right">Max Bonus</th>
            </tr>
          </thead>
          <tbody>
            {RULE_GROUPS.map((group, idx) => {
              const rule = getRule(rules, group.key);
              const totalBonus = totalBonusByMetric[group.key];
              const hasThreshold = group.key === "total_bonus" || group.key === "lead";
              const maxBonus = group.key === "total_bonus" ? null : maxByMetric[group.key as "lead" | "inbox" | "post" | "comment"];
              return (
                <tr
                  key={group.key}
                  className={cn("border-b border-border last:border-b-0", idx % 2 === 1 && "bg-slate-50/60")}
                >
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2.5 font-bold text-foreground">
                      <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", group.badgeClass)}>
                        <MaterialIcon name={group.icon} className="text-sm" />
                      </span>
                      {group.label}
                      {group.weightLabel ? (
                        <span className="font-normal text-muted-foreground">({group.weightLabel})</span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-2 py-1">
                    {hasThreshold ? (
                      <RuleInput
                        value={rule.thresholdValue}
                        suffix="%"
                        tone="percent"
                        editable={canEdit}
                        disabled={!canEdit}
                        onChange={(value) => updateRule(group.key, { thresholdValue: value ?? 0 })}
                      />
                    ) : (
                      <span className="block text-center text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-2 py-1">
                    <RuleInput
                      value={rule.rewardPerUnit}
                      editable={canEdit}
                      disabled={!canEdit}
                      money
                      onChange={(value) => updateRule(group.key, { rewardPerUnit: value ?? 0 })}
                    />
                  </td>
                  <td className="overflow-hidden text-ellipsis whitespace-nowrap px-2 py-2 text-right font-black tabular-nums text-emerald-800" title={formatVnd(totalBonus)}>
                    {formatVnd(totalBonus)}
                  </td>
                  <td className="overflow-hidden text-ellipsis whitespace-nowrap px-2 py-1.5 text-right font-semibold text-rose-700 tabular-nums" title={maxBonus === null ? undefined : formatVnd(maxBonus)}>
                    {maxBonus === null ? <span className="block text-center text-muted-foreground">—</span> : formatVnd(maxBonus)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="mt-3 flex items-center gap-3 rounded-lg border border-border bg-slate-50 px-3 py-2">
          <MaterialIcon name="military_tech" className="text-base text-muted-foreground" />
          <span className="text-[12px] font-semibold text-muted-foreground">
            Max Rate <span className="font-normal">(áp dụng cho Lead / Inbox / Post / Comment)</span>
          </span>
          <div className="ml-auto w-[100px]">
            <RuleInput
              value={getRule(rules, "lead").maxRate}
              suffix="%"
              tone="max"
              editable={canEdit}
              disabled={!canEdit}
              onChange={(value) => {
                const maxRate = value ?? 0;
                RULE_GROUPS.forEach((group) => updateRule(group.key, { maxRate }));
              }}
            />
          </div>
        </div>
      </div>

      {!readOnly ? (
        <div className="space-y-3 border-t border-border px-5 py-4">
          <label className="block text-[12px] font-semibold text-muted-foreground">Ghi chú áp dụng cho tuần này</label>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            disabled={!isEditing}
            placeholder="Nhập ghi chú áp dụng cho tuần này (không bắt buộc)..."
            className="min-h-[64px] w-full rounded-xl border border-border px-3 py-2 text-[13px] outline-none focus:border-primary disabled:bg-muted/40 disabled:text-muted-foreground"
          />
        </div>
      ) : null}

      <div className="flex items-center gap-1.5 border-t border-border bg-slate-50 px-5 py-3 text-[12px] text-muted-foreground">
        <MaterialIcon name="info" className="text-sm shrink-0" />
        Rule này sẽ được dùng để tính KPI và thưởng cho team này trong tuần {formatDateVN(startDate)} - {formatDateVN(endDate)}.
      </div>

      {/* Nhat ky chinh sua - thu gon mac dinh, bam moi xem, tranh lam man Rule roi mat. */}
      <details className="border-t border-border px-5 py-3 text-[12px]">
        <summary className="cursor-pointer select-none font-semibold text-muted-foreground">
          Nhật ký chỉnh sửa {logs.length > 0 ? `(${logs.length})` : ""}
        </summary>
        <div className="mt-2">
          {logs.length === 0 ? (
            <p className="text-muted-foreground">Chưa có thay đổi nào cho team và tuần này.</p>
          ) : (
            <ul className="space-y-2">
              {logs.map((log) => (
                <li key={log.id} className="rounded-lg border border-border bg-muted/30 px-3 py-2">
                  <div className="flex flex-wrap items-center gap-1.5 font-semibold text-foreground">
                    <MaterialIcon name="person" className="text-sm text-muted-foreground" />
                    {log.changedByName}
                    <span className="font-normal text-muted-foreground">
                      · {new Date(log.createdAt).toLocaleString("vi-VN")}
                    </span>
                  </div>
                  <ul className="mt-1 space-y-0.5 pl-5 text-muted-foreground">
                    {log.changes.map((change, idx) => (
                      <li key={`${log.id}-${idx}`}>
                        {change.metricLabel} · {change.fieldLabel}:{" "}
                        <span className="font-semibold text-rose-700">{formatLogValue(change.field, change.oldValue)}</span>
                        {" → "}
                        <span className="font-semibold text-emerald-700">{formatLogValue(change.field, change.newValue)}</span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>
      </details>
    </section>
  );
}

// Bang mau categorical co dinh (khong xoay vong tuy y) - dung de phan biet tung
// team trong bang ket qua khi xem "Tat ca team". Thu tu nay da qua validate
// CVD/contrast (xem skill dataviz), khong tu y doi thu tu.
const TEAM_COLORS = [
  "#2a78d6", // blue
  "#008300", // green
  "#e87ba4", // magenta
  "#eda100", // yellow
  "#1baf7a", // aqua
  "#eb6834", // orange
  "#4a3aa7", // violet
  "#e34948", // red
];

// Cung 1 tong mau pastel voi badgeClass cua RULE_GROUPS (Lead tim, Inbox vang,
// Post xanh duong, Comment xanh da troi) - dong bo ngon ngu thiet ke giua bang
// Rule va bang Ket qua, nhat thay vi to nguyen header dam mau nhu truoc.
const METRIC_HEADER_CLASS: Record<"lead" | "inbox" | "post" | "comment", string> = {
  lead: "bg-violet-50 text-violet-800",
  inbox: "bg-amber-50 text-amber-800",
  post: "bg-blue-50 text-blue-800",
  comment: "bg-sky-50 text-sky-800",
};

const KPI_GOAL_LABEL: Record<KpiGoalStatus, string> = {
  dat: "Đạt",
  gan_dat: "Gần đạt",
  chua_dat: "Chưa đạt",
};

// Mau thanh progress mong (khong dung nen o to nguyen dong/cot) theo trang thai
// dat/gan_dat/chua_dat - dung chung cho ca bang team va bang chi tiet thanh vien.
const KPI_GOAL_BAR: Record<KpiGoalStatus, string> = {
  dat: "bg-emerald-500",
  gan_dat: "bg-amber-500",
  chua_dat: "bg-slate-300",
};

// Dot mau + chu (khong to nen ca badge) - "Chua dat" la trang thai PHO BIEN nhat
// trong du lieu that (nhieu thanh vien chua dat KPI tuan), to nen do dam khap bang
// se rat "moi mat". Dot nho + chu mau nhe van du de phan biet ma khong nang mat.
const KPI_GOAL_DOT: Record<KpiGoalStatus, string> = {
  dat: "bg-emerald-500",
  gan_dat: "bg-amber-500",
  chua_dat: "bg-slate-300",
};

const KPI_GOAL_TEXT: Record<KpiGoalStatus, string> = {
  dat: "text-emerald-700",
  gan_dat: "text-amber-700",
  chua_dat: "text-muted-foreground",
};

function KpiGoalBadge({ status, percent }: { status: KpiGoalStatus; percent?: number }) {
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap text-[11px] font-semibold", KPI_GOAL_TEXT[status])}>
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", KPI_GOAL_DOT[status])} />
      {percent !== undefined ? `${formatNumber(percent)}% · ` : ""}
      {KPI_GOAL_LABEL[status]}
    </span>
  );
}

export function KpiRewardResultsTable({
  summary,
  teamId,
  teams,
}: {
  summary: KpiRewardSummary | null;
  teamId?: string;
  /** Optional — dùng để hiện tag Loại team (Sale/Dev/...) kế bên tên team.
   * Không truyền thì không hiện tag (vd view Leader/Member chỉ xem 1 team). */
  teams?: TeamRow[];
}) {
  const teamTypeById = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of teams || []) map.set(t.id, t.team_type || "khac");
    return map;
  }, [teams]);
  const rows = useMemo(() => {
    const items = summary?.memberSummaries || [];
    return teamId ? items.filter((item) => item.teamId === teamId) : items;
  }, [summary, teamId]);

  // Nhom hang theo team de nhin ra ngay team nao voi team nao khi xem "Tat ca team" -
  // moi team gan 1 mau co dinh theo thu tu xuat hien (khong xoay ngau nhien).
  const groupedByTeam = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, { teamId: string; teamName: string; rows: typeof rows }>();
    for (const row of rows) {
      let group = map.get(row.teamId);
      if (!group) {
        group = { teamId: row.teamId, teamName: row.teamName, rows: [] };
        map.set(row.teamId, group);
        order.push(row.teamId);
      }
      group.rows.push(row);
    }
    return order.map((id) => map.get(id)!);
  }, [rows]);

  // Xem 1 team (Leader/Member): 1 box duy nhat, khong can tach, luon mo san. Xem
  // "Tat ca team" (Admin): moi team la 1 box rieng co the thu gon - tach bach ro
  // rang giua cac team thay vi don chung vao 1 bang to voi dong header mau xen giua.
  if (teamId) {
    const group = groupedByTeam[0];
    return (
      <MemberResultsBox
        title="Kết quả KPI & tiền thưởng"
        subtitle="Tính từ dữ liệu Lead, Inbox, Post, Comment thật của tuần đang chọn."
        rows={group?.rows || []}
        color={TEAM_COLORS[0]}
        defaultExpanded
      />
    );
  }

  // Khong doi vi tri team o day (giu dung thu tu xuat hien) - sap xep theo hang
  // CHI co o bang "Tong thuong theo team" thoi, tranh roi vi trong 2 cho khac nhau.
  // Van tinh hang/huan chuong theo tong thuong de gan badge, nhung KHONG dung de
  // sap xep lai danh sach hien thi.
  const RANK_MEDAL = ["🥇", "🥈", "🥉"];
  const rankByTeamId = new Map(
    [...groupedByTeam]
      .sort((a, b) => b.rows.reduce((sum, r) => sum + r.totalReward, 0) - a.rows.reduce((sum, r) => sum + r.totalReward, 0))
      .map((group, idx) => [group.teamId, idx + 1]),
  );

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-base font-bold text-foreground">Kết quả KPI & tiền thưởng</h2>
        <p className="mt-1 text-[12px] text-muted-foreground">
          Tính từ dữ liệu Lead, Inbox, Post, Comment thật của tuần đang chọn. Mỗi team 1 khối riêng.
        </p>
      </div>

      {groupedByTeam.length === 0 ? (
        <div className="rounded-xl border border-border bg-white px-4 py-12 text-center text-muted-foreground shadow-sm">
          Chưa có dữ liệu thưởng cho tuần này.
        </div>
      ) : (
        groupedByTeam.map((group, groupIndex) => {
          const rank = rankByTeamId.get(group.teamId) || 0;
          return (
            <MemberResultsBox
              key={group.teamId}
              title={group.teamName}
              teamType={teamTypeById.get(group.teamId)}
              rows={group.rows}
              color={TEAM_COLORS[groupIndex % TEAM_COLORS.length]}
              rankBadge={RANK_MEDAL[rank - 1]}
              defaultExpanded={groupIndex === 0}
            />
          );
        })
      )}
    </div>
  );
}

// 1 box = 1 team: header kieu Notion (avatar tron + ten team + so thanh vien +
// tong thuong cua rieng team do) + bang chi tiet thanh vien - co the thu gon de
// trang khong bi qua dai khi xem nhieu team cung luc.
function MemberResultsBox({
  title,
  teamType,
  subtitle,
  rows,
  color,
  rankBadge,
  defaultExpanded = true,
}: {
  title: string;
  teamType?: string;
  subtitle?: string;
  rows: KpiRewardMemberSummary[];
  color: string;
  rankBadge?: string;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const sortedRows = [...rows].sort((a, b) => b.totalReward - a.totalReward);
  const teamTotal = rows.reduce((sum, row) => sum + row.totalReward, 0);
  const topMember = sortedRows[0];

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50"
        style={{ backgroundColor: `${color}0d` }}
      >
        <div className="flex min-w-0 items-center gap-3">
          <div className="min-w-0">
            <h3 className="flex items-center gap-1.5 truncate text-[13px] font-bold text-foreground">
              {title}
              {teamType ? (
                <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold uppercase text-primary">
                  {getTeamTypeLabel(teamType)}
                </span>
              ) : null}
              {rankBadge ? <span className="shrink-0 text-base leading-none">{rankBadge}</span> : null}
            </h3>
            <p className="truncate text-[11px] text-muted-foreground">
              {subtitle || `${rows.length} thành viên${topMember ? ` · Dẫn đầu: ${topMember.memberName}` : ""}`}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3 text-right">
          <span className="text-[11px] text-muted-foreground">{rows.length} thành viên</span>
          <span className="text-[13px] font-black tabular-nums text-emerald-800">{formatVnd(teamTotal)}</span>
        </div>
      </button>

      {!expanded ? null : (
      <div className="max-h-[60vh] overflow-auto border-t border-border">
        <table className="w-full min-w-[760px] table-fixed border-collapse text-left text-[11px]">
          <thead className="sticky top-0 z-10">
            <tr>
              <th className="w-[22%] border border-border bg-slate-100 px-2 py-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Thành viên</th>
              <th className="w-[10%] border border-border bg-slate-100 px-1 py-2 text-right text-[11px] font-bold uppercase tracking-wide text-muted-foreground">KPI tổng</th>
              {(["lead", "inbox", "post", "comment"] as const).map((metric) => (
                <th key={metric} className={cn("border border-border px-1 py-2 text-right font-black", METRIC_HEADER_CLASS[metric])}>
                  {metric.toUpperCase()}
                </th>
              ))}
              <th className="w-[10%] border border-border bg-slate-100 px-1 py-2 text-right text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Thưởng</th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.length === 0 ? (
              <tr>
                <td colSpan={7} className="border border-border px-4 py-10 text-center text-muted-foreground">
                  Chưa có dữ liệu thưởng cho team và tuần này.
                </td>
              </tr>
            ) : (
              sortedRows.map((row, rowIdx) => (
                <tr
                  key={`${row.teamId}-${row.memberId}`}
                  className={cn("transition-colors hover:bg-slate-50", rowIdx % 2 === 1 && "bg-slate-50/60")}
                >
                  <td className="border border-border px-2 py-2">
                    <div className="flex items-center gap-2">
                      <span
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-black text-white"
                        style={{ backgroundColor: color }}
                      >
                        {(row.memberName || "?").trim().charAt(0).toUpperCase()}
                      </span>
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-foreground">{row.memberName}</div>
                        <div className="truncate text-[10px] text-muted-foreground">{row.memberEmail}</div>
                      </div>
                    </div>
                  </td>
                  <td className="border border-border px-1 py-2 text-right">
                    <KpiGoalBadge status={row.kpiStatus} percent={row.kpiPercent ?? 0} />
                  </td>
                  {(["lead", "inbox", "post", "comment"] as const).map((metric) => {
                    const metricStatus = row.metricStatuses?.[metric] ?? "chua_dat";
                    const metricPercent = row.metricPercents?.[metric] ?? 0;
                    return (
                      <td key={metric} className="border border-border px-1 py-2 text-right tabular-nums">
                        <div className="whitespace-nowrap font-semibold text-foreground">
                          {formatNumber(row.actuals[metric])}/{formatNumber(row.targets[metric])}
                        </div>
                        <div className="mt-0.5 flex items-center justify-end gap-1.5">
                          <span className={cn("text-[10px] font-semibold", KPI_GOAL_TEXT[metricStatus])}>{formatNumber(metricPercent)}%</span>
                          <div className="h-1.5 w-full max-w-[56px] overflow-hidden rounded-full bg-slate-100">
                            <div
                              className={cn("h-full rounded-full", KPI_GOAL_BAR[metricStatus])}
                              style={{ width: `${Math.min(100, metricPercent)}%` }}
                            />
                          </div>
                        </div>
                      </td>
                    );
                  })}
                  <td className="overflow-hidden text-ellipsis whitespace-nowrap border border-border bg-emerald-100 px-1 py-2 text-right text-[13px] font-black tabular-nums text-emerald-900" title={formatVnd(row.totalReward)}>
                    {formatVnd(row.totalReward)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      )}
    </section>
  );
}

export function LeaderKpiRewardSections({
  teamId,
  selectedWeek,
}: {
  teamId: string;
  selectedWeek: string;
}) {
  const { startDate, endDate } = splitWeek(selectedWeek);
  const [summary, setSummary] = useState<KpiRewardSummary | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const loadSummary = useCallback(async () => {
    if (!teamId) return;
    setIsLoading(true);
    try {
      const res = await kpiRewardsService.summary({ startDate, endDate, teamId });
      setSummary(res.success && res.data ? res.data : null);
    } finally {
      setIsLoading(false);
    }
  }, [teamId, startDate, endDate]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadSummary();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadSummary]);

  if (!teamId) return null;

  return (
    <div className="mt-5 space-y-5">
      {isLoading ? (
        <div className="rounded-xl border border-border bg-white px-5 py-8 text-center text-[13px] text-muted-foreground">
          Đang tính thưởng...
        </div>
      ) : (
        <KpiRewardResultsTable summary={summary} teamId={teamId} />
      )}
    </div>
  );
}

export function MemberKpiRewardOverview() {
  const { user } = useAppAuth();
  const selectedWeek = useMemo(() => getCurrentWeekValue(), []);
  const { startDate, endDate } = splitWeek(selectedWeek);
  const [summary, setSummary] = useState<KpiRewardSummary | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const loadSummary = useCallback(async () => {
    if (!user?.id || user.role !== "member") return;
    setIsLoading(true);
    try {
      const res = await kpiRewardsService.summary({ startDate, endDate });
      setSummary(res.success && res.data ? res.data : null);
    } finally {
      setIsLoading(false);
    }
  }, [user?.id, user?.role, startDate, endDate]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadSummary();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadSummary]);

  if (user?.role !== "member") return null;

  const teamIds = Array.from(new Set((summary?.memberSummaries || []).map((item) => item.teamId)));

  return (
    <section className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-base font-bold text-foreground">Rule KPI & thưởng tuần này</h2>
            <p className="mt-1 text-[12px] text-muted-foreground">
              Member chỉ xem rule và kết quả của mình. Admin/Leader chỉnh rule ở trang Teams.
            </p>
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-[12px] font-semibold text-slate-700">
            {formatDateVN(startDate)} - {formatDateVN(endDate)}
          </span>
        </div>
      </div>

      {isLoading ? (
        <div className="rounded-xl border border-border bg-card p-6 text-center text-[13px] text-muted-foreground">
          Đang tải rule KPI...
        </div>
      ) : teamIds.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center">
          <MaterialIcon name="assignment" className="text-3xl text-muted-foreground" />
          <p className="mt-3 text-sm font-semibold text-foreground">Chưa có rule KPI & thưởng cho tuần này</p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Khi Leader/Admin cài rule cho team của bạn, bảng rule sẽ hiện ở đây.
          </p>
        </div>
      ) : (
        teamIds.map((teamId) => (
          <div key={teamId} className="space-y-4">
            <KpiRewardRuleTable teamId={teamId} selectedWeek={selectedWeek} readOnly />
            <KpiRewardResultsTable summary={summary} teamId={teamId} />
          </div>
        ))
      )}
    </section>
  );
}

// Trang Rule KPI cua Admin - liet ke TAT CA team that (khong hardcode), moi team 1
// dong tom tat, bam vao dong hoac nut but chi de MO RONG xem/sua chi tiet (tai su
// dung nguyen KpiRewardRuleTable cho phan mo rong - giu dung 1 noi duy nhat chua
// logic sua/luu/huy/cong thuc, tranh viet trung code va lech cong thuc giua 2 noi).
function AdminTeamRuleAccordion({
  teams,
  selectedWeek,
  onChanged,
}: {
  teams: TeamRow[];
  selectedWeek: string;
  onChanged?: () => void;
}) {
  const { startDate, endDate } = splitWeek(selectedWeek);
  const [rows, setRows] = useState<Array<{ team: TeamRow; rules: KpiRewardRule[]; source: KpiRuleSource }>>([]);
  const [memberSummary, setMemberSummary] = useState<KpiRewardSummary | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [expandedTeamId, setExpandedTeamId] = useState<string | null>(null);
  // Bam nut but (Thao tac) thi mo rong VA vao thang che do sua, khong bat bam them
  // 1 lan "Chinh sua" nua. Bam vao dong (ngoai nut but) chi mo rong xem, khong sua.
  const [autoEditTeamId, setAutoEditTeamId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "configured" | "unconfigured">("all");

  const teamIdsKey = teams.map((team) => team.id).join(",");

  const loadAll = useCallback(async () => {
    if (teams.length === 0) {
      setRows([]);
      return;
    }
    setIsLoading(true);
    try {
      const [ruleResults, summaryRes] = await Promise.all([
        Promise.all(teams.map((team) => kpiRewardsService.effectiveRules({ teamId: team.id, startDate, endDate }))),
        kpiRewardsService.summary({ startDate, endDate }),
      ]);
      setRows(teams.map((team, idx) => {
        const res = ruleResults[idx];
        const effective = res.success && res.data ? res.data : { rules: [], source: "default" as const, sourceWeek: null };
        return {
          team,
          rules: normalizeRules(team.id, startDate, endDate, effective.rules),
          source: effective.source,
        };
      }));
      setMemberSummary(summaryRes.success && summaryRes.data ? summaryRes.data : null);
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamIdsKey, startDate, endDate]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadAll();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadAll]);

  // Target that cua tung team (gop tu member that) - dung de uoc tinh Total Bonus
  // tom tat tren dong, cung 1 nguon du lieu voi KpiRewardRuleTable khi mo rong.
  const teamTargetsById = useMemo(() => {
    const map: Record<string, Record<"lead" | "inbox" | "post" | "comment", number>> = {};
    for (const member of memberSummary?.memberSummaries || []) {
      const targets = map[member.teamId] || { lead: 0, inbox: 0, post: 0, comment: 0 };
      (["lead", "inbox", "post", "comment"] as const).forEach((metric) => {
        targets[metric] += member.targets[metric] || 0;
      });
      map[member.teamId] = targets;
    }
    return map;
  }, [memberSummary]);

  const configuredCount = rows.filter((row) => row.source !== "default").length;
  const totalCount = teams.length;

  const filteredRows = rows.filter((row) => {
    if (search.trim() && !row.team.name_team.toLowerCase().includes(search.trim().toLowerCase())) return false;
    if (statusFilter === "configured" && row.source === "default") return false;
    if (statusFilter === "unconfigured" && row.source !== "default") return false;
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="flex items-center gap-2.5 rounded-xl border border-border bg-white p-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
            <MaterialIcon name="groups" className="text-lg" />
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase leading-none text-muted-foreground">Tổng số team</p>
            <p className="mt-1 text-xl font-black tabular-nums text-foreground">{totalCount}</p>
          </div>
        </div>
        <div className="flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-white">
            <MaterialIcon name="verified" className="text-lg" />
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase leading-none text-emerald-700">Đã cấu hình rule</p>
            <p className="mt-1 text-xl font-black tabular-nums text-emerald-900">{configuredCount}</p>
          </div>
        </div>
        <div className="flex items-center gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-600 text-white">
            <MaterialIcon name="warning" className="text-lg" />
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase leading-none text-amber-700">Chưa cấu hình</p>
            <p className="mt-1 text-xl font-black tabular-nums text-amber-900">{totalCount - configuredCount}</p>
          </div>
        </div>
        <div className="flex items-center gap-2.5 rounded-xl border border-blue-200 bg-blue-50 p-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white">
            <MaterialIcon name="dashboard" className="text-lg" />
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase leading-none text-blue-700">Đang áp dụng</p>
            <p className="mt-1 text-xl font-black tabular-nums text-blue-900">{configuredCount}</p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <MaterialIcon name="search" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-base text-muted-foreground" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Tìm team..."
            className="h-9 w-full rounded-lg border border-border bg-white pl-9 pr-3 text-[12px] outline-none focus:border-primary"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
          className="h-9 rounded-lg border border-border bg-white px-3 text-[12px] font-semibold text-foreground outline-none"
        >
          <option value="all">Tất cả trạng thái</option>
          <option value="configured">Đang áp dụng</option>
          <option value="unconfigured">Chưa cấu hình</option>
        </select>
      </div>

      <section className="overflow-hidden rounded-xl border border-border bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] table-fixed border-collapse text-left text-[12px]">
            <thead className="bg-slate-50 text-[11px] uppercase text-muted-foreground">
              <tr>
                <th className="w-[220px] px-3 py-3">Team</th>
                <th className="w-[80px] px-2 py-3 text-right">Thành viên</th>
                <th className="w-[110px] px-2 py-3">Trạng thái</th>
                <th className="w-[90px] px-2 py-3 text-right">Ngưỡng (%)</th>
                <th className="w-[110px] px-2 py-3 text-right">Bonus/đơn vị</th>
                <th className="w-[120px] px-2 py-3 text-right">Total Bonus</th>
                <th className="w-[90px] px-2 py-3 text-right">Max Rate</th>
                <th className="w-[140px] px-2 py-3">Cập nhật lần cuối</th>
                <th className="w-[60px] px-2 py-3 text-center">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-muted-foreground">Đang tải...</td>
                </tr>
              ) : filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-muted-foreground">Không tìm thấy team nào.</td>
                </tr>
              ) : (
                filteredRows.map((row) => {
                  const isExpanded = expandedTeamId === row.team.id;
                  const targets = teamTargetsById[row.team.id] || { lead: 0, inbox: 0, post: 0, comment: 0 };
                  const { totalByMetric } = computeMetricBonuses(row.rules, targets);
                  const baseRule = getRule(row.rules, "total_bonus");
                  const leadRule = getRule(row.rules, "lead");
                  const configured = row.source !== "default";
                  return (
                    <Fragment key={row.team.id}>
                      <tr
                        className="cursor-pointer border-t border-border hover:bg-slate-50"
                        onClick={() => {
                          setExpandedTeamId(isExpanded ? null : row.team.id);
                          if (isExpanded) setAutoEditTeamId(null);
                        }}
                      >
                        <td className="px-3 py-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate font-bold text-foreground">{row.team.name_team}</span>
                              <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold uppercase text-primary">
                                {getTeamTypeLabel(row.team.team_type)}
                              </span>
                            </div>
                            <div className="truncate text-[10px] text-muted-foreground">
                              Leader: {row.team.leader_name || row.team.leader_email || "—"}
                            </div>
                          </div>
                        </td>
                        <td className="px-2 py-3 text-right tabular-nums">{row.team.number_of_member}</td>
                        <td className="px-2 py-3">
                          <span
                            className={cn(
                              "inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap",
                              configured ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700",
                            )}
                          >
                            {configured ? "Đang áp dụng" : "Chưa cấu hình"}
                          </span>
                        </td>
                        <td className="px-2 py-3 text-right font-semibold text-amber-700 tabular-nums">
                          {configured ? `${formatNumber(baseRule.thresholdValue)} %` : "—"}
                        </td>
                        <td className="px-2 py-3 text-right tabular-nums">{configured ? formatVnd(baseRule.rewardPerUnit) : "—"}</td>
                        <td className="px-2 py-3 text-right font-bold text-emerald-800 tabular-nums">
                          {configured ? formatVnd(totalByMetric.total_bonus) : "—"}
                        </td>
                        <td className="px-2 py-3 text-right tabular-nums">{configured ? `${formatNumber(leadRule.maxRate)} %` : "—"}</td>
                        <td className="px-2 py-3 text-[11px] text-muted-foreground">
                          {baseRule.updatedAt ? new Date(baseRule.updatedAt).toLocaleString("vi-VN") : "—"}
                        </td>
                        <td className="px-2 py-3 text-center">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setExpandedTeamId(row.team.id);
                              setAutoEditTeamId(row.team.id);
                            }}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-slate-100 hover:text-foreground"
                            title="Sửa rule"
                          >
                            <MaterialIcon name="edit" className="text-base" />
                          </button>
                        </td>
                      </tr>
                      {isExpanded ? (
                        <tr>
                          <td colSpan={9} className="border-t border-border bg-slate-50/60 p-3">
                            <KpiRewardRuleTable
                              teamId={row.team.id}
                              selectedWeek={selectedWeek}
                              autoEdit={autoEditTeamId === row.team.id}
                              onChanged={() => {
                                onChanged?.();
                                void loadAll();
                              }}
                            />
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export function AdminKpiRewardsPanel({
  view,
  selectedWeek,
  selectedTeamId: controlledTeamId,
}: {
  view: "kpi-rules" | "kpi-summary";
  selectedWeek: string;
  // Bo loc team cho view kpi-summary gio nam o thanh tieu de trang (component cha) -
  // truyen xuong day thay vi tu quan ly rieng, tranh 2 bo loc chiem dien tich.
  selectedTeamId?: string;
}) {
  const { user } = useAppAuth();
  const role = user?.role as string | undefined;
  const { startDate, endDate } = splitWeek(selectedWeek);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const selectedTeamId = controlledTeamId ?? "";
  const [summary, setSummary] = useState<KpiRewardSummary | null>(null);

  const loadTeams = useCallback(async () => {
    const res = await teamsService.getAll();
    const allTeams = res.success && res.data ? res.data : [];
    const scopedTeams = allTeams.filter((team) => {
      if (role === "admin" || role === "superadmin") return true;
      if (role === "leader") {
        return String(team.id_leader || "") === String(user?.id || "") || team.leader_email === user?.email;
      }
      return (team.members || []).some((member) => (
        String(member.id || "") === String(user?.id || "") || member.email === user?.email
      ));
    });
    setTeams(scopedTeams);
  }, [role, user?.email, user?.id]);

  const loadData = useCallback(async () => {
    try {
      const summaryRes = await kpiRewardsService.summary({ startDate, endDate, teamId: selectedTeamId || undefined });
      setSummary(summaryRes.success && summaryRes.data ? summaryRes.data : null);
    } catch {
      setSummary(null);
    }
  }, [startDate, endDate, selectedTeamId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadTeams();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadTeams]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadData();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadData]);

  if (view === "kpi-rules") {
    const isAdmin = role === "admin" || role === "superadmin";
    const isReadOnly = role === "member";

    // Admin quan ly nhieu team - liet ke TAT CA team that (khong hardcode mau), moi
    // team 1 dong tom tat kem thong ke tong quan, bam vao dong de mo rong sua rule
    // chi tiet (thay vi phai chon tung team qua 1 o select).
    if (isAdmin) {
      return <AdminTeamRuleAccordion teams={teams} selectedWeek={selectedWeek} onChanged={loadData} />;
    }

    const activeTeamId = teams[0]?.id || "";
    return (
      <div className="space-y-5">
        {!activeTeamId ? (
          <div className="rounded-xl border border-dashed border-border bg-white p-10 text-center text-[13px] text-muted-foreground">
            Chưa có team để cài rule KPI.
          </div>
        ) : (
          <KpiRewardRuleTable
            teamId={activeTeamId}
            selectedWeek={selectedWeek}
            readOnly={isReadOnly}
            onChanged={loadData}
          />
        )}
      </div>
    );
  }

  const teamSummaries = summary?.teamSummaries || [];
  const memberSummaries = summary?.memberSummaries || [];
  const teamsHitTarget = teamSummaries.filter((team) => team.kpiStatus === "dat").length;
  const membersHitTarget = memberSummaries.filter((member) => member.kpiStatus === "dat").length;
  const teamPctHit = teamSummaries.length ? Math.round((teamsHitTarget / teamSummaries.length) * 100) : 0;
  const memberPctHit = memberSummaries.length ? Math.round((membersHitTarget / memberSummaries.length) * 100) : 0;
  const approvedPct = summary?.totals.totalReward
    ? Math.round(((summary.totals.approvedReward || 0) / summary.totals.totalReward) * 100)
    : 0;

  // Thanh vien dan dau tung team (theo tien thuong cao nhat) - giup Admin biet ngay
  // team dang duoc "keo" boi ai, khong phai mo tung team ra moi thay.
  const topMemberByTeam = new Map<string, KpiRewardMemberSummary>();
  for (const member of memberSummaries) {
    const current = topMemberByTeam.get(member.teamId);
    if (!current || member.totalReward > current.totalReward) topMemberByTeam.set(member.teamId, member);
  }

  // Xep hang theo tien thuong cao nhat - tao cam giac canh tranh, dong bo voi bang
  // Ket qua KPI & tien thuong ben duoi (cung xep theo tong thuong).
  const rankedTeamSummaries = [...teamSummaries].sort((a, b) => b.totalReward - a.totalReward);
  const RANK_MEDAL = ["🥇", "🥈", "🥉"];
  const teamTypeById = new Map(teams.map((t) => [t.id, t.team_type || "khac"]));

  return (
    <div className="space-y-5">
      {/* Man THEO DOI - 4 con so nguoi dung hieu ngay, khong dung thuat ngu quy trinh
          noi bo ("Dang dung") gay kho hieu. Moi card co 1 dong phu de "day" hon,
          chi dung so THAT tinh duoc tu du lieu hien co (khong bia so sanh tuan truoc
          vi chua co endpoint tra du lieu tuan truoc). */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-white">
            <MaterialIcon name="account_balance_wallet" className="text-lg" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase leading-none text-emerald-700">Tổng thưởng dự kiến</p>
            <p className="mt-1 text-xl font-black tabular-nums text-emerald-900">{formatVnd(summary?.totals.totalReward || 0)}</p>
            <p className="mt-0.5 text-[10px] text-emerald-700/80">{teamSummaries.length} team · {memberSummaries.length} thành viên</p>
          </div>
        </div>
        <div className="flex items-center gap-2.5 rounded-xl border border-blue-200 bg-blue-50 p-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white">
            <MaterialIcon name="verified" className="text-lg" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase leading-none text-blue-700">Thưởng đã chốt</p>
            <p className="mt-1 text-xl font-black tabular-nums text-blue-900">{formatVnd(summary?.totals.approvedReward || 0)}</p>
            <p className="mt-0.5 text-[10px] text-blue-700/80">{approvedPct}% so với tổng dự kiến</p>
          </div>
        </div>
        <div className="flex items-center gap-2.5 rounded-xl border border-violet-200 bg-violet-50 p-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-violet-600 text-white">
            <MaterialIcon name="track_changes" className="text-lg" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase leading-none text-violet-700">Team đạt KPI</p>
            <p className="mt-1 text-xl font-black tabular-nums text-violet-900">{teamsHitTarget} / {teamSummaries.length}</p>
            <p className="mt-0.5 text-[10px] text-violet-700/80">{teamPctHit}% team đạt KPI</p>
          </div>
        </div>
        <div className="flex items-center gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-600 text-white">
            <MaterialIcon name="groups" className="text-lg" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase leading-none text-amber-700">Thành viên đạt KPI</p>
            <p className="mt-1 text-xl font-black tabular-nums text-amber-900">{membersHitTarget} / {memberSummaries.length}</p>
            <p className="mt-0.5 text-[10px] text-amber-700/80">{memberPctHit}% thành viên đạt KPI</p>
          </div>
        </div>
      </div>

      <section className="rounded-xl border border-border bg-white shadow-sm">
        <div className="border-b border-border px-5 py-4">
          <h3 className="text-base font-bold text-foreground">Tổng thưởng theo team</h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Xếp hạng theo tiền thưởng dự kiến cao nhất.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[840px] text-left text-[12px]">
            <thead className="bg-slate-50 text-[11px] uppercase text-muted-foreground">
              <tr>
                <th className="w-[48px] px-4 py-3">Hạng</th>
                <th className="px-4 py-3">Team</th>
                <th className="px-4 py-3 text-right">Thành viên</th>
                <th className="w-[170px] px-4 py-3">KPI trung bình</th>
                <th className="px-4 py-3">Trạng thái</th>
                <th className="px-4 py-3">Top member</th>
                <th className="px-4 py-3 text-right">Thưởng dự kiến</th>
              </tr>
            </thead>
            <tbody>
              {rankedTeamSummaries.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                    Chưa có dữ liệu tổng hợp cho tuần này.
                  </td>
                </tr>
              ) : (
                rankedTeamSummaries.map((team, idx) => {
                  const topMember = topMemberByTeam.get(team.teamId);
                  return (
                    <tr key={team.teamId} className="border-t border-border hover:bg-slate-50">
                      <td className="px-4 py-3 text-muted-foreground">{RANK_MEDAL[idx] || idx + 1}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-foreground">{team.teamName}</span>
                          <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold uppercase text-primary">
                            {getTeamTypeLabel(teamTypeById.get(team.teamId))}
                          </span>
                        </div>
                        <div className="text-[10px] text-muted-foreground">{team.leaderEmail}</div>
                      </td>
                      <td className="px-4 py-3 text-right">{team.memberCount}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="w-9 shrink-0 text-right font-semibold tabular-nums">{formatNumber(team.kpiPercent)}%</span>
                          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                            <div
                              className={cn("h-full rounded-full", KPI_GOAL_BAR[team.kpiStatus])}
                              style={{ width: `${Math.min(100, team.kpiPercent)}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3"><KpiGoalBadge status={team.kpiStatus} /></td>
                      <td className="px-4 py-3">
                        {topMember ? (
                          <div>
                            <div className="font-semibold text-foreground">{topMember.memberName}</div>
                            <div className={cn("text-[10px] font-semibold", KPI_GOAL_TEXT[topMember.kpiStatus])}>
                              {formatNumber(topMember.kpiPercent ?? 0)}%
                            </div>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-bold">{formatVnd(team.totalReward)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <KpiRewardResultsTable summary={summary} teamId={selectedTeamId || undefined} teams={teams} />
    </div>
  );
}
