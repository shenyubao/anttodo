import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadOkrKeyResultHistory, loadWeeklyReportOkrData, readAllOkrRows } from "./weeklyReportOkrApi";
import { createDemoOkrData } from "./demoOkr";

function fakeClient(tables: Record<string, Record<string, unknown>[]>) {
  const calls: Array<{table:string; filters:Array<[string,unknown]>}> = [];
  const client = { from(table: string) {
    const filters:Array<[string,unknown]> = [];
    calls.push({table,filters});
    let rows = tables[table] ?? [];
    const query = {
      select: () => query,
      eq(column: string, value: unknown) { rows = rows.filter((row) => row[column] === value); filters.push([column,value]); return query; },
      in(column: string, values: unknown[]) { rows = rows.filter((row) => values.includes(row[column])); filters.push([column,values]); return query; },
      order: () => query,
      range(from: number, to: number) {
        return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
      },
    };
    return query;
  }};
  return { client: client as unknown as SupabaseClient, calls };
}

describe("weekly report OKR batch reads", () => {
  it("paginates through the server row limit and propagates errors", async () => {
    const page = vi.fn((from:number) => Promise.resolve({data: from === 0 ? Array.from({length:500},(_,id)=>({id})) : [{id:500}], error:null}));
    expect(await readAllOkrRows(page)).toHaveLength(501);
    expect(page.mock.calls.map(([from])=>from)).toEqual([0,500]);
    await expect(readAllOkrRows(() => Promise.resolve({data:null,error:{message:"denied"}}))).rejects.toThrow("denied");
  });
  it("batches IDs and normalizes numeric history values", async () => {
    const ids = Array.from({length:81},(_,i)=>`kr-${i}`);
    const {client,calls} = fakeClient({okr_progress_records:[{id:"r",workspace_id:"w",key_result_id:ids[0],previous_value:"1",current_value:"2"}]});
    expect((await loadOkrKeyResultHistory(client,"w",ids))[0]).toMatchObject({previous_value:1,current_value:2});
    expect(calls).toHaveLength(2);
    expect(calls[0].filters).toContainEqual(["workspace_id","w"]);
  });
  it("loads only active-cycle eligible trees and keeps unselected siblings for O totals", async () => {
    const {cycles,sets} = createDemoOkrData("workspace-team",new Date("2026-10-16T12:00:00"));
    const objectives = sets.flatMap((set)=>set.objectives);
    const {client,calls} = fakeClient({
      okr_cycles:cycles, okr_sets:sets, okr_objectives:objectives,
      okr_key_results:objectives.flatMap((o)=>o.key_results),
    });
    const data = await loadWeeklyReportOkrData(client,"workspace-team","demo-user");
    expect(data.objectives).toHaveLength(2);
    expect(data.objectives.every((entry)=>entry.cycle.status==="active" && entry.ownerId==="demo-user")).toBe(true);
    expect(data.objectives[0].objective.key_results).toHaveLength(2);
    expect(calls.filter((call)=>call.table==="okr_progress_records")).toHaveLength(1);
  });
});
