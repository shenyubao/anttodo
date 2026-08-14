import type { Subtask } from "../types";

export const MAX_TASK_TREE_DEPTH = 5;

export type SubtaskTreeNode = {
  subtask: Subtask;
  depth: number;
  children: SubtaskTreeNode[];
};

function parentKey(parentId: string | null | undefined) {
  return parentId ?? "";
}

export function subtaskParentId(subtask: Pick<Subtask, "parent_subtask_id">) {
  return subtask.parent_subtask_id ?? null;
}

export function childrenOf(
  subtasks: readonly Subtask[],
  parentId: string | null,
) {
  return subtasks
    .filter((item) => subtaskParentId(item) === parentId)
    .sort((left, right) => left.position - right.position || left.title.localeCompare(right.title));
}

export function nextSiblingPosition(
  subtasks: readonly Subtask[],
  parentId: string | null,
) {
  const siblings = childrenOf(subtasks, parentId);
  if (siblings.length === 0) return 0;
  return Math.max(...siblings.map((item) => item.position)) + 1;
}

export function descendantIds(subtasks: readonly Subtask[], rootId: string) {
  const byParent = new Map<string, Subtask[]>();
  for (const subtask of subtasks) {
    const key = parentKey(subtaskParentId(subtask));
    const list = byParent.get(key) ?? [];
    list.push(subtask);
    byParent.set(key, list);
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

export function subtaskDepth(
  subtasks: readonly Subtask[],
  subtaskId: string | null,
) {
  if (!subtaskId) return 1;
  const byId = new Map(subtasks.map((item) => [item.id, item]));
  let depth = 2;
  let cursor = byId.get(subtaskId) ?? null;
  const seen = new Set<string>();
  while (cursor) {
    if (seen.has(cursor.id)) return MAX_TASK_TREE_DEPTH + 1;
    seen.add(cursor.id);
    const parentId = subtaskParentId(cursor);
    if (!parentId) return depth;
    depth += 1;
    if (depth > MAX_TASK_TREE_DEPTH) return depth;
    cursor = byId.get(parentId) ?? null;
  }
  return depth;
}

export function subtreeExtraDepth(subtasks: readonly Subtask[], rootId: string) {
  const byParent = new Map<string, Subtask[]>();
  for (const subtask of subtasks) {
    const key = parentKey(subtaskParentId(subtask));
    const list = byParent.get(key) ?? [];
    list.push(subtask);
    byParent.set(key, list);
  }
  let extra = 0;
  const visit = (id: string, current: number) => {
    extra = Math.max(extra, current);
    for (const child of byParent.get(id) ?? []) visit(child.id, current + 1);
  };
  visit(rootId, 0);
  return extra;
}

export function canAddChild(subtasks: readonly Subtask[], parentId: string | null) {
  if (!parentId) return true;
  return subtaskDepth(subtasks, parentId) < MAX_TASK_TREE_DEPTH;
}

function previousSibling(subtasks: readonly Subtask[], subtask: Subtask) {
  const siblings = childrenOf(subtasks, subtaskParentId(subtask));
  const index = siblings.findIndex((item) => item.id === subtask.id);
  return index > 0 ? siblings[index - 1] ?? null : null;
}

export function canIndent(subtasks: readonly Subtask[], subtaskId: string) {
  const subtask = subtasks.find((item) => item.id === subtaskId);
  if (!subtask) return false;
  const previous = previousSibling(subtasks, subtask);
  if (!previous) return false;
  const nextDepth = subtaskDepth(subtasks, previous.id) + 1;
  return nextDepth + subtreeExtraDepth(subtasks, subtask.id) <= MAX_TASK_TREE_DEPTH;
}

export function canOutdent(subtasks: readonly Subtask[], subtaskId: string) {
  const subtask = subtasks.find((item) => item.id === subtaskId);
  return Boolean(subtask && subtaskParentId(subtask));
}

export function indentSubtaskPatch(subtasks: readonly Subtask[], subtaskId: string) {
  const subtask = subtasks.find((item) => item.id === subtaskId);
  if (!subtask || !canIndent(subtasks, subtaskId)) return null;
  const previous = previousSibling(subtasks, subtask);
  if (!previous) return null;
  return {
    parent_subtask_id: previous.id,
    position: nextSiblingPosition(
      subtasks.filter((item) => item.id !== subtaskId),
      previous.id,
    ),
  };
}

export function outdentSubtaskPatch(subtasks: readonly Subtask[], subtaskId: string) {
  const subtask = subtasks.find((item) => item.id === subtaskId);
  if (!subtask) return null;
  const parentId = subtaskParentId(subtask);
  if (!parentId) return null;
  const parent = subtasks.find((item) => item.id === parentId);
  if (!parent) return null;
  const grandparentId = subtaskParentId(parent);
  return {
    parent_subtask_id: grandparentId,
    position: parent.position + 1,
  };
}

export function buildSubtaskForest(
  subtasks: readonly Subtask[],
  parentId: string | null = null,
  depth = 2,
): SubtaskTreeNode[] {
  return childrenOf(subtasks, parentId).map((subtask) => ({
    subtask,
    depth,
    children: buildSubtaskForest(subtasks, subtask.id, depth + 1),
  }));
}

export function flattenSubtaskTree(
  subtasks: readonly Subtask[],
  parentId: string | null = null,
): Array<{ subtask: Subtask; depth: number }> {
  const flatten = (nodes: SubtaskTreeNode[]): Array<{ subtask: Subtask; depth: number }> =>
    nodes.flatMap((node) => [
      { subtask: node.subtask, depth: node.depth },
      ...flatten(node.children),
    ]);
  return flatten(buildSubtaskForest(subtasks, parentId));
}

export function visibleFlattenedSubtasks(
  subtasks: readonly Subtask[],
  parentId: string | null,
  collapsedIds: ReadonlySet<string>,
) {
  const hidden = new Set<string>();
  return flattenSubtaskTree(subtasks, parentId).filter((row) => {
    const parent = subtaskParentId(row.subtask);
    if (parent && (collapsedIds.has(parent) || hidden.has(parent))) {
      hidden.add(row.subtask.id);
      return false;
    }
    return true;
  });
}

export function ancestorChain(subtasks: readonly Subtask[], subtaskId: string) {
  const byId = new Map(subtasks.map((item) => [item.id, item]));
  const chain: Subtask[] = [];
  let cursor = byId.get(subtaskId) ?? null;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    chain.unshift(cursor);
    const parentId = subtaskParentId(cursor);
    cursor = parentId ? byId.get(parentId) ?? null : null;
  }
  return chain;
}

export function subtaskProgress(subtasks: readonly Subtask[]) {
  return {
    completed: subtasks.filter((item) => item.completed).length,
    total: subtasks.length,
  };
}
