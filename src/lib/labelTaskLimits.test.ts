import { describe, expect, it } from "vitest";
import {
  LABEL_TASK_LIMIT_MESSAGE,
  MAX_TASKS_PER_LABEL,
  adjustLabelTaskCounts,
  applyLiveLabelCountDelta,
  assertCanAssociateTaskLabels,
  countLiveTasksByLabel,
  isLabelAtTaskLimit,
  mapLabelTaskLimitError,
} from "./labelTaskLimits";

describe("label task limits", () => {
  it("counts live tasks per label and ignores trashed tasks", () => {
    expect(countLiveTasksByLabel([
      { deleted_at: null, label_ids: ["a", "b"] },
      { deleted_at: null, label_ids: ["a"] },
      { deleted_at: "2026-08-20T00:00:00.000Z", label_ids: ["a"] },
    ])).toEqual({ a: 2, b: 1 });
  });

  it("blocks associating a label once the cached count is at the cap", () => {
    const counts = { full: MAX_TASKS_PER_LABEL, open: MAX_TASKS_PER_LABEL - 1 };
    expect(isLabelAtTaskLimit(counts, "full")).toBe(true);
    expect(() => assertCanAssociateTaskLabels(counts, ["open", "full"]))
      .toThrow(LABEL_TASK_LIMIT_MESSAGE);
    expect(() => assertCanAssociateTaskLabels(counts, ["open"])).not.toThrow();
  });

  it("adjusts cached counts when tasks are added, labeled, or trashed", () => {
    const counts = adjustLabelTaskCounts({ a: 2 }, ["a", "b"], 1);
    expect(counts).toEqual({ a: 3, b: 1 });
    expect(applyLiveLabelCountDelta(
      counts,
      { deleted_at: null, label_ids: ["a"] },
      { deleted_at: null, label_ids: ["b"] },
    )).toEqual({ a: 2, b: 2 });
    expect(applyLiveLabelCountDelta(
      counts,
      { deleted_at: null, label_ids: ["a"] },
      { deleted_at: "2026-08-20T00:00:00.000Z", label_ids: ["a"] },
    )).toEqual({ a: 2, b: 1 });
  });

  it("maps the database limit error to the cleanup prompt", () => {
    expect(mapLabelTaskLimitError("label_task_limit_exceeded")).toBe(LABEL_TASK_LIMIT_MESSAGE);
    expect(mapLabelTaskLimitError("other")).toBeNull();
  });
});
