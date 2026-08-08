import clsx from "clsx";
import { Ellipsis, PanelLeft, Plus, Target } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { FocusDayTimeline } from "./FocusDayTimeline";
import { FocusNotes } from "./FocusNotes";
import { FocusSettingsDialog } from "./FocusSettingsDialog";
import { FocusTaskPicker } from "./FocusTaskPicker";
import { FocusTimer } from "./FocusTimer";
import {
  breakSeconds,
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
  type FocusRuntimeState,
} from "./lib/focusSession";
import type { FocusSession, FocusSettings, Task } from "./types";

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
  const titleBaseRef = useRef(typeof document === "undefined" ? "AntTodo" : document.title);
  const completionHandledRef = useRef(false);
  const runtimeRef = useRef(runtime);
  runtimeRef.current = runtime;

  useEffect(() => {
    const restored = loadFocusRuntimeState(userId, workspaceId);
    setRuntime(restored ?? createIdleRuntimeState(settings));
  }, [userId, workspaceId]); // eslint-disable-line react-hooks/exhaustive-deps -- reset only on workspace/user change

  useEffect(() => {
    saveFocusRuntimeState(userId, workspaceId, runtime);
  }, [runtime, userId, workspaceId]);

  useEffect(() => {
    const active = runtime.phase === "focusing"
      || runtime.phase === "breaking"
      || runtime.phase === "stopwatch";
    if (!active || runtime.pausedAt) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [runtime.phase, runtime.pausedAt]);

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

  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === runtime.taskId) ?? null,
    [runtime.taskId, tasks],
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
      });
      const idle = createIdleRuntimeState(settings);
      if (settings.auto_start_pomodoro) {
        setRuntime({
          ...idle,
          phase: "focusing",
          mode: "pomodoro",
          taskId: current.taskId,
          notes: "",
          plannedSeconds: settings.pomodoro_minutes * 60,
          startedAt: new Date().toISOString(),
          completedPomodoros: current.completedPomodoros,
        });
      } else {
        setRuntime({
          ...idle,
          taskId: current.taskId,
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
    const endedAt = new Date().toISOString();
    let elapsed = current.elapsedSeconds;
    if (current.startedAt && !current.pausedAt) {
      elapsed += Math.max(
        0,
        Math.floor((Date.now() - new Date(current.startedAt).getTime()) / 1000),
      );
    }

    if (current.phase === "focusing" || current.phase === "stopwatch") {
      if (elapsed >= 60) {
        await persistFocusSession({
          mode: current.phase === "stopwatch" ? "stopwatch" : "pomodoro",
          kind: "focus",
          plannedSeconds: current.phase === "stopwatch" ? elapsed : current.plannedSeconds,
          elapsedSeconds: elapsed,
          startedAt: current.startedAt
            ?? current.pausedAt
            ?? new Date(Date.now() - elapsed * 1000).toISOString(),
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
          ?? new Date(Date.now() - elapsed * 1000).toISOString(),
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
    });
    setManualOpen(false);
    setManualNotes("");
    setManualMinutes(25);
    setManualTaskId(null);
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
              taskTitle={selectedTask?.title ?? null}
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
                onOpenChange={setPickerOpen}
                onSelect={(taskId) => setRuntime((current) => ({ ...current, taskId }))}
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
              {selectedTask && (
                <div className="focus-side-task">
                  <Target />
                  <span>{selectedTask.title}</span>
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
                        const task = tasks.find((item) => item.id === session.task_id);
                        return (
                          <div key={session.id} className="focus-records-item">
                            <Target />
                            <div className="focus-records-body">
                              <div className="focus-records-time">
                                {formatFocusTimeRange(session.started_at, session.ended_at)}
                              </div>
                              <div className="focus-records-title">
                                {task?.title ?? "未关联任务"}
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
              value={manualTaskId ?? ""}
              onChange={(event) => setManualTaskId(event.target.value || null)}
            >
              <option value="">不关联任务</option>
              {tasks
                .filter((task) => !task.deleted_at && task.kind !== "note")
                .map((task) => (
                  <option key={task.id} value={task.id}>{task.title}</option>
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
