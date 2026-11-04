"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { allPlatformCategoriesService, postEvaluationService } from "@/services/all-platform.service";
import type { Category, EvaluatorUser, UnifiedPost } from "@/types/unified.types";
import { getInitials } from "@/components/all-platform/layout/AllPlatformSidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface EvaluationDropdownProps {
  post: UnifiedPost;
  onEvaluationChange?: (newCode: string, isExempt?: boolean) => void;
  disabled?: boolean;
}

interface EvaluationOption {
  code: string;
  label: string;
  bg: string;
  dot: string;
}

const FALLBACK_OPTIONS: EvaluationOption[] = [
  { code: "chua-danh-gia", label: "Chưa đánh giá", bg: "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100", dot: "bg-slate-400" },
  { code: "can-lien-he", label: "Cần liên hệ", bg: "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100", dot: "bg-amber-500" },
  { code: "khong-phu-hop", label: "Chưa phù hợp (Bỏ qua)", bg: "bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100", dot: "bg-rose-500" },
];


function formatRelativeOrDate(isoString?: string | null): string {
  if (!isoString) return "";
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    if (diffMs < 0) return date.toLocaleString("vi-VN");
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffSec < 60) return "vừa xong";
    if (diffMin < 60) return `${diffMin} phút trước`;
    if (diffHour < 24) return `${diffHour} giờ trước`;
    if (diffDay < 7) return `${diffDay} ngày trước`;
    return date.toLocaleString("vi-VN", {
      hour: "2-digit",
      minute: "2-digit",
      day: "2-digit",
      month: "2-digit",
    });
  } catch {
    return "";
  }
}

function getOptionStyle(code: string): { bg: string; dot: string } {
  const normalized = code.replace(/_/g, "-");
  if (normalized === "can-lien-he") {
    return { bg: "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100", dot: "bg-amber-500" };
  }
  if (normalized === "khong-phu-hop") {
    return { bg: "bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100", dot: "bg-rose-500" };
  }
  if (normalized === "phu-hop") {
    return { bg: "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100", dot: "bg-emerald-500" };
  }
  return { bg: "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100", dot: "bg-slate-400" };
}

// Module-level cache để các dropdown trên feed không gọi API trùng lặp
let cachedEvaluationCategories: EvaluationOption[] | null = null;
let fetchPromise: Promise<EvaluationOption[]> | null = null;

async function loadEvaluationOptions(): Promise<EvaluationOption[]> {
  if (cachedEvaluationCategories && cachedEvaluationCategories.length > 0) {
    return cachedEvaluationCategories;
  }
  if (!fetchPromise) {
    fetchPromise = allPlatformCategoriesService
      .getAll("post_evaluation", { activeOnly: true })
      .then((res) => {
        if (res.success && Array.isArray(res.data) && res.data.length > 0) {
          const mapped: EvaluationOption[] = res.data.map((cat: Category) => {
            const style = getOptionStyle(cat.code);
            return {
              code: cat.code,
              label: cat.name || cat.code,
              bg: style.bg,
              dot: style.dot,
            };
          });
          cachedEvaluationCategories = mapped;
          return mapped;
        }
        return FALLBACK_OPTIONS;
      })
      .catch(() => FALLBACK_OPTIONS)
      .finally(() => {
        fetchPromise = null;
      });
  }
  return fetchPromise;
}

export function EvaluationDropdown({ post, onEvaluationChange, disabled }: EvaluationDropdownProps) {
  const currentCode = post.evaluation_code || "chua-danh-gia";
  const currentExempt = !!post.exclude_keyword_exempt;
  const isExcluded = !!post.is_excluded && !currentExempt;

  const [options, setOptions] = useState<EvaluationOption[]>(cachedEvaluationCategories || FALLBACK_OPTIONS);
  const [code, setCode] = useState<string>(currentCode);
  const [exempt, setExempt] = useState<boolean>(currentExempt);
  const [evaluatedUser, setEvaluatedUser] = useState<EvaluatorUser | null | undefined>(post.evaluated_by_user);
  const [evaluatedAt, setEvaluatedAt] = useState<string | null | undefined>(post.evaluated_at);
  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let mounted = true;
    loadEvaluationOptions().then((loaded) => {
      if (mounted && loaded && loaded.length > 0) {
        setOptions(loaded);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (post.evaluation_code) {
      setCode(post.evaluation_code);
    }
  }, [post.evaluation_code]);

  useEffect(() => {
    setExempt(!!post.exclude_keyword_exempt);
  }, [post.exclude_keyword_exempt]);

  useEffect(() => {
    setEvaluatedUser(post.evaluated_by_user);
    setEvaluatedAt(post.evaluated_at);
  }, [post.evaluated_by_user, post.evaluated_at]);

  const activeOption =
    options.find((opt) => opt.code === code) ||
    options.find((opt) => opt.code === code.replace(/_/g, "-")) ||
    options[0] ||
    FALLBACK_OPTIONS[0];

  const handleSelectCode = async (newCode: string) => {
    if (newCode === code) {
      setIsOpen(false);
      return;
    }

    const prevCode = code;
    const prevUser = evaluatedUser;
    const prevAt = evaluatedAt;

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
        setCode(prevCode);
        setEvaluatedUser(prevUser);
        setEvaluatedAt(prevAt);
        onEvaluationChange?.(prevCode, exempt);
        toast.error(res.message || "Không thể lưu đánh giá.");
      } else {
        if (res.data?.evaluated_by_user) {
          setEvaluatedUser(res.data.evaluated_by_user);
        }
        setEvaluatedAt(res.data?.evaluated_at || new Date().toISOString());
        toast.success("Đã lưu đánh giá bài viết.");
      }
    } catch {
      setCode(prevCode);
      setEvaluatedUser(prevUser);
      setEvaluatedAt(prevAt);
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

      {/* Initials Avatar người vừa đánh giá gần nhất */}
      {evaluatedUser && (evaluatedUser.name || evaluatedUser.email) ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary border border-primary/20 text-[10px] font-bold shrink-0 cursor-default shadow-2xs select-none"
              title={`${evaluatedUser.name || evaluatedUser.email} · ${formatRelativeOrDate(evaluatedAt)}`}
            >
              {getInitials(evaluatedUser.name || evaluatedUser.email)}
            </div>
          </TooltipTrigger>
          <TooltipContent side="top">
            <span className="font-medium text-xs">
              {evaluatedUser.name || evaluatedUser.email} · {formatRelativeOrDate(evaluatedAt)}
            </span>
          </TooltipContent>
        </Tooltip>
      ) : null}

      {/* Dropdown Menu */}
      {isOpen && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setIsOpen(false)} />
          <div className="absolute left-0 top-full mt-1 w-48 rounded-lg bg-card border border-border shadow-lg p-1.5 z-40 animate-in fade-in zoom-in-95">
            <div className="text-[10px] font-bold text-muted-foreground px-2 py-1 uppercase tracking-wider">
              Đánh giá bài cào
            </div>
            {options.map((opt) => (
              <button
                key={opt.code}
                type="button"
                onClick={() => handleSelectCode(opt.code)}
                className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs font-medium text-left transition ${
                  code === opt.code || code.replace(/_/g, "-") === opt.code
                    ? "bg-muted font-bold text-foreground"
                    : "hover:bg-muted/60 text-muted-foreground"
                }`}
              >
                <span className={`w-2 h-2 rounded-full shrink-0 ${opt.dot}`} />
                <span className="flex-1">{opt.label}</span>
                {(code === opt.code || code.replace(/_/g, "-") === opt.code) && (
                  <span className="text-primary font-bold">✓</span>
                )}
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
