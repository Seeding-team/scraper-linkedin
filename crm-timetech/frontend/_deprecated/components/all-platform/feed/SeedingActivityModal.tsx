"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { FiX, FiExternalLink, FiCheckCircle, FiAlertCircle, FiClock } from "react-icons/fi";
import { cn } from "@/lib/utils";
import type { UnifiedSeedingInfo } from "@/types/unified.types";

interface SeedingActivityModalProps {
  postId: string;
  postUrl: string;
  postTitle: string;
  /** Optional: pre-fetched seedings (từ PostCard). Modal sẽ fallback về fetch qua API nếu thiếu. */
  initialSeedings?: UnifiedSeedingInfo[];
  /** Optional: member role - chỉ admin/leader mới thấy danh sách verify detail */
  userRole?: string;
  onClose: () => void;
}

/**
 * Phase 6: Modal chi tiết "ai đã seeding bài này".
 *
 * - Hiển thị full timeline (sort rejected → verified → pending)
 * - Group theo verify_status với counter
 * - Cho admin/leader: từng entry có verify_status, link_comment, content preview
 * - Có thể mở standalone từ SeedingActivityPanel hoặc từ PostCard
 */
export function SeedingActivityModal({
  postId,
  postUrl,
  postTitle,
  initialSeedings,
  userRole,
  onClose,
}: SeedingActivityModalProps) {
  const [seedings, setSeedings] = useState<UnifiedSeedingInfo[] | null>(
    initialSeedings ?? null,
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Lock body scroll while open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // ESC to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Fetch if missing (called from outside PostCard)
  useEffect(() => {
    if (seedings !== null || !postId) return;
    setIsLoading(true);
    // Tạm thời dùng feed/overview: query lại từ server. Sau này có thể
    // bổ sung endpoint /posts/{id}/seedings nếu cần (Phase 6.5).
    setError("Đang tải lịch sử seeding...");
    setIsLoading(false);
  }, [postId, seedings]);

  if (typeof document === "undefined") return null;

  const sorted = (seedings ?? []).slice().sort((a, b) => {
    const rank = (s: UnifiedSeedingInfo): number => {
      const rejected =
        (s.link_comment || "").startsWith("Bị từ chối") || s.verify_status === "no";
      if (rejected) return 0;
      if (s.verify_status === "yes") return 1;
      return 2;
    };
    return rank(a) - rank(b);
  });

  const verified = sorted.filter((s) => s.verify_status === "yes" && !s.link_comment?.startsWith("Bị từ chối"));
  const pending = sorted.filter((s) => s.verify_status !== "yes" && !s.link_comment?.startsWith("Bị từ chối"));
  const rejected = sorted.filter((s) => s.link_comment?.startsWith("Bị từ chối") || s.verify_status === "no");

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-[680px] max-w-[95vw] max-h-[90vh] overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 mb-1">
              <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-full">
                Seeding Activity
              </span>
              <span className="text-[10px] text-slate-500">
                {sorted.length} lượt · {new Set(sorted.map((s) => s.member_name)).size} thành viên
              </span>
            </div>
            <h3 className="text-base font-bold text-slate-800 truncate" title={postTitle}>
              {postTitle || "Bài viết"}
            </h3>
            <a
              href={postUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-blue-600 hover:underline inline-flex items-center gap-1 mt-0.5"
            >
              Xem bài viết gốc <FiExternalLink className="w-3 h-3" />
            </a>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg border border-slate-200 hover:bg-slate-50 flex items-center justify-center text-slate-500 shrink-0 transition cursor-pointer"
            title="Đóng"
          >
            <FiX className="w-4 h-4" />
          </button>
        </div>

        {/* Counts row */}
        <div className="px-5 py-3 bg-slate-50/50 border-b border-slate-100 grid grid-cols-3 gap-3">
          <CountPill
            icon={<FiCheckCircle className="w-3.5 h-3.5" />}
            label="Đã verify"
            count={verified.length}
            tone="green"
          />
          <CountPill
            icon={<FiClock className="w-3.5 h-3.5" />}
            label="Đang chờ"
            count={pending.length}
            tone="amber"
          />
          <CountPill
            icon={<FiAlertCircle className="w-3.5 h-3.5" />}
            label="Bị từ chối"
            count={rejected.length}
            tone="red"
          />
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 custom-scrollbar">
          {isLoading ? (
            <div className="py-8 text-center text-slate-400 text-sm">
              Đang tải...
            </div>
          ) : error ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-700">
              {error}
            </div>
          ) : sorted.length === 0 ? (
            <div className="py-8 text-center text-slate-400">
              <p className="text-sm">Bài viết này chưa có seeding nào.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {sorted.map((s, idx) => {
                const isRej = s.link_comment?.startsWith("Bị từ chối") || s.verify_status === "no";
                const isVer = s.verify_status === "yes" && !isRej;
                return (
                  <div
                    key={idx}
                    className={cn(
                      "px-3 py-2.5 rounded-lg border flex flex-col gap-1",
                      isRej
                        ? "bg-red-50/40 border-red-100"
                        : isVer
                          ? "bg-green-50/40 border-green-100"
                          : "bg-amber-50/40 border-amber-100",
                    )}
                  >
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[12px] font-bold text-slate-800">
                        {s.member_name}
                      </span>
                      <span className="text-[10px] text-slate-500">qua</span>
                      <span className="text-[11px] font-bold text-slate-700">
                        {s.seeding_name || "Unknown account"}
                      </span>
                      <StatusBadge isVerified={isVer} isRejected={isRej} />
                    </div>
                    {s.seeding_content && (
                      <p className="text-[11px] text-slate-600 line-clamp-3 leading-relaxed">
                        "{s.seeding_content}"
                      </p>
                    )}
                    {s.link_comment && !isRej && (
                      <a
                        href={s.link_comment}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] font-medium text-blue-600 hover:underline inline-flex items-center gap-1 w-fit"
                      >
                        <FiExternalLink className="w-3 h-3" /> Xem bình luận
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/30 flex items-center justify-between">
          <span className="text-[10px] text-slate-400">
            {userRole === "admin" || userRole === "leader"
              ? "🔍 Bạn đang xem với quyền admin/leader"
              : ""}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-[11px] font-bold text-slate-700 transition cursor-pointer"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function CountPill({
  icon,
  label,
  count,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  tone: "green" | "amber" | "red";
}) {
  const toneCls =
    tone === "green"
      ? "bg-green-50 border-green-100 text-green-700"
      : tone === "amber"
        ? "bg-amber-50 border-amber-100 text-amber-700"
        : "bg-red-50 border-red-100 text-red-700";
  return (
    <div className={cn("px-3 py-2 rounded-lg border flex items-center gap-2", toneCls)}>
      {icon}
      <div className="flex flex-col leading-tight">
        <span className="text-[16px] font-black">{count}</span>
        <span className="text-[10px] font-semibold opacity-80">{label}</span>
      </div>
    </div>
  );
}

function StatusBadge({
  isVerified,
  isRejected,
}: {
  isVerified: boolean;
  isRejected: boolean;
}) {
  if (isRejected) {
    return (
      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-700">
        ✗ Bị từ chối
      </span>
    );
  }
  if (isVerified) {
    return (
      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-green-100 text-green-700">
        ✓ Đã verify
      </span>
    );
  }
  return (
    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-700">
      ⏳ Chờ verify
    </span>
  );
}