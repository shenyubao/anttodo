import type { SupabaseClient } from "@supabase/supabase-js";
import type { OkrCycle, OkrKeyResult, OkrObjective, OkrProgressRecord } from "../types";
import { selectableWeeklyReportOkrObjectives, type WeeklyReportOkrData } from "./weeklyReportOkr";

// Paginate every table, and keep UUID filters below URL-length limits.
export async function readAllOkrRows<T>(page: (from: number, to: number) => PromiseLike<{
  data: unknown[] | null; error: { message: string } | null;
}>) {
  const rows: T[] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await page(from, from + 499);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []) as T[]);
    if ((data?.length ?? 0) < 500) return rows;
  }
}

async function readBatches<T>(client: SupabaseClient, workspaceId: string, table: string, column: string, ids: string[]) {
  const rows: T[] = [];
  for (let index = 0; index < ids.length; index += 80) {
    const batch = ids.slice(index, index + 80);
    rows.push(...await readAllOkrRows<T>((from, to) => client.from(table).select("*")
      .eq("workspace_id", workspaceId).in(column, batch).order("id").range(from, to)));
  }
  return rows;
}

export async function loadOkrKeyResultHistory(client: SupabaseClient, workspaceId: string, ids: string[]) {
  const rows = await readBatches<OkrProgressRecord>(client, workspaceId, "okr_progress_records", "key_result_id", ids);
  return rows.map((row) => ({
    ...row,
    previous_value: row.previous_value === null ? null : Number(row.previous_value),
    current_value: row.current_value === null ? null : Number(row.current_value),
  }));
}

export function weeklyReportOkrKey(workspaceId: string, userId: string, weekStart: string) {
  return ["weekly-report-okr", workspaceId, userId, weekStart, Intl.DateTimeFormat().resolvedOptions().timeZone] as const;
}

export async function loadWeeklyReportOkrData(client: SupabaseClient, workspaceId: string, userId: string): Promise<WeeklyReportOkrData> {
  const cycles = await readAllOkrRows<OkrCycle>((from, to) => client.from("okr_cycles").select("*")
    .eq("workspace_id", workspaceId).eq("status", "active").order("position").order("id").range(from, to));
  const sets = await readBatches<{ id: string; cycle_id: string; owner_id: string }>(client, workspaceId, "okr_sets", "cycle_id", cycles.map((cycle) => cycle.id));
  const objectives = await readBatches<OkrObjective>(client, workspaceId, "okr_objectives", "set_id", sets.map((set) => set.id));
  const objectiveIds = objectives.map((objective) => objective.id);
  const [keyResults, objectiveResponsibles] = await Promise.all([
    readBatches<OkrKeyResult>(client, workspaceId, "okr_key_results", "objective_id", objectiveIds),
    // Relation tables use composite primary keys, so page using their entity and user columns.
    readResponsibles(client, workspaceId, "okr_objective_responsibles", "objective_id", objectiveIds),
  ]);
  const keyResultResponsibles = await readResponsibles(client, workspaceId, "okr_key_result_responsibles", "key_result_id", keyResults.map((kr) => kr.id));
  const entries = objectives.map((objective) => {
    const set = sets.find((item) => item.id === objective.set_id)!;
    return {
      ownerId: set.owner_id,
      cycle: cycles.find((cycle) => cycle.id === set.cycle_id)!,
      objective: {
        ...objective, progress_mode: "key_results" as const,
        responsible_ids: objectiveResponsibles.filter((row) => row.entity_id === objective.id).map((row) => row.user_id),
        key_results: keyResults.filter((kr) => kr.objective_id === objective.id).sort((a, b) => a.position - b.position || a.id.localeCompare(b.id)).map((kr) => ({
          ...kr, start_value: Number(kr.start_value), target_value: Number(kr.target_value),
          current_value: kr.current_value === null ? null : Number(kr.current_value), weight: Number(kr.weight),
          responsible_ids: keyResultResponsibles.filter((row) => row.entity_id === kr.id).map((row) => row.user_id),
        })),
      },
    };
  }).sort((a, b) => a.cycle.position - b.cycle.position || a.cycle.id.localeCompare(b.cycle.id)
    || a.ownerId.localeCompare(b.ownerId) || a.objective.position - b.objective.position || a.objective.id.localeCompare(b.objective.id));
  const eligible = selectableWeeklyReportOkrObjectives(entries, userId);
  return { objectives: eligible, records: await loadOkrKeyResultHistory(client, workspaceId,
    eligible.flatMap((entry) => entry.objective.key_results.map((kr) => kr.id))) };
}

async function readResponsibles(client: SupabaseClient, workspaceId: string, table: string, column: string, ids: string[]) {
  const rows: Array<{ entity_id: string; user_id: string }> = [];
  const batches = Array.from({ length: Math.ceil(ids.length / 80) }, (_, i) => ids.slice(i * 80, i * 80 + 80));
  for (const batch of batches) {
    rows.push(...await readAllOkrRows<{ entity_id: string; user_id: string }>((from, to) => {
      const query = client.from(table).select(`entity_id:${column},user_id`).eq("workspace_id", workspaceId);
      return query.in(column, batch).order(column).order("user_id").range(from, to);
    }));
  }
  return rows;
}
