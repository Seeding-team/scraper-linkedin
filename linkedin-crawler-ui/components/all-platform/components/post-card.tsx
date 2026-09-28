"use client";

import { useState, useRef, useEffect } from "react";
import { FaFacebook, FaLinkedin } from "react-icons/fa";
import { FaThreads, FaYoutube } from "react-icons/fa6";
import { FiExternalLink } from "react-icons/fi";
import { cn } from "@/lib/utils";
import type { UnifiedPost, FeedPlatform } from "@/types/unified.types";
import { useMemo } from "react";
import { useQuickInboxLibrary, composeQuickInboxMessage } from "./use-quick-inbox-library";

interface PostCardProps {
  post: UnifiedPost;
  userRole?: string;
  onVerify?: (post: UnifiedPost) => void;
  onSeeding?: (post: UnifiedPost) => void;
  onSchedule?: (post: UnifiedPost) => void;
  onViewDetail?: (post: UnifiedPost) => void;
  onDelete?: (post: UnifiedPost) => void | Promise<void>;
  onViewSeedingRoster?: (post: UnifiedPost) => void;
  /** YouTube: mở modal gõ comment -> mở video trong tab mới, điền sẵn, tính KPI khi nhân viên bấm Bình luận. */
  onComment?: (post: UnifiedPost) => void;
  seeded?: boolean;
  verifyStatus?: "pending" | "yes" | "no";
}


function PlatformIcon({ platform }: { platform: FeedPlatform }) {
  if (platform === "facebook") {
    return <FaFacebook className="text-blue-600 shrink-0" />;
  }
  if (platform === "threads") {
    return <FaThreads className="text-foreground shrink-0" />;
  }
  if (platform === "youtube") {
    return <FaYoutube className="text-[#ff0000] shrink-0" />;
  }
  return <FaLinkedin className="text-blue-700 shrink-0" />;
}

export function PostCard({ post, userRole, onVerify, onSeeding, onSchedule, onViewDetail, onDelete, onViewSeedingRoster, onComment, seeded, verifyStatus }: PostCardProps) {
  const isYouTube = post.platform === "youtube";
  const [isInboxOpen, setIsInboxOpen] = useState(false);
  const [showAllCrawledComments, setShowAllCrawledComments] = useState(false);
  const inboxRef = useRef<HTMLDivElement>(null);
  const crawledComments = (post.comments_detail || []).filter((c) => c && (c.content || c.author_name));
  const visibleCrawledComments = showAllCrawledComments ? crawledComments : crawledComments.slice(0, 2);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (inboxRef.current && !inboxRef.current.contains(event.target as Node)) {
        setIsInboxOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleView = () => {
    if (onViewDetail) {
      onViewDetail(post);
    } else {
      window.open(post.post_url, "_blank");
    }
  };

  const handleVerify = () => {
    if (onVerify) {
      handleView();
      onVerify(post);
    }
  };

  const isRejected = (link?: string) => {
    return link && link.startsWith("Bị từ chối");
  };

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

  const score = post.score || 0;
  let scoreBg = "bg-muted text-muted-foreground border-border";

  if (score >= 85) scoreBg = "bg-primary/10 text-primary border-primary/20";
  else if (score >= 60) scoreBg = "bg-amber-50 text-amber-600 border-amber-100";

  return (
    <div className="bg-card rounded-lg shadow-sm border border-border p-4 flex gap-4 items-start transition duration-200 hover:border-primary/30">
      {/* KHỐI AI SCORE BÊN TRÁI */}
      <div className={cn("w-[60px] h-[60px] rounded-lg flex flex-col items-center justify-center shrink-0 border", scoreBg)}>
        <span className="text-xl font-black leading-tight">{score}</span>
        <span className="text-[10px] font-semibold mt-0.5 opacity-80">AI Score</span>
      </div>

      {/* NỘI DUNG CHÍNH */}
      <div className="flex-1 flex flex-col justify-between min-w-0">

        {/* Header */}
        <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <PlatformIcon platform={post.platform} />
            <a
              href={post.post_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-semibold text-foreground hover:text-primary hover:underline truncate max-w-[220px]"
            >
              {post.group_name || "Unknown Group"}
            </a>

            {(post.platform === "threads" || isYouTube) && post.search_keyword && (
              <span className="shrink-0 rounded bg-neutral-100 px-2 py-0.5 text-[10px] font-bold text-neutral-700" title="Từ khoá đã tìm ra bài này">
                🔎 {post.search_keyword}
              </span>
            )}
            {isYouTube && post.source === "link" && (
              <span className="shrink-0 rounded bg-neutral-100 px-2 py-0.5 text-[10px] font-bold text-neutral-700" title="Video do người dùng dán link">
                🔗 Link thêm tay
              </span>
            )}
            {isYouTube && post.is_short && (
              <span className="shrink-0 rounded bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-600">Shorts</span>
            )}
            {post.intent && (
              <span className="shrink-0 rounded bg-purple-50 px-2 py-0.5 text-[10px] font-bold text-purple-600">
                {post.intent}
              </span>
            )}
            {post.industry && (
              <span className="shrink-0 rounded bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-600">
                {post.industry}
              </span>
            )}
            {post.icp && (
              <span className="shrink-0 rounded bg-pink-50 px-2 py-0.5 text-[10px] font-bold text-pink-600">
                {post.icp}
              </span>
            )}
            {post.team && (
              <span className="shrink-0 rounded bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-600">
                {post.team}
              </span>
            )}
            {post.tier !== undefined && (
              <span className="shrink-0 rounded bg-orange-50 px-2 py-0.5 text-[10px] font-bold text-orange-600">
                Tier {post.tier}
              </span>
            )}
          </div>

          <span className="text-sm text-muted-foreground shrink-0 font-medium text-right leading-tight">
            <span className="block">
              {post.crawl_date ? new Date(post.crawl_date).toLocaleDateString('vi-VN') : ''}
              {post.posted_at ? ` • ${new Date(post.posted_at).toLocaleTimeString('vi-VN', {hour: '2-digit', minute:'2-digit'})}` : ''}

            </span>
          </span>
        </div>

        {/* Nội dung */}
        {isYouTube ? (
          <a href={post.post_url} target="_blank" rel="noopener noreferrer" className="flex gap-3 items-start bg-muted px-3 py-2 rounded-lg border border-border mb-3 hover:border-primary/30">
            {post.image_urls?.[0] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={post.image_urls[0]} alt="" loading="lazy" className="w-32 aspect-video rounded-md object-cover shrink-0 border border-border" />
            ) : null}
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-foreground line-clamp-2">{post.title || "Video YouTube"}</span>
              <span className="block text-xs text-muted-foreground mt-0.5">
                {[post.duration_text, post.published_text].filter(Boolean).join(" • ")}
              </span>
            </span>
          </a>
        ) : (
          <p className="text-sm text-foreground italic line-clamp-2 leading-relaxed bg-muted px-3 py-2 rounded-lg border border-border mb-3">
            {post.content || "Nội dung bài viết rỗng hoặc chứa thuần hình ảnh/video."}
          </p>
        )}


        {(userRole === "admin" || userRole === "leader") && post.all_seedings && post.all_seedings.length > 0 ? (
          <div className="mb-3 flex flex-col gap-2">
            {post.all_seedings.map((seed, idx) => (
              <div key={idx} className="px-3 py-2 bg-emerald-50/50 border border-emerald-100 rounded-lg flex flex-col gap-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-bold text-emerald-600">Đã seeding bởi <span className="font-bold text-foreground">{seed.member_name}</span> (Tài khoản: {seed.seeding_name || "Unknown"}):</span>
                </div>
                <p className="text-sm text-muted-foreground line-clamp-2">
                  <span className="text-emerald-500 font-serif font-bold text-lg leading-none mr-1">"</span>
                  {seed.seeding_content}
                  <span className="text-emerald-500 font-serif font-bold text-lg leading-none ml-1">“</span>

                </p>
                <div className="flex items-center justify-between mt-1">
                  {seed.link_comment && !isRejected(seed.link_comment) && (
                    <a href={seed.link_comment} target="_blank" rel="noopener noreferrer" className="text-[10px] font-medium text-blue-600 hover:underline inline-flex items-center gap-1">
                      Xem bình luận <FiExternalLink className="w-3 h-3" />
                    </a>
                  )}
                  {seed.link_comment && isRejected(seed.link_comment) && (
                    <span className="text-[10px] font-medium text-red-600 inline-flex items-center gap-1">
                      Bị từ chối / Lỗi
                    </span>
                  )}
                  {seed.verify_status === "yes" && !isRejected(seed.link_comment) ? (
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-green-100 text-green-700">✓ Đã xác minh</span>
                  ) : seed.verify_status === "yes" && isRejected(seed.link_comment) ? (
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-700">X Bị từ chối</span>
                  ) : (
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700">Chờ xác minh</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : post.seeding_content ? (
          <div className="mb-3 px-3 py-2 bg-emerald-50/50 border border-emerald-100 rounded-lg flex flex-col gap-1">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold text-emerald-600">Đã seeding bằng tài khoản:</span>
              <span className="text-sm font-bold text-foreground">{post.seeding_name || "Unknown"}</span>
            </div>
            <p className="text-sm text-muted-foreground line-clamp-2">
              <span className="text-emerald-500 font-serif font-bold text-lg leading-none mr-1">"</span>
              {post.seeding_content}

              <span className="text-emerald-500 font-serif font-bold text-lg leading-none ml-1">"</span>
            </p>
            {post.link_comment && !isRejected(post.link_comment) && (
              <a href={post.link_comment} target="_blank" rel="noopener noreferrer" className="text-[10px] font-medium text-blue-600 hover:underline inline-flex items-center gap-1 mt-0.5">
                Xem bình luận <FiExternalLink className="w-3 h-3" />
              </a>
            )}
            {post.link_comment && isRejected(post.link_comment) && (
              <span className="text-[10px] font-medium text-red-600 inline-flex items-center gap-1 mt-0.5">
                Bị từ chối / Lỗi
              </span>
            )}
          </div>
        ) : null}

        {/* Bình luận cào được từ chính bài viết (LinkedIn, extension >= 2.0) */}
        {crawledComments.length > 0 ? (
          <div className="mb-3 px-3 py-2 bg-muted/50 border border-border rounded-lg flex flex-col gap-1.5">
            <div className="text-[10px] font-bold text-muted-foreground">
              💬 Bình luận trên bài ({crawledComments.length}
              {post.likers && post.likers.length > 0 ? ` · ${post.likers.length} người đã react` : ""})
            </div>
            {visibleCrawledComments.map((c, idx) => (
              <div key={idx} className="text-xs leading-relaxed">
                {c.author_url ? (
                  <a href={c.author_url} target="_blank" rel="noopener noreferrer" className="font-bold text-foreground hover:underline">
                    {c.author_name || "Ẩn danh"}
                  </a>
                ) : (
                  <span className="font-bold text-foreground">{c.author_name || "Ẩn danh"}</span>
                )}
                <span className="text-muted-foreground">: {c.content}</span>
                {c.likes ? <span className="ml-1 text-[10px] text-amber-700">👍 {c.likes}</span> : null}
              </div>
            ))}
            {crawledComments.length > 2 ? (
              <button type="button" onClick={() => setShowAllCrawledComments((v) => !v)} className="self-start text-[11px] font-semibold text-primary hover:underline">
                {showAllCrawledComments ? "Thu gọn" : `Xem tất cả ${crawledComments.length} bình luận`}
              </button>
            ) : null}
          </div>
        ) : null}

        {/* Footer */}
        <div className="flex items-center justify-between flex-wrap gap-2 pt-1">

          <div className="flex items-center gap-2.5 flex-wrap">
            {isYouTube ? (
              <span className="flex items-center gap-1.5 px-2.5 py-1 bg-muted text-muted-foreground rounded-md text-[11px] font-bold border border-border" title="Lượt xem">
                👁 {(post.view_count || 0).toLocaleString()} lượt xem
              </span>
            ) : (
              <>
                <span className="flex items-center gap-1.5 px-2.5 py-1 bg-amber-50/60 text-amber-700 rounded-md text-[11px] font-bold border border-amber-100/40" title="Lượt thích/Cảm xúc">
                  👍 {post.reactions?.toLocaleString() || 0}
                </span>
                <span className="flex items-center gap-1.5 px-2.5 py-1 bg-muted text-muted-foreground rounded-md text-[11px] font-bold border border-border" title="Lượt bình luận">
                  💬 {post.comments?.toLocaleString() || 0}
                </span>
                <span className="flex items-center gap-1.5 px-2.5 py-1 bg-blue-50 text-blue-600 rounded-md text-[11px] font-bold border border-blue-100/50" title="Lượt chia sẻ">
                  🔁 {post.shares?.toLocaleString() || 0}
                </span>
              </>
            )}

            {(userRole === "admin" || userRole === "leader") && post.crawler_name && (
              <span className="flex items-center gap-1.5 px-2.5 py-1 bg-muted text-muted-foreground rounded-md text-[11px] font-medium border border-border">
                👤 {post.crawler_name}
                {userRole === "admin" && post.crawler_team ? ` - ${post.crawler_team}` : ""}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {(userRole === "admin" || userRole === "leader") && onViewSeedingRoster && post.id && (
              <button
                type="button"
                onClick={() => onViewSeedingRoster(post)}
                className="px-3 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-lg text-sm font-semibold transition shadow-sm cursor-pointer"
                aria-label="Xem seeding theo team"
              >
                👥 Xem seeding theo team
              </button>
            )}

            {(userRole === "admin" || userRole === "leader") && onDelete && post.id && (
              <button
                type="button"
                onClick={() => {
                  const ok = window.confirm(`Xóa bài viết này?\n\n${post.group_name || "(không có nhóm)"}`);
                  if (!ok) return;
                  void onDelete(post);
                }}
                className="px-3 py-2 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded-lg text-sm font-semibold transition shadow-sm cursor-pointer"
                aria-label="Xóa bài viết"
              >
                Xóa
              </button>
            )}

            {(verifyStatus === "yes" || verifyStatus === "pending") && isRejected(post.link_comment) ? (

              <span className="px-2.5 py-1 rounded-md text-[11px] font-bold border bg-red-100 text-red-700 border-red-200">
                X Bị từ chối
              </span>
            ) : verifyStatus === "yes" || verifyStatus === "pending" ? (
              <span className="px-2.5 py-1 rounded-md text-[11px] font-bold border bg-emerald-100 text-emerald-700 border-emerald-200">
                ✓ Đã comment
              </span>
            ) : (
              <span className="px-2.5 py-1 rounded-md text-[11px] font-bold border bg-muted text-muted-foreground border-border">
                Chưa seeding
              </span>
            )}



            <button
              type="button"
              onClick={handleView}
              className="px-4 py-2 bg-card border border-primary text-primary hover:bg-primary hover:text-primary-foreground rounded-lg text-sm font-semibold transition shadow-sm cursor-pointer"
            >
              Xem chi tiết
            </button>

            {onComment && (
              <button
                type="button"
                onClick={() => onComment(post)}
                className="px-3 py-2 bg-[#ff0000] hover:bg-[#d90000] text-white rounded-lg text-sm font-semibold transition shadow-sm cursor-pointer inline-flex items-center gap-1.5"
              >
                <FaYoutube /> Bình luận
              </button>
            )}

            {onSchedule && (
              <button
                type="button"
                onClick={() => onSchedule(post)}
                className="px-3 py-2 bg-card border border-amber-300 text-amber-600 hover:bg-amber-50 rounded-lg text-sm font-semibold transition shadow-sm cursor-pointer"
              >
                Lên lịch
              </button>
            )}



            {/* Inbox ngay */}
            {post.author_url && (
              <div className="relative" ref={inboxRef}>
                <button
                  type="button"
                  onClick={() => setIsInboxOpen(!isInboxOpen)}
                  className="px-3 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg text-sm font-semibold transition shadow-sm cursor-pointer flex items-center gap-1"
                >
                  Inbox ngay <span className="text-[9px]">▼</span>
                </button>
                {isInboxOpen && (
                  <div className="absolute bottom-full mb-2 right-0 w-[320px] bg-popover border border-border rounded-lg shadow-xl z-50 py-1 overflow-hidden">
                    <div className="px-3 py-2 text-sm font-semibold text-popover-foreground border-b border-border flex items-center justify-between bg-muted">
                      <span>Chọn mẫu câu</span>
                      <span className="text-[10px] font-bold text-primary bg-primary/10 border border-primary/20 px-1.5 py-0.5 rounded">Tự chèn bài khách + Copy</span>
                    </div>
                    <div className="max-h-[320px] overflow-y-auto custom-scrollbar">
                      {inboxGroups.map((group, gIdx) => (
                        <div key={gIdx}>
                          <div className="px-3 py-2 text-[10px] font-bold text-muted-foreground bg-muted sticky top-0 border-b border-border backdrop-blur-sm z-10">
                            {group.category}
                          </div>
                          {group.templates.map((template, tIdx) => (
                            <button
                              key={template.id || tIdx}
                              className="w-full text-left px-3 py-3 hover:bg-primary/5 group/item transition border-b border-border last:border-0"
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
                              <div className="font-bold text-[11px] text-popover-foreground group-hover/item:text-primary mb-1 transition-colors leading-tight">
                                {template.title}
                              </div>
                              <div className="text-[10px] text-muted-foreground line-clamp-2 leading-relaxed opacity-90">
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
