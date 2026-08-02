import { describe, expect, it } from "vitest";
import {
  activityPlainTextPreview,
  activityTimestamp,
  taskActivityPresentation,
} from "./TaskActivity";
import { DEFAULT_DATE_TIME_PREFERENCES } from "./lib/dateTimePreferences";
import type { Task, TaskActivityEvent } from "./types";

const task = { title: "发布 AntTodo" } as Task;
const baseEvent: TaskActivityEvent = {
  id: "event-1",
  workspace_id: "workspace-1",
  task_id: "task-1",
  actor_id: "user-1",
  event_type: "task.created",
  payload: {},
  created_at: "2026-08-02T10:00:00.000Z",
};

describe("task activity", () => {
  it("renders semantic status and assignee changes", () => {
    expect(taskActivityPresentation({
      ...baseEvent,
      event_type: "task.updated",
      payload: { changes: { status: { before: "open", after: "completed" } } },
    }, task, [], DEFAULT_DATE_TIME_PREFERENCES).action).toBe("完成了任务");

    expect(taskActivityPresentation({
      ...baseEvent,
      event_type: "task.assignee_changed",
      payload: { assignee_id: "missing-member" },
    }, task, [], DEFAULT_DATE_TIME_PREFERENCES).detail).toBe("成员");

    expect(taskActivityPresentation({
      ...baseEvent,
      event_type: "task.participant_added",
      payload: { user_id: "user-2", display_name: "产品同学" },
    }, task, [], DEFAULT_DATE_TIME_PREFERENCES)).toMatchObject({
      action: "添加了参与者",
      detail: "产品同学",
    });

    expect(taskActivityPresentation({
      ...baseEvent,
      event_type: "task.participant_removed",
      payload: { user_id: "user-2", display_name: "产品同学" },
    }, task, [], DEFAULT_DATE_TIME_PREFERENCES).action).toBe("移除了参与者");
  });

  it("strips markdown and truncates long content previews", () => {
    const preview = activityPlainTextPreview(`## 标题\n${"内容".repeat(80)}`);
    expect(preview).not.toContain("#");
    expect(preview.endsWith("…")).toBe(true);
    expect(preview.length).toBeLessThanOrEqual(121);
  });

  it("falls back for unknown events and respects date preferences", () => {
    expect(taskActivityPresentation({
      ...baseEvent,
      event_type: "task.future_event",
    }, task, [], DEFAULT_DATE_TIME_PREFERENCES).action).toBe("更新了任务");
    expect(activityTimestamp(baseEvent.created_at, DEFAULT_DATE_TIME_PREFERENCES))
      .toMatch(/^2026\/08\/02 /);
  });
});
