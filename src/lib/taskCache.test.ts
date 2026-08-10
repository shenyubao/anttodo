import { describe, expect, it } from "vitest";
import type { WorkspaceBundle } from "../types";
import {
  applyTaskListOrderToBundle,
  applyTaskSectionInsertToBundle,
  applyTaskSectionOrderToBundle,
  applyTaskScheduleToBundle,
  appendSubtaskInBundle,
  appendTaskToBundle,
  createOptimisticSubtask,
  createOptimisticTask,
  createOptimisticTaskSection,
  defaultCreatorParticipantIds,
  findTaskIdForSubtask,
  isOptimisticSubtaskId,
  normalizeWorkspaceBundle,
  patchSubtaskInBundle,
  removeSubtaskFromBundle,
  removeTaskFromBundle,
  removeTaskSectionFromBundle,
  replaceOptimisticSubtask,
  replaceOptimisticTask,
  replaceOptimisticTaskSection,
  sectionIdFromRealtimeChange,
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
    customTaskViews: [],
    taskSystemViewPreferences: [],
    taskSections: [],
  taskPlacements: [],
});

describe("task cache updates", () => {
  it("normalizes workspace bundles missing newer view fields", () => {
    const stale = emptyBundle();
    delete (stale as { customTaskViews?: WorkspaceBundle["customTaskViews"] }).customTaskViews;
    delete (stale as { taskSystemViewPreferences?: WorkspaceBundle["taskSystemViewPreferences"] })
      .taskSystemViewPreferences;

    const normalized = normalizeWorkspaceBundle(stale as WorkspaceBundle);
    expect(normalized.customTaskViews).toEqual([]);
    expect(normalized.taskSystemViewPreferences).toEqual([]);

    const current = emptyBundle();
    expect(normalizeWorkspaceBundle(current)).toBe(current);
  });

  it("auto-watches creator unless self-assigned", () => {
    expect(defaultCreatorParticipantIds("user", null)).toEqual(["user"]);
    expect(defaultCreatorParticipantIds("user", undefined)).toEqual(["user"]);
    expect(defaultCreatorParticipantIds("user", "other")).toEqual(["user"]);
    expect(defaultCreatorParticipantIds("user", "user")).toEqual([]);

    const unassigned = createOptimisticTask({
      workspaceId: "workspace",
      userId: "user",
      title: "未指派",
      labelIds: [],
    });
    expect(unassigned.participant_ids).toEqual(["user"]);

    const assignedOther = createOptimisticTask({
      workspaceId: "workspace",
      userId: "user",
      title: "指派他人",
      labelIds: [],
      assigneeId: "other",
    });
    expect(assignedOther.participant_ids).toEqual(["user"]);

    const selfAssigned = createOptimisticTask({
      workspaceId: "workspace",
      userId: "user",
      title: "指派自己",
      labelIds: [],
      assigneeId: "user",
    });
    expect(selfAssigned.participant_ids).toEqual([]);
  });

  it("keeps auto-watch participant when replacing optimistic create", () => {
    const optimistic = createOptimisticTask({
      workspaceId: "workspace",
      userId: "user",
      title: "新增待办",
      labelIds: [],
      optimisticId: "optimistic-task:watch",
      now: "2026-08-03T00:00:00.000Z",
    });
    let bundle = appendTaskToBundle(emptyBundle(), optimistic);
    bundle = replaceOptimisticTask(
      bundle,
      optimistic.id,
      {
        id: "server-task",
        workspace_id: "workspace",
        title: "新增待办",
        created_by: "user",
        assignee_id: null,
        created_at: "2026-08-03T00:00:01.000Z",
        updated_at: "2026-08-03T00:00:01.000Z",
      },
      [],
    );
    expect(bundle.tasks[0]?.participant_ids).toEqual(["user"]);

    const selfOptimistic = createOptimisticTask({
      workspaceId: "workspace",
      userId: "user",
      title: "自我指派",
      labelIds: [],
      assigneeId: "user",
      optimisticId: "optimistic-task:self",
      now: "2026-08-03T00:00:00.000Z",
    });
    bundle = appendTaskToBundle(emptyBundle(), selfOptimistic);
    bundle = replaceOptimisticTask(
      bundle,
      selfOptimistic.id,
      {
        id: "server-self",
        workspace_id: "workspace",
        title: "自我指派",
        created_by: "user",
        assignee_id: "user",
        created_at: "2026-08-03T00:00:01.000Z",
        updated_at: "2026-08-03T00:00:01.000Z",
      },
      [],
    );
    expect(bundle.tasks[0]?.participant_ids).toEqual([]);
  });

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

  it("inserts a section optimistically and renumbers neighbors", () => {
    const bundle = emptyBundle();
    bundle.taskSections = [
      { id: "one", workspace_id: "workspace", list_key: "all", name: "一", position: 0, created_by: "user" },
      { id: "two", workspace_id: "workspace", list_key: "all", name: "二", position: 1, created_by: "user" },
    ];
    const optimistic = createOptimisticTaskSection({
      workspaceId: "workspace",
      listKey: "all",
      name: "新分组",
      position: 1,
      createdBy: "user",
      sectionId: "optimistic-section:new",
    });

    const next = applyTaskSectionInsertToBundle(bundle, {
      listKey: "all",
      section: optimistic,
      index: 1,
    });

    expect(next.taskSections.map((section) => [section.id, section.position])).toEqual([
      ["one", 0],
      ["two", 2],
      ["optimistic-section:new", 1],
    ]);
  });

  it("replaces an optimistic section id and remaps placements", () => {
    let bundle = emptyBundle();
    const optimistic = createOptimisticTaskSection({
      workspaceId: "workspace",
      listKey: "all",
      name: "新分组",
      position: 0,
      createdBy: "user",
      sectionId: "optimistic-section:new",
    });
    bundle = applyTaskSectionInsertToBundle(bundle, {
      listKey: "all",
      section: optimistic,
      index: 0,
    });
    bundle = {
      ...bundle,
      taskPlacements: [{
        workspace_id: "workspace",
        list_key: "all",
        task_id: "task",
        section_id: optimistic.id,
        position: 0,
      }],
    };

    const replaced = replaceOptimisticTaskSection(bundle, optimistic.id, {
      ...optimistic,
      id: "server-section",
    });

    expect(replaced.taskSections.map((section) => section.id)).toEqual(["server-section"]);
    expect(replaced.taskPlacements[0]?.section_id).toBe("server-section");
  });

  it("removes a section and clears placements into ungrouped", () => {
    const bundle = emptyBundle();
    bundle.taskSections = [
      { id: "one", workspace_id: "workspace", list_key: "all", name: "一", position: 0, created_by: "user" },
    ];
    bundle.taskPlacements = [{
      workspace_id: "workspace",
      list_key: "all",
      task_id: "task",
      section_id: "one",
      position: 0,
    }];

    const next = removeTaskSectionFromBundle(bundle, "one");
    expect(next.taskSections).toEqual([]);
    expect(next.taskPlacements[0]?.section_id).toBeNull();
  });

  it("reads section ids from realtime payloads", () => {
    expect(sectionIdFromRealtimeChange({
      table: "task_sections",
      new: { id: "section-1" },
      old: {},
    })).toBe("section-1");
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
      description: "",
      completed: false,
      position: 0,
      due_at: null,
      estimate_hours: null,
      actual_hours: null,
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

  it("creates and replaces optimistic subtasks without duplicates", () => {
    const task = createOptimisticTask({
      workspaceId: "workspace",
      userId: "user",
      title: "父任务",
      labelIds: [],
      optimisticId: "task-parent",
      now: "2026-08-03T00:00:00.000Z",
    });
    let bundle = appendTaskToBundle(emptyBundle(), task);
    const optimistic = createOptimisticSubtask({
      taskId: task.id,
      userId: "user",
      title: "新子任务",
      position: 0,
      dueAt: "2026-08-06T00:00:00.000Z",
      assigneeId: "member-1",
      optimisticId: "optimistic-subtask:draft",
    });
    expect(isOptimisticSubtaskId(optimistic.id)).toBe(true);
    bundle = appendSubtaskInBundle(bundle, task.id, optimistic);
    expect(bundle.tasks[0].subtasks).toHaveLength(1);
    expect(bundle.tasks[0].subtasks[0]).toMatchObject({
      id: optimistic.id,
      title: "新子任务",
      due_at: "2026-08-06T00:00:00.000Z",
      assignee_id: "member-1",
    });

    const created = {
      ...optimistic,
      id: "sub-server-1",
    };
    // Simulate realtime already appending the server row before replace.
    bundle = appendSubtaskInBundle(bundle, task.id, created);
    expect(bundle.tasks[0].subtasks).toHaveLength(2);

    bundle = replaceOptimisticSubtask(bundle, task.id, optimistic.id, created);
    expect(bundle.tasks[0].subtasks).toEqual([created]);

    const failedOptimistic = createOptimisticSubtask({
      taskId: task.id,
      userId: "user",
      title: "失败子任务",
      position: 1,
      optimisticId: "optimistic-subtask:failed",
    });
    bundle = appendSubtaskInBundle(bundle, task.id, failedOptimistic);
    expect(bundle.tasks[0].subtasks).toHaveLength(2);
    bundle = removeSubtaskFromBundle(bundle, failedOptimistic.id);
    expect(bundle.tasks[0].subtasks).toEqual([created]);
  });
});
