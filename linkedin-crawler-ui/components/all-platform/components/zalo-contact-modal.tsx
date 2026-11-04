"use client";

import React, { useState, useEffect } from "react";
import { FiX, FiMessageSquare, FiExternalLink, FiPhone, FiCheck, FiAlertCircle, FiSend } from "react-icons/fi";
import { useZaloAccountOptions } from "@/components/all-platform/zalo/centralized-shared/useZaloAccountOptions";
import { findZaloUser, createZaloUserThread, sendZaloMessage } from "@/services/zaloCrawlerService";
import { allPlatformQuickCommentService, allPlatformQuickInboxService, allPlatformPostsService } from "@/services/all-platform.service";
import { QuickCommentTemplate, QuickInboxTemplate } from "@/types/unified.types";

interface TemplateItem {
  id: string;
  title: string;
  label?: string;
  content: string;
  source: "inbox" | "comment";
}
import { useAppAuth } from "@/contexts/AppAuthContext";
import { toast } from "sonner";
import { extractPostNeed } from "@/services/aiExtractService";

interface ZaloContactModalProps {
  open: boolean;
  onClose: () => void;
  phoneNumber: string;
  zaloDisplayName?: string;
  postContent?: string;
  groupName?: string;
  postUrl?: string;
  postId?: string;
  platform?: string;
  onSentSuccess?: (info: { phoneNumber: string; sentBy: string; zaloDisplayName?: string }) => void;
}

export function ZaloContactModal({
  open,
  onClose,
  phoneNumber,
  zaloDisplayName,
  postContent,
  groupName,
  postUrl,
  postId,
  platform,
  onSentSuccess,
}: ZaloContactModalProps) {
  const { user } = useAppAuth();
  const { accounts, selectedAccountId, setSelectedAccountId, loading } = useZaloAccountOptions();
  
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);

  // Danh sách mẫu câu chào Zalo & Mặc định cá nhân
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [defaultTemplateId, setDefaultTemplateId] = useState<string | null>(null);
  const [extractedNeed, setExtractedNeed] = useState<string | null>(null);
  const [isExtractingNeed, setIsExtractingNeed] = useState(false);

  const userEmail = user?.email || "default_user";
  const defaultStorageKey = `zalo_default_greeting_id_${userEmail}`;

  // Tải danh sách mẫu tin nhắn inbox Zalo & mẫu câu Zalo từ thư viện chung
  useEffect(() => {
    if (!open) return;
    Promise.all([
      allPlatformQuickInboxService.getAll().catch(() => null),
      allPlatformQuickCommentService.getAll("zalo").catch(() => null),
    ]).then(([inboxRes, commentRes]) => {
      const list: TemplateItem[] = [];
      if (inboxRes?.success && Array.isArray(inboxRes.data)) {
        inboxRes.data.forEach((item) => {
          list.push({
            id: `inbox_${item.id}`,
            title: item.title,
            label: item.label,
            content: item.content,
            source: "inbox",
          });
        });
      }
      if (commentRes?.success && Array.isArray(commentRes.data)) {
        commentRes.data.forEach((item) => {
          list.push({
            id: `comment_${item.id}`,
            title: item.title,
            label: item.label,
            content: item.content,
            source: "comment",
          });
        });
      }
      setTemplates(list);
    }).catch(() => {});
  }, [open]);

  const handleReExtractNeed = async () => {
    if (!postContent && !postUrl) return;
    setIsExtractingNeed(true);
    try {
      const res = await extractPostNeed({
        content: postContent || "",
        group_name: groupName,
        post_url: postUrl,
      });
      if (res) {
        setExtractedNeed(res.need);
        setMessage(res.zalo_message);
        toast.success("AI đã tối ưu lại tin nhắn theo nhu cầu bài viết!");
      }
    } catch {
      toast.error("Không thể phân tích nội dung lúc này");
    } finally {
      setIsExtractingNeed(false);
    }
  };

  // Chuẩn bị tin nhắn chào hỏi mẫu thông minh và áp dụng mẫu mặc định của cá nhân
  useEffect(() => {
    if (open) {
      setStatusText(null);
      setSubmitting(false);

      const savedDefaultId = typeof window !== "undefined" ? localStorage.getItem(defaultStorageKey) : null;
      setDefaultTemplateId(savedDefaultId);

      // Tự động phân tích nhu cầu bằng AI và nhập link bài viết nếu có bài viết từ Post Feed
      if (postContent || postUrl) {
        setIsExtractingNeed(true);
        extractPostNeed({
          content: postContent || "",
          group_name: groupName,
          post_url: postUrl,
        })
          .then((res) => {
            if (res) {
              setExtractedNeed(res.need);
              // Nếu người dùng chưa chọn mẫu tùy chỉnh, tự động điền tin nhắn do AI soạn kèm nhu cầu và link bài viết
              if (!savedDefaultId) {
                setMessage(res.zalo_message);
              } else {
                const found = templates.find((t) => t.id === savedDefaultId);
                if (found) {
                  let formatted = found.content.replace(/\{group_name\}/g, groupName || "nhóm");
                  formatted = formatted.replace(/\{need\}/g, res.need);
                  if (postUrl && !formatted.includes(postUrl)) {
                    formatted = `${formatted}\nLink bài viết: ${postUrl}`;
                  }
                  setMessage(formatted);
                }
              }
            }
          })
          .catch(() => {})
          .finally(() => setIsExtractingNeed(false));
      } else {
        const gName = groupName ? ` trong nhóm "${groupName}"` : "";
        let fallbackMsg = `Chào bạn, mình thấy bài viết của bạn${gName}. Mình liên hệ qua Zalo để tư vấn và hỗ trợ bạn nhé!`;
        if (postUrl) {
          fallbackMsg = `${fallbackMsg}\nLink bài viết: ${postUrl}`;
        }
        if (savedDefaultId && templates.length > 0) {
          const found = templates.find((t) => t.id === savedDefaultId);
          if (found) {
            setSelectedTemplateId(found.id);
            let formatted = found.content.replace(/\{group_name\}/g, groupName || "nhóm");
            if (postUrl && !formatted.includes(postUrl)) {
              formatted = `${formatted}\nLink bài viết: ${postUrl}`;
            }
            setMessage(formatted);
            return;
          }
        }
        if (!message) {
          setMessage(fallbackMsg);
        }
      }
    }
  }, [open, groupName, templates, defaultStorageKey]);

  // Chọn mẫu câu
  const handleSelectTemplate = (tpl: TemplateItem) => {
    setSelectedTemplateId(tpl.id);
    let formatted = tpl.content.replace(/\{group_name\}/g, groupName || "nhóm");
    if (extractedNeed) {
      formatted = formatted.replace(/\{need\}/g, extractedNeed);
    }
    if (postUrl && !formatted.includes(postUrl)) {
      formatted = `${formatted}\nLink bài viết: ${postUrl}`;
    }
    setMessage(formatted);
    toast.success(`Đã chọn mẫu: "${tpl.title}"`);
  };

  // Thiết lập mẫu câu hiện tại làm mặc định cho cá nhân
  const handleSetAsDefault = (tplId: string) => {
    if (typeof window !== "undefined") {
      localStorage.setItem(defaultStorageKey, tplId);
      setDefaultTemplateId(tplId);
      const tpl = templates.find((t) => t.id === tplId);
      toast.success(`Đã đặt mẫu "${tpl?.title || "chào hỏi"}" làm mặc định Zalo cho bạn!`);
    }
  };

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
    const toastId = toast.loading(`Đang gửi tin nhắn qua Zalo tới ${phoneNumber}...`);

    try {
      // 1. Tìm user Zalo theo số điện thoại
      const found = await findZaloUser(selectedAccountId, phoneNumber, "phone");
      const targetUid = found?.user_id;

      if (!targetUid) {
        throw new Error("Số điện thoại chưa kích hoạt Zalo hoặc cài đặt chặn tìm kiếm qua số điện thoại.");
      }

      const dName = found.display_name || found.zalo_name || zaloDisplayName || "Khách hàng";
      setStatusText(`Đã tìm thấy Zalo: ${dName}. Đang gửi tin nhắn...`);

      // 2. Mở / tạo thread chat 1-1
      const threadRes = await createZaloUserThread(selectedAccountId, {
        user_id: targetUid,
        display_name: dName,
        avatar_url: found.avatar_url || null,
      });
      const convId = threadRes?.conversation_id || targetUid;

      // 3. Nếu người dùng có nhập tin nhắn, gửi tin nhắn đi
      if (message.trim()) {
        setStatusText("Đang gửi tin nhắn chào hỏi...");
        const sendRes = await sendZaloMessage(selectedAccountId, convId, { text: message.trim() });
        if (sendRes && (sendRes as any).error) {
          throw new Error((sendRes as any).error || "Tài khoản Zalo người nhận chặn tin nhắn từ người lạ.");
        }
      }

      const senderName = user?.name || (user?.email ? user.email.split("@")[0] : "Thành viên hệ thống");
      try {
        await allPlatformPostsService.recordZaloSent({
          post_id: postId,
          platform: platform || "facebook",
          phone_number: phoneNumber,
          zalo_display_name: dName,
          zalo_conversation_id: convId,
          message_content: message.trim(),
          sent_by: senderName,
        });
      } catch (recErr) {
        console.warn("Could not record zalo sent:", recErr);
      }

      if (onSentSuccess) {
        onSentSuccess({ phoneNumber, sentBy: senderName, zaloDisplayName: dName });
      }

      toast.success(`Đã nhắn tin với ${dName} (${phoneNumber}) thành công!`, { id: toastId, duration: 4000 });
      onClose();
    } catch (err: any) {
      console.error("Zalo connect error:", err);
      const rawMsg = err?.message || String(err || "");
      let reason = rawMsg;
      if (rawMsg.includes("not found") || rawMsg.includes("Không tìm thấy") || rawMsg.includes("404")) {
        reason = "số điện thoại chưa kích hoạt Zalo hoặc cài đặt chặn tìm kiếm qua số điện thoại";
      } else if (rawMsg.includes("stranger") || rawMsg.includes("người lạ") || rawMsg.includes("chặn") || rawMsg.includes("block")) {
        reason = "tài khoản Zalo khách hàng đang chặn nhận tin nhắn từ người lạ";
      } else if (rawMsg.includes("session") || rawMsg.includes("auth") || rawMsg.includes("login") || rawMsg.includes("401")) {
        reason = "phiên đăng nhập Zalo của tài khoản gửi đã hết hạn, vui lòng đăng nhập lại";
      }
      const fullError = `Nhắn tin thất bại do ${reason}`;
      toast.error(fullError, { id: toastId, duration: 6000 });
      setStatusText(fullError);
    } finally {
      setSubmitting(false);
    }
  };

  const cleanPhone = phoneNumber.replace(/\D/g, "");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 p-4 animate-in fade-in duration-150">
      <div
        className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 px-5 py-4 bg-rose-50/60 dark:bg-rose-950/20">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-full bg-[#be123c] text-white flex items-center justify-center font-bold text-sm shadow-xs">
              Z
            </div>
            <div>
              <h3 className="font-bold text-slate-800 dark:text-slate-100 text-base leading-tight">
                Nhắn tin Zalo tới khách hàng
              </h3>
              <p className="text-xs text-rose-700 dark:text-rose-300 font-semibold mt-0.5">
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
                          ? "border-[#be123c] bg-rose-50/70 dark:bg-rose-950/30 text-rose-950 dark:text-rose-100 shadow-xs ring-1 ring-[#be123c]"
                          : "border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 text-slate-700 dark:text-slate-300"
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        {(acc as any).avatar ? (
                          <img
                            src={(acc as any).avatar}
                            alt=""
                            className="w-8 h-8 rounded-full object-cover shrink-0 border border-slate-200"
                          />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-rose-100 text-[#be123c] font-bold text-xs flex items-center justify-center shrink-0">
                            {(((acc as any).display_name || acc.label) || "Z").charAt(0).toUpperCase()}
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="text-xs font-bold truncate leading-tight">
                            {((acc as any).display_name || acc.label) || "Tài khoản Zalo"}
                          </p>
                          <p className="text-[11px] text-muted-foreground truncate">
                            {(acc.phone || (acc as any).phone_number) || acc.account_id}
                          </p>
                        </div>
                      </div>
                      <div className="shrink-0 flex items-center gap-1.5">
                        <span className="inline-block w-2 h-2 rounded-full bg-emerald-500"></span>
                        <span className="text-[10px] text-emerald-600 font-medium">Sẵn sàng</span>
                        {isSelected && <FiCheck className="w-4 h-4 text-[#be123c] ml-1" />}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Bối cảnh bài viết & Nhu cầu bóc tách bằng AI */}
          {(postContent || postUrl || extractedNeed) && (
            <div className="rounded-xl border border-purple-200 dark:border-purple-800 bg-purple-50/70 dark:bg-purple-950/20 p-3 text-xs space-y-1.5 shadow-2xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-purple-900 dark:text-purple-200 flex items-center gap-1">
                  <span>✨ Nhu cầu khách (AI bóc tách):</span>
                  {isExtractingNeed && <span className="text-[10px] text-purple-600 animate-pulse">(Đang phân tích...)</span>}
                </span>
                <button
                  type="button"
                  onClick={handleReExtractNeed}
                  disabled={isExtractingNeed}
                  className="text-[11px] font-semibold text-purple-700 hover:text-purple-900 dark:text-purple-300 underline cursor-pointer"
                  title="Bấm để AI phân tích lại nhu cầu từ bài viết"
                >
                  Phân tích lại
                </button>
              </div>
              <div className="font-semibold text-slate-800 dark:text-slate-100 bg-white dark:bg-slate-900/60 p-2 rounded-lg border border-purple-100 dark:border-purple-900/50">
                {extractedNeed || (isExtractingNeed ? "AI đang đọc nội dung bài viết..." : "Tư vấn theo nội dung bài viết")}
              </div>
              {postUrl && (
                <div className="flex items-center justify-between text-[11px] text-slate-500 pt-0.5">
                  <span className="truncate max-w-[280px]">🔗 {postUrl}</span>
                  <a
                    href={postUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-purple-700 dark:text-purple-400 font-bold hover:underline shrink-0"
                  >
                    Mở bài viết ↗
                  </a>
                </div>
              )}
            </div>
          )}

          {/* Ô soạn lời chào & Danh sách mẫu câu chọn nhanh */}
          <div>
            <div className="flex items-center justify-between mb-1.5 flex-wrap gap-1">
              <div className="flex items-center gap-2">
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                  Mẫu tin nhắn inbox Zalo (Click chọn nhanh):
                </label>
                <a
                  href="/all-platform/quick-comments?tab=inbox"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] font-bold text-[#be123c] hover:text-[#9f1239] dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 px-2 py-0.5 rounded-full border border-rose-200 dark:border-rose-800 flex items-center gap-1 cursor-pointer transition hover:scale-105"
                  title="Mở thư viện mẫu inbox để thêm hoặc chỉnh sửa mẫu tin nhắn"
                >
                  <span>+ Quản lý mẫu inbox</span>
                  <span className="text-[9px]">↗</span>
                </a>
              </div>
              {selectedTemplateId && (
                <button
                  type="button"
                  onClick={() => handleSetAsDefault(selectedTemplateId)}
                  className="text-[11px] font-semibold text-[#be123c] hover:text-[#9f1239] dark:text-rose-400 flex items-center gap-1 cursor-pointer transition-colors"
                  title="Đặt mẫu này làm mặc định cho các lần nhắn tin sau của bạn"
                >
                  <span>{defaultTemplateId === selectedTemplateId ? "★ Đang là mặc định" : "☆ Đặt làm mặc định"}</span>
                </button>
              )}
            </div>

            {/* Danh sách các mẫu câu Zalo từ thư viện chung */}
            {templates.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2 max-h-24 overflow-y-auto pr-1">
                {templates.map((tpl) => {
                  const isSelected = selectedTemplateId === tpl.id;
                  const isDefault = defaultTemplateId === tpl.id;
                  return (
                    <button
                      key={tpl.id}
                      type="button"
                      onClick={() => handleSelectTemplate(tpl)}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all cursor-pointer ${
                        isSelected
                          ? "bg-[#be123c] text-white shadow-xs ring-1 ring-[#be123c]"
                          : "bg-slate-100 hover:bg-slate-200/80 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-200 dark:border-slate-700"
                      }`}
                      title={tpl.content}
                    >
                      {isDefault && <span className="text-amber-300 font-bold">★</span>}
                      {tpl.label && (
                        <span className={`text-[9px] px-1 py-0.2 rounded font-bold uppercase ${
                          isSelected ? "bg-white/20 text-white" : tpl.source === "inbox" ? "bg-rose-100 text-[#be123c] dark:bg-rose-950/40 dark:text-rose-300" : "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300"
                        }`}>
                          {tpl.label}
                        </span>
                      )}
                      <span className="truncate max-w-[140px]">{tpl.title}</span>
                    </button>
                  );
                })}
              </div>
            )}

            <textarea
              value={message}
              onChange={(e) => {
                setMessage(e.target.value);
              }}
              rows={3}
              placeholder="Nhập nội dung tin nhắn mở đầu..."
              className="w-full text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-2.5 text-slate-800 dark:text-slate-100 placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[#be123c]/20 focus:border-[#be123c] resize-none"
            />
          </div>

          {statusText && (
            <div className="rounded-lg bg-rose-50 dark:bg-rose-950/30 p-2.5 text-xs text-rose-800 dark:text-rose-200 flex items-center gap-2 animate-in fade-in border border-rose-100">
              <span className="inline-block w-2 h-2 rounded-full bg-[#be123c] animate-ping"></span>
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
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold text-white bg-[#be123c] hover:bg-[#9f1239] shadow-md shadow-rose-900/20 active:scale-95 disabled:opacity-50 disabled:pointer-events-none transition-all cursor-pointer"
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
