import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createDemoBundle } from "./demo";
import { normalizeWorkspaceBundle, patchTaskInBundle } from "./taskCache";
import { canChangeTaskStatus, isClosedTask, rollbackTaskStatus, TaskStatusConflict } from "./taskStatus";
import { writeTaskStatus } from "./taskStatusApi";
import { collectTimelineBars } from "./taskTimeline";
import { taskCollectionProgress } from "./taskTree";
import { buildDesktopReminderEntries } from "./desktopNotifications";

describe("abandoned task state", () => {
  const task = createDemoBundle().tasks.find((item) => item.status === "open" && item.kind === "todo")!;

  it("ends a task without counting it as completed or changing children and scheduling", () => {
    const bundle = normalizeWorkspaceBundle(createDemoBundle());
    const next = patchTaskInBundle(bundle, task.id, { status: "cancelled", completed_at: null });
    const saved = next.tasks.find((item) => item.id === task.id)!;
    expect(isClosedTask(saved)).toBe(true);
    expect(taskCollectionProgress([saved])).toEqual({ completed: 0, total: 1 });
    expect(saved.children).toEqual(bundle.tasks.find((item) => item.id === task.id)!.children);
    expect(saved.due_at).toBe(task.due_at);
    expect(saved.recurrence).toEqual(task.recurrence);
    expect(normalizeWorkspaceBundle(JSON.parse(JSON.stringify(next))).tasks.find((item) => item.id === task.id)?.status).toBe("cancelled");
  });

  it("allows only native open todos to be abandoned", () => {
    expect(canChangeTaskStatus(task, "cancelled")).toBe(true);
    for (const patch of [{ kind: "note" as const }, { connector_id: "remote" }, { status: "completed" as const }, { deleted_at: "now" }]) {
      expect(canChangeTaskStatus({ ...task, ...patch }, "cancelled")).toBe(false);
    }
    expect(canChangeTaskStatus({ ...task, status: "cancelled" }, "open")).toBe(true);
  });

  it("rolls back only the affected status and preserves other edits", () => {
    const bundle = normalizeWorkspaceBundle(createDemoBundle());
    const optimistic = { ...task, status: "cancelled" as const, version: task.version + 1 };
    let next = patchTaskInBundle(bundle, task.id, optimistic);
    next = patchTaskInBundle(next, task.id, { title: "concurrent title" });
    const previous = task;
    const rolled = rollbackTaskStatus(next, optimistic, previous);
    expect(rolled.tasks.find((item) => item.id === task.id)).toMatchObject({ title: "concurrent title", status: task.status });
    const newer = patchTaskInBundle(next, task.id, { version: optimistic.version + 1, status: "completed" });
    expect(rollbackTaskStatus(newer, optimistic, previous)).toBe(newer);
  });

  it("hides abandoned timeline bars unless ended tasks are shown", () => {
    const cancelled = { ...task, status: "cancelled" as const, due_at: "2026-08-31T10:00:00Z", children: [] };
    expect(collectTimelineBars([cancelled], false)).toEqual([]);
    expect(collectTimelineBars([cancelled], true)[0]).toMatchObject({ completed: false, task: { status: "cancelled" } });
    const parent = { ...task, due_at: null, children: [{ ...cancelled, id: "child", parent_task_id: task.id }] };
    expect(collectTimelineBars([parent], false)).toEqual([]);
    expect(collectTimelineBars([parent], true)).toHaveLength(1);
  });

  it("does not schedule reminders for an abandoned child through its parent", () => {
    const child = { ...task, id: "child", status: "cancelled" as const, reminders: [{ id: "reminder", position: 0, created_by: task.created_by, updated_at: "2026-08-31T10:00:00Z", task_id: "child", trigger_at: "2026-09-02T10:00:00Z", anchor: "end" as const, offset_value: 0, offset_unit: "minute" as const, local_time: null, created_at: "2026-08-31T10:00:00Z" }] };
    expect(buildDesktopReminderEntries([{ ...task, reminders: [], children: [child] }], task.workspace_id, task.created_by, { now: 0 })).toEqual([]);
  });
});

describe("guarded status writes", () => {
  const expected = { id: "t", status: "cancelled" as const, completed_at: null, version: 4, updated_at: "now" };
  function clientWith(result: unknown) {
    const query = { update: vi.fn(), eq: vi.fn(), is: vi.fn(), select: vi.fn(), maybeSingle: vi.fn(async () => result) };
    query.update.mockReturnValue(query); query.eq.mockReturnValue(query); query.is.mockReturnValue(query); query.select.mockReturnValue(query);
    return { query, client: { from: vi.fn(() => query) } as unknown as SupabaseClient };
  }
  it("guards workspace, version, prior state, deletion and native kind, returning server metadata", async () => {
    const saved = { ...expected, version: 5, status: "open", updated_at: "server" };
    const { client, query } = clientWith({ data: saved, error: null });
    expect(await writeTaskStatus(client, "workspace", expected, "open")).toEqual(saved);
    expect(query.update).toHaveBeenCalledWith({ status: "open", completed_at: null });
    expect(query.eq.mock.calls).toEqual([["workspace_id", "workspace"], ["id", "t"], ["version", 4], ["status", "cancelled"], ["kind", "todo"]]);
    expect(query.is.mock.calls).toEqual([["connector_id", null], ["deleted_at", null]]);
  });
  it("treats zero writable rows as a conflict, not successful undo", async () => {
    const { client } = clientWith({ data: null, error: null });
    await expect(writeTaskStatus(client, "workspace", expected, "open")).rejects.toBeInstanceOf(TaskStatusConflict);
  });
});
