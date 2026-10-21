import { describe, expect, it } from "vitest";
import { createDemoOkrData } from "./demoOkr";
import { okrObjectiveHistory, okrValueAt } from "./okrHistory";
import { generateWeeklyReportOkr, selectableWeeklyReportOkrObjectives, weeklyReportOkrRecords, type WeeklyReportOkrData } from "./weeklyReportOkr";
import { weeklyReportPublishError } from "./weeklyReports";
import type { OkrProgressRecord } from "../types";

const week = "2026-10-12";
const now = new Date("2026-10-16T12:00:00");
function fixture() {
  const { cycles, sets } = createDemoOkrData("workspace-team", now);
  const entries = sets.flatMap((set) => set.objectives.map((objective) => ({ objective, ownerId: set.owner_id, cycle: cycles.find((cycle) => cycle.id === set.cycle_id)! })));
  const data: WeeklyReportOkrData = { objectives: selectableWeeklyReportOkrObjectives(entries, "demo-user"), records: [] };
  const objective = data.objectives[0].objective;
  objective.title = "目标 *一*";
  for (const kr of objective.key_results) Object.assign(kr, { start_value: 0, target_value: 100, weight: 50 });
  return { data, entries, objective, kr: objective.key_results[0], sibling: objective.key_results[1] };
}
function record(id: string, kr: string, date: string, previous: number | null, current: number | null, detail = "进展"): OkrProgressRecord {
  return { id, objective_id: null, key_result_id: kr, workspace_id: "workspace-team", actor_id: "demo-user", created_at: new Date(date).toISOString(), previous_value: previous, current_value: current, previous_status: "normal", current_status: "risk", detail };
}

describe("weekly report OKR generation", () => {
  it("selects ownership, O responsibility and individual KR responsibility only in active cycles", () => {
    const { entries } = fixture();
    const active = entries.filter((entry) => entry.cycle.status === "active");
    const mine = active.filter((entry) => entry.ownerId === "demo-user");
    const other = active.find((entry) => entry.ownerId !== "demo-user")!;
    other.objective.key_results[0].responsible_ids = ["demo-user"];
    const selected = selectableWeeklyReportOkrObjectives(entries, "demo-user");
    expect(selected).toHaveLength(mine.length + 1);
    const entry = selected.find((entry) => entry.ownerId !== "demo-user")!;
    expect(entry.selectableKeyResultIds).toEqual([other.objective.key_results[0].id]);
    other.objective.responsible_ids = ["demo-user"];
    expect(selectableWeeklyReportOkrObjectives([other], "demo-user")[0].selectableKeyResultIds).toHaveLength(2);
  });

  it("uses the full week and all sibling KRs, independently from selected historical records", () => {
    const { data, objective, kr, sibling } = fixture();
    data.records = [
      record("old", kr.id, "2026-10-10T10:00:00", 0, 20, "旧记录"),
      record("one", kr.id, "2026-10-13T10:00:00", 20, 40),
      record("two", kr.id, "2026-10-16T10:00:00", 40, 60, "第一行\n- 第二行"),
      record("sibling", sibling.id, "2026-10-14T10:00:00", 40, 80),
      record("future", kr.id, "2026-10-20T10:00:00", 60, 90),
    ];
    kr.current_value = 90;
    sibling.current_value = 80;
    const text = generateWeeklyReportOkr(data, new Set(["old", "two"]), week, now);
    expect(text).toContain("- 目标 \\*一\\* 30%->70%");
    expect(text).toContain(`  - ${kr.title} 20%->60%`);
    expect(text).not.toContain(sibling.title);
    expect(text).toContain("    - 1016 风险 第一行  \n      \\- 第二行");
    expect(text).toContain("1010 风险 旧记录");
    expect(text).not.toContain("90%");
    expect(weeklyReportOkrRecords(data, week, false).map((row) => row.id)).toEqual(["one", "sibling", "two"]);
    expect(weeklyReportOkrRecords(data, week, true)).toHaveLength(5);
    expect(generateWeeklyReportOkr(data, new Set(), week, now)).toBe("");
    expect(okrObjectiveHistory(objective, data.records).at(-1)?.current_value).toBe(85);
  });

  it("honors exclusive local week boundaries and later changes when reporting past weeks", () => {
    const { data, kr, sibling } = fixture();
    sibling.current_value = 0;
    data.records = [record("start", kr.id, `${week}T00:00:00`, 10, 20), record("end", kr.id, "2026-10-19T00:00:00", 20, 80)];
    expect(weeklyReportOkrRecords(data, week, false).map((row) => row.id)).toEqual(["start"]);
    expect(generateWeeklyReportOkr(data, new Set(["start"]), week, new Date("2026-10-25T10:00:00"))).toContain("10%->20%");
    expect(okrValueAt([data.records[1]], new Date(`${week}T00:00:00`).getTime(), 80)).toBe(20);
  });

  it("formats unchanged and unknown values, escapes titles, and ignores unselectable records", () => {
    const { data, kr } = fixture();
    kr.title = "KR [链接]\n新行";
    kr.current_value = null;
    data.records = [record("unknown", kr.id, "2026-10-16T10:00:00", null, null)];
    expect(generateWeeklyReportOkr(data, new Set(["unknown"]), week, now)).toContain("  - KR \\[链接\\] 新行 暂无\n");
    data.objectives[0].selectableKeyResultIds = [];
    expect(generateWeeklyReportOkr(data, new Set(["unknown"]), week, now)).toBe("");
  });

  it("accepts OKR-only publication and still validates visibility", () => {
    const input = { okrProgressText: "- OKR", completedText: "", nextPlanText: "", reflectionText: "", visibility: "workspace" as const, userIds: [], groupIds: [] };
    expect(weeklyReportPublishError(input)).toBeNull();
    expect(weeklyReportPublishError({ ...input, visibility: "users" })).toBeTruthy();
    expect(weeklyReportPublishError({ ...input, okrProgressText: "  " })).toBeTruthy();
  });
});
