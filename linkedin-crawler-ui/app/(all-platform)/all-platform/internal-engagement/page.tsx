"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FaFacebook, FaLinkedin, FaThreads, FaYoutube, FaTiktok, FaLink } from "react-icons/fa6";
import { useAppAuth } from "@/contexts/AppAuthContext";
import { API_BASE_URL } from "@/lib/env";
import {
  allPlatformMembersService,
  internalEngagementService,
  socialAccountsService,
  teamsService,
} from "@/services/all-platform.service";
import type {
  InternalEngagementInteraction,
  InternalEngagementMarkStatus,
  InternalEngagementPost,
  InternalEngagementPostTeamCount,
  InternalEngagementTeamRef,
  SocialAccount,
} from "@/types/unified.types";
import { useQuickCommentLibrary } from "@/components/all-platform/components/use-quick-comment-library";
import { TeamPerformancePanel } from "@/components/all-platform/internal-engagement/TeamPerformancePanel";
import { pingLiExtension, fetchLinkedInPostInfo } from "@/lib/li-ext-bridge";
import { extractLinkedInMetadata, sanitizeLinkedInUrl } from "@/lib/linkedin-metadata";

type TaskStatusTab = "all" | "need" | "received" | "completed";
type SourceTab = "markee" | "custom";

const getPlatformIcon = (url?: string) => {
  if (!url) {
    return (
      <div className="w-8 h-8 rounded-full bg-gray-100 text-gray-500 grid place-items-center shrink-0 shadow-xs" title="Link">
        <FaLink className="w-4 h-4" />
      </div>
    );
  }
  const lowerUrl = url.toLowerCase();
  if (lowerUrl.includes("linkedin.com") || lowerUrl.includes("lnkd.in")) {
    return (
      <div className="w-8 h-8 rounded-full bg-[#0a66c2] text-white grid place-items-center shrink-0 shadow-xs" title="LinkedIn">
        <FaLinkedin className="w-4 h-4" />
      </div>
    );
  }
  if (lowerUrl.includes("threads.net") || lowerUrl.includes("threads.com")) {
    return (
      <div className="w-8 h-8 rounded-full bg-black text-white grid place-items-center shrink-0 shadow-xs" title="Threads">
        <FaThreads className="w-4 h-4" />
      </div>
    );
  }
  if (lowerUrl.includes("youtube.com") || lowerUrl.includes("youtu.be")) {
    return (
      <div className="w-8 h-8 rounded-full bg-[#ff0000] text-white grid place-items-center shrink-0 shadow-xs" title="YouTube">
        <FaYoutube className="w-4 h-4" />
      </div>
    );
  }
  if (lowerUrl.includes("tiktok.com")) {
    return (
      <div className="w-8 h-8 rounded-full bg-black text-white grid place-items-center shrink-0 shadow-xs" title="TikTok">
        <FaTiktok className="w-4 h-4" />
      </div>
    );
  }
  return (
    <div className="w-8 h-8 rounded-full bg-[#1877f2] text-white grid place-items-center shrink-0 shadow-xs" title="Facebook">
      <FaFacebook className="w-4 h-4" />
    </div>
  );
};

const isLinkedInUrl = (url: string): boolean => /linkedin\.com|lnkd\.in/i.test(url);
const isThreadsUrl = (url: string): boolean => /threads\.net|threads\.com/i.test(url);

function fmtRelativeTime(iso?: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const diffMs = Date.now() - date.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  if (diffHours < 1) return "Vừa đăng";
  if (diffHours < 24) return `${diffHours} giờ trước`;
  return `${Math.floor(diffHours / 24)} ngày trước`;
}

/**
 * Bug 5 Fix: Smart deadline format.
 * So sánh ngày deadline với 00:00:00 của ngày hiện tại để xác định khoảng cách.
 */
function fmtDeadline(isoDeadline?: string | null): string {
  if (!isoDeadline) return "Không giới hạn";
  const deadlineDate = new Date(isoDeadline);
  if (Number.isNaN(deadlineDate.getTime())) return "Không giới hạn";

  const now = new Date();
  const timeLabel = deadlineDate.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });

  // Đã quá hạn
  if (deadlineDate < now) {
    const d = deadlineDate;
    const dateStr = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
    return `Đã quá hạn (${timeLabel} ${dateStr})`;
  }

  // Số ngày còn lại (tính từ đầu ngày hôm nay)
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const deadlineStart = new Date(deadlineDate.getFullYear(), deadlineDate.getMonth(), deadlineDate.getDate());
  const diffDays = Math.round((deadlineStart.getTime() - todayStart.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    const diffMs = deadlineDate.getTime() - now.getTime();
    const diffH = Math.floor(diffMs / (1000 * 60 * 60));
    const diffM = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    return `Hạn ${timeLabel} hôm nay (còn ${diffH}g ${diffM}p)`;
  }
  if (diffDays === 1) {
    return `Hạn ${timeLabel} ngày mai`;
  }
  return `Hạn ${timeLabel} (còn ${diffDays} ngày)`;
}

/**
 * Bug 1 Fix: Format member interaction time to Asia/Ho_Chi_Minh (UTC+7) timezone
 * format cleanly as HH:mm DD/MM/YYYY.
 */
function formatMemberTime(rawCreatedAt?: string | null, fallbackTime: string = "—"): string {
  if (!rawCreatedAt) return fallbackTime;
  const date = new Date(rawCreatedAt);
  if (Number.isNaN(date.getTime())) return fallbackTime;

  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Ho_Chi_Minh",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = formatter.formatToParts(date);
    const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
    return `${p.hour}:${p.minute} ${p.day}/${p.month}/${p.year}`;
  } catch (e) {
    return fallbackTime;
  }
}


type ToastType = "success" | "error" | "warning" | "info";
interface ToastMessage {
  text: string;
  type: ToastType;
}

export default function InternalEngagementPage() {
  const { user } = useAppAuth();
  const [toast, setToast] = useState<ToastMessage | null>(null);

  // Tabs — thứ tự hiển thị: Seeding nội bộ -> Seeding bên ngoài -> Tổng quan báo cáo.
  // Mặc định "feed" (Seeding nội bộ) - đây là trang landing chính khi vào app
  // (xem getDashboardHrefForRole trong AllPlatformSidebar.tsx).
  const [mainTab, setMainTab] = useState<"overview" | "feed" | "external">("feed");
  const [tab, setTab] = useState<TaskStatusTab>("all");
  const [sourceTab, setSourceTab] = useState<SourceTab>("markee");
  const [search, setSearch] = useState("");

  // Data
  const [posts, setPosts] = useState<InternalEngagementPost[]>([]);
  const [customPosts, setCustomPosts] = useState<InternalEngagementPost[]>([]);
  const [marks, setMarks] = useState<Record<string, InternalEngagementMarkStatus>>({});
  const [dbTeams, setDbTeams] = useState<Array<{ id: string; name_team: string; member_count: number }>>([]);
  const [selectedTeamFilter, setSelectedTeamFilter] = useState<string>("all");

  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Campaigns & Leaderboard Data State
  const [campaigns, setCampaigns] = useState<Array<{ id: string; name: string; color_code?: string; start_date?: string; end_date?: string }>>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>("all");
  const [leaderboard, setLeaderboard] = useState<Array<{
    user_id: string;
    member_name: string;
    member_email: string;
    team_name: string;
    total_assigned: number;
    total_completed: number;
    total_ontime: number;
    completion_rate: number;
    score: number;
  }>>([]);
  const [membersCount, setMembersCount] = useState<number>(0);
  const [isCampaignModalOpen, setIsCampaignModalOpen] = useState(false);
  const [isLeaderboardModalOpen, setIsLeaderboardModalOpen] = useState(false);
  const [leaderboardCurrentPage, setLeaderboardCurrentPage] = useState(1);
  const LEADERBOARD_PAGE_SIZE = 10;
  const [newCampaignName, setNewCampaignName] = useState("");
  const [newCampaignColor, setNewCampaignColor] = useState("#fff1f2");
  const [newCampaignStartDate, setNewCampaignStartDate] = useState("");
  const [newCampaignEndDate, setNewCampaignEndDate] = useState("");
  const [isCreatingCampaign, setIsCreatingCampaign] = useState(false);

  // Task Creation Modal State (Thêm bài viết Seeding)
  const [isCreateTaskModalOpen, setIsCreateTaskModalOpen] = useState(false);
  const [taskLink, setTaskLink] = useState("");
  const [taskLinkedInContent, setTaskLinkedInContent] = useState("");
  const [taskLinkedInAuthor, setTaskLinkedInAuthor] = useState("");
  const [isFetchingLiInfo, setIsFetchingLiInfo] = useState(false);
  // 'idle': chưa thử | 'fetching': đang cào ngầm | 'success': đã tự lấy được, không cần hiện bảng
  // nhập tay | 'failed': tự cào lỗi (thường do chưa đăng nhập LinkedIn) -> hiện bảng nhập tay.
  const [liAutoFetchStatus, setLiAutoFetchStatus] = useState<"idle" | "fetching" | "success" | "failed">("idle");
  const [taskCampaignId, setTaskCampaignId] = useState("");
  const [taskDeadline, setTaskDeadline] = useState("");
  const [taskAssignedTeams, setTaskAssignedTeams] = useState<string[]>([]);
  const [taskTargetLikes, setTaskTargetLikes] = useState<number>(0);
  const [taskTargetComments, setTaskTargetComments] = useState<number>(0);
  const [taskTargetShares, setTaskTargetShares] = useState<number>(15);
  const [isSubmittingTask, setIsSubmittingTask] = useState(false);

  const [socialAccounts, setSocialAccounts] = useState<SocialAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");

  const [modalPost, setModalPost] = useState<InternalEngagementPost | null>(null);
  const [commentText, setCommentText] = useState("");
  const [isTemplatePickerOpen, setIsTemplatePickerOpen] = useState(false);
  const [isExtensionReady, setIsExtensionReady] = useState(false);
  const [isLiExtensionReady, setIsLiExtensionReady] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [runProgress, setRunProgress] = useState<string | null>(null);

  // Bulk multi-select
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkCommentText, setBulkCommentText] = useState("");

  // Link thủ công
  const [customLink, setCustomLink] = useState("");
  const [isSubmittingLink, setIsSubmittingLink] = useState(false);

  // Sync Public Metrics State
  const [syncingPostId, setSyncingPostId] = useState<string | null>(null);

  // Dùng chung cho cả 3 nhánh đồng bộ (FB server-side, LinkedIn qua Playwright, LinkedIn qua
  // Extension) — patch state 2 mảng posts/customPosts để số nhảy ngay trên UI, không cần F5.
  const applyMetricsToState = (postId: string, updatedData: any) => {
    const newLikes = updatedData?.public_likes ?? updatedData?.fb_total_likes ?? 0;
    const newComments = updatedData?.public_comments ?? updatedData?.fb_total_comments ?? 0;
    const newShares = updatedData?.public_shares ?? updatedData?.fb_total_shares ?? 0;
    const newSyncedAt = updatedData?.synced_at ?? updatedData?.last_synced_at ?? new Date().toISOString();

    const updatePostItem = (p: InternalEngagementPost) =>
      p.id === postId
        ? ({
          ...p,
          public_likes: newLikes,
          public_comments: newComments,
          public_shares: newShares,
          fb_total_likes: newLikes,
          fb_total_comments: newComments,
          fb_total_shares: newShares,
          synced_at: newSyncedAt,
          last_synced_at: newSyncedAt,
          updated_at: newSyncedAt,
        } as any)
        : p;

    setPosts((prev) => prev.map(updatePostItem));
    setCustomPosts((prev) => prev.map(updatePostItem));

    return { newLikes, newComments, newShares };
  };

  const handleSyncPostMetrics = async (post: InternalEngagementPost) => {
    setSyncingPostId(post.id);
    try {
      const res = await internalEngagementService.syncPostMetrics(post.id);
      if (res && res.success) {
        const { newLikes, newComments, newShares } = applyMetricsToState(post.id, res.data);
        showToast(
          `Đã đồng bộ chỉ số Facebook gốc thành công! (${formatCompactNumber(newLikes)} Likes, ${formatCompactNumber(newComments)} Comments, ${formatCompactNumber(newShares)} Shares)`,
          "success"
        );
      } else {
        showToast(res?.message || "Không thể cào dữ liệu từ bài viết Facebook này.", "error");
      }
    } catch (err: any) {
      const errorMsg = err?.response?.data?.message || err?.message || "Có lỗi xảy ra khi đồng bộ bài viết Facebook.";
      showToast(errorMsg, "error");
    } finally {
      setSyncingPostId(null);
    }
  };

  const handleSyncLinkedInMetrics = async (post: InternalEngagementPost) => {
    const link = post.permalink_url || (post as any).link_post;
    if (!link) return showToast("Bài viết không có link LinkedIn hợp lệ.", "error");

    setSyncingPostId(post.id);
    try {
      // Ưu tiên đồng bộ hoàn toàn server-side (Playwright + account LinkedIn đã đăng ký) —
      // không cần Extension, không mở cửa sổ nào, giống hệt cách Facebook đang chạy.
      try {
        const serverRes = await internalEngagementService.syncLinkedInPlaywright(post.id);
        if (serverRes?.success) {
          const { newLikes, newComments, newShares } = applyMetricsToState(post.id, serverRes.data);
          showToast(
            `Đã tự động đồng bộ (server, không cần Extension) thành công! (${formatCompactNumber(newLikes)} Likes, ${formatCompactNumber(newComments)} Comments, ${formatCompactNumber(newShares)} Shares)`,
            "success"
          );
          return;
        }
        // success:false (vd NO_LINKEDIN_ACCOUNT) -> rơi xuống thử qua Extension bên dưới.
      } catch {
        // Lỗi mạng/server -> cũng rơi xuống thử qua Extension, không chặn hẳn người dùng.
      }

      const ping = await pingLiExtension();
      if (!ping.installed) {
        return showToast(
          "Chưa tự đồng bộ được qua server (chưa có tài khoản LinkedIn liên kết) và cũng chưa cài LinkedIn Extension — vui lòng thêm tài khoản LinkedIn tại trang Quản lý tài khoản, hoặc cài Extension để đồng bộ qua trình duyệt.",
          "error"
        );
      }
      const fetched = await fetchLinkedInPostInfo(link);
      if (!fetched.success) {
        return showToast(fetched.error || "Không lấy được số liệu bài viết LinkedIn này.", "error");
      }

      const res = await internalEngagementService.syncPostMetrics(post.id, {
        likes: fetched.likes || 0,
        comments: fetched.comments || 0,
        shares: fetched.shares || 0,
      });
      if (res && res.success) {
        const { newLikes, newComments, newShares } = applyMetricsToState(post.id, res.data);
        showToast(
          `Đã đồng bộ chỉ số LinkedIn thành công (qua Extension)! (${formatCompactNumber(newLikes)} Likes, ${formatCompactNumber(newComments)} Comments, ${formatCompactNumber(newShares)} Shares)`,
          "success"
        );
      } else {
        showToast(res?.message || "Không thể lưu số liệu bài viết LinkedIn này.", "error");
      }
    } catch (err: any) {
      const errorMsg = err?.response?.data?.message || err?.message || "Có lỗi xảy ra khi đồng bộ bài viết LinkedIn.";
      showToast(errorMsg, "error");
    } finally {
      setSyncingPostId(null);
    }
  };

  function formatCompactNumber(num: number | string | undefined | null): string {
    if (num === undefined || num === null) return "0";
    const n = Number(num);
    if (isNaN(n)) return "0";
    if (n >= 1000000) {
      const val = (n / 1000000).toFixed(1).replace(".", ",");
      return val.endsWith(",0") ? val.slice(0, -2) + "M" : val + "M";
    }
    if (n >= 1000) {
      const val = (n / 1000).toFixed(1).replace(".", ",");
      return val.endsWith(",0") ? val.slice(0, -2) + "K" : val + "K";
    }
    return n.toLocaleString("vi-VN");
  }

  // Team visibility
  const canSeeTeamInteractions = user?.role === "admin" || user?.role === "leader";
  const [teamCounts, setTeamCounts] = useState<Record<string, InternalEngagementPostTeamCount[]>>({});
  const [interactionsPost, setInteractionsPost] = useState<InternalEngagementPost | null>(null);
  const [interactionsRole, setInteractionsRole] = useState<string>("member");
  const [interactionsTeams, setInteractionsTeams] = useState<InternalEngagementTeamRef[]>([]);
  const [interactionsItems, setInteractionsItems] = useState<InternalEngagementInteraction[]>([]);
  const [interactionsTeamFilter, setInteractionsTeamFilter] = useState<string>("all");
  const [interactionsStatusFilter, setInteractionsStatusFilter] = useState<string>("all");
  const [isLoadingInteractions, setIsLoadingInteractions] = useState(false);

  // Permissions & Edit/Delete Modals
  const canManagePost = user?.role === "admin" || user?.role === "leader";
  const [openMenuPostId, setOpenMenuPostId] = useState<string | null>(null);

  // Edit Modal State (hỗ trợ deadline & Target KPI)
  const [editingPost, setEditingPost] = useState<InternalEngagementPost | null>(null);
  const [editFanpageName, setEditFanpageName] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editMediaUrl, setEditMediaUrl] = useState("");
  const [editCampaignId, setEditCampaignId] = useState("");
  const [editDeadline, setEditDeadline] = useState("");
  const [editTargetComments, setEditTargetComments] = useState<number>(32);
  const [editAssignedTeams, setEditAssignedTeams] = useState<string[]>([]);
  const [isUpdatingPost, setIsUpdatingPost] = useState(false);

  // Delete Confirm Modal State
  const [deletingPost, setDeletingPost] = useState<InternalEngagementPost | null>(null);
  const [isDeletingPost, setIsDeletingPost] = useState(false);

  const openEditModal = (post: InternalEngagementPost) => {
    setOpenMenuPostId(null);
    setEditingPost(post);
    setEditFanpageName((post as any).fanpage_name || (post as any).fanpageName || "");
    setEditContent((post as any).content || "");
    const mediaUrls = (post as any).media_urls || (post as any).mediaUrls;
    setEditMediaUrl(mediaUrls && mediaUrls.length > 0 ? mediaUrls[0] : "");

    // Bắt mọi thể loại tên của Campaign ID
    const rawCampId = (post as any).campaign_id || (post as any).campaignId || "";
    setEditCampaignId(rawCampId);

    // Bắt mọi thể loại tên Deadline
    let formattedDeadline = "";
    const rawDeadline = (post as any).deadline || (post as any).due_date || (post as any).dueDate;
    if (rawDeadline) {
      try {
        const d = new Date(rawDeadline);
        if (!isNaN(d.getTime())) {
          const pad = (n: number) => String(n).padStart(2, "0");
          formattedDeadline = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
        }
      } catch {
        // ignore
      }
    }
    setEditDeadline(formattedDeadline);

    // Bind danh sách team đã được phân công từ trước
    const rawAssigned = (post as any).assigned_team_ids || (post as any).assignedTeamIds || (post as any).team_ids || (post as any).teamIds || [];
    const assignedList = Array.isArray(rawAssigned) ? rawAssigned : [];
    setEditAssignedTeams(assignedList);

    // Bắt mọi thể loại tên của Target KPI, nếu mất hút thì tự tính theo team đã gán
    const targetComm = Number((post as any).target_comments) || Number((post as any).targetComments) || 0;
    if (targetComm > 0) {
      setEditTargetComments(targetComm);
    } else {
      const initialCalc = dbTeams.reduce((sum, t) => {
        const isSelected = assignedList.includes(t.id) || assignedList.includes(t.name_team);
        return sum + (isSelected ? (t.member_count || 0) : 0);
      }, 0);
      setEditTargetComments(initialCalc);
    }
  };

  const openDeleteConfirmModal = (post: InternalEngagementPost) => {
    setOpenMenuPostId(null);
    setDeletingPost(post);
  };

  const handleSaveEdit = async () => {
    if (!editingPost || !user?.email) return;

    if (editAssignedTeams.length === 0) {
      return showToast("Vui lòng chọn ít nhất một Team thực hiện!", "error");
    }

    const targetComm = Number(editTargetComments);
    if (isNaN(targetComm) || targetComm <= 0 || targetComm > editTotalSelectedMembers) {
      return showToast(
        `Số lượng Target Comment phải từ 1 đến tối đa ${editTotalSelectedMembers} (tương ứng tổng số thành viên đã chọn)!`,
        "error"
      );
    }

    setIsUpdatingPost(true);
    try {
      const selectedCamp = campaigns.find((c) => c.id === editCampaignId);

      const resolvedEditTeamUUIDs = editAssignedTeams
        .map((val) => {
          const match = dbTeams.find(
            (t) =>
              t.id === val ||
              t.name_team === val ||
              t.name_team.toLowerCase().includes(val.toLowerCase()) ||
              val.toLowerCase().includes(t.name_team.toLowerCase())
          );
          return match ? match.id : val;
        })
        .filter((id) => Boolean(id) && id.length > 20);

      const payload = {
        email: user.email,
        fanpage_name: editFanpageName.trim() || undefined,
        content: editContent.trim() || undefined,
        media_urls: editMediaUrl.trim() ? [editMediaUrl.trim()] : undefined,
        campaign_id: editCampaignId || undefined,
        campaign_name: selectedCamp?.name || undefined,
        deadline: editDeadline ? new Date(editDeadline).toISOString() : undefined,
        target_comments: targetComm,
        assigned_team_ids: resolvedEditTeamUUIDs,
      };

      let res = await internalEngagementService.updateCustomPost(editingPost.id, payload);
      if (!res || !res.success) {
        res = await internalEngagementService.overrideMarkeePost(editingPost.id, payload);
      }

      if (res && res.success) {
        showToast("Đã cập nhật thông tin bài viết & Target KPI thành công!", "success");
        setEditingPost(null);
        await loadPosts();
      } else {
        showToast(res?.message || "Không thể cập nhật bài viết.", "error");
      }
    } catch (error) {
      showToast("Có lỗi xảy ra khi cập nhật bài viết.", "error");
    } finally {
      setIsUpdatingPost(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingPost || !user?.email) return;
    setIsDeletingPost(true);
    try {
      let res;
      // Bug 2 Fix: Determine if it's a custom post or Markee post by checking fanpage_id
      if (deletingPost.fanpage_id === "custom") {
        res = await internalEngagementService.deleteCustomPost(deletingPost.id, user.email);
      } else {
        res = await internalEngagementService.hideMarkeePost(deletingPost.id, user.email);
      }

      if (res && res.success) {
        showToast("Đã xóa/ẩn bài viết thành công!", "success");

        // Optimistic Update: Immediately filter out the deleted post from state so it disappears from UI
        const deletedId = deletingPost.id;
        setCustomPosts((prev) => prev.filter((p) => p.id !== deletedId));
        setPosts((prev) => prev.filter((p) => p.id !== deletedId));
        setDeletingPost(null);

        // Refresh from server in background to keep totals and pagination consistent
        await loadPosts();
      } else {
        showToast(res?.message || "Không thể xóa bài viết.", "error");
      }
    } catch (error) {
      showToast("Có lỗi xảy ra khi xóa bài viết.", "error");
    } finally {
      setIsDeletingPost(false);
    }
  };

  const { libraryItems: commentTemplates } = useQuickCommentLibrary(modalPost?.platform || "facebook");
  const { libraryItems: allQuickComments } = useQuickCommentLibrary();

  const handleDoTask = async (post: InternalEngagementPost) => {
    const postUrl = post.permalink_url || (post as any).link_post || "";
    if (!postUrl) return;

    // Random 1 mẫu câu từ thư viện mẫu câu khả dụng
    if (allQuickComments && allQuickComments.length > 0) {
      const postPlatform = post.platform || (postUrl.includes("linkedin.com") ? "linkedin" : postUrl.includes("youtube.com") ? "youtube" : "facebook");
      const matchingTemplates = allQuickComments.filter(
        (t) => t.platform === "all" || t.platform === postPlatform
      );
      const candidateList = matchingTemplates.length > 0 ? matchingTemplates : allQuickComments;
      const randomItem = candidateList[Math.floor(Math.random() * candidateList.length)];

      if (randomItem && randomItem.content) {
        try {
          await navigator.clipboard.writeText(randomItem.content);
          showToast("Đã copy mẫu câu. Hãy dán (Ctrl+V) vào bình luận nhé!", "success");
        } catch (err) {
          console.warn("Clipboard write failed:", err);
        }
      }
    }

    // Gửi message cho Extension và mở Tab bài viết
    const currentOrigin = typeof window !== "undefined" ? window.location.origin : "https://seeding.markeeai.com";
    const fanpageId = (post as any).fanpage_id || (post as any).fanpageId || "";
    const fanpageName = (post as any).fanpage_name || (post as any).fanpageName || "";
    const facebookPostId = (post as any).facebook_post_id || (post as any).id_post || (post as any).facebookPostId || post.id || "unknown";

    window.postMessage({
      type: "SYNC_ACTIVE_MEMBER",
      action: "SYNC_ACTIVE_MEMBER",
      payload: {
        email_member: user?.email || "",
        apiBase: currentOrigin,
        fanpage_id: fanpageId,
        fanpage_name: fanpageName,
        facebook_post_id: facebookPostId,
        target_link: postUrl,
      },
    }, "*");

    setTimeout(() => { window.open(postUrl, "_blank"); }, 200);
  };

  const handleOpenOriginalPost = (post: InternalEngagementPost) => {
    const postUrl = post.permalink_url || (post as any).link_post || "";
    if (!postUrl) return;

    const currentOrigin = typeof window !== "undefined" ? window.location.origin : "https://seeding.markeeai.com";
    const fanpageId = (post as any).fanpage_id || (post as any).fanpageId || "";
    const fanpageName = (post as any).fanpage_name || (post as any).fanpageName || "";
    const facebookPostId = (post as any).facebook_post_id || (post as any).id_post || (post as any).facebookPostId || post.id || "unknown";

    window.postMessage({
      type: "SYNC_ACTIVE_MEMBER",
      action: "SYNC_ACTIVE_MEMBER",
      payload: {
        email_member: user?.email || "",
        apiBase: currentOrigin,
        fanpage_id: fanpageId,
        fanpage_name: fanpageName,
        facebook_post_id: facebookPostId,
        target_link: postUrl,
      },
    }, "*");

    setTimeout(() => { window.open(postUrl, "_blank"); }, 200);
  };

  const commentTemplateGroups = useMemo(() => {
    const groups = new Map<string, { label: string; templates: typeof commentTemplates }>();
    commentTemplates.forEach((item) => {
      const label = item.label || "Khác";
      if (!groups.has(label)) groups.set(label, { label, templates: [] });
      groups.get(label)!.templates.push(item);
    });
    return Array.from(groups.values());
  }, [commentTemplates]);

  const showToast = (text: string, type?: ToastType) => {
    let resolvedType: ToastType = type || "info";
    if (!type) {
      const lower = text.toLowerCase();
      if (
        lower.includes("thành công") ||
        lower.includes("đã thêm") ||
        lower.includes("đã xóa") ||
        lower.includes("đã ẩn") ||
        lower.includes("đã cập nhật")
      ) {
        resolvedType = "success";
      } else if (
        lower.includes("lỗi") ||
        lower.includes("thất bại") ||
        lower.includes("không thể") ||
        lower.includes("vui lòng") ||
        lower.includes("chưa") ||
        lower.includes("cảnh báo")
      ) {
        resolvedType = "error";
      }
    }
    setToast({ text, type: resolvedType });
    window.setTimeout(() => setToast(null), 4500);
  };

  const loadPosts = async () => {
    setIsLoading(true);
    setLoadError(null);

    try {
      // Gọi song song 2 API
      const [res, customRes] = await Promise.all([
        internalEngagementService.listPosts(1, 50, user?.email),
        internalEngagementService.listCustomPosts(1, 50),
      ]);

      const markeeItems = res.success && res.data ? res.data.items || [] : [];

      // Lấy data thủ công và chuẩn hóa dữ liệu
      const customItemsRaw = customRes.success && customRes.data ? customRes.data.items || [] : [];
      const customItems = customItemsRaw.map((item: any) => ({
        ...item,
        permalink_url: item.permalink_url || item.post_url || item.link_post,
        fanpage_name: item.fanpage_name || item.page_name || "Markee AI Marketing",
        content: item.content || "(Bài viết không có nội dung văn bản)",
        media_urls: Array.isArray(item.media_urls)
          ? item.media_urls
          : item.media_url
            ? [item.media_url]
            : [],
        created_at: item.created_at || item.published_at,
      })) as InternalEngagementPost[];

      setPosts(markeeItems);
      setCustomPosts(customItems);

      if (user?.email) {
        // Gộp tất cả link từ cả 2 nguồn để check marks 1 lần
        const allLinks = [
          ...markeeItems.map((p) => p.permalink_url),
          ...customItems.map((p) => p.permalink_url)
        ].filter(Boolean) as string[];

        if (allLinks.length > 0) {
          const marksRes = await internalEngagementService.getMyMarks(user.email, allLinks);
          if (marksRes.success && marksRes.data) {
            setMarks(marksRes.data.marks || {});
          }
        }
      }
    } catch (error) {
      setLoadError("Lỗi khi tải danh sách bài viết.");
    } finally {
      setIsLoading(false);
    }
  };

  const loadCampaigns = async () => {
    try {
      const res = await internalEngagementService.getCampaigns();
      if (res.success && res.data) {
        setCampaigns(res.data);
      }
    } catch {
      // ignore
    }
  };

  const loadLeaderboard = async () => {
    try {
      const res = await internalEngagementService.getLeaderboard();
      if (res.success && res.data) {
        // Calculate and sort leaderboard dynamically
        const calculated = res.data.map((item) => {
          const assigned = Number(item.total_assigned) || 0;
          const completed = Number(item.total_completed) || 0;
          const rate = assigned > 0 ? Math.round((completed / assigned) * 1000) / 10 : 0;
          return {
            ...item,
            total_assigned: assigned,
            total_completed: completed,
            completion_rate: rate,
            score: completed, // 1 Completed = 1 Point
          };
        });

        // Sort leaderboard dynamically without stripping unassigned members
        calculated.sort((a, b) => {
          if (b.completion_rate !== a.completion_rate) {
            return b.completion_rate - a.completion_rate;
          }
          return b.total_completed - a.total_completed;
        });

        setLeaderboard(calculated);
      }
    } catch {
      // ignore
    }
  };

  const loadMembers = async () => {
    try {
      const res = await allPlatformMembersService.getAll();
      if (res.success && res.data) {
        setMembersCount(res.data.length);
      }
    } catch {
      // ignore
    }
  };

  const loadTeams = async () => {
    try {
      const [teamsRes, membersRes] = await Promise.all([
        teamsService.getWithKpi().catch(() => ({ success: false, data: null })),
        allPlatformMembersService.getAll().catch(() => ({ success: false, data: null })),
      ]);

      const members = (membersRes && membersRes.success && Array.isArray(membersRes.data)) ? membersRes.data : [];
      setMembersCount(members.length);

      // Group members count by team ID and team Name
      const countByTeamKeyMap: Record<string, number> = {};
      const teamNamesFound = new Set<string>();

      members.forEach((m: any) => {
        if (m.team) {
          const rawTeam = String(m.team).trim();
          const key = rawTeam.toLowerCase();
          countByTeamKeyMap[key] = (countByTeamKeyMap[key] || 0) + 1;
          teamNamesFound.add(rawTeam);
        }
      });

      const rawTeamsList = (teamsRes && teamsRes.success && teamsRes.data)
        ? (teamsRes.data.teams || (Array.isArray(teamsRes.data) ? teamsRes.data : []))
        : [];

      if (rawTeamsList.length > 0) {
        const parsedTeams = rawTeamsList.map((t: any) => {
          const tId = String(t.id || "").toLowerCase();
          const tName = String(t.name_team || "").toLowerCase();

          const directCount = Number(t.number_of_member || t.member_count || (Array.isArray(t.members) ? t.members.length : 0)) || 0;
          const mapCount = countByTeamKeyMap[tId] || countByTeamKeyMap[tName] || 0;
          const finalCount = Math.max(directCount, mapCount);

          return {
            id: String(t.id),
            name_team: t.name_team,
            member_count: finalCount,
          };
        });
        setDbTeams(parsedTeams);
      } else if (teamNamesFound.size > 0) {
        const fallbackTeams = Array.from(teamNamesFound).map((name) => ({
          id: name,
          name_team: name,
          member_count: countByTeamKeyMap[name.toLowerCase()] || 0,
        }));
        setDbTeams(fallbackTeams);
      }
    } catch {
      // ignore
    }
  };

  // Dynamic Target KPI Calculation based on selected teams
  const totalSelectedMembers = useMemo(() => {
    if (taskAssignedTeams.length === 0) return 0;
    if (dbTeams.length > 0) {
      return dbTeams.reduce((sum, t) => {
        const isSelected = taskAssignedTeams.includes(t.id) || taskAssignedTeams.includes(t.name_team);
        return sum + (isSelected ? (t.member_count || 0) : 0);
      }, 0);
    }
    return taskAssignedTeams.length * 5;
  }, [taskAssignedTeams, dbTeams]);

  useEffect(() => {
    setTaskTargetLikes(totalSelectedMembers);
    setTaskTargetComments(totalSelectedMembers);
  }, [totalSelectedMembers]);

  // Dynamic Target KPI Calculation for Edit Modal
  const editTotalSelectedMembers = useMemo(() => {
    if (editAssignedTeams.length === 0) return 0;
    if (dbTeams.length > 0) {
      return dbTeams.reduce((sum, t) => {
        const isSelected = editAssignedTeams.includes(t.id) || editAssignedTeams.includes(t.name_team);
        return sum + (isSelected ? (t.member_count || 0) : 0);
      }, 0);
    }
    return editAssignedTeams.length * 5;
  }, [editAssignedTeams, dbTeams]);

  useEffect(() => {
    if (editingPost) {
      setEditTargetComments(editTotalSelectedMembers);
    }
  }, [editTotalSelectedMembers]);

  const isAllEditTeamsSelected = useMemo(() => {
    if (dbTeams.length === 0) return false;
    return dbTeams.every((t) => editAssignedTeams.includes(t.id) || editAssignedTeams.includes(t.name_team));
  }, [dbTeams, editAssignedTeams]);

  const toggleSelectAllEditTeams = () => {
    if (isAllEditTeamsSelected) {
      setEditAssignedTeams([]);
    } else {
      setEditAssignedTeams(dbTeams.map((t) => t.id));
    }
  };

  const openCreateTaskModal = () => {
    setTaskLink("");
    setTaskLinkedInContent("");
    setTaskLinkedInAuthor("");
    setLiAutoFetchStatus("idle");
    lastAutoFetchedLiLinkRef.current = null;
    taskLinkedInMetricsRef.current = {};
    setTaskCampaignId("");
    setTaskDeadline("");
    setTaskAssignedTeams([]);
    setTaskTargetLikes(0);
    setTaskTargetComments(0);
    setIsCreateTaskModalOpen(true);
  };

  const isAllTeamsSelected = useMemo(() => {
    if (dbTeams.length === 0) return false;
    return dbTeams.every((t) => taskAssignedTeams.includes(t.id) || taskAssignedTeams.includes(t.name_team));
  }, [dbTeams, taskAssignedTeams]);

  const toggleSelectAllTeams = () => {
    if (isAllTeamsSelected) {
      setTaskAssignedTeams([]);
    } else {
      setTaskAssignedTeams(dbTeams.map((t) => t.id));
    }
  };

  const [deletingCampaignTarget, setDeletingCampaignTarget] = useState<{ id: string; name: string } | null>(null);

  const handleDeleteCampaignClick = (campaignId: string, campaignName: string) => {
    setDeletingCampaignTarget({ id: campaignId, name: campaignName });
  };

  const handleConfirmDeleteCampaign = async () => {
    if (!deletingCampaignTarget) return;
    const { id: campaignId, name: campaignName } = deletingCampaignTarget;
    try {
      const res = await internalEngagementService.deleteCampaign(campaignId);
      if (res && res.success) {
        showToast(`Đã xóa chiến dịch "${campaignName}" thành công!`, "success");
        if (selectedCampaignId === campaignId) setSelectedCampaignId("all");
        loadCampaigns();
        setDeletingCampaignTarget(null);
      } else {
        showToast(res?.message || "Lỗi khi xóa chiến dịch.", "error");
      }
    } catch {
      showToast("Có lỗi xảy ra khi xóa chiến dịch.", "error");
    }
  };

  useEffect(() => {
    loadCampaigns();
    loadLeaderboard();
    loadMembers();
    loadTeams();
  }, [user?.email]);



  const handleCreateCampaign = async () => {
    if (!newCampaignName.trim()) {
      return showToast("Vui lòng nhập tên chiến dịch.", "error");
    }

    setIsCreatingCampaign(true);
    try {
      const res = await internalEngagementService.createCampaign({
        name: newCampaignName.trim(),
        color_code: newCampaignColor,
        start_date: newCampaignStartDate ? new Date(newCampaignStartDate).toISOString() : undefined,
        end_date: newCampaignEndDate ? new Date(newCampaignEndDate).toISOString() : undefined,
        created_by_email: user?.email,
      });
      if (res && res.success) {
        showToast("Đã tạo chiến dịch Seeding mới thành công!", "success");
        setIsCampaignModalOpen(false);
        setNewCampaignName("");
        setNewCampaignStartDate("");
        setNewCampaignEndDate("");
        loadCampaigns();
      } else {
        showToast(res?.message || "Lỗi khi tạo chiến dịch.", "error");
      }
    } catch (error) {
      showToast("Có lỗi xảy ra khi tạo chiến dịch.", "error");
    } finally {
      setIsCreatingCampaign(false);
    }
  };

  const lastAutoFetchedLiLinkRef = useRef<string | null>(null);
  const taskLinkedInMetricsRef = useRef<{ likes?: number; comments?: number; shares?: number }>({});

  const autoFetchLiInfo = async (link: string, opts?: { silent?: boolean }) => {
    const cleanLink = sanitizeLinkedInUrl(link);
    const isStale = () => lastAutoFetchedLiLinkRef.current !== link && lastAutoFetchedLiLinkRef.current !== cleanLink;

    setIsFetchingLiInfo(true);
    setLiAutoFetchStatus("fetching");
    try {
      const res = await internalEngagementService.debugFetchMeta(cleanLink);
      if (isStale()) return;

      if (res && res.success && res.data) {
        const extracted = extractLinkedInMetadata(res.data);
        if (extracted.content) setTaskLinkedInContent(extracted.content);
        if (extracted.author_name) setTaskLinkedInAuthor(extracted.author_name);
        setLiAutoFetchStatus("success");
        if (!opts?.silent) {
          showToast("Đã tự động lấy nội dung bài viết LinkedIn thành công!", "success");
        }
      } else {
        setLiAutoFetchStatus("failed");
      }
    } catch (err) {
      if (!isStale()) {
        setLiAutoFetchStatus("failed");
      }
    } finally {
      if (!isStale()) setIsFetchingLiInfo(false);
    }
  };

  const handleAutoFetchLiInfo = () => {
    const trimmed = sanitizeLinkedInUrl(taskLink.trim());
    if (!trimmed) return showToast("Vui lòng dán link bài viết LinkedIn trước.", "error");
    lastAutoFetchedLiLinkRef.current = trimmed;
    autoFetchLiInfo(trimmed);
  };

  // Tự động lấy nội dung ngay khi dán/gõ xong link LinkedIn — debounce 600ms, chỉ chạy lại khi link thực sự đổi.
  useEffect(() => {
    if (!isCreateTaskModalOpen) return;
    const trimmed = sanitizeLinkedInUrl(taskLink.trim());
    const isLinkedIn = isLinkedInUrl(trimmed);
    if (!isLinkedIn || !trimmed) return;
    if (lastAutoFetchedLiLinkRef.current === trimmed) return;

    const timer = window.setTimeout(() => {
      lastAutoFetchedLiLinkRef.current = trimmed;
      autoFetchLiInfo(trimmed, { silent: true });
    }, 600);

    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskLink, isCreateTaskModalOpen]);

  const handleCreateTaskSubmit = async () => {
    const socialRegex = /^(https?:\/\/)?([\w-]+\.)*(facebook\.com|fb\.com|fb\.watch|youtube\.com|youtu\.be|tiktok\.com|linkedin\.com|lnkd\.in|threads\.net|threads\.com)\/.+$/i;

    const rawLink = taskLink.trim();
    if (!rawLink) {
      return showToast("Vui lòng nhập link bài viết!", "error");
    }

    if (!socialRegex.test(rawLink)) {
      return showToast("Vui lòng nhập đường link hợp lệ (Facebook, YouTube, TikTok, LinkedIn, Threads).", "error");
    }

    if (taskAssignedTeams.length === 0) {
      return showToast("Vui lòng chọn ít nhất một Team thực hiện!", "error");
    }

    const targetComm = Number(taskTargetComments);
    if (isNaN(targetComm) || targetComm <= 0 || targetComm > totalSelectedMembers) {
      return showToast(
        `Số lượng Target Comment phải từ 1 đến tối đa ${totalSelectedMembers} (tương ứng tổng số thành viên đã chọn)!`,
        "error"
      );
    }

    if (!user?.email) {
      return showToast("Chưa xác định được tài khoản đăng nhập.", "error");
    }

    const isLinkedInLink = isLinkedInUrl(rawLink);
    const isThreadsLink = !isLinkedInLink && isThreadsUrl(rawLink);
    const finalCleanLink = isLinkedInLink ? sanitizeLinkedInUrl(rawLink) : rawLink;

    if (isLinkedInLink && liAutoFetchStatus === "fetching") {
      return showToast("Đang tự động lấy nội dung bài viết, vui lòng đợi vài giây...", "error");
    }

    setIsSubmittingTask(true);
    try {
      const selectedCamp = campaigns.find((c) => c.id === taskCampaignId);

      const resolvedTeamUUIDs = taskAssignedTeams
        .map((val) => {
          const match = dbTeams.find(
            (t) =>
              t.id === val ||
              t.name_team === val ||
              t.name_team.toLowerCase().includes(val.toLowerCase()) ||
              val.toLowerCase().includes(t.name_team.toLowerCase())
          );
          return match ? match.id : val;
        })
        .filter((id) => Boolean(id) && id.length > 20);

      const payload = {
        link: finalCleanLink,
        email: user.email,
        platform: isLinkedInLink ? "linkedin" : isThreadsLink ? "threads" : "facebook",
        content: isLinkedInLink ? taskLinkedInContent.trim() : undefined,
        fanpage_name: isLinkedInLink ? taskLinkedInAuthor.trim() || undefined : undefined,
        likes: isLinkedInLink ? taskLinkedInMetricsRef.current.likes : undefined,
        comments: isLinkedInLink ? taskLinkedInMetricsRef.current.comments : undefined,
        shares: isLinkedInLink ? taskLinkedInMetricsRef.current.shares : undefined,
        campaign_id: taskCampaignId.trim() || undefined,
        campaign_name: selectedCamp?.name || undefined,
        deadline: taskDeadline ? new Date(taskDeadline).toISOString() : undefined,
        target_comments: targetComm,
        assigned_team_ids: resolvedTeamUUIDs,
        // Bài tạo từ tab "Seeding bên ngoài" đánh dấu external để hiện đúng
        // tab, không lẫn vào "Seeding nội bộ" (xem scopedPosts).
        scope: (mainTab === "external" ? "external" : "internal") as "internal" | "external",
      };

      const res = await internalEngagementService.addCustomPost(payload);

      if (res && res.success) {
        showToast("Đã thêm bài viết Seeding mới thành công!", "success");
        setIsCreateTaskModalOpen(false);
        setTaskLink("");
        setTaskLinkedInContent("");
        setTaskLinkedInAuthor("");
        setLiAutoFetchStatus("idle");
        lastAutoFetchedLiLinkRef.current = null;
    taskLinkedInMetricsRef.current = {};
        setTaskCampaignId("");
        setTaskDeadline("");
        setTaskAssignedTeams([]);
        setTaskTargetComments(0);
        setTaskTargetLikes(0);
        await loadPosts();
      } else {
        showToast(res?.message || "Lỗi khi tạo bài viết Seeding.", "error");
      }
    } catch (error) {
      showToast("Có lỗi xảy ra khi gửi yêu cầu.", "error");
    } finally {
      setIsSubmittingTask(false);
    }
  };

  const handleRemindMembers = (post: InternalEngagementPost) => {
    showToast("Đã gửi thông báo nhắc nhở tới các thành viên chưa hoàn thành bài viết!", "success");
  };

  const handleSubmitCustomLink = async () => {
    const fbRegex = /^(https?:\/\/)?(www\.|m\.|mobile\.)?(facebook\.com|fb\.com|fb\.watch)\/.+$/i;

    if (!customLink.trim()) {
      return showToast("Vui lòng nhập link bài viết Facebook.", "error");
    }

    if (!fbRegex.test(customLink.trim())) {
      return showToast("Vui lòng nhập đường link Facebook hợp lệ (facebook.com).", "error");
    }

    if (!user?.email) {
      return showToast("Chưa xác định được tài khoản đăng nhập.", "error");
    }

    setIsSubmittingLink(true);
    try {
      const res = await internalEngagementService.addCustomPost(customLink.trim(), user.email);
      if (res && res.success) {
        showToast("Đã thêm bài viết thủ công thành công!", "success");
        setCustomLink("");
        loadPosts();
        setSourceTab("custom"); // Tự động chuyển qua tab thủ công
        loadPosts();
      } else {
        showToast(res?.message || "Lỗi khi thêm bài viết.", "error");
      }
    } catch (error) {
      showToast("Có lỗi xảy ra khi gửi yêu cầu.", "error");
    } finally {
      setIsSubmittingLink(false);
    }
  };

  // Combine all posts into a single unified list sorted by newest creation time (created_at DESC)
  const allCombinedPosts = useMemo(() => {
    const map = new Map<string, InternalEngagementPost>();
    posts.forEach((p) => map.set(p.id, p));
    customPosts.forEach((p) => map.set(p.id, p));
    const list = Array.from(map.values());

    return list.sort((a, b) => {
      const timeA = a.created_at ? new Date(a.created_at).getTime() : 0;
      const timeB = b.created_at ? new Date(b.created_at).getTime() : 0;
      return timeB - timeA;
    });
  }, [posts, customPosts]);

  // Tab "Seeding nội bộ" vs "Seeding bên ngoài": bài markee-sourced (auto kéo
  // từ MarkeeAI) luôn là nội bộ (không có field scope). Bài custom-post mặc
  // định "internal" trừ khi tạo từ tab "Seeding bên ngoài" (xem
  // handleCreateTaskSubmit). Tab "Tổng quan báo cáo" KHÔNG lọc — gộp cả 2.
  const scopedPosts = useMemo(() => {
    if (mainTab === "external") {
      return allCombinedPosts.filter((post) => (post as any).scope === "external");
    }
    return allCombinedPosts.filter((post) => (post as any).scope !== "external");
  }, [allCombinedPosts, mainTab]);

  const realStats = useMemo(() => {
    // 1. Total Seeders: Total active members across all teams in company (always 20)
    const totalSeeder = dbTeams.reduce((sum, t) => sum + (t.member_count || 0), 0) || (membersCount > 0 ? membersCount : 20);

    const activePosts = allCombinedPosts.length;

    // 3. Target KPI Comments: Sum of post.target_comments across active posts (e.g. 20 + 20 + 6 = 46)
    const totalTargetComments = allCombinedPosts.reduce((sum, post) => {
      const rawTarget = Number((post as any).target_comments);
      if (!isNaN(rawTarget) && rawTarget > 0) {
        return sum + rawTarget;
      }
      const teams = ((post as any).assigned_team_ids || []).map((t: string) => t?.toLowerCase());
      if (teams.length === 0) {
        return sum + totalSeeder;
      } else {
        const assignedDbTeams = dbTeams.filter(
          (t) => teams.includes(t.id.toLowerCase()) || teams.includes(t.name_team.toLowerCase())
        );
        const postTarget = assignedDbTeams.reduce((s, t) => s + (t.member_count || 0), 0);
        return sum + (postTarget || totalSeeder);
      }
    }, 0);

    const totalCompletedComments = allCombinedPosts.reduce((sum, post) => {
      const postTeamStats = teamCounts[post.id] || [];
      const assignedTeams = (post as any).assigned_team_ids || [];
      const postInteracted = postTeamStats
        .filter((t) => assignedTeams.length === 0 || assignedTeams.includes(t.team_id) || assignedTeams.includes(t.team_name))
        .reduce((s, t) => s + (t.count || 0), 0);
      return sum + postInteracted;
    }, 0);

    const activeUniqueMembers = leaderboard.filter((item) => item.total_completed > 0).length;

    const perfectMembers = leaderboard.filter((item) => item.total_completed === item.total_assigned && item.total_assigned > 0).length;

    return {
      totalSeeder,
      activePosts,
      totalTargetComments,
      totalCompletedComments,
      activeUniqueMembers,
      perfectMembers,
    };
  }, [membersCount, leaderboard, allCombinedPosts, dbTeams, teamCounts]);

  // Unified multi-filter algorithm: Search, Campaign, Team, Status
  const filteredPosts = useMemo(() => {
    return scopedPosts.filter((post) => {
      // 1. Search Query Filter
      if (search.trim()) {
        const q = search.toLowerCase();
        const contentMatch = (post.content || "").toLowerCase().includes(q);
        const fanpageMatch = (post.fanpage_name || "").toLowerCase().includes(q);
        if (!contentMatch && !fanpageMatch) return false;
      }

      // 2. Campaign Filter
      if (selectedCampaignId !== "all") {
        const postCampId = (post as any).campaign_id;
        if (postCampId !== selectedCampaignId) return false;
      }

      // 3. Team Filter
      if (selectedTeamFilter !== "all") {
        const assignedTeams: string[] = (post as any).assigned_team_ids || [];
        const matchedTeamObj = dbTeams.find((t) => t.id === selectedTeamFilter);
        const targetTeamName = matchedTeamObj?.name_team || selectedTeamFilter;

        if (assignedTeams.length > 0) {
          const hasTeam = assignedTeams.some(
            (t) => t === selectedTeamFilter || t.toLowerCase() === targetTeamName.toLowerCase()
          );
          if (!hasTeam) return false;
        }
      }

      // 4. Status Filter
      const rawTarget = (post as any).target_comments || (post as any).targetComments;
      const targetTotal = Number(rawTarget) > 0 ? Number(rawTarget) : 32;
      const postTeamStats = teamCounts[post.id] || [];
      const interactedCount = postTeamStats.reduce((sum, t) => sum + (t.count || 0), 0);

      const isCompleted = targetTotal > 0 && interactedCount >= targetTotal;
      const isOverdue = (post as any).deadline && new Date((post as any).deadline) < new Date() && !isCompleted;

      if (tab === "need" || tab === ("in_progress" as any)) {
        if (isCompleted || isOverdue) return false;
      } else if (tab === "completed") {
        if (!isCompleted) return false;
      } else if (tab === ("overdue" as any)) {
        if (!isOverdue) return false;
      }

      return true;
    });
  }, [scopedPosts, search, selectedCampaignId, selectedTeamFilter, tab, dbTeams, teamCounts]);

  const tabCounts = useMemo(() => {
    let all = scopedPosts.length;
    let need = 0;
    let completed = 0;
    let overdue = 0;

    scopedPosts.forEach((post) => {
      const rawTarget = (post as any).target_comments || (post as any).targetComments;
      const targetTotal = Number(rawTarget) > 0 ? Number(rawTarget) : 32;
      const postTeamStats = teamCounts[post.id] || [];
      const interactedCount = postTeamStats.reduce((sum, t) => sum + (t.count || 0), 0);
      const isComp = targetTotal > 0 && interactedCount >= targetTotal;
      const isOver = (post as any).deadline && new Date((post as any).deadline) < new Date() && !isComp;

      if (isComp) completed++;
      else if (isOver) overdue++;
      else need++;
    });

    return { all, need, completed, overdue, received: need };
  }, [scopedPosts, teamCounts]);

  // Admin/leader: badge "Team X: N tương tác" hiển thị dưới mỗi bài.
  useEffect(() => {
    if (!user?.email || !canSeeTeamInteractions || allCombinedPosts.length === 0) return;
    let cancelled = false;

    Promise.all(
      allCombinedPosts
        .filter((p: InternalEngagementPost) => p.permalink_url)
        .map((p: InternalEngagementPost) =>
          internalEngagementService
            .getPostTeamCounts(p.permalink_url as string, user.email)
            .then((res) => [p.id, res.success && res.data ? res.data.teams : []] as const),
        ),
    ).then((results) => {
      if (cancelled) return;
      const map: Record<string, InternalEngagementPostTeamCount[]> = {};
      results.forEach(([postId, teams]: readonly [string, InternalEngagementPostTeamCount[]]) => {
        map[postId] = teams;
      });
      setTeamCounts(map);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allCombinedPosts, user?.email, canSeeTeamInteractions]);

  const openInteractionsModal = async (post: InternalEngagementPost, teamId?: string) => {
    if (!user?.email || !post.permalink_url) return;
    setInteractionsPost(post);
    setInteractionsTeamFilter(teamId || "all");
    setIsLoadingInteractions(true);
    const res = await internalEngagementService.getPostInteractions(
      post.permalink_url,
      user.email,
      teamId === "all" ? undefined : teamId,
    );
    if (res.success && res.data) {
      setInteractionsRole(res.data.role);
      setInteractionsTeams(res.data.teams);
      setInteractionsItems(res.data.items);
    } else {
      showToast(res.message || "Không tải được danh sách tương tác.");
    }
    setIsLoadingInteractions(false);
  };

  const changeInteractionsTeamFilter = async (teamId: string) => {
    if (!interactionsPost) return;
    setInteractionsTeamFilter(teamId);
    await openInteractionsModal(interactionsPost, teamId);
  };

  const closeInteractionsModal = () => {
    setInteractionsPost(null);
    setInteractionsItems([]);
    setInteractionsTeams([]);
  };

  useEffect(() => {
    loadPosts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.email]);

  useEffect(() => {
    socialAccountsService.getAll("facebook").then((res) => {
      if (res.data) {
        setSocialAccounts(res.data);
        if (res.data.length > 0) setSelectedAccountId(res.data[0].id);
      }
    });
  }, []);

  const lastResultRef = useRef<{ success: boolean; error?: string } | null>(null);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const action = event.data?.action;
      if (action === "COMMENT_EXTENSION_READY") {
        setIsExtensionReady(true);
      } else if (action === "LI_EXTENSION_READY") {
        setIsLiExtensionReady(true);
      } else if (action === "COMMENT_EXTENSION_INVALIDATED" || action === "LI_EXTENSION_INVALIDATED") {
        // Extension vua duoc cai lai/cap nhat trong khi tab nay da mo tu truoc -> ket noi
        // cu (bridge.js dang chay tren trang) bi vo hieu, moi lenh gui di deu roi vao im
        // lang (khong loi, khong toast) - dung y het trieu chung "bam Gui khong ra gi ca".
        // Bao ro cho nguoi dung thay vi de im lang, va tat trang thai "san sang" gia.
        setIsExtensionReady(false);
        setIsLiExtensionReady(false);
        setIsRunning(false);
        setRunProgress(null);
        showToast("Extension vừa được cập nhật/cài lại — vui lòng tải lại trang (F5) để kết nối lại rồi thử gửi comment lại.", "error");
      } else if (action === "BULK_COMMENT_FAILED_TO_START" || action === "LI_COMMENT_FAILED_TO_START") {
        // Background tu choi ngay lap tuc (vd dang tuong nham co 1 tien trinh khac
        // chua xong) - truoc day bi im lang hoan toan, gio bao ro cho nguoi dung.
        setIsRunning(false);
        setRunProgress(null);
        showToast(`Không gửi được comment: ${event.data?.error || "Lỗi không xác định"}`, "error");
      } else if (action === "LI_COMMENT_STARTED") {
        setIsRunning(true);
        setRunProgress("Đang mở bài viết LinkedIn...");
        lastResultRef.current = null;
      } else if (action === "LI_COMMENT_PROGRESS") {
        setRunProgress(event.data.payload?.status || null);
      } else if (action === "LI_COMMENT_DONE") {
        const result = event.data.payload?.result;
        setIsRunning(false);
        setRunProgress(null);
        setModalPost(null);
        setCommentText("");
        if (result && result.success === false) {
          showToast(`Comment thất bại: ${result.error || "Lỗi không xác định"}`);
        } else {
          showToast("Đã gửi comment thành công. Hệ thống đã ghi nhận KPI.");
        }
        loadPosts();
      } else if (action === "BULK_COMMENT_STARTED") {
        setIsRunning(true);
        setRunProgress("Đang mở bài viết...");
        lastResultRef.current = null;
      } else if (action === "BULK_COMMENT_PROGRESS") {
        setRunProgress(event.data.payload?.status || null);
        if (event.data.payload?.result) lastResultRef.current = event.data.payload.result;
      } else if (action === "BULK_COMMENT_DONE") {
        setIsRunning(false);
        setRunProgress(null);
        setModalPost(null);
        setCommentText("");
        setBulkCommentText("");
        setSelectMode(false);
        setSelectedIds(new Set());
        if (lastResultRef.current && lastResultRef.current.success === false) {
          showToast(`Comment thất bại: ${lastResultRef.current.error || "Lỗi không xác định"}`);
        } else {
          showToast("Đã gửi comment thành công. Hệ thống đã ghi nhận KPI.");
        }
        loadPosts();
      }
    };

    window.addEventListener("message", handleMessage);
    const interval = window.setInterval(() => {
      if (!isExtensionReady) window.postMessage({ action: "PING_COMMENT_EXTENSION" }, "*");
      if (!isLiExtensionReady) window.postMessage({ action: "PING_LI_EXTENSION" }, "*");
    }, 1000);

    return () => {
      window.removeEventListener("message", handleMessage);
      window.clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isExtensionReady, isLiExtensionReady]);

  const PAGE_SIZE = 10;
  const [currentPage, setCurrentPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(filteredPosts.length / PAGE_SIZE));

  useEffect(() => {
    setCurrentPage(1);
  }, [tab, search, sourceTab, mainTab]);

  const pagedPosts = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredPosts.slice(start, start + PAGE_SIZE);
  }, [filteredPosts, currentPage]);

  const openModal = (post: InternalEngagementPost) => {
    setModalPost(post);
    setCommentText("");
  };

  const closeModal = () => {
    if (isRunning) return;
    setModalPost(null);
  };

  const buildVerifyConfig = () => ({
    apiBase: API_BASE_URL,
    email_member: user?.email,
    id_social_account: selectedAccountId || undefined,
    id_platform: 1,
    mode: "internal_engagement" as const,
  });

  const sendComment = () => {
    // Truoc day chi check modalPost?.permalink_url va return IM LANG (khong
    // toast) neu thieu - trong khi disabled-check cua nut va "Xem bai viet
    // goc" deu da fallback ca link_post. Vai bai (dac biet bai them qua tab
    // "Seeding ben ngoai"/custom-post cu) co the chi co link_post ma khong co
    // permalink_url -> nut trong VAN sang/khong disabled (dung fallback o
    // disabled-check) nhung bam vao roi vao day thi return im lang - dung y
    // trieu chung "bam khong ra gi ca". Dong bo lai fallback + luon bao ro
    // bang toast thay vi im lang.
    const rawPostLink = modalPost?.permalink_url || (modalPost as any)?.link_post || (modalPost as any)?.link;
    if (!rawPostLink) return showToast("Không tìm thấy link bài viết để gửi comment.");
    if (!commentText.trim()) return showToast("Vui lòng nhập nội dung comment.");
    if (!user?.email) {
      return showToast("Chưa xác định được tài khoản đăng nhập — tải lại trang trước khi comment (nếu không KPI sẽ không được ghi nhận).");
    }

    const isLinkedIn = modalPost!.platform === "linkedin" || isLinkedInUrl(rawPostLink);
    const isReady = isLinkedIn ? (isLiExtensionReady || isExtensionReady) : isExtensionReady;
    if (!isReady) return showToast("Chưa kết nối được Extension. Vui lòng cài đặt và tải lại trang.");

    const targetLink = isLinkedIn ? sanitizeLinkedInUrl(rawPostLink) : rawPostLink;

    window.postMessage(
      {
        action: "START_BULK_COMMENT",
        payload: {
          url: targetLink,
          content: commentText.trim(),
          text: commentText.trim(),
          posts: [
            {
              url: targetLink,
              fanpage_id: (modalPost as any).fanpage_id,
              fanpage_name: (modalPost as any).fanpage_name,
            },
          ],
          verifyConfig: {
            ...buildVerifyConfig(),
            id_platform: isLinkedIn
              ? 3
              : (modalPost as any).platform === "youtube"
                ? 2
                : (modalPost as any).platform === "threads"
                  ? 4
                  : 1,
          },
        },
      },
      "*",
    );
  };

  const toggleSelected = (postId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(postId)) next.delete(postId);
      else next.add(postId);
      return next;
    });
  };

  const selectedPosts = useMemo(
    () => filteredPosts.filter((p) => selectedIds.has(p.id) && p.permalink_url),
    [filteredPosts, selectedIds],
  );

  const runBulkComment = () => {
    if (selectedPosts.length === 0) return showToast("Chưa chọn bài viết nào.");
    if (!bulkCommentText.trim()) return showToast("Vui lòng nhập nội dung comment.");
    if (!isExtensionReady) return showToast("Chưa kết nối được Extension. Vui lòng cài đặt và tải lại trang.");
    if (!user?.email) {
      return showToast("Chưa xác định được tài khoản đăng nhập — tải lại trang trước khi comment (nếu không KPI sẽ không được ghi nhận).");
    }

    window.postMessage(
      {
        action: "START_BULK_COMMENT",
        payload: {
          posts: selectedPosts.map((p) => ({
            url: p.permalink_url,
            id_post: p.facebook_post_id,
            fanpage_id: p.fanpage_id,
            fanpage_name: p.fanpage_name,
          })),
          text: bulkCommentText,
          verifyConfig: buildVerifyConfig(),
        },
      },
      "*",
    );
  };

  const activeLeaderboard = useMemo(() => {
    // Keep all valid company members (only filter out unassigned/null entries)
    const filtered = leaderboard.filter((item: any) => {
      const teamName = String(item.team_name || item.team || "").toLowerCase().trim();
      if (!teamName || teamName === "null" || teamName.includes("chưa phân team")) {
        return false;
      }
      return true;
    });

    // Sort by completion rate (%) desc, then total completed desc
    return filtered.sort((a: any, b: any) => {
      if (b.completion_rate !== a.completion_rate) {
        return b.completion_rate - a.completion_rate;
      }
      return b.total_completed - a.total_completed;
    });
  }, [leaderboard]);

  const leaderboardTotalPages = Math.ceil(activeLeaderboard.length / LEADERBOARD_PAGE_SIZE);
  const paginatedLeaderboard = activeLeaderboard.slice(
    (leaderboardCurrentPage - 1) * LEADERBOARD_PAGE_SIZE,
    leaderboardCurrentPage * LEADERBOARD_PAGE_SIZE
  );

  return (
    <div className="w-full bg-[#f7f8fb] text-[#252733]">
      <div className="min-h-screen">
        {/* HEADER/HERO */}
        <div className="sticky top-0 z-10 bg-white border-b border-[#e7e9ef] h-14.5 flex items-center justify-between px-6">
          <div className="font-black text-[17px]">Tương tác nội bộ</div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="border border-[#e7e9ef] bg-white rounded-xl p-2 cursor-pointer hover:bg-gray-50 transition"
              aria-label="refresh"
              onClick={() => loadPosts()}
            >
              🔄
            </button>
          </div>
        </div>

        <div className="max-w-425 mx-auto p-5">
          <div className="flex justify-between gap-4.5 items-center mb-6">
            <div>
              <h1 className="text-[24px] m-0 mb-[4px] font-extrabold text-[#0f172a]">Hiệu quả seeding nội bộ</h1>
              <p className="m-0 text-[#64748b] text-[14px]">
                Theo dõi thành viên đã nhận bài, đã tương tác, làm thiếu và quá hạn.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <a
                href="/all-platform/quick-comments"
                className="px-4 py-2.5 border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded-xl text-[13px] font-bold shadow-sm transition flex items-center gap-2"
              >
                <span>📚</span> Thư viện mẫu câu
              </a>
              <button
                type="button"
                onClick={() => setIsCampaignModalOpen(true)}
                className="px-4 py-2.5 border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 rounded-xl text-[13px] font-bold shadow-sm transition flex items-center gap-2"
              >
                <span>🚩</span> Tạo chiến dịch seeding
              </button>
              <button
                type="button"
                onClick={openCreateTaskModal}
                className="px-4 py-2.5 bg-[#be123c] hover:bg-[#9f1239] text-white rounded-xl text-[13px] font-bold shadow-sm transition flex items-center gap-2 cursor-pointer"
              >
                <span className="text-base font-bold">+</span> Thêm bài viết Seeding
              </button>
            </div>
          </div>

          {loadError ? (
            <div className="bg-destructive-foreground border border-[#fecdd3] text-[#be123c] rounded-xl p-3 text-[13px] mb-4">
              {loadError}
            </div>
          ) : null}

          {/* MAIN TABS SWITCHER - thứ tự: Seeding nội bộ -> Seeding bên ngoài -> Tổng quan báo cáo */}
          <div className="flex items-center gap-2 border-b border-gray-200 mb-6 bg-white p-2.5 rounded-2xl shadow-xs">
            <button
              type="button"
              onClick={() => setMainTab("feed")}
              className={`px-5 py-2.5 text-xs font-extrabold rounded-xl transition cursor-pointer flex items-center gap-2 ${
                mainTab === "feed"
                  ? "bg-[#be123c] text-white shadow-sm"
                  : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
              }`}
            >
              <span>⚡</span> Seeding nội bộ
            </button>
            <button
              type="button"
              onClick={() => setMainTab("external")}
              className={`px-5 py-2.5 text-xs font-extrabold rounded-xl transition cursor-pointer flex items-center gap-2 ${
                mainTab === "external"
                  ? "bg-[#be123c] text-white shadow-sm"
                  : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
              }`}
            >
              <span>🌐</span> Seeding bên ngoài
            </button>
            <button
              type="button"
              onClick={() => setMainTab("overview")}
              className={`px-5 py-2.5 text-xs font-extrabold rounded-xl transition cursor-pointer flex items-center gap-2 ${
                mainTab === "overview"
                  ? "bg-[#be123c] text-white shadow-sm"
                  : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
              }`}
            >
              <span>📊</span> Tổng quan báo cáo
            </button>
          </div>

          {/* TAB 1: TỔNG QUAN BÁO CÁO */}
          {mainTab === "overview" ? (
            <div className="space-y-6">
              {/* 5 Stats Cards tính toán dữ liệu thật từ DB */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3.5">
                <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
                  <span className="text-xs font-semibold text-gray-500 block">Tổng Seeder</span>
                  <div className="text-2xl font-black text-gray-900 mt-1">{realStats.totalSeeder}</div>
                  <span className="text-[11px] text-gray-400 font-medium">Thành viên đang hoạt động</span>
                </div>
                <div className="border border-rose-100 rounded-2xl p-4 bg-rose-50/20 shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
                  <span className="text-xs font-semibold text-rose-600 block">Bài viết đang chạy</span>
                  <div className="text-2xl font-black text-rose-950 mt-1">{realStats.activePosts}</div>
                  <span className="text-[11px] text-rose-500 font-medium">Bài viết Seeding hiện tại</span>
                </div>
                <div className="border border-emerald-100 rounded-2xl p-4 bg-emerald-50/20 shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
                  <span className="text-xs font-semibold text-emerald-600 block">Tiến độ KPI Comment</span>
                  <div className="text-2xl font-black text-emerald-950 mt-1">
                    {realStats.totalCompletedComments} / {realStats.totalTargetComments}
                  </div>
                  <span className="text-[11px] text-emerald-500 font-medium">
                    {Math.round((realStats.totalCompletedComments / Math.max(1, realStats.totalTargetComments)) * 100)}% mục tiêu
                  </span>
                </div>
                <div className="border border-amber-100 rounded-2xl p-4 bg-amber-50/20 shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
                  <span className="text-xs font-semibold text-amber-600 block">Seeder đã tham gia</span>
                  <div className="text-2xl font-black text-amber-950 mt-1">{realStats.activeUniqueMembers}</div>
                  <span className="text-[11px] text-amber-500 font-medium">
                    {Math.round((realStats.activeUniqueMembers / Math.max(1, realStats.totalSeeder)) * 100)}% tổng Seeder
                  </span>
                </div>
                <div className="border border-blue-200 rounded-2xl p-4 bg-blue-50/30 shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
                  <span className="text-xs font-semibold text-blue-600 block">Hoàn thành 100%</span>
                  <div className="text-2xl font-black text-blue-950 mt-1">{realStats.perfectMembers}</div>
                  <span className="text-[11px] text-blue-500 font-medium">Đã xong tất cả bài được giao</span>
                </div>
              </div>

              {/* DANH SÁCH CHIẾN DỊCH SEEDING ĐANG DIỄN RA */}
              {campaigns.length > 0 ? (
                <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-bold text-gray-700 uppercase tracking-wider flex items-center gap-1.5">
                      <span>🚩</span> Chiến dịch Seeding đang diễn ra ({campaigns.length})
                    </span>
                    {selectedCampaignId !== "all" ? (
                      <button
                        type="button"
                        onClick={() => setSelectedCampaignId("all")}
                        className="text-xs text-rose-600 hover:underline font-semibold cursor-pointer"
                      >
                        Xem tất cả bài viết
                      </button>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2.5 overflow-x-auto pb-1">
                    <button
                      type="button"
                      onClick={() => setSelectedCampaignId("all")}
                      className={`px-3.5 py-2 rounded-xl text-xs font-bold transition shrink-0 border cursor-pointer ${selectedCampaignId === "all"
                        ? "bg-gray-900 text-white border-gray-900 shadow-sm"
                        : "bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100"
                        }`}
                    >
                      Tất cả chiến dịch
                    </button>
                    {campaigns.map((camp) => {
                      const isSelected = selectedCampaignId === camp.id;
                      const color = camp.color_code || "#fff1f2";
                      return (
                        <div
                          key={camp.id}
                          style={{ backgroundColor: isSelected ? undefined : color }}
                          className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition shrink-0 border flex items-center gap-2 ${isSelected
                            ? "bg-[#be123c] text-white border-[#be123c] shadow-sm"
                            : "text-gray-800 border-gray-200 hover:shadow-sm"
                            }`}
                        >
                          <button
                            type="button"
                            onClick={() => setSelectedCampaignId(isSelected ? "all" : camp.id)}
                            className="flex items-center gap-2 text-left outline-none cursor-pointer"
                          >
                            <span className="w-2.5 h-2.5 rounded-full bg-rose-500 shrink-0" />
                            <span>{camp.name}</span>
                            {camp.start_date ? (
                              <span className="text-[10px] opacity-75 font-normal">
                                ({new Date(camp.start_date).toLocaleDateString("vi-VN")}
                                {camp.end_date ? ` - ${new Date(camp.end_date).toLocaleDateString("vi-VN")}` : ""})
                              </span>
                            ) : null}
                          </button>

                          {/* Nút Xóa Chiến Dịch dành cho Admin / Leader */}
                          {canManagePost ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteCampaignClick(camp.id, camp.name);
                              }}
                              className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] transition cursor-pointer ${isSelected
                                ? "bg-white/20 hover:bg-white/40 text-white"
                                : "bg-red-100/80 hover:bg-red-200 text-red-700"
                                }`}
                              title="Xóa chiến dịch này"
                            >
                              🗑️
                            </button>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {/* Gamification Leaderboard Component */}
              <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
                    <span>🏆</span> Xếp hạng Seeder nổi bật
                  </h2>
                  <button onClick={() => { setIsLeaderboardModalOpen(true); setLeaderboardCurrentPage(1); }} className="text-xs text-[#be123c] hover:underline font-semibold cursor-pointer">
                    Xem tất cả →
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                        <th className="pb-3 pl-2">Hạng</th>
                        <th className="pb-3">Thành viên</th>
                        <th className="pb-3 text-center">Được giao</th>
                        <th className="pb-3 text-center">Hoàn thành</th>
                        <th className="pb-3 text-center">Đúng hạn</th>
                        <th className="pb-3 text-center">Tỷ lệ</th>
                        <th className="pb-3 text-right pr-2">Điểm</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {activeLeaderboard.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="py-6 text-center text-gray-400 text-xs">
                            Đang cập nhật dữ liệu bảng xếp hạng...
                          </td>
                        </tr>
                      ) : (
                        activeLeaderboard.slice(0, 5).map((item, idx) => {
                          const rank = idx + 1;
                          const badgeBg = rank === 1 ? "bg-amber-100 text-amber-800 border-amber-300" : rank === 2 ? "bg-slate-100 text-slate-700 border-slate-300" : rank === 3 ? "bg-orange-100 text-orange-800 border-orange-300" : "bg-gray-50 text-gray-600 border-gray-200";
                          const rankIcon = rank === 1 ? "🥇 1" : rank === 2 ? "🥈 2" : rank === 3 ? "🥉 3" : rank;
                          return (
                            <tr key={item.user_id || idx} className="hover:bg-gray-50/60 transition-colors">
                              <td className="py-3.5 pl-2">
                                <span className={`inline-flex items-center justify-center px-2.5 py-1 rounded-full text-xs font-bold border ${badgeBg}`}>
                                  {rankIcon}
                                </span>
                              </td>
                              <td className="py-3.5">
                                <div className="font-bold text-gray-900">{item.member_name}</div>
                                <div className="text-xs text-gray-400 font-normal">{item.team_name}</div>
                              </td>
                              <td className="py-3.5 text-center text-gray-700 font-medium">{item.total_assigned}</td>
                              <td className="py-3.5 text-center text-emerald-600 font-bold">{item.total_completed}</td>
                              <td className="py-3.5 text-center text-blue-600 font-medium">{item.total_ontime}</td>
                              <td className="py-3.5 text-center text-gray-700 font-medium">{item.completion_rate}%</td>
                              <td className="py-3.5 text-right pr-2 font-black text-emerald-600 text-base">{item.score}</td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {canSeeTeamInteractions ? <TeamPerformancePanel email={user?.email} /> : null}
            </div>
          ) : (
            /* TAB 2: HOẠT ĐỘNG SEEDING (POST FEED) */
            <div>

          {/* Bulk action bar */}
          {selectMode ? (
            <div className="bg-white border border-[#efb2c3] rounded-2xl p-4 mb-4 shadow-[0_1px_3px_rgba(20,25,40,.08)]">
              <div className="flex items-center justify-between mb-3">
                <div className="text-[13px] font-bold">
                  Đã chọn {selectedIds.size} bài viết
                </div>
                <div
                  className={`text-[12px] px-2 py-1 rounded-lg ${isExtensionReady ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"
                    }`}
                >
                  {isExtensionReady ? "Extension sẵn sàng" : "Chưa kết nối Extension"}
                </div>
              </div>

              <label className="text-[12px] font-extrabold block mb-2">Comment hàng loạt:</label>
              <textarea
                value={bulkCommentText}
                onChange={(e) => setBulkCommentText(e.target.value)}
                disabled={isRunning}
                className="w-full border border-[#dde0e7] rounded-xl px-3 py-2 outline-none min-h-20 resize-y"
                placeholder="Nội dung comment áp dụng cho tất cả bài đã chọn..."
              />
              <button
                type="button"
                className="mt-2 px-3.5 py-[8px] rounded-xl bg-[#c71f4d] text-white text-[12px] font-bold disabled:opacity-50"
                onClick={runBulkComment}
                disabled={isRunning || selectedIds.size === 0 || !isExtensionReady}
              >
                Comment hàng loạt cho {selectedIds.size} bài
              </button>

              {runProgress ? <div className="mt-3 text-[12px] text-[#c71f4d] font-semibold">{runProgress}</div> : null}
            </div>
          ) : null}

          {/* Main list */}
          <div className="bg-white border border-[#e7e9ef] rounded-2xl shadow-[0_1px_3px_rgba(20,25,40,.08),0_8px_24px_rgba(20,25,40,.04)] overflow-hidden">
            {/* VÙNG BỘ LỌC TOP BAR MỚI (CHUẨN THEO THIẾT KẾ REQUIREMENT 2) */}
            <div className="p-4 border-b border-[#e7e9ef] bg-white flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              {/* BÊN TRÁI: NHÓM NÚT LỌC TRẠNG THÁI */}
              <div className="flex items-center gap-1.5 flex-wrap">
                {[
                  { key: "all", label: "Tất cả bài" },
                  { key: "need", label: "Đang thực hiện" },
                  { key: "completed", label: "Đã hoàn thành" },
                  { key: "overdue", label: "Quá hạn" },
                ].map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    className={`px-3.5 py-2 rounded-xl text-xs font-bold transition border ${tab === t.key
                      ? "bg-[#be123c] text-white border-[#be123c] shadow-xs"
                      : "bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100"
                      }`}
                    onClick={() => setTab(t.key as any)}
                  >
                    {t.label} ({tabCounts[t.key as keyof typeof tabCounts] || 0})
                  </button>
                ))}
              </div>

              {/* BÊN PHẢI: SEARCH + DROP-DOWN TEAM + DROP-DOWN CHIẾN DỊCH NẰM CẠNH NHAU */}
              <div className="flex items-center gap-2.5 flex-wrap lg:flex-nowrap">
                {/* Ô Search */}
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="border border-gray-200 rounded-xl px-3.5 py-2 bg-gray-50 text-xs text-gray-800 outline-none focus:bg-white focus:border-rose-500 min-w-50 flex-1 transition"
                  placeholder="🔎 Tìm nội dung, fanpage..."
                />

                {/* Dropdown Lọc theo Team */}
                <select
                  value={selectedTeamFilter}
                  onChange={(e) => setSelectedTeamFilter(e.target.value)}
                  className="border border-gray-200 rounded-xl px-3 py-2 text-xs font-semibold text-gray-700 bg-white outline-none focus:border-rose-500 cursor-pointer"
                >
                  <option value="all">Tất cả Team</option>
                  {dbTeams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name_team} ({t.member_count})
                    </option>
                  ))}
                </select>

                {/* Dropdown Lọc theo Chiến dịch */}
                <select
                  value={selectedCampaignId}
                  onChange={(e) => setSelectedCampaignId(e.target.value)}
                  className="border border-gray-200 rounded-xl px-3 py-2 text-xs font-semibold text-gray-700 bg-white outline-none focus:border-rose-500 cursor-pointer"
                >
                  <option value="all">Tất cả Chiến dịch</option>
                  {campaigns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="p-3">
              {isLoading ? (
                <div className="p-12 text-center text-[#737785] text-sm flex flex-col items-center justify-center gap-2">
                  <div className="w-6 h-6 border-2 border-rose-600 border-t-transparent rounded-full animate-spin" />
                  <span>Đang tải danh sách bài viết...</span>
                </div>
              ) : filteredPosts.length === 0 ? (
                /* FIX CSS EMPTY STATE TRÊN 1 DÒNG NGHANG THUẦN CHUẨN REQUIREMENT 2 */
                <div className="w-full p-12 text-center text-[#64748b] text-sm bg-gray-50/50 rounded-xl my-2 border border-dashed border-gray-200 flex flex-col items-center justify-center gap-2">
                  <span className="text-3xl block text-center">📭</span>
                  <span className="font-bold text-gray-800 block text-center w-full whitespace-nowrap">
                    Không có bài viết nào trong mục này
                  </span>
                  <span className="text-xs text-gray-500 w-full block text-center">
                    Chưa có bài viết nào khớp với bộ lọc tìm kiếm hiện tại.
                  </span>
                </div>
              ) : (
                pagedPosts.map((post) => {
                  const status = marks[post.permalink_url || ""] || "need";
                  const isSelected = selectedIds.has(post.id);

                  // BẮT CẢ SNAKE LẪN CAMEL CASE
                  const postCampId = (post as any).campaign_id || (post as any).campaignId;
                  const matchedCamp = campaigns.find((c) => c.id === postCampId);
                  const campaignName = matchedCamp?.name || (post as any).campaign_name || (post as any).campaignName || null;
                  const campaignColor = matchedCamp?.color_code || (matchedCamp as any)?.colorCode || "#fff1f2";
                  const rawTarget = (post as any).target_comments || (post as any).targetComments;
                  const rawDeadline = (post as any).deadline || (post as any).due_date || (post as any).dueDate;

                  // TÍNH TOÁN DATA THẬT
                  const postTeamStats = teamCounts[post.id] || [];

                  // Strict Summary Card Scoping: Filter by assigned teams only
                  const assignedTeams: string[] = (post as any).assigned_team_ids || [];
                  let targetTotal = 0;
                  if (assignedTeams.length === 0) {
                    targetTotal = Number(rawTarget) > 0 ? Number(rawTarget) : (membersCount > 0 ? membersCount : 32);
                  } else {
                    targetTotal = dbTeams
                      .filter((t) => assignedTeams.includes(t.id) || assignedTeams.includes(t.name_team))
                      .reduce((sum, t) => sum + (t.member_count || 0), 0);
                    if (targetTotal === 0) {
                      targetTotal = Number(rawTarget) > 0 ? Number(rawTarget) : 32;
                    }
                  }

                  const interactedCount = postTeamStats
                    .filter((t) => assignedTeams.length === 0 || assignedTeams.includes(t.team_id) || assignedTeams.includes(t.team_name))
                    .reduce((sum, t) => sum + (t.count || 0), 0);

                  const progressPercent = Math.min(100, Math.round((interactedCount / Math.max(1, targetTotal)) * 100));
                  const pendingCount = Math.max(0, targetTotal - interactedCount);

                  const commentActual = interactedCount;
                  const completedCount = interactedCount;

                  // Bug 2 Fix: isCompleted only based on actual member count reaching target.
                  // Do NOT use `status` from `marks` (that tracks the logged-in user's personal mark, not team KPI).
                  const isCompleted = targetTotal > 0 && interactedCount >= targetTotal;
                  const isOverdue = rawDeadline && new Date(rawDeadline) < new Date() && !isCompleted;

                  const postUrl = post.permalink_url || (post as any).link_post || (post as any).link || "";
                  const isLinkedInPost = post.platform === "linkedin" || Boolean(postUrl && (postUrl.includes('linkedin.com') || postUrl.includes('lnkd.in')));
                  const isFacebookPost = !isLinkedInPost && Boolean(postUrl && (postUrl.includes('facebook.com') || postUrl.includes('fb.watch') || postUrl.includes('fb.com')));

                  return (
                    <article
                      key={post.id}
                      className={`border rounded-2xl mb-4 bg-white transition relative flex flex-col md:flex-row overflow-hidden ${isSelected ? "border-[#c71f4d] bg-[#fff8f9] shadow-md" : "border-[#e7e9ef] hover:border-rose-200 shadow-xs"
                        }`}
                    >
                      {/* DẢI CAMPAIGN BÊN TRÁI (LEFT SIDEBAR) - STRETCH CẢ CARD */}
                      <div
                        style={{ backgroundColor: campaignName ? (campaignColor || '#eef3fb') : '#eef3fb' }}
                        className="w-full md:w-32 self-stretch p-4 flex items-center justify-center text-center shrink-0 border-b md:border-b-0 md:border-r border-gray-100 transition-colors"
                      >
                        <span className="font-extrabold text-[#1e40af] text-xs md:text-sm tracking-wider uppercase leading-tight">
                          {campaignName || "TỰ DO"}
                        </span>
                      </div>

                      {/* CHI TIẾT VÀ TIẾN ĐỘ BÊN PHẢI */}
                      <div className="flex-1 min-w-0 p-4 md:p-5 flex flex-col justify-between">
                        {/* Header Row */}
                        <div className="flex items-start justify-between gap-3 mb-2">
                          <div className="flex items-center gap-2.5">
                            {selectMode ? (
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleSelected(post.id)}
                                className="w-4 h-4 text-rose-600 rounded cursor-pointer"
                              />
                            ) : null}

                            {/* MULTI-PLATFORM SOCIAL ICON */}
                            {getPlatformIcon(post.permalink_url || (post as any).link_post || (post as any).link)}

                            <div>
                              <div className="font-bold text-sm text-gray-900">
                                {post.fanpage_name || (postUrl.toLowerCase().includes("youtube.com") || postUrl.toLowerCase().includes("youtu.be") ? "Kênh YouTube" : "Markee Agency")}
                              </div>
                              <div className="text-xs text-gray-400 font-medium">
                                {fmtRelativeTime(post.created_at)} · {fmtDeadline(rawDeadline)}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <span
                              className={`px-3 py-1 rounded-full text-xs font-bold ${isCompleted
                                  ? "bg-emerald-50 text-emerald-600 border border-emerald-200"
                                  : isOverdue
                                    ? "bg-red-50 text-red-600 border border-red-200"
                                    : "bg-amber-50 text-amber-700 border border-amber-200"
                                }`}
                            >
                              {isCompleted ? "Đã hoàn thành" : isOverdue ? "Quá hạn" : "Đang thực hiện"}
                            </span>

                            {/* Menu 3 chấm đứng cho Admin/Leader */}
                            {canManagePost ? (
                              <div className="relative">
                                <button
                                  type="button"
                                  onClick={() => setOpenMenuPostId(openMenuPostId === post.id ? null : post.id)}
                                  className="p-1 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition"
                                  title="Tùy chọn bài viết"
                                >
                                  ⋮
                                </button>

                                {openMenuPostId === post.id ? (
                                  <div className="absolute right-0 mt-1 w-44 bg-white border border-gray-200 rounded-xl shadow-lg z-20 py-1 text-xs">
                                    <button
                                      type="button"
                                      onClick={() => openEditModal(post)}
                                      className="w-full text-left px-3 py-2 hover:bg-gray-50 text-gray-700 flex items-center gap-2 font-medium"
                                    >
                                      ✏️ Sửa (Gia hạn / Target KPI)
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => openDeleteConfirmModal(post)}
                                      className="w-full text-left px-3 py-2 hover:bg-red-50 text-red-600 flex items-center gap-2 font-medium"
                                    >
                                      🗑️ Xóa bài viết
                                    </button>
                                  </div>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        </div>

                        {/* Post Excerpt */}
                        <div className="text-xs md:text-sm text-gray-800 font-medium mb-3.5 leading-relaxed">
                          📌 {post.content || "(Bài viết không có nội dung văn bản)"}
                        </div>

                        {/* KHỐI TƯƠNG TÁC BÀI GỐC (PUBLIC METRICS BOX) - Facebook hoặc LinkedIn */}
                        {isFacebookPost || isLinkedInPost ? (
                          <div className="mb-3.5 p-3 border border-dashed border-gray-200 rounded-2xl bg-white flex flex-wrap sm:flex-nowrap items-center justify-between gap-2.5 text-xs">
                            {/* Thông số bên trái */}
                            <div className="flex items-center gap-2.5 flex-wrap sm:flex-nowrap text-gray-700">
                              <div className="flex items-center gap-1.5 shrink-0">
                                <span className="w-2 h-2 rounded-full bg-rose-500 inline-block animate-pulse"></span>
                                <span className="font-extrabold text-[11px] text-gray-600 uppercase tracking-wider">
                                  TƯƠNG TÁC BÀI GỐC
                                </span>
                              </div>

                              <div className="hidden sm:block h-3.5 w-px bg-gray-200" />

                              {/* Metrics Row */}
                              <div className="flex items-center gap-2.5 text-xs text-gray-500">
                                {/* Like */}
                                <div className="flex items-center gap-1">
                                  <svg className="w-3.5 h-3.5 text-gray-400 stroke-[1.5]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
                                  </svg>
                                  <span className="font-bold text-gray-900">{formatCompactNumber((post as any).public_likes ?? (post as any).fb_total_likes ?? (post as any).likes ?? 0)}</span>
                                  <span className="text-gray-400 text-[11px]">like</span>
                                </div>

                                <span className="text-gray-300">|</span>

                                {/* Comment */}
                                <div className="flex items-center gap-1">
                                  <svg className="w-3.5 h-3.5 text-gray-400 stroke-[1.5]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 20.25c4.97 0 9-3.694 9-8.25s-4.03-8.25-9-8.25S3 7.444 3 12c0 2.104.859 4.023 2.273 5.48.432.447.74 1.04.586 1.641a4.483 4.483 0 0 1-.923 1.785A5.969 5.969 0 0 0 6 21c1.282 0 2.47-.402 3.445-1.087.51-.358 1.155-.41 1.705-.224A8.948 8.948 0 0 0 12 20.25z" />
                                  </svg>
                                  <span className="font-bold text-gray-900">{formatCompactNumber((post as any).public_comments ?? (post as any).fb_total_comments ?? (post as any).comments_count ?? 0)}</span>
                                  <span className="text-gray-400 text-[11px]">bình luận</span>
                                </div>

                                <span className="text-gray-300">|</span>

                                {/* Share */}
                                <div className="flex items-center gap-1">
                                  <svg className="w-3.5 h-3.5 text-gray-400 stroke-[1.5]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 8.25H7.5a2.25 2.25 0 0 0-2.25 2.25v9a2.25 2.25 0 0 0 2.25 2.25h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25H15m0-3-3-3m0 0-3 3m3-3V15" />
                                  </svg>
                                  <span className="font-bold text-gray-900">{formatCompactNumber((post as any).public_shares ?? (post as any).fb_total_shares ?? (post as any).shares_count ?? 0)}</span>
                                  <span className="text-gray-400 text-[11px]">chia sẻ</span>
                                </div>
                              </div>
                            </div>

                            {/* Bên phải: Thời gian & Nút Đồng bộ */}
                            <div className="flex items-center gap-2 shrink-0 ml-auto sm:ml-0">
                              <span className="text-gray-400 text-[11px]">Cập nhật {fmtRelativeTime((post as any).synced_at ?? (post as any).last_synced_at ?? (post as any).updated_at ?? post.created_at)}</span>
                              <button
                                type="button"
                                onClick={() => (isLinkedInPost ? handleSyncLinkedInMetrics(post) : handleSyncPostMetrics(post))}
                                disabled={syncingPostId === post.id}
                                className="flex items-center gap-1 px-3 py-1 border border-gray-300 rounded-full text-xs font-semibold text-gray-700 hover:bg-gray-50 transition bg-white shadow-2xs cursor-pointer"
                              >
                                <span className={syncingPostId === post.id ? "animate-spin inline-block" : ""}>🔄</span>
                                <span>{syncingPostId === post.id ? "Đang đồng bộ..." : "Đồng bộ"}</span>
                              </button>
                            </div>
                          </div>
                        ) : null}

                        {/* Progress Bar */}
                        <div className="mb-3.5">
                          <div className="flex justify-between text-xs font-bold mb-1.5">
                            <span className="text-gray-700">{interactedCount}/{targetTotal} thành viên đã tương tác</span>
                            <span className="text-[#BE123C]">{progressPercent}%</span>
                          </div>
                          <div className="w-full bg-gray-100 h-2 rounded-full overflow-hidden">
                            <div style={{ width: `${progressPercent}%` }} className="bg-[#BE123C] h-full rounded-full transition-all duration-300" />
                          </div>
                        </div>

                        {/* 3 KPI SUB-BOXES GRID (ĐÃ ĐỔI THÀNH "ĐÃ TƯƠNG TÁC") */}
                        <div className="grid grid-cols-3 gap-2.5 mb-4">
                          <div className="bg-[#f8fafc] p-3 rounded-xl border border-gray-100">
                            <span className="text-[11px] text-gray-500 font-semibold block mb-1">Đã tương tác</span>
                            <span className="text-sm md:text-base font-bold text-gray-900">{interactedCount}/{targetTotal}</span>
                          </div>
                          <div className="bg-[#f8fafc] p-3 rounded-xl border border-gray-100">
                            <span className="text-[11px] text-emerald-600 font-semibold block mb-1">✓ Hoàn thành</span>
                            <span className="text-sm md:text-base font-bold text-emerald-600">{completedCount}</span>
                          </div>
                          <div className="bg-[#f8fafc] p-3 rounded-xl border border-gray-100">
                            <span className="text-[11px] text-amber-600 font-semibold block mb-1">⏱ Chưa làm</span>
                            <span className="text-sm md:text-base font-bold text-amber-600">{pendingCount}</span>
                          </div>
                        </div>

                        {/* BỐ CỤC FOOTER ACTION BUTTONS */}
                        <div className="flex items-center justify-between gap-3 pt-2.5 border-t border-gray-100 flex-wrap">
                          <button
                            type="button"
                            onClick={() => openInteractionsModal(post)}
                            className="text-xs font-bold text-[#be123c] hover:underline text-left flex items-center gap-1"
                          >
                            Xem tương tác thành viên →
                          </button>

                          <div className="flex items-center justify-end gap-2">
                            {/* Nút theo nền tảng: Facebook (Làm Nhiệm Vụ ↗ + Copy Mẫu câu) vs Nền tảng khác (Xem bài viết gốc ↗) */}
                            {((post.platform || "").toLowerCase() === "facebook" || (post.platform || "").toLowerCase() === "fb") ? (
                              <div className="relative group inline-block">
                                <button
                                  type="button"
                                  onClick={() => handleDoTask(post)}
                                  className="px-3.5 py-2 bg-rose-50 hover:bg-rose-100 text-[#be123c] border border-rose-200 rounded-full text-xs font-bold transition flex items-center gap-1 cursor-pointer shadow-2xs"
                                >
                                  ⚡ Làm Nhiệm Vụ ↗
                                </button>
                                <div className="absolute bottom-full right-0 mb-1.5 hidden group-hover:block w-max z-10 pointer-events-none">
                                  <div className="bg-gray-900 text-white text-[11px] font-medium rounded-lg py-1 px-2.5 shadow-xl">
                                    Tự động copy mẫu câu &amp; mở bài viết để Like/Comment/Share để tương tác trên FB
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleOpenOriginalPost(post)}
                                className="px-3.5 py-2 bg-gray-50 hover:bg-gray-100 text-gray-700 border border-gray-200 rounded-full text-xs font-bold transition flex items-center gap-1 cursor-pointer shadow-2xs"
                              >
                                Xem bài viết gốc ↗
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => openModal(post)}
                              className="px-5 py-2 bg-[#BE123C] hover:bg-[#9F1239] text-white rounded-full text-xs font-bold shadow-sm transition cursor-pointer"
                            >
                              Comment ngay
                            </button>
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })
              )}
            </div>

            {filteredPosts.length > 0 ? (
              <div className="flex items-center justify-between px-4 py-3 border-t border-[#e7e9ef]">
                <div className="text-[12px] text-[#737785]">
                  Trang {currentPage}/{totalPages} — {filteredPosts.length} bài
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={currentPage <= 1}
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    className="px-3 py-1.5 rounded-lg border border-[#e7e9ef] bg-white text-[12px] font-semibold disabled:opacity-40"
                  >
                    ← Trước
                  </button>
                  <button
                    type="button"
                    disabled={currentPage >= totalPages}
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    className="px-3 py-1.5 rounded-lg border border-[#e7e9ef] bg-white text-[12px] font-semibold disabled:opacity-40"
                  >
                    Sau →
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}
        </div>

        {/* Comment modal */}
        {modalPost ? (
          <div
            className="fixed inset-0 bg-[rgba(25,27,35,.42)] flex items-center justify-center z-30 p-5"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) closeModal();
            }}
          >
            <div className="w-[min(700px,100%)] bg-white rounded-2xl shadow-[0_30px_80px_rgba(0,0,0,.25)] overflow-hidden">
              <div className="flex justify-between items-center p-4 border-b border-[#e7e9ef]">
                <div>
                  <b className="text-base">Comment vào bài viết</b>
                  <div className="text-[12px] text-[#777] mt-1">
                    {modalPost.platform === "linkedin" || isLinkedInUrl(modalPost.permalink_url || (modalPost as any).link_post || "")
                      ? "Thực hiện qua LinkedIn Extension trên tài khoản LinkedIn đang đăng nhập"
                      : modalPost.platform === "threads"
                        ? "Thực hiện qua Chrome Extension trên tài khoản Threads đang đăng nhập"
                        : "Thực hiện qua Chrome Extension trên tài khoản Facebook đang đăng nhập"}
                  </div>
                </div>
                <button type="button" className="border-0 bg-[#f2f3f6] rounded-lg px-2.5 py-1.75" onClick={closeModal} aria-label="close">✕</button>
              </div>

              <div className="p-5">
                {(() => {
                  // Nhieu bai LinkedIn tu do (khong gan chien dich) tung bi backend tra ve
                  // `platform` khac "linkedin" (null/facebook do du lieu cu hoac endpoint
                  // /custom-posts fallback sai) -> check strict truoc day khoa nham nut Gui
                  // vinh vien (nut disabled khong bao gio nhan click). Luon fallback theo URL
                  // giong het logic da dung o sendComment()/danh sach bai viet ben tren.
                  const modalIsLinkedIn = modalPost.platform === "linkedin" || isLinkedInUrl(modalPost.permalink_url || (modalPost as any).link_post || "");
                  // Gui comment that di qua comment-extension (isExtensionReady) - extension
                  // LinkedIn rieng (isLiExtensionReady) chi phuc vu cao metric, khong lien quan
                  // luong comment nay. Chap nhan 1 trong 2 de tranh khoa nham nut Gui khi
                  // comment-extension da san sang nhung nguoi dung chua cai extension kia.
                  const ready = modalIsLinkedIn ? (isLiExtensionReady || isExtensionReady) : isExtensionReady;
                  return (
                    <div
                      className={`p-3 rounded-xl border text-[12px] mb-4 flex items-center justify-between gap-2 ${ready ? "bg-green-50 border-green-200 text-green-700" : "bg-amber-50 border-amber-200 text-amber-700"
                        }`}
                    >
                      <span>
                        {ready
                          ? `Extension${modalIsLinkedIn ? " LinkedIn" : ""} đã sẵn sàng.`
                          : `Đang chờ kết nối ${modalIsLinkedIn ? "LinkedIn " : ""}Extension. Vui lòng cài đặt và F5 lại trang.`}
                      </span>
                      {!ready && modalIsLinkedIn ? (
                        <a
                          href="/comment-extension.zip"
                          download
                          className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-amber-300 bg-white hover:bg-amber-100 text-amber-800 text-[11px] font-bold whitespace-nowrap"
                        >
                          Tải Extension
                        </a>
                      ) : null}
                    </div>
                  );
                })()}

                <div className="text-[13px] text-[#5d616c] mb-3 line-clamp-3">{modalPost.content}</div>

                {socialAccounts.length > 0 && (modalPost.platform || "facebook") === "facebook" ? (
                  <div className="mb-3">
                    <label className="text-[12px] font-extrabold block mb-2">Tài khoản Facebook dùng để comment:</label>
                    <select
                      className="w-full border border-[#dde0e7] rounded-xl px-3 py-2"
                      value={selectedAccountId}
                      onChange={(e) => setSelectedAccountId(e.target.value)}
                      disabled={isRunning}
                    >
                      <option value="">-- Tự do (dùng acc đang đăng nhập FB) --</option>
                      {socialAccounts.map((acc) => (
                        <option key={acc.id} value={acc.id}>
                          {acc.account_name} {acc.account_email ? `(${acc.account_email})` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}

                <div className="flex items-center justify-between mb-2">
                  <label className="text-[12px] font-extrabold">Nội dung comment:</label>
                  <button
                    type="button"
                    onClick={() => setIsTemplatePickerOpen((v) => !v)}
                    disabled={isRunning}
                    className="text-[12px] font-semibold text-[#c71f4d] hover:underline"
                  >
                    Chọn mẫu câu
                  </button>
                </div>
                <div className="relative">
                  <textarea
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    disabled={isRunning}
                    className="w-full border border-[#dde0e7] rounded-xl px-3 py-2 outline-none min-h-27.5 resize-y"
                    placeholder="Nhập nội dung comment thật sẽ đăng lên bài viết này..."
                  />
                  {isTemplatePickerOpen ? (
                    <div className="absolute right-0 top-1 z-20 w-80 max-h-70 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
                      {commentTemplateGroups.length === 0 ? (
                        <div className="p-3 text-xs text-slate-500">Chưa có mẫu nào. Vào trang Quick Comment Library để thêm.</div>
                      ) : (
                        commentTemplateGroups.map((group) => (
                          <div key={group.label}>
                            <div className="px-3 py-1.5 text-[10px] font-bold text-slate-500 bg-slate-50/70">{group.label}</div>
                            {group.templates.map((template) => (
                              <button
                                key={template.id}
                                type="button"
                                className="w-full text-left px-3 py-2 hover:bg-red-50 border-b border-slate-100 last:border-0 transition"
                                onClick={() => {
                                  setCommentText(template.content);
                                  setIsTemplatePickerOpen(false);
                                }}
                              >
                                <div className="text-xs font-semibold text-slate-800">{template.title}</div>
                                <div className="text-[11px] text-slate-500 line-clamp-2">{template.content}</div>
                              </button>
                            ))}
                          </div>
                        ))
                      )}
                    </div>
                  ) : null}
                </div>

                {runProgress ? (
                  <div className="mt-3 text-[12px] text-[#c71f4d] font-semibold">{runProgress}</div>
                ) : null}
              </div>

              <div className="p-4 border-t border-[#e7e9ef] flex justify-end gap-2">
                <button type="button" className="border border-[#e7e9ef] bg-white rounded-xl px-4 py-2 font-extrabold" onClick={closeModal} disabled={isRunning}>
                  Để sau
                </button>
                <button
                  type="button"
                  className="bg-[#c71f4d] text-white border border-[#c71f4d] rounded-xl px-4 py-2 font-extrabold disabled:opacity-50"
                  onClick={sendComment}
                  disabled={
                    isRunning ||
                    !(
                      modalPost.platform === "linkedin" || isLinkedInUrl(modalPost.permalink_url || (modalPost as any).link_post || "")
                        ? isLiExtensionReady || isExtensionReady
                        : isExtensionReady
                    ) ||
                    !commentText.trim()
                  }
                >
                  {isRunning ? "Đang gửi..." : "Gửi comment qua Extension"}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {/* Modal Xem chi tiết tương tác thành viên (Matching Image 2) */}
        {interactionsPost ? (
          <div
            className="fixed inset-0 bg-[rgba(25,27,35,.42)] flex items-center justify-center z-30 p-5"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) closeInteractionsModal();
            }}
          >
            <div className="w-[min(720px,100%)] max-h-[85vh] bg-white rounded-2xl shadow-[0_30px_80px_rgba(0,0,0,.25)] overflow-hidden flex flex-col">
              <div className="flex justify-between items-center p-5 border-b border-gray-100">
                <div>
                  <h3 className="text-base font-bold text-gray-900">Chi tiết tương tác thành viên</h3>
                  <div className="text-xs text-gray-500 mt-0.5 line-clamp-1">Bài: {interactionsPost.content || "(Bài viết Facebook)"}</div>
                </div>
                <button
                  type="button"
                  className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-500 font-bold"
                  onClick={closeInteractionsModal}
                >
                  ✕
                </button>
              </div>

              {/* FILTER BAR ROW */}
              <div className="p-4 bg-gray-50/70 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <select
                    value={interactionsStatusFilter}
                    onChange={(e) => setInteractionsStatusFilter(e.target.value)}
                    className="border border-gray-200 rounded-xl px-3 py-1.5 text-xs font-semibold text-gray-700 bg-white outline-none focus:border-rose-500"
                  >
                    <option value="all">Tất cả trạng thái</option>
                    <option value="completed">Hoàn thành</option>
                    <option value="received">Đã nhận</option>
                    <option value="overdue">Quá hạn</option>
                    <option value="pending">Chưa làm</option>
                  </select>

                  <select
                    value={interactionsTeamFilter}
                    onChange={(e) => setInteractionsTeamFilter(e.target.value)}
                    className="border border-gray-200 rounded-xl px-3 py-1.5 text-xs font-semibold text-gray-700 bg-white outline-none focus:border-rose-500"
                  >
                    <option value="all">Tất cả team</option>
                    {dbTeams.length > 0
                      ? dbTeams.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name_team}
                        </option>
                      ))
                      : ["Sale", "Marketing", "Presale", "Operation"].map((t) => (
                        <option key={t} value={t.toLowerCase()}>
                          {t}
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              {/* TABLE HIỂN THỊ CHI TIẾT */}
              <div className="p-4 overflow-y-auto flex-1">
                {isLoadingInteractions ? (
                  <div className="p-12 text-center text-gray-500 text-xs">Đang tải chi tiết tương tác thành viên...</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-gray-100 text-gray-400 font-semibold">
                          <th className="pb-2.5">Thành viên</th>
                          <th className="pb-2.5">Team</th>
                          <th className="pb-2.5">Trạng thái</th>
                          <th className="pb-2.5 text-center">👍 Like</th>
                          <th className="pb-2.5 text-center">💬 Comment</th>
                          <th className="pb-2.5 text-center">↗️ Share</th>
                          <th className="pb-2.5 text-right">Thời gian</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50 text-gray-700 font-medium">
                        {(() => {
                          // 1. Thêm (as any[]) để TypeScript không bắt bẻ các trường mới từ Backend
                          const filteredRoster = (interactionsItems as any[]).filter((m) => {
                            // Lọc theo trạng thái
                            if (interactionsStatusFilter !== "all" && m.status !== interactionsStatusFilter) {
                              return false;
                            }
                            // Lọc theo Team
                            if (interactionsTeamFilter !== "all") {
                              const matchedTeamObj = dbTeams.find((t) => t.id === interactionsTeamFilter);
                              const targetTeamName = matchedTeamObj?.name_team || interactionsTeamFilter;
                              if ((m.team || "").toLowerCase() !== targetTeamName.toLowerCase()) {
                                return false;
                              }
                            }
                            return true;
                          });

                          // Bug 4 Fix: Sort mặc định — Hoàn thành lên trên (theo thời gian sớm nhất),
                          // Chưa hoàn thành xuống dưới.
                          const statusOrder: Record<string, number> = { completed: 0, failed: 1, received: 2, overdue: 3 };
                          filteredRoster.sort((a, b) => {
                            const aOrder = statusOrder[a.status] ?? 99;
                            const bOrder = statusOrder[b.status] ?? 99;
                            if (aOrder !== bOrder) return aOrder - bOrder;
                            // Trong cùng nhóm completed: sắp theo thời gian tăng dần (ai làm trước xếp trên)
                            if (a.status === "completed" && b.status === "completed") {
                              const aTime = a.raw_created_at ? new Date(a.raw_created_at).getTime() : Infinity;
                              const bTime = b.raw_created_at ? new Date(b.raw_created_at).getTime() : Infinity;
                              return aTime - bTime;
                            }
                            return 0;
                          });

                          // 2. RENDER GIAO DIỆN
                          if (filteredRoster.length === 0) {
                            return (
                              <tr>
                                <td colSpan={7} className="py-8 text-center text-gray-400 font-medium">
                                  Không tìm thấy thành viên nào khớp với bộ lọc.
                                </td>
                              </tr>
                            );
                          }

                          return filteredRoster.map((m, idx) => (
                            <tr key={m.id_member || idx} className="hover:bg-gray-50/80">
                              <td className="py-3 font-bold text-gray-900">{m.name}</td>
                              <td className="py-3 text-gray-500">
                                {dbTeams.find((t) => t.id === m.team_id || t.name_team.toLowerCase() === (m.team || "").toLowerCase())?.name_team || m.team || "Team"}
                              </td>
                              <td className="py-3">
                                <span
                                  className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                                    m.status === "completed"
                                      ? "bg-emerald-50 text-emerald-700"
                                      : m.status === "received"
                                        ? "bg-blue-50 text-blue-700"
                                        : "bg-red-50 text-red-700"
                                  }`}
                                >
                                  {m.statusLabel}
                                </span>
                              </td>
                              {/* 👍 Like */}
                              <td className="py-3 text-center">
                                {m.like
                                  ? <span
                                      style={{ color: "#10b981" }}
                                      className="font-bold text-sm cursor-default"
                                      title={m.like_time ? `Đã like lúc: ${formatMemberTime(m.like_time)}` : "Đã like"}
                                    >✓</span>
                                  : <span style={{ color: "#9ca3af" }}>—</span>}
                              </td>
                              {/* 💬 Comment */}
                              <td className="py-3 text-center">
                                {m.comment
                                  ? <span
                                      style={{ color: "#10b981" }}
                                      className="font-bold text-sm cursor-default"
                                      title={m.comment_time ? `Đã comment lúc: ${formatMemberTime(m.comment_time)}` : "Đã comment"}
                                    >✓</span>
                                  : <span style={{ color: "#9ca3af" }}>—</span>}
                              </td>
                              {/* ↗️ Share */}
                              <td className="py-3 text-center">
                                {m.share
                                  ? <span
                                      style={{ color: "#10b981" }}
                                      className="font-bold text-sm cursor-default"
                                      title={m.share_time ? `Đã share lúc: ${formatMemberTime(m.share_time)}` : "Đã share"}
                                    >✓</span>
                                  : <span style={{ color: "#9ca3af" }}>—</span>}
                              </td>
                              {/* Thời gian: lấy mốc gần nhất trong 3 hành động */}
                              <td className="py-3 text-right text-gray-500">
                                {(() => {
                                  const candidates = [m.like_time, m.comment_time, m.share_time, m.raw_created_at]
                                    .filter(Boolean)
                                    .map((t: string) => new Date(t).getTime())
                                    .filter((n: number) => !Number.isNaN(n));
                                  if (candidates.length === 0) return m.time || "—";
                                  const latestTs = Math.max(...candidates);
                                  return formatMemberTime(new Date(latestTs).toISOString(), m.time);
                                })()}
                              </td>
                            </tr>
                          ));
                        })()}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : null}

        {/* Modal Sửa Bài Viết & Target KPI */}
        {editingPost ? (
          <div
            className="fixed inset-0 bg-[rgba(25,27,35,.42)] flex items-center justify-center z-30 p-5"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setEditingPost(null);
            }}
          >
            <div className="w-[min(600px,100%)] bg-white rounded-2xl shadow-[0_30px_80px_rgba(0,0,0,.25)] overflow-hidden">
              <div className="flex justify-between items-center p-4 border-b border-[#e7e9ef]">
                <div>
                  <b className="text-base text-gray-900">Sửa bài viết & Gia hạn Target KPI</b>
                  <div className="text-[12px] text-gray-500 mt-0.5">
                    Cập nhật deadline, chiến dịch và chỉ tiêu tương tác cho bài viết.
                  </div>
                </div>
                <button
                  type="button"
                  className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-500 font-bold"
                  onClick={() => setEditingPost(null)}
                >
                  ✕
                </button>
              </div>

              <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-bold text-[#334155] block mb-1">
                      Chiến dịch Seeding:
                    </label>
                    <select
                      value={editCampaignId}
                      onChange={(e) => setEditCampaignId(e.target.value)}
                      className="w-full border border-[#dde0e7] rounded-xl px-3 py-2 text-xs outline-none focus:border-[#be123c]"
                    >
                      <option value="">-- Chọn chiến dịch --</option>
                      {campaigns.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-xs font-bold text-[#334155] block mb-1">
                      Gia hạn Hạn chót (Deadline):
                    </label>
                    <input
                      type="datetime-local"
                      value={editDeadline}
                      onChange={(e) => setEditDeadline(e.target.value)}
                      className="w-full border border-[#dde0e7] rounded-xl px-3 py-2 text-xs outline-none focus:border-[#be123c]"
                    />
                  </div>
                </div>

                {/* Phân công Teams thực hiện */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-bold text-[#334155] block">
                      Phân công Teams thực hiện:
                    </label>
                    <label className="flex items-center gap-1.5 text-xs font-bold cursor-pointer text-rose-600 hover:text-rose-700">
                      <input
                        type="checkbox"
                        checked={isAllEditTeamsSelected}
                        onChange={toggleSelectAllEditTeams}
                        className="w-4 h-4 text-rose-600 rounded cursor-pointer"
                      />
                      <span>{isAllEditTeamsSelected ? "Bỏ chọn tất cả" : "Chọn tất cả Teams"}</span>
                    </label>
                  </div>

                  <div className="flex items-center gap-2.5 flex-wrap pt-1">
                    {dbTeams.length > 0
                      ? dbTeams.map((team) => {
                        const isChecked = editAssignedTeams.includes(team.id) || editAssignedTeams.includes(team.name_team);
                        return (
                          <label
                            key={team.id}
                            className={`flex items-center gap-1.5 text-xs font-medium cursor-pointer border px-3 py-1.5 rounded-xl transition ${isChecked
                              ? "bg-rose-50 border-rose-200 text-rose-900 font-bold shadow-xs"
                              : "bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100"
                              }`}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => {
                                setEditAssignedTeams((prev) =>
                                  isChecked
                                    ? prev.filter((t) => t !== team.id && t !== team.name_team)
                                    : [...prev, team.id]
                                );
                              }}
                              className="w-4 h-4 text-rose-600 rounded"
                            />
                            <span>{team.name_team} ({team.member_count})</span>
                          </label>
                        );
                      })
                      : ["Sale", "Marketing", "Presale", "Operation"].map((team) => {
                        const isChecked = editAssignedTeams.includes(team);
                        return (
                          <label
                            key={team}
                            className={`flex items-center gap-1.5 text-xs font-medium cursor-pointer border px-3 py-1.5 rounded-xl transition ${isChecked
                              ? "bg-rose-50 border-rose-200 text-rose-900 font-bold shadow-xs"
                              : "bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100"
                              }`}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => {
                                setEditAssignedTeams((prev) =>
                                  isChecked ? prev.filter((t) => t !== team) : [...prev, team]
                                );
                              }}
                              className="w-4 h-4 text-rose-600 rounded"
                            />
                            <span>{team}</span>
                          </label>
                        );
                      })}
                  </div>
                </div>

                {/* Target KPI Section */}
                <div className="p-3.5 bg-rose-50/40 rounded-xl border border-rose-100">
                  <span className="text-xs font-bold text-rose-800 block mb-2">💬 Target KPI Comment Bài Viết:</span>
                  <div>
                    <label className="text-[11px] font-semibold text-gray-600 block mb-1">Target Comment (Mục tiêu số lượt Comment):</label>
                    <input
                      type="number"
                      value={editTargetComments}
                      onChange={(e) => setEditTargetComments(Number(e.target.value))}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none bg-white font-bold text-gray-900 focus:border-rose-500"
                    />
                  </div>
                </div>

              </div>

              <div className="p-4 border-t border-[#e7e9ef] flex justify-end gap-2 bg-gray-50">
                <button
                  type="button"
                  className="border border-[#e7e9ef] bg-white rounded-xl px-4 py-2 font-bold text-xs text-gray-700"
                  onClick={() => setEditingPost(null)}
                  disabled={isUpdatingPost}
                >
                  Hủy
                </button>
                <button
                  type="button"
                  className="bg-[#be123c] hover:bg-[#9f1239] text-white border border-[#be123c] rounded-xl px-4 py-2 font-bold text-xs disabled:opacity-50 transition shadow-sm"
                  onClick={handleSaveEdit}
                  disabled={isUpdatingPost}
                >
                  {isUpdatingPost ? "Đang lưu..." : "Lưu thay đổi"}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {/* Modal Cảnh Báo Xóa Bài Viết */}
        {deletingPost ? (
          <div
            className="fixed inset-0 bg-[rgba(25,27,35,.42)] flex items-center justify-center z-30 p-5"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setDeletingPost(null);
            }}
          >
            <div className="w-[min(450px,100%)] bg-white rounded-2xl shadow-[0_30px_80px_rgba(0,0,0,.25)] overflow-hidden">
              <div className="p-5 text-center">
                <div className="w-12 h-12 rounded-full bg-[#fef2f2] text-[#ef4444] mx-auto flex items-center justify-center text-xl mb-3">
                  ⚠️
                </div>
                <h3 className="text-base font-bold text-[#0f172a] mb-2">
                  Xác nhận xóa bài viết
                </h3>
                <p className="text-[13px] text-[#64748b] leading-relaxed">
                  Bạn có chắc chắn muốn xóa/ẩn bài viết này không?
                  <br />
                  <span className="text-[11px] text-[#94a3b8] italic">
                    (Bài viết sẽ được chuyển vào trạng thái đã xóa)
                  </span>
                </p>
              </div>

              <div className="p-4 bg-[#f8fafc] border-t border-[#e2e8f0] flex justify-end gap-2">
                <button
                  type="button"
                  className="border border-[#cbd5e1] bg-white text-[#334155] rounded-xl px-4 py-2 font-bold text-[13px]"
                  onClick={() => setDeletingPost(null)}
                  disabled={isDeletingPost}
                >
                  Hủy
                </button>
                <button
                  type="button"
                  className="bg-[#ef4444] text-white rounded-xl px-4 py-2 font-bold text-[13px] disabled:opacity-50"
                  onClick={handleConfirmDelete}
                  disabled={isDeletingPost}
                >
                  {isDeletingPost ? "Đang xóa..." : "Xác nhận xóa"}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {/* Modal Tạo Chiến Dịch Seeding Mới (Chỉ cần Name & Color Code) */}
        {isCampaignModalOpen ? (
          <div
            className="fixed inset-0 bg-[rgba(25,27,35,.42)] flex items-center justify-center z-30 p-5"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setIsCampaignModalOpen(false);
            }}
          >
            <div className="w-[min(480px,100%)] bg-white rounded-2xl shadow-[0_30px_80px_rgba(0,0,0,.25)] overflow-hidden">
              <div className="p-5 border-b border-[#e7e9ef] flex items-center justify-between">
                <h3 className="text-base font-bold text-[#0f172a] flex items-center gap-2">
                  <span>🚩</span> Tạo chiến dịch Seeding mới
                </h3>
                <button
                  type="button"
                  className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-500 font-bold"
                  onClick={() => setIsCampaignModalOpen(false)}
                >
                  ✕
                </button>
              </div>

              <div className="p-5 space-y-4">
                <div>
                  <label className="text-xs font-bold text-[#334155] block mb-1">
                    Tên chiến dịch <span className="text-red-500">*</span>:
                  </label>
                  <input
                    value={newCampaignName}
                    onChange={(e) => setNewCampaignName(e.target.value)}
                    disabled={isCreatingCampaign}
                    className="w-full border border-[#dde0e7] rounded-xl px-3.5 py-2 text-sm outline-none focus:border-[#be123c]"
                    placeholder="VD: MARKETING THỰC CHIẾN, AI CRM WEBINAR..."
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-[#334155] block mb-1">
                    Màu đại diện Banner:
                  </label>
                  <div className="flex items-center gap-3">
                    {["#fff1f2", "#f0fdf4", "#eff6ff", "#fefce8", "#faf5ff"].map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setNewCampaignColor(c)}
                        style={{ backgroundColor: c }}
                        className={`w-8 h-8 rounded-full border-2 transition ${newCampaignColor === c ? "border-[#be123c] scale-110 shadow-sm" : "border-gray-200"
                          }`}
                      />
                    ))}
                  </div>
                </div>
              </div>

              <div className="p-4 bg-gray-50 border-t border-[#e7e9ef] flex justify-end gap-2">
                <button
                  type="button"
                  className="border border-[#dde0e7] bg-white rounded-xl px-4 py-2 font-bold text-xs text-gray-700"
                  onClick={() => setIsCampaignModalOpen(false)}
                  disabled={isCreatingCampaign}
                >
                  Hủy
                </button>
                <button
                  type="button"
                  className="bg-[#be123c] hover:bg-[#9f1239] text-white rounded-xl px-4 py-2 font-bold text-xs disabled:opacity-50 transition shadow-sm"
                  onClick={handleCreateCampaign}
                  disabled={isCreatingCampaign}
                >
                  {isCreatingCampaign ? "Đang tạo..." : "Tạo chiến dịch"}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {/* Modal Xác nhận Xóa Chiến dịch (Thay thế window.confirm) */}
        {deletingCampaignTarget ? (
          <div
            className="fixed inset-0 bg-[rgba(25,27,35,.42)] flex items-center justify-center z-50 p-5"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setDeletingCampaignTarget(null);
            }}
          >
            <div className="w-[min(420px,100%)] bg-white rounded-2xl shadow-[0_30px_80px_rgba(0,0,0,.25)] overflow-hidden p-6 text-center">
              <div className="w-12 h-12 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center text-xl font-bold mx-auto mb-3">
                🗑️
              </div>
              <h3 className="text-base font-bold text-gray-900 mb-1">Xác nhận xóa chiến dịch</h3>
              <p className="text-xs text-gray-500 mb-6 leading-relaxed">
                Bạn có chắc chắn muốn xóa chiến dịch <b className="text-gray-900">&quot;{deletingCampaignTarget.name}&quot;</b> không? Các bài viết thuộc chiến dịch này sẽ không bị xóa.
              </p>
              <div className="flex justify-center gap-3">
                <button
                  type="button"
                  onClick={() => setDeletingCampaignTarget(null)}
                  className="border border-gray-200 bg-white rounded-xl px-4 py-2 font-bold text-xs text-gray-700 hover:bg-gray-50 transition"
                >
                  Hủy
                </button>
                <button
                  type="button"
                  onClick={handleConfirmDeleteCampaign}
                  className="bg-rose-600 hover:bg-rose-700 text-white rounded-xl px-4 py-2 font-bold text-xs shadow-sm transition"
                >
                  Xác nhận xóa
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {/* Modal Thêm Bài Viết Seeding Mới */}
        {isCreateTaskModalOpen ? (
          <div
            className="fixed inset-0 bg-[rgba(25,27,35,.42)] flex items-center justify-center z-30 p-5"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setIsCreateTaskModalOpen(false);
            }}
          >
            <div className="w-[min(560px,100%)] bg-white rounded-2xl shadow-[0_30px_80px_rgba(0,0,0,.25)] overflow-hidden">
              <div className="p-5 border-b border-gray-100 flex items-center justify-between">
                <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                  <span>➕</span> Thêm bài viết Seeding mới
                </h3>
                <button
                  type="button"
                  className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-500 font-bold"
                  onClick={() => setIsCreateTaskModalOpen(false)}
                >
                  ✕
                </button>
              </div>

              <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
                <div>
                  <label className="text-xs font-bold text-gray-700 block mb-1">
                    Link bài viết Seeding <span className="text-red-500">*</span>:
                  </label>
                  <input
                    value={taskLink}
                    onChange={(e) => setTaskLink(e.target.value)}
                    disabled={isSubmittingTask}
                    className="w-full border border-gray-200 rounded-xl px-3.5 py-2 text-sm outline-none focus:border-rose-500"
                    placeholder="Dán link bài viết (Facebook, YouTube, TikTok, LinkedIn, Threads...)"
                  />
                </div>

                {(() => {
                  const isLinkedInTaskLink = isLinkedInUrl(taskLink.trim());
                  return (
                    <>
                      {isLinkedInTaskLink && liAutoFetchStatus === "fetching" ? (
                        <p className="text-[11px] text-[#0a66c2] font-semibold">⏳ Đang tự động lấy nội dung bài viết LinkedIn...</p>
                      ) : null}

                      {isLinkedInTaskLink && liAutoFetchStatus === "success" ? (
                        <p className="text-[11px] text-green-700 font-semibold">✓ Đã tự động lấy nội dung bài viết LinkedIn.</p>
                      ) : null}
                    </>
                  );
                })()}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-bold text-gray-700 block mb-1">
                      Chọn Chiến dịch Seeding:
                    </label>
                    <select
                      value={taskCampaignId}
                      onChange={(e) => setTaskCampaignId(e.target.value)}
                      disabled={isSubmittingTask}
                      className="w-full border border-gray-200 rounded-xl px-3.5 py-2 text-xs font-semibold outline-none focus:border-rose-500 bg-white"
                    >
                      <option value="">-- Tự do (Không gắn chiến dịch) --</option>
                      {campaigns.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-xs font-bold text-gray-700 block mb-1">
                      Hạn chót (Deadline) <span className="text-red-500">*</span>:
                    </label>
                    <input
                      type="datetime-local"
                      value={taskDeadline}
                      onChange={(e) => setTaskDeadline(e.target.value)}
                      disabled={isSubmittingTask}
                      className="w-full border border-gray-200 rounded-xl px-3 py-1.5 text-xs outline-none focus:border-rose-500"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-bold text-gray-700 block">
                      Phân công Teams thực hiện:
                    </label>
                    <label className="flex items-center gap-1.5 text-xs font-bold cursor-pointer text-rose-600 hover:text-rose-700">
                      <input
                        type="checkbox"
                        checked={isAllTeamsSelected}
                        onChange={toggleSelectAllTeams}
                        className="w-4 h-4 text-rose-600 rounded cursor-pointer"
                      />
                      <span>Chọn tất cả Teams</span>
                    </label>
                  </div>

                  <div className="flex items-center gap-2.5 flex-wrap pt-1">
                    {dbTeams.length > 0
                      ? dbTeams.map((team) => {
                        const isChecked = taskAssignedTeams.includes(team.id) || taskAssignedTeams.includes(team.name_team);
                        return (
                          <label
                            key={team.id}
                            className={`flex items-center gap-1.5 text-xs font-medium cursor-pointer border px-3 py-1.5 rounded-xl transition ${isChecked
                              ? "bg-rose-50 border-rose-200 text-rose-900 font-bold shadow-xs"
                              : "bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100"
                              }`}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => {
                                setTaskAssignedTeams((prev) =>
                                  isChecked
                                    ? prev.filter((t) => t !== team.id && t !== team.name_team)
                                    : [...prev, team.id]
                                );
                              }}
                              className="w-4 h-4 text-rose-600 rounded"
                            />
                            <span>{team.name_team} ({team.member_count})</span>
                          </label>
                        );
                      })
                      : ["Sale", "Marketing", "Presale", "Operation"].map((team) => {
                        const isChecked = taskAssignedTeams.includes(team);
                        return (
                          <label
                            key={team}
                            className={`flex items-center gap-1.5 text-xs font-medium cursor-pointer border px-3 py-1.5 rounded-xl transition ${isChecked
                              ? "bg-rose-50 border-rose-200 text-rose-900 font-bold shadow-xs"
                              : "bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100"
                              }`}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => {
                                setTaskAssignedTeams((prev) =>
                                  isChecked ? prev.filter((t) => t !== team) : [...prev, team]
                                );
                              }}
                              className="w-4 h-4 text-rose-600 rounded"
                            />
                            <span>{team}</span>
                          </label>
                        );
                      })}
                  </div>
                </div>

                {/* Target KPI Section */}
                <div className="p-3.5 bg-rose-50/50 rounded-xl border border-rose-100">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-xs font-bold text-rose-900">💬 Target KPI Comment tự động:</span>
                    <span className="text-[11px] font-semibold text-rose-600">
                      {totalSelectedMembers === 0
                        ? "Tự động tính theo tổng 0 thành viên được giao"
                        : `Tự động tính theo tổng ${totalSelectedMembers} thành viên được giao (Tối đa: ${totalSelectedMembers})`}
                    </span>
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-gray-600 block mb-1">Target Comment (Mục tiêu số lượt Comment):</label>
                    <input
                      type="number"
                      min={1}
                      max={totalSelectedMembers > 0 ? totalSelectedMembers : 1}
                      value={taskTargetComments}
                      onChange={(e) => setTaskTargetComments(Number(e.target.value))}
                      disabled={isSubmittingTask}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none bg-white font-bold text-gray-900 focus:border-rose-500"
                    />
                    {totalSelectedMembers === 0 ? (
                      <p className="text-[11px] font-semibold text-amber-600 mt-1 flex items-center gap-1">
                        ⚠️ Vui lòng chọn ít nhất một Team thực hiện ở trên.
                      </p>
                    ) : (taskTargetComments <= 0 || taskTargetComments > totalSelectedMembers) ? (
                      <p className="text-[11px] font-semibold text-red-600 mt-1 flex items-center gap-1">
                        ⚠️ Target Comment phải từ 1 đến tối đa {totalSelectedMembers}.
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="p-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-2">
                <button
                  type="button"
                  className="border border-gray-200 bg-white rounded-xl px-4 py-2 font-bold text-xs text-gray-700"
                  onClick={() => setIsCreateTaskModalOpen(false)}
                  disabled={isSubmittingTask}
                >
                  Hủy
                </button>
                <button
                  type="button"
                  className="bg-[#be123c] hover:bg-[#9f1239] text-white rounded-xl px-4 py-2 font-bold text-xs disabled:opacity-50 transition shadow-sm"
                  onClick={handleCreateTaskSubmit}
                  disabled={isSubmittingTask}
                >
                  {isSubmittingTask ? "Đang tạo..." : "Tạo bài viết Seeding"}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {/* Modal Bảng xếp hạng Seeder chi tiết (Phân trang 10 thành viên) */}
        {isLeaderboardModalOpen ? (
          <div
            className="fixed inset-0 bg-[rgba(25,27,35,.42)] flex items-center justify-center z-[40] p-5"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setIsLeaderboardModalOpen(false);
            }}
          >
            <div className="w-[min(800px,100%)] bg-white rounded-2xl shadow-[0_30px_80px_rgba(0,0,0,.25)] overflow-hidden flex flex-col max-h-[85vh]">
              <div className="flex justify-between items-center p-5 border-b border-gray-100">
                <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                  <span>🏆</span> Bảng xếp hạng Seeder chi tiết
                </h3>
                <button
                  type="button"
                  className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-500 font-bold"
                  onClick={() => setIsLeaderboardModalOpen(false)}
                >
                  ✕
                </button>
              </div>

              <div className="p-5 overflow-y-auto flex-1">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                        <th className="pb-3 pl-2">Hạng</th>
                        <th className="pb-3">Thành viên</th>
                        <th className="pb-3 text-center">Được giao</th>
                        <th className="pb-3 text-center">Hoàn thành</th>
                        <th className="pb-3 text-center">Đúng hạn</th>
                        <th className="pb-3 text-center">Tỷ lệ</th>
                        <th className="pb-3 text-right pr-2">Điểm</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {paginatedLeaderboard.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="py-6 text-center text-gray-400 text-xs">
                            Không có dữ liệu.
                          </td>
                        </tr>
                      ) : paginatedLeaderboard.map((item, idx) => {
                        const rank = (leaderboardCurrentPage - 1) * LEADERBOARD_PAGE_SIZE + idx + 1;
                        const badgeBg = rank === 1 ? "bg-amber-100 text-amber-800 border-amber-300" : rank === 2 ? "bg-slate-100 text-slate-700 border-slate-300" : rank === 3 ? "bg-orange-100 text-orange-800 border-orange-300" : "bg-gray-50 text-gray-600 border-gray-200";
                        const rankIcon = rank === 1 ? "🥇 1" : rank === 2 ? "🥈 2" : rank === 3 ? "🥉 3" : rank;
                        return (
                          <tr key={item.user_id || idx} className="hover:bg-gray-50/60 transition-colors">
                            <td className="py-3.5 pl-2">
                              <span className={`inline-flex items-center justify-center px-2.5 py-1 rounded-full text-xs font-bold border ${badgeBg}`}>
                                {rankIcon}
                              </span>
                            </td>
                            <td className="py-3.5">
                              <div className="font-bold text-gray-900">{item.member_name}</div>
                              <div className="text-xs text-gray-400 font-normal">{item.team_name}</div>
                            </td>
                            <td className="py-3.5 text-center text-gray-700 font-medium">{item.total_assigned}</td>
                            <td className="py-3.5 text-center text-emerald-600 font-bold">{item.total_completed}</td>
                            <td className="py-3.5 text-center text-blue-600 font-medium">{item.total_ontime}</td>
                            <td className="py-3.5 text-center text-gray-700 font-medium">{item.completion_rate}%</td>
                            <td className="py-3.5 text-right pr-2 font-black text-emerald-600 text-base">{item.score}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Phân trang */}
              <div className="p-4 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
                <span className="text-xs text-gray-500 font-semibold">
                  Trang {leaderboardCurrentPage} / {Math.max(1, leaderboardTotalPages)} ({activeLeaderboard.length} thành viên)
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={leaderboardCurrentPage === 1}
                    onClick={() => setLeaderboardCurrentPage((p) => Math.max(1, p - 1))}
                    className="px-3 py-1.5 border border-gray-200 bg-white rounded-xl text-xs font-bold disabled:opacity-50 text-gray-700 hover:bg-gray-50 transition"
                  >
                    ◀ Trước
                  </button>
                  <button
                    type="button"
                    disabled={leaderboardCurrentPage >= leaderboardTotalPages}
                    onClick={() => setLeaderboardCurrentPage((p) => Math.min(leaderboardTotalPages, p + 1))}
                    className="px-3 py-1.5 border border-gray-200 bg-white rounded-xl text-xs font-bold disabled:opacity-50 text-gray-700 hover:bg-gray-50 transition"
                  >
                    Sau ▶
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {/* Toast Light Theme */}
        {toast ? (
          <div
            className={`fixed right-6 bottom-6 z-[50] flex items-center gap-3 px-4 py-3 bg-white text-[#1f2937] text-[13px] font-semibold rounded-2xl shadow-[0_10px_30px_rgba(0,0,0,0.12)] transition-all animate-in fade-in slide-in-from-bottom-2 ${toast.type === "error"
              ? "border border-red-300"
              : toast.type === "warning"
                ? "border border-amber-300"
                : "border border-rose-100"
              }`}
          >
            {toast.type === "success" ? (
              <span className="w-6 h-6 rounded-full bg-emerald-50 text-emerald-600 grid place-items-center text-xs font-bold flex-shrink-0">
                ✓
              </span>
            ) : toast.type === "error" ? (
              <span className="w-6 h-6 rounded-full bg-red-50 text-red-600 grid place-items-center text-xs font-bold flex-shrink-0">
                ✕
              </span>
            ) : toast.type === "warning" ? (
              <span className="w-6 h-6 rounded-full bg-amber-50 text-amber-600 grid place-items-center text-xs font-bold flex-shrink-0">
                ⚠️
              </span>
            ) : (
              <span className="w-6 h-6 rounded-full bg-rose-50 text-[#c71f4d] grid place-items-center text-xs font-bold flex-shrink-0">
                ℹ️
              </span>
            )}
            <span className="leading-snug">{toast.text}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}