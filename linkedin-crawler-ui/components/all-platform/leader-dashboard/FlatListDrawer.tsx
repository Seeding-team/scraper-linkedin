"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  postContactActivityService,
  type ActivityLogActionType,
  type ActivityLogResponse,
} from "@/services/all-platform.service";
import { ActivityFlatTable } from "./ActivityFlatTable";

export interface FlatListQuery {
  date_from: string;
  date_to: string;
  platform?: string;
  team_id?: string;
  member_id?: string;
  action_type?: ActivityLogActionType;
  result_code?: string;
  overdue_only?: boolean;
  needs_followup_only?: boolean;
  search?: string;
}

export function FlatListDrawer({
  open,
  onOpenChange,
  title,
  subtitle,
  query,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  subtitle?: string;
  /** null khi chưa xác định query (drawer sẽ không fetch cho tới khi có). */
  query: FlatListQuery | null;
}) {
  const [items, setItems] = useState<ActivityLogResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!open || !query) return;
    let cancelled = false;
    setIsLoading(true);
    postContactActivityService
      .getActivityLog({ ...query, page: 1, page_size: 100 })
      .then((res) => {
        if (!cancelled && res.success) setItems(res.data || null);
      })
      .catch(() => {
        // ignore
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, query]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-2xl w-full p-0 flex flex-col">
        <SheetHeader className="border-b border-border">
          <div className="text-[10.5px] font-extrabold tracking-wider text-primary">CHI TIẾT · DASHBOARD LEADER</div>
          <SheetTitle>{title}</SheetTitle>
          {subtitle && <SheetDescription>{subtitle}</SheetDescription>}
        </SheetHeader>
        <div className="flex-1 overflow-y-auto p-4">
          <ActivityFlatTable items={items?.items || []} isLoading={isLoading} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
