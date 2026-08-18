import type { Task } from "../types";

export const MAX_TASK_TREE_DEPTH = 5;

export type TaskTreeNode = {
  task: Task;
  depth: number;
  children: TaskTreeNode[];
};

function parentKey(parentId: string | null | undefined) {
  return parentId ?? "";
}

export function taskParentId(task: Pick<Task, "parent_task_id">) {
  return task.parent_task_id ?? null;
}

export function isRootTask(task: Pick<Task, "parent_task_id">) {
  return taskParentId(task) === null;
}

export function isLiveTask(task: Pick<Task, "deleted_at">) {
  return !task.deleted_at;
}

export function childrenOf(
  tasks: readonly Task[],
  parentId: string | null,
  options?: { includeDeleted?: boolean },
) {
  return tasks
    .filter((item) => taskParentId(item) === parentId)
    .filter((item) => options?.includeDeleted || isLiveTask(item))
    .sort((left, right) => left.position - right.position || left.title.localeCompare(right.title));
}

export function nextSiblingPosition(tasks: readonly Task[], parentId: string | null) {
  const siblings = childrenOf(tasks, parentId, { includeDeleted: true });
  return siblings.length === 0 ? 0 : Math.max(...siblings.map((item) => item.position)) + 1;
}

export function descendantIds(tasks: readonly Task[], rootId: string) {
  const byParent = new Map<string, Task[]>();
  for (const task of tasks) {
    const key = parentKey(taskParentId(task));
    byParent.set(key, [...(byParent.get(key) ?? []), task]);
  }
  const ids = new Set<string>();
  const stack = [rootId];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const child of byParent.get(current) ?? []) {
      if (ids.has(child.id)) continue;
      ids.add(child.id);
      stack.push(child.id);
    }
  }
  return ids;
}

export function taskDepth(tasks: readonly Task[], taskId: string | null) {
  if (!taskId) return 0;
  const byId = new Map(tasks.map((item) => [item.id, item]));
  let depth = 1;
  let cursor = byId.get(taskId) ?? null;
  const seen = new Set<string>();
  while (cursor?.parent_task_id) {
    if (seen.has(cursor.id)) return MAX_TASK_TREE_DEPTH + 1;
    seen.add(cursor.id);
    depth += 1;
    cursor = byId.get(cursor.parent_task_id) ?? null;
  }
  return depth;
}

export function subtreeExtraDepth(tasks: readonly Task[], rootId: string) {
  const descendants = descendantIds(tasks, rootId);
  let maximum = 0;
  for (const id of descendants) maximum = Math.max(maximum, taskDepth(tasks, id) - taskDepth(tasks, rootId));
  return maximum;
}

export function canAddChild(tasks: readonly Task[], parentId: string | null) {
  return parentId === null || taskDepth(tasks, parentId) < MAX_TASK_TREE_DEPTH;
}

function previousSibling(tasks: readonly Task[], task: Task) {
  const siblings = childrenOf(tasks, taskParentId(task));
  const index = siblings.findIndex((item) => item.id === task.id);
  return index > 0 ? siblings[index - 1] ?? null : null;
}

export function canIndent(tasks: readonly Task[], taskId: string) {
  const task = tasks.find((item) => item.id === taskId);
  if (!task) return false;
  const previous = previousSibling(tasks, task);
  return Boolean(previous && taskDepth(tasks, previous.id) + 1 + subtreeExtraDepth(tasks, task.id) <= MAX_TASK_TREE_DEPTH);
}

export function canOutdent(tasks: readonly Task[], taskId: string) {
  return Boolean(tasks.find((item) => item.id === taskId)?.parent_task_id);
}

export function indentTaskPatch(tasks: readonly Task[], taskId: string) {
  const task = tasks.find((item) => item.id === taskId);
  if (!task || !canIndent(tasks, taskId)) return null;
  const previous = previousSibling(tasks, task);
  if (!previous) return null;
  return {
    parent_task_id: previous.id,
    position: nextSiblingPosition(tasks.filter((item) => item.id !== taskId), previous.id),
  };
}

export function outdentTaskPatch(tasks: readonly Task[], taskId: string) {
  const task = tasks.find((item) => item.id === taskId);
  if (!task?.parent_task_id) return null;
  const parent = tasks.find((item) => item.id === task.parent_task_id);
  if (!parent) return null;
  return { parent_task_id: parent.parent_task_id, position: parent.position + 1 };
}

export function buildTaskForest(tasks: readonly Task[], parentId: string | null = null, depth = 1): TaskTreeNode[] {
  return childrenOf(tasks, parentId).map((task) => ({
    task,
    depth,
    children: buildTaskForest(tasks, task.id, depth + 1),
  }));
}

export function flattenTaskTree(tasks: readonly Task[], parentId: string | null = null) {
  const flatten = (nodes: TaskTreeNode[]): Array<{ task: Task; depth: number }> => nodes.flatMap((node) => [
    { task: node.task, depth: node.depth },
    ...flatten(node.children),
  ]);
  return flatten(buildTaskForest(tasks, parentId));
}

export function visibleFlattenedTasks(tasks: readonly Task[], parentId: string | null, collapsedIds: ReadonlySet<string>) {
  const hidden = new Set<string>();
  return flattenTaskTree(tasks, parentId).filter((row) => {
    const parent = taskParentId(row.task);
    if (parent && (collapsedIds.has(parent) || hidden.has(parent))) {
      hidden.add(row.task.id);
      return false;
    }
    return true;
  });
}

export function ancestorChain(tasks: readonly Task[], taskId: string) {
  const byId = new Map(tasks.map((item) => [item.id, item]));
  const chain: Task[] = [];
  let cursor = byId.get(taskId) ?? null;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    chain.unshift(cursor);
    cursor = cursor.parent_task_id ? byId.get(cursor.parent_task_id) ?? null : null;
  }
  return chain;
}

export function taskProgress(tasks: readonly Task[], rootId: string) {
  const ids = descendantIds(tasks, rootId);
  const descendants = tasks.filter((item) => ids.has(item.id) && isLiveTask(item));
  return { completed: descendants.filter((item) => item.status === "completed").length, total: descendants.length };
}

export function visibleTaskForest(tasks: readonly Task[], matchedIds?: ReadonlySet<string>) {
  if (!matchedIds) return buildTaskForest(tasks.filter(isLiveTask));
  const visibleIds = new Set<string>();
  for (const id of matchedIds) for (const ancestor of ancestorChain(tasks, id)) visibleIds.add(ancestor.id);
  return buildTaskForest(tasks.filter((task) => visibleIds.has(task.id) && isLiveTask(task)));
}

export function taskCollectionProgress(tasks: readonly Task[]) {
  return {
    completed: tasks.filter((item) => item.status === "completed").length,
    total: tasks.length,
  };
}
