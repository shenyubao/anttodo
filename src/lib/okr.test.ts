import { describe, expect, it } from "vitest";
import {
  automaticOkrStatus,
  equalOkrWeights,
  filterVisibleOkrMembers,
  importedOkrObjectives,
  okrBreakdownsValid,
  okrPublishBlockingMessage,
  okrObjectiveProgress,
  okrProgressPercent,
  okrRealtimeAffectsDiscoverability,
  okrSnapshotDiff,
  okrWeightsValid,
  publishOkrErrorMessage,
  withDefaultOkrWeights,
  withRebalancedOkrWeights,
  POSTGRES_INTEGER_MAX,
  nextOkrPosition,
} from "./okr";
import type { OkrObjective } from "../types";

describe("OKR helpers", () => {
  it("keeps persisted sort positions inside PostgreSQL integer range", () => {
    expect(nextOkrPosition(undefined)).toBe(0);
    expect(nextOkrPosition(12)).toBe(13);
    expect(nextOkrPosition(POSTGRES_INTEGER_MAX)).toBe(POSTGRES_INTEGER_MAX);
    expect(nextOkrPosition(Date.now())).toBe(POSTGRES_INTEGER_MAX);
  });

  it("normalizes ascending and descending metrics", () => {
    expect(okrProgressPercent({ start_value: 0, target_value: 100, current_value: 50 })).toBe(50);
    expect(okrProgressPercent({ start_value: 100, target_value: 0, current_value: 25 })).toBe(75);
    expect(okrProgressPercent({ start_value: 0, target_value: 100, current_value: 130 })).toBe(100);
  });

  it("derives time-aware status", () => {
    const cycle = { starts_on: "2026-01-01", ends_on: "2026-01-31" };
    expect(automaticOkrStatus(60, cycle, new Date("2026-01-16T12:00:00"))).toBe("normal");
    expect(automaticOkrStatus(30, cycle, new Date("2026-01-16T12:00:00"))).toBe("risk");
    expect(automaticOkrStatus(5, cycle, new Date("2026-01-25T12:00:00"))).toBe("delayed");
  });

  it("distributes weights without losing the remainder", () => {
    expect(equalOkrWeights(3)).toEqual([33.33, 33.33, 33.34]);
    expect(okrWeightsValid([{ weight: 33.33 }, { weight: 33.33 }, { weight: 33.34 }])).toBe(true);
    expect(okrWeightsValid([{ weight: 40 }, { weight: 40 }])).toBe(false);
  });

  it("defaults unfilled Key Result weights to an even split", () => {
    expect(withDefaultOkrWeights([{ weight: 0 }, { weight: 0 }])).toEqual([{ weight: 50 }, { weight: 50 }]);
    expect(withDefaultOkrWeights([{ weight: 100 }, { weight: 100 }, { weight: 100 }]))
      .toEqual([{ weight: 33.33 }, { weight: 33.33 }, { weight: 33.34 }]);
    expect(withDefaultOkrWeights([{ weight: 40 }, { weight: 0 }])).toEqual([{ weight: 40 }, { weight: 60 }]);
    expect(withDefaultOkrWeights([{ weight: 40 }, { weight: 40 }])).toEqual([{ weight: 40 }, { weight: 40 }]);
    expect(withDefaultOkrWeights([{ weight: 50 }, { weight: 50 }])).toEqual([{ weight: 50 }, { weight: 50 }]);
    expect(withDefaultOkrWeights([{ weight: 50 }])).toEqual([{ weight: 100 }]);
  });

  it("rebalances remaining Key Result weights after a deletion", () => {
    expect(withRebalancedOkrWeights([{ weight: 33.33 }, { weight: 33.33 }])).toEqual([
      { weight: 50 },
      { weight: 50 },
    ]);
  });

  it("blocks publishing when another Objective in the set is invalid", () => {
    expect(okrPublishBlockingMessage([
      {
        title: "Valid",
        key_results: [{ weight: 100, target_value: 100, breakdowns: [] }],
      },
      {
        title: "Defaults",
        key_results: [
          { weight: 100, target_value: 100, breakdowns: [] },
          { weight: 100, target_value: 100, breakdowns: [] },
        ],
      },
    ])).toBe(null);
    expect(okrPublishBlockingMessage([
      {
        title: "Valid",
        key_results: [{ weight: 100, target_value: 100, breakdowns: [] }],
      },
      {
        title: "Broken weights",
        key_results: [{ weight: 40, target_value: 100, breakdowns: [] }, { weight: 40, target_value: 100, breakdowns: [] }],
      },
    ])).toBe("无法发布：「Broken weights」的 Key Result 权重之和必须等于 100%");
    expect(publishOkrErrorMessage('Key Result weights must add up to 100 for objective "增长"'))
      .toBe("无法发布：「增长」的 Key Result 权重之和必须等于 100%");
    expect(publishOkrErrorMessage("Only the OKR owner can publish an active cycle"))
      .toBe("只有负责人可以在进行中的周期发布 OKR");
  });

  it("does not fan out discovery queries for ordinary Key Result writes", () => {
    expect(okrRealtimeAffectsDiscoverability("okr_key_results", "INSERT")).toBe(false);
    expect(okrRealtimeAffectsDiscoverability("okr_key_results", "UPDATE")).toBe(false);
    expect(okrRealtimeAffectsDiscoverability("okr_key_results", "DELETE")).toBe(true);
    expect(okrRealtimeAffectsDiscoverability("okr_access_revisions", "UPDATE")).toBe(true);
    expect(okrRealtimeAffectsDiscoverability("okr_key_result_user_acl", "INSERT")).toBe(true);
  });

  it("includes KRs without updates as zero in weighted objective progress", () => {
    expect(okrObjectiveProgress({
      progress_mode: "key_results",
      key_results: [
        { start_value: 0, target_value: 100, current_value: 100, weight: 50 },
        { start_value: 0, target_value: 100, current_value: null, weight: 50 },
      ],
    } as OkrObjective)).toBe(50);
  });

  it("requires breakdowns to allocate the target", () => {
    expect(okrBreakdownsValid({ target_value: 100, breakdowns: [
      { id: "1", key_result_id: "k", workspace_id: "w", user_id: "u", allocated_value: 40, position: 0 },
      { id: "2", key_result_id: "k", workspace_id: "w", user_id: "v", allocated_value: 60, position: 1 },
    ] })).toBe(true);
  });

  it("compares immutable version snapshots", () => {
    const previous = { objectives: [{ id: "o1", title: "Old", keyResults: [{ id: "k1", title: "Keep" }] }] };
    const current = { objectives: [{ id: "o1", title: "New", keyResults: [{ id: "k2", title: "Added" }] }] };
    expect(okrSnapshotDiff(current, previous)).toEqual(expect.arrayContaining([
      { kind: "objective", id: "o1", change: "changed" },
      { kind: "key_result", id: "k2", change: "added" },
      { kind: "key_result", id: "k1", change: "removed" },
    ]));
  });

  it("filters the flat visible employee list by permission and name", () => {
    const members = [
      { user_id: "u1", profile: { display_name: "沈宇宝" } },
      { user_id: "u2", profile: { display_name: "林夏" } },
      { user_id: "u3", profile: { display_name: "不可见成员" } },
    ];
    expect(filterVisibleOkrMembers(members, new Set(["u1", "u2"]), "林")).toEqual([members[1]]);
  });

  it("imports structure and metric settings while resetting period state", () => {
    const source = {
      id: "o1", set_id: "s1", workspace_id: "w1", title: "增长", note: "背景",
      position: 0, visibility: "restricted", progress_mode: "key_results", status_mode: "automatic",
      progress_status: "risk", start_value: 0, target_value: 100, current_value: 40,
      metric_unit: "percent", custom_unit: null, score: 0.7, published_at: "2026-01-01",
      created_at: "2026-01-01", updated_at: "2026-01-01", responsible_ids: ["u1"],
      user_acl_ids: ["u2"], group_acl_ids: ["g1"], alignment_target_id: "o2",
      key_results: [{
        id: "k1", objective_id: "o1", workspace_id: "w1", title: "收入", position: 0,
        visibility: "restricted", status_mode: "automatic", progress_status: "risk",
        start_value: 10, target_value: 200, current_value: 80, metric_unit: "cny",
        custom_unit: null, weight: 100, score: 0.8, published_at: "2026-01-01",
        created_at: "2026-01-01", updated_at: "2026-01-01", responsible_ids: ["u1"],
        user_acl_ids: ["u2"], group_acl_ids: ["g1"], breakdowns: [{
          id: "b1", key_result_id: "k1", workspace_id: "w1", user_id: "u1",
          allocated_value: 200, position: 0,
        }],
      }],
    } as OkrObjective;
    const [imported] = importedOkrObjectives([source], "w2");
    expect(imported).toMatchObject({
      workspace_id: "w2", note: "背景", responsible_ids: ["u1"], visibility: "inherit",
      user_acl_ids: [], group_acl_ids: [], alignment_target_id: null,
      current_value: null, progress_status: "none", score: null,
    });
    expect(imported.key_results[0]).toMatchObject({
      workspace_id: "w2", metric_unit: "cny", start_value: 10, target_value: 200,
      responsible_ids: ["u1"], visibility: "inherit", user_acl_ids: [], group_acl_ids: [],
      current_value: null, progress_status: "none", score: null,
    });
    expect(imported.key_results[0].breakdowns[0]).toMatchObject({
      workspace_id: "w2", user_id: "u1", allocated_value: 200,
    });
  });
});
