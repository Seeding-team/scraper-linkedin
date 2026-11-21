"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import React, { useEffect, useState, useRef, useMemo } from "react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Phone } from "lucide-react";
import { allPlatformCategoriesService, postCallResultService } from "@/services/all-platform.service";
import type { Category, EvaluatorUser, UnifiedPost } from "@/types/unified.types";
import { getInitials } from "@/components/all-platform/layout/AllPlatformSidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export interface CallResultOption {
  code: string;
  label: string;
}

export const FALLBACK_CALL_OPTIONS: CallResultOption[] = [
  { code: "noanswer", label: "Đã gọi – không nghe máy" },
  { code: "callback", label: "Hẹn gọi lại" },
  { code: "consulting", label: "Đang tư vấn" },
  { code: "waiting", label: "Chờ phản hồi" },
  { code: "interested", label: "Có nhu cầu" },
  { code: "refused", label: "Đã từ chối" },
  { code: "nointerest", label: "Không có nhu cầu" },
  { code: "invalid", label: "Không phù hợp" },
];

// Việc 2: 3 code hay dùng nhất ghim cứng luôn hiện (thay vì phải mở dropdown) — code còn
// lại rơi vào popover "⋯", nhóm theo statusCategory ok/bad (khớp OK_CODES/BAD_CODES ở
// call-result-stats-widget.tsx).
export const PINNED_CALL_RESULT_CODES = ["interested", "noanswer", "refused"];

const OK_CALL_RESULT_CODES = new Set(["interested", "callback", "consulting", "waiting"]);
const BAD_CALL_RESULT_CODES = new Set(["noanswer", "refused", "nointerest", "invalid"]);

function callResultPillClass(code: string, isActive: boolean): string {
  const isOk = OK_CALL_RESULT_CODES.has(code);
  const base = isOk
    ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
    : "bg-red-50 text-red-700 border-red-200 hover:bg-red-100";
  return cn(
    "rounded-full border px-2.5 py-1 text-[11px] font-bold transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed",
    base,
    isActive && "ring-2 ring-offset-1 ring-current font-extrabold"
  );
}

let cachedCallResultCategories: CallResultOption[] | null = null;
let fetchCallPromise: Promise<CallResultOption[]> | null = null;

export async function loadCallResultOptions(): Promise<CallResultOption[]> {
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
  post: UnifiedPost & {
    call_result_code?: string;
    call_attempts?: number;
    last_call_at?: string;
    call_result_note?: string | null;
  };
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
  const [isOverflowOpen, setIsOverflowOpen] = useState(false);
  const [currentValue, setCurrentValue] = useState<string>(post.call_result_code || "");
  const [attempts, setAttempts] = useState<number>(post.call_attempts || 0);
  const [lastCall, setLastCall] = useState<string>(post.last_call_at || "");
  const [updatedUser, setUpdatedUser] = useState<EvaluatorUser | null | undefined>(post.updated_by_user);
  const [isSaving, setIsSaving] = useState(false);

  // Việc 3: ghi chú lý do. `noteStep` mở ngay sau khi vừa lưu 1 code (BƯỚC 2) — popover
  // "Ghi chú lý do" dùng chung cho mọi lựa chọn (ghim lẫn overflow). `isNoteViewOpen` là
  // popup XEM/SỬA note hiện tại độc lập (BƯỚC 3, icon 🗒️ cạnh nút kết quả).
  const [currentNote, setCurrentNote] = useState<string>(post.call_result_note || "");
  const [noteStep, setNoteStep] = useState<{ code: string; label: string } | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [isSavingNote, setIsSavingNote] = useState(false);
  const [isNoteViewOpen, setIsNoteViewOpen] = useState(false);
  const [noteViewDraft, setNoteViewDraft] = useState("");

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
    if (post.call_result_note !== undefined) {
      setCurrentNote(post.call_result_note || "");
    }
    setUpdatedUser(post.updated_by_user);
  }, [post.call_result_code, post.call_attempts, post.last_call_at, post.call_result_note, post.updated_by_user]);

  // Đóng popover "⋯" / "Ghi chú lý do" / xem-sửa note khi click ngoài
  useEffect(() => {
    if (!isOverflowOpen && !noteStep && !isNoteViewOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOverflowOpen(false);
        setNoteStep(null);
        setIsNoteViewOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOverflowOpen, noteStep, isNoteViewOpen]);

  const activeOption = options.find((opt) => opt.code === currentValue);

  // Việc 2: 3 code ghim luôn hiện (PINNED_CALL_RESULT_CODES) + các code còn lại rơi vào
  // popover "⋯", nhóm theo ok/bad (OK_CALL_RESULT_CODES/BAD_CALL_RESULT_CODES).
  const pinnedOptions = useMemo(
    () =>
      PINNED_CALL_RESULT_CODES.map((code) => options.find((opt) => opt.code === code)).filter(
        (opt): opt is CallResultOption => !!opt
      ),
    [options]
  );
  const overflowOptions = useMemo(
    () => options.filter((opt) => !PINNED_CALL_RESULT_CODES.includes(opt.code)),
    [options]
  );
  const overflowOkOptions = useMemo(() => overflowOptions.filter((opt) => OK_CALL_RESULT_CODES.has(opt.code)), [overflowOptions]);
  const overflowBadOptions = useMemo(() => overflowOptions.filter((opt) => BAD_CALL_RESULT_CODES.has(opt.code)), [overflowOptions]);
  const isOverflowActive = !!currentValue && overflowOptions.some((opt) => opt.code === currentValue);

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
    setIsOverflowOpen(false);
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
        // Việc 3 (BƯỚC 2): code đã lưu xong — mở bước ghi chú lý do (tùy chọn) ngay trong
        // popover, bất kể vừa chọn từ pill ghim hay popover "⋯".
        setNoteDraft("");
        setNoteStep({ code: opt.code, label: opt.label });
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

  // Việc 3: lưu riêng cột `note` (không đổi result_code, không tạo bản ghi mới). Dùng chung
  // cho bước "Ghi chú lý do" (BƯỚC 2, ngay sau khi chọn code) và popup "Xem/Sửa ghi chú"
  // (BƯỚC 3, độc lập — mở bất kỳ lúc nào qua icon 🗒️).
  const saveNote = async (noteText: string): Promise<boolean> => {
    const prevNote = currentNote;
    setCurrentNote(noteText);
    setIsSavingNote(true);
    try {
      const res = await postCallResultService.updateCallResultNote(post.id, {
        note: noteText,
        platform: post.platform || "facebook",
      });
      if (!res.success) {
        setCurrentNote(prevNote);
        toast.error(res.message || "Không thể lưu ghi chú.");
        return false;
      }
      toast.success(noteText ? "✓ Đã lưu ghi chú" : "Đã bỏ ghi chú");
      return true;
    } catch {
      setCurrentNote(prevNote);
      toast.error("Lỗi kết nối khi lưu ghi chú.");
      return false;
    } finally {
      setIsSavingNote(false);
    }
  };

  const handleNoteStepSave = async () => {
    const text = noteDraft.trim();
    if (await saveNote(text)) setNoteStep(null);
  };

  const handleNoteStepSkip = async () => {
    // "Bỏ qua" vẫn gửi note rỗng (xoá note cũ nếu có từ lần gọi trước) — theo đúng yêu cầu.
    if (await saveNote("")) setNoteStep(null);
  };

  const handleOpenNoteView = (e: React.MouseEvent) => {
    e.stopPropagation();
    setNoteViewDraft(currentNote);
    setIsNoteViewOpen((v) => !v);
  };

  const handleNoteViewSave = async () => {
    if (await saveNote(noteViewDraft.trim())) setIsNoteViewOpen(false);
  };

  const formattedLastCall = lastCall ? new Date(lastCall).toLocaleString("vi-VN") : "";

  return (
    <div ref={containerRef} className={cn("relative inline-flex items-center gap-1.5 flex-wrap", className)}>
      {pinnedOptions.map((opt) => (
        <button
          key={opt.code}
          type="button"
          disabled={disabled || isSaving}
          onClick={(e) => handleSelect(opt, e)}
          className={callResultPillClass(opt.code, currentValue === opt.code)}
          title={
            formattedLastCall && currentValue === opt.code
              ? `Lưu kết quả liên hệ: ${opt.label}. Lần gọi gần nhất: ${formattedLastCall}`
              : `Lưu kết quả liên hệ: ${opt.label}`
          }
        >
          {opt.label}
        </button>
      ))}

      {overflowOptions.length > 0 && (
        <div className="relative">
          <button
            type="button"
            disabled={disabled || isSaving}
            onClick={(e) => {
              e.stopPropagation();
              setIsOverflowOpen((v) => !v);
            }}
            aria-label="Xem thêm kết quả liên hệ"
            aria-expanded={isOverflowOpen}
            className={cn(
              "inline-flex items-center justify-center w-7 h-7 rounded-full border transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed",
              isOverflowOpen || isOverflowActive
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-card text-muted-foreground hover:bg-muted"
            )}
            title={isOverflowActive && activeOption ? `Đang chọn: ${activeOption.label}` : "Xem thêm kết quả liên hệ"}
          >
            <span className="material-symbols-outlined text-[16px] leading-none block">more_horiz</span>
          </button>

          {isOverflowOpen && (
            <div
              className="absolute left-0 top-full mt-1 z-50 w-60 p-2.5 rounded-xl border border-border bg-card shadow-xl space-y-2.5"
              onClick={(e) => e.stopPropagation()}
            >
              {overflowOkOptions.length > 0 && (
                <div>
                  <div className="text-[10px] font-extrabold tracking-wide text-emerald-600 mb-1 px-0.5">THÀNH CÔNG</div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {overflowOkOptions.map((opt) => (
                      <button
                        key={opt.code}
                        type="button"
                        disabled={disabled || isSaving}
                        onClick={(e) => handleSelect(opt, e)}
                        className={callResultPillClass(opt.code, currentValue === opt.code)}
                        title={`Lưu kết quả liên hệ: ${opt.label}`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {overflowBadOptions.length > 0 && (
                <div>
                  <div className="text-[10px] font-extrabold tracking-wide text-rose-600 mb-1 px-0.5">THẤT BẠI</div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {overflowBadOptions.map((opt) => (
                      <button
                        key={opt.code}
                        type="button"
                        disabled={disabled || isSaving}
                        onClick={(e) => handleSelect(opt, e)}
                        className={callResultPillClass(opt.code, currentValue === opt.code)}
                        title={`Lưu kết quả liên hệ: ${opt.label}`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Việc 3 (BƯỚC 2): popover "Ghi chú lý do" — mở ngay sau khi vừa lưu 1 code, bất kể
          chọn từ pill ghim hay popover "⋯" (neo theo containerRef chung, không phải theo
          từng nút riêng lẻ). */}
      {noteStep && (
        <div
          className="absolute left-0 top-full mt-1 z-50 w-64 p-2.5 rounded-xl border border-border bg-card shadow-xl space-y-2"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="text-[11px] font-semibold text-muted-foreground">
            ✓ Đã lưu: <span className="font-bold text-foreground">{noteStep.label}</span>
          </div>
          <textarea
            autoFocus
            rows={2}
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            placeholder="Ghi chú lý do (tùy chọn)"
            className="w-full resize-none rounded-lg border border-border bg-background px-2 py-1.5 text-[12px] outline-none focus:border-primary/50"
            disabled={isSavingNote}
          />
          <div className="flex items-center justify-end gap-1.5">
            <button
              type="button"
              disabled={isSavingNote}
              onClick={handleNoteStepSkip}
              className="rounded-md px-2.5 py-1 text-[11px] font-semibold text-muted-foreground hover:bg-muted transition cursor-pointer disabled:opacity-50"
            >
              Bỏ qua
            </button>
            <button
              type="button"
              disabled={isSavingNote}
              onClick={handleNoteStepSave}
              className="rounded-md bg-primary px-2.5 py-1 text-[11px] font-bold text-primary-foreground hover:bg-primary/90 transition cursor-pointer disabled:opacity-50"
            >
              Lưu
            </button>
          </div>
        </div>
      )}

      {/* Việc 3 (BƯỚC 3): icon xem/sửa ghi chú hiện có — chỉ hiện khi bài đã có kết quả liên
          hệ (post_call_results cần có dòng từ trước mới UPDATE được note). */}
      {currentValue && (
        <div className="relative">
          <button
            type="button"
            onClick={handleOpenNoteView}
            aria-label={currentNote ? "Xem/sửa ghi chú" : "Thêm ghi chú"}
            aria-expanded={isNoteViewOpen}
            className={cn(
              "inline-flex items-center justify-center w-6 h-6 rounded-full border transition cursor-pointer",
              currentNote
                ? "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100"
                : "border-border bg-card text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted"
            )}
            title={currentNote ? `Ghi chú: ${currentNote}` : "Thêm ghi chú lý do"}
          >
            <span className="text-[12px] leading-none">🗒️</span>
          </button>

          {isNoteViewOpen && (
            <div
              className="absolute left-0 top-full mt-1 z-50 w-64 p-2.5 rounded-xl border border-border bg-card shadow-xl space-y-2"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="text-[11px] font-bold text-muted-foreground">Ghi chú lý do</div>
              <textarea
                autoFocus
                rows={3}
                value={noteViewDraft}
                onChange={(e) => setNoteViewDraft(e.target.value)}
                placeholder="Ghi chú lý do..."
                className="w-full resize-none rounded-lg border border-border bg-background px-2 py-1.5 text-[12px] outline-none focus:border-primary/50"
                disabled={isSavingNote}
              />
              <div className="flex items-center justify-end gap-1.5">
                <button
                  type="button"
                  disabled={isSavingNote}
                  onClick={() => setIsNoteViewOpen(false)}
                  className="rounded-md px-2.5 py-1 text-[11px] font-semibold text-muted-foreground hover:bg-muted transition cursor-pointer disabled:opacity-50"
                >
                  Đóng
                </button>
                <button
                  type="button"
                  disabled={isSavingNote}
                  onClick={handleNoteViewSave}
                  className="rounded-md bg-primary px-2.5 py-1 text-[11px] font-bold text-primary-foreground hover:bg-primary/90 transition cursor-pointer disabled:opacity-50"
                >
                  Lưu
                </button>
              </div>
            </div>
          )}
        </div>
      )}

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
    </div>
  );
}

