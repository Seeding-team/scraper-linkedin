/**
 * Design tokens — port từ mockup TimeTech Chat (E:\timetich / timetich.html).
 * Mọi trang import từ đây để đồng bộ giao diện 100%.
 */

const FOCUS = "outline-none focus-visible:border-brand focus-visible:ring-[3px] focus-visible:ring-brand/15";

const BTN_BASE =
  "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 " +
  FOCUS;

export const btn = {
  primary: `${BTN_BASE} bg-brand text-white hover:bg-brand-hover`,
  outline: `${BTN_BASE} border border-[#dce1e8] bg-white text-[#2f3e50] hover:bg-[#f1f4f8]`,
  ghost: `${BTN_BASE} text-slate-600 hover:bg-slate-100 hover:text-slate-900`,
  danger: `${BTN_BASE} border border-[#f5c6cb] bg-white text-[#e74c3c] hover:bg-[#fde8e8]`,
  warning: `${BTN_BASE} border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100`,
  /** Nút viền trong `.table-header-actions .actions` — mockup không tô đặc. */
  tableAction:
    "inline-flex items-center gap-1.5 rounded-[30px] border border-[#dce1e8] bg-transparent px-[18px] py-[5px] text-[13px] font-medium text-[#2f3e50] transition hover:bg-[#f1f4f8] disabled:opacity-50"
};

export const btnSize = {
  sm: "h-8 px-3.5",
  md: "h-9 px-4.5",
  lg: "h-11 px-7 text-base",
  icon: "h-8 w-8 p-0"
};

/** Nút hành động trong bảng — `.action-group .act-btn` */
export const actBtn = {
  base: "inline-flex items-center gap-1 whitespace-nowrap rounded-[30px] border border-[#dce1e8] bg-transparent px-3.5 py-1 text-xs font-medium text-[#2f3e50] transition hover:bg-[#f1f4f8] disabled:opacity-50",
  primary:
    "inline-flex items-center gap-1 whitespace-nowrap rounded-[30px] border border-brand bg-brand px-3.5 py-1 text-xs font-medium text-white transition hover:bg-brand-hover disabled:opacity-50",
  outline:
    "inline-flex items-center gap-1 whitespace-nowrap rounded-[30px] border border-[#dce1e8] bg-transparent px-3.5 py-1 text-xs font-medium text-[#2f3e50] transition hover:bg-[#f1f4f8] disabled:opacity-50",
  danger:
    "inline-flex items-center gap-1 whitespace-nowrap rounded-[30px] border border-[#f5c6cb] bg-transparent px-3.5 py-1 text-xs font-medium text-[#e74c3c] transition hover:bg-[#fde8e8] disabled:opacity-50"
};

export const btnSave =
  "inline-flex items-center gap-2 rounded-lg border-none bg-brand px-8 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-hover disabled:opacity-50";

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

export const card = "rounded-lg border border-[#eef1f5] bg-white";

export const surface = "rounded-lg border border-[#eef1f5] bg-[#f8fafc] p-5";

export const forwardRule = "rounded-lg border border-[#eef1f5] bg-[#f8fafc] p-5 md:p-6";

export const broadcastGrid = "mb-4 grid grid-cols-1 gap-6 lg:grid-cols-2";

export const broadcastGridWide = "mb-4 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.5fr]";

export const broadcastCard = "rounded-lg border border-[#eef1f5] bg-[#f8fafc] p-[18px_20px]";

export const scanRow =
  "flex flex-wrap items-center gap-x-5 gap-y-3 rounded-lg bg-[#f8fafc] px-5 py-4";

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
  neutral: `${PILL_BASE} bg-[#e8edf5] text-[#2f3e50]`
};

/** `.role-tag` mockup */
export const roleTag = "inline-block rounded-[30px] bg-brand-subtle px-3 py-0.5 text-xs font-medium text-brand";

export function statusDotClass(color: "green" | "orange" | "red" | "slate") {
  const map = {
    green: "bg-[#31b545]",
    orange: "bg-[#f39c12]",
    red: "bg-[#e74c3c]",
    slate: "bg-slate-400"
  } as const;
  return `inline-block h-2 w-2 shrink-0 rounded-full ${map[color]}`;
}

/** `.status-badge` — chấm + chữ */
export function statusBadge(label: string, dot: "green" | "orange" | "red" | "slate") {
  return { label, dotClass: statusDotClass(dot) };
}

export const table = {
  wrapper: "relative w-full overflow-x-auto",
  root: "zalo-table w-full border-collapse text-sm",
  head: "whitespace-nowrap py-3 pr-3 text-left align-middle text-xs font-semibold uppercase tracking-[0.3px] text-[#6b7a8d] [&:last-child]:pr-0",
  row: "border-b border-[#f0f3f7] transition-colors last:border-0 hover:bg-[#fafcff]",
  cell: "py-3.5 pr-3 align-middle text-[#1f2a3a] [&:last-child]:pr-0"
};

export const modal = {
  overlay: "fixed inset-0 z-50 bg-black/40 p-5",
  panel: "w-full animate-modal-in rounded-lg border border-[#eef1f5] bg-white p-8 shadow-xl",
  title: "text-xl font-bold text-[#0a1a2b]",
  desc: "mt-1 mb-5 text-sm text-[#6b7a8d]"
};

export const pageStack = "flex flex-col gap-6";

export const sectionTitle = "mb-3 flex items-center gap-2.5 text-lg font-semibold text-[#0a1a2b]";

export const sectionTitleSub = "text-[13px] font-normal text-[#6b7a8d]";

export const tableHeaderActions = "mb-3.5 flex flex-wrap items-center justify-between gap-2";

export const metaNote =
  "mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-[#f0f3f7] pt-4 text-xs text-[#8a9aa8]";

export const alert = {
  error: "flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700",
  success:
    "flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-700",
  info: "flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3.5 py-2.5 text-sm text-blue-700"
};

/** `.desc-box` mockup */
export const infoBox =
  "flex items-start gap-2 rounded-lg border-l-4 border-brand bg-[#f8fafc] px-5 py-4 text-sm leading-relaxed text-[#2f3e50]";

export const filterTab = {
  base: "cursor-pointer rounded-[30px] px-4 py-1 text-[13px] font-medium transition-colors",
  active: "bg-brand text-white",
  inactive: "bg-[#f1f4f8] text-[#4f5f71] hover:bg-[#e6eaef]"
};

export const emptyState = {
  wrap: "py-10 text-center text-[#6b7a8d]",
  icon: "mx-auto mb-3 block h-12 w-12 text-[#dce1e8]",
  title: "text-lg font-semibold text-[#2f3e50]",
  desc: "mt-1.5 text-sm"
};