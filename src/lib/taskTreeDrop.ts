import type { Task } from "../types";
import { descendantIds, MAX_TASK_TREE_DEPTH, subtreeExtraDepth, taskDepth } from "./taskTree";

export type TaskDropPlacement = "before" | "inside" | "after";
export type TaskListMovePlacement = { listKey: string; sectionId: string | null; taskIds: string[] };
export type TaskUpdateOptions = { mentionedUserIds?: string[]; treeMove?: boolean; listMove?: TaskListMovePlacement };
export type TaskTreeDrop = {
  overId: string;
  groupId?: string;
  placement: TaskDropPlacement;
  parentTaskId: string | null;
  position: number;
  depth: number;
  reason: string | null;
  label: string;
};

/** One logical task can appear in several label groups; DnD IDs must stay unique. */
export function taskSortableId(taskId: string, groupId?: string) {
  return groupId ? JSON.stringify(["list-task", groupId, taskId]) : taskId;
}

export function taskDragItemId(item: { id: string | number; data?: { current?: Record<string, unknown> } }) {
  return typeof item.data?.current?.taskId === "string" ? item.data.current.taskId : String(item.id);
}

/** Resolve intent independently of DOM geometry so pointer and keyboard use the same rules. */
export function resolveTaskTreeDrop(input: {
  tasks: readonly Task[];
  taskId: string;
  overId: string;
  placement: TaskDropPlacement;
  canEdit: (task: Task) => boolean;
}): TaskTreeDrop | null {
  const { tasks, taskId, overId, placement, canEdit } = input;
  const moving = tasks.find((task) => task.id === taskId);
  const over = tasks.find((task) => task.id === overId);
  if (!moving || !over || taskId === overId) return null;
  const parentTaskId = placement === "inside" ? over.id : over.parent_task_id;
  const parent = tasks.find((task) => task.id === parentTaskId);
  const descendants = descendantIds(tasks, moving.id);
  const siblings = tasks.filter((task) => task.id !== moving.id && task.workspace_id === moving.workspace_id && task.parent_task_id === parentTaskId);
  // Close the old slot before opening the new one, matching move_task.
  const overPosition = over.position - (moving.parent_task_id === parentTaskId && moving.position < over.position ? 1 : 0);
  const position = placement === "inside"
    ? (siblings.length ? Math.max(...siblings.map((task) => task.position - (task.parent_task_id === moving.parent_task_id && task.position > moving.position ? 1 : 0))) + 1 : 0)
    : Math.max(0, overPosition + (placement === "after" ? 1 : 0));
  const depth = taskDepth(tasks, parentTaskId) + 1;
  let reason: string | null = null;
  if (moving.deleted_at || over.deleted_at || parent?.deleted_at) reason = "已删除的任务不能移动";
  else if (moving.workspace_id !== over.workspace_id) reason = "只能在同一团队空间内移动";
  else if (moving.connector_id || parent?.connector_id || tasks.some((task) => descendants.has(task.id) && task.connector_id)) reason = "连接器任务不支持调整层级";
  else if (!canEdit(moving) || (parent && !canEdit(parent))) reason = "没有移动任务的权限";
  else if (descendants.has(over.id) || parentTaskId === moving.id) reason = "不能移入自己或自己的子任务";
  else if (parentTaskId && (moving.kind !== "todo" || parent?.kind !== "todo")) reason = "笔记不支持父子任务关系";
  else if (depth + subtreeExtraDepth(tasks, moving.id) > MAX_TASK_TREE_DEPTH) reason = "任务最多支持五层，包含携带的子任务";
  const label = reason ?? (placement === "inside"
    ? `移入「${over.title}」`
    : !parentTaskId && moving.parent_task_id
      ? "提升为顶级任务"
      : `移到「${over.title}」${placement === "before" ? "之前" : "之后"}`);
  return { overId, placement, parentTaskId, position, depth, reason, label };
}

export function taskTreeMoveError(error: unknown) {
  const message = error instanceof Error ? error.message : String((error as { message?: string })?.message ?? error);
  if (message.includes("visibility")) return "移动后负责人或参与者将失去访问权限，请先调整人员或目标任务权限";
  if (message.includes("five levels")) return "任务最多支持五层，包含携带的子任务";
  if (message.includes("cycle") || message.includes("own parent")) return "不能移入自己或自己的子任务";
  if (message.includes("Notes") || message.includes("Only todo")) return "笔记不支持父子任务关系";
  if (message.includes("Connector")) return "连接器任务不支持调整层级";
  if (message.includes("Deleted")) return "已删除的任务不能移动";
  if (message.includes("same workspace")) return "只能在同一团队空间内移动";
  if (message.includes("does not exist")) return "任务已不存在，请刷新后重试";
  if (message.includes("editable") || message.includes("permission")) return "没有移动任务的权限";
  if (message.includes("changed")) return "任务已被其他操作更新，请刷新后重试";
  return message || "移动失败，请重试";
}
