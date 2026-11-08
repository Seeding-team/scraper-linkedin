/**
 * Design tokens — port nguyên từ zalo-account-module (d:\InvoiceFlowManager,
 * TimeTech Chat mockup gốc), chỉ đổi token màu `brand-*` sang tông thương hiệu
 * app này (#ba244a, khai ở app/globals.css) thay vì xanh Zalo (#0068ff) gốc.
 * Dùng chung cho ZaloInboxAdminShell/ZaloChatView để đồng bộ style.
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

export const input =
  "h-10 w-full rounded-xl border border-[#dce1e8] bg-white px-3.5 text-sm text-[#0a1a2b] transition-[color,box-shadow] placeholder:text-[#a0b0c0] disabled:opacity-50 " +
  FOCUS;

export const card = "rounded-2xl border border-[#eef1f5] bg-white";

const PILL_BASE = "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-3 py-0.5 text-xs font-medium";

export const pill = {
  success: `${PILL_BASE} bg-emerald-50 text-emerald-700`,
  warning: `${PILL_BASE} bg-amber-50 text-amber-700`,
  danger: `${PILL_BASE} bg-red-50 text-red-700`,
  info: `${PILL_BASE} bg-brand-subtle text-brand`,
  neutral: `${PILL_BASE} bg-[#e8edf5] text-[#2f3e50]`,
};

export function statusDotClass(color: "green" | "orange" | "red" | "slate") {
  const map = {
    green: "bg-[#31b545]",
    orange: "bg-[#f39c12]",
    red: "bg-[#e74c3c]",
    slate: "bg-slate-400",
  } as const;
  return `inline-block h-2 w-2 shrink-0 rounded-full ${map[color]}`;
}

/** Bong bóng tin nhắn chat — bên mình (brand) vs bên kia (xám nhạt), bo góc kiểu chat app hiện đại. */
export const chatBubble = {
  own: "rounded-2xl rounded-br-md bg-brand px-3.5 py-2 text-sm text-white shadow-sm",
  other: "rounded-2xl rounded-bl-md bg-[#f1f4f8] px-3.5 py-2 text-sm text-[#1f2a3a]",
};

export const emptyState = {
  wrap: "py-10 text-center text-[#6b7a8d]",
  title: "text-lg font-semibold text-[#2f3e50]",
  desc: "mt-1.5 text-sm",
};
