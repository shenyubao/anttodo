import clsx from "clsx";
import { Ellipsis, PanelLeft, Plus, Target } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { FocusDayTimeline } from "./FocusDayTimeline";
import { FocusNotes } from "./FocusNotes";
import { FocusSettingsDialog } from "./FocusSettingsDialog";
import { FocusTaskPicker } from "./FocusTaskPicker";
import { FocusTimer } from "./FocusTimer";
import { useShortcutHandler } from "./ShortcutProvider";
import {
  breakSeconds,
  applyFocusSettingsToRuntime,
  clearFocusRuntimeState,
  createIdleRuntimeState,
  displayedSeconds,
  formatFocusClock,
  formatFocusDayLabel,
  formatFocusDuration,
  formatFocusTimeRange,
  groupFocusSessionsByDay,
  loadFocusRuntimeState,
  nextBreakKind,
  playFocusChime,
  remainingSeconds,
  saveFocusRuntimeState,
  summarizeFocusSessions,
  switchFocusTask,
  totalElapsedSeconds,
  listFocusableTasks,
  resolveFocusRecordTitle,
  resolveFocusTargetTitle,
  type FocusRuntimeState,
} from "./lib/focusSession";
import type { FocusSession, FocusSettings, Task } from "./types";
import type { DesktopFocusDeepLinkEnvelope } from "./lib/desktopDeepLink";

export function FocusWorkspace({
  workspaceId,
  userId,
  online,
  tasks,
  settings,
  sessions,
  onSaveSettings,
  onCreateSession,
  onNotice,
  onMenu,
  deepLinkCommand,
  onDeepLinkHandled,
}: {
  workspaceId: string;
  userId: string;
  online: boolean;
  tasks: Task[];
  settings: FocusSettings;
  sessions: FocusSession[];
  onSaveSettings: (settings: FocusSettings) => Promise<void>;
  onCreateSession: (input: Omit<FocusSession, "id" | "created_at">) => Promise<FocusSession>;
  onNotice: (message: string) => void;
  onMenu: () => void;
  deepLinkCommand: DesktopFocusDeepLinkEnvelope | null;
  onDeepLinkHandled: (id: number) => void;
}) {
  const [runtime, setRuntime] = useState<FocusRuntimeState>(() => {
    const restored = loadFocusRuntimeState(userId, workspaceId);
    return restored ?? createIdleRuntimeState(settings);
  });
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualMinutes, setManualMinutes] = useState(25);
  const [manualNotes, setManualNotes] = useState("");
  const [manualTaskId, setManualTaskId] = useState<string | null>(null);
  const [manualSubtaskId, setManualSubtaskId] = useState<string | null>(null);
  const titleBaseRef = useRef(typeof document === "undefined" ? "AntTodo" : document.title);
  const completionHandledRef = useRef(false);
  const runtimeRef = useRef(runtime);
  const skipRuntimeSaveRef = useRef(false);
  runtimeRef.current = runtime;

  useShortcutHandler("focus.startPomodoro", () => {
    if (!online || runtime.mode !== "pomodoro" || runtime.phase !== "idle") return false;
    startTimer();
  });

  useShortcutHandler("focus.pausePomodoro", () => {
    if (
      runtime.mode !== "pomodoro"
      || runtime.phase !== "focusing"
      || runtime.pausedAt
      || !runtime.startedAt
    ) return false;
    pauseTimer();
  });

  useEffect(() => {
    const restored = loadFocusRuntimeState(userId, workspaceId);
    setRuntime(restored ?? createIdleRuntimeState(settings));
  }, [userId, workspaceId]); // eslint-disable-line react-hooks/exhaustive-deps -- reset only on workspace/user change

  useEffect(() => {
    setRuntime((current) => applyFocusSettingsToRuntime(current, settings));
  }, [settings]);

  useEffect(() => {
    if (skipRuntimeSaveRef.current) {
      skipRuntimeSaveRef.current = false;
      return;
    }
    saveFocusRuntimeState(userId, workspaceId, runtime);
  }, [runtime, userId, workspaceId]);

  useEffect(() => {
    const key = `anttodo:focus-runtime:${userId}:${workspaceId}`;
    const onStorage = (event: StorageEvent) => {
      if (event.key !== key) return;
      skipRuntimeSaveRef.current = true;
      setRuntime(loadFocusRuntimeState(userId, workspaceId) ?? createIdleRuntimeState(settings));
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

  function isRunningState(state: FocusRuntimeState) {
    return state.phase === "focusing"
      || state.phase === "breaking"
      || state.phase === "stopwatch";
  }

  function startTimerForMode(
    mode: "pomodoro" | "stopwatch",
    taskId?: string,
  ) {
    if (!online) {
      onNotice("离线时无法开始专注");
      return false;
    }
    const current = runtimeRef.current;
    if (isRunningState(current)) {
      if (current.mode !== mode || !current.pausedAt) {
        onNotice("当前已有计时正在运行，请先暂停或结束。");
        return false;
      }
      if (taskId && taskId !== current.taskId) {
        onNotice("暂停中的计时不能同时切换任务。");
        return false;
      }
      setRuntime({ ...current, startedAt: new Date().toISOString(), pausedAt: null });
      return true;
    }
    if (current.phase !== "idle") {
      onNotice("当前计时状态不支持直接启动。");
      return false;
    }
    const nextTaskId = taskId ?? current.taskId;
    const nextSubtaskId = taskId != null && taskId !== current.taskId
      ? null
      : current.subtaskId;
    if (mode === "stopwatch") {
      setRuntime({
        ...current,
        mode,
        phase: "stopwatch",
        taskId: nextTaskId,
        subtaskId: nextSubtaskId,
        plannedSeconds: 0,
        elapsedSeconds: 0,
        startedAt: new Date().toISOString(),
        pausedAt: null,
        breakKind: null,
      });
    } else {
      setRuntime({
        ...current,
        mode,
        phase: "focusing",
        taskId: nextTaskId,
        subtaskId: nextSubtaskId,
        plannedSeconds: settings.pomodoro_minutes * 60,
        elapsedSeconds: 0,
        startedAt: new Date().toISOString(),
        pausedAt: null,
        breakKind: null,
      });
    }
    return true;
  }

  function pauseTimerForMode(mode: "pomodoro" | "stopwatch") {
    const current = runtimeRef.current;
    if (
      current.mode !== mode
      || !isRunningState(current)
      || current.pausedAt
      || !current.startedAt
    ) {
      onNotice("当前计时状态不支持暂停。");
      return false;
    }
    pauseTimer();
    return true;
  }

  async function stopTimerForMode(mode: "pomodoro" | "stopwatch") {
    const current = runtimeRef.current;
    if (current.mode !== mode || !isRunningState(current)) {
      onNotice("当前计时状态不支持结束。");
      return false;
    }
    await stopTimer();
    return true;
  }

  useEffect(() => {
    if (!deepLinkCommand) return;
    let cancelled = false;
    void (async () => {
      const { id, command } = deepLinkCommand;
      let handled = false;
      try {
        const linkedTask = command.taskId
          ? tasks.find((task) => task.id === command.taskId)
          : null;
        if (
          command.taskId
          && (!linkedTask || linkedTask.deleted_at || linkedTask.kind === "note")
        ) {
          onNotice("DeepLink 指定的任务不存在或无权访问。");
        } else if (command.action === "switch") {
          await selectFocusTask(command.taskId ?? null);
          handled = true;
        } else if (command.action === "start" && command.mode) {
          handled = startTimerForMode(command.mode, command.taskId);
        } else if (command.action === "pause" && command.mode) {
          handled = pauseTimerForMode(command.mode);
        } else if (command.action === "stop" && command.mode) {
          handled = await stopTimerForMode(command.mode);
        } else {
          onNotice("DeepLink 缺少有效的计时模式或动作。");
        }
      } catch (error) {
        onNotice(error instanceof Error ? error.message : "DeepLink 执行失败。");
      } finally {
        if (!cancelled) onDeepLinkHandled(id);
      }
      return handled;
    })();
    return () => {
      cancelled = true;
    };
  }, [deepLinkCommand, onDeepLinkHandled, onNotice, online, settings.pomodoro_minutes, tasks]);

  useEffect(() => {
    if (!settings.show_tab_title) {
      document.title = titleBaseRef.current;
      return;
    }
    const active = runtime.phase === "focusing"
      || runtime.phase === "breaking"
      || runtime.phase === "stopwatch";
    if (!active) {
      document.title = titleBaseRef.current;
      return;
    }
    const label = runtime.phase === "breaking" ? "休息" : "专注";
    document.title = `${formatFocusClock(displayedSeconds(runtime, nowMs))} ${label} · AntTodo`;
    return () => {
      document.title = titleBaseRef.current;
    };
  }, [nowMs, runtime, settings.show_tab_title]);

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

  const selectedTitle = useMemo(
    () => resolveFocusTargetTitle(tasks, runtime.taskId, runtime.subtaskId),
    [runtime.subtaskId, runtime.taskId, tasks],
  );
  const stats = useMemo(() => summarizeFocusSessions(sessions), [sessions]);
  const groups = useMemo(() => groupFocusSessionsByDay(sessions), [sessions]);
  const showActiveSide = runtime.phase === "focusing"
    || runtime.phase === "harvested"
    || runtime.phase === "breaking"
    || runtime.phase === "stopwatch";

  async function persistFocusSession(partial: {
    mode: FocusSession["mode"];
    kind: FocusSession["kind"];
    plannedSeconds: number;
    elapsedSeconds: number;
    startedAt: string;
    endedAt: string;
    notes: string;
    taskId: string | null;
    subtaskId: string | null;
  }) {
    if (!online) {
      onNotice("离线时无法保存专注记录");
      return null;
    }
    try {
      return await onCreateSession({
        user_id: userId,
        workspace_id: workspaceId,
        task_id: partial.taskId,
        subtask_id: partial.subtaskId,
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
    playFocusChime(settings.sound_enabled);

    if (current.phase === "focusing") {
      const endedAt = new Date().toISOString();
      const startedAt = current.startedAt ?? endedAt;
      const elapsed = current.plannedSeconds;
      await persistFocusSession({
        mode: "pomodoro",
        kind: "focus",
        plannedSeconds: current.plannedSeconds,
        elapsedSeconds: elapsed,
        startedAt,
        endedAt,
        notes: current.notes,
        taskId: current.taskId,
        subtaskId: current.subtaskId,
      });
      const completedPomodoros = current.completedPomodoros + 1;
      const breakKind = nextBreakKind(completedPomodoros, settings.long_break_interval);
      const planned = breakSeconds(breakKind, settings);
      if (settings.auto_start_break) {
        setRuntime({
          ...current,
          phase: "breaking",
          mode: "pomodoro",
          plannedSeconds: planned,
          elapsedSeconds: 0,
          startedAt: new Date().toISOString(),
          pausedAt: null,
          completedPomodoros,
          breakKind,
        });
      } else {
        setRuntime({
          ...current,
          phase: "harvested",
          mode: "pomodoro",
          plannedSeconds: planned,
          elapsedSeconds: 0,
          startedAt: null,
          pausedAt: null,
          completedPomodoros,
          breakKind,
        });
      }
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
        subtaskId: current.subtaskId,
      });
      const idle = createIdleRuntimeState(settings);
      if (settings.auto_start_pomodoro) {
        setRuntime({
          ...idle,
          phase: "focusing",
          mode: "pomodoro",
          taskId: current.taskId,
          subtaskId: current.subtaskId,
          notes: "",
          plannedSeconds: settings.pomodoro_minutes * 60,
          startedAt: new Date().toISOString(),
          completedPomodoros: current.completedPomodoros,
        });
      } else {
        setRuntime({
          ...idle,
          taskId: current.taskId,
          subtaskId: current.subtaskId,
          completedPomodoros: current.completedPomodoros,
        });
      }
    }
  }

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
          subtaskId: current.subtaskId,
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
        subtaskId: current.subtaskId,
      });
    }

    const idle = createIdleRuntimeState(settings);
    setRuntime({
      ...idle,
      mode: current.mode,
      taskId: current.taskId,
      subtaskId: current.subtaskId,
      completedPomodoros: current.completedPomodoros,
    });
    clearFocusRuntimeState(userId, workspaceId);
  }

  async function selectFocusTask(taskId: string | null, subtaskId: string | null = null) {
    const current = runtimeRef.current;
    const { sessionToPersist, nextRuntime } = switchFocusTask(current, { taskId, subtaskId });
    if (nextRuntime === current) return;
    setRuntime(nextRuntime);
    if (sessionToPersist) {
      await persistFocusSession(sessionToPersist);
    }
  }

  function startBreak() {
    const kind = runtime.breakKind ?? "short_break";
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
    const idle = createIdleRuntimeState(settings);
    setRuntime({
      ...idle,
      taskId: runtime.taskId,
      subtaskId: runtime.subtaskId,
      completedPomodoros: runtime.completedPomodoros,
    });
  }

  async function submitManual() {
    if (!online) {
      onNotice("离线时无法补记");
      return;
    }
    const elapsed = Math.max(60, manualMinutes * 60);
    const endedAt = new Date();
    const startedAt = new Date(endedAt.getTime() - elapsed * 1000);
    await persistFocusSession({
      mode: "pomodoro",
      kind: "focus",
      plannedSeconds: elapsed,
      elapsedSeconds: elapsed,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      notes: manualNotes,
      taskId: manualTaskId,
      subtaskId: manualSubtaskId,
    });
    setManualOpen(false);
    setManualNotes("");
    setManualMinutes(25);
    setManualTaskId(null);
    setManualSubtaskId(null);
  }

  return (
    <div className="focus-workspace">
      <div className="focus-layout">
        <div className="focus-main-column">
          <header className="focus-toolbar">
            <div className="focus-toolbar-title">
              <button
                type="button"
                className="calendar-sidebar-toggle"
                onClick={onMenu}
                aria-label="打开导航"
              >
                <PanelLeft />
              </button>
              <h1>番茄专注</h1>
            </div>
            <div className="focus-mode-toggle" role="tablist" aria-label="计时模式">
              <button
                type="button"
                role="tab"
                aria-selected={runtime.mode === "pomodoro"}
                className={clsx(runtime.mode === "pomodoro" && "active")}
                disabled={runtime.phase !== "idle" && runtime.phase !== "harvested"}
                onClick={() => setRuntime((current) => ({
                  ...current,
                  mode: "pomodoro",
                  plannedSeconds: settings.pomodoro_minutes * 60,
                  elapsedSeconds: 0,
                }))}
              >
                番茄计时
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={runtime.mode === "stopwatch"}
                className={clsx(runtime.mode === "stopwatch" && "active")}
                disabled={runtime.phase !== "idle" && runtime.phase !== "harvested"}
                onClick={() => setRuntime((current) => ({
                  ...current,
                  mode: "stopwatch",
                  phase: "idle",
                  plannedSeconds: 0,
                  elapsedSeconds: 0,
                }))}
              >
                正计时
              </button>
            </div>
            <div className="focus-toolbar-actions">
              <button
                type="button"
                className="icon-button"
                aria-label="补记专注"
                title="补记专注"
                disabled={!online}
                onClick={() => setManualOpen((open) => !open)}
              >
                <Plus />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label="专注设置"
                title="设置"
                onClick={() => setSettingsOpen(true)}
              >
                <Ellipsis />
              </button>
            </div>
          </header>

          <div className="focus-main">
            <FocusTimer
              state={runtime}
              nowMs={nowMs}
              taskTitle={selectedTitle}
              online={online}
              onOpenTaskPicker={() => setPickerOpen(true)}
              onStart={startTimer}
              onPause={pauseTimer}
              onResume={resumeTimer}
              onStop={() => void stopTimer()}
              onStartBreak={startBreak}
              onSkipBreak={skipBreakOrExit}
              onExitHarvest={skipBreakOrExit}
            />
            {pickerOpen && (
              <FocusTaskPicker
                open={pickerOpen}
                tasks={tasks}
                sessions={sessions}
                selectedTaskId={runtime.taskId}
                selectedSubtaskId={runtime.subtaskId}
                onOpenChange={setPickerOpen}
                onSelect={(taskId, subtaskId) => void selectFocusTask(taskId, subtaskId)}
              />
            )}
          </div>
        </div>

        <aside className="focus-side">
          {showActiveSide ? (
            <>
              <div className="focus-side-title">
                <span>
                  {runtime.phase === "breaking"
                    ? (runtime.breakKind === "long_break" ? "长休息" : "短休息")
                    : runtime.mode === "stopwatch"
                    ? "正计时"
                    : "番茄计时"}
                </span>
              </div>
              {selectedTitle && (
                <div className="focus-side-task">
                  <Target />
                  <span>{selectedTitle}</span>
                </div>
              )}
              <FocusDayTimeline
                sessions={sessions}
                tasks={tasks}
                runtime={runtime}
                nowMs={nowMs}
              />
              <FocusNotes
                value={runtime.notes}
                onChange={(notes) => setRuntime((current) => ({ ...current, notes }))}
              />
            </>
          ) : (
            <div className="focus-side-scroll">
              <section className="focus-overview">
                <h2>概览</h2>
                <div className="focus-overview-grid">
                  <div className="focus-overview-card">
                    <span>今日番茄</span>
                    <strong>{stats.todayPomodoros}</strong>
                  </div>
                  <div className="focus-overview-card">
                    <span>今日专注时长</span>
                    <strong>{formatFocusDuration(stats.todayFocusSeconds)}</strong>
                  </div>
                  <div className="focus-overview-card">
                    <span>总番茄</span>
                    <strong>{stats.totalPomodoros}</strong>
                  </div>
                  <div className="focus-overview-card">
                    <span>总专注时长</span>
                    <strong>{formatFocusDuration(stats.totalFocusSeconds)}</strong>
                  </div>
                </div>
              </section>
              <section className="focus-records">
                <div className="focus-records-header">
                  <h2>专注记录</h2>
                </div>
                <div className="focus-records-list">
                  {groups.length === 0 && (
                    <p className="focus-records-empty">还没有专注记录</p>
                  )}
                  {groups.map((group) => (
                    <div key={group.dateKey} className="focus-records-group">
                      <div className="focus-records-day">{formatFocusDayLabel(group.dateKey)}</div>
                      {group.sessions.map((session) => {
                        return (
                          <div key={session.id} className="focus-records-item">
                            <Target />
                            <div className="focus-records-body">
                              <div className="focus-records-time">
                                {formatFocusTimeRange(session.started_at, session.ended_at)}
                              </div>
                              <div className="focus-records-title">
                                {resolveFocusRecordTitle(tasks, session.task_id, session.subtask_id)}
                              </div>
                              {session.notes && (
                                <div className="focus-records-notes">{session.notes}</div>
                              )}
                            </div>
                            <div className="focus-records-duration">
                              {formatFocusDuration(session.elapsed_seconds)}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}
        </aside>
      </div>

      {manualOpen && (
        <div className="focus-manual-panel" role="dialog" aria-label="补记专注">
          <h3>补记专注</h3>
          <label>
            <span>时长（分钟）</span>
            <input
              type="number"
              min={1}
              max={180}
              value={manualMinutes}
              onChange={(event) => setManualMinutes(Number(event.target.value) || 1)}
            />
          </label>
          <label>
            <span>关联任务</span>
            <select
              value={manualSubtaskId && manualTaskId
                ? `${manualTaskId}:${manualSubtaskId}`
                : (manualTaskId ?? "")}
              onChange={(event) => {
                const value = event.target.value;
                if (!value) {
                  setManualTaskId(null);
                  setManualSubtaskId(null);
                  return;
                }
                const separator = value.indexOf(":");
                if (separator === -1) {
                  setManualTaskId(value);
                  setManualSubtaskId(null);
                  return;
                }
                setManualTaskId(value.slice(0, separator));
                setManualSubtaskId(value.slice(separator + 1));
              }}
            >
              <option value="">不关联任务</option>
              {listFocusableTasks(tasks).map((task) => (
                <optgroup key={task.id} label={task.title}>
                  <option value={task.id}>{task.title}</option>
                  {task.subtasks
                    .slice()
                    .sort((a, b) => a.position - b.position)
                    .map((subtask) => (
                      <option key={subtask.id} value={`${task.id}:${subtask.id}`}>
                        {subtask.title}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label>
            <span>笔记</span>
            <textarea
              value={manualNotes}
              placeholder="可选"
              onChange={(event) => setManualNotes(event.target.value)}
            />
          </label>
          <div className="focus-manual-actions">
            <button type="button" className="button secondary" onClick={() => setManualOpen(false)}>
              取消
            </button>
            <button type="button" className="button primary" onClick={() => void submitManual()}>
              保存
            </button>
          </div>
        </div>
      )}

      <FocusSettingsDialog
        open={settingsOpen}
        settings={settings}
        online={online}
        onOpenChange={setSettingsOpen}
        onSave={onSaveSettings}
      />
    </div>
  );
}
