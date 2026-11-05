"use client";

import { useEffect, useState } from "react";
import {
  CheckCircle2,
  Lock,
  Play,
  RefreshCw,
  Send,
  Users,
  Save,
  Eye,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  kpiSetupService,
  type KpiSessionDetail,
  type KpiSessionOverride,
  type KpiPreviewResponse,
} from "@/services/kpi-setup.service";
import { SyncPmModal } from "./SyncPmModal";

interface TeamKpiSessionViewProps {
  session: KpiSessionDetail;
  onRefresh: () => void;
}

export function TeamKpiSessionView({
  session,
  onRefresh,
}: TeamKpiSessionViewProps) {
  const [activeTab, setActiveTab] = useState<string>("allocations");

  // Helper to build initial alloc map
  const buildInitialAllocations = () => {
    const allocMap: Record<
      string,
      { weight: number; support_user_id: string | null }
    > = {};
    for (const a of session.allocations || (session as any).kpi_session_allocations || []) {
      allocMap[a.user_id] = {
        weight: a.weight ?? (a as any).weight_pct ?? 100,
        support_user_id: a.support_user_id || null,
      };
    }
    return allocMap;
  };

  const buildInitialOverrides = () => {
    const overMap: Record<string, number> = {};
    for (const o of session.overrides || (session as any).kpi_session_member_overrides || []) {
      overMap[`${o.user_id}:${o.metric_code}`] = o.critical_count ?? (o as any).level_critical_override ?? 0;
    }
    return overMap;
  };

  // Allocations state (user_id -> allocation)
  const [allocations, setAllocations] = useState<
    Record<string, { weight: number; support_user_id: string | null }>
  >(buildInitialAllocations);

  // Overrides state (user_id:metric_code -> critical_count)
  const [overrides, setOverrides] = useState<Record<string, number>>(buildInitialOverrides);

  // Sync state when session changes
  const [prevSessionId, setPrevSessionId] = useState(session.id);
  if (session.id !== prevSessionId) {
    setPrevSessionId(session.id);
    setAllocations(buildInitialAllocations());
    setOverrides(buildInitialOverrides());
  }

  // Preview state
  const [previewData, setPreviewData] = useState<KpiPreviewResponse | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Sync Modal state
  const [syncModalOpen, setSyncModalOpen] = useState(false);

  // Saving state
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Fetch preview on mount or when session changes
  useEffect(() => {
    let isMounted = true;
    async function fetchPreview() {
      setIsLoadingPreview(true);
      setPreviewError(null);
      try {
        const res = await kpiSetupService.getPreview(session.id);
        if (!isMounted) return;
        if (res.success && res.data) {
          setPreviewData(res.data);
        } else {
          setPreviewError(res.message || "Không thể tải bảng xem thử");
        }
      } catch (err: unknown) {
        if (!isMounted) return;
        setPreviewError(err instanceof Error ? err.message : "Lỗi tải xem thử");
      } finally {
        if (isMounted) setIsLoadingPreview(false);
      }
    }

    void fetchPreview();
    return () => {
      isMounted = false;
    };
  }, [session.id]);

  const loadPreview = async () => {
    setIsLoadingPreview(true);
    setPreviewError(null);
    try {
      const res = await kpiSetupService.getPreview(session.id);
      if (res.success && res.data) {
        setPreviewData(res.data);
      } else {
        setPreviewError(res.message || "Không thể tải bảng xem thử");
      }
    } catch (err: unknown) {
      setPreviewError(err instanceof Error ? err.message : "Lỗi tải xem thử");
    } finally {
      setIsLoadingPreview(false);
    }
  };

  const handleActivate = async () => {
    try {
      const res = await kpiSetupService.activateSession(session.id);
      if (res.success) {
        onRefresh();
      } else {
        alert(res.message || "Kích hoạt kỳ thất bại");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Lỗi kích hoạt";
      alert(msg);
    }
  };

  const handleWeightChange = (userId: string, weight: number) => {
    setAllocations((prev) => ({
      ...prev,
      [userId]: {
        ...(prev[userId] || { weight: 100, support_user_id: null }),
        weight,
      },
    }));
  };

  const handleSupportChange = (
    userId: string,
    supportUserId: string | null
  ) => {
    setAllocations((prev) => ({
      ...prev,
      [userId]: {
        ...(prev[userId] || { weight: 100, support_user_id: null }),
        support_user_id: supportUserId,
      },
    }));
  };

  const handleOverrideChange = (
    userId: string,
    metricCode: string,
    val: number
  ) => {
    setOverrides((prev) => ({
      ...prev,
      [`${userId}:${metricCode}`]: val,
    }));
  };

  const handleSaveAllocationsAndOverrides = async () => {
    setIsSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    try {
      // 1. Prepare allocations payload
      const allocPayload = Object.entries(allocations).map(
        ([user_id, data]) => ({
          user_id,
          weight: data.weight,
          support_user_id: data.support_user_id,
        })
      );

      const allocRes = await kpiSetupService.updateAllocations(
        session.id,
        allocPayload
      );
      if (!allocRes.success) {
        setSaveError(allocRes.message || "Lưu phân bổ thất bại");
        setIsSaving(false);
        return;
      }

      // 2. Prepare overrides payload
      const overridePayload: KpiSessionOverride[] = [];
      for (const [key, val] of Object.entries(overrides)) {
        const [user_id, metric_code] = key.split(":");
        if (user_id && metric_code && val > 0) {
          overridePayload.push({
            user_id,
            metric_code,
            critical_count: val,
          });
        }
      }

      const overRes = await kpiSetupService.updateOverrides(
        session.id,
        overridePayload
      );
      if (!overRes.success) {
        setSaveError(overRes.message || "Lưu override thất bại");
        setIsSaving(false);
        return;
      }

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      onRefresh();
      loadPreview();
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : "Lỗi lưu dữ liệu");
    } finally {
      setIsSaving(false);
    }
  };

  // List of all members in allocations
  const members = session.allocations || (session as any).kpi_session_allocations || [];

  return (
    <div className="space-y-6">
      {/* Session Header Card */}
      <div className="p-4 rounded-xl border bg-card shadow-sm space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h2 className="text-xl font-bold text-foreground">
                {session.crm_teams?.name || "Kỳ KPI Team"}
              </h2>
              {session.status === "active" ? (
                <Badge className="bg-emerald-500 hover:bg-emerald-600 text-white gap-1 text-xs">
                  <CheckCircle2 className="w-3 h-3" /> Đang hoạt động
                </Badge>
              ) : session.status === "locked" ? (
                <Badge variant="outline" className="text-amber-600 border-amber-300 gap-1 text-xs">
                  <Lock className="w-3 h-3" /> Đã chốt số
                </Badge>
              ) : session.status === "draft" ? (
                <Badge variant="outline" className="text-slate-600 border-slate-300 gap-1 text-xs">
                  Bản nháp
                </Badge>
              ) : (
                <Badge variant="secondary" className="gap-1 text-xs">
                  Đã đóng
                </Badge>
              )}
            </div>

            <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
              <span>
                Tuần: <strong className="text-foreground font-mono">{session.week_start}</strong> đến{" "}
                <strong className="text-foreground font-mono">{session.week_end}</strong>
              </span>
              <span>•</span>
              <span>
                Mẫu KPI: <strong className="text-foreground">{session.kpi_templates?.name}</strong>
              </span>
              {session.skill_solution_name && (
                <>
                  <span>•</span>
                  <span>
                    PM Skill: <span className="text-blue-600 font-medium">{session.skill_solution_name}</span>
                    {session.skill_vendor_name ? ` / ${session.skill_vendor_name}` : ""}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 shrink-0">
            {session.status !== "active" && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleActivate}
                className="gap-1.5 text-xs text-emerald-600 hover:bg-emerald-50"
              >
                <Play className="w-3.5 h-3.5" />
                Kích hoạt kỳ
              </Button>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={loadPreview}
              disabled={isLoadingPreview}
              className="gap-1.5 text-xs"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingPreview ? "animate-spin" : ""}`} />
              Làm mới số liệu
            </Button>

            <Button
              size="sm"
              onClick={() => setSyncModalOpen(true)}
              className="gap-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white"
            >
              <Send className="w-3.5 h-3.5" />
              Đồng bộ sang PM
            </Button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-2 max-w-md">
          <TabsTrigger value="allocations" className="text-xs gap-1.5">
            <Users className="w-3.5 h-3.5" />
            Phân bổ & Override mốc
          </TabsTrigger>
          <TabsTrigger value="preview" className="text-xs gap-1.5">
            <Eye className="w-3.5 h-3.5" />
            Xem thử Kết quả & Manday
          </TabsTrigger>
        </TabsList>

        {/* TAB 1: ALLOCATIONS & OVERRIDES */}
        <TabsContent value="allocations" className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Chỉnh sửa tỷ trọng (%) phân bổ cho từng nhân sự và chọn người hỗ trợ (nếu có).
              Mốc Critical có thể được điều chỉnh riêng (override) cho từng người.
            </p>

            <Button
              size="sm"
              onClick={handleSaveAllocationsAndOverrides}
              disabled={isSaving}
              className="gap-1.5 text-xs bg-[var(--color-markee-primary)] hover:opacity-90 text-white"
            >
              <Save className="w-3.5 h-3.5" />
              {isSaving ? "Đang lưu..." : "Lưu thay đổi"}
            </Button>
          </div>

          {saveSuccess && (
            <div className="p-3 text-xs text-emerald-700 bg-emerald-50 rounded-lg border border-emerald-200">
              Đã lưu thành công tỷ trọng phân bổ và mốc điều chỉnh!
            </div>
          )}

          {saveError && (
            <div className="p-3 text-xs text-red-600 bg-red-50 rounded-lg border border-red-200">
              {saveError}
            </div>
          )}

          <div className="border rounded-xl overflow-hidden bg-card shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 border-b text-muted-foreground font-semibold text-left">
                  <tr>
                    <th className="p-3 min-w-[180px]">Thành viên</th>
                    <th className="p-3 w-[120px]">Tỷ trọng (%)</th>
                    <th className="p-3 min-w-[180px]">Người hỗ trợ (Supporter)</th>
                    {(session.levels || (session as any).kpi_session_levels || []).map((lvl: any) => (
                      <th
                        key={lvl.metric_code}
                        className="p-3 min-w-[160px] text-center"
                      >
                        <div>Mốc Critical: {lvl.metric_code}</div>
                        <span className="text-[10px] text-muted-foreground font-normal">
                          (Mặc định: {lvl.critical_count ?? lvl.level_critical ?? 0})
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {members.map((m) => {
                    const currentAlloc = allocations[m.user_id] || {
                      weight: 100,
                      support_user_id: null,
                    };

                    return (
                      <tr key={m.user_id} className="hover:bg-muted/20">
                        {/* Member Name */}
                        <td className="p-3 align-middle">
                          <div className="font-semibold text-foreground">
                            {m.app_users?.full_name || "Nhân sự"}
                          </div>
                          <div className="text-[11px] text-muted-foreground font-mono">
                            {m.app_users?.email}
                          </div>
                        </td>

                        {/* Weight */}
                        <td className="p-3 align-middle">
                          <div className="flex items-center gap-1">
                            <Input
                              type="number"
                              min={0}
                              max={300}
                              className="h-8 text-xs font-semibold"
                              value={currentAlloc.weight}
                              onChange={(e) =>
                                handleWeightChange(
                                  m.user_id,
                                  Number(e.target.value)
                                )
                              }
                            />
                            <span className="text-muted-foreground">%</span>
                          </div>
                        </td>

                        {/* Supporter Picker (excludes self) */}
                        <td className="p-3 align-middle">
                          <Select
                            value={currentAlloc.support_user_id || "none"}
                            onValueChange={(val) =>
                              handleSupportChange(
                                m.user_id,
                                val === "none" ? null : val
                              )
                            }
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue placeholder="Không có người hỗ trợ" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">-- Không có --</SelectItem>
                              {members
                                .filter((other) => other.user_id !== m.user_id)
                                .map((other) => (
                                  <SelectItem
                                    key={other.user_id}
                                    value={other.user_id}
                                  >
                                    {other.app_users?.full_name || other.app_users?.email}
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                        </td>

                        {/* Critical Override per metric */}
                        {(session.levels || (session as any).kpi_session_levels || []).map((lvl: any) => {
                          const overrideKey = `${m.user_id}:${lvl.metric_code}`;
                          const overrideVal =
                            overrides[overrideKey] !== undefined
                              ? overrides[overrideKey]
                              : "";

                          return (
                            <td
                              key={lvl.metric_code}
                              className="p-3 align-middle text-center"
                            >
                              <Input
                                type="number"
                                min={0}
                                placeholder={String(lvl.critical_count ?? lvl.level_critical ?? 0)}
                                className="h-8 text-xs text-center font-mono w-24 mx-auto"
                                value={overrideVal}
                                onChange={(e) =>
                                  handleOverrideChange(
                                    m.user_id,
                                    lvl.metric_code,
                                    e.target.value === ""
                                      ? 0
                                      : Number(e.target.value)
                                  )
                                }
                              />
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>

        {/* TAB 2: PREVIEW CALCULATION */}
        <TabsContent value="preview" className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Dữ liệu được tính toán thời gian thực từ bảng lịch sử đánh giá bài cào{" "}
              <code className="text-xs bg-muted px-1 py-0.5 rounded font-mono">
                post_evaluation_history (action_type = manual)
              </code>
              . Các hành động tự động hoặc undo không được tính.
            </p>

            <Button
              size="sm"
              variant="outline"
              onClick={loadPreview}
              disabled={isLoadingPreview}
              className="gap-1.5 text-xs"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingPreview ? "animate-spin" : ""}`} />
              Tính toán lại
            </Button>
          </div>

          {previewError && (
            <div className="p-3 text-xs text-red-600 bg-red-50 rounded-lg border border-red-200">
              {previewError}
            </div>
          )}

          {isLoadingPreview ? (
            <div className="py-16 text-center text-xs text-muted-foreground">
              Đang tính toán kết quả...
            </div>
          ) : !previewData ? (
            <div className="py-12 text-center text-xs text-muted-foreground">
              Chưa có dữ liệu xem thử.
            </div>
          ) : (() => {
            const displayMetrics =
              Array.isArray(previewData.metrics) && previewData.metrics.length > 0
                ? previewData.metrics
                : (session.levels || []).map((lvl) => ({
                    code: lvl.metric_code,
                    name: lvl.metric_code,
                  }));

            const totalTeamManday =
              previewData.total_team_manday ??
              (previewData.members || []).reduce(
                (acc, m) => acc + (m.total_manday ?? (m as any).total_base_manday ?? 0),
                0
              );

            return (
              <div className="border rounded-xl overflow-hidden bg-card shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50 border-b text-muted-foreground font-semibold text-left">
                      <tr>
                        <th className="p-3 min-w-[160px]">Thành viên</th>
                        <th className="p-3 text-center">Tỷ trọng</th>
                        {displayMetrics.map((m) => (
                          <th
                            key={m.code}
                            className="p-3 min-w-[170px] text-center"
                          >
                            <div>{m.name}</div>
                            <span className="text-[10px] text-muted-foreground font-mono">
                              ({m.code})
                            </span>
                          </th>
                        ))}
                        <th className="p-3 text-center min-w-[100px]">Manday cơ bản</th>
                        <th className="p-3 text-center min-w-[100px]">Manday thưởng</th>
                        <th className="p-3 text-center min-w-[110px] bg-[var(--color-markee-primary)]/5">
                          Tổng Manday
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {(previewData.members || []).length === 0 ? (
                        <tr>
                          <td
                            colSpan={2 + displayMetrics.length + 3}
                            className="p-8 text-center text-muted-foreground text-xs"
                          >
                            Chưa có thành viên nào trong kỳ KPI này.
                          </td>
                        </tr>
                      ) : (
                        (previewData.members || []).map((mb) => {
                          // Sum base and bonus across all metrics
                          let memberBase = 0;
                          let memberBonus = 0;
                          for (const mDetail of Object.values(mb.metrics || {})) {
                            memberBase += Number((mDetail as any)?.base_manday ?? 0);
                            memberBonus += Number((mDetail as any)?.bonus_manday ?? 0);
                          }

                          return (
                            <tr key={mb.user_id} className="hover:bg-muted/20">
                              {/* Member Info */}
                              <td className="p-3">
                                <div className="font-semibold text-foreground">
                                  {mb.user_name}
                                </div>
                                <div className="text-[10px] text-muted-foreground font-mono">
                                  {mb.user_email}
                                </div>
                                {mb.support_user_name && (
                                  <div className="text-[10px] text-blue-600 mt-0.5">
                                    Hỗ trợ: {mb.support_user_name}
                                  </div>
                                )}
                              </td>

                              {/* Weight */}
                              <td className="p-3 text-center font-medium">
                                {mb.weight ?? (mb as any).weight_pct ?? 0}%
                              </td>

                              {/* Metric cells */}
                              {displayMetrics.map((m) => {
                                const det = mb.metrics?.[m.code];
                                if (!det) {
                                  return (
                                    <td
                                      key={m.code}
                                      className="p-3 text-center text-muted-foreground"
                                    >
                                      -
                                    </td>
                                  );
                                }

                                const tierBadge =
                                  det.tier_reached === "critical" ? (
                                    <Badge className="bg-rose-500 hover:bg-rose-600 text-white text-[10px] px-1 py-0">
                                      Critical
                                    </Badge>
                                  ) : det.tier_reached === "high" ? (
                                    <Badge className="bg-blue-500 hover:bg-blue-600 text-white text-[10px] px-1 py-0">
                                      High
                                    </Badge>
                                  ) : det.tier_reached === "normal" ? (
                                    <Badge variant="secondary" className="text-[10px] px-1 py-0">
                                      Normal
                                    </Badge>
                                  ) : (
                                    <span className="text-[10px] text-muted-foreground">
                                      Chưa đạt
                                    </span>
                                  );

                                return (
                                  <td
                                    key={m.code}
                                    className="p-3 text-center align-middle"
                                  >
                                    <div className="font-mono text-sm font-bold text-foreground">
                                      {det.actual_count ?? 0} bài
                                    </div>
                                    <div className="text-[10px] text-muted-foreground mt-0.5">
                                      Mốc: {det.effective_critical ?? (det as any).level_critical ?? 0}
                                    </div>
                                    <div className="mt-1">{tierBadge}</div>
                                  </td>
                                );
                              })}

                              {/* Base Manday */}
                              <td className="p-3 text-center font-mono font-medium">
                                {(memberBase ?? 0).toFixed(1)}
                              </td>

                              {/* Bonus Manday */}
                              <td className="p-3 text-center font-mono font-medium text-emerald-600">
                                {(memberBonus ?? 0) > 0 ? `+${(memberBonus ?? 0).toFixed(1)}` : "0.0"}
                              </td>

                              {/* Total Manday */}
                              <td className="p-3 text-center font-mono font-bold text-sm bg-[var(--color-markee-primary)]/5 text-[var(--color-markee-primary)]">
                                {((mb.total_manday ?? (memberBase + memberBonus)) || 0).toFixed(1)}d
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                    {/* Team Totals Footer */}
                    <tfoot className="bg-muted/50 border-t font-semibold">
                      <tr>
                        <td colSpan={2 + displayMetrics.length + 2} className="p-3 text-right">
                          Tổng Manday của Team:
                        </td>
                        <td className="p-3 text-center font-mono text-base font-extrabold text-[var(--color-markee-primary)] bg-[var(--color-markee-primary)]/10">
                          {(totalTeamManday ?? 0).toFixed(1)}d
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            );
          })()}
        </TabsContent>
      </Tabs>

      {/* Sync to PM Modal */}
      {syncModalOpen && (
        <SyncPmModal
          isOpen={syncModalOpen}
          onClose={() => setSyncModalOpen(false)}
          session={session}
          onSynced={() => {
            onRefresh();
            loadPreview();
          }}
        />
      )}
    </div>
  );
}

