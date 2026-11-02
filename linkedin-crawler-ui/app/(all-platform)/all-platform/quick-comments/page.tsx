"use client";

import React, { useEffect, useState, useMemo, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  allPlatformQuickCommentService,
  allPlatformQuickInboxService,
} from "@/services/all-platform.service";
import { QuickCommentTemplate, QuickInboxTemplate } from "@/types/unified.types";

function QuickCommentsContent() {
  const searchParams = useSearchParams();
  const initialTab = searchParams.get("tab") === "inbox" ? "inbox" : "comments";

  // Active top tab: "comments" | "inbox"
  const [activeMainTab, setActiveMainTab] = useState<"comments" | "inbox">(initialTab);

  // Sync tab with URL if changed
  useEffect(() => {
    const tabParam = searchParams.get("tab");
    if (tabParam === "inbox") {
      setActiveMainTab("inbox");
    } else if (tabParam === "comments") {
      setActiveMainTab("comments");
    }
  }, [searchParams]);

  // ══════════════════════════════════════════════════════════════════════════════
  // TAB 1: QUICK COMMENTS (MẪU BÌNH LUẬN SEEDING)
  // ══════════════════════════════════════════════════════════════════════════════
  const [commentTemplates, setCommentTemplates] = useState<QuickCommentTemplate[]>([]);
  const [isLoadingComments, setIsLoadingComments] = useState(true);
  const [commentLoadError, setCommentLoadError] = useState<string | null>(null);

  // Filters for comments
  const [activePlatform, setActivePlatform] = useState<string>("all");
  const [commentSearchQuery, setCommentSearchQuery] = useState<string>("" );
  const [selectedCommentLabel, setSelectedCommentLabel] = useState<string>("all");

  // Pagination for comments
  const [commentCurrentPage, setCommentCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 10;

  // Modal State - Add / Edit Comment
  const [isCommentModalOpen, setIsCommentModalOpen] = useState(false);
  const [editingComment, setEditingComment] = useState<QuickCommentTemplate | null>(null);
  const [commentFormData, setCommentFormData] = useState({
    title: "",
    label: "Khen ngợi",
    content: "",
    platform: "all",
  });
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);

  // Modal State - Delete Comment
  const [deletingComment, setDeletingComment] = useState<QuickCommentTemplate | null>(null);
  const [isDeletingComment, setIsDeletingComment] = useState(false);

  // ══════════════════════════════════════════════════════════════════════════════
  // TAB 2: QUICK INBOX (THƯ VIỆN MẪU INBOX ZALO & TƯ VẤN)
  // ══════════════════════════════════════════════════════════════════════════════
  const [inboxTemplates, setInboxTemplates] = useState<QuickInboxTemplate[]>([]);
  const [isLoadingInbox, setIsLoadingInbox] = useState(true);
  const [inboxLoadError, setInboxLoadError] = useState<string | null>(null);

  // Filters for inbox
  const [inboxSearchQuery, setInboxSearchQuery] = useState<string>("");
  const [selectedInboxLabel, setSelectedInboxLabel] = useState<string>("all");

  // Pagination for inbox
  const [inboxCurrentPage, setInboxCurrentPage] = useState(1);

  // Modal State - Add / Edit Inbox Template
  const [isInboxModalOpen, setIsInboxModalOpen] = useState(false);
  const [editingInbox, setEditingInbox] = useState<QuickInboxTemplate | null>(null);
  const [inboxFormData, setInboxFormData] = useState({
    title: "",
    label: "Chào hỏi",
    content: "",
    content_with_post: "",
  });
  const [isSubmittingInbox, setIsSubmittingInbox] = useState(false);

  // Modal State - Delete Inbox Template
  const [deletingInbox, setDeletingInbox] = useState<QuickInboxTemplate | null>(null);
  const [isDeletingInbox, setIsDeletingInbox] = useState(false);

  // ══════════════════════════════════════════════════════════════════════════════
  // TOAST NOTIFICATION
  // ══════════════════════════════════════════════════════════════════════════════
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);

  const showToast = (message: string, type: "success" | "error" | "info" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  // ────────────────────────────────────────────────────────────────────────────
  // LOAD DATA FUNCTIONS
  // ────────────────────────────────────────────────────────────────────────────
  const loadCommentTemplates = async () => {
    setIsLoadingComments(true);
    setCommentLoadError(null);
    try {
      const res = await allPlatformQuickCommentService.getAll();
      if (res && res.success && Array.isArray(res.data)) {
        setCommentTemplates(res.data);
      } else {
        setCommentLoadError(res?.message || "Không thể tải danh sách mẫu câu.");
      }
    } catch (err: any) {
      setCommentLoadError(err?.message || "Lỗi khi kết nối với máy chủ.");
    } finally {
      setIsLoadingComments(false);
    }
  };

  const loadInboxTemplates = async () => {
    setIsLoadingInbox(true);
    setInboxLoadError(null);
    try {
      const res = await allPlatformQuickInboxService.getAll();
      if (res && res.success && Array.isArray(res.data)) {
        setInboxTemplates(res.data);
      } else {
        setInboxLoadError(res?.message || "Không thể tải danh sách mẫu inbox.");
      }
    } catch (err: any) {
      setInboxLoadError(err?.message || "Lỗi khi kết nối với máy chủ.");
    } finally {
      setIsLoadingInbox(false);
    }
  };

  useEffect(() => {
    loadCommentTemplates();
    loadInboxTemplates();
  }, []);

  // ────────────────────────────────────────────────────────────────────────────
  // TAB 1 (COMMENTS) FILTER & HANDLERS
  // ────────────────────────────────────────────────────────────────────────────
  const availableCommentLabels = useMemo(() => {
    const labels = new Set<string>();
    commentTemplates.forEach((t) => {
      if (t.label) labels.add(t.label);
    });
    return Array.from(labels);
  }, [commentTemplates]);

  const filteredComments = useMemo(() => {
    return commentTemplates.filter((t) => {
      if (activePlatform !== "all" && t.platform !== "all" && t.platform !== activePlatform) {
        return false;
      }
      if (selectedCommentLabel !== "all" && t.label !== selectedCommentLabel) {
        return false;
      }
      if (commentSearchQuery.trim()) {
        const q = commentSearchQuery.toLowerCase().trim();
        const matchTitle = t.title.toLowerCase().includes(q);
        const matchContent = t.content.toLowerCase().includes(q);
        const matchLabel = t.label?.toLowerCase().includes(q);
        if (!matchTitle && !matchContent && !matchLabel) {
          return false;
        }
      }
      return true;
    });
  }, [commentTemplates, activePlatform, selectedCommentLabel, commentSearchQuery]);

  useEffect(() => {
    setCommentCurrentPage(1);
  }, [activePlatform, commentSearchQuery, selectedCommentLabel]);

  const totalCommentPages = Math.max(1, Math.ceil(filteredComments.length / ITEMS_PER_PAGE));
  const commentStartIndex = (commentCurrentPage - 1) * ITEMS_PER_PAGE;
  const paginatedComments = useMemo(() => {
    return filteredComments.slice(commentStartIndex, commentStartIndex + ITEMS_PER_PAGE);
  }, [filteredComments, commentStartIndex]);

  const openAddCommentModal = () => {
    setEditingComment(null);
    setCommentFormData({
      title: "",
      label: "Khen ngợi",
      content: "",
      platform: "all",
    });
    setIsCommentModalOpen(true);
  };

  const openEditCommentModal = (template: QuickCommentTemplate) => {
    setEditingComment(template);
    setCommentFormData({
      title: template.title,
      label: template.label || "Khác",
      content: template.content,
      platform: template.platform || "all",
    });
    setIsCommentModalOpen(true);
  };

  const handleCommentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentFormData.title.trim() || !commentFormData.content.trim()) {
      showToast("Vui lòng điền đầy đủ tiêu đề và nội dung mẫu câu.", "error");
      return;
    }

    setIsSubmittingComment(true);
    try {
      if (editingComment) {
        const res = await allPlatformQuickCommentService.update({
          id: editingComment.id,
          title: commentFormData.title.trim(),
          label: commentFormData.label.trim(),
          content: commentFormData.content.trim(),
          platform: commentFormData.platform,
        });
        if (res && res.success) {
          showToast("Đã cập nhật mẫu câu thành công!", "success");
          setIsCommentModalOpen(false);
          loadCommentTemplates();
        } else {
          showToast(res?.message || "Không thể cập nhật mẫu câu.", "error");
        }
      } else {
        const res = await allPlatformQuickCommentService.add({
          title: commentFormData.title.trim(),
          label: commentFormData.label.trim(),
          content: commentFormData.content.trim(),
          platform: commentFormData.platform,
        });
        if (res && res.success) {
          showToast("Đã thêm mẫu câu mới thành công!", "success");
          setIsCommentModalOpen(false);
          loadCommentTemplates();
        } else {
          showToast(res?.message || "Không thể thêm mẫu câu.", "error");
        }
      }
    } catch (err: any) {
      showToast(err?.message || "Có lỗi xảy ra khi lưu mẫu câu.", "error");
    } finally {
      setIsSubmittingComment(false);
    }
  };

  const handleDeleteCommentConfirm = async () => {
    if (!deletingComment) return;
    setIsDeletingComment(true);
    try {
      const res = await allPlatformQuickCommentService.delete(deletingComment.id);
      if (res && res.success) {
        showToast("Đã xóa mẫu câu thành công!", "success");
        setDeletingComment(null);
        loadCommentTemplates();
      } else {
        showToast(res?.message || "Không thể xóa mẫu câu.", "error");
      }
    } catch (err: any) {
      showToast(err?.message || "Có lỗi xảy ra khi xóa mẫu câu.", "error");
    } finally {
      setIsDeletingComment(false);
    }
  };

  const handleCommentReorder = async (id: string, direction: "up" | "down") => {
    try {
      const res = await allPlatformQuickCommentService.reorder(id, direction);
      if (res && res.success) {
        if (Array.isArray(res.data)) {
          setCommentTemplates(res.data);
        } else {
          loadCommentTemplates();
        }
      } else {
        showToast(res?.message || "Không thể thay đổi thứ tự.", "error");
      }
    } catch (err: any) {
      showToast(err?.message || "Lỗi khi đổi thứ tự.", "error");
    }
  };

  // ────────────────────────────────────────────────────────────────────────────
  // TAB 2 (INBOX) FILTER & HANDLERS
  // ────────────────────────────────────────────────────────────────────────────
  const availableInboxLabels = useMemo(() => {
    const labels = new Set<string>();
    inboxTemplates.forEach((t) => {
      if (t.label) labels.add(t.label);
    });
    return Array.from(labels);
  }, [inboxTemplates]);

  const filteredInbox = useMemo(() => {
    return inboxTemplates.filter((t) => {
      if (selectedInboxLabel !== "all" && t.label !== selectedInboxLabel) {
        return false;
      }
      if (inboxSearchQuery.trim()) {
        const q = inboxSearchQuery.toLowerCase().trim();
        const matchTitle = t.title.toLowerCase().includes(q);
        const matchContent = t.content.toLowerCase().includes(q);
        const matchLabel = t.label?.toLowerCase().includes(q);
        if (!matchTitle && !matchContent && !matchLabel) {
          return false;
        }
      }
      return true;
    });
  }, [inboxTemplates, selectedInboxLabel, inboxSearchQuery]);

  useEffect(() => {
    setInboxCurrentPage(1);
  }, [inboxSearchQuery, selectedInboxLabel]);

  const totalInboxPages = Math.max(1, Math.ceil(filteredInbox.length / ITEMS_PER_PAGE));
  const inboxStartIndex = (inboxCurrentPage - 1) * ITEMS_PER_PAGE;
  const paginatedInbox = useMemo(() => {
    return filteredInbox.slice(inboxStartIndex, inboxStartIndex + ITEMS_PER_PAGE);
  }, [filteredInbox, inboxStartIndex]);

  const openAddInboxModal = () => {
    setEditingInbox(null);
    setInboxFormData({
      title: "",
      label: "Chào hỏi",
      content: "",
      content_with_post: "",
    });
    setIsInboxModalOpen(true);
  };

  const openEditInboxModal = (template: QuickInboxTemplate) => {
    setEditingInbox(template);
    setInboxFormData({
      title: template.title,
      label: template.label || "Khác",
      content: template.content,
      content_with_post: template.content_with_post || "",
    });
    setIsInboxModalOpen(true);
  };

  const handleInboxSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inboxFormData.title.trim() || !inboxFormData.content.trim()) {
      showToast("Vui lòng điền đầy đủ tiêu đề và nội dung mẫu inbox.", "error");
      return;
    }

    setIsSubmittingInbox(true);
    try {
      if (editingInbox) {
        const res = await allPlatformQuickInboxService.update({
          id: editingInbox.id,
          title: inboxFormData.title.trim(),
          label: inboxFormData.label.trim(),
          content: inboxFormData.content.trim(),
          content_with_post: inboxFormData.content_with_post.trim() || undefined,
        });
        if (res && res.success) {
          showToast("Đã cập nhật mẫu inbox thành công!", "success");
          setIsInboxModalOpen(false);
          loadInboxTemplates();
        } else {
          showToast(res?.message || "Không thể cập nhật mẫu inbox.", "error");
        }
      } else {
        const res = await allPlatformQuickInboxService.add({
          title: inboxFormData.title.trim(),
          label: inboxFormData.label.trim(),
          content: inboxFormData.content.trim(),
          content_with_post: inboxFormData.content_with_post.trim() || undefined,
        });
        if (res && res.success) {
          showToast("Đã thêm mẫu inbox Zalo mới thành công!", "success");
          setIsInboxModalOpen(false);
          loadInboxTemplates();
        } else {
          showToast(res?.message || "Không thể thêm mẫu inbox.", "error");
        }
      }
    } catch (err: any) {
      showToast(err?.message || "Có lỗi xảy ra khi lưu mẫu inbox.", "error");
    } finally {
      setIsSubmittingInbox(false);
    }
  };

  const handleDeleteInboxConfirm = async () => {
    if (!deletingInbox) return;
    setIsDeletingInbox(true);
    try {
      const res = await allPlatformQuickInboxService.delete(deletingInbox.id);
      if (res && res.success) {
        showToast("Đã xóa mẫu inbox thành công!", "success");
        setDeletingInbox(null);
        loadInboxTemplates();
      } else {
        showToast(res?.message || "Không thể xóa mẫu inbox.", "error");
      }
    } catch (err: any) {
      showToast(err?.message || "Có lỗi xảy ra khi xóa mẫu inbox.", "error");
    } finally {
      setIsDeletingInbox(false);
    }
  };

  const handleInboxReorder = async (id: string, direction: "up" | "down") => {
    try {
      const res = await allPlatformQuickInboxService.reorder(id, direction);
      if (res && res.success) {
        if (Array.isArray(res.data)) {
          setInboxTemplates(res.data);
        } else {
          loadInboxTemplates();
        }
      } else {
        showToast(res?.message || "Không thể thay đổi thứ tự.", "error");
      }
    } catch (err: any) {
      showToast(err?.message || "Lỗi khi đổi thứ tự.", "error");
    }
  };

  const handleCopyText = (text: string, title: string) => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      showToast(`Đã sao chép mẫu: "${title}" vào bộ nhớ tạm!`, "success");
    }
  };

  // Badge helper for comment platforms
  const getPlatformBadge = (platform?: string) => {
    switch (platform) {
      case "facebook":
        return <span className="inline-block whitespace-nowrap px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-50 text-blue-700 border border-blue-200">Facebook</span>;
      case "linkedin":
        return <span className="inline-block whitespace-nowrap px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-sky-50 text-sky-700 border border-sky-200">LinkedIn</span>;
      case "youtube":
        return <span className="inline-block whitespace-nowrap px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-red-50 text-red-700 border border-red-200">YouTube</span>;
      case "zalo":
        return <span className="inline-block whitespace-nowrap px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">Zalo</span>;
      default:
        return <span className="inline-block whitespace-nowrap px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-purple-50 text-purple-700 border border-purple-200">Tất cả nền tảng</span>;
    }
  };

  // Badge helper for inbox labels
  const getInboxLabelBadge = (label?: string) => {
    const l = (label || "").toLowerCase();
    if (l.includes("chào") || l.includes("mở đầu")) {
      return <span className="inline-block whitespace-nowrap px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">{label || "Chào hỏi"}</span>;
    }
    if (l.includes("giá") || l.includes("báo giá") || l.includes("chi phí")) {
      return <span className="inline-block whitespace-nowrap px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-sky-50 text-sky-700 border border-sky-200">{label || "Báo giá"}</span>;
    }
    if (l.includes("chăm sóc") || l.includes("follow") || l.includes("hỏi thăm")) {
      return <span className="inline-block whitespace-nowrap px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200">{label || "Chăm sóc"}</span>;
    }
    if (l.includes("chốt") || l.includes("hợp đồng") || l.includes("deal")) {
      return <span className="inline-block whitespace-nowrap px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200">{label || "Chốt đơn"}</span>;
    }
    return <span className="inline-block whitespace-nowrap px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">{label || "Khác"}</span>;
  };

  return (
    <div className="w-full bg-[#f7f8fb] text-[#252733] min-h-screen">
      {/* Toast Alert */}
      {toast ? (
        <div
          className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl shadow-xl text-xs font-bold text-white transition-all transform animate-bounce ${
            toast.type === "success" ? "bg-emerald-600" : toast.type === "error" ? "bg-rose-600" : "bg-sky-600"
          }`}
        >
          {toast.type === "success" ? "✅ " : toast.type === "error" ? "❌ " : "ℹ️ "}
          {toast.message}
        </div>
      ) : null}

      {/* HEADER */}
      <div className="sticky top-0 z-10 bg-white border-b border-[#e7e9ef] h-14.5 flex items-center justify-between px-6">
        <div className="flex items-center gap-3">
          <Link
            href="/all-platform/inbox"
            className="px-3.5 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-xs font-extrabold transition flex items-center gap-1.5 shadow-2xs"
          >
            <span>⬅</span> Trở về Inbox
          </Link>
          <span className="text-gray-300">|</span>
          <div className="font-black text-[17px] text-gray-900">
            {activeMainTab === "inbox" ? "Thư viện mẫu tin nhắn Inbox Zalo" : "Thư viện mẫu câu Seeding"}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="border border-[#e7e9ef] bg-white hover:bg-gray-50 rounded-xl p-2 transition cursor-pointer text-sm"
            aria-label="refresh"
            onClick={() => {
              if (activeMainTab === "inbox") loadInboxTemplates();
              else loadCommentTemplates();
            }}
            title="Làm mới dữ liệu"
          >
            🔄
          </button>
        </div>
      </div>

      <div className="max-w-425 mx-auto p-5">
        {/* TOP LEVEL NAVIGATION TABS */}
        <div className="flex items-center gap-2 border-b border-gray-200 mb-6 pb-2">
          <button
            type="button"
            onClick={() => setActiveMainTab("comments")}
            className={`px-5 py-2.5 rounded-xl font-extrabold text-sm transition-all flex items-center gap-2 cursor-pointer ${
              activeMainTab === "comments"
                ? "bg-[#be123c] text-white shadow-md shadow-rose-900/10"
                : "bg-white hover:bg-gray-100 text-gray-600 border border-gray-200"
            }`}
          >
            <span>💬</span>
            <span>Mẫu bình luận Seeding</span>
            <span className={`px-2 py-0.5 rounded-full text-xs ${activeMainTab === "comments" ? "bg-white/20 text-white" : "bg-gray-100 text-gray-600"}`}>
              {commentTemplates.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveMainTab("inbox")}
            className={`px-5 py-2.5 rounded-xl font-extrabold text-sm transition-all flex items-center gap-2 cursor-pointer ${
              activeMainTab === "inbox"
                ? "bg-sky-600 text-white shadow-md shadow-sky-900/10"
                : "bg-white hover:bg-gray-100 text-gray-600 border border-gray-200"
            }`}
          >
            <span>📥</span>
            <span>Thư viện mẫu inbox (Zalo & Tư vấn)</span>
            <span className={`px-2 py-0.5 rounded-full text-xs ${activeMainTab === "inbox" ? "bg-white/20 text-white" : "bg-sky-100 text-sky-700"}`}>
              {inboxTemplates.length}
            </span>
          </button>
        </div>

        {/* ══════════════════════════════════════════════════════════════════════ */}
        {/* CONTENT FOR TAB 1: MẪU BÌNH LUẬN SEEDING */}
        {/* ══════════════════════════════════════════════════════════════════════ */}
        {activeMainTab === "comments" && (
          <div className="space-y-6 animate-in fade-in duration-150">
            {/* TITLE & ACTIONS */}
            <div className="flex flex-col sm:flex-row justify-between gap-4 sm:items-center">
              <div>
                <h1 className="text-[22px] m-0 mb-[4px] font-extrabold text-[#0f172a]">
                  Mẫu bình luận Seeding (Quick Comments)
                </h1>
                <p className="m-0 text-[#64748b] text-[13px]">
                  Quản lý danh sách mẫu bình luận nhanh cho nhân viên tương tác seeding trên Facebook, LinkedIn và YouTube.
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <button
                  type="button"
                  onClick={openAddCommentModal}
                  className="px-4 py-2.5 bg-[#be123c] hover:bg-[#9f1239] text-white rounded-xl text-[13px] font-bold shadow-sm transition flex items-center gap-2 cursor-pointer"
                >
                  <span className="text-base font-bold">+</span> Thêm mẫu câu mới
                </button>
              </div>
            </div>

            {/* STATS CARDS */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3.5">
              <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-[0_2px_8px_rgba(0,0,0,0.03)]">
                <span className="text-xs font-semibold text-gray-500 block">Tổng mẫu câu</span>
                <div className="text-2xl font-black text-gray-900 mt-1">{commentTemplates.length}</div>
                <span className="text-[11px] text-gray-400 font-medium">Mẫu câu khả dụng</span>
              </div>
              <div className="bg-white border border-blue-100 rounded-2xl p-4 shadow-[0_2px_8px_rgba(0,0,0,0.03)]">
                <span className="text-xs font-semibold text-blue-600 block">Facebook</span>
                <div className="text-2xl font-black text-blue-950 mt-1">
                  {commentTemplates.filter((t) => t.platform === "all" || t.platform === "facebook").length}
                </div>
                <span className="text-[11px] text-blue-500 font-medium">Dùng cho Facebook</span>
              </div>
              <div className="bg-white border border-sky-100 rounded-2xl p-4 shadow-[0_2px_8px_rgba(0,0,0,0.03)]">
                <span className="text-xs font-semibold text-sky-600 block">LinkedIn</span>
                <div className="text-2xl font-black text-sky-950 mt-1">
                  {commentTemplates.filter((t) => t.platform === "all" || t.platform === "linkedin").length}
                </div>
                <span className="text-[11px] text-sky-500 font-medium">Dùng cho LinkedIn</span>
              </div>
              <div className="bg-white border border-red-100 rounded-2xl p-4 shadow-[0_2px_8px_rgba(0,0,0,0.03)]">
                <span className="text-xs font-semibold text-red-600 block">YouTube</span>
                <div className="text-2xl font-black text-red-950 mt-1">
                  {commentTemplates.filter((t) => t.platform === "all" || t.platform === "youtube").length}
                </div>
                <span className="text-[11px] text-red-500 font-medium">Dùng cho YouTube</span>
              </div>
              <div className="bg-white border border-emerald-100 rounded-2xl p-4 shadow-[0_2px_8px_rgba(0,0,0,0.03)]">
                <span className="text-xs font-semibold text-emerald-600 block">Zalo / Khác</span>
                <div className="text-2xl font-black text-emerald-950 mt-1">
                  {commentTemplates.filter((t) => t.platform === "all" || t.platform === "zalo").length}
                </div>
                <span className="text-[11px] text-emerald-500 font-medium">Dùng cho Zalo</span>
              </div>
            </div>

            {/* FILTERS & SEARCH BAR */}
            <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-[0_2px_8px_rgba(0,0,0,0.03)] flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-1.5 bg-gray-100/80 p-1 rounded-xl shrink-0">
                {[
                  { id: "all", label: "Tất cả nền tảng" },
                  { id: "facebook", label: "Facebook" },
                  { id: "linkedin", label: "LinkedIn" },
                  { id: "youtube", label: "YouTube" },
                  { id: "zalo", label: "Zalo" },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActivePlatform(tab.id)}
                    className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer whitespace-nowrap ${
                      activePlatform === tab.id
                        ? "bg-white text-gray-900 shadow-xs"
                        : "text-gray-500 hover:text-gray-800 hover:bg-white/50"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-3 flex-1 justify-end min-w-[280px]">
                {availableCommentLabels.length > 0 && (
                  <select
                    value={selectedCommentLabel}
                    onChange={(e) => setSelectedCommentLabel(e.target.value)}
                    className="border border-gray-200 rounded-xl px-3 py-1.5 text-xs font-semibold text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-[#be123c]/20 cursor-pointer"
                  >
                    <option value="all">Tất cả nhãn</option>
                    {availableCommentLabels.map((lbl) => (
                      <option key={lbl} value={lbl}>
                        {lbl}
                      </option>
                    ))}
                  </select>
                )}

                <div className="relative w-full max-w-xs">
                  <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400 text-xs">
                    🔍
                  </span>
                  <input
                    type="text"
                    value={commentSearchQuery}
                    onChange={(e) => setCommentSearchQuery(e.target.value)}
                    placeholder="Tìm kiếm mẫu bình luận..."
                    className="w-full pl-8 pr-4 py-1.5 border border-gray-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-[#be123c]/20 bg-gray-50/50"
                  />
                  {commentSearchQuery && (
                    <button
                      type="button"
                      onClick={() => setCommentSearchQuery("")}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600 text-xs cursor-pointer"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* COMMENTS TABLE */}
            <div className="bg-white rounded-2xl border border-gray-200 shadow-[0_2px_8px_rgba(0,0,0,0.03)] overflow-hidden">
              {isLoadingComments ? (
                <div className="p-12 text-center text-gray-400">
                  <div className="inline-block animate-spin text-2xl mb-2">⌛</div>
                  <p className="text-xs font-bold">Đang tải danh sách mẫu câu...</p>
                </div>
              ) : commentLoadError ? (
                <div className="p-8 text-center text-rose-600 text-xs font-bold">
                  {commentLoadError}
                  <button
                    type="button"
                    onClick={loadCommentTemplates}
                    className="ml-2 underline cursor-pointer text-blue-600"
                  >
                    Thử lại
                  </button>
                </div>
              ) : filteredComments.length === 0 ? (
                <div className="p-12 text-center text-gray-400">
                  <p className="text-sm font-bold text-gray-600 mb-1">Không tìm thấy mẫu câu nào</p>
                  <p className="text-xs">Thử điều chỉnh bộ lọc hoặc tạo mẫu câu mới.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-gray-100 bg-gray-50/70 text-[11px] font-extrabold text-gray-500 uppercase tracking-wider">
                        <th className="py-3 px-4 w-12 text-center">#</th>
                        <th className="py-3 px-4 w-48">Tiêu đề mẫu</th>
                        <th className="py-3 px-4 w-32">Nền tảng</th>
                        <th className="py-3 px-4 w-28">Nhãn</th>
                        <th className="py-3 px-4">Nội dung mẫu bình luận</th>
                        <th className="py-3 px-4 w-32 text-center">Hành động</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 text-xs font-medium text-gray-700">
                      {paginatedComments.map((tpl, index) => {
                        const globalIndex = commentStartIndex + index + 1;
                        return (
                          <tr key={tpl.id} className="hover:bg-gray-50/70 transition">
                            <td className="py-3.5 px-4 text-center text-gray-400 font-bold">
                              <div className="flex items-center justify-center gap-1">
                                <span>{globalIndex}</span>
                                <div className="flex flex-col">
                                  <button
                                    type="button"
                                    onClick={() => handleCommentReorder(tpl.id, "up")}
                                    className="text-[9px] text-gray-400 hover:text-gray-900 leading-none p-0.5 cursor-pointer"
                                    title="Di chuyển lên"
                                  >
                                    ▲
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleCommentReorder(tpl.id, "down")}
                                    className="text-[9px] text-gray-400 hover:text-gray-900 leading-none p-0.5 cursor-pointer"
                                    title="Di chuyển xuống"
                                  >
                                    ▼
                                  </button>
                                </div>
                              </div>
                            </td>
                            <td className="py-3.5 px-4 font-bold text-gray-900">
                              {tpl.title}
                            </td>
                            <td className="py-3.5 px-4">
                              {getPlatformBadge(tpl.platform)}
                            </td>
                            <td className="py-3.5 px-4">
                              <span className="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-gray-100 text-gray-700 border border-gray-200">
                                {tpl.label || "Khác"}
                              </span>
                            </td>
                            <td className="py-3.5 px-4 text-gray-600 max-w-md">
                              <p className="line-clamp-2 text-xs leading-relaxed">{tpl.content}</p>
                            </td>
                            <td className="py-3.5 px-4 text-center">
                              <div className="flex items-center justify-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleCopyText(tpl.content, tpl.title)}
                                  className="p-1.5 hover:bg-gray-100 text-gray-500 hover:text-gray-800 rounded-lg transition cursor-pointer"
                                  title="Sao chép nội dung"
                                >
                                  📋
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openEditCommentModal(tpl)}
                                  className="p-1.5 hover:bg-gray-100 text-blue-600 hover:text-blue-800 rounded-lg transition cursor-pointer"
                                  title="Chỉnh sửa"
                                >
                                  ✏️
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setDeletingComment(tpl)}
                                  className="p-1.5 hover:bg-red-50 text-red-500 hover:text-red-700 rounded-lg transition cursor-pointer"
                                  title="Xóa"
                                >
                                  🗑️
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* COMMENTS PAGINATION */}
              {!isLoadingComments && filteredComments.length > ITEMS_PER_PAGE && (
                <div className="border-t border-gray-100 px-6 py-3 flex items-center justify-between text-xs text-gray-500">
                  <div>
                    Hiển thị <span className="font-bold">{commentStartIndex + 1}</span> -{" "}
                    <span className="font-bold">{Math.min(commentStartIndex + ITEMS_PER_PAGE, filteredComments.length)}</span> trong{" "}
                    <span className="font-bold">{filteredComments.length}</span> mẫu câu
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={commentCurrentPage === 1}
                      onClick={() => setCommentCurrentPage((p) => Math.max(1, p - 1))}
                      className="px-2.5 py-1 rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50 cursor-pointer disabled:cursor-not-allowed"
                    >
                      Trước
                    </button>
                    {Array.from({ length: totalCommentPages }, (_, i) => i + 1).map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setCommentCurrentPage(p)}
                        className={`w-7 h-7 rounded-lg text-xs font-bold cursor-pointer ${
                          commentCurrentPage === p
                            ? "bg-[#be123c] text-white"
                            : "border border-gray-200 hover:bg-gray-50 text-gray-700"
                        }`}
                      >
                        {p}
                      </button>
                    ))}
                    <button
                      type="button"
                      disabled={commentCurrentPage === totalCommentPages}
                      onClick={() => setCommentCurrentPage((p) => Math.min(totalCommentPages, p + 1))}
                      className="px-2.5 py-1 rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50 cursor-pointer disabled:cursor-not-allowed"
                    >
                      Sau
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════════ */}
        {/* CONTENT FOR TAB 2: THƯ VIỆN MẪU INBOX (ZALO & TƯ VẤN) */}
        {/* ══════════════════════════════════════════════════════════════════════ */}
        {activeMainTab === "inbox" && (
          <div className="space-y-6 animate-in fade-in duration-150">
            {/* TITLE & ACTIONS */}
            <div className="flex flex-col sm:flex-row justify-between gap-4 sm:items-center">
              <div>
                <h1 className="text-[22px] m-0 mb-[4px] font-extrabold text-[#0f172a] flex items-center gap-2">
                  <span>Thư viện mẫu tin nhắn Inbox</span>
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-sky-100 text-sky-800 border border-sky-300">
                    Zalo 1-Click
                  </span>
                </h1>
                <p className="m-0 text-[#64748b] text-[13px]">
                  Quản lý kịch bản tin nhắn mẫu chào hỏi, tư vấn và báo giá cho khách hàng qua Zalo. Nhân viên có thể nhấn click chọn nhanh trong hộp thoại tin nhắn.
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <button
                  type="button"
                  onClick={openAddInboxModal}
                  className="px-4 py-2.5 bg-sky-600 hover:bg-sky-500 text-white rounded-xl text-[13px] font-bold shadow-sm transition flex items-center gap-2 cursor-pointer"
                >
                  <span className="text-base font-bold">+</span> Thêm mẫu inbox mới
                </button>
              </div>
            </div>

            {/* STATS CARDS FOR INBOX */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
              <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-[0_2px_8px_rgba(0,0,0,0.03)]">
                <span className="text-xs font-semibold text-gray-500 block">Tổng mẫu inbox</span>
                <div className="text-2xl font-black text-gray-900 mt-1">{inboxTemplates.length}</div>
                <span className="text-[11px] text-gray-400 font-medium">Sẵn sàng click nhanh</span>
              </div>
              <div className="bg-white border border-emerald-100 rounded-2xl p-4 shadow-[0_2px_8px_rgba(0,0,0,0.03)]">
                <span className="text-xs font-semibold text-emerald-600 block">Lời chào mở đầu</span>
                <div className="text-2xl font-black text-emerald-950 mt-1">
                  {inboxTemplates.filter((t) => (t.label || "").toLowerCase().includes("chào")).length}
                </div>
                <span className="text-[11px] text-emerald-500 font-medium">Chào hỏi Zalo</span>
              </div>
              <div className="bg-white border border-sky-100 rounded-2xl p-4 shadow-[0_2px_8px_rgba(0,0,0,0.03)]">
                <span className="text-xs font-semibold text-sky-600 block">Tư vấn báo giá</span>
                <div className="text-2xl font-black text-sky-950 mt-1">
                  {inboxTemplates.filter((t) => (t.label || "").toLowerCase().includes("giá") || (t.label || "").toLowerCase().includes("tư vấn")).length}
                </div>
                <span className="text-[11px] text-sky-500 font-medium">Báo giá giải pháp</span>
              </div>
              <div className="bg-white border border-amber-100 rounded-2xl p-4 shadow-[0_2px_8px_rgba(0,0,0,0.03)]">
                <span className="text-xs font-semibold text-amber-600 block">Chăm sóc & Follow-up</span>
                <div className="text-2xl font-black text-amber-950 mt-1">
                  {inboxTemplates.filter((t) => (t.label || "").toLowerCase().includes("chăm sóc") || (t.label || "").toLowerCase().includes("follow")).length}
                </div>
                <span className="text-[11px] text-amber-500 font-medium">Nuôi dưỡng khách</span>
              </div>
            </div>

            {/* FILTERS & SEARCH BAR FOR INBOX */}
            <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-[0_2px_8px_rgba(0,0,0,0.03)] flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-1.5 bg-gray-100/80 p-1 rounded-xl shrink-0 overflow-x-auto max-w-full">
                <button
                  type="button"
                  onClick={() => setSelectedInboxLabel("all")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer whitespace-nowrap ${
                    selectedInboxLabel === "all"
                      ? "bg-white text-gray-900 shadow-xs"
                      : "text-gray-500 hover:text-gray-800 hover:bg-white/50"
                  }`}
                >
                  Tất cả nhãn ({inboxTemplates.length})
                </button>
                {availableInboxLabels.map((lbl) => (
                  <button
                    key={lbl}
                    type="button"
                    onClick={() => setSelectedInboxLabel(lbl)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer whitespace-nowrap ${
                      selectedInboxLabel === lbl
                        ? "bg-white text-gray-900 shadow-xs"
                        : "text-gray-500 hover:text-gray-800 hover:bg-white/50"
                    }`}
                  >
                    {lbl}
                  </button>
                ))}
              </div>

              <div className="relative w-full max-w-xs shrink-0">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400 text-xs">
                  🔍
                </span>
                <input
                  type="text"
                  value={inboxSearchQuery}
                  onChange={(e) => setInboxSearchQuery(e.target.value)}
                  placeholder="Tìm kiếm mẫu inbox Zalo..."
                  className="w-full pl-8 pr-4 py-1.5 border border-gray-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-sky-500/20 bg-gray-50/50"
                />
                {inboxSearchQuery && (
                  <button
                    type="button"
                    onClick={() => setInboxSearchQuery("")}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600 text-xs cursor-pointer"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>

            {/* INBOX TEMPLATES TABLE */}
            <div className="bg-white rounded-2xl border border-gray-200 shadow-[0_2px_8px_rgba(0,0,0,0.03)] overflow-hidden">
              {isLoadingInbox ? (
                <div className="p-12 text-center text-gray-400">
                  <div className="inline-block animate-spin text-2xl mb-2">⌛</div>
                  <p className="text-xs font-bold">Đang tải danh sách mẫu inbox...</p>
                </div>
              ) : inboxLoadError ? (
                <div className="p-8 text-center text-rose-600 text-xs font-bold">
                  {inboxLoadError}
                  <button
                    type="button"
                    onClick={loadInboxTemplates}
                    className="ml-2 underline cursor-pointer text-blue-600"
                  >
                    Thử lại
                  </button>
                </div>
              ) : filteredInbox.length === 0 ? (
                <div className="p-12 text-center text-gray-400">
                  <p className="text-sm font-bold text-gray-600 mb-1">Chưa có mẫu inbox nào</p>
                  <p className="text-xs">Bấm nút "+ Thêm mẫu inbox mới" để tạo kịch bản tin nhắn Zalo đầu tiên!</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-gray-100 bg-sky-50/40 text-[11px] font-extrabold text-sky-900 uppercase tracking-wider">
                        <th className="py-3 px-4 w-12 text-center">#</th>
                        <th className="py-3 px-4 w-52">Tiêu đề mẫu tin</th>
                        <th className="py-3 px-4 w-32">Phân loại</th>
                        <th className="py-3 px-4">Nội dung tin nhắn Zalo gửi khách</th>
                        <th className="py-3 px-4 w-36 text-center">Hành động</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 text-xs font-medium text-gray-700">
                      {paginatedInbox.map((tpl, index) => {
                        const globalIndex = inboxStartIndex + index + 1;
                        return (
                          <tr key={tpl.id} className="hover:bg-sky-50/30 transition">
                            <td className="py-3.5 px-4 text-center text-gray-400 font-bold">
                              <div className="flex items-center justify-center gap-1">
                                <span>{globalIndex}</span>
                                <div className="flex flex-col">
                                  <button
                                    type="button"
                                    onClick={() => handleInboxReorder(tpl.id, "up")}
                                    className="text-[9px] text-gray-400 hover:text-gray-900 leading-none p-0.5 cursor-pointer"
                                    title="Di chuyển lên"
                                  >
                                    ▲
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleInboxReorder(tpl.id, "down")}
                                    className="text-[9px] text-gray-400 hover:text-gray-900 leading-none p-0.5 cursor-pointer"
                                    title="Di chuyển xuống"
                                  >
                                    ▼
                                  </button>
                                </div>
                              </div>
                            </td>
                            <td className="py-3.5 px-4 font-bold text-gray-900">
                              <div className="flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-sky-500"></span>
                                <span>{tpl.title}</span>
                              </div>
                            </td>
                            <td className="py-3.5 px-4">
                              {getInboxLabelBadge(tpl.label)}
                            </td>
                            <td className="py-3.5 px-4 text-gray-600 max-w-lg">
                              <div className="bg-gray-50/80 rounded-xl p-2.5 border border-gray-100">
                                <p className="text-xs leading-relaxed whitespace-pre-wrap">{tpl.content}</p>
                                {tpl.content.includes("{group_name}") && (
                                  <span className="inline-block mt-1 text-[10px] font-semibold text-sky-600 bg-sky-50 px-2 py-0.5 rounded border border-sky-200">
                                    Biến tự động: &#123;group_name&#125;
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-3.5 px-4 text-center">
                              <div className="flex items-center justify-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => handleCopyText(tpl.content, tpl.title)}
                                  className="px-2.5 py-1.5 bg-sky-50 hover:bg-sky-100 text-sky-700 font-bold rounded-lg transition cursor-pointer flex items-center gap-1 text-[11px]"
                                  title="Sao chép nhanh để gửi khách"
                                >
                                  <span>📋</span> Copy
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openEditInboxModal(tpl)}
                                  className="p-1.5 hover:bg-gray-100 text-blue-600 hover:text-blue-800 rounded-lg transition cursor-pointer"
                                  title="Chỉnh sửa mẫu"
                                >
                                  ✏️
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setDeletingInbox(tpl)}
                                  className="p-1.5 hover:bg-red-50 text-red-500 hover:text-red-700 rounded-lg transition cursor-pointer"
                                  title="Xóa mẫu"
                                >
                                  🗑️
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* INBOX PAGINATION */}
              {!isLoadingInbox && filteredInbox.length > ITEMS_PER_PAGE && (
                <div className="border-t border-gray-100 px-6 py-3 flex items-center justify-between text-xs text-gray-500">
                  <div>
                    Hiển thị <span className="font-bold">{inboxStartIndex + 1}</span> -{" "}
                    <span className="font-bold">{Math.min(inboxStartIndex + ITEMS_PER_PAGE, filteredInbox.length)}</span> trong{" "}
                    <span className="font-bold">{filteredInbox.length}</span> mẫu inbox
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={inboxCurrentPage === 1}
                      onClick={() => setInboxCurrentPage((p) => Math.max(1, p - 1))}
                      className="px-2.5 py-1 rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50 cursor-pointer disabled:cursor-not-allowed"
                    >
                      Trước
                    </button>
                    {Array.from({ length: totalInboxPages }, (_, i) => i + 1).map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setInboxCurrentPage(p)}
                        className={`w-7 h-7 rounded-lg text-xs font-bold cursor-pointer ${
                          inboxCurrentPage === p
                            ? "bg-sky-600 text-white"
                            : "border border-gray-200 hover:bg-gray-50 text-gray-700"
                        }`}
                      >
                        {p}
                      </button>
                    ))}
                    <button
                      type="button"
                      disabled={inboxCurrentPage === totalInboxPages}
                      onClick={() => setInboxCurrentPage((p) => Math.min(totalInboxPages, p + 1))}
                      className="px-2.5 py-1 rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50 cursor-pointer disabled:cursor-not-allowed"
                    >
                      Sau
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* MODAL: ADD / EDIT COMMENT */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {isCommentModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-extrabold text-base text-gray-900">
                {editingComment ? "Chỉnh sửa mẫu bình luận" : "Thêm mẫu bình luận mới"}
              </h3>
              <button
                type="button"
                onClick={() => setIsCommentModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 text-lg cursor-pointer"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleCommentSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  Tiêu đề mẫu câu <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={commentFormData.title}
                  onChange={(e) => setCommentFormData({ ...commentFormData, title: e.target.value })}
                  placeholder="Ví dụ: Khen ngợi bài viết bổ ích"
                  className="w-full px-3.5 py-2 border border-gray-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-[#be123c]/20"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">Nền tảng</label>
                  <select
                    value={commentFormData.platform}
                    onChange={(e) => setCommentFormData({ ...commentFormData, platform: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs font-semibold text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-[#be123c]/20 cursor-pointer"
                  >
                    <option value="all">Tất cả nền tảng</option>
                    <option value="facebook">Facebook</option>
                    <option value="linkedin">LinkedIn</option>
                    <option value="youtube">YouTube</option>
                    <option value="zalo">Zalo</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">Nhãn / Phân loại</label>
                  <input
                    type="text"
                    value={commentFormData.label}
                    onChange={(e) => setCommentFormData({ ...commentFormData, label: e.target.value })}
                    placeholder="Khen ngợi, Đặt câu hỏi, Giới thiệu..."
                    className="w-full px-3.5 py-2 border border-gray-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-[#be123c]/20"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  Nội dung bình luận <span className="text-red-500">*</span>
                </label>
                <textarea
                  rows={4}
                  required
                  value={commentFormData.content}
                  onChange={(e) => setCommentFormData({ ...commentFormData, content: e.target.value })}
                  placeholder="Nhập nội dung mẫu bình luận..."
                  className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-[#be123c]/20 leading-relaxed resize-none"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsCommentModalOpen(false)}
                  className="px-4 py-2 border border-gray-200 text-gray-600 rounded-xl text-xs font-bold hover:bg-gray-50 transition cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingComment}
                  className="px-4 py-2 bg-[#be123c] hover:bg-[#9f1239] text-white rounded-xl text-xs font-bold shadow-sm transition cursor-pointer disabled:opacity-50"
                >
                  {isSubmittingComment ? "Đang lưu..." : editingComment ? "Cập nhật" : "Tạo mẫu"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* MODAL: ADD / EDIT INBOX TEMPLATE */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {isInboxModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-sky-50/50">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-sky-600"></span>
                <h3 className="font-extrabold text-base text-gray-900">
                  {editingInbox ? "Chỉnh sửa mẫu tin nhắn Inbox Zalo" : "Thêm mẫu tin nhắn Inbox Zalo mới"}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsInboxModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 text-lg cursor-pointer"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleInboxSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  Tiêu đề mẫu tin nhắn <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={inboxFormData.title}
                  onChange={(e) => setInboxFormData({ ...inboxFormData, title: e.target.value })}
                  placeholder="Ví dụ: Lời chào khách thiết kế web trong nhóm"
                  className="w-full px-3.5 py-2 border border-gray-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-sky-500/20"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  Phân loại / Nhãn kịch bản
                </label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {["Chào hỏi", "Tư vấn báo giá", "Chăm sóc khách", "Kịch bản chốt đơn", "Hỏi thăm nhu cầu"].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setInboxFormData({ ...inboxFormData, label: preset })}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition cursor-pointer ${
                        inboxFormData.label === preset
                          ? "bg-sky-600 text-white shadow-2xs"
                          : "bg-gray-100 hover:bg-gray-200 text-gray-700"
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  value={inboxFormData.label}
                  onChange={(e) => setInboxFormData({ ...inboxFormData, label: e.target.value })}
                  placeholder="Nhập hoặc chọn nhãn ở trên..."
                  className="w-full px-3.5 py-2 border border-gray-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-sky-500/20"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-bold text-gray-700">
                    Nội dung tin nhắn Zalo gửi khách <span className="text-red-500">*</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setInboxFormData({
                        ...inboxFormData,
                        content: inboxFormData.content + " {group_name}",
                      });
                    }}
                    className="text-[11px] font-bold text-sky-600 hover:text-sky-800 bg-sky-50 px-2 py-0.5 rounded cursor-pointer"
                    title="Bấm để chèn biến tên nhóm vào vị trí cuối"
                  >
                    + Chèn &#123;group_name&#125;
                  </button>
                </div>
                <textarea
                  rows={4}
                  required
                  value={inboxFormData.content}
                  onChange={(e) => setInboxFormData({ ...inboxFormData, content: e.target.value })}
                  placeholder="Chào bạn, mình thấy bài viết của bạn trong {group_name}. Mình liên hệ qua Zalo để tư vấn và hỗ trợ bạn nhé!"
                  className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-sky-500/20 leading-relaxed resize-none"
                />
                <p className="text-[11px] text-gray-400 mt-1">
                  💡 Mẹo: Dùng <code className="bg-gray-100 px-1 py-0.5 rounded text-sky-700">&#123;group_name&#125;</code> để hệ thống tự động thay bằng tên nhóm Facebook/LinkedIn của bài viết khi nhắn tin.
                </p>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsInboxModalOpen(false)}
                  className="px-4 py-2 border border-gray-200 text-gray-600 rounded-xl text-xs font-bold hover:bg-gray-50 transition cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingInbox}
                  className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-xl text-xs font-bold shadow-sm transition cursor-pointer disabled:opacity-50"
                >
                  {isSubmittingInbox ? "Đang lưu..." : editingInbox ? "Cập nhật" : "Tạo mẫu inbox"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* MODAL: DELETE CONFIRMATION */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {(deletingComment || deletingInbox) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-150 text-center">
            <div className="w-12 h-12 bg-red-100 text-red-600 rounded-full flex items-center justify-center text-xl mx-auto mb-4 font-bold">
              ⚠️
            </div>
            <h3 className="font-extrabold text-base text-gray-900 mb-2">
              Xác nhận xóa mẫu {deletingInbox ? "inbox" : "bình luận"}?
            </h3>
            <p className="text-xs text-gray-500 mb-6">
              Bạn có chắc chắn muốn xóa mẫu &ldquo;
              <span className="font-bold text-gray-800">
                {deletingInbox ? deletingInbox.title : deletingComment?.title}
              </span>
              &rdquo;? Hành động này không thể hoàn tác.
            </p>
            <div className="flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => {
                  setDeletingComment(null);
                  setDeletingInbox(null);
                }}
                className="px-4 py-2 border border-gray-200 text-gray-600 rounded-xl text-xs font-bold hover:bg-gray-50 transition cursor-pointer flex-1"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={isDeletingComment || isDeletingInbox}
                onClick={deletingInbox ? handleDeleteInboxConfirm : handleDeleteCommentConfirm}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold shadow-sm transition cursor-pointer flex-1 disabled:opacity-50"
              >
                {isDeletingComment || isDeletingInbox ? "Đang xóa..." : "Xác nhận xóa"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function QuickCommentsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-[50vh] items-center justify-center">
          <div className="flex items-center gap-3 text-sm text-gray-500 font-medium">
            <span className="inline-block animate-spin text-primary">⌛</span>
            <span>Đang tải thư viện mẫu câu...</span>
          </div>
        </div>
      }
    >
      <QuickCommentsContent />
    </Suspense>
  );
}
