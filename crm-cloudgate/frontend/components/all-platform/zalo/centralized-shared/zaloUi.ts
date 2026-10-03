/**
 * Design tokens — port nguyên từ zalo-account-module/zalo-forward-module
 * (InvoiceFlowManager, src/lib/ui.ts), CHỈ đổi màu thương hiệu: dùng token
 * `brand`/`brand-hover`/`brand-dark`/`brand-subtle`/`brand-border` đã khai ở
 * app/globals.css (map sang #ba244a của app này, module gốc dùng #0068ff).
 * Mọi trang Zalo tập trung trong app này (forward-rules, campaigns...) dùng
 * chung file này để đồng bộ giao diện 100% với module gốc.
 */

const FOCUS = "outline-none focus-visible:border-brand focus-visible:ring-[3px] focus-visible:ring-brand/15";

const BTN_BASE =
  "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 " +
  FOCUS;

export const btn = {
  primary: `${BTN_BASE} bg-brand text-white shadow-sm shadow-brand/20 hover:bg-brand-hover`,
  outline: `${BTN_BASE} border border-[#dce1e8] bg-white text-[#2f3e50] hover:bg-[#f1f4f8]`,
  ghost: `${BTN_BASE} text-slate-600 hover:bg-slate-100 hover:text-slate-900`,
  danger: `${BTN_BASE} border border-[#f5c6cb] bg-white text-[#e74c3c] hover:bg-[#fde8e8]`,
  warning: `${BTN_BASE} border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100`,
};

export const btnSize = {
  sm: "h-8 px-3.5",
  md: "h-9 px-4.5",
  lg: "h-11 px-7 text-base",
  icon: "h-8 w-8 p-0",
};

export const input =
  "h-10 w-full rounded-xl border border-[#dce1e8] bg-white px-3.5 text-sm text-[#0a1a2b] transition-[color,box-shadow] placeholder:text-[#a0b0c0] disabled:opacity-50 " +
  FOCUS;

export const select =
  "h-10 rounded-[30px] border border-[#dce1e8] bg-white px-4 text-[13px] font-medium text-[#2f3e50] " + FOCUS;

export const textarea =
  "w-full resize-y rounded-xl border border-[#dce1e8] bg-white px-4 py-3 text-sm text-[#0a1a2b] transition-[color,box-shadow] placeholder:text-[#a0b0c0] disabled:opacity-50 " +
  FOCUS;

export const card = "rounded-2xl border border-[#eef1f5] bg-white";

export const label = "mb-1 block text-[13px] font-semibold text-[#2f3e50]";

const PILL_BASE = "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-3 py-0.5 text-xs font-medium";

export const pill = {
  success: `${PILL_BASE} bg-emerald-50 text-emerald-700`,
  warning: `${PILL_BASE} bg-amber-50 text-amber-700`,
  danger: `${PILL_BASE} bg-red-50 text-red-700`,
  info: `${PILL_BASE} bg-brand-subtle text-brand`,
  neutral: `${PILL_BASE} bg-[#e8edf5] text-[#2f3e50]`,
};

export const table = {
  wrapper: "relative w-full overflow-x-auto",
  root: "w-full border-collapse text-sm",
  head: "whitespace-nowrap py-3 pr-3 text-left align-middle text-xs font-semibold uppercase tracking-[0.3px] text-[#6b7a8d] [&:last-child]:pr-0",
  row: "border-b border-[#f0f3f7] transition-colors last:border-0 hover:bg-[#fafcff]",
  cell: "py-3.5 pr-3 align-middle text-[#1f2a3a] [&:last-child]:pr-0",
};

export const modal = {
  overlay: "fixed inset-0 z-50 bg-black/35 backdrop-blur-sm p-5",
  panel: "w-full rounded-3xl border border-[#eef1f5] bg-white shadow-[0_30px_60px_rgba(0,0,0,0.2)]",
};

export const pageStack = "flex flex-col gap-6";

export const alert = {
  error: "flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700",
  success:
    "flex items-start gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-700",
  info: "flex items-start gap-2 rounded-2xl border border-blue-200 bg-blue-50 px-3.5 py-2.5 text-sm text-blue-700",
};

export const emptyState = {
  wrap: "py-10 text-center text-[#6b7a8d]",
  title: "text-lg font-semibold text-[#2f3e50]",
  desc: "mt-1.5 text-sm",
};
