import clsx from "clsx";
import { Target } from "lucide-react";
import { useMemo, useState } from "react";
import { FocusTaskPicker } from "./FocusTaskPicker";
import { FocusTimer } from "./FocusTimer";
import {
  formatFocusDayLabel,
  formatFocusDuration,
  formatFocusTimeRange,
  groupFocusSessionsByDay,
  resolveFocusRecordTitle,
  resolveFocusTargetTitle,
} from "./lib/focusSession";
import { useFocusRuntime } from "./useFocusRuntime";
import type { FocusSession, FocusSettings, Task } from "./types";

export function TrayFocusPanel({
  workspaceId,
  userId,
  online,
  tasks,
  settings,
  sessions,
  onCreateSession,
  onNotice,
}: {
  workspaceId: string;
  userId: string;
  online: boolean;
  tasks: Task[];
  settings: FocusSettings;
  sessions: FocusSession[];
  onCreateSession: (input: Omit<FocusSession, "id" | "created_at">) => Promise<FocusSession>;
  onNotice: (message: string) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const {
    runtime,
    nowMs,
    setRuntime,
    startTimer,
    pauseTimer,
    resumeTimer,
    stopTimer,
    selectFocusTask,
    startBreak,
    skipBreakOrExit,
  } = useFocusRuntime({
    userId,
    workspaceId,
    online,
    settings,
    onCreateSession,
    onNotice: (message) => {
      setNotice(message);
      onNotice(message);
    },
  });

  const selectedTitle = useMemo(
    () => resolveFocusTargetTitle(tasks, runtime.taskId, runtime.subtaskId),
    [runtime.subtaskId, runtime.taskId, tasks],
  );
  const groups = useMemo(() => groupFocusSessionsByDay(sessions), [sessions]);
  const canSwitchMode = runtime.phase === "idle" || runtime.phase === "harvested";

  function selectMode(mode: "pomodoro" | "stopwatch") {
    if (!canSwitchMode) return;
    if (mode === "pomodoro") {
      setRuntime((current) => ({
        ...current,
        mode,
        phase: "idle",
        plannedSeconds: settings.pomodoro_minutes * 60,
        elapsedSeconds: 0,
        startedAt: null,
        pausedAt: null,
      }));
      return;
    }
    setRuntime((current) => ({
      ...current,
      mode,
      phase: "idle",
      plannedSeconds: 0,
      elapsedSeconds: 0,
      startedAt: null,
      pausedAt: null,
      breakKind: null,
    }));
  }

  return (
    <section className="tray-panel tray-focus" aria-label="番茄">
      <div className="tray-focus-mode-toggle focus-mode-toggle" role="tablist" aria-label="计时模式">
        <button
          type="button"
          role="tab"
          aria-selected={runtime.mode === "pomodoro"}
          className={clsx(runtime.mode === "pomodoro" && "active")}
          disabled={!canSwitchMode}
          onClick={() => selectMode("pomodoro")}
        >
          番茄计时
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={runtime.mode === "stopwatch"}
          className={clsx(runtime.mode === "stopwatch" && "active")}
          disabled={!canSwitchMode}
          onClick={() => selectMode("stopwatch")}
        >
          正计时
        </button>
      </div>

      <div className="tray-focus-scroll">
        <div className="tray-focus-hero">
          <FocusTimer
            variant="tray"
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
              onSelect={(taskId, subtaskId) => void selectFocusTask(taskId, subtaskId ?? null)}
            />
          )}
          {notice && (
            <div className="tray-focus-notice" role="status">
              <span>{notice}</span>
              <button type="button" aria-label="关闭提示" onClick={() => setNotice(null)}>×</button>
            </div>
          )}
        </div>

        <section className="tray-focus-records" aria-labelledby="tray-focus-records-title">
          <h2 id="tray-focus-records-title">专注记录</h2>
          {groups.length === 0 ? (
            <p className="tray-focus-records-empty">还没有专注记录</p>
          ) : (
            <div className="tray-focus-records-list">
              {groups.map((group) => (
                <div key={group.dateKey} className="tray-focus-records-group">
                  <div className="tray-focus-records-day">{formatFocusDayLabel(group.dateKey)}</div>
                  {group.sessions.map((session) => {
                    return (
                      <div key={session.id} className="tray-focus-record">
                        <Target aria-hidden="true" />
                        <div className="tray-focus-record-body">
                          <div className="tray-focus-record-time">
                            {formatFocusTimeRange(session.started_at, session.ended_at)}
                          </div>
                          <div className="tray-focus-record-title">
                            {resolveFocusRecordTitle(tasks, session.task_id, session.subtask_id)}
                          </div>
                          {session.notes && (
                            <div className="tray-focus-record-notes">{session.notes}</div>
                          )}
                        </div>
                        <div className="tray-focus-record-duration">
                          {formatFocusDuration(session.elapsed_seconds)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
