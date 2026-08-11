import type { FocusSession, FocusSettings } from "../types";

export type FocusTimerPhase =
  | "idle"
  | "focusing"
  | "harvested"
  | "breaking"
  | "stopwatch";

export type FocusTimerMode = "pomodoro" | "stopwatch";

export type FocusRuntimeState = {
  phase: FocusTimerPhase;
  mode: FocusTimerMode;
  taskId: string | null;
  notes: string;
  plannedSeconds: number;
  elapsedSeconds: number;
  startedAt: string | null;
  pausedAt: string | null;
  completedPomodoros: number;
  breakKind: "short_break" | "long_break" | null;
};

export type FocusOverviewStats = {
  todayPomodoros: number;
  todayFocusSeconds: number;
  totalPomodoros: number;
  totalFocusSeconds: number;
};

export const FOCUS_RUNTIME_UPDATED_EVENT = "anttodo:focus-runtime-updated";

export const DEFAULT_FOCUS_SETTINGS: Omit<FocusSettings, "user_id" | "workspace_id"> = {
  pomodoro_minutes: 25,
  short_break_minutes: 5,
  long_break_minutes: 15,
  long_break_interval: 4,
  auto_start_pomodoro: false,
  auto_start_break: false,
  show_tab_title: true,
  sound_enabled: true,
};

export function createDefaultFocusSettings(
  userId: string,
  workspaceId: string,
): FocusSettings {
  return {
    user_id: userId,
    workspace_id: workspaceId,
    ...DEFAULT_FOCUS_SETTINGS,
  };
}

export function createIdleRuntimeState(
  settings: Pick<FocusSettings, "pomodoro_minutes">,
): FocusRuntimeState {
  return {
    phase: "idle",
    mode: "pomodoro",
    taskId: null,
    notes: "",
    plannedSeconds: settings.pomodoro_minutes * 60,
    elapsedSeconds: 0,
    startedAt: null,
    pausedAt: null,
    completedPomodoros: 0,
    breakKind: null,
  };
}

export function formatFocusClock(totalSeconds: number) {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function formatFocusTrayTitle(
  state: FocusRuntimeState | null | undefined,
  nowMs = Date.now(),
) {
  if (!state) return "";
  if (state.mode === "pomodoro" && state.phase === "focusing") {
    return formatFocusClock(remainingSeconds(state, nowMs));
  }
  if (state.mode === "stopwatch" && state.phase === "stopwatch") {
    return formatFocusClock(displayedSeconds(state, nowMs));
  }
  return "";
}

export function formatFocusDuration(totalSeconds: number) {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  return `${safe}s`;
}

export function remainingSeconds(state: FocusRuntimeState, nowMs = Date.now()) {
  if (state.phase === "stopwatch") {
    return Math.max(0, state.elapsedSeconds + runningDeltaSeconds(state, nowMs));
  }
  const elapsed = state.elapsedSeconds + runningDeltaSeconds(state, nowMs);
  return Math.max(0, state.plannedSeconds - elapsed);
}

export function displayedSeconds(state: FocusRuntimeState, nowMs = Date.now()) {
  if (state.mode === "stopwatch" || state.phase === "stopwatch") {
    return Math.max(0, state.elapsedSeconds + runningDeltaSeconds(state, nowMs));
  }
  return remainingSeconds(state, nowMs);
}

export function progressRatio(state: FocusRuntimeState, nowMs = Date.now()) {
  if (state.plannedSeconds <= 0) return 0;
  if (state.mode === "stopwatch" || state.phase === "stopwatch") {
    return Math.min(1, displayedSeconds(state, nowMs) / Math.max(state.plannedSeconds, 1));
  }
  const elapsed = state.plannedSeconds - remainingSeconds(state, nowMs);
  return Math.min(1, Math.max(0, elapsed / state.plannedSeconds));
}

/** Minimum elapsed seconds before a focus segment is stored (and applied to actual hours). */
export const FOCUS_SESSION_MIN_SECONDS = 60;

export function totalElapsedSeconds(state: FocusRuntimeState, nowMs = Date.now()) {
  return Math.max(0, state.elapsedSeconds + runningDeltaSeconds(state, nowMs));
}

export type SwitchFocusTaskSession = {
  mode: "stopwatch";
  kind: "focus";
  plannedSeconds: number;
  elapsedSeconds: number;
  startedAt: string;
  endedAt: string;
  notes: string;
  taskId: string | null;
};

export type SwitchFocusTaskResult = {
  sessionToPersist: SwitchFocusTaskSession | null;
  nextRuntime: FocusRuntimeState;
};

/**
 * When the linked task changes during an active stopwatch, settle the previous
 * segment onto the old task (if long enough) and start a fresh stopwatch for the
 * new task. Other phases only update taskId.
 */
export function switchFocusTask(
  state: FocusRuntimeState,
  nextTaskId: string | null,
  nowMs = Date.now(),
): SwitchFocusTaskResult {
  if (state.taskId === nextTaskId) {
    return { sessionToPersist: null, nextRuntime: state };
  }

  if (state.phase !== "stopwatch") {
    return {
      sessionToPersist: null,
      nextRuntime: { ...state, taskId: nextTaskId },
    };
  }

  const elapsed = totalElapsedSeconds(state, nowMs);
  const endedAt = new Date(nowMs).toISOString();
  const sessionToPersist = elapsed >= FOCUS_SESSION_MIN_SECONDS
    ? {
        mode: "stopwatch" as const,
        kind: "focus" as const,
        plannedSeconds: elapsed,
        elapsedSeconds: elapsed,
        startedAt: state.startedAt
          ?? state.pausedAt
          ?? new Date(nowMs - elapsed * 1000).toISOString(),
        endedAt,
        notes: state.notes,
        taskId: state.taskId,
      }
    : null;

  return {
    sessionToPersist,
    nextRuntime: {
      ...state,
      taskId: nextTaskId,
      phase: "stopwatch",
      mode: "stopwatch",
      plannedSeconds: 0,
      elapsedSeconds: 0,
      startedAt: new Date(nowMs).toISOString(),
      pausedAt: null,
      breakKind: null,
    },
  };
}

function runningDeltaSeconds(state: FocusRuntimeState, nowMs: number) {
  if (!state.startedAt || state.pausedAt) return 0;
  if (
    state.phase !== "focusing"
    && state.phase !== "breaking"
    && state.phase !== "stopwatch"
  ) {
    return 0;
  }
  return Math.max(0, Math.floor((nowMs - new Date(state.startedAt).getTime()) / 1000));
}

export function isFocusSessionCountable(session: Pick<FocusSession, "kind">) {
  return session.kind === "focus";
}

export function isPomodoroCount(session: Pick<FocusSession, "kind" | "mode" | "planned_seconds" | "elapsed_seconds">) {
  if (session.kind !== "focus" || session.mode !== "pomodoro") return false;
  return session.elapsed_seconds >= Math.max(1, Math.floor(session.planned_seconds * 0.8));
}

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export type FocusTimelineSegment = "work" | "break";

export type FocusTimelineBlock = {
  id: string;
  startMs: number;
  endMs: number;
  segment: FocusTimelineSegment;
  taskId?: string | null;
  live?: boolean;
};

export type FocusTimelineLayout = {
  rangeStartMs: number;
  rangeEndMs: number;
  hourMarks: number[];
  blocks: Array<FocusTimelineBlock & { top: number; height: number }>;
  nowTop: number | null;
};

const HOUR_MS = 3_600_000;
const MIN_TIMELINE_HOURS = 5;
const PIXELS_PER_HOUR = 72;

export function focusTimelineSegment(
  kind: FocusSession["kind"],
): FocusTimelineSegment {
  return kind === "focus" ? "work" : "break";
}

export function buildFocusDayTimeline(input: {
  sessions: FocusSession[];
  nowMs: number;
  liveSession?: {
    id: string;
    startedAt: string;
    elapsedSeconds: number;
    segment: FocusTimelineSegment;
    taskId?: string | null;
  } | null;
}): FocusTimelineLayout {
  const now = new Date(input.nowMs);
  const dayStart = startOfLocalDay(now).getTime();
  const dayEnd = dayStart + 24 * HOUR_MS;

  const blocks: FocusTimelineBlock[] = [];
  for (const session of input.sessions) {
    const startMs = new Date(session.started_at).getTime();
    const endMs = new Date(session.ended_at).getTime();
    if (endMs <= dayStart || startMs >= dayEnd) continue;
    blocks.push({
      id: session.id,
      startMs: Math.max(startMs, dayStart),
      endMs: Math.min(endMs, dayEnd),
      segment: focusTimelineSegment(session.kind),
      taskId: session.task_id,
    });
  }

  if (input.liveSession) {
    const startMs = new Date(input.liveSession.startedAt).getTime();
    const endMs = Math.max(startMs + Math.max(60, input.liveSession.elapsedSeconds) * 1000, input.nowMs);
    if (endMs > dayStart && startMs < dayEnd) {
      blocks.push({
        id: input.liveSession.id,
        startMs: Math.max(startMs, dayStart),
        endMs: Math.min(endMs, dayEnd),
        segment: input.liveSession.segment,
        taskId: input.liveSession.taskId ?? null,
        live: true,
      });
    }
  }

  const nowHourStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    now.getHours(),
  ).getTime();

  let rangeStartMs = nowHourStart - HOUR_MS;
  let rangeEndMs = nowHourStart + 4 * HOUR_MS;

  for (const block of blocks) {
    rangeStartMs = Math.min(rangeStartMs, Math.floor(block.startMs / HOUR_MS) * HOUR_MS);
    rangeEndMs = Math.max(rangeEndMs, Math.ceil(block.endMs / HOUR_MS) * HOUR_MS);
  }

  if (rangeEndMs - rangeStartMs < MIN_TIMELINE_HOURS * HOUR_MS) {
    rangeEndMs = rangeStartMs + MIN_TIMELINE_HOURS * HOUR_MS;
  }

  const totalMs = rangeEndMs - rangeStartMs;
  const hourMarks: number[] = [];
  for (let mark = rangeStartMs; mark <= rangeEndMs; mark += HOUR_MS) {
    hourMarks.push(mark);
  }

  const positioned = blocks.map((block) => {
    const top = ((block.startMs - rangeStartMs) / totalMs) * 100;
    const height = Math.max(2, ((block.endMs - block.startMs) / totalMs) * 100);
    return { ...block, top, height };
  });

  const nowTop = input.nowMs >= rangeStartMs && input.nowMs <= rangeEndMs
    ? ((input.nowMs - rangeStartMs) / totalMs) * 100
    : null;

  return {
    rangeStartMs,
    rangeEndMs,
    hourMarks,
    blocks: positioned,
    nowTop,
  };
}

export function focusTimelineHeightPx(
  layout: FocusTimelineLayout,
  minHeightPx = 0,
) {
  const hours = (layout.rangeEndMs - layout.rangeStartMs) / HOUR_MS;
  return Math.max(minHeightPx, Math.max(MIN_TIMELINE_HOURS, hours) * PIXELS_PER_HOUR);
}

export function summarizeFocusSessions(
  sessions: FocusSession[],
  now = new Date(),
): FocusOverviewStats {
  const todayStart = startOfLocalDay(now).getTime();
  let todayPomodoros = 0;
  let todayFocusSeconds = 0;
  let totalPomodoros = 0;
  let totalFocusSeconds = 0;

  for (const session of sessions) {
    if (!isFocusSessionCountable(session)) continue;
    totalFocusSeconds += session.elapsed_seconds;
    if (isPomodoroCount(session)) totalPomodoros += 1;
    const started = new Date(session.started_at).getTime();
    if (started >= todayStart) {
      todayFocusSeconds += session.elapsed_seconds;
      if (isPomodoroCount(session)) todayPomodoros += 1;
    }
  }

  return {
    todayPomodoros,
    todayFocusSeconds,
    totalPomodoros,
    totalFocusSeconds,
  };
}

export function groupFocusSessionsByDay(sessions: FocusSession[]) {
  const groups = new Map<string, FocusSession[]>();
  for (const session of sessions) {
    if (!isFocusSessionCountable(session)) continue;
    const date = new Date(session.started_at);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const list = groups.get(key) ?? [];
    list.push(session);
    groups.set(key, list);
  }
  return [...groups.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([dateKey, items]) => ({
      dateKey,
      sessions: items,
    }));
}

export function formatFocusDayLabel(dateKey: string, now = new Date()) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const today = startOfLocalDay(now);
  const target = startOfLocalDay(date);
  const diffDays = Math.round((today.getTime() - target.getTime()) / 86_400_000);
  if (diffDays === 0) return "今天";
  if (diffDays === 1) return "昨天";
  if (date.getFullYear() === now.getFullYear()) {
    return `${month}月${day}日`;
  }
  return `${year}年${month}月${day}日`;
}

export function formatFocusTimeRange(startedAt: string, endedAt: string) {
  const start = new Date(startedAt);
  const end = new Date(endedAt);
  const fmt = (value: Date) =>
    `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
  return `${fmt(start)} - ${fmt(end)}`;
}

export function nextBreakKind(
  completedPomodoros: number,
  interval: number,
): "short_break" | "long_break" {
  if (interval <= 0) return "short_break";
  return completedPomodoros > 0 && completedPomodoros % interval === 0
    ? "long_break"
    : "short_break";
}

export function breakSeconds(
  kind: "short_break" | "long_break",
  settings: Pick<FocusSettings, "short_break_minutes" | "long_break_minutes">,
) {
  return (kind === "long_break" ? settings.long_break_minutes : settings.short_break_minutes) * 60;
}

export function applyFocusSettingsToRuntime(
  state: FocusRuntimeState,
  settings: Pick<FocusSettings, "pomodoro_minutes" | "short_break_minutes" | "long_break_minutes">,
): FocusRuntimeState {
  if (state.phase !== "idle" && state.phase !== "harvested") return state;
  if (state.mode !== "pomodoro") return state;

  const plannedSeconds = state.phase === "harvested"
    ? breakSeconds(state.breakKind ?? "short_break", settings)
    : settings.pomodoro_minutes * 60;
  if (state.plannedSeconds === plannedSeconds) return state;
  return { ...state, plannedSeconds };
}

export function focusRuntimeStorageKey(userId: string, workspaceId: string) {
  return `anttodo:focus-runtime:${userId}:${workspaceId}`;
}

export function loadFocusRuntimeState(
  userId: string,
  workspaceId: string,
): FocusRuntimeState | null {
  try {
    const raw = localStorage.getItem(focusRuntimeStorageKey(userId, workspaceId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FocusRuntimeState;
    if (!parsed || typeof parsed !== "object" || !parsed.phase) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveFocusRuntimeState(
  userId: string,
  workspaceId: string,
  state: FocusRuntimeState,
) {
  try {
    localStorage.setItem(focusRuntimeStorageKey(userId, workspaceId), JSON.stringify(state));
  } catch {
    // Ignore quota / private mode failures.
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(FOCUS_RUNTIME_UPDATED_EVENT, {
      detail: { userId, workspaceId },
    }));
  }
}

export function clearFocusRuntimeState(userId: string, workspaceId: string) {
  try {
    localStorage.removeItem(focusRuntimeStorageKey(userId, workspaceId));
  } catch {
    // Ignore storage failures.
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(FOCUS_RUNTIME_UPDATED_EVENT, {
      detail: { userId, workspaceId },
    }));
  }
}

export function claimFocusRuntimeCompletion(
  userId: string,
  workspaceId: string,
  claimKey: string,
) {
  if (typeof localStorage === "undefined") return true;
  const key = `anttodo:focus-completion:${userId}:${workspaceId}:${claimKey}`;
  try {
    if (localStorage.getItem(key)) return false;
    localStorage.setItem(key, new Date().toISOString());
    return true;
  } catch {
    return true;
  }
}

export function playFocusChime(enabled: boolean) {
  if (!enabled || typeof window === "undefined") return;
  try {
    const AudioContextCtor = window.AudioContext
      || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;
    const context = new AudioContextCtor();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 880;
    gain.gain.value = 0.05;
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.6);
    oscillator.stop(context.currentTime + 0.65);
    window.setTimeout(() => {
      void context.close();
    }, 800);
  } catch {
    // Audio may be blocked; ignore.
  }
}
