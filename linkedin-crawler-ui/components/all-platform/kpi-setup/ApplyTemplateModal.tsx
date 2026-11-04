"use client";

import { useEffect, useState, useMemo } from "react";
import { AlertCircle, Calendar, Users, Layers, Award } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
  buildWeekPickerOptionsAroundDate,
  getMondayOfWeekContaining,
} from "@/lib/kpi-month-weeks";
import {
  kpiSetupService,
  type CrmTeam,
  type KpiTemplate,
  type KpiSessionDetail,
  type PmSkillGroup,
  type PmSkillVendor,
} from "@/services/kpi-setup.service";

interface ApplyTemplateModalProps {
  isOpen: boolean;
  onClose: () => void;
  crmTeams: CrmTeam[];
  templates: KpiTemplate[];
  defaultTeamId?: string;
  defaultTemplateId?: string;
  onApplied: (newSession: KpiSessionDetail) => void;
}

export function ApplyTemplateModal({
  isOpen,
  onClose,
  crmTeams,
  templates,
  defaultTeamId,
  defaultTemplateId,
  onApplied,
}: ApplyTemplateModalProps) {
  const [selectedTeamId, setSelectedTeamId] = useState<string>(
    defaultTeamId || (crmTeams[0]?.id ?? "")
  );
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(
    defaultTemplateId || (templates[0]?.id ?? "")
  );

  // Week options
  const weekOptions = useMemo(() => {
    return buildWeekPickerOptionsAroundDate(new Date(), 2, 4);
  }, []);

  const defaultMondayStr = useMemo(() => {
    const mon = getMondayOfWeekContaining(new Date());
    const y = mon.getFullYear();
    const m = String(mon.getMonth() + 1).padStart(2, "0");
    const d = String(mon.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }, []);

  const [selectedWeekStart, setSelectedWeekStart] = useState<string>(defaultMondayStr);

  // PM Skills
  const [skillGroups, setSkillGroups] = useState<PmSkillGroup[]>([]);
  const [skillVendors, setSkillVendors] = useState<PmSkillVendor[]>([]);
  const [selectedSkillGroupId, setSelectedSkillGroupId] = useState<string>("none");
  const [selectedSkillVendorId, setSelectedSkillVendorId] = useState<string>("none");
  const [pmConfigured, setPmConfigured] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [prevTeamId, setPrevTeamId] = useState(defaultTeamId);
  if (defaultTeamId !== prevTeamId) {
    setPrevTeamId(defaultTeamId);
    if (defaultTeamId) setSelectedTeamId(defaultTeamId);
  }

  const [prevTplId, setPrevTplId] = useState(defaultTemplateId);
  if (defaultTemplateId !== prevTplId) {
    setPrevTplId(defaultTemplateId);
    if (defaultTemplateId) setSelectedTemplateId(defaultTemplateId);
  }

  // Load PM skills
  useEffect(() => {
    if (!isOpen) return;
    let isMounted = true;

    async function loadSkills() {
      const res = await kpiSetupService.getPmSkills();
      if (!isMounted) return;
      if (res.success && res.data) {
        setPmConfigured(res.data.configured);
        setSkillGroups(res.data.groups || []);
        setSkillVendors(res.data.vendors || []);
      }
    }

    void loadSkills();
    return () => {
      isMounted = false;
    };
  }, [isOpen]);

  const handleSubmit = async () => {
    if (!selectedTeamId) {
      setError("Vui lòng chọn CRM Team");
      return;
    }
    if (!selectedTemplateId) {
      setError("Vui lòng chọn Mẫu KPI");
      return;
    }
    if (!selectedWeekStart) {
      setError("Vui lòng chọn Tuần bắt đầu");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    const payload = {
      crm_team_id: selectedTeamId,
      template_id: selectedTemplateId,
      week_start: selectedWeekStart,
      skill_solution_id:
        selectedSkillGroupId !== "none" ? Number(selectedSkillGroupId) : null,
      skill_vendor_id:
        selectedSkillVendorId !== "none" ? Number(selectedSkillVendorId) : null,
    };

    try {
      const res = await kpiSetupService.applyTemplate(payload);
      if (!res.success || !res.data) {
        setError(res.message || "Áp dụng mẫu KPI thất bại");
        setIsSubmitting(false);
        return;
      }

      onApplied(res.data);
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Lỗi xử lý";
      setError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold flex items-center gap-2">
            <Layers className="w-5 h-5 text-[var(--color-markee-primary)]" />
            Tạo Kỳ KPI Tuần Cho Team
          </DialogTitle>
        </DialogHeader>

        {error && (
          <div className="flex items-center gap-2 p-3 text-sm text-red-600 bg-red-50 dark:bg-red-950/50 rounded-lg border border-red-200">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="space-y-4 py-2">
          {/* Select CRM Team */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5" />
              Chọn CRM Team <span className="text-red-500">*</span>
            </Label>
            <Select value={selectedTeamId} onValueChange={setSelectedTeamId}>
              <SelectTrigger>
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

          {/* Select Template */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5" />
              Chọn Mẫu KPI <span className="text-red-500">*</span>
            </Label>
            <Select value={selectedTemplateId} onValueChange={setSelectedTemplateId}>
              <SelectTrigger>
                <SelectValue placeholder="Chọn Mẫu KPI..." />
              </SelectTrigger>
              <SelectContent>
                {templates
                  .filter((t) => t.is_active)
                  .map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          {/* Select Week */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5" />
              Tuần KPI (Bắt đầu từ thứ Hai) <span className="text-red-500">*</span>
            </Label>
            <Select value={selectedWeekStart} onValueChange={setSelectedWeekStart}>
              <SelectTrigger>
                <SelectValue placeholder="Chọn tuần..." />
              </SelectTrigger>
              <SelectContent>
                {weekOptions.map((w) => (
                  <SelectItem key={w.startYmd} value={w.startYmd}>
                    {w.labelVi} {w.startYmd === defaultMondayStr ? "(Hiện tại)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* PM Plane.so Skills configuration */}
          <div className="p-3 border rounded-lg bg-surface/50 space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Award className="w-3.5 h-3.5 text-blue-600" />
                Cấu hình Skill PM Plane.so (Tuỳ chọn)
              </Label>
              {pmConfigured ? (
                <span className="text-[10px] text-emerald-600 font-medium bg-emerald-50 px-1.5 py-0.5 rounded">
                  Đã kết nối PM
                </span>
              ) : (
                <span className="text-[10px] text-muted-foreground">
                  (Chưa bật PM token)
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">Skill Solution:</span>
                <Select
                  value={selectedSkillGroupId}
                  onValueChange={setSelectedSkillGroupId}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Chọn Solution..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">-- Không chọn --</SelectItem>
                    {skillGroups.map((g) => (
                      <SelectItem key={g.id} value={String(g.id)}>
                        {g.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">Skill Vendor:</span>
                <Select
                  value={selectedSkillVendorId}
                  onValueChange={setSelectedSkillVendorId}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Chọn Vendor..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">-- Không chọn --</SelectItem>
                    {skillVendors.map((v) => (
                      <SelectItem key={v.id} value={String(v.id)}>
                        {v.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="mt-4 gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Hủy
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="bg-[var(--color-markee-primary)] hover:opacity-90 text-white"
          >
            {isSubmitting ? "Đang áp dụng..." : "Tạo kỳ KPI"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
