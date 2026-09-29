"use client";

/**
 * Cào xoay vòng liên tục Facebook -> LinkedIn -> Threads -> lặp lại, đặt ở tab phụ
 * "Lịch crawl & Hàng đợi". Dành cho tài khoản seeding-crawl đăng nhập cố định trên VPS:
 * bấm "Bắt đầu cào xoay vòng" một lần, extension tự cào tuần tự cả 3 nền tảng rồi (nếu
 * bật "lặp lại") tự lên lịch vòng kế tiếp sau N giờ - CHỈ chạy tiếp nếu tài khoản vẫn
 * đang online trên app Seeding lúc đó. Bài viết cào được đổ thẳng về tab "Hoạt động seeding"
 * (dùng chung API lưu bài với "Cào bài viết" thủ công - MK_FB/LI/TH_CRAWL_* phía dưới).
 */

import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { useAppAuth } from "@/contexts/AppAuthContext";
import { allPlatformGroupsService } from "@/services/all-platform.service";
import {
  ROTATE_CRAWL_EXTENSION_VERSION,
  useRotationCrawl,
  useSeedingExtensionStatus,
  type RotationGroupInput,
  type RotationStage,
} from "./use-seeding-extension";

interface GroupOption {
  id: string;
  group_name?: string;
  group_url: string;
}

const KEYWORDS_STORAGE_KEY = "markee.rotationCrawl.keywords";
const INTERVAL_STORAGE_KEY = "markee.rotationCrawl.intervalHours";

const STAGE_LABEL: Record<RotationStage, string> = {
  idle: "Chưa chạy",
  starting: "Đang khởi động...",
  facebook: "Đang cào Facebook...",
  linkedin: "Đang cào LinkedIn...",
  threads: "Đang tìm Threads...",
  waiting_interval: "Đang chờ tới vòng kế tiếp",
  waiting_online: "Tạm dừng — tài khoản không online",
  stopped: "Đã dừng",
};

const STAGE_COLOR: Record<RotationStage, string> = {
  idle: "bg-slate-50 text-slate-600 border-slate-200",
  starting: "bg-blue-50 text-blue-700 border-blue-200",
  facebook: "bg-blue-50 text-blue-700 border-blue-200",
  linkedin: "bg-blue-50 text-blue-700 border-blue-200",
  threads: "bg-blue-50 text-blue-700 border-blue-200",
  waiting_interval: "bg-amber-50 text-amber-700 border-amber-200",
  waiting_online: "bg-red-50 text-red-600 border-red-200",
  stopped: "bg-slate-50 text-slate-600 border-slate-200",
};

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
  const { user } = useAppAuth();
  const { status, isReady, features } = useSeedingExtensionStatus();
  const rotation = useRotationCrawl();

  const fb = useGroupOptions("facebook");
  const li = useGroupOptions("linkedin");

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

  const keywords = useMemo(() => parseKeywords(keywordsInput), [keywordsInput]);
  const intervalHours = useMemo(() => {
    const v = Number(intervalInput);
    return Number.isFinite(v) && v > 0 ? v : 2;
  }, [intervalInput]);

  const needsUpdate = isReady && !features.includes("rotate_crawl");
  const totalSelected = fb.selectedIds.length + li.selectedIds.length + keywords.length;
  const canStart = isReady && !needsUpdate && !rotation.state.running && totalSelected > 0 && !!user?.id && !!user?.email;

  const handleStart = () => {
    if (!canStart || !user?.id || !user?.email) return;
    try {
      window.localStorage.setItem(KEYWORDS_STORAGE_KEY, keywordsInput);
      window.localStorage.setItem(INTERVAL_STORAGE_KEY, intervalInput);
    } catch {}
    const fbGroups: RotationGroupInput[] = fb.groups.filter((g) => fb.selectedIds.includes(g.id)).map((g) => ({ id: g.id, name: g.group_name || g.group_url, url: g.group_url }));
    const liGroups: RotationGroupInput[] = li.groups.filter((g) => li.selectedIds.includes(g.id)).map((g) => ({ id: g.id, name: g.group_name || g.group_url, url: g.group_url }));
    rotation.start(fbGroups, liGroups, keywords, {
      email: user.email,
      idMember: user.id,
      intervalHours,
      repeatEnabled,
    });
  };

  const nextRoundText = rotation.state.nextRoundAt ? new Date(rotation.state.nextRoundAt).toLocaleString("vi-VN") : null;

  return (
    <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden w-full">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-4 bg-muted/40">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 border border-primary/20">
            <span className="material-symbols-outlined text-primary text-[22px]">autorenew</span>
          </div>
          <div className="min-w-0">
            <h3 className="font-bold text-foreground text-sm leading-tight">Cào xoay vòng liên tục (Facebook → LinkedIn → Threads)</h3>
            <p className="text-xs text-muted-foreground leading-tight mt-0.5">
              Dành cho tài khoản seeding-crawl đăng nhập cố định trên VPS. Bấm 1 lần, chạy tuần tự cả 3 nền tảng rồi tự lặp lại sau
              mỗi N giờ — bài viết đổ thẳng về tab &quot;Hoạt động seeding&quot;.
            </p>
          </div>
        </div>
        <RotationStatusChip status={status} stage={rotation.state.stage} running={rotation.state.running} />
      </div>

      {status !== "ready" ? (
        <div className="mx-4 mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 leading-relaxed">
          Chưa kết nối được Markee Seeding Extension trên trình duyệt này — cài/khởi động lại extension rồi F5 lại trang.
        </div>
      ) : needsUpdate ? (
        <div className="mx-4 mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 leading-relaxed">
          Extension đang cài chưa có chức năng cào xoay vòng. Tải bản {ROTATE_CRAWL_EXTENSION_VERSION}+, giải nén đè lên thư mục cũ,
          vào chrome://extensions bấm reload (vòng tròn) trên Markee Seeding Extension rồi F5 lại trang này.
        </div>
      ) : null}

      {rotation.state.stage === "waiting_online" ? (
        <div className="mx-4 mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700 leading-relaxed font-semibold">
          ⚠️ Tài khoản seeding-crawl hiện KHÔNG online trên app Seeding (có thể đã đóng tab/tắt trình duyệt/tab Facebook-LinkedIn-Threads
          bị đóng giữa chừng, hoặc mất phiên đăng nhập). Vòng cào kế tiếp đang tạm hoãn — sẽ tự kiểm tra lại mỗi phút, chỉ chạy tiếp khi
          tài khoản online lại.
        </div>
      ) : null}

      {rotation.state.lastError ? (
        <div className="mx-4 mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700 leading-relaxed font-semibold">
          ⚠️ {rotation.state.lastError}
        </div>
      ) : null}

      <div className="p-4 flex flex-col gap-4">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <GroupPickList
            title="Nhóm Facebook"
            options={fb}
            disabled={rotation.state.running}
          />
          <GroupPickList
            title="Nhóm LinkedIn"
            options={li}
            disabled={rotation.state.running}
          />
          <div className="flex flex-col gap-2 min-w-0">
            <label htmlFor="rotation-threads-keywords" className="text-sm font-bold text-foreground">
              Từ khoá Threads ({keywords.length})
            </label>
            <textarea
              id="rotation-threads-keywords"
              rows={5}
              value={keywordsInput}
              onChange={(e) => setKeywordsInput(e.target.value)}
              disabled={rotation.state.running}
              placeholder={"Mỗi dòng 1 từ khoá (hoặc cách nhau bởi dấu phẩy)\nVD: thuê làm website, cần agency app"}
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs outline-none focus:border-primary disabled:opacity-60"
            />
            <p className="text-[10px] text-muted-foreground">Threads không có nhóm — tìm theo từ khoá, nhập lại mỗi lần bắt đầu (trình duyệt tự nhớ lần trước).</p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 border-t border-border pt-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="rotation-interval" className="text-xs font-bold text-foreground">Lặp lại sau (giờ)</label>
            <input
              id="rotation-interval"
              type="number"
              min={0.25}
              step={0.25}
              value={intervalInput}
              onChange={(e) => setIntervalInput(e.target.value)}
              disabled={rotation.state.running}
              className="w-28 rounded-lg border border-border bg-background px-3 py-2 text-xs outline-none focus:border-primary disabled:opacity-60"
            />
          </div>
          <label className="flex items-start gap-2 text-xs text-foreground cursor-pointer mt-1 sm:mt-5">
            <input
              type="checkbox"
              checked={repeatEnabled}
              onChange={(e) => setRepeatEnabled(e.target.checked)}
              disabled={rotation.state.running}
              className="mt-0.5 h-4 w-4 rounded border-border"
            />
            <span>Tự động lặp lại (chỉ chạy tiếp nếu tài khoản đang online trên app Seeding)</span>
          </label>
          <div className="flex-1" />
          {rotation.state.running ? (
            <button
              type="button"
              onClick={rotation.stop}
              disabled={rotation.state.stopping}
              className="px-5 py-2.5 rounded-xl bg-red-50 text-red-700 hover:bg-red-100 border border-red-200 text-sm font-bold disabled:opacity-50"
            >
              {rotation.state.stopping ? "Đang dừng..." : "Dừng cào xoay vòng"}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleStart}
              disabled={!canStart}
              className="px-5 py-2.5 rounded-xl bg-primary text-white hover:bg-primary/90 text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Bắt đầu cào xoay vòng
            </button>
          )}
        </div>

        {rotation.state.running || rotation.state.stage === "stopped" || rotation.state.logs.length > 0 ? (
          <div className="flex flex-col gap-3 border-t border-border pt-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Stat label="Trạng thái" value={STAGE_LABEL[rotation.state.stage] || rotation.state.stage} />
              <Stat label="Vòng hiện tại" value={String(rotation.state.roundNumber || "—")} />
              <Stat label="Vòng kế tiếp lúc" value={nextRoundText || "—"} />
              <Stat
                label="Vòng gần nhất"
                value={rotation.state.lastRoundSummary ? `+${rotation.state.lastRoundSummary.totalSaved} bài` : "—"}
                highlight
              />
            </div>
            <div className="bg-slate-900 rounded-xl p-3 font-mono text-[11px] max-h-[220px] overflow-y-auto">
              {rotation.state.logs.slice(-60).map((line, i) => (
                <div key={`${line.at}-${i}`} className={LOG_COLOR[line.level] || LOG_COLOR.info}>
                  {line.message}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="text-[11px] text-muted-foreground leading-relaxed border-t border-border pt-3">
          Lưu ý: danh sách nhóm Facebook/LinkedIn được chốt lại lúc bấm &quot;Bắt đầu&quot; — thêm nhóm mới ở trang Quản lý nhóm thì
          cần Dừng rồi Bắt đầu lại mới được cào. Nếu tab Facebook/LinkedIn/Threads hoặc tab app Seeding bị đóng giữa lúc đang cào, hệ
          thống sẽ báo lỗi rõ ràng ở log phía trên và tự dừng vòng đó lại (LinkedIn giữ được tiến độ đang cào dở, Facebook/Threads cào
          lại từ đầu nhóm/từ khoá đang dở ở vòng kế tiếp).
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

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={cn("rounded-xl p-2.5 text-center border", highlight ? "bg-emerald-50 border-emerald-100" : "bg-muted/50 border-border")}>
      <div className={cn("text-sm font-bold truncate", highlight ? "text-emerald-700" : "text-foreground")} title={value}>{value}</div>
      <div className="text-[10px] text-muted-foreground font-medium">{label}</div>
    </div>
  );
}

function RotationStatusChip({ status, stage, running }: { status: string; stage: RotationStage; running: boolean }) {
  if (status !== "ready") {
    return <span className="px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-[10px] font-bold border border-border">Chưa kết nối extension</span>;
  }
  if (!running) {
    return <span className="px-2 py-0.5 rounded-full bg-slate-50 text-slate-600 text-[10px] font-bold border border-slate-200">Đang tắt</span>;
  }
  return (
    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border", STAGE_COLOR[stage])}>
      <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
      {STAGE_LABEL[stage] || stage}
    </span>
  );
}
