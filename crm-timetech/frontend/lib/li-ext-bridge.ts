"use client";

/**
 * Bridge helpers để dashboard nói chuyện với Markee Seeding Extension
 * (extensions/comment-extension/bridge.js — đã gộp cào LinkedIn) qua window.postMessage.
 * Dùng cho luồng "Thêm bài viết Seeding mới" (lấy info 1 bài LinkedIn) — luồng
 * "Comment ngay" tự lắng nghe LI_COMMENT_* trực tiếp trong page.tsx vì cần cập nhật
 * tiến trình liên tục, không phải request/response một lần như ở đây.
 */

interface LiBridgeMessage {
  action?: string;
  payload?: unknown;
}

export function pingLiExtension(timeoutMs = 3000): Promise<{ installed: boolean }> {
  return new Promise((resolve) => {
    let done = false;
    const onMsg = (e: MessageEvent) => {
      if (e.source !== window || !e.data) return;
      const d = e.data as LiBridgeMessage;
      if (d.action === "LI_EXTENSION_READY") {
        done = true;
        window.removeEventListener("message", onMsg);
        resolve({ installed: true });
      }
    };
    window.addEventListener("message", onMsg);
    window.postMessage({ action: "PING_LI_EXTENSION" }, "*");
    setTimeout(() => {
      if (!done) {
        window.removeEventListener("message", onMsg);
        resolve({ installed: false });
      }
    }, timeoutMs);
  });
}

export interface LiFetchPostInfoResult {
  success: boolean;
  author?: string;
  content?: string;
  likes?: number;
  comments?: number;
  shares?: number;
  permalink_url?: string;
  error?: string;
}

export function fetchLinkedInPostInfo(url: string, timeoutMs = 20000): Promise<LiFetchPostInfoResult> {
  return new Promise((resolve) => {
    let done = false;
    const onMsg = (e: MessageEvent) => {
      if (e.source !== window || !e.data) return;
      const d = e.data as LiBridgeMessage;
      if (d.action === "LI_FETCH_POST_INFO_RESULT") {
        done = true;
        window.removeEventListener("message", onMsg);
        resolve((d.payload as LiFetchPostInfoResult) || { success: false, error: "Không có phản hồi." });
      }
    };
    window.addEventListener("message", onMsg);
    window.postMessage({ action: "LI_FETCH_POST_INFO", payload: { url } }, "*");
    setTimeout(() => {
      if (!done) {
        window.removeEventListener("message", onMsg);
        resolve({
          success: false,
          error: "Hết thời gian chờ LinkedIn Extension (chưa cài, chưa đăng nhập LinkedIn, hoặc trang tải quá lâu).",
        });
      }
    }, timeoutMs);
  });
}
