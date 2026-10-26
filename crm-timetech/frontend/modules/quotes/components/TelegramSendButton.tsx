'use client';

import { useEffect, useState } from 'react';
import { seedingQuoteRepository } from '../repositories/SeedingQuoteRepository';
import type { QuoteStatus, QuoteTelegramLog } from '../types';

/** Nút "Gửi Telegram" dùng chung ở màn "Đã tạo báo giá thành công" (CreateQuoteModal)
 * và trang chi tiết báo giá nội bộ (QuoteDetailPage). Chỉ bật khi báo giá đã
 * duyệt (approved/confirmed) — báo giá draft luôn disabled. Tự fetch lịch sử gửi
 * để biết hiện "Gửi Telegram" (chưa từng gửi) hay "Gửi lại" (đã có log) + hiện
 * đúng trạng thái lần gửi gần nhất; gửi lại luôn hỏi xác nhận, không ghi đè log cũ
 * (backend tự thêm dòng mới, xem quote_telegram_service.py). */
export function TelegramSendButton({
  quoteId,
  status,
  className,
}: {
  quoteId: string;
  status: QuoteStatus;
  className?: string;
}) {
  const [logs, setLogs] = useState<QuoteTelegramLog[]>([]);
  const [loadingLog, setLoadingLog] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    seedingQuoteRepository
      .getQuoteTelegramLog(quoteId)
      .then(rows => {
        if (!cancelled) setLogs(rows);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingLog(false);
      });
    return () => {
      cancelled = true;
    };
  }, [quoteId]);

  const isApproved = status === 'approved' || status === 'confirmed';
  const lastLog = logs[0];

  async function handleSend() {
    if (sending || !isApproved) return;
    if (lastLog && !window.confirm('Báo giá này đã có lịch sử gửi Telegram trước đó. Gửi lại lần nữa?')) {
      return;
    }
    setSending(true);
    setError('');
    try {
      const result = await seedingQuoteRepository.sendQuoteTelegram(quoteId);
      setLogs(prev => [result, ...prev]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không gửi được Telegram.');
    } finally {
      setSending(false);
    }
  }

  const label = sending
    ? 'Đang gửi...'
    : lastLog
      ? 'Gửi lại qua Telegram'
      : 'Gửi qua Telegram';

  return (
    <div className="telegram-send-wrap">
      <button
        type="button"
        className={className || 'quote-button quote-button--secondary'}
        disabled={!isApproved || sending || loadingLog}
        onClick={() => void handleSend()}
        title={!isApproved ? 'Chỉ gửi được sau khi báo giá đã duyệt' : undefined}
      >
        {label}
      </button>
      {!loadingLog && lastLog ? (
        <span className={`telegram-send-status telegram-send-status--${lastLog.status}`}>
          {lastLog.status === 'success'
            ? `Đã gửi lúc ${new Date(lastLog.sentAt).toLocaleString('vi-VN')}`
            : lastLog.status === 'failed'
              ? `Gửi lần trước lỗi: ${lastLog.errorMessage || 'không rõ nguyên nhân'}`
              : 'Đang xử lý...'}
        </span>
      ) : null}
      {error ? <span className="telegram-send-status telegram-send-status--failed">{error}</span> : null}
    </div>
  );
}
