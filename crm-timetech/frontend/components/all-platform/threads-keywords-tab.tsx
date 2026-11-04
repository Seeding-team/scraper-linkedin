"use client";

import React, { useEffect, useState, useMemo, useCallback } from "react";
import { useAppAuth } from "@/contexts/AppAuthContext";
import {
  allPlatformKeywordsService,
  KeywordTopic,
  KeywordItem,
} from "@/services/all-platform.service";

interface ThreadsKeywordsTabProps {
  onTopicCountChange?: (count: number) => void;
}

export function ThreadsKeywordsTab({ onTopicCountChange }: ThreadsKeywordsTabProps) {
  const { user } = useAppAuth();
  const isAdmin = user?.role === "admin";
  const isLeader = user?.role === "leader";

  // Topics state
  const [topics, setTopics] = useState<KeywordTopic[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<"all" | "mine" | "others">("all");

  // Modal: Create Topic
  const [isCreateTopicOpen, setIsCreateTopicOpen] = useState(false);
  const [newTopicName, setNewTopicName] = useState("");
  const [newTopicDesc, setNewTopicDesc] = useState("");
  const [newTopicKeywordsRaw, setNewTopicKeywordsRaw] = useState("");
  const [isCreatingTopic, setIsCreatingTopic] = useState(false);

  // Modal: View Keywords
  const [viewingTopic, setViewingTopic] = useState<KeywordTopic | null>(null);
  const [topicKeywords, setTopicKeywords] = useState<KeywordItem[]>([]);
  const [isLoadingKeywords, setIsLoadingKeywords] = useState(false);
  const [keywordSearch, setKeywordSearch] = useState("");

  // Modal: Add / Contribute Keywords
  const [targetTopicForAdd, setTargetTopicForAdd] = useState<KeywordTopic | null>(null);
  const [rawKeywordsInput, setRawKeywordsInput] = useState("");
  const [isSubmittingKeywords, setIsSubmittingKeywords] = useState(false);

  // Modal: Delete Topic
  const [deletingTopic, setDeletingTopic] = useState<KeywordTopic | null>(null);
  const [isDeletingTopic, setIsDeletingTopic] = useState(false);

  // Toast Notification
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);

  const showToast = (message: string, type: "success" | "error" | "info" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  // Helper: check if a topic is owned by the current user
  const checkIsOwner = useCallback((topic: KeywordTopic): boolean => {
    if (!user) return false;
    if (user.id && topic.app_user_id && String(user.id) === String(topic.app_user_id)) {
      return true;
    }
    if (user.email && topic.creator_email && user.email.toLowerCase() === topic.creator_email.toLowerCase()) {
      return true;
    }
    return false;
  }, [user]);

  // Load all topics
  const loadTopics = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = await allPlatformKeywordsService.getTopics();
      if (res && res.success && Array.isArray(res.data)) {
        setTopics(res.data);
        if (onTopicCountChange) {
          onTopicCountChange(res.data.length);
        }
      } else {
        setLoadError(res?.message || "Không thể tải danh sách chủ đề từ khóa Threads.");
      }
    } catch (err: any) {
      setLoadError(err?.message || "Lỗi khi kết nối với máy chủ.");
    } finally {
      setIsLoading(false);
    }
  }, [onTopicCountChange]);

  useEffect(() => {
    loadTopics();
  }, [loadTopics]);

  // Load keywords when a topic is selected for viewing
  const openViewKeywordsModal = async (topic: KeywordTopic) => {
    setViewingTopic(topic);
    setIsLoadingKeywords(true);
    setKeywordSearch("");
    try {
      const res = await allPlatformKeywordsService.getKeywordsInTopic(topic.id);
      if (res && res.success && Array.isArray(res.data)) {
        setTopicKeywords(res.data);
      } else {
        setTopicKeywords([]);
        showToast(res?.message || "Không thể tải danh sách từ khóa.", "error");
      }
    } catch (err: any) {
      showToast(err?.message || "Lỗi tải từ khóa.", "error");
      setTopicKeywords([]);
    } finally {
      setIsLoadingKeywords(false);
    }
  };

  // Handle Create Topic
  const handleCreateTopic = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTopicName.trim()) {
      showToast("Vui lòng nhập tên chủ đề", "error");
      return;
    }

    const initialKws = newTopicKeywordsRaw
      .split(/[\n,]/)
      .map((k) => k.trim())
      .filter((k) => k.length > 0);

    setIsCreatingTopic(true);
    try {
      const res = await allPlatformKeywordsService.createTopic({
        name: newTopicName.trim(),
        description: newTopicDesc.trim(),
        initial_keywords: initialKws,
      });

      if (res && res.success) {
        showToast(res.message || "Đã tạo chủ đề Threads thành công!", "success");
        setIsCreateTopicOpen(false);
        setNewTopicName("");
        setNewTopicDesc("");
        setNewTopicKeywordsRaw("");
        loadTopics();
      } else {
        showToast(res?.message || "Không thể tạo chủ đề.", "error");
      }
    } catch (err: any) {
      showToast(err?.message || "Lỗi khi tạo chủ đề.", "error");
    } finally {
      setIsCreatingTopic(false);
    }
  };

  // Handle Add / Contribute Keywords
  const handleOpenAddKeywordsModal = (topic: KeywordTopic) => {
    setTargetTopicForAdd(topic);
    setRawKeywordsInput("");
  };

  const handleSubmitAddKeywords = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetTopicForAdd) return;

    const parsedKeywords = rawKeywordsInput
      .split(/[\n,]/)
      .map((k) => k.trim())
      .filter((k) => k.length > 0);

    if (parsedKeywords.length === 0) {
      showToast("Vui lòng nhập ít nhất 1 từ khóa", "error");
      return;
    }

    setIsSubmittingKeywords(true);
    try {
      const res = await allPlatformKeywordsService.addKeywords(targetTopicForAdd.id, parsedKeywords);
      if (res && res.success) {
        const addedCount = res.data?.added_count ?? parsedKeywords.length;
        const isMine = checkIsOwner(targetTopicForAdd);
        showToast(
          isMine
            ? `Đã thêm thành công ${addedCount} từ khóa vào chủ đề!`
            : `Đã đóng góp thành công ${addedCount} từ khóa cho chủ đề! Cảm ơn bạn!`,
          "success"
        );
        setTargetTopicForAdd(null);
        setRawKeywordsInput("");
        loadTopics();
        if (viewingTopic && viewingTopic.id === targetTopicForAdd.id) {
          openViewKeywordsModal(targetTopicForAdd);
        }
      } else {
        showToast(res?.message || "Không thể thêm từ khóa.", "error");
      }
    } catch (err: any) {
      showToast(err?.message || "Lỗi khi thêm từ khóa.", "error");
    } finally {
      setIsSubmittingKeywords(false);
    }
  };

  // Handle Delete Topic
  const handleDeleteTopic = async () => {
    if (!deletingTopic) return;
    setIsDeletingTopic(true);
    try {
      const res = await allPlatformKeywordsService.deleteTopic(deletingTopic.id);
      if (res && res.success) {
        showToast("Đã xóa chủ đề từ khóa thành công", "success");
        setDeletingTopic(null);
        if (viewingTopic && viewingTopic.id === deletingTopic.id) {
          setViewingTopic(null);
        }
        loadTopics();
      } else {
        showToast(res?.message || "Không thể xóa chủ đề.", "error");
      }
    } catch (err: any) {
      showToast(err?.message || "Lỗi khi xóa chủ đề.", "error");
    } finally {
      setIsDeletingTopic(false);
    }
  };

  // Handle Delete Keyword
  const handleDeleteKeyword = async (keywordId: string) => {
    if (!confirm("Bạn có chắc chắn muốn xóa từ khóa này khỏi chủ đề?")) return;
    try {
      const res = await allPlatformKeywordsService.deleteKeyword(keywordId);
      if (res && res.success) {
        showToast("Đã xóa từ khóa", "info");
        setTopicKeywords((prev) => prev.filter((k) => k.id !== keywordId));
        loadTopics();
      } else {
        showToast(res?.message || "Không thể xóa từ khóa.", "error");
      }
    } catch (err: any) {
      showToast(err?.message || "Lỗi khi xóa từ khóa.", "error");
    }
  };

  // Copy keyword helper
  const handleCopy = (text: string, label: string = "từ khóa") => {
    navigator.clipboard.writeText(text);
    showToast(`Đã sao chép ${label} vào bộ nhớ tạm!`, "success");
  };

  // Copy all keywords in viewed topic
  const handleCopyAllKeywords = () => {
    if (topicKeywords.length === 0) return;
    const text = topicKeywords.map((k) => k.keyword).join(", ");
    navigator.clipboard.writeText(text);
    showToast(`Đã sao chép toàn bộ ${topicKeywords.length} từ khóa!`, "success");
  };

  // Filtered topics
  const filteredTopics = useMemo(() => {
    return topics.filter((t) => {
      const isMine = checkIsOwner(t);
      if (filterType === "mine" && !isMine) return false;
      if (filterType === "others" && isMine) return false;

      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase().trim();
      return (
        t.name.toLowerCase().includes(q) ||
        (t.description && t.description.toLowerCase().includes(q)) ||
        t.creator_name.toLowerCase().includes(q) ||
        t.creator_email.toLowerCase().includes(q)
      );
    });
  }, [topics, filterType, searchQuery, checkIsOwner]);

  // KPI calculations
  const totalTopics = topics.length;
  const totalKeywords = useMemo(() => {
    return topics.reduce((acc, t) => acc + (t.keywords_count || 0), 0);
  }, [topics]);
  const myTopicsCount = useMemo(() => {
    return topics.filter((t) => checkIsOwner(t)).length;
  }, [topics, checkIsOwner]);

  // Filtered keywords inside viewed topic
  const filteredViewKeywords = useMemo(() => {
    if (!keywordSearch.trim()) return topicKeywords;
    const q = keywordSearch.toLowerCase().trim();
    return topicKeywords.filter((k) => k.keyword.toLowerCase().includes(q));
  }, [topicKeywords, keywordSearch]);

  // Live parsed count for add modal
  const previewAddCount = useMemo(() => {
    return rawKeywordsInput
      .split(/[\n,]/)
      .map((k) => k.trim())
      .filter((k) => k.length > 0).length;
  }, [rawKeywordsInput]);

  return (
    <div className="space-y-6 pt-2">
      {/* Toast Alert */}
      {toast && (
        <div className="fixed top-5 right-5 z-[100] flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-xl animate-in fade-in slide-in-from-top-2">
          <span
            className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-white ${
              toast.type === "success"
                ? "bg-emerald-600"
                : toast.type === "error"
                ? "bg-rose-600"
                : "bg-blue-600"
            }`}
          >
            {toast.type === "success" ? "✓" : toast.type === "error" ? "✕" : "i"}
          </span>
          <span className="text-sm font-medium text-slate-700">{toast.message}</span>
        </div>
      )}

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="flex items-center gap-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-rose-50 text-[var(--color-markee-primary)]">
            <span className="material-symbols-outlined text-2xl">category</span>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500">Tổng chủ đề Threads</p>
            <p className="text-xl font-bold text-slate-900 dark:text-slate-100">{totalTopics}</p>
          </div>
        </div>

        <div className="flex items-center gap-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
            <span className="material-symbols-outlined text-2xl">key</span>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500">Tổng từ khóa hệ thống</p>
            <p className="text-xl font-bold text-slate-900 dark:text-slate-100">{totalKeywords}</p>
          </div>
        </div>

        <div className="flex items-center gap-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
            <span className="material-symbols-outlined text-2xl">person_pin</span>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500">Chủ đề của tôi</p>
            <p className="text-xl font-bold text-slate-900 dark:text-slate-100">{myTopicsCount}</p>
          </div>
        </div>
      </div>

      {/* Filters & Actions Bar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5 shadow-sm">
        {/* Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          <button
            onClick={() => setFilterType("all")}
            className={`cursor-pointer rounded-xl px-3.5 py-1.5 text-xs font-semibold transition-all ${
              filterType === "all"
                ? "bg-slate-900 text-white shadow-xs"
                : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200/70"
            }`}
          >
            Tất cả chủ đề ({totalTopics})
          </button>
          <button
            onClick={() => setFilterType("mine")}
            className={`cursor-pointer rounded-xl px-3.5 py-1.5 text-xs font-semibold transition-all ${
              filterType === "mine"
                ? "bg-slate-900 text-white shadow-xs"
                : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200/70"
            }`}
          >
            Chủ đề của tôi ({myTopicsCount})
          </button>
          <button
            onClick={() => setFilterType("others")}
            className={`cursor-pointer rounded-xl px-3.5 py-1.5 text-xs font-semibold transition-all ${
              filterType === "others"
                ? "bg-slate-900 text-white shadow-xs"
                : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200/70"
            }`}
          >
            Cộng đồng đóng góp ({totalTopics - myTopicsCount})
          </button>
        </div>

        {/* Search & Add Button */}
        <div className="flex items-center gap-2.5">
          <div className="relative min-w-[240px] flex-1 sm:flex-initial">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">
              search
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tìm kiếm chủ đề, người tạo..."
              className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50 py-1.5 pl-9 pr-4 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:border-[var(--color-markee-primary)] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[var(--color-markee-primary)]"
            />
          </div>
          <button
            onClick={() => setIsCreateTopicOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--color-markee-primary)] px-3.5 py-2 text-xs font-bold text-white shadow-sm transition-all hover:bg-rose-800 hover:shadow active:scale-95 cursor-pointer shrink-0"
          >
            <span>+</span>
            <span>Thêm chủ đề</span>
          </button>
        </div>
      </div>

      {/* Loading & Error States */}
      {isLoading && (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white py-16 shadow-sm">
          <div className="h-9 w-9 animate-spin rounded-full border-3 border-[var(--color-markee-primary)] border-t-transparent" />
          <p className="mt-3 text-xs font-medium text-slate-500">Đang tải danh sách chủ đề Threads...</p>
        </div>
      )}

      {loadError && !isLoading && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50/50 p-6 text-center shadow-sm">
          <span className="material-symbols-outlined text-3xl text-rose-600">error</span>
          <p className="mt-2 text-sm font-semibold text-rose-900">Không thể tải danh sách chủ đề</p>
          <p className="mt-1 text-xs text-rose-600">{loadError}</p>
          <button
            onClick={loadTopics}
            className="mt-4 rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-rose-700"
          >
            Thử lại
          </button>
        </div>
      )}

      {/* Empty State */}
      {!isLoading && !loadError && filteredTopics.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white py-14 text-center shadow-sm">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
            <span className="material-symbols-outlined text-2xl">search_off</span>
          </div>
          <h3 className="mt-3 text-sm font-semibold text-slate-900">Không tìm thấy chủ đề từ khóa nào</h3>
          <p className="mt-1 text-xs text-slate-500 max-w-sm">
            {searchQuery
              ? "Không có chủ đề nào khớp với từ khóa tìm kiếm của bạn."
              : "Chưa có chủ đề nào được tạo. Hãy là người đầu tiên tạo chủ đề từ khóa Threads!"}
          </p>
          <button
            onClick={() => setIsCreateTopicOpen(true)}
            className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-[var(--color-markee-primary)] px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-rose-800 cursor-pointer"
          >
            <span>+ Thêm chủ đề mới</span>
          </button>
        </div>
      )}

      {/* Table List of Topics */}
      {!isLoading && !loadError && filteredTopics.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/50 text-slate-500 font-semibold uppercase tracking-wider">
                  <th className="py-3.5 pl-6 pr-4">Chủ đề từ khóa</th>
                  <th className="px-4 py-3.5">Mô tả</th>
                  <th className="px-4 py-3.5 text-center">Số từ khóa</th>
                  <th className="px-4 py-3.5">Người tạo chủ đề</th>
                  <th className="px-4 py-3.5">Ngày tạo</th>
                  <th className="py-3.5 pl-4 pr-6 text-right">Hành động</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredTopics.map((topic) => {
                  const isMine = checkIsOwner(topic);
                  const canDelete = isMine || isAdmin || isLeader;

                  return (
                    <tr
                      key={topic.id}
                      className="transition-colors hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
                    >
                      {/* Topic Name */}
                      <td className="py-4 pl-6 pr-4">
                        <div className="flex items-start gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-rose-50 text-[var(--color-markee-primary)] font-bold">
                            <span className="material-symbols-outlined text-lg">tag</span>
                          </div>
                          <div className="min-w-0">
                            <p className="font-semibold text-slate-900 dark:text-slate-100 text-sm">{topic.name}</p>
                            {topic.code && (
                              <span className="inline-block rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
                                #{topic.code}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Description */}
                      <td className="px-4 py-4 text-slate-600 dark:text-slate-300 max-w-xs">
                        <p className="line-clamp-2 text-xs">
                          {topic.description || <span className="italic text-slate-400">Không có mô tả</span>}
                        </p>
                      </td>

                      {/* Keywords Count */}
                      <td className="px-4 py-4 text-center">
                        <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-bold text-indigo-700">
                          <span className="material-symbols-outlined text-xs">key</span>
                          <span>{topic.keywords_count} từ khóa</span>
                        </span>
                      </td>

                      {/* Creator */}
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2">
                          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-200 text-xs font-bold text-slate-600">
                            {topic.creator_name ? topic.creator_name.charAt(0).toUpperCase() : "U"}
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-slate-800 dark:text-slate-200 text-xs truncate">
                              {topic.creator_name || "Thành viên hệ thống"}
                              {isMine && (
                                <span className="ml-1.5 rounded bg-rose-100 px-1.5 py-0.2 text-[10px] font-bold text-rose-700">
                                  Bạn
                                </span>
                              )}
                            </p>
                            <p className="text-[11px] text-slate-400 truncate">
                              {topic.creator_email || "Chưa có email"}
                            </p>
                          </div>
                        </div>
                      </td>

                      {/* Created At */}
                      <td className="px-4 py-4 text-slate-500 text-xs">
                        {topic.created_at ? new Date(topic.created_at).toLocaleDateString("vi-VN") : "—"}
                      </td>

                      {/* Action Buttons */}
                      <td className="py-4 pl-4 pr-6 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Button: View Keywords */}
                          <button
                            onClick={() => openViewKeywordsModal(topic)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors shadow-xs cursor-pointer"
                            title="Xem chi tiết các từ khóa trong chủ đề"
                          >
                            <span className="material-symbols-outlined text-sm">visibility</span>
                            <span>Xem từ khóa</span>
                          </button>

                          {/* Button: Add or Contribute */}
                          <button
                            onClick={() => handleOpenAddKeywordsModal(topic)}
                            className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold shadow-xs transition-colors cursor-pointer ${
                              isMine
                                ? "bg-[var(--color-markee-primary)] text-white hover:bg-rose-800"
                                : "bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200"
                            }`}
                            title={isMine ? "Thêm từ khóa vào chủ đề của bạn" : "Đóng góp từ khóa cho cộng đồng"}
                          >
                            <span className="material-symbols-outlined text-sm">
                              {isMine ? "add_circle" : "volunteer_activism"}
                            </span>
                            <span>{isMine ? "Thêm từ khóa" : "Đóng góp từ khóa"}</span>
                          </button>

                          {/* Button: Delete Topic */}
                          {canDelete && (
                            <button
                              onClick={() => setDeletingTopic(topic)}
                              className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition-colors cursor-pointer"
                              title="Xóa chủ đề"
                            >
                              <span className="material-symbols-outlined text-base">delete</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 1: VIEW KEYWORDS IN TOPIC                                          */}
      {/* ========================================================================= */}
      {viewingTopic && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4 animate-in fade-in duration-200">
          <div
            className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 px-6 py-4 bg-slate-50/50 dark:bg-slate-800/50">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-50 text-[var(--color-markee-primary)]">
                  <span className="material-symbols-outlined text-xl">tag</span>
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base leading-tight">
                    {viewingTopic.name}
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {topicKeywords.length} từ khóa được định nghĩa
                  </p>
                </div>
              </div>
              <button
                onClick={() => setViewingTopic(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 cursor-pointer"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {/* Description */}
              {viewingTopic.description && (
                <div className="rounded-xl bg-slate-50 dark:bg-slate-800/40 p-3 text-xs text-slate-600 dark:text-slate-300 border border-slate-100 dark:border-slate-800">
                  {viewingTopic.description}
                </div>
              )}

              {/* Search & Actions Bar */}
              <div className="flex items-center justify-between gap-3">
                <div className="relative flex-1">
                  <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">
                    search
                  </span>
                  <input
                    type="text"
                    value={keywordSearch}
                    onChange={(e) => setKeywordSearch(e.target.value)}
                    placeholder="Lọc từ khóa trong chủ đề..."
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 py-1.5 pl-9 pr-3 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:border-[var(--color-markee-primary)] focus:outline-none"
                  />
                </div>
                <button
                  onClick={handleCopyAllKeywords}
                  disabled={topicKeywords.length === 0}
                  className="inline-flex items-center gap-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 shadow-xs cursor-pointer disabled:opacity-50"
                  title="Sao chép toàn bộ từ khóa dưới dạng danh sách ngăn cách bởi dấu phẩy"
                >
                  <span className="material-symbols-outlined text-sm">content_copy</span>
                  <span>Sao chép tất cả</span>
                </button>
                <button
                  onClick={() => handleOpenAddKeywordsModal(viewingTopic)}
                  className="inline-flex items-center gap-1 rounded-xl bg-[var(--color-markee-primary)] px-3 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-rose-800 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-sm">add</span>
                  <span>Thêm từ khóa</span>
                </button>
              </div>

              {/* Keywords Loading / Content */}
              {isLoadingKeywords ? (
                <div className="flex py-12 items-center justify-center">
                  <div className="h-7 w-7 animate-spin rounded-full border-2 border-[var(--color-markee-primary)] border-t-transparent" />
                </div>
              ) : filteredViewKeywords.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center">
                  <p className="text-xs text-slate-500">
                    {keywordSearch ? "Không có từ khóa nào khớp với tìm kiếm." : "Chưa có từ khóa nào trong chủ đề này."}
                  </p>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2 pt-1">
                  {filteredViewKeywords.map((item) => (
                    <div
                      key={item.id}
                      className="group inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:border-slate-300 transition-all shadow-2xs"
                    >
                      <span className="text-[var(--color-markee-primary)] font-bold">#</span>
                      <span>{item.keyword}</span>
                      <button
                        onClick={() => handleCopy(item.keyword)}
                        className="ml-1 text-slate-400 hover:text-slate-700 transition-colors"
                        title="Sao chép từ khóa"
                      >
                        <span className="material-symbols-outlined text-xs">content_copy</span>
                      </button>
                      {(checkIsOwner(viewingTopic) || isAdmin || isLeader) && (
                        <button
                          onClick={() => handleDeleteKeyword(item.id)}
                          className="text-slate-400 hover:text-rose-600 transition-colors"
                          title="Xóa từ khóa khỏi chủ đề"
                        >
                          <span className="material-symbols-outlined text-xs">close</span>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end border-t border-slate-200 dark:border-slate-800 px-6 py-3.5 bg-slate-50/50 dark:bg-slate-900/50">
              <button
                onClick={() => setViewingTopic(null)}
                className="rounded-xl bg-slate-200 dark:bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-300 cursor-pointer"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 2: ADD / CONTRIBUTE KEYWORDS                                       */}
      {/* ========================================================================= */}
      {targetTopicForAdd && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4 animate-in fade-in duration-200">
          <div
            className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <form onSubmit={handleSubmitAddKeywords}>
              <div className="border-b border-slate-200 dark:border-slate-800 px-6 py-4">
                <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base leading-tight">
                  {checkIsOwner(targetTopicForAdd)
                    ? `Thêm từ khóa vào chủ đề: ${targetTopicForAdd.name}`
                    : `Đóng góp từ khóa cho: ${targetTopicForAdd.name}`}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Nhập các từ khóa liên quan, phân tách bằng dấu phẩy hoặc xuống dòng.
                </p>
              </div>

              <div className="p-6 space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Danh sách từ khóa:
                    </label>
                    <span className="text-[11px] font-medium text-indigo-600">
                      Đã phát hiện: {previewAddCount} từ khóa
                    </span>
                  </div>
                  <textarea
                    rows={6}
                    value={rawKeywordsInput}
                    onChange={(e) => setRawKeywordsInput(e.target.value)}
                    placeholder="Ví dụ:&#10;thiết kế web giá rẻ&#10;làm website chuẩn seo&#10;tạo landing page bán hàng, code reactjs"
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3 text-xs text-slate-800 dark:text-slate-100 focus:border-[var(--color-markee-primary)] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[var(--color-markee-primary)]"
                    required
                  />
                  <p className="mt-1.5 text-[11px] text-slate-400">
                    Mẹo: Bạn có thể dán danh sách hàng chục từ khóa cùng lúc, hệ thống sẽ tự động lọc trùng và chuẩn hóa.
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-slate-200 dark:border-slate-800 px-6 py-3.5 bg-slate-50/50 dark:bg-slate-900/50">
                <button
                  type="button"
                  onClick={() => setTargetTopicForAdd(null)}
                  disabled={isSubmittingKeywords}
                  className="rounded-xl px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingKeywords || previewAddCount === 0}
                  className="rounded-xl bg-[var(--color-markee-primary)] px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-rose-800 cursor-pointer disabled:opacity-50"
                >
                  {isSubmittingKeywords ? "Đang xử lý..." : "Xác nhận thêm"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 3: CREATE TOPIC                                                    */}
      {/* ========================================================================= */}
      {isCreateTopicOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4 animate-in fade-in duration-200">
          <div
            className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <form onSubmit={handleCreateTopic}>
              <div className="border-b border-slate-200 dark:border-slate-800 px-6 py-4">
                <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base leading-tight">
                  Tạo chủ đề từ khóa Threads mới
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Tạo chủ đề tập trung các từ khóa phục vụ cào bài và seeding Threads.
                </p>
              </div>

              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Tên chủ đề từ khóa *
                  </label>
                  <input
                    type="text"
                    value={newTopicName}
                    onChange={(e) => setNewTopicName(e.target.value)}
                    placeholder="Ví dụ: Thiết kế Website & SEO..."
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2 text-xs text-slate-900 dark:text-slate-100 focus:border-[var(--color-markee-primary)] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[var(--color-markee-primary)]"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Mô tả chủ đề
                  </label>
                  <textarea
                    rows={2}
                    value={newTopicDesc}
                    onChange={(e) => setNewTopicDesc(e.target.value)}
                    placeholder="Mô tả mục đích sử dụng các từ khóa trong chủ đề này..."
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2 text-xs text-slate-900 dark:text-slate-100 focus:border-[var(--color-markee-primary)] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[var(--color-markee-primary)]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Từ khóa ban đầu (tùy chọn)
                  </label>
                  <textarea
                    rows={4}
                    value={newTopicKeywordsRaw}
                    onChange={(e) => setNewTopicKeywordsRaw(e.target.value)}
                    placeholder="Nhập các từ khóa ban đầu, cách nhau bằng dấu phẩy hoặc xuống dòng..."
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2 text-xs text-slate-900 dark:text-slate-100 focus:border-[var(--color-markee-primary)] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[var(--color-markee-primary)]"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-slate-200 dark:border-slate-800 px-6 py-3.5 bg-slate-50/50 dark:bg-slate-900/50">
                <button
                  type="button"
                  onClick={() => setIsCreateTopicOpen(false)}
                  disabled={isCreatingTopic}
                  className="rounded-xl px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={isCreatingTopic}
                  className="rounded-xl bg-[var(--color-markee-primary)] px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-rose-800 cursor-pointer disabled:opacity-50"
                >
                  {isCreatingTopic ? "Đang tạo..." : "Tạo chủ đề"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 4: DELETE TOPIC                                                    */}
      {/* ========================================================================= */}
      {deletingTopic && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4 animate-in fade-in duration-200">
          <div
            className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 text-rose-600">
              <span className="material-symbols-outlined text-3xl">warning</span>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Xác nhận xóa chủ đề từ khóa
              </h3>
            </div>
            <p className="mt-3 text-xs text-slate-600 dark:text-slate-300">
              Bạn có chắc chắn muốn xóa chủ đề <strong>"{deletingTopic.name}"</strong>? Toàn bộ các từ khóa trực thuộc chủ đề này cũng sẽ bị xóa. Thao tác này không thể hoàn tác.
            </p>
            <div className="mt-6 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeletingTopic(null)}
                disabled={isDeletingTopic}
                className="rounded-xl px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleDeleteTopic}
                disabled={isDeletingTopic}
                className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-rose-700 cursor-pointer disabled:opacity-50"
              >
                {isDeletingTopic ? "Đang xóa..." : "Xóa vĩnh viễn"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


