"use client";

import { useState } from "react";
import { toast } from "sonner";
import { postEvaluationService } from "@/services/all-platform.service";
import type { UnifiedPost } from "@/types/unified.types";

interface EvaluationDropdownProps {
  post: UnifiedPost;
  onEvaluationChange?: (newCode: string, isExempt?: boolean) => void;
  disabled?: boolean;
}

const EVALUATION_OPTIONS = [
  { code: "phu-hop", label: "Phù hợp", bg: "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100", dot: "bg-emerald-500" },
  { code: "khong-phu-hop", label: "Không phù hợp", bg: "bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100", dot: "bg-rose-500" },
  { code: "can-nhac", label: "Cân nhắc", bg: "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100", dot: "bg-amber-500" },
  { code: "chua-danh-gia", label: "Chưa đánh giá", bg: "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100", dot: "bg-slate-400" },
];

export function EvaluationDropdown({ post, onEvaluationChange, disabled }: EvaluationDropdownProps) {
  const currentCode = post.evaluation_code || "chua-danh-gia";
  const currentExempt = !!post.exclude_keyword_exempt;
  const isExcluded = !!post.is_excluded && !currentExempt;

  const [code, setCode] = useState<string>(currentCode);
  const [exempt, setExempt] = useState<boolean>(currentExempt);
  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const activeOption = EVALUATION_OPTIONS.find((opt) => opt.code === code) || EVALUATION_OPTIONS[3];

  const handleSelectCode = async (newCode: string) => {
    if (newCode === code) {
      setIsOpen(false);
      return;
    }

    const prevCode = code;
    // Optimistic update
    setCode(newCode);
    setIsOpen(false);
    onEvaluationChange?.(newCode, exempt);

    setIsSaving(true);
    try {
      const res = await postEvaluationService.updateEvaluation(post.id, {
        evaluation_code: newCode,
        platform: post.platform || "facebook",
        exclude_keyword_exempt: exempt,
      });

      if (!res.success) {
        // Rollback
        setCode(prevCode);
        onEvaluationChange?.(prevCode, exempt);
        toast.error(res.message || "Không thể lưu đánh giá.");
      } else {
        toast.success("Đã lưu đánh giá bài viết.");
      }
    } catch {
      setCode(prevCode);
      onEvaluationChange?.(prevCode, exempt);
      toast.error("Lỗi kết nối khi lưu đánh giá.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleExempt = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const nextExempt = !exempt;
    setExempt(nextExempt);
    onEvaluationChange?.(code, nextExempt);

    try {
      const res = await postEvaluationService.updateEvaluation(post.id, {
        evaluation_code: code,
        platform: post.platform || "facebook",
        exclude_keyword_exempt: nextExempt,
      });

      if (!res.success) {
        setExempt(!nextExempt);
        onEvaluationChange?.(code, !nextExempt);
        toast.error(res.message || "Không thể cập nhật cờ miễn trừ.");
      } else {
        toast.success(nextExempt ? "Đã bật miễn trừ từ khóa loại trừ." : "Đã tắt miễn trừ từ khóa loại trừ.");
      }
    } catch {
      setExempt(!nextExempt);
      onEvaluationChange?.(code, !nextExempt);
      toast.error("Lỗi khi cập nhật miễn trừ.");
    }
  };

  return (
    <div className="relative inline-flex items-center gap-1.5 text-xs">
      {/* Badge cảnh báo từ khóa loại trừ nếu có */}
      {isExcluded && (
        <span
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-bold bg-red-100 text-red-700 border border-red-200"
          title={`Khớp từ khóa: ${(post.matched_keywords || []).join(", ")}`}
        >
          🚫 Từ khóa loại trừ
        </span>
      )}

      {/* Button kích hoạt Dropdown */}
      <button
        type="button"
        disabled={disabled || isSaving}
        onClick={() => setIsOpen((prev) => !prev)}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md font-semibold border transition shadow-2xs ${activeOption.bg} ${
          disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"
        }`}
        title="Bấm để đổi trạng thái đánh giá bài cào"
      >
        <span className={`w-2 h-2 rounded-full shrink-0 ${activeOption.dot}`} />
        <span>{activeOption.label}</span>
        <svg
          className={`w-3.5 h-3.5 transition-transform duration-200 text-current opacity-70 ${isOpen ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setIsOpen(false)} />
          <div className="absolute left-0 top-full mt-1 w-48 rounded-lg bg-card border border-border shadow-lg p-1.5 z-40 animate-in fade-in zoom-in-95">
            <div className="text-[10px] font-bold text-muted-foreground px-2 py-1 uppercase tracking-wider">
              Đánh giá bài cào
            </div>
            {EVALUATION_OPTIONS.map((opt) => (
              <button
                key={opt.code}
                type="button"
                onClick={() => handleSelectCode(opt.code)}
                className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs font-medium text-left transition ${
                  code === opt.code ? "bg-muted font-bold text-foreground" : "hover:bg-muted/60 text-muted-foreground"
                }`}
              >
                <span className={`w-2 h-2 rounded-full shrink-0 ${opt.dot}`} />
                <span className="flex-1">{opt.label}</span>
                {code === opt.code && <span className="text-primary font-bold">✓</span>}
              </button>
            ))}

            <div className="border-t border-border my-1.5" />

            {/* Checkbox Miễn trừ từ khóa */}
            <div
              onClick={handleToggleExempt}
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[11px] text-muted-foreground hover:bg-muted/60 cursor-pointer"
              title="Nếu bài có chứa từ khóa loại trừ nhưng thực chất vẫn hợp lệ thì tick chọn"
            >
              <input
                type="checkbox"
                checked={exempt}
                onChange={() => {}}
                className="rounded border-border text-primary focus:ring-primary w-3.5 h-3.5 cursor-pointer"
              />
              <span className="select-none font-medium">Miễn trừ quét từ khóa</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

