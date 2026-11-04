"use client";

import React, { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export interface EvaluationOption {
  value: string;
  label: string;
  color?: string;
}

// Chuẩn các trạng thái đánh giá bài viết theo Master Requirement (đồng bộ 100% tất cả mọi người)
export const EVALUATION_OPTIONS: EvaluationOption[] = [
  { value: "chua_danh_gia", label: "Chưa đánh giá" },
  { value: "can_lien_he", label: "Cần liên hệ" },
  { value: "can_xem_xet", label: "Cần xem xét" },
  { value: "phu_hop", label: "Phù hợp" },
  { value: "khong_phu_hop", label: "Chưa phù hợp (Bỏ qua)" },
];

interface PostEvaluationDropdownProps {
  postId: string;
  postUrl?: string;
  initialStatus?: string;
  onStatusChange?: (status: string) => void;
  className?: string;
}

export function PostEvaluationDropdown({
  postId,
  postUrl,
  initialStatus,
  onStatusChange,
  className,
}: PostEvaluationDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [currentValue, setCurrentValue] = useState<string>(() => {
    if (initialStatus && initialStatus !== "chua_danh_gia") return initialStatus;
    if (typeof window !== "undefined" && postId) {
      const saved = localStorage.getItem(`post_eval_${postId}`);
      if (saved) return saved;
    }
    return initialStatus || "chua_danh_gia";
  });

  const containerRef = useRef<HTMLDivElement>(null);

  // Sync state if postId or initialStatus changes (Server priority)
  useEffect(() => {
    if (initialStatus) {
      setCurrentValue(initialStatus);
      return;
    }
    if (typeof window !== "undefined" && postId) {
      const saved = localStorage.getItem(`post_eval_${postId}`);
      if (saved) {
        setCurrentValue(saved);
      }
    }
  }, [postId, initialStatus]);

  // Listen for cross-component sync event (e.g., QuickView modal to PostCard)
  useEffect(() => {
    const handleSync = (e: Event) => {
      const customEvent = e as CustomEvent<{ postId: string; postUrl?: string; status?: string; evaluation?: string }>;
      const d = customEvent.detail;
      if (d && (d.postId === postId || (postUrl && d.postUrl === postUrl))) {
        const val = d.status || d.evaluation;
        if (val) setCurrentValue(val);
      }
    };
    window.addEventListener("seeding_post_eval_updated", handleSync);
    window.addEventListener("seeding_post_evaluation_updated", handleSync);
    return () => {
      window.removeEventListener("seeding_post_eval_updated", handleSync);
      window.removeEventListener("seeding_post_evaluation_updated", handleSync);
    };
  }, [postId, postUrl]);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const currentOption =
    EVALUATION_OPTIONS.find((opt) => opt.value === currentValue) || EVALUATION_OPTIONS[0];

  const handleSelect = (option: EvaluationOption, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setCurrentValue(option.value);
    setIsOpen(false);

    if (typeof window !== "undefined" && postId) {
      // 1. Lưu localStorage để phản hồi tức thì
      localStorage.setItem(`post_eval_${postId}`, option.value);
      localStorage.setItem(`evaluation_${postId}`, option.value);
      if (postUrl) {
        localStorage.setItem(`post_eval_${postUrl}`, option.value);
        localStorage.setItem(`evaluation_${postUrl}`, option.value);
      }

      // 2. Dispatch sync event trong client
      window.dispatchEvent(
        new CustomEvent("seeding_post_eval_updated", {
          detail: { postId, postUrl, status: option.value, evaluation: option.value },
        })
      );
      window.dispatchEvent(
        new CustomEvent("seeding_post_evaluation_updated", {
          detail: { postId, postUrl, status: option.value, evaluation: option.value },
        })
      );

      // 3. Gọi Backend API lưu persistent vào server để TẤT CẢ mọi người đều thấy
      void fetch("/api/all-platform/posts/evaluations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          post_id: postId,
          post_url: postUrl || null,
          status: option.value,
          user_email: (() => {
            try {
              const u = localStorage.getItem("current_user");
              return u ? JSON.parse(u)?.email : "unknown";
            } catch {
              return "unknown";
            }
          })(),
        }),
      }).catch((err) => {
        console.error("Lưu đánh giá bài viết lên server thất bại:", err);
      });
    }

    if (onStatusChange) {
      onStatusChange(option.value);
    }

    toast.success(`✓ Tình trạng bài viết: ${option.label}`);
  };

  return (
    <div className={cn("relative inline-block text-left", className)} ref={containerRef}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        className={cn(
          "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border transition cursor-pointer select-none",
          currentValue === "chua_danh_gia"
            ? "bg-background text-foreground border-border hover:bg-muted shadow-2xs"
            : currentValue === "khong_phu_hop" || currentValue === "chua_phu_hop"
            ? "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 font-semibold shadow-xs"
            : currentValue === "can_lien_he"
            ? "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 font-semibold shadow-xs"
            : currentValue === "can_xem_xet"
            ? "bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 font-semibold shadow-xs"
            : currentValue === "phu_hop"
            ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 font-semibold shadow-xs"
            : "bg-slate-50 text-slate-700 border-slate-200 font-semibold shadow-xs"
        )}
        title="Đổi tình trạng đánh giá bài viết"
      >
        <span
          className={cn(
            "inline-block w-3 h-3 rounded-full border border-current shrink-0 opacity-80"
          )}
        />
        <span>{currentOption.label}</span>
        <span className="material-symbols-outlined text-[15px] opacity-70 ml-0.5 leading-none">
          expand_more
        </span>
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          className="absolute left-0 bottom-full mb-1 z-50 w-52 rounded-xl border border-border bg-card shadow-xl py-1 overflow-hidden animate-in fade-in zoom-in-95 duration-100"
          onClick={(e) => e.stopPropagation()}
        >
          {EVALUATION_OPTIONS.map((opt) => {
            const isSelected = opt.value === currentValue;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={(e) => handleSelect(opt, e)}
                className={cn(
                  "w-full text-left px-3.5 py-1.5 text-xs transition cursor-pointer flex items-center justify-between",
                  isSelected
                    ? "bg-blue-600 text-white font-medium hover:bg-blue-700"
                    : "text-foreground hover:bg-muted font-normal"
                )}
              >
                <span>{opt.label}</span>
                {isSelected && (
                  <span className="material-symbols-outlined text-[14px]">check</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
