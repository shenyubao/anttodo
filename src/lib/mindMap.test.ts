import { describe, expect, it } from "vitest";
import { buildMindMapTree, moveTaskToDate } from "./mindMap";
import { DEFAULT_DATE_TIME_PREFERENCES, toDateInput, toTimeInput } from "./dateTimePreferences";
import type { Label, Task } from "../types";

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    workspace_id: "workspace",
    title: "任务",
    description: "",
    status: "open",
    priority: "none",
    due_at: null,
    due_start_at: null,
    due_is_all_day: false,
    due_timezone: null,
    assignee_id: null,
    created_by: "user",
    completed_at: null,
    deleted_at: null,
    version: 1,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    label_ids: [],
    subtasks: [],
    ...overrides,
  };
}

function label(
  id: string,
  position: number,
  parentId: string | null = null,
  name = id,
): Label {
  return {
    id,
    workspace_id: "workspace",
    parent_id: parentId,
    name,
    color: `#${String(position + 1).padStart(6, "0")}`,
    position,
    visibility: "workspace",
    inherit_permissions: parentId !== null,
    created_by: "user",
  };
}

describe("mind map tree", () => {
  it("builds date, inbox and unscheduled branches without deleted tasks", () => {
    const root = buildMindMapTree({
      tasks: [
        task({ id: "early", title: "早", due_at: "2026-07-31T01:00:00.000Z" }),
        task({ id: "later", title: "晚", due_at: "2026-07-31T08:00:00.000Z" }),
        task({ id: "august", due_at: "2026-08-01T08:00:00.000Z" }),
        task({ id: "none" }),
        task({ id: "deleted", deleted_at: "2026-08-01T00:00:00Z" }),
      ],
      labels: [],
      preferences: DEFAULT_DATE_TIME_PREFERENCES,
      focusDateKey: "2026-08-02",
    });

    expect(root.label).toBe("任务清单");
    expect(root.children.map((node) => node.id)).toEqual([
      "month:2026-07",
      "month:2026-08",
      "inbox",
      "unscheduled",
    ]);
    const julyDay = root.children[0].children[0].children[0];
    expect(julyDay.children.map((node) => node.id)).toEqual([
      "task:2026-07-31:none:early",
      "task:2026-07-31:none:later",
    ]);
    const augustDays = root.children[1].children.flatMap((week) => week.children);
    expect(augustDays.some((node) => node.id === "day:2026-08-02" && node.children.length === 0)).toBe(true);
    expect(root.children.at(-2)?.children[0].id).toBe("task:inbox:none:none");
    expect(root.children.at(-1)?.children).toEqual([]);
  });

  it("prunes empty labels, preserves ancestors, and repeats multi-label tasks", () => {
    const root = buildMindMapTree({
      tasks: [
        task({
          id: "multi",
          title: "多标签",
          due_at: "2026-08-01T08:00:00.000Z",
          label_ids: ["child", "urgent"],
        }),
        task({ id: "parent-task", due_at: "2026-08-01T09:00:00.000Z", label_ids: ["parent"] }),
        task({ id: "loose" }),
        task({ id: "labeled-loose", label_ids: ["child"] }),
      ],
      labels: [
        label("urgent", 0, null, "紧急"),
        label("parent", 1, null, "产品"),
        label("child", 0, "parent", "前端"),
        label("empty", 2, null, "空标签"),
      ],
      preferences: DEFAULT_DATE_TIME_PREFERENCES,
    });

    const day = root.children[0].children[0].children[0];
    expect(day.children.map((node) => node.id)).toEqual([
      "label:2026-08-01:urgent",
      "label:2026-08-01:parent",
    ]);
    const urgent = day.children[0];
    const parent = day.children[1];
    expect(urgent.children.map((node) => node.id)).toEqual([
      "task:2026-08-01:urgent:multi",
    ]);
    expect(parent.children.map((node) => node.id)).toEqual([
      "label:2026-08-01:child",
      "task:2026-08-01:parent:parent-task",
    ]);
    expect(parent.children[0].children[0].id).toBe("task:2026-08-01:child:multi");
    expect(JSON.stringify(root)).not.toContain("空标签");

    const inboxChildren = root.children.at(-2)?.children ?? [];
    expect(inboxChildren.map((node) => node.id)).toEqual(["task:inbox:none:loose"]);

    const unscheduledChildren = root.children.at(-1)?.children ?? [];
    expect(unscheduledChildren.map((node) => node.id)).toEqual([
      "label:unscheduled:parent",
    ]);
    expect(unscheduledChildren[0].children[0].id).toBe("label:unscheduled:child");
    expect(unscheduledChildren[0].children[0].children[0].id).toBe(
      "task:unscheduled:child:labeled-loose",
    );
  });
});

describe("mind map date moves", () => {
  it("moves a point due date while preserving its local time and timezone", () => {
    const source = task({
      due_at: "2026-03-07T14:30:17.250Z",
      due_timezone: "America/New_York",
    });
    const patch = moveTaskToDate(source, "2026-03-09");
    expect(toDateInput(patch.due_at!, patch.due_timezone)).toBe("2026-03-09");
    expect(toTimeInput(patch.due_at!, patch.due_timezone)).toBe("09:30");
    expect(new Date(patch.due_at!).getUTCSeconds()).toBe(17);
  });

  it("moves both ends of a range by calendar days across daylight saving time", () => {
    const source = task({
      due_start_at: "2026-03-07T14:00:00.000Z",
      due_at: "2026-03-08T21:00:00.000Z",
      due_timezone: "America/New_York",
    });
    const patch = moveTaskToDate(source, "2026-03-10");
    expect(toDateInput(patch.due_start_at!, patch.due_timezone)).toBe("2026-03-09");
    expect(toTimeInput(patch.due_start_at!, patch.due_timezone)).toBe("09:00");
    expect(toDateInput(patch.due_at!, patch.due_timezone)).toBe("2026-03-10");
    expect(toTimeInput(patch.due_at!, patch.due_timezone)).toBe("17:00");
  });

  it("creates an all-day range for an unscheduled task and clears it again", () => {
    const source = task();
    const scheduled = moveTaskToDate(source, "2026-12-31");
    expect(scheduled.due_is_all_day).toBe(true);
    expect(toDateInput(scheduled.due_start_at!)).toBe("2026-12-31");
    expect(toDateInput(scheduled.due_at!)).toBe("2026-12-31");
    expect(moveTaskToDate({ ...source, ...scheduled }, null)).toEqual({
      due_at: null,
      due_start_at: null,
      due_is_all_day: false,
      due_timezone: null,
    });
  });
});
