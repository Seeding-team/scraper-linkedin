"use client";

import React, { useEffect, useState, useCallback } from "react";
import { FaFacebook, FaLinkedin } from "react-icons/fa";
import { scheduledCommentService } from "@/services/scheduled-comment.service";
import type { ScheduledComment } from "@/types/unified.types";

interface ScheduledCommentsPanelProps {
  refreshKey?: number;
}

const STATUS_LABELS: Record<string, string> = {
  pending: "Chờ",
  processing: "Đang xử lý",
  posted: "Đã đăng",
  failed: "Lỗi",
  cancelled: "Đã huỷ",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700 border-amber-200",
  processing: "bg-blue-100 text-blue-700 border-blue-200",
  posted: "bg-emerald-100 text-emerald-700 border-emerald-200",
  failed: "bg-red-100 text-red-700 border-red-200",
  cancelled: "bg-muted text-muted-foreground border-border",
};

export function ScheduledCommentsPanel({ refreshKey }: ScheduledCommentsPanelProps) {
  const [comments, setComments] = useState<ScheduledComment[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [cancelId, setCancelId] = useState<string | null>(null);

  const fetchComments = useCallback(async () => {
    setLoading(true);
    try {
      const res = await scheduledCommentService.getAll({ page: 1, limit: 50 });
      setComments((res.data as ScheduledComment[]) || []);
    } catch {
      // silently ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchComments();
  }, [fetchComments, refreshKey]);

  const handleCancel = async (id: string) => {
    setCancelId(id);
    try {
      await scheduledCommentService.cancel(id);
      setComments((prev) =>
        prev.map((c) => (c.id === id ? { ...c, status: "cancelled" } : c))
      );
    } catch {
      // silently ignore
    } finally {
      setCancelId(null);
    }
  };

  const pendingCount = comments.filter((c) => c.status === "pending").length;
  const hasItems = comments.length > 0;

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-5 py-3 hover:bg-muted/50 transition cursor-pointer"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-foreground">Lịch comment</span>
          {pendingCount > 0 && (
            <span className="rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold px-2 py-0.5 border border-amber-200">
              {pendingCount} chờ
            </span>
          )}
        </div>
        <svg
          className={`h-4 w-4 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="border-t border-border">
          {loading ? (
            <div className="px-5 py-6 text-center text-sm text-muted-foreground">
              Đang tải...
            </div>
          ) : !hasItems ? (
            <div className="px-5 py-6 text-center text-sm text-muted-foreground">
              Không có lịch comment nào
            </div>
          ) : (
            <div className="divide-y divide-border max-h-[360px] overflow-y-auto custom-scrollbar">
              {comments.map((c) => (
                <div key={c.id} className="px-5 py-3 flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      {c.platform === "facebook" ? (
                        <FaFacebook className="text-blue-600 shrink-0" size={14} />
                      ) : (
                        <FaLinkedin className="text-blue-700 shrink-0" size={14} />
                      )}
                      <span className="text-xs font-medium text-foreground truncate">
                        {c.group_name || c.post_url}
                      </span>
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {new Date(c.scheduled_at).toLocaleString("vi-VN")}
                      {c.ai_generated && " · AI"}
                    </div>
                    {c.error_message && c.status === "failed" && (
                      <div className="text-[10px] text-red-600 mt-0.5 truncate">
                        {c.error_message}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`rounded-md px-2 py-0.5 text-[10px] font-bold border ${STATUS_COLORS[c.status] || "bg-muted text-muted-foreground border-border"}`}
                    >
                      {STATUS_LABELS[c.status] || c.status}
                    </span>
                    {(c.status === "pending" || c.status === "failed") && (
                      <button
                        type="button"
                        onClick={() => handleCancel(c.id)}
                        disabled={cancelId === c.id}
                        className="text-[10px] text-red-600 hover:text-red-700 font-medium cursor-pointer disabled:opacity-50"
                      >
                        {cancelId === c.id ? "..." : "Huỷ"}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
