"use client";

import { useState, useMemo, useEffect } from "react";
import { cn } from "@/lib/utils";

interface KpiModalProps {
  isOpen: boolean;
  onClose: () => void;
  member?: {
    email: string;
    name?: string;
    kpi_target?: number;
    verified_count?: number;
    total_count?: number;
  };
  onSubmit?: (payload: KpiModalPayload) => Promise<void>;
}

export interface KpiModalPayload {
  email: string;
  kpi_comment: number;
  start_day: string;
  end_day: string;
  platform: string;
  leader_email: string;
}

export function KpiModal({ isOpen, onClose, member, onSubmit }: KpiModalProps) {
  const [kpiPerWeek, setKpiPerWeek] = useState(member?.kpi_target?.toString() || "10");
  // Generate weeks for current year
  const generateWeeks = () => {
    const year = new Date().getFullYear();
    const weeks = [];

    let firstDay = new Date(year, 0, 1);
    let dayOfWeek = firstDay.getDay() || 7;
    let startMonday = new Date(firstDay);
    startMonday.setDate(firstDay.getDate() - dayOfWeek + 1);

    for (let i = 1; i <= 52; i++) {
      let monday = new Date(startMonday);
      monday.setDate(startMonday.getDate() + (i - 1) * 7);
      let sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);

      const formatDate = (d: Date) => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
      };

      weeks.push({
        weekNumber: i,
        monday: formatDate(monday),
        sunday: formatDate(sunday),
        label: `Tuần ${i} (${formatDate(monday)} đến ${formatDate(sunday)})`
      });
    }
    return weeks;
  };

  const weeks = useMemo(() => generateWeeks(), []);

  const getCurrentWeek = () => {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const todayStr = `${y}-${m}-${day}`;

    const current = weeks.find(w => todayStr >= w.monday && todayStr <= w.sunday);
    return current ? current.weekNumber : 24;
  };

  const [selectedWeek, setSelectedWeek] = useState<number>(getCurrentWeek());

  useEffect(() => {
    if (isOpen) {
      setSelectedWeek(getCurrentWeek());
    }
  }, [isOpen, weeks]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen || !member) return null;

  const verifiedCount = member.verified_count || 0;
  const totalCount = member.total_count || 0;
  const target = parseInt(kpiPerWeek) || 0;
  const progress = target > 0 ? Math.min(100, Math.round((verifiedCount / target) * 100)) : 0;

  const handleSubmit = async () => {
    if (!onSubmit) return;
    setIsSubmitting(true);
    try {
      const currentWeekData = weeks.find(w => w.weekNumber === selectedWeek);
      await onSubmit({
        email: member.email,
        kpi_comment: parseInt(kpiPerWeek) || 0,
        start_day: currentWeekData?.monday || "",
        end_day: currentWeekData?.sunday || "",
        platform: "Facebook",
        leader_email: "",
      });
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-[min(90vw,440px)] rounded-xl bg-surface p-6 shadow-xl flex flex-col gap-md">
        <h2 className="text-lg font-bold text-on-surface">KPI: {member.name || member.email}</h2>

        {/* Progress */}
        <div className="mb-4">
          <div className="mb-1 flex justify-between text-sm">
            <span className="text-on-surface-variant">Tiến độ</span>
            <span className="font-semibold text-on-surface">
              {verifiedCount} / {target}
            </span>
          </div>
          <div className="h-2 w-full rounded-full bg-surface-container-highest">
            <div
              className={cn(
                "h-2 rounded-full transition-all",
                progress >= 100
                  ? "bg-green-500"
                  : progress >= 50
                    ? "bg-blue-500"
                    : "bg-amber-500",
              )}
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-on-surface-variant">{progress}% hoàn thành KPI</p>
        </div>

        {/* Stats */}
        <div className="mb-4 grid grid-cols-3 gap-3 text-center">
          <div className="rounded-lg bg-surface-container-low p-3">
            <p className="text-lg font-bold text-on-surface">{totalCount}</p>
            <p className="text-xs text-on-surface-variant">Tổng bài</p>
          </div>
          <div className="rounded-lg bg-green-50 p-3">
            <p className="text-lg font-bold text-green-600">{verifiedCount}</p>
            <p className="text-xs text-green-600">Đã verify</p>
          </div>
          <div className="rounded-lg bg-amber-50 p-3">
            <p className="text-lg font-bold text-amber-600">{totalCount - verifiedCount}</p>
            <p className="text-xs text-amber-600">Chưa verify</p>
          </div>
        </div>

        {/* Form */}
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-on-surface-variant">KPI/tuần</label>
            <input
              type="number"
              value={kpiPerWeek}
              onChange={(e) => setKpiPerWeek(e.target.value)}
              min={0}
              className="w-full rounded-lg border border-outline-variant px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div className="space-y-1">
            <label className="mb-1 block text-xs font-semibold text-on-surface-variant">Chọn Tuần</label>
            <select
              value={selectedWeek}
              onChange={(e) => setSelectedWeek(Number(e.target.value))}
              className="w-full rounded-lg border border-outline-variant px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer"
            >
              {weeks.map((w) => (
                <option key={w.weekNumber} value={w.weekNumber}>
                  {w.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-outline-variant px-4 py-2 text-sm font-medium text-on-surface-variant transition-colors hover:bg-surface-container-low"
          >
            Đóng
          </button>
          {onSubmit && (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitting}
              className={cn(
                "rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors",
                isSubmitting ? "opacity-50 cursor-not-allowed" : "hover:bg-primary/90",
              )}
            >
              {isSubmitting ? "Đang lưu..." : "Cập nhật KPI"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
