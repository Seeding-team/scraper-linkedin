"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { MaterialIcon } from "@/components/ui";
import { allPlatformKpiService } from "@/services/all-platform.service";
import { useAppAuth } from "@/contexts/AppAuthContext";
import { dispatchKpiRefresh } from "@/lib/useKpiRefresh";

interface TeamMember {
  id: string;
  email: string;
  name?: string;
  role?: string;
}

interface BulkAssignKpiModalProps {
  isOpen: boolean;
  onClose: () => void;
  members: TeamMember[];
  teamId: string;
  selectedWeekValue?: string;
  onSuccess: () => void;
}

export function BulkAssignKpiModal({
  isOpen,
  onClose,
  members,
  teamId,
  selectedWeekValue,
  onSuccess,
}: BulkAssignKpiModalProps) {
  const { user } = useAppAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedMemberIds, setSelectedMemberIds] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<{
    total: number;
    success_count: number;
    failed_count: number;
    results: Array<{ email: string; success: boolean; message: string }>;
  } | null>(null);

  // Default KPI values for all members
  const [kpiComment, setKpiComment] = useState<number>(0);
  const [kpiPost, setKpiPost] = useState<number>(0);
  const [kpiLead, setKpiLead] = useState<number>(0);
  const [kpiInbox, setKpiInbox] = useState<number>(0);
  const [isFailed, setIsFailed] = useState(false);
  const [reasonNotMet, setReasonNotMet] = useState("");
  // Generate weeks
  const generateWeeks = useCallback(() => {
    const year = new Date().getFullYear();
    const weeks = [];
    let firstDay = new Date(year, 0, 1);
    let dayOfWeek = firstDay.getDay() || 7;
    let startMonday = new Date(firstDay);
    startMonday.setDate(firstDay.getDate() - dayOfWeek + 1);

    for (let i = 1; i <= 52; i++) {
      let monday = new Date(startMonday);
      monday.setDate(startMonday.getDate() + (i - 1) * 7);
      let sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);

      const formatDate = (d: Date) => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        return `${y}-${m}-${day}`;
      };

      weeks.push({
        weekNumber: i,
        monday: formatDate(monday),
        sunday: formatDate(sunday),
        label: `Tuần ${i} (${formatDate(monday)} đến ${formatDate(sunday)})`,
      });
    }
    return weeks;
  }, []);

  const weeks = useMemo(() => generateWeeks(), [generateWeeks]);

  const getCurrentWeek = useCallback(() => {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, "0");
    const day = String(today.getDate()).padStart(2, "0");
    const todayStr = `${y}-${m}-${day}`;
    const current = weeks.find((w) => todayStr >= w.monday && todayStr <= w.sunday);
    return current ? current.weekNumber : Math.ceil((today.getMonth() + 1) / 1);
  }, [weeks]);

  const [selectedWeek, setSelectedWeek] = useState<number>(0);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      // Select all members by default
      setSelectedMemberIds(new Set(members.map((m) => m.id)));
      setError(null);
      setResults(null);
      setKpiComment(0);
      setKpiPost(0);
      setKpiLead(0);
      setKpiInbox(0);
      setIsFailed(false);
      setReasonNotMet("");
      // Set current week
      let initialWeek = getCurrentWeek();
      if (selectedWeekValue) {
        const [start] = selectedWeekValue.split("_");
        const found = weeks.find((w) => w.monday === start);
        if (found) initialWeek = found.weekNumber;
      }
      setSelectedWeek(initialWeek);
    }
  }, [isOpen, members, selectedWeekValue, weeks, getCurrentWeek]);

  const toggleMember = (id: string) => {
    setSelectedMemberIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const selectAll = () => {
    setSelectedMemberIds(new Set(members.map((m) => m.id)));
  };

  const selectNone = () => {
    setSelectedMemberIds(new Set());
  };

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (selectedMemberIds.size === 0) {
      setError("Vui lòng chọn ít nhất 1 thành viên");
      return;
    }

    const currentWeekData = weeks.find((w) => w.weekNumber === selectedWeek);
    if (!currentWeekData) {
      setError("Vui lòng chọn tuần hợp lệ");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      if (isFailed) {

  const words = reasonNotMet
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (words.length < 5) {
    setError("Lý do phải có ít nhất 5 từ.");
    setIsSubmitting(false);
    return;
  }

}
      const selectedMembers = members.filter((m) => selectedMemberIds.has(m.id));

      const payload = {
        leader_email: user?.email || "",
        id_team: teamId,
        start_day: currentWeekData.monday,
        end_day: currentWeekData.sunday,
        members: selectedMembers.map((m) => ({
          email: m.email,
          profile_slug: m.email,
          kpi_comment: kpiComment,
          kpi_post: kpiPost,
          kpi_lead: kpiLead,
          kpi_inbox: kpiInbox,
          is_failed: isFailed,
          reason_not_met: isFailed ? reasonNotMet : null,
        })),
        platform: "All",
      };

      const res = await allPlatformKpiService.bulkAssignKpi(payload);

      if (res.success && res.data) {
        setResults(res.data);
        // Trigger dashboard refresh
        dispatchKpiRefresh();
        // Also call onSuccess
        onSuccess();
      } else {
        setError(res.message || "Đã xảy ra lỗi khi giao KPI hàng loạt");
      }
    } catch (err) {
      setError("Lỗi hệ thống, vui lòng thử lại sau.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (isSubmitting) return;
    setResults(null);
    onClose();
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        zIndex: 99999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
      }}
    >
      {/* Backdrop */}
      <div
        onClick={handleClose}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          backgroundColor: "rgba(0, 0, 0, 0.5)",
          cursor: isSubmitting ? "not-allowed" : "pointer",
        }}
      />

      {/* Modal Content */}
      <div
        style={{
          position: "relative",
          zIndex: 10,
          width: "100%",
          maxWidth: "560px",
          backgroundColor: "#ffffff",
          borderRadius: "16px",
          border: "1px solid #e2e8f0",
          boxShadow:
            "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
          display: "flex",
          flexDirection: "column",
          maxHeight: "90vh",
          overflowY: "auto",
        }}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
          <div>
            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <MaterialIcon name="group_add" className="text-[#E3000F]" />
              Giao KPI hàng loạt
            </h2>
            <p className="text-xs text-slate-500 font-medium mt-0.5">
              {selectedMemberIds.size} / {members.length} thành viên được chọn
            </p>
          </div>
          <button
            onClick={handleClose}
            disabled={isSubmitting}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200/50 transition disabled:opacity-50"
          >
            <MaterialIcon name="close" className="text-[20px]" />
          </button>
        </div>

        {results ? (
          /* ── Results View ── */
          <div className="p-6 space-y-4">
            <div
              className={`p-4 rounded-xl border ${
                results.failed_count === 0
                  ? "bg-emerald-50 border-emerald-200"
                  : results.success_count === 0
                  ? "bg-red-50 border-red-200"
                  : "bg-amber-50 border-amber-200"
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <MaterialIcon
                  name={results.failed_count === 0 ? "check_circle" : "warning"}
                  className={
                    results.failed_count === 0
                      ? "text-emerald-600"
                      : results.success_count === 0
                      ? "text-red-600"
                      : "text-amber-600"
                  }
                />
                <span className="font-bold text-slate-800">
                  {results.failed_count === 0
                    ? "Thành công!"
                    : results.success_count === 0
                    ? "Thất bại"
                    : "Hoàn thành một phần"}
                </span>
              </div>
              <p className="text-sm text-slate-600">
                Đã giao KPI cho{" "}
                <span className="font-bold text-emerald-600">{results.success_count}</span> thành
                viên
                {results.failed_count > 0 && (
                  <>
                    {" "}
                    •{" "}
                    <span className="font-bold text-red-600">{results.failed_count}</span> thất bại
                  </>
                )}
              </p>
            </div>

            {results.results.length > 0 && (
              <div className="max-h-[200px] overflow-y-auto border border-slate-200 rounded-xl">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 sticky top-0">
                    <tr>
                      <th className="text-left px-3 py-2 font-bold text-slate-600">Thành viên</th>
                      <th className="text-left px-3 py-2 font-bold text-slate-600">
                        Trạng thái
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.results.map((r) => (
                      <tr key={r.email} className="border-t border-slate-100">
                        <td className="px-3 py-2 text-slate-700 truncate max-w-[200px]">
                          {r.email}
                        </td>
                        <td className="px-3 py-2">
                          {r.success ? (
                            <span className="text-emerald-600 font-bold">✓</span>
                          ) : (
                            <span className="text-red-600">
                              <span className="font-bold">✗</span> {r.message}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button
                onClick={handleClose}
                className="flex-1 py-2.5 rounded-xl bg-slate-100 text-slate-700 font-bold text-sm hover:bg-slate-200 transition"
              >
                Đóng
              </button>
              <button
                onClick={() => {
                  setResults(null);
                  setError(null);
                }}
                className="flex-1 py-2.5 rounded-xl bg-[#E3000F] text-white font-bold text-sm hover:bg-[#c0000c] transition"
              >
                Tiếp tục chỉnh sửa
              </button>
            </div>
          </div>
        ) : (
          /* ── Form View ── */
          <form onSubmit={handleSubmit} className="p-6 space-y-5">
            {error && (
              <div className="bg-red-50 text-red-600 p-3 rounded-xl text-xs font-medium flex items-start gap-2 border border-red-100">
                <MaterialIcon name="error" className="text-[16px] shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Week Selection */}
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                Chọn Tuần
              </label>
              <select
                value={selectedWeek}
                onChange={(e) => setSelectedWeek(Number(e.target.value))}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-700 outline-none focus:border-[#E3000F] focus:ring-2 focus:ring-[#E3000F]/20 transition cursor-pointer"
                required
              >
                {weeks.map((w) => (
                  <option key={w.weekNumber} value={w.weekNumber}>
                    {w.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Member Selection */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  Chọn Thành viên ({selectedMemberIds.size}/{members.length})
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={selectAll}
                    className="text-[10px] font-semibold text-blue-600 hover:text-blue-700"
                  >
                    Chọn tất cả
                  </button>
                  <button
                    type="button"
                    onClick={selectNone}
                    className="text-[10px] font-semibold text-slate-500 hover:text-slate-700"
                  >
                    Bỏ chọn
                  </button>
                </div>
              </div>
              <div className="max-h-[150px] overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100">
                {members.map((member) => (
                  <label
                    key={member.id}
                    className="flex items-center gap-3 px-3 py-2 hover:bg-slate-50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selectedMemberIds.has(member.id)}
                      onChange={() => toggleMember(member.id)}
                      className="w-4 h-4 rounded border-slate-300 text-[#E3000F] focus:ring-[#E3000F]/30"
                    />
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-slate-700 truncate">
                        {member.name || member.email}
                      </p>
                      <p className="text-[10px] text-slate-400 truncate">{member.email}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* KPI Values */}
            <div className="space-y-4 pt-2">
              <div className="rounded-xl border border-slate-200 p-4 space-y-3 mt-4">

  <label className="flex items-center gap-2 cursor-pointer">

    <input
      type="checkbox"
      checked={isFailed}
      onChange={(e) => {
        setIsFailed(e.target.checked);

        if (!e.target.checked) {
          setReasonNotMet("");
        }
      }}
    />

    <span className="text-sm font-medium">
      KPI không đạt
    </span>

  </label>

  {isFailed && (
    <textarea
      rows={3}
      value={reasonNotMet}
      onChange={(e) => setReasonNotMet(e.target.value)}
      placeholder="Nhập lý do không đạt KPI..."
      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#E3000F]"
    />
  )}

</div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                KPI cho tất cả thành viên được chọn
              </label>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-center justify-between gap-3 p-3 rounded-xl border border-slate-100 bg-white shadow-sm">
                  <div className="flex items-center gap-2">
                    <MaterialIcon name="comment" className="text-blue-500 text-[16px]" />
                    <span className="text-xs font-medium text-slate-700">Comment</span>
                  </div>
                  <input
                    type="number"
                    min="0"
                    value={kpiComment}
                    onChange={(e) => setKpiComment(parseInt(e.target.value) || 0)}
                    className="w-16 text-center font-bold bg-slate-50 border border-slate-200 rounded-lg py-1 text-xs focus:border-blue-500 outline-none"
                  />
                </div>

                <div className="flex items-center justify-between gap-3 p-3 rounded-xl border border-slate-100 bg-white shadow-sm">
                  <div className="flex items-center gap-2">
                    <MaterialIcon name="article" className="text-emerald-500 text-[16px]" />
                    <span className="text-xs font-medium text-slate-700">Post</span>
                  </div>
                  <input
                    type="number"
                    min="0"
                    value={kpiPost}
                    onChange={(e) => setKpiPost(parseInt(e.target.value) || 0)}
                    className="w-16 text-center font-bold bg-slate-50 border border-slate-200 rounded-lg py-1 text-xs focus:border-emerald-500 outline-none"
                  />
                </div>

                <div className="flex items-center justify-between gap-3 p-3 rounded-xl border border-slate-100 bg-white shadow-sm">
                  <div className="flex items-center gap-2">
                    <MaterialIcon name="person_add" className="text-amber-500 text-[16px]" />
                    <span className="text-xs font-medium text-slate-700">Lead</span>
                  </div>
                  <input
                    type="number"
                    min="0"
                    value={kpiLead}
                    onChange={(e) => setKpiLead(parseInt(e.target.value) || 0)}
                    className="w-16 text-center font-bold bg-slate-50 border border-slate-200 rounded-lg py-1 text-xs focus:border-amber-500 outline-none"
                  />
                </div>

                <div className="flex items-center justify-between gap-3 p-3 rounded-xl border border-slate-100 bg-white shadow-sm">
                  <div className="flex items-center gap-2">
                    <MaterialIcon name="inbox" className="text-purple-500 text-[16px]" />
                    <span className="text-xs font-medium text-slate-700">Inbox</span>
                  </div>
                  <input
                    type="number"
                    min="0"
                    value={kpiInbox}
                    onChange={(e) => setKpiInbox(parseInt(e.target.value) || 0)}
                    className="w-16 text-center font-bold bg-slate-50 border border-slate-200 rounded-lg py-1 text-xs focus:border-purple-500 outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Submit */}
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={handleClose}
                disabled={isSubmitting}
                className="flex-1 py-2.5 rounded-xl bg-slate-100 text-slate-700 font-bold text-sm hover:bg-slate-200 transition disabled:opacity-50"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={isSubmitting || selectedMemberIds.size === 0}
                className="flex-1 py-2.5 rounded-xl bg-[#E3000F] text-white font-bold text-sm hover:bg-[#c0000c] transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isSubmitting ? (
                  <>
                    <span className="animate-spin">
                      <MaterialIcon name="sync" className="text-[16px]" />
                    </span>
                    Đang xử lý...
                  </>
                ) : (
                  <>
                    <MaterialIcon name="check" className="text-[16px]" />
                    Giao KPI ({selectedMemberIds.size})
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
