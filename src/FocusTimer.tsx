import clsx from "clsx";
import { ChevronRight } from "lucide-react";
import {
  displayedSeconds,
  formatFocusClock,
  progressRatio,
  type FocusRuntimeState,
} from "./lib/focusSession";

export function FocusTimer({
  state,
  nowMs,
  taskTitle,
  online,
  onOpenTaskPicker,
  onStart,
  onPause,
  onResume,
  onStop,
  onStartBreak,
  onSkipBreak,
  onExitHarvest,
}: {
  state: FocusRuntimeState;
  nowMs: number;
  taskTitle: string | null;
  online: boolean;
  onOpenTaskPicker: () => void;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onStartBreak: () => void;
  onSkipBreak: () => void;
  onExitHarvest: () => void;
}) {
  const seconds = displayedSeconds(state, nowMs);
  const ratio = progressRatio(state, nowMs);
  const paused = Boolean(state.pausedAt);
  const active = state.phase === "focusing" || state.phase === "breaking" || state.phase === "stopwatch";
  const harvested = state.phase === "harvested";
  const ringStyle = {
    background: `conic-gradient(var(--blue) ${ratio * 360}deg, rgb(25 25 25 / 8%) 0deg)`,
  };

  return (
    <div className="focus-timer" id="pomodoro-timer">
      <button
        type="button"
        className="focus-task-link"
        onClick={onOpenTaskPicker}
      >
        <span>{taskTitle ?? "任务"}</span>
        <ChevronRight />
      </button>

      <div className={clsx("focus-ring", harvested && "harvested")} style={ringStyle}>
        <div className="focus-ring-inner">
          <div className="focus-clock">{formatFocusClock(seconds)}</div>
          {state.phase === "breaking" && (
            <div className="focus-clock-caption">休息中</div>
          )}
        </div>
      </div>

      {harvested ? (
        <div className="focus-harvest">
          <h2>你刚收获了一个番茄</h2>
          <p>
            休息 {Math.max(1, Math.round(state.plannedSeconds / 60))} 分钟吧
          </p>
          <div className="focus-harvest-actions">
            <button
              type="button"
              className="button primary focus-action-button"
              disabled={!online}
              onClick={onStartBreak}
            >
              开始休息
            </button>
            <button
              type="button"
              className="button secondary focus-action-button"
              onClick={onSkipBreak}
            >
              跳过休息
            </button>
            <button
              type="button"
              className="button secondary focus-action-button"
              onClick={onExitHarvest}
            >
              退出
            </button>
          </div>
        </div>
      ) : (
        <div className="focus-timer-actions">
          {!active && (
            <button
              type="button"
              className="button primary focus-start-button"
              disabled={!online}
              onClick={onStart}
            >
              开始
            </button>
          )}
          {active && !paused && (
            <>
              <button
                type="button"
                className="button primary focus-start-button"
                onClick={onPause}
              >
                暂停
              </button>
              <button
                type="button"
                className="button secondary focus-action-button"
                onClick={onStop}
              >
                结束
              </button>
            </>
          )}
          {active && paused && (
            <>
              <button
                type="button"
                className="button primary focus-start-button"
                disabled={!online}
                onClick={onResume}
              >
                继续
              </button>
              <button
                type="button"
                className="button secondary focus-action-button"
                onClick={onStop}
              >
                结束
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
