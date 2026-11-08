"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, AlertCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
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
  type KpiTemplate,
  type KpiTemplateLevel,
  type KpiBonusRule,
  type MetricInfo,
} from "@/services/kpi-setup.service";

interface TemplateEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  template: KpiTemplate | null;
  onSaved: () => void;
}

export function TemplateEditorModal({
  isOpen,
  onClose,
  template,
  onSaved,
}: TemplateEditorModalProps) {
  const [metrics, setMetrics] = useState<MetricInfo[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [levels, setLevels] = useState<Record<string, KpiTemplateLevel>>({});
  const [bonusRules, setBonusRules] = useState<KpiBonusRule[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load metrics dynamically on open
  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;
    async function loadData() {
      setIsLoading(true);
      setError(null);
      const res = await kpiSetupService.getMetrics();
      if (!isMounted) return;

      if (!res.success || !res.data) {
        setError(res.message || "Không thể tải danh sách metric");
        setIsLoading(false);
        return;
      }

      const loadedMetrics = res.data;
      setMetrics(loadedMetrics);

      if (template) {
        setName(template.name);
        setDescription(template.description || "");
        setIsActive(template.is_active);

        // Map existing levels by metric_code
        const lvlMap: Record<string, KpiTemplateLevel> = {};
        for (const m of loadedMetrics) {
          const found = template.levels?.find((l) => l.metric_code === m.code);
          if (found) {
            lvlMap[m.code] = {
              ...found,
              normal_count: found.normal_count ?? (found as any).level_normal ?? 0,
              high_count: found.high_count ?? (found as any).level_high ?? 0,
              critical_count: found.critical_count ?? (found as any).level_critical ?? 0,
              manday_normal: found.manday_normal ?? 0,
              manday_high: found.manday_high ?? 0,
              manday_critical: found.manday_critical ?? 0,
            };
          } else {
            lvlMap[m.code] = {
              metric_code: m.code,
              normal_count: 10,
              high_count: 20,
              critical_count: 30,
              manday_normal: 1.0,
              manday_high: 2.0,
              manday_critical: 3.0,
            };
          }
        }
        setLevels(lvlMap);
        setBonusRules(template.bonus_rules ? [...template.bonus_rules] : []);
      } else {
        setName("");
        setDescription("");
        setIsActive(true);

        const lvlMap: Record<string, KpiTemplateLevel> = {};
        for (const m of loadedMetrics) {
          lvlMap[m.code] = {
            metric_code: m.code,
            normal_count: m.code === "can-lien-he" ? 10 : 30,
            high_count: m.code === "can-lien-he" ? 20 : 60,
            critical_count: m.code === "can-lien-he" ? 30 : 100,
            manday_normal: 1.0,
            manday_high: 2.0,
            manday_critical: 3.0,
          };
        }
        setLevels(lvlMap);
        setBonusRules([]);
      }
      setIsLoading(false);
    }

    void loadData();
    return () => {
      isMounted = false;
    };
  }, [isOpen, template]);

  const handleLevelChange = (
    code: string,
    field: keyof KpiTemplateLevel,
    val: number
  ) => {
    setLevels((prev) => ({
      ...prev,
      [code]: {
        ...(prev[code] || {
          metric_code: code,
          normal_count: 0,
          high_count: 0,
          critical_count: 0,
          manday_normal: 0,
          manday_high: 0,
          manday_critical: 0,
        }),
        [field]: val,
      },
    }));
  };

  const handleAddBonusRule = () => {
    if (metrics.length === 0) return;
    setBonusRules((prev) => [
      ...prev,
      {
        metric_code: metrics[0].code,
        min_count: 50,
        bonus_manday: 0.5,
        requires_tier: "critical",
      },
    ]);
  };

  const handleRemoveBonusRule = (idx: number) => {
    setBonusRules((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleBonusRuleChange = <K extends keyof KpiBonusRule>(
    idx: number,
    field: K,
    val: KpiBonusRule[K]
  ) => {
    setBonusRules((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: val };
      return next;
    });
  };

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError("Vui lòng nhập tên mẫu KPI");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    const levelsArray: KpiTemplateLevel[] = Object.values(levels).map((lvl) => ({
      ...lvl,
      level_normal: lvl.normal_count,
      level_high: lvl.high_count,
      level_critical: lvl.critical_count,
    }));
    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      is_active: isActive,
      levels: levelsArray,
      bonus_rules: bonusRules,
    };

    try {
      let res;
      if (template) {
        res = await kpiSetupService.updateTemplate(template.id, payload);
      } else {
        res = await kpiSetupService.createTemplate(payload);
      }

      if (!res.success) {
        setError(res.message || "Lưu mẫu KPI thất bại");
        setIsSubmitting(false);
        return;
      }

      onSaved();
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
      <DialogContent className="w-full max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">
            {template ? "Chỉnh sửa Mẫu KPI" : "Tạo Mẫu KPI Mới"}
          </DialogTitle>
        </DialogHeader>

        {error && (
          <div className="flex items-center gap-2 p-3 text-sm text-red-600 bg-red-50 dark:bg-red-950/50 rounded-lg border border-red-200 dark:border-red-800">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {isLoading ? (
          <div className="py-12 text-center text-muted-foreground">
            Đang tải dữ liệu...
          </div>
        ) : (
          <div className="space-y-6 py-2">
            {/* General Info */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="template-name">
                  Tên mẫu KPI <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="template-name"
                  placeholder="Ví dụ: Mẫu KPI Seeding Chuẩn Q4"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div className="flex items-center justify-between p-3 border rounded-lg bg-surface/50">
                <div>
                  <div className="font-medium text-sm">Trạng thái kích hoạt</div>
                  <div className="text-xs text-muted-foreground">
                    Cho phép chọn mẫu này khi tạo kỳ KPI mới
                  </div>
                </div>
                <Switch checked={isActive} onCheckedChange={setIsActive} />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="template-desc">Mô tả mẫu</Label>
              <Textarea
                id="template-desc"
                rows={2}
                placeholder="Ghi chú thêm về tiêu chuẩn đánh giá của mẫu này..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            {/* Metric Levels */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">
                  Mốc Đánh Giá & Manday Từng Chỉ Số (Động)
                </h3>
                <span className="text-xs text-muted-foreground">
                  (Lấy tự động từ Danh mục Đánh giá bài cào)
                </span>
              </div>

              <div className="border rounded-lg overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 border-b text-xs font-semibold text-muted-foreground text-left">
                    <tr>
                      <th className="p-3 min-w-[160px]">Chỉ số (Metric)</th>
                      <th className="p-3 min-w-[170px]">Mức Normal (Cơ bản)</th>
                      <th className="p-3 min-w-[170px]">Mức High (Nâng cao)</th>
                      <th className="p-3 min-w-[170px]">Mức Critical (Xuất sắc)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {metrics.map((m) => {
                      const lvl = levels[m.code] || {
                        metric_code: m.code,
                        normal_count: 0,
                        high_count: 0,
                        critical_count: 0,
                        manday_normal: 0,
                        manday_high: 0,
                        manday_critical: 0,
                      };
                      return (
                        <tr key={m.code} className="hover:bg-muted/20">
                          <td className="p-3 align-top">
                            <div className="font-medium text-foreground">
                              {m.name}
                            </div>
                            <div className="text-xs text-muted-foreground font-mono">
                              {m.code}
                            </div>
                          </td>

                          {/* Normal */}
                          <td className="p-3 align-top">
                            <div className="space-y-1.5">
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs text-muted-foreground w-12">
                                  Mốc:
                                </span>
                                <Input
                                  type="number"
                                  min={0}
                                  className="h-8 text-xs"
                                  value={lvl.normal_count}
                                  onChange={(e) =>
                                    handleLevelChange(
                                      m.code,
                                      "normal_count",
                                      Number(e.target.value)
                                    )
                                  }
                                />
                              </div>
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs text-muted-foreground w-12">
                                  Manday:
                                </span>
                                <Input
                                  type="number"
                                  step="0.1"
                                  min={0}
                                  className="h-8 text-xs"
                                  value={lvl.manday_normal}
                                  onChange={(e) =>
                                    handleLevelChange(
                                      m.code,
                                      "manday_normal",
                                      Number(e.target.value)
                                    )
                                  }
                                />
                              </div>
                            </div>
                          </td>

                          {/* High */}
                          <td className="p-3 align-top">
                            <div className="space-y-1.5">
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs text-muted-foreground w-12">
                                  Mốc:
                                </span>
                                <Input
                                  type="number"
                                  min={0}
                                  className="h-8 text-xs"
                                  value={lvl.high_count}
                                  onChange={(e) =>
                                    handleLevelChange(
                                      m.code,
                                      "high_count",
                                      Number(e.target.value)
                                    )
                                  }
                                />
                              </div>
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs text-muted-foreground w-12">
                                  Manday:
                                </span>
                                <Input
                                  type="number"
                                  step="0.1"
                                  min={0}
                                  className="h-8 text-xs"
                                  value={lvl.manday_high}
                                  onChange={(e) =>
                                    handleLevelChange(
                                      m.code,
                                      "manday_high",
                                      Number(e.target.value)
                                    )
                                  }
                                />
                              </div>
                            </div>
                          </td>

                          {/* Critical */}
                          <td className="p-3 align-top">
                            <div className="space-y-1.5">
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs text-muted-foreground w-12">
                                  Mốc:
                                </span>
                                <Input
                                  type="number"
                                  min={0}
                                  className="h-8 text-xs font-semibold text-rose-600"
                                  value={lvl.critical_count}
                                  onChange={(e) =>
                                    handleLevelChange(
                                      m.code,
                                      "critical_count",
                                      Number(e.target.value)
                                    )
                                  }
                                />
                              </div>
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs text-muted-foreground w-12">
                                  Manday:
                                </span>
                                <Input
                                  type="number"
                                  step="0.1"
                                  min={0}
                                  className="h-8 text-xs font-semibold text-rose-600"
                                  value={lvl.manday_critical}
                                  onChange={(e) =>
                                    handleLevelChange(
                                      m.code,
                                      "manday_critical",
                                      Number(e.target.value)
                                    )
                                  }
                                />
                              </div>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Bonus Rules */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">
                    Quy Tắc Thưởng Vượt Mức (Bonus Manday)
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Cộng thêm manday khi số bài cào vượt qua các ngưỡng đặc biệt
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleAddBonusRule}
                  className="gap-1.5 text-xs"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Thêm quy tắc
                </Button>
              </div>

              {bonusRules.length === 0 ? (
                <div className="p-4 border border-dashed rounded-lg text-center text-xs text-muted-foreground">
                  Chưa có quy tắc thưởng nào. Bấm &quot;Thêm quy tắc&quot; nếu muốn thưởng thêm manday khi đạt số lượng lớn.
                </div>
              ) : (
                <div className="space-y-2">
                  {bonusRules.map((rule, idx) => (
                    <div
                      key={idx}
                      className="flex flex-wrap items-center gap-3 p-3 border rounded-lg bg-surface/40"
                    >
                      <div className="w-44">
                        <Label className="text-xs text-muted-foreground">
                          Chỉ số
                        </Label>
                        <Select
                          value={rule.metric_code}
                          onValueChange={(val) =>
                            handleBonusRuleChange(idx, "metric_code", val)
                          }
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {metrics.map((m) => (
                              <SelectItem key={m.code} value={m.code}>
                                {m.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="w-32">
                        <Label className="text-xs text-muted-foreground">
                          Tối thiểu (Min bài)
                        </Label>
                        <Input
                          type="number"
                          min={1}
                          className="h-8 text-xs"
                          value={rule.min_count}
                          onChange={(e) =>
                            handleBonusRuleChange(
                              idx,
                              "min_count",
                              Number(e.target.value)
                            )
                          }
                        />
                      </div>

                      <div className="w-28">
                        <Label className="text-xs text-muted-foreground">
                          + Manday
                        </Label>
                        <Input
                          type="number"
                          step="0.1"
                          min={0}
                          className="h-8 text-xs font-semibold text-emerald-600"
                          value={rule.bonus_manday}
                          onChange={(e) =>
                            handleBonusRuleChange(
                              idx,
                              "bonus_manday",
                              Number(e.target.value)
                            )
                          }
                        />
                      </div>

                      <div className="w-36">
                        <Label className="text-xs text-muted-foreground">
                          Đòi hỏi mức
                        </Label>
                        <Select
                          value={rule.requires_tier || "none"}
                          onValueChange={(val) =>
                            handleBonusRuleChange(
                              idx,
                              "requires_tier",
                              val === "none" ? null : (val as "normal" | "high" | "critical")
                            )
                          }
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Không yêu cầu</SelectItem>
                            <SelectItem value="normal">Normal</SelectItem>
                            <SelectItem value="high">High</SelectItem>
                            <SelectItem value="critical">Critical</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="pt-4 ml-auto">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => handleRemoveBonusRule(idx)}
                          className="h-8 w-8 text-red-500 hover:text-red-700 hover:bg-red-50"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

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
            disabled={isLoading || isSubmitting}
            className="bg-[var(--color-markee-primary)] hover:opacity-90 text-white"
          >
            {isSubmitting ? "Đang lưu..." : template ? "Cập nhật mẫu" : "Tạo mẫu KPI"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

