import { describe, expect, it } from "vitest";
import {
  SHORTCUT_ACTIONS,
  SHORTCUT_STORAGE_KEY,
  actionsByGroup,
  bindingsEqual,
  bindingFromKeyboardEvent,
  detectShortcutPlatform,
  findBindingConflict,
  formatBinding,
  getEffectiveBindings,
  isEditableKeyboardTarget,
  loadShortcutOverrides,
  matchBinding,
  normalizeBinding,
  parseShortcutOverrides,
  resolveBindings,
  saveShortcutOverrides,
} from "./keyboardShortcuts";

describe("keyboardShortcuts", () => {
  it("includes work hours and pomodoro controls with non-conflicting defaults", () => {
    expect(SHORTCUT_ACTIONS.find((action) => action.id === "task.logHours")).toMatchObject({
      group: "tasks",
      label: "登记工时",
      defaultBinding: { key: "h", mod: true, shift: true },
      scopes: ["tasks"],
    });
    expect(SHORTCUT_ACTIONS.find((action) => action.id === "focus.startPomodoro")).toMatchObject({
      group: "focus",
      label: "开启番茄闹钟",
      defaultBinding: { key: "p", mod: true, shift: true },
      scopes: ["focus"],
    });
    expect(SHORTCUT_ACTIONS.find((action) => action.id === "focus.pausePomodoro")).toMatchObject({
      group: "focus",
      label: "暂停番茄闹钟",
      defaultBinding: { key: "Space", mod: true, shift: true },
      scopes: ["focus"],
    });
    expect(actionsByGroup().find((group) => group.group === "tasks")?.actions
      .some((action) => action.id === "task.logHours")).toBe(true);
    expect(actionsByGroup().find((group) => group.group === "focus")?.actions
      .map((action) => action.id)).toEqual(["focus.startPomodoro", "focus.pausePomodoro"]);
  });

  it("normalizes and compares bindings", () => {
    expect(normalizeBinding({ key: "S", mod: true })).toEqual({ key: "s", mod: true });
    expect(bindingsEqual({ key: "S", mod: true }, { key: "s", mod: true })).toBe(true);
    expect(bindingsEqual({ key: "s", mod: true }, { key: "s" })).toBe(false);
  });

  it("matches keyboard events with Cmd or Ctrl as mod", () => {
    const binding = { key: "k", mod: true };
    expect(
      matchBinding({ key: "k", metaKey: true, ctrlKey: false, shiftKey: false, altKey: false }, binding),
    ).toBe(true);
    expect(
      matchBinding({ key: "k", metaKey: false, ctrlKey: true, shiftKey: false, altKey: false }, binding),
    ).toBe(true);
    expect(
      matchBinding({ key: "k", metaKey: false, ctrlKey: false, shiftKey: false, altKey: false }, binding),
    ).toBe(false);
    expect(
      matchBinding({ key: "K", metaKey: true, ctrlKey: false, shiftKey: true, altKey: false }, binding),
    ).toBe(false);
  });

  it("matches punctuation shortcuts even when Shift is held", () => {
    expect(
      matchBinding(
        { key: "?", metaKey: false, ctrlKey: false, shiftKey: true, altKey: false },
        { key: "?" },
      ),
    ).toBe(true);
  });

  it("builds bindings from keyboard events and ignores modifier-only keys", () => {
    expect(
      bindingFromKeyboardEvent({
        key: "n",
        metaKey: false,
        ctrlKey: false,
        shiftKey: true,
        altKey: false,
      }),
    ).toEqual({ key: "n", shift: true });
    expect(
      bindingFromKeyboardEvent({
        key: "Meta",
        metaKey: true,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
      }),
    ).toBeNull();
  });

  it("formats bindings for mac and other platforms", () => {
    expect(formatBinding({ key: "s", mod: true }, "mac")).toBe("⌘+S");
    expect(formatBinding({ key: "s", mod: true }, "other")).toBe("Ctrl+S");
    expect(formatBinding({ key: "Enter", shift: true }, "mac")).toBe("⇧+Return");
    expect(formatBinding({ key: "Escape" }, "mac")).toBe("Esc");
    expect(formatBinding({ key: "ArrowLeft" }, "mac")).toBe("←");
  });

  it("detects mac platforms from darwin and MacIntel", () => {
    expect(detectShortcutPlatform("darwin")).toBe("mac");
    expect(detectShortcutPlatform("MacIntel")).toBe("mac");
    expect(detectShortcutPlatform("Win32")).toBe("other");
  });

  it("parses overrides, ignores unknown ids", () => {
    expect(parseShortcutOverrides(null)).toEqual({});
    expect(parseShortcutOverrides("{")).toEqual({});
    expect(
      parseShortcutOverrides(
        JSON.stringify({
          "general.search": { key: "f", mod: true },
          "not.an.action": { key: "x" },
          "task.focusQuickAdd": { key: "N" },
        }),
      ),
    ).toEqual({
      "general.search": { key: "f", mod: true },
      "task.focusQuickAdd": { key: "n" },
    });
  });

  it("loads and saves overrides via storage, dropping defaults", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    };

    expect(loadShortcutOverrides(storage)).toEqual({});
    saveShortcutOverrides(
      {
        "general.search": { key: "k", mod: true },
        "task.focusQuickAdd": { key: "c" },
      },
      storage,
    );
    expect(JSON.parse(store.get(SHORTCUT_STORAGE_KEY)!)).toEqual({
      "task.focusQuickAdd": { key: "c" },
    });
    expect(loadShortcutOverrides(storage)).toEqual({
      "task.focusQuickAdd": { key: "c" },
    });
  });

  it("resolves bindings with overrides and keeps digit aliases on defaults", () => {
    const resolved = resolveBindings({ "calendar.viewDay": { key: "q" } });
    expect(resolved["calendar.viewDay"]).toEqual({ key: "q" });
    expect(getEffectiveBindings("calendar.viewDay", { "calendar.viewDay": { key: "q" } })).toEqual([
      { key: "q" },
    ]);
    expect(getEffectiveBindings("calendar.viewDay")).toEqual([{ key: "d" }, { key: "1" }]);
  });

  it("detects conflicts within overlapping scopes", () => {
    expect(findBindingConflict("task.focusQuickAdd", { key: "n" })).toBeNull();
    expect(findBindingConflict("general.search", { key: "k", mod: true })).toBeNull();
    expect(findBindingConflict("task.complete", { key: "Enter", shift: true })).toBe("task.addSubtask");
    expect(findBindingConflict("calendar.viewDay", { key: "1" })).toBeNull();
    expect(findBindingConflict("calendar.viewWeek", { key: "1" })).toBe("calendar.viewDay");
    expect(findBindingConflict("general.goTasks", { key: "2", mod: true })).toBe("general.goCalendar");
  });

  it("detects editable keyboard targets", () => {
    const input = document.createElement("input");
    const div = document.createElement("div");
    expect(isEditableKeyboardTarget(input)).toBe(true);
    expect(isEditableKeyboardTarget(div)).toBe(false);
  });
});
