"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import React, { useEffect, useState, useRef } from "react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Phone, ChevronDown } from "lucide-react";
import { allPlatformCategoriesService, postCallResultService } from "@/services/all-platform.service";
import type { Category, EvaluatorUser, UnifiedPost } from "@/types/unified.types";
import { getInitials } from "@/components/all-platform/layout/AllPlatformSidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export interface CallResultOption {
  code: string;
  label: string;
}

const FALLBACK_CALL_OPTIONS: CallResultOption[] = [
  { code: "noanswer", label: "Đã gọi – không nghe máy" },
  { code: "callback", label: "Hẹn gọi lại" },
  { code: "consulting", label: "Đang tư vấn" },
  { code: "waiting", label: "Chờ phản hồi" },
  { code: "interested", label: "Có nhu cầu" },
  { code: "refused", label: "Đã từ chối" },
  { code: "nointerest", label: "Không có nhu cầu" },
  { code: "invalid", label: "Không phù hợp" },
];

let cachedCallResultCategories: CallResultOption[] | null = null;
let fetchCallPromise: Promise<CallResultOption[]> | null = null;

async function loadCallResultOptions(): Promise<CallResultOption[]> {
  if (cachedCallResultCategories && cachedCallResultCategories.length > 0) {
    return cachedCallResultCategories;
  }
  if (!fetchCallPromise) {
    fetchCallPromise = allPlatformCategoriesService
      .getAll("call_result", { activeOnly: true })
      .then((res) => {
        if (res.success && Array.isArray(res.data) && res.data.length > 0) {
          const mapped: CallResultOption[] = res.data.map((cat: Category) => ({
            code: cat.code,
            label: cat.name || cat.code,
          }));
          cachedCallResultCategories = mapped;
          return mapped;
        }
        return FALLBACK_CALL_OPTIONS;
      })
      .catch(() => FALLBACK_CALL_OPTIONS)
      .finally(() => {
        fetchCallPromise = null;
      });
  }
  return fetchCallPromise;
}


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

interface PostCallResultDropdownProps {
  post: UnifiedPost & { call_result_code?: string; call_attempts?: number; last_call_at?: string };
  onResultChange?: (resultCode: string, attempts: number) => void;
  className?: string;
  disabled?: boolean;
}

export function PostCallResultDropdown({
  post,
  onResultChange,
  className,
  disabled,
}: PostCallResultDropdownProps) {
  const [options, setOptions] = useState<CallResultOption[]>(cachedCallResultCategories || FALLBACK_CALL_OPTIONS);
  const [isOpen, setIsOpen] = useState(false);
  const [currentValue, setCurrentValue] = useState<string>(post.call_result_code || "");
  const [attempts, setAttempts] = useState<number>(post.call_attempts || 0);
  const [lastCall, setLastCall] = useState<string>(post.last_call_at || "");
  const [updatedUser, setUpdatedUser] = useState<EvaluatorUser | null | undefined>(post.updated_by_user);
  const [isSaving, setIsSaving] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let mounted = true;
    loadCallResultOptions().then((loaded) => {
      if (mounted && loaded && loaded.length > 0) {
        setOptions(loaded);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (post.call_result_code !== undefined) {
      setCurrentValue(post.call_result_code || "");
    }
    if (post.call_attempts !== undefined) {
      setAttempts(post.call_attempts || 0);
    }
    if (post.last_call_at !== undefined) {
      setLastCall(post.last_call_at || "");
    }
    setUpdatedUser(post.updated_by_user);
  }, [post.call_result_code, post.call_attempts, post.last_call_at, post.updated_by_user]);

  // Đóng khi click ngoài
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

  const activeOption = options.find((opt) => opt.code === currentValue);
  const displayLabel = activeOption ? activeOption.label : "Kết quả liên hệ...";

  const handleSelect = async (opt: CallResultOption, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    const prevValue = currentValue;
    const prevAttempts = attempts;
    const prevLastCall = lastCall;
    const prevUser = updatedUser;

    const nextAttempts = attempts + 1;
    const nowIso = new Date().toISOString();

    setCurrentValue(opt.code);
    setAttempts(nextAttempts);
    setLastCall(nowIso);
    setIsOpen(false);
    onResultChange?.(opt.code, nextAttempts);

    setIsSaving(true);
    try {
      const res = await postCallResultService.updateCallResult(post.id, {
        result_code: opt.code,
        platform: post.platform || "facebook",
      });

      if (!res.success) {
        // Rollback
        setCurrentValue(prevValue);
        setAttempts(prevAttempts);
        setLastCall(prevLastCall);
        setUpdatedUser(prevUser);
        onResultChange?.(prevValue, prevAttempts);
        toast.error(res.message || "Không thể lưu kết quả liên hệ.");
      } else {
        if (res.data?.updated_by_user) {
          setUpdatedUser(res.data.updated_by_user);
        }
        if (res.data?.last_call_at) {
          setLastCall(res.data.last_call_at);
        }
        toast.success(`✓ Đã lưu kết quả liên hệ: ${opt.label}`);
      }
    } catch {
      setCurrentValue(prevValue);
      setAttempts(prevAttempts);
      setLastCall(prevLastCall);
      setUpdatedUser(prevUser);
      onResultChange?.(prevValue, prevAttempts);
      toast.error("Lỗi kết nối khi lưu kết quả liên hệ.");
    } finally {
      setIsSaving(false);
    }
  };

  const formattedLastCall = lastCall ? new Date(lastCall).toLocaleString("vi-VN") : "";

  return (
    <div ref={containerRef} className={cn("relative inline-flex items-center gap-1.5", className)}>
      <button
        type="button"
        disabled={disabled || isSaving}
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        className={cn(
          "inline-flex items-center justify-between gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1 text-[11px] font-semibold text-foreground transition hover:bg-muted/60 shadow-2xs cursor-pointer",
          currentValue && "border-primary/40 font-bold text-foreground",
          disabled && "opacity-60 cursor-not-allowed"
        )}
        title={formattedLastCall ? `Lần gọi gần nhất: ${formattedLastCall}` : undefined}
      >
        <span className="truncate max-w-[150px]">{displayLabel}</span>
        <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground opacity-70" />
      </button>

      {/* Attempts Badge */}
      {attempts > 0 && (
        <span
          className="inline-flex items-center gap-0.5 rounded-md border border-border bg-muted/60 px-1.5 py-0.5 text-[10px] font-bold text-foreground shadow-2xs"
          title={`Đã thực hiện ${attempts} cuộc gọi.${formattedLastCall ? ` Lần gần nhất: ${formattedLastCall}` : ""}`}
        >
          <Phone className="h-2.5 w-2.5 text-blue-500" />
          <span>{attempts} lần</span>
        </span>
      )}

      {/* Initials Avatar người vừa cập nhật kết quả liên hệ gần nhất */}
      {updatedUser && (updatedUser.name || updatedUser.email) ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-blue-500/10 text-blue-600 border border-blue-500/20 text-[10px] font-bold shrink-0 cursor-default shadow-2xs select-none"
              title={`${updatedUser.name || updatedUser.email} · {formatRelativeOrDate(lastCall)}${formatRelativeOrDate(lastCall)}`}
            >
              {getInitials(updatedUser.name || updatedUser.email)}
            </div>
          </TooltipTrigger>
          <TooltipContent side="top">
            <span className="font-medium text-xs">
              {updatedUser.name || updatedUser.email} · {formatRelativeOrDate(lastCall)}${formatRelativeOrDate(lastCall)}
            </span>
          </TooltipContent>
        </Tooltip>
      ) : null}

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          className="absolute left-0 bottom-full mb-1 z-50 w-52 rounded-xl border border-border bg-card py-1 shadow-xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-100"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="text-[10px] font-bold text-muted-foreground px-3 py-1 uppercase tracking-wider">
            Kết quả liên hệ
          </div>
          {options.map((opt) => {
            const isSelected = opt.code === currentValue;
            return (
              <button
                key={opt.code}
                type="button"
                onClick={(e) => handleSelect(opt, e)}
                className={cn(
                  "flex w-full items-center justify-between px-3 py-1.5 text-left text-[12px] font-medium transition cursor-pointer",
                  isSelected
                    ? "bg-primary text-primary-foreground font-bold"
                    : "text-foreground hover:bg-muted/70"
                )}
              >
                <span className="truncate">{opt.label}</span>
                {isSelected && <span className="text-xs">✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

