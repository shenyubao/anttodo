import { describe, expect, it } from "vitest";
import { createDeepLinkQueue, parseDesktopDeepLink } from "./deep-link.mjs";

describe("desktop application deep links", () => {
  it("parses navigation commands and optional workspaces", () => {
    expect(parseDesktopDeepLink("anttodo://open/view?workspace=team-1&view=today"))
      .toEqual({ type: "navigate", target: "view", workspaceId: "team-1", view: "today" });
    expect(parseDesktopDeepLink("anttodo://open/task?task=task-1"))
      .toEqual({ type: "navigate", target: "task", workspaceId: null, taskId: "task-1" });
    expect(parseDesktopDeepLink("anttodo://open/calendar?workspace=team-1"))
      .toEqual({ type: "navigate", target: "calendar", workspaceId: "team-1" });
    expect(parseDesktopDeepLink("anttodo://open/focus"))
      .toEqual({ type: "navigate", target: "focus", workspaceId: null });
    expect(parseDesktopDeepLink(
      "anttodo://open/view?view=custom%3A00000000-0000-4000-8000-000000000001",
    )).toMatchObject({ target: "view", view: "custom:00000000-0000-4000-8000-000000000001" });
  });

  it("parses focus controls", () => {
    expect(parseDesktopDeepLink(
      "anttodo://focus/pomodoro/start?workspace=team-1&task=task-1",
    )).toEqual({
      type: "focus",
      action: "start",
      mode: "pomodoro",
      workspaceId: "team-1",
      taskId: "task-1",
    });
    expect(parseDesktopDeepLink("anttodo://focus/stopwatch/pause"))
      .toEqual({ type: "focus", action: "pause", mode: "stopwatch", workspaceId: null });
    expect(parseDesktopDeepLink("anttodo://focus/switch?task=task-1"))
      .toEqual({ type: "focus", action: "switch", workspaceId: null, taskId: "task-1" });
  });

  it("rejects malformed commands and unknown parameters", () => {
    expect(parseDesktopDeepLink("anttodo://open/view?view=today&view=week")).toBeNull();
    expect(parseDesktopDeepLink("anttodo://open/view?view=unknown")).toBeNull();
    expect(parseDesktopDeepLink("anttodo://focus/switch")).toBeNull();
    expect(parseDesktopDeepLink("anttodo://focus/pomodoro/start?foo=bar")).toBeNull();
    expect(parseDesktopDeepLink("anttodo://focus/pomodoro/start?task=a/b")).toBeNull();
    expect(parseDesktopDeepLink("https://open/view?view=today")).toBeNull();
    expect(parseDesktopDeepLink("anttodo://open/view#today?view=today")).toBeNull();
  });

  it("bounds pending commands", () => {
    const queue = createDeepLinkQueue(2);
    queue.enqueue({ id: "first" });
    queue.enqueue({ id: "second" });
    queue.enqueue({ id: "third" });
    expect(queue.take()).toEqual({ id: "second" });
    expect(queue.take()).toEqual({ id: "third" });
    expect(queue.take()).toBeNull();
  });
});
