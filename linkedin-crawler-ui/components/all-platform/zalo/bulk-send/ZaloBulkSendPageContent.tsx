"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { MaterialIcon } from "@/components/ui";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useZaloAccountOptions } from "../centralized-shared/useZaloAccountOptions";
import { ZaloAccountPicker } from "../centralized-shared/ZaloAccountPicker";
import { CreateBulkJobDialog } from "./CreateBulkJobDialog";
import { deleteZaloBulkJob, getZaloBulkJob, listZaloBulkJobs, patchZaloBulkJobStatus } from "@/services/zaloCrawlerService";
import type { ZaloBulkJob, ZaloBulkJobItem } from "@/types/zalo-api";

const JOB_TYPE_LABEL: Record<string, string> = {
  send_message: "Gửi tin nhắn",
  add_friend: "Kết bạn",
  invite_group: "Mời vào nhóm",
};

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-surface-container text-muted-foreground border-border",
  running: "bg-blue-100 text-blue-700 border-blue-200",
  completed: "bg-green-100 text-green-700 border-green-200",
  paused: "bg-amber-100 text-amber-700 border-amber-200",
  cancelled: "bg-red-100 text-red-700 border-red-200",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Chờ xử lý",
  running: "Đang chạy",
  completed: "Hoàn tất",
  paused: "Tạm dừng",
  cancelled: "Đã huỷ",
};

export function ZaloBulkSendPageContent() {
  const { accounts, selectedAccountId, setSelectedAccountId, loading: loadingAccounts } = useZaloAccountOptions();
  const [jobs, setJobs] = useState<ZaloBulkJob[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailJob, setDetailJob] = useState<ZaloBulkJob | null>(null);
  const [detailItems, setDetailItems] = useState<ZaloBulkJobItem[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const reloadJobs = useCallback(async () => {
    if (!selectedAccountId) {
      setJobs([]);
      return;
    }
    setLoadingJobs(true);
    setError(null);
    try {
      const res = await listZaloBulkJobs(selectedAccountId);
      setJobs(res.jobs);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tải được danh sách job");
    } finally {
      setLoadingJobs(false);
    }
  }, [selectedAccountId]);

  useEffect(() => {
    void reloadJobs();
    if (!selectedAccountId) return;
    const interval = setInterval(() => void reloadJobs(), 5000);
    return () => clearInterval(interval);
  }, [reloadJobs, selectedAccountId]);

  async function handleStatusChange(job: ZaloBulkJob, status: string) {
    try {
      await patchZaloBulkJobStatus(selectedAccountId, job.id, status);
      void reloadJobs();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không đổi được trạng thái job");
    }
  }

  async function handleDelete(job: ZaloBulkJob) {
    if (!confirm("Xoá job này? Hành động không thể hoàn tác.")) return;
    try {
      await deleteZaloBulkJob(selectedAccountId, job.id);
      setJobs((prev) => prev.filter((j) => j.id !== job.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không xoá được job");
    }
  }

  async function openDetail(job: ZaloBulkJob) {
    setDetailJob(job);
    setLoadingDetail(true);
    try {
      const res = await getZaloBulkJob(selectedAccountId, job.id);
      setDetailItems(res.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tải được chi tiết job");
    } finally {
      setLoadingDetail(false);
    }
  }

  return (
    <div className="flex-1 overflow-y-auto bg-[#f8f9fa] p-6">
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-800">Gửi tin nhắn hàng loạt</h1>
            <p className="text-sm text-muted-foreground">
              Gửi tin / kết bạn / mời vào nhóm theo danh sách SĐT hoặc UID, kết hợp được nhiều hành động 1 lượt.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <ZaloAccountPicker accounts={accounts} value={selectedAccountId} onChange={setSelectedAccountId} loading={loadingAccounts} />
            {selectedAccountId && <CreateBulkJobDialog accountId={selectedAccountId} onCreated={reloadJobs} />}
          </div>
        </div>

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}</div>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Danh sách job</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingJobs ? (
              <div className="py-8 text-center text-sm text-muted-foreground">Đang tải...</div>
            ) : jobs.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
                <MaterialIcon name="send" className="text-3xl text-muted-foreground" />
                Chưa có job nào. Bấm "Tạo job gửi hàng loạt" để bắt đầu.
              </div>
            ) : (
              <div className="flex flex-col divide-y divide-border">
                {jobs.map((job) => {
                  const progress = job.total_count > 0 ? Math.round((job.sent_count / job.total_count) * 100) : 0;
                  return (
                    <button
                      key={job.id}
                      onClick={() => void openDetail(job)}
                      className="flex flex-col gap-2 py-3 text-left hover:bg-accent/40 rounded-md px-2 -mx-2"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className={STATUS_STYLE[job.status] || ""}>
                            {STATUS_LABEL[job.status] || job.status}
                          </Badge>
                          <span className="text-sm font-semibold text-slate-800">{JOB_TYPE_LABEL[job.job_type] || job.job_type}</span>
                          <span className="text-xs text-muted-foreground">#{job.id}</span>
                        </div>
                        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                          {job.status === "running" && (
                            <Button variant="ghost" size="sm" onClick={() => void handleStatusChange(job, "paused")}>
                              <MaterialIcon name="pause_circle" className="text-base" />
                            </Button>
                          )}
                          {job.status === "paused" && (
                            <Button variant="ghost" size="sm" onClick={() => void handleStatusChange(job, "pending")}>
                              <MaterialIcon name="refresh" className="text-base" />
                            </Button>
                          )}
                          {(job.status === "pending" || job.status === "running" || job.status === "paused") && (
                            <Button variant="ghost" size="sm" onClick={() => void handleStatusChange(job, "cancelled")}>
                              <MaterialIcon name="block" className="text-base" />
                            </Button>
                          )}
                          <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => void handleDelete(job)}>
                            <MaterialIcon name="delete" className="text-base" />
                          </Button>
                        </div>
                      </div>
                      <Progress value={progress} className="h-1.5" />
                      <p className="text-xs text-muted-foreground">
                        {job.sent_count}/{job.total_count} đã xử lý · {job.success_count} thành công · {job.failed_count} thất bại
                      </p>
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Sheet open={!!detailJob} onOpenChange={(open) => !open && setDetailJob(null)}>
        <SheetContent className="w-full max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Chi tiết job #{detailJob?.id}</SheetTitle>
          </SheetHeader>
          <div className="p-4">
            {loadingDetail ? (
              <div className="py-6 text-center text-sm text-muted-foreground">Đang tải...</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Người nhận</TableHead>
                    <TableHead>Trạng thái</TableHead>
                    <TableHead>Lỗi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detailItems.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="text-xs">{item.display_name || item.phone || item.uid}</TableCell>
                      <TableCell className="text-xs">{item.status}</TableCell>
                      <TableCell className="max-w-[160px] truncate text-xs text-destructive">{item.error || ""}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
