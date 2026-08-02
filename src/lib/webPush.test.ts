import { afterEach, describe, expect, it, vi } from "vitest";
import {
  currentNotificationPermission,
  requestWebNotificationPermission,
} from "./webPush";

const originalNotification = window.Notification;
const originalDesktop = window.anttodoDesktop;
const originalServiceWorker = navigator.serviceWorker;
const originalPushManager = window.PushManager;

afterEach(() => {
  Object.defineProperty(window, "Notification", { configurable: true, value: originalNotification });
  Object.defineProperty(window, "PushManager", { configurable: true, value: originalPushManager });
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: originalServiceWorker });
  window.anttodoDesktop = originalDesktop;
  vi.restoreAllMocks();
});

describe("web notification permission", () => {
  it("does not request browser permission in the macOS shell", async () => {
    window.anttodoDesktop = { platform: "darwin" } as Window["anttodoDesktop"];
    expect(currentNotificationPermission()).toBe("desktop");
    expect(await requestWebNotificationPermission()).toBe("desktop");
  });

  it("reports unsupported browsers", () => {
    delete window.anttodoDesktop;
    Object.defineProperty(window, "Notification", { configurable: true, value: undefined });
    expect(currentNotificationPermission()).toBe("unsupported");
  });

  it("requests permission once from a user gesture", async () => {
    delete window.anttodoDesktop;
    const requestPermission = vi.fn().mockResolvedValue("denied");
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: { permission: "default", requestPermission },
    });
    Object.defineProperty(window, "PushManager", { configurable: true, value: function PushManager() {} });
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: {} });
    await expect(requestWebNotificationPermission()).resolves.toBe("denied");
    expect(requestPermission).toHaveBeenCalledOnce();
  });
});
