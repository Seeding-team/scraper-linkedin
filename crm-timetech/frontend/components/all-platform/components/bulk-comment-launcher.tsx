"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import { UnifiedPost, SocialAccount, ScheduledComment } from "@/types/unified.types";
import { socialAccountsService } from "@/services/all-platform.service";
import { scheduledCommentService } from "@/services/scheduled-comment.service";
import { useAppAuth } from "@/contexts/AppAuthContext";
import { API_BASE_URL } from "@/lib/env";
import { cn } from "@/lib/utils";
import { useQuickCommentLibrary } from "./use-quick-comment-library";

interface BulkCommentLauncherProps {
  posts: UnifiedPost[];
  onComplete?: (seededUrls: string[]) => void;
}

function toLocalDatetimeLocal(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function BulkCommentLauncher({ posts, onComplete }: BulkCommentLauncherProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [selectedUrls, setSelectedUrls] = useState<Set<string>>(new Set());
  const [commentText, setCommentText] = useState("");
  const [progress, setProgress] = useState<{ current: number; total: number; status: string; result?: any } | null>(null);
  const [isCommenting, setIsCommenting] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [socialAccounts, setSocialAccounts] = useState<SocialAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [isTemplatePickerOpen, setIsTemplatePickerOpen] = useState(false);
  const [scheduledAt, setScheduledAt] = useState<string>("");
  const [isScheduling, setIsScheduling] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [scheduleResult, setScheduleResult] = useState<{ success: number; failed: number; message: string } | null>(null);

  const { user } = useAppAuth();
  const processingScheduledRef = useRef<Set<string>>(new Set());
  const { libraryItems: commentTemplates } = useQuickCommentLibrary("facebook");
  const commentTemplateGroups = useMemo(() => {
    const groups = new Map<string, { label: string; templates: typeof commentTemplates }>();
    commentTemplates.forEach((item) => {
      const label = item.label || "Khác";
      if (!groups.has(label)) groups.set(label, { label, templates: [] });
      groups.get(label)!.templates.push(item);
    });
    return Array.from(groups.values());
  }, [commentTemplates]);

  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      if (event.data?.action === "COMMENT_EXTENSION_READY") {
        setIsReady(true);
      } else if (event.data?.action === "BULK_COMMENT_STARTED") {
        setIsCommenting(true);
        setProgress({ current: 0, total: selectedUrls.size, status: "Bắt đầu..." });
      } else if (event.data?.action === "BULK_COMMENT_PROGRESS") {
        setProgress(event.data.payload);
      } else if (event.data?.action === "BULK_COMMENT_DONE") {
        setIsCommenting(false);
        const pendingIds = Array.from(processingScheduledRef.current);
        if (pendingIds.length > 0) {
          for (const id of pendingIds) {
            scheduledCommentService.markPosted(id).catch(() => {});
          }
          processingScheduledRef.current.clear();
          setProgress(p => p ? { ...p, status: "Đã hoàn tất comment hẹn giờ!" } : null);
        } else {
          setProgress(p => p ? { ...p, status: "Hoàn tất toàn bộ tiến trình!" } : null);
          if (onComplete) onComplete(Array.from(selectedUrls));
        }
      } else if (event.data?.action === "STATUS_RESPONSE") {
        const { isCommenting: extIsCommenting, currentProgress } = event.data.payload || {};
        if (extIsCommenting) {
          setIsCommenting(true);
          setIsExpanded(true);
          if (currentProgress) setProgress(currentProgress);
        } else if (isCommenting) {
          setIsCommenting(false);
        }
      } else if (event.data?.action === "STOP_BULK_COMMENT_RESPONSE") {
        setStopping(false);
      }
    };

    window.addEventListener("message", handleMessage);
    const interval = setInterval(() => {
      if (!isReady) window.postMessage({ action: "PING_COMMENT_EXTENSION" }, "*");
      window.postMessage({ action: "GET_STATUS" }, "*");
    }, 1000);

    return () => {
      window.removeEventListener("message", handleMessage);
      clearInterval(interval);
    };
  }, [selectedUrls.size, isReady, onComplete]);

  useEffect(() => {
    if (isExpanded && socialAccounts.length === 0) {
      socialAccountsService.getAll('facebook').then(res => {
        if (res.data) {
          setSocialAccounts(res.data);
          if (res.data.length > 0) setSelectedAccountId(res.data[0].id);
        }
      });
    }
    if (isExpanded && !scheduledAt) {
      const now = new Date();
      now.setMinutes(now.getMinutes() + 30);
      setScheduledAt(toLocalDatetimeLocal(now));
    }
  }, [isExpanded, socialAccounts.length]);

  useEffect(() => {
    if (!isReady || !user?.email) return;

    const pollScheduled = async () => {
      if (isCommenting) return;
      try {
        const res = await scheduledCommentService.getAll({
          status: "pending",
          platform: "facebook",
          page: 1,
          limit: 50,
        });
        if (!res.data || res.data.length === 0) return;
        const now = new Date();
        const dueComments = res.data.filter(sc =>
          !processingScheduledRef.current.has(sc.id) &&
          new Date(sc.scheduled_at) <= now
        );
        if (dueComments.length === 0) return;

        // Process ONE due comment per poll cycle to preserve per-comment content + account
        const comment = dueComments[0];
        processingScheduledRef.current.add(comment.id);
        setIsCommenting(true);

        window.postMessage({
          action: "START_BULK_COMMENT",
          payload: {
            posts: [{
              url: comment.post_url,
              id_post: comment.id_post_fb,
            }],
            text: comment.comment_content || "",
            verifyConfig: {
              apiBase: API_BASE_URL || "https://seeding.markeeai.com",
              email_member: user.email,
              id_social_account: comment.id_social_account || undefined,
              id_platform: 1,
            },
          },
        }, "*");
      } catch {
        // Silently retry on next poll
      }
    };

    const interval = setInterval(pollScheduled, 10000);
    return () => clearInterval(interval);
  }, [isReady, user?.email]);

  const validPosts = posts.filter(p => 
    p.platform === "facebook" && p.post_url && !p.seeding_content && (!p.all_seedings || p.all_seedings.length === 0)
  );

  const toggleAll = () => {
    if (selectedUrls.size === validPosts.length) {
      setSelectedUrls(new Set());
    } else {
      setSelectedUrls(new Set(validPosts.map(p => p.post_url as string)));
    }
  };

  const toggleUrl = (url: string) => {
    const next = new Set(selectedUrls);
    if (next.has(url)) next.delete(url);
    else next.add(url);
    setSelectedUrls(next);
  };

  const handleStart = () => {
    if (!commentText.trim()) return alert("Vui lòng nhập nội dung comment!");
    if (selectedUrls.size === 0) return alert("Vui lòng chọn ít nhất 1 bài viết!");
    if (!isReady) return alert("Chưa kết nối được Extension. Vui lòng cài đặt và tải lại trang!");

    const postsPayload = Array.from(selectedUrls).map(url => {
        const post = validPosts.find(p => p.post_url === url);
        return { url, id_post: post?.id };
    });

    window.postMessage({
      action: "START_BULK_COMMENT",
      payload: {
        posts: postsPayload,
        text: commentText,
        verifyConfig: {
            apiBase: API_BASE_URL || "https://seeding.markeeai.com",
            email_member: user?.email,
            id_social_account: selectedAccountId || undefined,
            id_platform: 1
        }
      }
    }, "*");
  };

  const handleSchedule = async () => {
    if (!commentText.trim()) return alert("Vui lòng nhập nội dung comment!");
    if (selectedUrls.size === 0) return alert("Vui lòng chọn ít nhất 1 bài viết!");
    if (!scheduledAt) return alert("Vui lòng chọn thời gian hẹn!");
    if (new Date(scheduledAt) <= new Date()) return alert("Thời gian phải trong tương lai!");
    if (!selectedAccountId) return alert("Vui lòng chọn tài khoản Seeding!");

    setIsScheduling(true);
    setScheduleResult(null);

    let success = 0;
    let failed = 0;
    const failedUrls: string[] = [];
    const urls = Array.from(selectedUrls);

    for (const url of urls) {
      const post = validPosts.find(p => p.post_url === url);
      try {
        await scheduledCommentService.create({
          id_post_fb: post?.id,
          platform: "facebook",
          post_url: url,
          group_name: post?.group_name,
          post_content: post?.content,
          id_social_account: selectedAccountId,
          comment_content: commentText.trim(),
          ai_generated: false,
          scheduled_at: new Date(scheduledAt).toISOString(),
        });
        success++;
      } catch (err) {
        console.error("[Schedule] Failed to schedule comment for", url, err);
        failed++;
        failedUrls.push(url);
      }
    }

    const msg = failed === 0
      ? `Đã lên lịch ${success} bài viết thành công!`
      : `Đã lên lịch ${success}/${urls.length} bài viết. ${failed} bài thất bại.`;

    setScheduleResult({ success, failed, message: msg });

    setIsScheduling(false);
  };

  const handleStop = () => {
    setStopping(true);
    window.postMessage({ action: "STOP_BULK_COMMENT" }, "*");
  };

  const minScheduleTime = toLocalDatetimeLocal(new Date());

  return (
    <div className="bg-white rounded-2xl border border-slate-200/60 shadow-sm overflow-hidden flex flex-col transition-all duration-300 w-full mb-6 relative">
      {/* Header */}
      <div className="flex items-center justify-between p-4 bg-slate-50/50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center shrink-0 border border-red-100">
            <span className="material-symbols-outlined text-red-600 text-[22px]">forum</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-slate-800 text-sm leading-tight">Seeding Comment Hàng Loạt</h3>
              <a
                href="https://www.youtube.com/watch?v=EWdw2-70vFY"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
              >
                <span className="material-symbols-outlined text-[15px]">videocam</span>
                Video hướng dẫn
              </a>
            </div>
            <p className="text-xs text-slate-500 leading-tight mt-0.5">
              Tự động comment chạy ngầm trên trình duyệt. Không làm gián đoạn công việc của bạn.
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <a href="/comment-extension.zip" download
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 text-xs font-bold transition cursor-pointer">
            <span className="material-symbols-outlined text-[16px]">download</span>
            Tải Extension
          </a>
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="px-4 py-2 rounded-xl bg-[#DC2626] hover:bg-[#B91C1C] text-white text-xs font-bold transition-all shadow-sm hover:shadow active:scale-[0.98] flex items-center gap-1.5 cursor-pointer"
          >
            <span className="material-symbols-outlined text-[16px]">
              {isExpanded ? "expand_less" : "expand_more"}
            </span>
            {isExpanded ? "Đóng" : "Mở Cấu Hình"}
          </button>
        </div>
      </div>

      {/* Body - Inline Form */}
      {isExpanded && (
        <div className="p-4 border-t border-slate-100 flex flex-col gap-5 bg-white">
          <div className={`p-3 rounded-xl border text-sm flex items-center gap-2 ${isReady ? 'bg-green-50 border-green-200 text-green-700' : 'bg-amber-50 border-amber-200 text-amber-700'}`}>
            <span className="material-symbols-outlined text-[18px]">
              {isReady ? "check_circle" : "warning"}
            </span>
            {isReady ? "Extension đã sẵn sàng chạy ngầm" : "Đang chờ kết nối Extension. Vui lòng cài đặt và F5 lại trang."}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">Tài khoản Seeding (Facebook):</label>
                <select
                  className="w-full rounded-xl border border-slate-200 p-2.5 text-sm focus:border-red-500 focus:ring-1 focus:ring-red-500 outline-none"
                  value={selectedAccountId}
                  onChange={e => setSelectedAccountId(e.target.value)}
                  disabled={isCommenting || isScheduling}
                >
                  <option value="">-- Tự do (Dùng acc đang đăng nhập FB) --</option>
                  {socialAccounts.map(acc => (
                    <option key={acc.id} value={acc.id}>
                      {acc.account_name} {acc.account_email ? `(${acc.account_email})` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2 flex-1 flex flex-col relative">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-bold text-slate-700">Nội dung Comment chung:</label>
                  <button
                    type="button"
                    onClick={() => setIsTemplatePickerOpen(v => !v)}
                    disabled={isCommenting}
                    className="text-xs font-semibold text-red-600 hover:underline flex items-center gap-1 cursor-pointer disabled:opacity-50"
                  >
                    <span className="material-symbols-outlined text-[14px]">bookmark</span>
                    Chọn mẫu câu
                  </button>
                </div>
                <textarea
                  className="w-full flex-1 rounded-xl border border-slate-200 p-3 text-sm focus:border-red-500 focus:ring-1 focus:ring-red-500 outline-none resize-y min-h-[120px]"
                  placeholder="Nhập nội dung bạn muốn seeding..."
                  value={commentText}
                  onChange={e => setCommentText(e.target.value)}
                  disabled={isCommenting || isScheduling}
                />

                {isTemplatePickerOpen && (
                  <div className="absolute right-0 top-8 z-20 w-80 max-h-[320px] overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
                    <div className="px-3 py-2 text-xs font-bold text-slate-700 border-b border-slate-100 bg-slate-50 sticky top-0">
                      Thư viện mẫu câu comment
                    </div>
                    {commentTemplateGroups.length === 0 ? (
                      <div className="p-3 text-xs text-slate-500">
                        Chưa có mẫu nào. Vào trang Quick Comment Library để thêm.
                      </div>
                    ) : (
                      commentTemplateGroups.map((group) => (
                        <div key={group.label}>
                          <div className="px-3 py-1.5 text-[10px] font-bold text-slate-500 bg-slate-50/70">
                            {group.label}
                          </div>
                          {group.templates.map((template) => (
                            <button
                              key={template.id}
                              type="button"
                              className="w-full text-left px-3 py-2 hover:bg-red-50 border-b border-slate-100 last:border-0 transition"
                              onClick={() => {
                                setCommentText(template.content);
                                setIsTemplatePickerOpen(false);
                              }}
                            >
                              <div className="text-xs font-semibold text-slate-800">{template.title}</div>
                              <div className="text-[11px] text-slate-500 line-clamp-2">{template.content}</div>
                            </button>
                          ))}
                        </div>
                      ))
                    )}
                    <a
                      href="/all-platform/library?tab=comment"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block px-3 py-2 text-[11px] font-semibold text-red-600 hover:underline bg-slate-50 border-t border-slate-100"
                    >
                      Quản lý thư viện mẫu câu →
                    </a>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-2 flex flex-col">
              <div className="flex items-center justify-between">
                <label className="text-sm font-bold text-slate-700">
                  Chọn bài viết ({selectedUrls.size}/{validPosts.length})
                </label>
                <button type="button" onClick={toggleAll} disabled={isCommenting} className="text-sm text-red-600 hover:underline font-medium cursor-pointer">
                  {selectedUrls.size === validPosts.length ? "Bỏ chọn tất cả" : "Chọn tất cả"}
                </button>
              </div>
              
              <div className="border border-slate-200 rounded-xl flex-1 max-h-[200px] overflow-y-auto divide-y divide-slate-100 bg-slate-50/30">
                {validPosts.length === 0 ? (
                  <div className="p-4 text-center text-sm text-slate-500">
                    Không có bài viết Facebook nào trên màn hình này.
                  </div>
                ) : (
                  validPosts.map(post => {
                    const url = post.post_url as string;
                    const isChecked = selectedUrls.has(url);
                    return (
                      <label key={post.id} className={`flex items-start gap-3 p-3 cursor-pointer hover:bg-slate-50 transition ${isCommenting ? 'opacity-70 pointer-events-none' : ''}`}>
                        <input 
                          type="checkbox" 
                          className="mt-1 rounded border-slate-300 text-red-600 focus:ring-red-500" 
                          checked={isChecked}
                          onChange={() => toggleUrl(url)}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-slate-800 line-clamp-2">{post.content || "Bài viết không có nội dung văn bản"}</div>
                          <div className="text-[10px] text-slate-500 truncate mt-1">{url}</div>
                        </div>
                      </label>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {/* New: Hẹn giờ section */}
          <div className="pt-3 border-t border-slate-100 space-y-2">
            <label className="text-sm font-bold text-slate-700">Hẹn giờ (không bắt buộc):</label>
            <p className="text-xs text-slate-500">
              Nếu có thời gian, dùng nút "Lên lịch" thay vì "Bắt đầu Seeding".
            </p>
            <input
              type="datetime-local"
              value={scheduledAt}
              min={minScheduleTime}
              onChange={(e) => setScheduledAt(e.target.value)}
              disabled={isCommenting || isScheduling}
              className="w-full rounded-xl border border-slate-200 p-2.5 text-sm focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none"
            />
          </div>

          <div className="flex flex-col gap-3 pt-3 border-t border-slate-100">
            {progress && (
              <div className="bg-red-50 border border-red-100 rounded-xl p-3 space-y-2">
                <div className="flex justify-between text-xs text-red-800 font-bold">
                  <span>Tiến trình: {progress.current} / {progress.total}</span>
                  <span>{Math.round((progress.current / progress.total) * 100)}%</span>
                </div>
                <div className="w-full bg-red-200/50 rounded-full h-1.5 overflow-hidden">
                  <div 
                    className="bg-red-500 h-full transition-all duration-300"
                    style={{ width: `${(progress.current / progress.total) * 100}%` }}
                  />
                </div>
                <div className="text-xs text-red-600 font-medium">{progress.status}</div>
              </div>
            )}
            
            {scheduleResult && (
              <div className={`rounded-xl p-3 text-sm font-medium ${scheduleResult.failed === 0 ? 'bg-emerald-50 border border-emerald-200 text-emerald-700' : 'bg-amber-50 border border-amber-200 text-amber-700'}`}>
                {scheduleResult.message}
              </div>
            )}

            <div className="flex justify-end gap-3 flex-wrap">
              {isCommenting && (
                <div className="flex items-center gap-2 mr-auto">
                  <div className="flex items-center text-xs font-medium text-slate-500">
                    <span className="material-symbols-outlined animate-spin text-[16px] mr-1">progress_activity</span>
                    {progress ? `${progress.current}/${progress.total}` : "Đang chạy ngầm"}.
                  </div>
                  <button
                    type="button"
                    onClick={handleStop}
                    disabled={stopping}
                    className="px-3 py-1.5 rounded-lg bg-red-100 hover:bg-red-200 text-red-700 text-xs font-bold transition disabled:opacity-50 cursor-pointer"
                  >
                    {stopping ? "Đang dừng..." : "Dừng"}
                  </button>
                </div>
              )}
              {isScheduling && (
                <div className="flex items-center text-xs font-medium text-slate-500 mr-auto">
                  <span className="material-symbols-outlined animate-spin text-[16px] mr-1">progress_activity</span>
                  Đang lên lịch...
                </div>
              )}
              <button
                type="button"
                onClick={handleSchedule}
                disabled={isScheduling || isCommenting || selectedUrls.size === 0 || !commentText.trim() || !selectedAccountId || !scheduledAt}
                className="px-6 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold transition shadow-sm disabled:opacity-50 disabled:shadow-none flex items-center gap-2 cursor-pointer"
              >
                {isScheduling ? (
                  <>Đang lưu...</>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-[18px]">schedule</span>
                    Lên lịch
                  </>
                )}
              </button>
              <button 
                onClick={handleStart}
                disabled={isCommenting || isScheduling || selectedUrls.size === 0 || !isReady || !commentText.trim()}
                className="px-6 py-2 rounded-xl bg-gradient-to-r from-red-600 to-rose-600 text-white font-bold hover:from-red-700 hover:to-rose-700 transition shadow-sm shadow-red-600/20 disabled:opacity-50 disabled:shadow-none flex items-center gap-2 cursor-pointer"
              >
                {isCommenting ? (
                  <>Đang chạy...</>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-[18px]">send</span>
                    Bắt đầu Seeding
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
