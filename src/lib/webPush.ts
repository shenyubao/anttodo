import type { SupabaseClient } from "@supabase/supabase-js";
import notificationWorkerUrl from "../notification-sw.ts?worker&url";

export type NotificationPermissionState = NotificationPermission | "unsupported" | "desktop";

function base64UrlToUint8Array(value: string) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

export function currentNotificationPermission(): NotificationPermissionState {
  if (window.anttodoDesktop?.platform === "darwin") return "desktop";
  if (
    typeof window.Notification === "undefined"
    || !("serviceWorker" in navigator)
    || typeof window.PushManager === "undefined"
  ) {
    return "unsupported";
  }
  return Notification.permission;
}

export async function requestWebNotificationPermission() {
  const current = currentNotificationPermission();
  if (current !== "default") return current;
  return Notification.requestPermission();
}

export async function ensureWebPushSubscription(client: SupabaseClient) {
  if (currentNotificationPermission() !== "granted") return false;
  const registration = await navigator.serviceWorker.register(notificationWorkerUrl, {
    type: "module",
  });
  await navigator.serviceWorker.ready;
  const configResult = await client.functions.invoke("reminder-subscription", {
    body: { action: "config" },
  });
  if (configResult.error) throw configResult.error;
  const publicKey = String(configResult.data?.vapidPublicKey ?? "");
  if (!publicKey) throw new Error("提醒服务尚未配置 VAPID 公钥");
  const subscription = await registration.pushManager.getSubscription()
    ?? await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToUint8Array(publicKey),
    });
  const saveResult = await client.functions.invoke("reminder-subscription", {
    body: {
      action: "upsert",
      subscription: subscription.toJSON(),
      userAgent: navigator.userAgent,
    },
  });
  if (saveResult.error) throw saveResult.error;
  return true;
}
