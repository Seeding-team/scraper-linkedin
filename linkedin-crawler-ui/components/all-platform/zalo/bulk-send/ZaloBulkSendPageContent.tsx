"use client";

/**
 * Trang "Gửi hàng loạt" — port giao diện từ zalo-account-module/app/(dashboard)/bulk-send/page.tsx
 * (InvoiceFlowManager ZALO_CENTRALIZED_MODULE_GUIDE.md), chỉ đổi token màu brand
 * sang màu app này (xem lib/zaloUi.ts). Logic/data-fetching giữ nguyên 100% —
 * vẫn gọi đúng listZaloBulkJobs/createZaloBulkJob/patchZaloBulkJobStatus/
 * deleteZaloBulkJob/getZaloBulkJob đã có, không đổi hợp đồng backend.
 */

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Send,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { useZaloAccountOptions } from "../centralized-shared/useZaloAccountOptions";
import { ZaloAccountPicker } from "../centralized-shared/ZaloAccountPicker";
import {
  createZaloBulkJob,
  deleteZaloBulkJob,
  getZaloBulkJob,
  listZaloBulkJobs,
  patchZaloBulkJobStatus,
} from "@/services/zaloCrawlerService";
import type { ZaloBulkJob, ZaloBulkJobItem, ZaloBulkJobRecipient, ZaloBulkJobType } from "@/types/zalo-api";
import { alert, btn, btnSize, card, infoBox, input, label, pill, pageStack, table, textareaAuto } from "@/lib/zaloUi";

const JOB_TYPE_OPTIONS: { value: ZaloBulkJobType; label: string; icon: typeof Send }[] = [
  { value: "send_message", label: "Gửi tin nhắn", icon: Send },
  { value: "add_friend", label: "Kết bạn", icon: UserPlus },
  { value: "invite_group", label: "Mời vào nhóm", icon: Users },
];

function jobTypeMeta(type: ZaloBulkJobType) {
  return JOB_TYPE_OPTIONS.find((o) => o.value === type) || JOB_TYPE_OPTIONS[0];
}

function statusMeta(status: ZaloBulkJob["status"]) {
  switch (status) {
    case "pending":
      return { label: "Chờ xử lý", cls: pill.info };
    case "running":
      return { label: "Đang chạy", cls: pill.info };
    case "paused":
      return { label: "Tạm dừng", cls: pill.warning };
    case "completed":
      return { label: "Hoàn tất", cls: pill.success };
    case "cancelled":
      return { label: "Đã hủy", cls: pill.neutral };
    default:
      return { label: status, cls: pill.neutral };
  }
}

function itemStatusMeta(status: ZaloBulkJobItem["status"]) {
  switch (status) {
    case "sent":
      return { label: "Thành công", cls: pill.success };
    case "failed":
      return { label: "Thất bại", cls: pill.danger };
    case "not_found":
      return { label: "Không tìm thấy", cls: pill.warning };
    case "skipped":
      return { label: "Bỏ qua", cls: pill.neutral };
    default:
      return { label: "Đang chờ", cls: pill.info };
  }
}

function parseRecipients(raw: string): ZaloBulkJobRecipient[] {
  const seen = new Set<string>();
  const out: ZaloBulkJobRecipient[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [phoneOrUid, ...nameParts] = trimmed.split(",").map((s) => s.trim());
    const displayName = nameParts.join(", ") || undefined;
    const digits = phoneOrUid.replace(/\D/g, "");
    if (seen.has(digits)) continue;
    seen.add(digits);
    const isPhone = /^[0-9+][0-9+\s]{6,}$/.test(phoneOrUid);
    out.push(isPhone ? { phone: phoneOrUid, display_name: displayName } : { uid: phoneOrUid, display_name: displayName });
  }
  return out;
}

export function ZaloBulkSendPageContent() {
  const { accounts, selectedAccountId, setSelectedAccountId, loading: loadingAccounts } = useZaloAccountOptions();
  const [jobs, setJobs] = useState<ZaloBulkJob[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // ── Form tạo job ──
  const [jobType, setJobType] = useState<ZaloBulkJobType>("send_message");
  const [message, setMessage] = useState("");
  const [friendMessage, setFriendMessage] = useState("");
  const [imageUrlsRaw, setImageUrlsRaw] = useState("");
  const [recipientsRaw, setRecipientsRaw] = useState("");
  const [targetGroupName, setTargetGroupName] = useState("");
  const [delayMin, setDelayMin] = useState(3);
  const [delayMax, setDelayMax] = useState(8);
  const [submitting, setSubmitting] = useState(false);

  // ── Danh sách job + chi tiết item ──
  const [expandedJobId, setExpandedJobId] = useState<number | null>(null);
  const [itemsByJob, setItemsByJob] = useState<Record<number, ZaloBulkJobItem[]>>({});
  const [loadingItemsFor, setLoadingItemsFor] = useState<number | null>(null);
  const [pendingActionId, setPendingActionId] = useState<number | null>(null);

  const recipients = useMemo(() => parseRecipients(recipientsRaw), [recipientsRaw]);

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
  }, [reloadJobs]);

  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(id);
  }, [notice]);

  const hasActiveJobs = useMemo(() => jobs.some((j) => j.status === "pending" || j.status === "running"), [jobs]);
  useEffect(() => {
    if (!hasActiveJobs) return;
    const id = window.setInterval(() => void reloadJobs(), 3500);
    return () => window.clearInterval(id);
  }, [hasActiveJobs, reloadJobs]);

  const loadJobItems = useCallback(
    async (jobId: number) => {
      setLoadingItemsFor(jobId);
      try {
        const res = await getZaloBulkJob(selectedAccountId, jobId);
        setItemsByJob((prev) => ({ ...prev, [jobId]: res.items }));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Không tải được chi tiết job");
      } finally {
        setLoadingItemsFor((prev) => (prev === jobId ? null : prev));
      }
    },
    [selectedAccountId],
  );

  function toggleExpand(job: ZaloBulkJob) {
    if (expandedJobId === job.id) {
      setExpandedJobId(null);
      return;
    }
    setExpandedJobId(job.id);
    void loadJobItems(job.id);
  }

  const canSubmit =
    !submitting &&
    Boolean(selectedAccountId) &&
    recipients.length > 0 &&
    (jobType !== "send_message" || message.trim().length > 0) &&
    (jobType !== "invite_group" || targetGroupName.trim().length > 0);

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await createZaloBulkJob({
        account_id: selectedAccountId,
        job_type: jobType,
        recipients,
        message: (jobType === "send_message" || jobType === "invite_group") && message.trim() ? message.trim() : undefined,
        friend_message: jobType === "add_friend" && friendMessage.trim() ? friendMessage.trim() : undefined,
        image_urls: jobType === "send_message" ? imageUrlsRaw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : undefined,
        target_group_name: jobType === "invite_group" ? targetGroupName.trim() : undefined,
        delay_seconds_min: delayMin,
        delay_seconds_max: delayMax,
      });
      setNotice(`Đã tạo chiến dịch — ${recipients.length} người nhận sẽ được xử lý dần.`);
      setMessage("");
      setFriendMessage("");
      setImageUrlsRaw("");
      setRecipientsRaw("");
      setTargetGroupName("");
      await reloadJobs();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tạo được chiến dịch");
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePatchStatus(job: ZaloBulkJob, status: "paused" | "pending" | "cancelled") {
    setPendingActionId(job.id);
    setError(null);
    try {
      await patchZaloBulkJobStatus(selectedAccountId, job.id, status);
      await reloadJobs();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không cập nhật được trạng thái");
    } finally {
      setPendingActionId(null);
    }
  }

  async function handleDelete(job: ZaloBulkJob) {
    if (!window.confirm(`Xoá chiến dịch "${jobTypeMeta(job.job_type).label}"? Không thể hoàn tác.`)) return;
    setPendingActionId(job.id);
    setError(null);
    try {
      await deleteZaloBulkJob(selectedAccountId, job.id);
      setNotice("Đã xoá chiến dịch.");
      if (expandedJobId === job.id) setExpandedJobId(null);
      await reloadJobs();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không xoá được chiến dịch");
    } finally {
      setPendingActionId(null);
    }
  }

  return (
    <div className="flex-1 overflow-y-auto bg-[#f8f9fa] p-4 sm:p-6">
      <div className={`mx-auto max-w-6xl ${pageStack}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-800">Gửi tin nhắn hàng loạt</h1>
            <p className="text-sm text-muted-foreground">Nhắn tin, gửi lời mời kết bạn hoặc mời vào nhóm theo danh sách số điện thoại / UID.</p>
          </div>
          <ZaloAccountPicker accounts={accounts} value={selectedAccountId} onChange={setSelectedAccountId} loading={loadingAccounts} />
        </div>

        <div className={infoBox}>
          <Send className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
          <span>
            <strong>Gửi hàng loạt</strong> — Nhắn tin, gửi lời mời kết bạn hoặc mời vào nhóm theo danh sách số điện thoại hoặc UID Zalo.
          </span>
        </div>

        {error ? (
          <div className={`${alert.error} justify-between`}>
            <span className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </span>
            <button type="button" onClick={() => setError(null)} className="text-red-400 hover:text-red-600">
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : null}
        {notice ? (
          <div className={`${alert.success} justify-between`}>
            <span className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              {notice}
            </span>
            <button type="button" onClick={() => setNotice(null)} className="text-emerald-400 hover:text-emerald-600">
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : null}

        {!selectedAccountId ? null : (
          <div>
            <div className="mb-2 flex flex-wrap items-baseline gap-2">
              <h2 className="text-lg font-semibold text-[#0a1a2b]">Tạo chiến dịch mới</h2>
              <span className="text-[13px] text-[#6b7a8d]">· Chọn hành động, dán danh sách số, hệ thống tự xử lý</span>
            </div>

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <section className={`${card} bg-[#f8fafc] p-[18px_20px]`}>
                <div>
                  <label className={label}>
                    <span className="inline-flex items-center gap-2">
                      <Users className="h-3.5 w-3.5" /> Hành động
                    </span>
                  </label>
                  <div className="flex flex-wrap gap-x-4 gap-y-2">
                    {JOB_TYPE_OPTIONS.map((opt) => {
                      const Icon = opt.icon;
                      const active = jobType === opt.value;
                      return (
                        <label key={opt.value} className="flex cursor-pointer items-center gap-1.5 text-[13px] font-normal text-[#1f2a3a]">
                          <input type="radio" checked={active} onChange={() => setJobType(opt.value)} className="h-4 w-4 accent-brand" />
                          <Icon className="h-3.5 w-3.5 text-[#526479]" />
                          {opt.label}
                        </label>
                      );
                    })}
                  </div>
                </div>

                {jobType === "invite_group" ? (
                  <div className="mt-4">
                    <label className={label}>Tên/link nhóm cần mời vào *</label>
                    <input value={targetGroupName} onChange={(e) => setTargetGroupName(e.target.value)} className={input} />
                  </div>
                ) : null}

                {jobType === "send_message" || jobType === "invite_group" ? (
                  <div className="mt-4">
                    <label className={label}>{jobType === "send_message" ? "Nội dung tin nhắn *" : "Lời nhắn kèm"}</label>
                    <textarea
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      rows={3}
                      placeholder="Nhập nội dung sẽ gửi cho từng người..."
                      className={textareaAuto}
                    />
                  </div>
                ) : null}

                {jobType === "add_friend" ? (
                  <div className="mt-4">
                    <label className={label}>Nội dung khi kết bạn (tuỳ chọn)</label>
                    <textarea
                      value={friendMessage}
                      onChange={(e) => setFriendMessage(e.target.value)}
                      rows={3}
                      placeholder="Lời chào kèm lời mời kết bạn..."
                      className={textareaAuto}
                    />
                  </div>
                ) : null}

                {jobType === "send_message" ? (
                  <div className="mt-4">
                    <label className={label}>Link ảnh đính kèm (tuỳ chọn, mỗi dòng 1 link)</label>
                    <textarea value={imageUrlsRaw} onChange={(e) => setImageUrlsRaw(e.target.value)} rows={2} className={textareaAuto} />
                  </div>
                ) : null}
              </section>

              <section className={`${card} bg-[#f8fafc] p-[18px_20px]`}>
                <div>
                  <label className={label}>Danh sách số điện thoại hoặc UID *</label>
                  <p className="mb-2 text-[11.5px] text-[#7a8a9b]">
                    Mỗi dòng 1 người, có thể thêm ", Tên" phía sau. VD: 0912345678, Chị Lan
                  </p>
                  <textarea
                    value={recipientsRaw}
                    onChange={(e) => setRecipientsRaw(e.target.value)}
                    rows={9}
                    placeholder={"0987654321, Chị Lan\n0912345678\n0978123456"}
                    className={`${textareaAuto} min-h-[180px] font-mono text-xs`}
                  />
                  <p className="mt-2 text-[13px] font-medium text-[#2f3e50]">
                    Nhận diện được <strong>{recipients.length}</strong> người nhận hợp lệ.
                  </p>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className={label}>Giãn cách tối thiểu (giây)</label>
                    <input type="number" min={2} value={delayMin} onChange={(e) => setDelayMin(Math.max(2, Number(e.target.value) || 2))} className={input} />
                  </div>
                  <div>
                    <label className={label}>Giãn cách tối đa (giây)</label>
                    <input type="number" min={delayMin} value={delayMax} onChange={(e) => setDelayMax(Math.max(delayMin, Number(e.target.value) || delayMin))} className={input} />
                  </div>
                </div>

                <div className="mt-4 rounded-xl border-l-[3px] border-amber-400 bg-[#fff8e6] px-3 py-3 text-[12px] leading-relaxed text-[#7a6b3a]">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                    <span>Zalo có thể khoá tài khoản cá nhân nếu nhắn tin/kết bạn/mời nhóm quá nhanh hoặc quá nhiều. Khoảng giãn cách ngẫu nhiên giữa mỗi người (mặc định 3–8 giây).</span>
                  </div>
                </div>
              </section>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => void handleSubmit()} disabled={!canSubmit} className={`${btn.primary} ${btnSize.lg}`}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Gửi ngay
              </button>
            </div>
          </div>
        )}

        {/* ── Danh sách job ── */}
        <section className={card}>
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Chiến dịch đã tạo</h2>
              <p className="text-xs text-slate-500">Tối đa 200 chiến dịch gần nhất.</p>
            </div>
            <button type="button" onClick={() => void reloadJobs()} className={`${btn.ghost} ${btnSize.icon}`} title="Làm mới">
              <RefreshCw className={`h-4 w-4 ${loadingJobs ? "animate-spin" : ""}`} />
            </button>
          </div>

          <div className={table.wrapper}>
            <table className={table.root}>
              <thead>
                <tr className="border-b border-slate-100">
                  <th className={table.head}>Hành động</th>
                  <th className={table.head}>Trạng thái</th>
                  <th className={table.head}>Tiến độ</th>
                  <th className={table.head}>Kết quả</th>
                  <th className={table.head}>Tạo lúc</th>
                  <th className={`${table.head} text-right`}>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {jobs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-xs text-slate-500">
                      {loadingJobs ? "Đang tải..." : selectedAccountId ? "Chưa có chiến dịch nào." : "Chọn tài khoản Zalo để bắt đầu."}
                    </td>
                  </tr>
                ) : (
                  jobs.map((job) => {
                    const Icon = jobTypeMeta(job.job_type).icon;
                    const badge = statusMeta(job.status);
                    const pct = job.total_count > 0 ? Math.min(100, Math.round((job.sent_count / job.total_count) * 100)) : 0;
                    const canPauseResume = job.status === "pending" || job.status === "running" || job.status === "paused";
                    const canCancel = canPauseResume;
                    const busy = pendingActionId === job.id;
                    const isExpanded = expandedJobId === job.id;
                    return (
                      <Fragment key={job.id}>
                        <tr className={table.row}>
                          <td className={`${table.cell} font-medium text-slate-900`}>
                            <div className="flex items-center gap-2">
                              <button type="button" onClick={() => toggleExpand(job)} className="inline-flex h-5 w-5 shrink-0 items-center justify-center text-slate-400 hover:text-slate-700">
                                {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                              </button>
                              <Icon className="h-4 w-4 shrink-0 text-brand" />
                              {jobTypeMeta(job.job_type).label}
                              {job.job_type === "invite_group" && job.target_group_name ? (
                                <span className="truncate text-xs font-normal text-slate-400">→ {job.target_group_name}</span>
                              ) : null}
                            </div>
                          </td>
                          <td className={table.cell}>
                            <span className={badge.cls}>{badge.label}</span>
                          </td>
                          <td className={`${table.cell} w-40`}>
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                                <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${pct}%` }} />
                              </div>
                              <span className="shrink-0 text-xs text-slate-500">
                                {job.sent_count}/{job.total_count}
                              </span>
                            </div>
                          </td>
                          <td className={`${table.cell} text-xs text-slate-500`}>
                            <span className="text-emerald-600">{job.success_count} thành công</span>
                            {job.failed_count > 0 ? <span className="text-red-500"> · {job.failed_count} thất bại</span> : null}
                          </td>
                          <td className={`${table.cell} text-xs text-slate-500`}>{new Date(job.created_at).toLocaleString("vi-VN")}</td>
                          <td className={table.cell}>
                            <div className="flex items-center justify-end gap-1.5">
                              {canPauseResume ? (
                                job.status === "paused" ? (
                                  <button type="button" onClick={() => void handlePatchStatus(job, "pending")} disabled={busy} className={`${btn.outline} ${btnSize.icon}`} title="Tiếp tục">
                                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                                  </button>
                                ) : (
                                  <button type="button" onClick={() => void handlePatchStatus(job, "paused")} disabled={busy} className={`${btn.outline} ${btnSize.icon}`} title="Tạm dừng">
                                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pause className="h-3.5 w-3.5" />}
                                  </button>
                                )
                              ) : null}
                              {canCancel ? (
                                <button type="button" onClick={() => void handlePatchStatus(job, "cancelled")} disabled={busy} className={`${btn.warning} ${btnSize.icon}`} title="Hủy">
                                  <Ban className="h-3.5 w-3.5" />
                                </button>
                              ) : null}
                              <button type="button" onClick={() => void handleDelete(job)} disabled={busy} className={`${btn.danger} ${btnSize.icon}`} title="Xoá">
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                        {isExpanded ? (
                          <tr className="border-b border-slate-100 bg-slate-50/60">
                            <td colSpan={6} className="px-4 py-3">
                              {loadingItemsFor === job.id && !itemsByJob[job.id] ? (
                                <div className="flex items-center gap-1.5 py-2 text-xs text-slate-500">
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Đang tải danh sách...
                                </div>
                              ) : (itemsByJob[job.id] || []).length === 0 ? (
                                <div className="py-2 text-xs text-slate-500">Chưa có dữ liệu.</div>
                              ) : (
                                <div className="max-h-72 overflow-auto rounded-md border border-slate-200 bg-white">
                                  <table className="w-full text-xs">
                                    <thead className="sticky top-0 bg-slate-100 text-slate-500">
                                      <tr>
                                        <th className="px-3 py-1.5 text-left font-semibold">SĐT / UID</th>
                                        <th className="px-3 py-1.5 text-left font-semibold">Tên hiển thị</th>
                                        <th className="px-3 py-1.5 text-left font-semibold">Trạng thái</th>
                                        <th className="px-3 py-1.5 text-left font-semibold">Lỗi</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {(itemsByJob[job.id] || []).map((it) => {
                                        const im = itemStatusMeta(it.status);
                                        return (
                                          <tr key={it.id} className="border-t border-slate-100">
                                            <td className="px-3 py-1.5 font-mono">{it.phone || (it.uid ? `uid:${it.uid}` : "—")}</td>
                                            <td className="px-3 py-1.5">{it.display_name || "—"}</td>
                                            <td className="px-3 py-1.5">
                                              <span className={im.cls}>{im.label}</span>
                                            </td>
                                            <td className="max-w-[240px] truncate px-3 py-1.5 text-red-600" title={it.error || ""}>
                                              {it.error || ""}
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
