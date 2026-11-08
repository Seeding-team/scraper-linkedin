/** Format so nguyen voi dau cham ngan cach hang nghin kieu VN (20000 -> "20.000"). */
export function formatThousands(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  const n = typeof value === "number" ? value : Number(String(value).replace(/\D/g, ""));
  if (!Number.isFinite(n)) return "";
  return n.toLocaleString("vi-VN");
}

/** Nguoc lai formatThousands — bo het ky tu khong phai so ("20.000" -> 20000). */
export function parseThousands(raw: string): number {
  const digits = raw.replace(/\D/g, "");
  return digits ? Number(digits) : 0;
}
