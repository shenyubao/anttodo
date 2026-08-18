import { afterEach, describe, expect, it } from "vitest";
import {
  getAiTerminalRunningTaskIds,
  trackAiTerminalSession,
  untrackAiTerminalSession,
} from "./aiTerminalSessions";

afterEach(() => {
  for (const sessionId of [
    "task:task-a",
    "task:one",
    "task:task-b",
  ]) {
    untrackAiTerminalSession(sessionId);
  }
});

describe("ai terminal session registry", () => {
  it("tracks and clears running task sessions", () => {
    trackAiTerminalSession("task-a", "task:task-a");
    trackAiTerminalSession("task-a", "task:one");
    expect(getAiTerminalRunningTaskIds().has("task-a")).toBe(true);

    untrackAiTerminalSession("task:task-a");
    expect(getAiTerminalRunningTaskIds().has("task-a")).toBe(true);

    untrackAiTerminalSession("task:one");
    expect(getAiTerminalRunningTaskIds().has("task-a")).toBe(false);
  });
});
