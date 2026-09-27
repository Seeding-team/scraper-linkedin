"use client";

import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { allPlatformGroupsService } from "@/services/all-platform.service";
import { useAppAuth } from "@/contexts/AppAuthContext";
import type { CrawlGroupInput, CrawlRuntime, GroupPlatform } from "./use-seeding-extension";

interface GroupOption {
  id: string;
  group_name?: string;
  group_url: string;
}

interface CrawlSectionProps {
  platform: GroupPlatform;
  isReady: boolean;
  runtime: CrawlRuntime;
  onStart: (groups: CrawlGroupInput[], config: Record<string, unknown>) => void;
  onStop: () => void;
  onReset: () => void;
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

export function CrawlSection({ platform, isReady, runtime, onStart, onStop, onReset }: CrawlSectionProps) {
  const { user } = useAppAuth();
  const [groups, setGroups] = useState<GroupOption[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isLoadingGroups, setIsLoadingGroups] = useState(true);
  const [groupsError, setGroupsError] = useState<string | null>(null);
  const [keywordsInput, setKeywordsInput] = useState("");
  const [limitInput, setLimitInput] = useState("");

  const isFacebook = platform === "facebook";
  const platformLabel = isFacebook ? "Facebook" : "LinkedIn";

  useEffect(() => {
    // Component được remount theo key={platform} ở panel nên không cần reset state ở đây.
    let cancelled = false;
    allPlatformGroupsService
      .getForExtension(platform)
      .then((res) => {
        if (cancelled) return;
        if (res.success === false) {
          setGroupsError(res.message || "Không tải được danh sách nhóm.");
          setGroups([]);
          setSelectedIds([]);
          return;
        }
        const list = ((res.data as GroupOption[] | undefined) || []).filter((g) => g && g.id && g.group_url);
        setGroups(list);
        setSelectedIds(list.map((g) => g.id));
      })
      .catch((e) => !cancelled && setGroupsError(e instanceof Error ? e.message : "Không tải được danh sách nhóm."))
      .finally(() => !cancelled && setIsLoadingGroups(false));
    return () => {
      cancelled = true;
    };
  }, [platform]);

  const keywords = useMemo(() => parseKeywords(keywordsInput), [keywordsInput]);
  const limit = useMemo(() => {
    const v = Math.floor(Number(limitInput));
    return limitInput.trim() && v > 0 ? v : null;
  }, [limitInput]);

  const canStart = isReady && !runtime.running && selectedIds.length > 0 && !!user?.id;

  const handleStart = () => {
    if (!canStart || !user?.id) return;
    const picked = groups.filter((g) => selectedIds.includes(g.id));
    const payload: CrawlGroupInput[] = picked.map((g) => ({
      id: g.id,
      name: g.group_name || g.group_url,
      url: g.group_url,
      ...(isFacebook ? { keywords: keywords.length ? keywords : null, post_limit: limit } : {}),
    }));
    onStart(payload, isFacebook ? { idMember: user.id, fetchCount: 100 } : { idMember: user.id, maxPosts: limit || 40 });
  };

  const toggle = (id: string) =>
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const progressPct =
    runtime.totalGroups > 0 ? Math.min(100, Math.round(((runtime.groupIndex + (runtime.done ? 1 : 0)) / runtime.totalGroups) * 100)) : 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-3 flex flex-col gap-2 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <label className="text-sm font-bold text-foreground">
              Nhóm {platformLabel} cần cào ({selectedIds.length}/{groups.length})
            </label>
            <div className="flex items-center gap-3 text-xs font-semibold">
              <button type="button" className="text-primary hover:underline disabled:opacity-50" disabled={runtime.running} onClick={() => setSelectedIds(groups.map((g) => g.id))}>
                Chọn tất cả
              </button>
              <button type="button" className="text-muted-foreground hover:underline disabled:opacity-50" disabled={runtime.running} onClick={() => setSelectedIds([])}>
                Bỏ chọn
              </button>
            </div>
          </div>
          <div className="border border-border rounded-xl max-h-[220px] overflow-y-auto divide-y divide-border bg-muted/30">
            {isLoadingGroups ? (
              <div className="p-4 text-center text-sm text-muted-foreground">Đang tải danh sách nhóm...</div>
            ) : groupsError ? (
              <div className="p-4 text-center text-sm text-red-600">{groupsError}</div>
            ) : groups.length === 0 ? (
              <div className="p-4 text-center text-sm text-muted-foreground">
                Bạn chưa có nhóm {platformLabel} nào. Thêm nhóm ở trang Quản lý nhóm rồi quay lại đây.
              </div>
            ) : (
              groups.map((g) => (
                <label key={g.id} className={cn("flex items-start gap-3 p-2.5 cursor-pointer hover:bg-muted/60", runtime.running && "opacity-60 pointer-events-none")}>
                  <input type="checkbox" className="mt-0.5 rounded border-border" checked={selectedIds.includes(g.id)} onChange={() => toggle(g.id)} />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-foreground line-clamp-1">{g.group_name || g.group_url}</div>
                    <div className="text-[10px] text-muted-foreground truncate">{g.group_url}</div>
                  </div>
                </label>
              ))
            )}
          </div>
        </div>

        <div className="lg:col-span-2 flex flex-col gap-3">
          {isFacebook ? (
            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-foreground">Từ khoá lọc bài (không bắt buộc)</label>
              <input
                type="text"
                value={keywordsInput}
                onChange={(e) => setKeywordsInput(e.target.value)}
                disabled={runtime.running}
                placeholder="VD: tuyển dụng, marketing"
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-xs outline-none focus:border-primary"
              />
            </div>
          ) : null}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-foreground">
              {isFacebook ? "Số bài muốn lưu mỗi nhóm (không bắt buộc)" : "Số bài tối đa mỗi nhóm (mặc định 40)"}
            </label>
            <input
              type="number"
              min={1}
              value={limitInput}
              onChange={(e) => setLimitInput(e.target.value)}
              disabled={runtime.running}
              placeholder={isFacebook ? "VD: 20" : "40"}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-xs outline-none focus:border-primary"
            />
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            {isFacebook
              ? "Extension mở 1 tab Facebook, lấy bài qua GraphQL API của chính tài khoản đang đăng nhập trình duyệt rồi tự lưu về hệ thống."
              : "Extension mở 1 tab LinkedIn, tự cuộn feed nhóm để lấy bài (kèm số like/comment, nội dung bình luận) bằng tài khoản LinkedIn đang đăng nhập."}
          </p>
          <div className="flex items-center gap-2 mt-auto">
            {runtime.running ? (
              <button type="button" onClick={onStop} className="flex-1 px-4 py-2 rounded-xl bg-red-50 text-red-700 hover:bg-red-100 border border-red-200 text-sm font-bold">
                Dừng cào
              </button>
            ) : (
              <button
                type="button"
                onClick={handleStart}
                disabled={!canStart}
                className="flex-1 px-4 py-2 rounded-xl bg-primary text-white hover:bg-primary/90 text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Bắt đầu cào ({selectedIds.length} nhóm)
              </button>
            )}
            {runtime.done && !runtime.running ? (
              <button type="button" onClick={onReset} className="px-3 py-2 rounded-xl border border-border text-sm font-semibold text-muted-foreground hover:bg-muted">
                Xoá log
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {runtime.running || runtime.done || runtime.logs.length > 0 ? (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Nhóm hiện tại" value={runtime.totalGroups > 0 ? `${Math.min(runtime.groupIndex + 1, runtime.totalGroups)}/${runtime.totalGroups}` : "—"} />
            <Stat label={isFacebook ? "Trạng thái" : "Bài đang cào"} value={isFacebook ? (runtime.running ? "Đang chạy" : runtime.done ? "Xong" : "—") : String(runtime.posts)} />
            <Stat label="Đã lưu mới" value={String(runtime.saved)} highlight />
          </div>
          {runtime.totalGroups > 0 ? (
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-primary rounded-full transition-all duration-300" style={{ width: `${progressPct}%` }} />
            </div>
          ) : null}
          <div className="bg-slate-900 rounded-xl p-3 font-mono text-[11px] max-h-[180px] overflow-y-auto">
            {runtime.logs.slice(-40).map((line, i) => (
              <div key={`${line.at}-${i}`} className={LOG_COLOR[line.level] || LOG_COLOR.info}>
                {line.message}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={cn("rounded-xl p-2.5 text-center border", highlight ? "bg-emerald-50 border-emerald-100" : "bg-muted/50 border-border")}>
      <div className={cn("text-lg font-bold", highlight ? "text-emerald-700" : "text-foreground")}>{value}</div>
      <div className="text-[10px] text-muted-foreground font-medium">{label}</div>
    </div>
  );
}
