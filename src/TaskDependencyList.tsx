import { GitFork, Plus, X } from "lucide-react";
import { useMemo, useState } from "react";
import { FocusTaskPicker } from "./FocusTaskPicker";
import { formatDueWithPreferences } from "./lib/dateTimePreferences";
import {
  dependencyTargetKey,
  filterPickerTasksForDependency,
  listItemDependencies,
  resolveDependencyTarget,
} from "./lib/taskDependencies";
import type { DateTimePreferences, Task, TaskDependency, TaskDependencyTarget } from "./types";

export function TaskDependencyList({
  task,
  subtaskId = null,
  tasks,
  writable,
  dateTimePreferences,
  onAdd,
  onRemove,
  onOpen,
}: {
  task: Task;
  subtaskId?: string | null;
  tasks: Task[];
  writable: boolean;
  dateTimePreferences: DateTimePreferences;
  onAdd: (targets: TaskDependencyTarget[]) => Promise<void>;
  onRemove: (dependencyId: string) => Promise<void>;
  onOpen: (taskId: string, subtaskId?: string | null) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ left: number; top: number }>();
  const dependencies = listItemDependencies(task, subtaskId);
  const source = { taskId: task.id, subtaskId };
  const pickerTasks = useMemo(
    () => filterPickerTasksForDependency(tasks, source, dependencies),
    [dependencies, source.subtaskId, source.taskId, tasks],
  );
  const excludeKeys = useMemo(() => {
    const keys = [dependencyTargetKey(source)];
    for (const row of dependencies) {
      keys.push(dependencyTargetKey({
        taskId: row.depends_on_task_id,
        subtaskId: row.depends_on_subtask_id,
      }));
    }
    return keys;
  }, [dependencies, source.subtaskId, source.taskId]);

  function openPicker(event?: { currentTarget: HTMLElement }) {
    const rect = event?.currentTarget.getBoundingClientRect();
    setAnchor(rect
      ? { left: rect.left, top: rect.bottom + 8 }
      : { left: 24, top: 72 });
    setPickerOpen(true);
  }

  return (
    <section className="detail-section task-dependency-section">
      <div className="detail-section-title">
        <span>依赖任务</span>
        <em>{dependencies.length}</em>
        {writable && (
          <button
            type="button"
            className="task-dependency-add"
            onClick={(event) => openPicker(event)}
          >
            <Plus />
            添加
          </button>
        )}
      </div>
      {dependencies.length === 0 ? (
        <p className="task-dependency-empty">尚未挂载依赖任务</p>
      ) : (
        <ul className="task-dependency-list">
          {dependencies.map((row) => (
            <DependencyRow
              key={row.id}
              row={row}
              tasks={tasks}
              writable={writable}
              dateTimePreferences={dateTimePreferences}
              onOpen={onOpen}
              onRemove={onRemove}
            />
          ))}
        </ul>
      )}
      <FocusTaskPicker
        open={pickerOpen}
        mode="dependency"
        tasks={pickerTasks}
        selectedTaskId={null}
        excludeKeys={excludeKeys}
        anchorPoint={anchor}
        onOpenChange={setPickerOpen}
        onSelect={() => undefined}
        onConfirm={(targets) => {
          void onAdd(targets);
        }}
      />
    </section>
  );
}

function DependencyRow({
  row,
  tasks,
  writable,
  dateTimePreferences,
  onOpen,
  onRemove,
}: {
  row: TaskDependency;
  tasks: Task[];
  writable: boolean;
  dateTimePreferences: DateTimePreferences;
  onOpen: (taskId: string, subtaskId?: string | null) => void;
  onRemove: (dependencyId: string) => Promise<void>;
}) {
  const resolved = resolveDependencyTarget(tasks, {
    taskId: row.depends_on_task_id,
    subtaskId: row.depends_on_subtask_id,
  });
  const title = resolved
    ? (resolved.subtask?.title ?? resolved.task.title)
    : "无权查看";
  const dueTarget = resolved?.subtask ?? resolved?.task ?? null;
  return (
    <li className="task-dependency-item">
      <GitFork aria-hidden="true" />
      <button
        type="button"
        className="task-dependency-link"
        disabled={!resolved}
        onClick={() => {
          if (!resolved) return;
          onOpen(resolved.task.id, resolved.subtask?.id ?? null);
        }}
      >
        <span className="task-dependency-title">{title}</span>
        {dueTarget?.due_at && (
          <span className="task-dependency-due">
            {formatDueWithPreferences(dueTarget, dateTimePreferences)}
          </span>
        )}
      </button>
      {writable && (
        <button
          type="button"
          className="task-dependency-remove"
          aria-label={`移除依赖 ${title}`}
          onClick={() => void onRemove(row.id)}
        >
          <X />
        </button>
      )}
    </li>
  );
}

export function useDependencyPicker() {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ left: number; top: number }>();
  return {
    open,
    anchor,
    setOpen,
    openAt(point: { left: number; top: number }) {
      setAnchor(point);
      setOpen(true);
    },
  };
}
