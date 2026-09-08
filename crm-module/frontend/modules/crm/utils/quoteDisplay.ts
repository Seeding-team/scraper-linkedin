import type { Quote } from '@/modules/quotes';
import type { Deal } from '../types';

/** 4 trang thai THAT + 'all' - khong co 'sent' rieng (trung tap voi 'approved',
 * quote_approve() luon tu sinh public link ngay khi duyet, khong co tin hieu
 * "da gui khach" nao khac). Dung chung giua QuoteCenterPage va
 * QuoteWorkspaceModal - KHONG duoc dinh nghia rieng o 2 noi (se lech logic). */
export type QuoteStatusFilter = 'all' | 'draft' | 'sent' | 'won' | 'lost';

export function formatMoney(value: number): string {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(
    value || 0
  );
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[parts.length - 2][0] + parts[parts.length - 1][0]).toUpperCase();
  return (parts[0]?.[0] || '?').toUpperCase();
}

export function relativeTime(dateStr?: string): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return '';
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'Vừa xong';
  if (diffMin < 60) return `${diffMin} phút trước`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} giờ trước`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay === 1) return 'Hôm qua';
  if (diffDay < 7) return `${diffDay} ngày trước`;
  return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
}

export function formatDate(dateStr?: string): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
}

export function isWonDeal(deal?: Deal): boolean {
  return deal?.stage === 'won' || deal?.crmStatus === 'won';
}
export function isLostDeal(deal?: Deal): boolean {
  return deal?.stage === 'lost' || deal?.crmStatus === 'lost';
}

/** 'approved'/'confirmed' la CUNG 1 tap quyen xem/gui khach that su (xac nhan qua
 * code that: get_public_quote/quotes_get/telegram-log deu check ca 2 gia tri
 * nhu nhau) - khong co tin hieu "da gui khach" nao tach biet "da duyet" (khong
 * co cot sent_at/hanh dong gui rieng), nen KHONG tach tab/nhan rieng cho 2 gia
 * tri nay - goi chung la "Da duyet". 'confirmed' rieng la du lieu bao gia CU
 * (tao truoc migration 053, truoc khi co luong duyet) - van xem/gui khach duoc
 * nhu 'approved' nhung KHONG the "Tao phien ban moi" tu no (RPC
 * quote_create_version yeu cau nguon la status='approved' - da test that qua
 * RPC, 'confirmed' bi tu choi voi loi quote_not_approved). */
export function isApprovedQuote(quote: Quote): boolean {
  return quote.status === 'approved' || quote.status === 'confirmed';
}

/** Trạng thái hiển thị của 1 báo giá — suy từ status thật của quote + stage
 * thật của deal liên kết, không có khái niệm "Đã xem"/"Đàm phán" (không có
 * dữ liệu nguồn cho các trạng thái đó trong hệ thống). */
export function quoteDisplayStatus(quote: Quote, deal?: Deal): { key: QuoteStatusFilter; label: string; className: string } {
  if (isWonDeal(deal)) return { key: 'won', label: 'Đã chốt', className: 'qc-badge-green' };
  if (isLostDeal(deal) || quote.status === 'cancelled') return { key: 'lost', label: 'Đã huỷ', className: 'qc-badge-rose' };
  if (isApprovedQuote(quote)) return { key: 'sent', label: 'Đã duyệt', className: 'qc-badge-blue' };
  return { key: 'draft', label: 'Chưa duyệt', className: 'qc-badge-amber' };
}

/** Khoa on dinh cho filter "Khach hang" - customerId co the rong (deal chua
 * gan ho so crm_customers), KHONG dung ten lam khoa (2 khach trung ten se bi
 * gop nham) - deal chua co customerId thi tu no la 1 "khach hang" rieng. */
export function customerFilterKey(deal?: Deal): string {
  return deal?.customerId || deal?.id || '';
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Mot so deal cu dang luu `dealId` (ma nghiep vu, vd "CO-2026-0012") trung
 * luon voi chinh UUID cua ban ghi (du lieu that phat hien qua live-test that,
 * khong phai gia dinh) - KHONG duoc hien UUID tho ra bang, coi nhu chua co ma
 * nghiep vu (dung "Chua gan co hoi" nhu yeu cau, du deal/khach hang van co). */
export function dealBusinessCode(deal?: Deal): string | null {
  const code = deal?.dealId?.trim();
  if (!code || UUID_PATTERN.test(code)) return null;
  return code;
}
