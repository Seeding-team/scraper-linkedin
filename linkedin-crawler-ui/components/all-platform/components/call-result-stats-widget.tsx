"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { cn } from "@/lib/utils";
import {
  postCallResultService,
  postContactActivityService,
  type CallResultStats,
  type ZaloMessageStats,
  type ContactActivityMember,
  type DayBreakdownItem,
  type DayBreakdownMemberItem,
  type ActivityLogItem,
  type ActivityLogActionType,
} from "@/services/all-platform.service";
import { getInitials } from "@/components/all-platform/layout/AllPlatformSidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface CallResultStatsWidgetProps {
  selectedCode: string | null;
  onSelectCode: (code: string | null) => void;
  contactMemberId: string | null;
  onSelectContactMember: (memberId: string | null) => void;
  platform?: string;
  userRole?: string;
  className?: string;
}

type Tab = "member" | "day" | "log";

/** 2 preset ghim luôn hiện + 6 preset trong popover "tune". */
type PresetKey =
  | "today"
  | "thisWeek"
  | "thisMonth"
  | "lastMonth"
  | "lastWeek"
  | "thisQuarter"
  | "lastQuarter"
  | "thisYear";

const PINNED_PRESETS: [PresetKey, string][] = [
  ["today", "Hôm nay"],
  ["thisWeek", "Tuần này"],
];
const OVERFLOW_PRESETS: [PresetKey, string][] = [
  ["thisMonth", "Tháng này"],
  ["lastMonth", "Tháng trước"],
  ["lastWeek", "Tuần trước"],
  ["thisQuarter", "Quý này"],
  ["lastQuarter", "Quý trước"],
  ["thisYear", "Năm nay"],
];

// 8 mã call_result thật (migration 215) — nhóm cố định, không lấy từ API vì đây chỉ là
// cách TRÌNH BÀY (chia 2 cột Thành công/Thất bại), không phải dữ liệu nghiệp vụ mới.
const OK_CODES = new Set(["interested", "consulting", "callback", "waiting"]);
const BAD_CODES = new Set(["noanswer", "refused", "nointerest", "invalid"]);

const ACTION_META: Record<ActivityLogActionType, { label: string; dot: string; badge: string }> = {
  seed: { label: "Seeding/Bình luận", dot: "bg-violet-500", badge: "bg-violet-50 text-violet-700 border-violet-200" },
  call: { label: "Gọi điện", dot: "bg-amber-500", badge: "bg-amber-50 text-amber-700 border-amber-200" },
  zalo: { label: "Nhắn Zalo", dot: "bg-sky-500", badge: "bg-sky-50 text-sky-700 border-sky-200" },
};

function pct(a: number, b: number): number {
  return b > 0 ? Math.round((a / b) * 100) : 0;
}

// Thiết kế mới (Bước 2): badge % cạnh số "X / Y" — xanh nếu tỷ lệ tốt (>=50%), xám nếu thấp
// nhưng vẫn có dữ liệu, đỏ nếu tỷ lệ = 0% hẳn (có mẫu số nhưng không thành công nào).
function ratioBadgeClass(pctVal: number, hasDenominator: boolean): string {
  if (!hasDenominator) return "bg-muted text-muted-foreground";
  if (pctVal >= 50) return "bg-emerald-50 text-emerald-700";
  if (pctVal > 0) return "bg-muted text-muted-foreground";
  return "bg-rose-50 text-rose-600";
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(baseIso: string, days: number): string {
  const d = new Date(baseIso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Tách "YYYY-MM-DD" bằng string split thuần — tránh `new Date(iso)` parse theo UTC rồi đọc
 * lại bằng getFullYear/getMonth theo local time (lệch ngày tùy múi giờ trình duyệt). */
function parseIsoDateParts(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d };
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function startOfMonthIso(y: number, m: number): string {
  return `${y}-${pad2(m)}-01`;
}

/** `new Date(y, m, 0)` với tham số số (không parse chuỗi) luôn cho ngày cuối tháng `m` đúng
 * theo local time, không phụ thuộc múi giờ như khi parse chuỗi ISO. */
function endOfMonthIso(y: number, m: number): string {
  const lastDay = new Date(y, m, 0).getDate();
  return `${y}-${pad2(m)}-${pad2(lastDay)}`;
}

/** Thứ Hai của tuần chứa `iso` — `new Date(y, m-1, d)` (tham số số, local time) để
 * `.getDay()` không lệch múi giờ như khi parse chuỗi ISO. getDay(): 0=CN..6=T7;
 * số ngày lùi về thứ Hai = (getDay()+6)%7 (CN lùi 6 ngày, Hai lùi 0 ngày...). */
function mondayOfWeekIso(iso: string): string {
  const { y, m, d } = parseIsoDateParts(iso);
  const dt = new Date(y, m - 1, d);
  const diffToMonday = (dt.getDay() + 6) % 7;
  dt.setDate(dt.getDate() - diffToMonday);
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}

/** Quý: tháng 1/4/7/10 làm mốc đầu quý -> tháng đầu quý chứa tháng `m`. */
function quarterStartMonth(m: number): number {
  return Math.floor((m - 1) / 3) * 3 + 1;
}

function presetRange(preset: PresetKey): { date_from: string; date_to: string } {
  const to = todayIso();
  if (preset === "today") return { date_from: to, date_to: to };
  const { y, m } = parseIsoDateParts(to);
  if (preset === "thisWeek") return { date_from: mondayOfWeekIso(to), date_to: to };
  if (preset === "lastWeek") {
    const thisMonday = mondayOfWeekIso(to);
    return { date_from: addDaysIso(thisMonday, -7), date_to: addDaysIso(thisMonday, -1) };
  }
  if (preset === "thisMonth") return { date_from: startOfMonthIso(y, m), date_to: to };
  if (preset === "lastMonth") {
    const prevM = m === 1 ? 12 : m - 1;
    const prevY = m === 1 ? y - 1 : y;
    return { date_from: startOfMonthIso(prevY, prevM), date_to: endOfMonthIso(prevY, prevM) };
  }
  if (preset === "thisQuarter") {
    const qStart = quarterStartMonth(m);
    return { date_from: startOfMonthIso(y, qStart), date_to: to };
  }
  if (preset === "lastQuarter") {
    const qStart = quarterStartMonth(m);
    let prevQStart = qStart - 3;
    let prevY = y;
    if (prevQStart < 1) {
      prevQStart += 12;
      prevY -= 1;
    }
    return { date_from: startOfMonthIso(prevY, prevQStart), date_to: endOfMonthIso(prevY, prevQStart + 2) };
  }
  // thisYear
  return { date_from: `${y}-01-01`, date_to: to };
}

function formatDay(day: string): string {
  const parts = day.split("-");
  if (parts.length !== 3) return day;
  return `${parts[2]}/${parts[1]}`;
}

// Thiết kế mới (Bước 2): tiêu đề mỗi cột trong "3 thẻ số liệu" — icon màu trong khung vuông bo
// góc ~40px + icon "ⓘ" kèm Tooltip (Radix, tái dùng đúng component đã dùng ở post-card/dropdown
// updated_by) giải thích ngắn gọn ý nghĩa số liệu của cột.
function StatCardHeader({
  icon,
  iconBgClass,
  iconTextClass,
  title,
  tooltip,
}: {
  icon: string;
  iconBgClass: string;
  iconTextClass: string;
  title: string;
  tooltip: string;
}) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <span
        className={cn("flex items-center justify-center w-10 h-10 rounded-xl shrink-0", iconBgClass, iconTextClass)}
      >
        <span className="material-symbols-outlined text-[20px]">{icon}</span>
      </span>
      <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-muted-foreground">
        {title}
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="material-symbols-outlined text-[14px] cursor-default opacity-70 hover:opacity-100">
              info
            </span>
          </TooltipTrigger>
          <TooltipContent side="top">
            <span className="font-medium text-xs max-w-[220px] inline-block">{tooltip}</span>
          </TooltipContent>
        </Tooltip>
      </span>
    </div>
  );
}

function MemberChip({
  memberId,
  name,
  email,
  total,
  active,
  onClick,
}: {
  memberId: string;
  name: string | null;
  email: string | null;
  total: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-semibold transition cursor-pointer",
        active ? "border-primary bg-primary/10 text-primary" : "border-border bg-card hover:bg-muted text-foreground"
      )}
    >
      <span className="flex items-center justify-center w-[18px] h-[18px] rounded-full bg-primary/10 text-primary text-[9px] font-bold shrink-0">
        {getInitials(name || email || memberId)}
      </span>
      <span className="max-w-[140px] truncate">{name || email || memberId}</span>
      <span className="font-bold text-[11px] opacity-80">{total}</span>
    </button>
  );
}

export function CallResultStatsWidget({
  selectedCode,
  onSelectCode,
  contactMemberId,
  onSelectContactMember,
  platform,
  className,
}: CallResultStatsWidgetProps) {
  // Bộ lọc thời gian "pinned + overflow": preset chỉ set giá trị khởi tạo, sau đó date_from/date_to
  // committed (dùng để fetch) và draft (gắn trực tiếp vào 2 input ngày) tách riêng — xem applyPreset/
  // handleDraftDateChange bên dưới.
  const initialRange = useMemo(() => presetRange("thisWeek"), []);
  const [dateFrom, setDateFrom] = useState(initialRange.date_from);
  const [dateTo, setDateTo] = useState(initialRange.date_to);
  const [draftFrom, setDraftFrom] = useState(initialRange.date_from);
  const [draftTo, setDraftTo] = useState(initialRange.date_to);
  const [activePreset, setActivePreset] = useState<PresetKey | null>("thisWeek");
  const [dateRangeError, setDateRangeError] = useState<string | null>(null);
  const [isOverflowOpen, setIsOverflowOpen] = useState(false);
  const overflowRef = useRef<HTMLDivElement>(null);

  const [expanded, setExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("member");
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());

  const [callStats, setCallStats] = useState<CallResultStats | null>(null);
  const [zaloStats, setZaloStats] = useState<ZaloMessageStats | null>(null);
  const [who, setWho] = useState<ContactActivityMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [logItems, setLogItems] = useState<ActivityLogItem[]>([]);
  const [logTotal, setLogTotal] = useState(0);
  const [logCounts, setLogCounts] = useState<{ all: number; seed: number; call: number; zalo: number }>({
    all: 0, seed: 0, call: 0, zalo: 0,
  });
  const [logPage, setLogPage] = useState(1);
  const [logActionFilter, setLogActionFilter] = useState<ActivityLogActionType | null>(null);
  const [isLoadingLog, setIsLoadingLog] = useState(false);
  const LOG_PAGE_SIZE = 10;

  const [dayRows, setDayRows] = useState<DayBreakdownItem[]>([]);
  const [isLoadingDay, setIsLoadingDay] = useState(false);

  // date_from/date_to = committed (chỉ đổi khi 2 ô ngày hợp lệ) — API 3 tab (who/by-day/log) đã
  // nhận date_from/date_to dạng "YYYY-MM-DD" tùy ý từ trước (không phải enum cố định), nên không
  // cần sửa gì ở backend cho bộ lọc tùy chỉnh này.
  const date_from = dateFrom;
  const date_to = dateTo;
  const resolvedPlatform = platform && platform !== "all" ? platform : undefined;

  const applyPreset = useCallback((preset: PresetKey) => {
    const range = presetRange(preset);
    setDraftFrom(range.date_from);
    setDraftTo(range.date_to);
    setDateFrom(range.date_from);
    setDateTo(range.date_to);
    setActivePreset(preset);
    setDateRangeError(null);
    setIsOverflowOpen(false);
  }, []);

  const handleDraftDateChange = useCallback((which: "from" | "to", value: string) => {
    if (which === "from") setDraftFrom(value);
    else setDraftTo(value);
    // Sửa tay (dù chưa xong) -> bỏ active mọi preset ngay lập tức.
    setActivePreset(null);

    const nextFrom = which === "from" ? value : draftFrom;
    const nextTo = which === "to" ? value : draftTo;
    const today = todayIso();

    if (!nextFrom || !nextTo) {
      // Đang gõ dở (input date rỗng cho tới khi đủ ngày/tháng/năm) -> không fetch, không báo lỗi.
      setDateRangeError(null);
      return;
    }
    if (nextFrom > today || nextTo > today) {
      // Phòng vệ thêm cho trường hợp input không chặn được ngày tương lai (đã có `max` ở input).
      setDateRangeError(null);
      return;
    }
    if (nextTo < nextFrom) {
      setDateRangeError('Ngày "Đến" phải từ ngày "Từ" trở đi.');
      return;
    }
    setDateRangeError(null);
    setDateFrom(nextFrom);
    setDateTo(nextTo);
  }, [draftFrom, draftTo]);

  // Đóng popover overflow khi bấm ra ngoài — không dùng portal (tránh lớp bug dropdown-portal
  // đóng nhầm modal/sidebar đã gặp ở nơi khác, xem PostAssigneeDropdown.tsx).
  useEffect(() => {
    if (!isOverflowOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (overflowRef.current && !overflowRef.current.contains(e.target as Node)) {
        setIsOverflowOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOverflowOpen]);

  const fetchOverview = useCallback(async () => {
    setIsLoading(true);
    try {
      const [callRes, zaloRes, whoRes] = await Promise.all([
        postCallResultService.getStats({
          date_from,
          date_to,
          platform: resolvedPlatform,
          result_code: selectedCode || undefined,
          member_id: contactMemberId || undefined,
        }),
        postContactActivityService.getZaloMessageStats({
          date_from,
          date_to,
          platform: resolvedPlatform,
          member_id: contactMemberId || undefined,
        }),
        postContactActivityService.getWhoDidWhat({
          date_from,
          date_to,
          platform: resolvedPlatform,
        }),
      ]);
      if (callRes.success && callRes.data) setCallStats(callRes.data);
      if (zaloRes.success && zaloRes.data) setZaloStats(zaloRes.data);
      if (whoRes.success && whoRes.data) setWho(whoRes.data);
    } catch {
      // ignore — widget chỉ là bổ trợ, không chặn feed chính nếu lỗi
    } finally {
      setIsLoading(false);
    }
  }, [date_from, date_to, resolvedPlatform, selectedCode, contactMemberId]);

  useEffect(() => {
    void fetchOverview();
  }, [fetchOverview]);

  const fetchLog = useCallback(async () => {
    setIsLoadingLog(true);
    try {
      const res = await postContactActivityService.getActivityLog({
        date_from,
        date_to,
        platform: resolvedPlatform,
        member_id: contactMemberId || undefined,
        action_type: logActionFilter || undefined,
        page: logPage,
        page_size: LOG_PAGE_SIZE,
      });
      if (res.success && res.data) {
        setLogItems(res.data.items);
        setLogTotal(res.data.total);
        setLogCounts(res.data.counts);
      }
    } catch {
      // ignore
    } finally {
      setIsLoadingLog(false);
    }
  }, [date_from, date_to, resolvedPlatform, contactMemberId, logActionFilter, logPage]);

  useEffect(() => {
    if (expanded && activeTab === "log") void fetchLog();
  }, [expanded, activeTab, fetchLog]);

  // Đổi kỳ/platform/thành viên -> quay lại trang 1 của Nhật ký hoạt động
  useEffect(() => {
    setLogPage(1);
  }, [date_from, date_to, resolvedPlatform, contactMemberId, logActionFilter]);

  const fetchDayBreakdown = useCallback(async () => {
    setIsLoadingDay(true);
    try {
      const res = await postContactActivityService.getDayBreakdown({
        date_from,
        date_to,
        platform: resolvedPlatform,
        member_id: contactMemberId || undefined,
      });
      if (res.success && res.data) setDayRows(res.data);
    } catch {
      // ignore
    } finally {
      setIsLoadingDay(false);
    }
  }, [date_from, date_to, resolvedPlatform, contactMemberId]);

  useEffect(() => {
    if (expanded && activeTab === "day") void fetchDayBreakdown();
  }, [expanded, activeTab, fetchDayBreakdown]);

  const toggleDayExpanded = useCallback((day: string) => {
    setExpandedDays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  }, []);

  const periodLabel = activePreset
    ? ([...PINNED_PRESETS, ...OVERFLOW_PRESETS].find(([key]) => key === activePreset)?.[1] || "").toLowerCase()
    : `${formatDay(date_from)} – ${formatDay(date_to)}`;

  const callTotal = callStats?.total || 0;
  const callOk = useMemo(
    () => (callStats?.by_type || []).filter((t) => OK_CODES.has(t.code)).reduce((s, t) => s + t.count, 0),
    [callStats]
  );
  // "Tổng số điện thoại" (Việc 2026-11-25): dùng CHUNG cho cả "Cuộc gọi" và "Zalo" (cùng 1 con số
  // Z) — luôn toàn cục, không đổi theo dropdown thành viên, không có %/so kỳ trước.
  const totalUniquePhonesCount = callStats?.total_unique_phones_count ?? 0;
  // Cột "Comment" dạng "X/Y" (Việc 3+4, 2026-11-23): X = comment_distinct_post_count (số BÀI
  // khác nhau đã comment, COUNT DISTINCT id_post — không phải số lượt/dòng như comment_count
  // cũ), Y = comment_post_pool_count (tổng bài phù hợp trong kỳ, đã thu hẹp theo thành viên
  // đang lọc nếu có). % xu hướng tính trên X so với kỳ trước (comment_distinct_post_count_prev)
  // theo đúng công thức đã dùng ở totalPostsPctChange — KHÔNG còn delta tuyệt đối "+N/-N" cũ.
  const commentDistinctPostCount = callStats?.comment_distinct_post_count ?? 0;
  const commentDistinctPostCountPrev = callStats?.comment_distinct_post_count_prev ?? 0;
  const commentPostPoolCount = callStats?.comment_post_pool_count ?? 0;
  const commentPostPctChange =
    commentDistinctPostCountPrev > 0
      ? Math.round(((commentDistinctPostCount - commentDistinctPostCountPrev) / commentDistinctPostCountPrev) * 100)
      : commentDistinctPostCount > 0
        ? 100
        : 0;

  // Card "Tổng bài" (Việc 1): số bài crawl trong kỳ + % so với kỳ trước liền kề cùng độ
  // dài. Không có mẫu số cố định như callPctVal/zaloPctVal (đây là % TĂNG/GIẢM so với kỳ
  // trước, không phải tỷ lệ thành công/tổng) nên tính riêng, +100% khi kỳ trước = 0 nhưng
  // kỳ này > 0 (từ 0 lên có dữ liệu), 0% khi cả 2 kỳ đều = 0.
  const totalPostsCount = callStats?.total_posts_count ?? 0;
  const totalPostsCountPrev = callStats?.total_posts_count_prev ?? 0;
  // Tử số "X/Y" (Việc 2): trong totalPostsCount, số bài KHÔNG bị đánh giá "Không phù hợp".
  // % xu hướng bên dưới vẫn tính trên Y (totalPostsCount so với kỳ trước) — không đổi.
  const totalPostsSuitableCount = callStats?.total_posts_suitable_count ?? 0;
  const totalPostsPctChange =
    totalPostsCountPrev > 0
      ? Math.round(((totalPostsCount - totalPostsCountPrev) / totalPostsCountPrev) * 100)
      : totalPostsCount > 0
        ? 100
        : 0;

  const sortedWho = useMemo(() => [...who].sort((a, b) => b.total - a.total), [who]);

  // Bảng "Theo thành viên": merge who (seed/call ok+bad/zalo sent/tổng) + zaloStats.by_member (replied).
  // `who` cố ý KHÔNG lọc member_id ở API (dropdown + thanh "Ai đã làm" cần đủ mọi người), nên lọc
  // ở đây cho khớp tab "Theo ngày" (getDayBreakdown có truyền member_id).
  const memberTableRows = useMemo(() => {
    const repliedMap = new Map((zaloStats?.by_member || []).map((m) => [m.member_id, m.replied]));
    return sortedWho
      .filter((m) => !contactMemberId || m.member_id === contactMemberId)
      .map((m) => ({
        ...m,
        zaloReplied: repliedMap.get(m.member_id) || 0,
      }));
  }, [sortedWho, zaloStats, contactMemberId]);

  const memberTableTotals = useMemo(
    () =>
      memberTableRows.reduce(
        (acc, m) => ({
          seed: acc.seed + m.seed,
          call_ok: acc.call_ok + m.call_ok,
          call_bad: acc.call_bad + m.call_bad,
          zalo: acc.zalo + m.zalo,
          zaloReplied: acc.zaloReplied + m.zaloReplied,
          total: acc.total + m.total,
        }),
        { seed: 0, call_ok: 0, call_bad: 0, zalo: 0, zaloReplied: 0, total: 0 }
      ),
    [memberTableRows]
  );

  const dayTableTotals = useMemo(
    () =>
      dayRows.reduce(
        (acc, d) => ({
          seed: acc.seed + d.seed,
          call_ok: acc.call_ok + d.call_ok,
          call_bad: acc.call_bad + d.call_bad,
          zalo_sent: acc.zalo_sent + d.zalo_sent,
          zalo_replied: acc.zalo_replied + d.zalo_replied,
          total: acc.total + d.total,
        }),
        { seed: 0, call_ok: 0, call_bad: 0, zalo_sent: 0, zalo_replied: 0, total: 0 }
      ),
    [dayRows]
  );

  const logTotalPages = Math.max(1, Math.ceil(logTotal / LOG_PAGE_SIZE));

  if (isLoading && !callStats) {
    return (
      <div className={cn("bg-card border border-border rounded-2xl p-5", className)}>
        <div className="h-[80px] flex items-center justify-center text-xs text-muted-foreground">Đang tải...</div>
      </div>
    );
  }

  // Bộ lọc thời gian (Việc 3, 2026-11-21): về lại đúng 1 vị trí duy nhất — trong header widget,
  // luôn hiện bất kể thu gọn/mở rộng (đã bỏ tính năng đổi vị trí ngang hàng 3 tab khi mở rộng).
  const filterBar = (
    <div className="flex items-center gap-1.5 flex-wrap">
      {PINNED_PRESETS.map(([key, label]) => (
        <button
          key={key}
          type="button"
          onClick={() => applyPreset(key)}
          className={cn(
            "px-2.5 py-1 rounded-full border text-[11px] transition cursor-pointer",
            activePreset === key
              ? "border-border bg-muted text-foreground font-medium"
              : "border-border bg-card text-muted-foreground hover:text-foreground font-bold"
          )}
        >
          {label}
        </button>
      ))}

      <div className="relative" ref={overflowRef}>
        <button
          type="button"
          onClick={() => setIsOverflowOpen((v) => !v)}
          aria-label="Chọn khoảng thời gian khác"
          aria-expanded={isOverflowOpen}
          className={cn(
            "flex items-center justify-center w-7 h-7 rounded-lg border transition cursor-pointer",
            isOverflowOpen || OVERFLOW_PRESETS.some(([key]) => key === activePreset)
              ? "border-primary bg-primary/10 text-primary"
              : "border-border bg-card text-muted-foreground hover:text-foreground"
          )}
        >
          <span className="material-symbols-outlined text-[16px]">tune</span>
        </button>
        {isOverflowOpen && (
          <div className="absolute right-0 top-[calc(100%+4px)] z-20 w-40 rounded-lg border border-border bg-card shadow-lg p-1">
            {OVERFLOW_PRESETS.map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => applyPreset(key)}
                className={cn(
                  "w-full text-left px-2.5 py-1.5 rounded-md text-[12px] transition cursor-pointer",
                  activePreset === key ? "bg-muted font-medium text-foreground" : "text-foreground hover:bg-muted"
                )}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        <input
          type="date"
          aria-label="Từ ngày"
          value={draftFrom}
          max={todayIso()}
          onChange={(e) => handleDraftDateChange("from", e.target.value)}
          className="h-7 rounded-lg border border-border bg-card px-1.5 text-[11px]"
        />
        <span className="text-[11px] text-muted-foreground">–</span>
        <input
          type="date"
          aria-label="Đến ngày"
          value={draftTo}
          max={todayIso()}
          onChange={(e) => handleDraftDateChange("to", e.target.value)}
          className="h-7 rounded-lg border border-border bg-card px-1.5 text-[11px]"
        />
      </div>

      {dateRangeError && (
        <span className="w-full text-[11px] font-semibold text-rose-600">{dateRangeError}</span>
      )}
    </div>
  );

  return (
    <div className={cn("bg-card border border-border rounded-2xl overflow-hidden", className)}>
      <div className="flex items-center justify-between gap-3 flex-wrap p-5 pb-3">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px] text-primary">call</span>
          <h3 className="text-sm font-bold text-foreground">Kết quả liên hệ</h3>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={contactMemberId || "all"}
            onChange={(e) => onSelectContactMember(e.target.value === "all" ? null : e.target.value)}
            className="h-8 rounded-lg border border-border bg-card px-2 text-[12px] font-medium"
          >
            <option value="all">Tất cả thành viên</option>
            {sortedWho.map((m) => (
              <option key={m.member_id} value={m.member_id}>
                {m.name || m.email || m.member_id}
              </option>
            ))}
          </select>

          {filterBar}
        </div>
      </div>

      {/* 4 thẻ số liệu, thứ tự Comment → Zalo → Cuộc gọi → Tổng bài (2026-11-25) — icon vuông
          màu + "X / Y" + badge % (Cuộc gọi/Zalo/Tổng bài) hoặc "+N/-N" (Comment) + progress bar
          mỏng (mọi card, Việc 8). Cột Zalo hiển thị "đã trả lời / đã gửi" (zaloStats.replied/sent).
          Việc 7 (2026-11-26): 4 card tách rời (rounded-2xl + bg-card + shadow-sm + gap-3, không
          còn border-b/border-l chia vách lưới) — viền trên 3px + nền icon + icon + progress bar
          mỗi card vẫn dùng 1 màu chủ đề riêng (viền trên gắn bằng inline style). Việc 9: mỗi card
          flex flex-col justify-between h-full để 4 thanh tiến trình canh ngang hàng nhau. Badge %
          và chip Thành công/Thất bại KHÔNG đổi (vẫn xanh/đỏ/xám theo tỷ lệ, độc lập màu chủ đề). */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 p-4 bg-muted/20 border-t border-border">
        <div
          className="flex flex-col justify-between h-full p-4 rounded-2xl bg-card shadow-sm"
          style={{ borderTop: "3px solid #993556" }}
        >
          <div>
            <StatCardHeader
              icon="mode_comment"
              iconBgClass="bg-[#FBEAF0]"
              iconTextClass="text-[#993556]"
              title="Comment"
              tooltip="Số bài đã có seeding/bình luận trên tổng số bài phù hợp trong kỳ đang chọn (mẫu số thu hẹp theo đúng thành viên nếu đang lọc 1 người), so với cùng độ dài kỳ liền trước."
            />
            <div className="flex items-center gap-2">
              <span className="text-[26px] font-extrabold leading-tight">
                {commentDistinctPostCount} / {commentPostPoolCount}
              </span>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[11px] font-bold",
                  commentPostPctChange > 0
                    ? "bg-emerald-50 text-emerald-700"
                    : commentPostPctChange < 0
                      ? "bg-rose-50 text-rose-600"
                      : "bg-muted text-muted-foreground"
                )}
              >
                {commentPostPctChange > 0 ? "+" : ""}
                {commentPostPctChange}%
              </span>
            </div>
            <div className="text-[12px] text-muted-foreground mt-0.5">
              {commentDistinctPostCount} bài đã comment / {commentPostPoolCount} bài phù hợp trong kỳ
            </div>
          </div>
          <div className="h-1 rounded-full overflow-hidden bg-muted mt-2.5">
            <span
              className="block h-full"
              style={{ width: `${pct(commentDistinctPostCount, totalPostsSuitableCount)}%`, backgroundColor: "#993556" }}
            />
          </div>
        </div>

        {(() => {
          const zaloSent = zaloStats?.sent ?? 0;
          const zaloReplied = zaloStats?.replied ?? 0;
          const zaloPctVal = pct(zaloReplied, zaloSent);
          return (
            <div
              className="flex flex-col justify-between h-full p-4 rounded-2xl bg-card shadow-sm"
              style={{ borderTop: "3px solid #0F6E56" }}
            >
              <div>
                <StatCardHeader
                  icon="chat"
                  iconBgClass="bg-[#E1F5EE]"
                  iconTextClass="text-[#0F6E56]"
                  title="Zalo"
                  tooltip="Số cuộc trò chuyện Zalo khách đã trả lời / tổng số tin nhắn Zalo đã gửi từ bài seeding / tổng số điện thoại khác nhau trích được từ bài phù hợp trong kỳ đang chọn."
                />
                <div className="flex items-center gap-2">
                  <span className="text-[26px] font-extrabold leading-tight">
                    {zaloReplied} / {zaloSent} / {totalUniquePhonesCount}
                  </span>
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold", ratioBadgeClass(zaloPctVal, zaloSent > 0))}>
                    {zaloPctVal}%
                  </span>
                </div>
                <div className="text-[12px] text-muted-foreground mt-0.5">
                  {zaloReplied} khách đã phản hồi / {zaloSent} tin đã gửi / {totalUniquePhonesCount} số điện thoại
                </div>
              </div>
              <div className="h-1 rounded-full overflow-hidden bg-muted mt-2.5">
                <span className="block h-full" style={{ width: `${zaloPctVal}%`, backgroundColor: "#0F6E56" }} />
              </div>
            </div>
          );
        })()}

        {(() => {
          const callPctVal = pct(callOk, callTotal);
          return (
            <div
              className="flex flex-col justify-between h-full p-4 rounded-2xl bg-card shadow-sm"
              style={{ borderTop: "3px solid #D85A30" }}
            >
              <div>
                <StatCardHeader
                  icon="call"
                  iconBgClass="bg-[#FAECE7]"
                  iconTextClass="text-[#D85A30]"
                  title="Cuộc gọi"
                  tooltip="Số cuộc gọi có kết quả thành công (Có nhu cầu/Hẹn gọi lại/Đang tư vấn/Chờ phản hồi) / tổng số cuộc gọi đã ghi nhận / tổng số điện thoại khác nhau trích được từ bài phù hợp trong kỳ đang chọn."
                />
                <div className="flex items-center gap-2">
                  <span className="text-[26px] font-extrabold leading-tight">
                    {callOk} / {callTotal} / {totalUniquePhonesCount}
                  </span>
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold", ratioBadgeClass(callPctVal, callTotal > 0))}>
                    {callPctVal}%
                  </span>
                </div>
                <div className="text-[12px] text-muted-foreground mt-0.5">
                  {callOk} cuộc gọi thành công / {callTotal} đã thực hiện / {totalUniquePhonesCount} số điện thoại
                </div>
              </div>
              <div className="h-1 rounded-full overflow-hidden bg-muted mt-2.5">
                <span className="block h-full" style={{ width: `${callPctVal}%`, backgroundColor: "#D85A30" }} />
              </div>
            </div>
          );
        })()}

        <div
          className="flex flex-col justify-between h-full p-4 rounded-2xl bg-card shadow-sm"
          style={{ borderTop: "3px solid #534AB7" }}
        >
          <div>
            <StatCardHeader
              icon="description"
              iconBgClass="bg-[#EEEDFE]"
              iconTextClass="text-[#534AB7]"
              title="Tổng bài"
              tooltip="Số bài viết đã crawl về hệ thống trong kỳ đang chọn (mọi nền tảng, không lọc theo thành viên), so với cùng độ dài kỳ liền trước. Tử số là số bài chưa bị đánh giá 'Không phù hợp'."
            />
            <div className="flex items-center gap-2">
              <span className="text-[26px] font-extrabold leading-tight">
                {totalPostsSuitableCount} / {totalPostsCount}
              </span>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[11px] font-bold",
                  totalPostsPctChange > 0
                    ? "bg-emerald-50 text-emerald-700"
                    : totalPostsPctChange < 0
                      ? "bg-rose-50 text-rose-600"
                      : "bg-muted text-muted-foreground"
                )}
              >
                {totalPostsPctChange > 0 ? "+" : ""}
                {totalPostsPctChange}%
              </span>
            </div>
            <div className="text-[12px] text-muted-foreground mt-0.5">
              {totalPostsSuitableCount} bài phù hợp / {totalPostsCount} bài crawl trong kỳ, kỳ trước {totalPostsCountPrev} bài
            </div>
          </div>
          <div className="h-1 rounded-full overflow-hidden bg-muted mt-2.5">
            <span
              className="block h-full"
              style={{ width: `${pct(totalPostsSuitableCount, totalPostsCount)}%`, backgroundColor: "#534AB7" }}
            />
          </div>
        </div>
      </div>

      {/* Thanh "Ai đã làm" — luôn hiện */}
      <div className="flex items-center gap-1.5 flex-wrap px-4 py-3 border-t border-border">
        <span className="text-[12px] font-bold text-muted-foreground mr-1 inline-flex items-center gap-1">
          <span className="material-symbols-outlined text-[15px]">group</span> Ai đã làm {periodLabel}:
        </span>
        {sortedWho.length === 0 ? (
          <span className="text-[12px] text-muted-foreground">Chưa có hoạt động nào</span>
        ) : (
          sortedWho.map((m) => (
            <MemberChip
              key={m.member_id}
              memberId={m.member_id}
              name={m.name}
              email={m.email}
              total={m.total}
              active={contactMemberId === m.member_id}
              onClick={() => onSelectContactMember(contactMemberId === m.member_id ? null : m.member_id)}
            />
          ))
        )}
        {contactMemberId ? (
          <button
            type="button"
            onClick={() => onSelectContactMember(null)}
            className="inline-flex items-center gap-1 text-[12px] font-semibold text-primary hover:underline"
          >
            Xem tất cả
          </button>
        ) : null}
      </div>

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-center gap-1.5 h-9 border-t border-border text-[12.5px] font-bold text-primary hover:bg-primary/5 transition cursor-pointer"
      >
        {expanded ? "Thu gọn" : "Xem đầy đủ"}
        <svg
          className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="border-t border-border">
          {/* Chips nhóm Thành công / Thất bại — bấm lọc danh sách bài */}
          <div className="p-4 border-b border-border">
            <div className="text-[12.5px] font-bold mb-2 flex items-center gap-2 flex-wrap">
              <span className="material-symbols-outlined text-[15px] text-muted-foreground">call</span>
              Chi tiết kết quả cuộc gọi
              <span className="font-normal text-muted-foreground">— bấm để lọc danh sách bài bên dưới</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {([
                ["ok", "THÀNH CÔNG", "text-emerald-600"],
                ["bad", "THẤT BẠI", "text-rose-600"],
              ] as const).map(([grp, label, colorClass]) => (
                <div key={grp}>
                  <div className={cn("text-[11px] font-extrabold tracking-wide mb-1.5", colorClass)}>{label}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {(callStats?.by_type || [])
                      .filter((t) => (grp === "ok" ? OK_CODES.has(t.code) : BAD_CODES.has(t.code)))
                      .map((t) => {
                        const isActive = selectedCode === t.code;
                        return (
                          <button
                            key={t.code}
                            type="button"
                            onClick={() => onSelectCode(isActive ? null : t.code)}
                            className={cn(
                              "inline-flex items-center gap-1.5 rounded-full border h-7 pl-2.5 pr-1 text-[12px] font-semibold transition cursor-pointer",
                              isActive ? "border-primary bg-primary/10 text-primary" : "border-border bg-card hover:bg-muted"
                            )}
                          >
                            <span>{t.name}</span>
                            <span
                              className={cn(
                                "min-w-[20px] h-5 rounded-full grid place-items-center text-[11px] font-bold",
                                grp === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
                              )}
                            >
                              {t.count}
                            </span>
                          </button>
                        );
                      })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {selectedCode ? (
            <div className="flex items-center justify-between gap-3 mx-4 my-3 px-3 py-2 rounded-xl bg-primary/10 text-primary text-[12px]">
              <span>
                Đang lọc bài: <b>{(callStats?.by_type || []).find((t) => t.code === selectedCode)?.name || selectedCode}</b>
              </span>
              <button type="button" onClick={() => onSelectCode(null)} className="font-bold hover:underline">
                ✕ Bỏ lọc
              </button>
            </div>
          ) : null}

          {/* Tin nhắn Zalo */}
          <div className="p-4 border-b border-border">
            <div className="text-[12.5px] font-bold mb-2 flex items-center gap-2">
              <span className="material-symbols-outlined text-[15px] text-muted-foreground">chat</span>
              Tin nhắn Zalo
            </div>
            <div className="grid grid-cols-3 gap-2 mb-2">
              <div className="border border-border rounded-lg px-3 py-2">
                <div className="text-[11px] text-muted-foreground font-semibold">Đã gửi</div>
                <div className="text-[17px] font-extrabold">{zaloStats?.sent ?? 0}</div>
              </div>
              <div className="border border-border rounded-lg px-3 py-2">
                <div className="text-[11px] text-muted-foreground font-semibold">Khách đã trả lời</div>
                <div className="text-[17px] font-extrabold text-emerald-600">{zaloStats?.replied ?? 0}</div>
              </div>
              <div className="border border-border rounded-lg px-3 py-2">
                <div className="text-[11px] text-muted-foreground font-semibold">Chưa trả lời</div>
                <div className="text-[17px] font-extrabold text-amber-600">
                  {Math.max(0, (zaloStats?.sent ?? 0) - (zaloStats?.replied ?? 0))}
                </div>
              </div>
            </div>
            {zaloStats && zaloStats.sent > 0 && (
              <div className="flex h-1.5 rounded-full overflow-hidden bg-muted">
                <span className="bg-emerald-500" style={{ width: `${pct(zaloStats.replied, zaloStats.sent)}%` }} />
                <span
                  className="bg-amber-400"
                  style={{ width: `${pct(zaloStats.sent - zaloStats.replied, zaloStats.sent)}%` }}
                />
              </div>
            )}
          </div>

          {/* Việc 3 (2026-11-21): bỏ hẳn tính năng đổi vị trí bộ lọc thời gian theo trạng thái
              thu gọn/mở rộng — filterBar giờ chỉ render đúng 1 chỗ, trong header widget (cạnh
              tiêu đề + dropdown thành viên), luôn hiện bất kể expanded. */}
          <div className="p-4">
            <div className="mb-3">
              <div className="inline-flex gap-1 bg-muted rounded-lg p-1">
                {([
                  ["member", "Theo thành viên"],
                  ["day", "Thống kê theo ngày"],
                  ["log", "Nhật ký hoạt động"],
                ] as [Tab, string][]).map(([t, label]) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setActiveTab(t)}
                    className={cn(
                      "px-2.5 py-1 rounded-md text-[12px] font-bold transition cursor-pointer",
                      activeTab === t ? "bg-card text-foreground shadow-2xs" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {activeTab === "member" && (
              <div className="overflow-x-auto">
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="text-[11px] text-muted-foreground font-bold text-left">
                      <th className="py-1.5">Thành viên</th>
                      <th className="py-1.5 text-right">Thành công</th>
                      <th className="py-1.5 text-right">Zalo trả lời</th>
                      <th className="py-1.5 text-right">Lượt bình luận</th>
                    </tr>
                  </thead>
                  <tbody>
                    {memberTableRows.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-4 text-center text-muted-foreground">
                          Chưa có hoạt động nào trong kỳ này
                        </td>
                      </tr>
                    ) : (
                      <>
                        {memberTableRows.map((m) => (
                          <tr key={m.member_id} className="border-t border-border/60">
                            <td className="py-1.5 flex items-center gap-2">
                              <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold shrink-0">
                                {getInitials(m.name || m.email || m.member_id)}
                              </span>
                              {m.name || m.email || m.member_id}
                            </td>
                            <td className="py-1.5 text-right text-emerald-600 font-bold">
                              {m.call_ok}/{m.call_ok + m.call_bad}
                            </td>
                            <td className="py-1.5 text-right">
                              {m.zaloReplied}/{m.zalo}
                            </td>
                            <td className="py-1.5 text-right">{m.seed}</td>
                          </tr>
                        ))}
                        <tr className="border-t border-border font-extrabold bg-muted/40">
                          <td className="py-1.5">Tổng</td>
                          <td className="py-1.5 text-right text-emerald-600">
                            {memberTableTotals.call_ok}/{memberTableTotals.call_ok + memberTableTotals.call_bad}
                          </td>
                          <td className="py-1.5 text-right">
                            {memberTableTotals.zaloReplied}/{memberTableTotals.zalo}
                          </td>
                          <td className="py-1.5 text-right">{memberTableTotals.seed}</td>
                        </tr>
                      </>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {activeTab === "day" && (
              <div className="overflow-x-auto">
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="text-[11px] text-muted-foreground font-bold text-left">
                      <th className="py-1.5">Ngày</th>
                      <th className="py-1.5 text-right">Thành công</th>
                      <th className="py-1.5 text-right">Zalo trả lời</th>
                      <th className="py-1.5 text-right">Lượt bình luận</th>
                    </tr>
                  </thead>
                  <tbody>
                    {isLoadingDay ? (
                      <tr>
                        <td colSpan={4} className="py-4 text-center text-muted-foreground">
                          Đang tải...
                        </td>
                      </tr>
                    ) : dayRows.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-4 text-center text-muted-foreground">
                          Chưa có hoạt động nào trong kỳ này
                        </td>
                      </tr>
                    ) : (
                      <>
                      {dayRows.map((d) => {
                        const isExpandable = d.total > 0;
                        const isExpanded = isExpandable && expandedDays.has(d.day);
                        return (
                          <React.Fragment key={d.day}>
                            <tr className="border-t border-border/60">
                              <td className="py-1.5">
                                <div className="flex items-center gap-1">
                                  {isExpandable ? (
                                    <button
                                      type="button"
                                      onClick={() => toggleDayExpanded(d.day)}
                                      aria-label={isExpanded ? "Thu gọn theo thành viên" : "Xem theo thành viên"}
                                      aria-expanded={isExpanded}
                                      className="flex items-center justify-center w-4 h-4 shrink-0 text-muted-foreground hover:text-foreground cursor-pointer"
                                    >
                                      <span
                                        className="material-symbols-outlined text-[16px] transition-transform duration-150"
                                        style={{ transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)" }}
                                      >
                                        chevron_right
                                      </span>
                                    </button>
                                  ) : (
                                    <span className="w-4 h-4 shrink-0" />
                                  )}
                                  {formatDay(d.day)}
                                </div>
                              </td>
                              <td className="py-1.5 text-right text-emerald-600 font-bold">
                                {d.call_ok}/{d.call_ok + d.call_bad}
                              </td>
                              <td className="py-1.5 text-right">
                                {d.zalo_replied}/{d.zalo_sent}
                              </td>
                              <td className="py-1.5 text-right">{d.seed}</td>
                            </tr>
                            {isExpanded && (
                              <tr className="bg-muted/30">
                                <td colSpan={4} className="p-0">
                                  <div className="pl-8 pr-3 py-2">
                                    <table className="w-full text-[12px]">
                                      <thead>
                                        <tr className="text-[10.5px] text-muted-foreground font-bold text-left">
                                          <th className="py-1">Thành viên</th>
                                          <th className="py-1 text-right">Lượt bình luận</th>
                                          <th className="py-1 text-right">Tổng</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {d.by_member.map((m: DayBreakdownMemberItem) => (
                                          <tr key={m.member_id} className="border-t border-border/40">
                                            <td className="py-1">
                                              <div className="flex items-center gap-1.5">
                                                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold shrink-0">
                                                  {getInitials(m.member_name)}
                                                </span>
                                                {m.member_name}
                                              </div>
                                            </td>
                                            <td className="py-1 text-right">{m.seed}</td>
                                            <td className="py-1 text-right font-bold">{m.total}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                      <tr className="border-t border-border font-extrabold bg-muted/40">
                        <td className="py-1.5">Tổng {dayRows.length} ngày</td>
                        <td className="py-1.5 text-right text-emerald-600">
                          {dayTableTotals.call_ok}/{dayTableTotals.call_ok + dayTableTotals.call_bad}
                        </td>
                        <td className="py-1.5 text-right">
                          {dayTableTotals.zalo_replied}/{dayTableTotals.zalo_sent}
                        </td>
                        <td className="py-1.5 text-right">{dayTableTotals.seed}</td>
                      </tr>
                      </>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {activeTab === "log" && (
              <div>
                <div className="flex flex-wrap gap-1.5 mb-3">
                  <button
                    type="button"
                    onClick={() => setLogActionFilter(null)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border h-7 px-3 text-[12px] font-semibold transition cursor-pointer",
                      !logActionFilter ? "border-primary bg-primary/10 text-primary" : "border-border bg-card hover:bg-muted"
                    )}
                  >
                    Tất cả
                    <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-muted grid place-items-center text-[10px] font-bold">
                      {logCounts.all}
                    </span>
                  </button>
                  {(Object.keys(ACTION_META) as ActivityLogActionType[]).map((key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setLogActionFilter(logActionFilter === key ? null : key)}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border h-7 px-3 text-[12px] font-semibold transition cursor-pointer",
                        logActionFilter === key ? "border-primary bg-primary/10 text-primary" : "border-border bg-card hover:bg-muted"
                      )}
                    >
                      <span className={cn("w-1.5 h-1.5 rounded-full", ACTION_META[key].dot)} />
                      {ACTION_META[key].label}
                      <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-muted grid place-items-center text-[10px] font-bold">
                        {logCounts[key]}
                      </span>
                    </button>
                  ))}
                </div>

                <div className="overflow-x-auto max-h-[320px] overflow-y-auto">
                  <table className="w-full text-[12.5px]">
                    <thead>
                      <tr className="text-[11px] text-muted-foreground font-bold text-left sticky top-0 bg-card">
                        <th className="py-1.5">Thời gian</th>
                        <th className="py-1.5">Người thực hiện</th>
                        <th className="py-1.5">Hành động</th>
                        <th className="py-1.5">Bài viết / khách</th>
                        <th className="py-1.5">Kết quả</th>
                      </tr>
                    </thead>
                    <tbody>
                      {isLoadingLog ? (
                        <tr>
                          <td colSpan={5} className="py-4 text-center text-muted-foreground">
                            Đang tải...
                          </td>
                        </tr>
                      ) : logItems.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-4 text-center text-muted-foreground">
                            Chưa có hoạt động nào trong kỳ này
                          </td>
                        </tr>
                      ) : (
                        logItems.map((item, idx) => (
                          <tr key={`${item.ts}-${idx}`} className="border-t border-border/60">
                            <td className="py-1.5 whitespace-nowrap">{new Date(item.ts).toLocaleString("vi-VN")}</td>
                            <td className="py-1.5 whitespace-nowrap">{item.member_name || "—"}</td>
                            <td className="py-1.5 whitespace-nowrap">
                              <span
                                className={cn(
                                  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold",
                                  ACTION_META[item.action_type].badge
                                )}
                              >
                                {ACTION_META[item.action_type].label}
                              </span>
                            </td>
                            <td className="py-1.5 max-w-[220px] truncate" title={item.post_label || undefined}>
                              {item.post_label || "—"}
                            </td>
                            <td className="py-1.5">
                              <span className="inline-flex items-center gap-1">
                                {item.result_label}
                                {/* Việc 4: note chỉ có ở action_type="call" (ghi chú của LẦN
                                    GỌI GẦN NHẤT — post_call_results không lưu lịch sử từng
                                    lần) — hover icon để xem, không tự chế note cho dòng khác. */}
                                {item.action_type === "call" && item.note ? (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className="cursor-default opacity-80 hover:opacity-100 text-[12px]">🗒️</span>
                                    </TooltipTrigger>
                                    <TooltipContent side="top">
                                      <span className="font-medium text-xs max-w-[240px] inline-block whitespace-pre-wrap">
                                        {item.note}
                                      </span>
                                    </TooltipContent>
                                  </Tooltip>
                                ) : null}
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {logTotal > 0 && (
                  <div className="flex items-center justify-between gap-2 pt-3 text-[12px] text-muted-foreground flex-wrap">
                    <span>
                      Trang {logPage}/{logTotalPages} · {logTotal} hoạt động
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={logPage <= 1}
                        onClick={() => setLogPage((p) => Math.max(1, p - 1))}
                        className="h-7 px-2.5 rounded-md border border-border text-[12px] font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-muted cursor-pointer"
                      >
                        Trước
                      </button>
                      <button
                        type="button"
                        disabled={logPage >= logTotalPages}
                        onClick={() => setLogPage((p) => Math.min(logTotalPages, p + 1))}
                        className="h-7 px-2.5 rounded-md border border-border text-[12px] font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-muted cursor-pointer"
                      >
                        Sau
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <p className="px-4 pb-4 text-[11px] text-muted-foreground">
            <b>Thành công</b> = nói chuyện được với khách (Có nhu cầu, Đang tư vấn, Hẹn gọi lại, Chờ phản hồi).{" "}
            <b>Thất bại</b> = Không nghe máy, Từ chối, Không có nhu cầu, Không phù hợp.
          </p>
        </div>
      )}
    </div>
  );
}
