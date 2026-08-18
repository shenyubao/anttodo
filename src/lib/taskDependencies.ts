import type { Task, TaskDependency, TaskDependencyTarget } from "../types";

export type { TaskDependencyTarget };

export function dependencyTargetKey(target: TaskDependencyTarget) {
  return target.taskId;
}

export function dependencySourceKey(taskId: string) {
  return taskId;
}

export function dependencyFromRow(row: TaskDependency): TaskDependencyTarget {
  return { taskId: row.depends_on_task_id };
}

export function sameDependencyTarget(left: TaskDependencyTarget, right: TaskDependencyTarget) {
  return dependencyTargetKey(left) === dependencyTargetKey(right);
}

export function listItemDependencies(task: Task) {
  return task.dependencies ?? [];
}

export function collectWorkspaceDependencies(tasks: readonly Task[]) {
  return tasks.flatMap((task) => task.dependencies ?? []);
}

export function resolveDependencyTarget(tasks: readonly Task[], target: TaskDependencyTarget) {
  return tasks.find((item) => item.id === target.taskId && !item.deleted_at) ?? null;
}

export function wouldCreateDependencyCycle(
  tasks: readonly Task[],
  successor: TaskDependencyTarget,
  predecessor: TaskDependencyTarget,
) {
  if (sameDependencyTarget(successor, predecessor)) return true;
  const outgoing = new Map<string, string[]>();
  for (const edge of collectWorkspaceDependencies(tasks)) {
    outgoing.set(edge.task_id, [...(outgoing.get(edge.task_id) ?? []), edge.depends_on_task_id]);
  }
  const seen = new Set<string>();
  const stack = [dependencyTargetKey(predecessor)];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === dependencyTargetKey(successor)) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    stack.push(...(outgoing.get(current) ?? []));
  }
  return false;
}

export function filterPickerTasksForDependency(
  tasks: readonly Task[],
  source: TaskDependencyTarget,
  existing: readonly TaskDependency[] = [],
) {
  const excluded = new Set([dependencyTargetKey(source), ...existing.map((row) => row.depends_on_task_id)]);
  return tasks.filter((task) => !task.deleted_at && task.kind === "todo" && !excluded.has(task.id));
}

export function taskDependencyProgress(tasks: readonly Task[], taskId: string) {
  const task = tasks.find((item) => item.id === taskId);
  const dependencies = task?.dependencies ?? [];
  const completed = dependencies.filter((row) =>
    tasks.find((item) => item.id === row.depends_on_task_id)?.status === "completed"
  ).length;
  return { completed, total: dependencies.length };
}

export function isTaskBlocked(tasks: readonly Task[], taskId: string) {
  const task = tasks.find((item) => item.id === taskId);
  return (task?.dependencies ?? []).some((row) =>
    tasks.find((item) => item.id === row.depends_on_task_id)?.status !== "completed"
  );
}
