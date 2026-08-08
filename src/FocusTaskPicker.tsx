import clsx from "clsx";
import { isBefore, isToday, startOfDay } from "date-fns";
import { CalendarDays, Check, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FocusSession, Task } from "./types";

type PickerTab = "recent" | "tasks";

export function FocusTaskPicker({
  open,
  tasks,
  sessions,
  selectedTaskId,
  onOpenChange,
  onSelect,
}: {
  open: boolean;
  tasks: Task[];
  sessions: FocusSession[];
  selectedTaskId: string | null;
  onOpenChange: (open: boolean) => void;
  onSelect: (taskId: string | null) => void;
}) {
  const [tab, setTab] = useState<PickerTab>("tasks");
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        onOpenChange(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onOpenChange]);

  const focusableTasks = useMemo(
    () => tasks.filter((task) => !task.deleted_at && task.kind !== "note"),
    [tasks],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = focusableTasks.filter((task) =>
      !needle || task.title.toLowerCase().includes(needle)
    );
    if (tab === "recent") {
      const recentIds = [
        ...new Set(
          sessions
            .map((session) => session.task_id)
            .filter((id): id is string => Boolean(id)),
        ),
      ];
      const byId = new Map(list.map((task) => [task.id, task]));
      const recent = recentIds
        .map((id) => byId.get(id))
        .filter((task): task is Task => Boolean(task));
      const extras = list
        .filter((task) => !recentIds.includes(task.id))
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
        .slice(0, 12);
      return [...recent, ...extras].slice(0, 20);
    }
    return list;
  }, [focusableTasks, query, sessions, tab]);

  const overdue = filtered.filter((task) => {
    if (!task.due_at || task.status === "completed") return false;
    return isBefore(new Date(task.due_at), startOfDay(new Date()));
  });
  const today = filtered.filter((task) =>
    task.due_at && isToday(new Date(task.due_at)) && task.status !== "completed"
  );
  const rest = filtered.filter((task) => !overdue.includes(task) && !today.includes(task));

  if (!open) return null;

  return (
    <div className="focus-task-picker" ref={rootRef} role="dialog" aria-label="选择专注任务">
      <div className="focus-task-picker-tabs">
        <button
          type="button"
          className={clsx(tab === "recent" && "active")}
          onClick={() => setTab("recent")}
        >
          最近
        </button>
        <button
          type="button"
          className={clsx(tab === "tasks" && "active")}
          onClick={() => setTab("tasks")}
        >
          任务
        </button>
      </div>
      <label className="focus-task-picker-search">
        <Search />
        <input
          value={query}
          placeholder="搜索"
          aria-label="搜索任务"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div className="focus-task-picker-list">
        <button
          type="button"
          className={clsx("focus-task-picker-item", !selectedTaskId && "selected")}
          onClick={() => {
            onSelect(null);
            onOpenChange(false);
          }}
        >
          <span className={clsx("focus-task-picker-check", !selectedTaskId && "checked")}>
            {!selectedTaskId && <Check />}
          </span>
          <span className="focus-task-picker-title">不关联任务</span>
        </button>
        {tab === "tasks" ? (
          <>
            {today.length > 0 && (
              <TaskGroup
                title="今天"
                icon
                tasks={today}
                selectedTaskId={selectedTaskId}
                onSelect={(taskId) => {
                  onSelect(taskId);
                  onOpenChange(false);
                }}
              />
            )}
            {overdue.length > 0 && (
              <TaskGroup
                title="已过期"
                tasks={overdue}
                selectedTaskId={selectedTaskId}
                overdue
                onSelect={(taskId) => {
                  onSelect(taskId);
                  onOpenChange(false);
                }}
              />
            )}
            {rest.length > 0 && (
              <TaskGroup
                title={today.length || overdue.length ? "其他" : "全部任务"}
                tasks={rest}
                selectedTaskId={selectedTaskId}
                onSelect={(taskId) => {
                  onSelect(taskId);
                  onOpenChange(false);
                }}
              />
            )}
          </>
        ) : (
          <TaskGroup
            title="最近"
            tasks={filtered}
            selectedTaskId={selectedTaskId}
            onSelect={(taskId) => {
              onSelect(taskId);
              onOpenChange(false);
            }}
          />
        )}
        {filtered.length === 0 && (
          <p className="focus-task-picker-empty">没有可关联的任务</p>
        )}
      </div>
      <button
        type="button"
        className="focus-task-picker-close"
        aria-label="关闭"
        onClick={() => onOpenChange(false)}
      >
        <X />
      </button>
    </div>
  );
}

function TaskGroup({
  title,
  tasks,
  selectedTaskId,
  overdue,
  icon,
  onSelect,
}: {
  title: string;
  tasks: Task[];
  selectedTaskId: string | null;
  overdue?: boolean;
  icon?: boolean;
  onSelect: (taskId: string) => void;
}) {
  return (
    <div className="focus-task-picker-group">
      <div className="focus-task-picker-group-title">
        {icon && <CalendarDays />}
        <span>{title}</span>
      </div>
      {tasks.map((task) => {
        const selected = task.id === selectedTaskId;
        return (
          <button
            key={task.id}
            type="button"
            className={clsx("focus-task-picker-item", selected && "selected")}
            onClick={() => onSelect(task.id)}
          >
            <span className={clsx("focus-task-picker-check", selected && "checked")}>
              {selected && <Check />}
            </span>
            <span className="focus-task-picker-title">{task.title}</span>
            {task.due_at && (
              <span className={clsx("focus-task-picker-due", overdue && "overdue")}>
                {formatDue(task.due_at)}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function formatDue(dueAt: string) {
  const date = new Date(dueAt);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}
