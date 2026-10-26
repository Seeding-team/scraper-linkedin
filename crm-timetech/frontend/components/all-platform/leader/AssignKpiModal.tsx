"use client";

import { useState, useEffect, useMemo } from "react";
import { MaterialIcon } from "@/components/ui";
import { allPlatformKpiService } from "@/services/all-platform.service";
import { useAppAuth } from "@/contexts/AppAuthContext";

interface AssignKpiModalProps {
  isOpen: boolean;
  onClose: () => void;
  member: any;
  teamId?: string;
  selectedWeekValue?: string; // YYYY-MM-DD_YYYY-MM-DD
  onSuccess: () => void;
}

export function AssignKpiModal({ isOpen, onClose, member, teamId, selectedWeekValue, onSuccess }: AssignKpiModalProps) {
  const { user } = useAppAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form State
  const [kpiComment, setKpiComment] = useState<number>(member.kpiCommentTarget || 0);
  const [kpiPost, setKpiPost] = useState<number>(member.kpiPostTarget || 0);
  const [kpiLead, setKpiLead] = useState<number>(member.kpiLeadTarget || 0);
  const [kpiInbox, setKpiInbox] = useState<number>(member.kpiInboxTarget || member.kpi_inbox_target || 0);
  const [isFailed, setIsFailed] = useState(false);
  const [reasonNotMet, setReasonNotMet] = useState("");
  // Generate weeks for current year
  const generateWeeks = () => {
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
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
      };

      weeks.push({
        weekNumber: i,
        monday: formatDate(monday),
        sunday: formatDate(sunday),
        label: `Tuần ${i} (${formatDate(monday)} đến ${formatDate(sunday)})`
      });
    }
    return weeks;
  };

  const weeks = useMemo(() => generateWeeks(), []);

  const getCurrentWeek = () => {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const todayStr = `${y}-${m}-${day}`;

    const current = weeks.find(w => todayStr >= w.monday && todayStr <= w.sunday);
    return current ? current.weekNumber : 24;
  };

  const [selectedWeek, setSelectedWeek] = useState<number>(getCurrentWeek());

  useEffect(() => {
    if (isOpen) {
      setKpiComment(member.kpiCommentTarget || 0);
      setKpiPost(member.kpiPostTarget || 0);
      setKpiLead(member.kpiLeadTarget || 0);
      setKpiInbox(member.kpiInboxTarget || member.kpi_inbox_target || 0);
      setIsFailed(false);
      setReasonNotMet("");
      let initialWeek = getCurrentWeek();
      if (selectedWeekValue) {
        const [start] = selectedWeekValue.split("_");
        const found = weeks.find(w => w.monday === start);
        if (found) initialWeek = found.weekNumber;
      }
      setSelectedWeek(initialWeek);

      setError(null);
    }
  }, [isOpen, member, weeks, selectedWeekValue]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const currentWeekData = weeks.find(w => w.weekNumber === selectedWeek);
      const payload = {
        leader_role: "leader",
        role: "member",
        email: member.email,
        profile_slug: member.profile_slug || member.email, // fallback
        email_leader: user?.email || "",
        id_team: teamId,
        kpi: [{
          start_day: currentWeekData?.monday || "",
          end_day: currentWeekData?.sunday || "",
          kpi_comment: kpiComment,
          kpi_post: kpiPost,
          kpi_lead: kpiLead,
          kpi_inbox: kpiInbox,
          is_failed: isFailed,
          reason_not_met: isFailed ? reasonNotMet : null,
        }],
        platform: "All"
      };
if (isFailed && !reasonNotMet.trim()) {
    setError("Vui lòng nhập lý do không đạt KPI.");
    setIsSubmitting(false);
    return;
}
      const res = await allPlatformKpiService.assign(payload);
      if (res.success) {
        onSuccess();
        onClose();
      } else {
        setError(res.message || "Đã xảy ra lỗi khi giao KPI");
      }
    } catch (err) {
      setError("Lỗi hệ thống, vui lòng thử lại sau.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        zIndex: 99999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px'
      }}
    >
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          cursor: 'pointer'
        }}
      />

      {/* Modal Content */}
      <div
        style={{
          position: 'relative',
          zIndex: 10,
          width: '100%',
          maxWidth: '448px',
          backgroundColor: '#ffffff',
          borderRadius: '16px',
          border: '1px solid #e2e8f0',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '90vh',
          overflowY: 'auto'
        }}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant bg-surface-container-low">
          <div>
            <h2 className="text-lg font-bold text-on-surface flex items-center gap-2">
              <MaterialIcon name="assignment" className="text-primary" />
              Giao KPI cho thành viên
            </h2>
            <p className="text-xs text-on-surface-variant font-medium mt-0.5">{member.name || member.email}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-on-surface-variant hover:text-on-surface-variant hover:bg-surface-container-highest/50 transition">
            <MaterialIcon name="close" className="text-[20px]" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {error && (
            <div className="bg-red-50 text-red-600 p-3 rounded-xl text-xs font-medium flex items-start gap-2 border border-red-100">
              <MaterialIcon name="error" className="text-[16px] shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-1">
            <label className="text-[10px] font-bold text-on-surface-variant uppercase">Chọn Tuần</label>
            <select
              value={selectedWeek}
              onChange={(e) => setSelectedWeek(Number(e.target.value))}
              className="w-full bg-surface-container-low border border-outline-variant rounded-xl px-3 py-2 text-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 transition cursor-pointer"
              required
            >
              {weeks.map((w) => (
                <option key={w.weekNumber} value={w.weekNumber}>
                  {w.label}
                </option>
              ))}
            </select>
          </div>
          
          <div className="space-y-4 pt-2">
            <div className="rounded-xl border border-outline-variant p-4 space-y-3">

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

    <span className="font-medium">
      KPI không đạt
    </span>

  </label>

  {isFailed && (

    <textarea
      rows={3}
      value={reasonNotMet}
      onChange={(e)=>setReasonNotMet(e.target.value)}
      placeholder="Nhập lý do không đạt KPI..."
      className="w-full rounded-lg border border-outline-variant px-3 py-2"
    />

  )}

</div>
            <div className="flex items-center justify-between gap-4 p-3 rounded-xl border border-outline-variant bg-surface shadow-sm">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                  <MaterialIcon name="comment" className="text-[18px]" />
                </div>
                <div>
                  <div className="text-sm font-bold text-on-surface">KPI Comment</div>
                  <div className="text-[10px] text-on-surface-variant font-medium">Bình luận seeding</div>
                </div>
              </div>
              <input
                type="number"
                min="0"
                value={kpiComment}
                onChange={(e) => setKpiComment(parseInt(e.target.value) || 0)}
                className="w-20 text-center font-bold bg-surface-container-low border border-outline-variant rounded-lg py-1.5 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition"
              />
            </div>

            <div className="flex items-center justify-between gap-4 p-3 rounded-xl border border-outline-variant bg-surface shadow-sm">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                  <MaterialIcon name="article" className="text-[18px]" />
                </div>
                <div>
                  <div className="text-sm font-bold text-on-surface">KPI Post</div>
                  <div className="text-[10px] text-on-surface-variant font-medium">Đăng bài viết</div>
                </div>
              </div>
              <input
                type="number"
                min="0"
                value={kpiPost}
                onChange={(e) => setKpiPost(parseInt(e.target.value) || 0)}
                className="w-20 text-center font-bold bg-surface-container-low border border-outline-variant rounded-lg py-1.5 text-sm focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none transition"
              />
            </div>

            <div className="flex items-center justify-between gap-4 p-3 rounded-xl border border-outline-variant bg-surface shadow-sm">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center">
                  <MaterialIcon name="person_add" className="text-[18px]" />
                </div>
                <div>
                  <div className="text-sm font-bold text-on-surface">KPI Lead</div>
                  <div className="text-[10px] text-on-surface-variant font-medium">Tìm kiếm khách hàng</div>
                </div>
              </div>
              <input
                type="number"
                min="0"
                value={kpiLead}
                onChange={(e) => setKpiLead(parseInt(e.target.value) || 0)}
                className="w-20 text-center font-bold bg-surface-container-low border border-outline-variant rounded-lg py-1.5 text-sm focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 outline-none transition"
              />
            </div>

            <div className="flex items-center justify-between gap-4 p-3 rounded-xl border border-outline-variant bg-surface shadow-sm">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-orange-50 text-orange-600 flex items-center justify-center">
                  <MaterialIcon name="chat" className="text-[18px]" />
                </div>
                <div>
                  <div className="text-sm font-bold text-on-surface">KPI Tin nhắn</div>
                  <div className="text-[10px] text-on-surface-variant font-medium">Số inbox phải xử lý / tuần</div>
                </div>
              </div>
              <input
                type="number"
                min="0"
                value={kpiInbox}
                onChange={(e) => setKpiInbox(parseInt(e.target.value) || 0)}
                className="w-20 text-center font-bold bg-surface-container-low border border-outline-variant rounded-lg py-1.5 text-sm focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 outline-none transition"
                title="Mục tiêu số tin nhắn inbox Zalo mà member này phải xử lý trong tuần"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-outline-variant">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 rounded-xl text-sm font-bold text-on-surface-variant bg-surface-container-low hover:bg-surface-container-highest transition"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2 rounded-xl text-sm font-bold text-white bg-primary hover:bg-on-primary-fixed-variant transition disabled:opacity-50 flex items-center gap-2"
            >
              {isSubmitting && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
              {isSubmitting ? "Đang lưu..." : "Lưu thay đổi"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
