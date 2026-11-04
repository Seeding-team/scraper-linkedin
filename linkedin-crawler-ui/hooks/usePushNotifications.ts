"use client";

/**
 * usePushNotifications — bật/tắt thông báo đẩy (Web Push API) cho NHÂN VIÊN
 * đang đăng nhập, KHÔNG gắn với 1 account Zalo cụ thể (1 subscription của 1
 * nhân viên nhận được thông báo cho MỌI account họ được xem — xem
 * worker/pushNotifier.js staffIdsForAccount(), mirror canViewAccount()).
 *
 * Cố tình tách khỏi useZalo(accountId) — đây là concern cấp NHÂN VIÊN/TRÌNH
 * DUYỆT, không phải cấp account, nên không nên đổi mỗi lần accountId đổi.
 */

import { useCallback, useEffect, useState } from "react";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = typeof window !== "undefined" ? window.atob(base64) : "";
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

async function getRegistration(): Promise<ServiceWorkerRegistration | undefined> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return undefined;
  return (await navigator.serviceWorker.getRegistration("/sw.js")) || undefined;
}

/**
 * true khi đang chạy trên Safari/iOS (iPhone/iPad) NHƯNG trang hiện mở qua
 * tab Safari thường, CHƯA ở chế độ "standalone" (chưa Thêm vào Màn hình
 * chính) — đây là TRƯỜNG HỢP DUY NHẤT `push.supported` false mà vẫn CÓ THỂ
 * bật được thông báo nếu người dùng cài trang như PWA trước (xem metadata
 * `manifest`/`appleWebApp` ở app/layout.tsx). Dùng để UI hiện đúng hướng dẫn
 * thay vì im lặng ẩn hẳn nút như trước đây (2026-10-02).
 */
function detectIosNeedsHomeScreen(): boolean {
  if (typeof navigator === "undefined" || typeof window === "undefined") return false;
  const ua = navigator.userAgent || "";
  // iPadOS 13+ giả User-Agent giống macOS Safari — phân biệt thêm bằng
  // maxTouchPoints (máy Mac thật không có touch, iPad luôn > 0).
  const isIos = /iPad|iPhone|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
  if (!isIos) return false;
  const isStandalone =
    window.matchMedia?.("(display-mode: standalone)").matches ||
    // API cũ riêng của iOS Safari — vẫn là cách đáng tin cậy nhất để biết đã
    // mở từ icon Màn hình chính hay chưa trên các bản iOS cũ hơn.
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return !isStandalone;
}

export function usePushNotifications() {
  const [supported, setSupported] = useState(false);
  const [iosNeedsHomeScreen, setIosNeedsHomeScreen] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);

  // Kiểm tra trạng thái subscription hiện có (vd đã bật ở lần trước, load lại
  // trang) — KHÔNG tự đăng ký service worker ở bước này, chỉ hỏi cái ĐÃ có
  // sẵn, tránh xin quyền Notification ngoài ý muốn người dùng khi họ chưa hề
  // bấm nút.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const ok = "serviceWorker" in navigator && "PushManager" in window && typeof Notification !== "undefined";
    setSupported(ok);
    setIosNeedsHomeScreen(!ok && detectIosNeedsHomeScreen());
    if (!ok) return;
    (async () => {
      try {
        const reg = await getRegistration();
        const sub = await reg?.pushManager.getSubscription();
        setSubscribed(!!sub);
      } catch {
        // best-effort — giữ mặc định subscribed=false
      }
    })();
  }, []);

  const subscribe = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      return { ok: false, error: "Trình duyệt này không hỗ trợ thông báo đẩy." };
    }
    setLoading(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        return { ok: false, error: "Bạn đã từ chối quyền thông báo — vào cài đặt trình duyệt để bật lại." };
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      const keyRes = await fetch("/api/push/vapid-public-key", { cache: "no-store" });
      const keyData = await keyRes.json().catch(() => ({}));
      if (!keyRes.ok || !keyData?.publicKey) {
        return { ok: false, error: keyData?.error || "Không lấy được khoá VAPID từ server." };
      }

      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(keyData.publicKey) as BufferSource
        });
      }
      const subJson = sub.toJSON();
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: subJson.endpoint, keys: subJson.keys })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { ok: false, error: data?.error || "Lưu subscription thất bại." };
      }
      setSubscribed(true);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Bật thông báo đẩy thất bại." };
    } finally {
      setLoading(false);
    }
  }, []);

  const unsubscribe = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    setLoading(true);
    try {
      const reg = await getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint })
        }).catch(() => undefined);
        await sub.unsubscribe();
      }
      setSubscribed(false);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Tắt thông báo đẩy thất bại." };
    } finally {
      setLoading(false);
    }
  }, []);

  return { supported, iosNeedsHomeScreen, subscribed, loading, subscribe, unsubscribe };
}
