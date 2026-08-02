/// <reference lib="webworker" />

declare const self: ServiceWorkerGlobalScope;

type ReminderPushPayload = {
  title: string;
  body: string;
  tag: string;
  icon?: string;
  url: string;
  acknowledgeUrl?: string;
  acknowledgementToken?: string;
};

async function acknowledge(payload: ReminderPushPayload) {
  if (!payload.acknowledgeUrl || !payload.acknowledgementToken) return;
  await fetch(payload.acknowledgeUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: payload.acknowledgementToken }),
  }).catch(() => undefined);
}

self.addEventListener("push", (event) => {
  const payload = event.data?.json() as ReminderPushPayload | undefined;
  if (!payload) return;
  event.waitUntil(self.registration.showNotification(payload.title, {
    body: payload.body,
    tag: payload.tag,
    icon: payload.icon,
    requireInteraction: false,
    data: payload,
  }));
});

self.addEventListener("notificationclick", (event) => {
  const payload = event.notification.data as ReminderPushPayload;
  event.notification.close();
  event.waitUntil((async () => {
    await acknowledge(payload);
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const appUrl = new URL(payload.url, self.location.origin).href;
    for (const client of windows) {
      if ("focus" in client) {
        await client.navigate(appUrl);
        return client.focus();
      }
    }
    return self.clients.openWindow(appUrl);
  })());
});

self.addEventListener("notificationclose", (event) => {
  event.waitUntil(acknowledge(event.notification.data as ReminderPushPayload));
});

export {};
