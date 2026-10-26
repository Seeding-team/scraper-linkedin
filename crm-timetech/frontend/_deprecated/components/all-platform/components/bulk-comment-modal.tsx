import React, { useState, useEffect, useRef } from "react";
import { UnifiedPost, SocialAccount } from "@/types/unified.types";
import { allPlatformSeedingService, socialAccountsService } from "@/services/all-platform.service";
import { useAppAuth } from "@/contexts/AppAuthContext";

interface BulkCommentModalProps {
  open: boolean;
  onClose: () => void;
  posts: UnifiedPost[];
}

export function BulkCommentModal({ open, onClose, posts }: BulkCommentModalProps) {
  const [selectedUrls, setSelectedUrls] = useState<Set<string>>(new Set());
  const [commentText, setCommentText] = useState("");
  const [progress, setProgress] = useState<{ current: number; total: number; status: string; result?: any } | null>(null);
  const [isCommenting, setIsCommenting] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [socialAccounts, setSocialAccounts] = useState<SocialAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const commentTextRef = useRef("");
  const selectedAccountIdRef = useRef("");

  const { user } = useAppAuth();

  useEffect(() => {
    commentTextRef.current = commentText;
  }, [commentText]);

  useEffect(() => {
    selectedAccountIdRef.current = selectedAccountId;
  }, [selectedAccountId]);

  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      if (event.data?.action === "COMMENT_EXTENSION_READY") {
        setIsReady(true);
      } else if (event.data?.action === "BULK_COMMENT_STARTED") {
        setIsCommenting(true);
        setProgress({ current: 0, total: selectedUrls.size, status: "Bắt đầu..." });
      } else if (event.data?.action === "BULK_COMMENT_PROGRESS") {
        const payload = event.data.payload;
        setProgress(payload);

        // Bấm API để tính KPI bất kể thành công hay thất bại (như yêu cầu)
        if (payload.result && user?.email) {
            try {
                const matchedPost = validPosts.find(p => p.post_url === payload.url);
                await allPlatformSeedingService.verify({
                    email_member: user.email,
                    link_post: payload.url,
                    platform: "facebook",
                    content: commentTextRef.current, // Use the ref to get latest value
                    link_comment: payload.result.url || `Bị từ chối / Không lấy được link - ${Date.now()}-${Math.random().toString(36).substring(7)}`,
                    profile_id: payload.result.uid || "Unknown",
                    id_post: matchedPost?.id,
                    id_social_account: selectedAccountIdRef.current || undefined,
                    id_platform: 1
                });
            } catch (e) {
                console.error("Lỗi khi lưu KPI seeding:", e);
            }
        }
      } else if (event.data?.action === "BULK_COMMENT_DONE") {
        setIsCommenting(false);
        alert("Đã hoàn thành comment hàng loạt! Trang sẽ được tải lại để hiển thị dữ liệu mới nhất.");
        onClose();
        sessionStorage.setItem("needs_second_reload", "true");
        window.location.reload();
      }
    };

    window.addEventListener("message", handleMessage);
    // Ping to check if ready
    window.postMessage({ action: "PING_COMMENT_EXTENSION" }, "*");

    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, [selectedUrls.size, onClose]);

  // Logic tự động reload lần 2 cho chắc ăn theo yêu cầu
  useEffect(() => {
    if (typeof window !== 'undefined' && sessionStorage.getItem("needs_second_reload") === "true") {
      sessionStorage.removeItem("needs_second_reload");
      setTimeout(() => {
        window.location.reload();
      }, 1000); // Đợi 1s sau khi reload lần 1 để reload lần 2
    }
  }, []);

  useEffect(() => {
    if (open) {
      setSelectedUrls(new Set());
      setProgress(null);
      setIsCommenting(false);

      socialAccountsService.getAll('facebook').then(res => {
        if (res.data) {
          setSocialAccounts(res.data);
          if (res.data.length > 0) {
            setSelectedAccountId(res.data[0].id);
          }
        }
      });
    }
  }, [open]);

  if (!open) return null;

  const validPosts = posts.filter(p =>
    p.platform === "facebook" &&
    p.post_url &&
    !p.seeding_content &&
    (!p.all_seedings || p.all_seedings.length === 0)
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
    if (next.has(url)) {
      next.delete(url);
    } else {
      next.add(url);
    }
    setSelectedUrls(next);
  };

  const handleStart = () => {
    if (!commentText.trim()) {
      alert("Vui lòng nhập nội dung comment!");
      return;
    }
    if (selectedUrls.size === 0) {
      alert("Vui lòng chọn ít nhất 1 bài viết!");
      return;
    }
    if (!isReady) {
      alert("Chưa kết nối được với Extension Comment Hàng Loạt. Vui lòng cài đặt và bật extension!");
      return;
    }

    const links = Array.from(selectedUrls);
    window.postMessage({
      action: "START_BULK_COMMENT",
      payload: {
        links,
        text: commentText
      }
    }, "*");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-surface rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant bg-surface-container-low">
          <h2 className="text-lg font-bold text-on-surface">Seeding Comment Hàng Loạt</h2>
          <button onClick={onClose} disabled={isCommenting} className="text-on-surface-variant hover:text-on-surface-variant transition disabled:opacity-50">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto flex-1 flex flex-col gap-6">

          {/* Extension Status */}
          <div className={`p-3 rounded-xl border text-sm flex items-center gap-2 ${isReady ? 'bg-green-50 border-green-200 text-green-700' : 'bg-amber-50 border-amber-200 text-amber-700'}`}>
            <span className="material-symbols-outlined text-[18px]">
              {isReady ? "check_circle" : "warning"}
            </span>
            {isReady ? "Extension đã sẵn sàng để comment" : "Chưa kết nối Extension. Vui lòng cài đặt và tải lại trang."}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-bold text-on-surface">Nội dung Comment:</label>
            <textarea
              className="w-full rounded-xl border border-outline-variant p-3 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none resize-y min-h-[100px]"
              placeholder="Nhập nội dung bạn muốn comment..."
              value={commentText}
              onChange={e => setCommentText(e.target.value)}
              disabled={isCommenting}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-bold text-on-surface">Tài khoản Seeding sẽ dùng (Facebook):</label>
            <select
              className="w-full rounded-xl border border-outline-variant p-3 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              value={selectedAccountId}
              onChange={e => setSelectedAccountId(e.target.value)}
              disabled={isCommenting}
            >
              <option value="">-- Chọn tài khoản Seeding (Nếu có) --</option>
              {socialAccounts.map(acc => (
                <option key={acc.id} value={acc.id}>
                  {acc.account_name} {acc.account_email ? `(${acc.account_email})` : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-bold text-on-surface">
                Chọn bài viết ({selectedUrls.size}/{validPosts.length})
              </label>
              <button onClick={toggleAll} disabled={isCommenting} className="text-sm text-blue-600 hover:underline font-medium">
                {selectedUrls.size === validPosts.length ? "Bỏ chọn tất cả" : "Chọn tất cả"}
              </button>
            </div>

            <div className="border border-outline-variant rounded-xl max-h-[300px] overflow-y-auto divide-y divide-outline-variant">
              {validPosts.length === 0 ? (
                <div className="p-4 text-center text-sm text-on-surface-variant">
                  Không có bài viết Facebook nào trên trang này.
                </div>
              ) : (
                validPosts.map(post => {
                  const url = post.post_url as string;
                  const isChecked = selectedUrls.has(url);
                  return (
                    <label key={post.id} className={`flex items-start gap-3 p-3 cursor-pointer hover:bg-surface-container-low transition ${isCommenting ? 'opacity-70 pointer-events-none' : ''}`}>
                      <input
                        type="checkbox"
                        className="mt-1 rounded border-outline-variant text-blue-600 focus:ring-blue-500"
                        checked={isChecked}
                        onChange={() => toggleUrl(url)}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-on-surface line-clamp-2">{post.content || "Bài viết không có nội dung văn bản"}</div>
                        <div className="text-xs text-on-surface-variant truncate mt-1">{url}</div>
                      </div>
                    </label>
                  );
                })
              )}
            </div>
          </div>

          {progress && (
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 space-y-2">
              <div className="flex justify-between text-sm text-blue-800 font-medium">
                <span>Tiến trình: {progress.current} / {progress.total}</span>
                <span>{Math.round((progress.current / progress.total) * 100)}%</span>
              </div>
              <div className="w-full bg-blue-200/50 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-blue-500 h-full transition-all duration-300"
                  style={{ width: `${(progress.current / progress.total) * 100}%` }}
                />
              </div>
              <div className="text-xs text-blue-600 font-medium">{progress.status}</div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-outline-variant bg-surface-container-low flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={isCommenting}
            className="px-4 py-2 rounded-xl border border-outline-variant text-on-surface-variant font-medium hover:bg-surface-container-low transition disabled:opacity-50"
          >
            Đóng
          </button>
          <button
            onClick={handleStart}
            disabled={isCommenting || selectedUrls.size === 0 || !isReady || !commentText.trim()}
            className="px-6 py-2 rounded-xl bg-blue-600 text-white font-bold hover:bg-blue-700 transition shadow-sm shadow-blue-600/20 disabled:opacity-50 disabled:shadow-none flex items-center gap-2"
          >
            {isCommenting ? (
              <>
                <span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>
                Đang xử lý...
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-[18px]">send</span>
                Bắt đầu Comment
              </>
            )}
          </button>
        </div>

      </div>
    </div>
  );
}
