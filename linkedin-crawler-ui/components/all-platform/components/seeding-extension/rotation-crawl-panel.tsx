"use client";

/**
 * Nhiều lịch cào xoay vòng độc lập (Facebook → LinkedIn → Threads → lặp lại), đặt ở tab
 * "Lịch cào xoay vòng" trong trang "Lịch cào & Hàng đợi".
 * 
 * PHÂN QUYỀN RBAC & DANH TÍNH NGƯỜI TẠO:
 * - Admin / Superadmin: Thấy full lịch cào của mọi người + tài khoản hệ thống (VPS crawler).
 * - Leader: Thấy lịch cào của các thành viên trong team + của chính mình.
 * - Member: Chỉ thấy các lịch cào do chính mình tạo.
 * - Mỗi lịch cào hiển thị rõ Tên người tạo, Email, Avatar, và Badge phân loại (Bạn, Hệ thống, Leader, Thành viên).
 */

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { useAppAuth } from "@/contexts/AppAuthContext";
import {
  allPlatformGroupsService,
  allPlatformRotationSchedulesService,
  BackendRotationSchedule,
} from "@/services/all-platform.service";
import {
  ROTATE_CRAWL_EXTENSION_VERSION,
  useRotationSchedules,
  useSeedingExtensionStatus,
  type RotationGroupInput,
  type RotationSchedule,
} from "./use-seeding-extension";

interface GroupOption {
  id: string;
  group_name?: string;
  group_url: string;
}

const KEYWORDS_STORAGE_KEY = "markee.rotationCrawl.keywords";
const INTERVAL_STORAGE_KEY = "markee.rotationCrawl.intervalHours";

const EST_SECONDS_PER_FB_GROUP = 60;
const EST_SECONDS_PER_LI_GROUP = 120;
const EST_SECONDS_PER_TH_KEYWORD = 40;
const MAX_AUTO_THREADS_KEYWORDS = 50;
const MIN_INTERVAL_SAFETY_FACTOR = 1.2;

function estimateRoundSeconds(fbCount: number, liCount: number, thCount: number): number {
  return fbCount * EST_SECONDS_PER_FB_GROUP + liCount * EST_SECONDS_PER_LI_GROUP + thCount * EST_SECONDS_PER_TH_KEYWORD;
}

function minIntervalHoursForSeconds(seconds: number): number {
  const hours = (seconds * MIN_INTERVAL_SAFETY_FACTOR) / 3600;
  return Math.max(0.25, Math.ceil(hours * 4) / 4);
}

function formatDuration(seconds: number): string {
  if (seconds <= 0) return "0 phút";
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h === 0) return `${m} phút`;
  if (m === 0) return `${h} giờ`;
  return `${h} giờ ${m} phút`;
}

const LOG_COLOR: Record<string, string> = {
  success: "text-emerald-300",
  error: "text-red-300",
  warn: "text-amber-300",
  info: "text-slate-200",
};

function parseKeywords(input: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of input.split(/[,\n]/g).map((s) => s.trim()).filter(Boolean)) {
    if (seen.has(k.toLowerCase())) continue;
    seen.add(k.toLowerCase());
    out.push(k);
  }
  return out;
}

function scheduleStatusMeta(s: RotationSchedule): { label: string; color: string } {
  if (s.status === "running") {
    const stageLabel = s.currentStage === "facebook" ? "Đang cào Facebook" : s.currentStage === "linkedin" ? "Đang cào LinkedIn" : s.currentStage === "threads" ? "Đang tìm Threads" : "Đang chạy";
    const countSuffix = s.progress && s.progress.totalGroups > 0 ? ` (${s.progress.groupIndex}/${s.progress.totalGroups})` : "...";
    return { label: `${stageLabel}${countSuffix}`, color: "bg-blue-50 text-blue-700 border-blue-200" };
  }
  if (s.status === "waiting_online") return { label: "Tạm dừng — tab Seeding đã đóng", color: "bg-red-50 text-red-600 border-red-200" };
  if (s.status === "waiting_interval") return { label: "Đang chờ vòng kế tiếp", color: "bg-amber-50 text-amber-700 border-amber-200" };
  if (s.status === "done") return { label: "Đã hoàn tất (không lặp lại)", color: "bg-slate-50 text-slate-600 border-slate-200" };
  return { label: "Đã dừng", color: "bg-slate-50 text-slate-600 border-slate-200" };
}

function platformsSummary(s: RotationSchedule): string {
  const parts: string[] = [];
  if (s.cfg?.fbGroups?.length) parts.push(`Facebook: ${s.cfg.fbGroups.length} nhóm`);
  if (s.cfg?.liGroups?.length) parts.push(`LinkedIn: ${s.cfg.liGroups.length} nhóm`);
  if (s.cfg?.threadsKeywords?.length) parts.push(`Threads: ${s.cfg.threadsKeywords.length} từ khoá`);
  return parts.join(" · ");
}

function useGroupOptions(platform: "facebook" | "linkedin") {
  const [groups, setGroups] = useState<GroupOption[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    allPlatformGroupsService
      .getForExtension(platform)
      .then((res) => {
        if (cancelled) return;
        if (res.success === false) {
          setError(res.message || "Không tải được danh sách nhóm.");
          return;
        }
        const list = ((res.data as GroupOption[] | undefined) || []).filter((g) => g && g.id && g.group_url);
        setGroups(list);
        setSelectedIds(list.map((g) => g.id));
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Không tải được danh sách nhóm."))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [platform]);

  const toggle = (id: string) => setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return { groups, selectedIds, setSelectedIds, toggle, loading, error };
}

export function isSystemCrawlerUser(_user?: { email?: string | null; role?: string | null } | null | undefined): boolean {
  return true;
}

export function RotationCrawlPanel() {
  const { user } = useAppAuth();
  const isAdmin = user?.role === "admin";
  const isLeader = user?.role === "leader";
  const { status, version, isReady, features } = useSeedingExtensionStatus();
  const rot = useRotationSchedules();
  const [showAddModal, setShowAddModal] = useState(false);

  // Central Backend Schedules state (Filtered by RBAC from server)
  const [backendSchedules, setBackendSchedules] = useState<RotationSchedule[]>([]);
  const [isLoadingBackend, setIsLoadingBackend] = useState(true);
  const [filterOwner, setFilterOwner] = useState<"all" | "mine" | "system" | "team">("all");
  const [searchQuery, setSearchQuery] = useState("");

  const needsUpdate = isReady && (!features.includes("rotate_crawl") || (!!version && parseFloat(version) < 2.13));
  const canAdd = isReady && !needsUpdate;

  // Load schedules from backend database
  const loadBackendSchedules = useCallback(async () => {
    setIsLoadingBackend(true);
    try {
      const res = await allPlatformRotationSchedulesService.getSchedules();
      if (res && res.success && Array.isArray(res.data)) {
        setBackendSchedules(res.data as unknown as RotationSchedule[]);
      }
    } catch {
      // Backend error fallback
    } finally {
      setIsLoadingBackend(false);
    }
  }, []);

  useEffect(() => {
    loadBackendSchedules();
  }, [loadBackendSchedules]);

  // Auto-sync: If local extension has schedules, sync them to backend so other team members / leaders / admins see them
  const syncAttemptedRef = useRef(false);
  useEffect(() => {
    if (!rot.loaded || rot.schedules.length === 0 || syncAttemptedRef.current) return;
    syncAttemptedRef.current = true;
    allPlatformRotationSchedulesService
      .syncSchedules(rot.schedules)
      .then(() => loadBackendSchedules())
      .catch(() => {});
  }, [rot.loaded, rot.schedules, loadBackendSchedules]);

  // Merge backend schedules with extension realtime live status
  const mergedSchedules = useMemo(() => {
    const map = new Map<string, RotationSchedule>();

    // 1. Put all backend schedules first (RBAC enforced by server)
    for (const bs of backendSchedules) {
      map.set(bs.id, { ...bs });
    }

    // 2. Overlay live running/progress state from extension if present
    for (const es of rot.schedules) {
      if (map.has(es.id)) {
        const existing = map.get(es.id)!;
        map.set(es.id, {
          ...existing,
          status: es.status,
          currentStage: es.currentStage,
          roundNumber: es.roundNumber || existing.roundNumber,
          nextRunAt: es.nextRunAt ?? existing.nextRunAt,
          progress: es.progress,
          lastRoundSummary: es.lastRoundSummary || existing.lastRoundSummary,
        });
      } else {
        // If extension has a local schedule not yet in backend list, add it
        map.set(es.id, es);
      }
    }

    return Array.from(map.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }, [backendSchedules, rot.schedules]);

  // Helper: check if schedule belongs to current user
  const isMySchedule = useCallback(
    (s: RotationSchedule) => {
      if (!user) return false;
      const ownerId = s.creator?.user_id || s.cfg?.idMember;
      const ownerEmail = s.creator?.email || s.cfg?.email;
      if (user.id && ownerId && String(user.id) === String(ownerId)) return true;
      if (user.email && ownerEmail && user.email.toLowerCase() === ownerEmail.toLowerCase()) return true;
      return false;
    },
    [user]
  );

  // Filtered schedules for display
  const displayedSchedules = useMemo(() => {
    return mergedSchedules.filter((s) => {
      const isMine = isMySchedule(s);
      const isSys = s.creator?.is_system || s.creator?.role === "system" || s.cfg?.email === "seeding.crawler@markeeai.com";

      if (filterOwner === "mine" && !isMine) return false;
      if (filterOwner === "system" && !isSys) return false;
      if (filterOwner === "team" && (isMine || isSys)) return false;

      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase().trim();
      const creatorName = (s.creator?.name || "").toLowerCase();
      const creatorEmail = (s.creator?.email || s.cfg?.email || "").toLowerCase();
      const label = (s.label || "").toLowerCase();

      return label.includes(q) || creatorName.includes(q) || creatorEmail.includes(q);
    });
  }, [mergedSchedules, filterOwner, searchQuery, isMySchedule]);

  // Handle Toggle Schedule
  const handleToggle = async (id: string, enabled: boolean) => {
    // 1. Update UI immediately
    setBackendSchedules((prev) =>
      prev.map((s) => (s.id === id ? { ...s, enabled } : s))
    );
    // 2. Call extension
    rot.toggleSchedule(id, enabled);
    // 3. Call backend
    try {
      await allPlatformRotationSchedulesService.toggleSchedule(id, enabled);
    } catch {}
  };

  // Handle Stop Schedule
  const handleStop = (id: string) => {
    rot.stopSchedule(id);
  };

  // Handle Delete Schedule
  const handleDelete = async (id: string) => {
    // 1. Update UI immediately
    setBackendSchedules((prev) => prev.filter((s) => s.id !== id));
    // 2. Call extension
    rot.deleteSchedule(id);
    // 3. Call backend
    try {
      await allPlatformRotationSchedulesService.deleteSchedule(id);
    } catch {}
  };

  // KPI stats
  const totalCount = mergedSchedules.length;
  const myCount = mergedSchedules.filter((s) => isMySchedule(s)).length;
  const sysCount = mergedSchedules.filter(
    (s) => s.creator?.is_system || s.creator?.role === "system" || s.cfg?.email === "seeding.crawler@markeeai.com"
  ).length;

  return (
    <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden w-full">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-4 bg-muted/40">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 border border-primary/20">
            <span className="material-symbols-outlined text-primary text-[22px]">autorenew</span>
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-foreground text-sm leading-tight">
                Lịch cào xoay vòng (Facebook → LinkedIn → Threads)
              </h3>
              {isAdmin && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-[var(--color-markee-primary)] border border-rose-200">
                  Admin: Xem toàn bộ
                </span>
              )}
              {isLeader && !isAdmin && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700 border border-blue-200">
                  Leader: Xem nhóm
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground leading-tight mt-0.5">
              Hỗ trợ mọi thành viên & leader thiết lập lịch cào độc lập theo luồng tài khoản riêng trên trình duyệt. Bài viết đổ thẳng về tab &quot;Hoạt động seeding&quot;.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowAddModal(true)}
          disabled={!canAdd}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-white text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed shrink-0 cursor-pointer shadow-sm transition hover:opacity-95"
        >
          <span className="material-symbols-outlined text-[18px]">add_circle</span>
          Thêm lịch cào
        </button>
      </div>

      {/* Safety Notice */}
      <div className="mx-4 mt-3 rounded-xl border border-sky-200 bg-sky-50/90 p-3.5 text-xs text-sky-900 leading-relaxed flex items-start gap-2.5 shadow-2xs">
        <span className="material-symbols-outlined text-sky-600 text-[20px] shrink-0">verified_user</span>
        <div>
          <p className="font-bold text-sky-950">Chế độ Quản Lý Lịch Cào Xoay Vòng An Toàn</p>
          <p className="mt-0.5 text-sky-800">
            Leader và thành viên có thể tự do bấm <b>&quot;Thêm lịch cào&quot;</b> để thiết lập lịch cào các nhóm mục tiêu với thông số giãn cách cá nhân hóa an toàn (độ trễ, nghỉ giữa các nhóm, tự ngắt khi gặp bài cũ). Hệ thống tự động điều phối cào theo chu kỳ, bảo vệ an toàn tuyệt đối cho tài khoản.
          </p>
        </div>
      </div>

      {/* Extension Connection Notice */}
      {status !== "ready" ? (
        <div className="mx-4 mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 leading-relaxed">
          Chưa kết nối được Markee Seeding Extension trên trình duyệt này — cài/khởi động lại extension rồi F5 lại trang để điều khiển cào tự động.
        </div>
      ) : needsUpdate ? (
        <div className="mx-4 mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 leading-relaxed">
          Extension đang cài chưa có chức năng lịch cào (nhiều lịch). Tải bản {ROTATE_CRAWL_EXTENSION_VERSION}+, giải nén đè lên thư mục
          cũ, vào chrome://extensions bấm reload trên Markee Seeding Extension rồi F5 lại trang này.
        </div>
      ) : null}

      {/* Role-based Filter Tabs & Search Bar */}
      <div className="mx-4 mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-border/60 pb-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setFilterOwner("all")}
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer",
              filterOwner === "all" ? "bg-slate-900 text-white shadow-xs" : "bg-muted/60 text-muted-foreground hover:bg-muted"
            )}
          >
            {isAdmin ? `Tất cả lịch cào (${totalCount})` : isLeader ? `Toàn bộ nhóm (${totalCount})` : `Lịch của bạn (${totalCount})`}
          </button>

          {(isAdmin || isLeader) && (
            <button
              type="button"
              onClick={() => setFilterOwner("mine")}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer",
                filterOwner === "mine" ? "bg-[var(--color-markee-primary)] text-white shadow-xs" : "bg-muted/60 text-muted-foreground hover:bg-muted"
              )}
            >
              Của tôi ({myCount})
            </button>
          )}

          {isAdmin && (
            <button
              type="button"
              onClick={() => setFilterOwner("system")}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer",
                filterOwner === "system" ? "bg-purple-600 text-white shadow-xs" : "bg-muted/60 text-muted-foreground hover:bg-muted"
              )}
            >
              Hệ thống VPS ({sysCount})
            </button>
          )}

          {(isAdmin || isLeader) && (
            <button
              type="button"
              onClick={() => setFilterOwner("team")}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer",
                filterOwner === "team" ? "bg-blue-600 text-white shadow-xs" : "bg-muted/60 text-muted-foreground hover:bg-muted"
              )}
            >
              {isAdmin ? `Thành viên khác (${Math.max(0, totalCount - myCount - sysCount)})` : `Thành viên trong team (${Math.max(0, totalCount - myCount)})`}
            </button>
          )}
        </div>

        <div className="relative min-w-[240px]">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Tìm theo tên lịch, người tạo..."
            className="w-full rounded-xl border border-border bg-background py-1.5 pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
          />
          <span className="material-symbols-outlined pointer-events-none absolute left-2 top-2 text-sm text-muted-foreground">
            search
          </span>
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-2 top-2 text-xs text-muted-foreground hover:text-foreground"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Schedules List */}
      <div className="p-4 flex flex-col gap-3">
        {isLoadingBackend && mergedSchedules.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <p className="mt-2 text-xs text-muted-foreground">Đang tải danh sách lịch cào...</p>
          </div>
        ) : displayedSchedules.length === 0 ? (
          <div className="text-center py-10 text-sm text-muted-foreground border border-dashed border-border rounded-xl">
            {searchQuery
              ? "Không có lịch cào nào khớp với tìm kiếm."
              : filterOwner === "mine"
              ? "Bạn chưa tạo lịch cào nào. Bấm 'Thêm lịch cào' để tạo lịch đầu tiên."
              : "Chưa có lịch cào nào trong phạm vi này."}
          </div>
        ) : (
          displayedSchedules.map((s) => (
            <ScheduleCard
              key={s.id}
              schedule={s}
              currentUser={user}
              onToggle={handleToggle}
              onStop={handleStop}
              onDelete={handleDelete}
            />
          ))
        )}

        {/* Realtime Extension Logs */}
        {rot.logs.length > 0 ? (
          <div className="bg-slate-900 rounded-xl p-3 font-mono text-[11px] max-h-[220px] overflow-y-auto mt-1">
            {rot.logs.slice(-80).map((line, i) => (
              <div key={`${line.at}-${i}`} className={LOG_COLOR[line.level] || LOG_COLOR.info}>
                {line.message}
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {/* Add Schedule Modal */}
      {showAddModal ? (
        <AddScheduleModal
          onClose={() => setShowAddModal(false)}
          onCreated={() => loadBackendSchedules()}
          addSchedule={rot.addSchedule}
        />
      ) : null}
    </div>
  );
}

function ScheduleCard({
  schedule,
  currentUser,
  onToggle,
  onStop,
  onDelete,
}: {
  schedule: RotationSchedule;
  currentUser: any;
  onToggle: (id: string, enabled: boolean) => void;
  onStop: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const meta = scheduleStatusMeta(schedule);
  const nextRunText = schedule.nextRunAt ? new Date(schedule.nextRunAt).toLocaleString("vi-VN") : null;
  const isActive = schedule.status === "running" || schedule.status === "waiting_interval" || schedule.status === "waiting_online";

  // Creator identity attributes
  const creator = schedule.creator;
  const creatorEmail = creator?.email || schedule.cfg?.email || "";
  const creatorName = creator?.name || (creatorEmail ? creatorEmail.split("@")[0] : "Thành viên");
  const creatorRole = creator?.role || "member";
  const creatorAvatar = creator?.avatar;
  const isSystem = Boolean(creator?.is_system || creatorRole === "system" || creatorEmail === "seeding.crawler@markeeai.com");

  const isSelf = Boolean(
    currentUser &&
      ((currentUser.id && creator?.user_id && String(currentUser.id) === String(creator.user_id)) ||
        (currentUser.email && creatorEmail && currentUser.email.toLowerCase() === creatorEmail.toLowerCase()))
  );

  const handleDelete = () => {
    if (!window.confirm(`Xoá lịch cào "${schedule.label}"? Nếu đang chạy sẽ dừng ngay.`)) return;
    onDelete(schedule.id);
  };

  return (
    <div className="border border-border rounded-xl p-3.5 flex flex-col gap-2.5 bg-card hover:border-slate-300 transition">
      {/* ── CREATOR IDENTITY BANNER (MANDATORY FROM MASTER) ── */}
      <div className="flex items-center justify-between pb-2.5 border-b border-border/70 flex-wrap gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={cn(
              "w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 uppercase",
              isSystem
                ? "bg-purple-100 text-purple-700 font-black"
                : isSelf
                ? "bg-rose-100 text-[var(--color-markee-primary)]"
                : "bg-slate-100 text-slate-700"
            )}
          >
            {creatorAvatar ? (
              <img src={creatorAvatar} alt={creatorName} className="w-7 h-7 rounded-full object-cover" />
            ) : isSystem ? (
              <span className="material-symbols-outlined text-sm">dns</span>
            ) : (
              creatorName.charAt(0)
            )}
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-bold text-xs text-foreground truncate">{creatorName}</span>
              {isSelf && (
                <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-rose-100 text-[var(--color-markee-primary)]">
                  Bạn
                </span>
              )}
              {isSystem && (
                <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-purple-100 text-purple-700">
                  Hệ thống [VPS]
                </span>
              )}
              {!isSystem && !isSelf && (
                <span className="px-1.5 py-0.2 rounded text-[10px] font-medium bg-slate-100 text-slate-600">
                  {creatorRole === "leader" ? "Leader" : "Thành viên"}
                </span>
              )}
            </div>
            {creatorEmail && (
              <span className="text-[10px] text-muted-foreground truncate block leading-tight">
                {creatorEmail}
              </span>
            )}
          </div>
        </div>

        {schedule.createdAt && (
          <span className="text-[10px] text-muted-foreground shrink-0 whitespace-nowrap">
            Tạo lúc:{" "}
            {new Date(schedule.createdAt).toLocaleDateString("vi-VN", {
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        )}
      </div>

      {/* ── SCHEDULE DETAILS & ACTIONS ── */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-sm text-foreground truncate">{schedule.label}</span>
            <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border shrink-0", meta.color)}>
              {schedule.status === "running" ? <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" /> : null}
              {meta.label}
            </span>
          </div>

          <div className="text-[11px] text-muted-foreground mt-1">{platformsSummary(schedule) || "—"}</div>

          <div className="text-[11px] text-muted-foreground mt-0.5 flex flex-wrap gap-x-3">
            <span>Lặp lại: {schedule.cfg?.repeatEnabled ? `mỗi ${schedule.cfg.intervalHours} giờ` : "chỉ 1 lần"}</span>
            <span>Vòng: {schedule.roundNumber || 0}</span>
            {nextRunText && schedule.status === "waiting_interval" ? <span>Vòng kế tiếp: {nextRunText}</span> : null}
            {schedule.lastRoundSummary ? (
              <span className="font-semibold text-emerald-600">Lần gần nhất: +{schedule.lastRoundSummary.totalSaved} bài</span>
            ) : null}
          </div>

          {schedule.status === "running" && schedule.progress ? <LiveProgress progress={schedule.progress} /> : null}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <label className="inline-flex items-center cursor-pointer" title={schedule.enabled ? "Đang bật" : "Đang tắt"}>
            <input
              type="checkbox"
              checked={schedule.enabled}
              onChange={(e) => onToggle(schedule.id, e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-9 h-5 rounded-full bg-muted peer-checked:bg-primary transition-colors relative">
              <div className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" />
            </div>
          </label>

          {isActive ? (
            <button
              type="button"
              onClick={() => onStop(schedule.id)}
              className="p-1.5 rounded-lg hover:bg-red-50 text-red-500"
              title="Dừng lịch này"
            >
              <span className="material-symbols-outlined text-[16px]">stop_circle</span>
            </button>
          ) : null}

          <button
            type="button"
            onClick={handleDelete}
            className="p-1.5 rounded-lg hover:bg-red-50 text-muted-foreground hover:text-red-600 transition"
            title="Xoá lịch"
          >
            <span className="material-symbols-outlined text-[16px]">delete</span>
          </button>
        </div>
      </div>
    </div>
  );
}

const STAGE_UNIT: Record<string, string> = { facebook: "nhóm", linkedin: "nhóm", threads: "từ khoá" };
const STAGE_LABEL: Record<string, string> = { facebook: "Facebook", linkedin: "LinkedIn", threads: "Threads" };

function LiveProgress({ progress }: { progress: NonNullable<RotationSchedule["progress"]> }) {
  const unit = (progress.stage && STAGE_UNIT[progress.stage]) || "mục";
  const stageLabel = (progress.stage && STAGE_LABEL[progress.stage]) || "";
  const pct = progress.totalGroups > 0 ? Math.min(100, Math.round((progress.groupIndex / progress.totalGroups) * 100)) : 0;

  return (
    <div className="mt-2 rounded-lg bg-blue-50/60 border border-blue-100 px-2.5 py-2">
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="font-semibold text-blue-700">
          {stageLabel}: {progress.groupIndex}/{progress.totalGroups} {unit}
        </span>
        <span className="font-bold text-emerald-600">+{progress.savedSoFar} bài</span>
      </div>
      {progress.totalGroups > 0 ? (
        <div className="mt-1 h-1.5 w-full rounded-full bg-blue-100 overflow-hidden">
          <div className="h-full rounded-full bg-blue-500 transition-all duration-500" style={{ width: `${pct}%` }} />
        </div>
      ) : null}
    </div>
  );
}

const INTERVAL_PRESETS = [
  { label: "15 phút", hours: 0.25 },
  { label: "30 phút", hours: 0.5 },
  { label: "1 giờ", hours: 1 },
  { label: "2 giờ", hours: 2 },
  { label: "4 giờ", hours: 4 },
  { label: "6 giờ", hours: 6 },
];

function AddScheduleModal({
  onClose,
  onCreated,
  addSchedule,
}: {
  onClose: () => void;
  onCreated?: () => void;
  addSchedule: (label: string, fbGroups: RotationGroupInput[], liGroups: RotationGroupInput[], threadsKeywords: string[], config: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>;
}) {
  const { user } = useAppAuth();
  const fb = useGroupOptions("facebook");
  const li = useGroupOptions("linkedin");

  const [label, setLabel] = useState("");
  const [enabledPlatforms, setEnabledPlatforms] = useState<Set<"facebook" | "linkedin" | "threads">>(() => new Set(["facebook", "linkedin", "threads"]));
  const [repeatEnabled, setRepeatEnabled] = useState(true);
  const [intervalHours, setIntervalHours] = useState<number>(2);
  const [intervalInput, setIntervalInput] = useState<string>("2");
  const [keywordsInput, setKeywordsInput] = useState<string>("");
  const [threadsAutoDiscover, setThreadsAutoDiscover] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const keywords = useMemo(() => parseKeywords(keywordsInput), [keywordsInput]);

  const togglePlatform = (p: "facebook" | "linkedin" | "threads") => {
    setEnabledPlatforms((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  };

  const totalSelected =
    (enabledPlatforms.has("facebook") ? fb.selectedIds.length : 0) +
    (enabledPlatforms.has("linkedin") ? li.selectedIds.length : 0) +
    (enabledPlatforms.has("threads") ? (keywords.length > 0 ? keywords.length : threadsAutoDiscover ? 1 : 0) : 0);

  const estSeconds = useMemo(() => {
    const fbCount = enabledPlatforms.has("facebook") ? fb.selectedIds.length : 0;
    const liCount = enabledPlatforms.has("linkedin") ? li.selectedIds.length : 0;
    const thCount = enabledPlatforms.has("threads") ? (keywords.length > 0 ? keywords.length : threadsAutoDiscover ? MAX_AUTO_THREADS_KEYWORDS : 0) : 0;
    return estimateRoundSeconds(fbCount, liCount, thCount);
  }, [enabledPlatforms, fb.selectedIds.length, li.selectedIds.length, keywords.length, threadsAutoDiscover]);

  const minIntervalHours = useMemo(() => minIntervalHoursForSeconds(estSeconds), [estSeconds]);

  useEffect(() => {
    if (intervalHours < minIntervalHours) {
      setIntervalHours(minIntervalHours);
      setIntervalInput(String(minIntervalHours));
    }
  }, [minIntervalHours, intervalHours]);

  const canSubmit = totalSelected > 0 && !!user?.id && !!user?.email && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit || !user?.id || !user?.email) return;
    setSubmitting(true);
    setError(null);
    try {
      window.localStorage.setItem(KEYWORDS_STORAGE_KEY, keywordsInput);
      window.localStorage.setItem(INTERVAL_STORAGE_KEY, intervalInput);
    } catch {}

    const fbGroups: RotationGroupInput[] = enabledPlatforms.has("facebook")
      ? fb.groups.filter((g) => fb.selectedIds.includes(g.id)).map((g) => ({ id: g.id, name: g.group_name || g.group_url, url: g.group_url }))
      : [];
    const liGroups: RotationGroupInput[] = enabledPlatforms.has("linkedin")
      ? li.groups.filter((g) => li.selectedIds.includes(g.id)).map((g) => ({ id: g.id, name: g.group_name || g.group_url, url: g.group_url }))
      : [];
    const threadsKeywords = enabledPlatforms.has("threads") ? keywords : [];

    const schedulePayload = {
      label: label.trim() || "Lịch cào xoay vòng",
      fbGroups,
      liGroups,
      threadsKeywords,
      config: {
        email: user.email,
        idMember: user.id,
        intervalHours,
        repeatEnabled,
        threadsAutoDiscover,
      },
    };

    // 1. Post to Extension
    const res = await addSchedule(schedulePayload.label, fbGroups, liGroups, threadsKeywords, schedulePayload.config);

    // 2. Persist to Backend Supabase (RBAC + Creator Identity)
    try {
      const scheduleId = `sch_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      await allPlatformRotationSchedulesService.saveSchedule({
        id: scheduleId,
        label: schedulePayload.label,
        cfg: {
          ...schedulePayload.config,
          fbGroups,
          liGroups,
          threadsKeywords,
        },
        enabled: true,
        status: "waiting_interval",
        roundNumber: 0,
        createdAt: Date.now(),
        creator: {
          user_id: user.id,
          name: user.name || user.email,
          email: user.email,
          role: user.role,
        },
      });
    } catch {}

    setSubmitting(false);
    if (!res.success) {
      setError(res.error || "Không tạo được lịch cào.");
      return;
    }
    if (onCreated) onCreated();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-2xl border border-border shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-border sticky top-0 bg-card z-10">
          <h3 className="font-bold text-base text-foreground">Thêm lịch cào xoay vòng</h3>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted cursor-pointer">
            <span className="material-symbols-outlined text-[18px] text-muted-foreground">close</span>
          </button>
        </div>

        <div className="p-4 flex flex-col gap-4">
          <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 flex items-start gap-2.5">
            <span className="material-symbols-outlined text-sky-600 text-[20px] shrink-0">info</span>
            <div className="text-xs text-sky-900 leading-relaxed">
              Lịch cào sẽ được tạo với danh tính của bạn: <b>{user?.name || user?.email}</b>. Leader và Admin có thể theo dõi và giám sát hàng đợi theo phân quyền.
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-foreground">Tên / Nhãn lịch cào</label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="VD: Cào Bất động sản, Cào IT..."
              className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
            />
          </div>

          {/* Platforms toggle */}
          <div>
            <label className="text-xs font-bold text-foreground block mb-1.5">Nền tảng cào</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => togglePlatform("facebook")}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-bold border transition cursor-pointer flex items-center gap-1.5",
                  enabledPlatforms.has("facebook") ? "bg-blue-600 text-white border-blue-600" : "bg-muted/40 text-muted-foreground border-border"
                )}
              >
                <span>Facebook ({fb.selectedIds.length})</span>
              </button>
              <button
                type="button"
                onClick={() => togglePlatform("linkedin")}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-bold border transition cursor-pointer flex items-center gap-1.5",
                  enabledPlatforms.has("linkedin") ? "bg-sky-700 text-white border-sky-700" : "bg-muted/40 text-muted-foreground border-border"
                )}
              >
                <span>LinkedIn ({li.selectedIds.length})</span>
              </button>
              <button
                type="button"
                onClick={() => togglePlatform("threads")}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-bold border transition cursor-pointer flex items-center gap-1.5",
                  enabledPlatforms.has("threads") ? "bg-slate-900 text-white border-slate-900" : "bg-muted/40 text-muted-foreground border-border"
                )}
              >
                <span>Threads</span>
              </button>
            </div>
          </div>

          {/* Repeat interval */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-bold text-foreground">Chu kỳ lặp lại (giờ)</label>
              <span className="text-[11px] text-muted-foreground">Tối thiểu: {formatDuration(estSeconds)}</span>
            </div>
            <div className="flex gap-2 flex-wrap mb-2">
              {INTERVAL_PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => {
                    setIntervalHours(p.hours);
                    setIntervalInput(String(p.hours));
                  }}
                  className={cn(
                    "px-2.5 py-1 rounded-lg text-xs font-medium border transition cursor-pointer",
                    intervalHours === p.hours ? "bg-primary text-white border-primary" : "bg-muted/30 text-foreground border-border"
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="p-3 rounded-xl border border-red-200 bg-red-50 text-red-700 text-xs">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-border text-xs font-semibold text-foreground hover:bg-muted cursor-pointer"
            >
              Hủy
            </button>
            <button
              type="button"
              disabled={!canSubmit}
              onClick={handleSubmit}
              className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl bg-primary text-white text-xs font-bold disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer shadow-sm"
            >
              {submitting && <div className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />}
              <span>Tạo lịch cào</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
