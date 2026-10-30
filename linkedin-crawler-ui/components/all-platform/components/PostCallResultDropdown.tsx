"use client";

import React, { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Phone, ChevronDown } from "lucide-react";

export interface CallResultOption {
  value: string;
  label: string;
  statusCategory?: "todo" | "doing" | "done" | "skip";
}

export const CALL_RESULT_OPTIONS: CallResultOption[] = [
  { value: "", label: "Kết quả liên hệ..." },
  { value: "noanswer", label: "Đã gọi – không nghe máy", statusCategory: "todo" },
  { value: "callback", label: "Hẹn gọi lại", statusCategory: "todo" },
  { value: "consulting", label: "Đang tư vấn", statusCategory: "doing" },
  { value: "waiting", label: "Chờ phản hồi", statusCategory: "doing" },
  { value: "interested", label: "Có nhu cầu", statusCategory: "done" },
  { value: "refused", label: "Đã từ chối", statusCategory: "done" },
  { value: "nointerest", label: "Không có nhu cầu", statusCategory: "done" },
  { value: "invalid", label: "Không phù hợp", statusCategory: "skip" },
];

interface PostCallResultDropdownProps {
  postId: string;
  initialResult?: string;
  onResultChange?: (result: string, attempts: number) => void;
  className?: string;
}

export function PostCallResultDropdown({
  postId,
  initialResult,
  onResultChange,
  className,
}: PostCallResultDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [currentValue, setCurrentValue] = useState<string>(() => {
    if (typeof window !== "undefined" && postId) {
      const saved = localStorage.getItem(`post_call_${postId}`);
      if (saved) return saved;
    }
    return initialResult || "";
  });

  const [attempts, setAttempts] = useState<number>(() => {
    if (typeof window !== "undefined" && postId) {
      const saved = localStorage.getItem(`post_call_attempts_${postId}`);
      if (saved) return parseInt(saved, 10) || 0;
    }
    return 0;
  });

  const [lastCall, setLastCall] = useState<string>(() => {
    if (typeof window !== "undefined" && postId) {
      return localStorage.getItem(`post_call_last_${postId}`) || "";
    }
    return "";
  });

  const containerRef = useRef<HTMLDivElement>(null);

  // Sync state if postId or initialResult changes
  useEffect(() => {
    if (typeof window !== "undefined" && postId) {
      const saved = localStorage.getItem(`post_call_${postId}`);
      if (saved) {
        setCurrentValue(saved);
      }
      const savedAttempts = localStorage.getItem(`post_call_attempts_${postId}`);
      if (savedAttempts) {
        setAttempts(parseInt(savedAttempts, 10) || 0);
      }
      const savedLast = localStorage.getItem(`post_call_last_${postId}`);
      if (savedLast) {
        setLastCall(savedLast);
      }
    }
  }, [postId, initialResult]);

  // Listen for cross-component sync event
  useEffect(() => {
    const handleSync = (e: Event) => {
      const customEvent = e as CustomEvent<{ postId: string; result: string; attempts: number }>;
      if (customEvent.detail?.postId === postId) {
        if (customEvent.detail.result !== undefined) setCurrentValue(customEvent.detail.result);
        if (customEvent.detail.attempts !== undefined) setAttempts(customEvent.detail.attempts);
      }
    };
    window.addEventListener("seeding_post_call_updated", handleSync);
    return () => window.removeEventListener("seeding_post_call_updated", handleSync);
  }, [postId]);

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
    CALL_RESULT_OPTIONS.find((opt) => opt.value === currentValue) || CALL_RESULT_OPTIONS[0];

  const handleSelect = (option: CallResultOption, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setCurrentValue(option.value);
    setIsOpen(false);

    let nextAttempts = attempts;
    const nowStr = new Date().toLocaleString("vi-VN");

    if (option.value) {
      nextAttempts = attempts + 1;
      setAttempts(nextAttempts);
      setLastCall(nowStr);
    }

    if (typeof window !== "undefined" && postId) {
      localStorage.setItem(`post_call_${postId}`, option.value);
      localStorage.setItem(`post_call_attempts_${postId}`, String(nextAttempts));
      localStorage.setItem(`post_call_last_${postId}`, nowStr);

      // Dispatch sync event
      window.dispatchEvent(
        new CustomEvent("seeding_post_call_updated", {
          detail: { postId, result: option.value, attempts: nextAttempts },
        })
      );
    }

    if (onResultChange) {
      onResultChange(option.value, nextAttempts);
    }

    if (option.value) {
      toast.success(`Đã lưu kết quả liên hệ · ${option.label}`);
    }
  };

  return (
    <div ref={containerRef} className={cn("relative inline-flex items-center gap-1.5", className)}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        className={cn(
          "inline-flex items-center justify-between gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-50 shadow-2xs cursor-pointer",
          currentValue && "border-slate-300 font-bold text-slate-800"
        )}
        title={lastCall ? `Lần gọi gần nhất: ${lastCall}` : undefined}
      >
        <span className="truncate max-w-[150px]">
          {currentOption.label}
        </span>
        <ChevronDown className="h-3 w-3 shrink-0 text-slate-400" />
      </button>

      {/* Attempts Badge */}
      {attempts > 0 && (
        <span
          className="inline-flex items-center gap-0.5 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-bold text-slate-600 shadow-2xs"
          title={`Đã thực hiện ${attempts} cuộc gọi. Lần gần nhất: ${lastCall || "Chưa rõ"}`}
        >
          <Phone className="h-2.5 w-2.5 text-blue-500" />
          <span>{attempts} lần</span>
        </span>
      )}

      {/* Dropdown Menu (Chuẩn theo Ảnh 2 của Master) */}
      {isOpen && (
        <div
          className="absolute left-0 bottom-full mb-1 z-50 w-52 rounded-xl border border-slate-700/80 bg-[#2d3748] py-1 text-white shadow-xl backdrop-blur-md animate-in fade-in-0 zoom-in-95 duration-100"
          onClick={(e) => e.stopPropagation()}
        >
          {CALL_RESULT_OPTIONS.map((opt) => {
            const isSelected = opt.value === currentValue;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={(e) => handleSelect(opt, e)}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] font-medium transition cursor-pointer",
                  isSelected
                    ? "bg-white/15 text-white font-bold"
                    : "text-slate-200 hover:bg-white/10 hover:text-white"
                )}
              >
                <span className="w-3 text-center text-xs">
                  {isSelected ? "✓" : ""}
                </span>
                <span className="truncate">{opt.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

