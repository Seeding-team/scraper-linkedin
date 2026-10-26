"use client";

import React from "react";
import { ConversationItem } from "../types";
import { CrmQuote360Panel } from "@/components/all-platform/inbox/CrmQuote360Panel";
import {
  Building2,
  ChevronRight,
  ChevronLeft,
  RefreshCw,
  Eye,
  Plus,
  Search,
  FileEdit,
  UserX,
  FilePlus2,
} from "lucide-react";

interface Crm360PanelProps {
  conversation: ConversationItem | null;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onOpenCreateDeal: () => void;
  onOpenCreateQuote: () => void;
  onOpenFindCustomer: () => void;
  onOpenCreateCustomer?: () => void;
  onOpenAddNote: () => void;
  onRefreshCrmData?: () => void;
  onViewCustomerProfile?: () => void;
  onViewAllDeals?: () => void;
  onViewAllQuotes?: () => void;
  onViewDealDetail?: (deal: any) => void;
  onViewQuoteDetail?: (quote: any) => void;
}

export const Crm360Panel: React.FC<Crm360PanelProps> = ({
  conversation,
  isCollapsed,
  onToggleCollapse,
  onOpenCreateDeal,
  onOpenCreateQuote,
  onOpenFindCustomer,
  onOpenCreateCustomer,
  onOpenAddNote,
  onRefreshCrmData,
  onViewCustomerProfile,
  onViewAllDeals,
  onViewAllQuotes,
  onViewDealDetail,
  onViewQuoteDetail,
}) => {
  if (isCollapsed) {
    return (
      <div className="flex h-full w-10 flex-col items-center border-l border-slate-200 bg-slate-50 py-3 gap-3 shrink-0 select-none">
        <button
          onClick={onToggleCollapse}
          className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-100 transition shadow-2xs"
          title="Mở rộng CRM 360"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <div className="h-px w-6 bg-slate-200 my-0.5" />
        <span className="rotate-90 text-[10px] font-bold uppercase tracking-wider text-slate-400 whitespace-nowrap">
          CRM 360
        </span>
      </div>
    );
  }

  if (!conversation) {
    return (
      <div className="flex h-full w-[330px] shrink-0 flex-col border-l border-slate-200 bg-white font-sans">
        <div className="flex h-11 items-center justify-between border-b border-slate-100 px-3 py-1.5">
          <h2 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
            <span>CRM 360</span>
          </h2>
          <button
            onClick={onToggleCollapse}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
            title="Thu gọn CRM 360"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center p-6 text-center text-xs text-slate-400 gap-2">
          <div className="rounded-full bg-slate-100 p-3 text-slate-300">
            <Building2 className="h-6 w-6" />
          </div>
          <p className="font-semibold text-slate-600">Chưa chọn hội thoại</p>
          <p className="max-w-[220px] text-[11px] text-slate-400">
            Thông tin khách hàng, cơ hội và báo giá sẽ hiển thị khi bạn chọn một hội thoại.
          </p>
        </div>
      </div>
    );
  }

  const { crmData, opportunity, quote } = conversation;

  return (
    <div className="flex h-full w-[330px] shrink-0 flex-col border-l border-slate-200 bg-white font-sans">
      {/* Pane Header */}
      <div className="flex h-11 items-center justify-between border-b border-slate-100 px-3 py-1.5">
        <h2 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
          <span>CRM 360</span>
        </h2>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => onRefreshCrmData && onRefreshCrmData()}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
            title="Làm mới"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onToggleCollapse}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
            title="Thu gọn CRM 360"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2.5 space-y-3">
        {/* Section 1: Customer Profile */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <h3 className="text-[11px] font-bold text-slate-600 uppercase tracking-wide">
              Khách hàng
            </h3>
            {crmData.matched && (
              <button
                onClick={() => onViewCustomerProfile && onViewCustomerProfile()}
                className="text-[10px] font-semibold text-[var(--color-markee-primary,#c2185b)] hover:underline cursor-pointer"
              >
                Xem chi tiết
              </button>
            )}
          </div>

          {crmData.matched ? (
            <div className="rounded-xl border border-slate-200/90 bg-slate-50/60 p-2.5 space-y-2 shadow-2xs">
              <div className="flex items-start gap-2">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-rose-100 text-[var(--color-markee-primary,#c2185b)] font-bold">
                  <Building2 className="h-4.5 w-4.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <h4 className="truncate text-xs font-bold text-slate-900">{crmData.name}</h4>
                  <div className="flex flex-wrap items-center gap-1 pt-0.5">
                    <span className="rounded bg-emerald-100 px-1.5 py-0.2 text-[9px] font-bold text-emerald-700">
                      Đã liên kết CRM
                    </span>
                    <span className="text-[10px] text-slate-500 font-medium">
                      {crmData.statusLabel}
                    </span>
                  </div>
                </div>
              </div>

              <div className="space-y-1 text-xs text-slate-600 border-t border-slate-200/60 pt-2">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 text-[10px]">SĐT</span>
                  <span className="font-semibold text-slate-800 text-[11px]">
                    {crmData.phone || "---"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 text-[10px]">Email</span>
                  <span className="font-medium text-slate-800 truncate max-w-[160px] text-[11px]">
                    {crmData.email || "---"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 text-[10px]">Địa chỉ</span>
                  <span className="text-slate-700 font-medium truncate max-w-[160px] text-[11px]">
                    {crmData.address || "---"}
                  </span>
                </div>
                <div className="flex items-center justify-between pt-0.5">
                  <span className="text-slate-400 text-[10px]">Người phụ trách</span>
                  <div className="flex items-center gap-1">
                    {crmData.ownerAvatar && (
                      <img
                        src={crmData.ownerAvatar}
                        alt=""
                        className="h-3.5 w-3.5 rounded-full object-cover"
                      />
                    )}
                    <span className="font-semibold text-slate-800 text-[10px]">
                      {crmData.ownerName}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1.5 pt-1 border-t border-slate-200/60">
                <button
                  onClick={() => onViewCustomerProfile && onViewCustomerProfile()}
                  className="flex-1 flex items-center justify-center gap-1 rounded-md border border-slate-200 bg-white py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 transition cursor-pointer"
                >
                  <Eye className="h-3 w-3 text-slate-500" />
                  <span>Xem hồ sơ</span>
                </button>
                <button
                  onClick={onOpenAddNote}
                  className="flex-1 flex items-center justify-center gap-1 rounded-md border border-slate-200 bg-white py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 transition cursor-pointer"
                >
                  <FileEdit className="h-3 w-3 text-slate-500" />
                  <span>Tạo ghi chú</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-3 text-center space-y-1.5">
              <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-full bg-amber-50 text-amber-600">
                <UserX className="h-4.5 w-4.5" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-slate-800">Chưa liên kết khách hàng</h4>
                <p className="text-[10px] text-slate-500 pt-0.5">
                  Khách hàng này chưa có hồ sơ trên CRM
                </p>
              </div>
              <div className="flex items-center gap-1.5 pt-1 justify-center">
                <button
                  onClick={onOpenFindCustomer}
                  className="flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 transition cursor-pointer"
                >
                  <Search className="h-3 w-3 text-slate-500" />
                  <span>Tìm khách hàng</span>
                </button>
                <button
                  onClick={onOpenCreateCustomer}
                  className="flex items-center gap-1 rounded-md bg-[var(--color-markee-primary,#c2185b)] px-2.5 py-1 text-[11px] font-bold text-white hover:opacity-90 transition shadow-2xs cursor-pointer"
                >
                  <Plus className="h-3 w-3" />
                  <span>Tạo mới</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Section 2: Open Opportunities */}
        <div className="space-y-1.5 border-t border-slate-100 pt-2.5">
          <div className="flex items-center justify-between">
            <h3 className="text-[11px] font-bold text-slate-600 uppercase tracking-wide">
              Cơ hội đang mở
            </h3>
            {opportunity && (
              <button
                onClick={() => onViewAllDeals && onViewAllDeals()}
                className="text-[10px] font-semibold text-[var(--color-markee-primary,#c2185b)] hover:underline cursor-pointer"
              >
                Xem tất cả
              </button>
            )}
          </div>

          {opportunity ? (
            <div
              onClick={() => onViewDealDetail && onViewDealDetail(opportunity)}
              className="rounded-xl border border-slate-200 bg-white p-2.5 space-y-1.5 shadow-2xs hover:border-[var(--color-markee-primary,#c2185b)] cursor-pointer transition"
            >
              <div className="flex items-center justify-between">
                <span className="font-bold text-xs text-slate-800">{opportunity.code}</span>
                <span className="font-bold text-xs text-[var(--color-markee-primary,#c2185b)]">
                  {opportunity.amount}
                </span>
              </div>
              <div className="flex items-center justify-between text-[10px]">
                <span className="rounded bg-amber-100 px-1.5 py-0.2 font-semibold text-amber-800">
                  {opportunity.stage}
                </span>
                <span className="text-slate-400">Cập nhật: {opportunity.updatedAt}</span>
              </div>
              <div className="flex items-center justify-between text-[10px] border-t border-slate-100 pt-1 text-slate-600">
                <span>{opportunity.winRate} Th.Mái</span>
                <span className="font-medium text-slate-800">{opportunity.ownerName}</span>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-2.5 text-center space-y-1">
              <p className="text-[11px] text-slate-500">Chưa có cơ hội nào cho khách hàng này</p>
              <button
                onClick={onOpenCreateDeal}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--color-markee-primary,#c2185b)] hover:underline pt-0.5 cursor-pointer"
              >
                <Plus className="h-3 w-3" />
                <span>Tạo cơ hội mới</span>
              </button>
            </div>
          )}
        </div>

        {/* Section 3: Linked Quotes (Real-Data CrmQuote360Panel) */}
        <CrmQuote360Panel
          currentLead={
            conversation.crmData?.matched
              ? ({
                  id: (conversation.crmData as any).customerId || conversation.id,
                  customer_name: conversation.crmData.name,
                  company_name: (conversation.crmData as any).company,
                  phone: conversation.crmData.phone,
                  email: conversation.crmData.email,
                  address: conversation.crmData.address,
                  leaded_by: conversation.crmData.ownerName,
                } as any)
              : null
          }
          channelName="Omnichannel"
          openConvId={conversation.id}
          onOpenCreateQuote={onOpenCreateQuote}
          onOpenViewQuote={(quoteId) => {
            if (onViewQuoteDetail) {
              onViewQuoteDetail({ id: quoteId });
            } else {
              onOpenCreateQuote();
            }
          }}
          onSendQuoteMessage={(content) => {
            // Send quote link/PDF message into active conversation
            const event = new CustomEvent("omnichannel_send_quote", { detail: { text: content } });
            window.dispatchEvent(event);
          }}
        />

        {/* Section 4: Quick Actions Grid */}
        <div className="space-y-1.5 border-t border-slate-100 pt-2.5">
          <h3 className="text-[11px] font-bold text-slate-600 uppercase tracking-wide">
            Thao tác nhanh
          </h3>

          <div className="grid grid-cols-2 gap-1.5">
            <button
              onClick={onOpenCreateDeal}
              className="flex items-center justify-center gap-1 rounded-lg bg-[var(--color-markee-primary,#c2185b)] py-1.5 px-2 text-[11px] font-bold text-white transition hover:opacity-90 shadow-2xs"
            >
              <Plus className="h-3 w-3" />
              <span>Tạo cơ hội</span>
            </button>

            <button
              onClick={onOpenCreateQuote}
              className="flex items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white py-1.5 px-2 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              <FilePlus2 className="h-3 w-3 text-slate-500" />
              <span>Tạo báo giá</span>
            </button>

            <button
              onClick={onOpenFindCustomer}
              className="flex items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white py-1.5 px-2 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              <Search className="h-3 w-3 text-slate-500" />
              <span>Tìm khách hàng</span>
            </button>

            <button
              onClick={onOpenAddNote}
              className="flex items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white py-1.5 px-2 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              <FileEdit className="h-3 w-3 text-slate-500" />
              <span>Thêm ghi chú</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
