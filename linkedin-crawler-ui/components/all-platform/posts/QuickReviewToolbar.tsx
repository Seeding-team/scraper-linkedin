"use client";

import { useState } from "react";
import { toast } from "sonner";
import { postEvaluationService } from "@/services/all-platform.service";
import type { UnifiedPost } from "@/types/unified.types";

interface QuickReviewToolbarProps {
  posts: UnifiedPost[];
  isQuickReviewActive: boolean;
  onToggleQuickReview: () => void;
  onBatchRejectSuccess?: (affectedPostIds: string[], undoToken: string) => void;
  onUndoSuccess?: () => void;
}

export function QuickReviewToolbar({
  posts,
  isQuickReviewActive,
  onToggleQuickReview,
  onBatchRejectSuccess,
  onUndoSuccess,
}: QuickReviewToolbarProps) {
  const [undoToken, setUndoToken] = useState<string | null>(null);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUndoing, setIsUndoing] = useState(false);

  // Lọc ra các bài chưa đánh giá hoặc không phải "khong-phu-hop" trong danh sách trang hiện tại
  const unreviewedPosts = posts.filter(
    (p) => !p.evaluation_code || p.evaluation_code === "chua-danh-gia"
  );
  const unreviewedCount = unreviewedPosts.length;

  const handleExecuteBatchReject = async () => {
    if (unreviewedCount === 0) {
      toast.info("Không có bài viết nào chưa đánh giá trên trang này.");
      setIsConfirmOpen(false);
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
      <div className="flex items-center justify-between gap-3 flex-wrap p-3 rounded-xl bg-card border border-border shadow-2xs mb-4">
        {/* Toggle Review Nhanh */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onToggleQuickReview}
            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition shadow-2xs cursor-pointer ${
              isQuickReviewActive
                ? "bg-amber-500 hover:bg-amber-600 text-white shadow-amber-500/20"
                : "bg-muted hover:bg-muted/80 text-muted-foreground border border-border"
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">bolt</span>
            <span>{isQuickReviewActive ? "Đang bật Review Nhanh" : "Bật Review Nhanh"}</span>
          </button>

          {isQuickReviewActive && (
            <span className="text-xs text-muted-foreground hidden sm:inline">
              ⚡ Xem lướt các bài phù hợp, sau đó bấm <b>Hoàn tất trang</b> để tự động loại các bài còn lại.
            </span>
          )}
        </div>

        {/* Các nút hành động khi bật Review Nhanh */}
        <div className="flex items-center gap-2">
          {undoToken && (
            <button
              type="button"
              disabled={isUndoing}
              onClick={() => handleUndo()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 transition cursor-pointer"
              title="Khôi phục trạng thái trước khi bấm Hoàn tất trang"
            >
              <span className="material-symbols-outlined text-[16px]">undo</span>
              <span>{isUndoing ? "Đang hoàn tác..." : "Hoàn tác vừa rồi"}</span>
            </button>
          )}

          {isQuickReviewActive && (
            <button
              type="button"
              onClick={() => setIsConfirmOpen(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm transition cursor-pointer"
              title="Đánh dấu tất cả các bài chưa đánh giá trên trang này là 'Không phù hợp'"
            >
              <span className="material-symbols-outlined text-[16px]">done_all</span>
              <span>Hoàn tất trang ({unreviewedCount} bài chưa xét)</span>
            </button>
          )}
        </div>
      </div>

      {/* Modal xác nhận Hoàn tất trang */}
      {isConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in">
          <div className="bg-card w-full max-w-md rounded-2xl border border-border shadow-2xl p-5 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-700 grid place-items-center shrink-0">
                <span className="material-symbols-outlined text-2xl">help_outline</span>
              </div>
              <div>
                <h3 className="text-base font-bold text-foreground">Xác nhận Review Nhanh</h3>
                <p className="text-xs text-muted-foreground">Áp dụng cho trang hiển thị hiện tại</p>
              </div>
            </div>

            <div className="bg-muted p-3.5 rounded-xl text-xs space-y-2 text-foreground leading-relaxed">
              <p>
                Bạn có chắc chắn muốn gán nhãn <b>"Không phù hợp"</b> cho{" "}
                <span className="text-rose-600 font-bold">{unreviewedCount} bài viết</span> chưa được đánh giá trên trang này?
              </p>
              <p className="text-muted-foreground text-[11px]">
                ℹ️ Các bài bạn đã chủ động chọn "Phù hợp" hoặc "Cân nhắc" sẽ được <b>giữ nguyên</b>. Bạn luôn có thể bấm <b>Hoàn tác</b> ngay sau đó.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => setIsConfirmOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-muted-foreground hover:bg-muted transition"
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                disabled={isSubmitting || unreviewedCount === 0}
                onClick={handleExecuteBatchReject}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-primary hover:bg-primary/90 text-primary-foreground transition shadow-sm"
              >
                {isSubmitting ? "Đang xử lý..." : `Xác nhận gán (${unreviewedCount} bài)`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

