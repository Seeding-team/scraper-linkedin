"use client";

import { useState, useMemo, useEffect, memo } from "react";
import { FaFacebook, FaLinkedin } from "react-icons/fa";
import { FaThreads, FaYoutube } from "react-icons/fa6";
import { FiExternalLink, FiMessageSquare } from "react-icons/fi";
import { ZaloContactModal } from "./zalo-contact-modal";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { UnifiedPost, FeedPlatform } from "@/types/unified.types";
import { EvaluationDropdown } from "@/components/all-platform/posts/EvaluationDropdown";
import { PostCallResultDropdown } from "@/components/all-platform/posts/PostCallResultDropdown";
import { ProposeKeywordModal } from "@/components/all-platform/posts/ProposeKeywordModal";
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

// Helper formatting post publication and crawl timestamps (Vietnam Timezone UTC+7)
function formatPostDateTime(dateStr?: string | null) {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    const timeStr = d.toLocaleTimeString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Asia/Ho_Chi_Minh',
    });
    const dateFormatted = d.toLocaleDateString('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'Asia/Ho_Chi_Minh',
    });
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

export const PostCard = memo(function PostCard({ post, userRole, onVerify, onSeeding, onSchedule, onViewDetail, onDelete, onViewSeedingRoster, onComment, seeded, verifyStatus, teamMembers }: PostCardProps) {
  const { user: currentUser } = useAppAuth();
  const isYouTube = post.platform === "youtube";
  const [showAllCrawledComments, setShowAllCrawledComments] = useState(false);
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const [isProposeKeywordOpen, setIsProposeKeywordOpen] = useState(false);
  const [showLeadDrawer, setShowLeadDrawer] = useState(false);
  const [showZaloContactModal, setShowZaloContactModal] = useState(false);
  const [isContentExpanded, setIsContentExpanded] = useState(false);

  const [localZaloStatus, setLocalZaloStatus] = useState<string | null>(
    post.auto_seeding_comment?.zalo_status || (post as any).zalo_status || null
  );
  const [localZaloSentBy, setLocalZaloSentBy] = useState<string | null>(
    post.auto_seeding_comment?.zalo_sent_by || (post as any).zalo_sent_by || null
  );

  useEffect(() => {
    setLocalZaloStatus(post.auto_seeding_comment?.zalo_status || (post as any).zalo_status || null);
    setLocalZaloSentBy(post.auto_seeding_comment?.zalo_sent_by || (post as any).zalo_sent_by || null);
  }, [
    post.auto_seeding_comment?.zalo_status,
    post.auto_seeding_comment?.zalo_sent_by,
    (post as any).zalo_status,
    (post as any).zalo_sent_by,
  ]);

  const effectiveZaloStatus = localZaloStatus;
  const effectiveZaloSentBy = localZaloSentBy;

  const detectedPhone = useMemo(() => {
    return (
      normalizeDisplayPhone(post.auto_seeding_comment?.phone_number) ||
      normalizeDisplayPhone((post as any).phone_number) ||
      extractPhoneNumberFromContent(post.content) ||
      ""
    );
  }, [post.auto_seeding_comment?.phone_number, post.phone_number, post.content]);

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
          member_name: currentUser?.name || "Bạn",
          seeding_content: "Đã gửi bình luận qua Extension",
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
    const currentId = currentUser?.id ? String(currentUser.id) : "";
    const currentEmail = (currentUser?.email || "").trim().toLowerCase();
    const currentName = (currentUser?.name || "").trim().toLowerCase();

    // 1. Tìm trong all_seedings theo ID, Email hoặc Name (khớp cả họ tên viết tắt / bao hàm)
    if (post.all_seedings && post.all_seedings.length > 0) {
      const match = post.all_seedings.find((s) => {
        const sId = String((s as any).id_member || (s as any).member_id || "");
        if (sId && currentId && sId === currentId) return true;
        const sEmail = String((s as any).member_email || "").trim().toLowerCase();
        if (sEmail && currentEmail && sEmail === currentEmail) return true;
        const sName = String(s.member_name || "").trim().toLowerCase();
        if (sName && currentName) {
          if (sName === currentName) return true;
          if (sName.includes(currentName) || currentName.includes(sName)) return true;
        }
        return false;
      });
      if (match) return match;
    }

    // 2. Nếu post có is_my_seeding === true hoặc có seeding_content hợp lệ
    if (post.seeding_content && !seedingContentIsAuto) {
      // Bất kể vai trò admin, leader hay member, nếu backend đã đánh dấu is_my_seeding -> hiển thị
      if ((post as any).is_my_seeding === true) {
        return {
          member_name: currentUser?.name || "Bạn",
          seeding_content: post.seeding_content,
          seeding_name: post.seeding_name,
          link_comment: post.link_comment,
          verify_status: post.verify_status || "yes",
        };
      }
      // Đối với member: mọi bài có seeding_content gán cho họ đều là của họ
      if (userRole === "member") {
        return {
          member_name: currentUser?.name || "Bạn",
          seeding_content: post.seeding_content,
          seeding_name: post.seeding_name,
          link_comment: post.link_comment,
          verify_status: post.verify_status || "yes",
        };
      }
      // Nếu bài chỉ có đúng 1 seeding từ trước và có link_comment minh chứng
      if (post.all_seedings && post.all_seedings.length === 1 && !post.all_seedings[0].member_email) {
        return {
          member_name: post.all_seedings[0].member_name || currentUser?.name || "Bạn",
          seeding_content: post.all_seedings[0].seeding_content || post.seeding_content,
          seeding_name: post.seeding_name,
          link_comment: post.all_seedings[0].link_comment || post.link_comment,
          verify_status: post.all_seedings[0].verify_status || post.verify_status || "yes",
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
            member_name: currentUser?.name || "Bạn",
            seeding_content: saved,
            link_comment: post.link_comment || post.post_url,
            verify_status: "pending",
          };
        }
      }
    }

    return null;
  }, [currentUser, post, seedingContentIsAuto, userRole]);

  // Xác định bình luận seeding của bài viết (của chính mình hoặc của thành viên/admin/leader khác)
  const effectiveSeeding = useMemo(() => {
    // 1. Ưu tiên của chính người dùng hiện tại
    if (mySeeding) {
      return {
        ...mySeeding,
        display_author: mySeeding.member_name || currentUser?.name || "Bạn",
        is_mine: true,
      };
    }

    // 2. Nếu người khác đã seeding (trong all_seedings)
    if (post.all_seedings && post.all_seedings.length > 0) {
      const first = post.all_seedings[0];
      const author = first.member_name || (first as any).name || (first as any).member_email || "Thành viên";
      return {
        member_name: author,
        display_author: author,
        seeding_content: first.seeding_content || (first as any).content || post.seeding_content,
        link_comment: first.link_comment || post.link_comment,
        verify_status: first.verify_status || post.verify_status || "yes",
        is_mine: false,
      };
    }

    // 3. Fallback theo post.seeding_content
    if (post.seeding_content && !seedingContentIsAuto) {
      const author = post.seeding_name || "Thành viên";
      return {
        member_name: author,
        display_author: author,
        seeding_content: post.seeding_content,
        link_comment: post.link_comment,
        verify_status: post.verify_status || "yes",
        is_mine: false,
      };
    }

    return null;
  }, [currentUser, mySeeding, post, seedingContentIsAuto]);

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
                const crawlDt = formatPostDateTime(post.crawl_date);

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
                      {crawlDt && crawlDt.date !== pubDt.date && (
                        <span
                          className="text-[11px] text-muted-foreground/75 font-normal"
                          title={`Thời gian cào về hệ thống: ${crawlDt.full}`}
                        >
                          Cào: {crawlDt.date}
                        </span>
                      )}
                    </div>
                  );
                }

                return (
                  <span
                    className="text-xs sm:text-sm text-muted-foreground font-medium"
                    title="Bài viết không rõ giờ đăng gốc — hiển thị thời gian cào về hệ thống"
                  >
                    {crawlDt ? `Cào: ${crawlDt.full}` : ""}
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


        {/* KHỐI HIỂN THỊ: THÀNH VIÊN / LEADER / ADMIN ĐÃ COMMENT VỚI NỘI DUNG */}
        {effectiveSeeding ? (() => {
          const { cleanComment, proofUrl } = parseCommentAndProof(effectiveSeeding.seeding_content, effectiveSeeding.link_comment || post.link_comment || post.post_url);
          const finalProofUrl = proofUrl && !isRejected(proofUrl) ? proofUrl : null;
          const authorLabel = effectiveSeeding.display_author || effectiveSeeding.member_name || "Thành viên";
          return (
            <div className="mb-3 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-center justify-between gap-3 flex-wrap shadow-2xs">
              <div className="min-w-0 flex-1">
                <div className="font-bold text-emerald-800 flex items-center gap-1.5 mb-1">
                  <span className="text-emerald-600 font-extrabold text-sm">✓</span> {authorLabel} đã comment với nội dung:
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

              {(post.auto_seeding_comment?.zalo_display_name || (post as any).zalo_display_name) && (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-sky-700 dark:text-sky-300 bg-sky-100/60 dark:bg-sky-900/40 px-2 py-0.5 rounded-md">
                  Zalo: {post.auto_seeding_comment?.zalo_display_name || (post as any).zalo_display_name}
                </span>
              )}

              {effectiveZaloStatus === "sent" ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300/60 shadow-xs">
                  <span>✓ Đã nhắn tin Zalo với số {detectedPhone || post.auto_seeding_comment?.phone_number}</span>
                  {effectiveZaloSentBy && (
                    <span className="font-semibold opacity-90">({effectiveZaloSentBy})</span>
                  )}
                </span>
              ) : effectiveZaloStatus === "failed" ? (
                <span
                  className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
                  title={post.auto_seeding_comment?.zalo_error || undefined}
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
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold shadow-xs active:scale-95 transition-all",
                  effectiveZaloStatus === "sent"
                    ? "bg-emerald-600 hover:bg-emerald-500 text-white"
                    : "bg-sky-600 hover:bg-sky-500 text-white"
                )}
                title={
                  effectiveZaloStatus === "sent"
                    ? `Đã được nhắn tin Zalo bởi ${effectiveZaloSentBy || "thành viên"}. Bấm để xem hoặc nhắn thêm.`
                    : "Chọn tài khoản Zalo đang kết nối để nhắn tin tới khách hàng"
                }
              >
                <FiMessageSquare className="w-3.5 h-3.5" />
                <span>{effectiveZaloStatus === "sent" ? `✓ ${effectiveZaloSentBy ? `${effectiveZaloSentBy} đã nhắn` : "Đã nhắn Zalo"}` : "Nhắn tin Zalo"}</span>
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

            {/* Đánh giá và Kết quả liên hệ */}
            <EvaluationDropdown post={post} />
            <PostCallResultDropdown post={post} />

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
            {effectiveZaloStatus === "sent" ? (
              <span className="px-2.5 py-1 rounded-md text-[11px] font-bold border bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-950/60 dark:text-sky-300">
                ✓ {effectiveZaloSentBy ? `${effectiveZaloSentBy} đã nhắn Zalo` : "Đã nhắn Zalo"}
              </span>
            ) : isRejected(post.link_comment) ? (
              <span className="px-2.5 py-1 rounded-md text-[11px] font-bold border bg-red-100 text-red-700 border-red-200">
                X Bị từ chối
              </span>
            ) : (effectiveSeeding && effectiveSeeding.verify_status === "yes") || (verifyStatus === "yes") ? (
              <span className="px-2.5 py-1 rounded-md text-[11px] font-bold border bg-emerald-100 text-emerald-700 border-emerald-200">
                ✓ Đã comment
              </span>
            ) : (effectiveSeeding && effectiveSeeding.verify_status === "pending") || verifyStatus === "pending" ? (
              <span className="px-2.5 py-1 rounded-md text-[11px] font-bold border bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-950/60 dark:text-amber-300">
                ⏳ Đang làm nhiệm vụ
              </span>
            ) : (
              <span className="px-2.5 py-1 rounded-md text-[11px] font-bold border bg-muted text-muted-foreground border-border">
                Chưa seeding
              </span>
            )}

            {/* Nút xem bình luận trực tiếp trên card (chỉ hiện khi đã có link comment minh chứng thật) */}
            {((effectiveSeeding?.verify_status === "yes" && effectiveSeeding.link_comment && effectiveSeeding.link_comment !== post.post_url) ||
              (verifyStatus === "yes" && post.link_comment && post.link_comment !== post.post_url) ||
              (post.all_seedings && post.all_seedings.some((s) => s.link_comment && s.link_comment !== post.post_url && s.verify_status === "yes"))) && (
              <a
                href={
                  (effectiveSeeding?.verify_status === "yes" && effectiveSeeding.link_comment) ||
                  post.link_comment ||
                  (post.all_seedings && post.all_seedings[0] && post.all_seedings[0].link_comment) ||
                  post.post_url
                }
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
          onDelete={onDelete}
          onProposeKeyword={() => setIsProposeKeywordOpen(true)}
        />
      )}

      {isProposeKeywordOpen && (
        <ProposeKeywordModal
          post={post}
          onClose={() => setIsProposeKeywordOpen(false)}
        />
      )}

      {/* Tạo lead ngay từ SĐT + tên Zalo bot auto-seeding đã tìm được (migration 172) —
          chỉ mount khi người dùng bấm mở để tránh tải trước 50 form drawer ngầm */}
      {showLeadDrawer && (
        <LeadFormDrawer
          open={showLeadDrawer}
          currentUser={currentUser}
          onClose={() => setShowLeadDrawer(false)}
          onSaved={(lead) => {
            setShowLeadDrawer(false);
            toast.success(`Đã tạo lead "${lead.leadName || lead.phone || "mới"}"`);
          }}
          onOpenQualification={() => setShowLeadDrawer(false)}
          initialValues={{
            phone: post.auto_seeding_comment?.phone_number || detectedPhone || undefined,
            leadName: post.auto_seeding_comment?.zalo_display_name || undefined,
            postUrl: post.post_url || undefined,
            postContent: post.content || undefined,
            groupName: post.group_name || undefined,
            source: post.platform === "facebook" ? "FB_Group" : post.platform === "linkedin" ? "LinkedIn" : "Manual",
            note: `Tạo từ bài seeding tự động: ${post.post_url}`,
          }}
        />
      )}

      {/* Chỉ mount modal Zalo khi người dùng mở để tránh 50 request song song useZaloAccountOptions */}
      {showZaloContactModal && (
        <ZaloContactModal
          open={showZaloContactModal}
          onClose={() => setShowZaloContactModal(false)}
          phoneNumber={detectedPhone}
          zaloDisplayName={post.auto_seeding_comment?.zalo_display_name || undefined}
          postContent={post.content}
          groupName={post.group_name}
          postUrl={post.post_url}
          postId={post.id}
          platform={post.platform}
          onSentSuccess={(info) => {
            setLocalZaloStatus("sent");
            if (info.sentBy) setLocalZaloSentBy(info.sentBy);
            if (post.auto_seeding_comment) {
              post.auto_seeding_comment.zalo_status = "sent";
              post.auto_seeding_comment.zalo_sent_by = info.sentBy;
              if (info.zaloDisplayName) post.auto_seeding_comment.zalo_display_name = info.zaloDisplayName;
            } else {
              (post as any).auto_seeding_comment = {
                zalo_status: "sent",
                zalo_sent_by: info.sentBy,
                zalo_display_name: info.zaloDisplayName,
                phone_number: detectedPhone,
              };
            }
            (post as any).zalo_status = "sent";
            (post as any).zalo_sent_by = info.sentBy;
            if (info.zaloDisplayName) (post as any).zalo_display_name = info.zaloDisplayName;
          }}
        />
      )}
    </div>
  );
});

function TaskModal({ post, onClose, onCommentSuccess }: { post: UnifiedPost; onClose: () => void; onCommentSuccess?: () => void }) {
  const { user } = useAppAuth();
  const [taskType, setTaskType] = useState<"comment" | "inbox">("comment");

  const commentPlatform: GroupPlatform | undefined = post.platform === "facebook" || post.platform === "linkedin" ? post.platform : undefined;
  const { libraryItems: commentTemplates } = useQuickCommentLibrary(commentPlatform);
  const [commentText, setCommentText] = useState("");
  const [inboxText, setInboxText] = useState("");
  const [copiedInboxId, setCopiedInboxId] = useState<string | null>(null);

  // Nhận diện tác giả bài viết và kiểm tra trạng thái ẩn danh
  const authorUrl = post.author_url || (post as any).author_post?.url_profile || "";
  const authorName = (post.author || (post as any).author_name || (post as any).author_post?.name || "").trim();
  const authorNameLower = authorName.toLowerCase();
  const isAnonymous =
    !authorUrl ||
    authorUrl.trim() === "" ||
    authorNameLower.includes("ẩn danh") ||
    authorNameLower.includes("anonymous") ||
    authorNameLower.includes("người tham gia ẩn danh") ||
    authorNameLower.includes("thành viên ẩn danh") ||
    (authorUrl.includes("facebook.com/groups") && !authorUrl.includes("/user/"));

  // Mặc định tự động chọn mẫu bình luận nhanh "Thiết kế website" khi mở modal
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

  // Tự động nạp mẫu inbox đầu tiên vào khung soạn nếu chưa có
  useEffect(() => {
    if (inboxGroups.length > 0 && !inboxText) {
      const firstTpl = inboxGroups[0]?.templates?.[0];
      if (firstTpl) {
        const msg = composeQuickInboxMessage(firstTpl, post.content);
        setInboxText(msg);
        setCopiedInboxId(firstTpl.id);
      }
    }
  }, [inboxGroups, inboxText, post.content]);

  // Khi chọn mẫu bình luận -> Tự động copy luôn vào clipboard + gán vào ô nội dung
  const handleSelectCommentTemplate = async (t: { id: string; title: string; content: string }) => {
    setCommentText(t.content);
    try {
      await navigator.clipboard.writeText(t.content);
      toast.success(`✓ Đã chọn & tự động sao chép mẫu bình luận "${t.title}" vào clipboard!`);
    } catch {
      toast.info(`Đã chọn mẫu "${t.title}"`);
    }
  };

  // Khi chọn mẫu inbox -> Tự động copy luôn vào clipboard + gán vào ô nội dung
  const handleSelectInboxTemplate = async (template: QuickInboxLibraryEntry) => {
    const message = composeQuickInboxMessage(template, post.content);
    setInboxText(message);
    setCopiedInboxId(template.id);
    try {
      await navigator.clipboard.writeText(message);
      toast.success(`✓ Đã chọn & tự động sao chép mẫu inbox "${template.title}" vào clipboard!`);
    } catch {
      toast.info(`Đã chọn mẫu "${template.title}"`);
    }
  };

  const [manualProofLink, setManualProofLink] = useState("");
  const [isSubmittingManual, setIsSubmittingManual] = useState(false);

  // Dạng 1: Làm nhiệm vụ bình luận
  const handleLaunchCommentTask = async () => {
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

    if (typeof window !== "undefined") {
      const localKey = `my_task_comment_${post.id || post.post_url}`;
      const savedPayload = {
        member_name: user?.name || "Bạn",
        seeding_content: commentText.trim() || "Nhiệm vụ bình luận đã kích hoạt",
        link_comment: post.post_url,
        verify_status: "pending",
      };
      localStorage.setItem(localKey, JSON.stringify(savedPayload));
    }
    toast.info(
      commentText.trim()
        ? "🚀 Đã sao chép bình luận & mở bài viết! Hãy dán (Ctrl+V) và đăng bình luận trên tab vừa mở, Extension sẽ tự động bắt minh chứng để tính KPI."
        : "🚀 Đã mở bài viết và kích hoạt theo dõi! Hãy bình luận trên tab vừa mở, hệ thống sẽ tự động bắt minh chứng để tính KPI."
    );
  };

  // Dạng 2: Làm nhiệm vụ nhắn tin profile tác giả
  const handleLaunchInboxTask = async () => {
    if (isAnonymous || !authorUrl) {
      toast.error("⚠️ Người dùng đăng bài ẩn danh, không có thông tin profile để nhắn tin trực tiếp! Hãy dùng tab Bình luận.");
      return;
    }

    const finalMsg = inboxText.trim() || commentText.trim();
    if (finalMsg) {
      try {
        await navigator.clipboard.writeText(finalMsg);
      } catch {}
    }

    window.open(authorUrl, "_blank");

    if (typeof window !== "undefined") {
      const localKey = `my_task_comment_${post.id || post.post_url}`;
      const savedPayload = {
        member_name: user?.name || "Bạn",
        seeding_content: finalMsg || "Nhiệm vụ nhắn tin profile tác giả",
        link_comment: authorUrl,
        verify_status: "pending",
      };
      localStorage.setItem(localKey, JSON.stringify(savedPayload));
    }

    toast.success("🚀 Đã sao chép tin nhắn & mở profile tác giả! Hãy bấm Nhắn tin / Message và dán (Ctrl+V) để gửi tin.");
    onClose();
  };

  const handleManualConfirmComment = async () => {
    if (!manualProofLink.trim()) {
      toast.error("Vui lòng nhập link bình luận minh chứng!");
      return;
    }
    setIsSubmittingManual(true);
    try {
      const apiEndpoint = post.platform === "youtube"
        ? "/api/all-platform/youtube/seeding-mark/verify"
        : "/api/all-platform/facebook/seeding-mark/verify";

      const res = await fetch(apiEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email_member: user?.email || "",
          link_post: post.post_url,
          link_comment: manualProofLink.trim(),
          content: (taskType === "comment" ? commentText : inboxText).trim() || "Đã xác nhận thủ công",
          id_post: post.id,
          id_platform: post.platform === "linkedin" ? 2 : (post.platform === "threads" ? 4 : 1),
        }),
      });

      if (typeof window !== "undefined") {
        const localKey = `my_task_comment_${post.id || post.post_url}`;
        localStorage.setItem(localKey, JSON.stringify({
          member_name: user?.name || "Bạn",
          seeding_content: (taskType === "comment" ? commentText : inboxText).trim() || "Đã xác nhận thủ công",
          link_comment: manualProofLink.trim(),
          verify_status: "yes",
        }));
      }

      toast.success("🎉 Đã xác nhận thành công! KPI đã được ghi nhận (+1).");
      if (onCommentSuccess) {
        onCommentSuccess();
      }
      onClose();
    } catch (err: any) {
      toast.error(`Lỗi xác nhận: ${err?.message || "Không thể gửi dữ liệu"}`);
    } finally {
      setIsSubmittingManual(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Header Modal */}
        <div className="p-4 border-b border-border flex items-center justify-between bg-card shrink-0">
          <h3 className="font-bold text-base text-foreground flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-[20px]">task_alt</span>
            <span>Nhiệm vụ của bạn với bài viết này</span>
          </h3>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer transition">
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        {/* Nội dung cuộn được */}
        <div className="p-4 overflow-y-auto flex flex-col gap-4">
          {/* Card thông tin bài viết gốc */}
          <div className="rounded-xl border border-border bg-muted/40 p-3 flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-primary flex items-center gap-1">
                <span className="material-symbols-outlined text-[15px]">groups</span>
                {post.group_name || "Bài viết cộng đồng"}
              </span>
              {isAnonymous ? (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200 flex items-center gap-1">
                  <span className="material-symbols-outlined text-[12px]">visibility_off</span>
                  {authorName || "Đăng ẩn danh"}
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 flex items-center gap-1">
                  <span className="material-symbols-outlined text-[12px]">person</span>
                  {authorName || "Tác giả công khai"}
                </span>
              )}
            </div>
            <p className="text-sm text-foreground line-clamp-3 leading-relaxed">{post.content || "(không có nội dung văn bản)"}</p>
          </div>

          {/* Phân chia 2 Dạng nhiệm vụ rõ ràng bằng Segmented Tabs */}
          <div className="flex p-1 bg-muted/70 rounded-xl border border-border gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setTaskType("comment")}
              className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                taskType === "comment"
                  ? "bg-primary text-white shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-background/50"
              }`}
            >
              <span className="material-symbols-outlined text-[16px]">chat</span>
              <span>Dạng 1: Bình luận bài viết</span>
            </button>
            <button
              type="button"
              onClick={() => setTaskType("inbox")}
              className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                taskType === "inbox"
                  ? "bg-primary text-white shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-background/50"
              }`}
            >
              <span className="material-symbols-outlined text-[16px]">mark_chat_unread</span>
              <span>Dạng 2: Nhắn tin trực tiếp (Inbox)</span>
            </button>
          </div>

          {/* DẠNG 1: BÌNH LUẬN BÀI VIẾT */}
          {taskType === "comment" && (
            <div className="flex flex-col gap-3">
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs text-foreground leading-relaxed flex items-start gap-2">
                <span className="material-symbols-outlined text-primary text-[18px] shrink-0 mt-0.5">info</span>
                <div>
                  <b>Cơ chế bắt minh chứng tự động:</b> Khi bạn chọn mẫu, hệ thống sẽ <b>tự động sao chép</b> nội dung. Sau đó bấm nút mở bài viết, hãy dán (Ctrl+V) bình luận trên tab vừa mở, Extension sẽ tự động bắt minh chứng và ghi nhận KPI (+1).
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-foreground flex items-center gap-1">
                    <span>Chọn mẫu bình luận nhanh (Bấm để tự động sao chép):</span>
                  </label>
                  <span className="text-[11px] text-muted-foreground">Tự copy vào clipboard 0ms</span>
                </div>

                {commentTemplates.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 max-h-[140px] overflow-y-auto pr-1">
                    {commentTemplates.map((t) => {
                      const isSelected = commentText === t.content;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => void handleSelectCommentTemplate(t)}
                          className={`px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all cursor-pointer flex items-center gap-1 text-left ${
                            isSelected
                              ? "bg-primary text-white border-primary shadow-xs font-bold ring-2 ring-primary/20"
                              : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground hover:bg-primary/5"
                          }`}
                        >
                          {isSelected && <span>✓</span>}
                          <span>{t.title}</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                <div className="mt-1">
                  <div className="text-[11px] font-semibold text-muted-foreground mb-1">Nội dung bình luận sẽ dán:</div>
                  <textarea
                    rows={3}
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    placeholder="Chọn mẫu ở trên hoặc tự soạn bình luận..."
                    className="w-full rounded-xl border border-border bg-background p-2.5 text-xs outline-none focus:border-primary resize-y leading-relaxed"
                  />
                </div>

                <div className="pt-1">
                  <button
                    type="button"
                    onClick={handleLaunchCommentTask}
                    className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-primary hover:bg-primary/90 text-white text-xs font-bold shadow-sm inline-flex items-center justify-center gap-2 cursor-pointer transition"
                  >
                    <span className="material-symbols-outlined text-[18px]">open_in_new</span>
                    <span>{commentText.trim() ? "Sao chép & Mở bài viết (Kích hoạt theo dõi)" : "Mở bài viết & Làm nhiệm vụ"}</span>
                  </button>
                </div>

                {/* Hộp xác nhận thủ công nếu không dùng Extension */}
                <div className="mt-2 p-3 rounded-xl border border-dashed border-border bg-muted/20 flex flex-col gap-2">
                  <div className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[16px] text-emerald-600">verified</span>
                    <span>Xác nhận thủ công (nếu không cài hoặc không dùng Extension)</span>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="url"
                      value={manualProofLink}
                      onChange={(e) => setManualProofLink(e.target.value)}
                      placeholder="Dán link bình luận minh chứng của bạn vào đây..."
                      className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-xs outline-none focus:border-primary"
                    />
                    <button
                      type="button"
                      disabled={isSubmittingManual || !manualProofLink.trim()}
                      onClick={handleManualConfirmComment}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold transition cursor-pointer shrink-0"
                    >
                      {isSubmittingManual ? "Đang lưu..." : "Xác nhận đã bình luận"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* DẠNG 2: NHẮN TIN TRỰC TIẾP (INBOX TÁC GIẢ) */}
          {taskType === "inbox" && (
            <div className="flex flex-col gap-3">
              {/* Kiểm tra trường hợp tác giả ẩn danh */}
              {isAnonymous ? (
                <div className="p-4 rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/40 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-xs flex items-start gap-3">
                  <span className="material-symbols-outlined text-amber-600 text-[24px] shrink-0 mt-0.5">warning</span>
                  <div className="space-y-1.5">
                    <div className="font-bold text-sm text-amber-800 dark:text-amber-300">
                      Người dùng đăng bài ở chế độ ẩn danh!
                    </div>
                    <p className="leading-relaxed">
                      Bài viết này được đăng ẩn danh ({authorName || "Thành viên ẩn danh"}), tác giả không công khai trang cá nhân (profile). Hệ thống không có thông tin profile để nhảy qua nhắn tin trực tiếp!
                    </p>
                    <div className="pt-1">
                      <button
                        type="button"
                        onClick={() => setTaskType("comment")}
                        className="px-3 py-1.5 rounded-lg bg-amber-200 dark:bg-amber-900/60 hover:bg-amber-300 text-amber-900 dark:text-amber-100 font-bold transition cursor-pointer inline-flex items-center gap-1.5"
                      >
                        <span className="material-symbols-outlined text-[16px]">chat</span>
                        <span>Chuyển sang "Dạng 1: Bình luận bài viết" để tương tác</span>
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                /* Trường hợp tác giả công khai */
                <div className="p-3 rounded-xl border border-emerald-200 bg-emerald-50/70 dark:bg-emerald-950/40 dark:border-emerald-800 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-xs uppercase shadow-xs">
                      {authorName ? authorName.charAt(0) : "U"}
                    </div>
                    <div>
                      <div className="font-bold text-foreground flex items-center gap-1.5">
                        <span>{authorName || "Tác giả bài viết"}</span>
                        <span className="px-1.5 py-0.2 rounded text-[10px] bg-emerald-200 text-emerald-800 font-bold">✓ Profile công khai</span>
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate max-w-[280px] sm:max-w-[400px]">
                        {authorUrl}
                      </div>
                    </div>
                  </div>
                  <a
                    href={authorUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-2.5 py-1.5 rounded-lg border border-emerald-300 bg-card hover:bg-emerald-100 text-emerald-800 dark:text-emerald-200 text-[11px] font-semibold transition flex items-center gap-1 shrink-0"
                  >
                    <span>Xem profile</span>
                    <span className="material-symbols-outlined text-[12px]">open_in_new</span>
                  </a>
                </div>
              )}

              {/* Danh sách mẫu câu Inbox */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-foreground flex items-center gap-1">
                    <span>Chọn mẫu câu Inbox Facebook & Giải pháp (Bấm để tự động sao chép):</span>
                  </label>
                  <span className="text-[11px] text-muted-foreground">Tự copy vào clipboard 0ms</span>
                </div>

                <div className="flex flex-col gap-3 max-h-[220px] overflow-y-auto pr-1 border border-border rounded-xl p-2.5 bg-muted/20">
                  {inboxGroups.map((group, gIdx) => (
                    <div key={gIdx} className="flex flex-col gap-1.5">
                      <div className="text-[11px] font-bold text-primary flex items-center gap-1">
                        <span className="material-symbols-outlined text-[14px]">folder</span>
                        <span>{group.category}</span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                        {group.templates.map((template) => {
                          const isSelected = copiedInboxId === template.id;
                          return (
                            <button
                              key={template.id}
                              type="button"
                              onClick={() => void handleSelectInboxTemplate(template)}
                              className={`text-left p-2 rounded-xl border text-xs transition cursor-pointer flex flex-col gap-1 ${
                                isSelected
                                  ? "bg-primary text-white border-primary shadow-xs font-semibold ring-2 ring-primary/20"
                                  : "border-border bg-card text-foreground hover:border-primary/50 hover:bg-primary/5"
                              }`}
                            >
                              <div className="flex items-center justify-between gap-1">
                                <span className="font-bold truncate text-[11px]">{template.title}</span>
                                <span className={`text-[10px] shrink-0 font-semibold ${isSelected ? "text-white" : "text-primary"}`}>
                                  {isSelected ? "✓ Đã chép" : "Chọn & Chép"}
                                </span>
                              </div>
                              <p className={`text-[10px] line-clamp-2 ${isSelected ? "text-white/90" : "text-muted-foreground"}`}>
                                {template.content}
                              </p>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-1">
                  <div className="text-[11px] font-semibold text-muted-foreground mb-1">Nội dung tin nhắn inbox sẽ gửi:</div>
                  <textarea
                    rows={3}
                    value={inboxText}
                    onChange={(e) => setInboxText(e.target.value)}
                    placeholder="Chọn mẫu ở trên hoặc tự soạn nội dung inbox..."
                    className="w-full rounded-xl border border-border bg-background p-2.5 text-xs outline-none focus:border-primary resize-y leading-relaxed"
                  />
                </div>

                <div className="pt-1 flex flex-wrap gap-2 items-center">
                  {isAnonymous ? (
                    <button
                      type="button"
                      onClick={() => toast.error("⚠️ Người dùng đăng ẩn danh, không có thông tin profile để nhắn tin trực tiếp! Vui lòng chuyển sang làm nhiệm vụ Bình luận.")}
                      className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-muted text-muted-foreground border border-border text-xs font-bold inline-flex items-center justify-center gap-2 cursor-not-allowed opacity-70"
                    >
                      <span className="material-symbols-outlined text-[18px]">block</span>
                      <span>Không thể nhắn tin (Tác giả đăng ẩn danh)</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleLaunchInboxTask}
                      className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-primary hover:bg-primary/90 text-white text-xs font-bold shadow-sm inline-flex items-center justify-center gap-2 cursor-pointer transition"
                    >
                      <span className="material-symbols-outlined text-[18px]">send</span>
                      <span>🚀 Sao chép & Nhảy qua Profile tác giả để nhắn tin</span>
                    </button>
                  )}
                </div>

                {/* Hộp xác nhận thủ công nếu không dùng Extension */}
                <div className="mt-2 p-3 rounded-xl border border-dashed border-border bg-muted/20 flex flex-col gap-2">
                  <div className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[16px] text-emerald-600">verified</span>
                    <span>Xác nhận thủ công tin nhắn đã gửi (Lưu KPI)</span>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="url"
                      value={manualProofLink}
                      onChange={(e) => setManualProofLink(e.target.value)}
                      placeholder="Dán link ảnh chụp màn hình hoặc link profile đã nhắn..."
                      className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-xs outline-none focus:border-primary"
                    />
                    <button
                      type="button"
                      disabled={isSubmittingManual || !manualProofLink.trim()}
                      onClick={handleManualConfirmComment}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold transition cursor-pointer shrink-0"
                    >
                      {isSubmittingManual ? "Đang lưu..." : "Xác nhận đã nhắn"}
                    </button>
                  </div>
                </div>
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
  onProposeKeyword,
}: {
  post: UnifiedPost;
  onClose: () => void;
  onViewDetail: () => void;
  onSchedule?: (post: UnifiedPost) => void;
  onDelete?: (post: UnifiedPost) => void | Promise<void>;
  onProposeKeyword?: () => void;
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

          <button
            type="button"
            onClick={() => {
              onClose();
              onProposeKeyword?.();
            }}
            className="text-left px-3 py-2.5 rounded-xl hover:bg-rose-50 flex items-center gap-2 text-sm font-semibold text-rose-600 transition cursor-pointer"
          >
            <span className="material-symbols-outlined text-[18px]">filter_alt</span>
            Đề xuất từ khóa loại trừ
          </button>

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
