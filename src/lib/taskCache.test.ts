import { describe, expect, it } from "vitest";
import type { WorkspaceBundle } from "../types";
import {
  applyTaskListOrderToBundle,
  applyTaskSectionOrderToBundle,
  applyTaskScheduleToBundle,
  appendSubtaskInBundle,
  appendTaskToBundle,
  createOptimisticTask,
  findTaskIdForSubtask,
  patchSubtaskInBundle,
  removeSubtaskFromBundle,
  removeTaskFromBundle,
  replaceOptimisticTask,
  taskIdFromRealtimeChange,
} from "./taskCache";

const emptyBundle = (): WorkspaceBundle => ({
  members: [],
  userGroups: [],
  userGroupMembers: [],
  labels: [],
  labelUserAcls: [],
  labelGroupAcls: [],
  labelPermissionLevels: {},
  userLabelOrder: [],
  tasks: [],
  connectors: [],
  syncRuns: [],
  conflicts: [],
  taskListPreferences: [],
  taskSections: [],
  taskPlacements: [],
});

describe("task cache updates", () => {
  it("applies a custom section order without touching other lists", () => {
    const bundle = emptyBundle();
    bundle.taskSections = [
      { id: "one", workspace_id: "workspace", list_key: "all", name: "一", position: 0, created_by: "user" },
      { id: "two", workspace_id: "workspace", list_key: "all", name: "二", position: 1, created_by: "user" },
      { id: "other", workspace_id: "workspace", list_key: "today", name: "其他", position: 0, created_by: "user" },
    ];

    const reordered = applyTaskSectionOrderToBundle(bundle, {
      listKey: "all",
      sectionIds: ["two", "one"],
    });

    expect(reordered.taskSections.map((section) => [section.id, section.position])).toEqual([
      ["one", 1],
      ["two", 0],
      ["other", 0],
    ]);
  });

  it("replaces an optimistic task in place and keeps its custom placement", () => {
    const existing = createOptimisticTask({
      workspaceId: "workspace",
      userId: "user",
      title: "已有待办",
      labelIds: ["label"],
      optimisticId: "existing-task",
      now: "2026-08-02T00:00:00.000Z",
    });
    const optimistic = createOptimisticTask({
      workspaceId: "workspace",
      userId: "user",
      title: "新增待办",
      labelIds: ["label"],
      optimisticId: "optimistic-task:one",
      now: "2026-08-03T00:00:00.000Z",
    });
    let bundle = appendTaskToBundle(appendTaskToBundle(emptyBundle(), existing), optimistic);
    bundle = applyTaskListOrderToBundle(bundle, {
      workspaceId: "workspace",
      listKey: "label:label",
      sectionId: null,
      taskIds: [optimistic.id, existing.id],
    });
    bundle = replaceOptimisticTask(bundle, optimistic.id, {
      ...optimistic,
      id: "server-task",
      created_at: "2026-08-03T00:00:01.000Z",
      updated_at: "2026-08-03T00:00:01.000Z",
    }, ["label"]);

    expect(bundle.tasks.map((task) => task.id)).toEqual(["server-task", "existing-task"]);
    expect(bundle.taskPlacements).toMatchObject([
      { task_id: "server-task", list_key: "label:label", position: 0 },
      { task_id: "existing-task", list_key: "label:label", position: 1 },
    ]);
  });

  it("removes a failed optimistic task and its placement", () => {
    const optimistic = createOptimisticTask({
      workspaceId: "workspace",
      userId: "user",
      title: "失败待办",
      labelIds: [],
      optimisticId: "optimistic-task:failed",
    });
    const ordered = applyTaskListOrderToBundle(appendTaskToBundle(emptyBundle(), optimistic), {
      workspaceId: "workspace",
      listKey: "all",
      sectionId: null,
      taskIds: [optimistic.id],
    });
    const rolledBack = removeTaskFromBundle(ordered, optimistic.id);
    expect(rolledBack.tasks).toEqual([]);
    expect(rolledBack.taskPlacements).toEqual([]);
  });

  it("extracts task ids from task and child-table Realtime payloads", () => {
    expect(taskIdFromRealtimeChange({ table: "tasks", new: { id: "task-1" } }))
      .toBe("task-1");
    expect(taskIdFromRealtimeChange({ table: "task_labels", new: { task_id: "task-2" } }))
      .toBe("task-2");
    expect(taskIdFromRealtimeChange({ table: "task_list_placements", old: { task_id: "task-3" } }))
      .toBe("task-3");
    expect(taskIdFromRealtimeChange({ table: "subtasks", new: { task_id: "task-4", id: "sub-1" } }))
      .toBe("task-4");
    expect(taskIdFromRealtimeChange({ table: "task_reminders", old: { task_id: "task-5" } }))
      .toBe("task-5");
  });

  it("patches task schedule and subtasks in place", () => {
    const task = createOptimisticTask({
      workspaceId: "workspace",
      userId: "user",
      title: "带日程",
      labelIds: [],
      optimisticId: "task-schedule",
      now: "2026-08-03T00:00:00.000Z",
    });
    let bundle = appendTaskToBundle(emptyBundle(), task);
    bundle = applyTaskScheduleToBundle(bundle, task.id, {
      due_at: "2026-08-04T16:00:00.000Z",
      due_start_at: null,
      due_is_all_day: true,
      due_timezone: "Asia/Shanghai",
    }, {
      reminders: [{
        id: "reminder-1",
        task_id: task.id,
        anchor: "end",
        offset_value: 0,
        offset_unit: "day",
        local_time: "09:00:00",
        trigger_at: "2026-08-04T01:00:00.000Z",
        position: 0,
        created_by: "user",
        created_at: "2026-08-03T00:00:00.000Z",
        updated_at: "2026-08-03T00:00:00.000Z",
      }],
      reminderPersistent: true,
      recurrence: { freq: "daily", interval: 1, mode: "due" },
    });
    expect(bundle.tasks[0]).toMatchObject({
      due_at: "2026-08-04T16:00:00.000Z",
      due_is_all_day: true,
      reminder_persistent: true,
      recurrence: { freq: "daily", interval: 1, mode: "due" },
    });
    expect(bundle.tasks[0].reminders).toHaveLength(1);

    const subtask = {
      id: "sub-1",
      task_id: task.id,
      title: "子任务",
      completed: false,
      position: 0,
      due_at: null,
      assignee_id: null,
      cli_assignee: null,
      created_by: "user",
    };
    bundle = appendSubtaskInBundle(bundle, task.id, subtask);
    expect(findTaskIdForSubtask(bundle, "sub-1")).toBe(task.id);
    bundle = patchSubtaskInBundle(bundle, "sub-1", {
      completed: true,
      assignee_id: "member-1",
      due_at: "2026-08-05T00:00:00.000Z",
    });
    expect(bundle.tasks[0].subtasks[0]).toMatchObject({
      completed: true,
      assignee_id: "member-1",
      due_at: "2026-08-05T00:00:00.000Z",
    });
    bundle = removeSubtaskFromBundle(bundle, "sub-1");
    expect(bundle.tasks[0].subtasks).toEqual([]);
  });
});
