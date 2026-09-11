import { describe, expect, it } from "vitest";
import { createDemoOkrData } from "./demoOkr";
import { okrObjectiveProgress, okrProgressPercent, okrWeightsValid } from "./okr";

describe("OKR product demo", () => {
  it.each([
    ["2026-08-31T12:00:00", "2026-07-01", "2026-09-30", "2026 年 Q3"],
    ["2027-01-01T12:00:00", "2027-01-01", "2027-03-31", "2027 年 Q1"],
    ["2028-02-29T12:00:00", "2028-01-01", "2028-03-31", "2028 年 Q1"],
    ["2026-12-31T12:00:00", "2026-10-01", "2026-12-31", "2026 年 Q4"],
  ])("keeps a current quarter and adjacent cycles at %s", (date, start, end, name) => {
    const { cycles } = createDemoOkrData("workspace-team", new Date(date));
    expect(cycles.map((cycle) => cycle.status)).toEqual(["draft", "active", "closed"]);
    expect(cycles[1]).toMatchObject({ starts_on: start, ends_on: end, name });
    expect(cycles[0].starts_on > cycles[1].ends_on).toBe(true);
    expect(cycles[2].ends_on < cycles[1].starts_on).toBe(true);
  });

  it("provides related, measurable O/KR examples for each cycle and member", () => {
    const { cycles, sets } = createDemoOkrData();
    const ids: string[] = cycles.map((cycle) => cycle.id);
    for (const cycle of cycles) {
      const cycleSets = sets.filter((set) => set.cycle_id === cycle.id);
      expect(cycleSets.map((set) => set.owner_id)).toEqual(["demo-user", "demo-member"]);
      for (const set of cycleSets) {
        ids.push(set.id);
        expect(set.workspace_id).toBe(cycle.workspace_id);
        expect(set.objectives.length).toBeGreaterThan(0);
        for (const objective of set.objectives) {
          ids.push(objective.id);
          expect(objective.set_id).toBe(set.id);
          expect(objective.workspace_id).toBe(set.workspace_id);
          expect(objective.responsible_ids).toEqual([set.owner_id]);
          expect(objective.key_results.length).toBeGreaterThan(1);
          expect(okrWeightsValid(objective.key_results)).toBe(true);
          if (objective.alignment_target_id) {
            expect(cycleSets.flatMap((item) => item.objectives)
              .some((item) => item.id === objective.alignment_target_id)).toBe(true);
          }
          for (const kr of objective.key_results) {
            ids.push(kr.id);
            expect(kr.objective_id).toBe(objective.id);
            expect(kr.workspace_id).toBe(set.workspace_id);
            expect(kr.target_value).not.toBe(kr.start_value);
            if (cycle.status === "closed") expect(okrProgressPercent(kr)).toBe(100);
            if (cycle.status === "draft") expect(kr.current_value).toBeNull();
          }
        }
      }
    }
    expect(new Set(ids).size).toBe(ids.length);
    const currentSet = sets.find((set) => set.cycle_id === cycles[1].id && set.owner_id === "demo-user")!;
    expect(okrObjectiveProgress(currentSet.objectives[0])).toBe(70);
    expect(okrProgressPercent(currentSet.objectives[1].key_results[1])).toBe(38);
  });

  it("isolates workspaces and returns fresh nested fixtures", () => {
    const first = createDemoOkrData();
    first.sets[0].objectives[0].key_results[0].title = "changed";
    first.sets[0].objectives[0].responsible_ids.push("someone-else");
    const next = createDemoOkrData();
    expect(next.sets[0].objectives[0].key_results[0].title).not.toBe("changed");
    expect(next.sets[0].objectives[0].responsible_ids).toEqual(["demo-user"]);
    const personal = createDemoOkrData("workspace-personal");
    expect(personal.sets).toHaveLength(3);
    expect(personal.sets.every((set) => set.owner_id === "demo-user"
      && set.workspace_id === "workspace-personal")).toBe(true);
    expect(personal.cycles.some((cycle) => next.cycles.some((other) => other.id === cycle.id))).toBe(false);
  });
});
