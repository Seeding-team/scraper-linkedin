import { addDays, addMonths, addYears } from "date-fns";

/**
 * "Thời gian bảo hành" tren contract van la TEXT tu do (cot `warranty_period`,
 * migration 192) - danh sach preset nay CHI phuc vu UI dropdown (2026-10-23,
 * yeu cau sep: "dropdown thang/ngay/nam cho so pho bien, muon khac thi nhap
 * tay"), khong doi schema/migration gi.
 */
export const WARRANTY_PERIOD_PRESETS: string[] = [
  "3 tháng",
  "6 tháng",
  "12 tháng",
  "18 tháng",
  "24 tháng",
  "36 tháng",
  "60 tháng",
  "30 ngày",
  "90 ngày",
  "1 năm",
  "2 năm",
  "3 năm",
  "5 năm",
];

export type WarrantyUnit = "ngày" | "tháng" | "năm";

export interface ParsedWarrantyPeriod {
  amount: number;
  unit: WarrantyUnit;
}

/**
 * Bat "<so> <don vi>" o DAU chuoi, cho phep chu thua phia sau (vd
 * "24 tháng theo hãng" -> {amount:24, unit:'tháng'}) de van tuong thich voi
 * du lieu tu do cu da nhap truoc khi co dropdown nay.
 */
export function parseWarrantyPeriod(text: string | null | undefined): ParsedWarrantyPeriod | null {
  if (!text) return null;
  const match = String(text).trim().match(/(\d+)\s*(tháng|ngày|năm)/i);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const unit = match[2].toLowerCase() as WarrantyUnit;
  return { amount, unit };
}

function parseYmd(value: string): Date | null {
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function computeWarrantyEndDate(
  signedAt: string | null | undefined,
  warrantyPeriod: string | null | undefined
): Date | null {
  if (!signedAt) return null;
  const base = parseYmd(signedAt);
  if (!base) return null;
  const parsed = parseWarrantyPeriod(warrantyPeriod);
  if (!parsed) return null;
  switch (parsed.unit) {
    case "ngày":
      return addDays(base, parsed.amount);
    case "tháng":
      return addMonths(base, parsed.amount);
    case "năm":
      return addYears(base, parsed.amount);
    default:
      return null;
  }
}

export function formatWarrantyEndDate(date: Date | null): string {
  if (!date) return "";
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}
