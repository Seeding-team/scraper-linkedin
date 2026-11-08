"use client";

import { useState } from "react";
import { toast } from "sonner";
import { postEvaluationService } from "@/services/all-platform.service";
import type { UnifiedPost } from "@/types/unified.types";

interface QuickReviewToolbarProps {
  posts: UnifiedPost[];
  onBatchRejectSuccess?: (affectedPostIds: string[], undoToken: string) => void;
  onUndoSuccess?: () => void;
  hasNextPage?: boolean;
  onNextPage?: () => void;
  // Optional for backward compatibility
  isQuickReviewActive?: boolean;
  onToggleQuickReview?: () => void;
}

export function QuickReviewToolbar({
  posts,
  onBatchRejectSuccess,
  onUndoSuccess,
  hasNextPage = false,
  onNextPage,
}: QuickReviewToolbarProps) {
  const [undoToken, setUndoToken] = useState<string | null>(null);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUndoing, setIsUndoing] = useState(false);

  // Thống kê bài viết trên trang hiện tại
  const canLienHeCount = posts.filter(
    (p) => p.evaluation_code === "can-lien-he" || (p as any).evaluation_status === "can_lien_he"
  ).length;

  const khongPhuHopCount = posts.filter(
    (p) => p.evaluation_code === "khong-phu-hop" || (p as any).evaluation_status === "khong_phu_hop"
  ).length;

  // Lọc ra các bài chưa đánh giá (chưa có code hoặc 'chua-danh-gia')
  const unreviewedPosts = posts.filter(
    (p) =>
      (!p.evaluation_code || p.evaluation_code === "chua-danh-gia") &&
      (p as any).evaluation_status !== "can_lien_he" &&
      (p as any).evaluation_status !== "khong_phu_hop"
  );
  const unreviewedCount = unreviewedPosts.length;

  const handleExecuteBatchReject = async (advanceToNextPage = false) => {
    if (unreviewedCount === 0) {
      if (advanceToNextPage && onNextPage) {
        setIsConfirmOpen(false);
        onNextPage();
        toast.info("Trang hiện tại đã được đánh giá đầy đủ. Đang chuyển sang trang tiếp theo.");
      } else {
        toast.info("Không có bài viết nào chưa đánh giá trên trang này.");
        setIsConfirmOpen(false);
      }
      return;
    }

    const postIds = unreviewedPosts.map((p) => p.id);
    setIsSubmitting(true);
    try {
      const res = await postEvaluationService.batchReject({
        post_ids: postIds,
        reason: "Hoàn tất trang qua Review Nhanh",
      });

      if (res.success && res.data) {
        const token = res.data.undo_token;
        setUndoToken(token);
        setIsConfirmOpen(false);
        onBatchRejectSuccess?.(postIds, token);

        toast.success(`Đã gán 'Không phù hợp' cho ${res.data.affected_count} bài viết.`, {
          action: {
            label: "Hoàn tác ngay",
            onClick: () => handleUndo(token),
          },
          duration: 8000,
        });

        if (advanceToNextPage && onNextPage) {
          onNextPage();
        }
      } else {
        toast.error(res.message || "Không thể thực hiện đánh giá hàng loạt.");
      }
    } catch {
      toast.error("Lỗi khi kết nối tới máy chủ.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUndo = async (tokenToUse?: string) => {
    const token = tokenToUse || undoToken;
    if (!token) return;

    setIsUndoing(true);
    try {
      const res = await postEvaluationService.undoBatchReject(token);
      if (res.success) {
        setUndoToken(null);
        toast.success(res.message || "Đã hoàn tác thao tác Review Nhanh thành công!");
        onUndoSuccess?.();
      } else {
        toast.error(res.message || "Không thể hoàn tác thao tác.");
      }
    } catch {
      toast.error("Lỗi khi kết nối để hoàn tác.");
    } finally {
      setIsUndoing(false);
    }
  };

  return (
    <>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setIsConfirmOpen(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-600 text-white shadow-2xs transition cursor-pointer"
          title="Mở Review Nhanh để hoàn tất đánh giá các bài viết trên trang"
        >
          <span className="material-symbols-outlined text-[16px]">bolt</span>
          <span>Review Nhanh</span>
        </button>

        {undoToken && (
          <button
            type="button"
            disabled={isUndoing}
            onClick={() => handleUndo()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 transition cursor-pointer"
            title="Khôi phục trạng thái trước khi Review Nhanh"
          >
            <span className="material-symbols-outlined text-[16px]">undo</span>
            <span>{isUndoing ? "Đang hoàn tác..." : "Hoàn tác vừa rồi"}</span>
          </button>
        )}
      </div>

      {/* Modal xác nhận Review Nhanh */}
      {isConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in">
          <div className="bg-card w-full max-w-md rounded-2xl border border-border shadow-2xl p-5 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-400 grid place-items-center shrink-0">
                <span className="material-symbols-outlined text-2xl">bolt</span>
              </div>
              <div>
                <h3 className="text-base font-bold text-foreground">Xác nhận Review Nhanh</h3>
                <p className="text-xs text-muted-foreground">Áp dụng cho các bài viết hiển thị trên trang hiện tại</p>
              </div>
            </div>

            {/* Thống kê bài viết trên trang */}
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="flex items-center justify-between p-2.5 rounded-xl bg-emerald-50/70 border border-emerald-200/60 dark:bg-emerald-950/20 dark:border-emerald-800/40">
                  <span className="font-medium text-emerald-800 dark:text-emerald-300">Cần liên hệ:</span>
                  <span className="font-bold text-emerald-700 dark:text-emerald-200 text-sm">{canLienHeCount} bài</span>
                </div>
                <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-200/80 dark:bg-slate-900/40 dark:border-slate-800">
                  <span className="font-medium text-slate-700 dark:text-slate-300">Chưa phù hợp:</span>
                  <span className="font-bold text-slate-800 dark:text-slate-200 text-sm">{khongPhuHopCount} bài</span>
                </div>
              </div>

              {/* Cảnh báo nổi bật */}
              <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200/80 dark:bg-amber-950/30 dark:border-amber-800/50 space-y-1.5">
                <div className="flex items-center gap-2 text-amber-900 dark:text-amber-200 font-bold text-xs">
                  <span className="material-symbols-outlined text-[18px] text-amber-600 dark:text-amber-400">warning</span>
                  <span>Sẽ chuyển &apos;Chưa phù hợp&apos;: <span className="text-rose-600 dark:text-rose-400 font-extrabold text-sm">{unreviewedCount}</span> bài</span>
                </div>
                <p className="text-[11px] text-amber-800/80 dark:text-amber-300/80 leading-relaxed pl-6.5">
                  Tất cả bài viết chưa được đánh giá trên trang này sẽ được tự động gắn nhãn &quot;Không phù hợp&quot;. Bạn có thể hoàn tác ngay sau khi thực hiện.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 flex-wrap">
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => setIsConfirmOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-muted-foreground hover:bg-muted transition cursor-pointer"
              >
                Hủy bỏ
              </button>

              {hasNextPage ? (
                <>
                  <button
                    type="button"
                    disabled={isSubmitting || unreviewedCount === 0}
                    onClick={() => handleExecuteBatchReject(false)}
                    className="px-3.5 py-2 rounded-xl text-xs font-bold border border-border bg-card hover:bg-muted text-foreground transition shadow-2xs cursor-pointer disabled:opacity-50"
                  >
                    {isSubmitting ? "Đang xử lý..." : "Hoàn tất Review"}
                  </button>

                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => handleExecuteBatchReject(true)}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-primary hover:bg-primary/90 text-primary-foreground transition shadow-sm cursor-pointer disabled:opacity-50"
                  >
                    <span>{isSubmitting ? "Đang xử lý..." : "Xác nhận & Sang trang tiếp"}</span>
                    <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  disabled={isSubmitting || unreviewedCount === 0}
                  onClick={() => handleExecuteBatchReject(false)}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-primary hover:bg-primary/90 text-primary-foreground transition shadow-sm cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? "Đang xử lý..." : "Xác nhận"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
