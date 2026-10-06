"use client";

import { useState, useMemo } from "react";
import { FaFacebook, FaLinkedin } from "react-icons/fa";
import { FaThreads } from "react-icons/fa6";
import { FiExternalLink } from "react-icons/fi";
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

interface PostCardProps {
  post: UnifiedPost;
  userRole?: string;
  onVerify?: (post: UnifiedPost) => void;
  onSeeding?: (post: UnifiedPost) => void;
  onSchedule?: (post: UnifiedPost) => void;
  onViewDetail?: (post: UnifiedPost) => void;
  onDelete?: (post: UnifiedPost) => void | Promise<void>;
  onViewSeedingRoster?: (post: UnifiedPost) => void;
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
  return <FaLinkedin className="text-blue-700 shrink-0" />;
}

export function PostCard({ post, userRole, onVerify, onSeeding, onSchedule, onViewDetail, onDelete, onViewSeedingRoster, seeded, verifyStatus }: PostCardProps) {
  const { user: currentUser } = useAppAuth();
  const [showAllCrawledComments, setShowAllCrawledComments] = useState(false);
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const [showLeadDrawer, setShowLeadDrawer] = useState(false);
  const crawledComments = (post.comments_detail || []).filter((c) => c && (c.content || c.author_name));
  const visibleCrawledComments = showAllCrawledComments ? crawledComments : crawledComments.slice(0, 2);

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

            {post.platform === "threads" && post.search_keyword && (
              <span className="shrink-0 rounded bg-neutral-100 px-2 py-0.5 text-[10px] font-bold text-neutral-700" title="Từ khoá đã tìm ra bài này">
                🔎 {post.search_keyword}
              </span>
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
        <p className="text-sm text-foreground italic line-clamp-2 leading-relaxed bg-muted px-3 py-2 rounded-lg border border-border mb-3">
          {post.content || "Nội dung bài viết rỗng hoặc chứa thuần hình ảnh/video."}
        </p>


        {(userRole === "admin" || userRole === "leader") && visibleAllSeedings.length > 0 ? (
          <div className="mb-3 flex flex-col gap-2">
            {visibleAllSeedings.map((seed, idx) => (
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
        ) : post.seeding_content && !seedingContentIsAuto ? (
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

        {/* Bình luận seeding TỰ ĐỘNG của hệ thống trên bài điểm cao (Facebook, migration
            160) — hiển thị giống hệt 1 bình luận seeding của member (bong bóng + dấu
            nháy) nhưng ghi rõ "Hệ thống:" để ai cũng biết đây là máy tự làm (yêu cầu
            2026-10-02). */}
        {post.auto_seeding_comment?.content ? (
          <div className="mb-3 px-3 py-2 bg-sky-50/60 border border-sky-100 rounded-lg flex flex-col gap-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] font-bold text-sky-600">🤖 Hệ thống (tự động):</span>
              {post.auto_seeding_comment.status === "posted" ? (
                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-100 text-emerald-700">✓ Đã đăng</span>
              ) : post.auto_seeding_comment.status === "failed" ? (
                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-red-100 text-red-700">Lỗi, chưa đăng được</span>
              ) : (
                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-100 text-amber-700">Đang chờ đăng</span>
              )}
            </div>
            <p className="text-sm text-muted-foreground line-clamp-3">
              <span className="text-sky-500 font-serif font-bold text-lg leading-none mr-1">"</span>
              {post.auto_seeding_comment.content}
              <span className="text-sky-500 font-serif font-bold text-lg leading-none ml-1">"</span>
            </p>
            {!isRejected(post.auto_seeding_comment.link_comment) && (
              <a href={post.auto_seeding_comment.link_comment || post.post_url} target="_blank" rel="noopener noreferrer" className="text-[10px] font-medium text-blue-600 hover:underline inline-flex items-center gap-1 mt-0.5">
                Xem bình luận <FiExternalLink className="w-3 h-3" />
              </a>
            )}
            {/* Nhánh Zalo tự động (migration 161/172): bài không có SĐT -> nhắc còn cần
                inbox tay; có SĐT -> hiện rõ SĐT + tên Zalo tìm được, trạng thái tư vấn
                tự động, và nút tạo lead ngay từ thông tin này. */}
            {!post.auto_seeding_comment.phone_number ? (
              <div className="text-[10px] font-semibold text-amber-600 mt-0.5">📩 Cần inbox thêm với khách hàng (bài không có SĐT liên hệ)</div>
            ) : (
              <div className="mt-1 flex flex-col gap-1 rounded-lg border border-sky-100 bg-white px-2 py-1.5">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-800">
                    📞 {post.auto_seeding_comment.phone_number}
                  </span>
                  {post.auto_seeding_comment.zalo_display_name && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-sky-700">
                      · Zalo: {post.auto_seeding_comment.zalo_display_name}
                    </span>
                  )}
                  {post.auto_seeding_comment.zalo_status === "sent" ? (
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-100 text-emerald-700">✓ Đã nhắn tư vấn</span>
                  ) : post.auto_seeding_comment.zalo_status === "failed" ? (
                    <span
                      className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-red-100 text-red-700"
                      title={post.auto_seeding_comment.zalo_error || undefined}
                    >
                      ⚠️ Chưa nhắn được qua Zalo
                    </span>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
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
                    className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-bold text-white transition hover:bg-emerald-700"
                  >
                    + Tạo Lead
                  </button>
                </div>
              </div>
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
            <span className="flex items-center gap-1.5 px-2.5 py-1 bg-amber-50/60 text-amber-700 rounded-md text-[11px] font-bold border border-amber-100/40" title="Lượt thích/Cảm xúc">
              👍 {post.reactions?.toLocaleString() || 0}
            </span>
            <span className="flex items-center gap-1.5 px-2.5 py-1 bg-muted text-muted-foreground rounded-md text-[11px] font-bold border border-border" title="Lượt bình luận">
              💬 {post.comments?.toLocaleString() || 0}
            </span>
            <span className="flex items-center gap-1.5 px-2.5 py-1 bg-blue-50 text-blue-600 rounded-md text-[11px] font-bold border border-blue-100/50" title="Lượt chia sẻ">
              🔁 {post.shares?.toLocaleString() || 0}
            </span>

            {(userRole === "admin" || userRole === "leader") && post.crawler_name && (
              <span className="flex items-center gap-1.5 px-2.5 py-1 bg-muted text-muted-foreground rounded-md text-[11px] font-medium border border-border">
                👤 {post.crawler_name}
                {userRole === "admin" && post.crawler_team ? ` - ${post.crawler_team}` : ""}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
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

            {/* Nut xem roster: nhan/label theo role — admin xem toan bo team, leader chi
                xem duoc team/member cua minh (backend tu loc), member khong thay nut nay. */}
            {userRole !== "member" && onViewSeedingRoster && post.id && (
              <button
                type="button"
                onClick={() => onViewSeedingRoster(post)}
                className="px-3 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-lg text-sm font-semibold transition shadow-sm cursor-pointer"
                aria-label={userRole === "admin" ? "Xem seeding theo team" : "Xem seeding theo member"}
              >
                {userRole === "admin" ? "👥 Xem seeding theo team" : "👤 Xem seeding theo member"}
              </button>
            )}

            <button
              type="button"
              onClick={() => setIsTaskModalOpen(true)}
              className="px-3 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg text-sm font-semibold transition shadow-sm cursor-pointer"
            >
              📋 Làm nhiệm vụ
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

function TaskModal({ post, onClose, onCommentSuccess }: { post: UnifiedPost; onClose: () => void; onCommentSuccess?: () => void }) {
  const { user } = useAppAuth();
  const commentPlatform: GroupPlatform | undefined = post.platform === "facebook" || post.platform === "linkedin" ? post.platform : undefined;
  const { libraryItems: commentTemplates } = useQuickCommentLibrary(commentPlatform);
  const [commentText, setCommentText] = useState("");
  const [copiedInboxId, setCopiedInboxId] = useState<string | null>(null);
  const [justCommented, setJustCommented] = useState(false);

  // Nhiem vu binh luan: goi TRUC TIEP extension va tien hanh comment that (giong het
  // luong "Binh luan hang loat" cua tab Cao bai viet) thay vi chi sao chep de nguoi
  // dung tu dan - tinh la thanh vien nay DA LAM nhiem vu ngay khi extension bao thanh
  // cong (backend tu ghi seeding-mark/verify voi email_member = nguoi dang dang nhap,
  // dung nguyen co che da co san cua "Binh luan hang loat", khong can them bang moi).
  const { isReady } = useSeedingExtensionStatus();
  const commentRuntime = useBulkCommentRuntime({
    isReady,
    email: user?.email,
    onComplete: (seededUrls) => {
      if (post.post_url && seededUrls.includes(post.post_url)) {
        setJustCommented(true);
        onCommentSuccess?.();
      }
    },
  });

  const handleStartComment = () => {
    if (!commentPlatform || !commentText.trim() || !post.post_url || commentRuntime.isCommenting) return;
    setJustCommented(false);
    commentRuntime.start(
      [{ url: post.post_url, id_post: post.id, id_platform: PLATFORM_DB_ID[commentPlatform] }],
      commentText.trim(),
      { id_platform: PLATFORM_DB_ID[commentPlatform] },
    );
  };

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

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-2xl border border-border shadow-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b border-border flex items-center justify-between sticky top-0 bg-card z-10">
          <h3 className="font-bold text-base text-foreground flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">task_alt</span>
            Nhiệm vụ của bạn với bài viết này
          </h3>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted">
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        <div className="p-4 flex flex-col gap-4">
          <div className="rounded-xl border border-border bg-muted/40 p-3">
            <div className="text-xs font-bold text-muted-foreground mb-1">{post.group_name || "Bài viết"}</div>
            <p className="text-sm text-foreground line-clamp-3">{post.content || "(không có nội dung văn bản)"}</p>
          </div>

          <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs text-foreground leading-relaxed">
            <b>Việc cần làm:</b> {commentPlatform ? (
              <>Bình luận (comment) theo mẫu bên dưới — bấm &quot;Bắt đầu bình luận&quot;, hệ thống tự gọi extension để đăng bình luận thật lên bài viết, tính ngay là bạn đã hoàn thành phần này.</>
            ) : (
              <>Threads chưa hỗ trợ bình luận tự động qua extension — bạn tự dán vào bình luận thật.</>
            )} Ngoài ra có thể nhắn tin (inbox) mời chào tới người đăng bài ở mục 2 bên dưới.
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-bold text-foreground">1. Bình luận trên bài viết</label>
            {commentTemplates.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {commentTemplates.slice(0, 8).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    disabled={commentRuntime.isCommenting}
                    onClick={() => {
                      setCommentText(t.content);
                      setJustCommented(false);
                    }}
                    className="px-2.5 py-1 rounded-full border border-border text-[11px] font-semibold text-muted-foreground hover:border-primary hover:text-primary transition disabled:opacity-50"
                  >
                    {t.title}
                  </button>
                ))}
              </div>
            )}
            <textarea
              rows={3}
              value={commentText}
              onChange={(e) => {
                setCommentText(e.target.value);
                setJustCommented(false);
              }}
              disabled={commentRuntime.isCommenting}
              placeholder="Chọn mẫu ở trên hoặc tự soạn nội dung bình luận..."
              className="w-full rounded-xl border border-border bg-background p-2.5 text-sm outline-none focus:border-primary resize-y disabled:opacity-60"
            />

            {commentPlatform ? (
              <>
                {!isReady ? (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-[11px] text-amber-800 leading-relaxed">
                    Chưa kết nối được Markee Seeding Extension trên trình duyệt này — cài bản {REQUIRED_EXTENSION_VERSION}+ rồi F5 lại trang để bình luận tự động.
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={handleStartComment}
                  disabled={!isReady || !commentText.trim() || commentRuntime.isCommenting}
                  className="self-start px-4 py-2 rounded-xl bg-primary text-white text-sm font-bold disabled:opacity-50 inline-flex items-center gap-1.5"
                >
                  {commentRuntime.isCommenting ? (
                    <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  ) : (
                    <span className="material-symbols-outlined text-[16px]">bolt</span>
                  )}
                  {commentRuntime.isCommenting ? "Đang bình luận qua Extension..." : "Bắt đầu bình luận qua Extension"}
                </button>
                {commentRuntime.isCommenting && commentRuntime.progress ? (
                  <div className="text-[11px] text-muted-foreground">{commentRuntime.progress.status}</div>
                ) : null}
                {commentRuntime.lastError ? (
                  <div className="rounded-xl border border-red-200 bg-red-50 p-2.5 text-[11px] text-red-700">{commentRuntime.lastError}</div>
                ) : null}
                {justCommented ? (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-2.5 text-[11px] text-emerald-700 font-semibold flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[16px]">check_circle</span>
                    Đã bình luận thành công — nhiệm vụ này đã tính hoàn thành cho bạn.
                  </div>
                ) : null}
              </>
            ) : (
              <button
                type="button"
                onClick={async () => {
                  if (!commentText.trim()) return;
                  try {
                    await navigator.clipboard.writeText(commentText);
                  } catch {}
                  window.open(post.post_url, "_blank");
                }}
                disabled={!commentText.trim()}
                className="self-start px-4 py-2 rounded-xl bg-primary text-white text-sm font-bold disabled:opacity-50"
              >
                Sao chép & Mở bài viết
              </button>
            )}
          </div>

          {post.author_url && (
            <div className="flex flex-col gap-2 border-t border-border pt-4">
              <label className="text-sm font-bold text-foreground">2. Nhắn tin (Inbox) cho người đăng bài</label>
              <div className="flex flex-col gap-2 max-h-[260px] overflow-y-auto pr-1">
                {inboxGroups.map((group, gIdx) => (
                  <div key={gIdx} className="flex flex-col gap-1">
                    <div className="text-[10px] font-bold text-muted-foreground uppercase">{group.category}</div>
                    {group.templates.map((template) => (
                      <button
                        key={template.id}
                        type="button"
                        onClick={() => void handleCopyInbox(template)}
                        className="text-left px-3 py-2 rounded-xl border border-border hover:border-primary hover:bg-primary/5 transition"
                      >
                        <div className="text-xs font-bold text-foreground">
                          {template.title}
                          {copiedInboxId === template.id ? <span className="text-emerald-600"> · ✓ Đã copy — dán vào tin nhắn trên tab vừa mở</span> : null}
                        </div>
                        <div className="text-[11px] text-muted-foreground line-clamp-2">{composeQuickInboxMessage(template, post.content)}</div>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}

          <label className="flex items-start gap-2 text-xs text-foreground border-t border-border pt-4 cursor-pointer">
            <input type="checkbox" className="mt-0.5 rounded border-border" />
            <span>Tôi đã hiểu nhiệm vụ cần làm với bài viết này (bình luận và/hoặc inbox mời chào).</span>
          </label>
          <button
            type="button"
            onClick={onClose}
            className="self-end px-5 py-2 rounded-xl border border-border text-sm font-bold text-muted-foreground hover:bg-muted"
          >
            Đóng
          </button>
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
