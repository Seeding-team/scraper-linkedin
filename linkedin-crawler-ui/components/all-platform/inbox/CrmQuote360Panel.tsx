"use client";

import React, { useEffect, useState, useCallback } from "react";
import {
  FileText,
  Plus,
  Eye,
  Send,
  Paperclip,
  CheckCircle2,
  Clock,
  AlertCircle,
  FileSpreadsheet,
  ExternalLink,
  MoreVertical,
  ChevronRight,
  Download,
  Share2,
} from "lucide-react";
import { seedingQuoteRepository } from "@/modules/quotes/repositories/SeedingQuoteRepository";
import type { Quote } from "@/modules/quotes/types";
import { customerLeadService, type Customer } from "@/services/customer-lead.service";
import { cn } from "@/lib/utils";

interface CrmQuote360PanelProps {
  currentLead: Customer | null;
  channelName: "Facebook" | "Zalo" | "Telegram" | "Omnichannel";
  openConvId: string;
  onOpenCreateQuote: () => void;
  onOpenViewQuote: (quoteId: string) => void;
  onSendQuoteMessage: (content: string) => void;
  showToast?: (msg: string, ok: boolean) => void;
}

export function CrmQuote360Panel({
  currentLead,
  channelName,
  openConvId,
  onOpenCreateQuote,
  onOpenViewQuote,
  onSendQuoteMessage,
  showToast,
}: CrmQuote360PanelProps) {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedQuoteForSend, setSelectedQuoteForSend] = useState<Quote | null>(null);
  const [showSendModal, setShowSendModal] = useState(false);
  const [menuOpenQuoteId, setMenuOpenQuoteId] = useState<string | null>(null);
  const [activities, setActivities] = useState<any[]>([]);

  const loadQuotes = useCallback(async () => {
    if (!currentLead?.id) {
      setQuotes([]);
      return;
    }
    setLoading(true);
    try {
      const res = await seedingQuoteRepository.getQuotesByPhase({
        customerId: currentLead.id,
      });
      setQuotes(res?.items || []);
    } catch {
      try {
        const fallbackList = await seedingQuoteRepository.getQuotes({
          dealId: currentLead.id,
        });
        setQuotes(fallbackList || []);
      } catch {
        setQuotes([]);
      }
    } finally {
      setLoading(false);
    }
  }, [currentLead?.id]);

  const loadActivities = useCallback(async () => {
    if (!currentLead?.id) {
      setActivities([]);
      return;
    }
    try {
      const res = await customerLeadService.getActivityLog(currentLead.id, { limit: 10 });
      setActivities(res.items || []);
    } catch {
      setActivities([]);
    }
  }, [currentLead?.id]);

  useEffect(() => {
    void loadQuotes();
    void loadActivities();
  }, [loadQuotes, loadActivities]);

  const formatVND = (val?: number | null) => {
    if (val === null || val === undefined) return "0 đ";
    return val.toLocaleString("vi-VN") + " đ";
  };

  const getStatusBadge = (status?: string) => {
    if (status === "approved" || status === "da_duyet") {
      return <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 border border-emerald-200">Đã duyệt</span>;
    }
    if (status === "sent" || status === "da_gui") {
      return <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700 border border-blue-200">Đã gửi</span>;
    }
    if (status === "pending" || status === "in_progress") {
      return <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 border border-amber-200">Chờ duyệt</span>;
    }
    return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600 border border-slate-200">Nháp</span>;
  };

  const handleSendQuote = async (quote: Quote, mode: "link" | "pdf" | "card") => {
    if (!quote) return;
    const code = quote.code || quote.quoteNumber || quote.id.slice(0, 8);
    const amount = quote.grandTotal ?? quote.totalAmount ?? 0;
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const publicUrl = `${origin}/public/quotes/${quote.id}`;

    let msgContent = "";
    if (mode === "link") {
      msgContent = `📄 Báo giá #${code} — ${formatVND(amount)}\nLink xem trực tuyến: ${publicUrl}`;
    } else if (mode === "pdf") {
      msgContent = `📎 Báo giá #${code}.pdf (${(amount ? (amount / 1000).toFixed(0) : "1.2")} MB)\nTải file PDF: ${publicUrl}`;
    } else {
      msgContent = `📄 Báo giá #${code}\nGiá trị: ${formatVND(amount)}\nXem chi tiết tại: ${publicUrl}`;
    }

    onSendQuoteMessage(msgContent);

    // Record activity in CRM 360
    if (currentLead?.id) {
      try {
        await customerLeadService.addNote(
          currentLead.id,
          `Đã gửi báo giá #${code} (${formatVND(amount)}) qua ${channelName}`
        );
        void loadActivities();
      } catch {
        // quiet
      }
    }

    if (showToast) {
      showToast(`Đã gửi báo giá #${code} qua ${channelName}`, true);
    }
    setShowSendModal(false);
  };

  if (!currentLead) {
    return (
      <div className="space-y-2.5 pb-3 border-b border-slate-100">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">BÁO GIÁ LIÊN QUAN (0)</span>
          <button onClick={onOpenCreateQuote} className="text-[11px] font-bold text-[#d81b60] hover:underline flex items-center gap-1">
            <Plus size={12} /> Tạo mới
          </button>
        </div>
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/40 p-3 text-center space-y-2">
          <FileSpreadsheet className="mx-auto size-6 text-slate-300" />
          <div className="text-xs text-slate-500 font-medium">Chưa có dữ liệu do chưa liên kết khách hàng</div>
          <div className="grid grid-cols-2 gap-1.5 pt-1">
            <button
              onClick={onOpenCreateQuote}
              className="flex items-center justify-center gap-1 rounded-xl bg-[#d81b60] py-1.5 text-[11px] font-bold text-white hover:bg-[#c2185b] transition shadow-2xs"
            >
              <Plus size={12} /> Tạo báo giá
            </button>
            <button
              onClick={onOpenCreateQuote}
              className="flex items-center justify-center gap-1 rounded-xl border border-slate-200 bg-white py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
            >
              <Paperclip size={12} /> Gửi link báo giá
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 pb-3 border-b border-slate-100">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
          BÁO GIÁ LIÊN QUAN ({quotes.length})
        </span>
        <button
          onClick={onOpenCreateQuote}
          className="text-[11px] font-bold text-[#d81b60] hover:underline flex items-center gap-1"
        >
          <Plus size={12} /> Tạo mới
        </button>
      </div>

      {loading ? (
        <div className="py-4 text-center text-xs text-slate-400">Đang tải báo giá...</div>
      ) : quotes.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/40 p-3.5 text-center space-y-2.5">
          <FileSpreadsheet className="mx-auto size-7 text-slate-300" />
          <div className="text-xs font-medium text-slate-600">Chưa có báo giá cho hội thoại này</div>
          
          <div className="grid grid-cols-2 gap-1.5 pt-1">
            <button
              onClick={onOpenCreateQuote}
              className="flex items-center justify-center gap-1 rounded-xl bg-[#d81b60] py-1.5 text-[11px] font-bold text-white hover:bg-[#c2185b] transition shadow-2xs"
            >
              <Plus size={12} /> Tạo báo giá
            </button>
            <button
              onClick={onOpenCreateQuote}
              className="flex items-center justify-center gap-1 rounded-xl border border-slate-200 bg-white py-1.5 text-[11px] font-bold text-slate-700 hover:bg-slate-50"
            >
              <Paperclip size={12} /> Gửi link báo giá
            </button>
          </div>

          <button
            onClick={onOpenCreateQuote}
            className="w-full flex items-center justify-center gap-1 rounded-xl border border-slate-200 bg-white py-1.5 text-[11px] font-bold text-slate-700 hover:bg-slate-50"
          >
            <FileText size={12} /> Gửi PDF báo giá
          </button>
        </div>
      ) : (
        <div className="space-y-2.5">
          {quotes.slice(0, 3).map((quote) => {
            const code = quote.code || quote.quoteNumber || quote.id.slice(0, 8);
            const amount = quote.grandTotal ?? quote.totalAmount ?? 0;
            const dateStr = quote.createdAt ? new Date(quote.createdAt).toLocaleDateString("vi-VN") : "";
            return (
              <div
                key={quote.id}
                className="group relative rounded-2xl border border-slate-200/80 bg-white p-3 shadow-2xs transition hover:border-[#d81b60]/40"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="flex size-8 items-center justify-center rounded-xl bg-purple-100 text-purple-700 font-bold shrink-0">
                      <FileText size={16} />
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-slate-900">#{code}</span>
                        {getStatusBadge(quote.status)}
                      </div>
                      <div className="text-[11px] font-semibold text-slate-700 mt-0.5">
                        {formatVND(amount)} {dateStr ? `· ${dateStr}` : ""}
                      </div>
                    </div>
                  </div>

                  <div className="relative">
                    <button
                      onClick={() => setMenuOpenQuoteId(menuOpenQuoteId === quote.id ? null : quote.id)}
                      className="p-1 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100"
                    >
                      <MoreVertical size={14} />
                    </button>

                    {menuOpenQuoteId === quote.id && (
                      <div className="absolute right-0 top-6 z-50 w-44 rounded-xl border border-slate-200 bg-white p-1 shadow-xl text-xs font-medium space-y-0.5">
                        <button
                          onClick={() => {
                            setMenuOpenQuoteId(null);
                            onOpenViewQuote(quote.id);
                          }}
                          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-slate-50 text-slate-700"
                        >
                          <Eye size={13} /> Xem báo giá
                        </button>
                        <button
                          onClick={() => {
                            setMenuOpenQuoteId(null);
                            handleSendQuote(quote, "link");
                          }}
                          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-slate-50 text-slate-700"
                        >
                          <Share2 size={13} /> Gửi link báo giá
                        </button>
                        <button
                          onClick={() => {
                            setMenuOpenQuoteId(null);
                            handleSendQuote(quote, "pdf");
                          }}
                          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-slate-50 text-slate-700"
                        >
                          <Download size={13} /> Gửi PDF báo giá
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-1.5 mt-2.5 border-t border-slate-100 pt-2">
                  <button
                    onClick={() => onOpenViewQuote(quote.id)}
                    className="flex items-center justify-center gap-1 rounded-xl border border-slate-200 bg-white py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 transition"
                  >
                    <Eye size={13} /> Xem báo giá
                  </button>
                  <button
                    onClick={() => {
                      setSelectedQuoteForSend(quote);
                      setShowSendModal(true);
                    }}
                    className="flex items-center justify-center gap-1 rounded-xl bg-[#d81b60] py-1.5 text-xs font-bold text-white hover:bg-[#c2185b] transition shadow-2xs"
                  >
                    <Send size={13} /> Gửi báo giá
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-1.5 mt-1.5">
                  <button
                    onClick={() => handleSendQuote(quote, "link")}
                    className="flex items-center justify-center gap-1 rounded-xl border border-slate-200/80 bg-slate-50 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 transition"
                  >
                    <Paperclip size={12} /> Gửi link báo giá
                  </button>
                  <button
                    onClick={() => handleSendQuote(quote, "pdf")}
                    className="flex items-center justify-center gap-1 rounded-xl border border-slate-200/80 bg-slate-50 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 transition"
                  >
                    <FileText size={12} /> Gửi PDF
                  </button>
                </div>
              </div>
            );
          })}

          <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-100">
            <button
              onClick={() => (quotes[0] ? handleSendQuote(quotes[0], "link") : onOpenCreateQuote())}
              className="flex items-center justify-center gap-1 rounded-xl border border-slate-200 bg-white py-1.5 text-[11px] font-bold text-slate-700 hover:bg-slate-50"
            >
              <Paperclip size={12} /> Gửi link báo giá
            </button>
            <button
              onClick={() => (quotes[0] ? handleSendQuote(quotes[0], "pdf") : onOpenCreateQuote())}
              className="flex items-center justify-center gap-1 rounded-xl border border-slate-200 bg-white py-1.5 text-[11px] font-bold text-slate-700 hover:bg-slate-50"
            >
              <FileText size={12} /> Gửi PDF
            </button>
          </div>
        </div>
      )}

      {/* Modal Modal Preview & Send Quote */}
      {showSendModal && selectedQuoteForSend && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-900">Xem & Gửi báo giá cho khách</h3>
              <button
                onClick={() => setShowSendModal(false)}
                className="text-slate-400 hover:text-slate-600 font-bold"
              >
                ✕
              </button>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-900">
                  Mã báo giá: #{selectedQuoteForSend.code || selectedQuoteForSend.quoteNumber || selectedQuoteForSend.id.slice(0, 8)}
                </span>
                {getStatusBadge(selectedQuoteForSend.status)}
              </div>
              <div className="text-sm font-bold text-[#d81b60]">
                {formatVND(selectedQuoteForSend.grandTotal ?? selectedQuoteForSend.totalAmount)}
              </div>
              <div className="text-xs text-slate-500">
                Khách nhận: <strong>{currentLead.customer_name || currentLead.company_name}</strong> ({channelName})
              </div>
            </div>

            <div className="space-y-2">
              <button
                onClick={() => handleSendQuote(selectedQuoteForSend, "link")}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-[#d81b60] py-2.5 text-xs font-bold text-white shadow-2xs hover:bg-[#c2185b] transition"
              >
                <Send size={14} /> Gửi báo giá ngay qua {channelName}
              </button>
              <button
                onClick={() => handleSendQuote(selectedQuoteForSend, "pdf")}
                className="w-full flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
              >
                <Download size={14} /> Gửi dưới dạng PDF đính kèm
              </button>
              <button
                onClick={() => {
                  setShowSendModal(false);
                  onOpenViewQuote(selectedQuoteForSend.id);
                }}
                className="w-full flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition"
              >
                <Eye size={14} /> Chỉnh sửa / Xem chi tiết Quote Workspace
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
