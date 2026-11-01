"use client";

import { useState, useMemo } from "react";
import { FaFacebook, FaLinkedin } from "react-icons/fa";
import { FaThreads, FaYoutube } from "react-icons/fa6";
import { FiExternalLink } from "react-icons/fi";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { UnifiedPost, FeedPlatform } from "@/types/unified.types";
import { useQuickInboxLibrary, composeQuickInboxMessage, type QuickInboxLibraryEntry } from "./use-quick-inbox-library";
import { useQuickCommentLibrary } from "./use-quick-comment-library";
import { useAppAuth } from "@/contexts/AppAuthContext";
import {
  useSeedingExtensionStatus,
  useBulkCommentRuntime,
  PLATFORM_DB_ID,
  REQUIRED_EXTENSION_VERSION,
  type GroupPlatform,
} from "./seeding-extension/use-seeding-extension";
import { LeadFormDrawer } from "@/modules/crm/components/LeadFormDrawer";
import type { CrmLeadRow } from "@/modules/crm/types";
import { toast } from "sonner";
import { PostEvaluationDropdown } from "./PostEvaluationDropdown";
import { PostCallResultDropdown } from "./PostCallResultDropdown";
import { PostAssigneeDropdown, type PostMemberItem } from "./PostAssigneeDropdown";

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
  teamMembers?: PostMemberItem[];
}


function parseCommentAndProof(rawComment?: string | null, rawLink?: string | null): { cleanComment: string; proofUrl: string | null } {
  let proofUrl = rawLink?.trim() || null;
  let cleanComment = (rawComment || "").trim();

  const linkRegex = /\[?(?:Link minh chứng|Minh chứng):\s*(https?:\/\/[^\s\]]+)\]?/i;
  const match = cleanComment.match(linkRegex);
  if (match) {
    if (!proofUrl) {
      proofUrl = match[1];
    }
    cleanComment = cleanComment.replace(match[0], "").trim();
  }

  if (!proofUrl && /^https?:\/\/[^\s]+$/.test(cleanComment)) {
    proofUrl = cleanComment;
    cleanComment = "";
  }

  return { cleanComment, proofUrl };
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


// Chuẩn hóa hiển thị số điện thoại Việt Nam bắt đầu bằng 0... (loại bỏ hoàn toàn +84)
function normalizeDisplayPhone(rawPhone?: string | null): string {
  if (!rawPhone) return "";
  let digits = rawPhone.replace(/\D/g, "");
  if (digits.startsWith("84") && digits.length >= 10) {
    digits = "0" + digits.slice(2);
  }
  return digits;
}

const OWN_COMPANY_PHONES = ["0765055708", "0902355083", "84765055708", "84902355083"];

// Trích xuất số điện thoại từ nội dung bài viết nếu bot chưa trích xuất
function extractPhoneNumberFromContent(content?: string | null): string | null {
  if (!content) return null;
  const pattern = /(?:(?:\+?84|0)[35789](?:[.\s-]?\d){8})/g;
  const matches = content.match(pattern);
  if (!matches) return null;
  for (const m of matches) {
    const norm = normalizeDisplayPhone(m);
    if (norm.length === 10 && norm.startsWith("0")) {
      if (!OWN_COMPANY_PHONES.includes(norm)) {
        return norm;
      }
    }
  }
  return null;
}

// Helper formatting post publication and crawl timestamps
function formatPostDateTime(dateStr?: string | null) {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    const timeStr = d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    const dateFormatted = d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
    return {
      full: `${timeStr} · ${dateFormatted}`,
      time: timeStr,
      date: dateFormatted,
      iso: d.toISOString(),
    };
  } catch {
    return null;
  }
}

export function PostCard({ post, userRole, onVerify, onSeeding, onSchedule, onViewDetail, onDelete, onViewSeedingRoster, onComment, seeded, verifyStatus, teamMembers }: PostCardProps) {
  const { user: currentUser } = useAppAuth();
  const isYouTube = post.platform === "youtube";
  const [showAllCrawledComments, setShowAllCrawledComments] = useState(false);
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const [showLeadDrawer, setShowLeadDrawer] = useState(false);
  const [isContentExpanded, setIsContentExpanded] = useState(false);

  const isLongContent = useMemo(() => {
    const c = post.content || "";
    return c.length > 130 || c.includes("\n");
  }, [post.content]);
  const crawledComments = (post.comments_detail || []).filter((c) => c && (c.content || c.author_name));
  const visibleCrawledComments = showAllCrawledComments ? crawledComments : crawledComments.slice(0, 2);

  const handleView = () => {
    if (onViewDetail) {
      onViewDetail(post);
    } else {
      window.open(post.post_url, "_blank");
    }
  };

  const handleStartTask = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!post.post_url) {
      toast.error("Bài viết không có đường dẫn hợp lệ");
      return;
    }

    const currentOrigin = typeof window !== "undefined" ? window.location.origin : "https://seeding.markeeai.com";
    window.postMessage({
      type: "SYNC_ACTIVE_MEMBER",
      action: "SYNC_ACTIVE_MEMBER",
      payload: {
        email_member: currentUser?.email || "",
        apiBase: currentOrigin,
        facebook_post_id: post.id || "unknown",
        target_link: post.post_url,
        id_post: post.id,
        platform: post.platform,
        group_name: post.group_name || "",
      },
    }, "*");

    // Lưu lạc quan vào localStorage để card cập nhật 0ms
    try {
      if (typeof window !== "undefined" && (post.id || post.post_url)) {
        const localKey = `my_task_comment_${post.id || post.post_url}`;
        localStorage.setItem(localKey, JSON.stringify({
          member_name: user?.name || "Bạn",
          seeding_content: commentText.trim() || "Đã gửi bình luận qua Extension",
          link_comment: post.post_url,
          verify_status: "pending",
        }));
      }
    } catch {}

    setTimeout(() => {
      window.open(post.post_url, "_blank");
    }, 200);

    toast.success("🚀 Đã mở bài viết và kích hoạt theo dõi! Hãy bình luận trên tab vừa mở, hệ thống sẽ tự động bắt request minh chứng (+1 KPI).");
  };

  const handleVerify = () => {
    if (onVerify) {
      handleView();
      onVerify(post);
    }
  };

  const isRejected = (link?: string | null) => {
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

  // Điểm "tiềm năng seeding" do LLM chấm (migration 159, lead_score_service.py) — người
  // đang tìm đơn vị làm website/app/landing page, để người dùng biết ngay bài nào nên
  // seeding. (Thay cho khối "AI Score" cũ tính từ tương tác — đã bỏ vì hiển thị xấu/thừa.)
  const leadScore = typeof post.lead_score === "number" ? post.lead_score : null;
  const isHighLead = leadScore !== null && leadScore >= 70;
  const isMidLead = leadScore !== null && leadScore >= 31 && leadScore < 70;

  // Né bong bóng "Đã seeding bởi Seeding System (Tài khoản: Unknown)" bị trùng với bong
  // bóng "Hệ thống (tự động)" bên dưới — cả 2 ghi lại CÙNG 1 hành động (roster cũ theo
  // email_member vs bảng auto_seeding_comments mới), chỉ giữ bong bóng mới cho sạch
  // (yêu cầu 2026-10-02). Nhận diện bằng nội dung trùng khớp, không hardcode tên tài khoản.
  const autoSeedingText = post.auto_seeding_comment?.content;
  const visibleAllSeedings = (post.all_seedings || []).filter((s) => s.seeding_content !== autoSeedingText);
  const seedingContentIsAuto = !!autoSeedingText && post.seeding_content === autoSeedingText;

  // Xác định bình luận seeding của CHÍNH NGƯỜI DÙNG HIỆN TẠI (Admin / Leader / Member)
  const mySeeding = useMemo(() => {
    if (!currentUser) return null;
    const currentId = currentUser.id ? String(currentUser.id) : "";
    const currentEmail = (currentUser.email || "").trim().toLowerCase();
    const currentName = (currentUser.name || "").trim().toLowerCase();

    // 1. Tìm trong all_seedings theo ID, Email hoặc Name của người dùng đang đăng nhập
    if (post.all_seedings && post.all_seedings.length > 0) {
      const match = post.all_seedings.find((s) => {
        const sId = String((s as any).id_member || (s as any).member_id || "");
        if (sId && currentId && sId === currentId) return true;
        const sEmail = String((s as any).member_email || "").trim().toLowerCase();
        if (sEmail && currentEmail && sEmail === currentEmail) return true;
        const sName = String(s.member_name || "").trim().toLowerCase();
        if (sName && currentName && sName === currentName) return true;
        return false;
      });
      if (match) return match;
    }

    // 2. Nếu post có seeding_content gán cho chính user (hoặc is_my_seeding === true)
    if (post.seeding_content && !seedingContentIsAuto) {
      if ((post as any).is_my_seeding === true || userRole === "member") {
        return {
          member_name: currentUser.name || "Bạn",
          seeding_content: post.seeding_content,
          seeding_name: post.seeding_name,
          link_comment: post.link_comment,
          verify_status: post.verify_status || "yes",
        };
      }
    }

    // 3. Fallback đọc từ localStorage (nếu vừa làm nhiệm vụ trên client)
    if (typeof window !== "undefined") {
      const localKey = `my_task_comment_${post.id || post.post_url}`;
      const saved = localStorage.getItem(localKey);
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch {
          return {
            member_name: currentUser.name || "Bạn",
            seeding_content: saved,
            link_comment: post.link_comment || post.post_url,
            verify_status: "yes",
          };
        }
      }
    }

    return null;
  }, [currentUser, post, seedingContentIsAuto, userRole]);

  return (
    <div
      className={cn(
        "rounded-lg shadow-sm border p-4 flex gap-4 items-start transition duration-200",
        isHighLead ? "bg-emerald-50/70 border-emerald-300 ring-1 ring-emerald-200 hover:border-emerald-400" : "bg-card border-border hover:border-primary/30",
      )}
    >
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

            {leadScore !== null && (
              <span
                title={post.lead_score_reason || "Điểm tiềm năng seeding do AI chấm"}
                className={cn(
                  "shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold border",
                  isHighLead
                    ? "bg-emerald-100 text-emerald-700 border-emerald-300"
                    : isMidLead
                      ? "bg-amber-50 text-amber-600 border-amber-200"
                      : "bg-muted text-muted-foreground border-border opacity-70",
                )}
              >
                🎯 {leadScore}
              </span>
            )}

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

          <div className="shrink-0 text-right leading-tight">
            {(() => {
              const pubDt = formatPostDateTime(post.post_time || post.posted_at);
              const crawlFormatted = post.crawl_date ? new Date(post.crawl_date).toLocaleDateString('vi-VN') : '';
              
              if (pubDt) {
                return (
                  <div className="flex flex-col items-end">
                    <span
                      className="inline-flex items-center gap-1 text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-200"
                      title={`Thời gian đăng bài gốc: ${pubDt.full}`}
                    >
                      <span className="text-slate-400 font-normal">🕒</span>
                      <span>{pubDt.full}</span>
                    </span>
                    {crawlFormatted && crawlFormatted !== pubDt.date && (
                      <span
                        className="text-[11px] text-muted-foreground/75 font-normal"
                        title={`Thời gian cào về hệ thống: ${crawlFormatted}`}
                      >
                        Cào: {crawlFormatted}
                      </span>
                    )}
                  </div>
                );
              }

              return (
                <span className="text-sm text-muted-foreground font-medium">
                  {crawlFormatted}
                </span>
              );
            })()}
          </div>
        </div>

        {/* Nội dung */}
        {isYouTube ? (
          <a
            href={post.post_url}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex gap-3 items-start bg-muted px-3 py-2 rounded-lg border border-border mb-3 transition-colors hover:border-primary/30"
          >
            {post.image_urls?.[0] ? (
              <span className="relative block w-40 aspect-video shrink-0 overflow-hidden rounded-md border border-border bg-black/5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={post.image_urls[0]} alt="" loading="lazy" className="h-full w-full object-cover" />
                <span className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/20">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/70 text-white opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
                    <FaYoutube className="text-base" />
                  </span>
                </span>
                {post.duration_text && (
                  <span className="absolute bottom-1 right-1 rounded bg-black/80 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                    {post.duration_text}
                  </span>
                )}
              </span>
            ) : null}
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-foreground line-clamp-2 group-hover:text-primary">{post.title || "Video YouTube"}</span>
              <span className="block text-xs text-muted-foreground mt-0.5">
                {post.published_text || "Chưa rõ ngày đăng"}
              </span>
            </span>
          </a>
        ) : (
          <div className="bg-muted px-3.5 py-2.5 rounded-xl border border-border mb-3 transition-all duration-300">
            <div
              className={cn(
                "text-sm text-foreground italic leading-relaxed transition-all duration-300 ease-in-out",
                isContentExpanded
                  ? "whitespace-pre-wrap"
                  : "line-clamp-2"
              )}
            >
              {post.content || "Nội dung bài viết rỗng hoặc chứa thuần hình ảnh/video."}
            </div>
            {isLongContent && (
              <button
                type="button"
                onClick={() => setIsContentExpanded((prev) => !prev)}
                className="mt-2 inline-flex items-center gap-1 text-[12px] font-bold text-blue-600 hover:text-blue-700 hover:underline transition-colors cursor-pointer select-none"
              >
                <span>{isContentExpanded ? "Thu gọn ↑" : "Đọc thêm · Xem toàn bộ nội dung ↓"}</span>
              </button>
            )}
          </div>
        )}


        {/* KHỐI HIỂN THỊ: BẠN ĐÃ COMMENT THÀNH CÔNG (CHỈ NGƯỜI NÀO LÀM THÌ THẤY CỦA NGƯỜI ĐÓ) */}
        {mySeeding ? (() => {
          const { cleanComment, proofUrl } = parseCommentAndProof(mySeeding.seeding_content, mySeeding.link_comment || post.link_comment || post.post_url);
          const finalProofUrl = proofUrl && !isRejected(proofUrl) ? proofUrl : null;
          return (
            <div className="mb-3 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-center justify-between gap-3 flex-wrap shadow-2xs">
              <div className="min-w-0 flex-1">
                <div className="font-bold text-emerald-800 flex items-center gap-1.5 mb-1">
                  <span className="text-emerald-600 font-extrabold text-sm">✓</span> Bạn đã comment thành công:
                </div>
                {cleanComment ? (
                  <div className="line-clamp-2 font-medium italic text-emerald-950">
                    "{cleanComment}"
                  </div>
                ) : (
                  <div className="text-[11px] text-emerald-700 italic">
                    Đã ghi nhận minh chứng bình luận thành công (+1 KPI)
                  </div>
                )}
              </div>

              {finalProofUrl ? (
                <a
                  href={finalProofUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-lg shadow-2xs transition shrink-0 cursor-pointer"
                  title="Bấm để mở trực tiếp link bình luận minh chứng"
                >
                  <span>👁️</span>
                  <span>Xem minh chứng</span>
                  <FiExternalLink className="w-3.5 h-3.5" />
                </a>
              ) : null}
            </div>
          );
        })() : null}

        {/* Bình luận seeding TỰ ĐỘNG của hệ thống trên bài điểm cao (Facebook, migration
            160) — hiển thị giống hệt 1 bình luận seeding của member (bong bóng + dấu
            nháy) nhưng ghi rõ "Hệ thống:" để ai cũng biết đây là máy tự làm (yêu cầu
            2026-10-02). */}
        {/* Khung số điện thoại trích xuất từ bài viết & Nút nhắn tin Zalo */}
        {detectedPhone ? (
          <div className="mb-3 rounded-xl border border-sky-200/80 bg-sky-50/70 dark:bg-sky-950/25 dark:border-sky-800/60 p-2.5 sm:p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 shadow-xs transition-colors">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <span className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-100">
                <span className="w-6 h-6 rounded-full bg-sky-100 text-sky-700 dark:bg-sky-900/60 dark:text-sky-300 flex items-center justify-center text-xs">📞</span>
                <span>{detectedPhone}</span>
              </span>

              {post.auto_seeding_comment?.zalo_display_name && (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-sky-700 dark:text-sky-300 bg-sky-100/60 dark:bg-sky-900/40 px-2 py-0.5 rounded-md">
                  Zalo: {post.auto_seeding_comment.zalo_display_name}
                </span>
              )}

              {post.auto_seeding_comment?.zalo_status === "sent" ? (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                  ✓ Đã nhắn tư vấn
                </span>
              ) : post.auto_seeding_comment?.zalo_status === "failed" ? (
                <span
                  className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
                  title={post.auto_seeding_comment.zalo_error || undefined}
                >
                  ⚠️ Chưa nhắn được qua Zalo
                </span>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-1.5 shrink-0">
              {/* Nút Nhắn tin Zalo mở popup chọn tài khoản */}
              <button
                type="button"
                onClick={() => setShowZaloContactModal(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 px-3 py-1.5 text-xs font-bold text-white shadow-xs active:scale-95 transition-all"
                title="Chọn tài khoản Zalo đang kết nối để nhắn tin tới khách hàng"
              >
                <FiMessageSquare className="w-3.5 h-3.5" />
                <span>Nhắn tin Zalo</span>
              </button>

              {post.auto_seeding_comment?.zalo_conversation_id && (
                <a
                  href={`/all-platform/zalo-inbox?conv=${encodeURIComponent(post.auto_seeding_comment.zalo_conversation_id)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-lg border border-sky-300 dark:border-sky-700 px-2.5 py-1.5 text-xs font-medium text-sky-700 dark:text-sky-300 hover:bg-sky-100/60 dark:hover:bg-sky-900/40 transition-colors"
                >
                  <span>Hộp thoại</span>
                  <FiExternalLink className="w-3 h-3" />
                </a>
              )}

              <button
                type="button"
                onClick={() => setShowLeadDrawer(true)}
                className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 px-2.5 py-1.5 text-xs font-bold text-white shadow-xs active:scale-95 transition-all"
              >
                + Lead
              </button>
            </div>
          </div>
        ) : null}\n            </div>
            <div className="flex flex-wrap items-center gap-2 mt-0.5">
              {post.auto_seeding_comment.zalo_conversation_id && (
                <a
                  href={`/all-platform/zalo-inbox?conv=${encodeURIComponent(post.auto_seeding_comment.zalo_conversation_id)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] font-medium text-blue-600 hover:underline inline-flex items-center gap-1"
                >
                  Xem hộp thoại <FiExternalLink className="w-3 h-3" />
                </a>
              )}
              <button
                type="button"
                onClick={() => setShowLeadDrawer(true)}
                className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-2.5 py-0.5 text-[10px] font-bold text-white transition hover:bg-emerald-700 cursor-pointer"
              >
                + Tạo Lead
              </button>
            </div>
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

            {/* Tên người đăng bài post gốc (hoặc Ẩn danh) */}
            {(() => {
              const rawAuthor = (post.author || (post as Record<string, any>).author_name || "").trim();
              const isAnonymous = !rawAuthor || rawAuthor.toLowerCase().includes("anonymous") || rawAuthor.toLowerCase().includes("ẩn danh") || rawAuthor.toLowerCase() === "unknown";
              const displayAuthor = isAnonymous ? "Ẩn danh" : rawAuthor;
              return (
                <span
                  className={cn(
                    "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium border",
                    isAnonymous
                      ? "bg-neutral-100 text-neutral-600 border-neutral-200 dark:bg-neutral-800 dark:text-neutral-400"
                      : "bg-muted text-foreground border-border font-semibold"
                  )}
                  title={isAnonymous ? "Bài viết được đăng ẩn danh trên nhóm" : `Người đăng bài: ${displayAuthor}`}
                >
                  <span className="text-[12px]">{isAnonymous ? "🎭" : "👤"}</span>
                  <span>{displayAuthor}</span>
                </span>
              );
            })()}

            {/* Tình trạng bài viết (Chuẩn theo dropdown Ảnh 1) */}
            <PostEvaluationDropdown
              postId={post.id || post.post_url}
              initialStatus={(post as any).evaluation_status}
              onStatusChange={(status) => {
                (post as any).evaluation_status = status;
                (post as any).evaluation = status;
              }}
            />

            {/* Kết quả liên hệ (Chuẩn theo dropdown Ảnh 2) */}
            <PostCallResultDropdown
              postId={post.id || post.post_url}
              onResultChange={(result) => {
                (post as any).callResult = result;
              }}
            />

            {/* Assign người seeding */}
            <PostAssigneeDropdown
              postId={post.id || post.post_url}
              teamMembers={teamMembers}
              initialAssignee={
                (post as any).assigned_member
                  ? (post as any).assigned_member
                  : (post as any).assigned_to
                  ? { email: (post as any).assigned_to, name: (post as any).assigned_name }
                  : null
              }
            />
          </div>

          <div className="flex items-center gap-2">
            {mySeeding ? (
              <span className="px-2.5 py-1 rounded-md text-[11px] font-bold border bg-emerald-100 text-emerald-700 border-emerald-200">
                ✓ Đã comment
              </span>
            ) : (verifyStatus === "yes" || verifyStatus === "pending") && isRejected(post.link_comment) ? (
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

            {/* Nút xem bình luận trực tiếp trên card */}
            {(verifyStatus === "yes" || verifyStatus === "pending" || (post.all_seedings && post.all_seedings.length > 0) || post.link_comment || post.seeding_content) && (
              <a
                href={post.link_comment || (post.all_seedings && post.all_seedings[0] && post.all_seedings[0].link_comment) || post.post_url}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-lg text-sm font-semibold transition shadow-sm cursor-pointer inline-flex items-center gap-1.5"
                title="Xem bình luận minh chứng trực tiếp trên bài viết"
              >
                <FiExternalLink className="w-4 h-4" />
                <span>Xem bình luận</span>
              </a>
            )}

            {/* YouTube: mở modal gõ comment (mở video tab mới, điền sẵn, tính KPI khi nhân
                viên bấm Bình luận) — cần nổi ngay ở hàng chính, không gom vào "Tuỳ chọn
                khác" vì đây là hành động chính của bài YouTube, không phải việc ít dùng. */}
            {onComment && (
              <button
                type="button"
                onClick={() => onComment(post)}
                className="px-3 py-2 bg-[#ff0000] hover:bg-[#d90000] text-white rounded-lg text-sm font-semibold transition shadow-sm cursor-pointer inline-flex items-center gap-1.5"
              >
                <FaYoutube /> Bình luận
              </button>
            )}

            {/* Nút xem seeding theo team: Admin và Leader đều xem được team của mình */}
            {userRole !== "member" && onViewSeedingRoster && post.id && (
              <button
                type="button"
                onClick={() => onViewSeedingRoster(post)}
                className="px-3 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-lg text-sm font-semibold transition shadow-sm cursor-pointer flex items-center gap-1.5"
                aria-label="Xem seeding theo team"
                title="Xem tiến độ và minh chứng seeding của cả team trên bài viết này"
              >
                <span>👥</span>
                <span>Xem seeding theo team</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setIsTaskModalOpen(true)}
              className="px-3.5 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg text-sm font-semibold transition shadow-sm cursor-pointer flex items-center gap-1.5"
              title="Xem nhiệm vụ, gợi ý mẫu bình luận và mở bài viết kích hoạt theo dõi KPI"
            >
              <span>📋 Làm nhiệm vụ</span>
            </button>

            {/* Cac hanh dong it dung hon (Xem chi tiet / Len lich / Xoa) gom vao 1 modal
                rieng, mo qua nut 3 cham - giu footer gon, chi con 3 nut chinh o tren. */}
            <button
              type="button"
              onClick={() => setIsMoreMenuOpen(true)}
              className="px-2.5 py-2 bg-card border border-border text-muted-foreground hover:bg-muted rounded-lg transition shadow-sm cursor-pointer"
              aria-label="Tùy chọn khác"
              title="Tùy chọn khác"
            >
              <span className="material-symbols-outlined text-[18px] leading-none block">more_horiz</span>
            </button>
          </div>
        </div>

      </div>

      {isTaskModalOpen && (
        <TaskModal post={post} onClose={() => setIsTaskModalOpen(false)} onCommentSuccess={onSeeding ? () => onSeeding(post) : undefined} />
      )}

      {isMoreMenuOpen && (
        <MoreActionsModal
          post={post}
          onClose={() => setIsMoreMenuOpen(false)}
          onViewDetail={handleView}
          onSchedule={onSchedule}
          onDelete={(userRole === "admin" || userRole === "leader") ? onDelete : undefined}
        />
      )}

      {/* Tạo lead ngay từ SĐT + tên Zalo bot auto-seeding đã tìm được (migration 172) —
          không bắt gõ lại, đi đúng luồng check trùng/tạo lead đang dùng ở CRM. */}
      <LeadFormDrawer
        open={showLeadDrawer}
        currentUser={currentUser}
        onClose={() => setShowLeadDrawer(false)}
        onSaved={(lead) => {
          setShowLeadDrawer(false);
          toast.success(`Đã tạo lead "${lead.leadName || lead.phone || "mới"}"`);
        }}
        // post-card không có khung "Chấm điểm lead" riêng như trang CRM Leads —
        // dùng nút "Lưu & Chấm điểm" trong drawer thì cũng chỉ đóng lại như lưu thường.
        onOpenQualification={() => setShowLeadDrawer(false)}
        initialValues={{
          phone: post.auto_seeding_comment?.phone_number || undefined,
          leadName: post.auto_seeding_comment?.zalo_display_name || undefined,
          note: `Tạo từ bài seeding tự động: ${post.post_url}`,
        }}
      />
    </div>
  );
}

function TaskModal({ post, onClose }: { post: UnifiedPost; onClose: () => void; onCommentSuccess?: () => void }) {
  const { user } = useAppAuth();
  const commentPlatform: GroupPlatform | undefined = post.platform === "facebook" || post.platform === "linkedin" ? post.platform : undefined;
  const { libraryItems: commentTemplates } = useQuickCommentLibrary(commentPlatform);
  const [commentText, setCommentText] = useState("");
  const [copiedInboxId, setCopiedInboxId] = useState<string | null>(null);

  // Mặc định tự động chọn mẫu bình luận nhanh "Thiết kế website" theo yêu cầu Master
  useEffect(() => {
    if (commentTemplates.length > 0 && !commentText) {
      const targetTpl = commentTemplates.find((t) => {
        const titleLower = (t.title || "").toLowerCase();
        const contentLower = (t.content || "").toLowerCase();
        return (
          titleLower.includes("thiết kế website") ||
          titleLower.includes("thiet ke website") ||
          titleLower.includes("website") ||
          contentLower.includes("thiết kế website")
        );
      }) || commentTemplates[0];

      if (targetTpl && targetTpl.content) {
        setCommentText(targetTpl.content);
        navigator.clipboard.writeText(targetTpl.content).catch(() => {});
      }
    }
  }, [commentTemplates, commentText]);

  const { libraryItems, fallbackItems } = useQuickInboxLibrary();
  const inboxGroups = useMemo(() => {
    const templates = libraryItems.length > 0 ? libraryItems : fallbackItems;
    const groups = new Map<string, { category: string; templates: QuickInboxLibraryEntry[] }>();
    templates.forEach((item) => {
      const category = item.label || "Khác";
      if (!groups.has(category)) groups.set(category, { category, templates: [] });
      groups.get(category)!.templates.push(item);
    });
    return Array.from(groups.values());
  }, [fallbackItems, libraryItems]);

  const handleCopyInbox = async (template: QuickInboxLibraryEntry) => {
    const message = composeQuickInboxMessage(template, post.content);
    try {
      await navigator.clipboard.writeText(message);
    } catch {}
    setCopiedInboxId(template.id);
    window.open(post.author_url || post.post_url, "_blank");
  };

  const handleLaunchTask = async () => {
    onClose();
    if (commentText.trim()) {
      try {
        await navigator.clipboard.writeText(commentText.trim());
      } catch {}
    }
    const currentOrigin = typeof window !== "undefined" ? window.location.origin : "https://seeding.markeeai.com";
    window.postMessage({
      type: "SYNC_ACTIVE_MEMBER",
      action: "SYNC_ACTIVE_MEMBER",
      payload: {
        email_member: user?.email || "",
        apiBase: currentOrigin,
        facebook_post_id: post.id || "unknown",
        target_link: post.post_url,
        id_post: post.id,
        platform: post.platform,
        group_name: post.group_name || "",
      },
    }, "*");

    setTimeout(() => {
      window.open(post.post_url, "_blank");
    }, 200);

    toast.success(
      commentText.trim()
        ? "🚀 Đã sao chép bình luận & kích hoạt theo dõi! Hãy dán (Ctrl+V) trên tab vừa mở, Extension sẽ tự động bắt request minh chứng."
        : "🚀 Đã mở bài viết và kích hoạt theo dõi! Hãy bình luận trên tab vừa mở, hệ thống sẽ tự động bắt request minh chứng."
    );
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-2xl border border-border shadow-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b border-border flex items-center justify-between sticky top-0 bg-card z-10">
          <h3 className="font-bold text-base text-foreground flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">task_alt</span>
            Nhiệm vụ của bạn với bài viết này
          </h3>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted cursor-pointer">
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        <div className="p-4 flex flex-col gap-4">
          <div className="rounded-xl border border-border bg-muted/40 p-3">
            <div className="text-xs font-bold text-muted-foreground mb-1">{post.group_name || "Bài viết"}</div>
            <p className="text-sm text-foreground line-clamp-3">{post.content || "(không có nội dung văn bản)"}</p>
          </div>

          <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs text-foreground leading-relaxed flex items-start gap-2">
            <span className="material-symbols-outlined text-primary text-[18px] shrink-0 mt-0.5">info</span>
            <div>
              <b>Cơ chế bắt minh chứng tự động:</b> Khi bạn bấm nút bên dưới, hệ thống sẽ mở tab bài viết sang {post.platform === "linkedin" ? "LinkedIn" : "Facebook"} và kích hoạt theo dõi request. Bạn chỉ cần đăng bình luận trên bài viết thật, Extension sẽ tự động lưu link minh chứng chuẩn vào KPI.
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-bold text-foreground">1. Mẫu bình luận nhanh (Tùy chọn)</label>
            {commentTemplates.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {commentTemplates.slice(0, 8).map((t) => {
                  const isSelected = commentText === t.content;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => {
                        setCommentText(t.content);
                        navigator.clipboard.writeText(t.content).catch(() => {});
                        toast.info(`Đã chọn & chép mẫu "${t.title}" vào clipboard`);
                      }}
                      className={`px-3 py-1 rounded-full border text-[11px] font-semibold transition-all cursor-pointer ${
                        isSelected
                          ? "bg-primary text-white border-primary shadow-xs ring-2 ring-primary/20 font-bold"
                          : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
                      }`}
                    >
                      {isSelected && <span className="mr-1">✓</span>}
                      {t.title}
                    </button>
                  );
                })}
              </div>
            )}
            <textarea
              rows={3}
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder="Chọn mẫu ở trên hoặc tự soạn nội dung bình luận (sẽ được tự động sao chép để bạn dán)..."
              className="w-full rounded-xl border border-border bg-background p-2.5 text-sm outline-none focus:border-primary resize-y"
            />

            <div className="flex flex-col gap-1.5 pt-1">
              <button
                type="button"
                onClick={handleLaunchTask}
                className="self-start px-4 py-2.5 rounded-xl bg-primary hover:bg-primary/90 text-white text-sm font-bold shadow-sm inline-flex items-center gap-2 cursor-pointer transition"
              >
                <span className="material-symbols-outlined text-[18px]">open_in_new</span>
                {commentText.trim() ? "Sao chép & Mở bài viết (Kích hoạt theo dõi)" : "Mở bài viết & Làm nhiệm vụ (Kích hoạt theo dõi)"}
              </button>
            </div>
          </div>

          {post.author_url && (
            <div className="flex flex-col gap-2 border-t border-border pt-4">
              <label className="text-sm font-bold text-foreground">2. Nhắn tin (Inbox) cho người đăng bài</label>
              <div className="flex flex-col gap-2 max-h-[240px] overflow-y-auto pr-1">
                {inboxGroups.map((group, gIdx) => (
                  <div key={gIdx} className="flex flex-col gap-1">
                    <div className="text-[10px] font-bold text-muted-foreground uppercase">{group.category}</div>
                    {group.templates.map((template) => (
                      <button
                        key={template.id}
                        type="button"
                        onClick={() => void handleCopyInbox(template)}
                        className="text-left px-3 py-2 rounded-xl border border-border hover:border-primary hover:bg-primary/5 transition flex items-center justify-between text-xs cursor-pointer"
                      >
                        <span className="font-medium text-foreground truncate mr-2">{template.title}</span>
                        <span className="text-[10px] text-muted-foreground shrink-0 flex items-center gap-1">
                          {copiedInboxId === template.id ? "✓ Đã chép" : "Chép & Mở profile"}
                        </span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MoreActionsModal({
  post,
  onClose,
  onViewDetail,
  onSchedule,
  onDelete,
}: {
  post: UnifiedPost;
  onClose: () => void;
  onViewDetail: () => void;
  onSchedule?: (post: UnifiedPost) => void;
  onDelete?: (post: UnifiedPost) => void | Promise<void>;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-2xl border border-border shadow-xl w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h3 className="font-bold text-base text-foreground">Tùy chọn khác</h3>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted">
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>
        <div className="p-3 flex flex-col gap-1">
          <button
            type="button"
            onClick={() => {
              onClose();
              onViewDetail();
            }}
            className="text-left px-3 py-2.5 rounded-xl hover:bg-muted flex items-center gap-2 text-sm font-semibold text-foreground"
          >
            <span className="material-symbols-outlined text-[18px] text-primary">visibility</span>
            Xem chi tiết
          </button>

          {onSchedule && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onSchedule(post);
              }}
              className="text-left px-3 py-2.5 rounded-xl hover:bg-muted flex items-center gap-2 text-sm font-semibold text-foreground"
            >
              <span className="material-symbols-outlined text-[18px] text-amber-600">schedule</span>
              Lên lịch
            </button>
          )}

          {onDelete && post.id && (
            <button
              type="button"
              onClick={() => {
                const ok = window.confirm(`Xóa bài viết này?\n\n${post.group_name || "(không có nhóm)"}`);
                if (!ok) return;
                onClose();
                void onDelete(post);
              }}
              className="text-left px-3 py-2.5 rounded-xl hover:bg-red-50 flex items-center gap-2 text-sm font-semibold text-red-600"
            >
              <span className="material-symbols-outlined text-[18px]">delete</span>
              Xóa bài viết
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
