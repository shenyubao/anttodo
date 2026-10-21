import type { OkrObjective, OkrProgressRecord } from "../types";
import { okrObjectiveProgress } from "./okr";

export function sortedOkrRecords(records: OkrProgressRecord[]) {
  return [...records].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime() || a.id.localeCompare(b.id));
}

/** Value immediately before an exclusive boundary, including changes after the report week. */
export function okrValueAt(records: OkrProgressRecord[], boundary: number, fallback: number | null) {
  const sorted = sortedOkrRecords(records);
  const before = sorted.filter((record) => new Date(record.created_at).getTime() < boundary).at(-1);
  if (before) return before.current_value;
  return sorted.length ? sorted[0].previous_value : fallback;
}

export function okrObjectiveProgressAt(objective: OkrObjective, records: OkrProgressRecord[], boundary: number) {
  return okrObjectiveProgress({
    ...objective,
    key_results: objective.key_results.map((kr) => ({
      ...kr,
      current_value: okrValueAt(records.filter((record) => record.key_result_id === kr.id), boundary, kr.current_value),
    })),
  });
}

export function okrObjectiveHistory(objective: OkrObjective, records: OkrProgressRecord[]) {
  const ids = new Set(objective.key_results.map((kr) => kr.id));
  const relevant = sortedOkrRecords(records.filter((record) => record.key_result_id && ids.has(record.key_result_id)));
  const values = new Map(objective.key_results.map((kr) => [kr.id, kr.current_value]));
  const initialized = new Set<string>();
  for (const record of relevant) {
    if (!initialized.has(record.key_result_id!)) {
      values.set(record.key_result_id!, record.previous_value);
      initialized.add(record.key_result_id!);
    }
  }
  const history: OkrProgressRecord[] = [];
  for (let index = 0; index < relevant.length;) {
    let end = index;
    const timestamp = new Date(relevant[index].created_at).getTime();
    while (end < relevant.length && new Date(relevant[end].created_at).getTime() === timestamp) {
      values.set(relevant[end].key_result_id!, relevant[end].current_value);
      end += 1;
    }
    const progress = okrObjectiveProgress({
      ...objective,
      key_results: objective.key_results.map((kr) => ({ ...kr, current_value: values.get(kr.id) ?? null })),
    });
    for (; index < end; index += 1) history.push({ ...relevant[index], current_value: progress });
  }
  return history;
}
