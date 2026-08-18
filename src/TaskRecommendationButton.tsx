import { Lightbulb } from "lucide-react";
import { createPortal } from "react-dom";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { DateTimePreferences, Task } from "./types";
import { recommendedTasks, recommendationDuePatch } from "./lib/taskRecommendations";
import { systemTimeZone } from "./lib/dateTimePreferences";

export function TaskRecommendationButton({
  tasks,
  currentUserId,
  online,
  now,
  weekStartsOn,
  onUpdateTask,
}: {
  tasks: Task[];
  currentUserId: string;
  online: boolean;
  now: Date;
  weekStartsOn: DateTimePreferences["weekStartsOn"];
  onUpdateTask: (
    taskId: string,
    patch: Pick<Task, "due_at" | "due_start_at" | "due_is_all_day" | "due_timezone">,
  ) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [adoptingTaskId, setAdoptingTaskId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [position, setPosition] = useState<CSSProperties>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const candidates = useMemo(
    () => recommendedTasks(tasks, currentUserId),
    [currentUserId, tasks],
  );
  const busy = adoptingTaskId !== null;

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !panelRef.current) return;

    const positionPanel = () => {
      const trigger = triggerRef.current!.getBoundingClientRect();
      const inset = 12;
      const gap = 8;
      const width = Math.min(410, window.innerWidth - inset * 2);
      const maxHeight = Math.min(574, window.innerHeight - inset * 2);
      const height = Math.min(
        Math.max(panelRef.current!.scrollHeight, 120),
        maxHeight,
      );
      const left = Math.min(
        Math.max(trigger.right - width, inset),
        Math.max(inset, window.innerWidth - width - inset),
      );
      let top = trigger.bottom + gap;
      if (top + height > window.innerHeight - inset) {
        top = Math.max(inset, trigger.top - height - gap);
      }
      if (top + height > window.innerHeight - inset) {
        top = Math.max(inset, window.innerHeight - height - inset);
      }
      setPosition({ width, height, maxHeight, left, top });
    };

    positionPanel();
    window.addEventListener("resize", positionPanel);
    window.addEventListener("scroll", positionPanel, true);
    return () => {
      window.removeEventListener("resize", positionPanel);
      window.removeEventListener("scroll", positionPanel, true);
    };
  }, [candidates.length, error, open]);

  async function adopt(task: Task) {
    if (!online || busy) return;
    setAdoptingTaskId(task.id);
    setError("");
    try {
      await onUpdateTask(
        task.id,
        recommendationDuePatch(now, weekStartsOn, systemTimeZone()),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "采纳失败，请稍后重试");
    } finally {
      setAdoptingTaskId(null);
    }
  }

  return (
    <div className="task-recommendation-anchor" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="week-recommend-button"
        aria-label="推荐"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={!online}
        onClick={() => {
          setError("");
          setOpen((value) => !value);
        }}
      >
        <Lightbulb />
        <span>推荐</span>
      </button>
      {open && createPortal(
        <div
          ref={panelRef}
          className="ai-childTask-suggest-panel task-recommendation-panel"
          role="dialog"
          aria-label="推荐任务"
          style={position}
        >
          <div className="ai-childTask-suggest-header">
            <strong>推荐任务</strong>
          </div>
          <div className="ai-childTask-suggest-body">
            {error && <p className="ai-childTask-suggest-error">{error}</p>}
            {!error && candidates.length === 0 && (
              <p className="ai-childTask-suggest-status">暂无推荐任务</p>
            )}
            {candidates.length > 0 && (
              <ul className="ai-childTask-suggest-list">
                {candidates.map((task) => (
                  <li key={task.id} className="ai-childTask-suggest-row">
                    <div className="ai-childTask-suggest-main">
                      <span className="ai-childTask-suggest-title">{task.title}</span>
                    </div>
                    <button
                      type="button"
                      className="ai-childTask-suggest-add"
                      disabled={!online || busy}
                      aria-label={`采纳任务：${task.title}`}
                      onClick={() => void adopt(task)}
                    >
                      {adoptingTaskId === task.id ? "处理中…" : "采纳"}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
