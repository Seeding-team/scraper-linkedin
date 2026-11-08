"use client";

import { useState } from "react";
import { toast } from "sonner";
import { crawlKeywordsService } from "@/services/all-platform.service";
import type { UnifiedPost } from "@/types/unified.types";

interface ProposeKeywordModalProps {
  post?: UnifiedPost;
  onClose: () => void;
  onSuccess?: () => void;
}

export function ProposeKeywordModal({ post, onClose, onSuccess }: ProposeKeywordModalProps) {
  const [keyword, setKeyword] = useState("");
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanKw = keyword.trim();
    if (!cleanKw) {
      toast.error("Vui lòng nhập từ khóa cần loại trừ.");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await crawlKeywordsService.createProposal({
        keyword: cleanKw,
        reason: reason.trim() || undefined,
        source_post_id: post?.id,
        platform: post?.platform,
      });

      if (res.success) {
        toast.success("Đã gửi đề xuất từ khóa loại trừ tới Admin!");
        onSuccess?.();
        onClose();
      } else {
        toast.error(res.message || "Không thể gửi đề xuất.");
      }
    } catch {
      toast.error("Lỗi khi kết nối tới máy chủ.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in">
      <div className="bg-card w-full max-w-md rounded-2xl border border-border shadow-2xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-rose-100 text-rose-700 grid place-items-center shrink-0">
              <span className="material-symbols-outlined text-lg">filter_alt</span>
            </div>
            <div>
              <h3 className="text-sm font-bold text-foreground">Đề xuất từ khóa loại trừ</h3>
              <p className="text-[11px] text-muted-foreground">Admin duyệt sẽ tự động lọc bỏ các bài chứa từ này</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground text-sm font-bold w-6 h-6 flex items-center justify-center rounded-md hover:bg-muted"
          >
            ✕
          </button>
        </div>

        {post && (
          <div className="bg-muted p-2.5 rounded-xl border border-border text-xs space-y-1">
            <span className="text-[10px] font-bold text-muted-foreground uppercase">Bài viết nguồn:</span>
            <p className="line-clamp-2 text-foreground italic">"{post.content}"</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-foreground mb-1">
              Từ khóa loại trừ <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              autoFocus
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="VD: đa cấp, tiền ảo, forex, tuyển ctv..."
              className="w-full px-3 py-2 text-xs rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-foreground mb-1">Lý do đề xuất (tùy chọn)</label>
            <textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Giải thích vì sao bài chứa từ này không phù hợp cho việc seeding..."
              className="w-full px-3 py-2 text-xs rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-none"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-muted-foreground hover:bg-muted transition"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !keyword.trim()}
              className="px-4 py-1.5 rounded-lg text-xs font-bold bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm transition disabled:opacity-50"
            >
              {isSubmitting ? "Đang gửi..." : "Gửi đề xuất"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

