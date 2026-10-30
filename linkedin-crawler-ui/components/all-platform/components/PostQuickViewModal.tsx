"use client";

import React from "react";
import { FaFacebook, FaLinkedin, FaYoutube, FaLink, FaExternalLinkAlt, FaTimes, FaFire, FaCheckCircle, FaComments, FaThumbsUp } from "react-icons/fa";
import { FaThreads } from "react-icons/fa6";
import type { UnifiedPost } from "@/types/unified.types";

interface PostQuickViewModalProps {
  post: UnifiedPost | null;
  onClose: () => void;
  onStartSeeding?: (post: UnifiedPost) => void;
}

export function PostQuickViewModal({ post, onClose, onStartSeeding }: PostQuickViewModalProps) {
  if (!post) return null;

  const getPlatformIcon = (platform: string) => {
    switch (platform) {
      case "linkedin":
        return <FaLinkedin className="text-[#0a66c2] text-lg" />;
      case "threads":
        return <FaThreads className="text-black text-lg" />;
      case "youtube":
        return <FaYoutube className="text-[#ff0000] text-lg" />;
      default:
        return <FaFacebook className="text-[#1877f2] text-lg" />;
    }
  };

  const leadScore = typeof post.score === "number" ? post.score : 0;
  const isHighQuality = leadScore >= 80;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-200">
      <div 
        className="bg-card w-full max-w-4xl max-h-[90vh] rounded-2xl border border-border shadow-2xl flex flex-col overflow-hidden text-foreground"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 px-6 border-b border-border bg-muted/40">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-background border border-border flex items-center justify-center shrink-0 shadow-xs">
              {getPlatformIcon(post.platform)}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold text-sm text-foreground truncate max-w-[260px]">
                  {post.author || "Người dùng ẩn danh"}
                </span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-semibold">
                  {post.platform.toUpperCase()}
                </span>
                {post.intent && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 font-medium">
                    {post.intent}
                  </span>
                )}
                {isHighQuality && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold flex items-center gap-1">
                    <FaFire className="text-emerald-500" /> Điểm AI: {leadScore}/100
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground truncate mt-0.5">
                {post.group_name ? `Nhóm: ${post.group_name}` : "Bài viết công khai"} • {post.crawl_date || post.post_time || "Vừa cào"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {post.post_url && (
              <a
                href={post.post_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border bg-background hover:bg-muted text-xs font-semibold transition"
                title="Mở bài viết gốc"
              >
                <FaExternalLinkAlt className="text-xs" /> Bài gốc
              </a>
            )}
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition cursor-pointer"
            >
              <FaTimes className="text-base" />
            </button>
          </div>
        </div>

        {/* Content Body (2 Columns) */}
        <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Cột trái: Nội dung bài viết */}
          <div className="lg:col-span-2 space-y-4">
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
                Nội dung bài viết
              </h4>
              <div className="bg-muted/30 border border-border/60 rounded-xl p-4 text-sm leading-relaxed whitespace-pre-line text-foreground/90 font-sans select-text">
                {post.content || "Bài viết không có nội dung văn bản (chỉ chứa hình ảnh/video)."}
              </div>
            </div>

            {post.image_urls && post.image_urls.length > 0 && (
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
                  Hình ảnh đính kèm ({post.image_urls.length})
                </h4>
                <div className="grid grid-cols-2 gap-2">
                  {post.image_urls.slice(0, 4).map((url, i) => (
                    <img
                      key={i}
                      src={url}
                      alt="Post media"
                      className="rounded-xl border border-border object-cover w-full h-40 bg-muted"
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Cột phải: Thông số, Intent & Đánh giá */}
          <div className="space-y-4">
            <div className="bg-muted/40 border border-border rounded-xl p-4 space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Chỉ số tương tác
              </h4>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-background rounded-lg p-2.5 border border-border">
                  <FaThumbsUp className="text-blue-500 mx-auto mb-1 text-sm" />
                  <span className="text-sm font-bold block">{post.reactions || 0}</span>
                  <span className="text-[10px] text-muted-foreground">Reactions</span>
                </div>
                <div className="bg-background rounded-lg p-2.5 border border-border">
                  <FaComments className="text-emerald-500 mx-auto mb-1 text-sm" />
                  <span className="text-sm font-bold block">{post.comments || 0}</span>
                  <span className="text-[10px] text-muted-foreground">Comments</span>
                </div>
                <div className="bg-background rounded-lg p-2.5 border border-border">
                  <FaFire className="text-amber-500 mx-auto mb-1 text-sm" />
                  <span className="text-sm font-bold block">{leadScore}</span>
                  <span className="text-[10px] text-muted-foreground">Điểm AI</span>
                </div>
              </div>
            </div>

            <div className="bg-muted/40 border border-border rounded-xl p-4 space-y-2.5 text-xs">
              <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Thông tin phân loại
              </h4>
              <div className="flex justify-between py-1 border-b border-border/50">
                <span className="text-muted-foreground">Nền tảng:</span>
                <span className="font-semibold uppercase">{post.platform}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-border/50">
                <span className="text-muted-foreground">Ý định (Intent):</span>
                <span className="font-semibold text-blue-600">{post.intent || "Thảo luận"}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-border/50">
                <span className="text-muted-foreground">Tier khách hàng:</span>
                <span className="font-semibold">{post.tier ? `Tier ${post.tier}` : "Tiêu chuẩn"}</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-muted-foreground">Trạng thái Seeding:</span>
                <span className="font-semibold text-emerald-600">
                  {post.verify_status === "yes" ? "Đã xác minh KPI" : "Chưa hoàn tất"}
                </span>
              </div>
            </div>

            {onStartSeeding && (
              <button
                type="button"
                onClick={() => {
                  onStartSeeding(post);
                  onClose();
                }}
                className="w-full py-3 px-4 rounded-xl bg-primary text-primary-foreground font-bold text-sm shadow-md hover:opacity-95 transition flex items-center justify-center gap-2 cursor-pointer"
              >
                <FaCheckCircle /> Làm nhiệm vụ Seeding ngay
              </button>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-3 px-6 border-t border-border bg-muted/20 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-border bg-background hover:bg-muted text-xs font-semibold transition cursor-pointer"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}

