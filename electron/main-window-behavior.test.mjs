import { describe, expect, it } from "vitest";
import { shouldMinimizeMainWindowOnClose } from "./main-window-behavior.mjs";

describe("desktop main window close behavior", () => {
  it("keeps the macOS main window discoverable while the app stays in the tray", () => {
    expect(shouldMinimizeMainWindowOnClose({ platform: "darwin", isQuitting: false })).toBe(true);
  });

  it("allows the real quit path to close the window", () => {
    expect(shouldMinimizeMainWindowOnClose({ platform: "darwin", isQuitting: true })).toBe(false);
    expect(shouldMinimizeMainWindowOnClose({ platform: "linux", isQuitting: false })).toBe(false);
  });
});
