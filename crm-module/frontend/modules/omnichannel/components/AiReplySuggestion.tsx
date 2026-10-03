"use client";

import React, { useState } from "react";
import { Sparkles, RefreshCw, CornerDownLeft, Edit3 } from "lucide-react";

interface AiReplySuggestionProps {
  suggestion?: string;
  onInsertSuggestion: (text: string) => void;
}

export const AiReplySuggestion: React.FC<AiReplySuggestionProps> = ({
  suggestion,
  onInsertSuggestion,
}) => {
  const [currentText, setCurrentText] = useState(
    suggestion ||
      "Dạ gói Pro có thể triển khai trong 3 - 5 ngày tùy vào yêu cầu đặc thù của doanh nghiệp. Em có thể sắp xếp demo chi tiết vào chiều mai cho anh được không ạ?"
  );

  const handleRewrite = () => {
    const variants = [
      "Dạ đối với gói Pro bên em thời gian triển khai trung bình từ 3 - 5 ngày ạ. Chiều mai bên em có thể demo trực tiếp qua Google Meet cho anh nhé!",
      "Chào anh! Bên em cam kết triển khai nhanh trong vòng 3 ngày làm việc. Em xin phép gửi lịch hẹn demo vào chiều mai cho anh ạ.",
      "Dạ quy trình triển khai gói Pro rất gọn gàng chỉ mất tầm 3-5 ngày. Chiều mai 14h anh Hoàng có tiện tham gia buổi demo ngắn không ạ?",
    ];
    const nextText = variants[Math.floor(Math.random() * variants.length)];
    setCurrentText(nextText);
  };

  return (
    <div className="mx-3 my-1 rounded-lg border border-indigo-100 bg-gradient-to-r from-indigo-50/60 via-purple-50/40 to-rose-50/60 p-2 font-sans shadow-2xs">
      <div className="flex items-center justify-between pb-1">
        <div className="flex items-center gap-1.5 text-[11px] font-bold text-indigo-700">
          <Sparkles className="h-3.5 w-3.5 text-purple-600 animate-pulse" />
          <span>Gợi ý trả lời bằng AI</span>
        </div>
        <button
          onClick={handleRewrite}
          className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-indigo-600 transition"
          title="Tạo gợi ý khác"
        >
          <RefreshCw className="h-3 w-3" />
        </button>
      </div>

      <p className="text-[11px] text-slate-700 leading-snug font-normal bg-white/70 p-1.5 rounded border border-indigo-50/60 mb-1.5">
        {currentText}
      </p>

      <div className="flex items-center gap-1.5">
        <button
          onClick={() => onInsertSuggestion(currentText)}
          className="flex items-center gap-1 rounded border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-[var(--color-markee-primary,#c2185b)] hover:bg-rose-100 transition shadow-2xs"
        >
          <CornerDownLeft className="h-3 w-3" />
          <span>Chèn vào tin nhắn</span>
        </button>
        <button
          onClick={handleRewrite}
          className="flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-600 hover:bg-slate-50 transition"
        >
          <Edit3 className="h-3 w-3" />
          <span>Viết lại</span>
        </button>
      </div>
    </div>
  );
};
