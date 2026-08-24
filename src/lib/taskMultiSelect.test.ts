import { describe, expect, it } from "vitest";
import type { Task } from "../types";
import {
  allTasksUnlabeled,
  applyTaskPointerSelect,
  contextMenuActionTasks,
  formatBulkNotice,
  intersectLabelIds,
  labelSelectionState,
  runBulkTaskUpdates,
  sharedDueFields,
  tasksForIds,
  uniqueTaskIds,
  visibleListTaskIds,
  visibleTaskIdsFromElement,
} from "./taskMultiSelect";

function item(id: string, parent: string | null = null): Task {
  return {
    id,
    workspace_id: "workspace",
    parent_task_id: parent,
    title: id,
    description: "",
    kind: "todo",
    status: "open",
    position: 0,
    priority: "none",
    due_at: null,
    due_start_at: null,
    due_is_all_day: false,
    due_timezone: null,
    estimate_hours: null,
    actual_hours: null,
    estimate_pomodoros: null,
    actual_pomodoros: null,
    assignee_id: null,
    cli_assignee: null,
    created_by: "u1",
    completed_at: null,
    deleted_at: null,
    recurrence: null,
    version: 1,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    external_id: null,
    connector_id: null,
    connector_platform: null,
    label_ids: [],
    participant_ids: [],
    children: [],
    description_mentions: [],
    reminders: [],
    reminder_persistent: false,
    dependencies: [],
  };
}

const none = { shiftKey: false, metaKey: false, ctrlKey: false };
const shift = { shiftKey: true, metaKey: false, ctrlKey: false };
const meta = { shiftKey: false, metaKey: true, ctrlKey: false };
const ctrl = { shiftKey: false, metaKey: false, ctrlKey: true };
const ordered = ["a", "b", "c", "d", "e"];

describe("applyTaskPointerSelect", () => {
  it("replaces the selection without modifiers", () => {
    expect(applyTaskPointerSelect({
      taskId: "c",
      modifiers: none,
      orderedIds: ordered,
      selectedIds: ["a", "b"],
      anchorId: "b",
    })).toEqual({ selectedIds: ["c"], anchorId: "c" });
  });

  it("toggles a task with Command or Control", () => {
    expect(applyTaskPointerSelect({
      taskId: "c",
      modifiers: meta,
      orderedIds: ordered,
      selectedIds: ["a"],
      anchorId: "a",
    })).toEqual({ selectedIds: ["a", "c"], anchorId: "c" });

    expect(applyTaskPointerSelect({
      taskId: "a",
      modifiers: ctrl,
      orderedIds: ordered,
      selectedIds: ["a", "c"],
      anchorId: "c",
    })).toEqual({ selectedIds: ["c"], anchorId: "a" });
  });

  it("selects the visible range with Shift and merges into the current set", () => {
    expect(applyTaskPointerSelect({
      taskId: "d",
      modifiers: shift,
      orderedIds: ordered,
      selectedIds: ["a"],
      anchorId: "b",
    })).toEqual({ selectedIds: ["a", "b", "c", "d"], anchorId: "d" });
  });

  it("uses the clicked task as the range start when there is no valid anchor", () => {
    expect(applyTaskPointerSelect({
      taskId: "c",
      modifiers: shift,
      orderedIds: ordered,
      selectedIds: [],
      anchorId: null,
    })).toEqual({ selectedIds: ["c"], anchorId: "c" });
  });

  it("adds just the clicked task when it is missing from the visible order", () => {
    expect(applyTaskPointerSelect({
      taskId: "missing",
      modifiers: shift,
      orderedIds: ordered,
      selectedIds: ["a"],
      anchorId: "a",
    })).toEqual({ selectedIds: ["a", "missing"], anchorId: "missing" });
  });
});

describe("visibleListTaskIds", () => {
  const tree = [
    item("a"),
    item("b"),
    item("a1", "a"),
    item("a2", "a"),
    item("a1a", "a1"),
  ];

  it("includes expanded children in visual order", () => {
    expect(visibleListTaskIds({
      groups: [{ tasks: [tree[0], tree[1]] }],
      treeTasks: tree,
      collapsedChildIds: new Set(),
    })).toEqual(["a", "a1", "a1a", "a2", "b"]);
  });

  it("skips children of a collapsed parent", () => {
    expect(visibleListTaskIds({
      groups: [{ tasks: [tree[0], tree[1]] }],
      treeTasks: tree,
      collapsedChildIds: new Set(["a"]),
    })).toEqual(["a", "b"]);
  });
});

describe("visibleTaskIdsFromElement", () => {
  it("reads data-task-id in DOM order", () => {
    document.body.innerHTML = `
      <div id="list">
        <article data-task-id="a"></article>
        <article data-task-id="a1"></article>
        <article data-task-id="b"></article>
      </div>
    `;
    expect(visibleTaskIdsFromElement(document.getElementById("list")))
      .toEqual(["a", "a1", "b"]);
    document.body.replaceChildren();
  });
});

describe("labelSelectionState", () => {
  it("reports none, some, and all", () => {
    expect(labelSelectionState([{ label_ids: [] }], "work")).toBe("none");
    expect(labelSelectionState(
      [{ label_ids: ["work"] }, { label_ids: [] }],
      "work",
    )).toBe("some");
    expect(labelSelectionState(
      [{ label_ids: ["work"] }, { label_ids: ["work", "home"] }],
      "work",
    )).toBe("all");
  });
});

describe("runBulkTaskUpdates", () => {
  it("runs actions sequentially and counts failures", async () => {
    const seen: number[] = [];
    const result = await runBulkTaskUpdates([1, 2, 3], async (value) => {
      seen.push(value);
      if (value === 2) throw new Error("nope");
    });
    expect(seen).toEqual([1, 2, 3]);
    expect(result).toEqual({ ok: 2, failed: 1 });
  });
});

describe("formatBulkNotice", () => {
  it("stays silent on a complete success", () => {
    expect(formatBulkNotice({ ok: 3, failed: 0, skipped: 0, action: "完成" })).toBeNull();
  });

  it("explains skipped-only and mixed results", () => {
    expect(formatBulkNotice({ ok: 0, failed: 0, skipped: 2, action: "完成" }))
      .toBe("没有可完成的任务");
    expect(formatBulkNotice({ ok: 2, failed: 1, skipped: 0, action: "删除" }))
      .toBe("2 项已删除，1 项失败");
  });
});

describe("uniqueTaskIds", () => {
  it("keeps first-seen order", () => {
    expect(uniqueTaskIds(["b", "a", "b", "c"])).toEqual(["b", "a", "c"]);
  });
});

describe("contextMenuActionTasks", () => {
  it("uses the whole selection when the focused task is among two or more selected tasks", () => {
    const selected = [item("a"), item("b"), item("c")];
    expect(contextMenuActionTasks(selected[1]!, selected)?.map((task) => task.id))
      .toEqual(["a", "b", "c"]);
    expect(contextMenuActionTasks(item("z"), selected)).toBeNull();
    expect(contextMenuActionTasks(selected[0]!, [selected[0]!])).toBeNull();
  });

  it("resolves selected ids from a mixed pool of roots and nested children", () => {
    const child = item("child", "root");
    const root = item("root");
    root.children = [child];
    expect(tasksForIds([root], ["child", "root"]).map((task) => task.id))
      .toEqual(["child", "root"]);
  });
});

describe("sharedDueFields", () => {
  it("returns the shared schedule or null when mixed", () => {
    const dated = item("a");
    dated.due_at = "2026-03-04T08:00:00.000Z";
    dated.due_is_all_day = true;
    const same = item("b");
    same.due_at = dated.due_at;
    same.due_is_all_day = true;
    const other = item("c");
    other.due_at = "2026-03-05T08:00:00.000Z";
    expect(sharedDueFields([dated, same])).toEqual({
      due_at: dated.due_at,
      due_start_at: null,
      due_is_all_day: true,
      due_timezone: null,
    });
    expect(sharedDueFields([dated, other])).toBeNull();
  });
});

describe("intersectLabelIds", () => {
  it("keeps labels present on every task", () => {
    expect(intersectLabelIds([
      { label_ids: ["work", "home"] },
      { label_ids: ["work"] },
    ])).toEqual(["work"]);
    expect(allTasksUnlabeled([{ label_ids: [] }, { label_ids: [] }])).toBe(true);
    expect(allTasksUnlabeled([{ label_ids: [] }, { label_ids: ["work"] }])).toBe(false);
  });
});
