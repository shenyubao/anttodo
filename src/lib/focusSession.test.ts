import { describe, expect, it } from "vitest";
import type { FocusSession } from "../types";
import {
  buildFocusDayTimeline,
  applyFocusSettingsToRuntime,
  claimFocusRuntimeCompletion,
  formatFocusTrayTitle,
  formatFocusClock,
  formatFocusDuration,
  groupFocusSessionsByDay,
  isPomodoroCount,
  nextBreakKind,
  summarizeFocusSessions,
  switchFocusTask,
  totalElapsedSeconds,
  type FocusRuntimeState,
  type FocusTimerPhase,
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

function createRuntime(
  phase: FocusTimerPhase,
  partial: Partial<FocusRuntimeState> = {},
): FocusRuntimeState {
  return {
    phase,
    mode: "pomodoro",
    taskId: null,
    notes: "",
    plannedSeconds: 1500,
    elapsedSeconds: 0,
    startedAt: null,
    pausedAt: null,
    completedPomodoros: 0,
    breakKind: null,
    ...partial,
  };
}

describe("focusSession helpers", () => {
  it("formats clocks and durations", () => {
    expect(formatFocusClock(1500)).toBe("25:00");
    expect(formatFocusClock(3661)).toBe("1:01:01");
    expect(formatFocusDuration(1500)).toBe("25m");
    expect(formatFocusDuration(5400)).toBe("1h 30m");
  });

  it("settles an active stopwatch onto the previous task when switching", () => {
    const now = Date.UTC(2026, 7, 10, 12, 0, 0);
    const startedAt = new Date(now - 120_000).toISOString();
    const state = createRuntime("stopwatch", {
      mode: "stopwatch",
      taskId: "task-a",
      notes: "keep",
      startedAt,
      elapsedSeconds: 30,
    });

    expect(totalElapsedSeconds(state, now)).toBe(150);

    const result = switchFocusTask(state, "task-b", now);
    expect(result.sessionToPersist).toEqual({
      mode: "stopwatch",
      kind: "focus",
      plannedSeconds: 150,
      elapsedSeconds: 150,
      startedAt,
      endedAt: new Date(now).toISOString(),
      notes: "keep",
      taskId: "task-a",
    });
    expect(result.nextRuntime).toMatchObject({
      phase: "stopwatch",
      mode: "stopwatch",
      taskId: "task-b",
      plannedSeconds: 0,
      elapsedSeconds: 0,
      startedAt: new Date(now).toISOString(),
      pausedAt: null,
    });
  });

  it("does not persist short stopwatch segments on task switch", () => {
    const now = Date.UTC(2026, 7, 10, 12, 0, 0);
    const state = createRuntime("stopwatch", {
      mode: "stopwatch",
      taskId: "task-a",
      startedAt: new Date(now - 45_000).toISOString(),
    });
    const result = switchFocusTask(state, "task-b", now);
    expect(result.sessionToPersist).toBeNull();
    expect(result.nextRuntime.taskId).toBe("task-b");
    expect(result.nextRuntime.phase).toBe("stopwatch");
    expect(result.nextRuntime.startedAt).toBe(new Date(now).toISOString());
  });

  it("only updates taskId outside stopwatch phase", () => {
    const focusing = createRuntime("focusing", { taskId: "task-a", mode: "pomodoro" });
    const result = switchFocusTask(focusing, "task-b");
    expect(result.sessionToPersist).toBeNull();
    expect(result.nextRuntime).toEqual({ ...focusing, taskId: "task-b" });

    const same = switchFocusTask(focusing, "task-a");
    expect(same.nextRuntime).toBe(focusing);
  });

  it("formats the macOS tray title only for pomodoro work", () => {
    const startedAt = new Date(2026, 7, 6, 10, 0, 0).toISOString();
    const focusing = createRuntime("focusing", {
      mode: "pomodoro",
      plannedSeconds: 1500,
      startedAt,
    });
    const paused = { ...focusing, pausedAt: new Date(2026, 7, 6, 10, 5, 0).toISOString() };

    expect(formatFocusTrayTitle(focusing, new Date(2026, 7, 6, 10, 0, 10).getTime()))
      .toBe("24:50");
    expect(formatFocusTrayTitle(paused, new Date(2026, 7, 6, 10, 20, 0).getTime()))
      .toBe("25:00");
    expect(formatFocusTrayTitle(createRuntime("breaking"), Date.now())).toBe("");
    expect(formatFocusTrayTitle(createRuntime("stopwatch", { mode: "stopwatch" }), Date.now()))
      .toBe("");
    expect(formatFocusTrayTitle(createRuntime("idle"), Date.now())).toBe("");
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

  it("applies new timer durations while the pomodoro clock is not running", () => {
    const settings = {
      pomodoro_minutes: 30,
      short_break_minutes: 8,
      long_break_minutes: 20,
    };
    const idle = createRuntime("idle", {
      mode: "pomodoro",
      plannedSeconds: 1500,
    });
    const harvested = createRuntime("harvested", {
      mode: "pomodoro",
      plannedSeconds: 300,
      breakKind: "short_break",
    });

    expect(applyFocusSettingsToRuntime(idle, settings).plannedSeconds).toBe(1800);
    expect(applyFocusSettingsToRuntime(harvested, settings).plannedSeconds).toBe(480);
  });

  it("claims a runtime completion only once across windows", () => {
    const claimKey = "test-claim";
    const originalStorage = globalThis.localStorage;
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
      },
    });
    expect(claimFocusRuntimeCompletion("u-test", "w-test", claimKey)).toBe(true);
    expect(claimFocusRuntimeCompletion("u-test", "w-test", claimKey)).toBe(false);
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: originalStorage,
    });
  });

  it("keeps the current plan while a pomodoro phase is running", () => {
    const settings = {
      pomodoro_minutes: 30,
      short_break_minutes: 8,
      long_break_minutes: 20,
    };
    const focusing = createRuntime("focusing", {
      mode: "pomodoro",
      plannedSeconds: 1500,
    });
    const breaking = createRuntime("breaking", {
      mode: "pomodoro",
      plannedSeconds: 300,
      breakKind: "short_break",
    });

    expect(applyFocusSettingsToRuntime(focusing, settings)).toBe(focusing);
    expect(applyFocusSettingsToRuntime(breaking, settings)).toBe(breaking);
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
