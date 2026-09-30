"use client";

/**
 * Nhiều lịch cào xoay vòng độc lập (Facebook → LinkedIn → Threads → lặp lại), đặt ở tab
 * phụ "Lịch crawl & Hàng đợi". Dành cho tài khoản seeding-crawl đăng nhập cố định trên VPS:
 * bấm "+ Thêm lịch cào" để tạo 1 lịch mới (nhóm/từ khoá + giờ lặp lại riêng) — extension tự
 * cào tuần tự cả 3 nền tảng rồi (nếu bật "lặp lại") tự lên lịch vòng kế tiếp, CHỈ chạy tiếp
 * nếu tài khoản vẫn đang online trên app Seeding. Chỉ 1 lịch chạy tại 1 thời điểm (đúng tinh
 * thần "hàng đợi") — lịch nào đến giờ trước chạy trước, xong tự chạy tiếp lịch kế đến giờ.
 * Bài viết cào được đổ thẳng về tab "Hoạt động seeding".
 */

import { useEffect, useMemo, useState } from "react";
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
  if (s.status === "waiting_online") return { label: "Tạm dừng — tài khoản không online", color: "bg-red-50 text-red-600 border-red-200" };
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

  const totalSelected = fb.selectedIds.length + li.selectedIds.length + keywords.length;
  const canSubmit = totalSelected > 0 && !!user?.id && !!user?.email && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit || !user?.id || !user?.email) return;
    setSubmitting(true);
    setError(null);
    try {
      window.localStorage.setItem(KEYWORDS_STORAGE_KEY, keywordsInput);
      window.localStorage.setItem(INTERVAL_STORAGE_KEY, intervalInput);
    } catch {}
    const fbGroups: RotationGroupInput[] = fb.groups.filter((g) => fb.selectedIds.includes(g.id)).map((g) => ({ id: g.id, name: g.group_name || g.group_url, url: g.group_url }));
    const liGroups: RotationGroupInput[] = li.groups.filter((g) => li.selectedIds.includes(g.id)).map((g) => ({ id: g.id, name: g.group_name || g.group_url, url: g.group_url }));
    const res = await addSchedule(label.trim(), fbGroups, liGroups, keywords, {
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
                <li>Máy/VPS phải giữ trạng thái đăng nhập tài khoản Seeding — mất phiên đăng nhập thì vòng lặp lại sẽ tự tạm hoãn tới khi online lại.</li>
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

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <GroupPickList title="Nhóm Facebook" options={fb} disabled={submitting} />
            <GroupPickList title="Nhóm LinkedIn" options={li} disabled={submitting} />
            <div className="flex flex-col gap-2 min-w-0">
              <label htmlFor="rotation-threads-keywords" className="text-sm font-bold text-foreground">
                Từ khoá Threads ({keywords.length})
              </label>
              <textarea
                id="rotation-threads-keywords"
                rows={5}
                value={keywordsInput}
                onChange={(e) => setKeywordsInput(e.target.value)}
                disabled={submitting}
                placeholder={"Mỗi dòng 1 từ khoá (hoặc cách nhau bởi dấu phẩy)\nVD: thuê làm website, cần agency app"}
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs outline-none focus:border-primary disabled:opacity-60"
              />
              <p className="text-[10px] text-muted-foreground">Threads không có nhóm — tìm theo từ khoá.</p>
            </div>
          </div>

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
                className="w-28 rounded-lg border border-border bg-background px-3 py-2 text-xs outline-none focus:border-primary disabled:opacity-60"
              />
            </div>
            <label className="flex items-start gap-2 text-xs text-foreground cursor-pointer mt-1 sm:mt-5">
              <input
                type="checkbox"
                checked={repeatEnabled}
                onChange={(e) => setRepeatEnabled(e.target.checked)}
                disabled={submitting}
                className="mt-0.5 h-4 w-4 rounded border-border"
              />
              <span>Tự động lặp lại (chỉ chạy tiếp nếu tài khoản đang online trên app Seeding)</span>
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
