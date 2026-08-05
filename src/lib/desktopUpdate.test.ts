import { describe, expect, it } from "vitest";
import {
  clearUpdateSnooze,
  formatUpdateProgressLabel,
  isUpdateSnoozed,
  shouldShowUpdatePrompt,
  snoozeUpdate,
  UPDATE_SNOOZE_STORAGE_KEY,
  type DesktopUpdateCheckResult,
} from "./desktopUpdate";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    getItem: (key: string) => (key in data ? data[key] : null),
    setItem: (key: string, value: string) => {
      data[key] = value;
    },
    removeItem: (key: string) => {
      delete data[key];
    },
    snapshot: () => data,
  };
}

const available: DesktopUpdateCheckResult = {
  status: "available",
  currentVersion: "0.1.0",
  latestVersion: "0.2.0",
  downloadUrl:
    "https://anttodo-yuce.oss-cn-hangzhou.aliyuncs.com/release/macos/AntTodo-arm64-latest.dmg",
};

describe("desktopUpdate snooze", () => {
  it("shows available updates until snoozed for that version", () => {
    const storage = memoryStorage();
    expect(shouldShowUpdatePrompt(available, 1_000, storage)).toBe(true);

    snoozeUpdate("0.2.0", 1_000, 60_000, storage);
    expect(isUpdateSnoozed("0.2.0", 1_500, storage)).toBe(true);
    expect(shouldShowUpdatePrompt(available, 1_500, storage)).toBe(false);
    expect(isUpdateSnoozed("0.3.0", 1_500, storage)).toBe(false);
    expect(
      shouldShowUpdatePrompt(
        { ...available, latestVersion: "0.3.0" },
        1_500,
        storage,
      ),
    ).toBe(true);
  });

  it("expires snooze after the deadline and clears storage", () => {
    const storage = memoryStorage();
    snoozeUpdate("0.2.0", 1_000, 60_000, storage);
    expect(shouldShowUpdatePrompt(available, 70_000, storage)).toBe(true);
    clearUpdateSnooze(storage);
    expect(storage.snapshot()[UPDATE_SNOOZE_STORAGE_KEY]).toBeUndefined();
  });

  it("ignores non-available check results", () => {
    const storage = memoryStorage();
    expect(
      shouldShowUpdatePrompt(
        { status: "up-to-date", currentVersion: "0.1.0", latestVersion: "0.1.0" },
        1_000,
        storage,
      ),
    ).toBe(false);
    expect(
      shouldShowUpdatePrompt({ status: "error", message: "offline" }, 1_000, storage),
    ).toBe(false);
  });

  it("formats download progress labels", () => {
    expect(formatUpdateProgressLabel(null)).toBe("正在下载更新…");
    expect(
      formatUpdateProgressLabel({
        percent: 42.6,
        transferred: 42,
        total: 100,
        bytesPerSecond: 10,
      }),
    ).toBe("正在下载更新… 43%");
    expect(
      formatUpdateProgressLabel({
        percent: 10,
        transferred: 0,
        total: 0,
        bytesPerSecond: 0,
      }),
    ).toBe("正在下载更新…");
  });
});
