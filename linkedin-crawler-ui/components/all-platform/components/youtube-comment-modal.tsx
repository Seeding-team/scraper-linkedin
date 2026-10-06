"use client";

/**
 * Comment 1 video YouTube từ tab "Seeding bên ngoài":
 * 1. Chọn kênh YouTube đã liên kết (bắt buộc — chưa liên kết thì hướng dẫn sang tab "Kênh YouTube").
 * 2. Gõ nội dung (hoặc chọn mẫu comment nhanh cho YouTube).
 * 3. Bấm "Mở YouTube & điền sẵn" -> backend cấp phiên comment (token ký, gắn người dùng + video + kênh)
 *    -> extension mở video trong tab mới, điền sẵn nội dung. Nhân viên tự bấm "Bình luận" trên YouTube,
 *    extension thấy comment hiện lên thì báo về backend để tính KPI (kết quả hiện ở toast của trang này).
 */

import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { FaYoutube } from "react-icons/fa6";
import { toast } from "sonner";
import { youtubeSeedingService } from "@/services/all-platform.service";
import type { UnifiedPost } from "@/types/unified.types";
import { useQuickCommentLibrary } from "./use-quick-comment-library";
import { extensionApiBase } from "./seeding-extension/use-seeding-extension";
import { openYouTubeCommentTab } from "./seeding-extension/use-youtube-seeding";
import { useLinkedYouTubeChannels } from "./seeding-extension/youtube-channel-section";

const SELECTED_CHANNEL_KEY = "markee.youtube.selectedChannelId";

interface YouTubeCommentModalProps {
  post: UnifiedPost | null;
  onClose: () => void;
  /** Mở tab "Kênh YouTube của bạn" khi chưa liên kết kênh nào. */
  onNeedLinkChannel?: () => void;
}

export function YouTubeCommentModal({ post, onClose, onNeedLinkChannel }: YouTubeCommentModalProps) {
  const { channels, isLoading } = useLinkedYouTubeChannels(!!post);
  const { libraryItems } = useQuickCommentLibrary();
  // Kênh người dùng tự chọn trong modal; chưa chọn thì dùng kênh lần trước / kênh mặc định.
  const [pickedId, setPickedId] = useState("");
  const [text, setText] = useState("");
  const [isOpening, setIsOpening] = useState(false);

  const templates = useMemo(
    () => libraryItems.filter((t) => t.platform === "all" || t.platform === "youtube"),
    [libraryItems],
  );

  const selectedId = useMemo(() => {
    if (channels.some((c) => c.id === pickedId)) return pickedId;
    let saved = "";
    try {
      saved = window.localStorage.getItem(SELECTED_CHANNEL_KEY) || "";
    } catch {}
    const preferred = channels.find((c) => c.id === saved) || channels.find((c) => c.is_primary) || channels[0];
    return preferred?.id || "";
  }, [channels, pickedId]);

  if (!post || typeof document === "undefined") return null;

  const canSubmit = !!selectedId && !!text.trim() && !isOpening;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setIsOpening(true);
    try {
      try {
        window.localStorage.setItem(SELECTED_CHANNEL_KEY, selectedId);
      } catch {}
      const session = await youtubeSeedingService.createCommentSession({ post_id: post.id, id_social_account: selectedId });
      if (!session.success || !session.data) {
        toast.error(session.message || "Không tạo được phiên comment.");
        return;
      }
      const res = await openYouTubeCommentTab({
        url: session.data.post_url,
        text: text.trim(),
        token: session.data.token,
        apiBase: extensionApiBase(),
        postId: post.id,
        expectedChannel: session.data.expected_channel,
      });
      if (!res?.success) {
        toast.error(res?.error || "Extension không mở được YouTube.");
        return;
      }
      toast.success("Đã mở YouTube và điền sẵn comment. Kiểm tra lại rồi tự bấm \"Bình luận\" — KPI sẽ tự được ghi nhận.");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Không mở được YouTube.");
    } finally {
      setIsOpening(false);
    }
  };

  const thumbnail = post.image_urls?.[0];

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !isOpening) onClose();
      }}
    >
      <div className="w-[min(560px,100%)] max-h-[90vh] bg-card rounded-2xl shadow-xl overflow-hidden flex flex-col">
        <div className="flex items-start justify-between gap-3 p-5 border-b border-border">
          <div className="flex items-start gap-3 min-w-0">
            {thumbnail ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={thumbnail} alt="" className="w-28 aspect-video rounded-lg object-cover border border-border shrink-0" />
            ) : (
              <FaYoutube className="text-[#ff0000] text-3xl shrink-0" />
            )}
            <div className="min-w-0">
              <h3 className="text-base font-bold text-foreground line-clamp-2">{post.title || post.content || "Video YouTube"}</h3>
              <p className="text-xs text-muted-foreground mt-0.5 truncate">{post.group_name}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={isOpening} aria-label="Đóng" className="rounded-full p-1.5 text-muted-foreground hover:bg-muted">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="yt-comment-channel" className="text-sm font-bold text-foreground">Comment bằng kênh</label>
            {isLoading ? (
              <p className="text-xs text-muted-foreground">Đang tải kênh đã liên kết...</p>
            ) : channels.length === 0 ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 leading-relaxed">
                Bạn chưa liên kết kênh YouTube nào nên chưa thể comment tính KPI.{" "}
                {onNeedLinkChannel ? (
                  <button type="button" onClick={onNeedLinkChannel} className="font-bold underline">
                    Liên kết kênh ngay
                  </button>
                ) : (
                  "Vào mục \"Kênh YouTube của bạn\" ở khung Markee Seeding Extension để liên kết."
                )}
              </div>
            ) : (
              <select
                id="yt-comment-channel"
                value={selectedId}
                onChange={(e) => setPickedId(e.target.value)}
                className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary"
              >
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.account_name}{c.account_handle ? ` (${c.account_handle})` : ""}
                  </option>
                ))}
              </select>
            )}
            <p className="text-[11px] text-muted-foreground">
              Trình duyệt phải đang đăng nhập YouTube đúng kênh này — comment bằng kênh khác sẽ không được tính KPI.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="yt-comment-text" className="text-sm font-bold text-foreground">Nội dung comment</label>
            <textarea
              id="yt-comment-text"
              rows={4}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Nhập nội dung comment..."
              className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary resize-y"
            />
            {templates.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {templates.slice(0, 12).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setText(t.content)}
                    title={t.content}
                    className="px-2.5 py-1 rounded-full border border-border bg-muted/50 hover:bg-muted text-[11px] font-semibold text-foreground"
                  >
                    {t.title}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border bg-muted px-5 py-3">
          <button type="button" onClick={onClose} disabled={isOpening} className="px-4 py-2 rounded-xl border border-border bg-card text-sm font-bold">
            Huỷ
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="px-4 py-2 rounded-xl bg-[#ff0000] hover:bg-[#d90000] text-white text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
          >
            <FaYoutube />
            {isOpening ? "Đang mở YouTube..." : "Mở YouTube & điền sẵn"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
