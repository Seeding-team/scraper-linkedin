"use client";

/**
 * Giao tiếp với "Markee Seeding Extension" cho seeding YouTube (bg/youtube-crawl.js, extension >= 2.2):
 * - nhận diện kênh YouTube đang đăng nhập trên trình duyệt (để liên kết với tài khoản Markee),
 * - mở video trong tab mới + điền sẵn comment (nhân viên tự bấm "Bình luận"),
 * - nhận kết quả extension báo về sau khi đã ghi nhận KPI.
 */

import { useEffect, useRef } from "react";

export interface DetectedYouTubeAccount {
  success: boolean;
  loggedIn?: boolean;
  channel_id?: string | null;
  handle?: string | null;
  name?: string | null;
  error?: string;
}

export interface YouTubeCommentResult {
  success: boolean;
  message: string;
  postId?: string;
  linkComment?: string | null;
}

/** Gửi 1 lệnh tới extension (qua bridge.js) và chờ đúng action kết quả tương ứng. */
function askExtension<T>(action: string, payload: unknown, resultAction: string, timeoutMs: number, timeoutMessage: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new Error(timeoutMessage));
    }, timeoutMs);
    function onMessage(event: MessageEvent) {
      if (event.source !== window || event.data?.action !== resultAction) return;
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve(event.data.payload as T);
    }
    window.addEventListener("message", onMessage);
    window.postMessage(payload === undefined ? { action } : { action, payload }, "*");
  });
}

export function detectYouTubeAccount(): Promise<DetectedYouTubeAccount> {
  return askExtension<DetectedYouTubeAccount>(
    "MK_YT_DETECT_ACCOUNT",
    undefined,
    "MK_YT_DETECT_ACCOUNT_RESULT",
    50000,
    "Extension không phản hồi khi đọc kênh YouTube. Kiểm tra đã cài Markee Seeding Extension 2.2 rồi F5 lại trang.",
  );
}

export function openYouTubeCommentTab(payload: {
  url: string;
  text: string;
  token: string;
  apiBase: string;
  postId: string;
  expectedChannel: { profile_id: string; handle?: string | null; name?: string | null };
}): Promise<{ success: boolean; error?: string }> {
  return askExtension(
    "MK_YT_COMMENT_OPEN",
    payload,
    "MK_YT_COMMENT_OPEN_RESULT",
    8000,
    "Extension không phản hồi lệnh mở YouTube. Kiểm tra đã cài Markee Seeding Extension 2.2 rồi F5 lại trang.",
  );
}

/** Nghe kết quả ghi nhận KPI (extension gửi về tab Markee đã mở video). */
export function useYouTubeCommentResults(onResult: (result: YouTubeCommentResult) => void) {
  const onResultRef = useRef(onResult);
  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.data?.action !== "MK_YT_COMMENT_RESULT") return;
      const p = event.data.payload || {};
      onResultRef.current({ success: !!p.success, message: p.message || "", postId: p.postId, linkComment: p.linkComment });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);
}
