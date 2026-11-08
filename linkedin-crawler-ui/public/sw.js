// Service Worker tối giản cho Web Push tin nhắn Zalo mới (Mục 4.9 guide).
// KHÔNG cache gì — chỉ lắng nghe push event + notification click.

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (_) {
    payload = { title: "Zalo", body: event.data ? event.data.text() : "" };
  }

  const title = payload.title || "Tin nhắn Zalo mới";
  const options = {
    body: payload.body || "",
    icon: "/favicon.ico",
    badge: "/favicon.ico",
    data: { url: payload.url || "/all-platform/zalo-inbox" },
    tag: payload.conversation_id || undefined,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/all-platform/zalo-inbox";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(targetUrl) && "focus" in client) {
          return client.focus();
        }
      }
      if (clientList.length > 0 && "focus" in clientList[0]) {
        clientList[0].navigate(targetUrl);
        return clientList[0].focus();
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    }),
  );
});
