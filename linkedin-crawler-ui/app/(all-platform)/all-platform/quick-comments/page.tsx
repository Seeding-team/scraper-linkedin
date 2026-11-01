"use client";

import React, { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import {
  allPlatformQuickCommentService,
} from "@/services/all-platform.service";
import { QuickCommentTemplate } from "@/types/unified.types";

export default function QuickCommentsPage() {
  const [templates, setTemplates] = useState<QuickCommentTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Filters
  const [activePlatform, setActivePlatform] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedLabel, setSelectedLabel] = useState<string>("all");

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 10;

  // Modal State - Add / Edit
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<QuickCommentTemplate | null>(null);
  const [formData, setFormData] = useState({
    title: "",
    label: "Khen ngợi",
    content: "",
    platform: "all",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Modal State - Delete
  const [deletingTemplate, setDeletingTemplate] = useState<QuickCommentTemplate | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Toast Notification
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const showToast = (message: string, type: "success" | "error") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const loadTemplates = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = await allPlatformQuickCommentService.getAll();
      if (res && res.success && Array.isArray(res.data)) {
        setTemplates(res.data);
      } else {
        setLoadError(res?.message || "Không thể tải danh sách mẫu câu.");
      }
    } catch (err: any) {
      setLoadError(err?.message || "Lỗi khi kết nối với máy chủ.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadTemplates();
  }, []);

  // Unique labels extracted from data
  const availableLabels = useMemo(() => {
    const labels = new Set<string>();
    templates.forEach((t) => {
      if (t.label) labels.add(t.label);
    });
    return Array.from(labels);
  }, [templates]);

  // Filtered Templates
  const filteredTemplates = useMemo(() => {
    return templates.filter((t) => {
      // Filter platform
      if (activePlatform !== "all" && t.platform !== "all" && t.platform !== activePlatform) {
        return false;
      }
      // Filter label
      if (selectedLabel !== "all" && t.label !== selectedLabel) {
        return false;
      }
      // Filter search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchTitle = t.title.toLowerCase().includes(q);
        const matchContent = t.content.toLowerCase().includes(q);
        const matchLabel = t.label?.toLowerCase().includes(q);
        if (!matchTitle && !matchContent && !matchLabel) {
          return false;
        }
      }
      return true;
    });
  }, [templates, activePlatform, selectedLabel, searchQuery]);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [activePlatform, searchQuery, selectedLabel]);

  // Paginated Data
  const totalPages = Math.max(1, Math.ceil(filteredTemplates.length / ITEMS_PER_PAGE));
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = Math.min(startIndex + ITEMS_PER_PAGE, filteredTemplates.length);
  const paginatedTemplates = useMemo(() => {
    return filteredTemplates.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [filteredTemplates, startIndex]);

  // Handle Add / Edit submit
  const openAddModal = () => {
    setEditingTemplate(null);
    setFormData({
      title: "",
      label: "Khen ngợi",
      content: "",
      platform: "all",
    });
    setIsModalOpen(true);
  };

  const openEditModal = (template: QuickCommentTemplate) => {
    setEditingTemplate(template);
    setFormData({
      title: template.title,
      label: template.label || "Khác",
      content: template.content,
      platform: template.platform || "all",
    });
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title.trim() || !formData.content.trim()) {
      showToast("Vui lòng điền đầy đủ tiêu đề và nội dung mẫu câu.", "error");
      return;
    }

    setIsSubmitting(true);
    try {
      if (editingTemplate) {
        const res = await allPlatformQuickCommentService.update({
          id: editingTemplate.id,
          title: formData.title.trim(),
          label: formData.label.trim(),
          content: formData.content.trim(),
          platform: formData.platform,
        });
        if (res && res.success) {
          showToast("Đã cập nhật mẫu câu thành công!", "success");
          setIsModalOpen(false);
          loadTemplates();
        } else {
          showToast(res?.message || "Không thể cập nhật mẫu câu.", "error");
        }
      } else {
        const res = await allPlatformQuickCommentService.add({
          title: formData.title.trim(),
          label: formData.label.trim(),
          content: formData.content.trim(),
          platform: formData.platform,
        });
        if (res && res.success) {
          showToast("Đã thêm mẫu câu mới thành công!", "success");
          setIsModalOpen(false);
          loadTemplates();
        } else {
          showToast(res?.message || "Không thể thêm mẫu câu.", "error");
        }
      }
    } catch (err: any) {
      showToast(err?.message || "Có lỗi xảy ra khi lưu mẫu câu.", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle Delete
  const handleDeleteConfirm = async () => {
    if (!deletingTemplate) return;
    setIsDeleting(true);
    try {
      const res = await allPlatformQuickCommentService.delete(deletingTemplate.id);
      if (res && res.success) {
        showToast("Đã xóa mẫu câu thành công!", "success");
        setDeletingTemplate(null);
        loadTemplates();
      } else {
        showToast(res?.message || "Không thể xóa mẫu câu.", "error");
      }
    } catch (err: any) {
      showToast(err?.message || "Có lỗi xảy ra khi xóa mẫu câu.", "error");
    } finally {
      setIsDeleting(false);
    }
  };

  // Handle Reorder
  const handleReorder = async (id: string, direction: "up" | "down") => {
    try {
      const res = await allPlatformQuickCommentService.reorder(id, direction);
      if (res && res.success) {
        if (Array.isArray(res.data)) {
          setTemplates(res.data);
        } else {
          loadTemplates();
        }
      } else {
        showToast(res?.message || "Không thể thay đổi thứ tự.", "error");
      }
    } catch (err: any) {
      showToast(err?.message || "Lỗi khi đổi thứ tự.", "error");
    }
  };

  // Helpers for UI
  const getPlatformBadge = (platform?: string) => {
    switch (platform) {
      case "facebook":
        return <span className="inline-block whitespace-nowrap px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-50 text-blue-700 border border-blue-200">Facebook</span>;
      case "linkedin":
        return <span className="inline-block whitespace-nowrap px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-sky-50 text-sky-700 border border-sky-200">LinkedIn</span>;
      case "youtube":
        return <span className="inline-block whitespace-nowrap px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-red-50 text-red-700 border border-red-200">YouTube</span>;
      default:
        return <span className="inline-block whitespace-nowrap px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-purple-50 text-purple-700 border border-purple-200">Tất cả nền tảng</span>;
    }
  };

  return (
    <div className="w-full bg-[#f7f8fb] text-[#252733] min-h-screen">
      {/* Toast Alert */}
      {toast ? (
        <div
          className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl shadow-xl text-xs font-bold text-white transition-all transform animate-bounce ${toast.type === "success" ? "bg-emerald-600" : "bg-rose-600"
            }`}
        >
          {toast.type === "success" ? "✅ " : "❌ "}
          {toast.message}
        </div>
      ) : null}

      {/* HEADER */}
      <div className="sticky top-0 z-10 bg-white border-b border-[#e7e9ef] h-14.5 flex items-center justify-between px-6">
        <div className="flex items-center gap-3">
          <Link
            href="/all-platform/internal-engagement"
            className="px-3.5 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-xs font-extrabold transition flex items-center gap-1.5 shadow-2xs"
          >
            <span>⬅</span> Trở về Tương tác nội bộ
          </Link>
          <span className="text-gray-300">|</span>
          <div className="font-black text-[17px] text-gray-900">Thư viện mẫu câu</div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="border border-[#e7e9ef] bg-white hover:bg-gray-50 rounded-xl p-2 transition cursor-pointer"
            aria-label="refresh"
            onClick={loadTemplates}
          >
            🔄
          </button>
        </div>
      </div>

      <div className="max-w-425 mx-auto p-5">
        {/* TOP TITLE & ACTIONS */}
        <div className="flex flex-col sm:flex-row justify-between gap-4 sm:items-center mb-6">
          <div>
            <h1 className="text-[24px] m-0 mb-[4px] font-extrabold text-[#0f172a]">Thư viện mẫu câu (Quick Comments)</h1>
            <p className="m-0 text-[#64748b] text-[14px]">
              Quản lý danh sách mẫu bình luận nhanh cho nhân viên seeding trên Facebook, LinkedIn và YouTube.
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={openAddModal}
              className="px-4 py-2.5 bg-[#be123c] hover:bg-[#9f1239] text-white rounded-xl text-[13px] font-bold shadow-sm transition flex items-center gap-2 cursor-pointer"
            >
              <span className="text-base font-bold">+</span> Thêm mẫu câu mới
            </button>
          </div>
        </div>

        {/* STATS CARDS */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3.5 mb-6">
          <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-[0_2px_8px_rgba(0,0,0,0.03)]">
            <span className="text-xs font-semibold text-gray-500 block">Tổng mẫu câu</span>
            <div className="text-2xl font-black text-gray-900 mt-1">{templates.length}</div>
            <span className="text-[11px] text-gray-400 font-medium">Mẫu câu khả dụng</span>
          </div>
          <div className="bg-white border border-blue-100 rounded-2xl p-4 shadow-[0_2px_8px_rgba(0,0,0,0.03)]">
            <span className="text-xs font-semibold text-blue-600 block">Facebook</span>
            <div className="text-2xl font-black text-blue-950 mt-1">
              {templates.filter((t) => t.platform === "all" || t.platform === "facebook").length}
            </div>
            <span className="text-[11px] text-blue-500 font-medium">Dùng cho Facebook</span>
          </div>
          <div className="bg-white border border-sky-100 rounded-2xl p-4 shadow-[0_2px_8px_rgba(0,0,0,0.03)]">
            <span className="text-xs font-semibold text-sky-600 block">LinkedIn</span>
            <div className="text-2xl font-black text-sky-950 mt-1">
              {templates.filter((t) => t.platform === "all" || t.platform === "linkedin").length}
            </div>
            <span className="text-[11px] text-sky-500 font-medium">Dùng cho LinkedIn</span>
          </div>
          <div className="bg-white border border-red-100 rounded-2xl p-4 shadow-[0_2px_8px_rgba(0,0,0,0.03)]">
            <span className="text-xs font-semibold text-red-600 block">YouTube</span>
            <div className="text-2xl font-black text-red-950 mt-1">
              {templates.filter((t) => t.platform === "all" || t.platform === "youtube").length}
            </div>
            <span className="text-[11px] text-red-500 font-medium">Dùng cho YouTube</span>
          </div>
          <div className="bg-white border border-sky-100 rounded-2xl p-4 shadow-[0_2px_8px_rgba(0,0,0,0.03)]">
            <span className="text-xs font-semibold text-sky-600 block">Zalo</span>
            <div className="text-2xl font-black text-sky-950 mt-1">
              {templates.filter((t) => t.platform === "all" || t.platform === "zalo").length}
            </div>
            <span className="text-[11px] text-sky-500 font-medium">Dùng cho Zalo</span>
          </div>
        </div>

        {/* FILTERS & SEARCH BAR */}
        <div className="bg-white rounded-2xl border border-gray-200 p-4 mb-6 shadow-[0_2px_8px_rgba(0,0,0,0.03)] flex flex-wrap items-center justify-between gap-4">
          {/* Platform Tabs */}
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
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer whitespace-nowrap ${activePlatform === tab.id
                    ? "bg-white text-gray-900 shadow-xs"
                    : "text-gray-500 hover:text-gray-800 hover:bg-white/50"
                  }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3 w-full md:w-auto shrink-0 ml-auto">
            <div className="relative w-full md:w-75">
              <input
                type="text"
                placeholder="Tìm kiếm mẫu câu theo tiêu đề, nội dung..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 border border-gray-200 rounded-xl text-xs font-medium focus:outline-none focus:border-rose-500 transition"
              />
              <span className="absolute left-3 top-2 text-gray-400 text-xs">🔍</span>
            </div>

            {/* Label Filter */}
            <select
              value={selectedLabel}
              onChange={(e) => setSelectedLabel(e.target.value)}
              className="px-3 py-1.5 border border-gray-200 rounded-xl text-xs font-semibold text-gray-700 bg-white focus:outline-none cursor-pointer shrink-0"
            >
              <option value="all">Tất cả nhãn</option>
              {availableLabels.map((lbl) => (
                <option key={lbl} value={lbl}>
                  {lbl}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* MAIN TABLE CONTENT */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-[0_2px_8px_rgba(0,0,0,0.03)] overflow-hidden">
          {isLoading ? (
            <div className="p-12 text-center text-gray-500 text-xs font-medium">Đang tải danh sách mẫu câu...</div>
          ) : loadError ? (
            <div className="p-8 text-center text-rose-600 text-xs font-bold bg-rose-50/50">{loadError}</div>
          ) : filteredTemplates.length === 0 ? (
            <div className="p-12 text-center text-gray-400 text-xs font-medium">
              Chưa có mẫu câu nào phù hợp với bộ lọc. Bấm &quot;Thêm mẫu câu mới&quot; để tạo ngay.
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50/50 text-gray-400 font-semibold uppercase tracking-wider">
                      <th className="py-3 px-4 w-12 text-center whitespace-nowrap">STT</th>
                      <th className="py-3 px-4 min-w-36 whitespace-nowrap">Tiêu đề mẫu câu</th>
                      <th className="py-3 px-4 min-w-35 whitespace-nowrap">Nhãn (Label)</th>
                      <th className="py-3 px-4 min-w-80">Nội dung mẫu câu</th>
                      <th className="py-3 px-4 min-w-35 whitespace-nowrap">Nền tảng</th>
                      <th className="py-3 px-4 w-24 text-center whitespace-nowrap">Thứ tự</th>
                      <th className="py-3 px-4 w-28 text-right whitespace-nowrap">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 text-gray-700 font-medium">
                    {paginatedTemplates.map((item, idx) => {
                      const realIndex = startIndex + idx;
                      return (
                        <tr key={item.id} className="hover:bg-gray-50/80 transition">
                          <td className="py-3 px-4 text-center font-bold text-gray-400">{realIndex + 1}</td>
                          <td className="py-3 px-4 font-bold text-gray-900">{item.title}</td>
                          <td className="py-3 px-4">
                            <span className="inline-block whitespace-nowrap px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-gray-100 text-gray-700 border border-gray-200">
                              🏷️ {item.label || "Khác"}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-gray-800 leading-relaxed font-normal">
                            <div className="bg-gray-50 p-2.5 rounded-xl border border-gray-100 text-xs">
                              {item.content}
                            </div>
                          </td>
                          <td className="py-3 px-4">{getPlatformBadge(item.platform)}</td>
                          <td className="py-3 px-4 text-center">
                            <div className="flex items-center justify-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleReorder(item.id, "up")}
                                disabled={realIndex === 0}
                                className="p-1 hover:bg-gray-100 rounded text-gray-500 disabled:opacity-30 cursor-pointer"
                                title="Chuyển lên trên"
                              >
                                ⬆️
                              </button>
                              <button
                                type="button"
                                onClick={() => handleReorder(item.id, "down")}
                                disabled={realIndex === filteredTemplates.length - 1}
                                className="p-1 hover:bg-gray-100 rounded text-gray-500 disabled:opacity-30 cursor-pointer"
                                title="Chuyển xuống dưới"
                              >
                                ⬇️
                              </button>
                            </div>
                          </td>
                          <td className="py-3 px-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => openEditModal(item)}
                                className="px-2.5 py-1 text-xs font-semibold text-blue-600 hover:bg-blue-50 border border-blue-200 rounded-lg transition cursor-pointer"
                              >
                                ✏️ Sửa
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeletingTemplate(item)}
                                className="px-2.5 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50 border border-rose-200 rounded-lg transition cursor-pointer"
                              >
                                🗑️ Xóa
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* PAGINATION FOOTER */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-gray-100 bg-gray-50/50 text-xs font-medium text-gray-600">
                <div>
                  Hiển thị từ <span className="font-bold text-gray-900">{startIndex + 1}</span> đến{" "}
                  <span className="font-bold text-gray-900">{endIndex}</span> trong tổng số{" "}
                  <span className="font-bold text-gray-900">{filteredTemplates.length}</span> mẫu câu
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={currentPage <= 1}
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    className="px-3.5 py-1.5 rounded-xl border border-gray-200 bg-white text-xs font-bold text-gray-700 hover:bg-gray-50 transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shadow-2xs"
                  >
                    ← Trang trước
                  </button>
                  <span className="px-2 font-bold text-gray-800">
                    {currentPage} / {totalPages}
                  </span>
                  <button
                    type="button"
                    disabled={currentPage >= totalPages}
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    className="px-3.5 py-1.5 rounded-xl border border-gray-200 bg-white text-xs font-bold text-gray-700 hover:bg-gray-50 transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shadow-2xs"
                  >
                    Trang sau →
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* MODAL ADD / EDIT TEMPLATE - FIXED UI */}
      {isModalOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 overflow-y-auto backdrop-blur-xs"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setIsModalOpen(false);
          }}
        >
          <div className="w-[min(560px,100%)] bg-white rounded-2xl p-6 shadow-2xl relative max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100">
              <h3 className="font-extrabold text-base text-gray-900">
                {editingTemplate ? "✏️ Chỉnh sửa mẫu câu" : "➕ Thêm mẫu câu mới"}
              </h3>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-gray-400 hover:text-gray-700 text-sm p-1 rounded-lg transition cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  Tiêu đề gợi nhớ mẫu câu <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="Ví dụ: Khen ngợi bài viết hay, Hỏi tư vấn giá..."
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs font-medium focus:outline-none focus:border-rose-500 transition"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">Nhãn nhóm (Label)</label>
                  <select
                    value={formData.label}
                    onChange={(e) => setFormData({ ...formData, label: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs font-medium bg-white focus:outline-none focus:border-rose-500 transition cursor-pointer"
                  >
                    <option value="Khen ngợi">Khen ngợi</option>
                    <option value="Hỏi đáp">Hỏi đáp</option>
                    <option value="Tư vấn">Tư vấn</option>
                    <option value="Đánh giá">Đánh giá</option>
                    <option value="Khác">Khác</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">Áp dụng nền tảng</label>
                  <select
                    value={formData.platform}
                    onChange={(e) => setFormData({ ...formData, platform: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs font-medium bg-white focus:outline-none focus:border-rose-500 transition cursor-pointer"
                  >
                    <option value="all">Tất cả nền tảng</option>
                    <option value="facebook">Facebook</option>
                    <option value="linkedin">LinkedIn</option>
                    <option value="youtube">YouTube</option>
                    <option value="zalo">Zalo</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  Nội dung mẫu câu chi tiết <span className="text-rose-500">*</span>
                </label>
                <textarea
                  rows={4}
                  placeholder="Nhập nội dung mẫu câu comment sẽ được tự động điền khi bấm seeding..."
                  value={formData.content}
                  onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs font-medium focus:outline-none focus:border-rose-500 transition leading-relaxed"
                  required
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 mt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 border border-gray-200 hover:bg-gray-50 text-gray-700 rounded-xl text-xs font-bold transition cursor-pointer"
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 bg-[#be123c] hover:bg-[#9f1239] text-white rounded-xl text-xs font-bold shadow-sm transition disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
                >
                  {isSubmitting ? (
                    <>
                      <span className="animate-spin inline-block">🔄</span>
                      <span>Đang lưu...</span>
                    </>
                  ) : (
                    <span>Lưu mẫu câu</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL CONFIRM DELETE - FIXED UI */}
      {deletingTemplate && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 overflow-y-auto backdrop-blur-xs"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setDeletingTemplate(null);
          }}
        >
          <div className="w-[min(460px,100%)] bg-white rounded-2xl p-6 shadow-2xl relative my-auto">
            <div className="flex items-center justify-between mb-3 pb-2 border-b border-gray-100">
              <h3 className="font-extrabold text-base text-rose-600">🗑️ Xác nhận xóa mẫu câu</h3>
              <button
                type="button"
                onClick={() => setDeletingTemplate(null)}
                className="text-gray-400 hover:text-gray-700 text-sm p-1 rounded-lg transition cursor-pointer"
              >
                ✕
              </button>
            </div>
            <p className="text-xs text-gray-700 font-medium mb-4 leading-relaxed">
              Bạn có chắc chắn muốn xóa mẫu câu &quot;<strong className="text-gray-900">{deletingTemplate.title}</strong>&quot; này không? Hành động này không thể hoàn tác.
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setDeletingTemplate(null)}
                className="px-4 py-2 border border-gray-200 hover:bg-gray-50 text-gray-700 rounded-xl text-xs font-bold transition cursor-pointer"
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                onClick={handleDeleteConfirm}
                disabled={isDeleting}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold shadow-sm transition disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
              >
                {isDeleting ? "Đang xóa..." : "Xóa ngay"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}