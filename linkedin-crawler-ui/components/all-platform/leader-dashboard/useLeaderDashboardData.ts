"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  postCallResultService,
  postContactActivityService,
  type ActivityLogItem,
  type CallResultStats,
  type ContactActivityMember,
  type ZaloMessageStats,
} from "@/services/all-platform.service";
import type { LeaderDashboardFilters } from "./useLeaderDashboardFilters";
import { OK_CALL_CODES } from "./shared";

export interface MemberTableRow extends ContactActivityMember {
  zalo_replied: number;
  lead: number;
  overdue: number;
}

/** Dữ liệu dùng chung cho Hero/KPI/Funnel/Alerts/bảng Thành viên (tab Tổng quan + Thành viên) —
 * fetch 1 lần ở trang, tránh mỗi widget tự gọi lại cùng 1 API. Dùng lại đúng các endpoint đã có
 * từ tính năng "Kết quả liên hệ" (post_call_result_service/zalo_inbox_kpi_service/
 * post_contact_activity_service), không tạo thêm tầng tổng hợp ở backend. */
export function useLeaderDashboardData(filters: LeaderDashboardFilters) {
  const [callStats, setCallStats] = useState<CallResultStats | null>(null);
  const [prevCallTotal, setPrevCallTotal] = useState(0);
  const [zaloStats, setZaloStats] = useState<ZaloMessageStats | null>(null);
  const [who, setWho] = useState<ContactActivityMember[]>([]);
  const [leadByMember, setLeadByMember] = useState<Map<string, number>>(new Map());
  const [overdueItems, setOverdueItems] = useState<ActivityLogItem[]>([]);
  const [overdueCount, setOverdueCount] = useState(0);
  const [followupCount, setFollowupCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  const common = useMemo(
    () => ({
      platform: filters.platform || undefined,
      team_id: filters.teamId || undefined,
      member_id: filters.memberId || undefined,
    }),
    [filters.platform, filters.teamId, filters.memberId]
  );

  const fetchAll = useCallback(async () => {
    setIsLoading(true);
    try {
      const [callRes, prevCallRes, leadRes, zaloRes, whoRes, overdueRes, followupRes] = await Promise.all([
        postCallResultService.getStats({ ...common, date_from: filters.date_from, date_to: filters.date_to }),
        postCallResultService.getStats({ ...common, date_from: filters.prev_date_from, date_to: filters.prev_date_to }),
        postCallResultService.getStats({ ...common, date_from: filters.date_from, date_to: filters.date_to, result_code: "interested" }),
        postContactActivityService.getZaloMessageStats({ ...common, date_from: filters.date_from, date_to: filters.date_to }),
        postContactActivityService.getWhoDidWhat({ ...common, date_from: filters.date_from, date_to: filters.date_to }),
        postContactActivityService.getActivityLog({
          ...common, date_from: filters.date_from, date_to: filters.date_to,
          action_type: "call", result_code: "callback", overdue_only: true, page: 1, page_size: 2000,
        }),
        postContactActivityService.getZaloFollowupCount(common),
      ]);
      if (callRes.success) setCallStats(callRes.data || null);
      if (prevCallRes.success) setPrevCallTotal(prevCallRes.data?.total || 0);
      if (leadRes.success) {
        const m = new Map<string, number>();
        (leadRes.data?.by_member || []).forEach((r) => m.set(r.member_id, r.count));
        setLeadByMember(m);
      }
      if (zaloRes.success) setZaloStats(zaloRes.data || null);
      if (whoRes.success) setWho(whoRes.data || []);
      if (overdueRes.success) {
        const items = overdueRes.data?.items || [];
        setOverdueItems(items);
        setOverdueCount(overdueRes.data?.total || 0);
      }
      if (followupRes.success) setFollowupCount(followupRes.data?.count || 0);
    } catch {
      // ignore — widget tổng quan chỉ là bổ trợ, không chặn trang nếu lỗi
    } finally {
      setIsLoading(false);
    }
  }, [common, filters.date_from, filters.date_to, filters.prev_date_from, filters.prev_date_to]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const callTotal = callStats?.total || 0;
  const callOk = useMemo(
    () => (callStats?.by_type || []).filter((t) => OK_CALL_CODES.has(t.code)).reduce((s, t) => s + t.count, 0),
    [callStats]
  );
  const callBad = Math.max(0, callTotal - callOk);
  const leadTotal = useMemo(() => (callStats?.by_type || []).find((t) => t.code === "interested")?.count || 0, [callStats]);
  const callbackTotal = useMemo(() => (callStats?.by_type || []).find((t) => t.code === "callback")?.count || 0, [callStats]);
  const seedTotal = useMemo(() => who.reduce((s, m) => s + m.seed, 0), [who]);
  const seedVerifiedTotal = useMemo(() => who.reduce((s, m) => s + m.seed_verified, 0), [who]);

  const overdueByMember = useMemo(() => {
    const m = new Map<string, number>();
    overdueItems.forEach((e) => {
      if (e.member_id) m.set(e.member_id, (m.get(e.member_id) || 0) + 1);
    });
    return m;
  }, [overdueItems]);

  const memberRows = useMemo<MemberTableRow[]>(() => {
    const repliedMap = new Map((zaloStats?.by_member || []).map((m) => [m.member_id, m.replied]));
    return [...who]
      .sort((a, b) => b.total - a.total)
      .map((m) => ({
        ...m,
        zalo_replied: repliedMap.get(m.member_id) || 0,
        lead: leadByMember.get(m.member_id) || 0,
        overdue: overdueByMember.get(m.member_id) || 0,
      }));
  }, [who, zaloStats, leadByMember, overdueByMember]);

  return {
    isLoading,
    callStats, callTotal, callOk, callBad, prevCallTotal,
    zaloStats,
    leadTotal, callbackTotal,
    seedTotal, seedVerifiedTotal,
    overdueCount, followupCount,
    memberRows,
    refetch: fetchAll,
  };
}

export type LeaderDashboardData = ReturnType<typeof useLeaderDashboardData>;
