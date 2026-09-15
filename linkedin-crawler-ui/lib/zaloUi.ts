/**
 * Design tokens — port nguyên từ zalo-account-module/src/lib/ui.ts (InvoiceFlowManager
 * ZALO_CENTRALIZED_MODULE_GUIDE.md) cho các trang Zalo tập trung (bulk-send,
 * broadcast-groups, scan-group-members, forward-rules, campaigns). Y CHANG cấu
 * trúc/className gốc — chỉ đổi giá trị token màu `brand` (khai ở app/globals.css)
 * từ xanh Zalo (#0068ff) sang màu thương hiệu app này (#ba244a).
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
  tableAction:
    "inline-flex items-center gap-1.5 rounded-[30px] border border-[#dce1e8] bg-transparent px-[18px] py-[5px] text-[13px] font-medium text-[#2f3e50] transition hover:bg-[#f1f4f8] disabled:opacity-50",
};

export const btnSize = {
  sm: "h-8 px-3.5",
  md: "h-9 px-4.5",
  lg: "h-11 px-7 text-base",
  icon: "h-8 w-8 p-0",
};

export const actBtn = {
  base: "inline-flex items-center gap-1 whitespace-nowrap rounded-[30px] border border-[#dce1e8] bg-transparent px-3.5 py-1 text-xs font-medium text-[#2f3e50] transition hover:bg-[#f1f4f8] disabled:opacity-50",
  primary:
    "inline-flex items-center gap-1 whitespace-nowrap rounded-[30px] border border-brand bg-brand px-3.5 py-1 text-xs font-medium text-white transition hover:bg-brand-hover disabled:opacity-50",
  outline:
    "inline-flex items-center gap-1 whitespace-nowrap rounded-[30px] border border-[#dce1e8] bg-transparent px-3.5 py-1 text-xs font-medium text-[#2f3e50] transition hover:bg-[#f1f4f8] disabled:opacity-50",
  danger:
    "inline-flex items-center gap-1 whitespace-nowrap rounded-[30px] border border-[#f5c6cb] bg-transparent px-3.5 py-1 text-xs font-medium text-[#e74c3c] transition hover:bg-[#fde8e8] disabled:opacity-50",
};

export const btnSave =
  "inline-flex items-center gap-2 rounded-[30px] border-none bg-brand px-8 py-2.5 text-sm font-semibold text-white shadow-[0_4px_12px_rgba(186,36,74,0.2)] transition hover:bg-brand-hover disabled:opacity-50";

export const input =
  "h-10 w-full rounded-xl border border-[#dce1e8] bg-white px-3.5 text-sm text-[#0a1a2b] transition-[color,box-shadow] placeholder:text-[#a0b0c0] disabled:opacity-50 " +
  FOCUS;

export const inputWithIcon = `${input} pl-9`;

export const select =
  "h-10 rounded-[30px] border border-[#dce1e8] bg-white px-4 text-[13px] font-medium text-[#2f3e50] " + FOCUS;

export const selectInline =
  "rounded-[30px] border border-[#dce1e8] bg-white px-4 py-1.5 text-[13px] text-[#2f3e50] outline-none focus:border-brand";

export const textarea =
  "w-full resize-y rounded-xl border border-[#dce1e8] bg-white px-4 py-3 text-sm text-[#0a1a2b] transition-[color,box-shadow] placeholder:text-[#a0b0c0] disabled:opacity-50 " +
  FOCUS;

/** Textarea không cố định chiều cao (dùng cho ô nhập số điện thoại/UID nhiều dòng). */
export const textareaAuto =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition-[color,box-shadow] placeholder:text-slate-400 disabled:opacity-50 outline-none focus-visible:border-brand focus-visible:ring-[3px] focus-visible:ring-brand/40";

export const card = "rounded-2xl border border-[#eef1f5] bg-white";

export const surface = "rounded-2xl border border-[#eef1f5] bg-[#f8fafc] p-5";

export const broadcastGrid = "mb-4 grid grid-cols-1 gap-6 lg:grid-cols-2";

export const broadcastGridWide = "mb-4 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.5fr]";

export const broadcastCard = "rounded-2xl border border-[#eef1f5] bg-[#f8fafc] p-[18px_20px]";

export const fileUpload =
  "cursor-pointer rounded-xl border-2 border-dashed border-[#dce1e8] p-4 text-center text-[13px] text-[#6b7a8d] transition hover:border-brand hover:bg-[#f5f9ff]";

export const warningBox =
  "rounded-xl border-l-[3px] border-amber-400 bg-[#fff8e6] px-3 py-3 text-[13px] text-[#7a6b3a]";

export const label = "mb-1 block text-[13px] font-semibold text-[#2f3e50]";

const PILL_BASE = "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-3 py-0.5 text-xs font-medium";

export const pill = {
  success: `${PILL_BASE} bg-emerald-50 text-emerald-700`,
  warning: `${PILL_BASE} bg-amber-50 text-amber-700`,
  danger: `${PILL_BASE} bg-red-50 text-red-700`,
  info: `${PILL_BASE} bg-brand-subtle text-brand`,
  neutral: `${PILL_BASE} bg-[#e8edf5] text-[#2f3e50]`,
};

export const roleTag = "inline-block rounded-[30px] bg-brand-subtle px-3 py-0.5 text-xs font-medium text-brand";

export function statusDotClass(color: "green" | "orange" | "red" | "slate") {
  const map = {
    green: "bg-[#31b545]",
    orange: "bg-[#f39c12]",
    red: "bg-[#e74c3c]",
    slate: "bg-slate-400",
  } as const;
  return `inline-block h-2 w-2 shrink-0 rounded-full ${map[color]}`;
}

export const table = {
  wrapper: "relative w-full overflow-x-auto",
  root: "w-full border-collapse text-sm",
  head: "whitespace-nowrap py-3 pr-3 text-left align-middle text-xs font-semibold uppercase tracking-[0.3px] text-[#6b7a8d] [&:last-child]:pr-0",
  row: "border-b border-[#f0f3f7] transition-colors last:border-0 hover:bg-[#fafcff]",
  cell: "py-3.5 pr-3 align-middle text-[#1f2a3a] [&:last-child]:pr-0",
};

export const modal = {
  overlay: "fixed inset-0 z-50 bg-black/35 backdrop-blur-sm p-5",
  panel: "w-full animate-in fade-in zoom-in-95 rounded-3xl border border-[#eef1f5] bg-white p-8 shadow-[0_30px_60px_rgba(0,0,0,0.2)]",
  title: "text-xl font-bold text-[#0a1a2b]",
  desc: "mt-1 mb-5 text-sm text-[#6b7a8d]",
};

export const pageStack = "flex flex-col gap-6";

export const sectionTitle = "mb-3 flex items-center gap-2.5 text-lg font-semibold text-[#0a1a2b]";

export const sectionTitleSub = "text-[13px] font-normal text-[#6b7a8d]";

export const tableHeaderActions = "mb-3.5 flex flex-wrap items-center justify-between gap-2";

export const metaNote =
  "mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-[#f0f3f7] pt-4 text-xs text-[#8a9aa8]";

export const alert = {
  error: "flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700",
  success:
    "flex items-start gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-700",
  info: "flex items-start gap-2 rounded-2xl border border-blue-200 bg-blue-50 px-3.5 py-2.5 text-sm text-blue-700",
};

export const infoBox =
  "flex items-start gap-2 rounded-2xl border-l-4 border-brand bg-[#f8fafc] px-5 py-4 text-sm leading-relaxed text-[#2f3e50]";

export const filterTab = {
  base: "cursor-pointer rounded-[30px] px-4 py-1 text-[13px] font-medium transition-colors",
  active: "bg-brand text-white",
  inactive: "bg-[#f1f4f8] text-[#4f5f71] hover:bg-[#e6eaef]",
};

export const emptyState = {
  wrap: "py-10 text-center text-[#6b7a8d]",
  icon: "mx-auto mb-3 block h-12 w-12 text-[#dce1e8]",
  title: "text-lg font-semibold text-[#2f3e50]",
  desc: "mt-1.5 text-sm",
};
