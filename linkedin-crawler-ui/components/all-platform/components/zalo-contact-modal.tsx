"use client";

import React, { useState, useEffect } from "react";
import { FiX, FiMessageSquare, FiExternalLink, FiPhone, FiCheck, FiAlertCircle, FiSend } from "react-icons/fi";
import { useZaloAccountOptions } from "@/components/all-platform/zalo/centralized-shared/useZaloAccountOptions";
import { findZaloUser, createZaloUserThread, sendZaloMessage } from "@/services/zaloCrawlerService";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

interface ZaloContactModalProps {
  open: boolean;
  onClose: () => void;
  phoneNumber: string;
  zaloDisplayName?: string;
  postContent?: string;
  groupName?: string;
  postUrl?: string;
}

export function ZaloContactModal({
  open,
  onClose,
  phoneNumber,
  zaloDisplayName,
  postContent,
  groupName,
  postUrl,
}: ZaloContactModalProps) {
  const router = useRouter();
  const { accounts, selectedAccountId, setSelectedAccountId, loading } = useZaloAccountOptions();
  
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);

  // Chuẩn bị tin nhắn chào hỏi mẫu thông minh
  useEffect(() => {
    if (open) {
      const gName = groupName ? ` trong nhóm "${groupName}"` : "";
      const defaultMsg = `Chào bạn, mình thấy bài viết của bạn${gName}. Mình liên hệ qua Zalo để tư vấn và hỗ trợ bạn nhé!`;
      setMessage(defaultMsg);
      setStatusText(null);
      setSubmitting(false);
    }
  }, [open, groupName]);

  if (!open) return null;

  // Xử lý gửi tin nhắn & tạo thread Zalo qua Bridge
  const handleStartChat = async () => {
    if (!selectedAccountId) {
      toast.error("Vui lòng chọn một tài khoản Zalo để nhắn tin!");
      return;
    }
    if (!phoneNumber) {
      toast.error("Không tìm thấy số điện thoại hợp lệ!");
      return;
    }

    setSubmitting(true);
    setStatusText("Đang tìm kiếm tài khoản Zalo theo SĐT...");

    try {
      // 1. Tìm user Zalo theo số điện thoại
      const found = await findZaloUser(selectedAccountId, phoneNumber, "phone");
      const targetUid = found?.userId || found?.uid;

      if (!targetUid) {
        throw new Error("Không tìm thấy người dùng Zalo với số điện thoại này hoặc người dùng chặn tìm kiếm qua SĐT.");
      }

      setStatusText(`Đã tìm thấy Zalo: ${found.displayName || phoneNumber}. Đang mở hộp thoại...`);

      // 2. Mở / tạo thread chat 1-1
      const threadRes = await createZaloUserThread(selectedAccountId, targetUid);
      const convId = threadRes?.conversationId || threadRes?.conv_id || targetUid;

      // 3. Nếu người dùng có nhập tin nhắn, gửi tin nhắn đi
      if (message.trim()) {
        setStatusText("Đang gửi tin nhắn chào hỏi...");
        await sendZaloMessage(selectedAccountId, convId, message.trim()).catch((err) => {
          console.warn("Lỗi gửi tin nhắn Zalo ban đầu:", err);
        });
      }

      toast.success(`Đã kết nối Zalo với ${found.displayName || phoneNumber}!`);
      onClose();

      // 4. Chuyển hướng tới trang Zalo Inbox của hệ thống
      router.push(`/all-platform/zalo-inbox?conv=${encodeURIComponent(convId)}&acc=${encodeURIComponent(selectedAccountId)}`);
    } catch (err: any) {
      console.error("Zalo connect error:", err);
      const errMsg = err?.message || "Không thể kết nối tới Zalo qua số điện thoại này.";
      toast.error(errMsg);
      setStatusText(errMsg);
    } finally {
      setSubmitting(false);
    }
  };

  const cleanPhone = phoneNumber.replace(/\D/g, "");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div
        className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 px-5 py-4 bg-sky-50/50 dark:bg-sky-950/20">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-full bg-sky-600 text-white flex items-center justify-center font-bold text-sm shadow-xs">
              Z
            </div>
            <div>
              <h3 className="font-bold text-slate-800 dark:text-slate-100 text-base leading-tight">
                Nhắn tin Zalo tới khách hàng
              </h3>
              <p className="text-xs text-sky-700 dark:text-sky-300 font-semibold mt-0.5">
                📞 {phoneNumber} {zaloDisplayName ? `· Zalo: ${zaloDisplayName}` : ""}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <FiX className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto space-y-4">
          {/* Chọn tài khoản Zalo gửi */}
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5 uppercase tracking-wider">
              Chọn tài khoản Zalo gửi tin:
            </label>
            {loading ? (
              <div className="py-4 text-center text-xs text-slate-500 animate-pulse">
                Đang tải danh sách tài khoản Zalo...
              </div>
            ) : accounts.length === 0 ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/20 p-3.5 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2">
                <FiAlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
                <div>
                  <p className="font-semibold">Chưa có tài khoản Zalo nào đang kết nối trên hệ thống.</p>
                  <p className="text-[11px] mt-1 text-amber-700 dark:text-amber-400">
                    Bạn có thể mở trực tiếp ứng dụng Zalo Web/App bên dưới hoặc kết nối thêm tài khoản Zalo trong mục Cài đặt.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {accounts.map((acc) => {
                  const isSelected = selectedAccountId === acc.account_id;
                  return (
                    <div
                      key={acc.account_id}
                      onClick={() => setSelectedAccountId(acc.account_id)}
                      className={`flex items-center justify-between p-2.5 rounded-xl border cursor-pointer transition-all ${
                        isSelected
                          ? "border-sky-500 bg-sky-50/70 dark:bg-sky-950/30 text-sky-900 dark:text-sky-100 shadow-xs ring-1 ring-sky-500"
                          : "border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 text-slate-700 dark:text-slate-300"
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        {acc.avatar ? (
                          <img
                            src={acc.avatar}
                            alt=""
                            className="w-8 h-8 rounded-full object-cover shrink-0 border border-slate-200"
                          />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-sky-100 text-sky-700 font-bold text-xs flex items-center justify-center shrink-0">
                            {(acc.display_name || "Z").charAt(0).toUpperCase()}
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="text-xs font-bold truncate leading-tight">
                            {acc.display_name || "Tài khoản Zalo"}
                          </p>
                          <p className="text-[11px] text-muted-foreground truncate">
                            {acc.phone_number || acc.account_id}
                          </p>
                        </div>
                      </div>
                      <div className="shrink-0 flex items-center gap-1.5">
                        <span className="inline-block w-2 h-2 rounded-full bg-emerald-500"></span>
                        <span className="text-[10px] text-emerald-600 font-medium">Sẵn sàng</span>
                        {isSelected && <FiCheck className="w-4 h-4 text-sky-600 ml-1" />}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Ô soạn lời chào */}
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5 uppercase tracking-wider">
              Lời chào mẫu gửi tới khách hàng:
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              placeholder="Nhập nội dung tin nhắn mở đầu..."
              className="w-full text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-2.5 text-slate-800 dark:text-slate-100 placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky-500 resize-none"
            />
          </div>

          {statusText && (
            <div className="rounded-lg bg-sky-50 dark:bg-sky-950/30 p-2.5 text-xs text-sky-800 dark:text-sky-200 flex items-center gap-2 animate-in fade-in">
              <span className="inline-block w-2 h-2 rounded-full bg-sky-500 animate-ping"></span>
              <span>{statusText}</span>
            </div>
          )}

          {/* Các nút hành động phụ */}
          <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="text-muted-foreground font-medium text-[11px]">Cách liên hệ khác:</span>
            <div className="flex items-center gap-2">
              <a
                href={`https://zalo.me/${cleanPhone}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium transition-colors text-[11px]"
              >
                Mở Zalo.me <FiExternalLink className="w-3 h-3 text-slate-400" />
              </a>
              <a
                href={`tel:${cleanPhone}`}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium transition-colors text-[11px]"
              >
                <FiPhone className="w-3 h-3 text-slate-400" /> Gọi điện
              </a>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-slate-100 dark:border-slate-800 px-5 py-3.5 bg-slate-50/50 dark:bg-slate-900/50">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors"
          >
            Đóng
          </button>
          <button
            type="button"
            onClick={handleStartChat}
            disabled={submitting || accounts.length === 0}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold text-white bg-sky-600 hover:bg-sky-500 shadow-md shadow-sky-600/20 active:scale-95 disabled:opacity-50 disabled:pointer-events-none transition-all"
          >
            {submitting ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                <span>Đang xử lý...</span>
              </>
            ) : (
              <>
                <FiSend className="w-3.5 h-3.5" />
                <span>Nhắn tin qua Zalo</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
