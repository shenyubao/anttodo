import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildFocusDayTimeline,
  focusTimelineHeightPx,
  formatFocusTimeRange,
  type FocusRuntimeState,
} from "./lib/focusSession";
import type { FocusSession, Task } from "./types";

export function FocusDayTimeline({
  sessions,
  tasks,
  runtime,
  nowMs,
}: {
  sessions: FocusSession[];
  tasks: Task[];
  runtime: FocusRuntimeState;
  nowMs: number;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const autoScrolledRangeRef = useRef<number | null>(null);
  const [viewportHeight, setViewportHeight] = useState(0);

  const taskTitleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const task of tasks) map.set(task.id, task.title);
    return map;
  }, [tasks]);

  const liveSession = useMemo(() => {
    const isWork = runtime.phase === "focusing" || runtime.phase === "stopwatch";
    const isBreak = runtime.phase === "breaking";
    if (!isWork && !isBreak) return null;
    let elapsed = runtime.elapsedSeconds;
    if (runtime.startedAt && !runtime.pausedAt) {
      elapsed += Math.max(
        0,
        Math.floor((nowMs - new Date(runtime.startedAt).getTime()) / 1000),
      );
    }
    if (elapsed < 1 && !runtime.startedAt) return null;
    const safeElapsed = Math.max(elapsed, 30);
    return {
      id: isBreak ? "live-break" : "live-focus",
      startedAt: new Date(nowMs - safeElapsed * 1000).toISOString(),
      elapsedSeconds: safeElapsed,
      segment: isBreak ? "break" as const : "work" as const,
      taskId: runtime.taskId,
    };
  }, [nowMs, runtime]);

  const layout = useMemo(
    () => buildFocusDayTimeline({ sessions, nowMs, liveSession }),
    [liveSession, nowMs, sessions],
  );

  useEffect(() => {
    const root = scrollerRef.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    const sync = () => setViewportHeight(root.clientHeight);
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  // Leave room so first/last hour labels aren't clipped.
  const height = focusTimelineHeightPx(layout, Math.max(0, viewportHeight - 16));

  // Center on "now" once per day-range — not on every nowMs tick, or scrolling fights the timer.
  useEffect(() => {
    const root = scrollerRef.current;
    if (!root || layout.nowTop == null || height <= 0) return;
    if (autoScrolledRangeRef.current === layout.rangeStartMs) return;
    const target = (layout.nowTop / 100) * height - root.clientHeight / 2;
    root.scrollTop = Math.max(0, target);
    autoScrolledRangeRef.current = layout.rangeStartMs;
  }, [height, layout.nowTop, layout.rangeStartMs]);

  return (
    <section className="focus-day-timeline" aria-label="今日专注时间轴">
      <div className="focus-day-timeline-scroll" ref={scrollerRef}>
        <div className="focus-day-timeline-canvas" style={{ height }}>
          {layout.hourMarks.map((mark) => {
            const top = ((mark - layout.rangeStartMs)
              / (layout.rangeEndMs - layout.rangeStartMs)) * 100;
            const hour = new Date(mark).getHours();
            return (
              <div
                key={mark}
                className="focus-day-timeline-hour"
                style={{ top: `${top}%` }}
              >
                <span>{hour}</span>
                <i />
              </div>
            );
          })}

          {layout.blocks.map((block) => {
            const timeLabel = formatFocusTimeRange(
              new Date(block.startMs).toISOString(),
              new Date(block.endMs).toISOString(),
            );
            const taskTitle = block.taskId
              ? taskTitleById.get(block.taskId) ?? null
              : null;
            const segmentLabel = block.segment === "break" ? "休息" : "工作";
            const primaryLabel = block.segment === "break"
              ? `${timeLabel} · ${segmentLabel}`
              : taskTitle
              ? `${timeLabel} · ${taskTitle}`
              : timeLabel;
            const titleParts = [timeLabel];
            if (taskTitle) titleParts.push(taskTitle);
            titleParts.push(block.live ? `${segmentLabel}中` : segmentLabel);
            return (
              <div
                key={block.id}
                className={[
                  "focus-day-timeline-block",
                  block.segment,
                  block.live ? "live" : "",
                ].filter(Boolean).join(" ")}
                style={{ top: `${block.top}%`, height: `${block.height}%` }}
                title={titleParts.join(" · ")}
              >
                <span className="focus-day-timeline-block-label">
                  {primaryLabel}
                </span>
              </div>
            );
          })}

          {layout.nowTop != null && (
            <div
              className="focus-day-timeline-now"
              style={{ top: `${layout.nowTop}%` }}
            >
              <span />
              <i />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
