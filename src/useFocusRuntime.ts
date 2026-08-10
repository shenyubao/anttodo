import { useEffect, useRef, useState } from "react";
import {
  breakSeconds,
  applyFocusSettingsToRuntime,
  claimFocusRuntimeCompletion,
  clearFocusRuntimeState,
  createIdleRuntimeState,
  loadFocusRuntimeState,
  nextBreakKind,
  playFocusChime,
  remainingSeconds,
  saveFocusRuntimeState,
  switchFocusTask,
  totalElapsedSeconds,
  type FocusRuntimeState,
} from "./lib/focusSession";
import type { FocusSession, FocusSettings } from "./types";

type FocusRuntimeOptions = {
  userId: string;
  workspaceId: string;
  online: boolean;
  settings: FocusSettings;
  onCreateSession: (input: Omit<FocusSession, "id" | "created_at">) => Promise<FocusSession>;
  onNotice: (message: string) => void;
};

type PersistFocusSessionInput = {
  mode: FocusSession["mode"];
  kind: FocusSession["kind"];
  plannedSeconds: number;
  elapsedSeconds: number;
  startedAt: string;
  endedAt: string;
  notes: string;
  taskId: string | null;
};

export function useFocusRuntime({
  userId,
  workspaceId,
  online,
  settings,
  onCreateSession,
  onNotice,
}: FocusRuntimeOptions) {
  const [runtime, setRuntimeState] = useState<FocusRuntimeState>(() =>
    loadFocusRuntimeState(userId, workspaceId) ?? createIdleRuntimeState(settings));
  const [nowMs, setNowMs] = useState(() => Date.now());
  const runtimeRef = useRef(runtime);
  const completionHandledRef = useRef(false);
  const skipSaveRef = useRef(false);
  runtimeRef.current = runtime;

  function setRuntime(next: FocusRuntimeState | ((current: FocusRuntimeState) => FocusRuntimeState)) {
    setRuntimeState(next);
  }

  useEffect(() => {
    const restored = loadFocusRuntimeState(userId, workspaceId);
    skipSaveRef.current = true;
    setRuntimeState(restored ?? createIdleRuntimeState(settings));
  }, [settings, userId, workspaceId]);

  useEffect(() => {
    setRuntimeState((current) => applyFocusSettingsToRuntime(current, settings));
  }, [settings]);

  useEffect(() => {
    if (skipSaveRef.current) {
      skipSaveRef.current = false;
      return;
    }
    saveFocusRuntimeState(userId, workspaceId, runtime);
  }, [runtime, userId, workspaceId]);

  useEffect(() => {
    const key = `anttodo:focus-runtime:${userId}:${workspaceId}`;
    const onStorage = (event: StorageEvent) => {
      if (event.key !== key) return;
      const next = loadFocusRuntimeState(userId, workspaceId);
      skipSaveRef.current = true;
      setRuntimeState(next ?? createIdleRuntimeState(settings));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [settings, userId, workspaceId]);

  useEffect(() => {
    const active = runtime.phase === "focusing"
      || runtime.phase === "breaking"
      || runtime.phase === "stopwatch";
    if (!active || runtime.pausedAt) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [runtime.phase, runtime.pausedAt]);

  async function persistFocusSession(partial: PersistFocusSessionInput) {
    if (!online) {
      onNotice("离线时无法保存专注记录");
      return null;
    }
    try {
      return await onCreateSession({
        user_id: userId,
        workspace_id: workspaceId,
        task_id: partial.taskId,
        mode: partial.mode,
        kind: partial.kind,
        planned_seconds: partial.plannedSeconds,
        elapsed_seconds: partial.elapsedSeconds,
        notes: partial.notes.trim() || null,
        started_at: partial.startedAt,
        ended_at: partial.endedAt,
      });
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "保存专注记录失败");
      return null;
    }
  }

  async function handleTimerComplete() {
    const current = runtimeRef.current;
    const claimKey = current.startedAt ?? `${current.phase}:${current.plannedSeconds}`;
    if (!claimFocusRuntimeCompletion(userId, workspaceId, claimKey)) return;
    playFocusChime(settings.sound_enabled);

    if (current.phase === "focusing") {
      const endedAt = new Date().toISOString();
      const startedAt = current.startedAt ?? endedAt;
      await persistFocusSession({
        mode: "pomodoro",
        kind: "focus",
        plannedSeconds: current.plannedSeconds,
        elapsedSeconds: current.plannedSeconds,
        startedAt,
        endedAt,
        notes: current.notes,
        taskId: current.taskId,
      });
      const completedPomodoros = current.completedPomodoros + 1;
      const breakKind = nextBreakKind(completedPomodoros, settings.long_break_interval);
      const planned = breakSeconds(breakKind, settings);
      completionHandledRef.current = false;
      setRuntime({
        ...current,
        phase: settings.auto_start_break ? "breaking" : "harvested",
        mode: "pomodoro",
        plannedSeconds: planned,
        elapsedSeconds: 0,
        startedAt: settings.auto_start_break ? new Date().toISOString() : null,
        pausedAt: null,
        completedPomodoros,
        breakKind,
      });
      return;
    }

    if (current.phase === "breaking") {
      const endedAt = new Date().toISOString();
      const startedAt = current.startedAt ?? endedAt;
      await persistFocusSession({
        mode: "pomodoro",
        kind: current.breakKind ?? "short_break",
        plannedSeconds: current.plannedSeconds,
        elapsedSeconds: current.plannedSeconds,
        startedAt,
        endedAt,
        notes: "",
        taskId: current.taskId,
      });
      const idle = createIdleRuntimeState(settings);
      completionHandledRef.current = false;
      setRuntime(settings.auto_start_pomodoro
        ? {
            ...idle,
            phase: "focusing",
            mode: "pomodoro",
            taskId: current.taskId,
            plannedSeconds: settings.pomodoro_minutes * 60,
            startedAt: new Date().toISOString(),
            completedPomodoros: current.completedPomodoros,
          }
        : {
            ...idle,
            taskId: current.taskId,
            completedPomodoros: current.completedPomodoros,
          });
    }
  }

  useEffect(() => {
    if (runtime.phase !== "focusing" && runtime.phase !== "breaking") {
      completionHandledRef.current = false;
      return;
    }
    if (runtime.pausedAt || completionHandledRef.current) return;
    if (remainingSeconds(runtime, nowMs) > 0) return;
    completionHandledRef.current = true;
    void handleTimerComplete();
  }, [nowMs, runtime]); // eslint-disable-line react-hooks/exhaustive-deps

  function startTimer() {
    if (!online) {
      onNotice("离线时无法开始专注");
      return;
    }
    if (runtime.mode === "stopwatch") {
      setRuntime((current) => ({
        ...current,
        phase: "stopwatch",
        plannedSeconds: 0,
        elapsedSeconds: 0,
        startedAt: new Date().toISOString(),
        pausedAt: null,
        breakKind: null,
      }));
      return;
    }
    setRuntime((current) => ({
      ...current,
      phase: "focusing",
      mode: "pomodoro",
      plannedSeconds: settings.pomodoro_minutes * 60,
      elapsedSeconds: 0,
      startedAt: new Date().toISOString(),
      pausedAt: null,
      breakKind: null,
    }));
  }

  function pauseTimer() {
    setRuntime((current) => {
      if (!current.startedAt || current.pausedAt) return current;
      const delta = Math.max(
        0,
        Math.floor((Date.now() - new Date(current.startedAt).getTime()) / 1000),
      );
      return {
        ...current,
        elapsedSeconds: current.elapsedSeconds + delta,
        startedAt: null,
        pausedAt: new Date().toISOString(),
      };
    });
  }

  function resumeTimer() {
    setRuntime((current) => ({
      ...current,
      startedAt: new Date().toISOString(),
      pausedAt: null,
    }));
  }

  async function stopTimer() {
    const current = runtimeRef.current;
    const nowMs = Date.now();
    const endedAt = new Date(nowMs).toISOString();
    const elapsed = totalElapsedSeconds(current, nowMs);

    if (current.phase === "focusing" || current.phase === "stopwatch") {
      if (elapsed >= 60) {
        await persistFocusSession({
          mode: current.phase === "stopwatch" ? "stopwatch" : "pomodoro",
          kind: "focus",
          plannedSeconds: current.phase === "stopwatch" ? elapsed : current.plannedSeconds,
          elapsedSeconds: elapsed,
          startedAt: current.startedAt
            ?? current.pausedAt
            ?? new Date(nowMs - elapsed * 1000).toISOString(),
          endedAt,
          notes: current.notes,
          taskId: current.taskId,
        });
      }
    } else if (current.phase === "breaking" && elapsed >= 60) {
      await persistFocusSession({
        mode: "pomodoro",
        kind: current.breakKind ?? "short_break",
        plannedSeconds: current.plannedSeconds,
        elapsedSeconds: elapsed,
        startedAt: current.startedAt
          ?? current.pausedAt
          ?? new Date(nowMs - elapsed * 1000).toISOString(),
        endedAt,
        notes: "",
        taskId: current.taskId,
      });
    }

    const idle = createIdleRuntimeState(settings);
    setRuntime({
      ...idle,
      mode: current.mode,
      taskId: current.taskId,
      completedPomodoros: current.completedPomodoros,
    });
    clearFocusRuntimeState(userId, workspaceId);
  }

  async function selectFocusTask(taskId: string | null) {
    const current = runtimeRef.current;
    const { sessionToPersist, nextRuntime } = switchFocusTask(current, taskId);
    if (nextRuntime === current) return;
    setRuntime(nextRuntime);
    if (sessionToPersist) {
      await persistFocusSession(sessionToPersist);
    }
  }

  function startBreak() {
    const kind = runtimeRef.current.breakKind ?? "short_break";
    setRuntime((current) => ({
      ...current,
      phase: "breaking",
      plannedSeconds: breakSeconds(kind, settings),
      elapsedSeconds: 0,
      startedAt: new Date().toISOString(),
      pausedAt: null,
      breakKind: kind,
    }));
  }

  function skipBreakOrExit() {
    const current = runtimeRef.current;
    const idle = createIdleRuntimeState(settings);
    setRuntime({
      ...idle,
      taskId: current.taskId,
      completedPomodoros: current.completedPomodoros,
    });
  }

  return {
    runtime,
    nowMs,
    setRuntime,
    persistFocusSession,
    startTimer,
    pauseTimer,
    resumeTimer,
    stopTimer,
    selectFocusTask,
    startBreak,
    skipBreakOrExit,
  };
}
