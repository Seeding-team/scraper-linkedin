"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { toast } from "sonner";
import { Plus, Search, Edit2, Trash2, Power, RefreshCw, Check, ArrowUpDown } from "lucide-react";
import { allPlatformCategoriesService } from "@/services/all-platform.service";
import type { Category } from "@/types/unified.types";
import { cn } from "@/lib/utils";

type SeedingConfigSection = "post_evaluation" | "call_result";

interface SectionMeta {
  key: SeedingConfigSection;
  title: string;
  emoji: string;
  description: string;
  placeholderCode: string;
  placeholderName: string;
}

const SECTIONS: SectionMeta[] = [
  {
    key: "post_evaluation",
    title: "Đánh giá bài cào",
    emoji: "🏷️",
    description: "Danh mục trạng thái đánh giá bài viết cào về (Chưa đánh giá, Cần liên hệ, Chưa phù hợp...).",
    placeholderCode: "Vd: can-lien-he",
    placeholderName: "Vd: Cần liên hệ",
  },
  {
    key: "call_result",
    title: "Kết quả liên hệ",
    emoji: "📞",
    description: "Danh mục kết quả sau khi thực hiện cuộc gọi / liên hệ khách hàng (Đã gọi - không nghe máy, Hẹn gọi lại, Có nhu cầu...).",
    placeholderCode: "Vd: noanswer",
    placeholderName: "Vd: Đã gọi – không nghe máy",
  },
];

export default function SeedingConfigPage() {
  const [activeSection, setActiveSection] = useState<SeedingConfigSection>("post_evaluation");
  const [items, setItems] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");

  const [modal, setModal] = useState<{
    mode: "add" | "edit";
    id?: string;
    code: string;
    name: string;
    description: string;
    sort_order: number;
  } | null>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const currentMeta = SECTIONS.find((s) => s.key === activeSection) || SECTIONS[0];

  const fetchItems = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await allPlatformCategoriesService.getAll(activeSection, { forceRefresh: true });
      if (res.success && Array.isArray(res.data)) {
        setItems(res.data);
      } else {
        setItems([]);
      }
    } catch {
      toast.error("Không thể tải danh mục cấu hình.");
    } finally {
      setIsLoading(false);
    }
  }, [activeSection]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const filteredItems = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return items
      .filter((item) => {
        const isInactive = item.is_active === false;
        if (statusFilter === "active" && isInactive) return false;
        if (statusFilter === "inactive" && !isInactive) return false;
        if (!term) return true;
        return (
          (item.code || "").toLowerCase().includes(term) ||
          (item.name || "").toLowerCase().includes(term) ||
          (item.description || "").toLowerCase().includes(term)
        );
      })
      .sort((a, b) => {
        const orderA = typeof a.sort_order === "number" ? a.sort_order : 999;
        const orderB = typeof b.sort_order === "number" ? b.sort_order : 999;
        return orderA - orderB || (a.code || "").localeCompare(b.code || "");
      });
  }, [items, searchTerm, statusFilter]);

  const handleOpenAdd = () => {
    setModal({
      mode: "add",
      code: "",
      name: "",
      description: "",
      sort_order: items.length + 1,
    });
  };

  const handleOpenEdit = (item: Category) => {
    setModal({
      mode: "edit",
      id: item.id,
      code: item.code || "",
      name: item.name || "",
      description: item.description || "",
      sort_order: typeof item.sort_order === "number" ? item.sort_order : 0,
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modal) return;
    const code = modal.code.trim();
    const name = modal.name.trim();
    if (!code || !name) {
      toast.error("Vui lòng nhập đầy đủ Mã (code) và Tên hiển thị (name).");
      return;
    }

    setIsSubmitting(true);
    try {
      if (modal.mode === "add") {
        const res = await allPlatformCategoriesService.add({
          category_type: activeSection,
          code,
          name,
          description: modal.description.trim() || undefined,
          sort_order: modal.sort_order,
          platform: "all",
          is_active: true,
        });
        if (res.success) {
          toast.success("Đã thêm danh mục mới.");
          setModal(null);
          await fetchItems();
        } else {
          toast.error(res.message || "Không thể thêm danh mục.");
        }
      } else {
        const res = await allPlatformCategoriesService.update({
          id: modal.id!,
          category_type: activeSection,
          code,
          name,
          description: modal.description.trim() || undefined,
          sort_order: modal.sort_order,
        });
        if (res.success) {
          toast.success("Đã cập nhật danh mục.");
          setModal(null);
          await fetchItems();
        } else {
          toast.error(res.message || "Không thể cập nhật danh mục.");
        }
      }
    } catch {
      toast.error("Lỗi kết nối khi lưu danh mục.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleActive = async (item: Category) => {
    const nextActive = item.is_active === false;
    try {
      const res = await allPlatformCategoriesService.update({
        id: item.id,
        is_active: nextActive,
      });
      if (res.success) {
        toast.success(nextActive ? `Đã kích hoạt "${item.name}"` : `Đã tạm ngừng "${item.name}"`);
        await fetchItems();
      } else {
        toast.error(res.message || "Không thể đổi trạng thái.");
      }
    } catch {
      toast.error("Lỗi khi cập nhật trạng thái.");
    }
  };

  const handleDelete = async (item: Category) => {
    if (!confirm(`Bạn có chắc muốn xóa vĩnh viễn mục "${item.name || item.code}"?`)) return;
    setDeletingId(item.id);
    try {
      const res = await allPlatformCategoriesService.delete(item.id);
      if (res.success) {
        toast.success(`Đã xóa "${item.name || item.code}"`);
        await fetchItems();
      } else {
        toast.error(res.message || "Không thể xóa.");
      }
    } catch {
      toast.error("Lỗi khi xóa danh mục.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <span>⚙️</span> Cấu hình Seeding
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Quản lý các danh mục Đánh giá bài cào và Kết quả liên hệ khách hàng được đồng bộ toàn hệ thống.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={fetchItems}
            disabled={isLoading}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border border-border bg-card hover:bg-muted text-foreground transition shadow-2xs cursor-pointer"
            title="Làm mới dữ liệu"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", isLoading && "animate-spin")} />
            <span>Làm mới</span>
          </button>
          <button
            type="button"
            onClick={handleOpenAdd}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-primary text-primary-foreground hover:bg-primary/90 transition shadow-sm cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Thêm mục mới</span>
          </button>
        </div>
      </div>

      {/* Section Tabs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {SECTIONS.map((sec) => {
          const isSelected = activeSection === sec.key;
          return (
            <button
              key={sec.key}
              type="button"
              onClick={() => {
                setActiveSection(sec.key);
                setSearchTerm("");
                setStatusFilter("all");
              }}
              className={cn(
                "flex items-start gap-3 p-4 rounded-2xl border text-left transition cursor-pointer relative",
                isSelected
                  ? "bg-card border-primary shadow-sm ring-1 ring-primary/30"
                  : "bg-card/60 border-border hover:bg-card hover:border-border/80"
              )}
            >
              <span className="text-2xl shrink-0 p-2 rounded-xl bg-muted">{sec.emoji}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className={cn("font-bold text-sm", isSelected ? "text-primary" : "text-foreground")}>
                    {sec.title}
                  </span>
                  {isSelected && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-primary/10 text-primary">
                      <Check className="w-3 h-3" /> Đang chọn
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2 leading-relaxed">
                  {sec.description}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Toolbar: Search & Filter */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-card p-3 rounded-xl border border-border">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={`Tìm kiếm trong ${currentMeta.title.toLowerCase()}...`}
            className="w-full pl-9 pr-3 py-1.5 text-xs bg-muted/50 rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-primary/20 text-foreground"
          />
        </div>

        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-muted-foreground whitespace-nowrap">Trạng thái:</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="px-2.5 py-1.5 text-xs bg-muted/50 border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer"
          >
            <option value="all">Tất cả ({items.length})</option>
            <option value="active">Đang dùng ({items.filter((i) => i.is_active !== false).length})</option>
            <option value="inactive">Ngừng dùng ({items.filter((i) => i.is_active === false).length})</option>
          </select>
        </div>
      </div>

      {/* Data Table */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-2xs">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-muted/50 border-b border-border text-muted-foreground font-semibold">
              <tr>
                <th className="py-3 px-4 w-16 text-center">STT</th>
                <th className="py-3 px-4">Tên hiển thị</th>
                <th className="py-3 px-4">Mã định danh (code)</th>
                <th className="py-3 px-4">Mô tả</th>
                <th className="py-3 px-4 w-32 text-center">Trạng thái</th>
                <th className="py-3 px-4 w-32 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-muted-foreground">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-primary" />
                    <span>Đang tải danh mục...</span>
                  </td>
                </tr>
              ) : filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-muted-foreground">
                    <span>Không tìm thấy mục nào phù hợp.</span>
                  </td>
                </tr>
              ) : (
                filteredItems.map((item, index) => {
                  const isActive = item.is_active !== false;
                  return (
                    <tr
                      key={item.id}
                      className={cn(
                        "hover:bg-muted/40 transition",
                        !isActive && "opacity-60 bg-muted/20"
                      )}
                    >
                      <td className="py-3 px-4 text-center font-semibold text-muted-foreground">
                        {item.sort_order ?? index + 1}
                      </td>
                      <td className="py-3 px-4 font-bold text-foreground">
                        {item.name}
                      </td>
                      <td className="py-3 px-4 font-mono text-[11px] text-muted-foreground">
                        <span className="px-2 py-0.5 rounded bg-muted border border-border">
                          {item.code}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-muted-foreground max-w-xs truncate">
                        {item.description || "—"}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold",
                            isActive
                              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                              : "bg-slate-100 text-slate-600 border border-slate-200"
                          )}
                        >
                          <span
                            className={cn(
                              "w-1.5 h-1.5 rounded-full",
                              isActive ? "bg-emerald-500" : "bg-slate-400"
                            )}
                          />
                          {isActive ? "Đang dùng" : "Ngừng dùng"}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => handleToggleActive(item)}
                            className={cn(
                              "p-1.5 rounded-lg border transition cursor-pointer",
                              isActive
                                ? "border-amber-200 text-amber-700 hover:bg-amber-50"
                                : "border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                            )}
                            title={isActive ? "Tạm ngừng dùng" : "Kích hoạt lại"}
                          >
                            <Power className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleOpenEdit(item)}
                            className="p-1.5 rounded-lg border border-border text-foreground hover:bg-muted transition cursor-pointer"
                            title="Sửa thông tin"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={deletingId === item.id}
                            onClick={() => handleDelete(item)}
                            className="p-1.5 rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50 transition cursor-pointer disabled:opacity-50"
                            title="Xóa vĩnh viễn"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit Modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-100">
          <div className="w-full max-w-md bg-card rounded-2xl border border-border shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="font-bold text-base text-foreground flex items-center gap-2">
                <span>{modal.mode === "add" ? "➕ Thêm mục mới" : "✏️ Chỉnh sửa mục"}</span>
                <span className="text-xs font-normal text-muted-foreground">({currentMeta.title})</span>
              </h3>
              <button
                type="button"
                onClick={() => setModal(null)}
                className="text-muted-foreground hover:text-foreground p-1 text-sm cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSave} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">
                  Mã định danh (code) <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  disabled={modal.mode === "edit"}
                  value={modal.code}
                  onChange={(e) => setModal({ ...modal, code: e.target.value })}
                  placeholder={currentMeta.placeholderCode}
                  className="w-full px-3 py-2 text-xs bg-muted/50 rounded-xl border border-border focus:outline-none focus:ring-2 focus:ring-primary/20 font-mono disabled:opacity-60"
                />
                {modal.mode === "edit" && (
                  <p className="text-[10px] text-muted-foreground mt-0.5">Mã code không thể thay đổi sau khi tạo.</p>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">
                  Tên hiển thị (name) <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={modal.name}
                  onChange={(e) => setModal({ ...modal, name: e.target.value })}
                  placeholder={currentMeta.placeholderName}
                  className="w-full px-3 py-2 text-xs bg-muted/50 rounded-xl border border-border focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">
                  Mô tả chi tiết
                </label>
                <textarea
                  rows={2}
                  value={modal.description}
                  onChange={(e) => setModal({ ...modal, description: e.target.value })}
                  placeholder="Ghi chú ý nghĩa của trạng thái này..."
                  className="w-full px-3 py-2 text-xs bg-muted/50 rounded-xl border border-border focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">
                  Thứ tự hiển thị (sort_order)
                </label>
                <input
                  type="number"
                  value={modal.sort_order}
                  onChange={(e) => setModal({ ...modal, sort_order: parseInt(e.target.value, 10) || 0 })}
                  className="w-full px-3 py-2 text-xs bg-muted/50 rounded-xl border border-border focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>

              <div className="flex gap-2.5 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => setModal(null)}
                  className="flex-1 py-2 rounded-xl text-xs font-bold border border-border hover:bg-muted text-foreground transition cursor-pointer"
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 py-2 rounded-xl text-xs font-bold bg-primary text-primary-foreground hover:bg-primary/90 transition shadow-sm cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? "Đang lưu..." : modal.mode === "add" ? "Thêm mới" : "Lưu thay đổi"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

