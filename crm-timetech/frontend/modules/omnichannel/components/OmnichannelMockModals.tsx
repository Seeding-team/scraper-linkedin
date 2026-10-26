"use client";

import React, { useEffect, useState } from "react";
import { X, CheckCircle, Plus, Search, FileEdit, FilePlus, Download, Send, ExternalLink, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { CHANNEL_CAPABILITIES } from "../constants/channelCapabilities";
import { seedingCrmRepository } from "@/modules/crm/repositories/SeedingCrmRepository";
import type { CrmCustomerSummary, CrmCustomerStatus } from "@/modules/crm/types";

const CUSTOMER_STATUS_LABEL: Record<CrmCustomerStatus, string> = {
  new_lead: "Tiềm năng",
  following: "Đang bán",
  current_customer: "Đã mua",
  not_fit: "Ngừng hoạt động",
};

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

const BaseModal: React.FC<ModalProps> = ({ isOpen, onClose, title, children }) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-2xs p-4 select-none"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl border border-slate-100 font-sans space-y-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 className="text-sm font-bold text-slate-900">{title}</h3>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div>{children}</div>
      </div>
    </div>
  );
};

export const ConnectAccountMockModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onSelectChannelConnect: (channel: string) => void;
}> = ({ isOpen, onClose, onSelectChannelConnect }) => {
  const activeChannels = [
    { id: "zalo", cap: CHANNEL_CAPABILITIES.zalo, color: "bg-[#0068FF]" },
    { id: "facebook", cap: CHANNEL_CAPABILITIES.facebook, color: "bg-[#1877F2]" },
    { id: "telegram", cap: CHANNEL_CAPABILITIES.telegram, color: "bg-[#229ED9]" },
  ];

  const comingSoonChannels = [
    { id: "whatsapp", cap: CHANNEL_CAPABILITIES.whatsapp, color: "bg-[#25D366]" },
    { id: "viber", cap: CHANNEL_CAPABILITIES.viber, color: "bg-[#7360F2]" },
    { id: "linkedin", cap: CHANNEL_CAPABILITIES.linkedin, color: "bg-[#0A66C2]" },
  ];

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} title="Kết nối tài khoản xã hội">
      <div className="space-y-3">
        <p className="text-xs font-medium text-slate-600">
          Kết nối thêm tài khoản để quản lý hội thoại tập trung tại Omnichannel Inbox.
        </p>

        {/* Khả dụng */}
        <div className="space-y-2">
          {activeChannels.map(({ id, cap, color }) => (
            <div
              key={id}
              onClick={() => {
                onSelectChannelConnect(id);
                onClose();
              }}
              className="flex items-center justify-between p-3 rounded-xl border border-slate-200 bg-white hover:border-[var(--color-markee-primary,#c2185b)] hover:bg-rose-50/20 transition cursor-pointer shadow-2xs group"
            >
              <div className="flex items-center gap-3">
                <div className={cn("h-9 w-9 rounded-xl flex items-center justify-center text-white text-xs font-bold shadow-2xs", color)}>
                  {id.substring(0, 2).toUpperCase()}
                </div>
                <div>
                  <h4 className="text-xs font-bold text-slate-900 group-hover:text-[var(--color-markee-primary,#c2185b)] transition">{cap.categoryName}</h4>
                  <p className="text-[10px] text-slate-500">{cap.description}</p>
                </div>
              </div>
              <span className="flex items-center gap-1 text-xs font-bold text-[var(--color-markee-primary,#c2185b)]">
                <span>{cap.connectActionLabel}</span>
              </span>
            </div>
          ))}
        </div>

        {/* Divider */}
        <div className="pt-2 border-t border-slate-200">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            SẮP RA MẮT
          </span>
        </div>

        {/* Đang phát triển */}
        <div className="space-y-2">
          {comingSoonChannels.map(({ id, cap, color }) => (
            <div
              key={id}
              className="flex items-center justify-between p-3 rounded-xl border border-slate-200/60 bg-slate-50/70 opacity-60 cursor-not-allowed select-none"
            >
              <div className="flex items-center gap-3">
                <div className={cn("h-9 w-9 rounded-xl flex items-center justify-center text-white text-xs font-bold opacity-70", color)}>
                  {id.substring(0, 2).toUpperCase()}
                </div>
                <div>
                  <h4 className="text-xs font-bold text-slate-700">{cap.categoryName}</h4>
                  <p className="text-[10px] font-medium text-amber-700">{cap.badgeText}</p>
                </div>
              </div>
              <span className="rounded bg-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                {cap.connectActionLabel}
              </span>
            </div>
          ))}
        </div>
      </div>
    </BaseModal>
  );
};

export const QuickRepliesMockModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onInsertTemplate: (text: string) => void;
}> = ({ isOpen, onClose, onInsertTemplate }) => {
  const [activeCategory, setActiveCategory] = useState("chao_hoi");
  const [search, setSearch] = useState("");

  const templates = [
    { id: "1", cat: "chao_hoi", title: "Chào hỏi khách mới", text: "Chào anh/chị, bên em là Markee AI. Em có thể hỗ trợ thông tin gì cho anh/chị ạ?" },
    { id: "2", cat: "chao_hoi", title: "Cảm ơn khách hàng", text: "Dạ em cảm ơn anh/chị đã phản hồi ạ! Bên em sẽ hỗ trợ anh/chị ngay nhé." },
    { id: "3", cat: "bao_gia", title: "Báo giá sản phẩm", text: "Dạ em gửi anh/chị báo giá chi tiết sản phẩm Markee Pro bao gồm các tính năng quản lý đa kênh ạ." },
    { id: "4", cat: "follow_up", title: "Hẹn demo", text: "Dạ bên em có thể sắp xếp buổi demo 15 phút qua Google Meet vào chiều mai cho anh/chị được không ạ?" },
    { id: "5", cat: "cham_soc", title: "Follow-up báo giá", text: "Dạ anh/chị đã xem qua bản báo giá em gửi chưa ạ? Nếu có thắc mắc anh/chị cứ nhắn em nhé!" },
  ];

  const filtered = templates.filter((t) => {
    if (activeCategory !== "all" && t.cat !== activeCategory) return false;
    if (search.trim() && !t.title.toLowerCase().includes(search.toLowerCase()) && !t.text.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} title="Mẫu trả lời nhanh">
      <div className="space-y-3">
        {/* Categories Pills */}
        <div className="flex items-center gap-1 overflow-x-auto pb-1 text-xs">
          {[
            { id: "chao_hoi", label: "Chào hỏi" },
            { id: "bao_gia", label: "Báo giá" },
            { id: "follow_up", label: "Follow-up" },
            { id: "cham_soc", label: "Chăm sóc" },
          ].map((cat) => (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={cn(
                "rounded-full px-2.5 py-1 text-[11px] font-semibold transition shrink-0",
                activeCategory === cat.id
                  ? "bg-[var(--color-markee-primary,#c2185b)] text-white shadow-2xs"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              )}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm mẫu tin nhắn..."
            className="w-full rounded-lg border border-slate-200 pl-8 pr-3 py-1.5 text-xs focus:border-[var(--color-markee-primary,#c2185b)] focus:outline-none"
          />
        </div>

        {/* Templates list */}
        <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
          {filtered.map((t) => (
            <div
              key={t.id}
              className="p-2.5 rounded-xl border border-slate-200/80 bg-slate-50/50 hover:bg-white transition space-y-1"
            >
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-slate-800">{t.title}</h4>
                <button
                  onClick={() => {
                    onInsertTemplate(t.text);
                    onClose();
                  }}
                  className="rounded-md bg-rose-50 border border-rose-200 px-2 py-0.5 text-[10px] font-bold text-[var(--color-markee-primary,#c2185b)] hover:bg-rose-100 transition"
                >
                  Chèn
                </button>
              </div>
              <p className="text-[11px] text-slate-600 leading-snug">{t.text}</p>
            </div>
          ))}
        </div>
      </div>
    </BaseModal>
  );
};

export const QuotePreviewMockModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  quoteCode?: string;
  customerName?: string;
  onSendViaChannel: (channel: string) => void;
}> = ({ isOpen, onClose, quoteCode = "QUA-2026-146", customerName = "ABC FOOD", onSendViaChannel }) => {
  return (
    <BaseModal isOpen={isOpen} onClose={onClose} title={`Xem & gửi báo giá ${quoteCode}`}>
      <div className="space-y-4">
        {/* Document Preview Box */}
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-200 pb-2">
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-lg bg-[var(--color-markee-primary,#c2185b)] flex items-center justify-center text-white font-black text-xs">
                M
              </div>
              <div>
                <h4 className="text-xs font-bold text-slate-900">BÁO GIÁ DỊCH VỤ CRM DOANH NGHIỆP</h4>
                <p className="text-[10px] text-slate-500">Mã: {quoteCode} • Ngày: 02/10/2026</p>
              </div>
            </div>
          </div>

          <div className="text-xs text-slate-700 space-y-1">
            <p><strong>Khách hàng nhận:</strong> {customerName}</p>
            <p><strong>Giải pháp:</strong> Gói phần mềm Enterprise Omnichannel CRM</p>
            <p><strong>Tổng giá trị:</strong> <span className="font-bold text-[var(--color-markee-primary,#c2185b)]">50.000.000 VNĐ</span></p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="space-y-2">
          <button
            onClick={() => {
              const blob = new Blob([`BÁO GIÁ: ${quoteCode}\nKhách hàng: ${customerName}`], { type: "text/plain;charset=utf-8" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `${quoteCode}.txt`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Tải file PDF</span>
          </button>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => {
                onSendViaChannel("zalo");
                onClose();
              }}
              className="flex items-center justify-center gap-1.5 rounded-lg bg-[#0068FF] py-2 text-xs font-bold text-white hover:opacity-90 transition"
            >
              <Send className="h-3.5 w-3.5" />
              <span>Gửi qua Zalo</span>
            </button>

            <button
              onClick={() => {
                onSendViaChannel("telegram");
                onClose();
              }}
              className="flex items-center justify-center gap-1.5 rounded-lg bg-[#229ED9] py-2 text-xs font-bold text-white hover:opacity-90 transition"
            >
              <Send className="h-3.5 w-3.5" />
              <span>Gửi qua Telegram</span>
            </button>
          </div>
        </div>
      </div>
    </BaseModal>
  );
};

export const CreateDealMockModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  customerName?: string;
  onSubmitMock: (dealName: string, amount: string) => void;
}> = ({ isOpen, onClose, customerName, onSubmitMock }) => {
  const [dealName, setDealName] = useState(`Dự án triển khai CRM - ${customerName || "Khách hàng"}`);
  const [amount, setAmount] = useState("50.000.000đ");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmitMock(dealName, amount);
    onClose();
  };

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} title="Tạo cơ hội nhanh (Reuse DealFormModal)">
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Khách hàng *
          </label>
          <input
            type="text"
            readOnly
            value={customerName || "ABC FOOD"}
            className="w-full rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-800 font-semibold"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Tên cơ hội *
          </label>
          <input
            type="text"
            value={dealName}
            onChange={(e) => setDealName(e.target.value)}
            className="w-full rounded-lg border border-slate-200 p-2 text-xs text-slate-800 focus:border-[var(--color-markee-primary,#c2185b)] focus:outline-none"
            required
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Giá trị dự kiến *
          </label>
          <input
            type="text"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full rounded-lg border border-slate-200 p-2 text-xs text-slate-800 focus:border-[var(--color-markee-primary,#c2185b)] focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Giai đoạn *
          </label>
          <select className="w-full rounded-lg border border-slate-200 p-2 text-xs text-slate-800 bg-white">
            <option>Tư vấn ban đầu</option>
            <option>Báo giá</option>
            <option>Thương lượng</option>
            <option>Thắng (Won)</option>
          </select>
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            Hủy
          </button>
          <button
            type="submit"
            className="rounded-lg bg-[var(--color-markee-primary,#c2185b)] px-4 py-1.5 text-xs font-bold text-white hover:opacity-90"
          >
            Tạo cơ hội
          </button>
        </div>
      </form>
    </BaseModal>
  );
};

export const CreateQuoteMockModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  customerName?: string;
  onSubmitMock: (quoteCode: string, amount: string) => void;
}> = ({ isOpen, onClose, customerName, onSubmitMock }) => {
  const [step, setStep] = useState(1);
  const [amount, setAmount] = useState("50.000.000đ");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmitMock("QUA-2026-146", amount);
    onClose();
  };

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} title="Tạo báo giá (Wizard 3 Bước)">
      <form onSubmit={handleSubmit} className="space-y-3">
        {/* Wizard Steps indicator */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-2 text-[11px] font-semibold">
          <span className={cn("px-2 py-0.5 rounded-full", step === 1 ? "bg-rose-100 text-[var(--color-markee-primary,#c2185b)] font-bold" : "text-slate-400")}>1. Thông tin</span>
          <span className={cn("px-2 py-0.5 rounded-full", step === 2 ? "bg-rose-100 text-[var(--color-markee-primary,#c2185b)] font-bold" : "text-slate-400")}>2. Sản phẩm</span>
          <span className={cn("px-2 py-0.5 rounded-full", step === 3 ? "bg-rose-100 text-[var(--color-markee-primary,#c2185b)] font-bold" : "text-slate-400")}>3. Xem lại</span>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Khách hàng
          </label>
          <input
            type="text"
            readOnly
            value={customerName || "ABC FOOD"}
            className="w-full rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-800 font-semibold"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Cơ hội liên quan
          </label>
          <input
            type="text"
            readOnly
            value="OPP-2026-089 - Dự án CRM ABC FOOD"
            className="w-full rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-800"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Tên báo giá *
          </label>
          <input
            type="text"
            readOnly
            value={`Báo giá Markee Pro - ${customerName || "ABC FOOD"}`}
            className="w-full rounded-lg border border-slate-200 p-2 text-xs text-slate-800"
          />
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            Hủy
          </button>
          <button
            type="submit"
            className="rounded-lg bg-[var(--color-markee-primary,#c2185b)] px-4 py-1.5 text-xs font-bold text-white hover:opacity-90"
          >
            Tiếp tục
          </button>
        </div>
      </form>
    </BaseModal>
  );
};

export const FindCustomerMockModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onLinkCustomer: (name: string) => void;
  onOpenCreateCustomer?: () => void;
  initialSearchQuery?: string;
}> = ({ isOpen, onClose, onLinkCustomer, onOpenCreateCustomer, initialSearchQuery }) => {
  const [searchTerm, setSearchTerm] = useState(initialSearchQuery || "");
  const [results, setResults] = useState<CrmCustomerSummary[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (initialSearchQuery) {
      setSearchTerm(initialSearchQuery);
    }
  }, [initialSearchQuery]);

  useEffect(() => {
    const keyword = searchTerm.trim();
    if (keyword.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    const timer = window.setTimeout(() => {
      seedingCrmRepository
        .quickSearchCustomers(keyword, 8)
        .then((rows) => {
          if (alive) setResults(rows);
        })
        .catch(() => {
          if (alive) setResults([]);
        })
        .finally(() => {
          if (alive) setLoading(false);
        });
    }, 300);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [searchTerm]);

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} title="Tìm & liên kết khách hàng">
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Nhập SĐT, email hoặc tên khách..."
            className="w-full rounded-lg border border-slate-200 pl-8 pr-3 py-1.5 text-xs focus:border-[var(--color-markee-primary,#c2185b)] focus:outline-none"
          />
        </div>

        <div className="divide-y divide-slate-100 max-h-52 overflow-y-auto border border-slate-100 rounded-xl bg-white">
          {searchTerm.trim().length < 2 ? (
            <div className="p-3 text-[11px] text-slate-400">Nhập ít nhất 2 ký tự để tìm...</div>
          ) : loading ? (
            <div className="p-3 text-[11px] text-slate-400">Đang tìm...</div>
          ) : results.length === 0 ? (
            <div className="p-3 text-[11px] text-slate-400">Không tìm thấy khách hàng nào khớp.</div>
          ) : (
            results.map((item) => {
              const displayName = item.companyName || item.customerName;
              const tag = item.status ? CUSTOMER_STATUS_LABEL[item.status] : "Khách hàng";
              return (
                <div
                  key={item.id}
                  className="p-3 flex items-center justify-between hover:bg-slate-50 transition cursor-pointer"
                  onClick={() => {
                    onLinkCustomer(displayName);
                    onClose();
                  }}
                >
                  <div>
                    <div className="flex items-center gap-1.5">
                      <h4 className="text-xs font-bold text-slate-800">{displayName}</h4>
                      <span className="rounded bg-sky-100 text-sky-700 px-1.5 py-0.2 text-[9px] font-semibold">
                        {tag}
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-500 pt-0.5">
                      {item.phone || "—"} • {item.email || "—"}
                    </p>
                  </div>
                  <button className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-bold text-[var(--color-markee-primary,#c2185b)] hover:bg-rose-100 cursor-pointer">
                    Liên kết
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="pt-2 border-t border-slate-100">
          <button
            onClick={() => {
              if (onOpenCreateCustomer) onOpenCreateCustomer();
            }}
            className="flex items-center gap-1.5 text-xs font-bold text-[var(--color-markee-primary,#c2185b)] hover:underline cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Tạo khách hàng mới từ thông tin hiện tại</span>
          </button>
        </div>
      </div>
    </BaseModal>
  );
};

export const AddNoteMockModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onSubmitMock: (noteText: string) => void;
  isCrmMatched?: boolean;
  customerName?: string;
  onOpenFindCustomer?: () => void;
  onOpenCreateCustomer?: () => void;
}> = ({
  isOpen,
  onClose,
  onSubmitMock,
  isCrmMatched = true,
  customerName,
  onOpenFindCustomer,
  onOpenCreateCustomer,
}) => {
  const [note, setNote] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (note.trim()) {
      onSubmitMock(note);
      onClose();
      setNote("");
    }
  };

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} title="Thêm ghi chú nội bộ">
      {!isCrmMatched ? (
        <div className="space-y-3 font-sans">
          <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-3.5 text-xs text-amber-800 space-y-1">
            <p className="font-bold text-slate-800">Cần liên kết hoặc tạo khách hàng trước khi thêm ghi chú.</p>
            <p className="text-[11px] text-slate-600 leading-relaxed">
              Ghi chú nội bộ cần được gắn liền với thông tin Khách hàng CRM để đảm bảo lưu trữ lịch sử tư vấn tập trung.
            </p>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={() => {
                onClose();
                if (onOpenFindCustomer) onOpenFindCustomer();
              }}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 transition cursor-pointer"
            >
              🔍 Tìm khách hàng
            </button>
            <button
              type="button"
              onClick={() => {
                onClose();
                if (onOpenCreateCustomer) onOpenCreateCustomer();
              }}
              className="rounded-lg bg-[var(--color-markee-primary,#c2185b)] px-3.5 py-1.5 text-xs font-bold text-white hover:opacity-95 transition cursor-pointer"
            >
              ➕ Tạo khách hàng
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3 font-sans">
          {customerName && (
            <p className="text-xs text-slate-500">
              Khách hàng: <strong className="text-slate-800">{customerName}</strong>
            </p>
          )}
          <textarea
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Nhập ghi chú nội bộ (ví dụ: Khách hẹn trao đổi báo giá vào 14h chiều mai...)"
            className="w-full rounded-xl border border-slate-200 p-2.5 text-xs text-slate-800 focus:border-[var(--color-markee-primary,#c2185b)] focus:outline-none"
            autoFocus
          />

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={!note.trim()}
              className="rounded-lg bg-[var(--color-markee-primary,#c2185b)] px-4 py-1.5 text-xs font-bold text-white hover:opacity-90 disabled:opacity-50 transition"
            >
              Lưu ghi chú
            </button>
          </div>
        </form>
      )}
    </BaseModal>
  );
};
