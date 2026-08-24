import type { Task } from "../types";
import { isLiveTask } from "./taskTree";

export const MAX_TASKS_PER_LABEL = 10_000;
export const LABEL_TASK_LIMIT_ERROR_CODE = "label_task_limit_exceeded";
export const LABEL_TASK_LIMIT_MESSAGE = "已超过单标签的最大任务数，请清理该标签下的任务后再试";

export function countLiveTasksByLabel(
  tasks: Iterable<Pick<Task, "deleted_at" | "label_ids">>,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const task of tasks) {
    if (!isLiveTask(task)) continue;
    for (const labelId of task.label_ids) {
      counts[labelId] = (counts[labelId] ?? 0) + 1;
    }
  }
  return counts;
}

export function labelTaskCount(
  counts: Record<string, number> | undefined,
  labelId: string,
) {
  return counts?.[labelId] ?? 0;
}

export function isLabelAtTaskLimit(
  counts: Record<string, number> | undefined,
  labelId: string,
) {
  return labelTaskCount(counts, labelId) >= MAX_TASKS_PER_LABEL;
}

export function adjustLabelTaskCounts(
  counts: Record<string, number> | undefined,
  labelIds: Iterable<string>,
  delta: number,
): Record<string, number> {
  const next = { ...counts };
  for (const labelId of labelIds) {
    next[labelId] = Math.max(0, (next[labelId] ?? 0) + delta);
  }
  return next;
}

export function applyLiveLabelCountDelta(
  counts: Record<string, number>,
  previous: Pick<Task, "deleted_at" | "label_ids"> | undefined,
  next: Pick<Task, "deleted_at" | "label_ids">,
): Record<string, number> {
  const previousIds = previous && isLiveTask(previous) ? previous.label_ids : [];
  const nextIds = isLiveTask(next) ? next.label_ids : [];
  const previousSet = new Set(previousIds);
  const nextSet = new Set(nextIds);
  let updated = counts;
  const removed = previousIds.filter((labelId) => !nextSet.has(labelId));
  const added = nextIds.filter((labelId) => !previousSet.has(labelId));
  if (removed.length) updated = adjustLabelTaskCounts(updated, removed, -1);
  if (added.length) updated = adjustLabelTaskCounts(updated, added, 1);
  return updated;
}

export function assertCanAssociateTaskLabels(
  counts: Record<string, number> | undefined,
  labelIds: Iterable<string>,
) {
  for (const labelId of labelIds) {
    if (isLabelAtTaskLimit(counts, labelId)) {
      throw new Error(LABEL_TASK_LIMIT_MESSAGE);
    }
  }
}

export function mapLabelTaskLimitError(message: string) {
  return message.includes(LABEL_TASK_LIMIT_ERROR_CODE) ? LABEL_TASK_LIMIT_MESSAGE : null;
}
