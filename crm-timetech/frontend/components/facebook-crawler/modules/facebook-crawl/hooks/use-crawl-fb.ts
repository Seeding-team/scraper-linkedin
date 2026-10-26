import { useState, useRef } from "react";
import { toast } from "sonner";
import { CrawlFBRequest, GroupSummaryType } from "../types/crawl-fb.type";
import { CrawlFb_form } from "../schemas/crawl-fb-schemas";
import { CrawlFbService } from "../services/CrawlFBService";
import {
  getFacebookApiRoot,
  getFacebookCrawlWsUrl,
} from "../lib/facebook-api-base";

export const useCrawlFB = (onSuccessCallback?: () => void) => {
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [loadingMsg, setLoadingMsg] = useState<string>(
    "Đang kết nối đến máy chủ...",
  );
  const [result, setResult] = useState<GroupSummaryType[] | null>();

  // Dùng ref để lưu trữ instance WebSocket nhằm gọi đóng kết nối (Hủy) khi cần
  const wsRef = useRef<WebSocket | null>(null);

  const handleCrawlResponse = (
    response: {
      status?: string;
      message?: string;
      data?: GroupSummaryType[];
    },
    ws: WebSocket | null,
  ) => {
    if (response.status === "queued" || response.status === "processing") {
      setLoadingMsg(response.message || "Đang xử lý…");
      toast.info(response.message || "Đang xử lý…", { id: "ws-status" });
      return;
    }
    if (response.status === "success") {
      setIsLoading(false);
      if (response.data && response.data.length > 0) {
        setResult(response.data);
        toast.success("Crawl thành công!", { id: "ws-status" });
      } else {
        setResult([]);
        toast.info("Crawl xong nhưng không có dữ liệu mới.", { id: "ws-status" });
      }
      onSuccessCallback?.();
      ws?.close();
      return;
    }
    if (
      response.status === "error" ||
      response.status === "fail" ||
      response.status === "canceled"
    ) {
      setIsLoading(false);
      toast.error(response.message || "Lỗi crawl từ server", { id: "ws-status" });
      ws?.close();
    }
  };

  const submitCrawlData = async (data: CrawlFb_form) => {
    // Tạo định danh duy nhất (email) cho kết nối WS
    const emailId = data.isDefaultAccount
      ? `default_user_${Date.now()}`
      : data.userName || "anonymous";

    setIsLoading(true);
    setLoadingMsg("Đang kết nối đến máy chủ...");
    setResult(null);

    const payload: CrawlFBRequest = {
      groups: data.rows,
      tkFB: data.isDefaultAccount
        ? null
        : {
            useName: data.userName,
            password: data.password,
          },
    };

    const apiBaseUrl = getFacebookApiRoot();
    console.log("=== Step 1: Backend Health Check ===");
    console.log("API URL:", apiBaseUrl);
    try {
      const healthCheck = await fetch(`${apiBaseUrl}/health`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });

      if (!healthCheck.ok) {
        setIsLoading(false);
        toast.error(
          `Backend error: ${healthCheck.status}. Please check backend is running on ${apiBaseUrl}`,
        );
        console.error(
          "Backend health check failed:",
          healthCheck.status,
          healthCheck.statusText,
        );
        return;
      }
      console.log("Backend is healthy - HTTP 200 OK");
    } catch (err: any) {
      setIsLoading(false);
      toast.error(
        `Cannot connect to backend: ${err.message}\nCheck backend is running on: ${apiBaseUrl}`,
      );
      console.error("Backend health check error:", err);
      return;
    }

    const wsUrl = getFacebookCrawlWsUrl(emailId);
    let wsOpened = false;
    let fallbackStarted = false;

    const runHttpFallback = async (reason: string) => {
      if (fallbackStarted || wsOpened) return;
      fallbackStarted = true;
      setLoadingMsg("WebSocket lỗi — đang crawl qua HTTP…");
      toast.info(reason, { id: "ws-status" });
      try {
        const response = await CrawlFbService(payload);
        handleCrawlResponse(
          {
            status: response.status,
            message: response.message,
            data: response.data,
          },
          null,
        );
      } catch (err) {
        setIsLoading(false);
        const msg =
          err instanceof Error ? err.message : "Không crawl được qua HTTP";
        toast.error(msg, { id: "ws-status" });
      }
    };

    console.log("=== WebSocket Connection Attempt ===");
    console.log("URL:", wsUrl);
    setLoadingMsg("Đang kết nối WebSocket…");

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    const connectTimeout = window.setTimeout(() => {
      if (!wsOpened && ws.readyState !== WebSocket.OPEN) {
        ws.close();
        void runHttpFallback(
          "WebSocket không kết nối được — thử HTTP (có thể mất vài phút).",
        );
      }
    }, 8000);

    ws.onopen = () => {
      wsOpened = true;
      window.clearTimeout(connectTimeout);
      setLoadingMsg("Đã kết nối, đang gửi dữ liệu…");
      ws.send(JSON.stringify(payload));
    };

    ws.onmessage = (event) => {
      try {
        const response = JSON.parse(event.data) as {
          status?: string;
          message?: string;
          data?: GroupSummaryType[];
        };
        if (response.status === "heartbeat") {
          setLoadingMsg(response.message || "Đang crawl…");
          return;
        }
        handleCrawlResponse(response, ws);
      } catch (error) {
        setIsLoading(false);
        console.error("Parse WS message failed:", error, event.data);
        toast.error("Lỗi xử lý dữ liệu từ server");
      }
    };

    ws.onerror = () => {
      window.clearTimeout(connectTimeout);
      if (!wsOpened) {
        void runHttpFallback(
          "WebSocket lỗi — chuyển sang HTTP. Kiểm tra backend đang chạy port 8000.",
        );
      }
    };

    ws.onclose = (event) => {
      window.clearTimeout(connectTimeout);
      if (!wsOpened && event.code === 1006) {
        void runHttpFallback(
          "WebSocket đóng bất thường (1006) — thử HTTP. Restart backend sau khi sửa .env.",
        );
        return;
      }
      if (!wsOpened) {
        setIsLoading(false);
        return;
      }
      if (!event.wasClean && event.code !== 1000) {
        setIsLoading(false);
        toast.error(
          event.reason ||
            `WebSocket đóng (mã ${event.code}). Tiến trình có thể đã dừng.`,
          { id: "ws-status" },
        );
      }
    };
  };

  const cancelCrawl = () => {
    if (wsRef.current) {
      // Đóng WebSocket từ phía client sẽ gọi WebSocketDisconnect phía Backend (ngắt Playwright)
      wsRef.current.close();
      wsRef.current = null;

      toast.error("Crawl process cancelled!");
      setIsLoading(false);
    }
  };

  return {
    isLoading,
    loadingMsg,
    submitCrawlData,
    result,
    cancelCrawl,
  };
};
