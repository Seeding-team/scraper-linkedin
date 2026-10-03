"use client";

import React from "react";
import { X } from "lucide-react";
import { ZaloAccountsPageContent } from "@/components/all-platform/zalo/dashboard/ZaloAccountsPageContent";

export const ZaloConnectModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}> = ({ isOpen, onClose, onSuccess }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-3 sm:p-6 overflow-hidden animate-in fade-in duration-150">
      <div className="relative w-full max-w-6xl h-[90vh] rounded-2xl bg-white shadow-2xl border border-slate-200 flex flex-col overflow-hidden">
        {/* Header Bar */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 bg-slate-50 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#0068FF] text-white font-bold text-xs shadow-xs">
              Zalo
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">Quản lý & Kết nối Tài khoản Zalo</h3>
              <p className="text-[11px] text-slate-500">Quản lý trạng thái, thêm tài khoản mới & phân quyền</p>
            </div>
          </div>
          <button
            onClick={() => {
              onSuccess();
              onClose();
            }}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 transition"
            title="Đóng"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto bg-[#f8f9fa]">
          <ZaloAccountsPageContent />
        </div>
      </div>
    </div>
  );
};
