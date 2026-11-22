"use client";

/**
 * Bridge helpers để modal "Thêm nhóm" Facebook (group-management.tsx) nói chuyện với
 * Markee Seeding Extension (extensions/comment-extension/bridge.js) qua window.postMessage —
 * tự động lấy Tên nhóm + Số thành viên từ URL vừa dán (Việc còn dở, 2026-11-22). Cùng khuôn
 * với lib/li-ext-bridge.ts (fetchLinkedInPostInfo), dùng session Facebook THẬT của người
 * dùng (extension mở 1 popup ẩn tới URL đó) nên không bị chặn như gọi thẳng từ server.
 */

interface FbBridgeMessage {
  action?: string;
  payload?: unknown;
}

export interface FbFetchGroupInfoResult {
  success: boolean;
  group_name?: string | null;
  member_count?: number | null;
  error?: string;
  error_code?: "blocked" | "login_required" | "not_found" | "exception";
}

export function fetchFacebookGroupInfo(url: string, timeoutMs = 25000): Promise<FbFetchGroupInfoResult> {
  return new Promise((resolve) => {
    let done = false;
    const onMsg = (e: MessageEvent) => {
      if (e.source !== window || !e.data) return;
      const d = e.data as FbBridgeMessage;
      if (d.action === "FB_FETCH_GROUP_INFO_RESULT") {
        done = true;
        window.removeEventListener("message", onMsg);
        resolve((d.payload as FbFetchGroupInfoResult) || { success: false, error: "Không có phản hồi." });
      }
    };
    window.addEventListener("message", onMsg);
    window.postMessage({ action: "FB_FETCH_GROUP_INFO", payload: { url } }, "*");
    setTimeout(() => {
      if (!done) {
        window.removeEventListener("message", onMsg);
        resolve({
          success: false,
          error: "Hết thời gian chờ Extension (chưa cài, chưa đăng nhập Facebook, hoặc trang tải quá lâu).",
        });
      }
    }, timeoutMs);
  });
}
