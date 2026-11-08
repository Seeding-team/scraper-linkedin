"use client";

import { useState } from "react";
import { CheckCircle2, AlertCircle, ExternalLink, RefreshCw, Send, Award } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  kpiSetupService,
  type KpiSessionDetail,
  type PmSyncResult,
} from "@/services/kpi-setup.service";

interface SyncPmModalProps {
  isOpen: boolean;
  onClose: () => void;
  session: KpiSessionDetail;
  onSynced: () => void;
}

export function SyncPmModal({
  isOpen,
  onClose,
  session,
  onSynced,
}: SyncPmModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<PmSyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSync = async () => {
    setIsSubmitting(true);
    setError(null);
    setResult(null);

    try {
      const res = await kpiSetupService.syncPm(session.id);
      if (!res.success) {
        setError(res.message || "Đồng bộ sang PM thất bại");
      } else {
        setResult(res.data || { success: true, message: "Đồng bộ thành công" });
        onSynced();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Lỗi kết nối";
      setError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !isSubmitting && onClose()}>
      <DialogContent className="w-full max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold flex items-center gap-2">
            <Award className="w-5 h-5 text-blue-600" />
            Đồng bộ KPI sang Plane.so (PM)
          </DialogTitle>
        </DialogHeader>

        {error && (
          <div className="flex items-center gap-2 p-3 text-sm text-red-600 bg-red-50 dark:bg-red-950/50 rounded-lg border border-red-200">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {result ? (
          <div className="space-y-4 py-3">
            <div className="p-4 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-center space-y-2">
              <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto" />
              <div className="text-base font-bold text-emerald-800 dark:text-emerald-300">
                Đồng bộ thành công!
              </div>
              <p className="text-xs text-muted-foreground">{result.message}</p>
            </div>

            <div className="grid grid-cols-2 gap-3 text-center text-xs">
              <div className="p-3 border rounded-lg bg-surface">
                <div className="text-muted-foreground">Task tạo mới</div>
                <div className="text-xl font-bold text-emerald-600">
                  {result.created_count ?? 0}
                </div>
              </div>
              <div className="p-3 border rounded-lg bg-surface">
                <div className="text-muted-foreground">Task cập nhật</div>
                <div className="text-xl font-bold text-blue-600">
                  {result.updated_count ?? 0}
                </div>
              </div>
            </div>

            {result.group_url && (
              <div className="pt-2 text-center">
                <a
                  href={result.group_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-blue-600 hover:underline font-medium"
                >
                  Mở Task Group trên Plane.so (kpi.markeeai.com)
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            )}

            <DialogFooter className="mt-4">
              <Button type="button" onClick={onClose} className="w-full">
                Đóng
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Hệ thống sẽ lấy kết quả đánh giá thực tế của tuần này, tính toán Manday
              của từng thành viên và gửi sang Plane.so dưới dạng Module & Tasks (nguồn:{" "}
              <code className="text-xs bg-muted px-1 py-0.5 rounded font-mono">seeding</code>
              ).
            </p>

            <div className="p-3 border rounded-lg bg-surface/50 space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Team:</span>
                <span className="font-semibold">{session.crm_teams?.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Tuần KPI:</span>
                <span className="font-semibold font-mono">
                  {session.week_start} → {session.week_end}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Mẫu áp dụng:</span>
                <span className="font-semibold">{session.kpi_templates?.name}</span>
              </div>
              {session.skill_solution_name && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Skill Solution:</span>
                  <span className="font-medium text-blue-600">
                    {session.skill_solution_name}
                  </span>
                </div>
              )}
            </div>

            <div className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 p-2.5 rounded border border-amber-200">
              Chỉ những thành viên đạt tối thiểu mốc Normal (Manday &gt; 0) mới được tạo
              task trên Plane.so. Các task đã đồng bộ trước đó sẽ được cập nhật lại theo
              kết quả mới nhất.
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
                onClick={handleSync}
                disabled={isSubmitting}
                className="gap-2 bg-blue-600 hover:bg-blue-700 text-white"
              >
                {isSubmitting ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Đang gửi sang Plane.so...
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    Xác nhận đồng bộ
                  </>
                )}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

