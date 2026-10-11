import React from 'react';

interface LoadingProps {
  title?: string;
  content?: string;
  onCancel?: () => void;
}

export default function FullScreenLoading({
  title = "Đang xử lý dữ liệu",
  content = "Hệ thống đang tải và xử lý thông tin, vui lòng chờ trong giây lát...",
  onCancel,
}: LoadingProps) {
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm">
      <div className="relative w-[400px] max-w-[90vw] shrink-0 overflow-hidden rounded-3xl border border-white/50 bg-white/90 p-8 text-center shadow-2xl backdrop-blur-xl">
        {/* Decorative background glow */}
        <div className="pointer-events-none absolute left-1/2 top-0 h-1/2 w-full -translate-x-1/2 rounded-full bg-violet-400/20 blur-3xl" />

        <div className="relative mb-8 flex justify-center">
          <div className="relative h-20 w-20">
            {/* Outer spinning ring */}
            <div className="absolute inset-0 rounded-full border-4 border-violet-100"></div>
            <div className="absolute inset-0 animate-spin rounded-full border-4 border-transparent border-t-violet-600"></div>
            
            {/* Inner pulsing circle */}
            <div className="absolute inset-3 flex animate-pulse items-center justify-center rounded-full bg-violet-100">
              <div className="absolute h-8 w-8 animate-ping rounded-full bg-violet-400 opacity-60"></div>
              <div className="absolute h-4 w-4 rounded-full bg-violet-600"></div>
            </div>
          </div>
        </div>

        <h1 className="relative mb-4 text-xl font-bold tracking-tight text-slate-800 sm:text-2xl">{title}</h1>
        <p className="relative text-sm leading-relaxed text-slate-600">{content}</p>

        {onCancel && (
          <button
            onClick={onCancel}
            className="relative mt-8 rounded-xl border border-rose-100 bg-rose-50 px-8 py-2.5 font-bold text-rose-600 shadow-sm transition-all duration-200 hover:bg-rose-100 hover:text-rose-700 active:scale-95"
          >
            Hủy tiến trình
          </button>
        )}
      </div>
    </div>
  );
}
