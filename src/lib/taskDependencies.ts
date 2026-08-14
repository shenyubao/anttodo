import type { Subtask, Task, TaskDependency, TaskDependencyTarget } from "../types";

export type { TaskDependencyTarget };

export function dependencyTargetKey(target: TaskDependencyTarget) {
  return `${target.taskId}:${target.subtaskId ?? ""}`;
}

export function dependencySourceKey(taskId: string, subtaskId: string | null) {
  return dependencyTargetKey({ taskId, subtaskId });
}

export function dependencyFromRow(row: TaskDependency): TaskDependencyTarget {
  return {
    taskId: row.depends_on_task_id,
    subtaskId: row.depends_on_subtask_id,
  };
}

export function sameDependencyTarget(left: TaskDependencyTarget, right: TaskDependencyTarget) {
  return left.taskId === right.taskId && (left.subtaskId ?? null) === (right.subtaskId ?? null);
}

export function listItemDependencies(task: Task, subtaskId?: string | null) {
  if (subtaskId) {
    return task.subtasks.find((item) => item.id === subtaskId)?.dependencies ?? [];
  }
  return task.dependencies ?? [];
}

export function collectWorkspaceDependencies(tasks: readonly Task[]) {
  return tasks.flatMap((task) => [
    ...(task.dependencies ?? []),
    ...task.subtasks.flatMap((subtask) => subtask.dependencies ?? []),
  ]);
}

export function resolveDependencyTarget(
  tasks: readonly Task[],
  target: TaskDependencyTarget,
): { task: Task; subtask: Subtask | null } | null {
  const task = tasks.find((item) => item.id === target.taskId && !item.deleted_at);
  if (!task) return null;
  if (!target.subtaskId) return { task, subtask: null };
  const subtask = task.subtasks.find((item) => item.id === target.subtaskId) ?? null;
  if (!subtask) return null;
  return { task, subtask };
}

function predecessorTarget(row: TaskDependency): TaskDependencyTarget {
  return dependencyFromRow(row);
}

function successorTarget(row: TaskDependency): TaskDependencyTarget {
  return { taskId: row.task_id, subtaskId: row.subtask_id };
}

export function wouldCreateDependencyCycle(
  tasks: readonly Task[],
  successor: TaskDependencyTarget,
  predecessor: TaskDependencyTarget,
) {
  if (sameDependencyTarget(successor, predecessor)) return true;
  const edges = collectWorkspaceDependencies(tasks);
  const outgoing = new Map<string, TaskDependencyTarget[]>();
  for (const edge of edges) {
    const from = dependencyTargetKey(successorTarget(edge));
    const list = outgoing.get(from) ?? [];
    list.push(predecessorTarget(edge));
    outgoing.set(from, list);
  }
  const start = dependencyTargetKey(predecessor);
  const goal = dependencyTargetKey(successor);
  const seen = new Set<string>();
  const stack = [start];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === goal) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const next of outgoing.get(current) ?? []) {
      stack.push(dependencyTargetKey(next));
    }
  }
  return false;
}

function isExcludedTarget(
  target: TaskDependencyTarget,
  sourceKey: string,
  existingKeys: Set<string>,
) {
  const key = dependencyTargetKey(target);
  return key === sourceKey || existingKeys.has(key);
}

export function filterPickerTasksForDependency(
  tasks: readonly Task[],
  source: TaskDependencyTarget,
  existing: readonly TaskDependency[] = [],
) {
  const existingKeys = new Set(existing.map((row) => dependencyTargetKey(dependencyFromRow(row))));
  const sourceKey = dependencyTargetKey(source);
  return tasks.flatMap((task) => {
    if (task.deleted_at || task.kind === "note") return [];
    const keepParent = !isExcludedTarget({ taskId: task.id, subtaskId: null }, sourceKey, existingKeys);
    const subtasks = task.subtasks.filter((subtask) =>
      !isExcludedTarget({ taskId: task.id, subtaskId: subtask.id }, sourceKey, existingKeys),
    );
    if (!keepParent && subtasks.length === 0) return [];
    return [{ ...task, subtasks }];
  });
}
