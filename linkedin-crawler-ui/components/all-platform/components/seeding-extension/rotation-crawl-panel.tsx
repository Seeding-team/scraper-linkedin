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
  allPlatformKeywordsService,
  BackendRotationSchedule,
  KeywordTopic,
  KeywordItem,
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
  if (s.cfg?.threadsKeywords?.length) {
    const topicCount = ((s.cfg as unknown) as Record<string, unknown>)?.threadsTopicNames ? (((s.cfg as unknown) as Record<string, unknown>).threadsTopicNames as string[]).length : 0;
    if (topicCount > 0) {
      parts.push(`Threads: ${topicCount} chủ đề (${s.cfg.threadsKeywords.length} từ khoá)`);
    } else {
      parts.push(`Threads: ${s.cfg.threadsKeywords.length} từ khoá`);
    }
  }
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
        setSelectedIds([]); // Mặc định không auto-select toàn bộ 129 nhóm, để người dùng tự chọn nhóm cần cào
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
  const [editingSchedule, setEditingSchedule] = useState<RotationSchedule | null>(null);

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

  // Can edit: Admin, Leader (cho cả team và thành viên), hoặc chính chủ tạo lịch
  const canEditSchedule = useCallback(
    (s: RotationSchedule) => {
      if (!user) return false;
      if (isAdmin || isLeader) return true;
      return isMySchedule(s);
    },
    [user, isAdmin, isLeader, isMySchedule]
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

  const handleRunNow = async (id: string) => {
    rot.runNow(id);
    try {
      await allPlatformRotationSchedulesService.toggleSchedule(id, true);
    } catch {}
    setBackendSchedules((prev) =>
      prev.map((s) => (s.id === id ? { ...s, enabled: true, status: "waiting_interval" } : s))
    );
  };

  const handleStopAll = async () => {
    rot.stopAll();
    const active = mergedSchedules.filter((s) => s.status === "running" || s.enabled);
    for (const s of active) {
      try {
        await allPlatformRotationSchedulesService.toggleSchedule(s.id, false);
      } catch {}
    }
    setBackendSchedules((prev) =>
      prev.map((s) => ({ ...s, enabled: false, status: "stopped", nextRunAt: null }))
    );
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

      {/* Schedules Table */}
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
          <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-2xs">
            <table className="w-full text-left text-xs text-foreground divide-y divide-border/60">
              <thead className="bg-muted/50 text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                <tr>
                  <th scope="col" className="px-3 py-3 w-10 text-center">#</th>
                  <th scope="col" className="px-3.5 py-3 min-w-[200px]">Lịch cào & Người tạo</th>
                  <th scope="col" className="px-3.5 py-3 min-w-[180px]">Nền tảng & Mục tiêu</th>
                  <th scope="col" className="px-3.5 py-3 min-w-[240px]">Thông số Extension Setup</th>
                  <th scope="col" className="px-3.5 py-3 min-w-[130px]">Chu kỳ & Vòng</th>
                  <th scope="col" className="px-3.5 py-3 min-w-[130px]">Trạng thái</th>
                  <th scope="col" className="px-3.5 py-3 w-32 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {displayedSchedules.map((s, idx) => (
                  <ScheduleTableRow
                    key={s.id}
                    index={idx + 1}
                    schedule={s}
                    currentUser={user}
                    canEdit={canEditSchedule(s)}
                    onToggle={handleToggle}
                    onStop={handleStop}
                    onDelete={handleDelete}
                    onEdit={() => setEditingSchedule(s)}
                        onRunNow={handleRunNow}
                  />
                ))}
              </tbody>
            </table>
          </div>
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
            runNow={rot.runNow}
        />
      ) : null}

      {/* Edit Schedule Modal */}
      {editingSchedule ? (
        <EditScheduleModal
          schedule={editingSchedule}
          onClose={() => setEditingSchedule(null)}
          onSaved={() => {
            setEditingSchedule(null);
            loadBackendSchedules();
          }}
          updateSchedule={rot.updateSchedule}
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


function ScheduleTableRow({
  index,
  schedule,
  currentUser,
  canEdit,
  onToggle,
  onStop,
  onDelete,
  onEdit,
  onRunNow,
}: {
  index: number;
  schedule: RotationSchedule;
  currentUser: any;
  canEdit: boolean;
  onToggle: (id: string, enabled: boolean) => void;
  onStop: (id: string) => void;
  onDelete: (id: string) => void;
  onEdit: () => void;
  onRunNow: (id: string) => void;
}) {
  const meta = scheduleStatusMeta(schedule);
  const nextRunText = schedule.nextRunAt ? new Date(schedule.nextRunAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }) : null;
  const isActive = schedule.status === "running" || schedule.status === "waiting_interval" || schedule.status === "waiting_online";

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

  const cfg = schedule.cfg || ({} as any);
  const scrollDistance = cfg.scrollDistance || 1600;
  const delayMin = (cfg.scrollDelayMinMs ? cfg.scrollDelayMinMs / 1000 : 1.5).toFixed(1);
  const delayMax = (cfg.scrollDelayMaxMs ? cfg.scrollDelayMaxMs / 1000 : 2.8).toFixed(1);
  const groupRest = cfg.groupRestSec || 45;
  const oldPostsLimit = cfg.oldPostsLimit || 15;
  const maxPostsPerGroup = cfg.maxPostsPerGroup || 30;
  const maxScrollTimeSec = cfg.maxScrollTimeSec || 90;

  const fbCount = cfg.fbGroups?.length || 0;
  const liCount = cfg.liGroups?.length || 0;
  const thCount = cfg.threadsKeywords?.length || 0;
  const thTopics = cfg.threadsTopicNames || [];

  return (
    <tr className={cn("transition-colors", schedule.status === "running" ? "bg-blue-50/50 hover:bg-blue-50/70 border-l-4 border-l-blue-600 shadow-sm" : "hover:bg-muted/30")}>
      <td className="px-3 py-3 text-center text-muted-foreground font-mono text-[11px]">{index}</td>
      
      {/* Cột 1: Lịch cào & Người tạo */}
      <td className="px-3.5 py-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-bold text-foreground text-xs">{schedule.label}</span>
            {isSelf && (
              <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-rose-100 text-[var(--color-markee-primary)]">
                Bạn
              </span>
            )}
            {isSystem && (
              <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-purple-100 text-purple-700">
                VPS
              </span>
            )}
            {!isSystem && !isSelf && (
              <span className="px-1.5 py-0.2 rounded text-[10px] font-medium bg-slate-100 text-slate-700">
                {creatorRole === "leader" ? "Leader" : "Member"}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <div className="w-4 h-4 rounded-full bg-muted flex items-center justify-center text-[9px] font-bold shrink-0 uppercase">
              {creatorAvatar ? (
                <img src={creatorAvatar} alt="" className="w-4 h-4 rounded-full object-cover" />
              ) : isSystem ? (
                <span className="material-symbols-outlined text-[11px]">dns</span>
              ) : (
                creatorName.charAt(0)
              )}
            </div>
            <span className="truncate max-w-[140px] font-medium text-foreground">{creatorName}</span>
            {creatorEmail && <span className="truncate max-w-[120px] opacity-75 hidden sm:inline">({creatorEmail.split("@")[0]})</span>}
          </div>
        </div>
      </td>

      {/* Cột 2: Nền tảng & Mục tiêu */}
      <td className="px-3.5 py-3">
        <div className="flex flex-col gap-1 text-[11px]">
          <div className="flex items-center gap-1 flex-wrap">
            {fbCount > 0 && (
              <span className="px-1.5 py-0.5 rounded-md bg-blue-50 text-blue-700 border border-blue-200 text-[10px] font-semibold">
                FB: {fbCount} nhóm
              </span>
            )}
            {liCount > 0 && (
              <span className="px-1.5 py-0.5 rounded-md bg-sky-50 text-sky-800 border border-sky-200 text-[10px] font-semibold">
                LI: {liCount} nhóm
              </span>
            )}
            {thCount > 0 && (
              <span className="px-1.5 py-0.5 rounded-md bg-slate-900 text-white text-[10px] font-semibold">
                Threads: {thCount} từ khoá
              </span>
            )}
            {fbCount === 0 && liCount === 0 && thCount === 0 && (
              <span className="text-muted-foreground">—</span>
            )}
          </div>
          {thTopics.length > 0 && (
            <div className="text-[10px] text-muted-foreground truncate max-w-[170px]" title={thTopics.join(", ")}>
              Chủ đề: {thTopics.join(", ")}
            </div>
          )}
        </div>
      </td>

      {/* Cột 3: Thông số Extension Setup */}
      <td className="px-3.5 py-3">
        <div className="flex flex-col gap-1 text-[11px]">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="px-1.5 py-0.5 rounded bg-muted/60 text-foreground font-mono text-[10px] border border-border" title="Cuộn mỗi nhịp">
              {scrollDistance}px
            </span>
            <span className="px-1.5 py-0.5 rounded bg-muted/60 text-foreground font-mono text-[10px] border border-border" title="Độ trễ cuộn">
              ⏱ {delayMin}-{delayMax}s
            </span>
            <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 font-mono text-[10px] border border-amber-200" title="Nghỉ giữa 2 nhóm">
              🛡 Nghỉ {groupRest}s
            </span>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap text-[10px] text-muted-foreground">
            <span>Cắt bài cũ: <b>{oldPostsLimit}</b></span>
            <span>•</span>
            <span>Tối đa: <b>{maxPostsPerGroup} bài/nhóm</b></span>
            <span>•</span>
            <span>Max {maxScrollTimeSec}s</span>
          </div>
        </div>
      </td>

      {/* Cột 4: Chu kỳ & Vòng */}
      <td className="px-3.5 py-3 text-[11px]">
        <div className="flex flex-col gap-0.5">
          <span className="font-semibold text-foreground">
            {cfg.repeatEnabled ? `Lặp mỗi ${cfg.intervalHours}h` : "Chỉ chạy 1 lần"}
          </span>
          <span className="text-[10px] text-muted-foreground">
            Đã chạy: <b>{schedule.roundNumber || 0} vòng</b>
          </span>
          {schedule.lastRoundSummary && (
            <span className="text-[10px] font-semibold text-emerald-600">
              +{schedule.lastRoundSummary.totalSaved} bài mới
            </span>
          )}
        </div>
      </td>

      {/* Cột 5: Trạng thái & Live Progress */}
      <td className="px-3.5 py-3">
        <div className="flex flex-col gap-1">
          <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border shrink-0 w-fit", meta.color)}>
            {schedule.status === "running" && <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />}
            {meta.label}
          </span>
          {nextRunText && schedule.status === "waiting_interval" && (
            <span className="text-[10px] text-muted-foreground">Chạy tiếp lúc {nextRunText}</span>
          )}
          {schedule.status === "running" && schedule.progress && (
            <div className="w-28 mt-0.5">
              <div className="h-1 bg-blue-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-600 transition-all duration-300"
                  style={{
                    width: `${schedule.progress.totalGroups > 0 ? (schedule.progress.groupIndex / schedule.progress.totalGroups) * 100 : 0}%`,
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </td>

      {/* Cột 6: Thao tác & Tùy chỉnh thông số */}
      <td className="px-3.5 py-3 text-right">
        <div className="flex items-center justify-end gap-1.5">
          {/* Nút Chạy Ngay */}
          <button
            type="button"
            onClick={() => onRunNow(schedule.id)}
            className="p-1 rounded-md hover:bg-emerald-50 text-emerald-600 transition cursor-pointer"
            title="Ưu tiên chạy ngay lịch cào này (tự động tạm dừng lịch khác nếu có)"
          >
            <span className="material-symbols-outlined text-[16px]">play_circle</span>
          </button>

          {/* Switch Bật/Tắt */}
          <label className="inline-flex items-center cursor-pointer" title={schedule.enabled ? "Đang bật" : "Đang tắt"}>
            <input
              type="checkbox"
              checked={schedule.enabled}
              onChange={(e) => onToggle(schedule.id, e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-8 h-4.5 rounded-full bg-muted peer-checked:bg-primary transition-colors relative">
              <div className="absolute top-0.5 left-0.5 w-3.5 h-3.5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-3.5" />
            </div>
          </label>

          {/* Nút Dừng */}
          {isActive && (
            <button
              type="button"
              onClick={() => onStop(schedule.id)}
              className="p-1 rounded-md hover:bg-red-50 text-red-500 cursor-pointer"
              title="Dừng lịch cào này"
            >
              <span className="material-symbols-outlined text-[16px]">stop_circle</span>
            </button>
          )}

          {/* Nút Sửa Thông Số */}
          {canEdit && (
            <button
              type="button"
              onClick={onEdit}
              className="p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-primary transition cursor-pointer"
              title="Tùy chỉnh thông số lịch cào & Extension"
            >
              <span className="material-symbols-outlined text-[16px]">tune</span>
            </button>
          )}

          {/* Nút Xoá */}
          {canEdit && (
            <button
              type="button"
              onClick={() => {
                if (window.confirm(`Xoá lịch cào "${schedule.label}"? Nếu đang chạy sẽ dừng ngay.`)) {
                  onDelete(schedule.id);
                }
              }}
              className="p-1 rounded-md hover:bg-red-50 text-muted-foreground hover:text-red-600 transition cursor-pointer"
              title="Xoá lịch"
            >
              <span className="material-symbols-outlined text-[16px]">delete</span>
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

function EditScheduleModal({
  schedule,
  onClose,
  onSaved,
  updateSchedule,
}: {
  schedule: RotationSchedule;
  onClose: () => void;
  onSaved: () => void;
  updateSchedule: (
    id: string,
    label: string,
    fbGroups: RotationGroupInput[],
    liGroups: RotationGroupInput[],
    threadsKeywords: string[],
    config: Record<string, unknown>
  ) => Promise<{ success: boolean; error?: string }>;
}) {
  const fb = useGroupOptions("facebook");
  const li = useGroupOptions("linkedin");

  const origCfg = schedule.cfg || ({} as any);

  const [label, setLabel] = useState(schedule.label || "");
  const [intervalHours, setIntervalHours] = useState<number>(origCfg.intervalHours || 2);
  const [repeatEnabled, setRepeatEnabled] = useState(origCfg.repeatEnabled !== false);
  const [antiBotEnabled, setAntiBotEnabled] = useState(origCfg.antiBotEnabled !== false);
  const [threadsAutoDiscover, setThreadsAutoDiscover] = useState(origCfg.threadsAutoDiscover === true);

  // Thông số cuộn & chống checkpoint
  const [scrollDistance, setScrollDistance] = useState<number>(origCfg.scrollDistance || 1600);
  const [scrollDelayMin, setScrollDelayMin] = useState<number>(origCfg.scrollDelayMinMs ? origCfg.scrollDelayMinMs / 1000 : 1.5);
  const [scrollDelayMax, setScrollDelayMax] = useState<number>(origCfg.scrollDelayMaxMs ? origCfg.scrollDelayMaxMs / 1000 : 2.8);
  const [groupRestSec, setGroupRestSec] = useState<number>(origCfg.groupRestSec || 45);
  const [maxScrolls, setMaxScrolls] = useState<number>(origCfg.maxScrolls || 25);
  const [oldPostsLimit, setOldPostsLimit] = useState<number>(origCfg.oldPostsLimit || 15);
  const [maxPostsPerGroup, setMaxPostsPerGroup] = useState<number>(origCfg.maxPostsPerGroup || 30);
  const [maxScrollTimeSec, setMaxScrollTimeSec] = useState<number>(origCfg.maxScrollTimeSec || 90);

  // Từ khóa Threads
  const [threadsKeywordsInput, setThreadsKeywordsInput] = useState<string>(
    (origCfg.threadsKeywords || []).join("\n")
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Init fb & li selected IDs
  useEffect(() => {
    if (origCfg.fbGroups && Array.isArray(origCfg.fbGroups)) {
      fb.setSelectedIds(origCfg.fbGroups.map((g: any) => g.id).filter(Boolean));
    }
    if (origCfg.liGroups && Array.isArray(origCfg.liGroups)) {
      li.setSelectedIds(origCfg.liGroups.map((g: any) => g.id).filter(Boolean));
    }
  }, []);

  const handleSave = async () => {
    if (!label.trim()) {
      setError("Vui lòng nhập tên lịch cào.");
      return;
    }
    setSaving(true);
    setError(null);

    const updatedFbGroups = fb.groups
      .filter((g) => fb.selectedIds.includes(g.id))
      .map((g) => ({
        id: g.id,
        name: g.group_name || g.group_url,
        url: g.group_url,
        post_limit: maxPostsPerGroup,
      }));

    const updatedLiGroups = li.groups
      .filter((g) => li.selectedIds.includes(g.id))
      .map((g) => ({
        id: g.id,
        name: g.group_name || g.group_url,
        url: g.group_url,
      }));

    const parsedKeywords = parseKeywords(threadsKeywordsInput);

    const updatedConfig: Record<string, unknown> = {
      ...origCfg,
      id: schedule.id,
      intervalHours,
      repeatEnabled,
      antiBotEnabled,
      threadsAutoDiscover,
      scrollDistance,
      scrollDelayMinMs: Math.round(scrollDelayMin * 1000),
      scrollDelayMaxMs: Math.round(scrollDelayMax * 1000),
      groupRestSec,
      maxScrolls,
      oldPostsLimit,
      maxPostsPerGroup,
      maxScrollTimeSec,
    };

    try {
      // 1. Update Extension
      await updateSchedule(
        schedule.id,
        label.trim(),
        updatedFbGroups,
        updatedLiGroups,
        parsedKeywords,
        updatedConfig
      );

      // 2. Update Backend Database
      await allPlatformRotationSchedulesService.updateSchedule(schedule.id, {
        id: schedule.id,
        label: label.trim(),
        cfg: {
          ...updatedConfig,
          fbGroups: updatedFbGroups,
          liGroups: updatedLiGroups,
          threadsKeywords: parsedKeywords,
        },
      });

      setSaving(false);
      onSaved();
    } catch (e: any) {
      setSaving(false);
      setError(e?.message || "Lỗi khi lưu thông số lịch cào.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-border bg-card">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-[20px]">tune</span>
            <h3 className="font-bold text-sm text-foreground">
              Tùy chỉnh thông số Extension & Lịch cào: <span className="text-primary">{schedule.label}</span>
            </h3>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded-lg hover:bg-muted cursor-pointer">
            <span className="material-symbols-outlined text-[18px] text-muted-foreground">close</span>
          </button>
        </div>

        <div className="p-4 flex-1 overflow-y-auto flex flex-col gap-4">
          <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-3 text-xs text-blue-900 leading-relaxed">
            ℹ️ Bạn có thể tùy chỉnh lại toàn bộ thông số cuộn, độ trễ, giới hạn bài viết và từ khóa. Sau khi bấm <b>&quot;Lưu thay đổi&quot;</b>, thông số mới sẽ được áp dụng cho lượt chạy tiếp theo của lịch cào này!
          </div>

          <div>
            <label className="text-xs font-bold text-foreground block mb-1">Tên lịch cào</label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
            />
          </div>

          {/* Thông số Extension chuyên sâu */}
          <div className="rounded-xl border border-border bg-muted/20 p-3.5 flex flex-col gap-3">
            <div className="flex items-center gap-2 pb-1 border-b border-border/60">
              <span className="text-xs font-bold text-foreground">⚙️ Thông số cuộn & Chống Checkpoint né bot</span>
              <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 font-semibold border border-emerald-200">
                Áp dụng Extension
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="text-[11px] font-bold text-foreground block mb-1">Cuộn mỗi nhịp (px)</label>
                <input
                  type="number"
                  min={800}
                  max={3000}
                  step={100}
                  value={scrollDistance}
                  onChange={(e) => setScrollDistance(Number(e.target.value) || 1600)}
                  className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none"
                />
              </div>

              <div>
                <label className="text-[11px] font-bold text-foreground block mb-1">Độ trễ cuộn Min (s)</label>
                <input
                  type="number"
                  min={0.5}
                  max={10}
                  step={0.1}
                  value={scrollDelayMin}
                  onChange={(e) => setScrollDelayMin(Number(e.target.value) || 1.5)}
                  className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none"
                />
              </div>

              <div>
                <label className="text-[11px] font-bold text-foreground block mb-1">Độ trễ cuộn Max (s)</label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  step={0.1}
                  value={scrollDelayMax}
                  onChange={(e) => setScrollDelayMax(Number(e.target.value) || 2.8)}
                  className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none"
                />
              </div>

              <div>
                <label className="text-[11px] font-bold text-foreground block mb-1">Nghỉ giữa 2 nhóm (s)</label>
                <input
                  type="number"
                  min={10}
                  max={600}
                  step={5}
                  value={groupRestSec}
                  onChange={(e) => setGroupRestSec(Number(e.target.value) || 45)}
                  className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none"
                />
              </div>

              <div>
                <label className="text-[11px] font-bold text-foreground block mb-1">Số nhịp cuộn tối đa</label>
                <input
                  type="number"
                  min={5}
                  max={100}
                  step={5}
                  value={maxScrolls}
                  onChange={(e) => setMaxScrolls(Number(e.target.value) || 25)}
                  className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none"
                />
              </div>

              <div>
                <label className="text-[11px] font-bold text-foreground block mb-1">Cắt khi gặp bài cũ</label>
                <input
                  type="number"
                  min={5}
                  max={50}
                  step={1}
                  value={oldPostsLimit}
                  onChange={(e) => setOldPostsLimit(Number(e.target.value) || 15)}
                  className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none"
                />
              </div>

              <div>
                <label className="text-[11px] font-bold text-foreground block mb-1">Số bài tối đa / nhóm</label>
                <input
                  type="number"
                  min={5}
                  max={200}
                  step={5}
                  value={maxPostsPerGroup}
                  onChange={(e) => setMaxPostsPerGroup(Number(e.target.value) || 30)}
                  className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none"
                />
              </div>

              <div>
                <label className="text-[11px] font-bold text-foreground block mb-1">Thời gian cuộn max (s)</label>
                <input
                  type="number"
                  min={15}
                  max={600}
                  step={15}
                  value={maxScrollTimeSec}
                  onChange={(e) => setMaxScrollTimeSec(Number(e.target.value) || 90)}
                  className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Chu kỳ lặp lại */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-foreground block mb-1">Chu kỳ lặp lại (giờ)</label>
              <input
                type="number"
                min={0.25}
                step={0.25}
                value={intervalHours}
                onChange={(e) => setIntervalHours(Number(e.target.value) || 1)}
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
              />
            </div>
            <div className="flex items-center gap-4 pt-6">
              <label className="inline-flex items-center gap-2 cursor-pointer text-xs font-semibold text-foreground">
                <input
                  type="checkbox"
                  checked={repeatEnabled}
                  onChange={(e) => setRepeatEnabled(e.target.checked)}
                  className="rounded border-border text-primary"
                />
                <span>Lặp lại tự động</span>
              </label>
              <label className="inline-flex items-center gap-2 cursor-pointer text-xs font-semibold text-foreground">
                <input
                  type="checkbox"
                  checked={antiBotEnabled}
                  onChange={(e) => setAntiBotEnabled(e.target.checked)}
                  className="rounded border-border text-primary"
                />
                <span>Chống bot & Jitter</span>
              </label>
            </div>
          </div>

          {/* Từ khóa Threads */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-bold text-foreground">
                Từ khoá cào Threads ({parseKeywords(threadsKeywordsInput).length} từ khoá)
              </label>
              <label className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={threadsAutoDiscover}
                  onChange={(e) => setThreadsAutoDiscover(e.target.checked)}
                  className="rounded border-border text-primary"
                />
                <span>Tự kết hợp AI Registry</span>
              </label>
            </div>
            <textarea
              rows={3}
              value={threadsKeywordsInput}
              onChange={(e) => setThreadsKeywordsInput(e.target.value)}
              placeholder="Mỗi dòng 1 từ khoá..."
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
            />
          </div>

          {error && (
            <div className="p-3 rounded-xl border border-red-200 bg-red-50 text-red-700 text-xs">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 p-3 border-t border-border bg-card">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 rounded-xl border border-border text-xs font-semibold text-foreground hover:bg-muted cursor-pointer"
          >
            Đóng
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl bg-primary text-white text-xs font-bold disabled:opacity-50 cursor-pointer shadow-sm hover:opacity-95"
          >
            {saving && <div className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />}
            <span>Lưu thay đổi & Áp dụng ngay</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function AddScheduleModal({
  onClose,
  onCreated,
  addSchedule,
  runNow,
}: {
  onClose: () => void;
  onCreated?: () => void;
  addSchedule: (label: string, fbGroups: RotationGroupInput[], liGroups: RotationGroupInput[], threadsKeywords: string[], config: Record<string, unknown>) => Promise<{ success: boolean; error?: string; schedule?: RotationSchedule }>;
  runNow?: (id: string) => void;
}) {
  const { user } = useAppAuth();
  const fb = useGroupOptions("facebook");
  const li = useGroupOptions("linkedin");

  const [label, setLabel] = useState("");
  const [enabledPlatforms, setEnabledPlatforms] = useState<Set<"facebook" | "linkedin" | "threads">>(() => new Set(["facebook", "linkedin", "threads"]));
  const [repeatEnabled, setRepeatEnabled] = useState(true);
  const [intervalHours, setIntervalHours] = useState<number>(2);
  const [intervalInput, setIntervalInput] = useState<string>("2");
  const [threadsAutoDiscover, setThreadsAutoDiscover] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // ── THÔNG SỐ CÀO & CUỘN CHỐNG CHECKPOINT (ĐỒNG BỘ EXTENSION) ──
  const [scrollDistance, setScrollDistance] = useState<number>(1600);
  const [scrollDelayMin, setScrollDelayMin] = useState<number>(1.5);
  const [scrollDelayMax, setScrollDelayMax] = useState<number>(2.8);
  const [groupRestSec, setGroupRestSec] = useState<number>(45);
  const [maxScrolls, setMaxScrolls] = useState<number>(25);
  const [oldPostsLimit, setOldPostsLimit] = useState<number>(15);
  const [maxPostsPerGroup, setMaxPostsPerGroup] = useState<number>(30);
  const [maxScrollTimeSec, setMaxScrollTimeSec] = useState<number>(90);
  const [isAdvancedOpen, setIsAdvancedOpen] = useState<boolean>(true);
  const [runImmediately, setRunImmediately] = useState<boolean>(true);

  const resetCrawlSettingsToDefault = () => {
    setScrollDistance(1600);
    setScrollDelayMin(1.5);
    setScrollDelayMax(2.8);
    setGroupRestSec(45);
    setMaxScrolls(25);
    setOldPostsLimit(15);
    setMaxPostsPerGroup(30);
    setMaxScrollTimeSec(90);
  };

  // ── THREADS TOPICS & KEYWORDS STATE ──
  const [topics, setTopics] = useState<KeywordTopic[]>([]);
  const [loadingTopics, setLoadingTopics] = useState(false);
  const [selectedTopicIds, setSelectedTopicIds] = useState<Set<string>>(new Set());
  const [topicKeywordsMap, setTopicKeywordsMap] = useState<Record<string, KeywordItem[]>>({});
  const [loadingTopicKeywords, setLoadingTopicKeywords] = useState<Record<string, boolean>>({});
  const [selectedKeywords, setSelectedKeywords] = useState<Set<string>>(new Set());
  const [customKeywordsInput, setCustomKeywordsInput] = useState<string>("");

  // Load all keyword topics from library on mount
  useEffect(() => {
    let active = true;
    setLoadingTopics(true);
    allPlatformKeywordsService.getTopics().then((res) => {
      if (!active) return;
      setLoadingTopics(false);
      if (res.success && res.data) {
        setTopics(res.data);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  // Toggle a topic selection
  const toggleTopic = async (topicId: string) => {
    const nextSelected = new Set(selectedTopicIds);
    if (nextSelected.has(topicId)) {
      nextSelected.delete(topicId);
      setSelectedTopicIds(nextSelected);
      const items = topicKeywordsMap[topicId] || [];
      const stillSelectedKeywords = new Set<string>();
      nextSelected.forEach((otherId) => {
        (topicKeywordsMap[otherId] || []).forEach((it) => stillSelectedKeywords.add(it.keyword));
      });
      setSelectedKeywords((prev) => {
        const next = new Set(prev);
        items.forEach((it) => {
          if (!stillSelectedKeywords.has(it.keyword)) next.delete(it.keyword);
        });
        return next;
      });
    } else {
      nextSelected.add(topicId);
      setSelectedTopicIds(nextSelected);
      if (!topicKeywordsMap[topicId]) {
        setLoadingTopicKeywords((prev) => ({ ...prev, [topicId]: true }));
        try {
          const res = await allPlatformKeywordsService.getKeywordsInTopic(topicId);
          if (res.success && Array.isArray(res.data)) {
            const items: KeywordItem[] = res.data;
            setTopicKeywordsMap((prev) => ({ ...prev, [topicId]: items }));
            setSelectedKeywords((prev) => {
              const next = new Set(prev);
              items.forEach((it) => next.add(it.keyword));
              return next;
            });
          }
        } finally {
          setLoadingTopicKeywords((prev) => ({ ...prev, [topicId]: false }));
        }
      } else {
        const items = topicKeywordsMap[topicId] || [];
        setSelectedKeywords((prev) => {
          const next = new Set(prev);
          items.forEach((it) => next.add(it.keyword));
          return next;
        });
      }
    }
  };

  const handleSelectAllTopics = async () => {
    const allIds = new Set(topics.map((t) => t.id));
    setSelectedTopicIds(allIds);
    for (const t of topics) {
      if (!topicKeywordsMap[t.id]) {
        try {
          const res = await allPlatformKeywordsService.getKeywordsInTopic(t.id);
          if (res.success && Array.isArray(res.data)) {
            const items: KeywordItem[] = res.data;
            setTopicKeywordsMap((prev) => ({ ...prev, [t.id]: items }));
            setSelectedKeywords((prev) => {
              const next = new Set(prev);
              items.forEach((it) => next.add(it.keyword));
              return next;
            });
          }
        } catch {}
      } else {
        const items = topicKeywordsMap[t.id] || [];
        setSelectedKeywords((prev) => {
          const next = new Set(prev);
          items.forEach((it) => next.add(it.keyword));
          return next;
        });
      }
    }
  };

  const handleDeselectAllTopics = () => {
    setSelectedTopicIds(new Set());
    setSelectedKeywords(new Set());
  };

  const toggleKeyword = (kw: string) => {
    setSelectedKeywords((prev) => {
      const next = new Set(prev);
      if (next.has(kw)) next.delete(kw);
      else next.add(kw);
      return next;
    });
  };

  // Available keywords from all currently selected topics
  const availableTopicKeywords = useMemo(() => {
    const result: { item: KeywordItem; topicName: string }[] = [];
    topics.forEach((t) => {
      if (selectedTopicIds.has(t.id)) {
        const items = topicKeywordsMap[t.id] || [];
        items.forEach((it) => {
          result.push({ item: it, topicName: t.name });
        });
      }
    });
    return result;
  }, [topics, selectedTopicIds, topicKeywordsMap]);

  // Combined final keywords for Threads (chosen topic keywords + custom input)
  const finalThreadsKeywords = useMemo(() => {
    const list: string[] = [];
    const seen = new Set<string>();

    selectedKeywords.forEach((kw) => {
      const clean = kw.trim();
      if (clean && !seen.has(clean.toLowerCase())) {
        seen.add(clean.toLowerCase());
        list.push(clean);
      }
    });

    parseKeywords(customKeywordsInput).forEach((kw) => {
      const clean = kw.trim();
      if (clean && !seen.has(clean.toLowerCase())) {
        seen.add(clean.toLowerCase());
        list.push(clean);
      }
    });

    return list;
  }, [selectedKeywords, customKeywordsInput]);

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
    (enabledPlatforms.has("threads") ? (finalThreadsKeywords.length > 0 ? finalThreadsKeywords.length : threadsAutoDiscover ? 1 : 0) : 0);

  const estSeconds = useMemo(() => {
    const fbCount = enabledPlatforms.has("facebook") ? fb.selectedIds.length : 0;
    const liCount = enabledPlatforms.has("linkedin") ? li.selectedIds.length : 0;
    const thCount = enabledPlatforms.has("threads") ? (finalThreadsKeywords.length > 0 ? finalThreadsKeywords.length : threadsAutoDiscover ? MAX_AUTO_THREADS_KEYWORDS : 0) : 0;
    return estimateRoundSeconds(fbCount, liCount, thCount);
  }, [enabledPlatforms, fb.selectedIds.length, li.selectedIds.length, finalThreadsKeywords.length, threadsAutoDiscover]);

  const minIntervalHours = useMemo(() => minIntervalHoursForSeconds(estSeconds), [estSeconds]);

  useEffect(() => {
    if (intervalHours < minIntervalHours) {
      setIntervalHours(minIntervalHours);
      setIntervalInput(String(minIntervalHours));
    }
  }, [minIntervalHours, intervalHours]);

  const isAnyTopicKeywordsLoading = Object.values(loadingTopicKeywords).some(Boolean);
  const canSubmit = totalSelected > 0 && !isAnyTopicKeywordsLoading && !!user?.id && !!user?.email && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit || !user?.id || !user?.email) return;
    setSubmitting(true);
    setError(null);
    try {
      window.localStorage.setItem(INTERVAL_STORAGE_KEY, intervalInput);
    } catch {}

    const generatedScheduleId = `sch_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const fbGroups: RotationGroupInput[] = enabledPlatforms.has("facebook")
      ? fb.groups.filter((g) => fb.selectedIds.includes(g.id)).map((g) => ({
          id: g.id,
          name: g.group_name || g.group_url,
          url: g.group_url,
          post_limit: maxPostsPerGroup,
        }))
      : [];
    const liGroups: RotationGroupInput[] = enabledPlatforms.has("linkedin")
      ? li.groups.filter((g) => li.selectedIds.includes(g.id)).map((g) => ({ id: g.id, name: g.group_name || g.group_url, url: g.group_url }))
      : [];
    const threadsKeywords = enabledPlatforms.has("threads") ? finalThreadsKeywords : [];
    const effectiveAutoDiscover = enabledPlatforms.has("threads") ? threadsAutoDiscover : false;
    const threadsTopicNames = enabledPlatforms.has("threads") ? topics.filter((t) => selectedTopicIds.has(t.id)).map((t) => t.name) : [];
    const threadsTopicIds = enabledPlatforms.has("threads") ? Array.from(selectedTopicIds) : [];

    const schedulePayload = {
      label: label.trim() || "Lịch cào xoay vòng",
      fbGroups,
      liGroups,
      threadsKeywords,
      config: {
        id: generatedScheduleId,
        email: user.email,
        idMember: user.id,
        intervalHours,
        repeatEnabled,
        threadsAutoDiscover: effectiveAutoDiscover,
        threadsTopicIds,
        threadsTopicNames,
        scrollDistance,
        scrollDelayMinMs: Math.round(scrollDelayMin * 1000),
        scrollDelayMaxMs: Math.round(scrollDelayMax * 1000),
        groupRestSec,
        maxScrolls,
        oldPostsLimit,
        maxPostsPerGroup,
        maxScrollTimeSec,
      },
    };

    // 1. Post to Extension
    const res = await addSchedule(schedulePayload.label, fbGroups, liGroups, threadsKeywords, schedulePayload.config);
    if (res.success && runImmediately) {
      const schId = res.schedule?.id || generatedScheduleId;
      runNow?.(schId);
    }
    if (!res.success) {
      setSubmitting(false);
      setError(res.error || "Không tạo được lịch cào.");
      return;
    }

    // 2. Persist to Backend Supabase (RBAC + Creator Identity) using exact same schedule ID as Extension
    const scheduleId = res.schedule?.id || generatedScheduleId;
    try {
      await allPlatformRotationSchedulesService.saveSchedule({
        id: scheduleId,
        label: schedulePayload.label,
        cfg: {
          ...schedulePayload.config,
          id: scheduleId,
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
    if (onCreated) onCreated();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-2xl border border-border shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
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
            <div className="flex gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => togglePlatform("facebook")}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-bold border transition cursor-pointer flex items-center gap-1.5",
                  enabledPlatforms.has("facebook") ? "bg-blue-600 text-white border-blue-600 shadow-sm" : "bg-muted/40 text-muted-foreground border-border"
                )}
              >
                <span>Facebook ({fb.selectedIds.length})</span>
              </button>
              <button
                type="button"
                onClick={() => togglePlatform("linkedin")}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-bold border transition cursor-pointer flex items-center gap-1.5",
                  enabledPlatforms.has("linkedin") ? "bg-sky-700 text-white border-sky-700 shadow-sm" : "bg-muted/40 text-muted-foreground border-border"
                )}
              >
                <span>LinkedIn ({li.selectedIds.length})</span>
              </button>
              <button
                type="button"
                onClick={() => togglePlatform("threads")}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-bold border transition cursor-pointer flex items-center gap-1.5",
                  enabledPlatforms.has("threads") ? "bg-slate-900 text-white border-slate-900 shadow-sm" : "bg-muted/40 text-muted-foreground border-border"
                )}
              >
                <span>Threads ({selectedTopicIds.size} chủ đề · {finalThreadsKeywords.length} từ khoá)</span>
              </button>
            </div>
          </div>

          {/* Group and Keywords Selection */}
          {(enabledPlatforms.size > 0) && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5">
              {enabledPlatforms.has("facebook") && (
                <div className={cn("p-3 rounded-xl border border-blue-200/60 bg-blue-50/20", enabledPlatforms.has("threads") ? "lg:col-span-3" : "lg:col-span-6")}>
                  <GroupPickList title="Nhóm Facebook" options={fb} disabled={submitting} />
                </div>
              )}
              {enabledPlatforms.has("linkedin") && (
                <div className={cn("p-3 rounded-xl border border-sky-200/60 bg-sky-50/20", enabledPlatforms.has("threads") ? "lg:col-span-3" : "lg:col-span-6")}>
                  <GroupPickList title="Nhóm LinkedIn" options={li} disabled={submitting} />
                </div>
              )}
              {enabledPlatforms.has("threads") && (
                <div className={cn("p-3.5 rounded-xl border border-slate-200/90 bg-slate-50/50 flex flex-col gap-3", (enabledPlatforms.has("facebook") || enabledPlatforms.has("linkedin")) ? "lg:col-span-6" : "lg:col-span-12")}>
                  {/* Threads Topic & Keywords Configuration */}
                  <div className="flex items-center justify-between gap-1 flex-wrap pb-1.5 border-b border-border/60">
                    <div className="flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-[18px] text-slate-800">alternate_email</span>
                      <span className="text-xs font-bold text-foreground">
                        Threads: Chọn Chủ đề & Từ khoá cào ({finalThreadsKeywords.length} từ khoá)
                      </span>
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-900 text-white font-semibold">
                      Mode recent
                    </span>
                  </div>

                  {/* Step 1: Topic Selector */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-[11px] font-bold text-foreground flex items-center gap-1">
                        <span>1. Chọn Chủ đề cào ({selectedTopicIds.size}/{topics.length}):</span>
                      </label>
                      <div className="flex items-center gap-2 text-[10px] font-semibold">
                        <button
                          type="button"
                          onClick={handleSelectAllTopics}
                          className="text-primary hover:underline cursor-pointer"
                        >
                          Chọn tất cả chủ đề
                        </button>
                        <span className="text-muted-foreground/40">•</span>
                        <button
                          type="button"
                          onClick={handleDeselectAllTopics}
                          className="text-muted-foreground hover:underline cursor-pointer"
                        >
                          Bỏ chọn
                        </button>
                      </div>
                    </div>

                    {loadingTopics ? (
                      <div className="text-[11px] text-muted-foreground py-1.5">Đang tải chủ đề từ thư viện...</div>
                    ) : topics.length === 0 ? (
                      <div className="text-[11px] text-muted-foreground py-1.5">Chưa có chủ đề nào trong Thư viện từ khóa.</div>
                    ) : (
                      <div className="flex gap-1.5 flex-wrap max-h-[110px] overflow-y-auto p-1 rounded-lg border border-border/50 bg-background/60">
                        {topics.map((t) => {
                          const isSelected = selectedTopicIds.has(t.id);
                          const isFetchingKw = loadingTopicKeywords[t.id];
                          return (
                            <button
                              key={t.id}
                              type="button"
                              onClick={() => toggleTopic(t.id)}
                              className={cn(
                                "px-2.5 py-1 rounded-lg text-[11px] font-medium border transition cursor-pointer flex items-center gap-1.5 select-none",
                                isSelected
                                  ? "bg-slate-900 text-white border-slate-900 shadow-sm"
                                  : "bg-muted/40 text-foreground border-border hover:bg-muted"
                              )}
                            >
                              <span className="material-symbols-outlined text-[13px]">
                                {isSelected ? "check_box" : "check_box_outline_blank"}
                              </span>
                              <span>{t.name}</span>
                              <span className="text-[10px] opacity-75">
                                {isFetchingKw ? "..." : `(${t.keywords_count || 0})`}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Step 2: Keywords in selected topics */}
                  {selectedTopicIds.size > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-[11px] font-bold text-foreground">
                          2. Từ khoá trong chủ đề ({selectedKeywords.size}/{availableTopicKeywords.length}):
                        </label>
                        <div className="flex items-center gap-2 text-[10px] font-semibold">
                          <button
                            type="button"
                            onClick={() => setSelectedKeywords(new Set(availableTopicKeywords.map((k) => k.item.keyword)))}
                            className="text-primary hover:underline cursor-pointer"
                          >
                            Chọn tất cả
                          </button>
                          <span className="text-muted-foreground/40">•</span>
                          <button
                            type="button"
                            onClick={() => setSelectedKeywords(new Set())}
                            className="text-muted-foreground hover:underline cursor-pointer"
                          >
                            Bỏ chọn
                          </button>
                        </div>
                      </div>

                      <div className="border border-border/80 rounded-xl max-h-[140px] overflow-y-auto divide-y divide-border/60 bg-background">
                        {availableTopicKeywords.length === 0 ? (
                          <div className="p-3 text-center text-xs text-muted-foreground">Đang tải danh sách từ khoá trong chủ đề...</div>
                        ) : (
                          availableTopicKeywords.map(({ item, topicName }) => (
                            <label
                              key={item.id}
                              className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-muted/40 cursor-pointer transition text-xs select-none"
                            >
                              <input
                                type="checkbox"
                                checked={selectedKeywords.has(item.keyword)}
                                onChange={() => toggleKeyword(item.keyword)}
                                className="rounded border-border text-primary shrink-0"
                              />
                              <span className="font-medium text-foreground truncate">{item.keyword}</span>
                              <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0 truncate max-w-[120px]">
                                {topicName}
                              </span>
                            </label>
                          ))
                        )}
                      </div>
                    </div>
                  )}

                  {/* Step 3: Custom keywords addition (optional) */}
                  <div>
                    <label className="text-[11px] font-bold text-foreground block mb-1">
                      3. Từ khoá thêm tay ngoài chủ đề (tuỳ chọn, mỗi dòng 1 từ khoá):
                    </label>
                    <textarea
                      rows={2}
                      value={customKeywordsInput}
                      onChange={(e) => setCustomKeywordsInput(e.target.value)}
                      disabled={submitting}
                      placeholder="VD: thuê làm website, cần agency app..."
                      className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none disabled:opacity-50"
                    />
                  </div>

                  <div className="flex items-center gap-2 pt-1 border-t border-border/50">
                    <label className="inline-flex items-center gap-1.5 cursor-pointer text-[11px] text-muted-foreground select-none">
                      <input
                        type="checkbox"
                        checked={threadsAutoDiscover}
                        onChange={(e) => setThreadsAutoDiscover(e.target.checked)}
                        className="rounded border-border text-primary focus:ring-0"
                      />
                      <span>Tự động kết hợp từ khóa AI Registry</span>
                    </label>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Tùy chỉnh thông số cào & Cuộn chống checkpoint */}
          <div className="rounded-xl border border-border bg-card/60 overflow-hidden shadow-xs">
            <button
              type="button"
              onClick={() => setIsAdvancedOpen(!isAdvancedOpen)}
              className="w-full flex items-center justify-between p-3 text-left hover:bg-muted/40 transition-colors cursor-pointer select-none"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm">⚙️</span>
                <span className="text-xs font-bold text-foreground">Tùy chỉnh thông số cào chuyên sâu</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-semibold border border-emerald-200">
                  Khớp cài đặt Extension
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground font-medium">
                  {isAdvancedOpen ? "Thu gọn ▲" : "Tùy chỉnh ▼"}
                </span>
              </div>
            </button>

            {isAdvancedOpen && (
              <div className="p-3 pt-0 border-t border-border/50 space-y-3">
                <div className="flex items-center justify-between pt-2">
                  <p className="text-[11px] text-muted-foreground">
                    Điều chỉnh tốc độ cuộn, thời gian nghỉ và giới hạn bài viết phù hợp với cấu hình Extension trên máy bạn:
                  </p>
                  <button
                    type="button"
                    onClick={resetCrawlSettingsToDefault}
                    className="text-[11px] font-semibold text-primary hover:underline cursor-pointer shrink-0 ml-2"
                  >
                    🔄 Mặc định an toàn
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                  {/* Khoảng cách cuộn mỗi nhịp */}
                  <div>
                    <label className="text-[11px] font-bold text-foreground block mb-1">
                      Cuộn mỗi nhịp (Pixels)
                    </label>
                    <input
                      type="number"
                      min={800}
                      max={3000}
                      step={100}
                      value={scrollDistance}
                      onChange={(e) => setScrollDistance(Number(e.target.value) || 1600)}
                      className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none"
                    />
                    <span className="text-[10px] text-muted-foreground block mt-0.5">Khuyên dùng: 1400 - 2000px</span>
                  </div>

                  {/* Thời gian cuộn tối đa / nhóm */}
                  <div>
                    <label className="text-[11px] font-bold text-foreground block mb-1">
                      Thời gian cuộn / nhóm (giây)
                    </label>
                    <input
                      type="number"
                      min={15}
                      max={600}
                      step={15}
                      value={maxScrollTimeSec}
                      onChange={(e) => setMaxScrollTimeSec(Number(e.target.value) || 90)}
                      className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none"
                    />
                    <span className="text-[10px] text-muted-foreground block mt-0.5">Mặc định: 90s</span>
                  </div>

                  {/* Nghỉ giữa 2 lần cuộn Min */}
                  <div>
                    <label className="text-[11px] font-bold text-foreground block mb-1">
                      Độ trễ cuộn ít nhất (giây)
                    </label>
                    <input
                      type="number"
                      min={0.5}
                      max={10}
                      step={0.1}
                      value={scrollDelayMin}
                      onChange={(e) => setScrollDelayMin(Number(e.target.value) || 1.5)}
                      className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none"
                    />
                    <span className="text-[10px] text-muted-foreground block mt-0.5">Mặc định: 1.5s</span>
                  </div>

                  {/* Nghỉ giữa 2 lần cuộn Max */}
                  <div>
                    <label className="text-[11px] font-bold text-foreground block mb-1">
                      Độ trễ cuộn nhiều nhất (giây)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={20}
                      step={0.1}
                      value={scrollDelayMax}
                      onChange={(e) => setScrollDelayMax(Number(e.target.value) || 2.8)}
                      className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none"
                    />
                    <span className="text-[10px] text-muted-foreground block mt-0.5">Mặc định: 2.8s</span>
                  </div>

                  {/* Nghỉ giữa 2 nhóm */}
                  <div>
                    <label className="text-[11px] font-bold text-foreground block mb-1">
                      Nghỉ giữa 2 nhóm (giây)
                    </label>
                    <input
                      type="number"
                      min={10}
                      max={600}
                      step={5}
                      value={groupRestSec}
                      onChange={(e) => setGroupRestSec(Number(e.target.value) || 45)}
                      className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none"
                    />
                    <span className="text-[10px] text-muted-foreground block mt-0.5">Chống checkpoint (45s)</span>
                  </div>

                  {/* Số lần cuộn tối đa / nhóm */}
                  <div>
                    <label className="text-[11px] font-bold text-foreground block mb-1">
                      Số lần cuộn tối đa / nhóm
                    </label>
                    <input
                      type="number"
                      min={5}
                      max={100}
                      step={5}
                      value={maxScrolls}
                      onChange={(e) => setMaxScrolls(Number(e.target.value) || 25)}
                      className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none"
                    />
                    <span className="text-[10px] text-muted-foreground block mt-0.5">Tối đa 25 nhịp cuộn</span>
                  </div>

                  {/* Giới hạn bài cũ dừng nhóm */}
                  <div>
                    <label className="text-[11px] font-bold text-foreground block mb-1">
                      Cắt nhóm khi gặp bài cũ
                    </label>
                    <input
                      type="number"
                      min={5}
                      max={50}
                      step={1}
                      value={oldPostsLimit}
                      onChange={(e) => setOldPostsLimit(Number(e.target.value) || 15)}
                      className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none"
                    />
                    <span className="text-[10px] text-muted-foreground block mt-0.5">Dừng khi gặp 15 bài cũ</span>
                  </div>

                  {/* Bài tối đa / nhóm */}
                  <div>
                    <label className="text-[11px] font-bold text-foreground block mb-1">
                      Số bài tối đa / nhóm
                    </label>
                    <input
                      type="number"
                      min={5}
                      max={200}
                      step={5}
                      value={maxPostsPerGroup}
                      onChange={(e) => setMaxPostsPerGroup(Number(e.target.value) || 30)}
                      className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none"
                    />
                    <span className="text-[10px] text-muted-foreground block mt-0.5">Mặc định: 30 bài / nhóm</span>
                  </div>
                </div>
              </div>
            )}
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

function GroupPickList({
  title,
  options,
  disabled,
}: {
  title: string;
  options: ReturnType<typeof useGroupOptions>;
  disabled: boolean;
}) {
  const { groups, selectedIds, setSelectedIds, toggle, loading, error } = options;
  const [filterText, setFilterText] = useState("");
  const filtered = useMemo(() => {
    if (!filterText.trim()) return groups;
    const lower = filterText.toLowerCase();
    return groups.filter(
      (g) => (g.group_name && g.group_name.toLowerCase().includes(lower)) || (g.group_url && g.group_url.toLowerCase().includes(lower))
    );
  }, [groups, filterText]);

  return (
    <div className="flex flex-col gap-2 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs font-bold text-foreground">
          {title} ({selectedIds.length}/{groups.length})
        </label>
        <div className="flex items-center gap-2 text-[11px] font-semibold">
          <button
            type="button"
            className="text-primary hover:underline disabled:opacity-50 cursor-pointer"
            disabled={disabled}
            onClick={() => setSelectedIds(groups.map((g) => g.id))}
          >
            Chọn tất cả
          </button>
          <span className="text-muted-foreground/40">•</span>
          <button
            type="button"
            className="text-muted-foreground hover:underline disabled:opacity-50 cursor-pointer"
            disabled={disabled}
            onClick={() => setSelectedIds([])}
          >
            Bỏ chọn
          </button>
        </div>
      </div>
      {groups.length > 5 && (
        <input
          type="text"
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          placeholder="Lọc tên hoặc link nhóm..."
          className="w-full px-2.5 py-1 text-[11px] rounded-lg border border-border bg-background focus:border-primary outline-none"
        />
      )}
      <div className="border border-border rounded-xl max-h-[160px] overflow-y-auto divide-y divide-border bg-muted/20">
        {loading ? (
          <div className="p-3 text-center text-xs text-muted-foreground">Đang tải danh sách nhóm...</div>
        ) : error ? (
          <div className="p-3 text-center text-xs text-red-600">{error}</div>
        ) : groups.length === 0 ? (
          <div className="p-3 text-center text-xs text-muted-foreground">Chưa có nhóm nào.</div>
        ) : filtered.length === 0 ? (
          <div className="p-3 text-center text-xs text-muted-foreground">Không tìm thấy nhóm phù hợp.</div>
        ) : (
          filtered.map((g) => (
            <label
              key={g.id}
              className={cn(
                "flex items-start gap-2 p-2 cursor-pointer hover:bg-muted/50 transition-colors",
                disabled && "opacity-60 pointer-events-none"
              )}
            >
              <input
                type="checkbox"
                className="mt-0.5 rounded border-border"
                checked={selectedIds.includes(g.id)}
                onChange={() => toggle(g.id)}
              />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold text-foreground line-clamp-1">
                  {g.group_name || g.group_url}
                </div>
                <div className="text-[10px] text-muted-foreground truncate">{g.group_url}</div>
              </div>
            </label>
          ))
        )}
      </div>
    </div>
  );
}

function PickKeywordsModal({
  onClose,
  onSelectKeywords,
}: {
  onClose: () => void;
  onSelectKeywords: (keywords: string[]) => void;
}) {
  const [topics, setTopics] = useState<KeywordTopic[]>([]);
  const [loadingTopics, setLoadingTopics] = useState(true);
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  const [keywords, setKeywords] = useState<KeywordItem[]>([]);
  const [loadingKeywords, setLoadingKeywords] = useState(false);
  const [checkedKeywords, setCheckedKeywords] = useState<Set<string>>(new Set());

  useEffect(() => {
    let active = true;
    allPlatformKeywordsService.getTopics().then((res) => {
      if (active) {
        setLoadingTopics(false);
        if (res.success && res.data) {
          setTopics(res.data);
          if (res.data.length > 0) {
            setSelectedTopicId(res.data[0].id);
          }
        }
      }
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedTopicId) return;
    let active = true;
    setLoadingKeywords(true);
    allPlatformKeywordsService.getKeywordsInTopic(selectedTopicId).then((res) => {
      if (active) {
        setLoadingKeywords(false);
        if (res.success && res.data) {
          setKeywords(res.data);
          setCheckedKeywords(new Set(res.data.map((k) => k.keyword)));
        } else {
          setKeywords([]);
          setCheckedKeywords(new Set());
        }
      }
    });
    return () => {
      active = false;
    };
  }, [selectedTopicId]);

  const toggleKeyword = (kw: string) => {
    setCheckedKeywords((prev) => {
      const next = new Set(prev);
      if (next.has(kw)) next.delete(kw);
      else next.add(kw);
      return next;
    });
  };

  const handleApply = () => {
    onSelectKeywords(Array.from(checkedKeywords));
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-border bg-card">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-[20px]">library_books</span>
            <h4 className="font-bold text-sm text-foreground">Chọn từ khóa từ Thư viện chủ đề</h4>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted cursor-pointer">
            <span className="material-symbols-outlined text-[18px] text-muted-foreground">close</span>
          </button>
        </div>

        <div className="p-4 flex-1 overflow-y-auto flex flex-col gap-3">
          <div>
            <label className="text-xs font-bold text-foreground block mb-1">Chủ đề từ khóa</label>
            {loadingTopics ? (
              <div className="text-xs text-muted-foreground py-2">Đang tải danh sách chủ đề...</div>
            ) : topics.length === 0 ? (
              <div className="text-xs text-muted-foreground py-2">Chưa có chủ đề nào trong Thư viện từ khóa.</div>
            ) : (
              <div className="flex gap-1.5 flex-wrap">
                {topics.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSelectedTopicId(t.id)}
                    className={cn(
                      "px-3 py-1.5 rounded-xl text-xs font-semibold border transition cursor-pointer flex items-center gap-1.5",
                      selectedTopicId === t.id
                        ? "bg-primary text-white border-primary shadow-sm"
                        : "bg-muted/30 text-foreground border-border hover:bg-muted/60"
                    )}
                  >
                    <span>{t.name}</span>
                    <span className="text-[10px] opacity-75">({t.keywords_count || 0})</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="mt-2">
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-bold text-foreground">
                Danh sách từ khóa ({checkedKeywords.size}/{keywords.length})
              </label>
              <div className="flex items-center gap-2 text-[11px]">
                <button
                  type="button"
                  onClick={() => setCheckedKeywords(new Set(keywords.map((k) => k.keyword)))}
                  className="text-primary hover:underline cursor-pointer"
                >
                  Chọn tất cả
                </button>
                <span>•</span>
                <button
                  type="button"
                  onClick={() => setCheckedKeywords(new Set())}
                  className="text-muted-foreground hover:underline cursor-pointer"
                >
                  Bỏ chọn
                </button>
              </div>
            </div>

            <div className="border border-border rounded-xl max-h-[220px] overflow-y-auto divide-y divide-border bg-muted/20">
              {loadingKeywords ? (
                <div className="p-4 text-center text-xs text-muted-foreground">Đang tải từ khóa...</div>
              ) : keywords.length === 0 ? (
                <div className="p-4 text-center text-xs text-muted-foreground">Chủ đề này chưa có từ khóa nào.</div>
              ) : (
                keywords.map((k) => (
                  <label
                    key={k.id}
                    className="flex items-center gap-2.5 p-2.5 hover:bg-muted/50 cursor-pointer transition text-xs"
                  >
                    <input
                      type="checkbox"
                      checked={checkedKeywords.has(k.keyword)}
                      onChange={() => toggleKeyword(k.keyword)}
                      className="rounded border-border text-primary"
                    />
                    <span className="font-medium text-foreground">{k.keyword}</span>
                    {k.contributor_name && (
                      <span className="ml-auto text-[10px] text-muted-foreground">bởi {k.contributor_name}</span>
                    )}
                  </label>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 p-3 border-t border-border bg-card">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-xl border border-border text-xs font-semibold text-foreground hover:bg-muted cursor-pointer"
          >
            Đóng
          </button>
          <button
            type="button"
            disabled={checkedKeywords.size === 0}
            onClick={handleApply}
            className="px-4 py-1.5 rounded-xl bg-primary text-white text-xs font-bold disabled:opacity-50 cursor-pointer shadow-sm flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[16px]">add_circle</span>
            <span>Chèn {checkedKeywords.size} từ khóa vào lịch</span>
          </button>
        </div>
      </div>
    </div>
  );
}
