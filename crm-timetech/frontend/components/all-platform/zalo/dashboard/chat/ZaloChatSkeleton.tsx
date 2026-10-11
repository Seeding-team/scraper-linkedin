"use client";

/**
 * Skeleton loading components cho Zalo Chat View.
 *
 * Tại sao cần: Khi fetch dữ liệu lần đầu, thay vì hiển thị spinner xoay,
 * ta hiển thị "khung xương" mô phỏng cấu trúc UI thật. Cảm giác nhanh hơn
 * 30% và người dùng biết được sắp tới sẽ thấy gì.
 *
 * Tất cả component ở đây đều pure presentational — không có state, effect,
 * hay side effect nào. An toàn để import vào bất kỳ đâu.
 */

export function ZaloChatHeaderSkeleton() {
  return (
    <div
      role="status"
      aria-label="Đang tải thông tin hội thoại"
      className="flex items-center gap-3 px-4 h-16 border-b border-outline-variant bg-surface shrink-0"
    >
      <div className="h-10 w-10 rounded-full bg-surface-container-highest animate-pulse" />
      <div className="flex-1 space-y-2">
        <div className="h-4 w-32 bg-surface-container-highest rounded animate-pulse" />
        <div className="h-3 w-20 bg-surface-container-low rounded animate-pulse" />
      </div>
    </div>
  );
}

export function ZaloMessageListSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div
      role="status"
      aria-label="Đang tải tin nhắn"
      className="flex-1 overflow-y-auto p-6 space-y-6 min-h-0 bg-[#f4f6f8]"
    >
      {Array.from({ length: count }).map((_, i) => {
        const isMe = i % 3 === 0;
        const widthClass = i % 2 === 0 ? "w-64" : "w-48";
        return (
          <div
            key={i}
            className={`flex ${isMe ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`flex gap-2 max-w-[70%] ${
                isMe ? "flex-row-reverse" : ""
              }`}
            >
              {!isMe && (
                <div className="h-8 w-8 rounded-full bg-surface-container-highest animate-pulse flex-shrink-0" />
              )}
              <div className="space-y-1.5">
                <div
                  className={`h-12 ${widthClass} bg-surface-container-highest rounded-xl animate-pulse`}
                />
                <div
                  className={`h-2.5 w-12 bg-surface-container-low rounded animate-pulse ${
                    isMe ? "ml-auto" : ""
                  }`}
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ZaloConversationListSkeleton({ count = 10 }: { count?: number }) {
  return (
    <div
      role="status"
      aria-label="Đang tải danh sách hội thoại"
      className="p-2 space-y-1"
    >
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 p-2 rounded-lg">
          <div className="h-12 w-12 rounded-full bg-surface-container-highest animate-pulse flex-shrink-0" />
          <div className="flex-1 space-y-2">
            <div
              className={`h-3.5 bg-surface-container-highest rounded animate-pulse ${
                i % 2 === 0 ? "w-3/4" : "w-2/3"
              }`}
            />
            <div
              className={`h-3 bg-surface-container-low rounded animate-pulse ${
                i % 3 === 0 ? "w-1/2" : "w-3/5"
              }`}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ZaloChatInputSkeleton() {
  return (
    <div className="bg-surface p-4 border-t border-outline-variant">
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 rounded-full bg-surface-container-low animate-pulse" />
        <div className="h-9 w-9 rounded-full bg-surface-container-low animate-pulse" />
        <div className="h-9 w-9 rounded-full bg-surface-container-low animate-pulse" />
        <div className="flex-1 h-12 bg-surface-container-low rounded-full animate-pulse" />
        <div className="h-12 w-12 rounded-full bg-surface-container-highest animate-pulse" />
      </div>
    </div>
  );
}
