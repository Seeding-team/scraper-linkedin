"use client";

/**
 * Nhiều lịch cào xoay vòng độc lập (Facebook → LinkedIn → Threads → lặp lại), đặt ở tab
 * phụ "Lịch crawl & Hàng đợi". Dành cho tài khoản seeding-crawl đăng nhập cố định trên VPS:
 * bấm "+ Thêm lịch cào" để tạo 1 lịch mới (nhóm/từ khoá + giờ lặp lại riêng) — extension tự
 * cào tuần tự cả 3 nền tảng rồi (nếu bật "lặp lại") tự lên lịch vòng kế tiếp, CHỈ chạy tiếp
 * nếu tab Seeding vẫn còn mở (không cần hiển thị/active — chạy nền vẫn tính). Chỉ 1 lịch
 * chạy tại 1 thời điểm (đúng tinh
 * thần "hàng đợi") — lịch nào đến giờ trước chạy trước, xong tự chạy tiếp lịch kế đến giờ.
 * Bài viết cào được đổ thẳng về tab "Hoạt động seeding".
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useAppAuth } from "@/contexts/AppAuthContext";
import { allPlatformGroupsService } from "@/services/all-platform.service";
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

// Ước tính thời gian cào TRUNG BÌNH 1 nhóm/từ khoá (giây) — suy từ các bước cố định trong
// bg/fb-crawl.js, bg/li-crawl.js, bg/threads-crawl.js (reload trang, settle, cuộn lấy bài,
// lưu backend...) cộng thêm biên an toàn cho mạng/Facebook-LinkedIn phản hồi chậm hơn bình
// thường. Dùng để tính mốc "lặp lại tối thiểu" — đảm bảo 1 vòng luôn cào XONG HẾT danh sách
// đã chọn rồi mới lặp lại, không bị chồng vòng giữa chừng.
const EST_SECONDS_PER_FB_GROUP = 60;
const EST_SECONDS_PER_LI_GROUP = 120;
const EST_SECONDS_PER_TH_KEYWORD = 40;
// Biên an toàn 20% cho thời gian chờ "online"/khởi động tab giữa các nhóm.
const MIN_INTERVAL_SAFETY_FACTOR = 1.2;

function estimateRoundSeconds(fbCount: number, liCount: number, thCount: number): number {
  return fbCount * EST_SECONDS_PER_FB_GROUP + liCount * EST_SECONDS_PER_LI_GROUP + thCount * EST_SECONDS_PER_TH_KEYWORD;
}

function minIntervalHoursForSeconds(seconds: number): number {
  const hours = (seconds * MIN_INTERVAL_SAFETY_FACTOR) / 3600;
  // Làm tròn LÊN tới mốc 0.25 giờ gần nhất, tối thiểu 0.25 giờ.
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
    const stageLabel = s.currentStage === "facebook" ? "Đang cào Facebook..." : s.currentStage === "linkedin" ? "Đang cào LinkedIn..." : s.currentStage === "threads" ? "Đang tìm Threads..." : "Đang chạy...";
    return { label: stageLabel, color: "bg-blue-50 text-blue-700 border-blue-200" };
  }
  if (s.status === "waiting_online") return { label: "Tạm dừng — tab Seeding đã đóng", color: "bg-red-50 text-red-600 border-red-200" };
  if (s.status === "waiting_interval") return { label: "Đang chờ vòng kế tiếp", color: "bg-amber-50 text-amber-700 border-amber-200" };
  if (s.status === "done") return { label: "Đã hoàn tất (không lặp lại)", color: "bg-slate-50 text-slate-600 border-slate-200" };
  return { label: "Đã dừng", color: "bg-slate-50 text-slate-600 border-slate-200" };
}

function platformsSummary(s: RotationSchedule): string {
  const parts: string[] = [];
  if (s.cfg.fbGroups.length) parts.push(`Facebook: ${s.cfg.fbGroups.length} nhóm`);
  if (s.cfg.liGroups.length) parts.push(`LinkedIn: ${s.cfg.liGroups.length} nhóm`);
  if (s.cfg.threadsKeywords.length) parts.push(`Threads: ${s.cfg.threadsKeywords.length} từ khoá`);
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

export function RotationCrawlPanel() {
  const { status, isReady, features } = useSeedingExtensionStatus();
  const rot = useRotationSchedules();
  const [showAddModal, setShowAddModal] = useState(false);

  const needsUpdate = isReady && !features.includes("rotate_crawl");
  const canAdd = isReady && !needsUpdate;

  return (
    <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden w-full">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-4 bg-muted/40">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 border border-primary/20">
            <span className="material-symbols-outlined text-primary text-[22px]">autorenew</span>
          </div>
          <div className="min-w-0">
            <h3 className="font-bold text-foreground text-sm leading-tight">Lịch cào xoay vòng (Facebook → LinkedIn → Threads)</h3>
            <p className="text-xs text-muted-foreground leading-tight mt-0.5">
              Dành cho tài khoản seeding-crawl đăng nhập cố định trên VPS. Thêm nhiều lịch độc lập — bài viết đổ thẳng về tab &quot;Hoạt động seeding&quot;.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowAddModal(true)}
          disabled={!canAdd}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-white text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
        >
          <span className="material-symbols-outlined text-[18px]">add_circle</span>
          Thêm lịch cào
        </button>
      </div>

      {status !== "ready" ? (
        <div className="mx-4 mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 leading-relaxed">
          Chưa kết nối được Markee Seeding Extension trên trình duyệt này — cài/khởi động lại extension rồi F5 lại trang.
        </div>
      ) : needsUpdate ? (
        <div className="mx-4 mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 leading-relaxed">
          Extension đang cài chưa có chức năng lịch cào (nhiều lịch). Tải bản {ROTATE_CRAWL_EXTENSION_VERSION}+, giải nén đè lên thư mục
          cũ, vào chrome://extensions bấm reload (vòng tròn) trên Markee Seeding Extension rồi F5 lại trang này.
        </div>
      ) : null}

      <div className="p-4 flex flex-col gap-3">
        {rot.loaded && rot.schedules.length === 0 ? (
          <div className="text-center py-8 text-sm text-muted-foreground">
            Chưa có lịch cào nào. Bấm &quot;Thêm lịch cào&quot; để tạo lịch đầu tiên.
          </div>
        ) : (
          rot.schedules
            .slice()
            .sort((a, b) => b.createdAt - a.createdAt)
            .map((s) => <ScheduleCard key={s.id} schedule={s} onToggle={rot.toggleSchedule} onStop={rot.stopSchedule} onDelete={rot.deleteSchedule} />)
        )}

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

      {showAddModal ? <AddScheduleModal onClose={() => setShowAddModal(false)} addSchedule={rot.addSchedule} /> : null}
    </div>
  );
}

function ScheduleCard({
  schedule,
  onToggle,
  onStop,
  onDelete,
}: {
  schedule: RotationSchedule;
  onToggle: (id: string, enabled: boolean) => void;
  onStop: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const meta = scheduleStatusMeta(schedule);
  const nextRunText = schedule.nextRunAt ? new Date(schedule.nextRunAt).toLocaleString("vi-VN") : null;
  const isActive = schedule.status === "running" || schedule.status === "waiting_interval" || schedule.status === "waiting_online";

  const handleDelete = () => {
    if (!window.confirm(`Xoá lịch cào "${schedule.label}"? Nếu đang chạy sẽ dừng ngay.`)) return;
    onDelete(schedule.id);
  };

  return (
    <div className="border border-border rounded-xl p-3.5 flex flex-col gap-2.5">
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
            <span>Lặp lại: {schedule.cfg.repeatEnabled ? `mỗi ${schedule.cfg.intervalHours} giờ` : "chỉ 1 lần"}</span>
            <span>Vòng: {schedule.roundNumber || 0}</span>
            {nextRunText && schedule.status === "waiting_interval" ? <span>Vòng kế tiếp: {nextRunText}</span> : null}
            {schedule.lastRoundSummary ? <span className="font-semibold text-emerald-600">Lần gần nhất: +{schedule.lastRoundSummary.totalSaved} bài</span> : null}
          </div>
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
            <button type="button" onClick={() => onStop(schedule.id)} className="p-1.5 rounded-lg hover:bg-red-50" title="Dừng lịch này">
              <span className="material-symbols-outlined text-[16px] text-red-500">stop_circle</span>
            </button>
          ) : null}
          <button type="button" onClick={handleDelete} className="p-1.5 rounded-lg hover:bg-red-50" title="Xoá lịch">
            <span className="material-symbols-outlined text-[16px] text-muted-foreground hover:text-red-600">delete</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function AddScheduleModal({
  onClose,
  addSchedule,
}: {
  onClose: () => void;
  addSchedule: (label: string, fbGroups: RotationGroupInput[], liGroups: RotationGroupInput[], threadsKeywords: string[], config: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>;
}) {
  const { user } = useAppAuth();
  const fb = useGroupOptions("facebook");
  const li = useGroupOptions("linkedin");

  // Mặc định chỉ bật Facebook (ưu tiên cào Facebook trước) — bấm chọn thêm
  // LinkedIn/Threads nếu muốn xoay vòng luôn cả 2 nền tảng kia trong CÙNG 1 lịch.
  const [enabledPlatforms, setEnabledPlatforms] = useState<Set<"facebook" | "linkedin" | "threads">>(
    () => new Set(["facebook"]),
  );
  const togglePlatform = (p: "facebook" | "linkedin" | "threads") =>
    setEnabledPlatforms((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });

  const [label, setLabel] = useState("");
  const [keywordsInput, setKeywordsInput] = useState(() => {
    if (typeof window === "undefined") return "";
    try {
      return window.localStorage.getItem(KEYWORDS_STORAGE_KEY) || "";
    } catch {
      return "";
    }
  });
  const [intervalInput, setIntervalInput] = useState(() => {
    if (typeof window === "undefined") return "2";
    try {
      return window.localStorage.getItem(INTERVAL_STORAGE_KEY) || "2";
    } catch {
      return "2";
    }
  });
  const [repeatEnabled, setRepeatEnabled] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const keywords = useMemo(() => parseKeywords(keywordsInput), [keywordsInput]);
  const intervalHours = useMemo(() => {
    const v = Number(intervalInput);
    return Number.isFinite(v) && v > 0 ? v : 2;
  }, [intervalInput]);

  const fbCount = enabledPlatforms.has("facebook") ? fb.selectedIds.length : 0;
  const liCount = enabledPlatforms.has("linkedin") ? li.selectedIds.length : 0;
  const thCount = enabledPlatforms.has("threads") ? keywords.length : 0;
  const totalSelected = fbCount + liCount + thCount;

  // Lặp lại tối thiểu phải đủ để cào XONG HẾT danh sách đã chọn trước khi vòng kế tiếp bắt
  // đầu — không thì vòng lặp lại sẽ "giẫm" lên vòng đang chạy dở. Tự gợi ý mốc tối thiểu khi
  // đổi lựa chọn nhóm/từ khoá, nhưng không ép xuống nếu người dùng đã tự đặt cao hơn.
  const estimatedSeconds = useMemo(() => estimateRoundSeconds(fbCount, liCount, thCount), [fbCount, liCount, thCount]);
  const minIntervalHours = useMemo(() => minIntervalHoursForSeconds(estimatedSeconds), [estimatedSeconds]);
  const intervalTooLow = repeatEnabled && totalSelected > 0 && intervalHours < minIntervalHours;

  const lastAutoSuggestedRef = useRef<number | null>(null);
  useEffect(() => {
    if (totalSelected === 0) return;
    const current = Number(intervalInput);
    // Chỉ tự nâng lên khi ô đang bằng giá trị MÌNH đã tự gợi ý lần trước (hoặc rỗng/0) —
    // nếu người dùng đã tự tay sửa thành 1 số khác thì tôn trọng lựa chọn đó, không ghi đè.
    const userOverrode = Number.isFinite(current) && current > 0 && lastAutoSuggestedRef.current !== null && current !== lastAutoSuggestedRef.current;
    if (userOverrode) return;
    if (!Number.isFinite(current) || current < minIntervalHours) {
      setIntervalInput(String(minIntervalHours));
      lastAutoSuggestedRef.current = minIntervalHours;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minIntervalHours, totalSelected]);

  const canSubmit = totalSelected > 0 && !!user?.id && !!user?.email && !submitting && !intervalTooLow;

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
    const res = await addSchedule(label.trim(), fbGroups, liGroups, threadsKeywords, {
      email: user.email,
      idMember: user.id,
      intervalHours,
      repeatEnabled,
    });
    setSubmitting(false);
    if (!res.success) {
      setError(res.error || "Không tạo được lịch cào.");
      return;
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-2xl border border-border shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-border sticky top-0 bg-card z-10">
          <h3 className="font-bold text-base text-foreground">Thêm lịch cào xoay vòng</h3>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted">
            <span className="material-symbols-outlined text-[18px] text-muted-foreground">close</span>
          </button>
        </div>

        <div className="p-4 flex flex-col gap-4">
          <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-3 flex items-start gap-2.5">
            <span className="material-symbols-outlined text-amber-600 text-[22px] shrink-0">warning</span>
            <div className="text-xs text-amber-900 leading-relaxed">
              <p className="font-bold mb-1">Để lịch cào chạy ổn định, bắt buộc:</p>
              <ul className="list-disc pl-4 space-y-0.5">
                <li>Luôn giữ <b>tab trình duyệt mở trang Seeding này</b> (không đóng, không tắt trình duyệt) trong suốt thời gian cào.</li>
                <li><b>Không đóng tab Facebook/LinkedIn/Threads</b> khi lịch đang chạy — extension tự mở/điều khiển các tab đó, đóng giữa chừng sẽ làm gián đoạn vòng cào.</li>
                <li>Chỉ cần <b>giữ tab Seeding còn mở</b> là đủ — có thể bật tab khác để làm việc, không cần để tab Seeding hiển thị/active, extension vẫn tự chạy nền và vòng cào xoay vòng vẫn tiếp tục bình thường.</li>
              </ul>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-foreground">Tên lịch (không bắt buộc)</label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="VD: Nhóm khách hàng website"
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-foreground">Chọn nền tảng muốn xoay vòng</label>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  { key: "facebook" as const, label: "Facebook", icon: "📘" },
                  { key: "linkedin" as const, label: "LinkedIn", icon: "💼" },
                  { key: "threads" as const, label: "Threads", icon: "🧵" },
                ]
              ).map((p) => {
                const active = enabledPlatforms.has(p.key);
                return (
                  <button
                    key={p.key}
                    type="button"
                    disabled={submitting}
                    onClick={() => togglePlatform(p.key)}
                    className={cn(
                      "inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold border-2 transition-colors disabled:opacity-60",
                      active ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-muted-foreground hover:bg-muted",
                    )}
                  >
                    <span>{p.icon}</span>
                    {p.label}
                    {active ? <span className="material-symbols-outlined text-[14px]">check_circle</span> : null}
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] text-muted-foreground">
              Mặc định chỉ bật Facebook (ưu tiên cào Facebook trước) — bấm chọn thêm nền tảng nếu muốn xoay vòng cả Facebook → LinkedIn → Threads trong cùng 1 lịch.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className={cn("transition-opacity", !enabledPlatforms.has("facebook") && "opacity-40")}>
              <GroupPickList title="Nhóm Facebook" options={fb} disabled={submitting || !enabledPlatforms.has("facebook")} />
            </div>
            <div className={cn("transition-opacity", !enabledPlatforms.has("linkedin") && "opacity-40")}>
              <GroupPickList title="Nhóm LinkedIn" options={li} disabled={submitting || !enabledPlatforms.has("linkedin")} />
            </div>
            <div className={cn("flex flex-col gap-2 min-w-0 transition-opacity", !enabledPlatforms.has("threads") && "opacity-40")}>
              <label htmlFor="rotation-threads-keywords" className="text-sm font-bold text-foreground">
                Từ khoá Threads ({keywords.length})
              </label>
              <textarea
                id="rotation-threads-keywords"
                rows={5}
                value={keywordsInput}
                onChange={(e) => setKeywordsInput(e.target.value)}
                disabled={submitting || !enabledPlatforms.has("threads")}
                placeholder={"Mỗi dòng 1 từ khoá (hoặc cách nhau bởi dấu phẩy)\nVD: thuê làm website, cần agency app"}
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs outline-none focus:border-primary disabled:opacity-60"
              />
              <p className="text-[10px] text-muted-foreground">Threads không có nhóm — tìm theo từ khoá.</p>
            </div>
          </div>

          {totalSelected > 0 ? (
            <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900 leading-relaxed flex items-start gap-2">
              <span className="material-symbols-outlined text-sky-600 text-[18px] shrink-0">schedule</span>
              <div>
                <p>
                  Ước tính 1 vòng cào hết <b>{fbCount > 0 ? `${fbCount} nhóm Facebook` : ""}{fbCount > 0 && (liCount > 0 || thCount > 0) ? ", " : ""}{liCount > 0 ? `${liCount} nhóm LinkedIn` : ""}{liCount > 0 && thCount > 0 ? ", " : ""}{thCount > 0 ? `${thCount} từ khoá Threads` : ""}</b> mất khoảng <b>{formatDuration(estimatedSeconds)}</b>.
                </p>
                <p className="mt-0.5">Lặp lại nên đặt tối thiểu <b>{minIntervalHours} giờ</b> để chắc chắn cào xong hết trước khi vòng kế tiếp bắt đầu.</p>
              </div>
            </div>
          ) : null}

          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 border-t border-border pt-4">
            <div className="flex flex-col gap-1">
              <label htmlFor="rotation-interval" className="text-xs font-bold text-foreground">
                Lặp lại sau (giờ)
              </label>
              <input
                id="rotation-interval"
                type="number"
                min={0.25}
                step={0.25}
                value={intervalInput}
                onChange={(e) => setIntervalInput(e.target.value)}
                disabled={submitting}
                className={cn(
                  "w-28 rounded-lg border bg-background px-3 py-2 text-xs outline-none focus:border-primary disabled:opacity-60",
                  intervalTooLow ? "border-red-300" : "border-border",
                )}
              />
              {intervalTooLow ? (
                <p className="text-[10px] text-red-600 font-semibold max-w-[220px]">
                  Thấp hơn mức tối thiểu ({minIntervalHours} giờ) cho số nhóm/từ khoá đã chọn — vòng sau có thể bắt đầu khi vòng trước chưa cào xong.
                </p>
              ) : null}
            </div>
            <label className="flex items-start gap-2 text-xs text-foreground cursor-pointer mt-1 sm:mt-5">
              <input
                type="checkbox"
                checked={repeatEnabled}
                onChange={(e) => setRepeatEnabled(e.target.checked)}
                disabled={submitting}
                className="mt-0.5 h-4 w-4 rounded border-border"
              />
              <span>Tự động lặp lại (chỉ chạy tiếp nếu tab Seeding vẫn còn mở)</span>
            </label>
          </div>

          {error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-2.5 text-xs text-red-700 flex items-start gap-1.5">
              <span className="material-symbols-outlined text-[16px] shrink-0">error</span>
              {error}
            </div>
          ) : null}

          <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl border border-border text-sm font-semibold text-muted-foreground hover:bg-muted">
              Huỷ
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="px-5 py-2 rounded-xl bg-primary text-white text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
            >
              {submitting ? <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : <span className="material-symbols-outlined text-[18px]">add_circle</span>}
              {submitting ? "Đang tạo..." : "Tạo lịch cào"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function GroupPickList({ title, options, disabled }: { title: string; options: ReturnType<typeof useGroupOptions>; disabled: boolean }) {
  const { groups, selectedIds, setSelectedIds, toggle, loading, error } = options;
  return (
    <div className="flex flex-col gap-2 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <label className="text-sm font-bold text-foreground">
          {title} ({selectedIds.length}/{groups.length})
        </label>
        <div className="flex items-center gap-3 text-[11px] font-semibold">
          <button type="button" className="text-primary hover:underline disabled:opacity-50" disabled={disabled} onClick={() => setSelectedIds(groups.map((g) => g.id))}>
            Chọn tất cả
          </button>
          <button type="button" className="text-muted-foreground hover:underline disabled:opacity-50" disabled={disabled} onClick={() => setSelectedIds([])}>
            Bỏ chọn
          </button>
        </div>
      </div>
      <div className="border border-border rounded-xl max-h-[170px] overflow-y-auto divide-y divide-border bg-muted/30">
        {loading ? (
          <div className="p-3 text-center text-xs text-muted-foreground">Đang tải...</div>
        ) : error ? (
          <div className="p-3 text-center text-xs text-red-600">{error}</div>
        ) : groups.length === 0 ? (
          <div className="p-3 text-center text-xs text-muted-foreground">Chưa có nhóm nào.</div>
        ) : (
          groups.map((g) => (
            <label key={g.id} className={cn("flex items-start gap-2 p-2 cursor-pointer hover:bg-muted/60", disabled && "opacity-60 pointer-events-none")}>
              <input type="checkbox" className="mt-0.5 rounded border-border" checked={selectedIds.includes(g.id)} onChange={() => toggle(g.id)} />
              <div className="min-w-0">
                <div className="text-xs font-semibold text-foreground line-clamp-1">{g.group_name || g.group_url}</div>
                <div className="text-[10px] text-muted-foreground truncate">{g.group_url}</div>
              </div>
            </label>
          ))
        )}
      </div>
    </div>
  );
}
