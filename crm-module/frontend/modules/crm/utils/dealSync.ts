'use client';

import { useEffect } from 'react';

/** Bao hieu "Deal / Sales Pipeline co the da doi" (sau khi tao/duyet/huy bao gia, luu/doi trang thai hop dong) - backend da cap nhat
 * customer_leads.deal_stage; cac man hinh dang mo lang nghe su kien nay de TAI LAI tu du lieu that (khong tu doi nhan o FE). */
export const DEALS_CHANGED_EVENT = 'crm:deals-changed';

const CHANNEL_NAME = 'crm-deals-changed';

export function notifyDealsChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(DEALS_CHANGED_EVENT));
  // Các tab khác của cùng trình duyệt (vd trang Quản lý hợp đồng đang mở sẵn) cũng tải lại, không cần F5
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel(CHANNEL_NAME);
      channel.postMessage('changed');
      channel.close();
    }
  } catch {
    /* trình duyệt không hỗ trợ: chỉ đồng bộ trong tab hiện tại */
  }
}

/** Goi `onChange` moi khi co su kien doi Deal; tra ve dong bo trong useEffect nen khong ro ri listener. */
export function useDealsChanged(onChange: () => void): void {
  useEffect(() => {
    const handler = () => onChange();
    window.addEventListener(DEALS_CHANGED_EVENT, handler);
    let channel: BroadcastChannel | null = null;
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        channel = new BroadcastChannel(CHANNEL_NAME);
        channel.onmessage = handler;
      }
    } catch {
      channel = null;
    }
    return () => {
      window.removeEventListener(DEALS_CHANGED_EVENT, handler);
      channel?.close();
    };
  }, [onChange]);
}
