// Tiện ích + types dùng chung cho trang Dashboard Leader (prototype-dashboard-leader.html).

export type Period = "today" | "7" | "30";

export const OK_CALL_CODES = new Set(["interested", "consulting", "callback", "waiting"]);
export const BAD_CALL_CODES = new Set(["noanswer", "refused", "nointerest", "invalid"]);

export function pct(a: number, b: number): number {
  return b > 0 ? Math.round((a / b) * 100) : 0;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(baseIso: string, days: number): string {
  const d = new Date(baseIso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function periodRange(period: Period): { date_from: string; date_to: string } {
  const to = todayIso();
  if (period === "today") return { date_from: to, date_to: to };
  if (period === "7") return { date_from: addDaysIso(to, -6), date_to: to };
  return { date_from: addDaysIso(to, -29), date_to: to };
}

/** Khoảng kỳ liền trước, cùng độ dài, dùng để tính % so với kỳ trước cho thẻ KPI. */
export function prevPeriodRange(period: Period): { date_from: string; date_to: string } {
  const { date_from } = periodRange(period);
  const date_to = addDaysIso(date_from, -1);
  if (period === "today") return { date_from: date_to, date_to };
  if (period === "7") return { date_from: addDaysIso(date_to, -6), date_to };
  return { date_from: addDaysIso(date_to, -29), date_to };
}

/** Cửa sổ 14 ngày cố định cho biểu đồ xu hướng — độc lập với period đang chọn (giống prototype:
 * "theo bộ lọc, không phụ thuộc kỳ"). */
export function last14DaysRange(): { date_from: string; date_to: string } {
  const to = todayIso();
  return { date_from: addDaysIso(to, -13), date_to: to };
}

export function formatDay(day: string): string {
  const parts = day.split("-");
  if (parts.length !== 3) return day;
  return `${parts[2]}/${parts[1]}`;
}

export function deltaLabel(curr: number, prev: number): { text: string; positive: boolean } | null {
  if (prev <= 0) return curr > 0 ? { text: "mới", positive: true } : null;
  const d = Math.round(((curr - prev) / prev) * 100);
  return { text: `${d >= 0 ? "▲" : "▼"} ${Math.abs(d)}%`, positive: d >= 0 };
}

export const PERIOD_LABEL: Record<Period, string> = {
  today: "hôm nay",
  "7": "7 ngày qua",
  "30": "30 ngày qua",
};

export const PLATFORM_OPTIONS: { value: string; label: string }[] = [
  { value: "facebook", label: "Facebook" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "threads", label: "Threads" },
  { value: "youtube", label: "YouTube" },
];
