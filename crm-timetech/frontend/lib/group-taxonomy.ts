/** Taxonomy dùng chung Groups / Crawl form — khớp mock HTML redesign. */

export const INDUSTRY_OPTIONS = [
  { id: "tech", label: "💻 Công Nghệ", value: "Công Nghệ" },
  { id: "marketing", label: "📣 Marketing", value: "Marketing" },
  { id: "ecommerce", label: "🛒 Ecommerce", value: "Ecommerce" },
  { id: "startup", label: "🚀 Startup", value: "Startup" },
  { id: "hr", label: "👥 HR", value: "HR" },
  { id: "other", label: "📂 Khác", value: "Khác" },
] as const;

export const TEAM_OPTIONS = ["Sales", "Marketing", "Content", "BD"] as const;

export const TIER_OPTIONS = [
  { tier: 1, icon: "🔥", title: "Tier 1", sub: "Ưu tiên cao" },
  { tier: 2, icon: "⚡", title: "Tier 2", sub: "Theo dõi" },
  { tier: 3, icon: "👁️", title: "Tier 3", sub: "Quan sát" },
] as const;

export type GroupStatusUi = "ACTIVE" | "IDLE" | "DEAD";

export function detectPlatformFromUrl(url: string): "facebook" | "linkedin" {
  if (/linkedin\.com/i.test(url)) return "linkedin";
  return "facebook";
}

export function formatRelativeCrawl(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(String(iso).replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return "—";
  const diffMs = Date.now() - d.getTime();
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  if (hours < 24) return `${hours || 1} giờ trước`;
  const days = Math.floor(hours / 24);
  return `${days} ngày trước`;
}
