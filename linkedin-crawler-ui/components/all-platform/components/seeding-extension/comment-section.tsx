"use client";

import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import type { SocialAccount, UnifiedPost } from "@/types/unified.types";
import { socialAccountsService } from "@/services/all-platform.service";
import { scheduledCommentService } from "@/services/scheduled-comment.service";
import { useQuickCommentLibrary } from "../use-quick-comment-library";
import { PLATFORM_DB_ID, type CommentPostInput, type CommentProgress, type ExtensionPlatform } from "./use-seeding-extension";

interface CommentSectionProps {
  platform: ExtensionPlatform;
  posts: UnifiedPost[];
  isReady: boolean;
  isCommenting: boolean;
  progress: CommentProgress | null;
  stopping: boolean;
  lastError: string | null;
  onStart: (posts: CommentPostInput[], text: string, extra: { id_social_account?: string; id_platform: number }) => void;
  onStop: () => void;
}

function toLocalDatetimeLocal(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function CommentSection({ platform, posts, isReady, isCommenting, progress, stopping, lastError, onStart, onStop }: CommentSectionProps) {
  const isFacebook = platform === "facebook";
  const platformLabel = isFacebook ? "Facebook" : "LinkedIn";
  const [selectedUrls, setSelectedUrls] = useState<Set<string>>(new Set());
  const [commentText, setCommentText] = useState("");
  const [socialAccounts, setSocialAccounts] = useState<SocialAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [isTemplatePickerOpen, setIsTemplatePickerOpen] = useState(false);
  const [scheduledAt, setScheduledAt] = useState(() => {
    const d = new Date();
    d.setMinutes(d.getMinutes() + 30);
    return toLocalDatetimeLocal(d);
  });
  const [isScheduling, setIsScheduling] = useState(false);
  const [scheduleResult, setScheduleResult] = useState<{ failed: number; message: string } | null>(null);

  const { libraryItems: templates } = useQuickCommentLibrary(platform);
  const templateGroups = useMemo(() => {
    const groups = new Map<string, { label: string; templates: typeof templates }>();
    templates.forEach((t) => {
      const label = t.label || "Khác";
      if (!groups.has(label)) groups.set(label, { label, templates: [] });
      groups.get(label)!.templates.push(t);
    });
    return Array.from(groups.values());
  }, [templates]);

  // Component được remount theo key={platform} ở panel -> lựa chọn/kết quả tự reset khi đổi nền tảng.
  useEffect(() => {
    if (!isFacebook) return;
    socialAccountsService.getAll("facebook").then((res) => {
      if (res.data) {
        setSocialAccounts(res.data);
        if (res.data.length > 0) setSelectedAccountId((prev) => prev || res.data![0].id);
      }
    });
  }, [isFacebook]);

  // Chỉ bài chưa có ai seeding (giống bộ lọc cũ của "Seeding Comment Hàng Loạt").
  const validPosts = useMemo(
    () =>
      posts.filter(
        (p) => p.platform === platform && p.post_url && !p.seeding_content && (!p.all_seedings || p.all_seedings.length === 0),
      ),
    [posts, platform],
  );

  // Danh sách bài đổi (chuyển trang/lọc/vừa seeding xong) -> chỉ giữ lựa chọn còn hiển thị.
  const selectedVisible = useMemo(() => {
    const visible = new Set(validPosts.map((p) => p.post_url));
    return new Set(Array.from(selectedUrls).filter((u) => visible.has(u)));
  }, [selectedUrls, validPosts]);

  const allSelected = validPosts.length > 0 && selectedVisible.size === validPosts.length;
  const toggleAll = () => setSelectedUrls(allSelected ? new Set() : new Set(validPosts.map((p) => p.post_url)));
  const toggleUrl = (url: string) =>
    setSelectedUrls((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });

  const busy = isCommenting || isScheduling;

  const handleStart = () => {
    if (!commentText.trim() || selectedVisible.size === 0 || !isReady) return;
    const payload: CommentPostInput[] = Array.from(selectedVisible).map((url) => {
      const post = validPosts.find((p) => p.post_url === url);
      return { url, id_post: post?.id, id_platform: PLATFORM_DB_ID[platform] };
    });
    onStart(payload, commentText.trim(), {
      id_social_account: isFacebook ? selectedAccountId || undefined : undefined,
      id_platform: PLATFORM_DB_ID[platform],
    });
  };

  const handleSchedule = async () => {
    if (!commentText.trim() || selectedVisible.size === 0 || !selectedAccountId || !scheduledAt) return;
    if (new Date(scheduledAt) <= new Date()) {
      setScheduleResult({ failed: 1, message: "Thời gian hẹn phải ở tương lai." });
      return;
    }
    setIsScheduling(true);
    setScheduleResult(null);
    let success = 0;
    let failed = 0;
    const urls = Array.from(selectedVisible);
    for (const url of urls) {
      const post = validPosts.find((p) => p.post_url === url);
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
      } catch {
        failed++;
      }
    }
    setScheduleResult({
      failed,
      message: failed === 0 ? `Đã lên lịch ${success} bài viết.` : `Đã lên lịch ${success}/${urls.length} bài, ${failed} bài lỗi.`,
    });
    setIsScheduling(false);
  };

  const pct = progress && progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="flex flex-col gap-3">
          {isFacebook ? (
            <div className="flex flex-col gap-1">
              <label className="text-sm font-bold text-foreground">Tài khoản seeding (Facebook)</label>
              <select
                className="w-full rounded-xl border border-border bg-card p-2.5 text-sm outline-none focus:border-primary"
                value={selectedAccountId}
                onChange={(e) => setSelectedAccountId(e.target.value)}
                disabled={busy}
              >
                <option value="">-- Tự do (dùng tài khoản đang đăng nhập Facebook) --</option>
                {socialAccounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.account_name} {acc.account_email ? `(${acc.account_email})` : ""}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="rounded-xl border border-blue-100 bg-blue-50 p-2.5 text-xs text-blue-800">
              Bình luận LinkedIn dùng tài khoản LinkedIn đang đăng nhập trên trình duyệt này.
            </div>
          )}

          <div className="flex flex-col gap-1 relative">
            <div className="flex items-center justify-between">
              <label className="text-sm font-bold text-foreground">Nội dung bình luận</label>
              <button type="button" onClick={() => setIsTemplatePickerOpen((v) => !v)} disabled={busy} className="text-xs font-semibold text-primary hover:underline disabled:opacity-50">
                Chọn mẫu câu
              </button>
            </div>
            <textarea
              className="w-full rounded-xl border border-border bg-card p-3 text-sm outline-none focus:border-primary resize-y min-h-[110px]"
              placeholder={`Nhập nội dung sẽ bình luận lên các bài ${platformLabel} đã chọn...`}
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              disabled={busy}
            />
            {isTemplatePickerOpen ? (
              <div className="absolute right-0 top-7 z-20 w-80 max-h-[300px] overflow-y-auto rounded-xl border border-border bg-card shadow-lg">
                {templateGroups.length === 0 ? (
                  <div className="p-3 text-xs text-muted-foreground">Chưa có mẫu câu {platformLabel}. Thêm ở trang Thư viện mẫu câu.</div>
                ) : (
                  templateGroups.map((group) => (
                    <div key={group.label}>
                      <div className="px-3 py-1.5 text-[10px] font-bold text-muted-foreground bg-muted/60">{group.label}</div>
                      {group.templates.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          className="w-full text-left px-3 py-2 hover:bg-muted border-b border-border last:border-0"
                          onClick={() => {
                            setCommentText(t.content);
                            setIsTemplatePickerOpen(false);
                          }}
                        >
                          <div className="text-xs font-semibold text-foreground">{t.title}</div>
                          <div className="text-[11px] text-muted-foreground line-clamp-2">{t.content}</div>
                        </button>
                      ))}
                    </div>
                  ))
                )}
              </div>
            ) : null}
          </div>

          {isFacebook ? (
            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-foreground">Hẹn giờ (không bắt buộc — dùng nút &quot;Lên lịch&quot;)</label>
              <input
                type="datetime-local"
                value={scheduledAt}
                min={toLocalDatetimeLocal(new Date())}
                onChange={(e) => setScheduledAt(e.target.value)}
                disabled={busy}
                className="w-full rounded-xl border border-border bg-card p-2 text-sm outline-none focus:border-primary"
              />
            </div>
          ) : null}
        </div>

        <div className="flex flex-col gap-2 min-w-0">
          <div className="flex items-center justify-between">
            <label className="text-sm font-bold text-foreground">
              Bài {platformLabel} chưa seeding ({selectedVisible.size}/{validPosts.length})
            </label>
            <button type="button" onClick={toggleAll} disabled={busy || validPosts.length === 0} className="text-xs font-semibold text-primary hover:underline disabled:opacity-50">
              {allSelected ? "Bỏ chọn tất cả" : "Chọn tất cả"}
            </button>
          </div>
          <div className="border border-border rounded-xl flex-1 max-h-[260px] overflow-y-auto divide-y divide-border bg-muted/30">
            {validPosts.length === 0 ? (
              <div className="p-4 text-center text-sm text-muted-foreground">Không có bài {platformLabel} nào chưa seeding ở trang đang xem.</div>
            ) : (
              validPosts.map((post) => (
                <label key={post.id || post.post_url} className={cn("flex items-start gap-3 p-2.5 cursor-pointer hover:bg-muted/60", busy && "opacity-60 pointer-events-none")}>
                  <input type="checkbox" className="mt-0.5 rounded border-border" checked={selectedVisible.has(post.post_url)} onChange={() => toggleUrl(post.post_url)} />
                  <div className="min-w-0">
                    <div className="text-sm text-foreground line-clamp-2">{post.content || "Bài viết không có nội dung văn bản"}</div>
                    <div className="text-[10px] text-muted-foreground truncate">{post.group_name || post.post_url}</div>
                  </div>
                </label>
              ))
            )}
          </div>
        </div>
      </div>

      {progress ? (
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 flex flex-col gap-2">
          <div className="flex justify-between text-xs font-bold text-foreground">
            <span>Tiến trình: {progress.current}/{progress.total}</span>
            <span>{pct}%</span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-primary transition-all duration-300" style={{ width: `${pct}%` }} />
          </div>
          <div className={cn("text-xs font-medium", progress.result && progress.result.success === false ? "text-red-600" : "text-muted-foreground")}>{progress.status}</div>
        </div>
      ) : null}
      {lastError ? <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{lastError}</div> : null}
      {scheduleResult ? (
        <div className={cn("rounded-xl p-3 text-sm font-medium border", scheduleResult.failed === 0 ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-amber-50 border-amber-200 text-amber-700")}>
          {scheduleResult.message}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-2">
        {isCommenting ? (
          <div className="mr-auto flex items-center gap-2 text-xs text-muted-foreground">
            Đang chạy ngầm {progress ? `${progress.current}/${progress.total}` : ""}
            <button type="button" onClick={onStop} disabled={stopping} className="px-3 py-1.5 rounded-lg bg-red-100 hover:bg-red-200 text-red-700 font-bold disabled:opacity-50">
              {stopping ? "Đang dừng..." : "Dừng"}
            </button>
          </div>
        ) : null}
        {isFacebook ? (
          <button
            type="button"
            onClick={handleSchedule}
            disabled={busy || selectedVisible.size === 0 || !commentText.trim() || !selectedAccountId || !scheduledAt}
            className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold disabled:opacity-50"
          >
            {isScheduling ? "Đang lưu..." : "Lên lịch"}
          </button>
        ) : null}
        <button
          type="button"
          onClick={handleStart}
          disabled={busy || selectedVisible.size === 0 || !isReady || !commentText.trim()}
          className="px-5 py-2 rounded-xl bg-primary hover:bg-primary/90 text-white text-sm font-bold disabled:opacity-50"
        >
          {isCommenting ? "Đang chạy..." : `Bắt đầu bình luận (${selectedVisible.size} bài)`}
        </button>
      </div>
    </div>
  );
}
