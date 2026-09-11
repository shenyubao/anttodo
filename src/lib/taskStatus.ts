import type { Task, WorkspaceBundle } from "../types";
import { patchTaskInBundle } from "./taskCache";

export type TaskStatusRecord = Pick<Task, "id" | "status" | "completed_at" | "version" | "updated_at">;
export type TaskStatusWriter = (expected: TaskStatusRecord, status: "open" | "cancelled") => Promise<TaskStatusRecord>;

export class TaskStatusConflict extends Error {
  constructor() { super("任务已被修改、删除或无编辑权限，请刷新后重试"); }
}

export function isClosedTask(task: Pick<Task, "kind" | "status">) {
  return task.kind !== "note" && task.status !== "open";
}

export function closedTaskGroupTitle(tasks: readonly Pick<Task, "status">[]) {
  return tasks.some((task) => task.status === "cancelled") ? "已完成 & 已放弃" : "已完成";
}

export function canChangeTaskStatus(task: Task | undefined, status: "open" | "cancelled") {
  return Boolean(task && task.kind === "todo" && !task.connector_id && !task.deleted_at
    && (status === "cancelled" ? task.status === "open" : task.status === "cancelled"));
}

/** Roll back only this mutation's status fields; preserve concurrent edits and other tasks. */
export function rollbackTaskStatus(bundle: WorkspaceBundle, optimistic: TaskStatusRecord, previous: TaskStatusRecord) {
  const current = bundle.tasks.find((task) => task.id === optimistic.id);
  if (!current || current.status !== optimistic.status || current.version !== optimistic.version) return bundle;
  return patchTaskInBundle(bundle, previous.id, {
    status: previous.status,
    completed_at: previous.completed_at,
    version: previous.version,
    updated_at: previous.updated_at,
  });
}
