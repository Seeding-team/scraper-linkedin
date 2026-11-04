"use client";

import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { useAppAuth } from "@/contexts/AppAuthContext";
import { crawlKeywordsService } from "@/services/all-platform.service";
import type { ExcludeKeyword, KeywordProposal } from "@/types/unified.types";

interface PendingKeywordsPanelProps {
  onClose?: () => void;
  onKeywordUpdated?: () => void;
}

export function PendingKeywordsPanel({ onClose, onKeywordUpdated }: PendingKeywordsPanelProps) {
  const { user } = useAppAuth();
  const isAdmin = user?.role === "admin";

  const [activeTab, setActiveTab] = useState<"proposals" | "keywords">("proposals");
  const [proposals, setProposals] = useState<KeywordProposal[]>([]);
  const [keywords, setKeywords] = useState<ExcludeKeyword[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Bulk select proposals
  const [selectedProposalIds, setSelectedProposalIds] = useState<Set<string>>(new Set());
  const [isProcessingBulk, setIsProcessingBulk] = useState(false);

  // Add new keyword modal/input
  const [newKeywordInput, setNewKeywordInput] = useState("");
  const [newKeywordPlatform, setNewKeywordPlatform] = useState<string>("");
  const [isAddingKeyword, setIsAddingKeyword] = useState(false);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [propRes, kwRes] = await Promise.all([
        crawlKeywordsService.listProposals("pending"),
        crawlKeywordsService.listExcludeKeywords(),
      ]);

      if (propRes.success && propRes.data) {
        setProposals(propRes.data as KeywordProposal[]);
      }
      if (kwRes.success && kwRes.data) {
        setKeywords(kwRes.data as ExcludeKeyword[]);
      }
    } catch {
      toast.error("Không thể tải danh sách từ khóa loại trừ.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Bulk toggle
  const toggleSelectAll = () => {
    if (selectedProposalIds.size === proposals.length) {
      setSelectedProposalIds(new Set());
    } else {
      setSelectedProposalIds(new Set(proposals.map((p) => p.id)));
    }
  };

  const toggleSelectProposal = (id: string) => {
    setSelectedProposalIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Duyệt lẻ
  const handleApprove = async (id: string) => {
    try {
      const res = await crawlKeywordsService.approveProposal(id);
      if (res.success) {
        toast.success("Đã duyệt đề xuất và đưa vào từ khóa loại trừ.");
        setProposals((prev) => prev.filter((p) => p.id !== id));
        void loadData();
        onKeywordUpdated?.();
      } else {
        toast.error(res.message || "Không thể duyệt đề xuất.");
      }
    } catch {
      toast.error("Lỗi khi duyệt đề xuất.");
    }
  };

  // Từ chối
  const handleReject = async (id: string) => {
    const reason = prompt("Nhập lý do từ chối (tùy chọn):") || undefined;
    try {
      const res = await crawlKeywordsService.rejectProposal(id, reason);
      if (res.success) {
        toast.info("Đã từ chối đề xuất.");
        setProposals((prev) => prev.filter((p) => p.id !== id));
      } else {
        toast.error(res.message || "Không thể từ chối đề xuất.");
      }
    } catch {
      toast.error("Lỗi khi từ chối đề xuất.");
    }
  };

  // Duyệt hàng loạt
  const handleBulkApprove = async () => {
    const ids = Array.from(selectedProposalIds);
    if (ids.length === 0) return;

    setIsProcessingBulk(true);
    try {
      const res = await crawlKeywordsService.bulkApproveProposals(ids);
      if (res.success && res.data) {
        toast.success(`Đã duyệt thành công ${res.data.approved_count} đề xuất!`);
        setSelectedProposalIds(new Set());
        void loadData();
        onKeywordUpdated?.();
      } else {
        toast.error(res.message || "Không thể duyệt hàng loạt.");
      }
    } catch {
      toast.error("Lỗi khi duyệt hàng loạt.");
    } finally {
      setIsProcessingBulk(false);
    }
  };

  // Thêm từ khóa trực tiếp
  const handleAddDirectKeyword = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanKw = newKeywordInput.trim();
    if (!cleanKw) return;

    setIsAddingKeyword(true);
    try {
      const res = await crawlKeywordsService.createExcludeKeyword({
        keyword: cleanKw,
        platform: newKeywordPlatform || null,
        status: "active",
      });

      if (res.success) {
        toast.success("Đã thêm từ khóa loại trừ mới.");
        setNewKeywordInput("");
        void loadData();
        onKeywordUpdated?.();
      } else {
        toast.error(res.message || "Không thể thêm từ khóa.");
      }
    } catch {
      toast.error("Lỗi khi thêm từ khóa.");
    } finally {
      setIsAddingKeyword(false);
    }
  };

  // Xóa từ khóa trực tiếp
  const handleDeleteKeyword = async (id: string) => {
    if (!confirm("Bạn có chắc chắn muốn xóa từ khóa loại trừ này?")) return;

    try {
      const res = await crawlKeywordsService.deleteExcludeKeyword(id);
      if (res.success) {
        toast.success("Đã xóa từ khóa loại trừ.");
        setKeywords((prev) => prev.filter((k) => k.id !== id));
        onKeywordUpdated?.();
      } else {
        toast.error(res.message || "Không thể xóa từ khóa.");
      }
    } catch {
      toast.error("Lỗi khi xóa từ khóa.");
    }
  };

  return (
    <div className="bg-card rounded-2xl border border-border shadow-lg p-5 mb-5 space-y-4 animate-in fade-in">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border pb-3 flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary grid place-items-center">
            <span className="material-symbols-outlined text-xl">rule</span>
          </div>
          <div>
            <h2 className="text-base font-bold text-foreground">Quản lý Từ khóa Loại trừ & Đề xuất</h2>
            <p className="text-xs text-muted-foreground">Tự động gắn cờ bài cào không phù hợp dựa trên danh sách từ cấm</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Tab switcher */}
          <div className="flex items-center bg-muted p-1 rounded-xl text-xs font-semibold">
            <button
              type="button"
              onClick={() => setActiveTab("proposals")}
              className={`px-3 py-1 rounded-lg transition ${
                activeTab === "proposals" ? "bg-card text-foreground shadow-xs font-bold" : "text-muted-foreground"
              }`}
            >
              Đề xuất chờ duyệt ({proposals.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("keywords")}
              className={`px-3 py-1 rounded-lg transition ${
                activeTab === "keywords" ? "bg-card text-foreground shadow-xs font-bold" : "text-muted-foreground"
              }`}
            >
              Đang hoạt động ({keywords.length})
            </button>
          </div>

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground text-sm font-bold w-7 h-7 flex items-center justify-center rounded-lg hover:bg-muted ml-2"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="py-8 flex justify-center">
          <div className="border-primary h-6 w-6 rounded-full border-2 border-t-transparent animate-spin" />
        </div>
      ) : activeTab === "proposals" ? (
        /* TAB 1: DANH SÁCH ĐỀ XUẤT CHỜ DUYỆT */
        <div className="space-y-3">
          {proposals.length > 0 && isAdmin && (
            <div className="flex items-center justify-between bg-muted/60 p-2.5 rounded-xl text-xs">
              <label className="flex items-center gap-2 cursor-pointer font-medium text-foreground">
                <input
                  type="checkbox"
                  checked={selectedProposalIds.size === proposals.length && proposals.length > 0}
                  onChange={toggleSelectAll}
                  className="rounded border-border text-primary focus:ring-primary w-4 h-4"
                />
                <span>Chọn tất cả ({proposals.length} đề xuất)</span>
              </label>

              {selectedProposalIds.size > 0 && (
                <button
                  type="button"
                  disabled={isProcessingBulk}
                  onClick={handleBulkApprove}
                  className="px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold transition shadow-xs"
                >
                  {isProcessingBulk ? "Đang duyệt..." : `Duyệt ${selectedProposalIds.size} đề xuất đã chọn`}
                </button>
              )}
            </div>
          )}

          {proposals.length === 0 ? (
            <div className="text-center py-6 text-xs text-muted-foreground italic">
              Không có đề xuất từ khóa nào đang chờ duyệt.
            </div>
          ) : (
            <div className="divide-y divide-border border border-border rounded-xl overflow-hidden bg-background">
              {proposals.map((item) => (
                <div key={item.id} className="p-3 flex items-center justify-between gap-3 text-xs hover:bg-muted/40 transition">
                  <div className="flex items-center gap-3 min-w-0">
                    {isAdmin && (
                      <input
                        type="checkbox"
                        checked={selectedProposalIds.has(item.id)}
                        onChange={() => toggleSelectProposal(item.id)}
                        className="rounded border-border text-primary focus:ring-primary w-4 h-4 shrink-0"
                      />
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-foreground text-sm bg-rose-50 text-rose-700 border border-rose-200 px-2 py-0.5 rounded-md">
                          "{item.keyword}"
                        </span>
                        {item.platform && (
                          <span className="text-[10px] uppercase font-bold text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                            {item.platform}
                          </span>
                        )}
                        <span className="text-[11px] text-muted-foreground">
                          Đề xuất bởi: <b className="text-foreground">{item.proposer_name || "Thành viên"}</b>
                        </span>
                      </div>
                      {item.reason && (
                        <p className="text-muted-foreground text-[11px] mt-1 line-clamp-1 italic">
                          Lý do: {item.reason}
                        </p>
                      )}
                    </div>
                  </div>

                  {isAdmin && (
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleReject(item.id)}
                        className="px-2.5 py-1 text-xs font-semibold rounded-lg text-rose-600 hover:bg-rose-50 border border-rose-200 transition"
                      >
                        Từ chối
                      </button>
                      <button
                        type="button"
                        onClick={() => handleApprove(item.id)}
                        className="px-3 py-1 text-xs font-bold rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground transition shadow-2xs"
                      >
                        Duyệt
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* TAB 2: TỪ KHÓA ĐANG HOẠT ĐỘNG */
        <div className="space-y-4">
          {/* Form thêm từ khóa trực tiếp */}
          {isAdmin && (
            <form onSubmit={handleAddDirectKeyword} className="flex items-center gap-2 flex-wrap bg-muted/60 p-3 rounded-xl border border-border">
              <input
                type="text"
                value={newKeywordInput}
                onChange={(e) => setNewKeywordInput(e.target.value)}
                placeholder="Nhập từ khóa mới cần cấm/loại trừ..."
                className="flex-1 min-w-[200px] px-3 py-1.5 text-xs rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
              <select
                value={newKeywordPlatform}
                onChange={(e) => setNewKeywordPlatform(e.target.value)}
                className="px-2.5 py-1.5 text-xs rounded-lg border border-border bg-background focus:outline-none"
              >
                <option value="">Tất cả nền tảng</option>
                <option value="facebook">Facebook</option>
                <option value="linkedin">LinkedIn</option>
                <option value="threads">Threads</option>
              </select>
              <button
                type="submit"
                disabled={isAddingKeyword || !newKeywordInput.trim()}
                className="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-primary hover:bg-primary/90 text-primary-foreground shadow-2xs transition disabled:opacity-50"
              >
                {isAddingKeyword ? "Đang thêm..." : "+ Thêm từ khóa"}
              </button>
            </form>
          )}

          {/* Danh sách từ khóa active dạng tag badges */}
          <div className="flex flex-wrap gap-2 pt-1">
            {keywords.length === 0 ? (
              <span className="text-xs text-muted-foreground italic">Chưa có từ khóa loại trừ nào được thiết lập.</span>
            ) : (
              keywords.map((kw) => (
                <span
                  key={kw.id}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-muted border border-border text-foreground hover:border-border/80 transition shadow-2xs"
                >
                  <span>{kw.keyword}</span>
                  {kw.platform && (
                    <span className="text-[9px] uppercase px-1 py-0.2 rounded bg-background text-muted-foreground font-bold">
                      {kw.platform}
                    </span>
                  )}
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => handleDeleteKeyword(kw.id)}
                      className="text-muted-foreground hover:text-rose-600 transition ml-0.5 font-bold"
                      title="Xóa từ khóa"
                    >
                      ×
                    </button>
                  )}
                </span>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

