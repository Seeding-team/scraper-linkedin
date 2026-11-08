/** Parse số nguyên kiểu sheet VN (158.177 → 158177, 3.000.000 → 3000000). */
export function parseViMemberCount(raw: unknown): number {
  if (raw == null) return 0;
  if (typeof raw === "number" && !Number.isNaN(raw)) {
    return Math.max(0, Math.trunc(raw));
  }
  let s = String(raw).trim().replace(/\s/g, "");
  if (!s) return 0;
  if (s.includes(".") && !s.includes(",")) {
    const parts = s.split(".");
    if (parts.length > 1 && parts.slice(1).every((p) => p.length === 3)) {
      s = parts.join("");
    }
  }
  s = s.replace(/,/g, "");
  const n = Number(s);
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.trunc(n));
}
