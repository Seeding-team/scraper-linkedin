"use client";

import { useEffect, useState } from "react";
import { Plus, Edit2, Trash2, CheckCircle2, XCircle, ArrowRight, Layers, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  kpiSetupService,
  type KpiTemplate,
} from "@/services/kpi-setup.service";
import { TemplateEditorModal } from "./TemplateEditorModal";

interface TemplateManagerProps {
  onApplyTemplate?: (template: KpiTemplate) => void;
}

export function TemplateManager({ onApplyTemplate }: TemplateManagerProps) {
  const [templates, setTemplates] = useState<KpiTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<KpiTemplate | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadTemplates = async () => {
    setIsLoading(true);
    setError(null);
    const res = await kpiSetupService.getTemplates();
    if (!res.success || !res.data) {
      setError(res.message || "Không thể tải danh sách mẫu KPI");
    } else {
      setTemplates(res.data);
    }
    setIsLoading(false);
  };

  useEffect(() => {
    let isMounted = true;
    async function fetchTemplates() {
      setError(null);
      const res = await kpiSetupService.getTemplates();
      if (!isMounted) return;
      if (!res.success || !res.data) {
        setError(res.message || "Không thể tải danh sách mẫu KPI");
      } else {
        setTemplates(res.data);
      }
      setIsLoading(false);
    }

    void fetchTemplates();
    return () => {
      isMounted = false;
    };
  }, []);

  const handleCreate = () => {
    setSelectedTemplate(null);
    setEditorOpen(true);
  };

  const handleEdit = (tpl: KpiTemplate) => {
    setSelectedTemplate(tpl);
    setEditorOpen(true);
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Bạn có chắc chắn muốn xoá mẫu KPI "${name}" không?`)) {
      return;
    }

    setDeletingId(id);
    const res = await kpiSetupService.deleteTemplate(id);
    setDeletingId(null);

    if (!res.success) {
      alert(res.message || "Không thể xoá mẫu KPI");
      return;
    }

    loadTemplates();
  };

  return (
    <div className="space-y-6">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-2 border-b">
        <div>
          <h2 className="text-lg font-bold text-foreground">
            Danh sách Mẫu KPI (KPI Templates)
          </h2>
          <p className="text-sm text-muted-foreground">
            Thiết lập mốc đánh giá, manday và quy tắc thưởng chung để áp dụng cho các kỳ tuần của các Team
          </p>
        </div>
        <Button
          onClick={handleCreate}
          className="gap-1.5 bg-[var(--color-markee-primary)] hover:opacity-90 text-white shrink-0"
        >
          <Plus className="w-4 h-4" />
          Tạo mẫu mới
        </Button>
      </div>

      {error && (
        <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm">
          {error}
        </div>
      )}

      {isLoading ? (
        <div className="py-16 text-center text-muted-foreground">
          Đang tải dữ liệu mẫu KPI...
        </div>
      ) : templates.length === 0 ? (
        <div className="p-12 border-2 border-dashed rounded-xl text-center space-y-3">
          <Layers className="w-10 h-10 text-muted-foreground mx-auto" />
          <div className="text-base font-semibold">Chưa có mẫu KPI nào</div>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Tạo mẫu KPI đầu tiên với các mốc đánh giá bài cào để bắt đầu áp dụng vào kỳ tuần cho từng Team.
          </p>
          <Button
            onClick={handleCreate}
            variant="outline"
            className="gap-2 mt-2"
          >
            <Plus className="w-4 h-4" />
            Tạo mẫu ngay
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {templates.map((tpl) => (
            <Card
              key={tpl.id}
              className="border hover:border-[var(--color-markee-primary)]/40 transition-all flex flex-col justify-between"
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1">
                    <CardTitle className="text-base font-bold flex items-center gap-2">
                      {tpl.name}
                      {tpl.is_active ? (
                        <Badge
                          variant="secondary"
                          className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs gap-1 font-normal"
                        >
                          <CheckCircle2 className="w-3 h-3" /> Đang dùng
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="text-muted-foreground text-xs gap-1 font-normal"
                        >
                          <XCircle className="w-3 h-3" /> Tạm dừng
                        </Badge>
                      )}
                    </CardTitle>
                    {tpl.description && (
                      <CardDescription className="text-xs text-muted-foreground line-clamp-2">
                        {tpl.description}
                      </CardDescription>
                    )}
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleEdit(tpl)}
                      className="h-8 w-8 hover:bg-muted"
                      title="Sửa mẫu"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDelete(tpl.id, tpl.name)}
                      disabled={deletingId === tpl.id}
                      className="h-8 w-8 text-red-500 hover:text-red-700 hover:bg-red-50"
                      title="Xoá mẫu"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="space-y-4 pt-0">
                {/* Levels breakdown */}
                <div className="border rounded-md overflow-hidden bg-muted/20">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50 border-b text-muted-foreground font-medium text-left">
                      <tr>
                        <th className="p-2">Chỉ số</th>
                        <th className="p-2 text-center">Normal</th>
                        <th className="p-2 text-center">High</th>
                        <th className="p-2 text-center">Critical</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {(tpl.levels || []).map((lvl) => (
                        <tr key={lvl.metric_code}>
                          <td className="p-2 font-medium font-mono text-foreground">
                            {lvl.metric_code}
                          </td>
                          <td className="p-2 text-center">
                            <span className="font-semibold">{lvl.normal_count}</span>
                            <span className="text-[10px] text-muted-foreground block">
                              ({lvl.manday_normal}d)
                            </span>
                          </td>
                          <td className="p-2 text-center">
                            <span className="font-semibold text-blue-600">{lvl.high_count}</span>
                            <span className="text-[10px] text-muted-foreground block">
                              ({lvl.manday_high}d)
                            </span>
                          </td>
                          <td className="p-2 text-center">
                            <span className="font-semibold text-rose-600">{lvl.critical_count}</span>
                            <span className="text-[10px] text-muted-foreground block">
                              ({lvl.manday_critical}d)
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Bonus rules count */}
                {(tpl.bonus_rules?.length || 0) > 0 && (
                  <div className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 p-2 rounded-md border border-amber-200 dark:border-amber-900/50">
                    <Sparkles className="w-3.5 h-3.5 shrink-0" />
                    <span>
                      {tpl.bonus_rules.length} quy tắc thưởng vượt mức (bonus manday)
                    </span>
                  </div>
                )}

                {/* Action footer */}
                {onApplyTemplate && (
                  <div className="pt-2 flex justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onApplyTemplate(tpl)}
                      className="gap-1.5 text-xs border-[var(--color-markee-primary)] text-[var(--color-markee-primary)] hover:bg-[var(--color-markee-primary)] hover:text-white"
                    >
                      Áp dụng vào Kỳ của Team
                      <ArrowRight className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Editor Modal */}
      {editorOpen && (
        <TemplateEditorModal
          isOpen={editorOpen}
          onClose={() => setEditorOpen(false)}
          template={selectedTemplate}
          onSaved={() => {
            loadTemplates();
          }}
        />
      )}
    </div>
  );
}

