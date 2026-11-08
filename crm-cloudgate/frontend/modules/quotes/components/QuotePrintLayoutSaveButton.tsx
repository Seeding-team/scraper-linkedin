'use client';

import { Save } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { seedingQuoteRepository } from '../repositories/SeedingQuoteRepository';
import type { Quote } from '../types';

interface Props {
  /** null = báo giá CHƯA được tạo (popup xem trước ở Bước 1, chế độ tạo mới)
   * - không có gì để gọi API, bắt buộc truyền `onSaveLocal`. */
  quoteId: string | null;
  printOrientation: 'portrait' | 'landscape';
  columnWidthsDraft: Record<string, number> | null;
  /** Goi sau khi luu thanh cong voi quote MOI NHAT tra ve tu backend (shape
   * NOI BO, dung apply_quote_field_permissions - KHONG phai shape public
   * allowlist) - QuoteDetailPage dung de cap nhat lai `quote` cho dong bo;
   * PublicQuotePage (trang cong khai) nen truyen 1 no-op de KHONG ghi de
   * quote da tai bang shape noi bo (co the lo field khong nam trong
   * allowlist cong khai vao state dang render cho ca khach vang lai). */
  onSaved?: (quote: Quote) => void;
  /** Chỉ dùng khi quoteId === null: giữ tuỳ chỉnh ở state của form tạo mới,
   * gửi kèm `data.printLayoutPrefs` lúc tạo báo giá (xem QuoteWorkspaceModal
   * createRequest). */
  onSaveLocal?: (prefs: { orientation: 'portrait' | 'landscape'; columnWidths: Record<string, number> }) => void;
}

/** Nút "Lưu" ở toolbar in (hướng giấy + độ rộng cột đã kéo tay) — dùng chung
 * cho cả QuoteDetailPage (trang nội bộ) và PublicQuotePage (trang công khai
 * /baogia/{token}, CHỈ hiện khi người xem hiện tại có phiên đăng nhập hợp lệ
 * VÀ có quyền sửa đúng báo giá này — xem getQuoteEditPermission()). Tách ra
 * đây để 2 nơi dùng CHUNG đúng 1 logic gọi API + trạng thái hiển thị, không
 * để lệch nhau theo thời gian. */
export function QuotePrintLayoutSaveButton({ quoteId, printOrientation, columnWidthsDraft, onSaved, onSaveLocal }: Props) {
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  // Bo qua lan render dau (mount) - chi reset ve 'idle' khi huong giay/do
  // rong cot THAY DOI SAU KHI da mount (nguoi dung tu chinh tiep sau khi da
  // "Lưu" hoac dang xem ban gieo san) - dung y het hanh vi cu (moi noi doi
  // huong giay/do rong cot deu tu goi setSaveStatus('idle') truoc khi tach
  // component nay).
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    setSaveStatus('idle');
  }, [printOrientation, columnWidthsDraft]);

  async function save() {
    setSaveStatus('saving');
    try {
      if (quoteId) {
        const updated = await seedingQuoteRepository.updatePrintLayoutPrefs(quoteId, printOrientation, columnWidthsDraft || {});
        onSaved?.(updated);
      } else {
        onSaveLocal?.({ orientation: printOrientation, columnWidths: columnWidthsDraft || {} });
      }
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus(current => (current === 'saved' ? 'idle' : current)), 2000);
    } catch (err) {
      setSaveStatus('error');
      window.alert(err instanceof Error ? err.message : 'Không lưu được tuỳ chỉnh in.');
    }
  }

  return (
    <button
      type="button"
      className="quote-print-preview-btn quote-print-preview-btn--primary"
      disabled={saveStatus === 'saving'}
      title="Lưu hướng giấy + độ rộng cột hiện tại để lần in/tải PDF sau (kể cả người khác mở lại link) dùng đúng bản đã chỉnh"
      onClick={() => void save()}
    >
      <Save className="quote-print-preview-icon" />
      {saveStatus === 'saving' ? 'Đang lưu...' : saveStatus === 'saved' ? 'Đã lưu' : 'Lưu'}
    </button>
  );
}
