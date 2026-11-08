"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */

import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { FaFacebook, FaLinkedin } from "react-icons/fa";
import { scheduledCommentService } from "@/services/scheduled-comment.service";
import type { UnifiedPost, SocialAccount } from "@/types/unified.types";

interface ScheduleCommentModalProps {
  post: UnifiedPost | null;
  isOpen: boolean;
  onClose: () => void;
  socialAccounts?: SocialAccount[];
  onScheduled?: () => void;
}

function toLocalDatetimeLocal(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function ScheduleCommentModal({
  post,
  isOpen,
  onClose,
  socialAccounts = [],
  onScheduled,
}: ScheduleCommentModalProps) {
  const [useAI, setUseAI] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const platformAccounts = socialAccounts.filter(
    (a) => a.platform === post?.platform && a.is_active
  );

  useEffect(() => {
    if (isOpen && post) {
      const now = new Date();
      now.setMinutes(now.getMinutes() + 5);
      setScheduledAt(toLocalDatetimeLocal(now));
      setCommentText("");
      setUseAI(false);
      setError("");
      setSelectedAccountId(platformAccounts[0]?.id || "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, post?.id, post?.platform]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (isOpen) {
      document.addEventListener("keydown", handleKey);
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = "";
    };
  }, [isOpen, onClose]);

  if (!isOpen || !post) return null;
  if (typeof document === "undefined") return null;

  const minDatetime = toLocalDatetimeLocal(new Date());

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!scheduledAt) {
      setError("Vui lòng chọn thời gian");
      return;
    }
    if (new Date(scheduledAt) <= new Date()) {
      setError("Thời gian phải trong tương lai");
      return;
    }
    if (!useAI && !commentText.trim()) {
      setError("Vui lòng nhập nội dung comment");
      return;
    }

    setSubmitting(true);
    try {
      const res = await scheduledCommentService.create({
        platform: post.platform,
        post_url: post.post_url,
        group_name: post.group_name,
        post_content: post.content,
        id_social_account: selectedAccountId || undefined,
        comment_content: useAI ? undefined : commentText.trim(),
        ai_generated: useAI,
        scheduled_at: new Date(scheduledAt).toISOString(),
      } as any);

      if (res.success) {
        onScheduled?.();
        onClose();
      } else {
        setError(res.message || "Lỗi khi tạo lịch");
      }
    } catch {
      setError("Lỗi kết nối, thử lại sau");
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div
      className="flex items-center justify-center bg-black/50 p-4"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: "100vw",
        height: "100vh",
        zIndex: 9999,
      }}
    >
      <div
        className="rounded-xl bg-card shadow-xl"
        style={{
          width: "100%",
          maxWidth: "512px",
          maxHeight: "90vh",
          overflowY: "auto",
        }}
      >
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
            {post.platform === "facebook" ? (
              <FaFacebook className="text-blue-600" />
            ) : (
              <FaLinkedin className="text-blue-700" />
            )}
            Lên lịch comment
          </h2>
          <button
            onClick={onClose}
            className="rounded-full p-2 text-muted-foreground hover:bg-muted transition cursor-pointer"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Post info */}
          <div className="rounded-lg bg-muted p-3 text-sm">
            <div className="font-bold text-foreground truncate">{post.group_name}</div>
            <a
              href={post.post_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline text-xs truncate block mt-1"
            >
              {post.post_url}
            </a>
            {post.content && (
              <p className="text-muted-foreground text-xs mt-2 line-clamp-2">{post.content}</p>
            )}
          </div>

          {/* AI toggle */}
          <label className="flex items-center gap-3 cursor-pointer">
            <div className="relative">
              <input
                type="checkbox"
                checked={useAI}
                onChange={(e) => setUseAI(e.target.checked)}
                className="sr-only"
              />
              <div className={`block w-10 h-6 rounded-full transition ${useAI ? "bg-primary" : "bg-muted-foreground/30"}`} />
              <div className={`dot absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition ${useAI ? "translate-x-4" : ""}`} />
            </div>
            <span className="text-sm font-medium text-foreground">
              AI tự động viết comment
            </span>
          </label>

          {/* Comment textarea (hidden when AI on) */}
          {!useAI && (
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Nội dung comment
              </label>
              <textarea
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                rows={3}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
                placeholder="Nhập nội dung comment..."
              />
            </div>
          )}

          {/* Social account */}
          {platformAccounts.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Tài khoản đăng
              </label>
              <select
                value={selectedAccountId}
                onChange={(e) => setSelectedAccountId(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                {platformAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.account_name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Datetime picker */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Thời gian đăng
            </label>
            <input
              type="datetime-local"
              value={scheduledAt}
              min={minDatetime}
              onChange={(e) => setScheduledAt(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted transition cursor-pointer"
            >
              Huỷ
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition disabled:opacity-50 cursor-pointer"
            >
              {submitting ? "Đang lưu..." : "Xác nhận lịch"}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
