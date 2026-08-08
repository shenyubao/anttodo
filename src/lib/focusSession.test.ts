import { describe, expect, it } from "vitest";
import type { FocusSession } from "../types";
import {
  buildFocusDayTimeline,
  formatFocusClock,
  formatFocusDuration,
  groupFocusSessionsByDay,
  isPomodoroCount,
  nextBreakKind,
  summarizeFocusSessions,
} from "./focusSession";

function session(partial: Partial<FocusSession> & Pick<FocusSession, "started_at">): FocusSession {
  return {
    id: partial.id ?? "s1",
    user_id: "u1",
    workspace_id: "w1",
    task_id: partial.task_id ?? null,
    mode: partial.mode ?? "pomodoro",
    kind: partial.kind ?? "focus",
    planned_seconds: partial.planned_seconds ?? 1500,
    elapsed_seconds: partial.elapsed_seconds ?? 1500,
    notes: partial.notes ?? null,
    started_at: partial.started_at,
    ended_at: partial.ended_at ?? partial.started_at,
    created_at: partial.created_at ?? partial.started_at,
  };
}

describe("focusSession helpers", () => {
  it("formats clocks and durations", () => {
    expect(formatFocusClock(1500)).toBe("25:00");
    expect(formatFocusClock(3661)).toBe("1:01:01");
    expect(formatFocusDuration(1500)).toBe("25m");
    expect(formatFocusDuration(5400)).toBe("1h 30m");
  });

  it("counts pomodoros and aggregates overview stats", () => {
    const now = new Date(2026, 7, 6, 22, 0, 0);
    const today = session({
      id: "today",
      started_at: new Date(2026, 7, 6, 10, 0, 0).toISOString(),
      elapsed_seconds: 1500,
      planned_seconds: 1500,
    });
    const yesterday = session({
      id: "yesterday",
      started_at: new Date(2026, 7, 5, 10, 0, 0).toISOString(),
      elapsed_seconds: 900,
      planned_seconds: 1500,
    });
    const short = session({
      id: "short",
      started_at: new Date(2026, 7, 6, 12, 0, 0).toISOString(),
      elapsed_seconds: 300,
      planned_seconds: 1500,
    });
    const breakSession = session({
      id: "break",
      kind: "short_break",
      started_at: new Date(2026, 7, 6, 11, 0, 0).toISOString(),
      elapsed_seconds: 300,
      planned_seconds: 300,
    });

    expect(isPomodoroCount(today)).toBe(true);
    expect(isPomodoroCount(short)).toBe(false);

    expect(summarizeFocusSessions([today, yesterday, short, breakSession], now)).toEqual({
      todayPomodoros: 1,
      todayFocusSeconds: 1800,
      totalPomodoros: 1,
      totalFocusSeconds: 2700,
    });

    const groups = groupFocusSessionsByDay([today, yesterday, breakSession]);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.dateKey).toBe("2026-08-06");
  });

  it("picks long break on interval boundaries", () => {
    expect(nextBreakKind(1, 4)).toBe("short_break");
    expect(nextBreakKind(4, 4)).toBe("long_break");
    expect(nextBreakKind(8, 4)).toBe("long_break");
  });

  it("builds a day timeline with session blocks and now indicator", () => {
    const nowMs = new Date(2026, 7, 6, 23, 10, 0).getTime();
    const layout = buildFocusDayTimeline({
      sessions: [
        session({
          id: "block",
          started_at: new Date(2026, 7, 6, 19, 44, 0).toISOString(),
          ended_at: new Date(2026, 7, 6, 20, 9, 0).toISOString(),
          elapsed_seconds: 1500,
        }),
      ],
      nowMs,
      liveSession: {
        id: "live",
        startedAt: new Date(2026, 7, 6, 23, 0, 0).toISOString(),
        elapsedSeconds: 600,
        segment: "work",
      },
    });

    expect(layout.blocks).toHaveLength(2);
    expect(layout.nowTop).not.toBeNull();
    expect(layout.hourMarks.length).toBeGreaterThanOrEqual(5);
    expect(layout.blocks.some((block) => block.live)).toBe(true);
    expect(layout.blocks.find((block) => block.id === "block")?.segment).toBe("work");
    expect(layout.blocks.find((block) => block.live)?.segment).toBe("work");
  });

  it("colors break sessions as break segments on the day timeline", () => {
    const nowMs = new Date(2026, 7, 6, 12, 0, 0).getTime();
    const layout = buildFocusDayTimeline({
      sessions: [
        session({
          id: "work",
          kind: "focus",
          started_at: new Date(2026, 7, 6, 10, 0, 0).toISOString(),
          ended_at: new Date(2026, 7, 6, 10, 25, 0).toISOString(),
          elapsed_seconds: 1500,
        }),
        session({
          id: "break",
          kind: "short_break",
          started_at: new Date(2026, 7, 6, 10, 25, 0).toISOString(),
          ended_at: new Date(2026, 7, 6, 10, 30, 0).toISOString(),
          elapsed_seconds: 300,
          planned_seconds: 300,
        }),
      ],
      nowMs,
    });

    expect(layout.blocks.find((block) => block.id === "work")?.segment).toBe("work");
    expect(layout.blocks.find((block) => block.id === "break")?.segment).toBe("break");
  });
});
