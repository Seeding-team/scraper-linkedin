"use client";

import React from "react";
import { FaFacebook, FaLinkedin } from "react-icons/fa";
import { FiExternalLink } from "react-icons/fi";
import { cn } from "@/lib/utils";
import { useMemo } from "react";
import type { UnifiedPost } from "@/types/unified.types";
import { useQuickInboxLibrary, composeQuickInboxMessage } from "./use-quick-inbox-library";

interface PostDetailModalProps {
  post: UnifiedPost | null;
  isOpen: boolean;
  onClose: () => void;
  onVerify?: (post: UnifiedPost) => void;
  verifyStatus?: "pending" | "yes" | "no";
}

export function PostDetailModal({
  post,
  isOpen,
  onClose,
  onVerify,
  verifyStatus,
}: PostDetailModalProps) {
  const [isInboxOpen, setIsInboxOpen] = React.useState(false);
  const inboxRef = React.useRef<HTMLDivElement>(null);

  const { libraryItems, fallbackItems } = useQuickInboxLibrary();
  const inboxGroups = useMemo(() => {
    const templates = libraryItems.length > 0 ? libraryItems : fallbackItems;
    const groups = new Map<string, { category: string; templates: typeof templates }>();
    templates.forEach((item) => {
      const category = item.label || "Khác";
      if (!groups.has(category)) {
        groups.set(category, { category, templates: [] });
      }
      groups.get(category)!.templates.push(item);
    });
    return Array.from(groups.values());
  }, [fallbackItems, libraryItems]);

  const isRejected = (link?: string) => {
    return link && link.startsWith("Bị từ chối");
  };

  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (inboxRef.current && !inboxRef.current.contains(event.target as Node)) {
        setIsInboxOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (!isOpen || !post) return null;

  const handleView = () => {
    window.open(post.post_url, "_blank");
  };

  const score = post.score || 0;
  let scoreBg = "bg-muted text-foreground border-border";
  if (score >= 85) scoreBg = "bg-red-50 text-primary border-red-100";
  else if (score >= 60) scoreBg = "bg-amber-50 text-amber-600 border-amber-100";

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-3xl rounded-xl bg-card shadow-xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
            {post.platform === "facebook" ? (
              <FaFacebook className="text-blue-600" />
            ) : (
              <FaLinkedin className="text-blue-700" />
            )}
            Chi tiết bài viết
          </h2>
          <button
            onClick={onClose}
            aria-label="Đóng"
            className="rounded-full p-2 text-muted-foreground hover:bg-muted hover:text-muted-foreground transition"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="flex gap-4 items-start mb-6">
            <div className={cn("w-16 h-16 rounded-xl flex flex-col items-center justify-center shrink-0 border", scoreBg)}>
              <span className="text-2xl font-black leading-tight">{score}</span>
              <span className="text-[10px] font-bold uppercaseer mt-0.5 opacity-80">AI Score</span>
            </div>
            <div>
              <a
                href={post.post_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-base font-bold text-foreground hover:text-indigo-600 hover:underline mb-2 block"
              >
                {post.group_name || "Unknown Group"}
              </a>
              <div className="flex flex-wrap gap-2 mb-2">
                {post.intent && <span className="rounded bg-purple-50 px-2 py-0.5 text-xs font-bold text-purple-600">{post.intent}</span>}
                {post.industry && <span className="rounded bg-indigo-50 px-2 py-0.5 text-xs font-bold text-indigo-600">{post.industry}</span>}
                {post.icp && <span className="rounded bg-pink-50 px-2 py-0.5 text-xs font-bold text-pink-600">{post.icp}</span>}
                {post.team && <span className="rounded bg-blue-50 px-2 py-0.5 text-xs font-bold text-blue-600">{post.team}</span>}
                {post.tier !== undefined && <span className="rounded bg-orange-50 px-2 py-0.5 text-xs font-bold text-orange-600">Tier {post.tier}</span>}
              </div>
              <span className="text-xs text-muted-foreground font-medium block mt-2">
                Tác giả: <span className="font-bold text-foreground">{post.author || "Người tham gia ẩn danh"}</span> • Đăng lúc: {post.post_time ? new Date(post.post_time).toLocaleString("vi-VN") : "Không rõ"} • Cào lúc: {post.crawl_date ? new Date(post.crawl_date).toLocaleString("vi-VN") : ""}
              </span>
            </div>
          </div>

          <div className="bg-muted rounded-xl border border-border p-4 mb-6">
            <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
              {post.content || "Nội dung bài viết rỗng hoặc chứa thuần hình ảnh/video."}
            </p>
          </div>

          {(post.image_urls && post.image_urls.length > 0) || post.media_url ? (
            <div className="mb-6 grid grid-cols-2 gap-2 rounded-xl overflow-hidden">
              {post.media_url && (
                <div className="col-span-full">
                  <video src={post.media_url} controls className="w-full max-h-64 object-contain bg-black/5 rounded-lg border border-border" />
                </div>
              )}
              {post.image_urls?.map((url, i) => (
                <img key={i} src={url} alt={`Post media ${i}`} className="w-full h-48 object-cover rounded-lg border border-border hover:opacity-90 transition-opacity cursor-pointer" onClick={() => window.open(url, '_blank')} />
              ))}
            </div>
          ) : null}

          {post.seeding_content && (
            <div className="bg-emerald-50/50 rounded-xl border border-emerald-100 p-4 mb-6">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-bold text-emerald-700 uppercase bg-emerald-100/50 px-2 py-0.5 rounded">Tài khoản Seeding:</span>
                <span className="text-sm font-bold text-foreground">{post.seeding_name || "Unknown"}</span>
              </div>
              <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed italic border-l-4 border-emerald-300 pl-3 py-1">
                {post.seeding_content}
              </p>
              {post.link_comment && !isRejected(post.link_comment) && (
                <div className="mt-3">
                  <a href={post.link_comment} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-blue-600 hover:underline inline-flex items-center gap-1.5 bg-card px-3 py-1.5 rounded-lg border border-blue-100 shadow-sm transition hover:shadow">
                    <FiExternalLink className="w-4 h-4" /> Đi tới bình luận trên Facebook
                  </a>
                </div>
              )}
              {post.link_comment && isRejected(post.link_comment) && (
                <div className="mt-3">
                  <span className="text-sm font-medium text-red-600 inline-flex items-center gap-1.5 bg-card px-3 py-1.5 rounded-lg border border-red-100 shadow-sm">
                    <span className="material-symbols-outlined text-[16px]">error</span>
                    Bị từ chối / Lỗi
                  </span>
                </div>
              )}
            </div>
          )}

          <div className="flex gap-4">
            <span className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50/60 text-amber-700 rounded-lg text-sm font-bold border border-amber-100/40">
              👍 {post.reactions?.toLocaleString() || 0}
            </span>
            <span className="flex items-center gap-1.5 px-3 py-1.5 bg-muted text-muted-foreground rounded-lg text-sm font-bold border border-border">
              💬 {post.comments?.toLocaleString() || 0}
            </span>
            <span className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg text-sm font-bold border border-blue-100/50">
              🔁 {post.shares?.toLocaleString() || 0}
            </span>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-border bg-muted px-6 py-4 flex items-center justify-between rounded-b-2xl">
          <div>
            {verifyStatus === "yes" && !isRejected(post.link_comment) ? (
              <span className="px-3 py-1.5 rounded-lg text-xs font-bold border bg-green-100 text-green-700 border-green-200">
                ✓ Đã xác minh seeding
              </span>
            ) : verifyStatus === "yes" && isRejected(post.link_comment) ? (
              <span className="px-3 py-1.5 rounded-lg text-xs font-bold border bg-red-100 text-red-700 border-red-200">
                X Bị từ chối
              </span>
            ) : verifyStatus === "pending" ? (
              <span className="px-3 py-1.5 rounded-lg text-xs font-bold border bg-emerald-100 text-emerald-700 border-emerald-200">
                ✓ Đã seeding
              </span>
            ) : (
              <span className="px-3 py-1.5 rounded-lg text-xs font-bold border bg-muted text-muted-foreground border-border">
                Chưa seeding
              </span>
            )}
          </div>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-card border border-border text-foreground hover:bg-muted rounded-xl text-sm font-bold transition shadow-sm"
            >
              Đóng
            </button>
            <button
              onClick={handleView}
              className="px-4 py-2 bg-card border border-primary text-primary hover:bg-primary hover:text-white rounded-xl text-sm font-bold transition shadow-sm flex items-center gap-1.5"
            >
              <FiExternalLink />
              Xem chi tiết
            </button>
            {onVerify && !(post.seeding_content && post.link_comment) && (
              <button
                onClick={() => onVerify(post)}
                className="px-5 py-2 bg-gradient-to-r from-primary to-on-primary-fixed-variant hover:from-on-primary-fixed-variant hover:to-primary text-white rounded-xl text-sm font-bold transition-all shadow-md hover:shadow-lg hover:-translate-y-0.5 flex items-center gap-1.5"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Xác minh seeding
              </button>
            )}

            {/* Inbox ngay */}
            {post.author_url && (
              <div className="relative" ref={inboxRef}>
                <button
                  type="button"
                  onClick={() => setIsInboxOpen(!isInboxOpen)}
                  className="px-4 py-2 bg-primary hover:bg-primary/90 text-white rounded-xl text-sm font-bold transition shadow-sm cursor-pointer flex items-center gap-1.5"
                >
                  Inbox ngay <span className="text-[10px]">▼</span>
                </button>
                {isInboxOpen && (
                  <div className="absolute bottom-full mb-2 right-0 w-[340px] bg-card border border-border rounded-xl shadow-2xl z-[100] py-1 overflow-hidden">
                    <div className="px-3 py-2 text-xs font-black text-foreground border-b border-border uppercase flex items-center justify-between bg-muted">
                      <span>Chọn mẫu câu</span>
                      <span className="text-[10px] font-bold text-primary normal-case bg-red-50 border border-red-100 px-2 py-0.5 rounded">Tự chèn bài khách + Copy</span>
                    </div>
                    <div className="max-h-[320px] overflow-y-auto custom-scrollbar text-left">
                      {inboxGroups.map((group, gIdx) => (
                        <div key={gIdx}>
                          <div className="px-3 py-1.5 text-[11px] font-bold text-muted-foreground bg-muted uppercase sticky top-0 border-b border-border backdrop-blur-sm z-10 text-left">
                            {group.category}
                          </div>
                          {group.templates.map((template) => (
                            <button
                              key={template.id}
                              className="w-full text-left px-3 py-2.5 hover:bg-red-50 group/item transition border-b border-border last:border-0"
                              onClick={() => {
                                const message = composeQuickInboxMessage(template, post.content);
                                navigator.clipboard.writeText(message).then(() => {
                                  setIsInboxOpen(false);
                                  const targetUrl = post.author_url || post.post_url;
                                  window.open(targetUrl, '_blank');
                                }).catch(() => {
                                  setIsInboxOpen(false);
                                  window.open(post.author_url || post.post_url, '_blank');
                                });
                              }}
                            >
                              <div className="font-bold text-xs text-foreground group-hover/item:text-primary mb-1 transition-colors leading-tight">
                                {template.title}
                              </div>
                              <div className="text-[11px] text-muted-foreground line-clamp-2 leading-relaxed opacity-90">
                                {composeQuickInboxMessage(template, post.content)}
                              </div>
                            </button>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
