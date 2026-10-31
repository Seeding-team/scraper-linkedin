"use client";

import React, { useEffect, useState, useMemo, useCallback } from "react";
import Link from "next/link";
import { useAppAuth } from "@/contexts/AppAuthContext";
import {
  allPlatformKeywordsService,
  KeywordTopic,
  KeywordItem,
} from "@/services/all-platform.service";

export default function KeywordsLibraryPage() {
  const { user, isAdmin, isLeader } = useAppAuth();

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
      } else {
        setLoadError(res?.message || "Không thể tải danh sách chủ đề từ khóa.");
      }
    } catch (err: any) {
      setLoadError(err?.message || "Lỗi khi kết nối với máy chủ.");
    } finally {
      setIsLoading(false);
    }
  }, []);

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
        showToast(res.message || "Đã tạo chủ đề từ khóa thành công!", "success");
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
        // If viewing modal is open for this topic, refresh its keywords
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
    <div className="min-h-screen bg-slate-50/60 pb-16 font-sans text-slate-800">
      {/* Toast Alert */}
      {toast && (
        <div className="fixed top-5 right-5 z-50 flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-xl animate-in fade-in slide-in-from-top-2">
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

      {/* Header Banner */}
      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-markee-primary)]">
                <span>Thư viện & Công cụ</span>
                <span>/</span>
                <span>Từ khóa Seeding & Social</span>
              </div>
              <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
                Thư viện từ khóa
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                Quản lý các loại từ khóa theo chủ đề, đóng góp từ khóa cộng đồng và hỗ trợ cào bài viết chuẩn xác.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={() => setIsCreateTopicOpen(true)}
                className="inline-flex items-center gap-2 rounded-xl bg-[var(--color-markee-primary)] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-rose-800 hover:shadow active:scale-95"
              >
                <span className="text-lg leading-none">+</span>
                <span>Thêm chủ đề mới</span>
              </button>
            </div>
          </div>

          {/* KPI Summary Cards */}
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-rose-50 text-[var(--color-markee-primary)]">
                <span className="material-symbols-outlined text-2xl">category</span>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Tổng chủ đề</p>
                <p className="text-xl font-bold text-slate-900">{totalTopics}</p>
              </div>
            </div>

            <div className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                <span className="material-symbols-outlined text-2xl">key</span>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Tổng từ khóa hệ thống</p>
                <p className="text-xl font-bold text-slate-900">{totalKeywords}</p>
              </div>
            </div>

            <div className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                <span className="material-symbols-outlined text-2xl">person_pin</span>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Chủ đề của tôi</p>
                <p className="text-xl font-bold text-slate-900">{myTopicsCount}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Filters and Search Bar */}
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setFilterType("all")}
              className={`rounded-lg px-3.5 py-1.5 text-xs font-medium transition-all ${
                filterType === "all"
                  ? "bg-slate-900 text-white shadow-sm"
                  : "bg-white text-slate-600 hover:bg-slate-100 border border-slate-200"
              }`}
            >
              Tất cả chủ đề ({totalTopics})
            </button>
            <button
              onClick={() => setFilterType("mine")}
              className={`rounded-lg px-3.5 py-1.5 text-xs font-medium transition-all ${
                filterType === "mine"
                  ? "bg-[var(--color-markee-primary)] text-white shadow-sm"
                  : "bg-white text-slate-600 hover:bg-slate-100 border border-slate-200"
              }`}
            >
              Chủ đề của tôi ({myTopicsCount})
            </button>
            <button
              onClick={() => setFilterType("others")}
              className={`rounded-lg px-3.5 py-1.5 text-xs font-medium transition-all ${
                filterType === "others"
                  ? "bg-slate-900 text-white shadow-sm"
                  : "bg-white text-slate-600 hover:bg-slate-100 border border-slate-200"
              }`}
            >
              Cộng đồng đóng góp ({totalTopics - myTopicsCount})
            </button>
          </div>

          <div className="relative min-w-[280px]">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tìm kiếm chủ đề, người tạo..."
              className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-4 text-xs text-slate-900 placeholder:text-slate-400 focus:border-[var(--color-markee-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-markee-primary)] shadow-sm"
            />
            <span className="material-symbols-outlined pointer-events-none absolute left-2.5 top-2.5 text-base text-slate-400">
              search
            </span>
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-2.5 text-xs text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Loading / Error States */}
        {isLoading && (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white py-16 shadow-sm">
            <div className="h-8 w-8 animate-spin rounded-full border-3 border-[var(--color-markee-primary)] border-t-transparent" />
            <p className="mt-4 text-xs font-medium text-slate-500">Đang tải danh sách chủ đề từ khóa...</p>
          </div>
        )}

        {loadError && !isLoading && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center shadow-sm">
            <p className="text-sm font-semibold text-rose-700">{loadError}</p>
            <button
              onClick={loadTopics}
              className="mt-3 rounded-lg bg-rose-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-rose-700"
            >
              Thử lại
            </button>
          </div>
        )}

        {/* Empty State */}
        {!isLoading && !loadError && filteredTopics.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white py-16 text-center shadow-sm">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-400">
              <span className="material-symbols-outlined text-3xl">key_off</span>
            </div>
            <h3 className="mt-4 text-sm font-semibold text-slate-900">Không tìm thấy chủ đề từ khóa nào</h3>
            <p className="mt-1 text-xs text-slate-500 max-w-sm">
              {searchQuery
                ? "Không có chủ đề nào khớp với từ khóa tìm kiếm của bạn."
                : "Chưa có chủ đề nào được tạo. Hãy là người đầu tiên tạo chủ đề từ khóa!"}
            </p>
            <button
              onClick={() => setIsCreateTopicOpen(true)}
              className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-[var(--color-markee-primary)] px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-rose-800"
            >
              <span>+ Thêm chủ đề mới</span>
            </button>
          </div>
        )}

        {/* Table List of Topics */}
        {!isLoading && !loadError && filteredTopics.length > 0 && (
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/80 text-slate-500 font-semibold uppercase tracking-wider">
                    <th className="py-3.5 pl-6 pr-4">Chủ đề từ khóa</th>
                    <th className="px-4 py-3.5">Mô tả</th>
                    <th className="px-4 py-3.5 text-center">Số từ khóa</th>
                    <th className="px-4 py-3.5">Người tạo chủ đề</th>
                    <th className="px-4 py-3.5">Ngày tạo</th>
                    <th className="py-3.5 pl-4 pr-6 text-right">Hành động</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredTopics.map((topic) => {
                    const isMine = checkIsOwner(topic);
                    const canDelete = isMine || isAdmin || isLeader;

                    return (
                      <tr
                        key={topic.id}
                        className="transition-colors hover:bg-slate-50/70"
                      >
                        {/* Topic Name */}
                        <td className="py-4 pl-6 pr-4">
                          <div className="flex items-start gap-3">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-rose-50 text-[var(--color-markee-primary)] font-bold">
                              <span className="material-symbols-outlined text-lg">tag</span>
                            </div>
                            <div className="min-w-0">
                              <p className="font-semibold text-slate-900 text-sm">{topic.name}</p>
                              {topic.code && (
                                <span className="inline-block rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
                                  #{topic.code}
                                </span>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* Description */}
                        <td className="px-4 py-4 text-slate-600 max-w-xs">
                          <p className="line-clamp-2 text-xs">
                            {topic.description || <span className="text-slate-400 italic">Chưa có mô tả</span>}
                          </p>
                        </td>

                        {/* Keywords Count */}
                        <td className="px-4 py-4 text-center">
                          <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-1 font-semibold text-indigo-700">
                            <span className="material-symbols-outlined text-xs">key</span>
                            <span>{topic.keywords_count} từ khóa</span>
                          </span>
                        </td>

                        {/* Creator Column (Mandatory requirement from Master) */}
                        <td className="px-4 py-4">
                          <div className="flex items-center gap-2.5">
                            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-200 text-slate-700 font-bold uppercase text-[11px]">
                              {topic.creator_avatar ? (
                                <img
                                  src={topic.creator_avatar}
                                  alt={topic.creator_name}
                                  className="h-7 w-7 rounded-full object-cover"
                                />
                              ) : (
                                (topic.creator_name || "U").charAt(0)
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="font-medium text-slate-900 truncate">
                                  {topic.creator_name}
                                </span>
                                {isMine && (
                                  <span className="rounded bg-rose-100 px-1.5 py-0.2 text-[10px] font-semibold text-[var(--color-markee-primary)]">
                                    Bạn
                                  </span>
                                )}
                              </div>
                              <span className="block text-[11px] text-slate-400 truncate">
                                {topic.creator_email || "Chưa có email"}
                              </span>
                            </div>
                          </div>
                        </td>

                        {/* Created Date */}
                        <td className="px-4 py-4 text-slate-500 text-xs whitespace-nowrap">
                          {topic.created_at ? new Date(topic.created_at).toLocaleDateString("vi-VN", {
                            day: "2-digit",
                            month: "2-digit",
                            year: "numeric",
                          }) : "—"}
                        </td>

                        {/* Actions */}
                        <td className="py-4 pl-4 pr-6 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-2">
                            {/* Nút Xem từ khóa */}
                            <button
                              onClick={() => openViewKeywordsModal(topic)}
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition hover:bg-slate-100 hover:text-slate-900"
                              title="Xem danh sách từ khóa trong chủ đề"
                            >
                              <span className="material-symbols-outlined text-sm text-slate-500">visibility</span>
                              <span>Xem từ khóa</span>
                            </button>

                            {/* Nút Thêm từ khóa (nếu là chủ đề của tôi) HOẶC Đóng góp từ khóa (nếu là chủ đề người khác) */}
                            {isMine ? (
                              <button
                                onClick={() => handleOpenAddKeywordsModal(topic)}
                                className="inline-flex items-center gap-1 rounded-lg bg-[var(--color-markee-primary)] px-2.5 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-rose-800"
                                title="Thêm từ khóa vào chủ đề của bạn"
                              >
                                <span className="material-symbols-outlined text-sm">add_circle</span>
                                <span>Thêm từ khóa</span>
                              </button>
                            ) : (
                              <button
                                onClick={() => handleOpenAddKeywordsModal(topic)}
                                className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-xs font-medium text-indigo-700 shadow-sm transition hover:bg-indigo-100"
                                title="Đóng góp thêm từ khóa mới cho chủ đề này"
                              >
                                <span className="material-symbols-outlined text-sm">volunteer_activism</span>
                                <span>Đóng góp từ khóa</span>
                              </button>
                            )}

                            {/* Nút Xóa chủ đề (chỉ hiện cho người tạo hoặc admin) */}
                            {canDelete && (
                              <button
                                onClick={() => setDeletingTopic(topic)}
                                className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition"
                                title="Xóa chủ đề"
                              >
                                <span className="material-symbols-outlined text-sm">delete</span>
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

            {/* Table Footer */}
            <div className="border-t border-slate-200 bg-slate-50/50 px-6 py-3 text-xs text-slate-500">
              Hiển thị <span className="font-semibold text-slate-700">{filteredTopics.length}</span> chủ đề từ khóa
            </div>
          </div>
        )}
      </div>

      {/* MODAL 1: VIEW KEYWORDS IN TOPIC */}
      {viewingTopic && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm animate-in fade-in">
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-2xl animate-in zoom-in-95">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-50 text-[var(--color-markee-primary)]">
                  <span className="material-symbols-outlined text-xl">folder_special</span>
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    Từ khóa: {viewingTopic.name}
                  </h3>
                  <p className="text-xs text-slate-500">
                    Người tạo chủ đề: <span className="font-medium text-slate-700">{viewingTopic.creator_name}</span>
                    {checkIsOwner(viewingTopic) && " (Bạn)"}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setViewingTopic(null)}
                className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-6">
              {/* Actions & Search inside Modal */}
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="relative flex-1">
                  <input
                    type="text"
                    value={keywordSearch}
                    onChange={(e) => setKeywordSearch(e.target.value)}
                    placeholder="Lọc từ khóa trong chủ đề này..."
                    className="w-full rounded-xl border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-[var(--color-markee-primary)] focus:outline-none"
                  />
                  <span className="material-symbols-outlined pointer-events-none absolute left-2 top-2 text-sm text-slate-400">
                    search
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCopyAllKeywords}
                    disabled={topicKeywords.length === 0}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                  >
                    <span className="material-symbols-outlined text-xs">content_copy</span>
                    <span>Sao chép tất cả ({topicKeywords.length})</span>
                  </button>

                  <button
                    onClick={() => handleOpenAddKeywordsModal(viewingTopic)}
                    className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm ${
                      checkIsOwner(viewingTopic)
                        ? "bg-[var(--color-markee-primary)] hover:bg-rose-800"
                        : "bg-indigo-600 hover:bg-indigo-700"
                    }`}
                  >
                    <span className="text-sm leading-none">+</span>
                    <span>{checkIsOwner(viewingTopic) ? "Thêm từ khóa" : "Đóng góp"}</span>
                  </button>
                </div>
              </div>

              {/* Keywords Tag Cloud / List */}
              {isLoadingKeywords ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--color-markee-primary)] border-t-transparent" />
                  <p className="mt-2 text-xs text-slate-400">Đang tải danh sách từ khóa...</p>
                </div>
              ) : filteredViewKeywords.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 py-12 text-center">
                  <span className="material-symbols-outlined text-2xl text-slate-300">key_off</span>
                  <p className="mt-2 text-xs font-medium text-slate-500">
                    Chủ đề này chưa có từ khóa nào.
                  </p>
                  <button
                    onClick={() => handleOpenAddKeywordsModal(viewingTopic)}
                    className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-markee-primary)] hover:underline"
                  >
                    <span>+ Thêm từ khóa ngay bây giờ</span>
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {filteredViewKeywords.map((kw) => {
                    const isContributor = user?.id && kw.app_user_id && String(user.id) === String(kw.app_user_id);
                    const canDeleteKw = isContributor || checkIsOwner(viewingTopic) || isAdmin || isLeader;

                    return (
                      <div
                        key={kw.id}
                        className="group flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs transition hover:border-slate-300 hover:bg-white hover:shadow-sm"
                      >
                        <span className="font-medium text-slate-800">{kw.keyword}</span>

                        {/* Contributor tooltip info */}
                        {kw.contributor_name && (
                          <span
                            className="text-[10px] text-slate-400"
                            title={`Được thêm bởi ${kw.contributor_name}`}
                          >
                            • {kw.contributor_name.split(" ").slice(-1)[0]}
                          </span>
                        )}

                        {/* Copy Single Keyword */}
                        <button
                          onClick={() => handleCopy(kw.keyword)}
                          className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-slate-600 transition"
                          title="Sao chép từ khóa này"
                        >
                          <span className="material-symbols-outlined text-xs">content_copy</span>
                        </button>

                        {/* Delete Single Keyword */}
                        {canDeleteKw && (
                          <button
                            onClick={() => handleDeleteKeyword(kw.id)}
                            className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-rose-600 transition"
                            title="Xóa từ khóa này"
                          >
                            <span className="material-symbols-outlined text-xs">close</span>
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="border-t border-slate-100 bg-slate-50/50 px-6 py-3 text-right">
              <button
                onClick={() => setViewingTopic(null)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: CREATE NEW TOPIC */}
      {isCreateTopicOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl animate-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-50 text-[var(--color-markee-primary)]">
                  <span className="material-symbols-outlined text-lg">add_box</span>
                </div>
                <h3 className="text-base font-bold text-slate-900">Thêm chủ đề từ khóa mới</h3>
              </div>
              <button
                onClick={() => setIsCreateTopicOpen(false)}
                className="flex h-7 w-7 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateTopic} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700">
                  Tên chủ đề <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={newTopicName}
                  onChange={(e) => setNewTopicName(e.target.value)}
                  placeholder="Ví dụ: Bất động sản, IT Tuyển dụng, Mẹ và bé..."
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3.5 py-2 text-xs text-slate-900 focus:border-[var(--color-markee-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-markee-primary)]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">Mô tả chủ đề</label>
                <textarea
                  rows={2}
                  value={newTopicDesc}
                  onChange={(e) => setNewTopicDesc(e.target.value)}
                  placeholder="Ghi chú mục đích của chủ đề từ khóa này..."
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3.5 py-2 text-xs text-slate-900 focus:border-[var(--color-markee-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-markee-primary)]"
                />
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-semibold text-slate-700">
                    Danh sách từ khóa ban đầu (Tùy chọn)
                  </label>
                  <span className="text-[10px] text-slate-400">Cách nhau bằng dấu phẩy hoặc dòng mới</span>
                </div>
                <textarea
                  rows={4}
                  value={newTopicKeywordsRaw}
                  onChange={(e) => setNewTopicKeywordsRaw(e.target.value)}
                  placeholder="chung cư, căn hộ cao cấp, mua bán nhà, biệt thự nghỉ dưỡng..."
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3.5 py-2 text-xs font-mono text-slate-900 focus:border-[var(--color-markee-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-markee-primary)]"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsCreateTopicOpen(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={isCreatingTopic}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--color-markee-primary)] px-5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-rose-800 disabled:opacity-50"
                >
                  {isCreatingTopic && (
                    <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  )}
                  <span>Tạo chủ đề</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: ADD / CONTRIBUTE KEYWORDS */}
      {targetTopicForAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl animate-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <div className="flex items-center gap-2.5">
                <div
                  className={`flex h-9 w-9 items-center justify-center rounded-xl ${
                    checkIsOwner(targetTopicForAdd)
                      ? "bg-rose-50 text-[var(--color-markee-primary)]"
                      : "bg-indigo-50 text-indigo-600"
                  }`}
                >
                  <span className="material-symbols-outlined text-lg">
                    {checkIsOwner(targetTopicForAdd) ? "add_circle" : "volunteer_activism"}
                  </span>
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    {checkIsOwner(targetTopicForAdd)
                      ? `Thêm từ khóa vào chủ đề`
                      : `Đóng góp từ khóa cho chủ đề`}
                  </h3>
                  <p className="text-xs text-slate-500 font-medium">{targetTopicForAdd.name}</p>
                </div>
              </div>
              <button
                onClick={() => setTargetTopicForAdd(null)}
                className="flex h-7 w-7 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmitAddKeywords} className="p-6 space-y-4">
              <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-xs text-amber-800">
                <p className="font-semibold">
                  {checkIsOwner(targetTopicForAdd)
                    ? "Bạn đang thêm từ khóa cho chủ đề của chính mình."
                    : `Chủ đề này được tạo bởi ${targetTopicForAdd.creator_name}. Đóng góp của bạn sẽ giúp hoàn thiện thư viện chung!`}
                </p>
                <p className="mt-0.5 text-[11px] text-amber-700">
                  Nhập một hoặc nhiều từ khóa, phân cách bằng dấu phẩy (,) hoặc mỗi từ khóa một dòng. Hệ thống sẽ tự động loại bỏ các từ khóa trùng lặp.
                </p>
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-semibold text-slate-700">
                    Danh sách từ khóa <span className="text-rose-500">*</span>
                  </label>
                  <span className="text-xs font-semibold text-slate-600">
                    Sẽ thêm:{" "}
                    <span className="text-[var(--color-markee-primary)] font-bold">
                      {previewAddCount}
                    </span>{" "}
                    từ khóa
                  </span>
                </div>
                <textarea
                  required
                  rows={5}
                  value={rawKeywordsInput}
                  onChange={(e) => setRawKeywordsInput(e.target.value)}
                  placeholder="Ví dụ:&#10;tuyển dụng dev&#10;reactjs, nextjs, nestjs&#10;lương thưởng hấp dẫn"
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-xs font-mono text-slate-900 focus:border-[var(--color-markee-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-markee-primary)]"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setTargetTopicForAdd(null)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingKeywords || previewAddCount === 0}
                  className={`inline-flex items-center gap-1.5 rounded-xl px-5 py-2 text-xs font-semibold text-white shadow-sm transition disabled:opacity-50 ${
                    checkIsOwner(targetTopicForAdd)
                      ? "bg-[var(--color-markee-primary)] hover:bg-rose-800"
                      : "bg-indigo-600 hover:bg-indigo-700"
                  }`}
                >
                  {isSubmittingKeywords && (
                    <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  )}
                  <span>
                    {checkIsOwner(targetTopicForAdd)
                      ? `Thêm ${previewAddCount > 0 ? previewAddCount : ""} từ khóa`
                      : `Gửi đóng góp ${previewAddCount > 0 ? previewAddCount : ""} từ khóa`}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 4: DELETE TOPIC CONFIRMATION */}
      {deletingTopic && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl animate-in zoom-in-95 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-rose-100 text-rose-600">
              <span className="material-symbols-outlined text-2xl">warning</span>
            </div>
            <h3 className="mt-3 text-base font-bold text-slate-900">Xác nhận xóa chủ đề?</h3>
            <p className="mt-1 text-xs text-slate-500">
              Chủ đề <span className="font-semibold text-slate-700">{deletingTopic.name}</span> và toàn bộ từ khóa bên trong sẽ bị xóa vĩnh viễn. Hành động này không thể hoàn tác.
            </p>
            <div className="mt-6 flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => setDeletingTopic(null)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={isDeletingTopic}
                onClick={handleDeleteTopic}
                className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-rose-700 disabled:opacity-50"
              >
                {isDeletingTopic && (
                  <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                )}
                <span>Xác nhận xóa</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
