import clsx from "clsx";
import { CalendarDays, Check, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildFocusPickerTrees,
  buildRecentFocusPickerTrees,
  partitionFocusPickerTrees,
  sameFocusTarget,
  type FocusPickerTree,
} from "./lib/focusSession";
import type { FocusSession, Task } from "./types";

type PickerTab = "recent" | "tasks";

export function FocusTaskPicker({
  open,
  tasks,
  sessions,
  selectedTaskId,
  selectedSubtaskId,
  onOpenChange,
  onSelect,
}: {
  open: boolean;
  tasks: Task[];
  sessions: FocusSession[];
  selectedTaskId: string | null;
  selectedSubtaskId?: string | null;
  onOpenChange: (open: boolean) => void;
  onSelect: (taskId: string | null, subtaskId?: string | null) => void;
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

  const trees = useMemo(() => {
    if (tab === "recent") return buildRecentFocusPickerTrees(tasks, sessions, query);
    return buildFocusPickerTrees(tasks, query);
  }, [query, sessions, tab, tasks]);

  const grouped = useMemo(() => partitionFocusPickerTrees(trees), [trees]);

  if (!open) return null;

  const select = (taskId: string | null, subtaskId: string | null = null) => {
    onSelect(taskId, subtaskId);
    onOpenChange(false);
  };

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
          onClick={() => select(null)}
        >
          <span className={clsx("focus-task-picker-check", !selectedTaskId && "checked")}>
            {!selectedTaskId && <Check />}
          </span>
          <span className="focus-task-picker-title">不关联任务</span>
        </button>
        {tab === "tasks" ? (
          <>
            {grouped.today.length > 0 && (
              <TaskGroup
                title="今天"
                icon
                trees={grouped.today}
                selectedTaskId={selectedTaskId}
                selectedSubtaskId={selectedSubtaskId}
                onSelect={select}
              />
            )}
            {grouped.overdue.length > 0 && (
              <TaskGroup
                title="已过期"
                trees={grouped.overdue}
                selectedTaskId={selectedTaskId}
                selectedSubtaskId={selectedSubtaskId}
                overdue
                onSelect={select}
              />
            )}
            {grouped.rest.length > 0 && (
              <TaskGroup
                title={grouped.today.length || grouped.overdue.length ? "其他" : "全部任务"}
                trees={grouped.rest}
                selectedTaskId={selectedTaskId}
                selectedSubtaskId={selectedSubtaskId}
                onSelect={select}
              />
            )}
          </>
        ) : (
          <TaskGroup
            title="最近"
            trees={trees}
            selectedTaskId={selectedTaskId}
            selectedSubtaskId={selectedSubtaskId}
            onSelect={select}
          />
        )}
        {trees.length === 0 && (
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
  trees,
  selectedTaskId,
  selectedSubtaskId,
  overdue,
  icon,
  onSelect,
}: {
  title: string;
  trees: FocusPickerTree[];
  selectedTaskId: string | null;
  selectedSubtaskId?: string | null;
  overdue?: boolean;
  icon?: boolean;
  onSelect: (taskId: string, subtaskId?: string | null) => void;
}) {
  return (
    <div className="focus-task-picker-group">
      <div className="focus-task-picker-group-title">
        {icon && <CalendarDays />}
        <span>{title}</span>
      </div>
      {trees.map((tree) => (
        <PickerTree
          key={tree.task.id}
          tree={tree}
          selectedTaskId={selectedTaskId}
          selectedSubtaskId={selectedSubtaskId}
          overdue={overdue}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function PickerTree({
  tree,
  selectedTaskId,
  selectedSubtaskId,
  overdue,
  onSelect,
}: {
  tree: FocusPickerTree;
  selectedTaskId: string | null;
  selectedSubtaskId?: string | null;
  overdue?: boolean;
  onSelect: (taskId: string, subtaskId?: string | null) => void;
}) {
  return (
    <div className="focus-task-picker-tree">
      <PickerRow
        title={tree.task.title}
        dueAt={tree.task.due_at}
        overdue={overdue}
        selected={sameFocusTarget(
          { taskId: selectedTaskId, subtaskId: selectedSubtaskId },
          { taskId: tree.task.id, subtaskId: null },
        )}
        onSelect={() => onSelect(tree.task.id, null)}
      />
      {tree.subtasks.map((subtask) => (
        <PickerRow
          key={subtask.id}
          title={subtask.title}
          dueAt={subtask.due_at}
          overdue={overdue}
          nested
          selected={sameFocusTarget(
            { taskId: selectedTaskId, subtaskId: selectedSubtaskId },
            { taskId: tree.task.id, subtaskId: subtask.id },
          )}
          onSelect={() => onSelect(tree.task.id, subtask.id)}
        />
      ))}
    </div>
  );
}

function PickerRow({
  title,
  dueAt,
  overdue,
  nested,
  selected,
  onSelect,
}: {
  title: string;
  dueAt: string | null;
  overdue?: boolean;
  nested?: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={clsx(
        "focus-task-picker-item",
        nested && "nested",
        selected && "selected",
      )}
      onClick={onSelect}
    >
      <span className={clsx("focus-task-picker-check", selected && "checked")}>
        {selected && <Check />}
      </span>
      <span className="focus-task-picker-title">{title}</span>
      {dueAt && (
        <span className={clsx("focus-task-picker-due", overdue && "overdue")}>
          {formatDue(dueAt)}
        </span>
      )}
    </button>
  );
}

function formatDue(dueAt: string) {
  const date = new Date(dueAt);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}
