"use client";

import { useEffect, useState, useCallback } from "react";
import { MaterialIcon } from "@/components/ui";
import { useAppAuth } from "@/contexts/AppAuthContext";
import { allPlatformKpiService } from "@/services/all-platform.service";
import {
  listZaloAccountAssignments,
  upsertZaloAccountAssignment,
  deleteZaloAccountAssignment,
} from "@/services/zaloCrawlerService";
import type { ZaloAccountAssignment } from "@/types/zalo-api";

interface Candidate {
  appUserId: string;
  name: string;
  email: string;
}

interface ZaloAccountAssignmentsPanelProps {
  accountId: string;
  accountLabel: string;
  onClose: () => void;
}

/**
 * Zalo tập trung (Mục 4.2 "/staff" guide) — thay vì trang staff riêng (dùng SSO
 * app chính nên không cần), đây là modal admin-only gán quyền xem/gửi/broadcast
 * theo tài khoản Zalo cho từng nhân viên, mở từ menu 3-chấm trên card account.
 */
export function ZaloAccountAssignmentsPanel({ accountId, accountLabel, onClose }: ZaloAccountAssignmentsPanelProps) {
  const { user } = useAppAuth();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [assignments, setAssignments] = useState<ZaloAccountAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [teamRes, assignRes] = await Promise.all([
        allPlatformKpiService.getAll(user?.email || ""),
        listZaloAccountAssignments(accountId),
      ]);
      const members = teamRes.success ? teamRes.data?.members ?? [] : [];
      const seen = new Set<string>();
      const list: Candidate[] = [];
      for (const m of members) {
        const mAny = m as unknown as Record<string, unknown>;
        const appUserId = (mAny.member_id as string | undefined) ?? m.email ?? "";
        if (!appUserId || seen.has(appUserId)) continue;
        seen.add(appUserId);
        list.push({ appUserId, name: m.name || m.email || appUserId, email: m.email || "" });
      }
      setCandidates(list);
      setAssignments(assignRes.assignments ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không thể tải danh sách phân quyền.");
    } finally {
      setLoading(false);
    }
  }, [accountId, user?.email]);

  useEffect(() => {
    void load();
  }, [load]);

  const assignmentFor = (appUserId: string) => assignments.find((a) => a.app_user_id === appUserId);

  const toggle = async (appUserId: string, field: "can_view" | "can_send" | "can_broadcast", value: boolean) => {
    setSavingUserId(appUserId);
    setError(null);
    const current = assignmentFor(appUserId);
    const payload = {
      app_user_id: appUserId,
      can_view: field === "can_view" ? value : current?.can_view ?? true,
      can_send: field === "can_send" ? value : current?.can_send ?? false,
      can_broadcast: field === "can_broadcast" ? value : current?.can_broadcast ?? false,
    };
    try {
      if (!payload.can_view && !payload.can_send && !payload.can_broadcast && current) {
        await deleteZaloAccountAssignment(accountId, appUserId);
        setAssignments((prev) => prev.filter((a) => a.app_user_id !== appUserId));
      } else {
        const res = await upsertZaloAccountAssignment(accountId, payload);
        setAssignments((prev) => {
          const next = prev.filter((a) => a.app_user_id !== appUserId);
          next.push(res.assignment);
          return next;
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cập nhật quyền thất bại.");
    } finally {
      setSavingUserId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl flex flex-col max-h-[80vh]">
        <div className="flex items-center justify-between border-b border-outline-variant px-4 py-3">
          <div>
            <h3 className="text-sm font-bold text-on-surface">Phân quyền tài khoản Zalo</h3>
            <p className="text-[11px] text-on-surface-variant">{accountLabel || accountId}</p>
          </div>
          <button onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-surface-container-low">
            <MaterialIcon name="close" className="text-[16px]" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {loading ? (
            <p className="text-[12px] text-on-surface-variant">Đang tải...</p>
          ) : error ? (
            <p className="text-[12px] text-red-600">{error}</p>
          ) : candidates.length === 0 ? (
            <p className="text-[12px] text-on-surface-variant">Không có nhân viên nào trong team.</p>
          ) : (
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-on-surface-variant text-[10px] uppercase">
                  <th className="pb-2 font-bold">Nhân viên</th>
                  <th className="pb-2 font-bold text-center">Xem</th>
                  <th className="pb-2 font-bold text-center">Gửi</th>
                  <th className="pb-2 font-bold text-center">Broadcast</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((c) => {
                  const a = assignmentFor(c.appUserId);
                  const rowSaving = savingUserId === c.appUserId;
                  return (
                    <tr key={c.appUserId} className="border-t border-outline-variant">
                      <td className="py-2">
                        <div className="font-semibold text-on-surface">{c.name}</div>
                        <div className="text-[10px] text-on-surface-variant">{c.email}</div>
                      </td>
                      {(["can_view", "can_send", "can_broadcast"] as const).map((field) => (
                        <td key={field} className="py-2 text-center">
                          <input
                            type="checkbox"
                            disabled={rowSaving}
                            checked={Boolean(a?.[field])}
                            onChange={(e) => void toggle(c.appUserId, field, e.target.checked)}
                            className="h-4 w-4 cursor-pointer disabled:opacity-50"
                          />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
