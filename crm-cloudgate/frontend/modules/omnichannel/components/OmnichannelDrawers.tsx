"use client";

import React, { useState } from "react";
import {
  X,
  ExternalLink,
  Building2,
  Phone,
  Mail,
  MapPin,
  Plus,
  Search,
  FileText,
  Download,
  Send,
  Calendar,
  User,
  DollarSign,
  Tag,
  CheckCircle2,
  Clock,
  Eye,
  FilePlus2,
  ChevronRight,
} from "lucide-react";
import { ConversationItem } from "../types";

// Base Drawer Shell Component
interface BaseDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  fullPageUrl?: string;
  width?: string;
  children: React.ReactNode;
}

export const BaseOmniDrawer: React.FC<BaseDrawerProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  fullPageUrl = "/all-platform/crm",
  width = "w-[500px]",
  children,
}) => {
  if (!isOpen) return null;

  const handleOpenFullPage = () => {
    window.open(fullPageUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-xs transition-opacity font-sans select-none">
      <div
        className="fixed inset-0"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className={`relative flex h-full ${width} max-w-full flex-col bg-white shadow-2xl z-10 animate-in slide-in-from-right duration-200`}>
        {/* Header */}
        <div className="flex h-14 items-center justify-between border-b border-slate-200 px-4 py-3 bg-slate-50/80 shrink-0">
          <div className="min-w-0 flex-1 pr-2">
            <h2 className="truncate text-sm font-bold text-slate-800 flex items-center gap-2">
              <span>{title}</span>
            </h2>
            {subtitle && (
              <p className="truncate text-[11px] font-medium text-slate-500 pt-0.5">{subtitle}</p>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Secondary Action: Open Full Page */}
            <button
              onClick={handleOpenFullPage}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:border-slate-400 shadow-2xs transition"
              title="Mở trang CRM đầy đủ trong tab mới"
            >
              <span>Mở trang đầy đủ</span>
              <ExternalLink className="h-3 w-3 text-slate-500" />
            </button>

            <button
              onClick={onClose}
              className="rounded-lg p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600 transition"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">{children}</div>
      </div>
    </div>
  );
};

// 1. Customer 360 Drawer
export const Customer360Drawer: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  conversation: ConversationItem | null;
  onOpenCreateDeal: () => void;
  onOpenCreateQuote: () => void;
  onOpenAddNote: () => void;
}> = ({ isOpen, onClose, conversation, onOpenCreateDeal, onOpenCreateQuote, onOpenAddNote }) => {
  const [activeTab, setActiveTab] = useState<"overview" | "contacts" | "deals" | "quotes">("overview");

  if (!conversation) return null;
  const { crmData, opportunity, quote } = conversation;

  return (
    <BaseOmniDrawer
      isOpen={isOpen}
      onClose={onClose}
      title={`Hồ sơ khách hàng: ${crmData.name || conversation.customerName}`}
      subtitle={`Mã khách hàng: CUST-${conversation.id.substring(0, 6).toUpperCase()} · Khách hàng tiềm năng`}
      width="w-[540px]"
    >
      {/* Drawer Inner Nav Tabs */}
      <div className="flex items-center border-b border-slate-200 gap-4 text-xs font-semibold text-slate-500">
        <button
          onClick={() => setActiveTab("overview")}
          className={`pb-2 border-b-2 transition ${activeTab === "overview" ? "border-[var(--color-markee-primary,#c2185b)] text-[var(--color-markee-primary,#c2185b)]" : "border-transparent hover:text-slate-800"}`}
        >
          Tổng quan
        </button>
        <button
          onClick={() => setActiveTab("contacts")}
          className={`pb-2 border-b-2 transition ${activeTab === "contacts" ? "border-[var(--color-markee-primary,#c2185b)] text-[var(--color-markee-primary,#c2185b)]" : "border-transparent hover:text-slate-800"}`}
        >
          Liên hệ
        </button>
        <button
          onClick={() => setActiveTab("deals")}
          className={`pb-2 border-b-2 transition ${activeTab === "deals" ? "border-[var(--color-markee-primary,#c2185b)] text-[var(--color-markee-primary,#c2185b)]" : "border-transparent hover:text-slate-800"}`}
        >
          Cơ hội
        </button>
        <button
          onClick={() => setActiveTab("quotes")}
          className={`pb-2 border-b-2 transition ${activeTab === "quotes" ? "border-[var(--color-markee-primary,#c2185b)] text-[var(--color-markee-primary,#c2185b)]" : "border-transparent hover:text-slate-800"}`}
        >
          Báo giá
        </button>
      </div>

      {activeTab === "overview" && (
        <div className="space-y-4 pt-1">
          {/* Main Info Card */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 space-y-3">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-rose-100 text-[var(--color-markee-primary,#c2185b)] font-bold">
                <Building2 className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">{crmData.name || conversation.customerName}</h3>
                <div className="flex items-center gap-2 pt-0.5">
                  <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                    Đã liên kết CRM
                  </span>
                  <span className="text-xs text-slate-500 font-medium">
                    {crmData.statusLabel || "Khách hàng mới"}
                  </span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs border-t border-slate-200/80 pt-3">
              <div className="flex items-center gap-2">
                <Phone className="h-3.5 w-3.5 text-slate-400" />
                <span className="text-slate-800 font-semibold">{crmData.phone || "0912 345 678"}</span>
              </div>
              <div className="flex items-center gap-2">
                <Mail className="h-3.5 w-3.5 text-slate-400" />
                <span className="text-slate-800 font-medium truncate">{crmData.email || "customer@example.vn"}</span>
              </div>
              <div className="flex items-center gap-2 col-span-2">
                <MapPin className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                <span className="text-slate-700 truncate">{crmData.address || "Quận 1, TP. Hồ Chí Minh"}</span>
              </div>
            </div>
          </div>

          {/* Connected Social Accounts */}
          <div className="rounded-xl border border-slate-200 p-3.5 space-y-2">
            <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wide">Kênh mạng xã hội đồng bộ</h4>
            <div className="flex flex-wrap gap-2 pt-1">
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-blue-50/60 px-2.5 py-1 text-xs font-medium text-blue-700">
                <span>Zalo Personal:</span>
                <span className="font-bold">{conversation.customerName}</span>
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-sky-50/60 px-2.5 py-1 text-xs font-medium text-sky-700">
                <span>Facebook Messenger</span>
              </span>
            </div>
          </div>

          {/* Quick Action Buttons */}
          <div className="flex gap-2">
            <button
              onClick={onOpenCreateDeal}
              className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-[var(--color-markee-primary,#c2185b)] py-2 px-3 text-xs font-bold text-white hover:bg-[#a3134c] transition shadow-2xs"
            >
              <Plus className="h-4 w-4" />
              <span>+ Tạo cơ hội</span>
            </button>
            <button
              onClick={onOpenCreateQuote}
              className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white py-2 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition shadow-2xs"
            >
              <FilePlus2 className="h-4 w-4 text-slate-500" />
              <span>+ Tạo báo giá</span>
            </button>
            <button
              onClick={onOpenAddNote}
              className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white py-2 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition shadow-2xs"
            >
              <FileText className="h-4 w-4 text-slate-500" />
              <span>Ghi chú</span>
            </button>
          </div>
        </div>
      )}

      {activeTab === "contacts" && (
        <div className="space-y-3 pt-1">
          <div className="rounded-lg border border-slate-200 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-xs text-slate-800">{conversation.customerName}</span>
              <span className="rounded bg-rose-100 text-[var(--color-markee-primary,#c2185b)] px-2 py-0.5 text-[10px] font-bold">Người đại diện</span>
            </div>
            <p className="text-xs text-slate-600">Chức vụ: Giám đốc kĩ thuật</p>
            <p className="text-xs text-slate-600">SĐT: {crmData.phone || "0912 345 678"}</p>
          </div>
        </div>
      )}

      {activeTab === "deals" && (
        <div className="space-y-3 pt-1">
          {opportunity ? (
            <div className="rounded-xl border border-slate-200 p-3 space-y-2 bg-white">
              <div className="flex items-center justify-between">
                <span className="font-bold text-xs text-slate-900">{opportunity.code} - {opportunity.name}</span>
                <span className="font-bold text-xs text-[var(--color-markee-primary,#c2185b)]">{opportunity.amount}</span>
              </div>
              <div className="flex justify-between text-xs text-slate-500">
                <span>Giai đoạn: <strong className="text-slate-800">{opportunity.stage}</strong></span>
                <span>Tỷ lệ win: <strong>{opportunity.winRate}</strong></span>
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-400 text-center py-6">Chưa có cơ hội nào cho khách hàng này.</p>
          )}
        </div>
      )}

      {activeTab === "quotes" && (
        <div className="space-y-3 pt-1">
          {quote ? (
            <div className="rounded-xl border border-slate-200 p-3 space-y-2 bg-white">
              <div className="flex items-center justify-between">
                <span className="font-bold text-xs text-slate-900">{quote.code}</span>
                <span className="font-bold text-xs text-[var(--color-markee-primary,#c2185b)]">{quote.amount}</span>
              </div>
              <div className="flex justify-between text-xs text-slate-500">
                <span>Trạng thái: <strong className="text-purple-700">{quote.status}</strong></span>
                <span>Ngày tạo: <strong>{quote.createdAt}</strong></span>
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-400 text-center py-6">Chưa có báo giá nào cho khách hàng này.</p>
          )}
        </div>
      )}
    </BaseOmniDrawer>
  );
};

// 2. Deal List Drawer
export const DealListDrawer: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  customerName: string;
  opportunity: any;
  onOpenCreateDeal: () => void;
  onSelectDeal: (deal: any) => void;
}> = ({ isOpen, onClose, customerName, opportunity, onOpenCreateDeal, onSelectDeal }) => {
  const [search, setSearch] = useState("");

  return (
    <BaseOmniDrawer
      isOpen={isOpen}
      onClose={onClose}
      title={`Cơ hội (Deals) — Khách hàng: ${customerName}`}
      subtitle="Danh sách các cơ hội bán hàng đang quản lý"
      width="w-[500px]"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            placeholder="Tìm theo mã hoặc tên cơ hội..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-slate-200 pl-8 pr-3 py-1.5 text-xs focus:border-[var(--color-markee-primary,#c2185b)] outline-hidden"
          />
        </div>
        <button
          onClick={onOpenCreateDeal}
          className="flex items-center gap-1 rounded-lg bg-[var(--color-markee-primary,#c2185b)] px-3 py-1.5 text-xs font-bold text-white shadow-2xs hover:bg-[#a3134c] transition shrink-0"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>Tạo mới</span>
        </button>
      </div>

      <div className="space-y-2 pt-2">
        {opportunity ? (
          <div
            onClick={() => onSelectDeal(opportunity)}
            className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-2 hover:border-[var(--color-markee-primary,#c2185b)] cursor-pointer transition shadow-2xs"
          >
            <div className="flex items-center justify-between">
              <span className="font-bold text-xs text-slate-900">{opportunity.code}</span>
              <span className="font-bold text-xs text-[var(--color-markee-primary,#c2185b)]">{opportunity.amount}</span>
            </div>
            <p className="text-xs font-semibold text-slate-800">{opportunity.name || `Dự án CRM - ${customerName}`}</p>
            <div className="flex items-center justify-between text-[11px] pt-1 border-t border-slate-100">
              <span className="rounded bg-amber-100 px-2 py-0.5 font-bold text-amber-800">{opportunity.stage}</span>
              <span className="text-slate-500">Tỷ lệ thắng: {opportunity.winRate}</span>
            </div>
          </div>
        ) : (
          <div className="text-center py-10 space-y-2">
            <p className="text-xs text-slate-400">Chưa có cơ hội nào được ghi nhận.</p>
            <button
              onClick={onOpenCreateDeal}
              className="text-xs font-semibold text-[var(--color-markee-primary,#c2185b)] hover:underline"
            >
              + Tạo cơ hội đầu tiên
            </button>
          </div>
        )}
      </div>
    </BaseOmniDrawer>
  );
};

// 3. Quote List Drawer
export const QuoteListDrawer: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  customerName: string;
  quote: any;
  onOpenCreateQuote: () => void;
  onSelectQuote: (quote: any) => void;
}> = ({ isOpen, onClose, customerName, quote, onOpenCreateQuote, onSelectQuote }) => {
  const [search, setSearch] = useState("");

  return (
    <BaseOmniDrawer
      isOpen={isOpen}
      onClose={onClose}
      title={`Báo giá (Quotes) — Khách hàng: ${customerName}`}
      subtitle="Tất cả các bản báo giá đính kèm hoặc đã gửi"
      width="w-[500px]"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            placeholder="Tìm theo mã báo giá..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-slate-200 pl-8 pr-3 py-1.5 text-xs focus:border-[var(--color-markee-primary,#c2185b)] outline-hidden"
          />
        </div>
        <button
          onClick={onOpenCreateQuote}
          className="flex items-center gap-1 rounded-lg bg-[var(--color-markee-primary,#c2185b)] px-3 py-1.5 text-xs font-bold text-white shadow-2xs hover:bg-[#a3134c] transition shrink-0"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>Tạo mới</span>
        </button>
      </div>

      <div className="space-y-2 pt-2">
        {quote ? (
          <div
            onClick={() => onSelectQuote(quote)}
            className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-2 hover:border-[var(--color-markee-primary,#c2185b)] cursor-pointer transition shadow-2xs"
          >
            <div className="flex items-center justify-between">
              <span className="font-bold text-xs text-slate-900">{quote.code}</span>
              <span className="font-bold text-xs text-[var(--color-markee-primary,#c2185b)]">{quote.amount}</span>
            </div>
            <div className="flex items-center justify-between text-[11px] pt-1 border-t border-slate-100">
              <span className="rounded bg-purple-100 px-2 py-0.5 font-bold text-purple-700">{quote.status}</span>
              <span className="text-slate-400">Ngày tạo: {quote.createdAt}</span>
            </div>
          </div>
        ) : (
          <div className="text-center py-10 space-y-2">
            <p className="text-xs text-slate-400">Chưa có báo giá nào liên quan.</p>
            <button
              onClick={onOpenCreateQuote}
              className="text-xs font-semibold text-[var(--color-markee-primary,#c2185b)] hover:underline"
            >
              + Tạo báo giá mới
            </button>
          </div>
        )}
      </div>
    </BaseOmniDrawer>
  );
};

// 4. Quote Preview Drawer
export const QuotePreviewDrawer: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  quote: any;
  customerName?: string;
  onSendViaChannel?: (channelName: string) => void;
}> = ({ isOpen, onClose, quote, customerName = "Khách hàng", onSendViaChannel }) => {
  if (!quote) return null;

  const quoteCode = quote.code || "QUA-2026-146";
  const amount = quote.amount || "50.000.000đ";

  return (
    <BaseOmniDrawer
      isOpen={isOpen}
      onClose={onClose}
      title={`Báo giá: ${quoteCode}`}
      subtitle={`Khách hàng: ${customerName} · Trạng thái: ${quote.status || "Draft"}`}
      width="w-[540px]"
    >
      {/* Quick Action Toolbar */}
      <div className="flex items-center gap-2 p-3 bg-slate-50 border border-slate-200 rounded-xl">
        <button
          onClick={() => {
            if (onSendViaChannel) onSendViaChannel("channel");
          }}
          className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-[var(--color-markee-primary,#c2185b)] py-2 px-3 text-xs font-bold text-white hover:bg-[#a3134c] transition shadow-2xs"
        >
          <Send className="h-3.5 w-3.5" />
          <span>Gửi qua Chat</span>
        </button>

        <button
          onClick={() => {
            const blob = new Blob([`BÁO GIÁ: ${quoteCode}\nKhách hàng: ${customerName}\nTổng tiền: ${amount}`], { type: "text/plain;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `${quoteCode}.txt`;
            a.click();
            URL.revokeObjectURL(url);
          }}
          className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white py-2 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition shadow-2xs"
        >
          <Download className="h-3.5 w-3.5 text-slate-500" />
          <span>Tải PDF</span>
        </button>
      </div>

      {/* Quote Summary Cards */}
      <div className="rounded-xl border border-slate-200 p-4 space-y-3 bg-white">
        <div className="flex items-center justify-between border-b border-slate-100 pb-2">
          <div>
            <span className="text-[10px] uppercase font-bold text-slate-400">Mã báo giá</span>
            <p className="text-sm font-bold text-slate-900">{quoteCode}</p>
          </div>
          <div className="text-right">
            <span className="text-[10px] uppercase font-bold text-slate-400">Tổng giá trị</span>
            <p className="text-sm font-bold text-[var(--color-markee-primary,#c2185b)]">{amount}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <span className="text-slate-400 text-[10px]">Khách hàng nhận:</span>
            <p className="font-semibold text-slate-800">{customerName}</p>
          </div>
          <div>
            <span className="text-slate-400 text-[10px]">Người phụ trách:</span>
            <p className="font-semibold text-slate-800">{quote.ownerName || "Nguyễn Thị Mai"}</p>
          </div>
        </div>
      </div>

      {/* Mock Line Items */}
      <div className="space-y-2">
        <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wide">Chi tiết hạng mục</h4>
        <div className="rounded-xl border border-slate-200 overflow-hidden text-xs">
          <table className="w-full text-left">
            <thead className="bg-slate-50 text-[10px] font-bold text-slate-500 uppercase border-b border-slate-200">
              <tr>
                <th className="p-2">Hạng mục</th>
                <th className="p-2 text-center">SL</th>
                <th className="p-2 text-right">Thành tiền</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              <tr>
                <td className="p-2 font-medium text-slate-800">Gói giải pháp Markee Omnichannel Enterprise</td>
                <td className="p-2 text-center">1</td>
                <td className="p-2 text-right font-semibold text-slate-900">{amount}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* PDF Document Preview Placeholder */}
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-center space-y-2">
        <FileText className="h-8 w-8 text-slate-400 mx-auto" />
        <p className="text-xs font-bold text-slate-700">Xem bản xem trước PDF (Document Preview)</p>
        <p className="text-[11px] text-slate-400 max-w-xs mx-auto">
          Tài liệu đã được ký số và sẵn sàng gửi trực tiếp tới khách hàng qua Zalo hoặc Messenger.
        </p>
      </div>
    </BaseOmniDrawer>
  );
};
