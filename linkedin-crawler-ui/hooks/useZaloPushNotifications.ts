"use client";

import { useCallback, useEffect, useState } from "react";
import { getZaloVapidPublicKey, subscribeZaloPush, unsubscribeZaloPush } from "@/services/zaloCrawlerService";

// Mục 4.5 guide (usePushNotifications.ts) — KHÔNG tự xin quyền Notification lúc
// mount, chỉ khi user chủ động bấm nút subscribe().
function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray.buffer;
}

export function useZaloPushNotifications() {
  const [supported, setSupported] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ok =
      typeof window !== "undefined" &&
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window;
    setSupported(ok);
    if (!ok) return;

    (async () => {
      try {
        const reg = await navigator.serviceWorker.getRegistration("/sw.js");
        const existing = reg ? await reg.pushManager.getSubscription() : null;
        setSubscribed(Boolean(existing));
      } catch {
        /* im lặng — chỉ ảnh hưởng trạng thái hiển thị nút */
      }
    })();
  }, []);

  const subscribe = useCallback(async () => {
    if (!supported) return;
    setLoading(true);
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        throw new Error("Bạn đã từ chối quyền thông báo. Hãy bật lại trong cài đặt trình duyệt.");
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const { public_key } = await getZaloVapidPublicKey();
      if (!public_key) {
        throw new Error("Server chưa cấu hình VAPID key cho Web Push.");
      }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(public_key),
      });
      const json = sub.toJSON();
      await subscribeZaloPush({
        endpoint: sub.endpoint,
        keys: { p256dh: json.keys?.p256dh || "", auth: json.keys?.auth || "" },
        user_agent: navigator.userAgent,
      });
      setSubscribed(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không bật được thông báo");
    } finally {
      setLoading(false);
    }
  }, [supported]);

  const unsubscribe = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (sub) {
        await unsubscribeZaloPush(sub.endpoint);
        await sub.unsubscribe();
      }
      setSubscribed(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tắt được thông báo");
    } finally {
      setLoading(false);
    }
  }, []);

  return { supported, subscribed, loading, error, subscribe, unsubscribe };
}
