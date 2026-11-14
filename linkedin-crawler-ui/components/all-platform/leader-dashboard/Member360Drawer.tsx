"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useMemo, useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  postCallResultService,
  postContactActivityService,
  type ActivityLogActionType,
  type ActivityLogItem,
  type CallResultStats,
  type ZaloMessageStats,
} from "@/services/all-platform.service";
import { ActivityFlatTable } from "./ActivityFlatTable";
import { OK_CALL_CODES } from "./shared";

type SubTab = "call" | "msg" | "cmt";

const SUB_TABS: [SubTab, string, ActivityLogActionType][] = [
  ["call", "Cuộc gọi", "call"],
  ["msg", "Tin nhắn", "zalo"],
  ["cmt", "Comment", "seed"],
];

export function Member360Drawer({
  open,
  onOpenChange,
  memberId,
  memberName,
  teamName,
  dateFrom,
  dateTo,
  platform,
  periodLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  memberId: string | null;
  memberName: string | null;
  teamName?: string | null;
  dateFrom: string;
  dateTo: string;
  platform?: string | null;
  periodLabel: string;
}) {
  const [callStats, setCallStats] = useState<CallResultStats | null>(null);
  const [zaloStats, setZaloStats] = useState<ZaloMessageStats | null>(null);
  const [seedTotal, setSeedTotal] = useState(0);
  const [seedVerified, setSeedVerified] = useState(0);
  const [overdueCount, setOverdueCount] = useState(0);
  const [followupCount, setFollowupCount] = useState(0);
  const [isLoadingSummary, setIsLoadingSummary] = useState(false);

  const [subTab, setSubTab] = useState<SubTab>("call");
  const [logItems, setLogItems] = useState<ActivityLogItem[]>([]);
  const [isLoadingLog, setIsLoadingLog] = useState(false);

  useEffect(() => {
    if (!open || !memberId) return;
    let cancelled = false;
    setIsLoadingSummary(true);
    Promise.all([
      postCallResultService.getStats({ date_from: dateFrom, date_to: dateTo, platform: platform || undefined, member_id: memberId }),
      postContactActivityService.getZaloMessageStats({ date_from: dateFrom, date_to: dateTo, platform: platform || undefined, member_id: memberId }),
      postCallResultService.getOverdueCallbacksCount({ platform: platform || undefined, member_id: memberId }),
      postContactActivityService.getZaloFollowupCount({ platform: platform || undefined, member_id: memberId }),
      postContactActivityService.getWhoDidWhat({ date_from: dateFrom, date_to: dateTo, platform: platform || undefined, member_id: memberId }),
    ])
      .then(([callRes, zaloRes, overdueRes, followupRes, whoRes]) => {
        if (cancelled) return;
        if (callRes.success) setCallStats(callRes.data || null);
        if (zaloRes.success) setZaloStats(zaloRes.data || null);
        if (overdueRes.success) setOverdueCount(overdueRes.data?.count || 0);
        if (followupRes.success) setFollowupCount(followupRes.data?.count || 0);
        if (whoRes.success) {
          const mine = (whoRes.data || []).find((m) => m.member_id === memberId);
          setSeedTotal(mine?.seed || 0);
          setSeedVerified(mine?.seed_verified || 0);
        }
      })
      .catch(() => {
        // ignore
      })
      .finally(() => {
        if (!cancelled) setIsLoadingSummary(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, memberId, dateFrom, dateTo, platform]);

  useEffect(() => {
    if (!open || !memberId) return;
    const actionType = SUB_TABS.find(([k]) => k === subTab)?.[2];
    let cancelled = false;
    setIsLoadingLog(true);
    postContactActivityService
      .getActivityLog({
        date_from: dateFrom, date_to: dateTo, platform: platform || undefined, member_id: memberId,
        action_type: actionType, page: 1, page_size: 100,
      })
      .then((res) => {
        if (!cancelled && res.success) setLogItems(res.data?.items || []);
      })
      .catch(() => {
        // ignore
      })
      .finally(() => {
        if (!cancelled) setIsLoadingLog(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, memberId, dateFrom, dateTo, platform, subTab]);

  const callOk = useMemo(
    () => (callStats?.by_type || []).filter((t) => OK_CALL_CODES.has(t.code)).reduce((s, t) => s + t.count, 0),
    [callStats]
  );
  const callbackCount = useMemo(
    () => (callStats?.by_type || []).find((t) => t.code === "callback")?.count || 0,
    [callStats]
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-2xl w-full p-0 flex flex-col">
        <SheetHeader className="border-b border-border">
          <div className="text-[10.5px] font-extrabold tracking-wider text-primary">CHI TIẾT · DASHBOARD LEADER</div>
          <SheetTitle>{memberName || "—"} · Member 360</SheetTitle>
          <SheetDescription>
            {teamName ? `${teamName} · ` : ""}
            {periodLabel}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="grid grid-cols-3 gap-2">
            <div className="border border-border rounded-lg px-3 py-2">
              <div className="text-[11px] text-muted-foreground font-semibold">Gọi thành công</div>
              <div className="text-[17px] font-extrabold">
                {isLoadingSummary ? "…" : `${callOk}/${callStats?.total || 0}`}
              </div>
            </div>
            <div className="border border-border rounded-lg px-3 py-2">
              <div className="text-[11px] text-muted-foreground font-semibold">Zalo phản hồi</div>
              <div className="text-[17px] font-extrabold">
                {isLoadingSummary ? "…" : `${zaloStats?.replied || 0}/${zaloStats?.sent || 0}`}
              </div>
            </div>
            <div className="border border-border rounded-lg px-3 py-2">
              <div className="text-[11px] text-muted-foreground font-semibold">Comment đăng</div>
              <div className="text-[17px] font-extrabold">
                {isLoadingSummary ? "…" : `${seedVerified}/${seedTotal}`}
              </div>
            </div>
          </div>

          <div className="border border-border rounded-lg p-3">
            <div className="font-bold text-[12.5px] mb-2">Cần xử lý</div>
            <div className="flex items-center justify-between py-1.5 border-b border-border/60 text-[12.5px]">
              <span>Hẹn gọi lại</span>
              <b>{callbackCount}</b>
            </div>
            <div className="flex items-center justify-between py-1.5 border-b border-border/60 text-[12.5px]">
              <span>Quá hạn</span>
              <b className={cn(overdueCount > 0 && "text-rose-600")}>{overdueCount}</b>
            </div>
            <div className="flex items-center justify-between py-1.5 text-[12.5px]">
              <span>Tin nhắn cần follow-up</span>
              <b>{followupCount}</b>
            </div>
          </div>

          <div>
            <div className="inline-flex gap-1 bg-muted rounded-lg p-1 mb-3">
              {SUB_TABS.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSubTab(key)}
                  className={cn(
                    "px-2.5 py-1 rounded-md text-[12px] font-bold transition cursor-pointer",
                    subTab === key ? "bg-card text-foreground shadow-2xs" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <ActivityFlatTable items={logItems} isLoading={isLoadingLog} showActionColumn={false} />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
