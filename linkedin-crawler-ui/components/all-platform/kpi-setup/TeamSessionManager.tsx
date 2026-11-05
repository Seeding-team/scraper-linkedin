"use client";

import { useEffect, useState } from "react";
import { Plus, Users, Calendar, AlertCircle, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  kpiSetupService,
  type CrmTeam,
  type KpiTemplate,
  type KpiSessionSummary,
  type KpiSessionDetail,
} from "@/services/kpi-setup.service";
import { ApplyTemplateModal } from "./ApplyTemplateModal";
import { TeamKpiSessionView } from "./TeamKpiSessionView";
import { KpiErrorBoundary } from "./KpiErrorBoundary";

interface TeamSessionManagerProps {
  initialTeamId?: string;
  initialTemplateId?: string;
}

export function TeamSessionManager({
  initialTeamId,
  initialTemplateId,
}: TeamSessionManagerProps) {
  const [crmTeams, setCrmTeams] = useState<CrmTeam[]>([]);
  const [templates, setTemplates] = useState<KpiTemplate[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string>(initialTeamId || "");
  const [sessions, setSessions] = useState<KpiSessionSummary[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>("");
  const [sessionDetail, setSessionDetail] = useState<KpiSessionDetail | null>(null);

  const [isLoadingTeams, setIsLoadingTeams] = useState(true);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [applyModalOpen, setApplyModalOpen] = useState(false);

  // 1. Load CRM teams & templates on mount
  useEffect(() => {
    let isMounted = true;
    async function loadInitial() {
      setError(null);
      try {
        const [teamsRes, templatesRes] = await Promise.all([
          kpiSetupService.getCrmTeams(),
          kpiSetupService.getTemplates(),
        ]);

        if (!isMounted) return;

        if (teamsRes.success && teamsRes.data) {
          setCrmTeams(teamsRes.data);
          if (teamsRes.data.length > 0) {
            setSelectedTeamId((prev) => prev || (teamsRes.data?.[0]?.id ?? ""));
          }
        } else {
          setError(teamsRes.message || "Không thể tải danh sách CRM Teams");
        }

        if (templatesRes.success && templatesRes.data) {
          setTemplates(templatesRes.data);
        }
      } catch (err: unknown) {
        if (!isMounted) return;
        setError(err instanceof Error ? err.message : "Lỗi tải dữ liệu");
      } finally {
        if (isMounted) setIsLoadingTeams(false);
      }
    }

    void loadInitial();
    return () => {
      isMounted = false;
    };
  }, []);

  // 2. Load sessions when selectedTeamId changes
  useEffect(() => {
    let isMounted = true;
    async function loadSessions() {
      if (!selectedTeamId) {
        setSessions([]);
        setSelectedSessionId("");
        setSessionDetail(null);
        return;
      }

      setError(null);
      try {
        const res = await kpiSetupService.getSessions(selectedTeamId);
        if (!isMounted) return;

        if (res.success && res.data) {
          setSessions(res.data);
          if (res.data.length > 0) {
            // Pick active or first session
            const active = res.data.find((s) => s.status === "active");
            setSelectedSessionId(active ? active.id : res.data[0].id);
          } else {
            setSelectedSessionId("");
            setSessionDetail(null);
          }
        } else {
          setError(res.message || "Không thể tải danh sách kỳ KPI");
        }
      } catch (err: unknown) {
        if (!isMounted) return;
        setError(err instanceof Error ? err.message : "Lỗi tải kỳ KPI");
      } finally {
        if (isMounted) setIsLoadingSessions(false);
      }
    }

    void loadSessions();
    return () => {
      isMounted = false;
    };
  }, [selectedTeamId]);

  // 3. Load session detail when selectedSessionId changes
  const loadDetail = async (id: string) => {
    if (!id) {
      setSessionDetail(null);
      return;
    }
    setIsLoadingDetail(true);
    try {
      const res = await kpiSetupService.getSession(id);
      if (res.success && res.data) {
        setSessionDetail(res.data);
      } else {
        setError(res.message || "Không thể tải chi tiết kỳ KPI");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Lỗi tải chi tiết");
    } finally {
      setIsLoadingDetail(false);
    }
  };

  useEffect(() => {
    let isMounted = true;
    async function fetchDetail() {
      if (!selectedSessionId) {
        setSessionDetail(null);
        return;
      }
      try {
        const res = await kpiSetupService.getSession(selectedSessionId);
        if (!isMounted) return;
        if (res.success && res.data) {
          setSessionDetail(res.data);
        } else {
          setError(res.message || "Không thể tải chi tiết kỳ KPI");
        }
      } catch (err: unknown) {
        if (!isMounted) return;
        setError(err instanceof Error ? err.message : "Lỗi tải chi tiết");
      } finally {
        if (isMounted) setIsLoadingDetail(false);
      }
    }

    void fetchDetail();
    return () => {
      isMounted = false;
    };
  }, [selectedSessionId]);

  const handleSessionCreated = (newSession: KpiSessionDetail) => {
    // Add to sessions list and select it
    setSessions((prev) => [newSession, ...prev]);
    setSelectedSessionId(newSession.id);
    setSessionDetail(newSession);
  };

  return (
    <div className="space-y-6">
      {/* Top Filter Bar: Team Selector & Session Selector */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 p-4 border rounded-xl bg-card shadow-sm">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 flex-1">
          {/* Team Select */}
          <div className="w-full sm:w-64 space-y-1.5">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5" />
              Chọn CRM Team
            </Label>
            <Select
              value={selectedTeamId}
              onValueChange={setSelectedTeamId}
              disabled={isLoadingTeams}
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Chọn Team..." />
              </SelectTrigger>
              <SelectContent>
                {crmTeams.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name} {t.code ? `(${t.code})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Session Select */}
          <div className="w-full sm:w-80 space-y-1.5">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5" />
              Chọn Kỳ Tuần
            </Label>
            <Select
              value={selectedSessionId}
              onValueChange={setSelectedSessionId}
              disabled={isLoadingSessions || sessions.length === 0}
            >
              <SelectTrigger className="h-9">
                <SelectValue
                  placeholder={
                    isLoadingSessions
                      ? "Đang tải..."
                      : sessions.length === 0
                      ? "Chưa có kỳ nào"
                      : "Chọn kỳ tuần..."
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {sessions.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    Tuần {s.week_start} → {s.week_end} [{s.status}]
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Create Session Button */}
        <div className="shrink-0">
          <Button
            onClick={() => setApplyModalOpen(true)}
            className="gap-1.5 h-9 bg-[var(--color-markee-primary)] hover:opacity-90 text-white w-full sm:w-auto"
          >
            <Plus className="w-4 h-4" />
            Tạo kỳ mới từ Mẫu
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Main Content Area */}
      {isLoadingDetail ? (
        <div className="py-20 text-center text-muted-foreground">
          Đang tải dữ liệu kỳ KPI...
        </div>
      ) : sessionDetail ? (
        <KpiErrorBoundary
          fallbackTitle="Không thể hiển thị kỳ KPI này do lỗi dữ liệu"
          onReset={() => loadDetail(selectedSessionId)}
        >
          <TeamKpiSessionView
            session={sessionDetail}
            onRefresh={() => loadDetail(selectedSessionId)}
          />
        </KpiErrorBoundary>
      ) : (
        <div className="p-16 border-2 border-dashed rounded-xl text-center space-y-3">
          <Layers className="w-12 h-12 text-muted-foreground mx-auto" />
          <div className="text-base font-semibold">
            Chưa có kỳ KPI nào cho Team này
          </div>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Bấm nút &quot;Tạo kỳ mới từ Mẫu&quot; để áp dụng một mẫu KPI chung và thiết lập mốc đánh giá cho các thành viên trong tuần.
          </p>
          <Button
            onClick={() => setApplyModalOpen(true)}
            variant="outline"
            className="gap-2 mt-2"
          >
            <Plus className="w-4 h-4" />
            Tạo kỳ KPI ngay
          </Button>
        </div>
      )}

      {/* Apply Template Modal */}
      {applyModalOpen && (
        <ApplyTemplateModal
          isOpen={applyModalOpen}
          onClose={() => setApplyModalOpen(false)}
          crmTeams={crmTeams}
          templates={templates}
          defaultTeamId={selectedTeamId}
          defaultTemplateId={initialTemplateId}
          onApplied={handleSessionCreated}
        />
      )}
    </div>
  );
}

