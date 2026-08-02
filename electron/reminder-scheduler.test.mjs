import { describe, expect, it, vi } from "vitest";
import { createReminderScheduler } from "./reminder-scheduler.mjs";

function entry(id, triggerAt) {
  return {
    id,
    reminderId: "reminder-1",
    taskId: "task-1",
    workspaceId: "workspace-1",
    title: "开会",
    body: "准备材料",
    triggerAt,
  };
}

describe("desktop reminder scheduler", () => {
  it("schedules, deduplicates and acknowledges a persistent sequence", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-02T01:00:00Z"));
    const show = vi.fn();
    const scheduler = createReminderScheduler({ show });
    const entries = [
      entry("reminder-1:0", "2026-08-02T01:01:00Z"),
      entry("reminder-1:1", "2026-08-02T01:03:00Z"),
    ];
    scheduler.sync(entries);
    scheduler.sync(entries);
    vi.advanceTimersByTime(60_000);
    expect(show).toHaveBeenCalledTimes(1);
    show.mock.calls[0][1]();
    vi.advanceTimersByTime(120_000);
    expect(show).toHaveBeenCalledTimes(1);
    scheduler.dispose();
    vi.useRealTimers();
  });

  it("recovers only reminders missed by at most five minutes", () => {
    const show = vi.fn();
    const scheduler = createReminderScheduler({
      now: () => new Date("2026-08-02T01:10:00Z").getTime(),
      show,
    });
    scheduler.sync([
      entry("recent", "2026-08-02T01:06:00Z"),
      entry("old", "2026-08-02T01:04:00Z"),
    ]);
    expect(show).toHaveBeenCalledTimes(1);
    expect(show.mock.calls[0][0].id).toBe("recent");
  });
});
